/* ============================================================
   HORÁRIO EM 24 HORAS — troca todo <input type="time"> do CRM por dois seletores (hora 00–23 e minuto 00–59).
   O campo de horário do navegador segue o computador de quem usa e mostra AM/PM em muitos Macs; este módulo garante 24 h
   (09:00, 14:30, 18:00) em qualquer máquina. O <input> original continua no lugar (oculto) e mantém o mesmo valor "HH:MM",
   então o resto do código (ler/gravar .value, ouvir "input"/"change", desabilitar) segue funcionando sem mudança.
   Valem também os campos criados depois (linhas de disponibilidade, modais). Sem dependências.
   ============================================================ */
(function () {
  const pad = n => String(n).padStart(2, "0");
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const opts = (n, blank) => `<option value="">${blank}</option>` + Array.from({ length: n }, (_, i) => `<option value="${pad(i)}">${pad(i)}</option>`).join("");

  function upgrade(inp) {
    if (!inp || inp.dataset.t24) return;
    inp.dataset.t24 = "1";
    const m = /^(\d{1,2}):(\d{2})/.exec(inp.value || inp.getAttribute("value") || "");
    const hh = document.createElement("select"), mm = document.createElement("select");
    hh.innerHTML = opts(24, "--"); mm.innerHTML = opts(60, "--");
    hh.className = "t24-h"; mm.className = "t24-m";
    hh.setAttribute("aria-label", "Hora"); mm.setAttribute("aria-label", "Minuto");
    const wrap = document.createElement("span");
    wrap.className = "t24";
    wrap.append(hh, document.createTextNode(":"), mm);

    const read = () => (hh.value ? `${hh.value}:${mm.value || "00"}` : "");
    const write = v => {
      const x = /^(\d{1,2}):(\d{2})/.exec(String(v == null ? "" : v));
      if (x && +x[1] < 24 && +x[2] < 60) { hh.value = pad(+x[1]); mm.value = x[2]; } else { hh.value = ""; mm.value = ""; }
      nativeValue.set.call(inp, read());
    };
    inp.type = "hidden";
    Object.defineProperty(inp, "value", { configurable: true, get: read, set: write });
    write(m ? `${m[1]}:${m[2]}` : "");

    const changed = () => {
      if (hh.value && !mm.value) mm.value = "00";
      nativeValue.set.call(inp, read());
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    };
    hh.addEventListener("change", changed); mm.addEventListener("change", changed);

    const sync = () => { hh.disabled = mm.disabled = inp.disabled; };
    new MutationObserver(sync).observe(inp, { attributes: true, attributeFilter: ["disabled"] });
    sync();
    inp.insertAdjacentElement("afterend", wrap);
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('input[type="time"]')) upgrade(root);
    root.querySelectorAll && root.querySelectorAll('input[type="time"]').forEach(upgrade);
  }
  function start() {
    scan(document.body);
    new MutationObserver(list => list.forEach(r => r.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
