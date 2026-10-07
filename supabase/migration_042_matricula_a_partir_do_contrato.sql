-- ============================================================
-- MIGRAÇÃO 042 — a lógica "contrato assinado => matrícula" vira uma função
-- reutilizável (matricula_from_contract) e é aplicada ao contrato do Matheus
-- Govaski (2026-0005), assinado antes do gatilho da 041 existir.
-- Só completa campos VAZIOS da matrícula e a marca como "não realizada".
-- ============================================================

create or replace function public.matricula_from_contract(p_contract_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contracts;
  d jsonb;
  q public.quotes;
  l public.leads;
  e public.enrollments;
  v_item jsonb;
  v_school text := '';
  v_turno text := '';
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

  -- escola/turno: primeiro item da cotação que tem escola
  select it into v_item
  from jsonb_array_elements(coalesce(q.items_detail, '[]'::jsonb)) it
  where coalesce(it ->> 'escola', '') <> ''
  limit 1;
  if v_item is not null then
    v_school := coalesce(v_item ->> 'escola', '');
    v_turno := coalesce(v_item ->> 'turno', '');
  end if;

  v_cidade := btrim(split_part(coalesce(d ->> 'cidade_estado', ''), '/', 1));
  v_estado := btrim(split_part(coalesce(d ->> 'cidade_estado', ''), '/', 2));
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
      address_street, address_city, address_state, address_zip,
      school, turno, course_value, arrival_date, status, matricula_pendente
    ) values (
      c.lead_id, l.consultor_id,
      coalesce(nullif(d ->> 'nome', ''), l.name, q.client, ''),
      coalesce(nullif(d ->> 'email', ''), l.email, q.email, ''),
      coalesce(nullif(d ->> 'telefone', ''), l.phone, ''),
      coalesce(d ->> 'contato_emergencia_telefone', ''), coalesce(d ->> 'contato_emergencia_nome', ''),
      coalesce(d ->> 'cpf', ''), nullif(d ->> 'data_nascimento', '')::date, coalesce(d ->> 'nacionalidade', ''),
      coalesce(d ->> 'documento', ''), nullif(d ->> 'passaporte_path', ''),
      coalesce(d ->> 'endereco', ''), v_cidade, v_estado, coalesce(d ->> 'cep', ''),
      v_school, v_turno, coalesce(q.value, 0), v_chegada, 'Preenchido pelo aluno', true
    ) returning * into e;
    update public.enrollments set
      passport_issue_date = nullif(d ->> 'passaporte_expedicao', '')::date,
      passport_expiry_date = nullif(d ->> 'passaporte_validade', '')::date
    where id = e.id;
  else
    -- matrícula já existia: completa só o que está vazio e marca como pendente
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
      address_street = coalesce(nullif(address_street, ''), nullif(d ->> 'endereco', ''), address_street),
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
$$;

revoke all on function public.matricula_from_contract(uuid) from public, anon, authenticated;

create or replace function public.contracts_cria_matricula()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.modo = 'proposta' and new.status = 'Assinado' and old.status is distinct from 'Assinado' then
    perform public.matricula_from_contract(new.id);
  end if;
  return new;
end;
$$;

-- contrato já assinado do Matheus Govaski (os outros dois assinados são de teste)
select public.matricula_from_contract(id) from public.contracts where numero = '2026-0005' and modo = 'proposta' and status = 'Assinado';
