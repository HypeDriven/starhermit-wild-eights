// Wild Eights — offline rules/content test suite. Run: node tests.js
"use strict";

const W = require("./game.js");
const C = require("./content.js");

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL:", name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + " (got " + JSON.stringify(a) + ")"); }

// --- setup & determinism -------------------------------------------------------
{
  const a = W.newGame(42, { players: 4 });
  const b = W.newGame(42, { players: 4 });
  eq(W.hash(a), W.hash(b), "same seed → same hash");
  const c = W.newGame(43, { players: 4 });
  ok(W.hash(a) !== W.hash(c), "different seed → different hash");
  let total = a.hands.reduce((n, h) => n + h.length, 0) + a.stock.length + a.discardPile.length;
  eq(total, 52, "52 cards accounted for");
  ok(a.discardPile.length === 1 && a.discardPile[0].rank !== 8, "starter is not an 8");
  ok(a.activeSuit === a.discardPile[0].suit, "active suit matches starter");
}

// --- serialization round trip ---------------------------------------------------
{
  const s = W.newGame(7, { players: 3 });
  const s2 = W.deserialize(JSON.parse(JSON.stringify(W.serialize(s))));
  eq(W.hash(s), W.hash(s2), "serialize/deserialize preserves hash");
  let threw = false;
  try { W.deserialize({ seed: 1, tick: 0, hands: [[0], [0]], stock: [], discardPile: [] }); } catch (e) { threw = true; }
  ok(threw, "deserialize rejects duplicate cards");
}

// --- legal actions ---------------------------------------------------------------
{
  const s = W.newGame(99, { players: 2 });
  // Force a known state.
  s.hands = [[W.cardById(0), W.cardById(7)], [W.cardById(13)]]; // 2♥, 8♥ vs 2♦
  s.stock = [W.cardById(26)];
  s.discardPile = [W.cardById(1)]; // 3♥
  s.activeSuit = "hearts";
  s.current = 0;
  const la = W.legalActions(s);
  eq(la.plays.sort(), [0, 7], "suit match + eight are legal");
  ok(la.canDraw, "draw always offered");

  let r = W.applyCommand(s, { type: "play", cardId: 13 });
  ok(r.error === "card-not-in-hand", "playing a card not in hand rejected");

  r = W.applyCommand(s, { type: "play", cardId: 0 });
  ok(!r.error, "suit match plays");
  eq(s.current, 1, "turn passes after play");

  // Opponent's 2♦ matches rank 2 of the played card? Played card was 2♥ → rank 2.
  const la2 = W.legalActions(s);
  eq(la2.plays, [13], "rank match is legal");
}

// --- eights: declare suit ---------------------------------------------------------
{
  const s = W.newGame(5, { players: 2 });
  s.hands = [[W.cardById(6)], [W.cardById(14)]]; // 8♥, 3♦
  s.stock = [];
  s.discardPile = [W.cardById(51)]; // A♠
  s.activeSuit = "spades";
  s.current = 0;
  let r = W.applyCommand(s, { type: "play", cardId: 6 });
  ok(!r.error, "eight plays on anything");
  eq(s.pendingSuitFor, 0, "suit declaration pending");
  r = W.applyCommand(s, { type: "draw" });
  eq(r.error, "must-declare-suit", "cannot draw before declaring");
  r = W.applyCommand(s, { type: "declareSuit", suit: "junk" });
  eq(r.error, "bad-suit", "bad suit rejected");
  r = W.applyCommand(s, { type: "declareSuit", suit: "diamonds" });
  ok(!r.error, "declare suit ok");
  eq(s.activeSuit, "diamonds", "active suit changed");
  eq(s.winner, 0, "empty hand after declaration wins");
  eq(s.terminalReason, "empty-hand", "terminal reason set");
  eq(s.score.total, W.cardPoints(W.cardById(14)), "winner scores opponent's points");
}

// --- drawing ------------------------------------------------------------------------
{
  const s = W.newGame(11, { players: 2 });
  s.hands = [[W.cardById(14)], [W.cardById(0)]]; // 3♦ can't match A♠
  s.discardPile = [W.cardById(51)];
  s.activeSuit = "spades";
  s.stock = [W.cardById(20), W.cardById(21), W.cardById(22), W.cardById(38)]; // 9♦,10♦,J♦,A♣(playable rank)
  s.current = 0;
  const la = W.legalActions(s);
  eq(la.plays, [], "no legal plays");
  const r = W.applyCommand(s, { type: "draw" });
  ok(!r.error, "draw ok");
  ok(s.hands[0].length >= 2, "cards drawn");
  // Drawing continues until playable or 3 draws.
  const drawnCount = r.events[0].count;
  ok(drawnCount >= 1 && drawnCount <= 3, "draw count bounded");
}

// --- pass when nothing playable after 3 draws ----------------------------------------
{
  const s = W.newGame(11, { players: 2 });
  s.hands = [[W.cardById(14)], [W.cardById(0)]];
  s.discardPile = [W.cardById(51)]; // A♠
  s.activeSuit = "spades";
  s.stock = [W.cardById(16), W.cardById(17), W.cardById(18)]; // 5♦,6♦,7♦ none match
  s.current = 0;
  const r = W.applyCommand(s, { type: "draw" });
  ok(!r.error, "draw ok");
  eq(s.current, 1, "turn passes after 3 unplayable draws");
  eq(s.hands[0].length, 4, "drew 3");
}

// --- scoring values ---------------------------------------------------------------------
{
  eq(W.cardPoints({ rank: 8 }), 50, "eight worth 50");
  eq(W.cardPoints({ rank: 14 }), 15, "ace worth 15");
  eq(W.cardPoints({ rank: 12 }), 10, "queen worth 10");
  eq(W.cardPoints({ rank: 5 }), 5, "pip worth face");
}

// --- deterministic replay ------------------------------------------------------------------
{
  const seed = 20260829;
  const opts = { players: 4, difficulty: 1 };
  const cmds = [];
  {
    const s = W.newGame(seed, opts);
    let guard = 1000;
    while (s.winner === null && guard-- > 0) {
      const cmd = W.aiCommand(s, 1);
      const r = W.applyCommand(s, cmd);
      if (r.error) throw new Error("AI cmd rejected: " + r.error);
      cmds.push(cmd);
    }
    ok(s.winner !== null, "self-play terminates");
  }
  const r1 = W.replay({ version: W.RULES_VERSION, seed, options: opts, commands: cmds });
  const r2 = W.replay({ version: W.RULES_VERSION, seed, options: opts, commands: cmds });
  eq(r1.finalHash, r2.finalHash, "replay is deterministic");
  ok(r1.hashes.length === cmds.length + 1, "hash chain length matches commands");
}

// --- fuzz malformed commands --------------------------------------------------------------------
{
  const s = W.newGame(3, { players: 2 });
  const junk = [null, undefined, {}, { type: 5 }, { type: "play" }, { type: "play", cardId: -1 },
    { type: "play", cardId: 99 }, { type: "play", cardId: "x" }, { type: "declareSuit" },
    { type: "teleport" }, { type: "draw", extra: "x" }];
  junk.forEach((j, i) => {
    const before = W.hash(s);
    const r = W.applyCommand(s, j);
    if (!r.error) {
      // draw is the only legit no-arg command here; everything else must error
      ok(j && j.type === "draw", "fuzz " + i + " accepted only valid shape");
    } else {
      eq(W.hash(s), before, "fuzz " + i + " rejected without changing state");
    }
  });
}

// --- daily seed -----------------------------------------------------------------------------------
{
  const d1 = W.dailySeed(new Date(Date.UTC(2026, 7, 29, 23, 59)));
  const d2 = W.dailySeed(new Date(Date.UTC(2026, 7, 29, 0, 1)));
  eq(d1, d2, "daily seed stable within UTC day");
  const d3 = W.dailySeed(new Date(Date.UTC(2026, 7, 30)));
  ok(d1 !== d3, "daily seed changes across days");
}

// --- content validators ------------------------------------------------------------------------------
{
  const problems = C.validate(W);
  eq(problems, [], "content validators pass");
  ok(C.JOURNEY.length >= 40, "40 journey stages");
  ok(C.THEMES.length >= 5, "5 themes");
  ok(C.ACHIEVEMENTS.length >= 5, "achievement set");
}

// --- golden sessions --------------------------------------------------------------------------------------
{
  [2, 3, 4].forEach((players) => {
    const seed = 1000 + players;
    const s = W.newGame(seed, { players, difficulty: 2 });
    let guard = 2000;
    while (s.winner === null && guard-- > 0) {
      const cmd = W.aiCommand(s, 2);
      const r = W.applyCommand(s, cmd);
      if (r.error) throw new Error("golden " + players + "p rejected: " + r.error);
    }
    ok(s.winner !== null, "golden " + players + "p terminates with winner");
    ok(s.score && typeof s.score.total === "number", "golden " + players + "p has score breakdown");
  });
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
