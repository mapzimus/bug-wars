/* ============================================================================
   Bug Wars — systems.js   (v5)
   ----------------------------------------------------------------------------
   The BEHAVIOR layer. BW.update(dt) advances the whole simulation each tick:
   movement, the worker economy (3 resources), combat with counters, building
   training, research, tower fire, build placement, and win/lose. Never draws.

   v5 adds:
     · NAVIGATION — units follow A* paths (pathfinding.js) around walls & rocks
     · UPGRADES   — research multipliers applied to damage / hp / armor / eco
     · ORDER QUEUES — shift-click chains orders; stop & hold-position stances
     · COMBAT FX  — the sim emits hit/tracer/damage events for render.js
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const gathererKind = team => cfg.FACTIONS[BW.state.faction[team]].gatherer;

  // A fresh idle order. Units keep their queue; `idle` only ends the CURRENT order.
  const idle = u => ({ type: 'idle', tx: u.x, ty: u.y, targetId: null });

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

  /* ====================================================================
     UPGRADES — multiplier lookup
     --------------------------------------------------------------------
     LEARNING SPOT: every research a colony owns contributes a multiplier for
     some stat key. Multiplying them together keeps stacking predictable and
     means an upgrade is pure data in config.UPGRADES — no code per upgrade.
     ==================================================================== */
  function upgMul(team, key) {
    const owned = BW.state.upgrades && BW.state.upgrades[team];
    if (!owned || !owned.size) return 1;
    let m = 1;
    for (const id of owned) {
      const u = cfg.UPGRADES[id];
      if (u && u.effect && u.effect[key] != null) m *= u.effect[key];
    }
    return m;
  }
  // Total max-HP multiplier for a unit kind (flyers get the bee bonus on top).
  function hpMulFor(team, kind) {
    const s = cfg.UNIT_STATS[kind];
    if (!s || s.class === 'worker') return 1;                 // workers don't get combat upgrades
    let m = upgMul(team, 'hp');
    if (s.flying) m *= upgMul(team, 'flyerHp');
    return m;
  }
  function speedOf(u) { return cfg.UNIT_STATS[u.kind].speed * upgMul(u.team, 'moveSpeed'); }

  function damageOf(e) {
    if (cfg.BUILDING_STATS[e.kind]) return cfg.BUILDING_STATS[e.kind].damage || 0;   // towers are not upgraded
    const s = cfg.UNIT_STATS[e.kind];
    if (s.class === 'worker') return s.damage;
    return s.damage * upgMul(e.team, 'damage');
  }
  function cooldownOf(e) {
    if (cfg.BUILDING_STATS[e.kind]) return cfg.BUILDING_STATS[e.kind].cooldown || 1;
    return cfg.UNIT_STATS[e.kind].cooldown;
  }
  function buildTimeOf(kind, team) {
    return cfg.UNIT_STATS[kind].buildTime * upgMul(team, 'trainSpeed');
  }
  const carryCapOf  = team => cfg.gather.carryCap * upgMul(team, 'carry');
  const gatherRateOf = (team, res) => cfg.gather.rate[res] * upgMul(team, 'gather');

  // Give a newly-created unit the colony's current HP research.
  function applyUpgradesToUnit(u) {
    const m = hpMulFor(u.team, u.kind);
    if (m !== 1) { u.maxHp = Math.round(u.maxHp * m); u.hp = u.maxHp; }
    return u;
  }

  /* ---- combat FX (the sim EMITS, render.js draws) ---------------------- */
  function fx(entry) {
    const s = BW.state;
    if (!s.fx) s.fx = [];
    if (s.fx.length > 260) s.fx.shift();          // hard cap — never let FX grow unbounded
    entry.born = s.time;
    s.fx.push(entry);
  }

  /* ---- resource bookkeeping ------------------------------------------- */
  const canAfford = (store, cost) => Object.keys(cost).every(k => store[k] >= cost[k]);
  const spend     = (store, cost) => { for (const k in cost) store[k] -= cost[k]; };
  const refund    = (store, cost) => { for (const k in cost) store[k] += cost[k]; };

  /* ====================================================================
     MOVEMENT — navigation (A* waypoints) + local steering
     ==================================================================== */
  function separationVec(u) {
    const r = cfg.separationRadius;
    let px = 0, py = 0;
    for (const o of BW.state.units) {
      if (o === u) continue;
      const dx = u.x - o.x, dy = u.y - o.y, d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < r * r) { const d = Math.sqrt(d2), k = (r - d) / r; px += (dx / d) * k; py += (dy / d) * k; }
    }
    return [px * 45, py * 45];
  }

  // Push a position out of rocks AND blocking walls. Two relaxation passes so a
  // unit squeezed between two blockers isn't shoved straight back into one.
  function avoidObstacles(u, nx, ny) {
    if (cfg.UNIT_STATS[u.kind] && cfg.UNIT_STATS[u.kind].flying) return [nx, ny];  // flyers ignore rocks & walls
    const rad = entityRadius(u);
    const push = (ox, oy, orr) => {
      const dx = nx - ox, dy = ny - oy, d = Math.hypot(dx, dy) || 1, min = orr + rad;
      if (d < min) { nx = ox + (dx / d) * min; ny = oy + (dy / d) * min; }
    };
    for (let pass = 0; pass < 2; pass++) {
      for (const o of BW.state.obstacles) push(o.x, o.y, o.r);
      for (const b of BW.state.buildings) if (cfg.BUILDING_STATS[b.kind].blocks) push(b.x, b.y, entityRadius(b));
    }
    return [nx, ny];
  }

  // Straight-line move with local avoidance. This is the old v4 mover — it now
  // steers toward the next PATH WAYPOINT rather than the distant final goal.
  function moveDirect(u, tx, ty, dt) {
    const s = cfg.UNIT_STATS[u.kind];
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy) || 1, arrive = 5;
    let mvx = 0, mvy = 0;
    if (d > arrive) {
      let vx = dx / d, vy = dy / d;                       // desired direction
      const rad = entityRadius(u);
      const steer = (ox, oy, orr) => {                    // slide around a blocker on the path ahead
        const rx = ox - u.x, ry = oy - u.y, rd = Math.hypot(rx, ry) || 1;
        if (rx * vx + ry * vy > 0 && rd < orr + rad + 30) {        // it's ahead and close
          const side = (rx * -vy + ry * vx) > 0 ? -1 : 1;          // pick the near side to round
          const tnx = -vy, tny = vx;                               // tangent (snapshot)
          vx += side * tnx * 1.6; vy += side * tny * 1.6;
        }
      };
      if (!s.flying) {                                     // flyers don't dodge ground blockers
        for (const o of BW.state.obstacles) steer(o.x, o.y, o.r);
        for (const b of BW.state.buildings) if (cfg.BUILDING_STATS[b.kind].blocks) steer(b.x, b.y, entityRadius(b));
      }
      const vl = Math.hypot(vx, vy) || 1;
      const sp = speedOf(u);
      mvx = (vx / vl) * sp; mvy = (vy / vl) * sp;
      u.heading = Math.atan2(mvy, mvx);
    }
    const [sx, sy] = separationVec(u); mvx += sx; mvy += sy;
    let nx = u.x + mvx * dt, ny = u.y + mvy * dt;
    [nx, ny] = avoidObstacles(u, nx, ny);
    u.x = clamp(nx, 0, cfg.world.width); u.y = clamp(ny, 0, cfg.world.height);
    return d <= arrive;
  }

  /* --------------------------------------------------------------------
     LEARNING SPOT — navigation. Keep an A* path toward the goal, walk its
     waypoints, and re-plan when the goal moves or the path goes stale. If the
     pathfinder is out of budget (or the goal is unreachable) we fall back to
     plain steering, so movement degrades gracefully instead of freezing.
     ------------------------------------------------------------------ */
  const WAYPOINT_REACH = 18;

  function moveToward(u, tx, ty, dt) {
    const s = cfg.UNIT_STATS[u.kind];
    if (s.flying || !BW.path) return moveDirect(u, tx, ty, dt);    // flyers go as the hornet flies

    u.repathTimer = (u.repathTimer || 0) - dt;
    const goalMoved = !u.pathGoal || Math.hypot(u.pathGoal.x - tx, u.pathGoal.y - ty) > 48;
    if (goalMoved || !u.path || u.repathTimer <= 0) {
      const p = BW.path.find(u.x, u.y, tx, ty);
      if (p) {
        u.path = p; u.pathIdx = 0;
        u.pathGoal = { x: tx, y: ty };
        u.repathTimer = cfg.pathfinding.repathEvery;
      } else {
        // Out of search budget or unreachable — steer directly and retry soon.
        u.pathGoal = { x: tx, y: ty };
        u.repathTimer = 0.35;
        if (goalMoved) { u.path = null; u.pathIdx = 0; }
      }
    }

    let wx = tx, wy = ty;
    if (u.path && u.path.length) {
      while (u.pathIdx < u.path.length - 1 &&
             Math.hypot(u.x - u.path[u.pathIdx].x, u.y - u.path[u.pathIdx].y) < WAYPOINT_REACH) u.pathIdx++;
      const wp = u.path[Math.min(u.pathIdx, u.path.length - 1)];
      wx = wp.x; wy = wp.y;
    }
    moveDirect(u, wx, wy, dt);
    // Arrival is judged against the REAL destination, not the waypoint.
    const done = Math.hypot(u.x - tx, u.y - ty) <= 6;
    if (done) { u.path = null; u.pathGoal = null; }
    return done;
  }
  const clearPath = u => { u.path = null; u.pathGoal = null; u.pathIdx = 0; };

  /* ====================================================================
     ORDERS — current order + a shift-queued backlog
     ==================================================================== */
  // Finish the current order: pull the next queued one, else go idle.
  function finishOrder(u) {
    clearPath(u);
    if (u.queue && u.queue.length) u.order = u.queue.shift();
    else u.order = idle(u);
  }
  // Replace everything (a plain right-click) or append (shift right-click).
  function giveOrder(u, order, queued) {
    if (queued && u.order && u.order.type !== 'idle' && u.order.type !== 'hold') {
      (u.queue = u.queue || []).push(order);
    } else {
      u.queue = [];
      u.order = order;
      clearPath(u);
    }
  }

  /* ====================================================================
     COMBAT (with counters)
     ==================================================================== */
  function nearestEnemy(x, y, team, range) {
    // Prefer a live enemy UNIT in range (kill the threat first); only target an
    // enemy building when no unit is in range.
    let bestU = null, bU = range;
    for (const o of BW.state.units) {
      if (o.team === team) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < bU) { bU = d; bestU = o; }
    }
    if (bestU) return bestU;
    let bestB = null, bB = range;
    for (const b of BW.state.buildings) {
      if (b.team === team) continue;
      const d = Math.max(0, Math.hypot(b.x - x, b.y - y) - entityRadius(b));   // edge distance, never negative
      if (d < bB) { bB = d; bestB = b; }
    }
    return bestB;
  }
  const acquireTarget = u => nearestEnemy(u.x, u.y, u.team, cfg.UNIT_STATS[u.kind].aggro);

  function nearestOwn(team, pred) {
    for (const b of BW.state.buildings) if (b.team === team && pred(b)) return b;
    return null;
  }
  function nestThreat(u) {
    const nest = nearestOwn(u.team, b => cfg.BUILDING_STATS[b.kind].category === 'nest');
    if (!nest) return null;
    return nearestEnemy(nest.x, nest.y, u.team, cfg.guardRange);
  }

  /* --------------------------------------------------------------------
     LEARNING SPOT — the damage formula. Looks up the COUNTERS table by the
     attacker's and target's class, then applies wall resistance and the
     defender's armor research. Edit config.COUNTERS to reshape matchups.
     ------------------------------------------------------------------ */
  function applyDamage(target, base, attacker) {
    const aCls = classOf(attacker), tCls = classOf(target);
    let mult = (cfg.COUNTERS[aCls] && cfg.COUNTERS[aCls][tCls]) || 1;
    // Walls are fortifications: non-siege attackers barely scratch them.
    const tb = cfg.BUILDING_STATS[target.kind];
    if (tb && tb.blocks && aCls !== 'siege') mult *= cfg.wallResist;
    // Armor research protects UNITS (not structures).
    if (!tb) mult *= upgMul(target.team, 'armor');
    const dealt = base * mult;
    target.hp -= dealt;
    return dealt;
  }

  function strike(attacker, target) {
    const dealt = applyDamage(target, damageOf(attacker), attacker);
    const s = cfg.UNIT_STATS[attacker.kind];
    if (s && s.venom && target.maxHp && classOf(target) !== 'building') {   // venom is anti-unit only
      target.venomDps = s.venom.dps * upgMul(attacker.team, 'venom');
      target.venomTimer = s.venom.duration;
    }
    attacker.attackCooldown = cooldownOf(attacker);

    // --- emit the visuals: a tracer from attacker to target, a hit spark, and
    // a floating damage number. render.js consumes these; the sim never draws.
    fx({ kind: 'tracer', x: attacker.x, y: attacker.y, x2: target.x, y2: target.y, team: attacker.team });
    fx({ kind: 'hit', x: target.x, y: target.y });
    fx({ kind: 'dmg', x: target.x, y: target.y - entityRadius(target) - 4,
         text: '-' + Math.max(1, Math.round(dealt)), crit: dealt > damageOf(attacker) * 1.25, team: attacker.team });
  }

  function pursueAndStrike(u, target, dt) {
    const s = cfg.UNIT_STATS[u.kind];
    const reach = s.range + entityRadius(u) + entityRadius(target);
    if (dist(u, target) <= reach) {
      clearPath(u);
      u.heading = Math.atan2(target.y - u.y, target.x - u.x);
      const [sx, sy] = separationVec(u);                       // fan out while swinging...
      let nx = u.x + sx * dt, ny = u.y + sy * dt;
      [nx, ny] = avoidObstacles(u, nx, ny);                    // ...but stay out of rocks
      u.x = clamp(nx, 0, cfg.world.width); u.y = clamp(ny, 0, cfg.world.height);
      if (u.attackCooldown <= 0) strike(u, target);
    } else moveToward(u, target.x, target.y, dt);
  }
  function tickVenom(u, dt) {
    if (u.venomTimer > 0) { u.hp -= u.venomDps * dt; u.venomTimer -= dt; if (u.venomTimer <= 0) { u.venomTimer = 0; u.venomDps = 0; } }
  }

  /* ====================================================================
     WORKER ECONOMY (3 resources, player-driven)
     ==================================================================== */
  function nearestDropoff(u) {
    let best = null, bestD = Infinity;
    for (const b of BW.state.buildings) {
      if (b.team !== u.team || !cfg.BUILDING_STATS[b.kind].drop) continue;
      const d = dist(u, b); if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }
  function nearestNode(p, resource) {
    let best = null, bestD = Infinity;
    for (const n of BW.state.nodes) {
      if (n.amount <= 0 || (resource && n.resource !== resource)) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function workerGather(u, dt) {
    const node = BW.byId(u.order.targetId);
    if (!node || node.kind !== 'node' || node.amount <= 0) { finishOrder(u); return; }
    const reach = entityRadius(node) + entityRadius(u) + 2;
    if (dist(u, node) > reach) { moveToward(u, node.x, node.y, dt); return; }
    clearPath(u);
    u.carryType = node.resource;
    const cap = carryCapOf(u.team);
    const take = Math.min(gatherRateOf(u.team, node.resource) * dt, cap - u.carrying, node.amount);
    u.carrying += take; node.amount -= take;
    if (u.carrying >= cap || node.amount <= 0) u.order.type = 'returning';
  }
  function workerReturn(u, dt) {
    const drop = nearestDropoff(u);
    if (!drop) { finishOrder(u); return; }
    const reach = entityRadius(drop) + entityRadius(u) + 2;
    if (dist(u, drop) > reach) { moveToward(u, drop.x, drop.y, dt); return; }
    clearPath(u);
    if (u.carrying > 0 && u.carryType) {
      let amt = u.carrying;
      if (BW.state.controllers[u.team] === 'ai') amt *= cfg.difficulties[BW.state.difficulty].ecoMult;  // mild Hard eco edge (symmetric in AI-vs-AI)
      BW.state.res[u.team][u.carryType] += amt;
      if (BW.state.controllers[u.team] === 'human') fx({ kind: 'deposit', x: drop.x, y: drop.y - 24, res: u.carryType, text: '+' + Math.round(amt) });
    }
    u.carrying = 0; u.carryType = null;
    const node = BW.byId(u.order.targetId);
    if (node && node.kind === 'node' && node.amount > 0) u.order.type = 'gather';
    else finishOrder(u);   // node spent → next queued order, else wait for the player
  }

  /* ====================================================================
     PER-UNIT + PER-BUILDING TICKS
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
        if (!t || t.hp === undefined || t.hp <= 0) { finishOrder(u); break; }
        pursueAndStrike(u, t, dt); break;
      }
      case 'attackMove': {
        const t = acquireTarget(u);
        if (t) pursueAndStrike(u, t, dt);
        else if (moveToward(u, u.order.tx, u.order.ty, dt)) finishOrder(u);
        break;
      }
      case 'move':
        if (moveToward(u, u.order.tx, u.order.ty, dt)) finishOrder(u);
        break;

      // HOLD POSITION: fight anything that comes into range, but never chase.
      case 'hold': {
        const t = acquireTarget(u);
        if (t) {
          const reach = stats.range + entityRadius(u) + entityRadius(t);
          if (dist(u, t) <= reach) {
            u.heading = Math.atan2(t.y - u.y, t.x - u.x);
            if (u.attackCooldown <= 0) strike(u, t);
          }
        }
        break;   // deliberately no movement at all — that is the point of hold
      }

      case 'idle':
      default: {
        const isHuman = BW.state.controllers[u.team] === 'human';
        if (u.kind === gathererKind(u.team)) {
          // Human workers auto-return to gathering the nearest resource so you
          // are never babysitting an idle worker line — but WHAT to gather and
          // where to expand stays your call (see CLAUDE.md: automate tedium,
          // never decisions).
          if (isHuman) {
            const node = nearestNode(u);
            if (node) { u.order = { type: 'gather', tx: node.x, ty: node.y, targetId: node.id }; break; }
          }
        } else if (stats.aggro > 0) {
          const t = acquireTarget(u) || nestThreat(u);
          if (t) { pursueAndStrike(u, t, dt); break; }           // engage a threat first
          if (isHuman) {                                          // otherwise hold a guard ring at home
            const nest = nearestOwn(u.team, b => cfg.BUILDING_STATS[b.kind].category === 'nest');
            if (nest && dist(u, nest) <= cfg.guardHomeRange) {
              const a = u.id * 2.39996;                           // golden angle → soldiers fan around the ring
              const gx = nest.x + Math.cos(a) * cfg.guardRadius, gy = nest.y + Math.sin(a) * cfg.guardRadius;
              if (Math.hypot(u.x - gx, u.y - gy) > 10) { moveDirect(u, gx, gy, dt); break; }
            }
          }
        }
        const [sx, sy] = separationVec(u);
        let nx = u.x + sx * dt, ny = u.y + sy * dt;
        [nx, ny] = avoidObstacles(u, nx, ny);
        u.x = clamp(nx, 0, cfg.world.width); u.y = clamp(ny, 0, cfg.world.height);
      }
    }
  }

  // Route a freshly-trained unit to its building's RALLY point, if the player set one.
  function sendToRally(b, u) {
    if (!b.rally) return;
    const isG = u.kind === gathererKind(b.team);
    const node = b.rally.nodeId != null ? BW.byId(b.rally.nodeId) : null;
    if (isG && node && node.kind === 'node' && node.amount > 0) u.order = { type: 'gather', tx: node.x, ty: node.y, targetId: node.id };
    else u.order = { type: isG ? 'move' : 'attackMove', tx: b.rally.x, ty: b.rally.y, targetId: null };
  }

  function updateBuilding(b, dt) {
    const s = cfg.BUILDING_STATS[b.kind];
    if (b.attackCooldown > 0) b.attackCooldown -= dt;

    // Anti-softlock: a nest with NO living workers slowly hatches a FREE one,
    // so losing your whole worker line is recoverable, not game over.
    if (s.category === 'nest') {
      const g = gathererKind(b.team);
      const hasWorker = BW.state.units.some(u => u.team === b.team && u.kind === g);
      if (hasWorker) b.emergencyTimer = cfg.emergencyWorkerTime;
      else {
        b.emergencyTimer = (b.emergencyTimer == null ? cfg.emergencyWorkerTime : b.emergencyTimer) - dt;
        if (b.emergencyTimer <= 0) {
          BW.state.units.push(applyUpgradesToUnit(BW.world.createUnit(g, b.team, b.rallyX, b.rallyY)));
          b.emergencyTimer = cfg.emergencyWorkerTime;
        }
      }
    }

    if (s.trains && b.trainQueue.length) {            // production
      if (b.trainTimer <= 0) b.trainTimer = buildTimeOf(b.trainQueue[0], b.team);
      b.trainTimer -= dt;
      if (b.trainTimer <= 0) {
        const kind = b.trainQueue.shift();
        const u = applyUpgradesToUnit(BW.world.createUnit(kind, b.team, b.rallyX, b.rallyY));
        BW.state.units.push(u);
        sendToRally(b, u);                                // walk to the player-set rally, if any
        if (BW.sound && BW.state.controllers[b.team] === 'human') BW.sound.play('train');
        b.trainTimer = b.trainQueue.length ? buildTimeOf(b.trainQueue[0], b.team) : 0;
      }
    }
    if (s.aggro && b.attackCooldown <= 0) {           // tower fire
      const t = nearestEnemy(b.x, b.y, b.team, s.range + s.radius);
      if (t && dist(b, t) <= s.range + s.radius + entityRadius(t)) strike(b, t);
    }
  }

  /* ====================================================================
     TRAINING + BUILDING + RESEARCH (player & AI use these)
     ==================================================================== */
  const countUnits = team => BW.state.units.filter(u => u.team === team).length;
  const queued     = team => BW.state.buildings.filter(b => b.team === team)
                              .reduce((n, b) => n + (b.trainQueue ? b.trainQueue.length : 0), 0);
  function producerFor(kind, team) {
    return nearestOwn(team, b => cfg.BUILDING_STATS[b.kind].trains && cfg.BUILDING_STATS[b.kind].trains.includes(kind));
  }

  function tryTrain(kind, team) {
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
    return { ok: true };
  }

  // Cancel the LAST queued unit of this kind and refund it (right-click a train
  // button). Never cancels the one already in progress at the head of the queue
  // unless it is the only entry.
  function cancelTrain(kind, team) {
    const producer = producerFor(kind, team);
    if (!producer || !producer.trainQueue.length) return { ok: false, reason: 'Nothing queued' };
    const i = producer.trainQueue.lastIndexOf(kind);
    if (i < 0) return { ok: false, reason: 'Nothing queued' };
    producer.trainQueue.splice(i, 1);
    if (i === 0) producer.trainTimer = producer.trainQueue.length ? buildTimeOf(producer.trainQueue[0], team) : 0;
    refund(BW.state.res[team], cfg.UNIT_STATS[kind].cost);
    return { ok: true };
  }

  function validPlacement(kind, x, y) {
    const r = cfg.BUILDING_STATS[kind].radius, W = cfg.world.width, H = cfg.world.height;
    if (x < r || y < r || x > W - r || y > H - r) return false;
    for (const o of BW.state.obstacles) if (Math.hypot(x - o.x, y - o.y) < o.r + r) return false;
    for (const b of BW.state.buildings) if (Math.hypot(x - b.x, y - b.y) < entityRadius(b) + r + 4) return false;
    for (const n of BW.state.nodes) if (Math.hypot(x - n.x, y - n.y) < entityRadius(n) + r + 2) return false;
    return true;
  }
  function tryBuild(kind, team, x, y) {
    const s = cfg.BUILDING_STATS[kind];
    if (!canAfford(BW.state.res[team], s.cost)) return { ok: false, reason: 'Not enough Mud' };
    if (!validPlacement(kind, x, y)) return { ok: false, reason: "Can't build there" };
    spend(BW.state.res[team], s.cost);
    BW.state.buildings.push(BW.world.createBuilding(kind, team, x, y));
    if (s.blocks && BW.path) BW.path.markDirty();       // a new wall changes the nav grid
    return { ok: true };
  }

  /* ---- research -------------------------------------------------------
     One research at a time per colony. `at` names a ROLE so the same upgrade
     table works for every faction: base | prod0 | prod1. */
  function researchBuildingKind(team, at) {
    const F = cfg.FACTIONS[BW.state.faction[team]];
    if (at === 'base') return F.base;
    if (at === 'prod0') return F.producers[0];
    return F.producers[1];
  }
  // Which upgrades this colony could see in its menu (faction-gated).
  function availableUpgrades(team) {
    const fac = BW.state.faction[team];
    return Object.keys(cfg.UPGRADES).filter(id => {
      const u = cfg.UPGRADES[id];
      return !u.faction || u.faction === fac;
    });
  }
  function researchState(id, team) {
    const u = cfg.UPGRADES[id];
    const owned = BW.state.upgrades[team];
    if (!u) return { ok: false, reason: 'Unknown upgrade' };
    if (u.faction && u.faction !== BW.state.faction[team]) return { ok: false, reason: 'Not for your colony' };
    if (owned.has(id)) return { ok: false, reason: 'Already researched' };
    if (u.requires && !owned.has(u.requires)) return { ok: false, reason: 'Needs ' + cfg.UPGRADES[u.requires].name };
    if (BW.state.research[team]) return { ok: false, reason: 'Already researching' };
    const kind = researchBuildingKind(team, u.at);
    const at = nearestOwn(team, b => b.kind === kind);
    if (!at) return { ok: false, reason: 'Build a ' + kind.charAt(0).toUpperCase() + kind.slice(1) + ' first' };
    if (!canAfford(BW.state.res[team], u.cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true, at };
  }
  function tryResearch(id, team) {
    const chk = researchState(id, team);
    if (!chk.ok) return chk;
    const u = cfg.UPGRADES[id];
    spend(BW.state.res[team], u.cost);
    BW.state.research[team] = { id, timeLeft: u.time, total: u.time, buildingId: chk.at.id };
    return { ok: true };
  }
  function cancelResearch(team) {
    const r = BW.state.research[team];
    if (!r) return { ok: false, reason: 'Nothing researching' };
    refund(BW.state.res[team], cfg.UPGRADES[r.id].cost);
    BW.state.research[team] = null;
    return { ok: true };
  }
  function completeResearch(team) {
    const r = BW.state.research[team];
    const u = cfg.UPGRADES[r.id];
    BW.state.upgrades[team].add(r.id);
    BW.state.research[team] = null;
    // HP research is RETROACTIVE — apply it to the army already on the field,
    // scaling current hp by the same factor so nobody heals or drops to zero.
    if (u.effect && (u.effect.hp || u.effect.flyerHp)) {
      const factor = k => (u.effect.hp || 1) * ((cfg.UNIT_STATS[k].flying && u.effect.flyerHp) ? u.effect.flyerHp : 1);
      for (const unit of BW.state.units) {
        if (unit.team !== team || cfg.UNIT_STATS[unit.kind].class === 'worker') continue;
        const f = factor(unit.kind);
        if (f === 1) continue;
        const ratio = unit.hp / unit.maxHp;
        unit.maxHp = Math.round(unit.maxHp * f);
        unit.hp = unit.maxHp * ratio;
      }
    }
    if (BW.state.controllers[team] === 'human') {
      if (BW.sound) BW.sound.play('build');
      if (BW.toast) BW.toast('Research complete: ' + u.name);
    }
  }
  function tickResearch(team, dt) {
    const r = BW.state.research[team];
    if (!r) return;
    const at = BW.byId(r.buildingId);
    if (!at) { BW.state.research[team] = null; return; }   // building destroyed → research lost
    r.timeLeft -= dt;
    if (r.timeLeft <= 0) completeResearch(team);
  }

  /* ====================================================================
     MAIN UPDATE
     ==================================================================== */
  function update(dt) {
    const s = BW.state;
    if (s.phase !== 'playing') return;
    s.time += dt;
    if (BW.path) BW.path.beginTick();                 // refill the A* search budget

    if (s.pings.length)  s.pings  = s.pings.filter(p => s.time - p.t < 0.5);
    if (s.alerts.length) s.alerts = s.alerts.filter(a => a.until > s.time);
    if (s.fx && s.fx.length) s.fx  = s.fx.filter(f => s.time - f.born < 1.1);

    for (const n of s.nodes) {                 // resources slowly regrow
      const rg = cfg.resources[n.resource].regen;
      if (rg && n.amount < n.max) n.amount = Math.min(n.max, n.amount + rg * dt);
    }
    for (const u of s.units)     updateUnit(u, dt);
    for (const b of s.buildings) updateBuilding(b, dt);
    tickResearch('player', dt); tickResearch('enemy', dt);
    if (BW.ai) BW.ai.update(s, dt);
    BW.removeDead();
  }

  BW.update   = update;
  BW.tryTrain = tryTrain;
  BW.tryBuild = tryBuild;
  BW.cancelTrain = cancelTrain;
  BW.tryResearch = tryResearch;
  BW.cancelResearch = cancelResearch;
  BW.systems  = { entityRadius, classOf, dist, canAfford, nearestEnemy, acquireTarget,
                  nearestNode, nearestDropoff, producerFor, validPlacement, countUnits, queued,
                  upgMul, hpMulFor, damageOf, buildTimeOf, carryCapOf, gatherRateOf,
                  applyUpgradesToUnit, availableUpgrades, researchState, researchBuildingKind,
                  giveOrder, finishOrder, idle, fx, moveToward, speedOf };
})();
