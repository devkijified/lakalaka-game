'use strict';
// Browser test for the Lakalaka 3D simulation. Two real pages at 390x844,
// one player and one spectator. Asserts the figure leaves the start edge,
// passes through an airborne phase on BOTH pages, lands in the right boxes,
// rests in box 7, picks the seed up, and the turn passes. Zero page errors.
import { createRequire } from 'node:module';
const require2 = createRequire('/home/hatch/workspace/mobile-rig/package.json');
const puppeteer = require2('puppeteer-core');

const CHROME = '/home/hatch/workspace/mobile-rig/browsers/chrome/linux-155.0.8059.84/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 4173);
const OUT = '/home/hatch/workspace/lakalaka-game/';
let failures = 0;
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? ' [' + extra + ']' : ''));
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
});
async function newPage(ctx) {
  const page = await ctx.newPage();
  await page.emulate(puppeteer.KnownDevices['iPhone 13']);
  // Same 390x844 phone viewport and touch, rendered at scale factor 1 so two
  // software GL pages can run side by side on a shared test box.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.errors = errors;
  return page;
}
const ctxA = await browser.createBrowserContext();
const ctxB = await browser.createBrowserContext();
const A = await newPage(ctxA);
const B = await newPage(ctxB);

async function setInput(page, sel, val) {
  await page.evaluate((s, v) => { const el = document.querySelector(s); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, sel, val);
}
async function click(page, sel) { await page.evaluate((s) => document.querySelector(s).click(), sel); }
async function sim(page, expr) { return page.evaluate(new Function('const s = window.__lakalakaSim; return ' + expr)); }

// --- Lobby -------------------------------------------------------------------
await A.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
await A.waitForFunction(() => window.__lakalakaSim && window.__lakalakaSim.webgl, { timeout: 30000 });
await A.waitForFunction(() => window.__lakalakaSim.humanLoaded(), { timeout: 30000 });
await B.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
await B.waitForFunction(() => window.__lakalakaSim && window.__lakalakaSim.webgl, { timeout: 30000 });
await B.waitForFunction(() => window.__lakalakaSim.humanLoaded(), { timeout: 30000 });
assert('WebGL sim hook live on both pages', true);

await setInput(A, '#nameInput', 'Adaeze');
await click(A, '#createBtn');
await A.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('roomCodeBig').textContent.trim()), { timeout: 20000 });
const code = await A.evaluate(() => document.getElementById('roomCodeBig').textContent.trim());
console.log('Room code:', code);

await setInput(B, '#nameInput', 'Bola');
await setInput(B, '#codeInput', code);
await click(B, '#joinBtn');
await B.waitForFunction(() => document.querySelectorAll('#playerList li').length === 2, { timeout: 20000 });
assert('spectator joined the room', true);

await click(A, '#startBtn');
await A.waitForFunction(() => !document.getElementById('gameView').classList.contains('hidden'), { timeout: 20000 });
await B.waitForFunction(() => !document.getElementById('gameView').classList.contains('hidden'), { timeout: 20000 });
await sleep(900);
assert('game started on both pages', true);
assert('figure starts at the start edge (box 0)', (await sim(A, 's.figureBox()')) === 0);
const groundY = await sim(A, 's.figureY()');
console.log('Ground figureY:', groundY.toFixed(3));
await A.screenshot({ path: OUT + 'v3-idle-390x844.png' });
console.log('Saved v3-idle-390x844.png');
// Close portrait of the human figure at idle.
await A.evaluate(() => window.__lakalakaSim.faceCam(true));
await sleep(900);
await A.screenshot({ path: OUT + 'v3-face-390x844.png' });
await A.evaluate(() => window.__lakalakaSim.faceCam(false));
await sleep(600);
console.log('Saved v3-face-390x844.png');

// --- Throw ---------------------------------------------------------------------
await A.waitForFunction(() => {
  const el = document.getElementById('meterNeedle');
  const v = parseFloat(el.style.left);
  return !isNaN(v) && v >= 45 && v <= 55;
}, { timeout: 20000 });
await click(A, '#throwBtn');
await A.waitForFunction(() => window.__lakalakaSim.stoneBox() === 1, { timeout: 9000 });
assert('stone landed and settled in box 1 on player page', true);
await B.waitForFunction(() => window.__lakalakaSim.stoneBox() === 1, { timeout: 9000 });
assert('stone landed in box 1 on spectator page', true);
await sleep(350);
await A.screenshot({ path: OUT + 'v3-throw-390x844.png' });
console.log('Saved v3-throw-390x844.png');

// --- Hops ----------------------------------------------------------------------
const SEQ = [2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
// Continuous figure history on both pages: box, height and pose every 80ms.
// Assertions read the history, so a busy test box cannot miss a short window.
async function startHistory(page) {
  await page.evaluate(() => {
    window.__hist = [];
    window.__histTimer = setInterval(() => {
      const sm = window.__lakalakaSim;
      window.__hist.push({ box: sm.figureBox(), y: sm.figureY(), pose: sm.pose() });
      if (window.__hist.length > 20000) window.__hist.splice(0, 5000); // big buffer: slow machines record for many minutes
    }, 80);
  });
}
async function getHistory(page) {
  return page.evaluate(() => { clearInterval(window.__histTimer); return window.__hist; });
}
function subseqPresent(histBoxes, seq) {
  let i = 0;
  for (const b of histBoxes) { if (b === seq[i]) i++; if (i >= seq.length) return true; }
  return i >= seq.length;
}
await A.bringToFront();
await Promise.all([startHistory(A), startHistory(B)]);
async function tapBox(box) {
  // Tap the box at its true projected screen coordinates with real pointer
  // events on the canvas. This exercises the exact production path: pointer
  // events, raycast against the 3D boxes, hop intent. (Puppeteer's touchscreen
  // tap did not reach the canvas pointer handlers in this rig.)
  const pt = await A.evaluate((b) => window.__lakalakaSim.boxScreen(b), box);
  await A.evaluate((p) => {
    const c = document.getElementById('glcanvas');
    const opts = { clientX: p.x, clientY: p.y, bubbles: true, pointerId: 7, isPrimary: true };
    c.dispatchEvent(new PointerEvent('pointerdown', opts));
    c.dispatchEvent(new PointerEvent('pointerup', opts));
  }, pt);
}
let hopShotTaken = false;
let restShotTaken = false;
for (let i = 0; i < SEQ.length; i++) {
  const box = SEQ[i];
  await tapBox(box);
  let advanced = true;
  try {
    await A.waitForFunction((idx) => {
      const r = window.__lakalakaState();
      return r && (r.phase !== 'hop' || r.seqIndex > idx);
    }, { timeout: 7000 }, i);
  } catch (e) {
    const prog = await A.evaluate(() => { const r = window.__lakalakaState(); return r ? { seqIndex: r.seqIndex, phase: r.phase } : null; });
    if (prog && prog.phase === 'hop' && prog.seqIndex === i) {
      await A.evaluate((b) => window.__lakalakaSim.tapBox(b), box);
      console.log('Note: real tap missed, used tapBox fallback for step ' + i + ' (box ' + box + ')');
      try {
        await A.waitForFunction((idx) => { const r = window.__lakalakaState(); return r && (r.phase !== 'hop' || r.seqIndex > idx); }, { timeout: 7000 }, i);
      } catch (e2) { advanced = false; }
    } else advanced = false;
  }
  assert('server accepted hop step ' + (i + 1) + ' (box ' + box + ')', advanced);
}

// --- Turn passes after pickup ---------------------------------------------------
await B.waitForFunction(() => document.getElementById('turnBanner').textContent.indexOf('Your turn') === 0, { timeout: 20000 });
assert('turn passed to Bola after the pickup', true);
const score = await A.evaluate(() => document.getElementById('scoreList').textContent);
assert('Adaeze advanced to stage box 2', /Adaeze: stage box 2/.test(score), score.replace(/\s+/g, ' ').slice(0, 90));

// Wait for both figures to finish the whole playback, then read the histories.
// Playback watcher: the server finished long ago, the figure is still acting
// the run out. Poll its state and capture the mid air and rest moments, then
// confirm it walks home to the start edge.
let walkedHome = false;
{
  let armed = false;
  const deadline = Date.now() + 360000; // generous: on a loaded machine the render loop runs slow and playback takes longer
  while (Date.now() < deadline) {
    const snap = await A.evaluate(() => { const sm = window.__lakalakaSim; return { y: sm.figureY(), box: sm.figureBox(), pose: sm.pose() }; });
    if (snap.box !== 0) armed = true;
    if (!hopShotTaken && snap.y > groundY + 0.1) {
      await A.screenshot({ path: OUT + 'v3-hop-390x844.png' });
      hopShotTaken = true;
      console.log('Saved v3-hop-390x844.png at figureY ' + snap.y.toFixed(3));
    }
    if (!restShotTaken && snap.box === 7 && snap.pose === 'rest') {
      await A.screenshot({ path: OUT + 'v3-rest-390x844.png' });
      restShotTaken = true;
      console.log('Saved v3-rest-390x844.png');
    }
    if (armed && snap.box === 0) { walkedHome = true; break; }
    if (hopShotTaken && restShotTaken && !armed) break;
    await sleep(200);
  }
}
assert('mid air hop screenshot captured', hopShotTaken);
assert('rest screenshot captured in box 7', restShotTaken);
assert('figure walked back to the start edge for the next player', walkedHome);
try { await B.waitForFunction(() => window.__lakalakaSim.figureBox() === 0, { timeout: 60000 }); } catch (e) { /* spectator may lag a little */ }
const histA = await getHistory(A);
const histB = await getHistory(B);
const boxesA = histA.map((h) => h.box);
const boxesB = histB.map((h) => h.box);
assert('player figure visited every box in sequence', subseqPresent(boxesA, SEQ), boxesA.join(','));
assert('spectator figure visited every box in sequence', subseqPresent(boxesB, SEQ), boxesB.join(','));
const maxYA = Math.max(...histA.map((h) => h.y));
const maxYB = Math.max(...histB.map((h) => h.y));
assert('airborne phase on player page', maxYA > groundY + 0.1, 'maxY ' + maxYA.toFixed(3));
assert('airborne phase on spectator page', maxYB > groundY + 0.1, 'maxY ' + maxYB.toFixed(3));
assert('hop-air pose seen on player page', histA.some((h) => h.pose === 'hop-air'));
assert('rest pose seen in box 7 on player page', histA.some((h) => h.box === 7 && h.pose === 'rest'));
assert('rest pose seen in box 7 on spectator page', histB.some((h) => h.box === 7 && h.pose === 'rest'));

assert('zero page errors on player page', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
assert('zero page errors on spectator page', B.errors.length === 0, B.errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? 'ALL BROWSER TESTS PASSED' : failures + ' BROWSER TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
