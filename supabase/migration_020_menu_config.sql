-- ============================================================
-- MIGRAÇÃO 020 — estrutura do menu lateral (sidebar) configurável
-- pelo ADM: ordem dos itens e submenus, salva em uma linha única
-- (mesmo padrão de team_announcements/commission_settings), valendo
-- para todos os usuários do CRM.
-- ============================================================

create table public.menu_config (
  id integer primary key default 1,
  structure jsonb not null,
  updated_by_name text default '',
  updated_at timestamptz not null default now(),
  constraint menu_config_single_row check (id = 1)
);

insert into public.menu_config (id, structure) values (1, '{
  "sections": [
    { "id": "geral", "items": [
      { "id": "dashboard" },
      { "id": "leads", "children": ["leadsparados"] },
      { "id": "pipeline" },
      { "id": "cotacao" },
      { "id": "contratos" },
      { "id": "produtos" },
      { "id": "financeiro" },
      { "id": "matriculas" },
      { "id": "colaboradores" },
      { "id": "formularios" },
      { "id": "templates" },
      { "id": "areaaluno", "children": ["areaaluno-preview-link"] }
    ]},
    { "id": "administracao", "items": [
      { "id": "usuarios" }
    ]}
  ]
}'::jsonb);

alter table public.menu_config enable row level security;

create policy "menu_config: autenticados leem"
  on public.menu_config for select
  using (auth.role() = 'authenticated');

create policy "menu_config: somente ADM atualiza"
  on public.menu_config for update
  using (public.current_role_name() = 'ADM')
  with check (public.current_role_name() = 'ADM');
