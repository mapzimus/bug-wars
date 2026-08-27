/* ============================================================================
   Bug Wars — config.js   (v6: strategy substance)
   ----------------------------------------------------------------------------
   THE TUNING FILE. Every balance knob lives here as plain data the rest of the
   game reads at runtime. Change a number, reload, watch the game change.

   v6: real mobility/range roles, scarce Honeydew tech, outposts, faction
   doctrines. Economy + attack + defense are the skillful juggle again.
   ========================================================================== */

window.BW = window.BW || {};

BW.config = {

  /* ---- The battlefield ------------------------------------------------- */
  maps: {
    garden:   { width: 2560, height: 1440 },
    skirmish: { width: 1472, height: 960 },
  },
  world: { width: 2560, height: 1440 },
  view:  { width: 1280, height: 720 },
  camera: {
    edgeSize: 24,
    edgeSpeed: 820,
    keySpeed: 1100,
    zoomMin: 0.55,
    zoomMax: 1.35,
    zoomStep: 0.08,
  },
  minimap: { w: 200, margin: 12 },

  /* ---- Turn-based rules ------------------------------------------------- */
  turns: {
    tile: 64,
    // Harvest is assignment-based but scarce — more workers = choice, not free snowball.
    harvest: { food: 18, mud: 14, honeydew: 10 },
    // Food/Mud trickle; Honeydew does NOT regen — mid control is a permanent prize.
    nodeRegen: { food: 5, mud: 3, honeydew: 0 },
    trainDivisor: 4,
    venomTurns: 2,
    towerShots: 1,
    moveAnim: 0.18,
    attackFlash: 0.28,
    floatLife: 0.85,
    aiStep: 110,
    // Granary: workers within this Manhattan distance get harvestBonus.
    granaryRadius: 4,
    harvestBonus: 1.4,
    // Captured outposts pay this each owning turn.
    outpostIncome: { food: 12, mud: 4 },
  },

  /* ---- Economy --------------------------------------------------------- */
  // Tighter open: Barracks (120 Mud) needs a turn or two of Mud gathering.
  startingResources: { food: 100, mud: 60, honeydew: 0 },
  popCap: 32,
  startingWorkers: 3,
  granaryPopBonus: 6,           // each granary raises pop cap
  outpostPopBonus: 4,

  resources: {
    food:     { amount: 420, radius: 14, color: '#b6d36b', label: 'Food' },
    mud:      { amount: 480, radius: 14, color: '#a07a4e', label: 'Mud'  },
    honeydew: { amount: 220, radius: 14, color: '#ffd166', label: 'Honeydew' },
  },

  /* ---- Units ------------------------------------------------------------
     move / atkTiles are authored (or derived below) so roles DIFFER:
       workers 3 · infantry 3 · skirmisher 4+range2 · siege 2 · flyer 5
     -------------------------------------------------------------------- */
  UNIT_STATS: {
    // ---- Ants ----
    worker: {
      class: 'worker', hp: 50, speed: 78, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6, buildTime: 4, color: '#caa46a',
      cost: { food: 45 }, trainedAt: 'nest',
      move: 3, atkTiles: 1,
    },
    soldier: {
      class: 'infantry', hp: 160, speed: 64, damage: 14, range: 15, cooldown: 1.0,
      aggro: 150, radius: 9, buildTime: 6, color: '#8a6b4a',
      cost: { food: 65, mud: 10 }, trainedAt: 'barracks',
      move: 4, atkTiles: 1,
    },
    fireant: {
      class: 'skirmisher', hp: 72, speed: 118, damage: 8, range: 90, cooldown: 0.55,
      aggro: 170, radius: 7, buildTime: 5, color: '#d9622b',
      cost: { food: 55, mud: 5 }, trainedAt: 'barracks',
      venom: { dmg: 6 },
      move: 4, atkTiles: 2,
    },
    leafcutter: {
      class: 'siege', hp: 130, speed: 48, damage: 12, range: 16, cooldown: 1.2,
      aggro: 110, radius: 9, buildTime: 7, color: '#5f8a3a',
      cost: { food: 60, mud: 20, honeydew: 20 }, trainedAt: 'workshop',
      move: 2, atkTiles: 1,
    },

    // ---- Bees ----
    drone: {
      class: 'worker', hp: 46, speed: 84, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6, buildTime: 4, color: '#e6c34d',
      cost: { food: 45 }, trainedAt: 'hive',
      move: 3, atkTiles: 1,
    },
    guard: {
      class: 'infantry', hp: 150, speed: 64, damage: 14, range: 15, cooldown: 1.0,
      aggro: 150, radius: 9, buildTime: 6, color: '#c79a2c',
      cost: { food: 65, mud: 10 }, trainedAt: 'brood',
      move: 4, atkTiles: 1,
    },
    striker: {
      class: 'skirmisher', hp: 66, speed: 122, damage: 8, range: 90, cooldown: 0.55,
      aggro: 170, radius: 7, buildTime: 5, color: '#e08a1e',
      cost: { food: 55, mud: 5 }, trainedAt: 'brood',
      venom: { dmg: 6 },
      move: 4, atkTiles: 2,
    },
    carpenter: {
      class: 'siege', hp: 122, speed: 48, damage: 12, range: 16, cooldown: 1.2,
      aggro: 110, radius: 9, buildTime: 7, color: '#9a7326',
      cost: { food: 60, mud: 20, honeydew: 20 }, trainedAt: 'apiary',
      move: 2, atkTiles: 1,
    },
    hornet: {
      class: 'flyer', flying: true, hp: 95, speed: 128, damage: 12, range: 70, cooldown: 0.8,
      aggro: 165, radius: 8, buildTime: 7, color: '#d99520',
      cost: { food: 70, honeydew: 18 }, trainedAt: 'apiary',
      move: 5, atkTiles: 1,
    },

    // ---- Beetles: slow / heavy ----
    grub: {
      class: 'worker', hp: 60, speed: 70, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6.5, buildTime: 4.5, color: '#9a8a6a',
      cost: { food: 45 }, trainedAt: 'mound',
      move: 3, atkTiles: 1,
    },
    bruiser: {
      class: 'infantry', hp: 220, speed: 50, damage: 16, range: 15, cooldown: 1.1,
      aggro: 140, radius: 10, buildTime: 7.5, color: '#6e5a40',
      cost: { food: 80, mud: 15 }, trainedAt: 'den',
      move: 3, atkTiles: 1,
    },
    bombardier: {
      class: 'skirmisher', hp: 88, speed: 96, damage: 9, range: 90, cooldown: 0.6,
      aggro: 165, radius: 7.5, buildTime: 5.5, color: '#b06a2a',
      cost: { food: 60, mud: 5 }, trainedAt: 'den',
      venom: { dmg: 5 },
      move: 3, atkTiles: 2,
    },
    ram: {
      class: 'siege', hp: 185, speed: 38, damage: 14, range: 16, cooldown: 1.3,
      aggro: 105, radius: 10, buildTime: 8.5, color: '#55483a',
      cost: { food: 75, mud: 25, honeydew: 20 }, trainedAt: 'burrow',
      move: 2, atkTiles: 1,
    },

    // ---- Spiders: fast / fragile / venom ----
    spiderling: {
      class: 'worker', hp: 42, speed: 92, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6, buildTime: 3.5, color: '#b9a7d0',
      cost: { food: 45 }, trainedAt: 'lair',
      move: 3, atkTiles: 1,
    },
    hunter: {
      class: 'infantry', hp: 125, speed: 78, damage: 13, range: 14, cooldown: 0.85,
      aggro: 155, radius: 8.5, buildTime: 5.5, color: '#7a668e',
      cost: { food: 60, mud: 10 }, trainedAt: 'nursery',
      move: 4, atkTiles: 1,
    },
    spitter: {
      class: 'skirmisher', hp: 58, speed: 128, damage: 7, range: 95, cooldown: 0.5,
      aggro: 175, radius: 7, buildTime: 4.5, color: '#a050b4',
      cost: { food: 55, mud: 5 }, trainedAt: 'nursery',
      venom: { dmg: 6 },
      move: 4, atkTiles: 2,
    },
    weaver: {
      class: 'siege', hp: 112, speed: 50, damage: 12, range: 16, cooldown: 1.15,
      aggro: 110, radius: 9, buildTime: 6.5, color: '#5a4a6e',
      cost: { food: 60, mud: 20, honeydew: 20 }, trainedAt: 'spinnery',
      move: 2, atkTiles: 1,
    },
    balloonist: {
      class: 'flyer', flying: true, hp: 78, speed: 138, damage: 11, range: 70, cooldown: 0.8,
      aggro: 165, radius: 7.5, buildTime: 7, color: '#c79ae0',
      cost: { food: 65, honeydew: 18 }, trainedAt: 'spinnery',
      move: 5, atkTiles: 1,
    },
  },

  /* ---- Buildings -------------------------------------------------------- */
  BUILDING_STATS: {
    granary:  { category: 'storage',    hp: 500,  radius: 20, cost: { mud: 70 },                                       drop: true,  color: '#8a7a4a' },
    tower:    { category: 'defense',    hp: 950,  radius: 18, cost: { mud: 110 },     damage: 18, range: 160, cooldown: 1.0, aggro: 150, color: '#6b6b78' },
    wall:     { category: 'defense',    hp: 1100, radius: 15, cost: { mud: 18 },      blocks: true,                                color: '#7d7d88' },
    // Neutral/capturable mid-map site. Captured when its HP hits 0 — flips team & heals.
    outpost:  { category: 'outpost',    hp: 400,  radius: 22, cost: {},               drop: true,  color: '#6a8a6e', capturable: true },
    // ants
    nest:     { category: 'nest',       hp: 900, radius: 34, cost: {},               trains: ['worker'],              drop: true,  color: '#6b4a2f' },
    barracks: { category: 'production', hp: 850,  radius: 24, cost: { mud: 110 },     trains: ['soldier', 'fireant'],              color: '#7a5a3a' },
    workshop: { category: 'production', hp: 850,  radius: 24, cost: { mud: 140 },     trains: ['leafcutter'],                      color: '#5a6a3a' },
    // bees
    hive:     { category: 'nest',       hp: 900, radius: 34, cost: {},               trains: ['drone'],               drop: true,  color: '#7a5c1f' },
    brood:    { category: 'production', hp: 850,  radius: 24, cost: { mud: 110 },     trains: ['guard', 'striker'],                color: '#8a6a22' },
    apiary:   { category: 'production', hp: 850,  radius: 24, cost: { mud: 140 },     trains: ['carpenter', 'hornet'],             color: '#9a7520' },
    // beetles
    mound:    { category: 'nest',       hp: 1100, radius: 34, cost: {},               trains: ['grub'],                drop: true,  color: '#5a4632' },
    den:      { category: 'production', hp: 950,  radius: 24, cost: { mud: 120 },     trains: ['bruiser', 'bombardier'],           color: '#6a5644' },
    burrow:   { category: 'production', hp: 950,  radius: 24, cost: { mud: 150 },     trains: ['ram'],                             color: '#4f463c' },
    // spiders
    lair:     { category: 'nest',       hp: 800, radius: 34, cost: {},               trains: ['spiderling'],          drop: true,  color: '#4a3c5a' },
    nursery:  { category: 'production', hp: 750,  radius: 24, cost: { mud: 110 },     trains: ['hunter', 'spitter'],               color: '#5d4a72' },
    spinnery: { category: 'production', hp: 750,  radius: 24, cost: { mud: 140 },     trains: ['weaver', 'balloonist'],            color: '#6e5a86' },
  },

  wallResist: 0.35,

  /* ---- Colony upgrades (Honeydew tech) ---------------------------------
     One research at a time via tryUpgrade. Effects stack into state.upgrades.
     -------------------------------------------------------------------- */
  UPGRADES: {
    mandibles: {
      name: 'Strong Mandibles', key: 'mandibles',
      desc: '+15% attack damage',
      cost: { honeydew: 35, food: 50 },
      effect: { damageMult: 1.15 },
    },
    chitin: {
      name: 'Thicker Chitin', key: 'chitin',
      desc: '−12% damage taken',
      cost: { honeydew: 35, mud: 40 },
      effect: { armor: 0.12 },
    },
    forage: {
      name: 'Deep Forage', key: 'forage',
      desc: '+30% harvest',
      cost: { honeydew: 30, food: 40 },
      effect: { harvestMult: 1.3 },
    },
    // Faction signatures (only shown for matching faction)
    tunnels: {
      name: 'Tunnel Network', key: 'tunnels', faction: 'ants',
      desc: 'Workers +1 move',
      cost: { honeydew: 40, mud: 30 },
      effect: { workerMove: 1 },
    },
    jelly: {
      name: 'Royal Jelly', key: 'jelly', faction: 'bees',
      desc: 'Flyers +1 move, +20 HP',
      cost: { honeydew: 40, food: 40 },
      effect: { flyerMove: 1, flyerHp: 20 },
    },
    ironshell: {
      name: 'Iron Shell', key: 'ironshell', faction: 'beetles',
      desc: 'Walls resist more · towers +1 shot',
      cost: { honeydew: 40, mud: 50 },
      effect: { wallResistBonus: 0.15, towerShots: 1 },
    },
    potent: {
      name: 'Potent Venom', key: 'potent', faction: 'spiders',
      desc: 'Venom lasts +1 turn · +3 dmg',
      cost: { honeydew: 40, food: 30 },
      effect: { venomTurns: 1, venomDmg: 3 },
    },
  },

  /* ---- Factions --------------------------------------------------------- */
  FACTIONS: {
    ants: {
      name: 'Ants', emoji: '🐜', style: 'ant', base: 'nest', gatherer: 'worker',
      blurb: 'Balanced eco. Strong forage & tunnels.',
      producers: ['barracks', 'workshop'],
      buildMenu: ['barracks', 'workshop', 'granary', 'tower', 'wall'],
      trainMenu: ['worker', 'soldier', 'fireant', 'leafcutter'],
      upgradeMenu: ['mandibles', 'chitin', 'forage', 'tunnels'],
      aiBuildOrder: ['barracks', 'workshop', 'tower', 'granary'],
      army: { frontline: 'soldier', skirmisher: 'fireant', siege: 'leafcutter', flyer: null },
      doctrine: { harvestMult: 1.12, armor: 0, venomTurns: 0 },
    },
    bees: {
      name: 'Bees', emoji: '🐝', style: 'bee', base: 'hive', gatherer: 'drone',
      blurb: 'Mobile air. Hornets ignore walls.',
      producers: ['brood', 'apiary'],
      buildMenu: ['brood', 'apiary', 'granary', 'tower', 'wall'],
      trainMenu: ['drone', 'guard', 'striker', 'carpenter', 'hornet'],
      upgradeMenu: ['mandibles', 'chitin', 'forage', 'jelly'],
      aiBuildOrder: ['brood', 'apiary', 'tower', 'granary'],
      army: { frontline: 'guard', skirmisher: 'striker', siege: 'carpenter', flyer: 'hornet' },
      doctrine: { harvestMult: 1.0, armor: 0, flyerMove: 0 },
    },
    beetles: {
      name: 'Beetles', emoji: '🐞', style: 'beetle', base: 'mound', gatherer: 'grub',
      blurb: 'Armor & walls. Slow but brutal.',
      producers: ['den', 'burrow'],
      buildMenu: ['den', 'burrow', 'granary', 'tower', 'wall'],
      trainMenu: ['grub', 'bruiser', 'bombardier', 'ram'],
      upgradeMenu: ['mandibles', 'chitin', 'forage', 'ironshell'],
      aiBuildOrder: ['den', 'burrow', 'tower', 'wall', 'granary'],
      army: { frontline: 'bruiser', skirmisher: 'bombardier', siege: 'ram', flyer: null },
      doctrine: { harvestMult: 1.0, armor: 0.08, wallResistBonus: 0.1 },
    },
    spiders: {
      name: 'Spiders', emoji: '🕷️', style: 'spider', base: 'lair', gatherer: 'spiderling',
      blurb: 'Raids & venom. Fast fragile strikes.',
      producers: ['nursery', 'spinnery'],
      buildMenu: ['nursery', 'spinnery', 'granary', 'tower', 'wall'],
      trainMenu: ['spiderling', 'hunter', 'spitter', 'weaver', 'balloonist'],
      upgradeMenu: ['mandibles', 'chitin', 'forage', 'potent'],
      aiBuildOrder: ['nursery', 'spinnery', 'tower', 'granary'],
      army: { frontline: 'hunter', skirmisher: 'spitter', siege: 'weaver', flyer: 'balloonist' },
      doctrine: { harvestMult: 1.0, armor: 0, venomDmg: 1 },
    },
  },

  /* ---- Counters -------------------------------------------------------- */
  COUNTERS: {
    infantry:   { skirmisher: 1.6, building: 2.0 },
    skirmisher: { siege: 1.6, flyer: 1.6 },
    siege:      { building: 4.0, infantry: 1.25 },
    flyer:      { siege: 1.6, worker: 1.5, building: 1.3 },
    building:   { flyer: 1.25 },
    worker:     {},
  },

  /* ---- Enemy AI -------------------------------------------------------- */
  difficulties: {
    easy:   { workerTarget: 5,  armyThreshold: 4,  ecoMult: 1.0,  graceTurns: 6, raidTurns: 8,  wallAt: 99, researchAt: 8, emergencyWorkers: true },
    normal: { workerTarget: 7,  armyThreshold: 5,  ecoMult: 1.0,  graceTurns: 4, raidTurns: 5,  wallAt: 7,  researchAt: 5, emergencyWorkers: true },
    hard:   { workerTarget: 8,  armyThreshold: 6,  ecoMult: 1.08, graceTurns: 3, raidTurns: 3,  wallAt: 5,  researchAt: 3, emergencyWorkers: false },
  },

  colors: {
    grass: '#4a7a52', grassPatch: '#427049', obstacle: '#6b7280',
    playerTint: '#87c3ff', enemyTint: '#fb7185',
    selection: '#ffe066', hpGood: '#86efac', hpBad: '#fb7185', venom: '#7CFF6B',
    ghostOk: 'rgba(135,195,255,0.35)', ghostBad: 'rgba(251,113,133,0.40)',
    alert: '#fb7185', outpost: '#c8e6c9',
  },

  rallyOffset: 64,
  emergencyWorkerTurns: 3,
};

/* Fill trainTurns; keep authored move/atkTiles; fall back if missing. */
(function deriveTurnStats() {
  const T = BW.config.turns.tile;
  for (const k of Object.keys(BW.config.UNIT_STATS)) {
    const s = BW.config.UNIT_STATS[k];
    if (s.move == null) s.move = Math.max(2, Math.round(s.speed / 32));
    if (s.atkTiles == null) s.atkTiles = Math.max(1, Math.round(s.range / 55));
    s.trainTurns = Math.max(1, Math.ceil(s.buildTime / BW.config.turns.trainDivisor));
  }
  for (const k of Object.keys(BW.config.BUILDING_STATS)) {
    const s = BW.config.BUILDING_STATS[k];
    if (s.range) s.atkTiles = Math.max(1, Math.round(s.range / T));
  }
})();
