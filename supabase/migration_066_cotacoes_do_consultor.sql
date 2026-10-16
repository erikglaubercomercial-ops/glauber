-- ============================================================
-- MIGRAÇÃO 066 — Cotações: o Consultor só vê (e mexe nas) cotações dele.
-- "Dele" = consultor responsável pela cotação ou dono do lead da cotação.
-- ADM, Gerente e demais funções com acesso ao módulo seguem vendo todas.
-- As páginas públicas (aprovação, proposta) usam funções próprias e não mudam.
-- ============================================================
create or replace function public.can_access_quote(p_consultor uuid, p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_module_access('cotacao')
    and (
      public.current_role_name() <> 'Consultor'
      or p_consultor = auth.uid()
      or exists (select 1 from public.leads l where l.id = p_lead and l.consultor_id = auth.uid())
    );
$$;
revoke all on function public.can_access_quote(uuid, uuid) from public, anon;
grant execute on function public.can_access_quote(uuid, uuid) to authenticated;

drop policy if exists "cotações conforme módulo" on public.quotes;
create policy "cotações: leitura conforme função e atribuição"
  on public.quotes for select using (public.can_access_quote(consultor_id, lead_id));
create policy "cotações: criação conforme função e atribuição"
  on public.quotes for insert with check (public.can_access_quote(consultor_id, lead_id));
create policy "cotações: edição conforme função e atribuição"
  on public.quotes for update using (public.can_access_quote(consultor_id, lead_id))
  with check (public.can_access_quote(consultor_id, lead_id));
create policy "cotações: exclusão conforme função e atribuição"
  on public.quotes for delete using (public.can_access_quote(consultor_id, lead_id));
