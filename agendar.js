/* ============================================================
   PÁGINA PÚBLICA DE AGENDAMENTO — sem login.
     agendar.html?c=<slug>              escolher dia/horário e confirmar
     agendar.html?c=<slug>&l=<token>    igual, com os dados do lead já preenchidos
     agendar.html?c=<slug>&r=<token>    remarcar uma reunião já agendada
     agendar.html?b=<token>             ver a reunião (remarcar / cancelar)
   Toda a regra (horários livres, travas, conflito com a Agenda do sistema)
   está no banco: booking_public_info, booking_slots, booking_create,
   booking_get, booking_cancel, booking_reschedule.
   Depende de config.js (supabase) e i18n.js (t, getLang).
   ============================================================ */

const bkQuery = new URLSearchParams(window.location.search);
const bkSlug = (bkQuery.get("c") || "").trim();
const bkLeadToken = bkQuery.get("l") || null;
const bkManageToken = bkQuery.get("b") || null;
const bkRescheduleToken = bkQuery.get("r") || null;
const bkRoot = document.getElementById("bk-root");

const BK_TZ = {
  BR: { id: "America/Sao_Paulo", flag: "🇧🇷", key: "book.tzBr" },
  IE: { id: "Europe/Dublin", flag: "🇮🇪", key: "book.tzIe" },
};
const BK_COUNTRIES = [
  ["BR", "🇧🇷", "55", "Brasil"], ["IE", "🇮🇪", "353", "Irlanda"], ["PT", "🇵🇹", "351", "Portugal"], ["US", "🇺🇸", "1", "EUA"],
  ["CA", "🇨🇦", "1", "Canadá"], ["GB", "🇬🇧", "44", "Reino Unido"], ["ES", "🇪🇸", "34", "Espanha"], ["FR", "🇫🇷", "33", "França"],
  ["DE", "🇩🇪", "49", "Alemanha"], ["IT", "🇮🇹", "39", "Itália"], ["NL", "🇳🇱", "31", "Holanda"], ["CH", "🇨🇭", "41", "Suíça"],
  ["MT", "🇲🇹", "356", "Malta"], ["AU", "🇦🇺", "61", "Austrália"], ["NZ", "🇳🇿", "64", "Nova Zelândia"], ["AR", "🇦🇷", "54", "Argentina"],
  ["CL", "🇨🇱", "56", "Chile"], ["CO", "🇨🇴", "57", "Colômbia"], ["UY", "🇺🇾", "598", "Uruguai"], ["PY", "🇵🇾", "595", "Paraguai"],
  ["PE", "🇵🇪", "51", "Peru"], ["MX", "🇲🇽", "52", "México"], ["JP", "🇯🇵", "81", "Japão"], ["CN", "🇨🇳", "86", "China"],
  ["AO", "🇦🇴", "244", "Angola"], ["MZ", "🇲🇿", "258", "Moçambique"],
];

/* fuso de exibição: Irlanda se o navegador estiver lá; senão Brasília */
let bkViewTz = (() => {
  try { return /^Europe\/(Dublin|London)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone) ? "IE" : "BR"; } catch (e) { return "BR"; }
})();
const bk = { info: null, slots: [], day: null, slot: null, cursor: null, busy: false };

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const locale = () => ({ pt: "pt-BR", en: "en-IE", es: "es-ES" }[getLang()] || "pt-BR");
const tzId = () => BK_TZ[bkViewTz].id;
const bkCap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---- formatação no fuso escolhido ---- */
function bkDayKey(iso, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || tzId(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function bkTime(iso, tz) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz || tzId(), hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
function bkLongDate(iso, tz) {
  return bkCap(new Intl.DateTimeFormat(locale(), { timeZone: tz || tzId(), weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)));
}
/* "14:00 🇧🇷 · 18:00 🇮🇪" para qualquer instante */
function bkBothTimes(iso) {
  return Object.values(BK_TZ).map(z => `${z.flag} ${bkTime(iso, z.id)}`).join(" · ");
}

/* ---- tela de erro ---- */
function bkShowError(key) {
  bkRoot.innerHTML = `<div class="public-message error">${esc(t(key))}</div>`;
}

/* ---- carregar horários livres (até a janela do consultor) ---- */
async function bkLoadSlots() {
  const today = new Date();
  const out = [];
  const days = (bk.info && bk.info.window_days) || 30;
  for (let from = 0; from <= days + 1; from += 60) {
    const a = new Date(today.getTime() + from * 86400000);
    const b = new Date(today.getTime() + Math.min(from + 59, days + 1) * 86400000);
    const iso = d => d.toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc("booking_slots", { p_slug: bkSlug, p_from: iso(a), p_to: iso(b) });
    if (error) throw error;
    out.push(...(data || []));
  }
  bk.slots = Array.from(new Set(out)).sort();
}
const bkSlotsByDay = () => {
  const map = {};
  bk.slots.forEach(s => { (map[bkDayKey(s)] = map[bkDayKey(s)] || []).push(s); });
  return map;
};

/* ---- seletor de dia + horário ---- */
function bkRenderPicker() {
  const byDay = bkSlotsByDay();
  const dayKeys = Object.keys(byDay).sort();
  const resched = !!bkRescheduleToken;
  if (!bk.cursor) {
    const first = dayKeys[0] ? dayKeys[0] : new Date().toISOString().slice(0, 10);
    bk.cursor = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1);
  }
  const y = bk.cursor.getFullYear(), m = bk.cursor.getMonth();
  const weekStart = getLang() === "en" ? 1 : 0;
  const firstDow = (new Date(y, m, 1).getDay() - weekStart + 7) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const dowNames = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(new Date(2024, 0, 7 + ((i + weekStart) % 7))));
  let cells = "";
  for (let i = 0; i < firstDow; i++) cells += `<span class="bk-day is-empty"></span>`;
  for (let d = 1; d <= dim; d++) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const has = !!byDay[key];
    cells += `<button type="button" class="bk-day${has ? " has-slots" : ""}${key === bk.day ? " is-selected" : ""}" data-day="${key}" ${has ? "" : "disabled"}>${d}</button>`;
  }
  const monthLabel = bkCap(new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(bk.cursor));
  const slotsHtml = bk.day && byDay[bk.day]
    ? `<h3 class="bk-sub">${esc(bkLongDate(byDay[bk.day][0]))}</h3><div class="bk-slots">${byDay[bk.day].map(s => `<button type="button" class="bk-slot${s === bk.slot ? " is-selected" : ""}" data-slot="${s}">${bkTime(s)}</button>`).join("")}</div>`
    : `<p class="muted-note bk-hint">${esc(dayKeys.length ? t("book.pickDay") : t("book.noDays"))}</p>`;

  const header = resched
    ? `<h1 class="public-title">${esc(t("book.rescheduleTitle"))}</h1>`
    : `<h1 class="public-title">${esc(t("book.withName").replace("{name}", bk.info.name))}</h1>
       <p class="public-subtitle">${esc(t("book.durationMin").replace("{n}", bk.info.duration))}${bk.info.intro ? " · " + esc(bk.info.intro) : ""}</p>`;

  bkRoot.innerHTML = `
    ${header}
    <div class="bk-tz">
      <span>${esc(t("book.timezone"))}:</span>
      ${Object.entries(BK_TZ).map(([k, z]) => `<button type="button" class="bk-tz-btn${k === bkViewTz ? " is-active" : ""}" data-tz="${k}">${z.flag} ${esc(t(z.key))}</button>`).join("")}
    </div>
    <div class="bk-picker">
      <div class="bk-cal">
        <div class="bk-cal-nav">
          <button type="button" class="bk-nav" data-nav="-1" aria-label="‹">‹</button>
          <strong>${esc(monthLabel)}</strong>
          <button type="button" class="bk-nav" data-nav="1" aria-label="›">›</button>
        </div>
        <div class="bk-grid">${dowNames.map(n => `<span class="bk-dow">${esc(n)}</span>`).join("")}${cells}</div>
      </div>
      <div class="bk-times">${slotsHtml}</div>
    </div>
    <div id="bk-form-host">${bk.slot ? bkFormHtml() : ""}</div>`;

  bkRoot.querySelectorAll("[data-tz]").forEach(b => b.addEventListener("click", () => {
    bkViewTz = b.dataset.tz; bk.day = null; bk.slot = null; bk.cursor = null; bkRenderPicker();
  }));
  bkRoot.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => {
    bk.cursor = new Date(y, m + Number(b.dataset.nav), 1); bkRenderPicker();
  }));
  bkRoot.querySelectorAll("[data-day]").forEach(b => b.addEventListener("click", () => {
    bk.day = b.dataset.day; bk.slot = null; bkRenderPicker();
  }));
  bkRoot.querySelectorAll("[data-slot]").forEach(b => b.addEventListener("click", () => {
    bk.slot = b.dataset.slot; bkRenderPicker();
    const host = document.getElementById("bk-form-host");
    if (host) host.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  if (bk.slot) bkBindForm();
}

/* ---- formulário de confirmação ---- */
function bkFormHtml() {
  const L = bk.info.lead || {};
  const chosen = `<div class="bk-chosen"><span>${esc(t("book.selected"))}</span><strong>${esc(bkLongDate(bk.slot))}</strong><strong>${bkBothTimes(bk.slot)}</strong></div>`;
  if (bkRescheduleToken) {
    return `${chosen}<button type="button" class="btn btn-primary bk-confirm" id="bk-confirm">${esc(t("book.confirmNew"))}</button><p class="public-message error" id="bk-err" style="display:none;"></p>`;
  }
  const country = L.country || "BR";
  return `${chosen}
    <form class="public-form bk-form" id="bk-form">
      <label><span>${esc(t("book.name"))} <span class="public-required">*</span></span><input type="text" name="name" required value="${esc(L.name || "")}" autocomplete="name"></label>
      <label><span>${esc(t("book.email"))} <span class="public-required">*</span></span><input type="email" name="email" required value="${esc(L.email || "")}" autocomplete="email"></label>
      <label><span>${esc(t("book.phone"))} <span class="public-required">*</span></span>
        <span class="public-phone-row">
          <select name="country" class="public-phone-country">${BK_COUNTRIES.map(c => `<option value="${c[0]}" ${c[0] === country ? "selected" : ""}>${c[1]} +${c[2]} ${esc(c[3])}</option>`).join("")}</select>
          <input type="tel" name="phone" inputmode="numeric" required value="${esc(L.phone || "")}" autocomplete="tel-national">
        </span></label>
      <p class="public-message error" id="bk-err" style="display:none;"></p>
      <button type="submit" class="btn btn-primary bk-confirm" id="bk-confirm">${esc(t("book.confirm"))}</button>
    </form>`;
}
function bkBindForm() {
  const err = document.getElementById("bk-err");
  const showErr = key => { err.textContent = t(key); err.style.display = "block"; };
  const done = (btn, key) => { btn.disabled = false; btn.textContent = t(key); bk.busy = false; };
  const mapError = e => {
    const msg = String((e && e.message) || "");
    if (msg.includes("horario_indisponivel")) return "book.slotTaken";
    if (msg.includes("limite_de_agendamentos")) return "book.limit";
    if (msg.includes("nome_obrigatorio") || msg.includes("email_invalido") || msg.includes("telefone_invalido")) return "book.checkData";
    return "book.errorGeneric";
  };

  if (bkRescheduleToken) {
    const btn = document.getElementById("bk-confirm");
    btn.addEventListener("click", async () => {
      if (bk.busy) return;
      bk.busy = true; btn.disabled = true; btn.textContent = t("book.confirming");
      const { error } = await supabase.rpc("booking_reschedule", { p_token: bkRescheduleToken, p_new_start: bk.slot });
      if (error) {
        showErr(mapError(error)); done(btn, "book.confirmNew");
        if (mapError(error) === "book.slotTaken") { await bkLoadSlots(); bk.slot = null; bkRenderPicker(); }
        return;
      }
      window.location.href = `agendar.html?b=${encodeURIComponent(bkRescheduleToken)}&ok=1`;
    });
    return;
  }

  const form = document.getElementById("bk-form");
  const phone = form.elements.phone, country = form.elements.country;
  /* máscara simples: Brasil (11) 99999-0000; EUA/Canadá (555) 123-4567; demais só dígitos */
  const mask = () => {
    let d = phone.value.replace(/\D/g, "");
    const c = country.value;
    if (c === "BR") {
      if (d.startsWith("55") && d.length > 11) d = d.slice(2);
      d = d.slice(0, 11);
      phone.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
    } else if (c === "US" || c === "CA") {
      d = d.slice(0, 10);
      phone.value = d.length > 6 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d.length > 3 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : d;
    } else phone.value = d.slice(0, 15);
  };
  phone.addEventListener("input", mask);
  country.addEventListener("change", mask);
  mask();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (bk.busy) return;
    const btn = document.getElementById("bk-confirm");
    err.style.display = "none";
    bk.busy = true; btn.disabled = true; btn.textContent = t("book.confirming");
    const { data, error } = await supabase.rpc("booking_create", {
      p_slug: bkSlug, p_start: bk.slot, p_name: form.elements.name.value, p_email: form.elements.email.value,
      p_phone: phone.value, p_country: country.value, p_lead: bkLeadToken,
    });
    if (error || !data) {
      const key = mapError(error);
      showErr(key); done(btn, "book.confirm");
      if (key === "book.slotTaken") { await bkLoadSlots(); bk.slot = null; bkRenderPicker(); const host = document.getElementById("bk-form-host"); if (host) host.insertAdjacentHTML("afterbegin", `<p class="public-message error">${esc(t("book.slotTaken"))}</p>`); }
      return;
    }
    window.location.href = `agendar.html?b=${encodeURIComponent(data.token)}&ok=1`;
  });
}

/* ---- página da reunião (confirmação / remarcar / cancelar) ---- */
function bkIcs(b) {
  const f = iso => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Peregrinos Intercambio//Agendamento//PT", "BEGIN:VEVENT",
    `UID:${bkManageToken}@peregrinos`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(b.start)}`, `DTEND:${f(b.end)}`,
    `SUMMARY:Reunião Peregrinos Intercâmbio com ${b.consultor}`, "END:VEVENT", "END:VCALENDAR"];
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n"));
}
async function bkRenderManage() {
  const { data: b, error } = await supabase.rpc("booking_get", { p_token: bkManageToken });
  if (error || !b) return bkShowError("book.notFound");
  const cancelled = b.status === "cancelada";
  const justBooked = bkQuery.get("ok") === "1" && !cancelled;
  const statusMsg = cancelled
    ? `<div class="public-message error">${esc(t("book.cancelled"))}</div>`
    : `<div class="public-message success">${esc(justBooked ? t("book.confirmedTitle") : t("book.yourMeeting"))}</div>`;
  bkRoot.innerHTML = `
    ${statusMsg}
    <div class="bk-summary">
      <div><small>${esc(t("book.with"))}</small><strong>${esc(b.consultor)}</strong></div>
      <div><small>${esc(t("book.when"))}</small><strong>${esc(bkLongDate(b.start))}</strong>
        <strong class="bk-times-both">${bkBothTimes(b.start)}</strong></div>
      ${b.location ? `<div><small>${esc(t("book.where"))}</small><strong>${/^https?:\/\//i.test(b.location) ? `<a href="${esc(b.location)}" target="_blank" rel="noopener">${esc(b.location)}</a>` : esc(b.location)}</strong></div>` : ""}
    </div>
    ${!cancelled ? `<p class="muted-note">${esc(t("book.confirmedHint"))}</p>` : ""}
    <div class="bk-actions">
      ${!cancelled ? `<a class="btn btn-ghost" href="${bkIcs(b)}" download="reuniao-peregrinos.ics">${esc(t("book.addCalendar"))}</a>` : ""}
      ${b.can_change ? `<a class="btn btn-primary" href="agendar.html?c=${encodeURIComponent(b.slug)}&r=${encodeURIComponent(bkManageToken)}">${esc(t("book.reschedule"))}</a>
      <button type="button" class="btn btn-danger" id="bk-cancel">${esc(t("book.cancel"))}</button>` : (!cancelled ? `<p class="muted-note">${esc(t("book.pastMeeting"))}</p>` : "")}
    </div>`;
  const cancel = document.getElementById("bk-cancel");
  if (cancel) cancel.addEventListener("click", async () => {
    if (!confirm(t("book.cancelConfirm"))) return;
    cancel.disabled = true;
    const { error: e2 } = await supabase.rpc("booking_cancel", { p_token: bkManageToken });
    if (e2) { cancel.disabled = false; alert(t("book.errorGeneric")); return; }
    bkRenderManage();
  });
}

/* ---- início ---- */
async function bkStart() {
  try {
    if (bkManageToken) { await bkRenderManage(); return; }
    if (!bkSlug) return bkShowError("book.unavailable");
    const { data: info, error } = await supabase.rpc("booking_public_info", { p_slug: bkSlug, p_lead: bkLeadToken });
    if (error || !info) return bkShowError("book.unavailable");
    bk.info = info;
    document.title = `${t("book.title")} — ${info.name}`;
    await bkLoadSlots();
    bkRenderPicker();
  } catch (err) {
    console.error(err);
    bkShowError("book.errorGeneric");
  }
}
document.addEventListener("langchange", () => {
  if (bkManageToken) bkRenderManage();
  else if (bk.info) bkRenderPicker();
});
bkStart();
