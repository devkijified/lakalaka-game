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
    if (msg.type === 'error') { $('lobbyError').textContent = msg.message; entrySent = false; }
    if (msg.type === 'state') {
      const prevRoom = room;
      room = msg.room;
      if (inviteInUrl) {
        // Invite accepted: clean the ?join= code out of the address so a
        // refresh does not re-enter the invite flow.
        inviteInUrl = false;
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* cosmetic only */ }
      }
      if (room.messageSeq !== lastMessageSeq) {
        if (room.message && /clean run|claimed box/.test(room.message)) successSound();
        lastMessageSeq = room.messageSeq;
      }
      driveSim(prevRoom, room);
      render();
      simDo('setRoom', room, myId);
      if (prevRoom && prevRoom.status === 'lobby' && room.status === 'playing') showCountdown();
      if (prevRoom && prevRoom.status !== 'lobby' && room.status === 'lobby') loadRecords();
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

// --- Getting in: name memory, invite links, one guarded entry intent -------
// The name is remembered on this phone, so a returning player is one tap
// from playing. Entry intents are guarded: one tap (or the auto join on the
// 4th code letter) sends exactly one entry message, so a stray second tap
// can never join the same person twice.
let entrySent = false;
let inviteInUrl = false;
try {
  const saved = localStorage.getItem('lakalakaName');
  if (saved && !$('nameInput').value) $('nameInput').value = saved;
} catch (e) { /* storage is a nicety, never a blocker */ }

function saveName() {
  try { localStorage.setItem('lakalakaName', $('nameInput').value.trim()); } catch (e) { /* ignore */ }
}

function entryIntent(msg) {
  if (entrySent) return;
  $('lobbyError').textContent = '';
  entrySent = true;
  saveName();
  connect(() => send(msg));
}

$('createBtn').addEventListener('click', () => {
  entryIntent({ type: 'create_room', name: $('nameInput').value });
});
$('quickBtn').addEventListener('click', () => {
  entryIntent({ type: 'quick_join', name: $('nameInput').value });
});
$('joinBtn').addEventListener('click', () => {
  entryIntent({ type: 'join_room', code: $('codeInput').value, name: $('nameInput').value });
});
$('codeInput').addEventListener('input', () => {
  const el = $('codeInput');
  const v = el.value.toUpperCase();
  if (v !== el.value) el.value = v;
  if (v.trim().length === 4) {
    if ($('nameInput').value.trim()) {
      entryIntent({ type: 'join_room', code: v, name: $('nameInput').value });
    } else {
      $('nameInput').focus();
    }
  }
});

// Invite link: /?join=CODE prefills the code and says who invited you.
// One tap on Join room after the name, and you are in the lobby.
(function applyInvite() {
  let code = '';
  try { code = (new URLSearchParams(location.search).get('join') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); } catch (e) { /* no params */ }
  if (code.length !== 4) return;
  inviteInUrl = true;
  $('codeInput').value = code;
  $('inviteBanner').textContent = 'You have been invited to room ' + code;
  $('inviteBanner').classList.remove('hidden');
  $('nameInput').focus();
})();

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

// --- Sharing the room --------------------------------------------------------
function inviteLink() {
  return location.origin + '/?join=' + (room ? room.code : '');
}

// Buttons carry an icon span beside a label span (icons.js). Text swaps go
// to the label only, so the glyph survives state changes like Copied.
function setBtnLabel(btn, text) {
  const label = btn.querySelector('.btn-label');
  if (label) label.textContent = text; else btn.textContent = text;
}

async function copyInvite() {
  const link = inviteLink();
  let ok = false;
  try { await navigator.clipboard.writeText(link); ok = true; } catch (e) { /* fall through */ }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
  }
  $('copyHint').textContent = ok
    ? 'Invite link copied. Send it to your friends and they land straight in this room.'
    : 'Copy this link by hand: ' + link;
  setBtnLabel($('copyInviteBtn'), ok ? 'Copied' : 'Copy invite link');
  setTimeout(() => { setBtnLabel($('copyInviteBtn'), 'Copy invite link'); }, 1800);
}
$('copyInviteBtn').addEventListener('click', copyInvite);
$('shareBtn').addEventListener('click', async () => {
  const link = inviteLink();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Lakalaka', text: 'Join my Lakalaka room, code ' + (room ? room.code : '') + '.', url: link });
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  copyInvite();
});

// QR of the invite link, drawn locally by the vendored qrcode-generator
// (MIT, Kazuhiko Arase). Rebuilt only when the room code changes.
let qrForCode = null;
function renderQr() {
  if (!room || typeof qrcode !== 'function') return;
  if (qrForCode === room.code) return;
  qrForCode = room.code;
  const link = inviteLink();
  let svg = '';
  for (let t = 4; t <= 14 && !svg; t++) {
    try {
      const qr = qrcode(t, 'M');
      qr.addData(link);
      qr.make();
      svg = qr.createSvgTag({ cellSize: 3, margin: 6, scalable: true });
    } catch (e) { svg = ''; }
  }
  $('inviteQr').innerHTML = svg;
}

// --- Player records ------------------------------------------------------------
// Records live server side (GET /api/records) and follow the name each
// player types, no accounts. If records are off, or the fetch fails, the
// section stays hidden and the landing looks exactly as it did before.
let recordsEnabled = false;

function formatCount(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return 'Today, ' + time;
  }
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + time;
}

function renderRecords(data) {
  const section = $('recordsSection');
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const players = Array.isArray(data.players) ? data.players : [];
  if (!data.enabled || (matches.length === 0 && players.length === 0)) {
    section.classList.add('hidden');
    return;
  }
  $('topPlayers').innerHTML = players.map((p) =>
    '<li><span class="rec-name">' + escapeHtml(p.name) + '</span><span class="rec-stat">' +
    formatCount(p.wins) + (Number(p.wins) === 1 ? ' win' : ' wins') + ' in ' +
    formatCount(p.games) + (Number(p.games) === 1 ? ' game' : ' games') + '</span></li>').join('');
  $('pastGames').innerHTML = matches.map((m) => {
    const scores = (Array.isArray(m.players) ? m.players : [])
      .map((p) => escapeHtml(p.name) + ' ' + formatCount(p.houses)).join(', ');
    return '<li><div class="rec-head"><span class="rec-winner">' + escapeHtml(m.winner_name) + ' won</span>' +
      '<span class="rec-date">' + escapeHtml(formatWhen(m.played_at)) + '</span></div>' +
      '<div class="rec-scores">' + scores + '</div></li>';
  }).join('');
  section.classList.remove('hidden');
}

async function loadRecords() {
  try {
    const res = await fetch('/api/records');
    if (!res.ok) throw new Error('records unavailable');
    const data = await res.json();
    recordsEnabled = !!data.enabled;
    renderRecords(data);
  } catch (e) {
    recordsEnabled = false;
    $('recordsSection').classList.add('hidden');
  }
  $('recordNote').classList.toggle('hidden', !recordsEnabled);
}
loadRecords();

// --- Start countdown -----------------------------------------------------------
// The host's start flips the room to playing on every screen at once. The
// countdown is the shared get ready beat over the stage: 3, 2, 1, then the
// court is live. It is visual only and never blocks the court or controls.
let countdownTimer = null;
function showCountdown() {
  const el = $('countdown');
  let n = 3;
  el.textContent = n;
  el.classList.remove('hidden');
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    n -= 1;
    if (n <= 0) {
      clearInterval(countdownTimer); countdownTimer = null;
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = n;
    }
  }, 700);
}

function render() {
  if (!room) return;
  $('roomBadge').classList.remove('hidden');
  $('roomCodeBadge').textContent = room.code;

  document.body.classList.toggle('in-game', room.status !== 'lobby');
  document.body.classList.toggle('in-lobby', room.status === 'lobby');
  $('lobbyView').classList.toggle('hidden', room.status !== 'lobby');
  $('gameView').classList.toggle('hidden', room.status === 'lobby');
  $('winnerView').classList.toggle('hidden', room.status !== 'ended');
  // The stage lives through landing, lobby and game. Only the winner
  // screen puts it away.
  $('court3d').classList.toggle('hidden', room.status === 'ended');

  // render() only runs once you are in a room, so the join card and the
  // intro step aside for good and the room panel owns the lobby.
  $('joinCard').classList.add('hidden');
  $('introText').classList.add('hidden');

  // Lobby panel
  $('roomPanel').classList.remove('hidden');
  $('roomCodeBig').textContent = room.code;
  $('publicNote').classList.toggle('hidden', !room.isPublic);
  renderQr();
  // Slot board: always 4 slots, filled ones carry the player, empty ones
  // read as open so the host can see exactly what the room still needs.
  const totalSlots = Math.max(4, room.players.length);
  let slotsHtml = '';
  for (let i = 0; i < totalSlots; i++) {
    const p = room.players[i];
    if (p) {
      slotsHtml += '<li class="slot filled' + (p.connected ? '' : ' offline') + '"><span class="dot" style="background:' + p.color + '"></span>' +
        escapeHtml(p.name) + (p.isHost ? ' <span class="tag">HOST</span>' : '') +
        (p.id === myId ? ' <span class="tag">YOU</span>' : '') +
        (p.connected ? '' : ' (away)') + '</li>';
    } else {
      slotsHtml += '<li class="slot open">Open slot</li>';
    }
  }
  $('playerList').innerHTML = slotsHtml;
  $('slotCount').textContent = room.players.length + ' of 4';
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
    $('recordNote').classList.toggle('hidden', !recordsEnabled);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
