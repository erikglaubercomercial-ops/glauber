/* ============================================================
   MODELO DE CONTRATO — preenche o HTML do modelo ({{grupo.campo}}) e
   monta o documento completo (contrato + cotação + comprovante).
   Usado pelo CRM (prévia / contrato assinado) e pela página pública da
   proposta, sempre a partir dos mesmos dados, então o que o cliente vê
   é o que fica guardado.
   Sem dependências.
   ============================================================ */

/* campos que o lead preenche na etapa 1 (todos obrigatórios) */
const CONTRATO_CAMPOS = [
  { key: "nome", label: "Nome completo", autocomplete: "name", placeholder: "Como está no documento" },
  { key: "cpf", label: "CPF", autocomplete: "off", inputmode: "numeric", placeholder: "000.000.000-00" },
  { key: "documento", label: "Passaporte / documento", autocomplete: "off", placeholder: "Número do passaporte" },
  { key: "passaporte_expedicao", label: "Passaporte — data de expedição", type: "date", autocomplete: "off" },
  { key: "passaporte_validade", label: "Passaporte — validade", type: "date", autocomplete: "off" },
  { key: "data_nascimento", label: "Data de nascimento", type: "date", autocomplete: "bday" },
  { key: "data_chegada", label: "Data de chegada na Irlanda", type: "date", autocomplete: "off" },
  { key: "nacionalidade", label: "Nacionalidade", autocomplete: "off", placeholder: "Ex.: Brasileira" },
  { key: "endereco", label: "Endereço", autocomplete: "street-address", placeholder: "Rua, número, complemento, bairro", wide: true },
  { key: "cidade_estado", label: "Cidade / Estado", autocomplete: "off", placeholder: "Ex.: Curitiba / PR" },
  { key: "cep", label: "CEP", autocomplete: "postal-code", inputmode: "numeric", placeholder: "00000-000" },
  { key: "telefone", label: "Telefone / WhatsApp", type: "tel", autocomplete: "tel", placeholder: "+55 41 99999-0000" },
  { key: "email", label: "E-mail", type: "email", autocomplete: "email", placeholder: "nome@email.com" },
  { key: "contato_emergencia_nome", label: "Contato de emergência — nome", autocomplete: "off", placeholder: "Nome de quem avisar" },
  { key: "contato_emergencia_telefone", label: "Contato de emergência — telefone", type: "tel", autocomplete: "off", placeholder: "+55 41 99999-0000" },
];

function contratoEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* "2026-10-06" ou "2026-10-06T12:00:00Z" -> "06/10/2026" */
function contratoDataBr(v) {
  if (!v) return "";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  /* timestamp: usa o dia no fuso de São Paulo, não o dia em UTC */
  if (String(v).length > 10) {
    const d = new Date(v);
    if (!isNaN(d)) return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function contratoMoney(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
}

/* dados -> o que o modelo pode usar. `opts.assinadoEm` ausente = prévia (usa a data de hoje) */
function contratoContexto({ dados, numero, assinadoEm, cotacao }) {
  const d = dados || {};
  const cliente = {};
  CONTRATO_CAMPOS.forEach(c => { cliente[c.key] = String(d[c.key] || "").trim(); });
  cliente.data_nascimento = contratoDataBr(cliente.data_nascimento);
  cliente.passaporte_expedicao = contratoDataBr(cliente.passaporte_expedicao);
  cliente.passaporte_validade = contratoDataBr(cliente.passaporte_validade);
  cliente.data_chegada = contratoDataBr(cliente.data_chegada);
  const q = cotacao || {};
  return {
    cliente,
    contrato: {
      numero: numero || "",
      data_assinatura: contratoDataBr(assinadoEm) || new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    },
    cotacao: {
      numero: q.numero || "",
      total: q.value != null ? contratoMoney(q.value) : "",
      consultor: q.consultor_name || "",
      emissao: contratoDataBr(q.emissao),
      validade: contratoDataBr(q.validade),
    },
  };
}

const CONTRATO_VAR_RE = /\{\{\s*([a-z_]+)\.([a-z_]+)\s*\}\}/gi;

/* variáveis {{grupo.campo}} usadas num modelo, sem repetir */
const CONTRATO_COMENTARIO_RE = /<!--[\s\S]*?-->/g;

function contratoVariaveis(html) {
  const out = [];
  /* comentários HTML do modelo (anotações) não contam como variáveis */
  String(html || "").replace(CONTRATO_COMENTARIO_RE, "").replace(CONTRATO_VAR_RE, (_, g, c) => {
    const k = `${g.toLowerCase()}.${c.toLowerCase()}`;
    if (!out.includes(k)) out.push(k);
    return _;
  });
  return out;
}

function contratoValor(ctx, chave) {
  const [g, c] = chave.split(".");
  return ctx[g] && ctx[g][c] != null ? String(ctx[g][c]) : "";
}

/* variáveis do modelo que ainda estão vazias */
function contratoPendentes(html, ctx) {
  return contratoVariaveis(html).filter(k => !contratoValor(ctx, k).trim());
}

/* troca as variáveis (valores escapados). Na prévia, o que falta aparece destacado */
function contratoPreencher(html, ctx, { marcarPendentes = false } = {}) {
  return String(html || "").replace(CONTRATO_COMENTARIO_RE, "").replace(CONTRATO_VAR_RE, (_, g, c) => {
    const k = `${g.toLowerCase()}.${c.toLowerCase()}`;
    const v = contratoValor(ctx, k).trim();
    if (v) return contratoEsc(v);
    return marcarPendentes ? `<mark style="background:#fff3bf;padding:0 3px;border-radius:3px">[${contratoEsc(k)}]</mark>` : "";
  });
}

/* só na tela: o documento aparece como uma folha A4 centralizada (no PC o texto
   não se espalha pela largura toda); a impressão/PDF não muda */
const CONTRATO_TELA_CSS = `
  @media screen {
    html { background: #e9edf3; }
    body { max-width: 210mm; margin: 14px auto !important; padding: 14mm 16mm !important; background: #fff; box-shadow: 0 2px 14px rgba(0, 0, 0, 0.12); }
  }
`;

const CONTRATO_DOC_CSS = `
  .ct-extra { font-family: "Segoe UI", Arial, sans-serif; color: #1a2233; font-size: 11pt; padding: 0; }
  .ct-extra h2 { margin: 0 0 4mm; font-size: 15pt; color: #1f4670; }
  .ct-extra .sub { color: #65768b; font-size: 9.5pt; margin-bottom: 4mm; }
  .ct-extra table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  .ct-extra th { text-align: left; background: #1f4670; color: #fff; font-size: 9pt; letter-spacing: 0.06em; text-transform: uppercase; padding: 2.4mm 3mm; }
  .ct-extra th.r, .ct-extra td.r { text-align: right; white-space: nowrap; }
  .ct-extra th.c, .ct-extra td.c { text-align: center; }
  .ct-extra td { padding: 2.2mm 3mm; border-bottom: 1px solid #e4e9f0; font-size: 10.5pt; vertical-align: top; }
  .ct-extra td.item { font-weight: 700; color: #1f4670; }
  .ct-extra tr.sub td { background: #f7f9fc; color: #5c6b7d; font-size: 9.5pt; padding-left: 8mm; }
  .ct-extra .total { text-align: right; margin-top: 4mm; padding-top: 3mm; border-top: 3px solid #fb9d2d; font-size: 14pt; font-weight: 800; color: #1f4670; }
  .ct-extra .proof { margin-top: 8mm; border: 1px solid #e4e9f0; border-left: 4px solid #fb9d2d; border-radius: 8px; background: #f7f9fc; padding: 4mm 5mm; font-size: 10pt; line-height: 1.6; }
  .ct-extra .proof b { color: #1f4670; }
  .ct-break { page-break-before: always; break-before: page; }
`;

/* cotação (itens, subitens, total) para o final do documento */
function contratoCotacaoHtml(cotacao) {
  if (!cotacao) return "";
  /* escola primeiro, depois os serviços extras (cotações salvas em qualquer ordem) */
  const itens = (Array.isArray(cotacao.items_detail) ? cotacao.items_detail : []).slice().sort((a, b) => (a.escola ? 0 : 1) - (b.escola ? 0 : 1));
  const linhas = itens.map(it => {
    const meta = [it.escola, it.turno].filter(Boolean).join(" · ");
    const subs = (it.subs || []).map(s => `<tr class="sub"><td colspan="3">↳ ${contratoEsc(s.nome)}</td><td class="r">${s.valor ? contratoMoney(s.valor) : ""}</td></tr>`).join("");
    return `<tr><td class="item">${contratoEsc(it.nome)}${meta ? `<div style="font-weight:400;color:#65768b;font-size:9pt">${contratoEsc(meta)}</div>` : ""}</td><td class="c">${contratoEsc(it.qtd)}</td><td class="r">${contratoMoney(it.preco)}</td><td class="r">${contratoMoney(it.total)}</td></tr>${subs}`;
  }).join("");
  return `
    <h2>Cotação${cotacao.numero ? ` nº ${contratoEsc(cotacao.numero)}` : ""}</h2>
    <div class="sub">${contratoEsc(cotacao.client || "")}${cotacao.emissao ? ` · emitida em ${contratoDataBr(cotacao.emissao)}` : ""}${cotacao.validade ? ` · válida até ${contratoDataBr(cotacao.validade)}` : ""}${cotacao.consultor_name ? ` · consultor: ${contratoEsc(cotacao.consultor_name)}` : ""}</div>
    <table>
      <thead><tr><th>Produto / serviço</th><th class="c">Qtd</th><th class="r">Preço unit.</th><th class="r">Total</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <div class="total">Total ${contratoMoney(cotacao.value)}</div>
    ${cotacao.observacoes ? `<div class="sub" style="margin-top:4mm"><b>Observações:</b> ${contratoEsc(cotacao.observacoes)}</div>` : ""}`;
}

/* só a cotação, como folha A4 (página pública de aprovação) */
function contratoCotacaoDocumento(cotacao) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<style>body{font-family:"Segoe UI",Arial,sans-serif;color:#1a2233;line-height:1.5;margin:0;font-size:11pt}${CONTRATO_DOC_CSS}${CONTRATO_TELA_CSS}</style></head>`
    + `<body><div class="ct-extra">${contratoCotacaoHtml(cotacao)}</div></body></html>`;
}

/* comprovante do aceite eletrônico (só depois de assinado) */
function contratoComprovanteHtml(snapshot) {
  if (!snapshot || !snapshot.contrato) return "";
  const c = snapshot.contrato;
  const cli = snapshot.cliente || {};
  const quando = c.assinado_em ? new Date(c.assinado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
  return `
    <div class="proof">
      <b>Comprovante de aceite eletrônico</b><br>
      Contrato nº <b>${contratoEsc(c.numero)}</b> aceito por <b>${contratoEsc(cli.nome)}</b>${cli.cpf ? ` (CPF ${contratoEsc(cli.cpf)})` : ""}
      em <b>${contratoEsc(quando)}</b> (horário de Brasília).<br>
      Identidade confirmada por código enviado ao e-mail <b>${contratoEsc(c.email_confirmado)}</b>${c.ip ? ` · IP ${contratoEsc(c.ip)}` : ""}.<br>
      Assinatura eletrônica simples, com o aceite dos termos do contrato e confirmação por código (MP 2.200-2/2001 e Lei 14.063/2020).
    </div>`;
}

/* documento completo para iframe/impressão: contrato preenchido + cotação (+ comprovante) */
function contratoMontarDocumento({ templateHtml, ctx, cotacao, snapshot, marcarPendentes = false }) {
  const contrato = contratoPreencher(templateHtml, ctx, { marcarPendentes });
  const extra = `<div class="ct-break"></div><div class="ct-extra">${contratoCotacaoHtml(cotacao)}${contratoComprovanteHtml(snapshot)}</div>`;
  const style = `<style>${CONTRATO_DOC_CSS}${CONTRATO_TELA_CSS}</style>`;
  if (/<\/body>/i.test(contrato)) {
    let out = contrato.replace(/<\/body>/i, `${style}${extra}</body>`);
    return out;
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<style>body{font-family:"Segoe UI",Arial,sans-serif;color:#1a2233;line-height:1.55;margin:0;padding:12mm 14mm;font-size:11pt}</style></head>`
    + `<body>${contrato}${style}${extra}</body></html>`;
}
