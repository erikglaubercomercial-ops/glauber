/* ============================================================
   COMPROVANTES DE PAGAMENTO — popup para ADM e Financeiro.
   O aluno envia o comprovante pelo portal; aqui a equipe CONFERE NA CONTA BANCÁRIA
   se o dinheiro caiu. Só depois de confirmar (rpc confirmar_comprovante) as parcelas são
   baixadas e os valores pagos/restantes mudam. Recusar não altera nenhum valor.
   • Consulta a fila a cada 20 s (rpc comprovantes_pendentes) e abre o popup sozinho
     quando chega comprovante novo; "Ver depois" deixa um aviso fixo no canto da tela.
   • Só ADM e Financeiro. Em "Ver como…" (somente leitura) não aparece.
   Depende de script.js: session, supabase, currency, escapeHtml, formatDate, receivables,
   loadReceivables, renderReceivables, renderFinanceiroOverview e (ficha) fichaLoad.
   ============================================================ */

const cpState = { list: [], idx: 0, seen: new Set(), timer: null, busy: false, loadedOnce: false };
const cpEsc = s => escapeHtml(s == null ? "" : String(s));
const cpIsReviewer = () => typeof session !== "undefined" && !!session && (session.role === "ADM" || session.role === "Financeiro")
  && !(typeof viewAs !== "undefined" && viewAs.active);
const cpEuro = v => (typeof currency === "function" ? currency(v) : "€ " + Number(v).toFixed(2));
const cpToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

function cpEnsureDom() {
  if (document.getElementById("cp-backdrop")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <div class="modal-backdrop" id="cp-backdrop"><div class="modal cp-modal">
    <div class="modal-header"><h2>💶 Comprovante de pagamento para conferir</h2><button class="btn-icon" id="cp-close" type="button" title="Ver depois">&times;</button></div>
    <div id="cp-body"></div>
  </div></div>
  <button type="button" id="cp-pill" class="cp-pill" hidden></button>`;
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  document.getElementById("cp-close").addEventListener("click", cpClose);
  document.getElementById("cp-backdrop").addEventListener("click", e => { if (e.target.id === "cp-backdrop") cpClose(); });
  document.getElementById("cp-pill").addEventListener("click", () => { cpState.idx = 0; cpOpen(); });
}

function cpClose() {
  document.getElementById("cp-backdrop").classList.remove("open");
  cpUpdatePill();
}
function cpUpdatePill() {
  const pill = document.getElementById("cp-pill");
  if (!pill) return;
  const n = cpState.list.length;
  const open = document.getElementById("cp-backdrop").classList.contains("open");
  pill.hidden = !(n > 0 && !open);
  pill.textContent = `💶 ${n} comprovante${n > 1 ? "s" : ""} para conferir`;
}
function cpOpen() {
  cpEnsureDom();
  if (!cpState.list.length) { cpClose(); return; }
  if (cpState.idx >= cpState.list.length) cpState.idx = 0;
  cpRender();
  document.getElementById("cp-backdrop").classList.add("open");
  cpUpdatePill();
}

function cpRender() {
  const p = cpState.list[cpState.idx];
  const body = document.getElementById("cp-body");
  const open = (p.parcelas || []).filter(x => !x.pago);
  const nav = cpState.list.length > 1
    ? `<div class="cp-nav"><button type="button" class="btn btn-ghost btn-sm" data-cp-nav="-1">‹</button><span>${cpState.idx + 1} de ${cpState.list.length}</span><button type="button" class="btn btn-ghost btn-sm" data-cp-nav="1">›</button></div>` : "";
  const pend = open.reduce((s, x) => s + Number(x.valor || 0), 0);
  body.innerHTML = `${nav}
    <div class="cp-who"><b>${p.lead_id && typeof leadLink === "function" ? leadLink(p.lead_id, p.student) : cpEsc(p.student)}</b> <span class="fx-mu">${cpEsc(p.school || "")}</span></div>
    <div class="cp-info">
      <div><span>O aluno informou</span><b>${cpEuro(p.amount)}</b></div>
      <div><span>Data do pagamento</span><b>${p.paid_on ? new Date(p.paid_on + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</b></div>
      <div><span>Ainda em aberto</span><b>${cpEuro(pend)}</b></div>
    </div>
    ${p.note ? `<p class="muted-note">Observação do aluno: ${cpEsc(p.note)}</p>` : ""}
    <div class="fx-acts" style="margin-top:0;border-top:0;padding-top:0"><button type="button" class="btn btn-ghost btn-sm" id="cp-view">📎 Ver comprovante enviado${p.file_name ? " (" + cpEsc(p.file_name) + ")" : ""}</button></div>
    <form id="cp-form">
      <label><span>Parcela</span><select id="cp-rec">
        <option value="">Em ordem de vencimento</option>
        ${open.map(x => `<option value="${cpEsc(x.id)}" ${x.id === p.receivable_id ? "selected" : ""}>Parcela ${x.numero}/${x.total} · ${cpEuro(x.valor)} · vence ${new Date(x.vencimento + "T12:00:00").toLocaleDateString("pt-BR")}</option>`).join("")}
      </select></label>
      <div class="cp-grid">
        <label><span>Valor que entrou na conta (€)</span><input type="number" id="cp-amount" min="0.01" step="0.01" required value="${Number(p.amount)}"></label>
        <label><span>Data em que caiu</span><input type="date" id="cp-date" required value="${cpEsc(p.paid_on || cpToday())}" max="${cpToday()}"></label>
      </div>
      <label class="cp-check"><input type="checkbox" id="cp-ok"><span><b>Conferi no extrato do banco: o dinheiro caiu na conta.</b> Só confirme depois de ver o valor entrar. Ao confirmar, as parcelas são baixadas e os valores pagos e restantes são atualizados.</span></label>
      <p class="cp-error" id="cp-error" hidden></p>
      <div class="modal-actions"><div class="spacer"></div>
        <button type="button" class="btn btn-danger" id="cp-refuse">Não caiu / recusar</button>
        <button type="button" class="btn btn-ghost" id="cp-later">Ver depois</button>
        <button type="submit" class="btn btn-primary" id="cp-confirm" disabled>Confirmar recebimento</button></div>
    </form>`;
  const ok = document.getElementById("cp-ok"), confirmBtn = document.getElementById("cp-confirm");
  ok.addEventListener("change", () => { confirmBtn.disabled = !ok.checked; });
  document.getElementById("cp-later").addEventListener("click", cpClose);
  body.querySelectorAll("[data-cp-nav]").forEach(b => b.addEventListener("click", () => {
    cpState.idx = (cpState.idx + Number(b.dataset.cpNav) + cpState.list.length) % cpState.list.length; cpRender();
  }));
  document.getElementById("cp-view").addEventListener("click", async () => {
    const { data, error } = await supabase.storage.from("student-docs").createSignedUrl(p.file_path, 3600);
    if (error || !data) { cpShowError("Não foi possível abrir o comprovante."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  });
  document.getElementById("cp-form").addEventListener("submit", e => { e.preventDefault(); cpConfirm(p); });
  document.getElementById("cp-refuse").addEventListener("click", () => cpRefuse(p));
}

function cpShowError(msg) {
  const el = document.getElementById("cp-error");
  if (!el) { alert(msg); return; }
  el.textContent = msg; el.hidden = !msg;
}
const CP_ERRORS = {
  valor_maior_que_saldo: "O valor é maior que o total em aberto do aluno. Confira o valor que entrou na conta.",
  ja_revisado: "Este comprovante já foi conferido por outra pessoa.",
  sem_permissao: "Só ADM e Financeiro podem conferir comprovantes.",
  data_invalida: "A data não pode ser no futuro.",
  valor_invalido: "Informe o valor que entrou na conta.",
  sem_financeiro: "Este aluno ainda não tem parcelas lançadas no Financeiro.",
};
const cpErrText = err => { const m = (err && err.message) || ""; const k = Object.keys(CP_ERRORS).find(x => m.includes(x)); return k ? CP_ERRORS[k] : "Não foi possível concluir. Tente de novo."; };

async function cpAfterChange() {
  await cpRefresh(true);
  try {
    if (typeof loadReceivables === "function") { receivables = await loadReceivables(); }
    if (typeof renderReceivables === "function") renderReceivables();
    if (typeof renderFinanceiroOverview === "function") renderFinanceiroOverview();
    if (typeof renderCommissions === "function") renderCommissions();
    if (typeof fichaJson !== "undefined") { fichaJson = ""; if (typeof fichaLoad === "function") fichaLoad(); }
  } catch (err) { console.error(err); }
}

async function cpConfirm(p) {
  if (cpState.busy) return;
  const amount = Math.round(parseFloat(document.getElementById("cp-amount").value) * 100) / 100;
  const paidOn = document.getElementById("cp-date").value;
  if (!document.getElementById("cp-ok").checked || !(amount > 0) || !paidOn) return;
  cpState.busy = true;
  const btn = document.getElementById("cp-confirm");
  btn.disabled = true; btn.textContent = "Confirmando...";
  const { data, error } = await supabase.rpc("confirmar_comprovante", {
    p_proof: p.id, p_amount: amount, p_paid_on: paidOn, p_receivable: document.getElementById("cp-rec").value || null });
  cpState.busy = false;
  if (error) { console.error("Erro ao confirmar comprovante:", error); btn.textContent = "Confirmar recebimento"; btn.disabled = false; cpShowError(cpErrText(error)); if (/ja_revisado/.test(error.message || "")) await cpAfterChange(), cpOpen(); return; }
  if (typeof agendaToast === "function") agendaToast(`Recebimento confirmado — pago ${cpEuro(data.pago)}, falta ${cpEuro(data.pendente)}`);
  await cpAfterChange();
  if (cpState.list.length) cpOpen(); else cpClose();
}

async function cpRefuse(p) {
  const reason = prompt("Por que o comprovante não foi confirmado? (o aluno vai ver esse motivo)\n\nEx.: o valor não apareceu na conta.");
  if (reason === null) return;
  const { error } = await supabase.rpc("recusar_comprovante", { p_proof: p.id, p_reason: reason });
  if (error) { console.error("Erro ao recusar comprovante:", error); cpShowError(cpErrText(error)); return; }
  if (typeof agendaToast === "function") agendaToast("Comprovante recusado — nenhum valor foi alterado");
  await cpAfterChange();
  if (cpState.list.length) cpOpen(); else cpClose();
}

/* busca a fila; abre o popup sozinho quando aparece comprovante novo */
async function cpRefresh(silent) {
  if (!cpIsReviewer()) return;
  const { data, error } = await supabase.rpc("comprovantes_pendentes");
  if (error) { console.error("Erro ao buscar comprovantes:", error); return; }
  cpEnsureDom();
  cpState.list = Array.isArray(data) ? data : [];
  const fresh = cpState.list.filter(x => !cpState.seen.has(x.id));
  cpState.list.forEach(x => cpState.seen.add(x.id));
  const isOpen = document.getElementById("cp-backdrop").classList.contains("open");
  if (!silent && fresh.length && !isOpen) { cpState.idx = cpState.list.findIndex(x => x.id === fresh[0].id); cpOpen(); }
  else if (isOpen) { if (cpState.list.length) { cpState.idx = Math.min(cpState.idx, cpState.list.length - 1); } else cpClose(); }
  cpUpdatePill();
}

function cpStart() {
  if (cpState.timer) return;
  cpState.timer = setInterval(() => { if (document.visibilityState === "visible") cpRefresh(false); }, 20000);
  cpRefresh(false);
}
/* espera o login do CRM terminar; depois só precisa conferir o perfil */
(function cpBoot() {
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (cpIsReviewer()) { clearInterval(iv); cpStart(); }
    else if (tries > 60) clearInterval(iv);
  }, 1000);
})();
