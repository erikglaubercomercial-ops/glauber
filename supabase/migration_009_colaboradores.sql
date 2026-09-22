-- ============================================================
-- MIGRAÇÃO 009 — módulo Colaboradores: cadastro de novos
-- funcionários com link público (sem login) para o próprio
-- colaborador preencher seus dados pessoais e enviar documentos.
-- Mesmo padrão do módulo Matrículas (migration_004).
-- Rode este arquivo no Supabase: SQL Editor → New query → Run
-- ============================================================

-- ---------- libera o módulo "colaboradores" nas permissões por função ----------
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
  check (module in ('leads','pipeline','cotacao','produtos','financeiro','matriculas','colaboradores'));

insert into public.role_permissions (role, module, allowed) values
  ('Gerente','colaboradores', true),
  ('Consultor','colaboradores', false),
  ('Influencer','colaboradores', false),
  ('MKT','colaboradores', false),
  ('Financeiro','colaboradores', false)
on conflict (role, module) do nothing;

-- ---------- colaboradores ----------
create table public.collaborators (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid references public.profiles(id) on delete set null,

  -- definidos pelo ADM/Gerente na criação
  name text not null default '',
  work_email text default '',
  role_title text default '',
  department text default '',
  start_date date,
  contract_type text default '', -- sem check constraint: evita mismatch de acentuação com o valor enviado pelo app

  -- preenchidos pelo próprio colaborador, pelo link público
  birth_date date,
  cpf text default '',
  rg text default '',
  marital_status text default '',
  nationality text default '',
  personal_phone text default '',
  personal_email text default '',

  emergency_name text default '',
  emergency_relationship text default '',
  emergency_phone text default '',

  address_street text default '',
  address_number text default '',
  address_complement text default '',
  address_neighborhood text default '',
  address_city text default '',
  address_state text default '',
  address_zip text default '',

  id_document_path text,
  address_proof_path text,
  photo_path text,
  resume_path text,
  work_card_path text,

  status text not null default 'Aguardando colaborador'
    check (status in ('Aguardando colaborador','Preenchido pelo colaborador','Completo')),

  public_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.collaborators enable row level security;

create policy "colaboradores: acesso conforme módulo"
  on public.collaborators for all
  using (public.has_module_access('colaboradores'))
  with check (public.has_module_access('colaboradores'));

-- ============================================================
-- ACESSO PÚBLICO (sem login) — o colaborador recebe um link com
-- um token secreto e só consegue ver/editar o próprio cadastro.
-- ============================================================
create or replace function public.get_collaborator_by_token(p_token uuid)
returns public.collaborators
language sql
security definer
set search_path = public
as $$
  select * from public.collaborators where public_token = p_token limit 1;
$$;

create or replace function public.update_collaborator_by_token(p_token uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.collaborators set
    birth_date = coalesce((p_data->>'birth_date')::date, birth_date),
    cpf = coalesce(p_data->>'cpf', cpf),
    rg = coalesce(p_data->>'rg', rg),
    marital_status = coalesce(p_data->>'marital_status', marital_status),
    nationality = coalesce(p_data->>'nationality', nationality),
    personal_phone = coalesce(p_data->>'personal_phone', personal_phone),
    personal_email = coalesce(p_data->>'personal_email', personal_email),
    emergency_name = coalesce(p_data->>'emergency_name', emergency_name),
    emergency_relationship = coalesce(p_data->>'emergency_relationship', emergency_relationship),
    emergency_phone = coalesce(p_data->>'emergency_phone', emergency_phone),
    address_street = coalesce(p_data->>'address_street', address_street),
    address_number = coalesce(p_data->>'address_number', address_number),
    address_complement = coalesce(p_data->>'address_complement', address_complement),
    address_neighborhood = coalesce(p_data->>'address_neighborhood', address_neighborhood),
    address_city = coalesce(p_data->>'address_city', address_city),
    address_state = coalesce(p_data->>'address_state', address_state),
    address_zip = coalesce(p_data->>'address_zip', address_zip),
    id_document_path = coalesce(p_data->>'id_document_path', id_document_path),
    address_proof_path = coalesce(p_data->>'address_proof_path', address_proof_path),
    photo_path = coalesce(p_data->>'photo_path', photo_path),
    resume_path = coalesce(p_data->>'resume_path', resume_path),
    work_card_path = coalesce(p_data->>'work_card_path', work_card_path),
    status = 'Preenchido pelo colaborador',
    updated_at = now()
  where public_token = p_token;
end;
$$;

grant execute on function public.get_collaborator_by_token(uuid) to anon;
grant execute on function public.update_collaborator_by_token(uuid, jsonb) to anon;

-- ============================================================
-- ARMAZENAMENTO DOS DOCUMENTOS DO COLABORADOR
-- ============================================================
insert into storage.buckets (id, name, public)
values ('collaborator-documents', 'collaborator-documents', false)
on conflict (id) do nothing;

create policy "collaborator-documents: equipe lê"
  on storage.objects for select
  using (bucket_id = 'collaborator-documents' and public.has_module_access('colaboradores'));

create policy "collaborator-documents: equipe envia"
  on storage.objects for insert
  with check (bucket_id = 'collaborator-documents' and public.has_module_access('colaboradores'));

create policy "collaborator-documents: equipe atualiza"
  on storage.objects for update
  using (bucket_id = 'collaborator-documents' and public.has_module_access('colaboradores'));

create policy "collaborator-documents: equipe exclui"
  on storage.objects for delete
  using (bucket_id = 'collaborator-documents' and public.has_module_access('colaboradores'));

-- o colaborador (sem login) também pode enviar documentos pelo link
-- público; não consegue listar, baixar ou apagar arquivos de outros.
create policy "collaborator-documents: colaborador envia pelo link público"
  on storage.objects for insert
  with check (bucket_id = 'collaborator-documents' and auth.role() = 'anon');
