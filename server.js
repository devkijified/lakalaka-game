'use strict';
// Lakalaka server. Server authoritative: clients send intents only, this file holds all room state and validates every action.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, 'public');
const COLORS = ['#ff6b4a', '#ffc857', '#39c2a5', '#5aa9e6'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
const ADDONS_DIR = path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm');

const rooms = new Map();
let nextPlayerId = 1;
let claimCounter = 0;

function makeCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  } while (rooms.has(code));
  return code;
}

function buildSequence(seedBox, playerId, houses) {
  // Blocked boxes: owned by an opponent. They leave the hop path entirely.
  const blocked = new Set();
  for (const [boxStr, ownerId] of Object.entries(houses)) {
    if (ownerId !== playerId) blocked.add(Number(boxStr));
  }
  const seq = [];
  for (let b = 1; b <= 7; b++) {
    if (b === seedBox) continue;
    if (blocked.has(b)) continue;
    seq.push(b);
  }
  for (let b = 6; b >= 1; b--) {
    if (b === seedBox) continue;
    if (blocked.has(b)) continue;
    seq.push(b);
  }
  // Final action: tap the seed box itself to pick it up while on one leg.
  seq.push(seedBox);
  return seq;
}

function connectedPlayers(room) {
  return room.players.filter((p) => p.connected);
}

function publicRoom(room) {
  return {
    code: room.code,
    isPublic: !!room.public,
    status: room.status, // lobby, playing, ended
    paused: room.paused,
    phase: room.phase, // throw, hop, house
    hostId: room.hostId,
    turnPlayerId: room.turnPlayerId,
    seedBox: room.seedBox,
    targetBox: room.targetBox,
    lastThrow: room.lastThrow || null,
    sequence: room.sequence,
    seqIndex: room.seqIndex,
    houses: room.houses,
    message: room.message,
    messageSeq: room.messageSeq,
    winner: room.winner,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, connected: p.connected,
      stage: p.stage, isHost: p.id === room.hostId,
      housesOwned: Object.values(room.houses).filter((o) => o === p.id).length
    }))
  };
}

function broadcast(room) {
  const payload = JSON.stringify({ type: 'state', room: publicRoom(room) });
  for (const p of room.players) {
    if (p.connected && p.ws && p.ws.readyState === 1) p.ws.send(payload);
  }
}

function setMessage(room, text) {
  room.message = text;
  room.messageSeq += 1;
}

function endTurn(room, reason) {
  if (reason) setMessage(room, reason);
  room.phase = 'throw';
  room.seedBox = null;
  room.targetBox = null;
  room.sequence = [];
  room.seqIndex = 0;
  // Advance to the next connected player.
  if (room.players.length === 0) { room.paused = true; return; }
  const n = room.players.length;
  let idx = room.players.findIndex((p) => p.id === room.turnPlayerId);
  for (let step = 0; step < n; step++) {
    idx = (idx + 1) % n;
    if (room.players[idx].connected) { room.turnPlayerId = room.players[idx].id; break; }
  }
  const conn = connectedPlayers(room);
  room.paused = conn.length < 2;
  if (room.paused) setMessage(room, (reason ? reason + ' ' : '') + 'Waiting for another player to reconnect or join. The game is paused.');
}

function checkWin(room) {
  if (Object.keys(room.houses).length < 6) return false;
  let best = null;
  for (const p of room.players) {
    const count = Object.values(room.houses).filter((o) => o === p.id).length;
    const lastClaim = room.lastClaimOrder[p.id] || Infinity;
    if (!best || count > best.count || (count === best.count && lastClaim < best.lastClaim)) {
      best = { playerId: p.id, name: p.name, color: p.color, count, lastClaim };
    }
  }
  room.winner = best;
  room.status = 'ended';
  room.paused = false;
  setMessage(room, best.name + ' wins with ' + best.count + (best.count === 1 ? ' house.' : ' houses.'));
  return true;
}

function completeRun(room, player) {
  if (player.stage >= 6) {
    room.phase = 'house';
    room.seedBox = null;
    room.sequence = [];
    room.seqIndex = 0;
    setMessage(room, player.name + ' finished the full course. Blind back throw: tap Claim to stop the marker and try to win a house.');
  } else {
    player.stage += 1;
    endTurn(room, player.name + ' finished a clean run. Stage up: ' + player.name + ' is now on box ' + player.stage + '.');
  }
}

const server = http.createServer((req, res) => {
  // Three.js addons (GLTFLoader, SkeletonUtils) served locally, no CDN.
  if (req.url.startsWith('/addons/')) {
    const addonPath = path.normalize(path.join(ADDONS_DIR, req.url.split('?')[0].slice('/addons/'.length)));
    if (!addonPath.startsWith(ADDONS_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(addonPath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(data);
    });
    return;
  }
  // Strip the query string before resolving, so invite links like
  // /?join=ABCD serve the landing page instead of resolving to the
  // public directory itself and 404ing.
  const cleanUrl = req.url.split('?')[0];
  let filePath = cleanUrl === '/' ? '/index.html' : cleanUrl;
  filePath = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let me = null; // player object
  let myRoom = null;

  function send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function fail(text) { send({ type: 'error', message: text }); }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    // Shared room entry paths. create_room makes a private room (code
    // only). quick_join is "find or create": it lands in a public room
    // that is waiting in the lobby, or opens a fresh public room.
    function createRoom(name, isPublic) {
      const code = makeCode();
      const player = { id: nextPlayerId++, name, color: COLORS[0], connected: true, ws, stage: 1 };
      myRoom = { code, public: !!isPublic, players: [player], hostId: player.id, status: 'lobby', paused: false, phase: 'throw', turnPlayerId: player.id, seedBox: null, targetBox: null, lastThrow: null, sequence: [], seqIndex: 0, houses: {}, lastClaimOrder: {}, message: name + ' created the room. Share the code and wait for friends.', messageSeq: 1, winner: null };
      rooms.set(code, myRoom);
      me = player;
      send({ type: 'joined', playerId: me.id, code });
      broadcast(myRoom);
    }

    function joinRoom(room, name) {
      const player = { id: nextPlayerId++, name, color: COLORS[room.players.length % COLORS.length], connected: true, ws, stage: 1 };
      room.players.push(player);
      myRoom = room; me = player;
      setMessage(room, name + ' joined the room.');
      room.paused = connectedPlayers(room).length < 2 && room.status === 'playing';
      send({ type: 'joined', playerId: me.id, code: room.code });
      broadcast(room);
    }

    if (msg.type === 'create_room') {
      const name = String(msg.name || '').trim().slice(0, 20);
      if (!name) return fail('Type your display name first.');
      createRoom(name, false);
      return;
    }

    if (msg.type === 'quick_join') {
      const name = String(msg.name || '').trim().slice(0, 20);
      if (!name) return fail('Type your display name first.');
      let target = null;
      for (const r of rooms.values()) {
        if (!r.public || r.status !== 'lobby') continue;
        const conn = connectedPlayers(r).length;
        if (conn >= 1 && conn < 4) { target = r; break; }
      }
      if (target) joinRoom(target, name);
      else createRoom(name, true);
      return;
    }

    if (msg.type === 'join_room') {
      const code = String(msg.code || '').trim().toUpperCase();
      const name = String(msg.name || '').trim().slice(0, 20);
      if (!name) return fail('Type your display name first.');
      const room = rooms.get(code);
      if (!room) return fail('No room with that code. Check the code and try again.');
      if (room.status !== 'lobby') return fail('That game has already started.');
      if (room.players.filter((p) => p.connected).length >= 4) return fail('That room is full. Rooms hold 4 players.');
      joinRoom(room, name);
      return;
    }

    // All remaining intents need a room and a player.
    if (!myRoom || !me) return fail('Join a room first.');
    const room = myRoom;

    if (msg.type === 'start_game') {
      if (me.id !== room.hostId) return fail('Only the host can start the game.');
      if (room.status !== 'lobby') return fail('The game is already running.');
      if (connectedPlayers(room).length < 2) return fail('You need at least 2 players to start.');
      room.status = 'playing';
      room.phase = 'throw';
      room.houses = {}; room.lastClaimOrder = {};
      room.winner = null;
      for (const p of room.players) p.stage = 1;
      const first = connectedPlayers(room)[0];
      room.turnPlayerId = first.id;
      room.paused = false;
      setMessage(room, 'Game started. ' + first.name + ' throws first, aiming for box 1.');
      broadcast(room);
      return;
    }

    if (msg.type === 'throw_seed') {
      if (room.status !== 'playing' || room.paused) return fail('The game is not in play right now.');
      if (me.id !== room.turnPlayerId) return fail('It is not your turn.');
      if (room.phase !== 'throw') return fail('You already threw. Hop the course now.');
      const power = Number(msg.power);
      if (!Number.isFinite(power) || power < 0 || power > 100) return fail('That throw did not count. Try again.');
      const target = me.stage;
      if (power >= 42 && power <= 58) {
        room.lastThrow = { power, target, result: 'clean' };
        room.seedBox = target;
        room.targetBox = target;
        room.sequence = buildSequence(target, me.id, room.houses);
        room.seqIndex = 0;
        room.phase = 'hop';
        setMessage(room, me.name + ' landed the seed clean in box ' + target + '. Hop the course, skip the seed box, rest in box 7, come back, then tap box ' + target + ' to pick the seed up.');
      } else if ((power >= 35 && power <= 41) || (power >= 59 && power <= 65)) {
        room.lastThrow = { power, target, result: 'line' };
        endTurn(room, 'Foul: ' + me.name + ' threw and the seed landed on the line. Turn over.');
      } else {
        room.lastThrow = { power, target, result: 'miss' };
        endTurn(room, 'Foul: ' + me.name + ' threw and the seed missed box ' + target + '. Turn over.');
      }
      broadcast(room);
      return;
    }

    if (msg.type === 'hop') {
      if (room.status !== 'playing' || room.paused) return fail('The game is not in play right now.');
      if (me.id !== room.turnPlayerId) return fail('It is not your turn.');
      if (room.phase !== 'hop') return fail('Throw the seed first.');
      const box = Number(msg.box);
      if (!Number.isInteger(box) || box < 1 || box > 7) return fail('That box does not exist.');
      // Opponent house is blocked: tapping it at all is a foul, even before order checks.
      const owner = room.houses[box];
      // Pickup tap on the seed box is the last sequence step and is allowed even if that box is a house.
      const isPickupStep = room.seqIndex === room.sequence.length - 1 && box === room.seedBox;
      if (owner && owner !== me.id && !isPickupStep) {
        endTurn(room, 'Foul: ' + me.name + ' stepped into a house owned by an opponent. Turn over.');
        broadcast(room);
        return;
      }
      const expected = room.sequence[room.seqIndex];
      if (box !== expected) {
        endTurn(room, 'Foul: ' + me.name + ' hopped out of order. The next box was ' + expected + '. Turn over.');
        broadcast(room);
        return;
      }
      room.seqIndex += 1;
      if (room.seqIndex >= room.sequence.length) {
        completeRun(room, me);
      } else {
        setMessage(room, me.name + ' is hopping. Next box: ' + room.sequence[room.seqIndex] + '.');
      }
      broadcast(room);
      return;
    }

    if (msg.type === 'house_claim') {
      if (room.status !== 'playing' || room.paused) return fail('The game is not in play right now.');
      if (me.id !== room.turnPlayerId) return fail('It is not your turn.');
      if (room.phase !== 'house') return fail('Finish the full course first to claim a house.');
      const position = Number(msg.position !== undefined ? msg.position : msg.box);
      if (!Number.isInteger(position) || position < 1 || position > 6) return fail('House claims only count on boxes 1 to 6.');
      let note;
      if (room.houses[position]) {
        note = me.name + ' threw for box ' + position + ' but it is already a house. No claim.';
      } else {
        room.houses[position] = me.id;
        claimCounter += 1;
        room.lastClaimOrder[me.id] = claimCounter;
        note = me.name + ' claimed box ' + position + ' as a house.';
      }
      me.stage = 1;
      if (checkWin(room)) {
        broadcast(room);
        return;
      }
      endTurn(room, note + ' ' + me.name + ' goes back to box 1.');
      broadcast(room);
      return;
    }

    if (msg.type === 'play_again') {
      if (room.status !== 'ended') return fail('The game has not ended yet.');
      room.status = 'lobby';
      room.phase = 'throw';
      room.houses = {}; room.lastClaimOrder = {}; room.winner = null;
      room.seedBox = null; room.targetBox = null; room.sequence = []; room.seqIndex = 0;
      for (const p of room.players) p.stage = 1;
      const first = connectedPlayers(room)[0];
      if (first) room.turnPlayerId = first.id;
      setMessage(room, 'Back to the lobby. The host can start a new game with the same players.');
      broadcast(room);
      return;
    }

    if (msg.type === 'leave') {
      ws.close();
      return;
    }
  });

  ws.on('close', () => {
    if (!myRoom || !me) return;
    const room = myRoom;
    me.connected = false;
    me.ws = null;
    const wasTurn = room.turnPlayerId === me.id;
    setMessage(room, me.name + ' disconnected.');
    if (room.status === 'playing') {
      if (connectedPlayers(room).length < 2) {
        room.paused = true;
        setMessage(room, me.name + ' disconnected. Waiting for another player. The game is paused.');
      } else if (wasTurn) {
        endTurn(room, me.name + ' disconnected, so the turn passes.');
      }
    }
    // Host disconnect does not kill the room while others remain. Host role moves to the next connected player.
    if (room.hostId === me.id) {
      const next = connectedPlayers(room)[0];
      if (next) room.hostId = next.id;
    }
    if (connectedPlayers(room).length === 0) {
      rooms.delete(room.code);
    } else {
      broadcast(room);
    }
  });
});

server.listen(PORT, () => {
  console.log('Lakalaka listening on port ' + PORT);
});
