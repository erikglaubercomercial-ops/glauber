/* crm-api — API de LEITURA do CRM (só GET). Para a gestora de tráfego e ferramentas externas (Looker Studio, planilhas, scripts).
   • Autenticação: chave "peg_..." gerada pelo ADM na tela Usuários (Authorization: Bearer <chave> ou x-api-key). No banco só existe o hash.
   • Só devolve as tabelas da lista abaixo (lista fechada: tabela nova não vira pública sozinha).
   • Tira sempre as colunas secretas: tokens de links públicos, caminhos de arquivo, endereços privados, documentos pessoais, assinaturas e IPs.
   • Limite de 120 chamadas por minuto por chave; cada chamada fica em api_access_log. Chave vence sozinha e pode ser revogada. */
import { createClient } from "@supabase/supabase-js";

const TABLES = new Set([
  "leads", "deals", "lead_events", "lead_followups", "lead_notes", "lead_sources", "pipeline_stages", "monthly_goals",
  "quotes", "contracts", "contract_events", "enrollments", "receivables", "commissions", "influencer_commissions", "sale_splits",
  "accommodation_sales", "accommodation_transfers", "expenses", "expense_categories", "ad_spend", "commission_settings",
  "schools", "school_cities", "school_commissions", "school_transfers", "catalog_folders", "catalog_items",
  "forms", "form_submissions", "agenda_items", "departure_alerts", "teams", "profiles",
  "app_eventos", "app_visitantes", "app_planos", "app_parceiros", "app_parceiros_alias", "app_rodizio",
  "bio_pages", "bio_links", "aluno_videos",
]);
/* profiles: só o necessário para saber de quem é o lead (nada de e-mail do time) */
const PROFILE_COLS = ["id", "name", "role", "active", "team_id", "manager_id", "created_at"];
const DENY_COL = /(token|secret|hash|password|ics_url|_path$|^path$|passport|cpf|document|signature|_ip$|user_agent|^address_|^emergency_|birth|^content$|snapshot|dados_cliente|^provider|^pdf_)/i;

const SINCE_COLS = ["updated_at", "atualizado_em", "created_at", "criado_em"];
const ORDER_COLS = ["id", "visitor_id", "created_at", "criado_em", null];
const MAX_LIMIT = 1000, PER_MINUTE = 120;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const clean = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([k]) => !DENY_COL.test(k)));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "GET") return json({ error: "metodo_nao_permitido", detail: "Esta API é somente de leitura (GET)." }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const key = ((req.headers.get("x-api-key") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")) || "").trim();
  if (!/^peg_[a-f0-9]{64}$/.test(key)) return json({ error: "chave_invalida" }, 401);
  const { data: k } = await admin.from("api_keys").select("id, expires_at, revoked_at").eq("key_hash", await sha256(key)).maybeSingle();
  if (!k || k.revoked_at || (k.expires_at && new Date(k.expires_at).getTime() < Date.now())) return json({ error: "chave_invalida_ou_vencida" }, 401);

  const since = new Date(Date.now() - 60000).toISOString();
  const { count: recent } = await admin.from("api_access_log").select("id", { count: "exact", head: true }).eq("key_id", k.id).gte("at", since);
  if ((recent || 0) >= PER_MINUTE) return json({ error: "muitas_chamadas", detail: `Limite de ${PER_MINUTE} chamadas por minuto.` }, 429);

  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const table = parts[parts.indexOf("crm-api") + 1] || "";
  const q = new URL(req.url).searchParams;

  if (!table) {
    await admin.from("api_access_log").insert({ key_id: k.id, table_name: "(lista)", rows_returned: 0 });
    await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
    return json({ tables: Array.from(TABLES).sort(), usage: "GET /crm-api/<tabela>?limit=1000&offset=0&updated_since=2026-01-01T00:00:00Z" });
  }
  if (!TABLES.has(table)) return json({ error: "tabela_nao_disponivel" }, 404);

  const limit = Math.min(Math.max(parseInt(q.get("limit") || "500", 10) || 500, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(q.get("offset") || "0", 10) || 0, 0);
  const sinceParam = q.get("updated_since");
  if (sinceParam && Number.isNaN(Date.parse(sinceParam))) return json({ error: "updated_since_invalido", detail: "Use data no formato 2026-01-31 ou 2026-01-31T00:00:00Z." }, 400);

  const cols = table === "profiles" ? PROFILE_COLS.join(",") : "*";
  let rows: Record<string, unknown>[] | null = null, lastErr = "";
  /* a coluna de data/ordem varia por tabela: tenta as conhecidas até uma existir */
  outer: for (const orderCol of ORDER_COLS) {
    for (const sinceCol of sinceParam ? SINCE_COLS : [null]) {
      let qb = admin.from(table).select(cols);
      if (sinceCol) qb = qb.gte(sinceCol, sinceParam!);
      if (orderCol) qb = qb.order(orderCol, { ascending: true });
      const { data, error } = await qb.range(offset, offset + limit - 1);
      if (!error) { rows = data as Record<string, unknown>[]; break outer; }
      lastErr = error.code || "erro";
      if (error.code !== "42703") break outer;
    }
  }
  if (rows === null) return json({ error: "falha_na_consulta", detail: lastErr === "42703" ? "Esta tabela não tem coluna de data para o filtro updated_since." : "Não foi possível consultar agora." }, 500);

  const out = rows.map(clean);
  await admin.from("api_access_log").insert({ key_id: k.id, table_name: table, rows_returned: out.length });
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
  return json({ table, offset, limit, count: out.length, next_offset: out.length === limit ? offset + limit : null, rows: out });
});
