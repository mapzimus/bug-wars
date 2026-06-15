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

  /* ---- background (rendered ONCE to an offscreen canvas) ---------------
     The world is 4x the screen now; re-stroking a thousand grass blades per
     frame would hurt. Paint the terrain once, then blit the visible slice. */
  let decorCanvas = null;
  function buildDecor() {
    const W = cfg.world.width, H = cfg.world.height;
    decorCanvas = document.createElement('canvas');
    decorCanvas.width = W; decorCanvas.height = H;
    const g = decorCanvas.getContext('2d');
    g.fillStyle = C.grass; g.fillRect(0, 0, W, H);
    g.fillStyle = C.grassPatch;                                       // mottled grass
    for (let i = 0; i < 320; i++) { const x = Math.random() * W, y = Math.random() * H, r = 24 + Math.random() * 70; g.beginPath(); g.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(58,96,64,0.5)';                               // darker undertones
    for (let i = 0; i < 90; i++) { const x = Math.random() * W, y = Math.random() * H, r = 40 + Math.random() * 110; g.beginPath(); g.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(30,70,40,0.5)'; g.lineWidth = 1.5; g.lineCap = 'round'; g.beginPath();
    for (let i = 0; i < 1000; i++) {                                  // grass blades
      const x = Math.random() * W, y = Math.random() * H, len = 5 + Math.random() * 7, lean = (Math.random() - 0.5) * 4;
      g.moveTo(x, y); g.lineTo(x + lean, y - len);
    }
    g.stroke();
    for (let i = 0; i < 140; i++) {                                   // pebbles
      const x = Math.random() * W, y = Math.random() * H, r = 1.5 + Math.random() * 3;
      g.fillStyle = `rgba(${120 + Math.random() * 40 | 0},${120 + Math.random() * 40 | 0},${125 + Math.random() * 40 | 0},0.5)`;
      g.beginPath(); g.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 90; i++) {                                    // tiny wildflowers
      const x = Math.random() * W, y = Math.random() * H, r = 2 + Math.random() * 1.6;
      const col = ['#e8d8f0', '#f0e6c8', '#f3cfd8', '#dfe9f5'][i % 4];
      g.fillStyle = col;
      for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2; g.beginPath(); g.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.7, r * 0.7, 0, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#e9c46a'; g.beginPath(); g.ellipse(x, y, r * 0.55, r * 0.55, 0, 0, Math.PI * 2); g.fill();
    }
  }
  function drawBackground(ctx, cam) {
    if (!decorCanvas) buildDecor();
    const v = cfg.view;
    // blit only the visible slice of the pre-rendered world
    ctx.drawImage(decorCanvas, cam.x, cam.y, v.width, v.height, cam.x, cam.y, v.width, v.height);
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
    } else if (b.kind === 'lair') {                     // spider web over the mound
      ctx.strokeStyle = 'rgba(225,230,245,0.35)'; ctx.lineWidth = 1;
      for (const wr of [0.35, 0.6, 0.85]) { ctx.beginPath(); ctx.arc(b.x, b.y, r * wr, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(a) * r * 0.9, b.y + Math.sin(a) * r * 0.9); }
      ctx.stroke();
    } else if (b.kind === 'mound') {                    // beetle mound: packed-earth ridges
      ctx.strokeStyle = 'rgba(28,20,12,0.45)'; ctx.lineWidth = 2;
      for (const wr of [0.45, 0.75]) { ctx.beginPath(); ctx.arc(b.x, b.y, r * wr, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); }
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
    } else if (b.kind === 'den') {               // beetle den: twin studs
      ctx.beginPath(); ctx.arc(b.x - r * 0.28, b.y, r * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(b.x + r * 0.28, b.y, r * 0.18, 0, Math.PI * 2); ctx.fill();
    } else if (b.kind === 'burrow') {            // beetle burrow: ram wedge
      ctx.beginPath(); ctx.moveTo(b.x - r * 0.45, b.y + r * 0.35); ctx.lineTo(b.x, b.y - r * 0.45); ctx.lineTo(b.x + r * 0.45, b.y + r * 0.35); ctx.closePath(); ctx.stroke();
    } else if (b.kind === 'nursery') {           // spider nursery: egg cluster
      for (const [ex, ey] of [[-0.3, -0.15], [0.3, -0.15], [0, 0.3]]) { ctx.beginPath(); ctx.arc(b.x + ex * r, b.y + ey * r, r * 0.17, 0, Math.PI * 2); ctx.fill(); }
    } else if (b.kind === 'spinnery') {          // spider spinnery: web cross
      ring(ctx, b.x, b.y, r * 0.42, 'rgba(255,255,255,0.85)', 2);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(a) * r * 0.62, b.y + Math.sin(a) * r * 0.62); }
      ctx.stroke();
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

  /* ---- bugs (per-faction body styles) ----------------------------------
     style comes from FACTIONS[faction].style: ant | bee | beetle | spider.
     Only the bee STYLE hovers visually; flying:true units (hornet, balloonist)
     elevate higher — and actually ignore walls (systems.js).                 */
  function drawAnt(ctx, u, time) {
    const s = cfg.UNIT_STATS[u.kind], r = s.radius * 1.2, tint = tintOf(u.team);
    const style = (BW.state.faction && cfg.FACTIONS[BW.state.faction[u.team]].style) || 'ant';
    const bee = style === 'bee', beetle = style === 'beetle', spider = style === 'spider';
    const flying = s.flying;                              // true flyer — also ignores walls (systems.js)
    const airborne = flying || bee;                       // bees hover visually; others walk
    const lift = flying ? r * 1.0 : (bee ? r * 0.55 : 0);
    const abdomenX = beetle ? -0.55 : spider ? -0.6 : -0.72;   // where the rear segment sits

    if (airborne) {                                       // ground shadow under anything off the ground
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      fillEllipse(ctx, u.x, u.y + r * 1.2, r * (flying ? 0.9 : 0.78), r * 0.36);
    }

    ctx.save();
    ctx.translate(u.x, u.y - lift);                       // elevate flyers / hovering bees
    ctx.rotate(u.heading);

    if (!airborne) {                                      // walking legs (grounded units only)
      ctx.strokeStyle = 'rgba(18,14,10,0.85)'; ctx.lineWidth = Math.max(1, r * 0.16); ctx.lineCap = 'round';
      const ph = time * (beetle ? 6 : 9) + u.id * 1.7;    // beetles lumber
      const legN = spider ? 4 : 3;                        // spiders get 8 legs
      for (const side of [-1, 1]) for (let i = 0; i < legN; i++) {
        const lx = (-0.3 + i * (spider ? 0.34 : 0.42)) * r, sw = Math.sin(ph + i) * 0.18 * side;
        ctx.beginPath(); ctx.moveTo(lx, side * r * 0.22); ctx.quadraticCurveTo(lx + 0.25 * r, side * r * 0.95, lx + (0.2 + sw) * r * 1.6, side * r * (spider ? 1.3 : 1.15)); ctx.stroke();
      }
    }
    if (bee) {                                            // beating wings
      const wf = Math.sin(time * (flying ? 40 : 32) + u.id) * 0.4;
      ctx.fillStyle = 'rgba(225,238,255,0.45)'; ctx.strokeStyle = 'rgba(200,222,255,0.65)'; ctx.lineWidth = 1;
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(0, side * 0.32 * r); ctx.rotate(side * (0.55 + wf));
        ctx.beginPath(); ctx.ellipse(-0.35 * r, 0, 0.62 * r, 0.26 * r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
    }
    if (spider && flying) {                               // balloonist: silk threads catching the wind
      ctx.strokeStyle = 'rgba(225,235,255,0.6)'; ctx.lineWidth = 1;
      const sway = Math.sin(time * 7 + u.id) * 0.2;
      for (const a of [-0.5, 0, 0.5]) {
        ctx.beginPath(); ctx.moveTo(-0.3 * r, 0);
        ctx.quadraticCurveTo(-1.2 * r, (a + sway) * r * 1.6, -2.1 * r, (a + sway) * r * 2.6); ctx.stroke();
      }
    }
    if (!spider) {                                        // antennae (spiders have none)
      ctx.strokeStyle = 'rgba(18,14,10,0.85)'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.lineCap = 'round';
      const al = beetle ? 1.25 : 1.6;                     // beetles: short, clubbed
      ctx.beginPath(); ctx.moveTo(r * 0.95, -r * 0.18); ctx.lineTo(r * al, -r * 0.45); ctx.moveTo(r * 0.95, r * 0.18); ctx.lineTo(r * al, r * 0.45); ctx.stroke();
    }
    // body
    ctx.fillStyle = s.color;
    if (beetle) {                                         // dome + pronotum + head
      fillEllipse(ctx, abdomenX * r, 0, 1.0 * r, 0.74 * r);
      fillEllipse(ctx, 0.35 * r, 0, 0.4 * r, 0.46 * r);
      fillEllipse(ctx, 0.85 * r, 0, 0.36 * r, 0.34 * r);
      ctx.strokeStyle = 'rgba(20,14,8,0.65)'; ctx.lineWidth = Math.max(1, r * 0.12);   // elytra split
      ctx.beginPath(); ctx.moveTo(0.25 * r, 0); ctx.lineTo((abdomenX - 0.95) * r, 0); ctx.stroke();
    } else if (spider) {                                  // big abdomen + cephalothorax
      fillEllipse(ctx, abdomenX * r, 0, 0.9 * r, 0.72 * r);
      fillEllipse(ctx, 0.42 * r, 0, 0.52 * r, 0.46 * r);
      ctx.fillStyle = shade(s.color, -50);                // abdomen marking
      fillEllipse(ctx, abdomenX * r, 0, 0.34 * r, 0.5 * r);
      ctx.fillStyle = s.color;
    } else {                                              // ant / bee: classic 3 segments
      fillEllipse(ctx, abdomenX * r, 0, 0.8 * r, 0.6 * r);
      fillEllipse(ctx, 0.05 * r, 0, 0.46 * r, 0.42 * r);
      fillEllipse(ctx, 0.78 * r, 0, 0.5 * r, 0.46 * r);
    }
    if (bee) {                                            // black stripes on the abdomen
      ctx.save();
      ctx.beginPath(); ctx.ellipse(abdomenX * r, 0, 0.8 * r, 0.6 * r, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = 'rgba(26,18,6,0.9)';
      for (const dx of [-1.05, -0.7, -0.35]) fillEllipse(ctx, dx * r, 0, 0.1 * r, 0.7 * r);
      ctx.restore();
    }
    if (u.venomTimer > 0) { ctx.fillStyle = 'rgba(124,255,107,0.35)'; fillEllipse(ctx, abdomenX * r, 0, 0.95 * r, 0.7 * r); }
    // team-color band on the midsection — readable at a glance on a big map
    ctx.strokeStyle = tint; ctx.lineWidth = Math.max(1.4, r * 0.24);
    ctx.beginPath(); ctx.ellipse((beetle ? 0.35 : spider ? 0.42 : 0.05) * r, 0, 0.5 * r, 0.46 * r, 0, 0, Math.PI * 2); ctx.stroke();
    if (u.carrying > 0 && u.carryType) { ctx.fillStyle = cfg.resources[u.carryType].color; fillEllipse(ctx, -1.4 * r, 0, r * 0.34, r * 0.34); }
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
                        drone: 'Drone', guard: 'Guard Bee', striker: 'Striker', carpenter: 'Carpenter', hornet: 'Hornet',
                        grub: 'Grub', bruiser: 'Bruiser', bombardier: 'Bombardier', ram: 'Ram Beetle',
                        spiderling: 'Spiderling', hunter: 'Hunter', spitter: 'Spitter', weaver: 'Weaver', balloonist: 'Balloonist' };
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
  // selected production building: ring it, and show where its rally point sends new units
  function drawRally(ctx) {
    const s = BW.state;
    if (s.selectedBuilding == null) return;
    const b = BW.byId(s.selectedBuilding); if (!b) return;
    ring(ctx, b.x, b.y, ER(b) + 6, C.selection, 2.5);
    const rx = b.rally ? b.rally.x : b.rallyX, ry = b.rally ? b.rally.y : b.rallyY;
    if (rx == null) return;
    ctx.save();
    ctx.strokeStyle = C.selection; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(rx, ry); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;                  // flag pole
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx, ry - 17); ctx.stroke();
    ctx.fillStyle = C.selection;                                            // flag
    ctx.beginPath(); ctx.moveTo(rx, ry - 17); ctx.lineTo(rx + 12, ry - 13); ctx.lineTo(rx, ry - 9); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1; ctx.stroke();
    fillEllipse(ctx, rx, ry, 2.5, 2.5);                                     // base dot
    ctx.restore();
  }

  /* ---- minimap (AoE-style, bottom-right) -------------------------------- */
  function drawMinimap(ctx) {
    const s = BW.state, m = BW.minimapRect();
    const sx = m.w / cfg.world.width, sy = m.h / cfg.world.height;
    ctx.save();
    ctx.fillStyle = 'rgba(16,26,18,0.88)';
    ctx.fillRect(m.x - 2, m.y - 2, m.w + 4, m.h + 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(m.x - 2, m.y - 2, m.w + 4, m.h + 4);
    for (const o of s.obstacles) {                                     // terrain
      ctx.fillStyle = 'rgba(130,138,150,0.5)';
      ctx.fillRect(m.x + o.x * sx - 1.5, m.y + o.y * sy - 1.5, 3, 3);
    }
    for (const n of s.nodes) {                                         // resources
      if (n.amount <= 1) continue;
      ctx.fillStyle = (cfg.resources[n.resource] && cfg.resources[n.resource].color) || '#888';
      ctx.fillRect(m.x + n.x * sx - 1, m.y + n.y * sy - 1, 2, 2);
    }
    for (const b of s.buildings) {                                     // buildings (bigger dots)
      const isBase = cfg.BUILDING_STATS[b.kind].category === 'nest';
      ctx.fillStyle = tintOf(b.team);
      const d = isBase ? 5 : 3;
      ctx.fillRect(m.x + b.x * sx - d / 2, m.y + b.y * sy - d / 2, d, d);
    }
    for (const u of s.units) {                                         // units
      ctx.fillStyle = tintOf(u.team);
      ctx.fillRect(m.x + u.x * sx - 1, m.y + u.y * sy - 1, 2, 2);
    }
    for (const a of s.alerts) {                                        // attack alert blink
      if (a.type !== 'incoming' || a.x == null) continue;
      if (Math.sin(s.time * 10) > 0) { ctx.fillStyle = C.alert; ctx.fillRect(m.x + a.x * sx - 3, m.y + a.y * sy - 3, 6, 6); }
    }
    // camera viewport rectangle
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
    ctx.strokeRect(m.x + s.camera.x * sx, m.y + s.camera.y * sy, cfg.view.width * sx, cfg.view.height * sy);
    ctx.restore();
  }

  function render(ctx) {
    const s = BW.state, cam = s.camera || { x: 0, y: 0 };
    const cx = Math.round(cam.x), cy = Math.round(cam.y);              // integer offsets = crisp pixels
    const vis = (e, m) => e.x > cx - m && e.x < cx + cfg.view.width + m && e.y > cy - m && e.y < cy + cfg.view.height + m;

    ctx.save();
    ctx.translate(-cx, -cy);                                           // world → screen
    drawBackground(ctx, { x: cx, y: cy });
    for (const n of s.nodes) if (vis(n, 40)) drawNode(ctx, n);
    for (const o of s.obstacles) if (vis(o, 80)) drawRock(ctx, o);
    for (const b of s.buildings) if (vis(b, 160)) drawBuilding(ctx, b);
    for (const id of s.selected) { const u = BW.byId(id); if (u) ring(ctx, u.x, u.y, ER(u) + 5, C.selection, 2); }
    drawRally(ctx);
    for (const u of s.units) if (vis(u, 40)) drawAnt(ctx, u, s.time);
    for (const u of s.units) if (u.hp < u.maxHp && vis(u, 40)) bar(ctx, u.x, u.y - ER(u) - 9, 22, 4, u.hp / u.maxHp);
    drawAlerts(ctx); drawPings(ctx); drawGhost(ctx);
    if (s.drag) drawDrag(ctx, s.drag);
    ctx.restore();

    if (s.phase !== 'menu') drawMinimap(ctx);                          // screen-space HUD
    updateHUD(); updateOverlay();
  }

  BW.render = render;
})();
