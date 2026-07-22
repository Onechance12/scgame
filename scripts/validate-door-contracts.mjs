#!/usr/bin/env node

// Validate the runtime contract shared by world.js, entities.js, and the VR
// door controller. Browser scripts are evaluated in an isolated VM with no
// Node globals; dynamic code generation is disabled and execution is bounded.

import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const worldPath = fileURLToPath(new URL('../js/world.js', import.meta.url));
const entitiesPath = fileURLToPath(new URL('../js/entities.js', import.meta.url));
const worldSource = fs.readFileSync(worldPath, 'utf8');
const entitiesSource = fs.readFileSync(entitiesPath, 'utf8');
const sandbox = Object.create(null);
sandbox.window = Object.create(null);

try {
  const context = vm.createContext(sandbox, {
    name: 'door-contract-validator',
    codeGeneration: { strings: false, wasm: false },
  });
  const script = new vm.Script(
    `${worldSource}\n${entitiesSource}\n;window.__doorData = World.build();`,
    { filename: 'world-and-entities.js' },
  );
  script.runInContext(context, { timeout: 2000 });
} catch (err) {
  console.error(`FAIL: could not evaluate world/entity scripts safely: ${err.message}`);
  process.exit(1);
}

const World = sandbox.window.World;
const Entities = sandbox.window.Entities;
const data = sandbox.window.__doorData;
if (!World || !Entities || !data || !data.TILE || !Array.isArray(data.floors)) {
  console.error('FAIL: world.js/entities.js did not expose the expected runtime APIs');
  process.exit(1);
}

// Select a real unlocked room door, then derive the immediately adjacent room
// and corridor cells from its declared edge. A closed door should be the only
// thing severing this short route and sight line.
let fixture = null;
for (let floorIndex = 0; floorIndex < data.floors.length && !fixture; floorIndex++) {
  const floor = data.floors[floorIndex];
  const room = floor.rooms.find((candidate) =>
    floor.grid[candidate.doorY][candidate.doorX] === data.TILE.DOOR);
  if (room) fixture = { floorIndex, floor, room };
}
if (!fixture) {
  console.error('FAIL: no unlocked declared room door is available for validation');
  process.exit(1);
}

const { floorIndex, floor, room } = fixture;
const { doorX, doorY } = room;
let inside = null;
let outside = null;
if (doorY === room.y) {
  inside = { x: doorX + 0.5, y: doorY + 1.5 };
  outside = { x: doorX + 0.5, y: doorY - 0.5 };
} else if (doorY === room.y + room.h - 1) {
  inside = { x: doorX + 0.5, y: doorY - 0.5 };
  outside = { x: doorX + 0.5, y: doorY + 1.5 };
} else if (doorX === room.x) {
  inside = { x: doorX + 1.5, y: doorY + 0.5 };
  outside = { x: doorX - 0.5, y: doorY + 0.5 };
} else if (doorX === room.x + room.w - 1) {
  inside = { x: doorX - 0.5, y: doorY + 0.5 };
  outside = { x: doorX + 1.5, y: doorY + 0.5 };
}
if (!inside || !outside) {
  console.error(`FAIL: ${room.name || room.tag} door is not on a recognized room edge`);
  process.exit(1);
}

let closed = true;
let hookCalls = 0;
sandbox.window.RuntimeDoorBlocked = (grid, x, y) => {
  hookCalls++;
  return closed && grid === floor.grid
    && Math.floor(x) === doorX && Math.floor(y) === doorY;
};

const closedPath = Entities.findPath(floor.grid, inside.x, inside.y, outside.x, outside.y);
const closedSight = Entities.lineOfSight(floor.grid, inside.x, inside.y, outside.x, outside.y);
closed = false;
const openPath = Entities.findPath(floor.grid, inside.x, inside.y, outside.x, outside.y);
const openSight = Entities.lineOfSight(floor.grid, inside.x, inside.y, outside.x, outside.y);

// HIDE contains a solid locker and must block hunters; CANDLE remains a clear
// safe-light tile. Exercise the numeric tile contract explicitly so a swapped
// constant cannot silently make ghosts clip through furniture.
const specialGrid = Array.from({ length: data.H }, () => Array(data.W).fill(data.TILE.WALL));
const specialY = 10, specialX = 11;
specialGrid[specialY][specialX - 1] = data.TILE.FLOOR;
specialGrid[specialY][specialX] = data.TILE.HIDE;
specialGrid[specialY][specialX + 1] = data.TILE.FLOOR;
const hidePath = Entities.findPath(specialGrid, specialX - 0.5, specialY + 0.5, specialX + 1.5, specialY + 0.5);
const hideSight = Entities.lineOfSight(specialGrid, specialX - 0.5, specialY + 0.5, specialX + 1.5, specialY + 0.5);
specialGrid[specialY][specialX] = data.TILE.CANDLE;
const candlePath = Entities.findPath(specialGrid, specialX - 0.5, specialY + 0.5, specialX + 1.5, specialY + 0.5);
const candleSight = Entities.lineOfSight(specialGrid, specialX - 0.5, specialY + 0.5, specialX + 1.5, specialY + 0.5);

const failures = [];
if (hookCalls === 0) failures.push('Entities never consulted window.RuntimeDoorBlocked');
if (closedPath !== null) failures.push('a closed room door did not block hunter pathfinding');
if (closedSight !== false) failures.push('a closed room door did not block hunter line of sight');
if (!Array.isArray(openPath) || openPath.length === 0) failures.push('opening the room door did not restore hunter pathfinding');
if (openSight !== true) failures.push('opening the room door did not restore hunter line of sight');
if (hidePath !== null || hideSight !== false) failures.push('solid HIDE locker does not block hunter pathfinding and sight');
if (!Array.isArray(candlePath) || candlePath.length === 0 || candleSight !== true) failures.push('walkable CANDLE tile blocks hunter pathfinding or sight');

if (failures.length) {
  failures.forEach((message) => console.error(`FAIL: ${message}`));
  process.exitCode = 1;
} else {
  console.log(
    `door contracts OK: floor ${floorIndex} ${room.name || room.tag} door (${doorX},${doorY}) `
    + 'blocks hunter path/LOS when closed and restores both when open; HIDE blocks, CANDLE passes',
  );
}
