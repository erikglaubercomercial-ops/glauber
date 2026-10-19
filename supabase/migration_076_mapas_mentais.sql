-- ============================================================
-- MIGRAÇÃO 076 — Mapas mentais (menu MKT › Mapa Mental).
-- Cada mapa guarda a árvore de tópicos em JSON. ADM, Gerente e MKT criam e editam;
-- excluir: ADM ou quem criou.
-- ============================================================
create table public.mind_maps (
  id uuid primary key default gen_random_uuid(),
  titulo text not null default 'Novo mapa',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mind_maps enable row level security;
create policy "mapas mentais: leitura ADM, Gerente e MKT"
  on public.mind_maps for select using (public.current_role_name() in ('ADM', 'Gerente', 'MKT'));
create policy "mapas mentais: criação ADM, Gerente e MKT"
  on public.mind_maps for insert with check (public.current_role_name() in ('ADM', 'Gerente', 'MKT'));
create policy "mapas mentais: edição ADM, Gerente e MKT"
  on public.mind_maps for update using (public.current_role_name() in ('ADM', 'Gerente', 'MKT'))
  with check (public.current_role_name() in ('ADM', 'Gerente', 'MKT'));
create policy "mapas mentais: exclusão ADM ou quem criou"
  on public.mind_maps for delete using (public.current_role_name() = 'ADM' or created_by = auth.uid());
