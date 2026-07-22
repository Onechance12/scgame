#!/usr/bin/env node

// Regression checks for monster perception, navigation, and lifecycle behavior.
// Browser scripts are evaluated in an isolated VM so this validator exercises
// the same public window.Entities API used by the game without importing Node
// globals into the runtime code.

import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const worldPath = fileURLToPath(new URL('../js/world.js', import.meta.url));
const entitiesPath = fileURLToPath(new URL('../js/entities.js', import.meta.url));
const worldSource = fs.readFileSync(worldPath, 'utf8');
const entitiesSource = fs.readFileSync(entitiesPath, 'utf8');

const noop = () => {};
const sandbox = Object.create(null);
sandbox.window = Object.create(null);
sandbox.Audio2 = { dread: noop, laugh: noop, whisper: noop };

try {
  const context = vm.createContext(sandbox, {
    name: 'entity-movement-validator',
    codeGeneration: { strings: false, wasm: false },
  });
  const script = new vm.Script(
    `${worldSource}\n${entitiesSource}\n;window.__entityData = World.build();`,
    { filename: 'world-and-entities.js' },
  );
  script.runInContext(context, { timeout: 2500 });
} catch (err) {
  console.error(`FAIL: could not evaluate world/entity scripts safely: ${err.message}`);
  process.exit(1);
}

const World = sandbox.window.World;
const Entities = sandbox.window.Entities;
const data = sandbox.window.__entityData;
if (!World || !Entities || !data || !data.TILE || !Array.isArray(data.floors)) {
  console.error('FAIL: world.js/entities.js did not expose the expected runtime APIs');
  process.exit(1);
}

const requiredApi = ['Entity', 'spawnAll', 'lineOfSight', 'findPath'];
const missingApi = requiredApi.filter((name) => typeof Entities[name] !== 'function');
if (!Entities.S || missingApi.length) {
  const missing = [...missingApi, ...(!Entities.S ? ['S'] : [])];
  console.error(`FAIL: missing public Entities test hooks: ${missing.join(', ')}`);
  process.exit(1);
}

const { TILE } = data;
const failures = [];
const passes = [];

function check(name, run) {
  try {
    run();
    passes.push(name);
  } catch (err) {
    failures.push(`${name}: ${err && err.message ? err.message : String(err)}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function approx(actual, expected, epsilon, label) {
  expect(
    Math.abs(actual - expected) <= epsilon,
    `${label}: expected ${expected} +/- ${epsilon}, got ${actual}`,
  );
}

function makeGrid(fill = TILE.FLOOR) {
  const grid = Array.from({ length: data.H }, () => Array(data.W).fill(fill));
  for (let x = 0; x < data.W; x++) {
    grid[0][x] = TILE.WALL;
    grid[data.H - 1][x] = TILE.WALL;
  }
  for (let y = 0; y < data.H; y++) {
    grid[y][0] = TILE.WALL;
    grid[y][data.W - 1] = TILE.WALL;
  }
  return grid;
}

function makeWorld(grid) {
  return {
    floors: [{
      grid,
      rooms: [{
        tag: 'test', name: 'Test Room', x: 1, y: 1,
        w: data.W - 2, h: data.H - 2,
        cx: Math.floor(data.W / 2), cy: Math.floor(data.H / 2),
      }],
    }],
  };
}

function makeEntity(x, y, overrides = {}) {
  return new Entities.Entity({
    name: 'Regression Hunter', kind: 'nurse', floor: 0,
    x: x - 0.5, y: y - 0.5,
    speed: 3, huntSpeed: 3, hearing: 0, sight: 0,
    color: '#fff', wakeHour: 0, den: ['test'],
    ...overrides,
  });
}

function makePlayer(x, y, overrides = {}) {
  return { floor: 0, x, y, hidden: false, ...overrides };
}

function makeContext(overrides = {}) {
  return {
    hour: 24,
    diff: { speedMul: 1, senseMul: 1 },
    peace: false,
    noise: 0,
    playerLit: false,
    beamHits: () => false,
    onCatch: noop,
    ...overrides,
  };
}

// Keep the global runtime-door hook installed for every test. Individual tests
// replace its implementation when they need call counts or a closed fixture.
let doorHook = () => false;
sandbox.window.RuntimeDoorBlocked = (...args) => doorHook(...args);
let entityHook = () => false;
sandbox.window.RuntimeEntityBlocked = (...args) => entityHook(...args);
let entitySegmentHook = () => false;
sandbox.window.RuntimeEntitySegmentBlocked = (...args) => entitySegmentHook(...args);

check('continuous line of sight stays inside a narrow open column', () => {
  const grid = makeGrid();
  doorHook = () => false;
  const visible = Entities.lineOfSight(grid, 1.1, 1.12, 1.9, 4.3);
  expect(visible === true, 'an unobstructed fractional ray was reported blocked');
});

check('continuous line of sight visits every crossed wall cell', () => {
  const grid = makeGrid();
  grid[2][2] = TILE.WALL;
  doorHook = () => false;
  const visible = Entities.lineOfSight(grid, 1.1, 1.12, 2.1, 3.12);
  expect(visible === false, 'a fractional ray skipped wall cell (2,2)');
});

check('supercover line of sight cannot peek through a blocked corner', () => {
  const grid = makeGrid();
  grid[4][5] = TILE.WALL;
  doorHook = () => false;
  const visible = Entities.lineOfSight(grid, 4.5, 4.5, 6.5, 6.5);
  expect(visible === false, 'a diagonal ray ignored a wall touching its crossed corner');
});

check('runtime furniture occludes same-tile sight and catch rays', () => {
  const grid = makeGrid();
  doorHook = () => false;
  entitySegmentHook = (candidateGrid, x0, y0, x1, y1) => candidateGrid === grid &&
    Math.min(x0, x1) < 10.5 && Math.max(x0, x1) > 10.5 &&
    Math.max(Math.abs(y0 - 10.5), Math.abs(y1 - 10.5)) < 0.1;
  try {
    expect(Entities.lineOfSight(grid, 10.3, 10.5, 10.7, 10.5) === false,
      'same-tile LOS ignored the runtime furniture segment');
  } finally {
    entitySegmentHook = () => false;
  }
});

check('a HIDE endpoint is visible only when the caller confirms its occupant is exposed', () => {
  const grid = makeGrid();
  grid[5][7] = TILE.HIDE;
  doorHook = () => false;
  expect(Entities.lineOfSight(grid, 5.5, 5.5, 7.5, 5.5) === false,
    'default LOS made a hiding-space endpoint visible');
  expect(Entities.lineOfSight(grid, 5.5, 5.5, 7.5, 5.5, { allowEndpointHide: true }) === true,
    'an explicitly exposed HIDE occupant remained sight-invisible');
});

check('HIDE visibility distinguishes the exposed start from the hidden endpoint', () => {
  const grid = makeGrid();
  grid[5][5] = TILE.HIDE;
  grid[5][7] = TILE.HIDE;
  doorHook = () => false;
  expect(Entities.lineOfSight(grid, 5.5, 5.5, 6.5, 5.5, { allowStartHide: true }) === true,
    'an exposed light source could not see out of its HIDE start tile');
  expect(Entities.lineOfSight(grid, 5.5, 5.5, 7.5, 5.5, { allowStartHide: true }) === false,
    'allowStartHide also exposed a hidden HIDE endpoint');
  expect(Entities.lineOfSight(grid, 6.5, 5.5, 7.5, 5.5, { allowEndHide: true }) === true,
    'allowEndHide did not expose the requested target endpoint');
});

check('monster radius cannot clip the exact corner of a wall tile', () => {
  const grid = makeGrid();
  grid[6][6] = TILE.WALL;
  doorHook = () => false;
  entityHook = () => false;
  expect(Entities.walkableAt(grid, 5.999, 5.886, { radius: 0.16 }) === false,
    'circle clearance admitted a 0.16-radius body through a wall corner');
});

check('a hidden unlit player is not reacquired by dark proximity', () => {
  const grid = makeGrid();
  const world = makeWorld(grid);
  const entity = makeEntity(10.5, 10.5, { sight: 8 });
  entity.state = Entities.S.SEARCH;
  entity.cooldown = 3;
  entity.lastSeen = null;
  entity.target = null;
  doorHook = () => false;

  entity.update(
    1 / 60,
    world,
    makePlayer(11.2, 10.5, { hidden: true }),
    makeContext({ playerLit: false }),
  );

  expect(entity.state !== Entities.S.HUNT, 'dark proximity overrode the hidden-player rule');
});

check('an existing hunt searches the last visible entrance, not the hidden locker', () => {
  const grid = makeGrid();
  grid[10][11] = TILE.HIDE;
  const world = makeWorld(grid);
  const entity = makeEntity(7.5, 10.5, { sight: 8 });
  entity.state = Entities.S.HUNT;
  entity.cooldown = 2;
  entity.lastSeen = { x: 9.5, y: 10.5 };
  entity.path = null;
  entity.pathTimer = 0;
  doorHook = () => false;

  entity.update(
    1 / 60,
    world,
    makePlayer(11.5, 10.5, { hidden: true }),
    makeContext({ playerLit: false }),
  );

  expect(entity.pathGoalKey === '9,10', `hunt retargeted hidden tile ${entity.pathGoalKey}`);
  expect(entity.lastSeen.x === 9.5 && entity.lastSeen.y === 10.5,
    'lastSeen was overwritten after the player hid');
});

check('a hunt approaches a hidden HIDE target instead of freezing on its blocked centre', () => {
  const grid = makeGrid();
  grid[10][11] = TILE.HIDE;
  const world = makeWorld(grid);
  const entity = makeEntity(7.5, 10.5);
  entity.state = Entities.S.HUNT;
  entity.cooldown = 3;
  entity.lastSeen = { x: 11.5, y: 10.5 };
  entity.path = null;
  entity.pathTimer = 0;
  doorHook = () => false;

  entity.update(1 / 60, world, makePlayer(11.5, 10.5, { hidden: true }), makeContext());

  expect(Array.isArray(entity.path), 'HIDE-centre target produced no reachable investigation route');
  expect(entity.pathGoalKey === '11,10', `HIDE investigation changed goal to ${entity.pathGoalKey}`);
  expect(!entity.path.some((node) => Math.floor(node.x) === 11 && Math.floor(node.y) === 10),
    'investigation route entered the solid HIDE tile');
  const endpoint = entity.path[entity.path.length - 1];
  expect(endpoint && Math.hypot(endpoint.x - 11.5, endpoint.y - 10.5) <= 1.001,
    `HIDE investigation stopped ${endpoint ? Math.hypot(endpoint.x - 11.5, endpoint.y - 10.5).toFixed(3) : 'without an endpoint'} tiles from the locker`);
});

check('search lingers for its cooldown after reaching the last-seen point', () => {
  const grid = makeGrid();
  const entity = makeEntity(8.5, 8.5);
  entity.state = Entities.S.SEARCH;
  entity.cooldown = 5;
  entity.lastSeen = { x: 8.5, y: 8.5 };
  entity.path = null;
  entity.pathTimer = 0;
  doorHook = () => false;

  entity.update(1 / 60, makeWorld(grid), makePlayer(20.5, 20.5), makeContext());
  expect(entity.state === Entities.S.SEARCH, 'search ended on the arrival frame instead of lingering');
  expect(entity.cooldown > 4.9, `search cooldown collapsed to ${entity.cooldown}`);
});

check('abandoning an unreachable patrol target resets retry state', () => {
  const grid = makeGrid();
  const entity = makeEntity(8.5, 8.5);
  entity.state = Entities.S.PATROL;
  entity.target = null;
  entity.path = null;
  entity.pathFailures = 2;
  entity.pathTimer = 0.8;
  entity.pathGoalKey = 'stale';
  doorHook = () => false;

  entity.update(1 / 60, makeWorld(grid), makePlayer(20.5, 20.5), makeContext());
  expect(entity.pathFailures === 0 && entity.pathGoalKey !== 'stale' && Array.isArray(entity.path),
    `patrol retained stale retry state failures=${entity.pathFailures}, key=${entity.pathGoalKey}`);
});

check('an unreachable hunt target observes path retry backoff', () => {
  const grid = makeGrid();
  const barrierX = 12;
  const doorY = 10;
  for (let y = 1; y < data.H - 1; y++) grid[y][barrierX] = TILE.WALL;
  grid[doorY][barrierX] = TILE.DOOR;
  const world = makeWorld(grid);
  const entity = makeEntity(8.5, doorY + 0.5);
  const player = makePlayer(16.5, doorY + 0.5);
  entity.state = Entities.S.HUNT;
  entity.cooldown = 10;
  entity.path = null;
  entity.pathTimer = 0;

  let calls = 0;
  doorHook = (candidateGrid, x, y) => {
    const isClosedFixture = candidateGrid === grid
      && Math.floor(x) === barrierX && Math.floor(y) === doorY;
    if (isClosedFixture) calls++;
    return isClosedFixture;
  };

  entity.update(0.05, world, player, makeContext());
  const initialCalls = calls;
  calls = 0;
  entity.update(0.05, world, player, makeContext());
  const backoffCalls = calls;

  expect(initialCalls > 0, 'fixture did not exercise the closed-door search boundary');
  expect(
    backoffCalls === 0,
    `failed pathfinding retried immediately (${initialCalls} then ${backoffCalls} closed-door checks)`,
  );
});

function simulatePath(frameDt) {
  const grid = makeGrid();
  const entity = makeEntity(5.5, 6.5);
  entity.path = [];
  for (let x = 6; x <= 18; x++) entity.path.push({ x: x + 0.5, y: 6.5 });
  let idleStalls = 0;
  const frames = Math.round(1 / frameDt);
  for (let frame = 0; frame < frames; frame++) {
    const beforeX = entity.x;
    const hadRemainingRoute = Array.isArray(entity.path) && entity.path.length > 1;
    entity.followPath(grid, 3 * frameDt);
    if (hadRemainingRoute && Math.abs(entity.x - beforeX) < 1e-9) idleStalls++;
  }
  return { x: entity.x, idleStalls };
}

check('path following is frame-rate invariant and has no waypoint idle frame', () => {
  doorHook = () => false;
  const lowRate = simulatePath(1 / 10);
  const highRate = simulatePath(1 / 90);
  const expectedX = 8.5;

  approx(lowRate.x, expectedX, 0.03, '10 Hz endpoint');
  approx(highRate.x, expectedX, 0.03, '90 Hz endpoint');
  expect(
    Math.abs(lowRate.x - highRate.x) <= 0.03,
    `endpoints diverged by ${Math.abs(lowRate.x - highRate.x).toFixed(4)} tiles`,
  );
  expect(lowRate.idleStalls === 0, `${lowRate.idleStalls} low-rate frames stalled at waypoints`);
  expect(highRate.idleStalls === 0, `${highRate.idleStalls} high-rate frames stalled at waypoints`);
});

function simulateMetreHunt(frameDt, motionScale = 1, options = {}) {
  const grid = makeGrid();
  const world = makeWorld(grid);
  const entity = makeEntity(5.5, 6.5, {
    huntSpeed: Number.isFinite(options.huntSpeed) ? options.huntSpeed : 2.7,
    sight: 0,
    hearing: 0,
  });
  const player = makePlayer(20.5, 6.5);
  entity.state = Entities.S.HUNT;
  entity.cooldown = 10;
  entity.lastSeen = { x: player.x, y: player.y };
  entity.path = null;
  entity.pathTimer = 0;
  doorHook = () => false;
  const ctx = makeContext({
    tileMetres: options.tileMetres === false ? undefined : 2.7,
    motionScale,
    diff: { speedMul: Number.isFinite(options.speedMul) ? options.speedMul : 1, senseMul: 1 },
  });
  const frames = Math.round(1 / frameDt);
  for (let i = 0; i < frames; i++) entity.update(frameDt, world, player, ctx);
  return entity;
}

check('metre-authored hunt speed is frame-rate invariant and movement-only scaled', () => {
  const lowRate = simulateMetreHunt(1 / 10);
  const highRate = simulateMetreHunt(1 / 90);
  const blessed = simulateMetreHunt(1 / 60, 0.5);
  approx(lowRate.x - 5.5, 1, 0.035, '10 Hz physical displacement');
  approx(highRate.x - 5.5, 1, 0.035, '90 Hz physical displacement');
  approx(blessed.x - 5.5, 0.5, 0.035, 'movement-scaled displacement');
  approx(lowRate.cooldown, 9, 0.001, '10 Hz hunt cooldown');
  approx(blessed.cooldown, 9, 0.001, 'movement-scaled hunt cooldown');
});

check('authored hunt tiers pressure walking players without beating base sprint', () => {
  const expected = new Map([
    ['The Grey Nurse', 4.7], ['Mose Blackburn', 5.0], ['The Child', 4.4],
    ['The Ash', 4.0], ['The Crawler', 5.6], ['Night Nurse', 4.8],
    ['The Ghoul', 5.0], ['The Risen', 4.6], ['The Nightmare', 4.5],
    ['The Wraith', 4.2], ['The Other', 5.6],
  ]);
  const cast = Entities.spawnAll(data, { extra: true });
  expect(cast.length === expected.size, `expected ${expected.size} hunters, got ${cast.length}`);
  for (const entity of cast) {
    expect(expected.has(entity.name), `unexpected hunter ${entity.name}`);
    approx(entity.huntSpeed, expected.get(entity.name), 0.000001, `${entity.name} hunt tier`);
    expect(entity.huntSpeed > 3.4, `${entity.name} cannot close on a 3.4 m/s walking player`);
    expect(entity.huntSpeed < 6.2, `${entity.name} beats the player's 6.2 m/s base sprint`);
  }
});

check('late-game difficulty scaling respects the sprint panic ceiling', () => {
  const cast = Entities.spawnAll(data, { extra: true });
  let fastest = 0;
  for (const source of cast) {
    const entity = simulateMetreHunt(1 / 240, 1, { huntSpeed: source.huntSpeed, speedMul: 1.5 });
    const travelledMetres = (entity.x - 5.5) * 2.7;
    fastest = Math.max(fastest, travelledMetres);
    expect(travelledMetres <= 6.2 * 1.05 + 0.015,
      `${source.name} reached ${travelledMetres.toFixed(3)} m/s at maximum difficulty`);
    expect(travelledMetres > 3.4,
      `${source.name} fell below walking pressure at maximum difficulty (${travelledMetres.toFixed(3)} m/s)`);
  }
  approx(fastest, 6.45, 0.015, 'maximum scaled hunt speed');
});

check('flat shell hunt scaling stays below its tile-speed sprint', () => {
  const cast = Entities.spawnAll(data, { extra: true });
  let fastest = 0;
  for (const source of cast) {
    const entity = simulateMetreHunt(1 / 240, 1, {
      huntSpeed: source.huntSpeed,
      speedMul: 1.5,
      tileMetres: false,
    });
    const travelledTiles = entity.x - 5.5;
    fastest = Math.max(fastest, travelledTiles);
    expect(travelledTiles > 3.4,
      `${source.name} cannot close on the flat shell's walking player (${travelledTiles.toFixed(3)} tiles/s)`);
    expect(travelledTiles < 6.0,
      `${source.name} beats the flat shell's sprint (${travelledTiles.toFixed(3)} tiles/s)`);
  }
  approx(fastest, 5.85, 0.015, 'maximum flat-shell hunt speed');
});

check('maximum-difficulty infested cast stays stable for 120 simulated seconds', () => {
  const cast = Entities.spawnAll(data, { extra: true });
  const dt = 1 / 90;
  const frames = 120 * 90;
  doorHook = () => false;
  entityHook = () => false;
  entitySegmentHook = () => false;

  for (const entity of cast) entity.awake();
  for (let frame = 0; frame < frames; frame++) {
    const targetPhase = Math.floor(frame / (15 * 90));
    for (let i = 0; i < cast.length; i++) {
      const entity = cast[i];
      const rooms = data.floors[entity.floor].rooms;
      const room = rooms[(targetPhase + i) % rooms.length];
      const player = makePlayer(room.cx + 0.5, room.cy + 0.5, { floor: entity.floor });
      entity.state = Entities.S.HUNT;
      entity.cooldown = 4;
      entity.lastSeen = { x: player.x, y: player.y };
      entity.update(dt, data, player, makeContext({
        hour: 24,
        tileMetres: 2.7,
        diff: { speedMul: 1.5, senseMul: 1.22 },
        noise: 1,
      }));
    }
    Entities.resolveOverlaps(cast, data, dt);
  }

  expect(cast.length === 11, `expected 11 infested hunters, got ${cast.length}`);
  for (const entity of cast) {
    expect(Number.isFinite(entity.x) && Number.isFinite(entity.y), `${entity.name} produced a non-finite position`);
    expect(entity.passable(data.floors[entity.floor].grid, entity.x, entity.y),
      `${entity.name} finished the stress run inside blocked geometry`);
  }
});

check('motion animation flags use speed rather than per-frame displacement', () => {
  for (const hz of [60, 120]) {
    const entity = makeEntity(5.5, 5.5);
    const dt = 1 / hz;
    entity.px = entity.x; entity.py = entity.y;
    entity.x += 0.12 * dt;
    entity.commitMotion(dt);
    expect(entity.moving === true, `${hz} Hz marked a 0.12 tile/s move idle`);
    approx(entity.motionSpeed, 0.12, 0.000001, `${hz} Hz motion speed`);
  }
});

check('successful static patrol routes are retained instead of periodically rebuilt', () => {
  const grid = makeGrid();
  const world = makeWorld(grid);
  const entity = makeEntity(5.5, 8.5, { speed: 0.7 });
  entity.state = Entities.S.PATROL;
  entity.target = { x: 30.5, y: 8.5 };
  entity.path = null; entity.pathTimer = 0;
  doorHook = () => false;
  const player = makePlayer(35.5, 20.5, { hidden: true });
  const ctx = makeContext();

  entity.update(1 / 60, world, player, ctx);
  const route = entity.path;
  expect(Array.isArray(route) && route.length > 5, 'patrol fixture did not create a retained route');
  for (let i = 0; i < 45; i++) entity.update(1 / 60, world, player, ctx);
  expect(entity.path === route, 'static patrol route was rebuilt after its refresh timer elapsed');
});

check('direct movement clamps to a nearby target without overshooting', () => {
  const grid = makeGrid();
  const entity = makeEntity(5.5, 5.5);
  doorHook = () => false;
  entity.moveDirect(grid, 5.7, 5.5, 1);

  expect(entity.x <= 5.700001, `movement overshot target x=5.7 and ended at x=${entity.x}`);
  approx(entity.x, 5.7, 0.000001, 'clamped x position');
  approx(entity.y, 5.5, 0.000001, 'clamped y position');
});

check('direct/knockback movement sweeps intervening wall cells', () => {
  const grid = makeGrid();
  grid[5][6] = TILE.WALL;
  const entity = makeEntity(5.5, 5.5);
  doorHook = () => false;
  entity.moveDirect(grid, 8.5, 5.5, 3);

  expect(entity.x < 6, `movement tunneled through wall cell (6,5) to x=${entity.x}`);
  expect(Math.floor(entity.y) === 5, `wall response displaced entity into row ${Math.floor(entity.y)}`);
});

check('a hunt path approaches a closed unlocked door and waits for its leaf', () => {
  const grid = makeGrid();
  const barrierX = 12, doorY = 10;
  for (let y = 1; y < data.H - 1; y++) grid[y][barrierX] = TILE.WALL;
  grid[doorY][barrierX] = TILE.DOOR;
  let closed = true;
  doorHook = (candidateGrid, x, y, mode) => candidateGrid === grid &&
    Math.floor(x) === barrierX && Math.floor(y) === doorY && closed && mode !== 'hunt-path';

  const path = Entities.findPath(grid, 8.5, doorY + 0.5, 16.5, doorY + 0.5, {
    radius: 0.16, allowClosedDoors: true,
  });
  expect(Array.isArray(path), 'hunt planning treated an unlocked leaf as a permanent barrier');
  expect(path.some((node) => Math.floor(node.x) === barrierX && Math.floor(node.y) === doorY),
    'hunt route did not lead the monster up to the closed leaf');

  const entity = makeEntity(8.5, doorY + 0.5);
  entity.path = path;
  for (let i = 0; i < 180; i++) entity.followPath(grid, 0.05);
  expect(entity.x < barrierX, `physical movement crossed the still-closed leaf to x=${entity.x}`);
  expect(entity.path.length > 0, 'blocked route was discarded instead of waiting at the leaf');

  closed = false;
  for (let i = 0; i < 240 && entity.path.length; i++) entity.followPath(grid, 0.05);
  approx(entity.x, 16.5, 0.001, 'post-burst route endpoint');
});

check('runtime furniture participates in pathfinding and swept movement', () => {
  const grid = makeGrid();
  doorHook = () => false;
  entityHook = (candidateGrid, x, y, radius) => {
    if (candidateGrid !== grid) return false;
    const cx = 6.5, cy = 5.5;
    return Math.abs(x - cx) < 0.32 + radius && Math.abs(y - cy) < 0.32 + radius;
  };
  try {
    const path = Entities.findPath(grid, 5.5, 5.5, 8.5, 5.5, { radius: 0.16 });
    expect(Array.isArray(path), 'a route around one furniture collider was not found');
    expect(!path.some((node) => Math.floor(node.x) === 6 && Math.floor(node.y) === 5),
      'BFS routed through the furniture footprint');

    const entity = makeEntity(5.5, 5.5);
    entity.moveDirect(grid, 8.5, 5.5, 3);
    expect(entity.x < 6.05, `swept movement entered the furniture footprint at x=${entity.x}`);
  } finally {
    entityHook = () => false;
  }
});

check('BFS rejects a furniture-blocked edge even when both tile centres are clear', () => {
  const grid = makeGrid();
  doorHook = () => false;
  entityHook = () => false;
  entitySegmentHook = (candidateGrid, x0, y0, x1, y1) => {
    if (candidateGrid !== grid) return false;
    const crossesX = Math.min(x0, x1) < 6 && Math.max(x0, x1) > 6;
    return crossesX && Math.max(Math.abs(y0 - 5.5), Math.abs(y1 - 5.5)) < 0.1;
  };
  try {
    const path = Entities.findPath(grid, 5.5, 5.5, 8.5, 5.5, { radius: 0.16 });
    expect(Array.isArray(path), 'edge obstacle prevented every route instead of routing around');
    expect(!(path[0] && Math.floor(path[0].x) === 6 && Math.floor(path[0].y) === 5),
      'BFS accepted the blocked centre-to-centre edge');
  } finally {
    entitySegmentHook = () => false;
  }
});

check('a player-safe edge of a cluttered tile gets a reachable hunt approach', () => {
  const grid = makeGrid();
  const world = makeWorld(grid);
  const entity = makeEntity(6.5, 10.5, { sight: 12 });
  const player = makePlayer(10.86, 10.14);
  entity.state = Entities.S.HUNT;
  entity.cooldown = 3;
  entity.lastSeen = { x: player.x, y: player.y };
  doorHook = () => false;
  entityHook = (candidateGrid, x, y, radius) => candidateGrid === grid &&
    Math.abs(x - 10.5) < 0.18 + radius && Math.abs(y - 10.5) < 0.18 + radius;
  entitySegmentHook = (candidateGrid, x0, y0, x1, y1, radius) => {
    if (candidateGrid !== grid) return false;
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (entityHook(grid, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius)) return true;
    }
    return false;
  };
  try {
    expect(entityHook(grid, player.x, player.y, entity.radius) === false,
      'fixture player point is not actually clear');
    entity.update(1 / 60, world, player, makeContext({ playerLit: true }));
    expect(Array.isArray(entity.path), 'clear fractional player point produced a null hunt path');
    expect(entity.path.length > 0, 'hunt did not select an approach route');
    expect(entity.x > 6.5, 'hunter remained frozen instead of starting its approach');
  } finally {
    entityHook = () => false;
    entitySegmentHook = () => false;
  }
});

check('approach routing bypasses an internal prop divider between two clear points', () => {
  const grid = makeGrid();
  const solid = { x0: 10.67, y0: 10.1, x1: 10.72, y1: 10.9 };
  const radius = 0.16;
  const pointBlocked = (x, y, r = radius) => {
    const cx = Math.max(solid.x0, Math.min(x, solid.x1));
    const cy = Math.max(solid.y0, Math.min(y, solid.y1));
    return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  };
  entityHook = (candidateGrid, x, y, r) => candidateGrid === grid && pointBlocked(x, y, r);
  entitySegmentHook = (candidateGrid, x0, y0, x1, y1, r) => {
    if (candidateGrid !== grid) return false;
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (pointBlocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return true;
    }
    return false;
  };
  try {
    expect(!pointBlocked(10.5, 10.5) && !pointBlocked(10.9, 10.5),
      'divider fixture endpoints are not both clear');
    const path = Entities.findPath(grid, 6.5, 10.5, 10.9, 10.5, {
      radius, nearestReachable: true,
    });
    expect(Array.isArray(path) && path.length > 0, 'divider fixture produced no approach route');
    const end = path[path.length - 1];
    expect(Math.floor(end.x) === 11 && !entitySegmentHook(grid, end.x, end.y, 10.9, 10.5, radius),
      `route stopped at blocked-side approach ${end.x},${end.y} instead of circling to the clear side`);

    const sameTilePath = Entities.findPath(grid, 10.5, 10.5, 10.9, 10.5, {
      radius, nearestReachable: true,
    });
    expect(Array.isArray(sameTilePath) && sameTilePath.length > 0,
      'same-tile divider incorrectly used the direct empty-path shortcut');
    const sameTileEnd = sameTilePath[sameTilePath.length - 1];
    expect(Math.floor(sameTileEnd.x) === 11 &&
      !entitySegmentHook(grid, sameTileEnd.x, sameTileEnd.y, 10.9, 10.5, radius),
      `same-tile divider did not route around to the clear side (${sameTileEnd.x},${sameTileEnd.y})`);
  } finally {
    entityHook = () => false;
    entitySegmentHook = () => false;
  }
});

check('a clear fractional start escapes when its own tile centre is furniture-blocked', () => {
  const grid = makeGrid();
  const solid = { x0: 10.28, y0: 10.28, x1: 10.72, y1: 10.72 };
  const radius = 0.16;
  const pointBlocked = (x, y, r = radius) => {
    const cx = Math.max(solid.x0, Math.min(x, solid.x1));
    const cy = Math.max(solid.y0, Math.min(y, solid.y1));
    return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  };
  entityHook = (candidateGrid, x, y, r) => candidateGrid === grid && pointBlocked(x, y, r);
  entitySegmentHook = (candidateGrid, x0, y0, x1, y1, r) => {
    if (candidateGrid !== grid) return false;
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      if (pointBlocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return true;
    }
    return false;
  };
  try {
    const start = { x: 10.9, y: 10.1 };
    expect(!pointBlocked(start.x, start.y), 'fractional start fixture is not clear');
    expect(pointBlocked(10.5, 10.5), 'start tile centre fixture is not blocked');
    const path = Entities.findPath(grid, start.x, start.y, 15.5, 10.5, {
      radius, nearestReachable: true,
    });
    expect(Array.isArray(path) && path.length > 0,
      'BFS could not anchor a route from the clear edge of a centre-blocked tile');
    expect(!pointBlocked(path[0].x, path[0].y), 'escape route seeded itself inside furniture');
  } finally {
    entityHook = () => false;
    entitySegmentHook = () => false;
  }
});

check('a locally clear but graph-isolated goal centre uses a reachable direct approach', () => {
  const grid = makeGrid();
  const target = { x: 10.72, y: 10.72 };
  const centre = { x: 10.5, y: 10.5 };
  const isPoint = (x, y, p) => Math.abs(x - p.x) < 1e-6 && Math.abs(y - p.y) < 1e-6;
  const isCardinal = (x, y) =>
    (Math.abs(x - centre.x) < 1e-6 && Math.abs(Math.abs(y - centre.y) - 1) < 1e-6) ||
    (Math.abs(y - centre.y) < 1e-6 && Math.abs(Math.abs(x - centre.x) - 1) < 1e-6);
  entityHook = () => false;
  entitySegmentHook = (candidateGrid, x0, y0, x1, y1) => candidateGrid === grid &&
    ((isPoint(x0, y0, centre) && isCardinal(x1, y1)) ||
     (isPoint(x1, y1, centre) && isCardinal(x0, y0)));
  try {
    const path = Entities.findPath(grid, 15.5, 10.5, target.x, target.y, {
      radius: 0.16, nearestReachable: true,
    });
    expect(Array.isArray(path) && path.length > 0, 'isolated clear centre produced no approach route');
    const endpoint = path[path.length - 1];
    expect(!isPoint(endpoint.x, endpoint.y, centre), 'route entered the graph-isolated target centre');
    expect(!entitySegmentHook(grid, endpoint.x, endpoint.y, target.x, target.y, 0.16),
      `fallback endpoint ${endpoint.x},${endpoint.y} cannot directly close to the target`);
  } finally {
    entityHook = () => false;
    entitySegmentHook = () => false;
  }
});

check('a blocked direct close invalidates its stale same-tile approach', () => {
  const grid = makeGrid();
  const world = makeWorld(grid);
  const entity = makeEntity(10.5, 10.5);
  const player = makePlayer(10.9, 10.5);
  entity.state = Entities.S.HUNT;
  entity.cooldown = 3;
  entity.lastSeen = { x: player.x, y: player.y };
  entity.path = [];
  entity.pathGoalKey = '10,10';
  entityHook = (candidateGrid, x, y, radius) => candidateGrid === grid &&
    Math.abs(x - 10.68) < radius && Math.abs(y - 10.5) < 0.25 + radius;
  entitySegmentHook = (candidateGrid, x0, y0, x1, y1, radius) => {
    if (candidateGrid !== grid) return false;
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      if (entityHook(grid, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius)) return true;
    }
    return false;
  };
  try {
    entity.update(1 / 60, world, player, makeContext());
    expect(entity.path === null, 'blocked direct close retained an empty stale route');
    entity.update(0.84, world, player, makeContext());
    entity.update(0.02, world, player, makeContext());
    expect(Array.isArray(entity.path) && entity.path.length > 0,
      'hunter did not plan an around-furniture route after direct-close backoff');
  } finally {
    entityHook = () => false;
    entitySegmentHook = () => false;
  }
});

check('dormant entities clear stale render motion and visibility state', () => {
  const grid = makeGrid();
  const entity = makeEntity(5.5, 5.5, { wakeHour: 12 });
  entity.state = Entities.S.DORMANT;
  entity.alpha = 1;
  entity.moving = true;
  entity.fast = true;
  entity.staring = true;
  doorHook = () => false;

  entity.update(
    1 / 60,
    makeWorld(grid),
    makePlayer(20.5, 20.5),
    makeContext({ hour: 2, peace: true }),
  );

  expect(entity.state === Entities.S.DORMANT, 'entity woke before its wake hour');
  expect(entity.alpha <= 0.000001, `dormant entity retained alpha=${entity.alpha}`);
  expect(entity.moving === false, 'dormant entity retained a moving animation flag');
  expect(entity.fast === false, 'dormant entity retained a fast animation flag');
  expect(entity.staring === false, 'dormant entity retained a staring flag');
});

check('sleep returns scripted travelers home and clears transient combat state', () => {
  const entity = makeEntity(5.5, 5.5);
  entity.floor = 3; entity.x = 18.5; entity.y = 19.5;
  entity.warded = 2; entity.slow = 3; entity.pause = 4; entity.cooldown = 5;
  entity.path = [{ x: 19.5, y: 19.5 }];
  entity.sleep();
  expect(entity.floor === entity.homeFloor && entity.x === entity.homeX && entity.y === entity.homeY,
    'sleep left a scripted traveler on its transferred floor');
  expect(entity.warded === 0 && entity.slow === 0 && entity.pause === 0 && entity.cooldown === 0,
    'sleep retained transient chase/combat timers');
});

check('cross-floor return home does not create a teleport velocity spike', () => {
  const grid = makeGrid();
  const floor = makeWorld(grid).floors[0];
  const world = { floors: [floor, floor] };
  const entity = makeEntity(5.5, 5.5);
  entity.floor = 1; entity.x = 20.5; entity.y = 15.5;
  entity.state = Entities.S.SEARCH;
  entity.lastSeen = { x: entity.x, y: entity.y };
  entity.cooldown = 0.001;
  entity.path = [];
  entity.pathGoalKey = '20,15';
  doorHook = () => false;

  entity.update(0.02, world, makePlayer(30.5, 20.5, { floor: 1, hidden: true }), makeContext());

  expect(entity.floor === entity.homeFloor && entity.x === entity.homeX && entity.y === entity.homeY,
    'search expiry did not return the traveler home');
  expect(entity.moving === false && entity.motionSpeed === 0 && entity.velocityX === 0 && entity.velocityY === 0,
    `return-home teleport leaked motion speed=${entity.motionSpeed}`);
});

check('one-time spawn reconciliation persists a safe home across sleep and wake', () => {
  const grid = makeGrid();
  const world = makeWorld(grid);
  const entity = makeEntity(5.5, 5.5);
  entityHook = (candidateGrid, x, y, radius) => candidateGrid === grid &&
    Math.abs(x - 5.5) < 0.25 + radius && Math.abs(y - 5.5) < 0.25 + radius;
  try {
    expect(entity.ensureWalkable(grid), 'blocked authored home had no safe relocation');
    expect(entity.homeX === entity.x && entity.homeY === entity.y,
      'safe initial relocation was not persisted as the entity home');
    entity.sleep();
    entity.update(1 / 60, world, makePlayer(20.5, 20.5, { hidden: true }), makeContext());
    expect(entity.passable(grid, entity.x, entity.y), 'sleep/wake returned the entity into blocked furniture');
  } finally {
    entityHook = () => false;
  }
});

check('infested spawns maintain same-floor separation', () => {
  const entities = Entities.spawnAll(data, { extra: true });
  expect(Array.isArray(entities) && entities.length > 1, 'spawnAll returned no usable cast');

  let nearest = null;
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      if (a.floor !== b.floor) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (!nearest || distance < nearest.distance) nearest = { a, b, distance };
    }
  }

  expect(nearest, 'no same-floor spawn pair was available for validation');
  expect(
    nearest.distance >= 0.75,
    `${nearest.a.name} and ${nearest.b.name} overlap at spawn (${nearest.distance.toFixed(3)} tiles apart)`,
  );
});

check('runtime separation resolves exact same-position body stacking', () => {
  const grid = makeGrid();
  const world = makeWorld(grid);
  const a = makeEntity(8.5, 8.5);
  const b = makeEntity(8.5, 8.5);
  a.state = Entities.S.HUNT; b.state = Entities.S.HUNT;
  a.px = a.x; a.py = a.y; b.px = b.x; b.py = b.y;
  doorHook = () => false;

  Entities.resolveOverlaps([a, b], world, 1 / 60);
  const firstFrameDistance = Math.hypot(a.x - b.x, a.y - b.y);
  expect(firstFrameDistance <= 0.07,
    `body separation visibly popped ${firstFrameDistance.toFixed(4)} tiles in one frame`);
  for (let i = 0; i < 30; i++) Entities.resolveOverlaps([a, b], world, 1 / 60);
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const desired = a.radius + b.radius + 0.04;
  expect(distance >= desired - 0.001 && distance <= desired + 0.01,
    `body separation settled at ${distance.toFixed(4)} instead of ${desired.toFixed(4)} tiles`);
  expect(a.passable(grid, a.x, a.y) && b.passable(grid, b.x, b.y),
    'body separation pushed a monster into blocked space');
});

check('body separation settles consistently across frame rates', () => {
  const grid = makeGrid();
  const world = makeWorld(grid);
  const desired = 0.16 + 0.16 + 0.04;
  for (const hz of [10, 60, 240]) {
    const a = makeEntity(8.5, 8.5);
    const b = makeEntity(8.5, 8.5);
    a.state = Entities.S.HUNT; b.state = Entities.S.HUNT;
    const dt = 1 / hz, frames = Math.ceil(0.25 / dt);
    for (let i = 0; i < frames; i++) Entities.resolveOverlaps([a, b], world, dt);
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    expect(Math.abs(distance - desired) <= 0.005,
      `${hz} Hz separation settled at ${distance.toFixed(4)} instead of ${desired.toFixed(4)}`);
  }
});

if (failures.length) {
  failures.forEach((message) => console.error(`FAIL: ${message}`));
  console.error(`entity movement regressions: ${passes.length} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`entity movement regressions OK: ${passes.length} checks passed`);
}
