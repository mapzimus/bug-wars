# Bug Wars — guide for Claude

**What this is:** A browser real-time strategy game (4 insect factions — Ants/Bees/Beetles/Spiders)
the user builds **for fun**. It lives in **its own standalone repo `mapzimus/bug-wars`** (files at the
repo ROOT) and deploys to its **own site `mapzimus.github.io/bug-wars`**. It is linked from the
portfolio's "Beyond GIS" page (`maxwellhowegis.com/side-projects.html`) as an EXTERNAL link — it is a
just-for-fun project, not a GIS portfolio card. (It used to live at `maxwellhowegis.com/bugwars`
inside the portfolio repo; that copy was removed on 2026-06-14 when it moved here.)

**The vision (what the user actually wants):** the real strategic juggle — **economy + attack +
defense + diplomacy**, balanced against a fair, beatable-but-challenging opponent. Depth and *skill*.
NOT a simplified or auto-played game. The fun is managing many things at once. (Avoid the
"Age-of-Empires" label in any user-facing copy — call it a real-time strategy game.)

## Run & test
- Plain static HTML/CSS/JS at the repo root. Deploys via **GitHub Pages on push to `main`** (source =
  `main` / root). A push goes live at **`mapzimus.github.io/bug-wars`** in ~1 min. **Push ONCE** — this
  is the only copy now (no more portfolio mirror).
- Local dev: `python -m http.server` in this folder (or the `bugwars` entry in `~/.claude/launch.json`,
  port 8765). **Gotcha:** that local server runs in Claude's sandbox and is **NOT reachable from the
  user's real browser** at localhost. Headless-test via the `Claude_Preview` MCP (cache-bust each JS
  file with `fetch(f,{cache:'reload'})` then `location.reload()` — the dev server caches aggressively).
- To see/drive the running game in the user's browser: navigate to `https://mapzimus.github.io/bug-wars/`.

## Architecture (no build step, no framework)
Classic `<script>` tags load in order (**config → world → systems → ai → input → render → main**), all
hanging off one global `BW` object. Entities are **plain objects with a `kind` field — no class
hierarchy.**
- `config.js` — **ALL tuning knobs** (unit stats, costs, map, AI timings, colors, `gameSpeed`). The single
  balance surface; edit here first.
- `world.js` — `BW.state` + entity factories (`createUnit`/`createBuilding`/`createFood`) + `byId`/`removeDead`.
- `systems.js` — per-frame behavior: movement+separation, gather, combat, training, win/lose.
- `ai.js` — enemy controller.
- `input.js` — selection, box-select, right-click orders, build panel, hotkeys.
- `render.js` — all canvas drawing (drawn vector bugs). **Never mutates state.**
- `main.js` — fixed-timestep loop; calls `BW.update(dt * gameSpeed)`.

## Conventions / gotchas
- Keep the split: **data (world) / behavior (systems) / draw (render)**. render.js is read-only over state.
- Fixed timestep → you can **test logic headlessly**: set `BW.state.paused = true` and call `BW.update(1/60)`
  in a loop, then read `BW.state`.
- **rAF pauses in hidden/background tabs.** A backgrounded preview shows 0 sim-time elapsed — that is NOT a
  bug. Confirm by driving `update()` manually, or test in a foreground tab.
- The `Claude_Preview` screenshot tool tends to time out on the live animating canvas; prefer reading state
  via `eval`, or screenshot through a foreground browser (Claude-in-Chrome).
- Windows git warns `LF will be replaced by CRLF` on commit — harmless.

## Design lesson from v1 (read before changing gameplay)
v1 shipped but the user found it unfun: **unfair AI, no instructions, no timer, and over-automation that
removed agency** ("no skill / no way to gather food" — because workers auto-gathered with no player
input). **Rule: automate the *tedium*, never the *decisions*.** The player must drive economy choices
(what to gather, what to build, when to fight). Rebuild aims at the AoE-depth vision above.
