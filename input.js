/* ============================================================================
   Bug Wars — input.js   (v4: camera + minimap)
   ----------------------------------------------------------------------------
   Mouse + keyboard → game orders, plus the CAMERA. The world is larger than
   the canvas now: worldPos() = canvas position + camera offset.

     left-click            select a unit (shift adds) or a production building
     left-drag             box-select your units
     right-click node      send selected workers to mine it (until reassigned)
     right-click enemy     attack it      right-click ground   move / attack-move
     right-click (bldg selected)  set that building's rally point
     minimap               left-click/drag pans the camera · right-click orders
     WASD / arrows / screen edges   scroll the map      Space  jump to the action
     1..n train · Q workers · E army · . idle workers · P pause · R restart
     [ ] game speed · Esc clear/cancel
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const sys = () => BW.systems;

  /* ---- coordinate transforms ------------------------------------------- */
  // screenPos: event → CANVAS pixel coords (0..view.w / 0..view.h)
  function screenPos(e) {
    const c = BW.canvas, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  // worldPos: event → WORLD coords (camera offset applied)
  function worldPos(e) {
    const sp = screenPos(e), cam = BW.state.camera;
    return { x: sp.x + cam.x, y: sp.y + cam.y };
  }

  /* ---- minimap geometry (render.js draws with the same rect) ----------- */
  function minimapRect() {
    const mm = cfg.minimap, v = cfg.view;
    const h = Math.round(mm.w * cfg.world.height / cfg.world.width);
    return { x: v.width - mm.w - mm.margin, y: v.height - h - mm.margin, w: mm.w, h };
  }
  const inMinimap = sp => { const m = minimapRect(); return sp.x >= m.x - 2 && sp.x <= m.x + m.w + 2 && sp.y >= m.y - 2 && sp.y <= m.y + m.h + 2; };  // include the 2px frame
  const miniToWorld = sp => {
    const m = minimapRect();
    return {
      x: Math.max(0, Math.min(cfg.world.width,  (sp.x - m.x) / m.w * cfg.world.width)),
      y: Math.max(0, Math.min(cfg.world.height, (sp.y - m.y) / m.h * cfg.world.height)),
    };
  };
  BW.minimapRect = minimapRect;

  /* ---- camera ----------------------------------------------------------- */
  function clampCamera() {
    const cam = BW.state.camera;
    cam.x = Math.max(0, Math.min(cfg.world.width  - cfg.view.width,  cam.x));
    cam.y = Math.max(0, Math.min(cfg.world.height - cfg.view.height, cam.y));
  }
  BW.centerCamera = function (x, y) {
    BW.state.camera.x = x - cfg.view.width / 2;
    BW.state.camera.y = y - cfg.view.height / 2;
    clampCamera();
  };
  // Jump to the fight (Space): the latest incoming-attack alert, else your base.
  BW.jumpToAction = function () {
    const s = BW.state;
    const alert = [...s.alerts].reverse().find(a => a.type === 'incoming' && a.x != null);
    if (alert) return BW.centerCamera(alert.x, alert.y);
    const home = s.buildings.find(b => b.team === 'player' && cfg.BUILDING_STATS[b.kind].category === 'nest');
    if (home) BW.centerCamera(home.x, home.y);
  };

  // Held-key + edge-of-screen scrolling, applied every frame by main.js with
  // REAL elapsed seconds (so you can scroll while paused, at any game speed).
  const held = new Set();
  let pointer = null;          // last mouse position in canvas coords (null = off-canvas)
  function updateCamera(dtReal) {
    const s = BW.state; if (!s || s.phase === 'menu') return;
    let dx = 0, dy = 0;
    if (held.has('a') || held.has('ArrowLeft'))  dx -= 1;
    if (held.has('d') || held.has('ArrowRight')) dx += 1;
    if (held.has('w') || held.has('ArrowUp'))    dy -= 1;
    if (held.has('s') || held.has('ArrowDown'))  dy += 1;
    if (dx || dy) { s.camera.x += dx * cfg.camera.keySpeed * dtReal; s.camera.y += dy * cfg.camera.keySpeed * dtReal; }
    // edge scroll — off while box-selecting, minimap-panning, middle-drag-panning,
    // or when the cursor is over the minimap (so reaching for it doesn't run the camera away)
    if (pointer && !s.drag && !minimapPan && !panDrag && !inMinimap(pointer)) {
      const ez = cfg.camera.edgeSize, sp = cfg.camera.edgeSpeed, v = cfg.view;
      if (pointer.x < ez) s.camera.x -= sp * dtReal; else if (pointer.x > v.width - ez)  s.camera.x += sp * dtReal;
      if (pointer.y < ez) s.camera.y -= sp * dtReal; else if (pointer.y > v.height - ez) s.camera.y += sp * dtReal;
    }
    clampCamera();
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
  // any of your production buildings (anything that trains units — base included), for setting a rally point
  const playerProducerAt = p => pick(BW.state.buildings.filter(b => b.team === 'player' && BW.config.BUILDING_STATS[b.kind].trains), p, 6);

  function addPing(x, y, type) { BW.state.pings.push({ x, y, type, t: BW.state.time }); }

  // ---- select by type (buttons + double-click) ----
  function selectWhere(pred) {
    BW.state.selected = new Set(BW.state.units.filter(u => u.team === 'player' && pred(u)).map(u => u.id));
    BW.state.selectedBuilding = null;
    if (BW.sound) BW.sound.play('select');
  }
  const gathererKind = team => BW.config.FACTIONS[BW.state.faction[team]].gatherer;
  BW.select = {
    all:         () => selectWhere(() => true),
    workers:     () => selectWhere(u => u.kind === gathererKind('player')),
    army:        () => selectWhere(u => u.kind !== gathererKind('player')),
    idleWorkers: () => selectWhere(u => u.kind === gathererKind('player') && u.order.type === 'idle'),
  };
  let lastClick = null;   // {t, kind, x, y} for double-click detection

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }
  BW.toast = toast;

  /* ---- selection drag + minimap pan + middle-drag pan ------------------- */
  let dragStart = null, dragging = false, minimapPan = false, panDrag = null;
  const DRAG = 6;

  function onMouseDown(e) {
    if (BW.state.phase !== 'playing') return;
    if (e.button === 1) {                         // MIDDLE-drag grabs and pans the map
      e.preventDefault();
      const sp = screenPos(e);
      panDrag = { sx: sp.x, sy: sp.y, camx: BW.state.camera.x, camy: BW.state.camera.y };
      return;
    }
    if (e.button !== 0) return;
    const sp = screenPos(e);
    if (inMinimap(sp)) {                          // minimap: jump + start panning
      const w = miniToWorld(sp);
      BW.centerCamera(w.x, w.y);
      minimapPan = true;
      return;
    }
    const p = worldPos(e);
    if (BW.state.placing) {                       // place a building
      const res = BW.tryBuild(BW.state.placing.kind, 'player', p.x, p.y);
      if (res.ok) {
        addPing(p.x, p.y, 'build'); if (BW.sound) BW.sound.play('build');
        // walls chain-place by default (keep clicking to lay a line); others need shift
        if (!e.shiftKey && BW.state.placing.kind !== 'wall') BW.state.placing = null;
      }
      else toast(res.reason);
      return;
    }
    dragStart = p; dragging = false; BW.state.drag = null;
  }
  function onMouseMove(e) {
    const sp = screenPos(e);
    pointer = (sp.x >= 0 && sp.y >= 0 && sp.x <= cfg.view.width && sp.y <= cfg.view.height) ? sp : null;
    if (panDrag) {                                // middle-drag: move the world with the cursor
      BW.state.camera.x = panDrag.camx - (sp.x - panDrag.sx);
      BW.state.camera.y = panDrag.camy - (sp.y - panDrag.sy);
      clampCamera(); return;
    }
    if (minimapPan) { const w = miniToWorld(sp); BW.centerCamera(w.x, w.y); return; }
    const p = worldPos(e);
    if (BW.state.placing) { BW.state.placeXY = p; return; }
    if (!dragStart) return;
    if (!dragging && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > DRAG) dragging = true;
    if (dragging) BW.state.drag = { x0: dragStart.x, y0: dragStart.y, x1: p.x, y1: p.y };
  }
  function onMouseUp(e) {
    if (panDrag) { panDrag = null; return; }      // end middle-drag pan
    if (e.button !== 0) return;
    if (minimapPan) { minimapPan = false; return; }
    if (!dragStart) return;
    const p = worldPos(e), s = BW.state;
    if (dragging) { s.selected = new Set(unitsInBox(s.units, dragStart.x, dragStart.y, p.x, p.y, 'player')); s.selectedBuilding = null; }
    else {
      const u = playerUnitAt(p);
      if (u) {
        const now = performance.now();
        const dbl = lastClick && now - lastClick.t < 320 && lastClick.kind === u.kind && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 24;
        if (dbl) selectWhere(uu => uu.kind === u.kind);              // double-click → all of this type
        else if (e.shiftKey) s.selected.add(u.id);
        else s.selected = new Set([u.id]);
        lastClick = { t: now, kind: u.kind, x: p.x, y: p.y };
        s.selectedBuilding = null;                                   // units take over the selection
      } else {
        const b = playerProducerAt(p);                              // clicked a production building? select it to set its rally
        if (b) { s.selectedBuilding = b.id; s.selected.clear(); if (BW.sound) BW.sound.play('select'); toast('Right-click a spot (or a resource) to set the rally point'); }
        else if (!e.shiftKey) { s.selected.clear(); s.selectedBuilding = null; }
      }
    }
    dragStart = null; dragging = false; s.drag = null;
  }

  /* ---- right-click orders (canvas OR minimap) --------------------------- */
  function onContextMenu(e) {
    e.preventDefault();
    const s = BW.state;
    if (s.phase !== 'playing' || !human()) return;   // spectating AI-vs-AI: no commands
    if (s.placing) { s.placing = null; return; }   // cancel placement
    const sp = screenPos(e);
    const p = inMinimap(sp) ? miniToWorld(sp) : worldPos(e);   // minimap right-click = order there
    // A production building is selected → right-click sets its RALLY point (new units walk there;
    // a gatherer rallied onto a resource node will mine it).
    if (s.selectedBuilding != null) {
      const b = BW.byId(s.selectedBuilding);
      if (b) {
        const rnode = nodeAt(p);
        b.rally = { x: p.x, y: p.y, nodeId: rnode ? rnode.id : null };
        addPing(p.x, p.y, rnode ? 'gather' : 'move');
        if (BW.sound) BW.sound.play(rnode ? 'gather' : 'move');
      }
      return;
    }
    if (s.selected.size === 0) return;
    const enemy = enemyAt(p), node = nodeAt(p), home = ownNestAt(p);
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

  const PAN_KEYS = ['w', 'a', 's', 'd', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  function onKeyDown(e) {
    const lk = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (PAN_KEYS.includes(lk)) { held.add(lk); if (lk.startsWith('Arrow')) e.preventDefault(); }
    const d = parseInt(e.key, 10);                          // 1..n trains the faction's units
    if (d >= 1 && d <= 9) { const menu = BW.config.FACTIONS[BW.state.faction.player].trainMenu; if (menu[d - 1]) return train(menu[d - 1]); }
    if (lk === 'q') return BW.select.workers();
    if (lk === 'e') return BW.select.army();
    if (e.key === '.') return BW.select.idleWorkers();
    if (e.key === ' ') { e.preventDefault(); return BW.jumpToAction(); }
    if (lk === 'p') BW.togglePause();
    if (lk === 'r') BW.restart();
    if (e.key === '[' || e.key === '-' || e.key === '_') return BW.cycleSpeed(-1);   // slower
    if (e.key === ']' || e.key === '=' || e.key === '+') return BW.cycleSpeed(+1);    // faster
    if (e.key === 'Escape') { if (BW.state.placing) BW.state.placing = null; else { BW.state.selected.clear(); BW.state.selectedBuilding = null; } }
  }
  function onKeyUp(e) {
    const lk = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    held.delete(lk);
  }

  function attach(canvas) {
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { held.clear(); panDrag = null; minimapPan = false; });  // don't get stuck on alt-tab
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

  BW.input = { attach, unitsInBox, updateCamera };
})();
