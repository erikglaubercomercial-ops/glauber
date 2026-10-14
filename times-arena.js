/* ============================================================
   ARENA DOS TIMES — primeira tela do menu "Time": um botão grande por time
   (foto do gerente no topo, nome de guerra, grito de guerra e KPIs) e o
   placar de competição entre os times. Clicar num time abre o painel dele.
   Os números vêm de team_scores / team_scores_monthly (banco), que calculam
   o time inteiro mesmo para consultor (que só enxerga os próprios leads).
   Depende de script.js: session, users, teams, supabase, escapeHtml, currency.
   ============================================================ */

const TA_PERIODS = [
  { key: "month", label: "Este mês" },
  { key: "3m", label: "3 meses" },
  { key: "year", label: "Este ano" },
  { key: "all", label: "Desde o início" },
];
/* pontuação do campeonato (aparece na tela; fácil de ajustar) */
const TA_POINTS = { won: 10, meeting: 3, responded: 1 };
const TA_MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const TA_MEDALS = ["🥇", "🥈", "🥉"];
const TA_NAME_SUGGESTIONS = {
  pt: ["Desbravadores", "Navegantes", "Trilheiros", "Horizonte", "Bússola", "Travessia", "Exploradores", "Bandeirantes", "Rota Norte", "Embarque"],
  es: ["Caminantes", "Conquistadores", "Rumbo", "Travesía", "Alas del Camino", "Horizonte", "Brújula", "Exploradores"],
};
const TA_MOTTO_SUGGESTIONS = {
  pt: ["Abrimos caminho para o seu sonho.", "Todo grande caminho começa num primeiro passo.", "Juntos até o embarque!", "Quem caminha, chega."],
  es: ["¡Cada paso nos acerca!", "Juntos hasta el embarque.", "Quien camina, llega."],
};
const TA_COLORS = ["#3167a1", "#e8751a", "#1f4670", "#16a34a", "#6faed6", "#9b6dd6", "#e2483d"];

const ta = { period: "year", teams: [], monthly: {}, open: null, chart: null, loading: false, error: null };
const taEl = id => document.getElementById(id);
const taEsc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s));
const taNum = n => (Number(n) || 0).toLocaleString("pt-BR");
const taPct = n => `${(Math.round((Number(n) || 0) * 10) / 10).toLocaleString("pt-BR")}%`;

/* ---- período ---- */
function taRange() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const start = ta.period === "month" ? new Date(y, m, 1) : ta.period === "3m" ? new Date(y, m - 2, 1) : ta.period === "year" ? new Date(y, 0, 1) : new Date(2020, 0, 1);
  return { from: iso(start), to: iso(now) };
}

/* ---- dados ---- */
async function taLoad() {
  ta.loading = true; ta.error = null;
  taRender();
  const r = taRange();
  const [scores, monthly] = await Promise.all([
    supabase.rpc("team_scores", { p_from: r.from, p_to: r.to }),
    supabase.rpc("team_scores_monthly", { p_year: new Date().getFullYear() }),
  ]);
  ta.loading = false;
  if (scores.error) { console.error("Erro no placar dos times:", scores.error); ta.error = "Não foi possível carregar o placar dos times."; taRender(); return; }
  ta.teams = (scores.data || []).map(taDecorate);
  ta.monthly = monthly.data || {};
  taRender();
}
/* soma os consultores de cada time e calcula conversão e pontos */
function taDecorate(t) {
  const m = t.members || [];
  const sum = k => m.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const hasRev = m.some(x => x.revenue != null);
  const row = x => ({ ...x, conv: x.leads ? (x.won / x.leads) * 100 : 0, points: x.won * TA_POINTS.won + x.meetings * TA_POINTS.meeting + x.responded * TA_POINTS.responded });
  const members = m.map(row).sort((a, b) => b.points - a.points);
  const tot = { leads: sum("leads"), responded: sum("responded"), won: sum("won"), meetings: sum("meetings"), revenue: hasRev ? sum("revenue") : null };
  return { ...t, members, ...tot, conv: tot.leads ? (tot.won / tot.leads) * 100 : 0,
    points: tot.won * TA_POINTS.won + tot.meetings * TA_POINTS.meeting + tot.responded * TA_POINTS.responded };
}
const taRanked = () => ta.teams.slice().sort((a, b) => b.points - a.points || b.won - a.won);
const taCanEdit = t => !!session && (session.role === "ADM" || session.id === t.manager_id);

/* ---- foto do gerente ---- */
function taPhotoUrl(t) {
  if (!t.photo_path) return "";
  try { return supabase.storage.from("team-photos").getPublicUrl(t.photo_path).data.publicUrl; } catch (e) { return ""; }
}
function taInitials(name) {
  return String(name || "?").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join("") || "?";
}
function taAvatar(t, size) {
  const url = taPhotoUrl(t);
  const cls = `ta-avatar ta-avatar-${size}`;
  return url
    ? `<span class="${cls}" style="--tc:${t.color}"><img src="${taEsc(url)}" alt="${taEsc(t.manager_name || "Gerente")}"></span>`
    : `<span class="${cls}" style="--tc:${t.color}"><b>${taEsc(taInitials(t.manager_name || t.war_name || t.name))}</b></span>`;
}
const taTitle = t => t.war_name || "Defina o nome de guerra";

/* ---- tela 1: todos os times ---- */
function taCardHtml(t, rank) {
  const showRev = t.revenue != null;
  return `
  <div class="ta-card" role="button" tabindex="0" data-ta-open="${t.id}" style="--tc:${t.color}">
    <div class="ta-card-top">
      ${taCanEdit(t) ? `<button type="button" class="ta-edit" data-ta-edit="${t.id}" title="Editar nome de guerra, grito e foto">✎</button>` : ""}
      <span class="ta-rank" title="Posição no placar">${TA_MEDALS[rank] || rank + 1 + "º"}</span>
    </div>
    ${taAvatar(t, "lg")}
    <div class="ta-region">${taEsc(t.name)}</div>
    <h3 class="ta-name${t.war_name ? "" : " is-empty"}">${taEsc(taTitle(t))}</h3>
    <p class="ta-motto">${t.motto ? `“${taEsc(t.motto)}”` : (taCanEdit(t) ? "Escolha um grito de guerra ✎" : "&nbsp;")}</p>
    <p class="ta-manager">Gerente: <strong>${taEsc(t.manager_name || "a definir")}</strong> · ${t.members.length} no time</p>
    <div class="ta-kpis">
      <div><strong>${taNum(t.won)}</strong><span>vendas</span></div>
      <div><strong>${taNum(t.leads)}</strong><span>leads</span></div>
      <div><strong>${taPct(t.conv)}</strong><span>conversão</span></div>
      <div><strong>${taNum(t.meetings)}</strong><span>reuniões</span></div>
    </div>
    ${showRev ? `<div class="ta-rev">${currency(t.revenue)} em vendas</div>` : ""}
    <div class="ta-points"><b>${taNum(t.points)}</b> pontos</div>
    <span class="ta-go">Ver painel do time ›</span>
  </div>`;
}

/* barra de comparação lado a lado de um KPI */
function taVersusRow(label, key, fmt) {
  const list = ta.teams.filter(t => t[key] != null);
  if (!list.length) return "";
  const max = Math.max(...list.map(t => t[key]), 1);
  const best = Math.max(...list.map(t => t[key]));
  return `<div class="ta-vs-row"><div class="ta-vs-label">${taEsc(label)}</div><div class="ta-vs-bars">
    ${taRanked().map(t => `<div class="ta-vs-line"><span class="ta-vs-team" style="--tc:${t.color}">${taEsc(t.war_name || t.name)}</span>
      <span class="ta-vs-track"><i style="width:${Math.max(2, (t[key] / max) * 100)}%; background:${t.color}"></i></span>
      <b>${fmt(t[key])}${t[key] === best && best > 0 ? " 👑" : ""}</b></div>`).join("")}
  </div></div>`;
}

function taRenderArena() {
  const ranked = taRanked();
  const r = taRange();
  return `
    <div class="ta-head">
      <div>
        <h2 class="ta-title">Arena dos Times</h2>
        <p class="ta-sub">Cada time com o seu nome de guerra. Venda, converta e suba no placar.</p>
      </div>
      <div class="subtabs ta-periods" id="ta-periods">
        ${TA_PERIODS.map(p => `<button type="button" class="subtab${p.key === ta.period ? " active" : ""}" data-ta-period="${p.key}">${p.label}</button>`).join("")}
      </div>
    </div>
    <div class="ta-grid">${ranked.map((t, i) => taCardHtml(t, i)).join("")}</div>
    <p class="ta-legend">Pontuação: <b>${TA_POINTS.won} pts</b> por venda · <b>${TA_POINTS.meeting} pts</b> por reunião realizada · <b>${TA_POINTS.responded} pt</b> por lead que respondeu · período de ${taEsc(r.from.split("-").reverse().join("/"))} a ${taEsc(r.to.split("-").reverse().join("/"))}</p>

    <div class="ta-grid-2">
      <div class="panel ta-panel">
        <div class="panel-header"><h2>Placar frente a frente</h2><span class="ta-note">👑 = líder no quesito</span></div>
        <div class="ta-vs">
          ${taVersusRow("Pontos", "points", taNum)}
          ${taVersusRow("Vendas fechadas", "won", taNum)}
          ${taVersusRow("Leads recebidos", "leads", taNum)}
          ${taVersusRow("Leads que responderam", "responded", taNum)}
          ${taVersusRow("Conversão (vendas ÷ leads)", "conv", taPct)}
          ${taVersusRow("Reuniões realizadas", "meetings", taNum)}
          ${taVersusRow("Faturamento", "revenue", currency)}
        </div>
      </div>
      <div class="panel ta-panel">
        <div class="panel-header"><h2>Corrida de vendas ${new Date().getFullYear()}</h2><span class="ta-note">vendas acumuladas mês a mês</span></div>
        <div class="ta-chart"><canvas id="ta-chart-race"></canvas></div>
      </div>
    </div>`;
}

/* ---- tela 2: painel de um time ---- */
function taRenderTeam(t) {
  const rank = taRanked().findIndex(x => x.id === t.id);
  const showRev = t.revenue != null;
  const kpi = (label, value, tone) => `<div class="stat-card ta-kpi" data-tone="${tone}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
  return `
    <button type="button" class="btn btn-ghost btn-sm ta-back" id="ta-back">← Todos os times</button>
    <div class="ta-hero" style="--tc:${t.color}">
      ${taAvatar(t, "xl")}
      <div class="ta-hero-text">
        <span class="ta-region">${taEsc(t.name)} · ${TA_MEDALS[rank] || rank + 1 + "º"} lugar</span>
        <h2>${taEsc(taTitle(t))}</h2>
        <p>${t.motto ? `“${taEsc(t.motto)}”` : ""}</p>
        <small>Gerente: ${taEsc(t.manager_name || "a definir")}</small>
      </div>
      ${taCanEdit(t) ? `<button type="button" class="btn btn-ghost btn-sm ta-hero-edit" data-ta-edit="${t.id}">✎ Editar time</button>` : ""}
      <div class="ta-hero-points"><b>${taNum(t.points)}</b><span>pontos</span></div>
    </div>
    <div class="stat-row ta-row">
      ${kpi("Vendas fechadas", taNum(t.won), "blue")}
      ${kpi("Leads recebidos", taNum(t.leads), "deep")}
      ${kpi("Conversão", taPct(t.conv), "orange")}
      ${kpi("Reuniões realizadas", taNum(t.meetings), "blue")}
      ${showRev ? kpi("Faturamento", currency(t.revenue), "deep") : ""}
    </div>
    <div class="panel ta-panel">
      <div class="panel-header"><h2>Quem está puxando o time</h2><span class="ta-note">ordenado por pontos</span></div>
      <table class="data-table ta-table"><thead><tr><th>#</th><th>Consultor</th><th>Leads</th><th>Responderam</th><th>Vendas</th><th>Conversão</th><th>Reuniões</th>${showRev ? "<th>Faturamento</th>" : ""}<th>Pontos</th></tr></thead><tbody>
        ${t.members.length ? t.members.map((m, i) => `<tr>
          <td>${TA_MEDALS[i] || i + 1}</td><td class="cell-primary">${taEsc(m.name)}${m.id === t.manager_id ? ` <span class="badge badge-neutral">gerente</span>` : ""}</td>
          <td>${taNum(m.leads)}</td><td>${taNum(m.responded)}</td><td><b>${taNum(m.won)}</b></td><td>${taPct(m.conv)}</td><td>${taNum(m.meetings)}</td>
          ${showRev ? `<td>${m.revenue == null ? "—" : currency(m.revenue)}</td>` : ""}
          <td><span class="ta-pts-bar"><i style="width:${t.members[0].points ? Math.max(4, (m.points / t.members[0].points) * 100) : 4}%; background:${t.color}"></i></span> <b>${taNum(m.points)}</b></td>
        </tr>`).join("") : `<tr><td colspan="9" class="muted-note">Nenhum consultor neste time ainda (defina em Usuários).</td></tr>`}
      </tbody></table>
    </div>
    <div class="panel ta-panel">
      <div class="panel-header"><h2>Vendas por mês · ${new Date().getFullYear()}</h2></div>
      <div class="ta-chart"><canvas id="ta-chart-team"></canvas></div>
    </div>`;
}

/* ---- gráficos ---- */
function taDestroyChart() { if (ta.chart) { ta.chart.destroy(); ta.chart = null; } }
function taDrawCharts() {
  taDestroyChart();
  if (typeof Chart === "undefined") return;
  const month = new Date().getMonth();
  const axis = { grid: { display: false }, border: { display: false }, ticks: { color: "#3c4a66", font: { size: 11 } } };
  const yAxis = { beginAtZero: true, grid: { color: "#eef2f7" }, border: { display: false }, ticks: { precision: 0, color: "#7c8aa0", font: { size: 11 } } };
  if (ta.open) {
    const t = ta.teams.find(x => x.id === ta.open);
    const canvas = taEl("ta-chart-team");
    if (!t || !canvas) return;
    ta.chart = new Chart(canvas, { type: "bar",
      data: { labels: TA_MONTHS, datasets: [{ label: "Vendas", data: ta.monthly[t.id] || Array(12).fill(0), backgroundColor: t.color, borderRadius: 6, maxBarThickness: 28 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: axis, y: yAxis } } });
    return;
  }
  const canvas = taEl("ta-chart-race");
  if (!canvas) return;
  const datasets = taRanked().map(t => {
    let acc = 0;
    const cum = (ta.monthly[t.id] || Array(12).fill(0)).map((v, i) => (i <= month ? (acc += v) : null));
    return { label: t.war_name || t.name, data: cum, borderColor: t.color, backgroundColor: t.color, tension: 0.25, pointRadius: 3, borderWidth: 3, spanGaps: false };
  });
  ta.chart = new Chart(canvas, { type: "line", data: { labels: TA_MONTHS, datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 10, color: "#3c4a66" } } }, scales: { x: axis, y: yAxis } } });
}

/* ---- render geral ---- */
function taRender() {
  const root = taEl("ta-root");
  if (!root) return;
  if (ta.loading && !ta.teams.length) { root.innerHTML = `<p class="muted-note ta-state">Carregando o placar dos times…</p>`; return; }
  if (ta.error) { root.innerHTML = `<p class="muted-note ta-state">${taEsc(ta.error)}</p>`; return; }
  if (!ta.teams.length) { root.innerHTML = `<p class="muted-note ta-state">Nenhum time cadastrado ainda.</p>`; return; }
  const t = ta.open ? ta.teams.find(x => x.id === ta.open) : null;
  root.innerHTML = t ? taRenderTeam(t) : taRenderArena();
  taDrawCharts();
}
function renderTimesArena() { taLoad(); }

/* ---- edição do time (ADM e gerente do time) ---- */
function taOpenEdit(id) {
  const t = ta.teams.find(x => x.id === id);
  if (!t || !taCanEdit(t)) return;
  const spanish = /latin/i.test(t.name);
  const names = TA_NAME_SUGGESTIONS[spanish ? "es" : "pt"], mottos = TA_MOTTO_SUGGESTIONS[spanish ? "es" : "pt"];
  taEl("ta-edit-id").value = t.id;
  taEl("ta-edit-region").textContent = t.name;
  taEl("ta-edit-war").value = t.war_name || "";
  taEl("ta-edit-motto").value = t.motto || "";
  taEl("ta-edit-color").value = t.color || "#3167a1";
  taEl("ta-edit-photo").value = "";
  taEl("ta-edit-names").innerHTML = names.map(n => `<button type="button" class="ta-chip" data-ta-name="${taEsc(n)}">${taEsc(n)}</button>`).join("");
  taEl("ta-edit-mottos").innerHTML = mottos.map(n => `<button type="button" class="ta-chip" data-ta-motto="${taEsc(n)}">${taEsc(n)}</button>`).join("");
  taEl("ta-edit-swatches").innerHTML = TA_COLORS.map(c => `<button type="button" class="ta-swatch${c === t.color ? " is-on" : ""}" data-ta-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join("");
  taEl("ta-edit-preview").innerHTML = taAvatar(t, "lg");
  taEl("ta-modal-backdrop").classList.add("open");
}
async function taSaveEdit(e) {
  e.preventDefault();
  const id = taEl("ta-edit-id").value;
  const t = ta.teams.find(x => x.id === id);
  if (!t) return;
  const btn = taEl("ta-edit-save");
  btn.disabled = true;
  const patch = { war_name: taEl("ta-edit-war").value.trim(), motto: taEl("ta-edit-motto").value.trim(), color: taEl("ta-edit-color").value };
  const file = taEl("ta-edit-photo").files[0];
  if (file) {
    if (!/^image\//.test(file.type) || file.size > 4 * 1024 * 1024) { alert("Escolha uma foto (imagem) de até 4 MB."); btn.disabled = false; return; }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${id}/foto-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("team-photos").upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) { console.error(up.error); alert("Não foi possível enviar a foto."); btn.disabled = false; return; }
    patch.photo_path = path;
  }
  const { error } = await supabase.from("teams").update(patch).eq("id", id);
  btn.disabled = false;
  if (error) { console.error(error); alert("Não foi possível salvar o time."); return; }
  Object.assign(t, patch);
  const global = typeof teams !== "undefined" ? teams.find(x => x.id === id) : null;
  if (global) global.name = t.name;
  taEl("ta-modal-backdrop").classList.remove("open");
  taRender();
}

/* ---- ligações ---- */
taEl("ta-root").addEventListener("click", e => {
  const edit = e.target.closest("[data-ta-edit]");
  if (edit) { e.stopPropagation(); taOpenEdit(edit.dataset.taEdit); return; }
  const period = e.target.closest("[data-ta-period]");
  if (period) { ta.period = period.dataset.taPeriod; taLoad(); return; }
  if (e.target.closest("#ta-back")) { ta.open = null; taRender(); return; }
  const open = e.target.closest("[data-ta-open]");
  if (open) { ta.open = open.dataset.taOpen; taRender(); window.scrollTo && taEl("ta-root").scrollIntoView({ block: "start" }); }
});
taEl("ta-root").addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-ta-open]")) { e.preventDefault(); ta.open = e.target.dataset.taOpen; taRender(); }
});
taEl("ta-modal-close").addEventListener("click", () => taEl("ta-modal-backdrop").classList.remove("open"));
taEl("ta-edit-cancel").addEventListener("click", () => taEl("ta-modal-backdrop").classList.remove("open"));
taEl("ta-modal-backdrop").addEventListener("click", e => { if (e.target === taEl("ta-modal-backdrop")) taEl("ta-modal-backdrop").classList.remove("open"); });
taEl("ta-edit-form").addEventListener("submit", taSaveEdit);
taEl("ta-edit-form").addEventListener("click", e => {
  const n = e.target.closest("[data-ta-name]"); if (n) taEl("ta-edit-war").value = n.dataset.taName;
  const m = e.target.closest("[data-ta-motto]"); if (m) taEl("ta-edit-motto").value = m.dataset.taMotto;
  const c = e.target.closest("[data-ta-color]"); if (c) {
    taEl("ta-edit-color").value = c.dataset.taColor;
    taEl("ta-edit-swatches").querySelectorAll(".ta-swatch").forEach(s => s.classList.toggle("is-on", s === c));
  }
});
taEl("ta-edit-photo").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f || !/^image\//.test(f.type)) return;
  taEl("ta-edit-preview").innerHTML = `<span class="ta-avatar ta-avatar-lg" style="--tc:${taEl("ta-edit-color").value}"><img src="${URL.createObjectURL(f)}" alt=""></span>`;
});

/* abas da tela Time: Times (arena) | Colaboradores (cadastro) */
function showTimeTab(tab) {
  document.querySelectorAll("#time-subtabs .subtab").forEach(b => b.classList.toggle("active", b.dataset.timeTab === tab));
  taEl("subview-time-arena").classList.toggle("active", tab === "arena");
  taEl("subview-time-cadastro").classList.toggle("active", tab === "cadastro");
  if (tab === "arena") { ta.open = null; renderTimesArena(); }
}
taEl("time-subtabs").addEventListener("click", e => {
  const b = e.target.closest("[data-time-tab]");
  if (b) showTimeTab(b.dataset.timeTab);
});
