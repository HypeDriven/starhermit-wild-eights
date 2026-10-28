// js/save.js: the browser build's save migrates (its settings block dropped,
// tutorialDone kept), two devices merge, rounds record achievements, and the
// old settings KV keeps only the game's own options.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../js/save.js');

const old = { version: 1, settings: { volMusic: 50, theme: 'emerald', tutorialDone: true }, journey: { j1: { won: true, bestMoves: 12 } }, achievements: { first_win: true },
  streak: 2, bestStreak: 3, dailyDays: ['2026-08-29'], records: { bestScore: 40, roundsPlayed: 5, roundsWon: 3 }, hosted: { code: null } };
test('the browser build save migrates', () => {
  const d = S.readDoc(JSON.stringify(old));
  assert.equal(d.tutorialDone, true);
  assert.deepEqual(d.journey.j1, { won: true, bestMoves: 12 });
  assert.equal(d.settings, undefined);
  assert.equal(d.records.bestScore, 40);
});
test('two devices merge: fewest moves, unions, larger records, the local streak', () => {
  const b = { journey: { j1: { won: true, bestMoves: 9 }, j2: { won: true, bestMoves: 20 } }, achievements: { daily_7: true }, streak: 0, bestStreak: 5, dailyDays: ['2026-08-30'], records: { bestScore: 10, roundsPlayed: 9, roundsWon: 1 } };
  const m = S.merge(old, b);
  assert.equal(m.journey.j1.bestMoves, 9);
  assert.ok(m.journey.j2.won && m.achievements.daily_7 && m.achievements.first_win);
  assert.deepEqual(m.dailyDays, ['2026-08-29', '2026-08-30']);
  assert.equal(m.records.roundsPlayed, 9);
  assert.equal(m.streak, 2);
  assert.equal(m.bestStreak, 5);
  assert.ok(S.same(m, S.merge(m, b)));
});
test('a won round records streaks, journey and achievements', () => {
  const d = S.fresh();
  d.streak = 2;
  const un = S.recordRound(d, { mode: 'journey', stageId: 'j1', won: true, score: 30, moves: 10, eightsPlayed: 3, invalid: 0, hints: 0, day: null, journeyTotal: 40 });
  assert.deepEqual(un.sort(), ['eight_master', 'first_win', 'pacifist', 'streak_3']);
  assert.equal(d.journey.j1.bestMoves, 10);
  S.recordRound(d, { mode: 'daily', stageId: null, won: false, score: 0, moves: 5, eightsPlayed: 0, invalid: 1, hints: 0, day: '2026-10-28', journeyTotal: 40 });
  assert.equal(d.streak, 0);
  assert.deepEqual(d.dailyDays, ['2026-10-28']);
});
test('old settings KV: only theme, palette and left-handed carry over', () => {
  assert.deepEqual(S.pickOptions({ theme: 'crimson', cvdPalette: true, leftHanded: false, volMusic: 3, gfx: {} }), { theme: 'crimson', cvdPalette: true, leftHanded: false });
  assert.deepEqual(S.pickOptions({ theme: 'nope' }), {});
});
