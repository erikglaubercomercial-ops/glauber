/* Lê um calendário iCal (o "endereço secreto" do Google Agenda) e devolve SÓ os intervalos ocupados — sem título,
   descrição nem convidados. Regras:
     • eventos "livres" (TRANSP:TRANSPARENT) e cancelados não bloqueiam
     • eventos recorrentes são expandidos dentro da janela, respeitando as exceções (remarcados/cancelados)
     • eventos de dia inteiro só bloqueiam se estiverem marcados como "ocupado"; valem o dia todo no fuso `tz` do consultor */
import ICAL from "ical.js";

const MAX_OCCURRENCES_PER_EVENT = 800;
const MAX_INTERVALS = 3000;

function tzOffsetMs(ms, tz) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
  const g = k => Number(p.find(x => x.type === k).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
}
/* meia-noite local (no fuso tz) de um dia, em ms UTC */
export function localMidnightMs(y, m, d, tz) {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

const isFree = comp => String(comp.getFirstPropertyValue("transp") || "").toUpperCase() === "TRANSPARENT";
const isCancelled = comp => String(comp.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED";

function span(ev, startT, endT, tz) {
  if (startT.isDate) {
    const s = localMidnightMs(startT.year, startT.month, startT.day, tz);
    const e = endT && endT.isDate ? localMidnightMs(endT.year, endT.month, endT.day, tz) : s + 86400000;
    return [s, e > s ? e : s + 86400000];
  }
  const s = startT.toJSDate().getTime();
  const e = endT ? endT.toJSDate().getTime() : s + 3600000;
  return [s, e > s ? e : s + 1800000];
}

/* devolve [{ start: ISO, end: ISO }] entre `from` e `to` (Date) */
export function busyFromIcs(text, from, to, tz = "America/Sao_Paulo") {
  const root = new ICAL.Component(ICAL.parse(text));
  root.getAllSubcomponents("vtimezone").forEach(z => { try { ICAL.TimezoneService.register(z.getFirstPropertyValue("tzid"), new ICAL.Timezone(z)); } catch (e) { /* fuso repetido: ignora */ } });

  const masters = new Map(), exceptions = [], singles = [];
  root.getAllSubcomponents("vevent").forEach(ve => {
    const ev = new ICAL.Event(ve);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else if (ve.hasProperty("rrule") || ve.hasProperty("rdate")) masters.set(ev.uid, ev);
    else singles.push(ev);
  });
  exceptions.forEach(ex => { const m = masters.get(ex.uid); if (m) m.relateException(ex); else singles.push(ex); });

  const out = [];
  const push = (s, e) => { if (e > from.getTime() && s < to.getTime()) out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }); };

  singles.forEach(ev => {
    if (isFree(ev.component) || isCancelled(ev.component)) return;
    const [s, e] = span(ev, ev.startDate, ev.endDate, tz);
    push(s, e);
  });

  masters.forEach(ev => {
    if (isFree(ev.component) || isCancelled(ev.component)) return;
    const it = ev.iterator();
    let next, n = 0;
    while ((next = it.next()) && n++ < MAX_OCCURRENCES_PER_EVENT) {
      const approxStart = next.isDate ? localMidnightMs(next.year, next.month, next.day, tz) : next.toJSDate().getTime();
      if (approxStart > to.getTime()) break;
      const det = ev.getOccurrenceDetails(next);
      const comp = det.item.component;
      if (isFree(comp) || isCancelled(comp)) continue;
      const [s, e] = span(det.item, det.startDate, det.endDate, tz);
      push(s, e);
    }
  });

  /* junta intervalos repetidos e limita o total */
  const seen = new Set();
  return out.filter(x => { const k = x.start + x.end; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_INTERVALS);
}
