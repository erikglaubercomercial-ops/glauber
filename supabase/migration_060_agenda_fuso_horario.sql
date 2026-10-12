-- ============================================================
-- MIGRAÇÃO 060 — Agenda: fuso horário de cada compromisso.
--
-- agenda_items.tz: fuso em que o horário foi marcado — Brasília
-- (America/Sao_Paulo) ou Irlanda (Europe/Dublin). A tela mostra o horário
-- nos dois fusos com a bandeira de cada um. Compromissos já existentes ficam
-- em Brasília. O histórico do lead passa a indicar o fuso no texto.
-- ============================================================

alter table public.agenda_items
  add column if not exists tz text not null default 'America/Sao_Paulo';

alter table public.agenda_items
  add constraint agenda_items_tz_check check (tz in ('America/Sao_Paulo', 'Europe/Dublin'));

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
  v_quando := to_char(new.item_date, 'DD/MM/YYYY')
    || coalesce(' às ' || to_char(new.item_time, 'HH24:MI')
         || case new.tz when 'Europe/Dublin' then ' (horário da Irlanda)' else ' (horário de Brasília)' end, '');
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
