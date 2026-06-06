/* ============================================================================
   Bug Wars — ai.js   (v2)
   ----------------------------------------------------------------------------
   A FAIR opponent. The enemy colony plays by the same rules you do: its
   workers gather real resources, which it spends to build and train. It does
   not cheat — difficulty only scales parameters (how many workers, how big an
   army before it attacks, how fast it thinks). It builds for a "grace" period
   before its first (telegraphed) attack.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const sys = () => BW.systems;
  const prof = () => cfg.difficulties[BW.state.difficulty];

  const enemyUnits = kind => BW.state.units.filter(u => u.team === 'enemy' && (!kind || u.kind === kind));
  const enemyBuild = kind => BW.state.buildings.filter(b => b.team === 'enemy' && (!kind || b.kind === kind));
  const army       = ()   => BW.state.units.filter(u => u.team === 'enemy' && u.kind !== 'worker');

  function workerResource(u) {
    if (u.carryType) return u.carryType;
    const n = BW.byId(u.order.targetId);
    return (n && n.kind === 'node') ? n.resource : null;
  }

  // Keep idle enemy workers busy, balanced across the three resources.
  function assignIdleWorkers() {
    const idles = enemyUnits('worker').filter(u => u.order.type === 'idle');
    if (!idles.length) return;
    const want = { food: 0.55, mud: 0.30, honeydew: 0.15 };
    const workers = enemyUnits('worker');
    const have = { food: 0, mud: 0, honeydew: 0 };
    for (const w of workers) { const r = workerResource(w); if (r) have[r]++; }
    const total = workers.length || 1;
    for (const u of idles) {
      let pick = null, bestGap = -Infinity;
      for (const r of ['food', 'mud', 'honeydew']) {
        const gap = want[r] - have[r] / total;
        if (gap > bestGap && sys().nearestNode(u, r)) { bestGap = gap; pick = r; }
      }
      const node = (pick && sys().nearestNode(u, pick)) || sys().nearestNode(u);
      if (node) { u.order = { type: 'gather', tx: node.x, ty: node.y, targetId: node.id }; have[node.resource]++; }
    }
  }

  // Build order: barracks → tower → workshop. One build per think; wait
  // (don't skip) until the next one is affordable.
  function maybeBuild() {
    for (const kind of ['barracks', 'tower', 'workshop']) {
      if (enemyBuild(kind).length) continue;
      const s = cfg.BUILDING_STATS[kind];
      if (!sys().canAfford(BW.state.res.enemy, s.cost)) return;
      const nest = enemyBuild('nest')[0]; if (!nest) return;
      for (let a = 0; a < 14; a++) {
        const ang = (a / 14) * Math.PI * 2, rad = 72 + a * 8;
        const x = nest.x + Math.cos(ang) * rad, y = nest.y + Math.sin(ang) * rad;
        if (sys().validPlacement(kind, x, y)) { BW.tryBuild(kind, 'enemy', x, y); return; }
      }
      return;
    }
  }

  // Workers up to target first; then a counter-aware army mix.
  function maybeTrain() {
    if (enemyUnits('worker').length < prof().workerTarget) { BW.tryTrain('worker', 'enemy'); return; }
    if (!enemyBuild('barracks').length) return;
    const a = army();
    const soldiers = a.filter(u => u.kind === 'soldier').length;
    const fire     = a.filter(u => u.kind === 'fireant').length;
    const leaf     = a.filter(u => u.kind === 'leafcutter').length;
    let want = 'soldier';
    if (fire < soldiers * 0.5) want = 'fireant';
    if (enemyBuild('workshop').length && leaf < soldiers * 0.3) want = 'leafcutter';
    BW.tryTrain(want, 'enemy');
  }

  // After the grace period, once the army is big enough, march it on the
  // player's nest — and telegraph it with a warning alert.
  function maybeAttack() {
    if (BW.state.time < prof().grace) return;
    if (army().length < prof().armyThreshold) return;
    const target = BW.state.buildings.find(b => b.team === 'player' && b.kind === 'nest');
    if (!target) return;
    const ready = army().filter(u => u.order.type === 'idle');
    if (!ready.length) return;
    for (const u of ready) u.order = { type: 'attackMove', tx: target.x, ty: target.y, targetId: null };
    const warning = BW.state.alerts.some(al => al.type === 'incoming' && al.until > BW.state.time);
    if (!warning) BW.state.alerts.push({ type: 'incoming', until: BW.state.time + 6, x: target.x, y: target.y });
  }

  function update(state, dt) {
    if (!enemyBuild('nest').length) return;       // defeated
    state.ai.think -= dt;
    if (state.ai.think > 0) return;
    state.ai.think = prof().thinkEvery;
    assignIdleWorkers();
    maybeBuild();
    maybeTrain();
    maybeAttack();
  }

  BW.ai = { update };
})();
