/* ============================================================
   TELA DE LOGIN — ÁREA DO ALUNO (ainda só visual, sem
   autenticação real por trás; o formulário não leva a lugar
   nenhum por enquanto).
   ============================================================ */

const form = document.getElementById("aluno-login-form");
const infoEl = document.getElementById("aluno-login-info");
const submitBtn = form.querySelector('button[type="submit"]');

form.addEventListener("submit", e => {
  e.preventDefault();
  infoEl.textContent = "Em breve você vai poder entrar por aqui — essa área ainda está em construção.";
  infoEl.style.display = "block";
});

/* ---- esqueci minha senha (só alterna a tela, visual) ---- */
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

forgotForm.addEventListener("submit", e => {
  e.preventDefault();
  forgotInfoEl.textContent = "Em breve você vai poder redefinir sua senha por aqui — essa área ainda está em construção.";
  forgotInfoEl.style.display = "block";
});
