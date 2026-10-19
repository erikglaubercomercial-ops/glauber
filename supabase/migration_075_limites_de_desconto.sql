-- ============================================================
-- MIGRAÇÃO 075 — Novos limites de desconto na cotação: Consultor € 100, Gerente € 200 (ADM sem limite).
-- Substitui só a função do gatilho criado na 074; o resto das regras é igual.
-- ============================================================
create or replace function public.quotes_guard_desconto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_role_name();
  v_limite numeric;
  v_desc numeric; v_soma numeric; v_desc_old numeric := 0;
begin
  if v_role is null then return new; end if;   -- funções do sistema (aprovação pelo cliente, etc.)
  if tg_op = 'UPDATE' and new.items_detail is not distinct from old.items_detail and new.value is not distinct from old.value then
    return new;
  end if;
  select coalesce(sum(-t) filter (where t < 0), 0), coalesce(sum(t), 0) into v_desc, v_soma
    from (select coalesce(nullif(e->>'total', '')::numeric, 0) as t from jsonb_array_elements(coalesce(new.items_detail, '[]'::jsonb)) e) x;
  if tg_op = 'UPDATE' then
    select coalesce(sum(-t) filter (where t < 0), 0) into v_desc_old
      from (select coalesce(nullif(e->>'total', '')::numeric, 0) as t from jsonb_array_elements(coalesce(old.items_detail, '[]'::jsonb)) e) y;
  end if;
  v_limite := case v_role when 'ADM' then null when 'Gerente' then 200 when 'Consultor' then 100 else 0 end;
  if v_limite is not null and v_desc > v_limite and v_desc > v_desc_old then
    raise exception 'Desconto acima do limite do seu perfil (€ %).', v_limite using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(new.items_detail, '[]'::jsonb)) > 0 and abs(coalesce(new.value, 0) - v_soma) > 0.05 then
    raise exception 'O valor da cotação não confere com os itens.' using errcode = '23514';
  end if;
  return new;
end;
$$;
