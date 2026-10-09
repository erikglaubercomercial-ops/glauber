/* ============================================================
   FICHA DO CLIENTE — abre ao clicar no nome do lead.
   Tudo vem da consulta única `lead_ficha` (banco), que cruza lead, negócio,
   cotação, contrato, matrícula, parcelas, comissão, documentos, portal,
   follow-ups, anotações e histórico. Nada é copiado: enquanto a ficha está
   aberta, ela se atualiza sozinha a cada poucos segundos.
   Também roda os avisos por popup: follow-up agendado, embarque em 40 dias
   (conferir pagamentos e documentos) e 15 dias (reunião de pré-embarque).
   Depende de script.js (supabase, session, leads, enrollments, helpers).
   ============================================================ */

const FICHA_POLL_MS = 5000;
const FICHA_DOCS = [
  { kind: "passaporte", label: "Passaporte válido (mín. 6 meses)" },
  { kind: "passagens", label: "Passagens aéreas" },
  { kind: "comprovante_financeiro", label: "Comprovante financeiro" },
  { kind: "matricula_seguros", label: "Matrícula da escola com seguros" },
];

let fichaLeadId = null;
let fichaData = null;
let fichaJson = "";
let fichaTimer = null;
let fichaShowAll = false;
let fichaPersonal = null;
let fichaLoading = false;

const $fx = id => document.getElementById(id);
const fxEsc = s => escapeHtml(s == null ? "" : String(s));
const fxIso = v => (v ? String(v).slice(0, 10) : "");
const fxDateObj = iso => { const [y, m, d] = fxIso(iso).split("-").map(Number); return new Date(y, m - 1, d); };
const fxToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const fxDaysUntil = iso => Math.round((fxDateObj(iso) - fxToday()) / 86400000);
const fxShort = v => {
  if (!v) return "";
  const d = fxIso(v).length === 10 && String(v).length === 10 ? fxDateObj(v) : new Date(v);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
};
const fxFull = v => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const fxDateTime = v => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const fxInitials = name => (name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";

/* ---------------- abrir / fechar / atualizar ---------------- */
async function openFicha(leadId) {
  if (!leadId) return;
  /* lead criado depois que a tela abriu (ex.: capturado pelo app): busca no banco antes de abrir */
  if (!leads.some(l => l.id === leadId)) {
    try { leads = await loadLeads(); renderLeads(); } catch (e) { console.error("Erro ao atualizar leads:", e); }
  }
  fichaLeadId = leadId;
  fichaData = null; fichaJson = ""; fichaShowAll = false; fichaPersonal = null;
  $fx("ficha-loading").style.display = "";
  $fx("ficha-body").style.display = "none";
  $fx("ficha-fu-form").style.display = "none";
  $fx("ficha-note-text").value = "";
  $fx("ficha-backdrop").classList.add("open");
  $fx("ficha-backdrop").scrollTop = 0;
  await fichaLoad();
  clearInterval(fichaTimer);
  fichaTimer = setInterval(fichaLoad, FICHA_POLL_MS);
}

function closeFicha() {
  clearInterval(fichaTimer);
  fichaTimer = null;
  fichaLeadId = null;
  $fx("ficha-backdrop").classList.remove("open");
}

async function fichaLoad() {
  if (!fichaLeadId || fichaLoading) return;
  fichaLoading = true;
  const id = fichaLeadId;
  const { data, error } = await supabase.rpc("lead_ficha", { p_lead: id });
  fichaLoading = false;
  if (id !== fichaLeadId) return;
  if (error || !data) {
    console.error("Erro ao carregar a ficha:", error);
    $fx("ficha-loading").textContent = error && /sem_acesso/.test(error.message || "")
      ? "Esse lead não está disponível para você."
      : "Não foi possível abrir a ficha deste cliente.";
    $fx("ficha-loading").style.display = "";
    return;
  }
  const json = JSON.stringify(data);
  if (json === fichaJson) return;
  fichaJson = json;
  fichaData = data;
  fichaRender();
}

/* ---------------- lógica da jornada ---------------- */
function fxEvDate(d, kind) {
  const list = (d.events || []).filter(e => e.kind === kind);
  return list.length ? list[list.length - 1].occurred_at : null;
}

function fxIsPostSale(d) {
  return !!((d.contract && d.contract.status === "Assinado") || d.enrollment || (d.deal && isWonStage(d.deal.stage)));
}

function fxDocState(d) {
  const e = d.enrollment || {};
  const map = {};
  (d.documents || []).forEach(x => { map[x.kind] = x; });
  const minMonths = (d.settings && d.settings.passport_min_months) || 6;
  const base = e.arrival_date ? fxDateObj(e.arrival_date) : fxToday();
  const limit = new Date(base); limit.setMonth(limit.getMonth() + minMonths);
  let passportValid = null;
  if (e.passport_expiry_date) passportValid = fxDateObj(e.passport_expiry_date) >= limit;
  return FICHA_DOCS.map(doc => {
    const rec = map[doc.kind];
    let label = doc.label;
    if (doc.kind === "comprovante_financeiro" && d.settings) label = `Comprovante financeiro · ${currency(d.settings.financial_proof_eur)}`;
    const autoPassport = doc.kind === "passaporte" && !rec && !!e.passport_photo_path && passportValid === true;
    return { ...doc, label, received: rec ? !!rec.received : autoPassport, passportValid: doc.kind === "passaporte" ? passportValid : null };
  });
}

function fxJourneySteps(d) {
  const e = d.enrollment, q = d.quote, c = d.contract, lead = d.lead;
  const recs = d.receivables || [];
  const paid = recs.filter(r => r.pago);
  const steps = [
    { label: "Lead novo", done: true, date: lead.created_at },
    { label: "Em contato", done: (lead.status && lead.status !== "Novo") || !!d.deal && d.deal.stage !== (STAGES[0] && STAGES[0].id), date: fxEvDate(d, "status") },
    { label: "Cotação criada", done: !!q, date: q && q.created_at },
    { label: "Cotação aprovada", done: !!(q && q.aprovada_em), date: q && q.aprovada_em },
    { label: "Contrato assinado", done: !!(c && c.status === "Assinado"), date: c && c.signed_at },
    { label: "Entrada paga", done: paid.length > 0, date: paid.length ? paid[0].pago_em : null },
    { label: "Matrícula na escola", done: !!(e && !e.matricula_pendente && e.school), date: fxEvDate(d, "matricula_realizada"), pendingText: e && e.matricula_pendente ? "pendente" : "" },
    { label: "Embarque", done: !!(e && e.arrival_date && fxDaysUntil(e.arrival_date) <= 0), date: e && e.arrival_date, fixedDate: true },
  ];
  const firstOpen = steps.findIndex(s => !s.done);
  return steps.map((s, i) => ({ ...s, now: i === firstOpen }));
}

function fxNextStep(d) {
  const e = d.enrollment;
  if (!fxIsPostSale(d)) {
    const q = d.quote;
    if (!q) return "Próximo passo: criar a cotação com os dados do cliente.";
    if (!q.aprovada_em) return "Próximo passo: o cliente aprovar a cotação pelo link.";
    return "Próximo passo: gerar o contrato e enviar para assinatura.";
  }
  if (e && e.matricula_pendente) return "Próximo passo: concluir a matrícula na escola e marcar como realizada.";
  const recs = d.receivables || [];
  const open = recs.filter(r => !r.pago);
  if (open.length) return `Próximo passo: receber ${currency(open.reduce((s, r) => s + Number(r.valor || 0), 0))} em aberto (vence ${fxFull(open[0].vencimento + "T12:00:00")}).`;
  const missing = fxDocState(d).filter(x => !x.received).length;
  if (missing) return `Próximo passo: reunir os documentos de embarque (${missing} pendente${missing > 1 ? "s" : ""}).`;
  return "Tudo em dia. Acompanhe até o embarque.";
}

/* ---------------- render ---------------- */
function fichaRender() {
  const d = fichaData;
  if (!d) return;
  $fx("ficha-loading").style.display = "none";
  $fx("ficha-body").style.display = "";
  fxRenderHero(d);
  fxRenderJourney(d);
  fxRenderCards(d);
  fxRenderFollowups(d);
  fxRenderNotes(d);
  fxRenderTimeline(d);
  fxRenderFoot(d);
}

function fxTeamName(d) {
  if (!d.consultor || typeof teams === "undefined") return "";
  const u = users.find(x => x.id === d.consultor.id);
  const tm = u && teams.find(x => x.id === u.team_id);
  return tm ? "time: " + tm.name : "";
}

function fxRenderHero(d) {
  const lead = d.lead, e = d.enrollment, deal = d.deal, post = fxIsPostSale(d), v = d.viewer || {};
  const recs = d.receivables || [];
  const total = recs.reduce((s, r) => s + Number(r.valor || 0), 0);
  const paid = recs.filter(r => r.pago).reduce((s, r) => s + Number(r.valor || 0), 0);
  const stageLabel = deal ? (deal.stage_label || "") : "";
  const next = (d.followups || []).filter(f => !f.done).sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  const badges = [];
  if (deal && isWonStage(deal.stage)) badges.push('<span class="fx-b ok">✓ Venda fechada</span>');
  else if (stageLabel) badges.push(`<span class="fx-b warn">● ${fxEsc(stageLabel)}</span>`);
  if (e && e.matricula_pendente) badges.push('<span class="fx-b bad">⚠ Matrícula ainda não realizada</span>');
  if (d.portal && d.portal.active) badges.push('<span class="fx-b">Portal do aluno ativo</span>');
  if (!post && next) badges.push(`<span class="fx-b bad">🔔 Follow-up ${fxDateTime(next.due_at)}</span>`);
  if (d.portal && d.portal.unread_from_student > 0) badges.push(`<span class="fx-b warn">💬 ${d.portal.unread_from_student} mensagem(ns) do aluno</span>`);

  const kpis = [];
  if (post && recs.length) {
    kpis.push(`<div class="prod-kpi"><span class="prod-kpi-value">${currency(paid)}</span><span class="prod-kpi-label">pagos de ${currency(total)}</span></div>`);
    kpis.push(`<div class="prod-kpi"><span class="prod-kpi-value">${currency(Math.max(total - paid, 0))}</span><span class="prod-kpi-label">falta pagar</span></div>`);
  } else if (d.quote) {
    kpis.push(`<div class="prod-kpi"><span class="prod-kpi-value">${currency(d.quote.value)}</span><span class="prod-kpi-label">cotação nº ${fxEsc(d.quote.numero || "—")}</span></div>`);
  }
  if (e && e.arrival_date) {
    const days = fxDaysUntil(e.arrival_date);
    kpis.push(`<div class="prod-kpi"><span class="prod-kpi-value">${days >= 0 ? days + " dias" : "Embarcou"}</span><span class="prod-kpi-label">para o embarque · ${fxFull(e.arrival_date + "T12:00:00")}</span></div>`);
  } else if (lead.pretende_vir) {
    kpis.push(`<div class="prod-kpi"><span class="prod-kpi-value" style="font-size:18px">${fxEsc(lead.pretende_vir)}</span><span class="prod-kpi-label">pretende vir</span></div>`);
  }
  if (v.financeiro && d.school_transfers && Number(d.school_transfers.total) > 0) {
    kpis.push(`<div class="prod-kpi"><span class="prod-kpi-value">${currency(d.school_transfers.total)}</span><span class="prod-kpi-label">enviados à escola</span></div>`);
  }

  $fx("ficha-hero").innerHTML = `
    <button type="button" class="fx-close" id="ficha-close" aria-label="Fechar">&times;</button>
    <div class="fx-head">
      <div class="fx-avatar">${fxEsc(fxInitials(lead.name))}</div>
      <div>
        <h2>${fxEsc(lead.name)}</h2>
        <p>${[lead.email, lead.phone, lead.source ? "origem: " + lead.source : "", d.consultor ? "consultor: " + d.consultor.name : "", fxTeamName(d)].filter(Boolean).map(fxEsc).join(" · ")}</p>
      </div>
    </div>
    <div class="fx-badges">${badges.join("")}</div>
    ${kpis.length ? `<div class="prod-kpis">${kpis.join("")}</div>` : ""}`;
  $fx("ficha-close").addEventListener("click", closeFicha);
}

function fxRenderJourney(d) {
  const e = d.enrollment;
  let html = "";
  if (fxIsPostSale(d)) {
    const steps = fxJourneySteps(d);
    html = `<h3><span class="ic">➜</span>Jornada do cliente</h3><div class="fx-steps">` + steps.map((s, i) => `
      <div class="fx-step ${s.done ? "done" : (s.now ? "now" : "todo")}">
        <div class="fx-dot">${s.done ? "✓" : i + 1}</div>
        <div class="lb">${fxEsc(s.label)}</div>
        <div class="dt">${s.fixedDate ? (s.date ? fxFull(s.date + "T12:00:00") : "sem data") : (s.date ? fxShort(s.date) : (s.pendingText || "—"))}</div>
      </div>`).join("") + `</div>
      <div class="fx-next">💡 ${fxEsc(fxNextStep(d))}</div>`;
    html += fxPlaneBar(d);
  } else {
    const stages = (STAGES || []).filter(s => !s.isLost);
    const cur = d.deal ? stages.findIndex(s => s.id === d.deal.stage) : 0;
    const idx = cur < 0 ? 0 : cur;
    html = `<h3><span class="ic">➜</span>Etapas até a venda</h3><div class="fx-steps">` + stages.map((s, i) => `
      <div class="fx-step ${i < idx ? "done" : (i === idx ? "now" : "todo")}">
        <div class="fx-dot">${i < idx ? "✓" : i + 1}</div><div class="lb">${fxEsc(s.label)}</div>
      </div>`).join("") + `</div><div class="fx-next">💡 ${fxEsc(fxNextStep(d))}</div>`;
  }
  $fx("ficha-journey").innerHTML = html;
  const sim = $fx("fx-days-sim");
  if (sim) sim.addEventListener("input", () => fxPlaneUpdate(d, +sim.value));
}

function fxPlaneBar(d) {
  const e = d.enrollment, c = d.contract;
  if (!e || !e.arrival_date) {
    return `<div class="fx-next" style="background:var(--content-bg);color:var(--text-muted);margin-top:10px">✈ Informe a data de chegada na matrícula para ativar a barra com o aviãozinho.</div>`;
  }
  const startIso = c && c.signed_at ? c.signed_at : e.created_at;
  const start = new Date(startIso); start.setHours(0, 0, 0, 0);
  const end = fxDateObj(e.arrival_date);
  const total = Math.max(Math.round((end - start) / 86400000), 1);
  const alert = (d.settings && d.settings.alert_days) || 40, meet = (d.settings && d.settings.meeting_days) || 15;
  const left = (n) => Math.max(0, Math.min(100, (1 - n / total) * 100));
  const daysLeft = fxDaysUntil(e.arrival_date);
  const pct = Math.max(0, Math.min(100, ((fxToday() - start) / 86400000 / total) * 100));
  return `<div class="fx-track-wrap"><div class="fx-mu" style="font-size:12.5px;font-weight:700">${daysLeft > 0 ? `Faltam ${daysLeft} dias para o embarque.` : (daysLeft === 0 ? "Embarque hoje." : "Embarque realizado.")}</div><div class="fx-track" id="fx-track">
      <div class="fx-fill" style="width:${pct}%"></div>
      ${total > alert ? `<div class="fx-tick k40" style="left:${left(alert)}%"></div><span class="fx-tk" style="left:${left(alert)}%;color:var(--danger)">${alert} dias</span>` : ""}
      ${total > meet ? `<div class="fx-tick k15" style="left:${left(meet)}%"></div><span class="fx-tk" style="left:${left(meet)}%;color:var(--primary)">${meet} dias</span>` : ""}
      <svg class="fx-plane" style="left:${pct}%" width="34" height="34" viewBox="0 0 24 24" fill="#fff3e0" stroke="#fb9d2d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="Avião de papel"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
      <span class="fx-tk" style="left:0;transform:none;top:42px">Contrato · ${fxFull(startIso)}</span>
      <span class="fx-tk" style="left:auto;right:0;transform:none;top:42px">Embarque · ${fxFull(e.arrival_date + "T12:00:00")}</span>
    </div></div>`;
}
function fxPlaneUpdate() { /* a barra é calculada pela data real; sem simulação na ficha de produção */ }

function fxRow(label, value) { return `<div class="fx-r"><span>${label}</span><span>${value}</span></div>`; }

function fxRenderCards(d) {
  const cards = [];
  const post = fxIsPostSale(d), v = d.viewer || {}, e = d.enrollment, lead = d.lead;

  /* financeiro */
  const recs = d.receivables || [];
  if (post || recs.length) {
    const total = recs.reduce((s, r) => s + Number(r.valor || 0), 0) || (d.quote ? Number(d.quote.value) : 0);
    const paid = recs.filter(r => r.pago).reduce((s, r) => s + Number(r.valor || 0), 0);
    const pct = total > 0 ? Math.min(100, Math.round(paid / total * 100)) : 0;
    let h = `<div class="fx-card"><h3><span class="ic">€</span>Resumo financeiro</h3>
      <div class="fx-big"><span class="v">${currency(paid)}</span><span class="t">pagos de ${currency(total)}</span></div>
      <div class="fx-bar"><div style="width:${pct}%"></div></div>`;
    if (!recs.length) h += `<p class="fx-mu" style="font-size:12.5px;margin:0">Nenhuma parcela lançada ainda no Financeiro.</p>`;
    recs.forEach(r => {
      const late = !r.pago && r.vencimento < new Date().toISOString().slice(0, 10);
      h += fxRow(r.pago ? `Parcela ${r.numero}/${r.total} · ${fxFull(r.pago_em)}` : `Parcela ${r.numero}/${r.total} · vence ${fxFull(r.vencimento + "T12:00:00")}`,
        `<span class="${r.pago ? "fx-ok" : (late ? "fx-bad" : "fx-wr")}">${currency(r.valor)} ${r.pago ? "pago" : (late ? "em atraso" : "pendente")}</span>`);
    });
    const cm = d.commission;
    if (cm) {
      const own = v.role === "Consultor";
      const state = cm.status === "Pago" ? '<span class="fx-ok">paga</span>'
        : (cm.released ? '<span class="fx-ok">liberada</span>' : `<span class="fx-wr">pendente · aguardando ${currency(cm.min)} do cliente (pagou ${currency(cm.paid_by_client)})</span>`);
      h += fxRow(own ? "Sua comissão" : "Comissão do consultor", `${currency(cm.amount)} · ${state}`);
    }
    if (v.financeiro) {
      if (d.school_transfers) h += fxRow("Enviado à escola", currency(d.school_transfers.total));
      const sp = d.split;
      if (sp) {
        h += fxRow("Ganho da Peregrinos", currency(sp.peregrinos_gross));
        h += fxRow("Gerente do time", currency(sp.manager_amount));
        h += fxRow("CAC", currency(sp.cac_amount));
        h += fxRow("Sobra da Peregrinos", `<span class="${Number(sp.peregrinos_net) < 0 ? "fx-bad" : "fx-ok"}">${currency(sp.peregrinos_net)}</span>`);
      }
    }
    cards.push(h + "</div>");
  }

  /* curso e viagem */
  if (e) {
    let h = `<div class="fx-card"><h3><span class="ic">✈</span>Curso e viagem</h3>`;
    h += fxRow("Escola", fxEsc(e.school || "—"));
    h += fxRow("Turno", fxEsc(e.turno || "—"));
    h += fxRow("Chegada na Irlanda", e.arrival_date ? fxFull(e.arrival_date + "T12:00:00") : '<span class="fx-wr">a informar</span>');
    h += fxRow("Início das aulas", e.class_start_date ? fxFull(e.class_start_date + "T12:00:00") : "—");
    const meet = (d.settings && d.settings.meeting_days) || 15;
    const warnDate = e.arrival_date ? (() => { const x = fxDateObj(e.arrival_date); x.setDate(x.getDate() - meet); return x.toLocaleDateString("pt-BR"); })() : "";
    h += fxRow("Reunião de pré-embarque", e.pre_embark_at ? `<span class="fx-ok">${fxDateTime(e.pre_embark_at)}</span>` : `<span class="fx-wr">a agendar</span>${warnDate ? `<br><small class="fx-mu" style="font-weight:600">aviso em ${warnDate}</small>` : ""}`);
    h += `<div class="fx-meet"><input type="datetime-local" id="fx-meet-input" value="${e.pre_embark_at ? fxLocalInput(e.pre_embark_at) : ""}"><button type="button" class="btn btn-primary btn-sm" id="fx-meet-save">${e.pre_embark_at ? "Reagendar" : "Agendar reunião"}</button></div>`;
    h += `<div class="fx-acts">${d.quote ? `<span class="prod-chip">Cotação ${fxEsc(d.quote.numero || "")} · ${fxEsc(d.quote.status || "")}</span>` : ""}${d.contract ? `<button type="button" class="btn btn-ghost btn-sm" id="fx-open-contract">Contrato ${fxEsc(d.contract.numero || "")}</button>` : ""}</div></div>`;
    cards.push(h);
  } else if (d.quote || d.contract) {
    cards.push(`<div class="fx-card"><h3><span class="ic">📄</span>Cotação e contrato</h3>
      ${d.quote ? fxRow("Cotação", `${fxEsc(d.quote.numero || "")} · ${currency(d.quote.value)}`) + fxRow("Aprovação do cliente", d.quote.aprovada_em ? `<span class="fx-ok">aprovada em ${fxFull(d.quote.aprovada_em)}</span>` : '<span class="fx-wr">aguardando</span>') : ""}
      ${d.contract ? fxRow("Contrato", `${fxEsc(d.contract.numero || "")} · ${fxEsc(d.contract.status)}`) : ""}</div>`);
  }

  /* documentos */
  if (e) {
    const docs = fxDocState(d);
    const got = docs.filter(x => x.received).length;
    let h = `<div class="fx-card"><h3><span class="ic">🗂</span>Documentos</h3>`;
    docs.forEach(x => {
      let st = x.received ? '<span class="fx-ok">em mãos</span>' : '<span class="fx-wr">pendente</span>';
      if (x.kind === "passaporte" && x.passportValid !== null) st += `<br><small class="${x.passportValid ? "fx-ok" : "fx-bad"}" style="font-weight:700">${x.passportValid ? `validade ok · até ${fxFull(e.passport_expiry_date + "T12:00:00")}` : "validade menor que 6 meses na chegada"}</small>`;
      h += `<label class="fx-doc"><input type="checkbox" data-doc="${x.kind}" ${x.received ? "checked" : ""}><span class="nm">${fxEsc(x.label)}</span><span class="st">${st}</span></label>`;
    });
    h += `<div class="fx-mu" style="font-size:11.5px;padding-top:6px">${got} de ${docs.length} documentos em mãos</div>
      <div id="fx-all-data" class="fx-all" style="display:${fichaShowAll ? "" : "none"}">${fichaShowAll && fichaPersonal ? fxPersonalHtml(fichaPersonal) : ""}</div>
      <div class="fx-acts"><button type="button" class="btn btn-ghost btn-sm" id="fx-btn-all">${fichaShowAll ? "🔓 Ocultar dados" : "🔒 Ver todos os dados"}</button>
      ${e.passport_photo_path ? '<button type="button" class="btn btn-ghost btn-sm" id="fx-btn-pass">Baixar passaporte</button>' : ""}</div>
      <p class="fx-mu" style="margin:8px 0 0;font-size:11.5px">CPF, endereço e contatos ficam ocultos até clicar.</p></div>`;
    cards.push(h);
  } else {
    cards.push(`<div class="fx-card"><h3><span class="ic">👤</span>Dados do lead</h3>
      ${fxRow("Telefone", fxEsc(lead.phone || "—"))}${fxRow("E-mail", fxEsc(lead.email || "—"))}${fxRow("Origem", fxEsc(lead.source || "—"))}
      ${fxRow("Pretende vir", fxEsc(lead.pretende_vir || "—"))}${fxRow("Status", fxEsc(lead.status || "—"))}</div>`);
  }

  /* portal */
  if (e) {
    const p = d.portal || {};
    cards.push(`<div class="fx-card"><h3><span class="ic">💻</span>Portal do aluno</h3>
      ${fxRow("Status", p.active ? '<span class="fx-ok">Ativo</span>' : '<span class="fx-wr">Ainda sem acesso</span>')}
      ${fxRow("Login", fxEsc(p.login || e.email || "—"))}
      ${fxRow("Último acesso", p.last_sign_in_at ? fxDateTime(p.last_sign_in_at) : "—")}
      ${fxRow("Mensagens", `${p.messages_total || 0} trocadas${p.unread_from_student ? ` · <span class="fx-wr">${p.unread_from_student} não lida(s)</span>` : ""}`)}
      <div class="fx-acts"><button type="button" class="btn btn-ghost btn-sm" id="fx-copy-link">Copiar link da matrícula</button><button type="button" class="btn btn-ghost btn-sm" id="fx-open-enr">Abrir matrícula</button></div></div>`);
  }

  $fx("ficha-cards").innerHTML = cards.join("");
  fxBindCards(d);
}

function fxLocalInput(iso) {
  const x = new Date(iso);
  const p = n => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}

function fxPersonalHtml(p) {
  const rows = [["Nome", p.name], ["E-mail", p.email], ["Telefone", p.phone], ["CPF", p.cpf], ["Nascimento", p.birth_date ? fxFull(p.birth_date + "T12:00:00") : ""], ["Nacionalidade", p.nationality],
    ["Passaporte", [p.passport_number, p.passport_issue_date ? "exp. " + fxFull(p.passport_issue_date + "T12:00:00") : "", p.passport_expiry_date ? "val. " + fxFull(p.passport_expiry_date + "T12:00:00") : ""].filter(Boolean).join(" · ")],
    ["Endereço", [p.address, p.city, p.zip].filter(Boolean).join(" · ")], ["Emergência", [p.emergency_name, p.emergency_phone].filter(Boolean).join(" · ")]];
  return rows.map(r => `<div class="fx-r"><span>${r[0]}</span><span>${fxEsc(r[1] || "—")}</span></div>`).join("");
}

function fxBindCards(d) {
  const e = d.enrollment;
  document.querySelectorAll("#ficha-cards [data-doc]").forEach(cb => {
    cb.addEventListener("change", async () => {
      const { error } = await supabase.from("enrollment_documents").upsert({
        enrollment_id: e.id, kind: cb.dataset.doc, received: cb.checked,
        received_at: cb.checked ? new Date().toISOString() : null, received_by: session.id,
      });
      if (error) { console.error("Erro ao marcar documento:", error); alert("Não foi possível salvar o documento."); }
      fichaJson = ""; fichaLoad();
    });
  });
  const allBtn = $fx("fx-btn-all");
  if (allBtn) allBtn.addEventListener("click", async () => {
    if (fichaShowAll) { fichaShowAll = false; fichaPersonal = null; fichaJson = ""; fichaLoad(); return; }
    allBtn.disabled = true;
    const { data, error } = await supabase.rpc("lead_ficha_dados", { p_lead: fichaLeadId });
    allBtn.disabled = false;
    if (error) { alert("Você não tem permissão para ver esses dados."); return; }
    fichaPersonal = data; fichaShowAll = true; fichaJson = ""; fichaLoad();
  });
  const passBtn = $fx("fx-btn-pass");
  if (passBtn) passBtn.addEventListener("click", async () => {
    const { data: blob, error } = await supabase.storage.from("passport-photos").download(e.passport_photo_path);
    if (error || !blob) { alert("Não foi possível baixar o passaporte."); return; }
    const ext = (e.passport_photo_path.split(".").pop() || "pdf").toLowerCase();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Passaporte - ${(e.name || "cliente").replace(/[\\/:*?"<>|]+/g, " ").trim()}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  const meetBtn = $fx("fx-meet-save");
  if (meetBtn) meetBtn.addEventListener("click", async () => {
    const v = $fx("fx-meet-input").value;
    if (!v) { alert("Escolha a data e a hora da reunião."); return; }
    const { error } = await supabase.rpc("set_pre_embark", { p_enrollment: e.id, p_at: new Date(v).toISOString() });
    if (error) { console.error(error); alert("Não foi possível salvar a reunião."); return; }
    const local = enrollments.find(x => x.id === e.id); if (local) local.preEmbarkAt = new Date(v).toISOString();
    fichaJson = ""; fichaLoad();
  });
  const link = $fx("fx-copy-link");
  if (link) link.addEventListener("click", async () => {
    const local = enrollments.find(x => x.id === e.id);
    if (!local) return;
    try { await navigator.clipboard.writeText(buildPublicEnrollmentUrl(local.publicToken)); link.textContent = "Link copiado"; setTimeout(() => { link.textContent = "Copiar link da matrícula"; }, 1500); }
    catch { prompt("Copie o link:", buildPublicEnrollmentUrl(local.publicToken)); }
  });
  const openEnr = $fx("fx-open-enr");
  if (openEnr) openEnr.addEventListener("click", () => { closeFicha(); openEnrollmentModal(e.id); });
  const ct = $fx("fx-open-contract");
  if (ct) ct.addEventListener("click", () => { closeFicha(); switchView("contratos"); openContractModal(d.contract.id); });
}

/* ---------------- follow-ups, anotações, linha do tempo ---------------- */
function fxRenderFollowups(d) {
  const list = d.followups || [];
  const open = list.filter(f => !f.done).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const done = list.filter(f => f.done).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 3);
  const now = Date.now();
  const row = (f, isDone) => {
    const when = new Date(f.due_at);
    const hot = !isDone && when.getTime() <= now;
    return `<div class="fx-ag"><div class="fx-date ${hot ? "hot" : ""}">${fxShort(f.due_at).toUpperCase()}<br>${when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
      <div style="flex:1"><div style="font-weight:800">${fxEsc(f.kind)}${isDone ? ' <span class="fx-ok" style="font-size:11px">concluído</span>' : ""}</div><div class="fx-mu" style="font-size:12px">${fxEsc(f.note || "—")}</div></div>
      ${isDone ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-fu-done="${f.id}" title="Concluir">✓</button><button type="button" class="btn btn-ghost btn-sm" data-fu-del="${f.id}" title="Excluir">&times;</button>`}</div>`;
  };
  $fx("ficha-followups").innerHTML = (open.length ? open.map(f => row(f, false)).join("") : '<p class="fx-mu" style="margin:0;font-size:12.5px">Nenhum follow-up agendado.</p>') + done.map(f => row(f, true)).join("");
  $fx("ficha-followups").querySelectorAll("[data-fu-done]").forEach(b => b.addEventListener("click", async () => {
    const { error } = await supabase.from("lead_followups").update({ done: true, done_at: new Date().toISOString() }).eq("id", b.dataset.fuDone);
    if (error) alert("Não foi possível concluir."); fichaJson = ""; fichaLoad();
  }));
  $fx("ficha-followups").querySelectorAll("[data-fu-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Excluir este follow-up?")) return;
    await supabase.from("lead_followups").delete().eq("id", b.dataset.fuDel); fichaJson = ""; fichaLoad();
  }));
}

function fxRenderNotes(d) {
  $fx("ficha-notes").innerHTML = (d.notes || []).map(n => `<div class="fx-nt"><small>${fxDateTime(n.created_at)} · ${fxEsc(n.author_name || "equipe")}</small>${fxEsc(n.body)}</div>`).join("")
    || '<p class="fx-mu" style="margin:6px 0 0;font-size:12.5px">Nenhuma anotação ainda.</p>';
}

function fxRenderTimeline(d) {
  const e = d.enrollment;
  const items = (d.events || []).map(ev => ({ at: ev.occurred_at, text: ev.title, fut: false }));
  const nowMs = Date.now();
  (d.followups || []).filter(f => !f.done && new Date(f.due_at).getTime() > nowMs).forEach(f => items.push({ at: f.due_at, text: `Follow-up: ${f.kind}${f.note ? " · " + f.note : ""}`, fut: true }));
  if (e && e.arrival_date) {
    const alertD = (d.settings && d.settings.alert_days) || 40, meetD = (d.settings && d.settings.meeting_days) || 15;
    const mk = n => { const x = fxDateObj(e.arrival_date); x.setDate(x.getDate() - n); return x; };
    if (mk(alertD).getTime() > nowMs) items.push({ at: mk(alertD).toISOString(), text: `Aviso de ${alertD} dias: conferir pagamentos e documentos`, fut: true });
    if (!e.pre_embark_at && mk(meetD).getTime() > nowMs) items.push({ at: mk(meetD).toISOString(), text: "Aviso para agendar a reunião de pré-embarque", fut: true });
    if (fxDateObj(e.arrival_date).getTime() > nowMs) items.push({ at: fxDateObj(e.arrival_date).toISOString(), text: "Embarque para a Irlanda", fut: true });
  }
  if (e && e.pre_embark_at && new Date(e.pre_embark_at).getTime() > nowMs) items.push({ at: e.pre_embark_at, text: "Reunião de pré-embarque", fut: true });
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  $fx("ficha-timeline").innerHTML = `<h3><span class="ic">⟲</span>Linha do tempo</h3><div class="fx-tl">` + items.map(it =>
    `<div class="fx-ev ${it.fut ? "fut" : ""}"><span class="d">${fxShort(it.at).toUpperCase()}<br><span style="font-weight:600">${new Date(it.at).getFullYear()}</span></span><span>${fxEsc(it.text)}</span></div>`).join("") + `</div>`;
}

function fxRenderFoot(d) {
  const lead = leads.find(l => l.id === d.lead.id);
  const digits = lead ? leadWhatsAppDigits(lead) : null;
  $fx("ficha-foot").innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" id="fx-edit">Editar lead</button>
    ${d.enrollment ? '<button type="button" class="btn btn-ghost btn-sm" id="fx-foot-enr">Abrir matrícula</button>' : ""}
    ${digits ? `<a class="btn btn-ghost btn-sm" href="${buildWhatsAppLink(digits)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}`;
  $fx("fx-edit").addEventListener("click", () => { closeFicha(); openLeadModal(d.lead.id); });
  const fe = $fx("fx-foot-enr"); if (fe) fe.addEventListener("click", () => { closeFicha(); openEnrollmentModal(d.enrollment.id); });
}

/* ---------------- ações estáticas (formulário de follow-up e anotações) ---------------- */
$fx("ficha-btn-schedule").addEventListener("click", () => {
  const f = $fx("ficha-fu-form");
  f.style.display = f.style.display === "block" ? "none" : "block";
  if (!$fx("ficha-fu-date").value) $fx("ficha-fu-date").value = new Date().toISOString().slice(0, 10);
});
$fx("ficha-fu-cancel").addEventListener("click", () => { $fx("ficha-fu-form").style.display = "none"; });
$fx("ficha-fu-save").addEventListener("click", async () => {
  const err = $fx("ficha-fu-err"); err.textContent = "";
  const date = $fx("ficha-fu-date").value, time = $fx("ficha-fu-time").value;
  if (!date || !time) { err.textContent = "Escolha a data e a hora."; return; }
  const due = new Date(`${date}T${time}`);
  if (isNaN(due)) { err.textContent = "Data ou hora inválida."; return; }
  const lead = fichaData && fichaData.lead;
  const { error } = await supabase.from("lead_followups").insert({
    lead_id: fichaLeadId, kind: $fx("ficha-fu-kind").value, note: $fx("ficha-fu-note").value.trim(),
    due_at: due.toISOString(), remind_minutes: +$fx("ficha-fu-remind").value || 0,
    consultor_id: (lead && lead.consultor_id) || session.id,
  });
  if (error) { console.error(error); err.textContent = "Não foi possível salvar o agendamento."; return; }
  $fx("ficha-fu-note").value = ""; $fx("ficha-fu-form").style.display = "none";
  fichaJson = ""; fichaLoad(); fxCheckAlerts();
});
$fx("ficha-note-save").addEventListener("click", async () => {
  const ta = $fx("ficha-note-text"), body = ta.value.trim();
  if (!body) return;
  const btn = $fx("ficha-note-save"); btn.disabled = true;
  const { error } = await supabase.from("lead_notes").insert({ lead_id: fichaLeadId, author_name: session.name || "", body });
  btn.disabled = false;
  if (error) { console.error(error); alert("Não foi possível salvar a anotação."); return; }
  ta.value = ""; fichaJson = ""; fichaLoad();
});
$fx("ficha-backdrop").addEventListener("click", e => { if (e.target === $fx("ficha-backdrop")) closeFicha(); });

/* qualquer nome de lead marcado com .lead-link abre a ficha, em qualquer tela
   (fase de captura: vale mesmo dentro de linhas que têm clique próprio) */
document.addEventListener("click", e => {
  const el = e.target.closest(".lead-link[data-lead-id]");
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  openFicha(el.dataset.leadId);
}, true);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $fx("ficha-backdrop").classList.contains("open") && !document.querySelector(".modal-backdrop.open:not(#ficha-backdrop)")) closeFicha();
});

/* ============================================================
   AVISOS POR POPUP (checados a cada 30 s com o sistema aberto)
   ============================================================ */
let fxPopupOpen = false;
const fxShownKeys = new Set();
let fxAlertTimer = null;

function fxPopupEl() {
  let bd = document.getElementById("fx-popup-backdrop");
  if (!bd) {
    bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.id = "fx-popup-backdrop";
    bd.style.zIndex = "60";
    bd.innerHTML = '<div class="modal" style="max-width:460px;padding:22px"></div>';
    document.body.appendChild(bd);
  }
  return bd;
}
function fxShowPopup(html, wire) {
  const bd = fxPopupEl();
  bd.querySelector(".modal").innerHTML = html;
  bd.classList.add("open");
  fxPopupOpen = true;
  const close = () => { bd.classList.remove("open"); fxPopupOpen = false; setTimeout(fxCheckAlerts, 400); };
  wire(close);
}

async function fxCheckAlerts() {
  if (fxPopupOpen || !session || typeof leads === "undefined" || !Array.isArray(leads) || !leads.length) return;
  try {
    if (await fxCheckFollowups()) return;
    await fxCheckDeparture();
  } catch (e) { console.error("Erro ao verificar avisos:", e); }
}

async function fxCheckFollowups() {
  const { data, error } = await supabase.from("lead_followups").select("*").eq("done", false)
    .lte("due_at", new Date(Date.now() + 26 * 3600 * 1000).toISOString()).order("due_at");
  if (error || !data) return false;
  const now = Date.now();
  const mine = data.filter(f => f.consultor_id === session.id || f.created_by === session.id);
  const due = mine.find(f => {
    const trigger = new Date(f.due_at).getTime() - (f.remind_minutes || 0) * 60000;
    const snooze = f.snoozed_until ? new Date(f.snoozed_until).getTime() : 0;
    const key = `fu:${f.id}:${f.snoozed_until || ""}`;
    return trigger <= now && snooze <= now && !fxShownKeys.has(key);
  });
  if (!due) return false;
  const lead = leads.find(l => l.id === due.lead_id);
  fxShownKeys.add(`fu:${due.id}:${due.snoozed_until || ""}`);
  const { data: note } = await supabase.from("lead_notes").select("body").eq("lead_id", due.lead_id).order("created_at", { ascending: false }).limit(1);
  const late = new Date(due.due_at).getTime() < now - 60000;
  fxShowPopup(`
    <div class="fx-pop-top"><div class="fx-pop-ic" style="background:var(--warn-bg);color:#c97a0a">🔔</div>
      <div><div style="font-weight:800;font-size:16px">${late ? "Follow-up atrasado" : "Follow-up agora"} · ${new Date(due.due_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
      <div class="fx-mu" style="font-size:12.5px">${fxEsc(due.kind)} · ${fxEsc(lead ? lead.name : "lead")}</div></div></div>
    <p style="margin:0 0 10px;font-size:13.5px;font-weight:700">${fxEsc(due.note || "Sem detalhes")}</p>
    ${note && note[0] ? `<div style="background:var(--content-bg);border-radius:12px;padding:10px 12px;font-size:12.5px;color:var(--text-muted)"><b style="color:var(--text)">Última anotação:</b> ${fxEsc(note[0].body.slice(0, 220))}</div>` : ""}
    <div class="fx-pop-actions"><button type="button" class="btn btn-ghost btn-sm" id="fxp-1h">Adiar 1 hora</button><button type="button" class="btn btn-ghost btn-sm" id="fxp-tm">Adiar para amanhã</button><button type="button" class="btn btn-ghost btn-sm" id="fxp-open">Abrir ficha</button><button type="button" class="btn btn-primary btn-sm" id="fxp-done">Concluir</button></div>`,
  close => {
    const snooze = async ms => { await supabase.from("lead_followups").update({ snoozed_until: new Date(Date.now() + ms).toISOString() }).eq("id", due.id); close(); };
    document.getElementById("fxp-1h").onclick = () => snooze(3600000);
    document.getElementById("fxp-tm").onclick = () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); snooze(t - Date.now()); };
    document.getElementById("fxp-done").onclick = async () => { await supabase.from("lead_followups").update({ done: true, done_at: new Date().toISOString() }).eq("id", due.id); close(); if (fichaLeadId) { fichaJson = ""; fichaLoad(); } };
    document.getElementById("fxp-open").onclick = () => { close(); openFicha(due.lead_id); };
  });
  return true;
}

async function fxCheckDeparture() {
  const alertDays = 40, meetDays = 15;
  const cands = enrollments.filter(e => e.arrivalDate && e.leadId).map(e => ({ e, days: fxDaysUntil(e.arrivalDate) }))
    .filter(x => x.days >= 0 && x.days <= alertDays);
  if (!cands.length) return;
  const ids = cands.map(x => x.e.id);
  const { data: states } = await supabase.from("departure_alerts").select("*").in("enrollment_id", ids);
  const st = {}; (states || []).forEach(s => { st[`${s.enrollment_id}:${s.kind}`] = s; });
  const now = Date.now();
  const responsible = lead => !!lead && (lead.consultorId === session.id || session.role === "ADM" || session.role === "Gerente");
  for (const { e, days } of cands) {
    const lead = leads.find(l => l.id === e.leadId);
    if (!responsible(lead)) continue;
    const kinds = [];
    if (days <= meetDays && !e.preEmbarkAt) kinds.push("15d");
    kinds.push("40d");
    for (const kind of kinds) {
      const s = st[`${e.id}:${kind}`];
      if (s && s.acked_at) continue;
      if (s && s.snoozed_until && new Date(s.snoozed_until).getTime() > now) continue;
      const key = `dep:${e.id}:${kind}`;
      if (fxShownKeys.has(key)) continue;
      fxShownKeys.add(key);
      await fxDeparturePopup(e, lead, days, kind);
      return;
    }
  }
}

async function fxDeparturePopup(e, lead, days, kind) {
  const { data: f } = await supabase.rpc("lead_ficha", { p_lead: e.leadId });
  if (!f) return;
  const docs = fxDocState(f);
  const recs = f.receivables || [];
  const open = recs.filter(r => !r.pago).reduce((s, r) => s + Number(r.valor || 0), 0);
  const payOk = recs.length > 0 && open === 0;
  const li = (icon, label, ok, text) => `<li>${icon} ${fxEsc(label)}<span class="s ${ok ? "fx-ok" : "fx-wr"}">${fxEsc(text)}</span></li>`;
  const is15 = kind === "15d";
  const body = is15
    ? `<p style="margin:0;font-size:13px">Faltam ${days} dias. Hora de marcar a reunião de pré-embarque com ${fxEsc(lead.name)}.</p>`
    : `<p style="margin:0;font-size:13px">Confira antes de seguir:</p><ul class="fx-chk">
        ${li("💶", "Pagamentos", payOk, payOk ? "tudo pago" : (recs.length ? `${currency(open)} pendentes` : "sem parcelas lançadas"))}
        ${docs.map(x => li({ passaporte: "🛂", passagens: "✈", comprovante_financeiro: "💼", matricula_seguros: "🛡" }[x.kind], x.label, x.received && x.passportValid !== false, x.received ? (x.passportValid === false ? "validade curta" : "em mãos") : "pendente")).join("")}</ul>`;
  fxShowPopup(`
    <div class="fx-pop-top"><div class="fx-pop-ic" style="background:${is15 ? "var(--warn-bg)" : "var(--danger-bg)"};color:${is15 ? "#c97a0a" : "var(--danger)"}">🔔</div>
      <div><div style="font-weight:800;font-size:16px">${is15 ? "Reunião de pré-embarque" : `Embarque em ${days} dias`}</div>
      <div class="fx-mu" style="font-size:12.5px">${fxEsc(lead.name)} · ${fxEsc(e.school || "")}</div></div></div>
    ${body}
    <div class="fx-pop-actions"><button type="button" class="btn btn-ghost btn-sm" id="fxp-later">Lembrar amanhã</button><button type="button" class="btn btn-ghost btn-sm" id="fxp-open">Abrir ficha</button><button type="button" class="btn btn-primary btn-sm" id="fxp-ok">${is15 ? "Já agendei" : "Está tudo certo"}</button></div>`,
  close => {
    const upsert = patch => supabase.from("departure_alerts").upsert({ enrollment_id: e.id, kind, ...patch });
    document.getElementById("fxp-later").onclick = async () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); await upsert({ snoozed_until: t.toISOString() }); close(); };
    document.getElementById("fxp-ok").onclick = async () => { await upsert({ acked_at: new Date().toISOString(), acked_by: session.id }); close(); };
    document.getElementById("fxp-open").onclick = () => { close(); openFicha(e.leadId); };
  });
}

function fxStartAlerts() {
  if (fxAlertTimer) return;
  setTimeout(fxCheckAlerts, 6000);
  fxAlertTimer = setInterval(fxCheckAlerts, 30000);
}
fxStartAlerts();
