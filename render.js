/* ============================================================================
   Bug Wars — render.js   (v2)
   ----------------------------------------------------------------------------
   All drawing, and ONLY drawing — reads BW.state, never mutates it. v2 adds
   typed resource nodes, the five building types, the build-placement ghost,
   attack-warning pulses, and a three-resource HUD with a clock.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config, C = cfg.colors;
  const ER = e => BW.systems.entityRadius(e);

  /* ---- helpers --------------------------------------------------------- */
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16), cl = v => Math.max(0, Math.min(255, v));
    return `rgb(${cl((n >> 16) + amt)},${cl(((n >> 8) & 255) + amt)},${cl((n & 255) + amt)})`;
  }
  function fillEllipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  function ring(ctx, x, y, r, color, w = 2) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    fill ? ctx.fill() : ctx.stroke();
  }
  function bar(ctx, cx, topY, w, h, frac) {
    const x = cx - w / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 1, topY - 1, w + 2, h + 2);
    ctx.fillStyle = frac > 0.4 ? C.hpGood : C.hpBad; ctx.fillRect(x, topY, w * Math.max(0, frac), h);
  }
  const tintOf = team => team === 'player' ? C.playerTint : C.enemyTint;

  /* ---- background (cached) -------------------------------------------- */
  let decor = null;
  function buildDecor() {
    const W = cfg.world.width, H = cfg.world.height, patches = [], blades = [];
    for (let i = 0; i < 90; i++) patches.push({ x: Math.random() * W, y: Math.random() * H, r: 24 + Math.random() * 70 });
    for (let i = 0; i < 260; i++) blades.push({ x: Math.random() * W, y: Math.random() * H, len: 5 + Math.random() * 7, lean: (Math.random() - 0.5) * 4 });
    decor = { patches, blades };
  }
  function drawBackground(ctx) {
    if (!decor) buildDecor();
    ctx.fillStyle = C.grass; ctx.fillRect(0, 0, cfg.world.width, cfg.world.height);
    ctx.fillStyle = C.grassPatch; for (const p of decor.patches) fillEllipse(ctx, p.x, p.y, p.r, p.r * 0.7);
    ctx.strokeStyle = 'rgba(30,70,40,0.5)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.beginPath();
    for (const b of decor.blades) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.lean, b.y - b.len); }
    ctx.stroke();
  }

  /* ---- nodes / rocks --------------------------------------------------- */
  function drawNode(ctx, n) {
    const def = cfg.resources[n.resource], r = def.radius, max = n.max || def.amount;
    const frac = Math.max(0, Math.min(1, n.amount / max)), k = Math.max(0.45, frac);
    // depletion ring (how much is left)
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = def.color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
    ctx.lineCap = 'butt';
    // the pile (shrinks as it depletes)
    ctx.fillStyle = def.color;
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; fillEllipse(ctx, n.x + Math.cos(a) * r * 0.5, n.y + Math.sin(a) * r * 0.5, r * 0.45 * k + 1, r * 0.4 * k + 1); }
    ctx.fillStyle = shade(def.color, -45); fillEllipse(ctx, n.x, n.y, r * 0.4 * k + 1, r * 0.36 * k + 1);
    // remaining value
    ctx.font = '600 11px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = Math.ceil(n.amount);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(label, n.x, n.y - r - 11);
    ctx.fillStyle = '#fff'; ctx.fillText(label, n.x, n.y - r - 12);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function drawRock(ctx, o) {
    ctx.fillStyle = shade(C.obstacle, -18); fillEllipse(ctx, o.x, o.y + o.r * 0.18, o.r, o.r * 0.85);
    ctx.fillStyle = C.obstacle; fillEllipse(ctx, o.x, o.y, o.r * 0.92, o.r * 0.78);
    ctx.fillStyle = shade(C.obstacle, 22); fillEllipse(ctx, o.x - o.r * 0.25, o.y - o.r * 0.22, o.r * 0.4, o.r * 0.3);
  }

  /* ---- buildings ------------------------------------------------------- */
  function hexAt(ctx, cx, cy, rad) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6, px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath();
  }
  function drawNestMound(ctx, b, tint, r) {
    const base = cfg.BUILDING_STATS[b.kind].color;     // ant nest brown, bee hive amber
    for (let i = 0; i < 4; i++) { ctx.fillStyle = shade(base, i * 9); ctx.beginPath(); ctx.arc(b.x, b.y, r * (1 - i * 0.18), 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#1b120b'; ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.22, 0, Math.PI * 2); ctx.fill();
    if (b.kind === 'hive') {                            // honeycomb cells
      ctx.strokeStyle = 'rgba(40,28,8,0.55)'; ctx.lineWidth = 1.5;
      for (const [hx, hy] of [[-0.45, -0.38], [0.45, -0.38], [0, 0.52], [-0.55, 0.3], [0.55, 0.3]]) { hexAt(ctx, b.x + hx * r, b.y + hy * r, r * 0.2); ctx.stroke(); }
    }
    ring(ctx, b.x, b.y, r + 3, tint, 3);
  }
  function drawGlyph(ctx, b, r) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.fillStyle = 'rgba(255,255,255,0.8)';
    if (b.kind === 'barracks') {                 // crossed blades
      ctx.beginPath(); ctx.moveTo(b.x - r * 0.4, b.y + r * 0.4); ctx.lineTo(b.x + r * 0.4, b.y - r * 0.4);
      ctx.moveTo(b.x + r * 0.4, b.y + r * 0.4); ctx.lineTo(b.x - r * 0.4, b.y - r * 0.4); ctx.stroke();
    } else if (b.kind === 'workshop') {          // gear
      ring(ctx, b.x, b.y, r * 0.42, 'rgba(255,255,255,0.85)', 2);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(b.x + Math.cos(a) * r * 0.42, b.y + Math.sin(a) * r * 0.42); ctx.lineTo(b.x + Math.cos(a) * r * 0.62, b.y + Math.sin(a) * r * 0.62); ctx.stroke(); }
    } else if (b.kind === 'granary') {           // dome
      ctx.beginPath(); ctx.arc(b.x, b.y + r * 0.2, r * 0.5, Math.PI, 0); ctx.stroke();
    } else if (b.kind === 'tower') {             // turret + faint range
      ctx.beginPath(); ctx.arc(b.x, b.y - r * 0.1, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ring(ctx, b.x, b.y, cfg.BUILDING_STATS.tower.range, 'rgba(255,255,255,0.07)', 1);
    } else if (b.kind === 'wall') {              // bricks
      ctx.beginPath(); ctx.moveTo(b.x - r * 0.6, b.y); ctx.lineTo(b.x + r * 0.6, b.y);
      ctx.moveTo(b.x, b.y - r * 0.5); ctx.lineTo(b.x, b.y + r * 0.5); ctx.stroke();
    } else if (b.kind === 'brood') {             // honeycomb cell
      hexAt(ctx, b.x, b.y, r * 0.5); ctx.stroke();
    } else if (b.kind === 'apiary') {            // honeycomb + core (siege/hornet hub)
      hexAt(ctx, b.x, b.y, r * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.16, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawBuilding(ctx, b) {
    const bs = cfg.BUILDING_STATS[b.kind], r = bs.radius, tint = tintOf(b.team);
    const isBase = bs.category === 'nest';
    if (isBase) drawNestMound(ctx, b, tint, r);
    else {
      ctx.fillStyle = bs.color; roundRect(ctx, b.x - r, b.y - r * 0.85, r * 2, r * 1.7, 6, true);
      ctx.strokeStyle = tint; ctx.lineWidth = 2.5; roundRect(ctx, b.x - r, b.y - r * 0.85, r * 2, r * 1.7, 6, false);
      drawGlyph(ctx, b, r);
    }
    // training progress ring + queue badge (the unit-creation countdown)
    if (b.trainQueue && b.trainQueue.length) {
      const total = cfg.UNIT_STATS[b.trainQueue[0]].buildTime;
      const prog = Math.max(0, Math.min(1, 1 - b.trainTimer / total));
      const rr = r + 9;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = tint; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(b.x, b.y, rr, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.stroke();
      ctx.lineCap = 'butt';
      if (b.trainQueue.length > 1) {
        const bx = b.x + rr * 0.72, by = b.y - rr * 0.72;
        ctx.fillStyle = tint; ctx.beginPath(); ctx.arc(bx, by, 7.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0a0e17'; ctx.font = '700 11px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.trainQueue.length, bx, by); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    }
    if (b.hp < b.maxHp) bar(ctx, b.x, b.y - r * (isBase ? 1 : 0.85) - 12, r * 2, 6, b.hp / b.maxHp);
  }

  /* ---- ants ------------------------------------------------------------ */
  function drawAnt(ctx, u, time) {
    const s = cfg.UNIT_STATS[u.kind], r = s.radius * 1.2, tint = tintOf(u.team);
    const bee = BW.state.faction && BW.state.faction[u.team] === 'bees';
    const flying = s.flying;                              // true flyer (hornet) — also ignores walls (systems.js)
    const airborne = flying || bee;                      // ALL bees hover — VISUAL ONLY, no balance change
    const lift = flying ? r * 1.0 : (bee ? r * 0.55 : 0); // how high off the ground it's drawn

    if (airborne) {                                       // ground shadow under anything off the ground
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      fillEllipse(ctx, u.x, u.y + r * 1.2, r * (flying ? 0.9 : 0.78), r * 0.36);
    }

    ctx.save();
    ctx.translate(u.x, u.y - lift);                       // elevate flyers / hovering bees
    ctx.rotate(u.heading);

    if (!airborne) {                                      // walking legs (grounded units only)
      ctx.strokeStyle = 'rgba(18,14,10,0.85)'; ctx.lineWidth = Math.max(1, r * 0.16); ctx.lineCap = 'round';
      const ph = time * 9 + u.id * 1.7;
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const lx = (-0.15 + i * 0.42) * r, sw = Math.sin(ph + i) * 0.18 * side;
        ctx.beginPath(); ctx.moveTo(lx, side * r * 0.22); ctx.quadraticCurveTo(lx + 0.25 * r, side * r * 0.95, lx + (0.2 + sw) * r * 1.6, side * r * 1.15); ctx.stroke();
      }
    }
    if (bee) {                                            // beating wings
      const wf = Math.sin(time * (flying ? 40 : 32) + u.id) * 0.4;   // lively hover for all bees
      ctx.fillStyle = 'rgba(225,238,255,0.45)'; ctx.strokeStyle = 'rgba(200,222,255,0.65)'; ctx.lineWidth = 1;
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(0, side * 0.32 * r); ctx.rotate(side * (0.55 + wf));
        ctx.beginPath(); ctx.ellipse(-0.35 * r, 0, 0.62 * r, 0.26 * r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
    }
    // antennae
    ctx.strokeStyle = 'rgba(18,14,10,0.85)'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(r * 0.95, -r * 0.18); ctx.lineTo(r * 1.6, -r * 0.5); ctx.moveTo(r * 0.95, r * 0.18); ctx.lineTo(r * 1.6, r * 0.5); ctx.stroke();
    // body
    ctx.fillStyle = s.color;
    fillEllipse(ctx, -0.72 * r, 0, 0.8 * r, 0.6 * r); fillEllipse(ctx, 0.05 * r, 0, 0.46 * r, 0.42 * r); fillEllipse(ctx, 0.78 * r, 0, 0.5 * r, 0.46 * r);
    if (bee) {                                            // black stripes on the abdomen
      ctx.save();
      ctx.beginPath(); ctx.ellipse(-0.72 * r, 0, 0.8 * r, 0.6 * r, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = 'rgba(26,18,6,0.9)';
      for (const dx of [-1.05, -0.7, -0.35]) fillEllipse(ctx, dx * r, 0, 0.1 * r, 0.7 * r);
      ctx.restore();
    }
    if (u.venomTimer > 0) { ctx.fillStyle = 'rgba(124,255,107,0.35)'; fillEllipse(ctx, -0.72 * r, 0, 0.88 * r, 0.66 * r); }
    ctx.strokeStyle = tint; ctx.lineWidth = Math.max(1.4, r * 0.24); ctx.beginPath(); ctx.ellipse(0.05 * r, 0, 0.5 * r, 0.46 * r, 0, 0, Math.PI * 2); ctx.stroke();
    if (u.carrying > 0 && u.carryType) { ctx.fillStyle = cfg.resources[u.carryType].color; fillEllipse(ctx, -1.3 * r, 0, r * 0.34, r * 0.34); }
    ctx.restore();
  }

  /* ---- overlays -------------------------------------------------------- */
  function drawGhost(ctx) {
    const s = BW.state; if (!s.placing || !s.placeXY) return;
    const r = cfg.BUILDING_STATS[s.placing.kind].radius;
    const ok = BW.systems.validPlacement(s.placing.kind, s.placeXY.x, s.placeXY.y)
            && BW.systems.canAfford(s.res.player, cfg.BUILDING_STATS[s.placing.kind].cost);
    ctx.fillStyle = ok ? C.ghostOk : C.ghostBad;
    ctx.beginPath(); ctx.arc(s.placeXY.x, s.placeXY.y, r, 0, Math.PI * 2); ctx.fill();
    ring(ctx, s.placeXY.x, s.placeXY.y, r, ok ? C.playerTint : C.alert, 2);
  }
  function drawPings(ctx) {
    for (const pg of BW.state.pings) {
      const age = (BW.state.time - pg.t) / 0.5; if (age < 0 || age > 1) continue;
      const col = pg.type === 'attack' ? C.enemyTint : pg.type === 'gather' ? cfg.resources.food.color : pg.type === 'build' ? C.playerTint : C.playerTint;
      ctx.globalAlpha = 1 - age; ring(ctx, pg.x, pg.y, 4 + age * 18, col, 2); ctx.globalAlpha = 1;
    }
  }
  function drawAlerts(ctx) {
    for (const a of BW.state.alerts) {
      if (a.type !== 'incoming') continue;
      const pulse = 0.5 + 0.5 * Math.sin(BW.state.time * 6);
      ctx.globalAlpha = 0.4 + 0.4 * pulse; ring(ctx, a.x, a.y, 46 + pulse * 10, C.alert, 3); ctx.globalAlpha = 1;
    }
  }
  function drawDrag(ctx, d) {
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    ctx.fillStyle = 'rgba(135,195,255,0.12)'; ctx.strokeStyle = C.playerTint; ctx.lineWidth = 1.5; ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }

  /* ---- HUD (DOM) ------------------------------------------------------- */
  const $ = id => document.getElementById(id);
  function updateHUD() {
    const s = BW.state, res = s.res.player;
    const pop = s.units.filter(u => u.team === 'player').length;
    if ($('foodCount'))     $('foodCount').textContent = Math.floor(res.food);
    if ($('mudCount'))      $('mudCount').textContent = Math.floor(res.mud);
    if ($('honeydewCount')) $('honeydewCount').textContent = Math.floor(res.honeydew);
    if ($('popCount'))      $('popCount').textContent = pop + '/' + cfg.popCap;
    if ($('selCount'))      $('selCount').textContent = s.selected.size;
    if ($('clock')) { const t = Math.floor(s.time); $('clock').textContent = (t / 60 | 0) + ':' + String(t % 60).padStart(2, '0'); }

    const selEl = $('selSummary');
    if (selEl) {
      if (!s.selected.size) selEl.textContent = 'drag a box to select · double-click a unit for all of its type';
      else {
        const names = { worker: 'Worker', soldier: 'Soldier', fireant: 'Fire Ant', leafcutter: 'Leafcutter',
                        drone: 'Drone', guard: 'Guard Bee', striker: 'Striker', carpenter: 'Carpenter', hornet: 'Hornet' };
        const counts = {};
        for (const id of s.selected) { const u = BW.byId(id); if (u) counts[u.kind] = (counts[u.kind] || 0) + 1; }
        selEl.textContent = Object.keys(counts).map(k => counts[k] + ' ' + names[k] + (counts[k] > 1 ? 's' : '')).join('  ·  ');
      }
    }

    document.querySelectorAll('.trainbtn').forEach(btn => {
      const k = btn.dataset.train, st = cfg.UNIT_STATS[k];
      const ok = BW.systems.producerFor(k, 'player') && BW.systems.canAfford(res, st.cost);
      btn.classList.toggle('cant', !ok);
    });
    document.querySelectorAll('.buildbtn').forEach(btn => {
      const k = btn.dataset.build;
      btn.classList.toggle('cant', !BW.systems.canAfford(res, cfg.BUILDING_STATS[k].cost));
      btn.classList.toggle('active', !!(s.placing && s.placing.kind === k));
    });
  }
  function updateOverlay() {
    const s = BW.state, ov = $('overlay'); if (!ov) return;
    if (s.phase !== 'won' && s.phase !== 'lost') { ov.classList.remove('show'); return; }
    const blue = s.phase === 'won';
    if (s.watchMode) {
      $('overlayTitle').textContent = blue ? 'Blue wins' : 'Red wins';
      $('overlayTitle').className = blue ? 'win' : 'lose';
      $('overlayMsg').textContent = 'AI vs AI — ' + (blue ? 'the blue colony' : 'the red colony') + ' destroyed the rival nest.';
    } else {
      $('overlayTitle').textContent = blue ? 'Victory' : 'Defeat';
      $('overlayTitle').className = blue ? 'win' : 'lose';
      $('overlayMsg').textContent = blue ? 'The rival colony is broken. The garden is yours.' : 'Your nest has fallen. The colony scatters.';
    }
    ov.classList.add('show');
  }

  /* ---- main draw ------------------------------------------------------- */
  function render(ctx) {
    const s = BW.state;
    drawBackground(ctx);
    s.nodes.forEach(n => drawNode(ctx, n));
    s.obstacles.forEach(o => drawRock(ctx, o));
    s.buildings.forEach(b => drawBuilding(ctx, b));
    for (const id of s.selected) { const u = BW.byId(id); if (u) ring(ctx, u.x, u.y, ER(u) + 5, C.selection, 2); }
    for (const u of s.units) drawAnt(ctx, u, s.time);
    for (const u of s.units) if (u.hp < u.maxHp) bar(ctx, u.x, u.y - ER(u) - 9, 22, 4, u.hp / u.maxHp);
    drawAlerts(ctx); drawPings(ctx); drawGhost(ctx);
    if (s.drag) drawDrag(ctx, s.drag);
    updateHUD(); updateOverlay();
  }

  BW.render = render;
})();
