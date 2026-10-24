-- ============================================================
-- MIGRAÇÃO 081 — bot de Direct do Instagram (com IA) gera lead no CRM.
--
-- • ig_conversations: estado de cada conversa do Direct (mensagens, dados
--   coletados pela IA, handoff, mids já processados). Só o servidor do bot
--   acessa, com a service_role: RLS ligada e SEM policies.
-- • instagram_registrar_lead(p jsonb): cria ou atualiza o lead a partir da
--   conversa. Não reimplementa nada: insere em leads SEM consultor e deixa os
--   gatilhos que já existem trabalharem (rodízio 057, card do Pipeline 056,
--   histórico 048, bloqueio de telefone 033 e de e-mail 005).
--   É idempotente: o bot chama de novo a cada dado novo.
--   Lead que já existe mantém consultor e origem; só os campos vazios são
--   preenchidos e o bloco do Instagram nas notas é regravado (sem duplicar).
-- • Origem: usa a origem do Instagram que já existir em lead_sources (nunca
--   uma origem paga, migração 054); se não houver, cria "Instagram Direct".
-- Não altera nenhum dado existente.
-- Rode este arquivo no Supabase: SQL Editor → New query → Run
-- ============================================================

create table if not exists public.ig_conversations (
  ig_user_id text primary key,
  ig_username text,
  lead_id uuid references public.leads(id) on delete set null,
  messages jsonb not null default '[]'::jsonb,
  lead_data jsonb not null default '{}'::jsonb,
  handoff boolean not null default false,
  handoff_reason text not null default '',
  processed_mids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ig_conversations enable row level security;
revoke all on table public.ig_conversations from anon, authenticated;
grant all on table public.ig_conversations to service_role;

create or replace function public.instagram_registrar_lead(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ig_id text := btrim(coalesce(p->>'ig_user_id', ''));
  v_user text := ltrim(btrim(coalesce(p->>'ig_username', '')), '@');
  v_name text := left(btrim(coalesce(p->>'name', '')), 120);
  v_country text := upper(coalesce(nullif(btrim(p->>'country_code'), ''), 'BR'));
  v_digits text := regexp_replace(coalesce(p->>'phone_ddd', '') || coalesce(p->>'phone_number', ''), '\D', '', 'g');
  v_dddlen integer;
  v_ddd text := '';
  v_num text := '';
  v_phone text := '';
  v_key text;
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_vir text := left(btrim(coalesce(p->>'pretende_vir', '')), 60);
  v_temp text := nullif(btrim(coalesce(p->>'temperature', '')), '');
  v_resumo text := left(btrim(coalesce(p->>'notes', '')), 1500);
  v_handoff boolean := coalesce(p->>'handoff', '') = 'true';
  v_source text;
  v_lead public.leads;
  v_do_bot boolean := false;   -- lead criado por esta conversa (pode atualizar temperatura/pretende_vir)
  v_criado boolean := false;
  v_tel_recusado boolean := false;
  v_bloco text;
begin
  if v_ig_id = '' then raise exception 'ig_user_id_obrigatorio'; end if;
  if v_country !~ '^[A-Z]{2}$' then v_country := 'BR'; end if;
  if v_temp is not null and v_temp not in ('Quente', 'Morno', 'Frio') then v_temp := null; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then v_email := ''; end if;

  -- telefone no mesmo formato da tela de Leads (script.js): DDD com 2 dígitos
  -- (3 em EUA/Canadá), o resto é o número, phone = "(DDD) número"
  if v_country = 'BR' and v_digits like '55%' and length(v_digits) in (12, 13) then v_digits := substr(v_digits, 3); end if;
  v_dddlen := case when v_country in ('US', 'CA') then 3 else 2 end;
  if length(v_digits) >= v_dddlen + 6 and length(v_digits) <= 15 then
    v_ddd := substr(v_digits, 1, v_dddlen);
    v_num := substr(v_digits, v_dddlen + 1);
    v_phone := '(' || v_ddd || ') ' || v_num;
  end if;
  v_key := public.lead_phone_key(v_country, v_ddd, v_num, v_phone);

  -- 1) lead já ligado a esta conversa  2) telefone (mesma chave da migração 033)  3) e-mail (mesma regra da 005)
  select l.* into v_lead from public.ig_conversations c join public.leads l on l.id = c.lead_id where c.ig_user_id = v_ig_id;
  v_do_bot := v_lead.id is not null and v_lead.source ilike '%instagram%';
  if v_lead.id is null and v_key is not null then
    select * into v_lead from public.leads
    where public.lead_phone_key(country_code, phone_ddd, phone_number, phone) = v_key
    order by created_at limit 1;
  end if;
  if v_lead.id is null and v_email <> '' then
    select * into v_lead from public.leads where lower(btrim(email)) = v_email order by created_at limit 1;
  end if;

  if v_lead.id is null then
    -- origem: a do Instagram que já existe (não paga); senão cria "Instagram Direct"
    select name into v_source from public.lead_sources
    where name ilike '%instagram%' and not coalesce(is_paid, false)
    order by (name = 'Instagram Direct') desc, (name = 'Instagram') desc, ordem
    limit 1;
    if v_source is null then
      insert into public.lead_sources (name, ordem)
      values ('Instagram Direct', (select coalesce(max(ordem), 0) + 1 from public.lead_sources))
      on conflict (name) do nothing;
      v_source := 'Instagram Direct';
    end if;

    v_bloco := '📷 Instagram Direct' || case when v_user <> '' then ' (@' || v_user || ')' else '' end || E':\n'
      || coalesce(nullif(v_resumo, ''), 'Conversa iniciada pelo Direct.')
      || case when v_phone = '' and v_email = '' and v_user <> '' then E'\nContato apenas pelo Instagram: @' || v_user else '' end
      || E'\n— fim Instagram —';

    begin
      -- consultor_id NULL de propósito: o gatilho do rodízio (057) atribui
      insert into public.leads (name, email, country_code, phone_ddd, phone_number, phone,
                                source, category, status, temperature, consultor_id, notes, pretende_vir)
      values (coalesce(nullif(v_name, ''), nullif('@' || v_user, '@'), 'Sem nome'), v_email, v_country, v_ddd, v_num, v_phone,
              v_source, 'Intercâmbio de Idiomas', 'Novo', v_temp, null, v_bloco, v_vir)
      returning * into v_lead;
      v_criado := true;
      v_do_bot := true;
    exception when unique_violation then
      -- outro cadastro chegou antes com o mesmo telefone/e-mail: usa o lead existente
      select * into v_lead from public.leads
      where (v_key is not null and public.lead_phone_key(country_code, phone_ddd, phone_number, phone) = v_key)
         or (v_email <> '' and lower(btrim(email)) = v_email)
      order by created_at limit 1;
      if v_lead.id is null then raise; end if;
    end;
  end if;

  if not v_criado then
    -- telefone e e-mail: só se estiverem vazios; se já forem de outro lead, os gatilhos barram e seguimos sem eles
    if coalesce(v_lead.phone_number, '') = '' and v_num <> '' then
      begin
        update public.leads set country_code = v_country, phone_ddd = v_ddd, phone_number = v_num, phone = v_phone
        where id = v_lead.id;
      exception when unique_violation then
        v_tel_recusado := true;
      end;
    end if;
    if coalesce(v_lead.email, '') = '' and v_email <> '' then
      begin
        update public.leads set email = v_email where id = v_lead.id;
      exception when unique_violation then
        null;
      end;
    end if;
    select * into v_lead from public.leads where id = v_lead.id;

    v_bloco := '📷 Instagram Direct' || case when v_user <> '' then ' (@' || v_user || ')' else '' end || E':\n'
      || coalesce(nullif(v_resumo, ''), 'Conversa iniciada pelo Direct.')
      || case when v_tel_recusado then E'\nWhatsApp informado no Direct (já usado em outro lead): (' || v_ddd || ') ' || v_num else '' end
      || case when coalesce(v_lead.phone_number, '') = '' and coalesce(v_lead.email, '') = '' and v_user <> ''
              then E'\nContato apenas pelo Instagram: @' || v_user else '' end
      || E'\n— fim Instagram —';

    -- consultor e origem nunca mudam aqui
    update public.leads set
      name = case when btrim(coalesce(name, '')) in ('', 'Sem nome') or name = '@' || v_user
                  then coalesce(nullif(v_name, ''), name) else name end,
      pretende_vir = case when v_do_bot or coalesce(pretende_vir, '') = '' then coalesce(nullif(v_vir, ''), pretende_vir) else pretende_vir end,
      temperature = case when v_do_bot then coalesce(v_temp, temperature) else coalesce(temperature, v_temp) end,
      notes = case
        when coalesce(notes, '') ~ '📷 Instagram Direct.*?— fim Instagram —'
          then regexp_replace(notes, '📷 Instagram Direct.*?— fim Instagram —', replace(v_bloco, '\', '\\'))
        else btrim(coalesce(notes, '') || E'\n\n' || v_bloco)
      end
    where id = v_lead.id;
  end if;

  insert into public.ig_conversations (ig_user_id, ig_username, lead_id, updated_at)
  values (v_ig_id, nullif(v_user, ''), v_lead.id, now())
  on conflict (ig_user_id) do update
    set lead_id = excluded.lead_id,
        ig_username = coalesce(excluded.ig_username, public.ig_conversations.ig_username),
        updated_at = now();

  if v_handoff then
    perform public.log_lead_event(v_lead.id, 'instagram_handoff', 'Conversa do Instagram passada ao consultor',
      'all', now(), 'ig_conversations', v_lead.id);
  end if;

  -- relê: o rodízio (gatilho after insert) já pode ter definido o consultor
  select * into v_lead from public.leads where id = v_lead.id;
  return jsonb_build_object(
    'lead_id', v_lead.id,
    'consultor_id', v_lead.consultor_id,
    'consultor_nome', (select name from public.profiles where id = v_lead.consultor_id),
    'criado', v_criado
  );
end;
$$;

revoke all on function public.instagram_registrar_lead(jsonb) from public, anon, authenticated;
grant execute on function public.instagram_registrar_lead(jsonb) to service_role;
