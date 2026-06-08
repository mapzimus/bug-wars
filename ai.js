/* ============================================================================
   Bug Wars — ai.js   (v3 — team-generic AND faction-generic)
   ----------------------------------------------------------------------------
   A FAIR opponent that can drive ANY team of ANY faction. It reads its faction's
   role map (gatherer / frontline / skirmisher / siege / flyer + build order) so
   the same brain plays Ants or Bees. Difficulty only scales parameters.
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

  function workerResource(u) {
    if (u.carryType) return u.carryType;
    const n = BW.byId(u.order.targetId);
    return (n && n.kind === 'node') ? n.resource : null;
  }

  function assignIdleWorkers(team) {
    const g = gatherer(team);
    const idles = units(team, g).filter(u => u.order.type === 'idle');
    if (!idles.length) return;
    const want = { food: 0.60, mud: 0.28, honeydew: 0.12 };
    const have = { food: 0, mud: 0, honeydew: 0 };
    let assigned = 0;
    for (const w of units(team, g)) { const r = workerResource(w); if (r) { have[r]++; assigned++; } }
    for (const u of idles) {
      const total = Math.max(1, assigned);
      let pick = null, best = -Infinity;
      for (const r of ['food', 'mud', 'honeydew']) {
        const gap = want[r] - have[r] / total;
        if (gap > best && sys().nearestNode(u, r)) { best = gap; pick = r; }
      }
      const node = (pick && sys().nearestNode(u, pick)) || sys().nearestNode(u);
      if (node) { u.order = { type: 'gather', tx: node.x, ty: node.y, targetId: node.id }; have[node.resource]++; assigned++; }
    }
  }

  function maybeBuild(team) {
    const base = baseOf(team); if (!base) return;
    const order = FAC(team).aiBuildOrder, essential = order[0];   // first producer is essential
    for (const kind of order) {
      if (builds(team, kind).length) continue;
      const s = cfg.BUILDING_STATS[kind];
      if (!sys().canAfford(BW.state.res[team], s.cost)) {
        if (kind === essential) return;   // save up for it
        else continue;                    // optional — try the next affordable one
      }
      const j = (BW.state.time * 0.7) % (Math.PI * 2);
      for (let a = 0; a < 22; a++) {
        const ang = j + (a / 22) * Math.PI * 2, rad = 72 + a * 9;
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
    let want = A.frontline;                                   // default frontline
    if ((foe.siege >= 2 || foe.flyer >= 2) && canTrain(team, A.skirmisher)) want = A.skirmisher;       // skirmisher > siege & anti-air
    else if (foe.infantry >= 3 && canTrain(team, A.siege) && foe.infantry >= foe.skirmisher) want = A.siege; // siege > infantry
    else if (foe.skirmisher >= 3) want = A.frontline;                                                  // infantry > skirmisher
    else {                                                    // no clear read → healthy mix
      if (mine.skirmisher < mine.infantry * 0.5 && canTrain(team, A.skirmisher)) want = A.skirmisher;
      else if (canTrain(team, A.siege) && mine.siege < mine.infantry * 0.4) want = A.siege;
      else if (A.flyer && canTrain(team, A.flyer) && mine.flyer < 2) want = A.flyer;   // bees keep a couple of hornets
    }
    if (want) BW.tryTrain(want, team);
  }

  function maybeAttack(team) {
    const t = BW.state.time, g = prof().grace;
    const target = baseOf(opp(team));
    if (!target) return;
    const a = army(team);
    const idle = a.filter(u => u.order.type === 'idle');
    const d2t = u => Math.hypot(u.x - target.x, u.y - target.y);

    const enemyHome = army(opp(team)).filter(u => d2t(u) < 280).length;
    const opportunity = target.hp < target.maxHp * 0.30 || (t > g && enemyHome === 0 && a.length >= 3);
    if (t < g && !opportunity) return;

    const lateGame = t > g + 200;                          // very long game → stop hoarding, commit all
    const eff = lateGame ? 4 : Math.max(5, prof().armyThreshold - Math.floor((t - g) / 90));
    if (!opportunity && idle.length < eff) return;

    const garrison = (opportunity || lateGame) ? 0 : Math.max(2, Math.round(eff * 0.3));
    const send = idle.slice().sort((u, v) => d2t(u) - d2t(v)).slice(0, Math.max(1, idle.length - garrison));
    for (const u of send) u.order = { type: 'attackMove', tx: target.x, ty: target.y, targetId: null };

    if (BW.state.controllers[opp(team)] === 'human') {
      const warn = BW.state.alerts.some(al => al.type === 'incoming' && al.until > BW.state.time);
      if (!warn) {
        BW.state.alerts.push({ type: 'incoming', until: BW.state.time + 6, x: target.x, y: target.y });
        if (BW.sound) BW.sound.play('alert');
      }
    }
  }

  function thinkFor(team) {
    if (!baseOf(team)) return;
    assignIdleWorkers(team);
    maybeBuild(team);
    maybeTrain(team);
    maybeAttack(team);
  }

  function update(state, dt) {
    for (const team of ['player', 'enemy']) {
      if (state.controllers[team] !== 'ai') continue;
      state.aiThink[team] -= dt;
      if (state.aiThink[team] > 0) continue;
      state.aiThink[team] = prof().thinkEvery;
      thinkFor(team);
    }
  }

  BW.ai = { update };
})();
