-- ============================================================
-- MIGRAÇÃO 043 — a Área do Aluno mostra os pagamentos reais.
--
-- aluno_financeiro() devolve, só para o aluno logado, o resumo do que está
-- lançado no Financeiro (Contas a receber) para o negócio do lead dele:
-- total negociado, quanto já foi pago, quanto falta e a lista de parcelas.
-- Lê direto de receivables, então qualquer baixa/ajuste feito pela equipe
-- aparece para o aluno na hora. O aluno não ganha acesso à tabela em si.
-- ============================================================

create or replace function public.aluno_financeiro()
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
  select * into e from public.enrollments
  where student_user_id = auth.uid()
  order by created_at desc limit 1;
  if not found then
    return null;
  end if;

  select
    coalesce(sum(r.amount), 0),
    coalesce(sum(r.amount) filter (where r.paid), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'numero', r.installment_number, 'total', r.installments_total, 'valor', r.amount,
      'vencimento', r.due_date, 'pago', r.paid, 'pago_em', r.paid_at
    ) order by r.due_date, r.installment_number), '[]'::jsonb)
  into v_total, v_pago, v_parcelas
  from public.receivables r
  join public.deals d on d.id = r.deal_id
  where d.lead_id = e.lead_id and e.lead_id is not null;

  -- sem parcelas lançadas ainda: mostra o valor do curso como total, nada pago
  if jsonb_array_length(v_parcelas) = 0 then
    v_total := coalesce(e.course_value, 0);
    v_pago := 0;
  end if;

  return jsonb_build_object(
    'total', v_total, 'pago', v_pago, 'pendente', greatest(v_total - v_pago, 0), 'parcelas', v_parcelas
  );
end;
$$;

revoke all on function public.aluno_financeiro() from public, anon;
grant execute on function public.aluno_financeiro() to authenticated;
