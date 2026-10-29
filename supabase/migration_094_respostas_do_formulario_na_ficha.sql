-- ============================================================
-- MIGRAÇÃO 094 — Ficha do lead: respostas do formulário.
-- lead_form_answers(lead) devolve, para quem pode ver o lead (mesma regra da ficha: can_see_lead), cada resposta de formulário
-- ligada a ele, na ordem das perguntas e só com as que foram respondidas (rótulo, tipo, valor e, no telefone, o país).
-- ============================================================
create or replace function public.lead_form_answers(p_lead uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_see_lead(p_lead) then raise exception 'sem_acesso'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'when', s.created_at, 'form', f.title,
      'answers', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'label', t.fld ->> 'label', 'type', t.fld ->> 'type',
                 'value', s.answers ->> (t.fld ->> 'id'),
                 'country', s.answers ->> ((t.fld ->> 'id') || '__pais')) order by t.ord), '[]'::jsonb)
        from jsonb_array_elements(f.fields) with ordinality as t(fld, ord)
        where coalesce(btrim(s.answers ->> (t.fld ->> 'id')), '') <> ''))
      order by s.created_at desc)
    from public.form_submissions s
    join public.forms f on f.id = s.form_id
    where s.lead_id = p_lead), '[]'::jsonb);
end;
$$;
revoke all on function public.lead_form_answers(uuid) from public, anon;
grant execute on function public.lead_form_answers(uuid) to authenticated;
