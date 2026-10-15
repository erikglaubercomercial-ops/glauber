-- ============================================================
-- MIGRAÇÃO 063 — Produtos em pastas reais (País › Cidade › Cursos | Faculdade |
-- Acomodação › Escola › 1 Curso | Renovação › AM | PM › tabelas de preço).
--
-- • catalog_folders: as pastas passam a existir de verdade (inclusive vazias).
--   kind: pais, cidade, tipo (Cursos/Faculdade), acomod (Acomodação), escola,
--   plano (1 Curso/Renovação), turno (AM/PM) e grupo (pasta livre).
-- • catalog_items.folder_id: em que pasta cada produto está.
-- • Os campos antigos (categoria, destino, subgrupo, turno, escola_codigo)
--   continuam existindo e agora são DERIVADOS da pasta por gatilho — é o que a
--   Cotação, o Comparativo de escolas e as páginas públicas já leem, então nada
--   deles muda. Renomear/mover uma pasta atualiza sozinho todos os produtos dentro.
-- • Preços, unidades, itens e subitens NÃO são tocados. Os 73 produtos ficam como
--   estão, só ganham pasta. Único ajuste de texto: nos produtos que tinham o MESMO
--   nome no mesmo turno com dois horários (segunda a quinta × segunda a sexta), o
--   horário é acrescentado ao nome ("… · Segunda a Quinta").
-- • Acomodação Leevin passa a viver em Irlanda › cidade › Acomodação.
-- • Tudo roda numa transação só e confere no fim (nº de produtos, soma dos preços
--   e nº de subitens); se algo divergir, nada é aplicado.
-- ============================================================

create table public.catalog_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.catalog_folders(id) on delete cascade,
  kind text not null default 'grupo'
    check (kind in ('pais', 'cidade', 'tipo', 'acomod', 'escola', 'plano', 'turno', 'grupo')),
  nome text not null,
  ordem integer not null default 100,
  escola_codigo text,
  created_at timestamptz not null default now()
);
create index catalog_folders_parent_idx on public.catalog_folders(parent_id);
create unique index catalog_folders_nome_unico
  on public.catalog_folders (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nome));

alter table public.catalog_folders enable row level security;
create policy "pastas do catálogo: leitura para quem acessa produtos"
  on public.catalog_folders for select using (public.has_module_access('produtos'));
create policy "pastas do catálogo: criação somente ADM"
  on public.catalog_folders for insert with check (public.current_role_name() = 'ADM');
create policy "pastas do catálogo: edição somente ADM"
  on public.catalog_folders for update using (public.current_role_name() = 'ADM');
create policy "pastas do catálogo: exclusão somente ADM"
  on public.catalog_folders for delete using (public.current_role_name() = 'ADM');

-- produto que ainda está dentro de uma pasta não deixa a pasta ser apagada
alter table public.catalog_items
  add column folder_id uuid references public.catalog_folders(id) on delete restrict;
create index catalog_items_folder_idx on public.catalog_items(folder_id);

-- ---------------- caminho de uma pasta (da raiz até ela) ----------------
create or replace function public.catalog_folder_chain(p_id uuid)
returns table (id uuid, parent_id uuid, kind text, nome text, escola_codigo text)
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select f.id, f.parent_id, f.kind, f.nome, f.escola_codigo, 0 as depth
    from public.catalog_folders f where f.id = p_id
    union all
    select f.id, f.parent_id, f.kind, f.nome, f.escola_codigo, up.depth + 1
    from public.catalog_folders f join up on f.id = up.parent_id
  )
  select id, parent_id, kind, nome, escola_codigo from up order by depth desc;
$$;
revoke all on function public.catalog_folder_chain(uuid) from public, anon;
grant execute on function public.catalog_folder_chain(uuid) to authenticated;

-- ---------------- produto: campos antigos vêm da pasta ----------------
create or replace function public.catalog_items_sync_folder()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
  v_cat text; v_second text; v_cidade text; v_escola text; v_turno text; v_cod text;
  v_renov boolean := false;
begin
  if new.folder_id is null then return new; end if;
  for r in select * from public.catalog_folder_chain(new.folder_id) loop
    n := n + 1;
    if n = 1 then v_cat := r.nome; end if;
    if n = 2 then v_second := r.nome; end if;
    if r.kind = 'cidade' and v_cidade is null then v_cidade := r.nome; end if;
    if r.kind = 'escola' then v_escola := r.nome; v_cod := nullif(r.escola_codigo, ''); end if;
    if r.kind = 'plano' and lower(r.nome) like 'renova%' then v_renov := true; end if;
    if r.kind = 'turno' then v_turno := r.nome; end if;
  end loop;
  if n = 0 then return new; end if;
  new.categoria := coalesce(v_cat, 'Outros');
  new.destino := coalesce(v_cidade, v_second, 'Todos');
  new.subgrupo := coalesce(v_escola, '');
  new.turno := case when v_turno is null then ''
                    when v_renov then v_turno || ' · Renovação' else v_turno end;
  new.escola_codigo := v_cod;
  return new;
end;
$$;
revoke all on function public.catalog_items_sync_folder() from public, anon, authenticated;
create trigger catalog_items_sync_folder
  before insert or update on public.catalog_items
  for each row execute function public.catalog_items_sync_folder();

-- ---------------- pasta: não pode virar filha de si mesma; renomear/mover atualiza os produtos ----------------
create or replace function public.catalog_folders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null and exists (
    with recursive up as (
      select f.id, f.parent_id from public.catalog_folders f where f.id = new.parent_id
      union all
      select f.id, f.parent_id from public.catalog_folders f join up on f.id = up.parent_id
    ) select 1 from up where up.id = new.id
  ) then
    raise exception 'Uma pasta não pode ser colocada dentro dela mesma.';
  end if;
  return new;
end;
$$;
revoke all on function public.catalog_folders_guard() from public, anon, authenticated;
create trigger catalog_folders_guard
  before update of parent_id on public.catalog_folders
  for each row execute function public.catalog_folders_guard();

create or replace function public.catalog_folders_touch_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.catalog_items set folder_id = folder_id
  where folder_id in (
    with recursive d as (
      select f.id from public.catalog_folders f where f.id = new.id
      union all
      select f.id from public.catalog_folders f join d on f.parent_id = d.id
    ) select id from d
  );
  return null;
end;
$$;
revoke all on function public.catalog_folders_touch_items() from public, anon, authenticated;
create trigger catalog_folders_touch_items
  after update of nome, parent_id, kind, escola_codigo on public.catalog_folders
  for each row execute function public.catalog_folders_touch_items();

-- ============================================================
-- PREENCHIMENTO: cria as pastas e coloca cada um dos produtos atuais na sua
-- ============================================================
create function public.catalog_ensure_folder(p_parent uuid, p_kind text, p_nome text, p_ordem integer default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.catalog_folders
  where parent_id is not distinct from p_parent and lower(nome) = lower(p_nome) limit 1;
  if v_id is null then
    insert into public.catalog_folders (parent_id, kind, nome, ordem)
    values (p_parent, p_kind, p_nome,
            coalesce(p_ordem, (select coalesce(max(ordem), 0) + 1 from public.catalog_folders where parent_id is not distinct from p_parent)))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- cidade nova nasce com Cursos, Faculdade e Acomodação
create function public.catalog_ensure_cidade(p_pais uuid, p_nome text, p_ordem integer default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := public.catalog_ensure_folder(p_pais, 'cidade', p_nome, p_ordem);
  perform public.catalog_ensure_folder(v_id, 'tipo', 'Cursos', 1);
  perform public.catalog_ensure_folder(v_id, 'tipo', 'Faculdade', 2);
  perform public.catalog_ensure_folder(v_id, 'acomod', 'Acomodação', 3);
  return v_id;
end;
$$;

-- escola de curso nasce com 1 Curso e Renovação, cada um com AM e PM
create function public.catalog_ensure_escola_cursos(p_tipo uuid, p_nome text, p_codigo text, p_ordem integer default null)
returns uuid language plpgsql as $$
declare v_id uuid; v_pl uuid; x record;
begin
  v_id := public.catalog_ensure_folder(p_tipo, 'escola', p_nome, p_ordem);
  update public.catalog_folders set escola_codigo = p_codigo where id = v_id and escola_codigo is distinct from p_codigo;
  for x in select * from (values ('1 Curso', 1), ('Renovação', 2)) as t(nome, ord) loop
    v_pl := public.catalog_ensure_folder(v_id, 'plano', x.nome, x.ord);
    perform public.catalog_ensure_folder(v_pl, 'turno', 'AM', 1);
    perform public.catalog_ensure_folder(v_pl, 'turno', 'PM', 2);
  end loop;
  return v_id;
end;
$$;

do $mig$
declare
  r record; s record;
  v_pais uuid; v_cid uuid; v_tipo uuid; v_esc uuid; v_pl uuid; v_leaf uuid;
  v_code text; v_ord integer;
  n_before integer; sum_before numeric; subs_before integer;
  n_after integer; sum_after numeric; subs_after integer;
  n_legacy_diff integer; n_code_diff integer;
begin
  select count(*), coalesce(sum(preco), 0), coalesce(sum(jsonb_array_length(subs)), 0)
    into n_before, sum_before, subs_before from public.catalog_items;

  create temp table _cat_old on commit drop as
    select id, categoria, destino, subgrupo, escola_codigo from public.catalog_items;

  -- as escolas de acomodação (Leevin) deixam "Serviços Peregrinos › Acomodacao X" e vão para Irlanda › X
  update public.schools
     set categoria = 'Irlanda',
         destino = case when destino ilike '%Dublin' then 'Dublin' else 'Limerick' end
   where categoria = 'Serviços Peregrinos' and destino ilike 'Acomodacao %';

  insert into public.catalog_folders (kind, nome, ordem) values
    ('pais', 'Irlanda', 1), ('pais', 'Espanha', 2), ('pais', 'Inglaterra', 3),
    ('pais', 'Malta', 4), ('pais', 'Dubai', 5), ('pais', 'Serviços Peregrinos', 99);

  -- onde cada produto vai ficar
  create temp table _cat_map on commit drop as
  with b as (
    select p.id, p.nome, p.ordem, p.turno as turno_old, p.escola_codigo as cod_old, p.categoria, p.destino, p.subgrupo,
           case when p.categoria = 'Serviços Peregrinos' and p.destino ilike 'Acomodacao %' then 'acomod'
                when p.categoria = 'Serviços Peregrinos' then 'servico'
                else 'curso' end as cls
    from public.catalog_items p
  ), m as (
    select b.*,
      case when b.cls = 'acomod' then 'Irlanda' else b.categoria end as pais,
      case when b.cls = 'acomod' then btrim(regexp_replace(b.destino, '^Acomodacao\s+', '', 'i'))
           when b.cls = 'servico' then null else b.destino end as cidade,
      case when b.cls in ('acomod', 'curso') then nullif(btrim(b.subgrupo), '') end as escola,
      case when b.cls = 'servico' then b.destino end as grupo,
      case when b.cls = 'curso' then (case when b.nome ~* '(renew|renova)' then 'Renovação' else '1 Curso' end) end as plano,
      case when b.cls = 'curso' then (case when upper(btrim(b.turno_old)) like 'AM%' then 'AM' else 'PM' end) end as turno,
      case when b.cls = 'curso' and b.turno_old ~ '^[A-Za-z]+\s*[·-]'
           then nullif(btrim(regexp_replace(b.turno_old, '^[A-Za-z]+\s*[·-]\s*', '')), '') end as sched
    from b
  )
  select m.*,
    m.nome || case when m.cls = 'curso' and m.sched is not null
                    and count(*) over (partition by m.pais, m.cidade, m.escola, m.plano, m.turno, m.nome) > 1
                   then ' · ' || m.sched else '' end as nome_novo
  from m;

  -- cidades (na ordem do menu de cidades, depois alfabética)
  v_ord := 0;
  for r in
    select m.pais, m.cidade from _cat_map m left join public.school_cities sc on sc.nome = m.cidade
    where m.cidade is not null
    group by m.pais, m.cidade, sc.ordem
    order by m.pais, coalesce(sc.ordem, 1000), m.cidade
  loop
    v_pais := public.catalog_ensure_folder(null, 'pais', r.pais);
    v_ord := v_ord + 1;
    perform public.catalog_ensure_cidade(v_pais, r.cidade, v_ord);
  end loop;

  -- escolas que já têm produtos (o código vem da escola cadastrada; se não houver, do próprio produto)
  v_ord := 0;
  for r in
    select m.pais, m.cidade, m.cls, m.escola, min(m.ordem) as mo
    from _cat_map m where m.escola is not null
    group by m.pais, m.cidade, m.cls, m.escola
    order by min(m.ordem), m.escola
  loop
    v_pais := public.catalog_ensure_folder(null, 'pais', r.pais);
    v_cid := public.catalog_ensure_cidade(v_pais, r.cidade);
    v_code := (select sc.codigo from public.schools sc
                where sc.categoria = r.pais and sc.destino = r.cidade and sc.nome = r.escola
                order by sc.ativo desc, sc.ordem limit 1);
    if v_code is null then
      v_code := (select m.cod_old from _cat_map m
                  where m.pais = r.pais and m.cidade = r.cidade and m.escola = r.escola and m.cod_old is not null
                  group by m.cod_old order by count(*) desc limit 1);
    end if;
    v_ord := v_ord + 1;
    if r.cls = 'curso' then
      v_tipo := public.catalog_ensure_folder(v_cid, 'tipo', 'Cursos');
      perform public.catalog_ensure_escola_cursos(v_tipo, r.escola, v_code, v_ord);
    else
      v_tipo := public.catalog_ensure_folder(v_cid, 'acomod', 'Acomodação');
      v_esc := public.catalog_ensure_folder(v_tipo, 'escola', r.escola, v_ord);
      update public.catalog_folders set escola_codigo = v_code where id = v_esc;
    end if;
  end loop;

  -- escolas ativas que ainda não têm produto (ex.: Atlas School) entram com a pasta pronta
  for s in
    select sc.* from public.schools sc
    where sc.ativo and sc.categoria <> 'Serviços Peregrinos'
      and not exists (select 1 from public.catalog_folders f where f.kind = 'escola' and f.escola_codigo = sc.codigo)
    order by sc.ordem
  loop
    v_pais := public.catalog_ensure_folder(null, 'pais', s.categoria);
    v_cid := public.catalog_ensure_cidade(v_pais, s.destino);
    v_tipo := public.catalog_ensure_folder(v_cid, 'tipo', 'Cursos');
    perform public.catalog_ensure_escola_cursos(v_tipo, s.nome, s.codigo);
  end loop;

  -- cada produto na sua pasta (os gatilhos recalculam categoria/destino/subgrupo/turno/escola_codigo)
  for r in select * from _cat_map order by ordem loop
    if r.cls = 'servico' then
      v_leaf := public.catalog_ensure_folder(public.catalog_ensure_folder(null, 'pais', r.pais), 'grupo', r.grupo);
    else
      v_pais := public.catalog_ensure_folder(null, 'pais', r.pais);
      v_cid := public.catalog_ensure_cidade(v_pais, r.cidade);
      if r.cls = 'acomod' then
        v_tipo := public.catalog_ensure_folder(v_cid, 'acomod', 'Acomodação');
        v_leaf := case when r.escola is null then v_tipo else public.catalog_ensure_folder(v_tipo, 'escola', r.escola) end;
      else
        v_tipo := public.catalog_ensure_folder(v_cid, 'tipo', 'Cursos');
        v_esc := case when r.escola is null then v_tipo else public.catalog_ensure_folder(v_tipo, 'escola', r.escola) end;
        v_pl := public.catalog_ensure_folder(v_esc, 'plano', r.plano);
        v_leaf := public.catalog_ensure_folder(v_pl, 'turno', r.turno);
      end if;
    end if;
    update public.catalog_items set folder_id = v_leaf, nome = r.nome_novo where id = r.id;
  end loop;

  -- conferência: nada pode ter se perdido
  select count(*), coalesce(sum(preco), 0), coalesce(sum(jsonb_array_length(subs)), 0)
    into n_after, sum_after, subs_after from public.catalog_items;
  if n_after <> n_before or sum_after <> sum_before or subs_after <> subs_before then
    raise exception 'Conferência falhou: % produtos / % / % subitens antes; % / % / % depois', n_before, sum_before, subs_before, n_after, sum_after, subs_after;
  end if;
  if exists (select 1 from public.catalog_items where folder_id is null) then
    raise exception 'Há produto sem pasta.';
  end if;
  -- produtos de curso mantêm exatamente a mesma categoria/destino/escola de antes
  select count(*) into n_legacy_diff
    from public.catalog_items p join _cat_old o on o.id = p.id join _cat_map m on m.id = p.id
   where m.cls = 'curso' and (p.categoria, p.destino, p.subgrupo) is distinct from (o.categoria, o.destino, o.subgrupo);
  if n_legacy_diff > 0 then
    raise exception '% produtos de curso mudaram de categoria/destino/escola', n_legacy_diff;
  end if;
  select count(*) into n_code_diff
    from public.catalog_items p join _cat_old o on o.id = p.id where p.escola_codigo is distinct from o.escola_codigo;

  raise notice 'OK: % produtos, soma %, % subitens; códigos de escola religados: %', n_after, sum_after, subs_after, n_code_diff;
end;
$mig$;

drop function public.catalog_ensure_escola_cursos(uuid, text, text, integer);
drop function public.catalog_ensure_cidade(uuid, text, integer);
drop function public.catalog_ensure_folder(uuid, text, text, integer);
