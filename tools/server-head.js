// =============================================================================
// Wild Eights — the game's one authoritative server script (starhermit.txt
// `server=server.js`). The platform runs it in its sandboxed Jint host: a fresh
// engine per invocation, one classic script, no imports, no Date/Math.random,
// every bit of state in the documents it returns. The rules are the client's
// own js/game.js, written into the RULES block below by tools/build-server.mjs
// (`npm run server`): edit tools/server-head.js and tools/server-body.js, not
// server.js.
//
// It runs two kinds of session:
//
// 1. Hosted tables (room-bound sessions). A hosted table is a realtime room of
//    one team of four seats; when its host starts it the platform fills the
//    empty seats with AI participants and creates a session bound to it. This
//    script owns the whole round, as the browser build's room host (the first
//    seat's browser) did, but no client is trusted: the deal comes from
//    ctx.random and is never sent; every seat sees only its own hand (each
//    human gets its own view, other hands and the stock as counts, other
//    seats' drawn cards hidden); every command goes through the rules'
//    validated applyCommand for the sender's own seat (`ctx.message.from`,
//    never a seat named in the payload); AI seats play the rules' own AI
//    (Regular, as the old host's tables did) at once; a player who left the
//    room hands the seat to the AI for the rest of the round, and one offline
//    for 30 s has the AI play their turns until they are back (their seat is
//    kept); the end of the round is the session's `result` (stored on the
//    room by the platform). Nothing a client says about the outcome is read.
//
//    Client → script (commands):
//      { type: 'sync' }                                the sender's view
//      { type: 'cmd', id, cmd: { type: 'play', cardId } | { type: 'draw' } | { type: 'declareSuit', suit } }
//      { type: 'forfeit' }                             Leave round: the AI takes the seat
//    Script → clients (`broadcast`, one per human seat):
//      { type: 'snap', seat, names: [..], ai: [..], away: [..], view, events, over }
//        view: the rules' publicSnapshot for that seat (seed and rng zeroed)
//        events: what the change did (draws by other seats without card ids)
//        over: null, or { winner, reason, score } once the round ended
//      { type: 'rejected', reason }                    to the sender of a refused command
//
// 2. Score posting (any other session — the practice session the client opens
//    with sessions.practice()): a finished solo round's score arrives as
//    { type: 'result', scores: { 'high-score': n } }; it is range-checked
//    against BOARDS, returned in `scores` and the session ends — what the
//    browser build's score-script.js did.
'use strict';
