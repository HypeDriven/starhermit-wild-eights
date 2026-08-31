// Wild Eights — Three.js presentation layer. ES module; consumes immutable
// rules snapshots only (never mutates game state). The canvas is never the
// only UI: app.js maintains a full semantic HTML mirror.
import * as THREE from "./three.module.min.js";

(function () {
  "use strict";

  var renderer = null, scene = null, camera = null;
  var container = null;
  var reducedMotion = false;
  var quality = "high"; // low | medium | high
  var theme = null;

  // Suit palettes: default and color-vision-safe (shape coding is always on).
  var SUIT_COLORS = {
    standard: ["#c0392b", "#c0392b", "#2c3e50", "#2c3e50"],
    cvd:      ["#d55e00", "#e69f00", "#0072b2", "#6a51a3"]
  };
  var suitPalette = "standard";
  var SUIT_ORDER = ["hearts", "diamonds", "clubs", "spades"];

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

  function cardFaceTexture(card) {
    var key = card.id + ":" + suitPalette;
    if (texCache[key]) return texCache[key];
    var c = document.createElement("canvas");
    c.width = 128; c.height = 180;
    var g = c.getContext("2d");
    g.fillStyle = "#fdfdf8";
    roundRect(g, 2, 2, 124, 176, 10); g.fill();
    g.strokeStyle = "#999"; g.lineWidth = 2; g.stroke();
    var suitIdx = SUIT_ORDER.indexOf(card.suit);
    var color = SUIT_COLORS[suitPalette][suitIdx];
    var rank = window.WEGame.rankName(card.rank);
    g.fillStyle = color;
    g.font = "bold 30px Georgia, serif";
    g.textAlign = "left"; g.textBaseline = "top";
    g.fillText(rank, 8, 6);
    g.save();
    g.translate(120, 174); g.rotate(Math.PI);
    g.fillText(rank, 8, 6);
    g.restore();
    drawSuitGlyph(g, suitIdx, 64, 92, 70, color);
    drawSuitGlyph(g, suitIdx, 18, 48, 18, color);
    // Eight marker band (shape coding for the wild rank).
    if (card.rank === 8) {
      g.strokeStyle = color; g.lineWidth = 3;
      g.setLineDash([6, 4]);
      roundRect(g, 8, 8, 112, 164, 8); g.stroke();
      g.setLineDash([]);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    texCache[key] = tex;
    return tex;
  }

  var backTexture = null;
  function cardBackTexture() {
    if (backTexture) return backTexture;
    var c = document.createElement("canvas");
    c.width = 128; c.height = 180;
    var g = c.getContext("2d");
    g.fillStyle = "#8a2f3c";
    roundRect(g, 2, 2, 124, 176, 10); g.fill();
    g.strokeStyle = "#e8c890"; g.lineWidth = 3;
    roundRect(g, 10, 10, 108, 160, 8); g.stroke();
    g.strokeStyle = "rgba(232,200,144,0.5)"; g.lineWidth = 1;
    for (var i = -8; i < 12; i++) {
      g.beginPath(); g.moveTo(i * 16, 10); g.lineTo(i * 16 + 80, 170); g.stroke();
      g.beginPath(); g.moveTo(i * 16 + 80, 10); g.lineTo(i * 16, 170); g.stroke();
    }
    backTexture = new THREE.CanvasTexture(c);
    backTexture.colorSpace = THREE.SRGBColorSpace;
    return backTexture;
  }

  // --- scene -------------------------------------------------------------------
  var cardW = 1.1, cardH = 1.55;
  var cardGeo = null;
  var handMeshes = [];      // per player: array of { mesh, cardId, base:Vector3, rot }
  var discardMeshes = [];
  var stockMesh = null;
  var markerMesh = null;    // legal-target ground marker
  var outlineMesh = null;   // selection outline
  var lampLight = null, ambLight = null;
  var envGroup = null;
  var tweens = [];
  var lastFrameTime = 0;
  var clickHandler = null;
  var raycaster = new THREE.Raycaster();
  var pointerNdc = new THREE.Vector2();
  var hoveredCardId = null;
  var legalCardIds = [];
  var onTurn = false;
  var particleGroup = null;

  function makeCardMesh(tex) {
    var mat = new THREE.MeshLambertMaterial({ map: tex });
    var mesh = new THREE.Mesh(cardGeo, mat);
    mesh.userData.isCard = true;
    return mesh;
  }

  function buildEnvironment() {
    envGroup = new THREE.Group();
    var t = theme;
    // Table: wood ring + felt inlay.
    var wood = new THREE.Mesh(
      new THREE.CylinderGeometry(7.6, 7.9, 0.5, 48),
      new THREE.MeshLambertMaterial({ color: t.wood })
    );
    wood.rotation.x = Math.PI / 2; wood.position.z = -0.32;
    envGroup.add(wood);
    var felt = new THREE.Mesh(
      new THREE.CircleGeometry(7.1, 48),
      new THREE.MeshLambertMaterial({ color: t.felt })
    );
    felt.position.z = -0.06;
    envGroup.add(felt);
    // Compartment wall + window frame behind the table.
    var wall = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 18),
      new THREE.MeshLambertMaterial({ color: t.wall })
    );
    wall.position.set(0, 10.5, -6);
    wall.rotation.x = -Math.PI / 3.2;
    envGroup.add(wall);
    var sky = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 5.4),
      new THREE.MeshBasicMaterial({ color: t.sky })
    );
    sky.position.set(0, 11.2, -5.2);
    sky.rotation.x = -Math.PI / 3.2;
    envGroup.add(sky);
    var frame = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 6.4),
      new THREE.MeshLambertMaterial({ color: t.wood })
    );
    frame.position.set(0, 11.05, -5.45);
    frame.rotation.x = -Math.PI / 3.2;
    envGroup.add(frame);
    // Lamp (visual anchor for the key light).
    var lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 16, 12),
      new THREE.MeshBasicMaterial({ color: t.lamp })
    );
    lamp.position.set(0, 1.5, 7.5);
    envGroup.add(lamp);
    scene.add(envGroup);
  }

  function clearGroup(g) {
    if (!g) return;
    g.traverse(function (o) {
      if (o.geometry && o.geometry !== cardGeo) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    scene.remove(g);
  }

  function applyQuality() {
    if (!renderer) return;
    var dpr = window.devicePixelRatio || 1;
    var cap = quality === "high" ? 2 : quality === "medium" ? 1.5 : 1;
    renderer.setPixelRatio(Math.min(dpr, cap));
    renderer.shadowMap.enabled = quality === "high";
    if (lampLight) lampLight.castShadow = quality === "high";
    resize();
  }

  function resize() {
    if (!renderer || !container) return;
    var w = container.clientWidth || 300;
    var h = container.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
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
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true"); // DOM mirror owns a11y

    scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.wall);
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, -12.6, 12.6);
    camera.lookAt(0, 1.0, 0);

    ambLight = new THREE.AmbientLight(0xfff2df, 0.5);
    scene.add(ambLight);
    lampLight = new THREE.PointLight(theme.lamp, 60, 40, 1.8);
    lampLight.position.set(0, 1.5, 7.2);
    scene.add(lampLight);

    cardGeo = new THREE.PlaneGeometry(cardW, cardH);
    buildEnvironment();

    // Selection outline + legal marker.
    outlineMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(cardW + 0.14, cardH + 0.14),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.9 })
    );
    outlineMesh.visible = false;
    scene.add(outlineMesh);
    markerMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.26, 24),
      new THREE.MeshBasicMaterial({ color: 0x9fe6a0, transparent: true, opacity: 0.85 })
    );
    markerMesh.visible = false;
    scene.add(markerMesh);

    particleGroup = new THREE.Group();
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
    resize();
    applyQuality();
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

  function tween(obj, toPos, toRotZ, dur) {
    if (reducedMotion || dur <= 0) {
      obj.position.copy(toPos);
      obj.rotation.z = toRotZ;
      return;
    }
    tweens.push({ obj: obj, from: obj.position.clone(), to: toPos.clone(), fromR: obj.rotation.z, toR: toRotZ, t: 0, dur: dur });
  }

  function burst(pos, color) {
    if (reducedMotion || quality === "low") return;
    var n = quality === "high" ? 18 : 8;
    for (var i = 0; i < n; i++) {
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.09, 0.09),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1 })
      );
      m.position.copy(pos);
      m.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 2 + Math.random() * 2.5);
      m.userData.life = 0.7;
      particleGroup.add(m);
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return; // zero render while backgrounded
    var now = performance.now();
    var dt = Math.min((now - lastFrameTime) / 1000, 0.1);
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
      m.material.opacity = Math.max(0, m.userData.life / 0.7);
      if (m.userData.life <= 0) { m.material.dispose(); m.geometry.dispose(); particleGroup.remove(m); }
    }
    renderer.render(scene, camera);
  }

  function disposeCards() {
    handMeshes.forEach(function (arr) {
      arr.forEach(function (h) { if (h.mesh.material) h.mesh.material.dispose(); scene.remove(h.mesh); });
    });
    discardMeshes.forEach(function (m) { if (m.material) m.material.dispose(); scene.remove(m); });
    if (stockMesh) { stockMesh.material.dispose(); scene.remove(stockMesh); stockMesh = null; }
    handMeshes = [];
    discardMeshes = [];
    tweens = [];
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

  // Render a full immutable snapshot. opts: { legalPlays:[ids], onTurn, selectedCardId, animate }
  function renderState(state, opts) {
    opts = opts || {};
    disposeCards();
    legalCardIds = opts.legalPlays || [];
    onTurn = !!opts.onTurn;
    var players = state.players;

    for (var seat = 0; seat < players; seat++) {
      var st = seatTransform(seat, players);
      var hand = state.hands[seat];
      var arr = [];
      var n = hand.length;
      var isMe = seat === 0;
      var faceUp = isMe;
      for (var i = 0; i < n; i++) {
        var card = hand[i];
        var mesh = makeCardMesh(faceUp ? cardFaceTexture(card) : cardBackTexture());
        mesh.userData.cardId = card.id;
        var spread = Math.min(0.62, 5.6 / Math.max(1, n));
        var u = (i - (n - 1) / 2) * spread;
        var px = st.x + (-Math.sin(st.angle)) * u;
        var py = st.y + Math.cos(st.angle) * u;
        var pz = 0.06 + i * 0.004;
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
      handMeshes.push(arr);
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
      dm.position.set(0.9 + ((dc.id * 13) % 7 - 3) * 0.02, 0.3 + ((dc.id * 29) % 7 - 3) * 0.02, 0.05 + d * 0.012);
      dm.rotation.z = jitterR;
      scene.add(dm);
      discardMeshes.push(dm);
    }
    // Stock pile (face down stack).
    if (state.stock.length > 0) {
      stockMesh = makeCardMesh(cardBackTexture());
      stockMesh.position.set(-1.6, 0.3, 0.05 + Math.min(10, state.stock.length) * 0.006);
      stockMesh.rotation.z = 0.08;
      scene.add(stockMesh);
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
      outlineMesh.position.z -= 0.01;
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
        burst(new THREE.Vector3(0.9, 0.3, 0.5), ev.type === "win" ? 0xffe9b0 : 0xffffff);
      }
      if (ev.type === "suit") burst(new THREE.Vector3(0.9, 0.3, 0.6), 0xffd0f0);
    });
  }

  function setTheme(t) {
    theme = t;
    scene.background = new THREE.Color(t.wall);
    lampLight.color = new THREE.Color(t.lamp);
    clearGroup(envGroup);
    buildEnvironment();
  }

  function setSuitPalette(p) {
    if (p === suitPalette) return;
    suitPalette = p;
    Object.keys(texCache).forEach(function (k) { texCache[k].dispose(); });
    texCache = {};
  }

  function destroy() {
    window.removeEventListener("resize", resize);
    disposeCards();
    clearGroup(envGroup);
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
    setQuality: function (q) { quality = q; applyQuality(); },
    resize: resize,
    destroy: destroy,
    isReady: function () { return !!renderer; }
  };
})();
