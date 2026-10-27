/* ============================================================
   FINANCEIRO · ACOMODAÇÃO — controle das vendas de acomodação.
   Por venda (ligada a uma matrícula): valor vendido, custo, valor já enviado
   à acomodação (vários envios) e comissão do consultor.
     • Lucro    = vendido − custo
     • Comissão = % do consultor (padrão 40) sobre o lucro
     • A comissão só pode ser paga quando o total enviado cobrir o custo
       (o banco também bloqueia — migração 078).
   Depende de script.js: enrollments, users, supabase, currency, escapeHtml,
   formatDate, leadLink, round2, t.
   ============================================================ */

let accSales = [];
let accTransfers = [];
let accLoaded = false;
const ACC_DEFAULT_PCT = 40;

function accSaleFromDb(r) {
  return { id: r.id, enrollmentId: r.enrollment_id, description: r.description || "", sold: Number(r.sold_amount) || 0,
    cost: Number(r.cost_amount) || 0, pct: Number(r.commission_pct), status: r.commission_status, paidAt: r.commission_paid_at,
    notes: r.notes || "", createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now() };
}
function accSaleToDb(x) {
  return { id: x.id, enrollment_id: x.enrollmentId, description: x.description, sold_amount: x.sold, cost_amount: x.cost,
    commission_pct: x.pct, commission_status: x.status, commission_paid_at: x.paidAt || null, notes: x.notes };
}
function accTransferFromDb(r) {
  return { id: r.id, accId: r.accommodation_id, amount: Number(r.amount) || 0, sentAt: r.sent_at, notes: r.notes || "",
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now() };
}

async function accLoad() {
  const [s, tr] = await Promise.all([
    supabase.from("accommodation_sales").select("*").order("created_at", { ascending: false }),
    supabase.from("accommodation_transfers").select("*").order("sent_at", { ascending: false }),
  ]);
  if (s.error || tr.error) { console.error("Erro ao carregar acomodação:", s.error || tr.error); return; }
  accSales = s.data.map(accSaleFromDb);
  accTransfers = tr.data.map(accTransferFromDb);
  accLoaded = true;
}

/* números de uma venda */
function accCalc(s) {
  const sent = accTransfers.filter(x => x.accId === s.id).reduce((a, x) => a + x.amount, 0);
  const profit = round2(s.sold - s.cost);
  const commission = round2(Math.max(0, profit) * (s.pct / 100));
  return { sent: round2(sent), toSend: round2(Math.max(0, s.cost - sent)), profit, commission, released: sent + 0.001 >= s.cost };
}

const accEnr = id => enrollments.find(e => e.id === id) || {};
const accLabel = s => { const e = accEnr(s.enrollmentId); return `${e.name || "—"}${s.description ? " — " + s.description : ""}`; };

function accRender() {
  const root = document.getElementById("acc-root");
  if (!root) return;
  const q = (document.getElementById("acc-search") || {}).value || "";
  const nq = q.trim().toLowerCase();
  const sales = accSales.filter(s => !nq || accLabel(s).toLowerCase().includes(nq));
  const calcs = new Map(accSales.map(s => [s.id, accCalc(s)]));
  const sum = (list, f) => round2(list.reduce((a, s) => a + f(s, calcs.get(s.id)), 0));
  const kSold = sum(sales, s => s.sold), kCost = sum(sales, s => s.cost), kProfit = sum(sales, (s, c) => c.profit);
  const kSent = sum(sales, (s, c) => c.sent), kToSend = sum(sales, (s, c) => c.toSend);
  const kComm = sum(sales, (s, c) => c.commission);
  const kCommOpen = sum(sales.filter(s => s.status !== "Pago"), (s, c) => c.commission);
  const card = (label, value, cls) => `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-value ${cls || ""}">${currency(value)}</span></div>`;

  const rows = sales.map(s => {
    const c = calcs.get(s.id), e = accEnr(s.enrollmentId);
    const cons = users.find(u => u.id === e.consultorId);
    /* venda criada sozinha pelo contrato assinado: o custo ainda não foi informado, então a comissão não pode ser paga */
    const needCost = s.status !== "Pago" && s.cost === 0 && s.sold > 0;
    const state = s.status === "Pago" ? '<span class="badge badge-good">Paga</span>'
      : (needCost ? '<span class="badge badge-warn" title="Abra a venda e informe o custo da acomodação para calcular o lucro e a comissão">Informe o custo</span>'
        : (c.released ? '<span class="badge badge-good">Liberada</span>'
          : `<span class="badge badge-warn" title="Libera quando o total enviado à acomodação cobrir o custo">Falta enviar ${currency(c.toSend)}</span>`));
    const payBtn = s.status === "Pago"
      ? `<button type="button" class="btn btn-ghost btn-sm" data-acc-act="unpay" data-id="${s.id}">Desfazer</button>`
      : (c.released && !needCost ? `<button type="button" class="btn btn-primary btn-sm" data-acc-act="pay" data-id="${s.id}">Marcar paga</button>` : "");
    return `<tr data-id="${s.id}">
      <td class="cell-primary">${leadLink(e.leadId, e.name || "—")}</td>
      <td class="cell-muted">${escapeHtml(cons ? cons.name : "—")}</td>
      <td class="cell-muted">${escapeHtml(s.description || "—")}</td>
      <td class="cell-primary">${currency(s.sold)}</td>
      <td class="cell-muted">${currency(s.cost)}</td>
      <td class="cell-primary ${c.profit < 0 ? "neg" : ""}">${currency(c.profit)}</td>
      <td class="cell-muted">${currency(c.sent)}</td>
      <td class="cell-primary">${currency(c.commission)} <span class="muted-note">(${s.pct}%)</span></td>
      <td class="cell-muted">${state}</td>
      <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-acc-act="send" data-id="${s.id}">+ Envio</button> ${payBtn}</td>
    </tr>`;
  }).join("");

  const sends = accTransfers.filter(x => sales.some(s => s.id === x.accId)).map(x => {
    const s = accSales.find(v => v.id === x.accId), e = accEnr(s.enrollmentId);
    return `<tr data-send="${x.id}">
      <td class="cell-muted">${x.sentAt ? formatDate(x.sentAt) : "—"}</td>
      <td class="cell-primary">${leadLink(e.leadId, e.name || "—")}</td>
      <td class="cell-muted">${escapeHtml(s.description || "—")}</td>
      <td class="cell-primary">${currency(x.amount)}</td>
      <td class="cell-muted">${escapeHtml(x.notes || "—")}</td>
      <td class="cell-actions">›</td></tr>`;
  }).join("");

  root.innerHTML = `
    <div class="stat-row">
      ${card("Vendido", kSold)}${card("Custo", kCost)}${card("Lucro", kProfit, kProfit < 0 ? "neg" : "stat-good")}
      ${card("Enviado à acomodação", kSent)}${card("Falta enviar", kToSend)}${card("Comissão consultores", kComm)}${card("Comissão a pagar", kCommOpen)}
    </div>
    <div class="panel">
      <div class="panel-header">
        <h2>Acomodação</h2>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="acc-search" placeholder="Buscar cliente ou acomodação" value="${escapeHtml(q)}" style="min-width:220px;">
          <button type="button" class="btn btn-primary btn-sm" id="acc-new">+ Nova venda de acomodação</button>
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>Cliente</th><th>Consultor</th><th>Acomodação</th><th>Vendido</th><th>Custo</th><th>Lucro</th><th>Enviado</th><th>Comissão consultor</th><th>Situação</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${sales.length ? "" : '<div class="empty-hint">Nenhuma venda de acomodação cadastrada ainda.</div>'}
      <h3 class="transfers-subtitle">Envios à acomodação</h3>
      <table class="data-table">
        <thead><tr><th>Data</th><th>Cliente</th><th>Acomodação</th><th>Valor</th><th>Notas</th><th></th></tr></thead>
        <tbody>${sends}</tbody>
      </table>
      ${accTransfers.length ? "" : '<div class="empty-hint">Nenhum envio à acomodação registrado ainda.</div>'}
    </div>`;

  const search = document.getElementById("acc-search");
  search.addEventListener("input", () => { accRender(); const s2 = document.getElementById("acc-search"); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); });
  document.getElementById("acc-new").addEventListener("click", () => accOpenSale(null));
  root.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", e => {
    if (e.target.closest("button, a")) return;
    accOpenSale(tr.dataset.id);
  }));
  root.querySelectorAll("tr[data-send]").forEach(tr => tr.addEventListener("click", () => accOpenSend(tr.dataset.send)));
  root.querySelectorAll("button[data-acc-act]").forEach(b => b.addEventListener("click", () => accAction(b.dataset.accAct, b.dataset.id)));
}

async function accAction(act, id) {
  const s = accSales.find(x => x.id === id);
  if (!s) return;
  if (act === "send") { accOpenSend(null, id); return; }
  const wasStatus = s.status, wasPaid = s.paidAt;
  s.status = act === "pay" ? "Pago" : "Pendente";
  s.paidAt = act === "pay" ? new Date().toISOString() : null;
  const { error } = await supabase.from("accommodation_sales").update({ commission_status: s.status, commission_paid_at: s.paidAt }).eq("id", id);
  if (error) {
    s.status = wasStatus; s.paidAt = wasPaid;
    alert(/nao_liberada/.test(error.message || "") ? "Comissão ainda não liberada: o total enviado à acomodação precisa cobrir o custo." : "Não foi possível atualizar a comissão.");
  }
  accRender();
}

/* ---- modais (criados uma vez) ---- */
function accEnsureModals() {
  if (document.getElementById("acc-sale-backdrop")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <div class="modal-backdrop" id="acc-sale-backdrop"><div class="modal">
    <div class="modal-header"><h2 id="acc-sale-title">Nova venda de acomodação</h2><button class="btn-icon" id="acc-sale-close" type="button">&times;</button></div>
    <form id="acc-sale-form">
      <input type="hidden" id="acc-sale-id">
      <label><span>Cliente (matrícula)</span><select id="acc-sale-enr" required></select></label>
      <label><span>Acomodação (ex.: Homestay, Residência)</span><input type="text" id="acc-sale-desc" placeholder="Descrição"></label>
      <label><span>Valor vendido (€)</span><input type="number" id="acc-sale-sold" min="0" step="0.01" required></label>
      <label><span>Custo (€)</span><input type="number" id="acc-sale-cost" min="0" step="0.01" required></label>
      <label><span>Comissão do consultor (% do lucro)</span><input type="number" id="acc-sale-pct" min="0" max="100" step="0.1" required></label>
      <div class="muted-note" id="acc-sale-preview" style="margin:4px 0 8px;"></div>
      <label><span>Notas</span><textarea id="acc-sale-notes" rows="2"></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-danger" id="acc-sale-delete" style="display:none;">Excluir</button>
        <button type="button" class="btn btn-ghost" id="acc-sale-dup" style="display:none;">Duplicar</button>
        <div class="spacer"></div>
        <button type="button" class="btn btn-ghost" id="acc-sale-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form></div></div>
  <div class="modal-backdrop" id="acc-send-backdrop"><div class="modal">
    <div class="modal-header"><h2 id="acc-send-title">Registrar envio à acomodação</h2><button class="btn-icon" id="acc-send-close" type="button">&times;</button></div>
    <form id="acc-send-form">
      <input type="hidden" id="acc-send-id">
      <label><span>Venda de acomodação</span><select id="acc-send-acc" required></select></label>
      <label><span>Valor (€)</span><input type="number" id="acc-send-amount" min="0.01" step="0.01" required></label>
      <label><span>Data do envio</span><input type="date" id="acc-send-date" required></label>
      <label><span>Notas</span><textarea id="acc-send-notes" rows="2"></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-danger" id="acc-send-delete" style="display:none;">Excluir</button>
        <button type="button" class="btn btn-ghost" id="acc-send-dup" style="display:none;">Duplicar</button>
        <div class="spacer"></div>
        <button type="button" class="btn btn-ghost" id="acc-send-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form></div></div>`;
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  const $ = id => document.getElementById(id);
  const closeSale = () => $("acc-sale-backdrop").classList.remove("open");
  const closeSend = () => $("acc-send-backdrop").classList.remove("open");
  ["acc-sale-close", "acc-sale-cancel"].forEach(i => $(i).addEventListener("click", closeSale));
  ["acc-send-close", "acc-send-cancel"].forEach(i => $(i).addEventListener("click", closeSend));
  $("acc-sale-backdrop").addEventListener("click", e => { if (e.target.id === "acc-sale-backdrop") closeSale(); });
  $("acc-send-backdrop").addEventListener("click", e => { if (e.target.id === "acc-send-backdrop") closeSend(); });

  const preview = () => {
    const sold = parseFloat($("acc-sale-sold").value) || 0, cost = parseFloat($("acc-sale-cost").value) || 0, pct = parseFloat($("acc-sale-pct").value) || 0;
    const profit = round2(sold - cost), comm = round2(Math.max(0, profit) * pct / 100);
    $("acc-sale-preview").textContent = `Lucro ${currency(profit)} · comissão do consultor ${currency(comm)} · fica para a Peregrinos ${currency(round2(profit - comm))}`;
  };
  ["acc-sale-sold", "acc-sale-cost", "acc-sale-pct"].forEach(i => $(i).addEventListener("input", preview));
  window.accPreview = preview;

  const saveSale = async (idOverride) => {
    const id = idOverride || $("acc-sale-id").value;
    const old = id ? accSales.find(v => v.id === id) : null;
    const data = {
      id: id || crypto.randomUUID(), enrollmentId: $("acc-sale-enr").value, description: $("acc-sale-desc").value.trim(),
      sold: round2(parseFloat($("acc-sale-sold").value)), cost: round2(parseFloat($("acc-sale-cost").value)),
      pct: parseFloat($("acc-sale-pct").value), status: old ? old.status : "Pendente", paidAt: old ? old.paidAt : null,
      notes: $("acc-sale-notes").value.trim(), createdAt: old ? old.createdAt : Date.now(),
    };
    if (!data.enrollmentId || !(data.sold >= 0) || !(data.cost >= 0) || !(data.pct >= 0 && data.pct <= 100)) return false;
    const { error } = await supabase.from("accommodation_sales").upsert(accSaleToDb(data));
    if (error) { console.error(error); alert(/nao_liberada/.test(error.message || "") ? "Esta comissão já está paga e o custo novo ainda não foi totalmente enviado." : "Não foi possível salvar a venda de acomodação."); return false; }
    if (old) Object.assign(old, data); else accSales.unshift(data);
    return true;
  };
  $("acc-sale-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (await saveSale()) { closeSale(); accRender(); }
  });
  $("acc-sale-dup").addEventListener("click", async () => {
    $("acc-sale-id").value = "";
    if (await saveSale("")) { closeSale(); accRender(); }
  });
  $("acc-sale-delete").addEventListener("click", async () => {
    const id = $("acc-sale-id").value;
    if (!id || !confirm("Excluir esta venda de acomodação e os envios ligados a ela?")) return;
    const { error } = await supabase.from("accommodation_sales").delete().eq("id", id);
    if (error) { alert("Não foi possível excluir."); return; }
    accSales = accSales.filter(v => v.id !== id);
    accTransfers = accTransfers.filter(v => v.accId !== id);
    closeSale(); accRender();
  });

  const saveSend = async (forceNew) => {
    const id = forceNew ? "" : $("acc-send-id").value;
    const old = id ? accTransfers.find(v => v.id === id) : null;
    const data = { id: id || crypto.randomUUID(), accId: $("acc-send-acc").value, amount: round2(parseFloat($("acc-send-amount").value)),
      sentAt: $("acc-send-date").value, notes: $("acc-send-notes").value.trim(), createdAt: old ? old.createdAt : Date.now() };
    if (!data.accId || !(data.amount > 0) || !data.sentAt) return false;
    const { error } = await supabase.from("accommodation_transfers").upsert({ id: data.id, accommodation_id: data.accId, amount: data.amount, sent_at: data.sentAt, notes: data.notes });
    if (error) { console.error(error); alert("Não foi possível salvar o envio."); return false; }
    if (old) Object.assign(old, data); else accTransfers.unshift(data);
    return true;
  };
  $("acc-send-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (await saveSend(false)) { closeSend(); accRender(); }
  });
  $("acc-send-dup").addEventListener("click", async () => {
    if (await saveSend(true)) { closeSend(); accRender(); }
  });
  $("acc-send-delete").addEventListener("click", async () => {
    const id = $("acc-send-id").value;
    if (!id || !confirm("Excluir este envio?")) return;
    const { error } = await supabase.from("accommodation_transfers").delete().eq("id", id);
    if (error) { alert("Não foi possível excluir."); return; }
    accTransfers = accTransfers.filter(v => v.id !== id);
    closeSend(); accRender();
  });
}

function accOpenSale(id) {
  accEnsureModals();
  const $ = i => document.getElementById(i);
  const s = id ? accSales.find(v => v.id === id) : null;
  $("acc-sale-form").reset();
  $("acc-sale-enr").innerHTML = enrollments.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map(e => `<option value="${e.id}">${escapeHtml(e.name || "—")}${e.school ? " — " + escapeHtml(e.school) : ""}</option>`).join("");
  $("acc-sale-title").textContent = s ? "Editar venda de acomodação" : "Nova venda de acomodação";
  $("acc-sale-id").value = s ? s.id : "";
  if (s) $("acc-sale-enr").value = s.enrollmentId;
  $("acc-sale-desc").value = s ? s.description : "";
  $("acc-sale-sold").value = s ? s.sold : "";
  $("acc-sale-cost").value = s ? s.cost : "";
  $("acc-sale-pct").value = s ? s.pct : ACC_DEFAULT_PCT;
  $("acc-sale-notes").value = s ? s.notes : "";
  $("acc-sale-delete").style.display = s ? "inline-block" : "none";
  $("acc-sale-dup").style.display = s ? "inline-block" : "none";
  window.accPreview();
  $("acc-sale-backdrop").classList.add("open");
}

function accOpenSend(id, accId) {
  accEnsureModals();
  const $ = i => document.getElementById(i);
  const x = id ? accTransfers.find(v => v.id === id) : null;
  $("acc-send-form").reset();
  $("acc-send-acc").innerHTML = accSales.map(s => `<option value="${s.id}">${escapeHtml(accLabel(s))}</option>`).join("");
  $("acc-send-title").textContent = x ? "Editar envio à acomodação" : "Registrar envio à acomodação";
  $("acc-send-id").value = x ? x.id : "";
  if (x || accId) $("acc-send-acc").value = x ? x.accId : accId;
  $("acc-send-amount").value = x ? x.amount : "";
  $("acc-send-date").value = x ? x.sentAt : new Date().toISOString().slice(0, 10);
  $("acc-send-notes").value = x ? x.notes : "";
  $("acc-send-delete").style.display = x ? "inline-block" : "none";
  $("acc-send-dup").style.display = x ? "inline-block" : "none";
  $("acc-send-backdrop").classList.add("open");
}

/* abre a sub-aba: recarrega do banco e desenha */
async function accShow() {
  const root = document.getElementById("acc-root");
  if (root && !accLoaded) root.innerHTML = '<div class="empty-hint">Carregando…</div>';
  await accLoad();
  accRender();
}
document.addEventListener("click", e => {
  const b = e.target.closest('#financeiro-subtabs [data-fin-subtab="acomodacao"]');
  if (b) accShow();
});
