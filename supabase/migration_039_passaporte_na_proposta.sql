-- ============================================================
-- MIGRAÇÃO 039 — envio do passaporte (foto ou PDF) na etapa "Seus dados"
-- do link do contrato, com data de expedição e validade do passaporte.
--
-- O lead envia o arquivo direto para o bucket privado passport-photos
-- (a política "aluno envia pelo link público" já permite o envio sem login),
-- numa pasta com o token da proposta: proposta/<token>/passaporte-....
-- O caminho fica em dados_cliente.passaporte_path (e, ao assinar, no
-- snapshot). A equipe que acessa Contratos passa a poder baixar o arquivo.
-- ============================================================

create policy "passport-photos: equipe de contratos lê"
  on storage.objects for select
  using (bucket_id = 'passport-photos' and public.has_module_access('contratos'));

create or replace function public.save_proposal_data(p_token uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contracts;
  k text;
  v jsonb := '{}'::jsonb;
  txt text;
  v_prefixo text := 'proposta/' || p_token::text || '/';
begin
  select * into c from public.contracts where public_token = p_token and modo = 'proposta';
  if not found or c.status <> 'Aguardando assinatura' then
    raise exception 'proposta_indisponivel';
  end if;

  foreach k in array array[
    'nome','cpf','documento','passaporte_expedicao','passaporte_validade','data_nascimento','nacionalidade',
    'endereco','cidade_estado','cep','telefone','email','contato_emergencia_nome','contato_emergencia_telefone'
  ] loop
    txt := left(btrim(coalesce(p_dados ->> k, '')), 300);
    if k = 'email' then txt := lower(txt); end if;
    v := v || jsonb_build_object(k, txt);
  end loop;

  -- passaporte: só aceita caminho dentro da pasta desta própria proposta
  txt := left(btrim(coalesce(p_dados ->> 'passaporte_path', '')), 300);
  if txt <> '' and left(txt, length(v_prefixo)) = v_prefixo then
    v := v || jsonb_build_object('passaporte_path', txt);
  end if;

  update public.contracts set dados_cliente = v, updated_at = now() where id = c.id;

  -- mudou o e-mail ou algum dado: os códigos já enviados deixam de valer
  update public.contract_verifications set used_at = now() where contract_id = c.id and used_at is null;
end;
$$;

grant execute on function public.save_proposal_data(uuid, jsonb) to anon;

-- campos obrigatórios para assinar agora incluem expedição e validade do passaporte
create or replace function public.proposta_campos_faltando(p_dados jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(k order by ord), '{}')
  from unnest(array[
    'nome','cpf','documento','passaporte_expedicao','passaporte_validade','data_nascimento','nacionalidade',
    'endereco','cidade_estado','cep','telefone','email','contato_emergencia_nome','contato_emergencia_telefone'
  ]) with ordinality as t(k, ord)
  where coalesce(btrim(p_dados ->> k), '') = '';
$$;

-- matrícula: data de expedição e validade do passaporte
alter table public.enrollments add column if not exists passport_issue_date date;
alter table public.enrollments add column if not exists passport_expiry_date date;

create or replace function public.update_enrollment_by_token(p_token uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.enrollments set
    emergency_phone = coalesce(p_data->>'emergency_phone', emergency_phone),
    passport_number = coalesce(p_data->>'passport_number', passport_number),
    passport_photo_path = coalesce(p_data->>'passport_photo_path', passport_photo_path),
    passport_issue_date = case when p_data ? 'passport_issue_date' then nullif(p_data->>'passport_issue_date', '')::date else passport_issue_date end,
    passport_expiry_date = case when p_data ? 'passport_expiry_date' then nullif(p_data->>'passport_expiry_date', '')::date else passport_expiry_date end,
    cpf = coalesce(p_data->>'cpf', cpf),
    address_street = coalesce(p_data->>'address_street', address_street),
    address_number = coalesce(p_data->>'address_number', address_number),
    address_complement = coalesce(p_data->>'address_complement', address_complement),
    address_neighborhood = coalesce(p_data->>'address_neighborhood', address_neighborhood),
    address_city = coalesce(p_data->>'address_city', address_city),
    address_state = coalesce(p_data->>'address_state', address_state),
    address_zip = coalesce(p_data->>'address_zip', address_zip),
    status = 'Preenchido pelo aluno',
    updated_at = now()
  where public_token = p_token;
end;
$$;
