-- ============================================================
-- MIGRAÇÃO 072 — Quem acessa a Cotação precisa ler o catálogo.
-- A leitura de catalog_items e catalog_folders exigia acesso ao módulo Produtos; um Gerente
-- (Produtos bloqueado, Cotação liberada) abria a cotação e não via nenhum serviço.
-- Agora a leitura vale para quem acessa Produtos OU Cotação. Alterar continua só com o ADM.
-- ============================================================
drop policy if exists "catálogo: leitura para quem acessa produtos" on public.catalog_items;
create policy "catálogo: leitura para quem acessa produtos ou cotação"
  on public.catalog_items for select
  using (public.has_module_access('produtos') or public.has_module_access('cotacao'));

drop policy if exists "pastas do catálogo: leitura para quem acessa produtos" on public.catalog_folders;
create policy "pastas do catálogo: leitura para quem acessa produtos ou cotação"
  on public.catalog_folders for select
  using (public.has_module_access('produtos') or public.has_module_access('cotacao'));
