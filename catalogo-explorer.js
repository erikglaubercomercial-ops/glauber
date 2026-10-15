/* ============================================================
   CATÁLOGO EM ESTILO DE PASTAS (tela Produtos, só ADM)
   Selecionar (clique na caixinha, Cmd/Ctrl+clique, Shift+clique), copiar,
   recortar e colar pastas e produtos, arrastar para mover, reorganizar a
   ordem livremente (arrastando entre os irmãos) e desfazer.
   A estrutura continua sendo Categoria > Destino > Escola > Turno > Produtos
   (é ela que a Cotação e as Escolas usam); aqui só mexemos nos campos dos
   produtos e nas escolas ligadas a eles — nada é apagado sem desfazer.
   Depende de script.js: catalog, catalogNavPath, schools, uid, currency,
   catalogItemsInBox, CATALOG_LEVEL_FIELDS, catalogLevelValue,
   bulkSaveCatalogItemsRemote, bulkDeleteCatalogItemsRemote, saveSchoolRemote,
   deleteSchoolRemote, newSchoolCode, renderCatalogList, quoteMontaDestinos,
   quoteMontaCatalogo.
   ============================================================ */

const cx = { sel: new Set(), clip: null, undo: [], drag: null, anchor: null, pathKey: "", busy: false };
const cxEsc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s));
const cxIsAdmin = () => !!(session && session.role === "ADM");
const cxList = () => document.getElementById("catalog-list");

/* ---- chaves de seleção ---- */
const cxFolderKey = (level, name) => `f:${level}:${name}`;
const cxItemKey = id => `i:${id}`;
const cxLevel = () => catalogNavPath.length;               /* nível das pastas mostradas agora */
const cxClone = o => JSON.parse(JSON.stringify(o));

/* entrada (pasta ou produto) a partir da chave, no contexto da visão atual */
function cxEntryFromKey(key) {
  if (key.startsWith("i:")) return { kind: "item", id: key.slice(2) };
  const [, level, ...rest] = key.split(":");
  return { kind: "folder", level: Number(level), path: catalogNavPath.slice(0, Number(level)), name: rest.join(":") };
}
const cxEntryItems = en => (en.kind === "item"
  ? catalog.filter(p => p.id === en.id)
  : catalogItemsInBox(en.path, en.level, en.name));
const cxSortedByOrder = list => list.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

/* produtos "soltos" (sem pasta no nível mostrado) e produtos da folha da visão atual */
function cxLooseItems(path) {
  const k = path.length;
  return catalog.filter(p => {
    for (let i = 0; i < k; i++) if (catalogLevelValue(p, i) !== path[i]) return false;
    return k === 4 ? true : (k === 2 ? !p.subgrupo : k === 3 ? !p.turno : false);
  });
}
const cxItemsUnder = path => catalog.filter(p => path.every((v, i) => catalogLevelValue(p, i) === v));

/* ---- ordem: reaproveita os mesmos números de "ordem" para não bagunçar o resto ---- */
function cxReassignOrder(list) {
  const slots = list.map(p => p.ordem || 0).sort((a, b) => a - b);
  for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
  list.forEach((p, i) => { p.ordem = slots[i]; });
}
const cxNextOrder = () => catalog.reduce((m, x) => Math.max(m, x.ordem || 0), 0);

/* ---- desfazer ---- */
function cxRecorder() {
  return { items: new Map(), createdItems: [], schools: new Map(), createdSchools: [] };
}
const cxTouchItem = (rec, p) => { if (!rec.items.has(p.id)) rec.items.set(p.id, cxClone(p)); };
const cxTouchSchool = (rec, s) => { if (!rec.schools.has(s.id)) rec.schools.set(s.id, cxClone(s)); };
function cxCommit(label, rec) {
  cx.undo.push({ label, ...rec });
  if (cx.undo.length > 15) cx.undo.shift();
}
async function cxUndo() {
  const op = cx.undo.pop();
  if (!op || cx.busy) { if (!op) cxToast("Nada para desfazer."); return; }
  cx.busy = true;
  const restoredItems = [];
  op.items.forEach(before => {
    const idx = catalog.findIndex(p => p.id === before.id);
    if (idx >= 0) catalog[idx] = cxClone(before); else catalog.push(cxClone(before));
    restoredItems.push(before);
  });
  const delIds = op.createdItems.map(p => p.id);
  if (delIds.length) catalog = catalog.filter(p => !delIds.includes(p.id));
  op.schools.forEach(before => {
    const idx = schools.findIndex(s => s.id === before.id);
    if (idx >= 0) schools[idx] = cxClone(before); else schools.push(cxClone(before));
  });
  const delSchools = op.createdSchools.map(s => s.id);
  if (delSchools.length) schools = schools.filter(s => !delSchools.includes(s.id));
  await bulkSaveCatalogItemsRemote(restoredItems);
  await bulkDeleteCatalogItemsRemote(delIds);
  for (const s of op.schools.values()) await saveSchoolRemote(s);
  for (const id of delSchools) await deleteSchoolRemote(id);
  cx.sel.clear();
  cx.busy = false;
  cxRefresh();
  cxToast(`Desfeito: ${op.label}`);
}

function cxRefresh() {
  renderCatalogList();
  if (typeof quoteMontaDestinos === "function") quoteMontaDestinos();
  if (typeof quoteMontaCatalogo === "function") quoteMontaCatalogo();
  if (typeof renderSchoolsList === "function") renderSchoolsList();
}
function cxToast(msg) {
  if (typeof agendaToast === "function") agendaToast(msg); else alert(msg);
}

/* ============================================================
   OPERAÇÕES
   ============================================================ */
/* valida: pasta de nível L só entra onde a visão tem L níveis; produto só de "destino" para dentro */
function cxCanPlace(entry, containerPath) {
  return entry.kind === "folder" ? containerPath.length === entry.level : containerPath.length >= 2;
}
function cxContainerSchool(containerPath) {
  if (containerPath.length < 3) return null;
  return schools.find(sc => sc.categoria === containerPath[0] && sc.destino === containerPath[1] && sc.nome === containerPath[2]) || null;
}
function cxFolderExists(level, path, name) { return catalogItemsInBox(path, level, name).length > 0; }

/* posiciona produtos soltos/avulsos dentro de uma pasta-destino */
function cxPlaceItem(p, containerPath, rec) {
  cxTouchItem(rec, p);
  const k = containerPath.length;
  for (let i = 0; i < k; i++) p[CATALOG_LEVEL_FIELDS[i]] = containerPath[i];
  for (let i = k; i < 4; i++) p[CATALOG_LEVEL_FIELDS[i]] = "";
  const sc = cxContainerSchool(containerPath);
  p.escolaCodigo = sc ? sc.codigo : "";
}

async function cxMove(entries, containerPath) {
  const rec = cxRecorder();
  const changedItems = new Set();
  let skipped = 0, moved = 0;
  /* colisões que não dá para juntar: escola (nível 2) com o mesmo nome no destino */
  for (const en of entries) {
    if (!cxCanPlace(en, containerPath)) { skipped++; continue; }
    if (en.kind === "folder") {
      const samePlace = en.path.every((v, i) => v === containerPath[i]);
      if (samePlace) { skipped++; continue; }
      if (cxFolderExists(en.level, containerPath, en.name)) {
        if (en.level <= 2) { alert(`Já existe "${en.name}" nesse lugar. Renomeie uma das duas ou use Colar para criar uma cópia.`); return false; }
        if (!confirm(`Já existe a pasta "${en.name}" aqui. Juntar o conteúdo das duas?`)) return false;
      }
      const items = cxEntryItems(en);
      const codes = new Set(items.map(p => p.escolaCodigo).filter(Boolean));
      items.forEach(p => {
        cxTouchItem(rec, p);
        for (let i = 0; i < en.level; i++) p[CATALOG_LEVEL_FIELDS[i]] = containerPath[i];
        changedItems.add(p);
      });
      if (en.level === 3) {
        const sc = cxContainerSchool(containerPath);
        items.forEach(p => { p.escolaCodigo = sc ? sc.codigo : ""; });
      } else if (en.level <= 2) {
        /* a escola ligada acompanha a pasta (categoria/destino novos) e puxa todos os produtos dela */
        codes.forEach(code => {
          const sc = schools.find(s => s.codigo === code);
          if (!sc) return;
          cxTouchSchool(rec, sc);
          if (en.level === 2) { sc.categoria = containerPath[0]; sc.destino = containerPath[1]; }
          else if (en.level === 1) sc.categoria = containerPath[0];
          catalog.filter(p => p.escolaCodigo === code).forEach(p => {
            cxTouchItem(rec, p);
            p.categoria = sc.categoria; p.destino = sc.destino; p.subgrupo = sc.nome;
            changedItems.add(p);
          });
        });
      }
      moved += items.length;
    } else {
      const p = catalog.find(x => x.id === en.id);
      if (!p) continue;
      cxPlaceItem(p, containerPath, rec);
      changedItems.add(p);
      moved++;
    }
  }
  if (!changedItems.size) { if (skipped) cxToast("Nada foi movido: esse destino não serve para o que foi selecionado."); return false; }
  /* quem mudou de lugar vai para o fim da pasta nova, mantendo a ordem relativa */
  let next = cxNextOrder();
  cxSortedByOrder(Array.from(changedItems)).forEach(p => { p.ordem = ++next; });
  cx.busy = true;
  await bulkSaveCatalogItemsRemote(Array.from(changedItems));
  for (const s of rec.schools.keys()) { const sc = schools.find(x => x.id === s); if (sc) await saveSchoolRemote(sc); }
  cx.busy = false;
  cxCommit(`mover ${moved} produto(s)`, rec);
  return true;
}

/* nome livre para uma cópia de pasta no destino */
function cxFreeFolderName(level, path, name) {
  let cand = name, n = 0;
  while (cxFolderExists(level, path, cand)) { cand = `${name} (cópia${n ? " " + (n + 1) : ""})`; n++; }
  return cand;
}

async function cxCopy(entries, containerPath) {
  const rec = cxRecorder();
  const created = [];
  let skipped = 0;
  let next = cxNextOrder();
  for (const en of entries) {
    if (!cxCanPlace(en, containerPath)) { skipped++; continue; }
    if (en.kind === "item") {
      const src = catalog.find(x => x.id === en.id);
      if (!src) continue;
      const copy = { ...src, id: uid(), subs: cxClone(src.subs || []), ordem: ++next };
      const sameContainer = containerPath.every((v, i) => catalogLevelValue(src, i) === v) && containerPath.length >= 2;
      if (sameContainer) copy.nome = `${src.nome} (cópia)`;
      cxPlaceItemNew(copy, containerPath);
      created.push(copy); rec.createdItems.push(copy);
      continue;
    }
    /* pasta inteira: cópia com todos os produtos; escolas ligadas ganham cópia própria (nível ≤ 2) */
    const originals = cxSortedByOrder(cxEntryItems(en));
    if (!originals.length) continue;
    const finalName = cxFreeFolderName(en.level, containerPath, en.name);
    const schoolCopies = new Map();
    const newSchools = [];
    const schoolFor = code => {
      if (en.level > 2 || !code) return null;
      if (schoolCopies.has(code)) return schoolCopies.get(code);
      const srcSc = schools.find(s => s.codigo === code);
      if (!srcSc) return null;
      const sc = { ...srcSc, id: uid(), inclusos: srcSc.inclusos.slice(), ordem: schools.reduce((m, x) => Math.max(m, x.ordem), 0) + newSchools.length + 1 };
      if (en.level === 0) sc.categoria = finalName;
      else if (en.level === 1) { sc.categoria = containerPath[0]; sc.destino = finalName; }
      else { sc.categoria = containerPath[0]; sc.destino = containerPath[1]; sc.nome = finalName; }
      sc.codigo = newSchoolCode(sc.nome, sc.destino);
      while (newSchools.some(x => x.codigo === sc.codigo)) sc.codigo += "-2";
      schoolCopies.set(code, sc); newSchools.push(sc);
      return sc;
    };
    const targetSchool = en.level === 3 ? cxContainerSchool(containerPath) : null;
    originals.forEach(p => {
      const c = { ...p, id: uid(), subs: cxClone(p.subs || []), ordem: ++next };
      for (let i = 0; i < en.level; i++) c[CATALOG_LEVEL_FIELDS[i]] = containerPath[i];
      c[CATALOG_LEVEL_FIELDS[en.level]] = finalName;
      if (en.level <= 2) {
        const sc = schoolFor(p.escolaCodigo);
        c.escolaCodigo = sc ? sc.codigo : "";
        if (sc) { c.categoria = sc.categoria; c.destino = sc.destino; c.subgrupo = sc.nome; }
      } else c.escolaCodigo = targetSchool ? targetSchool.codigo : "";
      created.push(c); rec.createdItems.push(c);
    });
    schools.push(...newSchools);
    newSchools.forEach(s => rec.createdSchools.push(s));
  }
  if (!created.length) { if (skipped) cxToast("Nada foi colado: esse lugar não serve para o que foi copiado."); return false; }
  catalog.push(...created);
  cx.busy = true;
  await bulkSaveCatalogItemsRemote(created);
  for (const s of rec.createdSchools) await saveSchoolRemote(s);
  cx.busy = false;
  cxCommit(`colar ${created.length} produto(s)`, rec);
  return true;
}
function cxPlaceItemNew(p, containerPath) {
  const k = containerPath.length;
  for (let i = 0; i < k; i++) p[CATALOG_LEVEL_FIELDS[i]] = containerPath[i];
  for (let i = k; i < 4; i++) p[CATALOG_LEVEL_FIELDS[i]] = "";
  const sc = cxContainerSchool(containerPath);
  p.escolaCodigo = sc ? sc.codigo : "";
}

/* ---- reordenar pastas irmãs (mesmo nível) ---- */
async function cxReorderFolders(draggedNames, targetName, before) {
  const level = cxLevel(), path = catalogNavPath.slice();
  const scope = cxSortedByOrder(cxItemsUnder(path));
  const names = [];
  scope.forEach(p => { const v = catalogLevelValue(p, level); if (v && !names.includes(v)) names.push(v); });
  const moving = names.filter(n => draggedNames.includes(n));
  let rest = names.filter(n => !draggedNames.includes(n));
  const at = rest.indexOf(targetName);
  if (at < 0 || !moving.length) return false;
  rest.splice(before ? at : at + 1, 0, ...moving);
  if (rest.join("\u0001") === names.join("\u0001")) return false;
  const rec = cxRecorder();
  const groups = rest.map(n => scope.filter(p => catalogLevelValue(p, level) === n));
  const loose = scope.filter(p => !catalogLevelValue(p, level));
  const flat = [...groups.flat(), ...loose];
  flat.forEach(p => cxTouchItem(rec, p));
  cxReassignOrder(flat);
  const changed = flat.filter(p => p.ordem !== rec.items.get(p.id).ordem);
  if (!changed.length) return false;
  cx.busy = true;
  await bulkSaveCatalogItemsRemote(changed);
  cx.busy = false;
  cxCommit("reorganizar pastas", rec);
  return true;
}

/* ---- reordenar produtos dentro da pasta ---- */
async function cxReorderItems(draggedIds, targetId, before) {
  const path = catalogNavPath.slice();
  const list = cxSortedByOrder(cxLooseItems(path));
  const moving = list.filter(p => draggedIds.includes(p.id));
  let rest = list.filter(p => !draggedIds.includes(p.id));
  const at = rest.findIndex(p => p.id === targetId);
  if (at < 0 || !moving.length) return false;
  rest.splice(before ? at : at + 1, 0, ...moving);
  if (rest.map(p => p.id).join() === list.map(p => p.id).join()) return false;
  const rec = cxRecorder();
  rest.forEach(p => cxTouchItem(rec, p));
  cxReassignOrder(rest);
  const changed = rest.filter(p => p.ordem !== rec.items.get(p.id).ordem);
  if (!changed.length) return false;
  cx.busy = true;
  await bulkSaveCatalogItemsRemote(changed);
  cx.busy = false;
  cxCommit("reorganizar produtos", rec);
  return true;
}

/* ============================================================
   SELEÇÃO / ÁREA DE TRANSFERÊNCIA
   ============================================================ */
function cxVisibleKeys() {
  return Array.from(cxList().querySelectorAll("[data-cx-key]")).map(el => el.dataset.cxKey);
}
function cxSelectedEntries() { return Array.from(cx.sel).map(cxEntryFromKey); }
function cxSetClip(mode) {
  const entries = cxSelectedEntries();
  if (!entries.length) { cxToast("Selecione pastas ou produtos primeiro (caixinha no canto do cartão)."); return; }
  cx.clip = { mode, entries };
  cxToast(`${entries.length} item(ns) ${mode === "cut" ? "recortado(s)" : "copiado(s)"}. Abra a pasta de destino e clique em Colar.`);
  cxDecorate();
}
async function cxPaste() {
  if (!cx.clip || cx.busy) { if (!cx.clip) cxToast("A área de transferência está vazia."); return; }
  const path = catalogNavPath.slice();
  const entries = cx.clip.entries;
  const ok = cx.clip.mode === "cut" ? await cxMove(entries, path) : await cxCopy(entries, path);
  if (ok) {
    if (cx.clip.mode === "cut") cx.clip = null;
    cx.sel.clear();
    cxRefresh();
  }
}
function cxToggle(key) {
  if (cx.sel.has(key)) cx.sel.delete(key); else cx.sel.add(key);
}

/* ============================================================
   TELA: barra de ferramentas e marcações nos cartões
   ============================================================ */
function cxDecorate() {
  const list = cxList();
  if (!list || !cxIsAdmin() || !list.querySelector(".cat-breadcrumb")) return;
  const key = JSON.stringify(catalogNavPath);
  if (cx.pathKey !== key) { cx.sel.clear(); cx.anchor = null; cx.pathKey = key; }
  const cutKeys = new Set();
  if (cx.clip && cx.clip.mode === "cut") cx.clip.entries.forEach(en => {
    if (en.kind === "item") cutKeys.add(cxItemKey(en.id));
    else if (en.path.length === catalogNavPath.length && en.path.every((v, i) => v === catalogNavPath[i])) cutKeys.add(cxFolderKey(en.level, en.name));
  });
  /* pastas */
  list.querySelectorAll(".cat-box-wrap").forEach(wrap => {
    const name = wrap.querySelector(".cat-box")?.dataset.nav;
    if (name == null) return;
    const k = cxFolderKey(cxLevel(), name);
    wrap.dataset.cxKey = k; wrap.dataset.cxName = name; wrap.draggable = true;
    cxMark(wrap, k, cutKeys);
  });
  /* produtos */
  list.querySelectorAll(".prod-card").forEach(card => {
    const id = card.querySelector('[data-act="edit"]')?.dataset.id;
    if (!id) return;
    const k = cxItemKey(id);
    card.dataset.cxKey = k; card.dataset.cxId = id; card.draggable = true;
    cxMark(card, k, cutKeys);
  });
  /* migalhas de pão viram destinos de soltar */
  list.querySelectorAll(".cat-crumb").forEach(c => { c.dataset.cxCrumb = c.dataset.idx; });
  /* barra de ferramentas */
  list.querySelector(".cx-bar")?.remove();
  /* a barra só aparece quando há algo a fazer (seleção, área de transferência ou desfazer):
     fora disso a tela fica exatamente como era */
  if (!cx.sel.size && !cx.clip && !cx.undo.length) return;
  const total = cxVisibleKeys().length;
  const bar = document.createElement("div");
  bar.className = "cx-bar";
  const selN = cx.sel.size;
  bar.innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" data-cx="all" ${total ? "" : "disabled"}>☑ ${selN === total && total ? "Limpar seleção" : "Selecionar tudo"}</button>
    <button type="button" class="btn btn-ghost btn-sm" data-cx="copy" ${selN ? "" : "disabled"}>⧉ Copiar</button>
    <button type="button" class="btn btn-ghost btn-sm" data-cx="cut" ${selN ? "" : "disabled"}>✂ Recortar</button>
    <button type="button" class="btn btn-primary btn-sm" data-cx="paste" ${cx.clip ? "" : "disabled"}>📋 Colar aqui${cx.clip ? ` (${cx.clip.entries.length})` : ""}</button>
    <button type="button" class="btn btn-ghost btn-sm" data-cx="undo" ${cx.undo.length ? "" : "disabled"} title="${cx.undo.length ? "Desfazer: " + cxEsc(cx.undo[cx.undo.length - 1].label) : "Nada para desfazer"}">↶ Desfazer</button>
    <span class="cx-info">${selN ? `${selN} selecionado(s)` : "Cmd/Ctrl+C, X, V, Z · arraste para mover ou reorganizar"}</span>`;
  list.querySelector(".cat-breadcrumb").after(bar);
}
function cxMark(el, key, cutKeys) {
  el.classList.toggle("cx-selected", cx.sel.has(key));
  el.classList.toggle("cx-cut", cutKeys.has(key));
  let box = el.querySelector(":scope > .cx-check");
  if (!box) {
    box = document.createElement("label");
    box.className = "cx-check";
    box.innerHTML = `<input type="checkbox" tabindex="-1">`;
    el.appendChild(box);
  }
  box.querySelector("input").checked = cx.sel.has(key);
}

/* ============================================================
   EVENTOS
   ============================================================ */
(function cxBind() {
  const list = cxList();
  if (!list) return;

  /* seleção: caixinha, Cmd/Ctrl+clique, Shift+clique (antes da navegação do script.js) */
  list.addEventListener("click", e => {
    if (!cxIsAdmin()) return;
    const bar = e.target.closest("[data-cx]");
    if (bar) {
      e.stopPropagation();
      const a = bar.dataset.cx;
      if (a === "all") {
        const keys = cxVisibleKeys();
        if (cx.sel.size === keys.length) cx.sel.clear(); else keys.forEach(k => cx.sel.add(k));
        cxDecorate();
      } else if (a === "copy") cxSetClip("copy");
      else if (a === "cut") cxSetClip("cut");
      else if (a === "paste") cxPaste();
      else if (a === "undo") cxUndo();
      return;
    }
    const target = e.target.closest("[data-cx-key]");
    if (!target) return;
    const onCheck = e.target.closest(".cx-check");
    if (!onCheck && !(e.metaKey || e.ctrlKey || e.shiftKey)) return;   /* clique comum abre a pasta / usa os botões */
    if (e.target.closest("button[data-act], .cat-box-admin-acts") && !onCheck) return;
    e.preventDefault(); e.stopPropagation();
    const key = target.dataset.cxKey;
    if (e.shiftKey && cx.anchor && cx.anchor !== key) {
      const keys = cxVisibleKeys(), a = keys.indexOf(cx.anchor), b = keys.indexOf(key);
      if (a >= 0 && b >= 0) keys.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(k => cx.sel.add(k));
    } else {
      cxToggle(key);
      cx.anchor = key;
    }
    cxDecorate();
  }, true);

  /* arrastar */
  list.addEventListener("dragstart", e => {
    if (!cxIsAdmin()) return;
    const src = e.target.closest("[data-cx-key]");
    if (!src) return;
    if (!cx.sel.has(src.dataset.cxKey)) { cx.sel.clear(); cx.sel.add(src.dataset.cxKey); }
    cx.drag = { keys: Array.from(cx.sel) };
    e.dataTransfer.effectAllowed = "copyMove";
    try { e.dataTransfer.setData("text/plain", "catalogo"); } catch (err) { /* sem suporte */ }
    requestAnimationFrame(() => {
      list.querySelectorAll("[data-cx-key]").forEach(el => el.classList.toggle("cx-dragging", cx.sel.has(el.dataset.cxKey)));
    });
  });
  list.addEventListener("dragend", () => { cx.drag = null; cxClearDropMarks(); list.querySelectorAll(".cx-dragging").forEach(el => el.classList.remove("cx-dragging")); cxDecorate(); });
  list.addEventListener("dragover", e => {
    if (!cx.drag) return;
    const plan = cxPlanDrop(e);
    cxClearDropMarks();
    if (!plan) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
    plan.el.classList.add(plan.type === "into" ? "cx-drop-into" : plan.before ? "cx-drop-before" : "cx-drop-after");
  });
  list.addEventListener("dragleave", e => { if (!list.contains(e.relatedTarget)) cxClearDropMarks(); });
  list.addEventListener("drop", async e => {
    if (!cx.drag) return;
    const plan = cxPlanDrop(e);
    cxClearDropMarks();
    if (!plan) return;
    e.preventDefault();
    const drag = cx.drag;
    cx.drag = null;
    if (cx.busy) return;
    const entries = drag.keys.map(cxEntryFromKey);
    let ok = false;
    if (plan.type === "into") ok = e.altKey ? await cxCopy(entries, plan.container) : await cxMove(entries, plan.container);
    else if (plan.type === "folders") ok = await cxReorderFolders(entries.map(x => x.name), plan.targetName, plan.before);
    else if (plan.type === "items") ok = await cxReorderItems(entries.map(x => x.id), plan.targetId, plan.before);
    if (ok) { cx.sel.clear(); cxRefresh(); } else cxDecorate();
  });

  /* menu de contexto (botão direito) */
  list.addEventListener("contextmenu", e => {
    if (!cxIsAdmin()) return;
    const target = e.target.closest("[data-cx-key]");
    const inList = e.target.closest("#catalog-list");
    if (!inList) return;
    e.preventDefault();
    if (target && !cx.sel.has(target.dataset.cxKey)) { cx.sel.clear(); cx.sel.add(target.dataset.cxKey); cxDecorate(); }
    cxOpenMenu(e.clientX, e.clientY, target);
  });
  document.addEventListener("click", () => cxCloseMenu());
  document.addEventListener("scroll", () => cxCloseMenu(), true);

  /* atalhos */
  document.addEventListener("keydown", e => {
    if (!cxIsAdmin() || currentView !== "produtos") return;
    if (e.target.closest("input, textarea, select, [contenteditable]") || document.querySelector(".modal-backdrop.open")) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === "c") { if (cx.sel.size) { e.preventDefault(); cxSetClip("copy"); } }
    else if (mod && k === "x") { if (cx.sel.size) { e.preventDefault(); cxSetClip("cut"); } }
    else if (mod && k === "v") { if (cx.clip) { e.preventDefault(); cxPaste(); } }
    else if (mod && k === "z") { e.preventDefault(); cxUndo(); }
    else if (mod && k === "a") { e.preventDefault(); cxVisibleKeys().forEach(x => cx.sel.add(x)); cxDecorate(); }
    else if (k === "escape") { if (cx.sel.size) { cx.sel.clear(); cxDecorate(); } }
  });
})();

/* decide o que acontece ao soltar sobre o ponto atual */
function cxPlanDrop(e) {
  if (!cx.drag) return null;
  const entries = cx.drag.keys.map(cxEntryFromKey);
  const allFolders = entries.every(x => x.kind === "folder"), allItems = entries.every(x => x.kind === "item");
  const crumb = e.target.closest("[data-cx-crumb]");
  if (crumb) {
    const idx = parseInt(crumb.dataset.cxCrumb, 10);
    const container = idx < 0 ? [] : catalogNavPath.slice(0, idx + 1);
    if (container.length === catalogNavPath.length) return null;
    if (!entries.some(en => cxCanPlace(en, container))) return null;
    return { type: "into", container, el: crumb };
  }
  const box = e.target.closest(".cat-box-wrap[data-cx-key]");
  if (box) {
    const name = box.dataset.cxName;
    const rect = box.getBoundingClientRect();
    if (allFolders) {
      if (entries.some(x => x.name === name)) return null;
      return { type: "folders", targetName: name, before: e.clientX < rect.left + rect.width / 2, el: box };
    }
    if (allItems && cxLevel() + 1 >= 2) return { type: "into", container: [...catalogNavPath, name], el: box };
    return null;
  }
  const card = e.target.closest(".prod-card[data-cx-key]");
  if (card && allItems) {
    const id = card.dataset.cxId;
    if (entries.some(x => x.id === id)) return null;
    const rect = card.getBoundingClientRect();
    return { type: "items", targetId: id, before: e.clientY < rect.top + rect.height / 2 || e.clientX < rect.left + rect.width / 4, el: card };
  }
  return null;
}
function cxClearDropMarks() {
  cxList().querySelectorAll(".cx-drop-into, .cx-drop-before, .cx-drop-after").forEach(el => el.classList.remove("cx-drop-into", "cx-drop-before", "cx-drop-after"));
}

/* ---- menu de contexto ---- */
function cxCloseMenu() { document.querySelector(".cx-menu")?.remove(); }
function cxOpenMenu(x, y, target) {
  cxCloseMenu();
  const has = cx.sel.size > 0;
  const isFolder = target && target.dataset.cxKey.startsWith("f:") && cx.sel.size === 1;
  const row = (id, label, enabled = true) => `<button type="button" class="cx-menu-item" data-cxm="${id}" ${enabled ? "" : "disabled"}>${label}</button>`;
  const menu = document.createElement("div");
  menu.className = "cx-menu";
  menu.innerHTML = [
    isFolder ? row("open", "📂 Abrir") : "",
    row("all", "☑ Selecionar tudo", cxVisibleKeys().length > 0),
    row("copy", "⧉ Copiar", has), row("cut", "✂ Recortar", has),
    row("paste", `📋 Colar aqui${cx.clip ? ` (${cx.clip.entries.length})` : ""}`, !!cx.clip),
    isFolder ? row("rename", "✎ Renomear") : "",
    has ? row("delete", "🗑 Excluir", true) : "",
    cx.undo.length ? row("undo", `↶ Desfazer: ${cxEsc(cx.undo[cx.undo.length - 1].label)}`) : "",
  ].join("");
  menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
  menu.addEventListener("click", async ev => {
    const b = ev.target.closest("[data-cxm]");
    if (!b || b.disabled) return;
    ev.stopPropagation();
    cxCloseMenu();
    const a = b.dataset.cxm;
    if (a === "all") { cxVisibleKeys().forEach(k => cx.sel.add(k)); cxDecorate(); }
    else if (a === "undo") cxUndo();
    else if (a === "open") target.querySelector(".cat-box").click();
    else if (a === "copy") cxSetClip("copy");
    else if (a === "cut") cxSetClip("cut");
    else if (a === "paste") cxPaste();
    else if (a === "rename") target.querySelector(".cat-box-rename")?.click();
    else if (a === "delete") await cxDeleteSelection();
  });
  document.body.appendChild(menu);
}

/* excluir seleção (com confirmação e desfazer) */
async function cxDeleteSelection() {
  const entries = cxSelectedEntries();
  if (!entries.length) return;
  const items = Array.from(new Set(entries.flatMap(cxEntryItems)));
  if (!confirm(`Excluir ${entries.length} seleção(ões) com ${items.length} produto(s)? Dá para desfazer logo em seguida.`)) return;
  const rec = cxRecorder();
  items.forEach(p => cxTouchItem(rec, p));
  const ids = items.map(p => p.id);
  catalog = catalog.filter(p => !ids.includes(p.id));
  await bulkDeleteCatalogItemsRemote(ids);
  cxCommit(`excluir ${items.length} produto(s)`, rec);
  cx.sel.clear();
  cxRefresh();
}
