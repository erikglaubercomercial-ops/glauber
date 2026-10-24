import { createHmac, timingSafeEqual } from "node:crypto";
import { limitarTexto } from "./regras.js";

/* X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo cru, IG_APP_SECRET) */
export function assinaturaValida(corpoCru, cabecalho, segredo = process.env.IG_APP_SECRET) {
  if (!segredo || !cabecalho || !cabecalho.startsWith("sha256=")) return false;
  const esperado = Buffer.from(createHmac("sha256", segredo).update(corpoCru).digest("hex"), "utf8");
  const recebido = Buffer.from(cabecalho.slice("sha256=".length), "utf8");
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

export function tokenDeVerificacaoValido(recebido, esperado = process.env.IG_VERIFY_TOKEN) {
  if (!esperado || typeof recebido !== "string") return false;
  const a = Buffer.from(recebido, "utf8"), b = Buffer.from(esperado, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* Extrai as mensagens de texto recebidas de um webhook do Instagram.
   Ignora eco (mensagem enviada pela própria conta), leitura, reação etc. */
export function mensagensDoWebhook(payload) {
  const out = [];
  if (payload?.object !== "instagram") return out;
  for (const entry of payload.entry || []) {
    for (const ev of entry.messaging || []) {
      const msg = ev.message;
      if (!msg || msg.is_echo || msg.is_deleted || !msg.mid) continue;
      const senderId = ev.sender?.id;
      if (!senderId || senderId === entry.id) continue;
      let texto = (msg.text || "").trim();
      if (!texto && Array.isArray(msg.attachments) && msg.attachments.length) {
        texto = `[o lead enviou um anexo: ${msg.attachments.map(a => a.type || "arquivo").join(", ")}]`;
      }
      if (!texto) continue;
      out.push({ igUserId: senderId, mid: msg.mid, texto: texto.slice(0, 2000), timestamp: Number(ev.timestamp) || Date.now() });
    }
  }
  return out;
}

function graphUrl(caminho) {
  const versao = process.env.IG_GRAPH_VERSION;
  if (!versao) throw new Error("IG_GRAPH_VERSION não configurada");
  return `https://graph.instagram.com/${versao}/${caminho}`;
}

export async function enviarMensagem(igUserId, texto) {
  const resp = await fetch(graphUrl("me/messages"), {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.IG_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: igUserId }, message: { text: limitarTexto(texto, 1000) } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Graph API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
}

/* @usuario de quem mandou a mensagem (melhor esforço: falha não trava a conversa) */
export async function buscarUsername(igUserId) {
  try {
    const resp = await fetch(graphUrl(`${encodeURIComponent(igUserId)}?fields=username`), {
      headers: { Authorization: `Bearer ${process.env.IG_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return "";
    const dados = await resp.json();
    return typeof dados.username === "string" ? dados.username : "";
  } catch {
    return "";
  }
}
