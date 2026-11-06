// Every string key the client uses (T("…") in native/*.ts) exists in all nine
// locales with the same {placeholders} as US English, every locale has exactly
// the US English keys, and every content name (themes, challenges, lessons,
// achievements, Journey stages) is translated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const STRINGS = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const C = require('../js/content.js');
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
    for (const t of C.THEMES) assert.ok(L[`themes.${t.id}`], `theme ${t.id}`);
    for (const c of C.CHALLENGES) assert.ok(L[`challenges.${c.id}.0`] && L[`challenges.${c.id}.1`], `challenge ${c.id}`);
    for (const t of C.TUTORIAL) assert.ok(L[`tutorial.${t.id}.0`] && L[`tutorial.${t.id}.1`], `lesson ${t.id}`);
    for (const a of C.ACHIEVEMENTS) assert.ok(L[`achievements.${a.id}.0`] && L[`achievements.${a.id}.1`], `achievement ${a.id}`);
  });
}
test('English content strings match the authored data', () => {
  for (const t of C.THEMES) assert.equal(en[`themes.${t.id}`], t.name);
  for (const c of C.CHALLENGES) assert.deepEqual([en[`challenges.${c.id}.0`], en[`challenges.${c.id}.1`]], [c.name, c.desc]);
  for (const t of C.TUTORIAL) assert.deepEqual([en[`tutorial.${t.id}.0`], en[`tutorial.${t.id}.1`]], [t.title, t.body]);
  for (const a of C.ACHIEVEMENTS) assert.deepEqual([en[`achievements.${a.id}.0`], en[`achievements.${a.id}.1`]], [a.name, a.desc]);
  const stageName = ({ index: n }) => (n <= 8 ? en.stage_local.replace('{n}', n) : n <= 16 ? en.stage_regional.replace('{n}', n) : n <= 28 ? en.stage_intercity.replace('{n}', n) : n <= 36 ? en.stage_express.replace('{n}', n) : en.stage_mastery.replace('{n}', n - 36));
  for (const s of C.JOURNEY) assert.equal(stageName(s), s.name, s.id);
});
test('non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = [...used].filter((k) => STRINGS[loc][k] === en[k] && !/^(opponentCount|suitOption|cardOf|optionsBtn|appearance|stage_\w+)$/.test(k));
    assert.ok(same.length < 15, `${loc}: ${same.join(', ')}`);
  }
});
