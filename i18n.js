/* Mema Games — language engine (English default, Arabic optional)
   The source texts in the app are Arabic. When the language is English, every text that is
   put on the page (and every alert/confirm/toast) is translated on the fly using
   en_dict.js (exact phrases + patterns). Arabic mode simply leaves everything as written. */
(function () {
  "use strict";
  var KEY = "mema_lang", lang = "en";
  try { lang = localStorage.getItem(KEY) || "en"; } catch (e) {}
  if (lang !== "ar") lang = "en";
  window.MEMA_LANG = lang;
  var root = document.documentElement;
  root.lang = lang; root.dir = lang === "ar" ? "rtl" : "ltr";

  var AR = /[؀-ۿ]/;
  var DICT = null, RULES = null;
  function load() { DICT = window.MEMA_EN || {}; RULES = window.MEMA_EN_RULES || []; }

  function tr(s) {
    if (lang === "ar" || typeof s !== "string" || !AR.test(s)) return s;
    if (!DICT) load();
    var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim().replace(/\s+/g, " ");
    var hit = DICT[core];
    if (hit !== undefined) return lead + hit + trail;
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i], m = r[0].exec(core);
      if (m) {
        var out = typeof r[1] === "function" ? r[1].apply(null, m) : core.replace(r[0], r[1]);
        return lead + tr2(out) + trail;
      }
    }
    return s;
  }
  // translate pieces of a pattern result that are still Arabic (e.g. a captured phrase)
  function tr2(s) { return AR.test(s) ? trParts(s) : s; }
  function trParts(s) {
    if (!DICT) load();
    var keys = Object.keys(DICT).filter(function (k) { return k.length > 1; }).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length && AR.test(s); i++) { if (s.indexOf(keys[i]) >= 0) s = s.split(keys[i]).join(DICT[keys[i]]); }
    return s;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1 };
  var ATTRS = ["placeholder", "title", "aria-label", "alt", "value"];
  function walk(node) {
    if (lang === "ar" || !node) return;
    if (node.nodeType === 3) {
      var v = node.nodeValue;
      if (AR.test(v)) { var t = tr(v); if (t !== v) node.nodeValue = t; }
      return;
    }
    if (node.nodeType !== 1 || SKIP[node.tagName] || (node.closest && node.closest("[data-notr]"))) return;
    ATTRS.forEach(function (a) {
      if (a === "value" && !(node.tagName === "INPUT" && /button|submit/i.test(node.type || ""))) return;
      var av = node.getAttribute && node.getAttribute(a);
      if (av && AR.test(av)) { var t2 = tr(av); if (t2 !== av) node.setAttribute(a, t2); }
    });
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
  }

  var busy = false;
  function start() {
    if (lang === "ar") return;
    load();
    document.title = tr(document.title);
    var md = document.querySelector('meta[name="description"]');
    if (md) md.content = "Mema Games: multiplayer trivia, party and card games to play with friends — online or on one device.";
    walk(document.body);
    new MutationObserver(function (muts) {
      if (busy) return; busy = true;
      try {
        muts.forEach(function (m) {
          if (m.type === "characterData") walk(m.target);
          else if (m.type === "attributes") walk(m.target);
          else m.addedNodes.forEach(walk);
        });
      } finally { busy = false; }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] });
  }

  // native dialogs
  if (lang === "en") {
    var _a = window.alert, _c = window.confirm, _p = window.prompt;
    window.alert = function (m) { return _a.call(window, tr(String(m))); };
    window.confirm = function (m) { return _c.call(window, tr(String(m))); };
    window.prompt = function (m, d) { return _p.call(window, tr(String(m)), d); };
  }

  window.MEMA_T = tr;
  window.MEMA_SETLANG = function (l) {
    try { localStorage.setItem(KEY, l === "ar" ? "ar" : "en"); } catch (e) {}
    location.reload();
  };
  // data files: English versions live next to the Arabic ones (name_en.json)
  window.MEMA_DATA_FILE = function (f) { return lang === "en" ? f.replace(/\.json$/, "_en.json") : f; };

  function addToggle() {
    if (document.getElementById("lang-toggle")) return;
    var b = document.createElement("button");
    b.id = "lang-toggle"; b.setAttribute("data-notr", "");
    b.textContent = lang === "en" ? "العربية" : "English";
    b.setAttribute("aria-label", lang === "en" ? "Switch to Arabic" : "Switch to English");
    b.style.cssText = "position:fixed;z-index:60;bottom:12px;" + (lang === "ar" ? "left" : "right") + ":12px;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(15,23,42,.9);color:#f1f5f9;font-weight:700;font-size:.85rem;cursor:pointer;font-family:inherit";
    b.onclick = function () { window.MEMA_SETLANG(lang === "en" ? "ar" : "en"); };
    document.body.appendChild(b);
  }
  function init() { addToggle(); start(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
