import Anthropic from "@anthropic-ai/sdk";
import { promptDoSistema, dadosDaConversa, ESQUEMA_RESPOSTA } from "./prompt.js";
import { lerRespostaIA } from "./regras.js";

let cliente;
function claude() {
  cliente ??= new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente
  return cliente;
}

/* histórico salvo → formato da API (papéis alternados, começando no lead) */
export function historicoParaApi(mensagens) {
  const out = [];
  for (const m of mensagens || []) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const text = String(m.text || "").trim();
    if (!text) continue;
    if (!out.length && role === "assistant") continue;
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += "\n" + text;
    else out.push({ role, content: text });
  }
  return out;
}

/* Pede a próxima resposta. Devolve { reply, handoff, handoff_reason, lead }
   ou null quando não dá para confiar na resposta (o chamador faz handoff seguro). */
export async function pedirResposta({ mensagens, lead, igUsername }) {
  const historico = historicoParaApi(mensagens);
  if (!historico.length || historico[historico.length - 1].role !== "user") return null;
  try {
    const resposta = await claude().messages.create({
      model: process.env.CLAUDE_MODEL || "claude-haiku-5-5",
      max_tokens: 4000,
      system: [
        { type: "text", text: promptDoSistema() },
        { type: "text", text: dadosDaConversa(lead, igUsername) },
      ],
      output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA_RESPOSTA } },
      messages: historico,
    });
    if (resposta.stop_reason !== "end_turn") {
      console.warn("IA parou com stop_reason", resposta.stop_reason, resposta.stop_details ?? "");
      return null;
    }
    const texto = resposta.content.filter(b => b.type === "text").map(b => b.text).join("");
    return lerRespostaIA(texto);
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error("Erro da API do Claude:", err.status, err.message);
    else console.error("Falha ao chamar o Claude:", err);
    return null;
  }
}
