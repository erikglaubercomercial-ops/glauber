/* ============================================================
   PRODUTOS EM PASTAS (tela Produtos)
   Pastas reais: País › Cidade › Cursos | Faculdade | Acomodação › Escola ›
   1 Curso | Renovação › AM | PM › tabelas de preço (itens e subitens).
   Pastas vazias existem de verdade; criar uma cidade, escola ou plano já traz
   as pastas-padrão dentro. Só ADM altera: selecionar (caixinha, Cmd/Ctrl+clique,
   Shift+clique), copiar/recortar/colar, arrastar para mover, reorganizar a ordem
   e desfazer.
   Os produtos continuam com os campos antigos (categoria, destino, subgrupo,
   turno, escola_codigo) — são derivados da pasta, e é por eles que a Cotação,
   o Comparativo de escolas e as páginas públicas seguem funcionando.
   Depende de script.js: catalog, catalogFolders, catalogNavPath, schools, uid,
   cfById/cfKids/cfChain/cfApplyLegacy/cfRecomputeAll, folderToDb, saveSchoolRemote,
   deleteSchoolRemote, newSchoolCode, bulkSaveCatalogItemsRemote,
   bulkDeleteCatalogItemsRemote, loadCatalog/loadCatalogFolders/loadSchools,
   adminItemCardHtml, quoteMontaDestinos, quoteMontaCatalogo.
   ============================================================ */

const cx = { sel: new Set(), clip: null, undo: [], drag: null, anchor: null, pathKey: "", busy: false };
const cxEsc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s));
const cxIsAdmin = () => !!(session && session.role === "ADM");
const cxList = () => document.getElementById("catalog-list");
const cxClone = o => JSON.parse(JSON.stringify(o));
function cxToast(msg) {
  if (typeof agendaToast === "function") agendaToast(msg); else alert(msg);
}

/* ============================================================
   TIPOS DE PASTA
   ============================================================ */
const cfSvg = body => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const CF_KINDS = {
  pais:   { label: "País",                color: "#3167A1", icon: () => CATALOG_ICONS.categoria },
  cidade: { label: "Cidade",              color: "#0EA5E9", icon: () => CATALOG_ICONS.destino },
  tipo:   { label: "Cursos / Faculdade",  color: "#10B981", icon: () => cfSvg('<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>') },
  acomod: { label: "Acomodação",          color: "#F43F5E", icon: () => cfSvg('<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>') },
  escola: { label: "Escola",              color: "#8B5CF6", icon: () => CATALOG_ICONS.escola },
  plano:  { label: "Plano",               color: "#6366F1", icon: () => cfSvg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/>') },
  turno:  { label: "Turno",               color: "#F59E0B", icon: () => CATALOG_ICONS.turno },
  grupo:  { label: "Pasta",               color: "#64748B", icon: () => cfSvg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>') },
};
/* o que cabe dentro de cada tipo de pasta ("" = raiz) */
const CF_ALLOWED = {
  "": ["pais"], pais: ["cidade", "grupo"], cidade: ["tipo", "acomod", "grupo"], tipo: ["escola", "grupo"],
  acomod: ["escola", "grupo"], escola: ["plano", "grupo"], plano: ["turno", "grupo"], turno: ["grupo"], grupo: ["grupo"],
};

/* ============================================================
   MODELO: leitura
   ============================================================ */
const cfItemsIn = id => catalog.filter(p => p.folderId === id).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
const cfOrphans = () => catalog.filter(p => !p.folderId || !cfById(p.folderId)).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
function cfSubtreeIds(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) catalogFolders.forEach(f => { if (f.parentId === out[i]) out.push(f.id); });
  return out;
}
function cfSubtreeItems(id) {
  const ids = new Set(cfSubtreeIds(id));
  return catalog.filter(p => ids.has(p.folderId));
}
const cfCurrentId = () => catalogNavPath[catalogNavPath.length - 1] || null;
const cfSameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const cfNameTaken = (parentId, nome, exceptId) => cfKids(parentId).some(k => k.id !== exceptId && cfSameName(k.nome, nome));
function cfFreeName(parentId, name) {
  let cand = name, n = 0;
  while (cfNameTaken(parentId, cand)) { cand = `${name} (cópia${n ? " " + (n + 1) : ""})`; n++; }
  return cand;
}
function cfNextOrdem(parentId) {
  const kids = cfKids(parentId);
  return kids.length ? Math.max(...kids.map(k => k.ordem || 0)) + 1 : 1;
}
const cfNextItemOrdem = () => catalog.reduce((m, x) => Math.max(m, x.ordem || 0), 0);

/* tipo da pasta nova dentro de `parentId` */
function cfNaturalKind(parentId) {
  const par = cfById(parentId);
  if (!par) return "pais";
  if (par.kind === "pais") {
    const direto = catalog.some(p => p.folderId === par.id) || cfKids(par.id).some(k => k.kind === "grupo");
    return direto ? "grupo" : "cidade";
  }
  return { cidade: "tipo", tipo: "escola", acomod: "escola", escola: "plano", plano: "turno", turno: "grupo", grupo: "grupo" }[par.kind] || "grupo";
}
function cfCanPlaceFolder(f, containerId) {
  if (containerId && cfSubtreeIds(f.id).includes(containerId)) return false;
  const par = containerId ? cfById(containerId) : null;
  if (containerId && !par) return false;
  return (CF_ALLOWED[par ? par.kind : ""] || []).includes(f.kind);
}
const cfCanPlaceItem = containerId => !!containerId && !!cfById(containerId);

/* ============================================================
   MODELO: criação, escolas e gravação
   ============================================================ */
function cfMake(parentId, kind, nome, ordem) {
  const f = { id: uid(), parentId: parentId || null, kind, nome, ordem: ordem == null ? cfNextOrdem(parentId) : ordem, escolaCodigo: "" };
  catalogFolders.push(f);
  return f;
}
const cfFolderOfSchoolCode = code => (code ? catalogFolders.find(f => f.kind === "escola" && f.escolaCodigo === code) || null : null);

/* liga a pasta da escola à escola cadastrada (usa uma que já exista com o mesmo país/cidade/nome, senão cria) */
function cfLinkSchool(folder) {
  const chain = cfChain(folder.id);
  const pais = chain[0] && chain[0].nome;
  const cid = chain.find(x => x.kind === "cidade");
  if (!pais || !cid) return null;
  let sc = schools.find(s => s.categoria === pais && s.destino === cid.nome && s.nome === folder.nome && !cfFolderOfSchoolCode(s.codigo));
  let isNew = false;
  if (!sc) {
    sc = {
      id: uid(), nome: folder.nome, categoria: pais, destino: cid.nome, descricao: "", inclusos: [], ativo: true,
      ordem: schools.reduce((m, x) => Math.max(m, x.ordem || 0), 0) + 1, coverPath: null, codigo: "",
    };
    sc.codigo = newSchoolCode(sc.nome, sc.destino);
    schools.push(sc);
    isNew = true;
  }
  folder.escolaCodigo = sc.codigo;
  return { school: sc, isNew };
}

/* pastas-padrão que nascem junto com cada tipo */
function cfBuildPlanos(escola, created) {
  [["1 Curso", 1], ["Renovação", 2]].forEach(([nome, ord]) => {
    const pl = cfMake(escola.id, "plano", nome, ord); created.push(pl);
    created.push(cfMake(pl.id, "turno", "AM", 1), cfMake(pl.id, "turno", "PM", 2));
  });
}
function cfBuildSkeleton(f, created, newSchools) {
  const par = cfById(f.parentId);
  if (f.kind === "cidade") {
    created.push(cfMake(f.id, "tipo", "Cursos", 1), cfMake(f.id, "tipo", "Faculdade", 2), cfMake(f.id, "acomod", "Acomodação", 3));
  } else if (f.kind === "escola" && par && par.kind === "tipo") {
    const link = cfLinkSchool(f);
    if (link && link.isNew) newSchools.push(link.school);
    cfBuildPlanos(f, created);
  } else if (f.kind === "plano") {
    created.push(cfMake(f.id, "turno", "AM", 1), cfMake(f.id, "turno", "PM", 2));
  }
}

/* Escolas → Produtos: garante País › Cidade › Cursos › Escola para uma escola cadastrada e a mantém
   no lugar certo quando ela muda de nome ou de cidade */
async function cfEnsureSchoolFolder(school) {
  if (!school || !school.categoria || !school.destino || school.categoria === "Serviços Peregrinos") return;
  const created = [], changed = [];
  const kid = (pid, nome) => cfKids(pid).find(k => cfSameName(k.nome, nome));
  let pais = kid(null, school.categoria);
  if (!pais) { pais = cfMake(null, "pais", school.categoria); created.push(pais); }
  let cid = kid(pais.id, school.destino);
  if (!cid) { cid = cfMake(pais.id, "cidade", school.destino); created.push(cid); cfBuildSkeleton(cid, created, []); }
  const tipo = kid(cid.id, "Cursos") || cfKids(cid.id).find(k => k.kind === "tipo") || (() => { const x = cfMake(cid.id, "tipo", "Cursos", 1); created.push(x); return x; })();
  let esc = cfFolderOfSchoolCode(school.codigo);
  if (esc) {
    const clash = cfKids(tipo.id).find(k => k.id !== esc.id && cfSameName(k.nome, school.nome));
    if (clash) { cxToast(`Já existe "${school.nome}" em ${school.destino} nos Produtos; a pasta da escola não foi movida.`); }
    else {
      if (esc.parentId !== tipo.id) { esc.parentId = tipo.id; esc.ordem = cfNextOrdem(tipo.id); changed.push(esc); }
      if (esc.nome !== school.nome) { esc.nome = school.nome; changed.push(esc); }
    }
  } else {
    const same = kid(tipo.id, school.nome);
    if (same) {
      if (same.kind === "escola" && !same.escolaCodigo) { same.escolaCodigo = school.codigo; changed.push(same); }
    } else {
      esc = cfMake(tipo.id, "escola", school.nome); esc.escolaCodigo = school.codigo; created.push(esc);
      cfBuildPlanos(esc, created);
    }
  }
  if (!created.length && !changed.length) return;
  cfRecomputeAll();
  await cfPersist({ folders: [...created, ...changed] });
  cfRefreshAll();
}

/* escolas cadastradas acompanham o nome/lugar da pasta delas; devolve as que mudaram */
function cfSyncSchools(rec) {
  const changed = [];
  catalogFolders.filter(f => f.kind === "escola" && f.escolaCodigo).forEach(f => {
    const sc = schools.find(s => s.codigo === f.escolaCodigo);
    if (!sc) return;
    const chain = cfChain(f.id);
    const pais = chain[0] && chain[0].nome;
    const cid = chain.find(x => x.kind === "cidade");
    if (!pais || !cid) return;
    if (sc.nome !== f.nome || sc.categoria !== pais || sc.destino !== cid.nome) {
      if (rec) cxTouchSchool(rec, sc);
      sc.nome = f.nome; sc.categoria = pais; sc.destino = cid.nome;
      changed.push(sc);
    }
  });
  return changed;
}

/* grava no banco na ordem certa: apaga produtos, apaga pastas, grava pastas (pais antes dos filhos), escolas e produtos */
function cfSortParentsFirst(list) {
  const depth = f => { let d = 0, x = f; while (x && x.parentId && d < 20) { x = list.find(y => y.id === x.parentId) || cfById(x.parentId); d++; } return d; };
  return list.slice().sort((a, b) => depth(a) - depth(b));
}
async function cfPersist(op) {
  let ok = true;
  if (op.deleteItems && op.deleteItems.length) ok = (await bulkDeleteCatalogItemsRemote(op.deleteItems)) && ok;
  if (op.deleteFolders && op.deleteFolders.length) {
    const { error } = await supabase.from("catalog_folders").delete().in("id", op.deleteFolders);
    if (error) { console.error("Erro ao excluir pastas:", error); ok = false; }
  }
  if (op.folders && op.folders.length) {
    const uniq = Array.from(new Map(op.folders.map(f => [f.id, f])).values());
    const { error } = await supabase.from("catalog_folders").upsert(cfSortParentsFirst(uniq).map(folderToDb));
    if (error) { console.error("Erro ao salvar pastas:", error); ok = false; }
  }
  for (const sc of op.schools || []) ok = (await saveSchoolRemote(sc)) && ok;
  for (const id of op.deleteSchools || []) await deleteSchoolRemote(id);
  if (op.items && op.items.length) ok = (await bulkSaveCatalogItemsRemote(op.items)) && ok;
  if (!ok) {
    cxToast("Não consegui salvar tudo no banco. Recarregando o catálogo para ficar igual ao que está salvo.");
    await cfReload();
  }
  return ok;
}
async function cfReload() {
  [catalog, catalogFolders, schools] = await Promise.all([loadCatalog(), loadCatalogFolders(), loadSchools()]);
  cfRecomputeAll();
  cx.sel.clear(); cx.undo = []; cx.clip = null;
  cfRefreshAll();
}
function cfRefreshAll() {
  renderCatalogList();
  if (typeof quoteMontaDestinos === "function") quoteMontaDestinos();
  if (typeof quoteMontaCatalogo === "function") quoteMontaCatalogo();
  if (typeof renderSchoolsList === "function") renderSchoolsList();
  if (typeof renderSchoolComparisonView === "function") { try { renderSchoolComparisonView(); } catch (err) { /* tela de escolas ainda não montada */ } }
}

/* ============================================================
   DESFAZER
   ============================================================ */
function cxRecorder() {
  return { items: new Map(), createdItems: [], folders: new Map(), createdFolders: [], schools: new Map(), createdSchools: [] };
}
const cxTouchItem = (rec, p) => { if (!rec.items.has(p.id)) rec.items.set(p.id, cxClone(p)); };
const cxTouchFolder = (rec, f) => { if (!rec.folders.has(f.id)) rec.folders.set(f.id, cxClone(f)); };
const cxTouchSchool = (rec, s) => { if (!rec.schools.has(s.id)) rec.schools.set(s.id, cxClone(s)); };
function cxCommit(label, rec) {
  cx.undo.push({ label, ...rec });
  if (cx.undo.length > 15) cx.undo.shift();
}
async function cxUndo() {
  if (cx.busy) return;
  const op = cx.undo.pop();
  if (!op) { cxToast("Nada para desfazer."); return; }
  cx.busy = true;
  const delItemIds = op.createdItems.map(p => p.id);
  const delFolderIds = op.createdFolders.slice();
  const delSchoolIds = op.createdSchools.map(s => s.id);
  catalog = catalog.filter(p => !delItemIds.includes(p.id));
  catalogFolders = catalogFolders.filter(f => !delFolderIds.includes(f.id));
  schools = schools.filter(s => !delSchoolIds.includes(s.id));
  op.folders.forEach(before => {
    const idx = catalogFolders.findIndex(f => f.id === before.id);
    if (idx >= 0) catalogFolders[idx] = cxClone(before); else catalogFolders.push(cxClone(before));
  });
  op.schools.forEach(before => {
    const idx = schools.findIndex(s => s.id === before.id);
    if (idx >= 0) schools[idx] = cxClone(before); else schools.push(cxClone(before));
  });
  op.items.forEach(before => {
    const idx = catalog.findIndex(p => p.id === before.id);
    if (idx >= 0) catalog[idx] = cxClone(before); else catalog.push(cxClone(before));
  });
  cfRecomputeAll();
  await cfPersist({
    deleteItems: delItemIds, deleteFolders: delFolderIds, folders: Array.from(op.folders.values()),
    schools: Array.from(op.schools.values()), deleteSchools: delSchoolIds, items: Array.from(op.items.values()),
  });
  cx.sel.clear();
  cx.busy = false;
  cfRefreshAll();
  cxToast(`Desfeito: ${op.label}`);
}

/* ============================================================
   OPERAÇÕES (mover, copiar, reordenar, criar, renomear, excluir)
   ============================================================ */
const cxEntryFromKey = key => ({ kind: key.startsWith("i:") ? "item" : "folder", id: key.slice(2) });
const cxReassignOrder = list => {
  const slots = list.map(p => p.ordem || 0).sort((a, b) => a - b);
  for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
  list.forEach((p, i) => { p.ordem = slots[i]; });
};

async function cxMove(entries, containerId) {
  const rec = cxRecorder();
  const movedFolders = [], movedItems = [];
  let skipped = 0;
  let nextItem = cfNextItemOrdem();
  for (const en of entries) {
    if (en.kind === "folder") {
      const f = cfById(en.id);
      if (!f) continue;
      if ((f.parentId || null) === (containerId || null) || !cfCanPlaceFolder(f, containerId)) { skipped++; continue; }
      if (cfNameTaken(containerId, f.nome)) {
        alert(`Já existe "${f.nome}" nesse lugar. Renomeie uma das duas ou use Colar para criar uma cópia.`);
        return false;
      }
      cxTouchFolder(rec, f);
      f.ordem = cfNextOrdem(containerId);
      f.parentId = containerId || null;
      movedFolders.push(f);
    } else {
      const p = catalog.find(x => x.id === en.id);
      if (!p) continue;
      if (!cfCanPlaceItem(containerId) || p.folderId === containerId) { skipped++; continue; }
      cxTouchItem(rec, p);
      p.folderId = containerId;
      p.ordem = ++nextItem;
      movedItems.push(p);
    }
  }
  if (!movedFolders.length && !movedItems.length) {
    if (skipped) cxToast("Nada foi movido: esse destino não serve para o que foi selecionado.");
    return false;
  }
  cfRecomputeAll();
  const schs = cfSyncSchools(rec);
  cx.busy = true;
  await cfPersist({ folders: movedFolders, items: movedItems, schools: schs });
  cx.busy = false;
  cxCommit(`mover ${movedFolders.length + movedItems.length} seleção(ões)`, rec);
  return true;
}

/* copia uma pasta inteira (com subpastas e produtos) para dentro de newParentId */
function cfCopyTree(srcId, newParentId, name, ctx) {
  const src = cfById(srcId);
  const f = cfMake(newParentId, src.kind, name, newParentId === ctx.containerId && srcId === ctx.rootId ? cfNextOrdem(newParentId) : src.ordem);
  ctx.createdFolders.push(f);
  if (src.kind === "escola" && src.escolaCodigo) ctx.schoolSrc.set(f.id, src.escolaCodigo);
  cfItemsIn(srcId).forEach(p => {
    const c = { ...p, id: uid(), subs: cxClone(p.subs || []), ordem: ++ctx.nextItem, folderId: f.id };
    ctx.createdItems.push(c);
  });
  cfKids(srcId).forEach(k => cfCopyTree(k.id, f.id, k.nome, ctx));
  return f;
}

async function cxCopy(entries, containerId, opts) {
  const rec = cxRecorder();
  const ctx = { containerId, rootId: null, createdFolders: [], createdItems: [], schoolSrc: new Map(), nextItem: cfNextItemOrdem() };
  let skipped = 0;
  for (const en of entries) {
    if (en.kind === "item") {
      const src = catalog.find(x => x.id === en.id);
      if (!src) continue;
      if (!cfCanPlaceItem(containerId)) { skipped++; continue; }
      const copy = { ...src, id: uid(), subs: cxClone(src.subs || []), ordem: ++ctx.nextItem, folderId: containerId };
      if (src.folderId === containerId) copy.nome = `${src.nome} (cópia)`;
      ctx.createdItems.push(copy);
    } else {
      const src = cfById(en.id);
      if (!src) continue;
      if (!cfCanPlaceFolder(src, containerId)) { skipped++; continue; }
      ctx.rootId = src.id;
      const name = opts && opts.name ? opts.name : cfFreeName(containerId, src.nome);
      cfCopyTree(src.id, containerId, name, ctx);
    }
  }
  if (!ctx.createdFolders.length && !ctx.createdItems.length) {
    if (skipped) cxToast("Nada foi colado: esse lugar não serve para o que foi copiado.");
    return false;
  }
  /* escolas copiadas ganham uma cópia da escola cadastrada, ligada por um código novo */
  const newSchools = [];
  ctx.createdFolders.forEach(f => {
    const srcCode = ctx.schoolSrc.get(f.id);
    const srcSc = srcCode ? schools.find(s => s.codigo === srcCode) : null;
    if (!srcSc) return;
    const chain = cfChain(f.id);
    const cid = chain.find(x => x.kind === "cidade");
    const sc = {
      ...srcSc, id: uid(), inclusos: srcSc.inclusos.slice(), nome: f.nome,
      categoria: (chain[0] && chain[0].nome) || srcSc.categoria, destino: cid ? cid.nome : srcSc.destino,
      ordem: schools.reduce((m, x) => Math.max(m, x.ordem || 0), 0) + 1, codigo: "",
    };
    sc.codigo = newSchoolCode(sc.nome, sc.destino);
    schools.push(sc);
    f.escolaCodigo = sc.codigo;
    newSchools.push(sc);
  });
  ctx.createdItems.forEach(cfApplyLegacy);
  catalog.push(...ctx.createdItems);
  rec.createdFolders = ctx.createdFolders.map(f => f.id);
  rec.createdItems = ctx.createdItems;
  rec.createdSchools = newSchools;
  cx.busy = true;
  await cfPersist({ folders: ctx.createdFolders, schools: newSchools, items: ctx.createdItems });
  cx.busy = false;
  cxCommit(`colar ${entries.length} seleção(ões)`, rec);
  return true;
}

async function cxReorderFolders(draggedIds, targetId, before) {
  const sibs = cfKids(cfCurrentId());
  const moving = sibs.filter(f => draggedIds.includes(f.id));
  const rest = sibs.filter(f => !draggedIds.includes(f.id));
  const at = rest.findIndex(f => f.id === targetId);
  if (at < 0 || !moving.length) return false;
  rest.splice(before ? at : at + 1, 0, ...moving);
  if (rest.map(f => f.id).join() === sibs.map(f => f.id).join()) return false;
  const rec = cxRecorder();
  rest.forEach(f => cxTouchFolder(rec, f));
  rest.forEach((f, i) => { f.ordem = i + 1; });
  const changed = rest.filter(f => f.ordem !== rec.folders.get(f.id).ordem);
  if (!changed.length) return false;
  cx.busy = true;
  await cfPersist({ folders: changed });
  cx.busy = false;
  cxCommit("reorganizar pastas", rec);
  return true;
}
async function cxReorderItems(draggedIds, targetId, before) {
  const cur = cfCurrentId();
  const list = cur ? cfItemsIn(cur) : cfOrphans();
  const moving = list.filter(p => draggedIds.includes(p.id));
  const rest = list.filter(p => !draggedIds.includes(p.id));
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
  await cfPersist({ items: changed });
  cx.busy = false;
  cxCommit("reorganizar produtos", rec);
  return true;
}

/* + Nova pasta (dentro da pasta aberta) */
async function cfNewFolderPrompt() {
  if (!cxIsAdmin()) return;
  const parentId = cfCurrentId();
  const kind = cfNaturalKind(parentId);
  const par = cfById(parentId);
  const nome = prompt(`Nome da nova pasta (${CF_KINDS[kind].label}${par ? ` dentro de "${par.nome}"` : ""}):`);
  if (nome === null) return;
  const n = nome.trim();
  if (!n) return;
  if (cfNameTaken(parentId, n)) { alert("Já existe uma pasta com esse nome aqui."); return; }
  const rec = cxRecorder();
  const created = [], newSchools = [];
  const f = cfMake(parentId, kind, n);
  created.push(f);
  cfBuildSkeleton(f, created, newSchools);
  rec.createdFolders = created.map(x => x.id);
  rec.createdSchools = newSchools;
  cfRecomputeAll();
  cx.busy = true;
  await cfPersist({ folders: created, schools: newSchools });
  cx.busy = false;
  cxCommit(`criar pasta "${n}"`, rec);
  cfRefreshAll();
}

async function cfRenamePrompt(id) {
  const f = cfById(id);
  if (!f) return false;
  const nome = prompt(t("products.renameBoxPrompt"), f.nome);
  if (nome === null) return false;
  const n = nome.trim();
  if (!n || n === f.nome) return false;
  if (cfNameTaken(f.parentId, n, f.id)) { alert(t("products.renameBoxDuplicate")); return false; }
  const rec = cxRecorder();
  cxTouchFolder(rec, f);
  f.nome = n;
  cfRecomputeAll();
  const schs = cfSyncSchools(rec);
  await cfPersist({ folders: [f], schools: schs });
  cxCommit(`renomear para "${n}"`, rec);
  return true;
}
async function cfDuplicatePrompt(id) {
  const f = cfById(id);
  if (!f) return false;
  const nome = prompt(t("products.duplicateBoxPrompt"), cfFreeName(f.parentId, f.nome));
  if (nome === null) return false;
  const n = nome.trim();
  if (!n) return false;
  if (cfNameTaken(f.parentId, n)) { alert(t("products.renameBoxDuplicate")); return false; }
  return cxCopy([{ kind: "folder", id }], f.parentId, { name: n });
}

/* excluir (pastas com tudo o que há dentro, e produtos) — com confirmação e desfazer */
async function cxDeleteEntries(entries) {
  const folderIds = entries.filter(e => e.kind === "folder").map(e => e.id).filter(id => cfById(id));
  const allFolderIds = new Set(folderIds.flatMap(cfSubtreeIds));
  const items = new Map();
  entries.filter(e => e.kind === "item").forEach(e => { const p = catalog.find(x => x.id === e.id); if (p) items.set(p.id, p); });
  catalog.filter(p => allFolderIds.has(p.folderId)).forEach(p => items.set(p.id, p));
  if (!folderIds.length && !items.size) return false;
  const nome = folderIds.length === 1 && !items.size ? `a pasta "${cfById(folderIds[0]).nome}"` : `${entries.length} seleção(ões)`;
  const sub = allFolderIds.size - folderIds.length;
  if (!confirm(`Excluir ${nome}, com ${items.size} produto(s)${sub ? ` e ${sub} subpasta(s)` : ""}? Dá para desfazer logo em seguida.`)) return false;
  const rec = cxRecorder();
  allFolderIds.forEach(id => cxTouchFolder(rec, cfById(id)));
  items.forEach(p => cxTouchItem(rec, p));
  const itemIds = Array.from(items.keys());
  catalog = catalog.filter(p => !items.has(p.id));
  catalogFolders = catalogFolders.filter(f => !allFolderIds.has(f.id));
  cx.sel.clear();
  cx.busy = true;
  await cfPersist({ deleteItems: itemIds, deleteFolders: folderIds });
  cx.busy = false;
  cxCommit(`excluir ${nome}`, rec);
  return true;
}

/* ============================================================
   TELA
   ============================================================ */
function cfBreadcrumbHtml() {
  const items = [{ label: t("common.catalogRoot"), idx: -1 }, ...catalogNavPath.map((id, i) => ({ label: (cfById(id) || {}).nome || "?", idx: i }))];
  return `<div class="cat-breadcrumb">${items.map((it, i) => {
    const isLast = i === items.length - 1;
    return `${i > 0 ? '<span class="cat-crumb-sep">›</span>' : ""}<button type="button" class="cat-crumb${isLast ? " active" : ""}" data-idx="${it.idx}">${cxEsc(it.label)}</button>`;
  }).join("")}</div>`;
}
function cfBoxesHtml(kids, isAdmin) {
  const word = t("products.itemWord");
  return `<div class="cat-box-grid">${kids.map(f => {
    const k = CF_KINDS[f.kind] || CF_KINDS.grupo;
    const n = cfSubtreeItems(f.id).length;
    return `
      <div class="cat-box-wrap${n ? "" : " is-empty"}" data-fid="${f.id}">
        <button type="button" class="cat-box" data-nav="${f.id}" style="--box-color:${k.color}" title="${cxEsc(k.label)}">
          <span class="cat-box-icon">${k.icon()}</span>
          <span class="cat-box-name">${cxEsc(f.nome)}</span>
          <span class="cat-box-count">${n} ${n === 1 ? word : word + "s"}</span>
          <span class="cat-box-arrow" aria-hidden="true">›</span>
        </button>
        ${isAdmin ? `
          <div class="cat-box-admin-acts">
            <button type="button" class="btn-icon cat-box-rename" data-id="${f.id}" title="${t("products.renameBox")}">${CATALOG_BOX_ICON_RENAME}</button>
            <button type="button" class="btn-icon cat-box-duplicate" data-id="${f.id}" title="${t("common.duplicate")}">${CATALOG_BOX_ICON_DUPLICATE}</button>
            <button type="button" class="btn-icon cat-box-delete" data-id="${f.id}" title="${t("products.deleteBox")}">${CATALOG_BOX_ICON_DELETE}</button>
          </div>` : ""}
      </div>`;
  }).join("")}</div>`;
}

function renderCatalogList() {
  const isAdmin = cxIsAdmin();
  const listEl = cxList();
  document.getElementById("btn-new-catalog-item").style.display = isAdmin ? "" : "none";
  const btnFolder = document.getElementById("btn-new-catalog-folder");
  if (btnFolder) btnFolder.style.display = isAdmin ? "" : "none";
  renderProductsDashboard();

  /* o caminho aberto precisa continuar existindo */
  let parent = null, valid = true;
  for (const id of catalogNavPath) {
    const f = cfById(id);
    if (!f || (f.parentId || null) !== parent) { valid = false; break; }
    parent = id;
  }
  if (!valid) catalogNavPath = [];

  if (!catalogFolders.length && !catalog.length) {
    listEl.innerHTML = `<div class="prod-empty"><div class="prod-empty-icon">${CATALOG_ICONS.categoria}</div><p>${t("products.emptyCatalog1")} "+ Nova pasta" ${t("products.emptyCatalog2")}</p></div>`;
    return;
  }

  const cur = cfCurrentId();
  const kids = cfKids(cur);
  const items = cur ? cfItemsIn(cur) : cfOrphans();
  let html = cfBreadcrumbHtml();
  if (kids.length) html += cfBoxesHtml(kids, isAdmin);
  if (items.length) html += `<div class="cat-items-grid">${items.map(p => adminItemCardHtml(p, isAdmin)).join("")}</div>`;
  if (!kids.length && !items.length) {
    const hint = isAdmin ? "Pasta vazia. Use + Nova pasta ou + Novo produto para preencher, ou cole algo copiado." : t("products.emptyItemsHere");
    html += `<div class="prod-empty"><div class="prod-empty-icon">${CATALOG_ICONS.escola}</div><p>${hint}</p></div>`;
  }
  listEl.innerHTML = html;
  if (isAdmin) cxDecorate();
}

/* ============================================================
   SELEÇÃO / ÁREA DE TRANSFERÊNCIA
   ============================================================ */
const cxFolderKey = id => `f:${id}`;
const cxItemKey = id => `i:${id}`;
function cxVisibleKeys() {
  return Array.from(cxList().querySelectorAll("[data-cx-key]")).map(el => el.dataset.cxKey);
}
const cxSelectedEntries = () => Array.from(cx.sel).map(cxEntryFromKey);
function cxSetClip(mode) {
  const entries = cxSelectedEntries();
  if (!entries.length) { cxToast("Selecione pastas ou produtos primeiro (caixinha no canto do cartão)."); return; }
  cx.clip = { mode, entries };
  cxToast(`${entries.length} item(ns) ${mode === "cut" ? "recortado(s)" : "copiado(s)"}. Abra a pasta de destino e clique em Colar.`);
  cxDecorate();
}
async function cxPaste() {
  if (!cx.clip || cx.busy) { if (!cx.clip) cxToast("A área de transferência está vazia."); return; }
  const container = cfCurrentId();
  const entries = cx.clip.entries;
  const ok = cx.clip.mode === "cut" ? await cxMove(entries, container) : await cxCopy(entries, container);
  if (ok) {
    if (cx.clip.mode === "cut") cx.clip = null;
    cx.sel.clear();
    cfRefreshAll();
  }
}
const cxToggle = key => { if (cx.sel.has(key)) cx.sel.delete(key); else cx.sel.add(key); };

function cxDecorate() {
  const list = cxList();
  if (!list || !cxIsAdmin() || !list.querySelector(".cat-breadcrumb")) return;
  const key = JSON.stringify(catalogNavPath);
  if (cx.pathKey !== key) { cx.sel.clear(); cx.anchor = null; cx.pathKey = key; }
  const cutKeys = new Set();
  if (cx.clip && cx.clip.mode === "cut") cx.clip.entries.forEach(en => cutKeys.add(en.kind === "item" ? cxItemKey(en.id) : cxFolderKey(en.id)));
  list.querySelectorAll(".cat-box-wrap").forEach(wrap => {
    const id = wrap.dataset.fid;
    if (!id) return;
    const k = cxFolderKey(id);
    wrap.dataset.cxKey = k; wrap.draggable = true;
    cxMark(wrap, k, cutKeys);
  });
  list.querySelectorAll(".prod-card").forEach(card => {
    const id = card.querySelector('[data-act="edit"]')?.dataset.id;
    if (!id) return;
    const k = cxItemKey(id);
    card.dataset.cxKey = k; card.dataset.cxId = id; card.draggable = true;
    cxMark(card, k, cutKeys);
  });
  list.querySelectorAll(".cat-crumb").forEach(c => { c.dataset.cxCrumb = c.dataset.idx; });
  list.querySelector(".cx-bar")?.remove();
  /* a barra só aparece quando há algo a fazer (seleção, área de transferência ou desfazer):
     fora disso a tela fica como sempre foi */
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

  document.getElementById("btn-new-catalog-folder")?.addEventListener("click", cfNewFolderPrompt);

  /* seleção: caixinha, Cmd/Ctrl+clique, Shift+clique (antes da navegação) */
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

  /* navegação, botões das pastas e dos produtos */
  list.addEventListener("click", async e => {
    const crumb = e.target.closest(".cat-crumb");
    if (crumb) {
      const idx = parseInt(crumb.dataset.idx, 10);
      catalogNavPath = idx < 0 ? [] : catalogNavPath.slice(0, idx + 1);
      renderCatalogList();
      return;
    }
    if (cxIsAdmin()) {
      const ren = e.target.closest(".cat-box-rename"), dup = e.target.closest(".cat-box-duplicate"), del = e.target.closest(".cat-box-delete");
      if (ren || dup || del) {
        const id = (ren || dup || del).dataset.id;
        let changed = false;
        if (ren) changed = await cfRenamePrompt(id);
        else if (dup) changed = await cfDuplicatePrompt(id);
        else changed = await cxDeleteEntries([{ kind: "folder", id }]);
        if (changed) cfRefreshAll();
        return;
      }
    }
    const box = e.target.closest(".cat-box");
    if (box) {
      catalogNavPath = [...catalogNavPath, box.dataset.nav];
      renderCatalogList();
      return;
    }
    if (!cxIsAdmin()) return;
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const p = catalog.find(x => x.id === btn.dataset.id);
    if (!p) return;
    if (btn.dataset.act === "edit") openProductModal(p.id);
    if (btn.dataset.act === "dup") {
      const copy = {
        ...p, id: uid(), nome: `${p.nome} (${t("common.copy")})`,
        ordem: cfNextItemOrdem() + 1, subs: JSON.parse(JSON.stringify(p.subs || [])),
      };
      catalog.push(copy);
      renderCatalogList();
      quoteMontaDestinos();
      quoteMontaCatalogo();
      await saveCatalogItem(copy);
      openProductModal(copy.id);
    }
    if (btn.dataset.act === "del") {
      if (!confirm(`${t("products.confirmDelete1")} "${p.nome}" ${t("products.confirmDelete2")}`)) return;
      catalog = catalog.filter(x => x.id !== p.id);
      renderCatalogList();
      quoteMontaDestinos();
      quoteMontaCatalogo();
      await deleteCatalogItemRemote(p.id);
    }
  });

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
    else if (plan.type === "folders") ok = await cxReorderFolders(entries.map(x => x.id), plan.targetId, plan.before);
    else if (plan.type === "items") ok = await cxReorderItems(entries.map(x => x.id), plan.targetId, plan.before);
    if (ok) { cx.sel.clear(); cfRefreshAll(); } else cxDecorate();
  });

  /* menu de contexto (botão direito) */
  list.addEventListener("contextmenu", e => {
    if (!cxIsAdmin()) return;
    const target = e.target.closest("[data-cx-key]");
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
  const placeable = container => entries.some(en => en.kind === "folder"
    ? (cfById(en.id) && cfCanPlaceFolder(cfById(en.id), container))
    : cfCanPlaceItem(container));
  const crumb = e.target.closest("[data-cx-crumb]");
  if (crumb) {
    const idx = parseInt(crumb.dataset.cxCrumb, 10);
    const container = idx < 0 ? null : catalogNavPath[idx];
    if ((container || null) === cfCurrentId()) return null;
    if (!placeable(container)) return null;
    return { type: "into", container, el: crumb };
  }
  const box = e.target.closest(".cat-box-wrap[data-cx-key]");
  if (box) {
    const id = box.dataset.fid;
    const target = cfById(id);
    const rect = box.getBoundingClientRect();
    if (allFolders) {
      if (entries.some(x => x.id === id)) return null;
      /* mesmo tipo de pasta → reorganizar entre irmãs; tipo diferente que cabe dentro → mover para dentro */
      const sameKind = entries.every(x => (cfById(x.id) || {}).kind === target.kind);
      if (sameKind) return { type: "folders", targetId: id, before: e.clientX < rect.left + rect.width / 2, el: box };
      if (entries.every(x => cfById(x.id) && cfCanPlaceFolder(cfById(x.id), id))) return { type: "into", container: id, el: box };
      return null;
    }
    if (allItems) return { type: "into", container: id, el: box };
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
    row("newfolder", "📁 Nova pasta aqui"),
    cfCurrentId() ? row("newitem", "＋ Novo produto aqui") : "",
    row("all", "☑ Selecionar tudo", cxVisibleKeys().length > 0),
    row("copy", "⧉ Copiar", has), row("cut", "✂ Recortar", has),
    row("paste", `📋 Colar aqui${cx.clip ? ` (${cx.clip.entries.length})` : ""}`, !!cx.clip),
    isFolder ? row("rename", "✎ Renomear") : "",
    has ? row("delete", "🗑 Excluir", true) : "",
    cx.undo.length ? row("undo", `↶ Desfazer: ${cxEsc(cx.undo[cx.undo.length - 1].label)}`) : "",
  ].join("");
  menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 260)}px`;
  menu.addEventListener("click", async ev => {
    const b = ev.target.closest("[data-cxm]");
    if (!b || b.disabled) return;
    ev.stopPropagation();
    cxCloseMenu();
    const a = b.dataset.cxm;
    if (a === "all") { cxVisibleKeys().forEach(k => cx.sel.add(k)); cxDecorate(); }
    else if (a === "undo") cxUndo();
    else if (a === "open") target.querySelector(".cat-box").click();
    else if (a === "newfolder") cfNewFolderPrompt();
    else if (a === "newitem") openProductModal(null, cfCurrentId());
    else if (a === "copy") cxSetClip("copy");
    else if (a === "cut") cxSetClip("cut");
    else if (a === "paste") cxPaste();
    else if (a === "rename") target.querySelector(".cat-box-rename")?.click();
    else if (a === "delete") { if (await cxDeleteEntries(cxSelectedEntries())) cfRefreshAll(); }
  });
  document.body.appendChild(menu);
}
