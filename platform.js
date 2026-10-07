// Wild Eights — StarHermit platform adapter over the canonical SDK
// (starhermit-sdk.js, window.StarHermit, initialised in index.html before
// this script). Exposes window.WEPlatform with the shape app.js expects:
// identity, cloud save, settings KV, control bindings, invite link, the
// `high-score` leaderboard (post + read), and an authenticated `api()` used by the realtime-room tables.
// Without a launch token the module is inert and never touches the network.
(function (root) {
  "use strict";

  // Strings for the StarHermit buttons and toasts (all nine locales).
  var EN = {
    signIn: "Sign in with StarHermit",
    invite: "Invite a friend",
    inviteCopied: "Invite link copied to the clipboard.",
    inviteFailed: "Could not copy. Invite link: {link}",
    signedOut: "Signed out of StarHermit — playing locally.",
    sessionExpired: "Your StarHermit session expired.",
    relaunch: "Back to StarHermit",
    lbPosting: "Posting score to the leaderboard…", lbRank: "Leaderboard rank: #{rank}",
    lbPosted: "Score posted to the leaderboard.", lbNotPosted: "Score not posted to the leaderboard."
  };
  var STRINGS = {
    "en-US": EN,
    "en-GB": EN,
    "es-419": {
      signIn: "Iniciar sesión con StarHermit", invite: "Invitar a un amigo",
      inviteCopied: "Enlace de invitación copiado al portapapeles.",
      inviteFailed: "No se pudo copiar. Enlace de invitación: {link}",
      signedOut: "Se cerró la sesión de StarHermit: juegas en modo local.",
      sessionExpired: "Tu sesión de StarHermit expiró.", relaunch: "Volver a StarHermit",
      lbPosting: "Enviando la puntuación a la clasificación…", lbRank: "Puesto en la clasificación: #{rank}",
      lbPosted: "Puntuación enviada a la clasificación.", lbNotPosted: "No se envió la puntuación a la clasificación."
    },
    "es-ES": {
      signIn: "Iniciar sesión con StarHermit", invite: "Invitar a un amigo",
      inviteCopied: "Enlace de invitación copiado al portapapeles.",
      inviteFailed: "No se ha podido copiar. Enlace de invitación: {link}",
      signedOut: "Se ha cerrado la sesión de StarHermit: juegas en local.",
      sessionExpired: "Tu sesión de StarHermit ha caducado.", relaunch: "Volver a StarHermit",
      lbPosting: "Enviando la puntuación a la clasificación…", lbRank: "Puesto en la clasificación: #{rank}",
      lbPosted: "Puntuación enviada a la clasificación.", lbNotPosted: "No se ha enviado la puntuación a la clasificación."
    },
    "de-DE": {
      signIn: "Mit StarHermit anmelden", invite: "Freund einladen",
      inviteCopied: "Einladungslink in die Zwischenablage kopiert.",
      inviteFailed: "Kopieren fehlgeschlagen. Einladungslink: {link}",
      signedOut: "Von StarHermit abgemeldet – du spielst lokal weiter.",
      sessionExpired: "Deine StarHermit-Sitzung ist abgelaufen.", relaunch: "Zurück zu StarHermit",
      lbPosting: "Punktzahl wird an die Bestenliste gesendet …", lbRank: "Platz in der Bestenliste: #{rank}",
      lbPosted: "Punktzahl an die Bestenliste gesendet.", lbNotPosted: "Punktzahl nicht an die Bestenliste gesendet."
    },
    "fr-FR": {
      signIn: "Se connecter avec StarHermit", invite: "Inviter un ami",
      inviteCopied: "Lien d’invitation copié dans le presse-papiers.",
      inviteFailed: "Copie impossible. Lien d’invitation : {link}",
      signedOut: "Déconnecté de StarHermit — vous jouez en local.",
      sessionExpired: "Votre session StarHermit a expiré.", relaunch: "Retour à StarHermit",
      lbPosting: "Envoi du score au classement…", lbRank: "Rang au classement : #{rank}",
      lbPosted: "Score envoyé au classement.", lbNotPosted: "Score non envoyé au classement."
    },
    "fr-CA": {
      signIn: "Se connecter avec StarHermit", invite: "Inviter un ami",
      inviteCopied: "Lien d’invitation copié dans le presse-papiers.",
      inviteFailed: "Impossible de copier. Lien d’invitation : {link}",
      signedOut: "Déconnecté de StarHermit — vous jouez en mode local.",
      sessionExpired: "Votre session StarHermit a expiré.", relaunch: "Retour à StarHermit",
      lbPosting: "Envoi du pointage au classement…", lbRank: "Rang au classement : #{rank}",
      lbPosted: "Pointage envoyé au classement.", lbNotPosted: "Pointage non envoyé au classement."
    },
    "pt-BR": {
      signIn: "Entrar com StarHermit", invite: "Convidar um amigo",
      inviteCopied: "Link de convite copiado para a área de transferência.",
      inviteFailed: "Não foi possível copiar. Link de convite: {link}",
      signedOut: "Você saiu do StarHermit — jogando localmente.",
      sessionExpired: "Sua sessão do StarHermit expirou.", relaunch: "Voltar ao StarHermit",
      lbPosting: "Enviando a pontuação para o ranking…", lbRank: "Posição no ranking: #{rank}",
      lbPosted: "Pontuação enviada para o ranking.", lbNotPosted: "A pontuação não foi enviada para o ranking."
    },
    "it-IT": {
      signIn: "Accedi con StarHermit", invite: "Invita un amico",
      inviteCopied: "Link di invito copiato negli appunti.",
      inviteFailed: "Impossibile copiare. Link di invito: {link}",
      signedOut: "Disconnesso da StarHermit: giochi in locale.",
      sessionExpired: "La tua sessione StarHermit è scaduta.", relaunch: "Torna a StarHermit",
      lbPosting: "Invio del punteggio alla classifica…", lbRank: "Posizione in classifica: #{rank}",
      lbPosted: "Punteggio inviato alla classifica.", lbNotPosted: "Punteggio non inviato alla classifica."
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

  function create(sh, env) {
    env = env || {};
    var setT = env.setTimeout || (typeof setTimeout === "function" ? setTimeout : null);
    var clearT = env.clearTimeout || (typeof clearTimeout === "function" ? clearTimeout : null);
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
        if (authHandler) authHandler(false, (e && e.reason) || "signed-out");
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

    // Reopen a realtime-room socket. A failed reconnect may be an expired
    // token (the handshake is refused before the upgrade and the browser only
    // reports 1006), so the token is renewed first and h.open() builds the
    // URL from the fresh token. 'retry' backs off (delays) without reopening
    // the old URL; 'relaunch' stops for good and calls h.onExpired().
    var RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];
    function reconnect(h) {
      var attempt = 0, timer = null, stopped = false;
      var delays = h.delays || RECONNECT_DELAYS;
      function step() {
        timer = null;
        if (stopped) return;
        var p = sh && sh.renewForReconnect ? sh.renewForReconnect() : Promise.resolve("relaunch");
        p.then(function (r) {
          if (stopped) return;
          if (r === "renewed") { stopped = true; h.open(); return; }
          if (r !== "retry") { stopped = true; if (h.onExpired) h.onExpired(); return; }
          if (attempt >= delays.length || !setT) { stopped = true; if (h.onGiveUp) h.onGiveUp(); return; }
          timer = setT(step, delays[attempt++]);
        });
      }
      step();
      return { cancel: function () { stopped = true; if (timer && clearT) clearT(timer); timer = null; } };
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
      // Built at open time from the current (possibly renewed) token.
      roomSocketUrl: function (roomId) { return sh.realtime.socketUrl(roomId); },
      reconnect: reconnect,
      relaunch: function () { return !!(sh && sh.relaunch()); },
      cloud: cloud,
      gameInfo: function () { return active ? sh.getGame() : Promise.resolve(null); },
      leaderboard: function (opts) { return active ? sh.leaderboard("high-score", opts) : Promise.resolve({ items: [], board: null }); },
      // Post a finished solo round to the `high-score` board through the game's
      // score-script.js (StarHermit.submitScores) → { posted, rank }.
      submitScore: function (total) {
        if (!active) return Promise.resolve({ posted: false, rank: null });
        return sh.submitScores({ "high-score": total }).then(function (keys) {
          if (!keys || keys.indexOf("high-score") < 0) return { posted: false, rank: null };
          return sh.leaderboard("high-score", { pageSize: 100 }).then(function (r) {
            var me = (r.items || []).filter(function (i) { return i.userId === sh.userId; })[0];
            return { posted: true, rank: me ? me.rank : null };
          }, function () { return { posted: true, rank: null }; });
        });
      },
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

  // "Your session expired" banner with a "Back to StarHermit" button; the
  // click (a user gesture) sends the player to the launcher for a new token.
  function showExpired(P, doc) {
    doc = doc || root.document;
    if (!doc) return null;
    var box = doc.getElementById("sh-expired");
    if (!box) {
      box = doc.createElement("div");
      box.id = "sh-expired";
      box.className = "sh-toast sh-expired";
      box.setAttribute("role", "alert");
      var msg = doc.createElement("p");
      msg.className = "sh-expired-msg";
      var btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "btn primary";
      btn.id = "btn-relaunch";
      btn.addEventListener("click", function () { P.relaunch(); });
      box.appendChild(msg);
      box.appendChild(btn);
      doc.body.appendChild(box);
      box.msg = msg; box.btn = btn;
    }
    (box.msg || box.querySelector(".sh-expired-msg")).textContent = P.t("sessionExpired");
    (box.btn || box.querySelector("button")).textContent = P.t("relaunch");
    box.hidden = false;
    return box;
  }

  var WEPlatform = create(root.StarHermit || null);
  WEPlatform.create = create;
  WEPlatform.showExpired = showExpired;
  WEPlatform.STRINGS = STRINGS;
  root.WEPlatform = WEPlatform;
  if (typeof module !== "undefined" && module.exports) module.exports = WEPlatform;
})(typeof window !== "undefined" ? window : globalThis);
