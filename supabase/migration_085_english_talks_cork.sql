-- ============================================================
-- MIGRAÇÃO 085 — Dados: escola English Talks (Cork), tabela "PRICE LIST 2026".
--  • Escola + pasta Irlanda › Cork › Cursos › English Talks (1 Curso/Renovação › AM/PM)
--  • Preço POR SEMANA por faixa (1–4, 5–8, 9–12, 25–30 Work & Study, 30–48 Long Year) para cada curso
--    (General English, IELTS & Cambridge); EAP (University Access) como pacote
--  • Taxas e serviços (matrícula, seguros, exames, livros, trocas) no nível da escola
--  • Acomodação da escola como fornecedor "English Talks Acomodação" (escola INATIVA, só para cotação)
-- A tabela não traz preço para 13–24 semanas; IFY, aula individual, Dublin Airport e Local Trip estão como TBA (não cadastrados).
-- Só insere linhas; nada existente é alterado.
-- ============================================================
do $$
declare
  v_cork uuid; v_tipo uuid; v_acomod uuid; v_esc uuid; v_pl uuid; v_pl2 uuid; v_am uuid; v_pm uuid; v_acc uuid;
  r record;
begin
  select c.id into v_cork from public.catalog_folders c join public.catalog_folders p on p.id = c.parent_id
   where c.kind = 'cidade' and c.nome = 'Cork' and p.nome = 'Irlanda';
  if v_cork is null then raise exception 'cidade Cork não encontrada em Irlanda'; end if;
  select id into v_tipo from public.catalog_folders where parent_id = v_cork and kind = 'tipo' and nome = 'Cursos';
  select id into v_acomod from public.catalog_folders where parent_id = v_cork and kind = 'acomod';
  if v_tipo is null or v_acomod is null then raise exception 'pastas Cursos/Acomodação de Cork não encontradas'; end if;
  if exists (select 1 from public.catalog_folders where parent_id = v_tipo and nome = 'English Talks') then raise exception 'English Talks já existe'; end if;

  insert into public.schools (id, nome, categoria, destino, descricao, inclusos, ativo, ordem, codigo)
  select gen_random_uuid(), x.nome, 'Irlanda', 'Cork', x.descr, x.incl::jsonb, x.ativo, (select coalesce(max(ordem), 0) from public.schools) + x.n, x.codigo
  from (values
    ('English Talks', 'English Talks — Cork', '["15 a 30 horas de aula por semana em sala", "Aulas: manhã 09:00–12:15 · tarde 13:00–16:15", "Work & Study: 25 semanas de aula + 9 semanas de férias"]', true, 'english-talks-cork', 1),
    ('English Talks Acomodação', 'Acomodação da English Talks — Cork', '[]', false, 'english-talks-acomodacao-cork', 2)
  ) x(nome, descr, incl, ativo, codigo, n)
  where not exists (select 1 from public.schools s where s.codigo = x.codigo);

  insert into public.catalog_folders (parent_id, kind, nome, ordem, escola_codigo)
  values (v_tipo, 'escola', 'English Talks', (select coalesce(max(ordem), 0) + 1 from public.catalog_folders where parent_id = v_tipo), 'english-talks-cork') returning id into v_esc;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_esc, 'plano', '1 Curso', 1) returning id into v_pl;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_pl, 'turno', 'AM', 1) returning id into v_am;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_pl, 'turno', 'PM', 2) returning id into v_pm;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_esc, 'plano', 'Renovação', 2) returning id into v_pl2;
  insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_pl2, 'turno', 'AM', 1), (v_pl2, 'turno', 'PM', 2);

  -- cursos por semana (turno, nome, preço por semana, semanas padrão, ordem, detalhe)
  for r in select * from (values
      ('AM', 'General English — Standard 15 · 1 a 4 semanas', 300, 1, 111, '15 horas por semana em sala, manhã 09:00–12:15. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Standard 15 · 5 a 8 semanas', 275, 5, 112, '15 horas por semana em sala, manhã 09:00–12:15. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Standard 15 · 9 a 12 semanas', 250, 9, 113, '15 horas por semana em sala, manhã 09:00–12:15. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Standard 15 · 25 a 30 semanas — Work & Study', 225, 25, 114, '15 horas por semana em sala, manhã 09:00–12:15. Work & Study: 25 semanas de aula + 9 semanas de férias. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Standard 15 · 30 a 48 semanas — Long Year', 200, 30, 115, '15 horas por semana em sala, manhã 09:00–12:15. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Intensive 20 · 1 a 4 semanas', 325, 1, 101, '15 horas em sala + 5 horas online por semana (aulas gravadas no portal + kit online), manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Intensive 20 · 5 a 8 semanas', 300, 5, 102, '15 horas em sala + 5 horas online por semana (aulas gravadas no portal + kit online), manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Intensive 20 · 9 a 12 semanas', 275, 9, 103, '15 horas em sala + 5 horas online por semana (aulas gravadas no portal + kit online), manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Intensive 20 · 25 a 30 semanas — Work & Study', 250, 25, 104, '15 horas em sala + 5 horas online por semana (aulas gravadas no portal + kit online), manhã. Work & Study: 25 semanas de aula + 9 semanas de férias. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Intensive 20 · 30 a 48 semanas — Long Year', 225, 30, 105, '15 horas em sala + 5 horas online por semana (aulas gravadas no portal + kit online), manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Super Intensive Plus 33 · 1 a 4 semanas', 475, 1, 121, '30 horas em sala + 3 horas online por semana, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Super Intensive Plus 33 · 5 a 8 semanas', 450, 5, 122, '30 horas em sala + 3 horas online por semana, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Super Intensive Plus 33 · 9 a 12 semanas', 425, 9, 123, '30 horas em sala + 3 horas online por semana, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Super Intensive Plus 33 · 25 a 30 semanas — Work & Study', 400, 25, 124, '30 horas em sala + 3 horas online por semana, manhã. Work & Study: 25 semanas de aula + 9 semanas de férias. Preço por semana; informe quantas semanas.'),
      ('AM', 'General English — Super Intensive Plus 33 · 30 a 48 semanas — Long Year', 350, 30, 125, '30 horas em sala + 3 horas online por semana, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Standard IELTS 15 · 1 a 4 semanas', 325, 1, 141, 'Preparação IELTS, 15 horas por semana em sala, manhã 09:00–12:15. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Standard IELTS 15 · 5 a 8 semanas', 300, 5, 142, 'Preparação IELTS, 15 horas por semana em sala, manhã 09:00–12:15. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Standard IELTS 15 · 9 a 12 semanas', 275, 9, 143, 'Preparação IELTS, 15 horas por semana em sala, manhã 09:00–12:15. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Standard IELTS 15 · 25 a 30 semanas — Work & Study', 250, 25, 144, 'Preparação IELTS, 15 horas por semana em sala, manhã 09:00–12:15. Work & Study: 25 semanas de aula + 9 semanas de férias. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Standard IELTS 15 · 30 a 48 semanas — Long Year', 225, 30, 145, 'Preparação IELTS, 15 horas por semana em sala, manhã 09:00–12:15. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Intensive GE+IELTS 20 · 1 a 4 semanas', 350, 1, 131, '15 horas em sala + 5 horas de aulas gravadas de IELTS no portal + kit online, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Intensive GE+IELTS 20 · 5 a 8 semanas', 325, 5, 132, '15 horas em sala + 5 horas de aulas gravadas de IELTS no portal + kit online, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Intensive GE+IELTS 20 · 9 a 12 semanas', 300, 9, 133, '15 horas em sala + 5 horas de aulas gravadas de IELTS no portal + kit online, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Intensive GE+IELTS 20 · 25 a 30 semanas — Work & Study', 275, 25, 134, '15 horas em sala + 5 horas de aulas gravadas de IELTS no portal + kit online, manhã. Work & Study: 25 semanas de aula + 9 semanas de férias. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Intensive GE+IELTS 20 · 30 a 48 semanas — Long Year', 250, 30, 135, '15 horas em sala + 5 horas de aulas gravadas de IELTS no portal + kit online, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Super Intensive Plus 33 · 1 a 4 semanas', 499, 1, 151, 'Preparação IELTS/Cambridge, 30 horas em sala + 3 horas online por semana, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Super Intensive Plus 33 · 5 a 8 semanas', 475, 5, 152, 'Preparação IELTS/Cambridge, 30 horas em sala + 3 horas online por semana, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Super Intensive Plus 33 · 9 a 12 semanas', 450, 9, 153, 'Preparação IELTS/Cambridge, 30 horas em sala + 3 horas online por semana, manhã. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Super Intensive Plus 33 · 25 a 30 semanas — Work & Study', 425, 25, 154, 'Preparação IELTS/Cambridge, 30 horas em sala + 3 horas online por semana, manhã. Work & Study: 25 semanas de aula + 9 semanas de férias. Preço por semana; informe quantas semanas.'),
      ('AM', 'IELTS & Cambridge — Super Intensive Plus 33 · 30 a 48 semanas — Long Year', 375, 30, 155, 'Preparação IELTS/Cambridge, 30 horas em sala + 3 horas online por semana, manhã. Preço por semana; informe quantas semanas.'),
      ('PM', 'General English — Standard 15 · 1 a 4 semanas', 250, 1, 201, '15 horas por semana em sala, tarde 13:00–16:15. Preço por semana; informe quantas semanas.'),
      ('PM', 'General English — Standard 15 · 5 a 8 semanas', 225, 5, 202, '15 horas por semana em sala, tarde 13:00–16:15. Preço por semana; informe quantas semanas.'),
      ('PM', 'General English — Standard 15 · 9 a 12 semanas', 200, 9, 203, '15 horas por semana em sala, tarde 13:00–16:15. Preço por semana; informe quantas semanas.'),
      ('PM', 'General English — Standard 15 · 25 a 30 semanas — Work & Study', 175, 25, 204, '15 horas por semana em sala, tarde 13:00–16:15. Work & Study: 25 semanas de aula + 9 semanas de férias. Preço por semana; informe quantas semanas.'),
      ('PM', 'General English — Standard 15 · 30 a 48 semanas — Long Year', 160, 30, 205, '15 horas por semana em sala, tarde 13:00–16:15. Preço por semana; informe quantas semanas.'),
      ('PM', 'IELTS & Cambridge — Standard IELTS 15 · 1 a 4 semanas', 275, 1, 211, 'Preparação IELTS, 15 horas por semana em sala, tarde 13:00–16:15. Preço por semana; informe quantas semanas.'),
      ('PM', 'IELTS & Cambridge — Standard IELTS 15 · 5 a 8 semanas', 250, 5, 212, 'Preparação IELTS, 15 horas por semana em sala, tarde 13:00–16:15. Preço por semana; informe quantas semanas.'),
      ('PM', 'IELTS & Cambridge — Standard IELTS 15 · 9 a 12 semanas', 225, 9, 213, 'Preparação IELTS, 15 horas por semana em sala, tarde 13:00–16:15. Preço por semana; informe quantas semanas.'),
      ('PM', 'IELTS & Cambridge — Standard IELTS 15 · 25 a 30 semanas — Work & Study', 200, 25, 214, 'Preparação IELTS, 15 horas por semana em sala, tarde 13:00–16:15. Work & Study: 25 semanas de aula + 9 semanas de férias. Preço por semana; informe quantas semanas.'),
      ('PM', 'IELTS & Cambridge — Standard IELTS 15 · 30 a 48 semanas — Long Year', 175, 30, 215, 'Preparação IELTS, 15 horas por semana em sala, tarde 13:00–16:15. Preço por semana; informe quantas semanas.')
    ) x(turno, nome, preco, qtd, ordem, detalhe)
  loop
    insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id)
    values (gen_random_uuid()::text, r.nome, 'semana', r.preco, r.ordem, r.detalhe, false, r.qtd, true, '[]'::jsonb, case when r.turno = 'AM' then v_am else v_pm end);
  end loop;

  -- EAP: University Access Programme (pacote)
  insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id) values
    (gen_random_uuid()::text, 'EAP — English for Academic Purposes · Nível introdutório (University Access Programme)', 'pacote', 7995, 500,
     'Programa de acesso à universidade (25 a 30 semanas). English for Academic Purposes + IELTS. Horário não informado na tabela.', true, 1, true, '[]'::jsonb, v_am),
    (gen_random_uuid()::text, 'EAP — English for Academic Purposes · Nível avançado (University Access Programme)', 'pacote', 8995, 501,
     'Programa de acesso à universidade (25 a 30 semanas). English for Academic Purposes + IELTS. Horário não informado na tabela.', true, 1, true, '[]'::jsonb, v_am);

  -- taxas e serviços (no nível da escola: aparecem para manhã e tarde)
  for r in select * from (values
      (300, 'Taxa de matrícula — longa duração (6 a 12 meses)', 150),
      (301, 'Taxa de matrícula — curta duração (1 a 5 meses)', 50),
      (310, 'Seguro médico — 1 mês', 50),
      (311, 'Seguro médico — 3 meses', 90),
      (312, 'Seguro médico — 8 meses', 90),
      (313, 'Seguro médico — 12 meses', 120),
      (320, 'Learner Protection — 25 semanas', 60),
      (321, 'Learner Protection — 31 semanas', 80),
      (322, 'Learner Protection — 48 semanas', 120),
      (330, 'Taxa de exame IELTS', 235),
      (331, 'Taxa de exame Cambridge', 210),
      (332, 'Taxa de exame Pearson', 195),
      (333, 'Taxa de exame TIE', 100),
      (340, 'Livro IELTS', 60),
      (341, 'Livro do curso', 50),
      (342, 'Livro de Writing', 15),
      (343, 'Livro de Business English', 45),
      (344, 'Livro do curso — depósito', 50),
      (350, 'Semana extra de aulas — manhã (só por doença/emergência)', 150),
      (351, 'Semana extra de aulas — tarde (só por doença/emergência)', 120),
      (360, 'Taxa de troca de data', 60),
      (361, 'Taxa de troca de turno', 60)
    ) x(ordem, nome, preco)
  loop
    insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id)
    values (gen_random_uuid()::text, r.nome, 'unidade', r.preco, r.ordem, '', true, 1, true, '[]'::jsonb, v_esc);
  end loop;

  -- acomodação da escola (fornecedor em Acomodação)
  insert into public.catalog_folders (parent_id, kind, nome, ordem, escola_codigo)
  values (v_acomod, 'escola', 'English Talks Acomodação', (select coalesce(max(ordem), 0) + 1 from public.catalog_folders where parent_id = v_acomod), 'english-talks-acomodacao-cork') returning id into v_acc;
  for r in select * from (values
      (10, 'Família — quarto individual, café da manhã e jantar (por semana)', 'semana', 280, false, 'Preço por semana. Informe quantas semanas.'),
      (11, 'Residência estudantil — quarto duplo, 2 pessoas, self-catering (por semana)', 'semana', 320, false, 'Preço por semana. Informe quantas semanas.'),
      (12, 'Residência estudantil — quarto individual PREMIUM, self-catering (por semana)', 'semana', 320, false, 'Preço por semana. Informe quantas semanas.'),
      (13, 'Residência estudantil — quarto individual STANDARD, self-catering (por semana)', 'semana', 280, false, 'Preço por semana. Informe quantas semanas.'),
      (14, 'Residência estudantil — twin, self-catering (por semana)', 'semana', 165, false, 'Preço por semana. Informe quantas semanas.'),
      (15, 'Residência estudantil — quarto compartilhado com mais 4 pessoas, self-catering (por semana)', 'semana', 140, false, 'Preço por semana. Informe quantas semanas.'),
      (20, 'Noite extra (individual, duplo, twin ou compartilhado)', 'unidade', 40, false, 'Preço por noite extra. Informe quantas noites.'),
      (30, 'Traslado do aeroporto de Cork (táxi privado / família) — só ida', 'unidade', 100, true, 'Preço por trecho (só ida).'),
      (31, 'Taxa de reserva da acomodação', 'unidade', 100, true, 'Cobrada uma vez por reserva.'),
      (32, 'Taxa de troca de acomodação', 'unidade', 60, true, 'Cobrada em caso de troca.'),
      (33, 'Courier expresso — só ida', 'unidade', 80, true, 'Preço por envio (só ida).')
    ) x(ordem, nome, unidade, preco, fixa, detalhe)
  loop
    insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id)
    values (gen_random_uuid()::text, r.nome, r.unidade, r.preco, r.ordem, r.detalhe, r.fixa, 1, true, '[]'::jsonb, v_acc);
  end loop;
end $$;
