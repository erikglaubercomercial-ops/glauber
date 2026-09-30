-- ============================================================
-- MIGRAÇÃO 029 — cotação assinada libera a venda no Pipeline.
-- Liga um Contrato (única assinatura eletrônica real do sistema) à
-- Cotação que o originou. Quando esse contrato é assinado, o negócio
-- do lead pode avançar para a coluna de Venda; sem isso, fica travado
-- na coluna anterior.
-- ============================================================

alter table public.contracts
  add column if not exists quote_id uuid references public.quotes(id) on delete set null;

create unique index if not exists contracts_quote_id_unique
  on public.contracts(quote_id) where quote_id is not null;
