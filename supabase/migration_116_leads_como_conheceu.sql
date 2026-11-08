-- ============================================================
-- MIGRAÇÃO 116 — Lead ganha o campo "Como conheceu" (resposta da pergunta "Como você nos conheceu?" dos formulários).
-- Lista de Leads passa a ter as mesmas colunas das respostas dos formulários: Nome completo, E-mail, WhatsApp,
-- Como conheceu, Origem, Recebido em e Consultor. O campo é editável na ficha do lead.
-- Leads que já vieram de formulário são preenchidos com a resposta mais recente.
-- ============================================================
alter table public.leads add column if not exists como_conheceu text not null default '';

update public.leads l
   set como_conheceu = q.resp
  from (
    select distinct on (fs.lead_id) fs.lead_id, left(btrim(fs.answers ->> (x ->> 'id')), 120) as resp
      from public.form_submissions fs
      join public.forms f on f.id = fs.form_id
      cross join lateral jsonb_array_elements(f.fields) x
     where fs.lead_id is not null
       and (x ->> 'label') ilike '%conhec%'
       and coalesce(btrim(fs.answers ->> (x ->> 'id')), '') <> ''
     order by fs.lead_id, fs.created_at desc
  ) q
 where l.id = q.lead_id and l.como_conheceu = '';
