# Wild Eights — running specification (StarHermit engine)

Wild Eights is a StarHermit engine script game (engine 1.27.0, host API minor 29): one package
(`native/main.ts` entry) played natively by the StarHermit client and in browsers through the
engine's web runtime (`index.html` loader + `starhermit-files.json`, written by `npm run package`).

## Game
- Rules: `js/game.js` (deterministic, seeded): match the top discard by suit or rank; an 8 is wild
  and its player declares the next suit; a blocked player draws up to 3 cards (a playable draw keeps
  the turn); the first empty hand wins and scores the points left in the rivals' hands (8 = 50,
  A = 15, faces 10, pips face value); a dead stock ends by fewest points.
- Modes: Learn (four lessons, seed 1337, one Relaxed rival), Practice (1–3 rivals, Relaxed /
  Regular / Expert, undo), Daily (one seed per UTC day from the platform clock, else the device's),
  Journey (40 stages, each unlocked by the previous win, best moves kept), Challenges (four fixed
  seeds, no undo), Hosted Play (below). The first Play runs Learn; later Play opens the modes.
- Records: rounds played/won, best score, best streak, Daily days, seven local achievements, and
  the `high-score` leaderboard's top ten.

## Screens and controls
- Title, modes, Journey, challenges, practice setup, hosted play, table, results, settings, help,
  records; pause, suit-declaration and erase-progress dialogs. Every screen is linked from the title
  or the modes. Phones in portrait stack HUD / lesson / table / hand; short landscape shows
  HUD | table | hand; the page header is hidden there mid-round.
- Table: the hand tray's card buttons (named "Q of clubs, playable") or the cards on the 3D table
  (pointer or finger; scene taps are skipped while `ui.pointerCaptured()`), Draw, Hint, Undo
  (Practice), Pause.
- Keys (rebindable in Options): ←/→ choose a card, Enter/Space play it, D draw, H hint, U undo,
  Esc pause / back, C reframe. Pad: D-pad / left stick choose, South play, West draw, North hint,
  Select undo, East or Start pause, right stick press reframe.
- Settings (game): table theme (five), colour-vision-safe card palette, left-handed tray, replay
  tutorial, erase progress. Volumes, mute, graphics level, frame-rate limit, language, controls,
  reduced motion, high contrast and text size are the runtime's Options (the Options buttons).

## Look and sound
- `native/render.ts` ports the old three.js r185 table one to one: the old page's light values
  (minor 24: no ÷π), its shadow camera / bias values, `RoomEnvironment(renderer)` lowered by 3.5
  (r183+) at `environmentIntensity` 0.3, bloom, GTAO, the linear colour grade (over-range light kept, minor 29), sparks and dust.
  The four old presets map to the runtime's quality tiers (`native/quality.ts`).
- `native/audio.ts`: the sfx/*.opus one-shots; the music stem and railway ambience rendered once
  into looping clips (ambience on the music bus).

## Platform
- Save (`saves`, schema 1, `js/save.js`): journey, achievements, streaks, Daily days, records,
  tutorial; merged on conflict; the browser build's cloud slot (`game:wild-eights`) migrates once
  as the foreign save. Game options are engine settings; the old settings KV is imported once.
- Solo rounds (every mode but Learn) post the round's score (0 when lost) through `server.js`'s
  score-posting session, range-checked against BOARDS as the old score-script.js did.
- Hosted Play (signed in): Host a table (4-seat room, join code), Quick join, Join by code, room
  invites, invite friends; the host starts the round and the platform fills the empty seats with AI.
  The round is a room-bound session refereed by `server.js` (built by `npm run server` from
  `tools/server-head.js`, `js/game.js` and `tools/server-body.js`): server-side deal from
  `ctx.random`, every move validated for the sender's own seat, each seat sent only its own hand,
  AI seats played by the rules' Regular AI, a player who left handed to the AI, one offline 30 s
  played by the AI until back; the session's `result` is the record. Clients never report results.

## Checks
- `npm test`: rules (`tests/rules.test.js`), server referee + score posting, save, i18n (nine
  locales), server.js freshness, then `tests/native.mjs` (tsc, `starhermit check`, web index,
  every `tests/native/*.play`: menus, Journey 1 won, Learn on a DPR-3 phone, short landscape by keys).
- `npm run test:online`: two runtimes on `--dev --local-platform` (alice hosts, bob quick-joins)
  play a hosted round to the server's result. `npm run test:browser`: the web package on the AMD
  GPU at desktop, phone and landscape (DPR 3), a Daily round to the results.
- `node tools/gen-plays.mjs` regenerates the solo play scripts from the rules.

## Known limitations
- The old browser-only dev host (`node server.js` WebSockets) is gone; hosted tables need the
  StarHermit platform (or the runtime's local platform).
- Guests' old browser localStorage progress cannot migrate; signed-in cloud saves do.
- The graphics panel's per-effect overrides are not offered (Options choose a level).
- Hosted results are not posted to the high-score board (as before).

---

# Original design specification (browser build)

# Wild Eights — Product and Game Specification

**Document status:** design specification only; no implementation is included.  
**Game index:** 82  
**Genre:** Turn-based card game  
**Players:** 2–4 players depending on ruleset, plus practice AI  
**Targets:** desktop browsers, mobile browsers, landscape and portrait where practical  
**Rendering direction:** Three.js-first presentation with a fully usable semantic HTML interface layer

## 1. Product vision

Wild Eights is a game in which players match suit or rank; an eight changes the active suit, and the first empty hand wins. Its signature setting is a warm railway-compartment card table. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Match suit or rank; an eight changes the active suit, and the first empty hand wins.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **match suit or rank, declare a suit after an eight, draw when blocked, and empty the hand**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Round score derives from opponents' remaining cards. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action. The current lesson is shown above the board, and the table's height is budgeted from what the viewport leaves after HUD, lesson and hand so a round never needs scrolling.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Hosted play:** private invitations and appropriate public matching, with reconnect and authoritative results.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The Three.js canvas fills the game region but is never the only UI. Menus, text, forms, chat, settings, and assistive descriptions use semantic HTML over or beside the canvas. Maintain a single shared layout model so DOM labels align with projected Three.js targets.

### Responsive layouts

- **Wide desktop (≥1024 CSS px):** centered playfield, objective/progression rail on the left, contextual actions and social/status rail on the right. Maximum line length is 70 characters.
- **Compact desktop/tablet:** playfield remains central; secondary rails collapse into drawers. Pointer hover may preview but never be required.
- **Portrait mobile:** top safe-area status bar, square or perspective-fit playfield, bottom thumb-zone action tray, and sheet-based secondary panels. Never place critical controls under browser chrome or display cutouts.
- **Landscape mobile:** status rail | table | hand column with the lesson across the top and the page header hidden mid-round; preserve at least 44×44 CSS-pixel targets and 8-pixel separation. The title screen compacts (smaller card fan, tighter rows) so every menu button fits above the fold.
- React to resize, orientation, device-pixel-ratio, safe-area insets, virtual keyboard, and visibility changes without losing input or restarting the round.
- **Large screens (above 1600×1000):** the shared `ui-scale.js` sets `--ui-scale` (`min(w/1600, h/1000)`, capped at 2.5) and the whole page zooms by it (viewport units divided by it); the table renderer multiplies its pixel ratio by the scale so the 3D table stays sharp, the table budget is converted to layout pixels, and the title menu is centred vertically.

### Screens and overlays

- **Title/home:** Play is dominant; daily challenge, journey progress, and profile are one level below.
- **Mode setup:** show rules, expected duration, player count, assists, and whether the result is ranked before commitment.
- **Play HUD:** objective, progress, current actor/state, pause, and only context-relevant actions.
- **Pause/settings:** resume first; audio, graphics, controls, accessibility, help, and leave are clearly separated.
- **Results:** outcome headline, score breakdown, progress, achievements, comparison, replay/retry, and next recommended action.
- **Help:** visual rule cards generated from current control mappings and representative legal states. Screens open at their heading (focus without scrolling).
- Lobby, roster, readiness, invitation, reconnect, result, and report states are first-class screens.

### Input

- Pointer/touch: raycast only against explicit interaction layers; use pointer capture for drags; cancel safely on lost capture.
- Touch: distinguish tap, drag, and camera gesture by distance/time thresholds; never require multi-touch for core play.
- Keyboard: directional navigation among legal targets, confirm, cancel, pause, undo/hint where valid, and camera reset.
- Gamepad: focus navigation, primary/secondary actions, pause, and remappable axes/buttons.
- Prevent accidental double commits with action identifiers, not arbitrary long debounce timers. Provide visible drag origin, target preview, and invalid-action explanation.

### Accessibility

- Full keyboard operation and visible focus; DOM equivalents for canvas controls; headings and live regions for objective, turn, score, errors, and results.
- Color is reinforced by shape, texture, icon, or label. Include contrast-safe and common color-vision palettes.
- Reduced-motion mode removes camera swoops, shake, parallax, rapid particles, and large scaling while preserving event timing.
- Independent sliders for music, effects, ambience, and voice; captions/text cues for meaningful audio; no audio-only gameplay.
- Options for larger text, high contrast, left-handed controls, hold-versus-toggle, timing assistance, haptics off, and tutorial replay.
- Announce Three.js board state through a concise navigable model rather than describing every decorative object.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is a warm railway-compartment card table. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### Three.js scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.

### Graphics

The table is lit by a warm hanging pendant lamp (a glowing bulb plus point light), a directional key from the lamp side whose PCF shadow box is fitted to the table, and a hemisphere fill, with ACES filmic tone mapping and sRGB output. Cards are rounded, slightly thick card stock (one draw call each) with lacquered clearcoat faces; the table has a lacquered wood rail and skirt, a brass inlay ring and fibre-textured felt, and stands on a patterned moquette carpet that fades into the compartment's shadows. Optional effects: shadows cast by cards and the table, GTAO contact darkening, bloom limited to the lamp bulb and play sparks (threshold on the HDR buffer, so paper and felt never bloom), a colour grade with vignette, FXAA/SMAA/MSAA anti-aliasing, image-based reflections (RoomEnvironment through PMREM), additive spark bursts and dust motes drifting in the lamplight, and ambient animation — the pendant sways with the carriage, the lamp shimmers and the light of passing platform lamps sweeps across the felt. All motion stops with reduced motion; legal-card lift, rim outline and ground marker read the same with every effect off. The Settings screen's **Graphics** section offers a quality preset (Auto, chosen from the StarHermit hardware level — see below; Low; Balanced; High; Ultra), a render scale (50–200% of the preset's), a per-effect override for shadows, ambient occlusion, bloom, colour grade, anti-aliasing, reflections, surface detail, particles and ambient animation ("From preset (…)" by default; choosing a preset clears overrides), adaptive resolution (steps the resolution down to 60% when frames are slow and back up when fast) and a frame-rate readout (bottom-left, never over controls), plus a summary "GPU · Level N · cost · pixel size" ("Level" localized). The pixel ratio is capped per preset (Low 1×, Balanced 1.5×, High/Ultra 2×), Low uses no post-processing and none of its code is loaded, and nothing is rendered while the table is hidden. Changes apply immediately, are stored with the other settings (`settings.gfx`, mirrored to the cloud save) and the panel's strings are localized in the nine game locales and follow the game language (§5 Localization), relabelling in place when it changes. If post-processing cannot be built the table renders without it and the panel says so.

**Hardware-level detection.** `gpu-level.js` (`window.StarHermitGpu`, never edited here) rates the WebGL renderer string plus device facts (`detectSystem()`: phone/tablet, cores, memory, screen, ASTC) on the StarHermit hardware level 0–20 (0 = Galaxy S20 / Intel UHD or weaker, every software renderer and no WebGL; 20 = RTX 5090; each level ≈ 1.23×; laptop parts two levels below the desktop part; phones, tablets and ≤ 4 GB machines capped at 9). `gfx.js` maps it with `presetForLevel(level, { low: 0, balanced: 4, high: 10, ultra: 17 })`, so Auto picks Ultra on strong GPUs; adaptive resolution still steps down when frames are slow. Headless SwiftShader is level 0 → Low. Phones and tablets pace Auto FPS at half the display refresh rate ("Auto (half refresh rate)") and start at 16 simultaneous sounds (shared `game-options.js`).

**Per-preset budgets** (`BUDGETS` / `budgetFor` in `gfx.js`). Each preset holds 60 FPS on the weakest GPU Auto gives it — Low at level 0, Balanced 4, High 10, Ultra 17. Cards, hit areas, legal-card cues and rules are identical on every preset; only visuals change. Sparks and dust are tuned at the floor level and scale up within the preset on faster GPUs (`StarHermitGpu.scaleBudget`, ≤ 2×, at most 3× sparks / 320 motes). High-tier sparks are one additive instanced mesh (one draw call, pool of 512) instead of a mesh per spark; Low-tier bursts keep their 8 opaque flecks. A budget change rebuilds the table, card textures and dust.

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Shading with Surface detail on (cards, wood, felt, brass, carpet; plain is always Lambert) | Lambert | Standard | Physical clear-coat cards and wood | as High |
| Card face/back texture (Detail on) | 128×180 | 192×270 | 256×360 | 384×540 |
| Felt / wood / carpet textures | ½ | authored | authored | 2× |
| Table, rail, felt, brass ring, lamp shade, bulb segments | ½ | ¾ | full | 1½× |
| Sparks per play (Particles high: 22, strong 36) | ½ | ¾ | 1× | 1½× |
| Dust motes (Particles high) | 40 | 60 | 90 | 160 |
| Bloom / GTAO resolution | ½ | ½ | ½ | full |
| Pixel-ratio cap × render scale | 1 × 1 | 1.5 × 1 | 2 × 1 | 2 × 1.25 |

**Benchmark** (`node tools/gfx-bench.mjs wild-eights`, hook `tests/gfx-bench.mjs`: preset chosen in Settings → Graphics, then today's Daily table — four seats — played from the on-screen hand, Draw and suit buttons, restarted from results). Measured 2026-10-18 on the AMD Radeon iGPU (level 2), projected to each preset's floor level:

- Desktop 1920×1080: PASS low typical 7.28 / slow 0.35 ms, CPU p90 1.00 ms; PASS balanced 4.55 / 0.24 ms, CPU 1.20 ms; PASS high 0.34 / 0.00 ms, CPU 1.00 ms; PASS ultra 1.28 / 1.52 ms, CPU 1.00 ms (High/Ultra CPU p90 was 8.1 / 10.5 ms with a mesh per spark).
- Mobile 390×844 @ DPR 3: PASS low 0.07 / 0.00 ms, CPU 1.40 ms; PASS balanced 0.00 / 0.04 ms, CPU 1.20 ms.

Files: `gfx.js` (pure quality model: presets, tiers, hardware-level detection, per-preset `BUDGETS`/`budgetFor`, cost summary), `gpu-level.js` (shared StarHermit copy, classic script loaded before `gfx.js`; Node tests `require` it), `graphics-panel.js` (Graphics controls and their locale tables), `ui.js` (renderer, effects, post chain), `vendor/three/addons/` (post-processing passes, shaders and RoomEnvironment from the same three.js release, r185, as `three.module.min.js`; mapped as `three/addons/` in the page's import map), `tests/gfx.test.js` (unit tests, part of `npm test`); `tests/e2e.mjs` also drives the Graphics panel at desktop and mobile sizes (summary shows "Level 0" under SwiftShader); `tests/gfx-bench.mjs` is the real-GPU benchmark hook (never run in CI).

### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.

### Graphics-skill routing

During implementation, begin with `threejs-skill-router` and load only the following retained skills because they materially affect this visual target:

- `threejs-camera-direction` for deliberate framing and input-safe camera transitions
- `threejs-procedural-geometry` for authored, inspectable meshes instead of primitive-only placeholders
- `threejs-procedural-materials` for coherent PBR surfaces, perceptual parameters, and readable state masks
- `threejs-procedural-animation` for deterministic motion phases, springs, and interruption-safe transitions
- `threejs-procedural-vfx` for bounded particles, trails, impact accents, and event hierarchy
- `threejs-exposure-color-grading` for tone mapping, adaptation limits, and accessible color separation
- `threejs-image-pipeline` for explicit depth/color ownership and pass ordering
- `threejs-visual-validation` for fixed-view captures, seed sweeps, and performance evidence

Follow the skill pack's acceptance gate: deterministic seeds, debug views for controlling fields, perceptually grouped parameters, mechanism-backed quality tiers, and a readable no-post baseline. Do not add an effect merely because a skill exists.

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

## 5. Technical architecture

### Client modules

- `bootstrap`: host handshake, capability detection, asset manifest, lifecycle.
- `rules`: pure deterministic state transitions, legality, scoring, seeded random stream.
- `session`: local or hosted commands, snapshots, prediction policy, reconnect, replay.
- `render`: Three.js scene graph, semantic entity views, camera, lighting, VFX, quality.
- `ui`: responsive DOM shell, focus, localization, settings, overlays, accessibility mirror.
- `audio`: buses, event mapping, focus/background behavior, decode and memory policy.
- `content`: versioned levels, themes, tutorials, validation metadata.
- `platform`: token-aware REST/WebSocket adapter, retries, rate-limit handling, telemetry consent.

No module may mutate rules state except through a validated command. Rendering consumes immutable snapshots plus interpolation data. UI state and simulation state are separate so closing a drawer cannot affect a match.

### Localization

- Every player-facing string ships in nine locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT): markup (`data-i18n`, `data-i18n-aria`, `data-i18n-title`), HUD, hand mirror labels and announcements, suit names, card names ("Q of hearts" style per locale; rank symbols match the card faces), results, journey stage names, challenge/tutorial/achievement/theme text, records, hosted-table lobby, errors and invites, and the stop banners. Strings live in `strings.js`; `i18n.js` (`window.WEI18N`) provides `t()`/`tn()` and sets `<html lang>`; StarHermit button/banner strings (`platform.js`) and the Graphics panel follow the same locale. Away notes ("X left the table") travel between clients as structured entries so each client words them in its own language; host-supplied fallback names ("Player N") are localized per client.
- Settings → **Language → Game language** (from the shared `game-options.js`, rendered from the `sh-language.js` instance inside the Settings screen, reachable from the title and the pause menu) offers **Automatic — <resolved language>** plus the nine locales by native name, with a sync status line. It is the only language selector.
- Resolution (`sh-language.js`, loaded before the game scripts): explicit game choice → for Automatic, the StarHermit account's `preferredLanguage` (`GET /api/v1/me/language`, signed in only) → `navigator.languages` → en-US. The choice (`auto` or a locale) is stored per player in `localStorage['wild-eights.language.<user|guest>']` and, signed in, in the per-player settings key `ui.language` as `{ choice }`; a failed settings read never overwrites it and the game never writes the platform preference. The game's settings mirror only syncs its own keys (never `ui.*`). `?lang=<tag>` forces a locale for the page load and hides the selector.
- A change applies immediately: the HUD, hand mirror, tutorial panel, open lists (journey, challenges, records), results, suit picker, lobby, hosted error line, sound button, theme names and Graphics labels re-render in place; a running round and any table socket are untouched.

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands, periodic state hashes, terminal result.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- Show useful progress by asset group; load core rules/UI first and scenic assets lazily. Provide procedural low-detail substitutes if optional assets fail.
- Cache immutable hashed assets and the last safe local snapshot. Updates activate between rounds, never during one.
- Recover WebGL context by rebuilding GPU resources from retained CPU descriptors. If 3D is unavailable, present a clear compatibility message and preserve account/session state.
- Background tabs reduce rendering to zero or a low heartbeat while preserving required network lifecycle.

## 6. StarHermit integration

### Packaging and launch
- Ship a browser distribution with `starhermit.txt` at its root, `name=Wild Eights`, and `launch=index.html`. Keep source files, secrets, design documents, and source maps outside the uploaded distribution.
- `index.html` loads the canonical `starhermit-sdk.js` (unmodified copy of `tools/starhermit-sdk.js`) and calls `StarHermit.init()` before the game scripts. The SDK reads `#game_token=` / `#access_token=` (plus `session_id`), strips it from the URL, takes the slug from the `game_scope` claim and renews the launch token; tokens never reach local storage. `platform.js` (`window.WEPlatform`) wraps the SDK.
- Without a token the game makes no automatic network calls; the only network use is the opt-in Hosted Play screen, which talks to this game's own dev server (`server.js` `/ws` tables) off-platform. Daily boundaries use the local clock (no time route is reachable). When renewal is refused the game re-offers sign-in and hosted tables fall back to unavailable while solo play continues; if the token expired it shows a persistent "Your StarHermit session expired." notice with a **Back to StarHermit** button (`StarHermit.relaunch()`, localized in all nine locales), otherwise it toasts "signed out".

### Identity, profile, presence, and preferences
- Guests play locally. On `*.starhermit.com` without a token the title shows **Sign in with StarHermit**; it is hidden when signed in and when running locally.
- Signed in, the top bar shows the profile nickname (fallback `Player <id prefix>`) and sync state, and the title shows **Invite a friend**, which copies `StarHermit.inviteLink()` to the clipboard with a toast. These strings are localized in all nine locales. No presence heartbeats are sent.
- Volumes, mute, graphics, theme, reduced motion, high contrast, colour-vision palette, large text and left-handed layout are mirrored to the per-game settings KV whenever they change; on start the platform values win over local ones.
- Keyboard actions are declared as `control.*` lines in `starhermit.txt` (previous/next card, play card, draw, hint, undo, pause, reframe). The game routes `keydown` by `event.code` through `StarHermit.loadBindings`; How to Play lists the effective keys and gamepad buttons replay the bound keys. Touch mappings remain responsive UI controls.
- The whole save document (settings, journey, achievements, records) is cloud-saved in the `game:<slug>` slot through `StarHermit.loadJSON`/`saveJSON`. On boot the cloud copy is merged with this device's (`mergeSaves`) and the merge is written back; local saves are mirrored (debounced ~2 s, conditional on the version last loaded) and flushed on `pagehide`/hidden. When another device saved first the SDK refuses the write and emits `saveconflict`: the game reloads the cloud copy, merges and saves again. The merge never drops progress: journey stages won on either side (fewest moves kept), achievements and daily days unioned, the larger records (rounds played/won, best score) and best streak; the current streak, settings and in-progress state stay this device's. localStorage remains the offline cache. Never place credentials or private chat in saves.
- Settings → **Report a problem** (signed in only, from `game-options.js`) files a bug report through `StarHermit.reportBug` with a small non-personal `context.json` (viewport, language, FPS cap, audio limit); uncaught errors are filed as crash reports through `StarHermit.captureCrashes` (SDK-capped).

### Discovery, activity, and social layer
- Entitlement or catalog state belongs to host-owned chrome; the game stays playable without promotional interruption. No launch-activity calls are made.
- The hosted lobby has a friends picker (`StarHermit.friends()`, online friends marked ●) that sends realtime-room invitations, and the Hosted Play screen polls the room-invite inbox (every 5 s) with join buttons, rebuilt only when the invites or the language change so a poll never swallows a Join press. The title's invite link covers friends who are not yet connected.
- There is no in-game text chat or voice: realtime rooms carry no chat conversation for launch tokens, and core rules never need it.

### Achievements and leaderboards
- Declare a small static achievement set: first completion, mechanic mastery, a sustained streak, a difficult content milestone, and an accessibility-neutral long-term goal. Keys are stable, lowercase identifiers; unlocks are idempotent.
- One platform board, `high-score` (integer, higher is better, 0–10,000). When signed in, every finished solo round except Learn posts the player's round score (the winner's score when you win, 0 otherwise) through `StarHermit.submitScores` (a practice session whose `score-script.js` posts it), and the results screen shows "Leaderboard rank: #N" (or posted / not posted), localized in the nine locales (`platform.js`). Hosted tables and standalone play post nothing.
- Records shows the caller's platform stats from `StarHermit.getGame()` and the `high-score` board (`StarHermit.leaderboard('high-score')`, nicknames resolved via profiles) when one exists.
- Hosted outcomes are authoritative from the table host (validated turn order, hidden hands never leave the host). Achievement unlocks are local and ride the cloud-saved document; hosted results are not posted to the leaderboard.

### Sessions and transport
- Without a platform game script there are no platform sessions, matchmaking, practice-vs-House or replays; solo modes run against local deterministic AI.
- On-platform hosted tables use StarHermit realtime rooms: the host client runs the deterministic engine, guests send whitelisted command messages over the room binary channel, out-of-turn/malformed input is rejected by the host, and the host reports the result through the rooms result endpoint. Reconnect renews the launch token first (`StarHermit.renewForReconnect()`: a transient failure backs off 1/2/4/8/15 s without reopening the old URL, a refusal stops and shows the session-expired notice, `terms-required` stops like auth loss and shows "StarHermit needs you to accept its updated terms before you can play online." with **Back to StarHermit**, and running out of retries ends the loop with a visible "online tables are unavailable right now" line), then calls `GET /rooms/mine` (404/410 means no table to return to; any other failure ends the loop with the same visible unavailable line) and opens the socket with a URL built from the fresh token; snapshots are the state source of truth. A table socket that drops mid-game is not reopened automatically (by design: rejoin from Hosted Play); one refused before it ever opened asks the SDK why (`renewForReconnect`) and shows the terms banner, the session-expired notice, or "Couldn't connect to the table." The SDK's `termsrequired` event (e.g. from a background renewal) stops online play the same way. Room REST calls and the `/ws/v1/realtime` socket URL go through the SDK (`StarHermit.api`, `StarHermit.realtime.socketUrl`).

### Publishing and operations
- `server.js` is the local development host only (static files + its own `/ws` tables for `npm start`); it is not a platform game script. `starhermit.txt` declares `server=score-script.js` (canonical copy in the games repo's `tools/score-script.js`), which only range-checks and posts solo scores. On-platform hosting is host-routed realtime rooms; no initial design here requires a sandboxed script or container.
- Define control defaults, achievement metadata, and versioned settings before release. Publish immutable build assets, verify the launch path, maintain migration tests for saves, and expose no secret configuration to the client.
- Capture anonymous funnel events only for start, tutorial step, round end, retry, settings change, and error category. Avoid raw text, precise personal data, and cross-title tracking.

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- Test pointer, coarse touch, keyboard-only, gamepad, screen reader, zoom to 200%, reduced motion, high contrast, safe areas, and both mobile orientations.
- Verify focus restoration after every modal, meaningful live announcements, no keyboard traps, and no hover-only instructions.
- Confirm all critical labels fit translated strings at 30% expansion and support right-to-left layout where localized.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Platform and network

- Test expired/rotated tokens, privacy settings, rate limits, offline start, reconnect at each game state, duplicate commands, out-of-order events, server restart, and version mismatch.
- Verify achievement idempotency, leaderboard validation, friends-only filtering, cloud-save conflict handling, activity start/end pairing, and server-time countdown accuracy.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.

## Browser interference

`browser-guard.js` (loaded from `index.html`) suppresses browser UI that gets in the way of play: the right-click context menu, the iOS long-press callout, copy / cut / paste, and page text selection. Text fields (inputs, textareas, selects, contenteditable) keep normal selection, context menu and clipboard behaviour.


## Sound and frame-rate options

The options panel includes Sound controls for master, music, effects and UI volume, a mute that preserves volume levels, and an Auto or manual concurrent-sound limit (1–64). Changes apply immediately with perceptual volume curves. A shared allocator bounds Web Audio and media playback, including loops and scheduled sources. Graphics includes Auto display refresh or a custom maximum frame rate from 1–1000 FPS; rendering is paced independently of simulation and input. Preferences persist locally, with FPS stored per detected GPU, and reconcile with Starhermit settings when signed in. The controls support keyboard and touch input and the supported English, Spanish, German, French, Portuguese and Italian locales.
