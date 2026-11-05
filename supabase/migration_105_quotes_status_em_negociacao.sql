-- ============================================================
-- MIGRAÇÃO 105 — Cotações: o banco passa a aceitar o status "Em negociação".
-- A tela de cotação oferecia "Em negociação", mas a regra quotes_status_check só aceitava
-- Aberta, Enviada, Aprovada e Recusada. A cotação com esse status não era gravada e, sem
-- gravação, o link de aprovação não era gerado.
-- ============================================================
alter table public.quotes drop constraint quotes_status_check;
alter table public.quotes add constraint quotes_status_check
  check (status = any (array['Aberta', 'Enviada', 'Em negociação', 'Aprovada', 'Recusada']));
