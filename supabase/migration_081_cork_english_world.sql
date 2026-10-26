-- ============================================================
-- MIGRAÇÃO 081 — Dados: nova escola Cork English World (CEW), Cork, Irlanda — tabela "2026 CEW Fees".
--  • Escola cadastrada + pasta Irlanda › Cork › Cursos › Cork English World (1 Curso/Renovação › AM/PM)
--  • Work and Study 25 semanas (manhã €2.620 / tarde €2.120) + General English de 1 a 24 semanas (valor total por nº de semanas)
--  • Taxas à parte (matrícula, livro, seguro, exame TIE/IELTS) como itens em cada turno
-- Só insere linhas; nada existente é alterado. Os campos antigos do produto vêm da pasta pelo gatilho do banco.
-- ============================================================
do $$
declare
  v_cork uuid; v_tipo uuid; v_esc uuid; v_pl uuid; v_pl2 uuid; v_am uuid; v_pm uuid;
  v_ext text := ' Não inclui: taxa de matrícula €75, livro €55, seguro (médico + learner protection) €280 e taxa de exame (TIE €150 ou IELTS €250).';
  r record;
begin
  select c.id into v_cork from public.catalog_folders c join public.catalog_folders p on p.id = c.parent_id
   where c.kind = 'cidade' and c.nome = 'Cork' and p.nome = 'Irlanda';
  if v_cork is null then raise exception 'cidade Cork não encontrada em Irlanda'; end if;
  select id into v_tipo from public.catalog_folders where parent_id = v_cork and kind = 'tipo' and nome = 'Cursos';
  if v_tipo is null then raise exception 'pasta Cursos de Cork não encontrada'; end if;
  if exists (select 1 from public.catalog_folders where parent_id = v_tipo and nome = 'Cork English World') then raise exception 'Cork English World já existe'; end if;

  insert into public.schools (id, nome, categoria, destino, descricao, inclusos, ativo, ordem, codigo)
  select gen_random_uuid(), 'Cork English World', 'Irlanda', 'Cork',
         'Cork English World (CEW) — Crawford Park, Bishop Street, Cork',
         '["15 horas de aula por semana (segunda a sexta)", "Máximo de 16 alunos por turma", "Fechada nos feriados irlandeses e de 14/12/2026 a 03/01/2027"]'::jsonb,
         true, (select coalesce(max(ordem), 0) + 1 from public.schools), 'cork-english-world'
  where not exists (select 1 from public.schools where codigo = 'cork-english-world');

  insert into public.catalog_folders (parent_id, kind, nome, ordem, escola_codigo)
  values (v_tipo, 'escola', 'Cork English World', (select coalesce(max(ordem), 0) + 1 from public.catalog_folders where parent_id = v_tipo), 'cork-english-world') returning id into v_esc;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_esc, 'plano', '1 Curso', 1) returning id into v_pl;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_pl, 'turno', 'AM', 1) returning id into v_am;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_pl, 'turno', 'PM', 2) returning id into v_pm;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_esc, 'plano', 'Renovação', 2) returning id into v_pl2;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_pl2, 'turno', 'AM', 1), (v_pl2, 'turno', 'PM', 2);

  -- Work and Study 25 semanas
  insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id) values
    (gen_random_uuid()::text, 'Work and Study 25 semanas — Manhã', 'pacote', 2620, 100,
     'General English + preparação para exame, 15 horas por semana, segunda a sexta, 09:00–12:15.' || v_ext, true, 1, true, '[]'::jsonb, v_am),
    (gen_random_uuid()::text, 'Work and Study 25 semanas — Tarde', 'pacote', 2120, 100,
     'General English + preparação para exame, 15 horas por semana, segunda a sexta, 13:00–16:15.' || v_ext, true, 1, true, '[]'::jsonb, v_pm);

  -- General English: valor total por número de semanas (tabela janeiro–dezembro de 2026)
  for r in
    select * from (values
      ('AM', 1,180),('AM', 2,360),('AM', 3,540),('AM', 4,720),('AM', 5,875),('AM', 6,1038),('AM', 7,1197),('AM', 8,1344),
      ('AM', 9,1476),('AM',10,1620),('AM',11,1749),('AM',12,1884),('AM',13,2015),('AM',14,2100),('AM',15,2175),('AM',16,2240),
      ('AM',17,2295),('AM',18,2340),('AM',19,2375),('AM',20,2440),('AM',21,2520),('AM',22,2596),('AM',23,2668),('AM',24,2736),
      ('PM', 1,125),('PM', 2,250),('PM', 3,375),('PM', 4,500),('PM', 5,625),('PM', 6,738),('PM', 7,854),('PM', 8,968),
      ('PM', 9,1080),('PM',10,1190),('PM',11,1298),('PM',12,1404),('PM',13,1508),('PM',14,1610),('PM',15,1710),('PM',16,1808),
      ('PM',17,1904),('PM',18,1998),('PM',19,2090),('PM',20,2160),('PM',21,2226),('PM',22,2288),('PM',23,2346),('PM',24,2352)
    ) x(turno, semanas, valor)
  loop
    insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id)
    values (gen_random_uuid()::text,
            'General English GE15 — ' || r.semanas || case when r.semanas = 1 then ' semana' else ' semanas' end,
            'pacote', r.valor, 200 + r.semanas,
            'Valor total para ' || r.semanas || case when r.semanas = 1 then ' semana' else ' semanas' end || ' (15 horas por semana, segunda a sexta, '
              || case when r.turno = 'AM' then '09:00–12:15' else '13:00–16:15' end || ').' || v_ext,
            true, 1, true, '[]'::jsonb, case when r.turno = 'AM' then v_am else v_pm end);
  end loop;

  -- taxas à parte, nos dois turnos
  for r in select f.folder, x.* from (values (v_am), (v_pm)) f(folder) cross join (values
      (300, 'Taxa de matrícula', 75::numeric, 'Cobrada uma vez por aluno.'),
      (301, 'Livro do curso (compra obrigatória)', 55::numeric, 'Livro de General English ou de preparação para exame (cada um €55).'),
      (302, 'Seguro (médico + learner protection)', 280::numeric, 'Obrigatório no Work and Study de 25 semanas.'),
      (303, 'Taxa de exame TIE', 150::numeric, 'Exame para o programa Work and Study.'),
      (304, 'Taxa de exame IELTS', 250::numeric, 'Alternativa ao TIE.')
    ) x(ordem, nome, preco, detalhe)
  loop
    insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id)
    values (gen_random_uuid()::text, r.nome, 'unidade', r.preco, r.ordem, r.detalhe, true, 1, true, '[]'::jsonb, r.folder);
  end loop;
end $$;
