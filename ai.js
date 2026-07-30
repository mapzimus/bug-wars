/* ============================================================================
   Bug Wars — ai.js   (v5: turn-based)
   ----------------------------------------------------------------------------
   Fair opponent for colony-turn play. On its turn it: assigns idle gatherers,
   trains / builds, then moves every unit once (gather, attack, or advance).
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

  function assignGatherers(team) {
    const g = gatherer(team);
    const want = { food: 0.55, mud: 0.30, honeydew: 0.15 };
    const have = { food: 0, mud: 0, honeydew: 0 };
    let assigned = 0;
    for (const w of units(team, g)) {
      const n = w.gathering != null ? BW.byId(w.gathering) : null;
      if (n && n.kind === 'node') { have[n.resource]++; assigned++; }
    }
    for (const u of units(team, g)) {
      if (u.acted) continue;
      if (u.gathering != null) {
        const n = BW.byId(u.gathering);
        if (n && n.amount > 0) { sys().actGather(u, n); continue; }
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
    }
  }

  function maybeBuild(team) {
    const base = baseOf(team); if (!base) return;
    const order = FAC(team).aiBuildOrder, essential = order[0];
    for (const kind of order) {
      if (builds(team, kind).length) continue;
      const s = cfg.BUILDING_STATS[kind];
      if (!sys().canAfford(BW.state.res[team], s.cost)) {
        if (kind === essential) return;
        else continue;
      }
      const j = (BW.state.turn.number * 1.7) % (Math.PI * 2);
      for (let a = 0; a < 28; a++) {
        const ang = j + (a / 28) * Math.PI * 2, rad = cfg.turns.tile * (1.5 + a * 0.35);
        const x = base.x + Math.cos(ang) * rad, y = base.y + Math.sin(ang) * rad * 0.7;
        if (sys().validPlacement(kind, x, y)) { BW.tryBuild(kind, team, x, y); return; }
      }
      return;
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
    let want = A.frontline;
    if ((foe.siege >= 2 || foe.flyer >= 2) && canTrain(team, A.skirmisher)) want = A.skirmisher;
    else if (foe.infantry >= 3 && canTrain(team, A.siege) && foe.infantry >= foe.skirmisher) want = A.siege;
    else if (foe.skirmisher >= 3) want = A.frontline;
    else {
      if (mine.skirmisher < mine.infantry * 0.5 && canTrain(team, A.skirmisher)) want = A.skirmisher;
      else if (canTrain(team, A.siege) && mine.siege < mine.infantry * 0.4) want = A.siege;
      else if (A.flyer && canTrain(team, A.flyer) && mine.flyer < 2) want = A.flyer;
    }
    if (want) BW.tryTrain(want, team);
  }

  function moveArmy(team) {
    const target = baseOf(opp(team));
    if (!target) return;
    const turn = BW.state.turn.number;
    const grace = prof().graceTurns;
    const a = army(team);
    const canPush = turn >= grace || target.hp < target.maxHp * 0.35 || a.length >= prof().armyThreshold;

    // Warn the human once when we commit to a push.
    if (canPush && BW.state.controllers[opp(team)] === 'human') {
      const warn = BW.state.alerts.some(al => al.type === 'incoming' && al.until > BW.state.time);
      if (!warn) {
        BW.state.alerts.push({ type: 'incoming', until: BW.state.time + 4, x: target.x, y: target.y });
        if (BW.sound) BW.sound.play('alert');
      }
    }

    for (const u of a) {
      if (u.acted) continue;
      // Prefer a kill in range (from current or after a move).
      const moves = sys().moveRange(u);
      let bestTarget = null, bestTile = null, bestScore = -Infinity;
      const consider = (gx, gy) => {
        for (const t of sys().attackTargetsFrom(u, gx, gy)) {
          // Prefer units over buildings, prefer wounded, prefer nest when pushing.
          let score = 10;
          if (cfg.UNIT_STATS[t.kind]) score += 20;
          if (cfg.BUILDING_STATS[t.kind] && cfg.BUILDING_STATS[t.kind].category === 'nest') score += canPush ? 40 : 5;
          score += (1 - t.hp / t.maxHp) * 15;
          score -= Math.abs(gx - u.gx) + Math.abs(gy - u.gy);
          if (score > bestScore) { bestScore = score; bestTarget = t; bestTile = { gx, gy }; }
        }
      };
      consider(u.gx, u.gy);
      for (const k of moves) {
        const [gx, gy] = k.split(',').map(Number);
        consider(gx, gy);
      }
      if (bestTarget) { sys().actAttack(u, bestTarget); continue; }

      if (!canPush) {
        // Hold a defensive ring near home.
        const home = baseOf(team);
        if (!home) { sys().actWait(u); continue; }
        let best = null, bestD = Infinity;
        for (const k of moves) {
          const [gx, gy] = k.split(',').map(Number);
          const d = Math.abs(Math.abs(gx - home.gx) + Math.abs(gy - home.gy) - 3);
          if (d < bestD) { bestD = d; best = { gx, gy }; }
        }
        if (best) sys().actMove(u, best.gx, best.gy);
        else sys().actWait(u);
        continue;
      }

      // Advance toward enemy nest.
      let best = null, bestD = Infinity;
      for (const k of moves) {
        const [gx, gy] = k.split(',').map(Number);
        const d = Math.abs(gx - target.gx) + Math.abs(gy - target.gy);
        if (d < bestD) { bestD = d; best = { gx, gy }; }
      }
      if (best && (best.gx !== u.gx || best.gy !== u.gy)) sys().actMove(u, best.gx, best.gy);
      else sys().actWait(u);
    }
  }

  function takeTurn(team) {
    if (!baseOf(team) || BW.state.phase !== 'playing') return;
    // Economy first (spend is free / not an "action"), then unit actions.
    maybeBuild(team);
    maybeTrain(team);
    maybeTrain(team);           // second queue slot when rich
    assignGatherers(team);
    moveArmy(team);
    // Anything still idle waits.
    for (const u of BW.state.units) if (u.team === team && !u.acted) sys().actWait(u);
  }

  BW.ai = { takeTurn };
})();
