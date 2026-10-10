/* ============================================================
   AGENDA DO TIME — tela com visões Dia / Semana / Mês onde todo o time
   enxerga e organiza reuniões, tarefas e avisos. Os dados são os de
   agenda_items (mesma tabela do calendário do Dashboard).
   Depende de script.js: agendaItems, users, leads, session, openAgendaModal,
   agendaCanEdit, agendaFindConflicts, agendaOfferMoveDeal, leadLink,
   escapeHtml, saveAgendaItemRemote, renderDashCalendar, renderDashAgendaDay.
   ============================================================ */

const AG_MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const AG_DOW = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const AG_DOW_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const AG_STATUS = { agendada: "Agendada", realizada: "Realizada", nao_compareceu: "Não compareceu", remarcada: "Remarcada", cancelada: "Cancelada" };

const agState = { mode: "week", cursor: new Date(), who: null, status: "", inited: false };

function agIso(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function agParse(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function agAddDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function agMondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function agCap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function agTime(t) { return t ? t.slice(0, 5) : ""; }
function agName(id) { const u = users.find(x => x.id === id); return u ? u.name : ""; }

function agTitleText() {
  const c = agState.cursor;
  if (agState.mode === "month") return `${agCap(AG_MONTHS[c.getMonth()])} de ${c.getFullYear()}`;
  if (agState.mode === "day") return `${agCap(AG_DOW_LONG[c.getDay()])}, ${c.getDate()} de ${AG_MONTHS[c.getMonth()]} de ${c.getFullYear()}`;
  const a = agMondayOf(c), b = agAddDays(a, 6);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} de ${AG_MONTHS[b.getMonth()]} de ${b.getFullYear()}`
    : `${a.getDate()} de ${AG_MONTHS[a.getMonth()]} – ${b.getDate()} de ${AG_MONTHS[b.getMonth()]} de ${b.getFullYear()}`;
}

/* itens visíveis conforme os filtros (responsável/convidado/criador + status) */
function agFilteredItems() {
  return agendaItems.filter(a => {
    if (agState.status && (a.status || "agendada") !== agState.status) return false;
    if (agState.who) {
      const mine = a.consultorId === agState.who || (a.participantIds || []).includes(agState.who) || a.createdBy === agState.who;
      if (!mine) return false;
    }
    return true;
  });
}
function agByDate(items) {
  const map = {};
  items.forEach(a => { (map[a.itemDate] = map[a.itemDate] || []).push(a); });
  Object.values(map).forEach(list => list.sort((x, y) => (x.itemTime || "99:99").localeCompare(y.itemTime || "99:99")));
  return map;
}

function agCardHtml(a, opts) {
  opts = opts || {};
  const status = a.status || "agendada";
  const lead = a.leadId ? leads.find(l => l.id === a.leadId) : null;
  const who = [agName(a.consultorId), ...(a.participantIds || []).map(agName)].filter(Boolean);
  const conflict = a.itemTime && status === "agendada" && agendaFindConflicts(a).length > 0;
  const range = a.itemTime ? agTime(a.itemTime) + (a.endTime ? "–" + agTime(a.endTime) : "") : "Dia todo";
  const isUrl = /^https?:\/\//i.test(a.location || "");
  const quick = status === "agendada" && a.type === "reuniao" && agendaCanEdit(a)
    ? `<button type="button" class="ag-quick" data-ag-done="${a.id}" title="Marcar como realizada">✓ Realizada</button>` : "";
  return `
    <div class="ag-card ag-t-${a.type} ag-s-${status}" data-ag-id="${a.id}">
      <div class="ag-card-top">
        <span class="ag-time">${escapeHtml(range)}</span>
        ${conflict ? `<span class="ag-conflict" title="Choque de horário com outro compromisso">⚠ choque</span>` : ""}
        ${status !== "agendada" ? `<span class="ag-status ag-st-${status}">${AG_STATUS[status] || status}</span>` : ""}
      </div>
      <div class="ag-card-title">${escapeHtml(a.title)}</div>
      ${lead ? `<div class="ag-card-lead">${leadLink(lead.id, lead.name)}</div>` : ""}
      ${who.length ? `<div class="ag-card-who">${escapeHtml(who[0])}${who.length > 1 ? ` <span class="ag-more">+${who.length - 1}</span>` : ""}</div>` : ""}
      ${a.location ? `<div class="ag-card-loc">${isUrl ? `<a href="${escapeHtml(a.location)}" target="_blank" rel="noopener" data-ag-link>Entrar na reunião</a>` : escapeHtml(a.location)}</div>` : ""}
      ${opts.full && a.notes ? `<div class="ag-card-notes">${escapeHtml(a.notes)}</div>` : ""}
      ${quick}
    </div>`;
}

function agRenderDayList(iso, items, full) {
  const list = items[iso] || [];
  return list.length ? list.map(a => agCardHtml(a, { full })).join("") : `<div class="ag-empty">Nada agendado</div>`;
}

function renderAgendaScreen() {
  const body = document.getElementById("ag-body");
  if (!body) return;
  if (!agState.inited) agInit();
  document.getElementById("ag-title").textContent = agTitleText();
  document.querySelectorAll("#ag-modes [data-ag-mode]").forEach(b => b.classList.toggle("active", b.dataset.agMode === agState.mode));
  agFillWhoOptions();

  const items = agByDate(agFilteredItems());
  const todayIso = agIso(new Date());

  if (agState.mode === "day") {
    const iso = agIso(agState.cursor);
    body.innerHTML = `<div class="ag-day-wrap"><div class="ag-day-col is-single${iso === todayIso ? " is-today" : ""}">${agRenderDayList(iso, items, true)}<button type="button" class="ag-add" data-ag-add="${iso}">+ Agendar neste dia</button></div></div>`;
  } else if (agState.mode === "week") {
    const start = agMondayOf(agState.cursor);
    body.innerHTML = `<div class="ag-week">${Array.from({ length: 7 }, (_, i) => {
      const d = agAddDays(start, i), iso = agIso(d);
      return `<div class="ag-day-col${iso === todayIso ? " is-today" : ""}${i >= 5 ? " is-weekend" : ""}">
        <div class="ag-day-head" data-ag-goto="${iso}"><span>${AG_DOW[i]}</span><strong>${d.getDate()}</strong></div>
        <div class="ag-day-list">${agRenderDayList(iso, items, false)}</div>
        <button type="button" class="ag-add" data-ag-add="${iso}">+ Agendar</button>
      </div>`;
    }).join("")}</div>`;
  } else {
    const c = agState.cursor, first = new Date(c.getFullYear(), c.getMonth(), 1);
    const start = agMondayOf(first);
    const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()) / 7);
    let cells = "";
    for (let i = 0; i < weeks * 7; i++) {
      const d = agAddDays(start, i), iso = agIso(d), list = items[iso] || [];
      const inMonth = d.getMonth() === c.getMonth();
      cells += `<div class="ag-mcell${inMonth ? "" : " is-out"}${iso === todayIso ? " is-today" : ""}" data-ag-goto="${iso}">
        <span class="ag-mnum">${d.getDate()}</span>
        ${list.slice(0, 3).map(a => `<div class="ag-chip ag-t-${a.type} ag-s-${a.status || "agendada"}" data-ag-id="${a.id}" title="${escapeHtml(a.title)}">${a.itemTime ? `<b>${agTime(a.itemTime)}</b> ` : ""}${escapeHtml(a.title)}</div>`).join("")}
        ${list.length > 3 ? `<div class="ag-chip-more">+${list.length - 3} mais</div>` : ""}
      </div>`;
    }
    body.innerHTML = `<div class="ag-month"><div class="ag-mhead">${AG_DOW.map(x => `<span>${x}</span>`).join("")}</div><div class="ag-mgrid">${cells}</div></div>`;
  }
}

function agFillWhoOptions() {
  const sel = document.getElementById("ag-filter-who");
  const team = users.filter(u => u.active !== false && ["ADM", "Gerente", "Consultor"].includes(u.role)).slice().sort((a, b) => a.name.localeCompare(b.name));
  const wanted = agState.who || "";
  const html = `<option value="">Toda a equipe</option>` +
    (session ? `<option value="${session.id}">Minha agenda</option>` : "") +
    team.filter(u => !session || u.id !== session.id).map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
  sel.value = wanted;
}

function agShift(dir) {
  const c = agState.cursor;
  if (agState.mode === "month") agState.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
  else agState.cursor = agAddDays(c, dir * (agState.mode === "week" ? 7 : 1));
  renderAgendaScreen();
}

async function agMarkDone(id) {
  const a = agendaItems.find(x => x.id === id);
  if (!a) return;
  const saved = await saveAgendaItemRemote({ ...a, status: "realizada" });
  if (!saved) { alert("Não foi possível atualizar a reunião."); return; }
  const idx = agendaItems.findIndex(x => x.id === id);
  if (idx >= 0) agendaItems[idx] = saved;
  renderAgendaScreen();
  renderDashCalendar();
  renderDashAgendaDay();
  agendaOfferMoveDeal(saved);
}

function agInit() {
  agState.inited = true;
  /* consultor abre na própria agenda; ADM/Gerente veem a equipe toda */
  agState.who = session && session.role === "Consultor" ? session.id : "";
  document.getElementById("ag-prev").addEventListener("click", () => agShift(-1));
  document.getElementById("ag-next").addEventListener("click", () => agShift(1));
  document.getElementById("ag-today").addEventListener("click", () => { agState.cursor = new Date(); renderAgendaScreen(); });
  document.getElementById("ag-new").addEventListener("click", () => {
    const iso = agState.mode === "day" ? agIso(agState.cursor) : agIso(new Date());
    openAgendaModal(null, iso);
  });
  document.getElementById("ag-modes").addEventListener("click", e => {
    const b = e.target.closest("[data-ag-mode]");
    if (!b) return;
    agState.mode = b.dataset.agMode;
    renderAgendaScreen();
  });
  document.getElementById("ag-filter-who").addEventListener("change", e => { agState.who = e.target.value; renderAgendaScreen(); });
  document.getElementById("ag-filter-status").addEventListener("change", e => { agState.status = e.target.value; renderAgendaScreen(); });
  document.getElementById("ag-body").addEventListener("click", e => {
    if (e.target.closest("[data-ag-link]") || e.target.closest(".lead-link")) return;
    const done = e.target.closest("[data-ag-done]");
    if (done) { e.stopPropagation(); agMarkDone(done.dataset.agDone); return; }
    const add = e.target.closest("[data-ag-add]");
    if (add) { openAgendaModal(null, add.dataset.agAdd); return; }
    const card = e.target.closest("[data-ag-id]");
    if (card) { openAgendaModal(card.dataset.agId); return; }
    const go = e.target.closest("[data-ag-goto]");
    if (go) { agState.cursor = agParse(go.dataset.agGoto); agState.mode = "day"; renderAgendaScreen(); }
  });
}

/* ---- lembrete: reunião sua começando em até 15 minutos ---- */
const AG_REMINDED_KEY = "crm-agenda-lembrados";
function agRemindedSet() {
  try { const o = JSON.parse(localStorage.getItem(AG_REMINDED_KEY) || "{}"); return o.day === agIso(new Date()) ? new Set(o.ids || []) : new Set(); }
  catch (err) { return new Set(); }
}
function agRememberReminded(set) {
  try { localStorage.setItem(AG_REMINDED_KEY, JSON.stringify({ day: agIso(new Date()), ids: Array.from(set) })); } catch (err) { /* sem storage */ }
}
function agCheckReminders() {
  if (!session || document.hidden) return;
  const now = new Date(), todayIso = agIso(now), nowMin = now.getHours() * 60 + now.getMinutes();
  const done = agRemindedSet();
  const due = agendaItems.filter(a => {
    if (a.type !== "reuniao" || (a.status || "agendada") !== "agendada" || a.itemDate !== todayIso || !a.itemTime || done.has(a.id)) return false;
    const mine = a.consultorId === session.id || (a.participantIds || []).includes(session.id) || a.createdBy === session.id;
    if (!mine) return false;
    const [h, m] = a.itemTime.split(":").map(Number);
    const diff = h * 60 + m - nowMin;
    return diff <= 15 && diff >= -5;
  });
  if (!due.length) return;
  due.forEach(a => done.add(a.id));
  agRememberReminded(done);
  agShowReminder(due[0], due.length - 1);
}
function agShowReminder(a, extra) {
  let box = document.getElementById("ag-reminder");
  if (!box) {
    box = document.createElement("div");
    box.id = "ag-reminder";
    box.className = "lead-alert-toast ag-reminder";
    box.addEventListener("click", e => {
      if (e.target.closest("[data-ag-r-close]")) box.classList.remove("show");
      else if (e.target.closest("[data-ag-r-open]")) { box.classList.remove("show"); openAgendaModal(box.dataset.itemId); }
    });
    document.body.appendChild(box);
  }
  box.dataset.itemId = a.id;
  const lead = a.leadId ? leads.find(l => l.id === a.leadId) : null;
  box.innerHTML = `
    <span class="lat-icon" style="color:var(--primary)">⏰</span>
    <div class="lat-body"><strong>Reunião às ${escapeHtml(agTime(a.itemTime))}</strong><span>${escapeHtml(a.title)}${lead ? " · " + escapeHtml(lead.name) : ""}${extra > 0 ? ` (+${extra})` : ""}</span></div>
    <button type="button" class="btn btn-primary btn-sm" data-ag-r-open>Abrir</button>
    <button type="button" class="btn-icon" data-ag-r-close aria-label="×">&times;</button>`;
  box.classList.add("show");
}
function startAgendaReminders() {
  setInterval(agCheckReminders, 30000);
  setTimeout(agCheckReminders, 4000);
}
