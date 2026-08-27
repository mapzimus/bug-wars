/* ============================================================================
   Bug Wars — ai.js   (v6: defend / raid / research)
   ----------------------------------------------------------------------------
   Fair opponent for colony-turn play. takeTurn(team, enqueue) queues each
   unit action so the play loop can animate them one-by-one.
   Builds walls, researches Honeydew tech, raids workers, and defends the nest.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const sys  = () => BW.systems;
  const prof = () => cfg.difficulties[BW.state.difficulty];
  const opp  = team => team === 'player' ? 'enemy' : 'player';
  const FAC  = team => cfg.FACTIONS[BW.state.faction[team]];
  const gatherer = team => FAC(team).gatherer;

  const units  = (team, kind) => BW.state.units.filter(u => u.team === team && (!kind || u.kind === kind));
  const builds = (team, kind) => BW.state.buildings.filter(b => b.team === team && (!kind || b.kind === kind));
  const baseOf = team => BW.state.buildings.find(b => b.team === team && cfg.BUILDING_STATS[b.kind].category === 'nest');
  const army   = team => { const g = gatherer(team); return BW.state.units.filter(u => u.team === team && u.kind !== g); };
  const canTrain = (team, kind) => kind && sys().producerFor(kind, team);

  function threatNearBase(team, radius) {
    const home = baseOf(team); if (!home) return [];
    return BW.state.units.filter(u => u.team === opp(team) && sys().tileDist(u, home) <= radius);
  }

  function nearestEnemyWorker(from, team) {
    const g = gatherer(opp(team));
    let best = null, bestD = Infinity;
    for (const u of BW.state.units) {
      if (u.team !== opp(team) || u.kind !== g) continue;
      const d = sys().tileDist(from, u);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  function nearestOutpost(from, preferNeutral) {
    let best = null, bestD = Infinity;
    for (const b of BW.state.buildings) {
      if (b.kind !== 'outpost') continue;
      if (preferNeutral && b.team) continue;
      if (!preferNeutral && b.team === from.team) continue;
      const d = sys().tileDist(from, b);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  function takeTurn(team, enqueue) {
    const run = typeof enqueue === 'function' ? enqueue : fn => fn();
    if (!baseOf(team) || BW.state.phase !== 'playing') return;

    maybeUpgrade(team);
    maybeBuild(team);
    maybeTrain(team);
    maybeTrain(team);

    // Gatherers — bias toward mud early, honeydew once fighting, food always.
    const g = gatherer(team);
    const turn = BW.state.turn.number;
    const want = turn < 4
      ? { food: 0.45, mud: 0.45, honeydew: 0.10 }
      : { food: 0.50, mud: 0.25, honeydew: 0.25 };
    const have = { food: 0, mud: 0, honeydew: 0 };
    let assigned = 0;
    for (const w of units(team, g)) {
      const n = w.gathering != null ? BW.byId(w.gathering) : null;
      if (n && n.kind === 'node') { have[n.resource]++; assigned++; }
    }
    for (const u of units(team, g)) {
      run(() => {
        if (!u || u.hp <= 0 || u.acted) return;
        // Flee if enemy adjacent.
        const threat = BW.state.units.find(e => e.team === opp(team) && sys().tileDist(e, u) <= 2);
        if (threat) {
          const home = baseOf(team);
          if (home) {
            const moves = sys().moveRange(u);
            let best = null, bestD = Infinity;
            for (const k of moves) {
              const [gx, gy] = k.split(',').map(Number);
              const d = Math.abs(gx - home.gx) + Math.abs(gy - home.gy);
              if (d < bestD) { bestD = d; best = { gx, gy }; }
            }
            if (best) { sys().actMove(u, best.gx, best.gy); return; }
          }
        }
        if (u.gathering != null) {
          const n = BW.byId(u.gathering);
          if (n && n.amount > 0) { sys().actGather(u, n); return; }
        }
        const total = Math.max(1, assigned);
        let pick = null, best = -Infinity;
        for (const r of ['food', 'mud', 'honeydew']) {
          const gap = want[r] - have[r] / total;
          if (gap > best && sys().nearestNode(u, r)) { best = gap; pick = r; }
        }
        const node = (pick && sys().nearestNode(u, pick)) || sys().nearestNode(u);
        if (node) {
          sys().actGather(u, node);
          have[node.resource]++; assigned++;
        } else sys().actWait(u);
      });
    }

    const target = baseOf(opp(team));
    const grace = prof().graceTurns;
    const a = army(team);
    const threats = threatNearBase(team, 8);
    const defending = threats.length > 0;
    const canRaid = turn >= (prof().raidTurns || grace) && a.length >= 2;
    const canPush = !!(target && !defending && (turn >= grace || target.hp < target.maxHp * 0.4 || a.length >= prof().armyThreshold));

    if (canPush && target && BW.state.controllers[opp(team)] === 'human') {
      run(() => {
        const warn = BW.state.alerts.some(al => al.type === 'incoming' && al.until > BW.state.time);
        if (!warn) {
          BW.state.alerts.push({ type: 'incoming', until: BW.state.time + 4, x: target.x, y: target.y });
          if (BW.sound) BW.sound.play('alert');
        }
      });
    }

    // Assign roles: ~1 raider, rest push/defend; prefer skirmisher/flyer for raids.
    const raiders = [];
    if (canRaid && !defending && !canPush) {
      for (const u of a) {
        const cls = cfg.UNIT_STATS[u.kind].class;
        if ((cls === 'skirmisher' || cls === 'flyer') && raiders.length < 2) raiders.push(u.id);
      }
    }

    for (const u of a) {
      run(() => {
        if (!u || u.hp <= 0 || u.acted) { if (u && !u.acted) sys().actWait(u); return; }

        const moves = sys().moveRange(u);
        const nestDist = target ? sys().tileDist(u, target) : 99;
        const committing = canPush && nestDist <= 10;
        // Can we step strictly closer to the nest this turn?
        let canClose = false;
        if (target) {
          for (const k of moves) {
            const [gx, gy] = k.split(',').map(Number);
            if (gx === u.gx && gy === u.gy) continue;
            if (Math.abs(gx - target.gx) + Math.abs(gy - target.gy) < nestDist) { canClose = true; break; }
          }
        }

        let bestTarget = null, bestScore = -Infinity;
        const consider = (gx, gy) => {
          for (const t of sys().attackTargetsFrom(u, gx, gy)) {
            const aCls = cfg.UNIT_STATS[u.kind].class;
            const tb = cfg.BUILDING_STATS[t.kind];
            if (tb && tb.blocks && aCls !== 'siege') continue;

            let score = 10;
            const cls = cfg.UNIT_STATS[t.kind] ? cfg.UNIT_STATS[t.kind].class : 'building';
            if (tb && tb.category === 'nest') score += canPush ? 120 : 8;
            else if (t.kind === 'outpost' && t.team !== team) score += committing ? 5 : 28;
            else if (cls === 'worker') score += defending || raiders.includes(u.id) ? 40 : (committing ? 5 : 14);
            else if (cfg.UNIT_STATS[t.kind]) {
              score += 18;
              if (committing && canClose) score -= 50;          // walk past if we can
              else if (committing) score += 10;                 // clear blockers if stuck
            }
            if (cls === 'siege') score += 12;
            const mult = (cfg.COUNTERS[aCls] && cfg.COUNTERS[aCls][cls]) || 1;
            score += (mult - 1) * 18;
            score += (1 - t.hp / t.maxHp) * 12;
            score -= Math.abs(gx - u.gx) + Math.abs(gy - u.gy);
            if (score > bestScore) { bestScore = score; bestTarget = t; }
          }
        };
        consider(u.gx, u.gy);
        for (const k of moves) {
          const [gx, gy] = k.split(',').map(Number);
          consider(gx, gy);
        }
        // Only take a fight if it's actually worth it (nest / raid / defense).
        if (bestTarget && bestScore >= 20) { sys().actAttack(u, bestTarget); return; }

        // Defend: move toward nearest threat / home.
        if (defending) {
          const home = baseOf(team);
          const foe = threats[0];
          const dest = foe || home;
          if (!dest) { sys().actWait(u); return; }
          let best = null, bestD = Infinity;
          for (const k of moves) {
            const [gx, gy] = k.split(',').map(Number);
            const d = Math.abs(gx - dest.gx) + Math.abs(gy - dest.gy);
            if (d < bestD) { bestD = d; best = { gx, gy }; }
          }
          if (best) sys().actMove(u, best.gx, best.gy);
          else sys().actWait(u);
          return;
        }

        // Raid: hunt workers or claim outposts.
        if (raiders.includes(u.id)) {
          const worker = nearestEnemyWorker(u, team);
          const post = nearestOutpost(u, true) || nearestOutpost(u, false);
          const dest = worker || post;
          if (dest) {
            let best = null, bestD = Infinity;
            for (const k of moves) {
              const [gx, gy] = k.split(',').map(Number);
              const d = Math.abs(gx - dest.gx) + Math.abs(gy - dest.gy);
              if (d < bestD) { bestD = d; best = { gx, gy }; }
            }
            if (best) { sys().actMove(u, best.gx, best.gy); return; }
          }
        }

        // Secure a neutral outpost with a spare fighter before full push.
        if (!canPush && turn >= 3) {
          const post = nearestOutpost(u, true);
          if (post && sys().tileDist(u, post) < 14) {
            let best = null, bestD = Infinity;
            for (const k of moves) {
              const [gx, gy] = k.split(',').map(Number);
              const d = Math.abs(gx - post.gx) + Math.abs(gy - post.gy);
              if (d < bestD) { bestD = d; best = { gx, gy }; }
            }
            if (best) { sys().actMove(u, best.gx, best.gy); return; }
          }
        }

        if (!canPush) {
          const home = baseOf(team);
          if (!home) { sys().actWait(u); return; }
          let best = null, bestD = Infinity;
          for (const k of moves) {
            const [gx, gy] = k.split(',').map(Number);
            const d = Math.abs(Math.abs(gx - home.gx) + Math.abs(gy - home.gy) - 3);
            if (d < bestD) { bestD = d; best = { gx, gy }; }
          }
          if (best) sys().actMove(u, best.gx, best.gy);
          else sys().actWait(u);
          return;
        }

        // Push nest — walk around enemy blobs toward the objective.
        let best = null, bestD = Infinity;
        for (const k of moves) {
          const [gx, gy] = k.split(',').map(Number);
          const d = Math.abs(gx - target.gx) + Math.abs(gy - target.gy);
          // Prefer tiles that get closer; slight jitter via id to spread the blob.
          const spread = ((u.id + gx + gy) % 3) * 0.1;
          if (d + spread < bestD) { bestD = d + spread; best = { gx, gy }; }
        }
        if (best && (best.gx !== u.gx || best.gy !== u.gy)) sys().actMove(u, best.gx, best.gy);
        else sys().actWait(u);
      });
    }

    run(() => {
      for (const u of BW.state.units) if (u.team === team && !u.acted) sys().actWait(u);
    });
  }

  function placeNear(team, kind, near, preferTowardEnemy) {
    const base = near || baseOf(team); if (!base) return false;
    const foe = baseOf(opp(team));
    const j = (BW.state.turn.number * 1.7) % (Math.PI * 2);
    for (let a = 0; a < 32; a++) {
      let ang = j + (a / 32) * Math.PI * 2;
      if (preferTowardEnemy && foe) ang = Math.atan2(foe.y - base.y, foe.x - base.x) + (a % 2 ? 1 : -1) * (a * 0.2);
      const rad = cfg.turns.tile * (1.2 + a * 0.3);
      const x = base.x + Math.cos(ang) * rad;
      const y = base.y + Math.sin(ang) * rad * 0.75;
      if (sys().validPlacement(kind, x, y)) {
        const r = BW.tryBuild(kind, team, x, y);
        if (r.ok) return true;
      }
    }
    return false;
  }

  function maybeBuild(team) {
    const base = baseOf(team); if (!base) return;
    const order = FAC(team).aiBuildOrder;
    const turn = BW.state.turn.number;
    const essential = order[0];
    const hasEssential = builds(team, essential).length > 0;

    // Fortify only after the first producer exists — never starve the barracks.
    const threats = threatNearBase(team, 10);
    if (hasEssential && (threats.length || turn >= (prof().wallAt || 99)) && builds(team, 'wall').length < 3) {
      if (sys().canAfford(BW.state.res[team], cfg.BUILDING_STATS.wall.cost)) {
        if (placeNear(team, 'wall', base, true)) return;
      }
    }
    if (hasEssential && threats.length && !builds(team, 'tower').length) {
      if (sys().canAfford(BW.state.res[team], cfg.BUILDING_STATS.tower.cost)) {
        if (placeNear(team, 'tower', base, true)) return;
      }
    }

    for (const kind of order) {
      if (kind === 'wall') continue;
      if (builds(team, kind).length) continue;
      const s = cfg.BUILDING_STATS[kind];
      if (!sys().canAfford(BW.state.res[team], s.cost)) {
        if (kind === essential) return;
        else continue;
      }
      if (placeNear(team, kind, base, kind === 'tower')) return;
      return;
    }
  }

  function maybeUpgrade(team) {
    if (BW.state.turn.number < (prof().researchAt || 6)) return;
    const menu = FAC(team).upgradeMenu || [];
    const bag = BW.state.upgrades[team];
    // Prefer forage early, then faction signature, then combat.
    const prefer = ['forage', 'tunnels', 'jelly', 'ironshell', 'potent', 'mandibles', 'chitin'];
    const ordered = [...prefer.filter(k => menu.includes(k)), ...menu];
    for (const key of ordered) {
      if (bag[key]) continue;
      const up = cfg.UPGRADES[key];
      if (!up) continue;
      if (sys().canAfford(BW.state.res[team], up.cost)) {
        BW.tryUpgrade(key, team);
        return;
      }
    }
  }

  function classCounts(arr) {
    const c = { infantry: 0, skirmisher: 0, siege: 0, flyer: 0 };
    for (const u of arr) { const k = cfg.UNIT_STATS[u.kind].class; if (c[k] !== undefined) c[k]++; }
    return c;
  }
  function maybeTrain(team) {
    const g = gatherer(team), A = FAC(team).army;
    if (units(team, g).length < prof().workerTarget) { BW.tryTrain(g, team); return; }
    if (!canTrain(team, A.frontline)) return;
    const mine = classCounts(army(team)), foe = classCounts(army(opp(team)));
    const threats = threatNearBase(team, 8);
    let want = A.frontline;
    if (threats.length && canTrain(team, A.frontline)) want = A.frontline;
    else if ((foe.siege >= 2 || foe.flyer >= 2) && canTrain(team, A.skirmisher)) want = A.skirmisher;
    else if (foe.infantry >= 3 && canTrain(team, A.siege)) want = A.siege;
    else if (foe.skirmisher >= 3) want = A.frontline;
    else {
      if (canTrain(team, A.siege) && mine.siege < Math.max(1, Math.floor(mine.infantry * 0.45))) want = A.siege;
      else if (mine.skirmisher < mine.infantry * 0.5 && canTrain(team, A.skirmisher)) want = A.skirmisher;
      else if (A.flyer && canTrain(team, A.flyer) && mine.flyer < 3) want = A.flyer;
    }
    if (want) BW.tryTrain(want, team);
  }

  BW.ai = { takeTurn };
})();
