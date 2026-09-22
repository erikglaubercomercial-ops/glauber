-- ============================================================
-- MIGRAÇÃO 014 — Formulários públicos simples (form builder).
-- Um formulário tem título, subtítulo e uma lista de campos
-- (jsonb, ordem = ordem de criação). O link público é fixo por
-- formulário (?f=slug), sem token — qualquer pessoa preenche e o
-- envio cria um lead automaticamente (campos "nome"/"e-mail"/
-- "telefone"/"origem" alimentam as colunas do lead; qualquer outro
-- campo extra vira uma linha em leads.notes, nova coluna).
-- ============================================================

alter table public.leads add column if not exists notes text default '';

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Formulário',
  subtitle text default '',
  slug text not null unique,
  fields jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.forms enable row level security;
alter table public.form_submissions enable row level security;

create policy "autenticados leem formularios"
  on public.forms for select
  using (auth.role() = 'authenticated');

create policy "adm gerente mkt criam formularios"
  on public.forms for insert
  with check (public.current_role_name() in ('ADM','Gerente','MKT'));

create policy "adm gerente mkt atualizam formularios"
  on public.forms for update
  using (public.current_role_name() in ('ADM','Gerente','MKT'))
  with check (public.current_role_name() in ('ADM','Gerente','MKT'));

create policy "adm gerente mkt excluem formularios"
  on public.forms for delete
  using (public.current_role_name() in ('ADM','Gerente','MKT'));

create policy "autenticados leem respostas de formularios"
  on public.form_submissions for select
  using (auth.role() = 'authenticated');

-- ---------- leitura pública (anônima) de um formulário ativo ----------
-- devolve título/subtítulo/campos já com as opções de "Origem"
-- resolvidas na hora (a tabela lead_sources não é legível por anon).
create or replace function public.get_form_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form record;
  v_sources jsonb;
  v_fields jsonb;
begin
  select id, title, subtitle, fields into v_form
  from public.forms where slug = p_slug and active = true;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(name order by ordem), '[]'::jsonb) into v_sources
  from public.lead_sources;

  select coalesce(jsonb_agg(
    case when f->>'type' = 'source' then f || jsonb_build_object('options', v_sources) else f end
  ), '[]'::jsonb) into v_fields
  from jsonb_array_elements(v_form.fields) f;

  return jsonb_build_object('id', v_form.id, 'title', v_form.title, 'subtitle', v_form.subtitle, 'fields', v_fields);
end;
$$;

grant execute on function public.get_form_by_slug(text) to anon;

-- ---------- envio público ----------
-- cria o lead (mapeando os campos especiais: nome/e-mail/telefone/
-- origem) e guarda a resposta bruta em form_submissions.
create or replace function public.submit_form_public(p_slug text, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form record;
  v_field jsonb;
  v_lead_id uuid;
  v_name text := '';
  v_email text := '';
  v_digits text := '';
  v_ddd text := '';
  v_number text := '';
  v_source text := 'Outro';
  v_notes text := '';
  v_val text;
begin
  select id, fields into v_form from public.forms where slug = p_slug and active = true;
  if not found then
    raise exception 'Formulário não encontrado.';
  end if;

  for v_field in select * from jsonb_array_elements(v_form.fields)
  loop
    v_val := coalesce(p_answers->>(v_field->>'id'), '');
    if v_field->>'type' = 'name' then
      v_name := v_val;
    elsif v_field->>'type' = 'email' then
      v_email := v_val;
    elsif v_field->>'type' = 'phone_br' then
      v_digits := regexp_replace(v_val, '\D', '', 'g');
      v_ddd := substring(v_digits from 1 for 2);
      v_number := substring(v_digits from 3);
    elsif v_field->>'type' = 'source' then
      v_source := coalesce(nullif(v_val, ''), 'Outro');
    else
      if v_val <> '' then
        v_notes := v_notes || (v_field->>'label') || ': ' || v_val || E'\n';
      end if;
    end if;
  end loop;

  insert into public.leads (
    name, email, country_code, phone_ddd, phone_number, phone,
    source, category, status, temperature, active, notes
  ) values (
    nullif(v_name, ''), v_email, 'BR', v_ddd, v_number,
    case when v_ddd <> '' and v_number <> '' then '(' || v_ddd || ') ' || v_number else '' end,
    v_source, 'Outro', 'Novo', 'Morno', true, trim(trailing E'\n' from v_notes)
  )
  returning id into v_lead_id;

  insert into public.form_submissions (form_id, answers, lead_id)
  values (v_form.id, p_answers, v_lead_id);
end;
$$;

grant execute on function public.submit_form_public(text, jsonb) to anon;

-- ---------- formulário padrão já pedido: "Somos todos Peregrinos" ----------
insert into public.forms (title, subtitle, slug, fields) values (
  'Somos todos Peregrinos',
  'Rumo à Irlanda',
  'rumo-a-irlanda',
  '[
    {"id":"nome","label":"Nome completo","type":"name","required":true},
    {"id":"email","label":"E-mail","type":"email","required":true},
    {"id":"telefone","label":"Número com DDD","type":"phone_br","required":true},
    {"id":"sozinho","label":"Vem sozinho(a)?","type":"boolean","required":true},
    {"id":"quando","label":"Quando pretende vir?","type":"date","required":true},
    {"id":"origem","label":"Como chegou até nós?","type":"source","required":true}
  ]'::jsonb
);
