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
    // factions: player picks one; the enemy is a random OTHER faction
    const pFac = (opts && opts.faction) || 'ants';
    const others = Object.keys(cfg.FACTIONS).filter(f => f !== pFac);
    const eFac = (opts && opts.enemyFaction) || others[Math.floor(Math.random() * others.length)];
    const FP = cfg.FACTIONS[pFac], FE = cfg.FACTIONS[eFac];

    const state = {
      units: [], buildings: [], nodes: [], obstacles: [],
      selected: new Set(),
      selectedBuilding: null,         // a production building whose RALLY point you're setting
      res: {                          // per-side resource stores
        player: { ...cfg.startingResources },
        enemy:  { ...cfg.startingResources },
      },
      phase: 'playing',               // 'menu' | 'playing' | 'won' | 'lost'
      paused: false,
      difficulty: difficulty || 'normal',
      // who drives each colony — 'human' or 'ai'
      controllers: { player: playerAI ? 'ai' : 'human', enemy: 'ai' },
      faction: { player: pFac, enemy: eFac },
      watchMode: playerAI,
      aiThink: { player: 0, enemy: 0 },
      drag: null,                     // box-select rectangle
      placing: null,                  // { kind } while in build-placement mode
      placeXY: null,                  // ghost position
      pings: [], alerts: [],
      camera: { x: 0, y: 0 },         // top-left of the view window, in world coords
      time: 0,
    };

    const playerNest = createBuilding(FP.base, 'player', 340, H - 300);
    const enemyNest  = createBuilding(FE.base, 'enemy',  W - 340, 300);
    state.buildings.push(playerNest, enemyNest);

    // Start looking at your own base.
    state.camera.x = Math.max(0, Math.min(W - cfg.view.width,  playerNest.x - cfg.view.width / 2));
    state.camera.y = Math.max(0, Math.min(H - cfg.view.height, playerNest.y - cfg.view.height / 2));

    // Starting gatherers for BOTH sides (the AI runs a real economy too).
    const ring = (nest, team, gatherer) => {
      for (let i = 0; i < cfg.startingWorkers; i++) {
        const a = (i / cfg.startingWorkers) * Math.PI * 2;
        state.units.push(createUnit(gatherer, team, nest.x + Math.cos(a) * 48, nest.y + Math.sin(a) * 48));
      }
    };
    ring(playerNest, 'player', FP.gatherer);
    ring(enemyNest, 'enemy', FE.gatherer);

    // Resource layout (180°-rotationally symmetric = fair): FOOD near each base,
    // MUD along the lanes, HONEYDEW contested in the center + far corners.
    const mirror = ([r, x, y]) => [r, W - x, H - y];
    const half = [
      ['food', 560, H - 300], ['food', 530, H - 440], ['food', 420, H - 530],   // player's food ring
      ['food', W / 2, H - 120],                                                  // bottom-mid expansion
      ['mud', 760, H - 440], ['mud', 1050, H - 180],                             // player-side mud
      ['mud', W / 2 - 170, H / 2 + 120],                                         // center mud (pair via mirror)
      ['honeydew', W / 2 - 120, H / 2 + 80],                                     // center honeydew (pair)
      ['honeydew', 300, 330],                                                    // far-corner expansion (pair)
    ];
    const nodes = [...half, ...half.map(mirror), ['honeydew', W / 2, H / 2]];
    nodes.forEach(([r, x, y]) => state.nodes.push(createNode(r, x, y)));

    // Rocks shape lanes and give walls anchor points (mirrored for fairness).
    const rocksHalf = [
      { x: W / 2,       y: H / 2 - 250, r: 48 },
      { x: W / 2 - 460, y: H / 2,       r: 36 },
      { x: 560,         y: H / 2 + 200, r: 30 },
      { x: 1060,        y: H - 240,     r: 26 },
    ];
    state.obstacles = [...rocksHalf, ...rocksHalf.map(o => ({ x: W - o.x, y: H - o.y, r: o.r }))];

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
      if (b.hp <= 0 && cfg.BUILDING_STATS[b.kind].category === 'nest') {   // nest OR hive
        if (b.team === 'player') s.phase = 'lost';
        if (b.team === 'enemy')  s.phase = 'won';
      }
    }
    s.buildings = s.buildings.filter(b => b.hp > 0);
    // nodes are NOT deleted — they regenerate (see systems.update)

    for (const id of [...s.selected]) {
      if (!s.units.some(u => u.id === id)) s.selected.delete(id);
    }
    if (s.selectedBuilding != null && !s.buildings.some(b => b.id === s.selectedBuilding)) s.selectedBuilding = null;
  }

  BW.world = { createUnit, createBuilding, createNode, initWorld, nextId };
  BW.byId = byId;
  BW.removeDead = removeDead;
})();
