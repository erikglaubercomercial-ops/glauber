-- ============================================================
-- MIGRAÇÃO 033 — bloqueio de telefone duplicado em leads, qualquer
-- que seja a origem (tela de Leads, importação CSV, conversão de
-- formulário, formulário público, integrações...).
--
-- Já existem leads com telefone repetido (cadastrados antes desta
-- regra), então NÃO é uma restrição única no índice: é um gatilho que
-- só barra lead NOVO com telefone que já existe, ou lead existente cujo
-- telefone for ALTERADO para um que já existe. Os duplicados antigos
-- continuam editáveis (se o telefone não mudar, nada é checado).
--
-- Chave do telefone = país + DDD + número (só dígitos); sem DDD/número
-- separados, usa os dígitos do campo phone (tirando o 55 de números
-- brasileiros). Números com menos de 8 dígitos são ignorados.
-- ============================================================

create or replace function public.lead_phone_key(p_country text, p_ddd text, p_number text, p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v_country text := coalesce(nullif(p_country, ''), 'BR');
  v_digits text := regexp_replace(coalesce(p_ddd, '') || coalesce(p_number, ''), '\D', '', 'g');
begin
  if v_digits = '' then
    v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
    if v_country = 'BR' and v_digits like '55%' and length(v_digits) in (12, 13) then
      v_digits := substr(v_digits, 3);
    end if;
  end if;
  if length(v_digits) < 8 then
    return null;
  end if;
  return v_country || ':' || v_digits;
end;
$$;

create index if not exists leads_phone_key_idx
  on public.leads (public.lead_phone_key(country_code, phone_ddd, phone_number, phone));

create or replace function public.leads_block_duplicate_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  -- o app regrava a lista de leads inteira (upsert): lead que já existe
  -- não é cadastro novo
  if tg_op = 'INSERT' and exists (select 1 from public.leads where id = new.id) then
    return new;
  end if;

  v_key := public.lead_phone_key(new.country_code, new.phone_ddd, new.phone_number, new.phone);
  if v_key is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and v_key is not distinct from public.lead_phone_key(old.country_code, old.phone_ddd, old.phone_number, old.phone) then
    return new;
  end if;

  if exists (
    select 1 from public.leads
    where id <> new.id
      and public.lead_phone_key(country_code, phone_ddd, phone_number, phone) = v_key
  ) then
    raise exception 'telefone_duplicado' using errcode = '23505';
  end if;

  return new;
end;
$$;

create trigger leads_block_duplicate_phone
  before insert or update of country_code, phone_ddd, phone_number, phone on public.leads
  for each row execute function public.leads_block_duplicate_phone();
