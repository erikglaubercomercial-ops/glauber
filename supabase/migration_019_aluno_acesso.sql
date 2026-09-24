-- ============================================================
-- MIGRAÇÃO 019 — Acesso automático do aluno à Área do Aluno: ao
-- salvar uma matrícula com e-mail (e que ainda não tenha login),
-- o CRM cria um login real (Supabase Auth) para o aluno, com a
-- senha gerada mostrada uma única vez pro consultor repassar.
-- O aluno não ganha nenhum acesso ao CRM em si — mesmo "safe
-- default" de sempre: sem linha em profiles, has_module_access()
-- continua retornando false pra todos os módulos.
-- ============================================================

-- ---------- vincula a matrícula ao login do aluno ----------
alter table public.enrollments
  add column if not exists student_user_id uuid references auth.users(id) on delete set null;

-- ---------- aluno vê a própria matrícula, com o login real ----------
create policy "matriculas: aluno vê a própria matrícula"
  on public.enrollments for select
  using (student_user_id = auth.uid());

-- ============================================================
-- Login novo criado como aluno (raw_user_meta_data->>'app_role' =
-- 'aluno') não vira membro da equipe: sem linha em profiles, e o
-- e-mail já nasce confirmado (o acesso já vem liberado com a senha
-- que o consultor passar, sem precisar clicar em link de e-mail).
-- Logins de equipe (criados pelo Supabase Dashboard) continuam
-- exatamente como antes.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  if new.raw_user_meta_data->>'app_role' = 'aluno' then
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
    where id = new.id;
    return new;
  end if;

  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'Consultor'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
