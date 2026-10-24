/* Regras puras do bot (sem rede): telefone, resumo, quando registrar o lead,
   leitura da resposta da IA. Testadas em test/regras.test.js. */

/* mesma lista de países (código + DDI) do script.js do CRM — o botão de
   WhatsApp do CRM monta DDI + DDD + número a partir do country_code */
export const PAISES = [
  ["BR", "55"], ["PT", "351"], ["IE", "353"], ["US", "1"], ["CA", "1"], ["GB", "44"],
  ["AU", "61"], ["NZ", "64"], ["ES", "34"], ["FR", "33"], ["DE", "49"], ["IT", "39"],
  ["NL", "31"], ["CH", "41"], ["MT", "356"], ["AR", "54"], ["CL", "56"], ["CO", "57"],
  ["UY", "598"], ["PY", "595"], ["PE", "51"], ["MX", "52"], ["JP", "81"], ["CN", "86"],
  ["AO", "244"], ["MZ", "258"],
];
const DDI_POR_PAIS = Object.fromEntries(PAISES);

export const LEAD_VAZIO = Object.freeze({
  nome: "", pais: "", ddd: "", whatsapp: "", email: "", destino: "", quando_viajar: "",
  objetivo: "", nivel_ingles: "", orcamento: "", temperatura: "",
});

const so_digitos = s => String(s ?? "").replace(/\D/g, "");

/* Separa o WhatsApp informado em país + dígitos locais (DDD + número, sem DDI).
   A função do banco (081) faz o corte DDD/número igual à tela de Leads.
   Devolve null quando não dá para montar um telefone confiável. */
export function normalizarTelefone(lead) {
  const bruto = String(lead?.whatsapp ?? "").trim();
  if (!bruto) return null;
  let digitos = so_digitos(bruto);
  const dddInformado = so_digitos(lead?.ddd);
  let pais = String(lead?.pais ?? "").trim().toUpperCase();
  if (!DDI_POR_PAIS[pais]) pais = "";

  const comDdi = bruto.startsWith("+") || bruto.startsWith("00");
  if (bruto.startsWith("00")) digitos = digitos.slice(2);

  if (comDdi) {
    // o país informado pela IA vale se o DDI bate; senão, o DDI mais longo que bater
    if (pais && digitos.startsWith(DDI_POR_PAIS[pais])) {
      digitos = digitos.slice(DDI_POR_PAIS[pais].length);
    } else {
      const achado = PAISES.filter(([, ddi]) => digitos.startsWith(ddi)).sort((a, b) => b[1].length - a[1].length)[0];
      if (!achado) return null;
      pais = achado[0];
      digitos = digitos.slice(achado[1].length);
    }
  } else {
    pais = pais || "BR";
    if (dddInformado && !digitos.startsWith(dddInformado)) digitos = dddInformado + digitos;
  }

  const dddLen = pais === "US" || pais === "CA" ? 3 : 2;
  if (digitos.length < dddLen + 6 || digitos.length > 13) return null;
  return { country_code: pais, local: digitos };
}

export function emailValido(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email ?? "").trim());
}

/* resumo curto para as notas do lead e para o aviso de handoff */
export function montarResumo(lead, motivoHandoff = "") {
  const partes = [];
  if (lead.destino) partes.push(`Destino: ${lead.destino}`);
  if (lead.quando_viajar) partes.push(`Quando: ${lead.quando_viajar}`);
  if (lead.objetivo) partes.push(`Objetivo: ${lead.objetivo}`);
  if (lead.nivel_ingles) partes.push(`Inglês: ${lead.nivel_ingles}`);
  if (lead.orcamento) partes.push(`Orçamento: ${lead.orcamento}`);
  let texto = partes.join(" · ");
  if (lead.whatsapp && !normalizarTelefone(lead)) texto += `${texto ? "\n" : ""}WhatsApp informado: ${lead.whatsapp}`;
  if (motivoHandoff) texto += `${texto ? "\n" : ""}Handoff: ${motivoHandoff}`;
  return texto;
}

/* junta o que a IA extraiu agora com o que já foi coletado: campo vazio
   não apaga dado anterior */
export function mesclarLead(anterior, novo) {
  const out = { ...LEAD_VAZIO, ...(anterior || {}) };
  for (const k of Object.keys(LEAD_VAZIO)) {
    const v = typeof novo?.[k] === "string" ? novo[k].trim() : "";
    if (v) out[k] = v.slice(0, 200);
  }
  return out;
}

/* Lead só vai para o CRM com nome + (WhatsApp ou e-mail), ou no handoff */
export function podeRegistrar(lead, handoff) {
  if (handoff) return true;
  return !!lead.nome && (!!normalizarTelefone(lead) || emailValido(lead.email));
}

/* campos que, quando mudam, justificam chamar a função de novo */
const CAMPOS_QUALIFICADOS = ["nome", "pais", "ddd", "whatsapp", "email", "destino", "quando_viajar", "objetivo", "nivel_ingles", "orcamento", "temperatura"];
export function mudouAlgo(antes, depois) {
  return CAMPOS_QUALIFICADOS.some(k => (antes?.[k] || "") !== (depois?.[k] || ""));
}

/* payload de public.instagram_registrar_lead(p jsonb) */
export function montarPayload({ igUserId, igUsername, lead, handoff, motivoHandoff }) {
  const tel = normalizarTelefone(lead);
  const temperatura = handoff ? "Quente" : (["Quente", "Morno", "Frio"].includes(lead.temperatura) ? lead.temperatura : null);
  return {
    ig_user_id: igUserId,
    ig_username: igUsername || "",
    name: lead.nome || "",
    country_code: tel ? tel.country_code : "BR",
    phone_ddd: "",
    phone_number: tel ? tel.local : "",
    email: emailValido(lead.email) ? lead.email.trim().toLowerCase() : "",
    pretende_vir: lead.quando_viajar || "",
    temperature: temperatura,
    notes: montarResumo(lead, handoff ? motivoHandoff : ""),
    handoff: !!handoff,
  };
}

/* Lê a resposta da IA. Qualquer coisa fora do formato → null (handoff seguro). */
export function lerRespostaIA(texto) {
  let obj;
  try { obj = JSON.parse(texto); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.reply !== "string" || typeof obj.handoff !== "boolean") return null;
  if (!obj.lead || typeof obj.lead !== "object") return null;
  const reply = obj.reply.trim();
  if (!reply && !obj.handoff) return null;
  return {
    reply,
    handoff: obj.handoff,
    handoff_reason: typeof obj.handoff_reason === "string" ? obj.handoff_reason.trim().slice(0, 200) : "",
    lead: obj.lead,
  };
}

/* Instagram aceita até 1000 bytes em UTF-8 (acento = 2 bytes, emoji = 4):
   corta no fim de frase quando der */
const bytes = s => Buffer.byteLength(s, "utf8");
export function limitarTexto(texto, max = 1000) {
  const t = String(texto ?? "").trim();
  if (bytes(t) <= max) return t;
  let corte = "";
  for (const ch of t) { if (bytes(corte + ch) > max - 3) break; corte += ch; }
  const fim = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("! "), corte.lastIndexOf("? "));
  return fim > corte.length * 0.5 ? corte.slice(0, fim + 1) : corte + "…";
}

export const JANELA_24H_MS = 24 * 60 * 60 * 1000;
export function dentroDaJanela(timestampMs, agora = Date.now()) {
  return Number.isFinite(timestampMs) && agora - timestampMs < JANELA_24H_MS;
}
