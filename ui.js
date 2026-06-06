/* ============================================================================
   Bug Wars — ui.js   (v2, NEW)
   ----------------------------------------------------------------------------
   The onboarding layer: the start / how-to-play menu, difficulty buttons, the
   attack-warning banner, and a short scripted tutorial. It only OBSERVES the
   game state and updates DOM — it never touches the simulation.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const $ = id => document.getElementById(id);

  // Scripted tutorial: each step shows until its `done(state)` is true.
  const STEPS = [
    { text: "Select a worker (click, or drag a box), then RIGHT-CLICK a green Food pile to send it mining.",
      done: s => s.units.some(u => u.team === 'player' && u.kind === 'worker' && (u.order.type === 'gather' || u.order.type === 'returning')) },
    { text: "You also need MUD (brown piles) to build. Once you have ~120 mud, click BARRACKS below and place it near your nest.",
      done: s => s.buildings.some(b => b.team === 'player' && b.kind === 'barracks') },
    { text: "Train Soldiers & Fire Ants (keys 2–3) from the barracks. Watch counters: infantry beats skirmishers, siege beats buildings.",
      done: s => s.units.some(u => u.team === 'player' && u.kind !== 'worker') },
    { text: "Defend with a Tower + Walls, keep your economy running, and RIGHT-CLICK the red nest to destroy it. A warning shows when they attack!",
      done: () => false },   // final tip stays for the match
  ];
  let stepIdx = 0;

  function tick() {
    const s = BW.state;
    const menu = $('menu'); if (menu) menu.classList.toggle('show', s.phase === 'menu');

    const wb = $('warnBanner');
    if (wb) wb.classList.toggle('show', s.phase === 'playing' && s.alerts.some(a => a.type === 'incoming' && a.until > s.time));

    const tc = $('tutorial');
    if (tc) {
      if (s.phase !== 'playing') tc.classList.remove('show');
      else {
        while (stepIdx < STEPS.length - 1 && STEPS[stepIdx].done(s)) stepIdx++;
        const t = $('tutorialText'); if (t) t.textContent = STEPS[stepIdx].text;
        tc.classList.add('show');
      }
    }
  }
  function resetTutorial() { stepIdx = 0; }

  function attach() {
    document.querySelectorAll('.diffbtn').forEach(b => b.addEventListener('click', () => BW.startGame(b.dataset.diff)));
    document.querySelectorAll('[data-action="menu"]').forEach(b => b.addEventListener('click', () => BW.toMenu()));
    const close = $('tutorialClose'); if (close) close.addEventListener('click', () => { const tc = $('tutorial'); if (tc) tc.style.display = 'none'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach); else attach();

  BW.ui = { tick, resetTutorial };
})();
