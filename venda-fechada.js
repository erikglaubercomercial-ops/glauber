/* ============================================================
   VENDA FECHADA — popup no topo da tela, com som de caixa registrador e o nome do consultor,
   toda vez que um cliente assina o contrato. Aparece para toda a equipe logada.
   • Consulta o banco a cada 10 s (rpc vendas_fechadas_novas); não mostra vendas antigas.
   • O som é gerado no navegador (sem arquivo). Navegadores só liberam áudio depois do primeiro
     clique na página; antes disso o popup aparece sem som.
   • Em "Ver como…" (somente leitura) não aparece.
   Depende de script.js: session, supabase, escapeHtml.
   ============================================================ */
const vfState = { since: null, seen: new Set(), timer: null, queue: [], showing: false, audio: null };
const vfActive = () => typeof session !== "undefined" && !!session && !(typeof viewAs !== "undefined" && viewAs.active);

function vfAudioCtx() {
  if (vfState.audio) return vfState.audio;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { vfState.audio = new AC(); } catch (e) { return null; }
  return vfState.audio;
}
/* libera o áudio no primeiro clique/tecla do usuário */
["pointerdown", "keydown"].forEach(ev => document.addEventListener(ev, () => { const a = vfAudioCtx(); if (a && a.state === "suspended") a.resume().catch(() => {}); }, { passive: true }));

/* "cha-ching": gaveta abrindo (ruído curto) + dois sinos agudos + moedas */
function vfPlayCashRegister() {
  const a = vfAudioCtx();
  if (!a) return;
  if (a.state === "suspended") a.resume().catch(() => {});
  if (a.state !== "running") return;
  const t0 = a.currentTime + 0.02;
  const master = a.createGain();
  master.gain.value = 0.55;
  master.connect(a.destination);
  /* clique mecânico da gaveta */
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * 0.12), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const noise = a.createBufferSource();
  noise.buffer = buf;
  const nf = a.createBiquadFilter();
  nf.type = "bandpass"; nf.frequency.value = 1800; nf.Q.value = 0.9;
  const ng = a.createGain();
  ng.gain.setValueAtTime(0.9, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  noise.connect(nf); nf.connect(ng); ng.connect(master);
  noise.start(t0);
  /* sino: duas notas com harmônico, o "ching" */
  const bell = (freq, start, dur, vol) => {
    [1, 2.76, 5.4].forEach((mult, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = "sine"; o.frequency.value = freq * mult;
      const v = vol / (i + 1.2);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(v, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g); g.connect(master);
      o.start(start); o.stop(start + dur + 0.05);
    });
  };
  bell(1568, t0 + 0.10, 0.9, 0.5);
  bell(2093, t0 + 0.24, 1.3, 0.5);
  /* moedas caindo */
  [0.55, 0.64, 0.70, 0.80, 0.86].forEach((d, i) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = "triangle"; o.frequency.value = 2600 + i * 310;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + d + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.12);
    o.connect(g); g.connect(master);
    o.start(t0 + d); o.stop(t0 + d + 0.15);
  });
}

function vfEnsureDom() {
  let host = document.getElementById("vf-host");
  if (host) return host;
  host = document.createElement("div");
  host.id = "vf-host";
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}
function vfShowNext() {
  if (vfState.showing || !vfState.queue.length) return;
  const v = vfState.queue.shift();
  vfState.showing = true;
  const host = vfEnsureDom();
  const card = document.createElement("div");
  card.className = "vf-card";
  card.innerHTML = `<div class="vf-icon">💰</div>
    <div class="vf-text"><div class="vf-title">Venda fechada!</div><div class="vf-name">${escapeHtml(v.consultor)}</div><div class="vf-sub">o cliente acabou de assinar o contrato</div></div>
    <button type="button" class="vf-close" aria-label="Fechar">&times;</button>`;
  host.appendChild(card);
  requestAnimationFrame(() => card.classList.add("vf-in"));
  vfPlayCashRegister();
  const done = () => {
    clearTimeout(timer);
    card.classList.remove("vf-in");
    setTimeout(() => { card.remove(); vfState.showing = false; vfShowNext(); }, 350);
  };
  const timer = setTimeout(done, 9000);
  card.querySelector(".vf-close").addEventListener("click", done);
}

async function vfPoll() {
  if (!vfActive() || document.visibilityState !== "visible") return;
  /* volta 2 min na busca: uma assinatura gravada há pouco pode só ficar visível depois; o conjunto "seen" evita repetir */
  const from = vfState.since ? new Date(new Date(vfState.since).getTime() - 120000).toISOString() : null;
  const { data, error } = await supabase.rpc("vendas_fechadas_novas", { p_desde: from });
  if (error || !data) return;
  const first = vfState.since === null;
  vfState.since = data.agora;
  if (first) return;
  (data.vendas || []).forEach(v => {
    if (vfState.seen.has(v.lead_id)) return;
    vfState.seen.add(v.lead_id);
    vfState.queue.push(v);
  });
  vfShowNext();
}
function vfStart() {
  if (vfState.timer) return;
  vfPoll();
  vfState.timer = setInterval(vfPoll, 10000);
}
(function vfBoot() {
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (vfActive()) { clearInterval(iv); vfStart(); }
    else if (tries > 60) clearInterval(iv);
  }, 1000);
})();
