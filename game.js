// Wild Eights — pure deterministic rules engine.
// No DOM, no Math.random: all randomness flows through a seeded mulberry32
// stream whose state lives inside the serializable game state, so replays and
// reconnects reproduce identical results. Exposes window.WEGame (browser)
// and module.exports (Node, for tests and the authoritative server).
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WEGame = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var RULES_VERSION = 3;
  var SUITS = ["hearts", "diamonds", "clubs", "spades"];
  var RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J 12=Q 13=K 14=A

  function rankName(r) {
    if (r <= 10) return String(r);
    return ["J", "Q", "K", "A"][r - 11];
  }
  function cardName(c) { return rankName(c.rank) + " of " + c.suit; }

  // Point values used by scoring: 8s are wild (50), faces 10, aces 15, pips face.
  function cardPoints(c) {
    if (c.rank === 8) return 50;
    if (c.rank === 14) return 15;
    if (c.rank >= 11) return 10;
    return c.rank;
  }

  // --- seeded random stream -------------------------------------------------
  // mulberry32 with explicit 32-bit state stored in game state (rngState).
  function rngNext(state) {
    var a = state.rngState | 0;
    a = (a + 0x6D2B79F5) | 0;
    state.rngState = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rngInt(state, n) { return Math.floor(rngNext(state) * n); }

  // --- setup ----------------------------------------------------------------
  function buildDeck() {
    var cards = [];
    for (var s = 0; s < SUITS.length; s++)
      for (var r = 0; r < RANKS.length; r++)
        cards.push({ id: s * 13 + r, suit: SUITS[s], rank: RANKS[r] });
    return cards;
  }

  // options: { players: 2..4, handSize?: number (default 7, or 5 for 2p classic),
  //            ai: [bool per seat], difficulty: 0..2 }
  function newGame(seed, options) {
    options = options || {};
    var players = options.players || 4;
    if (players < 2 || players > 4) throw new Error("players must be 2..4");
    var handSize = options.handSize || (players === 2 ? 7 : 7);
    var state = {
      version: RULES_VERSION,
      seed: seed >>> 0,
      rngState: seed >>> 0,
      tick: 0,
      players: players,
      ai: options.ai || null,
      difficulty: options.difficulty == null ? 1 : options.difficulty,
      current: 0,
      direction: 1,
      winner: null,
      terminalReason: null,
      activeSuit: null,          // set by first discard
      pendingSuitFor: null,       // player index that must declare a suit, else null
      hands: [],
      stock: [],
      discardPile: [],
      moveCount: 0,               // plays+draws by player 0 for challenge limits
      invalidActions: 0,
      score: null,                // filled at terminal: { winner, breakdown }
      log: []
    };
    var deck = buildDeck();
    // Fisher-Yates with the seeded stream.
    for (var i = deck.length - 1; i > 0; i--) {
      var j = rngInt(state, i + 1);
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    for (var p = 0; p < players; p++) state.hands.push([]);
    var idx = 0;
    for (var k = 0; k < handSize; k++)
      for (var p2 = 0; p2 < players; p2++)
        state.hands[p2].push(deck[idx++]);
    // Flip starter; if it is an 8, the dealer's left opponent... classic rule:
    // bury it and flip again.
    // Flip starter; if it would be an 8, swap the first non-8 into its place
    // (keeps the deal deterministic without unbounded splicing).
    var s0 = idx;
    while (deck[s0].rank === 8) s0++;
    var tmpc = deck[idx]; deck[idx] = deck[s0]; deck[s0] = tmpc;
    var starter = deck[idx++];
    state.discardPile.push(starter);
    state.activeSuit = starter.suit;
    state.stock = deck.slice(idx);
    return state;
  }

  function topDiscard(state) { return state.discardPile[state.discardPile.length - 1]; }

  function canPlay(state, card) {
    if (card.rank === 8) return true;
    var top = topDiscard(state);
    return card.suit === state.activeSuit || card.rank === top.rank;
  }

  // Legal actions for the player whose turn it is.
  // Returns { player, plays: [cardId...], suits?: [..] per eight, canDraw, mustDeclareSuit }
  function legalActions(state) {
    if (state.winner !== null) return { player: state.current, plays: [], canDraw: false, mustDeclareSuit: false, over: true };
    if (state.pendingSuitFor !== null) {
      return { player: state.pendingSuitFor, plays: [], canDraw: false, mustDeclareSuit: true };
    }
    var hand = state.hands[state.current];
    var plays = [];
    for (var i = 0; i < hand.length; i++) if (canPlay(state, hand[i])) plays.push(hand[i].id);
    return { player: state.current, plays: plays, canDraw: true, mustDeclareSuit: false };
  }

  function nextPlayer(state) {
    state.current = (state.current + state.direction + state.players) % state.players;
  }

  function reshuffleStock(state) {
    // Keep the top discard; recycle the rest into a new shuffled stock.
    var top = state.discardPile.pop();
    var pool = state.discardPile;
    state.discardPile = [top];
    for (var i = pool.length - 1; i > 0; i--) {
      var j = rngInt(state, i + 1);
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    state.stock = pool;
    return true;
  }

  function endByPoints(state, reason) {
    // Stock exhausted twice / no legal progress: fewest penalty points wins.
    var best = 0, bestPts = Infinity;
    for (var p = 0; p < state.players; p++) {
      var pts = 0;
      for (var i = 0; i < state.hands[p].length; i++) pts += cardPoints(state.hands[p][i]);
      if (pts < bestPts) { bestPts = pts; best = p; }
    }
    state.winner = best;
    state.terminalReason = reason;
    computeScore(state);
  }

  function computeScore(state) {
    var breakdown = [];
    var total = 0;
    for (var p = 0; p < state.players; p++) {
      if (p === state.winner) { breakdown.push({ player: p, cards: 0, points: 0 }); continue; }
      var pts = 0;
      for (var i = 0; i < state.hands[p].length; i++) pts += cardPoints(state.hands[p][i]);
      breakdown.push({ player: p, cards: state.hands[p].length, points: pts });
      total += pts;
    }
    state.score = { winner: state.winner, total: total, breakdown: breakdown };
  }

  // Apply a validated command. Commands:
  //   { type:"play", cardId }            play a card
  //   { type:"declareSuit", suit }       after playing an 8
  //   { type:"draw" }                    draw from stock until playable or pass
  // Returns { state, events:[...], error?: code } — state is unchanged on error.
  function applyCommand(state, cmd) {
    if (!cmd || typeof cmd.type !== "string") return { state: state, error: "bad-command" };
    if (state.winner !== null) return { state: state, error: "game-over" };

    if (cmd.type === "declareSuit") {
      if (state.pendingSuitFor === null) return { state: state, error: "no-pending-suit" };
      if (SUITS.indexOf(cmd.suit) < 0) return { state: state, error: "bad-suit" };
      state.activeSuit = cmd.suit;
      var declarer = state.pendingSuitFor;
      state.pendingSuitFor = null;
      state.tick++;
      var afterDeclare = state.hands[declarer];
      if (afterDeclare.length === 0) {
        state.winner = declarer;
        state.terminalReason = "empty-hand";
        computeScore(state);
      } else {
        nextPlayer(state);
      }
      return { state: state, events: [{ type: "suit", player: declarer, suit: cmd.suit }] };
    }

    if (state.pendingSuitFor !== null) return { state: state, error: "must-declare-suit" };
    var me = state.current;

    if (cmd.type === "play") {
      var hand = state.hands[me];
      var idx = -1;
      for (var i = 0; i < hand.length; i++) if (hand[i].id === cmd.cardId) { idx = i; break; }
      if (idx < 0) { return { state: state, error: "card-not-in-hand" }; }
      var card = hand[idx];
      if (!canPlay(state, card)) {
        state.invalidActions++;
        return { state: state, error: "illegal-card", detail: "must match suit or rank, or play an 8" };
      }
      hand.splice(idx, 1);
      state.discardPile.push(card);
      if (me === 0) state.moveCount++;
      state.tick++;
      var ev = [{ type: "play", player: me, cardId: card.id, suit: card.suit, rank: card.rank }];
      if (card.rank === 8) {
        state.pendingSuitFor = me;
        ev.push({ type: "await-suit", player: me });
        return { state: state, events: ev };
      }
      state.activeSuit = card.suit;
      if (hand.length === 0) {
        state.winner = me;
        state.terminalReason = "empty-hand";
        computeScore(state);
        ev.push({ type: "win", player: me });
      } else {
        nextPlayer(state);
      }
      return { state: state, events: ev };
    }

    if (cmd.type === "draw") {
      if (me === 0) state.moveCount++;
      state.tick++;
      var drawn = [];
      // Draw until a playable card appears; classic cap: 3 draws then pass.
      var playable = null;
      for (var d = 0; d < 3; d++) {
        if (state.stock.length === 0) {
          if (state.discardPile.length <= 1) { endByPoints(state, "stock-exhausted"); return { state: state, events: [{ type: "end", reason: "stock-exhausted" }] }; }
          reshuffleStock(state);
        }
        var c2 = state.stock.pop();
        state.hands[me].push(c2);
        drawn.push(c2.id);
        if (canPlay(state, c2)) { playable = c2; break; }
      }
      var ev2 = [{ type: "draw", player: me, count: drawn.length, cardIds: drawn }];
      if (!playable) {
        nextPlayer(state);
        ev2.push({ type: "pass", player: me });
      }
      // If a playable card was drawn the player stays on turn and may play it.
      return { state: state, events: ev2 };
    }

    return { state: state, error: "unknown-command" };
  }

  // --- deterministic AI -------------------------------------------------------
  // Picks a command using only public rules + the seeded stream, so hosted
  // replays reproduce AI choices exactly. Difficulty 0 = random legal,
  // 1 = sensible (shed points), 2 = tracks suits.
  function aiCommand(state, difficulty) {
    var la = legalActions(state);
    if (la.over) return null;
    if (la.mustDeclareSuit) {
      // Declare the suit most held in hand.
      var hand = state.hands[state.pendingSuitFor];
      var counts = [0, 0, 0, 0];
      for (var i = 0; i < hand.length; i++) counts[SUITS.indexOf(hand[i].suit)]++;
      var best = 0;
      for (var s = 1; s < 4; s++) if (counts[s] > counts[best]) best = s;
      if (counts[best] === 0) best = rngInt(state, 4);
      return { type: "declareSuit", suit: SUITS[best] };
    }
    if (la.plays.length === 0) return { type: "draw" };
    var hand2 = state.hands[state.current];
    var playable = [];
    for (var p = 0; p < hand2.length; p++) if (la.plays.indexOf(hand2[p].id) >= 0) playable.push(hand2[p]);
    var pick;
    if (difficulty <= 0) {
      pick = playable[rngInt(state, playable.length)];
    } else {
      // Shed highest points, but hold eights unless hand is small or forced.
      playable.sort(function (a, b) { return cardPoints(b) - cardPoints(a); });
      var nonEight = null;
      for (var q = 0; q < playable.length; q++) if (playable[q].rank !== 8) { nonEight = playable[q]; break; }
      if (difficulty >= 2 && nonEight && hand2.length > 2) pick = nonEight;
      else if (hand2.length > 2 && nonEight) pick = nonEight;
      else pick = playable[0];
    }
    return { type: "play", cardId: pick.id };
  }

  // --- serialization / hashing / replay --------------------------------------
  function serialize(s) {
    return {
      version: s.version, seed: s.seed >>> 0, rngState: s.rngState >>> 0, tick: s.tick,
      players: s.players, current: s.current, direction: s.direction,
      winner: s.winner, terminalReason: s.terminalReason,
      activeSuit: s.activeSuit, pendingSuitFor: s.pendingSuitFor,
      hands: s.hands.map(function (h) { return h.map(function (c) { return c.id; }); }),
      stock: s.stock.map(function (c) { return c.id; }),
      discardPile: s.discardPile.map(function (c) { return c.id; }),
      moveCount: s.moveCount, invalidActions: s.invalidActions,
      score: s.score || null
    };
  }

  var DECK = buildDeck();
  function cardById(id) {
    if (typeof id !== "number" || id < 0 || id > 51) throw new Error("bad card id " + id);
    return DECK[id];
  }

  function deserialize(o) {
    if (!o || typeof o !== "object") throw new Error("bad state");
    if (typeof o.seed !== "number" || typeof o.tick !== "number") throw new Error("bad header");
    if (!Array.isArray(o.hands) || !Array.isArray(o.stock) || !Array.isArray(o.discardPile)) throw new Error("bad piles");
    var s = {
      version: o.version || RULES_VERSION,
      seed: o.seed >>> 0, rngState: (o.rngState == null ? o.seed : o.rngState) >>> 0,
      tick: o.tick, players: o.players || o.hands.length,
      ai: o.ai || null, difficulty: o.difficulty == null ? 1 : o.difficulty,
      current: o.current, direction: o.direction || 1,
      winner: o.winner === undefined ? null : o.winner,
      terminalReason: o.terminalReason || null,
      activeSuit: o.activeSuit, pendingSuitFor: o.pendingSuitFor === undefined ? null : o.pendingSuitFor,
      hands: o.hands.map(function (h) { return h.map(cardById); }),
      stock: o.stock.map(cardById),
      discardPile: o.discardPile.map(cardById),
      moveCount: o.moveCount || 0,
      invalidActions: o.invalidActions || 0,
      score: o.score || null,
      log: []
    };
    // integrity: all 52 cards exactly once
    var seen = new Array(52).fill(false);
    var mark = function (c) { if (seen[c.id]) throw new Error("duplicate card " + c.id); seen[c.id] = true; };
    s.hands.forEach(function (h) { h.forEach(mark); });
    s.stock.forEach(mark);
    s.discardPile.forEach(mark);
    for (var i = 0; i < 52; i++) if (!seen[i]) throw new Error("missing card " + i);
    return s;
  }

  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function hash(s) { return fnv(JSON.stringify(serialize(s))); }

  // Replay envelope: { version, seed, options, commands } → final hash chain.
  function replay(envelope) {
    if (!envelope || envelope.version !== RULES_VERSION) throw new Error("replay version mismatch");
    var s = newGame(envelope.seed, envelope.options || {});
    var hashes = [hash(s)];
    var cmds = envelope.commands || [];
    for (var i = 0; i < cmds.length; i++) {
      var r = applyCommand(s, cmds[i]);
      if (r.error) throw new Error("replay command " + i + " rejected: " + r.error);
      hashes.push(hash(s));
    }
    return { state: s, hashes: hashes, finalHash: hashes[hashes.length - 1] };
  }

  // Daily seed: immutable per UTC day.
  function dailySeed(date) {
    var d = date || new Date();
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return ((y * 10000 + m * 100 + day) * 2654435761) >>> 0;
  }

  return {
    RULES_VERSION: RULES_VERSION, SUITS: SUITS, RANKS: RANKS,
    rankName: rankName, cardName: cardName, cardPoints: cardPoints, cardById: cardById,
    newGame: newGame, legalActions: legalActions, applyCommand: applyCommand,
    aiCommand: aiCommand, canPlay: canPlay,
    serialize: serialize, deserialize: deserialize, hash: hash, replay: replay,
    dailySeed: dailySeed
  };
});
