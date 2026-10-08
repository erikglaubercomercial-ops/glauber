-- ============================================================
-- MIGRAÇÃO 051 — comissão da escola fica numa tabela só do Financeiro.
--
-- As colunas school_commission_* viviam em enrollments, que o Consultor lê
-- (módulo Matrículas): a tela não mostrava, mas a API devolvia. Agora o valor
-- fica em school_commissions, com acesso restrito a quem tem o módulo
-- Financeiro (ADM, Gerente, Financeiro). As colunas antigas (sem nenhum dado)
-- são removidas da matrícula (parte 2, depois que a tela nova está no ar).
-- ============================================================

-- parte 1
create table public.school_commissions (
  enrollment_id uuid primary key references public.enrollments(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'Pendente' check (status in ('Pendente', 'Recebido')),
  expected date,
  received date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.school_commissions enable row level security;
create policy "school_commissions: acesso conforme módulo financeiro"
  on public.school_commissions for all
  using (public.has_module_access('financeiro'))
  with check (public.has_module_access('financeiro'));

-- traz o que existisse nas colunas antigas (hoje não há nenhum registro)
insert into public.school_commissions (enrollment_id, amount, status, expected, received)
select id, school_commission_amount, school_commission_status, school_commission_expected, school_commission_received
from public.enrollments where school_commission_amount is not null
on conflict do nothing;

-- parte 2 (rodar depois de publicar a tela nova)
-- alter table public.enrollments
--   drop column school_commission_amount,
--   drop column school_commission_status,
--   drop column school_commission_expected,
--   drop column school_commission_received;
