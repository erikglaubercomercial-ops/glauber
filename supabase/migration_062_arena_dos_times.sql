-- ============================================================
-- MIGRAÇÃO 062 — Arena dos Times (menu Time): 3 times, nome de guerra,
-- foto do gerente e placar de competição.        >>> NÃO APLICADA AINDA <<<
--
-- • teams ganha: war_name (nome de guerra), motto (grito de guerra), color
--   (cor do time) e photo_path (foto do gerente, no bucket público team-photos).
--   O campo name segue sendo a região (Latinos, Brasil 1, Brasil 2) — o aviso
--   do time "Time Brasil" continua valendo para os dois times do Brasil.
-- • Times: Latinos (nome de guerra sugerido: Caminantes), Brasil 1 =
--   Desbravadores e Brasil 2 (sem nome de guerra ainda: o gerente escolhe).
-- • O gerente do time (e o ADM) edita nome de guerra, grito, cor e foto do
--   próprio time (gatilho impede mexer em gerente/países).
-- • team_scores(from, to): placar de todos os times e consultores no período.
--   Roda no banco para que cada consultor veja o time inteiro (sem isso ele só
--   enxergaria os próprios leads). Faturamento só para quem acessa o Financeiro.
-- • team_scores_monthly(ano): vendas por mês de cada time (gráfico de corrida).
-- ============================================================

alter table public.teams
  add column if not exists war_name text not null default '',
  add column if not exists motto text not null default '',
  add column if not exists color text not null default '#3167a1',
  add column if not exists photo_path text;

-- ---------------- os 3 times ----------------
update public.teams set name = 'Latinos', war_name = 'Caminantes', motto = '¡Cada paso nos acerca!', color = '#e8751a' where name = 'Time Latinos';
update public.teams set name = 'Brasil 1', war_name = 'Desbravadores', motto = 'Abrimos caminho para o seu sonho.', color = '#3167a1' where name = 'Brasil';
insert into public.teams (name, manager_id, countries, color)
select 'Brasil 2', null, array['BR'], '#1f4670'
where not exists (select 1 from public.teams where name = 'Brasil 2');

-- ---------------- edição pelo gerente do time ----------------
create policy "teams: gerente do time edita o próprio"
  on public.teams for update
  using (manager_id = auth.uid())
  with check (manager_id = auth.uid());

create or replace function public.teams_limita_edicao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.current_role_name() = 'ADM' or auth.uid() is null then
    return new;
  end if;
  -- gerente do time: só nome de guerra, grito, cor e foto (a região fica com o ADM)
  new.name := old.name;
  new.manager_id := old.manager_id;
  new.countries := old.countries;
  return new;
end;
$$;
revoke all on function public.teams_limita_edicao() from public, anon, authenticated;
create trigger teams_limita_edicao before update on public.teams
  for each row execute function public.teams_limita_edicao();

-- ---------------- fotos (bucket público, pasta = id do time) ----------------
insert into storage.buckets (id, name, public) values ('team-photos', 'team-photos', true)
on conflict (id) do nothing;

create policy "team-photos: ADM e gerente do time enviam"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'team-photos'
    and (public.current_role_name() = 'ADM'
         or exists (select 1 from public.teams t where t.id::text = (storage.foldername(name))[1] and t.manager_id = auth.uid()))
  );
create policy "team-photos: ADM e gerente do time trocam"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'team-photos'
    and (public.current_role_name() = 'ADM'
         or exists (select 1 from public.teams t where t.id::text = (storage.foldername(name))[1] and t.manager_id = auth.uid()))
  );

-- ---------------- placar ----------------
create or replace function public.team_scores(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fin boolean := public.has_module_access('financeiro');
  v_win text := public.won_stage_id();
  v_res jsonb;
begin
  if auth.uid() is null or public.current_role_name() is null then
    raise exception 'sem permissão';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'war_name', t.war_name, 'motto', t.motto, 'color', t.color, 'photo_path', t.photo_path,
      'manager_id', t.manager_id, 'manager_name', (select name from public.profiles where id = t.manager_id),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'name', p.name, 'role', p.role,
          'leads', (select count(*) from public.leads l where l.consultor_id = p.id and l.created_at >= p_from and l.created_at < p_to + 1),
          'responded', (select count(*) from public.leads l where l.consultor_id = p.id and l.created_at >= p_from and l.created_at < p_to + 1
                          and l.status in ('Em contato', 'Qualificado', 'Venda realizada')),
          'won', (select count(*) from public.deals d join public.leads l on l.id = d.lead_id
                   where l.consultor_id = p.id and d.stage = v_win and d.closed_at >= p_from and d.closed_at < p_to + 1),
          'revenue', case when v_fin then (select coalesce(sum(d.value), 0) from public.deals d join public.leads l on l.id = d.lead_id
                   where l.consultor_id = p.id and d.stage = v_win and d.closed_at >= p_from and d.closed_at < p_to + 1) else null end,
          'meetings', (select count(*) from public.agenda_items a where a.consultor_id = p.id and a.type = 'reuniao' and a.status = 'realizada'
                        and a.item_date >= p_from and a.item_date <= p_to)
        ) order by p.name)
        from public.profiles p where p.team_id = t.id and p.active), '[]'::jsonb)
    ) order by t.name), '[]'::jsonb)
  into v_res
  from public.teams t;
  return v_res;
end;
$$;

create or replace function public.team_scores_monthly(p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_win text := public.won_stage_id(); v_res jsonb;
begin
  if auth.uid() is null or public.current_role_name() is null then
    raise exception 'sem permissão';
  end if;
  select coalesce(jsonb_object_agg(t.id, (
    select jsonb_agg(coalesce(x.n, 0) order by m.mo)
    from generate_series(1, 12) as m(mo)
    left join (
      select extract(month from d.closed_at)::int as mo, count(*) as n
      from public.deals d join public.leads l on l.id = d.lead_id join public.profiles p on p.id = l.consultor_id
      where p.team_id = t.id and d.stage = v_win and extract(year from d.closed_at) = p_year
      group by 1
    ) x on x.mo = m.mo
  )), '{}'::jsonb) into v_res
  from public.teams t;
  return v_res;
end;
$$;

revoke all on function public.team_scores(date, date) from public, anon;
revoke all on function public.team_scores_monthly(integer) from public, anon;
grant execute on function public.team_scores(date, date) to authenticated;
grant execute on function public.team_scores_monthly(integer) to authenticated;
