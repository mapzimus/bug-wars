/* ============================================================================
   Bug Wars — main.js   (v5: turn-based)
   ----------------------------------------------------------------------------
   Entry point + render loop. Sim advances on End Turn, not every frame —
   the rAF loop only drives camera, animations, and drawing.
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
      if (s.phase === 'playing') BW.update(STEP / 1000);
      acc -= STEP;
    }
    if (BW.input && BW.input.updateCamera) BW.input.updateCamera(delta / 1000);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    BW.render(ctx);
    if (BW.ui) BW.ui.tick();
    requestAnimationFrame(frame);
  }

  BW.startGame = function (difficulty, opts) {
    BW.world.initWorld(difficulty || 'normal', opts);
    BW.state.phase = 'playing';
    if (BW.ui) { BW.ui.buildPanel(BW.state.faction.player); BW.ui.resetTutorial(); }
    if (BW.startMatch) BW.startMatch();
  };
  BW.restart = function () {
    const d = (BW.state && BW.state.difficulty) || 'normal';
    const watch = !!(BW.state && BW.state.watchMode);
    const faction = (BW.state && BW.state.faction) ? BW.state.faction.player : 'ants';
    const enemyFaction = (BW.state && BW.state.faction) ? BW.state.faction.enemy : undefined;
    const map = (BW.state && BW.state.mapId) || 'skirmish';
    BW.world.initWorld(d, { playerAI: watch, faction, enemyFaction, map });
    BW.state.phase = 'playing';
    if (BW.ui) { BW.ui.buildPanel(faction); BW.ui.resetTutorial(); }
    if (BW.startMatch) BW.startMatch();
  };
  BW.toMenu = function () {
    const d = (BW.state && BW.state.difficulty) || 'normal';
    const map = (BW.state && BW.state.mapId) || 'skirmish';
    BW.world.initWorld(d, { map }); BW.state.phase = 'menu';
  };

  function fitCanvas() {
    // Keep logical view size; CSS scales the canvas to the stage.
    canvas.width = cfg.view.width;
    canvas.height = cfg.view.height;
  }

  function start() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    BW.canvas = canvas;
    fitCanvas();
    BW.world.initWorld('normal', { map: 'skirmish' });
    BW.state.phase = 'menu';
    BW.input.attach(canvas);
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
