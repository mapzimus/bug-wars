/* ============================================================================
   Bug Wars — input.js   (v5: real RTS controls)
   ----------------------------------------------------------------------------
   Mouse + keyboard → game orders, plus the CAMERA (which now zooms).

   COORDINATES: the camera has a zoom factor, so
       screen = (world - camera) * zoom      world = screen / zoom + camera

   ---- Keymap ----------------------------------------------------------------
     Camera   WASD / arrows / screen edges · middle-drag · minimap drag
              Space  jump to the action     F  focus your base
              wheel or + / −  zoom
     Select   left-click · left-drag box · double-click = all of that type
              Ctrl+click = all of that type · Q workers · E army · . idle workers
     Groups   Ctrl+1..9 assign · 1..9 recall (tap twice to jump there) · Shift+1..9 add
     Orders   right-click  gather / attack / attack-move (fighters engage on the way)
              Shift+right-click  QUEUE the order after the current one
              M  next right-click is a plain MOVE (no engaging)
              X  stop      H  hold position (fight, never chase)
     Build    T Y U I O    Train  Z C V B N   (labels on the buttons)
              right-click a train button cancels + refunds one
     Misc     P pause · R restart · [ ] game speed · Esc clear / cancel
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const sys = () => BW.systems;

  // Hotkey pools, in menu order. ui.js reads these to label the buttons, so the
  // key shown and the key handled can never drift apart.
  BW.HOTKEYS = {
    build: ['t', 'y', 'u', 'i', 'o'],
    train: ['z', 'c', 'v', 'b', 'n'],
  };

  /* ---- coordinate transforms ------------------------------------------- */
  // screenPos: event → CANVAS CSS-pixel coords (0..view.w / 0..view.h).
  // main.js keeps cfg.view in CSS pixels and pre-scales the context by the
  // device pixel ratio, so everything here stays in one consistent space.
  function screenPos(e) {
    const c = BW.canvas, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (cfg.view.width / r.width), y: (e.clientY - r.top) * (cfg.view.height / r.height) };
  }
  // worldPos: event → WORLD coords (camera offset + zoom applied)
  function worldPos(e) {
    const sp = screenPos(e), cam = BW.state.camera;
    return { x: sp.x / cam.zoom + cam.x, y: sp.y / cam.zoom + cam.y };
  }
  // How much world the canvas currently shows.
  const visW = () => cfg.view.width / BW.state.camera.zoom;
  const visH = () => cfg.view.height / BW.state.camera.zoom;
  BW.visibleWorld = () => ({ w: visW(), h: visH() });

  /* ---- minimap geometry (render.js draws with the same rect) ----------- */
  function minimapRect() {
    const mm = cfg.minimap, v = cfg.view;
    const h = Math.round(mm.w * cfg.world.height / cfg.world.width);
    return { x: v.width - mm.w - mm.margin, y: v.height - h - mm.margin, w: mm.w, h };
  }
  const inMinimap = sp => { const m = minimapRect(); return sp.x >= m.x - 2 && sp.x <= m.x + m.w + 2 && sp.y >= m.y - 2 && sp.y <= m.y + m.h + 2; };
  const miniToWorld = sp => {
    const m = minimapRect();
    return {
      x: Math.max(0, Math.min(cfg.world.width,  (sp.x - m.x) / m.w * cfg.world.width)),
      y: Math.max(0, Math.min(cfg.world.height, (sp.y - m.y) / m.h * cfg.world.height)),
    };
  };
  BW.minimapRect = minimapRect;

  /* ---- camera ----------------------------------------------------------- */
  // Clamp so you can never scroll off the world. If the view is WIDER than the
  // world (fully zoomed out on a wide monitor), centre instead of clamping.
  function clampCamera() {
    const cam = BW.state.camera, W = cfg.world.width, H = cfg.world.height;
    const vw = visW(), vh = visH();
    cam.x = vw >= W ? (W - vw) / 2 : Math.max(0, Math.min(W - vw, cam.x));
    cam.y = vh >= H ? (H - vh) / 2 : Math.max(0, Math.min(H - vh, cam.y));
  }
  BW.clampCamera = clampCamera;

  BW.centerCamera = function (x, y) {
    const cam = BW.state.camera;
    cam.x = x - visW() / 2;
    cam.y = y - visH() / 2;
    clampCamera();
  };

  // Zoom about a fixed screen point (the cursor), so the world under the mouse
  // stays put — the thing that makes wheel-zoom feel right instead of lurching.
  function zoomAt(factor, sx, sy) {
    const cam = BW.state.camera;
    const before = { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
    cam.zoom = Math.max(cfg.zoom.min, Math.min(cfg.zoom.max, cam.zoom * factor));
    cam.x = before.x - sx / cam.zoom;
    cam.y = before.y - sy / cam.zoom;
    clampCamera();
  }
  BW.zoomBy = function (dir) {
    const f = dir > 0 ? cfg.zoom.step : 1 / cfg.zoom.step;
    zoomAt(f, cfg.view.width / 2, cfg.view.height / 2);
  };

  // Jump to the fight (Space): the latest incoming-attack alert, else your base.
  BW.jumpToAction = function () {
    const s = BW.state;
    const alert = [...s.alerts].reverse().find(a => a.type === 'incoming' && a.x != null);
    if (alert) return BW.centerCamera(alert.x, alert.y);
    BW.focusBase();
  };
  BW.focusBase = function () {
    const home = BW.state.buildings.find(b => b.team === 'player' && cfg.BUILDING_STATS[b.kind].category === 'nest');
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
    // Divide by zoom so panning covers the same amount of SCREEN per second at
    // every zoom level — otherwise zoomed-out scrolling feels sluggish.
    const k = cfg.camera.keySpeed / s.camera.zoom;
    if (dx || dy) { s.camera.x += dx * k * dtReal; s.camera.y += dy * k * dtReal; }
    if (pointer && !s.drag && !minimapPan && !panDrag && !inMinimap(pointer)) {
      const ez = cfg.camera.edgeSize, sp = cfg.camera.edgeSpeed / s.camera.zoom, v = cfg.view;
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
  const ownNestAt     = p => pick(BW.state.buildings.filter(b => b.team === 'player' && cfg.BUILDING_STATS[b.kind].category === 'nest'), p, 6);
  const playerProducerAt = p => pick(BW.state.buildings.filter(b => b.team === 'player' && cfg.BUILDING_STATS[b.kind].trains), p, 6);

  function addPing(x, y, type) { BW.state.pings.push({ x, y, type, t: BW.state.time }); }

  // ---- select by type (buttons + double-click) ----
  function selectWhere(pred) {
    BW.state.selected = new Set(BW.state.units.filter(u => u.team === 'player' && pred(u)).map(u => u.id));
    BW.state.selectedBuilding = null;
    if (BW.sound) BW.sound.play('select');
  }
  const gathererKind = team => cfg.FACTIONS[BW.state.faction[team]].gatherer;
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

  /* ---- control groups ---------------------------------------------------
     Ctrl+N binds the current selection to N. N recalls it. Tapping N twice
     quickly also centres the camera on the group — the standard RTS idiom for
     "show me my army" without hunting on the minimap. */
  let lastGroupKey = null, lastGroupTime = 0;
  function assignGroup(n) {
    const s = BW.state;
    if (!s.selected.size) return;
    s.groups[n] = [...s.selected];
    toast('Group ' + n + ' set (' + s.groups[n].length + ')');
    if (BW.sound) BW.sound.play('select');
  }
  function addToGroup(n) {
    const s = BW.state;
    if (!s.selected.size) return;
    const set = new Set(s.groups[n] || []);
    for (const id of s.selected) set.add(id);
    s.groups[n] = [...set];
    toast('Group ' + n + ' now ' + s.groups[n].length);
  }
  function recallGroup(n) {
    const s = BW.state, ids = s.groups[n];
    if (!ids || !ids.length) return;
    s.selected = new Set(ids);
    s.selectedBuilding = null;
    if (BW.sound) BW.sound.play('select');
    const now = performance.now();
    if (lastGroupKey === n && now - lastGroupTime < 400) {          // double-tap → jump to them
      let cx = 0, cy = 0, k = 0;
      for (const id of ids) { const u = BW.byId(id); if (u) { cx += u.x; cy += u.y; k++; } }
      if (k) BW.centerCamera(cx / k, cy / k);
    }
    lastGroupKey = n; lastGroupTime = now;
  }

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
      const z = BW.state.camera.zoom;
      BW.state.camera.x = panDrag.camx - (sp.x - panDrag.sx) / z;
      BW.state.camera.y = panDrag.camy - (sp.y - panDrag.sy) / z;
      clampCamera(); return;
    }
    if (minimapPan) { const w = miniToWorld(sp); BW.centerCamera(w.x, w.y); return; }
    const p = worldPos(e);
    if (BW.state.placing) { BW.state.placeXY = p; return; }
    if (!dragStart) return;
    if (!dragging && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > DRAG / BW.state.camera.zoom) dragging = true;
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
        if (dbl || e.ctrlKey || e.metaKey) selectWhere(uu => uu.kind === u.kind);   // all of this type
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

  function onWheel(e) {
    if (BW.state.phase === 'menu') return;
    e.preventDefault();
    const sp = screenPos(e);
    zoomAt(e.deltaY < 0 ? cfg.zoom.step : 1 / cfg.zoom.step, sp.x, sp.y);
  }

  /* ---- right-click orders (canvas OR minimap) ---------------------------
     Shift QUEUES instead of replacing. `M` (move-only) forces a plain move so
     you can reposition an army across the map without it picking fights. */
  function onContextMenu(e) {
    e.preventDefault();
    const s = BW.state;
    if (s.phase !== 'playing' || !human()) return;   // spectating AI-vs-AI: no commands
    if (s.placing) { s.placing = null; return; }   // cancel placement
    const sp = screenPos(e);
    const p = inMinimap(sp) ? miniToWorld(sp) : worldPos(e);   // minimap right-click = order there

    // A production building is selected → right-click sets its RALLY point.
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
    const moveOnly = s.pendingMoveOnly;
    s.pendingMoveOnly = false;
    const queued = e.shiftKey;
    const n = s.selected.size; let i = 0;
    for (const id of s.selected) {
      const u = BW.byId(id); if (!u) continue;
      const a = (i / n) * Math.PI * 2, spread = n > 1 ? 16 + n * 0.6 : 0;
      const tx = p.x + Math.cos(a) * spread, ty = p.y + Math.sin(a) * spread;
      const isG = u.kind === gathererKind('player');
      let order;
      if (enemy && !moveOnly)     order = { type: 'attack', tx: enemy.x, ty: enemy.y, targetId: enemy.id };
      else if (node && isG)       order = { type: 'gather', tx: node.x, ty: node.y, targetId: node.id };
      else if (home && isG && !moveOnly) order = { type: 'idle', tx: u.x, ty: u.y, targetId: null };
      else if (isG || moveOnly)   order = { type: 'move', tx, ty, targetId: null };
      else                        order = { type: 'attackMove', tx, ty, targetId: null };
      sys().giveOrder(u, order, queued);
      i++;
    }
    const fxName = (enemy && !moveOnly) ? 'attack' : node ? 'gather' : 'move';
    addPing(p.x, p.y, fxName);
    if (BW.sound) BW.sound.play(fxName);
  }

  /* ---- stances ---------------------------------------------------------- */
  function commandSelected(fn) {
    const s = BW.state;
    if (!human() || !s.selected.size) return 0;
    let k = 0;
    for (const id of s.selected) { const u = BW.byId(id); if (u) { fn(u); k++; } }
    return k;
  }
  function stopSelected() {
    const k = commandSelected(u => { u.queue = []; u.order = sys().idle(u); u.path = null; u.pathGoal = null; });
    if (k) { toast('Stop'); if (BW.sound) BW.sound.play('select'); }
  }
  function holdSelected() {
    const k = commandSelected(u => { u.queue = []; u.order = { type: 'hold', tx: u.x, ty: u.y, targetId: null }; u.path = null; u.pathGoal = null; });
    if (k) { toast('Holding position'); if (BW.sound) BW.sound.play('select'); }
  }

  /* ---- panels & keys --------------------------------------------------- */
  const human = () => BW.state.controllers && BW.state.controllers.player === 'human';
  function train(kind, count) {
    if (BW.state.phase !== 'playing' || !human()) return;
    let last = null;
    for (let i = 0; i < (count || 1); i++) { last = BW.tryTrain(kind, 'player'); if (!last.ok) break; }
    if (last && !last.ok) toast(last.reason);
  }
  function untrain(kind) {
    if (BW.state.phase !== 'playing' || !human()) return;
    const r = BW.cancelTrain(kind, 'player');
    if (r.ok) toast('Cancelled — refunded'); else toast(r.reason);
  }
  function build(kind) {
    if (BW.state.phase !== 'playing' || !human()) return;
    BW.state.placing = (BW.state.placing && BW.state.placing.kind === kind) ? null : { kind };
  }
  function research(id) {
    if (BW.state.phase !== 'playing' || !human()) return;
    const r = BW.tryResearch(id, 'player');
    if (!r.ok) toast(r.reason);
    else { toast('Researching ' + cfg.UPGRADES[id].name); if (BW.sound) BW.sound.play('build'); }
  }
  BW.uiActions = { train, untrain, build, research };

  const PAN_KEYS = ['w', 'a', 's', 'd', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  function onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const lk = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // --- control groups take the number row (Ctrl assigns, Shift appends) ---
    const digit = /^[1-9]$/.test(e.key) ? e.key : null;
    if (digit) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) assignGroup(digit);
      else if (e.shiftKey) addToGroup(digit);
      else recallGroup(digit);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && lk === 'a') { e.preventDefault(); return BW.select.all(); }
    if (e.ctrlKey || e.metaKey) return;                     // leave other browser shortcuts alone

    if (PAN_KEYS.includes(lk)) { held.add(lk); if (lk.startsWith('Arrow')) e.preventDefault(); }

    // --- build / train hotkeys, resolved against the live faction menus ---
    const F = cfg.FACTIONS[BW.state.faction.player];
    if (F) {
      const bi = BW.HOTKEYS.build.indexOf(lk);
      if (bi >= 0 && F.buildMenu[bi]) return build(F.buildMenu[bi]);
      const ti = BW.HOTKEYS.train.indexOf(lk);
      if (ti >= 0 && F.trainMenu[ti]) return train(F.trainMenu[ti], e.shiftKey ? 5 : 1);
    }

    if (lk === 'q') return BW.select.workers();
    if (lk === 'e') return BW.select.army();
    if (e.key === '.') return BW.select.idleWorkers();
    if (lk === 'x') return stopSelected();
    if (lk === 'h') return holdSelected();
    if (lk === 'm') { BW.state.pendingMoveOnly = true; return toast('Move only — right-click a destination'); }
    if (lk === 'f') return BW.focusBase();
    if (e.key === ' ') { e.preventDefault(); return BW.jumpToAction(); }
    if (lk === 'p') return BW.togglePause();
    if (lk === 'r') return BW.restart();
    if (e.key === '[') return BW.cycleSpeed(-1);
    if (e.key === ']') return BW.cycleSpeed(+1);
    if (e.key === '+' || e.key === '=') return BW.zoomBy(+1);
    if (e.key === '-' || e.key === '_') return BW.zoomBy(-1);
    if (e.key === 'Escape') {
      if (BW.state.placing) BW.state.placing = null;
      else if (BW.state.pendingMoveOnly) BW.state.pendingMoveOnly = false;
      else { BW.state.selected.clear(); BW.state.selectedBuilding = null; }
    }
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
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { held.clear(); panDrag = null; minimapPan = false; });  // don't get stuck on alt-tab

    // Delegated so dynamically-rebuilt faction panels keep working.
    const panel = document.querySelector('.panel');
    if (panel) {
      panel.addEventListener('click', e => {
        const tb = e.target.closest('.trainbtn'); if (tb) return train(tb.dataset.train, e.shiftKey ? 5 : 1);
        const bb = e.target.closest('.buildbtn'); if (bb) return build(bb.dataset.build);
        const rb = e.target.closest('.resbtn');   if (rb) return research(rb.dataset.research);
      });
      panel.addEventListener('contextmenu', e => {                 // right-click a train button = cancel + refund
        const tb = e.target.closest('.trainbtn');
        if (tb) { e.preventDefault(); untrain(tb.dataset.train); }
        const rb = e.target.closest('.resbtn');
        if (rb) { e.preventDefault(); const r = BW.cancelResearch('player'); toast(r.ok ? 'Research cancelled — refunded' : r.reason); }
      });
    }
    document.querySelectorAll('[data-select]').forEach(b => b.addEventListener('click', () => BW.select[b.dataset.select] && BW.select[b.dataset.select]()));
    document.querySelectorAll('[data-action="restart"]').forEach(b => b.addEventListener('click', () => BW.restart()));
    const pause = document.getElementById('pauseBtn');
    if (pause) pause.addEventListener('click', () => BW.togglePause());
    const sd = document.getElementById('speedDown'); if (sd) sd.addEventListener('click', () => BW.cycleSpeed(-1));
    const su = document.getElementById('speedUp');   if (su) su.addEventListener('click', () => BW.cycleSpeed(+1));
    const zo = document.getElementById('zoomOut');   if (zo) zo.addEventListener('click', () => BW.zoomBy(-1));
    const zi = document.getElementById('zoomIn');    if (zi) zi.addEventListener('click', () => BW.zoomBy(+1));
    document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.cmd === 'stop') stopSelected();
      if (b.dataset.cmd === 'hold') holdSelected();
    }));
  }

  BW.input = { attach, unitsInBox, updateCamera };
})();
