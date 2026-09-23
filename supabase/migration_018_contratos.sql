-- ============================================================
-- MIGRAÇÃO 018 — Contratos: gerar um contrato a partir de um lead,
-- enviar um link público para assinatura eletrônica simples
-- (desenho da assinatura na tela + nome/documento/data-hora/IP como
-- prova) e guardar o PDF assinado no sistema.
-- ============================================================

-- ---------- libera o módulo "contratos" nas permissões por função ----------
do $$
declare
  cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'public.role_permissions'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%module%';
  if cname is not null then
    execute format('alter table public.role_permissions drop constraint %I', cname);
  end if;
end $$;

alter table public.role_permissions add constraint role_permissions_module_check
  check (module in ('leads','pipeline','cotacao','produtos','financeiro','matriculas','colaboradores','contratos'));

insert into public.role_permissions (role, module, allowed) values
  ('Gerente','contratos', true),
  ('Consultor','contratos', true),
  ('Influencer','contratos', false),
  ('MKT','contratos', false),
  ('Financeiro','contratos', true)
on conflict (role, module) do nothing;

-- ---------- contratos ----------
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,

  title text not null default 'Contrato de Prestação de Serviços',
  content text not null default '',
  value numeric(12,2) not null default 0,

  status text not null default 'Rascunho'
    check (status in ('Rascunho','Aguardando assinatura','Assinado','Cancelado')),

  signer_name text default '',
  signer_document text default '',
  signature_data text,
  signed_at timestamptz,
  signed_ip text,
  pdf_path text,

  public_token uuid not null default gen_random_uuid() unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contracts enable row level security;

create policy "contratos: ver conforme função e atribuição"
  on public.contracts for select
  using (
    public.has_module_access('contratos')
    and (
      public.current_role_name() <> 'Consultor'
      or exists (select 1 from public.leads l where l.id = contracts.lead_id and l.consultor_id = auth.uid())
    )
  );

create policy "contratos: criar quem acessa o módulo"
  on public.contracts for insert
  with check (public.has_module_access('contratos'));

create policy "contratos: editar conforme função e atribuição"
  on public.contracts for update
  using (
    public.has_module_access('contratos')
    and (
      public.current_role_name() <> 'Consultor'
      or exists (select 1 from public.leads l where l.id = contracts.lead_id and l.consultor_id = auth.uid())
    )
  );

create policy "contratos: excluir ADM ou Gerente"
  on public.contracts for delete
  using (public.current_role_name() in ('ADM','Gerente'));

-- ============================================================
-- ACESSO PÚBLICO (sem login) — quem recebe o link só consegue ler
-- e assinar ESSE contrato específico, nunca listar os outros.
-- ============================================================
create or replace function public.get_contract_by_token(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'content', c.content, 'value', c.value,
    'status', c.status, 'signer_name', c.signer_name, 'signed_at', c.signed_at,
    'lead_name', l.name
  )
  from public.contracts c
  left join public.leads l on l.id = c.lead_id
  where c.public_token = p_token;
$$;

grant execute on function public.get_contract_by_token(uuid) to anon;

create or replace function public.sign_contract_public(
  p_token uuid, p_signer_name text, p_signer_document text,
  p_signature_data text, p_pdf_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text;
begin
  begin
    v_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1);
  exception when others then
    v_ip := null;
  end;

  update public.contracts set
    signer_name = p_signer_name,
    signer_document = p_signer_document,
    signature_data = p_signature_data,
    pdf_path = p_pdf_path,
    signed_at = now(),
    signed_ip = v_ip,
    status = 'Assinado',
    updated_at = now()
  where public_token = p_token and status = 'Aguardando assinatura';

  if not found then
    raise exception 'Este contrato não está mais disponível para assinatura.';
  end if;
end;
$$;

grant execute on function public.sign_contract_public(uuid, text, text, text, text) to anon;

-- ============================================================
-- ARMAZENAMENTO DO PDF ASSINADO
-- ============================================================
insert into storage.buckets (id, name, public)
values ('contract-pdfs', 'contract-pdfs', false)
on conflict (id) do nothing;

create policy "contract-pdfs: equipe lê"
  on storage.objects for select
  using (bucket_id = 'contract-pdfs' and public.has_module_access('contratos'));

create policy "contract-pdfs: equipe gerencia"
  on storage.objects for all
  using (bucket_id = 'contract-pdfs' and public.has_module_access('contratos'))
  with check (bucket_id = 'contract-pdfs' and public.has_module_access('contratos'));

-- quem assina (sem login) só pode enviar o PDF gerado na hora da
-- assinatura; não consegue listar, ler ou apagar arquivos de outros.
create policy "contract-pdfs: assinante envia pelo link público"
  on storage.objects for insert
  with check (bucket_id = 'contract-pdfs' and auth.role() = 'anon');
