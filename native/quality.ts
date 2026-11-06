// The look per graphics level. The engine's level table (levelSettings()) owns
// shadows and their map size, AO, bloom, the grade and anti-aliasing; the
// game's art (materials, texture sizes, segments, reflections, sparks, dust)
// stays the browser build's four presets (gfx.js TABLE / BUDGETS) keyed by the
// runtime's quality tier, with the sparks and dust motes scaled within the tier
// by the level's particle budget (at most 2×). The runtime owns the rest of the
// old Graphics panel: Auto and the level choice, render scale (Ultra's 1.25) and
// the pixel-ratio cap, adaptive resolution, the frame-rate limit and readout.
// The panel's per-effect overrides are not offered (Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  material: "lambert" | "standard" | "physical";
  cardTex: number; surfTex: number; segments: number; sparks: number; dust: number;
}
interface Art { reflections: boolean; detailed: boolean; particles: "low" | "high"; animated: boolean }
export interface Look extends Art {
  preset: QualityTier;
  shadows: number; // the level's shadowMapSize, 0 = off
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  bloom: number | null; // the level's bloom resolution
  grade: boolean;
  antialias: AntialiasMode;
  budget: Budget;
}
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { reflections: true, detailed: true, particles: "low", animated: true },
  high: { reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", cardTex: 1, surfTex: 0.5, segments: 0.5, sparks: 0.5, dust: 40 },
  balanced: { material: "standard", cardTex: 1.5, surfTex: 1, segments: 0.75, sparks: 0.75, dust: 60 },
  high: { material: "physical", cardTex: 2, surfTex: 1, segments: 1, sparks: 1, dust: 90 },
  ultra: { material: "physical", cardTex: 3, surfTex: 2, segments: 1.5, sparks: 1.5, dust: 160 },
};
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
const DUST_MAX = 320, SPARK_MAX = 3;

export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  const b = BUDGETS[preset];
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: { ...b, sparks: Math.min(SPARK_MAX, Math.round(b.sparks * k * 100) / 100), dust: Math.min(DUST_MAX, Math.round(b.dust * k)) },
  };
}
