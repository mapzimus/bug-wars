# Bug Wars — guide for Claude

**What this is:** A browser real-time strategy game (4 insect factions — Ants/Bees/Beetles/Spiders)
the user builds **for fun**. It lives in **its own standalone repo `mapzimus/bug-wars`** (files at the
repo ROOT).

**Where it's hosted:** **`mapzimus.com/bug-wars`**. The apex `mapzimus.com` is owned by the
`mapzimus/mapzimus.github.io` user-site repo (which holds the `CNAME`); because a GitHub Pages *user
site* has a custom domain, every *project* repo automatically serves at `<domain>/<repo-name>`. So
**bug-wars needs no CNAME of its own** — do not add one, it would claim the apex for this repo.
`mapzimus.github.io/bug-wars` keeps working as an alias. It is linked from the portfolio's "Beyond
GIS" page (`maxwellhowegis.com/side-projects.html`) as an EXTERNAL link — a just-for-fun project, not
a GIS portfolio card. (History: it used to live at `maxwellhowegis.com/bugwars` inside the portfolio
repo; it moved out on 2026-06-14, and off the maxwellhowegis domain entirely on 2026-07-26.)

**The vision (what the user actually wants):** the real strategic juggle — **economy + attack +
defense + diplomacy**, balanced against a fair, beatable-but-challenging opponent. Depth and *skill*.
NOT a simplified or auto-played game. The fun is managing many things at once. (Avoid the
"Age-of-Empires" label in any user-facing copy — call it a real-time strategy game.)

## Run & test
- Plain static HTML/CSS/JS at the repo root. Deploys via **GitHub Pages on push to `main`** (source =
  `main` / root). A push goes live in ~1 min. **Push ONCE** — this is the only copy now.
- Local dev: `python -m http.server` in this folder. **Gotcha:** that local server runs in Claude's
  sandbox and is **NOT reachable from the user's real browser** at localhost.
- **Headless logic tests (fast, no DOM):** `config.js`, `world.js`, `pathfinding.js`, `systems.js` and
  `ai.js` have no DOM dependencies — load them into a node `vm` context with `window = sandbox` and
  call `BW.update(1/60)` in a loop. This is how the balance tournament runs; use it before touching stats.
- **Full-stack tests:** Chromium + Playwright are preinstalled
  (`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`). Serve the folder and drive
  the real page — the only way to catch render/input/CSS regressions.
  **When synthesising clicks, add `canvas.getBoundingClientRect()` left/top** — `page.mouse` takes
  viewport coordinates and the canvas sits below the topbar. Getting this wrong misses silently and
  looks like a game bug.

## Architecture (no build step, no framework)
Classic `<script>` tags load in order (**config → world → pathfinding → systems → ai → input → render
→ ui → sound → main**), all hanging off one global `BW` object. Entities are **plain objects with a
`kind` field — no class hierarchy.**
- `config.js` — **ALL tuning knobs** (unit stats, costs, map, AI timings, colors, `gameSpeed`,
  `UPGRADES`, `zoom`, `pathfinding`). The single balance surface; edit here first.
- `world.js` — `BW.state` + entity factories (`createUnit`/`createBuilding`/`createFood`) + `byId`/`removeDead`.
- `pathfinding.js` — navigation grid + A* (`BW.path.find`). Call `BW.path.markDirty()` whenever the
  blocking set changes (wall built or destroyed); the grid is cached, not rebuilt per frame.
- `systems.js` — per-frame behavior: navigation, gather, combat, training, research, win/lose.
- `ai.js` — enemy controller (also drives the player seat in AI-vs-AI watch mode).
- `input.js` — selection, box-select, orders, camera + zoom, control groups, hotkeys, panel wiring.
- `render.js` — all canvas drawing (drawn vector bugs) + the FX layer. **Never mutates state.**
- `ui.js` — menu, tutorial, and the per-faction build/train/research panel.
- `main.js` — fixed-timestep loop; sizes the canvas; calls `BW.update(dt * gameSpeed)`.

## Conventions / gotchas
- Keep the split: **data (world) / behavior (systems) / draw (render)**. render.js is read-only over state.
- Fixed timestep → you can **test logic headlessly**: set `BW.state.paused = true` and call `BW.update(1/60)`
  in a loop, then read `BW.state`.
- **The canvas is responsive and zoomed.** `cfg.view` is in **CSS pixels** and tracks the stage box;
  the context is pre-scaled by `devicePixelRatio` in `main.js`. World→screen is
  `(world - camera) * zoom`. A `ResizeObserver` watches the stage — the footer changes height when the
  faction panel is rebuilt, and that shrinks the canvas with **no window resize event** (this silently
  clipped the minimap off the bottom until it was fixed).
- **HUD cards floating over the canvas must be `pointer-events:none`** (with `pointer-events:auto` on
  their buttons). The canvas is full-bleed, so an opaque overlay otherwise swallows clicks and
  box-drags on the map underneath — `.sel-panel` sat right on top of the player's base.
- **rAF pauses in hidden/background tabs.** A backgrounded preview shows 0 sim-time elapsed — that is NOT a
  bug. Confirm by driving `update()` manually, or test in a foreground tab.
- Windows git warns `LF will be replaced by CRLF` on commit — harmless.

## Design lessons (read before changing gameplay)
- **v1** shipped but the user found it unfun: **unfair AI, no instructions, no timer, and
  over-automation that removed agency** ("no skill / no way to gather food" — workers auto-gathered
  with no player input). **Rule: automate the *tedium*, never the *decisions*.** The player must drive
  the economy choices (what to gather, what to build, when to fight).
- **v4 → v5, the "it's just not fun at all" pass.** The diagnosis was **pacing and legibility**, not
  missing features:
  - Default `gameSpeed` was **0.6×** on a map 4× the screen, with a **90–120s** AI grace period. The
    opening was dead air. v5 runs at **1×**, a smaller world, ~25% faster units and shorter build
    times, and **30–65s** graces. Games now resolve in **3–7 minutes** instead of dragging.
  - Movement was **steering-only** — units ground against walls forever. Now A* (`pathfinding.js`).
  - No control groups, stances or queued orders; combat had **no visual feedback at all**.
  - Honeydew had nothing to buy. `UPGRADES` is now the sink the economy was always designed around.
- **Balance the factions with the headless tournament, not by eye.** v5's first stat pass looked
  reasonable on paper and Ants still won **12/12** AI-vs-AI, because "balanced baseline" had quietly
  made them strictly better than Bees on the ground. Run every matchup at every difficulty and look at
  the spread before shipping a stat change. Also check the AI actually *uses* a faction's identity —
  Bees and Spiders played like worse Ants until the flyer cap was raised above 2.
