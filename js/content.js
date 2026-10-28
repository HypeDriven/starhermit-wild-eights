// Wild Eights — versioned content: journey stages, challenges, tutorials,
// themes, achievements. Pure data + validators, no DOM.
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WEContent = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var CONTENT_VERSION = 1;

  // --- Themes ----------------------------------------------------------------
  var THEMES = [
    { id: "compartment", name: "Night Compartment", felt: 0x2e6b4f, wood: 0x6b4226, wall: 0x3a2f2a, lamp: 0xffd9a0, sky: 0x0d1420 },
    { id: "morning",     name: "Morning Express",   felt: 0x3f7fbf, wood: 0x8a5a33, wall: 0x5a4a3a, lamp: 0xfff2df, sky: 0x7fa8d8 },
    { id: "emerald",     name: "Emerald Line",      felt: 0x1f7a5c, wood: 0x4a3220, wall: 0x24352c, lamp: 0xd8ffd8, sky: 0x10201a },
    { id: "crimson",     name: "Crimson Sleeper",   felt: 0x7a2e3a, wood: 0x5a3a28, wall: 0x2e2028, lamp: 0xffc8b0, sky: 0x1a0e14 },
    { id: "porcelain",   name: "Porcelain Coach",   felt: 0x8898a8, wood: 0x9a8a7a, wall: 0x6a6a72, lamp: 0xffffff, sky: 0xc8d4e0 }
  ];

  // --- Journey: 40 authored stages -------------------------------------------
  // Difficulty arc: 1-8 solo basics vs 1 AI, 9-16 two opponents, 17-28 three
  // opponents with tougher AI, 29-36 constrained pars, 37-40 mastery stages.
  var JOURNEY = [];
  (function () {
    for (var i = 0; i < 40; i++) {
      var n = i + 1;
      var stage;
      if (n <= 8) {
        stage = { players: 2, difficulty: n <= 3 ? 0 : 1, handSize: 5 + (n % 3), par: 18 + n };
      } else if (n <= 16) {
        stage = { players: 3, difficulty: 1, handSize: 6 + (n % 2), par: 22 + n };
      } else if (n <= 28) {
        stage = { players: n % 4 === 0 ? 4 : 3, difficulty: n >= 21 ? 2 : 1, handSize: 7, par: 26 + (n % 10) };
      } else if (n <= 36) {
        stage = { players: 4, difficulty: 2, handSize: 7, par: 30 - (n - 29), moveLimit: 40 - (n - 29) };
      } else {
        stage = { players: 4, difficulty: 2, handSize: 7, par: 24, moveLimit: 34, mastery: true };
      }
      stage.id = "j" + n;
      stage.index = n;
      stage.seed = (0x9E3779B9 ^ (n * 0x85EBCA6B)) >>> 0;
      stage.name = n <= 8 ? "Stopping Train " + n :
                   n <= 16 ? "Regional " + n :
                   n <= 28 ? "Intercity " + n :
                   n <= 36 ? "Express " + n : "Mastery " + (n - 36);
      stage.introduced =
        n === 1 ? ["match"] : n === 3 ? ["eight"] : n === 5 ? ["draw"] :
        n === 9 ? ["multi"] : n === 21 ? ["memory"] : n === 29 ? ["limits"] :
        n === 37 ? ["mastery"] : [];
      JOURNEY.push(stage);
    }
  })();

  // --- Challenges --------------------------------------------------------------
  var CHALLENGES = [
    { id: "c-sprint", name: "Sprint", desc: "Win in 24 moves or fewer against two rivals.", seed: 424242, players: 3, difficulty: 1, moveLimit: 24 },
    { id: "c-longhaul", name: "Long Haul", desc: "Full hands of nine, three sharp rivals.", seed: 777001, players: 4, difficulty: 2, handSize: 9 },
    { id: "c-duel", name: "Duel", desc: "One rival, expert play, no undo.", seed: 5150, players: 2, difficulty: 2, noUndo: true },
    { id: "c-minimal", name: "Minimal Service", desc: "Tiny hands of four. Every card matters.", seed: 90210, players: 4, difficulty: 1, handSize: 4, moveLimit: 20 }
  ];

  // --- Tutorial (Learn mode) -----------------------------------------------------
  var TUTORIAL = [
    { id: "t-match", title: "Match suit or rank", body: "Play a card that matches the top card's suit or rank. Use ← → to choose, Enter to play — or tap a highlighted card.", require: "play" },
    { id: "t-eight", title: "Eights are wild", body: "An 8 can be played on anything. After playing one, declare the suit the next player must match.", require: "eight" },
    { id: "t-draw", title: "Draw when stuck", body: "No matching card? Press D or the Draw button to take from the stock (up to 3, then you pass).", require: "draw" },
    { id: "t-win", title: "Empty your hand", body: "First player with no cards wins the round and scores the points left in every rival's hand. Eights are worth 50 — shed them early!", require: "finish" }
  ];

  // --- Achievements ----------------------------------------------------------------
  var ACHIEVEMENTS = [
    { id: "first_win", name: "All Aboard", desc: "Win your first round." },
    { id: "eight_master", name: "Wild Card", desc: "Win a round in which you played at least three eights." },
    { id: "streak_3", name: "Express Service", desc: "Win three rounds in a row." },
    { id: "journey_20", name: "Halfway House", desc: "Complete 20 journey stages." },
    { id: "journey_all", name: "End of the Line", desc: "Complete all 40 journey stages." },
    { id: "daily_7", name: "Season Ticket", desc: "Play the daily challenge on 7 different days." },
    { id: "pacifist", name: "Smooth Ride", desc: "Win a round with zero invalid actions and no hints." }
  ];

  // --- Validators (offline content checks) -------------------------------------------
  function validate(WEGame) {
    var problems = [];
    var ids = {};
    JOURNEY.forEach(function (s) {
      if (ids[s.id]) problems.push("duplicate stage id " + s.id);
      ids[s.id] = 1;
      if (typeof s.seed !== "number") problems.push(s.id + ": no seed");
      if (s.players < 2 || s.players > 4) problems.push(s.id + ": bad player count");
      // Legality + reachability: a deterministic AI self-play must terminate.
      var st = WEGame.newGame(s.seed, { players: s.players, handSize: s.handSize, difficulty: s.difficulty });
      var guard = 5000, over = false;
      while (guard-- > 0) {
        if (st.winner !== null) { over = true; break; }
        var cmd = WEGame.aiCommand(st, s.difficulty);
        if (!cmd) break;
        var r = WEGame.applyCommand(st, cmd);
        if (r.error) { problems.push(s.id + ": AI command rejected: " + r.error); break; }
      }
      if (!over) problems.push(s.id + ": self-play did not terminate (soft lock?)");
    });
    CHALLENGES.forEach(function (c) {
      if (!c.id || typeof c.seed !== "number") problems.push("challenge missing id/seed");
    });
    if (JOURNEY.length < 40) problems.push("journey needs at least 40 stages");
    return problems;
  }

  return {
    CONTENT_VERSION: CONTENT_VERSION,
    THEMES: THEMES, JOURNEY: JOURNEY, CHALLENGES: CHALLENGES,
    TUTORIAL: TUTORIAL, ACHIEVEMENTS: ACHIEVEMENTS,
    validate: validate
  };
});
