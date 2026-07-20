/* ============================================================================
 * entities.js — The dead of the Old Hospital, and how they hunt.
 *
 * Each entity is bound to a floor and roams it. States:
 *   DORMANT  — not yet awakened (before its "hour")
 *   PATROL   — wanders between waypoints on the corridor/rooms
 *   HUNT     — has a fix on the player; moves toward them
 *   SEARCH   — lost the player; checks last-known spot, then back to PATROL
 *
 * Detection: an entity notices you if
 *   - your flashlight beam falls on it (line of sight + cone), OR
 *   - you make noise within its hearing radius (sprint / spirit box / slam), OR
 *   - you linger in its room in the dark too long.
 * Catch = you die. Hiding + darkness breaks its fix.
 * ==========================================================================*/

const Entities = (() => {
  const S = { DORMANT: 0, PATROL: 1, HUNT: 2, SEARCH: 3, VANISH: 4 };

  class Entity {
    constructor(cfg) {
      Object.assign(this, {
        name: cfg.name,
        kind: cfg.kind,             // 'nurse' | 'mose' | 'child' | 'ash'
        floor: cfg.floor,
        x: cfg.x, y: cfg.y,
        speed: cfg.speed,           // tiles/sec while patrolling
        huntSpeed: cfg.huntSpeed,
        hearing: cfg.hearing,       // tiles
        sight: cfg.sight,           // tiles
        color: cfg.color,
        wakeHour: cfg.wakeHour,     // in-game hour (0..24 from start) it awakens
        roams: cfg.roams !== false, // ash is slow/relentless; nurse patrols
        state: S.DORMANT,
        target: null,
        lastSeen: null,
        cooldown: 0,
        stepTimer: 0,
        wobble: Math.random() * 6.28,
        alpha: 0,                   // fade-in visibility
      });
    }

    awake() { if (this.state === S.DORMANT) { this.state = S.PATROL; this.pickWaypoint(); } }

    pickWaypoint(world) {
      // pick a random floor tile as a patrol goal
      const grid = world ? world.floors[this.floor].grid : null;
      if (!grid) { this.target = { x: this.x, y: this.y }; return; }
      for (let tries = 0; tries < 30; tries++) {
        const rx = 2 + Math.floor(Math.random() * (World.W - 4));
        const ry = 2 + Math.floor(Math.random() * (World.H - 4));
        if (grid[ry][rx] === 1 || grid[ry][rx] === 3) { this.target = { x: rx, y: ry }; return; }
      }
      this.target = { x: this.x, y: this.y };
    }

    passable(grid, x, y) {
      if (x < 0 || y < 0 || x >= World.W || y >= World.H) return false;
      const t = grid[Math.floor(y)][Math.floor(x)];
      return t === 1 || t === 3 || t === 5 || t === 6 || t === 7 || t === 8 || t === 9;
    }

    // greedy step toward (tx,ty), trying to slide around walls
    moveToward(grid, tx, ty, dist) {
      const dx = tx - this.x, dy = ty - this.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = this.x + (dx / len) * dist;
      let ny = this.y + (dy / len) * dist;
      if (this.passable(grid, nx, ny)) { this.x = nx; this.y = ny; return; }
      // try axis-aligned slides
      if (this.passable(grid, nx, this.y)) { this.x = nx; return; }
      if (this.passable(grid, this.x, ny)) { this.y = ny; return; }
      // stuck: nudge perpendicular
      if (this.passable(grid, this.x + (dy / len) * dist, this.y - (dx / len) * dist)) {
        this.x += (dy / len) * dist; this.y -= (dx / len) * dist;
      } else {
        this.pickWaypoint(); // give up on this waypoint
      }
    }

    update(dt, world, player, ctx) {
      if (this.state === S.DORMANT) {
        if (ctx.hour >= this.wakeHour) this.awake();
        else return;
      }
      // fade visibility in
      this.alpha = Math.min(1, this.alpha + dt * 0.6);

      const grid = world.floors[this.floor].grid;
      const onSameFloor = player.floor === this.floor;
      this.wobble += dt * 3;

      // ---- detection (only if on same floor) ----
      let detected = false;
      if (onSameFloor) {
        const dx = player.x - this.x, dy = player.y - this.y;
        const d = Math.hypot(dx, dy);
        // heard?
        if (ctx.noise > 0 && d <= this.hearing * (0.5 + ctx.noise)) detected = true;
        // seen by flashlight (player lit them up) or entity sees player in own sight range with LOS
        if (ctx.beamHits && ctx.beamHits(this.x, this.y)) detected = true;
        if (d <= this.sight && lineOfSight(grid, this.x, this.y, player.x, player.y)) {
          // entities can see you unless you're hidden AND in darkness
          if (!(player.hidden && !ctx.playerLit)) detected = true;
        }
        // lingering in the dark near them
        if (d < 2.2 && !ctx.playerLit) detected = true;
      }

      if (detected && onSameFloor) {
        if (this.state !== S.HUNT) { Audio2.dread(); }
        this.state = S.HUNT;
        this.lastSeen = { x: player.x, y: player.y };
        this.cooldown = 3.5;
      }

      // ---- state behavior ----
      if (this.state === S.HUNT) {
        if (!onSameFloor) { this.state = S.SEARCH; this.cooldown = 4; }
        else {
          const spd = this.huntSpeed * dt;
          this.stepTimer -= dt;
          if (this.stepTimer <= 0) { this.stepTimer = 0.3; if (this.kind !== 'ash') Audio2.footstep(0.06); }
          this.moveToward(grid, player.x, player.y, spd);
          this.lastSeen = { x: player.x, y: player.y };
          // caught?
          if (Math.hypot(player.x - this.x, player.y - this.y) < 0.75 &&
              !(player.hidden)) {
            ctx.onCatch(this);
          }
          this.cooldown -= dt;
          if (!detected && this.cooldown <= 0) { this.state = S.SEARCH; this.cooldown = 4; }
        }
      } else if (this.state === S.SEARCH) {
        const goal = this.lastSeen || this.target || { x: this.x, y: this.y };
        this.moveToward(grid, goal.x, goal.y, this.speed * dt);
        if (Math.hypot(goal.x - this.x, goal.y - this.y) < 0.6) {
          this.cooldown -= dt;
          if (this.cooldown <= 0) { this.state = S.PATROL; this.pickWaypoint(world); }
        }
        this.cooldown -= dt * 0.5;
      } else if (this.state === S.PATROL) {
        if (!this.target) this.pickWaypoint(world);
        this.moveToward(grid, this.target.x, this.target.y, this.speed * dt);
        if (Math.hypot(this.target.x - this.x, this.target.y - this.y) < 0.6) {
          this.pickWaypoint(world);
        }
        // occasional wander to another floor (except ash & nurse who stay)
        if (this.roams && Math.random() < dt * 0.03) {
          const nf = Math.max(0, Math.min(4, this.floor + (Math.random() < 0.5 ? -1 : 1)));
          this.floor = nf;
        }
      }
    }
  }

  // Bresenham-ish line of sight over the tile grid (walls block)
  function lineOfSight(grid, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = Math.floor(x0), y = Math.floor(y0);
    const tx = Math.floor(x1), ty = Math.floor(y1);
    let guard = 0;
    while (guard++ < 200) {
      if (x === tx && y === ty) return true;
      const t = grid[y] && grid[y][x];
      if (t === 2 || t === 0 || t === 4) return false; // wall/void/locked blocks sight
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return false;
  }

  // Build the cast for a fresh night.
  function spawnAll(world) {
    const R = (fi, tag) => {
      const r = world.floors[fi].rooms.find((rr) => rr.tag === tag);
      return r ? { x: r.cx, y: r.cy } : { x: World.W / 2, y: 15 };
    };
    const list = [];
    // The Grey Nurse — floor 1, patrols the ER/wards, formal and rule-bound.
    let p = R(1, 'er');
    list.push(new Entity({
      name: 'The Grey Nurse', kind: 'nurse', floor: 1, x: p.x, y: p.y,
      speed: 1.7, huntSpeed: 3.0, hearing: 6, sight: 8, color: '#9aa7b0',
      wakeHour: 0, roams: true,
    }));
    // Mose Blackburn — third floor, the window, aggressive, wants to be heard.
    p = R(3, 'mose');
    list.push(new Entity({
      name: 'Mose Blackburn', kind: 'mose', floor: 3, x: p.x, y: p.y,
      speed: 2.0, huntSpeed: 3.7, hearing: 7, sight: 9, color: '#5a4a4a',
      wakeHour: 3, roams: true,
    }));
    // The Child — basement children's ward, lures you, then something else comes.
    p = R(0, 'nursery');
    list.push(new Entity({
      name: 'The Child', kind: 'child', floor: 0, x: p.x, y: p.y,
      speed: 1.4, huntSpeed: 2.6, hearing: 8, sight: 6, color: '#7d8a95',
      wakeHour: 6, roams: false,
    }));
    // The Ash — the incinerator. Slow, relentless, cannot be reasoned with.
    p = R(0, 'incinerator');
    list.push(new Entity({
      name: 'The Ash', kind: 'ash', floor: 0, x: p.x, y: p.y,
      speed: 1.1, huntSpeed: 2.2, hearing: 12, sight: 10, color: '#1c1310',
      wakeHour: 12, roams: false,
    }));
    return list;
  }

  return { Entity, spawnAll, lineOfSight, S };
})();
if (typeof window !== 'undefined') window.Entities = Entities;
