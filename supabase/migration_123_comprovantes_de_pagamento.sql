-- ============================================================
-- MIGRAÇÃO 123 — Comprovante de pagamento enviado pelo aluno, conferido pelo ADM/Financeiro.
-- Fluxo: o aluno envia o comprovante (valor, data, arquivo) -> fica "pendente" -> ADM/Financeiro
-- abre o popup, confere NA CONTA se o dinheiro caiu e só então confirma. Somente a confirmação
-- baixa as parcelas (receivables); até lá os valores pagos/restantes NÃO mudam.
-- Tudo passa por funções (a tabela não tem acesso direto).
-- ============================================================
create table if not exists public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  receivable_id uuid references public.receivables(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null,
  file_path text not null,
  file_name text,
  note text,
  status text not null default 'pendente' check (status in ('pendente', 'confirmado', 'recusado')),
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  confirmed_amount numeric(12,2),
  confirmed_paid_on date,
  review_note text
);
create index if not exists payment_proofs_status_idx on public.payment_proofs (status, created_at);
create index if not exists payment_proofs_enrollment_idx on public.payment_proofs (enrollment_id);
alter table public.payment_proofs enable row level security;
revoke all on public.payment_proofs from public, anon, authenticated;

create or replace function public.is_fin_reviewer()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_role_name() in ('ADM', 'Financeiro'), false) $$;
revoke all on function public.is_fin_reviewer() from public, anon;
grant execute on function public.is_fin_reviewer() to authenticated;

-- ADM/Financeiro abrem o arquivo do comprovante (bucket student-docs)
drop policy if exists "student-docs: financeiro lê comprovantes" on storage.objects;
create policy "student-docs: financeiro lê comprovantes" on storage.objects
  for select to authenticated using (bucket_id = 'student-docs' and public.is_fin_reviewer());

-- ---------- aluno envia ----------
create or replace function public.aluno_enviar_comprovante(
  p_receivable uuid, p_amount numeric, p_paid_on date, p_path text, p_name text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare e public.enrollments; v_id uuid; v_today date := (now() at time zone 'America/Sao_Paulo')::date; v_rec uuid := null;
begin
  select * into e from public.enrollments where student_user_id = auth.uid() order by created_at desc limit 1;
  if e.id is null then raise exception 'sem_matricula'; end if;
  p_amount := round(coalesce(p_amount, 0), 2);
  if not (p_amount > 0 and p_amount <= 1000000) then raise exception 'valor_invalido'; end if;
  if p_paid_on is null or p_paid_on > v_today or p_paid_on < v_today - 400 then raise exception 'data_invalida'; end if;
  if left(coalesce(p_path, ''), length(e.id::text) + 1) <> e.id::text || '/' then raise exception 'caminho_invalido'; end if;
  if (select count(*) from public.payment_proofs where enrollment_id = e.id and status = 'pendente') >= 10 then raise exception 'muitos_pendentes'; end if;
  if p_receivable is not null then
    select r.id into v_rec from public.receivables r join public.deals d on d.id = r.deal_id
     where r.id = p_receivable and d.lead_id = e.lead_id and not r.paid;
  end if;
  insert into public.payment_proofs (enrollment_id, receivable_id, amount, paid_on, file_path, file_name, note)
  values (e.id, v_rec, p_amount, p_paid_on, p_path, left(coalesce(p_name, ''), 200), left(nullif(trim(coalesce(p_note, '')), ''), 500))
  returning id into v_id;
  perform public.log_lead_event(e.lead_id, 'comprovante_enviado',
    'Aluno enviou comprovante de pagamento de € ' || public.fmt_eur(p_amount) || ' (aguardando conferência na conta)',
    'financeiro', now(), 'payment_proofs', v_id);
  return v_id;
end;
$$;
revoke all on function public.aluno_enviar_comprovante(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.aluno_enviar_comprovante(uuid, numeric, date, text, text, text) to authenticated;

-- ---------- aluno (ou ADM espectador) vê o andamento ----------
create or replace function public.aluno_comprovantes(p_enr uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare e public.enrollments;
begin
  e := public.portal_matricula_alvo(p_enr);
  if e.id is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'paid_on', x.paid_on, 'status', x.status,
            'receivable_id', x.receivable_id, 'review_note', x.review_note, 'created_at', x.created_at) order by x.created_at desc)
          from (select * from public.payment_proofs where enrollment_id = e.id order by created_at desc limit 30) x), '[]'::jsonb);
end;
$$;
revoke all on function public.aluno_comprovantes(uuid) from public, anon;
grant execute on function public.aluno_comprovantes(uuid) to authenticated;

-- ---------- ADM/Financeiro: fila de comprovantes a conferir ----------
create or replace function public.comprovantes_pendentes()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_fin_reviewer() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(q.x order by q.created_at) from (
    select pp.created_at, jsonb_build_object(
      'id', pp.id, 'created_at', pp.created_at, 'amount', pp.amount, 'paid_on', pp.paid_on, 'note', pp.note,
      'file_path', pp.file_path, 'file_name', pp.file_name, 'receivable_id', pp.receivable_id,
      'enrollment_id', e.id, 'lead_id', e.lead_id, 'student', e.name, 'school', e.school,
      'parcelas', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'numero', r.installment_number, 'total', r.installments_total,
                      'valor', r.amount, 'vencimento', r.due_date, 'pago', r.paid) order by r.due_date, r.installment_number), '[]'::jsonb)
                   from public.receivables r join public.deals d on d.id = r.deal_id where d.lead_id = e.lead_id)
    ) as x
    from public.payment_proofs pp join public.enrollments e on e.id = pp.enrollment_id
    where pp.status = 'pendente') q), '[]'::jsonb);
end;
$$;
revoke all on function public.comprovantes_pendentes() from public, anon;
grant execute on function public.comprovantes_pendentes() to authenticated;

-- ---------- ADM/Financeiro: confirma (dinheiro caiu na conta) e baixa as parcelas ----------
create or replace function public.confirmar_comprovante(p_proof uuid, p_amount numeric, p_paid_on date, p_receivable uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  pp public.payment_proofs; e public.enrollments; r public.receivables;
  v_deal uuid; v_target uuid; v_rem numeric; v_paid_at timestamptz; v_pago numeric; v_pend numeric;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.is_fin_reviewer() then raise exception 'sem_permissao'; end if;
  select * into pp from public.payment_proofs where id = p_proof for update;
  if pp.id is null then raise exception 'comprovante_nao_encontrado'; end if;
  if pp.status <> 'pendente' then raise exception 'ja_revisado'; end if;
  p_amount := round(coalesce(p_amount, 0), 2);
  if not (p_amount > 0) then raise exception 'valor_invalido'; end if;
  if p_paid_on is null or p_paid_on > v_today then raise exception 'data_invalida'; end if;
  select * into e from public.enrollments where id = pp.enrollment_id;
  select id into v_deal from public.deals where lead_id = e.lead_id order by created_at desc limit 1;
  if v_deal is null then raise exception 'sem_financeiro'; end if;

  v_target := coalesce(p_receivable, pp.receivable_id);
  if v_target is not null and not exists (select 1 from public.receivables where id = v_target and deal_id = v_deal and not paid) then
    v_target := null;
  end if;
  v_paid_at := ((p_paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo');
  v_rem := p_amount;

  -- a parcela indicada primeiro; o resto do valor vai para as seguintes, por vencimento
  for r in select * from public.receivables where deal_id = v_deal and not paid
           order by (id = v_target) desc nulls last, due_date, created_at, id for update loop
    exit when v_rem < 0.005;
    if v_rem >= r.amount - 0.005 then
      update public.receivables set paid = true, paid_at = v_paid_at where id = r.id;
      v_rem := round(v_rem - r.amount, 2);
    else
      -- pagamento parcial: esta parcela vira o que entrou (paga) e o que falta continua pendente
      insert into public.receivables (id, deal_id, client_name, installment_number, installments_total, amount, due_date, paid, paid_at)
      values (gen_random_uuid(), v_deal, r.client_name, r.installment_number, r.installments_total, round(r.amount - v_rem, 2), r.due_date, false, null);
      update public.receivables set amount = v_rem, paid = true, paid_at = v_paid_at where id = r.id;
      v_rem := 0;
    end if;
  end loop;
  if v_rem > 0.005 then raise exception 'valor_maior_que_saldo'; end if;

  with o as (select id, row_number() over (order by due_date, created_at, id) rn, count(*) over () cnt
               from public.receivables where deal_id = v_deal)
  update public.receivables x set installment_number = o.rn, installments_total = o.cnt
    from o where x.id = o.id and (x.installment_number <> o.rn or x.installments_total <> o.cnt);

  update public.payment_proofs set status = 'confirmado', reviewed_by = auth.uid(), reviewed_at = now(),
         confirmed_amount = p_amount, confirmed_paid_on = p_paid_on, receivable_id = coalesce(v_target, receivable_id)
   where id = p_proof;
  perform public.log_lead_event(e.lead_id, 'comprovante_confirmado',
    'Comprovante conferido na conta: € ' || public.fmt_eur(p_amount) || ' confirmados pelo financeiro'
      || case when p_amount <> pp.amount then ' (o aluno informou € ' || public.fmt_eur(pp.amount) || ')' else '' end,
    'financeiro', now(), 'payment_proofs', pp.id);

  select coalesce(sum(amount) filter (where paid), 0), coalesce(sum(amount) filter (where not paid), 0)
    into v_pago, v_pend from public.receivables where deal_id = v_deal;
  return jsonb_build_object('pago', v_pago, 'pendente', v_pend);
end;
$$;
revoke all on function public.confirmar_comprovante(uuid, numeric, date, uuid) from public, anon;
grant execute on function public.confirmar_comprovante(uuid, numeric, date, uuid) to authenticated;

-- ---------- ADM/Financeiro: recusa (não caiu na conta / comprovante inválido) ----------
create or replace function public.recusar_comprovante(p_proof uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare pp public.payment_proofs; e public.enrollments;
begin
  if not public.is_fin_reviewer() then raise exception 'sem_permissao'; end if;
  select * into pp from public.payment_proofs where id = p_proof for update;
  if pp.id is null then raise exception 'comprovante_nao_encontrado'; end if;
  if pp.status <> 'pendente' then raise exception 'ja_revisado'; end if;
  select * into e from public.enrollments where id = pp.enrollment_id;
  update public.payment_proofs set status = 'recusado', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = left(nullif(trim(coalesce(p_reason, '')), ''), 500)
   where id = p_proof;
  perform public.log_lead_event(e.lead_id, 'comprovante_recusado',
    'Comprovante de € ' || public.fmt_eur(pp.amount) || ' não confirmado pelo financeiro' || coalesce(' — ' || nullif(trim(p_reason), ''), ''),
    'financeiro', now(), 'payment_proofs', pp.id);
end;
$$;
revoke all on function public.recusar_comprovante(uuid, text) from public, anon;
grant execute on function public.recusar_comprovante(uuid, text) to authenticated;
