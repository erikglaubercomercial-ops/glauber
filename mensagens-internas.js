/* ============================================================
   MENSAGENS INTERNAS — conversas por assunto (atendimentos)
   • Cada assunto é uma conversa com participantes e status: aberta ou concluída.
   • Qualquer usuário ativo abre um novo assunto ou responde um existente.
   • Responder a uma conversa concluída a reabre. Quem conclui ou reabre pode ser participante ou ADM.
   • Participantes veem a conversa; ADM vê todas (aba "Todas").
   • Anexos: PDF ou foto, até 10 MB, no bucket privado "mensagens-internas".
   • Aviso: contador no menu e popup no topo (sem som) quando há resposta nova em conversa sua.
     Checa a cada 20 s. No primeiro carregamento, o que já estava não lido não gera popup.
   • Em "Ver como…" a tela abre, mas não envia nem marca como lida.
   Migração 127. Depende de script.js: session, supabase, users, escapeHtml, switchView, currentView.
   ============================================================ */
const miState = {
  tab: "mine", filter: "open", threads: [], selectedId: null, messages: [], attachments: {},
  seen: new Set(), seeded: false, timer: null, queue: [], showing: false,
};
const MI_MAX_BYTES = 10 * 1024 * 1024;
const miActive = () => typeof session !== "undefined" && !!session && !(typeof viewAs !== "undefined" && viewAs.active);
const miIsAdm = () => typeof session !== "undefined" && !!session && session.role === "ADM";
const miEl = id => document.getElementById(id);
const miName = id => { const u = users.find(x => x.id === id); return u ? (u.name || u.email || "—") : "—"; };
const miDate = ms => ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const miMember = t => t.members.find(m => m.userId === session.id) || null;
const miAuthor = m => m.autorAluno ? (m.autorNome || "Aluno") : (m.authorId ? miName(m.authorId) : "Equipe");
const miLastLabel = t => !t.lastAuthorId ? "aluno" : (t.lastAuthorId === session.id ? "você" : miName(t.lastAuthorId));
const miIsUnread = t => {
  const m = miMember(t);
  return !!m && t.lastAuthorId !== session.id && (!m.readAt || m.readAt < t.updatedAt);
};

/* ---- leitura ---- */
async function miLoadThreads() {
  const { data, error } = await supabase.from("internal_threads")
    .select("id, subject, status, origin, created_by, created_at, updated_at, last_author_id, closed_at, closed_by, members:internal_thread_members(user_id, last_read_at)")
    .order("updated_at", { ascending: false }).limit(300);
  if (error) { console.error("Erro ao carregar conversas:", error); return null; }
  return (data || []).map(t => ({
    id: t.id, subject: t.subject || "", status: t.status, origin: t.origin || "interno", createdBy: t.created_by,
    createdAt: new Date(t.created_at).getTime(), updatedAt: new Date(t.updated_at).getTime(),
    lastAuthorId: t.last_author_id, closedAt: t.closed_at ? new Date(t.closed_at).getTime() : null, closedBy: t.closed_by,
    members: (t.members || []).map(m => ({ userId: m.user_id, readAt: m.last_read_at ? new Date(m.last_read_at).getTime() : null })),
  })).sort((a, b) => b.updatedAt - a.updatedAt);
}
async function miLoadThreadDetail(threadId) {
  const [msgs, atts] = await Promise.all([
    supabase.from("internal_thread_messages").select("id, author_id, body, created_at, autor_nome, autor_aluno").eq("thread_id", threadId).order("created_at"),
    supabase.from("internal_thread_attachments").select("message_id, file_path, file_name").eq("thread_id", threadId),
  ]);
  if (msgs.error) console.error("Erro ao carregar mensagens:", msgs.error);
  if (atts.error) console.error("Erro ao carregar anexos:", atts.error);
  miState.messages = (msgs.data || []).map(m => ({ id: m.id, authorId: m.author_id, autorNome: m.autor_nome || "", autorAluno: !!m.autor_aluno, body: m.body || "", createdAt: new Date(m.created_at).getTime() }));
  miState.attachments = {};
  (atts.data || []).forEach(a => { (miState.attachments[a.message_id] = miState.attachments[a.message_id] || []).push({ path: a.file_path, name: a.file_name }); });
}
async function renderMensagens() {
  if (!session) return;
  const list = await miLoadThreads();
  if (list) miState.threads = list;
  const allTab = miEl("mi-tab-all");
  if (allTab) allTab.hidden = !miIsAdm();
  if (!miIsAdm() && miState.tab === "all") miState.tab = "mine";
  if (miState.selectedId) await miLoadThreadDetail(miState.selectedId);
  miPaint();
}

/* ---- tela ---- */
function miVisibleThreads() {
  return miState.threads.filter(t => {
    if (miState.tab === "mine" && !miMember(t)) return false;
    if (miState.filter === "open" && t.status !== "open") return false;
    if (miState.filter === "closed" && t.status !== "closed") return false;
    return true;
  });
}
function miStatusPill(t) {
  return t.status === "closed" ? `<span class="mi-pill mi-pill-closed">Concluída</span>` : `<span class="mi-pill mi-pill-open">Aberta</span>`;
}
function miPaint() {
  const unread = miState.threads.filter(t => miIsUnread(t)).length;
  miSetBadge(unread);
  document.querySelectorAll("#view-mensagens [data-mi-tab]").forEach(b => b.classList.toggle("active", b.dataset.miTab === miState.tab));
  document.querySelectorAll("#view-mensagens [data-mi-filter]").forEach(b => b.classList.toggle("active", b.dataset.miFilter === miState.filter));
  const cnt = miEl("mi-tab-mine-count");
  if (cnt) cnt.textContent = unread ? ` (${unread})` : "";
  const items = miVisibleThreads();
  miEl("mi-list").innerHTML = items.length ? items.map(t => {
    const names = t.members.filter(m => m.userId !== session.id).map(m => miName(m.userId));
    const who = names.length ? names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "") : "—";
    return `<button type="button" class="mi-item${miIsUnread(t) ? " is-unread" : ""}${miState.selectedId === t.id ? " is-selected" : ""}" data-mi-id="${t.id}">
      <span class="mi-item-top"><span class="mi-item-subject">${escapeHtml(t.subject || "(sem assunto)")}</span>${miStatusPill(t)}</span>
      ${t.origin === "aluno" ? `<span class="mi-pill mi-pill-aluno">Chamado de aluno</span>` : ""}
      <span class="mi-item-snippet">Com: ${escapeHtml(who)}</span>
      <span class="mi-item-foot">${escapeHtml(miDate(t.updatedAt))} · última: ${escapeHtml(miLastLabel(t))}</span>
    </button>`;
  }).join("") : `<p class="mi-empty">Nenhuma conversa ${miState.filter === "open" ? "aberta" : miState.filter === "closed" ? "concluída" : ""} aqui.</p>`;
  miPaintDetail();
}
function miAddOptions(t) {
  const already = new Set(t.members.map(m => m.userId));
  const opts = users.filter(u => u.active !== false && u.id !== session.id && !already.has(u.id))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
  return opts.length
    ? opts.map(u => `<label class="mi-to-item"><input type="checkbox" class="mi-add-check" value="${escapeHtml(u.id)}"> ${escapeHtml(u.name || u.email || "—")} <small>${escapeHtml(u.role || "")}</small></label>`).join("")
    : `<span class="mi-note">Todas as pessoas já participam desta conversa.</span>`;
}
function miPaintDetail() {
  const box = miEl("mi-detail");
  const t = miState.threads.find(x => x.id === miState.selectedId);
  if (!t) { box.innerHTML = `<p class="mi-empty">Escolha uma conversa na lista, ou abra um novo assunto.</p>`; return; }
  const canAct = !!miMember(t) || miIsAdm();
  const parts = t.members.map(m => m.userId === session.id ? "você" : miName(m.userId)).join(", ");
  const bubbles = miState.messages.map(m => {
    const mine = m.authorId === session.id;
    const files = miState.attachments[m.id] || [];
    return `<div class="mi-bubble${mine ? " is-mine" : ""}">
      <div class="mi-bubble-head"><b>${escapeHtml(mine ? "Você" : miAuthor(m))}</b><span>${escapeHtml(miDate(m.createdAt))}</span></div>
      ${m.body ? `<div class="mi-bubble-body">${escapeHtml(m.body)}</div>` : ""}
      ${files.length ? `<div class="mi-files">${files.map(f => `<button type="button" class="btn btn-ghost btn-sm" data-mi-file="${escapeHtml(f.path)}">📎 ${escapeHtml(f.name || "anexo")}</button>`).join("")}</div>` : ""}
    </div>`;
  }).join("");
  box.innerHTML = `
    <div class="mi-detail-head">
      <div class="mi-detail-title"><h3>${escapeHtml(t.subject || "(sem assunto)")}</h3>${miStatusPill(t)}</div>
      <div class="mi-detail-meta">Participantes: ${escapeHtml(parts)}</div>
      ${canAct ? `<div class="mi-detail-actions">
        ${t.status === "open"
          ? `<button type="button" class="btn btn-ghost btn-sm" data-mi-status="closed">Concluir assunto</button>`
          : `<button type="button" class="btn btn-ghost btn-sm" data-mi-status="open">Reabrir assunto</button>`}
        <button type="button" class="btn btn-ghost btn-sm" data-mi-addtoggle="1">+ Adicionar pessoas</button>
      </div>
      <form class="mi-add" id="mi-add-form" hidden>
        <div class="mi-to-list">${miAddOptions(t)}</div>
        <div class="mi-reply-row">
          <span class="mi-note">Quem for adicionado vê todo o histórico desta conversa.</span>
          <button type="submit" class="btn btn-primary btn-sm">Adicionar</button>
        </div>
      </form>` : ""}
    </div>
    <div class="mi-thread">${bubbles || `<p class="mi-empty">Sem mensagens.</p>`}</div>
    ${canAct ? `<form class="mi-reply" id="mi-reply-form">
      ${t.status === "closed" ? `<p class="mi-note">Este assunto está concluído. Ao responder, ele é reaberto.</p>` : ""}
      <textarea id="mi-reply-body" rows="3" maxlength="4000" placeholder="Escreva a resposta…"></textarea>
      <div class="mi-reply-row">
        <input type="file" id="mi-reply-files" multiple accept="image/*,application/pdf">
        <button type="submit" class="btn btn-primary btn-sm" id="mi-reply-send">Enviar resposta</button>
      </div>
    </form>` : `<p class="mi-note">Você não participa deste assunto.</p>`}`;
}
async function miSelect(id) {
  miState.selectedId = id;
  await miLoadThreadDetail(id);
  const t = miState.threads.find(x => x.id === id);
  const m = t && miMember(t);
  if (m && miIsUnread(t) && miActive()) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("internal_thread_members").update({ last_read_at: now })
      .eq("thread_id", id).eq("user_id", session.id);
    if (!error) m.readAt = Date.now();
  }
  miPaint();
  const body = miEl("mi-detail");
  if (body) body.scrollTop = body.scrollHeight;
}
function miSetBadge(n) {
  const b = miEl("mi-nav-badge");
  if (!b) return;
  b.textContent = n > 99 ? "99+" : String(n);
  b.hidden = !n;
}

/* ---- anexos ---- */
async function miUploadFiles(files) {
  const ok = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.size > MI_MAX_BYTES || !(f.type.startsWith("image/") || f.type === "application/pdf")) {
      alert(`"${f.name}" não pode ser enviado. Use PDF ou foto de até 10 MB.`);
      return null;
    }
    const ext = (f.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "pdf";
    const path = `${session.id}/${Date.now()}-${i}.${ext}`;
    const up = await supabase.storage.from("mensagens-internas").upload(path, f);
    if (up.error) { console.error(up.error); alert("Não foi possível enviar um dos anexos. Tente de novo."); return null; }
    ok.push({ path, name: f.name });
  }
  return ok;
}

/* ---- novo assunto ---- */
function miOpenCompose() {
  if (!miActive()) { alert("No modo \"Ver como\" não é possível enviar mensagens."); return; }
  const others = users.filter(u => u.active !== false && u.id !== session.id)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
  miEl("mi-to-list").innerHTML = `<label class="mi-to-item mi-to-all"><input type="checkbox" id="mi-to-everyone"> <b>Todos</b></label>` +
    others.map(u => `<label class="mi-to-item"><input type="checkbox" class="mi-to-check" value="${escapeHtml(u.id)}"> ${escapeHtml(u.name || u.email || "—")} <small>${escapeHtml(u.role || "")}</small></label>`).join("");
  miEl("mi-subject").value = "";
  miEl("mi-body").value = "";
  miEl("mi-files").value = "";
  miEl("mi-compose-backdrop").classList.add("open");
}
function miCloseCompose() { miEl("mi-compose-backdrop").classList.remove("open"); }

/* ---- popup de resposta nova (sem som) ---- */
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
  const t = miState.queue.shift();
  miState.showing = true;
  const host = miEnsureToastHost();
  const card = document.createElement("div");
  card.className = "mi-toast";
  card.innerHTML = `
    <div class="mi-toast-icon">✉</div>
    <div class="mi-toast-text">
      <div class="mi-toast-title">Nova mensagem de ${escapeHtml(t.lastAuthorId ? miName(t.lastAuthorId) : "aluno (chamado)")}</div>
      <div class="mi-toast-sub">${escapeHtml(t.subject || "(sem assunto)")}</div>
    </div>
    <button type="button" class="mi-toast-close" aria-label="Fechar">&times;</button>`;
  host.appendChild(card);
  requestAnimationFrame(() => card.classList.add("in"));
  const close = () => {
    card.classList.remove("in");
    setTimeout(() => { card.remove(); miState.showing = false; miShowNext(); }, 300);
  };
  card.querySelector(".mi-toast-close").addEventListener("click", e => { e.stopPropagation(); close(); });
  card.addEventListener("click", () => {
    close();
    miState.tab = "mine";
    miState.selectedId = t.id;
    if (typeof switchView === "function") switchView("mensagens");
  });
  setTimeout(close, 9000);
}

async function miPoll() {
  if (!miActive()) return;
  const list = await miLoadThreads();
  if (!list) return;
  miState.threads = list;
  const unread = list.filter(t => miIsUnread(t));
  miSetBadge(unread.length);
  if (!miState.seeded) { list.forEach(t => miState.seen.add(`${t.id}|${t.updatedAt}`)); miState.seeded = true; return; }
  let novo = false;
  unread.forEach(t => {
    const key = `${t.id}|${t.updatedAt}`;
    if (miState.seen.has(key)) return;
    miState.seen.add(key);
    miState.queue.push(t);
    novo = true;
  });
  miShowNext();
  if (novo && typeof currentView !== "undefined" && currentView === "mensagens") renderMensagens();
}

/* ---- eventos ---- */
document.querySelectorAll("#view-mensagens [data-mi-tab]").forEach(btn => btn.addEventListener("click", () => {
  miState.tab = btn.dataset.miTab;
  miState.selectedId = null;
  renderMensagens();
}));
document.querySelectorAll("#view-mensagens [data-mi-filter]").forEach(btn => btn.addEventListener("click", () => {
  miState.filter = btn.dataset.miFilter;
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
  const add = e.target.closest("[data-mi-addtoggle]");
  if (add) { const f = miEl("mi-add-form"); if (f) f.hidden = !f.hidden; return; }
  const s = e.target.closest("[data-mi-status]");
  if (s && miState.selectedId) {
    if (!miActive()) { alert("No modo \"Ver como\" não é possível alterar o status."); return; }
    const { error } = await supabase.rpc("atendimento_status", { p_thread: miState.selectedId, p_status: s.dataset.miStatus });
    if (error) { console.error(error); alert("Não foi possível alterar o status. Tente de novo."); return; }
    await renderMensagens();
  }
});
miEl("mi-detail").addEventListener("submit", async e => {
  if (e.target.id === "mi-add-form") {
    e.preventDefault();
    if (!miActive()) { alert("No modo \"Ver como\" não é possível alterar a conversa."); return; }
    const ids = [...document.querySelectorAll(".mi-add-check:checked")].map(c => c.value);
    if (!ids.length) { alert("Escolha pelo menos uma pessoa."); return; }
    const { error } = await supabase.rpc("atendimento_adicionar", { p_thread: miState.selectedId, p_users: ids });
    if (error) { console.error(error); alert("Não foi possível adicionar as pessoas. Tente de novo."); return; }
    await renderMensagens();
    return;
  }
  if (e.target.id !== "mi-reply-form") return;
  e.preventDefault();
  if (!miActive()) { alert("No modo \"Ver como\" não é possível responder."); return; }
  const body = miEl("mi-reply-body").value.trim();
  const files = [...miEl("mi-reply-files").files];
  if (!body && !files.length) { alert("Escreva a resposta ou anexe um arquivo."); return; }
  const btn = miEl("mi-reply-send");
  btn.disabled = true; btn.textContent = "Enviando…";
  const uploaded = await miUploadFiles(files);
  if (!uploaded) { btn.disabled = false; btn.textContent = "Enviar resposta"; return; }
  const { error } = await supabase.rpc("atendimento_responder", { p_thread: miState.selectedId, p_mensagem: body, p_arquivos: uploaded });
  if (error) { console.error(error); alert("Não foi possível enviar a resposta. Tente de novo."); btn.disabled = false; btn.textContent = "Enviar resposta"; return; }
  await renderMensagens();
});
miEl("mi-new").addEventListener("click", miOpenCompose);
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
  if (!subject) { alert("Escreva o assunto."); return; }
  if (!body) { alert("Escreva a mensagem."); return; }
  const btn = miEl("mi-send");
  btn.disabled = true; btn.textContent = "Enviando…";
  const reset = () => { btn.disabled = false; btn.textContent = "Enviar"; };
  const uploaded = await miUploadFiles([...miEl("mi-files").files]);
  if (!uploaded) { reset(); return; }
  const { data, error } = await supabase.rpc("atendimento_abrir", { p_assunto: subject, p_mensagem: body, p_para: to, p_arquivos: uploaded });
  reset();
  if (error) { console.error(error); alert("Não foi possível abrir o assunto. Tente de novo."); return; }
  miCloseCompose();
  miState.tab = "mine";
  miState.filter = "open";
  miState.selectedId = data;
  await renderMensagens();
  await miSelect(data);
});

/* arranque: começa a checar respostas novas assim que a sessão existir */
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
