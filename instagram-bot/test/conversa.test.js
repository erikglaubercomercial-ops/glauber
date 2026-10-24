/* Fluxo completo com banco, Meta e IA falsos — nada sai da máquina. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { processarMensagem } from "../lib/conversa.js";
import { MENSAGEM_PADRAO } from "../lib/prompt.js";

function ambiente(respostasIA) {
  const conversas = new Map();
  const chamadasRpc = [];
  const enviadas = [];
  const avisos = [];
  let fila = [...respostasIA];
  let relogio = 0;
  const deps = {
    db: {
      async atualizarConversa(id, alterar) {
        const atual = conversas.get(id) || { ig_user_id: id, ig_username: null, lead_id: null, messages: [], lead_data: {}, handoff: false, handoff_reason: "", processed_mids: [] };
        const campos = alterar(structuredClone(atual));
        if (!campos) return { conversa: atual, gravou: false };
        const nova = { ...atual, ...campos, updated_at: String(++relogio) };
        conversas.set(id, nova);
        return { conversa: nova, gravou: true };
      },
      async registrarLead(p) {
        chamadasRpc.push(p);
        return { lead_id: "lead-1", consultor_id: "c-1", consultor_nome: "Ana Souza", criado: chamadasRpc.length === 1 };
      },
    },
    meta: {
      async enviarMensagem(id, texto) { enviadas.push(texto); },
      async buscarUsername() { return "mari.costa"; },
    },
    ia: { async pedirResposta() { return fila.shift() ?? null; } },
    async avisarHandoff(d) { avisos.push(d); },
  };
  return { deps, conversas, chamadasRpc, enviadas, avisos };
}

const ia = (reply, lead = {}, handoff = false, handoff_reason = "") => ({ reply, handoff, handoff_reason, lead });
let seq = 0;
const msg = texto => ({ igUserId: "IG1", mid: `mid-${++seq}`, texto, timestamp: Date.now() });

test("caminho feliz: sem lead até ter nome + contato, depois atualiza e faz handoff", async () => {
  const amb = ambiente([
    ia("Como posso te chamar?"),
    ia("Prazer, Mariana! Qual destino?", { nome: "Mariana Costa" }),
    ia("Anotado! Quando pensa em viajar?", { destino: "Irlanda", email: "mari.costa@gmail.com" }),
    ia("Ótimo! Qual seu WhatsApp?", { quando_viajar: "03/2027" }),
    ia("Prontinho! Um consultor vai te chamar no WhatsApp.", { whatsapp: "+55 61 99812-3456" }, true, "Qualificação completa"),
  ]);
  await processarMensagem(msg("Oi!"), amb.deps);
  await processarMensagem(msg("Mariana Costa"), amb.deps);
  assert.equal(amb.chamadasRpc.length, 0, "sem contato ainda: não cria lead");

  await processarMensagem(msg("Irlanda! mari.costa@gmail.com"), amb.deps);
  assert.equal(amb.chamadasRpc.length, 1, "nome + e-mail: cria lead");
  assert.equal(amb.chamadasRpc[0].email, "mari.costa@gmail.com");
  assert.equal(amb.conversas.get("IG1").lead_id, "lead-1");

  await processarMensagem(msg("março do ano que vem"), amb.deps);
  assert.equal(amb.chamadasRpc.length, 2, "dado novo: chama a função de novo");
  assert.equal(amb.chamadasRpc[1].pretende_vir, "03/2027");

  const r = await processarMensagem(msg("+55 61 99812-3456"), amb.deps);
  assert.equal(r.acao, "handoff");
  const ultimo = amb.chamadasRpc.at(-1);
  assert.equal(ultimo.temperature, "Quente");
  assert.equal(ultimo.phone_number, "61998123456");
  assert.equal(ultimo.handoff, true);
  assert.equal(amb.conversas.get("IG1").handoff, true);
  assert.equal(amb.avisos.length, 1);
  assert.equal(amb.avisos[0].consultor_nome, "Ana Souza");
  assert.match(amb.avisos[0].resumo, /@mari\.costa/);

  // depois do handoff: só registra
  const antes = amb.enviadas.length;
  const depois = await processarMensagem(msg("obrigada!!"), amb.deps);
  assert.equal(depois.acao, "so_registrou");
  assert.equal(amb.enviadas.length, antes);
  assert.equal(amb.conversas.get("IG1").messages.at(-1).text, "obrigada!!");
});

test("mid repetido (reenvio da Meta) é ignorado", async () => {
  const amb = ambiente([ia("Oi!"), ia("De novo?")]);
  const m = msg("oi");
  await processarMensagem(m, amb.deps);
  const r = await processarMensagem(m, amb.deps);
  assert.equal(r.acao, "duplicada");
  assert.equal(amb.enviadas.length, 1);
});

test("IA inválida: nada da IA chega ao lead, handoff seguro com mensagem padrão e lead criado", async () => {
  const amb = ambiente([null]);
  const r = await processarMensagem(msg("Bia. E se eu tiver 17 anos?"), amb.deps);
  assert.equal(r.acao, "handoff");
  assert.equal(r.seguro, true);
  assert.deepEqual(amb.enviadas, [MENSAGEM_PADRAO]);
  assert.equal(amb.chamadasRpc.length, 1, "handoff sem telefone cria o lead mesmo assim");
  assert.equal(amb.chamadasRpc[0].phone_number, "");
  assert.match(amb.chamadasRpc[0].notes, /handoff seguro/);
});

test("fora da janela de 24h: registra, mas não envia", async () => {
  const amb = ambiente([ia("Oi!")]);
  const velha = { ...msg("oi"), timestamp: Date.now() - 25 * 3600_000 };
  const r = await processarMensagem(velha, amb.deps);
  assert.equal(r.enviada, false);
  assert.equal(amb.enviadas.length, 0);
  assert.equal(amb.conversas.get("IG1").messages.length, 1, "a resposta não enviada não entra no histórico");
});
