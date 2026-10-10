-- ============================================================
-- MIGRAÇÃO 056 — todo lead novo ganha o card no Pipeline, sempre.
--
-- Problema: o card do Pipeline (tabela deals) só era criado pela tela, no
-- navegador de quem cadastrava o lead. Leads que chegam por outros caminhos
-- (App Intercâmbio, formulário público, indicação) ficavam sem negócio e
-- não apareciam no Pipeline do consultor (mesma falha da migração 026).
--
-- • trigger leads_cria_negocio: ao inserir um lead, cria o negócio na 1ª
--   coluna do funil. O id do negócio é o próprio id do lead — assim, se a
--   tela também tentar criar o card (cadastro manual/importação), o upsert
--   cai no mesmo registro e não duplica.
-- • backfill: cria o card dos leads que hoje estão sem negócio. Lead "Em
--   contato" entra em Contato Feito; os demais em Lead Novo. Não altera
--   nenhum negócio que já exista (status/posição/histórico intactos).
-- ============================================================

create or replace function public.leads_cria_negocio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.deals d where d.lead_id = new.id) then
    return new;
  end if;
  insert into public.deals (id, name, contact, info, value, stage, notes, lead_id, created_at)
  values (
    new.id,
    coalesce(nullif(new.name, ''), 'Sem nome'),
    coalesce(nullif(new.phone, ''), new.email, ''),
    coalesce(nullif(new.email, ''), new.phone, ''),
    0,
    (select id from public.pipeline_stages order by position limit 1),
    '',
    new.id,
    new.created_at
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.leads_cria_negocio() from public, anon, authenticated;

create trigger leads_cria_negocio
  after insert on public.leads
  for each row execute function public.leads_cria_negocio();

-- backfill dos leads sem negócio
insert into public.deals (id, name, contact, info, value, stage, notes, lead_id, created_at)
select
  l.id,
  coalesce(nullif(l.name, ''), 'Sem nome'),
  coalesce(nullif(l.phone, ''), l.email, ''),
  coalesce(nullif(l.email, ''), l.phone, ''),
  0,
  case when l.status = 'Em contato'
       then coalesce((select id from public.pipeline_stages where id = 'contato'),
                     (select id from public.pipeline_stages order by position limit 1))
       else (select id from public.pipeline_stages order by position limit 1) end,
  '',
  l.id,
  l.created_at
from public.leads l
where not exists (select 1 from public.deals d where d.lead_id = l.id)
on conflict (id) do nothing;
