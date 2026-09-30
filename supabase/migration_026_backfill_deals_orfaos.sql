-- ============================================================
-- MIGRAÇÃO 026 — recria o card no Pipeline para leads que ficaram sem
-- negócio vinculado. Causa: saveDeals() reenvia a tabela deals inteira
-- a cada criação/importação de lead (script.js), e se esse upsert falha
-- (rede/timeout), o erro só vai pro console — o lead fica salvo, mas o
-- card dele no Pipeline nunca é criado. Achado ao investigar leads do
-- consultor gwpb10 "sumidos" do Pipeline (na verdade nunca tiveram
-- negócio criado, principalmente de duas importações CSV de 21-22/09).
-- Mesma lógica de backfill usada originalmente na migração 002.
-- ============================================================

insert into public.deals (id, name, contact, info, value, stage, notes, lead_id, created_at)
select
  gen_random_uuid(),
  l.name,
  coalesce(nullif(l.phone, ''), l.email, ''),
  coalesce(nullif(l.email, ''), l.phone, ''),
  0,
  (select id from public.pipeline_stages order by position limit 1),
  '',
  l.id,
  l.created_at
from public.leads l
where not exists (select 1 from public.deals d where d.lead_id = l.id);
