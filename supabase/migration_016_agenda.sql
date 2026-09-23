-- ============================================================
-- MIGRAÇÃO 016 — Agenda do Dashboard: tarefas, reuniões e avisos
-- criados ao clicar numa data do calendário, opcionalmente já
-- atribuídos a um consultor. `google_event_id` fica reservado para
-- a sincronização com o Google Calendar de cada consultor (próxima
-- etapa, depois que o Client ID OAuth for configurado).
-- ============================================================

create table public.agenda_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'tarefa' check (type in ('tarefa','reuniao','aviso')),
  item_date date not null,
  item_time time,
  consultor_id uuid references public.profiles(id) on delete set null,
  notes text default '',
  done boolean not null default false,
  google_event_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.agenda_items enable row level security;

create policy "ver agenda conforme função"
  on public.agenda_items for select
  using (
    auth.role() = 'authenticated'
    and (
      public.current_role_name() <> 'Consultor'
      or consultor_id = auth.uid()
      or created_by = auth.uid()
    )
  );

create policy "autenticados criam itens de agenda"
  on public.agenda_items for insert
  with check (auth.role() = 'authenticated');

create policy "dono ou gestor edita item de agenda"
  on public.agenda_items for update
  using (
    auth.role() = 'authenticated'
    and (
      created_by = auth.uid()
      or consultor_id = auth.uid()
      or public.current_role_name() in ('ADM','Gerente')
    )
  );

create policy "dono ou gestor exclui item de agenda"
  on public.agenda_items for delete
  using (
    auth.role() = 'authenticated'
    and (
      created_by = auth.uid()
      or consultor_id = auth.uid()
      or public.current_role_name() in ('ADM','Gerente')
    )
  );
