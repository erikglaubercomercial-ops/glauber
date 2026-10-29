/* ============================================================
   ÁREA DO ALUNO › VÍDEOS (CRM, só ADM). Cadastro dos vídeos do YouTube que aparecem na tela Aulas de Inglês do painel dos
   alunos matriculados — os mesmos para todos. Guarda só o código do vídeo; o link é reconhecido aqui.
   Dica: o vídeo deve estar como "Não listado" no YouTube ("Privado" não toca fora do YouTube).
   Depende de script.js: session, supabase, escapeHtml, agendaToast.
   ============================================================ */
const av = { list: [], loaded: false, editing: null };
const avEsc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s));
const avThumb = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const avToast = m => (typeof agendaToast === "function" ? agendaToast(m) : null);
const AV_BUCKET = "aluno-materiais";
const AV_MAX_BYTES = 50 * 1024 * 1024;
const AV_EXT_OK = /\.(pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|webp|txt)$/i;
const avSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const avSafeName = n => String(n || "arquivo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
/* apaga o arquivo do armazenamento, se mais nenhum vídeo usa esse mesmo caminho */
async function avRemoveFile(path, exceptId) {
  if (!path || av.list.some(v => v.id !== exceptId && v.material_path === path)) return;
  try { await supabase.storage.from(AV_BUCKET).remove([path]); } catch (e) { console.error("Erro ao apagar material:", e); }
}

/* aceita watch?v=, youtu.be/, /embed/, /shorts/, /live/ ou o próprio código de 11 caracteres */
function avYoutubeId(input) {
  const s = String(input || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.split("/")[1] || "";
    else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
      else { const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?]+)/); if (m) id = m[2]; }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch (e) { return ""; }
}

async function avLoad() {
  const { data, error } = await supabase.from("aluno_videos").select("*").order("ordem", { ascending: true }).order("created_at", { ascending: true });
  if (error) { console.error("Erro ao carregar vídeos:", error); return false; }
  av.list = data || []; av.loaded = true; return true;
}

function avEnsureModal() {
  if (document.getElementById("av-modal-backdrop")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <div class="modal-backdrop" id="av-modal-backdrop"><div class="modal">
    <div class="modal-header"><h2 id="av-modal-title">Novo vídeo</h2><button class="btn-icon" id="av-modal-close" type="button">&times;</button></div>
    <form id="av-form">
      <label><span>Título</span><input type="text" id="av-title" maxlength="120" required placeholder="Ex.: Como funciona a chegada em Dublin"></label>
      <label><span>Link do vídeo no YouTube</span><input type="text" id="av-url" required placeholder="https://www.youtube.com/watch?v=…"></label>
      <div id="av-preview" class="av-preview" hidden></div>
      <p class="muted-note">No YouTube, deixe o vídeo como <b>Não listado</b>. Assim só abre quem tem o link, e o aluno o vê dentro da Área do Aluno. Vídeo <b>Privado</b> não toca aqui. Quem copiar o link de um vídeo não listado consegue assisti-lo fora do sistema.</p>
      <label><span>Descrição (opcional)</span><textarea id="av-desc" rows="2" maxlength="400" placeholder="Uma frase explicando o vídeo"></textarea></label>
      <div class="av-material">
        <label><span>Material de apoio para baixar (opcional)</span><input type="file" id="av-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg,.webp,.txt"></label>
        <div id="av-file-current" class="av-file-current" hidden></div>
        <p class="muted-note">Aparece como botão <b>Baixar material de apoio</b> embaixo do vídeo. PDF, Word, Excel, PowerPoint, imagem ou ZIP, até 50 MB. Só alunos matriculados conseguem baixar.</p>
      </div>
      <div class="grid-2">
        <label><span>Ordem (menor aparece primeiro)</span><input type="number" id="av-ordem" step="1" value="0"></label>
        <label class="av-check"><input type="checkbox" id="av-ativo" checked><span>Visível para os alunos</span></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-danger" id="av-delete" style="display:none;">Excluir</button>
        <button type="button" class="btn btn-ghost" id="av-dup" style="display:none;">Duplicar</button>
        <div class="spacer"></div>
        <button type="button" class="btn btn-ghost" id="av-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form></div></div>`;
  document.body.appendChild(wrap.firstElementChild);
  const $ = i => document.getElementById(i);
  const close = () => $("av-modal-backdrop").classList.remove("open");
  ["av-modal-close", "av-cancel"].forEach(i => $(i).addEventListener("click", close));
  $("av-modal-backdrop").addEventListener("click", e => { if (e.target.id === "av-modal-backdrop") close(); });
  $("av-url").addEventListener("input", () => {
    const id = avYoutubeId($("av-url").value), box = $("av-preview");
    box.hidden = !$("av-url").value.trim();
    box.innerHTML = id ? `<img src="${avThumb(id)}" alt=""><span>✅ Vídeo reconhecido</span>` : `<span class="bad">Não reconheci este link do YouTube.</span>`;
  });

  const save = async asNew => {
    const id = avYoutubeId($("av-url").value);
    const title = $("av-title").value.trim();
    if (!title) { alert("Informe o título do vídeo."); return false; }
    if (!id) { alert("Cole um link válido do YouTube (youtube.com/watch?v=…, youtu.be/… ou /shorts/…)."); return false; }
    const row = { title, description: $("av-desc").value.trim(), youtube_id: id, ordem: parseInt($("av-ordem").value, 10) || 0, ativo: $("av-ativo").checked };
    const editingId = av.editing && !asNew ? av.editing : null;
    if (editingId) row.id = editingId;
    const cur = editingId ? av.list.find(v => v.id === editingId) : null;
    let oldPath = null;

    /* material de apoio: novo arquivo, remover o atual ou manter */
    const file = $("av-file").files[0];
    if (file) {
      if (file.size > AV_MAX_BYTES) { alert("O arquivo passa de 50 MB."); return false; }
      if (!AV_EXT_OK.test(file.name)) { alert("Tipo de arquivo não aceito. Use PDF, Word, Excel, PowerPoint, imagem ou ZIP."); return false; }
      const path = `${crypto.randomUUID()}/${avSafeName(file.name)}`;
      const up = await supabase.storage.from(AV_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) { console.error(up.error); alert("Não foi possível enviar o arquivo."); return false; }
      Object.assign(row, { material_path: path, material_name: file.name, material_size: file.size });
      oldPath = cur ? cur.material_path : null;
    } else if (av.removeMaterial && cur) {
      Object.assign(row, { material_path: null, material_name: null, material_size: null });
      oldPath = cur.material_path;
    } else if (asNew && av.editing) {
      /* duplicar: copia o arquivo para um caminho novo, para apagar um vídeo não apagar o material do outro */
      const src = av.list.find(v => v.id === av.editing);
      if (src && src.material_path) {
        const np = `${crypto.randomUUID()}/${avSafeName(src.material_name)}`;
        const cp = await supabase.storage.from(AV_BUCKET).copy(src.material_path, np);
        if (!cp.error) Object.assign(row, { material_path: np, material_name: src.material_name, material_size: src.material_size });
      }
    }
    const { error } = await supabase.from("aluno_videos").upsert(row);
    if (error) {
      console.error(error);
      if (row.material_path && file) { try { await supabase.storage.from(AV_BUCKET).remove([row.material_path]); } catch (e) { /* sobra no armazenamento, sem efeito */ } }
      alert("Não foi possível salvar o vídeo."); return false;
    }
    await avLoad(); avRender();
    if (oldPath) await avRemoveFile(oldPath, null);
    return true;
  };
  $("av-form").addEventListener("submit", async e => { e.preventDefault(); if (await save(false)) { close(); avToast("Vídeo salvo"); } });
  $("av-dup").addEventListener("click", async () => {
    $("av-title").value = `${$("av-title").value} (cópia)`;
    if (await save(true)) { close(); avToast("Vídeo duplicado"); }
  });
  $("av-delete").addEventListener("click", async () => {
    if (!av.editing || !confirm("Excluir este vídeo? Ele some da Área do Aluno.")) return;
    const gone = av.list.find(v => v.id === av.editing);
    const { error } = await supabase.from("aluno_videos").delete().eq("id", av.editing);
    if (error) { alert("Não foi possível excluir."); return; }
    await avLoad(); avRender(); close(); avToast("Vídeo excluído");
    if (gone && gone.material_path) await avRemoveFile(gone.material_path, null);
  });
}

function avOpen(id) {
  avEnsureModal();
  const $ = i => document.getElementById(i);
  const v = id ? av.list.find(x => x.id === id) : null;
  av.editing = v ? v.id : null;
  $("av-modal-title").textContent = v ? "Editar vídeo" : "Novo vídeo";
  $("av-title").value = v ? v.title : "";
  $("av-url").value = v ? `https://www.youtube.com/watch?v=${v.youtube_id}` : "";
  $("av-desc").value = v ? v.description : "";
  $("av-ordem").value = v ? v.ordem : (av.list.reduce((m, x) => Math.max(m, x.ordem), 0) + 10);
  $("av-ativo").checked = v ? v.ativo : true;
  av.removeMaterial = false;
  $("av-file").value = "";
  const cur = $("av-file-current");
  if (v && v.material_path) {
    cur.hidden = false;
    cur.innerHTML = `📎 <b>${avEsc(v.material_name || "arquivo")}</b> (${avSize(v.material_size || 0)}) <button type="button" class="btn btn-ghost btn-sm" id="av-file-remove">Remover</button> <span class="muted-note">Para trocar, escolha outro arquivo acima.</span>`;
    document.getElementById("av-file-remove").addEventListener("click", () => { av.removeMaterial = true; cur.innerHTML = `<span class="muted-note">O material será removido ao salvar.</span>`; });
  } else { cur.hidden = true; cur.innerHTML = ""; }
  $("av-delete").style.display = v ? "" : "none";
  $("av-dup").style.display = v ? "" : "none";
  $("av-url").dispatchEvent(new Event("input"));
  $("av-modal-backdrop").classList.add("open");
}

function avRender() {
  const box = document.getElementById("av-admin");
  if (!box) return;
  box.innerHTML = av.list.length ? `
    <table class="data-table">
      <thead><tr><th></th><th>Título</th><th>Ordem</th><th>Situação</th><th></th></tr></thead>
      <tbody>${av.list.map(v => `
        <tr class="av-row${v.ativo ? "" : " is-off"}">
          <td><img class="av-thumb" src="${avThumb(v.youtube_id)}" alt=""></td>
          <td class="cell-primary">${avEsc(v.title)}${v.material_path ? ` <span class="av-clip" title="${avEsc(v.material_name || "")}">📎</span>` : ""}${v.description ? `<small class="av-desc">${avEsc(v.description)}</small>` : ""}</td>
          <td class="cell-muted">${v.ordem}</td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-av-vis="${v.id}">${v.ativo ? "👁 Visível" : "🚫 Oculto"}</button></td>
          <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-av-edit="${v.id}">Editar</button> <button type="button" class="btn btn-ghost btn-sm" data-av-dup="${v.id}">Duplicar</button></td>
        </tr>`).join("")}</tbody>
    </table>` : `<div class="empty-hint">Nenhum vídeo cadastrado ainda. Clique em "+ Novo vídeo".</div>`;
}

async function renderAreaAlunoAdmin() {
  const isAdm = !!session && session.role === "ADM";
  const admin = document.getElementById("av-admin-wrap"), soon = document.getElementById("av-placeholder");
  if (!admin || !soon) return;
  admin.hidden = !isAdm; soon.hidden = isAdm;
  if (!isAdm) return;
  if (!av.loaded) await avLoad();
  avRender();
}

document.addEventListener("click", async e => {
  if (e.target.closest("#av-new")) { avOpen(null); return; }
  const ed = e.target.closest("[data-av-edit]"); if (ed) { avOpen(ed.dataset.avEdit); return; }
  const du = e.target.closest("[data-av-dup]");
  if (du) {
    const v = av.list.find(x => x.id === du.dataset.avDup); if (!v) return;
    const row = { title: `${v.title} (cópia)`, description: v.description, youtube_id: v.youtube_id, ordem: v.ordem + 1, ativo: v.ativo };
    if (v.material_path) {
      const np = `${crypto.randomUUID()}/${avSafeName(v.material_name)}`;
      const cp = await supabase.storage.from(AV_BUCKET).copy(v.material_path, np);
      if (!cp.error) Object.assign(row, { material_path: np, material_name: v.material_name, material_size: v.material_size });
    }
    const { error } = await supabase.from("aluno_videos").insert(row);
    if (error) { alert("Não foi possível duplicar."); return; }
    await avLoad(); avRender(); avToast("Vídeo duplicado"); return;
  }
  const vis = e.target.closest("[data-av-vis]");
  if (vis) {
    const v = av.list.find(x => x.id === vis.dataset.avVis); if (!v) return;
    v.ativo = !v.ativo; avRender();
    const { error } = await supabase.from("aluno_videos").update({ ativo: v.ativo }).eq("id", v.id);
    if (error) { v.ativo = !v.ativo; avRender(); alert("Não foi possível alterar."); }
  }
});
