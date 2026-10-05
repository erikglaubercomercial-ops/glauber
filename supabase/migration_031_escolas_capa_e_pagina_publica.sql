-- ============================================================
-- MIGRAÇÃO 031 — capa (foto) de cada escola + página pública do
-- comparativo (link pro cliente, um pra AM e outro pra PM).
--
-- Capa: bucket PÚBLICO "school-covers" (a foto aparece na página do
-- cliente sem login). Só o ADM envia/troca/apaga.
-- Página pública: função que devolve as escolas ativas com os
-- produtos de cada uma, SEM os preços à vista (só parcelado) — a
-- mesma regra do comparativo interno. O turno (AM/PM) é filtrado na
-- própria página.
-- ============================================================

alter table public.schools add column if not exists cover_path text;

insert into storage.buckets (id, name, public)
values ('school-covers', 'school-covers', true)
on conflict (id) do update set public = true;

create policy "school-covers: leitura pública"
  on storage.objects for select
  using (bucket_id = 'school-covers');

create policy "school-covers: ADM envia"
  on storage.objects for insert
  with check (bucket_id = 'school-covers' and public.current_role_name() = 'ADM');

create policy "school-covers: ADM atualiza"
  on storage.objects for update
  using (bucket_id = 'school-covers' and public.current_role_name() = 'ADM');

create policy "school-covers: ADM exclui"
  on storage.objects for delete
  using (bucket_id = 'school-covers' and public.current_role_name() = 'ADM');

create or replace function public.get_public_school_comparison()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'nome', s.nome,
      'categoria', s.categoria,
      'destino', s.destino,
      'descricao', s.descricao,
      'inclusos', s.inclusos,
      'cover_path', s.cover_path,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'nome', p.nome, 'turno', p.turno, 'preco', p.preco,
            'unidade', p.unidade, 'detalhe', p.detalhe, 'ordem', p.ordem
          ) order by p.ordem
        )
        from public.catalog_items p
        where p.ativo
          and coalesce(nullif(p.categoria, ''), 'Outros') = s.categoria
          and coalesce(nullif(p.destino, ''), 'Todos') = s.destino
          and coalesce(p.subgrupo, '') = s.nome
          and p.nome !~* '(full payment|[aà][[:space:]]+vista)'
          and coalesce(p.detalhe, '') !~* '(full payment|[aà][[:space:]]+vista)'
      ), '[]'::jsonb)
    ) order by s.ordem, s.nome
  ), '[]'::jsonb)
  from public.schools s
  where s.ativo;
$$;

grant execute on function public.get_public_school_comparison() to anon, authenticated;
