'use strict';
// Records test for Lakalaka. Stands up a tiny stub that speaks the
// Supabase (PostgREST) shape, starts the game server pointed at it, plays
// a full scripted game to 'ended' over WebSocket, then asserts:
//   - exactly one match insert reached the store, with the right
//     winner, room, player houses and won flags
//   - GET /api/records aggregates the stored rows into the right
//     Top players order
//   - a server with no store configured answers enabled: false
// Run standalone: node test-records.mjs (it starts its own servers).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
function assert(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Stub store ---------------------------------------------------------------
const inserts = [];
const rows = [
  { played_at: '2026-10-20T10:00:00.000Z', room_code: 'SEED', winner_name: 'Bola', player_count: 2, players: [{ name: 'Bola', houses: 4, won: true }, { name: 'Adaeze', houses: 2, won: false }] },
  { played_at: '2026-10-21T10:00:00.000Z', room_code: 'SEED', winner_name: 'Chidi', player_count: 2, players: [{ name: 'Chidi', houses: 5, won: true }, { name: 'Bola', houses: 1, won: false }] },
  { played_at: '2026-10-22T10:00:00.000Z', room_code: 'SEED', winner_name: 'Bola', player_count: 2, players: [{ name: 'Bola', houses: 3, won: true }, { name: 'Dara', houses: 3, won: false }] }
];
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/rest/v1/matches' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const row = JSON.parse(body);
      inserts.push({ row, auth: req.headers.authorization, apikey: req.headers.apikey });
      rows.push({ played_at: new Date().toISOString(), room_code: row.room_code, winner_name: row.winner_name, player_count: row.player_count, players: row.players });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end('');
    });
    return;
  }
  if (u.pathname === '/rest/v1/matches' && req.method === 'GET') {
    const limit = Number(u.searchParams.get('limit') || 200);
    const sorted = [...rows].sort((a, b) => new Date(b.played_at) - new Date(a.played_at)).slice(0, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sorted));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{}');
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubPort = stub.address().port;

function startServer(port, extraEnv) {
  const env = { ...process.env, PORT: String(port) };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  Object.assign(env, extraEnv || {});
  return spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function waitUp(port, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/'); if (r.ok) return; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Server did not come up: ' + label);
}

const GAME_PORT = 4291;
const game = startServer(GAME_PORT, {
  SUPABASE_URL: 'http://127.0.0.1:' + stubPort,
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
});
await waitUp(GAME_PORT, 'game server with records');

// --- WS driver (same shape as test-multiplayer.mjs) ---------------------------
function client(name) {
  const ws = new WebSocket('ws://127.0.0.1:' + GAME_PORT);
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
    const t = setTimeout(() => reject(new Error('Timeout waiting: ' + label)), 10000);
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
B.send({ type: 'join_room', code, name: 'Bola' });
await B.waitFor((c) => c.room && c.room.players.length === 2, 'B joins');
A.send({ type: 'start_game' });
await A.waitFor((c) => c.room.status === 'playing', 'game starts');

async function doCleanRun(p) {
  await p.waitFor((c) => c.room.status === 'playing' && c.room.turnPlayerId === p.playerId && c.room.phase === 'throw', 'clean run turn');
  p.send({ type: 'throw_seed', power: 50 });
  await p.waitFor((c) => c.room.phase === 'hop', 'hop phase');
  const seq = [...p.room.sequence];
  for (const box of seq) { p.send({ type: 'hop', box }); await sleep(4); }
  await p.waitFor((c) => c.room.phase === 'house' || c.room.turnPlayerId !== p.playerId || c.room.status === 'ended', 'run resolves');
}
async function doFoul(p) {
  await p.waitFor((c) => c.room.turnPlayerId === p.playerId && c.room.phase === 'throw', 'foul turn');
  p.send({ type: 'throw_seed', power: 10 });
  await p.waitFor((c) => c.room.turnPlayerId !== p.playerId, 'foul passes turn');
}
async function doClaim(p, position) {
  await p.waitFor((c) => c.room.phase === 'house', 'house phase');
  p.send({ type: 'house_claim', position });
  await p.waitFor((c) => c.room.status === 'ended' || c.room.turnPlayerId !== p.playerId, 'claim resolves');
}

// Adaeze climbs to stage 6 and claims one house per cycle, boxes 1 to 6.
// Bola fouls whenever the turn reaches her, handing it straight back.
for (let claim = 1; claim <= 6; claim++) {
  for (let run = 1; run <= 6; run++) {
    await doCleanRun(A);
    if (run < 6) await doFoul(B);
    else await doClaim(A, claim);
  }
  if (A.room.status === 'ended') break;
  await doFoul(B);
}
assert('scripted game reached the end', A.room.status === 'ended' && A.room.winner && A.room.winner.name === 'Adaeze');

// The insert is fire and forget: give it a moment to land, then count it.
const deadline = Date.now() + 5000;
while (inserts.length < 1 && Date.now() < deadline) await sleep(100);
assert('exactly one match insert reached the store', inserts.length === 1);
const saved = inserts[0] && inserts[0].row;
assert('insert carried the service role key', inserts.length === 1 && inserts[0].auth === 'Bearer test-service-key' && inserts[0].apikey === 'test-service-key');
assert('insert has the room code and player count', !!saved && saved.room_code === code && saved.player_count === 2);
assert('insert names the winner', !!saved && saved.winner_name === 'Adaeze');
const savedAda = saved && saved.players.find((p) => p.name === 'Adaeze');
const savedBola = saved && saved.players.find((p) => p.name === 'Bola');
assert('insert player houses and won flags are right',
  !!savedAda && savedAda.houses === 6 && savedAda.won === true &&
  !!savedBola && savedBola.houses === 0 && savedBola.won === false);

// Play again churn must not record the same game a second time.
A.send({ type: 'play_again' });
await A.waitFor((c) => c.room.status === 'lobby', 'back to lobby');
await sleep(400);
assert('play again does not record the game twice', inserts.length === 1);

// Read path: aggregated from the stored rows (3 seeded + 1 just played).
const apiRes = await fetch('http://127.0.0.1:' + GAME_PORT + '/api/records');
const data = await apiRes.json();
assert('records endpoint answers enabled with data', apiRes.ok && data.enabled === true);
assert('past games lists the newest game first', Array.isArray(data.matches) && data.matches.length === 4 && data.matches[0].winner_name === 'Adaeze' && data.matches[0].room_code === code);
const names = (data.players || []).map((p) => p.name);
assert('top players order is wins, then houses', JSON.stringify(names) === JSON.stringify(['Bola', 'Adaeze', 'Chidi', 'Dara']));
const top = Object.fromEntries((data.players || []).map((p) => [p.name, p]));
assert('aggregates add up across seeded and played games',
  !!top.Bola && top.Bola.games === 4 && top.Bola.wins === 2 && top.Bola.houses === 8 &&
  !!top.Adaeze && top.Adaeze.games === 2 && top.Adaeze.wins === 1 && top.Adaeze.houses === 8 &&
  !!top.Chidi && top.Chidi.games === 1 && top.Chidi.wins === 1 && top.Chidi.houses === 5 &&
  !!top.Dara && top.Dara.games === 1 && top.Dara.wins === 0 && top.Dara.houses === 3);

A.ws.close(); B.ws.close();
game.kill();

// --- Unconfigured server: records quietly off ----------------------------------
const PLAIN_PORT = 4292;
const plain = startServer(PLAIN_PORT, {});
await waitUp(PLAIN_PORT, 'game server without records');
const offRes = await fetch('http://127.0.0.1:' + PLAIN_PORT + '/api/records');
const off = await offRes.json();
assert('unconfigured server answers records disabled', offRes.ok && off.enabled === false && Array.isArray(off.matches) && off.matches.length === 0 && Array.isArray(off.players) && off.players.length === 0);
plain.kill();

stub.close();
console.log(failures === 0 ? 'ALL RECORDS TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
