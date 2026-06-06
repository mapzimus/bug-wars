/* ============================================================================
   Bug Wars — world.js
   ----------------------------------------------------------------------------
   The DATA layer. This file holds:
     - the factory functions that build entities (units, buildings, food)
     - initWorld(), which lays out the starting map
     - small helpers (byId, removeDead)

   An "entity" is just a plain object with a `kind` field. There is no class
   hierarchy — a worker and a soldier are the same shape of object with
   different numbers, and the behavior lives in systems.js. This keeps every
   piece of a unit's state visible in one place.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;

  // Every entity gets a unique id. We select/target by id (never by object
  // reference) so that deleting a dead unit can't leave a dangling pointer.
  let _nextId = 1;
  const nextId = () => _nextId++;

  function createUnit(kind, team, x, y) {
    const s = cfg.UNIT_STATS[kind];
    return {
      id: nextId(), kind, team,
      x, y, vx: 0, vy: 0,
      hp: s.hp, maxHp: s.hp,
      heading: team === 'player' ? -Math.PI / 2 : Math.PI / 2,
      // order = what this unit is currently trying to do
      order: { type: 'idle', tx: x, ty: y, targetId: null },
      attackCooldown: 0,
      carrying: 0,            // food a worker is holding
      venomDps: 0,            // active poison (set by fire ants)
      venomTimer: 0,
    };
  }

  function createBuilding(kind, team, x, y) {
    const s = cfg.nest;
    // Rally point sits in front of the nest (toward the map) so trained units
    // don't spawn on top of the building.
    const forward = team === 'player' ? -1 : 1;
    return {
      id: nextId(), kind, team,
      x, y,
      hp: s.hp, maxHp: s.hp,
      trainQueue: [],         // list of kinds waiting to be built
      trainTimer: 0,          // seconds left on the unit currently building
      rallyX: x, rallyY: y + forward * cfg.rallyOffset,
    };
  }

  function createFood(x, y) {
    return { id: nextId(), kind: 'food', x, y, amount: cfg.food.amount };
  }

  function initWorld() {
    const W = cfg.world.width, H = cfg.world.height;

    const state = {
      units: [],
      buildings: [],
      food: [],
      obstacles: [],
      selected: new Set(),    // ids of selected PLAYER units
      playerFood: cfg.startingFood,
      phase: 'playing',       // 'playing' | 'won' | 'lost'
      paused: false,
      drag: null,             // {x0,y0,x1,y1} while drag-selecting
      time: 0,                // seconds elapsed
      ai: { state: 'defending', waveTimer: cfg.ai.firstWaveDelay, waveNumber: 0 },
    };

    // Bases in opposite corners: you bottom-left, enemy top-right.
    const playerNest = createBuilding('nest', 'player', 170, H - 150);
    const enemyNest  = createBuilding('nest', 'enemy',  W - 170, 150);
    state.buildings.push(playerNest, enemyNest);

    // Your starting workers, ringed around the nest.
    for (let i = 0; i < cfg.startingWorkers; i++) {
      const a = (i / cfg.startingWorkers) * Math.PI * 2;
      state.units.push(
        createUnit('worker', 'player',
          playerNest.x + Math.cos(a) * 48,
          playerNest.y + Math.sin(a) * 48)
      );
    }

    // A small enemy garrison so their base isn't defenceless.
    for (let i = 0; i < 2; i++) {
      state.units.push(
        createUnit('soldier', 'enemy', enemyNest.x - 15 + i * 30, enemyNest.y + 55)
      );
    }

    // Food: a cluster by each base + contested piles in the middle.
    const spots = [
      [330, H - 175], [305, H - 255], [235, H - 300],     // yours
      [W - 330, 175], [W - 305, 255], [W - 235, 300],     // theirs
      [W / 2, H / 2], [W / 2 - 130, H / 2 + 90], [W / 2 + 130, H / 2 - 90], // middle
    ];
    spots.forEach(([x, y]) => state.food.push(createFood(x, y)));

    // A few rocks to give the open field a little shape.
    state.obstacles = [
      { x: W / 2,       y: H / 2 - 190, r: 46 },
      { x: W / 2 - 270, y: H / 2 - 30,  r: 36 },
      { x: W / 2 + 270, y: H / 2 + 30,  r: 36 },
    ];

    BW.state = state;
    return state;
  }

  /* ---- Helpers --------------------------------------------------------- */

  function byId(id) {
    const s = BW.state;
    return s.units.find(u => u.id === id)
        || s.buildings.find(b => b.id === id)
        || s.food.find(f => f.id === id)
        || null;
  }

  // Sweep out anything that died this frame, and decide win/lose when a nest
  // falls. Called once per update from systems.js.
  function removeDead() {
    const s = BW.state;

    s.units = s.units.filter(u => u.hp > 0);

    for (const b of s.buildings) {
      if (b.hp <= 0 && b.kind === 'nest') {
        if (b.team === 'player') s.phase = 'lost';
        if (b.team === 'enemy')  s.phase = 'won';
      }
    }
    s.buildings = s.buildings.filter(b => b.hp > 0);
    s.food = s.food.filter(f => f.amount > 0);

    // Drop dead units out of the selection set.
    for (const id of [...s.selected]) {
      if (!s.units.some(u => u.id === id)) s.selected.delete(id);
    }
  }

  BW.world = { createUnit, createBuilding, createFood, initWorld, nextId };
  BW.byId = byId;
  BW.removeDead = removeDead;
})();
