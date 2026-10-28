-- ============================================================
-- MIGRAÇÃO 089 — Dados: a promoção English Talks (25 semanas, tudo incluído) passa a incluir a taxa de exame TIE (€100)
-- e a matrícula é a de 6 a 12 meses (8 meses). Manhã: €1.899 + 350 + 100 = €2.349 · Tarde: €1.499 + 350 + 100 = €1.949.
-- Atualiza só os 2 itens criados na migração 088.
-- ============================================================
with fees as (
  select max(preco) filter (where nome like 'Taxa de matrícula — longa%') as mat,
         max(preco) filter (where nome = 'Seguro médico — 8 meses') as seg,
         max(preco) filter (where nome = 'Learner Protection — 25 semanas') as lp,
         max(preco) filter (where nome = 'Livro do curso') as liv,
         max(preco) filter (where nome = 'Taxa de exame TIE') as tie
  from public.catalog_items where subgrupo = 'English Talks'
)
update public.catalog_items i
set preco = (case f2.nome when 'AM' then 1899 else 1499 end) + f.mat + f.seg + f.lp + f.liv + f.tie,
    detalhe = format('Promoção atual da English Talks, turno %s. Valor total já com: curso de 25 semanas (€%s), livro do curso (€%s), seguro médico de 8 meses (€%s), Learner Protection de 25 semanas (€%s), taxa de matrícula de 6 a 12 meses (€%s) e taxa de exame TIE (€%s).',
                     case f2.nome when 'AM' then 'da manhã' else 'da tarde' end, case f2.nome when 'AM' then 1899 else 1499 end, f.liv, f.seg, f.lp, f.mat, f.tie),
    subs = jsonb_build_array(
         jsonb_build_object('nome', 'Curso — 25 semanas', 'valor', case f2.nome when 'AM' then 1899 else 1499 end),
         jsonb_build_object('nome', 'Livro do curso', 'valor', f.liv),
         jsonb_build_object('nome', 'Seguro médico (8 meses)', 'valor', f.seg),
         jsonb_build_object('nome', 'Learner Protection (25 semanas)', 'valor', f.lp),
         jsonb_build_object('nome', 'Taxa de matrícula (8 meses)', 'valor', f.mat),
         jsonb_build_object('nome', 'Taxa de exame TIE', 'valor', f.tie))
from public.catalog_folders f2, fees f
where i.folder_id = f2.id and f2.kind = 'turno' and i.nome = 'Work & Study 25 semanas — Promoção (tudo incluído)'
  and i.subgrupo = 'English Talks';
