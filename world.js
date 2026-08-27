/* ============================================================================
   Bug Wars — world.js   (v5.1: maps + fx)
   ----------------------------------------------------------------------------
   The DATA layer: entity factories, map layouts (Garden / Skirmish), grid
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
      acted: false,
      venomDps: 0, venomTurns: 0,
      gathering: null,
      anim: null,                     // {x0,y0,x1,y1,t,dur} visual lerp
      flash: 0,
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
      flash: 0,                       // hit flash timer (seconds)
    };
    if (s.trains) {
      b.trainQueue = [];
      b.trainTimer = 0;
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

  function applyMapSize(mapId) {
    const m = cfg.maps[mapId] || cfg.maps.garden;
    cfg.world.width = m.width;
    cfg.world.height = m.height;
  }

  function initWorld(difficulty, opts) {
    const mapId = (opts && opts.map) || 'garden';
    applyMapSize(mapId);
    // decor must rebuild when map size changes
    if (BW.invalidateDecor) BW.invalidateDecor();

    const W = cfg.world.width, H = cfg.world.height;
    const playerAI = !!(opts && opts.playerAI);
    const pFac = (opts && opts.faction) || 'ants';
    const others = Object.keys(cfg.FACTIONS).filter(f => f !== pFac);
    const eFac = (opts && opts.enemyFaction) || others[Math.floor(Math.random() * others.length)];
    const FP = cfg.FACTIONS[pFac], FE = cfg.FACTIONS[eFac];
    const skirmish = mapId === 'skirmish';

    const state = {
      units: [], buildings: [], nodes: [], obstacles: [],
      selected: new Set(),
      selectedBuilding: null,
      res: {
        player: { ...cfg.startingResources },
        enemy:  { ...cfg.startingResources },
      },
      upgrades: { player: {}, enemy: {} },
      phase: 'playing',
      paused: false,
      difficulty: difficulty || 'normal',
      controllers: { player: playerAI ? 'ai' : 'human', enemy: 'ai' },
      faction: { player: pFac, enemy: eFac },
      watchMode: playerAI,
      mapId,
      drag: null,
      placing: null,
      placeXY: null,
      pings: [], alerts: [],
      floats: [],                     // floating combat / harvest text
      camera: { x: 0, y: 0, zoom: skirmish ? 0.85 : 1 },
      camTarget: null,                // soft follow {x,y} during enemy actions
      time: 0,
      turn: {
        side: 'player',
        number: 1,
        busy: false,
      },
      moveHint: null,
      hoverDmg: null,                 // {targetId, text} damage preview
    };

    const nestOffX = skirmish ? 220 : 340;
    const nestOffY = skirmish ? 200 : 300;
    const playerNest = createBuilding(FP.base, 'player', nestOffX, H - nestOffY);
    const enemyNest  = createBuilding(FE.base, 'enemy',  W - nestOffX, nestOffY);
    state.buildings.push(playerNest, enemyNest);

    state.camera.x = Math.max(0, playerNest.x - (cfg.view.width / state.camera.zoom) / 2);
    state.camera.y = Math.max(0, playerNest.y - (cfg.view.height / state.camera.zoom) / 2);

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

    // Resource layout — skirmish uses a tighter mirrored set.
    const mirror = ([r, x, y]) => [r, W - x, H - y];
    let half;
    if (skirmish) {
      half = [
        ['food', 360, H - 220], ['food', 280, H - 340],
        ['food', W / 2, H - 100],
        ['mud', 480, H - 300], ['mud', W / 2 - 100, H / 2 + 80],
        ['honeydew', W / 2 - 80, H / 2 + 40],
      ];
    } else {
      half = [
        ['food', 560, H - 300], ['food', 530, H - 440], ['food', 420, H - 530],
        ['food', W / 2, H - 120],
        ['mud', 760, H - 440], ['mud', 1050, H - 180],
        ['mud', W / 2 - 170, H / 2 + 120],
        ['honeydew', W / 2 - 120, H / 2 + 80],
        ['honeydew', 300, 330],
      ];
    }
    const nodes = [...half, ...half.map(mirror), ['honeydew', W / 2, H / 2]];
    nodes.forEach(([r, x, y]) => state.nodes.push(createNode(r, x, y)));

    // Contested outposts — capture by attacking to 0 HP; grant income + pop.
    const outposts = skirmish
      ? [[W / 2 - 220, H / 2 + 40], [W / 2 + 220, H / 2 - 40]]
      : [[W / 2 - 380, H / 2 + 60], [W / 2 + 380, H / 2 - 60], [W / 2, H / 2 + 220]];
    for (const [ox, oy] of outposts) {
      const b = createBuilding('outpost', null, ox, oy);
      b.team = null; // neutral until captured
      state.buildings.push(b);
    }

    let rocksHalf;
    if (skirmish) {
      // Choke rocks near mid so walls matter.
      rocksHalf = [
        { x: W / 2,       y: H / 2 - 140, r: 40 },
        { x: W / 2 - 200, y: H / 2 - 60,  r: 28 },
        { x: W / 2 - 280, y: H / 2 + 80,  r: 26 },
        { x: 420,         y: H / 2 + 120, r: 24 },
      ];
    } else {
      rocksHalf = [
        { x: W / 2,       y: H / 2 - 250, r: 48 },
        { x: W / 2 - 300, y: H / 2 - 80,  r: 34 },
        { x: W / 2 - 460, y: H / 2,       r: 36 },
        { x: 560,         y: H / 2 + 200, r: 30 },
        { x: 1060,        y: H - 240,     r: 26 },
      ];
    }
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
      if (b.hp > 0) continue;
      const st = cfg.BUILDING_STATS[b.kind];
      // Capturable sites are flipped in strike() when they hit 0 — never remove them.
      if (st && st.capturable) continue;
      if (st && st.category === 'nest') {
        if (b.team === 'player') s.phase = 'lost';
        if (b.team === 'enemy')  s.phase = 'won';
      }
    }
    s.buildings = s.buildings.filter(b => b.hp > 0 || (cfg.BUILDING_STATS[b.kind] && cfg.BUILDING_STATS[b.kind].capturable));

    for (const id of [...s.selected]) {
      if (!s.units.some(u => u.id === id)) s.selected.delete(id);
    }
    if (s.selectedBuilding != null && !s.buildings.some(b => b.id === s.selectedBuilding)) s.selectedBuilding = null;
  }

  BW.world = { createUnit, createBuilding, createNode, initWorld, nextId, toTile, tileCenter, snapXY, cols, rows, tile, applyMapSize };
  BW.byId = byId;
  BW.removeDead = removeDead;
})();
