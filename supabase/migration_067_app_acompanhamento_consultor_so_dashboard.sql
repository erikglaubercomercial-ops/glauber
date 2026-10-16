-- ============================================================
-- MIGRAÇÃO 067 — App · Acompanhamento: o Consultor vê só o dashboard (números),
-- sem dados de leads/usuários do app.
-- • app_metricas: passa a aceitar o Consultor (só agregados: funil, rankings, origens).
-- • app_usuarios e app_linha_do_tempo: voltam a ser só ADM e Gerente.
-- Aplicada com troca de texto sobre a definição vigente de cada função.
-- ============================================================
do $m$
declare d text; n text; r record;
begin
  for r in select oid::regprocedure as f from pg_proc where proname = 'app_metricas' and pronamespace = 'public'::regnamespace loop
    d := pg_get_functiondef(r.f);
    n := replace(d, 'not in (''ADM'', ''Gerente'') then', 'not in (''ADM'', ''Gerente'', ''Consultor'') then');
    if n = d then raise exception 'app_metricas: trecho nao encontrado'; end if;
    execute n;
  end loop;
  for r in select oid::regprocedure as f from pg_proc where proname = 'app_usuarios' and pronamespace = 'public'::regnamespace loop
    d := pg_get_functiondef(r.f);
    n := replace(d, 'not in (''ADM'', ''Gerente'', ''Consultor'') then', 'not in (''ADM'', ''Gerente'') then');
    if n = d then raise exception 'app_usuarios: trecho nao encontrado'; end if;
    execute n;
  end loop;
  for r in select oid::regprocedure as f from pg_proc where proname = 'app_linha_do_tempo' and pronamespace = 'public'::regnamespace loop
    d := pg_get_functiondef(r.f);
    n := replace(d, 'if not app_pode_ver_visitante(p_visitor) then', 'if coalesce(app_papel_crm(), '''') not in (''ADM'', ''Gerente'') or not app_pode_ver_visitante(p_visitor) then');
    if n = d then raise exception 'app_linha_do_tempo: trecho nao encontrado'; end if;
    execute n;
  end loop;
end $m$;
