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
  const PASS = { 1: 1, 3: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1 };  // passable tile types

  // ---- tile BFS: shortest walkable path of tile-centres (excludes start) ----
  function findPath(grid, sx, sy, tx, ty) {
    sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
    if (sx === tx && sy === ty) return [];
    const W = World.W, H = World.H;
    const q = [[sx, sy]]; const from = new Map(); const seen = new Set([sx + ',' + sy]);
    let head = 0, guard = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (head < q.length && guard++ < 5000) {
      const cur = q[head++]; const cx = cur[0], cy = cur[1];
      if (cx === tx && cy === ty) {
        const path = []; let k = cx + ',' + cy;
        while (k !== sx + ',' + sy) { const p = k.split(',').map(Number); path.push({ x: p[0] + 0.5, y: p[1] + 0.5 }); k = from.get(k); }
        return path.reverse();
      }
      for (let i = 0; i < 4; i++) {
        const nx = cx + dirs[i][0], ny = cy + dirs[i][1], key = nx + ',' + ny;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || seen.has(key)) continue;
        if (!PASS[grid[ny][nx]]) continue;
        seen.add(key); from.set(key, cx + ',' + cy); q.push([nx, ny]);
      }
    }
    return null;
  }

  class Entity {
    constructor(cfg) {
      Object.assign(this, {
        name: cfg.name, kind: cfg.kind, floor: cfg.floor, homeFloor: cfg.floor,
        x: cfg.x + 0.5, y: cfg.y + 0.5,
        speed: cfg.speed, huntSpeed: cfg.huntSpeed, hearing: cfg.hearing, sight: cfg.sight,
        color: cfg.color, wakeHour: cfg.wakeHour, den: cfg.den || [],
        state: S.DORMANT, target: null, lastSeen: null, cooldown: 0, stepTimer: 0,
        path: null, pathTimer: 0, gaitPhase: Math.random() * 6.28, pause: 0,
        idleTimer: 3 + Math.random() * 4, staring: false, alpha: 0, slow: 0, warded: 0,
        moving: false, fast: false, facing: 0, px: cfg.x + 0.5, py: cfg.y + 0.5,
      });
    }

    awake() { if (this.state === S.DORMANT) { this.state = S.PATROL; this.path = null; } }

    passable(grid, x, y) {
      if (x < 0 || y < 0 || x >= World.W || y >= World.H) return false;
      return !!PASS[grid[Math.floor(y)][Math.floor(x)]];
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
        case 'child': { const c = this.gaitPhase % 1.3; return c < 0.55 ? 2.0 : 0; }   // skitter, then freeze
        case 'crawler': return 1.35;                                                    // relentless
        case 'mose': return 0.55 + Math.abs(Math.sin(this.gaitPhase * 3.5)) * 0.95;     // lurch
        case 'ash': return 0.9;                                                          // creep
        default: return 1.0;                                                            // nurse: steady rounds
      }
    }

    // move one step along this.path; returns true while a path remains
    followPath(grid, dist) {
      if (!this.path || !this.path.length) return false;
      const n = this.path[0];
      const dx = n.x - this.x, dy = n.y - this.y, len = Math.hypot(dx, dy) || 1;
      if (len < 0.18) { this.path.shift(); return this.path.length > 0; }
      const step = Math.min(dist, len);
      const nx = this.x + (dx / len) * step, ny = this.y + (dy / len) * step;
      if (this.passable(grid, nx, ny)) { this.x = nx; this.y = ny; }
      else { this.path = null; return false; }
      this.facing = Math.atan2(dy, dx);
      return true;
    }

    update(dt, world, player, ctx) {
      if (this.state === S.DORMANT) {
        if (ctx.hour >= this.wakeHour) this.awake();
        else return;
      }
      this.alpha = Math.min(1, this.alpha + dt * 0.6);
      const diff = ctx.diff || { speedMul: 1, senseMul: 1 };
      const grid = world.floors[this.floor].grid;
      const onSameFloor = player.floor === this.floor;
      this.px = this.x; this.py = this.y;
      this.warded = Math.max(0, (this.warded || 0) - dt);

      // ---- WARDED: the raised cross drives the dead back. It flees, cannot catch. ----
      if (this.warded > 0 && onSameFloor) {
        this.state = S.HUNT;   // stays active/visible, but recoiling
        const ax = this.x - player.x, ay = this.y - player.y, len = Math.hypot(ax, ay) || 1;
        const flee = this.huntSpeed * diff.speedMul * 1.15 * dt;
        this.moveDirect(grid, this.x + (ax / len) * 6, this.y + (ay / len) * 6, flee);
        this.facing = Math.atan2(-ay, -ax);
        const moved = Math.hypot(this.x - this.px, this.y - this.py);
        this.moving = moved > 0.002; this.fast = true;
        this.lastSeen = null; this.path = null;
        return;
      }

      // ---- detection ----
      let detected = false;
      if (onSameFloor && !ctx.peace) {
        const dx = player.x - this.x, dy = player.y - this.y, d = Math.hypot(dx, dy);
        const sense = diff.senseMul;
        if (ctx.noise > 0 && d <= this.hearing * sense * (0.5 + ctx.noise)) detected = true;
        if (ctx.beamHits && ctx.beamHits(this.x, this.y)) detected = true;
        if (d <= this.sight * sense && lineOfSight(grid, this.x, this.y, player.x, player.y)) {
          if (!(player.hidden && !ctx.playerLit)) detected = true;
        }
        if (d < 2.2 && !ctx.playerLit) detected = true;
        if (this.staring && d < this.sight * sense * 1.2 && ctx.playerLit) detected = true; // it was already watching
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
          if (this.pathTimer <= 0 || !this.path) {
            this.pathTimer = 0.4;
            this.path = findPath(grid, this.x, this.y, player.x, player.y);
          }
          if (this.slow > 0) this.slow -= dt;   // the flashlight beam staggers a hunter
          const spd = this.huntSpeed * diff.speedMul * (this.slow > 0 ? 0.42 : 1) * dt;
          if (!this.followPath(grid, spd)) this.moveDirect(grid, player.x, player.y, spd);
          this.lastSeen = { x: player.x, y: player.y };
          if (Math.hypot(player.x - this.x, player.y - this.y) < 0.8 && !player.hidden && !ctx.peace) ctx.onCatch(this);
          this.cooldown -= dt;
          if (!detected && this.cooldown <= 0) { this.state = S.SEARCH; this.cooldown = 5; this.path = null; }
        }
      } else if (this.state === S.SEARCH) {
        const goal = this.lastSeen || this.target;
        if (goal) {
          if (!this.path) this.path = findPath(grid, this.x, this.y, goal.x, goal.y);
          if (!this.followPath(grid, this.speed * diff.speedMul * dt)) {
            this.cooldown -= dt;
            if (this.cooldown <= 0 || this.floor !== this.homeFloor) { this.state = S.PATROL; this.path = null; this.floor = this.homeFloor; }
          }
        } else { this.state = S.PATROL; }
        this.cooldown -= dt * 0.5;
      } else if (this.state === S.PATROL) {
        // idle creepiness: pause, stare toward the player, breathe
        if (this.pause > 0) {
          this.pause -= dt;
          if (this.staring && onSameFloor) this.facing = Math.atan2(player.y - this.y, player.x - this.x);
          if (this.staring && Math.random() < dt * 0.6) Audio2.whisper(0.4);
          if (this.pause <= 0) this.staring = false;
        } else {
          if (!this.target || !this.path) { this.pickDenWaypoint(world); this.path = findPath(grid, this.x, this.y, this.target.x, this.target.y); }
          const mul = this.gaitMul(dt);
          const arrived = !this.followPath(grid, this.speed * diff.speedMul * mul * dt);
          if (arrived) {
            this.path = null; this.target = null;
            this.idleTimer -= 1;
            // reach a waypoint: sometimes stop and watch (or the Nurse checks a "bed")
            const stareChance = (this.kind === 'nurse' || this.kind === 'nurse2') ? 0.6 : this.kind === 'child' ? 0.5 : 0.3;
            if (Math.random() < stareChance) {
              this.pause = 1.2 + Math.random() * 2.2;
              this.staring = onSameFloor && Math.random() < 0.7;
              if (this.kind === 'child' && Math.random() < 0.5) Audio2.laugh();
            }
          }
        }
      }

      // movement bookkeeping for the renderer (facing + walk/run animation)
      const moved = Math.hypot(this.x - this.px, this.y - this.py);
      this.moving = moved > 0.002;
      this.fast = this.state === S.HUNT;
    }

    // greedy fallback when no path (open rooms / adjacent)
    moveDirect(grid, tx, ty, dist) {
      const dx = tx - this.x, dy = ty - this.y, len = Math.hypot(dx, dy) || 1;
      const nx = this.x + (dx / len) * dist, ny = this.y + (dy / len) * dist;
      if (this.passable(grid, nx, ny)) { this.x = nx; this.y = ny; this.facing = Math.atan2(dy, dx); }
      else if (this.passable(grid, nx, this.y)) { this.x = nx; }
      else if (this.passable(grid, this.x, ny)) { this.y = ny; }
    }
  }

  function lineOfSight(grid, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
    let x = Math.floor(x0), y = Math.floor(y0);
    const tx = Math.floor(x1), ty = Math.floor(y1); let guard = 0;
    while (guard++ < 220) {
      if (x === tx && y === ty) return true;
      const t = grid[y] && grid[y][x];
      if (t === 2 || t === 0 || t === 4) return false;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return false;
  }

  // ---- the cast, each with a den (its haunt) and a home floor ----
  function spawnAll(world, opts) {
    opts = opts || {};
    const R = (fi, tag) => { const r = world.floors[fi].rooms.find((rr) => rr.tag === tag); return r ? { x: r.cx, y: r.cy } : { x: World.W / 2, y: 15 }; };
    const list = [];
    const add = (cfg) => list.push(new Entity(cfg));
    let p;
    p = R(1, 'er');    add({ name: 'The Grey Nurse', kind: 'nurse', floor: 1, x: p.x, y: p.y, speed: 1.7, huntSpeed: 3.0, hearing: 6, sight: 8, wakeHour: 1, den: ['er', 'waiting', 'admitting', 'pharmacy'] });
    p = R(3, 'mose');  add({ name: 'Mose Blackburn', kind: 'mose', floor: 3, x: p.x, y: p.y, speed: 2.0, huntSpeed: 3.7, hearing: 7, sight: 9, wakeHour: 3, den: ['mose', 'recovery', 'surgery', 'iso', 'landing', 'ward'] });
    p = R(2, 'maternity'); add({ name: 'The Child', kind: 'child', floor: 2, x: p.x, y: p.y, speed: 1.5, huntSpeed: 2.7, hearing: 8, sight: 6, wakeHour: 6, den: ['maternity', 'ward', 'room207', 'station'] });
    p = R(0, 'incinerator'); add({ name: 'The Ash', kind: 'ash', floor: 0, x: p.x, y: p.y, speed: 1.1, huntSpeed: 2.2, hearing: 12, sight: 10, wakeHour: 12, den: ['incinerator', 'boiler', 'ritual', 'laundry', 'morgue'] });
    p = R(1, 'kitchen'); add({ name: 'The Crawler', kind: 'crawler', floor: 1, x: p.x, y: p.y, speed: 2.4, huntSpeed: 4.2, hearing: 9, sight: 7, wakeHour: 4, den: ['kitchen', 'cafeteria', 'pharmacy', 'records'] });
    p = R(2, 'ward');  add({ name: 'Night Nurse', kind: 'nurse2', floor: 2, x: p.x, y: p.y, speed: 1.8, huntSpeed: 3.1, hearing: 6, sight: 8, wakeHour: 2, den: ['ward', 'station', 'room207', 'maternity', 'bath'] });
    p = R(0, 'morgue'); add({ name: 'The Ghoul', kind: 'ghoul', floor: 0, x: p.x, y: p.y, speed: 1.9, huntSpeed: 3.5, hearing: 8, sight: 8, wakeHour: 7, den: ['morgue', 'storage', 'laundry', 'incinerator'] });
    p = R(4, 'quarters'); add({ name: 'The Risen', kind: 'undead', floor: 4, x: p.x, y: p.y, speed: 1.8, huntSpeed: 3.3, hearing: 7, sight: 8, wakeHour: 5, den: ['quarters', 'matron', 'attic', 'chapel', 'bell'] });
    // Deep-night escalation — the hospital itself starts dreaming
    p = R(3, 'surgery'); add({ name: 'The Nightmare', kind: 'nightmare', floor: 3, x: p.x, y: p.y, speed: 1.6, huntSpeed: 3.6, hearing: 8, sight: 9, wakeHour: 8, den: ['surgery', 'xray', 'iso', 'recovery', 'ward'] });
    p = R(4, 'chapel');  add({ name: 'The Wraith', kind: 'wraith', floor: 4, x: p.x, y: p.y, speed: 1.4, huntSpeed: 3.0, hearing: 9, sight: 9, wakeHour: 10, den: ['chapel', 'attic', 'bell', 'matron', 'quarters'] });
    // Infested: a second Crawler stalks the upper wards
    if (opts.extra) { p = R(2, 'ward'); add({ name: 'The Other', kind: 'crawler', floor: 2, x: p.x, y: p.y, speed: 2.6, huntSpeed: 4.4, hearing: 10, sight: 8, wakeHour: 5, den: ['ward', 'maternity', 'station'] }); }
    return list;
  }

  return { Entity, spawnAll, lineOfSight, findPath, S };
})();
if (typeof window !== 'undefined') window.Entities = Entities;
