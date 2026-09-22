-- ============================================================
-- MIGRAÇÃO 005 — impede cadastrar o mesmo e-mail duas vezes em Leads.
-- Isso já é bloqueado na tela, mas esse índice garante a regra
-- também no banco (ex: duas pessoas cadastrando ao mesmo tempo).
-- Rode este arquivo no Supabase: SQL Editor → New query → Run
-- ============================================================
create unique index if not exists leads_email_unique
  on public.leads (lower(email))
  where email is not null and email <> '';
