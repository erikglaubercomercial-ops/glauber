-- ============================================================
-- MIGRAÇÃO 040 — data de chegada na Irlanda na etapa "Seus dados" do link
-- do contrato (guardada em dados_cliente.data_chegada; obrigatória para assinar).
-- Só substitui duas funções; não altera dados existentes.
-- ============================================================

create or replace function public.save_proposal_data(p_token uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    'endereco','cidade_estado','cep','telefone','email','contato_emergencia_nome','contato_emergencia_telefone'
  ] loop
    txt := left(btrim(coalesce(p_dados ->> k, '')), 300);
    if k = 'email' then txt := lower(txt); end if;
    v := v || jsonb_build_object(k, txt);
  end loop;

  -- passaporte: só aceita caminho dentro da pasta desta própria proposta
  txt := left(btrim(coalesce(p_dados ->> 'passaporte_path', '')), 300);
  if txt <> '' and left(txt, length(v_prefixo)) = v_prefixo then
    v := v || jsonb_build_object('passaporte_path', txt);
  end if;

  update public.contracts set dados_cliente = v, updated_at = now() where id = c.id;

  -- mudou o e-mail ou algum dado: os códigos já enviados deixam de valer
  update public.contract_verifications set used_at = now() where contract_id = c.id and used_at is null;
end;
$$;

grant execute on function public.save_proposal_data(uuid, jsonb) to anon;

create or replace function public.proposta_campos_faltando(p_dados jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(k order by ord), '{}')
  from unnest(array[
    'nome','cpf','documento','passaporte_expedicao','passaporte_validade','data_chegada','data_nascimento','nacionalidade',
    'endereco','cidade_estado','cep','telefone','email','contato_emergencia_nome','contato_emergencia_telefone'
  ]) with ordinality as t(k, ord)
  where coalesce(btrim(p_dados ->> k), '') = '';
$$;

