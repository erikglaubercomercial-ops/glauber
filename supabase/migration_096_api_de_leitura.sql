-- ============================================================
-- MIGRAÇÃO 096 — API própria de LEITURA (para a gestora de tráfego / ferramentas externas).
-- Só o ADM gera, lista e revoga chaves (na tela Usuários). A chave aparece uma única vez; no banco fica só o hash (sha256).
-- A função de borda crm-api confere o hash, só LÊ (GET), tira colunas secretas (tokens, caminhos de arquivo, endereços privados)
-- e registra cada chamada em api_access_log. Chaves vencem sozinhas (padrão 180 dias) e podem ser revogadas na hora.
-- Sem políticas de RLS de propósito: o navegador nunca lê estas tabelas; só as funções abaixo (ADM) e a função de borda.
-- ============================================================

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  key_prefix text not null,
  key_hash text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.api_keys enable row level security;

create table public.api_access_log (
  id bigint generated always as identity primary key,
  key_id uuid not null references public.api_keys(id) on delete cascade,
  table_name text not null,
  rows_returned integer not null default 0,
  at timestamptz not null default now()
);
create index api_access_log_key_idx on public.api_access_log (key_id, at desc);
alter table public.api_access_log enable row level security;

create or replace function public.api_key_create(p_name text, p_days integer default 180)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_id uuid;
  v_exp timestamptz;
begin
  if public.current_role_name() is distinct from 'ADM' then raise exception 'sem_permissao'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'validade_invalida'; end if;
  v_key := 'peg_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(days => p_days);
  insert into public.api_keys (name, key_prefix, key_hash, created_by, expires_at)
  values (btrim(p_name), left(v_key, 8), encode(sha256(convert_to(v_key, 'utf8')), 'hex'), auth.uid(), v_exp)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key, 'expires_at', v_exp);
end;
$$;
revoke all on function public.api_key_create(text, integer) from public, anon;
grant execute on function public.api_key_create(text, integer) to authenticated;

create or replace function public.api_keys_list()
returns table (id uuid, name text, key_prefix text, created_at timestamptz, expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz, calls_30d bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_role_name() is distinct from 'ADM' then raise exception 'sem_permissao'; end if;
  return query
    select k.id, k.name, k.key_prefix, k.created_at, k.expires_at, k.last_used_at, k.revoked_at,
           (select count(*) from public.api_access_log l where l.key_id = k.id and l.at > now() - interval '30 days')
    from public.api_keys k order by k.created_at desc;
end;
$$;
revoke all on function public.api_keys_list() from public, anon;
grant execute on function public.api_keys_list() to authenticated;

create or replace function public.api_key_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role_name() is distinct from 'ADM' then raise exception 'sem_permissao'; end if;
  update public.api_keys set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;
revoke all on function public.api_key_revoke(uuid) from public, anon;
grant execute on function public.api_key_revoke(uuid) to authenticated;
