-- ============================================================
-- MIGRAÇÃO 122 — ADM entra no portal de qualquer aluno como ESPECTADOR.
-- As três funções que alimentam o portal ganham um parâmetro opcional p_enr:
--   • ADM + p_enr  -> devolve os dados DAQUELA matrícula (só leitura);
--   • qualquer outro perfil -> o parâmetro é ignorado e vale o aluno logado.
-- Nenhuma função de escrita do portal muda: elas continuam presas ao aluno logado
-- (o ADM não tem matrícula própria, então nada é gravado pelo modo espectador).
-- Também: aluno_financeiro passa a informar o id de cada parcela.
-- ============================================================
create or replace function public.portal_matricula_alvo(p_enr uuid default null)
returns public.enrollments
language plpgsql
stable
security definer
set search_path = public
as $$
declare e public.enrollments;
begin
  if p_enr is not null and public.current_role_name() = 'ADM' then
    select * into e from public.enrollments where id = p_enr;
  else
    select * into e from public.enrollments where student_user_id = auth.uid() order by created_at desc limit 1;
  end if;
  return e;
end;
$$;
revoke all on function public.portal_matricula_alvo(uuid) from public, anon;
grant execute on function public.portal_matricula_alvo(uuid) to authenticated;

drop function if exists public.aluno_matricula();
create or replace function public.aluno_matricula(p_enr uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare e public.enrollments;
begin
  e := public.portal_matricula_alvo(p_enr);
  if e.id is null then return null; end if;
  return jsonb_build_object(
    'id', e.id, 'name', e.name, 'school', e.school, 'turno', e.turno,
    'arrival_date', e.arrival_date, 'class_start_date', e.class_start_date,
    'passport_photo_path', e.passport_photo_path);
end;
$$;
revoke all on function public.aluno_matricula(uuid) from public, anon;
grant execute on function public.aluno_matricula(uuid) to authenticated;

drop function if exists public.aluno_documentos();
create or replace function public.aluno_documentos(p_enr uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare e public.enrollments;
begin
  e := public.portal_matricula_alvo(p_enr);
  if e.id is null then return null; end if;
  return jsonb_build_object(
    'enrollment_id', e.id,
    'passport_legacy', e.passport_photo_path is not null,
    'docs', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'received', d.received, 'file_name', d.file_name,
              'file_path', d.file_path, 'uploaded_at', d.uploaded_at, 'by_student', d.uploaded_by_student))
            from public.enrollment_documents d where d.enrollment_id = e.id), '[]'::jsonb));
end;
$$;
revoke all on function public.aluno_documentos(uuid) from public, anon;
grant execute on function public.aluno_documentos(uuid) to authenticated;

drop function if exists public.aluno_financeiro();
create or replace function public.aluno_financeiro(p_enr uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e public.enrollments;
  v_total numeric;
  v_pago numeric;
  v_parcelas jsonb;
begin
  e := public.portal_matricula_alvo(p_enr);
  if e.id is null then return null; end if;

  select
    coalesce(sum(r.amount), 0),
    coalesce(sum(r.amount) filter (where r.paid), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'numero', r.installment_number, 'total', r.installments_total, 'valor', r.amount,
      'vencimento', r.due_date, 'pago', r.paid, 'pago_em', r.paid_at
    ) order by r.due_date, r.installment_number), '[]'::jsonb)
  into v_total, v_pago, v_parcelas
  from public.receivables r
  join public.deals d on d.id = r.deal_id
  where d.lead_id = e.lead_id and e.lead_id is not null;

  if jsonb_array_length(v_parcelas) = 0 then
    v_total := coalesce(e.course_value, 0);
    v_pago := 0;
  end if;

  return jsonb_build_object(
    'total', v_total, 'pago', v_pago, 'pendente', greatest(v_total - v_pago, 0), 'parcelas', v_parcelas
  );
end;
$$;
revoke all on function public.aluno_financeiro(uuid) from public, anon;
grant execute on function public.aluno_financeiro(uuid) to authenticated;
