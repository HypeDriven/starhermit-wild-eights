// Wild Eights — Three.js presentation layer. ES module; consumes immutable
// rules snapshots only (never mutates game state). The canvas is never the
// only UI: app.js maintains a full semantic HTML mirror.
//
// Graphics quality comes from gfx.js (window.WEGfx): presets and per-category
// tiers are applied live by setGraphics(). Post-processing passes are loaded on
// demand from the vendored same-revision three.js addons, so the Low preset
// never downloads or runs them.
import * as THREE from "./three.module.min.js";

(function () {
  "use strict";

  var GFX = window.WEGfx;
  var renderer = null, scene = null, camera = null;
  var container = null;
  var reducedMotion = false;
  var theme = null;

  // Resolved graphics tiers (see gfx.js). Replaced by setGraphics().
  var q = GFX.resolve({}, "low");
  var gfxSaved = {};
  var gpuName = "", detected = "low";

  // Suit palettes: default and color-vision-safe (shape coding is always on).
  var SUIT_COLORS = {
    standard: ["#c0392b", "#c0392b", "#2c3e50", "#2c3e50"],
    cvd:      ["#d55e00", "#e69f00", "#0072b2", "#6a51a3"]
  };
  var suitPalette = "standard";
  var SUIT_ORDER = ["hearts", "diamonds", "clubs", "spades"];

  // Small deterministic PRNG for procedural textures (visual seed is fixed).
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- procedural card textures --------------------------------------------
  var texCache = {};

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawSuitGlyph(g, suitIdx, cx, cy, size, color) {
    g.fillStyle = color;
    g.save();
    g.translate(cx, cy);
    var s = size / 100;
    g.scale(s, s);
    g.beginPath();
    if (suitIdx === 0) { // heart
      g.moveTo(0, 30);
      g.bezierCurveTo(-55, -10, -35, -50, 0, -22);
      g.bezierCurveTo(35, -50, 55, -10, 0, 30);
    } else if (suitIdx === 1) { // diamond
      g.moveTo(0, -40); g.lineTo(30, 0); g.lineTo(0, 40); g.lineTo(-30, 0);
    } else if (suitIdx === 2) { // club
      g.arc(0, -20, 19, 0, Math.PI * 2);
      g.moveTo(19 + 18, 6);
      g.arc(19, 6, 18, 0, Math.PI * 2);
      g.moveTo(-19 + 18, 6);
      g.arc(-19, 6, 18, 0, Math.PI * 2);
      g.moveTo(0, 14);
      g.lineTo(10, 42); g.lineTo(-10, 42); g.closePath();
    } else { // spade
      g.moveTo(0, -42);
      g.bezierCurveTo(-55, 0, -32, 38, -6, 20);
      g.lineTo(-12, 44); g.lineTo(12, 44); g.lineTo(6, 20);
      g.bezierCurveTo(32, 38, 55, 0, 0, -42);
    }
    g.fill();
    g.restore();
  }

  function detailed() { return q.detail === "detailed"; }

  function finishTexture(c) {
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (renderer && detailed()) tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  // The card geometry is itself rounded, so faces fill the whole canvas; the
  // outermost pixels are paper-coloured and double as the card's edge.
  function cardFaceTexture(card) {
    var k = detailed() ? 2 : 1;
    var key = card.id + ":" + suitPalette + ":" + k;
    if (texCache[key]) return texCache[key];
    var c = document.createElement("canvas");
    c.width = 128 * k; c.height = 180 * k;
    var g = c.getContext("2d");
    g.scale(k, k);
    if (k > 1) {
      var grad = g.createLinearGradient(0, 0, 128, 180);
      grad.addColorStop(0, "#fffef8"); grad.addColorStop(1, "#f1ece0");
      g.fillStyle = grad;
    } else {
      g.fillStyle = "#fdfdf8";
    }
    g.fillRect(0, 0, 128, 180);
    g.strokeStyle = "#b9b2a4"; g.lineWidth = 1.5;
    roundRect(g, 4, 4, 120, 172, 8); g.stroke();
    var suitIdx = SUIT_ORDER.indexOf(card.suit);
    var color = SUIT_COLORS[suitPalette][suitIdx];
    var rank = window.WEGame.rankName(card.rank);
    g.fillStyle = color;
    g.font = "bold 30px Georgia, serif";
    g.textAlign = "left"; g.textBaseline = "top";
    g.fillText(rank, 9, 8);
    g.save();
    g.translate(119, 172); g.rotate(Math.PI);
    g.fillText(rank, 0, 0);
    g.restore();
    drawSuitGlyph(g, suitIdx, 64, 94, 70, color);
    drawSuitGlyph(g, suitIdx, 19, 50, 18, color);
    // Eight marker band (shape coding for the wild rank).
    if (card.rank === 8) {
      g.strokeStyle = color; g.lineWidth = 3;
      g.setLineDash([6, 4]);
      roundRect(g, 9, 9, 110, 162, 7); g.stroke();
      g.setLineDash([]);
    }
    var tex = finishTexture(c);
    texCache[key] = tex;
    return tex;
  }

  function cardBackTexture() {
    var k = detailed() ? 2 : 1;
    var key = "back:" + k;
    if (texCache[key]) return texCache[key];
    var c = document.createElement("canvas");
    c.width = 128 * k; c.height = 180 * k;
    var g = c.getContext("2d");
    g.scale(k, k);
    g.fillStyle = "#f4efe4"; // white card margin (and edge)
    g.fillRect(0, 0, 128, 180);
    g.fillStyle = "#8a2f3c";
    roundRect(g, 6, 6, 116, 168, 7); g.fill();
    g.strokeStyle = "#e8c890"; g.lineWidth = 2.5;
    roundRect(g, 11, 11, 106, 158, 6); g.stroke();
    g.save();
    roundRect(g, 13, 13, 102, 154, 5); g.clip();
    g.strokeStyle = "rgba(232,200,144,0.45)"; g.lineWidth = 1;
    for (var i = -8; i < 12; i++) {
      g.beginPath(); g.moveTo(i * 16, 10); g.lineTo(i * 16 + 80, 170); g.stroke();
      g.beginPath(); g.moveTo(i * 16 + 80, 10); g.lineTo(i * 16, 170); g.stroke();
    }
    g.restore();
    // Central roundel with a wild eight: the line's emblem.
    g.fillStyle = "#6e2230";
    g.beginPath(); g.arc(64, 90, 22, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#e8c890"; g.lineWidth = 2;
    g.beginPath(); g.arc(64, 90, 22, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#e8c890";
    g.font = "bold 28px Georgia, serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("8", 64, 92);
    var tex = finishTexture(c);
    texCache[key] = tex;
    return tex;
  }

  // Greyscale procedural surfaces, tinted by the material colour so every
  // theme reuses them. Deterministic seeds keep captures stable.
  var surfCache = {};
  function surfaceTexture(kind) {
    if (surfCache[kind]) return surfCache[kind];
    var rnd = prng(kind === "felt" ? 11 : kind === "wood" ? 23 : 37);
    var c = document.createElement("canvas");
    var g = c.getContext("2d");
    var i, x, y, v;
    if (kind === "felt") {
      c.width = c.height = 256;
      g.fillStyle = "#e6e6e6"; g.fillRect(0, 0, 256, 256);
      for (i = 0; i < 9000; i++) {
        x = rnd() * 256; y = rnd() * 256; v = Math.floor(200 + rnd() * 55);
        g.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
        g.fillRect(x, y, 1 + rnd() * 2, 1);
      }
    } else if (kind === "wood") {
      c.width = 512; c.height = 128;
      g.fillStyle = "#d8d8d8"; g.fillRect(0, 0, 512, 128);
      for (i = 0; i < 70; i++) {
        y = rnd() * 128; v = Math.floor(150 + rnd() * 105);
        g.strokeStyle = "rgba(" + v + "," + v + "," + v + ",0.55)";
        g.lineWidth = 0.6 + rnd() * 2.4;
        g.beginPath();
        for (x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x / 60 + i) * 3 + Math.sin(x / 17 + i * 3) * 0.8);
        g.stroke();
      }
    } else { // carpet: a railway moquette of small diamonds
      c.width = c.height = 128;
      g.fillStyle = "#9a9a9a"; g.fillRect(0, 0, 128, 128);
      g.fillStyle = "#c8c8c8";
      for (y = 0; y < 128; y += 32) for (x = 0; x < 128; x += 32) {
        g.beginPath(); g.moveTo(x + 16, y + 4); g.lineTo(x + 28, y + 16); g.lineTo(x + 16, y + 28); g.lineTo(x + 4, y + 16); g.fill();
      }
      g.fillStyle = "#7a7a7a";
      for (y = 0; y < 128; y += 32) for (x = 0; x < 128; x += 32) g.fillRect(x + 14, y + 14, 4, 4);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (renderer) tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    surfCache[kind] = tex;
    return tex;
  }

  // Soft vertical band used for the light of passing lamps sweeping the table.
  function sweepTexture() {
    if (surfCache.sweep) return surfCache.sweep;
    var c = document.createElement("canvas");
    c.width = 256; c.height = 4;
    var g = c.getContext("2d");
    var grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.42, "rgba(255,255,255,0.35)");
    grad.addColorStop(0.5, "rgba(255,255,255,1)");
    grad.addColorStop(0.58, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 256, 4);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    surfCache.sweep = tex;
    return tex;
  }

  // --- scene -------------------------------------------------------------------
  var cardW = 1.1, cardH = 1.55, cardT = 0.012;
  var cardGeoPlain = null, cardGeoDetailed = null;
  var handMeshes = [];      // per player: array of { mesh, cardId }
  var discardMeshes = [];
  var stockMeshes = [];
  var markerMesh = null;    // legal-target ground marker
  var outlineMesh = null;   // selection outline
  var keyLight = null, lampLight = null, hemiLight = null;
  var lampGroup = null, bulbMat = null;
  var sweepMesh = null, dust = null;
  var envGroup = null;
  var matCache = {};
  var tweens = [];
  var lastFrameTime = 0, clock = 0;
  var clickHandler = null;
  var raycaster = new THREE.Raycaster();
  var pointerNdc = new THREE.Vector2();
  var hoveredCardId = null;
  var legalCardIds = [];
  var onTurn = false;
  var particleGroup = null, particleGeo = null;

  function roundedShape(w, h, r) {
    var s = new THREE.Shape();
    var x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  // Planar UVs from the card outline (edges land just inside the canvas).
  function planarCardUvs(geo) {
    var pos = geo.attributes.position, uv = geo.attributes.uv;
    for (var i = 0; i < pos.count; i++) {
      var u = pos.getX(i) / cardW + 0.5, v = pos.getY(i) / cardH + 0.5;
      uv.setXY(i, Math.min(0.995, Math.max(0.005, u)), Math.min(0.995, Math.max(0.005, v)));
    }
    uv.needsUpdate = true;
    return geo;
  }

  function buildCardGeometry() {
    var shape = roundedShape(cardW, cardH, 0.09);
    cardGeoPlain = planarCardUvs(new THREE.ShapeGeometry(shape, 4));
    var ext = new THREE.ExtrudeGeometry(shape, { depth: cardT, bevelEnabled: false, curveSegments: 5 });
    ext.clearGroups(); // one material, one draw call per card
    cardGeoDetailed = planarCardUvs(ext);
  }

  function cardMaterial(tex) {
    var key = tex.uuid + ":" + q.detail;
    if (matCache[key]) return matCache[key];
    var m = detailed()
      ? new THREE.MeshPhysicalMaterial({ map: tex, color: 0xf2f2f2, roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35, envMapIntensity: 0.15 })
      : new THREE.MeshLambertMaterial({ map: tex });
    matCache[key] = m;
    return m;
  }

  function makeCardMesh(tex) {
    var mesh = new THREE.Mesh(detailed() ? cardGeoDetailed : cardGeoPlain, cardMaterial(tex));
    mesh.userData.isCard = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function buildEnvironment() {
    envGroup = new THREE.Group();
    var t = theme;
    var rich = detailed();
    var woodMat = rich
      ? new THREE.MeshPhysicalMaterial({ color: t.wood, map: surfaceTexture("wood"), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 0.35 })
      : new THREE.MeshLambertMaterial({ color: t.wood });
    // Table: wood skirt, rounded bumper rail, brass inlay and felt.
    var skirt = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.3, 0.9, 64, 1, true), woodMat);
    skirt.rotation.x = Math.PI / 2; skirt.position.z = -0.55;
    skirt.castShadow = true;
    envGroup.add(skirt);
    var rail = new THREE.Mesh(new THREE.TorusGeometry(7.45, 0.26, rich ? 12 : 6, 72), woodMat);
    rail.position.z = -0.12;
    rail.receiveShadow = true;
    rail.castShadow = true;
    envGroup.add(rail);
    var feltMat = rich
      ? new THREE.MeshStandardMaterial({ color: t.felt, map: surfaceTexture("felt"), roughness: 0.95, metalness: 0, envMapIntensity: 0.25 })
      : new THREE.MeshLambertMaterial({ color: t.felt });
    if (rich) { feltMat.map.repeat.set(5, 5); }
    var felt = new THREE.Mesh(new THREE.CircleGeometry(7.25, 72), feltMat);
    felt.position.z = -0.06;
    felt.receiveShadow = true;
    envGroup.add(felt);
    var brass = new THREE.Mesh(
      new THREE.RingGeometry(6.55, 6.63, 96),
      rich ? new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.42 })
           : new THREE.MeshLambertMaterial({ color: 0xb8924e })
    );
    brass.position.z = -0.055;
    envGroup.add(brass);
    // Compartment floor: moquette carpet far below the table top.
    var floorColor = new THREE.Color(t.wall).multiplyScalar(rich ? 1.1 : 1.5);
    var floorMat = rich
      ? new THREE.MeshStandardMaterial({ color: floorColor, map: surfaceTexture("carpet"), roughness: 1, envMapIntensity: 0.15 })
      : new THREE.MeshLambertMaterial({ color: floorColor });
    if (rich) floorMat.map.repeat.set(24, 24);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), floorMat);
    floor.position.z = -3.2;
    floor.receiveShadow = true;
    envGroup.add(floor);
    // Pendant lamp: brass shade and a glowing bulb (visual anchor for the key light).
    lampGroup = new THREE.Group();
    lampGroup.position.set(0, 1.5, 7.5);
    var shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.95, 0.7, 32, 1, true),
      rich ? new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.35, side: THREE.DoubleSide })
           : new THREE.MeshLambertMaterial({ color: 0x8a6a3a, side: THREE.DoubleSide })
    );
    shade.rotation.x = Math.PI / 2; shade.position.z = 0.35;
    lampGroup.add(shade);
    bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(t.lamp) });
    var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), bulbMat);
    lampGroup.add(bulb);
    envGroup.add(lampGroup);
    // Passing platform lights: a soft band that sweeps across the felt.
    sweepMesh = new THREE.Mesh(
      new THREE.CircleGeometry(7.1, 48),
      new THREE.MeshBasicMaterial({ map: sweepTexture(), color: 0xbcd0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    sweepMesh.position.z = 0.2;
    sweepMesh.renderOrder = 5;
    sweepMesh.material.depthTest = false;
    sweepMesh.visible = false;
    envGroup.add(sweepMesh);
    scene.add(envGroup);
    applyBulb();
  }

  // Bulb glows above 1.0 with bloom on so only the lamp (and sparks) bloom.
  function applyBulb() {
    if (!bulbMat || !theme) return;
    bulbMat.color.set(theme.lamp).multiplyScalar(q.bloom === "on" ? 3 : 1);
  }

  function buildDust() {
    if (dust) { scene.remove(dust); dust.geometry.dispose(); dust.material.dispose(); dust = null; }
    if (q.particles !== "high") return;
    var rnd = prng(5);
    var n = 90, pos = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var r = Math.sqrt(rnd()) * 4, a = rnd() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r * 0.8 - 1; pos[i * 3 + 2] = 0.6 + rnd() * 5;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: new THREE.Color(theme.lamp), size: 0.035, transparent: true, opacity: 0.3,
      depthWrite: false, blending: THREE.AdditiveBlending
    }));
    dust.userData.base = pos.slice();
    dust.raycast = function () {}; // cosmetic: never intercepts picking
    scene.add(dust);
  }

  function clearGroup(g) {
    if (!g) return;
    g.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose(); // shared textures live in surfCache
    });
    scene.remove(g);
  }

  // Camera framing. The viewing angle is fixed; only the distance adapts, so
  // the whole table — every seated hand included — stays inside the canvas on a
  // wide desktop strip and on a square/tall phone playfield alike. Without this
  // the near hand is cropped by the bottom edge on narrow viewports.
  var FIT_RADIUS = 7.6;
  var CAM_TARGET = new THREE.Vector3(0, 0.4, 0);
  var CAM_DIR = new THREE.Vector3(0, -13.6, 12.6).normalize();

  function frameCamera() {
    var vHalf = Math.tan((camera.fov * Math.PI) / 360);
    var hHalf = vHalf * camera.aspect;
    var dist = Math.max(FIT_RADIUS / vHalf, FIT_RADIUS / hHalf);
    camera.position.copy(CAM_TARGET).addScaledVector(CAM_DIR, dist);
    camera.lookAt(CAM_TARGET);
  }

  // --- graphics settings ---------------------------------------------------------
  var size = [0, 0], pixelRatio = 1, adaptiveScale = 1, frames = [], fps = 0;
  var composer = null, gradePass = null, postKey = null, postMods = null, postLoading = null, postFailed = false;
  var pmrem = null, envTexture = null, envLoading = null;
  var BLOOM_THRESHOLD = 1.35;

  function gpuString(r) {
    try {
      var gl = r.getContext();
      var ext = gl.getExtension("WEBGL_debug_renderer_info");
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
    } catch (e) { return ""; }
  }

  function isMobileDevice() {
    var coarse = false;
    try { coarse = window.matchMedia("(pointer: coarse)").matches; } catch (e) { /* old browser */ }
    return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  }

  function setGraphics(saved) {
    gfxSaved = saved || {};
    var prevDetail = q.detail, prevParticles = q.particles;
    q = GFX.resolve(gfxSaved, detected);
    document.body.setAttribute("data-gfx-preset", q.preset);
    if (!renderer) return;
    renderer.domElement.setAttribute("data-gfx-preset", q.preset);
    var sm = GFX.SHADOW_MAP[q.shadows];
    renderer.shadowMap.enabled = sm > 0;
    keyLight.castShadow = sm > 0;
    if (sm > 0 && keyLight.shadow.mapSize.x !== sm) {
      keyLight.shadow.mapSize.set(sm, sm);
      if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
    }
    applyReflections();
    if (prevDetail !== q.detail) {
      disposeCardCaches();
      clearGroup(envGroup);
      buildEnvironment();
    }
    applyBulb();
    if (prevParticles !== q.particles || !dust === (q.particles === "high")) buildDust();
    adaptiveScale = 1;
    frames = [];
    postKey = null; // rebuild the post chain on the next frame
    if (q.post) loadPost();
    fpsVisible(q.showFps);
    // Materials pick up shadow-map / environment changes on recompile.
    scene.traverse(function (o) { if (o.material) o.material.needsUpdate = true; });
    Object.keys(matCache).forEach(function (k) { matCache[k].needsUpdate = true; });
    resize();
  }

  function applyReflections() {
    if (q.reflections !== "on") { scene.environment = null; return; }
    if (envTexture) { scene.environment = envTexture; return; }
    if (envLoading) return;
    envLoading = import("three/addons/environments/RoomEnvironment.js").then(function (m) {
      if (!renderer) return;
      pmrem = pmrem || new THREE.PMREMGenerator(renderer);
      var room = new m.RoomEnvironment();
      envTexture = pmrem.fromScene(room, 0.04).texture;
      room.dispose && room.dispose();
      if (q.reflections === "on") scene.environment = envTexture;
    }).catch(function () { envLoading = null; /* reflections are an enhancement */ });
  }

  function loadPost() {
    if (postMods || postLoading) return;
    var base = "three/addons/";
    postLoading = Promise.all([
      import(base + "postprocessing/EffectComposer.js"),
      import(base + "postprocessing/RenderPass.js"),
      import(base + "postprocessing/ShaderPass.js"),
      import(base + "postprocessing/OutputPass.js"),
      import(base + "postprocessing/GTAOPass.js"),
      import(base + "postprocessing/UnrealBloomPass.js"),
      import(base + "postprocessing/SMAAPass.js"),
      import(base + "shaders/FXAAShader.js")
    ]).then(function (m) {
      postMods = {
        EffectComposer: m[0].EffectComposer, RenderPass: m[1].RenderPass, ShaderPass: m[2].ShaderPass,
        OutputPass: m[3].OutputPass, GTAOPass: m[4].GTAOPass, UnrealBloomPass: m[5].UnrealBloomPass,
        SMAAPass: m[6].SMAAPass, FXAAShader: m[7].FXAAShader
      };
      postKey = null;
    }).catch(function () { postFailed = true; });
  }

  // Colour grade + vignette: gentle S-curve, a touch of saturation, warm
  // highlights and cool shadows (display-space in, display-space out).
  var GradeShader = {
    uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.28 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: [
      "uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;",
      "varying vec2 vUv;",
      "void main() {",
      "  vec4 src = texture2D(tDiffuse, vUv);",
      "  vec3 c = src.rgb;",
      "  vec3 lc = clamp(c, 0.0, 1.0);",
      "  vec3 s = mix(lc, lc * lc * (3.0 - 2.0 * lc), 0.22);",
      "  float l = dot(s, vec3(0.299, 0.587, 0.114));",
      "  s = mix(vec3(l), s, 1.1);",
      "  s *= mix(vec3(0.95, 0.98, 1.05), vec3(1.05, 1.0, 0.94), smoothstep(0.15, 0.8, l));",
      "  c = mix(c, s + max(c - 1.0, 0.0), uAmount);",
      "  float d = length((vUv - 0.5) * vec2(1.0, 0.9));",
      "  c *= 1.0 - uVignette * smoothstep(0.3, 0.8, d);",
      "  gl_FragColor = vec4(c, src.a);",
      "}"
    ].join("\n")
  };

  function currentPostKey(w, h) {
    return q.post && postMods && !postFailed ? [q.ao, q.bloom, q.grade, q.antialias, w, h, pixelRatio].join("|") : "none";
  }

  function disposeComposer() {
    if (composer) {
      composer.passes.forEach(function (p) { if (p.dispose) p.dispose(); });
      composer.dispose();
    }
    composer = null; gradePass = null;
  }

  function buildPost(w, h) {
    disposeComposer();
    if (!q.post || !postMods || postFailed) return;
    var P = postMods;
    try {
      var pw = Math.max(1, Math.round(w * pixelRatio)), ph = Math.max(1, Math.round(h * pixelRatio));
      var target = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: q.antialias === "msaa" ? 4 : 0 });
      var c = new P.EffectComposer(renderer, target);
      c.setPixelRatio(pixelRatio);
      c.setSize(w, h);
      c.addPass(new P.RenderPass(scene, camera));
      if (q.ao !== "off") {
        var ao = new P.GTAOPass(scene, camera, pw, ph);
        ao.output = P.GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 0.6, scale: 1.0, samples: q.ao === "high" ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: q.ao === "high" ? 6 : 4, rings: 2, samples: q.ao === "high" ? 16 : 8 });
        c.addPass(ao);
      }
      if (q.bloom === "on") {
        // High threshold on the linear HDR buffer (before tone mapping): only
        // the lamp bulb, sparks and the brightest highlights bloom.
        c.addPass(new P.UnrealBloomPass(new THREE.Vector2(pw, ph), 0.45, 0.4, BLOOM_THRESHOLD));
      }
      if (q.grade === "on") {
        gradePass = new P.ShaderPass(GradeShader);
        c.addPass(gradePass);
      }
      c.addPass(new P.OutputPass());
      if (q.antialias === "smaa") {
        var smaa = new P.SMAAPass();
        smaa.setSize(pw, ph);
        c.addPass(smaa);
      }
      if (q.antialias === "fxaa") {
        var fxaa = new P.ShaderPass(P.FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        c.addPass(fxaa);
      }
      composer = c;
    } catch (e) {
      // Post-processing is an enhancement: render directly if the chain cannot be built.
      postFailed = true;
      disposeComposer();
    }
  }

  function fpsVisible(on) {
    var el = document.getElementById("fps-meter");
    if (on && !el) {
      el = document.createElement("div");
      el.id = "fps-meter";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    if (el) el.hidden = !on;
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  function adapt(dtMs) {
    frames.push(dtMs);
    if (frames.length < 90) return false;
    var avg = 0;
    for (var i = 0; i < frames.length; i++) avg += frames[i];
    avg /= frames.length;
    frames.length = 0;
    fps = 1000 / avg;
    var el = document.getElementById("fps-meter");
    if (el && !el.hidden) el.textContent = Math.round(fps) + " fps · " + (Math.round(pixelRatio * 100) / 100) + "×";
    if (!q.adaptive) return false;
    var before = adaptiveScale;
    if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
    else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
    return before !== adaptiveScale;
  }

  function graphicsInfo() {
    var px = size[0] ? [Math.round(size[0] * pixelRatio), Math.round(size[1] * pixelRatio)] : null;
    return {
      gpu: gpuName || "unknown GPU",
      detected: detected,
      resolved: q,
      pixels: px,
      fps: Math.round(fps),
      adaptiveScale: Math.round(adaptiveScale * 100) / 100,
      postFailed: !!postFailed && q.post
    };
  }

  function resize() {
    if (!renderer || !container) return;
    var ratio = Math.min(window.devicePixelRatio || 1, q.dprCap) * q.scale * adaptiveScale;
    if (ratio !== pixelRatio) { pixelRatio = ratio; renderer.setPixelRatio(ratio); }
    // Hidden table (menus): keep the last real size; the ResizeObserver
    // resizes again when the game screen shows.
    if (!container.clientWidth || !container.clientHeight) { if (size[0]) renderer.setSize(size[0], size[1], false); return; }
    var w = container.clientWidth;
    var h = container.clientHeight;
    size = [w, h];
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    frameCamera();
    camera.updateProjectionMatrix();
  }

  function init(containerEl, opts) {
    opts = opts || {};
    container = containerEl;
    theme = opts.theme;
    suitPalette = opts.suitPalette || "standard";
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    gpuName = gpuString(renderer);
    detected = GFX.detectPreset(gpuName, { mobile: isMobileDevice() });
    q = GFX.resolve(opts.graphics || {}, detected);
    gfxSaved = opts.graphics || {};
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true"); // DOM mirror owns a11y

    scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.wall).multiplyScalar(0.6);
    // The carpet fades into the compartment's shadows.
    scene.fog = new THREE.Fog(scene.background.getHex(), 20, 42);
    scene.environmentIntensity = 0.3;
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    frameCamera();

    // Soft fill from the compartment, a warm point glow at the lamp and a
    // directional key from the lamp side whose shadow box hugs the table.
    hemiLight = new THREE.HemisphereLight(0xfff2df, 0x2a1d18, 0.55);
    hemiLight.position.set(0, 0, 1);
    scene.add(hemiLight);
    lampLight = new THREE.PointLight(theme.lamp, LAMP_POWER, 40, 1.8);
    lampLight.position.set(0, 1.5, 7.2);
    scene.add(lampLight);
    keyLight = new THREE.DirectionalLight(theme.lamp, 0.75);
    keyLight.position.set(1.2, -1.5, 14);
    keyLight.target.position.set(0, 0.4, 0);
    scene.add(keyLight.target);
    var sc = keyLight.shadow.camera;
    sc.left = -8.2; sc.right = 8.2; sc.top = 8.2; sc.bottom = -8.2; sc.near = 8; sc.far = 22;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.radius = 3;
    scene.add(keyLight);

    buildCardGeometry();
    buildEnvironment();

    // Selection outline + legal marker (lift + rim + grounded marker, never glow alone).
    outlineMesh = new THREE.Mesh(
      new THREE.ShapeGeometry(roundedShape(cardW + 0.16, cardH + 0.16, 0.14), 4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe9b0).multiplyScalar(1.15), transparent: true, opacity: 0.95 })
    );
    outlineMesh.visible = false;
    scene.add(outlineMesh);
    markerMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.26, 32),
      new THREE.MeshBasicMaterial({ color: 0x9fe6a0, transparent: true, opacity: 0.9 })
    );
    markerMesh.visible = false;
    scene.add(markerMesh);

    particleGroup = new THREE.Group();
    particleGeo = new THREE.PlaneGeometry(1, 1);
    scene.add(particleGroup);

    // Pointer picking against explicit card layer only.
    renderer.domElement.addEventListener("pointermove", function (ev) {
      var r = renderer.domElement.getBoundingClientRect();
      pointerNdc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      updateHover();
    });
    renderer.domElement.addEventListener("pointerdown", function (ev) {
      var r = renderer.domElement.getBoundingClientRect();
      pointerNdc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      var id = pickCard();
      if (id !== null && clickHandler) clickHandler(id);
    });

    window.addEventListener("resize", resize);
    // the table's box is sized by the surrounding chrome (HUD, hand, lesson);
    // follow its size directly rather than only window resizes
    if (typeof ResizeObserver === "function") new ResizeObserver(function () { resize(); }).observe(container);
    setGraphics(gfxSaved);
    requestAnimationFrame(tick);
  }

  function updateHover() {
    var id = pickCard();
    if (id !== hoveredCardId) {
      hoveredCardId = id;
      renderer.domElement.style.cursor = (id !== null && legalCardIds.indexOf(id) >= 0) ? "pointer" : "default";
    }
  }

  function pickCard() {
    if (!handMeshes[0] || !onTurn) return null;
    raycaster.setFromCamera(pointerNdc, camera);
    var meshes = handMeshes[0].map(function (h) { return h.mesh; });
    var hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    return hits[0].object.userData.cardId;
  }

  function burst(pos, color, strong) {
    if (reducedMotion) return;
    var high = q.particles === "high";
    var n = high ? (strong ? 36 : 22) : 8;
    var c = new THREE.Color(color);
    if (high && q.bloom === "on") c.multiplyScalar(2.2); // sparks bloom
    for (var i = 0; i < n; i++) {
      var m = new THREE.Mesh(particleGeo, new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: 1, depthWrite: false,
        blending: high ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide
      }));
      var s = high ? 0.05 + Math.random() * 0.07 : 0.09;
      m.scale.set(s, s, s);
      m.position.copy(pos);
      m.rotation.z = Math.random() * Math.PI;
      m.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 2 + Math.random() * 2.5);
      m.userData.spin = (Math.random() - 0.5) * 8;
      m.userData.life = high ? 0.9 : 0.7;
      m.userData.max = m.userData.life;
      m.raycast = function () {};
      particleGroup.add(m);
    }
  }

  // Gentle ambient motion: the pendant sways with the carriage, the lamp
  // shimmers, platform lights sweep past and dust drifts in the light. All of
  // it stops under reduced motion or with a static background.
  var LAMP_BASE = new THREE.Vector3(0, 1.5, 7.5);
  var LAMP_POWER = 22;
  function ambient(dt) {
    var moving = !reducedMotion && q.background === "animated";
    if (moving) clock += dt;
    var sway = moving ? Math.sin(clock * 0.9) * 0.12 + Math.sin(clock * 2.3) * 0.03 : 0;
    if (lampGroup) {
      lampGroup.position.set(LAMP_BASE.x + sway, LAMP_BASE.y, LAMP_BASE.z);
      lampGroup.rotation.y = sway * 0.12;
    }
    lampLight.position.set(sway, 1.5, 7.2);
    keyLight.position.set(1.2 + sway * 2, -1.5, 14);
    var shimmer = moving ? 1 + Math.sin(clock * 7.1) * 0.015 + Math.sin(clock * 12.7) * 0.01 : 1;
    lampLight.intensity = LAMP_POWER * shimmer;
    if (sweepMesh) {
      var period = 11, cyc = clock % period, pass = cyc / 2.6; // a 2.6 s pass every 11 s
      sweepMesh.visible = moving && pass < 1;
      if (sweepMesh.visible) {
        sweepMesh.material.map.offset.x = 0.9 - pass * 1.8;
        sweepMesh.material.opacity = 0.09 * Math.sin(pass * Math.PI);
      }
    }
    if (dust) {
      dust.visible = moving;
      if (moving) {
        var p = dust.geometry.attributes.position, b = dust.userData.base;
        for (var i = 0; i < p.count; i++) {
          p.setXYZ(i, b[i * 3] + Math.sin(clock * 0.3 + i) * 0.25,
                      b[i * 3 + 1] + Math.cos(clock * 0.23 + i * 1.7) * 0.25,
                      b[i * 3 + 2] + Math.sin(clock * 0.17 + i * 0.5) * 0.3);
        }
        p.needsUpdate = true;
      }
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return; // zero render while backgrounded
    // The table lives on the game screen; skip all GPU work while it is hidden.
    if (!container || container.offsetParent === null) { lastFrameTime = 0; return; }
    var now = performance.now();
    var dtMs = lastFrameTime ? Math.min(now - lastFrameTime, 250) : 16;
    var dt = Math.min(dtMs / 1000, 0.1);
    lastFrameTime = now;
    // Advance tweens (deterministic end states; cosmetic only).
    for (var i = tweens.length - 1; i >= 0; i--) {
      var tw = tweens[i];
      tw.t += dt;
      var k = Math.min(1, tw.t / tw.dur);
      var e = 1 - Math.pow(1 - k, 3); // ease-out cubic, interruptible
      tw.obj.position.lerpVectors(tw.from, tw.to, e);
      tw.obj.rotation.z = tw.fromR + (tw.toR - tw.fromR) * e;
      if (k >= 1) { tw.obj.position.copy(tw.to); tw.obj.rotation.z = tw.toR; tweens.splice(i, 1); }
    }
    for (var p = particleGroup.children.length - 1; p >= 0; p--) {
      var m = particleGroup.children[p];
      m.userData.life -= dt;
      m.position.addScaledVector(m.userData.vel, dt);
      m.userData.vel.z -= 6 * dt;
      m.rotation.z += m.userData.spin * dt;
      m.material.opacity = Math.max(0, m.userData.life / m.userData.max);
      if (m.userData.life <= 0) { m.material.dispose(); particleGroup.remove(m); }
    }
    ambient(dt);
    if (adapt(dtMs)) resize();
    var w = size[0], h = size[1];
    var key = currentPostKey(w, h);
    if (key !== postKey) { postKey = key; buildPost(w, h); }
    if (composer) {
      try { composer.render(dt); return; } catch (err) { postFailed = true; disposeComposer(); postKey = null; }
    }
    renderer.render(scene, camera);
  }

  function disposeCards() {
    handMeshes.forEach(function (arr) { arr.forEach(function (h) { scene.remove(h.mesh); }); });
    discardMeshes.forEach(function (m) { scene.remove(m); });
    stockMeshes.forEach(function (m) { scene.remove(m); });
    handMeshes = [];
    discardMeshes = [];
    stockMeshes = [];
    tweens = [];
  }

  function disposeCardCaches() {
    Object.keys(matCache).forEach(function (k) { matCache[k].dispose(); });
    matCache = {};
    Object.keys(texCache).forEach(function (k) { texCache[k].dispose(); });
    texCache = {};
  }

  // Hand anchor points per seat around the table (0 = bottom/player).
  function seatTransform(seat, players) {
    // Angles measured around table center; seat 0 at bottom.
    var angles = players === 2 ? [-Math.PI / 2, Math.PI / 2]
               : players === 3 ? [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]
               : [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
    var a = angles[seat];
    return { angle: a, x: Math.cos(a) * 5.4, y: Math.sin(a) * 5.4 };
  }

  // Render a full immutable snapshot.
  // opts: { legalPlays:[ids], onTurn, selectedCardId, mySeat, animate }
  // The local seat (mySeat, default 0) is drawn face up at the bottom of the
  // table; every other hand is face down, so a hosted seat never sees another
  // player's cards.
  function renderState(state, opts) {
    opts = opts || {};
    disposeCards();
    legalCardIds = opts.legalPlays || [];
    onTurn = !!opts.onTurn;
    var players = state.players;
    var mySeat = opts.mySeat || 0;

    for (var seat = 0; seat < players; seat++) {
      var visualSeat = (seat - mySeat + players) % players;
      var st = seatTransform(visualSeat, players);
      var hand = state.hands[seat];
      var arr = [];
      var n = hand.length;
      var isMe = seat === mySeat;
      var faceUp = isMe;
      for (var i = 0; i < n; i++) {
        var card = hand[i];
        var mesh = makeCardMesh(faceUp ? cardFaceTexture(card) : cardBackTexture());
        mesh.userData.cardId = card.id;
        var spread = Math.min(0.62, 5.6 / Math.max(1, n));
        var u = (i - (n - 1) / 2) * spread;
        var px = st.x + (-Math.sin(st.angle)) * u;
        var py = st.y + Math.cos(st.angle) * u;
        var pz = 0.06 + i * 0.016;
        var rot = isMe ? -u * 0.06 : -st.angle - Math.PI / 2;
        var legal = isMe && legalCardIds.indexOf(card.id) >= 0;
        var hover = isMe && card.id === hoveredCardId;
        var lift = legal ? 0.28 : 0;
        if (hover && legal) lift = 0.5;
        if (isMe && card.id === opts.selectedCardId) lift = 0.65;
        var toPos = new THREE.Vector3(px, py + (isMe ? lift * 0.6 : 0), pz + lift);
        if (isMe && legal && !reducedMotion) {
          // gentle idle bob phase by index
          toPos.z += 0.02 * Math.sin(i);
        }
        mesh.position.copy(toPos);
        mesh.rotation.z = rot;
        mesh.userData.basePos = toPos.clone();
        scene.add(mesh);
        arr.push({ mesh: mesh, cardId: card.id });
        if (isMe && legal && card.id === legalCardIds[0]) {
          markerMesh.position.set(px, py - 1.1, 0.02);
          markerMesh.visible = true;
        }
      }
      handMeshes[visualSeat] = arr; // index 0 is always the local seat (picking)
    }
    if (!handMeshes[0] || !handMeshes[0].some(function (h) { return legalCardIds.indexOf(h.cardId) >= 0; })) {
      markerMesh.visible = false;
    }

    // Discard pile: show up to last 8 cards with slight rotation, top fully visible.
    var dp = state.discardPile;
    var show = dp.slice(-8);
    for (var d = 0; d < show.length; d++) {
      var dc = show[d];
      var dm = makeCardMesh(cardFaceTexture(dc));
      var jitterR = ((dc.id * 37) % 23 - 11) * 0.02;
      dm.position.set(0.9 + ((dc.id * 13) % 7 - 3) * 0.02, 0.3 + ((dc.id * 29) % 7 - 3) * 0.02, 0.05 + d * 0.016);
      dm.rotation.z = jitterR;
      scene.add(dm);
      discardMeshes.push(dm);
    }
    // Stock pile: a visible stack of backs (height follows the stock count).
    if (state.stock.length > 0) {
      var layers = detailed() ? Math.min(6, Math.ceil(state.stock.length / 5)) : 1;
      for (var sI = 0; sI < layers; sI++) {
        var sm = makeCardMesh(cardBackTexture());
        var top = sI === layers - 1;
        sm.position.set(-1.6 + sI * 0.006, 0.3 - sI * 0.004,
          top ? 0.05 + Math.min(10, state.stock.length) * 0.006 : 0.05 + sI * (Math.min(10, state.stock.length) * 0.006 / layers));
        sm.rotation.z = 0.08 - sI * 0.01;
        scene.add(sm);
        stockMeshes.push(sm);
      }
    }
    // Selection outline.
    var sel = null;
    if (handMeshes[0]) {
      for (var s2 = 0; s2 < handMeshes[0].length; s2++) {
        if (handMeshes[0][s2].cardId === (hoveredCardId != null ? hoveredCardId : opts.selectedCardId)) sel = handMeshes[0][s2].mesh;
      }
    }
    if (sel && onTurn) {
      outlineMesh.position.copy(sel.position);
      outlineMesh.position.z -= 0.004;
      outlineMesh.rotation.z = sel.rotation.z;
      outlineMesh.visible = true;
    } else {
      outlineMesh.visible = false;
    }
  }

  // Cosmetic event feedback. events come from WEGame.applyCommand.
  function playEvents(events, state) {
    (events || []).forEach(function (ev) {
      if (ev.type === "play" || ev.type === "win") {
        burst(new THREE.Vector3(0.9, 0.3, 0.5), ev.type === "win" ? 0xffe9b0 : 0xffffff, ev.type === "win");
      }
      if (ev.type === "suit") burst(new THREE.Vector3(0.9, 0.3, 0.6), 0xffd0f0, true);
    });
  }

  function setTheme(t) {
    if (t === theme && envGroup) return;
    theme = t;
    scene.background = new THREE.Color(t.wall).multiplyScalar(0.6);
    scene.fog.color.copy(scene.background);
    lampLight.color = new THREE.Color(t.lamp);
    keyLight.color = new THREE.Color(t.lamp);
    clearGroup(envGroup);
    buildEnvironment();
    buildDust();
  }

  function setSuitPalette(p) {
    if (p === suitPalette) return;
    suitPalette = p;
    disposeCardCaches();
  }

  function destroy() {
    window.removeEventListener("resize", resize);
    disposeCards();
    clearGroup(envGroup);
    disposeComposer();
    if (renderer) { renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
    renderer = null;
  }

  window.WEUI = {
    init: init,
    renderState: renderState,
    playEvents: playEvents,
    onCardClick: function (cb) { clickHandler = cb; },
    setTheme: setTheme,
    setSuitPalette: setSuitPalette,
    setReducedMotion: function (b) { reducedMotion = !!b; },
    setGraphics: setGraphics,
    graphicsInfo: graphicsInfo,
    resize: resize,
    destroy: destroy,
    isReady: function () { return !!renderer; }
  };
})();
