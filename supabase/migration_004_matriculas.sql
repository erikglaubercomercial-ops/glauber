-- ============================================================
-- MIGRAÇÃO 004 — módulo Matrículas: dados do aluno (documentos,
-- endereço, escola/turno escolhidos) + link público para o
-- próprio aluno preencher, sem precisar de login.
-- Rode este arquivo no Supabase: SQL Editor → New query → Run
-- ============================================================

-- ---------- libera o módulo "matriculas" nas permissões por função ----------
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
  check (module in ('leads','pipeline','cotacao','produtos','financeiro','matriculas'));

insert into public.role_permissions (role, module, allowed) values
  ('Gerente','matriculas', true),
  ('Consultor','matriculas', true),
  ('Influencer','matriculas', false),
  ('MKT','matriculas', false),
  ('Financeiro','matriculas', false)
on conflict (role, module) do nothing;

-- ---------- matrículas ----------
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  consultor_id uuid references public.profiles(id) on delete set null,

  name text not null default '',
  email text default '',
  phone text default '',
  emergency_phone text default '',

  passport_number text default '',
  passport_photo_path text,
  cpf text default '',

  address_street text default '',
  address_number text default '',
  address_complement text default '',
  address_neighborhood text default '',
  address_city text default '',
  address_state text default '',
  address_zip text default '',

  school text default '',
  turno text default '',
  course_value numeric(12,2) not null default 0,
  arrival_date date,
  class_start_date date,

  status text not null default 'Aguardando aluno'
    check (status in ('Aguardando aluno','Preenchido pelo aluno','Completo')),

  public_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.enrollments enable row level security;

create policy "matriculas: ver conforme função e atribuição"
  on public.enrollments for select
  using (
    public.has_module_access('matriculas')
    and (public.current_role_name() <> 'Consultor' or consultor_id = auth.uid())
  );

create policy "matriculas: criar quem acessa o módulo"
  on public.enrollments for insert
  with check (public.has_module_access('matriculas'));

create policy "matriculas: editar conforme função e atribuição"
  on public.enrollments for update
  using (
    public.has_module_access('matriculas')
    and (public.current_role_name() <> 'Consultor' or consultor_id = auth.uid())
  );

create policy "matriculas: excluir conforme função e atribuição"
  on public.enrollments for delete
  using (
    public.has_module_access('matriculas')
    and (public.current_role_name() <> 'Consultor' or consultor_id = auth.uid())
  );

-- ============================================================
-- ACESSO PÚBLICO (sem login) — o aluno recebe um link com um
-- token secreto e só consegue ver/editar a própria matrícula.
-- Feito via funções (não via RLS direta na tabela), então o
-- token nunca dá acesso a listar ou ver as matrículas de outros
-- alunos.
-- ============================================================
create or replace function public.get_enrollment_by_token(p_token uuid)
returns public.enrollments
language sql
security definer
set search_path = public
as $$
  select * from public.enrollments where public_token = p_token limit 1;
$$;

create or replace function public.update_enrollment_by_token(p_token uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.enrollments set
    emergency_phone = coalesce(p_data->>'emergency_phone', emergency_phone),
    passport_number = coalesce(p_data->>'passport_number', passport_number),
    passport_photo_path = coalesce(p_data->>'passport_photo_path', passport_photo_path),
    cpf = coalesce(p_data->>'cpf', cpf),
    address_street = coalesce(p_data->>'address_street', address_street),
    address_number = coalesce(p_data->>'address_number', address_number),
    address_complement = coalesce(p_data->>'address_complement', address_complement),
    address_neighborhood = coalesce(p_data->>'address_neighborhood', address_neighborhood),
    address_city = coalesce(p_data->>'address_city', address_city),
    address_state = coalesce(p_data->>'address_state', address_state),
    address_zip = coalesce(p_data->>'address_zip', address_zip),
    status = 'Preenchido pelo aluno',
    updated_at = now()
  where public_token = p_token;
end;
$$;

grant execute on function public.get_enrollment_by_token(uuid) to anon;
grant execute on function public.update_enrollment_by_token(uuid, jsonb) to anon;

-- ============================================================
-- ARMAZENAMENTO DA FOTO DO PASSAPORTE
-- ============================================================
insert into storage.buckets (id, name, public)
values ('passport-photos', 'passport-photos', false)
on conflict (id) do nothing;

create policy "passport-photos: equipe lê"
  on storage.objects for select
  using (bucket_id = 'passport-photos' and public.has_module_access('matriculas'));

create policy "passport-photos: equipe envia"
  on storage.objects for insert
  with check (bucket_id = 'passport-photos' and public.has_module_access('matriculas'));

create policy "passport-photos: equipe atualiza"
  on storage.objects for update
  using (bucket_id = 'passport-photos' and public.has_module_access('matriculas'));

create policy "passport-photos: equipe exclui"
  on storage.objects for delete
  using (bucket_id = 'passport-photos' and public.has_module_access('matriculas'));

-- o aluno (sem login) também pode enviar a foto pelo link público;
-- ele não consegue listar, baixar ou apagar arquivos de outros alunos.
create policy "passport-photos: aluno envia pelo link público"
  on storage.objects for insert
  with check (bucket_id = 'passport-photos' and auth.role() = 'anon');
