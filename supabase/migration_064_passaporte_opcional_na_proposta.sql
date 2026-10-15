-- ============================================================
-- MIGRAÇÃO 064 — Passaporte (número, expedição e validade) deixa de ser obrigatório
-- para o cliente assinar a proposta/contrato. Os campos continuam na tela e, se o
-- cliente preencher, entram no contrato e na matrícula como antes.
-- ============================================================
create or replace function public.proposta_campos_faltando(p_dados jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(k order by ord), '{}')
  from unnest(array[
    'nome','cpf','data_chegada','data_nascimento','nacionalidade',
    'endereco','cidade_estado','cep','telefone','email','contato_emergencia_nome','contato_emergencia_telefone'
  ]) with ordinality as t(k, ord)
  where coalesce(btrim(p_dados ->> k), '') = '';
$$;
