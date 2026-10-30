-- ============================================================
-- MIGRAÇÃO 100 — "O que a escola oferece": lista padrão igual em TODAS as escolas (pedido do ADM em 30/10/2026).
-- Cada escola ainda pode ser editada depois (Escolas › editar). Listas anteriores, para desfazer, ficam no fim deste arquivo.
-- ============================================================
update public.schools set inclusos = '["25 weeks of course","8 weeks holidays","Medical Insurance","Learner Protection","1st Textbook","Exit Exam","Bank Letter","+ Hours of Extra Classes","+ Monthly extra activities"]'::jsonb;

-- LISTAS ANTERIORES (só as que eram diferentes da nova):
-- Cork English World: ["15 horas de aula por semana (segunda a sexta)","Máximo de 16 alunos por turma","Fechada nos feriados irlandeses e de 14/12/2026 a 03/01/2027"]
-- English Talks: ["15 a 30 horas de aula por semana em sala","Aulas: manhã 09:00–12:15 · tarde 13:00–16:15","Work & Study: 25 semanas de aula + 9 semanas de férias"]
-- Academic Bridge: igual à nova, mas "10 weeks holidays" e "TIE Exam" (em vez de "Exit Exam")
-- NED Dublin e NED Limerick: iguais à nova, mais "Student Support Post-boarding","Student App","NED welcome kit" (antes de "+ Hours of Extra Classes"), e "TIE Exam"
-- Future Learning (Athlone e Dublin), Atlas School Dublin, Bridge Mils: iguais à nova, com "TIE Exam" em vez de "Exit Exam"
-- Atlas School Liverpool, Atlas School Malta e as escolas inativas: lista vazia
