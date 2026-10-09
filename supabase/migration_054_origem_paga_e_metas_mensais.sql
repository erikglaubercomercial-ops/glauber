-- ============================================================
-- MIGRAÇÃO 054 — origem paga x orgânica e metas mensais.
--
-- • lead_sources.is_paid: marca as origens de tráfego pago. O gráfico "Leads
--   recebidos por mês" do dashboard passa a mostrar pagos (azul) x orgânicos
--   (laranja). Marcadas agora como pagas: Anúncio, Facebok e Tiktok (o ADM
--   ajusta em Leads > Gerenciar origens).
-- • monthly_goals: meta de faturamento de cada mês do ano. Leitura para quem
--   acessa o Financeiro; só ADM e Gerente definem as metas.
-- ============================================================

alter table public.lead_sources add column if not exists is_paid boolean not null default false;
update public.lead_sources set is_paid = true where name in ('Anúncio', 'Facebok', 'Tiktok');

create table public.monthly_goals (
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  amount numeric(12,2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (year, month)
);
alter table public.monthly_goals enable row level security;
create policy "monthly_goals: leitura financeiro"
  on public.monthly_goals for select
  using (public.has_module_access('financeiro'));
create policy "monthly_goals: ADM e Gerente gravam"
  on public.monthly_goals for all
  using (public.current_role_name() in ('ADM', 'Gerente'))
  with check (public.current_role_name() in ('ADM', 'Gerente'));
