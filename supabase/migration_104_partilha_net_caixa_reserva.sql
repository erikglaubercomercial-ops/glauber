-- ============================================================
-- MIGRAÇÃO 104 — Partilha por venda: Net digitado, caixa de reserva e regra final.
-- Regras:
-- • Ganho do curso = valor do curso (sem kit, sem acomodação, sem passagem) − Net digitado por venda.
-- • Acomodação: ganho = cobrado − pago (o consultor recebe o % da acomodação, padrão 40% do lucro).
-- • Passagem (parceiros): entra inteira no ganho (Net zero); consultor recebe 25%.
-- • Kit: não gera lucro (fica fora do ganho).
-- • CAC de € 100 sai em toda venda com tráfego pago ou influenciador. Sem tráfego nem influenciador, os € 100 vão para a
--   CAIXA DE RESERVA.
-- • Comissões: consultor do curso 25% do ganho do curso; influenciador é o valor lançado em influencer_commissions.
-- • Gerente: 20% do que sobra depois do CAC, das comissões e do influenciador.
-- • Net não digitado = venda pendente: nada é calculado (e a comissão existente não é alterada) — só a reserva é lançada.
-- ============================================================
alter table public.sale_splits
  add column if not exists course_gross numeric not null default 0,
  add column if not exists net_course numeric,
  add column if not exists ganho_curso numeric not null default 0,
  add column if not exists passagem_amount numeric not null default 0,
  add column if not exists traffic_flag boolean not null default false,
  add column if not exists influencer_amount numeric not null default 0,
  add column if not exists reserva_amount numeric not null default 0;

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
  v_net numeric;
  v_kit numeric := 0;
  v_pass numeric := 0;
  v_cob numeric := 0;
  v_pago numeric := 0;
  v_acom_cons numeric := 0;
  v_infl numeric := 0;
  v_traffic boolean := false;
  v_course_gross numeric;
  v_ganho_curso numeric := 0;
  v_ganho_acom numeric := 0;
  v_ganho_total numeric := 0;
  v_cons numeric := 0;
  v_cac numeric := 0;
  v_reserva numeric := 0;
  v_base_g numeric := 0;
  v_mgr_amt numeric := 0;
  v_result numeric := 0;
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

  select ss.net_course into v_net from public.sale_splits ss where ss.deal_id = d.id;

  -- cotação da venda: a do contrato assinado mais recente; se não houver, a mais recente do lead
  select c.quote_id into v_quote from public.contracts c
   where c.lead_id = d.lead_id and c.status = 'Assinado' and c.modo = 'proposta' and c.quote_id is not null
   order by c.signed_at desc nulls last limit 1;
  if v_quote is null then
    select q.id into v_quote from public.quotes q where q.lead_id = d.lead_id order by q.created_at desc limit 1;
  end if;
  if v_quote is not null then
    select coalesce(sum((it ->> 'total')::numeric) filter (where (it ->> 'nome') ilike '%kit%'), 0),
           coalesce(sum((it ->> 'total')::numeric) filter (where (it ->> 'nome') ilike '%passagem%'), 0)
      into v_kit, v_pass
    from public.quotes q, jsonb_array_elements(coalesce(q.items_detail, '[]'::jsonb)) it
    where q.id = v_quote;
  end if;

  -- acomodação: cobrado, pago, lucro e comissão do consultor sobre o lucro
  select coalesce(sum(a.sold_amount), 0), coalesce(sum(a.cost_amount), 0),
         coalesce(sum(greatest(a.sold_amount - a.cost_amount, 0) * a.commission_pct / 100), 0)
    into v_cob, v_pago, v_acom_cons
  from public.accommodation_sales a join public.enrollments e on e.id = a.enrollment_id
  where e.lead_id = d.lead_id;

  -- tráfego pago ou influenciador
  select coalesce(sum(ic.amount), 0) into v_infl from public.influencer_commissions ic where ic.deal_id = d.id;
  v_traffic := v_infl > 0
    or exists (select 1 from public.lead_sources ls where ls.name in (l.source, coalesce(l.source2, '')) and (ls.is_paid or ls.is_influencer));

  v_course_gross := greatest(coalesce(d.value, 0) - v_kit - v_pass - v_cob, 0);
  v_reserva := case when v_traffic then 0 else s.cac_fixed end;
  v_cac := case when v_traffic then s.cac_fixed else 0 end;

  if v_net is not null then
    v_ganho_curso := v_course_gross - v_net;
    v_ganho_acom := v_cob - v_pago;
    v_ganho_total := v_ganho_curso + v_ganho_acom + v_pass;
    v_cons := round(v_ganho_curso * s.default_percentage / 100 + v_pass * s.default_percentage / 100 + v_acom_cons, 2);
    v_base_g := v_ganho_total - v_cac - v_cons - v_infl;
    v_mgr_amt := case when v_mgr is not null then round(greatest(v_base_g, 0) * 0.20, 2) else 0 end;
    v_result := v_base_g - v_mgr_amt;
  end if;

  insert into public.sale_splits (deal_id, course_total, fee, base, peregrinos_gross, consultor_amount, manager_id, manager_amount,
                                  cac_amount, peregrinos_net, kit_amount, acom_cobrado, acom_pago, acom_lucro, course_gross,
                                  ganho_curso, passagem_amount, traffic_flag, influencer_amount, reserva_amount, updated_at)
  values (d.id, coalesce(d.value, 0), 0, v_ganho_total, v_ganho_total, v_cons, v_mgr, v_mgr_amt,
          v_cac, v_result, v_kit, v_cob, v_pago, v_cob - v_pago, v_course_gross,
          v_ganho_curso, v_pass, v_traffic, v_infl, v_reserva, now())
  on conflict (deal_id) do update set
    course_total = excluded.course_total, fee = 0, base = excluded.base,
    peregrinos_gross = excluded.peregrinos_gross, consultor_amount = excluded.consultor_amount,
    manager_id = excluded.manager_id, manager_amount = excluded.manager_amount,
    cac_amount = excluded.cac_amount, peregrinos_net = excluded.peregrinos_net,
    kit_amount = excluded.kit_amount, acom_cobrado = excluded.acom_cobrado, acom_pago = excluded.acom_pago,
    acom_lucro = excluded.acom_lucro, course_gross = excluded.course_gross, ganho_curso = excluded.ganho_curso,
    passagem_amount = excluded.passagem_amount, traffic_flag = excluded.traffic_flag,
    influencer_amount = excluded.influencer_amount, reserva_amount = excluded.reserva_amount, updated_at = now();

  -- comissões: só são calculadas quando o Net está digitado (venda pendente não mexe na comissão)
  if v_net is not null then
    if exists (select 1 from public.commissions where deal_id = d.id) then
      update public.commissions set
        consultor_id = v_consultor, deal_name = d.name, deal_value = coalesce(d.value, 0),
        percentage = s.default_percentage, amount = v_cons
      where deal_id = d.id and status <> 'Pago';
    else
      insert into public.commissions (deal_id, consultor_id, deal_name, deal_value, percentage, amount, status)
      values (d.id, v_consultor, d.name, coalesce(d.value, 0), s.default_percentage, v_cons, 'Pendente');
    end if;
  end if;
end;
$$;
revoke all on function public.apply_sale_rules(uuid) from public, anon, authenticated;

-- digitar o Net de uma venda (ADM, Gerente e Financeiro) e recalcular a partilha
create or replace function public.set_sale_net(p_deal_id uuid, p_net numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role_name() not in ('ADM', 'Gerente', 'Financeiro') then raise exception 'sem_permissao'; end if;
  if p_net is null or p_net < 0 then raise exception 'net_invalido'; end if;
  update public.sale_splits set net_course = p_net where deal_id = p_deal_id;
  if not found then raise exception 'venda_sem_partilha'; end if;
  perform public.apply_sale_rules(p_deal_id);
end;
$$;
revoke all on function public.set_sale_net(uuid, numeric) from public, anon;
grant execute on function public.set_sale_net(uuid, numeric) to authenticated;
