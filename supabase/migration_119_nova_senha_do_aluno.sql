-- ============================================================
-- MIGRAÇÃO 119 — Ficha do cliente: botão "Criar nova senha" no Portal do aluno.
-- Define uma senha nova para o login do aluno (a pedido de ADM, Gerente ou do consultor dono do lead).
-- A senha é gerada na tela e só aparece para quem pediu; no banco fica apenas o hash.
-- A senha antiga deixa de valer e as sessões abertas do aluno são encerradas.
-- ============================================================
create or replace function public.set_student_password(p_enrollment uuid, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  e public.enrollments;
  v_role text := public.current_role_name();
  v_email text;
begin
  if v_role is null or v_role not in ('ADM', 'Gerente', 'Consultor') then
    raise exception 'sem_permissao';
  end if;
  select * into e from public.enrollments where id = p_enrollment;
  if not found then raise exception 'matricula_nao_encontrada'; end if;
  if v_role = 'Consultor'
     and not (e.consultor_id = auth.uid() or (e.lead_id is not null and public.can_see_lead(e.lead_id))) then
    raise exception 'sem_permissao';
  end if;
  if e.student_user_id is null then raise exception 'aluno_sem_acesso'; end if;
  if p_password is null or length(p_password) < 8 or length(p_password) > 72 then raise exception 'senha_invalida'; end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = e.student_user_id
   returning email into v_email;
  if v_email is null then raise exception 'login_nao_encontrado'; end if;

  delete from auth.sessions where user_id = e.student_user_id;
  return v_email;
end;
$$;
revoke all on function public.set_student_password(uuid, text) from public, anon;
grant execute on function public.set_student_password(uuid, text) to authenticated;
