-- ============================================================
-- MIGRAÇÃO 080 — Dados: a Atlas School Dublin estava cadastrada na cidade Limerick.
-- Move a pasta para Irlanda › Dublin › Cursos e acerta a escola cadastrada (cidade Dublin).
-- O código da escola (atlas-school-dublin-limerick) é mantido para não quebrar vínculos;
-- o gatilho do catálogo recalcula os campos antigos dos itens.
-- ============================================================
do $$
declare v_dub_tipo uuid; v_esc uuid := 'a87113ac-6d0b-4071-b032-f91f523b1e31';
begin
  select t.id into v_dub_tipo from public.catalog_folders t join public.catalog_folders c on c.id = t.parent_id
   where c.kind='cidade' and c.nome='Dublin' and t.kind='tipo' and t.nome='Cursos';
  if v_dub_tipo is null then raise exception 'sem pasta Cursos em Dublin'; end if;
  update public.catalog_folders set parent_id = v_dub_tipo where id = v_esc;
  update public.schools set destino = 'Dublin', descricao = 'Dublin, Irlanda' where codigo = 'atlas-school-dublin-limerick';
end $$;
