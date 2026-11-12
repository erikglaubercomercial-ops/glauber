-- ============================================================
-- MIGRAÇÃO 124 — Partilha por venda: todas as células editáveis à mão, sem fórmula.
-- • manual_overrides (jsonb): o valor digitado em cada célula calculada. Enquanto houver valor digitado,
--   ele vale no lugar do cálculo, mesmo que a venda seja recalculada (trigger sale_splits_aplica_manual).
-- • Apagar a célula (set_sale_override com valor nulo) devolve o cálculo automático.
-- • A comissão do consultor digitada também vai para a tabela de comissões (ainda não paga).
-- • Quem altera: ADM, Gerente e Financeiro (mesmo critério do set_sale_input).
-- ============================================================
alter table public.sale_splits
  add column if not exists manual_overrides jsonb not null default '{}'::jsonb;

-- colunas que podem ser digitadas à mão (acom_ganho não é coluna: é a diferença acom. lucro − comissão, só guardada para a tela)
create or replace function public.sale_override_fields()
returns text[]
language sql immutable
as $$
  select array['course_gross','cac_amount','influencer_amount','cons_curso','manager_amount','reserva_amount',
               'acom_pago','acom_cobrado','acom_lucro','acom_consultor','acom_ganho','kit_amount','cons_passagem','peregrinos_net'];
$$;

create or replace function public.sale_splits_aplica_manual()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_ov jsonb;
begin
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_ov
    from jsonb_each(coalesce(new.manual_overrides, '{}'::jsonb)) as e(k, v)
   where k = any (public.sale_override_fields()) and k <> 'acom_ganho' and jsonb_typeof(v) = 'number';
  if v_ov <> '{}'::jsonb then
    new := jsonb_populate_record(new, v_ov);
  end if;
  return new;
end;
$$;
drop trigger if exists sale_splits_aplica_manual on public.sale_splits;
create trigger sale_splits_aplica_manual before insert or update on public.sale_splits
  for each row execute function public.sale_splits_aplica_manual();

-- grava (ou limpa, com valor nulo) o valor digitado de uma célula e recalcula a venda
create or replace function public.set_sale_override(p_deal_id uuid, p_field text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role_name() not in ('ADM', 'Gerente', 'Financeiro') then raise exception 'sem_permissao'; end if;
  if not (p_field = any (public.sale_override_fields())) then raise exception 'campo_invalido'; end if;
  update public.sale_splits
     set manual_overrides = case when p_value is null then manual_overrides - p_field
                                 else manual_overrides || jsonb_build_object(p_field, p_value) end
   where deal_id = p_deal_id;
  if not found then raise exception 'venda_sem_partilha'; end if;
  perform public.apply_sale_rules(p_deal_id);
end;
$$;
revoke all on function public.set_sale_override(uuid, text, numeric) from public, anon;
grant execute on function public.set_sale_override(uuid, text, numeric) to authenticated;

-- a comissão do consultor que vai para a tabela de comissões passa a respeitar o valor digitado
do $mig$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.apply_sale_rules(uuid)'::regprocedure);
  if position('v_sale_cons' in v_def) = 0 then
    v_def := replace(v_def, E'declare\n  d public.deals;', E'declare\n  v_sale_cons numeric;\n  d public.deals;');
    v_def := replace(v_def,
      E'  if v_net is not null then\n    if exists (select 1 from public.commissions where deal_id = d.id) then',
      E'  select ss.cons_curso + ss.cons_passagem into v_sale_cons from public.sale_splits ss where ss.deal_id = d.id;\n  v_cons_venda := coalesce(v_sale_cons, v_cons_venda);\n  if v_net is not null then\n    if exists (select 1 from public.commissions where deal_id = d.id) then');
    execute v_def;
  end if;
end
$mig$;
