/* ============================================================
   SESSÃO / PERMISSÕES DE NAVEGAÇÃO
   ============================================================ */
let session = null;

function canAccessView(view) {
  if (!session) return false;
  if (view === "dashboard") return true;
  /* telas novas ainda em construção — liberadas pra todo mundo por
     enquanto, sem nenhum conteúdo real por trás; quando ganharem
     funcionalidade de verdade, passam a exigir permissão por função
     como os demais módulos */
  if (view === "formularios" || view === "templates" || view === "areaaluno") return true;
  if (view === "usuarios") return session.role === "ADM";
  if (view === "leadsparados") return session.role === "ADM" || session.role === "Gerente";
  return hasModuleAccess(session.role, view);
}

function renderSessionChip() {
  if (!session) return;
  document.getElementById("session-avatar").textContent = initials(session.name) || "?";
  document.getElementById("session-name").textContent = session.name;
  document.getElementById("session-email").textContent = session.email;
}

document.getElementById("btn-signout").addEventListener("click", async () => {
  await signOut();
  window.location.href = "login.html";
});

/* ============================================================
   SIDEBAR: recolher/expandir
   ============================================================ */
const SIDEBAR_COLLAPSED_KEY = "crm-vendas-sidebar-collapsed";

function initSidebarToggle() {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("sidebar-toggle");
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  sidebar.classList.toggle("collapsed", collapsed);
  toggle.title = collapsed ? "Expandir menu" : "Recolher menu";

  toggle.addEventListener("click", () => {
    const isCollapsed = sidebar.classList.toggle("collapsed");
    toggle.title = isCollapsed ? "Expandir menu" : "Recolher menu";
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isCollapsed ? "1" : "0");
  });
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const VIEW_TITLES = {
  dashboard: "Dashboard",
  leads: "Leads",
  pipeline: "Pipeline",
  leadsparados: "Leads Parados",
  cotacao: "Cotação",
  produtos: "Produtos",
  financeiro: "Financeiro",
  matriculas: "Matrículas",
  colaboradores: "Colaboradores",
  formularios: "Formulários",
  templates: "Templates",
  areaaluno: "Área do Aluno",
  usuarios: "Usuários",
};

function initNavigation() {
  const navItems = document.querySelectorAll(".nav-item[data-view]");
  navItems.forEach(item => {
    const view = item.dataset.view;
    if (!canAccessView(view)) {
      item.style.display = "none";
      return;
    }
    item.style.display = "";
    item.addEventListener("click", () => switchView(view));
  });

  if (session && session.role === "ADM") {
    document.getElementById("nav-label-admin").style.display = "";
    document.getElementById("btn-manage-stages").style.display = "";
  }

  const firstAccessible = ["dashboard", "leads", "pipeline", "cotacao", "produtos", "financeiro", "matriculas", "colaboradores", "usuarios"].find(canAccessView);
  switchView(firstAccessible || "leads");
}

function switchView(view) {
  if (!canAccessView(view)) return;
  closeRowMenu();
  document.querySelectorAll(".nav-item[data-view]").forEach(item => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach(section => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  document.getElementById("view-title").textContent = VIEW_TITLES[view] || "";
  if (view === "dashboard") renderDashboardView();
  if (view === "leadsparados") {
    document.getElementById("subview-stuck-detalhe").classList.remove("active");
    document.getElementById("subview-stuck-overview").classList.add("active");
    renderStuckOverview();
  }
}

function currency(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function uid() {
  return crypto.randomUUID();
}

/* ============================================================
   PIPELINE (kanban) — negócios
   ============================================================ */
let STAGES = [];

function stageById(id) { return STAGES.find(s => s.id === id); }
function isWonStage(id) { const s = stageById(id); return !!(s && s.isWon); }
function isLostStage(id) { const s = stageById(id); return !!(s && s.isLost); }
function isClosedStage(id) { return isWonStage(id) || isLostStage(id); }

/* cor do estágio: azul (início do funil) → vermelho (prestes a fechar),
   Ganho sempre verde, Perdido sempre amarelo — usada no Pipeline e
   sincronizada na tela de Leads */
const STAGE_COLOR_START = { r: 49, g: 103, b: 161 };  // azul Peregrinos
const STAGE_COLOR_END = { r: 239, g: 68, b: 68 };     // vermelho
const STAGE_COLOR_WON = "#16a34a";
const STAGE_COLOR_LOST = "#eab308";

function stageColor(stageId) {
  const stage = stageById(stageId);
  if (!stage) return "#8891a5";
  if (stage.isWon) return STAGE_COLOR_WON;
  if (stage.isLost) return STAGE_COLOR_LOST;
  const openStages = STAGES.filter(s => !s.isWon && !s.isLost);
  const idx = openStages.findIndex(s => s.id === stageId);
  if (idx === -1) return "#8891a5";
  const t = openStages.length <= 1 ? 0 : idx / (openStages.length - 1);
  const r = Math.round(STAGE_COLOR_START.r + (STAGE_COLOR_END.r - STAGE_COLOR_START.r) * t);
  const g = Math.round(STAGE_COLOR_START.g + (STAGE_COLOR_END.g - STAGE_COLOR_START.g) * t);
  const b = Math.round(STAGE_COLOR_START.b + (STAGE_COLOR_END.b - STAGE_COLOR_START.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

async function loadPipelineStages() {
  const { data, error } = await supabase.from("pipeline_stages").select("*").order("position");
  if (error || !data || !data.length) {
    return [
      { id: "lead", label: "Lead", position: 1, isWon: false, isLost: false },
      { id: "contato", label: "Contato Feito", position: 2, isWon: false, isLost: false },
      { id: "proposta", label: "Proposta", position: 3, isWon: false, isLost: false },
      { id: "negociacao", label: "Negociação", position: 4, isWon: false, isLost: false },
      { id: "ganho", label: "Ganho", position: 5, isWon: true, isLost: false },
      { id: "perdido", label: "Perdido", position: 6, isWon: false, isLost: true },
    ];
  }
  return data.map(r => ({ id: r.id, label: r.label, position: r.position, isWon: r.is_won, isLost: r.is_lost }));
}
async function addPipelineStageRemote(stage) {
  const { error } = await supabase.from("pipeline_stages")
    .insert({ id: stage.id, label: stage.label, position: stage.position, is_won: stage.isWon, is_lost: stage.isLost });
  if (error) console.error("Erro ao criar coluna do pipeline:", error);
}
async function renamePipelineStageRemote(id, label) {
  const { error } = await supabase.from("pipeline_stages").update({ label }).eq("id", id);
  if (error) console.error("Erro ao renomear coluna do pipeline:", error);
}
async function deletePipelineStageRemote(id) {
  const { error } = await supabase.from("pipeline_stages").delete().eq("id", id);
  if (error) console.error("Erro ao excluir coluna do pipeline:", error);
}

function dealFromDb(r) {
  return {
    id: r.id, name: r.name, contact: r.contact || "", info: r.info || "",
    value: Number(r.value) || 0, stage: r.stage, notes: r.notes || "",
    leadId: r.lead_id || null, followUpAt: r.follow_up_at || null,
    consultorId: r.consultor_id || null,
    firstInteractionAt: r.first_interaction_at ? new Date(r.first_interaction_at).getTime() : null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    closedAt: r.closed_at ? new Date(r.closed_at).getTime() : null,
  };
}
function dealToDb(d) {
  return {
    id: d.id, name: d.name, contact: d.contact, info: d.info, value: d.value, stage: d.stage, notes: d.notes,
    lead_id: d.leadId || null, follow_up_at: d.followUpAt || null,
    consultor_id: d.leadId ? null : (d.consultorId || null),
    first_interaction_at: d.firstInteractionAt ? new Date(d.firstInteractionAt).toISOString() : null,
    created_at: new Date(d.createdAt).toISOString(),
    closed_at: d.closedAt ? new Date(d.closedAt).toISOString() : null,
  };
}

/* cria automaticamente o card do negócio no Pipeline (1ª coluna) para um lead novo */
function createDealForLead(lead) {
  const firstStage = STAGES[0];
  if (!firstStage) return null;
  const deal = {
    id: uid(),
    name: lead.name,
    contact: lead.phone || lead.email || "",
    info: lead.email || lead.phone || "",
    value: 0,
    stage: firstStage.id,
    notes: "",
    leadId: lead.id,
    followUpAt: null,
    createdAt: Date.now(),
    closedAt: null,
  };
  deals.push(deal);
  return deal;
}

/* clique no botão de WhatsApp de um lead avança o negócio dele para a próxima
   coluna do pipeline — nunca fecha automaticamente (Ganho/Perdido) */
/* registra a data/hora da primeira interação do negócio, a partir do
   primeiro clique no botão de WhatsApp (lista de Leads ou card do
   Pipeline) — não sobrescreve se já tiver sido registrada antes */
async function recordFirstInteraction(deal) {
  if (!deal || deal.firstInteractionAt) return;
  deal.firstInteractionAt = Date.now();
  await saveDeals();
}

function advanceLeadPipelineStage(leadId) {
  const deal = deals.find(d => d.leadId === leadId);
  if (!deal) return;
  recordFirstInteraction(deal);
  if (isClosedStage(deal.stage)) return;
  const idx = STAGES.findIndex(s => s.id === deal.stage);
  if (idx === -1 || idx + 1 >= STAGES.length) return;
  const next = STAGES[idx + 1];
  if (next.isWon || next.isLost) return;
  moveDeal(deal.id, next.id);
}

async function loadDeals() {
  const { data, error } = await supabase.from("deals").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar pipeline:", error); return []; }
  return data.map(dealFromDb);
}
async function saveDeals() {
  const { error } = await supabase.from("deals").upsert(deals.map(dealToDb));
  if (error) console.error("Erro ao salvar pipeline:", error);
}
async function deleteDealRemote(id) {
  const { error } = await supabase.from("deals").delete().eq("id", id);
  if (error) console.error("Erro ao excluir negócio:", error);
}

let deals = [];

const boardEl = document.getElementById("board");
const modalBackdrop = document.getElementById("modal-backdrop");
const dealForm = document.getElementById("deal-form");
const fieldStage = document.getElementById("field-stage");
const btnDelete = document.getElementById("btn-delete");

function renderStageOptions() {
  fieldStage.innerHTML = STAGES.map(s => `<option value="${s.id}">${s.label}</option>`).join("");
}

/* ---- filtro: performance por consultor ---- */
function dealConsultorId(deal) {
  if (deal.leadId) {
    const lead = leads.find(l => l.id === deal.leadId);
    return lead ? lead.consultorId : null;
  }
  return deal.consultorId || null;
}

function renderPipelineFilterOptions() {
  const sel = document.getElementById("pipeline-filter-consultor");
  const current = sel.value;
  if (isOwnLeadsOnly()) {
    sel.style.display = "none";
    return;
  }
  sel.style.display = "";
  const consultants = users.filter(u => u.role === "Consultor").slice().sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">Todos os consultores</option>` + consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  sel.value = current;
}

function getFilteredDeals() {
  let list = deals;
  if (isOwnLeadsOnly()) {
    list = list.filter(d => dealConsultorId(d) === session.id);
  } else {
    const consultorId = document.getElementById("pipeline-filter-consultor").value;
    if (consultorId) list = list.filter(d => dealConsultorId(d) === consultorId);
  }
  return list;
}

document.getElementById("pipeline-filter-consultor").addEventListener("change", () => { renderBoard(); });
document.getElementById("pipeline-filter-clear").addEventListener("click", () => {
  document.getElementById("pipeline-filter-consultor").value = "";
  renderBoard();
});

function renderBoard() {
  boardEl.innerHTML = "";
  const filteredDeals = getFilteredDeals();
  STAGES.forEach(stage => {
    const stageDeals = filteredDeals.filter(d => d.stage === stage.id);
    const totalValue = stageDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    const column = document.createElement("div");
    column.className = "column";
    column.dataset.stage = stage.id;
    column.style.setProperty("--stage-color", stageColor(stage.id));
    column.innerHTML = `
      <div class="column-header">
        <span>${stage.label}</span>
        <span class="column-count">${stageDeals.length}</span>
      </div>
      <div class="column-value">${currency(totalValue)}</div>
      <div class="column-cards" data-stage="${stage.id}"></div>
    `;

    const cardsEl = column.querySelector(".column-cards");
    if (stageDeals.length === 0) {
      cardsEl.innerHTML = `<div class="empty-hint">Arraste um negócio aqui</div>`;
    } else {
      stageDeals.forEach(deal => cardsEl.appendChild(renderCard(deal)));
    }

    cardsEl.addEventListener("dragover", e => { e.preventDefault(); cardsEl.classList.add("drag-over"); });
    cardsEl.addEventListener("dragleave", () => cardsEl.classList.remove("drag-over"));
    cardsEl.addEventListener("drop", e => {
      e.preventDefault();
      cardsEl.classList.remove("drag-over");
      moveDeal(e.dataTransfer.getData("text/plain"), stage.id);
    });

    boardEl.appendChild(column);
  });

  renderPipelineDashboard();
}

const CARD_CALENDAR_ICON_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const CARD_NOTES_ICON_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

function renderCard(deal) {
  const card = document.createElement("div");
  card.className = "card";
  card.draggable = true;
  card.dataset.id = deal.id;
  card.style.setProperty("--stage-color", stageColor(deal.stage));
  const consultorId = dealConsultorId(deal);
  const consultant = consultorId ? users.find(u => u.id === consultorId) : null;
  const lead = deal.leadId ? leads.find(l => l.id === deal.leadId) : null;
  const waDigits = lead ? leadWhatsAppDigits(lead) : null;
  const phoneText = lead ? (lead.phone || "") : (deal.contact || "");
  const emailText = lead ? (lead.email || "") : ((deal.info || "").includes("@") ? deal.info : "");

  const todayIso = new Date().toISOString().slice(0, 10);
  const followUpOverdue = !!(deal.followUpAt && deal.followUpAt <= todayIso);
  const followUpClass = deal.followUpAt ? (followUpOverdue ? "urgent" : "set") : "";
  const followUpTitle = deal.followUpAt ? `Follow-up: ${formatDate(deal.followUpAt)}` : "Marcar follow-up";

  card.innerHTML = `
    <div class="card-name">${escapeHtml(deal.name)}</div>
    <div class="card-meta">${new Date(deal.createdAt).toLocaleDateString("pt-BR")}</div>
    ${phoneText ? `
      <div class="card-contact-row">
        ${waDigits
          ? `<a class="wpp-btn" href="${buildWhatsAppLink(waDigits)}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${WPP_ICON_SVG}</a>`
          : `<span class="wpp-btn disabled" title="Sem WhatsApp configurado">${WPP_ICON_SVG}</span>`}
        <span>${escapeHtml(phoneText)}</span>
      </div>` : ""}
    ${emailText ? `<div class="card-email">${escapeHtml(emailText)}</div>` : ""}
    ${lead && (lead.source || lead.temperature) ? `
      <div class="card-tags">
        ${lead.source ? originBadge(lead.source) : ""}
        ${lead.temperature ? `<span class="badge ${TEMPERATURE_BADGE[lead.temperature] || "badge-neutral"}">${escapeHtml(lead.temperature)}</span>` : ""}
      </div>` : ""}
    ${consultant ? `<div class="card-consultor">${escapeHtml(consultant.name)}</div>` : ""}
    <div class="card-footer">
      <span class="card-value">${deal.value ? currency(deal.value) : "—"}</span>
      <div class="card-actions">
        <button type="button" class="card-action-btn ${followUpClass}" data-act="followup" title="${followUpTitle}">
          ${CARD_CALENDAR_ICON_SVG}${deal.followUpAt ? `<span>${formatDate(deal.followUpAt)}</span>` : ""}
        </button>
        <button type="button" class="card-action-btn ${deal.notes ? "set" : ""}" data-act="notes" title="Notas">${CARD_NOTES_ICON_SVG}</button>
      </div>
    </div>
  `;
  card.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", deal.id);
    requestAnimationFrame(() => card.classList.add("dragging"));
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("click", () => openDealModal(deal.id));

  const wppLink = card.querySelector("a.wpp-btn");
  if (wppLink) wppLink.addEventListener("click", e => {
    e.stopPropagation();
    recordFirstInteraction(deal);
  });
  card.querySelector('[data-act="followup"]').addEventListener("click", e => {
    e.stopPropagation();
    openFollowUpModal(deal.id);
  });
  card.querySelector('[data-act="notes"]').addEventListener("click", e => {
    e.stopPropagation();
    openNotesModal(deal.id);
  });
  return card;
}

/* ---- follow-up rápido do negócio (data), pelo card do Pipeline ---- */
const followUpModalBackdrop = document.getElementById("followup-modal-backdrop");
const followUpForm = document.getElementById("followup-form");
let followUpDealId = null;

function openFollowUpModal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal) return;
  followUpDealId = dealId;
  document.getElementById("followup-field-date").value = deal.followUpAt || "";
  followUpModalBackdrop.classList.add("open");
}
function closeFollowUpModal() { followUpModalBackdrop.classList.remove("open"); }

document.getElementById("followup-modal-close").addEventListener("click", closeFollowUpModal);
document.getElementById("followup-btn-cancel").addEventListener("click", closeFollowUpModal);
followUpModalBackdrop.addEventListener("click", e => { if (e.target === followUpModalBackdrop) closeFollowUpModal(); });

followUpForm.addEventListener("submit", async e => {
  e.preventDefault();
  const deal = deals.find(d => d.id === followUpDealId);
  if (!deal) return;
  deal.followUpAt = document.getElementById("followup-field-date").value || null;
  renderBoard();
  closeFollowUpModal();
  await saveDeals();
});

/* ---- notas rápidas do negócio, pelo card do Pipeline ---- */
const notesModalBackdrop = document.getElementById("notes-modal-backdrop");
const notesForm = document.getElementById("notes-form");
let notesDealId = null;

function openNotesModal(dealId) {
  const deal = deals.find(d => d.id === dealId);
  if (!deal) return;
  notesDealId = dealId;
  document.getElementById("notes-field-text").value = deal.notes || "";
  notesModalBackdrop.classList.add("open");
  document.getElementById("notes-field-text").focus();
}
function closeNotesModal() { notesModalBackdrop.classList.remove("open"); }

document.getElementById("notes-modal-close").addEventListener("click", closeNotesModal);
document.getElementById("notes-btn-cancel").addEventListener("click", closeNotesModal);
notesModalBackdrop.addEventListener("click", e => { if (e.target === notesModalBackdrop) closeNotesModal(); });

notesForm.addEventListener("submit", async e => {
  e.preventDefault();
  const deal = deals.find(d => d.id === notesDealId);
  if (!deal) return;
  deal.notes = document.getElementById("notes-field-text").value.trim();
  renderBoard();
  closeNotesModal();
  await saveDeals();
});

function moveDeal(id, newStage) {
  const deal = deals.find(d => d.id === id);
  if (!deal || deal.stage === newStage) return;
  deal.stage = newStage;
  deal.closedAt = isClosedStage(newStage) ? Date.now() : null;
  saveDeals();
  renderBoard();
  renderLeads();
  if (isWonStage(newStage)) handleDealWon(deal);
}

function renderPipelineDashboard() {
  const scopedDeals = getFilteredDeals();
  const open = scopedDeals.filter(d => !isClosedStage(d.stage));
  const pipelineValue = open.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  const now = new Date();
  const wonThisMonth = scopedDeals.filter(d => {
    if (!isWonStage(d.stage) || !d.closedAt) return false;
    const closed = new Date(d.closedAt);
    return closed.getMonth() === now.getMonth() && closed.getFullYear() === now.getFullYear();
  });
  const wonValue = wonThisMonth.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  const closed = scopedDeals.filter(d => isClosedStage(d.stage));
  const conversion = closed.length === 0 ? 0 : Math.round((scopedDeals.filter(d => isWonStage(d.stage)).length / closed.length) * 100);

  document.getElementById("stat-open").textContent = open.length;
  document.getElementById("stat-pipeline-value").textContent = currency(pipelineValue);
  document.getElementById("stat-won").textContent = currency(wonValue);
  document.getElementById("stat-conversion").textContent = `${conversion}%`;
}

function openDealModal(id) {
  dealForm.reset();
  renderStageOptions();
  if (id) {
    const deal = deals.find(d => d.id === id);
    const lead = deal.leadId ? leads.find(l => l.id === deal.leadId) : null;
    const consultorId = dealConsultorId(deal);
    const consultant = consultorId ? users.find(u => u.id === consultorId) : null;
    document.getElementById("modal-title").textContent = "Editar negócio";
    document.getElementById("deal-id").value = deal.id;
    document.getElementById("field-name").value = deal.name;
    document.getElementById("field-source").value = (lead && lead.source) || "—";
    document.getElementById("field-consultor-display").value = (consultant && consultant.name) || "—";
    document.getElementById("field-contact").value = deal.contact || "";
    document.getElementById("field-info").value = deal.info || "";
    document.getElementById("field-first-interaction").value = deal.firstInteractionAt
      ? new Date(deal.firstInteractionAt).toLocaleString("pt-BR")
      : "Ainda sem interação registrada";
    document.getElementById("field-stage").value = deal.stage;
    document.getElementById("field-notes").value = deal.notes || "";
    btnDelete.style.display = "inline-block";
  } else {
    document.getElementById("modal-title").textContent = "Novo negócio";
    document.getElementById("deal-id").value = "";
    document.getElementById("field-source").value = "—";
    document.getElementById("field-consultor-display").value = "—";
    document.getElementById("field-first-interaction").value = "Ainda sem interação registrada";
    document.getElementById("field-stage").value = STAGES[0] ? STAGES[0].id : "";
    btnDelete.style.display = "none";
  }
  modalBackdrop.classList.add("open");
  document.getElementById("field-name").focus();
}

function closeDealModal() { modalBackdrop.classList.remove("open"); }

document.getElementById("btn-new").addEventListener("click", () => openDealModal(null));
document.getElementById("modal-close").addEventListener("click", closeDealModal);
document.getElementById("btn-cancel").addEventListener("click", closeDealModal);
modalBackdrop.addEventListener("click", e => { if (e.target === modalBackdrop) closeDealModal(); });

dealForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("deal-id").value;
  const stage = document.getElementById("field-stage").value;
  const data = {
    name: document.getElementById("field-name").value.trim(),
    contact: document.getElementById("field-contact").value.trim(),
    info: document.getElementById("field-info").value.trim(),
    notes: document.getElementById("field-notes").value.trim(),
  };

  let deal;
  if (id) {
    deal = deals.find(d => d.id === id);
    Object.assign(deal, data);
  } else {
    deal = {
      id: uid(), ...data, value: 0, stage, createdAt: Date.now(), closedAt: isClosedStage(stage) ? Date.now() : null,
      consultorId: isOwnLeadsOnly() ? session.id : null,
    };
    deals.push(deal);
  }

  renderBoard();
  renderLeads();
  closeDealModal();
  await saveDeals();
  if (isWonStage(deal.stage)) handleDealWon(deal);
});

btnDelete.addEventListener("click", async () => {
  const id = document.getElementById("deal-id").value;
  if (!id) return;
  if (!confirm("Excluir este negócio? Essa ação não pode ser desfeita.")) return;
  deals = deals.filter(d => d.id !== id);
  renderBoard();
  closeDealModal();
  await deleteDealRemote(id);
});

/* ============================================================
   GERENCIAR COLUNAS DO PIPELINE (somente ADM)
   ============================================================ */
const stagesModalBackdrop = document.getElementById("stages-modal-backdrop");
const stagesListEl = document.getElementById("stages-list");
const stagesNewInput = document.getElementById("stages-new-input");

function stageUsageCount(id) {
  return deals.filter(d => d.stage === id).length;
}

function renderStagesList() {
  stagesListEl.innerHTML = STAGES.map(s => `
    <div class="source-row">
      <input type="text" value="${escapeHtml(s.label)}" data-id="${s.id}">
      <span class="source-usage">${stageUsageCount(s.id)} negócio(s)</span>
      <button type="button" class="btn btn-icon" data-act="del" data-id="${s.id}" title="Excluir coluna" ${(s.isWon || s.isLost) ? "disabled" : ""}>&times;</button>
    </div>`).join("");
}

function openStagesModal() {
  renderStagesList();
  stagesNewInput.value = "";
  stagesModalBackdrop.classList.add("open");
}
function closeStagesModal() { stagesModalBackdrop.classList.remove("open"); }

document.getElementById("btn-manage-stages").addEventListener("click", openStagesModal);
document.getElementById("stages-modal-close").addEventListener("click", closeStagesModal);
document.getElementById("stages-btn-done").addEventListener("click", closeStagesModal);
stagesModalBackdrop.addEventListener("click", e => { if (e.target === stagesModalBackdrop) closeStagesModal(); });

stagesListEl.addEventListener("change", async e => {
  const input = e.target.closest('input[type="text"]');
  if (!input) return;
  const stage = STAGES.find(s => s.id === input.dataset.id);
  const newLabel = input.value.trim();
  if (!newLabel) { input.value = stage.label; return; }
  if (newLabel === stage.label) return;
  stage.label = newLabel;
  renderStagesList();
  renderStageOptions();
  renderBoard();
  await renamePipelineStageRemote(stage.id, newLabel);
});

stagesListEl.addEventListener("click", async e => {
  const btn = e.target.closest('button[data-act="del"]');
  if (!btn || btn.disabled) return;
  const stage = STAGES.find(s => s.id === btn.dataset.id);
  const count = stageUsageCount(stage.id);
  if (count > 0) {
    alert(`Mova os ${count} negócio(s) dessa coluna para outra antes de excluí-la.`);
    return;
  }
  if (STAGES.length <= 1) {
    alert("Mantenha ao menos uma coluna no pipeline.");
    return;
  }
  if (!confirm(`Excluir a coluna "${stage.label}"?`)) return;
  STAGES = STAGES.filter(s => s.id !== stage.id);
  renderStagesList();
  renderStageOptions();
  renderBoard();
  await deletePipelineStageRemote(stage.id);
});

async function addNewStage() {
  const label = stagesNewInput.value.trim();
  if (!label) return;
  const duplicate = STAGES.some(s => s.label.toLowerCase() === label.toLowerCase());
  if (duplicate) { alert("Já existe uma coluna com esse nome."); return; }
  const maxPos = STAGES.reduce((m, s) => Math.max(m, s.position), 0);
  const stage = { id: uid(), label, position: maxPos + 1, isWon: false, isLost: false };
  STAGES.push(stage);
  stagesNewInput.value = "";
  renderStagesList();
  renderStageOptions();
  renderBoard();
  stagesNewInput.focus();
  await addPipelineStageRemote(stage);
}
document.getElementById("stages-add-btn").addEventListener("click", addNewStage);
stagesNewInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addNewStage(); }
});

/* ============================================================
   LEADS
   ============================================================ */
const CATEGORIES = ["Intercâmbio de Idiomas", "High School", "Au Pair", "Work and Travel", "Graduação/Pós no Exterior", "Vistos e Documentação", "Outro"];
const TEMPERATURES = ["Quente", "Morno", "Frio"];

async function loadSources() {
  const { data, error } = await supabase.from("lead_sources").select("name").order("ordem");
  if (error || !data || !data.length) return ["Indicação", "Site", "Redes Sociais", "Anúncio", "Evento", "Outro"];
  return data.map(r => r.name);
}
async function addSourceRemote(name) {
  const { error } = await supabase.from("lead_sources").insert({ name, ordem: SOURCES.length + 1 });
  if (error) console.error("Erro ao adicionar origem:", error);
}
async function renameSourceRemote(oldName, newName) {
  const { error } = await supabase.from("lead_sources").update({ name: newName }).eq("name", oldName);
  if (error) console.error("Erro ao renomear origem:", error);
}
async function deleteSourceRemote(name) {
  const { error } = await supabase.from("lead_sources").delete().eq("name", name);
  if (error) console.error("Erro ao excluir origem:", error);
}

let SOURCES = [];

const LEAD_STATUS_BADGE = {
  "Novo": "badge-neutral",
  "Em contato": "badge-warn",
  "Qualificado": "badge-good",
  "Descartado": "badge-danger",
};
const TEMPERATURE_BADGE = {
  "Quente": "badge-danger",
  "Morno": "badge-warn",
  "Frio": "badge-cold",
};
const WPP_ICON_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
const CELL_COPY_ICON_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

/* ---- ícone + cor por origem do lead — reconhece as origens mais comuns
   (por trecho do nome, tolera variações/erros de digitação) e cai num
   ícone genérico com cor determinística para qualquer origem customizada
   que o ADM cadastrar em "Gerenciar origens" ---- */
const ORIGIN_STYLES = [
  { match: ["instagram", "insta"], color: "#E1306C",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/></svg>` },
  { match: ["facebook", "facebo", "face"], color: "#1877F2",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h-2a4 4 0 0 0-4 4v2H7v4h2v6h4v-6h3l1-4h-4V8a1 1 0 0 1 1-1h3V4z"/></svg>` },
  { match: ["tiktok", "tik tok"], color: "#111827",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l8 3"/><circle cx="6" cy="18" r="3"/></svg>` },
  { match: ["whatsapp"], color: "#1fa855", icon: WPP_ICON_SVG },
  { match: ["linkedin"], color: "#0A66C2",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="8" y1="11" x2="8" y2="16"/><circle cx="8" cy="7.5" r="0.6" fill="currentColor" stroke="none"/><path d="M12 16v-3.5a1.8 1.8 0 0 1 3.6 0V16"/></svg>` },
  { match: ["google", "adwords"], color: "#EA4335",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 12h7"/><path d="M12 3a9 9 0 0 1 6.4 15.4"/></svg>` },
  { match: ["indicacao", "indicação", "referral"], color: "#8B5CF6",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="3"/><path d="M22 19v-1a4 4 0 0 0-3-3.8"/><path d="M16 3.2a4 4 0 0 1 0 7.6"/></svg>` },
  { match: ["anuncio", "anúncio", "ads", "ad"], color: "#F59E0B",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a2 2 0 0 0 2 2h1l4 4V5L6 9H5a2 2 0 0 0-2 2z"/><path d="M17.5 8.5a5 5 0 0 1 0 7"/><path d="M20.5 6a9 9 0 0 1 0 12"/></svg>` },
  { match: ["evento", "event", "feira"], color: "#10B981",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` },
  { match: ["redes sociais", "social"], color: "#EC4899",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg>` },
  { match: ["email", "e-mail"], color: "#6366F1",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>` },
  { match: ["site", "website", "web"], color: "#0EA5E9",
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></svg>` },
];
const ORIGIN_ICON_FALLBACK = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 12.6 12 21l-9-9 8.6-8.6a2 2 0 0 1 1.4-.6H20a1 1 0 0 1 1 1v6.6a2 2 0 0 1-.4 1.4z"/><circle cx="16.5" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>`;

function originStyle(source) {
  const norm = normalizeImportStr(source || "");
  const found = ORIGIN_STYLES.find(o => o.match.some(m => norm.includes(m)));
  if (found) return found;
  let hash = 0;
  for (let i = 0; i < norm.length; i++) hash = (hash * 31 + norm.charCodeAt(i)) >>> 0;
  return { color: DASH_PALETTE[hash % DASH_PALETTE.length], icon: ORIGIN_ICON_FALLBACK };
}

function originBadge(source) {
  if (!source) return "—";
  const style = originStyle(source);
  return `<span class="origin-badge" style="--origin-color:${style.color}">${style.icon}${escapeHtml(source)}</span>`;
}

/* ---- nacionalidade do lead: bandeira + DDI, usados para montar o
   número completo do WhatsApp (DDI + DDD + número) ---- */
const COUNTRIES = [
  { code: "BR", name: "Brasil", ddi: "55", flag: "🇧🇷" },
  { code: "PT", name: "Portugal", ddi: "351", flag: "🇵🇹" },
  { code: "IE", name: "Irlanda", ddi: "353", flag: "🇮🇪" },
  { code: "US", name: "Estados Unidos", ddi: "1", flag: "🇺🇸" },
  { code: "CA", name: "Canadá", ddi: "1", flag: "🇨🇦" },
  { code: "GB", name: "Reino Unido", ddi: "44", flag: "🇬🇧" },
  { code: "AU", name: "Austrália", ddi: "61", flag: "🇦🇺" },
  { code: "NZ", name: "Nova Zelândia", ddi: "64", flag: "🇳🇿" },
  { code: "ES", name: "Espanha", ddi: "34", flag: "🇪🇸" },
  { code: "FR", name: "França", ddi: "33", flag: "🇫🇷" },
  { code: "DE", name: "Alemanha", ddi: "49", flag: "🇩🇪" },
  { code: "IT", name: "Itália", ddi: "39", flag: "🇮🇹" },
  { code: "NL", name: "Holanda", ddi: "31", flag: "🇳🇱" },
  { code: "CH", name: "Suíça", ddi: "41", flag: "🇨🇭" },
  { code: "MT", name: "Malta", ddi: "356", flag: "🇲🇹" },
  { code: "AR", name: "Argentina", ddi: "54", flag: "🇦🇷" },
  { code: "CL", name: "Chile", ddi: "56", flag: "🇨🇱" },
  { code: "CO", name: "Colômbia", ddi: "57", flag: "🇨🇴" },
  { code: "UY", name: "Uruguai", ddi: "598", flag: "🇺🇾" },
  { code: "PY", name: "Paraguai", ddi: "595", flag: "🇵🇾" },
  { code: "PE", name: "Peru", ddi: "51", flag: "🇵🇪" },
  { code: "MX", name: "México", ddi: "52", flag: "🇲🇽" },
  { code: "JP", name: "Japão", ddi: "81", flag: "🇯🇵" },
  { code: "CN", name: "China", ddi: "86", flag: "🇨🇳" },
  { code: "AO", name: "Angola", ddi: "244", flag: "🇦🇴" },
  { code: "MZ", name: "Moçambique", ddi: "258", flag: "🇲🇿" },
];
function countryByCode(code) { return COUNTRIES.find(c => c.code === code) || COUNTRIES[0]; }

function renderLeadCountryOptions(selectEl) {
  selectEl.innerHTML = COUNTRIES.map(c => `<option value="${c.code}">${c.flag} ${c.name} (+${c.ddi})</option>`).join("");
}

/* separa um telefone em texto livre (import de CSV / dados antigos)
   em DDD + número, assumindo formato brasileiro — mesma suposição
   que o botão de WhatsApp já fazia antes de existir o campo país */
function splitBrazilianPhone(raw) {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) {
    return { ddd: digits.slice(0, 2), number: digits.slice(2) };
  }
  return { ddd: "", number: "" };
}

/* dígitos completos (DDI+DDD+número) prontos pro link do WhatsApp —
   null quando faltar país, DDD ou número (bloqueia o botão) */
function leadWhatsAppDigits(lead) {
  const ddd = (lead.phoneDdd || "").replace(/\D/g, "");
  const number = (lead.phoneNumber || "").replace(/\D/g, "");
  if (!ddd || !number) return null;
  const country = countryByCode(lead.countryCode || "BR");
  return `${country.ddi}${ddd}${number}`;
}

function leadFromDb(r) {
  return {
    id: r.id, name: r.name, company: r.company || "", phone: r.phone || "", email: r.email || "",
    countryCode: r.country_code || "BR", phoneDdd: r.phone_ddd || "", phoneNumber: r.phone_number || "",
    source: r.source, category: r.category, status: r.status, temperature: r.temperature,
    consultorId: r.consultor_id, active: r.active, notes: r.notes || "",
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function leadToDb(l) {
  return {
    id: l.id, name: l.name, company: l.company, phone: l.phone, email: l.email,
    country_code: l.countryCode || "BR", phone_ddd: l.phoneDdd || "", phone_number: l.phoneNumber || "",
    source: l.source, category: l.category, status: l.status, temperature: l.temperature,
    consultor_id: l.consultorId || null, active: l.active, notes: l.notes || "",
    created_at: new Date(l.createdAt).toISOString(),
  };
}

async function loadLeads() {
  const { data, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar leads:", error); return []; }
  return data.map(leadFromDb);
}
async function saveLeads() {
  const { error } = await supabase.from("leads").upsert(leads.map(leadToDb));
  if (error) {
    console.error("Erro ao salvar leads:", error);
    if (error.code === "23505") {
      alert("Não foi possível salvar: já existe um lead com esse e-mail cadastrado. Atualize a página (F5) e tente novamente.");
    }
  }
}
async function deleteLeadsRemote(ids) {
  const { error } = await supabase.from("leads").delete().in("id", ids);
  if (error) console.error("Erro ao excluir lead(s):", error);
}

let leads = [];
let selectedLeadIds = new Set();
let quotesClientFilter = null;
let quotesClientFilterLeadId = null;
let openRowMenuEl = null;

const leadModalBackdrop = document.getElementById("lead-modal-backdrop");
const leadForm = document.getElementById("lead-form");
const leadBtnDelete = document.getElementById("lead-btn-delete");
const leadsTbody = document.getElementById("leads-tbody");
const leadsEmpty = document.getElementById("leads-empty");

function buildWhatsAppLink(digits) {
  return `https://wa.me/${digits}`;
}

function renderLeadFormOptions(currentSource) {
  document.getElementById("lead-field-category").innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
  const sourceOptions = SOURCES.slice();
  if (currentSource && !sourceOptions.includes(currentSource)) sourceOptions.push(currentSource);
  document.getElementById("lead-field-source").innerHTML = sourceOptions.map(s => `<option value="${s}">${s}</option>`).join("");
  document.getElementById("lead-field-temperature").innerHTML = TEMPERATURES.map(t => `<option value="${t}">${t}</option>`).join("");
}

function isOwnLeadsOnly() {
  return !!(session && session.role === "Consultor");
}

/* só ADM e Gerente podem alterar a origem de um lead já cadastrado —
   qualquer função pode definir a origem na hora de criar o lead */
function canEditLeadSource() {
  return !!(session && (session.role === "ADM" || session.role === "Gerente"));
}

function renderLeadFilterOptions() {
  const categorySel = document.getElementById("filter-category");
  const sourceSel = document.getElementById("filter-source");
  const consultorSel = document.getElementById("filter-consultor");

  categorySel.innerHTML = `<option value="">Categoria (todas)</option>` + CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
  sourceSel.innerHTML = `<option value="">Origem (todas)</option>` + SOURCES.map(s => `<option value="${s}">${s}</option>`).join("");

  if (isOwnLeadsOnly()) {
    consultorSel.style.display = "none";
  } else {
    const consultants = users.filter(u => u.role === "Consultor");
    consultorSel.innerHTML = `<option value="">Consultor (todos)</option>` + consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  }

  [categorySel, sourceSel, consultorSel].forEach(sel => sel.addEventListener("change", renderLeads));
  document.getElementById("filter-date-from").addEventListener("change", renderLeads);
  document.getElementById("filter-date-to").addEventListener("change", renderLeads);
  document.getElementById("filter-show-inactive").addEventListener("change", renderLeads);
}

document.getElementById("filter-clear").addEventListener("click", () => {
  document.getElementById("filter-category").value = "";
  document.getElementById("filter-source").value = "";
  document.getElementById("filter-consultor").value = "";
  document.getElementById("filter-date-from").value = "";
  document.getElementById("filter-date-to").value = "";
  document.getElementById("filter-show-inactive").checked = false;
  clearLeadsSearch();
  renderLeads();
});

/* ---- busca de lead na própria barra de filtros: digitar mostra um
   dropdown por nome/e-mail; clicar num resultado deixa só aquele
   lead na lista (até limpar os filtros) ---- */
let leadsSearchSelectedId = null;
const leadsSearchInput = document.getElementById("leads-search-input");
const leadsSearchResults = document.getElementById("leads-search-results");

function visibleLeadsBase() {
  const showInactive = document.getElementById("filter-show-inactive").checked;
  const ownOnly = isOwnLeadsOnly();
  return leads.filter(l => {
    if (ownOnly && l.consultorId !== session.id) return false;
    if (!showInactive && l.active === false) return false;
    return true;
  });
}

function renderLeadsSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) { leadsSearchResults.classList.remove("open"); leadsSearchResults.innerHTML = ""; return; }
  const matches = visibleLeadsBase().filter(l =>
    (l.name && l.name.toLowerCase().includes(q)) || (l.email && l.email.toLowerCase().includes(q))
  ).slice(0, 8);
  leadsSearchResults.innerHTML = matches.length
    ? matches.map(l => `
      <div class="enr-lead-result-item" data-id="${l.id}">
        <div>${escapeHtml(l.name)}</div>
        <div class="sub">${escapeHtml(l.email || l.phone || "sem contato")}</div>
      </div>`).join("")
    : `<div class="enr-lead-result-empty">Nenhum lead encontrado</div>`;
  leadsSearchResults.classList.add("open");
}

function clearLeadsSearch() {
  leadsSearchSelectedId = null;
  leadsSearchInput.value = "";
  leadsSearchResults.classList.remove("open");
  leadsSearchResults.innerHTML = "";
}

leadsSearchInput.addEventListener("input", () => {
  leadsSearchSelectedId = null;
  renderLeadsSearchResults(leadsSearchInput.value);
});
leadsSearchInput.addEventListener("focus", () => {
  if (leadsSearchInput.value.trim() && !leadsSearchSelectedId) renderLeadsSearchResults(leadsSearchInput.value);
});
leadsSearchInput.addEventListener("blur", () => {
  setTimeout(() => leadsSearchResults.classList.remove("open"), 150);
});
leadsSearchResults.addEventListener("mousedown", e => {
  const item = e.target.closest(".enr-lead-result-item[data-id]");
  if (!item) return;
  const lead = leads.find(l => l.id === item.dataset.id);
  if (!lead) return;
  leadsSearchSelectedId = lead.id;
  leadsSearchInput.value = lead.name;
  leadsSearchResults.classList.remove("open");
  renderLeads();
});

function getFilteredLeads() {
  const base = visibleLeadsBase();
  if (leadsSearchSelectedId) return base.filter(l => l.id === leadsSearchSelectedId);

  const category = document.getElementById("filter-category").value;
  const source = document.getElementById("filter-source").value;
  const consultorId = document.getElementById("filter-consultor").value;
  const dateFrom = document.getElementById("filter-date-from").value;
  const dateTo = document.getElementById("filter-date-to").value;

  return base.filter(l => {
    if (category && l.category !== category) return false;
    if (source && l.source !== source) return false;
    if (consultorId && l.consultorId !== consultorId) return false;
    if (dateFrom && l.createdAt < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
    if (dateTo && l.createdAt > new Date(`${dateTo}T23:59:59`).getTime()) return false;
    return true;
  });
}

function renderLeads() {
  const filtered = getFilteredLeads();
  leadsTbody.innerHTML = "";
  leadsEmpty.style.display = filtered.length === 0 ? "block" : "none";

  filtered.slice().sort((a, b) => b.createdAt - a.createdAt).forEach(lead => {
    const tr = document.createElement("tr");
    if (lead.active === false) tr.className = "row-inactive";
    const waDigits = leadWhatsAppDigits(lead);
    const consultant = users.find(u => u.id === lead.consultorId);
    const linkedDeal = deals.find(d => d.leadId === lead.id);
    tr.style.setProperty("--row-stage-color", linkedDeal ? stageColor(linkedDeal.stage) : "transparent");

    tr.innerHTML = `
      <td class="cell-check"><input type="checkbox" class="row-checkbox" data-id="${lead.id}" ${selectedLeadIds.has(lead.id) ? "checked" : ""}></td>
      <td class="cell-primary">
        <span class="cell-name-row">
          <span>${escapeHtml(lead.name)}</span>
          ${waDigits
            ? `<a class="wpp-btn" href="${buildWhatsAppLink(waDigits)}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${WPP_ICON_SVG}</a>`
            : `<span class="wpp-btn disabled" title="Preencha país, DDD e número do lead para liberar o WhatsApp">${WPP_ICON_SVG}</span>`}
          ${lead.active === false ? '<span class="badge badge-neutral">Inativo</span>' : ""}
        </span>
        ${lead.company ? `<div class="cell-sub">${escapeHtml(lead.company)}</div>` : ""}
        ${lead.email ? `
          <div class="cell-email-row">
            <span>${escapeHtml(lead.email)}</span>
            <button type="button" class="cell-copy-btn" data-copy="${escapeHtml(lead.email)}" title="Copiar e-mail">${CELL_COPY_ICON_SVG}</button>
          </div>` : ""}
        <div class="cell-temp-row"><span class="badge ${TEMPERATURE_BADGE[lead.temperature] || "badge-neutral"}">${escapeHtml(lead.temperature || "—")}</span></div>
      </td>
      <td class="cell-muted">${consultant ? escapeHtml(consultant.name) : "—"}</td>
      <td><span class="badge ${LEAD_STATUS_BADGE[lead.status] || "badge-neutral"}">${escapeHtml(lead.status)}</span></td>
      <td class="cell-muted">${escapeHtml(lead.category || "—")}</td>
      <td class="cell-muted">${originBadge(lead.source)}</td>
      <td class="cell-actions"><button type="button" class="btn-icon row-menu-trigger" data-id="${lead.id}">⋮</button></td>
    `;

    const copyBtn = tr.querySelector(".cell-copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async e => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(copyBtn.dataset.copy);
          copyBtn.classList.add("copied");
          setTimeout(() => copyBtn.classList.remove("copied"), 1200);
        } catch {
          prompt("Copie o e-mail abaixo:", copyBtn.dataset.copy);
        }
      });
    }

    const checkbox = tr.querySelector(".row-checkbox");
    checkbox.addEventListener("click", e => e.stopPropagation());
    checkbox.addEventListener("change", e => {
      if (e.target.checked) selectedLeadIds.add(lead.id);
      else selectedLeadIds.delete(lead.id);
      updateBulkBar();
      updateSelectAllState(filtered);
    });

    tr.querySelector(".row-menu-trigger").addEventListener("click", e => {
      e.stopPropagation();
      toggleRowMenu(lead, e.currentTarget);
    });

    const wppLink = tr.querySelector("a.wpp-btn");
    if (wppLink) {
      wppLink.addEventListener("click", () => advanceLeadPipelineStage(lead.id));
    }

    tr.addEventListener("click", e => {
      if (e.target.closest(".wpp-btn")) return;
      openLeadModal(lead.id);
    });
    leadsTbody.appendChild(tr);
  });

  updateSelectAllState(filtered);
  updateBulkBar();
  renderLeadsDashboard();
}

function renderLeadsDashboard() {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86400000;
  const ownOnly = isOwnLeadsOnly();
  const activeLeads = leads.filter(l => l.active !== false && (!ownOnly || l.consultorId === session.id));
  document.getElementById("leads-stat-total").textContent = activeLeads.length;
  document.getElementById("leads-stat-new").textContent = activeLeads.filter(l => l.createdAt >= sevenDaysAgo).length;
  document.getElementById("leads-stat-qualified").textContent = activeLeads.filter(l => l.status === "Qualificado").length;
}

/* ---- seleção em massa ---- */
function updateSelectAllState(filteredLeads) {
  const cb = document.getElementById("leads-select-all");
  if (filteredLeads.length === 0) { cb.checked = false; cb.indeterminate = false; return; }
  const selectedCount = filteredLeads.filter(l => selectedLeadIds.has(l.id)).length;
  cb.checked = selectedCount === filteredLeads.length;
  cb.indeterminate = selectedCount > 0 && selectedCount < filteredLeads.length;
}

document.getElementById("leads-select-all").addEventListener("change", e => {
  const filtered = getFilteredLeads();
  if (e.target.checked) filtered.forEach(l => selectedLeadIds.add(l.id));
  else filtered.forEach(l => selectedLeadIds.delete(l.id));
  renderLeads();
});

function updateBulkBar() {
  const bar = document.getElementById("leads-bulk-bar");
  const count = selectedLeadIds.size;
  document.getElementById("leads-bulk-count").textContent = `${count} selecionado(s)`;
  bar.style.display = count > 0 ? "flex" : "none";
}

document.getElementById("leads-bulk-clear").addEventListener("click", () => {
  selectedLeadIds.clear();
  renderLeads();
});

/* ---- menu de 3 pontinhos das ações em massa (mesmo padrão do menu de linha) ---- */
let openBulkMenuEl = null;
function closeBulkMenu() {
  if (openBulkMenuEl) {
    openBulkMenuEl.remove();
    openBulkMenuEl = null;
  }
}

function toggleBulkMenu(triggerEl) {
  if (openBulkMenuEl) { closeBulkMenu(); return; }
  closeRowMenu();
  if (selectedLeadIds.size === 0) return;

  const ids = Array.from(selectedLeadIds);
  const rect = triggerEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "floating-menu";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - 190)}px`;
  menu.innerHTML = `
    <button type="button" class="row-menu-item" data-action="assign">Atribuir consultor</button>
    <button type="button" class="row-menu-item" data-action="temperature">Mudar temperatura</button>
    ${canEditLeadSource() ? '<button type="button" class="row-menu-item" data-action="source">Mudar origem</button>' : ""}
    <div class="row-menu-divider"></div>
    <button type="button" class="row-menu-item" data-action="deactivate">Desativar leads</button>
    <button type="button" class="row-menu-item row-menu-item-danger" data-action="delete">Excluir leads</button>
  `;
  document.body.appendChild(menu);
  openBulkMenuEl = menu;

  menu.querySelector('[data-action="assign"]').addEventListener("click", () => {
    closeBulkMenu();
    openAssignModal(ids);
  });
  menu.querySelector('[data-action="temperature"]').addEventListener("click", () => {
    closeBulkMenu();
    openQuickFieldModal(ids, "temperature");
  });
  const sourceBtn = menu.querySelector('[data-action="source"]');
  if (sourceBtn) sourceBtn.addEventListener("click", () => {
    closeBulkMenu();
    openQuickFieldModal(ids, "source");
  });
  menu.querySelector('[data-action="deactivate"]').addEventListener("click", async () => {
    closeBulkMenu();
    leads.forEach(l => { if (selectedLeadIds.has(l.id)) l.active = false; });
    selectedLeadIds.clear();
    renderLeads();
    await saveLeads();
  });
  menu.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    closeBulkMenu();
    if (!confirm(`Excluir ${ids.length} lead(s) selecionado(s)? Essa ação não pode ser desfeita.`)) return;
    leads = leads.filter(l => !ids.includes(l.id));
    selectedLeadIds.clear();
    renderLeads();
    await deleteLeadsRemote(ids);
  });
}

document.getElementById("leads-bulk-menu-trigger").addEventListener("click", e => {
  e.stopPropagation();
  toggleBulkMenu(e.currentTarget);
});

document.addEventListener("click", e => {
  if (!openBulkMenuEl) return;
  if (e.target.closest(".floating-menu") || e.target.closest("#leads-bulk-menu-trigger")) return;
  closeBulkMenu();
});

/* ---- alterar temperatura / origem (individual ou em massa) ---- */
const quickFieldModalBackdrop = document.getElementById("quickfield-modal-backdrop");
const quickFieldForm = document.getElementById("quickfield-form");
const quickFieldSelect = document.getElementById("quickfield-select");
let quickFieldTarget = { ids: [], field: null };

function openQuickFieldModal(ids, field) {
  quickFieldTarget = { ids, field };
  const isTemp = field === "temperature";
  const options = isTemp ? TEMPERATURES : SOURCES;
  document.getElementById("quickfield-modal-title").textContent =
    (isTemp ? "Mudar temperatura" : "Mudar origem") + (ids.length > 1 ? ` (${ids.length} leads)` : "");
  document.getElementById("quickfield-label-text").textContent = isTemp ? "Temperatura" : "Origem";
  quickFieldSelect.innerHTML = options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
  if (ids.length === 1) {
    const lead = leads.find(l => l.id === ids[0]);
    if (lead && lead[field]) quickFieldSelect.value = lead[field];
  }
  quickFieldModalBackdrop.classList.add("open");
}
function closeQuickFieldModal() { quickFieldModalBackdrop.classList.remove("open"); }

document.getElementById("quickfield-modal-close").addEventListener("click", closeQuickFieldModal);
document.getElementById("quickfield-btn-cancel").addEventListener("click", closeQuickFieldModal);
quickFieldModalBackdrop.addEventListener("click", e => { if (e.target === quickFieldModalBackdrop) closeQuickFieldModal(); });

quickFieldForm.addEventListener("submit", async e => {
  e.preventDefault();
  const value = quickFieldSelect.value;
  const { ids, field } = quickFieldTarget;
  ids.forEach(id => {
    const lead = leads.find(l => l.id === id);
    if (lead) lead[field] = value;
  });
  renderLeads();
  closeQuickFieldModal();
  await saveLeads();
});

async function toggleLeadActive(lead) {
  lead.active = lead.active === false ? true : false;
  renderLeads();
  await saveLeads();
}

async function removeLead(id) {
  if (!confirm("Excluir este lead? Essa ação não pode ser desfeita.")) return false;
  leads = leads.filter(l => l.id !== id);
  selectedLeadIds.delete(id);
  renderLeads();
  await deleteLeadsRemote([id]);
  return true;
}

/* ---- menu de 3 pontinhos (flutuante, fora do overflow do painel) ---- */
function closeRowMenu() {
  if (openRowMenuEl) {
    openRowMenuEl.remove();
    openRowMenuEl = null;
  }
}

function toggleRowMenu(lead, triggerEl) {
  if (openRowMenuEl && openRowMenuEl.dataset.leadId === lead.id) {
    closeRowMenu();
    return;
  }
  closeRowMenu();

  const rect = triggerEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "floating-menu";
  menu.dataset.leadId = lead.id;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - 190)}px`;
  const isInactive = lead.active === false;
  menu.innerHTML = `
    <button type="button" class="row-menu-item" data-action="assign">Atribuir consultor</button>
    <button type="button" class="row-menu-item" data-action="temperature">Mudar temperatura</button>
    ${canEditLeadSource() ? '<button type="button" class="row-menu-item" data-action="source">Mudar origem</button>' : ""}
    <button type="button" class="row-menu-item" data-action="email" ${lead.email ? "" : "disabled"}>Enviar e-mail</button>
    <button type="button" class="row-menu-item" data-action="quote">Ver cotação</button>
    <div class="row-menu-divider"></div>
    <button type="button" class="row-menu-item" data-action="toggle-active">${isInactive ? "Reativar lead" : "Desativar lead"}</button>
    <button type="button" class="row-menu-item row-menu-item-danger" data-action="delete">Excluir lead</button>
  `;
  document.body.appendChild(menu);
  openRowMenuEl = menu;

  menu.querySelector('[data-action="assign"]').addEventListener("click", () => {
    closeRowMenu();
    openAssignModal([lead.id]);
  });
  menu.querySelector('[data-action="temperature"]').addEventListener("click", () => {
    closeRowMenu();
    openQuickFieldModal([lead.id], "temperature");
  });
  const sourceBtn = menu.querySelector('[data-action="source"]');
  if (sourceBtn) sourceBtn.addEventListener("click", () => {
    closeRowMenu();
    openQuickFieldModal([lead.id], "source");
  });
  menu.querySelector('[data-action="email"]').addEventListener("click", () => {
    closeRowMenu();
    sendLeadEmail(lead);
  });
  menu.querySelector('[data-action="toggle-active"]').addEventListener("click", () => {
    closeRowMenu();
    toggleLeadActive(lead);
  });
  menu.querySelector('[data-action="delete"]').addEventListener("click", () => {
    closeRowMenu();
    removeLead(lead.id);
  });
  menu.querySelector('[data-action="quote"]').addEventListener("click", () => {
    closeRowMenu();
    viewLeadQuotes(lead);
  });
}

document.addEventListener("click", e => {
  if (!openRowMenuEl) return;
  if (e.target.closest(".floating-menu") || e.target.closest(".row-menu-trigger")) return;
  closeRowMenu();
});

function sendLeadEmail(lead) {
  if (!lead.email) {
    alert("Este lead não tem e-mail cadastrado.");
    return;
  }
  window.location.href = `mailto:${lead.email}`;
}

function viewLeadQuotes(lead) {
  quotesClientFilter = lead.company || lead.name;
  quotesClientFilterLeadId = lead.id;
  switchView("cotacao");
  openQuoteList();
  renderQuotes();
}

/* ---- atribuir consultor (individual ou em massa) ---- */
const assignModalBackdrop = document.getElementById("assign-modal-backdrop");
const assignForm = document.getElementById("assign-form");
const assignFieldConsultor = document.getElementById("assign-field-consultor");
let assigningLeadIds = [];

function openAssignModal(leadIds) {
  assigningLeadIds = leadIds;
  const consultants = users.filter(u => u.role === "Consultor");
  assignFieldConsultor.innerHTML = `<option value="">Sem consultor</option>` + consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  if (leadIds.length === 1) {
    const lead = leads.find(l => l.id === leadIds[0]);
    assignFieldConsultor.value = (lead && lead.consultorId) || "";
    document.getElementById("assign-modal-title").textContent = "Atribuir consultor";
  } else {
    assignFieldConsultor.value = "";
    document.getElementById("assign-modal-title").textContent = `Atribuir consultor (${leadIds.length} leads)`;
  }

  assignModalBackdrop.classList.add("open");
}

function closeAssignModal() { assignModalBackdrop.classList.remove("open"); }

document.getElementById("assign-modal-close").addEventListener("click", closeAssignModal);
document.getElementById("assign-btn-cancel").addEventListener("click", closeAssignModal);
assignModalBackdrop.addEventListener("click", e => { if (e.target === assignModalBackdrop) closeAssignModal(); });

assignForm.addEventListener("submit", async e => {
  e.preventDefault();
  const consultorId = assignFieldConsultor.value || null;
  assigningLeadIds.forEach(id => {
    const lead = leads.find(l => l.id === id);
    if (lead) lead.consultorId = consultorId;
  });
  renderLeads();
  closeAssignModal();
  refreshStuckLeadsAfterReassign(assigningLeadIds);
  await saveLeads();
});

/* ============================================================
   LEADS PARADOS — leads sem avanço (status "Novo") agrupados por
   consultor, com reatribuição em massa (ADM/Gerente).
   ============================================================ */
function leadIsStuck(lead) {
  return lead.active !== false && lead.status === "Novo";
}
function leadStuckDays(lead) {
  return Math.floor((Date.now() - lead.createdAt) / 86400000);
}
function stuckDaysBadgeClass(days) {
  if (days >= 7) return "badge-danger";
  if (days >= 3) return "badge-warn";
  return "badge-good";
}

function getStuckGroups() {
  const stuck = leads.filter(leadIsStuck);
  const byConsultor = new Map();
  stuck.forEach(l => {
    const key = l.consultorId || "";
    if (!byConsultor.has(key)) byConsultor.set(key, []);
    byConsultor.get(key).push(l);
  });
  return Array.from(byConsultor.entries()).map(([consultorId, group]) => {
    const consultant = consultorId ? users.find(u => u.id === consultorId) : null;
    return {
      consultorId: consultorId || null,
      consultorName: consultant ? consultant.name : "Sem consultor",
      leads: group,
      maxDays: Math.max(...group.map(leadStuckDays)),
    };
  }).sort((a, b) => b.leads.length - a.leads.length);
}

function renderStuckOverview() {
  const groups = getStuckGroups();
  const grid = document.getElementById("stuck-cards-grid");
  document.getElementById("stuck-overview-empty").style.display = groups.length === 0 ? "block" : "none";
  grid.innerHTML = groups.map((g, i) => `
    <button type="button" class="stuck-card${g.maxDays >= 7 ? " is-urgent" : ""}" data-consultor="${g.consultorId || ""}">
      <span class="stuck-card-avatar" style="background:${DASH_PALETTE[i % DASH_PALETTE.length]};">${escapeHtml(initials(g.consultorName) || "?")}</span>
      <span class="stuck-card-body">
        <span class="stuck-card-count">${g.leads.length}</span>
        <span class="stuck-card-name">${escapeHtml(g.consultorName)}</span>
        <span class="stuck-card-sub">até ${g.maxDays} dia(s) parado</span>
      </span>
    </button>`).join("");

  grid.querySelectorAll(".stuck-card").forEach(card => {
    card.addEventListener("click", () => openStuckDetail(card.dataset.consultor || null));
  });
}

let stuckDetailConsultorId;
let selectedStuckLeadIds = new Set();

function openStuckDetail(consultorId) {
  stuckDetailConsultorId = consultorId;
  selectedStuckLeadIds = new Set();
  document.getElementById("subview-stuck-overview").classList.remove("active");
  document.getElementById("subview-stuck-detalhe").classList.add("active");
  renderStuckDetailTable();
}
function closeStuckDetail() {
  document.getElementById("subview-stuck-detalhe").classList.remove("active");
  document.getElementById("subview-stuck-overview").classList.add("active");
  renderStuckOverview();
}
document.getElementById("stuck-btn-voltar").addEventListener("click", closeStuckDetail);

function renderStuckDetailTable() {
  const group = getStuckGroups().find(g => (g.consultorId || null) === stuckDetailConsultorId);
  const list = group ? group.leads.slice().sort((a, b) => leadStuckDays(b) - leadStuckDays(a)) : [];
  const fallbackConsultor = users.find(u => u.id === stuckDetailConsultorId);
  const consultorName = group ? group.consultorName : (fallbackConsultor ? fallbackConsultor.name : "Sem consultor");

  document.getElementById("stuck-detalhe-title").textContent = `Leads parados — ${consultorName}`;
  document.getElementById("stuck-detalhe-empty").style.display = list.length === 0 ? "block" : "none";

  const tbody = document.getElementById("stuck-detalhe-tbody");
  tbody.innerHTML = list.map(l => {
    const days = leadStuckDays(l);
    return `
      <tr>
        <td class="cell-check"><input type="checkbox" class="stuck-row-checkbox" data-id="${l.id}" ${selectedStuckLeadIds.has(l.id) ? "checked" : ""}></td>
        <td class="cell-primary">${escapeHtml(l.name)}</td>
        <td class="cell-muted">${escapeHtml(l.email || l.phone || "—")}</td>
        <td class="cell-muted">${escapeHtml(l.source || "—")}</td>
        <td><span class="badge ${TEMPERATURE_BADGE[l.temperature] || "badge-neutral"}">${escapeHtml(l.temperature || "—")}</span></td>
        <td><span class="badge ${stuckDaysBadgeClass(days)}">${days} dia(s)</span></td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll(".stuck-row-checkbox").forEach(cb => {
    cb.addEventListener("change", e => {
      if (e.target.checked) selectedStuckLeadIds.add(e.target.dataset.id);
      else selectedStuckLeadIds.delete(e.target.dataset.id);
      updateStuckSelectAllState(list);
      updateStuckBulkBar();
    });
  });

  updateStuckSelectAllState(list);
  updateStuckBulkBar();
}

function updateStuckSelectAllState(list) {
  const cb = document.getElementById("stuck-select-all");
  if (!list.length) { cb.checked = false; cb.indeterminate = false; return; }
  const selectedCount = list.filter(l => selectedStuckLeadIds.has(l.id)).length;
  cb.checked = selectedCount === list.length;
  cb.indeterminate = selectedCount > 0 && selectedCount < list.length;
}

document.getElementById("stuck-select-all").addEventListener("change", e => {
  const group = getStuckGroups().find(g => (g.consultorId || null) === stuckDetailConsultorId);
  const list = group ? group.leads : [];
  if (e.target.checked) list.forEach(l => selectedStuckLeadIds.add(l.id));
  else list.forEach(l => selectedStuckLeadIds.delete(l.id));
  renderStuckDetailTable();
});

function updateStuckBulkBar() {
  const bar = document.getElementById("stuck-bulk-bar");
  const count = selectedStuckLeadIds.size;
  document.getElementById("stuck-bulk-count").textContent = `${count} selecionado(s)`;
  bar.style.display = count > 0 ? "flex" : "none";
}

document.getElementById("stuck-bulk-clear").addEventListener("click", () => {
  selectedStuckLeadIds = new Set();
  renderStuckDetailTable();
});

document.getElementById("stuck-btn-reassign").addEventListener("click", () => {
  if (!selectedStuckLeadIds.size) return;
  openAssignModal(Array.from(selectedStuckLeadIds));
});

/* depois de reatribuir (pelo modal padrão de "Atribuir consultor"),
   atualiza a tela de Leads Parados se ela estiver aberta na hora */
function refreshStuckLeadsAfterReassign(reassignedIds) {
  if (!document.getElementById("view-leadsparados").classList.contains("active")) return;
  reassignedIds.forEach(id => selectedStuckLeadIds.delete(id));
  if (document.getElementById("subview-stuck-detalhe").classList.contains("active")) {
    renderStuckDetailTable();
  } else {
    renderStuckOverview();
  }
}

/* ---- modal de lead (criar/editar) ---- */
function openLeadModal(id) {
  leadForm.reset();
  const existingLead = id ? leads.find(l => l.id === id) : null;
  renderLeadFormOptions(existingLead ? existingLead.source : null);
  renderLeadCountryOptions(document.getElementById("lead-field-country"));
  if (id) {
    const lead = existingLead;
    document.getElementById("lead-modal-title").textContent = "Editar lead";
    document.getElementById("lead-id").value = lead.id;
    document.getElementById("lead-field-name").value = lead.name;
    document.getElementById("lead-field-company").value = lead.company || "";
    document.getElementById("lead-field-country").value = lead.countryCode || "BR";
    document.getElementById("lead-field-ddd").value = lead.phoneDdd || "";
    document.getElementById("lead-field-phone").value = lead.phoneNumber || "";
    document.getElementById("lead-field-email").value = lead.email || "";
    document.getElementById("lead-field-category").value = lead.category || "Outro";
    document.getElementById("lead-field-source").value = lead.source || "Indicação";
    document.getElementById("lead-field-temperature").value = lead.temperature || "Morno";
    document.getElementById("lead-field-status").value = lead.status || "Novo";
    document.getElementById("lead-field-notes").value = lead.notes || "";
    document.getElementById("lead-field-active").checked = lead.active !== false;
    leadBtnDelete.style.display = "inline-block";
  } else {
    document.getElementById("lead-modal-title").textContent = "Novo lead";
    document.getElementById("lead-id").value = "";
    document.getElementById("lead-field-country").value = "BR";
    document.getElementById("lead-field-category").value = "Outro";
    document.getElementById("lead-field-source").value = "Indicação";
    document.getElementById("lead-field-temperature").value = "Morno";
    document.getElementById("lead-field-active").checked = true;
    leadBtnDelete.style.display = "none";
  }

  /* origem só pode ser alterada por ADM/Gerente depois que o lead já
     existe — na criação, qualquer função pode escolher a origem */
  const sourceField = document.getElementById("lead-field-source");
  const sourceLocked = !!id && !canEditLeadSource();
  sourceField.disabled = sourceLocked;
  sourceField.title = sourceLocked ? "Apenas ADM ou Gerente podem alterar a origem de um lead já cadastrado." : "";

  leadModalBackdrop.classList.add("open");
  document.getElementById("lead-field-name").focus();
}

function closeLeadModal() { leadModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-lead").addEventListener("click", () => openLeadModal(null));
document.getElementById("lead-modal-close").addEventListener("click", closeLeadModal);
document.getElementById("lead-btn-cancel").addEventListener("click", closeLeadModal);
leadModalBackdrop.addEventListener("click", e => { if (e.target === leadModalBackdrop) closeLeadModal(); });

leadForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("lead-id").value;
  const countryCode = document.getElementById("lead-field-country").value;
  const phoneDdd = document.getElementById("lead-field-ddd").value.trim().replace(/\D/g, "");
  const phoneNumber = document.getElementById("lead-field-phone").value.trim().replace(/\D/g, "");
  const dddField = document.getElementById("lead-field-ddd");
  const phoneField = document.getElementById("lead-field-phone");
  const dddVazio = !phoneDdd, phoneVazio = !phoneNumber;
  dddField.classList.toggle("err", dddVazio);
  phoneField.classList.toggle("err", phoneVazio);
  if (dddVazio || phoneVazio) {
    alert("Preencha o país, o DDD e o número do lead — são obrigatórios para o botão do WhatsApp funcionar.");
    (dddVazio ? dddField : phoneField).focus();
    return;
  }

  const data = {
    name: document.getElementById("lead-field-name").value.trim(),
    company: document.getElementById("lead-field-company").value.trim(),
    countryCode, phoneDdd, phoneNumber,
    phone: `(${phoneDdd}) ${phoneNumber}`,
    email: document.getElementById("lead-field-email").value.trim(),
    category: document.getElementById("lead-field-category").value,
    source: document.getElementById("lead-field-source").value,
    temperature: document.getElementById("lead-field-temperature").value,
    status: document.getElementById("lead-field-status").value,
    notes: document.getElementById("lead-field-notes").value.trim(),
    active: document.getElementById("lead-field-active").checked,
  };

  if (data.email && leads.some(l => l.id !== id && l.email && l.email.toLowerCase() === data.email.toLowerCase())) {
    alert(`Já existe um lead cadastrado com o e-mail "${data.email}".`);
    return;
  }

  let newLead = null;
  if (id) {
    Object.assign(leads.find(l => l.id === id), data);
  } else {
    const consultorId = isOwnLeadsOnly() ? session.id : null;
    newLead = { id: uid(), ...data, consultorId, createdAt: Date.now() };
    leads.push(newLead);
  }
  renderLeads();
  closeLeadModal();
  await saveLeads();

  if (newLead) {
    createDealForLead(newLead);
    renderBoard();
    await saveDeals();
  }
});

leadBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("lead-id").value;
  if (id && await removeLead(id)) closeLeadModal();
});

/* ============================================================
   IMPORTAR LEADS VIA CSV
   ============================================================ */
const IMPORT_FIELDS = [
  { key: "name", label: "Nome" },
  { key: "company", label: "Empresa" },
  { key: "phone", label: "Telefone" },
  { key: "email", label: "E-mail" },
  { key: "category", label: "Categoria" },
  { key: "source", label: "Origem" },
  { key: "temperature", label: "Temperatura" },
  { key: "status", label: "Status" },
  { key: "consultor", label: "Consultor" },
];

const IMPORT_FIELD_GUESSES = {
  name: ["nome", "name", "cliente", "aluno", "estudante"],
  company: ["empresa", "company", "escola atual", "instituicao"],
  phone: ["telefone", "phone", "celular", "whatsapp", "fone", "contato"],
  email: ["email", "e-mail", "mail"],
  category: ["categoria", "category", "programa", "interesse"],
  source: ["origem", "source", "canal"],
  temperature: ["temperatura", "temperature"],
  status: ["status", "etapa", "estagio"],
  consultor: ["consultor", "responsavel", "vendedor", "owner"],
};

function normalizeImportStr(s) {
  return (s == null ? "" : String(s)).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function guessImportField(header) {
  const h = normalizeImportStr(header);
  return Object.keys(IMPORT_FIELD_GUESSES).find(key => IMPORT_FIELD_GUESSES[key].some(k => h.includes(k))) || "";
}

function parseCSV(text) {
  const firstLine = text.slice(0, text.search(/\r?\n/) > -1 ? text.search(/\r?\n/) : text.length);
  const delimiter = (firstLine.split(";").length > firstLine.split(",").length) ? ";" : ",";

  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c === "\r") {
      /* ignora — \r\n tratado pelo \n */
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows
    .map(r => r.map(f => f.trim()))
    .filter(r => r.some(f => f !== ""));
}

function matchEnum(value, options, fallback) {
  const v = normalizeImportStr(value);
  if (!v) return fallback;
  const exact = options.find(o => normalizeImportStr(o) === v);
  if (exact) return exact;
  const partial = options.find(o => normalizeImportStr(o).includes(v) || v.includes(normalizeImportStr(o)));
  return partial || fallback;
}

let importHeaders = [];
let importRows = [];

const importModalBackdrop = document.getElementById("import-modal-backdrop");
const importFileInput = document.getElementById("import-file-input");
const importMappingTbody = document.getElementById("import-mapping-tbody");

document.getElementById("btn-import-leads").addEventListener("click", () => importFileInput.click());

importFileInput.addEventListener("change", () => {
  const file = importFileInput.files[0];
  importFileInput.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = parseCSV(String(reader.result || ""));
    if (parsed.length < 2) {
      alert("Não encontrei linhas de dados nesse CSV. Confira o arquivo e tente novamente.");
      return;
    }
    importHeaders = parsed[0];
    importRows = parsed.slice(1);
    openImportModal();
  };
  reader.onerror = () => alert("Não consegui ler esse arquivo. Tente novamente.");
  reader.readAsText(file, "UTF-8");
});

function openImportModal() {
  document.getElementById("import-summary").textContent =
    `${importRows.length} linha(s) encontrada(s) em ${importHeaders.length} coluna(s). Confira o mapeamento antes de importar.`;

  importMappingTbody.innerHTML = importHeaders.map((h, i) => {
    const sample = (importRows[0] && importRows[0][i]) || "";
    const guess = guessImportField(h);
    const options = `<option value="">Não importar</option>` +
      IMPORT_FIELDS.map(f => `<option value="${f.key}"${f.key === guess ? " selected" : ""}>${f.label}</option>`).join("");
    return `
      <tr>
        <td class="cell-primary">${escapeHtml(h || `Coluna ${i + 1}`)}</td>
        <td class="cell-muted">${escapeHtml(sample)}</td>
        <td><select data-col="${i}">${options}</select></td>
      </tr>`;
  }).join("");

  importModalBackdrop.classList.add("open");
}

function closeImportModal() { importModalBackdrop.classList.remove("open"); }
document.getElementById("import-modal-close").addEventListener("click", closeImportModal);
document.getElementById("import-btn-cancel").addEventListener("click", closeImportModal);
importModalBackdrop.addEventListener("click", e => { if (e.target === importModalBackdrop) closeImportModal(); });

document.getElementById("import-btn-confirm").addEventListener("click", async () => {
  const mapping = {};
  importMappingTbody.querySelectorAll("select").forEach(sel => {
    if (sel.value) mapping[sel.value] = parseInt(sel.dataset.col, 10);
  });

  if (mapping.name === undefined) {
    alert('Mapeie ao menos a coluna "Nome" para importar.');
    return;
  }

  const now = Date.now();
  let imported = 0, skipped = 0, skippedDuplicates = 0;
  const importedLeads = [];
  const seenEmails = new Set(leads.filter(l => l.email).map(l => l.email.toLowerCase()));

  importRows.forEach(row => {
    const get = key => mapping[key] !== undefined ? (row[mapping[key]] || "").trim() : "";
    const name = get("name");
    if (!name) { skipped++; return; }

    const email = get("email");
    if (email && seenEmails.has(email.toLowerCase())) { skippedDuplicates++; return; }

    let consultorId = null;
    const consultorRaw = get("consultor");
    if (consultorRaw) {
      const match = users.find(u => u.role === "Consultor" &&
        (normalizeImportStr(u.name) === normalizeImportStr(consultorRaw) || normalizeImportStr(u.email) === normalizeImportStr(consultorRaw)));
      if (match) consultorId = match.id;
    }
    if (!consultorId && isOwnLeadsOnly()) consultorId = session.id;

    const importedPhone = get("phone");
    const { ddd: importedDdd, number: importedNumber } = splitBrazilianPhone(importedPhone);

    const newLead = {
      id: uid(),
      name,
      company: get("company"),
      phone: importedPhone,
      countryCode: "BR", phoneDdd: importedDdd, phoneNumber: importedNumber,
      email,
      category: matchEnum(get("category"), CATEGORIES, "Outro"),
      source: matchEnum(get("source"), SOURCES, "Outro"),
      temperature: matchEnum(get("temperature"), TEMPERATURES, "Morno"),
      status: matchEnum(get("status"), ["Novo", "Em contato", "Qualificado", "Descartado"], "Novo"),
      consultorId,
      active: true,
      createdAt: now,
    };
    if (email) seenEmails.add(email.toLowerCase());
    leads.push(newLead);
    importedLeads.push(newLead);
    imported++;
  });

  renderLeads();
  closeImportModal();
  alert(`Importação concluída: ${imported} lead(s) importado(s)`
    + `${skipped ? `, ${skipped} linha(s) ignorada(s) por falta de nome` : ""}`
    + `${skippedDuplicates ? `, ${skippedDuplicates} linha(s) ignorada(s) por e-mail já cadastrado` : ""}.`);
  await saveLeads();

  if (importedLeads.length) {
    importedLeads.forEach(l => createDealForLead(l));
    renderBoard();
    await saveDeals();
  }
});

/* ============================================================
   GERENCIAR ORIGENS DE LEADS
   ============================================================ */
const sourcesModalBackdrop = document.getElementById("sources-modal-backdrop");
const sourcesListEl = document.getElementById("sources-list");
const sourcesNewInput = document.getElementById("sources-new-input");

function sourceUsageCount(name) {
  return leads.filter(l => l.source === name).length;
}

function renderSourcesList() {
  sourcesListEl.innerHTML = SOURCES.map((s, i) => `
    <div class="source-row">
      <input type="text" value="${escapeHtml(s)}" data-index="${i}">
      <span class="source-usage">${sourceUsageCount(s)} lead(s)</span>
      <button type="button" class="btn btn-icon" data-act="del" data-index="${i}" title="Excluir origem">&times;</button>
    </div>`).join("");
}

function openSourcesModal() {
  renderSourcesList();
  sourcesNewInput.value = "";
  sourcesModalBackdrop.classList.add("open");
}
function closeSourcesModal() { sourcesModalBackdrop.classList.remove("open"); }

document.getElementById("btn-manage-sources").addEventListener("click", openSourcesModal);
document.getElementById("sources-modal-close").addEventListener("click", closeSourcesModal);
document.getElementById("sources-btn-done").addEventListener("click", closeSourcesModal);
sourcesModalBackdrop.addEventListener("click", e => { if (e.target === sourcesModalBackdrop) closeSourcesModal(); });

sourcesListEl.addEventListener("change", async e => {
  const input = e.target.closest('input[type="text"]');
  if (!input) return;
  const index = parseInt(input.dataset.index, 10);
  const oldName = SOURCES[index];
  const newName = input.value.trim();

  if (!newName) { input.value = oldName; return; }
  const duplicate = SOURCES.some((s, i) => i !== index && s.toLowerCase() === newName.toLowerCase());
  if (duplicate) {
    alert("Já existe uma origem com esse nome.");
    input.value = oldName;
    return;
  }
  if (newName === oldName) return;

  SOURCES[index] = newName;
  leads.forEach(l => { if (l.source === oldName) l.source = newName; });
  renderSourcesList();
  renderLeadFilterOptions();
  renderLeads();
  await renameSourceRemote(oldName, newName);
  await saveLeads();
});

sourcesListEl.addEventListener("click", async e => {
  const btn = e.target.closest('button[data-act="del"]');
  if (!btn) return;
  const index = parseInt(btn.dataset.index, 10);
  const name = SOURCES[index];
  if (SOURCES.length === 1) {
    alert("Mantenha ao menos uma origem cadastrada.");
    return;
  }
  const count = sourceUsageCount(name);
  const msg = count > 0
    ? `Excluir a origem "${name}"? ${count} lead(s) já usam esse valor — eles manterão "${name}" no registro, mas essa opção deixará de existir para novos cadastros.`
    : `Excluir a origem "${name}"?`;
  if (!confirm(msg)) return;
  SOURCES.splice(index, 1);
  renderSourcesList();
  renderLeadFilterOptions();
  await deleteSourceRemote(name);
});

async function addNewSource() {
  const name = sourcesNewInput.value.trim();
  if (!name) return;
  const duplicate = SOURCES.some(s => s.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    alert("Já existe uma origem com esse nome.");
    return;
  }
  SOURCES.push(name);
  sourcesNewInput.value = "";
  renderSourcesList();
  renderLeadFilterOptions();
  sourcesNewInput.focus();
  await addSourceRemote(name);
}
document.getElementById("sources-add-btn").addEventListener("click", addNewSource);
sourcesNewInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addNewSource(); }
});

/* ============================================================
   COTAÇÃO (quotes) — lista com filtros + construtor completo
   (puxa dados de um lead, monta o catálogo de serviços e gera
   o PDF; ao gerar, a cotação também é salva na tabela quotes)
   ============================================================ */
function quoteRowFromDb(r) {
  return {
    id: r.id, client: r.client, email: r.email || "", items: r.items || "",
    value: Number(r.value) || 0, validade: r.validade || "", status: r.status,
    leadId: r.lead_id || null, consultorId: r.consultor_id || null,
    consultorName: r.consultor_name || "", consultorEmail: r.consultor_email || "",
    emissao: r.emissao || "", observacoes: r.observacoes || "",
    itemsDetail: Array.isArray(r.items_detail) ? r.items_detail : [],
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function quoteRowToDb(q) {
  return {
    id: q.id, client: q.client, email: q.email || "", items: q.items || "",
    value: q.value, validade: q.validade || null, status: q.status,
    lead_id: q.leadId || null, consultor_id: q.consultorId || null,
    consultor_name: q.consultorName || "", consultor_email: q.consultorEmail || "",
    emissao: q.emissao || null, observacoes: q.observacoes || "",
    items_detail: q.itemsDetail || [],
    created_at: new Date(q.createdAt).toISOString(),
  };
}

async function loadQuotes() {
  const { data, error } = await supabase.from("quotes").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar cotações:", error); return []; }
  return data.map(quoteRowFromDb);
}
async function saveQuoteRow(q) {
  const { error } = await supabase.from("quotes").upsert(quoteRowToDb(q));
  if (error) console.error("Erro ao salvar cotação:", error);
  return !error;
}
async function deleteQuoteRemote(id) {
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) console.error("Erro ao excluir cotação:", error);
}

let quotes = [];

const quotesTbody = document.getElementById("quotes-tbody");
const quotesEmpty = document.getElementById("quotes-empty");

const QUOTE_STATUS_BADGE = {
  "Aberta": "badge-neutral",
  "Enviada": "badge-warn",
  "Em negociação": "badge-warn",
  "Aprovada": "badge-good",
  "Recusada": "badge-danger",
};

function formatDate(isoDate) {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function isQuoteWon(q) { return q.status === "Aprovada"; }
function isQuoteLost(q) { return q.status === "Recusada"; }

/* ---- filtro: consultor ---- */
function renderQuotesFilterOptions() {
  const sel = document.getElementById("quotes-filter-consultor");
  const current = sel.value;
  const consultants = users.filter(u => u.role === "Consultor").slice().sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">Todos os consultores</option>` + consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  sel.value = current;
}

function getFilteredQuotes() {
  const term = (document.getElementById("quotes-filter-search").value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("quotes-filter-status").value;
  const consultorId = document.getElementById("quotes-filter-consultor").value;
  return quotes.filter(q => {
    if (quotesClientFilter) {
      const byLead = quotesClientFilterLeadId && q.leadId === quotesClientFilterLeadId;
      const byName = q.client.toLowerCase().includes(quotesClientFilter.toLowerCase());
      if (!byLead && !byName) return false;
    }
    if (term && !(q.client.toLowerCase().includes(term) || (q.email || "").toLowerCase().includes(term))) return false;
    if (statusFilter === "ganha" && !isQuoteWon(q)) return false;
    if (statusFilter === "perdida" && !isQuoteLost(q)) return false;
    if (consultorId && q.consultorId !== consultorId) return false;
    return true;
  });
}

function renderQuotes() {
  renderQuotesFilterOptions();
  const chipRow = document.getElementById("quotes-filter-chip-row");
  if (quotesClientFilter) {
    chipRow.style.display = "flex";
    document.getElementById("quotes-filter-chip-label").textContent = quotesClientFilter;
  } else {
    chipRow.style.display = "none";
  }

  const filtered = getFilteredQuotes();
  quotesTbody.innerHTML = "";
  quotesEmpty.style.display = filtered.length === 0 ? "block" : "none";

  filtered.slice().sort((a, b) => b.createdAt - a.createdAt).forEach(q => {
    const consultant = users.find(u => u.id === q.consultorId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(q.client)}</td>
      <td class="cell-muted">${escapeHtml(q.email || "—")}</td>
      <td class="cell-muted">${escapeHtml(q.items || "—")}</td>
      <td class="cell-muted">${escapeHtml((consultant && consultant.name) || q.consultorName || "—")}</td>
      <td class="cell-muted">${formatDate(q.validade)}</td>
      <td><span class="badge ${QUOTE_STATUS_BADGE[q.status] || "badge-neutral"}">${escapeHtml(q.status)}</span></td>
      <td class="cell-primary">${currency(q.value)}</td>
      <td class="cell-actions">›</td>
    `;
    tr.addEventListener("click", () => openQuoteBuilder(q.id));
    quotesTbody.appendChild(tr);
  });

  renderQuotesDashboard();
}

document.getElementById("quotes-filter-search").addEventListener("input", renderQuotes);
document.getElementById("quotes-filter-status").addEventListener("change", renderQuotes);
document.getElementById("quotes-filter-consultor").addEventListener("change", renderQuotes);
document.getElementById("quotes-filter-clear").addEventListener("click", () => {
  document.getElementById("quotes-filter-search").value = "";
  document.getElementById("quotes-filter-status").value = "";
  document.getElementById("quotes-filter-consultor").value = "";
  quotesClientFilter = null;
  quotesClientFilterLeadId = null;
  renderQuotes();
});
document.getElementById("quotes-filter-chip-clear").addEventListener("click", () => {
  quotesClientFilter = null;
  quotesClientFilterLeadId = null;
  renderQuotes();
});

function renderQuotesDashboard() {
  const open = quotes.filter(q => !isQuoteWon(q) && !isQuoteLost(q));
  document.getElementById("quotes-stat-open").textContent = open.length;
  document.getElementById("quotes-stat-value").textContent = currency(quotes.reduce((s, q) => s + (Number(q.value) || 0), 0));
  document.getElementById("quotes-stat-approved").textContent = quotes.filter(isQuoteWon).length;
  document.getElementById("quotes-stat-lost").textContent = quotes.filter(isQuoteLost).length;
}

/* ---- alternância lista ⇄ construtor, dentro da própria tela de Cotação ---- */
function openQuoteList() {
  document.getElementById("subview-cotacao-lista").classList.add("active");
  document.getElementById("subview-cotacao-builder").classList.remove("active");
}

function openQuoteBuilder(id) {
  document.getElementById("subview-cotacao-lista").classList.remove("active");
  document.getElementById("subview-cotacao-builder").classList.add("active");

  document.getElementById("q-id").value = id || "";
  document.getElementById("q-lead-id").value = "";
  quoteLeadSearch.value = "";
  document.getElementById("q-nome").value = "";
  document.getElementById("q-email").value = "";
  document.getElementById("q-status").value = "Enviada";
  document.getElementById("q-consultor").value = "";
  document.getElementById("q-consultor-email").value = "";
  document.getElementById("q-emissao").value = "";
  document.getElementById("q-validade").value = "";
  document.getElementById("q-obs").value = "";
  document.getElementById("q-busca").value = "";
  quoteSelecionados = {};
  document.querySelectorAll(".quote-form-body .err").forEach(el => el.classList.remove("err"));

  document.getElementById("q-btn-excluir").style.display = id ? "inline-block" : "none";
  document.getElementById("quote-builder-title").textContent = id ? "Editar cotação" : "Nova cotação";

  if (id) {
    const q = quotes.find(x => x.id === id);
    if (q) {
      document.getElementById("q-lead-id").value = q.leadId || "";
      quoteLeadSearch.value = q.client || "";
      document.getElementById("q-nome").value = q.client || "";
      document.getElementById("q-email").value = q.email || "";
      document.getElementById("q-status").value = q.status || "Enviada";
      document.getElementById("q-consultor").value = q.consultorName || "";
      document.getElementById("q-consultor-email").value = q.consultorEmail || "";
      document.getElementById("q-emissao").value = q.emissao || "";
      document.getElementById("q-validade").value = q.validade || "";
      document.getElementById("q-obs").value = q.observacoes || "";
      (q.itemsDetail || []).forEach(l => { if (l.id) quoteSelecionados[l.id] = l.qtd || 1; });
    }
  }

  quoteMontaDestinos();
  quoteMontaCatalogo();
  if (!id) initQuoteBuilderDefaults();
  document.getElementById("q-nome").focus();
}

document.getElementById("btn-new-quote").addEventListener("click", () => openQuoteBuilder(null));
document.getElementById("q-btn-voltar").addEventListener("click", () => { openQuoteList(); renderQuotes(); });

document.getElementById("q-btn-excluir").addEventListener("click", async () => {
  const id = document.getElementById("q-id").value;
  if (!id || !confirm("Excluir esta cotação? Essa ação não pode ser desfeita.")) return;
  quotes = quotes.filter(q => q.id !== id);
  await deleteQuoteRemote(id);
  openQuoteList();
  renderQuotes();
});

/* ---- puxar dados de um lead existente (busca por nome/e-mail) ---- */
const quoteLeadSearch = document.getElementById("quote-lead-search");
const quoteLeadResults = document.getElementById("quote-lead-results");
const quoteLeadIdField = document.getElementById("q-lead-id");

function renderQuoteLeadSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) { quoteLeadResults.classList.remove("open"); quoteLeadResults.innerHTML = ""; return; }
  const matches = leads.filter(l =>
    (l.name && l.name.toLowerCase().includes(q)) || (l.email && l.email.toLowerCase().includes(q))
  ).slice(0, 8);
  quoteLeadResults.innerHTML = matches.length
    ? matches.map(l => `
      <div class="enr-lead-result-item" data-id="${l.id}">
        <div>${escapeHtml(l.name)}</div>
        <div class="sub">${escapeHtml(l.email || l.phone || "sem contato")}</div>
      </div>`).join("")
    : `<div class="enr-lead-result-empty">Nenhum lead encontrado</div>`;
  quoteLeadResults.classList.add("open");
}

quoteLeadSearch.addEventListener("input", () => {
  quoteLeadIdField.value = "";
  renderQuoteLeadSearchResults(quoteLeadSearch.value);
});
quoteLeadSearch.addEventListener("focus", () => {
  if (quoteLeadSearch.value.trim()) renderQuoteLeadSearchResults(quoteLeadSearch.value);
});
quoteLeadSearch.addEventListener("blur", () => {
  setTimeout(() => quoteLeadResults.classList.remove("open"), 150);
});
quoteLeadResults.addEventListener("mousedown", e => {
  const item = e.target.closest(".enr-lead-result-item[data-id]");
  if (!item) return;
  const lead = leads.find(l => l.id === item.dataset.id);
  if (!lead) return;
  quoteLeadIdField.value = lead.id;
  quoteLeadSearch.value = lead.name;
  document.getElementById("q-nome").value = lead.name || "";
  document.getElementById("q-email").value = lead.email || "";
  quoteLeadResults.classList.remove("open");
});

/* ============================================================
   PRODUTOS — catálogo (Cotações Peregrinos) + montador de cotação
   Estrutura inspirada em https://claude.ai/artifact/TP2symvqqkocx5MCh2Peqa
   Os dados agora vivem no Supabase (tabela catalog_items),
   compartilhados entre todos os usuários — sem sincronização
   automática com o artifact, que mantém seu próprio banco.
   ============================================================ */
function catalogFromDb(r) {
  return {
    id: r.id, nome: r.nome, categoria: r.categoria, destino: r.destino,
    subgrupo: r.subgrupo || "", turno: r.turno || "", unidade: r.unidade,
    preco: Number(r.preco) || 0, ordem: r.ordem, detalhe: r.detalhe || "",
    qtdFixa: !!r.qtd_fixa, qtdPadrao: r.qtd_padrao || 1, ativo: r.ativo,
    subs: Array.isArray(r.subs) ? r.subs : [],
  };
}
function catalogToDb(p) {
  return {
    id: p.id, nome: p.nome, categoria: p.categoria, destino: p.destino,
    subgrupo: p.subgrupo, turno: p.turno, unidade: p.unidade, preco: p.preco,
    ordem: p.ordem, detalhe: p.detalhe, qtd_fixa: p.qtdFixa, qtd_padrao: p.qtdPadrao,
    ativo: p.ativo, subs: p.subs,
  };
}

async function loadCatalog() {
  const { data, error } = await supabase.from("catalog_items").select("*");
  if (error) { console.error("Erro ao carregar catálogo:", error); return []; }
  return data.map(catalogFromDb);
}
async function saveCatalogItem(item) {
  const { error } = await supabase.from("catalog_items").upsert(catalogToDb(item));
  if (error) console.error("Erro ao salvar produto:", error);
}
async function deleteCatalogItemRemote(id) {
  const { error } = await supabase.from("catalog_items").delete().eq("id", id);
  if (error) console.error("Erro ao excluir produto:", error);
}

let catalog = [];
let catalogNavPath = [];

const CATALOG_ICONS = {
  categoria: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  destino: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
  escola: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/></svg>`,
  turno: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};

/* ---- estatísticas ---- */
function renderProductsDashboard() {
  document.getElementById("products-stat-total").textContent = catalog.length;
  document.getElementById("products-stat-active").textContent = catalog.filter(p => p.ativo).length;
  const destinos = new Set(catalog.filter(p => p.destino && p.destino !== "Todos").map(p => p.destino));
  document.getElementById("products-stat-destinos").textContent = destinos.size;
}

/* ---- árvore hierárquica compartilhada: Categoria > Destino > Escola > Turno > Itens ---- */
function buildCatalogTree(lista) {
  const categorias = [];
  const acha = (arr, nome) => arr.find(x => x.nome === nome) || null;
  lista.forEach(p => {
    const cn = p.categoria || "Outros", dn = p.destino || "Todos", en = p.subgrupo || "", tn = p.turno || "";
    let c = acha(categorias, cn);
    if (!c) { c = { nome: cn, destinos: [] }; categorias.push(c); }
    let d = acha(c.destinos, dn);
    if (!d) { d = { nome: dn, escolas: [] }; c.destinos.push(d); }
    let e = acha(d.escolas, en);
    if (!e) { e = { nome: en, turnos: [] }; d.escolas.push(e); }
    let t = acha(e.turnos, tn);
    if (!t) { t = { nome: tn, itens: [] }; e.turnos.push(t); }
    t.itens.push(p);
  });
  return categorias;
}

/* ---- lista administrativa do catálogo (mesma árvore de 4 níveis) ---- */
const catalogListEl = document.getElementById("catalog-list");

function adminItemCardHtml(p, isAdmin) {
  const subs = p.subs.length;
  const actions = isAdmin ? `
    <div class="acts">
      <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${p.id}">Editar</button>
      <button type="button" class="btn btn-danger btn-sm" data-act="del" data-id="${p.id}">Excluir</button>
    </div>` : "";
  return `
    <div class="prod-card${p.ativo ? "" : " off"}">
      <div class="body">
        <div class="nm">${escapeHtml(p.nome)}${p.ativo ? "" : '<span class="prod-tag">oculto</span>'}</div>
        <div class="meta">por ${escapeHtml(p.unidade)}${subs ? ` · ${subs} subiten${subs > 1 ? "s" : ""}` : ""}${p.qtdFixa ? " · quantidade fixa" : ""}</div>
      </div>
      <div class="pr">${currency(p.preco)}</div>
      ${actions}
    </div>`;
}

/* ---- navegação por caixas: resolve em qual nível da árvore estamos ---- */
function catalogNodeAtPath(path) {
  const tree = buildCatalogTree(catalog.slice().sort((a, b) => a.ordem - b.ordem));
  if (path.length === 0) return { kind: "categoria", boxes: tree };

  const cat = tree.find(c => c.nome === path[0]);
  if (!cat) return { kind: "categoria", boxes: tree, invalid: true };
  if (path.length === 1) return { kind: "destino", boxes: cat.destinos };

  const dest = cat.destinos.find(d => d.nome === path[1]);
  if (!dest) return { kind: "destino", boxes: cat.destinos, invalid: true };
  if (path.length === 2) {
    return {
      kind: "escola",
      boxes: dest.escolas.filter(e => e.nome),
      looseItens: dest.escolas.filter(e => !e.nome).flatMap(e => e.turnos.flatMap(t => t.itens)),
    };
  }

  const esc = dest.escolas.find(e => e.nome === path[2]);
  if (!esc) return { kind: "escola", boxes: dest.escolas.filter(e => e.nome), invalid: true };
  if (path.length === 3) {
    return {
      kind: "turno",
      boxes: esc.turnos.filter(t => t.nome),
      looseItens: esc.turnos.filter(t => !t.nome).flatMap(t => t.itens),
    };
  }

  const turno = esc.turnos.find(t => t.nome === path[3]);
  if (!turno) return { kind: "turno", boxes: esc.turnos.filter(t => t.nome), invalid: true };
  return { kind: "itens", itens: turno.itens };
}

function catalogCountItems(node, kind) {
  if (kind === "categoria") return node.destinos.flatMap(d => d.escolas.flatMap(e => e.turnos.flatMap(t => t.itens))).length;
  if (kind === "destino") return node.escolas.flatMap(e => e.turnos.flatMap(t => t.itens)).length;
  if (kind === "escola") return node.turnos.flatMap(t => t.itens).length;
  return node.itens.length;
}

function renderCatalogBreadcrumb() {
  const items = [{ label: "Catálogo", idx: -1 }, ...catalogNavPath.map((name, i) => ({ label: name, idx: i }))];
  return `<div class="cat-breadcrumb">${items.map((it, i) => {
    const isLast = i === items.length - 1;
    return `${i > 0 ? '<span class="cat-crumb-sep">›</span>' : ""}<button type="button" class="cat-crumb${isLast ? " active" : ""}" data-idx="${it.idx}">${escapeHtml(it.label)}</button>`;
  }).join("")}</div>`;
}

function renderCatalogList() {
  const isAdmin = !!(session && session.role === "ADM");
  document.getElementById("btn-new-catalog-item").style.display = isAdmin ? "" : "none";
  renderProductsDashboard();

  if (catalog.length === 0) {
    catalogListEl.innerHTML = '<p class="muted-note">Nenhum produto no catálogo ainda. Use "+ Novo produto" para começar.</p>';
    return;
  }

  const view = catalogNodeAtPath(catalogNavPath);
  if (view.invalid) { catalogNavPath = []; renderCatalogList(); return; }

  let html = renderCatalogBreadcrumb();

  if (view.kind === "itens") {
    const itens = view.itens.slice().sort((a, b) => a.ordem - b.ordem);
    html += `<div class="cat-items-grid">${itens.map(p => adminItemCardHtml(p, isAdmin)).join("")}</div>`;
  } else {
    const boxesHtml = view.boxes.map(node => {
      const count = catalogCountItems(node, view.kind);
      return `
        <button type="button" class="cat-box" data-nav="${escapeHtml(node.nome)}">
          <span class="cat-box-icon">${CATALOG_ICONS[view.kind]}</span>
          <span class="cat-box-name">${escapeHtml(node.nome)}</span>
          <span class="cat-box-count">${count} ${count === 1 ? "produto" : "produtos"}</span>
        </button>`;
    }).join("");

    let looseHtml = "";
    if (view.looseItens && view.looseItens.length) {
      const itens = view.looseItens.slice().sort((a, b) => a.ordem - b.ordem);
      looseHtml = `<div class="cat-items-grid">${itens.map(p => adminItemCardHtml(p, isAdmin)).join("")}</div>`;
    }

    if (!view.boxes.length && !looseHtml) {
      html += `<p class="muted-note">Nenhum item aqui ainda.</p>`;
    } else {
      if (view.boxes.length) html += `<div class="cat-box-grid">${boxesHtml}</div>`;
      html += looseHtml;
    }
  }

  catalogListEl.innerHTML = html;
}

catalogListEl.addEventListener("click", async e => {
  const crumb = e.target.closest(".cat-crumb");
  if (crumb) {
    const idx = parseInt(crumb.dataset.idx, 10);
    catalogNavPath = idx < 0 ? [] : catalogNavPath.slice(0, idx + 1);
    renderCatalogList();
    return;
  }
  const box = e.target.closest(".cat-box");
  if (box) {
    catalogNavPath = [...catalogNavPath, box.dataset.nav];
    renderCatalogList();
    return;
  }
  if (!(session && session.role === "ADM")) return;
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const p = catalog.find(p => p.id === btn.dataset.id);
  if (!p) return;
  if (btn.dataset.act === "edit") openProductModal(p.id);
  if (btn.dataset.act === "del") {
    if (!confirm(`Excluir "${p.nome}" do catálogo? Essa ação não pode ser desfeita.`)) return;
    catalog = catalog.filter(x => x.id !== p.id);
    renderCatalogList();
    quoteMontaDestinos();
    quoteMontaCatalogo();
    await deleteCatalogItemRemote(p.id);
  }
});

/* ---- modal de produto (com subitens dinâmicos) ---- */
const productModalBackdrop = document.getElementById("product-modal-backdrop");
const productForm = document.getElementById("product-form");
const productBtnDelete = document.getElementById("product-btn-delete");
const productSubsList = document.getElementById("product-subs-list");

function subRowHtml(s) {
  s = s || { nome: "", valor: 0 };
  return `
    <div class="sub-row" data-sub>
      <input type="text" data-sf="nome" placeholder="Nome do subitem" value="${escapeHtml(s.nome)}">
      <input type="number" step="0.01" min="0" data-sf="valor" placeholder="0,00" value="${Number(s.valor) || 0}">
      <button type="button" class="btn btn-icon" data-act="delsub" title="Remover subitem">&times;</button>
    </div>`;
}

function renderProductSubs(subs) {
  productSubsList.innerHTML = (subs || []).map(subRowHtml).join("");
}

document.getElementById("btn-add-sub").addEventListener("click", () => {
  productSubsList.insertAdjacentHTML("beforeend", subRowHtml());
});
productSubsList.addEventListener("click", e => {
  const btn = e.target.closest('button[data-act="delsub"]');
  if (btn) btn.closest("[data-sub]").remove();
});

function populateCatalogDatalists() {
  const uniques = field => {
    const seen = [];
    catalog.forEach(p => { const v = (p[field] || "").trim(); if (v && !seen.includes(v)) seen.push(v); });
    return seen;
  };
  const fill = (id, field) => {
    document.getElementById(id).innerHTML = uniques(field).map(v => `<option value="${escapeHtml(v)}">`).join("");
  };
  fill("list-categorias", "categoria");
  fill("list-destinos", "destino");
  fill("list-subgrupos", "subgrupo");
  fill("list-turnos", "turno");
}

function openProductModal(id) {
  productForm.reset();
  populateCatalogDatalists();
  if (id) {
    const p = catalog.find(p => p.id === id);
    document.getElementById("product-modal-title").textContent = "Editar produto";
    document.getElementById("product-id").value = p.id;
    document.getElementById("product-field-name").value = p.nome;
    document.getElementById("product-field-categoria").value = p.categoria;
    document.getElementById("product-field-destino").value = p.destino;
    document.getElementById("product-field-subgrupo").value = p.subgrupo;
    document.getElementById("product-field-turno").value = p.turno;
    document.getElementById("product-field-unidade").value = p.unidade;
    document.getElementById("product-field-preco").value = p.preco;
    document.getElementById("product-field-ordem").value = p.ordem;
    document.getElementById("product-field-qtdpadrao").value = p.qtdPadrao;
    document.getElementById("product-field-detalhe").value = p.detalhe;
    document.getElementById("product-field-qtdfixa").checked = p.qtdFixa;
    document.getElementById("product-field-ativo").checked = p.ativo;
    renderProductSubs(p.subs);
    productBtnDelete.style.display = "inline-block";
  } else {
    document.getElementById("product-modal-title").textContent = "Novo produto";
    document.getElementById("product-id").value = "";
    document.getElementById("product-field-ordem").value = 100;
    document.getElementById("product-field-qtdpadrao").value = 1;
    document.getElementById("product-field-qtdfixa").checked = true;
    document.getElementById("product-field-ativo").checked = true;
    renderProductSubs([]);
    productBtnDelete.style.display = "none";
  }
  productModalBackdrop.classList.add("open");
  document.getElementById("product-field-name").focus();
}

function closeProductModal() { productModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-catalog-item").addEventListener("click", () => openProductModal(null));
document.getElementById("product-modal-close").addEventListener("click", closeProductModal);
document.getElementById("product-btn-cancel").addEventListener("click", closeProductModal);
productModalBackdrop.addEventListener("click", e => { if (e.target === productModalBackdrop) closeProductModal(); });

function readProductSubs() {
  const subs = [];
  productSubsList.querySelectorAll("[data-sub]").forEach(row => {
    const nome = row.querySelector('[data-sf="nome"]').value.trim();
    const valor = parseFloat(row.querySelector('[data-sf="valor"]').value) || 0;
    if (nome) subs.push({ nome, valor });
  });
  return subs;
}

productForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("product-id").value;
  const data = {
    nome: document.getElementById("product-field-name").value.trim(),
    categoria: document.getElementById("product-field-categoria").value.trim() || "Outros",
    destino: document.getElementById("product-field-destino").value.trim() || "Todos",
    subgrupo: document.getElementById("product-field-subgrupo").value.trim(),
    turno: document.getElementById("product-field-turno").value.trim(),
    unidade: document.getElementById("product-field-unidade").value.trim() || "unidade",
    preco: parseFloat(document.getElementById("product-field-preco").value) || 0,
    ordem: parseInt(document.getElementById("product-field-ordem").value, 10) || 100,
    detalhe: document.getElementById("product-field-detalhe").value.trim(),
    qtdFixa: document.getElementById("product-field-qtdfixa").checked,
    qtdPadrao: Math.max(1, parseInt(document.getElementById("product-field-qtdpadrao").value, 10) || 1),
    ativo: document.getElementById("product-field-ativo").checked,
    subs: readProductSubs(),
  };
  let item;
  if (id) {
    item = catalog.find(p => p.id === id);
    Object.assign(item, data);
  } else {
    item = { id: uid(), ...data };
    catalog.push(item);
  }
  renderCatalogList();
  quoteMontaDestinos();
  quoteMontaCatalogo();
  closeProductModal();
  await saveCatalogItem(item);
});

productBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("product-id").value;
  if (!id || !confirm("Excluir este produto? Essa ação não pode ser desfeita.")) return;
  catalog = catalog.filter(p => p.id !== id);
  renderCatalogList();
  quoteMontaDestinos();
  quoteMontaCatalogo();
  closeProductModal();
  await deleteCatalogItemRemote(id);
});

/* ============================================================
   MONTADOR DE COTAÇÃO (dentro de Produtos › Nova Cotação)
   ============================================================ */
let quoteSelecionados = {};   /* id -> quantidade */
let quoteAbertos = {};        /* "categoria|destino|escola" -> aberto */
let quoteCatAbertos = {};     /* categoria -> aberto */
let quoteDestAbertos = {};    /* "categoria|destino" -> aberto */

function quoteAtivos() {
  return catalog.filter(p => p.ativo);
}

function quoteMontaDestinos() {
  const sel = document.getElementById("q-destino");
  const atual = sel.value;
  const lista = ["Todos os destinos"];
  quoteAtivos().forEach(p => { if (p.destino && p.destino !== "Todos" && !lista.includes(p.destino)) lista.push(p.destino); });
  sel.innerHTML = lista.map(d => `<option>${escapeHtml(d)}</option>`).join("");
  if (atual && lista.includes(atual)) sel.value = atual;
}

function quoteVisivel(p, filtro) {
  if (!filtro || filtro === "Todos os destinos") return true;
  return !p.destino || p.destino === "Todos" || p.destino === filtro;
}

function quoteItemHtml(p) {
  const on = Object.prototype.hasOwnProperty.call(quoteSelecionados, p.id);
  const qtd = on ? quoteSelecionados[p.id] : (p.qtdPadrao || 1);
  return `
    <div class="q-opt${on ? " on" : ""}" data-id="${p.id}">
      <input type="checkbox" data-role="pick" data-id="${p.id}"${on ? " checked" : ""} aria-label="${escapeHtml(p.nome)}">
      <span class="body">
        <span class="nm">${escapeHtml(p.nome)}</span>
        ${p.detalhe ? `<span class="dt">${escapeHtml(p.detalhe)}</span>` : ""}
        ${p.qtdFixa ? "" : `<span class="q-qty"><label for="qq-${p.id}">Quantidade (${escapeHtml(p.unidade)}s):</label><input type="number" min="1" step="1" id="qq-${p.id}" data-role="qty" data-id="${p.id}" value="${qtd}"></span>`}
      </span>
      <span class="pr">${currency(p.preco)}<em>por ${escapeHtml(p.unidade)}</em></span>
    </div>`;
}

function quoteFaixa(itens) {
  const precos = itens.map(p => Number(p.preco) || 0);
  const min = Math.min(...precos), max = Math.max(...precos);
  const qtd = itens.length + (itens.length > 1 ? " opções" : " opção");
  return qtd + (min === max ? " · " + currency(min) : " · " + currency(min) + "–" + currency(max));
}

function quoteTurnosHtml(turnos) {
  return turnos.map(t => {
    const itensHtml = t.itens.map(quoteItemHtml).join("");
    if (!t.nome) return itensHtml;
    return `<div class="q-turno"><div class="q-turno-h">${escapeHtml(t.nome)}</div>${itensHtml}</div>`;
  }).join("");
}

const quoteCatalogEl = document.getElementById("quote-catalog");

function quoteMontaCatalogo() {
  const filtro = document.getElementById("q-destino").value;
  const termo = (document.getElementById("q-busca").value || "").trim().toLowerCase();
  const lista = quoteAtivos().filter(p => {
    if (!quoteVisivel(p, filtro)) return false;
    if (!termo) return true;
    const alvo = [p.nome, p.detalhe, p.subgrupo, p.turno, p.categoria].join(" ").toLowerCase();
    return alvo.includes(termo);
  });

  if (lista.length === 0) {
    quoteCatalogEl.innerHTML = `<p class="muted-note">${termo ? `Nenhum serviço encontrado para "${escapeHtml(termo)}".` : "Nenhum serviço cadastrado para este destino."}</p>`;
    quoteAtualizaPrevia();
    return;
  }

  let html = "";
  buildCatalogTree(lista).forEach(cat => {
    const todosItensCat = cat.destinos.flatMap(d => d.escolas.flatMap(e => e.turnos.flatMap(t => t.itens)));
    const marcadosCat = todosItensCat.filter(p => Object.prototype.hasOwnProperty.call(quoteSelecionados, p.id)).length;
    const abertaCat = !!termo || marcadosCat > 0 || quoteCatAbertos[cat.nome] !== false;
    html += `<div class="q-cat" data-catchave="${escapeHtml(cat.nome)}">
      <button type="button" class="q-cat-h" data-role="toggle-cat" aria-expanded="${abertaCat}">
        <span class="arrow">▶</span><span>${escapeHtml(cat.nome)}</span>
      </button>
      <div class="q-cat-body"${abertaCat ? "" : " hidden"}>`;
    cat.destinos.forEach(dest => {
      const todosItensDest = dest.escolas.flatMap(e => e.turnos.flatMap(t => t.itens));
      const marcadosDest = todosItensDest.filter(p => Object.prototype.hasOwnProperty.call(quoteSelecionados, p.id)).length;
      const destChave = `${cat.nome}|${dest.nome}`;
      const abertoDest = !!termo || marcadosDest > 0 || quoteDestAbertos[destChave] !== false;
      html += `<div class="q-grp" data-destchave="${escapeHtml(destChave)}">
        <button type="button" class="q-grp-h" data-role="toggle-dest" aria-expanded="${abertoDest}">
          <span class="arrow">▶</span><span>${escapeHtml(dest.nome)}</span>
        </button>
        <div class="q-grp-body"${abertoDest ? "" : " hidden"}>`;
      dest.escolas.forEach(esc => {
        if (!esc.nome) {
          html += `<div class="q-sub-flat">${quoteTurnosHtml(esc.turnos)}</div>`;
          return;
        }
        const todosItens = esc.turnos.flatMap(t => t.itens);
        const chave = `${cat.nome}|${dest.nome}|${esc.nome}`;
        const marcados = todosItens.filter(p => Object.prototype.hasOwnProperty.call(quoteSelecionados, p.id)).length;
        const aberto = !!termo || marcados > 0 || quoteAbertos[chave] === true;
        html += `
          <div class="q-sub" data-chave="${escapeHtml(chave)}">
            <button type="button" class="q-sub-h" data-role="toggle" aria-expanded="${aberto}">
              <span class="arrow">▶</span>
              <span>${escapeHtml(esc.nome)}${marcados ? `<span class="picked">${marcados} na cotação</span>` : ""}</span>
              <span class="count">${quoteFaixa(todosItens)}</span>
            </button>
            <div class="q-sub-body"${aberto ? "" : " hidden"}>${quoteTurnosHtml(esc.turnos)}</div>
          </div>`;
      });
      html += "</div></div>";
    });
    html += "</div></div>";
  });
  quoteCatalogEl.innerHTML = html;
  quoteAtualizaPrevia();
}

function quotePorId(id) { return catalog.find(p => p.id === id) || null; }

function quoteLinhas() {
  const out = [];
  quoteAtivos().forEach(p => {
    if (!Object.prototype.hasOwnProperty.call(quoteSelecionados, p.id)) return;
    const q = p.qtdFixa ? 1 : Math.max(1, parseInt(quoteSelecionados[p.id], 10) || 1);
    out.push({ p, qtd: q, total: q * (Number(p.preco) || 0) });
  });
  return out;
}
function quoteTotal() { return quoteLinhas().reduce((a, l) => a + l.total, 0); }
function quoteAtualizaPrevia() { document.getElementById("quote-preview-total").textContent = currency(quoteTotal()); }

quoteCatalogEl.addEventListener("change", e => {
  const el = e.target, id = el.getAttribute("data-id");
  if (!id) return;
  if (el.getAttribute("data-role") === "pick") {
    const p = quotePorId(id);
    if (el.checked) quoteSelecionados[id] = (p && p.qtdPadrao) || 1;
    else delete quoteSelecionados[id];
    quoteMontaCatalogo();
    return;
  }
  if (el.getAttribute("data-role") === "qty") {
    const v = Math.max(1, parseInt(el.value, 10) || 1);
    el.value = v;
    if (Object.prototype.hasOwnProperty.call(quoteSelecionados, id)) quoteSelecionados[id] = v;
  }
  quoteAtualizaPrevia();
});

quoteCatalogEl.addEventListener("click", e => {
  const toggleCat = e.target.closest('button[data-role="toggle-cat"]');
  if (toggleCat) {
    const caixaCat = toggleCat.closest(".q-cat");
    const corpoCat = caixaCat.querySelector(".q-cat-body");
    const abrirCat = corpoCat.hidden;
    corpoCat.hidden = !abrirCat;
    toggleCat.setAttribute("aria-expanded", String(abrirCat));
    quoteCatAbertos[caixaCat.getAttribute("data-catchave")] = abrirCat;
    return;
  }
  const toggleDest = e.target.closest('button[data-role="toggle-dest"]');
  if (toggleDest) {
    const caixaDest = toggleDest.closest(".q-grp");
    const corpoDest = caixaDest.querySelector(".q-grp-body");
    const abrirDest = corpoDest.hidden;
    corpoDest.hidden = !abrirDest;
    toggleDest.setAttribute("aria-expanded", String(abrirDest));
    quoteDestAbertos[caixaDest.getAttribute("data-destchave")] = abrirDest;
    return;
  }
  const toggle = e.target.closest('button[data-role="toggle"]');
  if (toggle) {
    const caixa = toggle.closest(".q-sub");
    const corpo = caixa.querySelector(".q-sub-body");
    const abrir = corpo.hidden;
    corpo.hidden = !abrir;
    toggle.setAttribute("aria-expanded", String(abrir));
    quoteAbertos[caixa.getAttribute("data-chave")] = abrir;
    return;
  }
  if (e.target.tagName === "INPUT" || e.target.tagName === "LABEL") return;
  const card = e.target.closest(".q-opt");
  if (!card) return;
  const chk = card.querySelector('input[data-role="pick"]');
  if (!chk) return;
  chk.checked = !chk.checked;
  chk.dispatchEvent(new Event("change", { bubbles: true }));
});

document.getElementById("q-destino").addEventListener("change", quoteMontaCatalogo);

let quoteBuscaTimer = null;
document.getElementById("q-busca").addEventListener("input", () => {
  clearTimeout(quoteBuscaTimer);
  quoteBuscaTimer = setTimeout(quoteMontaCatalogo, 180);
});

document.getElementById("q-btn-limpar").addEventListener("click", () => {
  if (!confirm("Limpar os dados do estudante e os serviços marcados?")) return;
  ["q-nome", "q-email", "q-obs", "q-busca"].forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("q-status").value = "Enviada";
  document.getElementById("q-lead-id").value = "";
  quoteLeadSearch.value = "";
  quoteSelecionados = {};
  document.querySelectorAll(".quote-form-body .err").forEach(el => el.classList.remove("err"));
  quoteMontaCatalogo();
  document.getElementById("q-nome").focus();
});

function quoteValida() {
  const campos = [
    { el: document.getElementById("q-nome"), nome: "o nome do estudante" },
    { el: document.getElementById("q-email"), nome: "o e-mail do estudante" },
    { el: document.getElementById("q-consultor"), nome: "o nome do consultor" },
    { el: document.getElementById("q-consultor-email"), nome: "o e-mail do consultor" },
  ];
  const faltando = [];
  campos.forEach(c => {
    const vazio = !c.el.value.trim();
    c.el.classList.toggle("err", vazio);
    if (vazio) faltando.push(c.nome);
  });
  if (faltando.length) {
    alert("Preencha " + faltando.join(", ") + " antes de gerar.");
    campos.find(c => !c.el.value.trim()).el.focus();
    return false;
  }
  if (quoteLinhas().length === 0) {
    alert("Marque pelo menos um serviço para a cotação.");
    return false;
  }
  return true;
}

/* validação leve — só o nome do estudante é obrigatório para poder
   salvar o progresso e encontrar a cotação depois na lista/busca */
function quoteValidaMinima() {
  const nomeEl = document.getElementById("q-nome");
  const vazio = !nomeEl.value.trim();
  nomeEl.classList.toggle("err", vazio);
  if (vazio) {
    alert("Preencha ao menos o nome do estudante para salvar.");
    nomeEl.focus();
    return false;
  }
  return true;
}

/* monta o registro a partir do formulário e salva na tabela quotes
   (usado tanto pelo botão "Salvar" quanto por "Gerar cotação") */
async function buildAndSaveQuoteRecord() {
  const nome = document.getElementById("q-nome").value.trim();
  const email = document.getElementById("q-email").value.trim();
  const status = document.getElementById("q-status").value;
  const consultorNome = document.getElementById("q-consultor").value.trim();
  const consultorEmail = document.getElementById("q-consultor-email").value.trim();
  const emissao = document.getElementById("q-emissao").value;
  const validade = document.getElementById("q-validade").value;
  const obs = document.getElementById("q-obs").value.trim();
  const leadId = document.getElementById("q-lead-id").value || null;
  const linhas = quoteLinhas();
  const total = quoteTotal();
  const itemsSummary = linhas.map(l => l.p.nome).slice(0, 3).join(", ") + (linhas.length > 3 ? ` +${linhas.length - 3}` : "");

  const id = document.getElementById("q-id").value || uid();
  document.getElementById("q-id").value = id;
  const existing = quotes.find(q => q.id === id);
  const consultantUser = users.find(u => u.email && u.email.toLowerCase() === consultorEmail.toLowerCase());
  let consultorId = null;
  if (consultantUser) consultorId = consultantUser.id;
  else if (session && session.email && consultorEmail.toLowerCase() === session.email.toLowerCase()) consultorId = session.id;
  else if (existing) consultorId = existing.consultorId;

  const record = {
    id, client: nome, email, items: itemsSummary, value: total, validade, status,
    leadId, consultorId, consultorName: consultorNome, consultorEmail, emissao, observacoes: obs,
    itemsDetail: linhas.map(l => ({ id: l.p.id, nome: l.p.nome, qtd: l.qtd, preco: l.p.preco, total: l.total })),
    createdAt: existing ? existing.createdAt : Date.now(),
  };
  if (existing) Object.assign(existing, record);
  else quotes.push(record);
  renderQuotes();
  await saveQuoteRow(record);
  return record;
}

async function quoteSalvar() {
  if (!quoteValidaMinima()) return;
  const btn = document.getElementById("q-btn-salvar");
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  await buildAndSaveQuoteRecord();
  document.getElementById("q-btn-excluir").style.display = "inline-block";
  document.getElementById("quote-builder-title").textContent = "Editar cotação";
  btn.textContent = "Salvo ✓";
  setTimeout(() => { btn.textContent = textoOriginal; btn.disabled = false; }, 1500);
}

document.getElementById("q-btn-salvar").addEventListener("click", quoteSalvar);

async function quoteGerar() {
  if (!quoteValida()) return;

  const nome = document.getElementById("q-nome").value.trim();
  const email = document.getElementById("q-email").value.trim();
  const status = document.getElementById("q-status").value;
  const consultorNome = document.getElementById("q-consultor").value.trim();
  const consultorEmail = document.getElementById("q-consultor-email").value.trim();
  const emissao = document.getElementById("q-emissao").value;
  const validade = document.getElementById("q-validade").value;
  const obs = document.getElementById("q-obs").value.trim();
  const linhas = quoteLinhas();
  const total = quoteTotal();

  /* ---- salva a cotação na tabela quotes (lista + filtros) ---- */
  await buildAndSaveQuoteRecord();

  /* ---- gera o documento imprimível (PDF via "Salvar como PDF") ---- */
  document.getElementById("d-nome").textContent = nome;
  document.getElementById("d-email").textContent = email;
  document.getElementById("d-titulo").textContent = "Cotação para " + nome;
  document.getElementById("d-status").textContent = status;
  document.getElementById("d-consultor").textContent = consultorNome;
  document.getElementById("d-consultor-email").textContent = consultorEmail;
  document.getElementById("d-emissao").textContent = formatDate(emissao);
  document.getElementById("d-validade").textContent = formatDate(validade);

  let html = "";
  linhas.forEach(l => {
    html += `<tr class="item"><td>${escapeHtml(l.p.nome)}</td><td class="c">${l.qtd}</td><td class="r">${currency(l.p.preco)}</td><td class="tot">${currency(l.total)}</td></tr>`;
    (l.p.subs || []).forEach(s => {
      html += `<tr class="subrow-doc"><td class="name">${escapeHtml(s.nome)}</td><td class="c"></td><td class="r"></td><td class="tot">${currency(s.valor)}</td></tr>`;
    });
  });
  document.getElementById("d-itens").innerHTML = html;

  document.getElementById("d-subtotal").textContent = currency(total);
  document.getElementById("d-total").textContent = currency(total);

  document.getElementById("d-obs").hidden = !obs;
  document.getElementById("d-obs-txt").textContent = obs;

  document.getElementById("quote-doc-overlay").hidden = false;
}

document.getElementById("q-btn-gerar").addEventListener("click", quoteGerar);
document.getElementById("quote-doc-back").addEventListener("click", () => {
  document.getElementById("quote-doc-overlay").hidden = true;
});
document.getElementById("quote-doc-print").addEventListener("click", () => window.print());

function initQuoteBuilderDefaults() {
  const hoje = new Date();
  const emissao = document.getElementById("q-emissao");
  const validade = document.getElementById("q-validade");
  if (!emissao.value) emissao.value = hoje.toISOString().slice(0, 10);
  if (!validade.value) validade.value = new Date(hoje.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  if (session) {
    if (!document.getElementById("q-consultor").value) document.getElementById("q-consultor").value = session.name;
    if (!document.getElementById("q-consultor-email").value) document.getElementById("q-consultor-email").value = session.email;
  }
}

/* ============================================================
   FINANCEIRO — despesas, comissões de consultores e contas a
   receber, conectado aos negócios Ganho/Perdido do Pipeline
   ============================================================ */
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

let EXPENSE_CATEGORIES = [];
let expenses = [];
let commissions = [];
let receivables = [];
let commissionSettings = { defaultPercentage: 10 };

async function loadExpenseCategories() {
  const { data, error } = await supabase.from("expense_categories").select("name").order("ordem");
  if (error || !data || !data.length) return ["Aluguel", "Salários", "Marketing", "Ferramentas/Softwares", "Impostos", "Outro"];
  return data.map(r => r.name);
}
async function addExpenseCategoryRemote(name) {
  const { error } = await supabase.from("expense_categories").insert({ name, ordem: EXPENSE_CATEGORIES.length + 1 });
  if (error) console.error("Erro ao adicionar categoria de despesa:", error);
}
async function renameExpenseCategoryRemote(oldName, newName) {
  const { error } = await supabase.from("expense_categories").update({ name: newName }).eq("name", oldName);
  if (error) console.error("Erro ao renomear categoria de despesa:", error);
}
async function deleteExpenseCategoryRemote(name) {
  const { error } = await supabase.from("expense_categories").delete().eq("name", name);
  if (error) console.error("Erro ao excluir categoria de despesa:", error);
}

function expenseFromDb(r) {
  return {
    id: r.id, description: r.description, category: r.category || "Outro",
    amount: Number(r.amount) || 0,
    dueDate: r.due_date, paid: !!r.paid,
    paidAt: r.paid_at ? new Date(r.paid_at).getTime() : null,
    recurring: !!r.recurring, notes: r.notes || "",
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function expenseToDb(e) {
  return {
    id: e.id, description: e.description, category: e.category, amount: e.amount,
    due_date: e.dueDate, paid: e.paid,
    paid_at: e.paidAt ? new Date(e.paidAt).toISOString() : null,
    recurring: e.recurring, notes: e.notes,
    created_at: new Date(e.createdAt).toISOString(),
  };
}
async function loadExpenses() {
  const { data, error } = await supabase.from("expenses").select("*").order("due_date", { ascending: false });
  if (error) { console.error("Erro ao carregar despesas:", error); return []; }
  return data.map(expenseFromDb);
}
async function saveExpenses() {
  const { error } = await supabase.from("expenses").upsert(expenses.map(expenseToDb));
  if (error) console.error("Erro ao salvar despesas:", error);
}
async function deleteExpenseRemote(id) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) console.error("Erro ao excluir despesa:", error);
}

async function loadCommissionSettings() {
  const { data, error } = await supabase.from("commission_settings").select("default_percentage").eq("id", 1).single();
  if (error || !data) return { defaultPercentage: 10 };
  return { defaultPercentage: Number(data.default_percentage) || 10 };
}
async function updateCommissionSettingRemote(pct) {
  const { error } = await supabase.from("commission_settings").update({ default_percentage: pct }).eq("id", 1);
  if (error) console.error("Erro ao salvar comissão padrão:", error);
}

function commissionFromDb(r) {
  return {
    id: r.id, dealId: r.deal_id, consultorId: r.consultor_id,
    dealName: r.deal_name || "", dealValue: Number(r.deal_value) || 0,
    percentage: Number(r.percentage) || 0, amount: Number(r.amount) || 0,
    status: r.status, paidAt: r.paid_at ? new Date(r.paid_at).getTime() : null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function commissionToDb(c) {
  return {
    id: c.id, deal_id: c.dealId, consultor_id: c.consultorId,
    deal_name: c.dealName, deal_value: c.dealValue,
    percentage: c.percentage, amount: c.amount, status: c.status,
    paid_at: c.paidAt ? new Date(c.paidAt).toISOString() : null,
    created_at: new Date(c.createdAt).toISOString(),
  };
}
async function loadCommissions() {
  const { data, error } = await supabase.from("commissions").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar comissões:", error); return []; }
  return data.map(commissionFromDb);
}
async function saveCommission(c) {
  const { error } = await supabase.from("commissions").upsert(commissionToDb(c));
  if (error) console.error("Erro ao salvar comissão:", error);
}

function receivableFromDb(r) {
  return {
    id: r.id, dealId: r.deal_id, clientName: r.client_name || "",
    installmentNumber: r.installment_number, installmentsTotal: r.installments_total,
    amount: Number(r.amount) || 0, dueDate: r.due_date,
    paid: !!r.paid, paidAt: r.paid_at ? new Date(r.paid_at).getTime() : null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function receivableToDb(r) {
  return {
    id: r.id, deal_id: r.dealId, client_name: r.clientName,
    installment_number: r.installmentNumber, installments_total: r.installmentsTotal,
    amount: r.amount, due_date: r.dueDate, paid: r.paid,
    paid_at: r.paidAt ? new Date(r.paidAt).toISOString() : null,
    created_at: new Date(r.createdAt).toISOString(),
  };
}
async function loadReceivables() {
  const { data, error } = await supabase.from("receivables").select("*").order("due_date", { ascending: true });
  if (error) { console.error("Erro ao carregar contas a receber:", error); return []; }
  return data.map(receivableFromDb);
}
async function saveReceivables(list) {
  const { error } = await supabase.from("receivables").upsert(list.map(receivableToDb));
  if (error) console.error("Erro ao salvar contas a receber:", error);
}
async function updateReceivableRemote(r) {
  const { error } = await supabase.from("receivables").update(receivableToDb(r)).eq("id", r.id);
  if (error) console.error("Erro ao atualizar conta a receber:", error);
}

/* ---- ao marcar um negócio como Ganho: gera comissão e pede as parcelas ---- */
async function handleDealWon(deal) {
  if (!isWonStage(deal.stage)) return;

  if (!commissions.some(c => c.dealId === deal.id)) {
    const lead = deal.leadId ? leads.find(l => l.id === deal.leadId) : null;
    const pct = commissionSettings.defaultPercentage;
    const commission = {
      id: uid(), dealId: deal.id, consultorId: lead ? lead.consultorId : null,
      dealName: deal.name, dealValue: deal.value,
      percentage: pct, amount: round2(deal.value * pct / 100),
      status: "Pendente", paidAt: null, createdAt: Date.now(),
    };
    commissions.push(commission);
    renderCommissions();
    await saveCommission(commission);
  }

  if (!receivables.some(r => r.dealId === deal.id)) {
    openReceivableSetupModal(deal);
  }
}

/* ---- modal: configurar recebimento (parcelas) ---- */
let receivableSetupDeal = null;
const receivableSetupModalBackdrop = document.getElementById("receivable-setup-modal-backdrop");
const receivableSetupForm = document.getElementById("receivable-setup-form");

function openReceivableSetupModal(deal) {
  receivableSetupDeal = deal;
  document.getElementById("rec-setup-total").value = deal.value || 0;
  document.getElementById("rec-setup-installments").value = 1;
  const firstDue = new Date(Date.now() + 30 * 86400000);
  document.getElementById("rec-setup-first-due").value = firstDue.toISOString().slice(0, 10);
  receivableSetupModalBackdrop.classList.add("open");
}
function closeReceivableSetupModal() {
  receivableSetupModalBackdrop.classList.remove("open");
  receivableSetupDeal = null;
}
document.getElementById("receivable-setup-modal-close").addEventListener("click", closeReceivableSetupModal);
document.getElementById("receivable-setup-btn-skip").addEventListener("click", closeReceivableSetupModal);
receivableSetupModalBackdrop.addEventListener("click", e => { if (e.target === receivableSetupModalBackdrop) closeReceivableSetupModal(); });

receivableSetupForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (!receivableSetupDeal) return;
  const deal = receivableSetupDeal;
  const total = parseFloat(document.getElementById("rec-setup-total").value) || 0;
  const installmentsCount = Math.max(1, parseInt(document.getElementById("rec-setup-installments").value, 10) || 1);
  const firstDue = document.getElementById("rec-setup-first-due").value || new Date().toISOString().slice(0, 10);
  const perInstallment = round2(total / installmentsCount);

  const newReceivables = [];
  for (let i = 0; i < installmentsCount; i++) {
    const due = new Date(`${firstDue}T00:00:00`);
    due.setMonth(due.getMonth() + i);
    const amount = i === installmentsCount - 1 ? round2(total - perInstallment * (installmentsCount - 1)) : perInstallment;
    newReceivables.push({
      id: uid(), dealId: deal.id, clientName: deal.name,
      installmentNumber: i + 1, installmentsTotal: installmentsCount,
      amount, dueDate: due.toISOString().slice(0, 10),
      paid: false, paidAt: null, createdAt: Date.now(),
    });
  }
  receivables.push(...newReceivables);
  renderReceivables();
  renderFinanceiroOverview();
  closeReceivableSetupModal();
  await saveReceivables(newReceivables);
});

/* ---- sub-abas Financeiro ---- */
function initFinanceiroSubtabs() {
  document.querySelectorAll("#financeiro-subtabs .subtab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#financeiro-subtabs .subtab").forEach(b => b.classList.toggle("active", b === btn));
      const target = btn.dataset.finSubtab;
      document.getElementById("subview-fin-overview").classList.toggle("active", target === "overview");
      document.getElementById("subview-fin-receivables").classList.toggle("active", target === "receivables");
      document.getElementById("subview-fin-expenses").classList.toggle("active", target === "expenses");
      document.getElementById("subview-fin-commissions").classList.toggle("active", target === "commissions");
    });
  });
}

/* ---- Visão Geral ---- */
function renderFinanceiroOverview() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  const wonThisMonth = deals.filter(d => isWonStage(d.stage) && d.closedAt >= monthStart && d.closedAt < monthEnd);
  const revenue = wonThisMonth.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  const expensesThisMonth = expenses.filter(e => {
    const t = new Date(`${e.dueDate}T00:00:00`).getTime();
    return t >= monthStart && t < monthEnd;
  });
  const expensesTotal = expensesThisMonth.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const pendingReceivable = receivables.filter(r => !r.paid).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  document.getElementById("fin-stat-revenue").textContent = currency(revenue);
  document.getElementById("fin-stat-expenses").textContent = currency(expensesTotal);
  document.getElementById("fin-stat-profit").textContent = currency(revenue - expensesTotal);
  document.getElementById("fin-stat-receivable").textContent = currency(pendingReceivable);

  const closedDeals = deals.filter(d => isClosedStage(d.stage)).slice().sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0)).slice(0, 30);
  const tbody = document.getElementById("fin-overview-tbody");
  tbody.innerHTML = "";
  document.getElementById("fin-overview-empty").style.display = closedDeals.length === 0 ? "block" : "none";
  closedDeals.forEach(d => {
    const won = isWonStage(d.stage);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(d.name)}</td>
      <td><span class="badge ${won ? "badge-good" : "badge-danger"}">${won ? "Ganho" : "Perdido"}</span></td>
      <td>${currency(d.value)}</td>
      <td class="cell-muted">${d.closedAt ? new Date(d.closedAt).toLocaleDateString("pt-BR") : "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---- Contas a Receber ---- */
function getFilteredReceivables() {
  const status = document.getElementById("fin-rec-filter-status").value;
  return receivables.filter(r => {
    if (status === "pendente" && r.paid) return false;
    if (status === "pago" && !r.paid) return false;
    return true;
  });
}

function renderReceivables() {
  const filtered = getFilteredReceivables().slice().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const tbody = document.getElementById("fin-receivables-tbody");
  tbody.innerHTML = "";
  document.getElementById("fin-receivables-empty").style.display = filtered.length === 0 ? "block" : "none";
  filtered.forEach(r => {
    const deal = deals.find(d => d.id === r.dealId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(r.clientName)}</td>
      <td class="cell-muted">${escapeHtml(deal ? deal.name : "—")}</td>
      <td class="cell-muted">${r.installmentNumber}/${r.installmentsTotal}</td>
      <td>${currency(r.amount)}</td>
      <td class="cell-muted">${formatDate(r.dueDate)}</td>
      <td><span class="badge ${r.paid ? "badge-good" : "badge-warn"}">${r.paid ? "Pago" : "Pendente"}</span></td>
      <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="toggle-paid" data-id="${r.id}">${r.paid ? "Marcar pendente" : "Marcar pago"}</button></td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById("fin-receivables-tbody").addEventListener("click", async e => {
  const btn = e.target.closest('button[data-act="toggle-paid"]');
  if (!btn) return;
  const r = receivables.find(x => x.id === btn.dataset.id);
  if (!r) return;
  r.paid = !r.paid;
  r.paidAt = r.paid ? Date.now() : null;
  renderReceivables();
  renderFinanceiroOverview();
  await updateReceivableRemote(r);
});
document.getElementById("fin-rec-filter-status").addEventListener("change", renderReceivables);
document.getElementById("fin-rec-filter-clear").addEventListener("click", () => {
  document.getElementById("fin-rec-filter-status").value = "";
  renderReceivables();
});

/* ---- Despesas ---- */
function renderExpenseFilterOptions() {
  document.getElementById("fin-exp-filter-category").innerHTML =
    `<option value="">Categoria (todas)</option>` + EXPENSE_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
}

function getFilteredExpenses() {
  const category = document.getElementById("fin-exp-filter-category").value;
  const status = document.getElementById("fin-exp-filter-status").value;
  return expenses.filter(e => {
    if (category && e.category !== category) return false;
    if (status === "pendente" && e.paid) return false;
    if (status === "pago" && !e.paid) return false;
    return true;
  });
}

function renderExpenses() {
  const filtered = getFilteredExpenses().slice().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const tbody = document.getElementById("fin-expenses-tbody");
  tbody.innerHTML = "";
  document.getElementById("fin-expenses-empty").style.display = filtered.length === 0 ? "block" : "none";
  filtered.forEach(e => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(e.description)}</td>
      <td class="cell-muted">${escapeHtml(e.category)}</td>
      <td>${currency(e.amount)}</td>
      <td class="cell-muted">${formatDate(e.dueDate)}</td>
      <td><span class="badge ${e.paid ? "badge-good" : "badge-warn"}">${e.paid ? "Paga" : "Pendente"}</span></td>
      <td class="cell-actions">›</td>
    `;
    tr.addEventListener("click", () => openExpenseModal(e.id));
    tbody.appendChild(tr);
  });
}
document.getElementById("fin-exp-filter-category").addEventListener("change", renderExpenses);
document.getElementById("fin-exp-filter-status").addEventListener("change", renderExpenses);
document.getElementById("fin-exp-filter-clear").addEventListener("click", () => {
  document.getElementById("fin-exp-filter-category").value = "";
  document.getElementById("fin-exp-filter-status").value = "";
  renderExpenses();
});

const expenseModalBackdrop = document.getElementById("expense-modal-backdrop");
const expenseForm = document.getElementById("expense-form");
const expenseBtnDelete = document.getElementById("expense-btn-delete");

function openExpenseModal(id) {
  expenseForm.reset();
  document.getElementById("expense-field-category").innerHTML = EXPENSE_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (id) {
    const e = expenses.find(x => x.id === id);
    document.getElementById("expense-modal-title").textContent = "Editar despesa";
    document.getElementById("expense-id").value = e.id;
    document.getElementById("expense-field-description").value = e.description;
    document.getElementById("expense-field-category").value = e.category;
    document.getElementById("expense-field-amount").value = e.amount || "";
    document.getElementById("expense-field-due-date").value = e.dueDate || "";
    document.getElementById("expense-field-paid").checked = !!e.paid;
    document.getElementById("expense-field-recurring").checked = !!e.recurring;
    document.getElementById("expense-field-notes").value = e.notes || "";
    expenseBtnDelete.style.display = "inline-block";
  } else {
    document.getElementById("expense-modal-title").textContent = "Nova despesa";
    document.getElementById("expense-id").value = "";
    document.getElementById("expense-field-due-date").value = new Date().toISOString().slice(0, 10);
    expenseBtnDelete.style.display = "none";
  }
  expenseModalBackdrop.classList.add("open");
  document.getElementById("expense-field-description").focus();
}
function closeExpenseModal() { expenseModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-expense").addEventListener("click", () => openExpenseModal(null));
document.getElementById("expense-modal-close").addEventListener("click", closeExpenseModal);
document.getElementById("expense-btn-cancel").addEventListener("click", closeExpenseModal);
expenseModalBackdrop.addEventListener("click", e => { if (e.target === expenseModalBackdrop) closeExpenseModal(); });

expenseForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("expense-id").value;
  const paid = document.getElementById("expense-field-paid").checked;
  const data = {
    description: document.getElementById("expense-field-description").value.trim(),
    category: document.getElementById("expense-field-category").value,
    amount: parseFloat(document.getElementById("expense-field-amount").value) || 0,
    dueDate: document.getElementById("expense-field-due-date").value || new Date().toISOString().slice(0, 10),
    paid,
    recurring: document.getElementById("expense-field-recurring").checked,
    notes: document.getElementById("expense-field-notes").value.trim(),
  };
  if (id) {
    const existing = expenses.find(x => x.id === id);
    const wasPaid = existing.paid;
    Object.assign(existing, data);
    if (paid && !wasPaid) existing.paidAt = Date.now();
    if (!paid) existing.paidAt = null;
  } else {
    expenses.push({ id: uid(), ...data, paidAt: paid ? Date.now() : null, createdAt: Date.now() });
  }
  renderExpenses();
  renderFinanceiroOverview();
  closeExpenseModal();
  await saveExpenses();
});

expenseBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("expense-id").value;
  if (!id) return;
  if (!confirm("Excluir esta despesa? Essa ação não pode ser desfeita.")) return;
  expenses = expenses.filter(x => x.id !== id);
  renderExpenses();
  renderFinanceiroOverview();
  closeExpenseModal();
  await deleteExpenseRemote(id);
});

/* ---- gerenciar categorias de despesa ---- */
const expenseCategoriesModalBackdrop = document.getElementById("expense-categories-modal-backdrop");
const expenseCategoriesListEl = document.getElementById("expense-categories-list");
const expenseCategoriesNewInput = document.getElementById("expense-categories-new-input");

function expenseCategoryUsageCount(name) {
  return expenses.filter(e => e.category === name).length;
}
function renderExpenseCategoriesList() {
  expenseCategoriesListEl.innerHTML = EXPENSE_CATEGORIES.map((c, i) => `
    <div class="source-row">
      <input type="text" value="${escapeHtml(c)}" data-index="${i}">
      <span class="source-usage">${expenseCategoryUsageCount(c)} despesa(s)</span>
      <button type="button" class="btn btn-icon" data-act="del" data-index="${i}" title="Excluir categoria">&times;</button>
    </div>`).join("");
}
function openExpenseCategoriesModal() {
  renderExpenseCategoriesList();
  expenseCategoriesNewInput.value = "";
  expenseCategoriesModalBackdrop.classList.add("open");
}
function closeExpenseCategoriesModal() { expenseCategoriesModalBackdrop.classList.remove("open"); }

document.getElementById("btn-manage-expense-categories").addEventListener("click", openExpenseCategoriesModal);
document.getElementById("expense-categories-modal-close").addEventListener("click", closeExpenseCategoriesModal);
document.getElementById("expense-categories-btn-done").addEventListener("click", closeExpenseCategoriesModal);
expenseCategoriesModalBackdrop.addEventListener("click", e => { if (e.target === expenseCategoriesModalBackdrop) closeExpenseCategoriesModal(); });

expenseCategoriesListEl.addEventListener("change", async e => {
  const input = e.target.closest('input[type="text"]');
  if (!input) return;
  const index = parseInt(input.dataset.index, 10);
  const oldName = EXPENSE_CATEGORIES[index];
  const newName = input.value.trim();
  if (!newName) { input.value = oldName; return; }
  const duplicate = EXPENSE_CATEGORIES.some((c, i) => i !== index && c.toLowerCase() === newName.toLowerCase());
  if (duplicate) { alert("Já existe uma categoria com esse nome."); input.value = oldName; return; }
  if (newName === oldName) return;
  EXPENSE_CATEGORIES[index] = newName;
  expenses.forEach(e => { if (e.category === oldName) e.category = newName; });
  renderExpenseCategoriesList();
  renderExpenseFilterOptions();
  renderExpenses();
  await renameExpenseCategoryRemote(oldName, newName);
  await saveExpenses();
});

expenseCategoriesListEl.addEventListener("click", async e => {
  const btn = e.target.closest('button[data-act="del"]');
  if (!btn) return;
  const index = parseInt(btn.dataset.index, 10);
  const name = EXPENSE_CATEGORIES[index];
  if (EXPENSE_CATEGORIES.length === 1) { alert("Mantenha ao menos uma categoria cadastrada."); return; }
  const count = expenseCategoryUsageCount(name);
  const msg = count > 0
    ? `Excluir a categoria "${name}"? ${count} despesa(s) já usam esse valor — elas manterão "${name}" no registro, mas essa opção deixará de existir para novas despesas.`
    : `Excluir a categoria "${name}"?`;
  if (!confirm(msg)) return;
  EXPENSE_CATEGORIES.splice(index, 1);
  renderExpenseCategoriesList();
  renderExpenseFilterOptions();
  await deleteExpenseCategoryRemote(name);
});

async function addNewExpenseCategory() {
  const name = expenseCategoriesNewInput.value.trim();
  if (!name) return;
  const duplicate = EXPENSE_CATEGORIES.some(c => c.toLowerCase() === name.toLowerCase());
  if (duplicate) { alert("Já existe uma categoria com esse nome."); return; }
  EXPENSE_CATEGORIES.push(name);
  expenseCategoriesNewInput.value = "";
  renderExpenseCategoriesList();
  renderExpenseFilterOptions();
  expenseCategoriesNewInput.focus();
  await addExpenseCategoryRemote(name);
}
document.getElementById("expense-categories-add-btn").addEventListener("click", addNewExpenseCategory);
expenseCategoriesNewInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addNewExpenseCategory(); }
});

/* ---- Comissões ---- */
function renderCommissions() {
  const list = commissions.slice().sort((a, b) => b.createdAt - a.createdAt);
  const tbody = document.getElementById("fin-commissions-tbody");
  tbody.innerHTML = "";
  document.getElementById("fin-commissions-empty").style.display = list.length === 0 ? "block" : "none";
  list.forEach(c => {
    const consultant = users.find(u => u.id === c.consultorId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(consultant ? consultant.name : "—")}</td>
      <td class="cell-muted">${escapeHtml(c.dealName)}</td>
      <td class="cell-muted">${currency(c.dealValue)}</td>
      <td class="cell-muted">${c.percentage}%</td>
      <td class="cell-primary">${currency(c.amount)}</td>
      <td><span class="badge ${c.status === "Pago" ? "badge-good" : "badge-warn"}">${c.status}</span></td>
      <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="toggle-status" data-id="${c.id}">${c.status === "Pago" ? "Marcar pendente" : "Marcar pago"}</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("fin-commission-setting-wrap").style.display = session && session.role === "ADM" ? "flex" : "none";
  document.getElementById("fin-commission-pct").value = commissionSettings.defaultPercentage;
}

document.getElementById("fin-commissions-tbody").addEventListener("click", async e => {
  const btn = e.target.closest('button[data-act="toggle-status"]');
  if (!btn) return;
  const c = commissions.find(x => x.id === btn.dataset.id);
  if (!c) return;
  c.status = c.status === "Pago" ? "Pendente" : "Pago";
  c.paidAt = c.status === "Pago" ? Date.now() : null;
  renderCommissions();
  await saveCommission(c);
});

document.getElementById("fin-commission-pct-save").addEventListener("click", async () => {
  const pct = parseFloat(document.getElementById("fin-commission-pct").value) || 0;
  commissionSettings.defaultPercentage = pct;
  await updateCommissionSettingRemote(pct);
  alert("Comissão padrão atualizada.");
});

/* ============================================================
   MATRÍCULAS — documentos e dados do aluno, com link público
   para o próprio aluno preencher (sem precisar de login)
   ============================================================ */
let enrollments = [];

function enrollmentFromDb(r) {
  return {
    id: r.id, leadId: r.lead_id, consultorId: r.consultor_id,
    name: r.name, email: r.email || "", phone: r.phone || "",
    emergencyPhone: r.emergency_phone || "",
    passportNumber: r.passport_number || "", passportPhotoPath: r.passport_photo_path || null,
    cpf: r.cpf || "",
    addressStreet: r.address_street || "", addressNumber: r.address_number || "",
    addressComplement: r.address_complement || "", addressNeighborhood: r.address_neighborhood || "",
    addressCity: r.address_city || "", addressState: r.address_state || "", addressZip: r.address_zip || "",
    school: r.school || "", turno: r.turno || "",
    courseValue: Number(r.course_value) || 0,
    arrivalDate: r.arrival_date, classStartDate: r.class_start_date,
    status: r.status, publicToken: r.public_token,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function enrollmentToDb(e) {
  return {
    id: e.id, lead_id: e.leadId || null, consultor_id: e.consultorId || null,
    name: e.name, email: e.email, phone: e.phone,
    emergency_phone: e.emergencyPhone,
    passport_number: e.passportNumber, passport_photo_path: e.passportPhotoPath,
    cpf: e.cpf,
    address_street: e.addressStreet, address_number: e.addressNumber,
    address_complement: e.addressComplement, address_neighborhood: e.addressNeighborhood,
    address_city: e.addressCity, address_state: e.addressState, address_zip: e.addressZip,
    school: e.school, turno: e.turno,
    course_value: e.courseValue,
    arrival_date: e.arrivalDate || null, class_start_date: e.classStartDate || null,
    status: e.status,
  };
}

async function loadEnrollments() {
  const { data, error } = await supabase.from("enrollments").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar matrículas:", error); return []; }
  return data.map(enrollmentFromDb);
}
async function saveEnrollmentRemote(e) {
  const { data, error } = await supabase.from("enrollments").upsert(enrollmentToDb(e)).select().single();
  if (error) { console.error("Erro ao salvar matrícula:", error); return null; }
  return enrollmentFromDb(data);
}
async function deleteEnrollmentRemote(id) {
  const { error } = await supabase.from("enrollments").delete().eq("id", id);
  if (error) console.error("Erro ao excluir matrícula:", error);
}

async function uploadPassportPhoto(file, enrollmentId) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${enrollmentId}/passaporte-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("passport-photos").upload(path, file, { upsert: true });
  if (error) { console.error("Erro ao enviar foto do passaporte:", error); return null; }
  return path;
}
async function getPassportPhotoSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("passport-photos").createSignedUrl(path, 3600);
  if (error) { console.error("Erro ao gerar link da foto:", error); return null; }
  return data.signedUrl;
}

function buildPublicEnrollmentUrl(token) {
  return `${window.location.origin}${window.location.pathname.replace(/index\.html$/, "")}matricula-publica.html?token=${token}`;
}

const ENROLLMENT_STATUS_BADGE = {
  "Aguardando aluno": "badge-warn",
  "Preenchido pelo aluno": "badge-neutral",
  "Completo": "badge-good",
};

/* ---- lista ---- */
function getFilteredEnrollments() {
  const status = document.getElementById("enr-filter-status").value;
  return enrollments.filter(e => !status || e.status === status);
}

async function copyEnrollmentLink(enr, btnEl) {
  const url = buildPublicEnrollmentUrl(enr.publicToken);
  const original = btnEl.textContent;
  try {
    await navigator.clipboard.writeText(url);
    btnEl.textContent = "Copiado!";
  } catch {
    prompt("Copie o link abaixo:", url);
  }
  setTimeout(() => { btnEl.textContent = original; }, 1500);
}

function renderEnrollments() {
  const filtered = getFilteredEnrollments().slice().sort((a, b) => b.createdAt - a.createdAt);
  const tbody = document.getElementById("enrollments-tbody");
  tbody.innerHTML = "";
  document.getElementById("enrollments-empty").style.display = filtered.length === 0 ? "block" : "none";
  filtered.forEach(e => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(e.name || "—")}</td>
      <td class="cell-muted">${escapeHtml(e.school || "—")}</td>
      <td class="cell-muted">${escapeHtml(e.turno || "—")}</td>
      <td><span class="badge ${ENROLLMENT_STATUS_BADGE[e.status] || "badge-neutral"}">${escapeHtml(e.status)}</span></td>
      <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="copy-link">Copiar link</button></td>
    `;
    tr.querySelector('[data-act="copy-link"]').addEventListener("click", ev => {
      ev.stopPropagation();
      copyEnrollmentLink(e, ev.currentTarget);
    });
    tr.addEventListener("click", () => openEnrollmentModal(e.id));
    tbody.appendChild(tr);
  });
  renderEnrollmentsDashboard();
}

function renderEnrollmentsDashboard() {
  document.getElementById("enr-stat-total").textContent = enrollments.length;
  document.getElementById("enr-stat-waiting").textContent = enrollments.filter(e => e.status === "Aguardando aluno").length;
  document.getElementById("enr-stat-filled").textContent = enrollments.filter(e => e.status === "Preenchido pelo aluno").length;
  document.getElementById("enr-stat-complete").textContent = enrollments.filter(e => e.status === "Completo").length;
}

document.getElementById("enr-filter-status").addEventListener("change", renderEnrollments);
document.getElementById("enr-filter-clear").addEventListener("click", () => {
  document.getElementById("enr-filter-status").value = "";
  renderEnrollments();
});

/* ---- modal: nova matrícula (buscar lead de origem por nome/e-mail) ---- */
const enrollmentNewModalBackdrop = document.getElementById("enrollment-new-modal-backdrop");
const enrollmentLeadSearch = document.getElementById("enrollment-lead-search");
const enrollmentLeadResults = document.getElementById("enrollment-lead-results");
const enrollmentNewLeadId = document.getElementById("enrollment-new-lead-id");

function renderLeadSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) { enrollmentLeadResults.classList.remove("open"); enrollmentLeadResults.innerHTML = ""; return; }
  const matches = leads.filter(l =>
    (l.name && l.name.toLowerCase().includes(q)) || (l.email && l.email.toLowerCase().includes(q))
  ).slice(0, 8);
  enrollmentLeadResults.innerHTML = matches.length
    ? matches.map(l => `
      <div class="enr-lead-result-item" data-id="${l.id}">
        <div>${escapeHtml(l.name)}</div>
        <div class="sub">${escapeHtml(l.email || l.phone || "sem contato")}</div>
      </div>`).join("")
    : `<div class="enr-lead-result-empty">Nenhum lead encontrado</div>`;
  enrollmentLeadResults.classList.add("open");
}

enrollmentLeadSearch.addEventListener("input", () => {
  enrollmentNewLeadId.value = "";
  renderLeadSearchResults(enrollmentLeadSearch.value);
});
enrollmentLeadSearch.addEventListener("focus", () => {
  if (enrollmentLeadSearch.value.trim()) renderLeadSearchResults(enrollmentLeadSearch.value);
});
enrollmentLeadSearch.addEventListener("blur", () => {
  setTimeout(() => enrollmentLeadResults.classList.remove("open"), 150);
});
enrollmentLeadResults.addEventListener("mousedown", e => {
  const item = e.target.closest(".enr-lead-result-item[data-id]");
  if (!item) return;
  const lead = leads.find(l => l.id === item.dataset.id);
  if (!lead) return;
  enrollmentNewLeadId.value = lead.id;
  enrollmentLeadSearch.value = lead.name;
  enrollmentLeadResults.classList.remove("open");
});

function openNewEnrollmentModal() {
  enrollmentLeadSearch.value = "";
  enrollmentNewLeadId.value = "";
  enrollmentLeadResults.innerHTML = "";
  enrollmentLeadResults.classList.remove("open");
  enrollmentNewModalBackdrop.classList.add("open");
  enrollmentLeadSearch.focus();
}
function closeNewEnrollmentModal() { enrollmentNewModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-enrollment").addEventListener("click", openNewEnrollmentModal);
document.getElementById("enrollment-new-modal-close").addEventListener("click", closeNewEnrollmentModal);
document.getElementById("enrollment-new-btn-cancel").addEventListener("click", closeNewEnrollmentModal);
enrollmentNewModalBackdrop.addEventListener("click", e => { if (e.target === enrollmentNewModalBackdrop) closeNewEnrollmentModal(); });

document.getElementById("enrollment-new-form").addEventListener("submit", async e => {
  e.preventDefault();
  const leadId = enrollmentNewLeadId.value || null;
  const lead = leadId ? leads.find(l => l.id === leadId) : null;
  const draft = {
    leadId, consultorId: (lead ? lead.consultorId : null) || (isOwnLeadsOnly() ? session.id : null),
    name: lead ? lead.name : "", email: lead ? lead.email : "", phone: lead ? lead.phone : "",
    emergencyPhone: "", passportNumber: "", passportPhotoPath: null, cpf: "",
    addressStreet: "", addressNumber: "", addressComplement: "", addressNeighborhood: "",
    addressCity: "", addressState: "", addressZip: "",
    school: "", turno: "", courseValue: 0, arrivalDate: null, classStartDate: null,
    status: "Aguardando aluno",
  };
  const saved = await saveEnrollmentRemote(draft);
  if (!saved) { alert("Não foi possível criar a matrícula. Tente novamente."); return; }
  enrollments.push(saved);
  renderEnrollments();
  closeNewEnrollmentModal();
  openEnrollmentModal(saved.id);
});

/* ---- modal: matrícula (edição completa) ---- */
const enrollmentModalBackdrop = document.getElementById("enrollment-modal-backdrop");
const enrollmentForm = document.getElementById("enrollment-form");
const enrBtnDelete = document.getElementById("enr-btn-delete");

function renderEnrollmentDatalists() {
  const schools = [...new Set(catalog.map(c => c.subgrupo).filter(Boolean))].sort();
  const turnos = [...new Set(catalog.map(c => c.turno).filter(Boolean))].sort();
  document.getElementById("enr-schools-list").innerHTML = schools.map(s => `<option value="${escapeHtml(s)}">`).join("");
  document.getElementById("enr-turnos-list").innerHTML = turnos.map(t => `<option value="${escapeHtml(t)}">`).join("");
}

async function openEnrollmentModal(id) {
  enrollmentForm.reset();
  renderEnrollmentDatalists();
  const enr = enrollments.find(x => x.id === id);
  if (!enr) return;

  document.getElementById("enrollment-modal-title").textContent = enr.name || "Matrícula";
  document.getElementById("enr-id").value = enr.id;
  document.getElementById("enr-field-name").value = enr.name || "";
  document.getElementById("enr-field-status").value = enr.status || "Aguardando aluno";
  document.getElementById("enr-field-phone").value = enr.phone || "";
  document.getElementById("enr-field-email").value = enr.email || "";
  document.getElementById("enr-field-emergency").value = enr.emergencyPhone || "";
  document.getElementById("enr-field-cpf").value = enr.cpf || "";
  document.getElementById("enr-field-passport-number").value = enr.passportNumber || "";
  document.getElementById("enr-field-street").value = enr.addressStreet || "";
  document.getElementById("enr-field-number").value = enr.addressNumber || "";
  document.getElementById("enr-field-complement").value = enr.addressComplement || "";
  document.getElementById("enr-field-neighborhood").value = enr.addressNeighborhood || "";
  document.getElementById("enr-field-city").value = enr.addressCity || "";
  document.getElementById("enr-field-state").value = enr.addressState || "";
  document.getElementById("enr-field-zip").value = enr.addressZip || "";
  document.getElementById("enr-field-school").value = enr.school || "";
  document.getElementById("enr-field-turno").value = enr.turno || "";
  document.getElementById("enr-field-course-value").value = enr.courseValue || "";
  document.getElementById("enr-field-arrival").value = enr.arrivalDate || "";
  document.getElementById("enr-field-class-start").value = enr.classStartDate || "";

  const photoLink = document.getElementById("enr-photo-view-link");
  photoLink.style.display = "none";
  if (enr.passportPhotoPath) {
    getPassportPhotoSignedUrl(enr.passportPhotoPath).then(url => {
      if (url) { photoLink.href = url; photoLink.style.display = ""; }
    });
  }

  const linkRow = document.getElementById("enr-link-row");
  if (enr.publicToken) {
    linkRow.style.display = "flex";
    document.getElementById("enr-public-link").value = buildPublicEnrollmentUrl(enr.publicToken);
  } else {
    linkRow.style.display = "none";
  }

  enrBtnDelete.style.display = "inline-block";
  enrollmentModalBackdrop.classList.add("open");
}
function closeEnrollmentModal() { enrollmentModalBackdrop.classList.remove("open"); }

document.getElementById("enrollment-modal-close").addEventListener("click", closeEnrollmentModal);
document.getElementById("enr-btn-cancel").addEventListener("click", closeEnrollmentModal);
enrollmentModalBackdrop.addEventListener("click", e => { if (e.target === enrollmentModalBackdrop) closeEnrollmentModal(); });

document.getElementById("enr-copy-link").addEventListener("click", async () => {
  const input = document.getElementById("enr-public-link");
  input.select();
  const btn = document.getElementById("enr-copy-link");
  try {
    await navigator.clipboard.writeText(input.value);
    const original = btn.textContent;
    btn.textContent = "Copiado!";
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch {
    /* clipboard indisponível — o campo já fica selecionado para copiar com Ctrl/Cmd+C */
  }
});

enrollmentForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("enr-id").value;
  const enr = enrollments.find(x => x.id === id);
  if (!enr) return;

  const fileInput = document.getElementById("enr-field-passport-photo");
  const file = fileInput.files[0];
  if (file) {
    const path = await uploadPassportPhoto(file, enr.id);
    if (path) enr.passportPhotoPath = path;
  }

  Object.assign(enr, {
    name: document.getElementById("enr-field-name").value.trim(),
    status: document.getElementById("enr-field-status").value,
    phone: document.getElementById("enr-field-phone").value.trim(),
    email: document.getElementById("enr-field-email").value.trim(),
    emergencyPhone: document.getElementById("enr-field-emergency").value.trim(),
    cpf: document.getElementById("enr-field-cpf").value.trim(),
    passportNumber: document.getElementById("enr-field-passport-number").value.trim(),
    addressStreet: document.getElementById("enr-field-street").value.trim(),
    addressNumber: document.getElementById("enr-field-number").value.trim(),
    addressComplement: document.getElementById("enr-field-complement").value.trim(),
    addressNeighborhood: document.getElementById("enr-field-neighborhood").value.trim(),
    addressCity: document.getElementById("enr-field-city").value.trim(),
    addressState: document.getElementById("enr-field-state").value.trim(),
    addressZip: document.getElementById("enr-field-zip").value.trim(),
    school: document.getElementById("enr-field-school").value.trim(),
    turno: document.getElementById("enr-field-turno").value.trim(),
    courseValue: parseFloat(document.getElementById("enr-field-course-value").value) || 0,
    arrivalDate: document.getElementById("enr-field-arrival").value || null,
    classStartDate: document.getElementById("enr-field-class-start").value || null,
  });

  renderEnrollments();
  closeEnrollmentModal();
  await saveEnrollmentRemote(enr);
});

enrBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("enr-id").value;
  if (!id) return;
  if (!confirm("Excluir esta matrícula? Essa ação não pode ser desfeita.")) return;
  enrollments = enrollments.filter(x => x.id !== id);
  renderEnrollments();
  closeEnrollmentModal();
  await deleteEnrollmentRemote(id);
});

/* ============================================================
   COLABORADORES — cadastro de novos funcionários, com link
   público (sem login) para o próprio colaborador preencher seus
   dados pessoais e enviar documentos. Mesmo padrão de Matrículas.
   ============================================================ */
function collaboratorFromDb(r) {
  return {
    id: r.id, managerId: r.manager_id,
    name: r.name, workEmail: r.work_email || "", roleTitle: r.role_title || "",
    department: r.department || "", startDate: r.start_date, contractType: r.contract_type || "",
    birthDate: r.birth_date, cpf: r.cpf || "", rg: r.rg || "",
    maritalStatus: r.marital_status || "", nationality: r.nationality || "",
    personalPhone: r.personal_phone || "", personalEmail: r.personal_email || "",
    emergencyName: r.emergency_name || "", emergencyRelationship: r.emergency_relationship || "", emergencyPhone: r.emergency_phone || "",
    addressStreet: r.address_street || "", addressNumber: r.address_number || "",
    addressComplement: r.address_complement || "", addressNeighborhood: r.address_neighborhood || "",
    addressCity: r.address_city || "", addressState: r.address_state || "", addressZip: r.address_zip || "",
    idDocumentPath: r.id_document_path || null, addressProofPath: r.address_proof_path || null,
    photoPath: r.photo_path || null, resumePath: r.resume_path || null, workCardPath: r.work_card_path || null,
    status: r.status, publicToken: r.public_token,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function collaboratorToDb(c) {
  return {
    id: c.id, manager_id: c.managerId || null,
    name: c.name, work_email: c.workEmail, role_title: c.roleTitle,
    department: c.department, start_date: c.startDate || null, contract_type: c.contractType,
    birth_date: c.birthDate || null, cpf: c.cpf, rg: c.rg,
    marital_status: c.maritalStatus, nationality: c.nationality,
    personal_phone: c.personalPhone, personal_email: c.personalEmail,
    emergency_name: c.emergencyName, emergency_relationship: c.emergencyRelationship, emergency_phone: c.emergencyPhone,
    address_street: c.addressStreet, address_number: c.addressNumber,
    address_complement: c.addressComplement, address_neighborhood: c.addressNeighborhood,
    address_city: c.addressCity, address_state: c.addressState, address_zip: c.addressZip,
    id_document_path: c.idDocumentPath, address_proof_path: c.addressProofPath,
    photo_path: c.photoPath, resume_path: c.resumePath, work_card_path: c.workCardPath,
    status: c.status,
  };
}

async function loadCollaborators() {
  const { data, error } = await supabase.from("collaborators").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar colaboradores:", error); return []; }
  return data.map(collaboratorFromDb);
}
async function saveCollaboratorRemote(c) {
  const { data, error } = await supabase.from("collaborators").upsert(collaboratorToDb(c)).select().single();
  if (error) { console.error("Erro ao salvar colaborador:", error); return null; }
  return collaboratorFromDb(data);
}
async function deleteCollaboratorRemote(id) {
  const { error } = await supabase.from("collaborators").delete().eq("id", id);
  if (error) console.error("Erro ao excluir colaborador:", error);
}

const COLLAB_DOC_FIELDS = [
  { key: "idDocumentPath", input: "collab-field-id-document", link: "collab-id-document-view-link", slug: "rg-cpf" },
  { key: "addressProofPath", input: "collab-field-address-proof", link: "collab-address-proof-view-link", slug: "comprovante-residencia" },
  { key: "photoPath", input: "collab-field-photo", link: "collab-photo-view-link", slug: "foto-3x4" },
  { key: "resumePath", input: "collab-field-resume", link: "collab-resume-view-link", slug: "curriculo" },
  { key: "workCardPath", input: "collab-field-work-card", link: "collab-work-card-view-link", slug: "carteira-trabalho" },
];

async function uploadCollaboratorDocument(file, collaboratorId, slug) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${collaboratorId}/${slug}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("collaborator-documents").upload(path, file, { upsert: true });
  if (error) { console.error("Erro ao enviar documento do colaborador:", error); return null; }
  return path;
}
async function getCollaboratorDocSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("collaborator-documents").createSignedUrl(path, 3600);
  if (error) { console.error("Erro ao gerar link do documento:", error); return null; }
  return data.signedUrl;
}

/* link único e fixo, igual para qualquer novo colaborador — não há
   mais um token por pessoa; quem preenche cria o próprio cadastro */
function buildCollaboratorSignupUrl() {
  return `${window.location.origin}${window.location.pathname.replace(/index\.html$/, "")}colaborador-publico.html`;
}

document.getElementById("btn-copy-collaborator-signup-link").addEventListener("click", async e => {
  const url = buildCollaboratorSignupUrl();
  const btn = e.currentTarget;
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Copiado!";
  } catch {
    prompt("Copie o link abaixo:", url);
  }
  setTimeout(() => { btn.textContent = original; }, 1500);
});

const COLLAB_STATUS_BADGE = {
  "Aguardando colaborador": "badge-warn",
  "Preenchido pelo colaborador": "badge-neutral",
  "Completo": "badge-good",
};

let collaborators = [];

/* ---- aviso do time (dashboard, linha única de configuração) ---- */
let teamAnnouncement = { message: "", updatedByName: "", updatedAt: null };

async function loadTeamAnnouncement() {
  const { data, error } = await supabase.from("team_announcements").select("*").eq("id", 1).single();
  if (error || !data) return { message: "", updatedByName: "", updatedAt: null };
  return {
    message: data.message || "",
    updatedByName: data.updated_by_name || "",
    updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : null,
  };
}
async function updateTeamAnnouncementRemote(message) {
  const { error } = await supabase.from("team_announcements")
    .update({ message, updated_by_name: session.name || "", updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) console.error("Erro ao salvar aviso do time:", error);
}

/* ---- agenda do dashboard (tarefas, reuniões, avisos) ---- */
let agendaItems = [];

function agendaItemFromDb(r) {
  return {
    id: r.id, title: r.title, type: r.type, itemDate: r.item_date, itemTime: r.item_time,
    consultorId: r.consultor_id, notes: r.notes || "", done: r.done,
    googleEventId: r.google_event_id, createdBy: r.created_by,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function agendaItemToDb(a) {
  return {
    id: a.id, title: a.title, type: a.type, item_date: a.itemDate, item_time: a.itemTime,
    consultor_id: a.consultorId || null, notes: a.notes || "", done: !!a.done,
    google_event_id: a.googleEventId || null, created_by: a.createdBy || null,
  };
}
async function loadAgendaItems() {
  const { data, error } = await supabase.from("agenda_items").select("*").order("item_date", { ascending: true });
  if (error) { console.error("Erro ao carregar agenda:", error); return []; }
  return data.map(agendaItemFromDb);
}
async function saveAgendaItemRemote(a) {
  const { data, error } = await supabase.from("agenda_items").upsert(agendaItemToDb(a)).select().single();
  if (error) { console.error("Erro ao salvar item da agenda:", error); return null; }
  return agendaItemFromDb(data);
}
async function deleteAgendaItemRemote(id) {
  const { error } = await supabase.from("agenda_items").delete().eq("id", id);
  if (error) console.error("Erro ao excluir item da agenda:", error);
}

function getFilteredCollaborators() {
  const status = document.getElementById("collab-filter-status").value;
  return collaborators.filter(c => !status || c.status === status);
}

function renderCollaborators() {
  const filtered = getFilteredCollaborators().slice().sort((a, b) => b.createdAt - a.createdAt);
  const tbody = document.getElementById("collaborators-tbody");
  tbody.innerHTML = "";
  document.getElementById("collaborators-empty").style.display = filtered.length === 0 ? "block" : "none";
  filtered.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(c.name || "—")}</td>
      <td class="cell-muted">${escapeHtml(c.roleTitle || "—")}</td>
      <td class="cell-muted">${escapeHtml(c.department || "—")}</td>
      <td><span class="badge ${COLLAB_STATUS_BADGE[c.status] || "badge-neutral"}">${escapeHtml(c.status)}</span></td>
      <td class="cell-actions">›</td>
    `;
    tr.addEventListener("click", () => openCollaboratorModal(c.id));
    tbody.appendChild(tr);
  });
  renderCollaboratorsDashboard();
}

function renderCollaboratorsDashboard() {
  document.getElementById("collab-stat-total").textContent = collaborators.length;
  document.getElementById("collab-stat-waiting").textContent = collaborators.filter(c => c.status === "Aguardando colaborador").length;
  document.getElementById("collab-stat-filled").textContent = collaborators.filter(c => c.status === "Preenchido pelo colaborador").length;
  document.getElementById("collab-stat-complete").textContent = collaborators.filter(c => c.status === "Completo").length;
}

document.getElementById("collab-filter-status").addEventListener("change", renderCollaborators);
document.getElementById("collab-filter-clear").addEventListener("click", () => {
  document.getElementById("collab-filter-status").value = "";
  renderCollaborators();
});

/* ---- modal: colaborador (criar/editar em um único formulário) ---- */
const collaboratorModalBackdrop = document.getElementById("collaborator-modal-backdrop");
const collaboratorForm = document.getElementById("collaborator-form");
const collabBtnDelete = document.getElementById("collab-btn-delete");

function renderCollaboratorManagerOptions() {
  const sel = document.getElementById("collab-field-manager");
  const current = sel.value;
  const managers = users.filter(u => u.role === "ADM" || u.role === "Gerente").slice().sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">Sem gestor definido</option>` + managers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  sel.value = current;
}

function openCollaboratorModal(id) {
  collaboratorForm.reset();
  renderCollaboratorManagerOptions();
  COLLAB_DOC_FIELDS.forEach(f => { document.getElementById(f.link).style.display = "none"; });

  if (id) {
    const c = collaborators.find(x => x.id === id);
    if (!c) return;
    document.getElementById("collaborator-modal-title").textContent = c.name || "Colaborador";
    document.getElementById("collab-id").value = c.id;
    document.getElementById("collab-field-name").value = c.name || "";
    document.getElementById("collab-field-status").value = c.status || "Aguardando colaborador";
    document.getElementById("collab-field-work-email").value = c.workEmail || "";
    document.getElementById("collab-field-role-title").value = c.roleTitle || "";
    document.getElementById("collab-field-department").value = c.department || "";
    document.getElementById("collab-field-contract-type").value = c.contractType || "";
    document.getElementById("collab-field-start-date").value = c.startDate || "";
    document.getElementById("collab-field-manager").value = c.managerId || "";
    document.getElementById("collab-field-birth-date").value = c.birthDate || "";
    document.getElementById("collab-field-nationality").value = c.nationality || "";
    document.getElementById("collab-field-cpf").value = c.cpf || "";
    document.getElementById("collab-field-rg").value = c.rg || "";
    document.getElementById("collab-field-marital-status").value = c.maritalStatus || "";
    document.getElementById("collab-field-personal-phone").value = c.personalPhone || "";
    document.getElementById("collab-field-personal-email").value = c.personalEmail || "";
    document.getElementById("collab-field-street").value = c.addressStreet || "";
    document.getElementById("collab-field-number").value = c.addressNumber || "";
    document.getElementById("collab-field-complement").value = c.addressComplement || "";
    document.getElementById("collab-field-neighborhood").value = c.addressNeighborhood || "";
    document.getElementById("collab-field-city").value = c.addressCity || "";
    document.getElementById("collab-field-state").value = c.addressState || "";
    document.getElementById("collab-field-zip").value = c.addressZip || "";
    document.getElementById("collab-field-emergency-name").value = c.emergencyName || "";
    document.getElementById("collab-field-emergency-relationship").value = c.emergencyRelationship || "";
    document.getElementById("collab-field-emergency-phone").value = c.emergencyPhone || "";
    collabBtnDelete.style.display = "inline-block";

    COLLAB_DOC_FIELDS.forEach(f => {
      if (!c[f.key]) return;
      getCollaboratorDocSignedUrl(c[f.key]).then(url => {
        if (!url) return;
        const link = document.getElementById(f.link);
        link.href = url;
        link.style.display = "inline";
      });
    });
  } else {
    document.getElementById("collaborator-modal-title").textContent = "Novo colaborador";
    document.getElementById("collab-id").value = "";
    document.getElementById("collab-field-status").value = "Aguardando colaborador";
    collabBtnDelete.style.display = "none";
  }

  collaboratorModalBackdrop.classList.add("open");
  document.getElementById("collab-field-name").focus();
}
function closeCollaboratorModal() { collaboratorModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-collaborator").addEventListener("click", () => openCollaboratorModal(null));
document.getElementById("collaborator-modal-close").addEventListener("click", closeCollaboratorModal);
document.getElementById("collab-btn-cancel").addEventListener("click", closeCollaboratorModal);
collaboratorModalBackdrop.addEventListener("click", e => { if (e.target === collaboratorModalBackdrop) closeCollaboratorModal(); });

collaboratorForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("collab-id").value;
  const isNew = !id;
  const collabId = id || uid();

  const data = {
    id: collabId,
    name: document.getElementById("collab-field-name").value.trim(),
    status: document.getElementById("collab-field-status").value,
    workEmail: document.getElementById("collab-field-work-email").value.trim(),
    roleTitle: document.getElementById("collab-field-role-title").value.trim(),
    department: document.getElementById("collab-field-department").value.trim(),
    contractType: document.getElementById("collab-field-contract-type").value,
    startDate: document.getElementById("collab-field-start-date").value || null,
    managerId: document.getElementById("collab-field-manager").value || null,
    birthDate: document.getElementById("collab-field-birth-date").value || null,
    nationality: document.getElementById("collab-field-nationality").value.trim(),
    cpf: document.getElementById("collab-field-cpf").value.trim(),
    rg: document.getElementById("collab-field-rg").value.trim(),
    maritalStatus: document.getElementById("collab-field-marital-status").value,
    personalPhone: document.getElementById("collab-field-personal-phone").value.trim(),
    personalEmail: document.getElementById("collab-field-personal-email").value.trim(),
    addressStreet: document.getElementById("collab-field-street").value.trim(),
    addressNumber: document.getElementById("collab-field-number").value.trim(),
    addressComplement: document.getElementById("collab-field-complement").value.trim(),
    addressNeighborhood: document.getElementById("collab-field-neighborhood").value.trim(),
    addressCity: document.getElementById("collab-field-city").value.trim(),
    addressState: document.getElementById("collab-field-state").value.trim(),
    addressZip: document.getElementById("collab-field-zip").value.trim(),
    emergencyName: document.getElementById("collab-field-emergency-name").value.trim(),
    emergencyRelationship: document.getElementById("collab-field-emergency-relationship").value.trim(),
    emergencyPhone: document.getElementById("collab-field-emergency-phone").value.trim(),
  };

  const existing = isNew ? null : collaborators.find(x => x.id === id);
  const merged = existing ? Object.assign(existing, data) : data;

  for (const f of COLLAB_DOC_FIELDS) {
    const file = document.getElementById(f.input).files[0];
    if (!file) continue;
    const path = await uploadCollaboratorDocument(file, collabId, f.slug);
    if (path) merged[f.key] = path;
  }

  const saved = await saveCollaboratorRemote(merged);
  if (!saved) { alert("Não foi possível salvar o colaborador. Tente novamente."); return; }

  if (existing) Object.assign(existing, saved);
  else collaborators.push(saved);

  renderCollaborators();
  closeCollaboratorModal();
});

collabBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("collab-id").value;
  if (!id || !confirm("Excluir este colaborador? Essa ação não pode ser desfeita.")) return;
  collaborators = collaborators.filter(x => x.id !== id);
  renderCollaborators();
  closeCollaboratorModal();
  await deleteCollaboratorRemote(id);
});

/* ============================================================
   FORMULÁRIOS — construtor simples de formulários públicos. Cada
   envio cria um lead automaticamente: campos especiais (nome/
   e-mail/telefone/origem) alimentam as colunas do lead; qualquer
   outro campo extra vira uma linha em leads.notes. O envio em si
   roda todo no banco (RPC security definer), sem passar por aqui.
   ============================================================ */
const FORM_FIELD_TYPES = [
  { value: "name", label: "Nome (vira o nome do lead)" },
  { value: "email", label: "E-mail (vira o e-mail do lead)" },
  { value: "phone_br", label: "Telefone com DDD (vira o telefone do lead)" },
  { value: "source", label: "Origem (como o lead chegou até nós)" },
  { value: "boolean", label: "Sim / Não" },
  { value: "date", label: "Data" },
  { value: "text", label: "Texto curto" },
  { value: "textarea", label: "Texto longo" },
  { value: "select", label: "Lista de opções personalizada" },
];

let forms = [];
let formSubmissions = [];

function formFromDb(r) {
  return {
    id: r.id, title: r.title || "Formulário", subtitle: r.subtitle || "",
    slug: r.slug, fields: Array.isArray(r.fields) ? r.fields : [], active: r.active !== false,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function formToDb(f) {
  return {
    id: f.id, title: f.title, subtitle: f.subtitle, slug: f.slug,
    fields: f.fields, active: f.active, updated_at: new Date().toISOString(),
  };
}

async function loadForms() {
  const { data, error } = await supabase.from("forms").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar formulários:", error); return []; }
  return data.map(formFromDb);
}
function formSubmissionFromDb(r) {
  return {
    id: r.id, formId: r.form_id, answers: r.answers || {}, leadId: r.lead_id,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
async function loadFormSubmissions() {
  const { data, error } = await supabase.from("form_submissions").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar respostas de formulários:", error); return []; }
  return data.map(formSubmissionFromDb);
}
async function markSubmissionLeadRemote(submissionId, leadId) {
  const { error } = await supabase.from("form_submissions").update({ lead_id: leadId }).eq("id", submissionId);
  if (error) console.error("Erro ao vincular lead à resposta:", error);
}
async function saveFormRemote(f) {
  const { data, error } = await supabase.from("forms").upsert(formToDb(f)).select().single();
  if (error) { console.error("Erro ao salvar formulário:", error); return null; }
  return formFromDb(data);
}
async function deleteFormRemote(id) {
  const { error } = await supabase.from("forms").delete().eq("id", id);
  if (error) console.error("Erro ao excluir formulário:", error);
}

function slugify(text) {
  return (text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "formulario";
}
function uniqueFormSlug(base) {
  let slug = base, i = 2;
  while (forms.some(f => f.slug === slug)) { slug = `${base}-${i}`; i++; }
  return slug;
}
function buildFormPublicUrl(slug) {
  return `${window.location.origin}/formulario-publico.html?f=${encodeURIComponent(slug)}`;
}
function canManageForms() {
  return !!(session && ["ADM", "Gerente", "MKT"].includes(session.role));
}

function formSubmissionCount(formId) {
  return formSubmissions.filter(s => s.formId === formId).length;
}

function renderFormsList() {
  document.getElementById("btn-new-form").style.display = canManageForms() ? "" : "none";
  const tbody = document.getElementById("forms-tbody");
  tbody.innerHTML = "";
  document.getElementById("forms-empty").style.display = forms.length === 0 ? "block" : "none";
  forms.slice().sort((a, b) => b.createdAt - a.createdAt).forEach(f => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(f.title)}</td>
      <td class="cell-muted">${escapeHtml(f.subtitle || "—")}</td>
      <td class="cell-muted">${f.fields.length}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-act="responses">Respostas (${formSubmissionCount(f.id)})</button></td>
      <td class="cell-actions">
        <div class="cell-actions-row">
          <button type="button" class="cell-copy-btn" data-act="copy" title="Copiar link">${CELL_COPY_ICON_SVG}</button>
          <span>›</span>
        </div>
      </td>
    `;
    tr.addEventListener("click", () => openFormModal(f.id));
    tr.querySelector('[data-act="copy"]').addEventListener("click", e => {
      e.stopPropagation();
      navigator.clipboard.writeText(buildFormPublicUrl(f.slug));
      const btn = e.currentTarget;
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1500);
    });
    tr.querySelector('[data-act="responses"]').addEventListener("click", e => {
      e.stopPropagation();
      openFormResponses(f.id);
    });
    tbody.appendChild(tr);
  });
}

/* ---- construtor de campos, dentro do modal do formulário ---- */
let formBuilderFields = [];
let formBuilderFieldSeq = 0;
let formBuilderReadOnly = false;

function newFormFieldId() {
  formBuilderFieldSeq++;
  return `campo_${Date.now().toString(36)}${formBuilderFieldSeq}`;
}

function renderFormBuilderFields() {
  const container = document.getElementById("form-builder-fields");
  const dis = formBuilderReadOnly ? "disabled" : "";
  container.innerHTML = formBuilderFields.map((f, i) => `
    <div class="form-field-row" data-index="${i}">
      <div class="form-field-row-main">
        <input type="text" class="ff-label" ${dis} placeholder="Pergunta" value="${escapeHtml(f.label || "")}">
        <select class="ff-type" ${dis}>
          ${FORM_FIELD_TYPES.map(t => `<option value="${t.value}" ${f.type === t.value ? "selected" : ""}>${escapeHtml(t.label)}</option>`).join("")}
        </select>
      </div>
      <div class="form-field-row-sub">
        <label class="checkbox-label"><input type="checkbox" class="ff-required" ${dis} ${f.required ? "checked" : ""}><span>Obrigatório</span></label>
        <input type="text" class="ff-options" ${dis} placeholder="Opções separadas por vírgula" value="${escapeHtml((f.options || []).join(", "))}" style="${f.type === "select" ? "" : "display:none;"}">
        ${formBuilderReadOnly ? "" : '<button type="button" class="btn-icon ff-delete" title="Excluir campo">&times;</button>'}
      </div>
    </div>`).join("");
}

document.getElementById("form-builder-fields").addEventListener("input", e => {
  const row = e.target.closest(".form-field-row");
  if (!row) return;
  const i = parseInt(row.dataset.index, 10);
  if (e.target.classList.contains("ff-label")) formBuilderFields[i].label = e.target.value;
  if (e.target.classList.contains("ff-options")) {
    formBuilderFields[i].options = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
  }
});
document.getElementById("form-builder-fields").addEventListener("change", e => {
  const row = e.target.closest(".form-field-row");
  if (!row) return;
  const i = parseInt(row.dataset.index, 10);
  if (e.target.classList.contains("ff-type")) {
    formBuilderFields[i].type = e.target.value;
    renderFormBuilderFields();
  }
  if (e.target.classList.contains("ff-required")) formBuilderFields[i].required = e.target.checked;
});
document.getElementById("form-builder-fields").addEventListener("click", e => {
  const btn = e.target.closest(".ff-delete");
  if (!btn) return;
  const i = parseInt(btn.closest(".form-field-row").dataset.index, 10);
  formBuilderFields.splice(i, 1);
  renderFormBuilderFields();
});
document.getElementById("form-btn-add-field").addEventListener("click", () => {
  formBuilderFields.push({ id: newFormFieldId(), label: "", type: "text", required: false, options: [] });
  renderFormBuilderFields();
});

/* ---- modal do formulário (criar/editar) ---- */
const formModalBackdrop = document.getElementById("form-modal-backdrop");
const formBuilderForm = document.getElementById("form-builder-form");
const formBtnDelete = document.getElementById("form-btn-delete");
const formBtnCopyLink = document.getElementById("form-btn-copy-link");
let formModalSlug = "";

function openFormModal(id) {
  formBuilderForm.reset();
  const existing = id ? forms.find(f => f.id === id) : null;
  formBuilderReadOnly = !canManageForms();

  if (existing) {
    document.getElementById("form-modal-title").textContent = existing.title;
    document.getElementById("form-id").value = existing.id;
    document.getElementById("form-field-title").value = existing.title;
    document.getElementById("form-field-subtitle").value = existing.subtitle;
    formBuilderFields = existing.fields.map(f => ({ ...f, options: f.options || [] }));
    formModalSlug = existing.slug;
    formBtnDelete.style.display = formBuilderReadOnly ? "none" : "inline-block";
    formBtnCopyLink.style.display = "inline-block";
  } else {
    document.getElementById("form-modal-title").textContent = "Novo formulário";
    document.getElementById("form-id").value = "";
    formBuilderFields = [];
    formModalSlug = "";
    formBtnDelete.style.display = "none";
    formBtnCopyLink.style.display = "none";
  }
  renderFormBuilderFields();

  document.getElementById("form-field-title").disabled = formBuilderReadOnly;
  document.getElementById("form-field-subtitle").disabled = formBuilderReadOnly;
  document.getElementById("form-btn-add-field").style.display = formBuilderReadOnly ? "none" : "";
  formBuilderForm.querySelector('button[type="submit"]').style.display = formBuilderReadOnly ? "none" : "";

  formModalBackdrop.classList.add("open");
  if (!formBuilderReadOnly) document.getElementById("form-field-title").focus();
}
function closeFormModal() { formModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-form").addEventListener("click", () => openFormModal(null));
document.getElementById("form-modal-close").addEventListener("click", closeFormModal);
document.getElementById("form-btn-cancel").addEventListener("click", closeFormModal);
formModalBackdrop.addEventListener("click", e => { if (e.target === formModalBackdrop) closeFormModal(); });

formBtnCopyLink.addEventListener("click", () => {
  if (!formModalSlug) return;
  navigator.clipboard.writeText(buildFormPublicUrl(formModalSlug));
  formBtnCopyLink.textContent = "Copiado!";
  setTimeout(() => { formBtnCopyLink.textContent = "Copiar link"; }, 1500);
});

formBuilderForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (formBuilderReadOnly) return;
  const id = document.getElementById("form-id").value;
  const title = document.getElementById("form-field-title").value.trim();
  const subtitle = document.getElementById("form-field-subtitle").value.trim();
  if (!formBuilderFields.length) {
    alert("Adicione ao menos um campo ao formulário.");
    return;
  }
  if (formBuilderFields.some(f => !f.label.trim())) {
    alert("Preencha o texto de todas as perguntas do formulário.");
    return;
  }

  const slug = id ? formModalSlug : uniqueFormSlug(slugify(title));
  const data = {
    id: id || uid(),
    title, subtitle, slug,
    fields: formBuilderFields.map(f => ({
      id: f.id, label: f.label.trim(), type: f.type, required: !!f.required,
      ...(f.type === "select" ? { options: f.options || [] } : {}),
    })),
    active: true,
  };

  const saved = await saveFormRemote(data);
  if (!saved) { alert("Não foi possível salvar o formulário. Tente novamente."); return; }

  if (id) {
    const idx = forms.findIndex(x => x.id === id);
    if (idx >= 0) forms[idx] = saved; else forms.push(saved);
  } else {
    forms.push(saved);
  }
  renderFormsList();
  closeFormModal();
});

formBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("form-id").value;
  if (!id || !confirm("Excluir este formulário? O link público deixará de funcionar. Essa ação não pode ser desfeita.")) return;
  forms = forms.filter(f => f.id !== id);
  renderFormsList();
  closeFormModal();
  await deleteFormRemote(id);
});

/* ---- tela de respostas de um formulário (por formulário) ---- */
let formResponsesFormId = null;

function openFormResponses(formId) {
  formResponsesFormId = formId;
  const form = forms.find(f => f.id === formId);
  document.getElementById("fr-title").textContent = form ? `Respostas — ${form.title}` : "Respostas";
  document.getElementById("subview-formularios-lista").classList.remove("active");
  document.getElementById("subview-formularios-respostas").classList.add("active");
  renderFormResponses();
}
function closeFormResponses() {
  document.getElementById("subview-formularios-respostas").classList.remove("active");
  document.getElementById("subview-formularios-lista").classList.add("active");
  formResponsesFormId = null;
}
document.getElementById("fr-btn-voltar").addEventListener("click", closeFormResponses);

function renderFormResponses() {
  const form = forms.find(f => f.id === formResponsesFormId);
  const thead = document.getElementById("fr-thead");
  const tbody = document.getElementById("fr-tbody");
  if (!form) { thead.innerHTML = ""; tbody.innerHTML = ""; return; }

  const canConvert = hasModuleAccess(session.role, "leads");
  const consultants = users.filter(u => u.role === "Consultor");

  thead.innerHTML = `<tr>
    ${form.fields.map(f => `<th>${escapeHtml(f.label)}</th>`).join("")}
    <th>Recebido em</th>
    <th>Lead</th>
  </tr>`;

  const rows = formSubmissions.filter(s => s.formId === form.id).sort((a, b) => b.createdAt - a.createdAt);
  document.getElementById("fr-empty").style.display = rows.length === 0 ? "block" : "none";
  document.getElementById("fr-table").style.display = rows.length === 0 ? "none" : "table";

  tbody.innerHTML = rows.map(s => {
    const cells = form.fields.map(f => {
      const raw = s.answers ? s.answers[f.id] : "";
      const value = f.type === "date" && raw ? formatDate(raw) : (raw || "—");
      return `<td>${escapeHtml(value)}</td>`;
    }).join("");
    const when = new Date(s.createdAt).toLocaleString("pt-BR");

    let leadCell;
    if (s.leadId) {
      leadCell = `<button type="button" class="fr-lead-badge" data-act="view-lead" data-lead-id="${s.leadId}">✓ Ver lead</button>`;
    } else if (canConvert) {
      leadCell = `
        <div class="fr-convert-cell">
          <select data-role="consultor">
            <option value="">Sem consultor</option>
            ${consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
          <button type="button" class="btn btn-primary btn-sm" data-act="convert" data-submission-id="${s.id}">Transformar em lead</button>
        </div>`;
    } else {
      leadCell = "—";
    }

    return `<tr>${cells}<td>${when}</td><td>${leadCell}</td></tr>`;
  }).join("");

  tbody.querySelectorAll('[data-act="convert"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const consultorSel = row.querySelector('[data-role="consultor"]');
      btn.disabled = true;
      btn.textContent = "Salvando…";
      await convertSubmissionToLead(btn.dataset.submissionId, consultorSel.value || null);
    });
  });
  tbody.querySelectorAll('[data-act="view-lead"]').forEach(btn => {
    btn.addEventListener("click", () => {
      if (!canAccessView("leads")) return;
      switchView("leads");
      openLeadModal(btn.dataset.leadId);
    });
  });
}

function buildLeadFromSubmission(form, submission) {
  const answers = submission.answers || {};
  let name = "", email = "", ddd = "", number = "", source = "Outro", notes = "";

  form.fields.forEach(f => {
    const val = (answers[f.id] || "").toString().trim();
    if (f.type === "name") name = val;
    else if (f.type === "email") email = val;
    else if (f.type === "phone_br") {
      const digits = val.replace(/\D/g, "");
      ddd = digits.slice(0, 2);
      number = digits.slice(2);
    } else if (f.type === "source") {
      source = val || "Outro";
    } else if (val) {
      notes += `${f.label}: ${val}\n`;
    }
  });

  return {
    id: uid(), name: name || "Lead sem nome", company: "", email,
    countryCode: "BR", phoneDdd: ddd, phoneNumber: number,
    phone: ddd && number ? `(${ddd}) ${number}` : "",
    source, category: "Outro", status: "Novo", temperature: "Morno",
    consultorId: null, active: true, notes: notes.trim(),
    createdAt: Date.now(),
  };
}

async function convertSubmissionToLead(submissionId, consultorId) {
  const submission = formSubmissions.find(s => s.id === submissionId);
  const form = forms.find(f => f.id === formResponsesFormId);
  if (!submission || !form) return;

  const lead = buildLeadFromSubmission(form, submission);
  lead.consultorId = consultorId || null;

  leads.push(lead);
  await saveLeads();

  submission.leadId = lead.id;
  await markSubmissionLeadRemote(submission.id, lead.id);

  renderFormResponses();
  renderFormsList();
  renderLeads();
}

/* ============================================================
   DASHBOARD — visão geral com funil, gráficos e alertas
   ============================================================ */
if (window.Chart) {
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  Chart.defaults.color = "#8891a5";
}

const DASH_PALETTE = ["#3167a1", "#fb9d2d", "#1f4670", "#6faed6", "#16a34a", "#e2483d", "#8891a5", "#9b6dd6"];
const MONTH_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
let dashCharts = {};

function destroyDashChart(key) {
  if (dashCharts[key]) { dashCharts[key].destroy(); delete dashCharts[key]; }
}

function renderDashboardView() {
  renderDashboardStatCards();
  renderDashboardFunnel();
  renderDashboardOrigemChart();
  renderDashboardFaturamentoChart();
  renderDashboardRankingChart();
  renderDashboardAlertas();
  renderDashboardAtividade();
  renderDashCalendar();
  renderDashAgendaDay();
  renderTeamMessagePanel();
  renderDashFollowupsPanel();
  renderDashFinanceiroVencidoPanel();
}

/* ---- cartões de estatística ---- */
function renderDashboardStatCards() {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86400000;
  const activeLeads = leads.filter(l => l.active !== false);
  const newLeads = activeLeads.filter(l => l.createdAt >= sevenDaysAgo).length;

  const openDeals = deals.filter(d => !isClosedStage(d.stage));
  const openValue = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);

  const closedDeals = deals.filter(d => isClosedStage(d.stage));
  const wonDeals = deals.filter(d => isWonStage(d.stage));
  const conversion = closedDeals.length === 0 ? 0 : Math.round((wonDeals.length / closedDeals.length) * 100);

  const cards = [
    { label: "Leads novos (7 dias)", value: String(newLeads) },
    { label: "Negócios em aberto", value: `${openDeals.length} · ${currency(openValue)}` },
    { label: "Taxa de conversão", value: `${conversion}%`, good: true },
  ];

  if (hasModuleAccess(session.role, "financeiro")) {
    const now2 = new Date();
    const monthStart = new Date(now2.getFullYear(), now2.getMonth(), 1).getTime();
    const monthEnd = new Date(now2.getFullYear(), now2.getMonth() + 1, 1).getTime();
    const revenue = deals
      .filter(d => isWonStage(d.stage) && d.closedAt >= monthStart && d.closedAt < monthEnd)
      .reduce((s, d) => s + (Number(d.value) || 0), 0);
    const pendingReceivable = receivables.filter(r => !r.paid).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    cards.push({ label: "Faturamento (mês)", value: currency(revenue), good: true });
    cards.push({ label: "A receber pendente", value: currency(pendingReceivable) });
  }

  if (hasModuleAccess(session.role, "matriculas")) {
    const waiting = enrollments.filter(e => e.status === "Aguardando aluno").length;
    cards.push({ label: "Matrículas aguardando aluno", value: String(waiting) });
  }

  document.getElementById("dash-stat-row").innerHTML = cards.map(c => `
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(c.label)}</span>
      <span class="stat-value${c.good ? " stat-good" : ""}">${c.value}</span>
    </div>`).join("");
}

/* ---- funil de vendas ---- */
function renderDashboardFunnel() {
  const container = document.getElementById("dash-funnel");
  const openStages = STAGES.filter(s => !s.isLost);

  if (deals.length === 0 || openStages.length === 0) {
    container.innerHTML = `<p class="muted-note dash-funnel-empty">Nenhum negócio no pipeline ainda.</p>`;
    return;
  }

  const counts = openStages.map(s => deals.filter(d => d.stage === s.id).length);
  const maxCount = Math.max(1, ...counts);
  const lostCount = deals.filter(d => isLostStage(d.stage)).length;

  const rows = openStages.map((s, i) => {
    const count = counts[i];
    const pct = count === 0 ? 10 : Math.max(22, Math.round((count / maxCount) * 100));
    const color = s.isWon ? "#16a34a" : DASH_PALETTE[i % DASH_PALETTE.length];
    return `
      <div class="dash-funnel-row">
        <div class="dash-funnel-bar-wrap">
          <div class="dash-funnel-bar" style="width:${pct}%; background:${color};">
            <span class="n">${count}</span>
          </div>
        </div>
        <div class="dash-funnel-label">${escapeHtml(s.label)}</div>
      </div>`;
  }).join("");

  const lostHtml = lostCount > 0
    ? `<p class="muted-note" style="margin-top:6px;">+ ${lostCount} negócio(s) perdido(s) no funil atual</p>`
    : "";

  container.innerHTML = rows + lostHtml;
}

/* ---- gráfico: leads por origem (pizza) ---- */
function renderDashboardOrigemChart() {
  const canvas = document.getElementById("dash-chart-origem");
  const emptyEl = document.getElementById("dash-chart-origem-empty");
  destroyDashChart("origem");

  const counts = {};
  leads.filter(l => l.active !== false).forEach(l => {
    const k = l.source || "Outro";
    counts[k] = (counts[k] || 0) + 1;
  });
  const labels = Object.keys(counts);

  if (!labels.length) {
    canvas.style.display = "none";
    emptyEl.style.display = "block";
    return;
  }
  canvas.style.display = "";
  emptyEl.style.display = "none";

  dashCharts.origem = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: labels.map(k => counts[k]),
        backgroundColor: labels.map((_, i) => DASH_PALETTE[i % DASH_PALETTE.length]),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: { legend: { position: "right", labels: { boxWidth: 10, padding: 12, font: { size: 11.5 }, usePointStyle: true } } },
    },
  });
}

/* ---- gráfico: faturamento últimos 6 meses (barras) ---- */
function renderDashboardFaturamentoChart() {
  const panel = document.getElementById("dash-panel-faturamento");
  const grid = document.getElementById("dash-row-charts");
  if (!hasModuleAccess(session.role, "financeiro")) {
    panel.style.display = "none";
    grid.classList.add("dash-single");
    return;
  }
  panel.style.display = "";
  grid.classList.remove("dash-single");

  const canvas = document.getElementById("dash-chart-faturamento");
  destroyDashChart("faturamento");

  const now = new Date();
  const labels = [];
  const data = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStart = monthDate.getTime();
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1).getTime();
    const total = deals
      .filter(d => isWonStage(d.stage) && d.closedAt >= monthStart && d.closedAt < monthEnd)
      .reduce((s, d) => s + (Number(d.value) || 0), 0);
    labels.push(MONTH_ABBR[monthDate.getMonth()]);
    data.push(total);
  }

  dashCharts.faturamento = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: "#4f7df3", borderRadius: 6, maxBarThickness: 40 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => currency(ctx.parsed.y) } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => currency(v).replace(",00", "") } },
        x: { grid: { display: false } },
      },
    },
  });
}

/* ---- gráfico: ranking de consultores (barras) ---- */
function renderDashboardRankingChart() {
  const panel = document.getElementById("dash-panel-ranking");
  const isManager = session.role === "ADM" || session.role === "Gerente";
  if (!isManager) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  const totals = {};
  deals.filter(d => isWonStage(d.stage) && d.closedAt >= monthStart && d.closedAt < monthEnd).forEach(d => {
    const lead = d.leadId ? leads.find(l => l.id === d.leadId) : null;
    const consultorId = lead ? lead.consultorId : null;
    if (!consultorId) return;
    totals[consultorId] = (totals[consultorId] || 0) + (Number(d.value) || 0);
  });

  const rows = Object.entries(totals)
    .map(([id, value]) => ({ name: (users.find(u => u.id === id) || {}).name || "—", value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const canvas = document.getElementById("dash-chart-ranking");
  const emptyEl = document.getElementById("dash-chart-ranking-empty");
  destroyDashChart("ranking");

  if (!rows.length) {
    canvas.style.display = "none";
    emptyEl.style.display = "block";
    return;
  }
  canvas.style.display = "";
  emptyEl.style.display = "none";

  dashCharts.ranking = new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map(r => r.name),
      datasets: [{
        data: rows.map(r => r.value),
        backgroundColor: rows.map((_, i) => DASH_PALETTE[i % DASH_PALETTE.length]),
        borderRadius: 6,
        maxBarThickness: 34,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => currency(ctx.parsed.x) } } },
      scales: { x: { beginAtZero: true, ticks: { callback: v => currency(v).replace(",00", "") } } },
    },
  });
}

/* ---- lista: atenção necessária (vencidos) ---- */
function renderDashboardAlertas() {
  const panel = document.getElementById("dash-panel-alertas");
  const listRow = document.getElementById("dash-row-lists");
  if (!hasModuleAccess(session.role, "financeiro")) {
    panel.style.display = "none";
    listRow.classList.add("dash-single");
    return;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueReceivables = receivables.filter(r => !r.paid && r.dueDate && r.dueDate < todayIso);
  const overdueExpenses = expenses.filter(e => !e.paid && e.dueDate && e.dueDate < todayIso);

  const items = [
    ...overdueReceivables.map(r => ({
      title: `${r.clientName || "Cliente"} — parcela ${r.installmentNumber}/${r.installmentsTotal}`,
      sub: `Venceu em ${formatDate(r.dueDate)}`, value: currency(r.amount), date: r.dueDate,
    })),
    ...overdueExpenses.map(e => ({
      title: e.description, sub: `Despesa venceu em ${formatDate(e.dueDate)}`, value: currency(e.amount), date: e.dueDate,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);

  if (!items.length) {
    panel.style.display = "none";
    listRow.classList.add("dash-single");
    return;
  }
  panel.style.display = "";
  listRow.classList.remove("dash-single");

  document.getElementById("dash-alertas-list").innerHTML = items.map(it => `
    <div class="dash-list-item">
      <span class="dash-list-icon warn">!</span>
      <div class="dash-list-body">
        <div class="dash-list-title">${escapeHtml(it.title)}</div>
        <div class="dash-list-sub">${escapeHtml(it.sub)}</div>
      </div>
      <span class="dash-list-value danger">${it.value}</span>
    </div>`).join("");
}

/* ---- lista: atividade recente ---- */
function renderDashboardAtividade() {
  const recentLeads = leads.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5)
    .map(l => ({ kind: "lead", id: l.id, title: l.name, sub: `Novo lead · ${l.source || "Outro"}`, date: l.createdAt }));

  const recentDeals = deals.filter(d => isClosedStage(d.stage) && d.closedAt).slice()
    .sort((a, b) => b.closedAt - a.closedAt).slice(0, 5)
    .map(d => ({
      kind: "deal", id: d.id, title: d.name,
      sub: isWonStage(d.stage) ? `Negócio ganho · ${currency(d.value)}` : "Negócio perdido",
      date: d.closedAt, won: isWonStage(d.stage),
    }));

  const items = [...recentLeads, ...recentDeals].sort((a, b) => b.date - a.date).slice(0, 8);

  const listEl = document.getElementById("dash-atividade-list");
  if (!items.length) {
    listEl.innerHTML = `<p class="muted-note" style="padding:16px 20px;">Nenhuma atividade recente ainda.</p>`;
    return;
  }

  listEl.innerHTML = items.map(it => {
    const iconClass = it.kind === "lead" ? "info" : (it.won ? "good" : "warn");
    const icon = it.kind === "lead" ? "+" : (it.won ? "✓" : "×");
    return `
      <div class="dash-list-item dash-activity-item" data-kind="${it.kind}" data-id="${it.id}">
        <span class="dash-list-icon ${iconClass}">${icon}</span>
        <div class="dash-list-body">
          <div class="dash-list-title">${escapeHtml(it.title)}</div>
          <div class="dash-list-sub">${escapeHtml(it.sub)}</div>
        </div>
        <span class="dash-list-value">${new Date(it.date).toLocaleDateString("pt-BR")}</span>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".dash-activity-item").forEach(el => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
      const kind = el.dataset.kind;
      const id = el.dataset.id;
      if (kind === "lead" && canAccessView("leads")) {
        switchView("leads");
        openLeadModal(id);
      } else if (kind === "deal" && canAccessView("pipeline")) {
        switchView("pipeline");
        openDealModal(id);
      }
    });
  });
}

/* ---- barra lateral do dashboard: calendário ---- */
let dashCalendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let dashCalendarSelectedDate = new Date().toISOString().slice(0, 10);
const DASH_CAL_DOW = ["D", "S", "T", "Q", "Q", "S", "S"];
const DASH_CAL_MONTH_LABEL = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const AGENDA_TYPE_LABELS = { tarefa: "Tarefa", reuniao: "Reunião", aviso: "Aviso" };

function renderDashCalendar() {
  const grid = document.getElementById("dash-calendar");
  const year = dashCalendarCursor.getFullYear();
  const month = dashCalendarCursor.getMonth();
  const todayIso = new Date().toISOString().slice(0, 10);

  const typesByDate = {};
  agendaItems.forEach(a => {
    if (!typesByDate[a.itemDate]) typesByDate[a.itemDate] = new Set();
    typesByDate[a.itemDate].add(a.type);
  });

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push({ day: daysInPrevMonth - startOffset + 1 + i, muted: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      day: d, muted: false, iso, isToday: iso === todayIso, isSelected: iso === dashCalendarSelectedDate,
      types: typesByDate[iso] ? Array.from(typesByDate[iso]) : [],
    });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: nextDay++, muted: true });
  }

  const dowHtml = DASH_CAL_DOW.map(d => `<div class="dash-cal-dow">${d}</div>`).join("");
  const daysHtml = cells.map(c => `
    <button type="button" class="dash-cal-day${c.muted ? " is-muted" : ""}${c.isToday ? " is-today" : ""}${c.isSelected ? " is-selected" : ""}" ${c.muted ? "disabled" : `data-date="${c.iso}"`}>
      ${c.day}
      ${c.types && c.types.length ? `<span class="dash-cal-dots">${c.types.map(t => `<span class="dash-cal-dot dot-${t}"></span>`).join("")}</span>` : ""}
    </button>`).join("");

  grid.innerHTML = `
    <div class="dash-calendar-nav">
      <button type="button" id="dash-cal-prev" aria-label="Mês anterior">&lsaquo;</button>
      <span class="dash-cal-label">${DASH_CAL_MONTH_LABEL[month]} de ${year}</span>
      <button type="button" id="dash-cal-next" aria-label="Próximo mês">&rsaquo;</button>
    </div>
    <div class="dash-cal-grid">${dowHtml}${daysHtml}</div>
    <div class="dash-cal-legend">
      <span class="dash-cal-legend-item"><span class="dash-cal-dot dot-tarefa"></span>Tarefa</span>
      <span class="dash-cal-legend-item"><span class="dash-cal-dot dot-reuniao"></span>Reunião</span>
      <span class="dash-cal-legend-item"><span class="dash-cal-dot dot-aviso"></span>Aviso</span>
    </div>`;

  document.getElementById("dash-cal-prev").addEventListener("click", () => {
    dashCalendarCursor = new Date(year, month - 1, 1);
    renderDashCalendar();
  });
  document.getElementById("dash-cal-next").addEventListener("click", () => {
    dashCalendarCursor = new Date(year, month + 1, 1);
    renderDashCalendar();
  });
  grid.querySelectorAll(".dash-cal-day[data-date]").forEach(btn => {
    btn.addEventListener("click", () => {
      dashCalendarSelectedDate = btn.dataset.date;
      renderDashCalendar();
      renderDashAgendaDay();
      openAgendaModal(null, dashCalendarSelectedDate);
    });
  });
}

/* ---- barra lateral do dashboard: agenda do dia selecionado ---- */
function renderDashAgendaDay() {
  const label = document.getElementById("dash-agenda-day-label");
  const todayIso = new Date().toISOString().slice(0, 10);
  label.textContent = dashCalendarSelectedDate === todayIso
    ? "Agenda de hoje"
    : `Agenda de ${formatDate(dashCalendarSelectedDate)}`;

  const items = agendaItems
    .filter(a => a.itemDate === dashCalendarSelectedDate)
    .sort((a, b) => (a.itemTime || "99:99").localeCompare(b.itemTime || "99:99"));

  const list = document.getElementById("dash-agenda-day-list");
  if (!items.length) {
    list.innerHTML = `<p class="muted-note" style="padding:4px 0;">Nada agendado nesse dia.</p>`;
    return;
  }

  list.innerHTML = items.map(a => {
    const consultor = a.consultorId ? users.find(u => u.id === a.consultorId) : null;
    const metaParts = [AGENDA_TYPE_LABELS[a.type] || a.type];
    if (a.itemTime) metaParts.push(a.itemTime.slice(0, 5));
    if (consultor) metaParts.push(consultor.name);
    return `
      <div class="dash-agenda-item" data-id="${a.id}">
        <span class="dash-agenda-item-badge dot-${a.type}">${a.itemTime ? a.itemTime.slice(0, 5) : "—"}</span>
        <div class="dash-agenda-item-body">
          <div class="dash-agenda-item-title">${escapeHtml(a.title)}</div>
          <div class="dash-agenda-item-meta">${escapeHtml(metaParts.join(" · "))}</div>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".dash-agenda-item").forEach(el => {
    el.addEventListener("click", () => openAgendaModal(el.dataset.id));
  });
}

/* ---- modal: novo compromisso / editar (tarefa, reunião, aviso) ---- */
const agendaModalBackdrop = document.getElementById("agenda-modal-backdrop");
const agendaForm = document.getElementById("agenda-form");
const agendaBtnDelete = document.getElementById("agenda-btn-delete");
const agendaFieldType = document.getElementById("agenda-field-type");

function setAgendaType(type) {
  agendaFieldType.value = type;
  document.querySelectorAll(".agenda-type-btn").forEach(b => b.classList.toggle("active", b.dataset.type === type));
}
document.querySelectorAll(".agenda-type-btn").forEach(btn => {
  btn.addEventListener("click", () => setAgendaType(btn.dataset.type));
});

function renderAgendaConsultorOptions(currentId) {
  const sel = document.getElementById("agenda-field-consultor");
  const consultants = users.filter(u => u.role === "Consultor");
  sel.innerHTML = `<option value="">Sem consultor específico</option>` + consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if (currentId) sel.value = currentId;
  else if (session && session.role === "Consultor") sel.value = session.id;
}

function openAgendaModal(id, presetDate) {
  agendaForm.reset();
  const existing = id ? agendaItems.find(a => a.id === id) : null;

  if (existing) {
    document.getElementById("agenda-modal-title").textContent = "Editar compromisso";
    document.getElementById("agenda-id").value = existing.id;
    document.getElementById("agenda-field-title").value = existing.title;
    document.getElementById("agenda-field-date").value = existing.itemDate;
    document.getElementById("agenda-field-time").value = existing.itemTime || "";
    document.getElementById("agenda-field-notes").value = existing.notes || "";
    renderAgendaConsultorOptions(existing.consultorId);
    setAgendaType(existing.type);
    agendaBtnDelete.style.display = "inline-block";
  } else {
    document.getElementById("agenda-modal-title").textContent = "Novo compromisso";
    document.getElementById("agenda-id").value = "";
    document.getElementById("agenda-field-date").value = presetDate || dashCalendarSelectedDate;
    renderAgendaConsultorOptions(null);
    setAgendaType("tarefa");
    agendaBtnDelete.style.display = "none";
  }

  agendaModalBackdrop.classList.add("open");
  document.getElementById("agenda-field-title").focus();
}
function closeAgendaModal() { agendaModalBackdrop.classList.remove("open"); }

document.getElementById("agenda-modal-close").addEventListener("click", closeAgendaModal);
document.getElementById("agenda-btn-cancel").addEventListener("click", closeAgendaModal);
agendaModalBackdrop.addEventListener("click", e => { if (e.target === agendaModalBackdrop) closeAgendaModal(); });

agendaForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("agenda-id").value;
  const data = {
    id: id || uid(),
    title: document.getElementById("agenda-field-title").value.trim(),
    type: agendaFieldType.value,
    itemDate: document.getElementById("agenda-field-date").value,
    itemTime: document.getElementById("agenda-field-time").value || null,
    consultorId: document.getElementById("agenda-field-consultor").value || null,
    notes: document.getElementById("agenda-field-notes").value.trim(),
    done: false,
    createdBy: session.id,
  };

  const saved = await saveAgendaItemRemote(data);
  if (!saved) { alert("Não foi possível salvar o compromisso. Tente novamente."); return; }

  if (id) {
    const idx = agendaItems.findIndex(a => a.id === id);
    if (idx >= 0) agendaItems[idx] = saved; else agendaItems.push(saved);
  } else {
    agendaItems.push(saved);
  }

  dashCalendarSelectedDate = saved.itemDate;
  renderDashCalendar();
  renderDashAgendaDay();
  closeAgendaModal();
});

agendaBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("agenda-id").value;
  if (!id || !confirm("Excluir este compromisso?")) return;
  agendaItems = agendaItems.filter(a => a.id !== id);
  renderDashCalendar();
  renderDashAgendaDay();
  closeAgendaModal();
  await deleteAgendaItemRemote(id);
});

/* ---- barra lateral do dashboard: aviso do time (ADM edita) ---- */
function renderTeamMessagePanel() {
  const isAdmin = !!(session && session.role === "ADM");
  document.getElementById("btn-edit-team-message").style.display = isAdmin ? "" : "none";
  const body = document.getElementById("dash-team-message-body");
  body.innerHTML = teamAnnouncement.message
    ? `<p class="dash-team-message-text">${escapeHtml(teamAnnouncement.message)}</p>`
    : `<p class="dash-team-message-empty">Nenhum aviso no momento.</p>`;
}

const teamMessageModalBackdrop = document.getElementById("team-message-modal-backdrop");
const teamMessageForm = document.getElementById("team-message-form");

function openTeamMessageModal() {
  document.getElementById("team-message-field-text").value = teamAnnouncement.message || "";
  teamMessageModalBackdrop.classList.add("open");
  document.getElementById("team-message-field-text").focus();
}
function closeTeamMessageModal() { teamMessageModalBackdrop.classList.remove("open"); }

document.getElementById("btn-edit-team-message").addEventListener("click", openTeamMessageModal);
document.getElementById("team-message-modal-close").addEventListener("click", closeTeamMessageModal);
document.getElementById("team-message-btn-cancel").addEventListener("click", closeTeamMessageModal);
teamMessageModalBackdrop.addEventListener("click", e => { if (e.target === teamMessageModalBackdrop) closeTeamMessageModal(); });

teamMessageForm.addEventListener("submit", async e => {
  e.preventDefault();
  const message = document.getElementById("team-message-field-text").value.trim();
  teamAnnouncement.message = message;
  renderTeamMessagePanel();
  closeTeamMessageModal();
  await updateTeamAnnouncementRemote(message);
});

/* ---- barra lateral do dashboard: follow-ups pendentes do pipeline ---- */
function renderDashFollowupsPanel() {
  const panel = document.getElementById("dash-aviso-followup");
  const todayIso = new Date().toISOString().slice(0, 10);

  const items = deals
    .filter(d => !isClosedStage(d.stage) && d.followUpAt)
    .map(d => ({ deal: d, overdue: d.followUpAt < todayIso, today: d.followUpAt === todayIso }))
    .filter(it => it.overdue || it.today)
    .sort((a, b) => a.deal.followUpAt.localeCompare(b.deal.followUpAt))
    .slice(0, 8);

  if (!items.length) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";

  document.getElementById("dash-followup-list").innerHTML = `<div class="dash-aviso-list">${items.map(it => `
    <div class="dash-aviso-item${it.overdue ? " is-overdue" : ""}" data-deal-id="${it.deal.id}">
      <span class="dash-aviso-item-title">${escapeHtml(it.deal.name)}</span>
      <span class="dash-aviso-item-meta">${it.overdue ? "Atrasado" : "Hoje"} · ${formatDate(it.deal.followUpAt)}</span>
    </div>`).join("")}</div>`;

  document.getElementById("dash-followup-list").querySelectorAll(".dash-aviso-item").forEach(el => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
      if (!canAccessView("pipeline")) return;
      switchView("pipeline");
      openDealModal(el.dataset.dealId);
    });
  });
}

/* ---- barra lateral do dashboard: financeiro vencido (a pagar/receber) ---- */
function renderDashFinanceiroVencidoPanel() {
  const panel = document.getElementById("dash-aviso-financeiro");
  if (!hasModuleAccess(session.role, "financeiro")) {
    panel.style.display = "none";
    return;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueReceivables = receivables.filter(r => !r.paid && r.dueDate && r.dueDate < todayIso);
  const overdueExpenses = expenses.filter(e => !e.paid && e.dueDate && e.dueDate < todayIso);

  const items = [
    ...overdueReceivables.map(r => ({
      title: `${r.clientName || "Cliente"} — a receber`, value: currency(r.amount), date: r.dueDate,
    })),
    ...overdueExpenses.map(e => ({
      title: `${e.description} — a pagar`, value: currency(e.amount), date: e.dueDate,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);

  if (!items.length) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";

  document.getElementById("dash-financeiro-vencido-list").innerHTML = `<div class="dash-aviso-list">${items.map(it => `
    <div class="dash-aviso-item is-overdue">
      <span class="dash-aviso-item-title">${escapeHtml(it.title)}</span>
      <span class="dash-aviso-item-meta">Venceu em ${formatDate(it.date)} · ${it.value}</span>
    </div>`).join("")}</div>`;
}

/* ============================================================
   USUÁRIOS (somente ADM)
   ============================================================ */
let users = [];

const userModalBackdrop = document.getElementById("user-modal-backdrop");
const userForm = document.getElementById("user-form");
const userBtnDelete = document.getElementById("user-btn-delete");
const usersTbody = document.getElementById("users-tbody");
const usersEmpty = document.getElementById("users-empty");
const userFieldRole = document.getElementById("user-field-role");
const permissionsTbody = document.getElementById("permissions-tbody");

function renderRoleOptions() {
  userFieldRole.innerHTML = ROLES.map(r => `<option value="${r}">${r}</option>`).join("");
}

function renderUsers() {
  usersTbody.innerHTML = "";
  usersEmpty.style.display = users.length === 0 ? "block" : "none";

  users.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(u.name)}</td>
      <td class="cell-muted">${escapeHtml(u.email)}</td>
      <td><span class="badge ${u.role === "ADM" ? "badge-role-adm" : "badge-neutral"}">${escapeHtml(u.role)}</span></td>
      <td><span class="badge ${u.active ? "badge-good" : "badge-danger"}">${u.active ? "Ativo" : "Inativo"}</span></td>
      <td class="cell-actions">›</td>
    `;
    tr.addEventListener("click", () => openUserModal(u.id));
    usersTbody.appendChild(tr);
  });

  renderUsersDashboard();
}

function renderUsersDashboard() {
  document.getElementById("users-stat-total").textContent = users.length;
  document.getElementById("users-stat-active").textContent = users.filter(u => u.active).length;
  document.getElementById("users-stat-adm").textContent = users.filter(u => u.role === "ADM").length;
}

function openUserModal(id) {
  const u = users.find(u => u.id === id);
  if (!u) return;
  userForm.reset();
  renderRoleOptions();

  const isLastAdmin = u.role === "ADM" && users.filter(x => x.role === "ADM" && x.active).length === 1;

  document.getElementById("user-id").value = u.id;
  document.getElementById("user-field-name").value = u.name;
  document.getElementById("user-field-email").value = u.email;
  document.getElementById("user-field-role").value = u.role;
  document.getElementById("user-field-active").checked = !!u.active;
  document.getElementById("user-field-role").disabled = isLastAdmin;
  document.getElementById("user-field-active").disabled = isLastAdmin;
  document.getElementById("user-adm-hint").style.display = isLastAdmin ? "block" : "none";
  userBtnDelete.style.display = (u.id === session.id || isLastAdmin) ? "none" : "inline-block";

  userModalBackdrop.classList.add("open");
  document.getElementById("user-field-name").focus();
}

function closeUserModal() { userModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-user").addEventListener("click", () => {
  alert('Para criar um novo login, use o Supabase Dashboard → Authentication → Users → "Add user". Depois de criado, ele aparece aqui para você ajustar a função e o acesso.');
});
document.getElementById("user-modal-close").addEventListener("click", closeUserModal);
document.getElementById("user-btn-cancel").addEventListener("click", closeUserModal);
userModalBackdrop.addEventListener("click", e => { if (e.target === userModalBackdrop) closeUserModal(); });

document.getElementById("user-btn-reset-password").addEventListener("click", async () => {
  const id = document.getElementById("user-id").value;
  const u = users.find(u => u.id === id);
  if (!u) return;
  if (!confirm(`Enviar e-mail de redefinição de senha para ${u.name} (${u.email})?`)) return;

  const btn = document.getElementById("user-btn-reset-password");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Enviando…";

  const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
    redirectTo: `${window.location.origin}${window.location.pathname.replace(/index\.html$/, "")}redefinir-senha.html`,
  });

  btn.disabled = false;
  btn.textContent = original;

  if (error) {
    alert("Não foi possível enviar o e-mail de redefinição. Tente novamente.");
    return;
  }
  alert(`E-mail de redefinição enviado para ${u.email}.`);
});

userForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("user-id").value;
  const u = users.find(u => u.id === id);
  if (!u) return;

  const role = document.getElementById("user-field-role").value;
  const active = document.getElementById("user-field-active").checked;
  const wasLastAdmin = u.role === "ADM" && users.filter(x => x.role === "ADM" && x.active).length === 1;
  if (wasLastAdmin && (role !== "ADM" || !active)) {
    alert("Não é possível remover o acesso do último administrador (ADM).");
    return;
  }

  u.name = document.getElementById("user-field-name").value.trim();
  u.role = role;
  u.active = active;

  renderUsers();
  closeUserModal();
  await updateUserProfile(u.id, { name: u.name, role: u.role, active: u.active });
});

userBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("user-id").value;
  if (!id) return;
  const u = users.find(u => u.id === id);
  if (u.role === "ADM" && users.filter(x => x.role === "ADM" && x.active).length === 1) {
    alert("Não é possível desativar o último administrador (ADM).");
    return;
  }
  if (!confirm(`Desativar "${u.name}"? Ele perde o acesso ao sistema imediatamente. Para excluir o login por completo, use o Supabase Dashboard.`)) return;
  u.active = false;
  renderUsers();
  closeUserModal();
  await updateUserProfile(u.id, { name: u.name, role: u.role, active: false });
});

/* ============================================================
   PERMISSÕES POR FUNÇÃO (somente ADM)
   ============================================================ */
function renderPermissionsTable() {
  permissionsTbody.innerHTML = "";

  const admRow = document.createElement("tr");
  admRow.innerHTML = `
    <td class="perm-role-name">ADM</td>
    <td colspan="7" class="perm-locked">Acesso total (fixo)</td>
  `;
  permissionsTbody.appendChild(admRow);

  CONFIGURABLE_ROLES.forEach(role => {
    const tr = document.createElement("tr");
    const rolePerms = rolePermissions[role] || {};
    const cells = MODULES.map(m => `
      <td>
        <input type="checkbox" data-role="${role}" data-module="${m.id}" ${rolePerms[m.id] ? "checked" : ""}>
      </td>
    `).join("");
    tr.innerHTML = `<td class="perm-role-name">${escapeHtml(role)}</td>${cells}`;
    permissionsTbody.appendChild(tr);
  });

  permissionsTbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", async () => {
      await setModuleAccess(cb.dataset.role, cb.dataset.module, cb.checked);
    });
  });
}

/* ============================================================
   GLOBAL: Escape closes any open modal
   ============================================================ */
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (modalBackdrop.classList.contains("open")) closeDealModal();
  if (leadModalBackdrop.classList.contains("open")) closeLeadModal();
  if (document.getElementById("subview-cotacao-builder").classList.contains("active") && !document.getElementById("quote-doc-overlay").hidden) {
    document.getElementById("quote-doc-overlay").hidden = true;
  } else if (document.getElementById("subview-cotacao-builder").classList.contains("active")) {
    openQuoteList();
    renderQuotes();
  }
  if (productModalBackdrop.classList.contains("open")) closeProductModal();
  if (userModalBackdrop.classList.contains("open")) closeUserModal();
  if (assignModalBackdrop.classList.contains("open")) closeAssignModal();
  if (importModalBackdrop.classList.contains("open")) closeImportModal();
  if (sourcesModalBackdrop.classList.contains("open")) closeSourcesModal();
  if (collaboratorModalBackdrop.classList.contains("open")) closeCollaboratorModal();
  if (followUpModalBackdrop.classList.contains("open")) closeFollowUpModal();
  if (notesModalBackdrop.classList.contains("open")) closeNotesModal();
  if (teamMessageModalBackdrop.classList.contains("open")) closeTeamMessageModal();
  if (formModalBackdrop.classList.contains("open")) closeFormModal();
  if (agendaModalBackdrop.classList.contains("open")) closeAgendaModal();
  closeRowMenu();
});

/* ============================================================
   INIT (assíncrono — busca tudo do Supabase antes de renderizar)
   ============================================================ */
(async () => {
  session = await getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  await loadRolePermissions();

  [users, leads, deals, quotes, catalog, SOURCES, STAGES, EXPENSE_CATEGORIES, expenses, commissions, receivables, commissionSettings, enrollments, collaborators, teamAnnouncement, forms, formSubmissions, agendaItems] = await Promise.all([
    loadUsers(),
    loadLeads(),
    loadDeals(),
    loadQuotes(),
    loadCatalog(),
    loadSources(),
    loadPipelineStages(),
    loadExpenseCategories(),
    loadExpenses(),
    loadCommissions(),
    loadReceivables(),
    loadCommissionSettings(),
    loadEnrollments(),
    loadCollaborators(),
    loadTeamAnnouncement(),
    loadForms(),
    loadFormSubmissions(),
    loadAgendaItems(),
  ]);

  renderSessionChip();
  initSidebarToggle();
  initNavigation();
  renderStageOptions();
  renderPipelineFilterOptions();
  renderBoard();
  renderLeadFilterOptions();
  renderLeads();
  renderQuotes();
  renderCatalogList();
  quoteMontaDestinos();
  quoteMontaCatalogo();
  initFinanceiroSubtabs();
  renderExpenseFilterOptions();
  renderFinanceiroOverview();
  renderReceivables();
  renderExpenses();
  renderCommissions();
  renderEnrollments();
  renderCollaborators();
  renderFormsList();
  if (session.role === "ADM") {
    renderUsers();
    renderPermissionsTable();
  }

  document.body.style.visibility = "visible";
})();
