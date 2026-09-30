-- ============================================================
-- MIGRAÇÃO 027 — corrige a coluna do Pipeline dos 183 negócios
-- recriados na migração 026. Eles foram todos colocados na 1ª coluna
-- por padrão, mas boa parte já tinha sido trabalhada (lead.status
-- diferente de "Novo"). Move para a coluna correspondente com base
-- no status salvo do lead. Só afeta os negócios criados pela 026
-- (created_at do negócio idêntico ao created_at do lead — nenhum
-- negócio criado normalmente tem essa igualdade exata).
-- ============================================================

update public.deals d
set stage = 'contato'
from public.leads l
where l.id = d.lead_id
  and d.created_at = l.created_at
  and l.status = 'Em contato';

update public.deals d
set stage = 'negociacao'
from public.leads l
where l.id = d.lead_id
  and d.created_at = l.created_at
  and l.status = 'Qualificado';

update public.deals d
set stage = 'e7e1041e-7142-4b93-be3e-c112a0c77ee4'
from public.leads l
where l.id = d.lead_id
  and d.created_at = l.created_at
  and l.status = 'Descartado';
