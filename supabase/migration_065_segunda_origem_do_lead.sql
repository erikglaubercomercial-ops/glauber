-- ============================================================
-- MIGRAÇÃO 065 — Segunda origem (opcional) no lead.
-- leads.source continua sendo a origem principal (é ela que define comissão de
-- influencer, etc.). leads.source2 é uma segunda marcação, só quando necessário.
-- ============================================================
alter table public.leads add column if not exists source2 text;
