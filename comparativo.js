/* Comparativo de escolas: um cartão por escola cadastrada, com os
   valores do turno escolhido (AM ou PM, vindos dos Produtos) e os itens
   que a escola oferece (vindos do cadastro de Escolas). Funções puras —
   recebem os helpers via opts pra poderem ser testadas fora do app. */
const CMP_PALETTE = ["#3167a1", "#0a7a4b", "#7a3fc4", "#d9631e", "#0e7fa8", "#b02a5b"];

function cmpInitials(name) {
  const parts = String(name || "").replace(/[^A-Za-zÀ-ÿ0-9 ]/g, " ").trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "?").slice(0, 2)).toUpperCase();
}

function cmpCardId(i) { return `cmp-card-${i}`; }

/* preço à vista não aparece no comparativo — só os parcelados */
function cmpIsCash(p) {
  return /full payment|[aà]\s+vista/i.test(`${p.nome || ""} ${p.detalhe || ""}`);
}

/* AM/manhã → "am", PM/tarde → "pm", sem turno definido → null */
function cmpClassifyTurno(turno) {
  const n = String(turno || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n.startsWith("am") || n.includes("manha")) return "am";
  if (n.startsWith("pm") || n.includes("tarde")) return "pm";
  return null;
}

/* produtos da escola no turno escolhido, sem os à vista; produto sem
   turno definido (ex: acomodação) aparece nos dois turnos */
function cmpItemsForShift(items, shift, classify) {
  return items.filter(p => {
    if (cmpIsCash(p)) return false;
    const s = classify(p.turno);
    return s === null || s === shift;
  });
}

function cmpGroupByTurno(items) {
  const turnos = [];
  items.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).forEach(p => {
    const nome = p.turno || "";
    let t = turnos.find(x => x.nome === nome);
    if (!t) { t = { nome, itens: [] }; turnos.push(t); }
    t.itens.push(p);
  });
  return turnos;
}

function renderSchoolComparison(schools, itemsFor, shift, opts) {
  const esc = opts.escape, money = opts.money, L = opts.labels;
  if (!schools.length) return `<p class="muted-note">${esc(L.empty)}</p>`;

  const nav = schools.map((s, i) =>
    `<a class="cmp-nav-link" href="#${cmpCardId(i)}" data-cmp-target="${cmpCardId(i)}">${esc(s.nome)}${s.destino && s.destino !== s.nome ? ` · ${esc(s.destino)}` : ""}</a>`).join("");

  const cards = schools.map((s, i) => {
    const color = CMP_PALETTE[i % CMP_PALETTE.length];
    const items = cmpItemsForShift(itemsFor(s), shift, opts.classify);
    const prices = items.map(p => Number(p.preco) || 0);
    const turnosHtml = items.length
      ? cmpGroupByTurno(items).map(t => `
        <div class="cmp-turno">
          ${t.nome ? `<div class="cmp-turno-name">${esc(t.nome)}</div>` : ""}
          ${t.itens.map(p => `
            <div class="cmp-row">
              <span class="cmp-row-name">${esc(p.nome)}${p.unidade && p.unidade !== "pacote" ? ` <small>/ ${esc(p.unidade)}</small>` : ""}</span>
              <span class="cmp-row-price">${money(p.preco)}</span>
            </div>
            ${p.detalhe ? `<div class="cmp-row-detail">${esc(p.detalhe)}</div>` : ""}`).join("")}
        </div>`).join("")
      : `<p class="cmp-empty">${esc(L.noValues)}</p>`;
    const inclusos = (s.inclusos || []).filter(Boolean);
    return `
      <article class="cmp-card" id="${cmpCardId(i)}" style="--cmp-color:${color}">
        <div class="cmp-card-banner${s.coverPath && opts.coverUrl ? " has-photo" : ""}"${s.coverPath && opts.coverUrl ? ` style="background-image:linear-gradient(rgba(0,0,0,0.04), rgba(0,0,0,0.38)), url('${esc(opts.coverUrl(s.coverPath))}')"` : ""}>
          <span class="cmp-card-logo">${esc(cmpInitials(s.nome))}</span>
          ${prices.length ? `<span class="cmp-card-tag">${esc(L.from)} ${money(Math.min(...prices))}</span>` : ""}
        </div>
        <div class="cmp-card-body">
          <h3 class="cmp-card-title">${esc(s.nome)}</h3>
          <div class="cmp-card-loc">${esc(s.destino)}${s.categoria ? `, ${esc(s.categoria)}` : ""}</div>
          ${s.descricao ? `<p class="cmp-card-desc">${esc(s.descricao)}</p>` : ""}
          <div class="cmp-card-section">${esc(L.values)}</div>
          ${turnosHtml}
          ${inclusos.length ? `
            <div class="cmp-card-section">${esc(L.includes)}</div>
            <ul class="cmp-includes">${inclusos.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        </div>
      </article>`;
  }).join("");

  return `
    <div class="cmp-topbar">
      <div class="cmp-topbar-title">${esc(L.overview)} <span>/ ${schools.length} ${esc(schools.length === 1 ? L.option : L.options)}</span></div>
      <nav class="cmp-nav">${nav}</nav>
    </div>
    <div class="cmp-grid">${cards}</div>`;
}
