/* ============================================================
   TELA DE LOGIN — ÁREA DO ALUNO. Login real via Supabase Auth
   (o acesso é criado automaticamente pelo CRM quando o consultor
   salva a matrícula com o e-mail do aluno). Depende de config.js
   (variável global `supabase`) já carregado.
   ============================================================ */

const form = document.getElementById("aluno-login-form");
const infoEl = document.getElementById("aluno-login-info");
const submitBtn = form.querySelector('button[type="submit"]');

function showLoginMessage(msg, kind) {
  infoEl.textContent = msg;
  infoEl.className = `public-message ${kind}`;
  infoEl.style.display = "block";
}

/* ?preview=1 é o link de referência que fica no menu do CRM — sempre mostra
   a tela de login, mesmo que quem clicou já esteja logado (como equipe) no
   mesmo navegador. */
const isPreview = new URLSearchParams(window.location.search).get("preview") === "1";

(async () => {
  if (isPreview) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session) window.location.href = "area-aluno-dashboard.html";
})();

const LOGIN_ERROR_MESSAGES = {
  "Invalid login credentials": "E-mail ou senha inválidos.",
};

form.addEventListener("submit", async e => {
  e.preventDefault();
  infoEl.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.textContent = "Entrando…";

  const email = document.getElementById("aluno-login-email").value.trim().toLowerCase();
  const password = document.getElementById("aluno-login-password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  submitBtn.disabled = false;
  submitBtn.textContent = "Entrar";

  if (error) {
    showLoginMessage(LOGIN_ERROR_MESSAGES[error.message] || "Não consegui entrar. Tente novamente.", "error");
    return;
  }

  window.location.href = "area-aluno-dashboard.html";
});

/* ---- esqueci minha senha ---- */
const forgotForm = document.getElementById("aluno-forgot-form");
const forgotToggle = document.getElementById("aluno-login-forgot-toggle");
const forgotBack = document.getElementById("aluno-login-forgot-back");
const forgotInfoEl = document.getElementById("aluno-forgot-info");

forgotToggle.addEventListener("click", () => {
  form.style.display = "none";
  forgotForm.style.display = "flex";
  infoEl.style.display = "none";
  forgotInfoEl.style.display = "none";
});
forgotBack.addEventListener("click", () => {
  forgotForm.style.display = "none";
  form.style.display = "flex";
});

forgotForm.addEventListener("submit", async e => {
  e.preventDefault();
  forgotInfoEl.style.display = "none";

  const email = document.getElementById("aluno-forgot-email").value.trim().toLowerCase();
  const forgotSubmitBtn = forgotForm.querySelector('button[type="submit"]');
  forgotSubmitBtn.disabled = true;
  forgotSubmitBtn.textContent = "Enviando…";

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname.replace(/area-aluno-login\.html$/, "")}redefinir-senha.html?dest=aluno`,
  });

  forgotSubmitBtn.disabled = false;
  forgotSubmitBtn.textContent = "Enviar link";

  if (error) {
    forgotInfoEl.textContent = "Não foi possível enviar o link. Verifique o e-mail e tente novamente.";
    forgotInfoEl.className = "public-message error";
    forgotInfoEl.style.display = "block";
    return;
  }
  forgotInfoEl.textContent = "Link enviado! Confira seu e-mail.";
  forgotInfoEl.className = "public-message success";
  forgotInfoEl.style.display = "block";
});
