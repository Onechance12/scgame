/* ============================================================================
 * entities.js — The dead of the Old Hospital, and how they hunt.
 *
 * States: DORMANT · PATROL · HUNT · SEARCH
 * Each of the dead now prowls a DEN (a set of rooms it haunts), navigates with
 * real tile pathfinding (BFS), moves with its own GAIT (the Child skitters and
 * freezes, the Crawler sprints, the Nurse does slow rounds), and pulls creepy
 * IDLE behaviours when you are near but unseen. Difficulty scales speed + senses
 * via ctx.diff.
 * ==========================================================================*/

const Entities = (() => {
  const S = { DORMANT: 0, PATROL: 1, HUNT: 2, SEARCH: 3, VANISH: 4 };
  const MOVE = { ARRIVED: 0, MOVING: 1, BLOCKED: 2 };
  const DEFAULT_RADIUS = 0.16;  // tile units; 0.43 m in the WebXR runtime
  const PATH_REFRESH = 0.38;
  const PATH_RETRY = 0.85;
  const EPSILON = 1e-6;
  const DOOR_TILE = 3;
  // A late Infested survival run can multiply authored speed by 1.5. Preserve
  // each monster's threat tier without letting that stack turn a 6.2 m/s player
  // sprint into a guaranteed catch; 6.45 m/s is the five-percent panic margin.
  const WEBXR_HUNT_SPEED_CEILING = 6.45;
  // The flat shell moves in tiles/second and sprints at 6.0. Its hunt table
  // shares the same authored numbers, but must not apply the metre-to-tile
  // conversion used by the 2.7 m WebXR world.
  const FLAT_HUNT_SPEED_CEILING = 5.85;
  // HIDE tiles contain solid lockers in the runtime; the player uses them from
  // beside the mesh, so hunters must route around them instead of clipping in.
  const PASS = { 1: 1, 3: 1, 5: 1, 6: 1, 8: 1, 9: 1 };  // passable tile types
  const runtimeDoorBlocked = (grid, x, y, allowClosedDoors) => typeof window !== 'undefined' &&
    typeof window.RuntimeDoorBlocked === 'function' &&
    window.RuntimeDoorBlocked(grid, x, y, allowClosedDoors ? 'hunt-path' : 'move');
  const runtimeEntityBlocked = (grid, x, y, radius, entity) => typeof window !== 'undefined' &&
    typeof window.RuntimeEntityBlocked === 'function' &&
    window.RuntimeEntityBlocked(grid, x, y, radius, entity);
  const runtimeEntitySegmentBlocked = (grid, x0, y0, x1, y1, radius, entity) =>
    typeof window !== 'undefined' && typeof window.RuntimeEntitySegmentBlocked === 'function' &&
    window.RuntimeEntitySegmentBlocked(grid, x0, y0, x1, y1, radius, entity);

  function tilePassable(grid, x, y, allowClosedDoors) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= World.W || ty >= World.H) return false;
    const tile = grid[ty] && grid[ty][tx];
    if (!PASS[tile]) return false;
    // The runtime bridge is comparatively expensive and only a DOOR tile can
    // have a moving leaf. Ordinary floor clearance never needs to call it.
    return tile !== DOOR_TILE || !runtimeDoorBlocked(grid, tx, ty, allowClosedDoors);
  }

  // Exact circle-vs-tile clearance plus the runtime's prop AABBs. Point samples
  // leave small wedges at wall corners; closest-point distance closes those
  // wedges without making a monster's body square.
  function walkableAt(grid, x, y, options) {
    const opts = options || {};
    const radius = Math.max(0, Number.isFinite(opts.radius) ? opts.radius : DEFAULT_RADIUS);
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        x - radius < 0 || y - radius < 0 || x + radius >= World.W || y + radius >= World.H) return false;
    const minX = Math.floor(x - radius), maxX = Math.floor(x + radius);
    const minY = Math.floor(y - radius), maxY = Math.floor(y + radius);
    const radius2 = radius * radius;
    for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
      if (tilePassable(grid, tx + 0.5, ty + 0.5, !!opts.allowClosedDoors)) continue;
      if (radius <= EPSILON) return false;
      const closestX = Math.max(tx, Math.min(x, tx + 1));
      const closestY = Math.max(ty, Math.min(y, ty + 1));
      if ((x - closestX) ** 2 + (y - closestY) ** 2 < radius2 - 1e-10) return false;
    }
    return !runtimeEntityBlocked(grid, x, y, radius, opts.entity);
  }

  function segmentHitsExpandedBox(x0, y0, x1, y1, minX, minY, maxX, maxY, radius) {
    minX -= radius; minY -= radius; maxX += radius; maxY += radius;
    const dx = x1 - x0, dy = y1 - y0;
    let near = 0, far = 1;
    for (const axis of [[x0, dx, minX, maxX], [y0, dy, minY, maxY]]) {
      const p = axis[0], delta = axis[1], low = axis[2], high = axis[3];
      if (Math.abs(delta) <= EPSILON) {
        if (p < low || p > high) return false;
        continue;
      }
      let a = (low - p) / delta, b = (high - p) / delta;
      if (a > b) { const swap = a; a = b; b = swap; }
      near = Math.max(near, a); far = Math.min(far, b);
      if (near > far) return false;
    }
    return true;
  }

  // Validate the swept edge between BFS nodes, not only its endpoints. Claude's
  // denser furniture can straddle a tile boundary while leaving both centres
  // clear; accepting that edge made a monster repeatedly walk into the same bed.
  function edgeWalkable(grid, x0, y0, x1, y1, options) {
    const opts = options || {};
    const radius = Math.max(0, Number.isFinite(opts.radius) ? opts.radius : DEFAULT_RADIUS);
    const minX = Math.floor(Math.min(x0, x1) - radius);
    const maxX = Math.floor(Math.max(x0, x1) + radius);
    const minY = Math.floor(Math.min(y0, y1) - radius);
    const maxY = Math.floor(Math.max(y0, y1) + radius);
    for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
      if (tilePassable(grid, tx + 0.5, ty + 0.5, !!opts.allowClosedDoors)) continue;
      if (segmentHitsExpandedBox(x0, y0, x1, y1, tx, ty, tx + 1, ty + 1, radius)) return false;
    }
    if (typeof window !== 'undefined' && typeof window.RuntimeEntitySegmentBlocked === 'function') {
      return !runtimeEntitySegmentBlocked(grid, x0, y0, x1, y1, radius, opts.entity);
    }
    // Compatibility fallback for hosts that expose point collision only.
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(length / Math.max(0.08, radius * 0.5)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (runtimeEntityBlocked(grid, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, opts.entity)) return false;
    }
    return true;
  }

  // ---- tile BFS: shortest walkable path of tile-centres (excludes start) ----
  function findPath(grid, sx, sy, tx, ty, options) {
    const opts = options || {};
    const startX = sx, startY = sy, goalX = tx, goalY = ty;
    if (![startX, startY, goalX, goalY].every(Number.isFinite)) return null;
    const startTileX = Math.floor(startX), startTileY = Math.floor(startY);
    tx = Math.floor(goalX); ty = Math.floor(goalY);
    const goalWalkable = !!opts.nearestReachable && walkableAt(grid, goalX, goalY, opts);
    const targetCenterUsable = goalWalkable && walkableAt(grid, tx + 0.5, ty + 0.5, opts) &&
      edgeWalkable(grid, tx + 0.5, ty + 0.5, goalX, goalY, opts);
    if (startTileX === tx && startTileY === ty) {
      if (!opts.nearestReachable || (goalWalkable && edgeWalkable(grid, startX, startY, goalX, goalY, opts))) {
        return [];
      }
    }
    const W = World.W, H = World.H;
    const q = []; const from = new Map(); const seen = new Set();
    const START = '@start';
    let head = 0, guard = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let bestKey = null, bestDistance2 = Infinity;
    const maxApproach = Number.isFinite(opts.maxApproachDistance) ? opts.maxApproachDistance : 2.25;
    const buildPath = (key) => {
      const path = [];
      while (key && key !== START) {
        const p = key.split(',').map(Number);
        path.push({ x: p[0] + 0.5, y: p[1] + 0.5 });
        key = from.get(key);
      }
      return path.reverse();
    };

    // A monster may stand at a clear fractional edge of a furniture-heavy tile
    // whose centre is blocked. Seed the graph only from nearby centres it can
    // physically sweep to; never pretend it starts at the floored tile centre.
    for (let sy2 = startTileY - 1; sy2 <= startTileY + 1; sy2++) {
      for (let sx2 = startTileX - 1; sx2 <= startTileX + 1; sx2++) {
        if (sx2 < 1 || sy2 < 1 || sx2 >= W - 1 || sy2 >= H - 1) continue;
        const cx = sx2 + 0.5, cy = sy2 + 0.5, key = sx2 + ',' + sy2;
        if (!walkableAt(grid, cx, cy, opts) || !edgeWalkable(grid, startX, startY, cx, cy, opts)) continue;
        seen.add(key); from.set(key, START); q.push([sx2, sy2]);
      }
    }
    if (!q.length) return null;

    // Precompute nearby valid approach centres. Segment tests stay local to the
    // goal instead of being repeated across every node in a full-floor search.
    let approachKeys = null;
    let approachDistances = null;
    if (opts.nearestReachable) {
      const candidates = [];
      const minX = Math.max(1, Math.floor(goalX - maxApproach));
      const maxX = Math.min(W - 2, Math.floor(goalX + maxApproach));
      const minY = Math.max(1, Math.floor(goalY - maxApproach));
      const maxY = Math.min(H - 2, Math.floor(goalY + maxApproach));
      for (let ay = minY; ay <= maxY; ay++) for (let ax = minX; ax <= maxX; ax++) {
        const cx = ax + 0.5, cy = ay + 0.5;
        const distance2 = (cx - goalX) ** 2 + (cy - goalY) ** 2;
        if (distance2 > maxApproach * maxApproach || !walkableAt(grid, cx, cy, opts)) continue;
        if (goalWalkable && !edgeWalkable(grid, cx, cy, goalX, goalY, opts)) continue;
        candidates.push(ax + ',' + ay);
      }
      if (candidates.length) {
        approachKeys = new Set(candidates);
        approachDistances = new Map(candidates.map((key) => {
          const p = key.split(',').map(Number);
          return [key, (p[0] + 0.5 - goalX) ** 2 + (p[1] + 0.5 - goalY) ** 2];
        }));
      }
    }

    let bestApproachKey = null, bestApproachDistance2 = Infinity;
    while (head < q.length && guard++ < 5000) {
      const cur = q[head++]; const cx = cur[0], cy = cur[1];
      const curKey = cx + ',' + cy;
      if (cx === tx && cy === ty && (!opts.nearestReachable ||
          (goalWalkable && edgeWalkable(grid, cx + 0.5, cy + 0.5, goalX, goalY, opts)))) {
        return buildPath(curKey);
      }
      if (approachKeys && approachKeys.has(curKey)) {
        if (goalWalkable && !targetCenterUsable) return buildPath(curKey);
        if (goalWalkable) {
          // The locally clear target centre may still be graph-isolated by
          // furniture across each cardinal edge. Keep the first reachable
          // direct-close alternative while BFS continues looking for centre.
          if (!bestApproachKey) bestApproachKey = curKey;
        } else {
          const distance2 = approachDistances.get(curKey);
          // For a solid HIDE/prop endpoint, investigate the closest reachable
          // centre, not merely the first outer-ring centre reached by BFS.
          if (distance2 < bestApproachDistance2 - EPSILON) {
            bestApproachKey = curKey; bestApproachDistance2 = distance2;
          }
        }
      }
      if (opts.nearestReachable) {
        const distance2 = (cx + 0.5 - goalX) ** 2 + (cy + 0.5 - goalY) ** 2;
        if (distance2 < bestDistance2 - EPSILON) { bestKey = curKey; bestDistance2 = distance2; }
      }
      for (let i = 0; i < 4; i++) {
        const nx = cx + dirs[i][0], ny = cy + dirs[i][1], key = nx + ',' + ny;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || seen.has(key)) continue;
        if (!walkableAt(grid, nx + 0.5, ny + 0.5, opts)) continue;
        if (!edgeWalkable(grid, cx + 0.5, cy + 0.5, nx + 0.5, ny + 0.5, opts)) continue;
        seen.add(key); from.set(key, cx + ',' + cy); q.push([nx, ny]);
      }
    }
    if (bestApproachKey) return buildPath(bestApproachKey);
    if (opts.nearestReachable && bestKey && bestDistance2 <= maxApproach * maxApproach) {
      return buildPath(bestKey);
    }
    return null;
  }

  function nearestWalkable(grid, x, y, options, occupied) {
    const candidates = [];
    for (let ty = 1; ty < World.H - 1; ty++) for (let tx = 1; tx < World.W - 1; tx++) {
      const cx = tx + 0.5, cy = ty + 0.5;
      candidates.push({ x: cx, y: cy, d2: (cx - x) ** 2 + (cy - y) ** 2 });
    }
    candidates.sort((a, b) => a.d2 - b.d2 || a.y - b.y || a.x - b.x);
    return candidates.find((p) => walkableAt(grid, p.x, p.y, options) &&
      !(occupied && occupied.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.75))) || null;
  }

  class Entity {
    constructor(cfg) {
      const startX = cfg.x + 0.5, startY = cfg.y + 0.5;
      Object.assign(this, {
        name: cfg.name, kind: cfg.kind, floor: cfg.floor, homeFloor: cfg.floor,
        x: startX, y: startY, homeX: startX, homeY: startY,
        speed: cfg.speed, huntSpeed: cfg.huntSpeed, hearing: cfg.hearing, sight: cfg.sight,
        color: cfg.color, wakeHour: cfg.wakeHour, den: cfg.den || [],
        state: S.DORMANT, target: null, lastSeen: null, cooldown: 0, stepTimer: 0,
        path: null, pathTimer: 0, pathGoalKey: '', pathFailures: 0,
        gaitPhase: Math.random() * 6.28, pause: 0,
        idleTimer: 3 + Math.random() * 4, staring: false, alpha: 0, slow: 0, warded: 0,
        moving: false, fast: false, facing: 0, px: startX, py: startY,
        velocityX: 0, velocityY: 0, motionSpeed: 0, motion: 'idle',
        radius: Number.isFinite(cfg.radius) ? cfg.radius : DEFAULT_RADIUS,
        placementPending: true,
      });
    }

    awake() {
      if (this.state !== S.DORMANT) return;
      this.state = S.PATROL; this.path = null; this.pathTimer = 0; this.alpha = 0;
    }

    sleep() {
      this.floor = this.homeFloor; this.x = this.homeX; this.y = this.homeY;
      this.px = this.x; this.py = this.y;
      this.state = S.DORMANT; this.path = null; this.target = null; this.lastSeen = null;
      this.pathTimer = 0; this.pathGoalKey = ''; this.pathFailures = 0;
      this.cooldown = 0; this.pause = 0; this.slow = 0; this.warded = 0;
      this.alpha = 0; this.moving = false; this.fast = false; this.staring = false;
      this.velocityX = 0; this.velocityY = 0; this.motionSpeed = 0; this.motion = 'idle';
      this.placementPending = true;
    }

    passable(grid, x, y) {
      return walkableAt(grid, x, y, { radius: this.radius, entity: this });
    }

    ensureWalkable(grid) {
      const atHome = this.floor === this.homeFloor &&
        Math.abs(this.x - this.homeX) <= EPSILON && Math.abs(this.y - this.homeY) <= EPSILON;
      this.placementPending = false;
      if (this.passable(grid, this.x, this.y)) return true;
      const safe = nearestWalkable(grid, this.x, this.y, { radius: this.radius, entity: this });
      if (!safe) return false;
      this.x = safe.x; this.y = safe.y; this.path = null; this.pathTimer = 0;
      if (atHome) { this.homeX = safe.x; this.homeY = safe.y; }
      this.px = this.x; this.py = this.y;
      this.velocityX = 0; this.velocityY = 0; this.motionSpeed = 0;
      this.moving = false; this.fast = false; this.motion = 'idle';
      return true;
    }

    returnHome(world) {
      this.floor = this.homeFloor; this.x = this.homeX; this.y = this.homeY;
      const floor = world.floors[this.homeFloor];
      this.placementPending = true;
      if (floor) this.ensureWalkable(floor.grid);
      this.px = this.x; this.py = this.y;
      this.path = null; this.pathTimer = 0; this.pathGoalKey = ''; this.pathFailures = 0;
      this.target = null; this.lastSeen = null; this.moveBudgetLeft = 0;
      this.velocityX = 0; this.velocityY = 0; this.motionSpeed = 0;
      this.moving = false; this.fast = false; this.motion = 'idle';
    }

    pickDenWaypoint(world) {
      const rooms = world.floors[this.homeFloor].rooms.filter((r) => this.den.includes(r.tag));
      const pool = rooms.length ? rooms : world.floors[this.homeFloor].rooms;
      const r = pool[Math.floor(Math.random() * pool.length)];
      const grid = world.floors[this.homeFloor].grid;
      for (let t = 0; t < 8; t++) {
        const rx = r.x + 1 + Math.floor(Math.random() * Math.max(1, r.w - 2));
        const ry = r.y + 1 + Math.floor(Math.random() * Math.max(1, r.h - 2));
        if (this.passable(grid, rx + 0.5, ry + 0.5)) { this.target = { x: rx + 0.5, y: ry + 0.5 }; return; }
      }
      this.target = { x: r.cx + 0.5, y: r.cy + 0.5 };
    }

    // gait speed multiplier — the signature of each of the dead
    gaitMul(dt) {
      this.gaitPhase += dt;
      switch (this.kind) {
        case 'child': { const c = this.gaitPhase % 1.3; return c < 0.55 ? 1.65 : 0; }  // skitter, then freeze
        case 'crawler': return 1.12;                                                    // relentless
        case 'mose': return 0.65 + Math.abs(Math.sin(this.gaitPhase * 3.5)) * 0.5;      // lurch
        case 'ash': return 0.9;                                                          // creep
        default: return 1.0;                                                            // nurse: steady rounds
      }
    }

    // Swept segment movement keeps large frame deltas and weapon knockback from
    // teleporting across an intervening wall, door, or furniture collider.
    sweep(grid, dx, dy, slide) {
      const wanted = Math.hypot(dx, dy);
      if (wanted <= EPSILON) return { distance: 0, blocked: false };
      const startX = this.x, startY = this.y;
      const steps = Math.max(1, Math.ceil(wanted / Math.max(0.045, this.radius * 0.45)));
      const sx = dx / steps, sy = dy / steps;
      let blocked = false;
      for (let i = 0; i < steps; i++) {
        const nx = this.x + sx, ny = this.y + sy;
        if (this.passable(grid, nx, ny)) { this.x = nx; this.y = ny; continue; }
        if (slide) {
          let moved = false;
          if (Math.abs(sx) >= Math.abs(sy)) {
            if (Math.abs(sx) > EPSILON && this.passable(grid, this.x + sx, this.y)) { this.x += sx; moved = true; }
            if (Math.abs(sy) > EPSILON && this.passable(grid, this.x, this.y + sy)) { this.y += sy; moved = true; }
          } else {
            if (Math.abs(sy) > EPSILON && this.passable(grid, this.x, this.y + sy)) { this.y += sy; moved = true; }
            if (Math.abs(sx) > EPSILON && this.passable(grid, this.x + sx, this.y)) { this.x += sx; moved = true; }
          }
          if (moved) continue;
        }
        blocked = true; break;
      }
      const ax = this.x - startX, ay = this.y - startY;
      const distance = Math.hypot(ax, ay);
      if (distance > EPSILON) this.facing = Math.atan2(ay, ax);
      return { distance, blocked: blocked || distance + 1e-5 < wanted };
    }

    // Consume the entire frame's movement budget, including across multiple
    // reached nodes. Reaching a waypoint never manufactures an idle frame.
    followPath(grid, dist) {
      this.moveBudgetLeft = Math.max(0, dist);
      if (!Array.isArray(this.path)) return MOVE.BLOCKED;
      if (!this.path.length) return MOVE.ARRIVED;
      let budget = this.moveBudgetLeft;
      while (this.path.length) {
        const n = this.path[0];
        const dx = n.x - this.x, dy = n.y - this.y, len = Math.hypot(dx, dy);
        if (len <= 1e-5) { this.x = n.x; this.y = n.y; this.path.shift(); continue; }
        if (budget <= EPSILON) { this.moveBudgetLeft = 0; return MOVE.MOVING; }
        const step = Math.min(budget, len);
        const moved = this.sweep(grid, (dx / len) * step, (dy / len) * step, false);
        budget -= moved.distance;
        this.moveBudgetLeft = Math.max(0, budget);
        if (moved.blocked) return MOVE.BLOCKED;
        if (step + 1e-5 >= len) { this.x = n.x; this.y = n.y; this.path.shift(); continue; }
        return MOVE.MOVING;
      }
      return MOVE.ARRIVED;
    }

    requestPath(grid, goal, allowClosedDoors, nearestReachable) {
      if (!goal) { this.path = null; this.pathTimer = PATH_RETRY; return null; }
      this.pathGoalKey = Math.floor(goal.x) + ',' + Math.floor(goal.y);
      this.path = findPath(grid, this.x, this.y, goal.x, goal.y, {
        radius: this.radius, entity: this, allowClosedDoors: !!allowClosedDoors,
        nearestReachable: !!nearestReachable,
      });
      if (this.path === null) { this.pathFailures++; this.pathTimer = PATH_RETRY; }
      else { this.pathFailures = 0; this.pathTimer = PATH_REFRESH; }
      return this.path;
    }

    commitMotion(dt) {
      const dx = this.x - this.px, dy = this.y - this.py;
      const moved = Math.hypot(dx, dy);
      this.velocityX = dt > EPSILON ? dx / dt : 0;
      this.velocityY = dt > EPSILON ? dy / dt : 0;
      this.motionSpeed = dt > EPSILON ? moved / dt : 0;
      // Use speed, not per-frame displacement, so slow movement animates the
      // same way at 72, 90, and 120 Hz.
      this.moving = this.motionSpeed > 0.02;
      if (this.moving) this.facing = Math.atan2(dy, dx);
      this.fast = this.moving && this.state === S.HUNT;
      this.motion = !this.moving ? 'idle' : (this.warded > 0 ? 'recoil' : (this.fast ? 'run' : 'walk'));
    }

    update(dt, world, player, ctx) {
      ctx = ctx || {};
      this.px = this.x; this.py = this.y;
      if (this.state === S.DORMANT) {
        this.alpha = 0; this.moving = false; this.fast = false; this.staring = false;
        this.velocityX = 0; this.velocityY = 0; this.motionSpeed = 0; this.motion = 'idle';
        if (!ctx.peace && ctx.hour >= this.wakeHour) this.awake();
        else return;
      }
      if (this.state === S.VANISH) {
        this.alpha = Math.max(0, this.alpha - dt * 1.5);
        this.moving = false; this.fast = false; this.staring = false; this.motion = 'idle';
        return;
      }
      this.alpha = Math.min(1, this.alpha + dt * 0.6);
      const diff = ctx.diff || { speedMul: 1, senseMul: 1 };
      if (!world.floors[this.floor]) this.returnHome(world);
      const grid = world.floors[this.floor].grid;
      if (this.placementPending) this.ensureWalkable(grid);
      const onSameFloor = player.floor === this.floor;
      this.warded = Math.max(0, (this.warded || 0) - dt);
      const hasWorldScale = Number.isFinite(ctx.tileMetres) && ctx.tileMetres > 0;
      const speedTileMetres = hasWorldScale ? ctx.tileMetres : 0.7;
      const rangeTileMetres = hasWorldScale ? ctx.tileMetres : 2.0;
      const motionScale = Math.max(0, Number.isFinite(ctx.motionScale) ? ctx.motionScale : 1);
      // flat.html has no metre scale. These fallbacks preserve its historical
      // tile-speed and perception envelope while WebXR uses the real 2.7 m map.
      const speedToTiles = (metres) => metres / speedTileMetres;
      const rangeToTiles = (metres) => metres / rangeTileMetres;
      const huntSpeed = Math.min(
        hasWorldScale ? WEBXR_HUNT_SPEED_CEILING : FLAT_HUNT_SPEED_CEILING,
        Math.max(0, this.huntSpeed) * Math.max(0, Number.isFinite(diff.speedMul) ? diff.speedMul : 1),
      );
      const huntTilesPerSecond = hasWorldScale ? speedToTiles(huntSpeed) : huntSpeed;

      // ---- WARDED: the raised cross drives the dead back. It flees, cannot catch. ----
      if (this.warded > 0 && onSameFloor) {
        this.state = S.HUNT;   // stays active/visible, but recoiling
        const ax = this.x - player.x, ay = this.y - player.y, len = Math.hypot(ax, ay) || 1;
        const flee = huntTilesPerSecond * motionScale * 1.15 * dt;
        this.moveDirect(grid, this.x + (ax / len) * 6, this.y + (ay / len) * 6, flee);
        this.lastSeen = null; this.path = null;
        this.commitMotion(dt);
        return;
      }

      // ---- detection ----
      let detected = false;
      if (onSameFloor && !ctx.peace && !player.hidden) {
        const dx = player.x - this.x, dy = player.y - this.y, d = Math.hypot(dx, dy);
        const sense = diff.senseMul;
        let visibility;
        const visible = () => {
          if (visibility === undefined) visibility = lineOfSight(
            grid, this.x, this.y, player.x, player.y, { allowEndHide: true });
          return visibility;
        };
        if (ctx.noise > 0 && d <= rangeToTiles(this.hearing) * sense * (0.5 + ctx.noise)) detected = true;
        if (!detected && ctx.beamHits && ctx.beamHits(this.x, this.y) && visible()) detected = true;
        if (!detected && d <= rangeToTiles(this.sight) * sense && visible()) detected = true;
        if (!detected && d < rangeToTiles(1.35) && !ctx.playerLit && visible()) detected = true;
        if (!detected && this.staring && d < rangeToTiles(this.sight) * sense * 1.2 && ctx.playerLit && visible()) detected = true;
      }
      if (detected) {
        if (this.state !== S.HUNT) { Audio2.dread(); this.pathTimer = 0; }
        this.state = S.HUNT; this.staring = false; this.pause = 0;
        this.lastSeen = { x: player.x, y: player.y }; this.cooldown = 4;
      }

      // ---- behaviour ----
      if (this.state === S.HUNT) {
        if (!onSameFloor) { this.state = S.SEARCH; this.cooldown = 4; this.path = null; }
        else {
          this.pathTimer -= dt;
          const goal = detected ? player : (this.lastSeen || (!player.hidden ? player : null));
          const goalKey = goal ? Math.floor(goal.x) + ',' + Math.floor(goal.y) : '';
          if (goal && (goalKey !== this.pathGoalKey || (this.path === null && this.pathTimer <= 0))) {
            this.requestPath(grid, goal, true, true);
          }
          if (this.slow > 0) this.slow -= dt;   // the flashlight beam staggers a hunter
          const spd = huntTilesPerSecond * motionScale * (this.slow > 0 ? 0.42 : 1) * dt;
          const moveState = goal ? this.followPath(grid, spd) : MOVE.BLOCKED;
          // BFS targets tile centres. Once both actors occupy the same open tile,
          // close the remaining fractional gap without granting a second step.
          if (moveState === MOVE.ARRIVED && goal && !player.hidden) {
            const directState = this.moveDirect(grid, goal.x, goal.y, Math.max(0, this.moveBudgetLeft || 0));
            if (directState === MOVE.BLOCKED) { this.path = null; this.pathTimer = PATH_RETRY; }
          }
          const catchRadius = rangeToTiles(ctx.catchDistanceMetres || 0.95);
          if (Math.hypot(player.x - this.x, player.y - this.y) < catchRadius && !player.hidden && !ctx.peace &&
              lineOfSight(grid, this.x, this.y, player.x, player.y, { allowEndHide: true }) &&
              ctx.onCatch) ctx.onCatch(this);
          this.cooldown -= dt;
          if (!detected && this.cooldown <= 0) { this.state = S.SEARCH; this.cooldown = 5; this.path = null; }
        }
      } else if (this.state === S.SEARCH) {
        const goal = this.lastSeen || this.target;
        if (goal) {
          this.pathTimer -= dt;
          const goalKey = Math.floor(goal.x) + ',' + Math.floor(goal.y);
          const alreadyAtGoal = goalKey === this.pathGoalKey && Array.isArray(this.path) && this.path.length === 0;
          if (!alreadyAtGoal && (goalKey !== this.pathGoalKey || (this.path === null && this.pathTimer <= 0))) {
            this.requestPath(grid, goal, false, true);
          }
          if (!alreadyAtGoal) {
            const moveState = this.followPath(grid, speedToTiles(this.speed) * diff.speedMul * motionScale * dt);
            if (moveState === MOVE.BLOCKED && Array.isArray(this.path)) {
              this.path = null; this.pathTimer = PATH_RETRY;
            }
          }
          this.cooldown -= dt;
          if (this.cooldown <= 0) {
            this.state = S.PATROL; this.path = null; this.lastSeen = null;
            if (this.floor !== this.homeFloor) this.returnHome(world);
          }
        } else { this.state = S.PATROL; }
      } else if (this.state === S.PATROL) {
        // idle creepiness: pause, stare toward the player, breathe
        if (this.pause > 0) {
          this.pause -= dt;
          if (this.staring && onSameFloor) this.facing = Math.atan2(player.y - this.y, player.x - this.x);
          if (this.staring && Math.random() < dt * 0.6) Audio2.whisper(0.4);
          if (this.pause <= 0) this.staring = false;
        } else {
          this.pathTimer -= dt;
          if (!this.target) this.pickDenWaypoint(world);
          const targetKey = this.target ? Math.floor(this.target.x) + ',' + Math.floor(this.target.y) : '';
          if (this.target && (targetKey !== this.pathGoalKey || (this.path === null && this.pathTimer <= 0))) {
            this.requestPath(grid, this.target, false, false);
          }
          const mul = this.gaitMul(dt * motionScale);
          const moveState = this.followPath(grid, speedToTiles(this.speed) * diff.speedMul * motionScale * mul * dt);
          if (moveState === MOVE.BLOCKED && Array.isArray(this.path)) {
            this.path = null; this.pathTimer = PATH_RETRY; this.pathFailures++;
          }
          if (moveState === MOVE.ARRIVED || (moveState === MOVE.BLOCKED && this.path === null && this.pathFailures >= 2)) {
            this.path = null; this.target = null;
            this.pathTimer = 0; this.pathGoalKey = ''; this.pathFailures = 0;
            this.idleTimer -= 1;
            // reach a waypoint: sometimes stop and watch (or the Nurse checks a "bed")
            const stareChance = (this.kind === 'nurse' || this.kind === 'nurse2') ? 0.6 : this.kind === 'child' ? 0.5 : 0.3;
            if (Math.random() < stareChance) {
              this.pause = 1.2 + Math.random() * 2.2;
              this.staring = onSameFloor && Math.random() < 0.7;
              if (onSameFloor && this.kind === 'child' && Math.random() < 0.5) Audio2.laugh();
            }
          }
        }
      }

      this.commitMotion(dt);
    }

    // Greedy movement for recoil and same-tile closing. It clamps to the target,
    // sweeps the whole segment, and reports why it stopped.
    moveDirect(grid, tx, ty, dist) {
      const dx = tx - this.x, dy = ty - this.y, len = Math.hypot(dx, dy);
      if (len <= EPSILON) return MOVE.ARRIVED;
      const step = Math.min(Math.max(0, dist), len);
      const moved = this.sweep(grid, (dx / len) * step, (dy / len) * step, true);
      if (moved.blocked) return MOVE.BLOCKED;
      return step + 1e-5 >= len ? MOVE.ARRIVED : MOVE.MOVING;
    }
  }

  function cellBlocksSight(grid, x, y, allowHide) {
    const t = grid[y] && grid[y][x];
    return t === undefined || t === 2 || t === 0 || t === 4 || (t === 7 && !allowHide) ||
      (t === DOOR_TILE && runtimeDoorBlocked(grid, x, y, false));
  }

  // Continuous supercover DDA: visits every grid cell touched by the ray,
  // including both side cells at exact corner crossings.
  function lineOfSight(grid, x0, y0, x1, y1, options) {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return false;
    let x = Math.floor(x0), y = Math.floor(y0);
    const startX = x, startY = y;
    const tx = Math.floor(x1), ty = Math.floor(y1);
    const allowBoth = !!(options && options.allowEndpointHide);
    const allowStartHide = allowBoth || !!(options && options.allowStartHide);
    const allowEndHide = allowBoth || !!(options && options.allowEndHide);
    const blocks = (cx, cy) => cellBlocksSight(grid, cx, cy,
      (allowStartHide && cx === startX && cy === startY) ||
      (allowEndHide && cx === tx && cy === ty));
    const propClear = () => !runtimeEntitySegmentBlocked(grid, x0, y0, x1, y1, 0.001, null);
    if (blocks(x, y)) return false;
    if (x === tx && y === ty) return propClear();
    const dx = x1 - x0, dy = y1 - y0;
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tDeltaX = sx ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = sy ? Math.abs(1 / dy) : Infinity;
    let tMaxX = sx > 0 ? (x + 1 - x0) / dx : sx < 0 ? (x0 - x) / -dx : Infinity;
    let tMaxY = sy > 0 ? (y + 1 - y0) / dy : sy < 0 ? (y0 - y) / -dy : Infinity;
    let guard = 0;
    while ((x !== tx || y !== ty) && guard++ < World.W * World.H * 2) {
      if (Math.abs(tMaxX - tMaxY) < 1e-10) {
        const nx = x + sx, ny = y + sy;
        if (blocks(nx, y) || blocks(x, ny)) return false;
        x = nx; y = ny; tMaxX += tDeltaX; tMaxY += tDeltaY;
      } else if (tMaxX < tMaxY) {
        x += sx; tMaxX += tDeltaX;
      } else {
        y += sy; tMaxY += tDeltaY;
      }
      if (blocks(x, y)) return false;
    }
    return x === tx && y === ty && propClear();
  }

  function isActive(entity) {
    return !!entity && entity.state !== S.DORMANT && entity.state !== S.VANISH;
  }

  // Resolve only true body overlaps. Navigation still permits two hunters to
  // share a corridor, but they no longer occupy the exact same point/model.
  function resolveOverlaps(list, world, dt) {
    const active = list.filter((e) => isActive(e) && world.floors[e.floor]);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        if (a.floor !== b.floor) continue;
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const minD = a.radius + b.radius + 0.04;
        if (d >= minD) continue;
        let nx, ny;
        if (d < EPSILON) { nx = ((i + j) & 1) ? 1 : 0; ny = nx ? 0 : 1; d = 0; }
        else { nx = dx / d; ny = dy / d; }
        // Ease corrections over a handful of frames instead of visibly popping
        // two coincident models almost a metre apart in one render.
        const push = Math.min((minD - d) * 0.5, Math.max(0, dt) * 0.55);
        const grid = world.floors[a.floor].grid;
        a.sweep(grid, -nx * push, -ny * push, false);
        b.sweep(grid, nx * push, ny * push, false);
      }
    }
    active.forEach((e) => e.commitMotion(dt));
  }

  // ---- the cast, each with a den (its haunt) and a home floor ----
  function spawnAll(world, opts) {
    opts = opts || {};
    const R = (fi, tag) => { const r = world.floors[fi].rooms.find((rr) => rr.tag === tag); return r ? { x: r.cx, y: r.cy } : { x: World.W / 2, y: 15 }; };
    const list = [];
    const add = (cfg) => {
      const entity = new Entity(cfg);
      const occupied = list.filter((other) => other.floor === entity.floor);
      if (occupied.some((other) => Math.hypot(other.x - entity.x, other.y - entity.y) < 0.75)) {
        const grid = world.floors[entity.floor].grid;
        const safe = nearestWalkable(grid, entity.x, entity.y, { radius: entity.radius }, occupied);
        if (safe) { entity.x = entity.homeX = safe.x; entity.y = entity.homeY = safe.y; entity.px = safe.x; entity.py = safe.y; }
      }
      list.push(entity);
    };
    let p;
    // Speeds and senses are authored in metres/second and metres. The WebXR
    // runtime supplies TILE_M; the 2D shell omits it and continues in tile units.
    p = R(1, 'er');    add({ name: 'The Grey Nurse', kind: 'nurse', floor: 1, x: p.x, y: p.y, speed: 1.05, huntSpeed: 4.7, hearing: 13, sight: 17, wakeHour: 1, den: ['er', 'waiting', 'admitting', 'pharmacy'] });
    p = R(3, 'mose');  add({ name: 'Mose Blackburn', kind: 'mose', floor: 3, x: p.x, y: p.y, speed: 1.15, huntSpeed: 5.0, hearing: 15, sight: 18, wakeHour: 3, den: ['mose', 'recovery', 'surgery', 'iso', 'landing', 'ward'] });
    p = R(2, 'maternity'); add({ name: 'The Child', kind: 'child', floor: 2, x: p.x, y: p.y, speed: 1.0, huntSpeed: 4.4, hearing: 16, sight: 13, wakeHour: 6, den: ['maternity', 'ward', 'room207', 'station'] });
    p = R(0, 'incinerator'); add({ name: 'The Ash', kind: 'ash', floor: 0, x: p.x, y: p.y, speed: 0.82, huntSpeed: 4.0, hearing: 19, sight: 17, wakeHour: 12, den: ['incinerator', 'boiler', 'ritual', 'laundry', 'morgue'] });
    p = R(1, 'kitchen'); add({ name: 'The Crawler', kind: 'crawler', floor: 1, x: p.x, y: p.y, speed: 1.25, huntSpeed: 5.6, hearing: 16, sight: 15, wakeHour: 4, den: ['kitchen', 'cafeteria', 'pharmacy', 'records'] });
    p = R(2, 'ward');  add({ name: 'Night Nurse', kind: 'nurse2', floor: 2, x: p.x, y: p.y, speed: 1.08, huntSpeed: 4.8, hearing: 13, sight: 17, wakeHour: 2, den: ['ward', 'station', 'room207', 'maternity', 'bath'] });
    p = R(0, 'morgue'); add({ name: 'The Ghoul', kind: 'ghoul', floor: 0, x: p.x, y: p.y, speed: 1.12, huntSpeed: 5.0, hearing: 16, sight: 16, wakeHour: 7, den: ['morgue', 'storage', 'laundry', 'incinerator'] });
    p = R(4, 'quarters'); add({ name: 'The Risen', kind: 'undead', floor: 4, x: p.x, y: p.y, speed: 1.08, huntSpeed: 4.6, hearing: 15, sight: 17, wakeHour: 5, den: ['quarters', 'matron', 'attic', 'chapel', 'bell'] });
    // Deep-night escalation — the hospital itself starts dreaming. They arrive LATE,
    // sense a little less and chase a little slower than the core cast, so ten dead
    // never gang up into an unwinnable night — they are dread, not a death squad.
    p = R(3, 'surgery'); add({ name: 'The Nightmare', kind: 'nightmare', floor: 3, x: p.x, y: p.y, speed: 0.98, huntSpeed: 4.5, hearing: 15, sight: 17, wakeHour: 9, den: ['surgery', 'xray', 'iso', 'recovery'] });
    p = R(4, 'chapel');  add({ name: 'The Wraith', kind: 'wraith', floor: 4, x: p.x, y: p.y, speed: 0.9, huntSpeed: 4.2, hearing: 16, sight: 17, wakeHour: 11, den: ['chapel', 'attic', 'bell', 'matron'] });
    // Infested: a second Crawler stalks the upper wards
    if (opts.extra) { p = R(2, 'station'); add({ name: 'The Other', kind: 'crawler', floor: 2, x: p.x, y: p.y, speed: 1.3, huntSpeed: 5.6, hearing: 17, sight: 16, wakeHour: 5, den: ['ward', 'maternity', 'station'] }); }
    return list;
  }

  return { Entity, spawnAll, lineOfSight, findPath, resolveOverlaps, isActive, walkableAt, S, MOVE };
})();
if (typeof window !== 'undefined') window.Entities = Entities;
