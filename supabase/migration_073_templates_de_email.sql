-- ============================================================
-- MIGRAÇÃO 073 — Templates de e-mail padrão (menu Templates).
-- Todos os usuários internos leem e copiam; só o ADM cria, edita, duplica e exclui.
-- Variáveis no texto: {{nome}}, {{primeiro_nome}}, {{consultor}}, {{email_consultor}}.
-- ============================================================
create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  categoria text not null default 'Geral',
  assunto text not null default '',
  corpo text not null default '',
  ordem integer not null default 100,
  ativo boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_templates enable row level security;
create policy "templates de e-mail: leitura para a equipe"
  on public.email_templates for select using (public.current_role_name() is not null);
create policy "templates de e-mail: criação somente ADM"
  on public.email_templates for insert with check (public.current_role_name() = 'ADM');
create policy "templates de e-mail: edição somente ADM"
  on public.email_templates for update using (public.current_role_name() = 'ADM') with check (public.current_role_name() = 'ADM');
create policy "templates de e-mail: exclusão somente ADM"
  on public.email_templates for delete using (public.current_role_name() = 'ADM');

insert into public.email_templates (titulo, categoria, assunto, corpo, ordem) values
('Boas-vindas ao lead', 'Primeiro contato',
 'Bem-vindo(a) à Peregrinos Intercâmbio, {{primeiro_nome}}!',
 E'Olá, {{primeiro_nome}}, tudo bem?\n\nAqui é {{consultor}}, da Peregrinos Intercâmbio. Recebi o seu cadastro e vou acompanhar você daqui para frente, do primeiro passo até o embarque.\n\nPara eu montar a melhor proposta para o seu perfil, me conta rapidinho:\n• Qual destino você tem em mente?\n• Quando pretende viajar?\n• Por quanto tempo quer ficar?\n• Já tem uma ideia de orçamento?\n\nSe preferir, posso te ligar ou combinamos uma conversa por vídeo, no horário que for melhor para você.\n\nUm abraço,\n{{consultor}}\nPeregrinos Intercâmbio\n{{email_consultor}}', 10),
('Envio da cotação', 'Cotação',
 '{{primeiro_nome}}, sua cotação da Peregrinos Intercâmbio',
 E'Olá, {{primeiro_nome}}!\n\nConforme conversamos, segue a sua cotação com as opções de escola, valores e o que está incluso em cada pacote.\n\nSe quiser, posso te explicar cada item e comparar as opções com você. Fico à disposição para tirar qualquer dúvida e ajustar a proposta ao que fizer mais sentido para os seus planos.\n\nAssim que você escolher, eu cuido do próximo passo: contrato e matrícula.\n\nUm abraço,\n{{consultor}}\nPeregrinos Intercâmbio\n{{email_consultor}}', 20),
('Acompanhamento sem resposta', 'Acompanhamento',
 '{{primeiro_nome}}, ficou alguma dúvida?',
 E'Olá, {{primeiro_nome}}, tudo bem?\n\nPassando para saber se você conseguiu ver a nossa última mensagem e se ficou alguma dúvida sobre o seu intercâmbio.\n\nSe os planos mudaram ou se precisa de mais tempo, sem problema: me avise e eu ajusto o que for preciso. Se quiser, também posso te ligar rapidinho para conversarmos.\n\nFico no aguardo!\n\n{{consultor}}\nPeregrinos Intercâmbio\n{{email_consultor}}', 30),
('Convite para conversa', 'Reunião',
 'Vamos conversar sobre o seu intercâmbio, {{primeiro_nome}}?',
 E'Olá, {{primeiro_nome}}!\n\nQue tal marcarmos uma conversa de uns 20 a 30 minutos para eu entender melhor o que você procura e te apresentar as melhores opções?\n\nMe diga quais dias e horários ficam bons para você e eu confirmo por aqui. Pode ser por ligação ou vídeo.\n\nAguardo o seu retorno!\n\n{{consultor}}\nPeregrinos Intercâmbio\n{{email_consultor}}', 40),
('Documentos para a matrícula', 'Matrícula',
 '{{primeiro_nome}}, documentos para a sua matrícula',
 E'Olá, {{primeiro_nome}}!\n\nQue bom ter você com a gente! Para seguirmos com a sua matrícula, preciso de:\n• Foto do passaporte (página com os seus dados), ou o número do documento, se ainda estiver em emissão;\n• Seus dados completos para o contrato (endereço, CPF e contato de emergência).\n\nAssim que receber, confirmo o próximo passo com você. Qualquer dúvida, é só chamar.\n\n{{consultor}}\nPeregrinos Intercâmbio\n{{email_consultor}}', 50),
('Matrícula confirmada', 'Pós-venda',
 'Matrícula confirmada, {{primeiro_nome}}! 🎉',
 E'Olá, {{primeiro_nome}}!\n\nÓtima notícia: a sua matrícula está confirmada! Parabéns por essa conquista.\n\nDaqui para frente vamos te orientar nas próximas etapas da viagem. Se tiver qualquer dúvida no caminho, fale comigo.\n\nObrigado pela confiança!\n\n{{consultor}}\nPeregrinos Intercâmbio\n{{email_consultor}}', 60);
