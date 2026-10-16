-- ============================================================
-- MIGRAÇÃO 069 — Dupla função: Consultor (ou Gerente) que também é Influencer.
-- profiles.also_influencer marca a segunda função; a função principal continua mandando
-- (um Consultor segue vendo só os próprios leads). has_module_access passa a somar as
-- permissões da função principal com as de Influencer quando a marca está ligada.
-- Só o ADM altera (política de perfis já existente).
-- ============================================================
alter table public.profiles add column if not exists also_influencer boolean not null default false;

create or replace function public.has_module_access(mod text)
returns boolean as $$
  select case
    when public.current_role_name() = 'ADM' then true
    else coalesce(
      (select bool_or(rp.allowed) from public.role_permissions rp
       where rp.module = mod
         and (rp.role = public.current_role_name()
              or (rp.role = 'Influencer'
                  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.also_influencer)))),
      false
    )
  end;
$$ language sql stable security definer set search_path = public;
