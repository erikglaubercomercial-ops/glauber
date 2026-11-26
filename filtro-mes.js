/* ============================================================
   Filtro Ano + Mês compartilhado pelas telas do Financeiro.
   Cada tela tem uma chave (ex.: "receivables"). O estado fica em finPer[chave] = { year, month }:
     year "" = todos os anos; month 0 = todos os meses.
   • finPerMount(chave, datas) desenha a barra no <div data-fin-per="chave">; "datas" só serve para listar os anos.
   • finPerOk(chave, data) diz se uma data (AAAA-MM-DD, ms ou Date) cai no período escolhido.
   • Ao clicar, chama FIN_PER_RERENDER[chave]() (cada tela registra a sua função de redesenho).
   ============================================================ */
const FIN_MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const finPer = {};
const FIN_PER_RERENDER = {};

function finPerState(key) { return finPer[key] || (finPer[key] = { year: "", month: 0 }); }
function finPerReset(key) { finPer[key] = { year: "", month: 0 }; }
function finPerActive(key) { const s = finPerState(key); return !!(s.year || s.month); }

function finPerDate(d) {
  if (d == null || d === "") return null;
  let dt;
  if (typeof d === "string") dt = /^\d{4}-\d{2}-\d{2}/.test(d) ? new Date(`${d.slice(0, 10)}T12:00:00`) : new Date(d);
  else dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

function finPerOk(key, d) {
  const s = finPerState(key);
  if (!s.year && !s.month) return true;
  const dt = finPerDate(d);
  if (!dt) return false;
  if (s.year && dt.getFullYear() !== Number(s.year)) return false;
  if (s.month && dt.getMonth() + 1 !== Number(s.month)) return false;
  return true;
}

/* intervalo AAAA-MM-DD do período escolhido (para telas que usam campos de data) */
function finPerRange(key) {
  const s = finPerState(key);
  if (!s.year && !s.month) return { from: "", to: "" };
  const y = Number(s.year) || new Date().getFullYear();
  const pad = n => String(n).padStart(2, "0");
  if (!s.month) return { from: `${y}-01-01`, to: `${y}-12-31` };
  const last = new Date(y, s.month, 0).getDate();
  return { from: `${y}-${pad(s.month)}-01`, to: `${y}-${pad(s.month)}-${pad(last)}` };
}

function finPerBarHtml(key, datas) {
  const s = finPerState(key);
  const nowYear = new Date().getFullYear();
  const anos = new Set([nowYear]);
  (datas || []).forEach(d => { const dt = finPerDate(d); if (dt) anos.add(dt.getFullYear()); });
  if (s.year) anos.add(Number(s.year));
  const lista = [...anos].sort((a, b) => a - b);
  return `<div class="fin-ov-periods">
      <label class="filter-inline">Ano <select data-fin-per-year>
        <option value="">Todos</option>${lista.map(y => `<option value="${y}"${String(s.year) === String(y) ? " selected" : ""}>${y}</option>`).join("")}</select></label>
      <div class="fin-ov-month-tabs">
        <button type="button" class="fin-ov-tab${!s.month ? " active" : ""}" data-fin-per-month="0">Todos os meses</button>
        ${FIN_MESES.map((m, i) => `<button type="button" class="fin-ov-tab${s.month === i + 1 ? " active" : ""}" data-fin-per-month="${i + 1}">${m}</button>`).join("")}
      </div></div>`;
}

function finPerMount(key, datas) {
  document.querySelectorAll(`[data-fin-per="${key}"]`).forEach(el => { el.innerHTML = finPerBarHtml(key, datas); });
}

function finPerRefresh(key) {
  const fn = FIN_PER_RERENDER[key];
  if (typeof fn === "function") fn();
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-fin-per-month]");
  const host = b && b.closest("[data-fin-per]");
  if (!host) return;
  const key = host.dataset.finPer, s = finPerState(key);
  s.month = Number(b.dataset.finPerMonth) || 0;
  if (s.month && !s.year) s.year = String(new Date().getFullYear());
  finPerRefresh(key);
});
document.addEventListener("change", e => {
  const sel = e.target.closest("[data-fin-per-year]");
  const host = sel && sel.closest("[data-fin-per]");
  if (!host) return;
  const key = host.dataset.finPer, s = finPerState(key);
  s.year = sel.value;
  if (!s.year) s.month = 0;
  finPerRefresh(key);
});
