-- ============================================================
-- MIGRAÇÃO 012 — Pipeline: data/hora da primeira interação do
-- negócio, registrada automaticamente no primeiro clique no botão
-- de WhatsApp (na lista de Leads ou no card do Pipeline).
-- ============================================================

alter table public.deals add column if not exists first_interaction_at timestamptz;
