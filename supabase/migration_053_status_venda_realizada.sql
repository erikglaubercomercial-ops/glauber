-- ============================================================
-- MIGRAÇÃO 053 — novo status de lead: "Venda realizada".
--
-- • A regra de valores de leads.status passa a aceitar 'Venda realizada'.
-- • Quando o negócio do lead entra na etapa de Venda (inclusive pela
--   assinatura do contrato), o status do lead vira 'Venda realizada'
--   automaticamente (e fica registrado na linha do tempo da ficha).
-- • Leads que já têm negócio em Venda são ajustados agora.
-- ============================================================

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('Novo', 'Em contato', 'Qualificado', 'Venda realizada', 'Descartado'));

create or replace function public.deals_marca_venda_realizada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null and new.stage is not distinct from public.won_stage_id() then
    update public.leads set status = 'Venda realizada' where id = new.lead_id and status <> 'Venda realizada';
  end if;
  return null;
end;
$$;
create trigger deals_marca_venda_realizada
  after insert or update of stage on public.deals
  for each row execute function public.deals_marca_venda_realizada();

update public.leads l set status = 'Venda realizada'
where l.status <> 'Venda realizada'
  and exists (select 1 from public.deals d where d.lead_id = l.id and d.stage = public.won_stage_id());
