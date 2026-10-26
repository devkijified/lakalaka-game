'use strict';
// Automated multiplayer test for Lakalaka. Run with the server up on PORT (default 4173).
import WebSocket from 'ws';

const PORT = process.env.PORT || 4173;
const URL = 'ws://127.0.0.1:' + PORT;
let failures = 0;
function assert(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failures++;
}
function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, playerId: null, room: null, waiters: [] };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'joined') c.playerId = msg.playerId;
    if (msg.type === 'state') {
      c.room = msg.room;
      c.waiters = c.waiters.filter((w) => !w(c));
    }
  });
  c.send = (obj) => ws.send(JSON.stringify(obj));
  c.waitFor = (pred, label) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout waiting: ' + label)), 5000);
    const w = (cc) => { if (pred(cc)) { clearTimeout(t); resolve(cc); return true; } return false; };
    if (c.room && pred(c)) { clearTimeout(t); resolve(c); return; }
    c.waiters.push(w);
  });
  c.open = new Promise((res) => ws.on('open', res));
  return c;
}

const A = client('Adaeze');
const B = client('Bola');
await Promise.all([A.open, B.open]);

A.send({ type: 'create_room', name: 'Adaeze' });
await A.waitFor((c) => c.room && c.room.code, 'A creates room');
const code = A.room.code;
assert('room code is 4 letters', /^[A-Z]{4}$/.test(code));

B.send({ type: 'join_room', code, name: 'Bola' });
await B.waitFor((c) => c.room && c.room.players.length === 2, 'B joins');
await A.waitFor((c) => c.room.players.length === 2, 'A sees 2 players');
assert('both players in room', A.room.players.length === 2 && B.room.players.length === 2);

A.send({ type: 'start_game' });
await A.waitFor((c) => c.room.status === 'playing', 'game starts');
assert('game playing, A throws first', A.room.status === 'playing' && A.room.turnPlayerId === A.playerId);

// A throws clean at power 50, stage 1, seed in box 1.
A.send({ type: 'throw_seed', power: 50 });
await A.waitFor((c) => c.room.phase === 'hop' && c.room.seedBox === 1, 'A clean throw');
assert('clean throw puts seed in box 1 and starts hop phase', A.room.phase === 'hop' && A.room.seedBox === 1);
console.log('Sequence served by server:', JSON.stringify(A.room.sequence));

// Correct full sequence for stage 1 from the locked design.
const seq = [2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
assert('server sequence matches expected sequence', JSON.stringify(A.room.sequence) === JSON.stringify(seq));
for (const box of seq) {
  A.send({ type: 'hop', box });
  await new Promise((r) => setTimeout(r, 30));
}
await A.waitFor((c) => c.room.turnPlayerId === B.playerId, 'turn passes to B');
const aAfter = A.room.players.find((p) => p.id === A.playerId);
assert('A stage advanced to 2 after clean run', aAfter.stage === 2);
assert('turn passed to B', A.room.turnPlayerId === B.playerId);

// Foul case: B throws at power 10, a miss. Turn passes back to A with a foul message.
await B.waitFor((c) => c.room.turnPlayerId === B.playerId, 'B turn confirmed');
B.send({ type: 'throw_seed', power: 10 });
await B.waitFor((c) => c.room.turnPlayerId === A.playerId, 'foul passes turn to A');
assert('B foul at power 10 passes turn back to A', B.room.turnPlayerId === A.playerId);
assert('foul message explains the miss', /Foul:/.test(B.room.message) && /missed/.test(B.room.message));
console.log('Foul message seen by room:', B.room.message);

assert('code created room stays private', A.room.isPublic === false);

// Quick play: find or create a public room. Two strangers land together.
const C = client('Chidi');
const D = client('Dara');
const E = client('Efe');
const F = client('Funmi');
await Promise.all([C.open, D.open, E.open, F.open]);

C.send({ type: 'quick_join', name: 'Chidi' });
await C.waitFor((c) => c.room && c.room.code, 'C quick joins');
const qCode = C.room.code;
assert('quick join opens a public room', C.room.isPublic === true && C.room.players.length === 1);

D.send({ type: 'quick_join', name: 'Dara' });
await D.waitFor((c) => c.room && c.room.players.length === 2, 'D quick joins');
await C.waitFor((c) => c.room.players.length === 2, 'C sees D');
assert('second quick joiner lands in the same public room', D.room.code === qCode && C.room.players.length === 2);

// Once that public game has started, a new quick joiner gets a fresh room.
C.send({ type: 'start_game' });
await C.waitFor((c) => c.room.status === 'playing', 'public game starts');
E.send({ type: 'quick_join', name: 'Efe' });
await E.waitFor((c) => c.room && c.room.code, 'E quick joins');
assert('quick joiner after start gets a fresh public room', E.room.code !== qCode && E.room.isPublic === true && E.room.players.length === 1);

// Code join still works, including into a quick play room.
F.send({ type: 'join_room', code: E.room.code, name: 'Funmi' });
await F.waitFor((c) => c.room && c.room.players.length === 2, 'F joins by code');
assert('code join still works into a quick room', F.room.code === E.room.code && F.room.players.length === 2);

A.ws.close(); B.ws.close(); C.ws.close(); D.ws.close(); E.ws.close(); F.ws.close();
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
