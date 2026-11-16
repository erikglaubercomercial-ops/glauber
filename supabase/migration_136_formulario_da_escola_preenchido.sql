-- ============================================================
-- MIGRAÇÃO 136 — Matrícula em duas etapas: 1) formulário de matrícula da escola preenchido, 2) matrícula realizada
-- school_form_filled_at: quando a equipe marcou que o formulário da escola foi preenchido (nulo = ainda não).
-- ============================================================
alter table public.enrollments add column if not exists school_form_filled_at timestamptz;
