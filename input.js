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
  const ownNestAt     = p => pick(BW.state.buildings.filter(b => b.team === 'player' && b.kind === 'nest'), p, 6);

  function addPing(x, y, type) { BW.state.pings.push({ x, y, type, t: BW.state.time }); }

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
      if (res.ok) { addPing(p.x, p.y, 'build'); if (!e.shiftKey) BW.state.placing = null; }
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
      if (u) { e.shiftKey ? s.selected.add(u.id) : (s.selected = new Set([u.id])); }
      else if (!e.shiftKey) s.selected.clear();
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
      if (enemy)                                u.order = { type: 'attack', tx: enemy.x, ty: enemy.y, targetId: enemy.id };
      else if (node && u.kind === 'worker')     u.order = { type: 'gather', tx: node.x, ty: node.y, targetId: node.id };
      else if (home && u.kind === 'worker')     u.order = { type: 'idle',   tx: u.x, ty: u.y, targetId: null };
      else if (u.kind === 'worker')             u.order = { type: 'move',   tx, ty, targetId: null };
      else                                      u.order = { type: 'attackMove', tx, ty, targetId: null };
      i++;
    }
    addPing(p.x, p.y, enemy ? 'attack' : node ? 'gather' : 'move');
  }

  /* ---- panels & keys --------------------------------------------------- */
  const human = () => BW.state.controllers && BW.state.controllers.player === 'human';
  function train(kind) { if (BW.state.phase === 'playing' && human()) { const r = BW.tryTrain(kind, 'player'); if (!r.ok) toast(r.reason); } }
  function build(kind) {
    if (BW.state.phase !== 'playing' || !human()) return;
    BW.state.placing = (BW.state.placing && BW.state.placing.kind === kind) ? null : { kind };
  }

  const HOT = { '1': 'worker', '2': 'soldier', '3': 'fireant', '4': 'leafcutter' };
  function onKeyDown(e) {
    if (HOT[e.key]) return train(HOT[e.key]);
    if (e.key === 'p' || e.key === 'P') BW.togglePause();
    if (e.key === 'r' || e.key === 'R') BW.restart();
    if (e.key === 'Escape') { if (BW.state.placing) BW.state.placing = null; else BW.state.selected.clear(); }
  }

  function attach(canvas) {
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    document.querySelectorAll('.trainbtn').forEach(b => b.addEventListener('click', () => train(b.dataset.train)));
    document.querySelectorAll('.buildbtn').forEach(b => b.addEventListener('click', () => build(b.dataset.build)));
    document.querySelectorAll('[data-action="restart"]').forEach(b => b.addEventListener('click', () => BW.restart()));
    const pause = document.getElementById('pauseBtn');
    if (pause) pause.addEventListener('click', () => BW.togglePause());
  }

  BW.input = { attach, unitsInBox };
})();
