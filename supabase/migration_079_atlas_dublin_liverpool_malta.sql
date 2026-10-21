-- ============================================================
-- MIGRAÇÃO 079 — Dados: preços Atlas (PDF "Atlas Autumn Offers", válido até 31/12/2026).
--  • Atlas School Dublin (pasta já existente): preços por semana + Academic Year AM/PM
--  • Atlas School Liverpool (nova): preços por semana — valores em LIBRAS (£), o sistema ainda exibe €
--  • Atlas School Malta (nova): curso + twin room e só curso, por semana + Academic Year 24 semanas
-- Os campos antigos do produto (categoria, destino, subgrupo, turno…) vêm da pasta pelo gatilho do banco.
-- Só insere linhas; nada existente é alterado.
-- ============================================================
do $$
declare
  v_ing uuid := '01f1ef78-9139-4e27-8742-94604a9a070a';   -- país Inglaterra
  v_mal uuid := '439e75d2-7a28-41a6-a442-6931deb00166';   -- país Malta
  v_dub_am uuid := 'ab86e840-de2b-4611-8d16-5dfbe0dc2828'; -- Atlas School Dublin > 1 Curso > AM
  v_dub_pm uuid := '07a747c0-b6a2-43fe-afb3-38c2b2fed0e2'; -- Atlas School Dublin > 1 Curso > PM
  v_liv_am uuid; v_liv_pm uuid; v_mal_am uuid; v_mal_pm uuid;
  v_cid uuid; v_tipo uuid; v_esc uuid; v_pl uuid; v_pl2 uuid; v_t uuid;
  incl text := ' Inclui aulas eletivas grátis, certificado de fim de curso e acesso ao programa social e cultural.';
  r record;
begin
  -- ---------- escolas cadastradas + cidades ----------
  insert into public.school_cities (nome, ordem)
  select x.nome, x.ordem from (values ('Liverpool', 5), ('Malta', 6)) x(nome, ordem)
  where not exists (select 1 from public.school_cities c where c.nome = x.nome);

  insert into public.schools (id, nome, categoria, destino, descricao, inclusos, ativo, ordem, codigo)
  select gen_random_uuid(), x.nome, x.cat, x.dest, x.descr, '[]'::jsonb, true,
         (select coalesce(max(ordem), 0) from public.schools) + x.n, x.codigo
  from (values
    ('Atlas School Liverpool', 'Inglaterra', 'Liverpool', 'Atlas Language School — Liverpool', 'atlas-school-liverpool', 1),
    ('Atlas School Malta',     'Malta',      'Malta',     'Atlas Language School — Malta',     'atlas-school-malta',     2)
  ) x(nome, cat, dest, descr, codigo, n)
  where not exists (select 1 from public.schools s where s.codigo = x.codigo);

  -- ---------- pastas: Liverpool e Malta (mesmo esqueleto do app) ----------
  for r in select * from (values ('Liverpool', v_ing, 'Atlas School Liverpool', 'atlas-school-liverpool'),
                                 ('Malta',     v_mal, 'Atlas School Malta',     'atlas-school-malta')) x(cidade, pais, escola, codigo)
  loop
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (r.pais, 'cidade', r.cidade, 1) returning id into v_cid;
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_cid, 'tipo', 'Cursos', 1) returning id into v_tipo;
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_cid, 'tipo', 'Faculdade', 2);
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_cid, 'acomod', 'Acomodação', 3);
    insert into public.catalog_folders (parent_id, kind, nome, ordem, escola_codigo) values (v_tipo, 'escola', r.escola, 1, r.codigo) returning id into v_esc;
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_esc, 'plano', '1 Curso', 1) returning id into v_pl;
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_pl, 'turno', 'AM', 1) returning id into v_t;
    if r.cidade = 'Liverpool' then v_liv_am := v_t; else v_mal_am := v_t; end if;
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_pl, 'turno', 'PM', 2) returning id into v_t;
    if r.cidade = 'Liverpool' then v_liv_pm := v_t; else v_mal_pm := v_t; end if;
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_esc, 'plano', 'Renovação', 2) returning id into v_pl2;
    insert into public.catalog_folders (parent_id, kind, nome, ordem) values (v_pl2, 'turno', 'AM', 1), (v_pl2, 'turno', 'PM', 2);
  end loop;

  -- ---------- itens (preços por semana: sem turno no PDF => AM e PM com o mesmo valor) ----------
  -- (pasta, ordem, nome, unidade, preço, qtd_fixa, qtd_padrão, detalhe)
  for r in
    select f.folder, x.* from (values (v_dub_am), (v_dub_pm)) f(folder)
    cross join (values
      (10, 'GE20 — 1 a 8 semanas',  'semana', 300::numeric, false, 1,  'Preço por semana, curso GE20 (oferta de outono, de €335 por €300). Vale também para GE26PLUS, GE26INT e preparação FCE20, CAE20 e IELTS20.' || incl),
      (11, 'GE20 — 9 a 16 semanas', 'semana', 275::numeric, false, 9,  'Preço por semana, curso GE20 (oferta de outono, de €305 por €275). Vale também para GE26PLUS, GE26INT e preparação FCE20, CAE20 e IELTS20.' || incl),
      (12, 'GE20 — 17+ semanas',    'semana', 250::numeric, false, 25, 'Preço por semana, curso GE20 (oferta de outono, de €275 por €250). Vale também para GE26PLUS, GE26INT e preparação FCE20, CAE20 e IELTS20.' || incl)
    ) x(ordem, nome, unidade, preco, qtd_fixa, qtd, detalhe)
    union all
    select f.folder, x.* from (values (v_liv_am), (v_liv_pm)) f(folder)
    cross join (values
      (10, 'GE20 — 1 a 8 semanas (£/semana)',  'semana', 220::numeric, false, 1,  'Valor em libras (£) por semana, curso GE20 (oferta de outono, de £245 por £220). Vale também para GE26.' || incl),
      (11, 'GE20 — 9 a 16 semanas (£/semana)', 'semana', 205::numeric, false, 9,  'Valor em libras (£) por semana, curso GE20 (oferta de outono, de £235 por £205). Vale também para GE26.' || incl),
      (12, 'GE20 — 17+ semanas (£/semana)',    'semana', 190::numeric, false, 25, 'Valor em libras (£) por semana, curso GE20 (oferta de outono, de £210 por £190). Vale também para GE26.' || incl)
    ) x(ordem, nome, unidade, preco, qtd_fixa, qtd, detalhe)
    union all
    select f.folder, x.* from (values (v_mal_am), (v_mal_pm)) f(folder)
    cross join (values
      (10, 'GE20 + Twin room — 1 a 8 semanas',  'semana', 460::numeric, false, 1,  'Preço por semana: curso GE20 + quarto twin (de €485 por €460). Suplemento de verão à parte para cursos de menos de 12 semanas.'),
      (11, 'GE20 + Twin room — 9 a 16 semanas', 'semana', 420::numeric, false, 9,  'Preço por semana: curso GE20 + quarto twin (de €445 por €420). Suplemento de verão à parte para cursos de menos de 12 semanas.'),
      (12, 'GE20 + Twin room — 17+ semanas',    'semana', 370::numeric, false, 25, 'Preço por semana: curso GE20 + quarto twin (de €395 por €370). Sem suplemento de verão em cursos de 12 semanas ou mais.'),
      (20, 'GE20 (só curso) — 1 a 8 semanas',   'semana', 205::numeric, false, 1,  'Preço por semana, só o curso GE20 (de €225 por €205). Suplemento de verão à parte para cursos de menos de 12 semanas.' || incl),
      (21, 'GE20 (só curso) — 9 a 16 semanas',  'semana', 175::numeric, false, 9,  'Preço por semana, só o curso GE20 (de €195 por €175). Suplemento de verão à parte para cursos de menos de 12 semanas.' || incl),
      (22, 'GE20 (só curso) — 17+ semanas',     'semana', 160::numeric, false, 25, 'Preço por semana, só o curso GE20 (de €175 por €160). Sem suplemento de verão em cursos de 12 semanas ou mais.' || incl),
      (30, 'Academic Year 24 semanas — GE20 + Twin room', 'pacote', 7940::numeric, true, 1, 'De €8.760 por €7.940. Inclui 1º livro, curso GE20, acomodação em quarto twin (homestay ou apartamento), transfer de chegada, aulas eletivas e taxa de matrícula.'),
      (31, 'Academic Year 24 semanas — só curso GE20',    'pacote', 3840::numeric, true, 1, 'De €4.200 por €3.840 (somente o curso GE20).' || incl)
    ) x(ordem, nome, unidade, preco, qtd_fixa, qtd, detalhe)
  loop
    insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id)
    values (gen_random_uuid()::text, r.nome, r.unidade, r.preco, r.ordem, r.detalhe, r.qtd_fixa, r.qtd, true, '[]'::jsonb, r.folder);
  end loop;

  -- Academic Year de Dublin (pacote, já por turno)
  insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id) values
    (gen_random_uuid()::text, 'Academic Year — pacote (oferta de outono)', 'pacote', 4350, 20,
     'De €4.875 por €4.350 (economia de €525). Preço de exemplo. Inclui curso AY, todas as taxas de matrícula, taxa de exame (Trinity ou Cambridge), taxa PEL, 1º livro, eletivas e programa social, certificado de fim de curso.',
     true, 1, true, '[]'::jsonb, v_dub_am),
    (gen_random_uuid()::text, 'Academic Year — pacote (oferta de outono)', 'pacote', 3350, 20,
     'De €4.075 por €3.350 (economia de €725). Preço de exemplo. Inclui curso AY, todas as taxas de matrícula, taxa de exame (Trinity ou Cambridge), taxa PEL, 1º livro, eletivas e programa social, certificado de fim de curso.',
     true, 1, true, '[]'::jsonb, v_dub_pm);
end $$;
