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

document.getElementById("aluno-btn-signout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "area-aluno-login.html";
});

/* ainda só visual — o quadro de mensagens não salva nada de verdade ainda */
document.querySelector(".aluno-msg-form").addEventListener("submit", e => e.preventDefault());
