// Localization: assets/strings.json (generated from the browser build's tables:
// flat keys plus group.id keys for themes, challenges, tutorial and achievements,
// in the nine StarHermit locales) on the engine's strings, which follow the
// interface language the runtime reports (the player's choice in Options ›
// Language, else the account's preferred language or the device's) and own the
// locale fallback and the account strings (`starhermit.*`). Every string is
// drawn through T() each frame, so a change shows on the next frame while the
// round keeps running.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
/** A string in the player's language, `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars): string { return strings.t(key, vars); }
/** The engine's account strings (signIn, invite, inviteCopied, inviteLink, signedOut, leaderboard…). */
export function S(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
/** A content entry ([name, desc] pairs and theme names) in the player's language. */
export function TN<V extends string | string[]>(group: string, id: string, fallback: V): V {
  const key = `${group}.${id}`;
  if (typeof fallback === "string") return (strings.has(key) ? strings.t(key) : fallback) as V;
  return fallback.map((text, i) => (strings.has(`${key}.${i}`) ? strings.t(`${key}.${i}`) : text)) as V;
}
const suitName = (suit: string): string => T(`suit_${suit}`);
export const L = {
  suitName,
  /** "Q of hearts" in the current locale (rank symbols match the card faces). */
  cardName: (card: { rank: number; suit: string }, rankName: (r: number) => string): string => T("cardOf", { rank: rankName(card.rank), suit: suitName(card.suit) }),
  stageName(stage: { index: number }): string {
    const n = stage.index;
    if (n <= 8) return T("stage_local", { n });
    if (n <= 16) return T("stage_regional", { n });
    if (n <= 28) return T("stage_intercity", { n });
    if (n <= 36) return T("stage_express", { n });
    return T("stage_mastery", { n: n - 36 });
  },
};
