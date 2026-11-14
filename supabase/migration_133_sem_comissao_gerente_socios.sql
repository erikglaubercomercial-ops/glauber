-- ============================================================
-- MIGRAÇÃO 133 — Sócios gerentes fora da comissão de gerente
-- • profiles.sem_comissao_gerente marca quem não recebe comissão de gerente (os sócios Erik e Caio).
-- • Quando o gerente da venda tem essa marca, a comissão de gerente vai a zero (o valor fica com a Peregrinos).
-- • Vendas já fechadas com esses gerentes são recalculadas.
-- ============================================================

alter table public.profiles add column if not exists sem_comissao_gerente boolean not null default false;

update public.profiles set sem_comissao_gerente = true where id in ('b359d92f-6a3a-4093-b22c-6e13b980f5eb', 'a4e04d5c-e1e1-4127-99ff-b518b6cae638');

do $mig$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.apply_sale_rules(uuid)'::regprocedure);
  if position('sem_comissao_gerente' in v_def) = 0 then
    v_def := replace(v_def,
      E'    v_mgr_amt := case when v_mgr is not null then round(greatest(v_base_g, 0) * 0.20, 2) else 0 end;',
      E'    v_mgr_amt := case when v_mgr is not null and not exists (select 1 from public.profiles pg where pg.id = v_mgr and pg.sem_comissao_gerente) then round(greatest(v_base_g, 0) * 0.20, 2) else 0 end;');
    if position('sem_comissao_gerente' in v_def) = 0 then
      raise exception 'não consegui aplicar a alteração em apply_sale_rules: o texto da função mudou';
    end if;
    execute v_def;
  end if;
end
$mig$;

-- recalcula as vendas que já têm gerente sem comissão
do $recalc$
declare r record;
begin
  for r in select ss.deal_id from public.sale_splits ss join public.profiles p on p.id = ss.manager_id where p.sem_comissao_gerente loop
    perform public.apply_sale_rules(r.deal_id);
  end loop;
end
$recalc$;
