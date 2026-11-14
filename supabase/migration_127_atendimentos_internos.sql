-- ============================================================
-- MIGRAÇÃO 127 — Mensagens internas viram conversas (atendimentos por assunto)
-- Substitui o modelo da migração 126 (que estava sem dados).
-- • Cada conversa tem assunto, participantes e status: aberta ou concluída.
-- • Quem envia pode abrir um novo assunto (nova conversa) ou responder uma existente.
-- • Responder a uma conversa concluída a reabre.
-- • Participantes veem a conversa; ADM vê todas.
-- • Anexos (PDF ou foto) no bucket privado "mensagens-internas".
-- ============================================================

drop function if exists public.mensagem_interna_enviar(text, text, uuid[], jsonb);
drop policy if exists mensagens_internas_read on storage.objects;
drop table if exists public.internal_message_attachments cascade;
drop table if exists public.internal_message_recipients cascade;
drop table if exists public.internal_messages cascade;

create table public.internal_threads (
  id uuid primary key default gen_random_uuid(),
  subject text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_author_id uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null
);
create index internal_threads_updated_idx on public.internal_threads (updated_at desc);

create table public.internal_thread_members (
  thread_id uuid not null references public.internal_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);
create index internal_thread_members_user_idx on public.internal_thread_members (user_id);

create table public.internal_thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.internal_threads(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null default '',
  created_at timestamptz not null default now()
);
create index internal_thread_messages_thread_idx on public.internal_thread_messages (thread_id, created_at);

create table public.internal_thread_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.internal_thread_messages(id) on delete cascade,
  thread_id uuid not null references public.internal_threads(id) on delete cascade,
  file_path text not null,
  file_name text not null default '',
  created_at timestamptz not null default now()
);

-- quem pode ver a conversa: participante ou ADM (security definer evita recursão nas políticas)
create or replace function public.atendimento_pode_ver(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_name() = 'ADM'
      or exists (select 1 from public.internal_thread_members m where m.thread_id = p_thread and m.user_id = auth.uid());
$$;

alter table public.internal_threads enable row level security;
alter table public.internal_thread_members enable row level security;
alter table public.internal_thread_messages enable row level security;
alter table public.internal_thread_attachments enable row level security;

drop policy if exists internal_threads_select on public.internal_threads;
create policy internal_threads_select on public.internal_threads for select to authenticated
  using (public.atendimento_pode_ver(id));

drop policy if exists internal_members_select on public.internal_thread_members;
create policy internal_members_select on public.internal_thread_members for select to authenticated
  using (public.atendimento_pode_ver(thread_id));

-- marcar como lida: só a própria linha
drop policy if exists internal_members_update on public.internal_thread_members;
create policy internal_members_update on public.internal_thread_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists internal_thread_messages_select on public.internal_thread_messages;
create policy internal_thread_messages_select on public.internal_thread_messages for select to authenticated
  using (public.atendimento_pode_ver(thread_id));

drop policy if exists internal_thread_attachments_select on public.internal_thread_attachments;
create policy internal_thread_attachments_select on public.internal_thread_attachments for select to authenticated
  using (public.atendimento_pode_ver(thread_id));

-- escrita só pelas funções abaixo (sem políticas de insert/update/delete nas tabelas de conversa)

-- abre um novo assunto: cria a conversa, a primeira mensagem, os participantes e os anexos
create or replace function public.atendimento_abrir(p_assunto text, p_mensagem text, p_para uuid[], p_arquivos jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_thread uuid := gen_random_uuid();
  v_msg uuid := gen_random_uuid();
  f jsonb;
begin
  if public.current_role_name() is null then raise exception 'sem_permissao'; end if;
  if trim(coalesce(p_assunto, '')) = '' then raise exception 'assunto_obrigatorio'; end if;
  if trim(coalesce(p_mensagem, '')) = '' then raise exception 'mensagem_vazia'; end if;
  insert into public.internal_threads (id, subject, status, created_by, last_author_id, updated_at)
    values (v_thread, left(trim(p_assunto), 150), 'open', v_me, v_me, now());
  insert into public.internal_thread_members (thread_id, user_id, last_read_at) values (v_thread, v_me, now());
  insert into public.internal_thread_members (thread_id, user_id)
    select distinct v_thread, u from unnest(coalesce(p_para, array[]::uuid[])) as u
     where u <> v_me and exists (select 1 from public.profiles p where p.id = u and p.active);
  if (select count(*) from public.internal_thread_members where thread_id = v_thread) < 2 then raise exception 'sem_destinatario'; end if;
  insert into public.internal_thread_messages (id, thread_id, author_id, body)
    values (v_msg, v_thread, v_me, left(trim(p_mensagem), 4000));
  for f in select * from jsonb_array_elements(coalesce(p_arquivos, '[]'::jsonb)) loop
    insert into public.internal_thread_attachments (message_id, thread_id, file_path, file_name)
      values (v_msg, v_thread, f ->> 'path', coalesce(f ->> 'name', ''));
  end loop;
  return v_thread;
end;
$$;

-- responde dentro de uma conversa (reabre se estiver concluída)
create or replace function public.atendimento_responder(p_thread uuid, p_mensagem text, p_arquivos jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_msg uuid := gen_random_uuid();
  f jsonb;
begin
  if public.current_role_name() is null or not public.atendimento_pode_ver(p_thread) then raise exception 'sem_permissao'; end if;
  if trim(coalesce(p_mensagem, '')) = '' and jsonb_array_length(coalesce(p_arquivos, '[]'::jsonb)) = 0 then raise exception 'mensagem_vazia'; end if;
  insert into public.internal_thread_members (thread_id, user_id, last_read_at) values (p_thread, v_me, now())
    on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;
  insert into public.internal_thread_messages (id, thread_id, author_id, body)
    values (v_msg, p_thread, v_me, left(trim(coalesce(p_mensagem, '')), 4000));
  for f in select * from jsonb_array_elements(coalesce(p_arquivos, '[]'::jsonb)) loop
    insert into public.internal_thread_attachments (message_id, thread_id, file_path, file_name)
      values (v_msg, p_thread, f ->> 'path', coalesce(f ->> 'name', ''));
  end loop;
  update public.internal_threads
     set updated_at = now(), last_author_id = v_me, status = 'open', closed_at = null, closed_by = null
   where id = p_thread;
  return v_msg;
end;
$$;

-- concluir ou reabrir o assunto
create or replace function public.atendimento_status(p_thread uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.atendimento_pode_ver(p_thread) then raise exception 'sem_permissao'; end if;
  if p_status not in ('open', 'closed') then raise exception 'status_invalido'; end if;
  update public.internal_threads
     set status = p_status,
         closed_at = case when p_status = 'closed' then now() else null end,
         closed_by = case when p_status = 'closed' then auth.uid() else null end
   where id = p_thread;
end;
$$;

revoke all on function public.atendimento_abrir(text, text, uuid[], jsonb) from public, anon;
revoke all on function public.atendimento_responder(uuid, text, jsonb) from public, anon;
revoke all on function public.atendimento_status(uuid, text) from public, anon;
revoke all on function public.atendimento_pode_ver(uuid) from public, anon;
grant execute on function public.atendimento_abrir(text, text, uuid[], jsonb) to authenticated;
grant execute on function public.atendimento_responder(uuid, text, jsonb) to authenticated;
grant execute on function public.atendimento_status(uuid, text) to authenticated;
grant execute on function public.atendimento_pode_ver(uuid) to authenticated;

-- leitura dos anexos pelo storage: quem pode ver a conversa
drop policy if exists mensagens_internas_read on storage.objects;
create policy mensagens_internas_read on storage.objects for select to authenticated
  using (bucket_id = 'mensagens-internas' and exists (
    select 1 from public.internal_thread_attachments a
     where a.file_path = storage.objects.name and public.atendimento_pode_ver(a.thread_id)));
