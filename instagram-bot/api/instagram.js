/* Webhook do Instagram (Vercel Function).
   GET  → verificação da Meta (hub.challenge)
   POST → confere a assinatura, responde 200 na hora e processa em segundo plano */
import { waitUntil } from "@vercel/functions";
import { assinaturaValida, tokenDeVerificacaoValido } from "../lib/meta.js";
import { processarWebhook } from "../lib/conversa.js";

export function GET(request) {
  const params = new URL(request.url).searchParams;
  if (params.get("hub.mode") === "subscribe" && tokenDeVerificacaoValido(params.get("hub.verify_token"))) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request) {
  // a assinatura é calculada sobre o corpo cru, antes de qualquer parse
  const corpo = Buffer.from(await request.arrayBuffer());
  if (!assinaturaValida(corpo, request.headers.get("x-hub-signature-256"))) {
    return new Response("Assinatura inválida", { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(corpo.toString("utf8")); }
  catch { return new Response("EVENT_RECEIVED", { status: 200 }); }

  waitUntil(processarWebhook(payload).catch(err => console.error("Erro no processamento do webhook:", err)));
  return new Response("EVENT_RECEIVED", { status: 200 });
}
