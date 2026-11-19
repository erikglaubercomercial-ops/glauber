-- ============================================================
-- MIGRAÇÃO 139 — Entrada na cotação (valor já pago, descontado do total)
-- A entrada fica nos itens como linha de total NEGATIVO marcada com "entrada": true.
-- O limite de desconto (guarda de quotes) passa a ignorar essas linhas: a entrada não é desconto
-- e pode ser preenchida por qualquer função. O valor da cotação continua = soma dos itens.
-- ============================================================
create or replace function public.quotes_guard_desconto()
returns trigger
language plpgsql
as $$
declare
  v_role text := public.current_role_name();
  v_limite numeric;
  v_desc numeric; v_soma numeric; v_desc_old numeric := 0;
begin
  if v_role is null then return new; end if;
  if tg_op = 'UPDATE' and new.items_detail is not distinct from old.items_detail and new.value is not distinct from old.value then
    return new;
  end if;
  select coalesce(sum(-t) filter (where t < 0 and not nao_desc), 0), coalesce(sum(t), 0) into v_desc, v_soma
    from (select coalesce(nullif(e->>'total', '')::numeric, 0) as t,
                 coalesce((e->>'entrada')::boolean, false) as nao_desc
            from jsonb_array_elements(coalesce(new.items_detail, '[]'::jsonb)) e) x;
  if tg_op = 'UPDATE' then
    select coalesce(sum(-t) filter (where t < 0 and not nao_desc), 0) into v_desc_old
      from (select coalesce(nullif(e->>'total', '')::numeric, 0) as t,
                   coalesce((e->>'entrada')::boolean, false) as nao_desc
              from jsonb_array_elements(coalesce(old.items_detail, '[]'::jsonb)) e) y;
  end if;
  v_limite := case v_role when 'ADM' then null when 'Gerente' then 300 when 'Consultor' then 300 else 0 end;
  if v_limite is not null and v_desc > v_limite and v_desc > v_desc_old then
    raise exception 'Desconto acima do limite do seu perfil (€ %).', v_limite using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(new.items_detail, '[]'::jsonb)) > 0 and abs(coalesce(new.value, 0) - v_soma) > 0.05 then
    raise exception 'O valor da cotação não confere com os itens.' using errcode = '23514';
  end if;
  return new;
end;
$$;
