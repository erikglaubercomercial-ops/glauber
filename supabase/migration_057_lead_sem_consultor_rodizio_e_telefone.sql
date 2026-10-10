-- ============================================================
-- MIGRAÇÃO 057 — lead sem consultor: rodízio automático e dono preservado.
--
-- • assign_lead_rotation passa a ser idempotente: se o lead já tem consultor,
--   devolve o lead como está (não troca o dono).
-- • trigger leads_rodizio_automatico: todo lead inserido sem consultor (App
--   Intercâmbio, formulário, indicação, cadastro manual) passa pelo rodízio.
--   Com o rodízio desligado (Leads > Rodízio de leads) nada muda: o lead fica
--   sem consultor e a tela avisa o ADM/Gerente para direcionar.
-- • app_registrar_lead: quando a pessoa já é lead, o app reconhece também pelo
--   telefone (antes só pelo e-mail) e mantém o lead e o consultor dono dele —
--   evita lead duplicado ou erro de telefone repetido.
-- ============================================================

create or replace function public.assign_lead_rotation(p_lead_id uuid)
returns public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.lead_rotation_settings;
  v_count integer;
  v_member_id uuid;
  v_result public.leads;
begin
  select * into v_result from public.leads where id = p_lead_id;
  if not found or v_result.consultor_id is not null then
    return v_result;
  end if;

  select * into v_settings from public.lead_rotation_settings where id = 1 for update;
  if v_settings.enabled and coalesce(array_length(v_settings.member_user_ids, 1), 0) > 0 then
    v_count := array_length(v_settings.member_user_ids, 1);
    v_member_id := v_settings.member_user_ids[(v_settings.next_position % v_count) + 1];
    update public.lead_rotation_settings
      set next_position = v_settings.next_position + 1, updated_at = now() where id = 1;
    update public.leads
      set consultor_id = v_member_id, rotation_active = true, rotation_assigned_at = now(),
          rotation_deadline = now() + (v_settings.timeout_hours || ' hours')::interval
      where id = p_lead_id returning * into v_result;
  end if;
  return v_result;
end;
$$;

create or replace function public.leads_rodizio_automatico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.consultor_id is null then
    perform public.assign_lead_rotation(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.leads_rodizio_automatico() from public, anon, authenticated;

create trigger leads_rodizio_automatico
  after insert on public.leads
  for each row execute function public.leads_rodizio_automatico();

-- app_registrar_lead: reconhece o lead existente também pelo telefone (DDD + número)
do $mig$
declare
  v_def text;
  v_new text;
  v_pat text := 'select\s+id\s+into\s+v_lead_id\s+from\s+leads\s+where\s+lower\(btrim\(email\)\)\s*=\s*v_email\s+order\s+by\s+created_at\s+limit\s+1';
  v_n integer;
begin
  v_def := pg_get_functiondef('public.app_registrar_lead(jsonb)'::regprocedure);
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 2 then
    raise exception 'app_registrar_lead: esperado 2 trechos de busca por e-mail, achei %', v_n;
  end if;
  v_new := regexp_replace(
    v_def, v_pat,
    'select id into v_lead_id from leads where lower(btrim(email)) = v_email or (phone_ddd = v_ddd and phone_number = v_num) order by (lower(btrim(email)) = v_email) desc, created_at limit 1',
    'g');
  execute v_new;
end
$mig$;
