/* ============================================================================
   Bug Wars — input.js   (v2)
   ----------------------------------------------------------------------------
   Mouse + keyboard → game orders. v2 adds resource-node assignment (you DO
   gather, by sending workers) and a build-placement mode for structures.

     left-click            select one of your units (shift adds)
     left-drag             box-select your units
     right-click node      send selected workers to mine it (until reassigned)
     right-click enemy     attack it      right-click ground   move / attack-move
     right-click your nest send workers home (idle)
     click a Build button  → placement mode; left-click to place, Esc/RMB cancels
     1..4 train · P pause · R restart · Esc clear/cancel
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const sys = () => BW.systems;

  function worldPos(e) {
    const c = BW.canvas, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }

  // LEARNING SPOT — box-select hit test: ids of `team` units inside the rect.
  function unitsInBox(units, x0, y0, x1, y1, team) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const ids = [];
    for (const u of units) if (u.team === team && u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) ids.push(u.id);
    return ids;
  }

  function pick(list, p, pad) {
    let best = null, bestD = Infinity;
    for (const e of list) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= sys().entityRadius(e) + pad && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
  const playerUnitAt  = p => pick(BW.state.units.filter(u => u.team === 'player'), p, 4);
  const enemyAt       = p => pick([...BW.state.units, ...BW.state.buildings].filter(e => e.team === 'enemy'), p, 4);
  const nodeAt        = p => pick(BW.state.nodes, p, 5);
  const ownNestAt     = p => pick(BW.state.buildings.filter(b => b.team === 'player' && BW.config.BUILDING_STATS[b.kind].category === 'nest'), p, 6);

  function addPing(x, y, type) { BW.state.pings.push({ x, y, type, t: BW.state.time }); }

  // ---- select by type (buttons + double-click) ----
  function selectWhere(pred) {
    BW.state.selected = new Set(BW.state.units.filter(u => u.team === 'player' && pred(u)).map(u => u.id));
    if (BW.sound) BW.sound.play('select');
  }
  const gathererKind = team => BW.config.FACTIONS[BW.state.faction[team]].gatherer;
  BW.select = {
    all:     () => selectWhere(() => true),
    workers: () => selectWhere(u => u.kind === gathererKind('player')),
    army:    () => selectWhere(u => u.kind !== gathererKind('player')),
  };
  let lastClick = null;   // {t, kind, x, y} for double-click detection

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }
  BW.toast = toast;

  /* ---- selection drag -------------------------------------------------- */
  let dragStart = null, dragging = false;
  const DRAG = 6;

  function onMouseDown(e) {
    if (e.button !== 0 || BW.state.phase !== 'playing') return;
    const p = worldPos(e);
    if (BW.state.placing) {                       // place a building
      const res = BW.tryBuild(BW.state.placing.kind, 'player', p.x, p.y);
      if (res.ok) { addPing(p.x, p.y, 'build'); if (BW.sound) BW.sound.play('build'); if (!e.shiftKey) BW.state.placing = null; }
      else toast(res.reason);
      return;
    }
    dragStart = p; dragging = false; BW.state.drag = null;
  }
  function onMouseMove(e) {
    const p = worldPos(e);
    if (BW.state.placing) { BW.state.placeXY = p; return; }
    if (!dragStart) return;
    if (!dragging && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > DRAG) dragging = true;
    if (dragging) BW.state.drag = { x0: dragStart.x, y0: dragStart.y, x1: p.x, y1: p.y };
  }
  function onMouseUp(e) {
    if (e.button !== 0 || !dragStart) return;
    const p = worldPos(e), s = BW.state;
    if (dragging) s.selected = new Set(unitsInBox(s.units, dragStart.x, dragStart.y, p.x, p.y, 'player'));
    else {
      const u = playerUnitAt(p);
      if (u) {
        const now = performance.now();
        const dbl = lastClick && now - lastClick.t < 320 && lastClick.kind === u.kind && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 24;
        if (dbl) selectWhere(uu => uu.kind === u.kind);              // double-click → all of this type
        else if (e.shiftKey) s.selected.add(u.id);
        else s.selected = new Set([u.id]);
        lastClick = { t: now, kind: u.kind, x: p.x, y: p.y };
      } else if (!e.shiftKey) s.selected.clear();
    }
    dragStart = null; dragging = false; s.drag = null;
  }

  /* ---- right-click orders --------------------------------------------- */
  function onContextMenu(e) {
    e.preventDefault();
    const s = BW.state;
    if (s.phase !== 'playing' || !human()) return;   // spectating AI-vs-AI: no commands
    if (s.placing) { s.placing = null; return; }   // cancel placement
    if (s.selected.size === 0) return;
    const p = worldPos(e), enemy = enemyAt(p), node = nodeAt(p), home = ownNestAt(p);
    const n = s.selected.size; let i = 0;
    for (const id of s.selected) {
      const u = BW.byId(id); if (!u) continue;
      const a = (i / n) * Math.PI * 2, spread = n > 1 ? 16 + n * 0.6 : 0;
      const tx = p.x + Math.cos(a) * spread, ty = p.y + Math.sin(a) * spread;
      const isG = u.kind === gathererKind('player');
      if (enemy)              u.order = { type: 'attack', tx: enemy.x, ty: enemy.y, targetId: enemy.id };
      else if (node && isG)  u.order = { type: 'gather', tx: node.x, ty: node.y, targetId: node.id };
      else if (home && isG)  u.order = { type: 'idle',   tx: u.x, ty: u.y, targetId: null };
      else if (isG)          u.order = { type: 'move',   tx, ty, targetId: null };
      else                   u.order = { type: 'attackMove', tx, ty, targetId: null };
      i++;
    }
    const fx = enemy ? 'attack' : node ? 'gather' : 'move';
    addPing(p.x, p.y, fx);
    if (BW.sound) BW.sound.play(fx);
  }

  /* ---- panels & keys --------------------------------------------------- */
  const human = () => BW.state.controllers && BW.state.controllers.player === 'human';
  function train(kind) { if (BW.state.phase === 'playing' && human()) { const r = BW.tryTrain(kind, 'player'); if (!r.ok) toast(r.reason); } }
  function build(kind) {
    if (BW.state.phase !== 'playing' || !human()) return;
    BW.state.placing = (BW.state.placing && BW.state.placing.kind === kind) ? null : { kind };
  }

  function onKeyDown(e) {
    const d = parseInt(e.key, 10);                          // 1..n trains the faction's units
    if (d >= 1 && d <= 9) { const menu = BW.config.FACTIONS[BW.state.faction.player].trainMenu; if (menu[d - 1]) return train(menu[d - 1]); }
    if (e.key === 'q' || e.key === 'Q') return BW.select.workers();
    if (e.key === 'e' || e.key === 'E') return BW.select.army();
    if (e.key === 'p' || e.key === 'P') BW.togglePause();
    if (e.key === 'r' || e.key === 'R') BW.restart();
    if (e.key === '[' || e.key === '-' || e.key === '_') return BW.cycleSpeed(-1);   // slower
    if (e.key === ']' || e.key === '=' || e.key === '+') return BW.cycleSpeed(+1);    // faster
    if (e.key === 'Escape') { if (BW.state.placing) BW.state.placing = null; else BW.state.selected.clear(); }
  }

  function attach(canvas) {
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    // Delegated so dynamically-rebuilt faction panels keep working.
    const panel = document.querySelector('.panel');
    if (panel) panel.addEventListener('click', e => {
      const tb = e.target.closest('.trainbtn'); if (tb) return train(tb.dataset.train);
      const bb = e.target.closest('.buildbtn'); if (bb) return build(bb.dataset.build);
    });
    document.querySelectorAll('[data-select]').forEach(b => b.addEventListener('click', () => BW.select[b.dataset.select] && BW.select[b.dataset.select]()));
    document.querySelectorAll('[data-action="restart"]').forEach(b => b.addEventListener('click', () => BW.restart()));
    const pause = document.getElementById('pauseBtn');
    if (pause) pause.addEventListener('click', () => BW.togglePause());
    const sd = document.getElementById('speedDown'); if (sd) sd.addEventListener('click', () => BW.cycleSpeed(-1));
    const su = document.getElementById('speedUp');   if (su) su.addEventListener('click', () => BW.cycleSpeed(+1));
  }

  BW.input = { attach, unitsInBox };
})();
