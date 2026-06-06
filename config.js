/* ============================================================================
   Bug Wars — config.js   (v2: deep AoE-style)
   ----------------------------------------------------------------------------
   THE TUNING FILE. Every balance knob lives here as plain data the rest of the
   game reads at runtime. Change a number, reload, watch the game change.

   v2 adds: three resources, a buildings table, a unit-counter table, and AI
   difficulty profiles. Loads first; creates the global BW namespace.
   ========================================================================== */

window.BW = window.BW || {};

BW.config = {

  /* ---- The battlefield ------------------------------------------------- */
  world: { width: 1280, height: 720 },
  gameSpeed: 1.0,            // master tempo (1 = normal). Lower = calmer.

  /* ---- Economy --------------------------------------------------------- */
  // Each side starts with this. Food trains units; Mud builds structures;
  // Honeydew is scarce and buys elite units / (later) upgrades.
  startingResources: { food: 200, mud: 100, honeydew: 0 },
  popCap: 50,
  startingWorkers: 5,

  gather: {
    carryCap: 10,           // a worker hauls this much, then walks it home
    rate: { food: 9, mud: 7, honeydew: 5 },   // gathered per second, per resource
  },

  // Resource node types scattered on the map.
  resources: {
    food:     { amount: 240, radius: 10, color: '#b6d36b', label: 'Food' },
    mud:      { amount: 340, radius: 11, color: '#a07a4e', label: 'Mud'  },
    honeydew: { amount: 150, radius: 9,  color: '#ffd166', label: 'Honeydew' },
  },

  /* ---- Units: stats + costs + counter class ----------------------------
     class drives the COUNTERS table below. cost is a {resource: amount} object.
     trainedAt = which building kind produces it.
     -------------------------------------------------------------------- */
  UNIT_STATS: {
    worker: {
      class: 'worker', hp: 50, speed: 78, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6, buildTime: 4, color: '#caa46a',
      cost: { food: 50 }, trainedAt: 'nest',
    },
    soldier: {
      class: 'infantry', hp: 160, speed: 64, damage: 12, range: 15, cooldown: 1.0,
      aggro: 150, radius: 9, buildTime: 6, color: '#8a6b4a',
      cost: { food: 70, mud: 10 }, trainedAt: 'barracks',
    },
    fireant: {
      class: 'skirmisher', hp: 70, speed: 118, damage: 8, range: 13, cooldown: 0.55,
      aggro: 170, radius: 7, buildTime: 5, color: '#d9622b',
      cost: { food: 60, mud: 5 }, trainedAt: 'barracks',
      venom: { dps: 9, duration: 3 },
    },
    leafcutter: {
      class: 'siege', hp: 130, speed: 48, damage: 10, range: 16, cooldown: 1.2,
      aggro: 110, radius: 9, buildTime: 7, color: '#5f8a3a',
      cost: { food: 70, mud: 30 }, trainedAt: 'workshop',
    },
  },

  /* ---- Buildings: the GDD's five categories ---------------------------
     category: nest | production | storage | defense
     trains[]  → a production building (has a train queue + rally point)
     drop:true → workers can drop resources here (nest + granary)
     damage/range/cooldown/aggro → a defensive tower that fires
     blocks:true → a wall (units path around it; siege chews through it)
     -------------------------------------------------------------------- */
  BUILDING_STATS: {
    nest:     { category: 'nest',       hp: 1600, radius: 34, cost: {},               trains: ['worker'],              drop: true,  color: '#6b4a2f' },
    barracks: { category: 'production', hp: 700,  radius: 24, cost: { mud: 120 },     trains: ['soldier', 'fireant'],              color: '#7a5a3a' },
    workshop: { category: 'production', hp: 700,  radius: 24, cost: { mud: 160 },     trains: ['leafcutter'],                      color: '#5a6a3a' },
    granary:  { category: 'storage',    hp: 450,  radius: 20, cost: { mud: 70 },                                       drop: true,  color: '#8a7a4a' },
    tower:    { category: 'defense',    hp: 800,  radius: 18, cost: { mud: 140 },     damage: 16, range: 130, cooldown: 1.0, aggro: 150, color: '#6b6b78' },
    wall:     { category: 'defense',    hp: 650,  radius: 15, cost: { mud: 25 },      blocks: true,                                color: '#7d7d88' },
  },

  // Build menu order (which building buttons appear).
  BUILD_MENU: ['barracks', 'workshop', 'granary', 'tower', 'wall'],
  // Train menu order.
  TRAIN_MENU: ['worker', 'soldier', 'fireant', 'leafcutter'],

  /* ---- Counters (rock-paper-scissors) ---------------------------------
     LEARNING SPOT: attackerClass → { targetClass: damageMultiplier }.
     Unlisted pairs = 1.0. Edit these to reshape every matchup.
       infantry  beats skirmisher
       skirmisher beats siege
       siege     beats buildings (and is solid vs infantry)
     -------------------------------------------------------------------- */
  COUNTERS: {
    infantry:   { skirmisher: 1.6 },
    skirmisher: { siege: 1.6 },
    siege:      { building: 4.0, infantry: 1.4 },
    building:   {},     // towers have no bonus damage
    worker:     {},
  },

  /* ---- Enemy AI difficulty profiles -----------------------------------
     The AI plays by the SAME rules you do — it scales these parameters, it
     does not cheat. grace = seconds of peace before it can attack.
     -------------------------------------------------------------------- */
  difficulties: {
    easy:   { workerTarget: 6,  armyThreshold: 6,  buildDelay: 22, thinkEvery: 1.4, ecoMult: 1.0,  grace: 75 },
    normal: { workerTarget: 10, armyThreshold: 9,  buildDelay: 14, thinkEvery: 1.0, ecoMult: 1.0,  grace: 60 },
    hard:   { workerTarget: 14, armyThreshold: 12, buildDelay: 8,  thinkEvery: 0.8, ecoMult: 1.15, grace: 45 },
  },

  /* ---- Look & feel ----------------------------------------------------- */
  colors: {
    grass: '#4a7a52', grassPatch: '#427049', obstacle: '#6b7280',
    playerTint: '#87c3ff', enemyTint: '#fb7185',
    selection: '#ffe066', hpGood: '#86efac', hpBad: '#fb7185', venom: '#7CFF6B',
    ghostOk: 'rgba(135,195,255,0.35)', ghostBad: 'rgba(251,113,133,0.40)',
    alert: '#fb7185',
  },

  /* ---- Misc ------------------------------------------------------------ */
  separationRadius: 18,
  rallyOffset: 64,
  guardRange: 300,          // idle fighters defend enemies within this of their nest
};
