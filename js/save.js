// Wild Eights — the progress document and the game's own options, pure (no
// engine, no DOM) so the node tests run the shipped code. The document is the
// browser build's save (app.js loadSave / mergeSaves) without the settings the
// runtime's Options now own (volumes, mute, graphics, reduced motion, high
// contrast, larger text): journey wins with the fewest moves, achievements,
// the win streak and best streak, the Daily days, the records and whether the
// tutorial was finished. The browser build's cloud slot (the same JSON with
// its settings block) migrates through readDoc. Classic UMD script.
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WESave = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function fresh() {
    return {
      version: 2,
      journey: {},          // stageId -> { won, bestMoves }
      achievements: {},     // id -> true
      streak: 0,
      bestStreak: 0,
      dailyDays: [],        // ["2026-08-29"]
      records: { bestScore: 0, roundsPlayed: 0, roundsWon: 0 },
      tutorialDone: false
    };
  }
  var num = function (v) { return typeof v === "number" && isFinite(v) && v >= 0 ? Math.floor(v) : 0; };

  /** Any stored document (this game's, or the browser build's save) → a clean progress document. */
  function readDoc(raw) {
    var out = fresh();
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    if (!raw || typeof raw !== "object") return out;
    var j = raw.journey && typeof raw.journey === "object" ? raw.journey : {};
    Object.keys(j).forEach(function (id) {
      if (!/^j\d+$/.test(id) || !j[id] || typeof j[id] !== "object") return;
      out.journey[id] = { won: !!j[id].won, bestMoves: num(j[id].bestMoves) || null };
    });
    var a = raw.achievements && typeof raw.achievements === "object" ? raw.achievements : {};
    Object.keys(a).forEach(function (k) { if (a[k]) out.achievements[k] = true; });
    out.streak = num(raw.streak);
    out.bestStreak = Math.max(num(raw.bestStreak), out.streak);
    out.dailyDays = Array.isArray(raw.dailyDays) ? raw.dailyDays.filter(function (d) { return typeof d === "string" && /^\d{4}-\d\d-\d\d$/.test(d); }) : [];
    out.dailyDays = out.dailyDays.filter(function (d, i) { return out.dailyDays.indexOf(d) === i; }).sort();
    var r = raw.records || {};
    out.records = { bestScore: num(r.bestScore), roundsPlayed: num(r.roundsPlayed), roundsWon: num(r.roundsWon) };
    out.tutorialDone = !!(raw.tutorialDone || (raw.settings && raw.settings.tutorialDone));
    return out;
  }

  /** Both devices' progress (app.js mergeSaves): journey wins (fewest moves), unions, the larger records; `local`'s streak. */
  function merge(local, remote) {
    var a = readDoc(local), b = readDoc(remote), out = readDoc(local);
    Object.keys(b.journey).forEach(function (id) {
      var x = b.journey[id], y = a.journey[id] || { won: false, bestMoves: null };
      var moves = [x.bestMoves, y.bestMoves].filter(function (m) { return typeof m === "number" && m > 0; });
      out.journey[id] = { won: !!(x.won || y.won), bestMoves: moves.length ? Math.min.apply(null, moves) : null };
    });
    Object.keys(b.achievements).forEach(function (k) { out.achievements[k] = true; });
    b.dailyDays.forEach(function (d) { if (out.dailyDays.indexOf(d) < 0) out.dailyDays.push(d); });
    out.dailyDays.sort();
    ["bestScore", "roundsPlayed", "roundsWon"].forEach(function (k) { out.records[k] = Math.max(a.records[k], b.records[k]); });
    out.bestStreak = Math.max(a.bestStreak, b.bestStreak);
    out.tutorialDone = a.tutorialDone || b.tutorialDone;
    return out;
  }

  function canonical(v) {
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canonical(v[k]); }).join(",") + "}";
    return JSON.stringify(v);
  }
  function same(a, b) { return canonical(readDoc(a)) === canonical(readDoc(b)); }

  // --- the game's options (engine settings) ------------------------------------
  var THEME_IDS = ["compartment", "morning", "emerald", "crimson", "porcelain"];
  var DEFAULT_OPTIONS = { theme: "compartment", cvdPalette: false, leftHanded: false };
  /** The valid options among raw values (the browser build's settings KV used the same names). */
  function pickOptions(raw) {
    var out = {};
    if (!raw || typeof raw !== "object") return out;
    if (THEME_IDS.indexOf(raw.theme) >= 0) out.theme = raw.theme;
    if (typeof raw.cvdPalette === "boolean") out.cvdPalette = raw.cvdPalette;
    if (typeof raw.leftHanded === "boolean") out.leftHanded = raw.leftHanded;
    return out;
  }
  /** The browser build's settings KV keys (app.js SYNCED_SETTINGS): all removed after the import. */
  var BROWSER_KEYS = ["volMusic", "volEffects", "volAmbience", "muted", "gfx", "theme", "reducedMotion", "highContrast", "cvdPalette", "bigText", "leftHanded"];

  /** Records a finished solo round (app.js finishRound / checkAchievements); the newly unlocked achievement ids. */
  function recordRound(doc, r) {
    // r: { mode, stageId, won, score, moves, eightsPlayed, invalid, hints, day, journeyTotal }
    var unlocked = [];
    var unlock = function (id) { if (!doc.achievements[id]) { doc.achievements[id] = true; unlocked.push(id); } };
    doc.records.roundsPlayed++;
    if (r.won) {
      doc.records.roundsWon++;
      doc.streak++;
      doc.bestStreak = Math.max(doc.bestStreak, doc.streak);
      doc.records.bestScore = Math.max(doc.records.bestScore, r.score || 0);
    } else doc.streak = 0;
    if (r.mode === "journey" && r.stageId && r.won) {
      var j = doc.journey[r.stageId] || { won: false, bestMoves: null };
      j.won = true;
      j.bestMoves = j.bestMoves ? Math.min(j.bestMoves, r.moves) : r.moves;
      doc.journey[r.stageId] = j;
    }
    if (r.mode === "daily" && r.day && doc.dailyDays.indexOf(r.day) < 0) { doc.dailyDays.push(r.day); doc.dailyDays.sort(); }
    if (r.won) unlock("first_win");
    if (r.won && r.eightsPlayed >= 3) unlock("eight_master");
    if (doc.streak >= 3) unlock("streak_3");
    var wins = Object.keys(doc.journey).filter(function (k) { return doc.journey[k].won; }).length;
    if (wins >= 20) unlock("journey_20");
    if (wins >= (r.journeyTotal || 40)) unlock("journey_all");
    if (doc.dailyDays.length >= 7) unlock("daily_7");
    if (r.won && r.invalid === 0 && r.hints === 0) unlock("pacifist");
    return unlocked;
  }

  return {
    fresh: fresh, readDoc: readDoc, merge: merge, same: same, canonical: canonical, recordRound: recordRound,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS, THEME_IDS: THEME_IDS, pickOptions: pickOptions, BROWSER_KEYS: BROWSER_KEYS
  };
});
