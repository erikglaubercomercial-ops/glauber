-- ============================================================
-- MIGRAÇÃO 087 — "Meu link de reunião": cada consultor tem um link fixo (Google Meet, Zoom...) em
-- Agendamento online. Todo agendamento feito pelo cliente já entra na Agenda com esse link em "Link ou local"
-- e o cliente o vê na página de confirmação. Quem não preencher continua como antes (sem link).
-- ============================================================
alter table public.booking_settings
  add column if not exists meeting_link text not null default '' check (meeting_link = '' or meeting_link ~* '^https?://');

create or replace function public.booking_create(
  p_slug text, p_start timestamptz, p_name text, p_email text, p_phone text, p_country text default 'BR', p_lead uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.booking_settings;
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_country text := upper(coalesce(nullif(btrim(p_country), ''), 'BR'));
  v_dddlen integer;
  v_ddd text; v_num text;
  v_lead_id uuid;
  v_token uuid := gen_random_uuid();
  v_local timestamp;
  v_end_local timestamp;
  v_future integer;
begin
  select * into s from public.booking_settings where slug = lower(btrim(p_slug));
  if not found or not s.enabled then raise exception 'link_indisponivel'; end if;
  if length(v_name) < 2 then raise exception 'nome_obrigatorio'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'email_invalido'; end if;
  if v_country !~ '^[A-Z]{2}$' then v_country := 'BR'; end if;
  if v_country = 'BR' and v_digits like '55%' and length(v_digits) in (12, 13) then v_digits := substr(v_digits, 3); end if;
  v_dddlen := case when v_country in ('US', 'CA') then 3 else 2 end;
  if length(v_digits) < v_dddlen + 6 or length(v_digits) > 15 then raise exception 'telefone_invalido'; end if;
  v_ddd := substr(v_digits, 1, v_dddlen); v_num := substr(v_digits, v_dddlen + 1);

  select count(*) into v_future from public.agenda_items
  where booked_by_client and lower(client_email) = v_email and status = 'agendada'
    and (item_date + coalesce(item_time, time '00:00')) >= current_date;
  if v_future >= 3 then raise exception 'limite_de_agendamentos'; end if;

  perform pg_advisory_xact_lock(hashtext('booking_' || s.consultor_id::text));
  if not public.booking_slot_free(s.consultor_id, p_start) then raise exception 'horario_indisponivel'; end if;

  if p_lead is not null then select id into v_lead_id from public.leads where booking_token = p_lead; end if;
  if v_lead_id is null then
    select id into v_lead_id from public.leads
    where lower(btrim(email)) = v_email or (phone_ddd = v_ddd and phone_number = v_num and v_num <> '')
    order by (lower(btrim(email)) = v_email) desc, created_at limit 1;
  end if;
  if v_lead_id is null then
    insert into public.lead_sources (name, ordem)
    values ('Agendamento online', (select coalesce(max(ordem), 0) + 1 from public.lead_sources))
    on conflict (name) do nothing;
    insert into public.leads (name, email, country_code, phone_ddd, phone_number, phone, source, category, status, temperature, consultor_id, notes)
    values (v_name, v_email, v_country, v_ddd, v_num, '(' || v_ddd || ') ' || v_num, 'Agendamento online', 'Outro', 'Novo', 'Morno', s.consultor_id,
            '📅 Lead criado pelo agendamento online.')
    returning id into v_lead_id;
  end if;

  v_local := p_start at time zone s.tz;
  v_end_local := (p_start + make_interval(mins => s.duration_min)) at time zone s.tz;
  insert into public.agenda_items (title, type, item_date, item_time, end_time, tz, consultor_id, created_by, lead_id, status, notes, location,
                                   booking_token, booked_by_client, client_name, client_email, client_phone, booking_event)
  values ('Reunião com ' || v_name, 'reuniao', v_local::date, v_local::time, v_end_local::time, s.tz, s.consultor_id, s.consultor_id, v_lead_id, 'agendada',
          'Agendada pelo cliente pelo link online.', coalesce(nullif(s.meeting_link, ''), ''), v_token, true, v_name, v_email, '+' || v_country || ' ' || v_digits, 'novo');

  return jsonb_build_object('token', v_token, 'start', p_start, 'end', p_start + make_interval(mins => s.duration_min), 'tz', s.tz,
                            'consultor', coalesce(nullif(s.display_name, ''), (select name from public.profiles where id = s.consultor_id)));
end;
$$;
