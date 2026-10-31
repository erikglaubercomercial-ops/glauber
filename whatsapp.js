/* ============================================================
   WHATSAPP (menu › WhatsApp) — caixa de entrada compartilhada do número da empresa (etapa 1: receber, ver e organizar).
   As mensagens chegam pela função whatsapp-webhook (API oficial da Meta) e ficam em wa_conversations / wa_messages.
   • Número que já é lead: a conversa vai para o consultor dono do lead. Número novo: cai na FILA; o Gerente escolhe o consultor
     (wa_assign) e o lead é criado nessa hora. Cada consultor vê só as próprias conversas; ADM e Gerente veem todas.
   • Notas internas (o cliente nunca recebe). Responder pelo CRM é a etapa 2.
   • ADM: "Teste" simula uma mensagem recebida sem tocar em leads reais (e apaga os testes depois).
   • Aba PAINEL (abre primeiro): indicadores do período, times e consultores, "precisa de atenção", origem e conversas ao vivo.
     ADM e Gerente veem todos os times; o Consultor vê só os próprios números (o banco já limita as conversas de cada um).
     Meta de 1ª resposta: 20 min · cliente esperando há mais de 1 h = alerta vermelho. Conversas de TESTE não entram no painel.
   Depende de script.js (session, users, teams, leads, escapeHtml, agendaToast, openFicha). Atualiza sozinho a cada 12 s com a tela aberta.
   ============================================================ */

const WA_GOAL_MIN = 20, WA_RED_MIN = 60;
const wa = { view: "painel", panel: { period: "hoje", team: "", consultor: "" }, pmsgs: [], tick: 0, filterConsultor: "", ads: new Map(), convs: [], sel: null, msgs: [], filter: "", timer: null, loading: false, pending: null, built: false };
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
    <div class="wa-views">
      <div class="wa-views-tabs"><button type="button" class="wa-view-btn" data-wa-view="painel">Painel</button><button type="button" class="wa-view-btn" data-wa-view="conversas">Conversas</button></div>
      <div class="wa-filters" id="wa-p-filters">
        ${mgr ? `<select id="wa-p-team"><option value="">Time: todos</option>${teamList.map(t => `<option value="${t.id}">${waEsc(t.name)}</option>`).join("")}</select>
        <select id="wa-p-cons"></select>` : ""}
        <select id="wa-p-period"><option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option></select>
      </div>
    </div>
    <div id="wa-panel"><div id="wa-panel-body"><p class="wa-empty">Carregando…</p></div></div>
    <div id="wa-inbox" hidden>
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

  const kpi = (label, value, sub, cls) => `<div class="wa-k"><small>${label}</small><b>${value}</b>${sub ? `<i class="${cls || ""}">${sub}</i>` : ""}</div>`;
  const kpis = [
    kpi(mgr ? "Conversas abertas" : "Minhas conversas abertas", active.length, "com mensagem no período"),
    mgr ? kpi("Na fila, sem dono", fila.length, oldestFila != null ? `mais antiga: ${waDur(oldestFila)}` : "fila vazia", fila.length ? "warn" : "ok") : "",
    kpi("Sem resposta", waitingRows.length, red ? `${red} há mais de 1 h` : waitingRows.length ? "nenhuma acima de 1 h" : "ninguém esperando", red ? "bad" : waitingRows.length ? "warn" : "ok"),
    kpi("1ª resposta (média)", waDur(avgResp), avgResp == null ? "aparece quando as respostas saírem pelo CRM" : `meta: ${WA_GOAL_MIN} min`, waRespClass(avgResp)),
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
    return `<tr class="wa-prow" data-wa-cons="${u.id}" title="Ver as conversas de ${waEsc(u.name)}"><td>${waEsc(u.name)}</td><td>${st.open}</td>
      <td class="${st.waitRed ? "bad" : st.wait ? "warn" : ""}">${st.wait}</td><td class="${waRespClass(st.resp)}">${waDur(st.resp)}</td><td>${st.novos}</td></tr>`;
  };
  let tableBody = "";
  if (mgr) {
    const teamList = typeof teams !== "undefined" ? teams : [];
    const groups = teamList.map(t => ({ t, ppl: people.filter(u => u.team_id === t.id) })).filter(g => g.ppl.length);
    const noTeam = people.filter(u => !u.team_id || !teamList.some(t => t.id === u.team_id));
    groups.forEach(g => {
      const boss = waUser(g.t.manager_id);
      tableBody += `<tr><td colspan="5" class="wa-team">${waEsc(g.t.name)}${boss ? ` · gerente ${waEsc(boss.name)}` : ""}</td></tr>` + g.ppl.map(personRow).join("");
    });
    if (noTeam.length) tableBody += `<tr><td colspan="5" class="wa-team">Sem time</td></tr>` + noTeam.map(personRow).join("");
  } else tableBody = people.map(personRow).join("");
  const table = `<div class="wa-card"><h3>${mgr ? "Times e consultores" : "Meus números"}</h3>
    <table class="wa-ptable"><tr><th>${mgr ? "Consultor" : "Eu"}</th><th>Abertas</th><th>Sem resposta</th><th>1ª resposta</th><th>Leads novos</th></tr>${tableBody || `<tr><td colspan="5" class="wa-muted">Ninguém neste filtro.</td></tr>`}</table>
    <div class="wa-muted" style="margin-top:6px">${mgr ? "Clique num consultor para ver as conversas dele." : "Clique na linha para ver suas conversas."}</div></div>`;

  /* precisa de atenção */
  const att = [];
  /* cliente esperando (acima da meta de 20 min; vermelho acima de 1 h) */
  waitingRows.filter(r => r.c.consultor_id).sort((a, b) => b.waiting - a.waiting).forEach(r => {
    if (r.waiting <= WA_GOAL_MIN) return;
    att.push({ cls: r.waiting > WA_RED_MIN ? "bad" : "warn", pill: waDur(r.waiting), text: `<b>${waEsc(waTitle(r.c))}</b> sem resposta · ${waEsc((waUser(r.c.consultor_id) || {}).name || "consultor")}`, conv: r.c.id });
  });
  /* fila sem dono: sempre aparece para quem distribui */
  if (mgr) fila.forEach(c => {
    const age = (now - new Date(c.last_inbound_at || c.created_at).getTime()) / 60000;
    att.push({ cls: age > WA_RED_MIN ? "bad" : "warn", pill: "fila", text: `<b>${waEsc(waTitle(c))}</b> sem dono há ${waDur(age)}${wa.ads.has(c.id) ? " · veio de anúncio" : ""}`, conv: c.id });
  });
  if (typeof leads !== "undefined") leads.forEach(l => {
    if (!l.rotationActive && !l.rotation_active) return;
    const dl = new Date(l.rotationDeadline || l.rotation_deadline || 0).getTime(), left = (dl - now) / 60000;
    const owner = l.consultorId || l.consultor_id;
    if (left > 0 && left <= 60 && (mgr || owner === session.id)) att.push({ cls: "warn", pill: "rodízio", text: `<b>${waEsc(l.name)}</b> passa para outro em ${waDur(left)} se não houver contato` });
  });
  const attHtml = `<div class="wa-card"><h3>Precisa de atenção</h3>${att.length ? att.slice(0, 8).map(a => `<div class="wa-al"${a.conv ? ` data-wa-open-conv="${a.conv}"` : ""}><span class="wa-pill ${a.cls}">${a.pill}</span><div>${a.text}</div></div>`).join("") : `<p class="wa-muted">Nada pendente agora ✓</p>`}</div>`;

  /* origem */
  const counts = {};
  active.forEach(r => { counts[r.origin] = (counts[r.origin] || 0) + 1; });
  const orig = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const maxO = orig.length ? orig[0][1] : 1;
  const origHtml = `<div class="wa-card"><h3>Origem das conversas</h3>${orig.length ? orig.map(([k, n]) => `<div class="wa-orow"><span>${waEsc(k)}</span><b>${n}</b></div><div class="wa-obar"><i style="width:${Math.round((n / maxO) * 100)}%"></i></div>`).join("") : `<p class="wa-muted">Sem conversas no período.</p>`}</div>`;

  /* ao vivo */
  const vis = new Set(rows.map(r => r.c.id));
  const live = wa.pmsgs.filter(m => vis.has(m.conversation_id)).slice(-10).reverse();
  const liveHtml = `<div class="wa-card"><h3>Conversas ao vivo</h3>${live.length ? live.map(m => {
    const c = wa.convs.find(x => x.id === m.conversation_id), owner = c ? waUser(c.consultor_id) : null;
    const who = m.direction === "out" ? `${waEsc((waUser(m.sent_by) || owner || {}).name || "equipe")} → ${waEsc(waTitle(c))}` : `${waEsc(waTitle(c))} → ${owner ? waEsc(owner.name) : "fila"}`;
    const txt = String(m.body || `[${m.msg_type}]`); const short = txt.length > 140 ? txt.slice(0, 140) + "…" : txt;
    return `<div class="wa-al" data-wa-open-conv="${m.conversation_id}"><span class="wa-pill acc">${waDur((now - new Date(m.created_at).getTime()) / 60000)}</span><div>${who}: <span class="wa-live-txt">"${waEsc(short)}"</span></div></div>`;
  }).join("") : `<p class="wa-muted">Nenhuma mensagem nos últimos 30 dias.</p>`}</div>`;

  box.innerHTML = `<div class="wa-kpis">${kpis}</div>
    <div class="wa-pgrid"><div>${table}</div><div class="wa-pcol">${attHtml}${origHtml}</div></div>
    ${liveHtml}`;
}

function waShowView(v) {
  wa.view = v;
  document.querySelectorAll("#wa-root .wa-view-btn").forEach(b => b.classList.toggle("active", b.dataset.waView === v));
  waEl("wa-panel").hidden = v !== "painel";
  waEl("wa-inbox").hidden = v !== "conversas";
  waEl("wa-p-filters").style.visibility = v === "painel" ? "visible" : "hidden";
  if (v === "painel") waRenderPanel(); else { waRenderSide(); waRenderMain(); }
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
      <span class="wa-item-top"><b>${waEsc(waTitle(c))}</b><span>${waTime(c.last_message_at)}</span></span>
      <span class="wa-item-prev">${c.unread ? '<i class="wa-dot"></i>' : ""}${waEsc(c.preview)}</span>
      <span class="wa-item-tags">${c.is_test ? '<em class="wa-tag test">TESTE</em>' : ""}${wa.ads.has(c.id) ? '<em class="wa-tag ad">Anúncio</em>' : ""}${!c.consultor_id ? '<em class="wa-tag queue">Na fila</em>' : owner ? `<em class="wa-tag">${waEsc(owner.name)}</em>` : ""}${!c.lead_id && c.consultor_id ? "" : ""}</span></button>`;
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
  const ad = wa.ads.get(c.id);
  const adLine = ad ? `<div class="wa-ad">📣 Veio de anúncio${ad.headline ? `: <b>${waEsc(ad.headline)}</b>` : ""}${ad.ad_id ? ` <small>· ID ${waEsc(ad.ad_id)}</small>` : ""}</div>` : "";
  const leadBtn = c.lead_id && typeof openFicha === "function" ? `<button type="button" class="btn btn-ghost btn-sm" id="wa-open-lead">Abrir ficha do lead</button>` : "";
  box.innerHTML = `
    <div class="wa-head"><div><b>${waEsc(waTitle(c))}</b>${c.is_test ? ' <em class="wa-tag test">TESTE</em>' : ""}<small>${waFmtPhone(c.phone)}${owner ? " · consultor: " + waEsc(owner.name) : ""}</small></div>${leadBtn}</div>
    ${adLine}${assign}
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
  await waLoadPanelMsgs();
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
document.addEventListener("change", e => {
  if (e.target.id === "wa-p-period") { wa.panel.period = e.target.value; waRenderPanel(); }
  if (e.target.id === "wa-p-team") { wa.panel.team = e.target.value; waFillConsultorFilter(); waRenderPanel(); }
  if (e.target.id === "wa-p-cons") { wa.panel.consultor = e.target.value; waRenderPanel(); }
});
