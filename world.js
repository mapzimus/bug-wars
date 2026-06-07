/* ============================================================================
   Bug Wars — world.js   (v2)
   ----------------------------------------------------------------------------
   The DATA layer: entity factories, the map layout, and small helpers.
   Entities are plain objects with a `kind` field — no class hierarchy.
   v2: three resources (per-side stores), typed nodes, table-driven buildings.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  let _nextId = 1;
  const nextId = () => _nextId++;

  function createUnit(kind, team, x, y) {
    const s = cfg.UNIT_STATS[kind];
    return {
      id: nextId(), kind, team, x, y, vx: 0, vy: 0,
      hp: s.hp, maxHp: s.hp,
      heading: team === 'player' ? -Math.PI / 2 : Math.PI / 2,
      order: { type: 'idle', tx: x, ty: y, targetId: null },
      attackCooldown: 0,
      carrying: 0, carryType: null,   // how much / which resource a worker holds
      venomDps: 0, venomTimer: 0,
    };
  }

  function createBuilding(kind, team, x, y) {
    const s = cfg.BUILDING_STATS[kind];
    const forward = team === 'player' ? -1 : 1;
    const b = {
      id: nextId(), kind, team, x, y,
      hp: s.hp, maxHp: s.hp,
      attackCooldown: 0,              // used by towers
    };
    if (s.trains) {                   // production building
      b.trainQueue = [];
      b.trainTimer = 0;
      b.rallyX = x;
      b.rallyY = y + forward * cfg.rallyOffset;
    }
    return b;
  }

  function createNode(resource, x, y) {
    const max = cfg.resources[resource].amount;
    return { id: nextId(), kind: 'node', resource, x, y, amount: max, max };
  }

  function initWorld(difficulty, opts) {
    const W = cfg.world.width, H = cfg.world.height;
    const playerAI = !!(opts && opts.playerAI);   // AI-vs-AI watch / test mode

    const state = {
      units: [], buildings: [], nodes: [], obstacles: [],
      selected: new Set(),
      res: {                          // per-side resource stores
        player: { ...cfg.startingResources },
        enemy:  { ...cfg.startingResources },
      },
      phase: 'playing',               // 'menu' | 'playing' | 'won' | 'lost'
      paused: false,
      difficulty: difficulty || 'normal',
      // who drives each colony — 'human' or 'ai'
      controllers: { player: playerAI ? 'ai' : 'human', enemy: 'ai' },
      watchMode: playerAI,
      aiThink: { player: 0, enemy: 0 },
      drag: null,                     // box-select rectangle
      placing: null,                  // { kind } while in build-placement mode
      placeXY: null,                  // ghost position
      pings: [], alerts: [],
      time: 0,
    };

    const playerNest = createBuilding('nest', 'player', 170, H - 150);
    const enemyNest  = createBuilding('nest', 'enemy',  W - 170, 150);
    state.buildings.push(playerNest, enemyNest);

    // Starting workers for BOTH sides (the AI runs a real economy too).
    const ring = (nest, team) => {
      for (let i = 0; i < cfg.startingWorkers; i++) {
        const a = (i / cfg.startingWorkers) * Math.PI * 2;
        state.units.push(createUnit('worker', team, nest.x + Math.cos(a) * 48, nest.y + Math.sin(a) * 48));
      }
    };
    ring(playerNest, 'player');
    ring(enemyNest, 'enemy');

    // Resource layout: FOOD near each base, MUD in the mid-lanes,
    // HONEYDEW scarce and contested in the center.
    const nodes = [
      ['food', 320, H - 170], ['food', 300, H - 250], ['food', 235, H - 300],
      ['food', W - 320, 170], ['food', W - 300, 250], ['food', W - 235, 300],
      ['mud', 430, H - 300], ['mud', W - 430, 300],
      ['mud', W / 2 - 230, H / 2 + 120], ['mud', W / 2 + 230, H / 2 - 120],
      ['honeydew', W / 2, H / 2], ['honeydew', W / 2 - 90, H / 2 + 70], ['honeydew', W / 2 + 90, H / 2 - 70],
    ];
    nodes.forEach(([r, x, y]) => state.nodes.push(createNode(r, x, y)));

    // A few rocks for shape (walls get added to avoidance dynamically).
    state.obstacles = [
      { x: W / 2,       y: H / 2 - 210, r: 44 },
      { x: W / 2 - 300, y: H / 2 + 30,  r: 34 },
      { x: W / 2 + 300, y: H / 2 - 30,  r: 34 },
    ];

    BW.state = state;
    return state;
  }

  /* ---- Helpers --------------------------------------------------------- */

  function byId(id) {
    const s = BW.state;
    return s.units.find(u => u.id === id)
        || s.buildings.find(b => b.id === id)
        || s.nodes.find(n => n.id === id)
        || null;
  }

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
    // nodes are NOT deleted — they regenerate (see systems.update)

    for (const id of [...s.selected]) {
      if (!s.units.some(u => u.id === id)) s.selected.delete(id);
    }
  }

  BW.world = { createUnit, createBuilding, createNode, initWorld, nextId };
  BW.byId = byId;
  BW.removeDead = removeDead;
})();
