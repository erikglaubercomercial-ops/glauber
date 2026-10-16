-- ============================================================
-- MIGRAÇÃO 068 — Link de divulgação do app por usuário (consultor, gerente, ADM, influencer).
--
-- • app_parceiros.user_id liga o código do link (/i/<codigo>) a quem divulgou.
-- • app_garantir_link(user): cria o código da pessoa (nome sem acento, ex.: "carla-bechini").
-- • app_meu_link(): devolve SÓ o link de quem está logado, com contagens (acessos, instalações,
--   cadastros) — nenhum dado de lead. ADM/Gerente podem pedir o de outra pessoa (visão "Ver como…").
-- • app_links_equipe(): ADM/Gerente — todos os links e números por divulgador.
-- • app_registrar_lead: lead NOVO que se cadastra pelo link de alguém nasce com essa pessoa como
--   dono (cai na lista de leads dela) e não entra no rodízio. Lead que já existe segue com o dono atual.
-- ============================================================
alter table public.app_parceiros add column if not exists user_id uuid references public.profiles(id) on delete set null;
create unique index if not exists app_parceiros_user_unico on public.app_parceiros(user_id) where user_id is not null;

create or replace function public.app_slug(p_nome text)
returns text language sql immutable as $$
  select left(trim(both '-' from regexp_replace(lower(translate(coalesce(p_nome, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^a-z0-9]+', '-', 'g')), 40);
$$;

create or replace function public.app_garantir_link(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text; v_nome text; v_role text; v_base text; n integer := 1;
begin
  select codigo into v_code from app_parceiros where user_id = p_user;
  if v_code is not null then return v_code; end if;
  select name, role into v_nome, v_role from profiles where id = p_user and coalesce(active, true);
  if v_nome is null or v_role not in ('ADM', 'Gerente', 'Consultor', 'Influencer') then return null; end if;
  v_base := app_slug(v_nome);
  if length(v_base) < 2 then v_base := 'user-' || left(p_user::text, 6); end if;
  v_code := v_base;
  while exists (select 1 from app_parceiros where codigo = v_code) loop
    n := n + 1; v_code := left(v_base, 36) || '-' || n;
  end loop;
  insert into app_parceiros (codigo, nome, ativo, user_id) values (v_code, v_nome, true, p_user);
  return v_code;
end;
$$;
revoke all on function public.app_garantir_link(uuid) from public, anon, authenticated;

create or replace function public.app_meu_link(p_user uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_papel text := app_papel_crm(); v_alvo uuid; v_code text;
begin
  if v_papel is null then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  v_alvo := case when p_user is not null and v_papel in ('ADM', 'Gerente') then p_user else auth.uid() end;
  if v_alvo is null then return jsonb_build_object('codigo', null); end if;
  v_code := app_garantir_link(v_alvo);
  if v_code is null then return jsonb_build_object('codigo', null); end if;
  return jsonb_build_object(
    'codigo', v_code,
    'nome', (select nome from app_parceiros where codigo = v_code),
    'acessos', (select count(*) from app_visitantes where ref = v_code),
    'instalaram', (select count(*) from app_visitantes where ref = v_code and instalado),
    'cadastros', (select count(*) from app_visitantes where ref = v_code and lead_id is not null)
  );
end;
$$;
revoke all on function public.app_meu_link(uuid) from public, anon;
grant execute on function public.app_meu_link(uuid) to authenticated;

create or replace function public.app_links_equipe()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_papel text := app_papel_crm(); r record;
begin
  if v_papel is null or v_papel not in ('ADM', 'Gerente') then
    raise exception 'Sem permissão para ver os links da equipe.' using errcode = '42501';
  end if;
  for r in select id from profiles where coalesce(active, true) and role in ('ADM', 'Gerente', 'Consultor', 'Influencer') loop
    perform app_garantir_link(r.id);
  end loop;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', pa.user_id, 'nome', pa.nome, 'role', pr.role, 'codigo', pa.codigo,
      'acessos', (select count(*) from app_visitantes v where v.ref = pa.codigo),
      'instalaram', (select count(*) from app_visitantes v where v.ref = pa.codigo and v.instalado),
      'cadastros', (select count(*) from app_visitantes v where v.ref = pa.codigo and v.lead_id is not null)
    ) order by (select count(*) from app_visitantes v where v.ref = pa.codigo and v.lead_id is not null) desc, pa.nome)
    from app_parceiros pa join profiles pr on pr.id = pa.user_id
    where pa.ativo and coalesce(pr.active, true)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.app_links_equipe() from public, anon;
grant execute on function public.app_links_equipe() to authenticated;

-- app_registrar_lead: lead novo pelo link de alguém é dessa pessoa (sem rodízio)
do $mig$
declare v_def text; v_new text; v_n integer;
  v_pat text := 'select\s+r\.consultor_id\s+into\s+v_consultor\s+from\s+app_rodizio\s+r\s+join\s+profiles\s+pr\s+on\s+pr\.id\s*=\s*r\.consultor_id\s+where\s+r\.ativo\s+and\s+pr\.active\s+order\s+by\s+r\.ultimo_lead_em\s+asc\s+nulls\s+first,\s*r\.consultor_id\s+limit\s+1;\s*if\s+v_consultor\s+is\s+not\s+null\s+then\s+update\s+app_rodizio\s+set\s+ultimo_lead_em\s*=\s*now\(\),\s*atualizado_em\s*=\s*now\(\)\s+where\s+consultor_id\s*=\s*v_consultor;\s*end\s+if;';
  v_rep text := 'v_consultor := (select pr.id from profiles pr where pr.id = v_parceiro.user_id and coalesce(pr.active, true)); if v_consultor is null then select r.consultor_id into v_consultor from app_rodizio r join profiles pr on pr.id = r.consultor_id where r.ativo and pr.active order by r.ultimo_lead_em asc nulls first, r.consultor_id limit 1; if v_consultor is not null then update app_rodizio set ultimo_lead_em = now(), atualizado_em = now() where consultor_id = v_consultor; end if; end if;';
begin
  v_def := pg_get_functiondef('public.app_registrar_lead(jsonb)'::regprocedure);
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then raise exception 'app_registrar_lead: esperado 1 trecho do rodizio, achei %', v_n; end if;
  v_new := regexp_replace(v_def, v_pat, v_rep, 'g');
  execute v_new;
end
$mig$;
