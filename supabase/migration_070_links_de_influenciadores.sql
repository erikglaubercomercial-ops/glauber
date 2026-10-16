-- ============================================================
-- MIGRAÇÃO 070 — Links de divulgação também para influenciadores SEM login no CRM.
-- • app_parceiros.origem: origem do lead (ex.: a origem de influenciador "DUDA", que já tem comissão
--   configurada). O lead entra com essa origem e a 2ª origem "App Intercâmbio".
-- • app_parceiros.consultor_id: consultor que recebe os leads desse link (vazio = rodízio).
-- • app_criar_parceiro / app_atualizar_parceiro (ADM e Gerente) criam e ajustam esses links.
-- • app_links_equipe passa a listar também os influenciadores externos.
-- • app_registrar_lead: dono = usuário do link, ou o consultor do link, ou rodízio.
-- ============================================================
alter table public.app_parceiros add column if not exists origem text;
alter table public.app_parceiros add column if not exists consultor_id uuid references public.profiles(id) on delete set null;

create or replace function public.app_criar_parceiro(p_nome text, p_origem text default null, p_consultor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_papel text := app_papel_crm(); v_nome text := left(btrim(coalesce(p_nome, '')), 80); v_base text; v_code text; n integer := 1;
begin
  if v_papel is null or v_papel not in ('ADM', 'Gerente') then
    raise exception 'Sem permissão para criar links.' using errcode = '42501';
  end if;
  if v_nome = '' then raise exception 'Informe o nome do influenciador.'; end if;
  v_base := app_slug(v_nome);
  if length(v_base) < 2 then v_base := 'inf-' || left(replace(gen_random_uuid()::text, '-', ''), 6); end if;
  v_code := v_base;
  while exists (select 1 from app_parceiros where codigo = v_code) loop
    n := n + 1; v_code := left(v_base, 36) || '-' || n;
  end loop;
  insert into app_parceiros (codigo, nome, ativo, origem, consultor_id)
  values (v_code, v_nome, true, nullif(btrim(coalesce(p_origem, '')), ''), p_consultor);
  return jsonb_build_object('codigo', v_code);
end;
$$;
revoke all on function public.app_criar_parceiro(text, text, uuid) from public, anon;
grant execute on function public.app_criar_parceiro(text, text, uuid) to authenticated;

create or replace function public.app_atualizar_parceiro(p_codigo text, p_ativo boolean, p_origem text default null, p_consultor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_papel text := app_papel_crm();
begin
  if v_papel is null or v_papel not in ('ADM', 'Gerente') then
    raise exception 'Sem permissão para alterar links.' using errcode = '42501';
  end if;
  update app_parceiros
     set ativo = coalesce(p_ativo, ativo),
         origem = case when user_id is null then nullif(btrim(coalesce(p_origem, '')), '') else origem end,
         consultor_id = case when user_id is null then p_consultor else consultor_id end,
         atualizado_em = now()
   where codigo = p_codigo;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_atualizar_parceiro(text, boolean, text, uuid) from public, anon;
grant execute on function public.app_atualizar_parceiro(text, boolean, text, uuid) to authenticated;

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
      'user_id', pa.user_id, 'nome', pa.nome, 'codigo', pa.codigo, 'ativo', pa.ativo,
      'role', coalesce(pr.role, 'Influenciador externo'), 'origem', pa.origem,
      'consultor_id', pa.consultor_id, 'consultor_nome', (select name from profiles c where c.id = pa.consultor_id),
      'acessos', (select count(*) from app_visitantes v where v.ref = pa.codigo),
      'instalaram', (select count(*) from app_visitantes v where v.ref = pa.codigo and v.instalado),
      'cadastros', (select count(*) from app_visitantes v where v.ref = pa.codigo and v.lead_id is not null)
    ) order by (pa.user_id is null), (select count(*) from app_visitantes v where v.ref = pa.codigo and v.lead_id is not null) desc, pa.nome)
    from app_parceiros pa left join profiles pr on pr.id = pa.user_id
    where (pa.user_id is null) or (pa.ativo and coalesce(pr.active, true))
  ), '[]'::jsonb);
end;
$$;

-- app_registrar_lead: dono do lead e origem pelo link
do $mig$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.app_registrar_lead(jsonb)'::regprocedure);
  v_new := v_def;
  if position('where pr.id = v_parceiro.user_id and coalesce(pr.active, true)' in v_new) = 0 then raise exception 'trecho do dono nao encontrado'; end if;
  v_new := replace(v_new, 'where pr.id = v_parceiro.user_id and coalesce(pr.active, true)', 'where pr.id = coalesce(v_parceiro.user_id, v_parceiro.consultor_id) and coalesce(pr.active, true)');
  if position('v_origem := ''App '' || btrim(v_parceiro.nome);' in v_new) = 0 then raise exception 'trecho da origem nao encontrado'; end if;
  v_new := replace(v_new, 'v_origem := ''App '' || btrim(v_parceiro.nome);', 'v_origem := coalesce(nullif(btrim(v_parceiro.origem), ''''), ''App '' || btrim(v_parceiro.nome));');
  if position('v_novo := true;' in v_new) = 0 then raise exception 'trecho do lead novo nao encontrado'; end if;
  v_new := replace(v_new, 'v_novo := true;', 'v_novo := true; if nullif(btrim(coalesce(v_parceiro.origem, '''')), '''') is not null then update leads set source2 = ''App Intercâmbio'' where id = v_lead_id; end if;');
  execute v_new;
end
$mig$;
