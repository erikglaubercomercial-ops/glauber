-- ============================================================
-- MIGRAÇÃO 126 — Mensagens internas (caixa de entrada entre usuários do CRM)
-- • Qualquer usuário ativo pode enviar para uma ou mais pessoas (ou para todos).
-- • Cada pessoa vê só as mensagens que enviou ou recebeu.
-- • Anexos (PDF ou foto) ficam no bucket privado "mensagens-internas".
-- • O envio passa pela função mensagem_interna_enviar (grava mensagem, destinatários e anexos juntos).
-- ============================================================

create table if not exists public.internal_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null default '',
  body text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.internal_message_recipients (
  message_id uuid not null references public.internal_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  primary key (message_id, user_id)
);
create index if not exists internal_message_recipients_user_idx on public.internal_message_recipients (user_id, read_at);

create table if not exists public.internal_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.internal_messages(id) on delete cascade,
  file_path text not null,
  file_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.internal_messages enable row level security;
alter table public.internal_message_recipients enable row level security;
alter table public.internal_message_attachments enable row level security;

-- leitura: remetente ou destinatário
drop policy if exists internal_messages_select on public.internal_messages;
create policy internal_messages_select on public.internal_messages for select to authenticated
  using (sender_id = auth.uid() or exists (select 1 from public.internal_message_recipients r where r.message_id = internal_messages.id and r.user_id = auth.uid()));

drop policy if exists internal_recipients_select on public.internal_message_recipients;
create policy internal_recipients_select on public.internal_message_recipients for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.internal_messages m where m.id = internal_message_recipients.message_id and m.sender_id = auth.uid()));

-- marcar como lida: só o próprio destinatário
drop policy if exists internal_recipients_update on public.internal_message_recipients;
create policy internal_recipients_update on public.internal_message_recipients for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists internal_attachments_select on public.internal_message_attachments;
create policy internal_attachments_select on public.internal_message_attachments for select to authenticated
  using (exists (select 1 from public.internal_messages m where m.id = internal_message_attachments.message_id and (m.sender_id = auth.uid()
    or exists (select 1 from public.internal_message_recipients r where r.message_id = m.id and r.user_id = auth.uid()))));

-- sem políticas de insert/delete nas tabelas: o envio é feito só pela função abaixo

create or replace function public.mensagem_interna_enviar(p_subject text, p_body text, p_to uuid[], p_files jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_me uuid := auth.uid();
  f jsonb;
begin
  if public.current_role_name() is null then raise exception 'sem_permissao'; end if;
  if coalesce(trim(p_body), '') = '' and coalesce(trim(p_subject), '') = '' then raise exception 'mensagem_vazia'; end if;
  insert into public.internal_messages (id, sender_id, subject, body)
    values (v_id, v_me, left(trim(coalesce(p_subject, '')), 150), left(trim(coalesce(p_body, '')), 4000));
  insert into public.internal_message_recipients (message_id, user_id)
    select distinct v_id, u from unnest(coalesce(p_to, array[]::uuid[])) as u
     where u <> v_me and exists (select 1 from public.profiles p where p.id = u and p.active);
  if not exists (select 1 from public.internal_message_recipients where message_id = v_id) then raise exception 'sem_destinatario'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    insert into public.internal_message_attachments (message_id, file_path, file_name)
      values (v_id, f ->> 'path', coalesce(f ->> 'name', ''));
  end loop;
  return v_id;
end;
$$;
revoke all on function public.mensagem_interna_enviar(text, text, uuid[], jsonb) from public, anon;
grant execute on function public.mensagem_interna_enviar(text, text, uuid[], jsonb) to authenticated;

-- bucket privado para os anexos
insert into storage.buckets (id, name, public) values ('mensagens-internas', 'mensagens-internas', false)
  on conflict (id) do nothing;

-- upload: cada pessoa só envia para a própria pasta (uid/arquivo)
drop policy if exists mensagens_internas_upload on storage.objects;
create policy mensagens_internas_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'mensagens-internas' and (storage.foldername(name))[1] = auth.uid()::text);

-- leitura: remetente e destinatários do anexo
drop policy if exists mensagens_internas_read on storage.objects;
create policy mensagens_internas_read on storage.objects for select to authenticated
  using (bucket_id = 'mensagens-internas' and exists (
    select 1 from public.internal_message_attachments a
      join public.internal_messages m on m.id = a.message_id
     where a.file_path = storage.objects.name
       and (m.sender_id = auth.uid() or exists (select 1 from public.internal_message_recipients r where r.message_id = m.id and r.user_id = auth.uid()))));
