-- ============================================================
-- MIGRAÇÃO 047 — regras de partilha da venda e automação do contrato assinado.
--
-- Fórmula (valores configuráveis em commission_settings):
--   base                = valor total do curso − taxa (€ 530)
--   ganho da Peregrinos = 25% da base                       (platform_pct)
--   comissão consultor  = 25% do ganho da Peregrinos        (default_percentage)
--   gerente do time     = € 100 fixos por venda             (manager_fixed), se o
--                         consultor tiver gerente (profiles.manager_id)
--   CAC                 = € 100 fixos por venda, provisório (cac_fixed)
--   sobra da Peregrinos = ganho − comissão − gerente − CAC
-- Todas as comissões saem do ganho da Peregrinos.
-- O consultor só recebe a comissão depois que o cliente pagou € 500
-- (release_min_paid): antes disso ela não pode ser marcada como paga.
--
-- Automação: quando o contrato é assinado, o negócio do lead vai para "Venda"
-- com o valor da cotação e a comissão é gerada pela fórmula acima.
-- A partilha completa fica em sale_splits, visível só para quem acessa o
-- Financeiro; o consultor enxerga apenas a própria comissão (tabela commissions).
-- ============================================================

alter table public.commission_settings
  add column if not exists platform_fee numeric(12,2) not null default 530,
  add column if not exists platform_pct numeric(5,2) not null default 25,
  add column if not exists manager_fixed numeric(12,2) not null default 100,
  add column if not exists cac_fixed numeric(12,2) not null default 100,
  add column if not exists release_min_paid numeric(12,2) not null default 500;

alter table public.profiles
  add column if not exists manager_id uuid references public.profiles(id) on delete set null;

create table public.sale_splits (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  course_total numeric(12,2) not null default 0,
  fee numeric(12,2) not null default 0,
  base numeric(12,2) not null default 0,
  peregrinos_gross numeric(12,2) not null default 0,
  consultor_amount numeric(12,2) not null default 0,
  manager_id uuid references public.profiles(id) on delete set null,
  manager_amount numeric(12,2) not null default 0,
  cac_amount numeric(12,2) not null default 0,
  peregrinos_net numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.sale_splits enable row level security;
create policy "sale_splits: leitura financeiro"
  on public.sale_splits for select
  using (public.has_module_access('financeiro'));

create or replace function public.won_stage_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id from public.pipeline_stages where is_won limit 1;
$$;

-- aplica a fórmula a um negócio que está em Venda
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
  select manager_id into v_mgr from public.profiles where id = v_consultor;

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

create or replace function public.deals_aplica_regras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage is not distinct from public.won_stage_id() then
    perform public.apply_sale_rules(new.id);
  end if;
  return null;
end;
$$;
create trigger deals_aplica_regras
  after insert or update of stage, value, consultor_id, lead_id on public.deals
  for each row execute function public.deals_aplica_regras();

-- cliente já pagou o mínimo de matrícula? (libera a comissão do consultor)
create or replace function public.commission_released(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(r.amount) from public.receivables r where r.deal_id = p_deal_id and r.paid), 0)
         >= (select release_min_paid from public.commission_settings where id = 1);
$$;
revoke all on function public.commission_released(uuid) from public, anon;
grant execute on function public.commission_released(uuid) to authenticated;

create or replace function public.commissions_guard_pagamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'Pago' and old.status is distinct from 'Pago' and not public.commission_released(new.deal_id) then
    raise exception 'comissao_nao_liberada';
  end if;
  return new;
end;
$$;
create trigger commissions_guard_pagamento
  before update on public.commissions
  for each row execute function public.commissions_guard_pagamento();

-- contrato assinado => negócio do lead vira Venda com o valor da cotação
create or replace function public.sale_from_contract(p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contracts;
  q public.quotes;
  l public.leads;
  v_deal uuid;
  v_won text := public.won_stage_id();
begin
  select * into c from public.contracts where id = p_contract_id;
  if not found or c.modo <> 'proposta' or c.status <> 'Assinado' or c.lead_id is null then
    return;
  end if;
  select * into q from public.quotes where id = c.quote_id;
  select * into l from public.leads where id = c.lead_id;

  select id into v_deal from public.deals where lead_id = c.lead_id order by created_at desc limit 1;
  if v_deal is null then
    insert into public.deals (name, value, stage, lead_id, consultor_id, closed_at)
    values (l.name, coalesce(q.value, 0), v_won, c.lead_id, l.consultor_id, now());
  else
    update public.deals set
      stage = v_won,
      value = coalesce(q.value, value),
      closed_at = coalesce(closed_at, now())
    where id = v_deal;
  end if;
end;
$$;
revoke all on function public.sale_from_contract(uuid) from public, anon, authenticated;

create or replace function public.contracts_cria_matricula()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.modo = 'proposta' and new.status = 'Assinado' and old.status is distinct from 'Assinado' then
    perform public.matricula_from_contract(new.id);
    perform public.sale_from_contract(new.id);
  end if;
  return new;
end;
$$;

-- corrige a venda do Matheus Govaski (comissão anterior era 25% do total, sem taxa e sem a regra nova)
select public.apply_sale_rules('7a845b7e-93dd-453e-8c8c-41ab726b5795');
