-- ============================================================
-- MIGRAÇÃO 023 — estrutura financeira completa: comissão de escola,
-- comissão de influencer, tráfego pago e indicação entre leads (pra
-- sustentar o cálculo de CAC e LTV no painel de Métricas).
-- ============================================================

-- ---------- indicação (lead indicado por outro lead já cadastrado) ----------
alter table public.leads add column if not exists referred_by_lead_id uuid references public.leads(id) on delete set null;

-- ---------- origem como canal de influencer (comissão %) ----------
alter table public.lead_sources add column if not exists is_influencer boolean not null default false;
alter table public.lead_sources add column if not exists commission_pct numeric(5,2) not null default 0;

-- ---------- comissão de escola (lançada dentro da matrícula, valor livre pois varia por acordo) ----------
alter table public.enrollments add column if not exists school_commission_amount numeric(12,2);
alter table public.enrollments add column if not exists school_commission_status text not null default 'Pendente' check (school_commission_status in ('Pendente','Recebido'));
alter table public.enrollments add column if not exists school_commission_expected date;
alter table public.enrollments add column if not exists school_commission_received date;

-- ---------- comissão de influencer (mesmo padrão de commissions, mas por origem em vez de consultor) ----------
create table public.influencer_commissions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete cascade,
  source text not null default '',
  deal_name text not null default '',
  deal_value numeric(12,2) not null default 0,
  percentage numeric(5,2) not null default 0,
  amount numeric(12,2) not null default 0,
  status text not null default 'Pendente' check (status in ('Pendente','Pago')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index influencer_commissions_deal_id_unique on public.influencer_commissions(deal_id);

alter table public.influencer_commissions enable row level security;

create policy "influencer_commissions: leitura financeiro"
  on public.influencer_commissions for select
  using (public.has_module_access('financeiro'));

create policy "influencer_commissions: criação ao fechar negócio"
  on public.influencer_commissions for insert
  with check (public.has_module_access('pipeline') or public.has_module_access('financeiro'));

create policy "influencer_commissions: edição financeiro"
  on public.influencer_commissions for update
  using (public.has_module_access('financeiro'));

create policy "influencer_commissions: exclusão financeiro"
  on public.influencer_commissions for delete
  using (public.has_module_access('financeiro'));

-- ---------- tráfego pago ----------
create table public.ad_spend (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'Outro',
  amount numeric(12,2) not null default 0,
  spend_date date not null default current_date,
  notes text default '',
  created_at timestamptz not null default now()
);

alter table public.ad_spend enable row level security;

create policy "ad_spend: acesso conforme módulo financeiro"
  on public.ad_spend for all
  using (public.has_module_access('financeiro'))
  with check (public.has_module_access('financeiro'));
