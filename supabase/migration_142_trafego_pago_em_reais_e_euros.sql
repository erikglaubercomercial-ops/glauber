-- ============================================================
-- MIGRAÇÃO 142 — Tráfego pago em real ou euro, com câmbio.
-- • amount continua sendo o valor em EURO (é o que os painéis do Financeiro somam).
-- • currency: moeda em que o gasto foi digitado (EUR ou BRL).
-- • amount_orig: valor digitado, na moeda de currency.
-- • fx_rate: câmbio usado (R$ por 1 €), para mostrar o valor convertido ao lado.
-- Lançamentos antigos ficam como EUR com câmbio vazio ("câmbio não informado").
-- ============================================================
alter table public.ad_spend
  add column if not exists currency text not null default 'EUR' check (currency in ('EUR', 'BRL')),
  add column if not exists amount_orig numeric,
  add column if not exists fx_rate numeric check (fx_rate is null or fx_rate > 0);

update public.ad_spend set amount_orig = amount where amount_orig is null;
