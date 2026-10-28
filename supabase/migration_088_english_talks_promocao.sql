-- ============================================================
-- MIGRAÇÃO 088 — Dados: promoção atual da English Talks (Cork), pacote de 25 semanas "tudo incluído".
-- Valor = curso (manhã €1.899 / tarde €1.499) + livro do curso + seguro médico (8 meses) + Learner Protection (25 semanas)
-- + taxa de matrícula (longa duração), somando os valores que já estão cadastrados da escola.
-- Fica visível para clientes e consultores (ativo), com a composição em "subs" e na descrição.
-- Só insere linhas; nada existente é alterado.
-- ============================================================
with fees as (
  select max(preco) filter (where nome like 'Taxa de matrícula — longa%') as mat,
         max(preco) filter (where nome = 'Seguro médico — 8 meses') as seg,
         max(preco) filter (where nome = 'Learner Protection — 25 semanas') as lp,
         max(preco) filter (where nome = 'Livro do curso') as liv
  from public.catalog_items where subgrupo = 'English Talks'
),
turnos as (
  select f.id as folder, f.nome as turno, case f.nome when 'AM' then 1899 else 1499 end as curso
  from public.catalog_folders f
  join public.catalog_folders pl on pl.id = f.parent_id and pl.nome = '1 Curso' and pl.kind = 'plano'
  join public.catalog_folders esc on esc.id = pl.parent_id and esc.kind = 'escola' and esc.nome = 'English Talks'
  where f.kind = 'turno'
)
insert into public.catalog_items (id, nome, unidade, preco, ordem, detalhe, qtd_fixa, qtd_padrao, ativo, subs, folder_id)
select gen_random_uuid()::text,
       'Work & Study 25 semanas — Promoção (tudo incluído)',
       'pacote',
       t.curso + f.mat + f.seg + f.lp + f.liv,
       90,
       format('Promoção atual da English Talks, turno %s. Valor total já com: curso de 25 semanas (€%s), livro do curso (€%s), seguro médico de 8 meses (€%s), Learner Protection de 25 semanas (€%s) e taxa de matrícula (€%s).',
              case t.turno when 'AM' then 'da manhã' else 'da tarde' end, t.curso, f.liv, f.seg, f.lp, f.mat),
       true, 1, true,
       jsonb_build_array(
         jsonb_build_object('nome', 'Curso — 25 semanas', 'valor', t.curso),
         jsonb_build_object('nome', 'Livro do curso', 'valor', f.liv),
         jsonb_build_object('nome', 'Seguro médico (8 meses)', 'valor', f.seg),
         jsonb_build_object('nome', 'Learner Protection (25 semanas)', 'valor', f.lp),
         jsonb_build_object('nome', 'Taxa de matrícula', 'valor', f.mat)),
       t.folder
from turnos t cross join fees f
where not exists (select 1 from public.catalog_items i where i.folder_id = t.folder and i.nome = 'Work & Study 25 semanas — Promoção (tudo incluído)');
