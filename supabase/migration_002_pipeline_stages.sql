-- ============================================================
-- MIGRAÇÃO 002 — colunas do pipeline configuráveis (ADM) +
-- vínculo automático entre Lead e o card dele no Pipeline.
-- Rode este arquivo no Supabase: SQL Editor → New query → Run
-- (rode só uma vez, depois do schema.sql original)
-- ============================================================

-- ---------- colunas do funil de negócios (Pipeline) ----------
create table public.pipeline_stages (
  id text primary key,
  label text not null,
  position integer not null,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.pipeline_stages (id, label, position, is_won, is_lost) values
  ('lead', 'Lead', 1, false, false),
  ('contato', 'Contato Feito', 2, false, false),
  ('proposta', 'Proposta', 3, false, false),
  ('negociacao', 'Negociação', 4, false, false),
  ('ganho', 'Ganho', 5, true, false),
  ('perdido', 'Perdido', 6, false, true);

alter table public.pipeline_stages enable row level security;

create policy "pipeline_stages: leitura para quem acessa pipeline"
  on public.pipeline_stages for select
  using (public.has_module_access('pipeline'));

create policy "pipeline_stages: criação somente ADM"
  on public.pipeline_stages for insert
  with check (public.current_role_name() = 'ADM');

create policy "pipeline_stages: edição somente ADM"
  on public.pipeline_stages for update
  using (public.current_role_name() = 'ADM');

create policy "pipeline_stages: exclusão somente ADM"
  on public.pipeline_stages for delete
  using (public.current_role_name() = 'ADM');

-- ---------- deals.stage passa a referenciar as colunas acima ----------
-- (antes era uma lista fixa de valores; agora o ADM pode criar/editar/excluir colunas)
alter table public.deals drop constraint if exists deals_stage_check;
alter table public.deals
  add constraint deals_stage_fkey foreign key (stage) references public.pipeline_stages(id);

-- ---------- vínculo entre o lead e o card dele no pipeline ----------
alter table public.deals add column lead_id uuid references public.leads(id) on delete set null;
create unique index deals_lead_id_unique on public.deals(lead_id) where lead_id is not null;

-- cria automaticamente o card no Pipeline (coluna "Lead") para todo lead que
-- ainda não tem um — cobre os leads que já existiam antes desta migração.
insert into public.deals (id, name, contact, info, value, stage, notes, lead_id, created_at)
select
  gen_random_uuid(),
  l.name,
  coalesce(nullif(l.phone, ''), l.email, ''),
  coalesce(nullif(l.email, ''), l.phone, ''),
  0,
  'lead',
  '',
  l.id,
  l.created_at
from public.leads l
where not exists (select 1 from public.deals d where d.lead_id = l.id);

-- ---------- ajuste de permissão: criar um lead também cria o card no pipeline ----------
-- Antes, só quem tinha acesso ao módulo "Pipeline" podia inserir em deals.
-- Como todo lead novo agora cria automaticamente um card no pipeline, quem
-- tem acesso a "Leads" (mesmo sem acesso a "Pipeline") também precisa poder
-- inserir esse card — leitura/edição/exclusão do pipeline continuam exigindo
-- o acesso ao módulo "Pipeline" normalmente.
drop policy if exists "pipeline conforme módulo" on public.deals;

create policy "pipeline: leitura conforme módulo"
  on public.deals for select
  using (public.has_module_access('pipeline'));

create policy "pipeline: criação ao acessar leads ou pipeline"
  on public.deals for insert
  with check (public.has_module_access('pipeline') or public.has_module_access('leads'));

create policy "pipeline: edição conforme módulo"
  on public.deals for update
  using (public.has_module_access('pipeline'))
  with check (public.has_module_access('pipeline'));

create policy "pipeline: exclusão conforme módulo"
  on public.deals for delete
  using (public.has_module_access('pipeline'));
