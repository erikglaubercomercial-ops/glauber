/* Fluxo de uma mensagem do Direct: registra → IA → lead no CRM → responde.
   Regras do CRM (rodízio, card do Pipeline, histórico, duplicados) ficam com
   os gatilhos do banco: aqui só chamamos instagram_registrar_lead. */
import * as supabase from "./supabase.js";
import * as meta from "./meta.js";
import { MENSAGEM_PADRAO } from "./prompt.js";
import {
  LEAD_VAZIO, mesclarLead, podeRegistrar, mudouAlgo, montarPayload, montarResumo, dentroDaJanela,
} from "./regras.js";

export async function avisarHandoff(dados) {
  const url = process.env.HANDOFF_WEBHOOK_URL;
  if (!url) return;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) console.error("HANDOFF_WEBHOOK_URL respondeu", resp.status);
  } catch (err) {
    console.error("Falha ao avisar handoff:", err.message);
  }
}

const PADRAO = {
  db: { atualizarConversa: supabase.atualizarConversa, registrarLead: supabase.registrarLead },
  meta: { enviarMensagem: meta.enviarMensagem, buscarUsername: meta.buscarUsername },
  // import tardio: os testes usam uma IA falsa e não precisam do SDK instalado
  ia: { pedirResposta: async args => (await import("./ia.js")).pedirResposta(args) },
  avisarHandoff,
};

/* mensagens do mesmo lead em ordem; leads diferentes em paralelo */
export async function processarWebhook(payload, deps = PADRAO) {
  const porLead = new Map();
  for (const m of meta.mensagensDoWebhook(payload)) {
    if (!porLead.has(m.igUserId)) porLead.set(m.igUserId, []);
    porLead.get(m.igUserId).push(m);
  }
  await Promise.all([...porLead.values()].map(async lista => {
    for (const m of lista.sort((a, b) => a.timestamp - b.timestamp)) {
      try { await processarMensagem(m, deps); }
      catch (err) { console.error(`Erro ao processar mid ${m.mid}:`, err); }
    }
  }));
}

export async function processarMensagem({ igUserId, mid, texto, timestamp }, deps = PADRAO) {
  // 1) grava a mensagem e o mid numa escrita só — mid repetido (reenvio da Meta) para aqui
  const { conversa, gravou } = await deps.db.atualizarConversa(igUserId, conv => {
    if ((conv.processed_mids || []).includes(mid)) return null;
    return {
      processed_mids: [...(conv.processed_mids || []), mid],
      messages: [...(conv.messages || []), { role: "user", text: texto, mid, at: new Date(timestamp).toISOString() }],
    };
  });
  if (!gravou) return { acao: "duplicada" };

  // 2) depois do handoff o bot só registra: quem responde é o consultor
  if (conversa.handoff) return { acao: "so_registrou" };

  const username = conversa.ig_username || await deps.meta.buscarUsername(igUserId);
  const leadAntes = { ...LEAD_VAZIO, ...(conversa.lead_data || {}) };

  // 3) IA — resposta inválida/recusa/erro vira handoff seguro com mensagem padrão
  const resposta = await deps.ia.pedirResposta({ mensagens: conversa.messages, lead: leadAntes, igUsername: username });
  const seguro = !resposta;
  const handoff = seguro || resposta.handoff;
  const motivo = seguro ? "Resposta da IA inválida (handoff seguro)" : (resposta.handoff_reason || "Pedido da IA");
  const lead = seguro ? leadAntes : mesclarLead(leadAntes, resposta.lead);
  const textoResposta = seguro || !resposta.reply ? MENSAGEM_PADRAO : resposta.reply;

  // 4) lead no CRM: nome + contato, ou handoff; de novo a cada dado novo (a função é idempotente)
  let registro = null;
  if (podeRegistrar(lead, handoff) && (handoff || mudouAlgo(leadAntes, lead) || !conversa.lead_id)) {
    try {
      registro = await deps.db.registrarLead(montarPayload({ igUserId, igUsername: username, lead, handoff, motivoHandoff: motivo }));
    } catch (err) {
      console.error("Falha em instagram_registrar_lead (tenta de novo na próxima mensagem):", err.message);
    }
  }

  // 5) responde só dentro da janela de 24h da Meta
  let enviada = false;
  if (dentroDaJanela(timestamp)) {
    try { await deps.meta.enviarMensagem(igUserId, textoResposta); enviada = true; }
    catch (err) { console.error("Falha ao enviar resposta no Direct:", err.message); }
  }

  // 6) estado da conversa
  await deps.db.atualizarConversa(igUserId, conv => ({
    messages: enviada ? [...(conv.messages || []), { role: "assistant", text: textoResposta, at: new Date().toISOString() }] : conv.messages,
    lead_data: lead,
    ...(username && !conv.ig_username ? { ig_username: username } : {}),
    ...(registro?.lead_id ? { lead_id: registro.lead_id } : {}),
    ...(handoff ? { handoff: true, handoff_reason: motivo } : {}),
  }));

  // 7) aviso opcional para a equipe
  if (handoff) {
    const quem = [lead.nome, username ? `@${username}` : ""].filter(Boolean).join(" ");
    await deps.avisarHandoff({
      lead_id: registro?.lead_id ?? conversa.lead_id ?? null,
      consultor_nome: registro?.consultor_nome ?? null,
      resumo: [quem, montarResumo(lead, motivo)].filter(Boolean).join("\n"),
    });
  }

  return { acao: handoff ? "handoff" : "respondeu", enviada, registro, seguro };
}
