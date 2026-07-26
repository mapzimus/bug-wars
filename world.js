/* ============================================================================
   Bug Wars — world.js   (v5)
   ----------------------------------------------------------------------------
   The DATA layer: entity factories, the map layout, and small helpers.
   Entities are plain objects with a `kind` field — no class hierarchy.

   v5 adds the state slots the new systems need: research + owned upgrades,
   control groups, the combat-FX buffer, and per-unit navigation/order-queue
   fields. The map was retuned for the smaller 2200x1300 world.
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
      queue: [],                      // shift-queued follow-up orders
      path: null, pathIdx: 0,         // current A* waypoint list + cursor
      pathGoal: null, repathTimer: 0, // where that path was planned to, and when to re-plan
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
      groups: {},                     // control groups: '1'..'9' → array of unit ids
      res: {                          // per-side resource stores
        player: { ...cfg.startingResources },
        enemy:  { ...cfg.startingResources },
      },
      upgrades: { player: new Set(), enemy: new Set() },   // completed research
      research: { player: null, enemy: null },             // { id, timeLeft, total, buildingId }
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
      pendingMoveOnly: false,         // 'M' pressed — next right-click is a plain move
      pings: [], alerts: [], fx: [],  // fx = transient combat visuals (render-only)
      camera: { x: 0, y: 0, zoom: cfg.zoom.default },
      time: 0,
    };

    const playerNest = createBuilding(FP.base, 'player', 320, H - 280);
    const enemyNest  = createBuilding(FE.base, 'enemy',  W - 320, 280);
    state.buildings.push(playerNest, enemyNest);

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
      ['food', 520, H - 280], ['food', 480, H - 420], ['food', 390, H - 500],   // player's food ring
      ['food', W / 2, H - 110],                                                  // bottom-mid expansion
      ['mud', 700, H - 420], ['mud', 950, H - 160],                              // player-side mud
      ['mud', W / 2 - 160, H / 2 + 110],                                         // center mud (pair via mirror)
      ['honeydew', W / 2 - 110, H / 2 + 70],                                     // center honeydew (pair)
      ['honeydew', 280, 300],                                                    // far-corner expansion (pair)
    ];
    const nodes = [...half, ...half.map(mirror), ['honeydew', W / 2, H / 2]];
    nodes.forEach(([r, x, y]) => state.nodes.push(createNode(r, x, y)));

    // Rocks shape lanes and give walls anchor points (mirrored for fairness).
    const rocksHalf = [
      { x: W / 2,       y: H / 2 - 220, r: 48 },
      { x: W / 2 - 420, y: H / 2,       r: 36 },
      { x: 520,         y: H / 2 + 180, r: 30 },
      { x: 980,         y: H - 220,     r: 26 },
    ];
    state.obstacles = [...rocksHalf, ...rocksHalf.map(o => ({ x: W - o.x, y: H - o.y, r: o.r }))];

    BW.state = state;
    if (BW.path) BW.path.markDirty();     // new map → rebuild the navigation grid
    // Start looking at your own base (needs BW.state set, and the live view size).
    if (BW.centerCamera) BW.centerCamera(playerNest.x, playerNest.y);
    else { state.camera.x = playerNest.x - cfg.view.width / 2; state.camera.y = playerNest.y - cfg.view.height / 2; }
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

    // Emit a death puff for anything that just died, so kills read on screen.
    for (const u of s.units) {
      if (u.hp <= 0 && BW.systems) BW.systems.fx({ kind: 'death', x: u.x, y: u.y, team: u.team, r: cfg.UNIT_STATS[u.kind].radius });
    }
    s.units = s.units.filter(u => u.hp > 0);

    let wallDied = false;
    for (const b of s.buildings) {
      if (b.hp > 0) continue;
      const bs = cfg.BUILDING_STATS[b.kind];
      if (bs.blocks) wallDied = true;
      if (BW.systems) BW.systems.fx({ kind: 'death', x: b.x, y: b.y, team: b.team, r: bs.radius });
      if (bs.category === 'nest') {
        if (b.team === 'player') s.phase = 'lost';
        if (b.team === 'enemy')  s.phase = 'won';
      }
    }
    s.buildings = s.buildings.filter(b => b.hp > 0);
    if (wallDied && BW.path) BW.path.markDirty();     // a hole opened in the wall line
    // nodes are NOT deleted — they regenerate (see systems.update)

    for (const id of [...s.selected]) {
      if (!s.units.some(u => u.id === id)) s.selected.delete(id);
    }
    // Control groups forget their dead too, so recalling '1' isn't a no-op.
    for (const k in s.groups) {
      s.groups[k] = s.groups[k].filter(id => s.units.some(u => u.id === id));
      if (!s.groups[k].length) delete s.groups[k];
    }
    if (s.selectedBuilding != null && !s.buildings.some(b => b.id === s.selectedBuilding)) s.selectedBuilding = null;
    // Research dies with the building that hosted it.
    for (const team of ['player', 'enemy']) {
      const r = s.research[team];
      if (r && !s.buildings.some(b => b.id === r.buildingId)) s.research[team] = null;
    }
  }

  BW.world = { createUnit, createBuilding, createNode, initWorld, nextId };
  BW.byId = byId;
  BW.removeDead = removeDead;
})();
