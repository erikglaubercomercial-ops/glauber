-- ============================================================
-- MIGRAÇÃO 092 — Vídeos (YouTube) na Área do Aluno. Os mesmos para todos os alunos.
--  • só o ADM cadastra, edita e apaga
--  • só aluno MATRICULADO (login ligado a uma matrícula) lê, e só os vídeos ativos
--  • guarda apenas o código do vídeo do YouTube; o link é reconhecido na tela
-- ============================================================
create table public.aluno_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  youtube_id text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.aluno_videos enable row level security;

-- o aluno não lê a tabela de matrículas direto (migração 045): a checagem vai por esta função
create or replace function public.is_enrolled_student()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.enrollments e where e.student_user_id = auth.uid());
$$;
grant execute on function public.is_enrolled_student() to authenticated;

create policy "aluno_videos: ADM gerencia"
  on public.aluno_videos for all
  using (public.current_role_name() = 'ADM')
  with check (public.current_role_name() = 'ADM');

create policy "aluno_videos: aluno matriculado vê os ativos"
  on public.aluno_videos for select
  using (ativo and public.is_enrolled_student());
