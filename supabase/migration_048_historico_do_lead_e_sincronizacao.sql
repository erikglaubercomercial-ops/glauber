-- ============================================================
-- MIGRAÇÃO 048 — histórico de eventos do lead + sincronização lead <-> matrícula.
--
-- 1) lead_events: cada fato da jornada (lead criado, mudança de status/etapa,
--    cotação, contrato, matrícula, pagamento, envio à escola, comissão,
--    mensagem, portal) é registrado AUTOMATICAMENTE por gatilhos nas tabelas
--    de origem. É a fonte da linha do tempo da ficha do cliente.
--    Eventos de valores internos (envio à escola, comissão) têm visibility =
--    'financeiro' e só aparecem para quem acessa o Financeiro.
--    Os eventos de dados que já existiam (ex.: contrato assinado do Matheus)
--    são criados retroativamente com a data real registrada.
-- 2) nome/telefone/e-mail do lead e da matrícula passam a andar juntos: a
--    última edição vale (sem laço: só grava quando o valor mudou). O nome
--    também acompanha o negócio.
-- ============================================================

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  visibility text not null default 'all' check (visibility in ('all', 'financeiro')),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  source_table text,
  source_id uuid,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events(lead_id, occurred_at desc);
create unique index lead_events_source_unique on public.lead_events(source_table, source_id, kind) where source_id is not null;

alter table public.lead_events enable row level security;
create policy "lead_events: leitura conforme o lead e a visibilidade"
  on public.lead_events for select
  using (
    exists (select 1 from public.leads l where l.id = lead_events.lead_id)
    and (visibility = 'all' or public.has_module_access('financeiro'))
  );

create or replace function public.log_lead_event(
  p_lead uuid, p_kind text, p_title text, p_visibility text default 'all',
  p_at timestamptz default now(), p_source_table text default null, p_source_id uuid default null,
  p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lead is null then return; end if;
  insert into public.lead_events (lead_id, kind, title, detail, visibility, occurred_at, actor_id, source_table, source_id)
  values (p_lead, p_kind, p_title, coalesce(p_detail, '{}'::jsonb), p_visibility, coalesce(p_at, now()), auth.uid(), p_source_table, p_source_id)
  on conflict do nothing;
end;
$$;
revoke all on function public.log_lead_event(uuid, text, text, text, timestamptz, text, uuid, jsonb) from public, anon, authenticated;

-- valor em euros no formato brasileiro: 2349 -> 2.349,00
create or replace function public.fmt_eur(p numeric)
returns text
language sql
immutable
as $$ select translate(to_char(coalesce(p, 0), 'FM999,999,990.00'), ',.', '.,'); $$;

-- ---------------- gatilhos de registro ----------------
create or replace function public.evt_leads()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    perform public.log_lead_event(new.id, 'lead_criado', 'Lead criado · origem ' || coalesce(nullif(new.source, ''), '—'),
      'all', new.created_at, 'leads', new.id);
  else
    if new.status is distinct from old.status then
      perform public.log_lead_event(new.id, 'status', 'Status do lead: ' || coalesce(old.status, '—') || ' → ' || coalesce(new.status, '—'));
    end if;
    if new.consultor_id is distinct from old.consultor_id and new.consultor_id is not null then
      select name into v_name from public.profiles where id = new.consultor_id;
      perform public.log_lead_event(new.id, 'atribuido', 'Lead atribuído a ' || coalesce(v_name, 'consultor'));
    end if;
  end if;
  return null;
end; $$;
create trigger evt_leads after insert or update on public.leads for each row execute function public.evt_leads();

create or replace function public.evt_deals()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  if new.lead_id is not null and (tg_op = 'UPDATE' and new.stage is distinct from old.stage) then
    select label into v_label from public.pipeline_stages where id = new.stage;
    perform public.log_lead_event(new.lead_id, 'etapa', 'Negócio movido para ' || coalesce(v_label, new.stage));
  end if;
  return null;
end; $$;
create trigger evt_deals after update on public.deals for each row execute function public.evt_deals();

create or replace function public.evt_quotes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is null then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_lead_event(new.lead_id, 'cotacao_criada', 'Cotação nº ' || coalesce(new.numero, '—') || ' criada · € ' || public.fmt_eur(coalesce(new.value, 0)),
      'all', new.created_at, 'quotes', new.id);
  else
    if new.status = 'Enviada' and old.status is distinct from 'Enviada' then
      perform public.log_lead_event(new.lead_id, 'cotacao_enviada', 'Cotação nº ' || coalesce(new.numero, '—') || ' enviada ao cliente', 'all', now(), 'quotes', new.id);
    end if;
    if new.aprovada_em is not null and old.aprovada_em is null then
      perform public.log_lead_event(new.lead_id, 'cotacao_aprovada', 'Cliente aprovou a cotação nº ' || coalesce(new.numero, '—') || ' pelo link', 'all', new.aprovada_em, 'quotes', new.id);
    end if;
  end if;
  return null;
end; $$;
create trigger evt_quotes after insert or update on public.quotes for each row execute function public.evt_quotes();

create or replace function public.evt_contracts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is null then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_lead_event(new.lead_id, 'contrato_gerado', 'Contrato nº ' || coalesce(new.numero, '—') || ' gerado', 'all', new.created_at, 'contracts', new.id);
  elsif new.status = 'Assinado' and old.status is distinct from 'Assinado' then
    perform public.log_lead_event(new.lead_id, 'contrato_assinado', 'Contrato nº ' || coalesce(new.numero, '—') || ' assinado com código por e-mail', 'all', coalesce(new.signed_at, now()), 'contracts', new.id);
  end if;
  return null;
end; $$;
create trigger evt_contracts after insert or update on public.contracts for each row execute function public.evt_contracts();

create or replace function public.evt_enrollments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is null then return null; end if;
  if tg_op = 'INSERT' then
    perform public.log_lead_event(new.lead_id, 'matricula_criada',
      case when new.matricula_pendente then 'Matrícula criada automaticamente · matrícula ainda não realizada' else 'Matrícula criada' end,
      'all', new.created_at, 'enrollments', new.id);
  else
    if old.matricula_pendente and not new.matricula_pendente then
      perform public.log_lead_event(new.lead_id, 'matricula_realizada', 'Matrícula na escola realizada', 'all', now(), 'enrollments', new.id);
    end if;
    if old.passport_photo_path is null and new.passport_photo_path is not null then
      perform public.log_lead_event(new.lead_id, 'passaporte_enviado', 'Passaporte enviado', 'all', now());
    end if;
    if old.student_user_id is null and new.student_user_id is not null then
      perform public.log_lead_event(new.lead_id, 'portal_ativado', 'Acesso ao portal do aluno criado', 'all', now(), 'enrollments_portal', new.id);
    end if;
  end if;
  return null;
end; $$;
create trigger evt_enrollments after insert or update on public.enrollments for each row execute function public.evt_enrollments();

create or replace function public.evt_receivables()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  select lead_id into v_lead from public.deals where id = new.deal_id;
  if v_lead is null then return null; end if;
  if new.paid and (tg_op = 'INSERT' or not old.paid) then
    perform public.log_lead_event(v_lead, 'pagamento', 'Pagamento de € ' || public.fmt_eur(new.amount) || ' recebido (parcela ' || new.installment_number || '/' || new.installments_total || ')',
      'all', coalesce(new.paid_at, now()), 'receivables', new.id);
  end if;
  return null;
end; $$;
create trigger evt_receivables after insert or update on public.receivables for each row execute function public.evt_receivables();

create or replace function public.evt_school_transfers()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lead uuid; v_school text;
begin
  select lead_id, school into v_lead, v_school from public.enrollments where id = new.enrollment_id;
  perform public.log_lead_event(v_lead, 'envio_escola', 'Enviados € ' || public.fmt_eur(new.amount) || ' à escola ' || coalesce(nullif(v_school, ''), ''),
    'financeiro', new.sent_at::timestamptz, 'school_transfers', new.id);
  return null;
end; $$;
create trigger evt_school_transfers after insert on public.school_transfers for each row execute function public.evt_school_transfers();

create or replace function public.evt_commissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  select lead_id into v_lead from public.deals where id = new.deal_id;
  if tg_op = 'INSERT' then
    perform public.log_lead_event(v_lead, 'comissao_gerada', 'Comissão do consultor gerada · € ' || public.fmt_eur(new.amount), 'financeiro', new.created_at, 'commissions', new.id);
  elsif new.status = 'Pago' and old.status is distinct from 'Pago' then
    perform public.log_lead_event(v_lead, 'comissao_paga', 'Comissão do consultor paga · € ' || public.fmt_eur(new.amount), 'financeiro', coalesce(new.paid_at, now()));
  end if;
  return null;
end; $$;
create trigger evt_commissions after insert or update on public.commissions for each row execute function public.evt_commissions();

create or replace function public.evt_aluno_mensagens()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  select lead_id into v_lead from public.enrollments where id = new.enrollment_id;
  perform public.log_lead_event(v_lead, 'mensagem',
    case when new.autor = 'aluno' then 'Aluno enviou uma mensagem pelo portal' else 'Equipe respondeu o aluno no portal' end,
    'all', new.created_at, 'aluno_mensagens', new.id);
  return null;
end; $$;
create trigger evt_aluno_mensagens after insert on public.aluno_mensagens for each row execute function public.evt_aluno_mensagens();

-- ---------------- sincronização lead <-> matrícula (a última edição vale) ----------------
create or replace function public.sync_lead_para_matricula()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.enrollments set
    name = case when nullif(new.name, '') is not null then new.name else name end,
    phone = case when nullif(new.phone, '') is not null then new.phone else phone end,
    email = case when nullif(new.email, '') is not null then new.email else email end,
    updated_at = now()
  where lead_id = new.id
    and (name is distinct from new.name or phone is distinct from new.phone or email is distinct from new.email)
    and (nullif(new.name, '') is not null or nullif(new.phone, '') is not null or nullif(new.email, '') is not null);
  update public.deals set name = new.name where lead_id = new.id and name is distinct from new.name and nullif(new.name, '') is not null;
  return null;
end; $$;
create trigger sync_lead_para_matricula after update of name, phone, email on public.leads
  for each row execute function public.sync_lead_para_matricula();

create or replace function public.sync_matricula_para_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is null then return null; end if;
  begin
    update public.leads set
      name = case when nullif(new.name, '') is not null then new.name else name end,
      phone = case when nullif(new.phone, '') is not null then new.phone else phone end,
      email = case when nullif(new.email, '') is not null then new.email else email end
    where id = new.lead_id
      and (name is distinct from new.name or phone is distinct from new.phone or email is distinct from new.email)
      and (nullif(new.name, '') is not null or nullif(new.phone, '') is not null or nullif(new.email, '') is not null);
  exception when others then
    null; -- ex.: telefone já usado por outro lead: não trava o salvamento da matrícula
  end;
  return null;
end; $$;
create trigger sync_matricula_para_lead after update of name, phone, email on public.enrollments
  for each row execute function public.sync_matricula_para_lead();

-- ---------------- eventos retroativos (datas reais já registradas) ----------------
insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select l.id, 'lead_criado', 'Lead criado · origem ' || coalesce(nullif(l.source, ''), '—'), 'all', l.created_at, 'leads', l.id from public.leads l
on conflict do nothing;

insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select q.lead_id, 'cotacao_criada', 'Cotação nº ' || coalesce(q.numero, '—') || ' criada · € ' || public.fmt_eur(coalesce(q.value, 0)), 'all', q.created_at, 'quotes', q.id
from public.quotes q where q.lead_id is not null on conflict do nothing;

insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select q.lead_id, 'cotacao_aprovada', 'Cliente aprovou a cotação nº ' || coalesce(q.numero, '—') || ' pelo link', 'all', q.aprovada_em, 'quotes', q.id
from public.quotes q where q.lead_id is not null and q.aprovada_em is not null on conflict do nothing;

insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select c.lead_id, 'contrato_gerado', 'Contrato nº ' || coalesce(c.numero, '—') || ' gerado', 'all', c.created_at, 'contracts', c.id
from public.contracts c where c.lead_id is not null on conflict do nothing;

insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select c.lead_id, 'contrato_assinado', 'Contrato nº ' || coalesce(c.numero, '—') || ' assinado com código por e-mail', 'all', coalesce(c.signed_at, c.updated_at), 'contracts', c.id
from public.contracts c where c.lead_id is not null and c.status = 'Assinado' on conflict do nothing;

insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select e.lead_id, 'matricula_criada',
       case when e.matricula_pendente then 'Matrícula criada automaticamente · matrícula ainda não realizada' else 'Matrícula criada' end,
       'all', e.created_at, 'enrollments', e.id
from public.enrollments e where e.lead_id is not null on conflict do nothing;

insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select d.lead_id, 'pagamento', 'Pagamento de € ' || public.fmt_eur(r.amount) || ' recebido (parcela ' || r.installment_number || '/' || r.installments_total || ')',
       'all', coalesce(r.paid_at, r.created_at), 'receivables', r.id
from public.receivables r join public.deals d on d.id = r.deal_id where r.paid and d.lead_id is not null on conflict do nothing;

insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select e.lead_id, 'envio_escola', 'Enviados € ' || public.fmt_eur(t.amount) || ' à escola ' || coalesce(nullif(e.school, ''), ''),
       'financeiro', t.sent_at::timestamptz, 'school_transfers', t.id
from public.school_transfers t join public.enrollments e on e.id = t.enrollment_id where e.lead_id is not null on conflict do nothing;

insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select d.lead_id, 'comissao_gerada', 'Comissão do consultor gerada · € ' || public.fmt_eur(c.amount), 'financeiro', c.created_at, 'commissions', c.id
from public.commissions c join public.deals d on d.id = c.deal_id where d.lead_id is not null on conflict do nothing;

insert into public.lead_events (lead_id, kind, title, visibility, occurred_at, source_table, source_id)
select e.lead_id, 'mensagem',
       case when m.autor = 'aluno' then 'Aluno enviou uma mensagem pelo portal' else 'Equipe respondeu o aluno no portal' end,
       'all', m.created_at, 'aluno_mensagens', m.id
from public.aluno_mensagens m join public.enrollments e on e.id = m.enrollment_id where e.lead_id is not null on conflict do nothing;
