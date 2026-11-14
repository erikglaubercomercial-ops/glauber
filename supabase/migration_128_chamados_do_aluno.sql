-- ============================================================
-- MIGRAÇÃO 128 — Adicionar pessoas em conversas + chamados abertos pelo aluno
-- • atendimento_adicionar: quem participa (ou ADM) inclui mais pessoas na conversa.
-- • Chamado do aluno: aberto na área do aluno, vira uma conversa (origin = 'aluno') ligada à matrícula.
--   O consultor do cliente entra automaticamente; ADM vê todos. Mensagens do aluno ficam sem autor de equipe
--   (author_id nulo, autor_aluno = true).
-- • O aluno só lê e escreve pelos próprios chamados, por funções seguras (nunca direto nas tabelas).
-- ============================================================

alter table public.internal_threads add column if not exists enrollment_id uuid references public.enrollments(id) on delete set null;
alter table public.internal_threads add column if not exists origin text not null default 'interno' check (origin in ('interno', 'aluno'));
alter table public.internal_thread_messages add column if not exists autor_nome text not null default '';
alter table public.internal_thread_messages add column if not exists autor_aluno boolean not null default false;
create index if not exists internal_threads_enrollment_idx on public.internal_threads (enrollment_id);

-- inclui pessoas numa conversa que já existe (quem participa ou o ADM)
create or replace function public.atendimento_adicionar(p_thread uuid, p_users uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_added uuid[];
  v_names text;
begin
  if not public.atendimento_pode_ver(p_thread) then raise exception 'sem_permissao'; end if;
  select array_agg(distinct u) into v_added
    from unnest(coalesce(p_users, array[]::uuid[])) as u
   where u <> v_me
     and exists (select 1 from public.profiles p where p.id = u and p.active)
     and not exists (select 1 from public.internal_thread_members m where m.thread_id = p_thread and m.user_id = u);
  if v_added is null then raise exception 'sem_pessoas_novas'; end if;
  insert into public.internal_thread_members (thread_id, user_id)
    select p_thread, u from unnest(v_added) as u
    on conflict (thread_id, user_id) do nothing;
  select string_agg(p.name, ', ' order by p.name) into v_names from public.profiles p where p.id = any (v_added);
  insert into public.internal_thread_messages (thread_id, author_id, body, autor_nome)
    values (p_thread, v_me, 'Adicionou à conversa: ' || coalesce(v_names, ''), '');
  update public.internal_threads set updated_at = now(), last_author_id = v_me where id = p_thread;
end;
$$;

-- aluno abre um chamado (assunto + mensagem)
create or replace function public.aluno_chamado_abrir(p_assunto text, p_mensagem text, p_enr uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.enrollments;
  v_thread uuid := gen_random_uuid();
  v_consultor uuid;
begin
  if p_enr is not null then raise exception 'somente_leitura'; end if;
  e := public.portal_matricula_alvo(null);
  if e.id is null then raise exception 'sem_matricula'; end if;
  if trim(coalesce(p_assunto, '')) = '' then raise exception 'assunto_obrigatorio'; end if;
  if trim(coalesce(p_mensagem, '')) = '' then raise exception 'mensagem_vazia'; end if;
  select l.consultor_id into v_consultor from public.leads l where l.id = e.lead_id;
  insert into public.internal_threads (id, subject, status, origin, enrollment_id, last_author_id, updated_at)
    values (v_thread, left(trim(p_assunto), 150), 'open', 'aluno', e.id, null, now());
  if v_consultor is not null and exists (select 1 from public.profiles p where p.id = v_consultor and p.active) then
    insert into public.internal_thread_members (thread_id, user_id) values (v_thread, v_consultor);
  end if;
  insert into public.internal_thread_messages (thread_id, author_id, body, autor_nome, autor_aluno)
    values (v_thread, null, left(trim(p_mensagem), 4000), coalesce(e.name, ''), true);
  return v_thread;
end;
$$;

-- aluno responde num dos próprios chamados (reabre se a equipe já tiver concluído)
create or replace function public.aluno_chamado_responder(p_thread uuid, p_mensagem text, p_enr uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.enrollments;
begin
  if p_enr is not null then raise exception 'somente_leitura'; end if;
  e := public.portal_matricula_alvo(null);
  if e.id is null then raise exception 'sem_matricula'; end if;
  if not exists (select 1 from public.internal_threads t where t.id = p_thread and t.origin = 'aluno' and t.enrollment_id = e.id) then
    raise exception 'sem_permissao';
  end if;
  if trim(coalesce(p_mensagem, '')) = '' then raise exception 'mensagem_vazia'; end if;
  insert into public.internal_thread_messages (thread_id, author_id, body, autor_nome, autor_aluno)
    values (p_thread, null, left(trim(p_mensagem), 4000), coalesce(e.name, ''), true);
  update public.internal_threads
     set updated_at = now(), last_author_id = null, status = 'open', closed_at = null, closed_by = null
   where id = p_thread;
end;
$$;

-- lista os chamados do aluno com as mensagens (nomes da equipe vêm dos perfis)
create or replace function public.aluno_chamados_listar(p_enr uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e public.enrollments;
  v_out jsonb;
begin
  e := public.portal_matricula_alvo(p_enr);
  if e.id is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(s.x order by s.upd desc), '[]'::jsonb) into v_out from (
    select t.updated_at as upd,
           jsonb_build_object(
             'id', t.id, 'subject', t.subject, 'status', t.status, 'updated_at', t.updated_at,
             'messages', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', m.id, 'autor_aluno', m.autor_aluno,
                        'autor_nome', case when m.autor_aluno then m.autor_nome else coalesce(p.name, 'Equipe') end,
                        'body', m.body, 'created_at', m.created_at) order by m.created_at)
                 from public.internal_thread_messages m
                 left join public.profiles p on p.id = m.author_id
                where m.thread_id = t.id), '[]'::jsonb)) as x
      from public.internal_threads t
     where t.origin = 'aluno' and t.enrollment_id = e.id
  ) s;
  return v_out;
end;
$$;

revoke all on function public.atendimento_adicionar(uuid, uuid[]) from public, anon;
revoke all on function public.aluno_chamado_abrir(text, text, uuid) from public, anon;
revoke all on function public.aluno_chamado_responder(uuid, text, uuid) from public, anon;
revoke all on function public.aluno_chamados_listar(uuid) from public, anon;
grant execute on function public.atendimento_adicionar(uuid, uuid[]) to authenticated;
grant execute on function public.aluno_chamado_abrir(text, text, uuid) to authenticated;
grant execute on function public.aluno_chamado_responder(uuid, text, uuid) to authenticated;
grant execute on function public.aluno_chamados_listar(uuid) to authenticated;
