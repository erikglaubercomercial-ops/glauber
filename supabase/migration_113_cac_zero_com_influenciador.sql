-- ============================================================
-- MIGRAÇÃO 113 — CAC zerado quando há influenciador.
-- Com influenciador (comissão lançada ou origem de influenciador) o CAC de € 100 não é cobrado: a comissão do influenciador
-- já paga esse custo. Só tráfego pago, sem influenciador, mantém o CAC como custo. Sem nenhum dos dois, os € 100 vão para
-- a caixa de reserva (como antes).
-- ============================================================
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
  v_default_mgr uuid;
  v_quote uuid;
  v_net numeric;
  v_custo_in numeric;
  v_pass_manual numeric;
  v_kit numeric := 0;
  v_pass_quote numeric := 0;
  v_pass numeric := 0;
  v_cob numeric := 0;
  v_pago numeric := 0;
  v_acom_cons numeric := 0;
  v_infl numeric := 0;
  v_traffic boolean := false;
  v_influencer boolean := false;
  v_paid boolean := false;
  v_course_gross numeric;
  v_custo numeric;
  v_sobra numeric := 0;
  v_ganho_curso numeric := 0;
  v_ganho_acom numeric := 0;
  v_ganho_total numeric := 0;
  v_cons_venda numeric := 0;
  v_cons_pass numeric := 0;
  v_cons numeric := 0;
  v_cac numeric := 0;
  v_reserva_cac numeric := 0;
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
  select p.id into v_default_mgr from public.profiles p
   where p.email = 'commercial@peregrinosintercambio.com' and p.role = 'Gerente' and p.active limit 1;
  if v_mgr is null then v_mgr := v_default_mgr; end if;

  select ss.net_course, ss.custo_curso, ss.passagem_manual into v_net, v_custo_in, v_pass_manual
    from public.sale_splits ss where ss.deal_id = d.id;

  select c.quote_id into v_quote from public.contracts c
   where c.lead_id = d.lead_id and c.status = 'Assinado' and c.modo = 'proposta' and c.quote_id is not null
   order by c.signed_at desc nulls last limit 1;
  if v_quote is null then
    select q.id into v_quote from public.quotes q where q.lead_id = d.lead_id order by q.created_at desc limit 1;
  end if;
  if v_quote is not null then
    select coalesce(sum((it ->> 'total')::numeric) filter (where (it ->> 'nome') ilike '%kit%'), 0),
           coalesce(sum((it ->> 'total')::numeric) filter (where (it ->> 'nome') ilike '%passagem%'), 0)
      into v_kit, v_pass_quote
    from public.quotes q, jsonb_array_elements(coalesce(q.items_detail, '[]'::jsonb)) it
    where q.id = v_quote;
  end if;
  v_pass := coalesce(v_pass_manual, v_pass_quote);

  select coalesce(sum(a.sold_amount), 0), coalesce(sum(a.cost_amount), 0),
         coalesce(sum(greatest(a.sold_amount - a.cost_amount, 0) * a.commission_pct / 100), 0)
    into v_cob, v_pago, v_acom_cons
  from public.accommodation_sales a join public.enrollments e on e.id = a.enrollment_id
  where e.lead_id = d.lead_id;

  select coalesce(sum(ic.amount), 0) into v_infl from public.influencer_commissions ic where ic.deal_id = d.id;
  v_influencer := v_infl > 0
    or exists (select 1 from public.lead_sources ls where ls.name in (l.source, coalesce(l.source2, '')) and ls.is_influencer);
  v_paid := exists (select 1 from public.lead_sources ls where ls.name in (l.source, coalesce(l.source2, '')) and ls.is_paid);
  v_traffic := v_influencer or v_paid;

  -- valor vendido do curso (sem kit, passagem da cotação e acomodação)
  v_course_gross := greatest(coalesce(d.value, 0) - v_kit - v_pass_quote - v_cob, 0);
  v_custo := coalesce(v_custo_in, v_course_gross);
  v_sobra := round(v_course_gross - v_custo, 2);
  v_reserva_cac := case when v_traffic then 0 else s.cac_fixed end;
  -- com influenciador o CAC é zerado (a comissão do influenciador paga esse custo); só tráfego pago mantém o CAC
  v_cac := case when v_influencer then 0 when v_paid then s.cac_fixed else 0 end;

  if v_net is not null then
    v_ganho_curso := v_custo - v_net;
    v_ganho_acom := v_cob - v_pago;
    v_ganho_total := v_ganho_curso + v_ganho_acom + v_pass;
    v_cons_venda := round((v_ganho_curso + v_pass) * s.default_percentage / 100, 2);
    v_cons_pass := round(v_pass * s.default_percentage / 100, 2);
    v_cons := round(v_cons_venda + v_acom_cons, 2);
    v_base_g := v_ganho_total - v_cac - v_reserva_cac - v_cons - v_infl;
    v_mgr_amt := case when v_mgr is not null then round(greatest(v_base_g, 0) * 0.20, 2) else 0 end;
    v_result := v_base_g - v_mgr_amt;
  end if;

  insert into public.sale_splits (deal_id, course_total, fee, base, peregrinos_gross, consultor_amount, manager_id, manager_amount,
                                  cac_amount, peregrinos_net, kit_amount, acom_cobrado, acom_pago, acom_lucro, course_gross,
                                  ganho_curso, passagem_amount, traffic_flag, influencer_amount, reserva_amount,
                                  sobra_amount, cons_curso, cons_passagem, acom_consultor, updated_at)
  values (d.id, coalesce(d.value, 0), 0, v_ganho_total, v_ganho_total, v_cons, v_mgr, v_mgr_amt,
          v_cac, v_result, v_kit, v_cob, v_pago, v_cob - v_pago, v_course_gross,
          v_ganho_curso, v_pass, v_traffic, v_infl, v_reserva_cac + v_sobra,
          v_sobra, v_cons_venda - v_cons_pass, v_cons_pass, v_acom_cons, now())
  on conflict (deal_id) do update set
    course_total = excluded.course_total, fee = 0, base = excluded.base,
    peregrinos_gross = excluded.peregrinos_gross, consultor_amount = excluded.consultor_amount,
    manager_id = excluded.manager_id, manager_amount = excluded.manager_amount,
    cac_amount = excluded.cac_amount, peregrinos_net = excluded.peregrinos_net,
    kit_amount = excluded.kit_amount, acom_cobrado = excluded.acom_cobrado, acom_pago = excluded.acom_pago,
    acom_lucro = excluded.acom_lucro, course_gross = excluded.course_gross, ganho_curso = excluded.ganho_curso,
    passagem_amount = excluded.passagem_amount, traffic_flag = excluded.traffic_flag,
    influencer_amount = excluded.influencer_amount, reserva_amount = excluded.reserva_amount,
    sobra_amount = excluded.sobra_amount, cons_curso = excluded.cons_curso, cons_passagem = excluded.cons_passagem,
    acom_consultor = excluded.acom_consultor, updated_at = now();

  if v_net is not null then
    if exists (select 1 from public.commissions where deal_id = d.id) then
      update public.commissions set
        consultor_id = v_consultor, deal_name = d.name, deal_value = coalesce(d.value, 0),
        percentage = s.default_percentage, amount = v_cons_venda
      where deal_id = d.id and status <> 'Pago';
    else
      insert into public.commissions (deal_id, consultor_id, deal_name, deal_value, percentage, amount, status)
      values (d.id, v_consultor, d.name, coalesce(d.value, 0), s.default_percentage, v_cons_venda, 'Pendente');
    end if;
  end if;
end;
$$;
revoke all on function public.apply_sale_rules(uuid) from public, anon, authenticated;

