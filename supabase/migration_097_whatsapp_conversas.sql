-- ============================================================
-- MIGRAÇÃO 097 — WhatsApp no CRM (etapa 1): caixa de entrada compartilhada de UM número da empresa.
-- • Mensagens chegam pela função de borda whatsapp-webhook (API oficial da Meta) e ficam em wa_conversations / wa_messages.
-- • Conversa de número que já é lead: vai para o consultor dono do lead. Número novo: cai numa FILA (sem consultor) e NÃO vira lead
--   sozinho — o rodízio automático de leads continuaria dando o lead a alguém. O Gerente escolhe o consultor (wa_assign), e aí o lead é criado.
-- • Cada consultor vê só as conversas dos próprios leads / atribuídas a ele; ADM e Gerente veem todas.
-- • Escritas só por funções (o navegador não grava direto). Entrada de mensagens só pelo service_role (webhook).
-- • wa_settings.assign_mode já prevê o rodízio futuro ('fila' hoje; 'rodizio' ainda não é aplicado).
-- ============================================================

create table public.wa_settings (
  id integer primary key default 1 check (id = 1),
  assign_mode text not null default 'fila' check (assign_mode in ('fila', 'rodizio')),
  updated_at timestamptz not null default now()
);
insert into public.wa_settings (id) values (1);
alter table public.wa_settings enable row level security;
create policy "wa_settings: equipe lê" on public.wa_settings for select to authenticated using (public.current_role_name() is not null);
create policy "wa_settings: ADM altera" on public.wa_settings for update to authenticated
  using (public.current_role_name() = 'ADM') with check (public.current_role_name() = 'ADM');

create table public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^[0-9]{6,15}$'),
  contact_name text not null default '',
  lead_id uuid references public.leads(id) on delete set null,
  consultor_id uuid references public.profiles(id) on delete set null,
  is_test boolean not null default false,
  unread boolean not null default false,
  preview text not null default '',
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  created_at timestamptz not null default now()
);
create index wa_conversations_lead_idx on public.wa_conversations (lead_id);
create index wa_conversations_consultor_idx on public.wa_conversations (consultor_id, last_message_at desc);
alter table public.wa_conversations enable row level security;

create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  direction text not null check (direction in ('in', 'out', 'note')),
  body text not null default '',
  msg_type text not null default 'text',
  wa_message_id text unique,
  status text not null default 'received',
  sent_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index wa_messages_conv_idx on public.wa_messages (conversation_id, created_at);
alter table public.wa_messages enable row level security;

-- quem pode ver a conversa: ADM e Gerente (todas) ou o Consultor dono do lead / da conversa
create or replace function public.wa_can_see(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.wa_conversations c
    where c.id = p_conv
      and (public.current_role_name() in ('ADM', 'Gerente')
           or (public.current_role_name() = 'Consultor'
               and (c.consultor_id = auth.uid()
                    or exists (select 1 from public.leads l where l.id = c.lead_id and l.consultor_id = auth.uid())))));
$$;
revoke all on function public.wa_can_see(uuid) from public, anon;
grant execute on function public.wa_can_see(uuid) to authenticated;

create policy "wa_conversations: quem pode ver" on public.wa_conversations for select to authenticated using (public.wa_can_see(id));
create policy "wa_messages: quem pode ver" on public.wa_messages for select to authenticated using (public.wa_can_see(conversation_id));

-- acha o lead que tem esse telefone (mesma chave do CRM: lead_phone_key); aceita Brasil com e sem o 9 extra
create or replace function public.wa_match_lead(p_phone text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_keys text[] := '{}';
  v_ddd text; v_num text; v_id uuid;
begin
  if p_phone like '55%' and length(p_phone) in (12, 13) then
    v_ddd := substr(p_phone, 3, 2); v_num := substr(p_phone, 5);
    v_keys := array['BR:' || v_ddd || v_num];
    if length(v_num) = 9 and v_num like '9%' then v_keys := v_keys || ('BR:' || v_ddd || substr(v_num, 2));
    elsif length(v_num) = 8 then v_keys := v_keys || ('BR:' || v_ddd || '9' || v_num); end if;
  end if;
  select l.id into v_id from public.leads l
   where (cardinality(v_keys) > 0 and public.lead_phone_key(l.country_code, l.phone_ddd, l.phone_number, l.phone) = any (v_keys))
      or (regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') = p_phone)
      or (l.country_code <> 'BR' and length(p_phone) >= 8 and right(regexp_replace(coalesce(l.phone_ddd, '') || coalesce(l.phone_number, ''), '\D', '', 'g'), 8) = right(p_phone, 8))
   order by l.created_at limit 1;
  return v_id;
end;
$$;
revoke all on function public.wa_match_lead(text) from public, anon, authenticated;

-- entrada de mensagem (só service_role: o webhook). Idempotente pelo id da mensagem no WhatsApp.
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

  -- ainda sem lead (ou sem dono): tenta de novo; o lead existente define o consultor da conversa (nunca em teste)
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

  insert into public.wa_messages (conversation_id, direction, body, msg_type, wa_message_id, status, created_at)
  values (c.id, 'in', v_body, v_type, v_wa, 'received', v_ts);
  return jsonb_build_object('ok', true, 'conversation_id', c.id, 'queue', c.consultor_id is null);
end;
$$;
revoke all on function public.wa_ingest_message(jsonb) from public, anon, authenticated;
grant execute on function public.wa_ingest_message(jsonb) to service_role;

-- atualização de entrega das mensagens enviadas (etapa 2): enviada / entregue / lida / falhou
create or replace function public.wa_ingest_status(p_wa_message_id text, p_status text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.wa_messages set status = p_status
  where wa_message_id = p_wa_message_id and direction = 'out' and p_status in ('sent', 'delivered', 'read', 'failed');
$$;
revoke all on function public.wa_ingest_status(text, text) from public, anon, authenticated;
grant execute on function public.wa_ingest_status(text, text) to service_role;

-- o Gerente (ou ADM) passa a conversa da fila para um consultor; se o número ainda não é lead, o lead é criado já com esse consultor
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
begin
  if public.current_role_name() not in ('ADM', 'Gerente') then raise exception 'sem_permissao'; end if;
  select * into c from public.wa_conversations where id = p_conv for update;
  if not found then raise exception 'conversa_nao_encontrada'; end if;
  if not exists (select 1 from public.profiles where id = p_consultor and active and role in ('Consultor', 'Gerente', 'ADM')) then raise exception 'consultor_invalido'; end if;

  if c.lead_id is not null then
    -- conversa de lead existente segue o dono do lead (a troca de dono é feita no lead)
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

  insert into public.lead_sources (name, ordem) values ('WhatsApp', (select coalesce(max(ordem), 0) + 1 from public.lead_sources))
  on conflict (name) do nothing;
  begin
    insert into public.leads (name, phone, country_code, phone_ddd, phone_number, category, source, status, consultor_id, notes)
    values (coalesce(nullif(c.contact_name, ''), 'WhatsApp +' || c.phone), v_phone, v_country, v_ddd, v_num, 'Outro', 'WhatsApp', 'Novo', p_consultor,
            '💬 Lead criado a partir de uma conversa no WhatsApp da empresa.')
    returning id into v_lead;
  exception when unique_violation then
    v_lead := public.wa_match_lead(c.phone);
    if v_lead is null then raise; end if;
  end;
  update public.wa_conversations set lead_id = v_lead, consultor_id = p_consultor where id = c.id;
  return v_lead;
end;
$$;
revoke all on function public.wa_assign(uuid, uuid) from public, anon;
grant execute on function public.wa_assign(uuid, uuid) to authenticated;

create or replace function public.wa_mark_read(p_conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.wa_can_see(p_conv) then raise exception 'sem_acesso'; end if;
  update public.wa_conversations set unread = false where id = p_conv and unread;
end;
$$;
revoke all on function public.wa_mark_read(uuid) from public, anon;
grant execute on function public.wa_mark_read(uuid) to authenticated;

-- nota interna: só o time vê, o cliente nunca recebe
create or replace function public.wa_add_note(p_conv uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.wa_can_see(p_conv) then raise exception 'sem_acesso'; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'nota_vazia'; end if;
  insert into public.wa_messages (conversation_id, direction, body, msg_type, status, sent_by)
  values (p_conv, 'note', left(btrim(p_body), 2000), 'note', 'note', auth.uid());
end;
$$;
revoke all on function public.wa_add_note(uuid, text) from public, anon;
grant execute on function public.wa_add_note(uuid, text) to authenticated;

-- teste (só ADM): simula uma mensagem recebida SEM tocar em leads reais e sem criar lead; wa_delete_tests apaga tudo isso
create or replace function public.wa_simulate_inbound(p_phone text, p_name text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_phone text := '9' || right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') || '0000000000', 10);
begin
  if public.current_role_name() is distinct from 'ADM' then raise exception 'sem_permissao'; end if;
  return public.wa_ingest_message(jsonb_build_object('phone', v_phone, 'name', coalesce(p_name, ''), 'body', coalesce(p_body, ''), 'is_test', true));
end;
$$;
revoke all on function public.wa_simulate_inbound(text, text, text) from public, anon;
grant execute on function public.wa_simulate_inbound(text, text, text) to authenticated;

create or replace function public.wa_delete_tests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if public.current_role_name() is distinct from 'ADM' then raise exception 'sem_permissao'; end if;
  delete from public.wa_conversations where is_test;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.wa_delete_tests() from public, anon;
grant execute on function public.wa_delete_tests() to authenticated;
