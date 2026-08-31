// Wild Eights — authoritative local host: static distribution + /api/v1/time +
// WebSocket hosted tables. The server owns the rules engine (game.js), deals,
// validates every command, rejects out-of-turn/malformed/duplicate input
// idempotently, fills empty seats with deterministic AI, and produces the
// authoritative result. Reconnects rehydrate from the REST session detail
// equivalent: a full authoritative snapshot over the socket.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const W = require("./game.js");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8100;
const MAX_MESSAGE = 4096;
const MAX_TABLES = 100;

// --- static distribution -----------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".opus": "audio/ogg"
};

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/v1/time") {
      sendJson(res, 200, { now: new Date().toISOString(), epochMs: Date.now() });
      return;
    }
    if (url.pathname === "/api/v1/health") {
      sendJson(res, 200, { ok: true, tables: Object.keys(tables).length });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "unknown-endpoint" });
      return;
    }
    // Static file, path-traversal safe.
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT) || file.includes("node_modules")) {
      res.writeHead(403); res.end("forbidden\n"); return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end("not found\n"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
  } catch (e) {
    res.writeHead(400); res.end("bad request\n");
  }
});

// --- hosted tables ------------------------------------------------------------
// table = { code, players: [{seat, name, ws|null, ai}], state|null, commands:[],
//           awayLog: {seat: [strings]}, started, result, seed, lastCmdId: {seat:id} }
const tables = {};

function makeCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return tables[code] ? makeCode() : code;
}

function tableSnapshot(t) {
  return W.serialize(t.state);
}

function broadcast(t, obj) {
  const s = JSON.stringify(obj);
  t.players.forEach((p) => {
    if (p.ws && p.ws.readyState === 1) {
      try { p.ws.send(s); } catch (e) { /* dropped client reconnects via snapshot */ }
    }
  });
}

function noteAway(t, exceptSeat, text) {
  t.players.forEach((p) => {
    if (p.seat !== exceptSeat && !p.ws) {
      (t.awayLog[p.seat] = t.awayLog[p.seat] || []).push(text);
    }
  });
}

function sendState(t, events, onlySeat) {
  t.players.forEach((p) => {
    if (onlySeat != null && p.seat !== onlySeat) return;
    if (!p.ws || p.ws.readyState !== 1) return;
    const away = (t.awayLog[p.seat] || []).splice(0);
    try {
      p.ws.send(JSON.stringify({
        type: "state",
        snapshot: tableSnapshot(t),
        yourSeat: p.seat,
        events: events || [],
        away: away
      }));
    } catch (e) { /* reconnect path covers */ }
  });
}

function lobbyState(t) {
  return {
    type: "lobby",
    players: t.players.map((p) => ({ seat: p.seat, name: p.name, ai: !!p.ai, connected: !!p.ws }))
  };
}

function runAIUntilHumanOrEnd(t) {
  let guard = 400;
  const events = [];
  while (t.state && t.state.winner === null && guard-- > 0) {
    const st = t.state;
    const actor = st.pendingSuitFor !== null ? st.pendingSuitFor : st.current;
    const seat = t.players.find((p) => p.seat === actor);
    if (!seat || !seat.ai) break;
    const cmd = W.aiCommand(st, st.difficulty);
    if (!cmd) break;
    const r = W.applyCommand(st, cmd);
    if (r.error) break;
    t.commands.push(cmd);
    if (r.events) events.push(...r.events);
  }
  return events;
}

function startRound(t) {
  t.seed = (Date.now() ^ (t.code.charCodeAt(0) << 8)) >>> 0;
  // Fill empty seats with AI.
  for (let seat = t.players.length; seat < 4; seat++) {
    t.players.push({ seat, name: "AI " + (seat), ai: true, ws: null });
  }
  t.state = W.newGame(t.seed, { players: t.players.length, difficulty: 1 });
  t.started = true;
  t.commands = [];
  t.awayLog = {};
  const events = runAIUntilHumanOrEnd(t);
  sendState(t, events);
}

function handleCmd(t, player, msg) {
  if (!t.started || !t.state) return { error: "not-started" };
  if (t.state.winner !== null) return { error: "game-over" };
  // Idempotent duplicate rejection by command ID.
  if (typeof msg.cmdId === "number") {
    if (t.lastCmdId[player.seat] === msg.cmdId) return { error: "duplicate" };
    t.lastCmdId[player.seat] = msg.cmdId;
  }
  const st = t.state;
  const actor = st.pendingSuitFor !== null ? st.pendingSuitFor : st.current;
  if (actor !== player.seat) return { error: "out-of-turn" };
  const cmd = msg.cmd;
  if (!cmd || typeof cmd !== "object") return { error: "malformed" };
  if (cmd.type === "play") {
    if (typeof cmd.cardId !== "number" || cmd.cardId < 0 || cmd.cardId > 51) return { error: "malformed" };
  } else if (cmd.type === "declareSuit") {
    if (W.SUITS.indexOf(cmd.suit) < 0) return { error: "malformed" };
  } else if (cmd.type !== "draw") {
    return { error: "malformed" };
  }
  const r = W.applyCommand(st, cmd);
  if (r.error) return { error: r.error };
  t.commands.push(cmd);
  noteAway(t, player.seat, describeCmd(player, cmd));
  const events = [...(r.events || []), ...runAIUntilHumanOrEnd(t)];
  sendState(t, events);
  if (st.winner !== null) {
    t.result = { winner: st.winner, score: st.score, reason: st.terminalReason, commands: t.commands.length };
  }
  return {};
}

function describeCmd(player, cmd) {
  if (cmd.type === "draw") return player.name + " drew.";
  if (cmd.type === "declareSuit") return player.name + " declared " + cmd.suit + ".";
  if (cmd.type === "play") return player.name + " played " + W.cardName(W.cardById(cmd.cardId)) + ".";
  return player.name + " acted.";
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  let table = null;
  let me = null;
  let msgCount = 0;
  let windowStart = Date.now();

  ws.on("message", (raw) => {
    // Rate limit: 30 messages per 10s window.
    const now = Date.now();
    if (now - windowStart > 10000) { windowStart = now; msgCount = 0; }
    if (++msgCount > 30) { send({ type: "error", error: "rate-limited" }); return; }
    if (raw.length > MAX_MESSAGE) { send({ type: "error", error: "message-too-large" }); return; }
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { send({ type: "error", error: "bad-json" }); return; }
    if (!msg || typeof msg.type !== "string") { send({ type: "error", error: "bad-message" }); return; }

    if (msg.type === "host") {
      if (Object.keys(tables).length >= MAX_TABLES) { send({ type: "error", error: "server-full" }); return; }
      const code = makeCode();
      table = { code, players: [{ seat: 0, name: cleanName(msg.name), ws, ai: false }], state: null, commands: [], awayLog: {}, started: false, lastCmdId: {} };
      tables[code] = table;
      me = table.players[0];
      send({ type: "hosted", code, seat: 0, players: lobbyState(table).players });
      return;
    }

    if (msg.type === "join") {
      const code = String(msg.code || "").toUpperCase();
      const t = tables[code];
      if (!t) { send({ type: "error", error: "no-such-table" }); return; }
      // Reconnect: same name reclaims its seat.
      const existing = t.players.find((p) => p.wasHuman && p.name === cleanName(msg.name) && (!p.ws || p.ws.readyState !== 1)) ||
                       t.players.find((p) => !p.ai && p.name === cleanName(msg.name));
      if (existing) {
        if (existing.ws && existing.ws.readyState === 1) { send({ type: "error", error: "name-in-use" }); return; }
        existing.ws = ws;
        existing.ai = false;
        table = t; me = existing;
        send({ type: "joined", code, seat: me.seat, players: lobbyState(t).players });
        broadcast(t, lobbyState(t));
        if (t.started && t.state) sendState(t, [], me.seat);
        return;
      }
      if (t.started) { send({ type: "error", error: "already-started" }); return; }
      if (t.players.filter((p) => !p.ai).length >= 4) { send({ type: "error", error: "table-full" }); return; }
      const seat = t.players.length;
      me = { seat, name: cleanName(msg.name), ws, ai: false };
      t.players.push(me);
      table = t;
      send({ type: "joined", code, seat, players: lobbyState(t).players });
      broadcast(t, lobbyState(t));
      return;
    }

    if (!table || !me) { send({ type: "error", error: "not-in-table" }); return; }

    if (msg.type === "start") {
      if (me.seat !== 0) { send({ type: "error", error: "only-host-starts" }); return; }
      if (table.started) { send({ type: "error", error: "already-started" }); return; }
      startRound(table);
      return;
    }
    if (msg.type === "cmd") {
      const r = handleCmd(table, me, msg);
      if (r.error) send({ type: "error", error: r.error });
      return;
    }
    if (msg.type === "state?") {
      if (table.started && table.state) sendState(table, [], me.seat);
      return;
    }
    if (msg.type === "leave") {
      dropFromTable();
      return;
    }
    send({ type: "error", error: "unknown-type" });
  });

  ws.on("close", dropFromTable);
  ws.on("error", () => {});

  function send(o) { try { ws.send(JSON.stringify(o)); } catch (e) {} }

  function dropFromTable() {
    if (!table || !me) { table = null; me = null; return; }
    me.ws = null;
    if (!table.started) {
      table.players = table.players.filter((p) => p !== me);
      table.players.forEach((p, i) => { p.seat = i; });
      if (table.players.length === 0) delete tables[table.code];
      else broadcast(table, lobbyState(table));
    } else {
      // Keep the seat for reconnect; AI covers the seat meanwhile.
      noteAway(table, me.seat, me.name + " disconnected.");
      me.ai = true;
      me.wasHuman = true;
      const events = runAIUntilHumanOrEnd(table);
      sendState(table, events);
    }
    table = null; me = null;
  }
});

function cleanName(n) {
  return String(n || "player").replace(/[^\w .-]/g, "").slice(0, 24) || "player";
}

server.listen(PORT, () => {
  console.log("Wild Eights server on http://localhost:" + PORT + " (ws: /ws)");
});
