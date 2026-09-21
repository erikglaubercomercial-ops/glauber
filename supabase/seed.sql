-- ============================================================
-- Dados iniciais do catálogo (Cotações Peregrinos)
-- Rode DEPOIS do schema.sql: SQL Editor → New query → Run
-- ============================================================

insert into public.catalog_items (id, nome, categoria, destino, subgrupo, turno, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs) values
('ab-int-monfri-am-full', 'International — Full Payment', 'Irlanda', 'Dublin', 'Academic Bridge', 'AM · Segunda a Sexta', 'pacote', 2499, 103, 'Aulas de manhã, de segunda a sexta. Pagamento à vista.', true, 1, true, '[]'),
('ab-int-monfri-am-inst', 'International — Instalments', 'Irlanda', 'Dublin', 'Academic Bridge', 'AM · Segunda a Sexta', 'pacote', 2699, 102, 'Aulas de manhã, de segunda a sexta. Pagamento parcelado.', true, 1, true, '[]'),
('ab-int-monthu-am-full', 'International — Full Payment', 'Irlanda', 'Dublin', 'Academic Bridge', 'AM · Segunda a Quinta', 'pacote', 2799, 101, 'Aulas de manhã, de segunda a quinta. Pagamento à vista.', true, 1, true, '[]'),
('ab-int-monthu-am-inst', 'International — Instalments', 'Irlanda', 'Dublin', 'Academic Bridge', 'AM · Segunda a Quinta', 'pacote', 2999, 100, 'Aulas de manhã, de segunda a quinta. Pagamento parcelado.', true, 1, true, '[]'),
('ab-int-monthu-pm-full', 'International — Full Payment', 'Irlanda', 'Dublin', 'Academic Bridge', 'PM · Segunda a Quinta', 'pacote', 2199, 105, 'Aulas à tarde, de segunda a quinta. Pagamento à vista.', true, 1, true, '[]'),
('ab-int-monthu-pm-inst', 'International — Instalments', 'Irlanda', 'Dublin', 'Academic Bridge', 'PM · Segunda a Quinta', 'pacote', 2399, 104, 'Aulas à tarde, de segunda a quinta. Pagamento parcelado.', true, 1, true, '[]'),
('ab-ren-monfri-am-full', 'Renewal — Full Payment', 'Irlanda', 'Dublin', 'Academic Bridge', 'AM · Segunda a Sexta', 'pacote', 1599, 113, 'Renovação. Aulas de manhã, de segunda a sexta. Pagamento à vista.', true, 1, true, '[]'),
('ab-ren-monfri-am-inst', 'Renewal — Instalments', 'Irlanda', 'Dublin', 'Academic Bridge', 'AM · Segunda a Sexta', 'pacote', 1799, 112, 'Renovação. Aulas de manhã, de segunda a sexta. Pagamento parcelado.', true, 1, true, '[]'),
('ab-ren-monthu-am-full', 'Renewal — Full Payment', 'Irlanda', 'Dublin', 'Academic Bridge', 'AM · Segunda a Quinta', 'pacote', 1749, 111, 'Renovação. Aulas de manhã, de segunda a quinta. Pagamento à vista.', true, 1, true, '[]'),
('ab-ren-monthu-am-inst', 'Renewal — Instalments', 'Irlanda', 'Dublin', 'Academic Bridge', 'AM · Segunda a Quinta', 'pacote', 1899, 110, 'Renovação. Aulas de manhã, de segunda a quinta. Pagamento parcelado.', true, 1, true, '[]'),
('ab-ren-monthu-pm-full', 'Renewal — Full Payment', 'Irlanda', 'Dublin', 'Academic Bridge', 'PM · Segunda a Quinta', 'pacote', 1499, 115, 'Renovação. Aulas à tarde, de segunda a quinta. Pagamento à vista.', true, 1, true, '[]'),
('ab-ren-monthu-pm-inst', 'Renewal — Instalments', 'Irlanda', 'Dublin', 'Academic Bridge', 'PM · Segunda a Quinta', 'pacote', 1599, 114, 'Renovação. Aulas à tarde, de segunda a quinta. Pagamento parcelado.', true, 1, true, '[]'),
('assessoria-kit-completo', 'KIT COMPLETO', 'Serviços Peregrinos', 'Todos', '', '', 'pacote', 200, 400, 'Translado, chip, kit estudantil, Kit Primeiros Passos e suporte com documentação.', true, 1, true,
  '[{"nome":"Translado","valor":80},{"nome":"Chip","valor":20},{"nome":"Kit Estudantil","valor":30},{"nome":"Kit Primeiros Passos Peregrinos","valor":70},{"nome":"Suporte com documentação","valor":0}]'),
('leevin-acomodacao-semana', 'Accommodation — Weeks', 'Irlanda', 'Limerick', 'Leevin', '', 'semana', 250, 300, 'Acomodação estudantil Leevin. Informe quantas semanas.', false, 2, true,
  '[{"nome":"1 Week","valor":250}]'),
('ned-dublin-int-am-inst', 'International — Instalments', 'Irlanda', 'Dublin', 'NED', 'AM · Dublin', 'pacote', 2899, 210, 'Curso em Dublin, aulas de manhã. Pagamento parcelado.', true, 1, true, '[]'),
('ned-dublin-int-pm-inst', 'International — Instalments', 'Irlanda', 'Dublin', 'NED', 'PM · Dublin', 'pacote', 2499, 211, 'Curso em Dublin, aulas à tarde. Pagamento parcelado.', true, 1, true, '[]'),
('ned-dublin-ren-am-inst', 'Renewal — Instalments', 'Irlanda', 'Dublin', 'NED', 'AM · Dublin', 'pacote', 1800, 220, 'Renovação em Dublin, aulas de manhã. Pagamento parcelado.', true, 1, true, '[]'),
('ned-dublin-ren-pm-inst', 'Renewal — Instalments', 'Irlanda', 'Dublin', 'NED', 'PM · Dublin', 'pacote', 1400, 221, 'Renovação em Dublin, aulas à tarde. Pagamento parcelado.', true, 1, true, '[]'),
('ned-limerick-25', 'General English 25 semanas — Instalments', 'Irlanda', 'Limerick', 'NED', 'AM · Segunda a Sexta', 'pacote', 2599, 200, 'General English 25 semanas, manhã, de segunda a sexta — parcelado.', true, 1, true,
  '[{"nome":"General English 25 weeks","valor":2069},{"nome":"Admission Fee","valor":50},{"nome":"Health Insurance","valor":150},{"nome":"Learner Protection","valor":150},{"nome":"TIE Exam","valor":130},{"nome":"Material (1st. book included)","valor":50},{"nome":"Holidays","valor":0}]');
