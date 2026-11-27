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
  if (msg.includes("aluno_ja_no_quadro")) return "Este aluno já tem card no quadro. Atualize a tela.";
  if (msg.includes("matricula_nao_encontrada")) return "Matrícula não encontrada.";
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
  document.getElementById("pv-add-card").style.display = pvCanEdit() ? "" : "none";
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
        <div class="column pv-list" style="--stage-color:${pvStageColor(i, etapas.length)}">
          <div class="pv-list-head" title="Responsável: ${escapeHtml(e.responsavel)}">
            <div class="pv-name">${escapeHtml(e.nome)}</div>
            <span class="pv-list-count">${cards.length}</span>
            ${canEdit ? `<button type="button" class="pv-list-menu" data-pv-act="edit-step" data-id="${e.id}" title="Editar etapa" aria-label="Editar etapa">&#8943;</button>` : ""}
          </div>
          <div class="column-cards" data-pv-etapa="${e.id}">
            ${cards.map(a => pvCardHtml(a, e)).join("") || (q ? `<div class="empty-hint">Nenhum aluno encontrado</div>` : "")}
          </div>
          ${canEdit ? `<button type="button" class="pv-list-add" data-pv-act="add-card" data-id="${e.id}">+ Adicionar um cartão</button>` : ""}
        </div>`;
    }).join("");
  }

  pvRenderDetail();
  pvRenderEditPanel();
  pvSyncModal();
}

/* checklist acumulado: itens da etapa atual e de todas as anteriores (as marcações ficam no card quando ele avança) */
function pvChecklist(a) {
  const idx = pvEtapaIndex(a.etapa_id);
  const grupos = idx < 0 ? [] : pvData.etapas.slice(0, idx + 1).map(e => ({ e })).filter(g => g.e.itens.length);
  const itens = grupos.flatMap(g => g.e.itens);
  return { grupos, total: itens.length, feitos: itens.filter(it => a.feitos.includes(it.id)).length };
}
function pvGrupoRotulo(g, grupos) {
  return grupos.length > 1 ? `<div class="pv-grp">${escapeHtml(g.e.nome)}</div>` : "";
}

function pvCardHtml(a, e) {
  const cl = pvChecklist(a);
  const total = cl.total, feitos = cl.feitos;
  const alerts = pvAlerts(a);
  const sub = [a.school, a.turno].filter(Boolean).join(" · ");
  const chegada = a.arrival_date ? pvDateBR(a.arrival_date).slice(0, 5) : "";
  const completo = total > 0 && feitos === total;
  const ico = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><polyline points="8 12 11 15 16 9"/></svg>`;
  const cal = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  return `
    <div class="card pv-card${pvSel === a.enrollment_id ? " sel" : ""}" data-pv-card="${a.enrollment_id}" draggable="${pvCanEdit() ? "true" : "false"}">
      <span class="pv-label"></span>
      <div class="pv-card-title">${escapeHtml(a.name || "—")}</div>
      ${sub ? `<div class="pv-card-sub">${escapeHtml(sub)}</div>` : ""}
      <div class="pv-badges">
        ${total ? `<span class="pv-badge${completo ? " ok" : ""}" title="Itens concluídos">${ico}${feitos}/${total}</span>` : ""}
        ${chegada ? `<span class="pv-badge" title="Chegada${a.arrival_time ? " " + escapeHtml(String(a.arrival_time).slice(0, 5)) : ""}">${cal}${chegada}</span>` : ""}
        ${alerts.map(([k, txt]) => `<span class="pv-badge ${k === "d" ? "bad" : "warn"}">${escapeHtml(txt)}</span>`).join("")}
      </div>
    </div>`;
}

/* detalhe do card e edição de etapa abrem como janela (como o cartão do Trello) */
function pvSyncModal() {
  const det = document.getElementById("pv-det"), ed = document.getElementById("pv-edit"), back = document.getElementById("pv-back");
  const detOpen = !!pvSel && !!pvData && pvData.alunos.some(x => x.enrollment_id === pvSel);
  det.hidden = !detOpen;
  const edOpen = !!pvEdit;
  back.hidden = !(detOpen || edOpen);
  document.documentElement.classList.toggle("pv-modal-open", detOpen || edOpen);
}
function pvCloseAll() { pvSel = null; pvEdit = null; pvRender(); }

function pvRenderDetail() {
  const box = document.getElementById("pv-det");
  const a = pvSel ? pvData.alunos.find(x => x.enrollment_id === pvSel) : null;
  if (!a) { box.innerHTML = ""; return; }
  const idx = pvEtapaIndex(a.etapa_id);
  const e = pvData.etapas[idx];
  const canEdit = pvCanEdit();
  const chegada = a.arrival_date ? `Chegada ${pvDateBR(a.arrival_date)}${a.arrival_time ? " às " + String(a.arrival_time).slice(0, 5) : ""}` : "Chegada a informar";
  const outras = pvData.etapas.filter(x => x.id !== a.etapa_id);
  const cor = idx >= 0 ? pvStageColor(idx, pvData.etapas.length) : "var(--border)";
  box.innerHTML = `
    <button type="button" class="pv-x" data-pv-act="close" aria-label="Fechar">&times;</button>
    <div class="pv-det-head">
      <div>
        <h3>${escapeHtml(a.name || "—")}</h3>
        <p>${escapeHtml([a.school, a.turno].filter(Boolean).join(" · ") || "—")} · ${escapeHtml(chegada)}</p>
      </div>
      <span class="pv-chip-step" style="color:${cor}; border-color:${cor};">Etapa ${idx + 1}: ${escapeHtml(e ? e.nome : "—")}</span>
    </div>
    ${(() => {
      const cl = pvChecklist(a);
      if (!cl.total) return `<p class="muted-note" style="margin:0">Esta etapa ainda não tem itens. Edite a etapa para incluir.</p>`;
      return cl.grupos.map(g => pvGrupoRotulo(g, cl.grupos) + g.e.itens.map(it => {
        const done = a.feitos.includes(it.id);
        return `<div class="pv-it">
          <input type="checkbox" data-pv-item="${it.id}" ${done ? "checked" : ""} ${canEdit && !pvBusy ? "" : "disabled"}>
          <span class="${done ? "pv-done" : ""}" data-pv-rename="${it.id}"${canEdit ? ' title="Clique duas vezes para renomear"' : ""}>${escapeHtml(it.texto)}</span>
        </div>`;
      }).join("")).join("");
    })()}
    ${canEdit && outras.length ? `
      <div class="pv-move">
        <span>Mover para outra etapa</span>
        <select id="pv-move-sel">${outras.map(x => `<option value="${x.id}">${escapeHtml(x.nome)}</option>`).join("")}</select>
        <button type="button" class="btn btn-primary btn-sm" data-pv-act="move">Mover aluno</button>
      </div>` : ""}`;
}

/* ---- criar, editar e excluir etapas ---- */
function pvOpenEdit(id) {
  pvEdit = { id: id || null };
  pvSel = null; pvRenderDetail();
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
  pvSyncModal();
}

/* ---- novo card: coloca no quadro uma matrícula que ainda não está nele ---- */
async function pvOpenAdd(etapaId) {
  if (!pvData || !pvData.etapas.length) { alert("Cadastre uma etapa antes de criar cards."); return; }
  const { data, error } = await supabase.rpc("pv_alunos_disponiveis");
  if (error) { console.error(error); alert(pvErrorText(error)); return; }
  const lista = data || [];
  pvEdit = { add: true };
  pvSel = null; pvRenderDetail();
  const panel = document.getElementById("pv-edit");
  panel.hidden = false;
  const opt = a => {
    const sub = [a.school, a.turno].filter(Boolean).join(" · ");
    return `<option value="${a.enrollment_id}">${escapeHtml(a.name || "—")}${sub ? " — " + escapeHtml(sub) : ""}</option>`;
  };
  panel.innerHTML = `
    <h3>Novo card</h3>
    <p class="q-card-sub">Escolha uma matrícula que ainda não está no quadro. O card entra na etapa escolhida.</p>
    ${lista.length ? `
    <div class="pv-form">
      <label>Aluno (matrícula)<select id="pv-add-aluno">${lista.map(opt).join("")}</select></label>
      <label>Etapa<select id="pv-add-etapa">${pvData.etapas.map((e, i) => `<option value="${e.id}"${e.id === etapaId ? " selected" : ""}>Etapa ${i + 1}: ${escapeHtml(e.nome)}</option>`).join("")}</select></label>
    </div>` : `<p class="muted-note">Todas as matrículas já têm card no quadro. Para um aluno novo, crie primeiro a matrícula no menu Matrículas.</p>`}
    <div class="pv-acts">
      <button type="button" class="btn btn-ghost btn-sm" data-pv-act="cancel-edit">Cancelar</button>
      ${lista.length ? `<button type="button" class="btn btn-primary btn-sm" data-pv-act="add-card-save">Criar card</button>` : ""}
    </div>`;
  pvSyncModal();
}

async function pvSaveAdd() {
  if (pvBusy) return;
  const enr = document.getElementById("pv-add-aluno").value;
  const etapa = document.getElementById("pv-add-etapa").value;
  if (!enr || !etapa) return;
  pvBusy = true;
  const { error } = await supabase.rpc("pv_adicionar_aluno", { p_enrollment: enr, p_etapa: etapa });
  pvBusy = false;
  if (error) { console.error(error); alert(pvErrorText(error)); return; }
  pvSel = enr;
  pvCloseEdit();
  await pvReload();
}

function pvRenderEditPanel() {
  const panel = document.getElementById("pv-edit");
  if (!pvEdit) { panel.hidden = true; panel.innerHTML = ""; }
}

function pvCloseEdit() {
  pvEdit = null;
  pvRenderEditPanel();
  pvSyncModal();
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
/* renomear item com duplo clique: vale para todos os alunos (o item é da etapa); as marcações já feitas continuam */
function pvStartRename(sp) {
  const id = sp.dataset.pvRename;
  const old = sp.textContent;
  const inp = document.createElement("input");
  inp.type = "text"; inp.className = "pv-rename-in"; inp.value = old; inp.maxLength = 300;
  sp.replaceWith(inp);
  inp.focus(); inp.select();
  let fim = false;
  const salvar = async () => {
    if (fim) return;
    fim = true;
    const novo = inp.value.trim();
    if (!novo || novo === old) { pvRender(); return; }
    pvBusy = true;
    const { error } = await supabase.rpc("pv_item_renomear", { p_item: id, p_texto: novo });
    pvBusy = false;
    if (error) { console.error(error); alert(pvErrorText(error)); }
    await pvReload();
  };
  inp.addEventListener("keydown", ev => {
    if (ev.key === "Enter") { ev.preventDefault(); salvar(); }
    else if (ev.key === "Escape") { fim = true; pvRender(); }
  });
  inp.addEventListener("blur", salvar);
}

async function pvToggleItem(itemId, feito, enrollmentId) {
  const enr = enrollmentId || pvSel;
  if (pvBusy || !enr) return;
  pvBusy = true;
  const { error } = await supabase.rpc("pv_marcar_item", { p_enrollment: enr, p_item: itemId, p_feito: feito });
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
  document.getElementById("pv-add-card").addEventListener("click", () => { if (pvCanEdit()) pvOpenAdd(); });
  document.getElementById("pv-search-input").addEventListener("input", e => { pvQuery = e.target.value.trim(); pvRender(); });

  document.getElementById("pv-back").addEventListener("click", pvCloseAll);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && (pvSel || pvEdit) && !e.target.closest(".pv-rename-in")) pvCloseAll();
  });
  root.addEventListener("click", e => {
    if (e.target.closest(".pv-check")) return;  /* marcar item no card não seleciona o aluno */
    const card = e.target.closest("[data-pv-card]");
    if (card) { pvSel = card.dataset.pvCard; pvRender(); return; }
    const b = e.target.closest("[data-pv-act]");
    if (!b || !pvCanEdit()) return;
    const act = b.dataset.pvAct;
    if (act === "edit-step") pvOpenEdit(b.dataset.id);
    else if (act === "save-step") pvSaveEdit();
    else if (act === "add-card-save") pvSaveAdd();
    else if (act === "cancel-edit") pvCloseEdit();
    else if (act === "close") pvCloseAll();
    else if (act === "add-card") pvOpenAdd(b.dataset.id);
    else if (act === "del-step") pvDeleteStep(b.dataset.id, Number(b.dataset.alunos) || 0);
    else if (act === "move") pvMoveAluno();
  });

  root.addEventListener("change", e => {
    const cb = e.target.closest("[data-pv-item]");
    if (cb && pvCanEdit()) {
      /* marcou dentro de um card: vale para o aluno daquele card (não o selecionado embaixo) */
      const card = cb.closest("[data-pv-card]");
      pvToggleItem(cb.dataset.pvItem, cb.checked, card ? card.dataset.pvCard : null);
    }
  });
  root.addEventListener("dblclick", e => {
    const sp = e.target.closest("[data-pv-rename]");
    if (sp && pvCanEdit() && !pvBusy) pvStartRename(sp);
  });
}

pvBind();
