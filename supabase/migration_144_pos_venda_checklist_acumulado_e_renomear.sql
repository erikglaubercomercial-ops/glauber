-- ============================================================
-- MIGRAÇÃO 144 — Pós-venda: checklist acumulado e itens renomeáveis
-- 1) pv_marcar_item passa a aceitar itens da etapa atual E de etapas anteriores (o card mantém o checklist das etapas
--    por onde já passou). O aluno só avança sozinho quando o item marcado é da etapa atual e ela fica completa.
-- 2) pv_item_renomear: troca o texto de um item sem perder as marcações já feitas (o id do item não muda).
-- ============================================================
create or replace function public.pv_marcar_item(p_enrollment uuid, p_item uuid, p_feito boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_etapa uuid;
  v_ordem_atual integer;
  v_item_etapa uuid;
  v_total integer;
  v_feitos integer;
  v_prox uuid;
begin
  if not public.pv_pode_editar() then raise exception 'sem_permissao'; end if;
  select etapa_id into v_etapa from public.posvenda_alunos where enrollment_id = p_enrollment;
  if v_etapa is null then raise exception 'aluno_nao_encontrado'; end if;
  select ordem into v_ordem_atual from public.posvenda_etapas where id = v_etapa;
  select i.etapa_id into v_item_etapa
    from public.posvenda_itens i join public.posvenda_etapas e on e.id = i.etapa_id
   where i.id = p_item and e.ordem <= v_ordem_atual;
  if v_item_etapa is null then raise exception 'item_de_outra_etapa'; end if;
  if p_feito then
    insert into public.posvenda_progresso (enrollment_id, item_id, feito_por) values (p_enrollment, p_item, auth.uid())
      on conflict (enrollment_id, item_id) do nothing;
  else
    delete from public.posvenda_progresso where enrollment_id = p_enrollment and item_id = p_item;
  end if;

  -- avanço automático: só quando o item é da etapa atual e todos os itens dela estão feitos
  if v_item_etapa = v_etapa then
    select count(*) into v_total from public.posvenda_itens where etapa_id = v_etapa;
    select count(*) into v_feitos from public.posvenda_progresso p
      join public.posvenda_itens i on i.id = p.item_id
     where p.enrollment_id = p_enrollment and i.etapa_id = v_etapa;
    if v_total > 0 and v_feitos >= v_total then
      select id into v_prox from public.posvenda_etapas where ordem > v_ordem_atual order by ordem limit 1;
      if v_prox is not null then
        update public.posvenda_alunos set etapa_id = v_prox, etapa_em = now() where enrollment_id = p_enrollment;
      end if;
    end if;
  end if;
end;
$$;

create or replace function public.pv_item_renomear(p_item uuid, p_texto text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.pv_pode_editar() then raise exception 'sem_permissao'; end if;
  if trim(coalesce(p_texto, '')) = '' then raise exception 'nome_obrigatorio'; end if;
  update public.posvenda_itens set texto = left(trim(p_texto), 300) where id = p_item;
  if not found then raise exception 'item_nao_encontrado'; end if;
end;
$$;

revoke all on function public.pv_item_renomear(uuid, text) from public, anon;
grant execute on function public.pv_item_renomear(uuid, text) to authenticated;
