/* ============================================================================
   Bug Wars — main.js   (v2)
   ----------------------------------------------------------------------------
   Entry point + fixed-timestep loop. Phases: 'menu' (start screen, sim paused),
   'playing', 'won', 'lost'. The loop only advances the sim while 'playing'.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const STEP = 1000 / 60;
  let canvas, ctx, last = 0, acc = 0, running = false;

  function frame(now) {
    if (!last) last = now;
    let delta = now - last; last = now;
    if (delta > 250) delta = 250;
    acc += delta;

    const s = BW.state;
    while (acc >= STEP) {
      if (!s.paused && s.phase === 'playing') BW.update((STEP / 1000) * cfg.gameSpeed);
      acc -= STEP;
    }
    // Camera pans on REAL time (works while paused, ignores gameSpeed).
    if (BW.input && BW.input.updateCamera) BW.input.updateCamera(delta / 1000);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    BW.render(ctx);
    if (BW.ui) BW.ui.tick();
    requestAnimationFrame(frame);
  }

  BW.togglePause = function () { if (BW.state.phase === 'playing') BW.state.paused = !BW.state.paused; };

  /* ---- live game-speed control ---------------------------------------
     The loop reads cfg.gameSpeed fresh each frame, so changing it here
     takes effect instantly. SPEEDS is the ladder the −/+ buttons & [ ] keys
     step through; default (config.js) lands on 0.6×. */
  const SPEEDS = [0.4, 0.5, 0.6, 0.75, 0.9, 1.0, 1.25];
  function fmtSpeed(m) { return (+m.toFixed(2)) + '×'; }   // 0.60 -> "0.6×", 1.00 -> "1×"
  function syncSpeedLabel() { const el = document.getElementById('speedVal'); if (el) el.textContent = fmtSpeed(cfg.gameSpeed); }
  BW.setGameSpeed = function (m) {
    cfg.gameSpeed = Math.max(SPEEDS[0], Math.min(SPEEDS[SPEEDS.length - 1], m));
    syncSpeedLabel();
  };
  BW.cycleSpeed = function (dir) {                  // dir = -1 slower, +1 faster
    let i = 0, bestD = Infinity;
    SPEEDS.forEach((s, k) => { const d = Math.abs(s - cfg.gameSpeed); if (d < bestD) { bestD = d; i = k; } });
    i = Math.max(0, Math.min(SPEEDS.length - 1, i + dir));
    BW.setGameSpeed(SPEEDS[i]);
    if (BW.toast) BW.toast('Speed ' + fmtSpeed(cfg.gameSpeed));
  };
  BW.syncSpeedLabel = syncSpeedLabel;

  BW.startGame = function (difficulty, opts) {
    BW.world.initWorld(difficulty || 'normal', opts);
    BW.state.phase = 'playing';
    if (BW.ui) { BW.ui.buildPanel(BW.state.faction.player); BW.ui.resetTutorial(); }
  };
  BW.restart = function () {                       // replay same difficulty + matchup + mode
    const d = (BW.state && BW.state.difficulty) || 'normal';
    const watch = !!(BW.state && BW.state.watchMode);
    const faction = (BW.state && BW.state.faction) ? BW.state.faction.player : 'ants';
    const enemyFaction = (BW.state && BW.state.faction) ? BW.state.faction.enemy : undefined;
    BW.world.initWorld(d, { playerAI: watch, faction, enemyFaction }); BW.state.phase = 'playing';
    if (BW.ui) { BW.ui.buildPanel(faction); BW.ui.resetTutorial(); }
  };
  BW.toMenu = function () {                         // back to the start screen
    const d = (BW.state && BW.state.difficulty) || 'normal';
    BW.world.initWorld(d); BW.state.phase = 'menu';
  };

  function start() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = cfg.view.width; canvas.height = cfg.view.height;   // the camera window, NOT the world
    BW.canvas = canvas;
    BW.world.initWorld('normal');
    BW.state.phase = 'menu';                        // board sits behind the menu
    syncSpeedLabel();                               // show the starting speed (0.6×)
    BW.input.attach(canvas);
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
