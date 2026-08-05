# Bug Wars — guide for Claude

**What this is:** A browser **turn-based strategy** game (4 insect factions — Ants/Bees/Beetles/Spiders)
the user builds **for fun**. It lives in **its own standalone repo `mapzimus/bug-wars`** (files at the
repo ROOT) and deploys to its **own site `mapzimus.github.io/bug-wars`**. It is linked from the
portfolio's "Beyond GIS" page (`maxwellhowegis.com/side-projects.html`) as an EXTERNAL link — it is a
just-for-fun project, not a GIS portfolio card.

**The vision (what the user actually wants):** the real strategic juggle — **economy + attack +
defense**, balanced against a fair, beatable-but-challenging opponent. Depth and *skill*, playable
on mobile without APM. Colony turns (Advance Wars–style): each unit acts once, then End Turn.
NOT a simplified auto-play toy — the player still drives economy choices (what to gather, what to
build, when to fight). Automate the *tedium*, never the *decisions*.

## Run & test
- Plain static HTML/CSS/JS at the repo root. Deploys via **GitHub Pages on push to `main`** (source =
  `main` / root). A push goes live at **`mapzimus.github.io/bug-wars`** in ~1 min.
- Local dev: `python -m http.server` in this folder (port 8765).
- To see/drive the running game: navigate to `https://mapzimus.github.io/bug-wars/`.

## Architecture (no build step, no framework)
Classic `<script>` tags load in order (**config → world → systems → ai → input → render → ui →
sound → main**), all hanging off one global `BW` object. Entities are **plain objects with a `kind`
field — no class hierarchy.**
- `config.js` — **ALL tuning knobs** (unit stats, costs, map, turn rules, colors). Balance surface.
- `world.js` — `BW.state` + factories + **grid helpers** (`toTile` / `tileCenter` / `snapXY`).
- `systems.js` — turn actions (`actMove` / `actAttack` / `actGather`), `endTurn`, train/build.
- `ai.js` — `BW.ai.takeTurn(team)` plans one full colony turn.
- `input.js` — tap-to-order + drag-to-pan (touch + mouse), End Turn.
- `render.js` — canvas drawing + move/attack range overlays. **Never mutates state.**
- `main.js` — rAF loop for camera/draw; sim advances on turns, not every frame.

## Turn rules (v5)
- Grid (`config.turns.tile` px). Units snap to tile centers.
- Each unit gets **one action** per turn: move, move+attack, or assign gather.
- Gatherers harvest at **turn start** while adjacent to a node (no carry trips).
- Training uses **turns** (`ceil(buildTime / trainDivisor)`), not seconds.
- Towers fire once at the start of their side's turn. Venom ticks on the victim's turn start.
- `BW.endTurn()` → rival `beginTurn` → AI `takeTurn` (if AI) → back to player.
- **Maps:** `garden` (large) or `skirmish` (phone-friendly, default on menu).
- **Feel:** move lerp, floating damage/harvest text, pinch/wheel zoom, Next-ready cycling,
  enemy-turn camera follow, stepped AI actions.

## Conventions / gotchas
- Keep the split: **data (world) / behavior (systems) / draw (render)**.
- Headless test: `BW.world.initWorld('normal'); BW.startMatch();` then call `BW.systems.actMove` /
  `BW.endTurn` and read `BW.state`.
- Windows git warns `LF will be replaced by CRLF` on commit — harmless.

## Design lesson from v1 (still true)
v1 was unfun: unfair AI, no instructions, and over-automation that removed agency. **Rule: automate
the *tedium*, never the *decisions*.** Turn-based mobile keeps the decisions and drops the APM tax.
