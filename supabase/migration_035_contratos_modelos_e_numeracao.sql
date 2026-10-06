-- ============================================================
-- MIGRAÇÃO 035 — contratos com modelo (HTML), numeração sequencial,
-- snapshot dos dados e estrutura pronta para assinatura externa
-- (ZapSign / Clicksign).
--
-- Não recria nada que já funciona: a tabela contracts continua com o
-- contrato e a assinatura por link que existem hoje, e ganha colunas.
-- Não apaga dados.
-- ============================================================

-- ---------- A) matrícula: dados que o contrato pede e ainda não existiam ----------
alter table public.enrollments add column if not exists birth_date date;
alter table public.enrollments add column if not exists nationality text default '';
alter table public.enrollments add column if not exists emergency_name text default '';

-- ---------- B) numeração sequencial por ano (AAAA-0001), atômica ----------
create table public.doc_counters (
  chave text primary key,
  ultimo integer not null default 0
);
alter table public.doc_counters enable row level security;   -- sem políticas: só as funções (security definer) mexem

create or replace function public.next_doc_number(p_tipo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ano text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY');
  v_n integer;
begin
  insert into public.doc_counters as c (chave, ultimo) values (p_tipo || '-' || v_ano, 1)
  on conflict (chave) do update set ultimo = c.ultimo + 1
  returning c.ultimo into v_n;
  return v_ano || '-' || lpad(v_n::text, 4, '0');
end;
$$;

-- cotações
alter table public.quotes add column if not exists numero text;

do $$
declare
  r record;
begin
  for r in select id from public.quotes where numero is null order by created_at, id loop
    update public.quotes set numero = public.next_doc_number('cotacao') where id = r.id;
  end loop;
end $$;

create unique index quotes_numero_unique on public.quotes(numero);

create or replace function public.quotes_fill_numero()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.next_doc_number('cotacao');
  end if;
  return new;
end;
$$;

create trigger quotes_fill_numero
  before insert on public.quotes
  for each row execute function public.quotes_fill_numero();

-- ---------- C) modelos de contrato (HTML com variáveis {{grupo.campo}}) ----------
create table public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  versao integer not null,
  html text not null,
  ativo boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (nome, versao)
);

-- só um modelo ativo por vez
create unique index contract_templates_um_ativo on public.contract_templates ((true)) where ativo;

alter table public.contract_templates enable row level security;

create policy "modelos de contrato: leitura para quem acessa contratos"
  on public.contract_templates for select
  using (public.has_module_access('contratos'));

create policy "modelos de contrato: criação somente ADM"
  on public.contract_templates for insert
  with check (public.current_role_name() = 'ADM');

create policy "modelos de contrato: edição somente ADM"
  on public.contract_templates for update
  using (public.current_role_name() = 'ADM');

create policy "modelos de contrato: exclusão somente ADM"
  on public.contract_templates for delete
  using (public.current_role_name() = 'ADM');

-- ---------- D) contratos: colunas novas ----------
alter table public.contracts add column if not exists numero text;
alter table public.contracts add column if not exists template_id uuid references public.contract_templates(id) on delete set null;
alter table public.contracts add column if not exists enrollment_id uuid references public.enrollments(id) on delete set null;
alter table public.contracts add column if not exists dados_snapshot jsonb;
alter table public.contracts add column if not exists pdf_url text;            -- PDF gerado (contrato + cotação), caminho no Storage
alter table public.contracts add column if not exists pdf_assinado_url text;   -- PDF assinado devolvido pelo provedor

-- assinatura externa (preparado, ainda sem chave de API)
alter table public.contracts add column if not exists provider text;           -- 'zapsign' | 'clicksign' | null (assinatura simples por link)
alter table public.contracts add column if not exists provider_doc_id text;
alter table public.contracts add column if not exists provider_status text;
alter table public.contracts add column if not exists provider_sent_at timestamptz;

do $$
declare
  r record;
begin
  for r in select id from public.contracts where numero is null order by created_at, id loop
    update public.contracts set numero = public.next_doc_number('contrato') where id = r.id;
  end loop;
end $$;

create unique index contracts_numero_unique on public.contracts(numero);
create index contracts_enrollment_id_idx on public.contracts(enrollment_id);
create unique index contracts_provider_doc_unique on public.contracts(provider, provider_doc_id) where provider_doc_id is not null;

create or replace function public.contracts_fill_numero()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.next_doc_number('contrato');
  end if;
  return new;
end;
$$;

create trigger contracts_fill_numero
  before insert on public.contracts
  for each row execute function public.contracts_fill_numero();

-- ---------- E) eventos do provedor de assinatura (webhooks) ----------
create table public.contract_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.contracts(id) on delete cascade,
  provider text not null,
  evento text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index contract_events_contract_idx on public.contract_events(contract_id);

alter table public.contract_events enable row level security;

-- a equipe só lê; quem grava é a rota de webhook (chave de serviço, que ignora RLS)
create policy "eventos de contrato: leitura para quem acessa contratos"
  on public.contract_events for select
  using (public.has_module_access('contratos'));
