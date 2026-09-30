-- ============================================================
-- MIGRAÇÃO 025 — leads novos entram sem temperatura definida (em vez
-- de vir com "Morno" por padrão). A coluna passa a aceitar NULL, sem
-- valor padrão; o app envia null explicitamente pra leads sem
-- temperatura escolhida.
-- ============================================================

alter table public.leads alter column temperature drop not null;
alter table public.leads alter column temperature drop default;
