-- ============================================================
-- MIGRAÇÃO 120 — Ficha do cliente: planilha de pagamentos com correção do valor pago.
-- Só ADM e Financeiro alteram o valor (ou a data) de um pagamento JÁ realizado,
-- mesmo que outro perfil tenha acesso ao módulo Financeiro. O banco confere.
-- Cada correção de valor fica registrada no histórico do lead (visível só ao financeiro),
-- e o evento "Pagamento de € X recebido" passa a mostrar o valor corrigido.
-- ============================================================
create or replace function public.receivables_guard_data_paga()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.paid and new.paid
     and (date_trunc('milliseconds', new.paid_at) is distinct from date_trunc('milliseconds', old.paid_at)
          or new.amount is distinct from old.amount)
     and public.current_role_name() not in ('ADM', 'Financeiro') then
    raise exception 'Apenas ADM ou Financeiro podem alterar o valor ou a data de um pagamento já realizado.' using errcode = '42501';
  end if;
  if old.paid and new.paid and new.amount is distinct from old.amount and not (new.amount > 0) then
    raise exception 'O valor pago precisa ser maior que zero.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.receivables_log_valor_corrigido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_lead uuid;
begin
  if old.paid and new.paid and new.amount is distinct from old.amount then
    select lead_id into v_lead from public.deals where id = new.deal_id;
    if v_lead is not null then
      update public.lead_events
         set title = 'Pagamento de € ' || public.fmt_eur(new.amount) || ' recebido (parcela ' || new.installment_number || '/' || new.installments_total || ')'
       where source_table = 'receivables' and source_id = new.id and kind = 'pagamento';
      perform public.log_lead_event(v_lead, 'pagamento_editado',
        'Valor pago corrigido de € ' || public.fmt_eur(old.amount) || ' para € ' || public.fmt_eur(new.amount)
          || ' (parcela ' || new.installment_number || '/' || new.installments_total || ')',
        'financeiro', now(), null, null,
        jsonb_build_object('receivable_id', new.id, 'valor_antes', old.amount, 'valor_depois', new.amount,
                           'por', public.current_role_name()));
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.receivables_log_valor_corrigido() from public, anon, authenticated;
drop trigger if exists receivables_log_valor_corrigido on public.receivables;
create trigger receivables_log_valor_corrigido after update of amount on public.receivables
  for each row execute function public.receivables_log_valor_corrigido();

-- A ficha passa a informar o id de cada parcela (para a planilha poder corrigir o valor pago).
-- Reescreve a função viva sem mexer no resto dela; só acrescenta 'id' na lista de parcelas.
do $mig$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.lead_ficha(uuid)'::regprocedure);
  if position('''id'', r.id, ''numero'', r.installment_number' in v_def) = 0 then
    v_def := replace(v_def, '''numero'', r.installment_number', '''id'', r.id, ''numero'', r.installment_number');
    execute v_def;
  end if;
end
$mig$;
