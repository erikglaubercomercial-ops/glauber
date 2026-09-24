/* Conexão com o banco de dados (Supabase). */
const SUPABASE_URL = "https://knfkrigpithcaaiutosj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuZmtyaWdwaXRoY2FhaXV0b3NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMjI1MjYsImV4cCI6MjEwNTU5ODUyNn0.CnCh-7TKFTE6G5VgMCoTkxn-E0vOss95zEcnHYMhytc";

/* O SDK carregado via CDN já expõe `window.supabase` como o namespace da
   biblioteca (com .createClient). Sobrescrevemos essa mesma variável global
   com a instância do cliente — todo o resto do app usa `supabase.from(...)`
   e `supabase.auth...` normalmente a partir daqui. */
const supabaseLib = window.supabase;
window.supabase = supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* cliente isolado (não persiste sessão) — usado quando o CRM precisa criar
   um login para outra pessoa (ex.: acesso do aluno na matrícula) sem trocar
   a sessão de quem está logado no momento. */
window.createIsolatedSupabaseClient = () =>
  supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
