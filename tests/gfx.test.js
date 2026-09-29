// Wild Eights — graphics quality model + Graphics panel locale tables. Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../gfx.js");
const P = require("../graphics-panel.js");

test("detectPreset maps GPU strings to tiers", () => {
  assert.strictEqual(G.detectPreset("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))"), "low");
  assert.strictEqual(G.detectPreset("llvmpipe (LLVM 15.0.7, 256 bits)"), "low");
  assert.strictEqual(G.detectPreset("ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11)"), "high");
  assert.strictEqual(G.detectPreset("Apple M2 Pro"), "high");
  assert.strictEqual(G.detectPreset("ANGLE (Intel, Intel(R) UHD Graphics 620)"), "balanced");
  assert.strictEqual(G.detectPreset(""), "balanced");
  assert.strictEqual(G.detectPreset("Apple M2 Pro", { mobile: true }), "balanced", "mobile Auto is capped");
  assert.strictEqual(G.detectPreset("SwiftShader", { mobile: true }), "low");
});

test("resolve applies preset, overrides and scale clamp", () => {
  const auto = G.resolve({}, "high");
  assert.strictEqual(auto.preset, "high");
  assert.strictEqual(auto.auto, true);
  assert.strictEqual(auto.shadows, "medium");
  assert.strictEqual(auto.adaptive, true);
  assert.strictEqual(auto.showFps, false);
  const low = G.resolve({ preset: "low" }, "high");
  assert.strictEqual(low.auto, false);
  assert.strictEqual(low.post, false, "Low needs no post chain");
  assert.strictEqual(low.dprCap, 1);
  const o = G.resolve({ preset: "low", bloom: "on", shadows: "bogus" }, "high");
  assert.strictEqual(o.bloom, "on");
  assert.strictEqual(o.shadows, "off", "invalid tier falls back to the preset");
  assert.strictEqual(o.post, true);
  assert.strictEqual(G.resolve({ render_scale: 5 }, "low").scale, 2);
  assert.strictEqual(G.resolve({ render_scale: 0.1 }, "low").scale, 0.5);
  assert.strictEqual(G.resolve({ preset: "ultra", render_scale: 1 }, "low").scale, 1.25);
  assert.strictEqual(G.resolve({ adaptive: false, show_fps: true }, "low").adaptive, false);
  G.PRESETS.forEach((p) => G.CATEGORY_ORDER.forEach((c) =>
    assert.ok(G.CATEGORIES[c].includes(G.presetTier(p, c)), p + "/" + c)));
});

test("choosing a preset clears overrides but keeps scale and toggles", () => {
  const s = G.choosePreset({ preset: "low", bloom: "on", ao: "high", render_scale: 1.5, show_fps: true, adaptive: false }, "high");
  assert.deepStrictEqual(s, { preset: "high", render_scale: 1.5, adaptive: false, show_fps: true });
  assert.strictEqual(G.choosePreset({}, "nope").preset, "auto");
});

test("describe summarises cost", () => {
  const d = G.describe(G.resolve({ preset: "high" }, "low"), [800, 600]);
  assert.match(d, /2048² shadows/);
  assert.match(d, /SMAA/);
  assert.match(d, /800×600 px/);
});

test("every locale has every panel string", () => {
  const keys = Object.keys(P.STRINGS["en-US"]).sort();
  ["en-US", "en-GB", "es-419", "es-ES", "de-DE", "fr-FR", "fr-CA", "pt-BR", "it-IT"].forEach((l) => {
    assert.ok(P.STRINGS[l], l);
    assert.deepStrictEqual(Object.keys(P.STRINGS[l]).sort(), keys, l);
  });
  assert.strictEqual(P.pickLocale("es-MX"), "es-419");
  assert.strictEqual(P.pickLocale("fr-CA"), "fr-CA");
  assert.strictEqual(P.pickLocale("en-AU"), "en-GB");
  assert.strictEqual(P.pickLocale("pt-PT"), "pt-BR");
  assert.strictEqual(P.pickLocale("ja-JP"), "en-US");
});
