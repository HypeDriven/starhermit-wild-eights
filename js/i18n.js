// Wild Eights — localization (globalThis.WEI18N): the keyed tables of
// js/strings.js in the nine StarHermit locales. The engine client sets the
// locale from the runtime's interface language (native/i18n.ts); nothing here
// touches a DOM. Classic UMD script, also required by the node tests.
(function (root) {
  "use strict";
  var STRINGS = root.WE_STRINGS || (typeof require === "function" ? require("./strings.js") : {});
  var SUPPORTED = Object.keys(STRINGS);
  var EN = STRINGS["en-US"];
  var lang = "en-US", dict = EN;

  function fill(s, vars) {
    if (!vars) return String(s);
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
  /** The best supported locale for a BCP 47 tag ("de" → de-DE, "es-MX" → es-419, "fr-CA" stays). */
  function match(tag) {
    tag = String(tag || "en-US");
    if (STRINGS[tag]) return tag;
    var lower = tag.toLowerCase();
    for (var i = 0; i < SUPPORTED.length; i++) if (SUPPORTED[i].toLowerCase() === lower) return SUPPORTED[i];
    var base = lower.split("-")[0];
    if (base === "es") return /-(es)$/.test(lower) ? "es-ES" : "es-419";
    if (base === "en") return /-(gb|uk|ie|au|nz)$/.test(lower) ? "en-GB" : "en-US";
    if (base === "fr") return /-ca$/.test(lower) ? "fr-CA" : "fr-FR";
    if (base === "pt") return "pt-BR";
    for (var j = 0; j < SUPPORTED.length; j++) if (SUPPORTED[j].toLowerCase().split("-")[0] === base) return SUPPORTED[j];
    return "en-US";
  }
  function setLocale(next) {
    lang = match(next);
    dict = STRINGS[lang];
    return lang;
  }

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
    t: t, tn: tn, match: match, setLocale: setLocale,
    locale: function () { return lang; },
    suitName: suitName, cardName: cardName, stageName: stageName
  };
  root.WEI18N = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
