-- ============================================================
-- MIGRAÇÃO 017 — Pipeline: Consultor só vê os próprios negócios.
-- Até aqui, qualquer um com acesso ao módulo Pipeline via a mesma
-- política ("pipeline: leitura conforme módulo") enxergava TODOS os
-- negócios, sem checar o Consultor dono do lead — diferente de como
-- já funciona em Leads. Esta migração alinha o Pipeline com a regra
-- que Leads já segue.
--
-- Negócio ligado a um lead (lead_id) usa o consultor do lead (join).
-- Negócio avulso (criado direto no Pipeline, sem lead) usa a nova
-- coluna deals.consultor_id, preenchida com quem criou.
-- ============================================================

alter table public.deals add column if not exists consultor_id uuid references public.profiles(id) on delete set null;

drop policy if exists "pipeline: leitura conforme módulo" on public.deals;
create policy "pipeline: leitura conforme função e atribuição"
  on public.deals for select
  using (
    public.has_module_access('pipeline')
    and (
      public.current_role_name() <> 'Consultor'
      or consultor_id = auth.uid()
      or exists (select 1 from public.leads l where l.id = deals.lead_id and l.consultor_id = auth.uid())
    )
  );

drop policy if exists "pipeline: edição conforme módulo" on public.deals;
create policy "pipeline: edição conforme função e atribuição"
  on public.deals for update
  using (
    public.has_module_access('pipeline')
    and (
      public.current_role_name() <> 'Consultor'
      or consultor_id = auth.uid()
      or exists (select 1 from public.leads l where l.id = deals.lead_id and l.consultor_id = auth.uid())
    )
  )
  with check (
    public.has_module_access('pipeline')
    and (
      public.current_role_name() <> 'Consultor'
      or consultor_id = auth.uid()
      or exists (select 1 from public.leads l where l.id = deals.lead_id and l.consultor_id = auth.uid())
    )
  );

drop policy if exists "pipeline: exclusão conforme módulo" on public.deals;
create policy "pipeline: exclusão conforme função e atribuição"
  on public.deals for delete
  using (
    public.has_module_access('pipeline')
    and (
      public.current_role_name() <> 'Consultor'
      or consultor_id = auth.uid()
      or exists (select 1 from public.leads l where l.id = deals.lead_id and l.consultor_id = auth.uid())
    )
  );
