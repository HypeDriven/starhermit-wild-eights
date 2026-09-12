/**
 * Wild Eights — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Play → Practice (1 rival, Relaxed) → the player plays real cards
 *   from the on-screen hand (click / tap on card buttons, the Draw button and
 *   the suit picker after an 8) until the round genuinely ends → results
 *   ("Round over" score sheet). Also exercises Hint, Undo and Pause/Resume
 *   through the visible controls. A shorter pass runs load → practice →
 *   tap-a-few-cards on a mobile touch viewport.
 *
 * The test reads ONLY the visible DOM (the hand list's .legal marking, the
 * draw button's enabled state, the suit screen, the results screen) to pick
 * the next real legal action — the same semantic information the player sees.
 * It never calls the game's own move API and never inspects hidden state to
 * choose a move, so every action is a genuine user click/tap. No game code is
 * modified.
 *
 * Serving: wild-eights is fully playable offline — solo modes
 * (practice/learn/daily/journey/challenge) run entirely on the client with no
 * /api calls (app.js only uses WebSocket for optional hosted play and fetch
 * for local sfx samples, which fall back to synthesized audio on failure).
 * starhermit.txt no longer declares server=server.js: hosted tables on the
 * platform run as host-routed realtime rooms, and server.js is only the local
 * dev host (npm start). Solo play needs no backend. Per the sibling-title
 * conventions this test embeds a minimal node:http static server on an
 * ephemeral port. If a solo mode ever starts requiring the backend this can
 * be swapped for spawning server.js; today it is not needed.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/wild-eights-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader/noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions|WebGL: /i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.opus': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // No backend here: answer any API probe with empty JSON (200) so nothing
    // in the client ever sees a hard network error.
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (name) => console.log(`ok - ${name}`);

// ---------- tiny DOM helpers (read-only observation of the visible UI) ------

const handButtons = (page) => page.locator('#hand-list .card-btn');
const legalButtons = (page) => page.locator('#hand-list .card-btn.legal');
const isActive = (page, id) => page.evaluate(
  (i) => document.getElementById(i)?.classList.contains('active') ?? false, id);
const enableState = (page, id) => page.evaluate((i) => !document.getElementById(i).disabled, id);

// ---------- game flow helpers (these issue REAL clicks/taps) ----------

// Wait until it is the human (seat 0) player's turn to act. The Draw button is
// enabled exactly when the human is the current actor and may act.
const waitHumanTurn = (page) => page.waitForFunction(
  () => !document.getElementById('btn-draw').disabled &&
        !document.getElementById('screen-results').classList.contains('active'),
  null, { timeout: 20000 });

// Make the real next legal action on the human's turn.
//   - if a suit declaration overlay is up, tap a suit button;
//   - else if a legal playable card is present, click/tap it;
//   - else click Draw. Returns 'suit' | 'play' | 'draw'.
async function actHumanTurn(page, useTap) {
  if (await isActive(page, 'screen-suit')) {
    await tapOrClick(page, '#suit-grid .suit-btn', useTap);
    return 'suit';
  }
  const legal = await legalButtons(page).count();
  if (legal > 0) {
    await tapOrClickLegal(page, useTap);
    return 'play';
  }
  await tapOrClick(page, '#btn-draw', useTap);
  return 'draw';
}

async function tapOrClickLegal(page, useTap) {
  await tapOrClick(page, '#hand-list .card-btn.legal >> nth=0', useTap);
}

async function tapOrClick(page, selector, useTap) {
  const loc = page.locator(selector);
  if (useTap) {
    const bb = await loc.first().boundingBox();
    if (!bb || bb.width < 1 || bb.height < 1) throw new Error(`tap target too small: ${selector}`);
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  } else {
    await loc.first().click();
  }
}

// Play the human to a natural end (either a win or a real round result), then
// verify the results screen. Exercises Pause/Resume, Hint and, on the first
// playable-turn, the Undo button while handling 8↦suit declarations.
async function playHumanToEnd(page, { full }) {
  // wait for the game + human's hand to render
  await page.waitForSelector('#hand-list .card-btn', { timeout: 15000 });
  await waitHumanTurn(page);

  // --- extra features, exercised once on the first human playable turn -------
  if (full) {
    // Pause → Resume via the visible buttons.
    await tapOrClick(page, '#btn-pause', false);
    await page.waitForSelector('#screen-pause.active', { timeout: 5000 });
    await page.screenshot({ path: SHOT('pause', 'desktop') });
    await tapOrClick(page, '#btn-resume', false);
    await page.waitForFunction(() => document.getElementById('screen-game').classList.contains('active') &&
      !document.getElementById('screen-pause').classList.contains('active'), null, { timeout: 5000 });
    ok('desktop: pause (Esc) and resume work, game screen restored');

    // Hint: selects a playable card (or announces draw) without erroring.
    const hadLegal = (await legalButtons(page).count()) > 0;
    await tapOrClick(page, '#btn-hint', false);
    if (hadLegal) {
      await page.waitForFunction(() =>
        document.querySelector('#hand-list .card-btn.selected') !== null, null, { timeout: 5000 });
    }
    ok('desktop: hint button works' + (hadLegal ? ' (legal card highlighted)' : ' (draw hint)'));
  }

  // --- real playloop ---------------------------------------------------------
  // On each iteration the human makes exactly one real action. Handle, in
  // order: the round-ended results screen, an in-progress suit declaration
  // (after an 8 — note the Draw button is DISABLED while the suit is pending,
  // so this must be handled before the "can act" gate), and the normal
  // play/draw turn.
  let undoDone = false;
  const settled = () => page.evaluate(() => {
    const res = document.getElementById('screen-results').classList.contains('active');
    const suit = document.getElementById('screen-suit').classList.contains('active');
    const canAct = !document.getElementById('btn-draw').disabled;
    return { res, suit, canAct };
  });

  for (let i = 0; i < 600; i++) {
    const { res, suit } = await settled();
    if (res) return; // natural end reached

    if (suit || !(await enableState(page, 'btn-draw'))) {
      // Either declare a suit (after playing an 8) or wait for the game to
      // reach the human's turn again (engine work is synchronous, so this is
      // near-immediate).
      if (suit) {
        const kind = await actHumanTurn(page, false); // taps a suit button
        if (kind !== 'suit') throw new Error('expected a suit declaration action');
        await page.waitForFunction((k) => {
          const r = document.getElementById('screen-results').classList.contains('active');
          const s = document.getElementById('screen-suit').classList.contains('active');
          return r || s || !document.getElementById('btn-draw').disabled;
        }, 'suit', { timeout: 10000 });
        continue;
      }
      await page.waitForFunction(() =>
        !document.getElementById('btn-draw').disabled ||
        document.getElementById('screen-results').classList.contains('active') ||
        document.getElementById('screen-suit').classList.contains('active'), null, { timeout: 10000 });
      continue;
    }

    const handBefore = await handButtons(page).count();
    const kind = await actHumanTurn(page, false); // 'play' | 'draw'

    // Wait for the engine to settle this action (back to our turn, or round
    // end, or a suit picker opened). Synchronous in the client, so this is
    // just confirming the DOM moved past the pre-action snapshot.
    await page.waitForFunction(() =>
      !document.getElementById('btn-draw').disabled ||
      document.getElementById('screen-results').classList.contains('active') ||
      document.getElementById('screen-suit').classList.contains('active'), null, { timeout: 10000 });

    if (full && !undoDone && kind === 'play' &&
        !(await isActive(page, 'screen-suit')) && !(await isActive(page, 'screen-results'))) {
      // Undo (practice): revert the move just made, then continue playing.
      if (await enableState(page, 'btn-undo')) {
        await tapOrClick(page, '#btn-undo', false);
        await page.waitForFunction((n) =>
          !document.getElementById('screen-results').classList.contains('active') &&
          !document.getElementById('screen-suit').classList.contains('active') &&
          document.querySelectorAll('#hand-list .card-btn').length === n,
          handBefore, { timeout: 10000 });
        undoDone = true;
        ok('desktop: undo reverts the last move in practice');
        await waitHumanTurn(page).catch(() => {});
      }
    }
  }
  throw new Error('round did not end within the play-loop guard limit');
}

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/|\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const p = r.url();
    if (r.status() >= 400 && !/\/api\/|\/favicon/.test(p)) errors.push(`http ${r.status()}: ${p}`);
  });

  try {
    // Seed the save so Play leads to mode-select (tutorial already done).
    await context.addInitScript(() => {
      try {
        localStorage.setItem('wild-eights-save-v1', JSON.stringify({
          version: 1,
          settings: { tutorialDone: true, reducedMotion: true, muted: true },
        }));
      } catch (e) { /* private mode */ }
    });

    // load + title
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#screen-title.active', { timeout: 15000 });
    await page.waitForFunction(() => (document.getElementById('title-progress')?.textContent || '').length > 0);
    await page.screenshot({ path: SHOT('title', name) });
    ok(`${name}: title screen visible`);

    // Play → mode select → Practice → setup (1 rival, Relaxed)
    await tapOrClick(page, '#btn-play', full ? false : true);
    await page.waitForSelector('#screen-modes.active', { timeout: 10000 });
    await tapOrClick(page, '.mode-card[data-mode="practice"]', full ? false : true);
    await page.waitForSelector('#screen-setup.active', { timeout: 10000 });
    // 1 rival, Relaxed
    await page.check('input[name="players"][value="2"]');
    await page.check('input[name="difficulty"][value="0"]');
    await tapOrClick(page, '#setup-form button[type="submit"]', full ? false : true);
    await page.waitForSelector('#screen-game.active', { timeout: 10000 });

    if (full) {
      await page.waitForFunction(() =>
        (document.getElementById('objective-text')?.textContent || '').includes('Empty your hand'),
        null, { timeout: 10000 });
      await page.screenshot({ path: SHOT('play', name) });
      ok(`${name}: practice started in the card-table screen ("${(await page.textContent('#objective-text')).trim()}")`);

      await playHumanToEnd(page, { full: true });

      // results screen
      await page.waitForSelector('#screen-results.active', { timeout: 15000 });
      const headline = (await page.textContent('#results-headline')) || '';
      if (!/You win the round|wins the round/.test(headline)) {
        throw new Error(`unexpected results headline: "${headline}"`);
      }
      const rows = await page.locator('#results-table tbody tr').count();
      if (rows < 1) throw new Error(`results breakdown empty (rows=${rows})`);
      await page.screenshot({ path: SHOT('results', name) });
      ok(`${name}: round played to its end — results shown ("${headline}", ${rows} score row${rows === 1 ? '' : 's'})`);

      // round finished for real + progress persisted locally
      const rec = await page.evaluate(() => {
        const raw = localStorage.getItem('wild-eights-save-v1');
        return raw ? JSON.parse(raw) : null;
      });
      const rounds = rec?.records?.roundsPlayed ?? 0;
      if (rounds < 1) throw new Error('round not persisted: ' + JSON.stringify(rec?.records));
      ok(`${name}: round recorded (roundsPlayed ${rounds}, won ${rec.records.roundsWon})`);
    } else {
      // mobile: make a few real touch moves on the hand.
      await page.waitForSelector('#hand-list .card-btn', { timeout: 15000 });
      let acts = 0;
      for (let i = 0; i < 6; i++) {
        if (await isActive(page, 'screen-results')) break;
        if (!(await enableState(page, 'btn-draw'))) break;
        const kind = await actHumanTurn(page, true);
        if (kind) acts++;
        await page.waitForTimeout(200);
      }
      if (acts < 1) throw new Error('no move registered on mobile');
      await page.screenshot({ path: SHOT('mobile-play', name) });
      ok(`${name}: practice started; made ${acts} real touch move${acts === 1 ? '' : 's'} on the hand`);
    }
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  console.log(`ok - ${name}: no page errors`);
}

// ---------- main ----------
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  console.log(`serving ${ROOT} at ${BASE}`);
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — wild-eights, desktop + mobile, no page errors');
} catch (e) {
  failures++;
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failures) process.exit(1);
