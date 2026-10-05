/* ============================================================
   PÁGINA PÚBLICA DO COMPARATIVO DE ESCOLAS — sem login. Um link
   para manhã (?turno=am) e outro para tarde (?turno=pm), pra
   enviar ao cliente. Os dados vêm da função get_public_school_
   comparison (só escolas ativas, sem preços à vista).
   Depende de config.js (variável global `supabase`) e comparativo.js.
   ============================================================ */

const epShift = (new URLSearchParams(window.location.search).get("turno") || "").toLowerCase() === "pm" ? "pm" : "am";

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
  document.getElementById("ep-title").textContent = `Opções de escola — ${shiftLabel}`;
  document.getElementById("ep-subtitle").textContent = "Valores parcelados por escola. Qualquer dúvida, fale com o seu consultor.";
  document.title = `Opções de escola ${shiftLabel} — Peregrinos Intercâmbio`;

  const { data, error } = await supabase.rpc("get_public_school_comparison");
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
  const visible = schools.filter(s => cmpItemsForShift(s.items, epShift, cmpClassifyTurno).length > 0);

  document.getElementById("ep-container").innerHTML = renderSchoolComparison(visible, s => s.items, epShift, {
    escape: epEscape, money: epMoney, classify: cmpClassifyTurno, coverUrl: epCoverUrl,
    labels: {
      empty: "Nenhuma escola disponível no momento.", from: "A partir de", values: "Valores",
      includes: "O que a escola oferece", overview: "Visão Geral", option: "opção", options: "opções",
      noValues: "Sem valores cadastrados para este turno.",
    },
  });

  document.getElementById("ep-container").addEventListener("click", e => {
    const link = e.target.closest("[data-cmp-target]");
    if (!link) return;
    e.preventDefault();
    const target = document.getElementById(link.dataset.cmpTarget);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
})();
