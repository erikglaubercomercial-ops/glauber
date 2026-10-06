/* ============================================================
   PÁGINA PÚBLICA DE APROVAÇÃO DA COTAÇÃO — sem login, por token (?t=...).
   O lead lê a cotação, marca "li e concordo" e aprova; o banco grava a
   aprovação (RPC approve_quote_public) e libera o contrato no CRM.
   Depende de config.js (`supabase`) e contrato-modelo.js.
   ============================================================ */

const qaToken = new URLSearchParams(window.location.search).get("t");
const $qa = id => document.getElementById(id);
let qaQuote = null;
const QA_V = (document.querySelector('link[rel="stylesheet"]').getAttribute("href").match(/\?v=(\d+)/) || [])[1] || "";

/* a cotação em PDF: a mesma folha A4 que o CRM gera em "Gerar cotação (PDF)" */
function qaSheetDocument(q) {
  const esc = contratoEsc, money = contratoMoney;
  /* escola primeiro, depois os serviços extras */
  const itens = (Array.isArray(q.items_detail) ? q.items_detail : []).slice().sort((a, b) => (a.escola ? 0 : 1) - (b.escola ? 0 : 1));
  const rows = itens.map(it => {
    const subs = (it.subs || []).map(sb => `<tr class="subrow-doc"><td class="name">${esc(sb.nome)}</td><td class="c"></td><td class="r"></td><td class="tot">${money(sb.valor)}</td></tr>`).join("");
    const meta = [it.escola, it.turno].filter(Boolean);
    const metaHtml = meta.length ? `<div class="item-meta"><b>${esc(meta[0])}</b>${meta.length > 1 ? ` · ${esc(meta.slice(1).join(" · "))}` : ""}</div>` : "";
    return `<tr class="item"><td>${esc(it.nome)}${metaHtml}</td><td class="c">${esc(it.qtd)}</td><td class="r">${money(it.preco)}</td><td class="tot">${money(it.total)}</td></tr>${subs}`;
  }).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="style.css${QA_V ? `?v=${QA_V}` : ""}">
<style>
  body { display: block !important; min-height: 0; background: #EDF1F6; padding: 18px 10px 28px; margin: 0; }
  .sheet { margin: 0 auto; }
  @media print {
    body * { visibility: visible !important; }
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border-radius: 0; }
    @page { size: A4; margin: 0; }
  }
</style></head><body>
<div class="sheet"><div class="sheet-inner">
  <div class="doc-head"><div class="rule"></div>
    <img src="assets/peregrinos-logo.png" alt="Peregrinos Intercâmbio">
    <div class="title-row"><h2>COTAÇÃO</h2>
      <div class="dates">Emitida em: <b>${esc(contratoDataBr(q.emissao) || "—")}</b><br>Válida até: <b>${esc(contratoDataBr(q.validade) || "—")}</b></div>
    </div>
    <div class="infobox">
      <div><div class="lbl">Estudante</div><div class="val">${esc(q.client)}</div></div>
      <div><div class="lbl">E-mail</div><div class="val">${esc(q.email)}</div></div>
      <div><div class="lbl">Cotação</div><div class="val">Cotação para ${esc(q.client)}</div></div>
      <div><div class="lbl">Status</div><div class="val">${esc(q.aprovada_em ? "Aprovada" : q.status)}</div></div>
      <div><div class="lbl">Consultor</div><div class="val">${esc(q.consultor_name)}</div></div>
      <div><div class="lbl">E-mail do consultor</div><div class="val">${esc(q.consultor_email)}</div></div>
    </div>
  </div>
  <table><thead><tr><th>Serviço</th><th class="c">Qtd.</th><th class="r">Unitário</th><th class="t">Total</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><div class="line"><span>Subtotal</span><span>${money(q.value)}</span></div><div class="line grand"><span>Total</span><span>${money(q.value)}</span></div></div>
  ${q.observacoes ? `<div class="obs"><div class="lbl">Observações</div><span>${esc(q.observacoes)}</span></div>` : ""}
  <div class="doc-foot"><div class="slogan">O caminho transforma.</div><div class="rule"></div></div>
</div></div></body></html>`;
}

function qaShow(state) {
  $qa("qa-loading").style.display = state === "loading" ? "block" : "none";
  $qa("qa-error").style.display = state === "error" ? "block" : "none";
  $qa("qa-main").style.display = state === "main" ? "block" : "none";
}
function qaError(msg) { $qa("qa-error-text").textContent = msg; qaShow("error"); }

function qaRenderApproved(when) {
  $qa("qa-approve-box").style.display = "none";
  const dt = when ? new Date(when).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
  $qa("qa-done").textContent = `Cotação aprovada${dt ? ` em ${dt}` : ""}. Obrigado! Seu consultor vai preparar o contrato e enviar o link para você.`;
  $qa("qa-done").style.display = "block";
  $qa("qa-print-row").style.display = "flex";
}

(async () => {
  if (!qaToken) { qaError("Link inválido. Peça um novo link ao seu consultor."); return; }
  const { data, error } = await supabase.rpc("get_quote_public", { p_token: qaToken });
  if (error || !data) { qaShow("error"); return; }
  qaQuote = data;

  $qa("qa-subtitle").textContent = `Cotação nº ${data.numero}${data.validade ? ` · válida até ${contratoDataBr(data.validade)}` : ""}`;
  document.title = `Cotação nº ${data.numero} — Peregrinos Intercâmbio`;
  $qa("qa-doc").srcdoc = qaSheetDocument(data);
  qaShow("main");

  if (data.aprovada_em) { qaRenderApproved(data.aprovada_em); return; }
  if (data.status === "Recusada") { qaError("Esta cotação não está mais disponível. Fale com o seu consultor."); return; }
  if (data.vencida) {
    $qa("qa-approve-box").style.display = "none";
    $qa("qa-done").className = "public-message error";
    $qa("qa-done").textContent = "Esta cotação está vencida. Fale com o seu consultor para receber uma atualizada.";
    $qa("qa-done").style.display = "block";
  }
})();

$qa("qa-accept").addEventListener("change", () => { $qa("qa-approve").disabled = !$qa("qa-accept").checked; });

function qaMessage(raw) {
  const m = String(raw || "");
  if (m.includes("cotacao_vencida")) return "Esta cotação está vencida. Fale com o seu consultor.";
  if (m.includes("cotacao_indisponivel")) return "Esta cotação não está mais disponível. Fale com o seu consultor.";
  if (m.includes("aceite_obrigatorio")) return "Marque a caixa de concordância para aprovar.";
  return "Não foi possível registrar a aprovação agora. Tente de novo em instantes.";
}

$qa("qa-approve").addEventListener("click", async () => {
  const err = $qa("qa-approve-error");
  err.style.display = "none";
  const btn = $qa("qa-approve");
  btn.disabled = true; btn.textContent = "Aprovando...";
  const { data, error } = await supabase.rpc("approve_quote_public", {
    p_token: qaToken, p_aceite: $qa("qa-accept").checked, p_user_agent: navigator.userAgent,
  });
  btn.textContent = "Aprovar cotação";
  if (error || !data || !data.ok) {
    btn.disabled = !$qa("qa-accept").checked;
    err.textContent = qaMessage(error && error.message);
    err.style.display = "block";
    return;
  }
  qaRenderApproved(new Date().toISOString());
});

$qa("qa-print").addEventListener("click", () => {
  const f = $qa("qa-doc");
  f.contentWindow.focus();
  f.contentWindow.print();
});
