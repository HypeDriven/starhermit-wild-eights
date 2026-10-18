// Wild Eights — graphics quality model + Graphics panel locale tables. Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../gfx.js");
const P = require("../graphics-panel.js");

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test("hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)", () => {
  assert.strictEqual(G.detectPreset("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))", DESK), "low");
  assert.strictEqual(G.detectLevel("llvmpipe (LLVM 15.0.7, 256 bits)", DESK), 0);
  assert.strictEqual(G.detectPreset("", DESK), "low", "no WebGL");
  assert.strictEqual(G.detectPreset("ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", DESK), "low");
  assert.strictEqual(G.detectPreset("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)", DESK), "low");
  assert.strictEqual(G.detectPreset("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)", DESK), "balanced");
  assert.strictEqual(G.detectPreset("ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)", DESK), "high");
  assert.strictEqual(G.detectPreset("ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)", DESK), "ultra");
  assert.strictEqual(G.detectLevel("ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)", DESK), 20);
  assert.strictEqual(G.detectPreset("ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)", DESK), "ultra");
  Object.keys(G.LEVELS).forEach((p) => assert.strictEqual(G.presetForLevel(G.LEVELS[p]), p));
  assert.strictEqual(G.presetForLevel(3), "low");
  assert.strictEqual(G.presetForLevel(16), "high");
});

test("phones and tablets are Balanced at most; software GPUs stay Low", () => {
  assert.strictEqual(G.detectPreset("Adreno (TM) 740", PHONE), "balanced");
  assert.ok(G.detectLevel("Adreno (TM) 740", PHONE) <= 9);
  assert.strictEqual(G.detectPreset("Apple M2 Pro", PHONE), "balanced");
  assert.strictEqual(G.detectPreset("SwiftShader", PHONE), "low");
});

test("per-preset budget table: explicit, never cheaper from Low to Ultra, counts scale with the level", () => {
  const keys = ["material", "cardTex", "surfTex", "segments", "sparks", "dust", "bloomRes", "aoRes"];
  G.PRESETS.forEach((p) => keys.forEach((k) => assert.notStrictEqual(G.BUDGETS[p][k], undefined, p + "." + k)));
  for (let i = 1; i < G.PRESETS.length; i++) {
    keys.slice(1).forEach((k) => assert.ok(G.BUDGETS[G.PRESETS[i]][k] >= G.BUDGETS[G.PRESETS[i - 1]][k], G.PRESETS[i] + "." + k));
  }
  assert.deepStrictEqual(G.PRESETS.map((p) => G.BUDGETS[p].material), ["lambert", "standard", "physical", "physical"]);
  assert.deepStrictEqual(G.PRESETS.map((p) => G.BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1]);
  assert.strictEqual(G.budgetFor("high", 10).dust, G.BUDGETS.high.dust);
  assert.strictEqual(G.budgetFor("high", 0).dust, G.BUDGETS.high.dust, "a forced preset never drops below its budget");
  assert.ok(G.budgetFor("high", 13).dust > G.BUDGETS.high.dust);
  assert.strictEqual(G.budgetFor("low", 9).dust, G.BUDGETS.low.dust * 2, "at most 2x within a preset");
  assert.ok(G.budgetFor("ultra", 20).dust <= G.DUST_MAX && G.budgetFor("ultra", 20).sparks <= G.SPARK_MAX);
  const r = G.resolve({ preset: "balanced" }, "low", 4);
  assert.strictEqual(r.level, 4);
  assert.deepStrictEqual(r.budget, G.budgetFor("balanced", 4));
  assert.strictEqual(G.resolve({}, "low", 0).budget.material, "lambert");
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
