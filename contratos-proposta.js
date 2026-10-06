/* ============================================================
   CONTRATO COM A COTAÇÃO (lado da equipe) — "Gerar contrato" cria um
   link único em 3 etapas pro cliente: preencher os dados, ler a
   cotação + contrato e assinar com um código enviado ao e-mail.
   Aqui ficam: prévia antes de confirmar, link, acompanhamento do status,
   contrato assinado em PDF e o cadastro dos modelos (ADM).
   Depende de script.js (session, leads, quotes, contracts, enrollments,
   t, escapeHtml, statusLabel, currency, CONTRACT_STATUS_BADGE...) e de
   contrato-modelo.js. A página do cliente é proposta-publica.html.
   ============================================================ */

let contractTemplates = [];
let proposalCurrent = null;   /* { mode: "new"|"manage", quote?, contractId?, template? } */

async function loadContractTemplates() {
  const { data, error } = await supabase.from("contract_templates").select("*").order("created_at", { ascending: false });
  if (error) { console.error("Erro ao carregar modelos de contrato:", error); return []; }
  contractTemplates = data;
  return data;
}
const activeContractTemplate = () => contractTemplates.find(tp => tp.ativo) || null;

function proposalUrl(token) { return `${window.location.origin}/proposta-publica.html?t=${token}`; }

/* ---------------- dados do cliente a partir do cadastro ---------------- */
function proposalPrefill(quote) {
  const lead = quote.leadId ? leads.find(l => l.id === quote.leadId) : null;
  const en = quote.leadId
    ? enrollments.filter(e => e.leadId === quote.leadId).sort((a, b) => b.createdAt - a.createdAt)[0]
    : null;
  const endereco = en ? [en.addressStreet, en.addressNumber, en.addressComplement, en.addressNeighborhood].filter(Boolean).join(", ") : "";
  return {
    nome: (en && en.name) || (lead && lead.name) || quote.client || "",
    email: (en && en.email) || (lead && lead.email) || quote.email || "",
    telefone: (en && en.phone) || (lead && leadPhoneText(lead)) || "",
    cpf: en ? en.cpf : "",
    documento: en ? en.passportNumber : "",
    data_nascimento: en ? (en.birthDate || "") : "",
    nacionalidade: en ? (en.nationality || "") : "",
    endereco,
    cidade_estado: en ? [en.addressCity, en.addressState].filter(Boolean).join(" / ") : "",
    cep: en ? en.addressZip : "",
    contato_emergencia_nome: en ? (en.emergencyName || "") : "",
    contato_emergencia_telefone: en ? en.emergencyPhone : "",
  };
}

function proposalQuoteForDoc(q) {
  return {
    numero: q.numero, client: q.client, email: q.email, items_detail: q.itemsDetail || [], value: q.value,
    emissao: q.emissao, validade: q.validade, consultor_name: q.consultorName, consultor_email: q.consultorEmail,
  };
}

const proposalFieldLabel = key => {
  const campo = CONTRATO_CAMPOS.find(c => `cliente.${c.key}` === key);
  return campo ? campo.label : key;
};

/* ---------------- modal ---------------- */
const proposalBackdrop = document.getElementById("proposal-modal-backdrop");
const proposalFrame = document.getElementById("proposal-frame");
proposalFrame.setAttribute("sandbox", "allow-same-origin allow-modals");

function proposalSetError(msg) {
  const el = document.getElementById("proposal-error");
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}
function closeProposalModal() { proposalBackdrop.classList.remove("open"); proposalCurrent = null; }
document.getElementById("proposal-modal-close").addEventListener("click", closeProposalModal);
document.getElementById("proposal-close").addEventListener("click", closeProposalModal);
proposalBackdrop.addEventListener("click", e => { if (e.target === proposalBackdrop) closeProposalModal(); });

function proposalInfoHtml(parts) {
  return parts.filter(Boolean).map(([k, v]) => `<div><small>${escapeHtml(k)}</small><b>${escapeHtml(v)}</b></div>`).join("");
}

/* prévia ANTES de confirmar: contrato preenchido com o que já existe no cadastro */
async function openProposalForQuote(quote) {
  proposalCurrent = { mode: "new", quote };
  proposalSetError("");
  document.getElementById("proposal-modal-title").textContent = t("contracts.proposalTitle");
  document.getElementById("proposal-link-row").style.display = "none";
  ["proposal-print", "proposal-cancel-contract"].forEach(id => { document.getElementById(id).style.display = "none"; });
  const confirmBtn = document.getElementById("proposal-confirm");
  confirmBtn.style.display = ""; confirmBtn.disabled = true;
  document.getElementById("proposal-pending").style.display = "none";
  proposalFrame.srcdoc = "";
  document.getElementById("proposal-info").innerHTML = "";
  proposalBackdrop.classList.add("open");

  await loadContractTemplates();
  const tpl = activeContractTemplate();
  if (!tpl) { proposalSetError(t("contracts.proposalNoTemplate")); return; }
  proposalCurrent.template = tpl;

  const dados = proposalPrefill(quote);
  const qdoc = proposalQuoteForDoc(quote);
  const ctx = contratoContexto({ dados, numero: "—", cotacao: qdoc });
  proposalFrame.srcdoc = contratoMontarDocumento({ templateHtml: tpl.html, ctx, cotacao: qdoc, marcarPendentes: true });

  document.getElementById("proposal-info").innerHTML = proposalInfoHtml([
    [t("contracts.clientData"), dados.nome || quote.client],
    quote.numero ? [t("contracts.quoteNumber"), quote.numero] : null,
    [t("common.value"), currency(quote.value)],
    [t("contracts.model"), `${tpl.nome} · ${t("contracts.version")} ${tpl.versao}`],
  ]);
  const pend = contratoPendentes(tpl.html, ctx).filter(k => k.startsWith("cliente."));
  const pendEl = document.getElementById("proposal-pending");
  if (pend.length) {
    pendEl.textContent = `${t("contracts.proposalPending")} ${pend.map(proposalFieldLabel).join(", ")}.`;
    pendEl.style.display = "block";
  }
  confirmBtn.disabled = false;
}

document.getElementById("proposal-confirm").addEventListener("click", async () => {
  if (!proposalCurrent || proposalCurrent.mode !== "new") return;
  const { quote, template } = proposalCurrent;
  const btn = document.getElementById("proposal-confirm");
  btn.disabled = true;
  proposalSetError("");
  const { data, error } = await supabase.from("contracts").insert({
    lead_id: quote.leadId || null, quote_id: quote.id, title: `Contrato — ${quote.client}`, content: "", value: quote.value,
    status: "Aguardando assinatura", modo: "proposta", template_id: template.id, created_by: session.id,
  }).select().single();
  if (error || !data) {
    console.error("Erro ao gerar contrato:", error);
    btn.disabled = false;
    proposalSetError(t("contracts.proposalCreateError"));
    return;
  }
  const c = contractFromDb(data);
  contracts.unshift(c);
  renderContractsList();
  renderQuoteContractsPanel(quote);
  openProposalManage(c.id);
});

/* contrato já gerado: link, status, e o documento (ou o assinado) */
async function openProposalManage(contractId) {
  const c = contracts.find(x => x.id === contractId);
  if (!c) return;
  proposalCurrent = { mode: "manage", contractId };
  proposalSetError("");
  document.getElementById("proposal-modal-title").textContent = `${t("contracts.proposalTitle")} · ${c.numero}`;
  document.getElementById("proposal-confirm").style.display = "none";
  document.getElementById("proposal-pending").style.display = "none";
  const quote = c.quoteId ? quotes.find(q => q.id === c.quoteId) : null;
  const lead = c.leadId ? leads.find(l => l.id === c.leadId) : null;

  const linkRow = document.getElementById("proposal-link-row");
  const waiting = c.status === "Aguardando assinatura";
  linkRow.style.display = waiting ? "" : "none";
  if (waiting) document.getElementById("proposal-link").value = proposalUrl(c.publicToken);
  document.getElementById("proposal-cancel-contract").style.display = waiting ? "" : "none";
  document.getElementById("proposal-print").style.display = c.status === "Assinado" ? "" : "none";

  document.getElementById("proposal-info").innerHTML = proposalInfoHtml([
    [t("contracts.contractNumber"), c.numero],
    [t("contracts.clientData"), (lead && lead.name) || (quote && quote.client) || "—"],
    quote && quote.numero ? [t("contracts.quoteNumber"), quote.numero] : null,
    [t("common.value"), currency(c.value)],
    [t("common.status"), statusLabel(c.status)],
    c.status === "Assinado" && c.signerName ? [t("contracts.signedBy"), `${c.signerName}${c.signedAt ? ` · ${new Date(c.signedAt).toLocaleString("pt-BR")}` : ""}`] : null,
  ]);
  proposalBackdrop.classList.add("open");

  if (c.status === "Assinado" && c.snapshot) {
    const s = c.snapshot;
    const ctx = contratoContexto({ dados: s.cliente, numero: s.contrato.numero, assinadoEm: s.contrato.assinado_em, cotacao: s.cotacao });
    proposalFrame.srcdoc = contratoMontarDocumento({ templateHtml: s.template_html, ctx, cotacao: s.cotacao, snapshot: s });
    return;
  }
  if (c.status === "Cancelado") { proposalFrame.srcdoc = ""; return; }

  if (!contractTemplates.length) await loadContractTemplates();
  const tpl = contractTemplates.find(x => x.id === c.templateId);
  if (!tpl) { proposalFrame.srcdoc = ""; return; }
  const filled = Object.values(c.dadosCliente || {}).some(Boolean);
  const dados = filled ? c.dadosCliente : (quote ? proposalPrefill(quote) : {});
  const qdoc = quote ? proposalQuoteForDoc(quote) : null;
  const ctx = contratoContexto({ dados, numero: c.numero, cotacao: qdoc });
  proposalFrame.srcdoc = contratoMontarDocumento({ templateHtml: tpl.html, ctx, cotacao: qdoc, marcarPendentes: !filled });
  if (!filled) {
    const el = document.getElementById("proposal-pending");
    el.textContent = t("contracts.waitingClient");
    el.style.display = "block";
  }
}

document.getElementById("proposal-copy").addEventListener("click", async () => {
  const url = document.getElementById("proposal-link").value;
  try { await navigator.clipboard.writeText(url); alert(t("contracts.proposalCopied")); }
  catch (err) { document.getElementById("proposal-link").select(); prompt(t("common.copyLinkPrompt"), url); }
});

document.getElementById("proposal-whatsapp").addEventListener("click", () => {
  const c = proposalCurrent && contracts.find(x => x.id === proposalCurrent.contractId);
  if (!c) return;
  const lead = c.leadId ? leads.find(l => l.id === c.leadId) : null;
  let digits = lead ? String(leadPhoneText(lead)).replace(/\D/g, "") : "";
  if (digits && lead && (lead.countryCode || "BR") === "BR" && !digits.startsWith("55") && digits.length >= 10 && digits.length <= 11) digits = "55" + digits;
  const msg = `Olá${lead ? `, ${lead.name.split(" ")[0]}` : ""}! Segue o link com a sua cotação e o contrato. São 3 passos rápidos: seus dados, leitura do contrato e a assinatura com um código enviado ao seu e-mail:\n${proposalUrl(c.publicToken)}`;
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
});

document.getElementById("proposal-cancel-contract").addEventListener("click", async () => {
  const c = proposalCurrent && contracts.find(x => x.id === proposalCurrent.contractId);
  if (!c || !confirm(t("contracts.confirmCancelProposal"))) return;
  const { error } = await supabase.from("contracts").update({ status: "Cancelado", updated_at: new Date().toISOString() }).eq("id", c.id);
  if (error) { console.error("Erro ao cancelar contrato:", error); proposalSetError(t("contracts.proposalCreateError")); return; }
  c.status = "Cancelado";
  renderContractsList();
  const q = c.quoteId ? quotes.find(x => x.id === c.quoteId) : null;
  if (q) renderQuoteContractsPanel(q);
  closeProposalModal();
});

document.getElementById("proposal-print").addEventListener("click", () => {
  proposalFrame.contentWindow.focus();
  proposalFrame.contentWindow.print();
});

/* ---------------- lista de contratos do cliente (dentro da cotação) ---------------- */
function renderQuoteContractsPanel(quote) {
  const panel = document.getElementById("q-contracts-panel");
  const list = document.getElementById("q-contracts-list");
  const leadId = quote ? quote.leadId : null;
  if (!quote || (!leadId && !contracts.some(c => c.quoteId === quote.id))) { panel.style.display = "none"; return; }
  const mine = contracts
    .filter(c => (leadId && c.leadId === leadId) || c.quoteId === quote.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  panel.style.display = "";
  if (!mine.length) { list.innerHTML = `<p class="muted-note" style="padding:0 20px 16px;">${escapeHtml(t("contracts.listEmpty"))}</p>`; return; }
  list.innerHTML = mine.map(c => `
    <div class="q-contract-row">
      <span class="q-contract-num">${escapeHtml(c.numero || "—")}</span>
      <span class="q-contract-title">${escapeHtml(c.title)}</span>
      <span class="cell-muted">${currency(c.value)}</span>
      <span class="badge ${CONTRACT_STATUS_BADGE[c.status] || "badge-neutral"}">${escapeHtml(statusLabel(c.status))}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-open-contract="${c.id}">${escapeHtml(t("contracts.open"))}</button>
    </div>`).join("");
}
document.getElementById("q-contracts-list").addEventListener("click", e => {
  const btn = e.target.closest("[data-open-contract]");
  if (!btn) return;
  const c = contracts.find(x => x.id === btn.dataset.openContract);
  if (!c) return;
  if (c.modo === "proposta") openProposalManage(c.id);
  else { switchView("contratos"); openContractModal(c.id); }
});

/* ============================================================
   MODELOS DE CONTRATO (só ADM)
   ============================================================ */
const templatesBackdrop = document.getElementById("templates-modal-backdrop");
const CONTRATO_VARS_CONHECIDAS = [
  ...CONTRATO_CAMPOS.map(c => `cliente.${c.key}`),
  "contrato.numero", "contrato.data_assinatura",
  "cotacao.numero", "cotacao.total", "cotacao.consultor", "cotacao.emissao", "cotacao.validade",
];

function templatesSetError(msg) {
  const el = document.getElementById("template-error");
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function renderTemplatesList() {
  const el = document.getElementById("templates-list");
  if (!contractTemplates.length) { el.innerHTML = `<p class="muted-note">${escapeHtml(t("contracts.templatesNone"))}</p>`; return; }
  el.innerHTML = contractTemplates.map(tp => `
    <div class="template-row">
      <span class="template-name">${escapeHtml(tp.nome)} <small>${escapeHtml(t("contracts.version"))} ${tp.versao}</small></span>
      <span class="cell-muted">${new Date(tp.created_at).toLocaleDateString("pt-BR")}</span>
      ${tp.ativo ? `<span class="badge badge-good">${escapeHtml(t("contracts.templateActive"))}</span>` : `<button type="button" class="btn btn-ghost btn-sm" data-activate-template="${tp.id}">${escapeHtml(t("contracts.templateActivate"))}</button>`}
    </div>`).join("");
}

async function activateContractTemplate(id) {
  /* o índice permite um ativo só: desativa o atual antes de ativar o novo */
  let r = await supabase.from("contract_templates").update({ ativo: false }).eq("ativo", true);
  if (r.error) return r.error;
  r = await supabase.from("contract_templates").update({ ativo: true }).eq("id", id);
  return r.error;
}

async function openTemplatesModal() {
  templatesSetError("");
  document.getElementById("template-frame").style.display = "none";
  document.getElementById("template-vars").style.display = "none";
  await loadContractTemplates();
  renderTemplatesList();
  templatesBackdrop.classList.add("open");
}
document.getElementById("btn-contract-templates").addEventListener("click", openTemplatesModal);
document.getElementById("templates-modal-close").addEventListener("click", () => templatesBackdrop.classList.remove("open"));
templatesBackdrop.addEventListener("click", e => { if (e.target === templatesBackdrop) templatesBackdrop.classList.remove("open"); });

document.getElementById("templates-list").addEventListener("click", async e => {
  const btn = e.target.closest("[data-activate-template]");
  if (!btn) return;
  const err = await activateContractTemplate(btn.dataset.activateTemplate);
  if (err) { console.error("Erro ao ativar modelo:", err); templatesSetError(t("contracts.proposalCreateError")); return; }
  await loadContractTemplates();
  renderTemplatesList();
});

document.getElementById("template-html").addEventListener("input", () => {
  const vars = contratoVariaveis(document.getElementById("template-html").value);
  const box = document.getElementById("template-vars");
  if (!vars.length) { box.style.display = "none"; return; }
  const unknown = vars.filter(v => !CONTRATO_VARS_CONHECIDAS.includes(v));
  box.textContent = `${t("contracts.templateUsed")} ${vars.join(", ")}.${unknown.length ? ` ${t("contracts.templateUnknown")} ${unknown.join(", ")}.` : ""}`;
  box.style.display = "block";
});

document.getElementById("template-preview").addEventListener("click", () => {
  const html = document.getElementById("template-html").value;
  if (!html.trim()) return;
  const sample = {
    nome: "Maria Exemplo da Silva", cpf: "000.000.000-00", documento: "AB123456", data_nascimento: "1995-05-20", nacionalidade: "Brasileira",
    endereco: "Rua das Flores, 100, ap. 12, Centro", cidade_estado: "Curitiba / PR", cep: "80000-000", telefone: "+55 41 99999-0000",
    email: "maria@email.com", contato_emergencia_nome: "João Exemplo", contato_emergencia_telefone: "+55 41 98888-0000",
  };
  const cot = { numero: "2026-0001", client: sample.nome, items_detail: [{ nome: "Curso exemplo", qtd: 25, preco: 100, total: 2500, subs: [{ nome: "Material", valor: 0 }] }], value: 2500, emissao: new Date().toISOString().slice(0, 10), consultor_name: "Consultor" };
  const ctx = contratoContexto({ dados: sample, numero: "2026-0001", cotacao: cot });
  const frame = document.getElementById("template-frame");
  frame.style.display = "";
  frame.srcdoc = contratoMontarDocumento({ templateHtml: html, ctx, cotacao: cot, marcarPendentes: true });
});

document.getElementById("template-save").addEventListener("click", async () => {
  templatesSetError("");
  const nome = document.getElementById("template-name").value.trim();
  const html = document.getElementById("template-html").value;
  if (!nome || !html.trim()) { templatesSetError(t("contracts.templateEmpty")); return; }
  const versao = contractTemplates.filter(tp => tp.nome === nome).reduce((m, tp) => Math.max(m, tp.versao), 0) + 1;
  const { data, error } = await supabase.from("contract_templates").insert({ nome, versao, html, ativo: false, created_by: session.id }).select().single();
  if (error || !data) { console.error("Erro ao salvar modelo:", error); templatesSetError(t("contracts.proposalCreateError")); return; }
  if (document.getElementById("template-activate").checked) {
    const err = await activateContractTemplate(data.id);
    if (err) { console.error("Erro ao ativar modelo:", err); templatesSetError(t("contracts.proposalCreateError")); }
  }
  await loadContractTemplates();
  renderTemplatesList();
  document.getElementById("template-html").value = "";
  alert(t("contracts.templateSaved"));
});

/* só o ADM vê o botão de modelos */
function initContractTemplatesButton() {
  document.getElementById("btn-contract-templates").style.display = session && session.role === "ADM" ? "" : "none";
}


/* ============================================================
   NOVO CONTRATO = ESCOLHER UMA COTAÇÃO
   Não existe contrato sem cotação: a busca lista as cotações criadas
   e só segue adiante a que pode gerar contrato (aprovada, ligada a
   um lead e sem outro contrato ativo).
   ============================================================ */
const cqpickBackdrop = document.getElementById("cqpick-backdrop");

/* devolve o motivo de a cotação ainda não poder gerar contrato (ou null) */
function contractQuoteBlocker(q) {
  if (contracts.some(c => c.quoteId === q.id && c.status !== "Cancelado")) return "has-contract";
  if (q.status !== "Aprovada") return t("quotes.needApprovedForContract");
  if (!q.leadId) return t("quotes.needLeadForContract");
  return null;
}

function renderContractQuotePicker() {
  const term = document.getElementById("cqpick-search").value.trim().toLowerCase();
  const list = quotes.filter(q => {
    if (!term) return true;
    return [q.client, q.email, q.consultorName, q.numero].join(" ").toLowerCase().includes(term);
  }).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  const el = document.getElementById("cqpick-list");
  if (!list.length) { el.innerHTML = `<p class="muted-note">${escapeHtml(t("contracts.pickQuoteEmpty"))}</p>`; return; }
  el.innerHTML = list.map(q => {
    const block = contractQuoteBlocker(q);
    const note = block === "has-contract" ? t("contracts.quoteHasContract") : block;
    return `
      <button type="button" class="cqpick-row${block ? " blocked" : ""}" data-quote="${q.id}">
        <span class="cqpick-num">${escapeHtml(q.numero || "—")}</span>
        <span class="cqpick-main"><b>${escapeHtml(q.client)}</b><small>${escapeHtml(q.email || "")}${q.consultorName ? ` · ${escapeHtml(q.consultorName)}` : ""}</small></span>
        <span class="cell-muted">${currency(q.value)}</span>
        <span class="badge ${q.status === "Aprovada" ? "badge-good" : "badge-neutral"}">${escapeHtml(statusLabel(q.status))}</span>
        ${note ? `<span class="cqpick-note">${escapeHtml(note)}</span>` : ""}
      </button>`;
  }).join("");
}

function openContractQuotePicker() {
  document.getElementById("cqpick-search").value = "";
  renderContractQuotePicker();
  cqpickBackdrop.classList.add("open");
  document.getElementById("cqpick-search").focus();
}
document.getElementById("btn-new-contract").addEventListener("click", openContractQuotePicker);
document.getElementById("cqpick-close").addEventListener("click", () => cqpickBackdrop.classList.remove("open"));
cqpickBackdrop.addEventListener("click", e => { if (e.target === cqpickBackdrop) cqpickBackdrop.classList.remove("open"); });
document.getElementById("cqpick-search").addEventListener("input", renderContractQuotePicker);

document.getElementById("cqpick-list").addEventListener("click", e => {
  const row = e.target.closest("[data-quote]");
  if (!row) return;
  const q = quotes.find(x => x.id === row.dataset.quote);
  if (!q) return;
  const block = contractQuoteBlocker(q);
  if (block === "has-contract") {
    const c = contracts.find(x => x.quoteId === q.id && x.status !== "Cancelado");
    cqpickBackdrop.classList.remove("open");
    if (c.modo === "proposta") openProposalManage(c.id); else openContractModal(c.id);
    return;
  }
  if (block) { alert(block); return; }
  cqpickBackdrop.classList.remove("open");
  openProposalForQuote(q);
});
