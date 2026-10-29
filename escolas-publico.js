/* ============================================================
   PÁGINA PÚBLICA DO COMPARATIVO DE ESCOLAS — sem login. Um link
   só, para enviar ao cliente; ele mesmo troca entre manhã (AM) e
   tarde (PM) no botão do topo. Os dados vêm da função get_public_school_
   comparison (só escolas ativas, sem preços à vista).
   Depende de config.js (variável global `supabase`) e comparativo.js.
   ============================================================ */

const epParams = new URLSearchParams(window.location.search);
/* o link é um só; ?turno=pm (links antigos) só define em qual turno a página abre. O cliente troca no botão. */
let epShift = (epParams.get("turno") || "").toLowerCase() === "pm" ? "pm" : "am";
const epKind = (epParams.get("tipo") || "").toLowerCase() === "renovacao" ? "renewal" : "first";
/* ?cidade=Dublin → mostra só as escolas dessa cidade */
const epCidade = (epParams.get("cidade") || "").trim().slice(0, 60);
const epNorm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

function epEscape(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function epMoney(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
}
function epCoverUrl(path) {
  return supabase.storage.from("school-covers").getPublicUrl(path).data.publicUrl;
}

const epShiftName = sh => (sh === "am" ? "Manhã (AM)" : "Tarde (PM)");
let epData = null, epCities = [];

function epRender() {
  const kindLabel = epKind === "renewal" ? " · Renovação" : "";
  const cityLabel = epCidade ? ` · ${epCidade}` : "";
  document.getElementById("ep-title").textContent = `Opções de escola — ${epShiftName(epShift)}${kindLabel}${cityLabel}`;
  document.title = `Opções de escola ${epShiftName(epShift)}${kindLabel}${cityLabel} — Peregrinos Intercâmbio`;
  document.querySelectorAll("#ep-shift-toggle .cmp-shift-btn").forEach(b => b.classList.toggle("active", b.dataset.shift === epShift));

  /* pro cliente, só entram escolas que têm valor no turno escolhido */
  const visible = epData.filter(s => cmpItemsForShift(s.items, epShift, cmpClassifyTurno, epKind).length > 0
    && (!epCidade || epNorm(s.destino) === epNorm(epCidade)));

  document.getElementById("ep-container").innerHTML = renderSchoolComparison(visible, s => s.items, epShift, {
    escape: epEscape, money: epMoney, classify: cmpClassifyTurno, kind: epKind, coverUrl: epCoverUrl,
    cities: epCidade ? epCities.filter(c => epNorm(c) === epNorm(epCidade)) : epCities,
    labels: {
      empty: "Nenhuma escola disponível no momento.", from: "A partir de", values: "Valores",
      includes: "O que a escola oferece", overview: "Visão Geral", option: "opção", options: "opções",
      noValues: "Sem valores cadastrados para este turno.", cityNoSchools: "Em breve", more: "Ver mais", less: "Ver menos", all: "Todas", weeks25: "25 semanas",
    },
  });
  cmpFitCards(document.getElementById("ep-container"));
}

(async function init() {
  document.getElementById("ep-subtitle").textContent = "Valores parcelados por escola. Qualquer dúvida, fale com o seu consultor.";

  /* botão para o cliente alternar entre manhã e tarde */
  const toggle = document.createElement("div");
  toggle.className = "cmp-shift-toggle ep-shift-toggle";
  toggle.id = "ep-shift-toggle";
  toggle.innerHTML = `<button type="button" class="cmp-shift-btn" data-shift="am">Manhã (AM)</button><button type="button" class="cmp-shift-btn" data-shift="pm">Tarde (PM)</button>`;
  document.getElementById("ep-subtitle").insertAdjacentElement("afterend", toggle);
  toggle.addEventListener("click", e => {
    const b = e.target.closest(".cmp-shift-btn");
    if (!b || !epData || b.dataset.shift === epShift) return;
    epShift = b.dataset.shift;
    epRender();
  });
  document.getElementById("ep-title").textContent = `Opções de escola — ${epShiftName(epShift)}`;
  toggle.querySelectorAll(".cmp-shift-btn").forEach(b => b.classList.toggle("active", b.dataset.shift === epShift));

  const [{ data, error }, citiesRes] = await Promise.all([
    supabase.rpc("get_public_school_comparison"),
    supabase.rpc("get_public_school_cities"),
  ]);
  epCities = Array.isArray(citiesRes.data) ? citiesRes.data : [];
  document.getElementById("ep-loading").style.display = "none";
  if (error || !Array.isArray(data)) {
    console.error("Erro ao carregar escolas:", error);
    document.getElementById("ep-error").style.display = "block";
    toggle.style.display = "none";
    return;
  }

  epData = data.map(s => ({
    nome: s.nome, categoria: s.categoria, destino: s.destino, descricao: s.descricao || "",
    inclusos: Array.isArray(s.inclusos) ? s.inclusos : [], coverPath: s.cover_path || null,
    items: Array.isArray(s.items) ? s.items : [],
  }));
  epRender();

  document.getElementById("ep-container").addEventListener("click", e => {
    const link = e.target.closest("[data-cmp-target]");
    if (!link) return;
    e.preventDefault();
    const target = document.getElementById(link.dataset.cmpTarget);
    if (target) {
      /* PC/Mac: as escolas ficam lado a lado, então o menu rola pro lado; celular segue na vertical */
      const sideBySide = window.matchMedia("(min-width: 900px)").matches;
      target.scrollIntoView({ behavior: "smooth", block: sideBySide ? "nearest" : "start", inline: sideBySide ? "start" : "nearest" });
    }
  });
})();
