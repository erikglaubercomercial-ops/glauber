/* ============================================================
   USUÁRIOS › ACESSO POR API (só ADM) — chaves de LEITURA para a gestora de tráfego e ferramentas externas.
   A chave aparece uma única vez (no banco fica só o hash); dá para revogar na hora e cada chave vence sozinha.
   Quem lê é a função de borda crm-api (somente GET, sem colunas secretas). Tabelas api_keys / api_access_log: só por RPC.
   Depende de script.js (session, escapeHtml, agendaToast) e config.js (SUPABASE_URL).
   ============================================================ */

const akEl = id => document.getElementById(id);
const akApiUrl = () => `${SUPABASE_URL}/functions/v1/crm-api`;
const akFmt = iso => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—");

async function renderApiKeys() {
  const body = akEl("apikeys-tbody");
  if (!body || !session || session.role !== "ADM") return;
  const { data, error } = await supabase.rpc("api_keys_list");
  if (error) { body.innerHTML = `<tr><td colspan="6" class="cell-muted">Não foi possível carregar: ${escapeHtml(error.message)}</td></tr>`; return; }
  akEl("apikeys-empty").style.display = data.length ? "none" : "block";
  body.innerHTML = data.map(k => {
    const expired = k.expires_at && new Date(k.expires_at) < new Date();
    const status = k.revoked_at ? ["Revogada", "badge-danger"] : expired ? ["Vencida", "badge-danger"] : ["Ativa", "badge-good"];
    return `<tr>
      <td class="cell-primary">${escapeHtml(k.name)}</td>
      <td class="cell-muted"><code>${escapeHtml(k.key_prefix)}…</code></td>
      <td class="cell-muted">${akFmt(k.created_at)}</td>
      <td class="cell-muted">${akFmt(k.expires_at)}</td>
      <td class="cell-muted">${k.last_used_at ? akFmt(k.last_used_at) : "nunca"} · ${k.calls_30d} chamada${Number(k.calls_30d) === 1 ? "" : "s"} em 30 dias</td>
      <td><span class="badge ${status[1]}">${status[0]}</span>${!k.revoked_at && !expired ? ` <button type="button" class="btn btn-danger btn-sm" data-ak-revoke="${k.id}">Revogar</button>` : ""}</td>
    </tr>`;
  }).join("");
}

function akOpen(step) {
  akEl("apikey-step-new").hidden = step !== "new";
  akEl("apikey-step-done").hidden = step !== "done";
  akEl("apikey-modal-backdrop").classList.add("open");
}
function akClose() { akEl("apikey-modal-backdrop").classList.remove("open"); akEl("apikey-secret").value = ""; renderApiKeys(); }

document.addEventListener("click", async e => {
  if (e.target.closest("#btn-new-apikey")) { akEl("apikey-name").value = ""; akEl("apikey-days").value = "180"; akOpen("new"); akEl("apikey-name").focus(); return; }
  if (e.target.closest("#apikey-close") || e.target.closest("#apikey-done-close")) { akClose(); return; }
  if (e.target.id === "apikey-modal-backdrop" && !akEl("apikey-step-done").hidden) return; /* a chave aparece só uma vez: não fecha sem querer */
  if (e.target.closest("#apikey-create")) {
    const name = akEl("apikey-name").value.trim();
    if (name.length < 2) { agendaToast("Dê um nome para a chave (ex.: Gestora de tráfego)."); return; }
    const btn = e.target.closest("#apikey-create"); btn.disabled = true;
    const { data, error } = await supabase.rpc("api_key_create", { p_name: name, p_days: Number(akEl("apikey-days").value) });
    btn.disabled = false;
    if (error) { agendaToast("Não foi possível gerar a chave: " + error.message); return; }
    akEl("apikey-secret").value = data.key;
    akEl("apikey-exp").textContent = akFmt(data.expires_at);
    akEl("apikey-curl").textContent = `curl -H "x-api-key: ${data.key}" "${akApiUrl()}/leads?limit=500"`;
    akOpen("done");
    return;
  }
  if (e.target.closest("#apikey-copy")) {
    const v = akEl("apikey-secret").value;
    try { await navigator.clipboard.writeText(v); agendaToast("Chave copiada."); } catch (err) { akEl("apikey-secret").select(); }
    return;
  }
  const rev = e.target.closest("[data-ak-revoke]");
  if (rev) {
    if (!confirm("Revogar esta chave? Quem usa ela perde o acesso imediatamente.")) return;
    const { error } = await supabase.rpc("api_key_revoke", { p_id: rev.dataset.akRevoke });
    if (error) { agendaToast("Não foi possível revogar: " + error.message); return; }
    agendaToast("Chave revogada."); renderApiKeys();
  }
});
