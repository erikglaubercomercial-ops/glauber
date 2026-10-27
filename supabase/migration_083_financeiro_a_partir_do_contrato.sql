-- ============================================================
-- MIGRAÇÃO 083 — Contrato assinado → Financeiro.
-- Ao assinar, além da matrícula, do negócio Ganho e da comissão (já existentes), o sistema agora:
--  1) cria a CONTA A RECEBER do valor total da cotação (parcela 1/1, vencimento = dia da assinatura, PENDENTE);
--     o financeiro registra quanto foi recebido e pode dividir em parcelas livres (tela Contas a Receber).
--  2) leva a ACOMODAÇÃO da cotação para a aba Financeiro › Acomodação (valor vendido preenchido; custo a preencher).
-- Idempotente: se o negócio já tem conta a receber / a matrícula já tem acomodação, não duplica.
-- Se algo falhar aqui, a assinatura do contrato NÃO é afetada (só gera um aviso no log do banco).
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
  v_total numeric;
  v_sold numeric;
  v_names text;
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

  -- 2) acomodação da cotação (itens do catálogo que estão em pastas de Acomodação)
  select id into v_enr from public.enrollments where lead_id = c.lead_id order by created_at desc limit 1;
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
end;
$$;
revoke all on function public.finance_from_contract(uuid) from public, anon, authenticated;

create or replace function public.contracts_cria_matricula()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.modo = 'proposta' and new.status = 'Assinado' and old.status is distinct from 'Assinado' then
    perform public.matricula_from_contract(new.id);
    perform public.sale_from_contract(new.id);
    begin
      perform public.finance_from_contract(new.id);
    exception when others then
      raise warning 'finance_from_contract falhou para o contrato %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- contratos já assinados: cria o que faltou (Bruno e Mirella ganham a conta a receber; Matheus Govaski, a acomodação)
select public.finance_from_contract(id) from public.contracts where modo = 'proposta' and status = 'Assinado';
