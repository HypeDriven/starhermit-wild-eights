// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts today's Daily table against three rivals and keeps playing from the on-screen hand (a legal card,
// else Draw; a suit button when an eight asks for one), so cards deal, fly and flip, play bursts and the
// lamp, dust and passing platform lights all animate. A finished round starts again from the results.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('#screen-title.active', { timeout: 20000 });
  await page.click('#btn-settings');
  await page.waitForSelector('#screen-settings.active', { timeout: 5000 });
  await page.locator('#opt-quality').scrollIntoViewIfNeeded();
  await page.selectOption('#opt-quality', preset);
  await page.waitForFunction((p) => document.body.getAttribute('data-gfx-preset') === p, preset);
  await page.click('.back-btn[data-back="title"] >> visible=true');
  await page.waitForSelector('#screen-title.active');
}

const act = (page) => page.evaluate(() => {
  const vis = (el) => el && el.offsetParent !== null && !el.disabled;
  if (document.getElementById('screen-results')?.classList.contains('active')) {
    const again = document.getElementById('btn-again');
    if (vis(again)) { again.click(); return 'again'; }
  }
  const suit = document.querySelector('#suit-grid .suit-btn');
  if (vis(suit)) { suit.click(); return 'suit'; }
  const card = document.querySelector('#hand-list .card-btn.legal');
  if (vis(card)) { card.click(); return 'play'; }
  const draw = document.getElementById('btn-draw');
  if (vis(draw)) { draw.click(); return 'draw'; }
  return 'wait';
});

export async function start(page) {
  // Daily table: four seats on the visible title button (Play would open the first-run lesson).
  await page.click('#btn-daily');
  await page.waitForSelector('#hand-list .card-btn', { timeout: 15000 });
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await act(page); } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error('hook:', e.message.split('\n')[0]); }
      await new Promise((r) => setTimeout(r, 600));
    }
  })();
  await page.waitForTimeout(1500);
}
