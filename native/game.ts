// The browser build's pure modules, shared unchanged with the node tests and
// server.js, typed for this client: the rules (js/game.js), the content
// (js/content.js: five themes, 40 Journey stages, four challenges, four
// lessons, seven achievements), the progress document (js/save.js) and the
// hosted-table clients (js/online.js).
import "../js/game.js";
import "../js/content.js";
import "../js/save.js";
import "../js/online.js";

export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export interface Card { id: number; suit: Suit | "?"; rank: number }
export interface Score { winner: number; total: number; breakdown: { player: number; cards: number; points: number }[] }
export interface State {
  version: number; seed: number; rngState: number; tick: number; players: number; difficulty: number; current: number; direction: number;
  winner: number | null; terminalReason: string | null; activeSuit: Suit | null; pendingSuitFor: number | null;
  hands: Card[][]; stock: Card[]; discardPile: Card[]; moveCount: number; invalidActions: number; score: Score | null;
}
export type Cmd = { type: "play"; cardId: number } | { type: "draw" } | { type: "declareSuit"; suit: Suit };
export interface GameEvent { type: string; player?: number; cardId?: number; suit?: string; rank?: number; count?: number; cardIds?: number[]; reason?: string; k?: string }
interface Rules {
  SUITS: Suit[]; rankName(r: number): string; cardPoints(c: Card): number; cardById(id: number): Card;
  newGame(seed: number, o: { players: number; handSize?: number; difficulty?: number }): State;
  legalActions(s: State): { player: number; plays: number[]; canDraw: boolean; mustDeclareSuit: boolean; over?: boolean };
  applyCommand(s: State, c: Cmd): { state: State; events?: GameEvent[]; error?: string };
  aiCommand(s: State, difficulty: number): Cmd | null;
  serialize(s: State): unknown; publicSnapshot(s: State, seat: number): unknown; deserialize(o: unknown, seat?: number): State; dailySeed(d: Date): number;
}
export interface Theme { id: string; name: string; felt: number; wood: number; wall: number; lamp: number; sky: number }
export interface Stage { id: string; index: number; players: number; difficulty: number; handSize?: number; par: number; moveLimit?: number; mastery?: boolean; seed: number; name: string }
export interface Challenge { id: string; name: string; desc: string; seed: number; players: number; difficulty: number; handSize?: number; moveLimit?: number; noUndo?: boolean }
export interface Lesson { id: string; title: string; body: string; require: "play" | "eight" | "draw" | "finish" }
interface Content {
  THEMES: Theme[]; JOURNEY: Stage[]; CHALLENGES: Challenge[]; TUTORIAL: Lesson[]; ACHIEVEMENTS: { id: string; name: string; desc: string }[];
}
export interface Doc {
  version: number; journey: Record<string, { won: boolean; bestMoves: number | null }>; achievements: Record<string, boolean>;
  streak: number; bestStreak: number; dailyDays: string[]; records: { bestScore: number; roundsPlayed: number; roundsWon: number }; tutorialDone: boolean;
}
export interface Options { theme: string; cvdPalette: boolean; leftHanded: boolean }
interface SaveApi {
  fresh(): Doc; readDoc(raw: unknown): Doc; merge(local: unknown, remote: unknown): Doc; same(a: unknown, b: unknown): boolean;
  recordRound(doc: Doc, r: { mode: string; stageId: string | null; won: boolean; score: number; moves: number; eightsPlayed: number; invalid: number; hints: number; day: string | null; journeyTotal: number }): string[];
  DEFAULT_OPTIONS: Options; pickOptions(raw: unknown): Partial<Options>; BROWSER_KEYS: string[];
}
const g = globalThis as unknown as { WEGame: Rules; WEContent: Content; WESave: SaveApi; WEOnline: unknown };
export const W = g.WEGame;
export const C = g.WEContent;
export const Sv = g.WESave;
export const Online = g.WEOnline as {
  hostTable(p: unknown, name?: string): Promise<import("starhermit:platform").Room>;
  quickJoin(p: unknown, name?: string): Promise<import("starhermit:platform").Room>;
  joinCode(p: unknown, code: string): Promise<import("starhermit:platform").Room | null>;
  LobbyClient: new (p: unknown, room: import("starhermit:platform").Room, hooks: { onChange?: () => void; onPlaying?: (r: import("starhermit:platform").Room) => void; onClosed?: (reason: string) => void }) => Lobby;
  TableClient: new (p: unknown, room: import("starhermit:platform").Room, hooks: { onSnap?: (s: Snap) => void; onRejected?: (r: string) => void; onChange?: () => void }) => Table;
};
export interface Lobby {
  room: import("starhermit:platform").Room; connected: boolean; unavailable: boolean; starting: boolean; readonly host: boolean;
  readonly participants: readonly import("starhermit:platform").Participant[]; readonly code: string | null;
  connect(): void; start(): Promise<boolean>; leave(): Promise<void>; close(): void;
}
export interface Snap {
  type: "snap"; seat: number; names: string[]; ai: boolean[]; away: boolean[]; view: unknown; events: GameEvent[];
  over: { winner: number; reason: string; score: Score } | null;
}
export interface Table { room: import("starhermit:platform").Room; snap: Snap | null; connected: boolean; unavailable: boolean; readonly seat: number; connect(): void; send(c: Cmd): void; flush(): void; leave(): Promise<void>; close(): void }
