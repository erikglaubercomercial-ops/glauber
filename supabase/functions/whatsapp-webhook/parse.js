/* Lê o corpo do webhook da API oficial do WhatsApp (Meta) e devolve as mensagens recebidas e as atualizações de entrega.
   Sem texto de mídia: guarda um rótulo ("[imagem]", "[áudio]"…) + legenda — baixar arquivos fica para uma etapa futura. */

const LABEL = { image: "[imagem]", audio: "[áudio]", voice: "[áudio]", video: "[vídeo]", document: "[documento]", sticker: "[figurinha]", location: "[localização]", contacts: "[contato]", reaction: "[reação]" };

export function messageBody(m) {
  const t = m.type;
  if (t === "text") return String((m.text && m.text.body) || "");
  if (t === "button") return String((m.button && (m.button.text || m.button.payload)) || "[botão]");
  if (t === "interactive") {
    const i = m.interactive || {};
    const r = i.button_reply || i.list_reply || {};
    return String(r.title || "[resposta interativa]");
  }
  if (t === "reaction") return `[reação ${(m.reaction && m.reaction.emoji) || ""}]`.trim();
  const cap = m[t] && m[t].caption ? ` ${m[t].caption}` : "";
  const fname = t === "document" && m.document && m.document.filename ? ` ${m.document.filename}` : "";
  return `${LABEL[t] || "[mensagem]"}${fname}${cap}`;
}

/* → { messages: [{phone,name,wa_message_id,type,body,ts}], statuses: [{id,status}] } */
export function parseWebhook(payload, expectedPhoneNumberId = "") {
  const messages = [], statuses = [];
  for (const entry of (payload && payload.entry) || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      if (expectedPhoneNumberId && v.metadata && String(v.metadata.phone_number_id) !== String(expectedPhoneNumberId)) continue;
      const names = {};
      for (const c of v.contacts || []) if (c.wa_id) names[c.wa_id] = (c.profile && c.profile.name) || "";
      for (const m of v.messages || []) {
        if (!m.from || !m.id) continue;
        messages.push({
          phone: String(m.from), name: names[m.from] || "", wa_message_id: String(m.id), type: String(m.type || "text"),
          body: messageBody(m), ts: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
      for (const s of v.statuses || []) if (s.id && s.status) statuses.push({ id: String(s.id), status: String(s.status) });
    }
  }
  return { messages, statuses };
}

/* confere o cabeçalho X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o segredo do app da Meta) */
export async function validSignature(rawBody, header, appSecret) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header || ""));
  if (!m || !appSecret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const given = new Uint8Array(m[1].match(/.{2}/g).map(h => parseInt(h, 16)));
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig[i] ^ given[i]; /* comparação sem atalho */
  return diff === 0;
}
