// Wild Eights — application controller: screens, session lifecycle, local and
// hosted play, persistence, input, accessibility mirror. ES module loaded
// after ui.js, so window.WEGame / WEContent / WEAudio / WEUI are ready.
(function () {
  "use strict";

  var W = window.WEGame;
  var C = window.WEContent;
  var A = window.WEAudio;
  var UI = window.WEUI;

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
      // For hosted seats > 0 we still render from seat 0's visual perspective;
      // the DOM list shows the actual player's hand.
      UI.renderState(st, {
        legalPlays: isHuman ? la.plays : [],
        onTurn: isHuman,
        selectedCardId: selectedCardId
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
    var names = ["You", "Rival 1", "Rival 2", "Rival 3"];
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
      if (t) {
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
    if (st.pendingSuitFor === 0) { announce("You played an 8. Declare a suit."); return; }
    if ((session.hosted ? st.current === session.seat : st.current === 0)) {
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
        show(screenStack[screenStack.length - 1] === "game" ? "game" : "game", false);
        screenStack = [];
        commit({ type: "declareSuit", suit: suit });
      });
      grid.appendChild(b);
    });
    show("suit", false);
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
        var day = new Date().toISOString().slice(0, 10);
        if (save.dailyDays.indexOf(day) < 0) save.dailyDays.push(day);
      }
      checkAchievements(won);
      persist();
    }

    // Fill results screen.
    $("results-headline").textContent = won ? "You win the round!" :
      (session.hosted ? "Player " + (st.winner + 1) : "Rival " + st.winner) + " wins the round.";
    var tbody = $("results-table").querySelector("tbody");
    tbody.innerHTML = "";
    var names = session.hosted
      ? st.hands.map(function (_, i) { return "Player " + (i + 1); })
      : ["You", "Rival 1", "Rival 2", "Rival 3"];
    (st.score ? st.score.breakdown : []).forEach(function (row) {
      var tr = document.createElement("tr");
      var who = row.player === st.winner ? names[row.player] + " ★" : names[row.player];
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
    var seed = W.dailySeed(new Date());
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
  // Hosted play (WebSocket, server-authoritative).
  var ws = null;
  var wsState = { code: null, seat: null, connected: false };

  function wsUrl() {
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    return proto + location.host + "/ws";
  }
  function hostedConnect(onOpen) {
    if (ws && ws.readyState === 1) { onOpen(); return; }
    try { ws = new WebSocket(wsUrl()); } catch (e) { hostedError("WebSocket unavailable."); return; }
    ws.onopen = onOpen;
    ws.onmessage = hostedMessage;
    ws.onerror = function () { hostedError("Connection problem."); };
    ws.onclose = function () {
      wsState.connected = false;
      if (session && session.hosted && !session.over) {
        announce("Disconnected. Rejoin with your table code to resume.", true);
      }
    };
  }
  function hostedSend(o) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
  }
  function hostedError(msg) { $("hosted-error").textContent = msg; }

  function hostedMessage(ev) {
    var m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === "error") { hostedError(m.error); announce(m.error, true); return; }
    if (m.type === "hosted" || m.type === "joined") {
      wsState.code = m.code; wsState.seat = m.seat; wsState.connected = true;
      save.hosted = { code: m.code, name: wsState.name };
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
      session.state = W.deserialize(m.snapshot);
      session.over = session.state.winner !== null;
      if (m.away && m.away.length) announce("While you were away: " + m.away.join(" "), true);
      if (m.events) UI.playEvents(m.events, session.state);
      rerender();
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
      li.textContent = p.name + (p.seat === wsState.seat ? " (you)" : "") + (p.ai ? " · AI" : "");
      ul.appendChild(li);
    });
    $("lobby-status").textContent = players.length + " seated · host starts the round; empty seats are filled by AI.";
  }

  function hostTable() {
    var name = "Player-" + Math.floor(Math.random() * 900 + 100);
    wsState.name = name;
    hostedConnect(function () { hostedSend({ type: "host", name: name }); });
  }
  function joinTable(code) {
    var name = (save.hosted && save.hosted.code === code && save.hosted.name) || "Player-" + Math.floor(Math.random() * 900 + 100);
    wsState.name = name;
    hostedConnect(function () { hostedSend({ type: "join", code: code, name: name }); });
  }
  function leaveHosted() {
    hostedSend({ type: "leave" });
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    wsState = { code: null, seat: null, connected: false };
    $("hosted-join").hidden = false;
    $("hosted-lobby").hidden = true;
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
  }

  // ---------------------------------------------------------------------------
  // Keyboard controls.
  document.addEventListener("keydown", function (ev) {
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
    $("btn-hosted").addEventListener("click", function () { show("hosted"); });
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
        else if (mode === "hosted") show("hosted");
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
      var idx = parseInt(session.stageId.slice(1), 10);
      var next = C.JOURNEY[idx]; // 0-based: idx is next stage
      if (next) startJourneyStage(next);
    });
    $("btn-results-menu").addEventListener("click", function () { session = null; show("title", false); screenStack = []; });

    // Hosted.
    $("btn-host").addEventListener("click", hostTable);
    $("join-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var code = $("join-code").value.trim().toUpperCase();
      if (code.length < 3) { hostedError("Enter the table code."); return; }
      joinTable(code);
    });
    $("btn-start-hosted").addEventListener("click", function () { hostedSend({ type: "start" }); });
    $("btn-leave-hosted").addEventListener("click", function () { leaveHosted(); });

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
    var doneCount = Object.keys(save.journey).filter(function (k) { return save.journey[k].won; }).length;
    $("title-progress").textContent =
      save.records.roundsPlayed === 0 ? "Welcome aboard." :
      "Journey " + doneCount + "/" + C.JOURNEY.length + " · streak " + save.streak + " · best score " + save.records.bestScore;
    show("title", false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
