-- ============================================================
-- MIGRAÇÃO 028 — comissão de influencer por valor fixo conforme o
-- turno do curso (além do modelo já existente de % sobre o valor do
-- negócio). Caso de uso: DUDA — €150 por matrícula em curso de manhã,
-- €120 à tarde, qualquer escola. O turno só é conhecido na Matrícula
-- (não no negócio do Pipeline), então esse modo dispara ao salvar a
-- matrícula, não ao ganhar o negócio.
-- ============================================================

alter table public.lead_sources
  add column if not exists commission_mode text not null default 'percentage'
    check (commission_mode in ('percentage', 'fixed_turno')),
  add column if not exists commission_fixed_am numeric(12,2) not null default 0,
  add column if not exists commission_fixed_pm numeric(12,2) not null default 0;

-- ---------- liga a comissão de influencer à matrícula (1 comissão por
-- matrícula, já que uma mesma venda/lead pode gerar mais de uma
-- matrícula com turnos diferentes) ----------
alter table public.influencer_commissions
  add column if not exists enrollment_id uuid references public.enrollments(id) on delete cascade;

drop index if exists influencer_commissions_deal_id_unique;

-- 1 comissão por negócio quando não vinculada a matrícula (modelo %
-- existente), e 1 comissão por matrícula quando vinculada (modelo
-- fixo por turno) — permite múltiplas matrículas do mesmo negócio.
create unique index if not exists influencer_commissions_deal_id_unique
  on public.influencer_commissions(deal_id) where enrollment_id is null;
create unique index if not exists influencer_commissions_enrollment_id_unique
  on public.influencer_commissions(enrollment_id) where enrollment_id is not null;

alter table public.influencer_commissions alter column deal_id drop not null;

-- ---------- configura a DUDA: substitui a regra de 0,5% pela fixa por turno ----------
update public.lead_sources
set commission_mode = 'fixed_turno', commission_fixed_am = 150, commission_fixed_pm = 120, commission_pct = 0
where name = 'DUDA';
