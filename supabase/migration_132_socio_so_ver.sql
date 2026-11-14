-- ============================================================
-- MIGRAÇÃO 132 — Perfil Sócio: só vê (dupla função)
-- • "Sócio" é segunda função (profiles.secondary_role). Não tem permissões de módulo próprias.
-- • Recebe só uma política de LEITURA em cada tabela com acesso restrito. Nenhuma política de escrita muda.
-- • Quem edita continua com as permissões da função principal (ex.: Gerente).
-- • Fora da leitura: chaves de API, log de API, configurações do WhatsApp e mensagens internas (privadas).
-- ============================================================

alter table public.profiles drop constraint if exists profiles_secondary_role_check;
alter table public.profiles add constraint profiles_secondary_role_check
  check (secondary_role is null or secondary_role in ('Gerente', 'Consultor', 'Influencer', 'MKT', 'Financeiro', 'Suporte', 'Sócio'));

create or replace function public.is_socio()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.secondary_role = 'Sócio');
$$;
revoke all on function public.is_socio() from public, anon;
grant execute on function public.is_socio() to authenticated;

do $mig$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and c.relname not in ('api_keys', 'api_access_log', 'wa_settings')
       and c.relname not like 'internal\_%'
       and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
  loop
    execute format('drop policy if exists socio_pode_ver on public.%I', t.relname);
    execute format('create policy socio_pode_ver on public.%I for select to authenticated using (public.is_socio())', t.relname);
  end loop;
end
$mig$;
