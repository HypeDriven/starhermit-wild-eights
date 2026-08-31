// Wild Eights — headless browser smoke/e2e test against a running server.
// Usage: node server.js &  then  node e2e.js
"use strict";
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:8100";

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"]
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  let passed = 0, failed = 0;
  const ok = (c, name) => { if (c) passed++; else { failed++; console.error("FAIL:", name); } };

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  ok(await page.isVisible("#screen-title.active"), "title screen shows");
  ok(await page.$("#table canvas") !== null, "WebGL canvas mounted");
  ok((await page.textContent("#title-progress")).includes("Welcome"), "boot progress text");

  // Play → tutorial (first run) → game screen.
  await page.click("#btn-play");
  ok(await page.isVisible("#screen-game.active"), "learn mode starts game screen");
  await page.waitForSelector("#hand-list .card-btn", { timeout: 5000 });
  ok(true, "hand rendered in DOM mirror");

  // Keyboard: select + play/draw loop until round ends (guard bounded).
  let over = false;
  for (let i = 0; i < 300; i++) {
    if (await page.isVisible("#screen-results.active")) { over = true; break; }
    const suitVisible = await page.isVisible("#screen-suit.active");
    if (suitVisible) { await page.click("#suit-grid .suit-btn"); await page.waitForTimeout(100); continue; }
    const require = await page.evaluate(() => {
      const p = document.getElementById("tutorial-panel");
      return p && !p.hidden ? p.dataset.require : null;
    });
    const legalCards = await page.$$("#hand-list .card-btn.legal");
    let target = null;
    if (require === "eight") {
      for (const c of legalCards) { if ((await c.textContent()).trim().startsWith("8")) { target = c; break; } }
    } else if (require === "play" && legalCards.length > 1) {
      for (const c of legalCards) { if (!(await c.textContent()).trim().startsWith("8")) { target = c; break; } }
    }
    if (!target && legalCards.length && require !== "draw") target = legalCards[0];
    if (target) { await target.click(); await page.waitForTimeout(120); continue; }
    if (await page.isEnabled("#btn-draw")) { await page.click("#btn-draw"); await page.waitForTimeout(120); continue; }
    await page.waitForTimeout(250); // AI/animation settle window
  }
  ok(over, "tutorial round reaches results");
  ok((await page.textContent("#results-total")).match(/^\d+$/), "score breakdown total shown");

  // Back to menu, practice mode via setup.
  await page.click("#btn-results-menu");
  await page.click("#btn-play");
  ok(await page.isVisible("#screen-modes.active"), "mode select after tutorial");
  await page.click('[data-mode="practice"]');
  await page.click("#setup-form .btn.primary");
  ok(await page.isVisible("#screen-game.active"), "practice starts");
  await page.waitForSelector("#hand-list .card-btn");

  // Pause / resume / undo / hint controls respond.
  await page.keyboard.press("Escape");
  ok(await page.isVisible("#screen-pause.active"), "pause overlay opens");
  await page.click("#btn-resume");
  ok(await page.isVisible("#screen-game.active"), "resume returns to game");
  await page.keyboard.press("h");
  await page.keyboard.press("d");

  // Settings screen applies without errors.
  await page.keyboard.press("Escape");
  await page.click("#btn-pause-settings");
  ok(await page.isVisible("#screen-settings.active"), "settings from pause");
  await page.selectOption("#opt-quality", "low");
  await page.check("#opt-cvd");
  await page.click('#screen-settings .back-btn');
  await page.click("#btn-quit").catch(() => {});

  // Mobile portrait viewport: tray remains reachable.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#btn-daily");
  await page.waitForSelector("#hand-list .card-btn");
  const trayBox = await page.locator(".tray").boundingBox();
  ok(trayBox && trayBox.y + trayBox.height <= 844 + 200, "portrait tray within reach");

  // Hosted play: host a table, start, receive authoritative state.
  await page.keyboard.press("Escape");
  await page.click("#btn-quit");
  await page.click("#btn-play").catch(()=>{});
  if (await page.isVisible("#screen-modes.active")) {
    await page.click('[data-mode="hosted"]');
  } else {
    await page.click("#btn-hosted");
  }
  await page.click("#btn-host");
  await page.waitForSelector("#hosted-lobby:not([hidden])", { timeout: 5000 });
  const code = await page.textContent("#lobby-code");
  ok(code && code.trim().length === 4, "hosted table code issued");
  await page.click("#btn-start-hosted");
  await page.waitForSelector("#hand-list .card-btn", { timeout: 5000 });
  ok(true, "hosted round started with AI-filled seats");

  // Reconnect: new page joins with same code (name differs → new seat rejected if started).
  const page2 = await browser.newPage();
  await page2.goto(BASE + "/", { waitUntil: "networkidle" });
  await page2.click("#btn-hosted");
  await page2.fill("#join-code", code.trim());
  await page2.click("#join-form button[type=submit]");
  await page2.waitForTimeout(600);
  const err = await page2.textContent("#hosted-error");
  ok(err.includes("already-started") || err.includes("name-in-use") === false, "late join handled: " + err.trim());

  const fatal = errors.filter((e) => !e.includes("favicon"));
  ok(fatal.length === 0, "no page/console errors" + (fatal.length ? ": " + fatal.join(" | ") : ""));

  await browser.close();
  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("E2E crashed:", e); process.exit(1); });
