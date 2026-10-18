// Wild Eights — graphics quality model: presets, per-category overrides, StarHermit
// hardware-level detection, per-preset budgets and a cost summary. Pure (no DOM, no three.js), so the settings
// panel, the renderer and the Node tests agree on what a setting means.
// Exposes window.WEGfx (browser) and module.exports (Node).
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WEGfx = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var PRESETS = ["low", "balanced", "high", "ultra"];

  // Category -> allowed tiers, cheapest first.
  var CATEGORIES = {
    shadows: ["off", "low", "medium", "high"],
    ao: ["off", "on", "high"],
    bloom: ["off", "on"],
    grade: ["off", "on"],
    antialias: ["off", "fxaa", "smaa", "msaa"],
    reflections: ["off", "on"],     // image-based lighting on cards and brass
    detail: ["plain", "detailed"],  // lacquered card stock, felt/wood/carpet textures
    particles: ["low", "high"],     // play bursts; dust motes in the lamp light at high
    background: ["static", "animated"] // passing night scenery, lamp shimmer
  };
  var CATEGORY_ORDER = Object.keys(CATEGORIES);

  // Each preset is a row of tiers plus a render scale (multiplies the capped device pixel ratio).
  var TABLE = {
    low:      { scale: 1,    dprCap: 1,   shadows: "off",    ao: "off",  bloom: "off", grade: "off", antialias: "msaa", reflections: "off", detail: "plain",    particles: "low",  background: "static" },
    balanced: { scale: 1,    dprCap: 1.5, shadows: "low",    ao: "off",  bloom: "on",  grade: "on",  antialias: "fxaa", reflections: "on",  detail: "detailed", particles: "low",  background: "animated" },
    high:     { scale: 1,    dprCap: 2,   shadows: "medium", ao: "on",   bloom: "on",  grade: "on",  antialias: "smaa", reflections: "on",  detail: "detailed", particles: "high", background: "animated" },
    ultra:    { scale: 1.25, dprCap: 2,   shadows: "high",   ao: "high", bloom: "on",  grade: "on",  antialias: "msaa", reflections: "on",  detail: "detailed", particles: "high", background: "animated" }
  };

  var SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 =
  // RTX 5090; gpu-level.js → window.StarHermitGpu, a classic script loaded before this one; Node tests
  // require it): Low from 0, Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB
  // machines are capped at level 9.
  var LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
  var gpuMod = null;
  function gpuApi() {
    var g = typeof globalThis !== "undefined" ? globalThis : {};
    if (g.StarHermitGpu) return g.StarHermitGpu;
    if (!gpuMod && typeof require === "function") { try { gpuMod = require("./gpu-level.js"); } catch (e) { gpuMod = null; } }
    return gpuMod;
  }

  /** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
  function detectLevel(gpu, system) {
    var G = gpuApi(), sys = { webgl: true, webgl2: true }, k;
    if (system) for (k in system) sys[k] = system[k];
    sys.gpu = String(gpu || "");
    if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
    return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
  }

  /** The preset Auto starts from for a hardware level. */
  function presetForLevel(level) {
    var G = gpuApi();
    if (G) return G.presetForLevel(level, LEVELS);
    return PRESETS.filter(function (p) { return LEVELS[p] <= level; }).pop() || "low";
  }

  /** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
  function detectPreset(gpu, system) {
    return presetForLevel(detectLevel(gpu, system));
  }

  /*
   * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
   * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Cards, hit areas
   * and rules are identical on every preset — only visuals change.
   *   material  cards, wood and brass with Surface detail on: lambert (Low) / standard (Balanced) /
   *             physical clear-coat lacquer (High, Ultra); plain detail is always Lambert
   *   cardTex   card face/back texture scale over 128×180 px (Surface detail on; plain is 1)
   *   surfTex   felt / wood / carpet texture scale over the authored size
   *   segments  multiplies table skirt, rail, felt, brass ring, lamp shade and bulb segments
   *   sparks    multiplies play-burst sparks at Particles "high", scaled with the level
   *   dust      dust motes in the lamp light (Particles high), scaled with the level
   *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
   */
  var BUDGETS = {
    low:      { material: "lambert",  cardTex: 1,   surfTex: 0.5, segments: 0.5,  sparks: 0.5,  dust: 40,  bloomRes: 0.5, aoRes: 0.5 },
    balanced: { material: "standard", cardTex: 1.5, surfTex: 1,   segments: 0.75, sparks: 0.75, dust: 60,  bloomRes: 0.5, aoRes: 0.5 },
    high:     { material: "physical", cardTex: 2,   surfTex: 1,   segments: 1,    sparks: 1,    dust: 90,  bloomRes: 0.5, aoRes: 0.5 },
    ultra:    { material: "physical", cardTex: 3,   surfTex: 2,   segments: 1.5,  sparks: 1.5,  dust: 160, bloomRes: 1,   aoRes: 1 }
  };
  var DUST_MAX = 320, SPARK_MAX = 3;

  /** A preset's concrete budget for a hardware level (sparks and dust scale ≤ 2× within the preset). */
  function budgetFor(preset, level) {
    var src = BUDGETS[preset] || BUDGETS.balanced, b = {}, k;
    for (k in src) b[k] = src[k];
    var G = gpuApi(), floor = LEVELS[preset] || 0;
    var lv = Math.max(isFinite(level) ? level : floor, floor);
    var m = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
    b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * m * 100) / 100);
    b.dust = Math.min(DUST_MAX, Math.round(b.dust * m));
    return b;
  }

  /**
   * Resolve saved settings into concrete tiers.
   * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }
   */
  function resolve(saved, detected, level) {
    var s = saved || {};
    var auto = PRESETS.indexOf(s.preset) < 0;
    var preset = auto ? (PRESETS.indexOf(detected) >= 0 ? detected : "balanced") : s.preset;
    var row = TABLE[preset];
    var out = {
      preset: preset,
      auto: auto,
      renderScale: clamp(Number(s.render_scale) || 1, 0.5, 2),
      dprCap: row.dprCap
    };
    out.scale = row.scale * out.renderScale;
    CATEGORY_ORDER.forEach(function (cat) {
      out[cat] = CATEGORIES[cat].indexOf(s[cat]) >= 0 ? s[cat] : row[cat];
    });
    out.level = isFinite(level) && level !== null ? level : LEVELS[preset];
    out.budget = budgetFor(preset, out.level);
    out.adaptive = s.adaptive !== false;
    out.showFps = !!s.show_fps;
    // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
    out.post = out.ao !== "off" || out.bloom === "on" || out.grade === "on" ||
      out.antialias === "fxaa" || out.antialias === "smaa";
    return out;
  }

  /** Saved settings after picking a preset: overrides are cleared, scale/toggles kept. */
  function choosePreset(saved, preset) {
    var s = saved || {};
    var out = { preset: PRESETS.indexOf(preset) >= 0 ? preset : "auto" };
    if (s.render_scale != null) out.render_scale = s.render_scale;
    if (s.adaptive === false) out.adaptive = false;
    if (s.show_fps) out.show_fps = true;
    return out;
  }

  /** The preset's own tier for a category (for "From preset (…)" labels). */
  function presetTier(preset, cat) {
    return TABLE[preset] ? TABLE[preset][cat] : undefined;
  }

  /** Cost summary. `t(key, fallback)` localizes the fragments when given. */
  function describe(r, pixels, t) {
    var tr = t || function (k, f) { return f; };
    var parts = [
      r.shadows === "off" ? tr("sumNoShadows", "no shadows") : SHADOW_MAP[r.shadows] + "² " + tr("sumShadows", "shadows"),
      r.ao === "off" ? null : r.ao === "high" ? tr("sumAoHigh", "full ambient occlusion") : tr("sumAo", "ambient occlusion"),
      r.bloom === "on" ? tr("sumBloom", "bloom") : null,
      r.reflections === "on" ? tr("sumReflections", "reflections") : null,
      r.antialias === "off" ? tr("sumNoAa", "no anti-aliasing") : r.antialias.toUpperCase(),
      pixels ? pixels[0] + "×" + pixels[1] + " px" : null
    ];
    return parts.filter(Boolean).join(" · ");
  }

  return {
    PRESETS: PRESETS,
    CATEGORIES: CATEGORIES,
    CATEGORY_ORDER: CATEGORY_ORDER,
    SHADOW_MAP: SHADOW_MAP,
    LEVELS: LEVELS,
    BUDGETS: BUDGETS,
    DUST_MAX: DUST_MAX,
    SPARK_MAX: SPARK_MAX,
    detectLevel: detectLevel,
    presetForLevel: presetForLevel,
    detectPreset: detectPreset,
    budgetFor: budgetFor,
    resolve: resolve,
    choosePreset: choosePreset,
    presetTier: presetTier,
    describe: describe
  };
});
