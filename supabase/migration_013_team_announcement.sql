-- ============================================================
-- MIGRAÇÃO 013 — Dashboard: barra lateral direita com calendário
-- e avisos. "Aviso do time" é uma mensagem única (configuração,
-- mesmo padrão de commission_settings), editável só pelo ADM.
-- ============================================================

create table public.team_announcements (
  id integer primary key default 1,
  message text not null default '',
  updated_by_name text default '',
  updated_at timestamptz not null default now(),
  constraint team_announcements_single_row check (id = 1)
);
insert into public.team_announcements (id, message) values (1, '');

alter table public.team_announcements enable row level security;

create policy "aviso do time: autenticados leem"
  on public.team_announcements for select
  using (auth.role() = 'authenticated');

create policy "aviso do time: somente ADM atualiza"
  on public.team_announcements for update
  using (public.current_role_name() = 'ADM')
  with check (public.current_role_name() = 'ADM');
