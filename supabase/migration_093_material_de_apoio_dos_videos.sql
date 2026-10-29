-- ============================================================
-- MIGRAÇÃO 093 — Material de apoio para baixar embaixo de cada vídeo da Área do Aluno (1 arquivo por vídeo).
--  • arquivos num armazenamento PRIVADO (bucket aluno-materiais, até 50 MB por arquivo)
--  • só o ADM envia, troca e apaga; só aluno MATRICULADO baixa (por link temporário, sem endereço público)
-- ============================================================
alter table public.aluno_videos
  add column if not exists material_path text,
  add column if not exists material_name text,
  add column if not exists material_size bigint;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aluno-materiais', 'aluno-materiais', false, 52428800, array[
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed',
  'image/png', 'image/jpeg', 'image/webp', 'text/plain'
])
on conflict (id) do nothing;

create policy "aluno-materiais: ADM gerencia"
  on storage.objects for all
  using (bucket_id = 'aluno-materiais' and public.current_role_name() = 'ADM')
  with check (bucket_id = 'aluno-materiais' and public.current_role_name() = 'ADM');

create policy "aluno-materiais: aluno matriculado baixa"
  on storage.objects for select
  using (bucket_id = 'aluno-materiais' and public.is_enrolled_student());
