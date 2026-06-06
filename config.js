/* ============================================================================
   Bug Wars — config.js
   ----------------------------------------------------------------------------
   THE TUNING FILE. Every balance knob in the game lives here. Change a number,
   reload the page, and watch the game change. Nothing in here is "code logic"
   you can break — it's all data the rest of the game reads at runtime.

   This file runs first and creates the global "BW" namespace that every other
   file hangs things off of (we use plain <script> tags, no build step, so a
   shared global is how the files talk to each other).
   ========================================================================== */

window.BW = window.BW || {};

BW.config = {

  /* ---- The battlefield ------------------------------------------------- */
  world: {
    width: 1280,          // garden width  in world pixels
    height: 720,          // garden height in world pixels
  },

  /* ---- Economy --------------------------------------------------------- */
  startingFood: 150,      // food you begin with (higher = calmer opening)
  popCap: 40,             // max units you can field at once
  startingWorkers: 5,     // workers spawned at your nest on game start

  gather: {
    rate: 9,              // food harvested per second while a worker mines a node
    carryCap: 12,         // worker carries this much, then walks it home
                          //   (12 = fewer round-trips, so the steady economy buildup feels smoother)
  },

  /* ---- Unit stats: THE balance table ----------------------------------
     Each ant is just a row of numbers. The engine looks these up by "kind"
     every frame (BW.config.UNIT_STATS[kind]) — units never store their own
     stats, so this table is the single source of truth for balance.

       hp        health
       speed     world-pixels per second
       damage    damage per hit
       range     how close (px) it must be to hit
       cooldown  seconds between hits
       aggro     auto-attack enemies within this radius (0 = never auto-fight)
       radius    body size in px (also the click/collision size)
       cost      food to train
       buildTime seconds to train
       color     body fill (player tint is applied on top when drawn)
     -------------------------------------------------------------------- */
  UNIT_STATS: {
    worker: {
      hp: 45,  speed: 75, damage: 3,  range: 12, cooldown: 0.9,
      aggro: 0,                                  // workers never pick fights
      radius: 6,  cost: 50, buildTime: 4,  color: '#caa46a',
    },
    soldier: {
      hp: 150, speed: 62, damage: 11, range: 15, cooldown: 1.0,
      aggro: 150,
      radius: 9,  cost: 80, buildTime: 6,  color: '#8a6b4a',
    },
    fireant: {
      hp: 60,  speed: 115, damage: 7, range: 13, cooldown: 0.55,
      aggro: 170,
      radius: 7,  cost: 70, buildTime: 5,  color: '#d9622b',
      venom: { dps: 9, duration: 3 },            // damage-over-time it applies on hit
    },
    leafcutter: {
      hp: 120, speed: 46, damage: 9,  range: 16, cooldown: 1.2,
      aggro: 110,
      radius: 9,  cost: 90, buildTime: 7,  color: '#5f8a3a',
      buildingBonus: 4,                          // x4 damage vs buildings (siege)
    },
  },

  /* ---- Buildings ------------------------------------------------------- */
  nest: {
    hp: 1600,
    radius: 34,
  },

  /* ---- Food nodes ------------------------------------------------------ */
  food: {
    amount: 220,          // food in each crumb/aphid pile before it's depleted
    radius: 10,
  },

  /* ---- Enemy AI -------------------------------------------------------- */
  ai: {
    firstWaveDelay: 50,   // seconds of peace before the red colony's first attack
                          //   (raise this for an even gentler game)
    waveInterval: 50,     // seconds between waves after that
    // wave SIZE is computed in ai.js nextWave() (a learning-spot you can tweak)
  },

  /* ---- Look & feel ----------------------------------------------------- */
  colors: {
    grass:        '#4a7a52',   // garden field
    grassPatch:   '#427049',   // darker mottling
    obstacle:     '#6b7280',   // rocks
    food:         '#b6d36b',   // aphid/crumb green
    playerTint:   '#87c3ff',   // YOUR team accent (matches the website)
    enemyTint:    '#fb7185',   // enemy team accent
    nestPlayer:   '#6b4a2f',
    nestEnemy:    '#6b3030',
    selection:    '#ffe066',   // selection ring
    hpGood:       '#86efac',
    hpBad:        '#fb7185',
    venom:        '#7CFF6B',    // poison tint
  },

  /* ---- Misc ------------------------------------------------------------ */
  gameSpeed: 0.85,        // master tempo dial. 1.0 = normal, lower = calmer/slower.
                          //   Scales EVERYTHING (movement, gathering, combat, timers).
  separationRadius: 18,   // how hard units push apart so they don't stack
  rallyOffset: 60,        // how far in front of the nest new units appear
  guardRange: 280,        // idle fighters defend enemies within this range of their nest
};
