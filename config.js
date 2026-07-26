/* ============================================================================
   Bug Wars — config.js   (v5: playability pass)
   ----------------------------------------------------------------------------
   THE TUNING FILE. Every balance knob lives here as plain data the rest of the
   game reads at runtime. Change a number, reload, watch the game change.

   v5 changes the FEEL, not the vision:
     · tempo back up to 1x — v4's 0.6x default made the early game dead air
     · tighter map + a real zoom control, so you can see your army
     · faster gathering / training / walking — decisions arrive sooner
     · shorter AI grace — the first fight lands while you still care
     · UPGRADES: the honeydew sink the economy was always designed around
   ========================================================================== */

window.BW = window.BW || {};

BW.config = {

  /* ---- The battlefield -------------------------------------------------
     v4 was 2560x1440 seen through a fixed 1280x720 slot — you spent the game
     scrolling and never saw your own army. v5 shrinks the world a little AND
     makes the view a responsive, zoomable camera (see `zoom`). */
  world: { width: 2200, height: 1300 },
  view:  { width: 1280, height: 720 },    // fallback only — main.js sizes this to the window
  zoom: {
    min: 0.5,          // zoomed out: see ~2560px of world across a 1280px canvas
    max: 1.6,          // zoomed in: read individual bugs
    default: 0.85,     // start slightly out — the whole battle line fits
    step: 1.15,        // multiplier per wheel notch / +- press
  },
  camera: {
    edgeSize: 22,        // px from the canvas edge that triggers edge-scrolling
    edgeSpeed: 900,      // px/s while edge-scrolling
    keySpeed: 1250,      // px/s for WASD / arrow keys
  },
  minimap: { w: 210, margin: 12 },        // bottom-right; height follows world aspect

  gameSpeed: 1.0,           // master tempo. v4 shipped at 0.6 and felt sedated.
                            // Live-adjustable with the Speed −/+ controls (or [ and ]).
                            // Scales the whole sim uniformly — movement, combat,
                            // gather, training AND AI attack timing stretch together.

  /* ---- Economy ---------------------------------------------------------
     v5: more starting stock and faster gathering. You should be making your
     SECOND decision inside 20 seconds, not waiting out a mining animation. */
  startingResources: { food: 300, mud: 220, honeydew: 40 },
  popCap: 80,
  startingWorkers: 6,

  gather: {
    carryCap: 12,
    rate: { food: 14, mud: 11, honeydew: 8 },   // per second, per resource (was 9/7/5)
  },

  // Resource node types scattered on the map. Big piles + slow regen so the
  // economy never permanently collapses — there's always a trickle to recover on.
  resources: {
    food:     { amount: 650, regen: 3.0, radius: 11, color: '#b6d36b', label: 'Food' },
    mud:      { amount: 750, regen: 1.9, radius: 12, color: '#a07a4e', label: 'Mud'  },
    honeydew: { amount: 420, regen: 1.2, radius: 10, color: '#ffd166', label: 'Honeydew' },
  },

  /* ---- Units: stats + costs + counter class ----------------------------
     class drives the COUNTERS table below. cost is a {resource: amount} object.
     trainedAt = which building kind produces it. flying:true = ignores rocks
     and walls when moving (it does NOT make a unit unhittable).
     v5: ~25% faster movement and noticeably shorter build times across the
     board. The relative balance between units is unchanged — everything got
     the same lift, so the counter triangle still holds.
     -------------------------------------------------------------------- */
  UNIT_STATS: {
    // ---- Ants: the balanced baseline faction ----
    worker: {
      class: 'worker', hp: 50, speed: 98, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6, buildTime: 3, color: '#caa46a',
      cost: { food: 50 }, trainedAt: 'nest',
    },
    soldier: {
      class: 'infantry', hp: 152, speed: 80, damage: 12, range: 15, cooldown: 1.0,
      aggro: 165, radius: 9, buildTime: 4.5, color: '#8a6b4a',
      cost: { food: 70, mud: 10 }, trainedAt: 'barracks',
    },
    fireant: {
      class: 'skirmisher', hp: 68, speed: 145, damage: 8, range: 13, cooldown: 0.55,
      aggro: 185, radius: 7, buildTime: 3.8, color: '#d9622b',
      cost: { food: 60, mud: 5 }, trainedAt: 'barracks',
      venom: { dps: 9, duration: 3 },
    },
    leafcutter: {
      class: 'siege', hp: 126, speed: 62, damage: 10, range: 16, cooldown: 1.2,
      aggro: 125, radius: 9, buildTime: 5.5, color: '#5f8a3a',
      cost: { food: 70, mud: 20, honeydew: 25 }, trainedAt: 'workshop',
    },

    // ---- Bees: mobile + the hornet flyer ----
    drone: {
      class: 'worker', hp: 46, speed: 105, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6, buildTime: 3, color: '#e6c34d',
      cost: { food: 50 }, trainedAt: 'hive',
    },
    guard: {
      class: 'infantry', hp: 158, speed: 88, damage: 12, range: 15, cooldown: 1.0,
      aggro: 165, radius: 9, buildTime: 4.5, color: '#c79a2c',
      cost: { food: 70, mud: 10 }, trainedAt: 'brood',
    },
    striker: {
      class: 'skirmisher', hp: 66, speed: 160, damage: 8, range: 13, cooldown: 0.55,
      aggro: 185, radius: 7, buildTime: 3.8, color: '#e08a1e',
      cost: { food: 60, mud: 5 }, trainedAt: 'brood',
      venom: { dps: 9, duration: 3 },
    },
    carpenter: {
      class: 'siege', hp: 122, speed: 68, damage: 10, range: 16, cooldown: 1.2,
      aggro: 125, radius: 9, buildTime: 5.5, color: '#9a7326',
      cost: { food: 70, mud: 20, honeydew: 25 }, trainedAt: 'apiary',
    },
    hornet: {
      class: 'flyer', flying: true, hp: 108, speed: 158, damage: 12, range: 14, cooldown: 0.8,
      aggro: 180, radius: 8, buildTime: 5.0, color: '#d99520',
      cost: { food: 80, honeydew: 15 }, trainedAt: 'apiary',
    },

    // ---- Beetles (faction #3): slow, heavy, expensive — the armor faction ----
    grub: {
      class: 'worker', hp: 60, speed: 88, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6.5, buildTime: 3.4, color: '#9a8a6a',
      cost: { food: 50 }, trainedAt: 'mound',
    },
    bruiser: {
      class: 'infantry', hp: 250, speed: 68, damage: 15, range: 15, cooldown: 1.1,
      aggro: 155, radius: 10, buildTime: 5.6, color: '#6e5a40',
      cost: { food: 85, mud: 15 }, trainedAt: 'den',
    },
    bombardier: {
      class: 'skirmisher', hp: 96, speed: 120, damage: 8, range: 14, cooldown: 0.6,
      aggro: 180, radius: 7.5, buildTime: 4.2, color: '#b06a2a',
      cost: { food: 65, mud: 5 }, trainedAt: 'den',
      venom: { dps: 8, duration: 3 },
    },
    ram: {
      class: 'siege', hp: 205, speed: 54, damage: 13, range: 16, cooldown: 1.3,
      aggro: 120, radius: 10, buildTime: 6.4, color: '#55483a',
      cost: { food: 80, mud: 25, honeydew: 25 }, trainedAt: 'burrow',
    },

    // ---- Spiders (faction #4): fast, fragile, venomous — the raid faction ----
    spiderling: {
      class: 'worker', hp: 42, speed: 115, damage: 4, range: 12, cooldown: 0.9,
      aggro: 0, radius: 6, buildTime: 2.7, color: '#b9a7d0',
      cost: { food: 50 }, trainedAt: 'lair',
    },
    hunter: {
      class: 'infantry', hp: 132, speed: 102, damage: 11, range: 14, cooldown: 0.85,
      aggro: 170, radius: 8.5, buildTime: 4.2, color: '#7a668e',
      cost: { food: 70, mud: 10 }, trainedAt: 'nursery',
    },
    spitter: {
      class: 'skirmisher', hp: 62, speed: 165, damage: 8, range: 13, cooldown: 0.5,
      aggro: 190, radius: 7, buildTime: 3.5, color: '#a050b4',
      cost: { food: 60, mud: 5 }, trainedAt: 'nursery',
      venom: { dps: 12, duration: 3 },
    },
    weaver: {
      class: 'siege', hp: 112, speed: 64, damage: 10, range: 16, cooldown: 1.15,
      aggro: 125, radius: 9, buildTime: 5.2, color: '#5a4a6e',
      cost: { food: 70, mud: 20, honeydew: 25 }, trainedAt: 'spinnery',
    },
    balloonist: {
      class: 'flyer', flying: true, hp: 78, speed: 170, damage: 10, range: 14, cooldown: 0.8,
      aggro: 180, radius: 7.5, buildTime: 5.5, color: '#c79ae0',
      cost: { food: 75, honeydew: 20 }, trainedAt: 'spinnery',
    },
  },

  /* ---- Buildings --------------------------------------------------------
     category: nest | production | storage | defense
     trains[]  → a production building (has a train queue + rally point)
     drop:true → workers can drop resources here (bases + granary)
     damage/range/cooldown/aggro → a defensive tower that fires
     blocks:true → a wall (units path around it; siege chews through it)
     research[] → upgrades that can be researched here (see UPGRADES)
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
  // fraction of its damage to a blocking wall.
  wallResist: 0.4,

  /* ---- UPGRADES (v5) ----------------------------------------------------
     The honeydew sink this economy was always built for. One research runs at
     a time per colony, at the building named by `at` (a ROLE, resolved against
     the player's faction: 'base' | 'prod0' | 'prod1').

     effect keys are read by systems.js:
       damage      → army attack multiplier
       hp          → army max-HP multiplier (applied retroactively)
       armor       → incoming-damage multiplier (lower = tougher)
       gather      → worker gather-rate multiplier
       carry       → worker carry-cap multiplier
       moveSpeed   → all-unit speed multiplier
       trainSpeed  → build-time multiplier (lower = faster)
       venom       → venom dps + duration multiplier
       flyerHp     → extra max-HP multiplier, flyers only
     `requires` gates a tier behind its predecessor.
     -------------------------------------------------------------------- */
  UPGRADES: {
    mandibles1: { name: 'Sharp Mandibles', desc: '+20% army damage', at: 'prod0',
                  cost: { food: 150, honeydew: 25 }, time: 22, effect: { damage: 1.20 } },
    mandibles2: { name: 'Serrated Jaws', desc: '+20% more army damage', at: 'prod0', requires: 'mandibles1',
                  cost: { food: 260, honeydew: 60 }, time: 38, effect: { damage: 1.20 } },
    carapace1:  { name: 'Hard Carapace', desc: '+20% army health', at: 'prod0',
                  cost: { food: 140, mud: 60 }, time: 22, effect: { hp: 1.20 } },
    carapace2:  { name: 'Plated Shell', desc: '−12% damage taken', at: 'prod0', requires: 'carapace1',
                  cost: { food: 240, mud: 120, honeydew: 40 }, time: 38, effect: { armor: 0.88 } },
    foraging1:  { name: 'Foraging Trails', desc: '+25% gather rate', at: 'base',
                  cost: { food: 120, mud: 40 }, time: 20, effect: { gather: 1.25 } },
    foraging2:  { name: 'Bulk Hauling', desc: '+50% carry capacity', at: 'base', requires: 'foraging1',
                  cost: { food: 200, mud: 90, honeydew: 30 }, time: 32, effect: { carry: 1.5 } },

    // ---- one signature upgrade per faction (the flavour pick) ----
    tunnels:    { name: 'Tunnel Network', desc: 'Ants: +18% movement speed', at: 'prod1', faction: 'ants',
                  cost: { food: 180, honeydew: 45 }, time: 30, effect: { moveSpeed: 1.18 } },
    royaljelly: { name: 'Royal Jelly', desc: 'Bees: +30% flyer health, 20% faster training', at: 'prod1', faction: 'bees',
                  cost: { food: 180, honeydew: 45 }, time: 30, effect: { flyerHp: 1.30, trainSpeed: 0.80 } },
    ironshell:  { name: 'Iron Shell', desc: 'Beetles: −18% damage taken', at: 'prod1', faction: 'beetles',
                  cost: { food: 180, honeydew: 45 }, time: 30, effect: { armor: 0.82 } },
    potentvenom:{ name: 'Potent Venom', desc: 'Spiders: +70% venom damage', at: 'prod1', faction: 'spiders',
                  cost: { food: 180, honeydew: 45 }, time: 30, effect: { venom: 1.70 } },
  },

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
     v5: graces roughly halved. v4's 90-120s of guaranteed quiet was the single
     biggest boredom source — you built, then waited, then built, then waited.
     -------------------------------------------------------------------- */
  difficulties: {
    easy:   { workerTarget: 8,  armyThreshold: 6,  thinkEvery: 1.6, ecoMult: 1.0,  grace: 65, research: false },
    normal: { workerTarget: 12, armyThreshold: 9,  thinkEvery: 1.1, ecoMult: 1.0,  grace: 45, research: true  },
    hard:   { workerTarget: 16, armyThreshold: 13, thinkEvery: 0.8, ecoMult: 1.10, grace: 30, research: true  },
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

  /* ---- Pathfinding (v5) ------------------------------------------------
     A coarse navigation grid over the world. Smaller cells = better paths but
     more search. 28px is about half a building radius — fine enough to thread
     a wall gap, coarse enough that a full-map A* stays cheap. */
  pathfinding: {
    cell: 28,
    maxNodes: 2600,     // give up past this many expansions (fall back to steering)
    repathEvery: 1.1,   // seconds before a moving unit re-plans (targets move)
    budgetPerTick: 6,   // max A* searches per simulation tick — spreads the cost
  },
};
