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

/* países aceitos no telefone (mesma lista do cadastro de leads do CRM) */
const PF_COUNTRIES = [
  { code: "BR", name: "Brasil", ddi: "55", flag: "🇧🇷" },
  { code: "IE", name: "Irlanda", ddi: "353", flag: "🇮🇪" },
  { code: "PT", name: "Portugal", ddi: "351", flag: "🇵🇹" },
  { code: "US", name: "Estados Unidos", ddi: "1", flag: "🇺🇸" },
  { code: "CA", name: "Canadá", ddi: "1", flag: "🇨🇦" },
  { code: "GB", name: "Reino Unido", ddi: "44", flag: "🇬🇧" },
  { code: "ES", name: "Espanha", ddi: "34", flag: "🇪🇸" },
  { code: "FR", name: "França", ddi: "33", flag: "🇫🇷" },
  { code: "DE", name: "Alemanha", ddi: "49", flag: "🇩🇪" },
  { code: "IT", name: "Itália", ddi: "39", flag: "🇮🇹" },
  { code: "NL", name: "Holanda", ddi: "31", flag: "🇳🇱" },
  { code: "CH", name: "Suíça", ddi: "41", flag: "🇨🇭" },
  { code: "MT", name: "Malta", ddi: "356", flag: "🇲🇹" },
  { code: "AU", name: "Austrália", ddi: "61", flag: "🇦🇺" },
  { code: "NZ", name: "Nova Zelândia", ddi: "64", flag: "🇳🇿" },
  { code: "AR", name: "Argentina", ddi: "54", flag: "🇦🇷" },
  { code: "CL", name: "Chile", ddi: "56", flag: "🇨🇱" },
  { code: "CO", name: "Colômbia", ddi: "57", flag: "🇨🇴" },
  { code: "UY", name: "Uruguai", ddi: "598", flag: "🇺🇾" },
  { code: "PY", name: "Paraguai", ddi: "595", flag: "🇵🇾" },
  { code: "PE", name: "Peru", ddi: "51", flag: "🇵🇪" },
  { code: "MX", name: "México", ddi: "52", flag: "🇲🇽" },
  { code: "JP", name: "Japão", ddi: "81", flag: "🇯🇵" },
  { code: "CN", name: "China", ddi: "86", flag: "🇨🇳" },
  { code: "AO", name: "Angola", ddi: "244", flag: "🇦🇴" },
  { code: "MZ", name: "Moçambique", ddi: "258", flag: "🇲🇿" },
];
const PF_PLACEHOLDERS = { BR: "(11) 99999-0000", US: "(555) 123-4567", CA: "(555) 123-4567" };

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
    case "phone_br": {
      /* país (bandeira + DDI) ao lado do número: Brasil é o padrão */
      const countries = PF_COUNTRIES.map(c => `<option value="${c.code}">${c.flag} +${c.ddi} ${escapeHtmlPublic(c.name)}</option>`).join("");
      return `<label>${label}<span class="public-phone-row">
        <select name="${f.id}__pais" class="public-phone-country" aria-label="País / DDI">${countries}</select>
        <input type="tel" name="${f.id}" inputmode="numeric" placeholder="${PF_PLACEHOLDERS.BR}" ${req}>
      </span></label>`;
    }
    case "date":
      return `<label>${label}<input type="date" name="${f.id}" ${req}></label>`;
    case "textarea":
      return `<label>${label}<textarea name="${f.id}" rows="3" ${req}></textarea></label>`;
    case "boolean":
      return `<label>${label}<span class="public-radio-group">
        <span class="public-radio-option"><input type="radio" name="${f.id}" value="Sim" ${req}> ${t("form.yes")}</span>
        <span class="public-radio-option"><input type="radio" name="${f.id}" value="Não" ${req}> ${t("form.no")}</span>
      </span></label>`;
    case "select":
    case "source": {
      const opts = (f.options || []).map(o => `<option value="${escapeHtmlPublic(o)}">${escapeHtmlPublic(o)}</option>`).join("");
      return `<label>${label}<select name="${f.id}" ${req}><option value="">${t("common.select")}</option>${opts}</select></label>`;
    }
    case "name":
    case "text":
    default:
      return `<label>${label}<input type="text" name="${f.id}" ${req}></label>`;
  }
}

/* máscara conforme o país: Brasil (11) 99999-0000 · EUA/Canadá (555) 123-4567 · demais: só dígitos (código de área + número) */
function pfFormatPhone(digits, country) {
  if (country === "BR") {
    const d = digits.slice(0, 11);
    if (d.length > 6) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return d;
  }
  if (country === "US" || country === "CA") {
    const d = digits.slice(0, 10);
    if (d.length > 6) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length > 3) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return d;
  }
  return digits.slice(0, 15);
}
function formatPhoneInput(input) {
  const select = form.querySelector(`select[name="${input.name}__pais"]`);
  const apply = () => {
    const country = select ? select.value : "BR";
    let digits = input.value.replace(/\D/g, "");
    const ddi = (PF_COUNTRIES.find(c => c.code === country) || PF_COUNTRIES[0]).ddi;
    /* quem já digita o DDI junto (ex.: 55 11 99999-0000): tira o prefixo */
    if (country === "BR" && digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
    else if (country !== "BR" && country !== "US" && country !== "CA" && digits.startsWith(ddi) && digits.length > ddi.length + 8) digits = digits.slice(ddi.length);
    input.value = pfFormatPhone(digits, country);
  };
  input.addEventListener("input", apply);
  if (select) select.addEventListener("change", () => {
    input.placeholder = PF_PLACEHOLDERS[select.value] || t("form.phoneOtherPlaceholder");
    apply();
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
  document.getElementById("pf-title").textContent = data.title || t("form.title");
  document.getElementById("pf-subtitle").textContent = data.subtitle || "";
  document.title = `${data.title || t("form.title")} — Peregrinos Intercâmbio`;

  form.innerHTML = currentFields.map(fieldInputHtml).join("") + `<button type="submit" class="btn btn-primary" id="pf-submit">${t("form.submit")}</button>`;
  form.querySelectorAll('input[type="tel"]').forEach(formatPhoneInput);

  loadingEl.style.display = "none";
  contentEl.style.display = "block";
})();

form.addEventListener("submit", async e => {
  e.preventDefault();
  const submitBtn = document.getElementById("pf-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = t("auth.sending");

  const answers = {};
  currentFields.forEach(f => {
    if (f.type === "boolean") {
      const checked = form.querySelector(`input[name="${f.id}"]:checked`);
      answers[f.id] = checked ? checked.value : "";
    } else {
      const el = form.querySelector(`[name="${f.id}"]`);
      answers[f.id] = el ? el.value.trim() : "";
      if (f.type === "phone_br") {
        const sel = form.querySelector(`[name="${f.id}__pais"]`);
        answers[`${f.id}__pais`] = sel ? sel.value : "BR";
      }
    }
  });

  /* telefone com poucos dígitos não serve para o WhatsApp */
  const badPhone = currentFields.find(f => {
    if (f.type !== "phone_br") return false;
    const country = answers[`${f.id}__pais`];
    const digits = (answers[f.id] || "").replace(/\D/g, "");
    return (f.required || digits) && digits.length < ((country === "US" || country === "CA") ? 3 : 2) + 6;
  });
  if (badPhone) {
    alert(t("form.phoneInvalid"));
    const el = form.querySelector(`[name="${badPhone.id}"]`);
    if (el) el.focus();
    submitBtn.disabled = false;
    submitBtn.textContent = t("form.submit");
    return;
  }

  const { error } = await supabase.rpc("submit_form_public", { p_slug: slug, p_answers: answers });

  /* telefone ou e-mail já cadastrado (23505): do ponto de vista de quem
     preenche, já está na nossa base — mostra o agradecimento, não erro */
  const alreadyRegistered = error && error.code === "23505";
  if (error && !alreadyRegistered) {
    alert(t("form.sendError"));
    submitBtn.disabled = false;
    submitBtn.textContent = t("form.submit");
    return;
  }

  form.style.display = "none";
  successEl.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
});
