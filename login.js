const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");
const submitBtn = form.querySelector('button[type="submit"]');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}

(async () => {
  const existing = await getSession();
  if (existing) window.location.href = "index.html";
})();

const LOGIN_ERROR_MESSAGES = {
  "Invalid login credentials": "E-mail ou senha inválidos.",
};

form.addEventListener("submit", async e => {
  e.preventDefault();
  errorEl.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.textContent = "Entrando…";

  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    showError(LOGIN_ERROR_MESSAGES[error.message] || "Não consegui entrar. Tente novamente.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Entrar";
    return;
  }

  const session = await getSession();
  if (!session) {
    showError("Este usuário está desativado. Fale com o administrador.");
    await supabase.auth.signOut();
    submitBtn.disabled = false;
    submitBtn.textContent = "Entrar";
    return;
  }

  window.location.href = "index.html";
});

/* ---- esqueci minha senha ---- */
const forgotForm = document.getElementById("forgot-form");
const forgotToggle = document.getElementById("login-forgot-toggle");
const forgotBack = document.getElementById("login-forgot-back");
const forgotErrorEl = document.getElementById("forgot-error");
const forgotSuccessEl = document.getElementById("forgot-success");

forgotToggle.addEventListener("click", () => {
  form.style.display = "none";
  forgotForm.style.display = "flex";
  forgotErrorEl.style.display = "none";
  forgotSuccessEl.style.display = "none";
});
forgotBack.addEventListener("click", () => {
  forgotForm.style.display = "none";
  form.style.display = "flex";
});

forgotForm.addEventListener("submit", async e => {
  e.preventDefault();
  forgotErrorEl.style.display = "none";
  forgotSuccessEl.style.display = "none";

  const email = document.getElementById("forgot-email").value.trim().toLowerCase();
  const forgotSubmitBtn = forgotForm.querySelector('button[type="submit"]');
  forgotSubmitBtn.disabled = true;
  forgotSubmitBtn.textContent = "Enviando…";

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname.replace(/login\.html$/, "")}redefinir-senha.html`,
  });

  forgotSubmitBtn.disabled = false;
  forgotSubmitBtn.textContent = "Enviar link";

  if (error) {
    forgotErrorEl.textContent = "Não foi possível enviar o link. Verifique o e-mail e tente novamente.";
    forgotErrorEl.style.display = "block";
    return;
  }
  forgotSuccessEl.style.display = "block";
});
