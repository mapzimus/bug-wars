/* ============================================================================
   Bug Wars — pathfinding.js   (v5, new)
   ----------------------------------------------------------------------------
   Grid A* over the world, so units ROUTE AROUND walls and rocks instead of
   grinding into them. v4 had steering only: a unit walking at a wall would
   press against it forever, which read as "my army is broken".

   How it fits the existing split:
     · This file owns a navigation GRID derived from state.obstacles + walls.
     · systems.js asks for a path, then steers along the returned waypoints —
       the local separation/avoidance code still runs, it just has a sensible
       direction to push in now.
     · Nothing here mutates BW.state except the unit path fields systems sets.

   The grid is rebuilt only when the blocking set changes (a wall is built or
   destroyed), not per frame — see BW.path.markDirty().
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  const cfg = BW.config;
  const P = cfg.pathfinding;

  let cols = 0, rows = 0, cell = P.cell;
  let blocked = null;          // Uint8Array, 1 = impassable
  let dirty = true;
  let budget = 0;              // A* searches remaining this tick

  /* ---- grid construction ------------------------------------------------
     A cell is blocked if its CENTRE is within (obstacle radius + clearance) of
     a rock or a blocking wall. Clearance is roughly a unit radius so paths
     don't hug geometry the collision code will shove them out of. */
  const CLEARANCE = 9;

  function idx(cx, cy) { return cy * cols + cx; }
  const inGrid = (cx, cy) => cx >= 0 && cy >= 0 && cx < cols && cy < rows;
  const cellOfX = x => Math.max(0, Math.min(cols - 1, Math.floor(x / cell)));
  const cellOfY = y => Math.max(0, Math.min(rows - 1, Math.floor(y / cell)));
  const centreX = cx => cx * cell + cell / 2;
  const centreY = cy => cy * cell + cell / 2;

  function rebuild() {
    cell = P.cell;
    cols = Math.ceil(cfg.world.width / cell);
    rows = Math.ceil(cfg.world.height / cell);
    blocked = new Uint8Array(cols * rows);
    const s = BW.state;
    if (!s) { dirty = false; return; }

    const stamp = (ox, oy, orr) => {
      const rad = orr + CLEARANCE;
      const x0 = cellOfX(ox - rad), x1 = cellOfX(ox + rad);
      const y0 = cellOfY(oy - rad), y1 = cellOfY(oy + rad);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const dx = centreX(cx) - ox, dy = centreY(cy) - oy;
        if (dx * dx + dy * dy <= rad * rad) blocked[idx(cx, cy)] = 1;
      }
    };
    for (const o of s.obstacles) stamp(o.x, o.y, o.r);
    for (const b of s.buildings) {
      const bs = cfg.BUILDING_STATS[b.kind];
      if (bs && bs.blocks) stamp(b.x, b.y, bs.radius);
    }
    dirty = false;
  }
  function ensure() { if (dirty || !blocked) rebuild(); }

  function isBlockedCell(cx, cy) { return !inGrid(cx, cy) || blocked[idx(cx, cy)] === 1; }
  function isBlockedWorld(x, y) { ensure(); return isBlockedCell(cellOfX(x), cellOfY(y)); }

  /* ---- line of sight (used to smooth paths) -----------------------------
     Sample along the segment at half-cell steps. Cheap and good enough: the
     grid is already inflated by CLEARANCE, so a clear sample line is walkable. */
  function clearLine(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    const steps = Math.ceil(d / (cell * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isBlockedCell(cellOfX(x0 + dx * t), cellOfY(y0 + dy * t))) return false;
    }
    return true;
  }

  /* ---- nearest walkable cell (start/goal may sit inside geometry) -------- */
  function nearestFree(cx, cy) {
    if (!isBlockedCell(cx, cy)) return [cx, cy];
    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring only
        const nx = cx + dx, ny = cy + dy;
        if (!isBlockedCell(nx, ny)) return [nx, ny];
      }
    }
    return null;
  }

  /* ---- A* ---------------------------------------------------------------
     8-way movement, octile heuristic, binary-heap open list. Returns an array
     of {x,y} world waypoints (already smoothed), or null if unreachable /
     the search blew its node budget. */
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
                [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

  function heuristic(ax, ay, bx, by) {         // octile
    const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }

  // Minimal binary heap keyed on f-score.
  function Heap() { this.a = []; }
  Heap.prototype.push = function (node) {
    const a = this.a; a.push(node);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; const t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
  };
  Heap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  function search(sx, sy, tx, ty) {
    ensure();
    let s = nearestFree(cellOfX(sx), cellOfY(sy));
    let g = nearestFree(cellOfX(tx), cellOfY(ty));
    if (!s || !g) return null;
    const [scx, scy] = s, [gcx, gcy] = g;
    if (scx === gcx && scy === gcy) return [{ x: tx, y: ty }];

    const n = cols * rows;
    const gScore = new Float32Array(n).fill(Infinity);
    const cameFrom = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const startI = idx(scx, scy), goalI = idx(gcx, gcy);
    gScore[startI] = 0;

    const open = new Heap();
    open.push({ i: startI, cx: scx, cy: scy, f: heuristic(scx, scy, gcx, gcy) });
    let expansions = 0;

    while (open.a.length) {
      const cur = open.pop();
      if (closed[cur.i]) continue;
      closed[cur.i] = 1;
      if (cur.i === goalI) return reconstruct(cameFrom, goalI, sx, sy, tx, ty);
      if (++expansions > P.maxNodes) return null;

      for (const [dx, dy, w] of DIRS) {
        const nx = cur.cx + dx, ny = cur.cy + dy;
        if (isBlockedCell(nx, ny)) continue;
        // no corner-cutting: a diagonal needs both orthogonal neighbours open
        if (dx && dy && (isBlockedCell(cur.cx + dx, cur.cy) || isBlockedCell(cur.cx, cur.cy + dy))) continue;
        const ni = idx(nx, ny);
        if (closed[ni]) continue;
        const tentative = gScore[cur.i] + w;
        if (tentative < gScore[ni]) {
          gScore[ni] = tentative;
          cameFrom[ni] = cur.i;
          open.push({ i: ni, cx: nx, cy: ny, f: tentative + heuristic(nx, ny, gcx, gcy) });
        }
      }
    }
    return null;
  }

  // Walk cameFrom back to the start, then SMOOTH: repeatedly skip waypoints we
  // have clear line of sight past. Turns a staircase of cells into 2-3 legs.
  function reconstruct(cameFrom, goalI, sx, sy, tx, ty) {
    const cells = [];
    for (let i = goalI; i !== -1; i = cameFrom[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map(i => ({ x: centreX(i % cols), y: centreY((i / cols) | 0) }));
    pts[pts.length - 1] = { x: tx, y: ty };          // finish at the real target

    const out = [];
    let cx = sx, cy = sy, k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) {
        if (clearLine(cx, cy, pts[j].x, pts[j].y)) { far = j; break; }
      }
      out.push(pts[far]);
      cx = pts[far].x; cy = pts[far].y;
      k = far + 1;
    }
    return out;
  }

  /* ---- public API -------------------------------------------------------
     find() is budgeted: systems.js calls it a lot, and we would rather a few
     units keep their stale path for a tick than drop a frame. Returns null
     when the budget is spent — the caller falls back to direct steering. */
  function find(sx, sy, tx, ty) {
    if (budget <= 0) return null;
    // Already a straight shot? Skip the search entirely — the common case.
    ensure();
    if (clearLine(sx, sy, tx, ty)) return [{ x: tx, y: ty }];
    budget--;
    return search(sx, sy, tx, ty);
  }

  BW.path = {
    find,
    isBlockedWorld,
    clearLine,
    markDirty() { dirty = true; },
    rebuild,
    beginTick() { budget = P.budgetPerTick; },
    // exposed for headless tests / debugging
    _grid: () => ({ cols, rows, cell, blocked }),
  };
})();
