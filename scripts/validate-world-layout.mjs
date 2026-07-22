#!/usr/bin/env node

// Validate the deterministic hospital layout without importing browser runtime
// code. world.js is evaluated in an isolated VM context with no Node globals;
// dynamic code generation is disabled and evaluation is time-limited.

import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const worldPath = fileURLToPath(new URL('../js/world.js', import.meta.url));
const source = fs.readFileSync(worldPath, 'utf8');
const sandbox = Object.create(null);
sandbox.window = Object.create(null);

try {
  const context = vm.createContext(sandbox, {
    name: 'world-layout-validator',
    codeGeneration: { strings: false, wasm: false },
  });
  const script = new vm.Script(
    `${source}\n;window.__validationData = window.World.build();`,
    { filename: worldPath },
  );
  script.runInContext(context, { timeout: 2000 });
} catch (err) {
  console.error(`FAIL: could not evaluate js/world.js safely: ${err.message}`);
  process.exit(1);
}

const World = sandbox.window.World;
const data = sandbox.window.__validationData;
if (!World || !data || !data.TILE || !Array.isArray(data.floors)) {
  console.error('FAIL: js/world.js did not expose a valid World.build() result');
  process.exit(1);
}

let failureCount = 0;
const failureMessages = [];
const fail = (scope, message) => {
  failureCount++;
  if (failureMessages.length < 100) failureMessages.push(`FAIL: ${scope}: ${message}`);
};

const { TILE } = data;
const W = data.W;
const H = data.H;
const corridorTop = data.CORR_TOP;
const corridorBottom = data.CORR_BOT;
const tileEntries = Object.entries(TILE);
const allowedTiles = new Set(tileEntries.map(([, value]) => value));
const tileName = new Map(tileEntries.map(([name, value]) => [value, name]));
const labelTile = (value) => tileName.get(value) || String(value);
const key = (x, y) => `${x},${y}`;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const cardinal = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isWalkable = (value) => allowedTiles.has(value) && value !== TILE.VOID && value !== TILE.WALL;

if (!Number.isInteger(W) || W < 3 || !Number.isInteger(H) || H < 3) {
  console.error(`FAIL: invalid declared grid dimensions ${W}x${H}`);
  process.exit(1);
}
if (World.W !== W || World.H !== H) {
  fail('world', `World dimensions ${World.W}x${World.H} disagree with build result ${W}x${H}`);
}
if (!Number.isInteger(corridorTop) || !Number.isInteger(corridorBottom)
    || corridorTop < 1 || corridorBottom >= H - 1 || corridorTop > corridorBottom) {
  console.error(`FAIL: invalid corridor bounds ${corridorTop}..${corridorBottom}`);
  process.exit(1);
}

const stats = {
  floors: data.floors.length,
  rooms: 0,
  tiles: 0,
  walkable: 0,
  doors: 0,
  lockedDoors: 0,
  up: 0,
  down: 0,
  exits: 0,
  hides: 0,
  connectedRooms: 0,
};
const floorSpecialCounts = [];

function flood(grid, start) {
  if (!start || !isWalkable(grid[start.y][start.x])) return new Set();
  const seen = new Set([key(start.x, start.y)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const [dx, dy] of cardinal) {
      const x = current.x + dx;
      const y = current.y + dy;
      const id = key(x, y);
      if (!inBounds(x, y) || seen.has(id) || !isWalkable(grid[y][x])) continue;
      seen.add(id);
      queue.push({ x, y });
    }
  }
  return seen;
}

function roomAt(rooms, x, y, interiorOnly = false) {
  return rooms.find((room) => {
    if (!room || !Number.isInteger(room.x) || !Number.isInteger(room.y)
        || !Number.isInteger(room.w) || !Number.isInteger(room.h)) return false;
    const inset = interiorOnly ? 1 : 0;
    return x >= room.x + inset && x < room.x + room.w - inset
      && y >= room.y + inset && y < room.y + room.h - inset;
  });
}

data.floors.forEach((floor, floorIndex) => {
  const scope = `floor ${floorIndex}${floor && floor.name ? ` (${floor.name})` : ''}`;
  const grid = floor && floor.grid;
  const rooms = floor && Array.isArray(floor.rooms) ? floor.rooms : [];
  if (!floor || !Array.isArray(floor.rooms)) fail(scope, 'rooms is not an array');
  stats.rooms += rooms.length;

  if (!Array.isArray(grid)) {
    fail(scope, 'grid is not an array');
    return;
  }
  if (grid.length !== H) fail(scope, `grid has ${grid.length} rows; expected ${H}`);
  let rectangular = grid.length === H;
  for (let y = 0; y < grid.length; y++) {
    if (!Array.isArray(grid[y])) {
      fail(scope, `row ${y} is not an array`);
      rectangular = false;
    } else if (grid[y].length !== W) {
      fail(scope, `row ${y} has width ${grid[y].length}; expected ${W}`);
      rectangular = false;
    }
  }
  if (!rectangular) return;
  stats.tiles += W * H;

  const walkableCells = [];
  const corridorCells = new Set();
  const special = { up: 0, down: 0, exits: 0, hides: 0 };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const value = grid[y][x];
      const cellScope = `${scope} tile (${x},${y})`;
      if (!Number.isInteger(value) || !allowedTiles.has(value)) {
        fail(cellScope, `unknown tile value ${String(value)}`);
        continue;
      }

      const perimeter = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      if (perimeter && value !== TILE.VOID) {
        fail(cellScope, `perimeter must be VOID, found ${labelTile(value)}`);
      }

      if (isWalkable(value)) {
        stats.walkable++;
        walkableCells.push({ x, y });
        if (y >= corridorTop && y <= corridorBottom) corridorCells.add(key(x, y));

        const adjacent = cardinal.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
        if (!adjacent.some((n) => inBounds(n.x, n.y) && isWalkable(grid[n.y][n.x]))) {
          fail(cellScope, `${labelTile(value)} is an isolated walkable tile`);
        }
      }

      if (value === TILE.DOOR || value === TILE.LOCKED) {
        stats.doors++;
        if (value === TILE.LOCKED) stats.lockedDoors++;
        const horizontal = inBounds(x - 1, y) && inBounds(x + 1, y)
          && isWalkable(grid[y][x - 1]) && isWalkable(grid[y][x + 1]);
        const vertical = inBounds(x, y - 1) && inBounds(x, y + 1)
          && isWalkable(grid[y - 1][x]) && isWalkable(grid[y + 1][x]);
        if (!horizontal && !vertical) {
          fail(cellScope, `${labelTile(value)} opens into WALL/VOID on at least one side of every axis`);
        }
      }

      if (value === TILE.UP) { stats.up++; special.up++; }
      if (value === TILE.DOWN) { stats.down++; special.down++; }
      if (value === TILE.EXIT) { stats.exits++; special.exits++; }
      if (value === TILE.HIDE) { stats.hides++; special.hides++; }
    }
  }
  floorSpecialCounts.push(special);

  if (walkableCells.length) {
    const reachable = flood(grid, walkableCells[0]);
    if (reachable.size !== walkableCells.length) {
      fail(scope, `${walkableCells.length - reachable.size} of ${walkableCells.length} walkable tiles are disconnected`);
    }
  } else {
    fail(scope, 'contains no walkable tiles');
  }

  if (!corridorCells.size) fail(scope, 'corridor band contains no walkable tiles');

  const occupiedRoomCells = new Map();
  const declaredDoorCells = new Map();
  rooms.forEach((room, roomIndex) => {
    const roomName = room && (room.name || room.tag) ? (room.name || room.tag) : `#${roomIndex}`;
    const roomScope = `${scope} room ${roomName}`;
    const fields = ['x', 'y', 'w', 'h', 'cx', 'cy', 'doorX', 'doorY'];
    if (!room || fields.some((field) => !Number.isInteger(room[field]))) {
      fail(roomScope, `room metadata must contain integer ${fields.join('/')}`);
      return;
    }
    if (room.w < 3 || room.h < 3 || room.x < 1 || room.y < 1
        || room.x + room.w > W - 1 || room.y + room.h > H - 1) {
      fail(roomScope, `rectangle (${room.x},${room.y}) ${room.w}x${room.h} is outside safe grid bounds`);
      return;
    }

    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const id = key(x, y);
        if (grid[y][x] === TILE.VOID) fail(roomScope, `footprint contains VOID at (${x},${y})`);
        const owner = occupiedRoomCells.get(id);
        if (owner) fail(roomScope, `overlaps room ${owner} at (${x},${y})`);
        else occupiedRoomCells.set(id, roomName);
      }
    }

    if (room.cx <= room.x || room.cx >= room.x + room.w - 1
        || room.cy <= room.y || room.cy >= room.y + room.h - 1) {
      fail(roomScope, `center (${room.cx},${room.cy}) is not in the room interior`);
    } else if (!isWalkable(grid[room.cy][room.cx])) {
      fail(roomScope, `center (${room.cx},${room.cy}) is ${labelTile(grid[room.cy][room.cx])}, not walkable`);
    }

    if (!inBounds(room.doorX, room.doorY)) {
      fail(roomScope, `door (${room.doorX},${room.doorY}) is out of bounds`);
      return;
    }
    const doorId = key(room.doorX, room.doorY);
    const priorDoorOwner = declaredDoorCells.get(doorId);
    if (priorDoorOwner) fail(roomScope, `shares declared door (${room.doorX},${room.doorY}) with room ${priorDoorOwner}`);
    else declaredDoorCells.set(doorId, roomName);
    const expectedDoor = room.locked ? TILE.LOCKED : TILE.DOOR;
    if (grid[room.doorY][room.doorX] !== expectedDoor) {
      fail(roomScope, `declared door (${room.doorX},${room.doorY}) is ${labelTile(grid[room.doorY][room.doorX])}; expected ${labelTile(expectedDoor)}`);
    }

    const orientations = [];
    if (room.doorY === room.y) orientations.push({ inside: [0, 1], outside: [0, -1] });
    if (room.doorY === room.y + room.h - 1) orientations.push({ inside: [0, -1], outside: [0, 1] });
    if (room.doorX === room.x) orientations.push({ inside: [1, 0], outside: [-1, 0] });
    if (room.doorX === room.x + room.w - 1) orientations.push({ inside: [-1, 0], outside: [1, 0] });
    if (orientations.length !== 1) {
      fail(roomScope, `door (${room.doorX},${room.doorY}) must lie on exactly one non-corner room edge`);
    } else {
      const orientation = orientations[0];
      const insideX = room.doorX + orientation.inside[0];
      const insideY = room.doorY + orientation.inside[1];
      const outsideX = room.doorX + orientation.outside[0];
      const outsideY = room.doorY + orientation.outside[1];
      if (!inBounds(insideX, insideY) || !isWalkable(grid[insideY][insideX])) {
        fail(roomScope, `door interior side (${insideX},${insideY}) is blocked`);
      }
      if (!inBounds(outsideX, outsideY) || !isWalkable(grid[outsideY][outsideX])) {
        fail(roomScope, `door corridor side (${outsideX},${outsideY}) is blocked`);
      }
    }

    const doorReachable = flood(grid, { x: room.doorX, y: room.doorY });
    const reachesCorridor = [...corridorCells].some((id) => doorReachable.has(id));
    if (!reachesCorridor) fail(roomScope, 'door has no walkable path to the corridor band');
    else stats.connectedRooms++;
  });

  // Every door tile must belong to one room. This catches accidental stacked
  // corridor/room leaves that are visually coincident but create two blockers.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const value = grid[y][x];
    if ((value === TILE.DOOR || value === TILE.LOCKED) && !declaredDoorCells.has(key(x, y))) {
      fail(`${scope} tile (${x},${y})`, `${labelTile(value)} is not the declared door of any room`);
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const value = grid[y][x];
      if (value === TILE.UP || value === TILE.DOWN) {
        if (y < corridorTop || y > corridorBottom) {
          fail(`${scope} tile (${x},${y})`, `${labelTile(value)} stair is outside the corridor band`);
        }
      } else if (value === TILE.HIDE) {
        if (!roomAt(rooms, x, y, true)) {
          fail(`${scope} tile (${x},${y})`, 'HIDE must be inside a declared room');
        }
      } else if (value === TILE.EXIT) {
        const containingRoom = roomAt(rooms, x, y);
        const onEdge = containingRoom && (x === containingRoom.x || x === containingRoom.x + containingRoom.w - 1
          || y === containingRoom.y || y === containingRoom.y + containingRoom.h - 1);
        if (!onEdge) {
          fail(`${scope} tile (${x},${y})`, 'EXIT must replace a declared room facade cell');
        }
      }
    }
  }
});

if (stats.floors === 0) fail('world', 'contains no floors');
for (let i = 0; i < floorSpecialCounts.length; i++) {
  const special = floorSpecialCounts[i];
  if (i === 0 && special.down !== 0) fail(`floor ${i}`, `lowest floor has ${special.down} DOWN stair tile(s)`);
  if (i > 0 && special.down === 0) fail(`floor ${i}`, 'has no DOWN stair tile');
  if (i === floorSpecialCounts.length - 1 && special.up !== 0) fail(`floor ${i}`, `highest floor has ${special.up} UP stair tile(s)`);
  if (i < floorSpecialCounts.length - 1 && special.up === 0) fail(`floor ${i}`, 'has no UP stair tile');
  if (i < floorSpecialCounts.length - 1 && special.up !== floorSpecialCounts[i + 1].down) {
    fail(`floors ${i}/${i + 1}`, `${special.up} UP stair tile(s) do not match ${floorSpecialCounts[i + 1].down} DOWN stair tile(s)`);
  }
}
if (stats.exits !== 1) fail('world', `expected exactly 1 EXIT tile, found ${stats.exits}`);
if (stats.hides === 0) fail('world', 'expected at least one HIDE tile');

if (failureCount) {
  failureMessages.forEach((message) => console.error(message));
  if (failureCount > failureMessages.length) {
    console.error(`... ${failureCount - failureMessages.length} additional failure(s) omitted`);
  }
  console.error(`world layout invalid: ${failureCount} failure(s)`);
  process.exitCode = 1;
} else {
  console.log(
    `world layout OK: ${stats.floors} floors, ${stats.rooms} rooms, ${stats.tiles} tiles, `
    + `${stats.walkable} walkable, ${stats.connectedRooms} corridor-connected rooms, `
    + `${stats.doors} door tiles (${stats.lockedDoors} locked), ${stats.up} UP/${stats.down} DOWN stairs, `
    + `${stats.exits} exit, ${stats.hides} hide spots`,
  );
}
