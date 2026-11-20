/* ============================================================
   PIPELINE DE PÓS-VENDA (menu Pós-venda)
   Pipeline separada da pipeline de vendas. Etapas e itens configuráveis.
   Quem vê: ADM, Gerente, Suporte e Sócio. Quem altera: ADM, Gerente e Suporte.
   O aluno entra na pipeline quando a primeira parcela (matrícula) é paga (banco).
   Depende de script.js (session, supabase, escapeHtml, isSocioSession).
   ============================================================ */

let pvData = null;          /* { etapas: [...], alunos: [...] } vindo de pv_listar */
let pvSel = null;           /* enrollment_id do aluno selecionado */
let pvEdit = null;          /* null | { id: etapa id ou null } */
let pvBusy = false;
let pvQuery = "";           /* busca por nome do aluno (mesma ideia da busca do Pipeline de vendas) */

const pvCanView = () => !!session && (["ADM", "Gerente", "Suporte"].includes(session.role) || isSocioSession());
const pvCanEdit = () => !!session && ["ADM", "Gerente", "Suporte"].includes(session.role);

/* cor da etapa: mesma escala do Pipeline de vendas (azul no início → vermelho no fim),
   usando STAGE_COLOR_START / STAGE_COLOR_END definidos em script.js */
function pvStageColor(i, n) {
  const t = n <= 1 ? 0 : i / (n - 1);
  const mix = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${mix(STAGE_COLOR_START.r, STAGE_COLOR_END.r)}, ${mix(STAGE_COLOR_START.g, STAGE_COLOR_END.g)}, ${mix(STAGE_COLOR_START.b, STAGE_COLOR_END.b)})`;
}

function pvYmd(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function pvDateBR(s) {
  const d = pvYmd(s);
  return d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : "";
}
function pvDaysUntil(s) {
  const d = pvYmd(s);
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

/* alertas calculados a partir dos dados do aluno */
function pvAlerts(a) {
  const out = [];
  const arrival = pvYmd(a.arrival_date);
  const expiry = pvYmd(a.passport_expiry_date);
  if (arrival && expiry) {
    const limite = new Date(arrival.getFullYear(), arrival.getMonth() + 6, arrival.getDate());
    if (expiry < limite) out.push(["d", "Passaporte vence antes de 6 meses da chegada"]);
  }
  const dias = pvDaysUntil(a.arrival_date);
  if (dias !== null && dias >= 0 && dias <= 45) {
    if (!a.pre_embark_at) out.push(["w", "Reunião a agendar"]);
    if (!a.arrival_time) out.push(["w", "Voo sem horário"]);
  }
  return out;
}

function pvEtapaIndex(etapaId) {
  return pvData ? pvData.etapas.findIndex(e => e.id === etapaId) : -1;
}

function pvErrorText(error) {
  const msg = (error && error.message) || "";
  if (msg.includes("sem_permissao")) return "Você não tem permissão para alterar a pipeline de pós-venda.";
  if (msg.includes("etapa_com_alunos")) return "Esta etapa tem alunos. Escolha para qual etapa eles vão antes de excluir.";
  if (msg.includes("nome_obrigatorio")) return "Informe o nome da etapa.";
  if (msg.includes("item_de_outra_etapa")) return "Este item não pertence à etapa atual do aluno. Atualize a tela.";
  return "Não foi possível salvar. Tente de novo.";
}

async function pvLoad() {
  const { data, error } = await supabase.rpc("pv_listar");
  if (error) { console.error("Erro ao carregar pós-venda:", error); pvData = null; return false; }
  pvData = data || { etapas: [], alunos: [] };
  return true;
}

async function renderPosVenda() {
  if (!pvCanView()) return;
  const note = document.getElementById("pv-note");
  note.textContent = pvCanEdit()
    ? "Marque os itens de cada aluno. Ao concluir todos os itens de uma etapa, o aluno avança para a próxima."
    : "Você pode acompanhar os alunos. Só ADM, Gerente e Suporte alteram.";
  document.getElementById("pv-new").style.display = pvCanEdit() ? "" : "none";
  if (!pvData) document.getElementById("pv-board").innerHTML = `<p class="muted-note">Carregando…</p>`;
  if (!(await pvLoad()) && !pvData) {
    document.getElementById("pv-board").innerHTML = `<p class="muted-note">Não foi possível carregar a pipeline agora.</p>`;
    return;
  }
  pvRender();
}

async function pvReload() {
  await pvLoad();
  pvRender();
}

function pvRender() {
  if (!pvData) return;
  const { etapas, alunos } = pvData;
  const canEdit = pvCanEdit();
  document.getElementById("pv-count").textContent = `${alunos.length} aluno(s) em pós-venda`;
  const q = pvQuery.toLowerCase();
  const visiveis = q ? alunos.filter(a => String(a.name || "").toLowerCase().includes(q)) : alunos;

  if (!etapas.length) {
    document.getElementById("pv-board").innerHTML = `<p class="muted-note">Nenhuma etapa cadastrada.</p>`;
  } else {
    document.getElementById("pv-board").innerHTML = etapas.map((e, i) => {
      const cards = visiveis.filter(a => a.etapa_id === e.id).sort((x, y) => String(x.name).localeCompare(String(y.name)));
      return `
        <div class="column" style="--stage-color:${pvStageColor(i, etapas.length)}">
          <div class="column-header">
            <div class="pv-head-t">
              <div class="pv-num">Etapa ${i + 1}</div>
              <div class="pv-name">${escapeHtml(e.nome)}</div>
            </div>
            <div class="pv-head-r">
              <span class="column-count">${cards.length}</span>
              ${canEdit ? `<button type="button" class="btn btn-ghost btn-sm pv-edit-btn" data-pv-act="edit-step" data-id="${e.id}">Editar</button>` : ""}
            </div>
          </div>
          <div class="column-value">${escapeHtml(e.responsavel)}</div>
          <div class="column-cards" data-pv-etapa="${e.id}">
            ${cards.map(a => pvCardHtml(a, e)).join("") || `<div class="empty-hint">${q ? "Nenhum aluno encontrado" : "Nenhum aluno nesta etapa"}</div>`}
          </div>
        </div>`;
    }).join("");
  }

  pvRenderDetail();
  pvRenderEditPanel();
}

function pvCardHtml(a, e) {
  const total = e.itens.length;
  const feitos = a.feitos.filter(id => e.itens.some(i => i.id === id)).length;
  const pct = total ? Math.round(feitos / total * 100) : 0;
  const alerts = pvAlerts(a);
  const sub = [a.school, a.turno].filter(Boolean).join(" · ");
  const chegada = a.arrival_date ? `Chegada ${pvDateBR(a.arrival_date)}${a.arrival_time ? " · " + String(a.arrival_time).slice(0, 5) : ""}` : "Chegada a informar";
  return `
    <div class="card pv-card${pvSel === a.enrollment_id ? " sel" : ""}" data-pv-card="${a.enrollment_id}" draggable="${pvCanEdit() ? "true" : "false"}">
      <div class="card-name">${escapeHtml(a.name || "—")}</div>
      <div class="card-meta">${escapeHtml(sub || "—")}</div>
      <div class="card-contact-row"><span>${escapeHtml(chegada)}</span></div>
      ${alerts.length ? `<div class="card-tags">${alerts.map(([k, txt]) => `<span class="badge ${k === "d" ? "badge-danger" : "badge-warn"}">${escapeHtml(txt)}</span>`).join("")}</div>` : ""}
      <div class="pv-bar"><i style="width:${pct}%"></i></div>
      <div class="card-footer"><span class="card-value">${feitos} de ${total} itens</span></div>
    </div>`;
}

function pvRenderDetail() {
  const box = document.getElementById("pv-det");
  const a = pvSel ? pvData.alunos.find(x => x.enrollment_id === pvSel) : null;
  if (!a) {
    box.innerHTML = `<p class="muted-note" style="margin:0">Clique em um aluno para ver os itens da etapa dele.</p>`;
    return;
  }
  const idx = pvEtapaIndex(a.etapa_id);
  const e = pvData.etapas[idx];
  const canEdit = pvCanEdit();
  const chegada = a.arrival_date ? `Chegada ${pvDateBR(a.arrival_date)}${a.arrival_time ? " às " + String(a.arrival_time).slice(0, 5) : ""}` : "Chegada a informar";
  const outras = pvData.etapas.filter(x => x.id !== a.etapa_id);
  box.innerHTML = `
    <div class="pv-det-head">
      <div>
        <h3>${escapeHtml(a.name || "—")}</h3>
        <p>${escapeHtml([a.school, a.turno].filter(Boolean).join(" · ") || "—")} · ${escapeHtml(chegada)}</p>
      </div>
      <span class="pv-chip-step">Etapa ${idx + 1}: ${escapeHtml(e ? e.nome : "—")}</span>
    </div>
    ${e && e.itens.length ? e.itens.map(it => {
      const done = a.feitos.includes(it.id);
      return `<label class="pv-it">
        <input type="checkbox" data-pv-item="${it.id}" ${done ? "checked" : ""} ${canEdit && !pvBusy ? "" : "disabled"}>
        <span class="${done ? "pv-done" : ""}">${escapeHtml(it.texto)}</span>
      </label>`;
    }).join("") : `<p class="muted-note" style="margin:0">Esta etapa ainda não tem itens. Edite a etapa para incluir.</p>`}
    ${canEdit && outras.length ? `
      <div class="pv-move">
        <span>Mover para outra etapa</span>
        <select id="pv-move-sel">${outras.map(x => `<option value="${x.id}">${escapeHtml(x.nome)}</option>`).join("")}</select>
        <button type="button" class="btn btn-ghost btn-sm" data-pv-act="move">Mover</button>
      </div>` : ""}`;
}

/* ---- criar, editar e excluir etapas ---- */
function pvOpenEdit(id) {
  pvEdit = { id: id || null };
  const panel = document.getElementById("pv-edit");
  const e = id ? pvData.etapas.find(x => x.id === id) : null;
  const alunos = e ? pvData.alunos.filter(a => a.etapa_id === e.id).length : 0;
  panel.hidden = false;
  panel.innerHTML = `
    <h3>${e ? "Editar etapa" : "Nova etapa"}</h3>
    <p class="q-card-sub">${e ? "As mudanças valem para todos os alunos desta etapa." : "A etapa entra no fim do quadro."}</p>
    <div class="pv-form">
      <label>Nome da etapa<input type="text" id="pv-f-nome" value="${escapeHtml(e ? e.nome : "")}"></label>
      <label>Responsável<input type="text" id="pv-f-resp" list="pv-resp-list" value="${escapeHtml(e ? e.responsavel : "a definir")}"></label>
      <label>Itens (um por linha)<textarea id="pv-f-itens" rows="5">${escapeHtml(e ? e.itens.map(i => i.texto).join("\n") : "")}</textarea></label>
      <p class="q-card-sub" style="margin:0">Itens que você tirar da lista somem para todos os alunos. Se trocar o texto de um item, a marcação feita nele é perdida.</p>
    </div>
    <div class="pv-move-del" id="pv-del-box" hidden></div>
    <div class="pv-acts">
      ${e ? `<button type="button" class="btn btn-danger btn-sm" data-pv-act="del-step" data-id="${e.id}" data-alunos="${alunos}">Excluir etapa</button>` : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-pv-act="cancel-edit">Cancelar</button>
      <button type="button" class="btn btn-primary btn-sm" data-pv-act="save-step">Salvar</button>
    </div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function pvRenderEditPanel() {
  const panel = document.getElementById("pv-edit");
  if (!pvEdit) { panel.hidden = true; panel.innerHTML = ""; }
}

function pvCloseEdit() {
  pvEdit = null;
  pvRenderEditPanel();
}

function pvItensFromText(texto, existentes) {
  const usados = new Set();
  return texto.split("\n").map(l => l.trim()).filter(Boolean).map(t => {
    const igual = existentes.find(i => i.texto === t && !usados.has(i.id));
    if (igual) { usados.add(igual.id); return { id: igual.id, texto: t }; }
    return { texto: t };
  });
}

async function pvSaveEdit() {
  if (pvBusy) return;
  const nome = document.getElementById("pv-f-nome").value.trim();
  const resp = document.getElementById("pv-f-resp").value.trim() || "a definir";
  if (!nome) { alert("Informe o nome da etapa."); return; }
  const existente = pvEdit.id ? pvData.etapas.find(x => x.id === pvEdit.id) : null;
  const itens = pvItensFromText(document.getElementById("pv-f-itens").value, existente ? existente.itens : []);
  pvBusy = true;
  const { error } = await supabase.rpc("pv_etapa_salvar", { p_id: pvEdit.id, p_nome: nome, p_responsavel: resp, p_itens: itens });
  pvBusy = false;
  if (error) { console.error(error); alert(pvErrorText(error)); return; }
  pvCloseEdit();
  await pvReload();
}

async function pvDeleteStep(id, alunos) {
  if (pvBusy) return;
  const e = pvData.etapas.find(x => x.id === id);
  const box = document.getElementById("pv-del-box");
  let moverPara = null;
  if (alunos > 0) {
    const outras = pvData.etapas.filter(x => x.id !== id);
    if (!outras.length) { alert("Não é possível excluir a última etapa enquanto houver alunos nela."); return; }
    if (box.hidden || !box.dataset.ok) {
      box.hidden = false;
      box.innerHTML = `<p class="q-card-sub" style="margin:0">Esta etapa tem ${alunos} aluno(s). Para onde eles vão?</p>
        <select id="pv-del-dest">${outras.map(x => `<option value="${x.id}">${escapeHtml(x.nome)}</option>`).join("")}</select>
        <button type="button" class="btn btn-danger btn-sm" data-pv-act="del-step" data-id="${id}" data-alunos="${alunos}" data-ok="1">Confirmar exclusão</button>`;
      box.dataset.ok = "1";
      return;
    }
    moverPara = document.getElementById("pv-del-dest").value;
  } else if (!confirm(`Excluir a etapa "${e.nome}"? Os itens dela também são removidos.`)) {
    return;
  }
  pvBusy = true;
  const { error } = await supabase.rpc("pv_etapa_excluir", { p_id: id, p_mover_para: moverPara });
  pvBusy = false;
  if (error) { console.error(error); alert(pvErrorText(error)); return; }
  pvSel = null;
  pvCloseEdit();
  await pvReload();
}

/* ---- ações sobre o aluno ---- */
async function pvToggleItem(itemId, feito) {
  if (pvBusy || !pvSel) return;
  pvBusy = true;
  const { error } = await supabase.rpc("pv_marcar_item", { p_enrollment: pvSel, p_item: itemId, p_feito: feito });
  pvBusy = false;
  if (error) { console.error(error); alert(pvErrorText(error)); }
  await pvReload();
}

async function pvMoveAluno() {
  const sel = document.getElementById("pv-move-sel");
  if (pvBusy || !sel || !pvSel) return;
  pvBusy = true;
  const { error } = await supabase.rpc("pv_mover_aluno", { p_enrollment: pvSel, p_etapa: sel.value });
  pvBusy = false;
  if (error) { console.error(error); alert(pvErrorText(error)); return; }
  await pvReload();
}

/* ---- arrastar aluno para outra etapa (mesmo gesto do Pipeline de vendas) ---- */
async function pvMoveTo(enrollmentId, etapaId) {
  if (pvBusy || !pvCanEdit() || !enrollmentId || !etapaId) return;
  const a = pvData.alunos.find(x => x.enrollment_id === enrollmentId);
  if (!a || a.etapa_id === etapaId) return;
  pvBusy = true;
  const { error } = await supabase.rpc("pv_mover_aluno", { p_enrollment: enrollmentId, p_etapa: etapaId });
  pvBusy = false;
  if (error) { console.error(error); alert(pvErrorText(error)); }
  await pvReload();
}

function pvBind() {
  const root = document.getElementById("view-posvenda");
  if (!root) return;

  root.addEventListener("dragstart", e => {
    const card = e.target.closest("[data-pv-card]");
    if (!card || !pvCanEdit()) return;
    e.dataTransfer.setData("text/plain", card.dataset.pvCard);
    e.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => card.classList.add("dragging"));
  });
  root.addEventListener("dragend", () => {
    root.querySelectorAll(".dragging").forEach(el => el.classList.remove("dragging"));
    root.querySelectorAll(".column-cards.drag-over").forEach(el => el.classList.remove("drag-over"));
  });
  root.addEventListener("dragover", e => {
    const zone = e.target.closest("[data-pv-etapa]");
    if (!zone || !pvCanEdit()) return;
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  root.addEventListener("dragleave", e => {
    const zone = e.target.closest("[data-pv-etapa]");
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove("drag-over");
  });
  root.addEventListener("drop", e => {
    const zone = e.target.closest("[data-pv-etapa]");
    if (!zone || !pvCanEdit()) return;
    e.preventDefault();
    zone.classList.remove("drag-over");
    pvMoveTo(e.dataTransfer.getData("text/plain"), zone.dataset.pvEtapa);
  });

  document.getElementById("pv-new").addEventListener("click", () => { if (pvCanEdit()) pvOpenEdit(null); });
  document.getElementById("pv-search-input").addEventListener("input", e => { pvQuery = e.target.value.trim(); pvRender(); });

  root.addEventListener("click", e => {
    const card = e.target.closest("[data-pv-card]");
    if (card) { pvSel = card.dataset.pvCard; pvRender(); return; }
    const b = e.target.closest("[data-pv-act]");
    if (!b || !pvCanEdit()) return;
    const act = b.dataset.pvAct;
    if (act === "edit-step") pvOpenEdit(b.dataset.id);
    else if (act === "save-step") pvSaveEdit();
    else if (act === "cancel-edit") pvCloseEdit();
    else if (act === "del-step") pvDeleteStep(b.dataset.id, Number(b.dataset.alunos) || 0);
    else if (act === "move") pvMoveAluno();
  });

  root.addEventListener("change", e => {
    const cb = e.target.closest("[data-pv-item]");
    if (cb && pvCanEdit()) pvToggleItem(cb.dataset.pvItem, cb.checked);
  });
}

pvBind();
