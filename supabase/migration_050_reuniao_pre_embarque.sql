-- ============================================================
-- MIGRAÇÃO 050 — agendar a reunião de pré-embarque pela ficha do cliente.
-- A regra de edição de matrículas olha enrollments.consultor_id; a ficha deve
-- funcionar para quem enxerga o lead. Esta função confere o acesso ao lead/
-- matrícula (can_see_enrollment) e só altera a data da reunião.
-- ============================================================

create or replace function public.set_pre_embark(p_enrollment uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_see_enrollment(p_enrollment) then
    raise exception 'sem_acesso';
  end if;
  update public.enrollments set pre_embark_at = p_at, updated_at = now() where id = p_enrollment;
end;
$$;
revoke all on function public.set_pre_embark(uuid, timestamptz) from public, anon;
grant execute on function public.set_pre_embark(uuid, timestamptz) to authenticated;
