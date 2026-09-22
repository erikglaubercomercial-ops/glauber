-- ============================================================
-- MIGRAÇÃO 011 — Pipeline: data de follow-up por negócio, usada
-- pelo botão "Follow-up" no card (agenda simples, sem tabela
-- separada por enquanto).
-- ============================================================

alter table public.deals add column if not exists follow_up_at date;
