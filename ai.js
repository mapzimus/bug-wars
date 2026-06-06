/* ============================================================================
   Bug Wars — ai.js
   ----------------------------------------------------------------------------
   The enemy red colony. Deliberately simple: its garrison defends itself for
   free (idle units with aggro auto-engage anything that wanders in), and on a
   timer it throws an attack wave at your nest. Each wave is a little bigger
   than the last. No mirror economy, no scouting — that's a later-version job.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;

  /* --------------------------------------------------------------------
     LEARNING SPOT #4 — the difficulty curve.
     Given the AI's current state (how many waves it has sent), decide what
     the NEXT wave is made of. Return an array of unit kinds, e.g.
     ['soldier','soldier','fireant']. Bigger/nastier arrays = harder game.
     This one grows by one ant per wave and mixes in fire ants, plus a
     leafcutter from wave 2 on. Make it as mean as you dare.
     ------------------------------------------------------------------ */
  function nextWave(ai) {
    const n = ai.waveNumber;            // 1, 2, 3, ... (already incremented)
    const count = 2 + Math.floor(n / 2); // gentle ramp: wave 1-2 = 2-3 ants, then +1 every 2 waves
    const comp = [];
    for (let i = 0; i < count; i++) {
      if (n >= 2 && i === 0)      comp.push('leafcutter');  // a siege ant to gnaw the nest
      else if (i % 4 === 3)       comp.push('fireant');     // a fast poisoner sprinkled in
      else                        comp.push('soldier');
    }
    return comp;
  }

  function update(s, dt) {
    const ai = s.ai;
    ai.waveTimer -= dt;
    if (ai.waveTimer > 0) return;

    ai.waveNumber++;
    const enemyNest  = s.buildings.find(b => b.team === 'enemy'  && b.kind === 'nest');
    const playerNest = s.buildings.find(b => b.team === 'player' && b.kind === 'nest');

    if (enemyNest && playerNest) {
      const comp = nextWave(ai);
      comp.forEach((kind, i) => {
        const a = (i / comp.length) * Math.PI * 2;
        const u = BW.world.createUnit(kind, 'enemy',
          enemyNest.x + Math.cos(a) * 42,
          enemyNest.y + Math.sin(a) * 42);
        // march on the player's home and fight through anything in the way
        u.order = { type: 'attackMove', tx: playerNest.x, ty: playerNest.y, targetId: null };
        s.units.push(u);
      });
    }
    ai.waveTimer = cfg.ai.waveInterval;
  }

  BW.ai = { update, nextWave };
})();
