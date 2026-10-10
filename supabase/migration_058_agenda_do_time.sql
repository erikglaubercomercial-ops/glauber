-- ============================================================
-- MIGRAÇÃO 058 — Agenda do time (reuniões, tarefas e avisos).
--
-- Amplia agenda_items (criada na migração 016, usada pelo calendário do
-- Dashboard) para a nova tela "Agenda":
--   • end_time        horário de término
--   • location        link (Meet/Zoom) ou endereço
--   • lead_id         lead da reunião (vai para o histórico da ficha)
--   • status          agendada | realizada | nao_compareceu | remarcada | cancelada
--   • participant_ids colegas convidados (além do responsável = consultor_id)
--   • updated_at
-- Visibilidade: o time todo vê a agenda de todos (ADM, Gerente, Consultor, MKT,
-- Financeiro; Influencer só vê o que é dele). Edita/exclui: quem criou, o
-- responsável, ADM e Gerente. Convidado só visualiza.
-- Histórico do lead: agendar / realizar / cancelar / faltar / remarcar uma
-- reunião vinculada a um lead registra um evento na linha do tempo da ficha.
-- ============================================================

alter table public.agenda_items
  add column if not exists end_time time,
  add column if not exists location text not null default '',
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists status text not null default 'agendada',
  add column if not exists participant_ids uuid[] not null default '{}',
  add column if not exists updated_at timestamptz not null default now();

alter table public.agenda_items
  add constraint agenda_items_status_check
  check (status in ('agendada', 'realizada', 'nao_compareceu', 'remarcada', 'cancelada'));

create index if not exists agenda_items_date_idx on public.agenda_items (item_date);
create index if not exists agenda_items_lead_idx on public.agenda_items (lead_id) where lead_id is not null;

-- ---------------- políticas ----------------
drop policy if exists "ver agenda conforme função" on public.agenda_items;
drop policy if exists "autenticados criam itens de agenda" on public.agenda_items;
drop policy if exists "dono ou gestor edita item de agenda" on public.agenda_items;
drop policy if exists "dono ou gestor exclui item de agenda" on public.agenda_items;

create policy "agenda: time vê a agenda de todos"
  on public.agenda_items for select
  using (
    auth.role() = 'authenticated'
    and (
      public.current_role_name() in ('ADM', 'Gerente', 'Consultor', 'MKT', 'Financeiro')
      or consultor_id = auth.uid()
      or created_by = auth.uid()
      or auth.uid() = any (participant_ids)
    )
  );

create policy "agenda: autenticados criam"
  on public.agenda_items for insert
  with check (auth.role() = 'authenticated' and created_by = auth.uid());

create policy "agenda: criador, responsável e gestores editam"
  on public.agenda_items for update
  using (
    auth.role() = 'authenticated'
    and (created_by = auth.uid() or consultor_id = auth.uid() or public.current_role_name() in ('ADM', 'Gerente'))
  );

create policy "agenda: criador, responsável e gestores excluem"
  on public.agenda_items for delete
  using (
    auth.role() = 'authenticated'
    and (created_by = auth.uid() or consultor_id = auth.uid() or public.current_role_name() in ('ADM', 'Gerente'))
  );

-- ---------------- updated_at ----------------
create or replace function public.agenda_items_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger agenda_items_touch before update on public.agenda_items
  for each row execute function public.agenda_items_touch();

-- ---------------- histórico do lead ----------------
create or replace function public.evt_agenda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quando text;
  v_kind text;
  v_titulo text;
begin
  if new.lead_id is null or new.type <> 'reuniao' then
    return null;
  end if;
  v_quando := to_char(new.item_date, 'DD/MM/YYYY') || coalesce(' às ' || to_char(new.item_time, 'HH24:MI'), '');
  if tg_op = 'INSERT' then
    perform public.log_lead_event(new.lead_id, 'reuniao_agendada', 'Reunião agendada para ' || v_quando || ' · ' || new.title,
      'all', now(), 'agenda_items', new.id);
  elsif new.status is distinct from old.status and new.status <> 'agendada' then
    v_kind := 'reuniao_' || new.status;
    v_titulo := case new.status
      when 'realizada' then 'Reunião realizada'
      when 'cancelada' then 'Reunião cancelada'
      when 'nao_compareceu' then 'Cliente não compareceu à reunião'
      when 'remarcada' then 'Reunião remarcada'
      else 'Reunião' end;
    perform public.log_lead_event(new.lead_id, v_kind, v_titulo || ' (' || v_quando || ') · ' || new.title,
      'all', now(), 'agenda_items', new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.evt_agenda() from public, anon, authenticated;

create trigger evt_agenda after insert or update on public.agenda_items
  for each row execute function public.evt_agenda();
