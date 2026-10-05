-- ============================================================
-- MIGRAÇÃO 032 — menu de cidades do comparativo de escolas,
-- editável pelo ADM (adicionar, renomear, reordenar, remover).
-- O nome da cidade se liga às escolas pelo destino (mesmo texto).
-- Leitura: quem acessa Produtos ou Cotação. Escrita: só ADM.
-- A página pública lê a lista pela função get_public_school_cities().
-- ============================================================

create table public.school_cities (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.school_cities enable row level security;

create policy "cidades: leitura para quem acessa produtos ou cotação"
  on public.school_cities for select
  using (public.has_module_access('produtos') or public.has_module_access('cotacao'));

create policy "cidades: criação somente ADM"
  on public.school_cities for insert
  with check (public.current_role_name() = 'ADM');

create policy "cidades: edição somente ADM"
  on public.school_cities for update
  using (public.current_role_name() = 'ADM');

create policy "cidades: exclusão somente ADM"
  on public.school_cities for delete
  using (public.current_role_name() = 'ADM');

insert into public.school_cities (nome, ordem) values
  ('Dublin', 1),
  ('Limerick', 2),
  ('Galway', 3),
  ('Cork', 4);

create or replace function public.get_public_school_cities()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(nome order by ordem, nome), '[]'::jsonb)
  from public.school_cities;
$$;

grant execute on function public.get_public_school_cities() to anon, authenticated;
