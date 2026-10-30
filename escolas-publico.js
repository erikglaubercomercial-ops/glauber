/* ============================================================
   PÁGINA PÚBLICA DE PREÇOS DAS ESCOLAS — sem login. Um link só, para enviar
   ao cliente: mostra apenas o valor do curso de 25 semanas, manhã e tarde, de
   cada escola (regra em comparativo.js › cmpPrice25). Os dados vêm da função
   get_public_school_comparison (só escolas ativas, sem preços à vista).
   Depende de config.js (variável global `supabase`) e comparativo.js.
   ============================================================ */

const epParams = new URLSearchParams(window.location.search);
const epKind = (epParams.get("tipo") || "").toLowerCase() === "renovacao" ? "renewal" : "first";
/* ?cidade=Dublin → mostra só as escolas dessa cidade */
const epCidade = (epParams.get("cidade") || "").trim().slice(0, 60);
const epNorm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

function epEscape(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function epMoney(v, currency) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: currency === "GBP" ? "GBP" : "EUR" });
}
function epCoverUrl(path) {
  return supabase.storage.from("school-covers").getPublicUrl(path).data.publicUrl;
}

let epData = null, epCities = [];

function epRender() {
  const kindLabel = epKind === "renewal" ? " · Renovação" : "";
  const cityLabel = epCidade ? ` · ${epCidade}` : "";
  document.getElementById("ep-title").textContent = `Opções de escola — curso de 25 semanas${kindLabel}${cityLabel}`;
  document.title = `Opções de escola, 25 semanas${kindLabel}${cityLabel} — Peregrinos Intercâmbio`;

  /* só entram escolas que têm o valor de 25 semanas em algum turno; manhã e tarde aparecem juntos */
  const visible = epData.filter(s => !epCidade || epNorm(s.destino) === epNorm(epCidade));

  document.getElementById("ep-container").innerHTML = renderSchoolPrices25(visible, {
    escape: epEscape, money: epMoney, classify: cmpClassifyTurno, kind: epKind, coverUrl: epCoverUrl,
    cities: epCidade ? epCities.filter(c => epNorm(c) === epNorm(epCidade)) : epCities,
    labels: {
      empty: "Nenhuma escola disponível no momento.", course25: "Curso de 25 semanas", am: "Manhã (AM)", pm: "Tarde (PM)",
      askConsultant: "Consulte seu consultor", includes: "O que a escola oferece", overview: "Visão Geral", option: "opção", options: "opções",
      cityNoSchools: "Em breve", more: "Ver mais", less: "Ver menos", all: "Todas",
    },
  });
  cmpFitCards(document.getElementById("ep-container"));
}

(async function init() {
  document.getElementById("ep-subtitle").textContent = "Valor do curso de 25 semanas, parcelado, em cada turno. Qualquer dúvida, fale com o seu consultor.";

  const [{ data, error }, citiesRes] = await Promise.all([
    supabase.rpc("get_public_school_comparison"),
    supabase.rpc("get_public_school_cities"),
  ]);
  epCities = Array.isArray(citiesRes.data) ? citiesRes.data : [];
  document.getElementById("ep-loading").style.display = "none";
  if (error || !Array.isArray(data)) {
    console.error("Erro ao carregar escolas:", error);
    document.getElementById("ep-error").style.display = "block";
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
