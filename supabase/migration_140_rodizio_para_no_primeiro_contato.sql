-- ============================================================
-- MIGRAÇÃO 140 — rodízio: o lead sai da fila no primeiro contato.
--
-- Antes, rotation_active nunca era desligado: o cron (022) reatribuía o
-- lead a cada 24h mesmo depois de o consultor já ter falado com ele.
--
-- • rodizio_marcar_contato: chamada pelo app quando o consultor clica no
--   WhatsApp do lead (primeiro contato). Só o dono do lead (ou ADM/Gerente).
-- • limpeza única: leads que já saíram de "Novo" já passaram do primeiro
--   contato, então saem da fila.
-- ============================================================

create or replace function public.rodizio_marcar_contato(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads
     set rotation_active = false,
         rotation_deadline = null
   where id = p_lead_id
     and rotation_active = true
     and (consultor_id = auth.uid() or public.current_role_name() in ('ADM', 'Gerente'));
end;
$$;

revoke all on function public.rodizio_marcar_contato(uuid) from public, anon;
grant execute on function public.rodizio_marcar_contato(uuid) to authenticated;

update public.leads
   set rotation_active = false,
       rotation_deadline = null
 where rotation_active = true
   and status <> 'Novo';
