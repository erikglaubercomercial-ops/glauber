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

form.addEventListener("submit", async e => {
  e.preventDefault();
  errorEl.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.textContent = t("auth.signingIn");

  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    showError(error.message === "Invalid login credentials" ? t("auth.invalidCredentials") : t("auth.genericSignInError"));
    submitBtn.disabled = false;
    submitBtn.textContent = t("auth.signIn");
    return;
  }

  const session = await getSession();
  if (!session) {
    showError(t("auth.userDisabled"));
    await supabase.auth.signOut();
    submitBtn.disabled = false;
    submitBtn.textContent = t("auth.signIn");
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
  forgotSubmitBtn.textContent = t("auth.sending");

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname.replace(/login\.html$/, "")}redefinir-senha.html`,
  });

  forgotSubmitBtn.disabled = false;
  forgotSubmitBtn.textContent = t("auth.sendLink");

  if (error) {
    forgotErrorEl.textContent = t("auth.sendLinkError");
    forgotErrorEl.style.display = "block";
    return;
  }
  forgotSuccessEl.style.display = "block";
});
