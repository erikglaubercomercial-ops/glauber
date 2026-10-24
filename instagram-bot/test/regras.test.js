import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  normalizarTelefone, podeRegistrar, montarPayload, lerRespostaIA, limitarTexto, mesclarLead, LEAD_VAZIO, dentroDaJanela,
} from "../lib/regras.js";
import { assinaturaValida, mensagensDoWebhook, tokenDeVerificacaoValido } from "../lib/meta.js";

const lead = campos => ({ ...LEAD_VAZIO, ...campos });

test("telefone brasileiro com DDI vira país BR + DDD/número locais", () => {
  assert.deepEqual(normalizarTelefone(lead({ whatsapp: "+55 61 99812-3456" })), { country_code: "BR", local: "61998123456" });
  assert.deepEqual(normalizarTelefone(lead({ whatsapp: "0055 (21) 98877-6655" })), { country_code: "BR", local: "21988776655" });
});

test("telefone sem DDI usa o país informado (padrão BR) e o DDD separado", () => {
  assert.deepEqual(normalizarTelefone(lead({ ddd: "61", whatsapp: "99812-3456" })), { country_code: "BR", local: "61998123456" });
  assert.deepEqual(normalizarTelefone(lead({ whatsapp: "(61) 99812-3456" })), { country_code: "BR", local: "61998123456" });
});

test("telefone da Irlanda e dos EUA", () => {
  assert.deepEqual(normalizarTelefone(lead({ whatsapp: "+353 83 123 4567" })), { country_code: "IE", local: "831234567" });
  assert.deepEqual(normalizarTelefone(lead({ pais: "CA", whatsapp: "+1 416 555 0199" })), { country_code: "CA", local: "4165550199" });
});

test("telefone curto ou DDI desconhecido não vira telefone", () => {
  assert.equal(normalizarTelefone(lead({ whatsapp: "9999" })), null);
  assert.equal(normalizarTelefone(lead({ whatsapp: "+999 1234 5678" })), null);
  assert.equal(normalizarTelefone(lead({})), null);
});

test("lead só é registrado com nome + contato, ou no handoff", () => {
  assert.equal(podeRegistrar(lead({ nome: "Mariana" }), false), false);
  assert.equal(podeRegistrar(lead({ nome: "Mariana", email: "mari@gmail.com" }), false), true);
  assert.equal(podeRegistrar(lead({ nome: "Mariana", whatsapp: "+55 61 99812-3456" }), false), true);
  assert.equal(podeRegistrar(lead({ email: "mari@gmail.com" }), false), false);
  assert.equal(podeRegistrar(lead({}), true), true);
});

test("payload da função 081: handoff marca Quente, resumo nas notas", () => {
  const p = montarPayload({
    igUserId: "123", igUsername: "mari.costa", handoff: true, motivoHandoff: "Qualificação completa",
    lead: lead({ nome: "Mariana Costa", whatsapp: "+55 61 99812-3456", email: "Mari.Costa@Gmail.com", destino: "Irlanda", quando_viajar: "03/2027", orcamento: "~R$ 30 mil" }),
  });
  assert.equal(p.temperature, "Quente");
  assert.equal(p.country_code, "BR");
  assert.equal(p.phone_number, "61998123456");
  assert.equal(p.email, "mari.costa@gmail.com");
  assert.equal(p.pretende_vir, "03/2027");
  assert.match(p.notes, /Destino: Irlanda · Quando: 03\/2027 · Orçamento: ~R\$ 30 mil/);
  assert.match(p.notes, /Handoff: Qualificação completa/);
  assert.equal(p.handoff, true);
});

test("temperatura inválida da IA vira null fora do handoff", () => {
  const p = montarPayload({ igUserId: "1", lead: lead({ nome: "A", temperatura: "Morníssimo" }), handoff: false });
  assert.equal(p.temperature, null);
});

test("mesclar não apaga dado já coletado", () => {
  const m = mesclarLead(lead({ nome: "Mariana", destino: "Irlanda" }), { nome: "", destino: "", quando_viajar: "03/2027" });
  assert.equal(m.nome, "Mariana");
  assert.equal(m.destino, "Irlanda");
  assert.equal(m.quando_viajar, "03/2027");
});

test("resposta da IA fora do formato → null", () => {
  assert.equal(lerRespostaIA('Claro! {"reply": "oi"'), null);
  assert.equal(lerRespostaIA('{"reply": 3, "handoff": false, "lead": {}}'), null);
  assert.equal(lerRespostaIA('{"reply": "oi", "handoff": "sim", "lead": {}}'), null);
  assert.equal(lerRespostaIA('{"reply": "", "handoff": false, "lead": {}}'), null);
  assert.equal(lerRespostaIA('{"reply": "Oi!", "handoff": false, "handoff_reason": "", "lead": {}}').reply, "Oi!");
});

test("texto do Direct limitado a 1000 bytes", () => {
  const t = limitarTexto("Frase curta. ".repeat(120));
  assert.ok(Buffer.byteLength(t, "utf8") <= 1000);
  assert.ok(t.endsWith("."));
  const acentos = limitarTexto("ção ".repeat(400));
  assert.ok(Buffer.byteLength(acentos, "utf8") <= 1000);
  assert.equal(limitarTexto("Oi, tudo bem? 😊"), "Oi, tudo bem? 😊");
});

test("janela de 24h", () => {
  const agora = Date.now();
  assert.equal(dentroDaJanela(agora - 60_000, agora), true);
  assert.equal(dentroDaJanela(agora - 25 * 3600_000, agora), false);
});

test("assinatura X-Hub-Signature-256", () => {
  const corpo = Buffer.from('{"object":"instagram"}');
  const ok = "sha256=" + createHmac("sha256", "segredo").update(corpo).digest("hex");
  assert.equal(assinaturaValida(corpo, ok, "segredo"), true);
  assert.equal(assinaturaValida(corpo, ok, "outro"), false);
  assert.equal(assinaturaValida(corpo, "sha256=abc", "segredo"), false);
  assert.equal(assinaturaValida(corpo, null, "segredo"), false);
});

test("token de verificação", () => {
  assert.equal(tokenDeVerificacaoValido("abc", "abc"), true);
  assert.equal(tokenDeVerificacaoValido("abd", "abc"), false);
  assert.equal(tokenDeVerificacaoValido(null, "abc"), false);
  assert.equal(tokenDeVerificacaoValido("abc", ""), false);
});

test("webhook: ignora eco e mensagens da própria conta", () => {
  const payload = {
    object: "instagram",
    entry: [{
      id: "CONTA", messaging: [
        { sender: { id: "LEAD" }, recipient: { id: "CONTA" }, timestamp: 1, message: { mid: "m1", text: "oi" } },
        { sender: { id: "CONTA" }, recipient: { id: "LEAD" }, timestamp: 2, message: { mid: "m2", text: "resposta", is_echo: true } },
        { sender: { id: "LEAD" }, recipient: { id: "CONTA" }, timestamp: 3, read: { mid: "m1" } },
        { sender: { id: "LEAD" }, recipient: { id: "CONTA" }, timestamp: 4, message: { mid: "m3", attachments: [{ type: "image" }] } },
      ],
    }],
  };
  const msgs = mensagensDoWebhook(payload);
  assert.deepEqual(msgs.map(m => m.mid), ["m1", "m3"]);
  assert.match(msgs[1].texto, /anexo: image/);
});
