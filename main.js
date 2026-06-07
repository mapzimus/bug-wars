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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    BW.render(ctx);
    if (BW.ui) BW.ui.tick();
    requestAnimationFrame(frame);
  }

  BW.togglePause = function () { if (BW.state.phase === 'playing') BW.state.paused = !BW.state.paused; };

  BW.startGame = function (difficulty, opts) {
    BW.world.initWorld(difficulty || 'normal', opts);
    BW.state.phase = 'playing';
    if (BW.ui) BW.ui.resetTutorial();
  };
  BW.restart = function () {                       // replay same difficulty + mode
    const d = (BW.state && BW.state.difficulty) || 'normal';
    const watch = !!(BW.state && BW.state.watchMode);
    BW.world.initWorld(d, { playerAI: watch }); BW.state.phase = 'playing';
    if (BW.ui) BW.ui.resetTutorial();
  };
  BW.toMenu = function () {                         // back to the start screen
    const d = (BW.state && BW.state.difficulty) || 'normal';
    BW.world.initWorld(d); BW.state.phase = 'menu';
  };

  function start() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = cfg.world.width; canvas.height = cfg.world.height;
    BW.canvas = canvas;
    BW.world.initWorld('normal');
    BW.state.phase = 'menu';                        // board sits behind the menu
    BW.input.attach(canvas);
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
