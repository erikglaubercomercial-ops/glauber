-- ============================================================
-- MIGRAÇÃO 101 — WhatsApp: anúncio de origem (Click-to-WhatsApp) e origens "Anúncio Meta" / "Anúncio Google".
-- • Quando o cliente chega por um anúncio, a Meta manda junto o id do anúncio (source_id) e o código do clique (ctwa_clid).
--   Isso é gravado em lead_ad_clicks, ligado à conversa e ao lead (mesmo que o lead só seja criado depois).
-- • Lead NOVO criado a partir da conversa nasce com a origem "Anúncio Meta" quando veio de anúncio (senão "WhatsApp").
--   Lead que JÁ existe não tem a origem alterada: só ganha o registro do anúncio (e a conversa entra nele, sem criar outro lead).
-- • Origens novas na lista: "Anúncio Meta" e "Anúncio Google" (pagas). A origem antiga "Anúncio" fica para os leads que já a têm.
-- ============================================================

insert into public.lead_sources (name, ordem, is_paid)
select 'Anúncio Meta', coalesce(max(ordem), 0) + 1, true from public.lead_sources
on conflict (name) do nothing;
insert into public.lead_sources (name, ordem, is_paid)
select 'Anúncio Google', coalesce(max(ordem), 0) + 1, true from public.lead_sources
on conflict (name) do nothing;

create table public.lead_ad_clicks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.wa_conversations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  platform text not null default 'meta' check (platform in ('meta', 'google')),
  ad_id text,
  click_id text,
  source_type text,
  source_url text,
  headline text,
  created_at timestamptz not null default now()
);
create unique index lead_ad_clicks_click_uq on public.lead_ad_clicks (platform, click_id) where click_id is not null;
create index lead_ad_clicks_lead_idx on public.lead_ad_clicks (lead_id);
create index lead_ad_clicks_conv_idx on public.lead_ad_clicks (conversation_id);
alter table public.lead_ad_clicks enable row level security;
-- vê quem pode ver a conversa (ADM/Gerente: todas; Consultor: as dos próprios leads)
create policy "lead_ad_clicks: quem vê a conversa" on public.lead_ad_clicks for select to authenticated
  using (conversation_id is not null and public.wa_can_see(conversation_id));

create or replace function public.wa_ingest_message(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_wa text := nullif(p ->> 'wa_message_id', '');
  v_body text := left(coalesce(p ->> 'body', ''), 4000);
  v_type text := left(coalesce(nullif(p ->> 'type', ''), 'text'), 30);
  v_name text := left(btrim(coalesce(p ->> 'name', '')), 120);
  v_ts timestamptz := coalesce(nullif(p ->> 'ts', '')::timestamptz, now());
  v_test boolean := coalesce((p ->> 'is_test')::boolean, false);
  v_ref jsonb := case when jsonb_typeof(p -> 'referral') = 'object' then p -> 'referral' else null end;
  v_click text := left(nullif(v_ref ->> 'ctwa_clid', ''), 400);
  v_adid text := left(nullif(v_ref ->> 'source_id', ''), 100);
  c public.wa_conversations;
  v_lead uuid; v_owner uuid;
begin
  if v_phone !~ '^[0-9]{6,15}$' then raise exception 'telefone_invalido'; end if;
  if v_wa is not null and exists (select 1 from public.wa_messages where wa_message_id = v_wa) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select * into c from public.wa_conversations where phone = v_phone;
  if not found then
    insert into public.wa_conversations (phone, contact_name, is_test) values (v_phone, v_name, v_test) returning * into c;
  end if;

  if not c.is_test then
    if c.lead_id is null then
      v_lead := public.wa_match_lead(v_phone);
      if v_lead is not null then c.lead_id := v_lead; end if;
    end if;
    if c.lead_id is not null then
      select consultor_id into v_owner from public.leads where id = c.lead_id;
      c.consultor_id := coalesce(v_owner, c.consultor_id);
    end if;
  end if;

  update public.wa_conversations
     set lead_id = c.lead_id, consultor_id = c.consultor_id,
         contact_name = case when contact_name = '' then v_name else contact_name end,
         unread = true, last_message_at = v_ts, last_inbound_at = v_ts,
         preview = left(case when v_body = '' then '[' || v_type || ']' else v_body end, 140)
   where id = c.id;

  -- anúncio de origem (Click-to-WhatsApp): guarda o id do anúncio e o código do clique
  if v_click is not null or v_adid is not null then
    insert into public.lead_ad_clicks (conversation_id, lead_id, platform, ad_id, click_id, source_type, source_url, headline)
    values (c.id, c.lead_id, 'meta', v_adid, v_click, left(v_ref ->> 'source_type', 20), left(v_ref ->> 'source_url', 500), left(v_ref ->> 'headline', 200))
    on conflict do nothing;
  end if;
  if c.lead_id is not null then
    update public.lead_ad_clicks set lead_id = c.lead_id where conversation_id = c.id and lead_id is null;
  end if;

  insert into public.wa_messages (conversation_id, direction, body, msg_type, wa_message_id, status, created_at)
  values (c.id, 'in', v_body, v_type, v_wa, 'received', v_ts);
  return jsonb_build_object('ok', true, 'conversation_id', c.id, 'queue', c.consultor_id is null, 'ad', (v_click is not null or v_adid is not null));
end;
$$;
revoke all on function public.wa_ingest_message(jsonb) from public, anon, authenticated;
grant execute on function public.wa_ingest_message(jsonb) to service_role;

-- atribuição pelo Gerente: lead novo nasce com a origem certa (Anúncio Meta quando a conversa veio de anúncio)
create or replace function public.wa_assign(p_conv uuid, p_consultor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.wa_conversations;
  v_lead uuid;
  v_digits text;
  v_country text := 'BR'; v_ddd text := ''; v_num text; v_phone text;
  v_ad public.lead_ad_clicks;
  v_source text := 'WhatsApp';
  v_notes text := E'💬 Lead criado a partir de uma conversa no WhatsApp da empresa.';
begin
  if public.current_role_name() not in ('ADM', 'Gerente') then raise exception 'sem_permissao'; end if;
  select * into c from public.wa_conversations where id = p_conv for update;
  if not found then raise exception 'conversa_nao_encontrada'; end if;
  if not exists (select 1 from public.profiles where id = p_consultor and active and role in ('Consultor', 'Gerente', 'ADM')) then raise exception 'consultor_invalido'; end if;

  if c.lead_id is not null then
    raise exception 'conversa_de_lead_existente';
  end if;
  if c.is_test then
    update public.wa_conversations set consultor_id = p_consultor where id = c.id;
    return null;
  end if;

  v_digits := c.phone;
  if v_digits like '55%' and length(v_digits) in (12, 13) then
    v_ddd := substr(v_digits, 3, 2); v_num := substr(v_digits, 5); v_phone := '(' || v_ddd || ') ' || v_num;
  else
    v_country := case
      when v_digits like '353%' then 'IE' when v_digits like '351%' then 'PT' when v_digits like '34%' then 'ES'
      when v_digits like '44%' then 'GB' when v_digits like '33%' then 'FR' when v_digits like '49%' then 'DE'
      when v_digits like '39%' then 'IT' when v_digits like '1%' then 'US' else 'BR' end;
    v_num := v_digits; v_phone := '+' || v_digits;
  end if;

  select * into v_ad from public.lead_ad_clicks where conversation_id = c.id order by created_at desc limit 1;
  if found then
    v_source := case v_ad.platform when 'google' then 'Anúncio Google' else 'Anúncio Meta' end;
    v_notes := v_notes || E'\n📣 Veio de anúncio' || coalesce(': ' || nullif(v_ad.headline, ''), '') || coalesce(' (ID ' || nullif(v_ad.ad_id, '') || ')', '') || '.';
  end if;

  insert into public.lead_sources (name, ordem) values (v_source, (select coalesce(max(ordem), 0) + 1 from public.lead_sources))
  on conflict (name) do nothing;
  begin
    insert into public.leads (name, phone, country_code, phone_ddd, phone_number, category, source, status, consultor_id, notes)
    values (coalesce(nullif(c.contact_name, ''), 'WhatsApp +' || c.phone), v_phone, v_country, v_ddd, v_num, 'Outro', v_source, 'Novo', p_consultor, v_notes)
    returning id into v_lead;
  exception when unique_violation then
    v_lead := public.wa_match_lead(c.phone);
    if v_lead is null then raise; end if;
  end;
  update public.wa_conversations set lead_id = v_lead, consultor_id = p_consultor where id = c.id;
  update public.lead_ad_clicks set lead_id = v_lead where conversation_id = c.id and lead_id is null;
  return v_lead;
end;
$$;
revoke all on function public.wa_assign(uuid, uuid) from public, anon;
grant execute on function public.wa_assign(uuid, uuid) to authenticated;
