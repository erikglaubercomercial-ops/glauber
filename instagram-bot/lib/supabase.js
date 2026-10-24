/* Acesso ao Supabase do CRM via REST/RPC com a service_role (só no servidor).
   Só toca em duas coisas: a tabela ig_conversations e a função
   instagram_registrar_lead (migração 081). Nenhum outro dado do CRM. */

function config() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas");
  return { url, chave };
}

async function rest(caminho, { method = "GET", body, prefer } = {}) {
  const { url, chave } = config();
  const headers = { apikey: chave, "Content-Type": "application/json" };
  // chave antiga (service_role, um JWT "eyJ...") também vai no Authorization;
  // a chave secreta nova (sb_secret_...) vai só no apikey
  if (chave.startsWith("eyJ")) headers.Authorization = `Bearer ${chave}`;
  if (prefer) headers.Prefer = prefer;
  const resp = await fetch(`${url}/rest/v1/${caminho}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const texto = await resp.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
  return { ok: resp.ok, status: resp.status, dados };
}

const MAX_MENSAGENS = 80;
const MAX_MIDS = 200;

export async function lerConversa(igUserId) {
  const r = await rest(`ig_conversations?ig_user_id=eq.${encodeURIComponent(igUserId)}&select=*`);
  if (!r.ok) throw new Error(`Supabase ${r.status} ao ler conversa: ${JSON.stringify(r.dados)}`);
  return r.dados?.[0] || null;
}

/* Lê, altera e grava a conversa com trava otimista (updated_at): se outra
   execução (ou a função do lead) gravou no meio, relê e aplica de novo.
   `alterar(conv)` recebe uma cópia e devolve só os campos a gravar, ou null. */
export async function atualizarConversa(igUserId, alterar) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const atual = await lerConversa(igUserId);
    const base = atual || { ig_user_id: igUserId, ig_username: null, lead_id: null, messages: [], lead_data: {}, handoff: false, handoff_reason: "", processed_mids: [] };
    const campos = alterar(structuredClone(base));
    if (!campos) return { conversa: base, gravou: false };
    if (campos.messages) campos.messages = campos.messages.slice(-MAX_MENSAGENS);
    if (campos.processed_mids) campos.processed_mids = campos.processed_mids.slice(-MAX_MIDS);
    const agora = new Date().toISOString();

    if (!atual) {
      const r = await rest("ig_conversations", {
        method: "POST", prefer: "return=representation",
        body: { ...base, ...campos, ig_user_id: igUserId, updated_at: agora },
      });
      if (r.ok) return { conversa: r.dados[0], gravou: true };
      if (r.status === 409) continue; // criada por outra execução ao mesmo tempo
      throw new Error(`Supabase ${r.status} ao criar conversa: ${JSON.stringify(r.dados)}`);
    }

    const r = await rest(
      `ig_conversations?ig_user_id=eq.${encodeURIComponent(igUserId)}&updated_at=eq.${encodeURIComponent(atual.updated_at)}`,
      { method: "PATCH", prefer: "return=representation", body: { ...campos, updated_at: agora } },
    );
    if (!r.ok) throw new Error(`Supabase ${r.status} ao gravar conversa: ${JSON.stringify(r.dados)}`);
    if (r.dados?.length) return { conversa: r.dados[0], gravou: true };
    // 0 linhas: alguém gravou antes — tenta de novo com a versão nova
  }
  throw new Error("Conversa muito disputada: não consegui gravar após 5 tentativas");
}

/* public.instagram_registrar_lead(p jsonb) → { lead_id, consultor_id, consultor_nome, criado } */
export async function registrarLead(p) {
  const r = await rest("rpc/instagram_registrar_lead", { method: "POST", body: { p } });
  if (!r.ok) throw new Error(`Supabase ${r.status} em instagram_registrar_lead: ${JSON.stringify(r.dados)}`);
  return r.dados;
}
