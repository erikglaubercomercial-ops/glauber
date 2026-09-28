/* ============================================================
   IDIOMA — motor de tradução leve, sem build step. Marque texto
   estático com data-i18n="chave" (ou data-i18n-placeholder /
   data-i18n-title para atributos); texto gerado por JS chama
   t("chave"). Chaves ausentes caem em português. A tela do aluno
   é o público final, mas o seletor fica disponível no sistema
   inteiro (bandeiras: Irlanda = inglês, Brasil = português,
   Espanha = espanhol).
   ============================================================ */

const I18N_LANG_KEY = "crm-vendas-lang";
const I18N_FLAGS = { pt: "🇧🇷", en: "🇮🇪", es: "🇪🇸" };
const I18N_LANG_NAMES = { pt: "Português", en: "English", es: "Español" };

const I18N = {
  pt: {
    "nav.geral": "GERAL", "nav.administracao": "ADMINISTRAÇÃO",
    "nav.dashboard": "Dashboard", "nav.leads": "Leads", "nav.pipeline": "Pipeline",
    "nav.leadsparados": "Leads Parados", "nav.cotacao": "Cotação", "nav.contratos": "Contratos",
    "nav.produtos": "Produtos", "nav.financeiro": "Financeiro", "nav.matriculas": "Matrículas",
    "nav.colaboradores": "Time", "nav.formularios": "Formulários", "nav.templates": "Templates",
    "nav.areaaluno": "Área do Aluno", "nav.usuarios": "Usuários", "nav.sair": "Sair",
    "nav.alunoLoginLink": "Tela de login do aluno",

    "topbar.search": "Buscar...", "topbar.notifications": "Notificações",

    "common.save": "Salvar", "common.cancel": "Cancelar", "common.delete": "Excluir",
    "common.edit": "Editar", "common.close": "Fechar", "common.understood": "Entendi",
    "common.back": "Voltar", "common.send": "Enviar", "common.clearFilters": "Limpar filtros",

    "dash.statNewLeads": "Leads novos (7 dias)", "dash.statOpenDeals": "Negócios em aberto",
    "dash.statConversion": "Taxa de conversão", "dash.statRevenue": "Faturamento (mês)",
    "dash.statReceivable": "A receber pendente", "dash.statEnrollWaiting": "Matrículas aguardando aluno",
    "dash.funnel": "Funil de Vendas", "dash.leadsBySource": "Leads por Origem",
    "dash.revenue6m": "Faturamento (últimos 6 meses)", "dash.ranking": "Ranking de consultores — negócios ganhos no mês",
    "dash.attention": "Atenção necessária", "dash.recentActivity": "Atividade recente",
    "dash.calendar": "Calendário", "dash.agendaToday": "Agenda de hoje", "dash.teamNotice": "Aviso do time",
    "dash.followups": "Follow-ups pendentes", "dash.overdueFinance": "Financeiro vencido",
    "dash.noLeadsYet": "Nenhum lead cadastrado ainda.", "dash.noDealsWonYet": "Nenhum negócio ganho neste mês ainda.",

    "auth.welcomeBack": "Bem-vindo de volta", "auth.signInToCrm": "Entre com sua conta para acessar o CRM.",
    "auth.email": "E-mail", "auth.password": "Senha", "auth.signIn": "Entrar",
    "auth.forgotPassword": "Esqueci minha senha", "auth.forgotInstructions": "Informe seu e-mail para receber o link de redefinição de senha.",
    "auth.sendLink": "Enviar link", "auth.backToLogin": "Voltar para o login", "auth.linkSent": "Link enviado! Confira seu e-mail.",
    "auth.checkingLink": "Verificando link...", "auth.invalidLink": "Link inválido ou expirado",
    "auth.invalidLinkHint": "Peça um novo link de redefinição de senha e tente novamente.",
    "auth.setNewPassword": "Defina sua nova senha", "auth.setNewPasswordHint": "Escolha uma senha nova para acessar sua conta.",
    "auth.newPassword": "Nova senha", "auth.confirmNewPassword": "Confirmar nova senha",
    "auth.saveNewPassword": "Salvar nova senha", "auth.passwordUpdated": "Senha atualizada! Redirecionando para o login...",
    "auth.passwordMinLength": "A senha precisa ter pelo menos 6 caracteres.", "auth.passwordMismatch": "As senhas não coincidem.",
    "auth.saving": "Salvando…", "auth.savePasswordError": "Não foi possível salvar a nova senha. Peça um novo link e tente de novo.",
    "auth.invalidCredentials": "E-mail ou senha inválidos.", "auth.genericSignInError": "Não consegui entrar. Tente novamente.",
    "auth.sendLinkError": "Não foi possível enviar o link. Verifique o e-mail e tente novamente.",
    "auth.sending": "Enviando…", "auth.signingIn": "Entrando…",
    "auth.userDisabled": "Este usuário está desativado. Fale com o administrador.",

    "aluno.title": "Área do Aluno", "aluno.loginSubtitle": "Entre para acompanhar sua jornada de intercâmbio com a Peregrinos.",
    "aluno.noAccess": "Ainda não tem acesso? Fale com seu consultor.",
    "aluno.navPagamentos": "Pagamentos", "aluno.navDocumentos": "Documentos", "aluno.navMensagens": "Mensagens",
    "aluno.navCalendario": "Calendário", "aluno.navIngles": "Aulas de Inglês", "aluno.soon": "Em breve",
    "aluno.hello": "Olá,", "aluno.role": "Aluno(a)",
    "aluno.courseStart": "Início do curso", "aluno.courseEnd": "Término previsto",
    "aluno.daysOfJourney": "de 334 dias na jornada",
    "aluno.statDaysToDeparture": "Dias até o embarque", "aluno.statPaid": "Valor pago",
    "aluno.statPending": "Valor pendente", "aluno.statDocsSent": "Documentos enviados",
    "aluno.payments": "Pagamentos", "aluno.sendReceipt": "+ Enviar comprovante",
    "aluno.confirmed": "Confirmado", "aluno.travelDocs": "Documentos de viagem",
    "aluno.passport": "Passaporte", "aluno.sent": "Enviado", "aluno.viewSentFile": "Ver arquivo enviado",
    "aluno.visa": "Visto de estudante", "aluno.pending": "Pendente", "aluno.noFileSent": "Nenhum arquivo enviado ainda.",
    "aluno.sendFile": "Enviar arquivo", "aluno.talkToTeam": "Fale com nosso time",
    "aluno.yourMessage": "Sua mensagem", "aluno.messagePlaceholder": "Escreva sua mensagem para a equipe Peregrinos...",
    "aluno.sendMessage": "Enviar mensagem", "aluno.legendTask": "Tarefa", "aluno.legendMeeting": "Reunião",
    "aluno.legendNotice": "Aviso", "aluno.upcoming": "Próximos compromissos", "aluno.englishTeaser": "Aulas básicas para quem ainda está no Brasil se preparando para embarcar.",

    "common.loading": "Carregando...", "common.sendMyData": "Enviar meus dados", "common.select": "Selecione", "common.other": "Outro",
    "addr.section": "Endereço", "addr.street": "Rua", "addr.number": "Número", "addr.complement": "Complemento",
    "addr.complementPlaceholder": "Apto, bloco... (opcional)", "addr.neighborhood": "Bairro", "addr.city": "Cidade",
    "addr.state": "Estado", "addr.zip": "CEP",
    "emerg.section": "Contato de emergência", "emerg.name": "Nome", "emerg.relationship": "Parentesco",
    "emerg.relationshipPlaceholder": "Ex: Mãe, cônjuge, irmão...", "emerg.phone": "Telefone",

    "matricula.title": "Complete sua matrícula", "matricula.subtitle": "Confira os dados do seu curso e preencha as informações abaixo.",
    "matricula.notFound": "Não encontramos essa matrícula. Verifique se o link está correto ou fale com seu consultor.",
    "matricula.success": "Dados enviados! Você pode voltar a essa página a qualquer momento para atualizar suas informações.",
    "matricula.sectionDocs": "Contato de emergência e documentos", "matricula.emergencyLabel": "Nome e telefone de um contato de emergência",
    "matricula.emergencyPlaceholder": "Ex: Maria Silva (mãe) — (11) 99999-0000", "matricula.cpf": "CPF",
    "matricula.passportNumber": "Número do passaporte", "matricula.passportPhoto": "Foto do passaporte (página com sua foto)",
    "matricula.sectionAddressBR": "Endereço no Brasil",
    "matricula.summaryName": "Nome", "matricula.summarySchool": "Escola", "matricula.summaryTurno": "Turno",
    "matricula.summaryCourseValue": "Valor do curso", "matricula.summaryArrival": "Chegada", "matricula.summaryClassStart": "Início das aulas",
    "matricula.photoTooBig": "A foto precisa ter até 8MB.", "matricula.photoUploadError": "Não foi possível enviar a foto do passaporte. Tente novamente.",
    "matricula.saveError": "Não foi possível salvar seus dados. Tente novamente em instantes.",

    "colab.title": "Bem-vindo(a) à Peregrinos!", "colab.subtitle": "Preencha seus dados abaixo para completar seu cadastro como colaborador(a).",
    "colab.success": "Dados enviados! Nossa equipe vai concluir seu cadastro em breve.",
    "colab.sectionPersonal": "Dados pessoais", "colab.fullName": "Nome completo *", "colab.birthDate": "Data de nascimento",
    "colab.nationality": "Nacionalidade", "colab.rg": "RG", "colab.maritalStatus": "Estado civil",
    "colab.single": "Solteiro(a)", "colab.married": "Casado(a)", "colab.divorced": "Divorciado(a)", "colab.widowed": "Viúvo(a)",
    "colab.domesticPartnership": "União estável", "colab.phone": "Telefone / WhatsApp", "colab.personalEmail": "E-mail pessoal",
    "colab.sectionPhoto": "Foto", "colab.profilePhoto": "Foto de perfil",
    "colab.fileTooBig": "Cada arquivo precisa ter até 8MB.", "colab.uploadError": "Não foi possível enviar um dos arquivos. Tente novamente.",
    "colab.saveError": "Não foi possível salvar seus dados. Tente novamente em instantes.",

    "form.title": "Formulário", "form.submit": "Enviar", "form.thankYou": "Recebemos suas informações! Em breve alguém da nossa equipe vai entrar em contato.",
    "form.notFound": "Não encontramos esse formulário. Verifique se o link está correto.", "form.sendError": "Não foi possível enviar. Confira os campos e tente novamente.",
    "form.yes": "Sim", "form.no": "Não",

    "contract.title": "Contrato", "contract.readCarefully": "Leia o contrato abaixo com atenção antes de assinar.",
    "contract.alreadySigned": "Este contrato já foi assinado. Se precisar de uma cópia, fale com seu consultor.",
    "contract.notFound": "Não encontramos esse contrato. Verifique se o link está correto ou fale com seu consultor.",
    "contract.signedSuccess": "Contrato assinado com sucesso! Uma cópia foi salva com a equipe Peregrinos.",
    "contract.yourData": "Seus dados", "contract.fullName": "Nome completo *", "contract.fullNamePlaceholder": "Digite seu nome completo",
    "contract.document": "CPF (opcional)", "contract.signature": "Assinatura", "contract.drawSignature": "Desenhe sua assinatura abaixo *",
    "contract.clearSignature": "Limpar assinatura", "contract.agree": "Li e concordo com os termos do contrato acima.",
    "contract.signButton": "Assinar contrato", "contract.pleaseDraw": "Desenhe sua assinatura antes de continuar.",
    "contract.signError": "Não foi possível registrar sua assinatura. Tente novamente em instantes.",
  },

  en: {
    "nav.geral": "GENERAL", "nav.administracao": "ADMINISTRATION",
    "nav.dashboard": "Dashboard", "nav.leads": "Leads", "nav.pipeline": "Pipeline",
    "nav.leadsparados": "Stalled Leads", "nav.cotacao": "Quotes", "nav.contratos": "Contracts",
    "nav.produtos": "Products", "nav.financeiro": "Finance", "nav.matriculas": "Enrollments",
    "nav.colaboradores": "Team", "nav.formularios": "Forms", "nav.templates": "Templates",
    "nav.areaaluno": "Student Area", "nav.usuarios": "Users", "nav.sair": "Sign out",
    "nav.alunoLoginLink": "Student login page",

    "topbar.search": "Search...", "topbar.notifications": "Notifications",

    "common.save": "Save", "common.cancel": "Cancel", "common.delete": "Delete",
    "common.edit": "Edit", "common.close": "Close", "common.understood": "Got it",
    "common.back": "Back", "common.send": "Send", "common.clearFilters": "Clear filters",

    "dash.statNewLeads": "New leads (7 days)", "dash.statOpenDeals": "Open deals",
    "dash.statConversion": "Conversion rate", "dash.statRevenue": "Revenue (month)",
    "dash.statReceivable": "Pending receivables", "dash.statEnrollWaiting": "Enrollments awaiting student",
    "dash.funnel": "Sales Funnel", "dash.leadsBySource": "Leads by Source",
    "dash.revenue6m": "Revenue (last 6 months)", "dash.ranking": "Consultant ranking — deals won this month",
    "dash.attention": "Needs attention", "dash.recentActivity": "Recent activity",
    "dash.calendar": "Calendar", "dash.agendaToday": "Today's agenda", "dash.teamNotice": "Team notice",
    "dash.followups": "Pending follow-ups", "dash.overdueFinance": "Overdue finances",
    "dash.noLeadsYet": "No leads registered yet.", "dash.noDealsWonYet": "No deals won this month yet.",

    "auth.welcomeBack": "Welcome back", "auth.signInToCrm": "Sign in to access the CRM.",
    "auth.email": "Email", "auth.password": "Password", "auth.signIn": "Sign in",
    "auth.forgotPassword": "Forgot my password", "auth.forgotInstructions": "Enter your email to receive the password reset link.",
    "auth.sendLink": "Send link", "auth.backToLogin": "Back to login", "auth.linkSent": "Link sent! Check your email.",
    "auth.checkingLink": "Checking link...", "auth.invalidLink": "Invalid or expired link",
    "auth.invalidLinkHint": "Request a new password reset link and try again.",
    "auth.setNewPassword": "Set your new password", "auth.setNewPasswordHint": "Choose a new password to access your account.",
    "auth.newPassword": "New password", "auth.confirmNewPassword": "Confirm new password",
    "auth.saveNewPassword": "Save new password", "auth.passwordUpdated": "Password updated! Redirecting to login...",
    "auth.passwordMinLength": "Password must be at least 6 characters long.", "auth.passwordMismatch": "Passwords don't match.",
    "auth.saving": "Saving…", "auth.savePasswordError": "Couldn't save the new password. Request a new link and try again.",
    "auth.invalidCredentials": "Invalid email or password.", "auth.genericSignInError": "Couldn't sign in. Please try again.",
    "auth.sendLinkError": "Couldn't send the link. Check the email and try again.",
    "auth.sending": "Sending…", "auth.signingIn": "Signing in…",
    "auth.userDisabled": "This user is disabled. Contact the administrator.",

    "aluno.title": "Student Area", "aluno.loginSubtitle": "Sign in to follow your exchange journey with Peregrinos.",
    "aluno.noAccess": "Don't have access yet? Talk to your consultant.",
    "aluno.navPagamentos": "Payments", "aluno.navDocumentos": "Documents", "aluno.navMensagens": "Messages",
    "aluno.navCalendario": "Calendar", "aluno.navIngles": "English Classes", "aluno.soon": "Coming soon",
    "aluno.hello": "Hello,", "aluno.role": "Student",
    "aluno.courseStart": "Course start", "aluno.courseEnd": "Expected end",
    "aluno.daysOfJourney": "of 334 days in the journey",
    "aluno.statDaysToDeparture": "Days to departure", "aluno.statPaid": "Amount paid",
    "aluno.statPending": "Amount pending", "aluno.statDocsSent": "Documents sent",
    "aluno.payments": "Payments", "aluno.sendReceipt": "+ Send receipt",
    "aluno.confirmed": "Confirmed", "aluno.travelDocs": "Travel documents",
    "aluno.passport": "Passport", "aluno.sent": "Sent", "aluno.viewSentFile": "View sent file",
    "aluno.visa": "Student visa", "aluno.pending": "Pending", "aluno.noFileSent": "No file sent yet.",
    "aluno.sendFile": "Send file", "aluno.talkToTeam": "Talk to our team",
    "aluno.yourMessage": "Your message", "aluno.messagePlaceholder": "Write your message to the Peregrinos team...",
    "aluno.sendMessage": "Send message", "aluno.legendTask": "Task", "aluno.legendMeeting": "Meeting",
    "aluno.legendNotice": "Notice", "aluno.upcoming": "Upcoming events", "aluno.englishTeaser": "Basic classes for those still in Brazil getting ready to travel.",

    "common.loading": "Loading...", "common.sendMyData": "Submit my info", "common.select": "Select", "common.other": "Other",
    "addr.section": "Address", "addr.street": "Street", "addr.number": "Number", "addr.complement": "Complement",
    "addr.complementPlaceholder": "Apt, block... (optional)", "addr.neighborhood": "Neighborhood", "addr.city": "City",
    "addr.state": "State", "addr.zip": "ZIP code",
    "emerg.section": "Emergency contact", "emerg.name": "Name", "emerg.relationship": "Relationship",
    "emerg.relationshipPlaceholder": "E.g.: Mother, spouse, sibling...", "emerg.phone": "Phone",

    "matricula.title": "Complete your enrollment", "matricula.subtitle": "Check your course details and fill in the information below.",
    "matricula.notFound": "We couldn't find this enrollment. Check that the link is correct or talk to your consultant.",
    "matricula.success": "Info submitted! You can come back to this page anytime to update your information.",
    "matricula.sectionDocs": "Emergency contact and documents", "matricula.emergencyLabel": "Name and phone of an emergency contact",
    "matricula.emergencyPlaceholder": "E.g.: Maria Silva (mother) — (11) 99999-0000", "matricula.cpf": "National ID (CPF)",
    "matricula.passportNumber": "Passport number", "matricula.passportPhoto": "Passport photo (photo page)",
    "matricula.sectionAddressBR": "Address in Brazil",
    "matricula.summaryName": "Name", "matricula.summarySchool": "School", "matricula.summaryTurno": "Shift",
    "matricula.summaryCourseValue": "Course value", "matricula.summaryArrival": "Arrival", "matricula.summaryClassStart": "Class start",
    "matricula.photoTooBig": "The photo must be up to 8MB.", "matricula.photoUploadError": "Couldn't upload the passport photo. Please try again.",
    "matricula.saveError": "Couldn't save your info. Please try again shortly.",

    "colab.title": "Welcome to Peregrinos!", "colab.subtitle": "Fill in your info below to complete your registration as a team member.",
    "colab.success": "Info submitted! Our team will finish your registration soon.",
    "colab.sectionPersonal": "Personal info", "colab.fullName": "Full name *", "colab.birthDate": "Date of birth",
    "colab.nationality": "Nationality", "colab.rg": "National ID (RG)", "colab.maritalStatus": "Marital status",
    "colab.single": "Single", "colab.married": "Married", "colab.divorced": "Divorced", "colab.widowed": "Widowed",
    "colab.domesticPartnership": "Domestic partnership", "colab.phone": "Phone / WhatsApp", "colab.personalEmail": "Personal email",
    "colab.sectionPhoto": "Photo", "colab.profilePhoto": "Profile photo",
    "colab.fileTooBig": "Each file must be up to 8MB.", "colab.uploadError": "Couldn't upload one of the files. Please try again.",
    "colab.saveError": "Couldn't save your info. Please try again shortly.",

    "form.title": "Form", "form.submit": "Submit", "form.thankYou": "We've received your info! Someone from our team will reach out soon.",
    "form.notFound": "We couldn't find this form. Check that the link is correct.", "form.sendError": "Couldn't submit. Check the fields and try again.",
    "form.yes": "Yes", "form.no": "No",

    "contract.title": "Contract", "contract.readCarefully": "Please read the contract below carefully before signing.",
    "contract.alreadySigned": "This contract has already been signed. If you need a copy, talk to your consultant.",
    "contract.notFound": "We couldn't find this contract. Check that the link is correct or talk to your consultant.",
    "contract.signedSuccess": "Contract signed successfully! A copy was saved with the Peregrinos team.",
    "contract.yourData": "Your info", "contract.fullName": "Full name *", "contract.fullNamePlaceholder": "Enter your full name",
    "contract.document": "National ID (optional)", "contract.signature": "Signature", "contract.drawSignature": "Draw your signature below *",
    "contract.clearSignature": "Clear signature", "contract.agree": "I have read and agree to the contract terms above.",
    "contract.signButton": "Sign contract", "contract.pleaseDraw": "Draw your signature before continuing.",
    "contract.signError": "Couldn't register your signature. Please try again shortly.",
  },

  es: {
    "nav.geral": "GENERAL", "nav.administracao": "ADMINISTRACIÓN",
    "nav.dashboard": "Panel", "nav.leads": "Leads", "nav.pipeline": "Embudo",
    "nav.leadsparados": "Leads Detenidos", "nav.cotacao": "Cotizaciones", "nav.contratos": "Contratos",
    "nav.produtos": "Productos", "nav.financeiro": "Finanzas", "nav.matriculas": "Matrículas",
    "nav.colaboradores": "Equipo", "nav.formularios": "Formularios", "nav.templates": "Plantillas",
    "nav.areaaluno": "Área del Estudiante", "nav.usuarios": "Usuarios", "nav.sair": "Salir",
    "nav.alunoLoginLink": "Pantalla de acceso del estudiante",

    "topbar.search": "Buscar...", "topbar.notifications": "Notificaciones",

    "common.save": "Guardar", "common.cancel": "Cancelar", "common.delete": "Eliminar",
    "common.edit": "Editar", "common.close": "Cerrar", "common.understood": "Entendido",
    "common.back": "Volver", "common.send": "Enviar", "common.clearFilters": "Limpiar filtros",

    "dash.statNewLeads": "Leads nuevos (7 días)", "dash.statOpenDeals": "Negocios abiertos",
    "dash.statConversion": "Tasa de conversión", "dash.statRevenue": "Facturación (mes)",
    "dash.statReceivable": "Por cobrar pendiente", "dash.statEnrollWaiting": "Matrículas esperando al estudiante",
    "dash.funnel": "Embudo de Ventas", "dash.leadsBySource": "Leads por Origen",
    "dash.revenue6m": "Facturación (últimos 6 meses)", "dash.ranking": "Ranking de consultores — negocios ganados en el mes",
    "dash.attention": "Requiere atención", "dash.recentActivity": "Actividad reciente",
    "dash.calendar": "Calendario", "dash.agendaToday": "Agenda de hoy", "dash.teamNotice": "Aviso del equipo",
    "dash.followups": "Seguimientos pendientes", "dash.overdueFinance": "Finanzas vencidas",
    "dash.noLeadsYet": "Aún no hay leads registrados.", "dash.noDealsWonYet": "Aún no hay negocios ganados este mes.",

    "auth.welcomeBack": "Bienvenido de nuevo", "auth.signInToCrm": "Inicia sesión para acceder al CRM.",
    "auth.email": "Correo electrónico", "auth.password": "Contraseña", "auth.signIn": "Entrar",
    "auth.forgotPassword": "Olvidé mi contraseña", "auth.forgotInstructions": "Indica tu correo para recibir el enlace de restablecimiento.",
    "auth.sendLink": "Enviar enlace", "auth.backToLogin": "Volver al inicio de sesión", "auth.linkSent": "¡Enlace enviado! Revisa tu correo.",
    "auth.checkingLink": "Verificando enlace...", "auth.invalidLink": "Enlace inválido o expirado",
    "auth.invalidLinkHint": "Solicita un nuevo enlace de restablecimiento e inténtalo de nuevo.",
    "auth.setNewPassword": "Define tu nueva contraseña", "auth.setNewPasswordHint": "Elige una nueva contraseña para acceder a tu cuenta.",
    "auth.newPassword": "Nueva contraseña", "auth.confirmNewPassword": "Confirmar nueva contraseña",
    "auth.saveNewPassword": "Guardar nueva contraseña", "auth.passwordUpdated": "¡Contraseña actualizada! Redirigiendo al inicio de sesión...",
    "auth.passwordMinLength": "La contraseña debe tener al menos 6 caracteres.", "auth.passwordMismatch": "Las contraseñas no coinciden.",
    "auth.saving": "Guardando…", "auth.savePasswordError": "No fue posible guardar la nueva contraseña. Solicita un nuevo enlace e inténtalo de nuevo.",
    "auth.invalidCredentials": "Correo o contraseña inválidos.", "auth.genericSignInError": "No fue posible iniciar sesión. Inténtalo de nuevo.",
    "auth.sendLinkError": "No fue posible enviar el enlace. Verifica el correo e inténtalo de nuevo.",
    "auth.sending": "Enviando…", "auth.signingIn": "Entrando…",
    "auth.userDisabled": "Este usuario está desactivado. Habla con el administrador.",

    "aluno.title": "Área del Estudiante", "aluno.loginSubtitle": "Ingresa para seguir tu jornada de intercambio con Peregrinos.",
    "aluno.noAccess": "¿Aún no tienes acceso? Habla con tu consultor.",
    "aluno.navPagamentos": "Pagos", "aluno.navDocumentos": "Documentos", "aluno.navMensagens": "Mensajes",
    "aluno.navCalendario": "Calendario", "aluno.navIngles": "Clases de Inglés", "aluno.soon": "Próximamente",
    "aluno.hello": "Hola,", "aluno.role": "Estudiante",
    "aluno.courseStart": "Inicio del curso", "aluno.courseEnd": "Fin previsto",
    "aluno.daysOfJourney": "de 334 días del viaje",
    "aluno.statDaysToDeparture": "Días para el viaje", "aluno.statPaid": "Monto pagado",
    "aluno.statPending": "Monto pendiente", "aluno.statDocsSent": "Documentos enviados",
    "aluno.payments": "Pagos", "aluno.sendReceipt": "+ Enviar comprobante",
    "aluno.confirmed": "Confirmado", "aluno.travelDocs": "Documentos de viaje",
    "aluno.passport": "Pasaporte", "aluno.sent": "Enviado", "aluno.viewSentFile": "Ver archivo enviado",
    "aluno.visa": "Visa de estudiante", "aluno.pending": "Pendiente", "aluno.noFileSent": "Aún no se ha enviado ningún archivo.",
    "aluno.sendFile": "Enviar archivo", "aluno.talkToTeam": "Habla con nuestro equipo",
    "aluno.yourMessage": "Tu mensaje", "aluno.messagePlaceholder": "Escribe tu mensaje para el equipo de Peregrinos...",
    "aluno.sendMessage": "Enviar mensaje", "aluno.legendTask": "Tarea", "aluno.legendMeeting": "Reunión",
    "aluno.legendNotice": "Aviso", "aluno.upcoming": "Próximas citas", "aluno.englishTeaser": "Clases básicas para quienes aún están en Brasil preparándose para viajar.",

    "common.loading": "Cargando...", "common.sendMyData": "Enviar mis datos", "common.select": "Selecciona", "common.other": "Otro",
    "addr.section": "Dirección", "addr.street": "Calle", "addr.number": "Número", "addr.complement": "Complemento",
    "addr.complementPlaceholder": "Depto, bloque... (opcional)", "addr.neighborhood": "Barrio", "addr.city": "Ciudad",
    "addr.state": "Estado/Provincia", "addr.zip": "Código postal",
    "emerg.section": "Contacto de emergencia", "emerg.name": "Nombre", "emerg.relationship": "Parentesco",
    "emerg.relationshipPlaceholder": "Ej.: madre, cónyuge, hermano/a...", "emerg.phone": "Teléfono",

    "matricula.title": "Completa tu matrícula", "matricula.subtitle": "Revisa los datos de tu curso y completa la información a continuación.",
    "matricula.notFound": "No encontramos esa matrícula. Verifica que el enlace sea correcto o habla con tu consultor.",
    "matricula.success": "¡Datos enviados! Puedes volver a esta página en cualquier momento para actualizar tu información.",
    "matricula.sectionDocs": "Contacto de emergencia y documentos", "matricula.emergencyLabel": "Nombre y teléfono de un contacto de emergencia",
    "matricula.emergencyPlaceholder": "Ej.: María Silva (madre) — (11) 99999-0000", "matricula.cpf": "Documento de identidad (CPF)",
    "matricula.passportNumber": "Número de pasaporte", "matricula.passportPhoto": "Foto del pasaporte (página con tu foto)",
    "matricula.sectionAddressBR": "Dirección en Brasil",
    "matricula.summaryName": "Nombre", "matricula.summarySchool": "Escuela", "matricula.summaryTurno": "Turno",
    "matricula.summaryCourseValue": "Valor del curso", "matricula.summaryArrival": "Llegada", "matricula.summaryClassStart": "Inicio de clases",
    "matricula.photoTooBig": "La foto debe tener hasta 8MB.", "matricula.photoUploadError": "No fue posible enviar la foto del pasaporte. Inténtalo de nuevo.",
    "matricula.saveError": "No fue posible guardar tus datos. Inténtalo de nuevo en unos instantes.",

    "colab.title": "¡Bienvenido(a) a Peregrinos!", "colab.subtitle": "Completa tus datos a continuación para finalizar tu registro como miembro del equipo.",
    "colab.success": "¡Datos enviados! Nuestro equipo completará tu registro pronto.",
    "colab.sectionPersonal": "Datos personales", "colab.fullName": "Nombre completo *", "colab.birthDate": "Fecha de nacimiento",
    "colab.nationality": "Nacionalidad", "colab.rg": "Documento de identidad (RG)", "colab.maritalStatus": "Estado civil",
    "colab.single": "Soltero(a)", "colab.married": "Casado(a)", "colab.divorced": "Divorciado(a)", "colab.widowed": "Viudo(a)",
    "colab.domesticPartnership": "Unión libre", "colab.phone": "Teléfono / WhatsApp", "colab.personalEmail": "Correo personal",
    "colab.sectionPhoto": "Foto", "colab.profilePhoto": "Foto de perfil",
    "colab.fileTooBig": "Cada archivo debe tener hasta 8MB.", "colab.uploadError": "No fue posible enviar uno de los archivos. Inténtalo de nuevo.",
    "colab.saveError": "No fue posible guardar tus datos. Inténtalo de nuevo en unos instantes.",

    "form.title": "Formulario", "form.submit": "Enviar", "form.thankYou": "¡Recibimos tu información! Pronto alguien de nuestro equipo se pondrá en contacto.",
    "form.notFound": "No encontramos ese formulario. Verifica que el enlace sea correcto.", "form.sendError": "No fue posible enviar. Revisa los campos e inténtalo de nuevo.",
    "form.yes": "Sí", "form.no": "No",

    "contract.title": "Contrato", "contract.readCarefully": "Lee el contrato a continuación con atención antes de firmar.",
    "contract.alreadySigned": "Este contrato ya fue firmado. Si necesitas una copia, habla con tu consultor.",
    "contract.notFound": "No encontramos ese contrato. Verifica que el enlace sea correcto o habla con tu consultor.",
    "contract.signedSuccess": "¡Contrato firmado con éxito! Se guardó una copia con el equipo de Peregrinos.",
    "contract.yourData": "Tus datos", "contract.fullName": "Nombre completo *", "contract.fullNamePlaceholder": "Escribe tu nombre completo",
    "contract.document": "Documento de identidad (opcional)", "contract.signature": "Firma", "contract.drawSignature": "Dibuja tu firma abajo *",
    "contract.clearSignature": "Borrar firma", "contract.agree": "Leí y acepto los términos del contrato anterior.",
    "contract.signButton": "Firmar contrato", "contract.pleaseDraw": "Dibuja tu firma antes de continuar.",
    "contract.signError": "No fue posible registrar tu firma. Inténtalo de nuevo en unos instantes.",
  },
};

function getLang() {
  return localStorage.getItem(I18N_LANG_KEY) || "pt";
}

function t(key) {
  const lang = getLang();
  return (I18N[lang] && I18N[lang][key]) || I18N.pt[key] || key;
}

function applyTranslations(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  scope.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  scope.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
}

function setLang(lang) {
  if (!I18N[lang]) return;
  localStorage.setItem(I18N_LANG_KEY, lang);
  applyTranslations();
  document.querySelectorAll(".lang-switcher").forEach(renderLangSwitcherInto);
  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

function renderLangSwitcherInto(el) {
  const current = getLang();
  el.innerHTML = Object.keys(I18N_FLAGS).map(lang => `
    <button type="button" class="lang-flag${lang === current ? " active" : ""}" data-lang="${lang}" title="${I18N_LANG_NAMES[lang]}" aria-label="${I18N_LANG_NAMES[lang]}">${I18N_FLAGS[lang]}</button>
  `).join("");
  el.querySelectorAll(".lang-flag").forEach(btn => {
    btn.addEventListener("click", () => setLang(btn.dataset.lang));
  });
}

function initLangSwitchers() {
  document.querySelectorAll(".lang-switcher").forEach(renderLangSwitcherInto);
  applyTranslations();
}

document.addEventListener("DOMContentLoaded", initLangSwitchers);
