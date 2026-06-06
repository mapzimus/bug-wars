# Bug Wars — guide for Claude

**What this is:** A browser real-time strategy game (Age-of-Empires-style, ant theme) the user
builds **for fun**. It is **NOT a portfolio piece.** It lives at `maxwellhowegis.com/bugwars` but is
**deliberately unlinked** — no card in `../js/projects.js`, no nav link, reachable only by typing the
URL. **Do not add it back to the portfolio.**

**The vision (what the user actually wants):** the real AoE strategic juggle — **economy + attack +
defense + diplomacy**, balanced against a fair, beatable-but-challenging opponent. Depth and *skill*.
NOT a simplified or auto-played game. The fun is managing many things at once.

## Run & test
- Plain static HTML/CSS/JS in this folder. Deploys via **GitHub Pages on push to `main`** (repo root is
  `../`, workflow `../.github/workflows/pages.yml`, `CNAME` = maxwellhowegis.com). A push goes live in ~1 min.
- Local dev: `python -m http.server` in this folder (or the `bugwars` entry in `~/.claude/launch.json`,
  port 8765). **Gotcha:** that local server runs in Claude's sandbox and is **NOT reachable from the
  user's real browser** at localhost. To show the user, use the **live URL**.
- To see/drive the running game: connect via the **"Claude in Chrome" MCP** to the user's browser and
  navigate to `https://maxwellhowegis.com/bugwars/`.

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
