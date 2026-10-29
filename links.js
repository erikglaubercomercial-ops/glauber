/* ============================================================
   PÁGINA PÚBLICA DE LINKS (links.html) — sem login. O endereço vem de /l/<nome> (reescrito pela Vercel para
   links.html?s=<nome>). Os dados saem da função bio_public (só página publicada; só links ligados e preenchidos).
   Cliques e visitas são contados por bio_click / bio_view (chamadas sem esperar resposta).
   Depende de config.js (SUPABASE_URL, SUPABASE_ANON_KEY, supabase) e bio-shared.js.
   ============================================================ */

(async function () {
  const root = document.getElementById("bio-root");
  const slugFromPath = (location.pathname.match(/^\/l\/([^/]+)/) || [])[1];
  const slug = String(slugFromPath || new URLSearchParams(location.search).get("s") || "").trim().toLowerCase();

  const message = text => {
    root.innerHTML = `<div class="bio-msg"><div><img src="/assets/bio-logo-branco.png" alt="Peregrinos Intercâmbio"><p>${bioEsc(text)}</p></div></div>`;
  };
  if (!slug) return message("Página não encontrada.");

  const { data, error } = await supabase.rpc("bio_public", { p_slug: slug });
  if (error) return message("Não foi possível carregar a página agora. Tente novamente em instantes.");
  if (!data) return message("Página não encontrada.");

  document.title = `${data.page.title || "Peregrinos Intercâmbio"}`;
  bioRender(root, data);

  /* contagem sem atrasar quem clica: keepalive deixa o pedido terminar mesmo com a página abrindo outra aba */
  const hit = (fn, body) => {
    try {
      fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify(body),
      }).catch(() => {});
    } catch (e) { /* contagem é opcional */ }
  };
  hit("bio_view", { p_slug: slug });
  root.addEventListener("click", e => {
    const a = e.target.closest(".bio-link[data-id]");
    if (a) hit("bio_click", { p_link: a.dataset.id });
  });
})();
