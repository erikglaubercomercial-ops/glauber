-- ============================================================
-- MIGRAÇÃO 055 — o aluno envia os documentos da jornada pela Área do Aluno.
--
-- • bucket privado student-docs (arquivos em <id da matrícula>/<tipo>-<data>.<ext>)
-- • o aluno só envia/abre arquivos da PRÓPRIA matrícula; a equipe que enxerga o
--   lead abre os arquivos pela ficha do cliente
-- • enrollment_documents ganha arquivo, nome e data do envio; novo tipo "visto"
-- • aluno_documentos() lista os documentos do aluno; aluno_registrar_documento()
--   registra o envio (e marca o documento como em mãos)
-- ============================================================

create or replace function public.safe_uuid(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

insert into storage.buckets (id, name, public) values ('student-docs', 'student-docs', false) on conflict (id) do nothing;

alter table public.enrollment_documents
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists uploaded_at timestamptz,
  add column if not exists uploaded_by_student boolean not null default false;
alter table public.enrollment_documents drop constraint if exists enrollment_documents_kind_check;
alter table public.enrollment_documents add constraint enrollment_documents_kind_check
  check (kind in ('passaporte', 'passagens', 'comprovante_financeiro', 'matricula_seguros', 'visto'));

create policy "student-docs: aluno envia nos próprios documentos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'student-docs' and (storage.foldername(name))[1] in (select e::text from public.aluno_enrollment_ids() e));
create policy "student-docs: aluno lê os próprios documentos"
  on storage.objects for select to authenticated
  using (bucket_id = 'student-docs' and (storage.foldername(name))[1] in (select e::text from public.aluno_enrollment_ids() e));
create policy "student-docs: equipe lê pela ficha"
  on storage.objects for select to authenticated
  using (bucket_id = 'student-docs' and public.can_see_enrollment(public.safe_uuid((storage.foldername(name))[1])));

create or replace function public.aluno_documentos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare e record;
begin
  select id, passport_photo_path into e from public.enrollments where student_user_id = auth.uid() order by created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'enrollment_id', e.id,
    'passport_legacy', e.passport_photo_path is not null,
    'docs', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'received', d.received, 'file_name', d.file_name,
              'file_path', d.file_path, 'uploaded_at', d.uploaded_at, 'by_student', d.uploaded_by_student))
            from public.enrollment_documents d where d.enrollment_id = e.id), '[]'::jsonb));
end;
$$;
revoke all on function public.aluno_documentos() from public, anon;
grant execute on function public.aluno_documentos() to authenticated;

create or replace function public.aluno_registrar_documento(p_kind text, p_path text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_enr uuid;
begin
  select id into v_enr from public.enrollments where student_user_id = auth.uid() order by created_at desc limit 1;
  if v_enr is null then raise exception 'sem_matricula'; end if;
  if p_kind not in ('passaporte', 'passagens', 'comprovante_financeiro', 'matricula_seguros', 'visto') then raise exception 'tipo_invalido'; end if;
  if left(coalesce(p_path, ''), length(v_enr::text) + 1) <> v_enr::text || '/' then raise exception 'caminho_invalido'; end if;
  insert into public.enrollment_documents (enrollment_id, kind, received, received_at, file_path, file_name, uploaded_at, uploaded_by_student)
  values (v_enr, p_kind, true, now(), p_path, left(coalesce(p_name, ''), 200), now(), true)
  on conflict (enrollment_id, kind) do update set
    received = true, received_at = now(), file_path = excluded.file_path, file_name = excluded.file_name,
    uploaded_at = now(), uploaded_by_student = true;
end;
$$;
revoke all on function public.aluno_registrar_documento(text, text, text) from public, anon;
grant execute on function public.aluno_registrar_documento(text, text, text) to authenticated;

create or replace function public.evt_ficha_extras()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  if tg_table_name = 'lead_followups' then
    if tg_op = 'INSERT' then
      perform public.log_lead_event(new.lead_id, 'followup_agendado', 'Follow-up agendado: ' || new.kind || ' em ' || to_char(new.due_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
        'all', now(), 'lead_followups', new.id);
    elsif new.done and not old.done then
      perform public.log_lead_event(new.lead_id, 'followup_concluido', 'Follow-up concluído: ' || new.kind, 'all', coalesce(new.done_at, now()));
    end if;
  elsif tg_table_name = 'lead_notes' then
    perform public.log_lead_event(new.lead_id, 'nota', 'Anotação de ' || coalesce(nullif(new.author_name, ''), 'equipe'), 'all', new.created_at, 'lead_notes', new.id);
  elsif tg_table_name = 'enrollment_documents' then
    select lead_id into v_lead from public.enrollments where id = new.enrollment_id;
    if new.received and (tg_op = 'INSERT' or not old.received) then
      perform public.log_lead_event(v_lead, 'documento', case when new.uploaded_by_student then 'Aluno enviou o documento: ' else 'Documento em mãos: ' end ||
        case new.kind when 'passaporte' then 'passaporte válido' when 'passagens' then 'passagens aéreas'
                      when 'comprovante_financeiro' then 'comprovante financeiro' when 'visto' then 'visto de estudante' else 'matrícula da escola com seguros' end,
        'all', coalesce(new.received_at, now()));
    end if;
  elsif tg_table_name = 'enrollments' then
    if new.pre_embark_at is not null and new.pre_embark_at is distinct from old.pre_embark_at and new.lead_id is not null then
      perform public.log_lead_event(new.lead_id, 'reuniao_pre_embarque', 'Reunião de pré-embarque agendada para ' || to_char(new.pre_embark_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), 'all', now());
    end if;
  end if;
  return null;
end; $$;

create or replace function public.lead_ficha(p_lead uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.leads;
  d public.deals;
  q public.quotes;
  c public.contracts;
  e public.enrollments;
  v_fin boolean := public.has_module_access('financeiro');
  v_consultor jsonb;
  v_recs jsonb := '[]'::jsonb;
  v_comm jsonb := null;
  v_split jsonb := null;
  v_transfers jsonb := null;
  v_docs jsonb := '[]'::jsonb;
  v_portal jsonb := null;
  v_alerts jsonb := '[]'::jsonb;
  v_enr jsonb := null;
  v_paid numeric := 0;
  v_settings jsonb;
begin
  if not public.can_see_lead(p_lead) then
    raise exception 'sem_acesso';
  end if;
  select * into l from public.leads where id = p_lead;
  select jsonb_build_object('id', p.id, 'name', p.name) into v_consultor from public.profiles p where p.id = l.consultor_id;
  select * into d from public.deals where lead_id = p_lead order by created_at desc limit 1;
  select * into q from public.quotes where lead_id = p_lead order by created_at desc limit 1;
  select * into c from public.contracts where lead_id = p_lead and modo = 'proposta' order by created_at desc limit 1;
  select * into e from public.enrollments where lead_id = p_lead order by created_at desc limit 1;
  select to_jsonb(s) into v_settings from public.journey_settings s where id = 1;

  if d.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('numero', r.installment_number, 'total', r.installments_total, 'valor', r.amount,
             'vencimento', r.due_date, 'pago', r.paid, 'pago_em', r.paid_at) order by r.due_date, r.installment_number), '[]'::jsonb),
           coalesce(sum(r.amount) filter (where r.paid), 0)
      into v_recs, v_paid from public.receivables r where r.deal_id = d.id;
    select jsonb_build_object('amount', cm.amount, 'percentage', cm.percentage, 'status', cm.status,
             'released', public.commission_released(d.id), 'paid_by_client', v_paid,
             'min', (select release_min_paid from public.commission_settings where id = 1))
      into v_comm from public.commissions cm where cm.deal_id = d.id;
    if v_fin then
      select to_jsonb(sp) into v_split from public.sale_splits sp where sp.deal_id = d.id;
    end if;
  end if;

  if e.id is not null then
    v_enr := jsonb_build_object(
      'id', e.id, 'name', e.name, 'email', e.email, 'phone', e.phone, 'passport_number', e.passport_number,
      'passport_issue_date', e.passport_issue_date, 'passport_expiry_date', e.passport_expiry_date,
      'passport_photo_path', e.passport_photo_path, 'school', e.school, 'turno', e.turno, 'course_value', e.course_value,
      'arrival_date', e.arrival_date, 'class_start_date', e.class_start_date, 'status', e.status,
      'matricula_pendente', e.matricula_pendente, 'pre_embark_at', e.pre_embark_at, 'created_at', e.created_at);
    select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'received', x.received, 'received_at', x.received_at, 'note', x.note,
             'file_path', x.file_path, 'file_name', x.file_name, 'uploaded_at', x.uploaded_at, 'by_student', x.uploaded_by_student)), '[]'::jsonb)
      into v_docs from public.enrollment_documents x where x.enrollment_id = e.id;
    select coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'acked_at', a.acked_at, 'snoozed_until', a.snoozed_until)), '[]'::jsonb)
      into v_alerts from public.departure_alerts a where a.enrollment_id = e.id;
    v_portal := jsonb_build_object(
      'active', e.student_user_id is not null,
      'login', (select u.email from auth.users u where u.id = e.student_user_id),
      'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id = e.student_user_id),
      'messages_total', (select count(*) from public.aluno_mensagens m where m.enrollment_id = e.id),
      'unread_from_student', (select count(*) from public.aluno_mensagens m where m.enrollment_id = e.id and m.autor = 'aluno' and not m.lida));
    if v_fin then
      select jsonb_build_object('total', coalesce(sum(t.amount), 0),
               'items', coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'amount', t.amount, 'sent_at', t.sent_at, 'notes', t.notes) order by t.sent_at), '[]'::jsonb))
        into v_transfers from public.school_transfers t where t.enrollment_id = e.id;
    end if;
  end if;

  return jsonb_build_object(
    'lead', to_jsonb(l),
    'consultor', v_consultor,
    'deal', case when d.id is null then null else jsonb_build_object('id', d.id, 'stage', d.stage,
              'stage_label', (select label from public.pipeline_stages where id = d.stage), 'value', d.value,
              'closed_at', d.closed_at, 'created_at', d.created_at) end,
    'quote', case when q.id is null then null else jsonb_build_object('id', q.id, 'numero', q.numero, 'value', q.value, 'status', q.status,
              'aprovada_em', q.aprovada_em, 'created_at', q.created_at) end,
    'contract', case when c.id is null then null else jsonb_build_object('id', c.id, 'numero', c.numero, 'status', c.status,
              'signed_at', c.signed_at, 'created_at', c.created_at) end,
    'enrollment', v_enr,
    'receivables', v_recs,
    'commission', v_comm,
    'split', v_split,
    'school_transfers', v_transfers,
    'documents', v_docs,
    'portal', v_portal,
    'alerts', v_alerts,
    'followups', (select coalesce(jsonb_agg(to_jsonb(f) order by f.done, f.due_at), '[]'::jsonb)
                  from (select * from public.lead_followups where lead_id = p_lead order by done, due_at limit 60) f),
    'notes', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
              from (select id, author_name, body, created_at from public.lead_notes where lead_id = p_lead order by created_at desc limit 60) n),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', ev.id, 'kind', ev.kind, 'title', ev.title, 'occurred_at', ev.occurred_at) order by ev.occurred_at desc), '[]'::jsonb)
               from (select * from public.lead_events where lead_id = p_lead and (visibility = 'all' or v_fin) order by occurred_at desc limit 200) ev),
    'settings', v_settings,
    'viewer', jsonb_build_object('role', public.current_role_name(), 'financeiro', v_fin, 'id', auth.uid())
  );
end;
$$;
