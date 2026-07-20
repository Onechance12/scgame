/* ============================================================================
 * game.js — COLLEGE HILL: 24 Hours.
 * Player, input, flashlight/darkness rendering, HUD, objectives, and the loop.
 * ==========================================================================*/

const Game = (() => {
  const TILE = World.TILE;
  const PX = 30;                 // pixels per tile at scale 1
  const WALK = 3.4, SPRINT = 6.0;
  const LIGHT_RANGE = 8.5, CONE = 0.62; // flashlight cone half-angle (rad)
  const GAME_SECONDS = 1080;     // 24 in-game hours across ~18 minutes
  const HOURS_PER_SEC = 24 / GAME_SECONDS;

  // locked-room -> key needed
  const KEY_FOR = { mose: 'key_mose', incinerator: 'key_incinerator', roof: 'key_roof' };

  let canvas, cx;
  let data;                      // World.build() result
  let ents = [];
  let player;
  let state = 'MENU';            // MENU | INTRO | PLAY | PAUSE | DEAD | WIN
  let last = 0;
  let raf = 0;
  let mouse = { x: 0, y: 0 };
  let keys = {};
  let messages = [];             // subtitle queue {text, t}
  let msgTimer = 0;
  let hour = 0;
  let elapsed = 0;
  let interactTarget = null;
  let spiritHold = 0;            // progress on current spirit objective
  let spiritActive = false;
  let scareCooldown = 0;
  let ambientEventTimer = 6;
  let flashFlicker = 1;
  let deathBy = '';

  // ---------- init ----------
  function init() {
    canvas = document.getElementById('game');
    cx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    bindInput();
    bindUI();
    draw(); // paint the menu backdrop frame once
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  // ---------- new game ----------
  function newGame() {
    Audio2.init();   // create the AudioContext under the user's click gesture
    Audio2.resume();
    data = World.build();
    ents = Entities.spawnAll(data);
    const sp = World.spawn(data);
    player = {
      floor: sp.floor, x: sp.x + 0.5, y: sp.y + 0.5,
      dir: 0, fear: 12, stamina: 100, battery: 100,
      hasLight: false, lightOn: false, hidden: false,
      inv: {}, keys: {},
    };
    hour = 0; elapsed = 0; messages = []; spiritHold = 0; spiritActive = false;
    deathBy = '';
    // mark objectives fresh
    data.objectives.forEach((o) => (o.done = false));
    hideAllScreens();
    state = 'INTRO';
    runIntro(0);
  }

  const INTRO_LINES = [
    'THE OLD HOSPITAL ON COLLEGE HILL',
    'Williamson, West Virginia',
    'Opened 1928. Closed 1988. Four floors, and a basement below them.',
    'Your ride is gone. The front doors are chained.',
    'You have until dawn. Twenty-four hours.',
    'They have that long with you.',
    '',
    'Find the flashlight in the lobby. Then find the truth.',
  ];
  function runIntro(i) {
    if (state !== 'INTRO') return;
    if (i >= INTRO_LINES.length) { startPlay(); return; }
    showSubtitle(INTRO_LINES[i], 2.4);
    setTimeout(() => runIntro(i + 1), i === 0 ? 2600 : 2000);
  }

  function startPlay() {
    hideAllScreens();
    Audio2.startAmbient();
    state = 'PLAY';
    last = performance.now();
    showObjective();
    showSubtitle('Grab the flashlight. Press E to pick things up.', 4);
    loop(last);
  }

  // ---------- input ----------
  function bindInput() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (k === 'tab') { e.preventDefault(); toggleJournal(); }
      if (k === 'p' || k === 'escape') { if (state === 'PLAY') pause(); else if (state === 'PAUSE') resumeGame(); }
      if (k === 'f') toggleFlash();
      if (k === 'e' && state === 'PLAY') interact();
      if (k === 'q' && state === 'PLAY') startSpirit();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      keys[k] = false;
      if (k === 'q') stopSpirit();
    });
    canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
    canvas.addEventListener('mousedown', () => { if (state === 'PLAY') toggleFlash(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function bindUI() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    on('btn-start', newGame);
    on('btn-resume', resumeGame);
    on('btn-restart', newGame);
    on('btn-restart-dead', newGame);
    on('btn-restart-win', newGame);
    on('btn-journal-close', toggleJournal);
    on('btn-menu-death', () => location.reload());
  }

  // ---------- flashlight / spirit box ----------
  function toggleFlash() {
    if (state !== 'PLAY' || !player.hasLight) return;
    if (player.battery <= 0) { player.lightOn = false; return; }
    player.lightOn = !player.lightOn;
  }
  function startSpirit() {
    if (!player.inv.spiritbox) { showSubtitle('You need the spirit box (found in Records).', 2); return; }
    if (spiritActive) return;
    spiritActive = true;
    Audio2.spiritStart();
  }
  function stopSpirit() {
    if (!spiritActive) return;
    spiritActive = false;
    Audio2.spiritStop();
  }

  // ---------- interaction ----------
  function interact() {
    // stairs
    const t = tileAt(player.floor, player.x, player.y);
    if (t === TILE.UP) { changeFloor(1); return; }
    if (t === TILE.DOWN) { changeFloor(-1); return; }
    if (t === TILE.HIDE) { player.hidden = !player.hidden; showSubtitle(player.hidden ? 'You slip into the dark and go still…' : 'You climb out.', 1.8); return; }

    // item pickup
    const it = data.items.find((i) => !i.taken && i.floor === player.floor &&
      Math.hypot(i.x + 0.5 - player.x, i.y + 0.5 - player.y) < 1.1);
    if (it) { pickupItem(it); return; }

    // exit doors
    if (t === TILE.EXIT) { tryExit(); return; }

    // objective interactions (documents / bell)
    const obj = objectiveHere();
    if (obj && (obj.type === 'document' || obj.type === 'bell')) { completeObjective(obj); return; }

    showSubtitle('Nothing here.', 1);
  }

  function pickupItem(it) {
    it.taken = true;
    Audio2.pickup();
    switch (it.type) {
      case 'flashlight':
        player.hasLight = true; player.lightOn = true;
        showSubtitle('Flashlight. Click or F to toggle. It drains — and it shows them where you are.', 4);
        break;
      case 'battery':
        player.battery = Math.min(100, player.battery + 45);
        showSubtitle('Batteries. +45% light.', 2);
        break;
      case 'emf':
        player.inv.emf = true; showSubtitle('EMF reader. It ticks when the dead are near.', 3); break;
      case 'spiritbox':
        player.inv.spiritbox = true; showSubtitle('Spirit box. Hold Q to listen. They will answer — and come.', 4); break;
      case 'candlekit':
        player.inv.candles = (player.inv.candles || 0) + 3; showSubtitle('Candles. Stand in their light to steady your heart.', 3); break;
      case 'key':
        player.keys[it.id] = true; showSubtitle('A key: ' + keyLabel(it.id), 3); break;
    }
    updateHUD();
  }
  function keyLabel(id) {
    return ({ key_mose: 'Room 3-East', key_incinerator: 'the Incinerator', key_roof: 'Roof Access' })[id] || id;
  }

  function changeFloor(dir) {
    const nf = Math.max(0, Math.min(4, player.floor + dir));
    if (nf === player.floor) return;
    player.floor = nf;
    player.x = Math.max(4, Math.min(World.W - 5, Math.round(player.x))) + 0.5;
    player.y = 15.5;
    player.hidden = false;
    Audio2.creak();
    const f = data.floors[nf];
    showSubtitle(f.name + ' — ' + f.subtitle, 3.2);
  }

  // ---------- objectives ----------
  function objectiveHere() {
    return data.objectives.find((o) => !o.done && o.floor === player.floor && inRoom(o.floor, o.tag));
  }
  function inRoom(fi, tag) {
    const r = data.floors[fi].rooms.find((rr) => rr.tag === tag);
    if (!r) return false;
    return player.x >= r.x && player.x <= r.x + r.w && player.y >= r.y && player.y <= r.y + r.h;
  }
  function completeObjective(o) {
    if (o.requiresAll) {
      const others = data.objectives.filter((x) => x !== o);
      if (!others.every((x) => x.done)) { showSubtitle('Not yet. Three truths remain unspoken.', 3); return; }
    }
    o.done = true;
    playLore(o.lore, () => {
      if (o.id === 'roof') { win(); return; }
      showSubtitle('A truth spoken. The building shifts around you.', 3);
      // waking things up
      if (o.id === 'basement') { showSubtitle('Something in the incinerator wakes.', 3); Audio2.stinger(true); wake('ash'); }
      showObjective();
      updateHUD();
    });
  }
  function wake(kind) {
    const e = ents.find((x) => x.kind === kind);
    if (e) e.awake();
  }

  function tryExit() {
    const all = data.objectives.every((o) => o.done);
    if (all) { win(); }
    else showSubtitle('The chain holds. The hospital won’t let you leave with its secrets unspoken.', 3.5);
  }

  // spirit-box objectives complete by holding Q inside the room
  function updateSpiritObjective(dt) {
    if (!spiritActive) { spiritHold = Math.max(0, spiritHold - dt); return; }
    const o = data.objectives.find((x) => !x.done && x.type === 'spiritbox' && x.floor === player.floor && inRoom(x.floor, x.tag));
    if (!o) { spiritHold = Math.max(0, spiritHold - dt * 0.5); return; }
    if (o.needsKey && !unlockedForObjective(o)) {
      showSubtitle('The door to ' + keyLabel(o.needsKey) + ' is still locked.', 2);
      return;
    }
    spiritHold += dt;
    if (Math.random() < dt * 2.4) Audio2.spiritWord();
    if (spiritHold > 4.5) {
      spiritHold = 0;
      stopSpirit();
      completeObjective(o);
    }
  }
  function unlockedForObjective(o) {
    // the room's locked door was opened (we convert LOCKED->DOOR when key used)
    const r = data.floors[o.floor].rooms.find((rr) => rr.tag === o.tag);
    if (!r) return true;
    return data.floors[o.floor].grid[r.doorY][r.doorX] !== TILE.LOCKED;
  }

  function playLore(key, done) {
    const lines = data.LORE[key] || [];
    let i = 0;
    const step = () => {
      if (i >= lines.length) { if (done) done(); return; }
      showSubtitle(lines[i], 2.8);
      Audio2.whisper(0.8);
      i++;
      setTimeout(step, 2600);
    };
    step();
  }

  // ---------- update ----------
  function loop(now) {
    if (state !== 'PLAY') return;
    let dt = (now - last) / 1000;
    if (dt > 0.05) dt = 0.05; // clamp big frame gaps
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function update(dt) {
    elapsed += dt;
    hour = elapsed * HOURS_PER_SEC;

    // movement
    let vx = 0, vy = 0;
    if (keys['w'] || keys['arrowup']) vy -= 1;
    if (keys['s'] || keys['arrowdown']) vy += 1;
    if (keys['a'] || keys['arrowleft']) vx -= 1;
    if (keys['d'] || keys['arrowright']) vx += 1;
    const moving = (vx || vy) && !player.hidden;
    let sprint = keys['shift'] && player.stamina > 1 && moving;
    let spd = sprint ? SPRINT : WALK;
    if (player.hidden) spd = 0;
    if (moving) {
      const len = Math.hypot(vx, vy) || 1;
      vx /= len; vy /= len;
      tryMove(vx * spd * dt, 0);
      tryMove(0, vy * spd * dt);
      player.dir = Math.atan2(vy, vx);
    }
    // stamina
    if (sprint) player.stamina = Math.max(0, player.stamina - dt * 26);
    else player.stamina = Math.min(100, player.stamina + dt * 14);

    // flashlight battery + flicker
    if (player.lightOn && player.battery > 0) {
      player.battery = Math.max(0, player.battery - dt * 1.6);
      if (player.battery <= 0) { player.lightOn = false; showSubtitle('The flashlight dies. Darkness.', 2.5); }
      flashFlicker = player.battery < 20 ? (0.55 + Math.random() * 0.45) : 1;
    } else flashFlicker = 1;

    // aiming (flashlight points at mouse)
    const aim = Math.atan2(mouse.y - canvas.height / 2, mouse.x - canvas.width / 2);
    player.aim = aim;

    // unlock locked doors you walk into if you have the key
    tryUnlockAhead();

    // noise level
    let noise = 0;
    if (moving) noise = sprint ? 0.55 : 0.12;
    if (spiritActive) noise = Math.max(noise, 0.85);
    if (player.hidden) noise = 0;

    // fear dynamics
    updateFear(dt, noise);

    // entities
    const ctx = buildEntityCtx(noise);
    let nearest = Infinity, hunting = false;
    ents.forEach((e) => {
      e.update(dt, data, player, ctx);
      if (e.floor === player.floor) {
        const d = Math.hypot(e.x - player.x, e.y - player.y);
        nearest = Math.min(nearest, d);
        if (e.state === Entities.S.HUNT) hunting = true;
      }
    });
    if (hunting) { Audio2.chase(Math.random() < dt * 3); }

    // proximity dread -> fear
    if (nearest < 5) player.fear = Math.min(100, player.fear + (5 - nearest) * dt * 2.4);

    // EMF ticking
    if (player.inv.emf && nearest < 9) {
      const lvl = Math.max(1, Math.round(5 - (nearest / 9) * 5));
      if (Math.random() < dt * (2 + lvl)) Audio2.emf(lvl);
    }

    // spirit objective progress
    updateSpiritObjective(dt);

    // ambient scares
    ambientEventTimer -= dt;
    if (ambientEventTimer <= 0) {
      ambientEventTimer = 5 + Math.random() * 9 - hour * 0.1;
      ambientEvent();
    }
    if (scareCooldown > 0) scareCooldown -= dt;

    // interact prompt target
    interactTarget = findInteract();

    // heart + audio fear
    Audio2.setFear(player.fear);
    Audio2.tickHeart(dt);

    // find interact / update HUD
    updateHUD();
    tickSubtitle(dt);

    // death
    if (player.fear >= 100 && state === 'PLAY') { deathBy = deathBy || 'Your heart gave out.'; die(); }
  }

  function buildEntityCtx(noise) {
    return {
      hour, noise,
      playerLit: isPlayerLit(),
      beamHits: (ex, ey) => beamHits(ex, ey),
      onCatch: (e) => { deathBy = catchLine(e); die(); },
    };
  }
  function catchLine(e) {
    return ({
      nurse: 'The Grey Nurse reaches you. “You should have followed the rules.”',
      mose: 'Mose Blackburn’s shadow closes over you. He was never going to let you leave unheard.',
      child: 'The small cold hand finds yours and does not let go.',
      ash: 'The Ash folds around you. The fire finally has a name for you.',
    })[e.kind] || 'It takes you.';
  }

  function isPlayerLit() {
    if (player.lightOn && player.battery > 0) return true;
    // near a candle?
    const g = data.floors[player.floor].grid;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const yy = Math.floor(player.y) + j, xx = Math.floor(player.x) + i;
      if (g[yy] && g[yy][xx] === TILE.CANDLE && Math.hypot(i, j) < 2.5) return true;
    }
    return false;
  }

  function beamHits(ex, ey) {
    if (!player.lightOn || player.battery <= 0) return false;
    const dx = ex - player.x, dy = ey - player.y;
    const d = Math.hypot(dx, dy);
    if (d > LIGHT_RANGE) return false;
    const ang = Math.atan2(dy, dx);
    let da = Math.abs(normAng(ang - player.aim));
    if (da > CONE) return false;
    return Entities.lineOfSight(data.floors[player.floor].grid, player.x, player.y, ex, ey);
  }

  function updateFear(dt, noise) {
    const lit = isPlayerLit();
    // fear rises in the dark, faster at night hours
    const night = 0.5 + Math.min(1, hour / 12) * 0.9;
    if (!lit) player.fear = Math.min(100, player.fear + dt * (2.2 * night));
    else player.fear = Math.max(0, player.fear - dt * 3.2);
    if (player.hidden) player.fear = Math.min(100, player.fear + dt * 1.4); // dread of hiding
    // standing in candle light steadies you more
    if (nearCandle()) player.fear = Math.max(0, player.fear - dt * 5);
  }
  function nearCandle() {
    const g = data.floors[player.floor].grid;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const yy = Math.floor(player.y) + j, xx = Math.floor(player.x) + i;
      if (g[yy] && g[yy][xx] === TILE.CANDLE) return true;
    }
    return false;
  }

  function ambientEvent() {
    if (state !== 'PLAY') return;
    const roll = Math.random();
    if (roll < 0.4) Audio2.whisper(0.6 + hour / 24);
    else if (roll < 0.7) Audio2.creak();
    else if (roll < 0.85) { Audio2.footstep(0.05); Audio2.footstep(0.05); }
    else if (scareCooldown <= 0 && player.fear > 30) {
      // a proper jump event: a nearby stinger + fear jolt
      Audio2.stinger(false);
      player.fear = Math.min(100, player.fear + 8);
      scareCooldown = 12;
      const lines = ['Something moved in the corner of your eye.', 'A door slams somewhere below.', 'Cold breath on the back of your neck.', 'Footsteps — right behind you. Nothing there.'];
      showSubtitle(lines[Math.floor(Math.random() * lines.length)], 2.2);
    }
  }

  // ---------- collision ----------
  function passableFor(fi, x, y) {
    if (x < 0 || y < 0 || x >= World.W || y >= World.H) return false;
    const t = data.floors[fi].grid[Math.floor(y)][Math.floor(x)];
    return t === TILE.FLOOR || t === TILE.DOOR || t === TILE.UP || t === TILE.DOWN ||
      t === TILE.HIDE || t === TILE.CANDLE || t === TILE.EXIT;
  }
  function tileAt(fi, x, y) { return data.floors[fi].grid[Math.floor(y)][Math.floor(x)]; }

  function tryMove(dx, dy) {
    const r = 0.22;
    const nx = player.x + dx, ny = player.y + dy;
    // check the leading edges
    const sx = dx > 0 ? r : -r, sy = dy > 0 ? r : -r;
    if (dx !== 0 && passableFor(player.floor, nx + sx, player.y + r) && passableFor(player.floor, nx + sx, player.y - r)) player.x = nx;
    if (dy !== 0 && passableFor(player.floor, player.x + r, ny + sy) && passableFor(player.floor, player.x - r, ny + sy)) player.y = ny;
  }

  function tryUnlockAhead() {
    // if a LOCKED tile is within 1 tile ahead and we have the matching key, open it
    const fx = Math.floor(player.x + Math.cos(player.aim) * 0.8);
    const fy = Math.floor(player.y + Math.sin(player.aim) * 0.8);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = Math.floor(player.x) + i, yy = Math.floor(player.y) + j;
      const g = data.floors[player.floor].grid;
      if (g[yy] && g[yy][xx] === TILE.LOCKED) {
        // which room owns this door?
        const room = data.floors[player.floor].rooms.find((r) => r.doorX === xx && r.doorY === yy);
        const keyId = room && KEY_FOR[room.tag];
        if (keyId && player.keys[keyId]) {
          g[yy][xx] = TILE.DOOR;
          Audio2.creak();
          showSubtitle('The lock gives. ' + (room ? room.name : '') + ' opens.', 2.5);
        }
      }
    }
  }

  function findInteract() {
    const t = tileAt(player.floor, player.x, player.y);
    if (t === TILE.UP) return 'Press E — climb the stairs up';
    if (t === TILE.DOWN) return 'Press E — descend the stairs';
    if (t === TILE.HIDE) return player.hidden ? 'Press E — come out of hiding' : 'Press E — hide here';
    if (t === TILE.EXIT) return 'Press E — the chained front doors';
    const it = data.items.find((i) => !i.taken && i.floor === player.floor &&
      Math.hypot(i.x + 0.5 - player.x, i.y + 0.5 - player.y) < 1.1);
    if (it) return 'Press E — take the ' + itemName(it.type);
    const o = objectiveHere();
    if (o && o.type === 'document') return 'Press E — read';
    if (o && o.type === 'bell') return 'Press E — ring the dawn bell';
    if (o && o.type === 'spiritbox') return 'Hold Q — listen with the spirit box';
    return null;
  }
  function itemName(t) {
    return ({ flashlight: 'flashlight', battery: 'batteries', emf: 'EMF reader', spiritbox: 'spirit box', candlekit: 'candles', key: 'key' })[t] || t;
  }

  // ---------- rendering ----------
  function draw() {
    if (!cx) return;
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, canvas.width, canvas.height);
    if (state === 'MENU') { return; }
    if (!data) return;

    const camX = player.x, camY = player.y;
    const ox = canvas.width / 2 - camX * PX;
    const oy = canvas.height / 2 - camY * PX;
    const g = data.floors[player.floor].grid;

    const tx0 = Math.max(0, Math.floor(camX - canvas.width / 2 / PX) - 1);
    const tx1 = Math.min(World.W, Math.ceil(camX + canvas.width / 2 / PX) + 1);
    const ty0 = Math.max(0, Math.floor(camY - canvas.height / 2 / PX) - 1);
    const ty1 = Math.min(World.H, Math.ceil(camY + canvas.height / 2 / PX) + 1);

    // draw tiles with light
    for (let y = ty0; y < ty1; y++) {
      for (let x = tx0; x < tx1; x++) {
        const t = g[y][x];
        if (t === TILE.VOID) continue;
        const light = lightAt(x + 0.5, y + 0.5);
        if (light <= 0.02) continue; // unseen -> black
        drawTile(t, x, y, ox, oy, light);
      }
    }

    // items (only if lit)
    data.items.forEach((it) => {
      if (it.taken || it.floor !== player.floor) return;
      const l = lightAt(it.x + 0.5, it.y + 0.5);
      if (l < 0.12) return;
      drawItem(it, ox, oy, l);
    });

    // entities
    ents.forEach((e) => {
      if (e.floor !== player.floor) return;
      const l = lightAt(e.x, e.y);
      const vis = e.state === Entities.S.HUNT ? Math.max(l, 0.35) : l;
      if (vis < 0.1) return;
      drawEntity(e, ox, oy, vis);
    });

    // player
    drawPlayer(ox, oy);

    // darkness vignette + fear overlay
    drawOverlay();
  }

  // Light at a world point (tile units). Combines flashlight cone, ambient
  // glow around player, and candle sources. Returns 0..1.
  function lightAt(wx, wy) {
    const g = data.floors[player.floor].grid;
    let light = 0;
    // ambient bubble around player (very short — you can barely see your hands)
    const dp = Math.hypot(wx - player.x, wy - player.y);
    if (dp < 2.0) light = Math.max(light, (1 - dp / 2.0) * 0.32);
    // flashlight
    if (player.lightOn && player.battery > 0) {
      if (dp < LIGHT_RANGE) {
        const ang = Math.atan2(wy - player.y, wx - player.x);
        const da = Math.abs(normAng(ang - player.aim));
        if (da < CONE) {
          if (Entities.lineOfSight(g, player.x, player.y, wx, wy)) {
            const falloff = (1 - dp / LIGHT_RANGE) * (1 - da / CONE * 0.6);
            light = Math.max(light, falloff * flashFlicker);
          }
        }
      }
    }
    // candles
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
      const yy = Math.floor(wy) + j, xx = Math.floor(wx) + i;
      if (g[yy] && g[yy][xx] === TILE.CANDLE) {
        const cd = Math.hypot(wx - (xx + 0.5), wy - (yy + 0.5));
        if (cd < 3.5 && Entities.lineOfSight(g, xx + 0.5, yy + 0.5, wx, wy)) {
          light = Math.max(light, (1 - cd / 3.5) * 0.6);
        }
      }
    }
    return Math.min(1, light);
  }

  function drawTile(t, x, y, ox, oy, light) {
    const px = x * PX + ox, py = y * PX + oy;
    let base;
    switch (t) {
      case TILE.WALL: base = [40, 40, 46]; break;
      case TILE.DOOR: base = [70, 55, 40]; break;
      case TILE.LOCKED: base = [90, 40, 40]; break;
      case TILE.UP:
      case TILE.DOWN: base = [30, 45, 60]; break;
      case TILE.HIDE: base = [55, 45, 55]; break;
      case TILE.CANDLE: base = [90, 70, 30]; break;
      case TILE.EXIT: base = [30, 70, 45]; break;
      default: base = [22, 22, 26]; // floor
    }
    const l = 0.15 + light * 0.85;
    cx.fillStyle = `rgb(${base[0] * l | 0},${base[1] * l | 0},${base[2] * l | 0})`;
    cx.fillRect(px, py, PX + 1, PX + 1);
    // subtle grime lines on floor
    if (t === TILE.FLOOR && light > 0.2) {
      cx.strokeStyle = `rgba(0,0,0,${0.25 * light})`;
      cx.strokeRect(px + 0.5, py + 0.5, PX, PX);
    }
    if (t === TILE.CANDLE) {
      const fl = 0.6 + Math.random() * 0.4;
      cx.fillStyle = `rgba(255,190,90,${fl})`;
      cx.beginPath(); cx.arc(px + PX / 2, py + PX / 2, 4, 0, 6.28); cx.fill();
    }
    if (t === TILE.UP || t === TILE.DOWN) {
      cx.fillStyle = `rgba(200,220,255,${0.5 * light})`;
      cx.font = '16px monospace'; cx.textAlign = 'center';
      cx.fillText(t === TILE.UP ? '▲' : '▼', px + PX / 2, py + PX / 2 + 6);
    }
    if (t === TILE.EXIT) {
      cx.strokeStyle = `rgba(120,255,170,${light})`; cx.lineWidth = 2;
      cx.strokeRect(px + 3, py + 3, PX - 6, PX - 6);
    }
    if (t === TILE.HIDE) {
      cx.fillStyle = `rgba(180,180,200,${0.4 * light})`;
      cx.fillRect(px + PX / 2 - 5, py + 4, 10, PX - 8);
    }
  }

  function drawItem(it, ox, oy, l) {
    const px = (it.x + 0.5) * PX + ox, py = (it.y + 0.5) * PX + oy;
    const glow = 0.5 + Math.sin(performance.now() / 300) * 0.3;
    const colors = { flashlight: '#ffe08a', battery: '#8affa0', emf: '#7ad0ff', spiritbox: '#c99cff', candlekit: '#ffb86b', key: '#ffd24a' };
    cx.fillStyle = colors[it.type] || '#fff';
    cx.globalAlpha = Math.min(1, l + 0.2) * glow;
    cx.beginPath(); cx.arc(px, py, 6, 0, 6.28); cx.fill();
    cx.globalAlpha = 0.25 * l;
    cx.beginPath(); cx.arc(px, py, 11, 0, 6.28); cx.fill();
    cx.globalAlpha = 1;
  }

  function drawPlayer(ox, oy) {
    const px = player.x * PX + ox, py = player.y * PX + oy;
    if (player.hidden) {
      cx.fillStyle = 'rgba(120,120,140,0.5)';
    } else {
      cx.fillStyle = '#cfd6dd';
    }
    cx.beginPath(); cx.arc(px, py, 7, 0, 6.28); cx.fill();
    // facing nub
    cx.strokeStyle = '#cfd6dd'; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(px, py);
    cx.lineTo(px + Math.cos(player.aim) * 11, py + Math.sin(player.aim) * 11); cx.stroke();
  }

  function drawEntity(e, ox, oy, vis) {
    const px = e.x * PX + ox, py = e.y * PX + oy;
    const a = Math.min(1, e.alpha) * Math.min(1, vis + 0.25);
    cx.save();
    cx.globalAlpha = a;
    if (e.kind === 'nurse') {
      // pale grey figure with a cap
      cx.fillStyle = '#aeb8c0';
      roundedFig(px, py, 8, 20);
      cx.fillStyle = '#e7edf2';
      cx.fillRect(px - 6, py - 16, 12, 5); // cap
      cx.fillStyle = 'rgba(20,20,25,0.9)';
      cx.beginPath(); cx.arc(px - 3, py - 8, 1.6, 0, 6.28); cx.arc(px + 3, py - 8, 1.6, 0, 6.28); cx.fill();
    } else if (e.kind === 'mose') {
      cx.fillStyle = '#20181a';
      roundedFig(px, py, 9, 22);
      cx.fillStyle = 'rgba(180,40,40,0.8)';
      cx.beginPath(); cx.arc(px - 3, py - 9, 1.8, 0, 6.28); cx.arc(px + 3, py - 9, 1.8, 0, 6.28); cx.fill();
    } else if (e.kind === 'child') {
      cx.fillStyle = '#8b95a0';
      roundedFig(px, py, 5, 12);
      cx.fillStyle = 'rgba(10,10,12,0.9)';
      cx.beginPath(); cx.arc(px - 2, py - 5, 1.3, 0, 6.28); cx.arc(px + 2, py - 5, 1.3, 0, 6.28); cx.fill();
    } else { // ash
      const g2 = cx.createRadialGradient(px, py, 2, px, py, 20);
      g2.addColorStop(0, 'rgba(30,15,8,0.98)');
      g2.addColorStop(0.6, 'rgba(15,8,6,0.9)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g2;
      cx.beginPath(); cx.arc(px, py, 20, 0, 6.28); cx.fill();
      // embers
      for (let i = 0; i < 5; i++) {
        cx.fillStyle = `rgba(255,${80 + Math.random() * 100 | 0},20,${0.5 + Math.random() * 0.5})`;
        cx.beginPath(); cx.arc(px + (Math.random() - 0.5) * 22, py + (Math.random() - 0.5) * 22, 1.5, 0, 6.28); cx.fill();
      }
    }
    // hunting aura
    if (e.state === Entities.S.HUNT) {
      cx.globalAlpha = 0.2 + Math.random() * 0.15;
      cx.strokeStyle = '#ff3b3b'; cx.lineWidth = 2;
      cx.beginPath(); cx.arc(px, py, 16, 0, 6.28); cx.stroke();
    }
    cx.restore();
  }
  function roundedFig(px, py, w, h) {
    cx.beginPath();
    cx.ellipse(px, py - h / 4, w, h / 2, 0, 0, 6.28);
    cx.fill();
    cx.beginPath(); cx.arc(px, py - h / 2, w * 0.7, 0, 6.28); cx.fill(); // head
  }

  function drawOverlay() {
    // radial darkness vignette from center
    const g = cx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 60,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.96)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, canvas.width, canvas.height);
    // fear redness at the edges
    if (player.fear > 45) {
      const f = (player.fear - 45) / 55;
      const rg = cx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, canvas.height * 0.25,
        canvas.width / 2, canvas.height / 2, canvas.height * 0.7);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(1, `rgba(120,0,0,${0.5 * f})`);
      cx.fillStyle = rg;
      cx.fillRect(0, 0, canvas.width, canvas.height);
      // pulse
      if (Math.sin(performance.now() / (300 - f * 150)) > 0.7) {
        cx.fillStyle = `rgba(90,0,0,${0.10 * f})`;
        cx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    if (player.hidden) {
      cx.fillStyle = 'rgba(0,0,0,0.55)';
      cx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ---------- HUD ----------
  function updateHUD() {
    setBar('fear-fill', player.fear);
    setBar('battery-fill', player.battery);
    setBar('stamina-fill', player.stamina);
    const clock = document.getElementById('clock');
    if (clock) clock.textContent = fmtClock();
    const inv = document.getElementById('inventory');
    if (inv) {
      const bits = [];
      if (player.hasLight) bits.push(player.lightOn ? '🔦 ON' : '🔦 off');
      if (player.inv.emf) bits.push('📶 EMF');
      if (player.inv.spiritbox) bits.push(spiritActive ? '📻 …' : '📻');
      Object.keys(player.keys).forEach((k) => bits.push('🗝'));
      inv.textContent = bits.join('   ');
    }
    const prompt = document.getElementById('interact-prompt');
    if (prompt) { prompt.textContent = interactTarget || ''; prompt.style.opacity = interactTarget ? 1 : 0; }
    // objective mini
    const done = data.objectives.filter((o) => o.done).length;
    const obEl = document.getElementById('objective-count');
    if (obEl) obEl.textContent = `Truths: ${done}/${data.objectives.length}`;
  }
  function setBar(id, v) { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, v)) + '%'; }
  function fmtClock() {
    const total = (18 + hour) % 24;
    const h = Math.floor(total);
    const m = Math.floor((total - h) * 60);
    const hh = ((h + 11) % 12) + 1;
    const ap = h < 12 ? 'AM' : 'PM';
    return `${hh}:${m.toString().padStart(2, '0')} ${ap}`;
  }

  function showObjective() {
    const next = data.objectives.find((o) => !o.done);
    const el = document.getElementById('objective');
    if (!el) return;
    if (!next) { el.textContent = 'All truths spoken. Reach the front doors.'; return; }
    el.innerHTML = `<b>OBJECTIVE:</b> ${next.title}<br><span class="hint">${next.hint}</span>`;
  }

  // ---------- subtitles ----------
  function showSubtitle(text, dur) { messages.push({ text, t: dur || 2.5 }); }
  function tickSubtitle(dt) {
    const el = document.getElementById('subtitle');
    if (!el) return;
    if (messages.length) {
      el.textContent = messages[0].text;
      el.style.opacity = 1;
      messages[0].t -= dt;
      if (messages[0].t <= 0) messages.shift();
    } else { el.style.opacity = 0; }
  }

  // ---------- journal ----------
  let journalOpen = false;
  function toggleJournal() {
    journalOpen = !journalOpen;
    const el = document.getElementById('journal');
    if (!el) return;
    if (journalOpen && data) {
      let html = '<h2>THE OLD HOSPITAL ON COLLEGE HILL</h2>';
      html += '<p class="sub">Williamson, WV — opened 1928, closed 1988.</p>';
      html += '<h3>Objectives</h3><ul>';
      data.objectives.forEach((o) => {
        html += `<li class="${o.done ? 'done' : ''}">${o.done ? '✔' : '○'} <b>${o.title}</b> — <span class="hint">${o.hint}</span></li>`;
      });
      html += '</ul><h3>The Dead</h3><ul>';
      html += '<li><b>The Grey Nurse</b> — died in the ER after a crash on her way to work. Still walks her rounds.</li>';
      html += '<li><b>Mose Blackburn</b> — 1962, killed a lieutenant downtown, went out a third-floor window. Says he did not jump.</li>';
      html += '<li><b>The Child</b> — from the basement children’s ward. Does not want to be alone.</li>';
      html += '<li><b>The Ash</b> — what the incinerator kept. Do not open that door without cause.</li>';
      html += '</ul>';
      el.innerHTML = html + '<p class="tip">Tab to close.</p>';
      el.classList.add('show');
      if (state === 'PLAY') pause(true);
    } else {
      el.classList.remove('show');
      if (state === 'PAUSE') resumeGame();
    }
  }

  // ---------- state transitions ----------
  function pause(fromJournal) {
    if (state !== 'PLAY') return;
    state = 'PAUSE';
    cancelAnimationFrame(raf);
    Audio2.spiritStop(); spiritActive = false;
    Audio2.suspend();
    if (!fromJournal) document.getElementById('pausescreen').classList.add('show');
  }
  function resumeGame() {
    if (state !== 'PAUSE') return;
    document.getElementById('pausescreen').classList.remove('show');
    const jr = document.getElementById('journal'); if (jr) jr.classList.remove('show');
    journalOpen = false;
    state = 'PLAY';
    Audio2.resume();
    last = performance.now();
    loop(last);
  }
  function die() {
    if (state === 'DEAD') return;
    state = 'DEAD';
    cancelAnimationFrame(raf);
    Audio2.spiritStop();
    Audio2.stinger(true);
    setTimeout(() => Audio2.suspend(), 1600);
    const el = document.getElementById('deathscreen');
    document.getElementById('death-reason').textContent = deathBy;
    playLoreStatic('ending_bad', 'death-lore');
    el.classList.add('show');
  }
  function win() {
    if (state === 'WIN') return;
    state = 'WIN';
    cancelAnimationFrame(raf);
    Audio2.spiritStop();
    document.getElementById('winscreen').classList.add('show');
    playLoreStatic('ending_good', 'win-lore');
    // gentle fade of ambient
    setTimeout(() => Audio2.suspend(), 6000);
  }
  function playLoreStatic(key, elId) {
    const el = document.getElementById(elId);
    if (!el || !data) return;
    el.innerHTML = (data.LORE[key] || []).map((l) => `<p>${l}</p>`).join('');
  }

  function hideAllScreens() {
    ['startscreen', 'pausescreen', 'deathscreen', 'winscreen'].forEach((id) => {
      const el = document.getElementById(id); if (el) el.classList.remove('show');
    });
    const jr = document.getElementById('journal'); if (jr) jr.classList.remove('show');
    journalOpen = false;
  }

  // ---------- helpers ----------
  function normAng(a) { while (a > Math.PI) a -= 6.28318; while (a < -Math.PI) a += 6.28318; return a; }

  return { init, newGame };
})();

window.addEventListener('DOMContentLoaded', () => Game.init());
