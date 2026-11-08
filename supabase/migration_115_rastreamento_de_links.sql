-- ============================================================
-- MIGRAÇÃO 115 — Rastreamento de links: quem se cadastra por um link de anúncio já entra com a origem do anúncio.
-- O link leva parâmetros (ex.: ?origem=meta). A função do banco só aceita as origens "Anúncio Meta" e "Anúncio Google",
-- a partir destes parâmetros (qualquer outro texto é ignorado):
--   origem=meta|facebook|instagram|fb|ig  ou  utm_source=facebook|fb|instagram|ig|meta   → Anúncio Meta
--   origem=google|googleads               ou  gclid=<qualquer valor>                       → Anúncio Google
-- Também são guardados (cortados em 150 caracteres): utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid.
-- • Formulários: form_submissions.tracking; a origem vem pré-escolhida ao transformar a resposta em lead.
-- • Agendamento online: o lead novo nasce com a origem do anúncio (lead que já existe NÃO tem a origem trocada).
-- ============================================================
create or replace function public.tracking_origin(p jsonb)
returns text
language sql
immutable
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then null
    when lower(btrim(coalesce(p ->> 'origem', ''))) in ('meta', 'facebook', 'instagram', 'fb', 'ig') then 'Anúncio Meta'
    when lower(btrim(coalesce(p ->> 'origem', ''))) in ('google', 'googleads') then 'Anúncio Google'
    when lower(btrim(coalesce(p ->> 'utm_source', ''))) in ('facebook', 'fb', 'instagram', 'ig', 'meta') then 'Anúncio Meta'
    when btrim(coalesce(p ->> 'gclid', '')) <> '' then 'Anúncio Google'
    else null
  end;
$$;

create or replace function public.clean_tracking(p jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_origem text := public.tracking_origin(p);
  r jsonb;
  k text;
begin
  if v_origem is null then return null; end if;
  r := jsonb_build_object('origem', v_origem);
  foreach k in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'] loop
    if jsonb_typeof(p -> k) = 'string' and btrim(p ->> k) <> '' then
      r := r || jsonb_build_object(k, left(btrim(p ->> k), 150));
    end if;
  end loop;
  return r;
end;
$$;

-- linha de observação do lead: "📣 Veio de anúncio Meta · campanha: X · anúncio: Y"
create or replace function public.tracking_note(p jsonb)
returns text
language sql
immutable
as $$
  select case when p is null then '' else
    E'\n📣 Veio de ' || lower(substr(p ->> 'origem', 1, 1)) || substr(p ->> 'origem', 2)
    || coalesce(' · campanha: ' || nullif(p ->> 'utm_campaign', ''), '')
    || coalesce(' · anúncio: ' || nullif(p ->> 'utm_content', ''), '')
    || '.'
  end;
$$;

alter table public.form_submissions add column if not exists tracking jsonb;

drop function if exists public.submit_form_public(text, jsonb);
create function public.submit_form_public(p_slug text, p_answers jsonb, p_tracking jsonb default null)
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

  insert into public.form_submissions (form_id, answers, tracking)
  values (v_form_id, p_answers, public.clean_tracking(p_tracking));
end;
$$;

-- agendamento online: a função existente é recriada a partir da própria definição, só com a origem do anúncio acrescentada
do $mig$
declare
  src text;
  n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'booking_create' and pg_get_function_arguments(p.oid) not like '%p_tracking%';
  if src is null then return; end if;   -- já aplicada

  src := replace(src, 'p_lead uuid DEFAULT NULL::uuid)', 'p_lead uuid DEFAULT NULL::uuid, p_tracking jsonb DEFAULT NULL::jsonb)');
  n := (length(src) - length(replace(src, E'  v_future integer;\n', ''))) / length(E'  v_future integer;\n');
  if n <> 1 then raise exception 'booking_create: bloco de variáveis não encontrado'; end if;
  src := replace(src, E'  v_future integer;\n', E'  v_future integer;\n  v_source text := coalesce(public.tracking_origin(p_tracking), ''Agendamento online'');\n  v_note text := ''📅 Lead criado pelo agendamento online.'' || public.tracking_note(public.clean_tracking(p_tracking));\n');
  n := (length(src) - length(replace(src, '''('' || v_ddd || '') '' || v_num, ''Agendamento online'', ''Outro''', ''))) / length('''('' || v_ddd || '') '' || v_num, ''Agendamento online'', ''Outro''');
  if n <> 1 then raise exception 'booking_create: insert do lead não encontrado'; end if;
  src := replace(src, '''('' || v_ddd || '') '' || v_num, ''Agendamento online'', ''Outro''', '''('' || v_ddd || '') '' || v_num, v_source, ''Outro''');
  n := (length(src) - length(replace(src, '''📅 Lead criado pelo agendamento online.'')', ''))) / length('''📅 Lead criado pelo agendamento online.'')');
  if n <> 1 then raise exception 'booking_create: observação do lead não encontrada'; end if;
  src := replace(src, '''📅 Lead criado pelo agendamento online.'')', 'v_note)');

  drop function public.booking_create(text, timestamptz, text, text, text, text, uuid);
  execute src;
  revoke all on function public.booking_create(text, timestamptz, text, text, text, text, uuid, jsonb) from public;
  grant execute on function public.booking_create(text, timestamptz, text, text, text, text, uuid, jsonb) to anon, authenticated, service_role;
end
$mig$;
