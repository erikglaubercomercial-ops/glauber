/* ============================================================
   TEMPLATES DE E-MAIL (menu Templates)
   Modelos padrão para todos os consultores: escolher, copiar e colar no e-mail.
   Variáveis: {{nome}}, {{primeiro_nome}}, {{consultor}}, {{email_consultor}} — o consultor
   vem do usuário logado; o cliente vem do lead escolhido no topo (sem lead, fica o marcador
   [nome do cliente] para preencher). Só o ADM cria, edita, duplica e exclui.
   Depende de script.js: session, leads, users, uid, escapeHtml, agendaToast, visibleLeadsBase.
   ============================================================ */

let emailTemplates = [];
let etLoaded = false;
const et = { cat: "", query: "", lead: null, focus: null };

const ET_VARS = [
  ["{{primeiro_nome}}", "Primeiro nome do cliente"],
  ["{{nome}}", "Nome completo do cliente"],
  ["{{consultor}}", "Seu nome"],
  ["{{email_consultor}}", "Seu e-mail"],
];
const etIsAdmin = () => !!(session && session.role === "ADM") && !(typeof viewAs !== "undefined" && viewAs.active);

async function loadEmailTemplates() {
  const { data, error } = await supabase.from("email_templates").select("*").order("ordem").order("created_at");
  if (error) { console.error("Erro ao carregar templates de e-mail:", error); return null; }
  return data;
}
async function etSave(row) {
  const { error } = await supabase.from("email_templates").upsert(row);
  if (error) console.error("Erro ao salvar template:", error);
  return !error;
}

/* troca as variáveis pelos dados do consultor logado e do lead escolhido */
function etFill(text) {
  const lead = et.lead ? leads.find(l => l.id === et.lead) : null;
  const nome = lead ? lead.name : "[nome do cliente]";
  const primeiro = lead ? String(lead.name || "").trim().split(/\s+/)[0] : "[primeiro nome]";
  return String(text || "")
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, primeiro)
    .replace(/\{\{\s*nome\s*\}\}/gi, nome)
    .replace(/\{\{\s*consultor\s*\}\}/gi, (session && session.name) || "")
    .replace(/\{\{\s*email_consultor\s*\}\}/gi, (session && session.email) || "");
}

async function etCopy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  if (btn) { const old = btn.textContent; btn.textContent = "Copiado ✓"; setTimeout(() => { btn.textContent = old; }, 1400); }
}

async function renderEmailTemplates() {
  const admin = etIsAdmin();
  document.getElementById("et-new").style.display = admin ? "" : "none";
  if (!etLoaded) {
    document.getElementById("et-list").innerHTML = `<p class="muted-note">Carregando…</p>`;
    const rows = await loadEmailTemplates();
    if (rows === null) { document.getElementById("et-list").innerHTML = `<p class="muted-note">Não foi possível carregar os templates agora.</p>`; return; }
    emailTemplates = rows; etLoaded = true;
  }
  etRenderList();
}

function etRenderList() {
  const admin = etIsAdmin();
  const list = emailTemplates.filter(x => admin || x.ativo);
  const cats = [...new Set(list.map(x => x.categoria).filter(Boolean))];
  document.getElementById("et-cats").innerHTML =
    `<button type="button" class="et-chip${et.cat ? "" : " on"}" data-cat="">Todos</button>` +
    cats.map(c => `<button type="button" class="et-chip${et.cat === c ? " on" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");
  const q = et.query.trim().toLowerCase();
  const shown = list.filter(x => (!et.cat || x.categoria === et.cat) && (!q || [x.titulo, x.assunto, x.corpo, x.categoria].join(" ").toLowerCase().includes(q)));
  const lead = et.lead ? leads.find(l => l.id === et.lead) : null;
  const box = document.getElementById("et-list");
  if (!shown.length) { box.innerHTML = `<p class="muted-note">${list.length ? "Nenhum template encontrado." : "Ainda não há templates cadastrados."}</p>`; return; }
  box.innerHTML = shown.map(x => {
    const subject = etFill(x.assunto), body = etFill(x.corpo);
    const mailto = lead && lead.email ? `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : "";
    return `
      <article class="et-card${x.ativo ? "" : " off"}" data-id="${x.id}">
        <div class="et-card-top">
          <span class="et-cat">${escapeHtml(x.categoria)}</span>
          ${x.ativo ? "" : `<span class="prod-tag">oculto</span>`}
        </div>
        <h3>${escapeHtml(x.titulo)}</h3>
        <div class="et-subject"><small>Assunto</small>${escapeHtml(subject)}</div>
        <pre class="et-body">${escapeHtml(body)}</pre>
        <div class="et-actions">
          <button type="button" class="btn btn-primary btn-sm" data-et="copy-all">Copiar tudo</button>
          <button type="button" class="btn btn-ghost btn-sm" data-et="copy-subject">Copiar assunto</button>
          <button type="button" class="btn btn-ghost btn-sm" data-et="copy-body">Copiar texto</button>
          ${mailto ? `<a class="btn btn-ghost btn-sm" href="${mailto}">Abrir no e-mail</a>` : ""}
          ${admin ? `<span class="et-admin">
            <button type="button" class="btn btn-ghost btn-sm" data-et="edit">Editar</button>
            <button type="button" class="btn btn-ghost btn-sm" data-et="dup">Duplicar</button>
            <button type="button" class="btn btn-danger btn-sm" data-et="del">Excluir</button></span>` : ""}
        </div>
      </article>`;
  }).join("");
}

/* ---- busca de lead para preencher o nome ---- */
function etRenderLeadResults(q) {
  const box = document.getElementById("et-lead-results");
  q = q.trim().toLowerCase();
  if (!q) { box.classList.remove("open"); box.innerHTML = ""; return; }
  const base = typeof visibleLeadsBase === "function" ? visibleLeadsBase() : leads;
  const m = base.filter(l => (l.name || "").toLowerCase().includes(q) || (l.email || "").toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = m.length
    ? m.map(l => `<div class="enr-lead-result-item" data-id="${l.id}"><div>${escapeHtml(l.name)}</div><div class="sub">${escapeHtml(l.email || l.phone || "")}</div></div>`).join("")
    : `<div class="enr-lead-result-empty">Nenhum lead encontrado.</div>`;
  box.classList.add("open");
}
function etSetLead(id) {
  et.lead = id || null;
  const lead = id ? leads.find(l => l.id === id) : null;
  document.getElementById("et-lead-input").value = lead ? lead.name : "";
  document.getElementById("et-lead-clear").style.display = lead ? "" : "none";
  document.getElementById("et-lead-results").classList.remove("open");
  etRenderList();
}

/* ---- modal (ADM) ---- */
const etModal = () => document.getElementById("et-modal-backdrop");
function etOpenModal(id) {
  const x = id ? emailTemplates.find(t => t.id === id) : null;
  document.getElementById("et-modal-title").textContent = x ? "Editar template" : "Novo template";
  document.getElementById("et-id").value = x ? x.id : "";
  document.getElementById("et-f-titulo").value = x ? x.titulo : "";
  document.getElementById("et-f-categoria").value = x ? x.categoria : (et.cat || "Geral");
  document.getElementById("et-f-assunto").value = x ? x.assunto : "";
  document.getElementById("et-f-corpo").value = x ? x.corpo : "";
  document.getElementById("et-f-ordem").value = x ? x.ordem : (emailTemplates.reduce((m, t) => Math.max(m, t.ordem || 0), 0) + 10);
  document.getElementById("et-f-ativo").checked = x ? x.ativo : true;
  document.getElementById("et-cat-list").innerHTML = [...new Set(emailTemplates.map(t => t.categoria))].map(c => `<option value="${escapeHtml(c)}">`).join("");
  document.getElementById("et-f-delete").style.display = x ? "" : "none";
  etModal().classList.add("open");
  document.getElementById("et-f-titulo").focus();
}
const etCloseModal = () => etModal().classList.remove("open");

(function etBind() {
  const root = document.getElementById("view-templates");
  if (!root) return;

  document.getElementById("et-new").addEventListener("click", () => etOpenModal(null));
  document.getElementById("et-search").addEventListener("input", e => { et.query = e.target.value; etRenderList(); });
  document.getElementById("et-cats").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]");
    if (b) { et.cat = b.dataset.cat; etRenderList(); }
  });
  const leadInput = document.getElementById("et-lead-input");
  leadInput.addEventListener("input", () => { if (et.lead) { et.lead = null; etRenderList(); } document.getElementById("et-lead-clear").style.display = leadInput.value ? "" : "none"; etRenderLeadResults(leadInput.value); });
  document.getElementById("et-lead-results").addEventListener("click", e => {
    const it = e.target.closest(".enr-lead-result-item");
    if (it) etSetLead(it.dataset.id);
  });
  document.getElementById("et-lead-clear").addEventListener("click", () => etSetLead(null));
  document.addEventListener("click", e => { if (!e.target.closest(".et-lead-wrap")) document.getElementById("et-lead-results").classList.remove("open"); });

  document.getElementById("et-list").addEventListener("click", async e => {
    const b = e.target.closest("[data-et]");
    if (!b) return;
    const card = b.closest(".et-card");
    const x = emailTemplates.find(t => t.id === card.dataset.id);
    if (!x) return;
    const subject = etFill(x.assunto), body = etFill(x.corpo);
    const act = b.dataset.et;
    if (act === "copy-all") etCopy(`Assunto: ${subject}\n\n${body}`, b);
    else if (act === "copy-subject") etCopy(subject, b);
    else if (act === "copy-body") etCopy(body, b);
    else if (!etIsAdmin()) return;
    else if (act === "edit") etOpenModal(x.id);
    else if (act === "dup") {
      const copy = { ...x, id: uid(), titulo: `${x.titulo} (cópia)`, ordem: emailTemplates.reduce((m, t) => Math.max(m, t.ordem || 0), 0) + 10, created_by: session.id, updated_at: new Date().toISOString() };
      delete copy.created_at;
      emailTemplates.push(copy);
      etRenderList();
      if (await etSave(copy)) etOpenModal(copy.id);
    } else if (act === "del") {
      if (!confirm(`Excluir o template "${x.titulo}"?`)) return;
      emailTemplates = emailTemplates.filter(t => t.id !== x.id);
      etRenderList();
      const { error } = await supabase.from("email_templates").delete().eq("id", x.id);
      if (error) { console.error(error); etLoaded = false; renderEmailTemplates(); }
    }
  });

  /* modal */
  document.getElementById("et-modal-close").addEventListener("click", etCloseModal);
  document.getElementById("et-f-cancel").addEventListener("click", etCloseModal);
  etModal().addEventListener("click", e => { if (e.target === etModal()) etCloseModal(); });
  ["et-f-assunto", "et-f-corpo"].forEach(id => document.getElementById(id).addEventListener("focus", () => { et.focus = id; }));
  document.getElementById("et-vars").addEventListener("click", e => {
    const b = e.target.closest("[data-var]");
    if (!b) return;
    const el = document.getElementById(et.focus || "et-f-corpo");
    const s = el.selectionStart ?? el.value.length, en = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, s) + b.dataset.var + el.value.slice(en);
    el.focus(); el.selectionStart = el.selectionEnd = s + b.dataset.var.length;
  });
  document.getElementById("et-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!etIsAdmin()) return;
    const id = document.getElementById("et-id").value || uid();
    const old = emailTemplates.find(t => t.id === id);
    const row = {
      id, titulo: document.getElementById("et-f-titulo").value.trim(),
      categoria: document.getElementById("et-f-categoria").value.trim() || "Geral",
      assunto: document.getElementById("et-f-assunto").value.trim(),
      corpo: document.getElementById("et-f-corpo").value.replace(/\r\n/g, "\n").trim(),
      ordem: parseInt(document.getElementById("et-f-ordem").value, 10) || 100,
      ativo: document.getElementById("et-f-ativo").checked,
      updated_at: new Date().toISOString(),
    };
    if (!old) row.created_by = session.id;
    if (!row.titulo) return;
    if (old) Object.assign(old, row); else emailTemplates.push({ ...row, created_at: new Date().toISOString() });
    emailTemplates.sort((a, b) => (a.ordem - b.ordem));
    etCloseModal();
    etRenderList();
    if (!(await etSave(row))) { alert("Não foi possível salvar o template."); etLoaded = false; renderEmailTemplates(); }
  });
  document.getElementById("et-f-delete").addEventListener("click", () => {
    const id = document.getElementById("et-id").value;
    etCloseModal();
    const card = document.querySelector(`.et-card[data-id="${id}"] [data-et="del"]`);
    if (card) card.click();
  });
  document.getElementById("et-vars").innerHTML = ET_VARS.map(([v, d]) => `<button type="button" class="btn btn-ghost btn-sm" data-var="${v}" title="${d}">${v}</button>`).join("");
})();
