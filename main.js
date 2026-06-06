/* ============================================================================
   Bug Wars — main.js
   ----------------------------------------------------------------------------
   The entry point. It wires the canvas up, builds the world, and runs the
   game loop. The loop uses a FIXED timestep: the simulation always advances in
   steady 1/60-second chunks no matter the monitor's refresh rate, so combat
   and movement play out identically on a 60Hz and a 144Hz screen. Rendering
   then happens once per animation frame on top of the latest simulation state.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const STEP = 1000 / 60;      // ms per simulation tick
  let canvas, ctx, last = 0, acc = 0, running = false;

  function frame(now) {
    if (!last) last = now;
    let delta = now - last;
    last = now;
    if (delta > 250) delta = 250;            // a backgrounded tab shouldn't fast-forward
    acc += delta;

    const s = BW.state;
    while (acc >= STEP) {
      if (!s.paused && s.phase === 'playing') BW.update((STEP / 1000) * cfg.gameSpeed);
      acc -= STEP;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    BW.render(ctx);
    requestAnimationFrame(frame);
  }

  BW.togglePause = function () {
    if (BW.state.phase === 'playing') BW.state.paused = !BW.state.paused;
  };

  BW.restart = function () {
    BW.world.initWorld();
    BW.state.paused = false;
  };

  function start() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = cfg.world.width;          // fixed internal resolution; CSS scales it
    canvas.height = cfg.world.height;
    BW.canvas = canvas;

    BW.world.initWorld();
    BW.input.attach(canvas);

    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
