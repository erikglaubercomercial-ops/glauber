-- ============================================================
-- MIGRAÇÃO 045 — o aluno deixa de ler a tabela enrollments diretamente.
--
-- A política criada na migração 019 ("aluno vê a própria matrícula") liberava
-- TODAS as colunas da linha dele, inclusive a comissão da escola. Agora o
-- aluno só recebe, pela função aluno_matricula(), os campos que a Área do
-- Aluno realmente usa (nome, escola, turno, datas e arquivo do passaporte).
-- As políticas que dependiam dessa leitura (mensagens e passaporte) passam a
-- usar funções de apoio security definer.
-- Não altera nenhum dado; a equipe continua com as políticas dela.
-- ============================================================

-- ids das matrículas do aluno logado (security definer: não depende de ele ler enrollments)
create or replace function public.aluno_enrollment_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.enrollments where student_user_id = auth.uid();
$$;
revoke all on function public.aluno_enrollment_ids() from public, anon;
grant execute on function public.aluno_enrollment_ids() to authenticated;

-- caminho do arquivo do passaporte do aluno logado
create or replace function public.aluno_passport_paths()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select passport_photo_path from public.enrollments
  where student_user_id = auth.uid() and passport_photo_path is not null;
$$;
revoke all on function public.aluno_passport_paths() from public, anon;
grant execute on function public.aluno_passport_paths() to authenticated;

-- só os campos que a Área do Aluno usa
create or replace function public.aluno_matricula()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'school', e.school, 'turno', e.turno,
    'arrival_date', e.arrival_date, 'class_start_date', e.class_start_date,
    'passport_photo_path', e.passport_photo_path
  )
  from public.enrollments e
  where e.student_user_id = auth.uid()
  order by e.created_at desc
  limit 1;
$$;
revoke all on function public.aluno_matricula() from public, anon;
grant execute on function public.aluno_matricula() to authenticated;

-- políticas que liam enrollments como o próprio aluno
drop policy "aluno_mensagens: aluno lê as suas" on public.aluno_mensagens;
create policy "aluno_mensagens: aluno lê as suas"
  on public.aluno_mensagens for select
  using (enrollment_id in (select public.aluno_enrollment_ids()));

drop policy "aluno_mensagens: aluno envia nas suas" on public.aluno_mensagens;
create policy "aluno_mensagens: aluno envia nas suas"
  on public.aluno_mensagens for insert
  with check (autor = 'aluno' and enrollment_id in (select public.aluno_enrollment_ids()));

drop policy "passport-photos: aluno lê o próprio passaporte" on storage.objects;
create policy "passport-photos: aluno lê o próprio passaporte"
  on storage.objects for select to authenticated
  using (bucket_id = 'passport-photos' and name in (select public.aluno_passport_paths()));

-- por fim, fecha a leitura direta
drop policy "matriculas: aluno vê a própria matrícula" on public.enrollments;
