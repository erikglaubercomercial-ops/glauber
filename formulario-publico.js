/* ============================================================
   PÁGINA PÚBLICA DE FORMULÁRIO — sem login. Link fixo por
   formulário (?f=slug), o mesmo pra qualquer pessoa que vá
   responder. Os campos são montados dinamicamente a partir da
   definição salva no banco (get_form_by_slug); o envio cria um
   lead automaticamente (submit_form_public), sem passar por aqui.
   Depende de config.js (variável global `supabase`) já carregado.
   ============================================================ */

const params = new URLSearchParams(window.location.search);
const slug = params.get("f");

const loadingEl = document.getElementById("pf-loading");
const errorEl = document.getElementById("pf-error");
const contentEl = document.getElementById("pf-content");
const form = document.getElementById("pf-form");
const successEl = document.getElementById("pf-success");

let currentFields = [];

function escapeHtmlPublic(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fieldInputHtml(f) {
  const req = f.required ? "required" : "";
  const reqMark = f.required ? ' <span class="public-required">*</span>' : "";
  const label = `<span>${escapeHtmlPublic(f.label)}${reqMark}</span>`;

  switch (f.type) {
    case "email":
      return `<label>${label}<input type="email" name="${f.id}" ${req}></label>`;
    case "phone_br":
      return `<label>${label}<input type="tel" name="${f.id}" inputmode="numeric" placeholder="(11) 99999-0000" ${req}></label>`;
    case "date":
      return `<label>${label}<input type="date" name="${f.id}" ${req}></label>`;
    case "textarea":
      return `<label>${label}<textarea name="${f.id}" rows="3" ${req}></textarea></label>`;
    case "boolean":
      return `<label>${label}<span class="public-radio-group">
        <span class="public-radio-option"><input type="radio" name="${f.id}" value="Sim" ${req}> Sim</span>
        <span class="public-radio-option"><input type="radio" name="${f.id}" value="Não" ${req}> Não</span>
      </span></label>`;
    case "select":
    case "source": {
      const opts = (f.options || []).map(o => `<option value="${escapeHtmlPublic(o)}">${escapeHtmlPublic(o)}</option>`).join("");
      return `<label>${label}<select name="${f.id}" ${req}><option value="">Selecione</option>${opts}</select></label>`;
    }
    case "name":
    case "text":
    default:
      return `<label>${label}<input type="text" name="${f.id}" ${req}></label>`;
  }
}

function formatPhoneInput(input) {
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").slice(0, 11);
    if (digits.length > 6) {
      input.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    } else if (digits.length > 2) {
      input.value = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    } else {
      input.value = digits;
    }
  });
}

(async () => {
  if (!slug) {
    loadingEl.style.display = "none";
    errorEl.style.display = "block";
    return;
  }

  const { data, error } = await supabase.rpc("get_form_by_slug", { p_slug: slug });
  if (error || !data || !data.id) {
    loadingEl.style.display = "none";
    errorEl.style.display = "block";
    return;
  }

  currentFields = data.fields || [];
  document.getElementById("pf-title").textContent = data.title || "Formulário";
  document.getElementById("pf-subtitle").textContent = data.subtitle || "";
  document.title = `${data.title || "Formulário"} — Peregrinos Intercâmbio`;

  form.innerHTML = currentFields.map(fieldInputHtml).join("") + `<button type="submit" class="btn btn-primary" id="pf-submit">Enviar</button>`;
  form.querySelectorAll('input[type="tel"]').forEach(formatPhoneInput);

  loadingEl.style.display = "none";
  contentEl.style.display = "block";
})();

form.addEventListener("submit", async e => {
  e.preventDefault();
  const submitBtn = document.getElementById("pf-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando…";

  const answers = {};
  currentFields.forEach(f => {
    if (f.type === "boolean") {
      const checked = form.querySelector(`input[name="${f.id}"]:checked`);
      answers[f.id] = checked ? checked.value : "";
    } else {
      const el = form.querySelector(`[name="${f.id}"]`);
      answers[f.id] = el ? el.value.trim() : "";
    }
  });

  const { error } = await supabase.rpc("submit_form_public", { p_slug: slug, p_answers: answers });

  if (error) {
    alert("Não foi possível enviar. Confira os campos e tente novamente.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Enviar";
    return;
  }

  form.style.display = "none";
  successEl.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
});
