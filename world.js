/* ============================================================================
   Bug Wars — world.js   (v5: turn-based grid)
   ----------------------------------------------------------------------------
   The DATA layer: entity factories, the map layout, grid helpers, and small
   helpers. Entities are plain objects with a `kind` field — no class hierarchy.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  let _nextId = 1;
  const nextId = () => _nextId++;

  const tile = () => cfg.turns.tile;
  const cols = () => Math.floor(cfg.world.width / tile());
  const rows = () => Math.floor(cfg.world.height / tile());

  function toTile(x, y) {
    const T = tile();
    return {
      gx: Math.max(0, Math.min(cols() - 1, Math.floor(x / T))),
      gy: Math.max(0, Math.min(rows() - 1, Math.floor(y / T))),
    };
  }
  function tileCenter(gx, gy) {
    const T = tile();
    return { x: (gx + 0.5) * T, y: (gy + 0.5) * T };
  }
  function snapXY(x, y) {
    const t = toTile(x, y);
    return { ...tileCenter(t.gx, t.gy), gx: t.gx, gy: t.gy };
  }

  function createUnit(kind, team, x, y) {
    const s = cfg.UNIT_STATS[kind];
    const sn = snapXY(x, y);
    return {
      id: nextId(), kind, team,
      x: sn.x, y: sn.y, gx: sn.gx, gy: sn.gy,
      hp: s.hp, maxHp: s.hp,
      heading: team === 'player' ? -Math.PI / 2 : Math.PI / 2,
      order: { type: 'idle', tx: sn.x, ty: sn.y, targetId: null },
      acted: false,                 // used its action this turn?
      venomDps: 0, venomTurns: 0,   // DoT remaining (ticks on victim's turn start)
      gathering: null,              // node id while assigned to harvest
    };
  }

  function createBuilding(kind, team, x, y) {
    const s = cfg.BUILDING_STATS[kind];
    const sn = snapXY(x, y);
    const forward = team === 'player' ? -1 : 1;
    const b = {
      id: nextId(), kind, team,
      x: sn.x, y: sn.y, gx: sn.gx, gy: sn.gy,
      hp: s.hp, maxHp: s.hp,
    };
    if (s.trains) {
      b.trainQueue = [];
      b.trainTimer = 0;               // turns remaining on current hatch
      const r = snapXY(sn.x, sn.y + forward * cfg.rallyOffset);
      b.rallyX = r.x; b.rallyY = r.y;
    }
    return b;
  }

  function createNode(resource, x, y) {
    const max = cfg.resources[resource].amount;
    const sn = snapXY(x, y);
    return { id: nextId(), kind: 'node', resource, x: sn.x, y: sn.y, gx: sn.gx, gy: sn.gy, amount: max, max };
  }

  function initWorld(difficulty, opts) {
    const W = cfg.world.width, H = cfg.world.height;
    const playerAI = !!(opts && opts.playerAI);
    const pFac = (opts && opts.faction) || 'ants';
    const others = Object.keys(cfg.FACTIONS).filter(f => f !== pFac);
    const eFac = (opts && opts.enemyFaction) || others[Math.floor(Math.random() * others.length)];
    const FP = cfg.FACTIONS[pFac], FE = cfg.FACTIONS[eFac];

    const state = {
      units: [], buildings: [], nodes: [], obstacles: [],
      selected: new Set(),
      selectedBuilding: null,
      res: {
        player: { ...cfg.startingResources },
        enemy:  { ...cfg.startingResources },
      },
      phase: 'playing',
      paused: false,
      difficulty: difficulty || 'normal',
      controllers: { player: playerAI ? 'ai' : 'human', enemy: 'ai' },
      faction: { player: pFac, enemy: eFac },
      watchMode: playerAI,
      drag: null,
      placing: null,
      placeXY: null,
      pings: [], alerts: [],
      camera: { x: 0, y: 0 },
      time: 0,                        // visual clock (seconds of wall time while playing)
      turn: {
        side: 'player',               // whose turn
        number: 1,                    // increments each time it becomes the player's turn again
        busy: false,                  // AI / resolve in progress — input locked
      },
      moveHint: null,                 // { moves:Set, attacks:Set } for selected unit overlay
    };

    const playerNest = createBuilding(FP.base, 'player', 340, H - 300);
    const enemyNest  = createBuilding(FE.base, 'enemy',  W - 340, 300);
    state.buildings.push(playerNest, enemyNest);

    state.camera.x = Math.max(0, Math.min(W - cfg.view.width,  playerNest.x - cfg.view.width / 2));
    state.camera.y = Math.max(0, Math.min(H - cfg.view.height, playerNest.y - cfg.view.height / 2));

    const ring = (nest, team, gatherer) => {
      for (let i = 0; i < cfg.startingWorkers; i++) {
        const a = (i / cfg.startingWorkers) * Math.PI * 2;
        state.units.push(createUnit(gatherer, team,
          nest.x + Math.cos(a) * tile() * 1.2,
          nest.y + Math.sin(a) * tile() * 1.2));
      }
    };
    ring(playerNest, 'player', FP.gatherer);
    ring(enemyNest, 'enemy', FE.gatherer);

    const mirror = ([r, x, y]) => [r, W - x, H - y];
    const half = [
      ['food', 560, H - 300], ['food', 530, H - 440], ['food', 420, H - 530],
      ['food', W / 2, H - 120],
      ['mud', 760, H - 440], ['mud', 1050, H - 180],
      ['mud', W / 2 - 170, H / 2 + 120],
      ['honeydew', W / 2 - 120, H / 2 + 80],
      ['honeydew', 300, 330],
    ];
    const nodes = [...half, ...half.map(mirror), ['honeydew', W / 2, H / 2]];
    nodes.forEach(([r, x, y]) => state.nodes.push(createNode(r, x, y)));

    // Rocks snap to tiles so pathfinding stays clean.
    const rocksHalf = [
      { x: W / 2,       y: H / 2 - 250, r: 48 },
      { x: W / 2 - 460, y: H / 2,       r: 36 },
      { x: 560,         y: H / 2 + 200, r: 30 },
      { x: 1060,        y: H - 240,     r: 26 },
    ];
    state.obstacles = [...rocksHalf, ...rocksHalf.map(o => ({ x: W - o.x, y: H - o.y, r: o.r }))].map(o => {
      const sn = snapXY(o.x, o.y);
      return { x: sn.x, y: sn.y, gx: sn.gx, gy: sn.gy, r: o.r };
    });

    BW.state = state;
    return state;
  }

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
      if (b.hp <= 0 && cfg.BUILDING_STATS[b.kind].category === 'nest') {
        if (b.team === 'player') s.phase = 'lost';
        if (b.team === 'enemy')  s.phase = 'won';
      }
    }
    s.buildings = s.buildings.filter(b => b.hp > 0);

    for (const id of [...s.selected]) {
      if (!s.units.some(u => u.id === id)) s.selected.delete(id);
    }
    if (s.selectedBuilding != null && !s.buildings.some(b => b.id === s.selectedBuilding)) s.selectedBuilding = null;
  }

  BW.world = { createUnit, createBuilding, createNode, initWorld, nextId, toTile, tileCenter, snapXY, cols, rows, tile };
  BW.byId = byId;
  BW.removeDead = removeDead;
})();
