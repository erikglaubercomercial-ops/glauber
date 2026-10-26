-- ============================================================
-- MIGRAÇÃO 082 — Dados: acomodações de Cork (tabela "2026 CEW Fees", Cork English World).
-- Cada fornecedor vira uma pasta em Irlanda › Cork › Acomodação (como a Leevin de Dublin e Limerick),
-- com a escola cadastrada INATIVA (não aparece na página pública de escolas).
--  EazyCork · VivaCork · Leevin Cork · DeansHall · Homestay (tipo A e B)
-- Preços por semana (quantidade editável na cotação) + taxa de colocação de cada um.
-- Só insere linhas; nada existente é alterado.
-- ============================================================
do $$
declare
  v_acomod uuid; v_esc uuid; r record; it record;
begin
  select a.id into v_acomod
    from public.catalog_folders a
    join public.catalog_folders c on c.id = a.parent_id
    join public.catalog_folders p on p.id = c.parent_id
   where a.kind = 'acomod' and c.kind = 'cidade' and c.nome = 'Cork' and p.nome = 'Irlanda';
  if v_acomod is null then raise exception 'pasta Acomodação de Cork não encontrada'; end if;

  for r in select * from (values
      (1, 'EazyCork',    'eazycork',      'Apartamentos em vários pontos do centro de Cork.'),
      (2, 'VivaCork',    'vivacork',      'Apartamentos em vários pontos do centro de Cork — reserva mínima de 1 semana.'),
      (3, 'Leevin Cork', 'leevin-cork',   'Apartamentos em vários pontos do centro de Cork — reserva mínima de 1 semana.'),
      (4, 'DeansHall',   'deanshall-cork','A 1 minuto da escola. Disponível de meados de junho a meados de agosto — reserva mínima de 1 semana.'),
      (5, 'Homestay',    'homestay-cork', 'Casa de família. Traslado do aeroporto de Cork incluso entre 10h e 23h no fim de semana.')
    ) x(ordem, nome, codigo, descr)
  loop
    insert into public.schools (id, nome, categoria, destino, descricao, inclusos, ativo, ordem, codigo)
    select gen_random_uuid(), r.nome, 'Irlanda', 'Cork', r.descr, '[]'::jsonb, false,
           (select coalesce(max(ordem), 0) + 1 from public.schools), r.codigo
    where not exists (select 1 from public.schools where codigo = r.codigo);

    insert into public.catalog_folders (parent_id, kind, nome, ordem, escola_codigo)
    values (v_acomod, 'escola', r.nome, r.ordem, r.codigo) returning id into v_esc;

    -- (ordem, nome, unidade, preço, qtd_fixa, detalhe)
    for it in
      select * from (values
        ('EazyCork', 10, 'Quarto individual — semanas', 'semana', 260::numeric, false, 'Preço por semana, quarto individual. Informe quantas semanas.'),
        ('EazyCork', 11, 'Quarto compartilhado (twin/double) — semanas', 'semana', 190::numeric, false, 'Preço por semana, por pessoa em quarto compartilhado. Informe quantas semanas.'),
        ('EazyCork', 20, 'Taxa de colocação', 'unidade', 100::numeric, true, 'Cobrada uma vez por reserva.'),
        ('VivaCork', 10, 'Quarto individual — semanas', 'semana', 287::numeric, false, 'Preço por semana, quarto individual (mínimo 1 semana). Informe quantas semanas.'),
        ('VivaCork', 11, 'Quarto compartilhado (twin/double) — semanas', 'semana', 196::numeric, false, 'Preço por semana, por pessoa em quarto compartilhado (mínimo 1 semana). Informe quantas semanas.'),
        ('VivaCork', 20, 'Taxa de colocação', 'unidade', 65::numeric, true, 'Cobrada uma vez por reserva.'),
        ('Leevin Cork', 10, 'Quarto individual — semanas', 'semana', 260::numeric, false, 'Preço por semana, quarto individual (mínimo 1 semana). Informe quantas semanas.'),
        ('Leevin Cork', 11, 'Quarto compartilhado (twin/double) — semanas', 'semana', 210::numeric, false, 'Preço por semana, por pessoa em quarto compartilhado (mínimo 1 semana). Informe quantas semanas.'),
        ('Leevin Cork', 20, 'Taxa de colocação', 'unidade', 65::numeric, true, 'Cobrada uma vez por reserva.'),
        ('DeansHall', 10, 'Quarto individual — semanas', 'semana', 210::numeric, false, 'Preço por semana, quarto individual, a 1 minuto da escola. Só de meados de junho a meados de agosto (mínimo 1 semana). Informe quantas semanas.'),
        ('DeansHall', 20, 'Taxa de colocação', 'unidade', 65::numeric, true, 'Cobrada uma vez por reserva.'),
        ('Homestay', 10, 'Tipo A — quarto individual, café da manhã e jantar (por semana)', 'semana', 245::numeric, false, 'Preço por 7 noites: quarto individual, café da manhã e jantar. Informe quantas semanas.'),
        ('Homestay', 11, 'Tipo B — quarto individual com banheiro, café, jantar e transporte matinal até a escola (por semana)', 'semana', 350::numeric, false, 'Preço por 7 noites: quarto individual com banheiro, café da manhã, jantar e traslado matinal até a escola. Informe quantas semanas.'),
        ('Homestay', 20, 'Taxa de colocação', 'unidade', 65::numeric, true, 'Cobrada uma vez por reserva.')
      ) y(fornecedor, ordem, nome, unidade, preco, fixa, detalhe)
      where y.fornecedor = r.nome
    loop
      insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id)
      values (gen_random_uuid()::text, it.nome, it.unidade, it.preco, it.ordem, it.detalhe, it.fixa, 1, true, '[]'::jsonb, v_esc);
    end loop;
  end loop;
end $$;
