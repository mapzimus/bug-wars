/* ============================================================================
   Bug Wars — render.js
   ----------------------------------------------------------------------------
   All drawing lives here, and ONLY drawing — this file reads BW.state and
   paints it, but never changes it. Bugs are drawn from scratch with canvas
   paths (no image files): segmented bodies, little wiggling legs, antennae,
   and a team-coloured collar so you can tell your black ants from the red.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config, C = cfg.colors;

  /* ---- colour + shape helpers ----------------------------------------- */
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const cl = v => Math.max(0, Math.min(255, v));
    const r = cl((n >> 16) + amt), g = cl(((n >> 8) & 255) + amt), b = cl((n & 255) + amt);
    return `rgb(${r},${g},${b})`;
  }
  function fillEllipse(ctx, x, y, rx, ry) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }
  function ring(ctx, x, y, r, color, w = 2) {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  }
  function bar(ctx, cx, topY, w, h, frac) {
    const x = cx - w / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 1, topY - 1, w + 2, h + 2);
    ctx.fillStyle = frac > 0.4 ? C.hpGood : C.hpBad;
    ctx.fillRect(x, topY, w * Math.max(0, frac), h);
  }

  /* ---- background (built once, cached) -------------------------------- */
  let decor = null;
  function buildDecor() {
    const W = cfg.world.width, H = cfg.world.height;
    const patches = [], blades = [];
    for (let i = 0; i < 90; i++)
      patches.push({ x: Math.random() * W, y: Math.random() * H, r: 24 + Math.random() * 70 });
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      blades.push({ x, y, len: 5 + Math.random() * 7, lean: (Math.random() - 0.5) * 4 });
    }
    decor = { patches, blades };
  }
  function drawBackground(ctx) {
    if (!decor) buildDecor();
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, cfg.world.width, cfg.world.height);
    ctx.fillStyle = C.grassPatch;
    for (const p of decor.patches) fillEllipse(ctx, p.x, p.y, p.r, p.r * 0.7);
    ctx.strokeStyle = 'rgba(30,70,40,0.5)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const b of decor.blades) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.lean, b.y - b.len); }
    ctx.stroke();
  }

  /* ---- entities -------------------------------------------------------- */
  function drawRock(ctx, o) {
    ctx.fillStyle = shade(C.obstacle, -18);
    fillEllipse(ctx, o.x, o.y + o.r * 0.18, o.r, o.r * 0.85);
    ctx.fillStyle = C.obstacle;
    fillEllipse(ctx, o.x, o.y, o.r * 0.92, o.r * 0.78);
    ctx.fillStyle = shade(C.obstacle, 22);
    fillEllipse(ctx, o.x - o.r * 0.25, o.y - o.r * 0.22, o.r * 0.4, o.r * 0.3);
  }

  function drawFood(ctx, f) {
    const r = cfg.food.radius, k = Math.max(0.45, f.amount / cfg.food.amount);
    ctx.fillStyle = C.food;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      fillEllipse(ctx, f.x + Math.cos(a) * r * 0.5, f.y + Math.sin(a) * r * 0.5, r * 0.45 * k + 1, r * 0.4 * k + 1);
    }
    ctx.fillStyle = shade(C.food, -45);
    fillEllipse(ctx, f.x, f.y, r * 0.4 * k + 1, r * 0.36 * k + 1);
  }

  function drawNest(ctx, b) {
    const r = cfg.nest.radius;
    const base = b.team === 'player' ? C.nestPlayer : C.nestEnemy;
    const tint = b.team === 'player' ? C.playerTint : C.enemyTint;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = shade(base, i * 9);
      ctx.beginPath(); ctx.arc(b.x, b.y, r * (1 - i * 0.18), 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#1b120b';
    ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ring(ctx, b.x, b.y, r + 3, tint, 3);
    bar(ctx, b.x, b.y - r - 14, r * 2, 7, b.hp / b.maxHp);
  }

  function drawAnt(ctx, u, time) {
    const s = cfg.UNIT_STATS[u.kind], r = s.radius * 1.2;
    const tint = u.team === 'player' ? C.playerTint : C.enemyTint;
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.rotate(u.heading);

    // legs (forward is +x in local space)
    ctx.strokeStyle = 'rgba(18,14,10,0.85)';
    ctx.lineWidth = Math.max(1, r * 0.16); ctx.lineCap = 'round';
    const phase = time * 9 + u.id * 1.7;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const lx = (-0.15 + i * 0.42) * r;
        const sw = Math.sin(phase + i) * 0.18 * side;
        ctx.beginPath();
        ctx.moveTo(lx, side * r * 0.22);
        ctx.quadraticCurveTo(lx + 0.25 * r, side * r * 0.95, lx + (0.2 + sw) * r * 1.6, side * r * 1.15);
        ctx.stroke();
      }
    }
    // antennae
    ctx.beginPath();
    ctx.moveTo(r * 0.95, -r * 0.18); ctx.lineTo(r * 1.75, -r * 0.55);
    ctx.moveTo(r * 0.95,  r * 0.18); ctx.lineTo(r * 1.75,  r * 0.55);
    ctx.stroke();

    // body: abdomen, thorax, head
    ctx.fillStyle = s.color;
    fillEllipse(ctx, -0.72 * r, 0, 0.8 * r, 0.6 * r);
    fillEllipse(ctx,  0.05 * r, 0, 0.46 * r, 0.42 * r);
    fillEllipse(ctx,  0.78 * r, 0, 0.5 * r, 0.46 * r);

    // venom sheen on the abdomen
    if (u.venomTimer > 0) { ctx.fillStyle = 'rgba(124,255,107,0.35)'; fillEllipse(ctx, -0.72 * r, 0, 0.88 * r, 0.66 * r); }

    // team collar
    ctx.strokeStyle = tint; ctx.lineWidth = Math.max(1.4, r * 0.24);
    ctx.beginPath(); ctx.ellipse(0.05 * r, 0, 0.5 * r, 0.46 * r, 0, 0, Math.PI * 2); ctx.stroke();

    // carried food pip
    if (u.carrying > 0) { ctx.fillStyle = C.food; fillEllipse(ctx, -1.3 * r, 0, r * 0.32, r * 0.32); }

    ctx.restore();
  }

  /* ---- ui overlays ----------------------------------------------------- */
  function drawPings(ctx) {
    const s = BW.state;
    if (!s.pings) return;
    for (const pg of s.pings) {
      const age = (s.time - pg.t) / 0.5;
      if (age < 0 || age > 1) continue;
      const col = pg.type === 'attack' ? C.enemyTint : pg.type === 'gather' ? C.food : C.playerTint;
      ctx.globalAlpha = 1 - age;
      ring(ctx, pg.x, pg.y, 4 + age * 18, col, 2);
      ctx.globalAlpha = 1;
    }
  }
  function drawDrag(ctx, d) {
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    ctx.fillStyle = 'rgba(135,195,255,0.12)';
    ctx.strokeStyle = C.playerTint; ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }

  /* ---- HUD / DOM ------------------------------------------------------- */
  const $ = id => document.getElementById(id);
  function updateHUD() {
    const s = BW.state;
    const pop = s.units.filter(u => u.team === 'player').length;
    if ($('foodCount')) $('foodCount').textContent = Math.floor(s.playerFood);
    if ($('popCount'))  $('popCount').textContent  = pop + '/' + cfg.popCap;
    if ($('waveCount')) $('waveCount').textContent = s.ai.waveNumber;
    if ($('selCount'))  $('selCount').textContent  = s.selected.size;
    document.querySelectorAll('.trainbtn').forEach(btn => {
      const stat = cfg.UNIT_STATS[btn.dataset.kind];
      btn.classList.toggle('cant', s.playerFood < stat.cost);
    });
    const badge = $('pauseBadge');
    if (badge) badge.style.display = (s.paused && s.phase === 'playing') ? 'block' : 'none';
  }
  function updateOverlay() {
    const s = BW.state, ov = $('overlay');
    if (!ov) return;
    if (s.phase === 'playing') { ov.classList.remove('show'); return; }
    $('overlayTitle').textContent = s.phase === 'won' ? 'Victory' : 'Defeat';
    $('overlayTitle').className = s.phase === 'won' ? 'win' : 'lose';
    $('overlayMsg').textContent = s.phase === 'won'
      ? 'The red colony is broken. The garden is yours.'
      : 'Your nest has fallen. The colony scatters.';
    ov.classList.add('show');
  }

  /* ---- main draw ------------------------------------------------------- */
  function render(ctx) {
    const s = BW.state;
    drawBackground(ctx);
    s.food.forEach(f => drawFood(ctx, f));
    s.obstacles.forEach(o => drawRock(ctx, o));
    s.buildings.forEach(b => drawNest(ctx, b));

    for (const id of s.selected) {
      const u = BW.byId(id);
      if (u) ring(ctx, u.x, u.y, BW.systems.entityRadius(u) + 5, C.selection, 2);
    }
    for (const u of s.units) drawAnt(ctx, u, s.time);
    for (const u of s.units)
      if (u.hp < u.maxHp) bar(ctx, u.x, u.y - BW.systems.entityRadius(u) - 9, 22, 4, u.hp / u.maxHp);

    drawPings(ctx);
    if (s.drag) drawDrag(ctx, s.drag);

    updateHUD();
    updateOverlay();
  }

  BW.render = render;
})();
