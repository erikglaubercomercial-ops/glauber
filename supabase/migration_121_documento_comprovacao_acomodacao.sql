-- ============================================================
-- MIGRAÇÃO 121 — novo documento da ficha do cliente: Comprovação da acomodação.
-- Só amplia a lista de tipos aceitos em enrollment_documents (kind = 'acomodacao').
-- ============================================================
alter table public.enrollment_documents drop constraint if exists enrollment_documents_kind_check;
alter table public.enrollment_documents add constraint enrollment_documents_kind_check
  check (kind in ('passaporte', 'passagens', 'comprovante_financeiro', 'matricula_seguros', 'visto', 'acomodacao'));
