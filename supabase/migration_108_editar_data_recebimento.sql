-- ============================================================
-- MIGRAÇÃO 108 — Contas a receber: data de um pagamento já realizado.
-- Só ADM e Financeiro alteram a data, mesmo que outro perfil ganhe acesso ao módulo Financeiro.
-- O histórico do lead acompanha a nova data.
-- ============================================================
create or replace function public.receivables_guard_data_paga()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.paid and new.paid
     and date_trunc('milliseconds', new.paid_at) is distinct from date_trunc('milliseconds', old.paid_at)
     and public.current_role_name() not in ('ADM', 'Financeiro') then
    raise exception 'Apenas ADM ou Financeiro podem alterar a data de um pagamento já realizado.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists receivables_guard_data_paga on public.receivables;
create trigger receivables_guard_data_paga before update on public.receivables
  for each row execute function public.receivables_guard_data_paga();

create or replace function public.receivables_sync_evento_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.paid and new.paid and new.paid_at is not null then
    update public.lead_events set occurred_at = new.paid_at
     where source_table = 'receivables' and source_id = new.id and kind = 'pagamento';
  end if;
  return null;
end;
$$;
revoke all on function public.receivables_sync_evento_data() from public, anon, authenticated;
drop trigger if exists receivables_sync_evento_data on public.receivables;
create trigger receivables_sync_evento_data after update of paid_at on public.receivables
  for each row when (old.paid_at is distinct from new.paid_at) execute function public.receivables_sync_evento_data();
