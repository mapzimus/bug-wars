/* ============================================================================
   Bug Wars — main.js   (v5)
   ----------------------------------------------------------------------------
   Entry point + fixed-timestep loop. Phases: 'menu' (start screen, sim paused),
   'playing', 'won', 'lost'. The loop only advances the sim while 'playing'.

   v5: the canvas is RESPONSIVE. v4 locked it to 1280x720 and letterboxed, which
   on a big monitor meant playing an RTS through a mail slot. The canvas now
   fills its container and cfg.view tracks it, in CSS pixels; the drawing
   context is pre-scaled by devicePixelRatio so the result stays crisp.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const STEP = 1000 / 60;
  let canvas, ctx, last = 0, acc = 0, running = false, dpr = 1;

  /* ---- responsive sizing ------------------------------------------------ */
  function resize() {
    if (!canvas) return;
    const host = canvas.parentElement;
    const cssW = Math.max(320, Math.floor(host.clientWidth));
    const cssH = Math.max(240, Math.floor(host.clientHeight));
    dpr = Math.min(2, window.devicePixelRatio || 1);      // cap at 2 — 3x costs a lot for little gain

    cfg.view.width = cssW; cfg.view.height = cssH;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);

    if (BW.state && BW.state.camera && BW.clampCamera) BW.clampCamera();
  }

  // Watch the STAGE BOX, not just the window. The footer changes height when
  // ui.buildPanel() swaps in a faction's build/train/research rows, which
  // shrinks the stage without any window resize event — measuring only on
  // window resize left the canvas overflowing and clipped its bottom strip
  // (taking the minimap with it).
  function observeStage(host) {
    if (typeof ResizeObserver === 'undefined') return;
    let pending = false;
    const ro = new ResizeObserver(() => {
      if (pending) return;                       // coalesce: one resize per frame at most
      pending = true;
      requestAnimationFrame(() => { pending = false; resize(); });
    });
    ro.observe(host);
  }

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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);        // CSS-pixel coordinate space
    ctx.clearRect(0, 0, cfg.view.width, cfg.view.height);
    BW.render(ctx);
    if (BW.ui) BW.ui.tick();
    requestAnimationFrame(frame);
  }

  BW.togglePause = function () { if (BW.state.phase === 'playing') BW.state.paused = !BW.state.paused; };

  /* ---- live game-speed control ---------------------------------------
     The loop reads cfg.gameSpeed fresh each frame, so changing it here takes
     effect instantly. v5 recentres the ladder on 1x (v4 defaulted to 0.6x). */
  const SPEEDS = [0.5, 0.7, 0.85, 1.0, 1.25, 1.5, 2.0];
  function fmtSpeed(m) { return (+m.toFixed(2)) + '×'; }
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
    BW.canvas = canvas;
    resize();
    window.addEventListener('resize', resize);
    observeStage(canvas.parentElement);
    BW.world.initWorld('normal');
    BW.state.phase = 'menu';                        // board sits behind the menu
    syncSpeedLabel();
    BW.input.attach(canvas);
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
