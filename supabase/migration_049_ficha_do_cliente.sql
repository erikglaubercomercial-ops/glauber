-- ============================================================
-- MIGRAÇÃO 049 — ficha do cliente (jornada completa do lead).
--
-- • lead_notes       anotações do lead (histórico com autor, data e hora)
-- • lead_followups   follow-ups agendados (com hora e aviso por popup)
-- • enrollment_documents  conferência dos documentos de embarque
-- • enrollments.pre_embark_at  reunião de pré-embarque
-- • departure_alerts avisos de 40 e 15 dias (marcados como resolvidos pela equipe)
-- • journey_settings valores configuráveis (comprovante € 6.665, 6 meses de passaporte,
--   aviso 40 dias, reunião 15 dias)
-- • lead_ficha(lead)       consulta única que cruza TUDO do lead na hora de abrir
-- • lead_ficha_dados(lead) dados pessoais completos (só ao clicar em "Ver todos os dados")
-- Regras de visibilidade: quem enxerga o lead enxerga a ficha; envio à escola e
-- partilha da venda só para quem acessa o Financeiro.
-- ============================================================

-- ---------- apoio de permissão ----------
create or replace function public.can_see_lead(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_module_access('leads')
     and exists (select 1 from public.leads l
                 where l.id = p_lead and (public.current_role_name() <> 'Consultor' or l.consultor_id = auth.uid()));
$$;
grant execute on function public.can_see_lead(uuid) to authenticated;

create or replace function public.can_see_enrollment(p_enr uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.enrollments e
    where e.id = p_enr
      and ((e.lead_id is not null and public.can_see_lead(e.lead_id))
           or (public.has_module_access('matriculas') and public.current_role_name() <> 'Consultor'))
  );
$$;
grant execute on function public.can_see_enrollment(uuid) to authenticated;

-- ---------- configurações da jornada ----------
create table public.journey_settings (
  id integer primary key default 1 check (id = 1),
  financial_proof_eur numeric(12,2) not null default 6665,
  passport_min_months integer not null default 6,
  alert_days integer not null default 40,
  meeting_days integer not null default 15
);
insert into public.journey_settings (id) values (1);
alter table public.journey_settings enable row level security;
create policy "journey_settings: leitura" on public.journey_settings for select using (auth.role() = 'authenticated');
create policy "journey_settings: só ADM altera" on public.journey_settings for update using (public.current_role_name() = 'ADM');

-- ---------- reunião de pré-embarque ----------
alter table public.enrollments add column if not exists pre_embark_at timestamptz;

-- ---------- anotações ----------
create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_id uuid default auth.uid(),
  author_name text not null default '',
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index lead_notes_lead_idx on public.lead_notes(lead_id, created_at desc);
alter table public.lead_notes enable row level security;
create policy "lead_notes: leitura" on public.lead_notes for select using (public.can_see_lead(lead_id));
create policy "lead_notes: criação" on public.lead_notes for insert with check (public.can_see_lead(lead_id));
create policy "lead_notes: só ADM exclui" on public.lead_notes for delete using (public.current_role_name() = 'ADM');

-- ---------- follow-ups ----------
create table public.lead_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null default 'Ligação',
  note text not null default '',
  due_at timestamptz not null,
  remind_minutes integer not null default 0,
  snoozed_until timestamptz,
  done boolean not null default false,
  done_at timestamptz,
  consultor_id uuid references public.profiles(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index lead_followups_lead_idx on public.lead_followups(lead_id, due_at);
create index lead_followups_open_idx on public.lead_followups(consultor_id, due_at) where not done;
alter table public.lead_followups enable row level security;
create policy "lead_followups: leitura" on public.lead_followups for select using (public.can_see_lead(lead_id));
create policy "lead_followups: criação" on public.lead_followups for insert with check (public.can_see_lead(lead_id));
create policy "lead_followups: edição" on public.lead_followups for update using (public.can_see_lead(lead_id)) with check (public.can_see_lead(lead_id));
create policy "lead_followups: exclusão" on public.lead_followups for delete using (public.can_see_lead(lead_id));

-- o botão de follow-up do card do Pipeline (deals.follow_up_at) passa a gerar um follow-up da ficha
create or replace function public.deals_followup_para_ficha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_cons uuid;
begin
  if new.lead_id is null or new.follow_up_at is null then return null; end if;
  if tg_op = 'UPDATE' and new.follow_up_at is not distinct from old.follow_up_at then return null; end if;
  select consultor_id into v_cons from public.leads where id = new.lead_id;
  if not exists (select 1 from public.lead_followups f where f.deal_id = new.id and not f.done
                 and (f.due_at at time zone 'America/Sao_Paulo')::date = new.follow_up_at) then
    insert into public.lead_followups (lead_id, kind, note, due_at, consultor_id, deal_id)
    values (new.lead_id, 'Follow-up', 'Marcado no Pipeline', (new.follow_up_at::text || ' 09:00')::timestamp at time zone 'America/Sao_Paulo',
            coalesce(v_cons, new.consultor_id), new.id);
  end if;
  return null;
end;
$$;
create trigger deals_followup_para_ficha
  after insert or update of follow_up_at on public.deals
  for each row execute function public.deals_followup_para_ficha();

insert into public.lead_followups (lead_id, kind, note, due_at, consultor_id, deal_id)
select d.lead_id, 'Follow-up', 'Marcado no Pipeline', (d.follow_up_at::text || ' 09:00')::timestamp at time zone 'America/Sao_Paulo',
       coalesce(l.consultor_id, d.consultor_id), d.id
from public.deals d join public.leads l on l.id = d.lead_id
where d.follow_up_at is not null
  and not exists (select 1 from public.lead_followups f where f.deal_id = d.id);

-- ---------- documentos de embarque ----------
create table public.enrollment_documents (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  kind text not null check (kind in ('passaporte', 'passagens', 'comprovante_financeiro', 'matricula_seguros')),
  received boolean not null default false,
  received_at timestamptz,
  received_by uuid,
  note text not null default '',
  primary key (enrollment_id, kind)
);
alter table public.enrollment_documents enable row level security;
create policy "enrollment_documents: leitura" on public.enrollment_documents for select using (public.can_see_enrollment(enrollment_id));
create policy "enrollment_documents: criação" on public.enrollment_documents for insert with check (public.can_see_enrollment(enrollment_id));
create policy "enrollment_documents: edição" on public.enrollment_documents for update using (public.can_see_enrollment(enrollment_id)) with check (public.can_see_enrollment(enrollment_id));

-- ---------- avisos de embarque (40 e 15 dias) ----------
create table public.departure_alerts (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  kind text not null check (kind in ('40d', '15d')),
  acked_at timestamptz,
  acked_by uuid,
  snoozed_until timestamptz,
  primary key (enrollment_id, kind)
);
alter table public.departure_alerts enable row level security;
create policy "departure_alerts: leitura" on public.departure_alerts for select using (public.can_see_enrollment(enrollment_id));
create policy "departure_alerts: criação" on public.departure_alerts for insert with check (public.can_see_enrollment(enrollment_id));
create policy "departure_alerts: edição" on public.departure_alerts for update using (public.can_see_enrollment(enrollment_id)) with check (public.can_see_enrollment(enrollment_id));

-- ---------- eventos da ficha entram na linha do tempo ----------
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
      perform public.log_lead_event(v_lead, 'documento', 'Documento em mãos: ' ||
        case new.kind when 'passaporte' then 'passaporte válido' when 'passagens' then 'passagens aéreas'
                      when 'comprovante_financeiro' then 'comprovante financeiro' else 'matrícula da escola com seguros' end,
        'all', coalesce(new.received_at, now()));
    end if;
  elsif tg_table_name = 'enrollments' then
    if new.pre_embark_at is not null and new.pre_embark_at is distinct from old.pre_embark_at and new.lead_id is not null then
      perform public.log_lead_event(new.lead_id, 'reuniao_pre_embarque', 'Reunião de pré-embarque agendada para ' || to_char(new.pre_embark_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), 'all', now());
    end if;
  end if;
  return null;
end; $$;
create trigger evt_followups after insert or update on public.lead_followups for each row execute function public.evt_ficha_extras();
create trigger evt_notes after insert on public.lead_notes for each row execute function public.evt_ficha_extras();
create trigger evt_documents after insert or update on public.enrollment_documents for each row execute function public.evt_ficha_extras();
create trigger evt_pre_embark after update of pre_embark_at on public.enrollments for each row execute function public.evt_ficha_extras();

-- ---------- consulta única da ficha ----------
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
    select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'received', x.received, 'received_at', x.received_at, 'note', x.note)), '[]'::jsonb)
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
revoke all on function public.lead_ficha(uuid) from public, anon;
grant execute on function public.lead_ficha(uuid) to authenticated;

-- dados pessoais completos: só ao clicar em "Ver todos os dados"
create or replace function public.lead_ficha_dados(p_lead uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public.enrollments; l public.leads;
begin
  if not public.can_see_lead(p_lead) then raise exception 'sem_acesso'; end if;
  select * into l from public.leads where id = p_lead;
  select * into e from public.enrollments where lead_id = p_lead order by created_at desc limit 1;
  perform public.log_lead_event(p_lead, 'dados_vistos', 'Dados pessoais completos consultados', 'financeiro', now());
  return jsonb_build_object(
    'name', coalesce(e.name, l.name), 'email', coalesce(nullif(e.email, ''), l.email), 'phone', coalesce(nullif(e.phone, ''), l.phone),
    'cpf', e.cpf, 'birth_date', e.birth_date, 'nationality', e.nationality,
    'passport_number', e.passport_number, 'passport_issue_date', e.passport_issue_date, 'passport_expiry_date', e.passport_expiry_date,
    'address', concat_ws(', ', nullif(e.address_street, ''), nullif(e.address_number, ''), nullif(e.address_complement, ''), nullif(e.address_neighborhood, '')),
    'city', concat_ws(' / ', nullif(e.address_city, ''), nullif(e.address_state, '')), 'zip', e.address_zip,
    'emergency_name', e.emergency_name, 'emergency_phone', e.emergency_phone);
end;
$$;
revoke all on function public.lead_ficha_dados(uuid) from public, anon;
grant execute on function public.lead_ficha_dados(uuid) to authenticated;
