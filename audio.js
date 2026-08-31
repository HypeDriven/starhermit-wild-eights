// Wild Eights — procedural WebAudio. Original short transients tied to logical
// events, quiet compartment ambience, adaptive music stem. No external assets.
// Buses: music / effects / ambience, each with its own gain slider value 0..1.
(function (root) {
  "use strict";

  var ctx = null;
  var buses = null; // { music, effects, ambience } GainNodes
  var levels = { music: 0.5, effects: 0.8, ambience: 0.4 };
  var muted = false;
  var timerId = null;
  var nextNoteTime = 0;
  var stepIndex = 0;
  var noiseSrc = null;

  var beatDur = 60 / 84;
  var eighth = beatDur / 2;

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  var chords = [
    [48, 52, 55, 59], // Cmaj7
    [45, 48, 52, 56], // Am7
    [41, 45, 48, 53], // Fmaj7
    [43, 47, 50, 54]  // G7
  ];
  var melody = [
    60, -1, 64, -1, 67, -1, 69, -1,
    65, -1, 64, -1, 62, -1, 60, -1,
    58, -1, 60, -1, 63, -1, 67, -1,
    64, -1, 62, -1, 60, -1, 59, -1
  ];

  function ensureCtx() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      buses = {};
      ["music", "effects", "ambience"].forEach(function (name) {
        var g = ctx.createGain();
        g.gain.value = muted ? 0 : levels[name];
        g.connect(ctx.destination);
        buses[name] = g;
      });
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function applyLevels() {
    if (!buses) return;
    Object.keys(buses).forEach(function (name) {
      buses[name].gain.value = muted ? 0 : levels[name];
    });
  }

  function note(bus, freq, t, dur, gainVal, type) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(buses[bus]);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  function noiseBurst(bus, t, dur, gainVal, filterFreq) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = filterFreq || 1800; f.Q.value = 0.8;
    var g = ctx.createGain();
    g.gain.value = gainVal;
    src.connect(f); f.connect(g); g.connect(buses[bus]);
    src.start(t);
  }

  function scheduleStep(step, t) {
    var bar = Math.floor(step / 8) % chords.length;
    var chord = chords[bar];
    if (step % 2 === 0) note("music", midiToFreq(chord[0] - 12), t, eighth * 1.8, 0.30, "triangle");
    note("music", midiToFreq(chord[1]), t, eighth * 3.4, 0.14);
    note("music", midiToFreq(chord[2]), t, eighth * 3.4, 0.14);
    note("music", midiToFreq(chord[3]), t, eighth * 3.4, 0.12);
    var m = melody[step % melody.length];
    if (m >= 0) note("music", midiToFreq(m), t, eighth * 1.6, 0.30);
  }

  function startMusic() {
    if (!ensureCtx()) return;
    nextNoteTime = ctx.currentTime + 0.08;
    stepIndex = 0;
    if (timerId !== null) root.clearInterval(timerId);
    timerId = root.setInterval(function () {
      if (root.document && root.document.hidden) return;
      while (nextNoteTime < ctx.currentTime + 0.35) {
        scheduleStep(stepIndex, nextNoteTime);
        nextNoteTime += eighth;
        stepIndex++;
      }
    }, 25);
  }

  function stopMusic() {
    if (timerId !== null) { root.clearInterval(timerId); timerId = null; }
  }

  // Quiet railway ambience: looped filtered noise (wheels on rails).
  function startAmbience() {
    if (!ensureCtx() || noiseSrc) return;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var v = 0;
    for (var i = 0; i < len; i++) { v = v * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = v * 6; }
    noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buf; noiseSrc.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 320;
    noiseSrc.connect(f); f.connect(buses.ambience);
    noiseSrc.start();
  }

  // Authored sample one-shots (sfx/<name>.opus, see sfx/manifest.json) mapped
  // onto the same logical events. Clips are lazy-fetched after the user-gesture
  // unlock and decoded/cached per name; missing or failed clips fall back to
  // the synthesized effect below, which also covers the loading window.
  var sampleMap = {
    select: ["ui-select-tick", "ui-select-card"],
    confirm: ["ui-confirm", "ui-confirm-chip"],
    play: ["card-play", "card-play-felt"],
    draw: ["card-draw"],
    eight: ["wild-eight-chime"],
    error: ["ui-error-buzz"],
    win: ["victory-fanfare"],
    lose: ["defeat-descend"],
    turn: ["turn-notify", "turn-tap"]
  };
  var sampleCache = {}; // clip name -> AudioBuffer | "loading" | "failed"
  var samplePick = {};  // event name -> variant rotation index

  function loadSample(name) {
    if (sampleCache[name]) return;
    sampleCache[name] = "loading";
    root.fetch("sfx/" + encodeURIComponent(name) + ".opus")
      .then(function (r) {
        if (!r.ok) throw new Error("sfx http " + r.status);
        return r.arrayBuffer();
      })
      .then(function (ab) { return ctx.decodeAudioData(ab); })
      .then(function (buf) { sampleCache[name] = buf; })
      .catch(function () { sampleCache[name] = "failed"; });
  }

  // Returns true when a cached sample was started (no synth needed).
  function trySample(name) {
    var clips = sampleMap[name];
    if (!clips || !root.fetch) return false;
    var i = (samplePick[name] || 0) % clips.length;
    samplePick[name] = i + 1;
    var clip = clips[i];
    var entry = sampleCache[clip];
    if (!entry) { loadSample(clip); return false; }
    if (entry === "loading" || entry === "failed") return false;
    var src = ctx.createBufferSource();
    src.buffer = entry;
    src.connect(buses.effects);
    src.start();
    return true;
  }

  // Event sound effects — each tied to a logical game event.
  var sfx = {
    select: function () { note("effects", 660, ctx.currentTime + 0.01, 0.07, 0.25); },
    confirm: function () { note("effects", 520, ctx.currentTime + 0.01, 0.09, 0.3); note("effects", 780, ctx.currentTime + 0.06, 0.1, 0.25); },
    play: function () { noiseBurst("effects", ctx.currentTime + 0.01, 0.08, 0.5, 2200); note("effects", 340, ctx.currentTime + 0.02, 0.08, 0.2); },
    draw: function () { noiseBurst("effects", ctx.currentTime + 0.01, 0.12, 0.4, 1200); },
    eight: function () { var t = ctx.currentTime + 0.01;[523, 659, 784].forEach(function (f, i) { note("effects", f, t + i * 0.05, 0.12, 0.28); }); },
    error: function () { note("effects", 160, ctx.currentTime + 0.01, 0.16, 0.3, "square"); },
    win: function () { var t = ctx.currentTime + 0.01;[523, 659, 784, 1047].forEach(function (f, i) { note("effects", f, t + i * 0.09, 0.22, 0.3); }); },
    lose: function () { var t = ctx.currentTime + 0.01;[392, 330, 262].forEach(function (f, i) { note("effects", f, t + i * 0.11, 0.22, 0.25); }); },
    turn: function () { note("effects", 440, ctx.currentTime + 0.01, 0.06, 0.15); }
  };

  function play(name) {
    if (!ensureCtx() || muted) return;
    if (trySample(name)) return;
    var fn = sfx[name];
    if (fn) fn();
  }

  root.WEAudio = {
    unlock: ensureCtx,
    setLevel: function (bus, v) { if (bus in levels) { levels[bus] = Math.max(0, Math.min(1, v)); applyLevels(); } },
    getLevel: function (bus) { return levels[bus]; },
    setMuted: function (m) { muted = !!m; applyLevels(); },
    isMuted: function () { return muted; },
    startMusic: startMusic, stopMusic: stopMusic,
    startAmbience: startAmbience,
    play: play
  };
})(typeof window !== "undefined" ? window : globalThis);
