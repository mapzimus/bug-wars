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
  startingResources: { food: 200, mud: 150, honeydew: 0 },
  popCap: 50,
  startingWorkers: 5,

  gather: {
    carryCap: 10,           // a worker hauls this much, then walks it home
    rate: { food: 9, mud: 7, honeydew: 5 },   // gathered per second, per resource
  },

  // Resource node types scattered on the map.
  resources: {
    // Big piles + slow regen (per second) so the economy NEVER permanently
    // collapses — there's always a trickle to recover on. amount = starting/max.
    food:     { amount: 600, regen: 2.6, radius: 11, color: '#b6d36b', label: 'Food' },
    mud:      { amount: 700, regen: 1.6, radius: 12, color: '#a07a4e', label: 'Mud'  },
    honeydew: { amount: 380, regen: 1.0, radius: 10, color: '#ffd166', label: 'Honeydew' },
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
      cost: { food: 70, mud: 20, honeydew: 25 }, trainedAt: 'workshop',   // honeydew = the premium siege resource
    },

    // ---- Bees (faction #2): mirror the ant roles, plus a FLYER (hornet) ----
    drone: {
      class: 'worker', hp: 46, speed: 84, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6, buildTime: 4, color: '#e6c34d',
      cost: { food: 50 }, trainedAt: 'hive',
    },
    guard: {
      class: 'infantry', hp: 150, speed: 64, damage: 12, range: 15, cooldown: 1.0,
      aggro: 150, radius: 9, buildTime: 6, color: '#c79a2c',
      cost: { food: 70, mud: 10 }, trainedAt: 'brood',
    },
    striker: {
      class: 'skirmisher', hp: 66, speed: 122, damage: 8, range: 13, cooldown: 0.55,
      aggro: 170, radius: 7, buildTime: 5, color: '#e08a1e',
      cost: { food: 60, mud: 5 }, trainedAt: 'brood',
      venom: { dps: 9, duration: 3 },
    },
    carpenter: {
      class: 'siege', hp: 122, speed: 48, damage: 10, range: 16, cooldown: 1.2,
      aggro: 110, radius: 9, buildTime: 7, color: '#9a7326',
      cost: { food: 70, mud: 20, honeydew: 25 }, trainedAt: 'apiary',
    },
    hornet: {
      class: 'flyer', flying: true, hp: 95, speed: 128, damage: 11, range: 14, cooldown: 0.8,
      aggro: 165, radius: 8, buildTime: 7, color: '#d99520',
      cost: { food: 80, honeydew: 20 }, trainedAt: 'apiary',
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
    // ---- Bee buildings (faction #2). granary/tower/wall above are shared. ----
    hive:     { category: 'nest',       hp: 1600, radius: 34, cost: {},               trains: ['drone'],               drop: true,  color: '#7a5c1f' },
    brood:    { category: 'production', hp: 700,  radius: 24, cost: { mud: 120 },     trains: ['guard', 'striker'],                color: '#8a6a22' },
    apiary:   { category: 'production', hp: 700,  radius: 24, cost: { mud: 160 },     trains: ['carpenter', 'hornet'],             color: '#9a7520' },
  },

  // Build menu order (which building buttons appear).
  BUILD_MENU: ['barracks', 'workshop', 'granary', 'tower', 'wall'],
  // Train menu order.
  TRAIN_MENU: ['worker', 'soldier', 'fireant', 'leafcutter'],

  /* ---- Factions -------------------------------------------------------
     Each side belongs to a faction. The faction maps generic ROLES to its
     own unit/building kinds, so the engine, AI and UI stay faction-agnostic.
     -------------------------------------------------------------------- */
  FACTIONS: {
    ants: {
      name: 'Ants', emoji: '🐜', base: 'nest', gatherer: 'worker',
      producers: ['barracks', 'workshop'],
      buildMenu: ['barracks', 'workshop', 'granary', 'tower', 'wall'],
      trainMenu: ['worker', 'soldier', 'fireant', 'leafcutter'],
      aiBuildOrder: ['barracks', 'workshop', 'tower'],
      army: { frontline: 'soldier', skirmisher: 'fireant', siege: 'leafcutter', flyer: null },
    },
    bees: {
      name: 'Bees', emoji: '🐝', base: 'hive', gatherer: 'drone',
      producers: ['brood', 'apiary'],
      buildMenu: ['brood', 'apiary', 'granary', 'tower', 'wall'],
      trainMenu: ['drone', 'guard', 'striker', 'carpenter', 'hornet'],
      aiBuildOrder: ['brood', 'apiary', 'tower'],
      army: { frontline: 'guard', skirmisher: 'striker', siege: 'carpenter', flyer: 'hornet' },
    },
  },

  /* ---- Counters (rock-paper-scissors) ---------------------------------
     LEARNING SPOT: attackerClass → { targetClass: damageMultiplier }.
     Unlisted pairs = 1.0. Edit these to reshape every matchup.
       infantry  beats skirmisher
       skirmisher beats siege
       siege     beats buildings (and is solid vs infantry)
     -------------------------------------------------------------------- */
  COUNTERS: {
    infantry:   { skirmisher: 1.6 },
    skirmisher: { siege: 1.6, flyer: 1.6 },    // skirmishers are the anti-air
    siege:      { building: 4.0, infantry: 1.2 },
    flyer:      { siege: 1.6, worker: 1.4 },    // air harasses slow siege + raids gatherers
    building:   {},     // towers have no bonus damage (but DO hit flyers)
    worker:     {},
  },

  /* ---- Enemy AI difficulty profiles -----------------------------------
     The AI plays by the SAME rules you do — it scales these parameters, it
     does not cheat. grace = seconds of peace before it can attack.
     -------------------------------------------------------------------- */
  difficulties: {
    // grace = seconds before it can attack. Easy is deliberately a slow, small,
    // late opponent so a new player has lots of room to learn.
    easy:   { workerTarget: 8,  armyThreshold: 5,  thinkEvery: 1.6, ecoMult: 1.0,  grace: 105 },
    normal: { workerTarget: 12, armyThreshold: 8,  thinkEvery: 1.1, ecoMult: 1.0,  grace: 70  },
    hard:   { workerTarget: 16, armyThreshold: 11, thinkEvery: 0.8, ecoMult: 1.12, grace: 48  },
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
  guardRange: 300,           // idle fighters defend enemies within this of their nest
  emergencyWorkerTime: 16,   // 0 workers? the nest hatches a FREE one this often (anti-softlock)
  guardRadius: 95,           // idle soldiers hold a defensive ring this far from their nest
  guardHomeRange: 280,       // ...but only auto-return to guard when within this of the nest
};
