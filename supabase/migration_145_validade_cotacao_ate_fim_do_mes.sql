-- ============================================================
-- MIGRAÇÃO 145 — Regra: a validade da cotação vai no máximo até o último dia do mês da emissão
-- Vale para qualquer origem (tela do CRM, importação, API, função). Se a validade vier depois do fim do mês,
-- o banco a corrige para o último dia do mês. Cotações antigas não são alteradas: a regra só age quando a
-- validade ou a emissão é gravada/alterada.
-- ============================================================
create or replace function public.quotes_cap_validade()
returns trigger
language plpgsql
as $$
declare v_base date; v_fim date;
begin
  if new.validade is null then return new; end if;
  if tg_op = 'UPDATE' and new.validade is not distinct from old.validade and new.emissao is not distinct from old.emissao then
    return new;
  end if;
  v_base := coalesce(new.emissao, (now() at time zone 'America/Sao_Paulo')::date);
  v_fim := (date_trunc('month', v_base) + interval '1 month - 1 day')::date;
  if new.validade > v_fim then new.validade := v_fim; end if;
  return new;
end;
$$;

drop trigger if exists quotes_cap_validade on public.quotes;
create trigger quotes_cap_validade before insert or update on public.quotes
  for each row execute function public.quotes_cap_validade();
