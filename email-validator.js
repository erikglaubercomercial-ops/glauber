/* Validador de e-mail compartilhado — vale para todo campo de e-mail do CRM e das páginas públicas.
   - Campos alvo: input[type=email] e qualquer input de texto cujo id/name contenha "email" (exceto readonly/disabled).
   - Ao sair do campo: tira espaços, confere o formato e mostra o aviso embaixo (com sugestão para erros comuns,
     como "gmial.com" → "gmail.com").
   - Enquanto o e-mail for inválido, o formulário não é enviado (validade nativa + trava no envio).
   - Para código que valida sem formulário: window.emailValido(v) e window.emailValidoOuVazio(v).
   Sem dependências. Não altera o que é salvo, só impede salvar e-mail malformado. */
(function () {
  "use strict";

  var LOCAL = /^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+)*$/;
  var LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

  function motivo(v) {
    v = String(v == null ? "" : v).trim();
    if (!v) return "vazio";
    if (/\s/.test(v)) return "espaco";
    var at = v.indexOf("@");
    if (at < 1 || at !== v.lastIndexOf("@")) return "arroba";
    var local = v.slice(0, at), dom = v.slice(at + 1).toLowerCase();
    if (v.length > 254 || local.length > 64 || !LOCAL.test(local)) return "formato";
    var partes = dom.split(".");
    if (partes.length < 2) return "dominio";
    for (var i = 0; i < partes.length; i++) if (!LABEL.test(partes[i])) return "dominio";
    var tld = partes[partes.length - 1];
    if (!/^[a-z]{2,24}$/.test(tld)) return "dominio";
    return "";
  }

  function emailValido(v) { return motivo(v) === ""; }
  function emailValidoOuVazio(v) { var m = motivo(v); return m === "" || m === "vazio"; }

  /* ---------- sugestão de correção (erros de digitação comuns) ---------- */
  var DOMINIOS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.br", "icloud.com", "uol.com.br",
    "bol.com.br", "live.com", "terra.com.br", "hotmail.com.br", "outlook.com.br", "msn.com", "me.com", "protonmail.com",
    "proton.me", "peregrinosintercambio.com"];
  var TLD_ERRADO = { con: "com", cm: "com", comm: "com", coom: "com", ocm: "com", vom: "com", xom: "com", "com.b": "com.br", "com.rb": "com.br", "com.bt": "com.br", "co.br": "com.br" };

  function dist(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }

  function sugestao(v) {
    v = String(v || "").trim();
    var at = v.indexOf("@");
    if (at < 1) return "";
    var local = v.slice(0, at), dom = v.slice(at + 1).toLowerCase();
    if (!dom || DOMINIOS.indexOf(dom) >= 0) return "";
    var p = dom.split(".");
    // ".con", ".cm", ".com.b" … no fim do domínio
    for (var k = 1; k <= 2 && k < p.length; k++) {
      var fim = p.slice(p.length - k).join(".");
      if (TLD_ERRADO[fim]) { var novo = p.slice(0, p.length - k).concat(TLD_ERRADO[fim]).join("."); if (emailValido(local + "@" + novo)) return local + "@" + novo; }
    }
    var melhor = "", menor = 3;
    DOMINIOS.forEach(function (c) {
      var d = dist(dom, c);
      if (d > 0 && d < menor && d <= (c.length > 9 ? 2 : 1)) { menor = d; melhor = c; }
    });
    return melhor ? local + "@" + melhor : "";
  }

  /* ---------- textos (pt/en, na mesma chave de idioma do app) ---------- */
  function lang() { try { return localStorage.getItem("crm-vendas-lang") || "pt"; } catch (e) { return "pt"; } }
  var TXT = {
    pt: { espaco: "O e-mail não pode ter espaços.", arroba: "Falta o @ ou há mais de um. Exemplo: nome@email.com", formato: "Há caracteres não permitidos antes do @.",
      dominio: "O endereço depois do @ está incompleto. Exemplo: nome@email.com", quis: "Você quis dizer", usar: "Usar" },
    en: { espaco: "The email cannot contain spaces.", arroba: "Missing @ or more than one. Example: name@email.com", formato: "There are characters that aren't allowed before the @.",
      dominio: "The address after the @ is incomplete. Example: name@email.com", quis: "Did you mean", usar: "Use" }
  };
  function tx() { return lang() === "en" ? TXT.en : TXT.pt; }

  /* ---------- campos alvo ---------- */
  function ehCampoEmail(el) {
    if (!el || el.tagName !== "INPUT" || el.readOnly || el.disabled) return false;
    var tipo = (el.type || "").toLowerCase();
    if (tipo === "email") return true;
    if (tipo !== "text" && tipo !== "") return false;
    return /e-?mail/i.test((el.id || "") + " " + (el.name || ""));
  }

  function dica(el) {
    var d = el.nextElementSibling;
    if (d && d.classList && d.classList.contains("email-hint")) return d;
    d = document.createElement("div");
    d.className = "email-hint";
    d.setAttribute("role", "alert");
    d.hidden = true;
    el.parentNode.insertBefore(d, el.nextSibling);
    return d;
  }

  function mostra(el, msg, sug) {
    var d = dica(el);
    d.textContent = "";
    if (!msg && !sug) { d.hidden = true; el.classList.remove("email-err"); return; }
    if (msg) d.appendChild(document.createTextNode(msg));
    if (sug) {
      if (msg) d.appendChild(document.createTextNode(" "));
      d.appendChild(document.createTextNode(tx().quis + " "));
      var b = document.createElement("button");
      b.type = "button"; b.className = "email-hint-use"; b.textContent = sug;
      b.addEventListener("mousedown", function (ev) { ev.preventDefault(); }); // não perde o foco antes do clique
      b.addEventListener("click", function () {
        el.value = sug;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        valida(el, true);
      });
      d.appendChild(b);
      d.appendChild(document.createTextNode("?"));
    }
    d.hidden = false;
    el.classList.toggle("email-err", !!msg);
  }

  /* confere o campo; "aviso" = mostrar a mensagem na tela agora */
  function valida(el, aviso) {
    var v = el.value.trim();
    var m = motivo(v);
    var invalido = m !== "" && m !== "vazio";
    var msg = invalido ? tx()[m] : "";
    try { el.setCustomValidity(msg); } catch (e) {}
    if (aviso) mostra(el, msg, invalido || v ? sugestao(v) : "");
    return !invalido;
  }

  document.addEventListener("focusout", function (ev) {
    var el = ev.target;
    if (!ehCampoEmail(el)) return;
    var cortado = el.value.trim();
    if (cortado !== el.value) el.value = cortado;
    valida(el, true);
  });

  document.addEventListener("input", function (ev) {
    var el = ev.target;
    if (!ehCampoEmail(el)) return;
    var ok = valida(el, false);
    var d = el.nextElementSibling;
    if (ok && d && d.classList && d.classList.contains("email-hint")) mostra(el, "", "");
  });

  // trava o envio de qualquer formulário com e-mail inválido (cobre valor preenchido por script ou pelo navegador)
  document.addEventListener("submit", function (ev) {
    var form = ev.target;
    if (!form || !form.querySelectorAll) return;
    var campos = form.querySelectorAll("input");
    for (var i = 0; i < campos.length; i++) {
      var el = campos[i];
      if (!ehCampoEmail(el)) continue;
      var cortado = el.value.trim();
      if (cortado !== el.value) el.value = cortado;
      if (!valida(el, true)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        el.focus();
        if (el.reportValidity) el.reportValidity();
        return;
      }
    }
  }, true);

  /* para telas que validam sem <form>: devolve o primeiro campo de e-mail inválido dentro de um container (ou null) */
  function primeiroInvalido(raiz) {
    var campos = (raiz || document).querySelectorAll("input");
    for (var i = 0; i < campos.length; i++) {
      if (ehCampoEmail(campos[i]) && !valida(campos[i], true)) return campos[i];
    }
    return null;
  }

  var css = document.createElement("style");
  css.textContent =
    ".email-hint{margin-top:4px;font-size:12px;line-height:1.4;color:var(--danger,#c0392b)}" +
    ".email-hint[hidden]{display:none}" +
    ".email-hint-use{background:none;border:0;padding:0;font:inherit;font-weight:600;color:inherit;text-decoration:underline;cursor:pointer}" +
    "input.email-err{border-color:var(--danger,#c0392b)!important}";
  document.head.appendChild(css);

  window.emailValido = emailValido;
  window.emailValidoOuVazio = emailValidoOuVazio;
  window.emailSugestao = sugestao;
  window.emailPrimeiroInvalido = primeiroInvalido;
})();
