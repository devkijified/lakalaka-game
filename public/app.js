'use strict';
// Lakalaka client. Sends intents only, the server decides every outcome.
// The 3D simulation in sim.js renders the court and acts out every move.
const $ = (id) => document.getElementById(id);
let ws = null;
let myId = null;
let room = null;
let lastMessageSeq = -1;

function simDo(method, ...args) {
  if (window.Sim3D && window.Sim3D[method]) window.Sim3D[method](...args);
}

// Tiny WebAudio sounds, no external files.
let audioCtx = null;
function beep(freq, ms) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + ms / 1000);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + ms / 1000);
  } catch (e) { /* sound is optional */ }
}
const tickSound = () => beep(660, 70);
const successSound = () => { beep(523, 110); setTimeout(() => beep(784, 140), 100); };

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// Test hook: the current room state as the server last broadcast it.
window.__lakalakaState = () => room;

// Box taps from the 3D court (raycast in sim.js) land here.
window.LakalakaTap = (box) => {
  if (!room || room.status !== 'playing' || room.paused) return;
  if (room.turnPlayerId !== myId || room.phase !== 'hop') return;
  tickSound();
  send({ type: 'hop', box });
};

function connect(afterOpen) {
  if (ws && ws.readyState <= 1) { if (afterOpen) afterOpen(); return; }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host);
  ws.onopen = () => { if (afterOpen) afterOpen(); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'joined') { myId = msg.playerId; }
    if (msg.type === 'error') { $('lobbyError').textContent = msg.message; }
    if (msg.type === 'state') {
      const prevRoom = room;
      room = msg.room;
      if (room.messageSeq !== lastMessageSeq) {
        if (room.message && /clean run|claimed box/.test(room.message)) successSound();
        lastMessageSeq = room.messageSeq;
      }
      driveSim(prevRoom, room);
      render();
      simDo('setRoom', room, myId);
    }
  };
  ws.onclose = () => { ws = null; };
}

// Translate room state transitions into simulation moves, so the player page
// and every spectator page act out the same throw, hop, pickup, foul or claim.
function driveSim(prev, next) {
  if (!prev || prev.status !== 'playing' || !next || next.status === 'lobby') return;
  const foulMsg = next.message && next.message.indexOf('Foul:') === 0;
  const me = (r) => r.players.find((p) => p.id === r.turnPlayerId);
  if (prev.phase === 'throw' && next.phase === 'hop') {
    simDo('playThrow', next.seedBox, next.lastThrow && next.lastThrow.power);
  } else if (prev.phase === 'throw' && next.phase === 'throw' && foulMsg && next.turnPlayerId !== prev.turnPlayerId) {
    simDo('playThrowFoul', prev.targetBox || (me(prev) ? me(prev).stage : 1), next.lastThrow && next.lastThrow.power);
  } else if (prev.phase === 'hop' && next.phase === 'hop' && next.seqIndex > prev.seqIndex) {
    const box = prev.sequence[prev.seqIndex];
    const ownerId = next.houses ? next.houses[box] : null;
    const isRest = box === 7 || ownerId === prev.turnPlayerId;
    tickSound();
    simDo('playHop', box, isRest);
  } else if (prev.phase === 'hop' && next.phase === 'house') {
    simDo('playPickup', prev.seedBox);
  } else if (prev.phase === 'hop' && next.phase === 'throw' && prev.seqIndex >= prev.sequence.length - 1) {
    if (foulMsg) simDo('playFoul');
    else simDo('playPickup', prev.seedBox);
  } else if (prev.phase === 'hop' && foulMsg) {
    simDo('playFoul');
  } else if (prev.phase === 'house' && next.phase !== 'house') {
    let claimed = null;
    for (const b of Object.keys(next.houses || {})) {
      if (!prev.houses || !prev.houses[b]) claimed = Number(b);
    }
    simDo('playClaim', claimed);
  }
}

$('createBtn').addEventListener('click', () => {
  $('lobbyError').textContent = '';
  connect(() => send({ type: 'create_room', name: $('nameInput').value }));
});
$('joinBtn').addEventListener('click', () => {
  $('lobbyError').textContent = '';
  connect(() => send({ type: 'join_room', code: $('codeInput').value, name: $('nameInput').value }));
});
$('startBtn').addEventListener('click', () => send({ type: 'start_game' }));
$('leaveBtn').addEventListener('click', () => { send({ type: 'leave' }); location.reload(); });
$('playAgainBtn').addEventListener('click', () => send({ type: 'play_again' }));

// Power meter: oscillates 0 to 100 and back. One full sweep takes about
// 2.5 seconds, so the green middle stays under the needle for about
// 0.4 seconds: a skill shot a player can actually time on a phone.
let power = 0; let powerDir = 1; let meterTimer = null;
function startMeter() {
  stopMeter(); power = 0; powerDir = 1;
  meterTimer = setInterval(() => {
    power += powerDir * 0.8;
    if (power >= 100) { power = 100; powerDir = -1; }
    if (power <= 0) { power = 0; powerDir = 1; }
    $('meterNeedle').style.left = power + '%';
  }, 20);
}
function stopMeter() { if (meterTimer) { clearInterval(meterTimer); meterTimer = null; } }
$('throwBtn').addEventListener('click', () => {
  const p = power; stopMeter();
  send({ type: 'throw_seed', power: p });
});

// House marker: sweeps 1 to 6 quickly until Claim is tapped.
let markerBox = 1; let markerTimer = null;
function startMarker() {
  stopMarker(); markerBox = 1;
  markerTimer = setInterval(() => {
    markerBox = markerBox >= 6 ? 1 : markerBox + 1;
    $('houseMarkerBox').textContent = markerBox;
  }, 220);
}
function stopMarker() { if (markerTimer) { clearInterval(markerTimer); markerTimer = null; } }
$('claimBtn').addEventListener('click', () => {
  const pos = markerBox; stopMarker();
  send({ type: 'house_claim', position: pos });
});

function render() {
  if (!room) return;
  $('roomBadge').classList.remove('hidden');
  $('roomCodeBadge').textContent = room.code;

  document.body.classList.toggle('in-game', room.status !== 'lobby');
  $('lobbyView').classList.toggle('hidden', room.status !== 'lobby');
  $('gameView').classList.toggle('hidden', room.status === 'lobby');
  $('winnerView').classList.toggle('hidden', room.status !== 'ended');

  // Lobby panel
  $('roomPanel').classList.remove('hidden');
  $('roomCodeBig').textContent = room.code;
  $('playerList').innerHTML = room.players.map((p) =>
    '<li class="' + (p.connected ? '' : 'offline') + '"><span class="dot" style="background:' + p.color + '"></span>' +
    escapeHtml(p.name) + (p.isHost ? ' <span class="tag">HOST</span>' : '') +
    (p.id === myId ? ' <span class="tag">YOU</span>' : '') +
    (p.connected ? '' : ' (away)') + '</li>').join('');
  const isHost = room.hostId === myId;
  $('startBtn').classList.toggle('hidden', !isHost);
  $('startBtn').disabled = room.players.filter((p) => p.connected).length < 2;
  $('startHint').textContent = room.players.filter((p) => p.connected).length < 2
    ? 'Waiting for at least one more player to join.'
    : (isHost ? 'Everyone is in. Start when ready.' : 'Waiting for the host to start.');

  if (room.status === 'lobby') { stopMeter(); stopMarker(); return; }

  // Game views
  const turnPlayer = room.players.find((p) => p.id === room.turnPlayerId);
  const myTurn = room.turnPlayerId === myId && !room.paused;
  $('turnBanner').textContent = room.paused
    ? 'Paused: waiting for another player'
    : (myTurn ? 'Your turn' : (turnPlayer ? turnPlayer.name + ' is playing' : ''));
  $('turnBanner').style.borderLeftColor = turnPlayer ? turnPlayer.color : '#ffc857';
  $('messageBox').textContent = room.message || '';

  $('scoreList').innerHTML = room.players.map((p) =>
    '<li class="' + (p.connected ? '' : 'offline') + '"><span class="dot" style="background:' + p.color + '"></span>' +
    escapeHtml(p.name) + ': stage box ' + p.stage + ', ' + p.housesOwned + (p.housesOwned === 1 ? ' house' : ' houses') + '</li>').join('');

  // Controls per phase. The pinned action area always names the next step.
  const showThrow = room.status === 'playing' && myTurn && room.phase === 'throw';
  const showHop = room.status === 'playing' && myTurn && room.phase === 'hop';
  const showHouse = room.status === 'playing' && myTurn && room.phase === 'house';
  $('throwControls').classList.toggle('hidden', !showThrow);
  $('hopHint').classList.toggle('hidden', !showHop && !(room.status === 'playing' && room.phase === 'hop'));
  $('houseControls').classList.toggle('hidden', !showHouse);
  $('spectateHint').classList.toggle('hidden', myTurn || room.status !== 'playing');
  if (room.status === 'playing' && room.phase === 'hop') {
    const next = room.sequence[room.seqIndex];
    $('hopHintText').textContent = next === room.seedBox && room.seqIndex === room.sequence.length - 1
      ? 'Last step: tap box ' + next + ' in the court to pick up your seed.'
      : 'Tap box ' + next + ' next in the court.';
  }
  if (showThrow && !meterTimer) startMeter();
  if (!showThrow) stopMeter();
  if (showHouse && !markerTimer) startMarker();
  if (!showHouse) stopMarker();

  if (room.status === 'ended' && room.winner) {
    $('winnerTitle').textContent = room.winner.playerId === myId ? 'You win' : room.winner.name + ' wins';
    $('winnerText').textContent = room.message || '';
    $('finalScores').innerHTML = room.players.map((p) =>
      '<li><span class="dot" style="background:' + p.color + '"></span>' + escapeHtml(p.name) + ': ' + p.housesOwned + (p.housesOwned === 1 ? ' house' : ' houses') + '</li>').join('');
    $('gameView').classList.remove('hidden');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
