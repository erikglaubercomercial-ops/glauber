-- ============================================================
-- MIGRAÇÃO 102 — Escola nova em Cork: Patricks English Academy (sem preços; os valores entram depois).
-- Mesmo padrão das outras escolas de Cork:
--   • cadastro em Escolas (categoria Irlanda, destino Cork, lista padrão "O que a escola oferece");
--   • pasta em Produtos › Irlanda › Cork › Cursos › Patricks English Academy, com os planos "1 Curso" e "Renovação",
--     cada um com as pastas AM e PM (vazias).
-- Enquanto não houver preço de 25 semanas cadastrado, a escola não aparece na tela pública de preços do cliente.
-- ============================================================
insert into public.schools (codigo, nome, categoria, destino, descricao, inclusos, ativo, ordem)
select 'patricks-english-academy-cork', 'Patricks English Academy', 'Irlanda', 'Cork', 'Patricks English Academy — Cork',
       '["25 weeks of course","8 weeks holidays","Medical Insurance","Learner Protection","1st Textbook","Exit Exam","Bank Letter","+ Hours of Extra Classes","+ Monthly extra activities"]'::jsonb,
       true, coalesce(max(ordem), 0) + 1
from public.schools
on conflict (codigo) do nothing;

do $$
declare
  v_cursos uuid;
  v_escola uuid;
  v_plano uuid;
  p text;
  n int := 0;
begin
  select f.id into v_cursos
  from public.catalog_folders f
  join public.catalog_folders c on c.id = f.parent_id and c.kind = 'cidade' and c.nome = 'Cork'
  where f.kind = 'tipo' and f.nome = 'Cursos';
  if v_cursos is null then raise exception 'pasta Cork › Cursos não encontrada'; end if;

  if exists (select 1 from public.catalog_folders where kind = 'escola' and escola_codigo = 'patricks-english-academy-cork') then return; end if;

  insert into public.catalog_folders (parent_id, kind, nome, ordem, escola_codigo)
  values (v_cursos, 'escola', 'Patricks English Academy',
          (select coalesce(max(ordem), 0) + 1 from public.catalog_folders where parent_id = v_cursos), 'patricks-english-academy-cork')
  returning id into v_escola;

  foreach p in array array['1 Curso', 'Renovação'] loop
    n := n + 1;
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_escola, 'plano', p, n) returning id into v_plano;
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_plano, 'turno', 'AM', 1), (v_plano, 'turno', 'PM', 2);
  end loop;
end $$;
