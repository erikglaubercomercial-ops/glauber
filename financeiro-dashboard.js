/* ============================================================
   FINANCEIRO · DASHBOARD — primeira tela do menu Financeiro.
   Só LÊ os dados que o sistema já tem (negócios ganhos, despesas, contas a
   receber, comissões, envios às escolas, tráfego pago, partilha das vendas);
   nenhuma fórmula existente foi alterada:
     • Receita total   = soma dos negócios Ganhos fechados no período
                         (a mesma do antigo "Faturamento (mês)")
     • Despesas totais = despesas cadastradas com vencimento no período
     • Resultado       = Receita − Despesas (o antigo "Lucro líquido")
     • A receber       = contas a receber pendentes (como antes)
   Métricas novas: fluxo de caixa, contas em atraso, comissões a pagar,
   ganho da Peregrinos na venda (bruto/líquido), ticket médio e variação
   contra o período anterior.
   Depende de script.js: deals, expenses, receivables, commissions,
   influencerCommissions, schoolTransfers, schoolCommissions, adSpend,
   saleSplits, currency, escapeHtml, isWonStage, commissionRelease, leadLink.
   ============================================================ */

const FD_PERIODS = [
  { key: "month", label: "Este mês" },
  { key: "lastmonth", label: "Mês passado" },
  { key: "3m", label: "3 meses" },
  { key: "year", label: "Este ano" },
  { key: "lastyear", label: "Ano passado" },
];
const FD_MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const FD_BLUE = "#3167a1", FD_NAVY = "#1f4670", FD_ORANGE = "#e8751a", FD_LIGHT = "#6faed6";
const FD_DONUT = ["#1f4670", "#3167a1", "#6faed6", "#e8751a", "#fb9d2d", "#8891a5", "#16a34a", "#9b6dd6"];

const fdState = { period: "year" };
const fdCharts = {};

/* ---- períodos ---- */
function fdRange(key) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const tomorrow = new Date(y, m, now.getDate() + 1);
  switch (key) {
    case "month": return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1), pStart: new Date(y, m - 1, 1), pEnd: new Date(y, m, 1), months: "trailing" };
    case "lastmonth": return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), pStart: new Date(y, m - 2, 1), pEnd: new Date(y, m - 1, 1), months: "trailing" };
    case "3m": return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 1), pStart: new Date(y, m - 5, 1), pEnd: new Date(y, m - 2, 1), months: "trailing" };
    case "lastyear": return { start: new Date(y - 1, 0, 1), end: new Date(y, 0, 1), pStart: new Date(y - 2, 0, 1), pEnd: new Date(y - 1, 0, 1), months: "year", year: y - 1 };
    default: return { start: new Date(y, 0, 1), end: tomorrow, pStart: new Date(y - 1, 0, 1), pEnd: new Date(y - 1, m, now.getDate() + 1), months: "year", year: y };
  }
}
/* os 12 meses do gráfico: ano civil (Este ano / Ano passado) ou 12 meses até o fim do período */
function fdMonthsOf(range) {
  const list = [];
  if (range.months === "year") {
    for (let i = 0; i < 12; i++) list.push(new Date(range.year, i, 1));
  } else {
    const last = new Date(range.end.getFullYear(), range.end.getMonth() - 1, 1);
    for (let i = 11; i >= 0; i--) list.push(new Date(last.getFullYear(), last.getMonth() - i, 1));
  }
  return list;
}

/* ---- leitura dos dados (data em ms) ---- */
const fdDay = iso => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).getTime() : null);
const fdIn = (ts, a, b) => ts != null && ts >= a.getTime() && ts < b.getTime();
const fdSum = (list, pick) => list.reduce((s, x) => s + (Number(pick(x)) || 0), 0);

function fdWonDeals(a, b) { return deals.filter(d => isWonStage(d.stage) && d.closedAt && fdIn(d.closedAt, a, b)); }
function fdExpenses(a, b) { return expenses.filter(e => fdIn(fdDay(e.dueDate), a, b)); }

/* entradas e saídas de caixa (o que efetivamente entrou/saiu no período) */
function fdCashIn(a, b) {
  const fromReceivables = fdSum(receivables.filter(r => r.paid && fdIn(r.paidAt, a, b)), r => r.amount);
  const fromSchools = fdSum(schoolCommissions.filter(c => c.status === "Recebido" && fdIn(fdDay(c.received), a, b)), c => c.amount);
  return fromReceivables + fromSchools;
}
function fdCashOutParts(a, b) {
  return {
    "Despesas pagas": fdSum(expenses.filter(e => e.paid && fdIn(e.paidAt || fdDay(e.dueDate), a, b)), e => e.amount),
    "Comissões pagas": fdSum(commissions.filter(c => c.status === "Pago" && fdIn(c.paidAt, a, b)), c => c.amount)
      + fdSum(influencerCommissions.filter(c => c.status === "Pago" && fdIn(c.paidAt, a, b)), c => c.amount),
    "Envios às escolas": fdSum(schoolTransfers.filter(x => fdIn(fdDay(x.sentAt), a, b)), x => x.amount),
    "Tráfego pago": fdSum(adSpend.filter(x => fdIn(fdDay(x.spendDate), a, b)), x => x.amount),
  };
}
const fdCashOut = (a, b) => Object.values(fdCashOutParts(a, b)).reduce((s, v) => s + v, 0);

/* ganho da Peregrinos nas vendas do período (partilha de cada venda) */
function fdSplits(a, b) {
  const ids = new Set(fdWonDeals(a, b).map(d => d.id));
  return saleSplits.filter(sp => ids.has(sp.dealId));
}

/* ---- formatação ---- */
function fdVar(cur, prev, goodWhenUp) {
  if (!prev) return cur ? `<span class="fd-var is-flat">novo no período</span>` : `<span class="fd-var is-flat">—</span>`;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.05) return `<span class="fd-var is-flat">= período anterior</span>`;
  const up = pct > 0;
  const good = up === goodWhenUp;
  return `<span class="fd-var ${good ? "is-good" : "is-bad"}">${up ? "▲" : "▼"} ${Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span> <span class="fd-vs">vs período anterior</span>`;
}
/* tone: cor da paleta Peregrinos (blue, deep, orange, red); vermelho só para o que é alerta */
function fdKpi(label, value, sub, tip, tone) {
  return `<div class="stat-card fd-kpi" data-tone="${tone}" title="${escapeHtml(tip || "")}">
    <span class="stat-label">${escapeHtml(label)}</span>
    <span class="stat-value">${value}</span>
    <span class="stat-sub">${sub}</span>
  </div>`;
}

/* ---- render ---- */
function renderFinDashboard() {
  const root = document.getElementById("fd-root");
  if (!root) return;
  Object.keys(fdCharts).forEach(k => { fdCharts[k].destroy(); delete fdCharts[k]; });

  const r = fdRange(fdState.period);
  const wonNow = fdWonDeals(r.start, r.end), wonPrev = fdWonDeals(r.pStart, r.pEnd);
  const revenue = fdSum(wonNow, d => d.value), revenuePrev = fdSum(wonPrev, d => d.value);
  const expNow = fdExpenses(r.start, r.end), expPrev = fdExpenses(r.pStart, r.pEnd);
  const expTotal = fdSum(expNow, e => e.amount), expPrevTotal = fdSum(expPrev, e => e.amount);
  const result = revenue - expTotal, resultPrev = revenuePrev - expPrevTotal;
  const cashIn = fdCashIn(r.start, r.end), cashOut = fdCashOut(r.start, r.end);
  const cash = cashIn - cashOut;
  const cashPrev = fdCashIn(r.pStart, r.pEnd) - fdCashOut(r.pStart, r.pEnd);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const pending = receivables.filter(x => !x.paid);
  const pendingTotal = fdSum(pending, x => x.amount);
  const overdue = pending.filter(x => fdDay(x.dueDate) < today.getTime());
  const unpaidComm = commissions.filter(c => c.status !== "Pago");
  const unpaidCommTotal = fdSum(unpaidComm, c => c.amount);
  const releasedComm = fdSum(unpaidComm.filter(c => commissionRelease(c.dealId).released), c => c.amount);
  const spNow = fdSplits(r.start, r.end), spPrev = fdSplits(r.pStart, r.pEnd);
  const gain = fdSum(spNow, s => s.peregrinosNet), gainPrev = fdSum(spPrev, s => s.peregrinosNet);
  const gross = fdSum(spNow, s => s.peregrinosGross);
  const ticket = wonNow.length ? revenue / wonNow.length : 0;

  /* categorias de despesa (período e período anterior) */
  const catNow = {}, catPrev = {};
  expNow.forEach(e => { catNow[e.category] = (catNow[e.category] || 0) + e.amount; });
  expPrev.forEach(e => { catPrev[e.category] = (catPrev[e.category] || 0) + e.amount; });
  const cats = Object.entries(catNow).sort((a, b) => b[1] - a[1]);

  /* recebimentos futuros e atrasados (próximos 30 dias) */
  const in30 = new Date(today); in30.setDate(in30.getDate() + 30);
  const upcoming = pending.filter(x => fdDay(x.dueDate) <= in30.getTime()).sort((a, b) => fdDay(a.dueDate) - fdDay(b.dueDate)).slice(0, 8);

  root.innerHTML = `
    <div class="fd-head">
      <div>
        <h2 class="fd-title">Financeiro</h2>
        <p class="fd-sub">Acompanhe receitas, despesas e fluxo de caixa. Identifique desvios.</p>
      </div>
      <div class="subtabs fd-periods" id="fd-periods">
        ${FD_PERIODS.map(p => `<button type="button" class="subtab${p.key === fdState.period ? " active" : ""}" data-fd-period="${p.key}">${p.label}</button>`).join("")}
      </div>
    </div>

    <div class="stat-row fd-row">
      ${fdKpi("Receita total", currency(revenue), `${fdVar(revenue, revenuePrev, true)}<br>${wonNow.length} venda(s) · ticket médio ${currency(ticket)}`, "Soma dos negócios Ganhos fechados no período (mesma fórmula do antigo Faturamento).", "blue")}
      ${fdKpi("Despesas totais", currency(expTotal), fdVar(expTotal, expPrevTotal, false), "Despesas cadastradas com vencimento no período.", "orange")}
      ${fdKpi("Resultado líquido", currency(result), fdVar(result, resultPrev, true), "Receita total − Despesas totais (mesma fórmula do antigo Lucro líquido).", "deep")}
      ${fdKpi("Fluxo de caixa", currency(cash), `${fdVar(cash, cashPrev, true)}<br>entrou ${currency(cashIn)} · saiu ${currency(cashOut)}`, "O que entrou (parcelas recebidas + comissões de escolas recebidas) menos o que saiu (despesas pagas, comissões pagas, envios às escolas e tráfego pago) no período.", "blue")}
    </div>
    <div class="stat-row fd-row">
      ${fdKpi("A receber (pendente)", currency(pendingTotal), `${pending.length} parcela(s) em aberto`, "Todas as contas a receber ainda não pagas.", "deep")}
      ${fdKpi("Em atraso", currency(fdSum(overdue, x => x.amount)), `${overdue.length} parcela(s) vencida(s)`, "Contas a receber não pagas com vencimento anterior a hoje.", "red")}
      ${fdKpi("Comissões a pagar", currency(unpaidCommTotal), `${currency(releasedComm)} já liberadas para pagar`, "Comissões de consultores ainda não pagas; 'liberadas' = cliente já pagou o mínimo exigido.", "orange")}
      ${fdKpi("Ganho líquido Peregrinos", currency(gain), `${fdVar(gain, gainPrev, true)}<br>bruto ${currency(gross)} nas vendas do período`, "Soma da partilha de cada venda do período: o que sobra para a Peregrinos depois de comissões, gerente e CAC.", "blue")}
    </div>

    <div class="fd-grid-2">
      <div class="panel fd-panel">
        <div class="panel-header"><h2>Receitas × Despesas</h2><span class="fd-note">${r.months === "year" ? `Ano ${r.year}` : "Últimos 12 meses"}</span></div>
        <div class="fd-chart"><canvas id="fd-chart-revexp"></canvas></div>
      </div>
      <div class="panel fd-panel">
        <div class="panel-header"><h2>Fluxo de caixa</h2><span class="fd-note">acumulado no gráfico</span></div>
        <div class="fd-chart"><canvas id="fd-chart-cash"></canvas></div>
      </div>
    </div>

    <div class="fd-grid-2">
      <div class="panel fd-panel">
        <div class="panel-header"><h2>Distribuição de despesas</h2><span class="fd-note">${fdFmtRange(r)}</span></div>
        ${cats.length ? `<div class="fd-donut-wrap">
          <div class="fd-donut"><canvas id="fd-chart-donut"></canvas><div class="fd-donut-center"><strong>${currency(expTotal)}</strong><span>Total</span></div></div>
          <ul class="fd-legend">${cats.map(([name, v], i) => `<li><span class="fd-dot" style="background:${FD_DONUT[i % FD_DONUT.length]}"></span><span class="fd-leg-name">${escapeHtml(name)}</span><b>${(v / expTotal * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b></li>`).join("")}</ul>
        </div>` : `<p class="muted-note fd-empty">Nenhuma despesa com vencimento neste período.</p>`}
      </div>
      <div class="panel fd-panel">
        <div class="panel-header"><h2>Principais categorias</h2><span class="fd-note">variação vs período anterior</span></div>
        ${cats.length ? `<table class="data-table fd-table"><thead><tr><th>Categoria</th><th>Valor</th><th>% do total</th><th>Variação</th></tr></thead><tbody>
          ${cats.slice(0, 8).map(([name, v]) => {
            const prev = catPrev[name] || 0;
            const pct = prev ? ((v - prev) / prev) * 100 : null;
            const cell = pct == null ? `<span class="fd-var is-flat">novo</span>` : Math.abs(pct) < 0.05 ? `<span class="fd-var is-flat">= igual</span>` : `<span class="fd-var ${pct > 0 ? "is-bad" : "is-good"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>`;
            return `<tr><td class="cell-primary">${escapeHtml(name)}</td><td>${currency(v)}</td><td>${(v / expTotal * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</td><td>${cell}</td></tr>`;
          }).join("")}
        </tbody></table>` : `<p class="muted-note fd-empty">Sem despesas no período.</p>`}
      </div>
    </div>

    <div class="panel fd-panel">
      <div class="panel-header"><h2>Próximos recebimentos e atrasos</h2><span class="fd-note">vencidos + próximos 30 dias</span></div>
      ${upcoming.length ? `<table class="data-table fd-table"><thead><tr><th>Cliente</th><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead><tbody>
        ${upcoming.map(x => {
          const late = fdDay(x.dueDate) < today.getTime();
          const days = Math.round((today.getTime() - fdDay(x.dueDate)) / 86400000);
          return `<tr><td class="cell-primary">${leadLink(leadIdOfDeal(x.dealId), x.clientName)}</td>
            <td class="cell-muted">${x.installmentNumber || 1}/${x.installmentsTotal || 1}</td>
            <td>${new Date(`${x.dueDate}T00:00:00`).toLocaleDateString("pt-BR")}</td>
            <td>${currency(x.amount)}</td>
            <td>${late ? `<span class="badge badge-danger">${days} dia(s) em atraso</span>` : `<span class="badge badge-neutral">a vencer</span>`}</td></tr>`;
        }).join("")}
      </tbody></table>` : `<p class="muted-note fd-empty">Nada vencido nem a vencer nos próximos 30 dias.</p>`}
    </div>`;

  /* gráficos */
  const months = fdMonthsOf(r);
  const monthRange = d => [d, new Date(d.getFullYear(), d.getMonth() + 1, 1)];
  const revM = months.map(d => fdSum(fdWonDeals(...monthRange(d)), x => x.value));
  const expM = months.map(d => fdSum(fdExpenses(...monthRange(d)), x => x.amount));
  const netM = months.map(d => fdCashIn(...monthRange(d)) - fdCashOut(...monthRange(d)));
  let acc = 0;
  const cumM = netM.map(v => (acc += v));
  const labels = months.map(d => FD_MONTHS[d.getMonth()] + (r.months === "trailing" ? ` ${String(d.getFullYear()).slice(2)}` : ""));
  const axis = { grid: { display: false }, border: { display: false }, ticks: { color: "#3c4a66", font: { size: 11 } } };
  const money = v => currency(v);
  const yAxis = { beginAtZero: true, grid: { color: "#eef2f7" }, border: { display: false }, ticks: { color: "#7c8aa0", font: { size: 11 }, callback: v => (Math.abs(v) >= 1000 ? (v / 1000).toLocaleString("pt-BR") + " mil" : v) } };

  fdCharts.revexp = new Chart(document.getElementById("fd-chart-revexp"), {
    type: "bar",
    data: { labels, datasets: [
      { label: "Receitas", data: revM, backgroundColor: FD_BLUE, borderRadius: 5, maxBarThickness: 18 },
      { label: "Despesas", data: expM, backgroundColor: FD_ORANGE, borderRadius: 5, maxBarThickness: 18 },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 12, boxHeight: 12, color: "#3c4a66" } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y)}` } } },
      scales: { x: axis, y: yAxis } },
  });
  fdCharts.cash = new Chart(document.getElementById("fd-chart-cash"), {
    type: "line",
    data: { labels, datasets: [{ label: "Fluxo de caixa acumulado", data: cumM, borderColor: FD_NAVY, backgroundColor: "rgba(49,103,161,.16)", fill: true, tension: 0.2, pointRadius: 3, pointBackgroundColor: FD_BLUE }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => `Acumulado: ${money(c.parsed.y)}`, afterLabel: c => `No mês: ${money(netM[c.dataIndex])}` } } },
      scales: { x: axis, y: { ...yAxis, beginAtZero: false } } },
  });
  if (cats.length) {
    fdCharts.donut = new Chart(document.getElementById("fd-chart-donut"), {
      type: "doughnut",
      data: { labels: cats.map(c => c[0]), datasets: [{ data: cats.map(c => c[1]), backgroundColor: cats.map((_, i) => FD_DONUT[i % FD_DONUT.length]), borderWidth: 2, borderColor: "#fff" }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "68%",
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${money(c.parsed)}` } } } },
    });
  }
}

function fdFmtRange(r) {
  const last = new Date(r.end.getTime() - 86400000);
  const f = d => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  return `${f(r.start)} – ${f(last)}`;
}

document.getElementById("fd-root").addEventListener("click", e => {
  const b = e.target.closest("[data-fd-period]");
  if (!b) return;
  fdState.period = b.dataset.fdPeriod;
  renderFinDashboard();
});

/* o Dashboard é a 1ª tela ao abrir o Financeiro */
function showFinanceiroDashboard() {
  const btn = document.querySelector('#financeiro-subtabs [data-fin-subtab="dashboard"]');
  if (btn) btn.click();
  /* na 1ª abertura os botões das abas ainda podem não ter listener: garante o desenho */
  const root = document.getElementById("fd-root");
  if (root && !root.innerHTML.trim()) renderFinDashboard();
}
function refreshFinDashboardIfVisible() {
  const sv = document.getElementById("subview-fin-dashboard");
  if (sv && sv.classList.contains("active") && currentView === "financeiro") renderFinDashboard();
}
/* qualquer alteração no Financeiro (parcela paga, despesa, comissão…) reflete no dashboard */
["renderFinanceiroOverview", "renderExpenses", "renderReceivables", "renderCommissions", "renderInfluencerCommissions", "renderSchoolCommissions", "renderSchoolTransfers", "renderAdSpend"].forEach(name => {
  const original = window[name];
  if (typeof original !== "function") return;
  window[name] = function (...args) {
    const out = original.apply(this, args);
    refreshFinDashboardIfVisible();
    return out;
  };
});
