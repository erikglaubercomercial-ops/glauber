-- ============================================================
-- MIGRAÇÃO 109 — Comissão de escolas registrada em percentual.
-- percentage e base_amount guardam o que foi digitado; amount continua sendo o valor em euro
-- (base × percentual), usado nos painéis do Financeiro.
-- ============================================================
alter table public.school_commissions
  add column if not exists percentage numeric check (percentage between 0 and 100),
  add column if not exists base_amount numeric check (base_amount >= 0);
