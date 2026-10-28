// The browser build's DOM shell (index.html + styles.css) as starhermit:ui,
// built every frame: the top bar (title, tagline, the player's name, the
// cloud line, How to play and the runtime's Options in place of the old
// Sound toggle), every screen (title with its card fan, modes, Journey,
// challenges, practice setup, hosted play, results, settings, help, records)
// in a scrolling column of the old page's width, and the game screen: the HUD
// (objective, turn line, Hint / Undo / Pause), the lesson panel, the table
// (the rectangle left for render.ts) and the hand tray (active suit, the hand
// as card buttons — the accessible mirror of the table — Draw and the rivals'
// counts; Draw goes to the other side for left-handed play). The suit
// picker, pause and erase confirmations are dialogs. The old media queries
// are layouts picked by the window's logical size (portrait phones, short
// landscape: HUD | table | hand).
import { frame, openMenu } from "starhermit:engine";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { C, W, type Card, type Suit } from "./game.ts";
import { L, T, TN } from "./i18n.ts";
import * as platform from "./platform.ts";
import {
  achievementName, acceptInvite, app, back, canUndo, cardName, closeDialog, currentLesson, declare, drawCard, fresh, hint, hostTable, hostedLeave,
  hostedStart, humanTurn, invite, inviteFriend, joinByCode, keysFor, later, leaveToTitle, legalNow, msgText, mySeat, nextStage, nowMs, objectiveText,
  onCardChosen, openPause, openWipe, opponentsText, play, playAgain, quickJoin, rerender, restartRound, resume, rosterLines, session, show,
  showFriends, signIn, startChallenge, startDaily, startJourneyStage, startLearn, startPractice, suitGlyph, suitOrder, turnText, undo, wipeProgress,
  type Screen,
} from "./main.ts";

interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; portrait: boolean; short: boolean; side: number; inner: number }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const side = lw < 1024 ? 12 : Math.min(40, Math.max(8, lw * 0.03));
  const inner = Math.min(1200, lw) - 2 * side;
  return { lw, lh, sc, ox: sa.left, oy: sa.top, portrait: lw <= 640 && lh >= lw, short: lh <= 500 && lw > lh, side, inner };
}
function tw(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (tw(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean; selected?: boolean; name?: string; width?: number; lines?: { text: string; cls: string }[]; minH?: number }
const PADX: Record<string, number> = { btn: 44, "btn-primary": 44, "btn-ghost": 44, "btn-small": 28, "btn-danger": 44, "btn-big": 112, "btn-top": 24 };
function btnWidth(b: Btn): number { return Math.max(44, tw(b.text, b.style ?? "btn", "button") + 2); }
function button(b: Btn): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected) opts.selected = true;
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (b.minH != null) s.minHeight = b.minH;
  if (b.lines) {
    const lines = b.lines, inner = (b.width ?? 200) - 38;
    opts.content = () => { for (const l of lines) para(l.text, inner, l.cls); };
  } else if (b.name && b.name !== b.text) {
    opts.content = () => { ui.style(style === "btn-top" ? "btn-top-label" : "btn-label").label(b.text); };
  } else if (b.width != null && btnWidth(b) > b.width) {
    opts.content = () => { ui.style("wrap").paragraph(b.text, Math.max(20, b.width! - (PADX[style] ?? 44) - 4)); };
  }
  const name = b.name ?? (b.lines ? b.lines.map((l) => l.text).join(". ") : b.text);
  if (ui.style(style, s).id(b.id).button(name, opts) && fresh()) later(b.act);
}
/** Buttons at their own widths in rows wrapping at `width` (flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 12, justify: "start" | "center" = "start"): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? btnWidth(b));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => { for (const b of row) button({ ...b, width: bw(b) }); }, { spacing: gap, width, justify, align: "center" }));
  }, { spacing: gap, width, align: justify === "center" ? "center" : "start" });
}
/** CSS grid repeat(auto-fit, minmax(min, 1fr)). */
function gridOf<X>(label: string, items: X[], width: number, min: number, gap: number, cell: (item: X, w: number, i: number) => void): void {
  const cols = Math.max(1, Math.min(items.length, Math.floor((width + gap) / (min + gap))));
  const cw = (width - gap * (cols - 1)) / cols;
  ui.column(label, () => {
    for (let r = 0; r * cols < items.length; r++) {
      ui.row(`${label}-r${r}`, () => {
        for (let c = 0; c < cols && r * cols + c < items.length; c++) {
          const i = r * cols + c;
          ui.column(`${label}-c${i}`, () => cell(items[i]!, cw, i), { width: cw, align: "stretch" });
        }
      }, { spacing: gap, width, align: "stretch" });
    }
  }, { spacing: gap, width });
}

// ------------------------------------------------------------------ the frame
let lastTable: ui.Rect | null = null;
/** Builds the frame's UI; the table's rectangle (window pixels) on the game screen, else null. */
export function drawScreens(): { x: number; y: number; w: number; h: number } | null {
  const L0 = layoutNow();
  const f = frame();
  const game = app.screen === "game" && !!session;
  // the page background (around the table on the game screen)
  if (!game || !lastTable) draw.box(0, 0, f.width, f.height, "page");
  else {
    const r = lastTable;
    const strip = (x: number, y: number, w: number, h: number): void => {
      if (w > 0 && h > 0) draw.box(0, 0, f.width, f.height, "page", { clip: { x, y, width: w, height: h } });
    };
    strip(0, 0, f.width, r.y);
    strip(0, r.y + r.height, f.width, f.height - r.y - r.height);
    strip(0, r.y, r.x, r.height);
    strip(r.x + r.width, r.y, f.width - r.x - r.width, r.height);
  }
  let table: ui.Rect | null = null;
  ui.column("page", () => {
    if (game) table = gameScreen(L0);
    else menuScreen(L0);
  }, { width: L0.lw, height: L0.lh, align: "center", spacing: 0 });
  dialogs(L0);
  toasts(L0);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
  lastTable = table;
  const t = table as ui.Rect | null;
  return t && t.width > 4 && t.height > 4 ? { x: t.x, y: t.y, w: t.width, h: t.height } : null;
}

// ------------------------------------------------------------------ the top bar
function topbar(L0: Layout, compact = false): void {
  const name = platform.displayName();
  const sync = platform.syncState();
  const syncWord = sync === "local" ? "" : T(sync === "synced" ? "syncSynced" : sync === "saving" ? "syncSaving" : "syncOffline");
  const syncCls = `sync-${sync === "local" ? "saving" : sync}`;
  const h1 = L0.inner < 520 || compact ? "h1-small" : "h1";
  const buttonsW = tw(T("optionsBtn"), "btn-top", "button") + 44 + 8 + 2;
  const nameW = name ? Math.min(140, tw(name, "profile")) : 0;
  const syncW = syncWord ? tw(syncWord, syncCls) : 0;
  const leftW = L0.inner - buttonsW - nameW - syncW - 40;
  const tag = T("tagline");
  ui.row("topbar", () => {
    ui.row("brand", () => {
      ui.style(h1).label("Wild Eights");
      if (leftW - tw("Wild Eights", h1) - 16 > Math.min(160, tw(tag, "tagline"))) para(tag, leftW - tw("Wild Eights", h1) - 16, "tagline");
    }, { spacing: 16, align: "center" });
    ui.spacer();
    if (name) ui.style("profile").label(nameW < tw(name, "profile") ? name.slice(0, 14) + "…" : name);
    if (syncWord) ui.style(syncCls).label(syncWord);
    button({ id: "btn-options", text: T("optionsBtn"), style: "btn-top", act: () => openMenu() });
    button({ id: "btn-help-top", text: "?", name: T("helpTopTitle"), style: "btn-top", act: () => show("help") });
  }, { width: L0.inner, spacing: 8, align: "center" });
}

// ------------------------------------------------------------------ menu screens
function menuScreen(L0: Layout): void {
  ui.column("menu-top", () => topbar(L0), { width: L0.inner, padding: { top: 12, bottom: 0 } });
  const h = L0.lh - (L0.inner < 520 ? 58 : 68);
  ui.scrollArea(`scroll-${app.screen}`, { width: L0.inner + 2 * L0.side, height: Math.max(100, h) }, () => {
    ui.column(`screen-${app.screen}`, () => {
      const w = L0.inner;
      switch (app.screen) {
        case "title": titleScreen(L0, w); break;
        case "modes": modesScreen(w); break;
        case "journey": journeyScreen(w); break;
        case "challenges": challengesScreen(w); break;
        case "setup": setupScreen(w); break;
        case "hosted": hostedScreen(w); break;
        case "results": resultsScreen(w); break;
        case "settings": settingsScreen(w); break;
        case "help": helpScreen(w); break;
        case "records": recordsScreen(w); break;
        default: break;
      }
    }, { width: L0.inner + 2 * L0.side, spacing: 12, padding: { top: L0.short ? 6 : 18, bottom: 24, start: L0.side, end: L0.side }, align: app.screen === "title" ? "center" : "start" });
  }, { scrollTo: frame().frame - app.openedFrame < 4 ? { top: 0 } : undefined });
}
function heading(text: string, w: number): void { para(text, w, w < 520 ? "h2-small" : "h2"); }
function backBtn(): void { flow("back-row", [{ id: "btn-back", text: T("back"), style: "btn-ghost", act: back }], 300); }

function titleScreen(L0: Layout, w: number): void {
  // the card fan (🂡🂸🂮 in the old page): three white playing-card outlines
  const fan = ["A♠", "8♥", "K♠"];
  const big = L0.short ? 0.45 : w < 520 ? 0.75 : 1;
  ui.row("card-fan", () => {
    for (const c of fan) {
      ui.widget(`fan-${c}`, {
        role: "none", size: { width: 80 * big, height: 112 * big },
        draw: (r, st) => {
          const k = st.scale * big;
          draw.strokeRoundRect(r.x + 3 * k, r.y + 3 * k, r.width - 6 * k, r.height - 6 * k, 8 * big, "#f2f5f8", 5 * big);
          draw.text(c.slice(0, 1), r.x + 10 * k, r.y + 4 * k, { size: 44 * k, color: "#f2f5f8" });
          draw.text(c.slice(1), r.x + r.width / 2, r.y + r.height * 0.42, { size: 52 * k, color: "#f2f5f8", align: "center" });
        },
      });
    }
  }, { spacing: 18 * big, justify: "center" });
  button({ id: "btn-play", text: T("play"), style: "btn-big", act: play });
  const rows: Btn[][] = [
    [{ id: "btn-daily", text: T("dailyChallenge"), act: startDaily }, { id: "btn-journey", text: T("journey"), act: () => show("journey") }, { id: "btn-hosted", text: T("hostedPlay"), act: () => show("hosted") }],
    [{ id: "btn-settings", text: T("settings"), style: "btn-ghost", act: () => show("settings") }, { id: "btn-help", text: T("howToPlay"), style: "btn-ghost", act: () => show("help") },
      { id: "btn-records", text: T("records"), style: "btn-ghost", act: () => show("records") }],
  ];
  const acct: Btn[] = [];
  if (!platform.signedIn()) acct.push({ id: "btn-signin", text: T("signIn"), style: "btn-ghost", act: signIn });
  else if (platform.inviteLink()) acct.push({ id: "btn-invite", text: T("invite"), style: "btn-ghost", act: invite });
  if (acct.length) rows.push(acct);
  rows.forEach((r, i) => flow(`title-row-${i}`, r, w, 12, "center"));
  const doc = platform.progress();
  const done = Object.keys(doc.journey).filter((k) => doc.journey[k]!.won).length;
  para(doc.records.roundsPlayed === 0 ? T("welcome") : T("titleProgress", { done, total: C.JOURNEY.length, streak: doc.streak, best: doc.records.bestScore }), w, "muted", "title-progress");
}

function modeCard(id: string, strong: string, text: string, em: string, act: () => void, w: number): void {
  button({ id, text: strong, style: "mode-card", width: w, minH: 120, act, lines: [{ text: strong, cls: "mode-strong" }, { text, cls: "mode-text" }, { text: em, cls: "mode-em" }] });
}
function modesScreen(w: number): void {
  heading(T("chooseMode"), w);
  const modes: [string, string, string, string, () => void][] = [
    ["mode-learn", T("modeLearn"), T("modeLearnText"), T("modeLearnMeta"), startLearn],
    ["mode-journey", T("journey"), T("modeJourneyText"), T("modeJourneyMeta"), () => show("journey")],
    ["mode-daily", T("modeDaily"), T("modeDailyText"), T("modeDailyMeta"), startDaily],
    ["mode-practice", T("modePractice"), T("modePracticeText"), T("modePracticeMeta"), () => show("setup")],
    ["mode-challenge", T("modeChallenge"), T("modeChallengeText"), T("modeChallengeMeta"), () => show("challenges")],
    ["mode-hosted", T("hostedPlay"), T("modeHostedText"), T("modeHostedMeta"), () => show("hosted")],
  ];
  gridOf("mode-grid", modes, Math.min(900, w), w < 1024 ? 180 : 220, 14, (m, cw) => modeCard(m[0], m[1], m[2], m[3], m[4], cw));
  backBtn();
}
function journeyScreen(w: number): void {
  heading(T("journey"), w);
  const doc = platform.progress();
  const done = C.JOURNEY.filter((s) => doc.journey[s.id]?.won).length;
  para(T("journeySummary", { n: done, total: C.JOURNEY.length }), w, "muted");
  gridOf("journey-grid", C.JOURNEY, w, 150, 10, (stage, cw) => {
    const prog = doc.journey[stage.id];
    const prev = doc.journey[`j${stage.index - 1}`];
    const unlocked = stage.index === 1 || !!prev?.won || !!prog?.won;
    const em = prog?.won ? T("stageMoves", { n: prog.bestMoves ?? "–" }) : unlocked ? T("stageOpen") : "🔒";
    button({
      id: `stage-${stage.index}`, text: String(stage.index), style: prog?.won ? "journey-won" : "journey-stage", width: cw, minH: 84, disabled: !unlocked,
      act: () => startJourneyStage(stage), lines: [{ text: String(stage.index), cls: "stage-num" }, { text: L.stageName(stage), cls: "stage-text" }, { text: em, cls: "stage-em" }],
      name: `${stage.index}. ${L.stageName(stage)}. ${em}`,
    });
  });
  backBtn();
}
function challengesScreen(w: number): void {
  heading(T("challengesH"), w);
  para(T("challengesText"), w, "muted");
  gridOf("challenge-grid", C.CHALLENGES, Math.min(900, w), w < 1024 ? 180 : 220, 14, (ch, cw) => {
    const cd = TN("challenges", ch.id, [ch.name, ch.desc]);
    modeCard(`ch-${ch.id}`, cd[0]!, cd[1]!, T("challengeMeta", { seed: ch.seed, n: ch.players }), () => startChallenge(ch), cw);
  });
  backBtn();
}
function radioRow(label: string, legend: string, options: [string, number][], value: number, set: (v: number) => void, w: number): void {
  ui.column(`${label}-fs`, () => {
    ui.style("legend").label(legend);
    ui.row(label, () => {
      for (const [text, v] of options) button({ id: `${label}-${v}`, text, style: "btn-small", selected: v === value, act: () => set(v) });
    }, { spacing: 8, role: "radiogroup" });
  }, { style: "fieldset", width: Math.min(w, 520), spacing: 10 });
}
function setupScreen(w: number): void {
  heading(T("practiceSetup"), w);
  radioRow("players", T("rivals"), [[T("rival1"), 2], [T("rival2"), 3], [T("rival3"), 4]], app.setup.players, (v) => { app.setup.players = v; }, w);
  radioRow("difficulty", T("difficulty"), [[T("relaxed"), 0], [T("regular"), 1], [T("expert"), 2]], app.setup.difficulty, (v) => { app.setup.difficulty = v; }, w);
  para(T("practiceNote"), w, "muted");
  flow("setup-actions", [{ id: "btn-start", text: T("start"), style: "btn-primary", act: startPractice }, { id: "btn-back", text: T("back"), style: "btn-ghost", act: back }], w);
}

function hostedScreen(w: number): void {
  const H = app.hosted;
  heading(T("hostedH"), w);
  if (!platform.signedIn()) {
    para(T("hostedSignIn"), w, "muted");
    flow("hosted-signin", [{ id: "btn-hosted-signin", text: T("signIn"), style: "btn-primary", act: signIn }], w);
  } else if (!H.lobby) {
    para(T("hostedText"), Math.min(w, 700), "muted");
    flow("hosted-join", [
      { id: "btn-host", text: T("hostTable"), style: "btn-primary", act: hostTable, disabled: H.busy },
      { id: "btn-quick-join", text: T("quickJoin"), act: quickJoin, disabled: H.busy },
    ], w);
    ui.row("join-form", () => {
      ui.style("text").label(T("tableCode"));
      H.code = ui.textField("join-code", H.code, { maxChars: 32, width: Math.min(200, w - 200), placeholder: T("codePlaceholder") });
      if (ui.submitted("join-code") && fresh()) later(joinByCode);
      button({ id: "btn-join", text: T("join"), act: joinByCode, disabled: H.busy });
    }, { spacing: 12, align: "center" });
    if (H.invites.length) {
      para(T("tableInvites"), w, "muted");
      flow("hosted-invites", H.invites.map((inv) => ({ id: `inv-${inv.id}`, text: inv.from ? T("joinNamed", { name: inv.from }) : T("joinTable"), style: "btn-small", act: () => acceptInvite(inv.id) })), w, 8);
    }
  } else {
    const lobby = H.lobby;
    para(`${T("tableH")} ${lobby.code ?? String(lobby.room.id).slice(0, 6)}`, w, "h3");
    for (const [i, line] of rosterLines().entries()) para(`• ${line}`, w, "text", `lobby-p${i}`);
    const list: Btn[] = [];
    if (lobby.host) list.push({ id: "btn-start-hosted", text: T("startRound"), style: "btn-primary", act: hostedStart, disabled: lobby.starting || !!H.table });
    if (lobby.host) list.push({ id: "btn-invite-friend", text: T("invite"), style: "btn-ghost", act: showFriends });
    list.push({ id: "btn-leave-hosted", text: T("leave"), style: "btn-ghost", act: () => { hostedLeave(); app.hosted.status = { key: "leftTable" }; } });
    flow("lobby-actions", list, w);
    if (H.friends) {
      if (!H.friends.length) para(T("noFriends"), w, "muted");
      else {
        para(T("inviteAFriend"), w, "muted");
        flow("lobby-friends", H.friends.map((f) => ({
          id: `friend-${f.userId}`, text: H.invited.includes(f.userId) ? T("invited") : T("inviteName", { name: f.name }) + (f.online ? " ●" : ""), style: "btn-small",
          disabled: H.invited.includes(f.userId), act: () => inviteFriend(f.userId),
        })), w, 8);
      }
    }
  }
  const status = msgText(H.status);
  if (status) para(status, w, H.status && /Failed|Unavailable|Code|Left|disconnected|terms|enter/i.test(H.status.key) ? "error-text" : "muted", "hosted-status");
  backBtn();
}

function resultsScreen(w: number): void {
  const r = app.results;
  if (!r) { backBtn(); return; }
  heading(T("roundOver"), w);
  para(r.headline, w, "headline", "results-headline");
  const tw0 = Math.min(w, 520);
  ui.column("results-table", () => {
    ui.style("caption").label(T("scoreBreakdown"));
    const cols = [tw0 * 0.5, tw0 * 0.25, tw0 * 0.25];
    const rowOf = (id: string, cells: string[], cls: string): void => {
      ui.row(id, () => cells.forEach((c, i) => ui.column(`${id}-${i}`, () => para(c, cols[i]! - 32, cls), { width: cols[i]! })), { style: "row-rule", width: tw0 });
    };
    rowOf("res-head", [T("colPlayer"), T("colCardsLeft"), T("colPoints")], "th");
    r.rows.forEach((row, i) => rowOf(`res-${i}`, [row.winner ? `${row.name} ★` : row.name, String(row.cards), String(row.points)], "td"));
    rowOf("res-foot", [T("winnersScore"), "", String(r.total)], "td-foot");
  }, { width: tw0, spacing: 0 });
  para(r.extra, w, "muted", "results-extra");
  const lb = app.lb;
  if (lb) para(lb === "posting" ? T("lbPosting") : !lb.posted ? T("lbNotPosted") : lb.rank ? T("lbRank", { rank: lb.rank }) : T("lbPosted"), w, "muted", "results-lb");
  if (r.unlocked.length) para(T("unlockedList", { list: r.unlocked.map(achievementName).join(", ") }), w, "achievements");
  const list: Btn[] = [{ id: "btn-again", text: r.hosted ? T("hostedPlay") : T("playAgain"), style: "btn-primary", act: playAgain }];
  if (r.nextStage) list.push({ id: "btn-next-stage", text: T("nextStage"), act: nextStage });
  list.push({ id: "btn-results-menu", text: T("menu"), style: "btn-ghost", act: leaveToTitle });
  flow("results-actions", list, w);
}

function settingsScreen(w: number): void {
  heading(T("settings"), w);
  const o = platform.options;
  const fw = Math.min(w, 520);
  ui.column("fs-look", () => {
    ui.style("legend").label(T("appearance"));
    ui.row("theme-row", () => {
      ui.style("text").label(T("theme"));
      const idx = Math.max(0, C.THEMES.findIndex((t) => t.id === o.theme));
      const next = ui.id("opt-theme").select(T("theme"), idx, C.THEMES.map((t) => ({ text: TN("themes", t.id, t.name) })));
      if (next !== idx) platform.setOption("theme", C.THEMES[next]!.id);
    }, { spacing: 12, align: "center" });
    const cvd = ui.id("opt-cvd").checkbox(T("cvdPalette"), o.cvdPalette);
    if (cvd !== o.cvdPalette) platform.setOption("cvdPalette", cvd);
    const lefty = ui.id("opt-lefthand").checkbox(T("leftHanded"), o.leftHanded);
    if (lefty !== o.leftHanded) platform.setOption("leftHanded", lefty);
  }, { style: "fieldset", width: fw, spacing: 10 });
  ui.column("fs-runtime", () => {
    ui.style("legend").label(T("optionsLegend"));
    para(T("optionsNote"), fw - 34, "muted");
    button({ id: "btn-open-options", text: T("optionsBtn"), act: () => openMenu() });
  }, { style: "fieldset", width: fw, spacing: 10 });
  ui.column("fs-progress", () => {
    ui.style("legend").label(T("progress"));
    flow("progress-actions", [
      { id: "btn-replay-tutorial", text: T("replayTutorial"), style: "btn-ghost", act: startLearn },
      { id: "btn-wipe", text: T("wipe"), style: "btn-danger", act: openWipe },
    ], fw - 34);
  }, { style: "fieldset", width: fw, spacing: 10 });
  backBtn();
}

function helpScreen(w: number): void {
  heading(T("helpH"), w);
  const arts: [string, string][] = [
    [T("goal"), T("goalText")], [T("matching"), T("matchingText")], [T("eights"), T("eightsText")], [T("drawing"), T("drawingText")],
    [T("controls"), [
      T("keysPlay", { prev: keysFor("prev_card"), next: keysFor("next_card"), play: keysFor("play_card") }),
      T("keysActions", { draw: keysFor("draw"), hint: keysFor("hint"), undo: keysFor("undo"), pause: keysFor("pause"), camera: keysFor("camera") }),
      T("helpTap"),
    ].join("\n")],
    [T("fairPlay"), T("fairText")],
  ];
  gridOf("help-rules", arts, Math.min(900, w), 240, 14, (a, cw) => {
    ui.column(`art-${a[0]}`, () => {
      ui.style("h3").label(a[0]);
      for (const line of a[1].split("\n")) para(line, cw - 34, "text");
    }, { style: "article", width: cw, spacing: 6 });
  });
  backBtn();
}

function recordsScreen(w: number): void {
  heading(T("records"), w);
  const d = platform.progress();
  para(T("recordsLine", { played: d.records.roundsPlayed, won: d.records.roundsWon, best: d.records.bestScore, streak: d.bestStreak }), w, "text");
  para(T("dailyDays", { n: d.dailyDays.length }), w, "text");
  ui.style("h3").label(T("achievementsH"));
  for (const a of C.ACHIEVEMENTS) {
    const got = !!d.achievements[a.id];
    const ad = TN("achievements", a.id, [a.name, a.desc]);
    para(`${got ? "★" : "☆"} ${ad[0]} — ${ad[1]}`, w, got ? "ach-got" : "ach", `ach-${a.id}`);
  }
  if (app.board && app.board.length) {
    ui.style("h3").label(T("leaderboardH"));
    const tw0 = Math.min(w, 480);
    const cols = [60, tw0 - 160, 100];
    const rowOf = (id: string, cells: string[], cls: string): void => {
      ui.row(id, () => cells.forEach((c, i) => ui.column(`${id}-${i}`, () => para(c, cols[i]! - 32, cls), { width: cols[i]! })), { style: "row-rule", width: tw0 });
    };
    rowOf("lb-head", ["#", T("colPlayer"), T("colScore")], "th");
    app.board.forEach((r, i) => rowOf(`lb-${i}`, [String(r.rank), r.name, String(r.score)], r.me ? "td-foot" : "td"));
  }
  backBtn();
}

// ------------------------------------------------------------------ the game screen
const SUIT_INK: Record<string, string> = { hearts: "#b03030", diamonds: "#b06820", clubs: "#206050", spades: "#2848a0" };
function cardButton(card: Card, legal: boolean, selected: boolean, onTurn: boolean): void {
  const text = `${W.rankName(card.rank)} ${suitGlyph(card.suit)}`;
  const width = Math.max(52, tw(text, "btn-label") + 24);
  const name = legal && onTurn ? T("cardPlayable", { card: cardName(card) }) : cardName(card);
  const r = ui.widget(name, {
    role: "button", size: { width, height: 48 },
    draw: (rc, st) => {
      const k = st.scale;
      const y = rc.y + (selected ? -4 * k : 0);
      if (legal) draw.roundRect(rc.x - 3 * k, y - 3 * k, rc.width + 6 * k, rc.height + 6 * k, 10, "#9fe6a0");
      if (selected) draw.strokeRoundRect(rc.x - 4 * k, y - 4 * k, rc.width + 8 * k, rc.height + 8 * k, 11, "#ffb050", 3);
      draw.roundRect(rc.x, y, rc.width, rc.height, 8, st.hovered ? "#ffffff" : "#fdfdf8");
      draw.roundRect(rc.x, y, rc.width, 5 * k, 3, SUIT_INK[card.suit] ?? "#222222");
      draw.text(text, rc.x + rc.width / 2, y + (rc.height - 22 * k) / 2 + 2 * k, { size: 19 * k, weight: 600, color: SUIT_INK[card.suit] ?? "#222222", align: "center" });
    },
  });
  if (r.activated && fresh()) { const id = card.id; later(() => { ui.setFocus(null); app.selected = id; rerender(); onCardChosen(id); }); }
}
function handZone(w: number, lefty: boolean): void {
  const s = session!;
  const st = s.state;
  const hand = st.hands[mySeat()] ?? [];
  const legal = legalNow();
  const onTurn = humanTurn();
  const flash = nowMs() < app.flash;
  ui.column("hand-zone", () => {
    const iw = w - 28;
    para(st.activeSuit ? T("activeSuit", { glyph: suitGlyph(st.activeSuit), suit: L.suitName(st.activeSuit) }) : " ", iw, "suit-banner");
    // the hand, wrapping (flex-wrap)
    const rows: Card[][] = [[]];
    let used = 0;
    for (const c of hand) {
      const cw = Math.max(52, tw(`${W.rankName(c.rank)} ${suitGlyph(c.suit)}`, "btn-label") + 24);
      if (rows[rows.length - 1]!.length && used + 8 + cw > iw) { rows.push([]); used = 0; }
      used += (rows[rows.length - 1]!.length ? 8 : 0) + cw;
      rows[rows.length - 1]!.push(c);
    }
    ui.column("hand-list", () => {
      rows.forEach((row, ri) => ui.row(`hand-r${ri}`, () => { for (const c of row) cardButton(c, onTurn && legal.includes(c.id), c.id === app.selected, onTurn); }, { spacing: 8 }));
    }, { spacing: 10, background: flash ? "rgba(224, 96, 96, 0.35)" : undefined, padding: { top: 4, bottom: 4 } });
    const opp = opponentsText();
    const drawBtn = (): void => button({ id: "btn-draw", text: T("draw"), name: T("draw"), act: () => { ui.setFocus(null); drawCard(); }, disabled: !onTurn });
    const dw = btnWidth({ id: "", text: T("draw"), act: () => undefined });
    ui.row("tray", () => {
      if (!lefty) drawBtn();
      if (lefty) ui.spacer();
      ui.column("opp", () => para(opp, iw - dw - 24, "muted", "opponents-text"), {});
      if (lefty) drawBtn();
    }, { spacing: 14, align: "center", width: iw });
  }, { style: "hand-zone", width: w, spacing: 6 });
}
function hudButtons(): Btn[] {
  const s = session!;
  return [
    { id: "btn-hint", text: T("hint"), style: "btn-small", act: () => { ui.setFocus(null); hint(); }, disabled: !humanTurn() },
    { id: "btn-undo", text: T("undo"), style: "btn-small", act: () => { ui.setFocus(null); undo(); }, disabled: !canUndo() },
    { id: "btn-pause", text: T("pause"), style: "btn-small", act: openPause, disabled: s.over },
  ];
}
function lessonPanel(w: number, small: boolean): void {
  const l = currentLesson();
  if (!l) return;
  ui.column("tutorial", () => {
    para(l.title, w - 34, small ? "objective" : "tut-h", "tutorial-title");
    para(l.body, w - 34, small ? "turn" : "text", "tutorial-body");
    if (!small) para(T("lessonOf", { n: l.n, total: C.TUTORIAL.length }), w - 34, "muted");
  }, { style: "tutorial", width: Math.min(w, small ? w : 700), spacing: small ? 2 : 6, padding: small ? { top: 6, bottom: 6, start: 12, end: 12 } : undefined });
}
function gameScreen(L0: Layout): ui.Rect {
  const lefty = platform.options.leftHanded;
  let table: ui.Rect | null = null;
  if (L0.short) {
    // landscape phones: lesson across the top, then HUD | table | hand (no page header)
    ui.column("game", () => {
      lessonPanel(L0.inner, true);
      ui.row("game-row", () => {
        ui.column("hud-col", () => {
          para(objectiveText(), 140, "objective-small", "objective-text");
          para(turnText(), 140, "turn-small", "turn-text");
          flow("hud-actions", hudButtons(), 140, 6);
        }, { width: 140, spacing: 6 });
        table = ui.spacer();
        ui.scrollArea("hand-scroll", { width: 230, height: Math.max(80, L0.lh - 16 - (currentLesson() ? 70 : 0)) }, () => handZone(222, lefty));
      }, { width: L0.inner, grow: 1, spacing: 8, align: "start" });
    }, { width: L0.inner, height: L0.lh, spacing: 8, padding: { top: 6, bottom: 6 } });
  } else {
    ui.column("game", () => {
      topbar(L0);
      const btns = hudButtons();
      const bw = btns.reduce((a, b) => a + btnWidth(b) + 8, 0);
      const stack = L0.portrait || L0.inner - bw < 320;
      const tw0 = stack ? L0.inner : L0.inner - bw - 12;
      ui.row("hud-top", () => {
        ui.column("hud-text", () => {
          para(objectiveText(), tw0, "objective", "objective-text");
          para(turnText(), tw0, "turn", "turn-text");
        }, { spacing: 2, width: tw0 });
        if (!stack) { ui.spacer(); flow("hud-actions", btns, bw, 8); }
      }, { width: L0.inner, align: "start" });
      if (stack) flow("hud-actions", btns, L0.inner, 8);
      lessonPanel(L0.inner, false);
      table = ui.spacer();
      handZone(L0.inner, lefty);
    }, { width: L0.inner, height: L0.lh, spacing: 10, padding: { top: 12, bottom: L0.portrait ? 12 : 20 } });
  }
  return table!;
}

// ------------------------------------------------------------------ dialogs and toasts
function dialogs(L0: Layout): void {
  const d = app.dialog;
  if (!d) return;
  const opening = !fresh();
  if (d === "suit") {
    ui.dialog("suit-dialog", "", true, () => {
      ui.style(L0.inner < 520 ? "h2-small" : "h2").label(T("declareSuit"));
      const items = suitOrder();
      const cw = Math.min(200, (Math.min(420, L0.inner) - 14) / 2);
      gridOf("suit-grid", items, cw * 2 + 14, cw, 14, (it, w, i) => {
        const name = T("suitOption", { suit: L.suitName(it.suit), n: it.n });
        if (ui.style("suit-btn", { width: w }).id(i === 0 ? "dialog-first" : `suit-${it.suit}`).button(name, {
          content: () => {
            ui.style("suit-glyph", { text: { color: SUIT_INK[it.suit] } }).label(suitGlyph(it.suit));
            ui.style("suit-name").label(name);
          },
        }) && fresh()) { const suit: Suit = it.suit; later(() => declare(suit)); }
      });
    });
  } else if (d === "pause") {
    const open = ui.dialog("pause-dialog", "", true, () => {
      ui.column("pause-col", () => {
        ui.style("h2").label(T("paused"));
        const list: Btn[] = [
          { id: "dialog-first", text: T("resume"), style: "btn-primary", act: resume },
          { id: "btn-pause-options", text: T("optionsBtn"), act: () => openMenu() },
          { id: "btn-pause-help", text: T("howToPlay"), act: () => { closeDialog(); show("help"); app.stack = ["game" as Screen]; } },
        ];
        if (!session?.hosted) list.push({ id: "btn-restart-round", text: T("restartRound"), act: restartRound });
        list.push({ id: "btn-quit", text: T("leaveRound"), style: "btn-ghost", act: leaveToTitle });
        for (const b of list) button({ ...b, width: Math.min(320, L0.inner - 40) });
      }, { spacing: 12, align: "center" });
    });
    if (!open && !opening) later(resume);
  } else if (d === "wipe") {
    const open = ui.dialog("wipe-dialog", "", true, () => {
      ui.column("wipe-col", () => {
        para(T("wipeConfirm"), Math.min(420, L0.inner - 40), "text");
        flow("wipe-actions", [
          { id: "dialog-first", text: T("cancel"), style: "btn-ghost", act: closeDialog },
          { id: "btn-wipe-yes", text: T("wipe"), style: "btn-danger", act: wipeProgress },
        ], Math.min(420, L0.inner - 40), 12, "center");
      }, { spacing: 14, align: "center", style: "fieldset" });
    });
    if (!open && !opening) later(closeDialog);
  }
}
function toasts(L0: Layout): void {
  if (!app.toasts.length) return;
  ui.place("toasts", { anchor: "bottom", y: L0.short ? 12 : 120 }, () => {
    for (const [i, t] of app.toasts.entries()) {
      ui.column(`toast-${i}`, () => para(t.text, Math.min(420, L0.inner - 40), "toast-text"), { style: "toast" });
    }
  }, { spacing: 8, align: "center" });
}
