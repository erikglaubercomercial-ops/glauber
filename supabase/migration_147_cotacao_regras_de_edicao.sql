-- ============================================================
-- MIGRAÇÃO 147 — Regras de segurança da edição de cotações
-- 1) Cotação aceita pelo cliente (aprovada_em preenchido) não pode mais ser editada por ninguém logado.
-- 2) Só edita uma cotação o consultor que a criou (consultor_id = quem está logado) ou o ADM.
-- Fluxos do sistema sem usuário logado (aprovação pelo link público, rotinas) não são afetados.
-- A leitura e a exclusão seguem as regras anteriores.
-- ============================================================
create or replace function public.quotes_guard_edicao()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if old.aprovada_em is not null then
    raise exception 'Cotação aceita pelo cliente não pode mais ser editada.' using errcode = '42501';
  end if;
  if public.current_role_name() is distinct from 'ADM' and old.consultor_id is distinct from auth.uid() then
    raise exception 'Só o consultor que criou a cotação ou o ADM pode editá-la.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_guard_edicao on public.quotes;
create trigger quotes_guard_edicao before update on public.quotes
  for each row execute function public.quotes_guard_edicao();
