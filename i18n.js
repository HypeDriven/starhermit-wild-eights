// Wild Eights — localization runtime (window.WEI18N). Classic script loaded
// after sh-language.js and strings.js, before every other game script.
//
// The language comes from sh-language.js: explicit game choice (ui.language)
// → StarHermit account preferredLanguage → navigator.languages → en-US.
// ?lang= forces a locale for the page load (QA links) and hides the shared
// selector. A change re-applies static markup (data-i18n, data-i18n-aria,
// data-i18n-title) and notifies onLanguage listeners so dynamic text
// re-renders without restarting the round or touching a table socket.
(function (root) {
  "use strict";
  var STRINGS = root.WE_STRINGS || (typeof require === "function" ? require("./strings.js") : {});
  var SUPPORTED = Object.keys(STRINGS);
  var EN = STRINGS["en-US"];
  var lang = "en-US", dict = EN;
  var listeners = [];

  function fill(s, vars) {
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; });
  }
  function t(key, vars) {
    var s = dict && dict[key] != null ? dict[key] : (EN[key] != null ? EN[key] : key);
    return fill(s, vars);
  }
  function tn(group, id, fallback) {
    var own = dict && dict[group] && dict[group][id];
    if (own != null) return own;
    var en = EN[group] && EN[group][id];
    return en != null ? en : fallback;
  }
  function applyDom(doc) {
    doc = doc || root.document;
    if (!doc || !doc.querySelectorAll) return;
    Array.prototype.forEach.call(doc.querySelectorAll("[data-i18n]"), function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-i18n-aria]"), function (el) { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-i18n-title]"), function (el) { el.title = t(el.getAttribute("data-i18n-title")); });
    if (doc.documentElement) doc.documentElement.lang = lang;
  }
  function setLocale(next) {
    lang = STRINGS[next] ? next : "en-US";
    dict = STRINGS[lang];
    var doc = root.document;
    if (doc && doc.readyState !== "loading") applyDom(doc);
    else if (doc && doc.documentElement) doc.documentElement.lang = lang;
    listeners.slice().forEach(function (fn) { try { fn(lang); } catch (e) { if (root.console) root.console.error(e); } });
  }

  // --- content display helpers ------------------------------------------------
  function suitName(suit) { return t("suit_" + suit); }
  /** "Q of hearts" in the current locale (rank symbols match the card faces). */
  function cardName(card, rankName) { return t("cardOf", { rank: rankName(card.rank), suit: suitName(card.suit) }); }
  function stageName(stage) {
    var n = stage.index;
    if (n <= 8) return t("stage_local", { n: n });
    if (n <= 16) return t("stage_regional", { n: n });
    if (n <= 28) return t("stage_intercity", { n: n });
    if (n <= 36) return t("stage_express", { n: n });
    return t("stage_mastery", { n: n - 36 });
  }

  var api = {
    SUPPORTED: SUPPORTED, STRINGS: STRINGS,
    t: t, tn: tn, applyDom: applyDom,
    locale: function () { return lang; },
    onLanguage: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    suitName: suitName, cardName: cardName, stageName: stageName,
    language: null
  };

  var SL = root.StarHermitLanguage;
  var forced = null;
  try {
    var q = root.location && new URLSearchParams(root.location.search || "").get("lang");
    forced = q && SL ? SL.match(q, SUPPORTED) : null;
  } catch (e) { /* opaque origin */ }
  if (SL && root.document) {
    api.language = SL.create({
      game: "wild-eights", supported: SUPPORTED, panel: !forced,
      apply: function (l) { setLocale(forced || l); }
    });
  } else {
    setLocale("en-US");
  }
  if (root.document && root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", function () { applyDom(root.document); });
  }

  root.WEI18N = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
