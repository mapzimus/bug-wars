/* ============================================================================
   Bug Wars — input.js   (v5.1: zoom + next-ready)
   ----------------------------------------------------------------------------
   Tap-to-order controls, drag pan, pinch/wheel zoom, cycle next ready unit.

     tap own unit          select (shows move / attack range)
     tap blue tile         move there
     tap enemy in range    move + attack (shows damage preview on hover)
     tap resource (worker) assign gather
     drag                  pan camera
     pinch / wheel         zoom
     F / Next              cycle to next ready unit
     End Turn / Enter      finish your turn
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const sys = () => BW.systems;

  function zoom() { return (BW.state && BW.state.camera && BW.state.camera.zoom) || 1; }
  function viewW() { return cfg.view.width / zoom(); }
  function viewH() { return cfg.view.height / zoom(); }

  function screenPos(e) {
    const c = BW.canvas, r = c.getBoundingClientRect();
    const src = e.touches && e.touches[0] ? e.touches[0]
              : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0]
              : e;
    return { x: (src.clientX - r.left) * (c.width / r.width), y: (src.clientY - r.top) * (c.height / r.height) };
  }
  function worldPos(e) {
    const sp = screenPos(e), cam = BW.state.camera, z = zoom();
    return { x: sp.x / z + cam.x, y: sp.y / z + cam.y };
  }

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

  function clampCamera() {
    const cam = BW.state.camera;
    const vw = viewW(), vh = viewH();
    cam.x = Math.max(0, Math.min(Math.max(0, cfg.world.width  - vw), cam.x));
    cam.y = Math.max(0, Math.min(Math.max(0, cfg.world.height - vh), cam.y));
  }
  BW.centerCamera = function (x, y) {
    BW.state.camera.x = x - viewW() / 2;
    BW.state.camera.y = y - viewH() / 2;
    clampCamera();
  };
  BW.jumpToAction = function () {
    const s = BW.state;
    const alert = [...s.alerts].reverse().find(a => a.type === 'incoming' && a.x != null);
    if (alert) return BW.centerCamera(alert.x, alert.y);
    const home = s.buildings.find(b => b.team === 'player' && cfg.BUILDING_STATS[b.kind].category === 'nest');
    if (home) BW.centerCamera(home.x, home.y);
  };

  function setZoom(z, anchorScreen) {
    const s = BW.state; if (!s || !s.camera) return;
    const old = s.camera.zoom || 1;
    const next = Math.max(cfg.camera.zoomMin, Math.min(cfg.camera.zoomMax, z));
    if (Math.abs(next - old) < 0.001) return;
    // Zoom toward the anchor point (pinch center or cursor).
    const ax = anchorScreen ? anchorScreen.x : cfg.view.width / 2;
    const ay = anchorScreen ? anchorScreen.y : cfg.view.height / 2;
    const wx = ax / old + s.camera.x;
    const wy = ay / old + s.camera.y;
    s.camera.zoom = next;
    s.camera.x = wx - ax / next;
    s.camera.y = wy - ay / next;
    clampCamera();
  }
  BW.setZoom = setZoom;

  const held = new Set();
  function updateCamera(dtReal) {
    const s = BW.state; if (!s || s.phase === 'menu') return;
    let dx = 0, dy = 0;
    if (held.has('a') || held.has('ArrowLeft'))  dx -= 1;
    if (held.has('d') || held.has('ArrowRight')) dx += 1;
    if (held.has('w') || held.has('ArrowUp'))    dy -= 1;
    if (held.has('s') || held.has('ArrowDown'))  dy += 1;
    if (dx || dy) {
      s.camera.x += dx * cfg.camera.keySpeed * dtReal / zoom();
      s.camera.y += dy * cfg.camera.keySpeed * dtReal / zoom();
      s.camTarget = null;
      clampCamera();
    }
  }

  function pick(list, p, pad) {
    let best = null, bestD = Infinity;
    for (const e of list) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= sys().entityRadius(e) + pad && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
  const playerUnitAt = p => pick(BW.state.units.filter(u => u.team === 'player'), p, 10);
  const enemyAt      = p => pick([...BW.state.units, ...BW.state.buildings].filter(e => e.team === 'enemy'), p, 10);
  const nodeAt       = p => pick(BW.state.nodes, p, 12);
  const playerProducerAt = p => pick(BW.state.buildings.filter(b => b.team === 'player' && cfg.BUILDING_STATS[b.kind].trains), p, 10);

  function selectUnit(u) {
    const s = BW.state;
    s.selected = new Set([u.id]);
    s.selectedBuilding = null;
    s.hoverDmg = null;
    if (u.acted) { s.moveHint = null; }
    else sys().refreshMoveHint(u);
    if (BW.sound) BW.sound.play('select');
  }

  function selectWhere(pred) {
    BW.state.selected = new Set(BW.state.units.filter(u => u.team === 'player' && pred(u)).map(u => u.id));
    BW.state.selectedBuilding = null;
    BW.state.hoverDmg = null;
    const ids = [...BW.state.selected];
    if (ids.length === 1) sys().refreshMoveHint(BW.byId(ids[0]));
    else if (ids.length > 1) sys().refreshGroupHint(ids);
    else BW.state.moveHint = null;
    if (BW.sound) BW.sound.play('select');
  }
  const gathererKind = team => cfg.FACTIONS[BW.state.faction[team]].gatherer;

  function selectNextReady() {
    const s = BW.state;
    if (!s || s.phase !== 'playing' || s.turn.side !== 'player' || s.turn.busy) return false;
    const ready = s.units.filter(u => u.team === 'player' && !u.acted);
    if (!ready.length) { s.selected.clear(); s.moveHint = null; return false; }
    const cur = s.selected.size === 1 ? [...s.selected][0] : null;
    let idx = ready.findIndex(u => u.id === cur);
    const next = ready[(idx + 1) % ready.length];
    selectUnit(next);
    BW.centerCamera(next.x, next.y);
    return true;
  }
  BW.selectNextReady = selectNextReady;

  BW.select = {
    all:         () => selectWhere(() => true),
    workers:     () => selectWhere(u => u.kind === gathererKind('player')),
    army:        () => selectWhere(u => u.kind !== gathererKind('player')),
    idleWorkers: () => selectWhere(u => u.kind === gathererKind('player') && !u.acted && !u.gathering),
    ready:       () => selectWhere(u => !u.acted),
    next:        () => selectNextReady(),
  };

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }
  BW.toast = toast;

  const human = () => BW.state.controllers && BW.state.controllers.player === 'human';
  const playerTurn = () => human() && BW.state.turn && BW.state.turn.side === 'player' && !BW.state.turn.busy;

  let panDrag = null, minimapPan = false, tapStart = null, pinch = null;
  const PAN_THRESH = 10;

  function afterAct() {
    BW.state.hoverDmg = null;
    // Prefer auto-advancing to the next ready unit; if none, clear selection.
    if (!selectNextReady()) {
      BW.state.selected.clear();
      BW.state.moveHint = null;
    }
  }

  function updateHoverDmg(p) {
    const s = BW.state;
    s.hoverDmg = null;
    if (!playerTurn() || !s.selected.size || !s.moveHint) return;
    const enemy = enemyAt(p);
    const outpost = pick(BW.state.buildings.filter(b => b.kind === 'outpost' && b.team !== 'player'), p, 12);
    const target = enemy || outpost;
    if (!target || !s.moveHint.attacks.has(target.id)) return;
    const u = s.selected.size === 1 ? BW.byId([...s.selected][0]) : null;
    if (u && !u.acted) {
      const dmg = sys().previewDamage(u, target);
      const tag = sys().counterLabel(u, target);
      s.hoverDmg = { targetId: target.id, text: dmg + ' dmg' + (tag ? ' ' + tag : ''), x: target.x, y: target.y };
      return;
    }
    let n = 0;
    for (const id of s.selected) {
      const unit = BW.byId(id);
      if (!unit || unit.acted) continue;
      const atks = new Set();
      for (const t of sys().attackTargetsFrom(unit, unit.gx, unit.gy)) atks.add(t.id);
      for (const k of sys().moveRange(unit)) {
        const [gx, gy] = k.split(',').map(Number);
        for (const t of sys().attackTargetsFrom(unit, gx, gy)) atks.add(t.id);
      }
      if (atks.has(target.id)) n++;
    }
    if (n) s.hoverDmg = { targetId: target.id, text: n + ' can hit', x: target.x, y: target.y };
  }

  function onPointerDown(e) {
    if (BW.state.phase !== 'playing') return;
    // Pinch start (two touches)
    if (e.touches && e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
      const rect = BW.canvas.getBoundingClientRect();
      pinch = {
        dist: Math.hypot(dx, dy),
        zoom: zoom(),
        mid: {
          x: ((a.clientX + b.clientX) / 2 - rect.left) * (BW.canvas.width / rect.width),
          y: ((a.clientY + b.clientY) / 2 - rect.top) * (BW.canvas.height / rect.height),
        },
      };
      tapStart = null; panDrag = null;
      return;
    }
    if (e.button != null && e.button === 1) {
      e.preventDefault();
      const sp = screenPos(e);
      panDrag = { sx: sp.x, sy: sp.y, camx: BW.state.camera.x, camy: BW.state.camera.y };
      return;
    }
    if (e.button != null && e.button !== 0) return;
    const sp = screenPos(e);
    if (inMinimap(sp)) {
      const w = miniToWorld(sp);
      BW.centerCamera(w.x, w.y);
      BW.state.camTarget = null;
      minimapPan = true;
      return;
    }
    tapStart = { sp, wp: worldPos(e), t: performance.now(), panning: false };
  }

  function onPointerMove(e) {
    if (pinch && e.touches && e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch.dist > 0) setZoom(pinch.zoom * (dist / pinch.dist), pinch.mid);
      return;
    }
    const sp = screenPos(e);
    if (panDrag) {
      BW.state.camera.x = panDrag.camx - (sp.x - panDrag.sx) / zoom();
      BW.state.camera.y = panDrag.camy - (sp.y - panDrag.sy) / zoom();
      BW.state.camTarget = null;
      clampCamera();
      return;
    }
    if (minimapPan) { const w = miniToWorld(sp); BW.centerCamera(w.x, w.y); return; }
    if (BW.state.placing) { BW.state.placeXY = worldPos(e); return; }
    if (tapStart) {
      const dx = sp.x - tapStart.sp.x, dy = sp.y - tapStart.sp.y;
      if (!tapStart.panning && Math.hypot(dx, dy) > PAN_THRESH) {
        tapStart.panning = true;
        panDrag = { sx: tapStart.sp.x, sy: tapStart.sp.y, camx: BW.state.camera.x, camy: BW.state.camera.y };
        tapStart = null;
        BW.state.camera.x = panDrag.camx - (sp.x - panDrag.sx) / zoom();
        BW.state.camera.y = panDrag.camy - (sp.y - panDrag.sy) / zoom();
        BW.state.camTarget = null;
        clampCamera();
      }
      return;
    }
    updateHoverDmg(worldPos(e));
  }

  function issueGroupOrder(p) {
    const s = BW.state;
    const ids = [...s.selected].map(id => BW.byId(id)).filter(u => u && u.team === 'player' && !u.acted);
    if (!ids.length) return false;
    const enemy = enemyAt(p);
    const outpost = pick(BW.state.buildings.filter(b => b.kind === 'outpost' && b.team !== 'player'), p, 12);
    const target = enemy || outpost;
    const node = nodeAt(p);
    const tile = BW.world.toTile(p.x, p.y);

    if (target) {
      for (const u of ids) {
        const r = sys().actAttack(u, target);
        if (!r.ok) sys().actMoveToward(u, target.gx, target.gy);
      }
      afterAct();
      return true;
    }
    if (node && ids.every(u => u.kind === gathererKind('player'))) {
      for (const u of ids) sys().actGather(u, node);
      afterAct();
      return true;
    }
    for (const u of ids) sys().actMoveToward(u, tile.gx, tile.gy);
    afterAct();
    return true;
  }

  function issueOrder(p) {
    const s = BW.state;
    if (!playerTurn()) return;
    if (s.placing) {
      const res = BW.tryBuild(s.placing.kind, 'player', p.x, p.y);
      if (res.ok) {
        if (BW.sound) BW.sound.play('build');
        if (s.placing.kind !== 'wall') s.placing = null;
      } else toast(res.reason);
      return;
    }

    if (s.selectedBuilding != null && s.selected.size === 0) {
      const b = BW.byId(s.selectedBuilding);
      if (b && b.trainQueue) {
        const clicked = playerUnitAt(p);
        if (clicked) { selectUnit(clicked); return; }
        sys().setRally(b, p.x, p.y);
        toast('Rally set');
        BW.state.pings.push({ x: b.rallyX, y: b.rallyY, type: 'move', t: BW.state.time });
        return;
      }
    }

    if (s.selected.size > 1) {
      if (issueGroupOrder(p)) return;
    }

    if (s.selected.size === 1) {
      const u = BW.byId([...s.selected][0]);
      if (u && !u.acted) {
        const enemy = enemyAt(p);
        const outpost = pick(BW.state.buildings.filter(b => b.kind === 'outpost' && b.team !== 'player'), p, 12);
        const node = nodeAt(p);
        const tile = BW.world.toTile(p.x, p.y);
        const atkTarget = (enemy && s.moveHint && s.moveHint.attacks.has(enemy.id)) ? enemy
          : (outpost && s.moveHint && s.moveHint.attacks.has(outpost.id)) ? outpost
          : null;
        if (atkTarget) {
          const r = sys().actAttack(u, atkTarget);
          if (!r.ok) toast(r.reason);
          else afterAct();
          return;
        }
        if (node && u.kind === gathererKind('player')) {
          const r = sys().actGather(u, node);
          if (!r.ok) toast(r.reason);
          else afterAct();
          return;
        }
        if (s.moveHint && s.moveHint.moves.has(sys().key(tile.gx, tile.gy))) {
          const r = sys().actMove(u, tile.gx, tile.gy);
          if (!r.ok) toast(r.reason);
          else afterAct();
          return;
        }
      }
    }

    const u = playerUnitAt(p);
    if (u) {
      selectUnit(u);
      if (u.acted) toast('Already acted this turn');
      return;
    }
    const b = playerProducerAt(p);
    if (b) {
      s.selectedBuilding = b.id; s.selected.clear(); s.moveHint = null; s.hoverDmg = null;
      if (BW.sound) BW.sound.play('select');
      return;
    }
    s.selected.clear(); s.selectedBuilding = null; s.moveHint = null; s.hoverDmg = null;
  }

  function onPointerUp(e) {
    if (e.touches && e.touches.length >= 2) return;
    if (pinch && (!e.touches || e.touches.length < 2)) { pinch = null; return; }
    if (panDrag) { panDrag = null; return; }
    if (minimapPan) { minimapPan = false; return; }
    if (!tapStart) return;
    if (tapStart.panning) { tapStart = null; return; }
    issueOrder(worldPos(e));
    tapStart = null;
  }

  function onContextMenu(e) {
    e.preventDefault();
    if (BW.state.phase !== 'playing' || !playerTurn()) return;
    if (BW.state.placing) { BW.state.placing = null; return; }
    issueOrder(worldPos(e));
  }

  function onWheel(e) {
    if (BW.state.phase === 'menu') return;
    e.preventDefault();
    const sp = screenPos(e);
    const dir = e.deltaY > 0 ? -1 : 1;
    setZoom(zoom() + dir * cfg.camera.zoomStep, sp);
    BW.state.camTarget = null;
  }

  function train(kind) {
    if (BW.state.phase === 'playing' && playerTurn()) {
      const r = BW.tryTrain(kind, 'player');
      if (!r.ok) toast(r.reason);
      else if (BW.sound) BW.sound.play('train');
    }
  }
  function build(kind) {
    if (BW.state.phase !== 'playing' || !playerTurn()) return;
    BW.state.placing = (BW.state.placing && BW.state.placing.kind === kind) ? null : { kind };
  }
  function upgrade(key) {
    if (BW.state.phase === 'playing' && playerTurn()) {
      const r = BW.tryUpgrade(key, 'player');
      if (!r.ok) toast(r.reason);
    }
  }

  const PAN_KEYS = ['w', 'a', 's', 'd', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  function onKeyDown(e) {
    const lk = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (PAN_KEYS.includes(lk)) { held.add(lk); if (lk.startsWith('Arrow')) e.preventDefault(); }
    const d = parseInt(e.key, 10);
    if (d >= 1 && d <= 9) {
      const menu = cfg.FACTIONS[BW.state.faction.player].trainMenu;
      if (menu[d - 1]) return train(menu[d - 1]);
    }
    if (lk === 'q') return BW.select.workers();
    if (lk === 'e') return BW.select.army();
    if (e.key === '.') return BW.select.idleWorkers();
    if (lk === 'f' || e.key === 'Tab') { e.preventDefault(); return selectNextReady(); }
    if (e.key === ' ') { e.preventDefault(); return BW.jumpToAction(); }
    if (lk === 'r') BW.restart();
    if (e.key === 'Enter' || lk === 'n') { e.preventDefault(); if (playerTurn()) BW.endTurn(); }
    if (e.key === '=' || e.key === '+') setZoom(zoom() + cfg.camera.zoomStep);
    if (e.key === '-' || e.key === '_') setZoom(zoom() - cfg.camera.zoomStep);
    if (e.key === 'Escape') {
      if (BW.state.placing) BW.state.placing = null;
      else { BW.state.selected.clear(); BW.state.selectedBuilding = null; BW.state.moveHint = null; BW.state.hoverDmg = null; }
    }
  }
  function onKeyUp(e) {
    const lk = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    held.delete(lk);
  }

  function attach(canvas) {
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    canvas.addEventListener('touchmove', e => { if (e.touches.length === 2) e.preventDefault(); onPointerMove(e); }, { passive: false });
    canvas.addEventListener('touchend', onPointerUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { held.clear(); panDrag = null; minimapPan = false; tapStart = null; pinch = null; });

    const panel = document.querySelector('.panel');
    if (panel) panel.addEventListener('click', e => {
      const tb = e.target.closest('.trainbtn'); if (tb) return train(tb.dataset.train);
      const bb = e.target.closest('.buildbtn'); if (bb) return build(bb.dataset.build);
      const ub = e.target.closest('.upgradebtn'); if (ub) return upgrade(ub.dataset.upgrade);
    });
    document.querySelectorAll('[data-select]').forEach(b => b.addEventListener('click', () => BW.select[b.dataset.select] && BW.select[b.dataset.select]()));
    document.querySelectorAll('[data-action="restart"]').forEach(b => b.addEventListener('click', () => BW.restart()));
    const endBtn = document.getElementById('endTurnBtn');
    if (endBtn) endBtn.addEventListener('click', () => { if (playerTurn()) BW.endTurn(); else toast('Wait for your turn'); });
  }

  BW.input = { attach, updateCamera, viewW, viewH, zoom };
})();
