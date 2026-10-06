-- ============================================================
-- MIGRAÇÃO 037 — campo "Quando pretende vir?" no lead.
-- Texto livre (ex.: "03/2027", "em 6 meses"), editável na ficha do lead,
-- visível na lista e importável por CSV. Não altera nenhum dado existente.
-- ============================================================
alter table public.leads add column if not exists pretende_vir text not null default '';
