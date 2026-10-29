-- ============================================================
-- MIGRAÇÃO 086 — Google Agenda: horários OCUPADOS bloqueiam o link de agendamento online.
-- Cada consultor cola o "Endereço secreto no formato iCal" do próprio Google Agenda (sem OAuth e sem aprovação do Google).
-- Uma função de borda (google-busy-sync) lê esse endereço a cada 10 minutos e guarda SÓ os intervalos ocupados (sem título,
-- sem convidados) em booking_external_busy; booking_slot_free passa a respeitar esses intervalos.
-- Nada muda para quem não conectar o Google.
-- ============================================================

-- endereço secreto de cada consultor (só o próprio dono enxerga/edita; ADM e Gerente NÃO leem o endereço)
create table public.booking_google_links (
  consultor_id uuid primary key references public.profiles(id) on delete cascade,
  ics_url text not null check (ics_url ~* '^https://calendar\.google\.com/'),
  enabled boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  busy_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.booking_google_links enable row level security;
create policy "google agenda: só o dono vê e altera"
  on public.booking_google_links for all
  using (consultor_id = auth.uid())
  with check (consultor_id = auth.uid());

-- intervalos ocupados vindos do Google (sem título). Sem política: o navegador não lê; só funções do banco e a função de borda.
create table public.booking_external_busy (
  consultor_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  primary key (consultor_id, starts_at, ends_at)
);
create index booking_external_busy_idx on public.booking_external_busy (consultor_id, ends_at);
alter table public.booking_external_busy enable row level security;

-- situação da ligação (sem o endereço) para o próprio consultor, ADM e Gerente
create or replace function public.booking_google_status(p_consultor uuid)
returns table (connected boolean, enabled boolean, last_sync_at timestamptz, busy_count integer, last_error text)
language sql
stable
security definer
set search_path = public
as $$
  select true, g.enabled, g.last_sync_at, g.busy_count, g.last_error
  from public.booking_google_links g
  where g.consultor_id = p_consultor
    and (p_consultor = auth.uid() or public.current_role_name() in ('ADM', 'Gerente'));
$$;
grant execute on function public.booking_google_status(uuid) to authenticated;

-- o horário só está livre se o Google do consultor também estiver livre
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

  if exists (
    select 1 from public.booking_blocks b
    where b.consultor_id = p_consultor
      and (p_start at time zone b.tz)::date >= b.date_from
      and (p_start at time zone b.tz)::date <= coalesce(b.date_to, date '9999-12-31')
      and (b.weekdays is null or cardinality(b.weekdays) = 0 or extract(dow from (p_start at time zone b.tz))::int = any (b.weekdays))
      and (b.all_day or ((p_start at time zone b.tz)::time < b.time_to and (v_end at time zone b.tz)::time > b.time_from))
  ) then return false; end if;

  -- ocupado no Google Agenda do consultor
  if exists (
    select 1 from public.booking_external_busy x
    where x.consultor_id = p_consultor
      and tstzrange(x.starts_at - make_interval(mins => s.buffer_min), x.ends_at + make_interval(mins => s.buffer_min)) && tstzrange(p_start, v_end)
  ) then return false; end if;

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

-- ao desconectar (ou desativar) a ligação, os horários ocupados guardados daquele consultor são apagados
create or replace function public.booking_google_links_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.enabled is false) then
    delete from public.booking_external_busy where consultor_id = coalesce(old.consultor_id, new.consultor_id);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger booking_google_links_cleanup
  after delete or update of enabled on public.booking_google_links
  for each row execute function public.booking_google_links_cleanup();

-- tarefa agendada: a cada 10 minutos chama a função google-busy-sync (só DEPOIS de a função estar publicada).
-- Usa a chave pública anon (a mesma de config.js); a função não devolve dados de ninguém nessa chamada.
-- select cron.schedule('google-busy-sync', '*/10 * * * *', $cron$
--   select net.http_post(
--     url := 'https://knfkrigpithcaaiutosj.supabase.co/functions/v1/google-busy-sync',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON KEY>'),
--     body := '{}'::jsonb);
-- $cron$);
