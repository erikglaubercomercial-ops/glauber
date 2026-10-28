-- ============================================================
-- MIGRAÇÃO 090 — Dados: Cork English World, Work and Study 25 semanas passa a ser "tudo incluído" (mesmo padrão da English Talks).
-- Valor = curso (manhã €2.620 / tarde €2.120) + seguro médico e learner protection (€280) + taxa de matrícula (€75)
--         + livro de General English (€55) + livro de preparação para exame (€55) + taxa de exame TIE (€150).
-- Manhã €3.235 · Tarde €2.735. Os componentes aparecem como subitens e na descrição; o IELTS (€250) segue como item à parte.
-- Atualiza só os 2 itens "Work and Study 25 semanas" da migração 081 (nome, preço, descrição e subitens).
-- ============================================================
with fees as (
  select max(preco) filter (where nome = 'Taxa de matrícula') as mat,
         max(preco) filter (where nome like 'Livro do curso%') as liv,
         max(preco) filter (where nome like 'Seguro (médico%') as seg,
         max(preco) filter (where nome = 'Taxa de exame TIE') as tie
  from public.catalog_items where subgrupo = 'Cork English World'
)
update public.catalog_items i
set nome = 'Work and Study 25 semanas — Tudo incluído',
    preco = (case f2.nome when 'AM' then 2620 else 2120 end) + f.seg + f.mat + 2 * f.liv + f.tie,
    detalhe = format('General English + preparação para exame, 15 horas por semana, segunda a sexta, %s. Valor total já com: curso de 25 semanas (€%s), seguro médico + learner protection (€%s), taxa de matrícula (€%s), livro de General English (€%s), livro de preparação para exame (€%s) e taxa de exame TIE (€%s). Se o aluno preferir fazer o IELTS no lugar do TIE, a taxa é de €250 (item à parte).',
                     case f2.nome when 'AM' then '09:00–12:15' else '13:00–16:15' end, case f2.nome when 'AM' then 2620 else 2120 end, f.seg, f.mat, f.liv, f.liv, f.tie),
    subs = jsonb_build_array(
        jsonb_build_object('nome', 'Curso — 25 semanas', 'valor', case f2.nome when 'AM' then 2620 else 2120 end),
        jsonb_build_object('nome', 'Seguro (médico + learner protection)', 'valor', f.seg),
        jsonb_build_object('nome', 'Taxa de matrícula', 'valor', f.mat),
        jsonb_build_object('nome', 'Livro de General English', 'valor', f.liv),
        jsonb_build_object('nome', 'Livro de preparação para exame', 'valor', f.liv),
        jsonb_build_object('nome', 'Taxa de exame TIE', 'valor', f.tie))
from public.catalog_folders f2, fees f
where i.folder_id = f2.id and f2.kind = 'turno' and i.subgrupo = 'Cork English World' and i.nome like 'Work and Study 25 semanas%';
