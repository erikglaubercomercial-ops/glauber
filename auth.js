/* ============================================================
   AUTH / USUÁRIOS / PERMISSÕES — Supabase (login real, dados
   compartilhados entre todos os usuários da empresa).
   Depende de config.js (variável global `supabase`) já carregado.
   ============================================================ */

const MODULES = [
  { id: "leads", label: "Leads" },
  { id: "pipeline", label: "Pipeline" },
  { id: "cotacao", label: "Cotação" },
  { id: "produtos", label: "Produtos" },
  { id: "financeiro", label: "Financeiro" },
  { id: "matriculas", label: "Matrículas" },
  { id: "colaboradores", label: "Time" },
  { id: "contratos", label: "Contratos" },
];

const ROLES = ["ADM", "Gerente", "Consultor", "Influencer", "MKT", "Financeiro"];
const CONFIGURABLE_ROLES = ROLES.filter(r => r !== "ADM");

let rolePermissions = {};

/* ---- sessão ---- */
async function getSession() {
  const { data: { session: authSession } } = await supabase.auth.getSession();
  if (!authSession) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, name, email, role, active")
    .eq("id", authSession.user.id)
    .single();

  if (error || !profile) return null;
  if (!profile.active) {
    await supabase.auth.signOut();
    return null;
  }
  return profile;
}

async function signOut() {
  await supabase.auth.signOut();
}

/* ---- permissões por função ---- */
async function loadRolePermissions() {
  const { data, error } = await supabase.from("role_permissions").select("role, module, allowed");
  const perms = {};
  CONFIGURABLE_ROLES.forEach(r => { perms[r] = {}; });
  if (!error && data) {
    data.forEach(row => {
      if (!perms[row.role]) perms[row.role] = {};
      perms[row.role][row.module] = row.allowed;
    });
  }
  rolePermissions = perms;
  return perms;
}

async function setModuleAccess(role, moduleId, allowed) {
  if (!rolePermissions[role]) rolePermissions[role] = {};
  rolePermissions[role][moduleId] = allowed;
  const { error } = await supabase
    .from("role_permissions")
    .update({ allowed })
    .eq("role", role)
    .eq("module", moduleId);
  if (error) console.error("Erro ao salvar permissão:", error);
}

function hasModuleAccess(role, moduleId) {
  if (role === "ADM") return true;
  return !!(rolePermissions[role] && rolePermissions[role][moduleId]);
}

/* ---- usuários (perfis) ---- */
async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, role, active, created_at")
    .order("name");
  if (error) { console.error("Erro ao carregar usuários:", error); return []; }
  return (data || []).map(u => ({ ...u, createdAt: u.created_at ? new Date(u.created_at).getTime() : Date.now() }));
}

async function updateUserProfile(id, { name, role, active }) {
  const { error } = await supabase.from("profiles").update({ name, role, active }).eq("id", id);
  return !error;
}

function initials(name) {
  return (name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] ? w[0].toUpperCase() : "")
    .join("");
}
