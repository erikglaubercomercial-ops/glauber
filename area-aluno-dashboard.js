/* ============================================================
   DASHBOARD — ÁREA DO ALUNO. Sessão real via Supabase Auth (o
   acesso é criado automaticamente pelo CRM na matrícula). Tudo
   o que aparece vem da matrícula e do Financeiro do próprio aluno:
   escola/turno, datas, passaporte, pagamentos (rpc aluno_financeiro),
   calendário/compromissos e mensagens com a equipe.
   Depende de config.js (variável global `supabase`) e i18n.js.
   ============================================================ */

let alunoSession = null;
let alunoEnr = null;
let alunoFin = null;
let alunoDocsData = null;
let alunoCalMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

const $al = id => document.getElementById(id);
const alunoLocale = () => ({ pt: "pt-BR", en: "en-GB", es: "es-ES" }[getLang()] || "pt-BR");
const alunoEuro = v => "€ " + Number(v || 0).toLocaleString(alunoLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const alunoEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const alunoIsoDate = v => (v ? String(v).slice(0, 10) : "");
const alunoParse = iso => { const [y, m, d] = alunoIsoDate(iso).split("-").map(Number); return new Date(y, m - 1, d); };
const alunoDate = iso => (iso ? alunoParse(iso).toLocaleDateString(alunoLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "");
const alunoTodayIso = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
const alunoDaysUntil = iso => Math.round((alunoParse(iso) - alunoParse(alunoTodayIso())) / 86400000);
const alunoFill = (str, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), str);

/* ---- modo espectador (só ADM): ?ver=<id da matrícula> mostra o portal daquele aluno, só para olhar ---- */
let alunoSpectator = null;   /* id da matrícula vista pelo ADM, ou null no uso normal do aluno */
const alunoRpcArgs = () => (alunoSpectator ? { p_enr: alunoSpectator } : {});

/* ---- carregamento ---- */
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "area-aluno-login.html"; return; }
  alunoSession = session;

  const verParam = new URLSearchParams(window.location.search).get("ver");
  if (verParam) {
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
    if (!prof || prof.role !== "ADM") {
      document.body.innerHTML = '<p style="font-family:sans-serif;padding:40px;text-align:center">Só o ADM pode ver o portal de um aluno como espectador.</p>';
      return;
    }
    alunoSpectator = verParam;
    alunoEnterSpectatorMode();
  }

  const { data: enr, error: enrError } = await supabase.rpc("aluno_matricula", alunoRpcArgs());
  if (enrError) console.error("Erro ao carregar matrícula:", enrError);
  alunoEnr = enr || null;

  const fullName = (enr && enr.name) || session.user.user_metadata?.name || session.user.email;
  const firstName = fullName.split(" ")[0];
  const initials = fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "--";
  document.querySelectorAll("[data-aluno-name]").forEach(el => { el.textContent = fullName; });
  document.querySelectorAll("[data-aluno-firstname]").forEach(el => { el.textContent = firstName; });
  document.querySelectorAll("[data-aluno-initials]").forEach(el => { el.textContent = initials; });

  renderAlunoAll();
  loadAlunoMessages();
  loadAlunoDocs();
  loadAlunoVideos();
  loadAlunoProofs();

  const { data: fin, error } = await supabase.rpc("aluno_financeiro", alunoRpcArgs());
  if (error) console.error("Erro ao carregar pagamentos:", error);
  else { alunoFin = fin; renderAlunoAll(); }
})();

document.getElementById("aluno-btn-signout").addEventListener("click", async () => {
  /* espectador: nunca encerra a sessão do ADM — só fecha esta aba (ou volta ao CRM) */
  if (alunoSpectator) { window.close(); setTimeout(() => { window.location.href = "index.html"; }, 200); return; }
  await supabase.auth.signOut();
  window.location.href = "area-aluno-login.html";
});

/* vitrine: quantas aulas couberem na largura da tela, numa linha só (miniaturas grandes) */
let alunoShowcaseVideos = [], alunoVideosAll = [], alunoPlayerIdx = -1;
const ALUNO_SHOW_MIN = 255, ALUNO_SHOW_GAP = 16;
function renderAlunoShowcase() {
  const grid = $al("aluno-showcase-grid");
  if (!grid || !alunoShowcaseVideos.length) return;
  const width = grid.clientWidth;
  if (!width) return; /* vitrine ainda escondida: o observador chama de novo quando aparecer */
  const fit = Math.max(1, Math.floor((width + ALUNO_SHOW_GAP) / (ALUNO_SHOW_MIN + ALUNO_SHOW_GAP)));
  if (grid.dataset.fit === String(fit) && grid.dataset.n === String(alunoShowcaseVideos.length)) return;
  grid.dataset.fit = String(fit); grid.dataset.n = String(alunoShowcaseVideos.length);
  grid.style.gridTemplateColumns = `repeat(${fit}, minmax(0, 1fr))`;
  grid.innerHTML = alunoShowcaseVideos.slice(0, fit).map(v => `
    <button type="button" class="aluno-show-card" data-vid="${alunoEsc(v.id)}">
      <span class="aluno-show-thumb"><img src="https://i.ytimg.com/vi/${alunoEsc(v.youtube_id)}/hqdefault.jpg" alt="" loading="lazy"><span class="aluno-video-play">&#9654;</span></span>
      <span class="aluno-show-title">${alunoEsc(v.title)}</span>
      ${v.material_path ? `<span class="aluno-show-tag">&#128206; <span data-i18n="aluno.withMaterial">Com material de apoio</span></span>` : ""}
    </button>`).join("");
  if (typeof applyTranslations === "function") applyTranslations(grid);
}
if (typeof ResizeObserver === "function") new ResizeObserver(() => renderAlunoShowcase()).observe(document.getElementById("aluno-showcase-grid"));

/* ---- vídeos do YouTube (os mesmos para todos; só aluno matriculado lê — a regra está no banco) ---- */
async function loadAlunoVideos() {
  const grid = $al("aluno-video-grid");
  if (!grid) return;
  const { data, error } = await supabase.from("aluno_videos").select("id, title, description, youtube_id, material_path, material_name, material_size")
    .eq("ativo", true).order("ordem", { ascending: true }).order("created_at", { ascending: true });
  const has = !error && !!data && data.length > 0;
  /* "Em breve" some quando já existe aula; o cartão azul do dashboard vira atalho para a tela */
  [$al("aluno-nav-soon-badge"), $al("aluno-teaser-badge")].forEach(el => { if (el) el.hidden = has; });
  $al("aluno-teaser-cta").hidden = !has;
  $al("aluno-ingles-empty").hidden = has;
  /* vitrine na tela inicial: até 3 aulas em miniatura; o cartão azul "Em breve" só aparece enquanto não houver aula */
  const showcase = $al("aluno-showcase");
  showcase.hidden = !has;
  $al("aluno-english-teaser").style.display = has ? "none" : "";
  if (!has) { grid.innerHTML = ""; return; }
  $al("aluno-showcase-count").textContent = alunoFill(t(data.length === 1 ? "aluno.lessonCountOne" : "aluno.lessonCount"), { n: data.length });
  alunoShowcaseVideos = data;
  alunoVideosAll = data;
  renderAlunoShowcase();
  grid.innerHTML = data.map(v => `
    <div class="aluno-video-card" data-id="${alunoEsc(v.id)}" data-yt="${alunoEsc(v.youtube_id)}">
      <button type="button" class="aluno-video-thumb" aria-label="${alunoEsc(v.title)}">
        <img src="https://i.ytimg.com/vi/${alunoEsc(v.youtube_id)}/hqdefault.jpg" alt="" loading="lazy">
        <span class="aluno-video-play">&#9654;</span>
      </button>
      <div class="aluno-video-title">${alunoEsc(v.title)}</div>
      ${v.description ? `<div class="aluno-video-desc">${alunoEsc(v.description)}</div>` : ""}
      ${v.material_path ? `<button type="button" class="btn btn-ghost btn-sm aluno-video-dl" data-path="${alunoEsc(v.material_path)}" data-name="${alunoEsc(v.material_name || "material")}">
        <span aria-hidden="true">&#11015;</span> <span data-i18n="aluno.downloadMaterial">Baixar material de apoio</span>
        <small>${alunoEsc(v.material_name || "")}${v.material_size ? ` · ${v.material_size >= 1048576 ? (v.material_size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(v.material_size / 1024)) + " KB"}` : ""}</small></button>` : ""}
    </div>`).join("");
  if (typeof applyTranslations === "function") applyTranslations(grid);
}
/* baixar o material de apoio: link temporário (2 min) gerado só para quem é aluno matriculado */
document.addEventListener("click", async e => {
  const btn = e.target.closest(".aluno-video-dl");
  if (!btn) return;
  btn.disabled = true;
  const { data, error } = await supabase.storage.from("aluno-materiais").createSignedUrl(btn.dataset.path, 120, { download: btn.dataset.name });
  btn.disabled = false;
  if (error || !data || !data.signedUrl) { console.error("Erro ao gerar o link do material:", error); alert(t("aluno.downloadError")); return; }
  const a = document.createElement("a");
  a.href = data.signedUrl; a.download = btn.dataset.name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
});
/* player grande: abre sobre a parte interna do portal (ao lado do menu); o YouTube só é carregado quando o aluno clica */
function renderAlunoPlayer() {
  const v = alunoVideosAll[alunoPlayerIdx];
  if (!v) return;
  const box = $al("aluno-player");
  $al("aluno-player-title").textContent = v.title;
  $al("aluno-player-frame").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.youtube_id)}?autoplay=1&rel=0&modestbranding=1" title="${alunoEsc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  $al("aluno-player-material").innerHTML = v.material_path
    ? `<button type="button" class="btn btn-ghost btn-sm aluno-video-dl" data-path="${alunoEsc(v.material_path)}" data-name="${alunoEsc(v.material_name || "material")}"><span aria-hidden="true">&#11015;</span> <span data-i18n="aluno.downloadMaterial">Baixar material de apoio</span></button>` : "";
  if (typeof applyTranslations === "function") applyTranslations($al("aluno-player-material"));
  $al("aluno-player-prev").disabled = alunoPlayerIdx === 0;
  $al("aluno-player-next").disabled = alunoPlayerIdx === alunoVideosAll.length - 1;
  $al("aluno-player-pos").textContent = `${alunoPlayerIdx + 1} / ${alunoVideosAll.length}`;
  /* começa na borda do menu lateral, para o player ocupar só a parte interna do portal */
  const sb = document.querySelector(".sidebar");
  box.style.left = (sb ? Math.max(0, Math.round(sb.getBoundingClientRect().right)) : 0) + "px";
  box.hidden = false;
  document.body.style.overflow = "hidden";
}
function openAlunoPlayer(id) {
  const i = alunoVideosAll.findIndex(v => v.id === id);
  if (i < 0) return;
  alunoPlayerIdx = i;
  renderAlunoPlayer();
}
function closeAlunoPlayer() {
  $al("aluno-player-frame").innerHTML = ""; /* tira o iframe: o vídeo para de tocar */
  $al("aluno-player").hidden = true;
  document.body.style.overflow = "";
}
document.addEventListener("click", e => {
  const thumb = e.target.closest(".aluno-video-thumb");
  if (thumb) { openAlunoPlayer(thumb.closest(".aluno-video-card").dataset.id); return; }
  const card = e.target.closest(".aluno-show-card[data-vid]");
  if (card) { openAlunoPlayer(card.dataset.vid); return; }
  if (e.target.closest("#aluno-player-close") || e.target.id === "aluno-player-stage") closeAlunoPlayer();
  if (e.target.closest("#aluno-player-prev") && alunoPlayerIdx > 0) { alunoPlayerIdx--; renderAlunoPlayer(); }
  if (e.target.closest("#aluno-player-next") && alunoPlayerIdx < alunoVideosAll.length - 1) { alunoPlayerIdx++; renderAlunoPlayer(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$al("aluno-player").hidden) closeAlunoPlayer(); });
window.addEventListener("resize", () => { if (!$al("aluno-player").hidden) renderAlunoPlayerPosition(); });
function renderAlunoPlayerPosition() {
  const sb = document.querySelector(".sidebar");
  $al("aluno-player").style.left = (sb ? Math.max(0, Math.round(sb.getBoundingClientRect().right)) : 0) + "px";
}

function renderAlunoAll() {
  alunoSpectatorName();
  renderAlunoHero();
  renderAlunoPayments();
  renderAlunoDocs();
  renderAlunoCalendar();
  renderAlunoMessages();
  renderAlunoDocsView();
}

/* ---- topo: escola, datas, contagem regressiva, anel de pagamento ---- */
function renderAlunoHero() {
  const e = alunoEnr || {};
  $al("aluno-hero-course").textContent = [e.school, e.turno].filter(Boolean).join(" · ") || "—";
  $al("aluno-date-start").textContent = e.class_start_date ? alunoDate(e.class_start_date) : "—";
  $al("aluno-date-arrival").textContent = e.arrival_date ? alunoDate(e.arrival_date) : "—";

  const days = e.arrival_date ? alunoDaysUntil(e.arrival_date) : null;
  $al("aluno-stat-days").textContent = days != null && days >= 0 ? String(days) : "—";
  $al("aluno-days-chip").style.display = days != null && days >= 0 ? "" : "none";
  if (days != null && days >= 0) $al("aluno-days-n").textContent = String(days);

  const pct = alunoFin && alunoFin.total > 0 ? Math.min(100, Math.round((alunoFin.pago / alunoFin.total) * 100)) : 0;
  $al("aluno-ring").style.background = `conic-gradient(var(--primary) ${pct * 3.6}deg, var(--border) 0deg)`;
  $al("aluno-ring-pct").textContent = pct + "%";
}

/* ---- pagamentos: vêm do Financeiro e acompanham qualquer baixa feita pela equipe ---- */
function renderAlunoPayments() {
  const f = alunoFin;
  if (!f) return;
  $al("aluno-stat-paid").textContent = alunoEuro(f.pago);
  $al("aluno-stat-pending").textContent = alunoEuro(f.pendente);
  const pct = f.total > 0 ? Math.min(100, Math.round((f.pago / f.total) * 100)) : 0;
  $al("aluno-pay-fill").style.width = pct + "%";
  $al("aluno-pay-caption").textContent = f.total > 0
    ? (f.pendente > 0
        ? alunoFill(t("aluno.payCaption"), { paid: alunoEuro(f.pago), total: alunoEuro(f.total), pending: alunoEuro(f.pendente) })
        : alunoFill(t("aluno.payAllPaid"), { total: alunoEuro(f.total) }))
    : t("aluno.payNone");

  const today = alunoTodayIso();
  const icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14 4v5h5"/></svg>';
  $al("aluno-pay-list").innerHTML = (f.parcelas || []).map(p => {
    const overdue = !p.pago && p.vencimento && alunoIsoDate(p.vencimento) < today;
    const meta = p.pago
      ? alunoFill(t("aluno.payPaidOn"), { date: alunoDate(p.pago_em ? new Date(p.pago_em).toLocaleDateString("en-CA") : p.vencimento) })
      : alunoFill(t("aluno.payDueOn"), { date: alunoDate(p.vencimento) });
    const status = p.pago ? t("aluno.payPaid") : (overdue ? t("aluno.payOverdue") : t("aluno.payPending"));
    return `
      <div class="aluno-receipt-row">
        <span class="aluno-receipt-icon">${icon}</span>
        <span class="aluno-receipt-body">
          <span class="aluno-receipt-name">${alunoEsc(alunoFill(t("aluno.payInstallment"), { n: p.numero, t: p.total }))} · ${alunoEuro(p.valor)}</span>
          <span class="aluno-receipt-meta">${alunoEsc(meta)}</span>
        </span>
        <span class="aluno-receipt-status${p.pago ? "" : (overdue ? " overdue" : " pending")}">${alunoEsc(status)}</span>
        ${!p.pago && p.id ? `<button type="button" class="btn btn-ghost btn-sm" data-pay-proof="${alunoEsc(p.id)}">${alunoEsc(t("aluno.proofRow"))}</button>` : ""}
      </div>`;
  }).join("");
  renderAlunoProofs();
}

/* ---- comprovantes de pagamento: o aluno envia; só o financeiro confirma (e só então os valores mudam) ---- */
let alunoProofs = [];
async function loadAlunoProofs() {
  const { data, error } = await supabase.rpc("aluno_comprovantes", alunoRpcArgs());
  if (error) { console.error("Erro ao carregar comprovantes:", error); return; }
  alunoProofs = data || [];
  renderAlunoProofs();
}
function renderAlunoProofs() {
  const box = $al("aluno-proof-list");
  if (!box) return;
  const list = alunoProofs.filter(p => p.status !== "confirmado" || (Date.now() - new Date(p.created_at).getTime()) < 14 * 86400000).slice(0, 6);
  box.innerHTML = list.map(p => {
    const key = p.status === "pendente" ? "aluno.proofPending" : (p.status === "recusado" ? "aluno.proofRefused" : "aluno.proofConfirmed");
    const reason = p.status === "recusado" && p.review_note ? ` — ${t("aluno.proofReason")}: ${p.review_note}` : "";
    const cls = p.status === "pendente" ? " pending" : (p.status === "recusado" ? " overdue" : "");
    return `<div class="aluno-receipt-row"><span class="aluno-receipt-body"><span class="aluno-receipt-meta${cls}">${alunoEsc(alunoFill(t(key), { amount: alunoEuro(p.amount) }) + reason)}</span></span></div>`;
  }).join("");
}
function alunoOpenProofModal(receivableId) {
  if (alunoSpectator || !alunoEnr) return;
  const f = alunoFin || { parcelas: [] };
  const open = (f.parcelas || []).filter(p => !p.pago && p.id);
  $al("aluno-proof-rec").innerHTML = `<option value="">${alunoEsc(t("aluno.proofAnyInstallment"))}</option>` + open.map(p =>
    `<option value="${alunoEsc(p.id)}">${alunoEsc(alunoFill(t("aluno.payInstallment"), { n: p.numero, t: p.total }))} · ${alunoEuro(p.valor)} · ${alunoEsc(alunoDate(p.vencimento))}</option>`).join("");
  $al("aluno-proof-rec").value = receivableId || "";
  const sel = open.find(p => p.id === receivableId);
  $al("aluno-proof-amount").value = sel ? sel.valor : "";
  $al("aluno-proof-date").value = alunoTodayIso();
  $al("aluno-proof-date").max = alunoTodayIso();
  $al("aluno-proof-file").value = "";
  $al("aluno-proof-note").value = "";
  $al("aluno-proof-backdrop").classList.add("open");
}
const alunoCloseProofModal = () => $al("aluno-proof-backdrop").classList.remove("open");
$al("aluno-send-proof").addEventListener("click", () => alunoOpenProofModal(""));
$al("aluno-pay-list").addEventListener("click", e => { const b = e.target.closest("[data-pay-proof]"); if (b) alunoOpenProofModal(b.dataset.payProof); });
["aluno-proof-close", "aluno-proof-cancel"].forEach(i => $al(i).addEventListener("click", alunoCloseProofModal));
$al("aluno-proof-backdrop").addEventListener("click", e => { if (e.target.id === "aluno-proof-backdrop") alunoCloseProofModal(); });
$al("aluno-proof-rec").addEventListener("change", () => {
  const p = ((alunoFin && alunoFin.parcelas) || []).find(x => x.id === $al("aluno-proof-rec").value);
  if (p) $al("aluno-proof-amount").value = p.valor;
});
$al("aluno-proof-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (alunoSpectator || !alunoEnr) return;
  const file = $al("aluno-proof-file").files[0];
  const amount = Math.round(parseFloat($al("aluno-proof-amount").value) * 100) / 100;
  const paidOn = $al("aluno-proof-date").value;
  if (!file || !(amount > 0) || !paidOn) return;
  if (file.size > ALUNO_DOC_MAX) { alunoToast(t("aluno.docTooBig")); return; }
  if (!(file.type.startsWith("image/") || file.type === "application/pdf")) { alunoToast(t("aluno.docBadType")); return; }
  const btn = $al("aluno-proof-send");
  btn.disabled = true; btn.textContent = t("aluno.proofSending");
  const reset = () => { btn.disabled = false; btn.textContent = t("aluno.proofSend"); };
  const ext = (file.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "pdf";
  const path = `${alunoEnr.id}/pagamento-${Date.now()}.${ext}`;
  const up = await supabase.storage.from("student-docs").upload(path, file);
  if (up.error) { console.error(up.error); reset(); alunoToast(t("aluno.proofError")); return; }
  const { error } = await supabase.rpc("aluno_enviar_comprovante", {
    p_receivable: $al("aluno-proof-rec").value || null, p_amount: amount, p_paid_on: paidOn, p_path: path, p_name: file.name, p_note: $al("aluno-proof-note").value.trim() || null });
  reset();
  if (error) { console.error(error); alunoToast(/muitos_pendentes/.test(error.message || "") ? t("aluno.proofTooMany") : t("aluno.proofError")); return; }
  alunoCloseProofModal();
  alunoToast(t("aluno.proofSent"));
  loadAlunoProofs();
});

/* ---- documentos da jornada ---- */
const ALUNO_DOC_KINDS = ["passaporte", "passagens", "comprovante_financeiro", "matricula_seguros"];
const ALUNO_DOC_REQUIRED = ["passaporte", "passagens", "comprovante_financeiro", "matricula_seguros"];
const ALUNO_DOC_MAX = 10 * 1024 * 1024;

function alunoDocRecord(kind) { return alunoDocsData && (alunoDocsData.docs || []).find(d => d.kind === kind) || null; }
function alunoDocSent(kind) {
  const rec = alunoDocRecord(kind);
  if (rec && rec.received && rec.file_path) return true;
  return kind === "passaporte" && !!(alunoDocsData ? alunoDocsData.passport_legacy : (alunoEnr && alunoEnr.passport_photo_path));
}
async function alunoOpenFile(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data) { alunoToast(t("aluno.fileError")); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}
async function loadAlunoDocs() {
  const { data, error } = await supabase.rpc("aluno_documentos", alunoRpcArgs());
  if (error) { console.error("Erro ao carregar documentos:", error); return; }
  alunoDocsData = data;
  renderAlunoDocs();
  renderAlunoDocsView();
}

function renderAlunoDocs() {
  const grid = $al("aluno-doc-grid");
  if (grid) {
    grid.innerHTML = ALUNO_DOC_REQUIRED.map(kind => {
      const sent = alunoDocSent(kind);
      const rec = alunoDocRecord(kind);
      const meta = sent ? (rec && rec.file_name ? rec.file_name : t("aluno.docSentOnSignup")) : t("aluno.noFileSent");
      return `
        <div class="aluno-doc-card ${sent ? "" : "is-pending"}">
          <div class="aluno-doc-card-head">
            <span class="aluno-doc-card-title">${alunoEsc(t("aluno.docName." + kind))}</span>
            <span class="aluno-doc-status ${sent ? "ok" : "pending"}">${alunoEsc(sent ? t("aluno.sent") : t("aluno.pending"))}</span>
          </div>
          <span class="aluno-doc-meta">${alunoEsc(meta)}</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-self:flex-start;">
            ${sent ? `<button type="button" class="btn btn-ghost btn-sm" data-doc-view="${kind}">${alunoEsc(t("aluno.docView"))}</button>` : ""}
            <button type="button" class="btn btn-primary btn-sm" data-doc-upload="${kind}">${alunoEsc(sent ? t("aluno.docReplace") : t("aluno.docUpload"))}</button>
            <input type="file" accept="image/*,application/pdf" hidden data-doc-file="${kind}">
          </div>
        </div>`;
    }).join("");
  }
  const got = ALUNO_DOC_REQUIRED.filter(alunoDocSent).length;
  $al("aluno-stat-docs").textContent = `${got} / ${ALUNO_DOC_REQUIRED.length}`;
}

/* tela Documentos: o aluno envia cada documento da jornada */
function renderAlunoDocsView() {
  const box = $al("aluno-docs-list");
  if (!box) return;
  if (!alunoEnr) { box.innerHTML = `<p class="aluno-empty">${alunoEsc(t("aluno.noMessages"))}</p>`; return; }
  box.innerHTML = ALUNO_DOC_KINDS.map(kind => {
    const sent = alunoDocSent(kind);
    const rec = alunoDocRecord(kind);
    const required = ALUNO_DOC_REQUIRED.includes(kind);
    const when = rec && rec.uploaded_at ? alunoDate(rec.uploaded_at.slice(0, 10)) : "";
    const meta = sent ? (rec && rec.file_name ? `${rec.file_name}${when ? " · " + t("aluno.docSentOn").replace("{date}", when) : ""}` : t("aluno.docSentOnSignup")) : t("aluno.noFileSent");
    return `
      <div class="aluno-doc-row ${sent ? "is-sent" : ""}">
        <div class="aluno-doc-row-main">
          <div class="aluno-doc-row-title">${alunoEsc(t("aluno.docName." + kind))}${required ? "" : ` <small>(${alunoEsc(t("aluno.docOptional"))})</small>`}</div>
          <div class="aluno-doc-row-desc">${alunoEsc(t("aluno.docDesc." + kind))}</div>
          <div class="aluno-doc-row-meta">${alunoEsc(meta)}</div>
        </div>
        <span class="aluno-doc-status ${sent ? "ok" : "pending"}">${alunoEsc(sent ? t("aluno.sent") : t("aluno.pending"))}</span>
        <div class="aluno-doc-row-acts">
          ${sent ? `<button type="button" class="btn btn-ghost btn-sm" data-doc-view="${kind}">${alunoEsc(t("aluno.docView"))}</button>` : ""}
          <button type="button" class="btn btn-primary btn-sm" data-doc-upload="${kind}">${alunoEsc(sent ? t("aluno.docReplace") : t("aluno.docUpload"))}</button>
          <input type="file" accept="image/*,application/pdf" hidden data-doc-file="${kind}">
        </div>
      </div>`;
  }).join("");
}

function alunoDocsClick(e) {
  const up = e.target.closest("[data-doc-upload]");
  if (alunoSpectator && up) return;
  if (up) { up.parentElement.querySelector(`[data-doc-file="${up.dataset.docUpload}"]`).click(); return; }
  const vw = e.target.closest("[data-doc-view]");
  if (vw) {
    const kind = vw.dataset.docView, rec = alunoDocRecord(kind);
    if (rec && rec.file_path) alunoOpenFile("student-docs", rec.file_path);
    else if (kind === "passaporte" && alunoEnr && alunoEnr.passport_photo_path) alunoOpenFile("passport-photos", alunoEnr.passport_photo_path);
  }
}
async function alunoDocsChange(e) {
  const input = e.target.closest("[data-doc-file]");
  if (!input) return;
  const kind = input.dataset.docFile, file = input.files[0];
  input.value = "";
  if (alunoSpectator || !file || !alunoEnr) return;
  if (file.size > ALUNO_DOC_MAX) { alunoToast(t("aluno.docTooBig")); return; }
  if (!(file.type.startsWith("image/") || file.type === "application/pdf")) { alunoToast(t("aluno.docBadType")); return; }
  const btn = input.parentElement.querySelector(`[data-doc-upload="${kind}"]`);
  if (btn) { btn.disabled = true; btn.textContent = t("aluno.docUploading"); }
  const ext = (file.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "pdf";
  const path = `${alunoEnr.id}/${kind}-${Date.now()}.${ext}`;
  const up = await supabase.storage.from("student-docs").upload(path, file);
  if (up.error) { console.error(up.error); alunoToast(t("aluno.docError")); renderAlunoDocsView(); return; }
  const reg = await supabase.rpc("aluno_registrar_documento", { p_kind: kind, p_path: path, p_name: file.name });
  if (reg.error) { console.error(reg.error); alunoToast(t("aluno.docError")); renderAlunoDocsView(); return; }
  alunoToast(t("aluno.docSentOk"));
  await loadAlunoDocs();
}
["aluno-docs-list", "aluno-doc-grid"].forEach(id => { const el = $al(id); el.addEventListener("click", alunoDocsClick); el.addEventListener("change", alunoDocsChange); });

/* ---- menu lateral: Dashboard e Documentos funcionam; o resto avisa que vem em breve ---- */
let alunoToastTimer = null;
function alunoToast(msg) {
  const el = $al("aluno-toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(alunoToastTimer);
  alunoToastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
function showAlunoView(view) {
  $al("aluno-view-dashboard").classList.toggle("active", view === "dashboard");
  $al("aluno-view-docs").classList.toggle("active", view === "docs");
  $al("aluno-view-ingles").classList.toggle("active", view === "ingles");
  document.querySelectorAll(".sidebar-nav [data-nav]").forEach(b => b.classList.toggle("active", (b.dataset.nav === "documentos" ? "docs" : b.dataset.nav) === view));
  window.scrollTo({ top: 0 });
  if (view === "docs") loadAlunoDocs();
}
document.querySelectorAll(".sidebar-nav [data-nav]").forEach(btn => {
  btn.addEventListener("click", () => {
    const nav = btn.dataset.nav;
    if (nav === "dashboard") showAlunoView("dashboard");
    else if (nav === "documentos") showAlunoView("docs");
    else if (nav === "ingles") showAlunoView("ingles");
    else alunoToast(t("aluno.soonToast"));
  });
});
$al("aluno-docs-back").addEventListener("click", () => showAlunoView("dashboard"));
$al("aluno-ingles-back").addEventListener("click", () => showAlunoView("dashboard"));
$al("aluno-showcase").addEventListener("click", e => { if (e.target.closest("#aluno-showcase-all")) showAlunoView("ingles"); });
$al("aluno-english-teaser").addEventListener("click", () => showAlunoView("ingles"));
$al("aluno-english-teaser").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showAlunoView("ingles"); } });

/* ---- calendário e próximos compromissos: chegada, início das aulas e vencimento das parcelas ---- */
function alunoEvents() {
  const ev = [];
  const e = alunoEnr || {};
  if (e.arrival_date) ev.push({ date: alunoIsoDate(e.arrival_date), cls: "dot-reuniao", title: t("aluno.evArrival"), meta: e.school || "" });
  if (e.class_start_date) ev.push({ date: alunoIsoDate(e.class_start_date), cls: "dot-reuniao", title: t("aluno.evClassStart"), meta: e.school || "" });
  ((alunoFin && alunoFin.parcelas) || []).filter(p => !p.pago && p.vencimento).forEach(p => {
    ev.push({ date: alunoIsoDate(p.vencimento), cls: "dot-tarefa",
      title: alunoFill(t("aluno.evPayment"), { n: p.numero, t: p.total }), meta: alunoEuro(p.valor) });
  });
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}

function renderAlunoCalendar() {
  const events = alunoEvents();
  const y = alunoCalMonth.getFullYear(), m = alunoCalMonth.getMonth();
  const label = alunoCalMonth.toLocaleDateString(alunoLocale(), { month: "long", year: "numeric" });
  $al("aluno-cal-label").textContent = label.charAt(0).toUpperCase() + label.slice(1);

  const first = new Date(y, m, 1).getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const prevDim = new Date(y, m, 0).getDate();
  const today = alunoTodayIso();
  const cells = [];
  for (let i = first - 1; i >= 0; i--) cells.push(`<button type="button" class="dash-cal-day is-muted" disabled>${prevDim - i}</button>`);
  for (let d = 1; d <= dim; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dots = [...new Set(events.filter(x => x.date === iso).map(x => x.cls))];
    cells.push(`<button type="button" class="dash-cal-day${iso === today ? " is-today" : ""}">${d}${dots.length ? `<span class="dash-cal-dots">${dots.map(c => `<span class="dash-cal-dot ${c}"></span>`).join("")}</span>` : ""}</button>`);
  }
  const rest = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= rest; i++) cells.push(`<button type="button" class="dash-cal-day is-muted" disabled>${i}</button>`);
  const dow = ["D", "S", "T", "Q", "Q", "S", "S"].map(x => `<div class="dash-cal-dow">${x}</div>`).join("");
  $al("aluno-cal-grid").innerHTML = dow + cells.join("");

  const upcoming = events.filter(x => x.date >= today).slice(0, 5);
  $al("aluno-agenda").innerHTML = upcoming.length ? upcoming.map(x => {
    const d = alunoParse(x.date);
    const badge = `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleDateString(alunoLocale(), { month: "short" }).replace(".", "").toUpperCase()}`;
    return `
      <div class="dash-agenda-item">
        <span class="dash-agenda-item-badge ${x.cls}">${alunoEsc(badge)}</span>
        <div class="dash-agenda-item-body">
          <div class="dash-agenda-item-title">${alunoEsc(x.title)}</div>
          <div class="dash-agenda-item-meta">${alunoEsc(x.meta)}</div>
        </div>
      </div>`;
  }).join("") : `<div class="aluno-empty">${alunoEsc(t("aluno.noEvents"))}</div>`;
}
$al("aluno-cal-prev").addEventListener("click", () => { alunoCalMonth = new Date(alunoCalMonth.getFullYear(), alunoCalMonth.getMonth() - 1, 1); renderAlunoCalendar(); });
$al("aluno-cal-next").addEventListener("click", () => { alunoCalMonth = new Date(alunoCalMonth.getFullYear(), alunoCalMonth.getMonth() + 1, 1); renderAlunoCalendar(); });

/* ---- mensagens com a equipe ---- */
let alunoMessages = [];
async function loadAlunoMessages() {
  if (!alunoEnr) return;
  const { data, error } = await supabase.from("aluno_mensagens")
    .select("id, autor, autor_nome, texto, created_at")
    .eq("enrollment_id", alunoEnr.id).order("created_at", { ascending: true });
  if (error) { console.error("Erro ao carregar mensagens:", error); return; }
  alunoMessages = data || [];
  renderAlunoMessages();
}
function renderAlunoMessages() {
  const box = $al("aluno-msg-thread");
  if (!alunoMessages.length) { box.innerHTML = `<div class="aluno-empty">${alunoEsc(t("aluno.noMessages"))}</div>`; return; }
  box.innerHTML = alunoMessages.map(m => {
    const mine = m.autor === "aluno";
    const when = new Date(m.created_at).toLocaleString(alunoLocale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    return `
      <div class="aluno-msg-bubble${mine ? " mine" : ""}">
        <span class="aluno-msg-author">${alunoEsc(mine ? t("aluno.you") : (m.autor_nome || t("aluno.team")))}</span>
        <span class="aluno-msg-text">${alunoEsc(m.texto)}</span>
        <span class="aluno-msg-time">${alunoEsc(when)}</span>
      </div>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
}
document.querySelector(".aluno-msg-form").addEventListener("submit", async e => {
  e.preventDefault();
  const ta = $al("aluno-msg-text");
  const texto = ta.value.trim();
  if (alunoSpectator || !texto || !alunoEnr) return;
  const btn = $al("aluno-msg-send");
  btn.disabled = true;
  const { error } = await supabase.from("aluno_mensagens").insert({
    enrollment_id: alunoEnr.id, autor: "aluno", autor_nome: alunoEnr.name || "", texto,
  });
  btn.disabled = false;
  if (error) { console.error("Erro ao enviar mensagem:", error); alert(t("aluno.msgError")); return; }
  ta.value = "";
  loadAlunoMessages();
});

/* aviso fixo no topo + todos os controles que gravam ficam desligados */
function alunoEnterSpectatorMode() {
  document.body.classList.add("aluno-spectator");
  const bar = document.createElement("div");
  bar.className = "aluno-spectator-bar";
  bar.innerHTML = '<span>👁 Modo espectador — você está vendo o portal do aluno <b id="aluno-spectator-name"></b>. Somente leitura: nada pode ser enviado ou alterado.</span><button type="button" id="aluno-spectator-close">Fechar</button>';
  document.body.prepend(bar);
  bar.querySelector("#aluno-spectator-close").addEventListener("click", () => document.getElementById("aluno-btn-signout").click());
  const outLabel = document.querySelector("#aluno-btn-signout span");
  if (outLabel) { outLabel.removeAttribute("data-i18n"); outLabel.textContent = "Fechar espectador"; }
  const form = document.querySelector(".aluno-msg-form");
  if (form) form.querySelectorAll("textarea, button, input").forEach(el => { el.disabled = true; });
  const ta = document.getElementById("aluno-msg-text");
  if (ta) ta.placeholder = "Espectador: não é possível enviar mensagens.";
}
function alunoSpectatorName() {
  const el = document.getElementById("aluno-spectator-name");
  if (el && alunoEnr) el.textContent = alunoEnr.name || "";
}

document.addEventListener("langchange", renderAlunoAll);
