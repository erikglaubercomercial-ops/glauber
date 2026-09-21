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
