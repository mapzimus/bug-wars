/* ============================================================================
   Bug Wars — systems.js   (v5: turn-based)
   ----------------------------------------------------------------------------
   The BEHAVIOR layer. Colony-turn rules: each unit acts once per turn, then
   End Turn hands the board to the rival. Harvest / train / venom / towers
   tick at turn start. Never draws.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const gathererKind = team => cfg.FACTIONS[BW.state.faction[team]].gatherer;
  const key = (gx, gy) => gx + ',' + gy;

  function entityRadius(e) {
    if (e.kind === 'node') return cfg.resources[e.resource].radius;
    if (cfg.BUILDING_STATS[e.kind]) return cfg.BUILDING_STATS[e.kind].radius;
    return cfg.UNIT_STATS[e.kind].radius;
  }
  function classOf(e) {
    if (e.kind === 'node') return 'resource';
    if (cfg.BUILDING_STATS[e.kind]) return 'building';
    return cfg.UNIT_STATS[e.kind].class;
  }
  function damageOf(e) {
    if (cfg.BUILDING_STATS[e.kind]) return cfg.BUILDING_STATS[e.kind].damage || 0;
    return cfg.UNIT_STATS[e.kind].damage;
  }

  const canAfford = (store, cost) => Object.keys(cost).every(k => store[k] >= cost[k]);
  const spend     = (store, cost) => { for (const k in cost) store[k] -= cost[k]; };

  /* ---- grid occupancy -------------------------------------------------- */
  function blockedTiles() {
    const set = new Set();
    for (const o of BW.state.obstacles) {
      // Rock covers its tile + neighbors roughly matching radius.
      const r = Math.ceil(o.r / cfg.turns.tile);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy <= r * r + 0.25) set.add(key(o.gx + dx, o.gy + dy));
      }
    }
    for (const b of BW.state.buildings) {
      if (cfg.BUILDING_STATS[b.kind].blocks || cfg.BUILDING_STATS[b.kind].category === 'nest'
          || cfg.BUILDING_STATS[b.kind].category === 'production'
          || cfg.BUILDING_STATS[b.kind].category === 'storage'
          || cfg.BUILDING_STATS[b.kind].category === 'defense') {
        set.add(key(b.gx, b.gy));
      }
    }
    return set;
  }
  function unitAt(gx, gy, exceptId) {
    return BW.state.units.find(u => u.gx === gx && u.gy === gy && u.id !== exceptId) || null;
  }
  function isFly(u) { return !!(cfg.UNIT_STATS[u.kind] && cfg.UNIT_STATS[u.kind].flying); }

  /* ---- pathfinding (BFS, Manhattan) ------------------------------------ */
  function moveRange(u) {
    const max = cfg.UNIT_STATS[u.kind].move;
    const blocked = blockedTiles();
    const fly = isFly(u);
    const reach = new Map();           // key -> steps
    const q = [{ gx: u.gx, gy: u.gy, d: 0 }];
    reach.set(key(u.gx, u.gy), 0);
    const cols = BW.world.cols(), rows = BW.world.rows();
    while (q.length) {
      const cur = q.shift();
      if (cur.d >= max) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.gx + dx, ny = cur.gy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const k = key(nx, ny);
        if (reach.has(k)) continue;
        if (!fly && blocked.has(k)) continue;
        // May path through friendly units, but not enemies.
        const occ = unitAt(nx, ny, u.id);
        if (occ && occ.team !== u.team) continue;
        reach.set(k, cur.d + 1);
        q.push({ gx: nx, gy: ny, d: cur.d + 1 });
      }
    }
    // Destinations: own tile or empty / pass-through only empties for landing.
    const landable = new Set();
    for (const [k, d] of reach) {
      if (d === 0) { landable.add(k); continue; }
      const [gx, gy] = k.split(',').map(Number);
      const occ = unitAt(gx, gy, u.id);
      if (!occ) landable.add(k);
    }
    return landable;
  }

  function tileDist(a, b) {
    return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);
  }
  function inAttackRange(attacker, target) {
    const tiles = (cfg.UNIT_STATS[attacker.kind] && cfg.UNIT_STATS[attacker.kind].atkTiles)
               || (cfg.BUILDING_STATS[attacker.kind] && cfg.BUILDING_STATS[attacker.kind].atkTiles)
               || 1;
    return tileDist(attacker, target) <= tiles;
  }

  function attackTargetsFrom(u, fromGx, fromGy) {
    const tiles = cfg.UNIT_STATS[u.kind].atkTiles;
    const list = [];
    const probe = { gx: fromGx, gy: fromGy };
    for (const e of [...BW.state.units, ...BW.state.buildings]) {
      if (e.team === u.team || e.hp <= 0) continue;
      if (Math.abs(e.gx - probe.gx) + Math.abs(e.gy - probe.gy) <= tiles) list.push(e);
    }
    return list;
  }

  /* ---- combat ---------------------------------------------------------- */
  function applyDamage(target, base, attacker) {
    const aCls = classOf(attacker), tCls = classOf(target);
    let mult = (cfg.COUNTERS[aCls] && cfg.COUNTERS[aCls][tCls]) || 1;
    const tb = cfg.BUILDING_STATS[target.kind];
    if (tb && tb.blocks && aCls !== 'siege') mult *= cfg.wallResist;
    target.hp -= base * mult;
  }
  function strike(attacker, target) {
    applyDamage(target, damageOf(attacker), attacker);
    const s = cfg.UNIT_STATS[attacker.kind];
    if (s && s.venom && target.maxHp && classOf(target) !== 'building') {
      target.venomDps = s.venom.dps * 3;          // chunkier per-turn tick (was per-second)
      target.venomTurns = cfg.turns.venomTurns;
    }
    if (BW.sound && BW.state.controllers[attacker.team] === 'human') BW.sound.play('attack');
  }

  function placeUnit(u, gx, gy) {
    const c = BW.world.tileCenter(gx, gy);
    u.gx = gx; u.gy = gy; u.x = c.x; u.y = c.y;
    u.heading = Math.atan2(c.y - u.y, c.x - u.x) || u.heading;
  }

  /* ---- economy helpers ------------------------------------------------- */
  function nearestOwn(team, pred) {
    for (const b of BW.state.buildings) if (b.team === team && pred(b)) return b;
    return null;
  }
  function nearestNode(p, resource) {
    let best = null, bestD = Infinity;
    for (const n of BW.state.nodes) {
      if (n.amount <= 0 || (resource && n.resource !== resource)) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }
  function adjacentToNode(u, node) {
    return Math.abs(u.gx - node.gx) + Math.abs(u.gy - node.gy) <= 1;
  }

  /* ---- turn lifecycle -------------------------------------------------- */
  function harvestFor(team) {
    const g = gathererKind(team);
    for (const u of BW.state.units) {
      if (u.team !== team || u.kind !== g) continue;
      let node = null;
      if (u.gathering != null) node = BW.byId(u.gathering);
      if (!node || node.kind !== 'node' || node.amount <= 0 || !adjacentToNode(u, node)) {
        // Auto-pick adjacent node if standing next to one (keeps tedium low, decisions intact:
        // you still choose WHERE to send the worker).
        node = BW.state.nodes.find(n => n.amount > 0 && adjacentToNode(u, n)) || null;
        u.gathering = node ? node.id : null;
      }
      if (!node) continue;
      let take = Math.min(cfg.turns.harvest[node.resource], node.amount);
      if (BW.state.controllers[team] === 'ai') take = Math.floor(take * cfg.difficulties[BW.state.difficulty].ecoMult);
      node.amount -= take;
      BW.state.res[team][node.resource] += take;
    }
  }

  function tickTraining(team) {
    for (const b of BW.state.buildings) {
      if (b.team !== team || !b.trainQueue || !b.trainQueue.length) continue;
      if (b.trainTimer <= 0) b.trainTimer = cfg.UNIT_STATS[b.trainQueue[0]].trainTurns;
      b.trainTimer -= 1;
      if (b.trainTimer <= 0) {
        const kind = b.trainQueue.shift();
        const spawn = BW.world.snapXY(b.rallyX, b.rallyY);
        // If rally tile occupied, spawn next to building.
        let gx = spawn.gx, gy = spawn.gy;
        if (unitAt(gx, gy) || blockedTiles().has(key(gx, gy))) {
          gx = b.gx; gy = b.gy + (team === 'player' ? -1 : 1);
          if (unitAt(gx, gy)) { gx = b.gx + 1; gy = b.gy; }
        }
        const u = BW.world.createUnit(kind, team, ...Object.values(BW.world.tileCenter(gx, gy)));
        // createUnit already snaps; force tile
        placeUnit(u, gx, gy);
        u.acted = true;             // new hatchlings rest until next turn
        if (b.rally && b.rally.nodeId != null && u.kind === gathererKind(team)) {
          u.gathering = b.rally.nodeId;
        }
        BW.state.units.push(u);
        if (BW.sound && BW.state.controllers[team] === 'human') BW.sound.play('train');
        b.trainTimer = b.trainQueue.length ? cfg.UNIT_STATS[b.trainQueue[0]].trainTurns : 0;
      }
    }
  }

  function tickVenom(team) {
    for (const u of BW.state.units) {
      if (u.team !== team || u.venomTurns <= 0) continue;
      u.hp -= u.venomDps;
      u.venomTurns -= 1;
      if (u.venomTurns <= 0) { u.venomTurns = 0; u.venomDps = 0; }
    }
  }

  function tickTowers(team) {
    for (const b of BW.state.buildings) {
      const s = cfg.BUILDING_STATS[b.kind];
      if (b.team !== team || !s.aggro) continue;
      for (let shot = 0; shot < cfg.turns.towerShots; shot++) {
        let best = null, bestD = Infinity;
        for (const e of [...BW.state.units, ...BW.state.buildings]) {
          if (e.team === team || e.hp <= 0) continue;
          const d = tileDist(b, e);
          if (d <= (s.atkTiles || 2) && d < bestD) { bestD = d; best = e; }
        }
        if (best) strike(b, best);
      }
    }
  }

  function emergencyWorkers(team) {
    const g = gathererKind(team);
    const nest = nearestOwn(team, b => cfg.BUILDING_STATS[b.kind].category === 'nest');
    if (!nest) return;
    const has = BW.state.units.some(u => u.team === team && u.kind === g);
    if (has) { nest.emergencyTimer = cfg.emergencyWorkerTurns; return; }
    nest.emergencyTimer = (nest.emergencyTimer == null ? cfg.emergencyWorkerTurns : nest.emergencyTimer) - 1;
    if (nest.emergencyTimer <= 0) {
      const c = BW.world.tileCenter(nest.gx, nest.gy + (team === 'player' ? -1 : 1));
      BW.state.units.push(BW.world.createUnit(g, team, c.x, c.y));
      nest.emergencyTimer = cfg.emergencyWorkerTurns;
    }
  }

  function regenNodes() {
    for (const n of BW.state.nodes) {
      const rg = cfg.turns.nodeRegen[n.resource];
      if (rg && n.amount < n.max) n.amount = Math.min(n.max, n.amount + rg);
    }
  }

  function resetActed(team) {
    for (const u of BW.state.units) if (u.team === team) u.acted = false;
  }

  function beginTurn(team) {
    const s = BW.state;
    s.turn.side = team;
    s.turn.busy = false;
    s.moveHint = null;
    s.selected.clear();
    s.selectedBuilding = null;
    tickVenom(team);
    harvestFor(team);
    tickTraining(team);
    tickTowers(team);
    emergencyWorkers(team);
    resetActed(team);
    BW.removeDead();
    if (team === 'player') {
      // A full round completed when it becomes the player's turn again (except turn 1).
      if (s.turn.number > 0) regenNodes();
    }
  }

  /* ---- player / AI actions --------------------------------------------- */
  function refreshMoveHint(u) {
    if (!u || u.acted || u.team !== BW.state.turn.side) { BW.state.moveHint = null; return; }
    const moves = moveRange(u);
    const attacks = new Set();
    for (const k of moves) {
      const [gx, gy] = k.split(',').map(Number);
      for (const t of attackTargetsFrom(u, gx, gy)) attacks.add(t.id);
    }
    // Also attacks from current tile without moving.
    for (const t of attackTargetsFrom(u, u.gx, u.gy)) attacks.add(t.id);
    BW.state.moveHint = { unitId: u.id, moves, attacks };
  }

  function canAct(u) {
    const s = BW.state;
    return s.phase === 'playing' && s.turn.side === u.team && !u.acted && u.hp > 0;
  }

  function actMove(u, gx, gy) {
    if (!canAct(u)) return { ok: false, reason: 'Not your turn' };
    const moves = moveRange(u);
    if (!moves.has(key(gx, gy))) return { ok: false, reason: "Can't reach there" };
    const ox = u.x, oy = u.y;
    placeUnit(u, gx, gy);
    if (u.x !== ox || u.y !== oy) u.heading = Math.atan2(u.y - oy, u.x - ox);
    u.acted = true;
    u.order = { type: 'idle', tx: u.x, ty: u.y, targetId: null };
    // Keep gathering assignment if still adjacent.
    if (u.gathering != null) {
      const n = BW.byId(u.gathering);
      if (!n || !adjacentToNode(u, n)) u.gathering = null;
    }
    BW.state.moveHint = null;
    BW.state.pings.push({ x: u.x, y: u.y, type: 'move', t: BW.state.time });
    if (BW.sound) BW.sound.play('move');
    return { ok: true };
  }

  function actAttack(u, target) {
    if (!canAct(u)) return { ok: false, reason: 'Not your turn' };
    if (!target || target.hp <= 0 || target.team === u.team) return { ok: false, reason: 'Invalid target' };
    // Find a landable tile in move range from which we can attack, preferring current tile.
    const moves = moveRange(u);
    let best = null;
    if (inAttackRange(u, target) || attackTargetsFrom(u, u.gx, u.gy).some(t => t.id === target.id)) {
      best = { gx: u.gx, gy: u.gy };
    } else {
      let bestD = Infinity;
      for (const k of moves) {
        const [gx, gy] = k.split(',').map(Number);
        if (!attackTargetsFrom(u, gx, gy).some(t => t.id === target.id)) continue;
        const d = Math.abs(gx - u.gx) + Math.abs(gy - u.gy);
        if (d < bestD) { bestD = d; best = { gx, gy }; }
      }
    }
    if (!best) return { ok: false, reason: 'Out of range' };
    if (best.gx !== u.gx || best.gy !== u.gy) placeUnit(u, best.gx, best.gy);
    u.heading = Math.atan2(target.y - u.y, target.x - u.x);
    strike(u, target);
    u.acted = true;
    u.order = { type: 'idle', tx: u.x, ty: u.y, targetId: null };
    BW.state.moveHint = null;
    BW.state.pings.push({ x: target.x, y: target.y, type: 'attack', t: BW.state.time });
    BW.removeDead();
    return { ok: true };
  }

  function actGather(u, node) {
    if (!canAct(u)) return { ok: false, reason: 'Not your turn' };
    if (u.kind !== gathererKind(u.team)) return { ok: false, reason: 'Only gatherers harvest' };
    if (!node || node.kind !== 'node' || node.amount <= 0) return { ok: false, reason: 'Nothing to gather' };
    // Move onto an adjacent tile to the node (or stay if already adjacent).
    if (adjacentToNode(u, node)) {
      u.gathering = node.id;
      u.acted = true;
      BW.state.moveHint = null;
      BW.state.pings.push({ x: node.x, y: node.y, type: 'gather', t: BW.state.time });
      if (BW.sound) BW.sound.play('gather');
      return { ok: true };
    }
    const moves = moveRange(u);
    let best = null, bestD = Infinity;
    for (const k of moves) {
      const [gx, gy] = k.split(',').map(Number);
      const d = Math.abs(gx - node.gx) + Math.abs(gy - node.gy);
      if (d <= 1 && d < bestD) { bestD = d; best = { gx, gy }; }
    }
    // If can't reach adjacency this turn, move as close as possible.
    if (!best) {
      for (const k of moves) {
        const [gx, gy] = k.split(',').map(Number);
        const d = Math.abs(gx - node.gx) + Math.abs(gy - node.gy);
        if (d < bestD) { bestD = d; best = { gx, gy }; }
      }
    }
    if (!best) return { ok: false, reason: "Can't reach" };
    placeUnit(u, best.gx, best.gy);
    if (adjacentToNode(u, node)) u.gathering = node.id;
    else u.gathering = node.id;   // keep assignment — harvest when adjacent next turns
    u.acted = true;
    BW.state.moveHint = null;
    BW.state.pings.push({ x: node.x, y: node.y, type: 'gather', t: BW.state.time });
    if (BW.sound) BW.sound.play('gather');
    return { ok: true };
  }

  function actWait(u) {
    if (!canAct(u)) return { ok: false, reason: 'Not your turn' };
    u.acted = true;
    BW.state.moveHint = null;
    return { ok: true };
  }

  /* ---- training / building --------------------------------------------- */
  const countUnits = team => BW.state.units.filter(u => u.team === team).length;
  const queued     = team => BW.state.buildings.filter(b => b.team === team)
                              .reduce((n, b) => n + (b.trainQueue ? b.trainQueue.length : 0), 0);
  function producerFor(kind, team) {
    return nearestOwn(team, b => cfg.BUILDING_STATS[b.kind].trains && cfg.BUILDING_STATS[b.kind].trains.includes(kind));
  }

  function tryTrain(kind, team) {
    if (BW.state.turn.side !== team) return { ok: false, reason: 'Not your turn' };
    const stat = cfg.UNIT_STATS[kind];
    const producer = producerFor(kind, team);
    if (!producer) {
      const tn = stat.trainedAt;
      const where = cfg.BUILDING_STATS[tn].category === 'nest' ? 'a base' : 'a ' + tn.charAt(0).toUpperCase() + tn.slice(1);
      return { ok: false, reason: `Build ${where} first` };
    }
    if (countUnits(team) + queued(team) >= cfg.popCap) return { ok: false, reason: 'Population cap reached' };
    if (!canAfford(BW.state.res[team], stat.cost)) return { ok: false, reason: 'Not enough resources' };
    spend(BW.state.res[team], stat.cost);
    producer.trainQueue.push(kind);
    if (producer.trainTimer <= 0) producer.trainTimer = stat.trainTurns;
    return { ok: true };
  }

  function validPlacement(kind, x, y) {
    const sn = BW.world.snapXY(x, y);
    const r = cfg.BUILDING_STATS[kind].radius, W = cfg.world.width, H = cfg.world.height;
    if (sn.x < r || sn.y < r || sn.x > W - r || sn.y > H - r) return false;
    const blocked = blockedTiles();
    if (blocked.has(key(sn.gx, sn.gy))) return false;
    if (unitAt(sn.gx, sn.gy)) return false;
    for (const n of BW.state.nodes) if (n.gx === sn.gx && n.gy === sn.gy) return false;
    // Don't stack on existing buildings (blockedTiles covers most, but double-check).
    for (const b of BW.state.buildings) if (b.gx === sn.gx && b.gy === sn.gy) return false;
    return true;
  }
  function tryBuild(kind, team, x, y) {
    if (BW.state.turn.side !== team) return { ok: false, reason: 'Not your turn' };
    const s = cfg.BUILDING_STATS[kind];
    if (!canAfford(BW.state.res[team], s.cost)) return { ok: false, reason: 'Not enough Mud' };
    if (!validPlacement(kind, x, y)) return { ok: false, reason: "Can't build there" };
    spend(BW.state.res[team], s.cost);
    BW.state.buildings.push(BW.world.createBuilding(kind, team, x, y));
    return { ok: true };
  }

  /* ---- End Turn -------------------------------------------------------- */
  function allActed(team) {
    return BW.state.units.filter(u => u.team === team).every(u => u.acted);
  }

  function playSide(team) {
    const s = BW.state;
    if (s.phase !== 'playing') { s.turn.busy = false; return; }
    if (s.controllers[team] === 'ai') {
      s.turn.busy = true;
      setTimeout(() => {
        if (s.phase !== 'playing') return;
        if (BW.ai && BW.ai.takeTurn) BW.ai.takeTurn(team);
        BW.removeDead();
        if (s.phase !== 'playing') { s.turn.busy = false; return; }
        // AI is done — automatically pass the turn.
        s.turn.busy = false;
        endTurn();
      }, 320);
    } else {
      s.turn.busy = false;
    }
  }

  function endTurn() {
    const s = BW.state;
    if (s.phase !== 'playing' || s.turn.busy) return;

    s.turn.busy = true;
    s.moveHint = null;
    s.selected.clear();
    s.selectedBuilding = null;
    s.placing = null;

    const next = s.turn.side === 'player' ? 'enemy' : 'player';
    if (next === 'player') s.turn.number += 1;

    beginTurn(next);
    if (s.phase !== 'playing') { s.turn.busy = false; return; }
    playSide(next);
  }

  // Visual-only clock; sim advances on turns, not frames.
  function update(dt) {
    const s = BW.state;
    if (s.phase !== 'playing') return;
    s.time += dt;
    if (s.pings.length)  s.pings  = s.pings.filter(p => s.time - p.t < 0.5);
    if (s.alerts.length) s.alerts = s.alerts.filter(a => a.until > s.time);
  }

  // Kick off the first turn after world init.
  function startMatch() {
    beginTurn('player');
    playSide('player');
  }

  BW.update = update;
  BW.tryTrain = tryTrain;
  BW.tryBuild = tryBuild;
  BW.endTurn = endTurn;
  BW.startMatch = startMatch;
  BW.systems = {
    entityRadius, classOf, dist, canAfford, nearestNode, nearestOwn, producerFor,
    validPlacement, countUnits, queued, moveRange, refreshMoveHint, actMove, actAttack,
    actGather, actWait, inAttackRange, attackTargetsFrom, tileDist, canAct, allActed,
    beginTurn, playSide, key,
  };
})();
