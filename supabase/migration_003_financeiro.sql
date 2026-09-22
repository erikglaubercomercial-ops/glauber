-- ============================================================
-- MIGRAÇÃO 003 — módulo Financeiro (despesas, comissões de
-- consultores e contas a receber), conectado aos negócios
-- Ganho/Perdido do Pipeline.
-- Rode este arquivo no Supabase: SQL Editor → New query → Run
-- (rode depois do schema.sql e da migration_002)
-- ============================================================

-- ---------- libera o módulo "financeiro" nas permissões por função ----------
do $$
declare
  cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'public.role_permissions'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%module%';
  if cname is not null then
    execute format('alter table public.role_permissions drop constraint %I', cname);
  end if;
end $$;

alter table public.role_permissions add constraint role_permissions_module_check
  check (module in ('leads','pipeline','cotacao','produtos','financeiro'));

insert into public.role_permissions (role, module, allowed) values
  ('Gerente','financeiro', true),
  ('Consultor','financeiro', false),
  ('Influencer','financeiro', false),
  ('MKT','financeiro', false),
  ('Financeiro','financeiro', true)
on conflict (role, module) do nothing;

-- ---------- categorias de despesa (gerenciáveis, como as origens de lead) ----------
create table public.expense_categories (
  name text primary key,
  ordem integer not null default 100
);
insert into public.expense_categories (name, ordem) values
  ('Aluguel', 1), ('Salários', 2), ('Marketing', 3), ('Ferramentas/Softwares', 4), ('Impostos', 5), ('Outro', 6);

-- ---------- despesas da empresa ----------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null default 'Outro',
  amount numeric(12,2) not null default 0,
  due_date date not null default current_date,
  paid boolean not null default false,
  paid_at timestamptz,
  recurring boolean not null default false,
  notes text default '',
  created_at timestamptz not null default now()
);

-- ---------- comissão padrão (percentual único, ajustável pelo ADM) ----------
create table public.commission_settings (
  id integer primary key default 1,
  default_percentage numeric(5,2) not null default 10,
  constraint commission_settings_single_row check (id = 1)
);
insert into public.commission_settings (id, default_percentage) values (1, 10);

-- ---------- comissões (uma por negócio marcado como Ganho) ----------
create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete cascade,
  consultor_id uuid references public.profiles(id) on delete set null,
  deal_name text not null default '',
  deal_value numeric(12,2) not null default 0,
  percentage numeric(5,2) not null default 0,
  amount numeric(12,2) not null default 0,
  status text not null default 'Pendente' check (status in ('Pendente','Pago')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index commissions_deal_id_unique on public.commissions(deal_id);

-- ---------- contas a receber (parcelas de um negócio Ganho) ----------
create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete cascade,
  client_name text not null default '',
  installment_number integer not null default 1,
  installments_total integer not null default 1,
  amount numeric(12,2) not null default 0,
  due_date date not null default current_date,
  paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.commission_settings enable row level security;
alter table public.commissions enable row level security;
alter table public.receivables enable row level security;

-- ---------- expense_categories ----------
create policy "expense_categories: leitura financeiro"
  on public.expense_categories for select
  using (public.has_module_access('financeiro'));

create policy "expense_categories: escrita financeiro"
  on public.expense_categories for all
  using (public.has_module_access('financeiro'))
  with check (public.has_module_access('financeiro'));

-- ---------- expenses ----------
create policy "expenses: conforme módulo financeiro"
  on public.expenses for all
  using (public.has_module_access('financeiro'))
  with check (public.has_module_access('financeiro'));

-- ---------- commission_settings ----------
create policy "commission_settings: leitura financeiro"
  on public.commission_settings for select
  using (public.has_module_access('financeiro'));

create policy "commission_settings: edição somente ADM"
  on public.commission_settings for update
  using (public.current_role_name() = 'ADM');

-- ---------- commissions ----------
-- Financeiro/ADM/Gerente veem todas; o próprio Consultor vê as suas.
create policy "commissions: leitura"
  on public.commissions for select
  using (
    public.has_module_access('financeiro')
    or (public.current_role_name() = 'Consultor' and consultor_id = auth.uid())
  );

create policy "commissions: criação ao fechar negócio"
  on public.commissions for insert
  with check (public.has_module_access('pipeline') or public.has_module_access('financeiro'));

create policy "commissions: edição financeiro"
  on public.commissions for update
  using (public.has_module_access('financeiro'));

create policy "commissions: exclusão financeiro"
  on public.commissions for delete
  using (public.has_module_access('financeiro'));

-- ---------- receivables ----------
create policy "receivables: leitura financeiro"
  on public.receivables for select
  using (public.has_module_access('financeiro'));

create policy "receivables: criação ao fechar negócio"
  on public.receivables for insert
  with check (public.has_module_access('pipeline') or public.has_module_access('financeiro'));

create policy "receivables: edição financeiro"
  on public.receivables for update
  using (public.has_module_access('financeiro'));

create policy "receivables: exclusão financeiro"
  on public.receivables for delete
  using (public.has_module_access('financeiro'));
