-- ============================================================
-- MIGRAÇÃO 059 — Aviso do time com destinatários e popup de leitura.
--
-- • team_announcements.recipients: para quem é o aviso. Valores aceitos:
--   todos, consultores, gerentes, mkt, time_brasil, time_latino.
-- • updated_at passa a ser definido pelo banco (gatilho) sempre que a
--   mensagem ou os destinatários mudam — é o "momento do envio".
-- • team_announcement_reads: quando cada pessoa confirmou a leitura. O popup
--   aparece na primeira entrada no sistema depois de cada envio (read_at
--   anterior ao updated_at) e some após "Entendi".
-- • team_announcement_mark_read(): registra a leitura da pessoa logada.
-- ============================================================

alter table public.team_announcements
  add column if not exists recipients text[] not null default array['todos'];

alter table public.team_announcements
  add constraint team_announcements_recipients_check
  check (recipients <@ array['todos', 'consultores', 'gerentes', 'mkt', 'time_brasil', 'time_latino']::text[]
         and cardinality(recipients) > 0);

create or replace function public.team_announcements_touch()
returns trigger language plpgsql as $$
begin
  if new.message is distinct from old.message or new.recipients is distinct from old.recipients then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger team_announcements_touch before update on public.team_announcements
  for each row execute function public.team_announcements_touch();

create table public.team_announcement_reads (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now()
);
alter table public.team_announcement_reads enable row level security;
create policy "leitura do aviso: cada um vê a própria"
  on public.team_announcement_reads for select
  using (user_id = auth.uid());

create or replace function public.team_announcement_mark_read()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.team_announcement_reads (user_id, read_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set read_at = now();
$$;
revoke all on function public.team_announcement_mark_read() from public, anon;
grant execute on function public.team_announcement_mark_read() to authenticated;
