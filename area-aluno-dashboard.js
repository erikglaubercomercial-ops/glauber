/* ============================================================
   DASHBOARD — ÁREA DO ALUNO. Sessão real via Supabase Auth (o
   acesso é criado automaticamente pelo CRM na matrícula). O
   conteúdo de pagamentos/documentos/mensagens ainda é só visual
   (dados de exemplo) — aqui só ligamos sessão, nome real e saída.
   Depende de config.js (variável global `supabase`) já carregado.
   ============================================================ */

(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "area-aluno-login.html"; return; }

  const { data: enr } = await supabase
    .from("enrollments")
    .select("name")
    .eq("student_user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fullName = (enr && enr.name) || session.user.user_metadata?.name || session.user.email;
  const firstName = fullName.split(" ")[0];
  const initials = fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "--";

  document.querySelectorAll("[data-aluno-name]").forEach(el => { el.textContent = fullName; });
  document.querySelectorAll("[data-aluno-firstname]").forEach(el => { el.textContent = firstName; });
  document.querySelectorAll("[data-aluno-initials]").forEach(el => { el.textContent = initials; });
})();

/* ---- pagamentos reais: vêm do Financeiro (rpc aluno_financeiro) e acompanham qualquer baixa feita pela equipe ---- */
let alunoFin = null;
const alunoLocale = () => ({ pt: "pt-BR", en: "en-GB", es: "es-ES" }[getLang()] || "pt-BR");
const alunoEuro = v => "€ " + Number(v || 0).toLocaleString(alunoLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const alunoDate = iso => {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(alunoLocale(), { day: "2-digit", month: "short", year: "numeric" });
};
const alunoEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function renderAlunoPayments() {
  const f = alunoFin;
  if (!f) return;
  document.getElementById("aluno-stat-paid").textContent = alunoEuro(f.pago);
  document.getElementById("aluno-stat-pending").textContent = alunoEuro(f.pendente);
  const pct = f.total > 0 ? Math.min(100, Math.round((f.pago / f.total) * 100)) : 0;
  document.getElementById("aluno-pay-fill").style.width = pct + "%";
  document.getElementById("aluno-pay-caption").textContent = f.total > 0
    ? (f.pendente > 0
        ? t("aluno.payCaption").replace("{paid}", alunoEuro(f.pago)).replace("{total}", alunoEuro(f.total)).replace("{pending}", alunoEuro(f.pendente))
        : t("aluno.payAllPaid").replace("{total}", alunoEuro(f.total)))
    : t("aluno.payNone");

  const today = new Date().toISOString().slice(0, 10);
  const icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14 4v5h5"/></svg>';
  document.getElementById("aluno-pay-list").innerHTML = (f.parcelas || []).map(p => {
    const overdue = !p.pago && p.vencimento && String(p.vencimento).slice(0, 10) < today;
    const meta = p.pago
      ? t("aluno.payPaidOn").replace("{date}", alunoDate(p.pago_em || p.vencimento))
      : t("aluno.payDueOn").replace("{date}", alunoDate(p.vencimento));
    const status = p.pago ? t("aluno.payPaid") : (overdue ? t("aluno.payOverdue") : t("aluno.payPending"));
    return `
      <div class="aluno-receipt-row">
        <span class="aluno-receipt-icon">${icon}</span>
        <span class="aluno-receipt-body">
          <span class="aluno-receipt-name">${alunoEsc(t("aluno.payInstallment").replace("{n}", p.numero).replace("{t}", p.total))} · ${alunoEuro(p.valor)}</span>
          <span class="aluno-receipt-meta">${alunoEsc(meta)}</span>
        </span>
        <span class="aluno-receipt-status${p.pago ? "" : (overdue ? " overdue" : " pending")}">${alunoEsc(status)}</span>
      </div>`;
  }).join("");
}

(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { data, error } = await supabase.rpc("aluno_financeiro");
  if (error) { console.error("Erro ao carregar pagamentos:", error); return; }
  alunoFin = data;
  renderAlunoPayments();
})();
document.addEventListener("langchange", renderAlunoPayments);

document.getElementById("aluno-btn-signout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "area-aluno-login.html";
});

/* ainda só visual — o quadro de mensagens não salva nada de verdade ainda */
document.querySelector(".aluno-msg-form").addEventListener("submit", e => e.preventDefault());
