/* ============================================================
   WHATSAPP (menu › WhatsApp) — caixa de entrada compartilhada do número da empresa (etapa 1: receber, ver e organizar).
   As mensagens chegam pela função whatsapp-webhook (API oficial da Meta) e ficam em wa_conversations / wa_messages.
   • Número que já é lead: a conversa vai para o consultor dono do lead. Número novo: cai na FILA; o Gerente escolhe o consultor
     (wa_assign) e o lead é criado nessa hora. Cada consultor vê só as próprias conversas; ADM e Gerente veem todas.
   • Notas internas (o cliente nunca recebe). Responder pelo CRM é a etapa 2.
   • ADM: "Teste" simula uma mensagem recebida sem tocar em leads reais (e apaga os testes depois).
   Depende de script.js (session, users, leads, escapeHtml, agendaToast, openFicha). Atualiza sozinho a cada 12 s com a tela aberta.
   ============================================================ */

const wa = { convs: [], sel: null, msgs: [], filter: "", timer: null, loading: false, pending: null, built: false };
const waEl = id => document.getElementById(id);
const waManager = () => !!session && ["ADM", "Gerente"].includes(session.role);
const waUser = id => (typeof users !== "undefined" && users.find(u => u.id === id)) || null;
const waEsc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s ?? ""));

function waFmtPhone(p) { return /^55\d{10,11}$/.test(p) ? `+55 (${p.slice(2, 4)}) ${p.slice(4)}` : "+" + p; }
function waTime(iso) {
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function waTitle(c) {
  const lead = c.lead_id && typeof leads !== "undefined" ? leads.find(l => l.id === c.lead_id) : null;
  return (lead && lead.name) || c.contact_name || waFmtPhone(c.phone);
}

/* balões — também usados na ficha do lead */
function waBubbles(msgs) {
  if (!msgs.length) return '<p class="wa-empty">Nenhuma mensagem ainda.</p>';
  return msgs.map(m => {
    const when = new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    if (m.direction === "note") return `<div class="wa-note"><small>Nota interna · ${waEsc((waUser(m.sent_by) || {}).name || "equipe")} · ${when}</small>${waEsc(m.body)}</div>`;
    const who = m.direction === "out" ? ` · ${waEsc((waUser(m.sent_by) || {}).name || "equipe")}` : "";
    const tick = m.direction === "out" ? ({ sent: " ✓", delivered: " ✓✓", read: " ✓✓", failed: " ⚠" }[m.status] || "") : "";
    return `<div class="wa-b ${m.direction === "out" ? "out" : "in"}"><span class="wa-body">${waEsc(m.body || "[" + m.msg_type + "]")}</span><small>${when}${who}${tick}</small></div>`;
  }).join("");
}

async function waLoadConvs() {
  const { data, error } = await supabase.from("wa_conversations").select("*").order("last_message_at", { ascending: false }).limit(300);
  if (error) { console.error("Erro ao carregar conversas:", error); return false; }
  wa.convs = data || [];
  return true;
}
async function waLoadMsgs() {
  if (!wa.sel) { wa.msgs = []; return; }
  const { data } = await supabase.from("wa_messages").select("*").eq("conversation_id", wa.sel).order("created_at", { ascending: true }).limit(500);
  wa.msgs = data || [];
}

function waBuild() {
  if (wa.built) return;
  wa.built = true;
  const root = waEl("wa-root");
  root.innerHTML = `
    <div class="wa-layout">
      <aside class="wa-side">
        <div class="wa-tabs" id="wa-tabs"></div>
        <input type="search" id="wa-search" placeholder="Buscar por nome ou telefone" autocomplete="off">
        <div class="wa-list" id="wa-list"></div>
      </aside>
      <section class="wa-main" id="wa-main"></section>
    </div>
    ${session.role === "ADM" ? `<details class="wa-test"><summary>Teste (só ADM) — simular mensagem recebida</summary>
      <div class="wa-test-row"><input type="text" id="wa-t-phone" placeholder="Número de teste (só dígitos)" maxlength="12"><input type="text" id="wa-t-name" placeholder="Nome" maxlength="60"><input type="text" id="wa-t-body" placeholder="Mensagem" maxlength="300">
      <button type="button" class="btn btn-primary btn-sm" id="wa-t-send">Simular</button><button type="button" class="btn btn-ghost btn-sm" id="wa-t-clean">Apagar testes</button></div>
      <p class="muted-note" style="margin:6px 0 0;">Conversas de teste não criam lead nem mexem em leads existentes; ficam marcadas como TESTE.</p></details>` : ""}`;
}

function waRenderSide() {
  const mgr = waManager(), q = (waEl("wa-search").value || "").trim().toLowerCase();
  if (!wa.filter) wa.filter = mgr ? "fila" : "todas";
  const nFila = wa.convs.filter(c => !c.consultor_id).length, nUnread = wa.convs.filter(c => c.unread).length;
  const tabs = [...(mgr ? [["fila", `Fila (${nFila})`]] : []), ["unread", `Não lidas (${nUnread})`], ["todas", "Todas"]];
  waEl("wa-tabs").innerHTML = tabs.map(([k, l]) => `<button type="button" class="wa-tab ${wa.filter === k ? "active" : ""}" data-wa-tab="${k}">${l}</button>`).join("");
  const list = wa.convs.filter(c => (wa.filter === "fila" ? !c.consultor_id : wa.filter === "unread" ? c.unread : true))
    .filter(c => !q || (waTitle(c) + " " + c.phone).toLowerCase().includes(q));
  waEl("wa-list").innerHTML = list.length ? list.map(c => {
    const owner = waUser(c.consultor_id);
    return `<button type="button" class="wa-item ${c.id === wa.sel ? "active" : ""}" data-wa-conv="${c.id}">
      <span class="wa-item-top"><b>${waEsc(waTitle(c))}</b><span>${waTime(c.last_message_at)}</span></span>
      <span class="wa-item-prev">${c.unread ? '<i class="wa-dot"></i>' : ""}${waEsc(c.preview)}</span>
      <span class="wa-item-tags">${c.is_test ? '<em class="wa-tag test">TESTE</em>' : ""}${!c.consultor_id ? '<em class="wa-tag queue">Na fila</em>' : owner ? `<em class="wa-tag">${waEsc(owner.name)}</em>` : ""}${!c.lead_id && c.consultor_id ? "" : ""}</span></button>`;
  }).join("") : `<p class="wa-empty">${wa.convs.length ? "Nenhuma conversa neste filtro." : "Nenhuma conversa ainda. Quando o número da empresa for conectado à Meta, as mensagens dos clientes aparecem aqui."}</p>`;
}

function waRenderMain() {
  const box = waEl("wa-main"), c = wa.convs.find(x => x.id === wa.sel);
  if (!c) { box.innerHTML = '<div class="wa-placeholder">Selecione uma conversa</div>'; return; }
  const owner = waUser(c.consultor_id);
  let assign = "";
  if (waManager() && !c.lead_id) {
    const cons = (typeof users !== "undefined" ? users : []).filter(u => ["Consultor", "Gerente"].includes(u.role) && u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    assign = `<div class="wa-assign"><span>${c.consultor_id ? "Atribuída a" : "Na fila — distribuir para"}</span>
      <select id="wa-assign-sel"><option value="">Escolha o consultor…</option>${cons.map(u => `<option value="${u.id}" ${u.id === c.consultor_id ? "selected" : ""}>${waEsc(u.name)}</option>`).join("")}</select>
      <button type="button" class="btn btn-primary btn-sm" id="wa-assign-btn">${c.is_test ? "Atribuir" : "Atribuir e criar lead"}</button></div>`;
  }
  const leadBtn = c.lead_id && typeof openFicha === "function" ? `<button type="button" class="btn btn-ghost btn-sm" id="wa-open-lead">Abrir ficha do lead</button>` : "";
  box.innerHTML = `
    <div class="wa-head"><div><b>${waEsc(waTitle(c))}</b>${c.is_test ? ' <em class="wa-tag test">TESTE</em>' : ""}<small>${waFmtPhone(c.phone)}${owner ? " · consultor: " + waEsc(owner.name) : ""}</small></div>${leadBtn}</div>
    ${assign}
    <div class="wa-thread" id="wa-thread">${waBubbles(wa.msgs)}</div>
    <div class="wa-composer">
      <p class="muted-note" style="margin:0 0 6px;">Responder ao cliente por aqui chega na próxima etapa. Já dá para deixar <b>notas internas</b> (o cliente não recebe).</p>
      <div class="wa-composer-row"><textarea id="wa-note-text" rows="2" maxlength="2000" placeholder="Nota interna sobre esta conversa…"></textarea><button type="button" class="btn btn-primary btn-sm" id="wa-note-save">Salvar nota</button></div>
    </div>`;
  const th = waEl("wa-thread"); th.scrollTop = th.scrollHeight;
}

async function waSelect(id) {
  wa.sel = id;
  await waLoadMsgs();
  const c = wa.convs.find(x => x.id === id);
  if (c && c.unread) { c.unread = false; supabase.rpc("wa_mark_read", { p_conv: id }).then(r => { if (r.error) console.error(r.error); }); }
  waRenderSide(); waRenderMain();
}

async function waRefresh(first) {
  if (wa.loading) return;
  wa.loading = true;
  const ok = await waLoadConvs();
  if (ok) {
    if (wa.pending) { wa.sel = wa.pending; wa.pending = null; }
    if (wa.sel) {
      const before = wa.msgs.length;
      await waLoadMsgs();
      const c = wa.convs.find(x => x.id === wa.sel);
      if (c && c.unread) { c.unread = false; supabase.rpc("wa_mark_read", { p_conv: wa.sel }); }
      waRenderSide();
      if (first || wa.msgs.length !== before) waRenderMain();
    } else waRenderSide(), waRenderMain();
  }
  wa.loading = false;
}

async function renderWhatsApp() {
  if (!waEl("wa-root") || !session) return;
  waBuild();
  await waRefresh(true);
  clearInterval(wa.timer);
  wa.timer = setInterval(() => {
    const v = waEl("view-whatsapp");
    if (!v || !v.classList.contains("active")) { clearInterval(wa.timer); wa.timer = null; return; }
    waRefresh(false);
  }, 12000);
}
/* abre uma conversa específica (usado pela ficha do lead) */
function waOpenConversation(id) { wa.pending = id; wa.sel = id; if (typeof switchView === "function") switchView("whatsapp"); }

document.addEventListener("click", async e => {
  const root = waEl("wa-root");
  if (!root || !root.contains(e.target)) return;
  const tab = e.target.closest("[data-wa-tab]");
  if (tab) { wa.filter = tab.dataset.waTab; waRenderSide(); return; }
  const item = e.target.closest("[data-wa-conv]");
  if (item) { await waSelect(item.dataset.waConv); return; }
  if (e.target.closest("#wa-open-lead")) { const c = wa.convs.find(x => x.id === wa.sel); if (c && c.lead_id) openFicha(c.lead_id); return; }
  if (e.target.closest("#wa-assign-btn")) {
    const sel = waEl("wa-assign-sel").value; if (!sel) { agendaToast("Escolha o consultor."); return; }
    const btn = e.target.closest("#wa-assign-btn"); btn.disabled = true;
    const { error } = await supabase.rpc("wa_assign", { p_conv: wa.sel, p_consultor: sel });
    btn.disabled = false;
    if (error) { agendaToast("Não foi possível atribuir: " + error.message); return; }
    agendaToast("Conversa atribuída."); await waRefresh(true);
    if (typeof loadLeads === "function") { try { leads = await loadLeads(); if (typeof renderLeads === "function") renderLeads(); } catch (err) { /* a lista de leads atualiza no próximo ciclo */ } }
    return;
  }
  if (e.target.closest("#wa-note-save")) {
    const ta = waEl("wa-note-text"), body = ta.value.trim(); if (!body) return;
    const { error } = await supabase.rpc("wa_add_note", { p_conv: wa.sel, p_body: body });
    if (error) { agendaToast("Não foi possível salvar a nota: " + error.message); return; }
    ta.value = ""; await waLoadMsgs(); waRenderMain(); return;
  }
  if (e.target.closest("#wa-t-send")) {
    const { error } = await supabase.rpc("wa_simulate_inbound", { p_phone: waEl("wa-t-phone").value, p_name: waEl("wa-t-name").value, p_body: waEl("wa-t-body").value || "Olá, tenho interesse em intercâmbio" });
    if (error) { agendaToast("Erro no teste: " + error.message); return; }
    waEl("wa-t-body").value = ""; await waRefresh(true); return;
  }
  if (e.target.closest("#wa-t-clean")) {
    if (!confirm("Apagar todas as conversas de teste?")) return;
    const { data, error } = await supabase.rpc("wa_delete_tests");
    if (error) { agendaToast("Erro: " + error.message); return; }
    agendaToast(`${data} conversa(s) de teste apagada(s).`); wa.sel = null; await waRefresh(true);
  }
});
document.addEventListener("input", e => { if (e.target.id === "wa-search") waRenderSide(); });
