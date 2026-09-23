-- ============================================================
-- MIGRAÇÃO 015 — Respostas de formulário deixam de virar lead
-- automaticamente no envio. Agora ficam pendentes de revisão na
-- tela "Respostas" (uma por formulário), onde alguém da equipe
-- decide se/quando transformar a resposta em lead, já podendo
-- escolher um consultor na hora.
-- ============================================================

-- envio público simplificado: só grava a resposta bruta.
create or replace function public.submit_form_public(p_slug text, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form_id uuid;
begin
  select id into v_form_id from public.forms where slug = p_slug and active = true;
  if v_form_id is null then
    raise exception 'Formulário não encontrado.';
  end if;

  insert into public.form_submissions (form_id, answers)
  values (v_form_id, p_answers);
end;
$$;

grant execute on function public.submit_form_public(text, jsonb) to anon;

-- quem acessa o módulo de leads pode marcar uma resposta como
-- "transformada em lead" (grava o lead_id depois de criar o lead
-- normalmente, pela mesma regra de quem pode criar leads).
create policy "quem acessa leads atualiza respostas de formularios"
  on public.form_submissions for update
  using (public.has_module_access('leads'))
  with check (public.has_module_access('leads'));
