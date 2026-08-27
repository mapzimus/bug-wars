/* ============================================================================
   Bug Wars — CLAUDE.md
   ----------------------------------------------------------------------------
   Guide for agents working on this turn-based strategy game.
   ========================================================================== */

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
- Headless smoke: `node tools/headless-smoke.js` (if present) or load scripts in `node -e` with a
  fake `window`.

## Architecture (no build step, no framework)
Classic `<script>` tags load in order (**config → world → systems → ai → input → render → ui →
sound → main**), all hanging off one global `BW` object. Entities are **plain objects with a `kind`
field — no class hierarchy.**
- `config.js` — **ALL tuning knobs** (unit stats, costs, map, turn rules, upgrades, colors).
- `world.js` — `BW.state` + factories + **grid helpers** (`toTile` / `tileCenter` / `snapXY`).
- `systems.js` — turn actions (`actMove` / `actAttack` / `actGather`), `endTurn`, train/build/upgrade.
- `ai.js` — `BW.ai.takeTurn(team)` plans one full colony turn (eco, raid, defend, research).
- `input.js` — tap-to-order + multi-select group orders + drag-to-pan, End Turn.
- `render.js` — canvas drawing + move/attack range overlays. **Never mutates state.**
- `main.js` — rAF loop for camera/draw; sim advances on turns, not every frame.

## Turn rules (v6)
- Grid (`config.turns.tile` px). Units snap to tile centers.
- Each unit gets **one action** per turn: move, move+attack, or assign gather.
- **Roles differ:** skirmishers move 4 / range 2; siege move 2; flyers move 5–6 and ignore walls.
- Gatherers harvest at **turn start** while adjacent. Granaries boost nearby harvest; Honeydew
  piles do **not** regen. Captured **outposts** pay income each turn.
- Honeydew buys **colony upgrades** (`config.UPGRADES` + faction signatures).
- Training uses **turns** (`ceil(buildTime / trainDivisor)`), not seconds.
- Towers fire once (or more with Iron Shell) at turn start; prioritize siege → flyer → workers.
- Venom is flat `venom.dmg` per victim turn (not legacy dps×3).
- `BW.endTurn()` → rival `beginTurn` → AI `takeTurn` (if AI) → back to player.
- **Maps:** `garden` (large) or `skirmish` (phone-friendly, default on menu).

## Conventions / gotchas
- Keep the split: **data (world) / behavior (systems) / draw (render)**.
- Headless test: `BW.world.initWorld('normal'); BW.startMatch();` then call `BW.systems.actMove` /
  `BW.endTurn` and read `BW.state`.
- Windows git warns `LF will be replaced by CRLF` on commit — harmless.
- Do **not** flatten `move` / `atkTiles` with a floor that makes every unit identical.

## Design lesson from v1 (still true)
v1 was unfun: unfair AI, no instructions, and over-automation that removed agency. **Rule: automate
the *tedium*, never the *decisions*.** Turn-based mobile keeps the decisions and drops the APM tax.
