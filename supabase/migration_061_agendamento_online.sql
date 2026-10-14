-- ============================================================
-- MIGRAÇÃO 061 — Agendamento online (link para o cliente marcar reunião).
--
-- • booking_settings: configuração do link de cada consultor (slug do link,
--   fuso-base, dias/horários de atendimento, duração, intervalo, antecedência
--   mínima e quantos dias à frente fica aberto).
-- • booking_blocks: horários travados (um dia, vários dias, só um intervalo
--   de horas, recorrente por dia da semana, dia todo/férias).
-- • A disponibilidade é calculada a partir da Agenda do sistema: reuniões
--   agendadas (como responsável ou convidado) ocupam o horário. O cliente
--   agenda → vira uma reunião na Agenda do consultor (agenda_items).
-- • leads.booking_token: link personalizado por lead (cliente já identificado).
-- • agenda_items: token de gestão (remarcar/cancelar), dados informados pelo
--   cliente e aviso ao consultor (booking_event / booking_seen_at).
-- • RPCs públicas (anon): booking_public_info, booking_slots, booking_create,
--   booking_get, booking_cancel, booking_reschedule.
-- ============================================================

alter table public.leads add column if not exists booking_token uuid not null default gen_random_uuid();
create unique index if not exists leads_booking_token_key on public.leads (booking_token);

alter table public.agenda_items
  add column if not exists booking_token uuid,
  add column if not exists booked_by_client boolean not null default false,
  add column if not exists client_name text not null default '',
  add column if not exists client_email text not null default '',
  add column if not exists client_phone text not null default '',
  add column if not exists booking_event text,
  add column if not exists booking_seen_at timestamptz;
create unique index if not exists agenda_items_booking_token_key on public.agenda_items (booking_token) where booking_token is not null;

-- ---------------- configuração por consultor ----------------
create table public.booking_settings (
  consultor_id uuid primary key references public.profiles(id) on delete cascade,
  slug text not null unique,
  enabled boolean not null default true,
  display_name text not null default '',
  intro text not null default '',
  tz text not null default 'America/Sao_Paulo' check (tz in ('America/Sao_Paulo', 'Europe/Dublin')),
  weekly jsonb not null default '{"0":[["09:00","18:00"]],"1":[["09:00","18:00"]],"2":[["09:00","18:00"]],"3":[["09:00","18:00"]],"4":[["09:00","18:00"]],"5":[["09:00","18:00"]],"6":[["09:00","18:00"]]}'::jsonb,
  duration_min integer not null default 30 check (duration_min in (15, 20, 30, 45, 60, 90)),
  buffer_min integer not null default 0 check (buffer_min between 0 and 120),
  min_notice_hours integer not null default 4 check (min_notice_hours between 0 and 720),
  window_days integer not null default 30 check (window_days between 1 and 180),
  updated_at timestamptz not null default now()
);

create table public.booking_blocks (
  id uuid primary key default gen_random_uuid(),
  consultor_id uuid not null references public.profiles(id) on delete cascade,
  tz text not null default 'America/Sao_Paulo' check (tz in ('America/Sao_Paulo', 'Europe/Dublin')),
  date_from date not null,
  date_to date,                       -- vazio = sem data final (recorrente)
  all_day boolean not null default false,
  time_from time,
  time_to time,
  weekdays integer[],                 -- vazio = todos os dias (0 = domingo … 6 = sábado)
  note text not null default '',
  created_at timestamptz not null default now(),
  check (all_day or (time_from is not null and time_to is not null and time_to > time_from)),
  check (date_to is null or date_to >= date_from)
);
create index booking_blocks_consultor_idx on public.booking_blocks (consultor_id);

alter table public.booking_settings enable row level security;
alter table public.booking_blocks enable row level security;

create policy "booking_settings: equipe lê"
  on public.booking_settings for select
  using (public.current_role_name() in ('ADM', 'Gerente', 'Consultor', 'MKT', 'Financeiro'));
create policy "booking_settings: o próprio consultor e gestores gravam"
  on public.booking_settings for all
  using (consultor_id = auth.uid() or public.current_role_name() in ('ADM', 'Gerente'))
  with check (consultor_id = auth.uid() or public.current_role_name() in ('ADM', 'Gerente'));

create policy "booking_blocks: equipe lê"
  on public.booking_blocks for select
  using (public.current_role_name() in ('ADM', 'Gerente', 'Consultor', 'MKT', 'Financeiro'));
create policy "booking_blocks: o próprio consultor e gestores gravam"
  on public.booking_blocks for all
  using (consultor_id = auth.uid() or public.current_role_name() in ('ADM', 'Gerente'))
  with check (consultor_id = auth.uid() or public.current_role_name() in ('ADM', 'Gerente'));

create or replace function public.booking_settings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger booking_settings_touch before update on public.booking_settings
  for each row execute function public.booking_settings_touch();

-- slug do link: nome + 4 letras aleatórias
create or replace function public.booking_new_slug(p_name text)
returns text language plpgsql as $$
declare v_base text; v_slug text;
begin
  v_base := trim(both '-' from regexp_replace(lower(coalesce(p_name, 'consultor')), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'consultor'; end if;
  loop
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    exit when not exists (select 1 from public.booking_settings where slug = v_slug);
  end loop;
  return v_slug;
end;
$$;

-- cria a configuração padrão dos consultores atuais e dos futuros
insert into public.booking_settings (consultor_id, slug, display_name)
select p.id, public.booking_new_slug(p.name), p.name
from public.profiles p
where p.role in ('ADM', 'Gerente', 'Consultor') and p.active
on conflict (consultor_id) do nothing;

create or replace function public.profiles_cria_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role in ('ADM', 'Gerente', 'Consultor') then
    insert into public.booking_settings (consultor_id, slug, display_name)
    values (new.id, public.booking_new_slug(new.name), new.name)
    on conflict (consultor_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_cria_booking() from public, anon, authenticated;
create trigger profiles_cria_booking after insert or update of role on public.profiles
  for each row execute function public.profiles_cria_booking();

-- ---------------- disponibilidade ----------------
-- O horário [p_start, p_start + duração) está livre para o consultor?
create or replace function public.booking_slot_free(p_consultor uuid, p_start timestamptz, p_exclude uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.booking_settings;
  v_dur interval;
  v_end timestamptz;
  v_local timestamp;
  v_ok boolean := false;
  v_iv jsonb;
  v_t1 time; v_t2 time;
begin
  select * into s from public.booking_settings where consultor_id = p_consultor;
  if not found or not s.enabled then return false; end if;
  v_dur := make_interval(mins => s.duration_min);
  v_end := p_start + v_dur;
  if p_start < now() + make_interval(hours => s.min_notice_hours) then return false; end if;
  if p_start > now() + make_interval(days => s.window_days) then return false; end if;

  -- dentro do expediente do dia e alinhado à grade (duração + intervalo)
  v_local := p_start at time zone s.tz;
  for v_iv in select jsonb_array_elements(coalesce(s.weekly -> (extract(dow from v_local)::int)::text, '[]'::jsonb)) loop
    v_t1 := (v_iv ->> 0)::time; v_t2 := (v_iv ->> 1)::time;
    if v_local::time >= v_t1
       and (v_local + v_dur)::date = v_local::date
       and (v_local + v_dur)::time <= v_t2
       and mod((extract(epoch from (v_local::time - v_t1)) / 60)::int, s.duration_min + s.buffer_min) = 0 then
      v_ok := true;
    end if;
  end loop;
  if not v_ok then return false; end if;

  -- horário travado
  if exists (
    select 1 from public.booking_blocks b
    where b.consultor_id = p_consultor
      and (p_start at time zone b.tz)::date >= b.date_from
      and (p_start at time zone b.tz)::date <= coalesce(b.date_to, date '9999-12-31')
      and (b.weekdays is null or cardinality(b.weekdays) = 0 or extract(dow from (p_start at time zone b.tz))::int = any (b.weekdays))
      and (b.all_day or ((p_start at time zone b.tz)::time < b.time_to and (v_end at time zone b.tz)::time > b.time_from))
  ) then return false; end if;

  -- reunião já marcada na agenda do sistema (como responsável ou convidado)
  if exists (
    select 1 from public.agenda_items a
    where a.type = 'reuniao' and a.status = 'agendada' and a.item_time is not null
      and (a.consultor_id = p_consultor or p_consultor = any (a.participant_ids))
      and (p_exclude is null or a.id <> p_exclude)
      and tstzrange(
            ((a.item_date + a.item_time) at time zone a.tz) - make_interval(mins => s.buffer_min),
            ((a.item_date + coalesce(a.end_time, a.item_time + interval '1 hour')) at time zone a.tz) + make_interval(mins => s.buffer_min)
          ) && tstzrange(p_start, v_end)
  ) then return false; end if;

  return true;
end;
$$;
revoke all on function public.booking_slot_free(uuid, timestamptz, uuid) from public, anon, authenticated;

-- ---------------- RPCs públicas ----------------
create or replace function public.booking_public_info(p_slug text, p_lead uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.booking_settings; l public.leads;
begin
  select * into s from public.booking_settings where slug = lower(btrim(p_slug));
  if not found or not s.enabled then return null; end if;
  if p_lead is not null then select * into l from public.leads where booking_token = p_lead; end if;
  return jsonb_build_object(
    'name', coalesce(nullif(s.display_name, ''), (select name from public.profiles where id = s.consultor_id)),
    'intro', s.intro, 'tz', s.tz, 'duration', s.duration_min, 'window_days', s.window_days,
    'lead', case when l.id is null then null else jsonb_build_object(
      'name', l.name, 'email', l.email, 'country', l.country_code, 'phone', coalesce(l.phone_ddd, '') || coalesce(l.phone_number, '')) end
  );
end;
$$;

create or replace function public.booking_slots(p_slug text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.booking_settings;
  d date;
  v_iv jsonb;
  v_t1 time; v_t2 time; v_cur time;
  v_start timestamptz;
  v_out jsonb := '[]'::jsonb;
begin
  select * into s from public.booking_settings where slug = lower(btrim(p_slug));
  if not found or not s.enabled then return v_out; end if;
  if p_to - p_from > 62 then p_to := p_from + 62; end if;
  d := p_from;
  while d <= p_to loop
    for v_iv in select jsonb_array_elements(coalesce(s.weekly -> (extract(dow from d)::int)::text, '[]'::jsonb)) loop
      v_t1 := (v_iv ->> 0)::time; v_t2 := (v_iv ->> 1)::time;
      v_cur := v_t1;
      while v_cur + make_interval(mins => s.duration_min) <= v_t2 and v_cur >= v_t1 loop
        v_start := (d + v_cur) at time zone s.tz;
        if public.booking_slot_free(s.consultor_id, v_start) then
          v_out := v_out || to_jsonb(to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
        end if;
        v_cur := v_cur + make_interval(mins => s.duration_min + s.buffer_min);
      end loop;
    end loop;
    d := d + 1;
  end loop;
  return v_out;
end;
$$;

create or replace function public.booking_create(
  p_slug text, p_start timestamptz, p_name text, p_email text, p_phone text,
  p_country text default 'BR', p_lead uuid default null)
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

  -- limite simples contra abuso: no máximo 3 reuniões futuras abertas por e-mail
  select count(*) into v_future from public.agenda_items
  where booked_by_client and lower(client_email) = v_email and status = 'agendada'
    and (item_date + coalesce(item_time, time '00:00')) >= current_date;
  if v_future >= 3 then raise exception 'limite_de_agendamentos'; end if;

  perform pg_advisory_xact_lock(hashtext('booking_' || s.consultor_id::text));
  if not public.booking_slot_free(s.consultor_id, p_start) then raise exception 'horario_indisponivel'; end if;

  -- lead: pelo link personalizado, depois por e-mail/telefone; senão cria
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
  insert into public.agenda_items (title, type, item_date, item_time, end_time, tz, consultor_id, created_by, lead_id, status, notes,
                                   booking_token, booked_by_client, client_name, client_email, client_phone, booking_event)
  values ('Reunião com ' || v_name, 'reuniao', v_local::date, v_local::time, v_end_local::time, s.tz, s.consultor_id, s.consultor_id, v_lead_id, 'agendada',
          'Agendada pelo cliente pelo link online.', v_token, true, v_name, v_email, '+' || v_country || ' ' || v_digits, 'novo');

  return jsonb_build_object('token', v_token, 'start', p_start, 'end', p_start + make_interval(mins => s.duration_min), 'tz', s.tz,
                            'consultor', coalesce(nullif(s.display_name, ''), (select name from public.profiles where id = s.consultor_id)));
end;
$$;

create or replace function public.booking_get(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare a public.agenda_items; s public.booking_settings; v_start timestamptz; v_end timestamptz;
begin
  select * into a from public.agenda_items where booking_token = p_token;
  if not found then return null; end if;
  select * into s from public.booking_settings where consultor_id = a.consultor_id;
  v_start := (a.item_date + a.item_time) at time zone a.tz;
  v_end := (a.item_date + coalesce(a.end_time, a.item_time + interval '1 hour')) at time zone a.tz;
  return jsonb_build_object(
    'status', a.status, 'start', v_start, 'end', v_end, 'tz', a.tz, 'client_name', a.client_name,
    'slug', s.slug, 'consultor', coalesce(nullif(s.display_name, ''), (select name from public.profiles where id = a.consultor_id)),
    'location', a.location, 'can_change', (a.status = 'agendada' and v_start > now())
  );
end;
$$;

create or replace function public.booking_cancel(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.agenda_items
  set status = 'cancelada', booking_event = 'cancelado', booking_seen_at = null
  where booking_token = p_token and status = 'agendada'
    and ((item_date + item_time) at time zone tz) > now();
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create or replace function public.booking_reschedule(p_token uuid, p_new_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.agenda_items; s public.booking_settings;
  v_local timestamp; v_end_local timestamp;
begin
  select * into a from public.agenda_items where booking_token = p_token and status = 'agendada';
  if not found then raise exception 'agendamento_nao_encontrado'; end if;
  select * into s from public.booking_settings where consultor_id = a.consultor_id;
  perform pg_advisory_xact_lock(hashtext('booking_' || a.consultor_id::text));
  if not public.booking_slot_free(a.consultor_id, p_new_start, a.id) then raise exception 'horario_indisponivel'; end if;
  v_local := p_new_start at time zone s.tz;
  v_end_local := (p_new_start + make_interval(mins => s.duration_min)) at time zone s.tz;
  update public.agenda_items
  set item_date = v_local::date, item_time = v_local::time, end_time = v_end_local::time, tz = s.tz,
      booking_event = 'remarcado', booking_seen_at = null
  where id = a.id;
  return jsonb_build_object('token', p_token, 'start', p_new_start, 'end', p_new_start + make_interval(mins => s.duration_min), 'tz', s.tz);
end;
$$;

revoke all on function public.booking_public_info(text, uuid) from public;
revoke all on function public.booking_slots(text, date, date) from public;
revoke all on function public.booking_create(text, timestamptz, text, text, text, text, uuid) from public;
revoke all on function public.booking_get(uuid) from public;
revoke all on function public.booking_cancel(uuid) from public;
revoke all on function public.booking_reschedule(uuid, timestamptz) from public;
grant execute on function public.booking_public_info(text, uuid) to anon, authenticated;
grant execute on function public.booking_slots(text, date, date) to anon, authenticated;
grant execute on function public.booking_create(text, timestamptz, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.booking_get(uuid) to anon, authenticated;
grant execute on function public.booking_cancel(uuid) to anon, authenticated;
grant execute on function public.booking_reschedule(uuid, timestamptz) to anon, authenticated;
