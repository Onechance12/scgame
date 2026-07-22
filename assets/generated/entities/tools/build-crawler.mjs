#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GeometryBuilder,
  buildSkinnedGLB,
  normalize3,
  quatFromEuler,
} from './entity-glb-kit.mjs';

const CREATED = '2026-07-22';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPT_DIR, '..', 'crawler');
const OUTPUT_FILE = join(OUTPUT_DIR, 'crawler.glb');

// Forward is +Z. The crawler is authored prone and human-derived without using
// any third-party creature as a reference: shoulders and hands lead, the pelvis
// stays low, and the legs trail behind in a deliberately uneven drag shape.
const bones = [
  { name: 'Root', parent: -1, translation: [0, 0, 0] },
  { name: 'Hips', parent: 0, translation: [0, 0.22, -0.28] },
  { name: 'Spine', parent: 1, translation: [0, 0.08, 0.22] },
  { name: 'Chest', parent: 2, translation: [0, 0.12, 0.22] },
  { name: 'Neck', parent: 3, translation: [0, 0.055, 0.18] },
  { name: 'Head', parent: 4, translation: [0.025, 0.025, 0.16] },
  { name: 'Jaw', parent: 5, translation: [0, -0.08, 0.13] },
  { name: 'Shoulder_L', parent: 3, translation: [-0.235, 0.015, 0.08] },
  { name: 'UpperArm_L', parent: 7, translation: [0, 0, 0] },
  { name: 'LowerArm_L', parent: 8, translation: [-0.15, -0.17, 0.23] },
  { name: 'Hand_L', parent: 9, translation: [-0.08, -0.18, 0.23] },
  { name: 'Shoulder_R', parent: 3, translation: [0.235, 0, 0.07] },
  { name: 'UpperArm_R', parent: 11, translation: [0, 0, 0] },
  { name: 'LowerArm_R', parent: 12, translation: [0.14, -0.20, 0.21] },
  { name: 'Hand_R', parent: 13, translation: [0.09, -0.15, 0.22] },
  { name: 'UpperLeg_L', parent: 1, translation: [-0.12, -0.03, -0.08] },
  { name: 'LowerLeg_L', parent: 15, translation: [-0.13, -0.10, -0.35] },
  { name: 'Foot_L', parent: 16, translation: [-0.07, -0.07, -0.37] },
  { name: 'UpperLeg_R', parent: 1, translation: [0.13, -0.025, -0.06] },
  { name: 'LowerLeg_R', parent: 18, translation: [0.16, -0.11, -0.33] },
  { name: 'Foot_R', parent: 19, translation: [0.06, -0.065, -0.39] },
];

const bone = Object.fromEntries(bones.map((item, index) => [item.name, index]));
const geometry = new GeometryBuilder();

const palette = {
  skin: [0.37, 0.42, 0.38, 1],
  skinPale: [0.50, 0.54, 0.49, 1],
  skinShadow: [0.19, 0.23, 0.21, 1],
  bruise: [0.16, 0.14, 0.17, 1],
  gown: [0.31, 0.37, 0.36, 1],
  gownEdge: [0.18, 0.22, 0.22, 1],
  restraint: [0.12, 0.13, 0.12, 1],
  void: [0.001, 0.001, 0.001, 1],
  teeth: [0.63, 0.62, 0.52, 1],
  nail: [0.08, 0.09, 0.08, 1],
};

// Low torso mass and an elevated shoulder hump make the creature readable as
// a dragging human form, not a four-legged animal.
geometry.addEllipsoid([0, 0.245, -0.29], [0.225, 0.13, 0.27], bone.Hips, palette.skinShadow, {
  segments: 14, rings: 9, euler: [0.03, 0, -0.025],
});
geometry.addEllipsoid([0, 0.325, -0.065], [0.195, 0.135, 0.30], bone.Spine, palette.skin, {
  segments: 14, rings: 9, euler: [-0.08, 0, 0.02], secondaryJoint: bone.Hips, secondaryWeight: 0.2,
});
geometry.addEllipsoid([0, 0.415, 0.18], [0.29, 0.17, 0.30], bone.Chest, palette.skin, {
  segments: 16, rings: 10, euler: [-0.10, 0, 0], secondaryJoint: bone.Spine, secondaryWeight: 0.16,
});
geometry.addEllipsoid([-0.16, 0.50, 0.17], [0.13, 0.09, 0.16], bone.Chest, palette.skinPale, {
  segments: 10, rings: 7, euler: [-0.10, 0.18, -0.12],
});
geometry.addEllipsoid([0.15, 0.485, 0.16], [0.14, 0.085, 0.17], bone.Chest, palette.skinShadow, {
  segments: 10, rings: 7, euler: [-0.12, -0.16, 0.09],
});

// Vertebrae break the top line into an uncanny saw-tooth rhythm under a torch.
for (let index = 0; index < 6; index++) {
  const t = index / 5;
  geometry.addEllipsoid(
    [(index % 2 ? 1 : -1) * 0.008, 0.455 + Math.sin(t * Math.PI) * 0.095, -0.20 + t * 0.45],
    [0.034, 0.032, 0.044],
    t < 0.45 ? bone.Spine : bone.Chest,
    index % 2 ? palette.skinPale : palette.skinShadow,
    { segments: 8, rings: 5, euler: [0.08, 0, index % 2 ? 0.10 : -0.10] },
  );
}

// Original ward-restraint language: a crossed back strap and torn gown panels.
geometry.addTaperedTube([-0.24, 0.545, 0.02], [0.23, 0.555, 0.31], 0.026, 0.023, bone.Chest, palette.restraint, { segments: 8 });
geometry.addTaperedTube([0.22, 0.545, 0.02], [-0.22, 0.55, 0.30], 0.024, 0.021, bone.Chest, palette.gownEdge, { segments: 8 });
geometry.addDoubleSidedSheet([
  [-0.21, 0.335, -0.34], [-0.29, 0.20, -0.78], [-0.23, 0.18, -0.70],
  [-0.17, 0.19, -0.76], [-0.12, 0.17, -0.69], [0.00, 0.30, -0.32],
], bone.Hips, palette.gown, [0, 0.8, 0.2], { backNormal: [0, 0.65, -0.76] });
geometry.addDoubleSidedSheet([
  [0.00, 0.30, -0.32], [0.10, 0.16, -0.73], [0.16, 0.18, -0.67],
  [0.23, 0.17, -0.75], [0.30, 0.19, -0.66], [0.21, 0.335, -0.31],
], bone.Hips, palette.gownEdge, [0, 0.8, 0.2], { backNormal: [0, 0.65, -0.76] });
geometry.addDoubleSidedSheet([
  [-0.26, 0.47, 0.06], [-0.34, 0.32, 0.24], [-0.25, 0.27, 0.36], [-0.17, 0.48, 0.27],
], bone.Chest, palette.gown, [-0.7, 0.4, 0.2], { backNormal: [0, 1, 0] });

// Leading arms are broad at the forearm and terminate in long, weight-bearing
// fingers. Left/right proportions intentionally disagree to avoid a stock rig.
const arms = [
  {
    side: 'L', shoulder: [-0.235, 0.435, 0.24], elbow: [-0.385, 0.265, 0.47], wrist: [-0.465, 0.085, 0.70],
    upper: bone.UpperArm_L, lower: bone.LowerArm_L, hand: bone.Hand_L, sign: -1,
  },
  {
    side: 'R', shoulder: [0.235, 0.42, 0.23], elbow: [0.375, 0.22, 0.44], wrist: [0.465, 0.07, 0.66],
    upper: bone.UpperArm_R, lower: bone.LowerArm_R, hand: bone.Hand_R, sign: 1,
  },
];
for (const arm of arms) {
  geometry.addEllipsoid(arm.shoulder, [0.09, 0.085, 0.11], arm.upper, palette.skinShadow, { segments: 10, rings: 7 });
  geometry.addTaperedTube(arm.shoulder, arm.elbow, 0.075, 0.062, arm.upper, palette.skin, { segments: 10 });
  geometry.addEllipsoid(arm.elbow, [0.076, 0.07, 0.085], arm.lower, palette.skinPale, { segments: 10, rings: 7 });
  geometry.addTaperedTube(arm.elbow, arm.wrist, arm.side === 'L' ? 0.088 : 0.082, 0.058, arm.lower, palette.skinShadow, { segments: 10 });
  const palm = [arm.wrist[0], arm.side === 'L' ? 0.052 : 0.047, arm.wrist[2] + 0.035];
  geometry.addEllipsoid(palm, [0.105, palm[1], 0.13], arm.hand, palette.skinPale, {
    segments: 12, rings: 8, euler: [0.05, 0, arm.sign * 0.08],
  });
  for (let finger = 0; finger < 4; finger++) {
    const lateral = (finger - 1.5) * 0.035;
    const start = [palm[0] + lateral, 0.034 + Math.abs(lateral) * 0.04, palm[2] + 0.07];
    const end = [
      palm[0] + lateral * 1.25 + arm.sign * (finger === 0 ? 0.025 : 0),
      0.015,
      palm[2] + 0.19 - Math.abs(finger - 1.5) * 0.012,
    ];
    geometry.addTaperedTube(start, end, 0.014, 0.006, arm.hand, finger === 0 ? palette.nail : palette.skinPale, { segments: 7 });
  }
}

// Trailing legs are thin, twisted, and passive; they never imply quadrupedal
// locomotion. The feet are broad enough to keep Y=0 unambiguous in bounds.
const legs = [
  {
    hip: [-0.12, 0.19, -0.36], knee: [-0.25, 0.09, -0.71], ankle: [-0.32, 0.02, -1.08],
    upper: bone.UpperLeg_L, lower: bone.LowerLeg_L, foot: bone.Foot_L, sign: -1,
  },
  {
    hip: [0.13, 0.195, -0.34], knee: [0.29, 0.085, -0.67], ankle: [0.35, 0.02, -1.06],
    upper: bone.UpperLeg_R, lower: bone.LowerLeg_R, foot: bone.Foot_R, sign: 1,
  },
];
for (const leg of legs) {
  geometry.addTaperedTube(leg.hip, leg.knee, 0.072, 0.052, leg.upper, palette.skinShadow, { segments: 9 });
  geometry.addEllipsoid(leg.knee, [0.065, 0.055, 0.073], leg.lower, palette.bruise, { segments: 9, rings: 6 });
  geometry.addTaperedTube(leg.knee, leg.ankle, 0.05, 0.029, leg.lower, palette.skin, { segments: 8 });
  geometry.addEllipsoid(
    [leg.ankle[0] + leg.sign * 0.012, 0.025, leg.ankle[2] - 0.075],
    [0.064, 0.025, 0.15], leg.foot, palette.skinPale,
    { segments: 10, rings: 6, euler: [0, leg.sign * 0.14, leg.sign * 0.05] },
  );
  geometry.addTaperedTube(
    [leg.ankle[0] - 0.035, 0.014, leg.ankle[2] - 0.17],
    [leg.ankle[0] - 0.04, 0.008, leg.ankle[2] - 0.23],
    0.01, 0.004, leg.foot, palette.nail, { segments: 6 },
  );
}

// Lifted skull and unhinged offset jaw: readable at floor level while remaining
// a wholly original, non-franchise face design.
geometry.addTaperedTube([0, 0.42, 0.27], [0.025, 0.485, 0.45], 0.078, 0.065, bone.Neck, palette.skinShadow, { segments: 10 });
geometry.addEllipsoid([0.025, 0.50, 0.52], [0.16, 0.12, 0.17], bone.Head, palette.skinPale, {
  segments: 16, rings: 10, euler: [0.05, -0.06, 0.08],
});
geometry.addEllipsoid([-0.08, 0.555, 0.555], [0.052, 0.032, 0.045], bone.Head, palette.bruise, {
  segments: 8, rings: 5, euler: [0, 0.2, -0.2],
});
geometry.addEllipsoid([-0.035, 0.515, 0.672], [0.036, 0.027, 0.014], bone.Head, palette.void, { segments: 10, rings: 6 });
geometry.addEllipsoid([0.086, 0.508, 0.666], [0.029, 0.024, 0.014], bone.Head, palette.void, { segments: 10, rings: 6 });
geometry.addEllipsoid([0.035, 0.423, 0.64], [0.115, 0.058, 0.105], bone.Jaw, palette.skinShadow, {
  segments: 12, rings: 8, euler: [0.20, 0.04, -0.03],
});
geometry.addEllipsoid([0.035, 0.446, 0.731], [0.071, 0.029, 0.014], bone.Jaw, palette.void, { segments: 10, rings: 6 });
for (let tooth = 0; tooth < 4; tooth++) {
  geometry.addBox([-0.016 + tooth * 0.034, 0.462 - (tooth % 2) * 0.004, 0.742], [0.014, 0.024, 0.011], bone.Jaw, palette.teeth, {
    euler: [0.12, 0, (tooth - 1.5) * 0.04],
  });
}

function rotations(frames) {
  return frames.flatMap(([x = 0, y = 0, z = 0]) => quatFromEuler(x, y, z));
}

function translations(frames) {
  return frames.flat();
}

function loop(frames) {
  return [...frames, frames[0]];
}

const idleTimes = [0, 0.48, 0.96, 1.44, 1.92, 2.40];
const walkTimes = [0, 0.30, 0.60, 0.90, 1.20];
const runTimes = [0, 0.1625, 0.325, 0.4875, 0.65];

const clips = [
  {
    name: 'idle_twitch',
    times: idleTimes,
    nominalSpeedMps: 0,
    tracks: [
      { bone: 'Hips', path: 'translation', values: translations(loop([[0, 0.22, -0.28], [0.003, 0.226, -0.278], [0, 0.22, -0.28], [-0.003, 0.216, -0.281], [0, 0.221, -0.28]])) },
      { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.02, 0, -0.015], [0.045, -0.015, 0], [0.015, 0.01, 0.018], [-0.02, 0, 0.005], [0.01, -0.01, -0.012]])) },
      { bone: 'Chest', path: 'rotation', values: rotations(loop([[-0.025, 0.01, 0.015], [-0.055, 0, 0.025], [-0.02, -0.012, -0.01], [0.012, 0, -0.018], [-0.018, 0.01, 0.006]])) },
      { bone: 'Head', path: 'rotation', values: rotations(loop([[0.02, -0.10, 0.08], [-0.015, -0.06, 0.11], [0.04, 0.04, 0.06], [-0.03, -0.02, 0.13], [0.015, -0.08, 0.085]])) },
      { bone: 'Jaw', path: 'rotation', values: rotations(loop([[0.10, 0, -0.02], [0.15, 0, -0.03], [0.08, 0.01, -0.01], [0.18, -0.01, -0.035], [0.11, 0, -0.02]])) },
      { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[0.015, 0.02, -0.02], [0.035, 0, -0.015], [0.01, -0.02, 0], [-0.02, 0, 0.012], [0.008, 0.015, -0.015]])) },
      { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[-0.01, -0.02, 0.02], [-0.025, 0, 0.012], [0.005, 0.02, 0], [0.02, 0, -0.012], [-0.005, -0.015, 0.015]])) },
      { bone: 'Hand_L', path: 'rotation', values: rotations(loop([[0, 0, -0.015], [0.015, 0.01, 0], [0, 0, 0.015], [-0.012, -0.01, 0], [0, 0, -0.01]])) },
      { bone: 'Hand_R', path: 'rotation', values: rotations(loop([[0, 0, 0.012], [-0.012, -0.01, 0], [0, 0, -0.014], [0.014, 0.01, 0], [0, 0, 0.01]])) },
    ],
  },
  {
    name: 'walk_drag_in_place_1p1mps',
    times: walkTimes,
    nominalSpeedMps: 1.1,
    tracks: [
      { bone: 'Hips', path: 'translation', values: translations(loop([[0.012, 0.22, -0.28], [0, 0.244, -0.27], [-0.012, 0.22, -0.28], [0, 0.24, -0.29]])) },
      { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.08, 0.055, -0.045], [-0.02, 0, 0.015], [0.08, -0.055, 0.045], [-0.02, 0, -0.015]])) },
      { bone: 'Chest', path: 'rotation', values: rotations(loop([[-0.12, -0.04, 0.06], [0.03, 0, 0], [-0.12, 0.04, -0.06], [0.03, 0, 0]])) },
      { bone: 'Head', path: 'rotation', values: rotations(loop([[0.12, -0.13, 0.11], [-0.05, -0.02, 0.05], [0.12, 0.10, 0.08], [-0.05, 0.02, 0.05]])) },
      { bone: 'Jaw', path: 'rotation', values: rotations(loop([[0.20, 0, -0.02], [0.10, 0, -0.01], [0.17, 0, -0.03], [0.09, 0, -0.01]])) },
      { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.24, 0.20, -0.14], [0.20, -0.08, 0.08], [0.10, -0.12, 0.06], [-0.06, 0.10, -0.08]])) },
      { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.32, 0.04, 0], [-0.20, -0.02, 0.04], [0.10, 0, -0.02], [0.28, 0.03, 0]])) },
      { bone: 'Hand_L', path: 'rotation', values: rotations(loop([[-0.10, 0, -0.08], [0.16, 0.05, 0.06], [0.05, 0, 0.02], [-0.08, -0.04, -0.05]])) },
      { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[0.10, 0.12, -0.06], [-0.06, -0.10, 0.08], [-0.24, -0.20, 0.14], [0.20, 0.08, -0.08]])) },
      { bone: 'LowerArm_R', path: 'rotation', values: rotations(loop([[0.10, 0, 0.02], [0.28, -0.03, 0], [0.32, -0.04, 0], [-0.20, 0.02, -0.04]])) },
      { bone: 'Hand_R', path: 'rotation', values: rotations(loop([[0.05, 0, -0.02], [-0.08, 0.04, 0.05], [-0.10, 0, 0.08], [0.16, -0.05, -0.06]])) },
      { bone: 'UpperLeg_L', path: 'rotation', values: rotations(loop([[0.03, 0.05, -0.03], [-0.08, -0.02, 0.04], [0.02, -0.04, 0.02], [0.07, 0.02, -0.03]])) },
      { bone: 'LowerLeg_L', path: 'rotation', values: rotations(loop([[0.02, 0, 0], [0.12, 0.04, 0], [0.05, 0, -0.02], [-0.04, -0.03, 0]])) },
      { bone: 'UpperLeg_R', path: 'rotation', values: rotations(loop([[0.02, -0.04, -0.02], [0.07, -0.02, 0.03], [0.03, 0.05, 0.03], [-0.08, 0.02, -0.04]])) },
      { bone: 'LowerLeg_R', path: 'rotation', values: rotations(loop([[0.05, 0, 0.02], [-0.04, 0.03, 0], [0.02, 0, 0], [0.12, -0.04, 0]])) },
    ],
  },
  {
    name: 'run_scuttle_in_place_2p5mps',
    times: runTimes,
    nominalSpeedMps: 2.5,
    tracks: [
      { bone: 'Hips', path: 'translation', values: translations(loop([[0.016, 0.22, -0.28], [0, 0.258, -0.265], [-0.016, 0.22, -0.28], [0, 0.252, -0.295]])) },
      { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.15, 0.10, -0.08], [-0.07, 0, 0.025], [0.15, -0.10, 0.08], [-0.07, 0, -0.025]])) },
      { bone: 'Chest', path: 'rotation', values: rotations(loop([[-0.22, -0.08, 0.10], [0.06, 0, 0], [-0.22, 0.08, -0.10], [0.06, 0, 0]])) },
      { bone: 'Head', path: 'rotation', values: rotations(loop([[0.20, -0.17, 0.14], [-0.09, -0.03, 0.04], [0.20, 0.15, 0.10], [-0.09, 0.03, 0.04]])) },
      { bone: 'Jaw', path: 'rotation', values: rotations(loop([[0.26, 0, -0.03], [0.12, 0, -0.01], [0.23, 0, -0.04], [0.10, 0, -0.01]])) },
      { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.42, 0.30, -0.22], [0.34, -0.12, 0.12], [0.18, -0.18, 0.10], [-0.14, 0.16, -0.12]])) },
      { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.52, 0.06, 0], [-0.34, -0.03, 0.08], [0.18, 0, -0.04], [0.44, 0.05, 0]])) },
      { bone: 'Hand_L', path: 'rotation', values: rotations(loop([[-0.18, 0, -0.12], [0.26, 0.08, 0.10], [0.08, 0, 0.03], [-0.14, -0.06, -0.08]])) },
      { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[0.18, 0.18, -0.10], [-0.14, -0.16, 0.12], [-0.42, -0.30, 0.22], [0.34, 0.12, -0.12]])) },
      { bone: 'LowerArm_R', path: 'rotation', values: rotations(loop([[0.18, 0, 0.04], [0.44, -0.05, 0], [0.52, -0.06, 0], [-0.34, 0.03, -0.08]])) },
      { bone: 'Hand_R', path: 'rotation', values: rotations(loop([[0.08, 0, -0.03], [-0.14, 0.06, 0.08], [-0.18, 0, 0.12], [0.26, -0.08, -0.10]])) },
      { bone: 'UpperLeg_L', path: 'rotation', values: rotations(loop([[0.05, 0.08, -0.05], [-0.14, -0.04, 0.07], [0.04, -0.07, 0.04], [0.12, 0.04, -0.05]])) },
      { bone: 'LowerLeg_L', path: 'rotation', values: rotations(loop([[0.04, 0, 0], [0.20, 0.06, 0], [0.08, 0, -0.04], [-0.08, -0.05, 0]])) },
      { bone: 'UpperLeg_R', path: 'rotation', values: rotations(loop([[0.04, -0.07, -0.04], [0.12, -0.04, 0.05], [0.05, 0.08, 0.05], [-0.14, 0.04, -0.07]])) },
      { bone: 'LowerLeg_R', path: 'rotation', values: rotations(loop([[0.08, 0, 0.04], [-0.08, 0.05, 0], [0.04, 0, 0], [0.20, -0.06, 0]])) },
    ],
  },
];

// The hands are the crawler's feet. Keep whichever palm is planted on the
// floor while the other reaches, without lifting the whole cycle into a
// visible hover. These offsets were derived from the same 32-step skinned
// bounds scan used by preview.html, then baked as deterministic Hips keys.
const walkFloorContacts = [
  -0.050385885204756745, -0.041367914005442916, -0.032685824533655664,
  -0.02428217887534284, -0.01586987183304539, -0.007451388632256417,
  -0.006191111968957885, -0.020125623095209058, -0.03269732760180556,
  -0.03571375403756884, -0.038532850442362404, -0.041153136025331535,
  -0.043573365709586406, -0.045792534383582884, -0.04780988053076425,
  -0.04962488922939601, -0.05136799016639351, -0.04272593968824791,
  -0.034400124530349116, -0.0263848245588076, -0.0185672169702287,
  -0.011271187228035232, -0.00691503747467298, -0.019700363828231496,
  -0.03107161769650628, -0.03405553756524046, -0.03685175320343871,
  -0.039458725116897644, -0.04187512269839652, -0.044099828550181575,
  -0.04613194226874415, -0.0481336391284838, -0.050385885204756745,
];
const runFloorContacts = [
  -0.09419970418620675, -0.07465644912920699, -0.05567401112410893,
  -0.036426730980601965, -0.016949051035320337, 0.0027246094138305005,
  -0.001693356226109069, -0.022174712865070625, -0.0388253184576849,
  -0.04779626155853002, -0.05619731453625955, -0.06401166915626601,
  -0.07122427517500814, -0.07782195008494906, -0.08379347631828414,
  -0.08912968505951978, -0.09516901058680258, -0.07600243088833752,
  -0.05742407543509821, -0.038628859587008124, -0.020450854937904703,
  -0.0024934455492728325, -0.0032989394714870446, -0.021827413490383127,
  -0.036362238043713815, -0.04526282128771479, -0.05364274824416816,
  -0.061485696710557716, -0.06877685286938696, -0.07550302058818194,
  -0.08165271521835966, -0.08810922729456723, -0.09419970418620675,
];

function interpolateTranslation(times, values, time) {
  if (time <= times[0]) return values.slice(0, 3);
  for (let index = 0; index < times.length - 1; index++) {
    if (time > times[index + 1] + 1e-9) continue;
    const mix = (time - times[index]) / (times[index + 1] - times[index]);
    return [0, 1, 2].map((axis) => (
      values[index * 3 + axis]
      + (values[(index + 1) * 3 + axis] - values[index * 3 + axis]) * mix
    ));
  }
  return values.slice(-3);
}

function groundCompensate(clip, floorContacts, targetClearance = 0.002) {
  const hipsTrack = clip.tracks.find((track) => track.bone === 'Hips' && track.path === 'translation');
  const originalValues = [...hipsTrack.values];
  const duration = clip.times.at(-1);
  hipsTrack.times = floorContacts.map((_, index) => duration * index / (floorContacts.length - 1));
  hipsTrack.values = hipsTrack.times.flatMap((time, index) => {
    const translation = interpolateTranslation(clip.times, originalValues, time);
    translation[1] += Math.max(0, targetClearance - floorContacts[index]);
    return translation;
  });
}

groundCompensate(clips[1], walkFloorContacts);
groundCompensate(clips[2], runFloorContacts);

// Keep the visible reach honest relative to the runtime's 0.43 m body radius.
// The design was sculpted at human limb proportions, then compressed only in
// the floor plane so hands and gown do not sweep through narrow door frames.
const WIDTH_SCALE = 0.68;
const LENGTH_SCALE = 0.67;
for (let index = 0; index < geometry.positions.length; index += 3) {
  geometry.positions[index] *= WIDTH_SCALE;
  geometry.positions[index + 2] *= LENGTH_SCALE;
  const normal = normalize3([
    geometry.normals[index] / WIDTH_SCALE,
    geometry.normals[index + 1],
    geometry.normals[index + 2] / LENGTH_SCALE,
  ]);
  geometry.normals[index] = normal[0];
  geometry.normals[index + 1] = normal[1];
  geometry.normals[index + 2] = normal[2];
}
for (const joint of bones) {
  joint.translation[0] *= WIDTH_SCALE;
  joint.translation[2] *= LENGTH_SCALE;
}
for (const clip of clips) {
  for (const track of clip.tracks) {
    if (track.path !== 'translation') continue;
    for (let index = 0; index < track.values.length; index += 3) {
      track.values[index] *= WIDTH_SCALE;
      track.values[index + 2] *= LENGTH_SCALE;
    }
  }
}
let bindMinY = Infinity;
for (let index = 1; index < geometry.positions.length; index += 3) {
  bindMinY = Math.min(bindMinY, geometry.positions[index]);
}
for (let index = 1; index < geometry.positions.length; index += 3) {
  geometry.positions[index] -= bindMinY;
}

const result = buildSkinnedGLB({
  bones,
  geometry,
  clips,
  meshNodeName: 'CrawlerMesh',
  meshName: 'Crawler',
  sceneName: 'CrawlerEntity',
  skinName: 'CrawlerRig',
  materialName: 'Crawler_VertexColor',
  nodeExtras: { kind: 'crawler', forwardAxis: '+Z', feetAtOrigin: true, prone: true },
  assetExtras: {
    created: CREATED,
    kind: 'crawler',
    design: 'original prone hospital restraint crawler',
    units: 'metres',
    yUp: true,
    inPlaceAnimations: true,
  },
  meshExtras: { targetHeightMetres: 0.62, topology: 'procedural-low-poly', prone: true },
  roughness: 0.96,
});

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_FILE, result.glb);

const size = result.size;
const manifest = {
  schemaVersion: 1,
  packId: 'codex-original-entity-crawler-v1',
  created: CREATED,
  status: 'review-candidate',
  generator: {
    tool: 'OpenAI Codex deterministic procedural glTF builder',
    script: '../tools/build-crawler.mjs',
    sharedLibrary: '../tools/entity-glb-kit.mjs',
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
    path: 'crawler.glb',
    role: 'rigged-animated-entity',
    kind: 'crawler',
    format: 'glTF 2.0 GLB',
    coordinateSystem: 'Y-up',
    units: 'metres',
    feetAtOrigin: Math.abs(result.bounds.min[1]) < 1e-6,
    prone: true,
    dimensionsMetres: {
      width: Number(size[0].toFixed(6)),
      height: Number(size[1].toFixed(6)),
      length: Number(size[2].toFixed(6)),
      depth: Number(size[2].toFixed(6)),
      min: result.bounds.min.map((value) => Number(value.toFixed(6))),
      max: result.bounds.max.map((value) => Number(value.toFixed(6))),
    },
    vertices: result.vertexCount,
    triangles: result.triangleCount,
    bones: result.boneCount,
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
    bytes: result.glb.byteLength,
    sha256: result.sha256,
  }],
};
writeFileSync(join(OUTPUT_DIR, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  file: OUTPUT_FILE,
  bytes: result.glb.byteLength,
  sha256: result.sha256,
  vertices: result.vertexCount,
  triangles: result.triangleCount,
  bones: result.boneCount,
  materials: 1,
  dimensionsMetres: result.size.map((value) => Number(value.toFixed(4))),
  clips: clips.map((clip) => clip.name),
}, null, 2));
