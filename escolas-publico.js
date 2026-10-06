/* ============================================================
   PÁGINA PÚBLICA DO COMPARATIVO DE ESCOLAS — sem login. Um link
   para manhã (?turno=am) e outro para tarde (?turno=pm), pra
   enviar ao cliente. Os dados vêm da função get_public_school_
   comparison (só escolas ativas, sem preços à vista).
   Depende de config.js (variável global `supabase`) e comparativo.js.
   ============================================================ */

const epParams = new URLSearchParams(window.location.search);
const epShift = (epParams.get("turno") || "").toLowerCase() === "pm" ? "pm" : "am";
const epKind = (epParams.get("tipo") || "").toLowerCase() === "renovacao" ? "renewal" : "first";

function epEscape(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function epMoney(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
}
function epCoverUrl(path) {
  return supabase.storage.from("school-covers").getPublicUrl(path).data.publicUrl;
}

(async function init() {
  const shiftLabel = epShift === "am" ? "Manhã (AM)" : "Tarde (PM)";
  const kindLabel = epKind === "renewal" ? " · Renovação" : "";
  document.getElementById("ep-title").textContent = `Opções de escola — ${shiftLabel}${kindLabel}`;
  document.getElementById("ep-subtitle").textContent = "Valores parcelados por escola. Qualquer dúvida, fale com o seu consultor.";
  document.title = `Opções de escola ${shiftLabel}${kindLabel} — Peregrinos Intercâmbio`;

  const [{ data, error }, citiesRes] = await Promise.all([
    supabase.rpc("get_public_school_comparison"),
    supabase.rpc("get_public_school_cities"),
  ]);
  const cities = Array.isArray(citiesRes.data) ? citiesRes.data : [];
  document.getElementById("ep-loading").style.display = "none";
  if (error || !Array.isArray(data)) {
    console.error("Erro ao carregar escolas:", error);
    document.getElementById("ep-error").style.display = "block";
    return;
  }

  const schools = data.map(s => ({
    nome: s.nome, categoria: s.categoria, destino: s.destino, descricao: s.descricao || "",
    inclusos: Array.isArray(s.inclusos) ? s.inclusos : [], coverPath: s.cover_path || null,
    items: Array.isArray(s.items) ? s.items : [],
  }));

  /* pro cliente, só entram escolas que têm valor no turno do link */
  const visible = schools.filter(s => cmpItemsForShift(s.items, epShift, cmpClassifyTurno, epKind).length > 0);

  document.getElementById("ep-container").innerHTML = renderSchoolComparison(visible, s => s.items, epShift, {
    escape: epEscape, money: epMoney, classify: cmpClassifyTurno, kind: epKind, coverUrl: epCoverUrl, cities,
    labels: {
      empty: "Nenhuma escola disponível no momento.", from: "A partir de", values: "Valores",
      includes: "O que a escola oferece", overview: "Visão Geral", option: "opção", options: "opções",
      noValues: "Sem valores cadastrados para este turno.", cityNoSchools: "Em breve",
    },
  });

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
