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

/* ---- carregamento ---- */
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "area-aluno-login.html"; return; }
  alunoSession = session;

  const { data: enr } = await supabase
    .from("enrollments")
    .select("id, name, school, turno, arrival_date, class_start_date, passport_photo_path, course_value")
    .eq("student_user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  alunoEnr = enr || null;

  const fullName = (enr && enr.name) || session.user.user_metadata?.name || session.user.email;
  const firstName = fullName.split(" ")[0];
  const initials = fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "--";
  document.querySelectorAll("[data-aluno-name]").forEach(el => { el.textContent = fullName; });
  document.querySelectorAll("[data-aluno-firstname]").forEach(el => { el.textContent = firstName; });
  document.querySelectorAll("[data-aluno-initials]").forEach(el => { el.textContent = initials; });

  renderAlunoAll();
  loadAlunoMessages();

  const { data: fin, error } = await supabase.rpc("aluno_financeiro");
  if (error) console.error("Erro ao carregar pagamentos:", error);
  else { alunoFin = fin; renderAlunoAll(); }
})();

document.getElementById("aluno-btn-signout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "area-aluno-login.html";
});

function renderAlunoAll() {
  renderAlunoHero();
  renderAlunoPayments();
  renderAlunoDocs();
  renderAlunoCalendar();
  renderAlunoMessages();
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
      </div>`;
  }).join("");
}

/* ---- documentos ---- */
function renderAlunoDocs() {
  const path = alunoEnr && alunoEnr.passport_photo_path;
  const card = $al("aluno-doc-passport");
  card.classList.toggle("is-pending", !path);
  const st = $al("aluno-doc-passport-status");
  st.className = "aluno-doc-status " + (path ? "ok" : "pending");
  st.textContent = path ? t("aluno.sent") : t("aluno.pending");
  $al("aluno-doc-passport-meta").textContent = path ? `${t("aluno.passport")}.${(path.split(".").pop() || "").toLowerCase()}` : t("aluno.noFileSent");
  $al("aluno-doc-passport-link").style.display = path ? "" : "none";
  $al("aluno-stat-docs").textContent = (path ? 1 : 0) + " / 2";
}
$al("aluno-doc-passport-link").addEventListener("click", async e => {
  e.preventDefault();
  const path = alunoEnr && alunoEnr.passport_photo_path;
  if (!path) return;
  const { data, error } = await supabase.storage.from("passport-photos").createSignedUrl(path, 3600);
  if (error || !data) { alert(t("aluno.fileError")); return; }
  window.open(data.signedUrl, "_blank", "noopener");
});

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
  if (!texto || !alunoEnr) return;
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

document.addEventListener("langchange", renderAlunoAll);
