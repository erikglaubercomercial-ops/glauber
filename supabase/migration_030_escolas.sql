-- ============================================================
-- MIGRAÇÃO 030 — cadastro de Escolas (menu "Escolas").
-- Cada escola tem os itens que oferece (inclusos) e é ligada aos
-- produtos do catálogo por categoria + destino + nome (= subgrupo do
-- produto), de onde o comparativo AM/PM puxa os valores.
-- Leitura: quem acessa Produtos ou Cotação. Escrita: somente ADM
-- (mesma regra do catálogo).
-- ============================================================

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null default 'Outros',
  destino text not null default 'Todos',
  descricao text not null default '',
  inclusos jsonb not null default '[]'::jsonb,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index schools_categoria_destino_nome_unique on public.schools(categoria, destino, nome);

alter table public.schools enable row level security;

create policy "escolas: leitura para quem acessa produtos ou cotação"
  on public.schools for select
  using (public.has_module_access('produtos') or public.has_module_access('cotacao'));

create policy "escolas: criação somente ADM"
  on public.schools for insert
  with check (public.current_role_name() = 'ADM');

create policy "escolas: edição somente ADM"
  on public.schools for update
  using (public.current_role_name() = 'ADM');

create policy "escolas: exclusão somente ADM"
  on public.schools for delete
  using (public.current_role_name() = 'ADM');

-- começa já com as escolas que existem hoje no catálogo
insert into public.schools (nome, categoria, destino, ordem)
select s.subgrupo, s.categoria, s.destino, row_number() over (order by s.categoria, s.destino, s.subgrupo)
from (
  select distinct subgrupo,
         coalesce(nullif(categoria, ''), 'Outros') as categoria,
         coalesce(nullif(destino, ''), 'Todos') as destino
  from public.catalog_items
  where coalesce(subgrupo, '') <> ''
) s
on conflict do nothing;

-- itens que o NED oferece (Dublin e Limerick)
update public.schools
set inclusos = jsonb_build_array(
  '25 weeks of course',
  '8 weeks holidays',
  'Medical Insurance',
  'Learner Protection',
  '1st Textbook',
  'TIE Exam',
  'Bank Letter',
  'Student Support Post-boarding',
  'Student App',
  'NED welcome kit',
  '+ Hours of Extra Classes',
  '+ Monthly extra activities'
)
where nome = 'NED';

-- itens que a Academic Bridge oferece
update public.schools
set inclusos = jsonb_build_array(
  '25 weeks of course',
  '8 weeks holidays',
  'Medical Insurance',
  'Learner Protection',
  '1st Textbook',
  'TIE Exam',
  'Bank Letter',
  '+ Hours of Extra Classes',
  '+ Monthly extra activities'
)
where nome = 'Academic Bridge';
