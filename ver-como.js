/* ============================================================
   VER COMO… (só ADM): troca a visão do sistema para a de outra função, ou de um
   consultor específico, com um clique — sem sair da conta.
   • É só para olhar: a tela passa a mostrar o que aquela pessoa vê (menus, telas
     liberadas, leads, pipeline, matrículas, comissões, contratos e os números).
   • Somente leitura: enquanto a visão estiver trocada, NADA é gravado no banco.
   • O banco continua sabendo que quem está logado é o ADM; o filtro dos dados
     acontece aqui na tela, seguindo as mesmas regras de acesso do Consultor.
   • A escolha vale só nesta aba (sessionStorage); fechar a aba volta ao normal.
   Carregado antes do script.js; depende de `session` e `supabase` só em tempo de uso.
   ============================================================ */

const VIEW_AS_KEY = "crm-view-as";
const viewAs = { active: false, role: null, userId: null, label: "", realSession: null };

function viewAsRead() {
  try { return JSON.parse(sessionStorage.getItem(VIEW_AS_KEY) || "null"); } catch (e) { return null; }
}
function viewAsWrite(target) {
  try {
    if (target) sessionStorage.setItem(VIEW_AS_KEY, JSON.stringify(target));
    else sessionStorage.removeItem(VIEW_AS_KEY);
  } catch (e) { /* sem armazenamento: a troca não persiste */ }
}

/* chamado no início da inicialização, logo depois do login: devolve a sessão a usar */
async function viewAsPrepare(realSession) {
  const target = viewAsRead();
  if (!target || !realSession || realSession.role !== "ADM") { if (target) viewAsWrite(null); return realSession; }
  let person = null;
  if (target.userId) {
    const { data } = await supabase.from("profiles").select("id, name, email, role, active, also_influencer").eq("id", target.userId).single();
    person = data || null;
  }
  viewAs.active = true;
  viewAs.realSession = realSession;
  viewAs.role = target.role;
  viewAs.userId = person ? person.id : null;
  viewAs.label = person ? person.name : target.role;
  viewAsInstallReadOnlyGuard();
  return { ...realSession, role: target.role, id: person ? person.id : realSession.id, name: person ? person.name : `${realSession.name} (visão ${target.role})`, email: person ? person.email : realSession.email, alsoInfluencer: person ? !!person.also_influencer : false };
}

const viewAsIsConsultor = () => viewAs.active && viewAs.role === "Consultor" && !!viewAs.userId;

/* ids dos leads do consultor visto (usado por negócios, contratos e follow-ups) */
async function viewAsOwnLeadIds() {
  const { data } = await supabase.from("leads").select("id").eq("consultor_id", viewAs.userId);
  return new Set((data || []).map(r => r.id));
}
/* mesmas regras de acesso do Consultor no banco (RLS), aplicadas às linhas já carregadas */
async function viewAsScopeRows(kind, rows) {
  if (!viewAsIsConsultor()) return rows;
  const uid = viewAs.userId;
  if (kind === "leads" || kind === "enrollments" || kind === "commissions") return rows.filter(r => r.consultor_id === uid);
  const own = await viewAsOwnLeadIds();
  if (kind === "quotes") return rows.filter(r => r.consultor_id === uid || own.has(r.lead_id));
  if (kind === "deals") return rows.filter(r => r.consultor_id === uid || own.has(r.lead_id));
  if (kind === "contracts" || kind === "followups") return rows.filter(r => own.has(r.lead_id));
  return rows;
}

/* ---- somente leitura ---- */
function viewAsToast(msg) {
  if (typeof agendaToast === "function") agendaToast(msg); else alert(msg);
}
let viewAsLastWarn = 0;
function viewAsBlockedResult() {
  const now = Date.now();
  if (now - viewAsLastWarn > 2500) { viewAsLastWarn = now; viewAsToast("Visão de teste: nada é salvo enquanto você vê como outra função."); }
  return { data: null, error: { message: "Modo visualização: nada é salvo.", code: "VIEW_AS" } };
}
function viewAsBlockedBuilder() {
  const proxy = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then"
      ? (res, rej) => Promise.resolve(viewAsBlockedResult()).then(res, rej)
      : () => proxy),
    apply: () => proxy,
  });
  return proxy;
}
const VIEW_AS_RPC_READ = /^(lead_ficha|lead_ficha_dados|team_scores|team_scores_monthly|booking_slots|booking_get|booking_public_info|get_|app_metricas|app_usuarios|app_linha_do_tempo|app_meu_link|app_links_equipe)/;
function viewAsInstallReadOnlyGuard() {
  const origFrom = supabase.from.bind(supabase);
  supabase.from = table => {
    const qb = origFrom(table);
    ["insert", "update", "upsert", "delete"].forEach(m => { qb[m] = () => viewAsBlockedBuilder(); });
    return qb;
  };
  const origRpc = supabase.rpc.bind(supabase);
  supabase.rpc = (name, ...rest) => (VIEW_AS_RPC_READ.test(name) ? origRpc(name, ...rest) : viewAsBlockedBuilder());
  const origStorageFrom = supabase.storage.from.bind(supabase.storage);
  supabase.storage.from = bucket => {
    const b = origStorageFrom(bucket);
    ["upload", "remove", "move", "copy", "update"].forEach(m => { if (typeof b[m] === "function") b[m] = async () => viewAsBlockedResult(); });
    return b;
  };
}

/* ---- botão e menu ---- */
const VA_ROLES = ["Gerente", "Influencer", "MKT", "Financeiro"];
function viewAsEnter(target) { viewAsWrite(target); window.location.reload(); }
function viewAsExit() { viewAsWrite(null); window.location.reload(); }

function viewAsCloseMenu() { document.getElementById("va-menu")?.remove(); }
function viewAsOpenMenu() {
  viewAsCloseMenu();
  const btn = document.getElementById("btn-view-as");
  const consultores = users.filter(u => u.role === "Consultor" && u.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name));
  const cur = viewAs.active ? viewAs : null;
  const row = (attrs, html, on) => `<button type="button" class="va-item${on ? " on" : ""}" ${attrs}>${html}</button>`;
  const menu = document.createElement("div");
  menu.id = "va-menu";
  menu.className = "va-menu";
  menu.innerHTML = `
    <div class="va-title">Ver o sistema como…</div>
    ${row('data-va="exit"', "<b>ADM</b><small>minha visão completa</small>", !cur)}
    <div class="va-sep">Consultor</div>
    ${consultores.length ? consultores.map(u => row(`data-va="consultor" data-id="${u.id}"`, `<b>${escapeHtml(u.name)}</b><small>vê só os leads dele</small>`, cur && cur.userId === u.id)).join("") : '<div class="va-empty">Nenhum consultor ativo.</div>'}
    <div class="va-sep">Outras funções</div>
    ${VA_ROLES.map(r => row(`data-va="role" data-role="${r}"`, `<b>${r}</b><small>menus e telas liberados para a função</small>`, cur && !cur.userId && cur.role === r)).join("")}
    <div class="va-note">Só para olhar: nada é salvo enquanto a visão estiver trocada.</div>`;
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 290))}px`;
  menu.style.bottom = `${Math.max(8, window.innerHeight - r.top + 8)}px`;
  menu.addEventListener("click", e => {
    const b = e.target.closest("[data-va]");
    if (!b) return;
    if (b.dataset.va === "exit") viewAsExit();
    else if (b.dataset.va === "consultor") viewAsEnter({ role: "Consultor", userId: b.dataset.id });
    else if (b.dataset.va === "role") viewAsEnter({ role: b.dataset.role, userId: null });
  });
}

/* chamado no fim da inicialização (script.js) */
function viewAsInitUi() {
  const real = viewAs.active ? viewAs.realSession : session;
  if (!real || real.role !== "ADM") return;
  const btn = document.getElementById("btn-view-as");
  if (btn) {
    btn.style.display = "";
    btn.classList.toggle("on", viewAs.active);
    btn.addEventListener("click", e => { e.stopPropagation(); if (document.getElementById("va-menu")) viewAsCloseMenu(); else viewAsOpenMenu(); });
    document.addEventListener("click", e => { if (!e.target.closest("#va-menu")) viewAsCloseMenu(); });
  }
  if (!viewAs.active) return;
  document.body.classList.add("va-on");
  const bar = document.createElement("div");
  bar.className = "va-bar";
  bar.innerHTML = `<span class="va-eye">👁</span><span>Vendo como <b>${escapeHtml(viewAs.role)}${viewAs.userId ? " · " + escapeHtml(viewAs.label) : ""}</b> · só leitura</span><button type="button" id="va-back">Voltar para ADM</button>`;
  document.body.appendChild(bar);
  document.getElementById("va-back").addEventListener("click", viewAsExit);
}
