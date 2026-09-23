/* ============================================================
   PÁGINA PÚBLICA DE ASSINATURA DE CONTRATO — sem login. Acesso via
   token secreto na URL (?token=...), validado no banco (RPC
   get_contract_by_token). A assinatura é eletrônica simples: nome +
   documento + desenho no canvas + data/hora + IP (capturado no
   banco). Ao confirmar, gera um PDF no próprio navegador (jsPDF),
   sobe pro bucket "contract-pdfs" e grava tudo via RPC
   sign_contract_public. Depende de config.js (variável global
   `supabase`) já carregado.
   ============================================================ */

const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const loadingEl = document.getElementById("pk-loading");
const errorEl = document.getElementById("pk-error");
const signedEl = document.getElementById("pk-signed");
const contentEl = document.getElementById("pk-content");
const successEl = document.getElementById("pk-success");
const form = document.getElementById("pk-form");
const submitBtn = document.getElementById("pk-submit");

let contract = null;

function showState(state) {
  loadingEl.style.display = state === "loading" ? "block" : "none";
  errorEl.style.display = state === "error" ? "block" : "none";
  signedEl.style.display = state === "signed" ? "block" : "none";
  contentEl.style.display = state === "content" ? "block" : "none";
}

(async () => {
  if (!token) { showState("error"); return; }

  const { data, error } = await supabase.rpc("get_contract_by_token", { p_token: token });
  if (error || !data || !data.id) { showState("error"); return; }

  contract = data;

  if (contract.status === "Assinado") { showState("signed"); return; }
  if (contract.status !== "Aguardando assinatura") { showState("error"); return; }

  document.getElementById("pk-title").textContent = contract.title || "Contrato";
  document.title = `${contract.title || "Contrato"} — Peregrinos Intercâmbio`;
  document.getElementById("pk-contract-text").textContent = contract.content || "";
  if (contract.lead_name) document.getElementById("pk-signer-name").value = contract.lead_name;

  showState("content");
  resizeCanvas();
})();

/* ---- assinatura desenhada no canvas (mouse + toque) ---- */
const canvas = document.getElementById("pk-signature-canvas");
const ctx = canvas.getContext("2d");
let drawing = false;
let hasSignature = false;

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#1a2233";
}
window.addEventListener("resize", () => {
  const data = hasSignature ? canvas.toDataURL() : null;
  resizeCanvas();
  if (data) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height); img.src = data; }
});

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  return { x: point.clientX - rect.left, y: point.clientY - rect.top };
}
function startDraw(e) {
  drawing = true;
  hasSignature = true;
  const p = pointerPos(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  e.preventDefault();
}
function moveDraw(e) {
  if (!drawing) return;
  const p = pointerPos(e);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  e.preventDefault();
}
function endDraw() { drawing = false; }

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", moveDraw);
window.addEventListener("mouseup", endDraw);
canvas.addEventListener("touchstart", startDraw, { passive: false });
canvas.addEventListener("touchmove", moveDraw, { passive: false });
canvas.addEventListener("touchend", endDraw);

document.getElementById("pk-btn-clear-signature").addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasSignature = false;
});

/* ---- envio: gera o PDF, sobe pro storage e grava a assinatura ---- */
function buildSignedPdfBlob(signerName, signerDocument, signatureDataUrl) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const marginX = 15;
  let y = 20;

  doc.setFontSize(14);
  doc.text(contract.title || "Contrato", marginX, y);
  y += 10;

  doc.setFontSize(10);
  const lines = doc.splitTextToSize(contract.content || "", 180);
  lines.forEach(line => {
    if (y > 280) { doc.addPage(); y = 20; }
    doc.text(line, marginX, y);
    y += 5;
  });

  y += 10;
  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFontSize(11);
  doc.text("Assinatura eletrônica", marginX, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Assinado por: ${signerName}`, marginX, y); y += 6;
  doc.text(`Documento: ${signerDocument || "—"}`, marginX, y); y += 6;
  doc.text(`Data/hora: ${new Date().toLocaleString("pt-BR")}`, marginX, y); y += 8;
  if (y + 30 > 290) { doc.addPage(); y = 20; }
  doc.addImage(signatureDataUrl, "PNG", marginX, y, 70, 28);

  return doc.output("blob");
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (!hasSignature) {
    alert("Desenhe sua assinatura antes de continuar.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando…";

  const signerName = document.getElementById("pk-signer-name").value.trim();
  const signerDocument = document.getElementById("pk-signer-document").value.trim();
  const signatureDataUrl = canvas.toDataURL("image/png");

  try {
    const pdfBlob = buildSignedPdfBlob(signerName, signerDocument, signatureDataUrl);
    const pdfPath = `${token}/contrato-assinado-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage.from("contract-pdfs").upload(pdfPath, pdfBlob, { contentType: "application/pdf" });
    if (uploadError) throw uploadError;

    const { error: signError } = await supabase.rpc("sign_contract_public", {
      p_token: token,
      p_signer_name: signerName,
      p_signer_document: signerDocument,
      p_signature_data: signatureDataUrl,
      p_pdf_path: pdfPath,
    });
    if (signError) throw signError;

    form.style.display = "none";
    document.getElementById("pk-contract-text").style.display = "none";
    successEl.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    alert("Não foi possível registrar sua assinatura. Tente novamente em instantes.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Assinar contrato";
  }
});
