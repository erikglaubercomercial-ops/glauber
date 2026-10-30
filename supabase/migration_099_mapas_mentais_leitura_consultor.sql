-- ============================================================
-- MIGRAÇÃO 099 — Mapa Mental: o Consultor passa a LER os mapas (só visualizar e usar a apresentação).
-- Criar, editar e excluir continuam só com ADM, Gerente e MKT (políticas de insert/update/delete não mudam).
-- ============================================================
drop policy if exists "mapas mentais: leitura ADM, Gerente e MKT" on public.mind_maps;
create policy "mapas mentais: leitura ADM, Gerente, MKT e Consultor" on public.mind_maps for select
  using (current_role_name() = any (array['ADM'::text, 'Gerente'::text, 'MKT'::text, 'Consultor'::text]));
