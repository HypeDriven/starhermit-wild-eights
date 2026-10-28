// Wild Eights on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/game.js), the content
// (js/content.js) and the progress document (js/save.js) are the browser
// build's; this module is what app.js did around them: the screen router
// (title, modes, Journey, challenges, practice setup, hosted play, the table,
// results, settings, help, records) with its back stack, every solo mode
// (Learn, Practice, Daily, Journey, Challenge) with the AI's turns, undo,
// hints, the tutorial lessons, the suit declaration, the round's end with its
// records, achievements and leaderboard post, hosted tables over StarHermit
// rooms refereed by server.js (js/online.js), and keys, pads, pointer and
// touch on the table. Screens are drawn by screens.ts (starhermit:ui), the
// table by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps (60 a second): delays (the results
// screen after a round) run on a clock advanced 1000/60 ms per step.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { bindings, onAction, onPointerButton, onPointerMove, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn, type Room } from "starhermit:platform";
import { C, Online, Sv, W, type Card, type Challenge, type Cmd, type GameEvent, type Lobby, type Snap, type Stage, type State, type Suit, type Table } from "./game.ts";
import * as audio from "./audio.ts";
import { L, T, TN, type Vars } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type Screen = "title" | "modes" | "journey" | "challenges" | "setup" | "hosted" | "game" | "results" | "settings" | "help" | "records";
export type Dialog = "suit" | "pause" | "wipe" | null;
export interface Msg { key: string; vars?: Vars; raw?: string }
export interface Session {
  mode: string; state: State; undoStack: string[]; moveLimit: number | null; stageId: string | null; noUndo: boolean; tutorialStep: number;
  eightsPlayed: number; hintsUsed: number; startedAt: number; hosted: boolean; seat: number; replaySeed: number;
  options: { players: number; handSize?: number; difficulty: number; moveLimit: number | null; noUndo: boolean; mastery?: boolean };
  over: boolean; names: string[] | null; ai: boolean[]; away: boolean[];
}
export interface Results {
  won: boolean; headline: string; rows: { name: string; cards: number; points: number; winner: boolean }[]; total: number; extra: string;
  unlocked: string[]; nextStage: Stage | null; hosted: boolean;
}
export interface Hosted {
  lobby: Lobby | null; table: Table | null; status: Msg | null; busy: boolean; code: string;
  invites: { id: string; from: string }[]; friends: { userId: string; name: string; online: boolean }[] | null; invited: string[];
}

export const app = {
  screen: "title" as Screen,
  stack: [] as Screen[],
  dialog: null as Dialog,
  openedFrame: 0,
  focusNext: null as string | null,
  selected: null as number | null,
  toasts: [] as { text: string; until: number }[],
  results: null as Results | null,
  lb: null as platform.Posted | "posting" | null,
  setup: { players: 4, difficulty: 1 },
  hosted: { lobby: null, table: null, status: null, busy: false, code: "", invites: [], friends: null, invited: [] } as Hosted,
  board: null as platform.BoardRow[] | null,
  flash: 0,
};
export let session: Session | null = null;
let clockMs = 0;
export const nowMs = (): number => clockMs;
export const fresh = (): boolean => frame().frame !== app.openedFrame;

// ------------------------------------------------------------------ the fixed-step timers
const timerList: { at: number; fn: () => void }[] = [];
export function after(ms: number, fn: () => void): void { timerList.push({ at: clockMs + Math.max(0, ms), fn }); }
function runTimers(): void {
  for (let i = 0; i < timerList.length; i++) {
    if (timerList[i]!.at > clockMs) continue;
    const t = timerList.splice(i, 1)[0]!;
    i--;
    t.fn();
  }
}

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
/** The old live regions (polite / assertive): one announcement a frame. */
export function announce(text: string): void { if (text) spoken.push(text); }
function flushAnnouncements(): void {
  if (!spoken.length) return;
  const text = spoken.splice(0).slice(-3).join(" ").slice(0, 400);
  try { ui.announce(text); } catch { /* busy */ }
}
/** app.js toast (3.5 s, announced). */
export function toast(text: string): void {
  app.toasts.push({ text, until: clockMs + 3500 });
  if (app.toasts.length > 3) app.toasts.shift();
  announce(text);
}
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built. */
export function later(fn: () => void): void { pending.push(fn); }
export const reducedMotion = (): boolean => preferences().reducedMotion;
export function msgText(m: Msg | null): string { return !m ? "" : m.raw != null ? m.raw : T(m.key, m.vars); }
export const suitGlyph = (suit: string): string => ({ hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" } as Record<string, string>)[suit] ?? suit;
export const cardName = (card: Card): string => L.cardName(card, W.rankName);
export const coarse = (): boolean => frame().width / ui.preferences().scale < 600;

// ------------------------------------------------------------------ the screen router (app.js show / back)
const FIRST_FOCUS: Partial<Record<Screen, string>> = { title: "btn-play", modes: "mode-learn", setup: "btn-start", results: "btn-again" };
export function show(name: Screen, push = true): void {
  if (push && app.screen !== name) app.stack.push(app.screen);
  app.screen = name;
  app.openedFrame = frame().frame;
  app.focusNext = coarse() ? null : FIRST_FOCUS[name] ?? "btn-back";
  ui.setFocus(null);
  if (name === "records") refreshBoard();
  if (name === "hosted") hostedShown();
  if (name !== "game") render.setHover(null);
}
export function back(): void {
  const prev = app.stack.pop() ?? "title";
  show(prev, false);
}
function openDialog(d: Dialog): void { app.dialog = d; app.openedFrame = frame().frame; app.focusNext = coarse() ? null : "dialog-first"; ui.setFocus(null); }
export function closeDialog(): void { app.dialog = null; app.openedFrame = frame().frame; ui.setFocus(null); }
export function openPause(): void { if (session && app.screen === "game" && !app.dialog) { openDialog("pause"); announce(T("paused")); } }
export function resume(): void { closeDialog(); app.stack = []; }
export function openWipe(): void { openDialog("wipe"); }

// ------------------------------------------------------------------ the session (app.js newLocalSession …)
function newLocalSession(mode: string, options: { players?: number; handSize?: number; difficulty?: number; moveLimit?: number; noUndo?: boolean },
  extras?: { seed?: number; stageId?: string; mastery?: boolean }): Session {
  const seed = extras?.seed != null ? extras.seed : Math.floor(Math.random() * 0x7fffffff);
  const opts = { players: options.players || 4, handSize: options.handSize, difficulty: options.difficulty == null ? 1 : options.difficulty };
  session = {
    mode, state: W.newGame(seed, opts), undoStack: [], moveLimit: options.moveLimit || null, stageId: extras?.stageId ?? null,
    noUndo: !!(options.noUndo || extras?.mastery), tutorialStep: mode === "learn" ? 0 : -1, eightsPlayed: 0, hintsUsed: 0, startedAt: clockMs,
    hosted: false, seat: 0, replaySeed: seed,
    options: { players: opts.players, handSize: options.handSize, difficulty: opts.difficulty, moveLimit: options.moveLimit || null, noUndo: !!options.noUndo, mastery: extras?.mastery },
    over: false, names: null, ai: [], away: [],
  };
  return session;
}
export const mySeat = (): number => (session?.hosted ? session.seat : 0);
export function humanTurn(): boolean {
  const s = session;
  if (!s || s.over || s.state.winner !== null || s.state.pendingSuitFor !== null) return false;
  return s.state.current === mySeat();
}
export function legalNow(): number[] { return session && humanTurn() ? W.legalActions(session.state).plays : []; }

/** AI turns until it is the human's or the round ends (app.js runAI). */
function runAI(): void {
  for (let guard = 400; session && !session.hosted && session.state.winner === null && guard > 0; guard--) {
    const st = session.state;
    if (st.pendingSuitFor === 0) break;
    if (st.pendingSuitFor === null && st.current === 0) break;
    const cmd = W.aiCommand(st, st.difficulty);
    if (!cmd) break;
    const r = W.applyCommand(st, cmd);
    if (r.error) break;
    audio.play(r.events?.some((e) => e.type === "draw") ? "draw" : "play");
    render.playEvents(r.events ?? []);
  }
  checkEnd();
}
function checkEnd(): void {
  if (!session || session.state.winner === null || session.over) return;
  session.over = true;
  finishRound();
}
/** The table and hand mirror (app.js rerender). */
export function rerender(): void {
  if (!session) { render.clearTable(); return; }
  const human = humanTurn();
  render.renderState(session.state, human ? W.legalActions(session.state).plays : [], human, app.selected, mySeat());
}

const ERROR_KEYS: Record<string, string> = {
  "illegal-card": "err_illegal", "card-not-in-hand": "err_notInHand", "must-declare-suit": "err_declareFirst",
  "no-pending-suit": "err_noPending", "bad-suit": "err_badSuit", "game-over": "err_over",
};
function flashInvalid(): void { app.flash = clockMs + 350; }
/** A move (app.js commit): hosted moves go to the table's referee. */
export function commit(cmd: Cmd): void {
  const s = session;
  if (!s || s.over) return;
  if (s.hosted) {
    app.hosted.table?.send(cmd);
    if (cmd.type === "play") { app.selected = null; audio.play(W.cardById(cmd.cardId).rank === 8 ? "eight" : "play"); }
    else if (cmd.type === "draw") audio.play("draw");
    else audio.play("confirm");
    if (cmd.type === "declareSuit") closeDialog();
    return;
  }
  if (s.mode === "practice" && !s.noUndo && s.state.current === 0) {
    s.undoStack.push(JSON.stringify(W.serialize(s.state)));
    if (s.undoStack.length > 40) s.undoStack.shift();
  }
  const r = W.applyCommand(s.state, cmd);
  if (r.error) {
    audio.play("error");
    announce(T("cantDo", { reason: T(ERROR_KEYS[r.error] ?? "err_other") }));
    flashInvalid();
    return;
  }
  if (cmd.type === "play") {
    const card = W.cardById(cmd.cardId);
    if (card.rank === 8) { s.eightsPlayed++; audio.play("eight"); } else audio.play("play");
    app.selected = null;
    render.playEvents(r.events ?? []);
    if (s.state.pendingSuitFor === 0) { openSuitPicker(); rerender(); return; }
  } else if (cmd.type === "draw") audio.play("draw");
  else if (cmd.type === "declareSuit") audio.play("confirm");
  advanceTutorial(cmd);
  runAI();
  rerender();
  announceTurn();
}
export function onCardChosen(cardId: number): void {
  const s = session;
  if (!s || !humanTurn()) { announce(T("notYourTurn")); return; }
  const la = W.legalActions(s.state);
  if (!la.plays.includes(cardId)) {
    audio.play("error");
    const top = s.state.discardPile[s.state.discardPile.length - 1]!;
    announce(T("cantPlay", { card: cardName(W.cardById(cardId)), suit: L.suitName(s.state.activeSuit ?? ""), rank: W.rankName(top.rank) }));
    flashInvalid();
    if (!s.hosted) s.state.invalidActions++; // the rules count an illegal card (applyCommand's illegal-card path)
    return;
  }
  audio.play("confirm");
  commit({ type: "play", cardId });
}
export function drawCard(): void { if (humanTurn()) commit({ type: "draw" }); }
function announceTurn(): void {
  const s = session;
  if (!s || s.state.winner !== null) return;
  if (s.state.pendingSuitFor === mySeat()) { announce(T("declarePrompt")); return; }
  if (s.state.current === mySeat()) {
    audio.play("turn");
    const la = W.legalActions(s.state);
    announce(la.plays.length === 1 ? T("yourTurnOne") : la.plays.length ? T("yourTurnN", { n: la.plays.length }) : T("yourTurnDraw"));
  }
}
/** Hint: the same legal-action API as play (app.js hint). */
export function hint(): void {
  const s = session;
  if (!s || s.over || !humanTurn()) return;
  const la = W.legalActions(s.state);
  s.hintsUsed++;
  if (!la.plays.length) { toast(T("hintDraw")); return; }
  let best: Card | null = null, bestPts = -1;
  for (const c of s.state.hands[mySeat()]!) if (la.plays.includes(c.id) && W.cardPoints(c) > bestPts && c.rank !== 8) { best = c; bestPts = W.cardPoints(c); }
  if (!best) best = W.cardById(la.plays[0]!);
  app.selected = best.id;
  toast(T("hintTry", { card: cardName(best) }));
  rerender();
}
export const canUndo = (): boolean => !!session && session.mode === "practice" && !session.noUndo && !session.hosted && session.undoStack.length > 0;
export function undo(): void {
  const s = session;
  if (!s || !canUndo()) return;
  const snap = s.undoStack.pop()!;
  s.state = W.deserialize(JSON.parse(snap));
  s.state.difficulty = s.options.difficulty;
  s.over = false;
  audio.play("select");
  rerender();
  announce(T("undone"));
}
/** Suits ordered by how many the hand holds (best first). */
export function suitOrder(): { suit: Suit; n: number }[] {
  const hand = session ? session.state.hands[mySeat()] ?? [] : [];
  const counts: Record<string, number> = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
  for (const c of hand) counts[c.suit] = (counts[c.suit] ?? 0) + 1;
  return W.SUITS.slice().sort((a, b) => counts[b]! - counts[a]!).map((suit) => ({ suit, n: counts[suit]! }));
}
function openSuitPicker(): void { openDialog("suit"); announce(T("declarePrompt")); }
export function declare(suit: Suit): void { closeDialog(); commit({ type: "declareSuit", suit }); }

function advanceTutorial(cmd: Cmd): void {
  const s = session;
  if (!s || s.tutorialStep < 0) return;
  const step = C.TUTORIAL[s.tutorialStep];
  if (!step) return;
  const done = (step.require === "play" && cmd.type === "play" && W.cardById(cmd.cardId).rank !== 8)
    || (step.require === "eight" && cmd.type === "play" && W.cardById(cmd.cardId).rank === 8)
    || (step.require === "draw" && cmd.type === "draw")
    || (step.require === "finish" && s.state.winner !== null);
  if (!done) return;
  s.tutorialStep++;
  if (s.tutorialStep >= C.TUTORIAL.length) {
    platform.progress().tutorialDone = true;
    platform.persist();
    announce(T("tutorialComplete"));
  } else {
    const nt = C.TUTORIAL[s.tutorialStep]!;
    announce(T("lessonNext", { title: TN("tutorial", nt.id, [nt.title])[0]! }));
  }
}
/** The lesson shown now (auto-skipping an "eight" lesson without an eight in hand), or null. */
export function currentLesson(): { title: string; body: string; n: number } | null {
  const s = session;
  if (!s || s.tutorialStep < 0 || s.tutorialStep >= C.TUTORIAL.length) return null;
  let t = C.TUTORIAL[s.tutorialStep]!;
  if (t.require === "eight" && humanTurn() && !s.state.hands[0]!.some((c) => c.rank === 8)) {
    s.tutorialStep++;
    const nt = C.TUTORIAL[s.tutorialStep];
    if (!nt) {
      if (!platform.progress().tutorialDone) { platform.progress().tutorialDone = true; platform.persist(); }
      return null;
    }
    t = nt;
  }
  const tt = TN("tutorial", t.id, [t.title, t.body]);
  return { title: tt[0]!, body: tt[1]!, n: s.tutorialStep + 1 };
}

// ------------------------------------------------------------------ names and HUD text
export function seatNames(): string[] {
  const s = session;
  if (!s || !s.hosted) return [T("you"), T("rivalN", { n: 1 }), T("rivalN", { n: 2 }), T("rivalN", { n: 3 })];
  return (s.names ?? []).map((nm, i) => (i === s.seat ? T("you") : s.ai[i] || !nm ? T("aiSeat", { n: i }) : nm));
}
export function topText(st: State): string {
  const top = st.discardPile[st.discardPile.length - 1];
  return top ? W.rankName(top.rank) + suitGlyph(top.suit) : "—";
}
export function objectiveText(): string {
  const s = session;
  if (!s) return "";
  if (s.state.winner !== null) return T("roundOverDot");
  let base = T("objective");
  if (s.moveLimit) base += T("moveLimitLine", { n: s.state.moveCount, max: s.moveLimit });
  if (s.mode === "daily") base = T("dailyPrefix", { text: base });
  if (s.stageId) base = T("stagePrefix", { n: s.stageId.slice(1), text: base });
  if (s.hosted) base = T("hostedPrefix", { text: base });
  return base;
}
export function turnText(): string {
  const s = session;
  if (!s) return "";
  const st = s.state, names = seatNames();
  const turnName = st.winner !== null ? "—" : st.pendingSuitFor !== null ? T("declaringSuit", { name: names[st.pendingSuitFor]! })
    : st.current === mySeat() ? T("yourTurnTag", { name: names[st.current]! }) : names[st.current]!;
  return T("turnLine", { name: turnName, top: topText(st), suit: st.activeSuit ? L.suitName(st.activeSuit) : "—" });
}
export function opponentsText(): string {
  const s = session;
  if (!s) return "";
  const names = seatNames();
  return s.state.hands.map((h, i) => (i === mySeat() ? null : T("opponentCount", { name: names[i]!, n: h.length }) + (s.away[i] ? T("awayTag") : ""))).filter(Boolean).join(" · ");
}

// ------------------------------------------------------------------ the round's end (app.js finishRound)
function finishRound(): void {
  const s = session!;
  const st = s.state;
  const me = mySeat();
  const won = st.winner === me;
  audio.play(won ? "win" : "lose");
  render.playEvents([{ type: "win" }]);
  const elapsed = clockMs - s.startedAt;
  let unlocked: string[] = [];
  const doc = platform.progress();
  if (!s.hosted) {
    unlocked = Sv.recordRound(doc, {
      mode: s.mode, stageId: s.stageId, won, score: st.score ? st.score.total : 0, moves: st.moveCount, eightsPlayed: s.eightsPlayed,
      invalid: st.invalidActions, hints: s.hintsUsed, day: s.mode === "daily" ? new Date(platform.nowMs()).toISOString().slice(0, 10) : null,
      journeyTotal: C.JOURNEY.length,
    });
    platform.persist();
    for (const id of unlocked) announce(T("achievementUnlocked", { name: achievementName(id) }));
  }
  const names = seatNames();
  const extra: string[] = [];
  extra.push(st.terminalReason === "empty-hand" ? T("endedEmpty") : st.terminalReason === "abandoned" ? T("endedAbandoned") : T("endedStock"));
  if (!s.hosted) {
    extra.push(T("yourMoves", { n: st.moveCount }));
    if (s.moveLimit) extra.push(st.moveCount <= s.moveLimit && won ? T("moveLimitMet") : T("moveLimitN", { n: s.moveLimit }));
    extra.push(T("invalidN", { n: st.invalidActions }));
    extra.push(T("timeN", { n: Math.round(elapsed / 1000) }));
    extra.push(T("seedN", { seed: s.replaySeed }));
  } else extra.push(T("hostedRecorded"));
  let next: Stage | null = null;
  if (s.mode === "journey" && s.stageId && won) next = C.JOURNEY[parseInt(s.stageId.slice(1), 10)] ?? null;
  app.results = {
    won, headline: won ? T("youWin") : T("winsRound", { name: s.hosted ? names[st.winner!]! : T("rivalN", { n: st.winner! }) }),
    rows: (st.score ? st.score.breakdown : []).map((r) => ({ name: names[r.player]!, cards: r.cards, points: r.points, winner: r.player === st.winner })),
    total: st.score ? st.score.total : 0, extra: extra.join(" · "), unlocked, nextStage: next, hosted: s.hosted,
  };
  // signed in: every solo mode but Learn posts the round (its score when won, else 0) to the high-score board
  app.lb = null;
  if (!s.hosted && s.mode !== "learn" && platform.signedIn()) {
    app.lb = "posting";
    const round = s;
    void platform.postScore(won && st.score ? Math.max(0, st.score.total) : 0).then((r) => { if (session === round) app.lb = r; });
  }
  if (s.hosted) hostedRoundOver();
  after(reducedMotion() ? 100 : 900, () => {
    if (session !== s) return;
    if (app.dialog) closeDialog();
    show("results");
    announce(app.results ? app.results.headline : "");
  });
}
export function achievementName(id: string): string {
  const meta = C.ACHIEVEMENTS.find((a) => a.id === id);
  return TN("achievements", id, [meta ? meta.name : id])[0]!;
}

// ------------------------------------------------------------------ mode starts
export function enterGame(): void {
  app.selected = null;
  app.stack = [];
  app.dialog = null;
  show("game", false);
  app.focusNext = null;
  runAI();
  rerender();
  announceTurn();
}
export function startLearn(): void {
  newLocalSession("learn", { players: 2, difficulty: 0, handSize: 5 }, { seed: 1337 });
  enterGame();
  announce(T("lessonFirst", { title: TN("tutorial", C.TUTORIAL[0]!.id, [C.TUTORIAL[0]!.title])[0]! }));
}
export function startPractice(): void { newLocalSession("practice", { players: app.setup.players, difficulty: app.setup.difficulty }); enterGame(); }
export function startDaily(): void { newLocalSession("daily", { players: 4, difficulty: 1 }, { seed: W.dailySeed(new Date(platform.nowMs())) }); enterGame(); }
export function startJourneyStage(stage: Stage): void {
  newLocalSession("journey", { players: stage.players, difficulty: stage.difficulty, handSize: stage.handSize, moveLimit: stage.moveLimit },
    { seed: stage.seed, stageId: stage.id, mastery: stage.mastery });
  enterGame();
}
export function startChallenge(ch: Challenge): void {
  newLocalSession("challenge", { players: ch.players, difficulty: ch.difficulty, handSize: ch.handSize, moveLimit: ch.moveLimit, noUndo: ch.noUndo }, { seed: ch.seed });
  enterGame();
}
export function play(): void {
  if (!platform.progress().tutorialDone) startLearn();
  else show("modes");
}
export function restartRound(): void {
  const s = session;
  if (!s || s.hosted) return;
  const o = s.options;
  newLocalSession(s.mode, { players: o.players, handSize: o.handSize, difficulty: o.difficulty, moveLimit: o.moveLimit ?? undefined, noUndo: o.noUndo },
    { seed: s.replaySeed, stageId: s.stageId ?? undefined, mastery: o.mastery });
  enterGame();
}
export function playAgain(): void {
  const s = session;
  if (!s) { show("title"); return; }
  if (s.hosted) { leaveToTitle(); show("hosted"); return; }
  if (s.mode === "daily" || s.mode === "journey" || s.mode === "challenge") restartRound();
  else {
    const o = s.options;
    newLocalSession(s.mode, { players: o.players, handSize: o.handSize, difficulty: o.difficulty, moveLimit: o.moveLimit ?? undefined, noUndo: o.noUndo },
      s.mode === "learn" ? { seed: 1337 } : undefined);
    enterGame();
  }
}
export function nextStage(): void { const n = app.results?.nextStage; if (n) startJourneyStage(n); }
export function leaveToTitle(): void {
  if (session?.hosted) hostedLeave();
  session = null;
  app.dialog = null;
  app.stack = [];
  render.clearTable();
  show("title", false);
}

// ------------------------------------------------------------------ hosted tables (StarHermit rooms, refereed by server.js)
function hostedShown(): void {
  const H = app.hosted;
  if (!H.lobby && !H.table) H.status = platform.signedIn() ? null : { key: "hostedSignIn" };
  void refreshInvites();
  // a returning player re-attaches to the table they still hold (app.js roomMaybeReconnect)
  if (platform.signedIn() && !H.lobby && !H.busy) {
    void platform.adapter.myRoom().then((room) => {
      if (!room || room.status === "closed" || app.hosted !== H || H.lobby) return;
      attachLobby(H, room);
    }, () => undefined);
  }
}
async function refreshInvites(): Promise<void> {
  if (!platform.signedIn()) { app.hosted.invites = []; return; }
  try {
    const list = await platform.adapter.invites();
    app.hosted.invites = list.slice(0, 5).map((i) => ({ id: i.id, from: i.fromUsername }));
  } catch { app.hosted.invites = []; }
}
let invitePoll = 0;
async function joinWith(H: Hosted, get: () => Promise<Room | null>, busy: Msg, none: Msg): Promise<void> {
  if (!platform.signedIn() || H.busy || H.lobby) return;
  H.busy = true;
  H.status = busy;
  try {
    const room = await get();
    H.busy = false;
    if (app.hosted !== H) return;
    if (!room) { H.status = none; return; }
    attachLobby(H, room);
  } catch (e) {
    H.busy = false;
    const kind = (e as { kind?: string; name?: string })?.kind ?? (e as { name?: string })?.name ?? "";
    H.status = kind === "terms-required" ? { key: "termsRequiredShort" } : { key: "tablesUnavailable" };
  }
}
export function hostTable(): void { const H = app.hosted; void joinWith(H, () => Online.hostTable(platform.adapter, platform.displayName()), { key: "hostingTable" }, { key: "createFailed" }); }
export function quickJoin(): void { const H = app.hosted; void joinWith(H, () => Online.quickJoin(platform.adapter, platform.displayName()), { key: "joiningTable" }, { key: "joinFailed" }); }
export function joinByCode(): void {
  const H = app.hosted;
  const code = H.code.trim().toUpperCase();
  if (code.length < 3) { H.status = { key: "enterCode" }; return; }
  void joinWith(H, () => Online.joinCode(platform.adapter, code), { key: "joiningTable" }, { key: "noTableCode" });
}
export function acceptInvite(id: string): void { const H = app.hosted; void joinWith(H, () => platform.adapter.acceptInvite(id), { key: "joiningTable" }, { key: "joinFailed" }); }
function attachLobby(H: Hosted, room: Room): void {
  const lobby = new Online.LobbyClient(platform.adapter, room, {
    onChange: () => { if (app.hosted === H && !H.table) H.status = { key: "lobbyStatus", vars: { n: lobby.participants.length } }; },
    onPlaying: (r: Room) => { if (app.hosted === H) startTable(H, r); },
    onClosed: () => { if (app.hosted === H && !H.table) { hostedLeave(); app.hosted.status = { key: "hostLeft" }; } },
  });
  H.lobby = lobby;
  H.status = { key: "lobbyStatus", vars: { n: room.participants.length } };
  H.friends = null;
  H.invited = [];
  lobby.connect();
}
export function hostedStart(): void { void app.hosted.lobby?.start(); }
export function showFriends(): void {
  const H = app.hosted;
  void platform.adapter.friends().then((list) => {
    H.friends = list.slice(0, 10).map((f) => ({ userId: f.userId, name: f.username, online: f.online }));
  }, () => { H.friends = []; });
}
export function inviteFriend(uid: string): void {
  const H = app.hosted;
  const id = H.lobby?.room.id;
  if (!id) return;
  void platform.adapter.inviteFriend(id, uid).then(() => { H.invited.push(uid); }, () => undefined);
}
export function rosterLines(): string[] {
  const lobby = app.hosted.lobby;
  if (!lobby) return [];
  const me = platform.userId();
  return lobby.participants.map((p) => (p.displayName || p.username) + (p.isHost ? T("hostTag") : "") + (me && p.userId === me ? T("youTag") : "") + (p.isAi ? T("aiTag") : ""));
}
function startTable(H: Hosted, room: Room): void {
  const t = new Online.TableClient(platform.adapter, room, {
    onSnap: (snap: Snap) => { if (app.hosted === H) onSnap(snap); },
    onRejected: (reason: string) => {
      if (app.hosted !== H) return;
      audio.play("error");
      flashInvalid();
      announce(T("cantDo", { reason: T(ERROR_KEYS[reason] ?? (reason === "not-your-turn" ? "notYourTurn" : "err_other")) }));
    },
    onChange: () => {
      if (app.hosted !== H) return;
      if (t.unavailable && !session?.over) { hostedLeave(); app.hosted.status = { key: "disconnectedTable" }; if (app.screen === "game") { session = null; render.clearTable(); show("hosted", false); } }
    },
  });
  H.table = t;
  H.status = { key: "roundStarting" };
  t.connect();
}
function onSnap(snap: Snap): void {
  const first = !session || !session.hosted;
  const view = W.deserialize(snap.view, snap.seat);
  if (first) {
    session = {
      mode: "hosted", state: view, undoStack: [], moveLimit: null, stageId: null, noUndo: true, tutorialStep: -1, eightsPlayed: 0, hintsUsed: 0,
      startedAt: clockMs, hosted: true, seat: snap.seat, replaySeed: 0, options: { players: 4, difficulty: 1, moveLimit: null, noUndo: true },
      over: false, names: snap.names, ai: snap.ai, away: snap.away,
    };
    app.selected = null;
    app.stack = [];
    show("game", false);
    app.focusNext = null;
  }
  const s = session!;
  s.state = view;
  s.seat = snap.seat;
  s.names = snap.names;
  s.ai = snap.ai;
  s.away = snap.away;
  if (snap.over && !view.score) s.state.score = snap.over.score;
  const names = seatNames();
  const events: GameEvent[] = snap.events ?? [];
  for (const e of events) {
    if (e.type === "seat" && e.player != null && e.player !== s.seat) announce(T(e.k === "left" ? "awayLeft" : e.k === "back" ? "awayBack" : "awayOffline", { name: names[e.player]! }));
  }
  if (!first && events.some((e) => e.type === "play" || e.type === "draw")) {
    const others = events.filter((e) => e.player !== s.seat);
    if (others.length) audio.play(others.some((e) => e.type === "draw") ? "draw" : "play");
  }
  render.playEvents(events);
  if (app.selected != null && !(s.state.hands[s.seat] ?? []).some((c) => c.id === app.selected)) app.selected = null;
  rerender();
  if (!s.over && s.state.pendingSuitFor === s.seat && app.dialog !== "suit") { openSuitPicker(); return; }
  if (app.dialog === "suit" && s.state.pendingSuitFor !== s.seat) closeDialog();
  if (s.state.winner !== null && !s.over) { s.over = true; finishRound(); return; }
  announceTurn();
}
function hostedRoundOver(): void {
  const H = app.hosted;
  // the round is over: the room closes with it; drop our sockets and seat
  const t = H.table, l = H.lobby;
  H.table = null; H.lobby = null; H.status = null;
  t?.close();
  l?.close();
  const id = t?.room?.id ?? l?.room?.id;
  if (id) void platform.adapter.leaveRoom(id).catch(() => undefined);
}
export function hostedLeave(): void {
  const H = app.hosted;
  const t = H.table, l = H.lobby;
  H.table = null; H.lobby = null; H.friends = null; H.status = null;
  if (t) { void t.leave(); l?.close(); } else if (l) void l.leave();
}

// ------------------------------------------------------------------ records
function refreshBoard(): void {
  app.board = null;
  void platform.topScores().then((rows) => { app.board = rows; });
}

// ------------------------------------------------------------------ keys and pads (app.js keydown, pollGamepad)
const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
/** The effective keyboard bindings of an action (the runtime's rebinding), for Help. */
export function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join("/") || "—";
}
export const inPlay = (): boolean => !!session && app.screen === "game" && !app.dialog;
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  if (app.dialog) {
    if (e.action === "pause" && fresh() && app.dialog === "pause") later(resume);
    else if (e.action === "pause" && fresh() && app.dialog === "wipe") later(closeDialog);
    return; // the suit declaration is mandatory
  }
  if (app.screen !== "game" || !session) {
    if (e.action === "pause" && app.screen !== "title" && fresh()) later(back);
    return;
  }
  const s = session;
  const hand = s.state.hands[mySeat()] ?? [];
  switch (e.action) {
    case "prev_card": case "next_card": {
      ui.setFocus(null);
      if (!hand.length) return;
      const dir = e.action === "next_card" ? 1 : -1;
      let idx = hand.findIndex((c) => c.id === app.selected);
      idx = idx < 0 ? (dir > 0 ? 0 : hand.length - 1) : (idx + dir + hand.length) % hand.length;
      app.selected = hand[idx]!.id;
      audio.play("select");
      rerender();
      break;
    }
    case "play_card": if (ui.focused() == null && app.selected != null) { const id = app.selected; later(() => onCardChosen(id)); } break;
    case "draw": later(drawCard); break;
    case "hint": later(hint); break;
    case "undo": later(undo); break;
    case "pause": later(openPause); break;
    case "camera": render.reframe(); break;
  }
});

// ------------------------------------------------------------------ pointer and touch on the table (ui.js pointer events)
const taps: { x: number; y: number }[] = [];
let hoverAt: { x: number; y: number } | null = null;
let lastTouch = -1e9;
onTouch((e) => {
  lastTouch = clockMs;
  if (e.control || !e.primary) return;
  if (e.phase === "start" && !ui.pointerCaptured()) taps.push({ x: e.x, y: e.y });
});
onPointerButton((e) => {
  if (e.button !== 0 || clockMs - lastTouch < 600) return;
  if (e.pressed && !ui.pointerCaptured()) taps.push({ x: e.x, y: e.y });
});
onPointerMove((x, y) => { if (clockMs - lastTouch >= 600) hoverAt = { x, y }; });
function pointerInput(wasPlaying: boolean): void {
  const list = taps.splice(0);
  if (!wasPlaying || !inPlay()) { render.setHover(null); return; }
  for (const t of list) {
    const id = render.pickCard(t.x, t.y);
    if (id != null) { ui.setFocus(null); onCardChosen(id); }
  }
  const id = hoverAt && !ui.pointerOver() ? render.pickCard(hoverAt.x, hoverAt.y) : null;
  render.setHover(id != null && render.isLegal(id) ? id : null);
}

// ------------------------------------------------------------------ account
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(T("inviteCopied")); } catch { toast(T("inviteFailed", { link })); }
}
export function wipeProgress(): void { platform.wipe(); closeDialog(); announce(T("wiped")); }

// ------------------------------------------------------------------ boot and lifecycle
let hidden = false;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / 60;
  runTimers();
  if (platform.signedIn() && app.screen === "hosted" && !app.hosted.lobby && clockMs - invitePoll > 5000) { invitePoll = clockMs; void refreshInvites(); }
  app.hosted.table?.flush();
});
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
export function themeNow() { return C.THEMES.find((t) => t.id === platform.options.theme) ?? C.THEMES[0]!; }
function applyOptions(): void {
  render.setTheme(themeNow());
  render.setSuitPalette(platform.options.cvdPalette ? "cvd" : "standard");
}
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyOptions();
  applyLook();
  show("title", false);
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(applyOptions);
platform.onProgressMerged(() => undefined);
onSessionEnded(() => toast(T("signedOut")));
onSuspend(() => {
  hidden = true;
  audio.setMusic(false);
  if (session && !session.hosted && !session.over && app.screen === "game" && !app.dialog) openPause();
  platform.flush();
});
onResume(() => { hidden = false; audio.setMusic(true); });

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update();
  app.toasts = app.toasts.filter((t) => t.until > clockMs);
});
onRender(() => {
  const wasPlaying = inPlay();
  const f = frame();
  const rect = drawScreens();
  render.setView(rect, f.width, f.height);
  for (const fn of pending.splice(0)) fn();
  pointerInput(wasPlaying);
  render.frame(frameDt);
  flushAnnouncements();
});
