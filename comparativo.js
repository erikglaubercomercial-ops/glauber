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

/* produto de renovação (Renewal / Renovação) x primeiro curso */
function cmpIsRenewal(p) {
  return /renewal|renova[cç]/i.test(`${p.nome || ""} ${p.detalhe || ""} ${p.turno || ""}`);
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
function cmpItemsForShift(items, shift, classify, kind) {
  const wantRenewal = kind === "renewal";
  return items.filter(p => {
    if (cmpIsCash(p)) return false;
    if (cmpIsRenewal(p) !== wantRenewal) return false;
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

/* cartões agrupados por cidade na ordem do menu de cidades; cidades
   que têm escola mas não estão no menu vêm depois, na ordem de cadastro */
function cmpGroupByDestino(schools, cities) {
  const order = (cities || []).slice();
  schools.forEach(s => { if (!order.includes(s.destino)) order.push(s.destino); });
  return order.flatMap(c => schools.filter(s => s.destino === c));
}

function renderSchoolComparison(rawSchools, itemsFor, shift, opts) {
  const esc = opts.escape, money = opts.money, L = opts.labels;
  if (!rawSchools.length) return `<p class="muted-note">${esc(L.empty)}</p>`;
  const schools = cmpGroupByDestino(rawSchools, opts.cities);

  /* menu do topo: uma entrada por cidade do menu; leva ao primeiro cartão
     dela, e fica apagada se ainda não há escola nessa cidade */
  const menuCities = opts.cities && opts.cities.length ? opts.cities : [...new Set(schools.map(s => s.destino))];
  const nav = menuCities.map(city => {
    const idx = schools.findIndex(s => s.destino === city);
    if (idx === -1) return `<span class="cmp-nav-link disabled" title="${esc(L.cityNoSchools || "")}">${esc(city)}</span>`;
    return `<a class="cmp-nav-link" href="#${cmpCardId(idx)}" data-cmp-target="${cmpCardId(idx)}">${esc(city)}</a>`;
  }).join("");

  const cards = schools.map((s, i) => {
    const color = CMP_PALETTE[i % CMP_PALETTE.length];
    const items = cmpItemsForShift(itemsFor(s), shift, opts.classify, opts.kind);
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
         <div class="cmp-card-clip">
          <h3 class="cmp-card-title">${esc(s.nome)}</h3>
          <div class="cmp-card-loc">${esc(s.destino)}${s.categoria ? `, ${esc(s.categoria)}` : ""}</div>
          ${s.descricao ? `<p class="cmp-card-desc">${esc(s.descricao)}</p>` : ""}
          <div class="cmp-card-section">${esc(L.values)}</div>
          ${turnosHtml}
          ${inclusos.length ? `
            <div class="cmp-card-section">${esc(L.includes)}</div>
            <ul class="cmp-includes">${inclusos.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
         </div>
         <button type="button" class="cmp-more-btn" data-more="${esc(L.more || "Ver mais")}" data-less="${esc(L.less || "Ver menos")}">${esc(L.more || "Ver mais")}</button>
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


/* todos os cartões com o mesmo tamanho: o que passa da altura padrão ganha o botão "Ver mais"
   (só aparece quando há o que mostrar). Chamar depois de inserir o HTML dos cartões. */
function cmpFitCard(card) {
  const clip = card.querySelector(".cmp-card-clip");
  if (!clip) return;
  const open = card.classList.contains("expanded");
  card.classList.toggle("cmp-overflow", open || clip.scrollHeight > clip.clientHeight + 2);
}
/* o observador reavalia quando o cartão aparece/muda de tamanho (ex.: aba que estava escondida) */
const cmpRO = typeof ResizeObserver === "function" ? new ResizeObserver(entries => entries.forEach(en => { const c = en.target.closest(".cmp-card"); if (c) cmpFitCard(c); })) : null;
function cmpFitCards(root) {
  (root || document).querySelectorAll(".cmp-card").forEach(card => {
    cmpFitCard(card);
    const clip = card.querySelector(".cmp-card-clip");
    if (cmpRO && clip) cmpRO.observe(clip);
  });
}
if (!window.__cmpMoreInit) {
  window.__cmpMoreInit = true;
  document.addEventListener("click", e => {
    const btn = e.target.closest(".cmp-more-btn");
    if (!btn) return;
    const card = btn.closest(".cmp-card");
    const open = card.classList.toggle("expanded");
    cmpFitCard(card);
    btn.textContent = open ? btn.dataset.less : btn.dataset.more;
  });
  let cmpFitTimer = null;
  window.addEventListener("resize", () => { clearTimeout(cmpFitTimer); cmpFitTimer = setTimeout(() => cmpFitCards(document), 150); });
  window.addEventListener("load", () => cmpFitCards(document));
}
