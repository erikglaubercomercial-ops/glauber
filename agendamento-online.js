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
  bkaEl("booking-meeting-link").value = s.meeting_link || "";
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
  bkaRenderGoogle();
}

/* ---- Google Agenda: horários ocupados bloqueiam o link de agendamento ---- */
const BKA_GOOGLE_HOW = `<details class="bka-google-how"><summary>Como pegar o endereço secreto no Google Agenda</summary><ol>
  <li>No computador, abra o <b>Google Agenda</b> › ⚙️ <b>Configurações</b>.</li>
  <li>Na lista à esquerda, em <b>Configurações de minhas agendas</b>, clique na sua agenda principal.</li>
  <li>Role até <b>Integrar agenda</b> e copie o <b>Endereço secreto no formato iCal</b> (começa com <code>https://calendar.google.com/</code>).</li>
  <li>Cole aqui embaixo e clique em <b>Conectar</b>.</li></ol>
  <p class="muted-note">O CRM lê só <b>quando você está ocupado</b> (sem título, descrição ou convidados) e a cada 10 minutos. Eventos marcados como "livre" não bloqueiam. Quem tem esse endereço consegue ler sua agenda: se precisar, gere outro no próprio Google e o antigo deixa de funcionar.</p></details>`;
const bkaAgo = iso => {
  if (!iso) return "ainda não sincronizou";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "agora há pouco" : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dia(s)`;
};
async function bkaRenderGoogle() {
  const box = bkaEl("booking-google-box");
  if (!box) return;
  const own = !!session && bka.consultorId === session.id;
  let st = null;
  try {
    if (own) { const r = await supabase.from("booking_google_links").select("enabled, last_sync_at, busy_count, last_error").eq("consultor_id", bka.consultorId).maybeSingle(); st = r.data || null; }
    else { const r = await supabase.rpc("booking_google_status", { p_consultor: bka.consultorId }); st = (r.data && r.data[0]) || null; }
  } catch (e) { st = null; }
  const status = st
    ? (st.last_error ? `<p class="bka-g-status bad">⚠️ ${escapeHtml(st.last_error)}</p>`
      : `<p class="bka-g-status ok">✅ Conectado · última sincronização ${bkaAgo(st.last_sync_at)} · ${st.busy_count} horário(s) ocupado(s) nos próximos dias</p>`)
    : `<p class="bka-g-status">Não conectado. Os horários que você tem ocupados no Google ainda aparecem livres para o cliente.</p>`;
  if (!own) {
    box.innerHTML = `${status}<p class="muted-note">Cada consultor conecta o próprio Google Agenda na sua tela de Agendamento online.</p>`;
    return;
  }
  box.innerHTML = `
    <p class="muted-note">Conecte o seu Google Agenda para o cliente <b>não conseguir marcar</b> nos horários em que você está ocupado no Google.</p>
    ${status}
    <div class="bka-g-row">
      <input type="password" id="booking-google-url" autocomplete="off" placeholder="${st ? "Endereço já salvo — cole um novo para trocar" : "https://calendar.google.com/calendar/ical/…/basic.ics"}">
      <button type="button" class="btn btn-primary btn-sm" id="booking-google-save">${st ? "Trocar endereço" : "Conectar"}</button>
      ${st ? `<button type="button" class="btn btn-ghost btn-sm" id="booking-google-sync">Sincronizar agora</button><button type="button" class="btn btn-ghost btn-sm" id="booking-google-del">Desconectar</button>` : ""}
    </div>
    ${BKA_GOOGLE_HOW}`;
  const syncNow = async () => {
    try { await supabase.functions.invoke("google-busy-sync", { body: {} }); } catch (e) { /* o status mostra o erro */ }
    await bkaRenderGoogle();
  };
  bkaEl("booking-google-save").addEventListener("click", async () => {
    const url = bkaEl("booking-google-url").value.trim();
    if (!/^https:\/\/calendar\.google\.com\//i.test(url)) { alert("Cole o \"Endereço secreto no formato iCal\" do Google Agenda (começa com https://calendar.google.com/)."); return; }
    const btn = bkaEl("booking-google-save"); btn.disabled = true; btn.textContent = "Conectando…";
    const { error } = await supabase.from("booking_google_links").upsert({ consultor_id: bka.consultorId, ics_url: url, enabled: true, last_error: null, last_sync_at: null });
    if (error) { btn.disabled = false; btn.textContent = "Conectar"; alert("Não foi possível salvar o endereço."); return; }
    await syncNow();
  });
  const syncBtn = bkaEl("booking-google-sync"); if (syncBtn) syncBtn.addEventListener("click", async () => { syncBtn.disabled = true; syncBtn.textContent = "Sincronizando…"; await syncNow(); });
  const delBtn = bkaEl("booking-google-del");
  if (delBtn) delBtn.addEventListener("click", async () => {
    if (!confirm("Desconectar o Google Agenda? Os horários ocupados no Google voltam a aparecer livres para o cliente.")) return;
    const { error } = await supabase.from("booking_google_links").delete().eq("consultor_id", bka.consultorId);
    if (error) { alert("Não foi possível desconectar."); return; }
    await bkaRenderGoogle();
  });
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
      <div class="bka-block-acts">
        <button type="button" class="btn btn-ghost btn-sm" data-bka-edit="${b.id}">Editar</button>
        <button type="button" class="btn btn-ghost btn-sm" data-bka-dup="${b.id}">Duplicar</button>
        <button type="button" class="btn btn-ghost btn-sm" data-bka-del="${b.id}">Remover</button>
      </div></div>`;
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
  bkaResetBlockForm();
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
    meeting_link: bkaEl("booking-meeting-link").value.trim(),
  };
  if (patch.meeting_link && !/^https?:\/\//i.test(patch.meeting_link)) { alert("O link de reunião precisa começar com https:// (ex.: https://meet.google.com/abc-defg-hij)."); return; }
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

/* edição de uma trava já salva: o formulário de baixo é preenchido e o botão vira "Salvar alterações" */
function bkaFillBlockForm(b) {
  bkaEl("bkb-from").value = b.date_from;
  bkaEl("bkb-to").value = b.date_to || "";
  bkaEl("bkb-allday").checked = !!b.all_day;
  bkaEl("bkb-tfrom").value = b.time_from ? String(b.time_from).slice(0, 5) : "";
  bkaEl("bkb-tto").value = b.time_to ? String(b.time_to).slice(0, 5) : "";
  bkaWeekdaysRender((b.weekdays || []).map(String));
  bkaEl("bkb-tz").value = b.tz;
  bkaEl("bkb-note").value = b.note || "";
  bkaToggleAllDay();
}
function bkaSetEditing(id, label) {
  bka.editId = id || null;
  bkaEl("bkb-submit").textContent = id ? "💾 Salvar alterações" : "🔒 Travar horário";
  bkaEl("bkb-cancel").style.display = id ? "" : "none";
  const note = bkaEl("bkb-editing");
  note.style.display = label ? "" : "none";
  note.textContent = label || "";
  bkaEl("booking-block-form").scrollIntoView({ behavior: "smooth", block: "center" });
}
function bkaResetBlockForm() {
  bkaEl("booking-block-form").reset();
  bkaEl("bkb-from").value = new Date().toISOString().slice(0, 10);
  bkaWeekdaysRender([]); bkaToggleAllDay();
  bka.editId = null;
  bkaEl("bkb-submit").textContent = "🔒 Travar horário";
  bkaEl("bkb-cancel").style.display = "none";
  bkaEl("bkb-editing").style.display = "none";
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
  if (bka.editId) {
    const { consultor_id, ...patch } = row;
    const up = await supabase.from("booking_blocks").update(patch).eq("id", bka.editId).select().single();
    if (up.error) { console.error(up.error); alert("Não foi possível salvar as alterações."); return; }
    bka.blocks = bka.blocks.map(b => (b.id === bka.editId ? (up.data || { ...b, ...patch }) : b));
  } else {
    const { data, error } = await supabase.from("booking_blocks").insert(row).select().single();
    if (error) { console.error(error); alert("Não foi possível travar o horário."); return; }
    bka.blocks.push(data);
  }
  bka.blocks.sort((a, b) => a.date_from.localeCompare(b.date_from));
  bkaRenderBlocks();
  bkaResetBlockForm();
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
bkaEl("booking-who").addEventListener("change", async e => { if (await bkaLoad(e.target.value)) { bkaRenderForm(); bkaResetBlockForm(); } });
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
bkaEl("bkb-cancel").addEventListener("click", bkaResetBlockForm);
bkaEl("booking-blocks").addEventListener("click", async e => {
  const ed = e.target.closest("[data-bka-edit]");
  const dup = e.target.closest("[data-bka-dup]");
  if (ed || dup) {
    const b = bka.blocks.find(x => x.id === (ed || dup).dataset[ed ? "bkaEdit" : "bkaDup"]);
    if (!b) return;
    bkaFillBlockForm(b);
    bkaSetEditing(ed ? b.id : null, ed ? "Editando a trava selecionada — altere e clique em Salvar alterações." : "Cópia da trava: ajuste o que quiser e clique em Travar horário para criar uma nova.");
    return;
  }
  const del = e.target.closest("[data-bka-del]");
  if (!del || !confirm("Remover esta trava? O horário volta a ficar disponível para o cliente.")) return;
  const { error } = await supabase.from("booking_blocks").delete().eq("id", del.dataset.bkaDel);
  if (error) { alert("Não foi possível remover."); return; }
  bka.blocks = bka.blocks.filter(b => b.id !== del.dataset.bkaDel);
  if (bka.editId === del.dataset.bkaDel) bkaResetBlockForm();
  bkaRenderBlocks();
});
bkaWeekdaysRender([]);
