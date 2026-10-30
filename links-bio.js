/* ============================================================
   MEUS LINKS (menu › Meus links) — cada usuário monta a própria página de links para a bio do Instagram (estilo Linktree).
   A página pública fica em /l/<endereço> (links.html). Aqui: endereço, fundo, perfil, cartão de destaque e a lista de links
   (ícone, título, endereço, ligar/desligar, ordem, cliques), com prévia ao vivo. Salva sozinho.
   Tabelas bio_pages / bio_links (cada um só enxerga e altera a própria página). Imagem do destaque: bucket bio-images.
   Depende de script.js (session, agendaToast), config.js e bio-shared.js.
   ============================================================ */

let bioPage = null, bioLinks = [];
let bioDirtyPage = false, bioDirtyLinks = new Set(), bioTimer = null, bioSaving = false;
let bioIconOpen = null;
const bioEl = id => document.getElementById(id);
const bioBase = () => `${location.origin}/l/`;

function bioSlugify(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "");
}
function bioStatus(msg) { const e = bioEl("bio-saved"); if (e) e.textContent = msg; }

async function renderLinkBio() {
  const body = bioEl("view-linkbio-body");
  if (!body || !session) return;
  body.innerHTML = '<p class="muted-note" style="padding:0 20px;">Carregando…</p>';
  const { data: page, error } = await supabase.from("bio_pages").select("*").eq("user_id", session.id).maybeSingle();
  if (error) { body.innerHTML = `<p class="muted-note" style="padding:0 20px;">Não foi possível carregar: ${bioEsc(error.message)}</p>`; return; }
  bioPage = page;
  bioLinks = [];
  if (page) {
    const { data: links } = await supabase.from("bio_links").select("*").eq("user_id", session.id).order("position").order("created_at");
    bioLinks = links || [];
  }
  bioDirtyPage = false; bioDirtyLinks = new Set(); bioIconOpen = null;
  if (!bioPage) return bioRenderCreate(body);
  bioRenderEditor(body);
}

/* ---- primeiro acesso: escolher o endereço ---- */
function bioRenderCreate(body) {
  const suggestion = bioSlugify(session.name) || "";
  body.innerHTML = `<div style="padding:0 20px 24px;max-width:560px;">
    <p class="q-card-sub" style="margin:0 0 14px;">Crie a sua página de links para colocar na bio do Instagram. Você escolhe o endereço agora (pode mudar depois) e adiciona os links em seguida.</p>
    <label><span class="muted-note">Endereço da sua página</span>
      <div class="bio-addr"><span>${bioEsc(bioBase())}</span><input type="text" id="bio-new-slug" maxlength="30" value="${bioEsc(suggestion)}" placeholder="seu-nome" autocomplete="off"></div></label>
    <p class="muted-note">Use de 3 a 30 letras minúsculas, números ou hífen.</p>
    <div class="bio-actions"><button type="button" class="btn btn-primary" id="bio-create">Criar minha página</button><span class="bio-saved" id="bio-saved"></span></div>
  </div>`;
  bioEl("bio-new-slug").addEventListener("input", e => { e.target.value = bioSlugify(e.target.value); });
  bioEl("bio-create").addEventListener("click", async () => {
    const slug = bioSlugify(bioEl("bio-new-slug").value);
    if (slug.length < 3) return bioStatus("O endereço precisa ter pelo menos 3 caracteres.");
    const { data, error } = await supabase.from("bio_pages").insert({ user_id: session.id, slug }).select().single();
    if (error) return bioStatus(error.code === "23505" ? "Esse endereço já está em uso. Escolha outro." : "Não foi possível criar: " + error.message);
    bioPage = data; bioLinks = [];
    bioRenderEditor(body);
  });
}

/* ---- editor ---- */
function bioIconGrid(current) {
  return `<div class="bio-icon-grid">${Object.keys(BIO_ICONS).map(k =>
    `<button type="button" data-icon="${k}" class="${k === current ? "active" : ""}" title="${bioEsc(BIO_ICON_LABELS[k] || k)}">${bioIconSvg(k, 20)}</button>`).join("")}</div>`;
}
function bioLinkRowHtml(l, i) {
  return `<div class="bio-link-row ${l.enabled ? "" : "off"}" data-lid="${l.id}">
    <div class="bio-link-grid">
      <span class="bio-drag" title="Arraste para mudar a ordem" aria-hidden="true">⠿</span>
      <button type="button" class="btn btn-ghost bio-icon-pick" data-act="icon" title="Escolher ícone">${bioIconSvg(l.icon, 20)}</button>
      <input type="text" data-lf="label" maxlength="80" value="${bioEsc(l.label)}" placeholder="Título (ex.: Fale no WhatsApp)">
      <input type="text" data-lf="url" maxlength="500" value="${bioEsc(l.url)}" placeholder="Endereço (https://…)">
    </div>
    ${bioIconOpen === l.id ? bioIconGrid(l.icon) : ""}
    <div class="bio-link-tools">
      <label style="margin:0;display:flex;align-items:center;gap:6px;"><input type="checkbox" data-lf="enabled" ${l.enabled ? "checked" : ""}> <span style="margin:0;">Visível</span></label>
      <span class="bio-clicks">${l.clicks || 0} clique${(l.clicks || 0) === 1 ? "" : "s"}</span>
      <span class="spacer"></span>
      <button type="button" class="btn btn-ghost btn-sm" data-act="up" ${i === 0 ? "disabled" : ""} title="Subir">↑</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="down" ${i === bioLinks.length - 1 ? "disabled" : ""} title="Descer">↓</button>
      <button type="button" class="btn btn-danger btn-sm" data-act="del">Excluir</button>
    </div>
  </div>`;
}
function bioRenderLinksList() {
  const box = bioEl("bio-links-list");
  if (!box) return;
  box.innerHTML = bioLinks.length ? bioLinks.map(bioLinkRowHtml).join("") : '<p class="muted-note">Nenhum link ainda. Clique em “+ Adicionar link” para criar o primeiro.</p>';
}
function bioRenderHeroBlock() {
  const box = bioEl("bio-hero-box");
  if (!box) return;
  const p = bioPage;
  box.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" data-pf="hero_enabled" ${p.hero_enabled ? "checked" : ""}> <span style="margin:0;">Mostrar o cartão de destaque</span></label>
    <div class="bio-hero-edit">
      <img src="${bioEsc(bioHeroImageUrl(p.hero_image_path))}" alt="">
      <div><button type="button" class="btn btn-ghost btn-sm" id="bio-hero-pick">Trocar imagem</button>
        ${p.hero_image_path ? '<button type="button" class="btn btn-ghost btn-sm" id="bio-hero-reset">Usar a imagem padrão</button>' : ""}
        <p class="muted-note" style="margin:6px 0 0;">JPG, PNG ou WebP, até 3 MB. Fica melhor na proporção 1200 × 630.</p>
        <input type="file" id="bio-hero-file" accept="image/jpeg,image/png,image/webp" hidden></div>
    </div>
    <label><span>Título do cartão</span><input type="text" data-pf="hero_title" maxlength="80" value="${bioEsc(p.hero_title)}"></label>
    <label><span>Frase embaixo do título</span><input type="text" data-pf="hero_subtitle" maxlength="140" value="${bioEsc(p.hero_subtitle)}"></label>
    <label><span>Para onde o cartão leva</span><input type="text" data-pf="hero_url" maxlength="500" value="${bioEsc(p.hero_url)}" placeholder="https://…"></label>`;
}

function bioRenderEditor(body) {
  const p = bioPage;
  body.innerHTML = `<div class="bio-admin">
    <div>
      <h3>Endereço da página</h3>
      <div class="bio-addr"><span>${bioEsc(bioBase())}</span><input type="text" id="bio-slug" maxlength="30" value="${bioEsc(p.slug)}" autocomplete="off"></div>
      <div class="bio-pub" id="bio-pub"></div>
      <div class="bio-actions">
        <button type="button" class="btn btn-primary btn-sm" id="bio-copy">Copiar link</button>
        <button type="button" class="btn btn-ghost btn-sm" id="bio-open">Abrir página</button>
        <span class="bio-stats" id="bio-stats"></span>
      </div>

      <h3>Fundo</h3>
      <div class="bio-themes">${BIO_THEMES.map(t => `<button type="button" class="bio-theme-opt ${p.theme === t.id ? "active" : ""}" data-theme="${t.id}"><div class="bio-theme-sw bio-sw-${t.id}"></div>${bioEsc(t.name)}</button>`).join("")}</div>

      <h3>Perfil</h3>
      <label><span>Título</span><input type="text" data-pf="title" maxlength="80" value="${bioEsc(p.title)}"></label>
      <label><span>Frase abaixo do título</span><input type="text" data-pf="subtitle" maxlength="120" value="${bioEsc(p.subtitle)}"></label>
      <div class="grid-2">
        <label><span>Instagram (sem o @)</span><input type="text" data-pf="instagram" maxlength="60" value="${bioEsc(p.instagram)}" placeholder="peregrinosintercambio"></label>
        <label><span>WhatsApp (com código do país)</span><input type="text" data-pf="whatsapp" maxlength="20" value="${bioEsc(p.whatsapp)}" placeholder="5511999999999"></label>
      </div>
      <p class="muted-note">Os ícones de Instagram e WhatsApp só aparecem no topo se você preencher.</p>

      <h3>Cartão de destaque</h3>
      <div id="bio-hero-box"></div>

      <h3>Seus links</h3>
      <div id="bio-links-list"></div>
      <div class="bio-actions"><button type="button" class="btn btn-primary btn-sm" id="bio-add">+ Adicionar link</button><span class="bio-saved" id="bio-saved"></span></div>
    </div>
    <div class="bio-phone-wrap">
      <p class="muted-note" style="text-align:center;margin:0 0 8px;">Prévia — é assim que fica no celular</p>
      <div class="bio-phone" id="bio-phone"></div>
    </div>
  </div>`;
  bioRenderHeroBlock();
  bioRenderLinksList();
  bioRenderPub();
  bioPreview();
  bioUpdateStats();
}

/* situação da página: bem visível, porque página fora do ar mostra "não encontrada" para quem abre o link */
function bioRenderPub() {
  const box = bioEl("bio-pub");
  if (!box || !bioPage) return;
  box.className = "bio-pub " + (bioPage.published ? "on" : "off");
  box.innerHTML = bioPage.published
    ? `<span><b>● No ar.</b> Quem abrir o link vê a página.</span><button type="button" class="btn btn-ghost btn-sm" id="bio-toggle-pub">Tirar do ar</button>`
    : `<span><b>⚠ Fora do ar.</b> Quem abrir o link vê “página não encontrada”.</span><button type="button" class="btn btn-primary btn-sm" id="bio-toggle-pub">Publicar agora</button>`;
}

function bioPreview() {
  const ph = bioEl("bio-phone");
  if (ph && bioPage) bioRender(ph, { page: bioPage, links: bioLinks.filter(l => l.enabled) }, { placeholder: true });
}
function bioUpdateStats() {
  const e = bioEl("bio-stats");
  if (!e || !bioPage) return;
  const clicks = bioLinks.reduce((s, l) => s + (l.clicks || 0), 0);
  e.textContent = `${bioPage.views || 0} visita${(bioPage.views || 0) === 1 ? "" : "s"} · ${clicks} clique${clicks === 1 ? "" : "s"}`;
}

/* ---- salvar sozinho ---- */
function bioQueueSave() { bioStatus("Alterações não salvas…"); clearTimeout(bioTimer); bioTimer = setTimeout(bioFlush, 700); }
async function bioFlush() {
  clearTimeout(bioTimer);
  if (bioSaving) { bioTimer = setTimeout(bioFlush, 400); return; }
  if (!bioPage || (!bioDirtyPage && !bioDirtyLinks.size)) return;
  bioSaving = true; bioStatus("Salvando…");
  let problem = "";
  try {
    if (bioDirtyPage) {
      bioDirtyPage = false;
      const { slug, user_id, views, created_at, updated_at, ...fields } = bioPage;
      const { error } = await supabase.from("bio_pages").update(fields).eq("user_id", session.id);
      if (error) { bioDirtyPage = true; problem = error.message.includes("hero_url") ? "O endereço do cartão de destaque é inválido." : error.message; }
    }
    for (const id of Array.from(bioDirtyLinks)) {
      const l = bioLinks.find(x => x.id === id);
      bioDirtyLinks.delete(id);
      if (!l) continue;
      if (l.url && !bioSafeUrl(l.url)) { problem = `O endereço de “${l.label || "link sem título"}” é inválido: comece com https://`; bioDirtyLinks.add(id); continue; }
      const { error } = await supabase.from("bio_links").update({ label: l.label, url: l.url, icon: l.icon, enabled: l.enabled, position: l.position }).eq("id", id);
      if (error) { bioDirtyLinks.add(id); problem = error.message; }
    }
  } finally { bioSaving = false; }
  bioStatus(problem || "Salvo ✓");
  if (!problem && (bioDirtyPage || bioDirtyLinks.size)) bioQueueSave();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") bioFlush(); });

/* ---- arrastar para reordenar (a linha só fica arrastável quando se pega pela alça ⠿, para não atrapalhar quem seleciona texto) ---- */
let bioDragId = null;
function bioDropTarget(e) {
  const list = bioEl("bio-links-list");
  const rows = list ? [...list.querySelectorAll(".bio-link-row")].filter(r => r.dataset.lid !== bioDragId) : [];
  for (const r of rows) { const b = r.getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) return { row: r, before: true }; }
  return rows.length ? { row: rows[rows.length - 1], before: false } : null;
}
function bioClearDrop() { document.querySelectorAll("#bio-links-list .drop-before, #bio-links-list .drop-after, #bio-links-list .dragging").forEach(r => r.classList.remove("drop-before", "drop-after", "dragging")); }
document.addEventListener("mousedown", e => {
  const h = e.target.closest && e.target.closest(".bio-drag");
  if (h) h.closest(".bio-link-row").draggable = true;
});
document.addEventListener("mouseup", () => document.querySelectorAll(".bio-link-row[draggable]").forEach(r => { if (!bioDragId) r.removeAttribute("draggable"); }));
document.addEventListener("dragstart", e => {
  const row = e.target.closest && e.target.closest(".bio-link-row");
  if (!row || !bioPage) return;
  bioDragId = row.dataset.lid;
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", bioDragId); } catch (err) { /* alguns navegadores exigem dado */ }
  requestAnimationFrame(() => row.classList.add("dragging"));
});
document.addEventListener("dragover", e => {
  if (!bioDragId || !e.target.closest || !e.target.closest("#bio-links-list")) return;
  e.preventDefault();
  bioClearDrop();
  const dragRow = document.querySelector(`.bio-link-row[data-lid="${bioDragId}"]`); if (dragRow) dragRow.classList.add("dragging");
  const t = bioDropTarget(e); if (t) t.row.classList.add(t.before ? "drop-before" : "drop-after");
});
document.addEventListener("drop", e => {
  if (!bioDragId || !e.target.closest || !e.target.closest("#bio-links-list")) return;
  e.preventDefault();
  const t = bioDropTarget(e), from = bioLinks.findIndex(l => l.id === bioDragId);
  if (t && from >= 0) {
    const [moved] = bioLinks.splice(from, 1);
    let to = bioLinks.findIndex(l => l.id === t.row.dataset.lid);
    if (!t.before) to += 1;
    bioLinks.splice(to, 0, moved);
    bioLinks.forEach((l, n) => { if (l.position !== n) { l.position = n; bioDirtyLinks.add(l.id); } });
    bioRenderLinksList(); bioPreview(); bioQueueSave();
  }
});
document.addEventListener("dragend", () => {
  bioDragId = null; bioClearDrop();
  document.querySelectorAll(".bio-link-row[draggable]").forEach(r => r.removeAttribute("draggable"));
});

/* ---- eventos (um só ouvinte para a tela inteira) ---- */
document.addEventListener("input", e => {
  const root = bioEl("view-linkbio-body");
  if (!root || !root.contains(e.target) || !bioPage) return;
  const pf = e.target.dataset.pf, lf = e.target.dataset.lf;
  if (pf && e.target.type !== "checkbox") { bioPage[pf] = e.target.value; bioDirtyPage = true; bioPreview(); bioQueueSave(); }
  if (lf && lf !== "enabled") {
    const id = e.target.closest("[data-lid]").dataset.lid;
    const l = bioLinks.find(x => x.id === id);
    if (l) { l[lf] = e.target.value; bioDirtyLinks.add(id); bioPreview(); bioQueueSave(); }
  }
});
document.addEventListener("change", async e => {
  const root = bioEl("view-linkbio-body");
  if (!root || !root.contains(e.target) || !bioPage) return;
  const pf = e.target.dataset.pf, lf = e.target.dataset.lf;
  if (e.target.id === "bio-slug") return bioSaveSlug(e.target);
  if (pf) {
    if (e.target.type === "checkbox") bioPage[pf] = e.target.checked;
    else if (pf === "instagram") { bioPage[pf] = e.target.value = bioCleanInstagram(e.target.value); }
    else if (pf === "whatsapp") { bioPage[pf] = e.target.value = bioCleanWhatsapp(e.target.value); }
    else if (pf === "hero_url") { bioPage[pf] = e.target.value = bioNormalizeUrl(e.target.value); }
    bioDirtyPage = true; bioPreview(); bioQueueSave();
  }
  if (lf) {
    const row = e.target.closest("[data-lid]"), l = bioLinks.find(x => x.id === row.dataset.lid);
    if (!l) return;
    if (lf === "enabled") { l.enabled = e.target.checked; row.classList.toggle("off", !l.enabled); }
    if (lf === "url") l.url = e.target.value = bioNormalizeUrl(e.target.value);
    bioDirtyLinks.add(l.id); bioPreview(); bioQueueSave();
  }
  if (e.target.id === "bio-hero-file" && e.target.files[0]) bioUploadHero(e.target.files[0]);
});
document.addEventListener("click", async e => {
  const root = bioEl("view-linkbio-body");
  if (!root || !root.contains(e.target) || !bioPage) return;
  const t = e.target;
  const theme = t.closest("[data-theme]");
  if (theme) { bioPage.theme = theme.dataset.theme; bioDirtyPage = true; root.querySelectorAll(".bio-theme-opt").forEach(b => b.classList.toggle("active", b === theme)); bioPreview(); bioQueueSave(); return; }
  if (t.closest("#bio-toggle-pub")) {
    if (bioPage.published && !confirm("Tirar a página do ar? O link vai mostrar “página não encontrada” até você publicar de novo.")) return;
    bioPage.published = !bioPage.published; bioDirtyPage = true; bioRenderPub(); bioQueueSave(); return;
  }
  if (t.closest("#bio-copy")) { try { await navigator.clipboard.writeText(bioBase() + bioPage.slug); agendaToast("Link copiado: " + bioBase() + bioPage.slug); } catch (err) { prompt("Copie o link:", bioBase() + bioPage.slug); } return; }
  if (t.closest("#bio-open")) { window.open(bioBase() + bioPage.slug, "_blank", "noopener"); return; }
  if (t.closest("#bio-hero-pick")) { bioEl("bio-hero-file").click(); return; }
  if (t.closest("#bio-hero-reset")) { await bioRemoveHeroFile(); bioPage.hero_image_path = null; bioDirtyPage = true; bioRenderHeroBlock(); bioPreview(); bioQueueSave(); return; }
  if (t.closest("#bio-add")) return bioAddLink();
  const act = t.closest("[data-act]");
  if (!act) {
    const ic = t.closest("[data-icon]");
    if (ic) {
      const l = bioLinks.find(x => x.id === ic.closest("[data-lid]").dataset.lid);
      if (l) { l.icon = ic.dataset.icon; bioDirtyLinks.add(l.id); bioIconOpen = null; bioRenderLinksList(); bioPreview(); bioQueueSave(); }
    }
    return;
  }
  const id = act.closest("[data-lid]").dataset.lid;
  const idx = bioLinks.findIndex(x => x.id === id);
  if (idx < 0) return;
  if (act.dataset.act === "icon") { bioIconOpen = bioIconOpen === id ? null : id; bioRenderLinksList(); }
  if (act.dataset.act === "up" || act.dataset.act === "down") {
    const j = act.dataset.act === "up" ? idx - 1 : idx + 1;
    if (j < 0 || j >= bioLinks.length) return;
    [bioLinks[idx], bioLinks[j]] = [bioLinks[j], bioLinks[idx]];
    bioLinks.forEach((l, n) => { if (l.position !== n) { l.position = n; bioDirtyLinks.add(l.id); } });
    bioRenderLinksList(); bioPreview(); bioQueueSave();
  }
  if (act.dataset.act === "del") {
    if (!confirm("Excluir este link?")) return;
    const { error } = await supabase.from("bio_links").delete().eq("id", id);
    if (error) return agendaToast("Não foi possível excluir: " + error.message);
    bioLinks.splice(idx, 1); bioDirtyLinks.delete(id);
    bioRenderLinksList(); bioPreview(); bioUpdateStats();
  }
});

async function bioAddLink() {
  const position = bioLinks.length ? Math.max(...bioLinks.map(l => l.position)) + 1 : 0;
  const { data, error } = await supabase.from("bio_links").insert({ user_id: session.id, position }).select().single();
  if (error) return agendaToast("Não foi possível adicionar: " + error.message);
  bioLinks.push(data);
  bioRenderLinksList();
  const inp = document.querySelector(`[data-lid="${data.id}"] [data-lf="label"]`);
  if (inp) { inp.focus(); inp.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

async function bioSaveSlug(input) {
  const slug = bioSlugify(input.value);
  if (slug === bioPage.slug) { input.value = slug; return; }
  if (slug.length < 3) { input.value = bioPage.slug; return bioStatus("O endereço precisa ter pelo menos 3 caracteres."); }
  const { error } = await supabase.from("bio_pages").update({ slug }).eq("user_id", session.id);
  if (error) { input.value = bioPage.slug; return bioStatus(error.code === "23505" ? "Esse endereço já está em uso. Escolha outro." : "Não foi possível mudar: " + error.message); }
  bioPage.slug = input.value = slug;
  bioStatus("Endereço alterado ✓ (o link antigo deixou de funcionar)");
}

async function bioRemoveHeroFile() {
  if (bioPage.hero_image_path) await supabase.storage.from("bio-images").remove([bioPage.hero_image_path]);
}
async function bioUploadHero(file) {
  if (file.size > 3 * 1024 * 1024) return agendaToast("A imagem passa de 3 MB. Escolha uma menor.");
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
  if (!ext) return agendaToast("Use uma imagem JPG, PNG ou WebP.");
  bioStatus("Enviando imagem…");
  const path = `${session.id}/destaque-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("bio-images").upload(path, file, { contentType: file.type, upsert: false });
  if (error) return bioStatus("Não foi possível enviar a imagem: " + error.message);
  await bioRemoveHeroFile();
  bioPage.hero_image_path = path; bioDirtyPage = true;
  bioRenderHeroBlock(); bioPreview(); bioQueueSave();
}
