-- ============================================================
-- MIGRAÇÃO 091 — Dados: cidade Athlone no menu de cidades das escolas (Comparativo e página pública).
-- A escola Future Learning (Athlone, Irlanda) já existia e está ativa; faltava a cidade no menu (school_cities).
-- ============================================================
insert into public.school_cities (nome, ordem)
select 'Athlone', (select coalesce(max(ordem), 0) + 1 from public.school_cities)
where not exists (select 1 from public.school_cities where nome = 'Athlone');
