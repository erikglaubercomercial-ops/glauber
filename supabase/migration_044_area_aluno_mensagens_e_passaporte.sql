-- ============================================================
-- MIGRAÇÃO 044 — Área do Aluno com dados reais.
--
-- 1) Mensagens aluno <-> equipe (tabela aluno_mensagens): o aluno vê e envia
--    mensagens só da própria matrícula; quem tem o módulo Matrículas vê todas,
--    responde e marca como lidas.
-- 2) O aluno pode abrir (somente leitura) o arquivo do PRÓPRIO passaporte no
--    bucket privado passport-photos. Não ganha acesso aos de outros alunos.
-- Só cria tabela/políticas novas; não altera dados existentes.
-- ============================================================

create table public.aluno_mensagens (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  autor text not null check (autor in ('aluno', 'equipe')),
  autor_nome text not null default '',
  texto text not null check (length(btrim(texto)) between 1 and 2000),
  lida boolean not null default false,
  created_at timestamptz not null default now()
);
create index aluno_mensagens_enrollment_idx on public.aluno_mensagens(enrollment_id, created_at);

alter table public.aluno_mensagens enable row level security;

create policy "aluno_mensagens: equipe lê"
  on public.aluno_mensagens for select
  using (public.has_module_access('matriculas'));
create policy "aluno_mensagens: equipe responde"
  on public.aluno_mensagens for insert
  with check (public.has_module_access('matriculas') and autor = 'equipe');
create policy "aluno_mensagens: equipe marca como lida"
  on public.aluno_mensagens for update
  using (public.has_module_access('matriculas'))
  with check (public.has_module_access('matriculas'));
create policy "aluno_mensagens: equipe exclui"
  on public.aluno_mensagens for delete
  using (public.has_module_access('matriculas'));

create policy "aluno_mensagens: aluno lê as suas"
  on public.aluno_mensagens for select
  using (exists (select 1 from public.enrollments e where e.id = aluno_mensagens.enrollment_id and e.student_user_id = auth.uid()));
create policy "aluno_mensagens: aluno envia nas suas"
  on public.aluno_mensagens for insert
  with check (autor = 'aluno' and exists (select 1 from public.enrollments e where e.id = aluno_mensagens.enrollment_id and e.student_user_id = auth.uid()));

-- aluno abre o próprio passaporte
create policy "passport-photos: aluno lê o próprio passaporte"
  on storage.objects for select to authenticated
  using (bucket_id = 'passport-photos'
         and exists (select 1 from public.enrollments e where e.student_user_id = auth.uid() and e.passport_photo_path = storage.objects.name));
