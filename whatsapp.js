/* ============================================================
   WHATSAPP (menu › WhatsApp) — caixa de entrada compartilhada do número da empresa (etapa 1: receber, ver e organizar).
   As mensagens chegam pela função whatsapp-webhook (API oficial da Meta) e ficam em wa_conversations / wa_messages.
   • Número que já é lead: a conversa vai para o consultor dono do lead. Número novo: cai na FILA; o Gerente escolhe o consultor
     (wa_assign) e o lead é criado nessa hora. Cada consultor vê só as próprias conversas; ADM e Gerente veem todas.
   • Notas internas (o cliente nunca recebe). Responder pelo CRM é a etapa 2: até lá o botão Enviar fica desligado e o texto pode ser copiado.
   • Aba CONVERSAS: contatos à esquerda, conversa no centro e respostas rápidas à direita: as mensagens salvas (wa_quick_replies:
     da equipe, que só ADM e Gerente editam, ou pessoais) e os links prontos (formulários ativos, agendamento do consultor da conversa
     e "Meus links" de quem está logado). Clicar num item coloca o texto na caixa de mensagem.
   • ADM: "Teste" simula uma mensagem recebida sem tocar em leads reais (e apaga os testes depois).
   • Aba PAINEL (abre primeiro): indicadores do período, times e consultores, "precisa de atenção", origem e conversas ao vivo.
     ADM e Gerente veem todos os times; o Consultor vê só os próprios números (o banco já limita as conversas de cada um).
     Meta de 1ª resposta: 20 min · cliente esperando há mais de 1 h = alerta vermelho. Conversas de TESTE não entram no painel.
   Depende de script.js (session, users, teams, leads, escapeHtml, agendaToast, openFicha). Atualiza sozinho a cada 12 s com a tela aberta.
   ============================================================ */

const WA_GOAL_MIN = 20, WA_RED_MIN = 60;
const wa = { view: "painel", panel: { period: "hoje", team: "", consultor: "" }, pmsgs: [], tick: 0, filterConsultor: "", ads: new Map(), convs: [], sel: null, msgs: [], filter: "", timer: null, loading: false, pending: null, built: false, mode: "msg", drafts: new Map(), bio: [], bioPage: null, booking: new Map(), qItems: [], qClosed: new Set(), quickOpen: null, replies: [], qrEditing: null };
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
function waDayLabel(d) {
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  return diff === 0 ? "Hoje" : diff === 1 ? "Ontem" : d.toLocaleDateString("pt-BR");
}
/* days: separa por dia, como no WhatsApp, e o balão mostra só a hora (a ficha do lead mantém data e hora em cada balão) */
function waBubbles(msgs, days) {
  if (!msgs.length) return '<p class="wa-empty">Nenhuma mensagem ainda.</p>';
  let lastDay = "";
  return msgs.map(m => {
    const at = new Date(m.created_at);
    const when = at.toLocaleString("pt-BR", days ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const label = days ? waDayLabel(at) : "";
    const sep = label && label !== lastDay ? `<div class="wa-day"><span>${label}</span></div>` : "";
    lastDay = label;
    return sep + waBubble(m, when);
  }).join("");
}
function waBubble(m, when) {
    if (m.direction === "note") return `<div class="wa-note"><small>Nota interna · ${waEsc((waUser(m.sent_by) || {}).name || "equipe")} · ${when}</small>${waEsc(m.body)}</div>`;
    const who = m.direction === "out" ? ` · ${waEsc((waUser(m.sent_by) || {}).name || "equipe")}` : "";
    const tick = m.direction === "out" ? ({ sent: " ✓", delivered: " ✓✓", read: " ✓✓", failed: " ⚠" }[m.status] || "") : "";
    return `<div class="wa-b ${m.direction === "out" ? "out" : "in"}"><span class="wa-body">${waEsc(m.body || "[" + m.msg_type + "]")}</span><small>${when}${who}${tick}</small></div>`;
}

async function waLoadConvs() {
  const { data, error } = await supabase.from("wa_conversations").select("*").order("last_message_at", { ascending: false }).limit(300);
  if (error) { console.error("Erro ao carregar conversas:", error); return false; }
  wa.convs = data || [];
  /* anúncio de origem (Click-to-WhatsApp): o mais recente de cada conversa */
  wa.ads = new Map();
  if (wa.convs.length) {
    const { data: ads } = await supabase.from("lead_ad_clicks").select("conversation_id, headline, ad_id, platform, created_at").in("conversation_id", wa.convs.map(c => c.id)).order("created_at", { ascending: false });
    (ads || []).forEach(a => { if (!wa.ads.has(a.conversation_id)) wa.ads.set(a.conversation_id, a); });
  }
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
  const mgr = waManager();
  const teamList = typeof teams !== "undefined" ? teams : [];
  root.innerHTML = `
    <div class="wa-topbar">
      <div class="subtabs wa-subtabs"><button type="button" class="subtab" data-wa-view="painel">Painel</button><button type="button" class="subtab" data-wa-view="conversas">Conversas</button></div>
      <div class="filter-bar wa-filterbar" id="wa-p-filters">
        ${mgr ? `<select id="wa-p-team"><option value="">Time: todos</option>${teamList.map(t => `<option value="${t.id}">${waEsc(t.name)}</option>`).join("")}</select>
        <select id="wa-p-cons"></select>` : ""}
        <select id="wa-p-period"><option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option></select>
      </div>
    </div>
    <div id="wa-panel"><div id="wa-panel-body"><p class="wa-empty">Carregando…</p></div></div>
    <div id="wa-inbox" hidden>
    <div class="wa-chat" id="wa-chat">
      <aside class="wa-side">
        <div class="wa-side-head"><b>Conversas</b><div class="wa-tabs" id="wa-tabs"></div></div>
        <input type="search" id="wa-search" placeholder="Buscar por nome ou telefone" autocomplete="off">
        <div class="wa-list" id="wa-list"></div>
      </aside>
      <section class="wa-main" id="wa-main"></section>
      <aside class="wa-quick" id="wa-quick">
        <div class="wa-quick-head"><b>Respostas rápidas</b><div class="wa-quick-tools"><button type="button" class="btn btn-primary btn-sm" id="wa-qr-new">+ Nova</button><button type="button" class="btn-icon" id="wa-quick-close" title="Fechar">&times;</button></div></div>
        <input type="search" id="wa-q-search" placeholder="Buscar resposta" autocomplete="off">
        <div class="wa-q-body" id="wa-q-body"></div>
      </aside>
    </div>
    ${session.role === "ADM" ? `<details class="wa-test"><summary>Teste (só ADM) — simular mensagem recebida</summary>
      <div class="wa-test-row"><input type="text" id="wa-t-phone" placeholder="Número de teste (só dígitos)" maxlength="12"><input type="text" id="wa-t-name" placeholder="Nome" maxlength="60"><input type="text" id="wa-t-body" placeholder="Mensagem" maxlength="300">
      <button type="button" class="btn btn-primary btn-sm" id="wa-t-send">Simular</button><button type="button" class="btn btn-ghost btn-sm" id="wa-t-clean">Apagar testes</button></div>
      <p class="muted-note" style="margin:6px 0 0;">Conversas de teste não criam lead nem mexem em leads existentes; ficam marcadas como TESTE.</p></details>` : ""}
    </div>`;
  waFillConsultorFilter();
}

/* ---------------- PAINEL ---------------- */
function waFillConsultorFilter() {
  const sel = waEl("wa-p-cons"); if (!sel) return;
  const team = wa.panel.team;
  const list = waTeamPeople().filter(u => !team || u.team_id === team);
  if (wa.panel.consultor && !list.some(u => u.id === wa.panel.consultor)) wa.panel.consultor = "";
  sel.innerHTML = `<option value="">Consultor: todos</option>` + list.map(u => `<option value="${u.id}" ${u.id === wa.panel.consultor ? "selected" : ""}>${waEsc(u.name)}</option>`).join("");
}
/* quem atende: consultores e gerentes ativos (o consultor logado só enxerga a si mesmo) */
function waTeamPeople() {
  if (!waManager()) return session ? [waUser(session.id) || { id: session.id, name: session.name, team_id: null }] : [];
  return (typeof users !== "undefined" ? users : []).filter(u => ["Consultor", "Gerente"].includes(u.role) && u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
}
function waDur(min) {
  if (min == null || !isFinite(min)) return "—";
  if (min < 1) return "agora";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h >= 24 ? `${Math.floor(h / 24)} d` : `${h}h${m ? String(m).padStart(2, "0") : ""}`;
}
const waRespClass = min => (min == null ? "" : min <= WA_GOAL_MIN ? "ok" : min <= WA_RED_MIN ? "warn" : "bad");
async function waLoadPanelMsgs() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data, error } = await supabase.from("wa_messages").select("conversation_id, direction, body, msg_type, sent_by, created_at")
    .gte("created_at", since).neq("direction", "note").order("created_at", { ascending: true }).limit(5000);
  if (error) { console.error("Erro ao carregar o painel:", error); return; }
  wa.pmsgs = (data || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
function waPanelStart() {
  const p = wa.panel.period;
  if (p === "hoje") { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return Date.now() - (p === "7d" ? 7 : 30) * 864e5;
}
function waPanelCompute() {
  const now = Date.now(), start = waPanelStart(), P = wa.panel, mgr = waManager();
  const teamOf = c => { const u = waUser(c.consultor_id); return u ? u.team_id || "" : ""; };
  const passes = c => !c.is_test && (!P.team || teamOf(c) === P.team) && (!P.consultor || c.consultor_id === P.consultor);
  const byConv = new Map();
  wa.pmsgs.forEach(m => { if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []); byConv.get(m.conversation_id).push(m); });
  const rows = wa.convs.filter(passes).map(c => {
    const ms = byConv.get(c.id) || [];
    const inPer = ms.filter(m => new Date(m.created_at).getTime() >= start);
    const last = ms[ms.length - 1];
    const waiting = last && last.direction === "in" ? (now - new Date(last.created_at).getTime()) / 60000 : null;
    let firstResp = null;
    const firstIn = inPer.find(m => m.direction === "in");
    if (firstIn) {
      const t0 = new Date(firstIn.created_at).getTime();
      const out = ms.find(m => m.direction === "out" && new Date(m.created_at).getTime() >= t0);
      if (out) firstResp = (new Date(out.created_at).getTime() - t0) / 60000;
    }
    const lead = c.lead_id && typeof leads !== "undefined" ? leads.find(l => l.id === c.lead_id) : null;
    const origin = wa.ads.has(c.id) ? "Anúncio Meta" : lead ? (lead.source || "Sem origem") : "Sem lead";
    return { c, ms, active: inPer.length > 0, waiting, firstResp, isNew: new Date(c.created_at).getTime() >= start, origin };
  });
  const fila = wa.convs.filter(c => !c.is_test && !c.consultor_id);
  const avg = arr => { const v = arr.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return { rows, fila, avg, now, start, mgr };
}

function waRenderPanel() {
  const box = waEl("wa-panel-body"); if (!box) return;
  const { rows, fila, avg, now, mgr } = waPanelCompute();
  const active = rows.filter(r => r.active), waitingRows = rows.filter(r => r.waiting != null);
  const red = waitingRows.filter(r => r.waiting > WA_RED_MIN).length;
  const avgResp = avg(active.map(r => r.firstResp));
  const fromAd = active.filter(r => wa.ads.has(r.c.id)).length;
  const oldestFila = fila.length ? Math.max(...fila.map(c => (now - new Date(c.last_inbound_at || c.created_at).getTime()) / 60000)) : null;

  const kpi = (label, value, sub) => `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ""}</div>`;
  const kpis = [
    kpi(mgr ? "Conversas abertas" : "Minhas conversas abertas", active.length, "com mensagem no período"),
    mgr ? kpi("Na fila, sem dono", fila.length, oldestFila != null ? `mais antiga: ${waDur(oldestFila)}` : "fila vazia") : "",
    kpi("Sem resposta", waitingRows.length, red ? `${red} há mais de 1 h` : waitingRows.length ? "nenhuma acima de 1 h" : "ninguém esperando"),
    kpi("1ª resposta (média)", waDur(avgResp), avgResp == null ? "aparece quando as respostas saírem pelo CRM" : `meta: ${WA_GOAL_MIN} min`),
    kpi("Vindas de anúncio", fromAd, active.length ? `${Math.round((fromAd / active.length) * 100)}% do total` : "—"),
  ].join("");

  /* times e consultores */
  const people = waTeamPeople().filter(u => (!wa.panel.team || u.team_id === wa.panel.team) && (!wa.panel.consultor || u.id === wa.panel.consultor));
  const stat = uid => {
    const mine = rows.filter(r => r.c.consultor_id === uid);
    const w = mine.filter(r => r.waiting != null);
    return { open: mine.filter(r => r.active).length, wait: w.length, waitRed: w.some(r => r.waiting > WA_RED_MIN), resp: avg(mine.filter(r => r.active).map(r => r.firstResp)), novos: mine.filter(r => r.isNew).length };
  };
  const personRow = u => {
    const st = stat(u.id);
    const respBadge = { ok: "badge-good", warn: "badge-warn", bad: "badge-danger" }[waRespClass(st.resp)] || "badge-neutral";
    return `<tr data-wa-cons="${u.id}" title="Ver as conversas de ${waEsc(u.name)}"><td class="cell-primary">${waEsc(u.name)}</td><td>${st.open}</td>
      <td><span class="badge ${st.waitRed ? "badge-danger" : st.wait ? "badge-warn" : "badge-neutral"}">${st.wait}</span></td><td><span class="badge ${respBadge}">${waDur(st.resp)}</span></td><td>${st.novos}</td></tr>`;
  };
  let tableBody = "";
  if (mgr) {
    const teamList = typeof teams !== "undefined" ? teams : [];
    const groups = teamList.map(t => ({ t, ppl: people.filter(u => u.team_id === t.id) })).filter(g => g.ppl.length);
    const noTeam = people.filter(u => !u.team_id || !teamList.some(t => t.id === u.team_id));
    groups.forEach(g => {
      const boss = waUser(g.t.manager_id);
      tableBody += `<tr class="wa-team-row"><td colspan="5">${waEsc(g.t.name)}${boss ? ` <span>· gerente ${waEsc(boss.name)}</span>` : ""}</td></tr>` + g.ppl.map(personRow).join("");
    });
    if (noTeam.length) tableBody += `<tr class="wa-team-row"><td colspan="5">Sem time</td></tr>` + noTeam.map(personRow).join("");
  } else tableBody = people.map(personRow).join("");
  const table = `<div class="panel"><div class="panel-header"><h2>${mgr ? "Times e consultores" : "Meus números"}</h2><span class="muted-note" style="margin:0;">${mgr ? "Clique num consultor para ver as conversas dele" : "Clique para ver suas conversas"}</span></div>
    <table class="data-table data-table-list wa-ptable"><thead><tr><th>${mgr ? "Consultor" : "Eu"}</th><th>Abertas</th><th>Sem resposta</th><th>1ª resposta</th><th>Leads novos</th></tr></thead>
    <tbody>${tableBody || `<tr><td colspan="5" class="cell-muted">Ninguém neste filtro.</td></tr>`}</tbody></table></div>`;

  /* precisa de atenção */
  const att = [];
  /* cliente esperando (acima da meta de 20 min; vermelho acima de 1 h) */
  waitingRows.filter(r => r.c.consultor_id).sort((a, b) => b.waiting - a.waiting).forEach(r => {
    if (r.waiting <= WA_GOAL_MIN) return;
    att.push({ cls: r.waiting > WA_RED_MIN ? "bad" : "warn", pill: waDur(r.waiting), text: waEsc(waTitle(r.c)), meta: `Sem resposta · ${waEsc((waUser(r.c.consultor_id) || {}).name || "consultor")}`, conv: r.c.id });
  });
  /* fila sem dono: sempre aparece para quem distribui */
  if (mgr) fila.forEach(c => {
    const age = (now - new Date(c.last_inbound_at || c.created_at).getTime()) / 60000;
    att.push({ cls: age > WA_RED_MIN ? "bad" : "warn", pill: "Fila", text: waEsc(waTitle(c)), meta: `Sem dono há ${waDur(age)}${wa.ads.has(c.id) ? " · veio de anúncio" : ""}`, conv: c.id });
  });
  if (typeof leads !== "undefined") leads.forEach(l => {
    if (!l.rotationActive && !l.rotation_active) return;
    const dl = new Date(l.rotationDeadline || l.rotation_deadline || 0).getTime(), left = (dl - now) / 60000;
    const owner = l.consultorId || l.consultor_id;
    if (left > 0 && left <= 60 && (mgr || owner === session.id)) att.push({ cls: "warn", pill: "Rodízio", text: waEsc(l.name), meta: `Passa para outro em ${waDur(left)} se não houver contato` });
  });
  const item = (badgeCls, badge, title, meta, conv) => `<div class="dash-agenda-item"${conv ? ` data-wa-open-conv="${conv}"` : ""}><span class="dash-agenda-item-badge ${badgeCls}">${badge}</span><div class="dash-agenda-item-body"><div class="dash-agenda-item-title">${title}</div>${meta ? `<div class="dash-agenda-item-meta">${meta}</div>` : ""}</div></div>`;
  const attHtml = `<div class="panel"><div class="panel-header"><h2>Precisa de atenção</h2></div><div class="wa-plist">${att.length ? att.slice(0, 8).map(a => item(a.cls === "bad" ? "wa-b-bad" : "wa-b-warn", a.pill, a.text, a.meta, a.conv)).join("") : `<p class="muted-note">Nada pendente agora ✓</p>`}</div></div>`;

  /* origem */
  const counts = {};
  active.forEach(r => { counts[r.origin] = (counts[r.origin] || 0) + 1; });
  const orig = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const maxO = orig.length ? orig[0][1] : 1;
  const origHtml = `<div class="panel"><div class="panel-header"><h2>Origem das conversas</h2></div><div class="wa-plist">${orig.length ? orig.map(([k, n]) => `<div class="wa-orow"><span>${waEsc(k)}</span><b>${n}</b></div><div class="wa-obar"><i style="width:${Math.round((n / maxO) * 100)}%"></i></div>`).join("") : `<p class="muted-note">Sem conversas no período.</p>`}</div></div>`;

  /* ao vivo */
  const vis = new Set(rows.map(r => r.c.id));
  const live = wa.pmsgs.filter(m => vis.has(m.conversation_id)).slice(-10).reverse();
  const liveHtml = `<div class="panel"><div class="panel-header"><h2>Conversas ao vivo</h2></div><div class="wa-plist">${live.length ? live.map(m => {
    const c = wa.convs.find(x => x.id === m.conversation_id), owner = c ? waUser(c.consultor_id) : null;
    const who = m.direction === "out" ? `${waEsc((waUser(m.sent_by) || owner || {}).name || "equipe")} → ${waEsc(waTitle(c))}` : `${waEsc(waTitle(c))} → ${owner ? waEsc(owner.name) : "fila"}`;
    const txt = String(m.body || `[${m.msg_type}]`); const short = txt.length > 140 ? txt.slice(0, 140) + "…" : txt;
    return item(m.direction === "out" ? "wa-b-out" : "wa-b-in", waDur((now - new Date(m.created_at).getTime()) / 60000), who, `"${waEsc(short)}"`, m.conversation_id);
  }).join("") : `<p class="muted-note">Nenhuma mensagem nos últimos 30 dias.</p>`}</div></div>`;

  box.innerHTML = `<div class="stat-row">${kpis}</div>
    <div class="dash-grid-2 wa-pgrid"><div>${table}</div><div class="wa-pcol">${attHtml}${origHtml}</div></div>
    ${liveHtml}`;
}

function waShowView(v) {
  wa.view = v;
  document.querySelectorAll("#wa-root [data-wa-view]").forEach(b => b.classList.toggle("active", b.dataset.waView === v));
  waEl("wa-panel").hidden = v !== "painel";
  waEl("wa-inbox").hidden = v !== "conversas";
  waEl("wa-p-filters").style.display = v === "painel" ? "" : "none";
  if (v === "painel") waRenderPanel(); else { waRenderSide(); waRenderMain(); waRenderQuick(); }
}

const WA_AVATAR_COLORS = ["#3167a1", "#1f4670", "#fb9d2d", "#16a34a", "#0e7490", "#7c5cc4", "#c2571a"];
function waAvatar(name) {
  const clean = String(name || "").replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : clean.slice(0, 2)).toUpperCase() || "?";
  const hash = [...clean].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return `<span class="wa-av" style="background:${WA_AVATAR_COLORS[hash % WA_AVATAR_COLORS.length]}">${waEsc(initials)}</span>`;
}

function waRenderSide() {
  const mgr = waManager(), q = (waEl("wa-search").value || "").trim().toLowerCase();
  if (!wa.filter) wa.filter = mgr ? "fila" : "todas";
  const nFila = wa.convs.filter(c => !c.consultor_id).length, nUnread = wa.convs.filter(c => c.unread).length;
  const tabs = [...(mgr ? [["fila", `Fila (${nFila})`]] : []), ["unread", `Não lidas (${nUnread})`], ["todas", "Todas"]];
  waEl("wa-tabs").innerHTML = tabs.map(([k, l]) => `<button type="button" class="wa-tab ${wa.filter === k ? "active" : ""}" data-wa-tab="${k}">${l}</button>`).join("");
  const consName = wa.filterConsultor ? (waUser(wa.filterConsultor) || {}).name || "consultor" : "";
  if (consName) waEl("wa-tabs").insertAdjacentHTML("beforeend", `<button type="button" class="wa-tab active" data-wa-clear-cons title="Tirar o filtro">${waEsc(consName)} ✕</button>`);
  const list = wa.convs.filter(c => (wa.filter === "fila" ? !c.consultor_id : wa.filter === "unread" ? c.unread : true))
    .filter(c => !wa.filterConsultor || c.consultor_id === wa.filterConsultor)
    .filter(c => !q || (waTitle(c) + " " + c.phone).toLowerCase().includes(q));
  waEl("wa-list").innerHTML = list.length ? list.map(c => {
    const owner = waUser(c.consultor_id);
    return `<button type="button" class="wa-item ${c.id === wa.sel ? "active" : ""}" data-wa-conv="${c.id}">
      ${waAvatar(waTitle(c))}<span class="wa-item-body">
      <span class="wa-item-top"><b>${waEsc(waTitle(c))}</b><span>${waTime(c.last_message_at)}</span></span>
      <span class="wa-item-prev">${c.unread ? '<i class="wa-dot"></i>' : ""}${waEsc(c.preview)}</span>
      <span class="wa-item-tags">${c.is_test ? '<em class="wa-tag test">TESTE</em>' : ""}${wa.ads.has(c.id) ? '<em class="wa-tag ad">Anúncio</em>' : ""}${!c.consultor_id ? '<em class="wa-tag queue">Na fila</em>' : owner ? `<em class="wa-tag">${waEsc(owner.name)}</em>` : ""}</span></span></button>`;
  }).join("") : `<p class="wa-empty">${wa.convs.length ? "Nenhuma conversa neste filtro." : "Nenhuma conversa ainda. Quando o número da empresa for conectado à Meta, as mensagens dos clientes aparecem aqui."}</p>`;
}

function waDraftKey() { return `${wa.sel}:${wa.mode}`; }
/* a caixa de mensagem cresce com o texto, até o limite do CSS */
function waFitCompose(ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; }
function waRenderMain() {
  const box = waEl("wa-main"), c = wa.convs.find(x => x.id === wa.sel);
  waEl("wa-chat").classList.toggle("has-sel", !!c);
  waApplyQuickOpen();
  const quickBtn = `<button type="button" class="btn btn-ghost btn-sm" data-wa-quick-toggle>Respostas rápidas</button>`;
  if (!c) { box.innerHTML = `<div class="wa-placeholder"><p>Selecione uma conversa</p>${quickBtn}</div>`; return; }
  const active = document.activeElement;
  const hadFocus = !!active && active.id === "wa-compose";
  const caret = hadFocus ? active.selectionStart : null;
  const owner = waUser(c.consultor_id);
  let assign = "";
  if (waManager() && !c.lead_id) {
    const cons = (typeof users !== "undefined" ? users : []).filter(u => ["Consultor", "Gerente"].includes(u.role) && u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    assign = `<div class="wa-assign"><span>${c.consultor_id ? "Atribuída a" : "Na fila — distribuir para"}</span>
      <select id="wa-assign-sel"><option value="">Escolha o consultor…</option>${cons.map(u => `<option value="${u.id}" ${u.id === c.consultor_id ? "selected" : ""}>${waEsc(u.name)}</option>`).join("")}</select>
      <button type="button" class="btn btn-primary btn-sm" id="wa-assign-btn">${c.is_test ? "Atribuir" : "Atribuir e criar lead"}</button></div>`;
  }
  const ad = wa.ads.get(c.id);
  const adLine = ad ? `<div class="wa-ad">📣 Veio de anúncio${ad.headline ? `: <b>${waEsc(ad.headline)}</b>` : ""}${ad.ad_id ? ` <small>· ID ${waEsc(ad.ad_id)}</small>` : ""}</div>` : "";
  const leadBtn = c.lead_id && typeof openFicha === "function" ? `<button type="button" class="btn btn-ghost btn-sm" id="wa-open-lead">Abrir ficha do lead</button>` : "";
  const isNote = wa.mode === "note";
  box.innerHTML = `
    <div class="wa-head">
      <button type="button" class="btn-icon wa-back" id="wa-back" title="Voltar para a lista" aria-label="Voltar para a lista">&larr;</button>
      ${waAvatar(waTitle(c))}
      <div class="wa-head-who"><b>${waEsc(waTitle(c))}</b>${c.is_test ? ' <em class="wa-tag test">TESTE</em>' : ""}<small>${waFmtPhone(c.phone)}${owner ? " · consultor: " + waEsc(owner.name) : ""}</small></div>
      <div class="wa-head-actions">${leadBtn}${quickBtn}</div>
    </div>
    ${adLine}${assign}
    <div class="wa-thread" id="wa-thread">${waBubbles(wa.msgs, true)}</div>
    <div class="wa-composer ${isNote ? "is-note" : ""}">
      <div class="wa-mode">
        <button type="button" class="wa-tab ${isNote ? "" : "active"}" data-wa-mode="msg">Mensagem</button>
        <button type="button" class="wa-tab ${isNote ? "active" : ""}" data-wa-mode="note">Nota interna</button>
      </div>
      <div class="wa-composer-row">
        <textarea id="wa-compose" rows="2" maxlength="2000" placeholder="${isNote ? "Nota interna sobre esta conversa…" : "Digite uma mensagem"}"></textarea>
        ${isNote ? `<button type="button" class="btn btn-primary btn-sm" id="wa-note-save">Salvar nota</button>`
          : `<button type="button" class="btn btn-ghost btn-sm" id="wa-copy-msg">Copiar</button><button type="button" class="btn btn-primary btn-sm" id="wa-send" disabled title="Liberado quando a conexão de envio com a Meta for concluída">Enviar</button>`}
      </div>
      <p class="muted-note wa-composer-hint">${isNote ? "O cliente não recebe as notas internas." : "O envio pelo CRM ainda não está ligado: por enquanto, copie o texto e envie pelo WhatsApp."}</p>
    </div>`;
  const ta = waEl("wa-compose");
  ta.value = wa.drafts.get(waDraftKey()) || "";
  waFitCompose(ta);
  if (hadFocus) { ta.focus(); ta.setSelectionRange(caret, caret); }
  const th = waEl("wa-thread"); th.scrollTop = th.scrollHeight;
}

/* ---------------- RESPOSTAS RÁPIDAS ---------------- */
const WA_QR_GROUPS = ["Topo de Funil", "Meio de Funil", "Em Fechamento"];
async function waLoadReplies() {
  const { data, error } = await supabase.from("wa_quick_replies").select("*").order("title");
  if (error) { console.error("Erro ao carregar respostas rápidas:", error); return; }
  wa.replies = data || [];
}
const waQrCanEdit = r => r.owner_id === session.id || (!r.owner_id && waManager());
/* grupos das mensagens salvas: os do funil primeiro, os demais em ordem alfabética */
function waQrGroups() {
  const names = [...new Set(wa.replies.map(r => r.category))];
  const rank = n => { const i = WA_QR_GROUPS.indexOf(n); return i === -1 ? WA_QR_GROUPS.length : i; };
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
function waOpenReplyModal(reply) {
  wa.qrEditing = reply || null;
  waEl("wa-qr-title").textContent = reply ? "Editar resposta rápida" : "Nova resposta rápida";
  waEl("wa-qr-f-title").value = reply ? reply.title : "";
  waEl("wa-qr-f-cat").value = reply ? reply.category : "";
  waEl("wa-qr-f-body").value = reply ? reply.body : "";
  waEl("wa-qr-f-team").checked = reply ? !reply.owner_id : waManager();
  waEl("wa-qr-team-wrap").style.display = waManager() ? "" : "none";
  waEl("wa-qr-delete").style.display = reply ? "" : "none";
  waEl("wa-qr-cats").innerHTML = [...new Set([...WA_QR_GROUPS, ...wa.replies.map(r => r.category)])].map(c => `<option value="${waEsc(c)}"></option>`).join("");
  waEl("wa-qr-backdrop").classList.add("open");
  waEl("wa-qr-f-title").focus();
}
function waCloseReplyModal() { waEl("wa-qr-backdrop").classList.remove("open"); wa.qrEditing = null; }
waEl("wa-qr-close").addEventListener("click", waCloseReplyModal);
waEl("wa-qr-cancel").addEventListener("click", waCloseReplyModal);
waEl("wa-qr-backdrop").addEventListener("click", e => { if (e.target === waEl("wa-qr-backdrop")) waCloseReplyModal(); });
waEl("wa-qr-form").addEventListener("submit", async e => {
  e.preventDefault();
  const title = waEl("wa-qr-f-title").value.trim(), body = waEl("wa-qr-f-body").value.trim();
  if (!title || !body) { agendaToast("Preencha o título e a mensagem."); return; }
  const row = { title, body, category: waEl("wa-qr-f-cat").value.trim() || "Geral", owner_id: waManager() && waEl("wa-qr-f-team").checked ? null : session.id, updated_at: new Date().toISOString() };
  const btn = waEl("wa-qr-save");
  btn.disabled = true;
  const { error } = wa.qrEditing ? await supabase.from("wa_quick_replies").update(row).eq("id", wa.qrEditing.id) : await supabase.from("wa_quick_replies").insert(row);
  btn.disabled = false;
  if (error) { agendaToast("Não foi possível salvar: " + error.message); return; }
  waCloseReplyModal();
  await waLoadReplies();
  waRenderQuick();
  agendaToast("Resposta salva.");
});
waEl("wa-qr-delete").addEventListener("click", async () => {
  if (!wa.qrEditing || !confirm(`Excluir a resposta "${wa.qrEditing.title}"?`)) return;
  const { error } = await supabase.from("wa_quick_replies").delete().eq("id", wa.qrEditing.id);
  if (error) { agendaToast("Não foi possível excluir: " + error.message); return; }
  waCloseReplyModal();
  await waLoadReplies();
  waRenderQuick();
  agendaToast("Resposta excluída.");
});

async function waLoadQuick() {
  await waLoadReplies();
  wa.bio = []; wa.bioPage = null;
  const { data: page } = await supabase.from("bio_pages").select("slug").eq("user_id", session.id).maybeSingle();
  if (!page) return;
  wa.bioPage = page;
  const { data: links } = await supabase.from("bio_links").select("label, url, enabled").eq("user_id", session.id).order("position").order("created_at");
  wa.bio = (links || []).filter(l => l.enabled !== false && String(l.url || "").trim());
}
/* o link de agendamento é o do consultor dono da conversa (sem dono, o de quem está logado) */
async function waLoadBooking(consultorId) {
  if (!consultorId || wa.booking.has(consultorId)) return;
  const { data } = await supabase.from("booking_settings").select("slug, enabled").eq("consultor_id", consultorId).maybeSingle();
  wa.booking.set(consultorId, data || null);
}
function waQuickConsultor() {
  const c = wa.convs.find(x => x.id === wa.sel);
  return (c && c.consultor_id) || (session && session.id) || null;
}
function waQuickSections() {
  const c = wa.convs.find(x => x.id === wa.sel);
  const lead = c && c.lead_id && typeof leads !== "undefined" ? leads.find(l => l.id === c.lead_id) : null;
  const formItems = (typeof forms !== "undefined" ? forms : []).filter(f => f.active && f.slug).map(f => ({ label: f.title, url: buildFormPublicUrl(f.slug) }));
  const cid = waQuickConsultor(), bk = wa.booking.get(cid);
  const bookingItems = bk && bk.slug && typeof bkaLink === "function"
    ? [{ label: "Link de agendamento", sub: `${(waUser(cid) || {}).name || ""}${bk.enabled ? "" : " · link desativado na Agenda"}`, url: bkaLink(bk.slug, lead && lead.bookingToken) }] : [];
  const bioItems = [];
  if (wa.bioPage && wa.bioPage.slug) bioItems.push({ label: "Minha página de links", url: `${location.origin}/l/${encodeURIComponent(wa.bioPage.slug)}` });
  wa.bio.forEach(l => {
    const url = bioSafeUrl(bioNormalizeUrl(l.url));
    if (url) bioItems.push({ label: l.label || url, url });
  });
  const replySections = waQrGroups().map(group => [group, wa.replies.filter(r => r.category === group).map(r => ({
    label: r.title, sub: r.body.replace(/\s+/g, " "), text: r.body, search: r.body, tag: r.owner_id ? "Só minha" : "", replyId: waQrCanEdit(r) ? r.id : null,
  }))]);
  return [...replySections, ["Formulários", formItems], ["Agendamento", bookingItems], ["Meus links", bioItems]];
}
function waRenderQuick() {
  const body = waEl("wa-q-body"); if (!body) return;
  const q = (waEl("wa-q-search").value || "").trim().toLowerCase();
  wa.qItems = [];
  const html = waQuickSections().map(([title, items]) => {
    const list = items.filter(i => !q || `${i.label} ${i.url || ""} ${i.search || ""}`.toLowerCase().includes(q));
    if (!list.length) return "";
    const closed = wa.qClosed.has(title) && !q;
    return `<section class="wa-q-sec">
      <button type="button" class="wa-q-title" data-wa-q-sec="${waEsc(title)}" aria-expanded="${!closed}"><span>${waEsc(title)}</span><small>${list.length}</small><i>${closed ? "▸" : "▾"}</i></button>
      ${closed ? "" : list.map(item => {
        const idx = wa.qItems.push(item) - 1;
        return `<div class="wa-q-item">
          <button type="button" class="wa-q-main" data-wa-q-ins="${idx}" title="Colocar na mensagem"><b>${waEsc(item.label)}${item.tag ? ` <em class="wa-tag">${waEsc(item.tag)}</em>` : ""}</b>${item.sub ? `<small>${waEsc(item.sub)}</small>` : ""}</button>
          <button type="button" class="wa-q-act" data-wa-q-copy="${idx}" title="Copiar" aria-label="Copiar"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          ${item.replyId ? `<button type="button" class="wa-q-act" data-wa-q-edit="${item.replyId}" title="Editar" aria-label="Editar"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` : ""}
          ${item.url ? `<a class="wa-q-act" href="${waEsc(item.url)}" target="_blank" rel="noopener" title="Abrir link" aria-label="Abrir link"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : ""}
        </div>`;
      }).join("")}
    </section>`;
  }).join("");
  const hint = !q && !wa.replies.length ? `<p class="wa-q-hint">Nenhuma mensagem salva ainda. Clique em <b>+ Nova</b> para criar a primeira.</p>` : "";
  body.innerHTML = hint + (html || (q ? `<p class="wa-empty">Nenhuma resposta encontrada.</p>` : ""));
}
const WA_QUICK_KEY = "crm-wa-quick-open";
function waApplyQuickOpen() {
  if (wa.quickOpen === null) {
    let saved = null;
    try { saved = localStorage.getItem(WA_QUICK_KEY); } catch (err) { /* sem storage */ }
    wa.quickOpen = saved === null ? window.innerWidth > 1180 : saved === "1";
  }
  waEl("wa-chat").classList.toggle("quick-on", wa.quickOpen);
}
function waSetQuickOpen(open) {
  wa.quickOpen = open;
  try { localStorage.setItem(WA_QUICK_KEY, open ? "1" : "0"); } catch (err) { /* sem storage */ }
  waApplyQuickOpen();
}
function waInsertQuick(item) {
  if (!wa.convs.some(c => c.id === wa.sel)) { agendaToast("Selecione uma conversa para colocar a resposta na mensagem, ou use o botão de copiar."); return; }
  wa.mode = "msg";
  const cur = wa.drafts.get(waDraftKey()) || "";
  wa.drafts.set(waDraftKey(), cur + (cur && !/\s$/.test(cur) ? "\n" : "") + (item.text || item.url));
  waRenderMain();
  const ta = waEl("wa-compose");
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  if (window.innerWidth <= 1180) waSetQuickOpen(false);
}
async function waCopy(text, okMsg) {
  const ok = typeof bkaCopy === "function" ? await bkaCopy(text) : await navigator.clipboard.writeText(text).then(() => true, () => false);
  agendaToast(ok ? okMsg : "Não foi possível copiar. Selecione o texto e copie manualmente.");
}

async function waSelect(id) {
  wa.sel = id;
  await waLoadMsgs();
  const c = wa.convs.find(x => x.id === id);
  if (c && c.unread) { c.unread = false; supabase.rpc("wa_mark_read", { p_conv: id }).then(r => { if (r.error) console.error(r.error); }); }
  waRenderSide(); waRenderMain();
  await waLoadBooking(waQuickConsultor());
  waRenderQuick();
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
  await Promise.all([waLoadPanelMsgs(), waLoadQuick(), waLoadBooking(waQuickConsultor())]);
  waShowView(wa.view);
  clearInterval(wa.timer);
  wa.timer = setInterval(async () => {
    const v = waEl("view-whatsapp");
    if (!v || !v.classList.contains("active")) { clearInterval(wa.timer); wa.timer = null; return; }
    await waRefresh(false);
    if (wa.view === "painel") { if (++wa.tick % 3 === 0) await waLoadPanelMsgs(); waRenderPanel(); }
  }, 12000);
}
/* abre uma conversa específica (usado pela ficha do lead) */
function waOpenConversation(id) { wa.pending = id; wa.sel = id; wa.view = "conversas"; if (typeof switchView === "function") switchView("whatsapp"); }

document.addEventListener("click", async e => {
  const root = waEl("wa-root");
  if (!root || !root.contains(e.target)) return;
  const vbtn = e.target.closest("[data-wa-view]");
  if (vbtn) { waShowView(vbtn.dataset.waView); return; }
  const prow = e.target.closest("[data-wa-cons]");
  if (prow) { wa.filterConsultor = prow.dataset.waCons; wa.filter = "todas"; waShowView("conversas"); return; }
  if (e.target.closest("[data-wa-clear-cons]")) { wa.filterConsultor = ""; waRenderSide(); return; }
  const oc = e.target.closest("[data-wa-open-conv]");
  if (oc) { wa.filterConsultor = ""; wa.filter = "todas"; wa.view = "conversas"; waShowView("conversas"); await waSelect(oc.dataset.waOpenConv); return; }
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
    const ta = waEl("wa-compose"), body = ta.value.trim(); if (!body) return;
    const { error } = await supabase.rpc("wa_add_note", { p_conv: wa.sel, p_body: body });
    if (error) { agendaToast("Não foi possível salvar a nota: " + error.message); return; }
    wa.drafts.delete(waDraftKey()); await waLoadMsgs(); waRenderMain(); return;
  }
  const modeBtn = e.target.closest("[data-wa-mode]");
  if (modeBtn) { wa.mode = modeBtn.dataset.waMode; waRenderMain(); waEl("wa-compose").focus(); return; }
  if (e.target.closest("#wa-copy-msg")) {
    const text = waEl("wa-compose").value.trim();
    if (!text) { agendaToast("Digite a mensagem ou escolha uma resposta rápida."); return; }
    await waCopy(text, "Mensagem copiada."); return;
  }
  if (e.target.closest("#wa-back")) { wa.sel = null; wa.msgs = []; waRenderSide(); waRenderMain(); waRenderQuick(); return; }
  if (e.target.closest("[data-wa-quick-toggle]")) { waSetQuickOpen(!wa.quickOpen); return; }
  if (e.target.closest("#wa-quick-close")) { waSetQuickOpen(false); return; }
  const qSec = e.target.closest("[data-wa-q-sec]");
  if (qSec) { const k = qSec.dataset.waQSec; if (wa.qClosed.has(k)) wa.qClosed.delete(k); else wa.qClosed.add(k); waRenderQuick(); return; }
  const qIns = e.target.closest("[data-wa-q-ins]");
  if (qIns) { waInsertQuick(wa.qItems[Number(qIns.dataset.waQIns)]); return; }
  const qCopy = e.target.closest("[data-wa-q-copy]");
  if (qCopy) { const it = wa.qItems[Number(qCopy.dataset.waQCopy)]; await waCopy(it.text || it.url, it.text ? "Resposta copiada." : "Link copiado."); return; }
  const qEdit = e.target.closest("[data-wa-q-edit]");
  if (qEdit) { waOpenReplyModal(wa.replies.find(r => r.id === qEdit.dataset.waQEdit)); return; }
  if (e.target.closest("#wa-qr-new")) { waOpenReplyModal(null); return; }
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
document.addEventListener("input", e => {
  if (e.target.id === "wa-search") waRenderSide();
  if (e.target.id === "wa-q-search") waRenderQuick();
  if (e.target.id === "wa-compose") { wa.drafts.set(waDraftKey(), e.target.value); waFitCompose(e.target); }
});
document.addEventListener("change", e => {
  if (e.target.id === "wa-p-period") { wa.panel.period = e.target.value; waRenderPanel(); }
  if (e.target.id === "wa-p-team") { wa.panel.team = e.target.value; waFillConsultorFilter(); waRenderPanel(); }
  if (e.target.id === "wa-p-cons") { wa.panel.consultor = e.target.value; waRenderPanel(); }
});
