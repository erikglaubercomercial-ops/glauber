-- ============================================================
-- MIGRAÇÃO 052 — times (Brasil e Time Latinos).
--
-- • teams: nome, gerente e países do time (códigos ISO dos países do lead)
-- • profiles.team_id: o time de cada consultor
-- • O gerente do time recebe os € 100 fixos por venda dos consultores do time
--   (a venda do próprio gerente não paga a taxa de gerente a ele mesmo).
--   Substitui o antigo profiles.manager_id (que deixa de ser usado).
--
-- Times criados agora:
--   Brasil        gerente Erik      países: BR
--   Time Latinos  gerente Anderson  países: MX, CL, AR
--   Consultores do Time Latinos: Anderson Enande, nicole.castillejov, medinafacu96
--   Demais consultores (e o Erik): Time Brasil
-- ============================================================

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  manager_id uuid references public.profiles(id) on delete set null,
  countries text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.teams enable row level security;
create policy "teams: leitura" on public.teams for select using (auth.role() = 'authenticated');
create policy "teams: só ADM altera" on public.teams for all
  using (public.current_role_name() = 'ADM') with check (public.current_role_name() = 'ADM');

alter table public.profiles add column if not exists team_id uuid references public.teams(id) on delete set null;

insert into public.teams (name, manager_id, countries)
select 'Brasil', (select id from public.profiles where name = 'Erik' and role = 'Gerente'), array['BR'];
insert into public.teams (name, manager_id, countries)
select 'Time Latinos', (select id from public.profiles where name = 'Anderson Enande'), array['MX', 'CL', 'AR'];

update public.profiles set team_id = (select id from public.teams where name = 'Time Latinos')
where name in ('Anderson Enande', 'nicole.castillejov', 'medinafacu96');
update public.profiles set team_id = (select id from public.teams where name = 'Brasil')
where (role = 'Consultor' or (role = 'Gerente' and name = 'Erik')) and team_id is null;

-- gerente do time vem do time do consultor
create or replace function public.apply_sale_rules(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.deals;
  s public.commission_settings;
  l public.leads;
  v_consultor uuid;
  v_mgr uuid;
  v_base numeric;
  v_gross numeric;
  v_cons numeric;
  v_mgr_amt numeric;
begin
  select * into d from public.deals where id = p_deal_id;
  if not found or d.stage is distinct from public.won_stage_id() then
    return;
  end if;
  select * into s from public.commission_settings where id = 1;
  select * into l from public.leads where id = d.lead_id;
  v_consultor := coalesce(l.consultor_id, d.consultor_id);
  select t.manager_id into v_mgr
  from public.profiles p join public.teams t on t.id = p.team_id where p.id = v_consultor;
  if v_mgr is not distinct from v_consultor then v_mgr := null; end if;

  v_base := greatest(coalesce(d.value, 0) - s.platform_fee, 0);
  v_gross := round(v_base * s.platform_pct / 100, 2);
  v_cons := round(v_gross * s.default_percentage / 100, 2);
  v_mgr_amt := case when v_mgr is not null then s.manager_fixed else 0 end;

  insert into public.sale_splits (deal_id, course_total, fee, base, peregrinos_gross, consultor_amount, manager_id, manager_amount, cac_amount, peregrinos_net, updated_at)
  values (d.id, coalesce(d.value, 0), s.platform_fee, v_base, v_gross, v_cons, v_mgr, v_mgr_amt, s.cac_fixed,
          v_gross - v_cons - v_mgr_amt - s.cac_fixed, now())
  on conflict (deal_id) do update set
    course_total = excluded.course_total, fee = excluded.fee, base = excluded.base,
    peregrinos_gross = excluded.peregrinos_gross, consultor_amount = excluded.consultor_amount,
    manager_id = excluded.manager_id, manager_amount = excluded.manager_amount,
    cac_amount = excluded.cac_amount, peregrinos_net = excluded.peregrinos_net, updated_at = now();

  if exists (select 1 from public.commissions where deal_id = d.id) then
    update public.commissions set
      consultor_id = v_consultor, deal_name = d.name, deal_value = coalesce(d.value, 0),
      percentage = s.default_percentage, amount = v_cons
    where deal_id = d.id and status <> 'Pago';
  else
    insert into public.commissions (deal_id, consultor_id, deal_name, deal_value, percentage, amount, status)
    values (d.id, v_consultor, d.name, coalesce(d.value, 0), s.default_percentage, v_cons, 'Pendente');
  end if;
end;
$$;
revoke all on function public.apply_sale_rules(uuid) from public, anon, authenticated;
