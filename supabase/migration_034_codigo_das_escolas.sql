-- ============================================================
-- MIGRAÇÃO 034 — código fixo para as escolas.
-- Até aqui o comparativo ligava escola ↔ produtos pelo NOME (categoria
-- + destino + nome), e renomear a escola soltava os preços. Agora cada
-- escola tem um código único e estável (schools.codigo) e cada produto
-- pode apontar para ela (catalog_items.escola_codigo). O nome da escola
-- pode mudar à vontade sem quebrar o vínculo.
--
-- Produtos sem código continuam ligados pelo nome (compatibilidade).
-- Não apaga nada nem altera preços.
-- ============================================================

create or replace function public.slugify_codigo(p text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(p, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
    '[^a-z0-9]+', '-', 'g'));
$$;

alter table public.schools add column codigo text;

-- código inicial: o nome (junto com o destino quando o nome ainda não o cita)
with base as (
  select id,
         public.slugify_codigo(case when position(lower(destino) in lower(nome)) > 0 then nome else nome || ' ' || destino end) as slug,
         ordem, created_at
  from public.schools
), numbered as (
  select id, slug, row_number() over (partition by slug order by ordem, created_at) as rn from base
)
update public.schools s
set codigo = case when n.rn = 1 then n.slug else n.slug || '-' || n.rn end
from numbered n
where n.id = s.id;

-- "NED Limerck" (nome com erro de digitação): código limpo
update public.schools
set codigo = 'ned-limerick'
where nome = 'NED Limerck' and destino = 'Limerick'
  and not exists (select 1 from public.schools x where x.codigo = 'ned-limerick');

alter table public.schools alter column codigo set not null;
create unique index schools_codigo_unique on public.schools(codigo);

-- escola nova sem código (ex.: tela antiga em cache): gera um automaticamente
create or replace function public.schools_fill_codigo()
returns trigger
language plpgsql
as $$
declare
  base text;
  cand text;
  n integer := 1;
begin
  if new.codigo is null or new.codigo = '' then
    base := public.slugify_codigo(case when position(lower(new.destino) in lower(new.nome)) > 0 then new.nome else new.nome || ' ' || new.destino end);
    if base = '' then base := 'escola'; end if;
    cand := base;
    while exists (select 1 from public.schools where codigo = cand) loop
      n := n + 1;
      cand := base || '-' || n;
    end loop;
    new.codigo := cand;
  end if;
  return new;
end;
$$;

create trigger schools_fill_codigo
  before insert on public.schools
  for each row execute function public.schools_fill_codigo();

-- produtos apontam para a escola pelo código
alter table public.catalog_items add column escola_codigo text;
create index catalog_items_escola_codigo_idx on public.catalog_items(escola_codigo);

-- vínculos de hoje (mesma regra por nome que valia até agora)
update public.catalog_items p
set escola_codigo = s.codigo
from public.schools s
where coalesce(nullif(p.categoria, ''), 'Outros') = s.categoria
  and coalesce(nullif(p.destino, ''), 'Todos') = s.destino
  and coalesce(p.subgrupo, '') = s.nome;

-- produtos do NED de Limerick, que ficaram com o nome antigo ("NED")
update public.catalog_items p
set escola_codigo = s.codigo, subgrupo = s.nome
from public.schools s
where s.codigo = 'ned-limerick'
  and p.escola_codigo is null
  and p.categoria = 'Irlanda' and p.destino = 'Limerick' and p.subgrupo = 'NED';

-- comparativo público: liga por código (e pelo nome, se o produto ainda não tem código)
create or replace function public.get_public_school_comparison()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'nome', s.nome,
      'categoria', s.categoria,
      'destino', s.destino,
      'descricao', s.descricao,
      'inclusos', s.inclusos,
      'cover_path', s.cover_path,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'nome', p.nome, 'turno', p.turno, 'preco', p.preco,
            'unidade', p.unidade, 'detalhe', p.detalhe, 'ordem', p.ordem
          ) order by p.ordem
        )
        from public.catalog_items p
        where p.ativo
          and (
            p.escola_codigo = s.codigo
            or (
              p.escola_codigo is null
              and coalesce(nullif(p.categoria, ''), 'Outros') = s.categoria
              and coalesce(nullif(p.destino, ''), 'Todos') = s.destino
              and coalesce(p.subgrupo, '') = s.nome
            )
          )
          and p.nome !~* '(full payment|[aà][[:space:]]+vista)'
          and coalesce(p.detalhe, '') !~* '(full payment|[aà][[:space:]]+vista)'
      ), '[]'::jsonb)
    ) order by s.ordem, s.nome
  ), '[]'::jsonb)
  from public.schools s
  where s.ativo;
$$;

grant execute on function public.get_public_school_comparison() to anon, authenticated;
