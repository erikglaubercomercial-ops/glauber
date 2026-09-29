-- ============================================================
-- MIGRAÇÃO 022 — rodízio automático de leads: todo lead novo sem
-- consultor definido é atribuído ao próximo da fila; se o consultor
-- não clicar no WhatsApp (primeiro contato) dentro do prazo configurado,
-- o lead é reatribuído automaticamente ao próximo. A reatribuição por
-- tempo esgotado roda no banco via pg_cron, então funciona mesmo com
-- ninguém de olho no CRM.
-- ============================================================

-- ---------- estado do rodízio no próprio lead ----------
alter table public.leads add column if not exists rotation_active boolean not null default false;
alter table public.leads add column if not exists rotation_assigned_at timestamptz;
alter table public.leads add column if not exists rotation_deadline timestamptz;
alter table public.leads add column if not exists rotation_reassign_count integer not null default 0;

-- ---------- configuração (linha única, mesmo padrão de team_announcements) ----------
create table public.lead_rotation_settings (
  id integer primary key default 1,
  enabled boolean not null default false,
  timeout_hours numeric not null default 24,
  member_user_ids uuid[] not null default '{}',
  next_position integer not null default 0,
  updated_by_name text default '',
  updated_at timestamptz not null default now(),
  constraint lead_rotation_settings_single_row check (id = 1)
);
insert into public.lead_rotation_settings (id) values (1);

alter table public.lead_rotation_settings enable row level security;

create policy "lead_rotation_settings: autenticados leem"
  on public.lead_rotation_settings for select
  using (auth.role() = 'authenticated');

create policy "lead_rotation_settings: somente ADM atualiza"
  on public.lead_rotation_settings for update
  using (public.current_role_name() = 'ADM')
  with check (public.current_role_name() = 'ADM');

-- ---------- atribui um lead ao próximo da fila (chamada pelo app ao criar um lead sem consultor) ----------
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
  select * into v_settings from public.lead_rotation_settings where id = 1 for update;

  if v_settings.enabled and coalesce(array_length(v_settings.member_user_ids, 1), 0) > 0 then
    v_count := array_length(v_settings.member_user_ids, 1);
    v_member_id := v_settings.member_user_ids[(v_settings.next_position % v_count) + 1];

    update public.lead_rotation_settings
    set next_position = v_settings.next_position + 1, updated_at = now()
    where id = 1;

    update public.leads
    set consultor_id = v_member_id,
        rotation_active = true,
        rotation_assigned_at = now(),
        rotation_deadline = now() + (v_settings.timeout_hours || ' hours')::interval
    where id = p_lead_id
    returning * into v_result;
  else
    select * into v_result from public.leads where id = p_lead_id;
  end if;

  return v_result;
end;
$$;

grant execute on function public.assign_lead_rotation(uuid) to authenticated;

-- ---------- reatribui leads vencidos ao próximo da fila (chamada só pelo pg_cron) ----------
create or replace function public.reassign_overdue_rotation_leads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.lead_rotation_settings;
  v_count integer;
  v_member_id uuid;
  v_lead_id uuid;
  v_reassigned integer := 0;
begin
  select * into v_settings from public.lead_rotation_settings where id = 1 for update;

  if not v_settings.enabled or coalesce(array_length(v_settings.member_user_ids, 1), 0) = 0 then
    return 0;
  end if;
  v_count := array_length(v_settings.member_user_ids, 1);

  for v_lead_id in
    select id from public.leads
    where rotation_active = true
      and rotation_deadline is not null
      and rotation_deadline < now()
    for update
  loop
    v_member_id := v_settings.member_user_ids[(v_settings.next_position % v_count) + 1];
    v_settings.next_position := v_settings.next_position + 1;

    update public.leads
    set consultor_id = v_member_id,
        rotation_assigned_at = now(),
        rotation_deadline = now() + (v_settings.timeout_hours || ' hours')::interval,
        rotation_reassign_count = coalesce(rotation_reassign_count, 0) + 1
    where id = v_lead_id;

    v_reassigned := v_reassigned + 1;
  end loop;

  update public.lead_rotation_settings
  set next_position = v_settings.next_position, updated_at = now()
  where id = 1;

  return v_reassigned;
end;
$$;

-- ---------- agenda a checagem a cada 15 minutos ----------
create extension if not exists pg_cron;

select cron.schedule(
  'lead-rotation-reassign',
  '*/15 * * * *',
  $$select public.reassign_overdue_rotation_leads();$$
);
