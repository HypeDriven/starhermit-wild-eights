// Wild Eights — application controller: screens, session lifecycle, local and
// hosted play, persistence, input, accessibility mirror. ES module loaded
// after ui.js, so window.WEGame / WEContent / WEAudio / WEUI / WEPlatform
// are ready.
(function () {
  "use strict";

  var W = window.WEGame;
  var C = window.WEContent;
  var A = window.WEAudio;
  var UI = window.WEUI;
  var PL = window.WEPlatform;

  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------------------
  // Persistence (settings, journey progress, achievements, records).
  var SAVE_KEY = "wild-eights-save-v1";
  var save = loadSave();

  function loadSave() {
    var def = {
      version: 1,
      settings: {
        volMusic: 50, volEffects: 80, volAmbience: 40, muted: false,
        quality: "high", theme: "compartment",
        reducedMotion: false, highContrast: false, cvdPalette: false,
        bigText: false, leftHanded: false, tutorialDone: false
      },
      journey: {},          // stageId -> { won, bestMoves }
      achievements: {},     // id -> true
      streak: 0,
      bestStreak: 0,
      dailyDays: [],        // ["2026-08-29"]
      records: { bestScore: 0, roundsPlayed: 0, roundsWon: 0 },
      hosted: { code: null, name: null } // reconnect token for hosted tables
    };
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return def;
      var o = JSON.parse(raw);
      // Merge over defaults so new fields migrate cleanly.
      for (var k in def) if (!(k in o)) o[k] = def[k];
      for (var k2 in def.settings) if (!(k2 in o.settings)) o.settings[k2] = def.settings[k2];
      return o;
    } catch (e) { return def; }
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode: play session-only */ }
    if (PL && PL.hosted) PL.cloud.save(save); // debounced mirror; localStorage stays the cache
  }

  // Cloud load is remote-preferred: a remote document wins over the local
  // cache, which is exactly the "played on another device" case.
  function adoptRemoteSave(remote) {
    if (!remote || typeof remote !== "object") return false;
    // Prefer remote outright; it is the mirror of record on the platform.
    save = mergeSaveDefaults(remote);
    persist();
    applySettings();
    syncSettingsForm();
    updateTitleProgress();
    return true;
  }
  function mergeSaveDefaults(o) {
    // Same migration as loadSave: fold the loaded doc over a fresh default set.
    var base = loadSave();
    if (!o || typeof o !== "object") return base;
    for (var k in base) if (!(k in o)) o[k] = base[k];
    if (o.settings) for (var k2 in base.settings) if (!(k2 in o.settings)) o.settings[k2] = base.settings[k2];
    return o;
  }

  // ---------------------------------------------------------------------------
  // Platform glue (StarHermit). onPlatform = a launch token was read; the
  // hosted tables then run on realtime rooms. On a starhermit host without a
  // token hosted play is honestly unavailable (no fabricated endpoints).
  var onPlatform = !!(PL && PL.hosted);
  var onStarhermitHost = /(^|\.)starhermit\.com$/i.test(location.hostname);
  var myName = null; // account nickname, fetched at boot when hosted

  function setSyncStatus(s) {
    var el = $("sync-status");
    if (!el) return;
    el.hidden = false;
    el.textContent = s === "saving" ? "Saving…" : s === "synced" ? "Synced ✓" : "Offline";
    el.className = "sync-status sync-" + s;
  }

  function updateTitleProgress() {
    var doneCount = Object.keys(save.journey).filter(function (k) { return save.journey[k].won; }).length;
    $("title-progress").textContent =
      save.records.roundsPlayed === 0 ? "Welcome aboard." :
      "Journey " + doneCount + "/" + C.JOURNEY.length + " · streak " + save.streak + " · best score " + save.records.bestScore;
  }

  // Platform-time offset (ms), best effort: when a host serves /api/v1/time we
  // align daily boundaries to it (round-trip adjusted); offline play falls
  // back to the local clock, which is exact for a solo daily seed.
  var timeOffset = 0;
  function nowMs() { return Date.now() + timeOffset; }
  function syncTime() {
    if (!window.fetch) return;
    var t0 = Date.now();
    window.fetch("/api/v1/time")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || typeof j.epochMs !== "number") return;
        var rtt = Date.now() - t0;
        timeOffset = Math.round(j.epochMs + rtt / 2 - Date.now());
      })
      .catch(function () { /* no host: local clock it is */ });
  }

  // ---------------------------------------------------------------------------
  // Screen router.
  var currentScreen = "title";
  var screenStack = [];
  var lastFocus = null;

  function show(name, push) {
    if (push !== false && currentScreen !== name) screenStack.push(currentScreen);
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = $("screen-" + name);
    if (!el) return;
    lastFocus = document.activeElement;
    el.classList.add("active");
    currentScreen = name;
    var first = el.querySelector("button, input, select, [tabindex]");
    if (first) first.focus();
    document.body.classList.toggle("in-game", name === "game");
  }
  function back() {
    stopInvitePoll();
    var prev = screenStack.pop() || "title";
    show(prev, false);
  }

  function announce(msg, assertive) {
    $(assertive ? "live-alert" : "live-status").textContent = msg;
  }

  // ---------------------------------------------------------------------------
  // Settings application.
  function applySettings() {
    var s = save.settings;
    A.setLevel("music", s.volMusic / 100);
    A.setLevel("effects", s.volEffects / 100);
    A.setLevel("ambience", s.volAmbience / 100);
    A.setMuted(s.muted);
    document.body.classList.toggle("reduced-motion", s.reducedMotion);
    document.body.classList.toggle("high-contrast", s.highContrast);
    document.body.classList.toggle("big-text", s.bigText);
    document.body.classList.toggle("left-handed", s.leftHanded);
    $("btn-sound").textContent = s.muted ? "🔇 Muted" : "🔊 Sound";
    $("btn-sound").setAttribute("aria-pressed", String(!s.muted));
    $("btn-sound").title = s.muted ? "Unmute all audio" : "Mute all audio";
    if (UI.isReady()) {
      UI.setReducedMotion(s.reducedMotion);
      UI.setQuality(s.quality);
      UI.setSuitPalette(s.cvdPalette ? "cvd" : "standard");
      var theme = C.THEMES.filter(function (t) { return t.id === s.theme; })[0] || C.THEMES[0];
      UI.setTheme(theme);
      rerender();
    }
  }

  // ---------------------------------------------------------------------------
  // Session model (solo modes + hosted).
  var session = null;
  // session = { mode, state, undoStack: [snapshots], moveLimit, stageId,
  //             tutorialStep, eightsPlayed, hintsUsed, startedAt, hosted, seat,
  //             commands: [] (for replay), replaySeed, options }

  function newLocalSession(mode, options, extras) {
    var seed = (extras && extras.seed != null) ? extras.seed : (Date.now() % 0x7fffffff);
    var opts = { players: options.players || 4, handSize: options.handSize, difficulty: options.difficulty == null ? 1 : options.difficulty };
    session = {
      mode: mode,
      state: W.newGame(seed, opts),
      undoStack: [],
      moveLimit: options.moveLimit || null,
      stageId: extras && extras.stageId || null,
      noUndo: !!(options.noUndo || (extras && extras.mastery)),
      tutorialStep: mode === "learn" ? 0 : -1,
      eightsPlayed: 0,
      hintsUsed: 0,
      startedAt: Date.now(),
      hosted: false,
      commands: [],
      replaySeed: seed,
      options: { players: opts.players, handSize: options.handSize, difficulty: opts.difficulty, moveLimit: options.moveLimit || null, noUndo: !!options.noUndo },
      over: false
    };
    return session;
  }

  function humanTurn() {
    return session && !session.over && !session.hosted &&
      session.state.winner === null &&
      session.state.pendingSuitFor === null &&
      session.state.current === 0;
  }
  function mustDeclare() {
    return session && !session.hosted && session.state.pendingSuitFor === 0;
  }

  // Run AI turns until it's the human's turn or the game ends.
  function runAI() {
    var guard = 400;
    while (session && !session.hosted && session.state.winner === null && guard-- > 0) {
      var st = session.state;
      if (st.pendingSuitFor === 0) break;           // human must declare
      if (st.pendingSuitFor === null && st.current === 0) break; // human's turn
      var cmd = W.aiCommand(st, st.difficulty);
      if (!cmd) break;
      var r = W.applyCommand(st, cmd);
      if (r.error) break;
      session.commands.push(cmd);
      if (cmd.type === "play" && W.cardById(cmd.cardId).rank === 8 && st.pendingSuitFor !== 0) {
        // AI played an 8; its declareSuit command follows next loop iteration.
      }
      A.play(r.events && r.events.some(function (e) { return e.type === "draw"; }) ? "draw" : "play");
      UI.playEvents(r.events, st);
    }
    checkEnd();
  }

  function checkEnd() {
    if (!session || session.state.winner === null) return;
    if (session.over) return;
    session.over = true;
    finishRound();
  }

  // ---------------------------------------------------------------------------
  // Rendering sync: canvas + DOM mirror.
  function rerender() {
    if (!session) return;
    var st = session.state;
    var la = W.legalActions(st);
    var isHuman = session.hosted ? (st.current === session.seat && st.pendingSuitFor === null) : humanTurn();
    var myHand = session.hosted ? session.seat : 0;

    if (UI.isReady()) {
      // The board is drawn from this seat's perspective: only our own hand is
      // face up, and we always sit at the bottom of the table.
      UI.renderState(st, {
        legalPlays: isHuman ? la.plays : [],
        onTurn: isHuman,
        selectedCardId: selectedCardId,
        mySeat: myHand
      });
    }

    // DOM hand mirror (accessible, canvas-independent).
    var list = $("hand-list");
    list.innerHTML = "";
    var hand = st.hands[myHand] || [];
    hand.forEach(function (card, i) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "card-btn suit-" + card.suit;
      b.textContent = W.rankName(card.rank) + " " + suitGlyph(card.suit);
      b.setAttribute("aria-label", W.cardName(card) + (la.plays.indexOf(card.id) >= 0 && isHuman ? ", playable" : ""));
      if (isHuman && la.plays.indexOf(card.id) >= 0) b.classList.add("legal");
      if (card.id === selectedCardId) b.classList.add("selected");
      b.dataset.cardId = card.id;
      b.addEventListener("click", function () { onCardChosen(card.id); });
      li.appendChild(b);
      list.appendChild(li);
    });

    // HUD text.
    var names = seatNames();
    var turnName = st.winner !== null ? "—" :
      st.pendingSuitFor !== null ? names[st.pendingSuitFor] + " declaring a suit" :
      names[st.current] + (st.current === myHand ? " (your turn)" : "");
    $("turn-text").textContent = "Turn: " + turnName + " · Top: " + topText(st) + " · Suit: " + st.activeSuit;
    $("objective-text").textContent = objectiveText();
    $("opponents-text").textContent = st.hands.map(function (h, i) {
      return i === myHand ? null : names[i] + ": " + h.length;
    }).filter(Boolean).join(" · ");
    $("suit-banner").textContent = st.activeSuit ? "Active suit: " + suitGlyph(st.activeSuit) + " " + st.activeSuit : "";
    $("btn-draw").disabled = !isHuman;
    $("btn-undo").disabled = !(session.mode === "practice" && !session.noUndo && session.undoStack.length > 0 && !session.hosted);
    $("btn-hint").disabled = !isHuman;

    // Tutorial panel (auto-skip a lesson whose action is currently impossible).
    if (session.tutorialStep >= 0 && session.tutorialStep < C.TUTORIAL.length) {
      var t = C.TUTORIAL[session.tutorialStep];
      if (t.require === "eight" && isHuman && !hand.some(function (c) { return c.rank === 8; })) {
        session.tutorialStep++;
        t = C.TUTORIAL[session.tutorialStep];
      }
      if (!t) {
        // The last lesson was auto-skipped as impossible: close out the course.
        $("tutorial-panel").hidden = true;
        if (!save.settings.tutorialDone) { save.settings.tutorialDone = true; persist(); }
      } else {
        $("tutorial-panel").hidden = false;
        $("tutorial-panel").dataset.require = t.require;
        $("tutorial-title").textContent = t.title;
        $("tutorial-body").textContent = t.body;
        $("tutorial-progress").textContent = "Lesson " + (session.tutorialStep + 1) + " of " + C.TUTORIAL.length;
      }
    } else {
      $("tutorial-panel").hidden = true;
    }
  }

  function seatNames() {
    if (!session || !session.hosted) return ["You", "Rival 1", "Rival 2", "Rival 3"];
    if (session.names) return session.names;
    var n = [];
    for (var i = 0; i < (session.state ? session.state.players : 4); i++) n.push("Player " + (i + 1));
    return n;
  }

  function suitGlyph(suit) {
    return { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" }[suit] || suit;
  }
  function topText(st) {
    var top = st.discardPile[st.discardPile.length - 1];
    return top ? W.rankName(top.rank) + suitGlyph(top.suit) : "—";
  }
  function objectiveText() {
    if (!session) return "";
    if (session.state.winner !== null) return "Round over.";
    var base = "Empty your hand first.";
    if (session.moveLimit) base += " Move limit: " + session.state.moveCount + "/" + session.moveLimit + ".";
    if (session.mode === "daily") base = "Daily seed · " + base;
    if (session.stageId) base = "Stage " + session.stageId.slice(1) + " · " + base;
    return base;
  }

  // ---------------------------------------------------------------------------
  // Human actions.
  var selectedCardId = null;
  var lastCmdId = 0;
  var pendingCmdIds = {}; // idempotent double-commit guard

  function commit(cmd) {
    if (!session || session.over) return;
    var id = ++lastCmdId;
    if (pendingCmdIds[id]) return;
    pendingCmdIds[id] = true;

    if (session.hosted) { hostedSend({ type: "cmd", cmd: cmd, cmdId: id }); return; }

    // Local: snapshot for undo (practice only, human moves only).
    if (session.mode === "practice" && !session.noUndo && session.state.current === 0) {
      session.undoStack.push(JSON.stringify(W.serialize(session.state)));
      if (session.undoStack.length > 40) session.undoStack.shift();
    }
    var r = W.applyCommand(session.state, cmd);
    delete pendingCmdIds[id];
    if (r.error) {
      A.play("error");
      announce("Can't do that: " + (r.detail || r.error), true);
      flashInvalid();
      return;
    }
    session.commands.push(cmd);
    if (cmd.type === "play") {
      var card = W.cardById(cmd.cardId);
      if (card.rank === 8) { session.eightsPlayed++; A.play("eight"); }
      else A.play("play");
      selectedCardId = null;
      UI.playEvents(r.events, session.state);
      if (session.state.pendingSuitFor === 0) { openSuitPicker(); rerender(); return; }
    } else if (cmd.type === "draw") {
      A.play("draw");
    } else if (cmd.type === "declareSuit") {
      A.play("confirm");
    }
    advanceTutorial(cmd);
    runAI();
    rerender();
    announceTurn();
  }

  function onCardChosen(cardId) {
    if (!humanTurn() && !(session && session.hosted && session.state.current === session.seat)) {
      announce("Not your turn yet.", true);
      return;
    }
    var la = W.legalActions(session.state);
    if (la.plays.indexOf(cardId) < 0) {
      A.play("error");
      var card = W.cardById(cardId);
      announce("Can't play " + W.cardName(card) + ": must match " + session.state.activeSuit + " or rank " + W.rankName(session.state.discardPile[session.state.discardPile.length - 1].rank) + ", or play an 8.", true);
      return;
    }
    A.play("confirm");
    commit({ type: "play", cardId: cardId });
  }

  function drawCard() {
    if (!humanTurn() && !(session && session.hosted && session.state.current === session.seat)) return;
    commit({ type: "draw" });
  }

  function announceTurn() {
    if (!session) return;
    var st = session.state;
    if (st.winner !== null) return;
    if (st.pendingSuitFor === (session.hosted ? session.seat : 0)) { announce("You played an 8. Declare a suit."); return; }
    if ((session.hosted ? st.current === session.seat : st.current === 0)) {
      A.play("turn");
      var la = W.legalActions(st);
      announce(la.plays.length ? "Your turn. " + la.plays.length + " playable card" + (la.plays.length > 1 ? "s" : "") + "." : "Your turn. No playable cards — draw.");
    }
  }

  function flashInvalid() {
    var el = $("hand-list");
    el.classList.remove("invalid-flash");
    void el.offsetWidth;
    el.classList.add("invalid-flash");
  }

  // Hint: use the same legal-action API as play.
  function hint() {
    if (!session || session.over) return;
    var st = session.state;
    var isHuman = session.hosted ? st.current === session.seat : st.current === 0;
    if (!isHuman || st.pendingSuitFor !== null) return;
    var la = W.legalActions(st);
    session.hintsUsed++;
    if (la.plays.length === 0) { announce("Hint: draw from the stock.", true); return; }
    var hand = st.hands[session.hosted ? session.seat : 0];
    var best = null, bestPts = -1;
    hand.forEach(function (c) {
      if (la.plays.indexOf(c.id) >= 0 && W.cardPoints(c) > bestPts && c.rank !== 8) { best = c; bestPts = W.cardPoints(c); }
    });
    if (!best) best = W.cardById(la.plays[0]);
    selectedCardId = best.id;
    announce("Hint: try the " + W.cardName(best) + ".", true);
    rerender();
  }

  function undo() {
    if (!session || session.mode !== "practice" || session.noUndo || session.hosted) return;
    var snap = session.undoStack.pop();
    if (!snap) return;
    session.state = W.deserialize(JSON.parse(snap));
    // serialize() carries no AI settings, so restore the round's difficulty —
    // otherwise an undo silently drops Relaxed/Expert rivals back to Regular.
    if (session.options && session.options.difficulty != null) session.state.difficulty = session.options.difficulty;
    // Drop the commands that happened after this snapshot.
    session.commands.length = Math.max(0, session.commands.length - 1);
    session.over = false;
    A.play("select");
    rerender();
    announce("Undone.");
  }

  // ---------------------------------------------------------------------------
  // Suit picker.
  function openSuitPicker() {
    var grid = $("suit-grid");
    grid.innerHTML = "";
    // Offer suits ordered by how many cards the human holds (best first).
    var hand = session.state.hands[session.hosted ? session.seat : 0];
    var counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    hand.forEach(function (c) { counts[c.suit]++; });
    W.SUITS.slice().sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (suit) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "suit-btn suit-" + suit;
      b.innerHTML = suitGlyph(suit) + "<span>" + suit + " (" + counts[suit] + ")</span>";
      b.addEventListener("click", function () {
        show("game", false);
        screenStack = [];
        commit({ type: "declareSuit", suit: suit });
      });
      grid.appendChild(b);
    });
    show("suit", false);
    announce("You played an 8. Declare a suit.", true);
  }

  // ---------------------------------------------------------------------------
  // Tutorial progression.
  function advanceTutorial(cmd) {
    if (!session || session.tutorialStep < 0) return;
    var step = C.TUTORIAL[session.tutorialStep];
    if (!step) return;
    var done =
      (step.require === "play" && cmd.type === "play" && W.cardById(cmd.cardId).rank !== 8) ||
      (step.require === "eight" && cmd.type === "play" && W.cardById(cmd.cardId).rank === 8) ||
      (step.require === "draw" && cmd.type === "draw") ||
      (step.require === "finish" && session.state.winner !== null);
    if (done) {
      session.tutorialStep++;
      if (session.tutorialStep >= C.TUTORIAL.length) {
        save.settings.tutorialDone = true;
        persist();
        announce("Tutorial complete!");
      } else {
        announce("Lesson complete. Next: " + C.TUTORIAL[session.tutorialStep].title);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Round end, scoring, achievements, progression.
  function finishRound() {
    var st = session.state;
    var mySeat = session.hosted ? session.seat : 0;
    var won = st.winner === mySeat;
    A.play(won ? "win" : "lose");
    UI.playEvents([{ type: "win" }], st);

    // Records & progression (local modes only; hosted results are server's).
    var elapsed = Date.now() - session.startedAt;
    if (!session.hosted) {
      save.records.roundsPlayed++;
      if (won) {
        save.records.roundsWon++;
        save.streak++;
        save.bestStreak = Math.max(save.bestStreak, save.streak);
        save.records.bestScore = Math.max(save.records.bestScore, st.score ? st.score.total : 0);
      } else {
        save.streak = 0;
      }
      if (session.mode === "journey" && session.stageId && won) {
        var j = save.journey[session.stageId] || {};
        j.won = true;
        j.bestMoves = j.bestMoves ? Math.min(j.bestMoves, st.moveCount) : st.moveCount;
        save.journey[session.stageId] = j;
      }
      if (session.mode === "daily") {
        var day = new Date(nowMs()).toISOString().slice(0, 10);
        if (save.dailyDays.indexOf(day) < 0) save.dailyDays.push(day);
      }
      checkAchievements(won);
      persist();
    }

    // Fill results screen.
    var resultNames = seatNames();
    $("results-headline").textContent = won ? "You win the round!" :
      (session.hosted ? resultNames[st.winner] : "Rival " + st.winner) + " wins the round.";
    var tbody = $("results-table").querySelector("tbody");
    tbody.innerHTML = "";
    (st.score ? st.score.breakdown : []).forEach(function (row) {
      var tr = document.createElement("tr");
      var who = row.player === st.winner ? resultNames[row.player] + " ★" : resultNames[row.player];
      tr.innerHTML = "<td></td><td>" + row.cards + "</td><td>" + row.points + "</td>";
      tr.firstChild.textContent = who;
      tbody.appendChild(tr);
    });
    $("results-total").textContent = st.score ? st.score.total : 0;
    var extra = [];
    extra.push("Ended: " + (st.terminalReason === "empty-hand" ? "a hand was emptied" : "stock exhausted"));
    extra.push("your moves: " + st.moveCount);
    if (session.moveLimit) extra.push(st.moveCount <= session.moveLimit && won ? "move limit met ✓" : "move limit: " + session.moveLimit);
    extra.push("invalid actions: " + st.invalidActions);
    extra.push("time: " + Math.round(elapsed / 1000) + "s");
    extra.push("seed: " + session.replaySeed);
    $("results-extra").textContent = extra.join(" · ");

    var newAch = pendingAchievements.slice();
    pendingAchievements = [];
    $("results-achievements").textContent = newAch.length ? "Unlocked: " + newAch.join(", ") : "";

    // Next-stage button only in journey with a following stage.
    var nextBtn = $("btn-next-stage");
    if (session.mode === "journey" && session.stageId && won) {
      var idx = parseInt(session.stageId.slice(1), 10);
      nextBtn.hidden = idx >= C.JOURNEY.length;
    } else nextBtn.hidden = true;

    setTimeout(function () { show("results"); }, save.settings.reducedMotion ? 100 : 900);
  }

  var pendingAchievements = [];
  function unlock(id) {
    if (save.achievements[id]) return;
    save.achievements[id] = true;
    var meta = C.ACHIEVEMENTS.filter(function (a) { return a.id === id; })[0];
    pendingAchievements.push(meta ? meta.name : id);
    announce("Achievement unlocked: " + (meta ? meta.name : id));
  }
  function checkAchievements(won) {
    if (won) unlock("first_win");
    if (won && session.eightsPlayed >= 3) unlock("eight_master");
    if (save.streak >= 3) unlock("streak_3");
    var journeyWins = Object.keys(save.journey).filter(function (k) { return save.journey[k].won; }).length;
    if (journeyWins >= 20) unlock("journey_20");
    if (journeyWins >= C.JOURNEY.length) unlock("journey_all");
    if (save.dailyDays.length >= 7) unlock("daily_7");
    if (won && session.state.invalidActions === 0 && session.hintsUsed === 0) unlock("pacifist");
  }

  // ---------------------------------------------------------------------------
  // Mode start flows.
  function startLearn() {
    newLocalSession("learn", { players: 2, difficulty: 0, handSize: 5 }, { seed: 1337 });
    enterGame();
    announce("Lesson 1: " + C.TUTORIAL[0].title);
  }
  function startPractice(players, difficulty) {
    newLocalSession("practice", { players: players, difficulty: difficulty });
    enterGame();
  }
  function startDaily() {
    var seed = W.dailySeed(new Date(nowMs()));
    newLocalSession("daily", { players: 4, difficulty: 1 }, { seed: seed });
    enterGame();
  }
  function startJourneyStage(stage) {
    newLocalSession("journey", {
      players: stage.players, difficulty: stage.difficulty,
      handSize: stage.handSize, moveLimit: stage.moveLimit
    }, { seed: stage.seed, stageId: stage.id, mastery: stage.mastery });
    enterGame();
  }
  function startChallenge(ch) {
    newLocalSession("challenge", {
      players: ch.players, difficulty: ch.difficulty,
      handSize: ch.handSize, moveLimit: ch.moveLimit, noUndo: ch.noUndo
    }, { seed: ch.seed });
    enterGame();
  }

  function enterGame() {
    selectedCardId = null;
    screenStack = [];
    show("game", false);
    if (UI.isReady()) UI.resize();
    runAI();
    rerender();
    announceTurn();
  }

  function restartRound() {
    if (!session) return;
    var seed = session.replaySeed;
    var opts = session.options;
    newLocalSession(session.mode, opts, { seed: seed, stageId: session.stageId });
    enterGame();
  }

  function playAgain() {
    if (!session) { show("title"); return; }
    if (session.hosted) { leaveHosted(); show("title"); return; }
    if (session.mode === "daily" || session.mode === "journey" || session.mode === "challenge") restartRound();
    else {
      newLocalSession(session.mode, session.options);
      enterGame();
    }
  }

  // ---------------------------------------------------------------------------
  // Hosted play.
  //
  // Three modes, chosen once per page load:
  //  - "rooms":  on-platform (launch token present). StarHermit realtime rooms,
  //    host-routed: the host client runs the same deterministic engine as solo
  //    play, guests send their existing command messages over the room binary
  //    channel, and the host broadcasts authoritative snapshots. Lobby,
  //    matchmaking, invites and reconnect use the documented rooms REST
  //    endpoints. The game's JSON messages are carried as-is; game logic is
  //    not redesigned.
  //  - "local":  no token on a non-platform host (npm start / static hosting).
  //    The game's own dev server (server.js) owns tables over its /ws JSON
  //    protocol. This path is the pre-platform behavior, kept intact.
  //  - "unavailable": on a starhermit host with no token there is nothing to
  //    talk to, so hosted tables say so honestly instead of dialing a
  //    fabricated endpoint.
  function hostedKind() {
    if (onPlatform) return "rooms";
    if (onStarhermitHost) return "unavailable";
    return "local";
  }
  function hostedError(msg) { $("hosted-error").textContent = msg; }
  function hostedUnavailable() {
    $("hosted-join").hidden = true;
    $("hosted-lobby").hidden = true;
    hostedError("Online tables aren't available for this launch. Practice, Journey, Daily and Challenges are fully playable.");
  }
  // Entering the hosted screen: per-kind controls, invite inbox, reconnect.
  function hostedScreenShown() {
    var kind = hostedKind();
    $("btn-quick-join").hidden = kind !== "rooms";
    if (kind === "unavailable") hostedUnavailable();
    else if (kind === "rooms") {
      hostedError("");
      startInvitePoll();
      roomMaybeReconnect();
    }
  }

  function hostTable() {
    var kind = hostedKind();
    if (kind === "rooms") return roomHostTable();
    if (kind === "local") return localHostTable();
    hostedUnavailable();
  }
  function joinTable(code) {
    var kind = hostedKind();
    if (kind === "rooms") return roomJoinTable(code);
    if (kind === "local") return localJoinTable(code);
    hostedUnavailable();
  }
  function leaveHosted() {
    if (hostedKind() === "rooms") return roomLeaveTable();
    localLeaveHosted();
  }
  function startHostedRound() {
    if (hostedKind() === "rooms") return roomStart();
    localSend({ type: "start" });
  }
  // commit() funnels hosted moves through here: guests forward their command,
  // the rooms host applies its own directly (it is the authority).
  function hostedSend(o) {
    if (hostedKind() === "rooms") {
      if (o.type === "cmd") roomSendCmd(o.cmd, o.cmdId);
      return;
    }
    localSend(o);
  }

  // --- local dev host (server.js, /ws JSON protocol) --------------------------
  var localWs = null;
  var localState = { code: null, seat: null, connected: false };

  function localWsUrl() {
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    return proto + location.host + "/ws";
  }
  function localConnect(onOpen) {
    if (localWs && localWs.readyState === 1) { onOpen(); return; }
    try { localWs = new WebSocket(localWsUrl()); } catch (e) { hostedError("WebSocket unavailable."); return; }
    localWs.onopen = onOpen;
    localWs.onmessage = localMessage;
    localWs.onerror = function () { hostedError("Connection problem."); };
    localWs.onclose = function () {
      localState.connected = false;
      if (session && session.hosted && !session.over) {
        announce("Disconnected. Rejoin with your table code to resume.", true);
      }
    };
  }
  function localSend(o) {
    if (localWs && localWs.readyState === 1) localWs.send(JSON.stringify(o));
  }

  function localMessage(ev) {
    var m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === "error") { hostedError(m.error); announce(m.error, true); return; }
    if (m.type === "hosted" || m.type === "joined") {
      localState.code = m.code; localState.seat = m.seat; localState.connected = true;
      save.hosted = { code: m.code, name: localState.name };
      persist();
      $("lobby-code").textContent = m.code;
      $("hosted-join").hidden = true;
      $("hosted-lobby").hidden = false;
      updateLobby(m.players || []);
      return;
    }
    if (m.type === "lobby") { updateLobby(m.players || []); return; }
    if (m.type === "state") {
      // Fresh authoritative snapshot (reconnect source of truth).
      if (!session || !session.hosted) {
        session = {
          mode: "hosted", hosted: true, seat: m.yourSeat,
          state: null, undoStack: [], commands: [], over: false,
          moveLimit: null, stageId: null, tutorialStep: -1,
          eightsPlayed: 0, hintsUsed: 0, startedAt: Date.now(),
          replaySeed: m.snapshot.seed, options: {}
        };
        screenStack = [];
        show("game", false);
      }
      var prevTick = session.state ? session.state.tick : -1;
      session.state = W.deserialize(m.snapshot, m.yourSeat);
      session.over = session.state.winner !== null;
      if (m.away && m.away.length) announce("While you were away: " + m.away.join(" "), true);
      if (m.events) UI.playEvents(m.events, session.state);
      rerender();
      // The server holds the round until this seat declares a suit, so the
      // picker has to be driven from the authoritative snapshot too.
      if (!session.over && session.state.pendingSuitFor === session.seat) {
        openSuitPicker();
        return;
      }
      if (currentScreen === "suit" && session.state.pendingSuitFor !== session.seat) show("game", false);
      if (!session.over) announceTurn();
      else if (prevTick >= 0) finishRound();
      return;
    }
  }

  function updateLobby(players) {
    var ul = $("lobby-players");
    ul.innerHTML = "";
    players.forEach(function (p) {
      var li = document.createElement("li");
      li.textContent = p.name + (p.seat === localState.seat ? " (you)" : "") + (p.ai ? " · AI" : "");
      ul.appendChild(li);
    });
    $("lobby-status").textContent = players.length + " seated · host starts the round; empty seats are filled by AI.";
  }

  function localDisplayName(fallback) {
    // Hosted tables seat named players: the account nickname when known.
    return myName || fallback;
  }
  function localHostTable() {
    var name = localDisplayName("Player-" + Math.floor(Math.random() * 900 + 100));
    localState.name = name;
    localConnect(function () { localSend({ type: "host", name: name }); });
  }
  function localJoinTable(code) {
    var name = (save.hosted && save.hosted.code === code && save.hosted.name) ||
      localDisplayName("Player-" + Math.floor(Math.random() * 900 + 100));
    localState.name = name;
    localConnect(function () { localSend({ type: "join", code: code, name: name }); });
  }
  function localLeaveHosted() {
    localSend({ type: "leave" });
    if (localWs) { try { localWs.close(); } catch (e) {} localWs = null; }
    localState = { code: null, seat: null, connected: false };
    $("hosted-join").hidden = false;
    $("hosted-lobby").hidden = true;
  }

  // --- StarHermit realtime rooms (host-routed) --------------------------------
  var room = null;
  // room = { id, code, ws, isHost, myKey, mySeat, hostKey, connected, started,
  //          seatKeys: [participantKey per seat], names: {seat: name},
  //          hello: {key: name}, state, lastCmdId: {seat: cmdId},
  //          awayLog: {seat: [text]} }

  function encId(s) { return encodeURIComponent(String(s)); }
  function bytesToHex(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function indexOfStr(arr, v) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === v) return i;
    return -1;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  // Tolerant readers: the platform wraps payloads in a few common shapes.
  function roomJoinInfo(j) {
    j = j || {};
    var roomObj = j.room || j;
    var part = j.participant || j.you || j.me || (roomObj.participant) || {};
    var id = roomObj.id || roomObj.roomId || j.roomId || null;
    var key = j.participantId || j.yourParticipantId || part.id || part.participantId || null;
    var seat = j.seat != null ? j.seat : (j.yourSeat != null ? j.yourSeat : part.seat);
    return {
      id: id,
      code: roomObj.code || roomObj.shortCode || null,
      key: key == null ? null : String(key),
      seat: seat == null ? null : +seat,
      isHost: !!(j.isHost || j.host === true || part.isHost)
    };
  }
  function roomRosterEntry(p) {
    if (p == null) return null;
    if (typeof p === "string") return { key: p };
    var key = p.id || p.participantId || p.key;
    if (key == null) return null;
    return {
      key: String(key),
      userId: p.userId != null ? String(p.userId) : null,
      seat: p.seat != null ? +p.seat : null,
      name: p.nickname || p.name || null, // never usernames
      isHost: !!(p.isHost || p.host),
      connected: p.connected !== false
    };
  }
  function roomListOf(j, keys) {
    if (!j) return null;
    for (var i = 0; i < keys.length; i++) {
      var v = j[keys[i]];
      if (Array.isArray(v)) return v;
    }
    return Array.isArray(j) ? j : null;
  }

  function roomWsUrl(id) {
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    return proto + location.host + "/ws/v1/realtime?roomId=" + encId(id) +
      "&access_token=" + encId(PL.authToken());
  }

  function roomApiJson(path, opts) {
    return PL.api(path, opts).then(function (r) {
      if (!r.ok) { var e = new Error("http " + r.status); e.status = r.status; throw e; }
      return r.json().catch(function () { return null; });
    });
  }

  function roomHostTable() {
    if (room) return;
    hostedError("");
    roomApiJson("/api/v1/realtime/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          teamCount: 1, seatsPerTeam: 4,
          metadata: { gameSlug: PL.gameKey, name: myName }
        }
      })
    }).then(function (j) {
      var info = roomJoinInfo(j);
      if (!info.id) throw new Error("bad-room");
      // A fresh table must be opened before quick-join can pair players in.
      return PL.api("/api/v1/realtime/rooms/" + encId(info.id) + "/open", { method: "POST" })
        .then(function () { return info; });
    }).then(function (info) {
      roomEnter(info, true);
    }).catch(function () {
      hostedError("Couldn't create a table. Try again.");
    });
  }

  function roomJoinTable(code) {
    if (room) return;
    hostedError("");
    var body = { gameSlug: PL.gameKey, seats: 1 };
    if (code) { body.code = code; body.roomId = code; }
    roomApiJson("/api/v1/realtime/rooms/quick-join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (j) {
      var info = roomJoinInfo(j);
      if (!info.id) throw new Error("bad-room");
      roomEnter(info, info.isHost);
    }).catch(function (e) {
      if (e && e.status === 404 && !code) return roomHostTable(); // no open table: make one
      hostedError(e && e.status === 404 ? "No table with that code." :
        "Couldn't join the table. Try again.");
    });
  }

  function roomEnter(info, isHost) {
    room = {
      id: info.id, code: info.code || String(info.id).slice(0, 6),
      ws: null, isHost: !!isHost, myKey: info.key,
      mySeat: isHost ? 0 : (info.seat != null && info.seat >= 0 ? info.seat : null),
      // The authoritative host/guest keys arrive with the first roster push.
      hostKey: null,
      connected: false, started: false,
      seatKeys: [], names: {}, hello: {}, state: null,
      lastCmdId: {}, awayLog: {}
    };
    if (isHost) room.names[0] = myName || "You";
    var ws;
    try { ws = new WebSocket(roomWsUrl(room.id)); }
    catch (e) { hostedError("WebSocket unavailable."); room = null; return; }
    room.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = function () {
      room.connected = true;
      $("lobby-code").textContent = room.code;
      $("hosted-join").hidden = true;
      $("hosted-lobby").hidden = false;
      $("btn-start-hosted").hidden = !room.isHost;
      $("btn-invite-friend").hidden = !room.isHost;
      if (!room.isHost) roomSend({ t: "hello", name: myName }); // host labels our seat
      if (room.isHost) roomBroadcastLobby();
    };
    ws.onmessage = roomMessage;
    ws.onerror = function () { hostedError("Connection problem."); };
    ws.onclose = function () {
      if (!room) return;
      room.connected = false;
      if (session && session.hosted && !session.over) announce("Disconnected from the table.", true);
    };
  }

  function roomLeaveTable(quiet) {
    stopInvitePoll();
    if (!room) {
      $("hosted-join").hidden = false;
      $("hosted-lobby").hidden = true;
      return;
    }
    var id = room.id, ws = room.ws;
    room = null;
    if (ws) { try { ws.close(); } catch (e) {} }
    PL.api("/api/v1/realtime/rooms/" + encId(id) + "/leave", { method: "POST" }).catch(function () {});
    $("hosted-join").hidden = false;
    $("hosted-lobby").hidden = true;
    $("hosted-error").textContent = "";
    if (!quiet) announce("Left the table.");
  }

  function roomSend(o) {
    if (!room || !room.ws || room.ws.readyState !== 1) return;
    var data;
    try { data = JSON.stringify(o); } catch (e) { return; }
    if (data.length > 7500) return; // 8 KB frame cap
    // Game frames ride the binary channel; the server prefixes the sender id.
    room.ws.send(new TextEncoder().encode(data));
  }
  function roomSendCmd(cmd, cmdId) {
    if (!room) return;
    if (room.isHost) roomHostCmd(0, cmd, cmdId); // our own move: apply directly
    else roomSend({ t: "cmd", cmd: cmd, cmdId: cmdId });
  }

  function roomMessage(ev) {
    if (!room) return;
    if (typeof ev.data === "string") { roomControl(ev.data); return; }
    // Binary frame: first 16 bytes are the sender's participant id.
    var buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : null;
    if (!buf || buf.byteLength <= 16) return;
    var sender = bytesToHex(buf.subarray(0, 16));
    var msg = null;
    try { msg = JSON.parse(new TextDecoder().decode(buf.subarray(16))); } catch (e) { return; }
    if (!msg || typeof msg !== "object") return;
    if (room.isHost) roomHostFrame(sender, msg);
    else roomGuestFrame(msg);
  }

  function roomControl(text) {
    var m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== "object") return;
    if (m.error || m.type === "error") {
      hostedError(String(m.error || m.message || "Connection problem."));
      return;
    }
    var roster = roomListOf(m, ["participants", "roster", "players", "seats"]);
    if (roster) roomRoster(roster);
  }

  function roomRoster(roster) {
    var entries = [];
    for (var i = 0; i < roster.length; i++) {
      var e = roomRosterEntry(roster[i]);
      if (e) entries.push(e);
    }
    if (!entries.length || !room) return;
    if (!room.isHost) return roomGuestRoster(entries);

    // --- host: seat assignment ------------------------------------------------
    var prev = room.seatKeys;
    if (!prev.length) {
      // Resolve the host's WIRE key from the roster — the REST-time
      // participant id may differ from the realtime participant key.
      var hostKey = (room.myKey && indexOfStr(entries.map(function (x) { return x.key; }), room.myKey) >= 0)
        ? room.myKey : (entries[0].isHost ? entries[0].key : (room.myKey || entries[0].key));
      room.hostKey = hostKey;
      if (room.myKey == null) room.myKey = hostKey;
      prev = room.seatKeys = [hostKey, null, null, null];
    }
    var present = {};
    entries.forEach(function (x) { present[x.key] = x; });
    // Removed players: unstarted tables close the seat; started tables hand it to AI.
    prev.forEach(function (k, seat) {
      if (k && !present[k]) {
        var nm = room.names[seat] || ("Player " + (seat + 1));
        if (room.started) {
          (room.awayLog[seat] = room.awayLog[seat] || []).push(nm + " left the table.");
          roomRunAIAndSnap(); // AI takes the seat's turn immediately
        }
        room.seatKeys[seat] = null;
        delete room.names[seat];
      }
    });
    // Newcomers (explicit seat, else the lowest free guest seat).
    entries.forEach(function (x) {
      if (indexOfStr(room.seatKeys, x.key) >= 0) return;
      var seat = x.seat;
      if (seat == null || seat < 0 || seat > 3 || room.seatKeys[seat]) {
        seat = -1;
        for (var s = 1; s < 4; s++) if (!room.seatKeys[s]) { seat = s; break; }
      }
      if (seat < 0) return; // full table: ignore (spectator)
      room.seatKeys[seat] = x.key;
      if (x.name) room.names[seat] = x.name;
      else if (x.userId) {
        PL.getProfile(x.userId).then(function (p) {
          if (!room || !p) return;
          room.names[seat] = PL.displayName(p);
          roomBroadcastLobby();
        });
      }
      if (room.started && room.state) {
        (room.awayLog[seat] = room.awayLog[seat] || []).push((room.names[seat] || ("Player " + (seat + 1))) + " joined the table.");
      }
      if (room.hello[x.key]) room.names[seat] = room.names[seat] || room.hello[x.key];
    });
    roomBroadcastLobby();
    if (room.started && room.state) roomBroadcastSnap([]);
  }

  function roomGuestRoster(entries) {
    // Guests track the host and learn their own seat if the join response
    // didn't spell it out (seat arrives with the first snapshot's seats map).
    var known = {};
    entries.forEach(function (x) { known[x.key] = true; });
    var hostE = null;
    for (var i = 0; i < entries.length; i++) if (entries[i].isHost) { hostE = entries[i]; break; }
    if (!hostE) hostE = entries[0];
    if (hostE && room.hostKey == null) room.hostKey = hostE.key;
    var present = {};
    entries.forEach(function (x) { present[x.key] = true; });
    if (room.hostKey && !present[room.hostKey] && room.started) {
      announce("The host left — the table is closed.", true);
      roomLeaveTable();
      return;
    }
    // The REST-time participant id may not match the wire key: only trust a
    // key the roster actually knows, else fall back to the newest non-host.
    if (room.myKey != null && !known[room.myKey]) room.myKey = null;
    if (room.myKey == null) {
      var others = entries.filter(function (x) { return x.key !== room.hostKey; });
      if (others.length) room.myKey = others[others.length - 1].key; // newest join is us
    }
    if (room.mySeat == null && room.myKey != null && room.snapSeats) {
      var s = indexOfStr(room.snapSeats, room.myKey);
      if (s >= 0) room.mySeat = s;
    }
  }

  function roomHostFrame(sender, m) {
    if (!room || !room.isHost) return;
    if (m.t === "hello") {
      room.hello[sender] = String(m.name || "").slice(0, 24) || null;
      var seat = indexOfStr(room.seatKeys, sender);
      if (seat >= 0) {
        room.names[seat] = room.hello[sender] || room.names[seat];
        roomBroadcastLobby();
      }
      return;
    }
    if (m.t === "cmd") roomHostCmd(indexOfStr(room.seatKeys, sender), m.cmd, m.cmdId);
  }

  function roomGuestFrame(m) {
    if (!room) return;
    if (m.t === "lobby") {
      if (m.names) room.names = m.names;
      updateRoomLobby(m.players || []);
      return;
    }
    if (m.t === "snap") roomApplySnap(m, null);
  }

  function roomSeatList() {
    var players = [];
    for (var seat = 0; seat < 4; seat++) {
      var key = room.seatKeys[seat];
      if (key) players.push({ seat: seat, name: room.names[seat] || ("Player " + (seat + 1)), host: seat === 0, ai: false });
      else if (room.started) players.push({ seat: seat, name: "AI " + seat, host: false, ai: true });
    }
    return players;
  }
  function roomBroadcastLobby() {
    if (!room || !room.isHost) return;
    var players = roomSeatList();
    roomSend({ t: "lobby", players: players, names: room.names });
    updateRoomLobby(players);
  }
  function updateRoomLobby(players) {
    var ul = $("lobby-players");
    ul.innerHTML = "";
    players.forEach(function (p) {
      var li = document.createElement("li");
      li.textContent = p.name + (p.host ? " (host)" : "") +
        (room && p.seat === room.mySeat ? " (you)" : "") + (p.ai ? " · AI" : "");
      ul.appendChild(li);
    });
    var humans = players.filter(function (p) { return !p.ai; }).length;
    $("lobby-status").textContent = humans + " seated · host starts the round; empty seats are filled by AI.";
  }

  function roomStart() {
    if (!room || !room.isHost || room.started || !room.connected) return;
    room.started = true;
    room.state = W.newGame((Date.now() % 0x7fffffff) >>> 0, { players: 4, difficulty: 1 });
    room.lastCmdId = {};
    room.awayLog = {};
    roomBroadcastLobby();
    roomBroadcastSnap(roomRunAI());
  }

  function roomValidCmd(cmd) {
    if (!cmd || typeof cmd !== "object") return false;
    if (cmd.type === "play") return typeof cmd.cardId === "number" && cmd.cardId >= 0 && cmd.cardId <= 51;
    if (cmd.type === "declareSuit") return W.SUITS.indexOf(cmd.suit) >= 0;
    return cmd.type === "draw";
  }

  // Host authority: validate turn order and shape, apply, then let AI seats
  // (empty or vacated) act until a connected human must move or the round ends.
  function roomHostCmd(seat, cmd, cmdId) {
    if (!room || !room.isHost || !room.started || !room.state) return;
    var st = room.state;
    if (st.winner !== null) return;
    if (seat == null || seat < 0) return;
    if (typeof cmdId === "number") {
      if (room.lastCmdId[seat] === cmdId) return; // idempotent duplicate
      room.lastCmdId[seat] = cmdId;
    }
    var actor = st.pendingSuitFor !== null ? st.pendingSuitFor : st.current;
    if (actor !== seat) return; // out-of-turn: the authoritative host drops it
    if (!roomValidCmd(cmd)) return;
    var r = W.applyCommand(st, cmd);
    if (r.error) return;
    roomBroadcastSnap((r.events || []).concat(roomRunAI()));
    if (st.winner !== null) roomSubmitResult();
  }

  function roomRunAI() {
    var events = [];
    var st = room.state;
    var guard = 400;
    while (st && st.winner === null && guard-- > 0) {
      var actor = st.pendingSuitFor !== null ? st.pendingSuitFor : st.current;
      if (room.seatKeys[actor]) break; // a connected human owns this turn
      var cmd = W.aiCommand(st, st.difficulty);
      if (!cmd) break;
      var r = W.applyCommand(st, cmd);
      if (r.error) break;
      if (r.events) events = events.concat(r.events);
    }
    return events;
  }
  function roomRunAIAndSnap() {
    if (!room || !room.started || !room.state) return;
    if (room.state.winner !== null) return;
    roomBroadcastSnap(roomRunAI());
    if (room.state.winner !== null) roomSubmitResult();
  }

  // One authoritative state per tick; every client masks it locally to its own
  // seat (public hands), so no client ever receives another player's cards.
  function roomBroadcastSnap(events) {
    if (!room || !room.state) return;
    var frame = {
      t: "snap", state: W.serialize(room.state),
      events: events || [], away: room.awayLog,
      seats: room.seatKeys, names: room.names
    };
    room.awayLog = {};
    roomSend(frame);
    roomApplySnap(frame, 0); // the host's own view
  }

  function roomApplySnap(m, forcedSeat) {
    if (!room) return;
    var stFull;
    try { stFull = W.deserialize(m.state); } catch (e) { return; }
    if (m.seats) room.snapSeats = m.seats;
    // A wire-verified seat beats the REST-time hint when both exist.
    var mySeat = forcedSeat != null ? forcedSeat : null;
    if (mySeat == null && m.seats && room.myKey) {
      var fromWire = indexOfStr(m.seats, room.myKey);
      if (fromWire >= 0) mySeat = fromWire;
    }
    if (mySeat == null) mySeat = room.mySeat;
    if (mySeat == null || mySeat < 0) {
      hostedError("Couldn't take a seat at this table.");
      return;
    }
    room.mySeat = mySeat;
    var view = W.publicSnapshot(stFull, mySeat);
    if (!session || !session.hosted) {
      session = {
        mode: "hosted", hosted: true, seat: mySeat,
        state: null, undoStack: [], commands: [], over: false,
        moveLimit: null, stageId: null, tutorialStep: -1,
        eightsPlayed: 0, hintsUsed: 0, startedAt: Date.now(),
        replaySeed: view.seed, options: {}, names: null
      };
      screenStack = [];
      show("game", false);
    }
    var prevTick = session.state ? session.state.tick : -1;
    session.state = W.deserialize(view, mySeat);
    session.seat = mySeat;
    session.over = session.state.winner !== null;
    var names = [];
    var n = m.names || {};
    for (var i = 0; i < session.state.players; i++) names[i] = n[i] || ("Player " + (i + 1));
    names[mySeat] = "You";
    session.names = names;
    // Drawn card ids are private to the drawing seat.
    var events = (m.events || []).map(function (e) {
      if (e && e.type === "draw" && e.player !== mySeat && e.cardIds) {
        var copy = {};
        for (var k in e) copy[k] = e[k];
        delete copy.cardIds;
        return copy;
      }
      return e;
    });
    var away = (m.away && m.away[mySeat]) || [];
    if (away.length) announce("While you were away: " + away.join(" "), true);
    if (events.length) UI.playEvents(events, session.state);
    rerender();
    // The round waits while this seat declares a suit — drive the picker from
    // the authoritative snapshot, exactly like the local dev host does.
    if (!session.over && session.state.pendingSuitFor === session.seat) {
      openSuitPicker();
      return;
    }
    if (currentScreen === "suit" && session.state.pendingSuitFor !== session.seat) show("game", false);
    if (!session.over) announceTurn();
    else if (prevTick >= 0) finishRound();
  }

  function roomSubmitResult() {
    if (!room || !room.id || !room.state) return;
    PL.api("/api/v1/realtime/rooms/" + encId(room.id) + "/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner: room.state.winner, score: room.state.score, reason: room.state.terminalReason })
    }).catch(function () { /* result reporting is best-effort */ });
  }

  // Reconnect: a returning player re-attaches to their open room.
  function roomMaybeReconnect() {
    if (!onPlatform || room) return;
    roomApiJson("/api/v1/realtime/rooms/mine").then(function (j) {
      if (!j || room) return;
      var info = roomJoinInfo(j);
      if (!info.id) return;
      roomEnter(info, info.isHost || info.seat === 0);
    }).catch(function () {});
  }

  // Friend invites: host sends them from the lobby; the invite inbox is polled
  // while the hosted screen is up.
  var inviteTimer = null;
  function startInvitePoll() {
    if (!onPlatform) return;
    stopInvitePoll();
    inviteTimer = setInterval(pollInvites, 5000);
    pollInvites();
  }
  function stopInvitePoll() {
    if (inviteTimer) { clearInterval(inviteTimer); inviteTimer = null; }
  }
  function pollInvites() {
    PL.api("/api/v1/realtime/rooms/invites")
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (j) {
        var box = $("hosted-invites");
        if (!box) return;
        var list = roomListOf(j, ["invites", "items"]);
        if (!list || !list.length || room) { box.innerHTML = ""; return; }
        box.innerHTML = "<p class=\"muted\">Table invitations:</p>";
        list.slice(0, 5).forEach(function (inv) {
          var roomId = inv.roomId || inv.id || (inv.room && (inv.room.id || inv.room.roomId));
          var from = inv.from || inv.fromUserId || inv.userId || (inv.fromUser && inv.fromUser.id);
          var b = document.createElement("button");
          b.type = "button";
          b.className = "btn small";
          b.textContent = "Join table";
          b.addEventListener("click", function () { if (roomId) roomJoinTable(String(roomId)); });
          box.appendChild(b);
          if (from) {
            PL.getProfile(String(from)).then(function (p) {
              if (p) b.textContent = "Join " + PL.displayName(p) + "'s table";
            });
          }
        });
      })
      .catch(function () {});
  }
  function roomShowFriends() {
    if (!room || !room.isHost) return;
    PL.api("/api/v1/me/friends")
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (j) {
        var box = $("lobby-friends");
        if (!box) return;
        var list = roomListOf(j, ["friends", "items"]);
        if (!list || !list.length) { box.innerHTML = "<p class=\"muted\">No friends available to invite.</p>"; return; }
        box.innerHTML = "<p class=\"muted\">Invite a friend:</p>";
        list.slice(0, 10).forEach(function (f) {
          var fid = f.id || f.userId || f.friendId;
          if (fid == null) return;
          var b = document.createElement("button");
          b.type = "button";
          b.className = "btn small";
          b.textContent = "Invite " + (f.nickname || "friend");
          b.addEventListener("click", function () {
            PL.api("/api/v1/realtime/rooms/" + encId(room.id) + "/invites", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: fid })
            }).then(function (r) {
              b.disabled = r.ok;
              if (r.ok) b.textContent = "Invited ✓";
            }).catch(function () {});
          });
          box.appendChild(b);
          if (!f.nickname) {
            PL.getProfile(String(fid)).then(function (p) {
              if (p) b.textContent = "Invite " + PL.displayName(p);
            });
          }
        });
      })
      .catch(function () {});
  }

  // ---------------------------------------------------------------------------
  // Journey / records screens.
  function renderJourney() {
    var list = $("journey-list");
    list.innerHTML = "";
    var doneCount = 0;
    var unlocked = true; // stage 1 always unlocked; later stages need previous win
    C.JOURNEY.forEach(function (stage) {
      var prog = save.journey[stage.id];
      if (prog && prog.won) doneCount++;
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "journey-stage" + (prog && prog.won ? " won" : "") + (unlocked ? "" : " locked");
      b.disabled = !unlocked;
      b.innerHTML = "<strong>" + stage.index + "</strong><span>" + stage.name + "</span>" +
        "<em>" + (prog && prog.won ? "★ " + (prog.bestMoves || "–") + " moves" : unlocked ? "open" : "🔒") + "</em>";
      b.addEventListener("click", function () { startJourneyStage(stage); });
      li.appendChild(b);
      list.appendChild(li);
      unlocked = !!(prog && prog.won) || stage.index === 1;
      if (stage.index === 1) unlocked = true;
      else unlocked = !!(save.journey["j" + (stage.index - 1)] && save.journey["j" + (stage.index - 1)].won) || !!(prog && prog.won);
    });
    $("journey-summary").textContent = doneCount + " of " + C.JOURNEY.length + " stages complete.";
  }

  function renderChallenges() {
    var list = $("challenge-list");
    list.innerHTML = "";
    C.CHALLENGES.forEach(function (ch) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mode-card";
      b.innerHTML = "<strong>" + ch.name + "</strong><span>" + ch.desc + "</span><em>seed " + ch.seed + " · " + ch.players + " players</em>";
      b.addEventListener("click", function () { startChallenge(ch); });
      list.appendChild(b);
    });
  }

  function renderRecords() {
    var body = $("records-body");
    var ach = C.ACHIEVEMENTS.map(function (a) {
      var got = save.achievements[a.id];
      return "<li class=\"" + (got ? "got" : "") + "\">" + (got ? "★" : "☆") + " <strong>" + a.name + "</strong> — " + a.desc + "</li>";
    }).join("");
    body.innerHTML =
      "<p>Rounds played: " + save.records.roundsPlayed + " · won: " + save.records.roundsWon +
      " · best score: " + save.records.bestScore + " · best streak: " + save.bestStreak + "</p>" +
      "<p>Daily days played: " + save.dailyDays.length + "</p>" +
      "<h3>Achievements</h3><ul class=\"ach-list\">" + ach + "</ul>";
    var boardBox = $("records-board");
    if (boardBox) boardBox.innerHTML = "";
    if (onPlatform) renderPlatformBoard();
  }

  // Read-only platform boards (hosted only): the client can never submit.
  // Personal bests stay the local + cloud-saved records above.
  function renderPlatformBoard() {
    var box = $("records-board");
    if (!box) return;
    PL.gameInfo().then(function (g) {
      if (!g || !box) return;
      var html = "";
      var me = g.me;
      if (me && typeof me === "object") {
        var bits = [];
        ["rank", "score", "wins", "losses", "gamesPlayed", "bestScore"].forEach(function (k) {
          if (typeof me[k] === "number") bits.push(k + ": " + me[k]);
        });
        if (bits.length) html += "<p class=\"muted\">Platform record — " + bits.join(" · ") + "</p>";
      }
      box.innerHTML = html;
      var lbId = g.leaderboardId;
      if (!lbId) return;
      return PL.boardEntries(lbId, { pageSize: 10 }).then(function (j) {
        if (!box) return;
        var entries = roomListOf(j, ["entries", "items", "rows"]);
        if (!entries || !entries.length) return;
        var rows = entries.slice(0, 10).map(function (e, i) {
          var uid = e.userId != null ? e.userId : e.id;
          var score = e.score != null ? e.score : (e.value != null ? e.value : (e.points != null ? e.points : ""));
          return "<tr><td>" + esc(e.rank != null ? e.rank : i + 1) + "</td>" +
            "<td class=\"lb-name\" data-uid=\"" + esc(uid == null ? "" : uid) + "\">…</td>" +
            "<td>" + esc(score) + "</td></tr>";
        }).join("");
        box.innerHTML += "<h3>Leaderboard</h3><table class=\"score-table\"><thead>" +
          "<tr><th>#</th><th>Player</th><th>Score</th></tr></thead><tbody>" + rows + "</tbody></table>";
        // Resolve user ids to nicknames via the profile helper (never usernames).
        entries.slice(0, 10).forEach(function (e, i) {
          var uid = e.userId != null ? e.userId : e.id;
          if (uid == null) return;
          PL.getProfile(String(uid)).then(function (p) {
            var cell = box.querySelectorAll(".lb-name")[i];
            if (cell) cell.textContent = p ? PL.displayName(p) : "Player " + String(uid).slice(0, 8);
          });
        });
      });
    }).catch(function () { /* records are local-first; the board is a bonus */ });
  }

  // ---------------------------------------------------------------------------
  // Keyboard controls.
  document.addEventListener("keydown", function (ev) {
    if (currentScreen === "suit") {
      // The suit declaration is mandatory: dismissing it would strand the round
      // with pendingSuitFor set and no way back to the picker.
      if (ev.key === "Escape") ev.preventDefault();
      return;
    }
    if (currentScreen !== "game" || !session) {
      if (ev.key === "Escape" && currentScreen !== "title") back();
      return;
    }
    var st = session.state;
    var mySeat = session.hosted ? session.seat : 0;
    var hand = st.hands[mySeat] || [];
    var idx = hand.findIndex(function (c) { return c.id === selectedCardId; });
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      ev.preventDefault();
      if (!hand.length) return;
      var dir = ev.key === "ArrowRight" ? 1 : -1;
      idx = idx < 0 ? (dir > 0 ? 0 : hand.length - 1) : (idx + dir + hand.length) % hand.length;
      selectedCardId = hand[idx].id;
      A.play("select");
      rerender();
    } else if (ev.key === "Enter" || ev.key === " ") {
      if (selectedCardId !== null) { ev.preventDefault(); onCardChosen(selectedCardId); }
    } else if (ev.key === "d" || ev.key === "D") {
      drawCard();
    } else if (ev.key === "h" || ev.key === "H") {
      hint();
    } else if (ev.key === "u" || ev.key === "U") {
      undo();
    } else if (ev.key === "Escape") {
      show("pause");
    } else if (ev.key === "c" || ev.key === "C") {
      if (UI.isReady()) UI.resize(); // camera/framing reset
    }
  });

  // Gamepad: focus navigation + confirm/pause via standard mapping.
  var padPrev = {};
  function pollGamepad() {
    requestAnimationFrame(pollGamepad);
    if (!navigator.getGamepads) return;
    var pads = navigator.getGamepads();
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p) continue;
      var pressed = function (b) { return p.buttons[b] && p.buttons[b].pressed; };
      var key = function (b, k) {
        var now = pressed(b);
        if (now && !padPrev[i + ":" + b]) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
        }
        padPrev[i + ":" + b] = now;
      };
      key(14, "ArrowLeft"); key(15, "ArrowRight");
      key(0, "Enter"); key(1, "Escape"); key(9, "Escape");
      key(2, "d"); key(3, "h");
    }
  }
  requestAnimationFrame(pollGamepad);

  // ---------------------------------------------------------------------------
  // Wiring.
  function bind() {
    $("btn-play").addEventListener("click", function () {
      if (!save.settings.tutorialDone) startLearn();
      else { renderJourney(); show("modes"); }
    });
    $("btn-daily").addEventListener("click", startDaily);
    $("btn-journey").addEventListener("click", function () { renderJourney(); show("journey"); });
    $("btn-hosted").addEventListener("click", function () { show("hosted"); hostedScreenShown(); });
    $("btn-settings").addEventListener("click", function () { syncSettingsForm(); show("settings"); });
    $("btn-help").addEventListener("click", function () { show("help"); });
    $("btn-help-top").addEventListener("click", function () { show("help"); });
    $("btn-records").addEventListener("click", function () { renderRecords(); show("records"); });
    $("btn-sound").addEventListener("click", function () {
      save.settings.muted = !save.settings.muted;
      persist(); applySettings();
    });

    document.querySelectorAll(".mode-card").forEach(function (b) {
      b.addEventListener("click", function () {
        var mode = b.dataset.mode;
        if (mode === "learn") startLearn();
        else if (mode === "journey") { renderJourney(); show("journey"); }
        else if (mode === "daily") startDaily();
        else if (mode === "practice") show("setup");
        else if (mode === "challenge") { renderChallenges(); show("challenges"); }
        else if (mode === "hosted") { show("hosted"); hostedScreenShown(); }
      });
    });

    document.querySelectorAll(".back-btn").forEach(function (b) {
      b.addEventListener("click", back);
    });

    $("setup-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      startPractice(parseInt(f.players.value, 10), parseInt(f.difficulty.value, 10));
    });

    $("btn-draw").addEventListener("click", drawCard);
    $("btn-hint").addEventListener("click", hint);
    $("btn-undo").addEventListener("click", undo);
    $("btn-pause").addEventListener("click", function () { show("pause"); });
    $("btn-resume").addEventListener("click", function () { show("game", false); screenStack = []; });
    $("btn-restart-round").addEventListener("click", function () { if (!session || !session.hosted) restartRound(); });
    $("btn-quit").addEventListener("click", function () {
      if (session && session.hosted) leaveHosted();
      session = null;
      show("title", false); screenStack = [];
    });
    $("btn-pause-settings").addEventListener("click", function () { syncSettingsForm(); show("settings"); });
    $("btn-pause-help").addEventListener("click", function () { show("help"); });
    $("btn-again").addEventListener("click", playAgain);
    $("btn-next-stage").addEventListener("click", function () {
      if (!session || !session.stageId) return;
      var idx = parseInt(session.stageId.slice(1), 10);
      var next = C.JOURNEY[idx]; // 0-based: idx is next stage
      if (next) startJourneyStage(next);
    });
    $("btn-results-menu").addEventListener("click", function () { session = null; show("title", false); screenStack = []; });

    // Hosted.
    $("btn-host").addEventListener("click", hostTable);
    $("btn-quick-join").addEventListener("click", function () {
      if (hostedKind() === "rooms") roomJoinTable(null);
    });
    $("join-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var code = $("join-code").value.trim().toUpperCase();
      if (code.length < 3) { hostedError("Enter the table code."); return; }
      joinTable(code);
    });
    $("btn-start-hosted").addEventListener("click", startHostedRound);
    $("btn-leave-hosted").addEventListener("click", function () { leaveHosted(); });
    $("btn-invite-friend").addEventListener("click", roomShowFriends);

    // Settings form.
    var s = save.settings;
    $("vol-music").addEventListener("input", function (e) { s.volMusic = +e.target.value; persist(); applySettings(); });
    $("vol-effects").addEventListener("input", function (e) { s.volEffects = +e.target.value; persist(); applySettings(); });
    $("vol-ambience").addEventListener("input", function (e) { s.volAmbience = +e.target.value; persist(); applySettings(); });
    $("opt-quality").addEventListener("change", function (e) { s.quality = e.target.value; persist(); applySettings(); });
    $("opt-theme").addEventListener("change", function (e) { s.theme = e.target.value; persist(); applySettings(); });
    $("opt-motion").addEventListener("change", function (e) { s.reducedMotion = e.target.checked; persist(); applySettings(); });
    $("opt-contrast").addEventListener("change", function (e) { s.highContrast = e.target.checked; persist(); applySettings(); });
    $("opt-cvd").addEventListener("change", function (e) { s.cvdPalette = e.target.checked; persist(); applySettings(); });
    $("opt-bigtext").addEventListener("change", function (e) { s.bigText = e.target.checked; persist(); applySettings(); });
    $("opt-lefthand").addEventListener("change", function (e) { s.leftHanded = e.target.checked; persist(); applySettings(); });
    $("btn-replay-tutorial").addEventListener("click", startLearn);
    $("btn-wipe").addEventListener("click", function () {
      if (confirm("Erase all saved progress, achievements, and settings?")) {
        localStorage.removeItem(SAVE_KEY);
        save = loadSave();
        persist(); applySettings(); syncSettingsForm();
        announce("Saved progress erased.");
      }
    });

    // Theme select options.
    var themeSel = $("opt-theme");
    C.THEMES.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.id; o.textContent = t.name;
      themeSel.appendChild(o);
    });

    // First user gesture unlocks audio (browser autoplay policy).
    document.addEventListener("pointerdown", function unlock() {
      A.unlock(); A.startMusic(); A.startAmbience();
      document.removeEventListener("pointerdown", unlock);
    }, { once: true });

    if (UI.isReady()) UI.onCardClick(onCardChosen);

    // Backgrounding pauses solo simulation (AI already synchronous; stop renders).
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) A.stopMusic();
      else { A.startMusic(); if (UI.isReady()) UI.resize(); }
    });
  }

  function syncSettingsForm() {
    var s = save.settings;
    $("vol-music").value = s.volMusic;
    $("vol-effects").value = s.volEffects;
    $("vol-ambience").value = s.volAmbience;
    $("opt-quality").value = s.quality;
    $("opt-theme").value = s.theme;
    $("opt-motion").checked = s.reducedMotion;
    $("opt-contrast").checked = s.highContrast;
    $("opt-cvd").checked = s.cvdPalette;
    $("opt-bigtext").checked = s.bigText;
    $("opt-lefthand").checked = s.leftHanded;
  }

  // ---------------------------------------------------------------------------
  // Boot.
  function boot() {
    bind();
    // /api/v1/time is only served by the game's own local dev host; on the
    // platform an undocumented probe would just 404, so don't send it there.
    if (!onStarhermitHost) syncTime();
    var theme = C.THEMES.filter(function (t) { return t.id === save.settings.theme; })[0] || C.THEMES[0];
    try {
      UI.init($("table"), { theme: theme, suitPalette: save.settings.cvdPalette ? "cvd" : "standard" });
      UI.onCardClick(onCardChosen);
    } catch (e) {
      $("webgl-fallback").hidden = false;
      console.warn("WebGL unavailable:", e);
    }
    applySettings();
    syncSettingsForm();
    updateTitleProgress();
    if (onPlatform) {
      PL.refresh(); // 45-min launch-token refresh
      PL.onStatus(setSyncStatus);
      setSyncStatus("saving");
      PL.myNickname().then(function (name) {
        myName = name;
        var el = $("profile-name");
        if (el && name) { el.hidden = false; el.textContent = name; }
        if (room && room.isHost) { room.names[0] = name; roomBroadcastLobby(); }
      });
      // Remote-preferred load; localStorage stays the offline cache.
      PL.cloud.load().then(function (remote) {
        adoptRemoteSave(remote);
        PL.cloud.markReady();
        PL.cloud.save(save); // mirror the merged doc back up
      });
    }
    show("title", false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
