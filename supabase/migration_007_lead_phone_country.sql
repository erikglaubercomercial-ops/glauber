-- ============================================================
-- Migration 007: controle de nacionalidade do lead — país (com
-- bandeira/DDI) + DDD, exigidos no formulário para o botão de
-- WhatsApp funcionar. O botão passa a montar o número a partir
-- de DDI + DDD + número, em vez de assumir sempre Brasil.
-- ============================================================

alter table public.leads add column if not exists country_code text not null default 'BR';
alter table public.leads add column if not exists phone_ddd text not null default '';
alter table public.leads add column if not exists phone_number text not null default '';

-- backfill: leads já cadastrados tinham telefone livre, quase sempre
-- brasileiro (mesma suposição que o botão de WhatsApp já fazia antes
-- desta migration) — separa em DDD + número quando dá pra reconhecer
-- o formato, para não quebrar o botão de quem já está cadastrado.
update public.leads
set
  phone_ddd = case
    when length(regexp_replace(phone, '\D', '', 'g')) >= 12
      and regexp_replace(phone, '\D', '', 'g') like '55%'
      then substring(regexp_replace(phone, '\D', '', 'g') from 3 for 2)
    when length(regexp_replace(phone, '\D', '', 'g')) in (10, 11)
      then substring(regexp_replace(phone, '\D', '', 'g') from 1 for 2)
    else ''
  end,
  phone_number = case
    when length(regexp_replace(phone, '\D', '', 'g')) >= 12
      and regexp_replace(phone, '\D', '', 'g') like '55%'
      then substring(regexp_replace(phone, '\D', '', 'g') from 5)
    when length(regexp_replace(phone, '\D', '', 'g')) in (10, 11)
      then substring(regexp_replace(phone, '\D', '', 'g') from 3)
    else ''
  end
where phone_ddd = '' and phone is not null and phone <> '';
