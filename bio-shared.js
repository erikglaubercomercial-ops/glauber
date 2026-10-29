/* ============================================================
   PÁGINA DE LINKS DA BIO — partes compartilhadas entre a página pública (links.html) e a tela de edição do CRM (Meus links).
   Ícones, validação de endereços e o desenho da página (bioRender). Depende de config.js (SUPABASE_URL).
   Os dados chegam como { page, links }, igual à função bio_public do banco.
   ============================================================ */

const BIO_THEMES = [
  { id: "falesia", name: "Falésias da Irlanda" },
  { id: "papel", name: "Papel timbrado" },
  { id: "azul", name: "Azul Peregrinos" },
];
const BIO_DEFAULT_HERO_IMAGE = "/assets/bio-app-previa.jpg";

/* ícones (traço fino, 24x24) — o nome fica salvo em bio_links.icon */
const BIO_ICONS = {
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  whatsapp: '<path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3"/><path d="M16.5 7.5v.01"/>',
  app: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  banco: '<path d="M3 22h18"/><path d="M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="M12 2 20 7H4z"/>',
  cartao: '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
  aviao: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  escola: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>',
  casa: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  globo: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  mapa: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  documento: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  livro: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  video: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><path d="M9.75 15.02 15.5 11.75 9.75 8.48z"/>',
  mensagem: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  email: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/>',
  telefone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  estrela: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  coracao: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  sacola: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
};
const BIO_ICON_LABELS = {
  link: "Link", whatsapp: "WhatsApp", instagram: "Instagram", app: "Aplicativo", download: "Baixar", banco: "Banco", cartao: "Cartão",
  aviao: "Viagem", escola: "Escola", casa: "Acomodação", globo: "Site", mapa: "Local", calendario: "Agenda", documento: "Documento",
  livro: "Livro", video: "Vídeo", mensagem: "Mensagem", email: "E-mail", telefone: "Telefone", estrela: "Estrela", coracao: "Coração", sacola: "Loja",
};
const bioIconSvg = (name, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BIO_ICONS[name] || BIO_ICONS.link}</svg>`;

const bioEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* só http(s), mailto e tel viram link; qualquer outra coisa (javascript:, data:...) é descartada */
function bioSafeUrl(u) {
  const s = String(u || "").trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(s) ? s : "";
}
/* aceita "site.com/pagina" e completa com https:// */
function bioNormalizeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (bioSafeUrl(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(s) && !/\s/.test(s)) return "https://" + s;
  return s;
}
const bioCleanInstagram = s => String(s || "").trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "").slice(0, 30);
const bioCleanWhatsapp = s => String(s || "").replace(/\D/g, "").slice(0, 15);

function bioHeroImageUrl(path) {
  return path ? `${SUPABASE_URL}/storage/v1/object/public/bio-images/${path.split("/").map(encodeURIComponent).join("/")}` : BIO_DEFAULT_HERO_IMAGE;
}

/* desenha a página dentro de `el`. opts.placeholder: mostra 3 botões de exemplo quando ainda não há links (só na prévia do editor). */
function bioRender(el, data, opts = {}) {
  const p = (data && data.page) || {};
  const links = (data && data.links) || [];
  const theme = BIO_THEMES.some(t => t.id === p.theme) ? p.theme : "falesia";
  const logo = theme === "papel" ? "/assets/peregrinos-logo-stacked.png" : "/assets/bio-logo-branco.png";
  const ig = bioCleanInstagram(p.instagram), wa = bioCleanWhatsapp(p.whatsapp);
  const social = [
    ig ? `<a class="bio-social-btn" href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener" aria-label="Instagram">${bioIconSvg("instagram", 21)}</a>` : "",
    wa ? `<a class="bio-social-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${bioIconSvg("whatsapp", 21)}</a>` : "",
  ].join("");
  const heroUrl = bioSafeUrl(p.hero_url);
  const heroInner = `<img class="bio-hero-img" src="${bioEsc(bioHeroImageUrl(p.hero_image_path))}" alt="">
      ${p.hero_title ? `<b class="bio-hero-title">${bioEsc(p.hero_title)}</b>` : ""}
      ${p.hero_subtitle ? `<small class="bio-hero-sub">${bioEsc(p.hero_subtitle)}</small>` : ""}`;
  const hero = p.hero_enabled === false ? "" : heroUrl
    ? `<a class="bio-hero" href="${bioEsc(heroUrl)}" target="_blank" rel="noopener">${heroInner}</a>`
    : `<div class="bio-hero">${heroInner}</div>`;
  const rows = links.map(l => {
    const href = bioSafeUrl(l.url);
    if (!href || !String(l.label || "").trim()) return "";
    return `<a class="bio-link" data-id="${bioEsc(l.id)}" href="${bioEsc(href)}" target="_blank" rel="noopener">
      <span class="bio-ico">${bioIconSvg(l.icon)}</span><span class="bio-lbl">${bioEsc(l.label)}</span><img class="bio-plane" src="/assets/bio-aviao.png" alt=""></a>`;
  }).join("");
  const placeholders = !rows && opts.placeholder
    ? [1, 2, 3].map(() => `<div class="bio-link bio-ph"><span class="bio-ico">${bioIconSvg("link")}</span><span class="bio-lbl">Seu link aqui</span></div>`).join("") : "";

  el.innerHTML = `<div class="bio-stage bio-theme-${theme}"><div class="bio-inner">
    <header class="bio-head">
      <img class="bio-logo" src="${logo}" alt="Peregrinos Intercâmbio">
      ${p.title ? `<h1 class="bio-title">${bioEsc(p.title)}</h1>` : ""}
      ${p.subtitle ? `<p class="bio-subtitle"><img src="/assets/bio-aviao.png" alt=""> ${bioEsc(p.subtitle)}</p>` : ""}
      ${social ? `<div class="bio-social">${social}</div>` : ""}
    </header>
    ${hero}
    <nav class="bio-links">${rows}${placeholders}</nav>
    <footer class="bio-foot">Peregrinos Intercâmbio · O caminho transforma.</footer>
  </div></div>`;
}
