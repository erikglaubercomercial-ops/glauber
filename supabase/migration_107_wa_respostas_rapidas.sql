-- ============================================================
-- MIGRAÇÃO 107 — WhatsApp: respostas rápidas salvas.
-- owner_id nulo = resposta da equipe (só ADM e Gerente criam e editam; ADM, Gerente e Consultor usam).
-- owner_id preenchido = resposta pessoal (só o dono vê e edita).
-- ============================================================
create table public.wa_quick_replies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  category text not null default 'Geral' check (char_length(btrim(category)) between 1 and 60),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wa_quick_replies_owner_idx on public.wa_quick_replies (owner_id);
alter table public.wa_quick_replies enable row level security;
revoke all on public.wa_quick_replies from anon;

create policy "respostas rápidas: leitura" on public.wa_quick_replies for select to authenticated
  using (public.current_role_name() in ('ADM', 'Gerente', 'Consultor') and (owner_id is null or owner_id = auth.uid()));
create policy "respostas rápidas: criação" on public.wa_quick_replies for insert to authenticated
  with check ((owner_id = auth.uid() and public.current_role_name() in ('ADM', 'Gerente', 'Consultor')) or (owner_id is null and public.current_role_name() in ('ADM', 'Gerente')));
create policy "respostas rápidas: edição" on public.wa_quick_replies for update to authenticated
  using ((owner_id = auth.uid() and public.current_role_name() in ('ADM', 'Gerente', 'Consultor')) or (owner_id is null and public.current_role_name() in ('ADM', 'Gerente')))
  with check ((owner_id = auth.uid() and public.current_role_name() in ('ADM', 'Gerente', 'Consultor')) or (owner_id is null and public.current_role_name() in ('ADM', 'Gerente')));
create policy "respostas rápidas: exclusão" on public.wa_quick_replies for delete to authenticated
  using ((owner_id = auth.uid() and public.current_role_name() in ('ADM', 'Gerente', 'Consultor')) or (owner_id is null and public.current_role_name() in ('ADM', 'Gerente')));
