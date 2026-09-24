/* ============================================================
   REDEFINIR SENHA — página aberta a partir do link enviado por
   e-mail (supabase.auth.resetPasswordForEmail). Depende de
   config.js (variável global `supabase`) já carregado.
   ============================================================ */
const loadingEl = document.getElementById("rs-loading");
const invalidEl = document.getElementById("rs-invalid");
const formWrapEl = document.getElementById("rs-form-wrap");
const successEl = document.getElementById("rs-success");
const form = document.getElementById("rs-form");
const errorEl = document.getElementById("rs-error");

const isAluno = new URLSearchParams(window.location.search).get("dest") === "aluno";
const loginUrl = isAluno ? "area-aluno-login.html" : "login.html";
document.getElementById("rs-invalid-link").href = loginUrl;

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}

let resolved = false;
function showRecoveryForm() {
  if (resolved) return;
  resolved = true;
  loadingEl.style.display = "none";
  formWrapEl.style.display = "block";
}
function showInvalid() {
  if (resolved) return;
  resolved = true;
  loadingEl.style.display = "none";
  invalidEl.style.display = "block";
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY" || (event === "INITIAL_SESSION" && session)) {
    showRecoveryForm();
  }
});
setTimeout(showInvalid, 2500);

form.addEventListener("submit", async e => {
  e.preventDefault();
  errorEl.style.display = "none";

  const pw = document.getElementById("rs-password").value;
  const pwConfirm = document.getElementById("rs-password-confirm").value;

  if (pw.length < 6) { showError("A senha precisa ter pelo menos 6 caracteres."); return; }
  if (pw !== pwConfirm) { showError("As senhas não coincidem."); return; }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando…";

  const { error } = await supabase.auth.updateUser({ password: pw });

  submitBtn.disabled = false;
  submitBtn.textContent = "Salvar nova senha";

  if (error) {
    showError("Não foi possível salvar a nova senha. Peça um novo link e tente de novo.");
    return;
  }

  formWrapEl.style.display = "none";
  successEl.style.display = "block";
  await supabase.auth.signOut();
  setTimeout(() => { window.location.href = loginUrl; }, 2000);
});
