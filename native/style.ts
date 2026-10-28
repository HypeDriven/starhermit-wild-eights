// The look of the page, HUD, screens and dialogs: the browser build's
// styles.css, rewritten class-based in tools/ui-style.css and converted once
// with `starhermit css` into assets/ui-style.json (`npm run css`), registered
// at start with the theme the runtime's own widgets (scroll bars, focus
// rings, selects, check boxes) take. The runtime's high contrast option is
// the old body.high-contrast token set.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  "bg-top": "#1c2733", "bg-bottom": "#0e141b", panel: "rgba(255, 255, 255, 0.08)", "panel-solid": "#1a2530", ink: "#f2f5f8",
  muted: "#a8b6c2", accent: "#ffd9a0", "accent-strong": "#ffb050", legal: "#9fe6a0", danger: "#e06060", line: "rgba(255, 255, 255, 0.15)",
  border: "rgba(255, 255, 255, 0.25)",
};
const CONTRAST: Tokens = { panel: "rgba(0, 0, 0, 0.65)", muted: "#d0d8e0", accent: "#ffe9b0", border: "rgba(255, 255, 255, 0.6)" };
let current: Tokens = { ...BASE };
let css: ui.CssStyles | null = null;
let key = "";
export function initStyles(): void {
  css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 14, headingSize: 28, padding: 8, spacing: 8, radius: 10,
    text: BASE.ink!, muted: BASE.muted!, panel: "#1a2530", control: "#26323e", hovered: "#304050",
    pressed: "#3a4a5a", field: "#1a2530", accent: BASE["accent-strong"]!, focus: BASE["accent-strong"]!, outline: "#4a5866",
  });
  key = "";
  applyTokens(false);
}
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key || !css) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens({ ...css.tokens, ...current });
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$accent-strong", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "#4a5866", radius: 4 } } },
    dialog: { background: "rgba(10, 14, 20, 0)", border: { width: 0, color: "rgba(0,0,0,0)" }, padding: 16, parts: { backdrop: { background: "rgba(10, 14, 20, 0.88)" } } },
  });
  ui.setTheme({ text: current.ink!, muted: current.muted!, accent: current["accent-strong"]!, focus: current["accent-strong"]! });
}
export function token(name: string): string { return current[name] ?? "#000000"; }
