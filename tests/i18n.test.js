// Every string key used in markup (data-i18n*) and code (T("…")) exists in all
// nine locales with the same {placeholders} as US English, every locale has
// exactly the US English keys, and every content name (themes, challenges,
// tutorial lessons, achievements) is translated.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const STRINGS = require("../strings.js");
const C = require("../content.js");
const LOCALES = ["en-US", "en-GB", "es-419", "es-ES", "de-DE", "fr-FR", "fr-CA", "pt-BR", "it-IT"];
const en = STRINGS["en-US"];
const code = ["app.js", "i18n.js"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const used = new Set();
for (const m of code.matchAll(/\bT\("([A-Za-z0-9_]+)"(?!\s*\+)/g)) used.add(m[1]);
for (const m of code.matchAll(/(?<![.\w])t\("([A-Za-z0-9_]+)"(?!\s*\+)/g)) used.add(m[1]);
for (const m of code.matchAll(/hostedError\("([A-Za-z0-9_]+)"/g)) used.add(m[1]);
for (const m of html.matchAll(/data-i18n(?:-aria|-title)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
for (const m of code.matchAll(/"(err_\w+|stage_\w+|away[A-Z]\w*)"/g)) used.add(m[1]);
for (const s of ["hearts", "diamonds", "clubs", "spades"]) used.add("suit_" + s);
for (const k of ["rank", "score", "wins", "losses", "gamesPlayed", "bestScore"]) used.add("stat_" + k);
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("ships the nine locales", () => assert.deepEqual(Object.keys(STRINGS).sort(), [...LOCALES].sort()));
test("every locale has exactly the US English keys", () => {
  for (const loc of LOCALES) assert.deepEqual(Object.keys(STRINGS[loc]).sort(), Object.keys(en).sort(), loc);
});
test("found the keys in markup and code", () => assert.ok(used.size > 180, String(used.size)));
for (const loc of LOCALES) {
  test(`${loc}: every used key, matching placeholders`, () => {
    const L = STRINGS[loc];
    assert.deepEqual([...used].filter((k) => typeof L[k] !== "string"), []);
    for (const k of Object.keys(en)) if (typeof en[k] === "string") assert.equal(vars(L[k]), vars(en[k]), `${loc}.${k}`);
  });
  test(`${loc}: every content name`, () => {
    const L = STRINGS[loc];
    for (const t of C.THEMES) assert.ok(L.themes[t.id], `theme ${t.id}`);
    for (const c of C.CHALLENGES) assert.equal(L.challenges[c.id]?.length, 2, `challenge ${c.id}`);
    for (const t of C.TUTORIAL) assert.equal(L.tutorial[t.id]?.length, 2, `lesson ${t.id}`);
    for (const a of C.ACHIEVEMENTS) assert.equal(L.achievements[a.id]?.length, 2, `achievement ${a.id}`);
  });
}
test("English content strings match the authored data", () => {
  for (const t of C.THEMES) assert.equal(en.themes[t.id], t.name);
  for (const c of C.CHALLENGES) assert.deepEqual(en.challenges[c.id], [c.name, c.desc]);
  for (const t of C.TUTORIAL) assert.deepEqual(en.tutorial[t.id], [t.title, t.body]);
  for (const a of C.ACHIEVEMENTS) assert.deepEqual(en.achievements[a.id], [a.name, a.desc]);
  const I = require("../i18n.js");
  for (const s of C.JOURNEY) assert.equal(I.stageName(s), s.name, s.id);
});
test("non-English locales are translated", () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith("en"))) {
    const same = [...used].filter((k) => STRINGS[loc][k] === en[k]);
    assert.ok(same.length < 15, `${loc}: ${same.join(", ")}`);
  }
});
