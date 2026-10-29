/* google-busy-sync — lê o "endereço secreto iCal" do Google Agenda de cada consultor e guarda SÓ os intervalos
   ocupados em booking_external_busy (o link de agendamento online passa a respeitar esses horários).
   • Chamada pela tarefa agendada (pg_cron, a cada 10 min, com a chave pública anon): sincroniza todos os consultores ligados.
   • Chamada pelo próprio consultor logado ("Sincronizar agora"): sincroniza só a ligação dele.
   O endereço só é lido por esta função (service role); nunca volta para o navegador. */
import { createClient } from "@supabase/supabase-js";
import { busyFromIcs } from "./busy.js";

const WINDOW_BACK_MS = 86400000;          // 1 dia para trás
const WINDOW_FWD_MS = 70 * 86400000;      // 70 dias para a frente (a agenda aberta vai até 180, mas o padrão é 30)
const CRON_MIN_GAP_MS = 3 * 60 * 1000;    // a tarefa agendada não sincroniza de novo em menos de 3 min
const USER_MIN_GAP_MS = 15 * 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function jwtClaims(req: Request): { role?: string; sub?: string } {
  try {
    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const p = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p.padEnd(p.length + ((4 - (p.length % 4)) % 4), "=")));
  } catch { return {}; }
}

const allowed = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && x.hostname === "calendar.google.com"; } catch { return false; } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { role, sub } = jwtClaims(req);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let q = admin.from("booking_google_links").select("consultor_id, ics_url, last_sync_at").eq("enabled", true);
  const byUser = role === "authenticated";
  if (byUser) q = q.eq("consultor_id", sub!);
  else if (role !== "anon" && role !== "service_role") return json({ error: "nao_autorizado" }, 403);
  const { data: links, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const gap = byUser ? USER_MIN_GAP_MS : CRON_MIN_GAP_MS;
  const now = Date.now();
  const results: Array<Record<string, unknown>> = [];

  for (const link of links || []) {
    if (link.last_sync_at && now - new Date(link.last_sync_at).getTime() < gap) { results.push({ consultor: link.consultor_id, skipped: true }); continue; }
    try {
      if (!allowed(link.ics_url)) throw new Error("Endereço inválido: use o endereço secreto do Google Agenda (https://calendar.google.com/...).");
      const resp = await fetch(link.ics_url, { headers: { Accept: "text/calendar" }, signal: AbortSignal.timeout(20000) });
      if (!resp.ok) throw new Error(`O Google respondeu ${resp.status}. Confira se o endereço secreto ainda é válido.`);
      const text = await resp.text();
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("O endereço não devolveu um calendário. Copie o \"Endereço secreto no formato iCal\".");

      const { data: st } = await admin.from("booking_settings").select("tz").eq("consultor_id", link.consultor_id).maybeSingle();
      const from = new Date(now - WINDOW_BACK_MS), to = new Date(now + WINDOW_FWD_MS);
      const busy = busyFromIcs(text, from, to, st?.tz || "America/Sao_Paulo");

      // troca os intervalos futuros desse consultor pelos recém-lidos
      await admin.from("booking_external_busy").delete().eq("consultor_id", link.consultor_id).gte("ends_at", from.toISOString());
      const rows = busy.map((b) => ({ consultor_id: link.consultor_id, starts_at: b.start, ends_at: b.end }));
      for (let i = 0; i < rows.length; i += 500) {
        const ins = await admin.from("booking_external_busy").upsert(rows.slice(i, i + 500), { onConflict: "consultor_id,starts_at,ends_at", ignoreDuplicates: true });
        if (ins.error) throw new Error(ins.error.message);
      }
      await admin.from("booking_google_links").update({ last_sync_at: new Date().toISOString(), last_error: null, busy_count: rows.length }).eq("consultor_id", link.consultor_id);
      results.push({ consultor: link.consultor_id, busy: rows.length });
    } catch (e) {
      await admin.from("booking_google_links").update({ last_sync_at: new Date().toISOString(), last_error: String((e as Error).message || e).slice(0, 300) }).eq("consultor_id", link.consultor_id);
      results.push({ consultor: link.consultor_id, error: String((e as Error).message || e).slice(0, 120) });
    }
  }
  /* quem chama pela tarefa agendada (chave pública) não recebe identificadores — só a contagem */
  return json(byUser ? { ok: true, synced: results.length, results } : { ok: true, synced: results.length });
});
