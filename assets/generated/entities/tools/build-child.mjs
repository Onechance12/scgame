#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CREATED = '2026-07-22';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPT_DIR, '..', 'child');
const OUTPUT_FILE = join(OUTPUT_DIR, 'child.glb');

const COMPONENT = {
  FLOAT: 5126,
  UNSIGNED_SHORT: 5123,
};

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

const bones = [
  { name: 'Root', parent: -1, translation: [0, 0, 0] },
  { name: 'Hips', parent: 0, translation: [0, 0.53, 0] },
  { name: 'Spine', parent: 1, translation: [0, 0.16, 0] },
  { name: 'Chest', parent: 2, translation: [0, 0.16, 0] },
  { name: 'Neck', parent: 3, translation: [0, 0.13, 0] },
  { name: 'Head', parent: 4, translation: [0.02, 0.08, 0] },
  { name: 'Shoulder_L', parent: 3, translation: [-0.185, 0.06, 0] },
  { name: 'UpperArm_L', parent: 6, translation: [0, 0, 0] },
  { name: 'LowerArm_L', parent: 7, translation: [-0.012, -0.225, 0.015] },
  { name: 'Hand_L', parent: 8, translation: [-0.006, -0.205, 0.012] },
  { name: 'Shoulder_R', parent: 3, translation: [0.185, 0.06, 0] },
  { name: 'UpperArm_R', parent: 10, translation: [0, 0, 0] },
  { name: 'LowerArm_R', parent: 11, translation: [0.012, -0.225, 0.015] },
  { name: 'Hand_R', parent: 12, translation: [0.006, -0.205, 0.012] },
  { name: 'UpperLeg_L', parent: 1, translation: [-0.082, -0.03, 0] },
  { name: 'LowerLeg_L', parent: 14, translation: [0, -0.255, 0] },
  { name: 'Foot_L', parent: 15, translation: [0, -0.215, 0.018] },
  { name: 'UpperLeg_R', parent: 1, translation: [0.082, -0.03, 0] },
  { name: 'LowerLeg_R', parent: 17, translation: [0, -0.255, 0] },
  { name: 'Foot_R', parent: 18, translation: [0, -0.215, 0.018] },
];

const boneIndex = Object.fromEntries(bones.map((bone, index) => [bone.name, index]));

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(v, scalar) {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize3(v) {
  const length = length3(v) || 1;
  return scale3(v, 1 / length);
}

function quatFromEuler(x = 0, y = 0, z = 0) {
  const sx = Math.sin(x / 2), cx = Math.cos(x / 2);
  const sy = Math.sin(y / 2), cy = Math.cos(y / 2);
  const sz = Math.sin(z / 2), cz = Math.cos(z / 2);
  return normalize4([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]);
}

function normalize4(v) {
  const length = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
  return v.map((value) => value / length);
}

const globalJointPositions = bones.map(() => [0, 0, 0]);
for (let i = 0; i < bones.length; i++) {
  const bone = bones[i];
  globalJointPositions[i] = bone.parent < 0
    ? [...bone.translation]
    : add3(globalJointPositions[bone.parent], bone.translation);
}

const positions = [];
const normals = [];
const colors = [];
const joints = [];
const weights = [];
const indices = [];

const palette = {
  skin: [0.49, 0.55, 0.53, 1],
  skinShadow: [0.31, 0.37, 0.35, 1],
  gown: [0.59, 0.64, 0.59, 1],
  gownShadow: [0.30, 0.35, 0.32, 1],
  hair: [0.035, 0.043, 0.038, 1],
  void: [0.001, 0.001, 0.001, 1],
  stain: [0.14, 0.17, 0.15, 1],
  nail: [0.13, 0.15, 0.14, 1],
};

function vertex(position, normal, color, joint, secondaryJoint = null, secondaryWeight = 0) {
  const index = positions.length / 3;
  positions.push(...position);
  normals.push(...normalize3(normal));
  colors.push(...color);
  if (secondaryJoint == null || secondaryWeight <= 0) {
    joints.push(joint, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  } else {
    joints.push(joint, secondaryJoint, 0, 0);
    weights.push(1 - secondaryWeight, secondaryWeight, 0, 0);
  }
  return index;
}

function triangle(a, b, c) {
  indices.push(a, b, c);
}

function addEllipsoid(center, radius, joint, color, segments = 12, rings = 8) {
  const top = vertex(
    [center[0], center[1] + radius[1], center[2]],
    [0, 1, 0], color, joint,
  );
  const ringIds = [];
  for (let ring = 1; ring < rings; ring++) {
    const theta = Math.PI * ring / rings;
    const row = [];
    for (let segment = 0; segment < segments; segment++) {
      const phi = Math.PI * 2 * segment / segments;
      const unit = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ];
      const point = [
        center[0] + unit[0] * radius[0],
        center[1] + unit[1] * radius[1],
        center[2] + unit[2] * radius[2],
      ];
      const normal = [unit[0] / radius[0], unit[1] / radius[1], unit[2] / radius[2]];
      row.push(vertex(point, normal, color, joint));
    }
    ringIds.push(row);
  }
  const bottom = vertex(
    [center[0], center[1] - radius[1], center[2]],
    [0, -1, 0], color, joint,
  );

  for (let segment = 0; segment < segments; segment++) {
    triangle(top, ringIds[0][segment], ringIds[0][(segment + 1) % segments]);
  }
  for (let ring = 0; ring < ringIds.length - 1; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      triangle(ringIds[ring][segment], ringIds[ring + 1][segment], ringIds[ring + 1][next]);
      triangle(ringIds[ring][segment], ringIds[ring + 1][next], ringIds[ring][next]);
    }
  }
  const last = ringIds.at(-1);
  for (let segment = 0; segment < segments; segment++) {
    triangle(last[segment], bottom, last[(segment + 1) % segments]);
  }
}

function addEllipsoidCap(center, radius, joint, color, thetaEnd, segments = 12, rings = 5) {
  const top = vertex(
    [center[0], center[1] + radius[1], center[2]],
    [0, 1, 0], color, joint,
  );
  const ringIds = [];
  for (let ring = 1; ring <= rings; ring++) {
    const theta = thetaEnd * ring / rings;
    const row = [];
    for (let segment = 0; segment < segments; segment++) {
      const phi = Math.PI * 2 * segment / segments;
      const unit = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ];
      row.push(vertex([
        center[0] + unit[0] * radius[0],
        center[1] + unit[1] * radius[1],
        center[2] + unit[2] * radius[2],
      ], [unit[0] / radius[0], unit[1] / radius[1], unit[2] / radius[2]], color, joint));
    }
    ringIds.push(row);
  }
  for (let segment = 0; segment < segments; segment++) {
    triangle(top, ringIds[0][segment], ringIds[0][(segment + 1) % segments]);
  }
  for (let ring = 0; ring < ringIds.length - 1; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      triangle(ringIds[ring][segment], ringIds[ring + 1][segment], ringIds[ring + 1][next]);
      triangle(ringIds[ring][segment], ringIds[ring + 1][next], ringIds[ring][next]);
    }
  }
}

function addTaperedTube(start, end, startRadius, endRadius, joint, color, segments = 8) {
  const axis = normalize3(sub3(end, start));
  const reference = Math.abs(axis[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize3(cross3(axis, reference));
  const v = normalize3(cross3(u, axis));
  const a = [], b = [];
  for (let segment = 0; segment < segments; segment++) {
    const angle = Math.PI * 2 * segment / segments;
    const radial = add3(scale3(u, Math.cos(angle)), scale3(v, Math.sin(angle)));
    a.push(vertex(add3(start, scale3(radial, startRadius)), radial, color, joint));
    b.push(vertex(add3(end, scale3(radial, endRadius)), radial, color, joint));
  }
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    triangle(a[segment], b[segment], b[next]);
    triangle(a[segment], b[next], a[next]);
  }
  const startCenter = vertex(start, scale3(axis, -1), color, joint);
  const endCenter = vertex(end, axis, color, joint);
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    triangle(startCenter, a[next], a[segment]);
    triangle(endCenter, b[segment], b[next]);
  }
}

function addBox(center, size, joint, color) {
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  const faces = [
    { n: [1, 0, 0], p: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]] },
    { n: [-1, 0, 0], p: [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]] },
    { n: [0, 1, 0], p: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
    { n: [0, -1, 0], p: [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]] },
    { n: [0, 0, 1], p: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], p: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
  ];
  for (const face of faces) {
    const ids = face.p.map((point) => vertex(add3(center, point), face.n, color, joint));
    triangle(ids[0], ids[1], ids[2]);
    triangle(ids[0], ids[2], ids[3]);
  }
}

function addGown() {
  const segments = 12;
  const rows = [
    { y: 0.93, rx: 0.16, rz: 0.09, joint: boneIndex.Chest, color: palette.gown },
    { y: 0.69, rx: 0.155, rz: 0.09, joint: boneIndex.Spine, color: palette.gown },
    { y: 0.37, rx: 0.235, rz: 0.135, joint: boneIndex.Hips, color: palette.gownShadow },
  ];
  const ragged = [0.01, -0.025, 0.018, -0.035, 0.0, -0.018, 0.025, -0.03, 0.012, -0.02, 0.028, -0.012];
  const rowIds = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const ids = [];
    for (let segment = 0; segment < segments; segment++) {
      const angle = Math.PI * 2 * segment / segments;
      const x = Math.cos(angle) * row.rx;
      const z = Math.sin(angle) * row.rz;
      const y = row.y + (rowIndex === rows.length - 1 ? ragged[segment] : 0);
      const color = rowIndex === rows.length - 1 && (segment === 2 || segment === 7 || segment === 10)
        ? palette.gownShadow
        : (rowIndex === rows.length - 1 ? palette.gown : row.color);
      ids.push(vertex([x, y, z], [x / (row.rx * row.rx), 0.15, z / (row.rz * row.rz)], color, row.joint));
    }
    rowIds.push(ids);
  }
  for (let row = 0; row < rowIds.length - 1; row++) {
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      triangle(rowIds[row][segment], rowIds[row + 1][next], rowIds[row + 1][segment]);
      triangle(rowIds[row][segment], rowIds[row][next], rowIds[row + 1][next]);
    }
  }
  const topCenter = vertex([0, rows[0].y, 0], [0, 1, 0], palette.gown, boneIndex.Chest);
  for (let segment = 0; segment < segments; segment++) {
    triangle(topCenter, rowIds[0][(segment + 1) % segments], rowIds[0][segment]);
  }
}

function addFaceCrack(points) {
  for (let i = 0; i < points.length - 1; i++) {
    addTaperedTube(points[i], points[i + 1], 0.0035, 0.0025, boneIndex.Head, palette.stain, 5);
  }
}

// Body core, hidden by the gown but necessary at animation extremes.
addEllipsoid([0, 0.78, 0], [0.135, 0.22, 0.085], boneIndex.Spine, palette.skinShadow, 10, 7);
addGown();

// Bare legs, ankles, and slightly oversized feet keep the silhouette child-sized.
for (const side of ['L', 'R']) {
  const sign = side === 'L' ? -1 : 1;
  const upper = boneIndex[`UpperLeg_${side}`];
  const lower = boneIndex[`LowerLeg_${side}`];
  const foot = boneIndex[`Foot_${side}`];
  addTaperedTube([sign * 0.082, 0.48, 0], [sign * 0.082, 0.275, 0.008], 0.048, 0.038, upper, palette.skinShadow, 8);
  addEllipsoid([sign * 0.082, 0.275, 0.008], [0.047, 0.052, 0.045], lower, palette.skinShadow, 8, 6);
  addTaperedTube([sign * 0.082, 0.27, 0.008], [sign * 0.082, 0.073, 0.02], 0.039, 0.027, lower, palette.skin, 8);
  addEllipsoid([sign * 0.082, 0.031, 0.092], [0.043, 0.031, 0.102], foot, palette.skin, 10, 6);
  addEllipsoid([sign * 0.082, 0.026, 0.166], [0.041, 0.026, 0.042], foot, palette.skinShadow, 9, 5);
}

// Long arms, ruined sleeves, and narrow hands. The asymmetry makes the child
// readable at corridor distance without borrowing a recognizable creature shape.
for (const side of ['L', 'R']) {
  const sign = side === 'L' ? -1 : 1;
  const upper = boneIndex[`UpperArm_${side}`];
  const lower = boneIndex[`LowerArm_${side}`];
  const hand = boneIndex[`Hand_${side}`];
  const shoulder = [sign * 0.185, 0.91, 0];
  const elbow = [sign * 0.197, 0.685, 0.015];
  const wrist = [sign * 0.203, 0.48, 0.027];
  addTaperedTube(shoulder, [sign * 0.19, 0.79, 0.008], 0.055, 0.043, upper, palette.gown, 10);
  addTaperedTube([sign * 0.19, 0.79, 0.008], elbow, 0.042, 0.032, upper, palette.skinShadow, 8);
  addEllipsoid(elbow, [0.038, 0.045, 0.038], lower, palette.skinShadow, 8, 6);
  addTaperedTube(elbow, wrist, 0.031, 0.022, lower, palette.skin, 8);
  addEllipsoid([sign * 0.207, 0.445, 0.032], [0.037, 0.067, 0.028], hand, palette.skin, 8, 6);
  for (let finger = 0; finger < 3; finger++) {
    const spread = (finger - 1) * 0.018;
    addTaperedTube(
      [sign * (0.202 + spread), 0.42, 0.045],
      [sign * (0.203 + spread * 1.25), 0.345 - Math.abs(finger - 1) * 0.009, 0.052],
      0.007, 0.004, hand, finger === 1 ? palette.skin : palette.nail, 6,
    );
  }
}

// Neck, face, hair, hollow sockets, and a single porcelain-like facial crack.
addTaperedTube([-0.001, 0.95, 0], [0.012, 1.015, 0], 0.052, 0.047, boneIndex.Neck, palette.skinShadow, 10);
addEllipsoid([0.02, 1.075, 0], [0.13, 0.13, 0.112], boneIndex.Head, palette.skin, 14, 9);
addEllipsoidCap([0.015, 1.083, -0.008], [0.137, 0.136, 0.121], boneIndex.Head, palette.hair, 1.92, 14, 6);
addTaperedTube([-0.108, 1.11, -0.005], [-0.117, 0.965, 0.005], 0.026, 0.014, boneIndex.Head, palette.hair, 7);
addTaperedTube([0.115, 1.095, -0.008], [0.126, 0.985, 0.003], 0.025, 0.013, boneIndex.Head, palette.hair, 7);
addEllipsoid([-0.035, 1.087, 0.105], [0.029, 0.034, 0.014], boneIndex.Head, palette.void, 10, 6);
addEllipsoid([0.075, 1.087, 0.105], [0.027, 0.034, 0.014], boneIndex.Head, palette.void, 10, 6);
addEllipsoid([0.02, 1.023, 0.111], [0.037, 0.009, 0.007], boneIndex.Head, palette.void, 9, 5);
addFaceCrack([[0.077, 1.055, 0.11], [0.097, 1.025, 0.103], [0.086, 0.993, 0.091]]);
addFaceCrack([[0.097, 1.025, 0.103], [0.118, 1.011, 0.079]]);

// Collar, old ward tie, and two dark stains add period-hospital readability
// while still using a single PBR material and vertex colors.
addTaperedTube([-0.075, 0.964, 0.068], [0.02, 0.935, 0.094], 0.012, 0.011, boneIndex.Chest, palette.gownShadow, 7);
addTaperedTube([0.02, 0.935, 0.094], [0.082, 0.963, 0.064], 0.011, 0.012, boneIndex.Chest, palette.gownShadow, 7);
addTaperedTube([0.02, 0.936, 0.096], [0.012, 0.805, 0.105], 0.013, 0.008, boneIndex.Chest, palette.stain, 7);
addEllipsoid([-0.075, 0.735, 0.091], [0.025, 0.048, 0.0025], boneIndex.Spine, palette.stain, 8, 5);
addEllipsoid([0.105, 0.505, 0.127], [0.018, 0.035, 0.0025], boneIndex.Hips, palette.gownShadow, 8, 5);

function rotations(frames) {
  return frames.flatMap(([x = 0, y = 0, z = 0]) => quatFromEuler(x, y, z));
}

function translations(frames) {
  return frames.flat();
}

function loop(values) {
  return [...values, values[0]];
}

const idleTimes = [0, 0.75, 1.5, 2.25, 3.0];
const walkTimes = [0, 0.25, 0.5, 0.75, 1.0];
const runTimes = [0, 0.15, 0.30, 0.45, 0.60];

const clips = [
  {
    name: 'idle_breathing',
    times: idleTimes,
    nominalSpeedMps: 0,
    tracks: [
      { bone: 'Hips', path: 'translation', values: translations(loop([[0, 0.53, 0], [0, 0.536, 0], [0, 0.531, 0], [0, 0.525, 0]])) },
      { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.012, 0, -0.025], [0.022, 0.01, -0.01], [0.008, 0, 0.018], [-0.014, -0.01, 0.004]])) },
      { bone: 'Chest', path: 'rotation', values: rotations(loop([[0, 0, 0.018], [0.012, -0.014, 0.008], [0, 0, -0.018], [-0.01, 0.012, 0.004]])) },
      { bone: 'Head', path: 'rotation', values: rotations(loop([[0.015, -0.10, 0.105], [-0.018, -0.055, 0.085], [0.012, 0.035, 0.12], [0.028, -0.02, 0.14]])) },
      { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[0.02, 0, -0.035], [0.035, 0, -0.02], [0.012, 0, -0.04], [-0.012, 0, -0.025]])) },
      { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[-0.012, 0, 0.025], [-0.03, 0, 0.04], [-0.005, 0, 0.022], [0.018, 0, 0.035]])) },
      { bone: 'Hand_L', path: 'rotation', values: rotations(loop([[0, 0, -0.035], [0.015, 0.015, -0.01], [0, 0, 0.02], [-0.015, -0.01, -0.01]])) },
      { bone: 'Hand_R', path: 'rotation', values: rotations(loop([[0, 0, 0.025], [-0.012, -0.01, 0.005], [0, 0, -0.018], [0.012, 0.012, 0.01]])) },
    ],
  },
  {
    name: 'walk_in_place_1p1mps',
    times: walkTimes,
    nominalSpeedMps: 1.1,
    tracks: [
      { bone: 'Hips', path: 'translation', values: translations(loop([[0.006, 0.53, 0], [0, 0.548, 0], [-0.006, 0.53, 0], [0, 0.548, 0]])) },
      { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.055, 0.018, -0.035], [0.045, 0, 0], [0.055, -0.018, 0.035], [0.045, 0, 0]])) },
      { bone: 'Head', path: 'rotation', values: rotations(loop([[0.01, -0.05, 0.08], [-0.02, 0, 0.07], [0.01, 0.05, 0.09], [-0.02, 0, 0.07]])) },
      { bone: 'UpperLeg_L', path: 'rotation', values: rotations(loop([[0.42, 0, 0], [0, 0, 0], [-0.42, 0, 0], [0, 0, 0]])) },
      { bone: 'LowerLeg_L', path: 'rotation', values: rotations(loop([[0.02, 0, 0], [0.38, 0, 0], [0.52, 0, 0], [0.08, 0, 0]])) },
      { bone: 'Foot_L', path: 'rotation', values: rotations(loop([[-0.10, 0, 0], [0.16, 0, 0], [0.08, 0, 0], [-0.08, 0, 0]])) },
      { bone: 'UpperLeg_R', path: 'rotation', values: rotations(loop([[-0.42, 0, 0], [0, 0, 0], [0.42, 0, 0], [0, 0, 0]])) },
      { bone: 'LowerLeg_R', path: 'rotation', values: rotations(loop([[0.52, 0, 0], [0.08, 0, 0], [0.02, 0, 0], [0.38, 0, 0]])) },
      { bone: 'Foot_R', path: 'rotation', values: rotations(loop([[0.08, 0, 0], [-0.08, 0, 0], [-0.10, 0, 0], [0.16, 0, 0]])) },
      { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.32, 0, -0.03], [0, 0, -0.02], [0.32, 0, -0.03], [0, 0, -0.02]])) },
      { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.06, 0, 0], [0.12, 0, 0], [0.05, 0, 0], [0.10, 0, 0]])) },
      { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[0.32, 0, 0.03], [0, 0, 0.02], [-0.32, 0, 0.03], [0, 0, 0.02]])) },
      { bone: 'LowerArm_R', path: 'rotation', values: rotations(loop([[0.05, 0, 0], [0.10, 0, 0], [0.06, 0, 0], [0.12, 0, 0]])) },
    ],
  },
  {
    name: 'run_in_place_2p5mps',
    times: runTimes,
    nominalSpeedMps: 2.5,
    tracks: [
      { bone: 'Hips', path: 'translation', values: translations(loop([[0.01, 0.53, 0], [0, 0.558, 0], [-0.01, 0.53, 0], [0, 0.558, 0]])) },
      { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.18, 0.035, -0.055], [0.22, 0, 0], [0.18, -0.035, 0.055], [0.22, 0, 0]])) },
      { bone: 'Chest', path: 'rotation', values: rotations(loop([[0.08, -0.025, 0.035], [0.05, 0, 0], [0.08, 0.025, -0.035], [0.05, 0, 0]])) },
      { bone: 'Head', path: 'rotation', values: rotations(loop([[-0.10, -0.04, 0.055], [-0.13, 0, 0.04], [-0.10, 0.04, 0.065], [-0.13, 0, 0.04]])) },
      { bone: 'UpperLeg_L', path: 'rotation', values: rotations(loop([[0.75, 0, 0], [-0.08, 0, 0], [-0.70, 0, 0], [0.08, 0, 0]])) },
      { bone: 'LowerLeg_L', path: 'rotation', values: rotations(loop([[0.05, 0, 0], [0.72, 0, 0], [0.88, 0, 0], [0.18, 0, 0]])) },
      { bone: 'Foot_L', path: 'rotation', values: rotations(loop([[-0.18, 0, 0], [0.28, 0, 0], [0.16, 0, 0], [-0.12, 0, 0]])) },
      { bone: 'UpperLeg_R', path: 'rotation', values: rotations(loop([[-0.70, 0, 0], [0.08, 0, 0], [0.75, 0, 0], [-0.08, 0, 0]])) },
      { bone: 'LowerLeg_R', path: 'rotation', values: rotations(loop([[0.88, 0, 0], [0.18, 0, 0], [0.05, 0, 0], [0.72, 0, 0]])) },
      { bone: 'Foot_R', path: 'rotation', values: rotations(loop([[0.16, 0, 0], [-0.12, 0, 0], [-0.18, 0, 0], [0.28, 0, 0]])) },
      { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.62, 0, -0.08], [0.02, 0, -0.04], [0.58, 0, -0.07], [-0.02, 0, -0.04]])) },
      { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.42, 0, 0], [0.68, 0, 0], [0.38, 0, 0], [0.58, 0, 0]])) },
      { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[0.58, 0, 0.08], [-0.02, 0, 0.04], [-0.62, 0, 0.07], [0.02, 0, 0.04]])) },
      { bone: 'LowerArm_R', path: 'rotation', values: rotations(loop([[0.38, 0, 0], [0.58, 0, 0], [0.42, 0, 0], [0.68, 0, 0]])) },
    ],
  },
];

class BinaryBuilder {
  constructor() {
    this.parts = [];
    this.byteLength = 0;
    this.bufferViews = [];
    this.accessors = [];
  }

  align(alignment = 4) {
    const padding = (alignment - (this.byteLength % alignment)) % alignment;
    if (padding) {
      this.parts.push(Buffer.alloc(padding));
      this.byteLength += padding;
    }
  }

  addView(typedArray, target) {
    this.align(4);
    const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const view = {
      buffer: 0,
      byteOffset: this.byteLength,
      byteLength: bytes.byteLength,
    };
    if (target) view.target = target;
    const index = this.bufferViews.length;
    this.bufferViews.push(view);
    this.parts.push(bytes);
    this.byteLength += bytes.byteLength;
    return index;
  }

  addAccessor(typedArray, componentType, type, count, options = {}) {
    const accessor = {
      bufferView: this.addView(typedArray, options.target),
      byteOffset: 0,
      componentType,
      count,
      type,
    };
    if (options.normalized) accessor.normalized = true;
    if (options.min) accessor.min = options.min;
    if (options.max) accessor.max = options.max;
    const index = this.accessors.length;
    this.accessors.push(accessor);
    return index;
  }

  finish() {
    this.align(4);
    return Buffer.concat(this.parts, this.byteLength);
  }
}

function minMax(values, width) {
  const min = Array(width).fill(Infinity);
  const max = Array(width).fill(-Infinity);
  for (let i = 0; i < values.length; i += width) {
    for (let axis = 0; axis < width; axis++) {
      min[axis] = Math.min(min[axis], values[i + axis]);
      max[axis] = Math.max(max[axis], values[i + axis]);
    }
  }
  return { min, max };
}

const binary = new BinaryBuilder();
const bounds = minMax(positions, 3);
const positionAccessor = binary.addAccessor(
  new Float32Array(positions), COMPONENT.FLOAT, 'VEC3', positions.length / 3,
  { target: ARRAY_BUFFER, min: bounds.min, max: bounds.max },
);
const normalAccessor = binary.addAccessor(
  new Float32Array(normals), COMPONENT.FLOAT, 'VEC3', normals.length / 3,
  { target: ARRAY_BUFFER },
);
const colorAccessor = binary.addAccessor(
  new Float32Array(colors), COMPONENT.FLOAT, 'VEC4', colors.length / 4,
  { target: ARRAY_BUFFER },
);
const jointAccessor = binary.addAccessor(
  new Uint16Array(joints), COMPONENT.UNSIGNED_SHORT, 'VEC4', joints.length / 4,
  { target: ARRAY_BUFFER },
);
const weightAccessor = binary.addAccessor(
  new Float32Array(weights), COMPONENT.FLOAT, 'VEC4', weights.length / 4,
  { target: ARRAY_BUFFER },
);
const indexAccessor = binary.addAccessor(
  new Uint16Array(indices), COMPONENT.UNSIGNED_SHORT, 'SCALAR', indices.length,
  { target: ELEMENT_ARRAY_BUFFER, min: [Math.min(...indices)], max: [Math.max(...indices)] },
);

const inverseBindMatrices = [];
for (const position of globalJointPositions) {
  inverseBindMatrices.push(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    -position[0], -position[1], -position[2], 1,
  );
}
const inverseBindAccessor = binary.addAccessor(
  new Float32Array(inverseBindMatrices), COMPONENT.FLOAT, 'MAT4', bones.length,
);

const animations = [];
for (const clip of clips) {
  const inputAccessor = binary.addAccessor(
    new Float32Array(clip.times), COMPONENT.FLOAT, 'SCALAR', clip.times.length,
    { min: [clip.times[0]], max: [clip.times.at(-1)] },
  );
  const samplers = [];
  const channels = [];
  for (const track of clip.tracks) {
    const outputAccessor = binary.addAccessor(
      new Float32Array(track.values), COMPONENT.FLOAT,
      track.path === 'rotation' ? 'VEC4' : 'VEC3', clip.times.length,
    );
    const sampler = samplers.length;
    samplers.push({ input: inputAccessor, output: outputAccessor, interpolation: 'LINEAR' });
    channels.push({
      sampler,
      target: { node: 1 + boneIndex[track.bone], path: track.path },
    });
  }
  animations.push({
    name: clip.name,
    samplers,
    channels,
    extras: {
      loop: true,
      inPlace: true,
      nominalSpeedMps: clip.nominalSpeedMps,
    },
  });
}

const nodes = [{
  name: 'ChildPhantomMesh',
  mesh: 0,
  skin: 0,
  extras: { kind: 'child', forwardAxis: '+Z', feetAtOrigin: true },
}];
for (let index = 0; index < bones.length; index++) {
  const bone = bones[index];
  const node = { name: bone.name, translation: bone.translation };
  const children = [];
  for (let child = 0; child < bones.length; child++) {
    if (bones[child].parent === index) children.push(1 + child);
  }
  if (children.length) node.children = children;
  nodes.push(node);
}

const bin = binary.finish();
const gltf = {
  asset: {
    version: '2.0',
    generator: 'OpenAI Codex deterministic procedural entity builder',
    copyright: 'Original project asset for Onechance12/scgame; no third-party source content',
    extras: {
      created: CREATED,
      kind: 'child',
      design: 'small original hospital-gown phantom',
      units: 'metres',
      yUp: true,
      inPlaceAnimations: true,
    },
  },
  scene: 0,
  scenes: [{ name: 'ChildPhantom', nodes: [0, 1] }],
  nodes,
  meshes: [{
    name: 'ChildPhantom',
    primitives: [{
      attributes: {
        POSITION: positionAccessor,
        NORMAL: normalAccessor,
        COLOR_0: colorAccessor,
        JOINTS_0: jointAccessor,
        WEIGHTS_0: weightAccessor,
      },
      indices: indexAccessor,
      material: 0,
      mode: 4,
    }],
    extras: {
      targetHeightMetres: 1.18,
      topology: 'procedural-low-poly',
    },
  }],
  materials: [{
    name: 'ChildPhantom_VertexColor',
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 0.94,
    },
    doubleSided: false,
  }],
  skins: [{
    name: 'ChildPhantomRig',
    inverseBindMatrices: inverseBindAccessor,
    skeleton: 1,
    joints: bones.map((_, index) => 1 + index),
  }],
  animations,
  buffers: [{ byteLength: bin.byteLength }],
  bufferViews: binary.bufferViews,
  accessors: binary.accessors,
};

function padBuffer(buffer, fill) {
  const padding = (4 - (buffer.byteLength % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, fill)]) : buffer;
}

const json = padBuffer(Buffer.from(JSON.stringify(gltf)), 0x20);
const paddedBin = padBuffer(bin, 0);
const totalLength = 12 + 8 + json.byteLength + 8 + paddedBin.byteLength;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(json.byteLength, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(paddedBin.byteLength, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
const glb = Buffer.concat([header, jsonHeader, json, binHeader, paddedBin], totalLength);

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_FILE, glb);

const sha256 = createHash('sha256').update(glb).digest('hex');
const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
const manifest = {
  schemaVersion: 1,
  packId: 'codex-original-entity-child-v1',
  created: CREATED,
  status: 'review-candidate',
  generator: {
    tool: 'OpenAI Codex deterministic procedural glTF builder',
    script: '../tools/build-child.mjs',
    externalReferenceImagesUsed: [],
    thirdPartyModelsUsed: [],
    scansUsed: [],
  },
  rights: {
    projectOriginal: true,
    thirdPartyContent: false,
    attributionRequired: false,
    franchiseOrTrademarkContent: false,
    realPersonLikeness: false,
    commercialClearance: 'owner-review-required',
  },
  reproducibility: {
    bitReproducible: true,
    randomSeed: null,
    runtimeDependencies: ['Node.js standard library'],
  },
  assets: [{
    path: 'child.glb',
    role: 'rigged-animated-entity',
    kind: 'child',
    format: 'glTF 2.0 GLB',
    coordinateSystem: 'Y-up',
    units: 'metres',
    feetAtOrigin: Math.abs(bounds.min[1]) < 1e-6,
    dimensionsMetres: {
      width: Number(size[0].toFixed(6)),
      height: Number(size[1].toFixed(6)),
      depth: Number(size[2].toFixed(6)),
      min: bounds.min.map((value) => Number(value.toFixed(6))),
      max: bounds.max.map((value) => Number(value.toFixed(6))),
    },
    vertices: positions.length / 3,
    triangles: indices.length / 3,
    bones: bones.length,
    meshes: 1,
    primitives: 1,
    materials: 1,
    textures: 0,
    clips: clips.map((clip) => ({
      name: clip.name,
      durationSeconds: clip.times.at(-1),
      inPlace: true,
      nominalSpeedMps: clip.nominalSpeedMps,
    })),
    bytes: glb.byteLength,
    sha256,
  }],
};
writeFileSync(join(OUTPUT_DIR, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  file: OUTPUT_FILE,
  bytes: glb.byteLength,
  sha256,
  vertices: positions.length / 3,
  triangles: indices.length / 3,
  bones: bones.length,
  materials: 1,
  dimensionsMetres: size.map((value) => Number(value.toFixed(4))),
  clips: clips.map((clip) => clip.name),
}, null, 2));
