-- ============================================================
-- MIGRAÇÃO 129 — Papel "Suporte" + chamado do aluno sem consultor
-- • Novo papel Suporte (sem acesso a módulos por padrão; as permissões são configuradas pelo ADM).
-- • Chamado do aluno sem consultor: entra para ADM, Gerentes e Suporte.
-- ============================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['ADM'::text, 'Gerente'::text, 'Consultor'::text, 'Influencer'::text, 'MKT'::text, 'Financeiro'::text, 'Suporte'::text]));

alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role = any (array['Gerente'::text, 'Consultor'::text, 'Influencer'::text, 'MKT'::text, 'Financeiro'::text, 'Suporte'::text]));

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
  else
    -- sem consultor: ADM, Gerentes e Suporte recebem o chamado
    insert into public.internal_thread_members (thread_id, user_id)
      select v_thread, p.id from public.profiles p
       where p.active and p.role in ('ADM', 'Gerente', 'Suporte')
      on conflict (thread_id, user_id) do nothing;
  end if;
  insert into public.internal_thread_messages (thread_id, author_id, body, autor_nome, autor_aluno)
    values (v_thread, null, left(trim(p_mensagem), 4000), coalesce(e.name, ''), true);
  return v_thread;
end;
$$;
