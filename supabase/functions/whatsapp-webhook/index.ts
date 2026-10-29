/* whatsapp-webhook — recebe as mensagens do número da empresa (API oficial do WhatsApp / Meta) e grava no CRM (wa_ingest_message).
   • GET  = verificação do webhook pela Meta (hub.verify_token).
   • POST = mensagens e status; só aceita se a assinatura X-Hub-Signature-256 bater com o segredo do app.
   Segredos (Supabase › Edge Functions › Secrets): WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID (opcional).
   Sem eles a função responde 503 e não grava nada. Nunca devolve dados do CRM. */
import { createClient } from "@supabase/supabase-js";
import { parseWebhook, validSignature } from "./parse.js";

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain" } });

Deno.serve(async (req) => {
  const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") || "";
  if (!verifyToken || !appSecret) return text("nao_configurado", 503);

  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === verifyToken && q.get("hub.challenge")) return text(q.get("hub.challenge")!);
    return text("proibido", 403);
  }
  if (req.method !== "POST") return text("metodo_nao_permitido", 405);

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256"), appSecret))) return text("assinatura_invalida", 401);

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return text("json_invalido", 400); }
  const { messages, statuses } = parseWebhook(payload, Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  for (const m of messages) {
    const { error } = await admin.rpc("wa_ingest_message", { p: m });
    if (error) { console.error("wa_ingest_message", error.message); return text("erro", 500); } /* 500 = a Meta tenta de novo; a gravação é idempotente */
  }
  for (const s of statuses) await admin.rpc("wa_ingest_status", { p_wa_message_id: s.id, p_status: s.status });
  return text("ok");
});
