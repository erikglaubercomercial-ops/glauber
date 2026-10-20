-- ============================================================
-- MIGRAÇÃO 077 — Nova regra de liberação da comissão do consultor:
-- a matrícula conta como REALIZADA (e a comissão fica liberada para pagar) assim que
-- qualquer valor enviado à escola for registrado (Financeiro › Envios para escolas) para
-- a matrícula do lead do negócio. Antes valia "cliente pagou o mínimo (€ 500)".
-- O gatilho commissions_guard_pagamento e a ficha do cliente já usam esta função, então
-- passam a seguir a regra nova. O campo release_min_paid fica guardado, mas sem uso.
-- ============================================================
create or replace function public.commission_released(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deals d
    join public.enrollments e on e.lead_id = d.lead_id
    join public.school_transfers st on st.enrollment_id = e.id
    where d.id = p_deal_id and st.amount > 0
  );
$$;
