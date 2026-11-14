/* ============================================================
   MENSAGENS INTERNAS — caixa de entrada entre usuários do CRM
   • Qualquer usuário ativo envia para uma ou mais pessoas (ou para todos).
   • Anexos: PDF ou foto, até 10 MB, no bucket privado "mensagens-internas".
   • Envio pela função mensagem_interna_enviar (migração 126).
   • Aviso: contador no menu e popup no topo quando chega mensagem nova (checa a cada 20 s).
     No primeiro carregamento, as mensagens já não lidas não geram popup.
   • Em "Ver como…" a tela abre, mas não envia nem marca como lida.
   Depende de script.js: session, supabase, users, escapeHtml, switchView, currentView.
   ============================================================ */
const miState = { tab: "in", inbox: [], sent: [], selectedId: null, attachments: {}, seen: new Set(), seeded: false, timer: null, queue: [], showing: false };
const MI_MAX_BYTES = 10 * 1024 * 1024;
const miActive = () => typeof session !== "undefined" && !!session && !(typeof viewAs !== "undefined" && viewAs.active);
const miEl = id => document.getElementById(id);
const miName = id => { const u = users.find(x => x.id === id); return u ? (u.name || u.email || "—") : "—"; };
const miDate = ms => ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/* ---- leitura ---- */
async function miLoadInbox() {
  const { data, error } = await supabase.from("internal_message_recipients")
    .select("read_at, message:internal_messages(id, sender_id, subject, body, created_at)")
    .eq("user_id", session.id).limit(300);
  if (error) { console.error("Erro ao carregar mensagens recebidas:", error); return null; }
  return (data || []).filter(r => r.message).map(r => ({
    id: r.message.id, senderId: r.message.sender_id, subject: r.message.subject || "", body: r.message.body || "",
    createdAt: new Date(r.message.created_at).getTime(), readAt: r.read_at ? new Date(r.read_at).getTime() : null,
  })).sort((a, b) => b.createdAt - a.createdAt);
}
async function miLoadSent() {
  const { data, error } = await supabase.from("internal_messages")
    .select("id, sender_id, subject, body, created_at, recipients:internal_message_recipients(user_id, read_at)")
    .eq("sender_id", session.id).order("created_at", { ascending: false }).limit(300);
  if (error) { console.error("Erro ao carregar mensagens enviadas:", error); return null; }
  return (data || []).map(m => ({
    id: m.id, senderId: m.sender_id, subject: m.subject || "", body: m.body || "",
    createdAt: new Date(m.created_at).getTime(),
    recipients: (m.recipients || []).map(r => ({ userId: r.user_id, readAt: r.read_at })),
  }));
}
async function miFetchAttachments(ids) {
  const out = {};
  if (!ids.length) return out;
  const { data, error } = await supabase.from("internal_message_attachments").select("message_id, file_path, file_name").in("message_id", ids);
  if (error) { console.error("Erro ao carregar anexos:", error); return out; }
  (data || []).forEach(a => { (out[a.message_id] = out[a.message_id] || []).push({ path: a.file_path, name: a.file_name }); });
  return out;
}
async function renderMensagens() {
  if (!session) return;
  const [inbox, sent] = await Promise.all([miLoadInbox(), miLoadSent()]);
  if (inbox) miState.inbox = inbox;
  if (sent) miState.sent = sent;
  miState.attachments = await miFetchAttachments([...miState.inbox, ...miState.sent].map(m => m.id));
  miPaint();
}

/* ---- tela ---- */
function miPaint() {
  const unread = miState.inbox.filter(m => !m.readAt).length;
  miSetBadge(unread);
  document.querySelectorAll("#view-mensagens [data-mi-tab]").forEach(b => b.classList.toggle("active", b.dataset.miTab === miState.tab));
  const cnt = miEl("mi-tab-in-count");
  if (cnt) cnt.textContent = unread ? ` (${unread})` : "";
  const isIn = miState.tab === "in";
  const list = isIn ? miState.inbox : miState.sent;
  miEl("mi-list").innerHTML = list.length ? list.map(m => {
    const who = isIn ? `De: ${miName(m.senderId)}` : `Para: ${m.recipients.map(r => miName(r.userId)).join(", ")}`;
    const readInfo = isIn ? "" : `<span class="mi-item-read">${m.recipients.filter(r => r.readAt).length}/${m.recipients.length} leram</span>`;
    return `<button type="button" class="mi-item${isIn && !m.readAt ? " is-unread" : ""}${miState.selectedId === m.id ? " is-selected" : ""}" data-mi-id="${m.id}">
      <span class="mi-item-top"><b>${escapeHtml(who)}</b><span>${escapeHtml(miDate(m.createdAt))}</span></span>
      <span class="mi-item-subject">${escapeHtml(m.subject || "(sem assunto)")}</span>
      <span class="mi-item-snippet">${escapeHtml(m.body.slice(0, 90))}</span>
      ${readInfo}
    </button>`;
  }).join("") : `<p class="mi-empty">${isIn ? "Nenhuma mensagem recebida." : "Nenhuma mensagem enviada."}</p>`;
  miPaintDetail();
}
function miPaintDetail() {
  const box = miEl("mi-detail");
  const m = [...miState.inbox, ...miState.sent].find(x => x.id === miState.selectedId);
  if (!m) { box.innerHTML = `<p class="mi-empty">Escolha uma mensagem na lista.</p>`; return; }
  const isIn = miState.inbox.some(x => x.id === m.id);
  const to = isIn ? "você" : m.recipients.map(r => miName(r.userId)).join(", ");
  const files = miState.attachments[m.id] || [];
  box.innerHTML = `
    <div class="mi-detail-head">
      <h3>${escapeHtml(m.subject || "(sem assunto)")}</h3>
      <div class="mi-detail-meta">De: ${escapeHtml(isIn ? miName(m.senderId) : "você")} · Para: ${escapeHtml(to)} · ${escapeHtml(miDate(m.createdAt))}</div>
    </div>
    <div class="mi-body">${escapeHtml(m.body)}</div>
    ${files.length ? `<div class="mi-files">${files.map(f => `<button type="button" class="btn btn-ghost btn-sm" data-mi-file="${escapeHtml(f.path)}">📎 ${escapeHtml(f.name || "anexo")}</button>`).join("")}</div>` : ""}
    ${isIn ? `<div class="mi-detail-actions"><button type="button" class="btn btn-primary btn-sm" data-mi-reply="${m.id}">Responder</button></div>` : ""}`;
}
async function miSelect(id) {
  miState.selectedId = id;
  const m = miState.inbox.find(x => x.id === id);
  if (m && !m.readAt && miActive()) {
    const { error } = await supabase.from("internal_message_recipients").update({ read_at: new Date().toISOString() })
      .eq("message_id", id).eq("user_id", session.id).is("read_at", null);
    if (!error) m.readAt = Date.now();
  }
  miPaint();
}
function miSetBadge(n) {
  const b = miEl("mi-nav-badge");
  if (!b) return;
  b.textContent = n > 99 ? "99+" : String(n);
  b.hidden = !n;
}

/* ---- escrever ---- */
function miOpenCompose(replyToId) {
  if (!miActive()) { alert("No modo \"Ver como\" não é possível enviar mensagens."); return; }
  const others = users.filter(u => u.active !== false && u.id !== session.id)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
  const replyTo = replyToId ? miState.inbox.find(x => x.id === replyToId) : null;
  miEl("mi-to-list").innerHTML = `<label class="mi-to-item mi-to-all"><input type="checkbox" id="mi-to-everyone"> <b>Todos</b></label>` +
    others.map(u => `<label class="mi-to-item"><input type="checkbox" class="mi-to-check" value="${escapeHtml(u.id)}"
      ${replyTo && replyTo.senderId === u.id ? "checked" : ""}> ${escapeHtml(u.name || u.email || "—")} <small>${escapeHtml(u.role || "")}</small></label>`).join("");
  miEl("mi-subject").value = replyTo ? (replyTo.subject.startsWith("Re: ") ? replyTo.subject : `Re: ${replyTo.subject}`) : "";
  miEl("mi-body").value = "";
  miEl("mi-files").value = "";
  miEl("mi-compose-backdrop").classList.add("open");
}
function miCloseCompose() { miEl("mi-compose-backdrop").classList.remove("open"); }

/* ---- popup de mensagem nova (mesmo padrão do aviso de venda fechada) ---- */
function miEnsureToastHost() {
  let host = miEl("mi-toast-host");
  if (host) return host;
  host = document.createElement("div");
  host.id = "mi-toast-host";
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}
function miShowNext() {
  if (miState.showing || !miState.queue.length) return;
  const m = miState.queue.shift();
  miState.showing = true;
  const host = miEnsureToastHost();
  const card = document.createElement("div");
  card.className = "mi-toast";
  card.innerHTML = `
    <div class="mi-toast-icon">✉</div>
    <div class="mi-toast-text">
      <div class="mi-toast-title">Nova mensagem de ${escapeHtml(miName(m.sender_id))}</div>
      <div class="mi-toast-sub">${escapeHtml(m.subject || "(sem assunto)")}</div>
    </div>
    <button type="button" class="mi-toast-close" aria-label="Fechar">&times;</button>`;
  host.appendChild(card);
  requestAnimationFrame(() => card.classList.add("in"));
  const close = () => {
    card.classList.remove("in");
    setTimeout(() => { card.remove(); miState.showing = false; miShowNext(); }, 300);
  };
  card.querySelector(".mi-toast-close").addEventListener("click", e => { e.stopPropagation(); close(); });
  card.addEventListener("click", () => { close(); if (typeof switchView === "function") switchView("mensagens"); });
  setTimeout(close, 9000);
}

async function miPoll() {
  if (!miActive()) return;
  const { data, error } = await supabase.from("internal_message_recipients")
    .select("message_id, message:internal_messages(id, sender_id, subject)")
    .eq("user_id", session.id).is("read_at", null).limit(50);
  if (error || !data) return;
  const unread = data.filter(r => r.message);
  miSetBadge(unread.length);
  if (!miState.seeded) { unread.forEach(r => miState.seen.add(r.message_id)); miState.seeded = true; return; }
  let novo = false;
  unread.forEach(r => {
    if (miState.seen.has(r.message_id)) return;
    miState.seen.add(r.message_id);
    miState.queue.push(r.message);
    novo = true;
  });
  miShowNext();
  if (novo && typeof currentView !== "undefined" && currentView === "mensagens") renderMensagens();
}

/* ---- eventos ---- */
document.querySelectorAll("#view-mensagens [data-mi-tab]").forEach(btn => btn.addEventListener("click", () => {
  miState.tab = btn.dataset.miTab;
  miState.selectedId = null;
  miPaint();
}));
miEl("mi-list").addEventListener("click", e => {
  const b = e.target.closest("[data-mi-id]");
  if (b) miSelect(b.dataset.miId);
});
miEl("mi-detail").addEventListener("click", async e => {
  const f = e.target.closest("[data-mi-file]");
  if (f) {
    const { data, error } = await supabase.storage.from("mensagens-internas").createSignedUrl(f.dataset.miFile, 3600);
    if (error || !data) { alert("Não foi possível abrir o anexo."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
    return;
  }
  const r = e.target.closest("[data-mi-reply]");
  if (r) miOpenCompose(r.dataset.miReply);
});
miEl("mi-new").addEventListener("click", () => miOpenCompose(null));
miEl("mi-compose-close").addEventListener("click", miCloseCompose);
miEl("mi-compose-cancel").addEventListener("click", miCloseCompose);
miEl("mi-compose-backdrop").addEventListener("click", e => { if (e.target.id === "mi-compose-backdrop") miCloseCompose(); });
miEl("mi-compose-form").addEventListener("change", e => {
  if (e.target.id === "mi-to-everyone") document.querySelectorAll(".mi-to-check").forEach(c => { c.checked = e.target.checked; });
});
miEl("mi-compose-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!miActive()) { alert("No modo \"Ver como\" não é possível enviar mensagens."); return; }
  const to = [...document.querySelectorAll(".mi-to-check:checked")].map(c => c.value);
  if (!to.length) { alert("Escolha pelo menos um destinatário."); return; }
  const subject = miEl("mi-subject").value.trim();
  const body = miEl("mi-body").value.trim();
  if (!subject && !body) { alert("Escreva um assunto ou uma mensagem."); return; }
  const files = [...miEl("mi-files").files];
  const bad = files.find(f => f.size > MI_MAX_BYTES || !(f.type.startsWith("image/") || f.type === "application/pdf"));
  if (bad) { alert(`"${bad.name}" não pode ser enviado. Use PDF ou foto de até 10 MB.`); return; }
  const btn = miEl("mi-send");
  btn.disabled = true; btn.textContent = "Enviando…";
  const reset = () => { btn.disabled = false; btn.textContent = "Enviar"; };
  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = (f.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "pdf";
    const path = `${session.id}/${Date.now()}-${i}.${ext}`;
    const up = await supabase.storage.from("mensagens-internas").upload(path, f);
    if (up.error) { console.error(up.error); alert("Não foi possível enviar um dos anexos. Tente de novo."); reset(); return; }
    uploaded.push({ path, name: f.name });
  }
  const { error } = await supabase.rpc("mensagem_interna_enviar", { p_subject: subject, p_body: body, p_to: to, p_files: uploaded });
  reset();
  if (error) { console.error(error); alert("Não foi possível enviar a mensagem. Tente de novo."); return; }
  miCloseCompose();
  miState.tab = "out";
  await renderMensagens();
});

/* arranque: começa a checar mensagens novas assim que a sessão existir */
(function miBoot() {
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (miActive()) {
      clearInterval(iv);
      miPoll();
      miState.timer = setInterval(miPoll, 20000);
    } else if (tries > 60) clearInterval(iv);
  }, 1000);
})();
