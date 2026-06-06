/* ============================================================================
   Bug Wars — systems.js
   ----------------------------------------------------------------------------
   The BEHAVIOR layer ("the verbs"). Every frame, BW.update(dt) walks all the
   entities and advances the simulation by dt seconds: units steer, workers
   gather, nests train, fighters fight, poison ticks, the dead are swept away.

   Nothing here draws anything — drawing is render.js's job. Keeping simulate
   and draw separate is what makes the game predictable.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;

  /* ---- tiny math helpers ---------------------------------------------- */
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function entityRadius(e) {
    if (e.kind === 'nest') return cfg.nest.radius;
    if (e.kind === 'food') return cfg.food.radius;
    const s = cfg.UNIT_STATS[e.kind];
    return s ? s.radius : 8;
  }

  /* ====================================================================
     MOVEMENT
     ==================================================================== */

  // Sum of little pushes away from neighbours so units don't pile into one dot.
  function separationVec(u) {
    const r = cfg.separationRadius;
    let px = 0, py = 0;
    for (const o of BW.state.units) {
      if (o === u) continue;
      const dx = u.x - o.x, dy = u.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < r * r) {
        const d = Math.sqrt(d2);
        const push = (r - d) / r;          // 1 when touching, 0 at the edge
        px += (dx / d) * push;
        py += (dy / d) * push;
      }
    }
    const strength = 45;
    return [px * strength, py * strength];
  }

  // Shove a position out of any rock it lands inside.
  function avoidObstacles(u, nx, ny) {
    const rad = entityRadius(u);
    for (const ob of BW.state.obstacles) {
      const dx = nx - ob.x, dy = ny - ob.y;
      const d = Math.hypot(dx, dy) || 1;
      const min = ob.r + rad;
      if (d < min) { nx = ob.x + (dx / d) * min; ny = ob.y + (dy / d) * min; }
    }
    return [nx, ny];
  }

  // Steer u toward (tx,ty). Returns true once it has basically arrived.
  function moveToward(u, tx, ty, dt) {
    const s = cfg.UNIT_STATS[u.kind];
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy) || 1;
    const arrive = 5;

    let mvx = 0, mvy = 0;
    if (d > arrive) {
      mvx = (dx / d) * s.speed;
      mvy = (dy / d) * s.speed;
      u.heading = Math.atan2(dy, dx);
    }
    const [sx, sy] = separationVec(u);
    mvx += sx; mvy += sy;

    let nx = u.x + mvx * dt;
    let ny = u.y + mvy * dt;
    [nx, ny] = avoidObstacles(u, nx, ny);
    u.x = clamp(nx, 0, cfg.world.width);
    u.y = clamp(ny, 0, cfg.world.height);
    return d <= arrive;
  }

  /* ====================================================================
     COMBAT
     ==================================================================== */

  // Nearest enemy (unit, then building) inside this unit's aggro radius.
  function acquireTarget(u) {
    const aggro = cfg.UNIT_STATS[u.kind].aggro;
    if (aggro <= 0) return null;
    let best = null, bestD = aggro;
    for (const o of BW.state.units) {
      if (o.team === u.team) continue;
      const d = dist(u, o);
      if (d < bestD) { bestD = d; best = o; }
    }
    for (const b of BW.state.buildings) {
      if (b.team === u.team) continue;
      const d = dist(u, b) - entityRadius(b);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  // Nearest enemy within guard range of this unit's OWN nest — so idle
  // fighters proactively march out to meet attackers instead of standing still.
  function nestThreat(u) {
    const nest = nearestNest(u);
    if (!nest) return null;
    let best = null, bestD = cfg.guardRange;
    for (const o of BW.state.units) {
      if (o.team === u.team) continue;
      const d = dist(o, nest);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  /* --------------------------------------------------------------------
     LEARNING SPOT #3 — the damage formula.
     This is the single most "game-feel" piece of math in the whole game.
     Right now it deals the attacker's flat damage, with one twist: a
     leafcutter ant hits BUILDINGS for `buildingBonus` times as much (its
     job is to chew through the enemy nest). Tweak this however you like —
     add armor, add bonus damage between specific ant types, etc.
     ------------------------------------------------------------------ */
  function applyDamage(target, base, attackerKind, targetKind) {
    let dmg = base;
    const atk = cfg.UNIT_STATS[attackerKind];
    if (targetKind === 'nest' && atk && atk.buildingBonus) {
      dmg *= atk.buildingBonus;
    }
    target.hp -= dmg;
  }

  function strike(attacker, target) {
    const s = cfg.UNIT_STATS[attacker.kind];
    applyDamage(target, s.damage, attacker.kind, target.kind);
    if (s.venom && target.maxHp) {        // fire-ant poison; buildings (no maxHp) immune
      target.venomDps   = s.venom.dps;    // refresh, don't stack
      target.venomTimer = s.venom.duration;
    }
  }

  // Close to within range and hit on cooldown; otherwise keep approaching.
  function pursueAndStrike(u, target, dt) {
    const s = cfg.UNIT_STATS[u.kind];
    const reach = s.range + entityRadius(u) + entityRadius(target);
    if (dist(u, target) <= reach) {
      u.heading = Math.atan2(target.y - u.y, target.x - u.x);
      const [sx, sy] = separationVec(u);   // still fan out while swinging
      u.x += sx * dt; u.y += sy * dt;
      if (u.attackCooldown <= 0) {
        strike(u, target);
        u.attackCooldown = s.cooldown;
      }
    } else {
      moveToward(u, target.x, target.y, dt);
    }
  }

  function tickVenom(u, dt) {
    if (u.venomTimer > 0) {
      u.hp -= u.venomDps * dt;
      u.venomTimer -= dt;
      if (u.venomTimer <= 0) { u.venomTimer = 0; u.venomDps = 0; }
    }
  }

  /* ====================================================================
     WORKER ECONOMY
     ==================================================================== */

  function nearestNest(u) {
    let best = null, bestD = Infinity;
    for (const b of BW.state.buildings) {
      if (b.team !== u.team || b.kind !== 'nest') continue;
      const d = dist(u, b);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  function nearestFood(p) {
    let best = null, bestD = Infinity;
    for (const f of BW.state.food) {
      if (f.amount <= 0) continue;
      const d = Math.hypot(f.x - p.x, f.y - p.y);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  function workerGather(u, dt) {
    let node = BW.byId(u.order.targetId);
    if (!node || node.amount <= 0) {
      node = nearestFood(u);
      if (!node) { u.order = { type: 'idle', tx: u.x, ty: u.y, targetId: null }; return; }
      u.order.targetId = node.id;
    }
    const reach = entityRadius(node) + entityRadius(u) + 2;
    if (dist(u, node) > reach) { moveToward(u, node.x, node.y, dt); return; }

    const take = Math.min(cfg.gather.rate * dt, cfg.gather.carryCap - u.carrying, node.amount);
    u.carrying  += take;
    node.amount -= take;
    if (u.carrying >= cfg.gather.carryCap || node.amount <= 0) u.order.type = 'returning';
  }

  function workerReturn(u, dt) {
    const nest = nearestNest(u);
    if (!nest) { u.order.type = 'idle'; return; }
    const reach = entityRadius(nest) + entityRadius(u) + 2;
    if (dist(u, nest) > reach) { moveToward(u, nest.x, nest.y, dt); return; }

    if (u.team === 'player') BW.state.playerFood += u.carrying;
    u.carrying = 0;

    const node = BW.byId(u.order.targetId) || nearestFood(u);
    if (node && node.amount > 0) u.order = { type: 'gather', tx: node.x, ty: node.y, targetId: node.id };
    else u.order = { type: 'idle', tx: u.x, ty: u.y, targetId: null };
  }

  /* ====================================================================
     PER-UNIT TICK
     ==================================================================== */

  function updateUnit(u, dt) {
    if (u.attackCooldown > 0) u.attackCooldown -= dt;
    tickVenom(u, dt);
    if (u.hp <= 0) return;

    const stats = cfg.UNIT_STATS[u.kind];

    switch (u.order.type) {
      case 'gather':    workerGather(u, dt); break;
      case 'returning': workerReturn(u, dt); break;

      case 'attack': {
        const t = BW.byId(u.order.targetId);
        if (!t || t.hp <= 0) { u.order = { type: 'idle', tx: u.x, ty: u.y, targetId: null }; break; }
        pursueAndStrike(u, t, dt);
        break;
      }

      case 'attackMove': {
        const t = acquireTarget(u);                 // fight anything en route
        if (t) pursueAndStrike(u, t, dt);
        else if (moveToward(u, u.order.tx, u.order.ty, dt))
          u.order = { type: 'idle', tx: u.x, ty: u.y, targetId: null };
        break;
      }

      case 'move':
        if (moveToward(u, u.order.tx, u.order.ty, dt))
          u.order = { type: 'idle', tx: u.x, ty: u.y, targetId: null };
        break;

      case 'idle':
      default: {
        if (u.kind === 'worker') {
          // Workers gather on their own — you never have to babysit them.
          const food = nearestFood(u);
          if (food) { u.order = { type: 'gather', tx: food.x, ty: food.y, targetId: food.id }; break; }
        } else if (stats.aggro > 0) {
          // Fighters defend on their own: hit anything close, or move to
          // intercept an enemy that's menacing the nest.
          const t = acquireTarget(u) || nestThreat(u);
          if (t) { pursueAndStrike(u, t, dt); break; }
        }
        // truly nothing to do — just settle apart from neighbours
        const [sx, sy] = separationVec(u);
        u.x = clamp(u.x + sx * dt, 0, cfg.world.width);
        u.y = clamp(u.y + sy * dt, 0, cfg.world.height);
      }
    }
  }

  /* ====================================================================
     TRAINING (nests turning food into ants)
     ==================================================================== */

  function updateBuilding(b, dt) {
    if (b.trainQueue.length === 0) { b.trainTimer = 0; return; }
    if (b.trainTimer <= 0) b.trainTimer = cfg.UNIT_STATS[b.trainQueue[0]].buildTime;
    b.trainTimer -= dt;
    if (b.trainTimer <= 0) {
      const kind = b.trainQueue.shift();
      const u = BW.world.createUnit(kind, b.team, b.rallyX, b.rallyY);
      BW.state.units.push(u);
      b.trainTimer = b.trainQueue.length ? cfg.UNIT_STATS[b.trainQueue[0]].buildTime : 0;
    }
  }

  // Called by the build-panel buttons (input.js). Returns {ok, reason}.
  function tryTrain(kind) {
    const s = BW.state;
    const stat = cfg.UNIT_STATS[kind];
    const nest = s.buildings.find(b => b.team === 'player' && b.kind === 'nest');
    if (!nest) return { ok: false, reason: 'Your nest is gone' };

    const have = s.units.filter(u => u.team === 'player').length
               + s.buildings.filter(b => b.team === 'player').reduce((n, b) => n + b.trainQueue.length, 0);
    if (have >= cfg.popCap)        return { ok: false, reason: 'Population cap reached' };
    if (s.playerFood < stat.cost)  return { ok: false, reason: 'Not enough food' };

    s.playerFood -= stat.cost;
    nest.trainQueue.push(kind);
    return { ok: true };
  }

  /* ====================================================================
     MAIN UPDATE
     ==================================================================== */

  function update(dt) {
    const s = BW.state;
    if (s.phase !== 'playing') return;
    s.time += dt;
    if (s.pings) s.pings = s.pings.filter(pg => s.time - pg.t < 0.5);

    for (const u of s.units)     updateUnit(u, dt);
    for (const b of s.buildings) updateBuilding(b, dt);
    if (BW.ai) BW.ai.update(s, dt);

    BW.removeDead();
  }

  // expose
  BW.update   = update;
  BW.tryTrain = tryTrain;
  BW.systems  = { entityRadius, nearestFood, acquireTarget, dist };
})();
