/* ============================================================================
   Bug Wars — config.js   (v4: big maps, four factions)
   ----------------------------------------------------------------------------
   THE TUNING FILE. Every balance knob lives here as plain data the rest of the
   game reads at runtime. Change a number, reload, watch the game change.

   v4 adds: a world larger than the screen (the `view` is a camera into it),
   minimap + camera tuning, two new factions (Beetles, Spiders), and a wall /
   pacing rebalance for longer, more strategic games.
   ========================================================================== */

window.BW = window.BW || {};

BW.config = {

  /* ---- The battlefield ------------------------------------------------- */
  world: { width: 2560, height: 1440 },   // the MAP (4x the old area)
  view:  { width: 1280, height: 720 },    // the CANVAS — a camera window into the world
  camera: {
    edgeSize: 24,        // px from the canvas edge that triggers edge-scrolling
    edgeSpeed: 820,      // px/s while edge-scrolling (gentler = more controllable)
    keySpeed: 1100,      // px/s for WASD / arrow keys
  },
  minimap: { w: 200, margin: 12 },        // bottom-right; height follows world aspect

  gameSpeed: 0.6,            // master tempo (1 = old "normal"). Lower = calmer.
                            // Live-adjustable in-game with the Speed −/+ controls
                            // (or [ and ] keys). Scales the whole sim uniformly —
                            // movement, combat, gather, training AND the AI's
                            // attack timing all stretch together, balance intact.

  /* ---- Economy --------------------------------------------------------- */
  // Each side starts with this. Food trains units; Mud builds structures;
  // Honeydew is scarce and buys elite units / (later) upgrades.
  startingResources: { food: 200, mud: 150, honeydew: 0 },
  popCap: 80,                 // bumped for the bigger map + longer games (room for real armies)
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
     trainedAt = which building kind produces it. flying:true = ignores rocks
     and walls when moving (it does NOT make a unit unhittable).
     -------------------------------------------------------------------- */
  UNIT_STATS: {
    // ---- Ants: the balanced baseline faction ----
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

    // ---- Bees: mobile + the hornet flyer ----
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

    // ---- Beetles (faction #3): slow, heavy, expensive — the armor faction ----
    grub: {
      class: 'worker', hp: 60, speed: 70, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6.5, buildTime: 4.5, color: '#9a8a6a',
      cost: { food: 50 }, trainedAt: 'mound',
    },
    bruiser: {
      class: 'infantry', hp: 215, speed: 50, damage: 14, range: 15, cooldown: 1.1,
      aggro: 140, radius: 10, buildTime: 7.5, color: '#6e5a40',
      cost: { food: 85, mud: 15 }, trainedAt: 'den',
    },
    bombardier: {
      class: 'skirmisher', hp: 85, speed: 96, damage: 8, range: 14, cooldown: 0.6,
      aggro: 165, radius: 7.5, buildTime: 5.5, color: '#b06a2a',
      cost: { food: 65, mud: 5 }, trainedAt: 'den',
      venom: { dps: 8, duration: 3 },
    },
    ram: {
      class: 'siege', hp: 175, speed: 38, damage: 12, range: 16, cooldown: 1.3,
      aggro: 105, radius: 10, buildTime: 8.5, color: '#55483a',
      cost: { food: 80, mud: 25, honeydew: 25 }, trainedAt: 'burrow',
    },

    // ---- Spiders (faction #4): fast, fragile, venomous — the raid faction ----
    spiderling: {
      class: 'worker', hp: 42, speed: 92, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6, buildTime: 3.5, color: '#b9a7d0',
      cost: { food: 50 }, trainedAt: 'lair',
    },
    hunter: {
      class: 'infantry', hp: 125, speed: 78, damage: 11, range: 14, cooldown: 0.85,
      aggro: 155, radius: 8.5, buildTime: 5.5, color: '#7a668e',
      cost: { food: 70, mud: 10 }, trainedAt: 'nursery',
    },
    spitter: {
      class: 'skirmisher', hp: 60, speed: 128, damage: 8, range: 13, cooldown: 0.5,
      aggro: 175, radius: 7, buildTime: 4.5, color: '#a050b4',
      cost: { food: 60, mud: 5 }, trainedAt: 'nursery',
      venom: { dps: 10, duration: 3 },
    },
    weaver: {
      class: 'siege', hp: 112, speed: 50, damage: 10, range: 16, cooldown: 1.15,
      aggro: 110, radius: 9, buildTime: 6.5, color: '#5a4a6e',
      cost: { food: 70, mud: 20, honeydew: 25 }, trainedAt: 'spinnery',
    },
    balloonist: {
      class: 'flyer', flying: true, hp: 78, speed: 138, damage: 10, range: 14, cooldown: 0.8,
      aggro: 165, radius: 7.5, buildTime: 7, color: '#c79ae0',
      cost: { food: 75, honeydew: 20 }, trainedAt: 'spinnery',   // rides silk threads over walls
    },
  },

  /* ---- Buildings --------------------------------------------------------
     category: nest | production | storage | defense
     trains[]  → a production building (has a train queue + rally point)
     drop:true → workers can drop resources here (bases + granary)
     damage/range/cooldown/aggro → a defensive tower that fires
     blocks:true → a wall (units path around it; siege chews through it)
     v4: base/production HP up so games breathe; walls are real fortifications.
     -------------------------------------------------------------------- */
  BUILDING_STATS: {
    // shared
    granary:  { category: 'storage',    hp: 500,  radius: 20, cost: { mud: 70 },                                       drop: true,  color: '#8a7a4a' },
    tower:    { category: 'defense',    hp: 950,  radius: 18, cost: { mud: 140 },     damage: 16, range: 130, cooldown: 1.0, aggro: 150, color: '#6b6b78' },
    wall:     { category: 'defense',    hp: 1100, radius: 15, cost: { mud: 20 },      blocks: true,                                color: '#7d7d88' },
    // ants
    nest:     { category: 'nest',       hp: 2200, radius: 34, cost: {},               trains: ['worker'],              drop: true,  color: '#6b4a2f' },
    barracks: { category: 'production', hp: 850,  radius: 24, cost: { mud: 120 },     trains: ['soldier', 'fireant'],              color: '#7a5a3a' },
    workshop: { category: 'production', hp: 850,  radius: 24, cost: { mud: 160 },     trains: ['leafcutter'],                      color: '#5a6a3a' },
    // bees
    hive:     { category: 'nest',       hp: 2200, radius: 34, cost: {},               trains: ['drone'],               drop: true,  color: '#7a5c1f' },
    brood:    { category: 'production', hp: 850,  radius: 24, cost: { mud: 120 },     trains: ['guard', 'striker'],                color: '#8a6a22' },
    apiary:   { category: 'production', hp: 850,  radius: 24, cost: { mud: 160 },     trains: ['carpenter', 'hornet'],             color: '#9a7520' },
    // beetles (tougher structures — the armor faction)
    mound:    { category: 'nest',       hp: 2500, radius: 34, cost: {},               trains: ['grub'],                drop: true,  color: '#5a4632' },
    den:      { category: 'production', hp: 950,  radius: 24, cost: { mud: 130 },     trains: ['bruiser', 'bombardier'],           color: '#6a5644' },
    burrow:   { category: 'production', hp: 950,  radius: 24, cost: { mud: 170 },     trains: ['ram'],                             color: '#4f463c' },
    // spiders (lighter structures — the raid faction)
    lair:     { category: 'nest',       hp: 2000, radius: 34, cost: {},               trains: ['spiderling'],          drop: true,  color: '#4a3c5a' },
    nursery:  { category: 'production', hp: 750,  radius: 24, cost: { mud: 120 },     trains: ['hunter', 'spitter'],               color: '#5d4a72' },
    spinnery: { category: 'production', hp: 750,  radius: 24, cost: { mud: 160 },     trains: ['weaver', 'balloonist'],            color: '#6e5a86' },
  },

  // Walls shrug off non-siege hits: anything that isn't siege-class deals this
  // fraction of its damage to a blocking wall. Siege keeps its full 4x building
  // bonus — bring rams/leafcutters (or fly over) to crack a fortified line.
  wallResist: 0.4,

  /* ---- Factions ---------------------------------------------------------
     Each side belongs to a faction. The faction maps generic ROLES to its
     own unit/building kinds, so the engine, AI and UI stay faction-agnostic.
     style drives how render.js draws the bugs (legs/wings/body shape).
     -------------------------------------------------------------------- */
  FACTIONS: {
    ants: {
      name: 'Ants', emoji: '🐜', style: 'ant', base: 'nest', gatherer: 'worker',
      producers: ['barracks', 'workshop'],
      buildMenu: ['barracks', 'workshop', 'granary', 'tower', 'wall'],
      trainMenu: ['worker', 'soldier', 'fireant', 'leafcutter'],
      aiBuildOrder: ['barracks', 'workshop', 'tower'],
      army: { frontline: 'soldier', skirmisher: 'fireant', siege: 'leafcutter', flyer: null },
    },
    bees: {
      name: 'Bees', emoji: '🐝', style: 'bee', base: 'hive', gatherer: 'drone',
      producers: ['brood', 'apiary'],
      buildMenu: ['brood', 'apiary', 'granary', 'tower', 'wall'],
      trainMenu: ['drone', 'guard', 'striker', 'carpenter', 'hornet'],
      aiBuildOrder: ['brood', 'apiary', 'tower'],
      army: { frontline: 'guard', skirmisher: 'striker', siege: 'carpenter', flyer: 'hornet' },
    },
    beetles: {
      name: 'Beetles', emoji: '🐞', style: 'beetle', base: 'mound', gatherer: 'grub',
      producers: ['den', 'burrow'],
      buildMenu: ['den', 'burrow', 'granary', 'tower', 'wall'],
      trainMenu: ['grub', 'bruiser', 'bombardier', 'ram'],
      aiBuildOrder: ['den', 'burrow', 'tower'],
      army: { frontline: 'bruiser', skirmisher: 'bombardier', siege: 'ram', flyer: null },
    },
    spiders: {
      name: 'Spiders', emoji: '🕷️', style: 'spider', base: 'lair', gatherer: 'spiderling',
      producers: ['nursery', 'spinnery'],
      buildMenu: ['nursery', 'spinnery', 'granary', 'tower', 'wall'],
      trainMenu: ['spiderling', 'hunter', 'spitter', 'weaver', 'balloonist'],
      aiBuildOrder: ['nursery', 'spinnery', 'tower'],
      army: { frontline: 'hunter', skirmisher: 'spitter', siege: 'weaver', flyer: 'balloonist' },
    },
  },

  /* ---- Counters (rock-paper-scissors) ---------------------------------
     LEARNING SPOT: attackerClass → { targetClass: damageMultiplier }.
     Unlisted pairs = 1.0. Edit these to reshape every matchup.
       infantry  beats skirmisher
       skirmisher beats siege (and is the anti-air)
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
     v4: longer graces + bigger waves = longer, more deliberate games.
     -------------------------------------------------------------------- */
  difficulties: {
    easy:   { workerTarget: 8,  armyThreshold: 6,  thinkEvery: 1.6, ecoMult: 1.0,  grace: 120 },
    normal: { workerTarget: 12, armyThreshold: 9,  thinkEvery: 1.1, ecoMult: 1.0,  grace: 90  },
    hard:   { workerTarget: 16, armyThreshold: 13, thinkEvery: 0.8, ecoMult: 1.12, grace: 60  },
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
