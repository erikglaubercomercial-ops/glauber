/* ============================================================
   APP · ACOMPANHAMENTO — uso do App de Intercâmbio (visitantes
   anônimos e suas ações, ligados ao lead quando preenchem o
   formulário). Só leitura: chama as funções app_metricas,
   app_usuarios e app_linha_do_tempo do Supabase com a sessão do
   usuário logado; as permissões são conferidas dentro delas.
   Depende de script.js (session, t, escapeHtml, currency, leads,
   openLeadModal, statusLabel, TEMPERATURE_BADGE) e do Chart.js.
   ============================================================ */

const APPT_PAGE_SIZE = 25;
const APPT_SERIES_COLORS = { novos: "#3167a1", ativos: "#6faed6", leads: "#fb9d2d" };

const apptState = {
  inited: false,
  tab: "overview",
  rangeDays: 30,           // 7 | 30 | 90 | 0 (personalizado)
  customFrom: "",
  customTo: "",
  metrics: null,
  metricsError: null,
  metricsLoading: false,
  metricsReq: 0,
  sort: { key: "visitantes", dir: -1 },
  users: { page: 1, data: null, error: null, loading: false, req: 0 },
  chart: null,
  leadToken: 0,
};

/* ---------- utilidades ---------- */
function apptRole() { return session ? session.role : ""; }
function apptIsManager() { return apptRole() === "ADM" || apptRole() === "Gerente"; }

function apptIsoDate(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function apptNum(v) { return (Number(v) || 0).toLocaleString("pt-BR"); }
function apptPct(v) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${(Math.round(v * 10) / 10).toLocaleString("pt-BR")}%`;
}
function apptRatio(a, b) { return b > 0 ? (a / b) * 100 : null; }

function apptTitleCase(s) {
  return String(s || "").replace(/[-_]+/g, " ").replace(/(^|\s)\S/g, m => m.toUpperCase());
}
const APPT_LABELS = {
  manha: "Manhã", tarde: "Tarde", noite: "Noite",
  pt: "Português", en: "Inglês", es: "Espanhol",
  ios: "iOS", android: "Android", computador: "Computador", desconhecida: "Desconhecida",
  ned: "NED",
};
function apptLabel(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return "—";
  const key = raw.toLowerCase();
  if (APPT_LABELS[key]) return APPT_LABELS[key];
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw.slice(5)}/${raw.slice(0, 4)}`;
  return apptTitleCase(raw).replace(/\bNed\b/g, "NED");
}

function apptDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function apptAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return t("appt.agoNow");
  if (min < 60) return t("appt.agoMin").replace("{n}", min);
  const h = Math.floor(min / 60);
  if (h < 24) return t("appt.agoHour").replace("{n}", h);
  const d = Math.floor(h / 24);
  if (d < 30) return t("appt.agoDay").replace("{n}", d);
  return new Date(iso).toLocaleDateString("pt-BR");
}

function apptTempBadge(temp) {
  if (!temp) return `<span class="muted-note">—</span>`;
  return `<span class="badge ${TEMPERATURE_BADGE[temp] || "badge-neutral"}">${escapeHtml(statusLabel(temp))}</span>`;
}

/* chama a função do banco e traduz o erro: "perm" (42501), "other" */
async function apptRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const perm = error.code === "42501" || /permiss/i.test(error.message || "");
    if (!perm) console.error(`Erro em ${name}:`, error);
    return { data: null, error: perm ? "perm" : "other" };
  }
  return { data, error: null };
}
function apptErrorMessage(kind) {
  return kind === "perm" ? t("appt.noPermission") : t("appt.loadError");
}

/* ---------- entrada (chamada pelo switchView) ---------- */
function renderAppTracking() {
  if (!session) return;
  apptInit();
  const manager = apptIsManager();
  document.getElementById("appt-subtabs").style.display = manager ? "" : "none";
  if (!manager) apptState.tab = "users";
  apptSetTab(apptState.tab);
}

function apptSetTab(tab) {
  apptState.tab = tab;
  document.querySelectorAll("#appt-subtabs .subtab").forEach(b => b.classList.toggle("active", b.dataset.apptTab === tab));
  document.getElementById("subview-appt-overview").classList.toggle("active", tab === "overview");
  document.getElementById("subview-appt-users").classList.toggle("active", tab === "users");
  if (tab === "overview") apptLoadMetrics();
  else apptLoadUsers();
}

function apptInit() {
  if (apptState.inited) return;
  apptState.inited = true;

  document.getElementById("appt-subtabs").addEventListener("click", e => {
    const btn = e.target.closest("[data-appt-tab]");
    if (btn) apptSetTab(btn.dataset.apptTab);
  });

  /* período */
  const fromEl = document.getElementById("appt-from");
  const toEl = document.getElementById("appt-to");
  const today = new Date();
  toEl.value = apptState.customTo = apptIsoDate(today);
  const start = new Date(today); start.setDate(start.getDate() - 29);
  fromEl.value = apptState.customFrom = apptIsoDate(start);

  document.getElementById("appt-range-bar").addEventListener("click", e => {
    const btn = e.target.closest("[data-appt-range]");
    if (!btn) return;
    apptState.rangeDays = Number(btn.dataset.apptRange);
    apptRenderRangeBar();
    if (apptState.rangeDays > 0) apptLoadMetrics();
  });
  document.getElementById("appt-range-apply").addEventListener("click", () => {
    apptState.customFrom = fromEl.value;
    apptState.customTo = toEl.value;
    apptLoadMetrics();
  });
  apptRenderRangeBar();

  /* ordenação da tabela de origens */
  document.getElementById("appt-overview-body").addEventListener("click", e => {
    const th = e.target.closest("[data-appt-sort]");
    if (!th) return;
    const key = th.dataset.apptSort;
    apptState.sort = { key, dir: apptState.sort.key === key ? -apptState.sort.dir : (key === "origem" ? 1 : -1) };
    apptRenderOverview();
  });

  /* usuários: filtros */
  const reloadUsers = () => { apptState.users.page = 1; apptLoadUsers(); };
  let searchTimer = null;
  document.getElementById("appt-u-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reloadUsers, 300);
  });
  ["appt-u-onlyleads", "appt-u-temp", "appt-u-from", "appt-u-to"].forEach(id => {
    document.getElementById(id).addEventListener("change", reloadUsers);
  });
  document.getElementById("appt-u-origin").addEventListener("change", reloadUsers);
  document.getElementById("appt-u-clear").addEventListener("click", () => {
    document.getElementById("appt-u-search").value = "";
    document.getElementById("appt-u-onlyleads").checked = false;
    document.getElementById("appt-u-temp").value = "";
    document.getElementById("appt-u-origin").value = "";
    document.getElementById("appt-u-from").value = "";
    document.getElementById("appt-u-to").value = "";
    reloadUsers();
  });
  document.getElementById("appt-u-pager").addEventListener("click", e => {
    const btn = e.target.closest("[data-appt-page]");
    if (!btn || btn.disabled) return;
    apptState.users.page = Number(btn.dataset.apptPage);
    apptLoadUsers();
  });
  document.getElementById("appt-u-tbody").addEventListener("click", e => {
    const openLead = e.target.closest("[data-appt-open-lead]");
    if (openLead) { e.stopPropagation(); apptOpenLead(openLead.dataset.apptOpenLead); return; }
    const row = e.target.closest("tr[data-appt-visitor]");
    if (row) apptOpenTimeline(row.dataset.apptVisitor);
  });
  document.getElementById("appt-u-onlyleads-wrap").style.display = apptIsManager() ? "" : "none";
  apptLoadOriginOptions();

  /* linha do tempo (modal) */
  const backdrop = document.getElementById("appt-timeline-backdrop");
  document.getElementById("appt-timeline-close").addEventListener("click", () => backdrop.classList.remove("open"));
  backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.classList.remove("open"); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") backdrop.classList.remove("open"); });
  document.getElementById("appt-timeline-body").addEventListener("click", e => {
    const btn = e.target.closest("[data-appt-open-lead]");
    if (btn) apptOpenLead(btn.dataset.apptOpenLead);
  });

  document.addEventListener("langchange", () => {
    apptRenderRangeBar();
    if (currentView !== "appacomp") return;
    if (apptState.tab === "overview") apptRenderOverview();
    else apptRenderUsers();
  });
}

function apptRenderRangeBar() {
  document.querySelectorAll("#appt-range-bar [data-appt-range]").forEach(b => {
    b.classList.toggle("active", Number(b.dataset.apptRange) === apptState.rangeDays);
  });
  document.getElementById("appt-custom-range").style.display = apptState.rangeDays === 0 ? "flex" : "none";
}

/* ============================================================
   VISÃO GERAL
   ============================================================ */
function apptCurrentRange() {
  if (apptState.rangeDays > 0) {
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - (apptState.rangeDays - 1));
    return { inicio: apptIsoDate(start), fim: apptIsoDate(end) };
  }
  return { inicio: apptState.customFrom, fim: apptState.customTo };
}

async function apptLoadMetrics() {
  const { inicio, fim } = apptCurrentRange();
  const body = document.getElementById("appt-overview-body");
  if (!inicio || !fim || inicio > fim) {
    apptState.metrics = null;
    body.innerHTML = `<p class="muted-note appt-state">${escapeHtml(t("appt.rangeInvalid"))}</p>`;
    return;
  }
  if ((new Date(fim) - new Date(inicio)) / 86400000 > 365) {
    apptState.metrics = null;
    body.innerHTML = `<p class="muted-note appt-state">${escapeHtml(t("appt.rangeTooLong"))}</p>`;
    return;
  }
  const req = ++apptState.metricsReq;
  apptState.metricsLoading = true;
  apptState.metricsError = null;
  apptRenderOverview();
  const { data, error } = await apptRpc("app_metricas", { p_inicio: inicio, p_fim: fim });
  if (req !== apptState.metricsReq) return;
  apptState.metricsLoading = false;
  apptState.metrics = data;
  apptState.metricsError = error;
  apptRenderOverview();
}

function apptDestroyChart() {
  if (apptState.chart) { apptState.chart.destroy(); apptState.chart = null; }
}

function apptRenderOverview() {
  const body = document.getElementById("appt-overview-body");
  const m = apptState.metrics;
  if (apptState.metricsLoading) {
    apptDestroyChart();
    body.innerHTML = `<p class="muted-note appt-state">${escapeHtml(t("appt.loading"))}</p>`;
    return;
  }
  if (apptState.metricsError) {
    apptDestroyChart();
    body.innerHTML = `<p class="muted-note appt-state">${escapeHtml(apptErrorMessage(apptState.metricsError))}</p>`;
    return;
  }
  if (!m) return;

  const resumo = m.resumo || {};
  const ativos = m.ativos || {};
  const serie = Array.isArray(m.serie) ? m.serie : [];
  const hasData = (resumo.visitantes_novos || 0) > 0 || (resumo.leads || 0) > 0 || (ativos.mes || 0) > 0
    || serie.some(s => (s.novos || 0) + (s.ativos || 0) + (s.leads || 0) > 0);
  if (!hasData) {
    apptDestroyChart();
    body.innerHTML = `<p class="muted-note appt-state">${escapeHtml(t("appt.empty"))}</p>`;
    return;
  }

  body.innerHTML = `
    <div class="stat-row appt-stat-row">
      <div class="stat-card"><span class="stat-label">${escapeHtml(t("appt.statNew"))}</span><span class="stat-value">${apptNum(resumo.visitantes_novos)}</span></div>
      <div class="stat-card">
        <span class="stat-label">${escapeHtml(t("appt.statActive"))}</span>
        <span class="appt-active-trio">
          <span><b>${apptNum(ativos.dia)}</b><small>${escapeHtml(t("appt.activeDay"))}</small></span>
          <span><b>${apptNum(ativos.semana)}</b><small>${escapeHtml(t("appt.activeWeek"))}</small></span>
          <span><b>${apptNum(ativos.mes)}</b><small>${escapeHtml(t("appt.activeMonth"))}</small></span>
        </span>
      </div>
      <div class="stat-card"><span class="stat-label">${escapeHtml(t("appt.statInstalled"))}</span><span class="stat-value">${apptNum(resumo.instalaram)}</span></div>
      <div class="stat-card"><span class="stat-label">${escapeHtml(t("appt.statLeads"))}</span><span class="stat-value">${apptNum(resumo.leads)}</span></div>
      <div class="stat-card"><span class="stat-label">${escapeHtml(t("appt.statSales"))}</span><span class="stat-value">${apptNum(resumo.vendas)}</span></div>
      <div class="stat-card"><span class="stat-label">${escapeHtml(t("appt.statValue"))}</span><span class="stat-value">${escapeHtml(currency(resumo.valor_vendas))}</span></div>
    </div>

    <div class="dash-grid-2 appt-grid">
      <div class="panel">
        <div class="panel-header"><h2>${escapeHtml(t("appt.funnel"))}</h2></div>
        <div class="appt-funnel">${apptFunnelHtml(m.funil)}</div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>${escapeHtml(t("appt.chartTitle"))}</h2></div>
        <div class="dash-chart-box"><canvas id="appt-chart"></canvas></div>
      </div>
    </div>

    <div class="panel appt-block">
      <div class="panel-header"><h2>${escapeHtml(t("appt.origins"))}</h2></div>
      ${apptOriginsHtml(m.origens)}
    </div>

    <div class="appt-intent-grid">${apptIntentHtml(m.intencao)}</div>

    <div class="dash-grid-2 appt-grid">
      <div class="panel">
        <div class="panel-header"><h2>${escapeHtml(t("appt.screens"))}</h2></div>
        ${apptScreensHtml(m.telas)}
      </div>
      <div class="panel">
        <div class="panel-header"><h2>${escapeHtml(t("appt.return"))}</h2></div>
        ${apptReturnHtml(m.retorno, m.horas_ate_virar_lead)}
      </div>
    </div>`;

  apptDrawChart(serie);
}

function apptFunnelHtml(funil) {
  const steps = Array.isArray(funil) ? funil : [];
  if (!steps.length) return `<p class="muted-note">${escapeHtml(t("appt.empty"))}</p>`;
  const max = Math.max(1, ...steps.map(s => Number(s.total) || 0));
  return steps.map((s, i) => {
    const total = Number(s.total) || 0;
    const prev = i > 0 ? Number(steps[i - 1].total) || 0 : null;
    let pctHtml = "";
    if (prev !== null) {
      const pct = apptRatio(total, prev);
      pctHtml = pct === null || pct > 100
        ? `<span class="appt-funnel-pct" title="${escapeHtml(t("appt.nonSequential"))}">—</span>`
        : `<span class="appt-funnel-pct" title="${escapeHtml(t("appt.ofPrevious"))}">${apptPct(pct)}</span>`;
    }
    const width = total === 0 ? 2 : Math.max(4, Math.round((total / max) * 100));
    return `
      <div class="appt-funnel-row">
        <div class="appt-funnel-label">${escapeHtml(s.etapa)}</div>
        <div class="appt-funnel-track"><div class="appt-funnel-fill" style="width:${width}%;"></div></div>
        <div class="appt-funnel-num"><b>${apptNum(total)}</b>${pctHtml}</div>
      </div>`;
  }).join("") + `<p class="muted-note appt-funnel-note">${escapeHtml(t("appt.funnelNote"))}</p>`;
}

function apptDrawChart(serie) {
  apptDestroyChart();
  const canvas = document.getElementById("appt-chart");
  if (!canvas || typeof Chart === "undefined") return;
  const labels = serie.map(s => {
    const [, mo, d] = String(s.dia).split("-");
    return `${d}/${mo}`;
  });
  const ds = (key, label) => ({
    label, data: serie.map(s => Number(s[key]) || 0),
    borderColor: APPT_SERIES_COLORS[key], backgroundColor: APPT_SERIES_COLORS[key],
    borderWidth: 2, pointRadius: serie.length > 45 ? 0 : 2.5, tension: 0.3,
  });
  apptState.chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [ds("novos", t("appt.serNew")), ds("ativos", t("appt.serActive")), ds("leads", t("appt.serLeads"))] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, autoSkip: true } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function apptOriginsHtml(origens) {
  const rows = (Array.isArray(origens) ? origens : []).map(o => ({
    origem: o.origem || "—",
    visitantes: Number(o.visitantes) || 0,
    leads: Number(o.leads) || 0,
    vendas: Number(o.vendas) || 0,
    valor: Number(o.valor) || 0,
  })).map(o => ({ ...o, v2l: apptRatio(o.leads, o.visitantes), l2s: apptRatio(o.vendas, o.leads) }));
  if (!rows.length) return `<p class="muted-note appt-state">${escapeHtml(t("appt.empty"))}</p>`;

  const { key, dir } = apptState.sort;
  rows.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (typeof av === "string") return av.localeCompare(bv, "pt-BR") * dir;
    return ((av ?? -1) - (bv ?? -1)) * dir;
  });
  const th = (k, label, cls = "") => {
    const arrow = apptState.sort.key === k ? (apptState.sort.dir > 0 ? " ▲" : " ▼") : "";
    return `<th class="appt-sortable ${cls}" data-appt-sort="${k}">${escapeHtml(label)}${arrow}</th>`;
  };
  return `
    <div class="table-scroll">
      <table class="data-table data-table-list appt-origins-table">
        <thead><tr>
          ${th("origem", t("appt.colOrigin"))}${th("visitantes", t("appt.colVisitors"), "num")}${th("leads", t("appt.colLeads"), "num")}
          ${th("vendas", t("appt.colSales"), "num")}${th("valor", t("appt.colValue"), "num")}
          ${th("v2l", t("appt.colVisitorToLead"), "num")}${th("l2s", t("appt.colLeadToSale"), "num")}
        </tr></thead>
        <tbody>${rows.map(o => `
          <tr class="appt-static-row">
            <td><b>${escapeHtml(o.origem)}</b></td>
            <td class="num">${apptNum(o.visitantes)}</td><td class="num">${apptNum(o.leads)}</td>
            <td class="num">${apptNum(o.vendas)}</td><td class="num">${escapeHtml(currency(o.valor))}</td>
            <td class="num">${apptPct(o.v2l)}</td><td class="num">${apptPct(o.l2s)}</td>
          </tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function apptIntentHtml(intencao) {
  const it = intencao || {};
  const blocks = [
    ["destinos", "appt.intDestinos"], ["cidades", "appt.intCidades"], ["escolas", "appt.intEscolas"],
    ["turnos", "appt.intTurnos"], ["embarque", "appt.intEmbarque"], ["orcamentos", "appt.intOrcamentos"],
    ["objetivos", "appt.intObjetivos"], ["plataformas", "appt.platforms"], ["idiomas", "appt.languages"],
  ];
  return blocks.map(([key, i18nKey]) => {
    const list = (Array.isArray(it[key]) ? it[key] : [])
      .map(x => ({ nome: x.nome, total: Number(x.total) || 0 }))
      .sort((a, b) => b.total - a.total).slice(0, 5);
    const max = Math.max(1, ...list.map(x => x.total));
    const content = list.length
      ? list.map(x => `
        <div class="appt-top-row">
          <span class="appt-top-name">${escapeHtml(apptLabel(x.nome))}</span>
          <span class="appt-top-bar"><span style="width:${Math.max(6, Math.round((x.total / max) * 100))}%;"></span></span>
          <b>${apptNum(x.total)}</b>
        </div>`).join("")
      : `<p class="muted-note">—</p>`;
    return `<div class="panel appt-top-panel"><div class="panel-header"><h2>${escapeHtml(t(i18nKey))}</h2></div><div class="appt-top-body">${content}</div></div>`;
  }).join("");
}

function apptScreensHtml(telas) {
  const rows = Array.isArray(telas) ? telas : [];
  if (!rows.length) return `<p class="muted-note appt-state">${escapeHtml(t("appt.empty"))}</p>`;
  return `
    <div class="table-scroll">
      <table class="data-table data-table-list">
        <thead><tr><th>${escapeHtml(t("appt.colScreen"))}</th><th class="num">${escapeHtml(t("appt.colOpenings"))}</th><th class="num">${escapeHtml(t("appt.colPeople"))}</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr class="appt-static-row"><td>${escapeHtml(r.tela)}</td><td class="num">${apptNum(r.aberturas)}</td><td class="num">${apptNum(r.pessoas)}</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function apptReturnHtml(retorno, horas) {
  const r = retorno || {};
  const cell = (label, v) => `
    <div class="appt-return-cell">
      <b>${v === null || v === undefined ? "—" : apptPct(Number(v))}</b>
      <small>${escapeHtml(label)}</small>
    </div>`;
  const hasHours = horas !== null && horas !== undefined && isFinite(horas);
  return `
    <div class="appt-return">
      <div class="appt-return-row">${cell("D1", r.d1)}${cell("D7", r.d7)}${cell("D30", r.d30)}</div>
      <p class="muted-note">${escapeHtml(t("appt.returnHint"))}</p>
      <div class="appt-ttl">
        <small>${escapeHtml(t("appt.timeToLead"))}</small>
        <b>${hasHours ? apptHours(Number(horas)) : "—"}</b>
      </div>
    </div>`;
}
function apptHours(h) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${(Math.round(h * 10) / 10).toLocaleString("pt-BR")} h`;
  return `${(Math.round((h / 24) * 10) / 10).toLocaleString("pt-BR")} ${t("appt.days")}`;
}

/* ============================================================
   USUÁRIOS
   ============================================================ */
async function apptLoadOriginOptions() {
  /* sugestões de origem (códigos dos influenciadores); se a leitura
     não for permitida pro papel, o campo segue aceitando texto livre */
  try {
    const { data, error } = await supabase.from("app_parceiros").select("codigo, nome").order("nome");
    if (error || !Array.isArray(data)) return;
    document.getElementById("appt-u-origin-list").innerHTML = data
      .map(p => `<option value="${escapeHtml(p.codigo)}">${escapeHtml(p.nome || p.codigo)}</option>`).join("");
  } catch (err) { /* sem sugestões */ }
}

async function apptLoadUsers() {
  const st = apptState.users;
  const startVal = document.getElementById("appt-u-from").value;
  const endVal = document.getElementById("appt-u-to").value;
  const p = {
    so_leads: apptIsManager() ? document.getElementById("appt-u-onlyleads").checked : true,
    temperatura: document.getElementById("appt-u-temp").value,
    origem: document.getElementById("appt-u-origin").value.trim(),
    busca: document.getElementById("appt-u-search").value.trim(),
    inicio: startVal, fim: endVal,
    limite: APPT_PAGE_SIZE, pagina: st.page,
  };
  const req = ++st.req;
  st.loading = true;
  st.error = null;
  apptRenderUsers();
  const { data, error } = await apptRpc("app_usuarios", { p });
  if (req !== st.req) return;
  st.loading = false;
  st.data = data;
  st.error = error;
  apptRenderUsers();
}

function apptRenderUsers() {
  const st = apptState.users;
  const tbody = document.getElementById("appt-u-tbody");
  const stateEl = document.getElementById("appt-u-state");
  const pager = document.getElementById("appt-u-pager");
  const table = document.getElementById("appt-u-table-wrap");
  const setState = (msg) => { stateEl.textContent = msg; stateEl.style.display = msg ? "block" : "none"; };

  if (st.loading) { setState(t("appt.loading")); pager.innerHTML = ""; table.style.display = "none"; return; }
  if (st.error) { setState(apptErrorMessage(st.error)); pager.innerHTML = ""; table.style.display = "none"; return; }
  const list = st.data && Array.isArray(st.data.usuarios) ? st.data.usuarios : [];
  if (!list.length) { setState(t("appt.empty")); pager.innerHTML = ""; table.style.display = "none"; return; }
  setState("");
  table.style.display = "";

  tbody.innerHTML = list.map(u => `
    <tr data-appt-visitor="${escapeHtml(u.visitor_id)}">
      <td>
        <div class="appt-user-name">${escapeHtml(u.rotulo || "—")}${u.lead_id ? "" : ` <span class="badge badge-neutral">${escapeHtml(t("appt.anonymous"))}</span>`}</div>
        <div class="appt-user-sub">${escapeHtml(apptLabel(u.plataforma))} · ${escapeHtml(apptLabel(u.idioma))} · ${apptNum(u.acoes)} ${escapeHtml(t("appt.actionsShort"))}</div>
      </td>
      <td>${escapeHtml(u.origem || "—")}</td>
      <td><span class="badge badge-cold">${escapeHtml(u.etapa || "—")}</span></td>
      <td>${escapeHtml(u.destino ? apptLabel(u.destino) : "—")}</td>
      <td>${apptTempBadge(u.temperatura)}</td>
      <td class="appt-center">${u.instalado ? `<span class="appt-installed" title="${escapeHtml(t("appt.installed"))}">${APPT_CHECK_SVG}</span>` : `<span class="muted-note">—</span>`}</td>
      <td title="${escapeHtml(apptDateTime(u.ultimo_acesso))}">${escapeHtml(apptAgo(u.ultimo_acesso))}</td>
      <td class="appt-center">${u.lead_id ? `<button type="button" class="btn btn-ghost btn-sm" data-appt-open-lead="${escapeHtml(u.lead_id)}">${escapeHtml(t("appt.openLead"))}</button>` : ""}</td>
    </tr>`).join("");

  const total = Number(st.data.total) || list.length;
  const limit = Number(st.data.limite) || APPT_PAGE_SIZE;
  const page = Number(st.data.pagina) || st.page;
  const pages = Math.max(1, Math.ceil(total / limit));
  pager.innerHTML = `
    <span class="muted-note">${escapeHtml(t("appt.pageInfo").replace("{p}", page).replace("{n}", pages).replace("{total}", apptNum(total)))}</span>
    <div class="appt-pager-btns">
      <button type="button" class="btn btn-ghost btn-sm" data-appt-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>${escapeHtml(t("appt.prev"))}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-appt-page="${page + 1}" ${page >= pages ? "disabled" : ""}>${escapeHtml(t("appt.next"))}</button>
    </div>`;
}

const APPT_CHECK_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

/* abre a ficha do lead (por cima de qualquer modal da tela) */
function apptOpenLead(leadId) {
  if (!leadId) return;
  if (!leads.some(l => l.id === leadId)) { alert(t("appt.leadNotFound")); return; }
  document.getElementById("appt-timeline-backdrop").classList.remove("open");
  openLeadModal(leadId);
}

/* ============================================================
   LINHA DO TEMPO
   ============================================================ */
async function apptFetchTimeline(visitorId) {
  const { data, error } = await apptRpc("app_linha_do_tempo", { p_visitor: visitorId });
  if (!error && !data) return { data: null, error: "other" };
  return { data, error };
}

async function apptOpenTimeline(visitorId) {
  const backdrop = document.getElementById("appt-timeline-backdrop");
  const body = document.getElementById("appt-timeline-body");
  const title = document.getElementById("appt-timeline-title");
  title.textContent = t("appt.timelineTitle");
  body.innerHTML = `<p class="muted-note appt-state">${escapeHtml(t("appt.loading"))}</p>`;
  backdrop.classList.add("open");
  const { data, error } = await apptFetchTimeline(visitorId);
  if (!backdrop.classList.contains("open")) return;
  if (error) { body.innerHTML = `<p class="muted-note appt-state">${escapeHtml(apptErrorMessage(error))}</p>`; return; }
  title.textContent = data.rotulo || t("appt.timelineTitle");
  body.innerHTML = apptTimelineHtml(data, { full: true });
}

function apptPlanText(plano) {
  if (!plano) return "";
  if (typeof plano === "string") return plano;
  if (typeof plano !== "object") return String(plano);
  const preferred = ["destino", "cidade", "escola", "turno", "embarque"];
  const parts = preferred.map(k => plano[k]).filter(v => v !== null && v !== undefined && v !== "" && typeof v !== "object");
  const list = parts.length ? parts : Object.values(plano).filter(v => v !== null && v !== "" && typeof v !== "object");
  return list.map(apptLabel).join(" · ");
}

function apptUtmText(utm) {
  if (!utm || typeof utm !== "object") return "";
  return Object.entries(utm).filter(([, v]) => v !== null && v !== "" && typeof v !== "object")
    .map(([k, v]) => `${k.replace(/^utm_/, "")}: ${v}`).join(" · ");
}

/* opts.full: cabeçalho completo (modal); sem ele, só a lista (ficha do lead) */
function apptTimelineHtml(d, opts = {}) {
  const events = Array.isArray(d.eventos) ? d.eventos : [];
  let header = "";
  if (opts.full) {
    const meta = (label, value) => value ? `<div class="appt-meta-item"><small>${escapeHtml(label)}</small><span>${escapeHtml(value)}</span></div>` : "";
    const plan = apptPlanText(d.plano);
    const utm = apptUtmText(d.utm);
    header = `
      <div class="appt-tl-head">
        <div class="appt-tl-badges">
          ${apptTempBadge(d.temperatura)}
          ${d.status ? `<span class="badge badge-neutral">${escapeHtml(statusLabel(d.status))}</span>` : ""}
          ${d.instalado ? `<span class="badge badge-good">${escapeHtml(t("appt.installed"))}</span>` : ""}
          ${d.lead_id ? `<button type="button" class="btn btn-primary btn-sm" data-appt-open-lead="${escapeHtml(d.lead_id)}">${escapeHtml(t("appt.openLead"))}</button>` : ""}
        </div>
        <div class="appt-meta-grid">
          ${meta(t("appt.colOrigin"), d.origem)}
          ${meta(t("appt.metaPlatform"), d.plataforma ? apptLabel(d.plataforma) : "")}
          ${meta(t("appt.metaLanguage"), d.idioma ? apptLabel(d.idioma) : "")}
          ${meta(t("appt.metaFirst"), d.primeiro_acesso ? apptDateTime(d.primeiro_acesso) : "")}
          ${meta(t("appt.metaLast"), d.ultimo_acesso ? apptDateTime(d.ultimo_acesso) : "")}
          ${meta(t("appt.metaPlan"), plan)}
          ${meta("UTM", utm)}
        </div>
      </div>`;
  }
  if (!events.length) return header + `<p class="muted-note appt-state">${escapeHtml(t("appt.noEvents"))}</p>`;

  const groups = [];
  events.forEach(ev => {
    const dt = new Date(ev.em);
    const key = isNaN(dt) ? "?" : apptIsoDate(dt);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, dt, items: [] }; groups.push(g); }
    g.items.push({ dt, text: ev.descricao || ev.tipo || "" });
  });
  const dayLabel = g => {
    if (isNaN(g.dt)) return "—";
    const txt = g.dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  };
  const timeLabel = dt => isNaN(dt) ? "" : dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return header + `<div class="appt-timeline">${groups.map(g => `
    <div class="appt-day">
      <div class="appt-day-title">${escapeHtml(dayLabel(g))}</div>
      ${g.items.map(i => `
        <div class="appt-event">
          <span class="appt-event-time">${escapeHtml(timeLabel(i.dt))}</span>
          <span class="appt-event-dot"></span>
          <span class="appt-event-text">${escapeHtml(i.text)}</span>
        </div>`).join("")}
    </div>`).join("")}</div>`;
}

/* ============================================================
   FICHA DO LEAD — seção "Atividade no app"
   ============================================================ */
async function apptSetupLeadActivity(leadId) {
  const details = document.getElementById("lead-app-activity");
  if (!details) return;
  const token = ++apptState.leadToken;
  details.style.display = "none";
  details.open = false;
  details.dataset.visitor = "";
  details.dataset.loaded = "";
  document.getElementById("lead-app-activity-body").innerHTML = "";
  if (!leadId) return;
  try {
    const { data, error } = await supabase.from("app_visitantes").select("visitor_id")
      .eq("lead_id", leadId).order("ultimo_acesso", { ascending: false }).limit(1);
    if (token !== apptState.leadToken) return;
    if (error || !data || !data.length) return;
    details.dataset.visitor = data[0].visitor_id;
    details.style.display = "";
  } catch (err) { /* sem visitante ligado: seção segue escondida */ }
}

async function apptLeadActivityToggled() {
  const details = document.getElementById("lead-app-activity");
  if (!details.open || details.dataset.loaded === "1" || !details.dataset.visitor) return;
  const body = document.getElementById("lead-app-activity-body");
  const token = apptState.leadToken;
  body.innerHTML = `<p class="muted-note">${escapeHtml(t("appt.loading"))}</p>`;
  const { data, error } = await apptFetchTimeline(details.dataset.visitor);
  if (token !== apptState.leadToken) return;
  if (error) { body.innerHTML = `<p class="muted-note">${escapeHtml(apptErrorMessage(error))}</p>`; return; }
  details.dataset.loaded = "1";
  body.innerHTML = apptTimelineHtml(data, { full: false });
}

/* a ficha do lead existe desde o carregamento (não depende de abrir a
   tela do app antes), então o ouvinte é ligado já aqui */
document.getElementById("lead-app-activity").addEventListener("toggle", apptLeadActivityToggled);
