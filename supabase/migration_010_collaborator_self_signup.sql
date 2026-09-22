-- ============================================================
-- MIGRAÇÃO 010 — Colaboradores: um único link público fixo (sem
-- token por pessoa) onde qualquer novo colaborador se cadastra do
-- zero. Antes exigia que o ADM criasse um rascunho e gerasse um
-- link único por pessoa; agora é um único formulário, o próprio
-- colaborador preenche tudo e o cadastro entra direto no banco.
-- ============================================================

create or replace function public.create_collaborator_public(p_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.collaborators (
    id, name, personal_email, birth_date, cpf, rg, marital_status, nationality,
    personal_phone, emergency_name, emergency_relationship, emergency_phone,
    address_street, address_number, address_complement, address_neighborhood,
    address_city, address_state, address_zip,
    id_document_path, address_proof_path, photo_path, resume_path, work_card_path,
    status
  ) values (
    p_id,
    coalesce(p_data->>'name', ''),
    coalesce(p_data->>'personal_email', ''),
    (p_data->>'birth_date')::date,
    coalesce(p_data->>'cpf', ''),
    coalesce(p_data->>'rg', ''),
    coalesce(p_data->>'marital_status', ''),
    coalesce(p_data->>'nationality', ''),
    coalesce(p_data->>'personal_phone', ''),
    coalesce(p_data->>'emergency_name', ''),
    coalesce(p_data->>'emergency_relationship', ''),
    coalesce(p_data->>'emergency_phone', ''),
    coalesce(p_data->>'address_street', ''),
    coalesce(p_data->>'address_number', ''),
    coalesce(p_data->>'address_complement', ''),
    coalesce(p_data->>'address_neighborhood', ''),
    coalesce(p_data->>'address_city', ''),
    coalesce(p_data->>'address_state', ''),
    coalesce(p_data->>'address_zip', ''),
    p_data->>'id_document_path',
    p_data->>'address_proof_path',
    p_data->>'photo_path',
    p_data->>'resume_path',
    p_data->>'work_card_path',
    'Preenchido pelo colaborador'
  );
end;
$$;

grant execute on function public.create_collaborator_public(uuid, jsonb) to anon;
