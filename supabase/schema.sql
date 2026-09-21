-- ============================================================
-- CRM Peregrinos — schema inicial (Supabase / Postgres)
-- Rode este arquivo inteiro no Supabase: SQL Editor → New query → Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- PERFIS (vinculados ao login real do Supabase Auth)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role text not null default 'Consultor'
    check (role in ('ADM','Gerente','Consultor','Influencer','MKT','Financeiro')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cria automaticamente um perfil quando um login é criado no Supabase Auth.
-- Novos usuários nascem como "Consultor" — o ADM ajusta a função depois
-- na tela de Usuários do sistema.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'Consultor'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- PERMISSÕES POR FUNÇÃO (quais módulos cada função acessa)
-- ============================================================
create table public.role_permissions (
  role text not null check (role in ('Gerente','Consultor','Influencer','MKT','Financeiro')),
  module text not null check (module in ('leads','pipeline','cotacao','produtos')),
  allowed boolean not null default false,
  primary key (role, module)
);

insert into public.role_permissions (role, module, allowed) values
  ('Gerente','leads',true),    ('Gerente','pipeline',true),    ('Gerente','cotacao',true),    ('Gerente','produtos',true),
  ('Consultor','leads',true),  ('Consultor','pipeline',true),  ('Consultor','cotacao',false), ('Consultor','produtos',false),
  ('Influencer','leads',true), ('Influencer','pipeline',false),('Influencer','cotacao',false),('Influencer','produtos',false),
  ('MKT','leads',true),        ('MKT','pipeline',false),       ('MKT','cotacao',false),       ('MKT','produtos',false),
  ('Financeiro','leads',false),('Financeiro','pipeline',false),('Financeiro','cotacao',true),  ('Financeiro','produtos',true);

-- ============================================================
-- ORIGENS DE LEADS (gerenciáveis pela tela de Leads)
-- name é a chave primária — simples de referenciar do app,
-- sem precisar rastrear um id separado.
-- ============================================================
create table public.lead_sources (
  name text primary key,
  ordem integer not null default 100
);

insert into public.lead_sources (name, ordem) values
  ('Indicação', 1), ('Site', 2), ('Redes Sociais', 3), ('Anúncio', 4), ('Evento', 5), ('Outro', 6);

-- ============================================================
-- LEADS
-- ============================================================
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text default '',
  phone text default '',
  email text default '',
  category text not null default 'Outro',
  source text not null default 'Outro',
  temperature text not null default 'Morno' check (temperature in ('Quente','Morno','Frio')),
  status text not null default 'Novo' check (status in ('Novo','Em contato','Qualificado','Descartado')),
  consultor_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PIPELINE (negócios / funil de vendas)
-- ============================================================
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text default '',
  info text default '',
  value numeric(12,2) not null default 0,
  stage text not null default 'lead'
    check (stage in ('lead','contato','proposta','negociacao','ganho','perdido')),
  notes text default '',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

-- ============================================================
-- COTAÇÕES (lista simples do módulo Cotação)
-- ============================================================
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  client text not null,
  items text default '',
  value numeric(12,2) not null default 0,
  validade date,
  status text not null default 'Aberta' check (status in ('Aberta','Enviada','Aprovada','Recusada')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- CATÁLOGO DE PRODUTOS (Categoria > Destino > Escola > Turno > Item)
-- ============================================================
create table public.catalog_items (
  id text primary key,
  nome text not null,
  categoria text not null default 'Outros',
  destino text not null default 'Todos',
  subgrupo text not null default '',
  turno text not null default '',
  unidade text not null default 'unidade',
  preco numeric(12,2) not null default 0,
  ordem integer not null default 100,
  detalhe text default '',
  qtd_fixa boolean not null default false,
  qtd_padrao integer not null default 1,
  ativo boolean not null default true,
  subs jsonb not null default '[]'::jsonb
);

-- ============================================================
-- ROW LEVEL SECURITY — a regra real de acesso vive aqui, no banco,
-- não só escondida na tela (diferente do protótipo em localStorage).
-- ============================================================
alter table public.profiles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.lead_sources enable row level security;
alter table public.leads enable row level security;
alter table public.deals enable row level security;
alter table public.quotes enable row level security;
alter table public.catalog_items enable row level security;

create or replace function public.current_role_name()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public;

create or replace function public.has_module_access(mod text)
returns boolean as $$
  select case
    when public.current_role_name() = 'ADM' then true
    else coalesce(
      (select allowed from public.role_permissions
       where role = public.current_role_name() and module = mod),
      false
    )
  end;
$$ language sql stable security definer set search_path = public;

-- ---------- profiles ----------
create policy "autenticados veem todos os perfis"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "somente ADM altera perfis"
  on public.profiles for update
  using (public.current_role_name() = 'ADM');

create policy "somente ADM exclui perfis"
  on public.profiles for delete
  using (public.current_role_name() = 'ADM');

-- ---------- role_permissions ----------
create policy "autenticados leem permissões"
  on public.role_permissions for select
  using (auth.role() = 'authenticated');

create policy "somente ADM altera permissões"
  on public.role_permissions for all
  using (public.current_role_name() = 'ADM')
  with check (public.current_role_name() = 'ADM');

-- ---------- lead_sources ----------
create policy "autenticados leem origens"
  on public.lead_sources for select
  using (auth.role() = 'authenticated');

create policy "quem acessa leads gerencia origens"
  on public.lead_sources for all
  using (public.has_module_access('leads'))
  with check (public.has_module_access('leads'));

-- ---------- leads (regra do Consultor vive aqui) ----------
create policy "ver leads conforme função e atribuição"
  on public.leads for select
  using (
    public.has_module_access('leads')
    and (public.current_role_name() <> 'Consultor' or consultor_id = auth.uid())
  );

create policy "criar leads quem acessa o módulo"
  on public.leads for insert
  with check (public.has_module_access('leads'));

create policy "editar leads conforme função e atribuição"
  on public.leads for update
  using (
    public.has_module_access('leads')
    and (public.current_role_name() <> 'Consultor' or consultor_id = auth.uid())
  );

create policy "excluir leads conforme função e atribuição"
  on public.leads for delete
  using (
    public.has_module_access('leads')
    and (public.current_role_name() <> 'Consultor' or consultor_id = auth.uid())
  );

-- ---------- deals (pipeline) ----------
create policy "pipeline conforme módulo"
  on public.deals for all
  using (public.has_module_access('pipeline'))
  with check (public.has_module_access('pipeline'));

-- ---------- quotes ----------
create policy "cotações conforme módulo"
  on public.quotes for all
  using (public.has_module_access('cotacao'))
  with check (public.has_module_access('cotacao'));

-- ---------- catalog_items ----------
create policy "catálogo: leitura para quem acessa produtos"
  on public.catalog_items for select
  using (public.has_module_access('produtos'));

create policy "catálogo: escrita somente ADM"
  on public.catalog_items for insert
  with check (public.current_role_name() = 'ADM');

create policy "catálogo: edição somente ADM"
  on public.catalog_items for update
  using (public.current_role_name() = 'ADM');

create policy "catálogo: exclusão somente ADM"
  on public.catalog_items for delete
  using (public.current_role_name() = 'ADM');
