const STORAGE_KEY = "crm-vendas-deals";

const STAGES = [
  { id: "lead", label: "Lead" },
  { id: "contato", label: "Contato Feito" },
  { id: "proposta", label: "Proposta" },
  { id: "negociacao", label: "Negociação" },
  { id: "ganho", label: "Ganho" },
  { id: "perdido", label: "Perdido" },
];

const CLOSED_WON = "ganho";
const CLOSED_LOST = "perdido";

function loadDeals() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : seedDeals();
  } catch {
    return seedDeals();
  }
}

function seedDeals() {
  const now = Date.now();
  return [
    { id: crypto.randomUUID(), name: "Padaria Bom Pão", contact: "Maria Silva", info: "(11) 99999-0001", value: 3200, stage: "lead", notes: "Interessada em pacote mensal.", createdAt: now, closedAt: null },
    { id: crypto.randomUUID(), name: "Auto Peças União", contact: "Carlos Souza", info: "carlos@autopecasuniao.com", value: 8500, stage: "proposta", notes: "Aguardando aprovação do orçamento.", createdAt: now, closedAt: null },
    { id: crypto.randomUUID(), name: "Studio Fit Academia", contact: "Ana Costa", info: "(21) 98888-4321", value: 1500, stage: "ganho", notes: "Fechado! Início dia 1º.", createdAt: now, closedAt: now },
  ];
}

function saveDeals() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
}

let deals = loadDeals();

const boardEl = document.getElementById("board");
const modalBackdrop = document.getElementById("modal-backdrop");
const form = document.getElementById("deal-form");
const fieldStage = document.getElementById("field-stage");
const btnDelete = document.getElementById("btn-delete");

function currency(v) {
  return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function renderStageOptions() {
  fieldStage.innerHTML = STAGES.map(s => `<option value="${s.id}">${s.label}</option>`).join("");
}

function renderBoard() {
  boardEl.innerHTML = "";
  STAGES.forEach(stage => {
    const stageDeals = deals.filter(d => d.stage === stage.id);
    const totalValue = stageDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    const column = document.createElement("div");
    column.className = "column";
    column.dataset.stage = stage.id;

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

    cardsEl.addEventListener("dragover", e => {
      e.preventDefault();
      cardsEl.classList.add("drag-over");
    });
    cardsEl.addEventListener("dragleave", () => cardsEl.classList.remove("drag-over"));
    cardsEl.addEventListener("drop", e => {
      e.preventDefault();
      cardsEl.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      moveDeal(id, stage.id);
    });

    boardEl.appendChild(column);
  });

  renderDashboard();
}

function renderCard(deal) {
  const card = document.createElement("div");
  card.className = "card";
  card.draggable = true;
  card.dataset.id = deal.id;

  card.innerHTML = `
    <div class="card-name">${escapeHtml(deal.name)}</div>
    <div class="card-contact">${escapeHtml(deal.contact || "Sem contato")}</div>
    <div class="card-value">${currency(deal.value)}</div>
  `;

  card.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", deal.id);
    requestAnimationFrame(() => card.classList.add("dragging"));
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("click", () => openModal(deal.id));

  return card;
}

function moveDeal(id, newStage) {
  const deal = deals.find(d => d.id === id);
  if (!deal || deal.stage === newStage) return;
  deal.stage = newStage;
  deal.closedAt = (newStage === CLOSED_WON || newStage === CLOSED_LOST) ? Date.now() : null;
  saveDeals();
  renderBoard();
}

function renderDashboard() {
  const open = deals.filter(d => d.stage !== CLOSED_WON && d.stage !== CLOSED_LOST);
  const pipelineValue = open.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  const now = new Date();
  const wonThisMonth = deals.filter(d => {
    if (d.stage !== CLOSED_WON || !d.closedAt) return false;
    const closed = new Date(d.closedAt);
    return closed.getMonth() === now.getMonth() && closed.getFullYear() === now.getFullYear();
  });
  const wonValue = wonThisMonth.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  const closed = deals.filter(d => d.stage === CLOSED_WON || d.stage === CLOSED_LOST);
  const conversion = closed.length === 0 ? 0 : Math.round((deals.filter(d => d.stage === CLOSED_WON).length / closed.length) * 100);

  document.getElementById("stat-open").textContent = open.length;
  document.getElementById("stat-pipeline-value").textContent = currency(pipelineValue);
  document.getElementById("stat-won").textContent = currency(wonValue);
  document.getElementById("stat-conversion").textContent = `${conversion}%`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function openModal(id) {
  form.reset();
  renderStageOptions();

  if (id) {
    const deal = deals.find(d => d.id === id);
    document.getElementById("modal-title").textContent = "Editar negócio";
    document.getElementById("deal-id").value = deal.id;
    document.getElementById("field-name").value = deal.name;
    document.getElementById("field-contact").value = deal.contact || "";
    document.getElementById("field-info").value = deal.info || "";
    document.getElementById("field-value").value = deal.value || "";
    document.getElementById("field-stage").value = deal.stage;
    document.getElementById("field-notes").value = deal.notes || "";
    btnDelete.style.display = "inline-block";
  } else {
    document.getElementById("modal-title").textContent = "Novo negócio";
    document.getElementById("deal-id").value = "";
    document.getElementById("field-stage").value = "lead";
    btnDelete.style.display = "none";
  }

  modalBackdrop.classList.add("open");
  document.getElementById("field-name").focus();
}

function closeModal() {
  modalBackdrop.classList.remove("open");
}

document.getElementById("btn-new").addEventListener("click", () => openModal(null));
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("btn-cancel").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", e => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && modalBackdrop.classList.contains("open")) closeModal();
});

form.addEventListener("submit", e => {
  e.preventDefault();
  const id = document.getElementById("deal-id").value;
  const stage = document.getElementById("field-stage").value;

  const data = {
    name: document.getElementById("field-name").value.trim(),
    contact: document.getElementById("field-contact").value.trim(),
    info: document.getElementById("field-info").value.trim(),
    value: parseFloat(document.getElementById("field-value").value) || 0,
    stage,
    notes: document.getElementById("field-notes").value.trim(),
  };

  if (id) {
    const deal = deals.find(d => d.id === id);
    const wasClosed = deal.stage === CLOSED_WON || deal.stage === CLOSED_LOST;
    const isClosed = stage === CLOSED_WON || stage === CLOSED_LOST;
    Object.assign(deal, data);
    if (isClosed && !wasClosed) deal.closedAt = Date.now();
    if (!isClosed) deal.closedAt = null;
  } else {
    deals.push({
      id: crypto.randomUUID(),
      ...data,
      createdAt: Date.now(),
      closedAt: (stage === CLOSED_WON || stage === CLOSED_LOST) ? Date.now() : null,
    });
  }

  saveDeals();
  renderBoard();
  closeModal();
});

btnDelete.addEventListener("click", () => {
  const id = document.getElementById("deal-id").value;
  if (!id) return;
  if (!confirm("Excluir este negócio? Essa ação não pode ser desfeita.")) return;
  deals = deals.filter(d => d.id !== id);
  saveDeals();
  renderBoard();
  closeModal();
});

renderStageOptions();
renderBoard();
