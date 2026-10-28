// BOARDS:BEGIN — JSON, read by tools/leaderboards.mjs to create the boards.
var BOARDS = {
  "high-score": { "name": "High score", "scoreType": "integer", "sortDirection": "desc", "minScore": 0, "maxScore": 10000 }
};
// BOARDS:END

var SEATS = 4;
var DIFFICULTY = 1;          // the old host's tables: Regular rivals
var OFFLINE_AI_MS = 30000;   // offline this long: the AI plays the seat's turns

function validScore(board, v) {
  if (typeof v !== 'number' || !isFinite(v)) return false;
  if (board.scoreType !== 'decimal' && Math.floor(v) !== v) return false;
  if (board.scoreType === 'time-ms' && v < 0) return false;
  if (board.minScore != null && v < board.minScore) return false;
  if (board.maxScore != null && v > board.maxScore) return false;
  return true;
}

// ---------------------------------------------------------------- hosted tables

/** Seats in roster order (team, then slot); seats nobody holds are AI. */
function seatsFromRoom(ctx) {
  var roster = ((ctx.room && ctx.room.roster) || []).slice();
  roster.sort(function (a, b) { return ((a.team || 0) - (b.team || 0)) || ((a.slot || 0) - (b.slot || 0)); });
  var seats = [];
  for (var i = 0; i < roster.length && seats.length < SEATS; i++) {
    var r = roster[i];
    var ai = !!r.ai || !r.userId;
    seats.push({ userId: ai ? null : String(r.userId), name: String(r.displayName || r.name || '').slice(0, 24), ai: ai });
  }
  while (seats.length < SEATS) seats.push({ userId: null, name: '', ai: true });
  return seats;
}

function newTable(ctx) {
  var seed = (Math.floor((ctx.random || 0) * 2147483646) + 1) >>> 0;
  var ss = {
    kind: 'table',
    seats: seatsFromRoom(ctx),
    state: W.serialize(W.newGame(seed, { players: SEATS, difficulty: DIFFICULTY })),
    left: [false, false, false, false],
    offlineSince: [null, null, null, null],
    seen: [],
    over: null,
    summary: { status: 'active' }
  };
  return ss;
}

function load(ss) { var s = W.deserialize(ss.state); s.difficulty = DIFFICULTY; return s; }
function seatOf(ss, userId) {
  if (!userId) return -1;
  for (var i = 0; i < ss.seats.length; i++) if (ss.seats[i].userId === userId) return i;
  return -1;
}
/** Whether the AI plays this seat now: an AI seat, a player who left, one offline past the grace. */
function aiPlays(ss, seat, now) {
  var s = ss.seats[seat];
  if (s.ai || !s.userId || ss.left[seat]) return true;
  return ss.offlineSince[seat] != null && now - ss.offlineSince[seat] >= OFFLINE_AI_MS;
}
function actor(st) { return st.pendingSuitFor !== null ? st.pendingSuitFor : st.current; }

/** The AI takes every turn that is its own (app.js roomRunAI). */
function runAI(ss, st, now, events) {
  for (var guard = 0; guard < 400 && st.winner === null; guard++) {
    if (!aiPlays(ss, actor(st), now)) return;
    var cmd = W.aiCommand(st, DIFFICULTY);
    if (!cmd) return;
    var r = W.applyCommand(st, cmd);
    if (r.error) return;
    for (var i = 0; i < (r.events || []).length; i++) events.push(r.events[i]);
  }
}

function overOf(st) {
  if (st.winner === null) return null;
  return { winner: st.winner, reason: st.terminalReason, score: st.score };
}
function eventsFor(events, seat) {
  var out = [];
  for (var i = 0; i < events.length && out.length < 120; i++) {
    var e = events[i], c = {};
    for (var k in e) c[k] = e[k];
    if (c.type === 'draw' && c.player !== seat) delete c.cardIds;
    out.push(c);
  }
  return out;
}
function snapFor(ss, st, seat, events, now) {
  var ai = [], away = [];
  for (var i = 0; i < SEATS; i++) { ai.push(!!ss.seats[i].ai); away.push(!ss.seats[i].ai && aiPlays(ss, i, now)); }
  return {
    type: 'snap', seat: seat,
    names: ss.seats.map(function (s) { return s.name; }), ai: ai, away: away,
    view: W.publicSnapshot(st, seat), events: eventsFor(events, seat), over: ss.over
  };
}
/** One view per seated human (nobody sees another hand). */
function broadcastAll(ss, st, events, now, ret) {
  for (var i = 0; i < SEATS; i++) {
    var u = ss.seats[i].userId;
    if (u && !ss.left[i]) ret.broadcast.push({ to: [u], data: snapFor(ss, st, i, events, now) });
  }
}

function finish(ss, st, ret) {
  ss.over = overOf(st);
  ss.summary = { status: 'finished' };
  var w = st.winner;
  ret.result = {
    kind: 'win',
    reason: st.terminalReason,
    winnerSeat: w,
    winnerUserId: ss.seats[w] ? ss.seats[w].userId : null,
    standings: st.score.breakdown.map(function (b) {
      return { seat: b.player, userId: ss.seats[b.player].userId, cardsLeft: b.cards, points: b.points, winner: b.player === w };
    }),
    total: st.score.total
  };
}

/** After a change: the AI's turns, the views, the end. */
function settle(ss, st, events, now, ret) {
  runAI(ss, st, now, events);
  var ended = st.winner !== null && !ss.over;
  if (ended) ss.over = overOf(st);
  ss.state = W.serialize(st);
  broadcastAll(ss, st, events, now, ret);
  if (ended) finish(ss, st, ret);
  ret.sessionState = ss;
  return ret;
}

function validCmd(cmd) {
  if (!cmd || typeof cmd !== 'object') return null;
  if (cmd.type === 'play' && typeof cmd.cardId === 'number' && cmd.cardId >= 0 && cmd.cardId <= 51 && Math.floor(cmd.cardId) === cmd.cardId) return { type: 'play', cardId: cmd.cardId };
  if (cmd.type === 'declareSuit' && W.SUITS.indexOf(cmd.suit) >= 0) return { type: 'declareSuit', suit: cmd.suit };
  if (cmd.type === 'draw') return { type: 'draw' };
  return null;
}

function tableMessage(ctx) {
  var ss = ctx.sessionState;
  var data = (ctx.message && ctx.message.data) || {};
  var from = ctx.message && ctx.message.from;
  var now = ctx.now || 0;
  var seat = seatOf(ss, from);
  if (seat < 0) return { ok: false, error: 'Not seated' };
  var st = load(ss);
  if (data.type === 'sync') {
    if (ss.offlineSince[seat] != null) { ss.offlineSince[seat] = null; }
    return { ok: true, broadcast: [{ to: [from], data: snapFor(ss, st, seat, [], now) }], sessionState: ss };
  }
  var ret = { ok: true, broadcast: [] };
  if (data.type === 'forfeit') {
    if (ss.over || ss.left[seat]) return { ok: true };
    ss.left[seat] = true;
    return settle(ss, st, [{ type: 'seat', player: seat, k: 'left' }], now, ret);
  }
  if (data.type !== 'cmd') return { ok: false, error: 'Unknown command' };
  if (ss.over) return { ok: true, broadcast: [{ to: [from], data: { type: 'rejected', reason: 'game-over' } }] };
  var id = typeof data.id === 'string' ? data.id.slice(0, 64) : '';
  if (id && ss.seen.indexOf(seat + ':' + id) >= 0) return { ok: true }; // a resent command: already applied
  var cmd = validCmd(data.cmd);
  if (!cmd) return { ok: true, broadcast: [{ to: [from], data: { type: 'rejected', reason: 'bad-command' } }] };
  if (actor(st) !== seat) return { ok: true, broadcast: [{ to: [from], data: { type: 'rejected', reason: 'not-your-turn' } }] };
  ss.offlineSince[seat] = null;
  var r = W.applyCommand(st, cmd);
  if (id) { ss.seen.push(seat + ':' + id); if (ss.seen.length > 32) ss.seen.shift(); }
  if (r.error) {
    ss.state = W.serialize(st); // an illegal card counts as an invalid action
    ret.broadcast.push({ to: [from], data: { type: 'rejected', reason: r.error } });
    ret.sessionState = ss;
    return ret;
  }
  return settle(ss, st, r.events || [], now, ret);
}

function tableTick(ctx) {
  var ss = ctx.sessionState;
  if (!ss || ss.kind !== 'table' || ss.over) return { ok: true };
  var presence = ctx.presence || {};
  var now = ctx.now || 0;
  var before = [];
  for (var b = 0; b < SEATS; b++) before.push(aiPlays(ss, b, now - 1));
  var events = [];
  var changed = false;
  for (var i = 0; i < SEATS; i++) {
    var uid = ss.seats[i].userId;
    if (!uid || ss.left[i]) continue;
    var pr = presence[uid];
    if (pr && pr.left) { ss.left[i] = true; events.push({ type: 'seat', player: i, k: 'left' }); changed = true; continue; }
    if (pr && pr.online === false) {
      if (ss.offlineSince[i] == null) { ss.offlineSince[i] = now; changed = true; }
    } else if (ss.offlineSince[i] != null) { ss.offlineSince[i] = null; events.push({ type: 'seat', player: i, k: 'back' }); changed = true; }
  }
  for (var j = 0; j < SEATS; j++) {
    if (!before[j] && aiPlays(ss, j, now) && !ss.left[j]) { events.push({ type: 'seat', player: j, k: 'away' }); changed = true; }
  }
  var st = load(ss);
  if (!changed && !aiPlays(ss, actor(st), now)) return { ok: true };
  // Every human left: the round has no one to play for; end it as the rules would at a dead stock.
  var anyone = false;
  for (var h = 0; h < SEATS; h++) if (ss.seats[h].userId && !ss.left[h]) anyone = true;
  var ret = { ok: true, broadcast: [] };
  if (!anyone && st.winner === null) {
    endAbandoned(st);
  }
  return settle(ss, st, events, now, ret);
}

/** The rules' own fewest-points end (game.js endByPoints) for an abandoned table. */
function endAbandoned(st) {
  var best = 0, bestPts = Infinity;
  for (var p = 0; p < st.players; p++) {
    var pts = 0;
    for (var i = 0; i < st.hands[p].length; i++) pts += W.cardPoints(st.hands[p][i]);
    if (pts < bestPts) { bestPts = pts; best = p; }
  }
  st.winner = best;
  st.terminalReason = 'abandoned';
  var breakdown = [], total = 0;
  for (var q = 0; q < st.players; q++) {
    if (q === best) { breakdown.push({ player: q, cards: 0, points: 0 }); continue; }
    var pt = 0;
    for (var c = 0; c < st.hands[q].length; c++) pt += W.cardPoints(st.hands[q][c]);
    breakdown.push({ player: q, cards: st.hands[q].length, points: pt });
    total += pt;
  }
  st.score = { winner: best, total: total, breakdown: breakdown };
}

// ---------------------------------------------------------------- score posting

function scoreMessage(ctx) {
  var data = (ctx.message && ctx.message.data) || {};
  if (data.type !== 'result' || !data.scores || typeof data.scores !== 'object') {
    return { ok: false, error: 'Unknown command' };
  }
  var from = ctx.message.from;
  var scores = {}, accepted = [], n = 0;
  for (var key in BOARDS) {
    if (!Object.prototype.hasOwnProperty.call(BOARDS, key)) continue;
    if (!Object.prototype.hasOwnProperty.call(data.scores, key) || n >= 16) continue;
    var v = data.scores[key];
    if (!validScore(BOARDS[key], v)) continue;
    scores[key] = {}; scores[key][from] = v; accepted.push(key); n++;
  }
  var state = ctx.sessionState || {};
  state.summary = { status: 'finished' };
  return {
    ok: true,
    sessionState: state,
    scores: scores,
    broadcast: [{ to: [from], data: { type: 'result-ack', accepted: accepted } }],
    result: { kind: 'finished', reason: 'result' }
  };
}

globalThis.game = {
  // Presence (players who left or went offline) is read once a second; every move is a command.
  tickRateHz: 1,

  createSession: function (ctx) {
    if (ctx.room) return { ok: true, sessionState: newTable(ctx) };
    return { ok: true, sessionState: { kind: 'score', startedAt: ctx.now, summary: { status: 'active' } } };
  },

  onPlayerMessage: function (ctx) {
    if (ctx.sessionState && ctx.sessionState.kind === 'table') return tableMessage(ctx);
    return scoreMessage(ctx);
  },

  onTick: function (ctx) {
    if (ctx.sessionState && ctx.sessionState.kind === 'table') return tableTick(ctx);
    return { ok: true };
  }
};
