-- ============================================================
-- MIGRAÇÃO 135 — Hora de chegada do voo na Irlanda
-- Coluna arrival_time (hora local da Irlanda) na matrícula e exposta na ficha do cliente (lead_ficha).
-- ============================================================
alter table public.enrollments add column if not exists arrival_time time;

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.lead_ficha(uuid)'::regprocedure);
  v_new := replace(v_def, '''arrival_date'', e.arrival_date,', '''arrival_date'', e.arrival_date, ''arrival_time'', e.arrival_time,');
  if v_new = v_def then raise exception 'trecho_nao_encontrado_em_lead_ficha'; end if;
  execute v_new;
end;
$$;
