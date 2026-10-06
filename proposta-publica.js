/* ============================================================
   PÁGINA PÚBLICA DA PROPOSTA (cotação + contrato) — sem login.
   Acesso por token secreto (?t=...). Três etapas:
     1) o lead confere/preenche os dados  (RPC save_proposal_data)
     2) lê a cotação e o contrato até o fim
     3) aceita os termos e confirma com um código enviado ao e-mail
        (RPC request_proposal_code / sign_proposal)
   Depende de config.js (`supabase`) e contrato-modelo.js.
   ============================================================ */

const ppToken = new URLSearchParams(window.location.search).get("t");
const $pp = id => document.getElementById(id);

let ppData = null;          /* resposta de get_proposal */
let ppDados = {};           /* dados do lead na etapa 1 */
let ppStep = 1;
let ppCooldown = null;

function ppShow(state) {
  $pp("pp-loading").style.display = state === "loading" ? "block" : "none";
  $pp("pp-error").style.display = state === "error" ? "block" : "none";
  $pp("pp-main").style.display = state === "main" ? "block" : "none";
}
function ppError(msg) { $pp("pp-error-text").textContent = msg; ppShow("error"); }

function ppGoto(step) {
  ppStep = step;
  document.querySelectorAll(".pp-step").forEach(s => { s.style.display = String(s.dataset.step) === String(step) ? "" : "none"; });
  document.querySelectorAll("#pp-steps li").forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle("active", step !== "done" && n === step);
    li.classList.toggle("done", step === "done" || (typeof step === "number" && n < step));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------------- carregamento ---------------- */
(async () => {
  if (!ppToken) { ppError("Link inválido. Peça um novo link ao seu consultor."); return; }
  const { data, error } = await supabase.rpc("get_proposal", { p_token: ppToken });
  if (error || !data) { ppShow("error"); return; }
  ppData = data;

  if (data.status === "Cancelado") { ppError("Esta proposta foi cancelada. Fale com o seu consultor."); return; }
  if (!data.template_html) { ppError("O contrato desta proposta ainda não está disponível. Fale com o seu consultor."); return; }

  $pp("pp-subtitle").textContent = `Contrato nº ${data.numero}${data.cotacao && data.cotacao.numero ? ` · Cotação nº ${data.cotacao.numero}` : ""}`;
  document.title = `Contrato nº ${data.numero} — Peregrinos Intercâmbio`;

  if (data.status === "Assinado") { ppShowSigned(); return; }

  /* dados já salvos pelo próprio lead têm prioridade sobre o que veio do cadastro */
  ppDados = { ...(data.prefill || {}), ...Object.fromEntries(Object.entries(data.dados_cliente || {}).filter(([, v]) => v)) };
  ppRenderFields();
  ppRenderPassport();
  ppShow("main");
  ppGoto(1);
})();

/* ---------------- etapa 1 ---------------- */
function ppRenderFields() {
  $pp("pp-fields").innerHTML = CONTRATO_CAMPOS.map(c => `
    <label class="pp-field${c.wide ? " wide" : ""}"><span>${contratoEsc(c.label)} *</span>
      <input type="${c.type || "text"}" id="pp-f-${c.key}" name="${c.key}" value="${contratoEsc(ppDados[c.key] || "")}"
        autocomplete="${c.autocomplete || "off"}"${c.inputmode ? ` inputmode="${c.inputmode}"` : ""}${c.placeholder ? ` placeholder="${contratoEsc(c.placeholder)}"` : ""}>
    </label>`).join("");
}

function ppReadFields() {
  const out = {};
  CONTRATO_CAMPOS.forEach(c => { out[c.key] = ($pp(`pp-f-${c.key}`).value || "").trim(); });
  out.passaporte_path = ppDados.passaporte_path || "";
  return out;
}

/* ---- passaporte (foto ou PDF): vai direto para o bucket privado, numa pasta desta proposta ---- */
const PP_MAX_BYTES = 10 * 1024 * 1024;
function ppRenderPassport() {
  const sent = !!ppDados.passaporte_path;
  $pp("pp-passport-btn").textContent = sent ? "Trocar passaporte" : "Enviar passaporte";
  $pp("pp-passport-status").textContent = sent ? "✓ Passaporte enviado." : "";
}
$pp("pp-passport-btn").addEventListener("click", () => $pp("pp-passport-file").click());
$pp("pp-passport-file").addEventListener("change", async e => {
  const input = e.target, file = input.files[0];
  input.value = "";
  if (!file) return;
  const status = $pp("pp-passport-status");
  if (file.size > PP_MAX_BYTES) { status.textContent = "Arquivo acima de 10 MB. Envie um menor."; return; }
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `proposta/${ppToken}/passaporte-${Date.now()}.${ext}`;
  $pp("pp-passport-btn").disabled = true;
  status.textContent = "Enviando…";
  const { error } = await supabase.storage.from("passport-photos").upload(path, file);
  $pp("pp-passport-btn").disabled = false;
  if (error) { console.error("Erro ao enviar passaporte:", error); status.textContent = "Não foi possível enviar o arquivo. Tente de novo."; return; }
  ppDados.passaporte_path = path;
  ppRenderPassport();
});

$pp("pp-form").addEventListener("submit", async e => {
  e.preventDefault();
  const dados = ppReadFields();
  const faltando = CONTRATO_CAMPOS.filter(c => !dados[c.key]);
  CONTRATO_CAMPOS.forEach(c => $pp(`pp-f-${c.key}`).classList.toggle("err", !dados[c.key]));
  const err = $pp("pp-form-error");
  if (faltando.length) {
    err.textContent = `Preencha: ${faltando.map(c => c.label).join(", ")}.`;
    err.style.display = "block";
    $pp(`pp-f-${faltando[0].key}`).focus();
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dados.email)) {
    err.textContent = "Informe um e-mail válido: o código de confirmação será enviado para ele.";
    err.style.display = "block";
    $pp("pp-f-email").classList.add("err");
    return;
  }
  err.style.display = "none";
  const btn = $pp("pp-save");
  btn.disabled = true; btn.textContent = "Salvando...";
  const { error } = await supabase.rpc("save_proposal_data", { p_token: ppToken, p_dados: dados });
  btn.disabled = false; btn.textContent = "Continuar";
  if (error) {
    err.textContent = ppMessage(error.message, "Não foi possível salvar seus dados. Tente de novo.");
    err.style.display = "block";
    return;
  }
  ppDados = dados;
  ppRenderDoc();
  ppGoto(2);
});

/* ---------------- etapa 2 ---------------- */
function ppRenderDoc() {
  const d = ppData;
  const ctx = contratoContexto({ dados: ppDados, numero: d.numero, cotacao: d.cotacao });
  const q = d.cotacao;
  $pp("pp-quote-bar").innerHTML = q
    ? `<span>Cotação nº <b>${contratoEsc(q.numero)}</b></span><span>Total <b>${contratoMoney(q.value)}</b></span>`
    : "";
  const frame = $pp("pp-doc");
  $pp("pp-to-3").disabled = true;
  $pp("pp-scroll-hint").style.display = "";
  frame.onload = () => ppWatchScroll(frame);
  frame.srcdoc = contratoMontarDocumento({ templateHtml: d.template_html, ctx, cotacao: q });
}

function ppWatchScroll(frame) {
  let doc, win;
  try { doc = frame.contentDocument; win = frame.contentWindow; } catch (err) { doc = null; }
  const release = () => { $pp("pp-to-3").disabled = false; $pp("pp-scroll-hint").style.display = "none"; };
  if (!doc || !win) { release(); return; }
  const check = () => {
    const el = doc.scrollingElement || doc.documentElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) release();
  };
  win.addEventListener("scroll", check, { passive: true });
  /* reserva: confere de tempos em tempos (cobre rolagem sem evento e documento curto) */
  const iv = setInterval(() => { check(); if (!$pp("pp-to-3").disabled) clearInterval(iv); }, 500);
  setTimeout(check, 300);
}

$pp("pp-back-1").addEventListener("click", () => ppGoto(1));
$pp("pp-to-3").addEventListener("click", () => {
  $pp("pp-accept").checked = false;
  $pp("pp-send-code").disabled = true;
  ppGoto(3);
});

/* ---------------- etapa 3 ---------------- */
$pp("pp-back-2").addEventListener("click", () => ppGoto(2));
$pp("pp-accept").addEventListener("change", () => {
  $pp("pp-send-code").disabled = !$pp("pp-accept").checked || !!ppCooldown;
  if (!$pp("pp-accept").checked) $pp("pp-sign").disabled = true; else ppUpdateSignButton();
});
$pp("pp-code").addEventListener("input", () => {
  $pp("pp-code").value = $pp("pp-code").value.replace(/\D/g, "").slice(0, 6);
  ppUpdateSignButton();
});
function ppUpdateSignButton() {
  $pp("pp-sign").disabled = !($pp("pp-accept").checked && $pp("pp-code").value.length === 6);
}

function ppSignError(msg) {
  const el = $pp("pp-sign-error");
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

/* mensagens amigáveis para os erros das funções do banco */
function ppMessage(raw, fallback) {
  const m = String(raw || "");
  const map = [
    ["email_nao_configurado", "O envio do código por e-mail ainda não está disponível. Fale com o seu consultor."],
    ["aguarde_para_reenviar", "Aguarde um minuto para pedir um novo código."],
    ["limite_de_codigos", "Muitos códigos pedidos. Tente de novo mais tarde ou fale com o seu consultor."],
    ["email_invalido", "O e-mail informado não é válido. Volte e corrija seus dados."],
    ["dados_incompletos", "Faltam dados obrigatórios. Volte à primeira etapa e complete."],
    ["aceite_obrigatorio", "Marque o aceite dos termos para assinar."],
    ["proposta_indisponivel", "Esta proposta não está mais disponível para assinatura."],
  ];
  const hit = map.find(([k]) => m.includes(k));
  return hit ? hit[1] : fallback;
}

function ppStartCooldown(seconds) {
  clearInterval(ppCooldown);
  let left = seconds;
  const btn = $pp("pp-send-code");
  const tick = () => {
    if (left <= 0) {
      clearInterval(ppCooldown); ppCooldown = null;
      btn.textContent = "Reenviar código";
      btn.disabled = !$pp("pp-accept").checked;
      return;
    }
    btn.disabled = true;
    btn.textContent = `Reenviar em ${left}s`;
    left -= 1;
  };
  tick();
  ppCooldown = setInterval(tick, 1000);
}

$pp("pp-send-code").addEventListener("click", async () => {
  ppSignError("");
  const btn = $pp("pp-send-code");
  btn.disabled = true; btn.textContent = "Enviando...";
  const { data, error } = await supabase.rpc("request_proposal_code", { p_token: ppToken });
  if (error) {
    btn.textContent = "Enviar código por e-mail";
    btn.disabled = !$pp("pp-accept").checked;
    ppSignError(ppMessage(error.message, "Não foi possível enviar o código agora. Tente de novo em instantes."));
    return;
  }
  $pp("pp-send-info").textContent = `Código enviado para ${data.email_mascarado}. Confira também a caixa de spam.`;
  $pp("pp-code-row").style.display = "";
  $pp("pp-code").focus();
  ppStartCooldown(60);
});

$pp("pp-sign").addEventListener("click", async () => {
  ppSignError("");
  const btn = $pp("pp-sign");
  btn.disabled = true; btn.textContent = "Assinando...";
  const { data, error } = await supabase.rpc("sign_proposal", {
    p_token: ppToken, p_code: $pp("pp-code").value, p_aceite: $pp("pp-accept").checked, p_user_agent: navigator.userAgent,
  });
  btn.textContent = "Assinar contrato";
  if (error) { ppUpdateSignButton(); ppSignError(ppMessage(error.message, "Não foi possível concluir a assinatura. Tente de novo.")); return; }
  if (!data || !data.ok) {
    ppUpdateSignButton();
    const erros = {
      codigo_invalido: `Código incorreto.${data && data.tentativas_restantes != null ? ` Você ainda tem ${data.tentativas_restantes} tentativa(s).` : ""}`,
      codigo_expirado: "O código expirou. Peça um novo código.",
      codigo_bloqueado: "Muitas tentativas incorretas. Peça um novo código.",
    };
    ppSignError(erros[data && data.erro] || "Não foi possível validar o código.");
    return;
  }
  /* recarrega do banco: o documento final e o comprovante vêm do snapshot gravado */
  const fresh = await supabase.rpc("get_proposal", { p_token: ppToken });
  if (fresh.data) ppData = fresh.data;
  ppShowSigned(true);
});

/* ---------------- assinado ---------------- */
function ppShowSigned(justNow) {
  ppShow("main");
  document.getElementById("pp-steps").style.display = "none";
  $pp("pp-done-text").textContent = justNow
    ? "Contrato assinado com sucesso! Uma cópia fica guardada com a equipe Peregrinos."
    : "Este contrato já foi assinado. Se precisar, salve a sua cópia abaixo.";
  ppGoto("done");
}

$pp("pp-print").addEventListener("click", () => {
  const snap = ppData && ppData.snapshot;
  if (!snap) { window.print(); return; }
  const ctx = contratoContexto({ dados: snap.cliente, numero: snap.contrato.numero, assinadoEm: snap.contrato.assinado_em, cotacao: snap.cotacao });
  const html = contratoMontarDocumento({ templateHtml: snap.template_html, ctx, cotacao: snap.cotacao, snapshot: snap });
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.srcdoc = html;
  frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); };
  document.body.appendChild(frame);
});
