/* ============================================================================
   Bug Wars — input.js   (v5: turn-based + touch)
   ----------------------------------------------------------------------------
   Tap-to-order controls for colony turns, plus camera (drag pan, WASD, minimap).

     tap own unit          select (shows move / attack range)
     tap blue tile         move there
     tap enemy in range    move + attack
     tap resource (worker) assign gather (move adjacent)
     tap empty / Esc       clear selection
     drag on empty ground  pan camera (mobile-friendly)
     End Turn / Enter      finish your turn
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const sys = () => BW.systems;

  function screenPos(e) {
    const c = BW.canvas, r = c.getBoundingClientRect();
    const src = e.touches && e.touches[0] ? e.touches[0]
              : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0]
              : e;
    return { x: (src.clientX - r.left) * (c.width / r.width), y: (src.clientY - r.top) * (c.height / r.height) };
  }
  function worldPos(e) {
    const sp = screenPos(e), cam = BW.state.camera;
    return { x: sp.x + cam.x, y: sp.y + cam.y };
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
    cam.x = Math.max(0, Math.min(cfg.world.width  - cfg.view.width,  cam.x));
    cam.y = Math.max(0, Math.min(cfg.world.height - cfg.view.height, cam.y));
  }
  BW.centerCamera = function (x, y) {
    BW.state.camera.x = x - cfg.view.width / 2;
    BW.state.camera.y = y - cfg.view.height / 2;
    clampCamera();
  };
  BW.jumpToAction = function () {
    const s = BW.state;
    const alert = [...s.alerts].reverse().find(a => a.type === 'incoming' && a.x != null);
    if (alert) return BW.centerCamera(alert.x, alert.y);
    const home = s.buildings.find(b => b.team === 'player' && cfg.BUILDING_STATS[b.kind].category === 'nest');
    if (home) BW.centerCamera(home.x, home.y);
  };

  const held = new Set();
  let pointer = null;
  function updateCamera(dtReal) {
    const s = BW.state; if (!s || s.phase === 'menu') return;
    let dx = 0, dy = 0;
    if (held.has('a') || held.has('ArrowLeft'))  dx -= 1;
    if (held.has('d') || held.has('ArrowRight')) dx += 1;
    if (held.has('w') || held.has('ArrowUp'))    dy -= 1;
    if (held.has('s') || held.has('ArrowDown'))  dy += 1;
    if (dx || dy) { s.camera.x += dx * cfg.camera.keySpeed * dtReal; s.camera.y += dy * cfg.camera.keySpeed * dtReal; }
    clampCamera();
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

  function selectWhere(pred) {
    BW.state.selected = new Set(BW.state.units.filter(u => u.team === 'player' && pred(u)).map(u => u.id));
    BW.state.selectedBuilding = null;
    const first = BW.state.selected.size === 1 ? BW.byId([...BW.state.selected][0]) : null;
    if (first) sys().refreshMoveHint(first);
    else BW.state.moveHint = null;
    if (BW.sound) BW.sound.play('select');
  }
  const gathererKind = team => cfg.FACTIONS[BW.state.faction[team]].gatherer;
  BW.select = {
    all:         () => selectWhere(() => true),
    workers:     () => selectWhere(u => u.kind === gathererKind('player')),
    army:        () => selectWhere(u => u.kind !== gathererKind('player')),
    idleWorkers: () => selectWhere(u => u.kind === gathererKind('player') && !u.acted && !u.gathering),
    ready:       () => selectWhere(u => !u.acted),
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

  let panDrag = null, minimapPan = false, tapStart = null;
  const PAN_THRESH = 10;

  function onPointerDown(e) {
    if (BW.state.phase !== 'playing') return;
    if (e.button != null && e.button === 1) {
      e.preventDefault();
      const sp = screenPos(e);
      panDrag = { sx: sp.x, sy: sp.y, camx: BW.state.camera.x, camy: BW.state.camera.y, panning: true };
      return;
    }
    if (e.button != null && e.button !== 0) return;
    const sp = screenPos(e);
    pointer = sp;
    if (inMinimap(sp)) {
      const w = miniToWorld(sp);
      BW.centerCamera(w.x, w.y);
      minimapPan = true;
      return;
    }
    tapStart = { sp, wp: worldPos(e), t: performance.now(), panning: false };
  }

  function onPointerMove(e) {
    const sp = screenPos(e);
    pointer = (sp.x >= 0 && sp.y >= 0 && sp.x <= cfg.view.width && sp.y <= cfg.view.height) ? sp : null;
    if (panDrag) {
      BW.state.camera.x = panDrag.camx - (sp.x - panDrag.sx);
      BW.state.camera.y = panDrag.camy - (sp.y - panDrag.sy);
      clampCamera();
      return;
    }
    if (minimapPan) { const w = miniToWorld(sp); BW.centerCamera(w.x, w.y); return; }
    if (!tapStart) return;
    if (BW.state.placing) { BW.state.placeXY = worldPos(e); return; }
    const dx = sp.x - tapStart.sp.x, dy = sp.y - tapStart.sp.y;
    if (!tapStart.panning && Math.hypot(dx, dy) > PAN_THRESH) {
      // Start camera pan — especially important on mobile (no middle mouse).
      tapStart.panning = true;
      panDrag = { sx: tapStart.sp.x, sy: tapStart.sp.y, camx: BW.state.camera.x, camy: BW.state.camera.y };
      tapStart = null;
      BW.state.camera.x = panDrag.camx - (sp.x - panDrag.sx);
      BW.state.camera.y = panDrag.camy - (sp.y - panDrag.sy);
      clampCamera();
    }
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

    // Single selected unit → tap issues its action.
    if (s.selected.size === 1) {
      const u = BW.byId([...s.selected][0]);
      if (u && !u.acted) {
        const enemy = enemyAt(p);
        const node = nodeAt(p);
        const tile = BW.world.toTile(p.x, p.y);
        if (enemy && (s.moveHint && s.moveHint.attacks.has(enemy.id))) {
          const r = sys().actAttack(u, enemy);
          if (!r.ok) toast(r.reason);
          else { s.selected.clear(); s.moveHint = null; }
          return;
        }
        if (node && u.kind === gathererKind('player')) {
          const r = sys().actGather(u, node);
          if (!r.ok) toast(r.reason);
          else { s.selected.clear(); s.moveHint = null; }
          return;
        }
        if (s.moveHint && s.moveHint.moves.has(sys().key(tile.gx, tile.gy))) {
          const r = sys().actMove(u, tile.gx, tile.gy);
          if (!r.ok) toast(r.reason);
          else { s.selected.clear(); s.moveHint = null; }
          return;
        }
      }
    }

    // Selection
    const u = playerUnitAt(p);
    if (u) {
      s.selected = new Set([u.id]);
      s.selectedBuilding = null;
      if (u.acted) { s.moveHint = null; toast('Already acted this turn'); }
      else sys().refreshMoveHint(u);
      if (BW.sound) BW.sound.play('select');
      return;
    }
    const b = playerProducerAt(p);
    if (b) {
      s.selectedBuilding = b.id; s.selected.clear(); s.moveHint = null;
      if (BW.sound) BW.sound.play('select');
      toast('Train from the panel · tap a resource after selecting a gatherer to set work');
      return;
    }
    s.selected.clear(); s.selectedBuilding = null; s.moveHint = null;
  }

  function onPointerUp(e) {
    if (panDrag) { panDrag = null; return; }
    if (minimapPan) { minimapPan = false; return; }
    if (!tapStart) return;
    if (tapStart.panning) { tapStart = null; return; }
    const p = worldPos(e);
    issueOrder(p);
    tapStart = null;
  }

  // Right-click still works on desktop as an alternate order gesture.
  function onContextMenu(e) {
    e.preventDefault();
    if (BW.state.phase !== 'playing' || !playerTurn()) return;
    if (BW.state.placing) { BW.state.placing = null; return; }
    issueOrder(worldPos(e));
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
    if (lk === 'f') return BW.select.ready();
    if (e.key === ' ') { e.preventDefault(); return BW.jumpToAction(); }
    if (lk === 'r') BW.restart();
    if (e.key === 'Enter' || lk === 'n') { e.preventDefault(); if (playerTurn()) BW.endTurn(); }
    if (e.key === 'Escape') {
      if (BW.state.placing) BW.state.placing = null;
      else { BW.state.selected.clear(); BW.state.selectedBuilding = null; BW.state.moveHint = null; }
    }
  }
  function onKeyUp(e) {
    const lk = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    held.delete(lk);
  }

  function attach(canvas) {
    // Pointer events cover mouse + touch.
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { held.clear(); panDrag = null; minimapPan = false; tapStart = null; });

    const panel = document.querySelector('.panel');
    if (panel) panel.addEventListener('click', e => {
      const tb = e.target.closest('.trainbtn'); if (tb) return train(tb.dataset.train);
      const bb = e.target.closest('.buildbtn'); if (bb) return build(bb.dataset.build);
    });
    document.querySelectorAll('[data-select]').forEach(b => b.addEventListener('click', () => BW.select[b.dataset.select] && BW.select[b.dataset.select]()));
    document.querySelectorAll('[data-action="restart"]').forEach(b => b.addEventListener('click', () => BW.restart()));
    const endBtn = document.getElementById('endTurnBtn');
    if (endBtn) endBtn.addEventListener('click', () => { if (playerTurn()) BW.endTurn(); else toast('Wait for your turn'); });
  }

  BW.input = { attach, updateCamera };
})();
