-- ============================================================
-- MIGRAÇÃO 111 — Comissões de influencer: quanto já foi pago, permitindo pagamento parcial.
-- "Falta pagar" é calculado na tela (amount − paid_amount). paid_at guarda a data do último pagamento.
-- ============================================================
alter table public.influencer_commissions
  add column if not exists paid_amount numeric not null default 0 check (paid_amount >= 0);
update public.influencer_commissions set paid_amount = amount where status = 'Pago' and paid_amount = 0;
