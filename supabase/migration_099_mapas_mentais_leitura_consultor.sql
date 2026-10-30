-- ============================================================
-- MIGRAÇÃO 099 — Mapa Mental para o Consultor.
-- • LER: todos os mapas (ADM, Gerente, MKT e Consultor).
-- • CRIAR: o Consultor cria mapas próprios (created_by = ele) — inclusive cópia de um mapa existente.
-- • EDITAR: o Consultor só edita os mapas que ele mesmo criou; nunca os de outra pessoa. ADM, Gerente e MKT seguem editando todos.
-- • EXCLUIR: sem mudança (ADM ou quem criou).
-- ============================================================
drop policy if exists "mapas mentais: leitura ADM, Gerente e MKT" on public.mind_maps;
drop policy if exists "mapas mentais: leitura ADM, Gerente, MKT e Consultor" on public.mind_maps;
create policy "mapas mentais: leitura ADM, Gerente, MKT e Consultor" on public.mind_maps for select
  using (current_role_name() = any (array['ADM'::text, 'Gerente'::text, 'MKT'::text, 'Consultor'::text]));

drop policy if exists "mapas mentais: criação ADM, Gerente e MKT" on public.mind_maps;
create policy "mapas mentais: criação (Consultor só em nome próprio)" on public.mind_maps for insert
  with check (current_role_name() = any (array['ADM'::text, 'Gerente'::text, 'MKT'::text])
              or (current_role_name() = 'Consultor' and created_by = auth.uid()));

drop policy if exists "mapas mentais: edição ADM, Gerente e MKT" on public.mind_maps;
create policy "mapas mentais: edição (Consultor só os próprios)" on public.mind_maps for update
  using (current_role_name() = any (array['ADM'::text, 'Gerente'::text, 'MKT'::text])
         or (current_role_name() = 'Consultor' and created_by = auth.uid()))
  with check (current_role_name() = any (array['ADM'::text, 'Gerente'::text, 'MKT'::text])
              or (current_role_name() = 'Consultor' and created_by = auth.uid()));
