// Localization: the browser build's tables (js/strings.js, keyed, the nine
// StarHermit locales, read through js/i18n.js) in the interface language the
// runtime reports (preferences().language: the player's choice in Options ›
// Language, else the account's preferred language or the device's). The
// runtime's Options replace the game's own Language setting (sh-language.js)
// and the DOM re-labelling: every string is drawn through T() each frame, so
// a change shows on the next frame while the round keeps running.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import "../js/strings.js";
import "../js/i18n.js";

export type Vars = Record<string, string | number>;
interface I18nApi {
  t(key: string, vars?: Vars): string; tn(group: string, id: string, fallback?: unknown): unknown; setLocale(tag: string): string; locale(): string;
  suitName(s: string): string; cardName(c: { rank: number; suit: string }, rankName: (r: number) => string): string; stageName(s: { index: number }): string;
}
export const L = (globalThis as unknown as { WEI18N: I18nApi }).WEI18N;
let current = "";
function apply(tag: string): void {
  const next = L.setLocale(String(tag || "en-US"));
  if (next === current) return;
  current = next;
  ui.setLanguage(current);
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

/** A string of js/strings.js in the player's language, `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars): string { return L.t(key, vars); }
/** A content entry ([name, desc] pairs and theme names) in the player's language. */
export function TN<V>(group: string, id: string, fallback: V): V { return L.tn(group, id, fallback) as V; }
export function locale(): string { return current; }
