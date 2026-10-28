// Hosted tables: StarHermit realtime rooms for the lobby, and the session the
// platform binds to a started room for the round, refereed by server.js
// (after ~/games/territory-trail js/online.js).
//
// Host a table makes a room of one team with four seats and opens it for
// quick join and its join code; Join takes a code, Quick join any open table
// of this game (none open: a new table, as the browser build did), an invite
// joins the inviting host's table. The host presses Start round; the
// platform fills the empty seats with AI participants and binds a session
// running server.js. Every client then opens the session's game socket,
// sends { type: 'sync' } on every (re)connection and sends its moves as
// commands; the script answers with this seat's view after every change. The
// result is the script's (no client ever posts one).
//
// `platform` is the adapter native/platform.ts provides (and the node tests
// fake): { userId, createRoom, openRoom, startRoom, leaveRoom, getRoom,
// joinByCode, quickJoin, myRoom, invites, acceptInvite, inviteFriend,
// friends, connectRoom(roomId, handlers), connectGame(sessionId, handlers) }.
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WEOnline = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var SEATS = 4;
  var SHAPE = { teamCount: 1, seatsPerTeam: SEATS };
  function newRoom(name) {
    return { teamCount: 1, seatsPerTeam: SEATS, backfillAiPlayers: true, metadata: { game: "wild-eights", name: name || null } };
  }
  function errKind(e) { return (e && (e.kind || e.code || e.name)) || ""; }
  function conflict(e) {
    var k = errKind(e);
    return k === "conflict" || k === "active-room-elsewhere" || (e && e.status === 409);
  }
  // One active room per player: when creating or joining conflicts, rejoin the room the player holds.
  function recover(platform, e) {
    if (!conflict(e)) return Promise.reject(e);
    return platform.myRoom().catch(function () { return null; }).then(function (room) {
      if (room && room.status !== "closed") return room;
      throw e;
    });
  }
  /** Host a table: a new room, opened for quick join. */
  function hostTable(platform, name) {
    return platform.createRoom(newRoom(name)).then(function (room) {
      return platform.openRoom(room.id).catch(function () { return room; });
    }, function (e) { return recover(platform, e); });
  }
  /** Quick join: an open table, else a new one (app.js roomJoinTable without a code). */
  function quickJoin(platform, name) {
    return platform.quickJoin(SHAPE).then(function (room) {
      return room || hostTable(platform, name);
    }, function (e) { return recover(platform, e); });
  }
  /** Join by the table's code; null when no table has it. */
  function joinCode(platform, code) {
    return platform.joinByCode(code).catch(function (e) {
      if (e && (errKind(e) === "not-found" || e.status === 404)) return null;
      return recover(platform, e);
    });
  }
  function isHost(room, userId) { return !!room && !!userId && room.hostUserId === userId; }

  /** The lobby: the room's roster until it plays. hooks: onChange(), onPlaying(room), onClosed(reason). */
  function LobbyClient(platform, room, hooks) {
    this.platform = platform;
    this.hooks = hooks || {};
    this.room = room;
    this.connected = false;
    this.unavailable = false;
    this.starting = false;
    this._socket = null;
    this._handedOff = false;
  }
  LobbyClient.prototype = {
    get host() { return isHost(this.room, this.platform.userId); },
    get participants() { return (this.room && this.room.participants) || []; },
    get code() { return (this.room && this.room.joinCode) || null; },
    _emit: function (name, a) { var fn = this.hooks[name]; if (fn) fn(a); },
    connect: function () {
      var self = this;
      if (this._socket) return;
      this._socket = this.platform.connectRoom(this.room.id, {
        onOpen: function () { self.connected = true; self._emit("onChange"); },
        onDown: function () { self.connected = false; self._emit("onChange"); },
        onRoster: function (room) { self._onRoster(room); },
        onStopped: function (reason) {
          self.connected = false;
          if (reason !== "closed") { self.unavailable = true; self._emit("onClosed", reason); }
          self._emit("onChange");
        }
      });
      this.refresh();
    },
    refresh: function () {
      var self = this;
      return Promise.resolve(this.platform.getRoom(this.room.id)).then(function (room) {
        if (room) self._onRoster(room);
        else { self.unavailable = true; self._emit("onClosed", "gone"); }
      }, function () { /* the socket's roster keeps it current */ });
    },
    _onRoster: function (room) {
      var merged = {}, k;
      for (k in this.room) merged[k] = this.room[k];
      for (k in room) if (room[k] != null || merged[k] == null) merged[k] = room[k];
      this.room = merged;
      if (merged.status === "playing" && merged.gameSessionId && !this._handedOff) {
        this._handedOff = true;
        this._emit("onPlaying", merged);
      } else if (merged.status === "closed") {
        this.unavailable = true;
        this._emit("onClosed", "closed");
      }
      this._emit("onChange");
    },
    /** Host: Start round (empty seats become AI; idempotent). */
    start: function () {
      var self = this;
      if (!this.host || this.starting) return Promise.resolve(false);
      this.starting = true;
      return this.platform.startRoom(this.room.id).then(function (r) {
        self.starting = false;
        if (r) self._onRoster(r);
        return true;
      }, function () { self.starting = false; self._emit("onChange"); return false; });
    },
    leave: function () {
      this.close();
      return this.platform.leaveRoom(this.room.id).catch(function () { /* already gone */ });
    },
    close: function () {
      if (this._socket) { try { this._socket.close(); } catch (e) { /* gone */ } }
      this._socket = null;
    }
  };

  /** The round: the bound session's game socket and the latest view the script sent. hooks: onSnap(snap), onRejected(reason), onChange(). */
  function TableClient(platform, room, hooks) {
    this.platform = platform;
    this.room = room;
    this.sessionId = room.gameSessionId;
    this.hooks = hooks || {};
    this.snap = null;
    this.connected = false;
    this.unavailable = false;
    this._game = null;
    this._seq = 0;
    this._queue = [];
  }
  TableClient.prototype = {
    _emit: function (name, a) { var fn = this.hooks[name]; if (fn) fn(a); },
    get seat() { return this.snap ? this.snap.seat : -1; },
    connect: function () {
      var self = this;
      if (this._game) return;
      this._game = this.platform.connectGame(this.sessionId, {
        onOpen: function () {
          self.connected = true;
          self._game.send({ type: "sync" }); // every (re)connection resyncs first
          self.flush();
          self._emit("onChange");
        },
        onDown: function () { self.connected = false; self._emit("onChange"); },
        onMessage: function (data) { self._onGame(data); },
        onError: function (message) { self._emit("onRejected", String(message || "rejected")); },
        onStopped: function (reason) {
          self.connected = false;
          if (reason !== "closed") self.unavailable = true;
          self._emit("onChange");
        }
      });
    },
    /** A move ({ type: 'play', cardId } | { type: 'draw' } | { type: 'declareSuit', suit }); resent until the socket takes it. */
    send: function (cmd) {
      this._queue.push({ type: "cmd", id: "m" + (++this._seq), cmd: cmd });
      this.flush();
    },
    flush: function () {
      while (this._queue.length && this._game && this.connected) {
        if (!this._game.send(this._queue[0])) return;
        this._queue.shift();
      }
    },
    _onGame: function (data) {
      if (!data || typeof data !== "object") return;
      if (data.type === "snap") { this.snap = data; this._emit("onSnap", data); }
      else if (data.type === "rejected") this._emit("onRejected", String(data.reason || "rejected"));
      this._emit("onChange");
    },
    /** Leave round: the AI takes the seat (the script decides), then leave the room. */
    leave: function () {
      if (this._game && this.connected && !(this.snap && this.snap.over)) { try { this._game.send({ type: "forfeit" }); } catch (e) { /* gone */ } }
      this.close();
      var id = this.room.id;
      return id ? this.platform.leaveRoom(id).catch(function () { /* gone */ }) : Promise.resolve();
    },
    close: function () {
      if (this._game) { try { this._game.close(); } catch (e) { /* gone */ } }
      this._game = null;
    }
  };

  return { SEATS: SEATS, SHAPE: SHAPE, newRoom: newRoom, hostTable: hostTable, quickJoin: quickJoin, joinCode: joinCode, isHost: isHost, LobbyClient: LobbyClient, TableClient: TableClient };
});
