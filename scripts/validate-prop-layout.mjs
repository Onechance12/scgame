#!/usr/bin/env node

// Headless validation for deterministic prop placement. Browser scripts are
// evaluated in an isolated VM with no Node globals, disabled dynamic code
// generation, and time-limited build/populate calls.

import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as THREE from '../js/vendor/three.module.min.js';

const worldPath = fileURLToPath(new URL('../js/world.js', import.meta.url));
const propsPath = fileURLToPath(new URL('../js/props.js', import.meta.url));
const TILE_M = 2.7;
const EXPECTED_FLOORS = 5;
const PICKUP_HALF_EXTENT = 0.62;
const HERO_KEYS = ['bed', 'rocker', 'chair', 'table', 'cabinet', 'boiler'];

const gradient = Object.freeze({ addColorStop() {} });
const context2d = {
  fillStyle: '',
  clearRect() {},
  fillRect() {},
  beginPath() {},
  arc() {},
  fill() {},
  createRadialGradient() { return gradient; },
};
const documentStub = Object.freeze({
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`unsupported DOM element: ${tag}`);
    return { width: 0, height: 0, getContext: () => context2d };
  },
});

const sandbox = Object.create(null);
sandbox.THREE = THREE;
sandbox.document = documentStub;
sandbox.window = sandbox;
const context = vm.createContext(sandbox, {
  name: 'prop-layout-validator',
  codeGeneration: { strings: false, wasm: false },
});

function runInContext(script, label, timeout = 3000) {
  try {
    return script.runInContext(context, { timeout });
  } catch (err) {
    console.error(`FAIL: ${label}: ${err.message}`);
    process.exit(1);
  }
}

for (const sourcePath of [worldPath, propsPath]) {
  let source;
  try {
    source = fs.readFileSync(sourcePath, 'utf8');
  } catch (err) {
    console.error(`FAIL: could not read ${sourcePath}: ${err.message}`);
    process.exit(1);
  }
  let script;
  try {
    script = new vm.Script(source, { filename: sourcePath });
  } catch (err) {
    console.error(`FAIL: could not compile ${sourcePath}: ${err.message}`);
    process.exit(1);
  }
  runInContext(script, `could not evaluate ${sourcePath}`);
}

if (!sandbox.World || typeof sandbox.World.build !== 'function'
    || !sandbox.Props || typeof sandbox.Props.populate !== 'function') {
  console.error('FAIL: world.js and props.js did not expose World.build() and Props.populate()');
  process.exit(1);
}

const buildScript = new vm.Script(`
  window.__validationData = window.World.build();
  window.__validationWorldA = JSON.stringify(window.__validationData);
  window.__validationWorldB = JSON.stringify(window.World.build());
`, { filename: 'prop-layout-build-validation.vm.js' });
runInContext(buildScript, 'World.build() failed');

const data = sandbox.__validationData;
const originalWorldJson = sandbox.__validationWorldA;
const failures = new Set();
const fail = (message) => failures.add(`FAIL: ${message}`);

if (sandbox.__validationWorldA !== sandbox.__validationWorldB) {
  fail('World.build() is not deterministic across repeated builds');
}
if (!data || !data.TILE || !Array.isArray(data.floors)) {
  console.error('FAIL: World.build() returned invalid floor data');
  process.exit(1);
}
if (data.floors.length !== EXPECTED_FLOORS) {
  fail(`world has ${data.floors.length} floors; expected ${EXPECTED_FLOORS}`);
}

const boxKeys = ['x0', 'x1', 'z0', 'z1'];
const isValidBox = (box) => box && boxKeys.every((key) => Number.isFinite(box[key]))
  && box.x0 < box.x1 && box.z0 < box.z1;
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const formatBox = (box) => `[${box.x0.toFixed(3)},${box.x1.toFixed(3)}]x[${box.z0.toFixed(3)},${box.z1.toFixed(3)}]`;

function reserveZones(floorIndex) {
  const floor = data.floors[floorIndex];
  const grid = floor && floor.grid;
  const zones = [];
  const specials = [
    ['HIDE', data.TILE.HIDE],
    ['EXIT', data.TILE.EXIT],
    ['CANDLE', data.TILE.CANDLE],
  ];

  if (!Array.isArray(grid)) {
    fail(`floor ${floorIndex}: grid is not an array`);
    return zones;
  }
  for (let y = 0; y < grid.length; y++) {
    if (!Array.isArray(grid[y])) {
      fail(`floor ${floorIndex}: grid row ${y} is not an array`);
      continue;
    }
    for (let x = 0; x < grid[y].length; x++) {
      for (const [kind, tile] of specials) {
        if (grid[y][x] !== tile) continue;
        // Check the complete interactive tile. This is deliberately stricter
        // than props.js's 0.1 m inset reserve.
        zones.push({
          kind,
          label: `${kind} tile (${x},${y})`,
          box: { x0: x * TILE_M, x1: (x + 1) * TILE_M, z0: y * TILE_M, z1: (y + 1) * TILE_M },
        });
      }
    }
  }

  const addPickup = (kind, entry, index) => {
    if (!entry || entry.floor !== floorIndex || entry.taken || entry.found) return;
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) {
      fail(`floor ${floorIndex}: ${kind} ${entry.id || `#${index}`} has invalid coordinates`);
      return;
    }
    const x = (entry.x + 0.5) * TILE_M;
    const z = (entry.y + 0.5) * TILE_M;
    zones.push({
      kind,
      label: `${kind} ${entry.id || `#${index}`} (${entry.x},${entry.y})`,
      box: {
        x0: x - PICKUP_HALF_EXTENT,
        x1: x + PICKUP_HALF_EXTENT,
        z0: z - PICKUP_HALF_EXTENT,
        z1: z + PICKUP_HALF_EXTENT,
      },
    });
  };
  (data.items || []).forEach((entry, index) => addPickup('ITEM', entry, index));
  (data.documents || []).forEach((entry, index) => addPickup('DOCUMENT', entry, index));
  return zones;
}

function populationSnapshot(population) {
  const nodes = [];
  const stack = population.group ? [population.group] : [];
  while (stack.length) {
    const node = stack.pop();
    nodes.push({
      type: node.type,
      name: node.name || '',
      position: [node.position.x, node.position.y, node.position.z],
      rotation: [node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.order],
      scale: [node.scale.x, node.scale.y, node.scale.z],
      visible: node.visible,
      geometry: node.geometry ? { type: node.geometry.type, parameters: node.geometry.parameters || null } : null,
      children: node.children.length,
    });
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return JSON.stringify({
    solids: population.solids,
    nodes,
    fixtures: (population.fixtures || []).map((fixture) => ({
      dead: fixture.dead,
      on: fixture.on,
      base: fixture.base,
      phase: fixture.phase,
      nextFlick: fixture.nextFlick,
      position: fixture.tube && fixture.tube.position.toArray(),
      rotation: fixture.tube && fixture.tube.rotation.toArray(),
    })),
    animated: (population.animated || []).map((entry) => ({
      kind: entry.kind,
      phase: entry.phase,
      position: entry.obj && entry.obj.position.toArray(),
      rotation: entry.obj && entry.obj.rotation.toArray(),
    })),
    moods: (population.moods || []).map((entry) => ({
      base: entry.base,
      position: entry.light && entry.light.position.toArray(),
    })),
  });
}

const populateScript = new vm.Script(`
  window.__validationPopulation = window.Props.populate(
    window.__validationFloor,
    window.__validationData,
    window.__validationOptions
  );
`, { filename: 'prop-layout-populate-validation.vm.js' });
sandbox.__validationOptions = { TILE_M, WALL_H: 3.2 };

const zonesByFloor = data.floors.map((_, floorIndex) => reserveZones(floorIndex));
const zoneCounts = { HIDE: 0, EXIT: 0, CANDLE: 0, ITEM: 0, DOCUMENT: 0 };
for (const zones of zonesByFloor) for (const zone of zones) zoneCounts[zone.kind]++;

const stats = {
  solids: 0,
  pairChecks: 0,
  reserveChecks: 0,
  solidsByVariant: new Map(),
};

function populate(floorIndex, scope) {
  sandbox.__validationFloor = floorIndex;
  runInContext(populateScript, `${scope}: Props.populate() failed`, 5000);
  const population = sandbox.__validationPopulation;
  if (!population || !population.group || !Array.isArray(population.solids)) {
    fail(`${scope}: Props.populate() returned an invalid population`);
    return null;
  }
  return population;
}

function validateCollisions(population, zones, scope, countStats) {
  const solids = [];
  population.solids.forEach((box, index) => {
    if (!isValidBox(box)) {
      fail(`${scope}: solid ${index} has an invalid AABB`);
      return;
    }
    solids.push({ box, index });
  });

  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      if (countStats) stats.pairChecks++;
      if (overlaps(solids[i].box, solids[j].box)) {
        fail(`${scope}: solid ${solids[i].index} ${formatBox(solids[i].box)} overlaps solid ${solids[j].index} ${formatBox(solids[j].box)}`);
      }
    }
    for (const zone of zones) {
      if (countStats) stats.reserveChecks++;
      if (overlaps(solids[i].box, zone.box)) {
        fail(`${scope}: solid ${solids[i].index} ${formatBox(solids[i].box)} overlaps ${zone.label} ${formatBox(zone.box)}`);
      }
    }
  }
}

const variants = [
  { name: 'primitive', configure: () => { delete sandbox.HeroModels; } },
  {
    name: 'hero',
    configure: () => {
      sandbox.HeroModels = Object.fromEntries(HERO_KEYS.map((key) => {
        const model = new THREE.Group();
        model.name = `dummy-${key}`;
        return [key, model];
      }));
    },
  },
];

for (const variant of variants) {
  variant.configure();
  const floorSolids = [];
  for (let floorIndex = 0; floorIndex < data.floors.length; floorIndex++) {
    const scope = `${variant.name} floor ${floorIndex}`;
    const first = populate(floorIndex, `${scope} first pass`);
    const second = populate(floorIndex, `${scope} repeat pass`);
    if (!first || !second) continue;

    validateCollisions(first, zonesByFloor[floorIndex], `${scope} first pass`, true);
    validateCollisions(second, zonesByFloor[floorIndex], `${scope} repeat pass`, false);
    if (populationSnapshot(first) !== populationSnapshot(second)) {
      fail(`${scope}: repeated placement is not deterministic`);
    }
    floorSolids.push(first.solids.length);
    stats.solids += first.solids.length;
  }
  stats.solidsByVariant.set(variant.name, floorSolids);
}

const finalWorldJsonScript = new vm.Script(
  'window.__validationWorldAfter = JSON.stringify(window.__validationData);',
  { filename: 'prop-layout-mutation-validation.vm.js' },
);
runInContext(finalWorldJsonScript, 'could not inspect final world data');
if (sandbox.__validationWorldAfter !== originalWorldJson) {
  fail('Props.populate() mutated World.build() data');
}

if (failures.size) {
  for (const message of [...failures].slice(0, 100)) console.error(message);
  if (failures.size > 100) console.error(`... ${failures.size - 100} additional failure(s) omitted`);
  console.error(`${failures.size} prop-layout failure(s)`);
  process.exit(1);
}

const zoneTotal = Object.values(zoneCounts).reduce((sum, count) => sum + count, 0);
const counts = Object.entries(zoneCounts).map(([kind, count]) => `${kind}=${count}`).join(', ');
const placementCounts = [...stats.solidsByVariant]
  .map(([name, values]) => `${name}=[${values.join(',')}]`)
  .join(', ');
console.log(`prop layout OK: ${variants.length} variants x ${data.floors.length} floors, ${stats.solids} solids, ${stats.pairChecks} pair checks, ${stats.reserveChecks} reserve checks, deterministic`);
console.log(`reserves: ${zoneTotal} (${counts}); solids/floor: ${placementCounts}`);
