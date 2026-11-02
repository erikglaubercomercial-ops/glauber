-- ============================================================
-- MIGRAÇÃO 103 — Partilha por venda: kit e acomodação.
-- • Kit adicional (item com "kit" no nome da cotação) NÃO é lucro da Peregrinos: aparece em coluna própria e fica fora da base.
-- • Acomodação: aparece como referência (cobrado, pago, lucro). Só o LUCRO (cobrado − pago) entra no ganho da Peregrinos.
-- • Custo padrão da acomodação: R$ 160 por semana (semanas = quantidade da acomodação na cotação), editável. Vale para vendas novas
--   quando o custo ainda está zerado; o campo continua editável na tela Financeiro › Acomodação.
-- • A taxa da plataforma continua sendo aplicada só sobre o curso.
-- ============================================================
alter table public.sale_splits
  add column if not exists kit_amount numeric not null default 0,
  add column if not exists acom_cobrado numeric not null default 0,
  add column if not exists acom_pago numeric not null default 0,
  add column if not exists acom_lucro numeric not null default 0;

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
  v_quote uuid;
  v_kit numeric := 0;
  v_cob numeric := 0;
  v_pago numeric := 0;
  v_lucro numeric;
  v_course numeric;
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

  -- cotação da venda: a do contrato assinado mais recente; se não houver, a cotação mais recente do lead
  select c.quote_id into v_quote from public.contracts c
   where c.lead_id = d.lead_id and c.status = 'Assinado' and c.modo = 'proposta' and c.quote_id is not null
   order by c.signed_at desc nulls last limit 1;
  if v_quote is null then
    select q.id into v_quote from public.quotes q where q.lead_id = d.lead_id order by q.created_at desc limit 1;
  end if;
  if v_quote is not null then
    select coalesce(sum((it ->> 'total')::numeric), 0) into v_kit
    from public.quotes q, jsonb_array_elements(coalesce(q.items_detail, '[]'::jsonb)) it
    where q.id = v_quote and (it ->> 'nome') ilike '%kit%';
  end if;

  -- acomodação: cobrado, pago e lucro
  select coalesce(sum(a.sold_amount), 0), coalesce(sum(a.cost_amount), 0) into v_cob, v_pago
  from public.accommodation_sales a join public.enrollments e on e.id = a.enrollment_id
  where e.lead_id = d.lead_id;
  v_lucro := v_cob - v_pago;

  -- base: curso (sem kit e sem acomodação) menos a taxa da plataforma, mais o lucro da acomodação
  v_course := greatest(coalesce(d.value, 0) - v_kit - v_cob, 0);
  v_base := greatest(v_course - s.platform_fee, 0) + greatest(v_lucro, 0);
  v_gross := round(v_base * s.platform_pct / 100, 2);
  v_cons := round(v_gross * s.default_percentage / 100, 2);
  v_mgr_amt := case when v_mgr is not null then s.manager_fixed else 0 end;

  insert into public.sale_splits (deal_id, course_total, fee, base, peregrinos_gross, consultor_amount, manager_id, manager_amount,
                                  cac_amount, peregrinos_net, kit_amount, acom_cobrado, acom_pago, acom_lucro, updated_at)
  values (d.id, coalesce(d.value, 0), s.platform_fee, v_base, v_gross, v_cons, v_mgr, v_mgr_amt, s.cac_fixed,
          v_gross - v_cons - v_mgr_amt - s.cac_fixed, v_kit, v_cob, v_pago, v_lucro, now())
  on conflict (deal_id) do update set
    course_total = excluded.course_total, fee = excluded.fee, base = excluded.base,
    peregrinos_gross = excluded.peregrinos_gross, consultor_amount = excluded.consultor_amount,
    manager_id = excluded.manager_id, manager_amount = excluded.manager_amount,
    cac_amount = excluded.cac_amount, peregrinos_net = excluded.peregrinos_net,
    kit_amount = excluded.kit_amount, acom_cobrado = excluded.acom_cobrado, acom_pago = excluded.acom_pago,
    acom_lucro = excluded.acom_lucro, updated_at = now();

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

-- custo padrão da acomodação: R$ 160 por semana, só quando o custo ainda não foi informado (editável depois)
create or replace function public.acom_custo_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid;
  v_weeks numeric := 0;
begin
  if coalesce(new.cost_amount, 0) <> 0 or new.enrollment_id is null then return new; end if;
  select e.lead_id into v_lead from public.enrollments e where e.id = new.enrollment_id;
  if v_lead is null then return new; end if;
  select coalesce(sum((it ->> 'qtd')::numeric), 0) into v_weeks
  from public.quotes q, jsonb_array_elements(coalesce(q.items_detail, '[]'::jsonb)) it
  where q.id = (select q2.id from public.quotes q2 where q2.lead_id = v_lead order by q2.created_at desc limit 1)
    and (it ->> 'nome') ~* 'accommodation|acomoda';
  if v_weeks > 0 then
    new.cost_amount := 160 * v_weeks;
    new.notes := 'Custo padrão de € 160 por semana (' || v_weeks || ' semana(s)). Editável.';
  end if;
  return new;
end;
$$;
drop trigger if exists accommodation_sales_custo_padrao on public.accommodation_sales;
create trigger accommodation_sales_custo_padrao before insert on public.accommodation_sales
  for each row execute function public.acom_custo_padrao();
