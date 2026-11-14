-- ============================================================
-- MIGRAÇÃO 130 — Dupla função com qualquer função (não só Influencer)
-- profiles.secondary_role guarda a segunda função (opcional). A principal (role) continua mandando
-- nas regras de dono (ex.: Consultor só vê os próprios leads). As permissões de módulo somam
-- as da principal com as da segunda. ADM não pode ser segunda função (já tem tudo).
-- also_influencer (migração 069) é migrado para secondary_role = 'Influencer' e deixa de ser usado.
-- ============================================================

alter table public.profiles add column if not exists secondary_role text;

alter table public.profiles drop constraint if exists profiles_secondary_role_check;
alter table public.profiles add constraint profiles_secondary_role_check
  check (secondary_role is null or secondary_role in ('Gerente', 'Consultor', 'Influencer', 'MKT', 'Financeiro', 'Suporte'));

alter table public.profiles drop constraint if exists profiles_secondary_differs;
alter table public.profiles add constraint profiles_secondary_differs
  check (secondary_role is null or secondary_role <> role);

update public.profiles set secondary_role = 'Influencer'
 where also_influencer and role <> 'Influencer' and secondary_role is null;

create or replace function public.has_module_access(mod text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_role_name() = 'ADM' then true
    else coalesce(
      (select bool_or(rp.allowed) from public.role_permissions rp
        where rp.module = mod
          and rp.role in (
            public.current_role_name(),
            (select p.secondary_role from public.profiles p where p.id = auth.uid())
          )),
      false)
  end;
$$;
