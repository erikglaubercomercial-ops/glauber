-- ============================================================
-- MIGRAÇÃO 141 — comprovante do envio para a escola.
-- O financeiro anexa o comprovante (imagem ou PDF) em cada envio.
-- Arquivo fica num bucket PRIVADO separado (o aluno não tem acesso),
-- só quem tem o módulo Financeiro envia, vê, troca e apaga.
-- ============================================================

alter table public.school_transfers
  add column if not exists file_path text,
  add column if not exists file_name text;

insert into storage.buckets (id, name, public)
values ('school-transfer-proofs', 'school-transfer-proofs', false)
on conflict (id) do nothing;

drop policy if exists "envio-escola: financeiro envia comprovante" on storage.objects;
create policy "envio-escola: financeiro envia comprovante" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'school-transfer-proofs' and public.has_module_access('financeiro'));

drop policy if exists "envio-escola: financeiro lê comprovante" on storage.objects;
create policy "envio-escola: financeiro lê comprovante" on storage.objects
  for select to authenticated
  using (bucket_id = 'school-transfer-proofs' and public.has_module_access('financeiro'));

drop policy if exists "envio-escola: financeiro apaga comprovante" on storage.objects;
create policy "envio-escola: financeiro apaga comprovante" on storage.objects
  for delete to authenticated
  using (bucket_id = 'school-transfer-proofs' and public.has_module_access('financeiro'));
