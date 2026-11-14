-- ============================================================
-- MIGRAÇÃO 131 — Influenciador pendente aparece na partilha
-- • Venda com fonte de influenciador e comissão do influenciador ainda não paga: o valor fixo
--   (CAC fixo, R$ 100) vai para a coluna do influenciador e a venda fica marcada como pendente.
-- • Quando a comissão é paga (ou lançada), a partilha é recalculada e a marcação sai.
-- • O CAC continua zerado nessas vendas (a regra põe o valor em um ou em outro).
-- ============================================================

alter table public.sale_splits add column if not exists influencer_pendente boolean not null default false;

do $mig$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.apply_sale_rules(uuid)'::regprocedure);
  if position('v_infl_pendente' in v_def) = 0 then
    v_def := replace(v_def, E'  v_result numeric := 0;\nbegin', E'  v_result numeric := 0;\n  v_infl_pendente boolean := false;\nbegin');
    v_def := replace(v_def, E'  v_traffic := v_influencer or v_paid;\n',
      E'  v_traffic := v_influencer or v_paid;\n  v_infl_pendente := v_influencer and not exists (select 1 from public.influencer_commissions ic2 where ic2.deal_id = d.id and ic2.status = ''Pago'');\n  if v_influencer and v_infl = 0 then v_infl := coalesce(s.cac_fixed, 0); end if;\n');
    v_def := replace(v_def, E'acom_consultor, updated_at)\n  values', E'acom_consultor, updated_at, influencer_pendente)\n  values');
    v_def := replace(v_def, E'v_acom_cons, now())\n  on conflict', E'v_acom_cons, now(), v_infl_pendente)\n  on conflict');
    v_def := replace(v_def, E'acom_consultor = excluded.acom_consultor, updated_at = now();', E'acom_consultor = excluded.acom_consultor, influencer_pendente = excluded.influencer_pendente, updated_at = now();');
    if position('v_infl_pendente' in v_def) = 0 or position('influencer_pendente = excluded' in v_def) = 0 or position('now(), v_infl_pendente)' in v_def) = 0 then
      raise exception 'não consegui aplicar a alteração em apply_sale_rules: o texto da função mudou';
    end if;
    execute v_def;
  end if;
end
$mig$;

create or replace function public.influencer_commissions_recalcula()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.apply_sale_rules(coalesce(new.deal_id, old.deal_id));
  return coalesce(new, old);
end;
$$;
drop trigger if exists influencer_commissions_recalcula on public.influencer_commissions;
create trigger influencer_commissions_recalcula after insert or update or delete on public.influencer_commissions
  for each row execute function public.influencer_commissions_recalcula();
