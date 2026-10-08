// Wild Eights — graphics quality model: presets, per-category overrides, GPU
// detection and a cost summary. Pure (no DOM, no three.js), so the settings
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

  /** Best preset for this GPU, from the unmasked renderer string when exposed. */
  function detectPreset(gpu, opts) {
    var g = String(gpu || "").toLowerCase();
    var p;
    if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = "low";
    else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?!.*graphics)|apple m\d/.test(g)) p = "high";
    else p = "balanced";
    // Phones and tablets: Auto never goes above Balanced.
    if (opts && opts.mobile && p !== "low") p = "balanced";
    return p;
  }

  /**
   * Resolve saved settings into concrete tiers.
   * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }
   */
  function resolve(saved, detected) {
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
    detectPreset: detectPreset,
    resolve: resolve,
    choosePreset: choosePreset,
    presetTier: presetTier,
    describe: describe
  };
});
