-- ============================================================
-- MIGRAÇÃO 024 — permite excluir respostas de formulário (faltava a
-- política de DELETE; leitura e atualização já existiam desde a
-- migração 014/015, seguindo a mesma regra: quem acessa o módulo Leads).
-- ============================================================

create policy "quem acessa leads exclui respostas de formularios"
  on public.form_submissions for delete
  using (public.has_module_access('leads'));
