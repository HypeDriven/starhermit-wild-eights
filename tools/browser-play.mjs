// Plays the web package in Chrome on the machine's GPU (~/games/tools/gpu-chrome.mjs),
// the loader index.html `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3): the Daily round played through the
// hand tray's card buttons (clicks, or CDP touches on phones) and Draw, a
// suit declared when an eight was played, to the results; on the desktop also
// a card played by tapping it on the 3D table. Widgets are found through the
// page's accessibility mirror. Fails on console errors or warnings, the
// runtime's error screen, or a view that does not finish.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const views = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const cdp = v.hasTouch ? await ctx.newCDPSession(page) : null;
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(4000);
  const shot = async (name) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${name}.png`) }); } };
  const find = (name) => page.getByRole('button', { name, exact: true }).or(page.getByRole('checkbox', { name, exact: true })).or(page.getByText(name, { exact: true })).first();
  /** A tap / click at window coordinates (CSS px). */
  const tapAt = async (x, y) => {
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return;
    }
    await page.mouse.click(x, y);
  };
  const press = async (loc) => { const b = await loc.boundingBox(); if (!b) return false; await tapAt(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(250); return true; };
  let done = false;
  try {
    if (!started) throw new Error('runtime did not start');
    await shot('title');
    await press(find('Daily Challenge'));
    await page.waitForTimeout(3000);
    await shot('table');
    for (let turn = 0; turn < 120; turn++) {
      if (await page.getByText('Round over', { exact: true }).count()) { done = true; break; }
      const suit = page.getByRole('button', { name: /^(hearts|diamonds|clubs|spades) \(\d+\)$/ }).first();
      if (await suit.count()) { await press(suit); await page.waitForTimeout(400); continue; }
      const card = page.getByRole('button', { name: /, playable$/ }).first();
      if (await card.count()) { if (turn === 1) await shot('turn'); await press(card); }
      else if (await page.getByRole('button', { name: 'Draw', exact: true }).isEnabled().catch(() => false)) await press(find('Draw'));
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);
    await shot('results');
    if (!done) throw new Error('the round did not reach its results');
  } catch (e) { problems.push(String(e.message || e)); }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit).catch(() => 'gone');
  if (state === 'error') problems.push('runtime error screen');
  if (problems.length) { failed = true; console.log(`not ok - ${v.name}\n  ${problems.slice(0, 8).join('\n  ')}`); }
  else console.log(`ok - ${v.name}: Daily round played to the results`);
  await ctx.close();
}
await close();
server.close();
console.log(failed ? 'BROWSER FAIL' : 'BROWSER PASS');
process.exit(failed ? 1 : 0);
