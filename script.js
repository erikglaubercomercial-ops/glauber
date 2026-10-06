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
  /* uso do App de Intercâmbio: ADM/Gerente veem tudo; Consultor só a aba
     Usuários (e o banco só devolve os leads dele). Quem restringe de
     verdade são as funções app_* do Supabase, que conferem o papel. */
  if (view === "appacomp") return session.role === "ADM" || session.role === "Gerente" || session.role === "Consultor";
  if (view === "meusleads") return hasModuleAccess(session.role, "leads");
  if (view === "escolas") return hasModuleAccess(session.role, "produtos") || hasModuleAccess(session.role, "cotacao");
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

  /* celular: sidebar vira gaveta aberta pelo botão hambúrguer (o CSS
     só mostra o botão/gaveta em tela estreita); fecha ao tocar no fundo
     escuro ou ao escolher uma tela */
  const backdrop = document.getElementById("sidebar-backdrop");
  const closeDrawer = () => {
    sidebar.classList.remove("mobile-open");
    backdrop.classList.remove("open");
  };
  document.getElementById("mobile-nav-toggle").addEventListener("click", () => {
    sidebar.classList.add("mobile-open");
    backdrop.classList.add("open");
  });
  backdrop.addEventListener("click", closeDrawer);
  const navEl = document.getElementById("sidebar-nav");
  navEl.addEventListener("click", e => {
    const nav = e.currentTarget;
    if (nav.classList.contains("edit-mode")) return;
    if (e.target.closest(".nav-chevron")) return;
    if (e.target.closest(".nav-item, .nav-subitem")) closeDrawer();
  });

  /* setinha dos itens com submenu: esconde/mostra os submenus. Fase de
     captura pra o clique na setinha não chegar no botão do item (que
     trocaria de tela) */
  navEl.addEventListener("click", e => {
    const chev = e.target.closest(".nav-chevron");
    if (!chev || navEl.classList.contains("edit-mode")) return;
    e.preventDefault();
    e.stopPropagation();
    const id = chev.dataset.navChevron;
    const collapsed = getCollapsedMenuParents();
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    setCollapsedMenuParents(collapsed);
    refreshMenuChevrons();
  }, true);
}

/* ---- submenus recolhíveis: estado salvo por navegador ---- */
const MENU_COLLAPSED_KEY = "crm-vendas-menu-collapsed";
function getCollapsedMenuParents() {
  try { return new Set(JSON.parse(localStorage.getItem(MENU_COLLAPSED_KEY) || "[]")); }
  catch (err) { return new Set(); }
}
function setCollapsedMenuParents(set) {
  try { localStorage.setItem(MENU_COLLAPSED_KEY, JSON.stringify([...set])); } catch (err) { /* sem storage: só não lembra */ }
}

/* desenha a setinha nos itens que têm submenu visível e aplica o
   estado recolhido/aberto; chamar de novo sempre que a estrutura do
   menu mudar */
function refreshMenuChevrons() {
  const nav = document.getElementById("sidebar-nav");
  nav.querySelectorAll(".nav-chevron").forEach(c => c.remove());
  const collapsed = getCollapsedMenuParents();
  const parents = [...new Set([...nav.querySelectorAll("[data-parent]")].map(el => el.dataset.parent))];
  parents.forEach(parentId => {
    const parentEl = navElementFor(parentId);
    const children = [...nav.querySelectorAll(`[data-parent="${parentId}"]`)];
    children.forEach(ch => ch.classList.toggle("nav-sub-hidden", collapsed.has(parentId)));
    const anyVisible = children.some(ch => ch.style.display !== "none");
    if (!parentEl || !anyVisible || parentEl.style.display === "none") return;
    const chev = document.createElement("span");
    chev.className = "nav-chevron" + (collapsed.has(parentId) ? " collapsed" : "");
    chev.dataset.navChevron = parentId;
    chev.setAttribute("role", "button");
    chev.setAttribute("aria-expanded", collapsed.has(parentId) ? "false" : "true");
    chev.title = t("nav.toggleSubmenu");
    chev.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    parentEl.appendChild(chev);
  });
}

/* ao abrir uma tela que está dentro de um submenu recolhido, reabre o submenu */
function ensureMenuParentExpanded(view) {
  const el = document.querySelector(`#sidebar-nav .nav-item[data-view="${view}"]`);
  if (!el || !el.dataset.parent) return;
  const collapsed = getCollapsedMenuParents();
  if (!collapsed.has(el.dataset.parent)) return;
  collapsed.delete(el.dataset.parent);
  setCollapsedMenuParents(collapsed);
  refreshMenuChevrons();
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const CURRENT_VIEW_KEY = "crm-vendas-current-view";
let currentView = "dashboard";

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
    document.getElementById("btn-manage-rotation").style.display = "";
  }

  const priorityOrder = ["dashboard", "leads", "pipeline", "cotacao", "produtos", "financeiro", "matriculas", "colaboradores", "usuarios"];
  const savedView = localStorage.getItem(CURRENT_VIEW_KEY);
  const restoreView = savedView && canAccessView(savedView) ? savedView : null;
  const firstAccessible = priorityOrder.find(canAccessView);
  switchView(restoreView || firstAccessible || "leads");
}

function switchView(view) {
  if (!canAccessView(view)) return;
  closeRowMenu();
  currentView = view;
  localStorage.setItem(CURRENT_VIEW_KEY, view);
  document.querySelectorAll(".nav-item[data-view]").forEach(item => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  ensureMenuParentExpanded(view);
  const sectionId = view === "meusleads" ? "leads" : view;
  document.querySelectorAll(".view").forEach(section => {
    section.classList.toggle("active", section.id === `view-${sectionId}`);
  });
  document.getElementById("view-title").textContent = t(`nav.${view}`);
  if (view === "dashboard") renderDashboardView();
  if (view === "leads" || view === "meusleads") {
    leadsOwnOnlyMode = view === "meusleads";
    renderLeadFilterOptions();
    renderLeads();
  }
  if (view === "escolas") renderEscolas();
  if (view === "appacomp") renderAppTracking();
  if (view === "leadsparados") {
    document.getElementById("subview-stuck-detalhe").classList.remove("active");
    document.getElementById("subview-stuck-overview").classList.add("active");
    renderStuckOverview();
  }
}

/* refaz o título da tela e os textos gerados por JS quando o idioma muda */
document.addEventListener("langchange", () => {
  const titleEl = document.getElementById("view-title");
  if (titleEl) titleEl.textContent = t(`nav.${currentView}`);
  if (currentView === "dashboard" && session) renderDashboardView();
});

/* ============================================================
   MENU LATERAL — ordem/submenus configuráveis pelo ADM, salvos
   numa linha única (menu_config) e valendo pra todo mundo.
   Não altera função nenhuma: só reordena os nós já existentes
   na sidebar (ícones e textos continuam vindo do HTML/i18n).
   ============================================================ */
const DEFAULT_MENU_STRUCTURE = {
  sections: [
    { id: "geral", items: [
      { id: "dashboard" },
      { id: "leads", children: ["meusleads", "leadsparados"] },
      { id: "pipeline" },
      { id: "cotacao" },
      { id: "contratos" },
      { id: "produtos" },
      { id: "financeiro" },
      { id: "matriculas" },
      { id: "colaboradores" },
      { id: "appacomp" },
      { id: "formularios" },
      { id: "templates" },
      { id: "areaaluno", children: ["areaaluno-preview-link"] },
    ] },
    { id: "administracao", items: [
      { id: "usuarios" },
    ] },
  ],
};

let menuConfig = DEFAULT_MENU_STRUCTURE;

async function loadMenuConfig() {
  const { data, error } = await supabase.from("menu_config").select("structure").eq("id", 1).single();
  if (error || !data || !data.structure || !Array.isArray(data.structure.sections)) return DEFAULT_MENU_STRUCTURE;
  return data.structure;
}
async function saveMenuConfigRemote(structure) {
  const { error } = await supabase.from("menu_config")
    .update({ structure, updated_by_name: session.name || "", updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) console.error("Erro ao salvar menu:", error);
  return !error;
}

function navIdOf(el) {
  return el ? (el.dataset.navId || el.dataset.view || null) : null;
}
function navElementFor(id) {
  return document.querySelector(`#sidebar-nav [data-nav-id="${id}"]`) || document.querySelector(`#sidebar-nav [data-view="${id}"]`);
}

function applyMenuStructure(structure) {
  const nav = document.getElementById("sidebar-nav");
  /* item novo (ainda fora do menu salvo): fica logo depois de Produtos */
  const inStructure = id => (structure.sections || []).some(sec => (sec.items || []).some(it => it.id === id || (it.children || []).includes(id)));
  const escolasEl = navElementFor("escolas");
  const produtosEl = navElementFor("produtos");
  if (escolasEl && produtosEl && !inStructure("escolas")) nav.insertBefore(escolasEl, produtosEl.nextSibling);
  (structure.sections || []).forEach(section => {
    const label = document.querySelector(`#sidebar-nav .nav-label[data-nav-section="${section.id}"]`);
    if (!label) return;
    let anchor = label;
    (section.items || []).forEach(item => {
      const el = navElementFor(item.id);
      if (!el) return;
      el.classList.remove("nav-item-sub");
      delete el.dataset.parent;
      nav.insertBefore(el, anchor.nextSibling);
      anchor = el;
      (item.children || []).forEach(childId => {
        const childEl = navElementFor(childId);
        if (!childEl) return;
        childEl.classList.add("nav-item-sub");
        childEl.dataset.parent = item.id;
        nav.insertBefore(childEl, anchor.nextSibling);
        anchor = childEl;
      });
    });
  });
}

function serializeMenuStructure() {
  const nav = document.getElementById("sidebar-nav");
  const sections = [];
  let currentSection = null;
  let currentTopItem = null;
  Array.from(nav.children).forEach(el => {
    if (el.matches(".nav-label")) {
      currentSection = { id: el.dataset.navSection, items: [] };
      sections.push(currentSection);
      currentTopItem = null;
      return;
    }
    if (el.classList.contains("nav-drag-handle") || !currentSection) return;
    const id = navIdOf(el);
    if (!id) return;
    if (el.classList.contains("nav-item-sub")) {
      if (currentTopItem) {
        currentTopItem.children = currentTopItem.children || [];
        currentTopItem.children.push(id);
      }
      return;
    }
    currentTopItem = { id };
    currentSection.items.push(currentTopItem);
  });
  return { sections };
}

function clearMenuDropMarkers() {
  document.querySelectorAll("#sidebar-nav [data-drop]").forEach(el => el.removeAttribute("data-drop"));
}

function setMenuDragHandles(on) {
  document.querySelectorAll("#sidebar-nav .nav-item, #sidebar-nav .nav-subitem").forEach(el => {
    let handle = el.querySelector(".nav-drag-handle");
    if (on) {
      if (!handle) {
        handle = document.createElement("span");
        handle.className = "nav-drag-handle";
        handle.textContent = "⠿";
        el.insertBefore(handle, el.firstChild);
      }
      el.draggable = true;
    } else {
      if (handle) handle.remove();
      el.removeAttribute("draggable");
    }
  });
}

/* bloqueia clique/navegação enquanto o menu está em modo de edição
   (arrastar não pode disparar troca de tela nem abrir o link externo) */
function menuEditClickBlocker(e) {
  e.preventDefault();
  e.stopPropagation();
}

let menuEditBackupHtml = null;

function initMenuEditor() {
  const nav = document.getElementById("sidebar-nav");
  const editBtn = document.getElementById("btn-edit-menu");
  const editBar = document.getElementById("sidebar-nav-edit-bar");
  const cancelBtn = document.getElementById("btn-menu-cancel");
  const saveBtn = document.getElementById("btn-menu-save");
  if (!editBtn) return;

  editBtn.style.display = session && session.role === "ADM" ? "flex" : "none";
  if (!(session && session.role === "ADM")) return;

  function enterEditMode() {
    menuEditBackupHtml = nav.innerHTML;
    nav.classList.add("edit-mode");
    nav.addEventListener("click", menuEditClickBlocker, true);
    editBtn.classList.add("active");
    editBar.style.display = "flex";
    setMenuDragHandles(true);
  }
  function exitEditMode() {
    nav.classList.remove("edit-mode");
    nav.removeEventListener("click", menuEditClickBlocker, true);
    editBtn.classList.remove("active");
    editBar.style.display = "none";
    setMenuDragHandles(false);
    clearMenuDropMarkers();
    refreshMenuChevrons();
  }

  editBtn.addEventListener("click", () => {
    if (nav.classList.contains("edit-mode")) exitEditMode();
    else enterEditMode();
  });

  cancelBtn.addEventListener("click", () => {
    nav.innerHTML = menuEditBackupHtml;
    exitEditMode();
    initNavigation();
  });

  saveBtn.addEventListener("click", async () => {
    const structure = serializeMenuStructure();
    saveBtn.disabled = true;
    const original = saveBtn.textContent;
    saveBtn.textContent = t("nav.savingMenu");
    const ok = await saveMenuConfigRemote(structure);
    saveBtn.disabled = false;
    saveBtn.textContent = original;
    if (!ok) { alert(t("nav.saveMenuError")); return; }
    menuConfig = structure;
    exitEditMode();
  });

  let draggedEl = null;

  nav.addEventListener("dragstart", e => {
    const el = e.target.closest(".nav-item, .nav-subitem");
    if (!el || !nav.classList.contains("edit-mode")) return;
    draggedEl = el;
    e.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => el.classList.add("dragging"));
  });
  nav.addEventListener("dragend", () => {
    if (draggedEl) draggedEl.classList.remove("dragging");
    draggedEl = null;
    clearMenuDropMarkers();
  });
  nav.addEventListener("dragover", e => {
    if (!draggedEl || !nav.classList.contains("edit-mode")) return;
    const target = e.target.closest(".nav-item, .nav-subitem, .nav-label");
    clearMenuDropMarkers();
    if (!target || target === draggedEl) return;
    e.preventDefault();
    const draggedId = navIdOf(draggedEl);
    if (target.matches(".nav-label")) {
      target.dataset.drop = "label";
      return;
    }
    const rect = target.getBoundingClientRect();
    const offset = (e.clientY - rect.top) / rect.height;
    const targetIsChildOfDragged = target.dataset.parent === draggedId;
    const canNest = target.matches(".nav-item") && !target.classList.contains("nav-item-sub") && !targetIsChildOfDragged;
    if (canNest && offset > 0.3 && offset < 0.7) {
      target.dataset.drop = "nest";
    } else if (offset < 0.5) {
      target.dataset.drop = "before";
    } else {
      target.dataset.drop = "after";
    }
  });
  nav.addEventListener("drop", e => {
    if (!draggedEl || !nav.classList.contains("edit-mode")) return;
    const target = e.target.closest(".nav-item, .nav-subitem, .nav-label");
    if (!target || target === draggedEl) { clearMenuDropMarkers(); return; }
    e.preventDefault();
    const draggedId = navIdOf(draggedEl);
    const dropMode = target.dataset.drop;
    const targetIsChildOfDragged = target.dataset.parent === draggedId;

    draggedEl.classList.remove("nav-item-sub");
    delete draggedEl.dataset.parent;

    if (target.matches(".nav-label")) {
      nav.insertBefore(draggedEl, target.nextSibling);
    } else if (dropMode === "nest" && !targetIsChildOfDragged) {
      let insertAfterEl = target;
      let next = target.nextElementSibling;
      const targetId = navIdOf(target);
      while (next && next.classList.contains("nav-item-sub") && next.dataset.parent === targetId) {
        insertAfterEl = next;
        next = next.nextElementSibling;
      }
      draggedEl.classList.add("nav-item-sub");
      draggedEl.dataset.parent = targetId;
      nav.insertBefore(draggedEl, insertAfterEl.nextSibling);
    } else if (dropMode === "before") {
      if (target.classList.contains("nav-item-sub") && !targetIsChildOfDragged) {
        draggedEl.classList.add("nav-item-sub");
        draggedEl.dataset.parent = target.dataset.parent;
      }
      nav.insertBefore(draggedEl, target);
    } else {
      if (target.classList.contains("nav-item-sub") && !targetIsChildOfDragged) {
        draggedEl.classList.add("nav-item-sub");
        draggedEl.dataset.parent = target.dataset.parent;
      }
      nav.insertBefore(draggedEl, target.nextSibling);
    }
    clearMenuDropMarkers();
  });
}

function currency(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

/* traduz valores fixos de status/temperatura pra exibição, sem tocar no
   valor gravado no banco (que continua em português) — valores livres
   (ex.: origem, categoria, escola) não estão aqui de propósito, pois são
   editáveis pelo ADM e não têm tradução automática possível */
const STATUS_I18N_MAP = {
  "Novo": "status.novo", "Em contato": "status.emContato", "Qualificado": "status.qualificado", "Descartado": "status.descartado",
  "Quente": "status.quente", "Morno": "status.morno", "Frio": "status.frio",
  "Aguardando aluno": "status.aguardandoAluno", "Preenchido pelo aluno": "status.preenchidoPeloAluno", "Completo": "status.completo",
  "Aguardando colaborador": "status.aguardandoColaborador", "Preenchido pelo colaborador": "status.preenchidoPeloColaborador",
  "Rascunho": "status.rascunho", "Aguardando assinatura": "status.aguardandoAssinatura", "Assinado": "status.assinado", "Cancelado": "status.cancelado",
  "Enviada": "status.enviada", "Em negociação": "status.emNegociacao", "Aprovada": "status.aprovada", "Recusada": "status.recusada",
  "pendente": "status.pendente", "pago": "status.pago",
};
function statusLabel(value) {
  const key = STATUS_I18N_MAP[value];
  return key ? t(key) : value;
}

const STAGE_I18N_MAP = {
  "Lead": "stage.lead", "Contato Feito": "stage.contato", "Proposta": "stage.proposta",
  "Negociação": "stage.negociacao", "Ganho": "status.ganho", "Perdido": "status.perdido",
};
function stageLabel(label) {
  const key = STAGE_I18N_MAP[label];
  return key ? t(key) : label;
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
  await saveDeals([deal]);
}

/* tira o lead da lista de "Leads Parados" assim que alguém interage com ele
   (clique no WhatsApp) — independe de existir negócio vinculado no pipeline,
   porque leads convertidos de formulário público não ganham negócio sozinhos */
function unstickLeadIfNew(leadId) {
  if (!leadId) return;
  const lead = leads.find(l => l.id === leadId);
  if (!lead || lead.status !== "Novo") return;
  lead.status = "Em contato";
  lead.rotationActive = false;
  renderLeads();
  saveLeads();
  refreshStuckLeadsAfterReassign([leadId]);
}

function advanceLeadPipelineStage(leadId) {
  unstickLeadIfNew(leadId);
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
async function saveDeals(list) {
  const target = list || deals;
  if (!target.length) return;
  const CHUNK_SIZE = 50;
  let hadError = false;
  for (let i = 0; i < target.length; i += CHUNK_SIZE) {
    const chunk = target.slice(i, i + CHUNK_SIZE).map(dealToDb);
    const { error } = await supabase.from("deals").upsert(chunk);
    if (error) { console.error("Erro ao salvar pipeline:", error); hadError = true; }
  }
  if (hadError) alert(t("pipeline.saveError"));
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
  fieldStage.innerHTML = STAGES.map(s => `<option value="${s.id}">${escapeHtml(stageLabel(s.label))}</option>`).join("");
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
  const consultants = users.filter(u => isSellRole(u.role)).slice().sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">${t("pipeline.allConsultants")}</option>` + consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  sel.value = current;
}

let pipelineSearchQuery = "";

function getFilteredDeals() {
  let list = deals;
  if (isOwnLeadsOnly()) {
    list = list.filter(d => dealConsultorId(d) === session.id);
  } else {
    const consultorId = document.getElementById("pipeline-filter-consultor").value;
    if (consultorId) list = list.filter(d => dealConsultorId(d) === consultorId);
  }
  if (pipelineSearchQuery) list = list.filter(d => dealMatchesPipelineSearch(d, pipelineSearchQuery));
  return list;
}

document.getElementById("pipeline-filter-consultor").addEventListener("change", () => { renderBoard(); });
document.getElementById("pipeline-filter-clear").addEventListener("click", () => {
  document.getElementById("pipeline-filter-consultor").value = "";
  pipelineSearchQuery = "";
  document.getElementById("pipeline-search-input").value = "";
  renderBoard();
});

/* ---- busca no Pipeline por nome, telefone ou e-mail (do próprio negócio
   ou do lead vinculado): o board filtra enquanto digita. Texto ignora
   maiúsculas/acentos; telefone compara só os dígitos (com ou sem
   DDD/DDI/formatação) ---- */
function dealMatchesPipelineSearch(d, rawQuery) {
  const q = normalizeImportStr(rawQuery);
  if (!q) return true;
  const lead = d.leadId ? leads.find(l => l.id === d.leadId) : null;
  const text = normalizeImportStr([d.name, d.contact, d.info, lead && lead.name, lead && lead.email, lead && lead.phone].filter(Boolean).join(" "));
  if (text.includes(q)) return true;
  const qDigits = rawQuery.replace(/\D/g, "");
  if (qDigits.length < 3) return false;
  const pool = [
    d.contact, d.info, lead && lead.phone,
    lead && lead.phoneDdd && lead.phoneNumber ? `${lead.phoneDdd}${lead.phoneNumber}` : "",
    lead && leadWhatsAppDigits(lead),
  ].map(x => String(x || "").replace(/\D/g, "")).filter(Boolean);
  return pool.some(x => x.includes(qDigits));
}

const pipelineSearchInput = document.getElementById("pipeline-search-input");
let pipelineSearchTimer = null;
pipelineSearchInput.addEventListener("input", () => {
  clearTimeout(pipelineSearchTimer);
  pipelineSearchTimer = setTimeout(() => {
    pipelineSearchQuery = pipelineSearchInput.value.trim();
    renderBoard();
  }, 180);
});

function renderBoard() {
  boardEl.innerHTML = "";
  const filteredDeals = getFilteredDeals();
  const statusEl = document.getElementById("pipeline-search-status");
  statusEl.style.display = pipelineSearchQuery ? "" : "none";
  statusEl.textContent = pipelineSearchQuery ? `${filteredDeals.length} ${t("pipeline.searchFound")}` : "";
  STAGES.forEach(stage => {
    const stageDeals = filteredDeals.filter(d => d.stage === stage.id);

    const column = document.createElement("div");
    column.className = "column";
    column.dataset.stage = stage.id;
    column.style.setProperty("--stage-color", stageColor(stage.id));
    column.innerHTML = `
      <div class="column-header">
        <span>${escapeHtml(stageLabel(stage.label))}</span>
        <span class="column-count">${stageDeals.length}</span>
      </div>
      <div class="column-cards" data-stage="${stage.id}"></div>
    `;

    const cardsEl = column.querySelector(".column-cards");
    if (stageDeals.length === 0) {
      cardsEl.innerHTML = `<div class="empty-hint">${t("pipeline.dragDealHere")}</div>`;
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
        <span>${escapeHtml(phoneText)}</span>
      </div>` : ""}
    ${emailText ? `<div class="card-email">${escapeHtml(emailText)}</div>` : ""}
    ${lead && (lead.source || lead.temperature) ? `
      <div class="card-tags">
        ${lead.source ? originBadge(lead.source) : ""}
        ${lead.temperature ? `<span class="badge ${TEMPERATURE_BADGE[lead.temperature] || "badge-neutral"}">${escapeHtml(statusLabel(lead.temperature))}</span>` : ""}
      </div>` : ""}
    ${consultant ? `<div class="card-consultor">${escapeHtml(consultant.name)}</div>` : ""}
    <div class="card-footer">
      <span class="card-value">${deal.value ? currency(deal.value) : "—"}</span>
      <div class="card-actions">
        ${phoneText ? (waDigits
          ? `<a class="wpp-btn" href="${buildWhatsAppLink(waDigits)}" target="_blank" rel="noopener" title="${t("common.openWhatsapp")}">${WPP_ICON_SVG}</a>`
          : `<span class="wpp-btn disabled" title="${t("lead.noWhatsappConfigured")}">${WPP_ICON_SVG}</span>`) : ""}
        <button type="button" class="card-action-btn ${followUpClass}" data-act="followup" title="${followUpTitle}">
          ${CARD_CALENDAR_ICON_SVG}${deal.followUpAt ? `<span>${formatDate(deal.followUpAt)}</span>` : ""}
        </button>
        <button type="button" class="card-action-btn ${deal.notes ? "set" : ""}" data-act="notes" title="${t("common.notes")}">${CARD_NOTES_ICON_SVG}</button>
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
    unstickLeadIfNew(deal.leadId);
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
  await saveDeals([deal]);
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
  await saveDeals([deal]);
});

/* venda só é liberada se o lead tiver uma cotação com contrato já
   assinado (única assinatura eletrônica real do sistema) — leads sem
   leadId (negócio avulso) não são travados. A cotação assinada também
   define o valor do negócio (puxado pro Financeiro) */
function findSignedQuoteForLead(leadId) {
  if (!leadId) return null;
  const leadQuotes = quotes.filter(q => q.leadId === leadId);
  for (const q of leadQuotes) {
    if (contracts.some(c => c.quoteId === q.id && c.status === "Assinado")) return q;
  }
  return null;
}
function hasSignedContractForLead(leadId) {
  return !!findSignedQuoteForLead(leadId);
}

function moveDeal(id, newStage) {
  const deal = deals.find(d => d.id === id);
  if (!deal || deal.stage === newStage) return;
  let signedQuote = null;
  if (isWonStage(newStage) && deal.leadId) {
    signedQuote = findSignedQuoteForLead(deal.leadId);
    if (!signedQuote) { alert(t("pipeline.needSignedContract")); return; }
  }
  if (signedQuote) deal.value = signedQuote.value;
  deal.stage = newStage;
  deal.closedAt = isClosedStage(newStage) ? Date.now() : null;
  if (deal.leadId && STAGES.length && newStage !== STAGES[0].id) {
    const lead = leads.find(l => l.id === deal.leadId);
    if (lead && lead.status === "Novo") {
      lead.status = "Em contato";
      saveLeads();
    }
  }
  saveDeals([deal]);
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
    document.getElementById("modal-title").textContent = t("deal.editTitle");
    document.getElementById("deal-id").value = deal.id;
    document.getElementById("field-name").value = deal.name;
    document.getElementById("field-source").value = (lead && lead.source) || "—";
    document.getElementById("field-consultor-display").value = (consultant && consultant.name) || "—";
    document.getElementById("field-contact").value = deal.contact || "";
    document.getElementById("field-info").value = deal.info || "";
    document.getElementById("field-first-interaction").value = deal.firstInteractionAt
      ? new Date(deal.firstInteractionAt).toLocaleString("pt-BR")
      : t("deal.noInteractionYet");
    document.getElementById("field-stage").value = deal.stage;
    document.getElementById("field-notes").value = deal.notes || "";
    btnDelete.style.display = "inline-block";

    const signedQuote = findSignedQuoteForLead(deal.leadId);
    const signedContract = signedQuote ? contracts.find(c => c.quoteId === signedQuote.id && c.status === "Assinado") : null;
    const docsRow = document.getElementById("deal-signed-docs-row");
    docsRow.style.display = signedQuote ? "flex" : "none";
    if (signedQuote) {
      document.getElementById("deal-btn-view-quote").onclick = () => {
        closeDealModal();
        switchView("cotacao");
        openQuoteBuilder(signedQuote.id);
      };
      document.getElementById("deal-btn-view-contract").onclick = () => {
        closeDealModal();
        switchView("contratos");
        openContractModal(signedContract.id);
      };
    }
  } else {
    document.getElementById("modal-title").textContent = t("deal.newTitle");
    document.getElementById("deal-id").value = "";
    document.getElementById("field-source").value = "—";
    document.getElementById("field-consultor-display").value = "—";
    document.getElementById("field-first-interaction").value = t("deal.noInteractionYet");
    document.getElementById("field-stage").value = STAGES[0] ? STAGES[0].id : "";
    btnDelete.style.display = "none";
    document.getElementById("deal-signed-docs-row").style.display = "none";
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
  await saveDeals([deal]);
  if (isWonStage(deal.stage)) handleDealWon(deal);
});

btnDelete.addEventListener("click", async () => {
  const id = document.getElementById("deal-id").value;
  if (!id) return;
  if (!confirm(t("deal.confirmDelete"))) return;
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
      <span class="source-usage">${stageUsageCount(s.id)} ${t("pipeline.dealsCount")}</span>
      <button type="button" class="btn btn-icon" data-act="del" data-id="${s.id}" title="${t("pipeline.deleteColumn")}" ${(s.isWon || s.isLost) ? "disabled" : ""}>&times;</button>
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
    alert(`${t("pipeline.moveBeforeDelete1")} ${count} ${t("pipeline.moveBeforeDelete2")}`);
    return;
  }
  if (STAGES.length <= 1) {
    alert(t("pipeline.keepAtLeastOneColumn"));
    return;
  }
  if (!confirm(`${t("pipeline.confirmDeleteColumn")} "${stageLabel(stage.label)}"?`)) return;
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
  if (duplicate) { alert(t("pipeline.duplicateColumnName")); return; }
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
const STATUSES = ["Novo", "Em contato", "Qualificado", "Descartado"];

/* configuração de comissão de influencer por origem (chave = nome da
   origem) — carregada junto com SOURCES, mantida em memória à parte
   porque SOURCES precisa continuar sendo uma lista simples de strings
   (usada em dezenas de lugares como filtro/valor de lead) */
let sourceInfluencerConfig = {};

async function loadSources() {
  const { data, error } = await supabase.from("lead_sources")
    .select("name, is_influencer, commission_pct, commission_mode, commission_fixed_am, commission_fixed_pm").order("ordem");
  if (error || !data || !data.length) return ["Indicação", "Site", "Redes Sociais", "Anúncio", "Evento", "Outro"];
  sourceInfluencerConfig = {};
  data.forEach(r => {
    sourceInfluencerConfig[r.name] = {
      isInfluencer: !!r.is_influencer, commissionPct: Number(r.commission_pct) || 0,
      mode: r.commission_mode || "percentage",
      fixedAm: Number(r.commission_fixed_am) || 0, fixedPm: Number(r.commission_fixed_pm) || 0,
    };
  });
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
async function updateSourceInfluencerRemote(name, cfg) {
  const { error } = await supabase.from("lead_sources")
    .update({
      is_influencer: cfg.isInfluencer, commission_pct: cfg.commissionPct,
      commission_mode: cfg.mode, commission_fixed_am: cfg.fixedAm, commission_fixed_pm: cfg.fixedPm,
    })
    .eq("name", name);
  if (error) console.error("Erro ao salvar configuração de influencer:", error);
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
const CELL_DUPLICATE_ICON_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>`;
/* placeholder de foto do consultor — até termos upload de foto de perfil */
const PERSON_PHOTO_PLACEHOLDER_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>`;

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
  { match: ["app intercambio", "aplicativo", "app"], color: "#F7931E", solid: true,
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>` },
  { match: ["duda"], color: "#EC0B7A", solid: true,
    icon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 17.3-6.2 3.6 1.6-7-5.4-4.7 7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7z"/></svg>` },
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
  const solidClass = style.solid ? " origin-badge-solid" : "";
  return `<span class="origin-badge${solidClass}" style="--origin-color:${style.color}">${style.icon}${escapeHtml(source)}</span>`;
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
    source: r.source, category: r.category, status: r.status, temperature: r.temperature || "",
    consultorId: r.consultor_id, active: r.active, notes: r.notes || "",
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    rotationActive: !!r.rotation_active,
    rotationAssignedAt: r.rotation_assigned_at ? new Date(r.rotation_assigned_at).getTime() : null,
    rotationDeadline: r.rotation_deadline ? new Date(r.rotation_deadline).getTime() : null,
    rotationReassignCount: r.rotation_reassign_count || 0,
    referredByLeadId: r.referred_by_lead_id || null,
  };
}
function leadToDb(l) {
  return {
    id: l.id, name: l.name, company: l.company, phone: l.phone, email: l.email,
    country_code: l.countryCode || "BR", phone_ddd: l.phoneDdd || "", phone_number: l.phoneNumber || "",
    source: l.source, category: l.category, status: l.status, temperature: l.temperature || null,
    consultor_id: l.consultorId || null, active: l.active, notes: l.notes || "",
    created_at: new Date(l.createdAt).toISOString(),
    rotation_active: !!l.rotationActive,
    rotation_assigned_at: l.rotationAssignedAt ? new Date(l.rotationAssignedAt).toISOString() : null,
    rotation_deadline: l.rotationDeadline ? new Date(l.rotationDeadline).toISOString() : null,
    rotation_reassign_count: l.rotationReassignCount || 0,
    referred_by_lead_id: l.referredByLeadId || null,
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
      alert((error.message || "").includes("telefone_duplicado") ? t("lead.duplicatePhoneSaveError") : t("lead.duplicateEmailSaveError"));
    }
  }
}
/* ---- rodízio automático de leads (fila de consultores + prazo pro
   primeiro contato) — a atribuição/reatribuição em si acontece no banco
   (funções abaixo), pra funcionar mesmo com o CRM fechado */
let rotationSettings = { enabled: false, timeoutHours: 24, memberUserIds: [] };

async function loadRotationSettings() {
  const { data, error } = await supabase.from("lead_rotation_settings").select("*").eq("id", 1).single();
  if (error || !data) return { enabled: false, timeoutHours: 24, memberUserIds: [] };
  return {
    enabled: !!data.enabled,
    timeoutHours: Number(data.timeout_hours) || 24,
    memberUserIds: Array.isArray(data.member_user_ids) ? data.member_user_ids : [],
  };
}
async function saveRotationSettingsRemote(settings) {
  const { error } = await supabase.from("lead_rotation_settings").update({
    enabled: settings.enabled,
    timeout_hours: settings.timeoutHours,
    member_user_ids: settings.memberUserIds,
    updated_by_name: session.name || "",
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) console.error("Erro ao salvar rodízio de leads:", error);
  return !error;
}

/* chamado sempre que um lead novo é criado sem consultor definido —
   a função no banco decide se o rodízio está ativo e faz a atribuição
   de forma atômica (evita duas pessoas criando leads ao mesmo tempo
   caírem no mesmo consultor) */
async function maybeAssignRotation(lead) {
  if (lead.consultorId) return;
  const { data, error } = await supabase.rpc("assign_lead_rotation", { p_lead_id: lead.id });
  if (error) { console.error("Erro ao atribuir rodízio:", error); return; }
  if (!data) return;
  Object.assign(lead, leadFromDb(data));
  renderLeads();
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
  document.getElementById("lead-field-temperature").innerHTML = `<option value="">${t("common.select")}</option>` +
    TEMPERATURES.map(temp => `<option value="${temp}">${escapeHtml(statusLabel(temp))}</option>`).join("");
}

/* chave canônica do telefone do lead (país + DDD + número, só dígitos) —
   mesma regra da função lead_phone_key do banco; null se não há número
   utilizável. Usada pra barrar lead com telefone repetido. */
function leadPhoneKey(l) {
  const country = l.countryCode || "BR";
  let digits = `${l.phoneDdd || ""}${l.phoneNumber || ""}`.replace(/\D/g, "");
  if (!digits) {
    digits = String(l.phone || "").replace(/\D/g, "");
    if (country === "BR" && digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  }
  return digits.length >= 8 ? `${country}:${digits}` : null;
}
function findLeadWithSamePhone(lead, excludeId) {
  const key = leadPhoneKey(lead);
  if (!key) return null;
  const skip = excludeId !== undefined ? excludeId : lead.id;
  return leads.find(l => l.id !== skip && leadPhoneKey(l) === key) || null;
}

function isOwnLeadsOnly() {
  return !!(session && session.role === "Consultor");
}

/* quem pode ser dono de lead/negócio (aparece nos filtros e listas de
   atribuição de consultor) — Consultor sempre, Gerente também */
function isSellRole(role) {
  return role === "Consultor" || role === "Gerente";
}

/* ativado quando a tela "Meus leads" (submenu de Leads) está aberta —
   força ver só os próprios leads, mesmo pra quem normalmente vê todos */
let leadsOwnOnlyMode = false;

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

  if (isOwnLeadsOnly() || leadsOwnOnlyMode) {
    consultorSel.style.display = "none";
  } else {
    consultorSel.style.display = "";
    const consultants = users.filter(u => isSellRole(u.role));
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
  const ownOnly = isOwnLeadsOnly() || leadsOwnOnlyMode;
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
        <div class="sub">${escapeHtml(l.email || l.phone || t("enr.noContact"))}</div>
      </div>`).join("")
    : `<div class="enr-lead-result-empty">${t("enr.noLeadFound")}</div>`;
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
          <button type="button" class="cell-copy-btn" data-copy="${escapeHtml(lead.name)}" title="${t("lead.copyName")}">${CELL_COPY_ICON_SVG}</button>
          ${lead.active === false ? '<span class="badge badge-neutral">Inativo</span>' : ""}
        </span>
        <div class="cell-meta-row">
          <span class="badge ${LEAD_STATUS_BADGE[lead.status] || "badge-neutral"}">${escapeHtml(statusLabel(lead.status))}</span>
          <span class="badge ${TEMPERATURE_BADGE[lead.temperature] || "badge-neutral"}">${escapeHtml(statusLabel(lead.temperature) || "—")}</span>
          ${waDigits
            ? `<a class="wpp-btn" href="${buildWhatsAppLink(waDigits)}" target="_blank" rel="noopener" title="${t("common.openWhatsapp")}">${WPP_ICON_SVG}</a>`
            : `<span class="wpp-btn disabled" title="${t("lead.fillPhoneForWhatsapp")}">${WPP_ICON_SVG}</span>`}
        </div>
      </td>
      <td class="cell-muted">
        ${lead.phone ? `
          <div class="cell-email-row">
            <span>${escapeHtml(lead.phone)}</span>
            <button type="button" class="cell-copy-btn" data-copy="${escapeHtml(lead.phone)}" title="${t("lead.copyPhone")}">${CELL_COPY_ICON_SVG}</button>
          </div>` : "—"}
      </td>
      <td class="cell-muted">
        ${lead.email ? `
          <div class="cell-email-row">
            <span>${escapeHtml(lead.email)}</span>
            <button type="button" class="cell-copy-btn" data-copy="${escapeHtml(lead.email)}" title="${t("lead.copyEmail")}">${CELL_COPY_ICON_SVG}</button>
          </div>` : "—"}
      </td>
      <td class="cell-muted">${originBadge(lead.source)}</td>
      <td class="cell-muted">${consultant ? escapeHtml(consultant.name) : "—"}</td>
      <td class="cell-actions"><button type="button" class="btn-icon row-menu-trigger" data-id="${lead.id}">⋮</button></td>
    `;

    tr.querySelectorAll(".cell-copy-btn").forEach(copyBtn => {
      copyBtn.addEventListener("click", async e => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(copyBtn.dataset.copy);
          copyBtn.classList.add("copied");
          setTimeout(() => copyBtn.classList.remove("copied"), 1200);
        } catch {
          prompt("Copie o valor abaixo:", copyBtn.dataset.copy);
        }
      });
    });

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
  document.getElementById("leads-bulk-count").textContent = `${count} ${t("common.selectedCount")}`;
  bar.style.display = count > 0 ? "flex" : "none";
  document.getElementById("leads-bulk-menu-trigger").disabled = count === 0;
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
    <button type="button" class="row-menu-item" data-action="status">Mudar status</button>
    <button type="button" class="row-menu-item" data-action="temperature">Mudar temperatura</button>
    <button type="button" class="row-menu-item" data-action="category">Mudar categoria</button>
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
  menu.querySelector('[data-action="status"]').addEventListener("click", () => {
    closeBulkMenu();
    openQuickFieldModal(ids, "status");
  });
  menu.querySelector('[data-action="temperature"]').addEventListener("click", () => {
    closeBulkMenu();
    openQuickFieldModal(ids, "temperature");
  });
  menu.querySelector('[data-action="category"]').addEventListener("click", () => {
    closeBulkMenu();
    openQuickFieldModal(ids, "category");
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
    if (!confirm(`${t("lead.confirmBulkDelete1")} ${ids.length} ${t("lead.confirmBulkDelete2")}`)) return;
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

const QUICK_FIELD_CONFIG = {
  temperature: { label: () => t("common.temperature"), title: () => t("leads.changeTemperature"), options: () => TEMPERATURES },
  source: { label: () => t("common.source"), title: () => t("leads.changeSource"), options: () => SOURCES },
  status: { label: () => t("common.status"), title: () => t("leads.changeStatus"), options: () => STATUSES },
  category: { label: () => t("common.category"), title: () => t("leads.changeCategory"), options: () => CATEGORIES },
};

function openQuickFieldModal(ids, field) {
  quickFieldTarget = { ids, field };
  const config = QUICK_FIELD_CONFIG[field];
  document.getElementById("quickfield-modal-title").textContent =
    config.title() + (ids.length > 1 ? ` (${ids.length} leads)` : "");
  document.getElementById("quickfield-label-text").textContent = config.label();
  quickFieldSelect.innerHTML = config.options().map(o => `<option value="${escapeHtml(o)}">${escapeHtml(statusLabel(o))}</option>`).join("");
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
  if (!confirm(t("lead.confirmDelete"))) return false;
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
    <button type="button" class="row-menu-item" data-action="status">Mudar status</button>
    <button type="button" class="row-menu-item" data-action="temperature">Mudar temperatura</button>
    <button type="button" class="row-menu-item" data-action="category">Mudar categoria</button>
    ${canEditLeadSource() ? '<button type="button" class="row-menu-item" data-action="source">Mudar origem</button>' : ""}
    <button type="button" class="row-menu-item" data-action="email" ${lead.email ? "" : "disabled"}>Enviar e-mail</button>
    <button type="button" class="row-menu-item" data-action="quote">${t("lead.viewQuote")}</button>
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
  menu.querySelector('[data-action="status"]').addEventListener("click", () => {
    closeRowMenu();
    openQuickFieldModal([lead.id], "status");
  });
  menu.querySelector('[data-action="temperature"]').addEventListener("click", () => {
    closeRowMenu();
    openQuickFieldModal([lead.id], "temperature");
  });
  menu.querySelector('[data-action="category"]').addEventListener("click", () => {
    closeRowMenu();
    openQuickFieldModal([lead.id], "category");
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
    alert(t("lead.noEmailRegistered"));
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
  const consultants = users.filter(u => isSellRole(u.role));
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
  grid.innerHTML = groups.map(g => `
    <button type="button" class="stuck-card${g.maxDays >= 7 ? " is-urgent" : ""}" data-consultor="${g.consultorId || ""}">
      <span class="stuck-card-avatar">${PERSON_PHOTO_PLACEHOLDER_SVG}</span>
      <span class="stuck-card-body">
        <span class="stuck-card-name">${escapeHtml(g.consultorName)}</span>
        <span class="stuck-card-sub">${t("stuck.upTo")} ${g.maxDays} ${t("stuck.daysStalled")}</span>
      </span>
      <span class="stuck-card-count-wrap">
        <span class="stuck-card-count">${g.leads.length}</span>
        <span class="stuck-card-count-label">parados</span>
      </span>
      <svg class="stuck-card-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
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
        <td><span class="badge ${TEMPERATURE_BADGE[l.temperature] || "badge-neutral"}">${escapeHtml(statusLabel(l.temperature) || "—")}</span></td>
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
  document.getElementById("stuck-bulk-count").textContent = `${count} ${t("common.selectedCount")}`;
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
    document.getElementById("lead-modal-title").textContent = t("lead.editTitle");
    document.getElementById("lead-id").value = lead.id;
    document.getElementById("lead-field-name").value = lead.name;
    document.getElementById("lead-field-company").value = lead.company || "";
    document.getElementById("lead-field-country").value = lead.countryCode || "BR";
    document.getElementById("lead-field-ddd").value = lead.phoneDdd || "";
    document.getElementById("lead-field-phone").value = lead.phoneNumber || "";
    document.getElementById("lead-field-email").value = lead.email || "";
    document.getElementById("lead-field-category").value = lead.category || "Outro";
    document.getElementById("lead-field-source").value = lead.source || "Indicação";
    document.getElementById("lead-field-temperature").value = lead.temperature || "";
    document.getElementById("lead-field-status").value = lead.status || "Novo";
    document.getElementById("lead-field-notes").value = lead.notes || "";
    document.getElementById("lead-field-active").checked = lead.active !== false;
    leadBtnDelete.style.display = "inline-block";
    const referredLead = lead.referredByLeadId ? leads.find(l => l.id === lead.referredByLeadId) : null;
    document.getElementById("lead-field-referred-by").value = lead.referredByLeadId || "";
    document.getElementById("lead-referred-search").value = referredLead ? referredLead.name : "";
  } else {
    document.getElementById("lead-modal-title").textContent = t("lead.newTitle");
    document.getElementById("lead-id").value = "";
    document.getElementById("lead-field-country").value = "BR";
    document.getElementById("lead-field-category").value = "Outro";
    document.getElementById("lead-field-source").value = "Indicação";
    document.getElementById("lead-field-temperature").value = "";
    document.getElementById("lead-field-active").checked = true;
    document.getElementById("lead-field-referred-by").value = "";
    document.getElementById("lead-referred-search").value = "";
    leadBtnDelete.style.display = "none";
  }

  /* origem só pode ser alterada por ADM/Gerente depois que o lead já
     existe — na criação, qualquer função pode escolher a origem */
  const sourceField = document.getElementById("lead-field-source");
  const sourceLocked = !!id && !canEditLeadSource();
  sourceField.disabled = sourceLocked;
  sourceField.title = sourceLocked ? t("lead.sourceLockedHint") : "";

  apptSetupLeadActivity(id || null);
  leadModalBackdrop.classList.add("open");
  document.getElementById("lead-field-name").focus();
}

function closeLeadModal() { leadModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-lead").addEventListener("click", () => openLeadModal(null));
document.getElementById("lead-modal-close").addEventListener("click", closeLeadModal);
document.getElementById("lead-btn-cancel").addEventListener("click", closeLeadModal);
leadModalBackdrop.addEventListener("click", e => { if (e.target === leadModalBackdrop) closeLeadModal(); });

/* ---- busca de lead pra "Indicado por" (mesmo padrão da busca de lead em Matrículas) ---- */
const leadReferredSearch = document.getElementById("lead-referred-search");
const leadReferredResults = document.getElementById("lead-referred-results");
const leadFieldReferredBy = document.getElementById("lead-field-referred-by");

function renderLeadReferredResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) { leadReferredResults.classList.remove("open"); leadReferredResults.innerHTML = ""; return; }
  const currentId = document.getElementById("lead-id").value;
  const matches = leads.filter(l =>
    l.id !== currentId && ((l.name && l.name.toLowerCase().includes(q)) || (l.email && l.email.toLowerCase().includes(q)))
  ).slice(0, 8);
  leadReferredResults.innerHTML = matches.length
    ? matches.map(l => `
      <div class="enr-lead-result-item" data-id="${l.id}">
        <div>${escapeHtml(l.name)}</div>
        <div class="sub">${escapeHtml(l.email || l.phone || t("enr.noContact"))}</div>
      </div>`).join("")
    : `<div class="enr-lead-result-empty">${t("enr.noLeadFound")}</div>`;
  leadReferredResults.classList.add("open");
}
leadReferredSearch.addEventListener("input", () => {
  leadFieldReferredBy.value = "";
  renderLeadReferredResults(leadReferredSearch.value);
});
leadReferredSearch.addEventListener("focus", () => {
  if (leadReferredSearch.value.trim()) renderLeadReferredResults(leadReferredSearch.value);
});
leadReferredSearch.addEventListener("blur", () => {
  setTimeout(() => leadReferredResults.classList.remove("open"), 150);
});
leadReferredResults.addEventListener("mousedown", e => {
  const item = e.target.closest(".enr-lead-result-item[data-id]");
  if (!item) return;
  const lead = leads.find(l => l.id === item.dataset.id);
  if (!lead) return;
  leadFieldReferredBy.value = lead.id;
  leadReferredSearch.value = lead.name;
  leadReferredResults.classList.remove("open");
});

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
    alert(t("lead.fillPhoneForWhatsapp"));
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
    referredByLeadId: document.getElementById("lead-field-referred-by").value || null,
  };

  if (data.email && leads.some(l => l.id !== id && l.email && l.email.toLowerCase() === data.email.toLowerCase())) {
    alert(`${t("lead.emailAlreadyExists")} "${data.email}".`);
    return;
  }

  /* telefone repetido: só barra lead novo ou telefone alterado (leads
     antigos que já repetiam continuam editáveis) */
  const original = id ? leads.find(l => l.id === id) : null;
  if (!original || leadPhoneKey(original) !== leadPhoneKey(data)) {
    const phoneDup = findLeadWithSamePhone(data, id || null);
    if (phoneDup) {
      alert(`${t("lead.phoneAlreadyExists")} ${phoneDup.name}.`);
      return;
    }
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
    const newDeal = createDealForLead(newLead);
    renderBoard();
    await saveDeals(newDeal ? [newDeal] : []);
    await maybeAssignRotation(newLead);
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
      alert(t("import.noRowsFound"));
      return;
    }
    importHeaders = parsed[0];
    importRows = parsed.slice(1);
    openImportModal();
  };
  reader.onerror = () => alert(t("import.cantReadFile"));
  reader.readAsText(file, "UTF-8");
});

function openImportModal() {
  document.getElementById("import-summary").textContent =
    `${importRows.length} linha(s) encontrada(s) em ${importHeaders.length} coluna(s). Confira o mapeamento antes de importar.`;

  importMappingTbody.innerHTML = importHeaders.map((h, i) => {
    const sample = (importRows[0] && importRows[0][i]) || "";
    const guess = guessImportField(h);
    const options = `<option value="">${t("import.dontImport")}</option>` +
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
  const seenPhones = new Set(leads.map(leadPhoneKey).filter(Boolean));

  importRows.forEach(row => {
    const get = key => mapping[key] !== undefined ? (row[mapping[key]] || "").trim() : "";
    const name = get("name");
    if (!name) { skipped++; return; }

    const email = get("email");
    if (email && seenEmails.has(email.toLowerCase())) { skippedDuplicates++; return; }

    let consultorId = null;
    const consultorRaw = get("consultor");
    if (consultorRaw) {
      const match = users.find(u => isSellRole(u.role) &&
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
      temperature: matchEnum(get("temperature"), TEMPERATURES, ""),
      status: matchEnum(get("status"), ["Novo", "Em contato", "Qualificado", "Descartado"], "Novo"),
      consultorId,
      active: true,
      createdAt: now,
    };
    const phoneKey = leadPhoneKey(newLead);
    if (phoneKey && seenPhones.has(phoneKey)) { skippedDuplicates++; return; }
    if (email) seenEmails.add(email.toLowerCase());
    if (phoneKey) seenPhones.add(phoneKey);
    leads.push(newLead);
    importedLeads.push(newLead);
    imported++;
  });

  renderLeads();
  closeImportModal();
  alert(`${t("import.completed1")} ${imported} ${t("import.completed2")}`
    + `${skipped ? `, ${skipped} ${t("import.skippedNoName")}` : ""}`
    + `${skippedDuplicates ? `, ${skippedDuplicates} ${t("import.skippedDuplicates")}` : ""}.`);
  await saveLeads();

  if (importedLeads.length) {
    const newDeals = importedLeads.map(l => createDealForLead(l)).filter(Boolean);
    renderBoard();
    await saveDeals(newDeals);
    for (const l of importedLeads) await maybeAssignRotation(l);
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
  sourcesListEl.innerHTML = SOURCES.map((s, i) => {
    const cfg = sourceInfluencerConfig[s] || { isInfluencer: false, commissionPct: 0, mode: "percentage", fixedAm: 0, fixedPm: 0 };
    const isFixed = cfg.mode === "fixed_turno";
    return `
    <div class="source-row">
      <input type="text" value="${escapeHtml(s)}" data-index="${i}">
      <span class="source-usage">${sourceUsageCount(s)} lead(s)</span>
      <label class="checkbox-label source-influencer-toggle">
        <input type="checkbox" class="source-influencer-checkbox" data-name="${escapeHtml(s)}" ${cfg.isInfluencer ? "checked" : ""}>
        <span>${t("leads.sourceIsInfluencer")}</span>
      </label>
      <select class="source-influencer-mode" data-name="${escapeHtml(s)}" style="${cfg.isInfluencer ? "" : "display:none;"}">
        <option value="percentage" ${!isFixed ? "selected" : ""}>${t("leads.commissionModePct")}</option>
        <option value="fixed_turno" ${isFixed ? "selected" : ""}>${t("leads.commissionModeFixedTurno")}</option>
      </select>
      <input type="number" class="source-influencer-pct" data-name="${escapeHtml(s)}" min="0" max="100" step="0.5"
        value="${cfg.commissionPct}" title="${t("leads.influencerCommissionPct")}" style="${cfg.isInfluencer && !isFixed ? "" : "display:none;"}">
      <span class="source-influencer-turno-fields" style="${cfg.isInfluencer && isFixed ? "display:inline-flex;" : "display:none;"}">
        <input type="number" class="source-influencer-fixed-am" data-name="${escapeHtml(s)}" min="0" step="0.01"
          value="${cfg.fixedAm}" title="${t("leads.commissionFixedAm")}" placeholder="${t("leads.commissionFixedAm")}">
        <input type="number" class="source-influencer-fixed-pm" data-name="${escapeHtml(s)}" min="0" step="0.01"
          value="${cfg.fixedPm}" title="${t("leads.commissionFixedPm")}" placeholder="${t("leads.commissionFixedPm")}">
      </span>
      <button type="button" class="btn btn-icon" data-act="del" data-index="${i}" title="${t("leads.deleteSource")}">&times;</button>
    </div>`;
  }).join("");
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
    alert(t("leads.duplicateSourceName"));
    input.value = oldName;
    return;
  }
  if (newName === oldName) return;

  SOURCES[index] = newName;
  leads.forEach(l => { if (l.source === oldName) l.source = newName; });
  if (sourceInfluencerConfig[oldName]) {
    sourceInfluencerConfig[newName] = sourceInfluencerConfig[oldName];
    delete sourceInfluencerConfig[oldName];
  }
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
    alert(t("leads.keepAtLeastOneSource"));
    return;
  }
  const count = sourceUsageCount(name);
  const msg = count > 0
    ? `${t("leads.confirmDeleteSource1")} "${name}"? ${count} ${t("leads.confirmDeleteSource2")} "${name}" ${t("leads.confirmDeleteSource3")}`
    : `${t("leads.confirmDeleteSource1")} "${name}"?`;
  if (!confirm(msg)) return;
  SOURCES.splice(index, 1);
  delete sourceInfluencerConfig[name];
  renderSourcesList();
  renderLeadFilterOptions();
  await deleteSourceRemote(name);
});

sourcesListEl.addEventListener("change", async e => {
  const cb = e.target.closest(".source-influencer-checkbox");
  const modeSel = e.target.closest(".source-influencer-mode");
  const pctInput = e.target.closest(".source-influencer-pct");
  const fixedAmInput = e.target.closest(".source-influencer-fixed-am");
  const fixedPmInput = e.target.closest(".source-influencer-fixed-pm");
  const control = cb || modeSel || pctInput || fixedAmInput || fixedPmInput;
  if (!control) return;
  const name = control.dataset.name;
  const cfg = sourceInfluencerConfig[name] || { isInfluencer: false, commissionPct: 0, mode: "percentage", fixedAm: 0, fixedPm: 0 };
  if (cb) cfg.isInfluencer = cb.checked;
  if (modeSel) cfg.mode = modeSel.value;
  if (pctInput) cfg.commissionPct = Math.max(0, Math.min(100, parseFloat(pctInput.value) || 0));
  if (fixedAmInput) cfg.fixedAm = Math.max(0, parseFloat(fixedAmInput.value) || 0);
  if (fixedPmInput) cfg.fixedPm = Math.max(0, parseFloat(fixedPmInput.value) || 0);
  sourceInfluencerConfig[name] = cfg;
  renderSourcesList();
  await updateSourceInfluencerRemote(name, cfg);
});

async function addNewSource() {
  const name = sourcesNewInput.value.trim();
  if (!name) return;
  const duplicate = SOURCES.some(s => s.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    alert(t("leads.duplicateSourceName"));
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

/* ---- modal: rodízio de leads (ADM) ---- */
const rotationModalBackdrop = document.getElementById("rotation-modal-backdrop");
const rotationMembersListEl = document.getElementById("rotation-members-list");
let rotationDraftMemberIds = [];

function renderRotationMembersList() {
  const consultants = users.filter(u => isSellRole(u.role) && u.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!consultants.length) {
    rotationMembersListEl.innerHTML = `<p class="muted-note">${t("leads.rotationNoConsultants")}</p>`;
    return;
  }
  rotationMembersListEl.innerHTML = consultants.map(c => `
    <label class="checkbox-label">
      <input type="checkbox" class="rotation-member-checkbox" data-id="${c.id}" ${rotationDraftMemberIds.includes(c.id) ? "checked" : ""}>
      <span>${escapeHtml(c.name)}</span>
    </label>`).join("");
}

function openRotationModal() {
  document.getElementById("rotation-field-enabled").checked = rotationSettings.enabled;
  document.getElementById("rotation-field-timeout").value = rotationSettings.timeoutHours;
  rotationDraftMemberIds = rotationSettings.memberUserIds.slice();
  renderRotationMembersList();
  rotationModalBackdrop.classList.add("open");
}
function closeRotationModal() { rotationModalBackdrop.classList.remove("open"); }

document.getElementById("btn-manage-rotation").addEventListener("click", openRotationModal);
document.getElementById("rotation-modal-close").addEventListener("click", closeRotationModal);
document.getElementById("rotation-btn-cancel").addEventListener("click", closeRotationModal);
rotationModalBackdrop.addEventListener("click", e => { if (e.target === rotationModalBackdrop) closeRotationModal(); });

rotationMembersListEl.addEventListener("change", e => {
  const cb = e.target.closest(".rotation-member-checkbox");
  if (!cb) return;
  const id = cb.dataset.id;
  if (cb.checked) {
    if (!rotationDraftMemberIds.includes(id)) rotationDraftMemberIds.push(id);
  } else {
    rotationDraftMemberIds = rotationDraftMemberIds.filter(x => x !== id);
  }
});

document.getElementById("rotation-btn-save").addEventListener("click", async () => {
  const enabled = document.getElementById("rotation-field-enabled").checked;
  const timeoutHours = Math.max(1, parseFloat(document.getElementById("rotation-field-timeout").value) || 24);
  if (enabled && rotationDraftMemberIds.length === 0) {
    alert(t("leads.rotationNeedMemberError"));
    return;
  }
  rotationSettings = { enabled, timeoutHours, memberUserIds: rotationDraftMemberIds.slice() };
  const ok = await saveRotationSettingsRemote(rotationSettings);
  if (!ok) { alert(t("leads.rotationSaveError")); return; }
  closeRotationModal();
});

/* ============================================================
   CONTRATOS — gerado a partir de um lead, enviado por link público
   pra assinatura eletrônica simples (desenho da assinatura + nome/
   documento/data-hora/IP como prova) e o PDF assinado fica salvo
   no bucket "contract-pdfs".
   ============================================================ */
const CONTRACT_STATUS_BADGE = {
  "Rascunho": "badge-neutral",
  "Aguardando assinatura": "badge-warn",
  "Assinado": "badge-good",
  "Cancelado": "badge-danger",
};
const CONTRACT_DEFAULT_TITLE = "Contrato de Prestação de Serviços";

let contracts = [];

function contractFromDb(r) {
  return {
    id: r.id, leadId: r.lead_id, quoteId: r.quote_id || null, title: r.title || CONTRACT_DEFAULT_TITLE, content: r.content || "",
    value: Number(r.value) || 0, status: r.status,
    signerName: r.signer_name || "", signerDocument: r.signer_document || "",
    signedAt: r.signed_at ? new Date(r.signed_at).getTime() : null, signedIp: r.signed_ip || "",
    pdfPath: r.pdf_path || null, publicToken: r.public_token,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function contractToDb(c) {
  return {
    id: c.id, lead_id: c.leadId || null, quote_id: c.quoteId || null, title: c.title, content: c.content, value: c.value, status: c.status,
    updated_at: new Date().toISOString(),
  };
}
async function loadContracts() {
  const { data, error } = await supabase.from("contracts").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar contratos:", error); return []; }
  return data.map(contractFromDb);
}
async function saveContractRemote(c) {
  const { data, error } = await supabase.from("contracts").upsert(contractToDb(c)).select().single();
  if (error) { console.error("Erro ao salvar contrato:", error); return null; }
  return contractFromDb(data);
}
async function deleteContractRemote(id) {
  const { error } = await supabase.from("contracts").delete().eq("id", id);
  if (error) console.error("Erro ao excluir contrato:", error);
}
function buildContractPublicUrl(token) {
  return `${window.location.origin}/contrato-publico.html?token=${token}`;
}

function getFilteredContracts() {
  const status = document.getElementById("contract-filter-status").value;
  return contracts.filter(c => !status || c.status === status);
}
document.getElementById("contract-filter-status").addEventListener("change", renderContractsList);
document.getElementById("contract-filter-clear").addEventListener("click", () => {
  document.getElementById("contract-filter-status").value = "";
  renderContractsList();
});

function renderContractsList() {
  const filtered = getFilteredContracts();
  const tbody = document.getElementById("contracts-tbody");
  document.getElementById("contracts-empty").style.display = filtered.length === 0 ? "block" : "none";
  tbody.innerHTML = filtered.map(c => {
    const lead = c.leadId ? leads.find(l => l.id === c.leadId) : null;
    return `
      <tr data-id="${c.id}">
        <td class="cell-primary">${escapeHtml(lead ? lead.name : "—")}</td>
        <td class="cell-muted">${escapeHtml(c.title)}</td>
        <td class="cell-muted">${currency(c.value)}</td>
        <td><span class="badge ${CONTRACT_STATUS_BADGE[c.status] || "badge-neutral"}">${escapeHtml(statusLabel(c.status))}</span></td>
        <td class="cell-actions">›</td>
      </tr>`;
  }).join("");
  tbody.querySelectorAll("tr[data-id]").forEach(tr => {
    tr.addEventListener("click", () => openContractModal(tr.dataset.id));
  });
}

/* ---- lead search dentro do modal de contrato ---- */
const contractLeadSearch = document.getElementById("contract-lead-search");
const contractLeadResults = document.getElementById("contract-lead-results");
const contractLeadIdField = document.getElementById("contract-field-lead-id");

function renderContractLeadResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) { contractLeadResults.classList.remove("open"); contractLeadResults.innerHTML = ""; return; }
  const matches = leads.filter(l =>
    (l.name && l.name.toLowerCase().includes(q)) || (l.email && l.email.toLowerCase().includes(q))
  ).slice(0, 8);
  contractLeadResults.innerHTML = matches.length
    ? matches.map(l => `
      <div class="enr-lead-result-item" data-id="${l.id}">
        <div>${escapeHtml(l.name)}</div>
        <div class="sub">${escapeHtml(l.email || l.phone || t("enr.noContact"))}</div>
      </div>`).join("")
    : `<div class="enr-lead-result-empty">${t("enr.noLeadFound")}</div>`;
  contractLeadResults.classList.add("open");
}
contractLeadSearch.addEventListener("input", () => {
  contractLeadIdField.value = "";
  renderContractLeadResults(contractLeadSearch.value);
});
contractLeadSearch.addEventListener("focus", () => {
  if (contractLeadSearch.value.trim()) renderContractLeadResults(contractLeadSearch.value);
});
contractLeadSearch.addEventListener("blur", () => {
  setTimeout(() => contractLeadResults.classList.remove("open"), 150);
});
contractLeadResults.addEventListener("mousedown", e => {
  const item = e.target.closest(".enr-lead-result-item[data-id]");
  if (!item) return;
  const lead = leads.find(l => l.id === item.dataset.id);
  if (!lead) return;
  contractLeadIdField.value = lead.id;
  contractLeadSearch.value = lead.name;
  contractLeadResults.classList.remove("open");
});

/* ---- modal de contrato ---- */
const contractModalBackdrop = document.getElementById("contract-modal-backdrop");
const contractForm = document.getElementById("contract-form");
let currentContract = null;

function contractTemplateText(leadName, value) {
  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE INTERCÂMBIO

Pelo presente instrumento particular, de um lado PEREGRINOS INTERCÂMBIO, e de outro lado ${leadName || "[NOME DO CONTRATANTE]"}, doravante denominado CONTRATANTE, têm entre si justo e acordado o presente contrato de prestação de serviços, mediante as cláusulas e condições a seguir:

1. OBJETO
Prestação de serviços de assessoria e intermediação para programa de intercâmbio internacional.

2. VALOR E FORMA DE PAGAMENTO
O valor total dos serviços é de ${currency(value || 0)}, a ser pago conforme condições acordadas entre as partes.

3. OBRIGAÇÕES DAS PARTES
A CONTRATADA se compromete a prestar orientação e suporte durante todo o processo. O CONTRATANTE se compromete a fornecer as informações e documentos necessários dentro dos prazos solicitados.

4. VIGÊNCIA
Este contrato entra em vigor na data de sua assinatura eletrônica.

5. ACEITE ELETRÔNICO
As partes reconhecem como válida a assinatura eletrônica deste contrato, nos termos da legislação brasileira aplicável (MP 2.200-2/2001), com registro de nome, documento, data/hora e endereço IP como prova de aceite.

E, por estarem de acordo, assinam o presente instrumento.`;
}

document.getElementById("contract-btn-template").addEventListener("click", () => {
  const lead = leads.find(l => l.id === contractLeadIdField.value);
  const value = parseFloat(document.getElementById("contract-field-value").value) || 0;
  document.getElementById("contract-field-content").value = contractTemplateText(lead ? lead.name : "", value);
});

function setContractFieldsDisabled(disabled) {
  contractLeadSearch.disabled = disabled;
  document.getElementById("contract-field-title").disabled = disabled;
  document.getElementById("contract-field-value").disabled = disabled;
  document.getElementById("contract-field-content").disabled = disabled;
  document.getElementById("contract-btn-template").style.display = disabled ? "none" : "";
}

function openContractModal(id, quotePrefill) {
  contractForm.reset();
  currentContract = id ? contracts.find(c => c.id === id) : null;

  const canManage = !!(session && ["ADM", "Gerente"].includes(session.role));
  const btnDelete = document.getElementById("contract-btn-delete");
  const btnDownload = document.getElementById("contract-btn-download-pdf");
  const btnCopyLink = document.getElementById("contract-btn-copy-link");
  const btnCancelContract = document.getElementById("contract-btn-cancel-contract");
  const btnSend = document.getElementById("contract-btn-send");
  const btnSave = document.getElementById("contract-btn-save");
  const signedInfo = document.getElementById("contract-signed-info");
  [btnDelete, btnDownload, btnCopyLink, btnCancelContract, btnSend].forEach(b => b.style.display = "none");
  btnSave.style.display = "";
  signedInfo.style.display = "none";

  if (currentContract) {
    const lead = currentContract.leadId ? leads.find(l => l.id === currentContract.leadId) : null;
    document.getElementById("contract-modal-title").textContent = currentContract.title;
    document.getElementById("contract-id").value = currentContract.id;
    document.getElementById("contract-quote-id").value = currentContract.quoteId || "";
    contractLeadIdField.value = currentContract.leadId || "";
    contractLeadSearch.value = lead ? lead.name : "";
    document.getElementById("contract-field-title").value = currentContract.title;
    document.getElementById("contract-field-value").value = currentContract.value || "";
    document.getElementById("contract-field-content").value = currentContract.content;

    const isDraft = currentContract.status === "Rascunho";
    setContractFieldsDisabled(!isDraft);
    btnSave.style.display = isDraft ? "" : "none";
    btnSend.style.display = isDraft ? "" : "none";
    btnDelete.style.display = canManage ? "" : "none";

    if (currentContract.status === "Aguardando assinatura") {
      btnCopyLink.style.display = "";
      btnCancelContract.style.display = "";
    }
    if (currentContract.status === "Assinado") {
      btnDownload.style.display = "";
      signedInfo.style.display = "block";
      signedInfo.textContent = `Assinado por ${currentContract.signerName || "—"}${currentContract.signerDocument ? ` (documento: ${currentContract.signerDocument})` : ""} em ${currentContract.signedAt ? new Date(currentContract.signedAt).toLocaleString("pt-BR") : "—"}${currentContract.signedIp ? ` · IP ${currentContract.signedIp}` : ""}.`;
    }
  } else {
    document.getElementById("contract-modal-title").textContent = t("contracts.newTitle");
    document.getElementById("contract-id").value = "";
    document.getElementById("contract-quote-id").value = quotePrefill ? quotePrefill.id : "";
    document.getElementById("contract-field-title").value = CONTRACT_DEFAULT_TITLE;
    setContractFieldsDisabled(false);
    btnSend.style.display = "";

    if (quotePrefill) {
      const lead = quotePrefill.leadId ? leads.find(l => l.id === quotePrefill.leadId) : null;
      contractLeadIdField.value = quotePrefill.leadId || "";
      contractLeadSearch.value = lead ? lead.name : quotePrefill.client || "";
      document.getElementById("contract-field-value").value = quotePrefill.value || "";
      document.getElementById("contract-field-content").value = contractTemplateText(lead ? lead.name : quotePrefill.client, quotePrefill.value);
    }
  }

  contractModalBackdrop.classList.add("open");
}
function closeContractModal() { contractModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-contract").addEventListener("click", () => openContractModal(null));
document.getElementById("contract-modal-close").addEventListener("click", closeContractModal);
document.getElementById("contract-btn-cancel").addEventListener("click", closeContractModal);
contractModalBackdrop.addEventListener("click", e => { if (e.target === contractModalBackdrop) closeContractModal(); });

function readContractFormData() {
  return {
    leadId: contractLeadIdField.value || null,
    quoteId: document.getElementById("contract-quote-id").value || null,
    title: document.getElementById("contract-field-title").value.trim() || CONTRACT_DEFAULT_TITLE,
    content: document.getElementById("contract-field-content").value.trim(),
    value: parseFloat(document.getElementById("contract-field-value").value) || 0,
  };
}

async function persistContract(statusOverride) {
  const data = readContractFormData();
  if (!data.leadId) { alert(t("contracts.selectLeadError")); return null; }
  if (!data.content) { alert(t("contracts.fillContent")); return null; }

  const id = document.getElementById("contract-id").value;
  const payload = {
    id: id || uid(),
    ...data,
    status: statusOverride || (currentContract ? currentContract.status : "Rascunho"),
  };
  const saved = await saveContractRemote(payload);
  if (!saved) { alert(t("contracts.saveError")); return null; }

  if (id) {
    const idx = contracts.findIndex(c => c.id === id);
    if (idx >= 0) contracts[idx] = saved; else contracts.push(saved);
  } else {
    contracts.push(saved);
  }
  renderContractsList();
  return saved;
}

contractForm.addEventListener("submit", async e => {
  e.preventDefault();
  const saved = await persistContract();
  if (saved) closeContractModal();
});

document.getElementById("contract-btn-send").addEventListener("click", async () => {
  if (!confirm(t("contracts.confirmSend"))) return;
  const saved = await persistContract("Aguardando assinatura");
  if (!saved) return;
  currentContract = saved;
  navigator.clipboard.writeText(buildContractPublicUrl(saved.publicToken)).catch(() => {});
  alert(t("contracts.sentSuccess"));
  openContractModal(saved.id);
});

document.getElementById("contract-btn-copy-link").addEventListener("click", () => {
  if (!currentContract) return;
  navigator.clipboard.writeText(buildContractPublicUrl(currentContract.publicToken));
  const btn = document.getElementById("contract-btn-copy-link");
  btn.textContent = t("common.copied");
  setTimeout(() => { btn.textContent = t("common.copyLink"); }, 1500);
});

document.getElementById("contract-btn-cancel-contract").addEventListener("click", async () => {
  if (!currentContract || !confirm(t("contracts.confirmCancel"))) return;
  const saved = await saveContractRemote({ ...currentContract, status: "Cancelado" });
  if (!saved) { alert(t("contracts.cancelError")); return; }
  const idx = contracts.findIndex(c => c.id === saved.id);
  if (idx >= 0) contracts[idx] = saved;
  renderContractsList();
  closeContractModal();
});

document.getElementById("contract-btn-delete").addEventListener("click", async () => {
  const id = document.getElementById("contract-id").value;
  if (!id || !confirm(t("contracts.confirmDelete"))) return;
  contracts = contracts.filter(c => c.id !== id);
  renderContractsList();
  closeContractModal();
  await deleteContractRemote(id);
});

document.getElementById("contract-btn-download-pdf").addEventListener("click", async () => {
  if (!currentContract || !currentContract.pdfPath) { alert(t("contracts.pdfNotReady")); return; }
  const { data, error } = await supabase.storage.from("contract-pdfs").createSignedUrl(currentContract.pdfPath, 300);
  if (error || !data) { alert(t("contracts.pdfLinkError")); return; }
  window.open(data.signedUrl, "_blank", "noopener");
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
  const consultants = users.filter(u => isSellRole(u.role)).slice().sort((a, b) => a.name.localeCompare(b.name));
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
      <td><span class="badge ${QUOTE_STATUS_BADGE[q.status] || "badge-neutral"}">${escapeHtml(statusLabel(q.status))}</span></td>
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

/* ============================================================
   ESCOLAS — cadastro (itens que cada escola oferece) + comparativo
   AM/PM com os valores vindos dos Produtos. Escola e produto se ligam
   por categoria + destino + nome (= subgrupo do produto).
   ============================================================ */
let schools = [];
let schoolCities = [];
let cmpShift = "am";
let cmpKind = "first";

function schoolFromDb(r) {
  return {
    id: r.id, nome: r.nome, categoria: r.categoria || "Outros", destino: r.destino || "Todos",
    descricao: r.descricao || "", inclusos: Array.isArray(r.inclusos) ? r.inclusos : [],
    ativo: r.ativo !== false, ordem: r.ordem || 0, coverPath: r.cover_path || null, codigo: r.codigo || "",
  };
}
function schoolToDb(s) {
  return {
    id: s.id, nome: s.nome, categoria: s.categoria, destino: s.destino, descricao: s.descricao,
    inclusos: s.inclusos, ativo: s.ativo, ordem: s.ordem, cover_path: s.coverPath || null, codigo: s.codigo,
  };
}
async function loadSchools() {
  const { data, error } = await supabase.from("schools").select("*").order("ordem");
  if (error) { console.error("Erro ao carregar escolas:", error); return []; }
  return data.map(schoolFromDb);
}
async function saveSchoolRemote(s) {
  const { error } = await supabase.from("schools").upsert(schoolToDb(s));
  if (error) console.error("Erro ao salvar escola:", error);
  return !error;
}
async function deleteSchoolRemote(id) {
  const { error } = await supabase.from("schools").delete().eq("id", id);
  if (error) console.error("Erro ao excluir escola:", error);
}

const SCHOOL_COVER_BUCKET = "school-covers";
function schoolCoverUrl(path) {
  return supabase.storage.from(SCHOOL_COVER_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* reduz a foto antes de enviar (lado maior 1400px, JPEG) pra capa não
   pesar na página do cliente; se o navegador não conseguir ler o
   formato, envia o arquivo original */
async function prepareSchoolCover(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / bmp.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.85));
    if (blob) return { body: blob, ext: "jpg", type: "image/jpeg" };
  } catch (err) { console.error("Erro ao reduzir capa:", err); }
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  return { body: file, ext, type: file.type || "image/jpeg" };
}
async function uploadSchoolCover(schoolId, file) {
  const prepared = await prepareSchoolCover(file);
  const path = `${schoolId}-${Date.now()}.${prepared.ext}`;
  const { error } = await supabase.storage.from(SCHOOL_COVER_BUCKET).upload(path, prepared.body, { contentType: prepared.type });
  if (error) { console.error("Erro ao enviar capa da escola:", error); return null; }
  return path;
}
/* só apaga o arquivo se nenhuma outra escola (ex: cópia) ainda usa a mesma capa */
async function removeSchoolCoverFileIfUnused(path) {
  if (!path || schools.some(x => x.coverPath === path)) return;
  const { error } = await supabase.storage.from(SCHOOL_COVER_BUCKET).remove([path]);
  if (error) console.error("Erro ao apagar capa antiga:", error);
}

async function loadSchoolCities() {
  const { data, error } = await supabase.from("school_cities").select("*").order("ordem");
  if (error) { console.error("Erro ao carregar cidades do comparativo:", error); return []; }
  return data.map(r => ({ id: r.id, nome: r.nome, ordem: r.ordem || 0 }));
}
async function saveSchoolCityRemote(c) {
  const { error } = await supabase.from("school_cities").upsert({ id: c.id, nome: c.nome, ordem: c.ordem });
  if (error) console.error("Erro ao salvar cidade:", error);
  return !error;
}
async function deleteSchoolCityRemote(id) {
  const { error } = await supabase.from("school_cities").delete().eq("id", id);
  if (error) console.error("Erro ao excluir cidade:", error);
}
const schoolCityNames = () => schoolCities.slice().sort((a, b) => a.ordem - b.ordem).map(c => c.nome);

/* escola ↔ produtos: pelo código da escola (o nome pode mudar à vontade);
   produto que ainda não tem código cai na regra antiga, por nome */
function schoolProducts(school) {
  return catalog.filter(p => p.ativo && (p.escolaCodigo
    ? p.escolaCodigo === school.codigo
    : (p.categoria || "Outros") === school.categoria
      && (p.destino || "Todos") === school.destino
      && (p.subgrupo || "") === school.nome));
}

function schoolSlug(str) {
  return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
/* mesmo formato da migração 034: nome (+ destino, se o nome ainda não o cita), único */
function newSchoolCode(nome, destino) {
  const base = schoolSlug(String(nome).toLowerCase().includes(String(destino).toLowerCase()) ? nome : `${nome} ${destino}`) || "escola";
  let cand = base, n = 1;
  while (schools.some(x => x.codigo === cand)) cand = `${base}-${++n}`;
  return cand;
}

/* produtos que estavam ligados à escola (pela chave antiga) passam a
   usar a chave nova */
async function followSchoolChangeInCatalog(before, school) {
  const linked = catalog.filter(p => p.escolaCodigo
    ? p.escolaCodigo === school.codigo
    : (p.categoria || "Outros") === before.categoria && (p.destino || "Todos") === before.destino && (p.subgrupo || "") === before.nome);
  linked.forEach(p => {
    p.escolaCodigo = school.codigo;
    p.categoria = school.categoria; p.destino = school.destino; p.subgrupo = school.nome;
  });
  if (!linked.length) return;
  await bulkSaveCatalogItemsRemote(linked);
  renderCatalogList();
  quoteMontaDestinos();
  quoteMontaCatalogo();
}

function renderEscolas() {
  const isAdmin = !!(session && session.role === "ADM");
  document.getElementById("btn-new-school").style.display = isAdmin ? "" : "none";
  document.getElementById("cmp-edit-cities").style.display = isAdmin ? "" : "none";
  document.getElementById("escolas-subtabs").style.display = isAdmin ? "" : "none";
  if (!isAdmin) showEscolasSubtab("comparativo");
  renderSchoolComparisonView();
  renderSchoolsList();
}

function showEscolasSubtab(target) {
  document.querySelectorAll("#escolas-subtabs .subtab").forEach(b => b.classList.toggle("active", b.dataset.escSubtab === target));
  document.getElementById("subview-escolas-comparativo").classList.toggle("active", target === "comparativo");
  document.getElementById("subview-escolas-cadastro").classList.toggle("active", target === "cadastro");
}

function renderSchoolComparisonView() {
  const destinoSel = document.getElementById("cmp-filter-destino");
  const term = (document.getElementById("cmp-filter-search").value || "").trim().toLowerCase();
  const ativas = schools.filter(s => s.ativo);
  const destinos = [...new Set(ativas.map(s => s.destino))].sort();
  const current = destinoSel.value;
  destinoSel.innerHTML = `<option value="">${t("quotes.cmpAllDestinations")}</option>` +
    destinos.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  destinoSel.value = destinos.includes(current) ? current : "";

  const list = ativas.filter(s => {
    if (destinoSel.value && s.destino !== destinoSel.value) return false;
    if (term && ![s.nome, s.destino, s.categoria].join(" ").toLowerCase().includes(term)) return false;
    return true;
  }).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));

  document.querySelectorAll("#cmp-shift-toggle .cmp-shift-btn").forEach(b => b.classList.toggle("active", b.dataset.shift === cmpShift));
  document.querySelectorAll("#cmp-kind-toggle .cmp-shift-btn").forEach(b => b.classList.toggle("active", b.dataset.kind === cmpKind));
  ["am", "pm"].forEach(sh => {
    document.getElementById(`cmp-copy-${sh}`).textContent =
      t(sh === "am" ? "schools.copyLinkAm" : "schools.copyLinkPm") + (cmpKind === "renewal" ? ` ${t("schools.renewalSuffix")}` : "");
  });
  document.getElementById("cmp-container").innerHTML = renderSchoolComparison(list, schoolProducts, cmpShift, {
    escape: escapeHtml, money: currency, classify: classifyTurnoShift, kind: cmpKind, coverUrl: schoolCoverUrl, cities: schoolCityNames(),
    labels: {
      empty: t("schools.empty"), from: t("quotes.cmpFrom"), values: t("quotes.cmpValues"), includes: t("schools.includesTitle"),
      overview: t("quotes.cmpOverview"), option: t("quotes.cmpOption"), options: t("quotes.cmpOptions"), noValues: t("schools.noValues"), cityNoSchools: t("schools.cityNoSchools"),
    },
  });
}

function renderSchoolsList() {
  const isAdmin = !!(session && session.role === "ADM");
  const el = document.getElementById("schools-list");
  if (!schools.length) { el.innerHTML = `<p class="muted-note" style="padding:0 20px 16px;">${t("schools.empty")}</p>`; return; }
  const rows = schools.slice().sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome)).map(s => {
    const n = schoolProducts(s).length;
    return `
      <div class="school-row${s.ativo ? "" : " off"}">
        <div class="school-row-main">
          <div class="school-row-name">${escapeHtml(s.nome)}${s.ativo ? "" : ` <span class="prod-tag">${t("products.hiddenTag")}</span>`}</div>
          <div class="school-row-meta">${escapeHtml(s.destino)}, ${escapeHtml(s.categoria)} · ${n} ${t("schools.productsCount")} · ${s.inclusos.length} ${t("schools.includesCount")}</div>
        </div>
        ${isAdmin ? `<div class="acts">
          <button type="button" class="btn btn-ghost btn-sm" data-sact="edit" data-id="${s.id}">${t("common.edit")}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-sact="dup" data-id="${s.id}">${t("common.duplicate")}</button>
          <button type="button" class="btn btn-danger btn-sm" data-sact="del" data-id="${s.id}">${t("common.delete")}</button>
        </div>` : ""}
      </div>`;
  }).join("");
  el.innerHTML = rows;
}

/* ---- modal da escola ---- */
const schoolModalBackdrop = document.getElementById("school-modal-backdrop");
const schoolForm = document.getElementById("school-form");

function fillSchoolDatalists() {
  const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
  document.getElementById("school-categorias-list").innerHTML =
    uniq([...catalog.map(p => p.categoria), ...schools.map(s => s.categoria)]).map(v => `<option value="${escapeHtml(v)}">`).join("");
  document.getElementById("school-destinos-list").innerHTML =
    uniq([...catalog.map(p => p.destino), ...schools.map(s => s.destino)]).map(v => `<option value="${escapeHtml(v)}">`).join("");
}

let schoolCoverRemoved = false;
function showSchoolCoverPreview(url) {
  const box = document.getElementById("school-cover-preview");
  box.style.backgroundImage = url ? `url("${url}")` : "";
  box.textContent = url ? "" : t("schools.noCover");
  document.getElementById("school-cover-remove").style.display = url ? "" : "none";
}
document.getElementById("school-field-cover").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  schoolCoverRemoved = false;
  showSchoolCoverPreview(URL.createObjectURL(file));
});
document.getElementById("school-cover-remove").addEventListener("click", () => {
  schoolCoverRemoved = true;
  document.getElementById("school-field-cover").value = "";
  showSchoolCoverPreview(null);
});

function openSchoolModal(id) {
  schoolForm.reset();
  fillSchoolDatalists();
  const s = id ? schools.find(x => x.id === id) : null;
  document.getElementById("school-modal-title").textContent = s ? t("schools.editTitle") : t("schools.newTitle");
  document.getElementById("school-id").value = s ? s.id : "";
  document.getElementById("school-field-nome").value = s ? s.nome : "";
  document.getElementById("school-code-line").style.display = s ? "" : "none";
  document.getElementById("school-code-value").textContent = s ? s.codigo : "";
  document.getElementById("school-field-categoria").value = s ? s.categoria : "";
  document.getElementById("school-field-destino").value = s ? s.destino : "";
  document.getElementById("school-field-descricao").value = s ? s.descricao : "";
  document.getElementById("school-field-inclusos").value = s ? s.inclusos.join("\n") : "";
  document.getElementById("school-field-ativo").checked = s ? s.ativo : true;
  schoolCoverRemoved = false;
  document.getElementById("school-field-cover").value = "";
  showSchoolCoverPreview(s && s.coverPath ? schoolCoverUrl(s.coverPath) : null);
  document.getElementById("school-btn-delete").style.display = s ? "" : "none";
  document.getElementById("school-btn-duplicate").style.display = s ? "" : "none";
  schoolModalBackdrop.classList.add("open");
}
function closeSchoolModal() { schoolModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-school").addEventListener("click", () => openSchoolModal(null));
document.getElementById("school-modal-close").addEventListener("click", closeSchoolModal);
document.getElementById("school-btn-cancel").addEventListener("click", closeSchoolModal);
schoolModalBackdrop.addEventListener("click", e => { if (e.target === schoolModalBackdrop) closeSchoolModal(); });

schoolForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("school-id").value;
  const data = {
    nome: document.getElementById("school-field-nome").value.trim(),
    categoria: document.getElementById("school-field-categoria").value.trim(),
    destino: document.getElementById("school-field-destino").value.trim(),
    descricao: document.getElementById("school-field-descricao").value.trim(),
    inclusos: document.getElementById("school-field-inclusos").value.split("\n").map(x => x.trim()).filter(Boolean),
    ativo: document.getElementById("school-field-ativo").checked,
  };
  if (!data.nome || !data.categoria || !data.destino) return;
  const dup = schools.some(x => x.id !== id && x.nome === data.nome && x.categoria === data.categoria && x.destino === data.destino);
  if (dup) { alert(t("schools.duplicateError")); return; }

  let school;
  let moved = null;
  if (id) {
    school = schools.find(x => x.id === id);
    const before = { nome: school.nome, categoria: school.categoria, destino: school.destino };
    if (before.nome !== data.nome || before.categoria !== data.categoria || before.destino !== data.destino) moved = before;
    Object.assign(school, data);
  } else {
    school = { id: uid(), ordem: schools.reduce((m, x) => Math.max(m, x.ordem), 0) + 1, coverPath: null, codigo: newSchoolCode(data.nome, data.destino), ...data };
    schools.push(school);
  }

  const oldCover = school.coverPath;
  const coverFile = document.getElementById("school-field-cover").files[0];
  if (coverFile) {
    const newPath = await uploadSchoolCover(school.id, coverFile);
    if (newPath) school.coverPath = newPath;
    else alert(t("schools.coverError"));
  } else if (schoolCoverRemoved) {
    school.coverPath = null;
  }

  /* o vínculo escola ↔ produtos é por categoria + destino + nome: se a
     escola mudou de nome/destino, os produtos dela acompanham, senão o
     comparativo perde os preços */
  if (moved) await followSchoolChangeInCatalog(moved, school);

  const ok = await saveSchoolRemote(school);
  if (!ok) alert(t("schools.saveError"));
  else if (oldCover && oldCover !== school.coverPath) await removeSchoolCoverFileIfUnused(oldCover);
  closeSchoolModal();
  renderEscolas();
});

function uniqueSchoolCopyName(school) {
  let name = `${school.nome} (${t("common.copy")})`;
  let n = 2;
  while (schools.some(x => x.nome === name && x.categoria === school.categoria && x.destino === school.destino)) {
    name = `${school.nome} (${t("common.copy")} ${n++})`;
  }
  return name;
}

async function duplicateSchool(id) {
  const src = schools.find(x => x.id === id);
  if (!src) return;
  const copy = {
    ...src, id: uid(), nome: uniqueSchoolCopyName(src), inclusos: src.inclusos.slice(),
    ordem: schools.reduce((m, x) => Math.max(m, x.ordem), 0) + 1,
  };
  copy.codigo = newSchoolCode(copy.nome, copy.destino);
  schools.push(copy);
  const ok = await saveSchoolRemote(copy);
  if (!ok) alert(t("schools.saveError"));
  renderEscolas();
  openSchoolModal(copy.id);
}

document.getElementById("school-btn-duplicate").addEventListener("click", () => {
  const id = document.getElementById("school-id").value;
  closeSchoolModal();
  duplicateSchool(id);
});
document.getElementById("school-btn-delete").addEventListener("click", async () => {
  const id = document.getElementById("school-id").value;
  const s = schools.find(x => x.id === id);
  if (!s || !confirm(`${t("schools.confirmDelete")} "${s.nome}"?`)) return;
  schools = schools.filter(x => x.id !== id);
  closeSchoolModal();
  renderEscolas();
  await deleteSchoolRemote(id);
  await removeSchoolCoverFileIfUnused(s.coverPath);
});

document.getElementById("schools-list").addEventListener("click", async e => {
  const btn = e.target.closest("[data-sact]");
  if (!btn || !(session && session.role === "ADM")) return;
  const id = btn.dataset.id;
  if (btn.dataset.sact === "edit") openSchoolModal(id);
  if (btn.dataset.sact === "dup") await duplicateSchool(id);
  if (btn.dataset.sact === "del") {
    const s = schools.find(x => x.id === id);
    if (!s || !confirm(`${t("schools.confirmDelete")} "${s.nome}"?`)) return;
    schools = schools.filter(x => x.id !== id);
    renderEscolas();
    await deleteSchoolRemote(id);
    await removeSchoolCoverFileIfUnused(s.coverPath);
  }
});

document.querySelectorAll("#escolas-subtabs .subtab").forEach(btn => {
  btn.addEventListener("click", () => showEscolasSubtab(btn.dataset.escSubtab));
});
document.getElementById("cmp-shift-toggle").addEventListener("click", e => {
  const btn = e.target.closest(".cmp-shift-btn");
  if (!btn) return;
  cmpShift = btn.dataset.shift;
  renderSchoolComparisonView();
});
document.getElementById("cmp-kind-toggle").addEventListener("click", e => {
  const btn = e.target.closest(".cmp-shift-btn");
  if (!btn) return;
  cmpKind = btn.dataset.kind;
  renderSchoolComparisonView();
});
document.getElementById("cmp-filter-destino").addEventListener("change", renderSchoolComparisonView);
document.getElementById("cmp-filter-search").addEventListener("input", renderSchoolComparisonView);
document.getElementById("cmp-container").addEventListener("click", e => {
  const link = e.target.closest("[data-cmp-target]");
  if (!link) return;
  e.preventDefault();
  const target = document.getElementById(link.dataset.cmpTarget);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
});
/* ---- editor do menu de cidades (só ADM) ---- */
const citiesModalBackdrop = document.getElementById("cities-modal-backdrop");

function renderCitiesEditor() {
  const sorted = schoolCities.slice().sort((a, b) => a.ordem - b.ordem);
  document.getElementById("cities-list").innerHTML = sorted.map((c, i) => {
    const n = schools.filter(s => s.destino === c.nome).length;
    return `
    <div class="city-row">
      <input type="text" value="${escapeHtml(c.nome)}" data-id="${c.id}">
      <span class="city-count">${n} ${t("schools.cityCount")}</span>
      <button type="button" class="btn btn-ghost btn-icon" data-cact="up" data-id="${c.id}" ${i === 0 ? "disabled" : ""} title="${t("schools.moveUp")}">↑</button>
      <button type="button" class="btn btn-ghost btn-icon" data-cact="down" data-id="${c.id}" ${i === sorted.length - 1 ? "disabled" : ""} title="${t("schools.moveDown")}">↓</button>
      <button type="button" class="btn btn-icon" data-cact="del" data-id="${c.id}" title="${t("common.delete")}">&times;</button>
    </div>`;
  }).join("");
}
function refreshAfterCitiesChange() {
  renderCitiesEditor();
  renderSchoolComparisonView();
}

document.getElementById("cmp-edit-cities").addEventListener("click", () => {
  document.getElementById("cities-new-input").value = "";
  renderCitiesEditor();
  citiesModalBackdrop.classList.add("open");
});
const closeCitiesModal = () => citiesModalBackdrop.classList.remove("open");
document.getElementById("cities-modal-close").addEventListener("click", closeCitiesModal);
document.getElementById("cities-btn-done").addEventListener("click", closeCitiesModal);
citiesModalBackdrop.addEventListener("click", e => { if (e.target === citiesModalBackdrop) closeCitiesModal(); });

async function addSchoolCity() {
  if (!(session && session.role === "ADM")) return;
  const input = document.getElementById("cities-new-input");
  const nome = input.value.trim();
  if (!nome) return;
  if (schoolCities.some(c => c.nome.toLowerCase() === nome.toLowerCase())) { alert(t("schools.cityDuplicateError")); return; }
  const city = { id: uid(), nome, ordem: schoolCities.reduce((m, c) => Math.max(m, c.ordem), 0) + 1 };
  schoolCities.push(city);
  input.value = "";
  refreshAfterCitiesChange();
  await saveSchoolCityRemote(city);
}
document.getElementById("cities-add-btn").addEventListener("click", addSchoolCity);
document.getElementById("cities-new-input").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addSchoolCity(); }
});

document.getElementById("cities-list").addEventListener("change", async e => {
  const input = e.target.closest('input[type="text"]');
  if (!input || !(session && session.role === "ADM")) return;
  const city = schoolCities.find(c => c.id === input.dataset.id);
  const nome = input.value.trim();
  if (!city) return;
  if (!nome) { input.value = city.nome; return; }
  if (schoolCities.some(c => c.id !== city.id && c.nome.toLowerCase() === nome.toLowerCase())) {
    alert(t("schools.cityDuplicateError")); input.value = city.nome; return;
  }
  city.nome = nome;
  refreshAfterCitiesChange();
  await saveSchoolCityRemote(city);
});

document.getElementById("cities-list").addEventListener("click", async e => {
  const btn = e.target.closest("[data-cact]");
  if (!btn || btn.disabled || !(session && session.role === "ADM")) return;
  const sorted = schoolCities.slice().sort((a, b) => a.ordem - b.ordem);
  const i = sorted.findIndex(c => c.id === btn.dataset.id);
  if (i === -1) return;
  if (btn.dataset.cact === "del") {
    if (!confirm(`${t("schools.confirmDeleteCity")} "${sorted[i].nome}"?`)) return;
    schoolCities = schoolCities.filter(c => c.id !== sorted[i].id);
    refreshAfterCitiesChange();
    await deleteSchoolCityRemote(sorted[i].id);
    return;
  }
  const j = btn.dataset.cact === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= sorted.length) return;
  const a = sorted[i], b = sorted[j];
  [a.ordem, b.ordem] = [b.ordem, a.ordem];
  refreshAfterCitiesChange();
  await Promise.all([saveSchoolCityRemote(a), saveSchoolCityRemote(b)]);
});

function buildSchoolsPublicUrl(shift) {
  return `${window.location.origin}/escolas-publico.html?turno=${shift}${cmpKind === "renewal" ? "&tipo=renovacao" : ""}`;
}
["am", "pm"].forEach(shift => {
  const btn = document.getElementById(`cmp-copy-${shift}`);
  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(buildSchoolsPublicUrl(shift)).catch(() => {});
    const original = btn.textContent;
    btn.textContent = t("common.copied");
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
});
document.getElementById("cmp-open-client").addEventListener("click", () => {
  window.open(buildSchoolsPublicUrl(cmpShift), "_blank", "noopener");
});
document.getElementById("btn-compare-schools").addEventListener("click", () => { switchView("escolas"); showEscolasSubtab("comparativo"); });

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
  quoteAbertos = {};
  document.querySelectorAll(".quote-form-body .err").forEach(el => el.classList.remove("err"));

  document.getElementById("q-btn-excluir").style.display = id ? "inline-block" : "none";
  document.getElementById("q-btn-gerar-contrato").style.display = id ? "" : "none";
  document.getElementById("quote-builder-title").textContent = id ? t("quotes.editTitle") : t("quotes.newTitle");

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
  if (!id || !confirm(t("quotes.confirmDelete"))) return;
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
        <div class="sub">${escapeHtml(l.email || l.phone || t("enr.noContact"))}</div>
      </div>`).join("")
    : `<div class="enr-lead-result-empty">${t("enr.noLeadFound")}</div>`;
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
    subs: Array.isArray(r.subs) ? r.subs : [], escolaCodigo: r.escola_codigo || "",
  };
}
function catalogToDb(p) {
  return {
    id: p.id, nome: p.nome, categoria: p.categoria, destino: p.destino,
    subgrupo: p.subgrupo, turno: p.turno, unidade: p.unidade, preco: p.preco,
    ordem: p.ordem, detalhe: p.detalhe, qtd_fixa: p.qtdFixa, qtd_padrao: p.qtdPadrao,
    ativo: p.ativo, subs: p.subs, escola_codigo: p.escolaCodigo || null,
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
/* cor fixa por nível da árvore — padroniza visualmente (mesmo nível =
   mesma cor sempre) e dá contraste entre categoria/destino/escola/turno */
const CATALOG_KIND_COLORS = {
  categoria: "#3167A1",
  destino: "#0EA5E9",
  escola: "#8B5CF6",
  turno: "#F59E0B",
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
      <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${p.id}">${t("common.edit")}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="dup" data-id="${p.id}">${t("common.duplicate")}</button>
      <button type="button" class="btn btn-danger btn-sm" data-act="del" data-id="${p.id}">${t("common.delete")}</button>
    </div>` : "";
  const chips = [
    `<span class="prod-chip">${t("products.byUnit")} ${escapeHtml(p.unidade)}</span>`,
    subs ? `<span class="prod-chip">${subs} ${subs > 1 ? t("products.subitemPlural") : t("products.subitemSingular")}</span>` : "",
    p.qtdFixa ? `<span class="prod-chip">${t("products.fixedQtyTag")}</span>` : "",
    p.ativo ? "" : `<span class="prod-chip prod-chip-off">${t("products.hiddenTag")}</span>`,
  ].join("");
  return `
    <div class="prod-card${p.ativo ? "" : " off"}">
      <div class="prod-card-top">
        <div class="nm">${escapeHtml(p.nome)}</div>
        <div class="pr">${currency(p.preco)}</div>
      </div>
      ${p.detalhe ? `<p class="prod-desc">${escapeHtml(p.detalhe)}</p>` : ""}
      <div class="prod-chips">${chips}</div>
      ${actions}
    </div>`;
}

/* ---- navegação por caixas: resolve em qual nível da árvore estamos (compartilhado entre Produtos e Cotação) ---- */
function catalogNodeAtPath(tree, path) {
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

function renderCatalogBreadcrumb(navPath, rootLabel) {
  const items = [{ label: rootLabel, idx: -1 }, ...navPath.map((name, i) => ({ label: name, idx: i }))];
  return `<div class="cat-breadcrumb">${items.map((it, i) => {
    const isLast = i === items.length - 1;
    return `${i > 0 ? '<span class="cat-crumb-sep">›</span>' : ""}<button type="button" class="cat-crumb${isLast ? " active" : ""}" data-idx="${it.idx}">${escapeHtml(it.label)}</button>`;
  }).join("")}</div>`;
}

const CATALOG_BOX_ICON_RENAME = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const CATALOG_BOX_ICON_DELETE = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;

/* ---- grade de caixas clicáveis de um nível da árvore (compartilhado entre Produtos e Cotação) ---- */
function catalogBoxGridHtml(boxes, kind, itemWord, levelIndex, isAdmin) {
  const boxColor = CATALOG_KIND_COLORS[kind] || "#3167A1";
  return `<div class="cat-box-grid">${boxes.map(node => {
    const count = catalogCountItems(node, kind);
    return `
      <div class="cat-box-wrap">
        <button type="button" class="cat-box" data-nav="${escapeHtml(node.nome)}" style="--box-color:${boxColor}">
          <span class="cat-box-icon">${CATALOG_ICONS[kind]}</span>
          <span class="cat-box-name">${escapeHtml(node.nome)}</span>
          <span class="cat-box-count">${count} ${count === 1 ? itemWord : itemWord + "s"}</span>
          <span class="cat-box-arrow" aria-hidden="true">›</span>
        </button>
        ${isAdmin ? `
          <div class="cat-box-admin-acts">
            <button type="button" class="btn-icon cat-box-rename" data-level="${levelIndex}" data-name="${escapeHtml(node.nome)}" title="${t("products.renameBox")}">${CATALOG_BOX_ICON_RENAME}</button>
            <button type="button" class="btn-icon cat-box-delete" data-level="${levelIndex}" data-name="${escapeHtml(node.nome)}" title="${t("products.deleteBox")}">${CATALOG_BOX_ICON_DELETE}</button>
          </div>` : ""}
      </div>`;
  }).join("")}</div>`;
}

/* nível 0=categoria, 1=destino, 2=escola/subgrupo, 3=turno — mesma
   lógica de fallback usada em buildCatalogTree, pra bater exatamente
   com o agrupamento mostrado nas caixas */
const CATALOG_LEVEL_FIELDS = ["categoria", "destino", "subgrupo", "turno"];
function catalogLevelValue(p, levelIndex) {
  if (levelIndex === 0) return p.categoria || "Outros";
  if (levelIndex === 1) return p.destino || "Todos";
  if (levelIndex === 2) return p.subgrupo || "";
  return p.turno || "";
}
function catalogItemsInBox(navPath, levelIndex, boxName) {
  return catalog.filter(p => {
    for (let i = 0; i < levelIndex; i++) {
      if (catalogLevelValue(p, i) !== navPath[i]) return false;
    }
    return catalogLevelValue(p, levelIndex) === boxName;
  });
}
async function bulkSaveCatalogItemsRemote(items) {
  if (!items.length) return;
  const { error } = await supabase.from("catalog_items").upsert(items.map(catalogToDb));
  if (error) console.error("Erro ao salvar produtos em massa:", error);
}
async function bulkDeleteCatalogItemsRemote(ids) {
  if (!ids.length) return;
  const { error } = await supabase.from("catalog_items").delete().in("id", ids);
  if (error) console.error("Erro ao excluir produtos em massa:", error);
}
async function renameCatalogBox(navPath, levelIndex, oldName, newName) {
  const field = CATALOG_LEVEL_FIELDS[levelIndex];
  const affected = catalogItemsInBox(navPath, levelIndex, oldName);
  if (!affected.length) return;
  affected.forEach(p => { p[field] = newName; });
  await bulkSaveCatalogItemsRemote(affected);
  await followCatalogBoxRenameInSchools(navPath, levelIndex, oldName, newName);
}
/* renomear categoria/destino/escola em Produtos também renomeia a escola
   ligada a ela (mesma chave categoria + destino + nome), pra não soltar o vínculo */
async function followCatalogBoxRenameInSchools(navPath, levelIndex, oldName, newName) {
  if (levelIndex > 2) return;
  const touched = schools.filter(sc => {
    if (levelIndex === 0) return sc.categoria === oldName;
    if (levelIndex === 1) return sc.categoria === navPath[0] && sc.destino === oldName;
    return sc.categoria === navPath[0] && sc.destino === navPath[1] && sc.nome === oldName;
  });
  for (const sc of touched) {
    if (levelIndex === 0) sc.categoria = newName;
    else if (levelIndex === 1) sc.destino = newName;
    else sc.nome = newName;
    await saveSchoolRemote(sc);
  }
}
async function deleteCatalogBoxCascade(navPath, levelIndex, boxName) {
  const affected = catalogItemsInBox(navPath, levelIndex, boxName);
  const ids = affected.map(p => p.id);
  catalog = catalog.filter(p => !ids.includes(p.id));
  await bulkDeleteCatalogItemsRemote(ids);
}

/* renomear/excluir uma caixa (categoria/destino/escola/turno) — ações
   compartilhadas entre a grade de Produtos e a de Cotação, só ADM */
async function promptRenameCatalogBox(navPath, levelIndex, oldName) {
  const newName = prompt(t("products.renameBoxPrompt"), oldName);
  if (newName === null) return false;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return false;
  if (catalogItemsInBox(navPath, levelIndex, trimmed).length > 0) {
    alert(t("products.renameBoxDuplicate"));
    return false;
  }
  await renameCatalogBox(navPath, levelIndex, oldName, trimmed);
  return true;
}
async function confirmDeleteCatalogBox(navPath, levelIndex, name) {
  const count = catalogItemsInBox(navPath, levelIndex, name).length;
  const msg = count > 0
    ? `${t("products.confirmDeleteBox1")} "${name}"? ${count} ${t("products.confirmDeleteBox2")}`
    : `${t("products.confirmDeleteBox1")} "${name}"?`;
  if (!confirm(msg)) return false;
  await deleteCatalogBoxCascade(navPath, levelIndex, name);
  return true;
}
async function handleCatalogBoxAction(e, navPath) {
  if (!(session && session.role === "ADM")) return false;
  const renameBtn = e.target.closest(".cat-box-rename");
  const delBtn = e.target.closest(".cat-box-delete");
  if (!renameBtn && !delBtn) return false;
  const btn = renameBtn || delBtn;
  const levelIndex = parseInt(btn.dataset.level, 10);
  const name = btn.dataset.name;
  const changed = renameBtn
    ? await promptRenameCatalogBox(navPath, levelIndex, name)
    : await confirmDeleteCatalogBox(navPath, levelIndex, name);
  if (changed) { quoteMontaDestinos(); quoteMontaCatalogo(); }
  return true;
}

function renderCatalogList() {
  const isAdmin = !!(session && session.role === "ADM");
  document.getElementById("btn-new-catalog-item").style.display = isAdmin ? "" : "none";
  renderProductsDashboard();

  if (catalog.length === 0) {
    catalogListEl.innerHTML = `<div class="prod-empty"><div class="prod-empty-icon">${CATALOG_ICONS.categoria}</div><p>${t("products.emptyCatalog1")} "${t("products.new")}" ${t("products.emptyCatalog2")}</p></div>`;
    return;
  }

  const tree = buildCatalogTree(catalog.slice().sort((a, b) => a.ordem - b.ordem));
  const view = catalogNodeAtPath(tree, catalogNavPath);
  if (view.invalid) { catalogNavPath = []; renderCatalogList(); return; }

  let html = renderCatalogBreadcrumb(catalogNavPath, t("common.catalogRoot"));

  if (view.kind === "itens") {
    const itens = view.itens.slice().sort((a, b) => a.ordem - b.ordem);
    html += `<div class="cat-items-grid">${itens.map(p => adminItemCardHtml(p, isAdmin)).join("")}</div>`;
  } else {
    let looseHtml = "";
    if (view.looseItens && view.looseItens.length) {
      const itens = view.looseItens.slice().sort((a, b) => a.ordem - b.ordem);
      looseHtml = `<div class="cat-items-grid">${itens.map(p => adminItemCardHtml(p, isAdmin)).join("")}</div>`;
    }

    if (!view.boxes.length && !looseHtml) {
      html += `<div class="prod-empty"><div class="prod-empty-icon">${CATALOG_ICONS.escola}</div><p>${t("products.emptyItemsHere")}</p></div>`;
    } else {
      if (view.boxes.length) html += catalogBoxGridHtml(view.boxes, view.kind, t("products.itemWord"), catalogNavPath.length, isAdmin);
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
  if (await handleCatalogBoxAction(e, catalogNavPath)) { renderCatalogList(); return; }
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
  if (btn.dataset.act === "dup") {
    const copy = {
      ...p, id: uid(), nome: `${p.nome} (${t("common.copy")})`,
      ordem: catalog.reduce((m, x) => Math.max(m, x.ordem || 0), 0) + 1,
      subs: JSON.parse(JSON.stringify(p.subs || [])),
    };
    catalog.push(copy);
    renderCatalogList();
    quoteMontaDestinos();
    quoteMontaCatalogo();
    await saveCatalogItem(copy);
    openProductModal(copy.id);
  }
  if (btn.dataset.act === "del") {
    if (!confirm(`${t("products.confirmDelete1")} "${p.nome}" ${t("products.confirmDelete2")}`)) return;
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
      <button type="button" class="btn btn-icon" data-act="delsub" title="${t("products.removeSubitem")}">&times;</button>
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

/* "Escola" no cadastro de produto: escolher uma escola liga o produto pelo
   código dela e preenche (e trava) categoria, destino e nome da escola */
function renderProductSchoolOptions(selectedCode) {
  const sel = document.getElementById("product-field-escola");
  sel.innerHTML = `<option value="">${escapeHtml(t("products.schoolNone"))}</option>` +
    schools.slice().sort((a, b) => a.destino.localeCompare(b.destino) || a.nome.localeCompare(b.nome))
      .map(sc => `<option value="${escapeHtml(sc.codigo)}">${escapeHtml(sc.nome)} — ${escapeHtml(sc.destino)}</option>`).join("");
  sel.value = selectedCode || "";
  applyProductSchoolLock();
}
function applyProductSchoolLock() {
  const sc = schools.find(x => x.codigo === document.getElementById("product-field-escola").value);
  const set = (id, v) => { const el = document.getElementById(id); if (sc) el.value = v; el.readOnly = !!sc; };
  set("product-field-categoria", sc ? sc.categoria : "");
  set("product-field-destino", sc ? sc.destino : "");
  set("product-field-subgrupo", sc ? sc.nome : "");
}
document.getElementById("product-field-escola").addEventListener("change", applyProductSchoolLock);

function openProductModal(id) {
  productForm.reset();
  populateCatalogDatalists();
  if (id) {
    const p = catalog.find(p => p.id === id);
    document.getElementById("product-modal-title").textContent = t("products.editTitle");
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
    const matched = p.escolaCodigo || (schools.find(sc => sc.categoria === (p.categoria || "Outros") && sc.destino === (p.destino || "Todos") && sc.nome === (p.subgrupo || "")) || {}).codigo;
    renderProductSchoolOptions(matched);
    productBtnDelete.style.display = "inline-block";
  } else {
    document.getElementById("product-modal-title").textContent = t("products.newTitle");
    document.getElementById("product-id").value = "";
    document.getElementById("product-field-ordem").value = 100;
    document.getElementById("product-field-qtdpadrao").value = 1;
    document.getElementById("product-field-qtdfixa").checked = true;
    document.getElementById("product-field-ativo").checked = true;
    renderProductSubs([]);
    renderProductSchoolOptions("");
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
    escolaCodigo: document.getElementById("product-field-escola").value,
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
  if (!id || !confirm(t("products.confirmDeleteSimple"))) return;
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

const quoteCatalogEl = document.getElementById("quote-catalog");

/* catálogo em lista expansível, igual ao Cotações Peregrinos: categoria › destino
   › escola (abre e fecha) › itens (agrupados por turno). Ao buscar, tudo abre. */
let quoteAbertos = {};   /* "categoria|destino|escola" -> aberto */

function quoteFaixa(itens) {
  const precos = itens.map(p => Number(p.preco) || 0);
  const min = Math.min(...precos), max = Math.max(...precos);
  const n = `${itens.length} ${itens.length > 1 ? t("quotes.cmpOptions") : t("quotes.cmpOption")}`;
  return `${n} · ${min === max ? currency(min) : `${currency(min)}–${currency(max)}`}`;
}

function quoteTurnosHtml(escola) {
  return escola.turnos.map(tn => `
    ${tn.nome ? `<div class="qc-turno-h">${escapeHtml(tn.nome)}</div>` : ""}
    ${tn.itens.slice().sort((a, b) => a.ordem - b.ordem).map(quoteItemHtml).join("")}`).join("");
}

function quoteMontaCatalogo() {
  const filtro = document.getElementById("q-destino").value;
  const termo = (document.getElementById("q-busca").value || "").trim().toLowerCase();
  const lista = quoteAtivos().filter(p => {
    if (!quoteVisivel(p, filtro)) return false;
    if (!termo) return true;
    const alvo = [p.nome, p.detalhe, p.subgrupo, p.turno, p.categoria, p.destino].join(" ").toLowerCase();
    return alvo.includes(termo);
  });

  if (lista.length === 0) {
    quoteCatalogEl.innerHTML = `<p class="muted-note">${termo ? `${t("quotes.noServiceFound1")} "${escapeHtml(termo)}".` : t("quotes.noServiceForDestination")}</p>`;
    quoteAtualizaPrevia();
    return;
  }

  let html = "";
  buildCatalogTree(lista.slice().sort((a, b) => a.ordem - b.ordem)).forEach(c => {
    html += `<div class="qc-cat"><h3 class="qc-cat-h">${escapeHtml(c.nome)}</h3>`;
    c.destinos.forEach(d => {
      html += `<div class="qc-grp"><h4 class="qc-grp-h">${escapeHtml(d.nome)}</h4>`;
      d.escolas.forEach(e => {
        const itens = e.turnos.flatMap(tn => tn.itens);
        if (!e.nome) { html += `<div class="qc-sub-flat">${quoteTurnosHtml(e)}</div>`; return; }
        const chave = [c.nome, d.nome, e.nome].join("|");
        const marcados = itens.filter(p => Object.prototype.hasOwnProperty.call(quoteSelecionados, p.id)).length;
        const aberto = !!termo || marcados > 0 || quoteAbertos[chave] === true;
        html += `
          <div class="qc-sub" data-chave="${escapeHtml(chave)}">
            <button type="button" class="qc-sub-h" data-role="toggle" aria-expanded="${aberto}">
              <span class="qc-arrow">▶</span>
              <span>${escapeHtml(e.nome)}${marcados ? `<span class="qc-picked">${marcados} ${t("quotes.inQuote")}</span>` : ""}</span>
              <span class="qc-count">${quoteFaixa(itens)}</span>
            </button>
            <div class="qc-sub-body"${aberto ? "" : " hidden"}>${quoteTurnosHtml(e)}</div>
          </div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
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
  const toggle = e.target.closest('button[data-role="toggle"]');
  if (toggle) {
    const caixa = toggle.closest(".qc-sub");
    const corpo = caixa.querySelector(".qc-sub-body");
    const abrir = corpo.hidden;
    corpo.hidden = !abrir;
    toggle.setAttribute("aria-expanded", String(abrir));
    quoteAbertos[caixa.dataset.chave] = abrir;
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
  if (!confirm(t("quotes.confirmClear"))) return;
  ["q-nome", "q-email", "q-obs", "q-busca"].forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("q-status").value = "Enviada";
  document.getElementById("q-lead-id").value = "";
  quoteLeadSearch.value = "";
  quoteSelecionados = {};
  quoteAbertos = {};
  document.querySelectorAll(".quote-form-body .err").forEach(el => el.classList.remove("err"));
  quoteMontaCatalogo();
  document.getElementById("q-nome").focus();
});

function quoteValida() {
  const campos = [
    { el: document.getElementById("q-nome"), nome: t("quotes.fieldStudentName") },
    { el: document.getElementById("q-email"), nome: t("quotes.fieldStudentEmail") },
    { el: document.getElementById("q-consultor"), nome: t("quotes.fieldConsultorName") },
    { el: document.getElementById("q-consultor-email"), nome: t("quotes.fieldConsultorEmail") },
  ];
  const faltando = [];
  campos.forEach(c => {
    const vazio = !c.el.value.trim();
    c.el.classList.toggle("err", vazio);
    if (vazio) faltando.push(c.nome);
  });
  if (faltando.length) {
    alert(t("quotes.fillPrefix") + " " + faltando.join(", ") + " " + t("quotes.fillSuffix"));
    campos.find(c => !c.el.value.trim()).el.focus();
    return false;
  }
  if (quoteLinhas().length === 0) {
    alert(t("quotes.selectAtLeastOneService"));
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
    alert(t("quotes.fillStudentNameToSave"));
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
  document.getElementById("q-btn-gerar-contrato").style.display = "";
  document.getElementById("quote-builder-title").textContent = t("quotes.editTitle");
  btn.textContent = t("quotes.saved");
  setTimeout(() => { btn.textContent = textoOriginal; btn.disabled = false; }, 1500);
}

document.getElementById("q-btn-salvar").addEventListener("click", quoteSalvar);

document.getElementById("q-btn-gerar-contrato").addEventListener("click", () => {
  const quoteId = document.getElementById("q-id").value;
  const quote = quotes.find(q => q.id === quoteId);
  if (!quote) { alert(t("quotes.saveFirst")); return; }
  const existingContract = contracts.find(c => c.quoteId === quote.id);
  if (existingContract) {
    switchView("contratos");
    openContractModal(existingContract.id);
    return;
  }
  if (quote.status !== "Aprovada") { alert(t("quotes.needApprovedForContract")); return; }
  if (!quote.leadId) { alert(t("quotes.needLeadForContract")); return; }
  switchView("contratos");
  openContractModal(null, quote);
});

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
  document.getElementById("d-titulo").textContent = t("quotes.quoteFor") + " " + nome;
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
let influencerCommissions = [];
let adSpend = [];
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

/* ---- comissão de influencer (mesmo padrão de commissions, mas por
   origem em vez de consultor — origem não é um usuário do sistema) ---- */
function influencerCommissionFromDb(r) {
  return {
    id: r.id, dealId: r.deal_id, enrollmentId: r.enrollment_id || null, source: r.source || "",
    dealName: r.deal_name || "", dealValue: Number(r.deal_value) || 0,
    percentage: Number(r.percentage) || 0, amount: Number(r.amount) || 0,
    status: r.status, paidAt: r.paid_at ? new Date(r.paid_at).getTime() : null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function influencerCommissionToDb(c) {
  return {
    id: c.id, deal_id: c.dealId || null, enrollment_id: c.enrollmentId || null, source: c.source,
    deal_name: c.dealName, deal_value: c.dealValue,
    percentage: c.percentage, amount: c.amount, status: c.status,
    paid_at: c.paidAt ? new Date(c.paidAt).toISOString() : null,
    created_at: new Date(c.createdAt).toISOString(),
  };
}
async function loadInfluencerCommissions() {
  const { data, error } = await supabase.from("influencer_commissions").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar comissões de influencer:", error); return []; }
  return data.map(influencerCommissionFromDb);
}
async function saveInfluencerCommission(c) {
  const { error } = await supabase.from("influencer_commissions").upsert(influencerCommissionToDb(c));
  if (error) console.error("Erro ao salvar comissão de influencer:", error);
}

/* ---- tráfego pago ---- */
function adSpendFromDb(r) {
  return {
    id: r.id, channel: r.channel || "Outro", amount: Number(r.amount) || 0,
    spendDate: r.spend_date, notes: r.notes || "",
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}
function adSpendToDb(a) {
  return {
    id: a.id, channel: a.channel, amount: a.amount,
    spend_date: a.spendDate, notes: a.notes,
    created_at: new Date(a.createdAt).toISOString(),
  };
}
async function loadAdSpend() {
  const { data, error } = await supabase.from("ad_spend").select("*").order("spend_date", { ascending: false });
  if (error) { console.error("Erro ao carregar tráfego pago:", error); return []; }
  return data.map(adSpendFromDb);
}
async function saveAdSpendRemote(a) {
  const { error } = await supabase.from("ad_spend").upsert(adSpendToDb(a));
  if (error) console.error("Erro ao salvar tráfego pago:", error);
}
async function deleteAdSpendRemote(id) {
  const { error } = await supabase.from("ad_spend").delete().eq("id", id);
  if (error) console.error("Erro ao excluir tráfego pago:", error);
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

/* classifica o turno (texto livre da Matrícula, ex: "AM · Segunda a
   Quinta", "PM · Dublin") em manhã/tarde, pra comissão de influencer
   fixa por turno — não distingue escola/destino de propósito */
function classifyTurnoShift(turno) {
  const norm = normalizeImportStr(turno || "");
  if (norm.startsWith("am") || norm.includes("manha")) return "am";
  if (norm.startsWith("pm") || norm.includes("tarde")) return "pm";
  return null;
}

/* ---- ao salvar uma matrícula: gera comissão fixa de influencer por
   turno, se a origem do lead usar esse modo — não mexe se já existe
   comissão paga pra essa matrícula ---- */
async function handleEnrollmentInfluencerCommission(enr) {
  if (!enr.leadId) return;
  const lead = leads.find(l => l.id === enr.leadId);
  if (!lead || !lead.source) return;
  const cfg = sourceInfluencerConfig[lead.source];
  if (!cfg || !cfg.isInfluencer || cfg.mode !== "fixed_turno") return;

  const shift = classifyTurnoShift(enr.turno);
  if (!shift) return;
  const amount = shift === "am" ? cfg.fixedAm : cfg.fixedPm;
  if (!(amount > 0)) return;

  const existing = influencerCommissions.find(c => c.enrollmentId === enr.id);
  if (existing) {
    if (existing.status === "Pago") return;
    if (existing.amount === amount) return;
    existing.amount = amount;
    existing.dealName = enr.name;
    renderInfluencerCommissions();
    await saveInfluencerCommission(existing);
    return;
  }

  const deal = deals.find(d => d.leadId === enr.leadId);
  const commission = {
    id: uid(), dealId: deal ? deal.id : null, enrollmentId: enr.id, source: lead.source,
    dealName: enr.name, dealValue: enr.courseValue,
    percentage: 0, amount,
    status: "Pendente", paidAt: null, createdAt: Date.now(),
  };
  influencerCommissions.push(commission);
  renderInfluencerCommissions();
  await saveInfluencerCommission(commission);
}

/* ---- ao marcar um negócio como Ganho: gera comissão e pede as parcelas ---- */
async function handleDealWon(deal) {
  if (!isWonStage(deal.stage)) return;

  const lead = deal.leadId ? leads.find(l => l.id === deal.leadId) : null;

  if (!commissions.some(c => c.dealId === deal.id)) {
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

  if (lead && lead.source && !influencerCommissions.some(c => c.dealId === deal.id && !c.enrollmentId)) {
    const cfg = sourceInfluencerConfig[lead.source];
    if (cfg && cfg.isInfluencer && cfg.mode !== "fixed_turno" && cfg.commissionPct > 0) {
      const influencerCommission = {
        id: uid(), dealId: deal.id, source: lead.source,
        dealName: deal.name, dealValue: deal.value,
        percentage: cfg.commissionPct, amount: round2(deal.value * cfg.commissionPct / 100),
        status: "Pendente", paidAt: null, createdAt: Date.now(),
      };
      influencerCommissions.push(influencerCommission);
      renderInfluencerCommissions();
      await saveInfluencerCommission(influencerCommission);
    }
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
      document.getElementById("subview-fin-schoolcommissions").classList.toggle("active", target === "schoolcommissions");
      document.getElementById("subview-fin-adspend").classList.toggle("active", target === "adspend");
      document.getElementById("subview-fin-metrics").classList.toggle("active", target === "metrics");
      if (target === "metrics") renderMetrics();
    });
  });
}

/* ---- Visão Geral ---- */
let finOverviewSelectedIds = new Set();

function dealStatusLabel(d) {
  if (isWonStage(d.stage)) return t("status.ganho");
  if (isLostStage(d.stage)) return t("status.perdido");
  const stage = stageById(d.stage);
  return stage ? stageLabel(stage.label) : d.stage;
}

function getFilteredOverviewDeals() {
  const q = (document.getElementById("fin-overview-search-input").value || "").trim().toLowerCase();
  let list = deals.filter(d => isWonStage(d.stage));
  if (q) {
    list = list.filter(d => {
      const lead = d.leadId ? leads.find(l => l.id === d.leadId) : null;
      const haystack = [d.name, lead ? lead.source : "", lead ? lead.email : "", dealStatusLabel(d)].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }
  return list.slice().sort((a, b) => (b.closedAt || b.createdAt || 0) - (a.closedAt || a.createdAt || 0));
}

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

  const list = getFilteredOverviewDeals();
  const tbody = document.getElementById("fin-overview-tbody");
  tbody.innerHTML = "";
  document.getElementById("fin-overview-empty").style.display = list.length === 0 ? "block" : "none";
  list.forEach(d => {
    const lead = d.leadId ? leads.find(l => l.id === d.leadId) : null;
    const won = isWonStage(d.stage);
    const lost = isLostStage(d.stage);
    const badgeClass = won ? "badge-good" : lost ? "badge-danger" : "badge-neutral";
    const dateVal = d.closedAt || d.createdAt;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-check"><input type="checkbox" class="fin-overview-checkbox" data-id="${d.id}" ${finOverviewSelectedIds.has(d.id) ? "checked" : ""}></td>
      <td class="cell-primary">${escapeHtml(d.name)}</td>
      <td class="cell-muted">${lead ? escapeHtml(lead.source || "—") : "—"}</td>
      <td class="cell-muted">${lead ? escapeHtml(lead.email || "—") : "—"}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(dealStatusLabel(d))}</span></td>
      <td>${currency(d.value)}</td>
      <td class="cell-muted">${dateVal ? new Date(dateVal).toLocaleDateString("pt-BR") : "—"}</td>
    `;
    const checkbox = tr.querySelector(".fin-overview-checkbox");
    checkbox.addEventListener("click", e => e.stopPropagation());
    checkbox.addEventListener("change", e => {
      if (e.target.checked) finOverviewSelectedIds.add(d.id);
      else finOverviewSelectedIds.delete(d.id);
      updateFinOverviewSelectAllState(list);
      updateFinOverviewBulkBar();
    });
    tr.addEventListener("click", () => openDealModal(d.id));
    tbody.appendChild(tr);
  });
  updateFinOverviewSelectAllState(list);
  updateFinOverviewBulkBar();
}

function updateFinOverviewSelectAllState(list) {
  const cb = document.getElementById("fin-overview-select-all");
  if (!list.length) { cb.checked = false; cb.indeterminate = false; return; }
  const selectedCount = list.filter(d => finOverviewSelectedIds.has(d.id)).length;
  cb.checked = selectedCount === list.length;
  cb.indeterminate = selectedCount > 0 && selectedCount < list.length;
}
function updateFinOverviewBulkBar() {
  const bar = document.getElementById("fin-overview-bulk-bar");
  const count = finOverviewSelectedIds.size;
  document.getElementById("fin-overview-bulk-count").textContent = `${count} ${t("common.selectedCount")}`;
  bar.style.display = count > 0 ? "flex" : "none";
}

document.getElementById("fin-overview-search-input").addEventListener("input", renderFinanceiroOverview);
document.getElementById("fin-overview-search-clear").addEventListener("click", () => {
  document.getElementById("fin-overview-search-input").value = "";
  renderFinanceiroOverview();
});
document.getElementById("fin-overview-select-all").addEventListener("change", e => {
  const list = getFilteredOverviewDeals();
  if (e.target.checked) list.forEach(d => finOverviewSelectedIds.add(d.id));
  else list.forEach(d => finOverviewSelectedIds.delete(d.id));
  renderFinanceiroOverview();
});
document.getElementById("fin-overview-bulk-clear").addEventListener("click", () => {
  finOverviewSelectedIds = new Set();
  renderFinanceiroOverview();
});
document.getElementById("fin-overview-bulk-delete").addEventListener("click", async () => {
  const ids = Array.from(finOverviewSelectedIds);
  if (!ids.length) return;
  if (!confirm(`${t("fin.confirmBulkDeleteDeals1")} ${ids.length} ${t("fin.confirmBulkDeleteDeals2")}`)) return;
  deals = deals.filter(d => !ids.includes(d.id));
  commissions = commissions.filter(c => !ids.includes(c.dealId));
  influencerCommissions = influencerCommissions.filter(c => !ids.includes(c.dealId));
  receivables = receivables.filter(r => !ids.includes(r.dealId));
  finOverviewSelectedIds = new Set();
  renderFinanceiroOverview();
  renderBoard();
  renderCommissions();
  renderInfluencerCommissions();
  renderReceivables();
  await Promise.all(ids.map(id => deleteDealRemote(id)));
});

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
      <td><span class="badge ${r.paid ? "badge-good" : "badge-warn"}">${r.paid ? t("status.pago") : t("status.pendente")}</span></td>
      <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="toggle-paid" data-id="${r.id}">${r.paid ? t("fin.markPending") : t("fin.markPaid")}</button></td>
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
    `<option value="">${t("leads.categoryAll")}</option>` + EXPENSE_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
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
      <td><span class="badge ${e.paid ? "badge-good" : "badge-warn"}">${e.paid ? t("status.pago") : t("status.pendente")}</span></td>
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
    document.getElementById("expense-modal-title").textContent = t("fin.editExpenseTitle");
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
    document.getElementById("expense-modal-title").textContent = t("fin.newExpenseTitle");
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
  if (!confirm(t("fin.confirmDeleteExpense"))) return;
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
      <span class="source-usage">${expenseCategoryUsageCount(c)} ${t("fin.expenseCount")}</span>
      <button type="button" class="btn btn-icon" data-act="del" data-index="${i}" title="${t("fin.deleteCategory")}">&times;</button>
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
  if (duplicate) { alert(t("fin.duplicateCategoryName")); input.value = oldName; return; }
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
  if (EXPENSE_CATEGORIES.length === 1) { alert(t("fin.keepAtLeastOneCategory")); return; }
  const count = expenseCategoryUsageCount(name);
  const msg = count > 0
    ? `${t("fin.confirmDeleteCategory1")} "${name}"? ${count} ${t("fin.confirmDeleteCategory2")} "${name}" ${t("fin.confirmDeleteCategory3")}`
    : `${t("fin.confirmDeleteCategory1")} "${name}"?`;
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
  if (duplicate) { alert(t("fin.duplicateCategoryName")); return; }
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
      <td><span class="badge ${c.status === "Pago" ? "badge-good" : "badge-warn"}">${escapeHtml(statusLabel(c.status))}</span></td>
      <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="toggle-status" data-id="${c.id}">${c.status === "Pago" ? t("fin.markPending") : t("fin.markPaid")}</button></td>
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
  alert(t("fin.commissionUpdated"));
});

/* ---- comissões de influencer (mesmo padrão das comissões de consultor) ---- */
function renderInfluencerCommissions() {
  const list = influencerCommissions.slice().sort((a, b) => b.createdAt - a.createdAt);
  const tbody = document.getElementById("fin-influencer-commissions-tbody");
  tbody.innerHTML = "";
  document.getElementById("fin-influencer-commissions-empty").style.display = list.length === 0 ? "block" : "none";
  list.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(c.source)}</td>
      <td class="cell-muted">${escapeHtml(c.dealName)}</td>
      <td class="cell-muted">${currency(c.dealValue)}</td>
      <td class="cell-muted">${c.percentage}%</td>
      <td class="cell-primary">${currency(c.amount)}</td>
      <td><span class="badge ${c.status === "Pago" ? "badge-good" : "badge-warn"}">${escapeHtml(statusLabel(c.status))}</span></td>
      <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="toggle-status" data-id="${c.id}">${c.status === "Pago" ? t("fin.markPending") : t("fin.markPaid")}</button></td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById("fin-influencer-commissions-tbody").addEventListener("click", async e => {
  const btn = e.target.closest('button[data-act="toggle-status"]');
  if (!btn) return;
  const c = influencerCommissions.find(x => x.id === btn.dataset.id);
  if (!c) return;
  c.status = c.status === "Pago" ? "Pendente" : "Pago";
  c.paidAt = c.status === "Pago" ? Date.now() : null;
  renderInfluencerCommissions();
  await saveInfluencerCommission(c);
});

/* ---- comissão de escola (lançada dentro de cada Matrícula) ---- */
function getSchoolCommissionEnrollments() {
  const status = document.getElementById("fin-schoolcomm-filter-status").value;
  return enrollments.filter(e => {
    if (e.schoolCommissionAmount == null) return false;
    if (status && (e.schoolCommissionStatus || "Pendente") !== status) return false;
    return true;
  });
}
function renderSchoolCommissions() {
  const list = getSchoolCommissionEnrollments().slice().sort((a, b) => b.createdAt - a.createdAt);
  const tbody = document.getElementById("fin-schoolcomm-tbody");
  tbody.innerHTML = "";
  document.getElementById("fin-schoolcomm-empty").style.display = list.length === 0 ? "block" : "none";
  list.forEach(e => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(e.name || "—")}</td>
      <td class="cell-muted">${escapeHtml(e.school || "—")}</td>
      <td class="cell-primary">${currency(e.schoolCommissionAmount)}</td>
      <td class="cell-muted">${e.schoolCommissionExpected ? formatDate(e.schoolCommissionExpected) : "—"}</td>
      <td><span class="badge ${e.schoolCommissionStatus === "Recebido" ? "badge-good" : "badge-warn"}">${e.schoolCommissionStatus === "Recebido" ? t("fin.received") : t("status.pendente")}</span></td>
      <td class="cell-actions">›</td>
    `;
    tr.addEventListener("click", () => openEnrollmentModal(e.id));
    tbody.appendChild(tr);
  });
}
document.getElementById("fin-schoolcomm-filter-status").addEventListener("change", renderSchoolCommissions);
document.getElementById("fin-schoolcomm-filter-clear").addEventListener("click", () => {
  document.getElementById("fin-schoolcomm-filter-status").value = "";
  renderSchoolCommissions();
});

/* ---- tráfego pago ---- */
function renderAdSpend() {
  const list = adSpend.slice().sort((a, b) => new Date(b.spendDate) - new Date(a.spendDate));
  const tbody = document.getElementById("fin-adspend-tbody");
  tbody.innerHTML = "";
  document.getElementById("fin-adspend-empty").style.display = list.length === 0 ? "block" : "none";
  list.forEach(a => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-primary">${escapeHtml(a.channel)}</td>
      <td class="cell-primary">${currency(a.amount)}</td>
      <td class="cell-muted">${formatDate(a.spendDate)}</td>
      <td class="cell-muted">${escapeHtml(a.notes || "—")}</td>
      <td class="cell-actions">›</td>
    `;
    tr.addEventListener("click", () => openAdSpendModal(a.id));
    tbody.appendChild(tr);
  });
}

const adSpendModalBackdrop = document.getElementById("adspend-modal-backdrop");
const adSpendForm = document.getElementById("adspend-form");
const adSpendBtnDelete = document.getElementById("adspend-btn-delete");

function openAdSpendModal(id) {
  adSpendForm.reset();
  if (id) {
    const a = adSpend.find(x => x.id === id);
    if (!a) return;
    document.getElementById("adspend-modal-title").textContent = a.channel;
    document.getElementById("adspend-id").value = a.id;
    document.getElementById("adspend-field-channel").value = a.channel;
    document.getElementById("adspend-field-amount").value = a.amount;
    document.getElementById("adspend-field-date").value = a.spendDate;
    document.getElementById("adspend-field-notes").value = a.notes || "";
    adSpendBtnDelete.style.display = "inline-block";
  } else {
    document.getElementById("adspend-modal-title").textContent = t("fin.newAdSpendTitle");
    document.getElementById("adspend-id").value = "";
    document.getElementById("adspend-field-date").value = new Date().toISOString().slice(0, 10);
    adSpendBtnDelete.style.display = "none";
  }
  adSpendModalBackdrop.classList.add("open");
}
function closeAdSpendModal() { adSpendModalBackdrop.classList.remove("open"); }

document.getElementById("btn-new-adspend").addEventListener("click", () => openAdSpendModal(null));
document.getElementById("adspend-modal-close").addEventListener("click", closeAdSpendModal);
document.getElementById("adspend-btn-cancel").addEventListener("click", closeAdSpendModal);
adSpendModalBackdrop.addEventListener("click", e => { if (e.target === adSpendModalBackdrop) closeAdSpendModal(); });

adSpendForm.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("adspend-id").value;
  const data = {
    id: id || uid(),
    channel: document.getElementById("adspend-field-channel").value,
    amount: parseFloat(document.getElementById("adspend-field-amount").value) || 0,
    spendDate: document.getElementById("adspend-field-date").value,
    notes: document.getElementById("adspend-field-notes").value.trim(),
    createdAt: id ? (adSpend.find(x => x.id === id) || {}).createdAt || Date.now() : Date.now(),
  };
  if (id) {
    Object.assign(adSpend.find(x => x.id === id), data);
  } else {
    adSpend.push(data);
  }
  renderAdSpend();
  closeAdSpendModal();
  await saveAdSpendRemote(data);
});

adSpendBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("adspend-id").value;
  if (!id || !confirm(t("fin.confirmDeleteAdSpend"))) return;
  adSpend = adSpend.filter(x => x.id !== id);
  renderAdSpend();
  closeAdSpendModal();
  await deleteAdSpendRemote(id);
});

/* ---- métricas: CAC, LTV e LTV:CAC ----
   CAC (período) = (tráfego pago + comissão de influencer + comissão de
   consultor, tudo no período) ÷ nº de negócios Ganhos no período.
   LTV (por cliente raiz) = soma da receita de todas as vendas ligadas a
   uma "árvore" de indicação (o cliente + quem ele indicou, recursivamente)
   menos a comissão de consultor dessas vendas — dividido pelo nº de
   clientes raiz, dando a média. */
function findRootLeadId(leadId, guard) {
  guard = guard || new Set();
  if (guard.has(leadId)) return leadId;
  guard.add(leadId);
  const lead = leads.find(l => l.id === leadId);
  if (!lead || !lead.referredByLeadId) return leadId;
  return findRootLeadId(lead.referredByLeadId, guard);
}

function renderMetrics() {
  const fromVal = document.getElementById("metrics-filter-from").value;
  const toVal = document.getElementById("metrics-filter-to").value;
  const fromTs = fromVal ? new Date(`${fromVal}T00:00:00`).getTime() : -Infinity;
  const toTs = toVal ? new Date(`${toVal}T23:59:59`).getTime() : Infinity;
  const inPeriod = ts => ts >= fromTs && ts <= toTs;

  const adSpendTotal = adSpend.filter(a => inPeriod(new Date(`${a.spendDate}T00:00:00`).getTime())).reduce((s, a) => s + a.amount, 0);
  const influencerTotal = influencerCommissions.filter(c => inPeriod(c.createdAt)).reduce((s, c) => s + c.amount, 0);
  const consultorTotal = commissions.filter(c => inPeriod(c.createdAt)).reduce((s, c) => s + c.amount, 0);
  const wonDeals = deals.filter(d => isWonStage(d.stage) && d.closedAt && inPeriod(d.closedAt));

  const cacCost = adSpendTotal + influencerTotal + consultorTotal;
  const cac = wonDeals.length > 0 ? cacCost / wonDeals.length : 0;

  /* agrupa os negócios ganhos do período por cliente raiz (própria
     árvore de indicação), somando receita e subtraindo a comissão de
     consultor de cada venda daquela árvore */
  const rootTotals = new Map();
  wonDeals.forEach(d => {
    if (!d.leadId) return;
    const rootId = findRootLeadId(d.leadId);
    const commission = commissions.find(c => c.dealId === d.id);
    const net = (Number(d.value) || 0) - (commission ? commission.amount : 0);
    rootTotals.set(rootId, (rootTotals.get(rootId) || 0) + net);
  });
  const ltvValues = Array.from(rootTotals.values());
  const ltv = ltvValues.length > 0 ? ltvValues.reduce((s, v) => s + v, 0) / ltvValues.length : 0;

  const ratio = cac > 0 ? ltv / cac : null;

  document.getElementById("metrics-stat-cac").textContent = currency(cac);
  document.getElementById("metrics-stat-ltv").textContent = currency(ltv);
  document.getElementById("metrics-stat-ratio").textContent = ratio == null ? "—" : `${ratio.toFixed(1)} : 1`;

  const rows = [
    [t("fin.tabAdSpend"), currency(adSpendTotal)],
    [t("fin.influencerCommissions"), currency(influencerTotal)],
    [t("fin.consultantCommissions"), currency(consultorTotal)],
    [t("fin.metricWonDeals"), String(wonDeals.length)],
    [t("fin.metricRootClients"), String(ltvValues.length)],
  ];
  document.getElementById("metrics-breakdown-tbody").innerHTML = rows.map(([label, value]) => `
    <tr><td class="cell-muted">${escapeHtml(label)}</td><td class="cell-primary">${escapeHtml(value)}</td></tr>
  `).join("");
}
document.getElementById("metrics-filter-from").addEventListener("change", renderMetrics);
document.getElementById("metrics-filter-to").addEventListener("change", renderMetrics);
document.getElementById("metrics-filter-clear").addEventListener("click", () => {
  document.getElementById("metrics-filter-from").value = "";
  document.getElementById("metrics-filter-to").value = "";
  renderMetrics();
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
    status: r.status, publicToken: r.public_token, studentUserId: r.student_user_id || null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    schoolCommissionAmount: r.school_commission_amount != null ? Number(r.school_commission_amount) : null,
    schoolCommissionStatus: r.school_commission_status || "Pendente",
    schoolCommissionExpected: r.school_commission_expected || null,
    schoolCommissionReceived: r.school_commission_received || null,
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
    status: e.status, student_user_id: e.studentUserId || null,
    school_commission_amount: e.schoolCommissionAmount != null && e.schoolCommissionAmount !== "" ? e.schoolCommissionAmount : null,
    school_commission_status: e.schoolCommissionStatus || "Pendente",
    school_commission_expected: e.schoolCommissionExpected || null,
    school_commission_received: e.schoolCommissionReceived || null,
  };
}

/* ---- acesso do aluno: cria login real (Supabase Auth) quando a matrícula
   tem e-mail e ainda não tem login vinculado. Usa um cliente isolado pra
   não trocar a sessão de quem está usando o CRM. ---- */
function generateStudentPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

async function provisionStudentAccess(enr) {
  if (!enr.email || enr.studentUserId) return null;
  const authClient = window.createIsolatedSupabaseClient();
  const password = generateStudentPassword();
  const { data, error } = await authClient.auth.signUp({
    email: enr.email,
    password,
    options: { data: { app_role: "aluno", name: enr.name || "" } },
  });
  if (error) {
    console.error("Erro ao criar acesso do aluno:", error);
    return { error: true };
  }
  if (!data.user || (data.user.identities && data.user.identities.length === 0)) {
    return { alreadyExists: true };
  }
  enr.studentUserId = data.user.id;
  await saveEnrollmentRemote(enr);
  return { password };
}

function buildAlunoLoginUrl() {
  return `${window.location.origin}${window.location.pathname.replace(/index\.html$/, "")}area-aluno-login.html`;
}

const studentAccessModalBackdrop = document.getElementById("student-access-modal-backdrop");
function openStudentAccessModal(enr, password) {
  document.getElementById("student-access-link").value = buildAlunoLoginUrl();
  document.getElementById("student-access-email").value = enr.email;
  document.getElementById("student-access-password").value = password;
  studentAccessModalBackdrop.classList.add("open");
}
function closeStudentAccessModal() { studentAccessModalBackdrop.classList.remove("open"); }
document.getElementById("student-access-modal-close").addEventListener("click", closeStudentAccessModal);
document.getElementById("student-access-btn-close").addEventListener("click", closeStudentAccessModal);
studentAccessModalBackdrop.addEventListener("click", e => { if (e.target === studentAccessModalBackdrop) closeStudentAccessModal(); });
document.getElementById("student-access-btn-copy").addEventListener("click", async e => {
  const text = `${t("studentAccess.copyAccess")} ${document.getElementById("student-access-link").value}\n${t("studentAccess.copyEmail")} ${document.getElementById("student-access-email").value}\n${t("studentAccess.copyPassword")} ${document.getElementById("student-access-password").value}`;
  const btn = e.currentTarget;
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = t("common.copied");
  } catch {
    prompt(t("common.copyDataPrompt"), text);
  }
  setTimeout(() => { btn.textContent = original; }, 1500);
});

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
    btnEl.textContent = t("common.copied");
  } catch {
    prompt(t("common.copyLinkPrompt"), url);
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
      <td><span class="badge ${ENROLLMENT_STATUS_BADGE[e.status] || "badge-neutral"}">${escapeHtml(statusLabel(e.status))}</span></td>
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
        <div class="sub">${escapeHtml(l.email || l.phone || t("enr.noContact"))}</div>
      </div>`).join("")
    : `<div class="enr-lead-result-empty">${t("enr.noLeadFound")}</div>`;
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

/* matrícula puxa escola/turno/valor da cotação assinada do lead — 1º
   item da cotação define escola/turno, valor é o total da cotação */
function enrollmentPrefillFromQuote(quote) {
  if (!quote) return { school: "", turno: "", courseValue: 0 };
  const firstItem = (quote.itemsDetail || [])[0];
  const product = firstItem ? catalog.find(p => p.id === firstItem.id) : null;
  return {
    school: product ? (product.subgrupo || "") : "",
    turno: product ? (product.turno || "") : "",
    courseValue: quote.value || 0,
  };
}

document.getElementById("enrollment-new-form").addEventListener("submit", async e => {
  e.preventDefault();
  const leadId = enrollmentNewLeadId.value || null;
  const lead = leadId ? leads.find(l => l.id === leadId) : null;
  const prefill = enrollmentPrefillFromQuote(findSignedQuoteForLead(leadId));
  const draft = {
    leadId, consultorId: (lead ? lead.consultorId : null) || (isOwnLeadsOnly() ? session.id : null),
    name: lead ? lead.name : "", email: lead ? lead.email : "", phone: lead ? lead.phone : "",
    emergencyPhone: "", passportNumber: "", passportPhotoPath: null, cpf: "",
    addressStreet: "", addressNumber: "", addressComplement: "", addressNeighborhood: "",
    addressCity: "", addressState: "", addressZip: "",
    school: prefill.school, turno: prefill.turno, courseValue: prefill.courseValue, arrivalDate: null, classStartDate: null,
    status: "Aguardando aluno",
  };
  const saved = await saveEnrollmentRemote(draft);
  if (!saved) { alert(t("enr.createError")); return; }
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

  document.getElementById("enrollment-modal-title").textContent = enr.name || t("enr.newTitle");
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
    btn.textContent = t("common.copied");
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
  renderSchoolCommissions();
  closeEnrollmentModal();
  await saveEnrollmentRemote(enr);
  await handleEnrollmentInfluencerCommission(enr);

  if (enr.email && !enr.studentUserId) {
    const result = await provisionStudentAccess(enr);
    if (result && result.password) {
      renderEnrollments();
      openStudentAccessModal(enr, result.password);
    }
  }
});

enrBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("enr-id").value;
  if (!id) return;
  if (!confirm(t("enr.confirmDelete"))) return;
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
  { key: "photoPath", input: "collab-field-photo", link: "collab-photo-view-link", slug: "foto-perfil" },
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
    btn.textContent = t("common.copied");
  } catch {
    prompt(t("common.copyLinkPrompt"), url);
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
      <td><span class="badge ${COLLAB_STATUS_BADGE[c.status] || "badge-neutral"}">${escapeHtml(statusLabel(c.status))}</span></td>
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
  sel.innerHTML = `<option value="">${t("team.noManagerSet")}</option>` + managers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  sel.value = current;
}

function openCollaboratorModal(id) {
  collaboratorForm.reset();
  renderCollaboratorManagerOptions();
  COLLAB_DOC_FIELDS.forEach(f => { document.getElementById(f.link).style.display = "none"; });

  if (id) {
    const c = collaborators.find(x => x.id === id);
    if (!c) return;
    document.getElementById("collaborator-modal-title").textContent = c.name || t("team.collaborator");
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
    document.getElementById("collaborator-modal-title").textContent = t("team.newTitle");
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
  if (!saved) { alert(t("team.saveError")); return; }

  if (existing) Object.assign(existing, saved);
  else collaborators.push(saved);

  renderCollaborators();
  closeCollaboratorModal();
});

collabBtnDelete.addEventListener("click", async () => {
  const id = document.getElementById("collab-id").value;
  if (!id || !confirm(t("team.confirmDelete"))) return;
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
  { value: "name", label: () => t("forms.fieldTypeName") },
  { value: "email", label: () => t("forms.fieldTypeEmail") },
  { value: "phone_br", label: () => t("forms.fieldTypePhone") },
  { value: "source", label: () => t("forms.fieldTypeSource") },
  { value: "boolean", label: () => t("forms.fieldTypeBoolean") },
  { value: "date", label: () => t("forms.fieldTypeDate") },
  { value: "text", label: () => t("forms.fieldTypeTextShort") },
  { value: "textarea", label: () => t("forms.fieldTypeTextLong") },
  { value: "select", label: () => t("forms.fieldTypeSelect") },
];

let forms = [];
let formSubmissions = [];

function formFromDb(r) {
  return {
    id: r.id, title: r.title || t("forms.newTitle"), subtitle: r.subtitle || "",
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
async function deleteFormSubmissionsRemote(ids) {
  const { error } = await supabase.from("form_submissions").delete().in("id", ids);
  if (error) console.error("Erro ao excluir respostas de formulário:", error);
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
      <td><button type="button" class="btn btn-ghost btn-sm" data-act="responses">${t("forms.responses")} (${formSubmissionCount(f.id)})</button></td>
      <td class="cell-actions">
        <div class="cell-actions-row">
          <button type="button" class="cell-copy-btn" data-act="copy" title="${t("common.copyLink")}">${CELL_COPY_ICON_SVG}</button>
          <button type="button" class="cell-copy-btn" data-act="duplicate" title="${t("forms.duplicate")}" style="${canManageForms() ? "" : "display:none;"}">${CELL_DUPLICATE_ICON_SVG}</button>
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
    tr.querySelector('[data-act="duplicate"]').addEventListener("click", e => {
      e.stopPropagation();
      duplicateForm(f.id);
    });
    tr.querySelector('[data-act="responses"]').addEventListener("click", e => {
      e.stopPropagation();
      openFormResponses(f.id);
    });
    tbody.appendChild(tr);
  });
}

async function duplicateForm(id) {
  const original = forms.find(f => f.id === id);
  if (!original) return;
  const title = `${original.title} (${t("common.copySuffix")})`;
  const data = {
    id: uid(),
    title,
    subtitle: original.subtitle || "",
    slug: uniqueFormSlug(slugify(title)),
    fields: original.fields.map(f => ({ ...f, options: f.options ? [...f.options] : [] })),
    active: true,
  };
  const saved = await saveFormRemote(data);
  if (!saved) { alert(t("forms.saveError")); return; }
  forms.push(saved);
  renderFormsList();
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
        <input type="text" class="ff-label" ${dis} placeholder="${t("forms.questionPlaceholder")}" value="${escapeHtml(f.label || "")}">
        <select class="ff-type" ${dis}>
          ${FORM_FIELD_TYPES.map(ft => `<option value="${ft.value}" ${f.type === ft.value ? "selected" : ""}>${escapeHtml(ft.label())}</option>`).join("")}
        </select>
      </div>
      <div class="form-field-row-sub">
        <label class="checkbox-label"><input type="checkbox" class="ff-required" ${dis} ${f.required ? "checked" : ""}><span>${t("forms.required")}</span></label>
        <input type="text" class="ff-options" ${dis} placeholder="${t("forms.optionsPlaceholder")}" value="${escapeHtml((f.options || []).join(", "))}" style="${f.type === "select" ? "" : "display:none;"}">
        ${formBuilderReadOnly ? "" : `<button type="button" class="btn-icon ff-delete" title="${t("forms.deleteField")}">&times;</button>`}
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
    document.getElementById("form-modal-title").textContent = t("forms.newTitle");
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
  formBtnCopyLink.textContent = t("common.copied");
  setTimeout(() => { formBtnCopyLink.textContent = t("common.copyLink"); }, 1500);
});

formBuilderForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (formBuilderReadOnly) return;
  const id = document.getElementById("form-id").value;
  const title = document.getElementById("form-field-title").value.trim();
  const subtitle = document.getElementById("form-field-subtitle").value.trim();
  if (!formBuilderFields.length) {
    alert(t("forms.addFieldError"));
    return;
  }
  if (formBuilderFields.some(f => !f.label.trim())) {
    alert(t("forms.fillQuestionsError"));
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
  if (!saved) { alert(t("forms.saveError")); return; }

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
  if (!id || !confirm(t("forms.confirmDelete"))) return;
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
  document.getElementById("fr-title").textContent = form ? `${t("forms.responsesTitlePrefix")} ${form.title}` : t("forms.responses");
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

let frSelectedIds = new Set();

function renderFormResponses() {
  const form = forms.find(f => f.id === formResponsesFormId);
  const thead = document.getElementById("fr-thead");
  const tbody = document.getElementById("fr-tbody");
  if (!form) { thead.innerHTML = ""; tbody.innerHTML = ""; return; }

  const canConvert = hasModuleAccess(session.role, "leads");
  const consultants = users.filter(u => isSellRole(u.role));

  thead.innerHTML = `<tr>
    <th class="cell-check"><input type="checkbox" id="fr-select-all"></th>
    ${form.fields.map(f => `<th>${escapeHtml(f.label)}</th>`).join("")}
    <th>${t("forms.receivedOn")}</th>
    <th>${t("common.lead")}</th>
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
      leadCell = `<button type="button" class="fr-lead-badge" data-act="view-lead" data-lead-id="${s.leadId}">${t("forms.viewLeadBtn")}</button>`;
    } else if (canConvert) {
      leadCell = `
        <div class="fr-convert-cell">
          <select data-role="consultor">
            <option value="">${t("forms.noConsultant")}</option>
            ${consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
          <button type="button" class="btn btn-primary btn-sm" data-act="convert" data-submission-id="${s.id}">${t("forms.convertToLead")}</button>
        </div>`;
    } else {
      leadCell = "—";
    }

    return `<tr>
      <td class="cell-check"><input type="checkbox" class="fr-row-checkbox" data-id="${s.id}" ${frSelectedIds.has(s.id) ? "checked" : ""}></td>
      ${cells}<td>${when}</td><td>${leadCell}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll('[data-act="convert"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const consultorSel = row.querySelector('[data-role="consultor"]');
      btn.disabled = true;
      btn.textContent = t("forms.saving");
      const res = await convertSubmissionToLead(btn.dataset.submissionId, consultorSel.value || null);
      if (res && res.duplicate) {
        alert(`${t("lead.phoneAlreadyExists")} ${res.duplicate.name}.`);
        renderFormResponses();
      }
    });
  });
  tbody.querySelectorAll('[data-act="view-lead"]').forEach(btn => {
    btn.addEventListener("click", () => {
      if (!canAccessView("leads")) return;
      switchView("leads");
      openLeadModal(btn.dataset.leadId);
    });
  });
  tbody.querySelectorAll(".fr-row-checkbox").forEach(cb => {
    cb.addEventListener("click", e => e.stopPropagation());
    cb.addEventListener("change", e => {
      if (e.target.checked) frSelectedIds.add(e.target.dataset.id);
      else frSelectedIds.delete(e.target.dataset.id);
      updateFrSelectAllState(rows);
      updateFrBulkBar();
    });
  });

  const bulkConsultorSel = document.getElementById("fr-bulk-consultor");
  bulkConsultorSel.innerHTML = `<option value="">${t("forms.noConsultant")}</option>` + consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  updateFrSelectAllState(rows);
  updateFrBulkBar();
}

function updateFrSelectAllState(rows) {
  const cb = document.getElementById("fr-select-all");
  if (!cb) return;
  if (!rows.length) { cb.checked = false; cb.indeterminate = false; return; }
  const selectedCount = rows.filter(s => frSelectedIds.has(s.id)).length;
  cb.checked = selectedCount === rows.length;
  cb.indeterminate = selectedCount > 0 && selectedCount < rows.length;
}
function updateFrBulkBar() {
  const bar = document.getElementById("fr-bulk-bar");
  const count = frSelectedIds.size;
  document.getElementById("fr-bulk-count").textContent = `${count} ${t("common.selectedCount")}`;
  bar.style.display = count > 0 ? "flex" : "none";
}

document.getElementById("fr-thead").addEventListener("change", e => {
  const cb = e.target.closest("#fr-select-all");
  if (!cb) return;
  const rows = formSubmissions.filter(s => s.formId === formResponsesFormId);
  if (cb.checked) rows.forEach(s => frSelectedIds.add(s.id));
  else rows.forEach(s => frSelectedIds.delete(s.id));
  renderFormResponses();
});
document.getElementById("fr-bulk-clear").addEventListener("click", () => {
  frSelectedIds = new Set();
  renderFormResponses();
});
document.getElementById("fr-bulk-delete").addEventListener("click", async () => {
  const ids = Array.from(frSelectedIds);
  if (!ids.length) return;
  if (!confirm(`${t("forms.confirmBulkDeleteResponses1")} ${ids.length} ${t("forms.confirmBulkDeleteResponses2")}`)) return;
  formSubmissions = formSubmissions.filter(s => !ids.includes(s.id));
  frSelectedIds = new Set();
  renderFormResponses();
  renderFormsList();
  await deleteFormSubmissionsRemote(ids);
});
document.getElementById("fr-bulk-assign").addEventListener("click", async () => {
  const ids = Array.from(frSelectedIds);
  if (!ids.length) return;
  const consultorId = document.getElementById("fr-bulk-consultor").value || null;
  const form = forms.find(f => f.id === formResponsesFormId);
  if (!form) return;
  const targets = formSubmissions.filter(s => ids.includes(s.id) && !s.leadId);
  if (!targets.length) { alert(t("forms.bulkAssignNoneEligible")); return; }
  const btn = document.getElementById("fr-bulk-assign");
  btn.disabled = true;
  btn.textContent = t("forms.saving");
  let duplicates = 0;
  for (const submission of targets) {
    const res = await convertSubmissionToLead(submission.id, consultorId);
    if (res && res.duplicate) duplicates++;
  }
  btn.disabled = false;
  btn.textContent = t("forms.bulkAssignConsultant");
  frSelectedIds = new Set();
  renderFormResponses();
  if (duplicates) alert(`${duplicates} ${t("forms.bulkAssignPhoneDuplicates")}`);
});

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
    id: uid(), name: name || t("forms.leadNoName"), company: "", email,
    countryCode: "BR", phoneDdd: ddd, phoneNumber: number,
    phone: ddd && number ? `(${ddd}) ${number}` : "",
    source, category: "Outro", status: "Novo", temperature: "",
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

  const phoneDup = findLeadWithSamePhone(lead);
  if (phoneDup) return { duplicate: phoneDup };

  leads.push(lead);
  await saveLeads();
  await maybeAssignRotation(lead);

  submission.leadId = lead.id;
  await markSubmissionLeadRemote(submission.id, lead.id);

  renderFormResponses();
  renderFormsList();
  renderLeads();
  return { ok: true };
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
  renderDashboardTemperature();
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
    { label: t("dash.statNewLeads"), value: String(newLeads) },
    { label: t("dash.statOpenDeals"), value: `${openDeals.length} · ${currency(openValue)}` },
    { label: t("dash.statConversion"), value: `${conversion}%`, good: true },
  ];

  if (hasModuleAccess(session.role, "financeiro")) {
    const now2 = new Date();
    const monthStart = new Date(now2.getFullYear(), now2.getMonth(), 1).getTime();
    const monthEnd = new Date(now2.getFullYear(), now2.getMonth() + 1, 1).getTime();
    const revenue = deals
      .filter(d => isWonStage(d.stage) && d.closedAt >= monthStart && d.closedAt < monthEnd)
      .reduce((s, d) => s + (Number(d.value) || 0), 0);
    const pendingReceivable = receivables.filter(r => !r.paid).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    cards.push({ label: t("dash.statRevenue"), value: currency(revenue), good: true });
    cards.push({ label: t("dash.statReceivable"), value: currency(pendingReceivable) });
  }

  if (hasModuleAccess(session.role, "matriculas")) {
    const waiting = enrollments.filter(e => e.status === "Aguardando aluno").length;
    cards.push({ label: t("dash.statEnrollWaiting"), value: String(waiting) });
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
    container.innerHTML = `<p class="muted-note dash-funnel-empty">${t("dash.noDealsInPipeline")}</p>`;
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
        <div class="dash-funnel-label">${escapeHtml(stageLabel(s.label))}</div>
      </div>`;
  }).join("");

  const lostHtml = lostCount > 0
    ? `<p class="muted-note" style="margin-top:6px;">+ ${lostCount} ${t("dash.lostDealsInFunnel")}</p>`
    : "";

  container.innerHTML = rows + lostHtml;
}

/* ---- leads por temperatura (barras compactas, ao lado do funil) ---- */
const TEMP_COLORS = { "Quente": "#e2483d", "Morno": "#fb9d2d", "Frio": "#3167a1", "": "#8891a5" };
function renderDashboardTemperature() {
  const el = document.getElementById("dash-temp");
  const active = leads.filter(l => l.active !== false);
  if (!active.length) {
    el.innerHTML = `<p class="muted-note">${t("dash.noLeadsYet")}</p>`;
    return;
  }
  const order = ["Quente", "Morno", "Frio", ""];
  const counts = order.map(k => active.filter(l => (TEMPERATURES.includes(l.temperature) ? l.temperature : "") === k).length);
  const max = Math.max(1, ...counts);
  const rows = order.map((k, i) => {
    const pct = Math.round((counts[i] / active.length) * 100);
    const width = counts[i] === 0 ? 0 : Math.max(4, Math.round((counts[i] / max) * 100));
    return `
      <div class="dash-temp-row" style="--temp-color:${TEMP_COLORS[k]}">
        <div class="dash-temp-label"><span class="dash-temp-dot"></span>${escapeHtml(k ? statusLabel(k) : t("dash.tempNone"))}</div>
        <div class="dash-temp-track"><div class="dash-temp-fill" style="width:${width}%"></div></div>
        <div class="dash-temp-count">${counts[i]} <small>(${pct}%)</small></div>
      </div>`;
  }).join("");
  el.innerHTML = `<div class="dash-temp-total">${active.length} ${t("dash.tempLeads")}</div>${rows}`;
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
      title: `${r.clientName || t("dash.clientFallback")} — ${t("dash.installmentWord")} ${r.installmentNumber}/${r.installmentsTotal}`,
      sub: `${t("dash.overdueSub")} ${formatDate(r.dueDate)}`, value: currency(r.amount), date: r.dueDate,
    })),
    ...overdueExpenses.map(e => ({
      title: e.description, sub: `${t("dash.expenseDueSub")} ${formatDate(e.dueDate)}`, value: currency(e.amount), date: e.dueDate,
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
    .map(l => ({ kind: "lead", id: l.id, title: l.name, sub: `${t("dash.newLeadSub")} ${l.source || t("common.other")}`, date: l.createdAt }));

  const recentDeals = deals.filter(d => isClosedStage(d.stage) && d.closedAt).slice()
    .sort((a, b) => b.closedAt - a.closedAt).slice(0, 5)
    .map(d => ({
      kind: "deal", id: d.id, title: d.name,
      sub: isWonStage(d.stage) ? `${t("dash.dealWonSub")} · ${currency(d.value)}` : t("dash.dealLostSub"),
      date: d.closedAt, won: isWonStage(d.stage),
    }));

  const items = [...recentLeads, ...recentDeals].sort((a, b) => b.date - a.date).slice(0, 8);

  const listEl = document.getElementById("dash-atividade-list");
  if (!items.length) {
    listEl.innerHTML = `<p class="muted-note" style="padding:16px 20px;">${t("dash.noRecentActivity")}</p>`;
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
function dashCalMonthLabel(i) {
  const keys = ["monthJan", "monthFeb", "monthMar", "monthApr", "monthMay", "monthJun", "monthJul", "monthAug", "monthSep", "monthOct", "monthNov", "monthDec"];
  return t(`dash.${keys[i]}`);
}
function agendaTypeLabel(type) {
  return { tarefa: t("agenda.taskType"), reuniao: t("agenda.meetingType"), aviso: t("agenda.noticeType") }[type] || type;
}

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
      <button type="button" id="dash-cal-prev" aria-label="${t("dash.prevMonth")}">&lsaquo;</button>
      <span class="dash-cal-label">${dashCalMonthLabel(month)} de ${year}</span>
      <button type="button" id="dash-cal-next" aria-label="${t("dash.nextMonth")}">&rsaquo;</button>
    </div>
    <div class="dash-cal-grid">${dowHtml}${daysHtml}</div>
    <div class="dash-cal-legend">
      <span class="dash-cal-legend-item"><span class="dash-cal-dot dot-tarefa"></span>${t("agenda.taskType")}</span>
      <span class="dash-cal-legend-item"><span class="dash-cal-dot dot-reuniao"></span>${t("agenda.meetingType")}</span>
      <span class="dash-cal-legend-item"><span class="dash-cal-dot dot-aviso"></span>${t("agenda.noticeType")}</span>
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
    ? t("dash.todayAgenda")
    : `${t("dash.agendaOn")} ${formatDate(dashCalendarSelectedDate)}`;

  const items = agendaItems
    .filter(a => a.itemDate === dashCalendarSelectedDate)
    .sort((a, b) => (a.itemTime || "99:99").localeCompare(b.itemTime || "99:99"));

  const list = document.getElementById("dash-agenda-day-list");
  if (!items.length) {
    list.innerHTML = `<p class="muted-note" style="padding:4px 0;">${t("dash.nothingScheduled")}</p>`;
    return;
  }

  list.innerHTML = items.map(a => {
    const consultor = a.consultorId ? users.find(u => u.id === a.consultorId) : null;
    const metaParts = [agendaTypeLabel(a.type)];
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
  const consultants = users.filter(u => isSellRole(u.role));
  sel.innerHTML = `<option value="">${t("agenda.noSpecificConsultant")}</option>` + consultants.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if (currentId) sel.value = currentId;
  else if (session && isSellRole(session.role)) sel.value = session.id;
}

function openAgendaModal(id, presetDate) {
  agendaForm.reset();
  const existing = id ? agendaItems.find(a => a.id === id) : null;

  if (existing) {
    document.getElementById("agenda-modal-title").textContent = t("agenda.editTitle");
    document.getElementById("agenda-id").value = existing.id;
    document.getElementById("agenda-field-title").value = existing.title;
    document.getElementById("agenda-field-date").value = existing.itemDate;
    document.getElementById("agenda-field-time").value = existing.itemTime || "";
    document.getElementById("agenda-field-notes").value = existing.notes || "";
    renderAgendaConsultorOptions(existing.consultorId);
    setAgendaType(existing.type);
    agendaBtnDelete.style.display = "inline-block";
  } else {
    document.getElementById("agenda-modal-title").textContent = t("agenda.newTitle");
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
  if (!saved) { alert(t("agenda.saveError")); return; }

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
  if (!id || !confirm(t("agenda.confirmDelete"))) return;
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
      <td><span class="badge ${u.active ? "badge-good" : "badge-danger"}">${u.active ? t("users.statusActive") : t("users.statusInactive")}</span></td>
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
  alert(t("users.createInfoAlert"));
});
document.getElementById("user-modal-close").addEventListener("click", closeUserModal);
document.getElementById("user-btn-cancel").addEventListener("click", closeUserModal);
userModalBackdrop.addEventListener("click", e => { if (e.target === userModalBackdrop) closeUserModal(); });

document.getElementById("user-btn-reset-password").addEventListener("click", async () => {
  const id = document.getElementById("user-id").value;
  const u = users.find(u => u.id === id);
  if (!u) return;
  if (!confirm(`${t("users.confirmSendReset1")} ${u.name} (${u.email})?`)) return;

  const btn = document.getElementById("user-btn-reset-password");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("users.sending");

  const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
    redirectTo: `${window.location.origin}${window.location.pathname.replace(/index\.html$/, "")}redefinir-senha.html`,
  });

  btn.disabled = false;
  btn.textContent = original;

  if (error) {
    alert(t("users.resetSendError"));
    return;
  }
  alert(`${t("users.resetSentSuccess")} ${u.email}.`);
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
    alert(t("users.cantRemoveLastAdmin"));
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
    alert(t("users.cantDeactivateLastAdmin"));
    return;
  }
  if (!confirm(`${t("users.confirmDeactivate1")} "${u.name}"${t("users.confirmDeactivate2")}`)) return;
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
    <td colspan="8" class="perm-locked">${t("users.fullAccessFixed")}</td>
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
  if (rotationModalBackdrop.classList.contains("open")) closeRotationModal();
  if (adSpendModalBackdrop.classList.contains("open")) closeAdSpendModal();
  if (collaboratorModalBackdrop.classList.contains("open")) closeCollaboratorModal();
  if (followUpModalBackdrop.classList.contains("open")) closeFollowUpModal();
  if (notesModalBackdrop.classList.contains("open")) closeNotesModal();
  if (teamMessageModalBackdrop.classList.contains("open")) closeTeamMessageModal();
  if (formModalBackdrop.classList.contains("open")) closeFormModal();
  if (agendaModalBackdrop.classList.contains("open")) closeAgendaModal();
  if (contractModalBackdrop.classList.contains("open")) closeContractModal();
  if (studentAccessModalBackdrop.classList.contains("open")) closeStudentAccessModal();
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

  [users, leads, deals, quotes, catalog, SOURCES, STAGES, EXPENSE_CATEGORIES, expenses, commissions, influencerCommissions, adSpend, receivables, commissionSettings, enrollments, collaborators, teamAnnouncement, forms, formSubmissions, agendaItems, contracts, menuConfig, rotationSettings, schools, schoolCities] = await Promise.all([
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
    loadInfluencerCommissions(),
    loadAdSpend(),
    loadReceivables(),
    loadCommissionSettings(),
    loadEnrollments(),
    loadCollaborators(),
    loadTeamAnnouncement(),
    loadForms(),
    loadFormSubmissions(),
    loadAgendaItems(),
    loadContracts(),
    loadMenuConfig(),
    loadRotationSettings(),
    loadSchools(),
    loadSchoolCities(),
  ]);

  renderSessionChip();
  initSidebarToggle();
  applyMenuStructure(menuConfig);
  initNavigation();
  refreshMenuChevrons();
  initMenuEditor();
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
  renderInfluencerCommissions();
  renderAdSpend();
  renderEnrollments();
  renderSchoolCommissions();
  renderCollaborators();
  renderFormsList();
  renderContractsList();
  if (session.role === "ADM") {
    renderUsers();
    renderPermissionsTable();
  }

  document.body.style.visibility = "visible";
})();
