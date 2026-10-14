/* ============================================================
   AGENDAMENTO ONLINE — configuração no CRM (janela aberta pelo botão
   "🔗 Agendamento online" da Agenda): link do consultor, horários de
   atendimento, duração/intervalo/antecedência e horários travados.
   A página que o cliente abre é agendar.html (agendar.js); as regras de
   disponibilidade ficam no banco (migração 061).
   Depende de script.js: session, users, leads, supabase, escapeHtml, formatDate.
   ============================================================ */

const BKA_DAYS = [
  { dow: 1, label: "Segunda-feira" }, { dow: 2, label: "Terça-feira" }, { dow: 3, label: "Quarta-feira" },
  { dow: 4, label: "Quinta-feira" }, { dow: 5, label: "Sexta-feira" }, { dow: 6, label: "Sábado" }, { dow: 0, label: "Domingo" },
];
const BKA_DOW_SHORT = [["0", "D"], ["1", "S"], ["2", "T"], ["3", "Q"], ["4", "Q"], ["5", "S"], ["6", "S"]];
const BKA_TZ_LABEL = { "America/Sao_Paulo": "🇧🇷 Brasília", "Europe/Dublin": "🇮🇪 Irlanda" };
const bka = { consultorId: null, settings: null, blocks: [] };
const bkaEl = id => document.getElementById(id);

function bkaLink(slug, leadToken) {
  return `${window.location.origin}/agendar.html?c=${encodeURIComponent(slug)}${leadToken ? `&l=${encodeURIComponent(leadToken)}` : ""}`;
}
async function bkaCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e) { /* sem permissão */ }
    ta.remove(); return ok;
  }
}
function bkaToast(msg) {
  if (typeof agendaToast === "function") agendaToast(msg); else alert(msg);
}

/* ---- dados ---- */
async function bkaLoad(consultorId) {
  bka.consultorId = consultorId;
  let { data: s, error } = await supabase.from("booking_settings").select("*").eq("consultor_id", consultorId).maybeSingle();
  if (error) { console.error("Erro ao carregar agendamento online:", error); }
  if (!s) {
    /* consultor sem configuração (criado antes do gatilho): cria a padrão */
    const u = users.find(x => x.id === consultorId);
    const base = String((u && u.name) || "consultor").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "consultor";
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const ins = await supabase.from("booking_settings").insert({ consultor_id: consultorId, slug, display_name: (u && u.name) || "" }).select().single();
    if (ins.error) { alert("Não foi possível criar a configuração do link."); return false; }
    s = ins.data;
  }
  bka.settings = s;
  const b = await supabase.from("booking_blocks").select("*").eq("consultor_id", consultorId).order("date_from", { ascending: true });
  bka.blocks = b.data || [];
  return true;
}

/* ---- tela ---- */
function bkaRenderForm() {
  const s = bka.settings;
  const link = bkaLink(s.slug);
  bkaEl("booking-enabled").checked = !!s.enabled;
  bkaEl("booking-link").value = link;
  bkaEl("booking-open").href = link;
  bkaEl("booking-tz").value = s.tz;
  bkaEl("booking-duration").value = String(s.duration_min);
  bkaEl("booking-buffer").value = String(s.buffer_min);
  bkaEl("booking-notice").value = s.min_notice_hours;
  bkaEl("booking-window").value = s.window_days;
  bkaEl("booking-display").value = s.display_name || "";
  bkaEl("booking-intro").value = s.intro || "";
  bkaEl("booking-saved").textContent = "";
  bkaEl("booking-week").innerHTML = BKA_DAYS.map(d => {
    const iv = (s.weekly && s.weekly[String(d.dow)] && s.weekly[String(d.dow)][0]) || null;
    return `<div class="bka-day-row${iv ? "" : " is-off"}" data-dow="${d.dow}">
      <label class="bka-switch"><input type="checkbox" class="bka-on" ${iv ? "checked" : ""}><span>${d.label}</span></label>
      <input type="time" class="bka-from" value="${iv ? iv[0] : "09:00"}" ${iv ? "" : "disabled"}>
      <input type="time" class="bka-to" value="${iv ? iv[1] : "18:00"}" ${iv ? "" : "disabled"}>
    </div>`;
  }).join("");
  bkaEl("booking-week").querySelectorAll(".bka-on").forEach(cb => cb.addEventListener("change", () => {
    const row = cb.closest(".bka-day-row");
    row.classList.toggle("is-off", !cb.checked);
    row.querySelectorAll("input[type=time]").forEach(i => { i.disabled = !cb.checked; });
  }));
  bkaRenderBlocks();
}

function bkaBlockText(b) {
  const days = (b.weekdays && b.weekdays.length) ? b.weekdays.slice().sort().map(d => ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d]).join(", ") : "todos os dias";
  const range = b.date_to ? (b.date_to === b.date_from ? formatDate(b.date_from) : `${formatDate(b.date_from)} → ${formatDate(b.date_to)}`) : `a partir de ${formatDate(b.date_from)}`;
  const hours = b.all_day ? "dia inteiro" : `${String(b.time_from).slice(0, 5)}–${String(b.time_to).slice(0, 5)}`;
  return { title: `${range} · ${hours}`, sub: `${days} · ${BKA_TZ_LABEL[b.tz] || b.tz}${b.note ? " · " + b.note : ""}` };
}
function bkaRenderBlocks() {
  const box = bkaEl("booking-blocks");
  box.innerHTML = bka.blocks.length ? bka.blocks.map(b => {
    const x = bkaBlockText(b);
    return `<div class="bka-block"><div><strong>🔒 ${escapeHtml(x.title)}</strong><small>${escapeHtml(x.sub)}</small></div>
      <button type="button" class="btn btn-ghost btn-sm" data-bka-del="${b.id}">Remover</button></div>`;
  }).join("") : `<p class="muted-note">Nenhum horário travado.</p>`;
}

async function bkaOpen() {
  const backdrop = bkaEl("booking-modal-backdrop");
  const manager = session && (session.role === "ADM" || session.role === "Gerente");
  const wrap = bkaEl("booking-who-wrap");
  const who = bkaEl("booking-who");
  wrap.style.display = manager ? "" : "none";
  if (manager) {
    const team = users.filter(u => u.active !== false && ["ADM", "Gerente", "Consultor"].includes(u.role)).slice().sort((a, b) => a.name.localeCompare(b.name));
    who.innerHTML = team.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
    who.value = bka.consultorId && team.some(u => u.id === bka.consultorId) ? bka.consultorId : session.id;
  }
  const id = manager ? who.value : session.id;
  if (!(await bkaLoad(id))) return;
  bkaRenderForm();
  /* data inicial padrão do formulário de trava: hoje */
  if (!bkaEl("bkb-from").value) bkaEl("bkb-from").value = new Date().toISOString().slice(0, 10);
  backdrop.classList.add("open");
}
const bkaClose = () => bkaEl("booking-modal-backdrop").classList.remove("open");

/* ---- salvar configurações ---- */
async function bkaSave() {
  const weekly = {};
  for (const row of bkaEl("booking-week").querySelectorAll(".bka-day-row")) {
    if (!row.querySelector(".bka-on").checked) continue;
    const a = row.querySelector(".bka-from").value, b = row.querySelector(".bka-to").value;
    if (!a || !b || b <= a) { alert(`Confira o horário de ${BKA_DAYS.find(d => String(d.dow) === row.dataset.dow).label}: o fim precisa ser depois do início.`); return; }
    weekly[row.dataset.dow] = [[a, b]];
  }
  const patch = {
    enabled: bkaEl("booking-enabled").checked, tz: bkaEl("booking-tz").value, weekly,
    duration_min: Number(bkaEl("booking-duration").value), buffer_min: Number(bkaEl("booking-buffer").value),
    min_notice_hours: Math.max(0, Number(bkaEl("booking-notice").value) || 0),
    window_days: Math.min(180, Math.max(1, Number(bkaEl("booking-window").value) || 30)),
    display_name: bkaEl("booking-display").value.trim(), intro: bkaEl("booking-intro").value.trim(),
  };
  const btn = bkaEl("booking-save");
  btn.disabled = true;
  const { data, error } = await supabase.from("booking_settings").update(patch).eq("consultor_id", bka.consultorId).select().single();
  btn.disabled = false;
  if (error) { console.error(error); alert("Não foi possível salvar."); return; }
  bka.settings = data;
  bkaEl("booking-saved").textContent = "✓ Salvo";
}

/* ---- horários travados ---- */
function bkaWeekdaysRender(selected) {
  bkaEl("bkb-weekdays").innerHTML = BKA_DOW_SHORT.map(([v, l]) => `<button type="button" class="bka-dow${selected.includes(v) ? " is-on" : ""}" data-dow="${v}" title="${["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][Number(v)]}">${l}</button>`).join("");
}
function bkaToggleAllDay() { bkaEl("bkb-times").style.display = bkaEl("bkb-allday").checked ? "none" : ""; }

function bkaPreset(kind) {
  const today = new Date().toISOString().slice(0, 10);
  bkaEl("bkb-from").value = today; bkaEl("bkb-to").value = "";
  bkaEl("bkb-tz").value = bka.settings.tz;
  if (kind === "lunch") { bkaEl("bkb-allday").checked = false; bkaEl("bkb-tfrom").value = "12:00"; bkaEl("bkb-tto").value = "13:00"; bkaWeekdaysRender([]); bkaEl("bkb-note").value = "Almoço"; }
  if (kind === "weekend") { bkaEl("bkb-allday").checked = true; bkaWeekdaysRender(["0", "6"]); bkaEl("bkb-note").value = "Fim de semana"; }
  if (kind === "today") { bkaEl("bkb-allday").checked = true; bkaEl("bkb-to").value = today; bkaWeekdaysRender([]); bkaEl("bkb-note").value = ""; }
  bkaToggleAllDay();
}

async function bkaAddBlock(e) {
  e.preventDefault();
  const allDay = bkaEl("bkb-allday").checked;
  const from = bkaEl("bkb-from").value, to = bkaEl("bkb-to").value || null;
  const tf = bkaEl("bkb-tfrom").value, tt = bkaEl("bkb-tto").value;
  if (!allDay && (!tf || !tt || tt <= tf)) { alert("Informe o horário: o fim precisa ser depois do início (ou marque Dia inteiro)."); return; }
  if (to && to < from) { alert("A data final não pode ser antes da inicial."); return; }
  const weekdays = Array.from(bkaEl("bkb-weekdays").querySelectorAll(".bka-dow.is-on")).map(b => Number(b.dataset.dow));
  const row = {
    consultor_id: bka.consultorId, tz: bkaEl("bkb-tz").value, date_from: from, date_to: to, all_day: allDay,
    time_from: allDay ? null : tf, time_to: allDay ? null : tt, weekdays: weekdays.length ? weekdays : null, note: bkaEl("bkb-note").value.trim(),
  };
  const { data, error } = await supabase.from("booking_blocks").insert(row).select().single();
  if (error) { console.error(error); alert("Não foi possível travar o horário."); return; }
  bka.blocks.push(data);
  bka.blocks.sort((a, b) => a.date_from.localeCompare(b.date_from));
  bkaRenderBlocks();
  bkaEl("booking-block-form").reset();
  bkaEl("bkb-from").value = new Date().toISOString().slice(0, 10);
  bkaWeekdaysRender([]); bkaToggleAllDay();
}

/* ---- ficha do lead: copia o link personalizado ---- */
async function copyBookingLinkForLead(leadId, consultorId) {
  const lead = leads.find(l => l.id === leadId);
  const cid = (lead && lead.consultorId) || consultorId;
  if (!cid) { alert("Este lead ainda não tem consultor. Direcione o lead para um consultor antes de enviar o link de agendamento."); return; }
  const { data, error } = await supabase.from("booking_settings").select("slug, enabled").eq("consultor_id", cid).maybeSingle();
  if (error || !data) { alert("O consultor deste lead ainda não tem o link de agendamento configurado (Agenda > Agendamento online)."); return; }
  const url = bkaLink(data.slug, lead && lead.bookingToken);
  const ok = await bkaCopy(url);
  bkaToast(ok ? (data.enabled ? "Link de agendamento copiado! Cole na conversa com o cliente." : "Link copiado, mas está DESATIVADO. Ative em Agenda > Agendamento online.") : url);
}

/* ---- ligações ---- */
bkaEl("ag-booking").addEventListener("click", bkaOpen);
bkaEl("booking-modal-close").addEventListener("click", bkaClose);
bkaEl("booking-modal-backdrop").addEventListener("click", e => { if (e.target === bkaEl("booking-modal-backdrop")) bkaClose(); });
bkaEl("booking-who").addEventListener("change", async e => { if (await bkaLoad(e.target.value)) bkaRenderForm(); });
bkaEl("booking-copy").addEventListener("click", async () => { bkaToast((await bkaCopy(bkaEl("booking-link").value)) ? "Link copiado!" : "Selecione e copie o link manualmente."); });
bkaEl("booking-save").addEventListener("click", bkaSave);
bkaEl("booking-block-form").addEventListener("submit", bkaAddBlock);
bkaEl("bkb-allday").addEventListener("change", bkaToggleAllDay);
bkaEl("booking-block-form").addEventListener("click", e => {
  const dow = e.target.closest(".bka-dow");
  if (dow) { dow.classList.toggle("is-on"); return; }
  const preset = e.target.closest("[data-bka-preset]");
  if (preset) bkaPreset(preset.dataset.bkaPreset);
});
bkaEl("booking-blocks").addEventListener("click", async e => {
  const del = e.target.closest("[data-bka-del]");
  if (!del || !confirm("Remover esta trava? O horário volta a ficar disponível para o cliente.")) return;
  const { error } = await supabase.from("booking_blocks").delete().eq("id", del.dataset.bkaDel);
  if (error) { alert("Não foi possível remover."); return; }
  bka.blocks = bka.blocks.filter(b => b.id !== del.dataset.bkaDel);
  bkaRenderBlocks();
});
bkaWeekdaysRender([]);
