-- ============================================================
-- MIGRAÇÃO 110 — Contas a receber: ao excluir uma parcela, o registro de pagamento dela sai do histórico do lead.
-- Quem pode excluir continua definido pela política da tabela (módulo Financeiro).
-- ============================================================
create or replace function public.receivables_apaga_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.lead_events where source_table = 'receivables' and source_id = old.id;
  return null;
end;
$$;
revoke all on function public.receivables_apaga_evento() from public, anon, authenticated;
drop trigger if exists receivables_apaga_evento on public.receivables;
create trigger receivables_apaga_evento after delete on public.receivables
  for each row execute function public.receivables_apaga_evento();
