-- ============================================================
-- MIGRAÇÃO 046 — Financeiro: valores enviados para a escola de cada aluno.
-- Um registro por envio (um aluno pode ter vários), ligado à matrícula.
-- Acesso restrito a quem tem o módulo Financeiro. Só adiciona tabela nova.
-- ============================================================

create table public.school_transfers (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  sent_at date not null default current_date,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index school_transfers_enrollment_idx on public.school_transfers(enrollment_id, sent_at);

alter table public.school_transfers enable row level security;

create policy "school_transfers: acesso conforme módulo financeiro"
  on public.school_transfers for all
  using (public.has_module_access('financeiro'))
  with check (public.has_module_access('financeiro'));
