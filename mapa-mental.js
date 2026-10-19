/* ============================================================
   MAPA MENTAL (menu MKT › Mapa Mental) — editor de criação livre, no estilo XMind
   Teclado:  Tab = tópico ao lado (filho) · Enter = tópico abaixo (irmão) · Shift+Enter = acima
             Shift+Tab = irmão do pai · F2 / duplo clique / digitar = editar · Esc = sai da edição
             Delete = exclui · Espaço = recolhe/expande · setas navegam · Cmd/Ctrl+Z desfaz
             Shift/Cmd/Ctrl + clique seleciona vários tópicos · Cmd/Ctrl + D duplica
   Barra do topo: Tópico · Subtópico | Relação · Resumo · Limite | + Inserir (tópico pai, flutuante, nota, rótulo, link, marcador)
   Painel à direita: Estilo do tópico · Apresentação (pitch) · Mapa (estrutura, tema, fundo, fonte, linhas, compacto...)
   Salva sozinho. Acesso: ADM, Gerente e MKT. JSON em mind_maps.data:
     raiz { id, t, c:[filhos], cfg:{...}, fl:[tópicos flutuantes], rel:[relações], bd:[limites] }
     tópico { id, t, c, x(recolhido), k(cor), sm:[resumos], n(nota), lb(rótulo), lk(link), mk(marcador),
              shape, fill, fg, fs, b, i }
   Depende de script.js: session, uid, escapeHtml, agendaToast, switchView.
   ============================================================ */

const MM_PALETTES = {
  vibrante: ["#D9534F", "#1E3A8A", "#F5B82E", "#2E9C8A", "#6B5BD2", "#E0784A", "#2B8FC4", "#8B5CF6", "#16A34A", "#DB2777"],
  pastel: ["#F4A6A0", "#9DB4F0", "#F9DC8B", "#9ED8CE", "#C5B9F3", "#F7C09E", "#A8D4F0", "#D8C2F7"],
  quente: ["#D9534F", "#E0784A", "#F5B82E", "#DB2777", "#B45309", "#F97316"],
  frio: ["#1E3A8A", "#2B8FC4", "#2E9C8A", "#6B5BD2", "#0EA5E9", "#16A34A"],
};
const MM_THEMES = [
  { id: "variety", name: "Variedade", bg: "#ffffff", dots: true, accent: "#3B82F6", palette: MM_PALETTES.vibrante, rootBg: "#ffffff", rootFg: "#0f2a55", rootBorder: "#3B82F6", fg: "#1a2233" },
  { id: "midnight", name: "Meia-noite", bg: "#0B0B45", accent: "#7FF0DD", palette: ["#7FF0DD", "#F5B82E", "#F4786F", "#7C9BFF", "#C084FC", "#FB923C"], rootBg: "#ffffff", rootFg: "#0B0B45", rootBorder: "#ffffff", fg: "#ffffff" },
  { id: "mint", name: "Menta", bg: "#8EF7E3", accent: "#0B0B45", palette: ["#0B0B45", "#D9534F", "#B45309", "#1E3A8A", "#6B5BD2", "#0F766E"], rootBg: "#0B0B45", rootFg: "#ffffff", rootBorder: "#0B0B45", fg: "#0B0B45" },
  { id: "coral", name: "Coral", bg: "#D9534F", accent: "#ffffff", palette: ["#ffffff", "#F5B82E", "#0B0B45", "#8EF7E3", "#FFE3A0", "#1E3A8A"], rootBg: "#ffffff", rootFg: "#7a1d1a", rootBorder: "#ffffff", fg: "#ffffff" },
  { id: "royal", name: "Azul real", bg: "#1E3A8A", accent: "#F5B82E", palette: ["#F5B82E", "#8EF7E3", "#F4786F", "#ffffff", "#C084FC", "#FB923C"], rootBg: "#ffffff", rootFg: "#1E3A8A", rootBorder: "#ffffff", fg: "#ffffff" },
  { id: "noir", name: "Noite", bg: "#0A0A3C", accent: "#F5B82E", palette: ["#F5B82E", "#7FF0DD", "#F4786F", "#7C9BFF", "#C084FC", "#16A34A"], rootBg: "#0A0A3C", rootFg: "#ffffff", rootBorder: "#F5B82E", fg: "#ffffff" },
];
const MM_FONTS = [["", "Padrão do sistema"], ["Arial, Helvetica, sans-serif", "Arial"], ["Georgia, serif", "Georgia"], ["'Trebuchet MS', sans-serif", "Trebuchet"], ["Verdana, sans-serif", "Verdana"], ["'Courier New', monospace", "Courier"], ["'Comic Sans MS', 'Comic Neue', cursive", "Comic Sans"], ["Nunito, Arial, sans-serif", "Nunito"]];
const MM_DEFAULT_CFG = { layout: "right", theme: "variety", bg: null, font: "", lineW: "default", colored: true, palette: "theme", compact: false, balance: false, uniform: false, notes: false, lineFollow: false, floatAuto: false };
const MM_LINE_W = { thin: 0.55, default: 1, thick: 1.7, xthick: 2.6 };
const MM_MARKERS = ["⭐", "❗", "✅", "❓", "💡", "🔥", "⚠️", "🚩", "1️⃣", "2️⃣", "3️⃣", "❤️"];
const MM_STICKERS = ["😀", "😍", "🤩", "😎", "🤔", "😅", "👍", "👏", "🙌", "💪", "🎉", "🎯", "🚀", "✈️", "🌍", "🏫", "🎓", "📚", "💶", "💳", "🏠", "🛂", "📅", "⏰", "📞", "✉️", "💬", "🔑", "🏆", "⭐", "🌟", "❤️", "💡", "🔥", "⚡", "✅", "❌", "⚠️", "❗", "❓", "🚩", "📌", "📎", "🔒", "🌈", "☀️", "🌙", "🍀"];
const MM_ILLUS = {
  aviao: '<path d="M8 36l48-18-12 30-14-6-8 10-2-12z" fill="#3B82F6"/><path d="M8 36l36-12-22 16z" fill="#93C5FD"/>',
  globo: '<circle cx="32" cy="32" r="22" fill="#2B8FC4"/><path d="M12 28c8-2 10-10 18-8s6 10 2 14-12 2-14 10c-6-4-8-10-6-16zM38 44c4-4 10-2 12-8 0 8-6 14-12 16z" fill="#16A34A"/>',
  escola: '<path d="M6 26L32 12l26 14-26 14z" fill="#6B5BD2"/><path d="M16 34v12c0 4 8 8 16 8s16-4 16-8V34l-16 8z" fill="#8B5CF6"/><rect x="54" y="26" width="3" height="18" fill="#F5B82E"/>',
  euro: '<circle cx="32" cy="32" r="22" fill="#F5B82E"/><text x="32" y="43" font-size="32" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">€</text>',
  passaporte: '<rect x="14" y="8" width="36" height="48" rx="4" fill="#1E3A8A"/><circle cx="32" cy="28" r="9" fill="none" stroke="#F5B82E" stroke-width="2"/><path d="M23 28h18M32 19v18" stroke="#F5B82E" stroke-width="2"/><rect x="22" y="44" width="20" height="3" rx="1.5" fill="#F5B82E"/>',
  casa: '<path d="M8 30L32 10l24 20z" fill="#D9534F"/><rect x="14" y="30" width="36" height="24" fill="#F5B82E"/><rect x="27" y="38" width="10" height="16" fill="#1E3A8A"/>',
  livro: '<path d="M8 14c8-3 17-3 24 2v36c-7-5-16-5-24-2z" fill="#2E9C8A"/><path d="M56 14c-8-3-17-3-24 2v36c7-5 16-5 24-2z" fill="#6EE7B7"/>',
  coracao: '<path d="M32 54C10 38 6 22 16 14c7-5 14-1 16 6 2-7 9-11 16-6 10 8 6 24-16 40z" fill="#DB2777"/>',
  estrela: '<path d="M32 6l7 17 18 2-14 12 5 18-16-10-16 10 5-18L7 25l18-2z" fill="#F5B82E"/>',
  check: '<circle cx="32" cy="32" r="24" fill="#16A34A"/><path d="M19 33l9 9 17-19" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  telefone: '<rect x="18" y="6" width="28" height="52" rx="6" fill="#1a2233"/><rect x="22" y="12" width="20" height="34" fill="#7FF0DD"/><circle cx="32" cy="52" r="2.5" fill="#fff"/>',
  lampada: '<path d="M32 6c-10 0-18 8-18 18 0 7 4 11 8 15v7h20v-7c4-4 8-8 8-15 0-10-8-18-18-18z" fill="#F5B82E"/><rect x="24" y="48" width="16" height="4" rx="2" fill="#6B7280"/><rect x="26" y="54" width="12" height="4" rx="2" fill="#6B7280"/>',
};
const mmIllusUri = k => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${MM_ILLUS[k]}</svg>`);
const MM_MAX_UNDO = 60;

const mm = {
  maps: [], loaded: false, cur: null,
  sel: null, selSet: new Set(), editing: null, editSnap: null, editNew: false,
  undo: [], redo: [], zoom: 1, panX: 40, panY: 40,
  saveTimer: null, status: "", els: new Map(), pos: new Map(), drag: null, pan: null,
  tab: "map", panelOpen: true, relFrom: null, pitch: null, geo: null,
};
const mmNewId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const mmNode = (t = "", c = []) => ({ id: mmNewId(), t, c });
const mmRoot = () => (mm.cur ? mm.cur.data : null);
const mmStrip = (k, v) => (k.startsWith("_") ? undefined : v);
const mmClone = o => JSON.parse(JSON.stringify(o, mmStrip));
const mmSnap = () => JSON.stringify(mmRoot(), mmStrip);
const mmCanUse = () => !!session && ["ADM", "Gerente", "MKT"].includes(session.role);
const mmEsc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s));
const mmToast = m => (typeof agendaToast === "function" ? agendaToast(m) : alert(m));

function mmLuma(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/* ---------------- configuração e tema ---------------- */
function mmCfg() { return { ...MM_DEFAULT_CFG, ...((mm.cur && mm.cur.data && mm.cur.data.cfg) || {}) }; }
const mmTheme = () => MM_THEMES.find(t => t.id === mmCfg().theme) || MM_THEMES[0];
function mmPalette() {
  const c = mmCfg(), th = mmTheme();
  return c.palette === "theme" ? th.palette : (MM_PALETTES[c.palette] || th.palette);
}
const mmBg = () => mmCfg().bg || mmTheme().bg;

/* ---------------- árvore ---------------- */
const mmRoots = () => (mm.cur ? [mmRoot(), ...(mmRoot().fl || [])] : []);
function mmKids(n) {
  /* filhos visíveis (recolhido esconde; na apresentação só aparecem os já revelados) */
  const ks = (n.x && !mm.pitch) ? [] : (n.c || []);
  return mm.pitch ? ks.filter(k => mm.pitch.shown.has(k.id)) : ks;
}
function mmFind(id) {
  if (!id || !mm.cur) return null;
  const walk = (node, parent, depth, rootNode) => {
    if (node.id === id) return { node, parent, depth, rootNode, index: parent ? parent.c.indexOf(node) : 0, floating: rootNode !== mmRoot() };
    for (const ch of node.c || []) { const r = walk(ch, node, depth + 1, rootNode); if (r) return r; }
    return null;
  };
  for (const r of mmRoots()) { const f = walk(r, null, 0, r); if (f) return f; }
  return null;
}
const mmIsNodeId = id => !!id && !/^(sm|rl|rel|bd|zn):/.test(id);
function mmDescendants(node) { return (node.c || []).reduce((a, ch) => a + 1 + mmDescendants(ch), 0); }
function mmSubtreeIds(node, out = []) { out.push(node.id); (node.c || []).forEach(c => mmSubtreeIds(c, out)); return out; }
/* objetos editáveis por texto: tópico, resumo (sm:) e rótulo de relação (rl:) */
function mmObj(id) {
  if (id.startsWith("sm:")) { for (const r of mmRoots()) { const hit = mmAllNodes(r).map(n => (n.sm || []).find(s => s.id === id.slice(3))).find(Boolean); if (hit) return hit; } return null; }
  if (id.startsWith("rl:")) return (mmRoot().rel || []).find(r => r.id === id.slice(3)) || null;
  if (id.startsWith("zn:")) return (mmRoot().zn || []).find(z => z.id === id.slice(3)) || null;
  const f = mmFind(id); return f ? f.node : null;
}
function mmAllNodes(node, out = []) { out.push(node); (node.c || []).forEach(c => mmAllNodes(c, out)); return out; }
/* limpa referências a tópicos que não existem mais */
function mmGC() {
  const root = mmRoot(); if (!root) return;
  const ok = new Set(); mmRoots().forEach(r => mmAllNodes(r).forEach(n => ok.add(n.id)));
  if (root.rel) root.rel = root.rel.filter(r => ok.has(r.a) && ok.has(r.b));
  if (root.bd) root.bd = root.bd.filter(b => { b.ids = b.ids.filter(i => ok.has(i)); return b.ids.length; });
  mmRoots().forEach(r => mmAllNodes(r).forEach(n => { if (n.sm) n.sm = n.sm.filter(s => ok.has(s.from) && ok.has(s.to) && n.c.some(c => c.id === s.from) && n.c.some(c => c.id === s.to)); }));
}

/* ---------------- cores ---------------- */
function mmColors() {
  const cfg = mmCfg(), th = mmTheme(), pal = mmPalette(), res = new Map(), root = mmRoot();
  res.set(root.id, { c: th.rootBorder, edge: th.accent });
  const walk = (n, inherited, branch) => {
    const c = n.k || inherited;
    res.set(n.id, { c, edge: cfg.lineFollow ? c : branch });
    (n.c || []).forEach(ch => walk(ch, c, branch));
  };
  (root.c || []).forEach((n, i) => { const base = n.k || (cfg.colored ? pal[i % pal.length] : th.accent); walk(n, base, base); });
  (root.fl || []).forEach((r, i) => {
    const base = r.k || (cfg.floatAuto ? pal[(i + (root.c || []).length) % pal.length] : th.accent);
    res.set(r.id, { c: base, edge: base });
    (r.c || []).forEach(ch => walk(ch, base, base));
  });
  return res;
}

/* ---------------- histórico ---------------- */
function mmMutate(fn) {
  mm.undo.push(mmSnap());
  if (mm.undo.length > MM_MAX_UNDO) mm.undo.shift();
  mm.redo = [];
  fn();
  mmGC();
  mmRender();
  mmScheduleSave();
  mmRenderPanel();
}
function mmRestore(json) {
  mm.cur.data = JSON.parse(json);
  mm.selSet = new Set([...mm.selSet].filter(i => mmFind(i) || !mmIsNodeId(i)));
  if (!mmFind(mm.sel) && mmIsNodeId(mm.sel)) { mm.sel = mmRoot().id; mm.selSet = new Set([mm.sel]); }
  mmRender(); mmScheduleSave(); mmRenderPanel();
}
function mmUndo() { if (!mm.undo.length || !mm.cur) return; mm.redo.push(mmSnap()); mmRestore(mm.undo.pop()); }
function mmRedo() { if (!mm.redo.length || !mm.cur) return; mm.undo.push(mmSnap()); mmRestore(mm.redo.pop()); }

/* ---------------- operações ---------------- */
function mmAddChild(id) {
  const f = mmFind(id); if (!f) return;
  let created;
  mmMutate(() => { created = mmNode(); created._new = true; f.node.c.push(created); f.node.x = false; });
  mmSelect(created.id); mmRender(); mmStartEdit(created.id, null, true);
}
function mmAddSibling(id, before) {
  const f = mmFind(id); if (!f) return;
  if (!f.parent) { mmAddChild(id); return; }
  let created;
  mmMutate(() => { created = mmNode(); created._new = true; f.parent.c.splice(f.index + (before ? 0 : 1), 0, created); });
  mmSelect(created.id); mmRender(); mmStartEdit(created.id, null, true);
}
function mmAddParent(id) {
  const f = mmFind(id); if (!f || !f.parent) { mmToast("Escolha um tópico que não seja o central para inserir um tópico pai."); return; }
  let created;
  mmMutate(() => { created = mmNode(); created._new = true; created.c = [f.node]; f.parent.c.splice(f.index, 1, created); });
  mmSelect(created.id); mmRender(); mmStartEdit(created.id, null, true);
}
function mmAddFloating(x, y) {
  let created;
  mmMutate(() => {
    const root = mmRoot(); root.fl = root.fl || [];
    created = mmNode(); created._new = true; created.fx = x; created.fy = y;
    root.fl.push(created);
  });
  mmSelect(created.id); mmRender(); mmStartEdit(created.id, null, true);
}
function mmDelete(id) {
  if (id.startsWith("rl:") || id.startsWith("rel:")) { const rid = id.split(":")[1]; mmMutate(() => { mmRoot().rel = (mmRoot().rel || []).filter(r => r.id !== rid); }); mmSelect(mmRoot().id); return; }
  if (id.startsWith("zn:")) { const zid = id.slice(3); mmMutate(() => { mmRoot().zn = (mmRoot().zn || []).filter(z => z.id !== zid); }); mmSelect(mmRoot().id); return; }
  if (id.startsWith("bd:")) { const bid = id.slice(3); mmMutate(() => { mmRoot().bd = (mmRoot().bd || []).filter(b => b.id !== bid); }); mmSelect(mmRoot().id); return; }
  if (id.startsWith("sm:")) {
    const sid = id.slice(3);
    mmMutate(() => { mmRoots().forEach(r => mmAllNodes(r).forEach(n => { if (n.sm) n.sm = n.sm.filter(s => s.id !== sid); })); });
    mmSelect(mmRoot().id); return;
  }
  const f = mmFind(id); if (!f) return;
  if (!f.parent && !f.floating) { mmToast("O tópico central não pode ser excluído. Edite o texto ou exclua o mapa."); return; }
  const n = mmDescendants(f.node);
  if (n >= 6 && !confirm(`Excluir este tópico e os ${n} tópicos dentro dele? (Dá para desfazer com Cmd/Ctrl+Z.)`)) return;
  const next = f.parent ? (f.parent.c[f.index + 1] || f.parent.c[f.index - 1] || f.parent) : mmRoot();
  mmMutate(() => { if (f.parent) f.parent.c.splice(f.index, 1); else mmRoot().fl = mmRoot().fl.filter(x => x.id !== id); });
  mmSelect(next.id);
}
function mmDeleteSelection() {
  const ids = [...mm.selSet]; if (!ids.length) return;
  if (ids.length === 1) { mmDelete(ids[0]); return; }
  const nodes = ids.filter(mmIsNodeId).map(i => mmFind(i)).filter(f => f && (f.parent || f.floating));
  if (!nodes.length) return;
  if (!confirm(`Excluir os ${nodes.length} tópicos selecionados (e o que há dentro deles)?`)) return;
  mmMutate(() => nodes.forEach(f => { const ff = mmFind(f.node.id); if (!ff) return; if (ff.parent) ff.parent.c.splice(ff.parent.c.indexOf(ff.node), 1); else mmRoot().fl = (mmRoot().fl || []).filter(x => x.id !== ff.node.id); }));
  mmSelect(mmRoot().id);
}
function mmToggle(id) { const f = mmFind(id); if (!f || !(f.node.c || []).length) return; mmMutate(() => { f.node.x = !f.node.x; }); }
function mmDuplicateNode(id) {
  const f = mmFind(id); if (!f || !f.parent) return;
  const copy = JSON.parse(JSON.stringify(f.node, mmStrip));
  const fresh = n => { n.id = mmNewId(); delete n.sm; (n.c || []).forEach(fresh); };
  fresh(copy);
  mmMutate(() => { f.parent.c.splice(f.index + 1, 0, copy); });
  mmSelect(copy.id); mmRender();
}
function mmMoveInto(id, targetId) {
  const f = mmFind(id), t = mmFind(targetId);
  if (!f || !t || id === targetId || mmFind(targetId) && mmSubtreeIds(f.node).includes(targetId)) return;
  if (!f.parent && !f.floating) return;
  mmMutate(() => {
    if (f.parent) f.parent.c.splice(f.index, 1); else mmRoot().fl = mmRoot().fl.filter(x => x.id !== id);
    delete f.node.fx; delete f.node.fy;
    t.node.c.push(f.node); t.node.x = false;
  });
  mmSelect(id); mmRender();
}
/* aplica uma propriedade a todos os tópicos selecionados */
function mmSetProp(patch) {
  const ids = [...mm.selSet].filter(mmIsNodeId);
  if (!ids.length) return;
  mmMutate(() => ids.forEach(i => { const n = mmObj(i); if (!n) return; Object.entries(patch).forEach(([k, v]) => { if (v === null || v === "" || v === false) delete n[k]; else n[k] = v; }); }));
}
function mmSetColor(color) {
  const f = mm.sel ? mmFind(mm.sel) : null; if (!f) { mmToast("Selecione um tópico primeiro."); return; }
  const root = mmRoot();
  const top = f.floating ? f.rootNode : (root.c || []).find(ch => mmSubtreeIds(ch).includes(f.node.id));
  if (!top) { mmToast("Escolha um tópico de uma ramificação para mudar a cor."); return; }
  mmMutate(() => { top.k = color; });
}
function mmSetCfg(patch) { mmMutate(() => { mm.cur.data.cfg = { ...(mm.cur.data.cfg || {}), ...patch }; }); }

/* limite, resumo, relação */
function mmSelectedNodes() { return [...mm.selSet].filter(mmIsNodeId).map(mmFind).filter(Boolean); }
function mmAddBoundary() {
  const fs = mmSelectedNodes(); if (!fs.length) { mmToast("Selecione um tópico para colocar o limite."); return; }
  const bid = mmNewId();
  mmMutate(() => { const r = mmRoot(); r.bd = r.bd || []; r.bd.push({ id: bid, ids: fs.map(f => f.node.id) }); });
  mmSelect("bd:" + bid);
}
function mmAddSummary() {
  const fs = mmSelectedNodes();
  if (!fs.length || fs.some(f => !f.parent)) { mmToast("Selecione um ou mais tópicos (do mesmo nível, com o mesmo pai) para resumir."); return; }
  const par = fs[0].parent;
  if (fs.some(f => f.parent !== par)) { mmToast("Para resumir, os tópicos selecionados precisam ter o mesmo pai."); return; }
  const idx = fs.map(f => par.c.indexOf(f.node)).sort((a, b) => a - b);
  const sid = mmNewId();
  mmMutate(() => { par.sm = par.sm || []; par.sm.push({ id: sid, from: par.c[idx[0]].id, to: par.c[idx[idx.length - 1]].id, t: "" }); });
  mmRender(); mmSelect("sm:" + sid); mmStartEdit("sm:" + sid, null, true);
}
function mmStartRelation() {
  const f = mm.sel && mmIsNodeId(mm.sel) ? mmFind(mm.sel) : null;
  if (!f) { mmToast("Selecione o tópico de origem e clique em Relação."); return; }
  mm.relFrom = f.node.id;
  document.getElementById("mm-canvas").classList.add("mm-linking");
  mmToast("Agora clique no tópico de destino. Esc cancela.");
}
function mmFinishRelation(targetId) {
  const a = mm.relFrom; mm.relFrom = null;
  document.getElementById("mm-canvas").classList.remove("mm-linking");
  if (!a || a === targetId) return;
  const rid = mmNewId();
  mmMutate(() => { const r = mmRoot(); r.rel = r.rel || []; r.rel.push({ id: rid, a, b: targetId, t: "" }); });
  mmSelect("rel:" + rid);
}

/* ---------------- seleção ---------------- */
function mmSelect(id, reveal, add) {
  if (add && id && mm.sel && mmIsNodeId(id) && mmIsNodeId(mm.sel)) {
    if (mm.selSet.has(id) && mm.selSet.size > 1) mm.selSet.delete(id); else mm.selSet.add(id);
    mm.sel = id;
  } else { mm.sel = id; mm.selSet = new Set(id ? [id] : []); }
  mmUpdateSelection();
  mmRenderPanel();
  if (reveal) mmReveal(id);
}
function mmUpdateSelection() {
  mm.els.forEach((el, id) => el.classList.toggle("mm-sel", mm.selSet.has(id)));
  document.querySelectorAll("#mm-edges [data-obj]").forEach(p => p.classList.toggle("mm-sel-obj", mm.selSet.has(p.dataset.obj)));
}

/* ---------------- edição de texto ---------------- */
const mmTextEl = el => el.querySelector(".mm-text") || el;
function mmStartEdit(id, initialChar, isNew) {
  if (mm.editing && mm.editing !== id) mmCommitEdit();
  const el = mm.els.get(id), obj = mmObj(id);
  if (!el || !obj) return;
  const tx = mmTextEl(el);
  mm.editing = id; mm.editNew = !!isNew; mm.editSnap = mmSnap();
  el.classList.add("mm-editing");
  tx.contentEditable = "true"; tx.spellcheck = false;
  if (initialChar != null) tx.textContent = initialChar;
  tx.focus();
  const range = document.createRange(); range.selectNodeContents(tx);
  if (initialChar != null || isNew) range.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
  mmRelayout();
}
function mmCommitEdit(cancel) {
  const id = mm.editing; if (!id) return;
  const el = mm.els.get(id), obj = mmObj(id);
  mm.editing = null;
  if (!el || !obj) return;
  const tx = mmTextEl(el);
  tx.contentEditable = "false"; el.classList.remove("mm-editing");
  const txt = tx.innerText.replace(/\n+$/, "");
  const wasNew = mm.editNew; mm.editNew = false;
  if (cancel) tx.textContent = obj.t || ""; else obj.t = txt;
  delete obj._new;
  const empty = !(cancel ? obj.t || "" : txt).trim();
  if (wasNew && empty) {
    /* tópico/resumo novo deixado em branco: some, sem entrar no histórico */
    mm.undo.pop();
    if (id.startsWith("sm:")) { const sid = id.slice(3); mmRoots().forEach(r => mmAllNodes(r).forEach(n => { if (n.sm) n.sm = n.sm.filter(s => s.id !== sid); })); mm.sel = null; mm.selSet.clear(); }
    else if (id.startsWith("rl:")) { /* rótulo de relação pode ficar vazio */ mm.undo.push(mm.editSnap); }
    else { const f = mmFind(id); if (f) { if (f.parent) f.parent.c.splice(f.index, 1); else mmRoot().fl = mmRoot().fl.filter(x => x.id !== id); mmSelect(f.parent ? f.parent.id : mmRoot().id); } }
    mmRender(); mmScheduleSave(); return;
  }
  if (!cancel && !wasNew && mm.editSnap && mm.editSnap !== mmSnap()) { mm.undo.push(mm.editSnap); if (mm.undo.length > MM_MAX_UNDO) mm.undo.shift(); mm.redo = []; mmScheduleSave(); }
  mm.editSnap = null;
  mmRender(); mmFocusCanvas();
}
const mmFocusCanvas = () => { const c = document.getElementById("mm-canvas"); if (c) c.focus({ preventScroll: true }); };

/* ---------------- desenho ---------------- */
function mmRender() {
  const stage = document.getElementById("mm-stage");
  if (!stage || !mm.cur) return;
  mm.els.clear();
  const cfg = mmCfg(), th = mmTheme();
  const canvas = document.getElementById("mm-canvas");
  canvas.style.backgroundColor = mmBg();
  canvas.classList.toggle("mm-dots", !!th.dots && !cfg.bg);
  canvas.classList.toggle("mm-dark", mmLuma(mmBg()) < 0.5);
  stage.className = "mm-stage" + (cfg.compact ? " mm-compact" : "") + (mm.pitch ? " mm-animate" : "");
  stage.style.fontFamily = cfg.font || "";
  stage.style.setProperty("--mm-text", th.fg);
  stage.style.setProperty("--mm-rootbg", th.rootBg);
  stage.style.setProperty("--mm-rootfg", th.rootFg);
  stage.style.setProperty("--mm-rootborder", th.rootBorder);
  stage.innerHTML = `<svg id="mm-edges" class="mm-edges"></svg>`;
  const colors = mmColors(), root = mmRoot();
  const mkEl = (id, depth, n, cls) => {
    const el = document.createElement("div");
    el.className = `mm-node ${cls || `mm-d${Math.min(depth, 2)}`}${n.shape ? " mm-s-" + n.shape : ""}`;
    el.dataset.id = id;
    if (n.im) { const im = document.createElement("img"); im.className = "mm-img"; im.src = n.im; im.draggable = false; im.addEventListener("load", () => mmRelayoutSoon()); el.appendChild(im); }
    const row = document.createElement("div"); row.className = "mm-row-main";
    if (n.td !== undefined) { const c = document.createElement("span"); c.className = "mm-todo" + (n.td ? " done" : ""); c.textContent = n.td ? "☑" : "☐"; c.dataset.todo = "1"; row.appendChild(c); }
    if (n.mk) { const m = document.createElement("span"); m.className = "mm-marker"; m.textContent = n.mk; row.appendChild(m); }
    const tx = document.createElement("span"); tx.className = "mm-text"; tx.textContent = n.t || ""; el.dataset.empty = n.t ? "0" : "1";
    row.appendChild(tx);
    if (n.lk) { const a = document.createElement("span"); a.className = "mm-link"; a.textContent = "🔗"; a.title = n.lk; a.dataset.lk = n.lk; row.appendChild(a); }
    if (n.lt && mmFind(n.lt)) { const a = document.createElement("span"); a.className = "mm-link mm-lt"; a.textContent = "↪"; a.title = "Ir para o tópico: " + ((mmFind(n.lt).node.t) || ""); a.dataset.lt = n.lt; row.appendChild(a); }
    if (n.lm) { const mp = mm.maps.find(m => m.id === n.lm); const a = document.createElement("span"); a.className = "mm-link mm-lm"; a.textContent = "🗺"; a.title = "Abrir o mapa: " + (mp ? mp.titulo : ""); a.dataset.lm = n.lm; row.appendChild(a); }
    if (n.at) { const a = document.createElement("span"); a.className = "mm-link mm-at"; a.textContent = "📎"; a.title = "Baixar anexo: " + n.at.name; a.dataset.at = "1"; row.appendChild(a); }
    if (n.cm && n.cm.length) { const a = document.createElement("span"); a.className = "mm-cm"; a.textContent = `💬${n.cm.length}`; a.title = n.cm.map(c => `${c.u}: ${c.t}`).join("\n"); row.appendChild(a); }
    el.appendChild(row);
    if (n.eq) { const q = document.createElement("div"); q.className = "mm-eq"; q.dataset.eq = n.eq; if (window.katex) { try { window.katex.render(n.eq, q, { throwOnError: false }); } catch (e) { q.textContent = n.eq; } } else q.textContent = n.eq; el.appendChild(q); }
    if (n.tk) { const t = document.createElement("div"); t.className = "mm-task"; t.textContent = [n.tk.pr ? "P" + n.tk.pr : "", n.tk.d ? "📅 " + n.tk.d.split("-").reverse().slice(0, 2).join("/") : "", n.tk.p ? n.tk.p + "%" : ""].filter(Boolean).join(" · ") || "Tarefa"; if (n.tk.p) t.style.setProperty("--p", n.tk.p + "%"); el.appendChild(t); }
    if (n.lb) { const l = document.createElement("div"); l.className = "mm-label"; l.textContent = n.lb; el.appendChild(l); }
    if (n.co) { const d = document.createElement("div"); d.className = "mm-callout"; d.textContent = n.co; el.appendChild(d); }
    if (n.n) {
      if (cfg.notes) { const d = document.createElement("div"); d.className = "mm-note"; d.textContent = n.n; el.appendChild(d); }
      else { const b = document.createElement("span"); b.className = "mm-note-badge"; b.textContent = "📝"; b.title = n.n; row.appendChild(b); }
    }
    if (n.fill) el.style.background = n.fill;
    if (n.fg) el.style.color = n.fg;
    if (n.fs) el.style.fontSize = n.fs + "px";
    if (n.b) el.style.fontWeight = "800";
    if (n.i) el.style.fontStyle = "italic";
    const col = colors.get(id);
    if (col) { el.style.setProperty("--mm-c", col.c); el.style.setProperty("--mm-fg1", mmLuma(col.c) > 0.62 ? "#1a2233" : "#ffffff"); }
    stage.appendChild(el); mm.els.set(id, el);
    return el;
  };
  const build = (n, depth, cls) => {
    const el = mkEl(n.id, depth, n, cls);
    const ks = mmKids(n);
    ks.forEach(ch => build(ch, depth + 1));
    if (n.x && !mm.pitch && (n.c || []).length) { const b = document.createElement("span"); b.className = "mm-coll"; b.textContent = `+${mmDescendants(n)}`; el.appendChild(b); }
    (n.sm || []).forEach(s => { if (!mm.pitch || (mm.pitch.shown.has(s.from) && mm.pitch.shown.has(s.to))) mkEl("sm:" + s.id, depth + 1, s, "mm-sum"); });
  };
  (root.zn || []).forEach(z => {
    const el = document.createElement("div"); el.className = "mm-node mm-zone"; el.dataset.id = "zn:" + z.id;
    el.style.setProperty("--mm-c", z.k || mmTheme().accent);
    const h = document.createElement("div"); h.className = "mm-zone-h"; const tx = document.createElement("span"); tx.className = "mm-text"; tx.textContent = z.t || ""; el.dataset.empty = z.t ? "0" : "1"; h.appendChild(tx); el.appendChild(h);
    const rz = document.createElement("div"); rz.className = "mm-zone-r"; el.appendChild(rz);
    stage.appendChild(el); mm.els.set("zn:" + z.id, el);
  });
  build(root, 0);
  (root.fl || []).forEach(r => { if (!mm.pitch || mm.pitch.shown.has(r.id)) build(r, 1, "mm-d1 mm-float"); });
  (root.rel || []).forEach(r => { if (mm.els.has(r.a) && mm.els.has(r.b) && (r.t || mm.sel === "rel:" + r.id || mm.sel === "rl:" + r.id)) mkEl("rl:" + r.id, 2, r, "mm-rellabel"); });
  mmRelayout();
  mmUpdateSelection();
}

let mmRelayoutTimer = null;
function mmRelayoutSoon() { if (mmRelayoutTimer) return; mmRelayoutTimer = requestAnimationFrame(() => { mmRelayoutTimer = null; if (mm.cur && !mm.editing) mmRelayout(); }); }
window.addEventListener("load", () => { const k = document.getElementById("katex-js"); if (k) k.addEventListener("load", () => { if (mm.cur) mmRender(); }); });

function mmRelayout() {
  const root = mmRoot(); if (!root) return;
  const svg = document.getElementById("mm-edges"); if (!svg) return;
  const cfg = mmCfg(), compact = cfg.compact;
  const HG = compact ? 34 : 56, VG = compact ? 3 : 10;
  mm.pos.clear();
  /* medidas (largura uniforme por nível, se pedido) */
  mm.els.forEach((el, id) => { if (!id.startsWith("zn:")) el.style.width = ""; });
  const size = new Map();
  mm.els.forEach((el, id) => { if (!id.startsWith("zn:")) size.set(id, { w: el.offsetWidth, h: el.offsetHeight }); });
  if (cfg.uniform) {
    const maxW = new Map();
    const walk = (n, d) => { maxW.set(d, Math.max(maxW.get(d) || 0, size.get(n.id) ? size.get(n.id).w : 0)); mmKids(n).forEach(c => walk(c, d + 1)); };
    walk(root, 0); (root.fl || []).forEach(r => { if (size.has(r.id)) walk(r, 1); });
    const depthOf = new Map();
    const mark = (n, d) => { depthOf.set(n.id, d); mmKids(n).forEach(c => mark(c, d + 1)); };
    mark(root, 0); (root.fl || []).forEach(r => mark(r, 1));
    mm.els.forEach((el, id) => { if (depthOf.has(id) && size.has(id)) { const w = maxW.get(depthOf.get(id)); el.style.width = `${w}px`; size.get(id).w = w; size.get(id).h = el.offsetHeight; } });
  }
  /* alturas das subárvores */
  const heights = new Map();
  const subH = n => {
    const own = size.get(n.id).h, ks = mmKids(n);
    if (!ks.length) { heights.set(n.id, own); return own; }
    const total = ks.reduce((a, c) => a + subH(c), 0) + VG * (ks.length - 1);
    const h = Math.max(own, total); heights.set(n.id, h); return h;
  };
  const place = (n, x, top, depth, side) => {
    const sz = size.get(n.id), H = heights.get(n.id), ks = mmKids(n);
    let y;
    if (ks.length) {
      const span = ks.reduce((a, c) => a + heights.get(c.id), 0) + VG * (ks.length - 1);
      let cy = top + (H - span) / 2; const ys = [];
      ks.forEach(c => { place(c, x + sz.w + HG, cy, depth + 1, side); ys.push(mm.pos.get(c.id)); cy += heights.get(c.id) + VG; });
      y = (ys[0].y + ys[ys.length - 1].y + ys[ys.length - 1].h) / 2 - sz.h / 2;
    } else y = top + (H - sz.h) / 2;
    mm.pos.set(n.id, { x, y, w: sz.w, h: sz.h, depth, side });
  };
  subH(root);
  const rs = size.get(root.id), ks = mmKids(root);
  const mirror = ids => { ids.forEach(i => { const p = mm.pos.get(i); p.x = rs.w - p.x - p.w; p.side = "l"; }); };
  const groupH = list => list.reduce((a, c) => a + heights.get(c.id), 0) + VG * Math.max(0, list.length - 1);
  let right = ks, left = [];
  if (cfg.layout === "left") { right = []; left = ks; }
  else if (cfg.layout === "both" && ks.length > 1) {
    let split = Math.ceil(ks.length / 2);
    if (cfg.balance) {
      let best = Infinity;
      for (let i = 1; i < ks.length; i++) { const d = Math.abs(groupH(ks.slice(0, i)) - groupH(ks.slice(i))); if (d < best) { best = d; split = i; } }
    }
    right = ks.slice(0, split); left = ks.slice(split);
  }
  const Hr = right.length ? groupH(right) : 0, Hl = left.length ? groupH(left) : 0, Hm = Math.max(Hr, Hl, rs.h);
  mm.pos.set(root.id, { x: 0, y: (Hm - rs.h) / 2, w: rs.w, h: rs.h, depth: 0, side: "r" });
  let cy = (Hm - Hr) / 2;
  right.forEach(c => { place(c, rs.w + HG, cy, 1, "r"); cy += heights.get(c.id) + VG; });
  cy = (Hm - Hl) / 2;
  left.forEach(c => { place(c, rs.w + HG, cy, 1, "l"); mirror(mmSubtreeVisible(c)); cy += heights.get(c.id) + VG; });
  /* tópicos flutuantes: cada um é uma pequena árvore para a direita, no ponto escolhido */
  (root.fl || []).forEach(r => {
    if (!size.has(r.id)) return;
    subH(r); place(r, 0, 0, 1, "r");
    const p = mm.pos.get(r.id), dx = (r.fx || 0) - p.x, dy = (r.fy || 0) - p.y;
    mmSubtreeVisible(r).forEach(i => { const q = mm.pos.get(i); q.x += dx; q.y += dy; });
  });
  /* resumos e rótulos de relação ganham posição própria; zonas usam a posição guardada */
  mmPlaceExtras(size, new Map(mm.pos));
  (root.zn || []).forEach(z => { mm.pos.set("zn:" + z.id, { x: z.x, y: z.y, w: z.w, h: z.h, depth: 0, side: "r", zone: true }); const el = mm.els.get("zn:" + z.id); if (el) { el.style.width = `${z.w}px`; el.style.height = `${z.h}px`; } });
  let minX = Infinity, minY = Infinity;
  /* aplica */
  let maxX = -Infinity, maxY = -Infinity;
  mm.pos.forEach((p, id) => { const el = mm.els.get(id); if (!el) return; el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); });
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  mm.geo = { minX, minY, maxX, maxY };
  svg.setAttribute("width", Math.max(1, maxX + 40)); svg.setAttribute("height", Math.max(1, maxY + 40));
  svg.innerHTML = mmDrawSvg(cfg);
  /* recolhido: dica */
  mm.els.forEach(el => { const c = el.querySelector(".mm-coll"); el.title = c ? "Recolhido — Espaço para abrir" : ""; });
  mmApplyTransform();
  mmUpdateSelection();
}
function mmSubtreeVisible(n, out = []) { out.push(n.id); mmKids(n).forEach(c => mmSubtreeVisible(c, out)); return out; }
const mmBBox = ids => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  ids.forEach(i => { const p = mm.pos.get(i); if (!p) return; x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x + p.w); y2 = Math.max(y2, p.y + p.h); });
  return x1 === Infinity ? null : { x1, y1, x2, y2 };
};
/* posição dos resumos (à direita/esquerda do colchete) e dos rótulos de relação (meio da curva) */
function mmPlaceExtras(size, nodePos) {
  const root = mmRoot();
  mm.sums = []; mm.rels = [];
  mmRoots().forEach(r => mmAllNodes(r).forEach(n => {
    if (!mm.pos.has(n.id)) return;
    (n.sm || []).forEach(s => {
      const el = mm.els.get("sm:" + s.id); if (!el) return;
      const ks = mmKids(n), a = ks.findIndex(c => c.id === s.from), b = ks.findIndex(c => c.id === s.to);
      if (a < 0 || b < 0) return;
      const ids = []; for (let i = Math.min(a, b); i <= Math.max(a, b); i++) mmSubtreeVisible(ks[i], ids);
      const bb = mmBBox(ids); if (!bb) return;
      const side = (mm.pos.get(ks[a].id) || {}).side || "r";
      const sw = el.offsetWidth, sh = el.offsetHeight, ym = (bb.y1 + bb.y2) / 2;
      const bx = side === "r" ? bb.x2 + 12 : bb.x1 - 12;
      mm.pos.set("sm:" + s.id, { x: side === "r" ? bx + 34 : bx - 34 - sw, y: ym - sh / 2, w: sw, h: sh, depth: 2, side });
      mm.sums.push({ id: s.id, bx, y1: bb.y1, y2: bb.y2, ym, side });
    });
  }));
  (root.rel || []).forEach(r => {
    const a = mm.pos.get(r.a), b = mm.pos.get(r.b); if (!a || !b) return;
    const g = mmRelGeom(a, b);
    mm.rels.push({ id: r.id, ...g });
    const el = mm.els.get("rl:" + r.id);
    if (el) { const w = el.offsetWidth, h = el.offsetHeight; mm.pos.set("rl:" + r.id, { x: g.mx - w / 2, y: g.my - h / 2, w, h, depth: 2, side: "r" }); }
  });
}
function mmRelGeom(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const edge = (p, toward) => {
    const dx = toward.x - (p.x + p.w / 2), dy = toward.y - (p.y + p.h / 2);
    const k = Math.min((p.w / 2) / (Math.abs(dx) || 1e-6), (p.h / 2) / (Math.abs(dy) || 1e-6));
    return { x: p.x + p.w / 2 + dx * k, y: p.y + p.h / 2 + dy * k };
  };
  const p0 = edge(a, bc), p1 = edge(b, ac);
  const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
  const off = Math.min(90, len * 0.28);
  const cx = (p0.x + p1.x) / 2 - (dy / len) * off, cy = (p0.y + p1.y) / 2 + (dx / len) * off;
  return { p0, p1, cx, cy, mx: 0.25 * p0.x + 0.5 * cx + 0.25 * p1.x, my: 0.25 * p0.y + 0.5 * cy + 0.25 * p1.y };
}

function mmDrawSvg(cfg) {
  const root = mmRoot(), th = mmTheme(), colors = mmColors(), lw = MM_LINE_W[cfg.lineW] || 1;
  let s = `<defs><marker id="mm-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0 0 L10 4 L0 8 Z" fill="${th.accent}"/></marker></defs>`;
  /* limites (atrás de tudo) */
  (root.bd || []).forEach(b => {
    const ids = []; b.ids.forEach(i => { const f = mmFind(i); if (f && mm.pos.has(i)) mmSubtreeVisible(f.node, ids); });
    const bb = mmBBox(ids); if (!bb) return;
    const pad = 12, c = b.k || th.accent;
    s += `<rect data-obj="bd:${b.id}" class="mm-bd" x="${bb.x1 - pad}" y="${bb.y1 - pad}" width="${bb.x2 - bb.x1 + pad * 2}" height="${bb.y2 - bb.y1 + pad * 2}" rx="14" fill="${c}" fill-opacity="0.07" stroke="${c}" stroke-width="2" stroke-dasharray="7 5"/>`;
  });
  /* ligações pai → filho */
  const edges = (n, depth) => {
    const a = mm.pos.get(n.id); if (!a) return;
    mmKids(n).forEach(ch => {
      const b = mm.pos.get(ch.id); if (!b) return;
      const col = (colors.get(ch.id) || {}).edge || th.accent;
      const left = b.side === "l";
      const ay = a.depth >= 2 ? a.y + a.h : a.y + a.h / 2, by = b.depth >= 2 ? b.y + b.h : b.y + b.h / 2;
      const x1 = left ? a.x : a.x + a.w, x2 = left ? b.x + b.w : b.x, dx = (x2 - x1) / 2;
      const w = (b.depth === 1 ? 4 : b.depth === 2 ? 3 : 2) * lw;
      s += `<path d="M${x1} ${ay} C${x1 + dx} ${ay}, ${x2 - dx} ${by}, ${x2} ${by}" stroke="${col}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
      edges(ch, depth + 1);
    });
  };
  mmRoots().forEach(r => edges(r, 0));
  /* resumos */
  (mm.sums || []).forEach(m => {
    const sg = m.side === "r" ? 1 : -1, x = m.bx, c = th.accent;
    const y1 = m.y1, y2 = m.y2, ym = m.ym;
    const d = `M${x} ${y1} Q${x + 12 * sg} ${y1} ${x + 12 * sg} ${y1 + 14} L${x + 12 * sg} ${ym - 8} Q${x + 12 * sg} ${ym} ${x + 24 * sg} ${ym} Q${x + 12 * sg} ${ym} ${x + 12 * sg} ${ym + 8} L${x + 12 * sg} ${y2 - 14} Q${x + 12 * sg} ${y2} ${x} ${y2}`;
    s += `<path data-obj="sm:${m.id}" class="mm-sm-path" d="${d}" stroke="${c}" stroke-width="${2.4 * lw}" fill="none" stroke-linecap="round"/>`;
  });
  /* relações */
  (mm.rels || []).forEach(g => {
    s += `<path data-obj="rel:${g.id}" class="mm-rel" d="M${g.p0.x} ${g.p0.y} Q${g.cx} ${g.cy} ${g.p1.x} ${g.p1.y}" stroke="${th.accent}" stroke-width="${2 * lw}" stroke-dasharray="6 5" fill="none" marker-end="url(#mm-arrow)"/>`;
  });
  return s;
}

function mmApplyTransform() {
  const stage = document.getElementById("mm-stage");
  if (stage) stage.style.transform = `translate(${mm.panX}px, ${mm.panY}px) scale(${mm.zoom})`;
  const z = document.getElementById("mm-zoom-label"); if (z) z.textContent = `${Math.round(mm.zoom * 100)}%`;
}
function mmReveal(id) {
  const p = mm.pos.get(id), c = document.getElementById("mm-canvas"); if (!p || !c) return;
  const x = p.x * mm.zoom + mm.panX, y = p.y * mm.zoom + mm.panY, w = p.w * mm.zoom, h = p.h * mm.zoom, pad = 40;
  if (x < pad) mm.panX += pad - x; else if (x + w > c.clientWidth - pad) mm.panX -= x + w - (c.clientWidth - pad);
  if (y < pad) mm.panY += pad - y; else if (y + h > c.clientHeight - pad) mm.panY -= y + h - (c.clientHeight - pad);
  mmApplyTransform();
}
function mmFit() {
  const c = document.getElementById("mm-canvas"); if (!c || !mm.geo) return;
  const { minX, minY, maxX, maxY } = mm.geo, w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const z = Math.min(1.2, (c.clientWidth - 80) / w, (c.clientHeight - 80) / h);
  mm.zoom = Math.max(0.2, z);
  mm.panX = (c.clientWidth - w * mm.zoom) / 2 - minX * mm.zoom;
  mm.panY = (c.clientHeight - h * mm.zoom) / 2 - minY * mm.zoom;
  mmApplyTransform();
}
function mmZoomAt(factor, cx, cy) {
  const c = document.getElementById("mm-canvas"); if (!c) return;
  const nz = Math.min(2.5, Math.max(0.2, mm.zoom * factor)), rect = c.getBoundingClientRect();
  const px = (cx ?? rect.left + c.clientWidth / 2) - rect.left, py = (cy ?? rect.top + c.clientHeight / 2) - rect.top;
  mm.panX = px - (px - mm.panX) * (nz / mm.zoom); mm.panY = py - (py - mm.panY) * (nz / mm.zoom); mm.zoom = nz;
  mmApplyTransform();
}

/* ---------------- apresentação (pitch) ---------------- */
function mmPitchOrder() {
  const out = [];
  const walk = n => { out.push(n.id); (n.c || []).forEach(walk); };
  mmRoots().forEach(walk);
  return out;
}
function mmPitchStart() {
  if (!mm.cur) return;
  if (mm.editing) mmCommitEdit();
  const order = mmPitchOrder();
  mm.pitch = { order, i: 0, shown: new Set([order[0]]) };
  const canvas = document.getElementById("mm-canvas");
  document.getElementById("mm-pitchbar").hidden = false;
  if (canvas.requestFullscreen) canvas.requestFullscreen().catch(() => {});
  setTimeout(() => { mmRender(); mmFit(); mmPitchLabel(); }, 120);
}
function mmPitchStep(d) {
  const p = mm.pitch; if (!p) return;
  const ni = Math.max(0, Math.min(p.order.length - 1, p.i + d));
  if (ni === p.i) return;
  p.i = ni; p.shown = new Set(p.order.slice(0, ni + 1));
  mmRender(); mmFit(); mmPitchLabel();
}
function mmPitchStop() {
  if (!mm.pitch) return;
  mm.pitch = null;
  document.getElementById("mm-pitchbar").hidden = true;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  mmRender(); mmFit(); mmRenderPanel();
}
function mmPitchLabel() {
  const el = document.getElementById("mm-pitch-count");
  if (el && mm.pitch) el.textContent = `${mm.pitch.i + 1} / ${mm.pitch.order.length}`;
  mmRenderPanel();
}

/* ---------------- painel da direita ---------------- */
function mmRenderPanel() {
  const box = document.getElementById("mm-panel-body"); if (!box || !mm.cur) return;
  document.querySelectorAll("#mm-panel .mm-tab").forEach(t => t.classList.toggle("on", t.dataset.tab === mm.tab));
  if (mm.editing && box.contains(document.activeElement)) return;
  const cfg = mmCfg();
  const sw = (key, label, disabled, hint) => `<label class="mm-switch${disabled ? " dis" : ""}"><span>${label}${hint ? ` <small>${hint}</small>` : ""}</span><input type="checkbox" data-cfg="${key}" ${cfg[key] ? "checked" : ""} ${disabled ? "disabled" : ""}><i></i></label>`;
  if (mm.tab === "map") {
    const themes = MM_THEMES.map(t => `<button type="button" class="mm-theme${cfg.theme === t.id ? " on" : ""}" data-theme="${t.id}" title="${t.name}" style="background:${t.bg}"><span class="mm-theme-root" style="background:${t.rootBg};border-color:${t.rootBorder}"></span>${t.palette.slice(0, 3).map(c => `<span class="mm-theme-bar" style="background:${c}"></span>`).join("")}</button>`).join("");
    const pals = [["theme", "Do tema"], ["vibrante", "Vibrante"], ["pastel", "Pastel"], ["quente", "Quentes"], ["frio", "Frios"]];
    box.innerHTML = `
      <div class="mm-sec"><label class="mm-lab">Estrutura</label>
        <select data-cfg="layout">
          <option value="right"${cfg.layout === "right" ? " selected" : ""}>Gráfico lógico (para a direita)</option>
          <option value="left"${cfg.layout === "left" ? " selected" : ""}>Gráfico lógico (para a esquerda)</option>
          <option value="both"${cfg.layout === "both" ? " selected" : ""}>Mapa (dos dois lados)</option>
        </select></div>
      <div class="mm-sec"><label class="mm-lab">Tema de cores</label><div class="mm-themes">${themes}</div></div>
      <div class="mm-sec mm-row"><label class="mm-lab">Cor de fundo</label><span><input type="color" id="mm-bgcolor" value="${mmBg()}"> <button type="button" class="btn btn-ghost btn-sm" data-act="bg-reset">Padrão</button></span></div>
      <div class="mm-sec"><label class="mm-lab">Fonte global</label>
        <select data-cfg="font">${MM_FONTS.map(([v, n]) => `<option value="${mmEsc(v)}"${cfg.font === v ? " selected" : ""}>${n}</option>`).join("")}</select>
        <label class="mm-lab" style="margin-top:10px">Largura da linha dos ramos</label>
        <select data-cfg="lineW">${[["thin", "Fina"], ["default", "Padrão"], ["thick", "Grossa"], ["xthick", "Extra grossa"]].map(([v, n]) => `<option value="${v}"${cfg.lineW === v ? " selected" : ""}>${n}</option>`).join("")}</select>
        <label class="mm-switch mm-cb" style="margin-top:10px"><span>Ramos coloridos</span><input type="checkbox" data-cfg="colored" ${cfg.colored ? "checked" : ""}><i></i></label>
        <select data-cfg="palette" ${cfg.colored ? "" : "disabled"}>${pals.map(([v, n]) => `<option value="${v}"${cfg.palette === v ? " selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="mm-sec"><div class="mm-h">Estilo do mapa</div>
        ${sw("balance", "Balancear o mapa", cfg.layout !== "both", cfg.layout !== "both" ? "(só na estrutura Mapa)" : "")}
        ${sw("compact", "Mapa compacto")}</div>
      <div class="mm-sec"><div class="mm-h">Exibição dos tópicos</div>
        ${sw("uniform", "Largura uniforme por nível")}
        ${sw("notes", "Mostrar todas as notas")}
        ${sw("floatAuto", "Cor automática nos tópicos flutuantes")}</div>
      <div class="mm-sec"><div class="mm-h">Relações</div>
        ${sw("lineFollow", "Cor da linha segue o tópico")}</div>`;
    return;
  }
  if (mm.tab === "pitch") {
    const p = mm.pitch;
    box.innerHTML = `
      <div class="mm-sec"><div class="mm-h">Apresentação</div>
        <p class="mm-help">Mostra o mapa em tela cheia, revelando um tópico por vez, na ordem em que foram criados (de cima para baixo). Use → ou Espaço para avançar, ← para voltar e Esc para sair.</p>
        ${p ? `<p class="mm-help"><b>Em andamento:</b> passo ${p.i + 1} de ${p.order.length}</p>
          <div class="mm-btnrow"><button type="button" class="btn btn-ghost btn-sm" data-act="pitch-prev">← Anterior</button><button type="button" class="btn btn-primary btn-sm" data-act="pitch-next">Próximo →</button><button type="button" class="btn btn-danger btn-sm" data-act="pitch-stop">Sair</button></div>`
        : `<button type="button" class="btn btn-primary" data-act="pitch-start">▶ Iniciar apresentação</button>`}</div>`;
    return;
  }
  /* estilo do(s) tópico(s) selecionado(s) */
  const ids = [...mm.selSet].filter(mmIsNodeId), n = ids.length ? mmObj(ids[0]) : null;
  if (!n) { box.innerHTML = `<p class="mm-help" style="padding:14px">Selecione um tópico para mudar o estilo dele.${mm.sel && !mmIsNodeId(mm.sel) ? " (Resumos, relações e limites têm o estilo definido pelo tema.)" : ""}</p>`; return; }
  const shapes = [["", "Padrão do nível"], ["filled", "Preenchido"], ["pill", "Pílula"], ["rect", "Retângulo"], ["outline", "Contorno"], ["underline", "Só linha embaixo"], ["plain", "Sem moldura"]];
  const sizes = [["", "Padrão"], ["11", "Pequena"], ["13", "Normal"], ["16", "Grande"], ["20", "Muito grande"], ["26", "Enorme"]];
  const tk = n.tk || {};
  const others = mmAllNodesFlat().filter(x => x.id !== n.id && (x.t || "").trim()).slice(0, 200);
  const otherMaps = mm.maps.filter(m => !mm.cur || m.id !== mm.cur.id);
  box.innerHTML = `
    <div class="mm-sec"><div class="mm-h">Aparência${ids.length > 1 ? ` (${ids.length} tópicos)` : ""}</div>
      <label class="mm-lab">Forma</label>
      <select data-node="shape">${shapes.map(([v, nm]) => `<option value="${v}"${(n.shape || "") === v ? " selected" : ""}>${nm}</option>`).join("")}</select>
      <div class="mm-row" style="margin-top:10px"><label class="mm-lab">Preenchimento</label><span><input type="color" data-nodecolor="fill" value="${n.fill || "#ffffff"}"> <button type="button" class="btn btn-ghost btn-sm" data-act="clear-fill">Limpar</button></span></div>
      <div class="mm-row"><label class="mm-lab">Cor do texto</label><span><input type="color" data-nodecolor="fg" value="${n.fg || "#1a2233"}"> <button type="button" class="btn btn-ghost btn-sm" data-act="clear-fg">Limpar</button></span></div>
      <label class="mm-lab" style="margin-top:8px">Tamanho da fonte</label>
      <select data-node="fs">${sizes.map(([v, nm]) => `<option value="${v}"${String(n.fs || "") === v ? " selected" : ""}>${nm}</option>`).join("")}</select>
      <div class="mm-btnrow" style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm${n.b ? " on" : ""}" data-act="bold"><b>N</b>egrito</button><button type="button" class="btn btn-ghost btn-sm${n.i ? " on" : ""}" data-act="italic"><i>Itálico</i></button></div>
      <div class="mm-colors-panel">${MM_PALETTES.vibrante.map(c => `<button type="button" class="mm-swatch" data-branchcolor="${c}" style="background:${c}" title="Cor da ramificação"></button>`).join("")}</div>
      <small class="mm-help">Cor da ramificação (linhas e tópicos do ramo)</small></div>
    <div class="mm-sec"><div class="mm-h">Texto e destaques</div>
      <label class="mm-lab">Rótulo</label><input type="text" data-text="lb" value="${mmEsc(n.lb || "")}" placeholder="Ex.: prioridade, status…">
      <label class="mm-lab" style="margin-top:8px">Nota</label><textarea data-text="n" rows="3" placeholder="Escreva uma nota para este tópico">${mmEsc(n.n || "")}</textarea>
      <label class="mm-lab" style="margin-top:8px">Chamada (balão)</label><textarea data-text="co" rows="2" placeholder="Um balão de destaque ao lado do tópico">${mmEsc(n.co || "")}</textarea>
      <label class="mm-lab" style="margin-top:8px">Equação (LaTeX)</label><input type="text" data-text="eq" value="${mmEsc(n.eq || "")}" placeholder="Ex.: E = mc^2   ou   \\frac{a}{b}"></div>
    <div class="mm-sec"><div class="mm-h">Para fazer e tarefa</div>
      <label class="mm-switch"><span>Caixa "Para fazer" no tópico</span><input type="checkbox" data-todo="1" ${n.td !== undefined ? "checked" : ""}><i></i></label>
      <div class="mm-grid2" style="margin-top:8px">
        <label class="mm-lab">Início<input type="date" data-task="s" value="${tk.s || ""}"></label>
        <label class="mm-lab">Prazo<input type="date" data-task="d" value="${tk.d || ""}"></label>
        <label class="mm-lab">Progresso<select data-task="p">${[0, 10, 25, 50, 75, 90, 100].map(v => `<option value="${v}"${(tk.p || 0) === v ? " selected" : ""}>${v}%</option>`).join("")}</select></label>
        <label class="mm-lab">Prioridade<select data-task="pr">${[["", "—"], ["1", "1 (alta)"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5 (baixa)"]].map(([v, nm]) => `<option value="${v}"${String(tk.pr || "") === v ? " selected" : ""}>${nm}</option>`).join("")}</select></label>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" data-act="task-clear">Remover tarefa</button></div>
    <div class="mm-sec"><div class="mm-h">Links</div>
      <label class="mm-lab">Link da internet</label><input type="text" data-text="lk" value="${mmEsc(n.lk || "")}" placeholder="https://…">
      <label class="mm-lab" style="margin-top:8px">Link para outro tópico deste mapa</label>
      <select data-node="lt"><option value="">—</option>${others.map(x => `<option value="${x.id}"${n.lt === x.id ? " selected" : ""}>${mmEsc((x.t || "").slice(0, 50))}</option>`).join("")}</select>
      <label class="mm-lab" style="margin-top:8px">Link para outro mapa</label>
      <select data-node="lm"><option value="">—</option>${otherMaps.map(m => `<option value="${m.id}"${n.lm === m.id ? " selected" : ""}>${mmEsc(m.titulo)}</option>`).join("")}</select></div>
    <div class="mm-sec"><div class="mm-h">Imagem, anexo e adesivo</div>
      <div class="mm-btnrow"><button type="button" class="btn btn-ghost btn-sm" data-act="pick-image">Imagem local</button><button type="button" class="btn btn-ghost btn-sm" data-act="pick-illus">Ilustração</button>${n.im ? `<button type="button" class="btn btn-ghost btn-sm" data-act="rm-image">Remover imagem</button>` : ""}</div>
      <div class="mm-btnrow" style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="pick-attach">${n.at ? "Trocar anexo" : "Anexar arquivo"}</button>${n.at ? `<span class="mm-help">📎 ${mmEsc(n.at.name)}</span><button type="button" class="btn btn-ghost btn-sm" data-act="rm-attach">Remover</button>` : ""}</div>
      <label class="mm-lab" style="margin-top:10px">Marcador</label>
      <div class="mm-markers">${MM_MARKERS.map(m => `<button type="button" class="mm-mk${n.mk === m ? " on" : ""}" data-marker="${m}">${m}</button>`).join("")}<button type="button" class="mm-mk" data-act="pick-sticker" title="Mais adesivos">＋</button><button type="button" class="mm-mk" data-marker="">✕</button></div></div>
    <div class="mm-sec"><div class="mm-h">Comentários</div>
      ${(n.cm || []).map((c, i) => `<div class="mm-comment"><b>${mmEsc(c.u)}</b> <small>${mmEsc(c.d)}</small><button type="button" class="mm-x" data-delcm="${i}" title="Apagar">×</button><div>${mmEsc(c.t)}</div></div>`).join("") || `<p class="mm-help">Nenhum comentário ainda.</p>`}
      <textarea id="mm-cm-input" rows="2" placeholder="Escreva um comentário…"></textarea>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:6px" data-act="add-comment">Comentar</button></div>
    <div class="mm-sec"><button type="button" class="btn btn-ghost btn-sm" data-act="clear-style">Limpar todo o estilo e conteúdo extra</button></div>`;
}
const mmAllNodesFlat = () => mmRoots().flatMap(r => mmAllNodes(r));

/* ---------------- imagem, anexo, adesivos, ilustrações, comentários, zonas ---------------- */
function mmPickFile(kind) {
  const inp = document.getElementById("mm-file");
  inp.accept = kind === "image" ? "image/*" : "";
  inp.dataset.kind = kind; inp.value = ""; inp.click();
}
function mmImageToDataUri(file, maxW) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      if (file.type === "image/svg+xml") { resolve(fr.result); return; }
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxW / img.width), cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.82));
      };
      img.onerror = () => reject(new Error("imagem inválida")); img.src = fr.result;
    };
    fr.onerror = () => reject(new Error("falha ao ler")); fr.readAsDataURL(file);
  });
}
async function mmHandleFile(file, kind) {
  if (!file || !sel0()) return;
  try {
    if (kind === "image") { if (file.size > 8 * 1024 * 1024) { mmToast("Imagem muito grande (máximo 8 MB)."); return; } const uri = await mmImageToDataUri(file, 520); mmSetProp({ im: uri }); }
    else {
      if (file.size > 400 * 1024) { mmToast("Anexo muito grande: o limite é 400 KB por arquivo (ele fica guardado dentro do mapa)."); return; }
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      mmSetProp({ at: { name: file.name, data } });
    }
  } catch (e) { mmToast("Não foi possível usar esse arquivo."); }
}
const sel0 = () => (mm.sel && mmIsNodeId(mm.sel) ? mm.sel : null);
function mmPopup(kind, anchor) {
  const pop = document.getElementById("mm-pop");
  const r = anchor.getBoundingClientRect();
  pop.innerHTML = kind === "illus"
    ? `<div class="mm-pop-grid">${Object.keys(MM_ILLUS).map(k => `<button type="button" data-illus="${k}"><img src="${mmIllusUri(k)}" alt="${k}"></button>`).join("")}</div>`
    : `<div class="mm-pop-grid mm-pop-emoji">${MM_STICKERS.map(e => `<button type="button" data-sticker="${e}">${e}</button>`).join("")}</div>`;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`; pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 260)}px`;
  pop.hidden = false;
}
function mmAddComment() {
  const id0 = sel0(), n0 = id0 && mmObj(id0), inp = document.getElementById("mm-cm-input");
  if (!n0 || !inp || !inp.value.trim()) return;
  const txt = inp.value.trim();
  mmMutate(() => { n0.cm = n0.cm || []; n0.cm.push({ u: (session && session.name) || "—", d: new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }), t: txt }); });
}
function mmAddZone() {
  const c = document.getElementById("mm-canvas").getBoundingClientRect();
  const cx = (c.width / 2 - mm.panX) / mm.zoom, cy = (c.height / 2 - mm.panY) / mm.zoom, zid = mmNewId();
  mmMutate(() => { const r = mmRoot(); r.zn = r.zn || []; r.zn.push({ id: zid, x: cx - 160, y: cy - 100, w: 320, h: 200, t: "" }); });
  mmSelect("zn:" + zid); mmRender(); mmStartEdit("zn:" + zid, null, false);
}

/* ---------------- salvar / carregar ---------------- */
function mmSetStatus(s) { mm.status = s; const el = document.getElementById("mm-status"); if (el) el.textContent = s; }
function mmScheduleSave() { mmSetStatus("Salvando…"); clearTimeout(mm.saveTimer); mm.saveTimer = setTimeout(mmSaveNow, 900); }
async function mmSaveNow() {
  clearTimeout(mm.saveTimer); mm.saveTimer = null;
  if (!mm.cur) return;
  const row = { id: mm.cur.id, titulo: (mm.cur.titulo || "Novo mapa").trim() || "Novo mapa", data: JSON.parse(JSON.stringify(mm.cur.data, mmStrip)), updated_by_name: (session && session.name) || "", updated_at: new Date().toISOString() };
  const { error } = await supabase.from("mind_maps").upsert(row);
  if (error) { console.error("Erro ao salvar mapa mental:", error); mmSetStatus("Não foi possível salvar"); return; }
  const m = mm.maps.find(x => x.id === row.id);
  if (m) { m.titulo = row.titulo; m.updated_at = row.updated_at; m.updated_by_name = row.updated_by_name; }
  mmSetStatus("Salvo ✓"); mmRenderList();
}
async function mmLoadMaps() {
  const { data, error } = await supabase.from("mind_maps").select("id, titulo, created_by, updated_by_name, created_at, updated_at").order("updated_at", { ascending: false });
  if (error) { console.error("Erro ao carregar mapas:", error); return null; }
  return data;
}
async function mmOpenMap(id) {
  await mmFlush();
  const { data, error } = await supabase.from("mind_maps").select("*").eq("id", id).single();
  if (error || !data) { mmToast("Não foi possível abrir o mapa."); return; }
  mm.cur = { id: data.id, titulo: data.titulo, data: data.data && data.data.id ? data.data : { id: mmNewId(), t: data.titulo, c: [] }, created_by: data.created_by };
  mm.undo = []; mm.redo = []; mm.editing = null; mm.pitch = null; mm.relFrom = null;
  mm.sel = mm.cur.data.id; mm.selSet = new Set([mm.sel]);
  document.getElementById("mm-title").value = mm.cur.titulo;
  document.getElementById("mm-empty").hidden = true; document.getElementById("mm-workspace").hidden = false;
  mmSetStatus(""); mmRender(); mmFit(); mmRenderList(); mmRenderPanel(); mmFocusCanvas();
  try { localStorage.setItem("crm-mm-last", id); } catch (e) { /* sem armazenamento */ }
}
async function mmFlush() { if (mm.editing) mmCommitEdit(); if (mm.saveTimer) await mmSaveNow(); }
async function mmNewMap(copyFrom) {
  await mmFlush();
  const data = copyFrom ? (() => { const d = mmClone(copyFrom.data); const idmap = new Map(); const fresh = n => { const o = n.id; n.id = mmNewId(); idmap.set(o, n.id); (n.c || []).forEach(fresh); (n.sm || []).forEach(s => { s.id = mmNewId(); }); };
    fresh(d); (d.fl || []).forEach(fresh);
    const mapId = i => idmap.get(i) || i;
    mmAllNodes(d).concat((d.fl || []).flatMap(r => mmAllNodes(r))).forEach(n => (n.sm || []).forEach(s => { s.from = mapId(s.from); s.to = mapId(s.to); }));
    (d.rel || []).forEach(r => { r.id = mmNewId(); r.a = mapId(r.a); r.b = mapId(r.b); }); (d.bd || []).forEach(b => { b.id = mmNewId(); b.ids = b.ids.map(mapId); });
    return d; })() : { id: mmNewId(), t: "Tema central", c: [] };
  const row = { id: uid(), titulo: copyFrom ? `${copyFrom.titulo} (cópia)` : "Novo mapa", data, created_by: session.id, updated_by_name: session.name || "", updated_at: new Date().toISOString() };
  const { error } = await supabase.from("mind_maps").insert(row);
  if (error) { console.error(error); mmToast("Não foi possível criar o mapa."); return; }
  mm.maps.unshift({ id: row.id, titulo: row.titulo, created_by: row.created_by, updated_by_name: row.updated_by_name, updated_at: row.updated_at });
  await mmOpenMap(row.id);
  if (!copyFrom) { mmSelect(mmRoot().id); mmStartEdit(mmRoot().id); }
}
async function mmDeleteMap() {
  if (!mm.cur) return;
  if (!(session.role === "ADM" || mm.cur.created_by === session.id)) { alert("Só o ADM ou quem criou o mapa pode excluí-lo."); return; }
  if (!confirm(`Excluir o mapa "${mm.cur.titulo}"? Não dá para desfazer.`)) return;
  const id = mm.cur.id; clearTimeout(mm.saveTimer); mm.saveTimer = null;
  const { error } = await supabase.from("mind_maps").delete().eq("id", id);
  if (error) { alert("Não foi possível excluir."); return; }
  mm.maps = mm.maps.filter(m => m.id !== id); mm.cur = null;
  if (mm.maps.length) await mmOpenMap(mm.maps[0].id);
  else { document.getElementById("mm-workspace").hidden = true; document.getElementById("mm-empty").hidden = false; mmRenderList(); }
}

/* ---------------- tela ---------------- */
async function renderMindMapView() {
  if (!mmCanUse()) return;
  if (!mm.loaded) {
    const rows = await mmLoadMaps();
    if (rows === null) { document.getElementById("mm-empty").hidden = false; document.getElementById("mm-empty").textContent = "Não foi possível carregar os mapas agora."; return; }
    mm.maps = rows; mm.loaded = true;
  }
  mmRenderList();
  if (!mm.cur) {
    const last = (() => { try { return localStorage.getItem("crm-mm-last"); } catch (e) { return null; } })();
    const first = mm.maps.find(m => m.id === last) || mm.maps[0];
    if (first) await mmOpenMap(first.id);
    else { document.getElementById("mm-workspace").hidden = true; document.getElementById("mm-empty").hidden = false; }
  } else mmRender();
}
function mmRenderList() {
  const box = document.getElementById("mm-list"); if (!box) return;
  box.innerHTML = mm.maps.length
    ? mm.maps.map(m => `<button type="button" class="mm-list-item${mm.cur && mm.cur.id === m.id ? " on" : ""}" data-id="${m.id}"><b>${mmEsc(m.titulo)}</b><small>${m.updated_at ? new Date(m.updated_at).toLocaleDateString("pt-BR") : ""}${m.updated_by_name ? " · " + mmEsc(m.updated_by_name) : ""}</small></button>`).join("")
    : `<p class="muted-note">Nenhum mapa ainda.</p>`;
}

/* exporta como PNG: desenha em canvas com as posições calculadas e o estilo de cada elemento */
function mmExportPng() {
  if (!mm.cur || !mm.pos.size || !mm.geo) return;
  const pad = 40, S = 2, { minX, minY, maxX, maxY } = mm.geo;
  const cv = document.createElement("canvas"); cv.width = (maxX - minX + pad * 2) * S; cv.height = (maxY - minY + pad * 2) * S;
  const ctx = cv.getContext("2d"); ctx.scale(S, S);
  ctx.fillStyle = mmBg(); ctx.fillRect(0, 0, cv.width, cv.height); ctx.translate(pad - minX, pad - minY);
  /* camada de linhas: reaproveita o SVG já desenhado */
  const svg = document.getElementById("mm-edges");
  const clone = svg.cloneNode(true); clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`); clone.setAttribute("width", maxX - minX + pad * 2); clone.setAttribute("height", maxY - minY + pad * 2);
  clone.querySelectorAll("[class]").forEach(e => e.removeAttribute("class"));
  const img = new Image();
  const svgStr = new XMLSerializer().serializeToString(clone);
  img.onload = () => {
    ctx.drawImage(img, minX - pad, minY - pad);
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    mm.els.forEach((el, id) => {
      const p = mm.pos.get(id); if (!p) return;
      const cs = getComputedStyle(el), bg = cs.backgroundColor, bw = parseFloat(cs.borderTopWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0, radius = parseFloat(cs.borderTopLeftRadius) || 0;
      if (bg && bg !== "rgba(0, 0, 0, 0)") { ctx.fillStyle = bg; rr(p.x, p.y, p.w, p.h, radius); ctx.fill(); }
      if (bw > 0) { ctx.strokeStyle = cs.borderTopColor; ctx.lineWidth = bw; rr(p.x + bw / 2, p.y + bw / 2, p.w - bw, p.h - bw, radius); ctx.stroke(); }
      else if (bb > 0) { ctx.strokeStyle = cs.borderBottomColor; ctx.lineWidth = bb; ctx.beginPath(); ctx.moveTo(p.x, p.y + p.h - bb / 2); ctx.lineTo(p.x + p.w, p.y + p.h - bb / 2); ctx.stroke(); }
      const tx = el.querySelector(".mm-text") || el, ts = getComputedStyle(tx);
      ctx.fillStyle = cs.color; ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; ctx.textBaseline = "top";
      const r0 = tx.getBoundingClientRect(), r1 = el.getBoundingClientRect(), sc = el.offsetWidth ? r1.width / el.offsetWidth : 1;
      const ox = p.x + (r0.left - r1.left) / sc, oy = p.y + (r0.top - r1.top) / sc, maxW = tx.offsetWidth || p.w;
      const lh = parseFloat(ts.lineHeight) || parseFloat(cs.fontSize) * 1.35, lines = [];
      (tx.innerText || "").split("\n").forEach(par => { let line = ""; par.split(" ").forEach(w => { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > maxW + 1 && line) { lines.push(line); line = w; } else line = t; }); lines.push(line); });
      lines.forEach((ln, i) => ctx.fillText(ln, ox, oy + i * lh));
    });
    const a = document.createElement("a");
    a.download = `${(mm.cur.titulo || "mapa-mental").replace(/[^\w\-]+/g, "-").toLowerCase()}.png`; a.href = cv.toDataURL("image/png"); a.click();
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
}

/* ---------------- eventos ---------------- */
(function mmBind() {
  const view = document.getElementById("view-mapamental"); if (!view) return;
  const canvas = document.getElementById("mm-canvas"), stage = document.getElementById("mm-stage"), $ = id => document.getElementById(id);
  const sel = () => (mm.sel && mmIsNodeId(mm.sel) ? mm.sel : null);

  $("mm-new").addEventListener("click", () => mmNewMap());
  $("mm-new-empty").addEventListener("click", () => mmNewMap());
  $("mm-dup").addEventListener("click", () => mm.cur && mmNewMap(mm.cur));
  $("mm-del").addEventListener("click", mmDeleteMap);
  $("mm-png").addEventListener("click", mmExportPng);
  $("mm-list").addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (b) mmOpenMap(b.dataset.id); });
  $("mm-title").addEventListener("input", e => { if (mm.cur) { mm.cur.titulo = e.target.value; mmScheduleSave(); } });
  $("mm-zoom-in").addEventListener("click", () => mmZoomAt(1.2));
  $("mm-zoom-out").addEventListener("click", () => mmZoomAt(1 / 1.2));
  $("mm-fit").addEventListener("click", mmFit);
  $("mm-undo").addEventListener("click", mmUndo);
  $("mm-redo").addEventListener("click", mmRedo);
  /* barra do topo */
  $("mm-add-sib").addEventListener("click", () => sel() && mmAddSibling(sel(), false));
  $("mm-add-child").addEventListener("click", () => sel() && mmAddChild(sel()));
  $("mm-rel").addEventListener("click", mmStartRelation);
  $("mm-sum").addEventListener("click", mmAddSummary);
  $("mm-bd").addEventListener("click", mmAddBoundary);
  $("mm-del-node").addEventListener("click", mmDeleteSelection);
  $("mm-panel-toggle").addEventListener("click", () => { mm.panelOpen = !mm.panelOpen; $("mm-panel").hidden = !mm.panelOpen; $("mm-body").classList.toggle("mm-panel-closed", !mm.panelOpen); setTimeout(() => { if (mm.cur) mmApplyTransform(); }, 0); });
  /* menu + */
  const insMenu = $("mm-insert-menu");
  $("mm-insert").addEventListener("click", e => { e.stopPropagation(); insMenu.hidden = !insMenu.hidden; });
  document.addEventListener("click", e => { if (!e.target.closest("#mm-insert-wrap")) insMenu.hidden = true; });
  insMenu.addEventListener("click", e => {
    const b = e.target.closest("[data-ins]"); if (!b) return;
    insMenu.hidden = true;
    const s = sel(), a = b.dataset.ins;
    if (a === "zone") { mmAddZone(); return; }
    if (a === "float") { const c = canvas.getBoundingClientRect(); mmAddFloating(Math.max(0, (c.width / 2 - mm.panX) / mm.zoom), Math.max(0, (c.height / 2 - mm.panY) / mm.zoom)); return; }
    if (!s) { mmToast("Selecione um tópico primeiro."); return; }
    if (a === "sibling") mmAddSibling(s, false);
    else if (a === "child") mmAddChild(s);
    else if (a === "parent") mmAddParent(s);
    else if (["note", "label", "callout", "equation", "link"].includes(a)) { mm.tab = "style"; if (!mm.panelOpen) $("mm-panel-toggle").click(); mmRenderPanel(); const key = { note: "n", label: "lb", callout: "co", equation: "eq", link: "lk" }[a]; const f = document.querySelector(`#mm-panel-body [data-text="${key}"]`); if (f) { f.scrollIntoView({ block: "center" }); f.focus(); } }
    else if (a === "linktopic" || a === "linkmap") { mm.tab = "style"; if (!mm.panelOpen) $("mm-panel-toggle").click(); mmRenderPanel(); const f = document.querySelector(`#mm-panel-body [data-node="${a === "linktopic" ? "lt" : "lm"}"]`); if (f) { f.scrollIntoView({ block: "center" }); f.focus(); } }
    else if (a === "comment") { mm.tab = "style"; if (!mm.panelOpen) $("mm-panel-toggle").click(); mmRenderPanel(); const f = $("mm-cm-input"); if (f) { f.scrollIntoView({ block: "center" }); f.focus(); } }
    else if (a === "todo") mmSetProp({ td: (mmObj(s) && mmObj(s).td !== undefined) ? null : 0 });
    else if (a === "task") { const n0 = mmObj(s); mmSetProp({ tk: n0 && n0.tk ? n0.tk : { pr: 3, p: 0 } }); mm.tab = "style"; if (!mm.panelOpen) $("mm-panel-toggle").click(); mmRenderPanel(); }
    else if (a === "attachment") mmPickFile("attach");
    else if (a === "image") mmPickFile("image");
    else if (a === "illustration") mmPopup("illus", $("mm-insert"));
    else if (a === "sticker") mmPopup("sticker", $("mm-insert"));
  });
  /* painel */
  $("mm-panel").addEventListener("click", e => {
    const tab = e.target.closest(".mm-tab"); if (tab) { mm.tab = tab.dataset.tab; mmRenderPanel(); return; }
    const th = e.target.closest("[data-theme]"); if (th) { mmSetCfg({ theme: th.dataset.theme, bg: null, palette: "theme" }); return; }
    const mk = e.target.closest("[data-marker]"); if (mk) { mmSetProp({ mk: mk.dataset.marker || null }); return; }
    const dc = e.target.closest("[data-delcm]"); if (dc) { const id0 = [...mm.selSet].filter(mmIsNodeId)[0], n0 = id0 && mmObj(id0); if (n0 && n0.cm) mmMutate(() => { n0.cm.splice(parseInt(dc.dataset.delcm, 10), 1); if (!n0.cm.length) delete n0.cm; }); return; }
    const bc = e.target.closest("[data-branchcolor]"); if (bc) { mmSetColor(bc.dataset.branchcolor); return; }
    const ac = e.target.closest("[data-act]"); if (!ac) return;
    const a = ac.dataset.act;
    if (a === "bg-reset") mmSetCfg({ bg: null });
    else if (a === "clear-fill") mmSetProp({ fill: null });
    else if (a === "clear-fg") mmSetProp({ fg: null });
    else if (a === "bold") { const n = mmObj([...mm.selSet].filter(mmIsNodeId)[0]); mmSetProp({ b: !(n && n.b) }); }
    else if (a === "italic") { const n = mmObj([...mm.selSet].filter(mmIsNodeId)[0]); mmSetProp({ i: !(n && n.i) }); }
    else if (a === "clear-style") mmSetProp({ shape: null, fill: null, fg: null, fs: null, b: null, i: null, k: null, mk: null, lb: null, lk: null, co: null, eq: null, im: null, at: null, tk: null, td: null, lt: null, lm: null });
    else if (a === "task-clear") mmSetProp({ tk: null });
    else if (a === "pick-image") mmPickFile("image");
    else if (a === "pick-attach") mmPickFile("attach");
    else if (a === "pick-illus") mmPopup("illus", ac);
    else if (a === "pick-sticker") mmPopup("sticker", ac);
    else if (a === "rm-image") mmSetProp({ im: null });
    else if (a === "rm-attach") mmSetProp({ at: null });
    else if (a === "add-comment") mmAddComment();
    else if (a === "pitch-start") mmPitchStart();
    else if (a === "pitch-next") mmPitchStep(1);
    else if (a === "pitch-prev") mmPitchStep(-1);
    else if (a === "pitch-stop") mmPitchStop();
  });
  $("mm-panel").addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.cfg) { mmSetCfg({ [t.dataset.cfg]: t.type === "checkbox" ? t.checked : t.value }); return; }
    if (t.id === "mm-bgcolor") { mmSetCfg({ bg: t.value }); return; }
    if (t.dataset.node) { const v = t.value; mmSetProp({ [t.dataset.node]: t.dataset.node === "fs" ? (v ? parseInt(v, 10) : null) : (v || null) }); return; }
    if (t.dataset.todo) { mmSetProp({ td: t.checked ? 0 : null }); return; }
    if (t.dataset.task) {
      const id0 = [...mm.selSet].filter(mmIsNodeId)[0], n0 = id0 && mmObj(id0); if (!n0) return;
      const tk = { ...(n0.tk || {}) }, k = t.dataset.task, v = t.value;
      if (k === "p") tk.p = parseInt(v, 10) || 0; else if (k === "pr") { if (v) tk.pr = parseInt(v, 10); else delete tk.pr; } else { if (v) tk[k] = v; else delete tk[k]; }
      mmSetProp({ tk: Object.keys(tk).length ? tk : null }); return;
    }
    if (t.dataset.nodecolor) { mmSetProp({ [t.dataset.nodecolor]: t.value }); return; }
    if (t.dataset.text) { mmSetProp({ [t.dataset.text]: t.value.trim() || null }); }
  });
  $("mm-pitch-prev").addEventListener("click", () => mmPitchStep(-1));
  $("mm-pitch-next").addEventListener("click", () => mmPitchStep(1));
  $("mm-pitch-stop").addEventListener("click", mmPitchStop);
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && mm.pitch) mmPitchStop(); });
  $("mm-colors").innerHTML = MM_PALETTES.vibrante.map(c => `<button type="button" class="mm-swatch" data-c="${c}" style="background:${c}" title="Cor da ramificação"></button>`).join("");
  $("mm-colors").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (b) mmSetColor(b.dataset.c); });

  $("mm-file").addEventListener("change", e => { const f = e.target.files[0]; if (f) mmHandleFile(f, e.target.dataset.kind); });
  $("mm-pop").addEventListener("click", e => {
    const il = e.target.closest("[data-illus]"), st = e.target.closest("[data-sticker]");
    if (il) mmSetProp({ im: mmIllusUri(il.dataset.illus) }); else if (st) mmSetProp({ mk: st.dataset.sticker }); else return;
    $("mm-pop").hidden = true;
  });
  document.addEventListener("click", e => { if (!e.target.closest("#mm-pop") && !e.target.closest("[data-act='pick-illus'],[data-act='pick-sticker'],[data-ins='illustration'],[data-ins='sticker']")) $("mm-pop").hidden = true; });

  /* seleção / arrastar / mover o mapa */
  canvas.addEventListener("mousedown", e => {
    if (mm.pitch) return;
    const nodeEl = e.target.closest(".mm-node"), obj = e.target.closest("[data-obj]");
    if (mm.relFrom) {
      e.preventDefault();
      if (nodeEl && mmIsNodeId(nodeEl.dataset.id)) mmFinishRelation(nodeEl.dataset.id); else { mm.relFrom = null; canvas.classList.remove("mm-linking"); }
      return;
    }
    const zh = e.target.closest(".mm-zone");
    if (zh) {
      const zid = zh.dataset.id; if (mm.editing && mm.editing !== zid) mmCommitEdit();
      if (mm.editing === zid) return;
      mmSelect(zid); mmFocusCanvas(); e.preventDefault();
      const z = mmObj(zid);
      if (z && e.button === 0) mm.zdrag = { id: zid, resize: !!e.target.closest(".mm-zone-r"), x: e.clientX, y: e.clientY, ox: z.x, oy: z.y, ow: z.w, oh: z.h, moved: false };
      return;
    }
    const todo = e.target.closest(".mm-todo");
    if (todo) { const host = todo.closest(".mm-node"), n0 = mmObj(host.dataset.id); if (n0) { mmSelect(host.dataset.id); mmMutate(() => { n0.td = n0.td ? 0 : 1; }); } e.preventDefault(); return; }
    const lt = e.target.closest(".mm-lt"); if (lt) { mmSelect(lt.dataset.lt, true); e.preventDefault(); return; }
    const lmEl = e.target.closest(".mm-lm"); if (lmEl) { mmOpenMap(lmEl.dataset.lm); e.preventDefault(); return; }
    const atEl = e.target.closest(".mm-at"); if (atEl) { const n0 = mmObj(atEl.closest(".mm-node").dataset.id); if (n0 && n0.at) { const a = document.createElement("a"); a.href = n0.at.data; a.download = n0.at.name; a.click(); } e.preventDefault(); return; }
    if (e.target.closest(".mm-link")) { const lk = e.target.closest(".mm-link").dataset.lk; if (lk) window.open(/^https?:\/\//i.test(lk) ? lk : `https://${lk}`, "_blank", "noopener"); e.preventDefault(); return; }
    if (nodeEl) {
      if (mm.editing === nodeEl.dataset.id) return;
      if (mm.editing) mmCommitEdit();
      mmSelect(nodeEl.dataset.id, false, e.shiftKey || e.metaKey || e.ctrlKey);
      mmFocusCanvas(); e.preventDefault();
      if (e.button === 0 && mmIsNodeId(nodeEl.dataset.id) && !(e.shiftKey || e.metaKey || e.ctrlKey)) mm.drag = { id: nodeEl.dataset.id, x: e.clientX, y: e.clientY, active: false, ghost: null };
      return;
    }
    if (obj) { if (mm.editing) mmCommitEdit(); mmSelect(obj.dataset.obj); mmFocusCanvas(); e.preventDefault(); return; }
    if (e.target.closest(".mm-pitchbar")) return;
    if (mm.editing) mmCommitEdit();
    mm.pan = { x: e.clientX, y: e.clientY, px: mm.panX, py: mm.panY, moved: false };
    canvas.classList.add("mm-panning"); mmFocusCanvas();
  });
  window.addEventListener("mousemove", e => {
    if (mm.zdrag) {
      const z = mmObj(mm.zdrag.id), d0 = mm.zdrag; if (!z) return;
      const dx = (e.clientX - d0.x) / mm.zoom, dy = (e.clientY - d0.y) / mm.zoom; d0.moved = true;
      if (d0.resize) { z.w = Math.max(120, d0.ow + dx); z.h = Math.max(80, d0.oh + dy); } else { z.x = d0.ox + dx; z.y = d0.oy + dy; }
      mmRelayout(); return;
    }
    if (mm.pan) { mm.pan.moved = true; mm.panX = mm.pan.px + e.clientX - mm.pan.x; mm.panY = mm.pan.py + e.clientY - mm.pan.y; mmApplyTransform(); return; }
    const d = mm.drag; if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      const f = mmFind(d.id);
      if (!f || (!f.parent && !f.floating)) { mm.drag = null; return; }
      d.active = true; d.ghost = mm.els.get(d.id).cloneNode(true); d.ghost.classList.add("mm-ghost"); document.body.appendChild(d.ghost);
      mm.els.get(d.id).classList.add("mm-dragging");
    }
    if (d.active) {
      d.ghost.style.left = `${e.clientX + 10}px`; d.ghost.style.top = `${e.clientY + 10}px`;
      mm.els.forEach(el => el.classList.remove("mm-drop"));
      const t = document.elementFromPoint(e.clientX, e.clientY), target = t && t.closest(".mm-node");
      if (target && mmIsNodeId(target.dataset.id) && target.dataset.id !== d.id && !mmSubtreeIds(mmFind(d.id).node).includes(target.dataset.id)) target.classList.add("mm-drop");
    }
  });
  window.addEventListener("mouseup", e => {
    if (mm.zdrag) { const d0 = mm.zdrag; mm.zdrag = null; if (d0.moved) { const z = mmObj(d0.id); if (z) { const nx = { x: z.x, y: z.y, w: z.w, h: z.h }; z.x = d0.ox; z.y = d0.oy; z.w = d0.ow; z.h = d0.oh; mmMutate(() => Object.assign(z, nx)); } } return; }
    if (mm.pan) {
      const moved = mm.pan.moved; mm.pan = null; canvas.classList.remove("mm-panning");
      if (!moved) { mmSelect(mmRoot().id); }
    }
    const d = mm.drag; if (!d) return; mm.drag = null;
    if (!d.active) return;
    d.ghost.remove(); mm.els.forEach(el => el.classList.remove("mm-drop", "mm-dragging"));
    const t = document.elementFromPoint(e.clientX, e.clientY), target = t && t.closest(".mm-node");
    if (target && mmIsNodeId(target.dataset.id) && target.dataset.id !== d.id) { mmMoveInto(d.id, target.dataset.id); return; }
    const f = mmFind(d.id);
    if (f && f.floating && !f.parent && canvas.contains(t)) {
      const dx = (e.clientX - d.x) / mm.zoom, dy = (e.clientY - d.y) / mm.zoom;
      mmMutate(() => { f.node.fx = (f.node.fx || 0) + dx; f.node.fy = (f.node.fy || 0) + dy; });
    }
  });
  canvas.addEventListener("dblclick", e => {
    if (mm.pitch) return;
    const nodeEl = e.target.closest(".mm-node");
    if (nodeEl) { if (nodeEl.dataset.id.startsWith("zn:") && !e.target.closest(".mm-zone-h")) return; mmSelect(nodeEl.dataset.id); mmStartEdit(nodeEl.dataset.id); return; }
    const obj = e.target.closest("[data-obj]");
    if (obj && obj.dataset.obj.startsWith("rel:")) { const rid = obj.dataset.obj.slice(4); mmSelect("rl:" + rid); mmRender(); mmStartEdit("rl:" + rid); return; }
    /* duplo clique no fundo = tópico flutuante */
    const r = canvas.getBoundingClientRect();
    mmAddFloating((e.clientX - r.left - mm.panX) / mm.zoom, (e.clientY - r.top - mm.panY) / mm.zoom);
  });
  canvas.addEventListener("wheel", e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) mmZoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY); else { mm.panX -= e.deltaX; mm.panY -= e.deltaY; mmApplyTransform(); } }, { passive: false });

  /* edição dentro do tópico */
  stage.addEventListener("keydown", e => {
    const host = e.target.closest(".mm-node"); if (!mm.editing || !host || host.dataset.id !== mm.editing) return;
    const id = mm.editing, isNode = mmIsNodeId(id);
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); mmCommitEdit(); if (isNode && mmFind(id)) mmAddSibling(id, false); }
    else if (e.key === "Tab" && isNode) { e.preventDefault(); mmCommitEdit(); if (mmFind(id)) { if (e.shiftKey) { const f = mmFind(id); if (f.parent) mmAddSibling(f.parent.id, false); } else mmAddChild(id); } }
    else if (e.key === "Escape") { e.preventDefault(); mmCommitEdit(true); }
    e.stopPropagation();
  });
  stage.addEventListener("input", e => {
    const host = e.target.closest(".mm-node"); if (!mm.editing || !host || host.dataset.id !== mm.editing) return;
    const o = mmObj(mm.editing);
    if (o) { o.t = mmTextEl(host).innerText.replace(/\n+$/, ""); host.dataset.empty = o.t ? "0" : "1"; mmRelayout(); mmScheduleSave(); }
  });
  stage.addEventListener("focusout", e => {
    const host = e.target.closest && e.target.closest(".mm-node");
    if (mm.editing && host && host.dataset.id === mm.editing) setTimeout(() => { if (mm.editing && !mm.els.get(mm.editing).contains(document.activeElement)) mmCommitEdit(); }, 0);
  });
  stage.addEventListener("paste", e => { if (!mm.editing) return; e.preventDefault(); document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text").replace(/\r/g, "")); });

  /* teclado */
  canvas.addEventListener("keydown", e => {
    if (mm.editing || !mm.cur) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key;
    if (mm.pitch) { if (k === "ArrowRight" || k === " " || k === "Enter") { e.preventDefault(); mmPitchStep(1); } else if (k === "ArrowLeft") { e.preventDefault(); mmPitchStep(-1); } else if (k === "Escape") mmPitchStop(); return; }
    if (k === "Escape" && mm.relFrom) { mm.relFrom = null; canvas.classList.remove("mm-linking"); return; }
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? mmRedo() : mmUndo(); return; }
    if (mod && k.toLowerCase() === "y") { e.preventDefault(); mmRedo(); return; }
    if (mod && (k === "+" || k === "=")) { e.preventDefault(); mmZoomAt(1.2); return; }
    if (mod && k === "-") { e.preventDefault(); mmZoomAt(1 / 1.2); return; }
    const id = mm.sel; if (!id) return;
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); mmDeleteSelection(); return; }
    if (!mmIsNodeId(id)) { if (k === "F2" || (k === "Enter" && (id.startsWith("sm:") || id.startsWith("rl:")))) { e.preventDefault(); mmStartEdit(id.startsWith("rel:") ? "rl:" + id.slice(4) : id); } return; }
    const f = mmFind(id); if (!f) return;
    if (mod && k.toLowerCase() === "d") { e.preventDefault(); mmDuplicateNode(id); return; }
    if (k === "Tab") { e.preventDefault(); if (e.shiftKey) { if (f.parent) mmAddSibling(f.parent.id, false); } else mmAddChild(id); }
    else if (k === "Enter") { e.preventDefault(); mmAddSibling(id, e.shiftKey); }
    else if (k === "F2") { e.preventDefault(); mmStartEdit(id); }
    else if (k === " ") { e.preventDefault(); mmToggle(id); }
    else if (k === "ArrowRight" || k === "ArrowLeft") {
      e.preventDefault();
      const side = (mm.pos.get(id) || {}).side || "r", towardKids = (k === "ArrowRight") === (side === "r" || !f.parent);
      if (towardKids) { if (f.node.x) mmToggle(id); else { const ks = f.node.c || []; if (ks.length) mmSelect(ks[Math.floor((ks.length - 1) / 2)].id, true); } }
      else if (f.parent) mmSelect(f.parent.id, true);
    }
    else if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); const sib = f.parent ? f.parent.c : []; const nx = sib[f.index + (k === "ArrowDown" ? 1 : -1)]; if (nx) mmSelect(nx.id, true); }
    else if (k === "Escape") { mm.sel = null; mm.selSet = new Set(); mmUpdateSelection(); mmRenderPanel(); }
    else if (k.length === 1 && !mod && !e.altKey) { e.preventDefault(); mmStartEdit(id, k); }
  });
  window.addEventListener("beforeunload", () => { if (mm.saveTimer) mmSaveNow(); });
})();

/* cartão do menu MKT */
document.addEventListener("click", e => { const b = e.target.closest(".mkt-card[data-go]"); if (b && typeof switchView === "function") switchView(b.dataset.go); });
