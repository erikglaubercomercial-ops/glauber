-- ============================================================
-- MIGRAÇÃO 143 — Pós-venda: botão "+ Novo card" (adicionar uma matrícula ao quadro à mão)
-- Hoje o aluno só entra quando a primeira parcela é paga. Estas duas funções deixam ADM, Gerente e Suporte
-- colocar no quadro uma matrícula que ainda não está nele (por exemplo, pagamento feito fora do CRM).
-- Só cria funções novas; não altera dados nem funções existentes.
-- ============================================================

-- matrículas que ainda não têm card no quadro
create or replace function public.pv_alunos_disponiveis()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.pv_pode_editar() then raise exception 'sem_permissao'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'enrollment_id', en.id, 'name', en.name, 'school', en.school, 'turno', en.turno,
             'arrival_date', en.arrival_date) order by en.name)
      from public.enrollments en
     where not exists (select 1 from public.posvenda_alunos pa where pa.enrollment_id = en.id)
  ), '[]'::jsonb);
end;
$$;

-- cria o card; sem etapa informada, entra na primeira etapa do quadro
create or replace function public.pv_adicionar_aluno(p_enrollment uuid, p_etapa uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_etapa uuid := p_etapa;
begin
  if not public.pv_pode_editar() then raise exception 'sem_permissao'; end if;
  if not exists (select 1 from public.enrollments where id = p_enrollment) then raise exception 'matricula_nao_encontrada'; end if;
  if exists (select 1 from public.posvenda_alunos where enrollment_id = p_enrollment) then raise exception 'aluno_ja_no_quadro'; end if;
  if v_etapa is null then
    select id into v_etapa from public.posvenda_etapas order by ordem limit 1;
  end if;
  if v_etapa is null or not exists (select 1 from public.posvenda_etapas where id = v_etapa) then raise exception 'etapa_nao_encontrada'; end if;
  insert into public.posvenda_alunos (enrollment_id, etapa_id) values (p_enrollment, v_etapa);
end;
$$;

revoke all on function public.pv_alunos_disponiveis() from public, anon;
revoke all on function public.pv_adicionar_aluno(uuid, uuid) from public, anon;
grant execute on function public.pv_alunos_disponiveis() to authenticated;
grant execute on function public.pv_adicionar_aluno(uuid, uuid) to authenticated;
