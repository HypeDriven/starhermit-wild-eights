// The look per graphics level: the browser build's four presets and budgets
// (gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU its
// Auto gave it) keyed by the runtime's quality tier (frame().quality); the
// sparks and dust motes scale within the tier with the level
// (frame().levelIndex, at most 2×) as the browser build scaled them by its
// hardware level. The runtime owns the rest of the old Graphics panel: Auto
// and the level choice, render scale (Ultra's 1.25) and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The panel's
// per-effect overrides are not offered (Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  material: "lambert" | "standard" | "physical";
  cardTex: number; surfTex: number; segments: number; sparks: number; dust: number; bloomRes: number; aoRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  detailed: boolean;
  particles: "low" | "high";
  animated: boolean;
  budget: Budget;
}
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, particles: "low", animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", cardTex: 1, surfTex: 0.5, segments: 0.5, sparks: 0.5, dust: 40, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", cardTex: 1.5, surfTex: 1, segments: 0.75, sparks: 0.75, dust: 60, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", cardTex: 2, surfTex: 1, segments: 1, sparks: 1, dust: 90, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", cardTex: 3, surfTex: 2, segments: 1.5, sparks: 1.5, dust: 160, bloomRes: 1, aoRes: 1 },
};
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
const DUST_MAX = 320, SPARK_MAX = 3;

export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b: Budget = { ...BUDGETS[preset] };
  const k = Math.min(2, Math.pow(1.5, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k * 100) / 100);
  b.dust = Math.min(DUST_MAX, Math.round(b.dust * k));
  return { preset, ...TABLE[preset], budget: b };
}
