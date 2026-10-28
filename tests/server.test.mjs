// server.js in a node vm, as the platform's sandbox runs it: hosted tables
// (room-bound sessions refereed end to end, hidden hands, out-of-turn and
// forged commands refused, AI takeover for players who left or stayed
// offline) and the score posting the old score-script.js did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const W = require('../js/game.js');
const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function sandbox() {
  const ctx = { console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.game;
}
const json = (v) => JSON.parse(JSON.stringify(v));
const room = (humans) => ({
  roomId: 'r1', metadata: {},
  roster: [0, 1, 2, 3].map((i) => (i < humans.length ? { userId: humans[i], name: humans[i], team: 0, slot: i, ai: false } : { userId: null, name: 'Bot ' + i, team: 0, slot: i, ai: true })),
});
function call(game, fn, ss, extra) {
  const r = json(game[fn](json({ now: extra.now ?? 1000, random: 0.37, sessionState: ss, room: extra.room, presence: extra.presence || {}, message: extra.message })));
  return r;
}
const lastSnap = (r, user) => r.broadcast.filter((b) => b.to.includes(user) && b.data.type === 'snap').map((b) => b.data).pop();

function noHiddenCards(snap) {
  snap.view.hands.forEach((h, i) => { if (i !== snap.seat) assert.ok(h.every((c) => c === null), 'other hand hidden'); });
  assert.ok(snap.view.stock.every((c) => c === null), 'stock hidden');
  assert.equal(snap.view.seed, 0);
  for (const e of snap.events) if (e.type === 'draw' && e.player !== snap.seat) assert.equal(e.cardIds, undefined);
}

function playOut(humans) {
  const game = sandbox();
  const rm = room(humans);
  const presence = Object.fromEntries(humans.map((u) => [u, { online: true, left: false }]));
  let ss = call(game, 'createSession', null, { room: rm, presence }).sessionState;
  const views = {};
  for (const u of humans) {
    const r = call(game, 'onPlayerMessage', ss, { room: rm, presence, message: { from: u, data: { type: 'sync' } } });
    ss = r.sessionState || ss;
    views[u] = lastSnap(r, u);
  }
  let result = null, n = 0, now = 1000;
  for (let guard = 0; guard < 2000 && !result; guard++) {
    now += 500;
    let acted = false;
    for (const u of humans) {
      const snap = views[u];
      const st = W.deserialize(snap.view, snap.seat);
      const turn = st.pendingSuitFor !== null ? st.pendingSuitFor : st.current;
      if (st.winner !== null || turn !== snap.seat) continue;
      let cmd;
      if (st.pendingSuitFor !== null) cmd = { type: 'declareSuit', suit: 'hearts' };
      else { const la = W.legalActions(st); cmd = la.plays.length ? { type: 'play', cardId: la.plays[0] } : { type: 'draw' }; }
      const r = call(game, 'onPlayerMessage', ss, { now, room: rm, presence, message: { from: u, data: { type: 'cmd', id: 'c' + n++, cmd } } });
      assert.ok(r.ok);
      ss = r.sessionState || ss;
      for (const v of humans) { const s = lastSnap(r, v); if (s) { noHiddenCards(s); views[v] = s; } }
      if (r.result) result = r.result;
      acted = true;
      break;
    }
    if (!acted) {
      const r = call(game, 'onTick', ss, { now, room: rm, presence });
      ss = r.sessionState || ss;
      for (const v of humans) { const s = lastSnap(r, v); if (s) views[v] = s; }
      if (r.result) result = r.result;
    }
  }
  return { result, ss, views };
}

test('a hosted table with one human and three AI seats plays to a refereed result', () => {
  const { result, views } = playOut(['alice']);
  assert.ok(result, 'result');
  assert.equal(result.kind, 'win');
  assert.equal(result.standings.length, 4);
  assert.ok(views.alice.over && views.alice.over.score);
});

test('two humans: each sees only their own hand, the round ends with one result', () => {
  const { result, views } = playOut(['alice', 'bob']);
  assert.ok(result);
  assert.equal(views.alice.seat, 0);
  assert.equal(views.bob.seat, 1);
  assert.deepEqual(views.alice.over.score, views.bob.over.score);
});

test('out-of-turn, forged and unseated commands are refused', () => {
  const game = sandbox();
  const rm = room(['alice', 'bob']);
  const presence = { alice: { online: true, left: false }, bob: { online: true, left: false } };
  const ss = call(game, 'createSession', null, { room: rm, presence }).sessionState;
  const st = W.deserialize(ss.state);
  assert.equal(st.current, 0);
  let r = call(game, 'onPlayerMessage', ss, { room: rm, presence, message: { from: 'bob', data: { type: 'cmd', id: 'x', cmd: { type: 'draw' } } } });
  assert.equal(r.broadcast[0].data.reason, 'not-your-turn');
  r = call(game, 'onPlayerMessage', ss, { room: rm, presence, message: { from: 'alice', data: { type: 'cmd', id: 'y', cmd: { type: 'play', cardId: 99 } } } });
  assert.equal(r.broadcast[0].data.reason, 'bad-command');
  r = call(game, 'onPlayerMessage', ss, { room: rm, presence, message: { from: 'mallory', data: { type: 'sync' } } });
  assert.equal(r.ok, false);
  r = call(game, 'onPlayerMessage', ss, { room: rm, presence, message: { from: 'alice', data: { type: 'result', scores: { 'high-score': 9999 } } } });
  assert.ok(!r.scores, 'a hosted table never posts client scores');
});

test('a player who left hands the seat to the AI; an offline one after 30 s', () => {
  const game = sandbox();
  const rm = room(['alice', 'bob']);
  let presence = { alice: { online: true, left: false }, bob: { online: true, left: false } };
  let ss = call(game, 'createSession', null, { room: rm, presence }).sessionState;
  // alice goes offline: nothing for 30 s, then the AI plays her turn
  presence = { alice: { online: false, left: false }, bob: { online: true, left: false } };
  ss = call(game, 'onTick', ss, { now: 2000, room: rm, presence }).sessionState || ss;
  assert.equal(W.deserialize(ss.state).current, 0);
  const r = call(game, 'onTick', ss, { now: 33000, room: rm, presence });
  ss = r.sessionState;
  const st = W.deserialize(ss.state);
  assert.ok(st.tick > 0 && (st.winner !== null || (st.pendingSuitFor ?? st.current) === 1 || st.current !== 0), 'the AI moved for alice');
  assert.ok(lastSnap(r, 'bob').away[0]);
  // bob leaves for good
  presence = { alice: { online: true, left: false }, bob: { online: false, left: true } };
  const r2 = call(game, 'onTick', ss, { now: 34000, room: rm, presence });
  assert.ok(r2.sessionState.left[1]);
});

test('score posting stays score-script.js: range-checked, then finished', () => {
  const game = sandbox();
  const ss = call(game, 'createSession', null, {}).sessionState;
  assert.equal(ss.kind, 'score');
  let r = call(game, 'onPlayerMessage', ss, { message: { from: 'u1', data: { type: 'result', scores: { 'high-score': 120 } } } });
  assert.deepEqual(r.scores, { 'high-score': { u1: 120 } });
  assert.ok(r.result);
  r = call(game, 'onPlayerMessage', ss, { message: { from: 'u1', data: { type: 'result', scores: { 'high-score': 10001 } } } });
  assert.deepEqual(r.scores, {});
});
