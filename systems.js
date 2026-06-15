/* ============================================================================
   Bug Wars — systems.js   (v2)
   ----------------------------------------------------------------------------
   The BEHAVIOR layer. BW.update(dt) advances the whole simulation each tick:
   movement, the worker economy (3 resources), combat with counters, building
   training, tower fire, build placement, and win/lose. Never draws.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const idle  = u => ({ type: 'idle', tx: u.x, ty: u.y, targetId: null });
  const gathererKind = team => cfg.FACTIONS[BW.state.faction[team]].gatherer;   // 'worker' or 'drone'

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
  function cooldownOf(e) {
    if (cfg.BUILDING_STATS[e.kind]) return cfg.BUILDING_STATS[e.kind].cooldown || 1;
    return cfg.UNIT_STATS[e.kind].cooldown;
  }

  /* ---- resource bookkeeping ------------------------------------------- */
  const canAfford = (store, cost) => Object.keys(cost).every(k => store[k] >= cost[k]);
  const spend     = (store, cost) => { for (const k in cost) store[k] -= cost[k]; };

  /* ====================================================================
     MOVEMENT
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

  function moveToward(u, tx, ty, dt) {
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
      mvx = (vx / vl) * s.speed; mvy = (vy / vl) * s.speed;
      u.heading = Math.atan2(mvy, mvx);
    }
    const [sx, sy] = separationVec(u); mvx += sx; mvy += sy;
    let nx = u.x + mvx * dt, ny = u.y + mvy * dt;
    [nx, ny] = avoidObstacles(u, nx, ny);
    u.x = clamp(nx, 0, cfg.world.width); u.y = clamp(ny, 0, cfg.world.height);
    return d <= arrive;
  }

  /* ====================================================================
     COMBAT (with counters)
     ==================================================================== */
  function nearestEnemy(x, y, team, range) {
    // Prefer a live enemy UNIT in range (kill the threat first); only target an
    // enemy building when no unit is in range. (Fixes towers/defenders ignoring
    // an adjacent attacker to plink the distant nest.)
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
    let best = null, bestD = Infinity;
    for (const b of BW.state.buildings) {
      if (b.team !== team || !pred(b)) continue;
      best = best || b;  // first match is fine at this scale
    }
    return best;
  }
  function nestThreat(u) {
    const nest = nearestOwn(u.team, b => cfg.BUILDING_STATS[b.kind].category === 'nest');
    if (!nest) return null;
    return nearestEnemy(nest.x, nest.y, u.team, cfg.guardRange);
  }

  /* --------------------------------------------------------------------
     LEARNING SPOT — the damage formula. Looks up the COUNTERS table by the
     attacker's and target's class. Edit config.COUNTERS to reshape matchups.
     ------------------------------------------------------------------ */
  function applyDamage(target, base, attacker) {
    const aCls = classOf(attacker), tCls = classOf(target);
    let mult = (cfg.COUNTERS[aCls] && cfg.COUNTERS[aCls][tCls]) || 1;
    // Walls are fortifications: non-siege attackers barely scratch them.
    // Crack them with siege (which keeps its 4x building bonus) or fly over.
    const tb = cfg.BUILDING_STATS[target.kind];
    if (tb && tb.blocks && aCls !== 'siege') mult *= cfg.wallResist;
    target.hp -= base * mult;
  }
  function strike(attacker, target) {
    applyDamage(target, damageOf(attacker), attacker);
    const s = cfg.UNIT_STATS[attacker.kind];
    if (s && s.venom && target.maxHp && classOf(target) !== 'building') {   // venom is anti-unit only
      target.venomDps = s.venom.dps; target.venomTimer = s.venom.duration;
    }
    attacker.attackCooldown = cooldownOf(attacker);
  }
  function pursueAndStrike(u, target, dt) {
    const s = cfg.UNIT_STATS[u.kind];
    const reach = s.range + entityRadius(u) + entityRadius(target);
    if (dist(u, target) <= reach) {
      u.heading = Math.atan2(target.y - u.y, target.x - u.x);
      const [sx, sy] = separationVec(u);                       // fan out while swinging...
      let nx = u.x + sx * dt, ny = u.y + sy * dt;
      [nx, ny] = avoidObstacles(u, nx, ny);                    // ...but stay out of rocks
      u.x = clamp(nx, 0, cfg.world.width); u.y = clamp(ny, 0, cfg.world.height);  // ...and on the map
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
    if (!node || node.kind !== 'node' || node.amount <= 0) { u.order = idle(u); return; }
    const reach = entityRadius(node) + entityRadius(u) + 2;
    if (dist(u, node) > reach) { moveToward(u, node.x, node.y, dt); return; }
    u.carryType = node.resource;
    const take = Math.min(cfg.gather.rate[node.resource] * dt, cfg.gather.carryCap - u.carrying, node.amount);
    u.carrying += take; node.amount -= take;
    if (u.carrying >= cfg.gather.carryCap || node.amount <= 0) u.order.type = 'returning';
  }
  function workerReturn(u, dt) {
    const drop = nearestDropoff(u);
    if (!drop) { u.order = idle(u); return; }
    const reach = entityRadius(drop) + entityRadius(u) + 2;
    if (dist(u, drop) > reach) { moveToward(u, drop.x, drop.y, dt); return; }
    if (u.carrying > 0 && u.carryType) {
      let amt = u.carrying;
      if (BW.state.controllers[u.team] === 'ai') amt *= cfg.difficulties[BW.state.difficulty].ecoMult;  // mild Hard eco edge (symmetric in AI-vs-AI)
      BW.state.res[u.team][u.carryType] += amt;
    }
    u.carrying = 0; u.carryType = null;
    const node = BW.byId(u.order.targetId);
    if (node && node.kind === 'node' && node.amount > 0) u.order.type = 'gather';
    else u.order = idle(u);   // node spent → wait for new orders (player decides)
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
        if (!t || t.hp === undefined || t.hp <= 0) { u.order = idle(u); break; }
        pursueAndStrike(u, t, dt); break;
      }
      case 'attackMove': {
        const t = acquireTarget(u);
        if (t) pursueAndStrike(u, t, dt);
        else if (moveToward(u, u.order.tx, u.order.ty, dt)) u.order = idle(u);
        break;
      }
      case 'move':
        if (moveToward(u, u.order.tx, u.order.ty, dt)) u.order = idle(u);
        break;
      case 'idle':
      default: {
        const isHuman = BW.state.controllers[u.team] === 'human';
        if (u.kind === gathererKind(u.team)) {
          // Human workers auto-gather the nearest resource by default (you can
          // still drag-select and redirect them anytime). AI workers stay idle
          // for the AI controller to assign by resource ratio.
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
              if (Math.hypot(u.x - gx, u.y - gy) > 10) { moveToward(u, gx, gy, dt); break; }
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
  // A gatherer rallied onto a resource node starts mining it; anyone else walks there
  // (fighters attack-move so they engage anything on the way).
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
    if (cfg.BUILDING_STATS[b.kind].category === 'nest') {
      const g = gathererKind(b.team);
      const hasWorker = BW.state.units.some(u => u.team === b.team && u.kind === g);
      if (hasWorker) b.emergencyTimer = cfg.emergencyWorkerTime;
      else {
        b.emergencyTimer = (b.emergencyTimer == null ? cfg.emergencyWorkerTime : b.emergencyTimer) - dt;
        if (b.emergencyTimer <= 0) {
          BW.state.units.push(BW.world.createUnit(g, b.team, b.rallyX, b.rallyY));
          b.emergencyTimer = cfg.emergencyWorkerTime;
        }
      }
    }

    if (s.trains && b.trainQueue.length) {            // production
      if (b.trainTimer <= 0) b.trainTimer = cfg.UNIT_STATS[b.trainQueue[0]].buildTime;
      b.trainTimer -= dt;
      if (b.trainTimer <= 0) {
        const kind = b.trainQueue.shift();
        const u = BW.world.createUnit(kind, b.team, b.rallyX, b.rallyY);
        BW.state.units.push(u);
        sendToRally(b, u);                                // walk to the player-set rally, if any
        if (BW.sound && BW.state.controllers[b.team] === 'human') BW.sound.play('train');
        b.trainTimer = b.trainQueue.length ? cfg.UNIT_STATS[b.trainQueue[0]].buildTime : 0;
      }
    }
    if (s.aggro && b.attackCooldown <= 0) {           // tower fire
      const t = nearestEnemy(b.x, b.y, b.team, s.range + s.radius);
      if (t && dist(b, t) <= s.range + s.radius + entityRadius(t)) strike(b, t);
    }
  }

  /* ====================================================================
     TRAINING + BUILDING (player & AI use these)
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
    return { ok: true };
  }

  /* ====================================================================
     MAIN UPDATE
     ==================================================================== */
  function update(dt) {
    const s = BW.state;
    if (s.phase !== 'playing') return;
    s.time += dt;
    if (s.pings.length)  s.pings  = s.pings.filter(p => s.time - p.t < 0.5);
    if (s.alerts.length) s.alerts = s.alerts.filter(a => a.until > s.time);
    for (const n of s.nodes) {                 // resources slowly regrow
      const rg = cfg.resources[n.resource].regen;
      if (rg && n.amount < n.max) n.amount = Math.min(n.max, n.amount + rg * dt);
    }
    for (const u of s.units)     updateUnit(u, dt);
    for (const b of s.buildings) updateBuilding(b, dt);
    if (BW.ai) BW.ai.update(s, dt);
    BW.removeDead();
  }

  BW.update   = update;
  BW.tryTrain = tryTrain;
  BW.tryBuild = tryBuild;
  BW.systems  = { entityRadius, classOf, dist, canAfford, nearestEnemy, acquireTarget,
                  nearestNode, nearestDropoff, producerFor, validPlacement, countUnits, queued };
})();
