-- ============================================================
-- MIGRAÇÃO 098 — Menu lateral organizado pela jornada do cliente (8 grupos):
-- Início · Atendimento · Venda · Pós-venda · Catálogo · Equipe · Captação · Financeiro (por último).
-- O menu vale para todos (menu_config); o ADM continua podendo mexer em "Editar menu".
-- Estrutura anterior (para desfazer, basta gravar este JSON de volta em menu_config.structure):
-- {"sections":[{"id":"geral","items":[{"id":"dashboard"},{"id":"leads","children":["meusleads","pipeline","cotacao","matriculas","leadsparados"]},{"id":"escolas"},{"id":"areaaluno","children":["areaaluno-preview-link"]},{"id":"mkt","children":["colaboradores","templates","mapamental","formularios","appacomp","linkbio"]},{"id":"agenda"},{"id":"financeiro"}]},{"id":"administracao","items":[{"id":"contratos"},{"id":"produtos"},{"id":"usuarios"}]}]}
-- ============================================================
update public.menu_config set structure = '{"sections":[
 {"id":"inicio","items":[{"id":"dashboard"}]},
 {"id":"atendimento","items":[{"id":"whatsapp"},{"id":"leads","children":["meusleads","leadsparados"]},{"id":"agenda"},{"id":"templates"}]},
 {"id":"venda","items":[{"id":"pipeline"},{"id":"cotacao"},{"id":"contratos"}]},
 {"id":"posvenda","items":[{"id":"matriculas"},{"id":"areaaluno","children":["areaaluno-preview-link"]}]},
 {"id":"catalogo","items":[{"id":"produtos"},{"id":"escolas"}]},
 {"id":"equipe","items":[{"id":"colaboradores"},{"id":"usuarios"}]},
 {"id":"captacao","items":[{"id":"linkbio"},{"id":"formularios"},{"id":"mkt","children":["mapamental"]},{"id":"appacomp"}]},
 {"id":"fin","items":[{"id":"financeiro"}]}
]}'::jsonb, updated_by_name = 'Claude (menu por jornada)', updated_at = now() where id = 1;
