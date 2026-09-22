-- ============================================================
-- Migration 006: conecta o construtor de cotação (antes só em
-- Produtos > Nova Cotação, sem salvar nada) à tabela quotes,
-- com filtros por cliente/e-mail/consultor/ganha-perdida.
-- ============================================================

alter table public.quotes add column if not exists email text default '';
alter table public.quotes add column if not exists lead_id uuid references public.leads(id) on delete set null;
alter table public.quotes add column if not exists consultor_id uuid references public.profiles(id) on delete set null;
alter table public.quotes add column if not exists consultor_name text default '';
alter table public.quotes add column if not exists consultor_email text default '';
alter table public.quotes add column if not exists emissao date;
alter table public.quotes add column if not exists observacoes text default '';
alter table public.quotes add column if not exists items_detail jsonb not null default '[]'::jsonb;

create index if not exists quotes_lead_id_idx on public.quotes (lead_id);
create index if not exists quotes_consultor_id_idx on public.quotes (consultor_id);
