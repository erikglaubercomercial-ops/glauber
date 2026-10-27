-- ============================================================
-- MIGRAÇÃO 084 — Contrato assinado → comissão do INFLUENCER.
-- Até aqui a comissão do influencer só nascia quando a matrícula/negócio era salvo na tela do CRM; vendas que
-- chegam pelo contrato assinado (processo do banco) ficavam sem a linha em Financeiro › Comissões › Influencers.
-- Agora, ao assinar, finance_from_contract também cria a comissão pela regra da origem do lead:
--   • origem de influencer em "fixed_turno": valor fixo por turno (AM/PM da matrícula)
--   • origem de influencer em "percentage": % do valor da venda
-- A origem vale tanto na 1ª origem (source) quanto na 2ª (source2). O valor fica EDITÁVEL na tela (coluna "Valor a pagar").
-- Idempotente (não duplica) e, como o resto da função, nunca impede a assinatura do contrato.
-- ============================================================
create or replace function public.finance_from_contract(p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contracts;
  q public.quotes;
  l public.leads;
  v_deal uuid;
  v_enr uuid;
  v_enr_turno text;
  v_total numeric;
  v_sold numeric;
  v_names text;
  s public.lead_sources;
  v_shift text;
  v_amount numeric;
begin
  select * into c from public.contracts where id = p_contract_id;
  if not found or c.modo <> 'proposta' or c.status <> 'Assinado' or c.lead_id is null then return; end if;
  select * into q from public.quotes where id = c.quote_id;
  select * into l from public.leads where id = c.lead_id;

  -- 1) conta a receber do valor total (pendente)
  select id into v_deal from public.deals where lead_id = c.lead_id order by created_at desc limit 1;
  v_total := coalesce(q.value, c.value, 0);
  if v_deal is not null and v_total > 0 and not exists (select 1 from public.receivables where deal_id = v_deal) then
    insert into public.receivables (deal_id, client_name, installment_number, installments_total, amount, due_date, paid)
    values (v_deal, coalesce(l.name, ''), 1, 1, v_total,
            (coalesce(c.signed_at, now()) at time zone 'America/Sao_Paulo')::date, false);
  end if;

  -- 2) acomodação da cotação
  select id, turno into v_enr, v_enr_turno from public.enrollments where lead_id = c.lead_id order by created_at desc limit 1;
  if v_enr is not null and not exists (select 1 from public.accommodation_sales where enrollment_id = v_enr) then
    select coalesce(sum((it ->> 'total')::numeric), 0),
           string_agg(coalesce(nullif(it ->> 'escola', ''), '') || case when coalesce(it ->> 'escola', '') <> '' then ' — ' else '' end || (it ->> 'nome'), ' + ')
      into v_sold, v_names
    from jsonb_array_elements(coalesce(q.items_detail, '[]'::jsonb)) it
    where coalesce(it ->> 'id', '') <> ''
      and exists (
        select 1 from public.catalog_items ci
        where ci.id = it ->> 'id' and ci.folder_id is not null
          and exists (select 1 from public.catalog_folder_chain(ci.folder_id) f where f.kind = 'acomod')
      );
    if v_sold > 0 then
      insert into public.accommodation_sales (enrollment_id, description, sold_amount, cost_amount, commission_pct, notes)
      values (v_enr, left(coalesce(v_names, 'Acomodação'), 200), v_sold, 0, 40,
              'Criada automaticamente a partir do contrato assinado. Informe o custo para calcular o lucro e a comissão.');
    end if;
  end if;

  -- 3) comissão do influencer (origem do lead = canal de influencer)
  select * into s from public.lead_sources
   where is_influencer and name in (l.source, coalesce(l.source2, ''))
   order by (name = l.source) desc limit 1;
  if found and v_deal is not null
     and not exists (select 1 from public.influencer_commissions where deal_id = v_deal or (v_enr is not null and enrollment_id = v_enr)) then
    if s.commission_mode = 'fixed_turno' then
      v_shift := case when translate(lower(coalesce(v_enr_turno, '')), 'ãá', 'aa') like 'am%' or translate(lower(coalesce(v_enr_turno, '')), 'ãá', 'aa') like '%manha%' then 'am'
                      when lower(coalesce(v_enr_turno, '')) like 'pm%' or lower(coalesce(v_enr_turno, '')) like '%tarde%' then 'pm' end;
      v_amount := case v_shift when 'am' then s.commission_fixed_am when 'pm' then s.commission_fixed_pm end;
      if coalesce(v_amount, 0) > 0 then
        insert into public.influencer_commissions (deal_id, enrollment_id, source, deal_name, deal_value, percentage, amount, status)
        values (v_deal, v_enr, s.name, coalesce(l.name, ''), v_total, 0, v_amount, 'Pendente')
        on conflict do nothing;
      end if;
    elsif coalesce(s.commission_pct, 0) > 0 then
      insert into public.influencer_commissions (deal_id, source, deal_name, deal_value, percentage, amount, status)
      values (v_deal, s.name, coalesce(l.name, ''), v_total, s.commission_pct, round(v_total * s.commission_pct / 100, 2), 'Pendente')
      on conflict do nothing;
    end if;
  end if;
end;
$$;
revoke all on function public.finance_from_contract(uuid) from public, anon, authenticated;

-- Mirella: lead do app, mas captado pela influencer DUDA => 2ª origem DUDA (a 1ª, App Intercâmbio, continua)
update public.leads set source2 = 'DUDA' where name = 'Mirella' and source = 'App Intercâmbio' and source2 is null;

-- contratos já assinados: cria o que faltou (Bruno e Mirella ganham a comissão da DUDA)
select public.finance_from_contract(id) from public.contracts where modo = 'proposta' and status = 'Assinado';
