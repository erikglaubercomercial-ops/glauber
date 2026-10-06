-- ============================================================
-- MIGRAÇÃO 038 — aprovação da cotação pelo próprio lead, por link.
-- O lead abre o link, lê a cotação, marca "li e concordo" e confirma; o
-- sistema grava a aprovação (data/hora, IP, o que foi aprovado) e passa
-- a cotação para "Aprovada", liberando "Gerar contrato".
--
-- Regras de segurança no banco:
--  • contrato novo (modo 'proposta') só nasce de cotação aprovada pelo lead;
--  • se o valor ou os itens da cotação mudarem depois da aprovação, a
--    aprovação cai (o lead precisa aprovar de novo);
--  • uma tela antiga do consultor não consegue "desaprovar" uma cotação
--    que o lead já aprovou.
-- Não altera nenhuma cotação existente além de dar a cada uma um link.
-- ============================================================

alter table public.quotes add column if not exists public_token uuid not null default gen_random_uuid();
create unique index if not exists quotes_public_token_unique on public.quotes(public_token);
alter table public.quotes add column if not exists aprovada_em timestamptz;
alter table public.quotes add column if not exists aprovada_ip text;
alter table public.quotes add column if not exists aprovada_user_agent text;
alter table public.quotes add column if not exists aprovada_snapshot jsonb;

-- "impressão digital" do que é comercialmente a cotação: total + (item, quantidade, preço)
create or replace function public.quote_conteudo(p_items jsonb, p_value numeric)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'value', coalesce(p_value, 0),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('id', e ->> 'id', 'qtd', e ->> 'qtd', 'preco', e ->> 'preco') order by ord)
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord)
    ), '[]'::jsonb)
  );
$$;

create or replace function public.quotes_guard_aprovacao()
returns trigger
language plpgsql
as $$
begin
  if old.aprovada_em is not null then
    if public.quote_conteudo(new.items_detail, new.value) is distinct from public.quote_conteudo(old.items_detail, old.value) then
      -- valor ou itens mudaram depois da aprovação: ela deixa de valer
      new.aprovada_em := null;
      new.aprovada_ip := null;
      new.aprovada_user_agent := null;
      new.aprovada_snapshot := null;
      if new.status = 'Aprovada' then new.status := 'Enviada'; end if;
    else
      -- nada comercial mudou: a aprovação do lead continua, mesmo que uma tela antiga regrave a linha
      new.aprovada_em := old.aprovada_em;
      new.aprovada_ip := old.aprovada_ip;
      new.aprovada_user_agent := old.aprovada_user_agent;
      new.aprovada_snapshot := old.aprovada_snapshot;
      if new.status not in ('Aprovada', 'Recusada') then new.status := 'Aprovada'; end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger quotes_guard_aprovacao
  before update on public.quotes
  for each row execute function public.quotes_guard_aprovacao();

-- contrato com cotação só nasce de cotação aprovada pelo lead
create or replace function public.contracts_exige_aprovacao()
returns trigger
language plpgsql
as $$
begin
  if new.modo = 'proposta' then
    if new.quote_id is null
       or not exists (select 1 from public.quotes q where q.id = new.quote_id and q.aprovada_em is not null) then
      raise exception 'cotacao_nao_aprovada_pelo_cliente';
    end if;
  end if;
  return new;
end;
$$;

create trigger contracts_exige_aprovacao
  before insert on public.contracts
  for each row execute function public.contracts_exige_aprovacao();

-- ---------- página pública de aprovação ----------
create or replace function public.get_quote_public(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'numero', q.numero, 'client', q.client, 'email', q.email, 'items_detail', q.items_detail,
    'value', q.value, 'emissao', q.emissao, 'validade', q.validade,
    'consultor_name', q.consultor_name, 'consultor_email', q.consultor_email,
    'observacoes', q.observacoes, 'status', q.status, 'aprovada_em', q.aprovada_em,
    'vencida', (q.aprovada_em is null and q.validade is not null and q.validade < (now() at time zone 'America/Sao_Paulo')::date)
  )
  from public.quotes q
  where q.public_token = p_token;
$$;

grant execute on function public.get_quote_public(uuid) to anon;

create or replace function public.approve_quote_public(p_token uuid, p_aceite boolean, p_user_agent text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.quotes;
  v_ip text;
begin
  select * into q from public.quotes where public_token = p_token for update;
  if not found then
    raise exception 'cotacao_indisponivel';
  end if;
  if q.aprovada_em is not null then
    return jsonb_build_object('ok', true, 'ja_aprovada', true);
  end if;
  if q.status = 'Recusada' then
    raise exception 'cotacao_indisponivel';
  end if;
  if q.validade is not null and q.validade < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'cotacao_vencida';
  end if;
  if not coalesce(p_aceite, false) then
    raise exception 'aceite_obrigatorio';
  end if;

  begin
    v_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1);
  exception when others then
    v_ip := null;
  end;

  update public.quotes set
    status = 'Aprovada',
    aprovada_em = now(),
    aprovada_ip = v_ip,
    aprovada_user_agent = left(coalesce(p_user_agent, ''), 400),
    aprovada_snapshot = jsonb_build_object(
      'numero', q.numero, 'client', q.client, 'email', q.email, 'items_detail', q.items_detail,
      'value', q.value, 'emissao', q.emissao, 'validade', q.validade)
  where id = q.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.approve_quote_public(uuid, boolean, text) to anon;
