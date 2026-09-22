/* ============================================================
   PÁGINA PÚBLICA DE CADASTRO DE COLABORADOR — sem login, sem
   token: é um único link fixo, o mesmo para qualquer novo
   colaborador. Ao enviar, cria um cadastro novo direto no banco
   via função RPC security definer (create_collaborator_public).
   Depende de config.js (variável global `supabase`) já carregado.
   ============================================================ */

const form = document.getElementById("pc-form");
const submitBtn = document.getElementById("pc-submit");
const successEl = document.getElementById("pc-success");

const DOC_UPLOADS = [
  { input: "pc-id-document", field: "id_document_path", slug: "rg-cpf" },
  { input: "pc-address-proof", field: "address_proof_path", slug: "comprovante-residencia" },
  { input: "pc-photo", field: "photo_path", slug: "foto-3x4" },
  { input: "pc-resume", field: "resume_path", slug: "curriculo" },
  { input: "pc-work-card", field: "work_card_path", slug: "carteira-trabalho" },
];

form.addEventListener("submit", async e => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando…";
  successEl.style.display = "none";

  const collabId = crypto.randomUUID();

  const payload = {
    name: document.getElementById("pc-name").value.trim(),
    birth_date: document.getElementById("pc-birth-date").value || null,
    nationality: document.getElementById("pc-nationality").value.trim(),
    cpf: document.getElementById("pc-cpf").value.trim(),
    rg: document.getElementById("pc-rg").value.trim(),
    marital_status: document.getElementById("pc-marital-status").value,
    personal_phone: document.getElementById("pc-phone").value.trim(),
    personal_email: document.getElementById("pc-email").value.trim(),
    emergency_name: document.getElementById("pc-emergency-name").value.trim(),
    emergency_relationship: document.getElementById("pc-emergency-relationship").value.trim(),
    emergency_phone: document.getElementById("pc-emergency-phone").value.trim(),
    address_street: document.getElementById("pc-street").value.trim(),
    address_number: document.getElementById("pc-number").value.trim(),
    address_complement: document.getElementById("pc-complement").value.trim(),
    address_neighborhood: document.getElementById("pc-neighborhood").value.trim(),
    address_city: document.getElementById("pc-city").value.trim(),
    address_state: document.getElementById("pc-state").value.trim(),
    address_zip: document.getElementById("pc-zip").value.trim(),
  };

  for (const doc of DOC_UPLOADS) {
    const file = document.getElementById(doc.input).files[0];
    if (!file) continue;
    if (file.size > 8 * 1024 * 1024) {
      alert("Cada arquivo precisa ter até 8MB.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar meus dados";
      return;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${collabId}/${doc.slug}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("collaborator-documents").upload(path, file);
    if (uploadError) {
      alert("Não foi possível enviar um dos arquivos. Tente novamente.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar meus dados";
      return;
    }
    payload[doc.field] = path;
  }

  const { error } = await supabase.rpc("create_collaborator_public", { p_id: collabId, p_data: payload });

  submitBtn.disabled = false;
  submitBtn.textContent = "Enviar meus dados";

  if (error) {
    alert("Não foi possível salvar seus dados. Tente novamente em instantes.");
    return;
  }
  form.reset();
  form.style.display = "none";
  successEl.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
});
