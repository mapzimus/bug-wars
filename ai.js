/* ============================================================================
   Bug Wars — ai.js   (v2.1 — team-generic)
   ----------------------------------------------------------------------------
   A FAIR opponent that can drive ANY team. The same controller runs for the
   'enemy' colony and, in AI-vs-AI mode, for the 'player' colony too — which
   makes it a balance/testing harness as well as the opponent.

   It plays by the same rules you do: its workers gather real resources, which
   it spends to build and train. Difficulty only scales parameters (no cheating).
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const sys  = () => BW.systems;
  const prof = () => cfg.difficulties[BW.state.difficulty];
  const opp  = team => team === 'player' ? 'enemy' : 'player';

  const units  = (team, kind) => BW.state.units.filter(u => u.team === team && (!kind || u.kind === kind));
  const builds = (team, kind) => BW.state.buildings.filter(b => b.team === team && (!kind || b.kind === kind));
  const army   = team => BW.state.units.filter(u => u.team === team && u.kind !== 'worker');

  function workerResource(u) {
    if (u.carryType) return u.carryType;
    const n = BW.byId(u.order.targetId);
    return (n && n.kind === 'node') ? n.resource : null;
  }

  function assignIdleWorkers(team) {
    const idles = units(team, 'worker').filter(u => u.order.type === 'idle');
    if (!idles.length) return;
    const want = { food: 0.60, mud: 0.28, honeydew: 0.12 };
    const ws = units(team, 'worker');
    const have = { food: 0, mud: 0, honeydew: 0 };
    for (const w of ws) { const r = workerResource(w); if (r) have[r]++; }
    const total = ws.length || 1;
    for (const u of idles) {
      let pick = null, best = -Infinity;
      for (const r of ['food', 'mud', 'honeydew']) {
        const gap = want[r] - have[r] / total;
        if (gap > best && sys().nearestNode(u, r)) { best = gap; pick = r; }
      }
      const node = (pick && sys().nearestNode(u, pick)) || sys().nearestNode(u);
      if (node) { u.order = { type: 'gather', tx: node.x, ty: node.y, targetId: node.id }; have[node.resource]++; }
    }
  }

  function maybeBuild(team) {
    for (const kind of ['barracks', 'tower', 'workshop']) {
      if (builds(team, kind).length) continue;
      const s = cfg.BUILDING_STATS[kind];
      if (!sys().canAfford(BW.state.res[team], s.cost)) return;   // wait, don't skip
      const nest = builds(team, 'nest')[0]; if (!nest) return;
      const toward = opp(team) === 'enemy' ? -1 : 1;              // build slightly toward home edge
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const rad = 70 + a * 7;
        const x = nest.x + Math.cos(ang) * rad, y = nest.y + Math.sin(ang) * rad * 0.7 + toward * 10;
        if (sys().validPlacement(kind, x, y)) { BW.tryBuild(kind, team, x, y); return; }
      }
      return;
    }
  }

  function maybeTrain(team) {
    if (units(team, 'worker').length < prof().workerTarget) { BW.tryTrain('worker', team); return; }
    if (!builds(team, 'barracks').length) return;
    const a = army(team);
    const soldiers = a.filter(u => u.kind === 'soldier').length;
    const fire     = a.filter(u => u.kind === 'fireant').length;
    const leaf     = a.filter(u => u.kind === 'leafcutter').length;
    let want = 'soldier';
    if (fire < soldiers * 0.5) want = 'fireant';
    if (builds(team, 'workshop').length && leaf < soldiers * 0.3) want = 'leafcutter';
    BW.tryTrain(want, team);
  }

  function maybeAttack(team) {
    const t = BW.state.time, g = prof().grace;
    if (t < g) return;
    // the longer the game drags, the smaller an army it will commit with — but
    // never a trickle (floor 5), so it MASSES then waves instead of feeding units
    const eff = Math.max(5, prof().armyThreshold - Math.floor((t - g) / 90));
    if (army(team).length < eff) return;
    const target = builds(opp(team), 'nest')[0];
    if (!target) return;
    const ready = army(team).filter(u => u.order.type === 'idle');
    if (!ready.length) return;
    for (const u of ready) u.order = { type: 'attackMove', tx: target.x, ty: target.y, targetId: null };
    // telegraph — only matters when the defender is human
    if (BW.state.controllers[opp(team)] === 'human') {
      const warning = BW.state.alerts.some(al => al.type === 'incoming' && al.until > BW.state.time);
      if (!warning) BW.state.alerts.push({ type: 'incoming', until: BW.state.time + 6, x: target.x, y: target.y });
    }
  }

  function thinkFor(team) {
    if (!builds(team, 'nest').length) return;
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
