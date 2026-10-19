/* ============================================================
   MAPA MENTAL (menu MKT › Mapa Mental)
   Editor de mapas mentais de criação livre, no estilo XMind:
     Tab ............ novo tópico filho (na horizontal)
     Enter .......... novo tópico irmão (abaixo)   |  Shift+Enter: irmão acima
     F2 / duplo clique / digitar ... editar o texto  |  Esc: sair da edição
     Delete ......... excluir o tópico e o que há dentro
     Setas .......... navegar  |  Espaço: recolher/expandir
     Cmd/Ctrl+Z ..... desfazer  |  Shift+Cmd/Ctrl+Z: refazer
     Arrastar um tópico sobre outro o move para dentro dele; arrastar o fundo move o mapa;
     Cmd/Ctrl + roda do mouse (ou botões) dá zoom.
   Salva sozinho. Acesso: ADM, Gerente e MKT. Árvore em JSON na tabela mind_maps:
     { id, t: texto, c: [filhos], x: recolhido?, k: cor da ramificação (1º nível) }
   Depende de script.js: session, uid, escapeHtml, agendaToast, currentView.
   ============================================================ */

const MM_PALETTE = ["#D9534F", "#1E3A8A", "#F5B82E", "#2E9C8A", "#6B5BD2", "#E0784A", "#2B8FC4", "#8B5CF6", "#16A34A", "#DB2777"];
const MM_H_GAP = 56, MM_V_GAP = 10, MM_MAX_UNDO = 60;

const mm = {
  maps: [], loaded: false, cur: null,           /* cur = { id, titulo, data, created_by } */
  sel: null, editing: null, editSnap: null, editNew: false,
  undo: [], redo: [],
  zoom: 1, panX: 40, panY: 40,
  saveTimer: null, status: "", els: new Map(), pos: new Map(), drag: null, pan: null,
};
const mmNewId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const mmNode = (t = "", c = []) => ({ id: mmNewId(), t, c });
const mmRoot = () => (mm.cur ? mm.cur.data : null);
const mmStrip = (k, v) => (k.startsWith("_") ? undefined : v);
const mmClone = o => JSON.parse(JSON.stringify(o, mmStrip));
const mmCanUse = () => !!session && ["ADM", "Gerente", "MKT"].includes(session.role) && !(typeof viewAs !== "undefined" && viewAs.active && false);

/* luminosidade (0 a 1) de uma cor #rrggbb, para escolher texto claro ou escuro sobre ela */
function mmLuma(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/* ---------------- árvore ---------------- */
function mmFind(id, node = mmRoot(), parent = null, depth = 0) {
  if (!node) return null;
  if (node.id === id) return { node, parent, depth, index: parent ? parent.c.indexOf(node) : 0 };
  for (const ch of node.c || []) {
    const r = mmFind(id, ch, node, depth + 1);
    if (r) return r;
  }
  return null;
}
function mmDescendants(node) { return (node.c || []).reduce((a, ch) => a + 1 + mmDescendants(ch), 0); }
function mmVisibleList(node = mmRoot(), out = []) {
  out.push(node);
  if (!node.x) (node.c || []).forEach(ch => mmVisibleList(ch, out));
  return out;
}
function mmBranchColor(id) {
  /* cor da ramificação: a do ancestral de 1º nível (ou a escolhida nele) */
  const root = mmRoot();
  const top = (root.c || []).find(ch => ch.id === id || mmFind(id, ch));
  if (!top) return MM_PALETTE[1];
  return top.k || MM_PALETTE[(root.c.indexOf(top)) % MM_PALETTE.length];
}

/* ---------------- histórico ---------------- */
function mmMutate(fn, label) {
  mm.undo.push(JSON.stringify(mmRoot(), mmStrip));
  if (mm.undo.length > MM_MAX_UNDO) mm.undo.shift();
  mm.redo = [];
  fn();
  mmRender();
  mmScheduleSave();
}
function mmUndo() {
  if (!mm.undo.length || !mm.cur) return;
  mm.redo.push(JSON.stringify(mmRoot(), mmStrip));
  mm.cur.data = JSON.parse(mm.undo.pop());
  if (!mmFind(mm.sel)) mm.sel = mmRoot().id;
  mmRender(); mmScheduleSave();
}
function mmRedo() {
  if (!mm.redo.length || !mm.cur) return;
  mm.undo.push(JSON.stringify(mmRoot(), mmStrip));
  mm.cur.data = JSON.parse(mm.redo.pop());
  if (!mmFind(mm.sel)) mm.sel = mmRoot().id;
  mmRender(); mmScheduleSave();
}

/* ---------------- operações ---------------- */
function mmAddChild(id) {
  const f = mmFind(id); if (!f) return;
  let created;
  mmMutate(() => { created = mmNode(); created._new = true; f.node.c.push(created); f.node.x = false; });
  mm.sel = created.id;
  mmRender(); mmStartEdit(created.id, null, true);
}
function mmAddSibling(id, before) {
  const f = mmFind(id); if (!f) return;
  if (!f.parent) { mmAddChild(id); return; }   /* o tópico central não tem irmãos: vira filho */
  let created;
  mmMutate(() => { created = mmNode(); created._new = true; f.parent.c.splice(f.index + (before ? 0 : 1), 0, created); });
  mm.sel = created.id;
  mmRender(); mmStartEdit(created.id, null, true);
}
function mmDelete(id) {
  const f = mmFind(id); if (!f || !f.parent) { if (f && !f.parent) agendaToast("O tópico central não pode ser excluído. Edite o texto ou exclua o mapa."); return; }
  const n = mmDescendants(f.node);
  if (n >= 6 && !confirm(`Excluir este tópico e os ${n} tópicos dentro dele? (Dá para desfazer com Cmd/Ctrl+Z.)`)) return;
  const next = f.parent.c[f.index + 1] || f.parent.c[f.index - 1] || f.parent;
  mmMutate(() => { f.parent.c.splice(f.index, 1); });
  mm.sel = next.id;
  mmRender();
}
function mmToggle(id) {
  const f = mmFind(id); if (!f || !(f.node.c || []).length) return;
  mmMutate(() => { f.node.x = !f.node.x; });
}
function mmDuplicateNode(id) {
  const f = mmFind(id); if (!f || !f.parent) return;
  const copy = JSON.parse(JSON.stringify(f.node, mmStrip));
  const fresh = n => { n.id = mmNewId(); (n.c || []).forEach(fresh); };
  fresh(copy);
  mmMutate(() => { f.parent.c.splice(f.index + 1, 0, copy); });
  mm.sel = copy.id; mmRender();
}
function mmSetColor(color) {
  const f = mm.sel ? mmFind(mm.sel) : null; if (!f) return;
  const root = mmRoot();
  const top = (root.c || []).find(ch => ch.id === f.node.id || mmFind(f.node.id, ch));
  if (!top) { agendaToast("Escolha um tópico de uma ramificação para mudar a cor."); return; }
  mmMutate(() => { top.k = color; });
}
function mmMoveInto(id, targetId) {
  const f = mmFind(id), t = mmFind(targetId);
  if (!f || !t || !f.parent || id === targetId || mmFind(targetId, f.node)) return;
  mmMutate(() => { f.parent.c.splice(f.index, 1); t.node.c.push(f.node); t.node.x = false; });
  mm.sel = id; mmRender();
}

/* ---------------- edição de texto ---------------- */
function mmStartEdit(id, initialChar, isNew) {
  if (mm.editing && mm.editing !== id) mmCommitEdit();
  const el = mm.els.get(id), f = mmFind(id);
  if (!el || !f) return;
  mm.editing = id;
  mm.editNew = !!isNew;
  mm.editSnap = JSON.stringify(mmRoot(), mmStrip);
  el.classList.add("mm-editing");
  el.contentEditable = "true";
  el.spellcheck = false;
  if (initialChar != null) el.textContent = initialChar;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  if (initialChar != null || isNew) range.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
  mmRelayout();
}
function mmCommitEdit(cancel) {
  const id = mm.editing; if (!id) return;
  const el = mm.els.get(id), f = mmFind(id);
  mm.editing = null;
  if (!el || !f) return;
  el.contentEditable = "false";
  el.classList.remove("mm-editing");
  const txt = el.innerText.replace(/\n+$/, "");
  if (cancel) { el.textContent = f.node.t; }
  else f.node.t = txt;
  const wasNew = mm.editNew; mm.editNew = false;
  delete f.node._new;
  if (wasNew && (cancel || !txt.trim()) && !(cancel ? f.node.t : txt).trim() && f.parent) {
    /* tópico novo deixado em branco: some (como no XMind), sem entrar no histórico */
    mm.undo.pop();
    f.parent.c.splice(f.index, 1);
    mm.sel = f.parent.id;
    mmRender(); mmScheduleSave();
    return;
  }
  if (!cancel && !wasNew && mm.editSnap && mm.editSnap !== JSON.stringify(mmRoot(), mmStrip)) {
    mm.undo.push(mm.editSnap); if (mm.undo.length > MM_MAX_UNDO) mm.undo.shift(); mm.redo = [];
    mmScheduleSave();
  }
  mm.editSnap = null;
  mmRelayout();
  mmFocusCanvas();
}
const mmFocusCanvas = () => { const c = document.getElementById("mm-canvas"); if (c) c.focus({ preventScroll: true }); };

/* ---------------- desenho ---------------- */
function mmRender() {
  const stage = document.getElementById("mm-stage");
  if (!stage || !mm.cur) return;
  mm.els.clear();
  stage.innerHTML = `<svg id="mm-edges" class="mm-edges"></svg>`;
  const root = mmRoot();
  const build = (n, depth) => {
    const el = document.createElement("div");
    el.className = `mm-node mm-d${Math.min(depth, 2)}`;
    el.dataset.id = n.id;
    el.textContent = n.t || "";
    el.dataset.empty = n.t ? "0" : "1";
    stage.appendChild(el);
    mm.els.set(n.id, el);
    if (!n.x) (n.c || []).forEach(ch => build(ch, depth + 1));
    if (n.x && (n.c || []).length) el.dataset.collapsed = String(n.c.length);
  };
  build(root, 0);
  mmRelayout();
  mmUpdateSelection();
}

function mmRelayout() {
  const root = mmRoot(); if (!root) return;
  const stage = document.getElementById("mm-stage"), svg = document.getElementById("mm-edges");
  if (!stage || !svg) return;
  mm.pos.clear();
  const size = new Map();
  mm.els.forEach((el, id) => size.set(id, { w: el.offsetWidth, h: el.offsetHeight }));
  const heights = new Map();
  const subH = n => {
    const own = size.get(n.id).h;
    const kids = n.x ? [] : (n.c || []);
    if (!kids.length) { heights.set(n.id, own); return own; }
    const total = kids.reduce((a, ch) => a + subH(ch), 0) + MM_V_GAP * (kids.length - 1);
    const h = Math.max(own, total);
    heights.set(n.id, h);
    return h;
  };
  subH(root);
  const place = (n, x, top, depth) => {
    const sz = size.get(n.id), H = heights.get(n.id);
    const kids = n.x ? [] : (n.c || []);
    let y;
    if (kids.length) {
      let cy = top + (H - (kids.reduce((a, ch) => a + heights.get(ch.id), 0) + MM_V_GAP * (kids.length - 1))) / 2;
      const ys = [];
      kids.forEach(ch => { place(ch, x + sz.w + MM_H_GAP, cy, depth + 1); ys.push(mm.pos.get(ch.id)); cy += heights.get(ch.id) + MM_V_GAP; });
      y = (ys[0].y + ys[ys.length - 1].y + ys[ys.length - 1].h) / 2 - sz.h / 2;
    } else y = top + (H - sz.h) / 2;
    mm.pos.set(n.id, { x, y, w: sz.w, h: sz.h, depth });
  };
  place(root, 0, 0, 0);
  /* posiciona e desenha as ligações */
  let maxX = 0, maxY = 0;
  mm.pos.forEach((p, id) => { const el = mm.els.get(id); el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); });
  svg.setAttribute("width", maxX + 20); svg.setAttribute("height", maxY + 20);
  let paths = "";
  const edges = (n, depth, color) => {
    if (n.x) return;
    (n.c || []).forEach((ch, i) => {
      const c = depth === 0 ? (ch.k || MM_PALETTE[i % MM_PALETTE.length]) : color;
      const a = mm.pos.get(n.id), b = mm.pos.get(ch.id);
      const ay = a.depth >= 2 ? a.y + a.h : a.y + a.h / 2, by = depth + 1 >= 2 ? b.y + b.h : b.y + b.h / 2;
      const x1 = a.x + a.w, x2 = b.x, dx = (x2 - x1) / 2;
      const w = depth === 0 ? 4 : depth === 1 ? 3 : 2;
      paths += `<path d="M${x1} ${ay} C${x1 + dx} ${ay}, ${x2 - dx} ${by}, ${x2} ${by}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
      edges(ch, depth + 1, c);
    });
  };
  edges(root, 0, MM_PALETTE[1]);
  svg.innerHTML = paths;
  /* cores dos tópicos */
  const colorize = (n, depth, color) => {
    const el = mm.els.get(n.id); if (!el) return;
    el.style.setProperty("--mm-c", depth === 0 ? "#3B82F6" : color);
    if (depth === 1) el.style.setProperty("--mm-fg", mmLuma(color) > 0.62 ? "#1a2233" : "#ffffff");
    if (n.x) return;
    (n.c || []).forEach((ch, i) => colorize(ch, depth + 1, depth === 0 ? (ch.k || MM_PALETTE[i % MM_PALETTE.length]) : color));
  };
  colorize(root, 0, MM_PALETTE[1]);
  /* "recolhido" mostra quantos tópicos há dentro */
  mm.els.forEach(el => { el.title = el.dataset.collapsed ? `${el.dataset.collapsed} tópico(s) recolhido(s) — Espaço para abrir` : ""; });
  mmApplyTransform();
}
function mmApplyTransform() {
  const stage = document.getElementById("mm-stage");
  if (stage) stage.style.transform = `translate(${mm.panX}px, ${mm.panY}px) scale(${mm.zoom})`;
  const z = document.getElementById("mm-zoom-label");
  if (z) z.textContent = `${Math.round(mm.zoom * 100)}%`;
}
function mmUpdateSelection() {
  mm.els.forEach((el, id) => el.classList.toggle("mm-sel", id === mm.sel));
}
function mmSelect(id, reveal) {
  mm.sel = id;
  mmUpdateSelection();
  if (reveal) mmReveal(id);
}
/* garante que o tópico escolhido fique dentro da tela */
function mmReveal(id) {
  const p = mm.pos.get(id), c = document.getElementById("mm-canvas");
  if (!p || !c) return;
  const x = p.x * mm.zoom + mm.panX, y = p.y * mm.zoom + mm.panY, w = p.w * mm.zoom, h = p.h * mm.zoom;
  const pad = 40;
  if (x < pad) mm.panX += pad - x;
  else if (x + w > c.clientWidth - pad) mm.panX -= x + w - (c.clientWidth - pad);
  if (y < pad) mm.panY += pad - y;
  else if (y + h > c.clientHeight - pad) mm.panY -= y + h - (c.clientHeight - pad);
  mmApplyTransform();
}
function mmFit() {
  const c = document.getElementById("mm-canvas"); if (!c || !mm.pos.size) return;
  let maxX = 0, maxY = 0;
  mm.pos.forEach(p => { maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); });
  const z = Math.min(1.2, (c.clientWidth - 80) / Math.max(1, maxX), (c.clientHeight - 80) / Math.max(1, maxY));
  mm.zoom = Math.max(0.2, z);
  mm.panX = Math.max(40, (c.clientWidth - maxX * mm.zoom) / 2);
  mm.panY = Math.max(30, (c.clientHeight - maxY * mm.zoom) / 2);
  mmApplyTransform();
}
function mmZoomAt(factor, cx, cy) {
  const c = document.getElementById("mm-canvas"); if (!c) return;
  const nz = Math.min(2.5, Math.max(0.2, mm.zoom * factor));
  const rect = c.getBoundingClientRect();
  const px = (cx ?? rect.left + c.clientWidth / 2) - rect.left, py = (cy ?? rect.top + c.clientHeight / 2) - rect.top;
  mm.panX = px - (px - mm.panX) * (nz / mm.zoom);
  mm.panY = py - (py - mm.panY) * (nz / mm.zoom);
  mm.zoom = nz;
  mmApplyTransform();
}

/* ---------------- salvar / carregar ---------------- */
function mmSetStatus(s) {
  mm.status = s;
  const el = document.getElementById("mm-status");
  if (el) el.textContent = s;
}
function mmScheduleSave() {
  mmSetStatus("Salvando…");
  clearTimeout(mm.saveTimer);
  mm.saveTimer = setTimeout(mmSaveNow, 900);
}
async function mmSaveNow() {
  clearTimeout(mm.saveTimer);
  if (!mm.cur) return;
  const row = {
    id: mm.cur.id, titulo: (mm.cur.titulo || "Novo mapa").trim() || "Novo mapa", data: JSON.parse(JSON.stringify(mm.cur.data, mmStrip)),
    updated_by_name: (session && session.name) || "", updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("mind_maps").upsert(row);
  if (error) { console.error("Erro ao salvar mapa mental:", error); mmSetStatus("Não foi possível salvar"); return; }
  const m = mm.maps.find(x => x.id === row.id);
  if (m) { m.titulo = row.titulo; m.updated_at = row.updated_at; m.updated_by_name = row.updated_by_name; }
  mmSetStatus("Salvo ✓");
  mmRenderList();
}
async function mmLoadMaps() {
  const { data, error } = await supabase.from("mind_maps").select("id, titulo, created_by, updated_by_name, created_at, updated_at").order("updated_at", { ascending: false });
  if (error) { console.error("Erro ao carregar mapas:", error); return null; }
  return data;
}
async function mmOpenMap(id) {
  await mmFlush();
  const { data, error } = await supabase.from("mind_maps").select("*").eq("id", id).single();
  if (error || !data) { agendaToast("Não foi possível abrir o mapa."); return; }
  mm.cur = { id: data.id, titulo: data.titulo, data: data.data && data.data.id ? data.data : { id: mmNewId(), t: data.titulo, c: [] }, created_by: data.created_by };
  mm.undo = []; mm.redo = []; mm.sel = mm.cur.data.id; mm.editing = null;
  document.getElementById("mm-title").value = mm.cur.titulo;
  document.getElementById("mm-empty").hidden = true;
  document.getElementById("mm-workspace").hidden = false;
  mmSetStatus("");
  mmRender(); mmFit(); mmRenderList(); mmFocusCanvas();
  try { localStorage.setItem("crm-mm-last", id); } catch (e) { /* sem armazenamento */ }
}
async function mmFlush() {
  if (mm.editing) mmCommitEdit();
  if (mm.saveTimer) { clearTimeout(mm.saveTimer); mm.saveTimer = null; await mmSaveNow(); }
}
async function mmNewMap(copyFrom) {
  await mmFlush();
  const data = copyFrom ? (() => { const d = mmClone(copyFrom.data); const fresh = n => { n.id = mmNewId(); (n.c || []).forEach(fresh); }; fresh(d); return d; })() : { id: mmNewId(), t: "Tema central", c: [] };
  const row = {
    id: uid(), titulo: copyFrom ? `${copyFrom.titulo} (cópia)` : "Novo mapa", data, created_by: session.id,
    updated_by_name: session.name || "", updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("mind_maps").insert(row);
  if (error) { console.error(error); agendaToast("Não foi possível criar o mapa."); return; }
  mm.maps.unshift({ id: row.id, titulo: row.titulo, created_by: row.created_by, updated_by_name: row.updated_by_name, updated_at: row.updated_at });
  await mmOpenMap(row.id);
  if (!copyFrom) { mmSelect(mmRoot().id); mmStartEdit(mmRoot().id); }
}
async function mmDeleteMap() {
  if (!mm.cur) return;
  const canDelete = session.role === "ADM" || mm.cur.created_by === session.id;
  if (!canDelete) { alert("Só o ADM ou quem criou o mapa pode excluí-lo."); return; }
  if (!confirm(`Excluir o mapa "${mm.cur.titulo}"? Não dá para desfazer.`)) return;
  const id = mm.cur.id;
  clearTimeout(mm.saveTimer); mm.saveTimer = null;
  const { error } = await supabase.from("mind_maps").delete().eq("id", id);
  if (error) { alert("Não foi possível excluir."); return; }
  mm.maps = mm.maps.filter(m => m.id !== id);
  mm.cur = null;
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
  } else { mmRender(); }
}
function mmRenderList() {
  const box = document.getElementById("mm-list"); if (!box) return;
  box.innerHTML = mm.maps.length
    ? mm.maps.map(m => `<button type="button" class="mm-list-item${mm.cur && mm.cur.id === m.id ? " on" : ""}" data-id="${m.id}"><b>${escapeHtml(m.titulo)}</b><small>${m.updated_at ? new Date(m.updated_at).toLocaleDateString("pt-BR") : ""}${m.updated_by_name ? " · " + escapeHtml(m.updated_by_name) : ""}</small></button>`).join("")
    : `<p class="muted-note">Nenhum mapa ainda.</p>`;
}

/* exporta o mapa como imagem PNG (desenhado em canvas a partir das posições calculadas) */
function mmExportPng() {
  if (!mm.cur || !mm.pos.size) return;
  const pad = 40, S = 2;
  let maxX = 0, maxY = 0;
  mm.pos.forEach(p => { maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); });
  const cv = document.createElement("canvas");
  cv.width = (maxX + pad * 2) * S; cv.height = (maxY + pad * 2) * S;
  const ctx = cv.getContext("2d");
  ctx.scale(S, S); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.translate(pad, pad);
  const root = mmRoot();
  /* ligações */
  const edges = (n, depth, color) => {
    if (n.x) return;
    (n.c || []).forEach((ch, i) => {
      const c = depth === 0 ? (ch.k || MM_PALETTE[i % MM_PALETTE.length]) : color;
      const a = mm.pos.get(n.id), b = mm.pos.get(ch.id);
      const ay = a.depth >= 2 ? a.y + a.h : a.y + a.h / 2, by = depth + 1 >= 2 ? b.y + b.h : b.y + b.h / 2;
      const x1 = a.x + a.w, x2 = b.x, dx = (x2 - x1) / 2;
      ctx.strokeStyle = c; ctx.lineWidth = depth === 0 ? 4 : depth === 1 ? 3 : 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x1, ay); ctx.bezierCurveTo(x1 + dx, ay, x2 - dx, by, x2, by); ctx.stroke();
      edges(ch, depth + 1, c);
    });
  };
  edges(root, 0, MM_PALETTE[1]);
  /* tópicos (usa o estilo calculado de cada elemento, então o PNG sai igual à tela) */
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  mm.els.forEach((el, id) => {
    const p = mm.pos.get(id), cs = getComputedStyle(el);
    const bg = cs.backgroundColor, color = cs.color, bw = parseFloat(cs.borderTopWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    if (bg && bg !== "rgba(0, 0, 0, 0)") { ctx.fillStyle = bg; rr(p.x, p.y, p.w, p.h, radius); ctx.fill(); }
    if (bw > 0) { ctx.strokeStyle = cs.borderTopColor; ctx.lineWidth = bw; rr(p.x + bw / 2, p.y + bw / 2, p.w - bw, p.h - bw, radius); ctx.stroke(); }
    else if (bb > 0) { ctx.strokeStyle = cs.borderBottomColor; ctx.lineWidth = bb; ctx.beginPath(); ctx.moveTo(p.x, p.y + p.h - bb / 2); ctx.lineTo(p.x + p.w, p.y + p.h - bb / 2); ctx.stroke(); }
    ctx.fillStyle = color; ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; ctx.textBaseline = "top";
    const padL = parseFloat(cs.paddingLeft) + bw, padT = parseFloat(cs.paddingTop) + bw, maxW = p.w - padL * 2;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const lines = [];
    (el.innerText || "").split("\n").forEach(par => {
      let line = "";
      par.split(" ").forEach(word => { const test = line ? `${line} ${word}` : word; if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test; });
      lines.push(line);
    });
    lines.forEach((ln, i) => ctx.fillText(ln, p.x + padL, p.y + padT + i * lh));
  });
  const a = document.createElement("a");
  a.download = `${(mm.cur.titulo || "mapa-mental").replace(/[^\w\-]+/g, "-").toLowerCase()}.png`;
  a.href = cv.toDataURL("image/png");
  a.click();
}

/* ---------------- eventos ---------------- */
(function mmBind() {
  const view = document.getElementById("view-mapamental");
  if (!view) return;
  const canvas = document.getElementById("mm-canvas");
  const stage = document.getElementById("mm-stage");

  document.getElementById("mm-new").addEventListener("click", () => mmNewMap());
  document.getElementById("mm-new-empty").addEventListener("click", () => mmNewMap());
  document.getElementById("mm-dup").addEventListener("click", () => mm.cur && mmNewMap(mm.cur));
  document.getElementById("mm-del").addEventListener("click", mmDeleteMap);
  document.getElementById("mm-png").addEventListener("click", mmExportPng);
  document.getElementById("mm-list").addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (b) mmOpenMap(b.dataset.id); });
  document.getElementById("mm-title").addEventListener("input", e => { if (mm.cur) { mm.cur.titulo = e.target.value; mmScheduleSave(); } });
  document.getElementById("mm-zoom-in").addEventListener("click", () => mmZoomAt(1.2));
  document.getElementById("mm-zoom-out").addEventListener("click", () => mmZoomAt(1 / 1.2));
  document.getElementById("mm-fit").addEventListener("click", mmFit);
  document.getElementById("mm-undo").addEventListener("click", mmUndo);
  document.getElementById("mm-redo").addEventListener("click", mmRedo);
  document.getElementById("mm-add-child").addEventListener("click", () => mm.sel && mmAddChild(mm.sel));
  document.getElementById("mm-add-sib").addEventListener("click", () => mm.sel && mmAddSibling(mm.sel, false));
  document.getElementById("mm-del-node").addEventListener("click", () => mm.sel && mmDelete(mm.sel));
  document.getElementById("mm-colors").innerHTML = MM_PALETTE.map(c => `<button type="button" class="mm-swatch" data-c="${c}" style="background:${c}" title="Cor da ramificação"></button>`).join("");
  document.getElementById("mm-colors").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (b) mmSetColor(b.dataset.c); });

  /* seleção / duplo clique / arrastar tópicos / mover o mapa */
  canvas.addEventListener("mousedown", e => {
    const nodeEl = e.target.closest(".mm-node");
    if (nodeEl) {
      if (mm.editing === nodeEl.dataset.id) return;
      if (mm.editing) mmCommitEdit();
      mmSelect(nodeEl.dataset.id);
      mmFocusCanvas();
      e.preventDefault();
      if (e.button === 0) mm.drag = { id: nodeEl.dataset.id, x: e.clientX, y: e.clientY, active: false, ghost: null };
      return;
    }
    if (e.target.closest(".mm-toolbar")) return;
    if (mm.editing) mmCommitEdit();
    mm.pan = { x: e.clientX, y: e.clientY, px: mm.panX, py: mm.panY };
    canvas.classList.add("mm-panning");
    mmFocusCanvas();
  });
  window.addEventListener("mousemove", e => {
    if (mm.pan) { mm.panX = mm.pan.px + e.clientX - mm.pan.x; mm.panY = mm.pan.py + e.clientY - mm.pan.y; mmApplyTransform(); return; }
    const d = mm.drag; if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      const f = mmFind(d.id);
      if (!f || !f.parent) { mm.drag = null; return; }
      d.active = true;
      d.ghost = mm.els.get(d.id).cloneNode(true); d.ghost.classList.add("mm-ghost"); document.body.appendChild(d.ghost);
      mm.els.get(d.id).classList.add("mm-dragging");
    }
    if (d.active) {
      d.ghost.style.left = `${e.clientX + 10}px`; d.ghost.style.top = `${e.clientY + 10}px`;
      mm.els.forEach(el => el.classList.remove("mm-drop"));
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const target = t && t.closest(".mm-node");
      if (target && target.dataset.id !== d.id && !mmFind(target.dataset.id, mmFind(d.id).node)) target.classList.add("mm-drop");
    }
  });
  window.addEventListener("mouseup", e => {
    if (mm.pan) { mm.pan = null; canvas.classList.remove("mm-panning"); }
    const d = mm.drag; if (!d) return;
    mm.drag = null;
    if (!d.active) return;
    d.ghost.remove();
    mm.els.forEach(el => el.classList.remove("mm-drop", "mm-dragging"));
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const target = t && t.closest(".mm-node");
    if (target && target.dataset.id !== d.id) mmMoveInto(d.id, target.dataset.id);
  });
  canvas.addEventListener("dblclick", e => {
    const nodeEl = e.target.closest(".mm-node");
    if (nodeEl) { mmSelect(nodeEl.dataset.id); mmStartEdit(nodeEl.dataset.id); }
  });
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) mmZoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    else { mm.panX -= e.deltaX; mm.panY -= e.deltaY; mmApplyTransform(); }
  }, { passive: false });

  /* edição de texto dentro do tópico */
  stage.addEventListener("keydown", e => {
    if (!mm.editing || e.target.dataset.id !== mm.editing) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const id = mm.editing; mmCommitEdit(); if (mmFind(id)) mmAddSibling(id, false); }
    else if (e.key === "Tab") { e.preventDefault(); const id = mm.editing; mmCommitEdit(); if (mmFind(id)) { if (e.shiftKey) { const f = mmFind(id); if (f.parent) mmAddSibling(f.parent.id, false); } else mmAddChild(id); } }
    else if (e.key === "Escape") { e.preventDefault(); mmCommitEdit(true); }
    e.stopPropagation();
  });
  stage.addEventListener("input", e => {
    if (!mm.editing || e.target.dataset.id !== mm.editing) return;
    const f = mmFind(mm.editing);
    if (f) { f.node.t = e.target.innerText.replace(/\n+$/, ""); e.target.dataset.empty = f.node.t ? "0" : "1"; mmRelayout(); mmScheduleSave(); }
  });
  stage.addEventListener("focusout", e => {
    if (mm.editing && e.target.dataset && e.target.dataset.id === mm.editing) setTimeout(() => { if (mm.editing && document.activeElement !== mm.els.get(mm.editing)) mmCommitEdit(); }, 0);
  });
  stage.addEventListener("paste", e => {
    if (!mm.editing) return;
    e.preventDefault();
    const txt = (e.clipboardData || window.clipboardData).getData("text").replace(/\r/g, "");
    document.execCommand("insertText", false, txt);
  });

  /* teclado com um tópico selecionado */
  canvas.addEventListener("keydown", e => {
    if (mm.editing || !mm.cur) return;
    const mod = e.metaKey || e.ctrlKey, id = mm.sel;
    if (!id && !mod) return;
    const f = id ? mmFind(id) : null;
    const k = e.key;
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? mmRedo() : mmUndo(); return; }
    if (mod && k.toLowerCase() === "y") { e.preventDefault(); mmRedo(); return; }
    if (mod && (k === "+" || k === "=")) { e.preventDefault(); mmZoomAt(1.2); return; }
    if (mod && k === "-") { e.preventDefault(); mmZoomAt(1 / 1.2); return; }
    if (mod && k.toLowerCase() === "d") { e.preventDefault(); if (id) mmDuplicateNode(id); return; }
    if (!f) return;
    if (k === "Tab") { e.preventDefault(); if (e.shiftKey) { if (f.parent) mmAddSibling(f.parent.id, false); } else mmAddChild(id); }
    else if (k === "Enter") { e.preventDefault(); mmAddSibling(id, e.shiftKey); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); mmDelete(id); }
    else if (k === "F2") { e.preventDefault(); mmStartEdit(id); }
    else if (k === " ") { e.preventDefault(); mmToggle(id); }
    else if (k === "ArrowRight") { e.preventDefault(); if (f.node.x) mmToggle(id); else if ((f.node.c || []).length) mmSelect(f.node.c[Math.floor((f.node.c.length - 1) / 2)].id, true); }
    else if (k === "ArrowLeft") { e.preventDefault(); if (f.parent) mmSelect(f.parent.id, true); }
    else if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      const sib = f.parent ? f.parent.c : [];
      const nxt = sib[f.index + (k === "ArrowDown" ? 1 : -1)];
      if (nxt) mmSelect(nxt.id, true);
    }
    else if (k === "Escape") { mm.sel = null; mmUpdateSelection(); }
    else if (k.length === 1 && !mod && !e.altKey) { e.preventDefault(); mmStartEdit(id, k); }   /* digitar já edita o tópico */
  });

  window.addEventListener("beforeunload", () => { if (mm.saveTimer) mmSaveNow(); });
})();

/* cartão do menu MKT */
document.addEventListener("click", e => {
  const b = e.target.closest(".mkt-card[data-go]");
  if (b && typeof switchView === "function") switchView(b.dataset.go);
});
