-- 118 — Contrato (proposta): o endereço do cliente é coletado quadro a quadro, como na matrícula:
-- Rua, Número, Complemento, Bairro, Cidade, Estado e CEP.
--  • save_proposal_data grava os quadros novos e continua montando "endereco" e "cidade_estado" (texto único),
--    então os modelos de contrato antigos ({{cliente.endereco}}, {{cliente.cidade_estado}}) seguem funcionando.
--    Página antiga (só com o texto único) continua sendo aceita.
--  • proposta_campos_faltando exige Rua, Número, Bairro, Cidade, Estado e CEP (Complemento é opcional);
--    contrato antigo que só tem o texto único também vale.
--  • get_proposal devolve o endereço da matrícula separado em quadros.
--  • matricula_from_contract passa Rua, Número, Complemento, Bairro, Cidade, Estado e CEP para a matrícula.

create or replace function public.proposta_campos_faltando(p_dados jsonb)
returns text[]
language sql
immutable
as $function$
  with base as (
    select
      coalesce(btrim(p_dados ->> 'rua'), '') = ''
      and coalesce(btrim(p_dados ->> 'endereco'), '') <> ''
      and coalesce(btrim(p_dados ->> 'cidade_estado'), '') <> '' as legado
  )
  select coalesce(array_agg(k order by ord), '{}')
  from base, unnest(array[
    'nome','cpf','data_chegada','data_nascimento','nacionalidade',
    'rua','numero','bairro','cidade','estado','cep',
    'telefone','email','contato_emergencia_nome','contato_emergencia_telefone'
  ]) with ordinality as t(k, ord)
  where coalesce(btrim(p_dados ->> k), '') = ''
    and not (base.legado and k in ('rua','numero','bairro','cidade','estado'));
$function$;

create or replace function public.save_proposal_data(p_token uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.contracts;
  k text;
  v jsonb := '{}'::jsonb;
  txt text;
  v_prefixo text := 'proposta/' || p_token::text || '/';
begin
  select * into c from public.contracts where public_token = p_token and modo = 'proposta';
  if not found or c.status <> 'Aguardando assinatura' then
    raise exception 'proposta_indisponivel';
  end if;

  foreach k in array array[
    'nome','cpf','documento','passaporte_expedicao','passaporte_validade','data_chegada','data_nascimento','nacionalidade',
    'rua','numero','complemento','bairro','cidade','estado','cep',
    'telefone','email','contato_emergencia_nome','contato_emergencia_telefone'
  ] loop
    txt := left(btrim(coalesce(p_dados ->> k, '')), 300);
    if k = 'email' then txt := lower(txt); end if;
    if k = 'estado' then txt := upper(left(txt, 2)); end if;
    v := v || jsonb_build_object(k, txt);
  end loop;

  /* texto único do endereço (modelos antigos): montado dos quadros; sem quadros, mantém o que a página antiga mandou */
  if coalesce(v ->> 'rua', '') <> '' or coalesce(v ->> 'numero', '') <> '' or coalesce(v ->> 'complemento', '') <> ''
     or coalesce(v ->> 'bairro', '') <> '' or coalesce(v ->> 'cidade', '') <> '' or coalesce(v ->> 'estado', '') <> '' then
    v := v || jsonb_build_object(
      'endereco', concat_ws(', ', nullif(v ->> 'rua', ''), nullif(v ->> 'numero', ''), nullif(v ->> 'complemento', ''), nullif(v ->> 'bairro', '')),
      'cidade_estado', concat_ws(' / ', nullif(v ->> 'cidade', ''), nullif(v ->> 'estado', ''))
    );
  else
    v := v || jsonb_build_object(
      'endereco', left(btrim(coalesce(p_dados ->> 'endereco', '')), 300),
      'cidade_estado', left(btrim(coalesce(p_dados ->> 'cidade_estado', '')), 300)
    );
  end if;

  txt := left(btrim(coalesce(p_dados ->> 'passaporte_path', '')), 300);
  if txt <> '' and left(txt, length(v_prefixo)) = v_prefixo then
    v := v || jsonb_build_object('passaporte_path', txt);
  end if;

  update public.contracts set dados_cliente = v, updated_at = now() where id = c.id;

  update public.contract_verifications set used_at = now() where contract_id = c.id and used_at is null;
end;
$function$;

create or replace function public.get_proposal(p_token uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'status', c.status,
    'numero', c.numero,
    'title', c.title,
    'assinado_em', c.signed_at,
    'dados_cliente', c.dados_cliente,
    'prefill', jsonb_build_object(
      'nome', coalesce(nullif(e.name, ''), l.name, q.client, ''),
      'email', coalesce(nullif(e.email, ''), nullif(l.email, ''), q.email, ''),
      'telefone', coalesce(nullif(e.phone, ''), l.phone, ''),
      'cpf', coalesce(e.cpf, ''),
      'documento', coalesce(e.passport_number, ''),
      'data_nascimento', coalesce(e.birth_date::text, ''),
      'nacionalidade', coalesce(e.nationality, ''),
      'rua', coalesce(e.address_street, ''),
      'numero', coalesce(e.address_number, ''),
      'complemento', coalesce(e.address_complement, ''),
      'bairro', coalesce(e.address_neighborhood, ''),
      'cidade', coalesce(e.address_city, ''),
      'estado', coalesce(e.address_state, ''),
      'cep', coalesce(e.address_zip, ''),
      'contato_emergencia_nome', coalesce(e.emergency_name, ''),
      'contato_emergencia_telefone', coalesce(e.emergency_phone, '')
    ),
    'cotacao', case when q.id is null then null else jsonb_build_object(
      'numero', q.numero, 'client', q.client, 'email', q.email, 'items_detail', q.items_detail,
      'value', q.value, 'emissao', q.emissao, 'validade', q.validade,
      'consultor_name', q.consultor_name, 'consultor_email', q.consultor_email
    ) end,
    'template_html', t.html,
    'snapshot', case when c.status = 'Assinado' then c.dados_snapshot else null end
  )
  from public.contracts c
  left join public.leads l on l.id = c.lead_id
  left join lateral (
    select * from public.enrollments en where en.lead_id = c.lead_id order by en.created_at desc limit 1
  ) e on true
  left join public.quotes q on q.id = c.quote_id
  left join public.contract_templates t on t.id = c.template_id
  where c.public_token = p_token and c.modo = 'proposta';
$function$;

create or replace function public.matricula_from_contract(p_contract_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.contracts;
  d jsonb;
  q public.quotes;
  l public.leads;
  e public.enrollments;
  v_item jsonb;
  v_school text := '';
  v_turno text := '';
  v_rua text;
  v_cidade text;
  v_estado text;
  v_chegada date;
begin
  select * into c from public.contracts where id = p_contract_id;
  if not found or c.modo <> 'proposta' or c.status <> 'Assinado' then
    return null;
  end if;
  d := coalesce(c.dados_cliente, '{}'::jsonb);

  select * into q from public.quotes where id = c.quote_id;
  select * into l from public.leads where id = c.lead_id;

  select it into v_item
  from jsonb_array_elements(coalesce(q.items_detail, '[]'::jsonb)) it
  where coalesce(it ->> 'escola', '') <> ''
  limit 1;
  if v_item is not null then
    v_school := coalesce(v_item ->> 'escola', '');
    v_turno := coalesce(v_item ->> 'turno', '');
  end if;

  /* quadros do endereço; contrato antigo (texto único) cai no comportamento de antes */
  v_rua := coalesce(nullif(d ->> 'rua', ''), d ->> 'endereco', '');
  v_cidade := coalesce(nullif(d ->> 'cidade', ''), btrim(split_part(coalesce(d ->> 'cidade_estado', ''), '/', 1)));
  v_estado := coalesce(nullif(upper(d ->> 'estado'), ''), btrim(split_part(coalesce(d ->> 'cidade_estado', ''), '/', 2)));
  begin
    v_chegada := nullif(d ->> 'data_chegada', '')::date;
  exception when others then
    v_chegada := null;
  end;

  select * into e from public.enrollments
  where id = c.enrollment_id
     or (c.lead_id is not null and lead_id = c.lead_id)
  order by (id = c.enrollment_id) desc nulls last, created_at desc
  limit 1;

  if not found then
    insert into public.enrollments (
      lead_id, consultor_id, name, email, phone, emergency_phone, emergency_name,
      cpf, birth_date, nationality, passport_number, passport_photo_path,
      address_street, address_number, address_complement, address_neighborhood, address_city, address_state, address_zip,
      school, turno, course_value, arrival_date, status, matricula_pendente
    ) values (
      c.lead_id, l.consultor_id,
      coalesce(nullif(d ->> 'nome', ''), l.name, q.client, ''),
      coalesce(nullif(d ->> 'email', ''), l.email, q.email, ''),
      coalesce(nullif(d ->> 'telefone', ''), l.phone, ''),
      coalesce(d ->> 'contato_emergencia_telefone', ''), coalesce(d ->> 'contato_emergencia_nome', ''),
      coalesce(d ->> 'cpf', ''), nullif(d ->> 'data_nascimento', '')::date, coalesce(d ->> 'nacionalidade', ''),
      coalesce(d ->> 'documento', ''), nullif(d ->> 'passaporte_path', ''),
      v_rua, coalesce(d ->> 'numero', ''), coalesce(d ->> 'complemento', ''), coalesce(d ->> 'bairro', ''),
      v_cidade, v_estado, coalesce(d ->> 'cep', ''),
      v_school, v_turno, coalesce(q.value, 0), v_chegada, 'Preenchido pelo aluno', true
    ) returning * into e;
    update public.enrollments set
      passport_issue_date = nullif(d ->> 'passaporte_expedicao', '')::date,
      passport_expiry_date = nullif(d ->> 'passaporte_validade', '')::date
    where id = e.id;
  else
    update public.enrollments set
      name = coalesce(nullif(name, ''), nullif(d ->> 'nome', ''), name),
      email = coalesce(nullif(email, ''), nullif(d ->> 'email', ''), email),
      phone = coalesce(nullif(phone, ''), nullif(d ->> 'telefone', ''), phone),
      emergency_phone = coalesce(nullif(emergency_phone, ''), nullif(d ->> 'contato_emergencia_telefone', ''), emergency_phone),
      emergency_name = coalesce(nullif(emergency_name, ''), nullif(d ->> 'contato_emergencia_nome', ''), emergency_name),
      cpf = coalesce(nullif(cpf, ''), nullif(d ->> 'cpf', ''), cpf),
      birth_date = coalesce(birth_date, nullif(d ->> 'data_nascimento', '')::date),
      nationality = coalesce(nullif(nationality, ''), nullif(d ->> 'nacionalidade', ''), nationality),
      passport_number = coalesce(nullif(passport_number, ''), nullif(d ->> 'documento', ''), passport_number),
      passport_photo_path = coalesce(passport_photo_path, nullif(d ->> 'passaporte_path', '')),
      passport_issue_date = coalesce(passport_issue_date, nullif(d ->> 'passaporte_expedicao', '')::date),
      passport_expiry_date = coalesce(passport_expiry_date, nullif(d ->> 'passaporte_validade', '')::date),
      address_street = coalesce(nullif(address_street, ''), nullif(v_rua, ''), address_street),
      address_number = coalesce(nullif(address_number, ''), nullif(d ->> 'numero', ''), address_number),
      address_complement = coalesce(nullif(address_complement, ''), nullif(d ->> 'complemento', ''), address_complement),
      address_neighborhood = coalesce(nullif(address_neighborhood, ''), nullif(d ->> 'bairro', ''), address_neighborhood),
      address_city = coalesce(nullif(address_city, ''), nullif(v_cidade, ''), address_city),
      address_state = coalesce(nullif(address_state, ''), nullif(v_estado, ''), address_state),
      address_zip = coalesce(nullif(address_zip, ''), nullif(d ->> 'cep', ''), address_zip),
      school = coalesce(nullif(school, ''), nullif(v_school, ''), school),
      turno = coalesce(nullif(turno, ''), nullif(v_turno, ''), turno),
      course_value = case when course_value = 0 then coalesce(q.value, 0) else course_value end,
      arrival_date = coalesce(arrival_date, v_chegada),
      status = case when status = 'Aguardando aluno' then 'Preenchido pelo aluno' else status end,
      matricula_pendente = true,
      updated_at = now()
    where id = e.id
    returning * into e;
  end if;

  update public.contracts set enrollment_id = e.id where id = c.id and enrollment_id is distinct from e.id;
  return e.id;
end;
$function$;
