// Wild Eights — StarHermit platform adapter over the canonical SDK
// (starhermit-sdk.js, window.StarHermit, initialised in index.html before
// this script). Exposes window.WEPlatform with the shape app.js expects:
// identity, cloud save, settings KV, control bindings, invite link, read-only
// leaderboard, and an authenticated `api()` used by the realtime-room tables.
// Without a launch token the module is inert and never touches the network.
(function (root) {
  "use strict";

  // Strings for the StarHermit buttons and toasts (all nine locales).
  var EN = {
    signIn: "Sign in with StarHermit",
    invite: "Invite a friend",
    inviteCopied: "Invite link copied to the clipboard.",
    inviteFailed: "Could not copy. Invite link: {link}",
    signedOut: "Signed out of StarHermit — playing locally."
  };
  var STRINGS = {
    "en-US": EN,
    "en-GB": EN,
    "es-419": {
      signIn: "Iniciar sesión con StarHermit", invite: "Invitar a un amigo",
      inviteCopied: "Enlace de invitación copiado al portapapeles.",
      inviteFailed: "No se pudo copiar. Enlace de invitación: {link}",
      signedOut: "Se cerró la sesión de StarHermit: juegas en modo local."
    },
    "es-ES": {
      signIn: "Iniciar sesión con StarHermit", invite: "Invitar a un amigo",
      inviteCopied: "Enlace de invitación copiado al portapapeles.",
      inviteFailed: "No se ha podido copiar. Enlace de invitación: {link}",
      signedOut: "Se ha cerrado la sesión de StarHermit: juegas en local."
    },
    "de-DE": {
      signIn: "Mit StarHermit anmelden", invite: "Freund einladen",
      inviteCopied: "Einladungslink in die Zwischenablage kopiert.",
      inviteFailed: "Kopieren fehlgeschlagen. Einladungslink: {link}",
      signedOut: "Von StarHermit abgemeldet – du spielst lokal weiter."
    },
    "fr-FR": {
      signIn: "Se connecter avec StarHermit", invite: "Inviter un ami",
      inviteCopied: "Lien d’invitation copié dans le presse-papiers.",
      inviteFailed: "Copie impossible. Lien d’invitation : {link}",
      signedOut: "Déconnecté de StarHermit — vous jouez en local."
    },
    "fr-CA": {
      signIn: "Se connecter avec StarHermit", invite: "Inviter un ami",
      inviteCopied: "Lien d’invitation copié dans le presse-papiers.",
      inviteFailed: "Impossible de copier. Lien d’invitation : {link}",
      signedOut: "Déconnecté de StarHermit — vous jouez en mode local."
    },
    "pt-BR": {
      signIn: "Entrar com StarHermit", invite: "Convidar um amigo",
      inviteCopied: "Link de convite copiado para a área de transferência.",
      inviteFailed: "Não foi possível copiar. Link de convite: {link}",
      signedOut: "Você saiu do StarHermit — jogando localmente."
    },
    "it-IT": {
      signIn: "Accedi con StarHermit", invite: "Invita un amico",
      inviteCopied: "Link di invito copiato negli appunti.",
      inviteFailed: "Impossibile copiare. Link di invito: {link}",
      signedOut: "Disconnesso da StarHermit: giochi in locale."
    }
  };
  function pickLocale(tag) {
    var gp = root.WEGraphicsPanel;
    if (gp && gp.pickLocale) return gp.pickLocale(tag);
    return STRINGS[tag] ? tag : "en-US";
  }
  function translator(locale) {
    var table = STRINGS[pickLocale(locale)] || EN;
    return function (key, vars) {
      var s = table[key] != null ? table[key] : (EN[key] != null ? EN[key] : key);
      if (vars) for (var k in vars) s = s.replace("{" + k + "}", vars[k]);
      return s;
    };
  }

  function create(sh) {
    var statusHandler = null, authHandler = null;
    var ready = false; // first cloud load finished — safe to write
    var active = !!(sh && sh.token);

    function setStatus(s) { if (statusHandler) statusHandler(s); }
    if (sh) {
      sh.on("saved", function (ok) { if (active) setStatus(ok ? "synced" : "offline"); });
      sh.on("auth", function (e) {
        if (e && e.signedIn) return;
        active = false;
        setStatus("offline");
        if (authHandler) authHandler(false);
      });
    }

    // Response-like wrapper over StarHermit.api for the realtime-room code:
    // { ok, status, json() }. A 404 surfaces as ok:false/status 404 when the
    // caller needs a body (`opts.expectBody`).
    function api(path, opts) {
      opts = opts || {};
      if (!active) return Promise.resolve({ ok: false, status: 401, json: function () { return Promise.resolve(null); } });
      var body = opts.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { /* keep raw */ } }
      return sh.api(path, { method: opts.method || "GET", body: body }).then(function (j) {
        if (j == null && opts.expectBody) return { ok: false, status: 404, json: function () { return Promise.resolve(null); } };
        return { ok: true, status: j == null ? 204 : 200, json: function () { return Promise.resolve(j); } };
      }, function (e) {
        return { ok: false, status: (e && e.status) || 0, json: function () { return Promise.resolve((e && e.body) || null); } };
      });
    }

    // Profile: { id, nickname, displayName } (nickname first; never /api/v1/me).
    function getProfile(userId) {
      if (!active) return Promise.resolve(null);
      return sh.profile(String(userId)).then(function (p) {
        return p ? { id: p.userId, nickname: p.nickname, displayName: p.displayName } : null;
      });
    }
    function displayName(p) {
      if (p && p.displayName) return p.displayName;
      if (p && p.nickname) return p.nickname;
      if (p && p.id) return "Player " + String(p.id).slice(0, 6);
      return "Player";
    }
    function myNickname() {
      if (!active) return Promise.resolve(null);
      return sh.profile().then(function (p) { return p ? p.displayName : null; });
    }

    // Cloud save: the whole save document in the game:<slug> slot.
    var cloud = {
      load: function () { return active ? sh.loadJSON() : Promise.resolve(null); },
      save: function (doc) {
        if (!active || !ready) return;
        setStatus("saving");
        sh.saveJSON(doc, 2000);
      },
      flush: function () { if (active && ready) sh.flushSave(true); },
      markReady: function () { ready = true; }
    };
    if (typeof addEventListener === "function" && typeof document !== "undefined") {
      addEventListener("pagehide", cloud.flush);
      document.addEventListener("visibilitychange", function () { if (document.hidden) cloud.flush(); });
    }

    return {
      get hosted() { return active; },
      get sub() { return active ? sh.userId : null; },
      get gameKey() { return sh ? sh.slug : null; },
      get sessionId() { return sh ? sh.launchSessionId : null; },
      authToken: function () { return active ? sh.token : null; },
      api: api,
      refresh: function () { /* renewal is the SDK's job */ },
      myNickname: myNickname,
      getProfile: getProfile,
      displayName: displayName,
      friends: function () { return active ? sh.friends() : Promise.resolve([]); },
      roomSocketUrl: function (roomId) { return sh.realtime.socketUrl(roomId); },
      cloud: cloud,
      gameInfo: function () { return active ? sh.getGame() : Promise.resolve(null); },
      leaderboard: function (opts) { return active ? sh.leaderboard(null, opts) : Promise.resolve({ items: [], board: null }); },
      getSettings: function () { return active ? sh.getSettings() : Promise.resolve({}); },
      patchSettings: function (obj) { if (active) sh.patchSettings(obj); },
      loadBindings: function (defaults) {
        if (active) return sh.loadBindings(defaults);
        var out = {};
        for (var k in defaults) out[k] = defaults[k].slice();
        return Promise.resolve(out);
      },
      canSignIn: function () { return !!(sh && sh.canSignIn()); },
      signIn: function () { return !!(sh && sh.signIn()); },
      inviteLink: function () { return active ? sh.inviteLink() : null; },
      t: translator(typeof navigator !== "undefined" && (navigator.languages && navigator.languages[0] || navigator.language)),
      translator: translator,
      onStatus: function (fn) { statusHandler = fn; },
      onAuth: function (fn) { authHandler = fn; }
    };
  }

  var WEPlatform = create(root.StarHermit || null);
  WEPlatform.create = create;
  WEPlatform.STRINGS = STRINGS;
  root.WEPlatform = WEPlatform;
  if (typeof module !== "undefined" && module.exports) module.exports = WEPlatform;
})(typeof window !== "undefined" ? window : globalThis);
