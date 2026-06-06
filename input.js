/* ============================================================================
   Bug Wars — input.js
   ----------------------------------------------------------------------------
   Turns mouse + keyboard into game orders:
     - left click            select one ant (shift-click to add)
     - left click + drag      box-select your ants
     - right click            move / attack-move / gather (smart per target)
     - 1..4                   train worker / soldier / fire ant / leafcutter
     - P pause   R restart   Esc clear selection
   It reads/writes BW.state but never draws — drawing is render.js.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const sys = () => BW.systems;

  // Convert a mouse event to world coordinates. The canvas is internally
  // 1280x720 but CSS may scale it to fit the window, so we rescale by the
  // ratio between the drawn size and the internal size.
  function worldPos(e) {
    const c = BW.canvas, r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width  / r.width),
      y: (e.clientY - r.top)  * (c.height / r.height),
    };
  }

  /* --------------------------------------------------------------------
     LEARNING SPOT #2 — box-select hit test.   <-- YOU WRITE THIS ONE
     When the player drags a selection box from (x0,y0) to (x1,y1), return
     an array of the ids of every unit on `team` whose center is inside the
     box. Watch out: the player might drag up-and-left, so x1<x0 and y1<y0
     are both possible — normalise the corners first.

     // const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
     // ...same for Y... then push u.id when u.x and u.y are inside.
     ------------------------------------------------------------------ */
  function unitsInBox(units, x0, y0, x1, y1, team) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const ids = [];
    for (const u of units) {
      if (u.team !== team) continue;
      if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) ids.push(u.id);
    }
    return ids;
  }

  /* ---- point pickers --------------------------------------------------- */
  function pick(list, p, pad) {
    let best = null, bestD = Infinity;
    for (const e of list) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= sys().entityRadius(e) + pad && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
  const playerUnitAt  = p => pick(BW.state.units.filter(u => u.team === 'player'), p, 4);
  const enemyEntityAt = p => pick([...BW.state.units, ...BW.state.buildings].filter(e => e.team === 'enemy'), p, 4);
  const foodAt        = p => pick(BW.state.food, p, 5);

  function addPing(x, y, type) {
    (BW.state.pings || (BW.state.pings = [])).push({ x, y, type, t: BW.state.time });
  }

  /* ---- selection drag -------------------------------------------------- */
  let dragStart = null, dragging = false;
  const DRAG_THRESHOLD = 6;

  function onMouseDown(e) {
    if (e.button !== 0 || BW.state.phase !== 'playing') return;
    dragStart = worldPos(e); dragging = false; BW.state.drag = null;
  }
  function onMouseMove(e) {
    if (!dragStart) return;
    const p = worldPos(e);
    if (!dragging && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > DRAG_THRESHOLD) dragging = true;
    if (dragging) BW.state.drag = { x0: dragStart.x, y0: dragStart.y, x1: p.x, y1: p.y };
  }
  function onMouseUp(e) {
    if (e.button !== 0 || !dragStart) return;
    const p = worldPos(e), s = BW.state;
    if (dragging) {
      s.selected = new Set(unitsInBox(s.units, dragStart.x, dragStart.y, p.x, p.y, 'player'));
    } else {
      const u = playerUnitAt(p);
      if (u)            { e.shiftKey ? s.selected.add(u.id) : (s.selected = new Set([u.id])); }
      else if (!e.shiftKey) s.selected.clear();
    }
    dragStart = null; dragging = false; s.drag = null;
  }

  /* ---- right-click orders ---------------------------------------------- */
  function onContextMenu(e) {
    e.preventDefault();
    const s = BW.state;
    if (s.phase !== 'playing' || s.selected.size === 0) return;
    const p = worldPos(e);
    const enemy = enemyEntityAt(p);
    const food  = foodAt(p);
    const n = s.selected.size;
    let i = 0;

    for (const id of s.selected) {
      const u = BW.byId(id); if (!u) continue;
      const a = (i / n) * Math.PI * 2;
      const spread = n > 1 ? 16 + n * 0.6 : 0;
      const tx = p.x + Math.cos(a) * spread, ty = p.y + Math.sin(a) * spread;

      if (enemy)                      u.order = { type: 'attack',     tx: enemy.x, ty: enemy.y, targetId: enemy.id };
      else if (food && u.kind === 'worker') u.order = { type: 'gather', tx: food.x, ty: food.y, targetId: food.id };
      else if (u.kind === 'worker')   u.order = { type: 'move',       tx, ty, targetId: null };
      else                            u.order = { type: 'attackMove', tx, ty, targetId: null };
      i++;
    }
    addPing(p.x, p.y, enemy ? 'attack' : food ? 'gather' : 'move');
  }

  /* ---- build panel ----------------------------------------------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }
  function train(kind) {
    if (BW.state.phase !== 'playing') return;
    const res = BW.tryTrain(kind);
    if (!res.ok) toast(res.reason);
  }

  /* ---- keyboard -------------------------------------------------------- */
  const HOTKEYS = { '1': 'worker', '2': 'soldier', '3': 'fireant', '4': 'leafcutter' };
  function onKeyDown(e) {
    if (HOTKEYS[e.key]) { train(HOTKEYS[e.key]); return; }
    if (e.key === 'p' || e.key === 'P') BW.togglePause();
    if (e.key === 'r' || e.key === 'R') BW.restart();
    if (e.key === 'Escape') BW.state.selected.clear();
  }

  function attach(canvas) {
    canvas.addEventListener('mousedown',   onMouseDown);
    window.addEventListener('mousemove',    onMouseMove);
    window.addEventListener('mouseup',      onMouseUp);
    canvas.addEventListener('contextmenu',  onContextMenu);
    window.addEventListener('keydown',      onKeyDown);

    document.querySelectorAll('.trainbtn').forEach(btn =>
      btn.addEventListener('click', () => train(btn.dataset.kind)));
    document.querySelectorAll('[data-action="restart"]').forEach(btn =>
      btn.addEventListener('click', () => BW.restart()));
    const pause = document.getElementById('pauseBtn');
    if (pause) pause.addEventListener('click', () => BW.togglePause());
  }

  BW.input = { attach, unitsInBox };
})();
