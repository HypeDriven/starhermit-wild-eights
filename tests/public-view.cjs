const assert = require('node:assert/strict');
const W = require('../game.js');
const state = W.newGame(817, {players: 4});
const before = W.hash(state);
for(let seat=0;seat<4;seat++) {
  const view=W.publicSnapshot(state,seat);
  assert.equal(view.seed,0); assert.equal(view.rngState,0);
  assert.ok(view.stock.every(c=>c===null));
  view.hands.forEach((h,i)=>assert.deepEqual(h,i===seat?state.hands[i].map(c=>c.id):state.hands[i].map(()=>null)));
  const client=W.deserialize(view,seat);
  assert.deepEqual(client.hands[seat],state.hands[seat]);
  assert.equal(client.stock.length,state.stock.length);
}
assert.equal(W.hash(state),before);
console.log('Hosted views hide other hands and stock without mutating authoritative state');
