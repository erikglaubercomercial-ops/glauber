-- ============================================================
-- MIGRAÇÃO 078 — Financeiro: controle de acomodação.
-- accommodation_sales      = uma venda de acomodação por matrícula (valor vendido, custo, % do consultor, status da comissão)
-- accommodation_transfers  = valores enviados à acomodação (vários por venda)
-- Comissão do consultor = commission_pct (padrão 40%) do lucro (vendido − custo).
-- Só pode ser marcada como Paga quando o total enviado à acomodação cobrir o custo.
-- Acesso restrito a quem tem o módulo Financeiro. Só adiciona tabelas novas.
-- ============================================================

create table public.accommodation_sales (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  description text not null default '',
  sold_amount numeric(12,2) not null default 0 check (sold_amount >= 0),
  cost_amount numeric(12,2) not null default 0 check (cost_amount >= 0),
  commission_pct numeric(5,2) not null default 40 check (commission_pct between 0 and 100),
  commission_status text not null default 'Pendente' check (commission_status in ('Pendente','Pago')),
  commission_paid_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index accommodation_sales_enrollment_idx on public.accommodation_sales(enrollment_id);

create table public.accommodation_transfers (
  id uuid primary key default gen_random_uuid(),
  accommodation_id uuid not null references public.accommodation_sales(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  sent_at date not null default current_date,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index accommodation_transfers_acc_idx on public.accommodation_transfers(accommodation_id, sent_at);

alter table public.accommodation_sales enable row level security;
alter table public.accommodation_transfers enable row level security;

create policy "accommodation_sales: acesso conforme módulo financeiro"
  on public.accommodation_sales for all
  using (public.has_module_access('financeiro'))
  with check (public.has_module_access('financeiro'));

create policy "accommodation_transfers: acesso conforme módulo financeiro"
  on public.accommodation_transfers for all
  using (public.has_module_access('financeiro'))
  with check (public.has_module_access('financeiro'));

-- a comissão só vira "Pago" depois que o total enviado à acomodação cobrir o custo
create or replace function public.accommodation_commission_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_sent numeric;
begin
  if new.commission_status = 'Pago' and (tg_op = 'INSERT' or old.commission_status is distinct from 'Pago') then
    select coalesce(sum(amount), 0) into v_sent from public.accommodation_transfers where accommodation_id = new.id;
    if v_sent < new.cost_amount then
      raise exception 'comissao_acomodacao_nao_liberada';
    end if;
  end if;
  return new;
end;
$$;
create trigger accommodation_commission_guard
  before insert or update on public.accommodation_sales
  for each row execute function public.accommodation_commission_guard();
