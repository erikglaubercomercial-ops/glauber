-- ============================================================
-- MIGRAÇÃO 138 — Pipeline de pós-venda (separada da pipeline de vendas)
-- • Etapas e itens configuráveis (criar, editar, excluir). Seed com as 8 etapas aprovadas.
-- • Aluno entra na pipeline quando a primeira parcela (matrícula) do negócio é paga.
-- • Quem vê: ADM, Gerente, Suporte e Sócio. Quem altera: ADM, Gerente e Suporte (Sócio só consulta).
-- • Nenhum item é automático: todos são marcados pela equipe.
-- ============================================================

create table if not exists public.posvenda_etapas (
  id uuid primary key default gen_random_uuid(),
  ordem integer not null,
  nome text not null,
  responsavel text not null default 'a definir',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.posvenda_itens (
  id uuid primary key default gen_random_uuid(),
  etapa_id uuid not null references public.posvenda_etapas(id) on delete cascade,
  ordem integer not null,
  texto text not null,
  created_at timestamptz not null default now()
);
create index if not exists posvenda_itens_etapa_idx on public.posvenda_itens (etapa_id, ordem);

create table if not exists public.posvenda_alunos (
  enrollment_id uuid primary key references public.enrollments(id) on delete cascade,
  etapa_id uuid not null references public.posvenda_etapas(id),
  entrou_em timestamptz not null default now(),
  etapa_em timestamptz not null default now()
);
create index if not exists posvenda_alunos_etapa_idx on public.posvenda_alunos (etapa_id);

create table if not exists public.posvenda_progresso (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  item_id uuid not null references public.posvenda_itens(id) on delete cascade,
  feito_em timestamptz not null default now(),
  feito_por uuid references public.profiles(id) on delete set null,
  primary key (enrollment_id, item_id)
);

-- ---------- permissões ----------
create or replace function public.pv_pode_ver()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_role_name() in ('ADM', 'Gerente', 'Suporte') or public.is_socio();
$$;

-- a edição segue a função principal (Sócio como segunda função não tira nem dá edição)
create or replace function public.pv_pode_editar()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_role_name() in ('ADM', 'Gerente', 'Suporte');
$$;

alter table public.posvenda_etapas enable row level security;
alter table public.posvenda_itens enable row level security;
alter table public.posvenda_alunos enable row level security;
alter table public.posvenda_progresso enable row level security;

drop policy if exists posvenda_etapas_select on public.posvenda_etapas;
create policy posvenda_etapas_select on public.posvenda_etapas for select to authenticated using (public.pv_pode_ver());
drop policy if exists posvenda_itens_select on public.posvenda_itens;
create policy posvenda_itens_select on public.posvenda_itens for select to authenticated using (public.pv_pode_ver());
drop policy if exists posvenda_alunos_select on public.posvenda_alunos;
create policy posvenda_alunos_select on public.posvenda_alunos for select to authenticated using (public.pv_pode_ver());
drop policy if exists posvenda_progresso_select on public.posvenda_progresso;
create policy posvenda_progresso_select on public.posvenda_progresso for select to authenticated using (public.pv_pode_ver());
-- escrita só pelas funções abaixo (sem políticas de insert/update/delete nas tabelas)

-- ---------- leitura do quadro ----------
create or replace function public.pv_listar()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_etapas jsonb; v_alunos jsonb;
begin
  if not public.pv_pode_ver() then raise exception 'sem_permissao'; end if;
  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_etapas from (
    select e.ordem as ord, jsonb_build_object(
      'id', e.id, 'ordem', e.ordem, 'nome', e.nome, 'responsavel', e.responsavel,
      'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'ordem', i.ordem, 'texto', i.texto) order by i.ordem)
                           from public.posvenda_itens i where i.etapa_id = e.id), '[]'::jsonb)) as x
      from public.posvenda_etapas e
  ) s;
  select coalesce(jsonb_agg(y order by y->>'name'), '[]'::jsonb) into v_alunos from (
    select jsonb_build_object(
      'enrollment_id', en.id, 'name', en.name, 'school', en.school, 'turno', en.turno,
      'arrival_date', en.arrival_date, 'arrival_time', en.arrival_time,
      'passport_expiry_date', en.passport_expiry_date, 'pre_embark_at', en.pre_embark_at,
      'etapa_id', pa.etapa_id, 'etapa_em', pa.etapa_em,
      'feitos', coalesce((select jsonb_agg(p.item_id) from public.posvenda_progresso p where p.enrollment_id = en.id), '[]'::jsonb)) as y
      from public.posvenda_alunos pa
      join public.enrollments en on en.id = pa.enrollment_id
  ) t;
  return jsonb_build_object('etapas', v_etapas, 'alunos', v_alunos);
end;
$$;

-- ---------- etapas e itens ----------
-- p_itens: [{"id": "uuid opcional", "texto": "..."}]; itens sem id são criados; os que saem da lista são removidos
create or replace function public.pv_etapa_salvar(p_id uuid, p_nome text, p_responsavel text, p_itens jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_ordem integer;
  it jsonb;
  v_n integer := 0;
begin
  if not public.pv_pode_editar() then raise exception 'sem_permissao'; end if;
  if trim(coalesce(p_nome, '')) = '' then raise exception 'nome_obrigatorio'; end if;
  if p_id is null then
    select coalesce(max(ordem), 0) + 10 into v_ordem from public.posvenda_etapas;
    insert into public.posvenda_etapas (id, ordem, nome, responsavel)
      values (v_id, v_ordem, left(trim(p_nome), 120), left(coalesce(nullif(trim(p_responsavel), ''), 'a definir'), 120));
  else
    update public.posvenda_etapas
       set nome = left(trim(p_nome), 120),
           responsavel = left(coalesce(nullif(trim(p_responsavel), ''), 'a definir'), 120),
           updated_at = now()
     where id = v_id;
    if not found then raise exception 'etapa_nao_encontrada'; end if;
  end if;
  delete from public.posvenda_itens
   where etapa_id = v_id
     and id not in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x where x->>'id' is not null);
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    if trim(coalesce(it->>'texto', '')) = '' then continue; end if;
    v_n := v_n + 1;
    if it->>'id' is not null and exists (select 1 from public.posvenda_itens where id = (it->>'id')::uuid and etapa_id = v_id) then
      update public.posvenda_itens set texto = left(trim(it->>'texto'), 300), ordem = v_n * 10 where id = (it->>'id')::uuid;
    else
      insert into public.posvenda_itens (etapa_id, ordem, texto) values (v_id, v_n * 10, left(trim(it->>'texto'), 300));
    end if;
  end loop;
  return v_id;
end;
$$;

-- excluir etapa: se tiver alunos, precisa informar para qual etapa eles vão
create or replace function public.pv_etapa_excluir(p_id uuid, p_mover_para uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_qtd integer;
begin
  if not public.pv_pode_editar() then raise exception 'sem_permissao'; end if;
  if p_mover_para = p_id then raise exception 'destino_invalido'; end if;
  select count(*) into v_qtd from public.posvenda_alunos where etapa_id = p_id;
  if v_qtd > 0 then
    if p_mover_para is null or not exists (select 1 from public.posvenda_etapas where id = p_mover_para) then
      raise exception 'etapa_com_alunos';
    end if;
    update public.posvenda_alunos set etapa_id = p_mover_para, etapa_em = now() where etapa_id = p_id;
  end if;
  delete from public.posvenda_etapas where id = p_id;
end;
$$;

-- ---------- alunos ----------
create or replace function public.pv_mover_aluno(p_enrollment uuid, p_etapa uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.pv_pode_editar() then raise exception 'sem_permissao'; end if;
  if not exists (select 1 from public.posvenda_etapas where id = p_etapa) then raise exception 'etapa_nao_encontrada'; end if;
  update public.posvenda_alunos set etapa_id = p_etapa, etapa_em = now() where enrollment_id = p_enrollment;
  if not found then raise exception 'aluno_nao_encontrado'; end if;
end;
$$;

-- marca/desmarca um item da etapa atual; quando todos os itens da etapa estão feitos, o aluno avança uma etapa
create or replace function public.pv_marcar_item(p_enrollment uuid, p_item uuid, p_feito boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_etapa uuid;
  v_total integer;
  v_feitos integer;
  v_prox uuid;
begin
  if not public.pv_pode_editar() then raise exception 'sem_permissao'; end if;
  select etapa_id into v_etapa from public.posvenda_alunos where enrollment_id = p_enrollment;
  if v_etapa is null then raise exception 'aluno_nao_encontrado'; end if;
  if not exists (select 1 from public.posvenda_itens where id = p_item and etapa_id = v_etapa) then raise exception 'item_de_outra_etapa'; end if;
  if p_feito then
    insert into public.posvenda_progresso (enrollment_id, item_id, feito_por) values (p_enrollment, p_item, auth.uid())
      on conflict (enrollment_id, item_id) do nothing;
  else
    delete from public.posvenda_progresso where enrollment_id = p_enrollment and item_id = p_item;
  end if;

  select count(*) into v_total from public.posvenda_itens where etapa_id = v_etapa;
  select count(*) into v_feitos from public.posvenda_progresso p
    join public.posvenda_itens i on i.id = p.item_id
   where p.enrollment_id = p_enrollment and i.etapa_id = v_etapa;
  if v_total > 0 and v_feitos >= v_total then
    select id into v_prox from public.posvenda_etapas
     where ordem > (select ordem from public.posvenda_etapas where id = v_etapa)
     order by ordem limit 1;
    if v_prox is not null then
      update public.posvenda_alunos set etapa_id = v_prox, etapa_em = now() where enrollment_id = p_enrollment;
    end if;
  end if;
end;
$$;

-- ---------- entrada automática: primeira parcela (matrícula) paga ----------
create or replace function public.pv_entrada_por_pagamento()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_primeira public.receivables;
  v_lead uuid;
  v_etapa uuid;
begin
  select * into v_primeira from public.receivables where deal_id = new.deal_id order by installment_number, due_date, created_at, id limit 1;
  if v_primeira.id is null or not v_primeira.paid then return null; end if;
  select lead_id into v_lead from public.deals where id = new.deal_id;
  if v_lead is null then return null; end if;
  select id into v_etapa from public.posvenda_etapas order by ordem limit 1;
  if v_etapa is null then return null; end if;
  insert into public.posvenda_alunos (enrollment_id, etapa_id)
    select en.id, v_etapa from public.enrollments en
     where en.lead_id = v_lead
    on conflict (enrollment_id) do nothing;
  return null;
end;
$$;

drop trigger if exists pv_entrada_por_pagamento on public.receivables;
create trigger pv_entrada_por_pagamento after insert or update of paid on public.receivables
  for each row when (new.paid) execute function public.pv_entrada_por_pagamento();

-- ---------- grants ----------
revoke all on function public.pv_pode_ver() from public, anon;
revoke all on function public.pv_pode_editar() from public, anon;
revoke all on function public.pv_listar() from public, anon;
revoke all on function public.pv_etapa_salvar(uuid, text, text, jsonb) from public, anon;
revoke all on function public.pv_etapa_excluir(uuid, uuid) from public, anon;
revoke all on function public.pv_mover_aluno(uuid, uuid) from public, anon;
revoke all on function public.pv_marcar_item(uuid, uuid, boolean) from public, anon;
grant execute on function public.pv_pode_ver() to authenticated;
grant execute on function public.pv_pode_editar() to authenticated;
grant execute on function public.pv_listar() to authenticated;
grant execute on function public.pv_etapa_salvar(uuid, text, text, jsonb) to authenticated;
grant execute on function public.pv_etapa_excluir(uuid, uuid) to authenticated;
grant execute on function public.pv_mover_aluno(uuid, uuid) to authenticated;
grant execute on function public.pv_marcar_item(uuid, uuid, boolean) to authenticated;

-- ---------- seed: 8 etapas aprovadas ----------
with e as (
  insert into public.posvenda_etapas (ordem, nome, responsavel) values
    (10, 'Conferir pagamentos', 'Financeiro e ADM liberam'),
    (20, 'Matrícula na escola', 'Financeiro'),
    (30, 'Coletar documentos', 'Gerente e Suporte'),
    (40, 'Receber e enviar carta de matrícula', 'Suporte e ADM'),
    (50, 'Reserva na acomodação', 'Suporte e ADM'),
    (60, 'Reunião pré-embarque', 'Suporte e ADM'),
    (70, 'Verificar kit', 'Suporte e ADM'),
    (80, 'Buscar no aeroporto', 'Suporte e ADM')
  returning id, ordem
)
insert into public.posvenda_itens (etapa_id, ordem, texto)
select e.id, v.ord, v.txt from e
join (values
  (10, 10, 'Parcela da matrícula paga'),
  (10, 20, 'Liberação do ADM'),
  (20, 10, 'Matrícula efetuada na escola'),
  (30, 10, 'Passaporte recebido'),
  (30, 20, 'CPF e endereço'),
  (30, 30, 'Foto e comprovantes'),
  (40, 10, 'Carta recebida da escola'),
  (40, 20, 'Carta enviada ao aluno'),
  (50, 10, 'Reserva confirmada'),
  (50, 20, 'Custo enviado à acomodação'),
  (60, 10, 'Reunião agendada'),
  (60, 20, 'Reunião realizada'),
  (70, 10, 'Kit conferido'),
  (80, 10, 'Busca organizada'),
  (80, 20, 'Contato de chegada confirmado')
) v(eord, ord, txt) on v.eord = e.ordem;
