-- ============================================================
-- Migration 008: trava a origem do lead depois de criado — só ADM
-- ou Gerente podem alterá-la. Qualquer função pode definir a
-- origem na hora de CRIAR o lead (o trigger só age em UPDATE).
-- Isso é a trava real (RLS/trigger), complementando o bloqueio já
-- feito na interface — sem isso, bastaria uma chamada direta à API
-- para contornar o bloqueio do front-end.
-- ============================================================

create or replace function public.leads_enforce_source_lock()
returns trigger as $$
begin
  if new.source is distinct from old.source
     and public.current_role_name() not in ('ADM', 'Gerente') then
    raise exception 'Apenas ADM ou Gerente podem alterar a origem de um lead já cadastrado.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists leads_source_lock on public.leads;
create trigger leads_source_lock
  before update on public.leads
  for each row execute function public.leads_enforce_source_lock();
