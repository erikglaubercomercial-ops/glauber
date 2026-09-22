/* ============================================================
   PÁGINA PÚBLICA DE MATRÍCULA — sem login. O acesso é controlado
   pelo token secreto na URL (?token=...), validado no banco via
   funções RPC (get/update_enrollment_by_token). Depende de
   config.js (variável global `supabase`) já carregado.
   ============================================================ */
function formatDateBR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function currencyEUR(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
}

const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const loadingEl = document.getElementById("pm-loading");
const errorEl = document.getElementById("pm-error");
const contentEl = document.getElementById("pm-content");
const summaryEl = document.getElementById("pm-summary");
const form = document.getElementById("pm-form");
const submitBtn = document.getElementById("pm-submit");
const successEl = document.getElementById("pm-success");

let enrollment = null;

(async () => {
  if (!token) {
    loadingEl.style.display = "none";
    errorEl.style.display = "block";
    return;
  }

  const { data, error } = await supabase.rpc("get_enrollment_by_token", { p_token: token });
  if (error || !data || !data.id) {
    loadingEl.style.display = "none";
    errorEl.style.display = "block";
    return;
  }

  enrollment = data;
  summaryEl.innerHTML = `
    <div>Nome<b>${enrollment.name || "—"}</b></div>
    <div>Escola<b>${enrollment.school || "—"}</b></div>
    <div>Turno<b>${enrollment.turno || "—"}</b></div>
    <div>Valor do curso<b>${currencyEUR(enrollment.course_value)}</b></div>
    <div>Chegada<b>${formatDateBR(enrollment.arrival_date)}</b></div>
    <div>Início das aulas<b>${formatDateBR(enrollment.class_start_date)}</b></div>
  `;

  document.getElementById("pm-emergency").value = enrollment.emergency_phone || "";
  document.getElementById("pm-cpf").value = enrollment.cpf || "";
  document.getElementById("pm-passport-number").value = enrollment.passport_number || "";
  document.getElementById("pm-street").value = enrollment.address_street || "";
  document.getElementById("pm-number").value = enrollment.address_number || "";
  document.getElementById("pm-complement").value = enrollment.address_complement || "";
  document.getElementById("pm-neighborhood").value = enrollment.address_neighborhood || "";
  document.getElementById("pm-city").value = enrollment.address_city || "";
  document.getElementById("pm-state").value = enrollment.address_state || "";
  document.getElementById("pm-zip").value = enrollment.address_zip || "";

  loadingEl.style.display = "none";
  contentEl.style.display = "block";
})();

form.addEventListener("submit", async e => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando…";
  successEl.style.display = "none";

  let photoPath = null;
  const file = document.getElementById("pm-passport-photo").files[0];
  if (file) {
    if (file.size > 8 * 1024 * 1024) {
      alert("A foto precisa ter até 8MB.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar meus dados";
      return;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${enrollment.id}/passaporte-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("passport-photos").upload(path, file);
    if (uploadError) {
      alert("Não foi possível enviar a foto do passaporte. Tente novamente.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar meus dados";
      return;
    }
    photoPath = path;
  }

  const payload = {
    emergency_phone: document.getElementById("pm-emergency").value.trim(),
    cpf: document.getElementById("pm-cpf").value.trim(),
    passport_number: document.getElementById("pm-passport-number").value.trim(),
    address_street: document.getElementById("pm-street").value.trim(),
    address_number: document.getElementById("pm-number").value.trim(),
    address_complement: document.getElementById("pm-complement").value.trim(),
    address_neighborhood: document.getElementById("pm-neighborhood").value.trim(),
    address_city: document.getElementById("pm-city").value.trim(),
    address_state: document.getElementById("pm-state").value.trim(),
    address_zip: document.getElementById("pm-zip").value.trim(),
  };
  if (photoPath) payload.passport_photo_path = photoPath;

  const { error } = await supabase.rpc("update_enrollment_by_token", { p_token: token, p_data: payload });

  submitBtn.disabled = false;
  submitBtn.textContent = "Enviar meus dados";

  if (error) {
    alert("Não foi possível salvar seus dados. Tente novamente em instantes.");
    return;
  }
  successEl.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
});
