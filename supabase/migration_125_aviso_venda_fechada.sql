-- ============================================================
-- MIGRAÇÃO 125 — Aviso de venda fechada: quando o cliente assina o contrato, o CRM mostra um popup
-- com som de caixa registrador e o nome do consultor. Esta função só informa quem fechou e quando
-- (nenhum valor, nenhum dado do cliente) e é aberta a todo usuário da equipe.
-- p_desde nulo = só devolve a hora do servidor (ponto de partida, sem vendas antigas).
-- ============================================================
create or replace function public.vendas_fechadas_novas(p_desde timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_vendas jsonb := '[]'::jsonb;
begin
  if public.current_role_name() is null then raise exception 'sem_permissao'; end if;
  if p_desde is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'lead_id', x.lead_id, 'signed_at', x.signed_at, 'consultor', x.consultor) order by x.signed_at), '[]'::jsonb)
      into v_vendas
    from (
      select distinct on (c.lead_id) c.id, c.lead_id, c.signed_at,
             coalesce(p.name, p2.name, 'Equipe Peregrinos') as consultor
        from public.contracts c
        join public.leads l on l.id = c.lead_id
        left join public.profiles p on p.id = l.consultor_id
        left join public.deals d on d.lead_id = l.id
        left join public.profiles p2 on p2.id = d.consultor_id
       where c.status = 'Assinado' and c.signed_at > p_desde
       order by c.lead_id, c.signed_at
    ) x;
  end if;
  return jsonb_build_object('agora', now(), 'vendas', v_vendas);
end;
$$;
revoke all on function public.vendas_fechadas_novas(timestamptz) from public, anon;
grant execute on function public.vendas_fechadas_novas(timestamptz) to authenticated;
