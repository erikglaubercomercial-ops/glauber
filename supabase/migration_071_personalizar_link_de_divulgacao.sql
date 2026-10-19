-- ============================================================
-- MIGRAÇÃO 071 — Personalizar o código do link de divulgação (a parte depois de /i/).
-- • app_renomear_link(codigo_atual, codigo_novo): a pessoa troca o próprio; ADM/Gerente trocam qualquer um.
--   Só letras minúsculas, números e hífen (2 a 40). Não pode repetir nenhum código nem apelido já usado.
-- • O código antigo vira apelido (app_parceiros_alias): quem entrar por um link antigo continua
--   contando para a mesma pessoa. O histórico (acessos e cadastros) acompanha o código novo.
-- • app_registrar_visita e app_registrar_lead passam a traduzir o apelido antes de gravar.
-- ============================================================
create table if not exists public.app_parceiros_alias (
  antigo text primary key,
  codigo text not null references public.app_parceiros(codigo) on update cascade on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.app_parceiros_alias enable row level security;

create or replace function public.app_renomear_link(p_codigo text, p_novo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_papel text := app_papel_crm(); v_novo text := lower(btrim(coalesce(p_novo, ''))); v_par app_parceiros%rowtype;
begin
  if v_papel is null then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into v_par from app_parceiros where codigo = p_codigo;
  if not found then raise exception 'Link não encontrado.'; end if;
  if v_papel not in ('ADM', 'Gerente') and v_par.user_id is distinct from auth.uid() then
    raise exception 'Sem permissão para alterar este link.' using errcode = '42501';
  end if;
  if v_novo !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_novo) not between 2 and 40 then
    raise exception 'Use só letras minúsculas sem acento, números e hífen (2 a 40 caracteres).';
  end if;
  if v_novo = v_par.codigo then return jsonb_build_object('codigo', v_novo); end if;
  if exists (select 1 from app_parceiros where codigo = v_novo)
     or exists (select 1 from app_parceiros_alias where antigo = v_novo and codigo <> v_par.codigo) then
    raise exception 'Esse nome de link já está em uso. Escolha outro.';
  end if;
  delete from app_parceiros_alias where antigo = v_novo;   -- volta a usar um apelido antigo da própria pessoa
  update app_parceiros set codigo = v_novo, atualizado_em = now() where codigo = v_par.codigo;   -- apelidos acompanham (on update cascade)
  insert into app_parceiros_alias (antigo, codigo) values (v_par.codigo, v_novo) on conflict (antigo) do update set codigo = excluded.codigo;
  update app_visitantes set ref = v_novo where ref = v_par.codigo;
  update app_planos set parceiro = v_novo where parceiro = v_par.codigo;
  return jsonb_build_object('codigo', v_novo);
end;
$$;
revoke all on function public.app_renomear_link(text, text) from public, anon;
grant execute on function public.app_renomear_link(text, text) to authenticated;

do $mig$
declare v_def text; v_new text; v_n integer;
begin
  -- visita: traduz o apelido logo depois de validar o formato
  v_def := pg_get_functiondef('public.app_registrar_visita(jsonb)'::regprocedure);
  if position('if v_ref !~ ''^[a-z0-9-]{2,40}$'' then v_ref := null; end if;' in v_def) = 0 then raise exception 'visita: trecho nao encontrado'; end if;
  v_new := replace(v_def, 'if v_ref !~ ''^[a-z0-9-]{2,40}$'' then v_ref := null; end if;',
    'if v_ref !~ ''^[a-z0-9-]{2,40}$'' then v_ref := null; end if; v_ref := coalesce((select a.codigo from app_parceiros_alias a where a.antigo = v_ref), v_ref);');
  execute v_new;
  -- lead: idem, antes de gravar o visitante
  v_def := pg_get_functiondef('public.app_registrar_lead(jsonb)'::regprocedure);
  select count(*) into v_n from regexp_matches(v_def, 'insert\s+into\s+app_visitantes\s*\(visitor_id,\s*utm,\s*ref\)\s*values', 'g');
  if v_n <> 1 then raise exception 'lead: esperado 1 trecho, achei %', v_n; end if;
  v_new := regexp_replace(v_def, '(insert\s+into\s+app_visitantes\s*\(visitor_id,\s*utm,\s*ref\)\s*values)',
    'v_ref := coalesce((select a.codigo from app_parceiros_alias a where a.antigo = v_ref), v_ref); \1');
  execute v_new;
end
$mig$;
