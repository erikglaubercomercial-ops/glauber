-- ============================================================
-- MIGRAÇÃO 036 — link único "cotação + contrato" em 3 etapas, sem custo:
--   1) o lead preenche os dados;  2) lê a cotação e o contrato;
--   3) aceita os termos e confirma com um código enviado ao e-mail dele.
--
-- Tudo roda no próprio Supabase (funções no banco). O e-mail do código sai
-- por um provedor gratuito (Resend ou Brevo) chamado pelo pg_net; a chave
-- fica no Vault, nunca no código. Sem chave configurada, o envio do código
-- responde "e-mail não configurado" e nada é assinado.
--
-- O contrato "simples" que já existe (texto + assinatura desenhada) segue
-- funcionando; os contratos novos usam modo = 'proposta'.
-- ============================================================

create extension if not exists pg_net;

-- ---------- numeração: upsert de linha que já existe não gasta número ----------
-- (o app regrava a linha inteira com upsert; o gatilho de INSERT dispara mesmo
-- quando a linha já existe e vira UPDATE)
create or replace function public.quotes_fill_numero()
returns trigger
language plpgsql
as $$
begin
  if (new.numero is null or new.numero = '') and not exists (select 1 from public.quotes where id = new.id) then
    new.numero := public.next_doc_number('cotacao');
  end if;
  return new;
end;
$$;

create or replace function public.contracts_fill_numero()
returns trigger
language plpgsql
as $$
begin
  if (new.numero is null or new.numero = '') and not exists (select 1 from public.contracts where id = new.id) then
    new.numero := public.next_doc_number('contrato');
  end if;
  return new;
end;
$$;

-- ---------- colunas novas em contracts ----------
alter table public.contracts add column if not exists modo text not null default 'simples'
  check (modo in ('simples', 'proposta'));
alter table public.contracts add column if not exists dados_cliente jsonb not null default '{}'::jsonb;
alter table public.contracts add column if not exists aceite_email text;
alter table public.contracts add column if not exists aceite_user_agent text;
alter table public.contracts add column if not exists codigo_validado_em timestamptz;

-- uma cotação pode ter vários contratos desde que os anteriores tenham sido cancelados
drop index if exists public.contracts_quote_id_unique;
create unique index contracts_quote_id_unique
  on public.contracts(quote_id) where quote_id is not null and status <> 'Cancelado';

-- ---------- códigos de confirmação (só as funções acessam) ----------
create table public.contract_verifications (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index contract_verifications_contract_idx on public.contract_verifications(contract_id, created_at desc);
alter table public.contract_verifications enable row level security;   -- sem políticas de propósito

-- ---------- os contratos antigos ("simples") não podem ser assinados pelo link novo, e vice-versa ----------
create or replace function public.get_contract_by_token(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'content', c.content, 'value', c.value,
    'status', c.status, 'signer_name', c.signer_name, 'signed_at', c.signed_at,
    'lead_name', l.name
  )
  from public.contracts c
  left join public.leads l on l.id = c.lead_id
  where c.public_token = p_token and c.modo = 'simples';
$$;

create or replace function public.sign_contract_public(
  p_token uuid, p_signer_name text, p_signer_document text,
  p_signature_data text, p_pdf_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text;
begin
  begin
    v_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1);
  exception when others then
    v_ip := null;
  end;

  update public.contracts set
    signer_name = p_signer_name,
    signer_document = p_signer_document,
    signature_data = p_signature_data,
    pdf_path = p_pdf_path,
    signed_at = now(),
    signed_ip = v_ip,
    status = 'Assinado',
    updated_at = now()
  where public_token = p_token and status = 'Aguardando assinatura' and modo = 'simples';

  if not found then
    raise exception 'Este contrato não está mais disponível para assinatura.';
  end if;
end;
$$;

-- ---------- campos que o lead preenche (todos obrigatórios para assinar) ----------
create or replace function public.proposta_campos_faltando(p_dados jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(k order by ord), '{}')
  from unnest(array[
    'nome','cpf','documento','data_nascimento','nacionalidade','endereco','cidade_estado','cep',
    'telefone','email','contato_emergencia_nome','contato_emergencia_telefone'
  ]) with ordinality as t(k, ord)
  where coalesce(btrim(p_dados ->> k), '') = '';
$$;

-- ---------- dados da proposta para a página pública ----------
create or replace function public.get_proposal(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status', c.status,
    'numero', c.numero,
    'title', c.title,
    'assinado_em', c.signed_at,
    'dados_cliente', c.dados_cliente,
    'prefill', jsonb_build_object(
      'nome', coalesce(nullif(e.name, ''), l.name, q.client, ''),
      'email', coalesce(nullif(e.email, ''), nullif(l.email, ''), q.email, ''),
      'telefone', coalesce(nullif(e.phone, ''), l.phone, ''),
      'cpf', coalesce(e.cpf, ''),
      'documento', coalesce(e.passport_number, ''),
      'data_nascimento', coalesce(e.birth_date::text, ''),
      'nacionalidade', coalesce(e.nationality, ''),
      'endereco', concat_ws(', ', nullif(e.address_street, ''), nullif(e.address_number, ''), nullif(e.address_complement, ''), nullif(e.address_neighborhood, '')),
      'cidade_estado', concat_ws(' / ', nullif(e.address_city, ''), nullif(e.address_state, '')),
      'cep', coalesce(e.address_zip, ''),
      'contato_emergencia_nome', coalesce(e.emergency_name, ''),
      'contato_emergencia_telefone', coalesce(e.emergency_phone, '')
    ),
    'cotacao', case when q.id is null then null else jsonb_build_object(
      'numero', q.numero, 'client', q.client, 'email', q.email, 'items_detail', q.items_detail,
      'value', q.value, 'emissao', q.emissao, 'validade', q.validade,
      'consultor_name', q.consultor_name, 'consultor_email', q.consultor_email
    ) end,
    'template_html', t.html,
    'snapshot', case when c.status = 'Assinado' then c.dados_snapshot else null end
  )
  from public.contracts c
  left join public.leads l on l.id = c.lead_id
  left join lateral (
    select * from public.enrollments en where en.lead_id = c.lead_id order by en.created_at desc limit 1
  ) e on true
  left join public.quotes q on q.id = c.quote_id
  left join public.contract_templates t on t.id = c.template_id
  where c.public_token = p_token and c.modo = 'proposta';
$$;

grant execute on function public.get_proposal(uuid) to anon;

-- ---------- etapa 1: salvar os dados do lead ----------
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
begin
  select * into c from public.contracts where public_token = p_token and modo = 'proposta';
  if not found or c.status <> 'Aguardando assinatura' then
    raise exception 'proposta_indisponivel';
  end if;

  foreach k in array array[
    'nome','cpf','documento','data_nascimento','nacionalidade','endereco','cidade_estado','cep',
    'telefone','email','contato_emergencia_nome','contato_emergencia_telefone'
  ] loop
    txt := left(btrim(coalesce(p_dados ->> k, '')), 300);
    if k = 'email' then txt := lower(txt); end if;
    v := v || jsonb_build_object(k, txt);
  end loop;

  update public.contracts set dados_cliente = v, updated_at = now() where id = c.id;

  -- mudou o e-mail ou algum dado: os códigos já enviados deixam de valer
  update public.contract_verifications set used_at = now() where contract_id = c.id and used_at is null;
end;
$$;

grant execute on function public.save_proposal_data(uuid, jsonb) to anon;

-- ---------- envio do e-mail (provedor gratuito, chave no Vault) ----------
-- segredos no Vault: mail_provider ('resend' ou 'brevo'), mail_api_key, mail_from_email, mail_from_name (opcional)
create or replace function public.send_proposal_code_email(p_to text, p_code text, p_numero text, p_nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
  v_key text;
  v_from_email text;
  v_from_name text;
  v_subject text := 'Seu código de confirmação — contrato Peregrinos Intercâmbio';
  v_html text;
begin
  select decrypted_secret into v_provider from vault.decrypted_secrets where name = 'mail_provider';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'mail_api_key';
  select decrypted_secret into v_from_email from vault.decrypted_secrets where name = 'mail_from_email';
  select decrypted_secret into v_from_name from vault.decrypted_secrets where name = 'mail_from_name';
  v_from_name := coalesce(nullif(v_from_name, ''), 'Peregrinos Intercâmbio');

  if coalesce(v_key, '') = '' or coalesce(v_from_email, '') = '' or coalesce(v_provider, '') not in ('resend', 'brevo') then
    raise exception 'email_nao_configurado';
  end if;

  v_html := format(
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1a2233">'
    || '<h2 style="color:#1f4670;margin:0 0 12px">Confirme a assinatura do contrato</h2>'
    || '<p>Olá, %s.</p>'
    || '<p>Use o código abaixo para confirmar o aceite do contrato nº <b>%s</b>:</p>'
    || '<p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#1f4670;margin:18px 0">%s</p>'
    || '<p style="color:#65768b;font-size:13px">O código vale por 10 minutos. Se você não pediu esta confirmação, ignore este e-mail.</p>'
    || '<p style="color:#65768b;font-size:13px">Peregrinos Intercâmbio — O caminho transforma.</p></div>',
    replace(replace(coalesce(p_nome, ''), '<', ''), '>', ''), p_numero, p_code);

  if v_provider = 'resend' then
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('from', v_from_name || ' <' || v_from_email || '>', 'to', jsonb_build_array(p_to), 'subject', v_subject, 'html', v_html)
    );
  else
    perform net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      headers := jsonb_build_object('api-key', v_key, 'Content-Type', 'application/json', 'accept', 'application/json'),
      body := jsonb_build_object('sender', jsonb_build_object('name', v_from_name, 'email', v_from_email), 'to', jsonb_build_array(jsonb_build_object('email', p_to)), 'subject', v_subject, 'htmlContent', v_html)
    );
  end if;
end;
$$;

revoke all on function public.send_proposal_code_email(text, text, text, text) from public, anon, authenticated;

-- ---------- etapa 3a: pedir o código de confirmação ----------
create or replace function public.request_proposal_code(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c public.contracts;
  v_email text;
  v_code text;
  v_bytes bytea;
begin
  select * into c from public.contracts where public_token = p_token and modo = 'proposta';
  if not found or c.status <> 'Aguardando assinatura' then
    raise exception 'proposta_indisponivel';
  end if;
  if array_length(public.proposta_campos_faltando(c.dados_cliente), 1) is not null then
    raise exception 'dados_incompletos';
  end if;

  v_email := lower(btrim(c.dados_cliente ->> 'email'));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'email_invalido';
  end if;

  if exists (select 1 from public.contract_verifications where contract_id = c.id and created_at > now() - interval '60 seconds') then
    raise exception 'aguarde_para_reenviar';
  end if;
  if (select count(*) from public.contract_verifications where contract_id = c.id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'limite_de_codigos';
  end if;

  v_bytes := gen_random_bytes(4);
  v_code := lpad(((get_byte(v_bytes, 0)::bigint * 16777216 + get_byte(v_bytes, 1) * 65536 + get_byte(v_bytes, 2) * 256 + get_byte(v_bytes, 3)) % 1000000)::text, 6, '0');

  update public.contract_verifications set used_at = now() where contract_id = c.id and used_at is null;
  insert into public.contract_verifications (contract_id, email, code_hash, expires_at)
  values (c.id, v_email, encode(digest(v_code || ':' || c.id::text, 'sha256'), 'hex'), now() + interval '10 minutes');

  perform public.send_proposal_code_email(v_email, v_code, c.numero, c.dados_cliente ->> 'nome');

  return jsonb_build_object('email_mascarado', left(split_part(v_email, '@', 1), 2) || '***@' || split_part(v_email, '@', 2));
end;
$$;

grant execute on function public.request_proposal_code(uuid) to anon;

-- ---------- etapa 3b: aceitar os termos e assinar com o código ----------
create or replace function public.sign_proposal(p_token uuid, p_code text, p_aceite boolean, p_user_agent text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c public.contracts;
  v public.contract_verifications;
  v_ip text;
  v_html text;
  v_versao integer;
  q public.quotes;
begin
  select * into c from public.contracts where public_token = p_token and modo = 'proposta' for update;
  if not found or c.status <> 'Aguardando assinatura' then
    raise exception 'proposta_indisponivel';
  end if;
  if not coalesce(p_aceite, false) then
    raise exception 'aceite_obrigatorio';
  end if;
  if array_length(public.proposta_campos_faltando(c.dados_cliente), 1) is not null then
    raise exception 'dados_incompletos';
  end if;

  select * into v from public.contract_verifications
  where contract_id = c.id and used_at is null
  order by created_at desc limit 1 for update;

  if not found then
    return jsonb_build_object('ok', false, 'erro', 'codigo_invalido');
  end if;
  if v.expires_at < now() then
    update public.contract_verifications set used_at = now() where id = v.id;
    return jsonb_build_object('ok', false, 'erro', 'codigo_expirado');
  end if;
  if v.attempts >= 5 then
    return jsonb_build_object('ok', false, 'erro', 'codigo_bloqueado');
  end if;

  if encode(digest(btrim(coalesce(p_code, '')) || ':' || c.id::text, 'sha256'), 'hex') <> v.code_hash then
    update public.contract_verifications set attempts = attempts + 1 where id = v.id;
    return jsonb_build_object('ok', false, 'erro', 'codigo_invalido', 'tentativas_restantes', greatest(0, 4 - v.attempts));
  end if;

  update public.contract_verifications set used_at = now() where id = v.id;

  begin
    v_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1);
  exception when others then
    v_ip := null;
  end;

  select t.html, t.versao into v_html, v_versao from public.contract_templates t where t.id = c.template_id;
  select * into q from public.quotes where id = c.quote_id;

  update public.contracts set
    status = 'Assinado',
    signed_at = now(),
    signed_ip = v_ip,
    signer_name = c.dados_cliente ->> 'nome',
    signer_document = coalesce(nullif(c.dados_cliente ->> 'cpf', ''), c.dados_cliente ->> 'documento'),
    aceite_email = v.email,
    aceite_user_agent = left(coalesce(p_user_agent, ''), 400),
    codigo_validado_em = now(),
    dados_snapshot = jsonb_build_object(
      'cliente', c.dados_cliente,
      'contrato', jsonb_build_object('numero', c.numero, 'assinado_em', now(), 'ip', v_ip, 'email_confirmado', v.email),
      'cotacao', case when q.id is null then null else jsonb_build_object(
        'numero', q.numero, 'client', q.client, 'email', q.email, 'items_detail', q.items_detail,
        'value', q.value, 'emissao', q.emissao, 'validade', q.validade,
        'consultor_name', q.consultor_name, 'consultor_email', q.consultor_email) end,
      'template_html', v_html,
      'template_versao', v_versao
    ),
    updated_at = now()
  where id = c.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.sign_proposal(uuid, text, boolean, text) to anon;
