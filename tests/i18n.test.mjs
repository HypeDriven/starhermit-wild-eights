// Every string key the client uses (T("…") in native/*.ts) exists in all nine
// locales with the same {placeholders} as US English, every locale has exactly
// the US English keys, and every content name (themes, challenges, lessons,
// achievements, Journey stages) is translated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const STRINGS = require('../js/strings.js');
const C = require('../js/content.js');
const I = require('../js/i18n.js');
const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const en = STRINGS['en-US'];
const dir = new URL('../native/', import.meta.url);
const code = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
const used = new Set();
for (const m of code.matchAll(/\bT\("([A-Za-z0-9_]+)"/g)) used.add(m[1]);
for (const m of code.matchAll(/\bkey: "([A-Za-z0-9_]+)"/g)) used.add(m[1]);
for (const m of code.matchAll(/"(err_\w+|stage_\w+|away[A-Z]\w*)"/g)) used.add(m[1]);
for (const s of ['hearts', 'diamonds', 'clubs', 'spades']) used.add('suit_' + s);
used.add('cardOf');
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('ships the nine locales', () => assert.deepEqual(Object.keys(STRINGS).sort(), [...LOCALES].sort()));
test('every locale has exactly the US English keys', () => {
  for (const loc of LOCALES) assert.deepEqual(Object.keys(STRINGS[loc]).sort(), Object.keys(en).sort(), loc);
});
test('found the keys in the client', () => assert.ok(used.size > 150, String(used.size)));
for (const loc of LOCALES) {
  test(`${loc}: every used key, matching placeholders`, () => {
    const L = STRINGS[loc];
    assert.deepEqual([...used].filter((k) => typeof L[k] !== 'string'), []);
    for (const k of Object.keys(en)) if (typeof en[k] === 'string') assert.equal(vars(L[k]), vars(en[k]), `${loc}.${k}`);
  });
  test(`${loc}: every content name`, () => {
    const L = STRINGS[loc];
    for (const t of C.THEMES) assert.ok(L.themes[t.id], `theme ${t.id}`);
    for (const c of C.CHALLENGES) assert.equal(L.challenges[c.id]?.length, 2, `challenge ${c.id}`);
    for (const t of C.TUTORIAL) assert.equal(L.tutorial[t.id]?.length, 2, `lesson ${t.id}`);
    for (const a of C.ACHIEVEMENTS) assert.equal(L.achievements[a.id]?.length, 2, `achievement ${a.id}`);
  });
}
test('English content strings match the authored data', () => {
  for (const t of C.THEMES) assert.equal(en.themes[t.id], t.name);
  for (const c of C.CHALLENGES) assert.deepEqual(en.challenges[c.id], [c.name, c.desc]);
  for (const t of C.TUTORIAL) assert.deepEqual(en.tutorial[t.id], [t.title, t.body]);
  for (const a of C.ACHIEVEMENTS) assert.deepEqual(en.achievements[a.id], [a.name, a.desc]);
  I.setLocale('en-US');
  for (const s of C.JOURNEY) assert.equal(I.stageName(s), s.name, s.id);
});
test('non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = [...used].filter((k) => STRINGS[loc][k] === en[k] && !/^(opponentCount|suitOption|cardOf|optionsBtn|appearance|lbRank|stage_\w+)$/.test(k));
    assert.ok(same.length < 15, `${loc}: ${same.join(', ')}`);
  }
});
test('locale matching follows the runtime language', () => {
  assert.equal(I.match('de'), 'de-DE');
  assert.equal(I.match('es-MX'), 'es-419');
  assert.equal(I.match('fr-CA'), 'fr-CA');
  assert.equal(I.match('pt'), 'pt-BR');
  assert.equal(I.match('xx'), 'en-US');
});
