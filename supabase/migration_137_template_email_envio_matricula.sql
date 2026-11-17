-- ============================================================
-- MIGRAÇÃO 137 — Template de e-mail: envio de matrícula e comprovante de pagamento para a escola
-- Usa as variáveis da matrícula do lead ({{escola}}, {{data_nascimento}}, {{nacionalidade}}, {{cpf}},
-- {{email_cliente}}, {{telefone_cliente}}, {{endereco}}, {{contato_emergencia}}).
-- ============================================================
insert into public.email_templates (titulo, categoria, assunto, corpo, ordem, ativo)
select 'Envio de matrícula e comprovante à escola', 'Matrícula',
$a$Enrollment request – {{nome}} | Peregrinos Intercambio$a$,
$b$Dear {{escola}} team,

I hope this email finds you well.

Please find attached the proof of payment for the enrollment fee and a copy of the passport for our student, {{nome}}, from Peregrinos Intercambio.

Below are the student's registration details for your records so we can proceed with the enrollment process:

Full Name: {{nome}}
Date of Birth: {{data_nascimento}}
Nationality: {{nacionalidade}}
Tax ID (CPF): {{cpf}}
Passport: Attached
Email: {{email_cliente}}
Phone: {{telefone_cliente}}
Address: {{endereco}}
Emergency Contact: {{contato_emergencia}}

Please let me know if you need any further information or additional documentation to issue the enrollment letters or confirm the student's placement.

Kind regards,
{{consultor}}
Peregrinos Intercambio
{{email_consultor}}$b$,
55, true
where not exists (select 1 from public.email_templates where titulo = 'Envio de matrícula e comprovante à escola');
