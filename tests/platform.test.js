// WEPlatform + canonical StarHermit SDK with a stubbed fetch and a fake launch
// fragment: token read, profile name, cloud save in game:<slug>, settings KV
// patch, control overrides, realtime api shim — and zero fetches standalone.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
function loadSdk() {
  const m = { exports: {} };
  new Function("module", "exports", fs.readFileSync(path.join(ROOT, "starhermit-sdk.js"), "utf8"))(m, m.exports);
  return m.exports;
}
const WEPlatform = require("../platform.js");

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const SLUG = "eights-test";
const USER = "abcdef12-3456-7890-abcd-ef1234567890";
const JWT = "x." + b64url({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 }) + ".y";
const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };

function fakeWindow(hash) {
  return {
    location: { hash, search: "", pathname: "/", hostname: "localhost", href: "http://localhost/" + hash, origin: "http://localhost" },
    history: { state: null, replaceState(_s, _t, url) { this.url = url; } },
  };
}
function stubServer() {
  const calls = [];
  const state = { save: null, settings: {} };
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  const fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url, method, auth: init.headers && init.headers.Authorization, body: init.body });
    if (url === `/api/v1/users/${USER}/profile`) return json({ nickname: "Conductor Cy" });
    if (url.startsWith("/api/v1/me/cloud-saves/")) {
      if (method === "PUT") {
        state.save = Buffer.from(JSON.parse(init.body).dataBase64, "base64");
        return new Response(null, { status: 204 });
      }
      return state.save ? new Response(state.save) : new Response(null, { status: 404 });
    }
    if (url === `/api/v1/games/${SLUG}/settings`) {
      if (method === "PATCH") Object.assign(state.settings, JSON.parse(init.body).settings);
      return json({ settings: state.settings });
    }
    if (url === `/api/v1/games/${SLUG}/controls`) return json({ actions: [{ action: "draw", codes: ["KeyX"] }] });
    if (url === "/api/v1/realtime/rooms") return json({ room: { id: "r1", code: "ABC" } });
    return new Response(null, { status: 404 });
  };
  return { fetch, calls, state };
}

test("hosted: token, profile, cloud save game:<slug>, settings, controls, rooms api", async () => {
  const srv = stubServer();
  const win = fakeWindow("#game_token=" + JWT);
  const sh = loadSdk().create({ window: win, fetch: srv.fetch, ...noTimers });
  sh.init();
  assert.equal(sh.token, JWT);
  assert.equal(win.history.url, "/");
  const P = WEPlatform.create(sh);
  assert.equal(P.hosted, true);
  assert.equal(P.gameKey, SLUG);
  assert.equal(await P.myNickname(), "Conductor Cy");

  P.cloud.markReady();
  P.cloud.save({ version: 1, records: { roundsPlayed: 3 } });
  await sh.flushSave(true);
  const put = srv.calls.find((c) => c.method === "PUT");
  assert.equal(put.url, "/api/v1/me/cloud-saves/" + encodeURIComponent("game:" + SLUG));
  assert.equal((await P.cloud.load()).records.roundsPlayed, 3);

  P.patchSettings({ volMusic: 20 });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(srv.state.settings, { volMusic: 20 });
  assert.equal((await P.getSettings()).volMusic, 20);
  assert.deepEqual(await P.loadBindings({ draw: ["KeyD"], hint: ["KeyH"] }), { draw: ["KeyX"], hint: ["KeyH"] });

  const r = await P.api("/api/v1/realtime/rooms", { method: "POST", body: JSON.stringify({ config: {} }) });
  assert.equal(r.ok, true);
  assert.equal((await r.json()).room.id, "r1");
  const miss = await P.api("/api/v1/realtime/rooms/mine", { expectBody: true });
  assert.equal(miss.status, 404);
  assert.match(P.roomSocketUrl("r1"), /\/ws\/v1\/realtime\?roomId=r1&access_token=/);
  assert.match(P.inviteLink(), new RegExp(`/game-invite/${USER}/${SLUG}$`));
  assert.ok(srv.calls.every((c) => c.auth === "Bearer " + JWT));

  let seen = null;
  P.onAuth((v) => { seen = v; });
  sh.signOut("expired");
  assert.equal(seen, false);
  assert.equal(P.hosted, false);
});

test("standalone: no token means no fetch at all", async () => {
  const srv = stubServer();
  const sh = loadSdk().create({ window: fakeWindow(""), fetch: srv.fetch });
  sh.init();
  const P = WEPlatform.create(sh);
  assert.equal(P.hosted, false);
  assert.equal(P.canSignIn(), false);
  P.cloud.markReady();
  P.cloud.save({ version: 1 });
  P.cloud.flush();
  P.patchSettings({ volMusic: 1 });
  assert.deepEqual(await P.getSettings(), {});
  assert.equal(await P.cloud.load(), null);
  assert.equal(await P.myNickname(), null);
  await P.loadBindings({ draw: ["KeyD"] });
  assert.equal((await P.api("/api/v1/realtime/rooms")).ok, false);
  assert.equal(srv.calls.length, 0);
});

test("toast strings exist in all nine locales", () => {
  const locales = ["en-US", "en-GB", "es-419", "es-ES", "de-DE", "fr-FR", "fr-CA", "pt-BR", "it-IT"];
  for (const l of locales) for (const k of ["signIn", "invite", "inviteCopied", "inviteFailed", "signedOut"]) {
    assert.ok(WEPlatform.STRINGS[l] && WEPlatform.STRINGS[l][k], l + ":" + k);
  }
});
