-- ============================================================
-- MIGRAÇÃO 134 — Comissão de acomodação retida até o cliente quitar o curso + Budget MKT
-- • A comissão do consultor sobre a acomodação (% do lucro = venda − custo) só pode ser marcada
--   como paga depois que o cliente quitou o valor total do curso (parcelas pagas >= valor do negócio).
--   A regra antiga (custo já enviado à acomodação) continua valendo, as duas precisam estar cumpridas.
-- • "Caixa reserva" deixa de misturar destinos: reserva_amount passa a ser só o CAC de € 100 que sobrou
--   (venda sem tráfego pago e sem influenciador) = Budget MKT. A sobra do curso (sobra_amount) fica
--   separada, nunca mais somada na reserva.
-- ============================================================

create or replace function public.cliente_quitou_curso(p_enrollment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select d.value > 0
       and coalesce((select sum(r.amount) from public.receivables r where r.deal_id = d.id and r.paid), 0) + 0.005 >= d.value
      from public.enrollments e
      join public.deals d on d.lead_id = e.lead_id
     where e.id = p_enrollment
     limit 1
  ), false);
$$;
revoke all on function public.cliente_quitou_curso(uuid) from public, anon;
grant execute on function public.cliente_quitou_curso(uuid) to authenticated;

create or replace function public.accommodation_commission_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_sent numeric;
begin
  if new.commission_status = 'Pago' and (tg_op = 'INSERT' or old.commission_status is distinct from 'Pago') then
    select coalesce(sum(amount), 0) into v_sent from public.accommodation_transfers where accommodation_id = new.id;
    if v_sent < new.cost_amount then raise exception 'comissao_acomodacao_nao_liberada'; end if;
    if not public.cliente_quitou_curso(new.enrollment_id) then raise exception 'comissao_acomodacao_nao_liberada_cliente_nao_quitou'; end if;
  end if;
  return new;
end;
$$;

-- reserva_amount = só o CAC que sobrou (Budget MKT)
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.apply_sale_rules(uuid)'::regprocedure);
  v_new := replace(v_def, 'v_reserva_cac + v_sobra', 'v_reserva_cac');
  if v_new = v_def then raise exception 'trecho_nao_encontrado_em_apply_sale_rules'; end if;
  execute v_new;
end;
$$;

-- recalcula as vendas ganhas que tinham sobra do curso (hoje só uma)
do $$
declare r record;
begin
  for r in select deal_id from public.sale_splits where sobra_amount <> 0 loop
    perform public.apply_sale_rules(r.deal_id);
  end loop;
end;
$$;
