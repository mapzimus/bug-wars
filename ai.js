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
    const have = { food: 0, mud: 0, honeydew: 0 };
    let assigned = 0;
    for (const w of units(team, 'worker')) { const r = workerResource(w); if (r) { have[r]++; assigned++; } }
    for (const u of idles) {
      const total = Math.max(1, assigned);                 // ratio over WORKING workers, not idle ones
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
    const nest = builds(team, 'nest')[0]; if (!nest) return;
    // production (barracks → workshop) before the optional defensive tower, so the
    // tower can never deadlock the siege tech behind it
    for (const kind of ['barracks', 'workshop', 'tower']) {
      if (builds(team, kind).length) continue;
      const s = cfg.BUILDING_STATS[kind];
      if (!sys().canAfford(BW.state.res[team], s.cost)) {
        if (kind === 'barracks') return;   // essential — save up for it
        else continue;                     // optional — try the next affordable one
      }
      const j = (BW.state.time * 0.7) % (Math.PI * 2);   // jitter so retries explore new spots
      for (let a = 0; a < 22; a++) {
        const ang = j + (a / 22) * Math.PI * 2;
        const rad = 72 + a * 9;                           // search out to ~270px
        const x = nest.x + Math.cos(ang) * rad, y = nest.y + Math.sin(ang) * rad * 0.7;
        if (sys().validPlacement(kind, x, y)) { BW.tryBuild(kind, team, x, y); return; }
      }
      return;   // no spot this think; jitter changes next time
    }
  }

  function classCounts(arr) {
    const c = { infantry: 0, skirmisher: 0, siege: 0 };
    for (const u of arr) { const k = cfg.UNIT_STATS[u.kind].class; if (c[k] !== undefined) c[k]++; }
    return c;
  }
  function maybeTrain(team) {
    if (units(team, 'worker').length < prof().workerTarget) { BW.tryTrain('worker', team); return; }
    if (!builds(team, 'barracks').length) return;
    const mine = classCounts(army(team)), foe = classCounts(army(opp(team)));
    const haveWorkshop = builds(team, 'workshop').length;
    let want = 'soldier';                                   // default frontline
    // react to the enemy's dominant class (the counter triangle)
    if (foe.siege >= 2 && foe.siege >= foe.infantry) want = 'fireant';                         // skirmisher > siege
    else if (foe.infantry >= 3 && haveWorkshop && foe.infantry >= foe.skirmisher) want = 'leafcutter'; // siege > infantry
    else if (foe.skirmisher >= 3) want = 'soldier';                                            // infantry > skirmisher
    else {                                                  // no clear read → keep a healthy mix
      if (mine.skirmisher < mine.infantry * 0.5) want = 'fireant';
      else if (haveWorkshop && mine.siege < mine.infantry * 0.4) want = 'leafcutter';
    }
    BW.tryTrain(want, team);
  }

  function maybeAttack(team) {
    const t = BW.state.time, g = prof().grace;
    const target = builds(opp(team), 'nest')[0];
    if (!target) return;
    const a = army(team);
    const idle = a.filter(u => u.order.type === 'idle');
    const d2t = u => Math.hypot(u.x - target.x, u.y - target.y);

    // Opportunistic all-in: the enemy nest is almost dead, or its home is undefended.
    const enemyHome = army(opp(team)).filter(u => d2t(u) < 280).length;
    const opportunity = target.hp < target.maxHp * 0.30 || (t > g && enemyHome === 0 && a.length >= 3);
    if (t < g && !opportunity) return;

    // Mass a FRESH idle blob before each wave (gating on idle count, not total
    // army, is what stops the old one-unit-at-a-time trickle). Wave size relaxes
    // slowly over time so it always eventually commits.
    const lateGame = t > g + 200;                          // very long game → stop hoarding, commit all
    const eff = lateGame ? 4 : Math.max(5, prof().armyThreshold - Math.floor((t - g) / 90));
    if (!opportunity && idle.length < eff) return;

    // Keep a small garrison home to defend (send the units nearest the enemy) —
    // but go all-in when seizing an opportunity or grinding a very long game.
    const garrison = (opportunity || lateGame) ? 0 : Math.max(2, Math.round(eff * 0.3));
    const send = idle.slice().sort((u, v) => d2t(u) - d2t(v)).slice(0, Math.max(1, idle.length - garrison));
    for (const u of send) u.order = { type: 'attackMove', tx: target.x, ty: target.y, targetId: null };

    if (BW.state.controllers[opp(team)] === 'human') {   // telegraph to a human defender
      const warn = BW.state.alerts.some(al => al.type === 'incoming' && al.until > BW.state.time);
      if (!warn) {
        BW.state.alerts.push({ type: 'incoming', until: BW.state.time + 6, x: target.x, y: target.y });
        if (BW.sound) BW.sound.play('alert');
      }
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
