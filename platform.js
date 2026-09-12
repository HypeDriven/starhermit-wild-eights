// Wild Eights — StarHermit platform adapter: launch token, account profile,
// cloud save, read-only leaderboards. Loaded before app.js; exposes
// window.WEPlatform. Everything here is best-effort: when no launch token was
// read the module is inert and offline/local play never touches the network.
(function (root) {
  "use strict";

  var token = null, sub = null, gameKey = null, sessionId = null;
  var hosted = false; // true iff a launch token was read from the URL
  var profileCache = {};
  var statusHandler = null;

  // ---------------------------------------------------------------------------
  // Launch token: fragment #game_token=<jwt> (&session_id=<guid>), read once
  // and stripped. Query-param fallbacks exist for local dev only.
  function decodeJwt(jwt) {
    var parts = String(jwt || "").split(".");
    if (parts.length < 2) return null;
    try {
      var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var json = (typeof atob !== "undefined")
        ? atob(b64)
        : Buffer.from(b64, "base64").toString("binary");
      return JSON.parse(decodeURIComponent(escape(json)));
    } catch (e) { return null; }
  }

  function readToken() {
    if (typeof location === "undefined") return;
    var read = null;
    if (location.hash && location.hash.indexOf("game_token=") >= 0) {
      var rest = [];
      location.hash.replace(/^#/, "").split("&").forEach(function (p) {
        var kv = p.split("=");
        var key = decodeURIComponent(kv[0] || "");
        var val = decodeURIComponent(kv.slice(1).join("=") || "");
        if (key === "game_token") read = val;
        else if (key === "session_id") sessionId = val;
        else rest.push(p);
      });
      try {
        history.replaceState(null, "", location.pathname + location.search +
          (rest.length ? "#" + rest.join("&") : ""));
      } catch (e) { /* hash stays: token is short-lived anyway */ }
    }
    if (!read && /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(location.hostname)) {
      var m = /[?&](?:token|launch|launch_token|game_token)=([^&]+)/.exec(location.search);
      if (m) read = decodeURIComponent(m[1]);
    }
    if (!read) return;
    var payload = decodeJwt(read);
    if (!payload || !payload.sub) return;
    token = read;
    sub = String(payload.sub);
    gameKey = payload.game_scope || null;
    hosted = true;
  }

  // ---------------------------------------------------------------------------
  // Authenticated REST. Authorization: Bearer on every call; same-origin only.
  function api(path, opts) {
    opts = opts || {};
    var h = opts.headers || {};
    h["Authorization"] = "Bearer " + token;
    opts.headers = h;
    return fetch(path, opts);
  }
  function apiJson(path, opts) {
    return api(path, opts)
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .catch(function () { return null; });
  }

  // Token lifetime is 60 min; re-mint scoped tokens every 45, retry ~60 s.
  var REFRESH_MS = 45 * 60 * 1000;
  var refreshTimer = null;
  function scheduleRefresh() {
    if (!hosted || !gameKey || typeof setTimeout === "undefined") return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshToken, REFRESH_MS);
  }
  function refreshToken() {
    if (!hosted || !gameKey) return;
    api("/api/v1/games/" + encodeURIComponent(gameKey) + "/launch-token", { method: "POST" })
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (j) {
        if (j && j.token) {
          token = j.token;
          var p = decodeJwt(token);
          if (p && p.sub) sub = String(p.sub);
        }
        scheduleRefresh();
      })
      .catch(function () {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refreshToken, 60000);
      });
  }

  // ---------------------------------------------------------------------------
  // Profile. NEVER GET /api/v1/me (403 under game scope); never usernames.
  function getProfile(userId) {
    var id = String(userId);
    if (profileCache[id]) return Promise.resolve(profileCache[id]);
    return apiJson("/api/v1/users/" + encodeURIComponent(id) + "/profile")
      .then(function (j) {
        if (j && (j.id || j.nickname)) profileCache[id] = j;
        return j || null;
      });
  }
  function displayName(p) {
    if (p && p.nickname) return p.nickname;
    if (p && p.id) return "Player " + String(p.id).slice(0, 8);
    return "Player";
  }
  function myNickname() {
    if (!hosted) return Promise.resolve(null);
    return getProfile(sub).then(function (p) {
      return (p && p.nickname) || "Player " + String(sub).slice(0, 8);
    });
  }

  // ---------------------------------------------------------------------------
  // Minimal ZIP writer/reader (stored entries only, no compression).
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipStore(name, dataBytes) {
    const enc = new TextEncoder();
    const nameB = enc.encode(name);
    const crc = crc32(dataBytes);
    const out = [];
    const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
    const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
    u32(crc); u32(dataBytes.length); u32(dataBytes.length);
    u16(nameB.length); u16(0);
    const local = out.length;
    const head = new Uint8Array(out);
    const cd = [];
    const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
    const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
    c32(crc); c32(dataBytes.length); c32(dataBytes.length);
    c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
    const cdHead = new Uint8Array(cd);
    const cdOff = head.length + nameB.length + dataBytes.length;
    const parts = [head, nameB, dataBytes, cdHead, nameB];
    const eocd = [];
    const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
    e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
    e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
    parts.push(new Uint8Array(eocd));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    return buf;
  }
  function unzipFirstEntry(zipBytes) {
    // Stored single-entry reader: scan local headers for compression 0.
    const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    let off = 0;
    while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
      const method = dv.getUint16(off + 8, true);
      const size = dv.getUint32(off + 18, true);
      const nameLen = dv.getUint16(off + 26, true);
      const extraLen = dv.getUint16(off + 28, true);
      const dataOff = off + 30 + nameLen + extraLen;
      if (method !== 0) throw new Error('unsupported zip entry');
      return zipBytes.slice(dataOff, dataOff + size);
    }
    throw new Error('bad zip');
  }
  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function base64ToBytes(b64) {
    const s = atob(b64);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  // ---------------------------------------------------------------------------
  // Cloud save: ONE slot keyed by the game slug from game_scope. localStorage
  // stays the offline cache; the cloud is a mirror (remote wins on conflict).
  var cloud = (function () {
    var ready = false;      // first load attempt finished — safe to write
    var latest = null;      // last doc handed to save()
    var timer = null;
    var flushing = false;

    function setStatus(s) { if (statusHandler) statusHandler(s); }
    function slot() { return "/api/v1/me/cloud-saves/" + encodeURIComponent(gameKey); }
    function enabled() { return hosted && !!gameKey && typeof fetch !== "undefined"; }

    function load() {
      if (!enabled()) return Promise.resolve(null);
      return api(slot())
        .then(function (r) { return r.status === 200 ? r.arrayBuffer() : null; })
        .catch(function () { return null; })
        .then(function (buf) {
          if (!buf) return null;
          try {
            var bytes = unzipFirstEntry(new Uint8Array(buf));
            return JSON.parse(new TextDecoder().decode(bytes));
          } catch (e) { return null; }
        });
    }
    function push(doc) {
      if (!enabled() || !ready) return Promise.resolve(false);
      var body;
      try {
        body = JSON.stringify({
          dataBase64: bytesToBase64(zipStore("save.json", new TextEncoder().encode(JSON.stringify(doc))))
        });
      } catch (e) { return Promise.resolve(false); }
      setStatus("saving");
      return api(slot(), { method: "PUT", headers: { "Content-Type": "application/json" }, body: body })
        .then(function (r) { setStatus(r.ok ? "synced" : "offline"); return r.ok; })
        .catch(function () { setStatus("offline"); return false; });
    }
    function save(doc) {
      if (!enabled() || !ready) return;
      latest = doc;
      clearTimeout(timer);
      timer = setTimeout(function () { push(latest); }, 2000); // ~2 s debounce
    }
    function flush() {
      if (!enabled() || !ready || latest === null) return;
      clearTimeout(timer);
      var doc = latest;
      latest = null;
      if (!flushing) {
        flushing = true;
        push(doc).then(function () { flushing = false; });
      }
    }
    if (typeof addEventListener === "function" && typeof document !== "undefined") {
      addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
    }
    return {
      load: load,
      save: save,
      flush: flush,
      markReady: function () { ready = true; }
    };
  })();

  // ---------------------------------------------------------------------------
  // Leaderboards: read-only, hosted only. Clients can never submit.
  function gameInfo() {
    if (!hosted || !gameKey) return Promise.resolve(null);
    return apiJson("/api/v1/games/" + encodeURIComponent(gameKey));
  }
  function boardEntries(leaderboardId, opts) {
    opts = opts || {};
    if (!hosted) return Promise.resolve(null);
    var q = "?pageSize=" + (opts.pageSize || 10);
    if (opts.friendsOnly) q += "&friendsOnly=1";
    if (opts.page) q += "&page=" + opts.page;
    return apiJson("/api/v1/leaderboards/" + encodeURIComponent(leaderboardId) + "/entries" + q);
  }

  readToken();

  var WEPlatform = {
    hosted: hosted,
    sub: sub,
    gameKey: gameKey,
    sessionId: sessionId,
    authToken: function () { return token; },
    api: api,
    refresh: scheduleRefresh,
    myNickname: myNickname,
    getProfile: getProfile,
    displayName: displayName,
    cloud: cloud,
    gameInfo: gameInfo,
    boardEntries: boardEntries,
    onStatus: function (fn) { statusHandler = fn; },
    // exposed for strict offline validation of the zip writer (tests only)
    __zip: { zipStore: zipStore, unzipFirstEntry: unzipFirstEntry, bytesToBase64: bytesToBase64, base64ToBytes: base64ToBytes }
  };
  root.WEPlatform = WEPlatform;
  if (typeof module !== "undefined" && module.exports) module.exports = WEPlatform;
})(typeof window !== "undefined" ? window : globalThis);
