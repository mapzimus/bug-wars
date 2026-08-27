/* ============================================================================
   Bug Wars — systems.js   (v6: strategy substance)
   ----------------------------------------------------------------------------
   The BEHAVIOR layer. Colony-turn rules: each unit acts once per turn, then
   End Turn hands the board to the rival. Harvest / train / venom / towers /
   outposts / upgrades tick at turn start. Never draws.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const gathererKind = team => cfg.FACTIONS[BW.state.faction[team]].gatherer;
  const FAC = team => cfg.FACTIONS[BW.state.faction[team]];
  const key = (gx, gy) => gx + ',' + gy;
  const upgradesOf = team => (BW.state.upgrades && BW.state.upgrades[team]) || {};

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
    let base;
    if (cfg.BUILDING_STATS[e.kind]) base = cfg.BUILDING_STATS[e.kind].damage || 0;
    else base = cfg.UNIT_STATS[e.kind].damage;
    const up = upgradesOf(e.team);
    if (up.damageMult) base *= up.damageMult;
    return base;
  }
  function armorOf(team) {
    const doc = FAC(team).doctrine || {};
    const up = upgradesOf(team);
    return (doc.armor || 0) + (up.armor || 0);
  }
  function wallResistOf(defenderTeam) {
    let r = cfg.wallResist;
    const doc = FAC(defenderTeam).doctrine || {};
    const up = upgradesOf(defenderTeam);
    r -= (doc.wallResistBonus || 0) + (up.wallResistBonus || 0);
    return clamp(r, 0.15, 1);
  }
  function unitMove(u) {
    let m = cfg.UNIT_STATS[u.kind].move;
    const up = upgradesOf(u.team);
    const doc = FAC(u.team).doctrine || {};
    const cls = cfg.UNIT_STATS[u.kind].class;
    if (cls === 'worker' && up.workerMove) m += up.workerMove;
    if (cls === 'flyer') m += (doc.flyerMove || 0) + (up.flyerMove || 0);
    return m;
  }

  const canAfford = (store, cost) => Object.keys(cost).every(k => store[k] >= cost[k]);
  const spend     = (store, cost) => { for (const k in cost) store[k] -= cost[k]; };

  /* ---- grid occupancy -------------------------------------------------- */
  function blockedTiles() {
    const set = new Set();
    for (const o of BW.state.obstacles) {
      const r = Math.ceil(o.r / cfg.turns.tile);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy <= r * r + 0.25) set.add(key(o.gx + dx, o.gy + dy));
      }
    }
    for (const b of BW.state.buildings) {
      const s = cfg.BUILDING_STATS[b.kind];
      if (!s) continue;
      if (s.blocks || s.category === 'nest' || s.category === 'production'
          || s.category === 'storage' || s.category === 'defense'
          || s.category === 'outpost') {
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
    const max = unitMove(u);
    const blocked = blockedTiles();
    const fly = isFly(u);
    const reach = new Map();
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
        const occ = unitAt(nx, ny, u.id);
        if (occ && occ.team !== u.team) continue;
        reach.set(k, cur.d + 1);
        q.push({ gx: nx, gy: ny, d: cur.d + 1 });
      }
    }
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
      if (e.hp <= 0) continue;
      // Neutral outposts are attackable by anyone; otherwise must be enemy.
      const neutral = cfg.BUILDING_STATS[e.kind] && cfg.BUILDING_STATS[e.kind].capturable && !e.team;
      if (!neutral && e.team === u.team) continue;
      if (Math.abs(e.gx - probe.gx) + Math.abs(e.gy - probe.gy) <= tiles) list.push(e);
    }
    return list;
  }

  /* ---- combat ---------------------------------------------------------- */
  function applyDamage(target, base, attacker) {
    const aCls = classOf(attacker), tCls = classOf(target);
    let mult = (cfg.COUNTERS[aCls] && cfg.COUNTERS[aCls][tCls]) || 1;
    const tb = cfg.BUILDING_STATS[target.kind];
    if (tb && tb.blocks && aCls !== 'siege') mult *= wallResistOf(target.team);
    // Late-game pressure: nests take more once the mid-game clock starts.
    if (tb && tb.category === 'nest' && BW.state.turn && BW.state.turn.number >= 18) {
      mult *= 1.35;
    }
    let dealt = base * mult;
    if (target.team && cfg.UNIT_STATS[target.kind]) {
      dealt *= (1 - armorOf(target.team));
    }
    target.hp -= dealt;
    return dealt;
  }
  function counterLabel(attacker, target) {
    if (!attacker || !target) return '';
    const aCls = classOf(attacker), tCls = classOf(target);
    const mult = (cfg.COUNTERS[aCls] && cfg.COUNTERS[aCls][tCls]) || 1;
    if (mult > 1.05) return '×' + mult.toFixed(1);
    if (mult < 0.95) return '×' + mult.toFixed(1);
    const tb = cfg.BUILDING_STATS[target.kind];
    if (tb && tb.blocks && aCls !== 'siege') return 'wall';
    return '';
  }
  function previewDamage(attacker, target) {
    if (!attacker || !target) return 0;
    const aCls = classOf(attacker), tCls = classOf(target);
    let mult = (cfg.COUNTERS[aCls] && cfg.COUNTERS[aCls][tCls]) || 1;
    const tb = cfg.BUILDING_STATS[target.kind];
    if (tb && tb.blocks && aCls !== 'siege') mult *= wallResistOf(target.team);
    if (tb && tb.category === 'nest' && BW.state.turn && BW.state.turn.number >= 18) mult *= 1.35;
    let dealt = damageOf(attacker) * mult;
    if (target.team && cfg.UNIT_STATS[target.kind]) dealt *= (1 - armorOf(target.team));
    return Math.round(dealt);
  }
  function pushFloat(x, y, text, color) {
    BW.state.floats.push({
      x, y, text, color: color || '#fff',
      t: BW.state.time, life: cfg.turns.floatLife,
    });
  }
  function lookAt(x, y) {
    if (BW.state.controllers.player !== 'human' || BW.state.watchMode) return;
    BW.state.camTarget = { x, y };
  }
  function strike(attacker, target) {
    const dealt = applyDamage(target, damageOf(attacker), attacker);
    const s = cfg.UNIT_STATS[attacker.kind];
    if (s && s.venom && target.maxHp && classOf(target) !== 'building') {
      const doc = FAC(attacker.team).doctrine || {};
      const up = upgradesOf(attacker.team);
      const dmg = (s.venom.dmg || 0) + (doc.venomDmg || 0) + (up.venomDmg || 0);
      const turns = cfg.turns.venomTurns + (doc.venomTurns || 0) + (up.venomTurns || 0);
      target.venomDps = dmg;
      target.venomTurns = Math.max(target.venomTurns || 0, turns);
    }
    target.flash = cfg.turns.attackFlash;
    pushFloat(target.x, target.y - 18, '−' + Math.round(dealt), '#fb7185');
    lookAt(target.x, target.y);
    if (BW.sound && BW.state.controllers[attacker.team] === 'human') BW.sound.play('attack');

    // Capture outpost when HP depleted.
    const tb = cfg.BUILDING_STATS[target.kind];
    if (tb && tb.capturable && target.hp <= 0) {
      target.hp = target.maxHp;
      target.team = attacker.team;
      pushFloat(target.x, target.y - 28, 'Captured!', '#c8e6c9');
      if (BW.sound && BW.state.controllers[attacker.team] === 'human') BW.sound.play('build');
    }
  }

  function placeUnit(u, gx, gy, animate) {
    const c = BW.world.tileCenter(gx, gy);
    const ox = u.x, oy = u.y;
    u.gx = gx; u.gy = gy;
    if (animate !== false && (ox !== c.x || oy !== c.y)) {
      u.anim = { x0: ox, y0: oy, x1: c.x, y1: c.y, t: 0, dur: cfg.turns.moveAnim };
      u.x = c.x; u.y = c.y;
    } else {
      u.x = c.x; u.y = c.y; u.anim = null;
    }
    if (c.x !== ox || c.y !== oy) u.heading = Math.atan2(c.y - oy, c.x - ox);
    lookAt(c.x, c.y);
  }

  function drawPos(u) {
    if (!u.anim) return { x: u.x, y: u.y };
    const a = u.anim, k = Math.min(1, a.t / a.dur);
    const e = k * (2 - k);
    return { x: a.x0 + (a.x1 - a.x0) * e, y: a.y0 + (a.y1 - a.y0) * e };
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
  function nearGranary(u) {
    const R = cfg.turns.granaryRadius;
    for (const b of BW.state.buildings) {
      if (b.team !== u.team) continue;
      const s = cfg.BUILDING_STATS[b.kind];
      if (!s || (s.category !== 'storage' && !(s.category === 'outpost'))) continue;
      if (tileDist(u, b) <= R) return true;
    }
    return false;
  }
  function harvestMult(team, u) {
    const doc = FAC(team).doctrine || {};
    const up = upgradesOf(team);
    let m = (doc.harvestMult || 1) * (up.harvestMult || 1);
    if (u && nearGranary(u)) m *= cfg.turns.harvestBonus;
    return m;
  }
  function effectivePopCap(team) {
    let cap = cfg.popCap;
    for (const b of BW.state.buildings) {
      if (b.team !== team) continue;
      if (b.kind === 'granary') cap += cfg.granaryPopBonus;
      if (b.kind === 'outpost') cap += cfg.outpostPopBonus;
    }
    return cap;
  }

  /* ---- turn lifecycle -------------------------------------------------- */
  function harvestFor(team) {
    const g = gathererKind(team);
    for (const u of BW.state.units) {
      if (u.team !== team || u.kind !== g) continue;
      let node = null;
      if (u.gathering != null) node = BW.byId(u.gathering);
      if (!node || node.kind !== 'node' || node.amount <= 0 || !adjacentToNode(u, node)) {
        node = BW.state.nodes.find(n => n.amount > 0 && adjacentToNode(u, n)) || null;
        u.gathering = node ? node.id : null;
      }
      if (!node) continue;
      let take = Math.min(cfg.turns.harvest[node.resource], node.amount);
      take = Math.floor(take * harvestMult(team, u));
      if (BW.state.controllers[team] === 'ai') take = Math.floor(take * cfg.difficulties[BW.state.difficulty].ecoMult);
      take = Math.min(take, node.amount);
      node.amount -= take;
      BW.state.res[team][node.resource] += take;
      if (team === 'player' && take > 0) {
        const col = cfg.resources[node.resource].color;
        pushFloat(u.x, u.y - 20, '+' + take, col);
      }
    }
  }

  function outpostIncome(team) {
    const pay = cfg.turns.outpostIncome;
    for (const b of BW.state.buildings) {
      if (b.team !== team || b.kind !== 'outpost') continue;
      for (const k in pay) {
        BW.state.res[team][k] += pay[k];
        if (team === 'player') pushFloat(b.x, b.y - 22, '+' + pay[k], cfg.resources[k].color);
      }
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
        let gx = spawn.gx, gy = spawn.gy;
        if (unitAt(gx, gy) || blockedTiles().has(key(gx, gy))) {
          gx = b.gx; gy = b.gy + (team === 'player' ? -1 : 1);
          if (unitAt(gx, gy)) { gx = b.gx + 1; gy = b.gy; }
        }
        const u = BW.world.createUnit(kind, team, ...Object.values(BW.world.tileCenter(gx, gy)));
        // Apply flyer HP upgrade retroactively at spawn.
        const up = upgradesOf(team);
        if (cfg.UNIT_STATS[kind].class === 'flyer' && up.flyerHp) {
          u.maxHp += up.flyerHp;
          u.hp += up.flyerHp;
        }
        placeUnit(u, gx, gy);
        u.acted = true;
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
      pushFloat(u.x, u.y - 16, '−' + Math.round(u.venomDps), '#7CFF6B');
      u.venomTurns -= 1;
      if (u.venomTurns <= 0) { u.venomTurns = 0; u.venomDps = 0; }
    }
  }

  function towerTargetScore(b, e) {
    const cls = classOf(e);
    let score = 10;
    if (cls === 'siege') score += 40;
    else if (cls === 'flyer') score += 30;
    else if (cls === 'worker') score += 20;
    else if (cfg.UNIT_STATS[e.kind]) score += 15;
    score += (1 - e.hp / e.maxHp) * 10;
    score -= tileDist(b, e);
    return score;
  }

  function tickTowers(team) {
    const up = upgradesOf(team);
    const shots = cfg.turns.towerShots + (up.towerShots || 0);
    for (const b of BW.state.buildings) {
      const s = cfg.BUILDING_STATS[b.kind];
      if (b.team !== team || !s.aggro) continue;
      for (let shot = 0; shot < shots; shot++) {
        let best = null, bestScore = -Infinity;
        for (const e of [...BW.state.units, ...BW.state.buildings]) {
          if (e.team === team || e.hp <= 0 || !e.team) continue;
          const d = tileDist(b, e);
          if (d > (s.atkTiles || 2)) continue;
          const sc = towerTargetScore(b, e);
          if (sc > bestScore) { bestScore = sc; best = e; }
        }
        if (best) strike(b, best);
      }
    }
  }

  function emergencyWorkers(team) {
    const prof = cfg.difficulties[BW.state.difficulty];
    if (prof && prof.emergencyWorkers === false) return;
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
    outpostIncome(team);
    tickTraining(team);
    tickTowers(team);
    emergencyWorkers(team);
    resetActed(team);
    BW.removeDead();
    if (team === 'player') {
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
    for (const t of attackTargetsFrom(u, u.gx, u.gy)) attacks.add(t.id);
    BW.state.moveHint = { unitId: u.id, moves, attacks };
  }

  function refreshGroupHint(ids) {
    const moves = new Set();
    const attacks = new Set();
    let any = false;
    for (const id of ids) {
      const u = BW.byId(id);
      if (!u || u.acted || u.team !== BW.state.turn.side) continue;
      any = true;
      const mr = moveRange(u);
      for (const k of mr) moves.add(k);
      for (const k of mr) {
        const [gx, gy] = k.split(',').map(Number);
        for (const t of attackTargetsFrom(u, gx, gy)) attacks.add(t.id);
      }
      for (const t of attackTargetsFrom(u, u.gx, u.gy)) attacks.add(t.id);
    }
    if (!any) { BW.state.moveHint = null; return; }
    BW.state.moveHint = { unitId: null, group: true, moves, attacks };
  }

  function canAct(u) {
    const s = BW.state;
    return s.phase === 'playing' && s.turn.side === u.team && !u.acted && u.hp > 0;
  }

  function actMove(u, gx, gy) {
    if (!canAct(u)) return { ok: false, reason: 'Not your turn' };
    const moves = moveRange(u);
    if (!moves.has(key(gx, gy))) return { ok: false, reason: "Can't reach there" };
    placeUnit(u, gx, gy, true);
    u.acted = true;
    u.order = { type: 'idle', tx: u.x, ty: u.y, targetId: null };
    if (u.gathering != null) {
      const n = BW.byId(u.gathering);
      if (!n || !adjacentToNode(u, n)) u.gathering = null;
    }
    BW.state.moveHint = null;
    BW.state.pings.push({ x: u.x, y: u.y, type: 'move', t: BW.state.time });
    if (BW.sound && BW.state.controllers[u.team] === 'human') BW.sound.play('move');
    return { ok: true };
  }

  function actAttack(u, target) {
    if (!canAct(u)) return { ok: false, reason: 'Not your turn' };
    if (!target || target.hp <= 0) return { ok: false, reason: 'Invalid target' };
    const neutral = cfg.BUILDING_STATS[target.kind] && cfg.BUILDING_STATS[target.kind].capturable && !target.team;
    if (!neutral && target.team === u.team) return { ok: false, reason: 'Invalid target' };
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
    if (best.gx !== u.gx || best.gy !== u.gy) placeUnit(u, best.gx, best.gy, true);
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
    if (!best) {
      for (const k of moves) {
        const [gx, gy] = k.split(',').map(Number);
        const d = Math.abs(gx - node.gx) + Math.abs(gy - node.gy);
        if (d < bestD) { bestD = d; best = { gx, gy }; }
      }
    }
    if (!best) return { ok: false, reason: "Can't reach" };
    placeUnit(u, best.gx, best.gy, true);
    u.gathering = node.id;
    u.acted = true;
    BW.state.moveHint = null;
    BW.state.pings.push({ x: node.x, y: node.y, type: 'gather', t: BW.state.time });
    if (BW.sound && BW.state.controllers[u.team] === 'human') BW.sound.play('gather');
    return { ok: true };
  }

  function actWait(u) {
    if (!canAct(u)) return { ok: false, reason: 'Not your turn' };
    u.acted = true;
    BW.state.moveHint = null;
    return { ok: true };
  }

  /* Move a unit as close as possible to a destination tile (for group orders). */
  function actMoveToward(u, tx, ty) {
    if (!canAct(u)) return { ok: false, reason: 'Not your turn' };
    const moves = moveRange(u);
    if (moves.has(key(tx, ty)) && !unitAt(tx, ty, u.id)) return actMove(u, tx, ty);
    let best = null, bestD = Infinity;
    for (const k of moves) {
      const [gx, gy] = k.split(',').map(Number);
      if (gx === u.gx && gy === u.gy) continue;
      const d = Math.abs(gx - tx) + Math.abs(gy - ty);
      if (d < bestD) { bestD = d; best = { gx, gy }; }
    }
    if (!best) return actWait(u);
    return actMove(u, best.gx, best.gy);
  }

  /* ---- training / building / upgrades ---------------------------------- */
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
    if (countUnits(team) + queued(team) >= effectivePopCap(team)) return { ok: false, reason: 'Population cap reached' };
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

  function tryUpgrade(key, team) {
    if (BW.state.turn.side !== team) return { ok: false, reason: 'Not your turn' };
    const up = cfg.UPGRADES[key];
    if (!up) return { ok: false, reason: 'Unknown upgrade' };
    if (up.faction && up.faction !== BW.state.faction[team]) return { ok: false, reason: 'Wrong faction' };
    if (upgradesOf(team)[up.key]) return { ok: false, reason: 'Already researched' };
    if (!canAfford(BW.state.res[team], up.cost)) return { ok: false, reason: 'Need more Honeydew' };
    // Need a production building or nest alive.
    const hasBase = BW.state.buildings.some(b => b.team === team && (cfg.BUILDING_STATS[b.kind].category === 'nest' || cfg.BUILDING_STATS[b.kind].category === 'production'));
    if (!hasBase) return { ok: false, reason: 'No colony to research' };
    spend(BW.state.res[team], up.cost);
    const bag = BW.state.upgrades[team];
    for (const k in up.effect) {
      if (typeof up.effect[k] === 'number' && typeof bag[k] === 'number') bag[k] += up.effect[k];
      else bag[k] = up.effect[k];
    }
    bag[up.key] = true;
    // Retroactive flyer HP.
    if (up.effect.flyerHp) {
      for (const u of BW.state.units) {
        if (u.team === team && cfg.UNIT_STATS[u.kind].class === 'flyer') {
          u.maxHp += up.effect.flyerHp;
          u.hp += up.effect.flyerHp;
        }
      }
    }
    pushFloat(
      (nearestOwn(team, b => cfg.BUILDING_STATS[b.kind].category === 'nest') || { x: 0, y: 0 }).x,
      (nearestOwn(team, b => cfg.BUILDING_STATS[b.kind].category === 'nest') || { y: 0 }).y - 40,
      up.name + '!',
      '#ffd166'
    );
    if (BW.sound && BW.state.controllers[team] === 'human') BW.sound.play('build');
    return { ok: true };
  }

  function setRally(building, x, y) {
    if (!building || !building.trainQueue) return { ok: false };
    const sn = BW.world.snapXY(x, y);
    building.rallyX = sn.x; building.rallyY = sn.y;
    const node = BW.state.nodes.find(n => Math.abs(n.gx - sn.gx) + Math.abs(n.gy - sn.gy) <= 1);
    building.rally = node ? { nodeId: node.id } : null;
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
      const queue = [];
      if (BW.ai && BW.ai.takeTurn) BW.ai.takeTurn(team, fn => queue.push(fn));
      let i = 0;
      const step = () => {
        if (s.phase !== 'playing') { s.turn.busy = false; return; }
        if (i >= queue.length) {
          BW.removeDead();
          s.turn.busy = false;
          endTurn();
          return;
        }
        try { queue[i++](); } catch (e) { console.error(e); i = queue.length; }
        BW.removeDead();
        if (s.phase !== 'playing') { s.turn.busy = false; return; }
        setTimeout(step, cfg.turns.aiStep);
      };
      setTimeout(step, 100);
    } else {
      s.turn.busy = false;
      if (BW.selectNextReady) BW.selectNextReady();
    }
  }

  function endTurn() {
    const s = BW.state;
    if (s.phase !== 'playing' || s.turn.busy) return;

    s.turn.busy = true;
    s.moveHint = null;
    s.hoverDmg = null;
    s.selected.clear();
    s.selectedBuilding = null;
    s.placing = null;
    s.camTarget = null;

    const next = s.turn.side === 'player' ? 'enemy' : 'player';
    if (next === 'player') s.turn.number += 1;

    beginTurn(next);
    if (s.phase !== 'playing') { s.turn.busy = false; return; }
    playSide(next);
  }

  function update(dt) {
    const s = BW.state;
    if (s.phase !== 'playing') return;
    s.time += dt;
    if (s.pings.length)  s.pings  = s.pings.filter(p => s.time - p.t < 0.5);
    if (s.alerts.length) s.alerts = s.alerts.filter(a => a.until > s.time);
    if (s.floats.length) s.floats = s.floats.filter(f => s.time - f.t < f.life);
    for (const u of s.units) {
      if (u.anim) {
        u.anim.t += dt;
        if (u.anim.t >= u.anim.dur) u.anim = null;
      }
      if (u.flash > 0) u.flash -= dt;
    }
    for (const b of s.buildings) if (b.flash > 0) b.flash -= dt;
    if (s.camTarget && BW.centerCamera) {
      const z = s.camera.zoom || 1;
      const tx = s.camTarget.x - (cfg.view.width / z) / 2;
      const ty = s.camTarget.y - (cfg.view.height / z) / 2;
      s.camera.x += (tx - s.camera.x) * Math.min(1, dt * 4);
      s.camera.y += (ty - s.camera.y) * Math.min(1, dt * 4);
    }
  }

  function startMatch() {
    beginTurn('player');
    playSide('player');
  }

  BW.update = update;
  BW.tryTrain = tryTrain;
  BW.tryBuild = tryBuild;
  BW.tryUpgrade = tryUpgrade;
  BW.endTurn = endTurn;
  BW.startMatch = startMatch;
  BW.systems = {
    entityRadius, classOf, dist, canAfford, nearestNode, nearestOwn, producerFor,
    validPlacement, countUnits, queued, moveRange, refreshMoveHint, refreshGroupHint,
    actMove, actAttack, actGather, actWait, actMoveToward, inAttackRange, attackTargetsFrom,
    tileDist, canAct, allActed, beginTurn, playSide, key, previewDamage, counterLabel,
    drawPos, pushFloat, unitMove, effectivePopCap, setRally, upgradesOf, harvestMult,
  };
})();
