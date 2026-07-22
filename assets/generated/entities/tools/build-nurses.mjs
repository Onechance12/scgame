#!/usr/bin/env node

import { createHash } from 'node:crypto';
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
const ENTITIES_DIR = join(SCRIPT_DIR, '..');
const RIG_ID = 'original-ward-nurse-rig-v1';
const RAW_GROUND_SCAN = process.argv.includes('--raw-ground-scan');

// Both nurses intentionally share this hierarchy and bind pose. Claude can
// retarget them with the same loader assumptions while each keeps an original
// mesh, palette, silhouette, and animation performance.
const bones = [
  { name: 'Root', parent: -1, translation: [0, 0, 0] },
  { name: 'Hips', parent: 0, translation: [0, 0.91, 0] },
  { name: 'Spine', parent: 1, translation: [0, 0.19, 0] },
  { name: 'Chest', parent: 2, translation: [0, 0.22, 0.005] },
  { name: 'Neck', parent: 3, translation: [0, 0.13, 0.01] },
  { name: 'Head', parent: 4, translation: [0, 0.13, 0.015] },
  { name: 'Jaw', parent: 5, translation: [0, -0.07, 0.09] },
  { name: 'Shoulder_L', parent: 3, translation: [-0.20, 0.055, 0] },
  { name: 'UpperArm_L', parent: 7, translation: [0, 0, 0] },
  { name: 'LowerArm_L', parent: 8, translation: [-0.025, -0.29, 0.015] },
  { name: 'Hand_L', parent: 9, translation: [-0.01, -0.25, 0.015] },
  { name: 'Shoulder_R', parent: 3, translation: [0.20, 0.045, 0] },
  { name: 'UpperArm_R', parent: 11, translation: [0, 0, 0] },
  { name: 'LowerArm_R', parent: 12, translation: [0.025, -0.29, 0.015] },
  { name: 'Hand_R', parent: 13, translation: [0.01, -0.25, 0.015] },
  { name: 'UpperLeg_L', parent: 1, translation: [-0.105, -0.025, 0] },
  { name: 'LowerLeg_L', parent: 15, translation: [0, -0.42, 0] },
  { name: 'Foot_L', parent: 16, translation: [0, -0.405, 0.03] },
  { name: 'Toe_L', parent: 17, translation: [0, 0, 0.12] },
  { name: 'UpperLeg_R', parent: 1, translation: [0.105, -0.025, 0] },
  { name: 'LowerLeg_R', parent: 19, translation: [0, -0.42, 0] },
  { name: 'Foot_R', parent: 20, translation: [0, -0.405, 0.03] },
  { name: 'Toe_R', parent: 21, translation: [0, 0, 0.12] },
  { name: 'SkirtFront', parent: 1, translation: [0, 0.16, 0.025] },
  { name: 'SkirtBack', parent: 1, translation: [0, 0.16, -0.025] },
];

// The initial sculpt was intentionally a little oversized for editing. Apply
// one common vertical normalization to the shared rig and both meshes so the
// files remain genuinely metre-authored at the runtime's 1.78/1.80 m targets.
const VERTICAL_SCALE = 0.968;
for (const joint of bones) joint.translation[1] *= VERTICAL_SCALE;
const RIG_SIGNATURE = createHash('sha256').update(JSON.stringify(
  bones.map(({ name, parent, translation }) => ({ name, parent, translation })),
)).digest('hex');

const bone = Object.fromEntries(bones.map((item, index) => [item.name, index]));

function rotations(frames) {
  return frames.flatMap(([x = 0, y = 0, z = 0]) => quatFromEuler(x, y, z));
}

function translations(frames) {
  return frames.flat();
}

function loop(frames) {
  return [...frames, frames[0]];
}

function scaleVerticalGeometry(geometry) {
  for (let index = 0; index < geometry.positions.length; index += 3) {
    geometry.positions[index + 1] *= VERTICAL_SCALE;
    const normal = normalize3([
      geometry.normals[index],
      geometry.normals[index + 1] / VERTICAL_SCALE,
      geometry.normals[index + 2],
    ]);
    geometry.normals[index] = normal[0];
    geometry.normals[index + 1] = normal[1];
    geometry.normals[index + 2] = normal[2];
  }
}

function scaleVerticalTracks(clips) {
  for (const clip of clips) {
    for (const track of clip.tracks) {
      if (track.path !== 'translation') continue;
      for (let index = 1; index < track.values.length; index += 3) track.values[index] *= VERTICAL_SCALE;
    }
  }
}

function sampleTranslation(times, values, time) {
  let right = 1;
  while (right < times.length - 1 && times[right] < time) right += 1;
  const left = Math.max(0, right - 1);
  const span = times[right] - times[left];
  const mix = span > 0 ? (time - times[left]) / span : 0;
  const output = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const a = values[left * 3 + axis];
    const b = values[right * 3 + axis];
    output.push(a + (b - a) * mix);
  }
  return output;
}

// The procedural gait is authored in-place, but leg/skirt rotation can move a
// vertex below the bind-pose floor between the sparse pose keys. These dense
// Hips tracks are derived from a 65-sample skinned-mesh scan of each finished
// loop. Only upward correction is applied: airborne run frames stay airborne,
// planted frames receive a 3 mm safety clearance, and the matching first/last
// samples preserve seamless looping.
function groundCompensate(clip, contactSamples, clearance = 0.003) {
  const hips = clip.tracks.find((track) => track.bone === 'Hips' && track.path === 'translation');
  if (!hips) throw new Error(`${clip.name} has no Hips translation track`);
  const sourceTimes = hips.times || clip.times;
  const sourceValues = hips.values;
  const duration = clip.times.at(-1);
  const denseTimes = contactSamples.map((_, index) => duration * index / (contactSamples.length - 1));
  const denseValues = [];
  for (let index = 0; index < denseTimes.length; index += 1) {
    const value = sampleTranslation(sourceTimes, sourceValues, denseTimes[index]);
    value[1] += Math.max(0, clearance - contactSamples[index]);
    denseValues.push(...value);
  }
  hips.times = denseTimes;
  hips.values = denseValues;
  clip.groundContactSamples = contactSamples.length;
  clip.groundClearanceMetres = clearance;
}

const locomotionLegFactors = new Map([
  ['UpperLeg_L', 0.20], ['UpperLeg_R', 0.20],
  ['LowerLeg_L', 0.35], ['LowerLeg_R', 0.35],
  ['Foot_L', 0.60], ['Foot_R', 0.60],
  ['Toe_L', 0.60], ['Toe_R', 0.60],
]);

function slerpQuaternionFromIdentity(values, offset, factor) {
  let x = values[offset], y = values[offset + 1], z = values[offset + 2], w = values[offset + 3];
  if (w < 0) { x *= -1; y *= -1; z *= -1; w *= -1; }
  const halfAngle = Math.acos(Math.max(-1, Math.min(1, w)));
  if (halfAngle < 1e-8) return;
  const scale = Math.sin(halfAngle * factor) / Math.sin(halfAngle);
  values[offset] = x * scale;
  values[offset + 1] = y * scale;
  values[offset + 2] = z * scale;
  values[offset + 3] = Math.cos(halfAngle * factor);
}

// Gown silhouettes do not need athletic thigh reach. A tapered constraint
// keeps the upper chain tight enough for safe quaternion crossfades while
// preserving more knee, shoe, and toe articulation in the visible shuffle.
function constrainLocomotionLegExcursion(clips) {
  for (const clip of clips.filter((item) => /walk|run/i.test(item.name))) {
    for (const track of clip.tracks) {
      const factor = locomotionLegFactors.get(track.bone);
      if (track.path !== 'rotation' || factor === undefined) continue;
      for (let offset = 0; offset < track.values.length; offset += 4) {
        slerpQuaternionFromIdentity(track.values, offset, factor);
      }
    }
  }
}

function addEyes(geometry, palette, options = {}) {
  const xOffset = options.xOffset || 0;
  const y = options.y || 1.64;
  const z = options.z || 0.154;
  const spread = options.spread || 0.053;
  geometry.addEllipsoid([xOffset - spread, y + (options.leftLift || 0), z], [0.022, 0.017, 0.009], bone.Head, palette.void, {
    segments: 9, rings: 6, euler: [0, 0, -0.05],
  });
  geometry.addEllipsoid([xOffset + spread, y + (options.rightLift || 0), z], [0.019, 0.015, 0.009], bone.Head, options.rightColor || palette.void, {
    segments: 9, rings: 6, euler: [0, 0, 0.08],
  });
}

function addHandAndFingers(geometry, handBone, center, palette, options = {}) {
  const sign = options.sign || 1;
  const forward = options.forward || 0;
  geometry.addEllipsoid(center, [0.065, 0.085, 0.045], handBone, palette.skin, {
    segments: 10, rings: 7, euler: [options.pitch || 0, 0, sign * (options.roll || 0.04)],
  });
  const count = options.count || 4;
  for (let finger = 0; finger < count; finger++) {
    const lateral = (finger - (count - 1) / 2) * 0.022;
    const start = [center[0] + lateral, center[1] - 0.045, center[2] + 0.018];
    const end = [
      center[0] + lateral * 1.1 + sign * (finger === 0 ? 0.014 : 0),
      center[1] - 0.12 + Math.abs(lateral) * 0.12,
      center[2] + 0.018 + forward,
    ];
    geometry.addTaperedTube(start, end, 0.009, 0.004, handBone, finger === 0 ? palette.nail : palette.skin, { segments: 6 });
  }
}

function addLegs(geometry, palette, options = {}) {
  const leftOffset = options.leftOffset || 0;
  const rightOffset = options.rightOffset || 0;
  const legs = [
    { x: -0.105, kneeX: -0.11 + leftOffset, upper: bone.UpperLeg_L, lower: bone.LowerLeg_L, foot: bone.Foot_L, toe: bone.Toe_L, sign: -1 },
    { x: 0.105, kneeX: 0.11 + rightOffset, upper: bone.UpperLeg_R, lower: bone.LowerLeg_R, foot: bone.Foot_R, toe: bone.Toe_R, sign: 1 },
  ];
  for (const leg of legs) {
    // The runtime deliberately makes these entities translucent. Keep only the
    // ankle section that can emerge below the hem so hidden leg columns do not
    // become visible through the closed skirt shell when depth writes are off.
    geometry.addTaperedTube([leg.kneeX, 0.245, 0.012], [leg.x + leg.sign * 0.008, 0.095, 0.018], 0.052, 0.043, leg.lower, palette.stocking, {
      segments: 9, secondaryJoint: leg.foot, secondaryWeight: 0.10,
    });
    geometry.addEllipsoid([leg.x + leg.sign * 0.008, 0.045, 0.075], [0.078, 0.045, 0.13], leg.foot, palette.shoe, {
      segments: 11, rings: 7, euler: [0, leg.sign * 0.025, 0],
    });
    geometry.addEllipsoid([leg.x + leg.sign * 0.008, 0.038, 0.205], [0.073, 0.038, 0.105], leg.toe, palette.shoe, {
      segments: 10, rings: 7, euler: [0, leg.sign * 0.025, 0],
    });
    geometry.addBox([leg.x + leg.sign * 0.008, 0.025, -0.005], [0.085, 0.05, 0.055], leg.foot, palette.shoe, {
      euler: [0, leg.sign * 0.025, 0],
    });
  }
}

function addSkirtShell(geometry, palette, options = {}) {
  const segments = options.segments || 18;
  const topY = options.topY || 1.08;
  const bottomY = options.bottomY || 0.18;
  const topRadius = options.topRadius || 0.225;
  const bottomRadius = options.bottomRadius || 0.33;
  const depthScale = options.depthScale || 0.76;
  const front = bone.SkirtFront;
  const back = bone.SkirtBack;
  const top = [], bottom = [];
  for (let segment = 0; segment < segments; segment++) {
    const angle = Math.PI * 2 * segment / segments;
    const c = Math.cos(angle), s = Math.sin(angle);
    const frontSide = s >= 0;
    const primary = frontSide ? front : back;
    const secondary = frontSide ? back : front;
    const seamWeight = Math.abs(s) < 0.18 ? 0.42 : 0;
    const color = frontSide ? palette.apron : palette.uniform;
    const hemOffset = options.hemOffsets?.[segment] || 0;
    const normal = [c, (bottomRadius - topRadius) / (topY - bottomY), s / depthScale];
    top.push(geometry.vertex(
      [c * topRadius, topY, s * topRadius * depthScale], normal, color,
      primary, seamWeight ? secondary : null, seamWeight,
    ));
    bottom.push(geometry.vertex(
      [c * bottomRadius, bottomY + hemOffset, s * bottomRadius * depthScale], normal, color,
      primary, seamWeight ? secondary : null, seamWeight,
    ));
  }
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    geometry.triangle(top[segment], bottom[next], bottom[segment]);
    geometry.triangle(top[segment], top[next], bottom[next]);
    const angle = Math.PI * 2 * segment / segments;
    const nextAngle = Math.PI * 2 * next / segments;
    const primary = Math.sin(angle) >= 0 ? front : back;
    const nextPrimary = Math.sin(nextAngle) >= 0 ? front : back;
    const color = Math.sin(angle) >= 0 ? palette.apron : palette.uniform;
    const center = geometry.vertex([0, bottomY + (options.hemOffsets?.[segment] || 0), 0], [0, -1, 0], color, primary,
      primary === nextPrimary ? null : nextPrimary, primary === nextPrimary ? 0 : 0.5);
    geometry.triangle(bottom[segment], bottom[next], center);
  }
}

function buildGreyGeometry() {
  const geometry = new GeometryBuilder();
  const palette = {
    skin: [0.48, 0.53, 0.53, 1],
    skinShadow: [0.27, 0.31, 0.32, 1],
    bruise: [0.18, 0.19, 0.23, 1],
    uniform: [0.42, 0.48, 0.49, 1],
    uniformShadow: [0.22, 0.27, 0.28, 1],
    apron: [0.61, 0.65, 0.63, 1],
    apronShadow: [0.34, 0.39, 0.39, 1],
    hair: [0.055, 0.062, 0.061, 1],
    void: [0.002, 0.003, 0.003, 1],
    chart: [0.13, 0.16, 0.16, 1],
    paper: [0.47, 0.49, 0.45, 1],
    stocking: [0.30, 0.34, 0.34, 1],
    shoe: [0.055, 0.061, 0.061, 1],
    nail: [0.12, 0.14, 0.14, 1],
  };

  geometry.addEllipsoid([0, 1.30, 0], [0.245, 0.23, 0.145], bone.Chest, palette.uniform, {
    segments: 14, rings: 9, secondaryJoint: bone.Spine, secondaryWeight: 0.18,
  });
  // A blended waist volume follows both Hips and Spine. The overlap keeps the
  // closed upper body and independently animated skirt connected through deep
  // bends and action crossfades instead of exposing a black horizontal gap.
  geometry.addEllipsoid([0, 1.135, 0], [0.225, 0.15, 0.14], bone.Hips, palette.uniform, {
    segments: 14, rings: 8, secondaryJoint: bone.Spine, secondaryWeight: 0.45,
  });
  addSkirtShell(geometry, palette, { topY: 1.08, bottomY: 0.18, topRadius: 0.225, bottomRadius: 0.335, depthScale: 0.76, segments: 18 });
  geometry.addBox([0, 1.04, 0.006], [0.45, 0.075, 0.285], bone.Hips, palette.apronShadow);
  for (const x of [-0.12, 0, 0.12]) {
    geometry.addBox([x, 0.64, 0.292 - Math.abs(x) * 0.22], [0.018, 0.74, 0.014], bone.Hips, palette.apronShadow, {
      euler: [0, 0, x * 0.08],
    });
  }

  // A tall split collar and folded ledger-like cap make the silhouette read as
  // this game's ward-counter, without using a medical cross or covered face.
  geometry.addBox([-0.09, 1.43, 0.12], [0.17, 0.12, 0.025], bone.Chest, palette.apron, { euler: [0.08, 0.02, -0.34] });
  geometry.addBox([0.09, 1.43, 0.12], [0.17, 0.12, 0.025], bone.Chest, palette.apronShadow, { euler: [0.08, -0.02, 0.34] });

  const arms = [
    { shoulder: [-0.20, 1.375, 0], elbow: [-0.25, 1.09, 0.07], wrist: [-0.27, 0.84, 0.115], upper: bone.UpperArm_L, lower: bone.LowerArm_L, hand: bone.Hand_L, sign: -1 },
    { shoulder: [0.20, 1.365, 0], elbow: [0.235, 1.08, 0.01], wrist: [0.245, 0.82, 0.02], upper: bone.UpperArm_R, lower: bone.LowerArm_R, hand: bone.Hand_R, sign: 1 },
  ];
  for (const arm of arms) {
    geometry.addEllipsoid(arm.shoulder, [0.09, 0.085, 0.095], arm.upper, palette.uniformShadow, { segments: 10, rings: 7 });
    geometry.addTaperedTube(arm.shoulder, arm.elbow, 0.078, 0.062, arm.upper, palette.uniform, {
      segments: 9, secondaryJoint: arm.lower, secondaryWeight: 0.12,
    });
    geometry.addTaperedTube(arm.elbow, arm.wrist, 0.052, 0.036, arm.lower, palette.skin, {
      segments: 9, secondaryJoint: arm.hand, secondaryWeight: 0.10,
    });
    geometry.addEllipsoid(arm.elbow, [0.061, 0.066, 0.061], arm.lower, palette.skinShadow, {
      segments: 9, rings: 6, secondaryJoint: arm.upper, secondaryWeight: 0.48,
    });
    geometry.addBox([arm.wrist[0], arm.wrist[1] + 0.015, arm.wrist[2]], [0.095, 0.055, 0.09], arm.lower, palette.apronShadow);
  }
  addHandAndFingers(geometry, bone.Hand_L, [-0.275, 0.775, 0.13], palette, { sign: -1, count: 3, forward: 0.012 });
  addHandAndFingers(geometry, bone.Hand_R, [0.248, 0.755, 0.026], palette, { sign: 1, count: 4 });

  // The rigid chart board is part of the mesh and left-hand skin, giving her a
  // unique readable prop without adding a second material or draw call.
  geometry.addBox([-0.28, 0.83, 0.19], [0.21, 0.32, 0.032], bone.Hand_L, palette.chart, { euler: [0.06, -0.05, -0.08] });
  geometry.addBox([-0.28, 0.85, 0.209], [0.17, 0.255, 0.009], bone.Hand_L, palette.paper, { euler: [0.06, -0.05, -0.08] });
  for (let line = 0; line < 4; line++) {
    geometry.addBox([-0.28, 0.93 - line * 0.052, 0.217], [0.115 - line * 0.01, 0.008, 0.006], bone.Hand_L, palette.chart, { euler: [0.06, -0.05, -0.08] });
  }

  addLegs(geometry, palette);

  geometry.addEllipsoid([0, 1.625, 0.025], [0.137, 0.165, 0.13], bone.Head, palette.skin, {
    segments: 15, rings: 10, euler: [0.015, 0.02, -0.015],
  });
  geometry.addEllipsoid([-0.085, 1.645, 0.12], [0.052, 0.038, 0.025], bone.Head, palette.bruise, { segments: 9, rings: 6 });
  addEyes(geometry, palette, { y: 1.646, leftLift: 0.006, rightLift: -0.005 });
  geometry.addTaperedTube([0, 1.63, 0.14], [-0.008, 1.595, 0.185], 0.026, 0.012, bone.Head, palette.skinShadow, { segments: 7 });
  geometry.addBox([0.012, 1.553, 0.158], [0.075, 0.012, 0.012], bone.Jaw, palette.void, { euler: [0, 0.05, -0.04] });
  geometry.addBox([0, 1.770, -0.005], [0.32, 0.055, 0.245], bone.Head, palette.apron, { euler: [-0.06, 0, -0.02] });
  geometry.addBox([-0.095, 1.815, -0.01], [0.105, 0.075, 0.19], bone.Head, palette.apronShadow, { euler: [-0.04, 0.06, 0.02] });
  geometry.addBox([0.085, 1.812, -0.006], [0.095, 0.07, 0.19], bone.Head, palette.apron, { euler: [-0.04, -0.04, -0.03] });

  return { geometry, palette };
}

function buildNightGeometry() {
  const geometry = new GeometryBuilder();
  const palette = {
    skin: [0.35, 0.41, 0.34, 1],
    skinShadow: [0.16, 0.22, 0.18, 1],
    bruise: [0.20, 0.16, 0.22, 1],
    uniform: [0.25, 0.32, 0.28, 1],
    uniformShadow: [0.11, 0.16, 0.14, 1],
    apron: [0.42, 0.48, 0.39, 1],
    apronShadow: [0.20, 0.26, 0.22, 1],
    hair: [0.035, 0.045, 0.038, 1],
    void: [0.001, 0.002, 0.001, 1],
    restraint: [0.09, 0.11, 0.095, 1],
    buckle: [0.38, 0.36, 0.27, 1],
    stocking: [0.19, 0.24, 0.19, 1],
    shoe: [0.035, 0.044, 0.038, 1],
    nail: [0.07, 0.09, 0.07, 1],
  };

  geometry.addEllipsoid([0.02, 1.30, 0.025], [0.255, 0.23, 0.15], bone.Chest, palette.uniform, {
    segments: 14, rings: 9, euler: [0.09, 0.02, -0.035], secondaryJoint: bone.Spine, secondaryWeight: 0.18,
  });
  geometry.addEllipsoid([0.015, 1.135, 0.018], [0.232, 0.155, 0.145], bone.Hips, palette.uniform, {
    segments: 14, rings: 8, euler: [0.05, 0.02, -0.03], secondaryJoint: bone.Spine, secondaryWeight: 0.45,
  });
  addSkirtShell(geometry, palette, {
    topY: 1.08, bottomY: 0.18, topRadius: 0.23, bottomRadius: 0.325, depthScale: 0.78, segments: 18,
    hemOffsets: [0, 0.03, 0.01, 0.08, 0.02, 0.06, 0, 0.04, 0.02, 0, 0.03, 0.06, 0.02, 0.04, 0.01, 0.05, 0.02, 0],
  });
  geometry.addBox([0.01, 1.035, 0.02], [0.45, 0.085, 0.29], bone.Hips, palette.restraint, { euler: [0.03, 0, -0.04] });

  // Three mismatched restraint buckles replace any cross/logo language and
  // identify the Night Nurse as an attendant who has become part of the ward.
  for (let buckleIndex = 0; buckleIndex < 3; buckleIndex++) {
    geometry.addBox([-0.13 + buckleIndex * 0.13, 1.12 - buckleIndex * 0.035, 0.17], [0.075, 0.055, 0.025], bone.Chest, palette.buckle, {
      euler: [0.06, 0.02, -0.12 + buckleIndex * 0.09],
    });
    geometry.addBox([-0.13 + buckleIndex * 0.13, 1.12 - buckleIndex * 0.035, 0.184], [0.038, 0.025, 0.012], bone.Chest, palette.void, {
      euler: [0.06, 0.02, -0.12 + buckleIndex * 0.09],
    });
  }

  const arms = [
    { shoulder: [-0.205, 1.38, 0.025], elbow: [-0.30, 1.11, 0.09], wrist: [-0.33, 0.85, 0.15], upper: bone.UpperArm_L, lower: bone.LowerArm_L, hand: bone.Hand_L, sign: -1, torn: false },
    { shoulder: [0.205, 1.35, 0.025], elbow: [0.285, 1.08, 0.10], wrist: [0.34, 0.83, 0.18], upper: bone.UpperArm_R, lower: bone.LowerArm_R, hand: bone.Hand_R, sign: 1, torn: true },
  ];
  for (const arm of arms) {
    geometry.addEllipsoid(arm.shoulder, [arm.torn ? 0.075 : 0.095, 0.085, 0.10], arm.upper, palette.uniformShadow, { segments: 10, rings: 7 });
    geometry.addTaperedTube(arm.shoulder, arm.elbow, arm.torn ? 0.064 : 0.082, arm.torn ? 0.046 : 0.061, arm.upper, arm.torn ? palette.skinShadow : palette.uniform, {
      segments: 9, secondaryJoint: arm.lower, secondaryWeight: 0.12,
    });
    geometry.addTaperedTube(arm.elbow, arm.wrist, 0.052, 0.034, arm.lower, palette.skin, {
      segments: 9, secondaryJoint: arm.hand, secondaryWeight: 0.10,
    });
    geometry.addEllipsoid(arm.elbow, [0.061, 0.066, 0.061], arm.lower, palette.skinShadow, {
      segments: 9, rings: 6, secondaryJoint: arm.upper, secondaryWeight: 0.48,
    });
    geometry.addBox([arm.wrist[0], arm.wrist[1] + 0.015, arm.wrist[2]], [0.105, 0.065, 0.09], arm.lower, palette.restraint, {
      euler: [0.05, 0, arm.sign * 0.10],
    });
    geometry.addBox([arm.wrist[0] + arm.sign * 0.045, arm.wrist[1] + 0.015, arm.wrist[2] + 0.048], [0.035, 0.042, 0.025], arm.lower, palette.buckle, {
      euler: [0.05, 0, arm.sign * 0.10],
    });
  }
  addHandAndFingers(geometry, bone.Hand_L, [-0.338, 0.785, 0.165], palette, { sign: -1, forward: 0.055, count: 4, pitch: 0.08, roll: 0.08 });
  addHandAndFingers(geometry, bone.Hand_R, [0.345, 0.765, 0.20], palette, { sign: 1, forward: 0.08, count: 4, pitch: 0.14, roll: 0.10 });

  addLegs(geometry, palette, { leftOffset: -0.018, rightOffset: 0.025 });

  geometry.addEllipsoid([0.025, 1.62, 0.035], [0.14, 0.16, 0.13], bone.Head, palette.skin, {
    segments: 15, rings: 10, euler: [0.04, -0.03, 0.055],
  });
  geometry.addEllipsoid([0.10, 1.63, 0.125], [0.058, 0.075, 0.034], bone.Head, palette.bruise, {
    segments: 9, rings: 6, euler: [0.04, -0.16, 0.12],
  });
  addEyes(geometry, palette, { xOffset: 0.025, y: 1.638, z: 0.161, spread: 0.052, leftLift: -0.004, rightLift: 0.008, rightColor: palette.bruise });
  geometry.addTaperedTube([0.025, 1.62, 0.15], [0.045, 1.58, 0.195], 0.027, 0.011, bone.Head, palette.skinShadow, { segments: 7 });
  geometry.addEllipsoid([0.045, 1.535, 0.135], [0.105, 0.052, 0.085], bone.Jaw, palette.skinShadow, {
    segments: 11, rings: 7, euler: [0.18, 0.05, -0.08],
  });
  geometry.addBox([0.045, 1.555, 0.193], [0.10, 0.012, 0.012], bone.Jaw, palette.void, { euler: [0.12, 0.05, -0.08] });
  geometry.addBox([-0.035, 1.765, 0.005], [0.29, 0.052, 0.23], bone.Head, palette.apronShadow, { euler: [-0.08, 0.04, 0.22] });
  geometry.addBox([0.025, 1.805, 0.005], [0.22, 0.045, 0.17], bone.Head, palette.apron, { euler: [-0.08, 0.04, 0.20] });

  return { geometry, palette };
}

function greyClips() {
  const idleTimes = [0, 0.56, 1.12, 1.68, 2.24, 2.80];
  const walkTimes = [0, 0.26, 0.52, 0.78, 1.04];
  const runTimes = [0, 0.21, 0.42, 0.63, 0.84];
  return [
    {
      name: 'idle_ward_counting', times: idleTimes, nominalSpeedMps: 0,
      tracks: [
        { bone: 'Hips', path: 'translation', values: translations(loop([[0, 0.91, 0], [0, 0.914, 0], [0, 0.91, 0], [0, 0.906, 0], [0, 0.91, 0]])) },
        { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.01, 0, -0.012], [0.018, -0.01, -0.006], [0.008, 0.012, 0.008], [-0.012, 0, 0.014], [0.006, -0.006, -0.008]])) },
        { bone: 'Chest', path: 'rotation', values: rotations(loop([[-0.01, 0, 0.012], [-0.018, 0.008, 0.006], [-0.008, -0.01, -0.008], [0.01, 0, -0.012], [-0.006, 0.005, 0.008]])) },
        { bone: 'Head', path: 'rotation', values: rotations(loop([[0.015, -0.10, -0.025], [0.005, -0.06, -0.012], [0.018, 0.02, 0.01], [-0.01, 0.08, 0.025], [0.012, -0.04, -0.018]])) },
        { bone: 'Jaw', path: 'rotation', values: rotations(loop([[0.02, 0, 0], [0.025, 0, 0], [0.02, 0, 0], [0.032, 0, 0], [0.02, 0, 0]])) },
        { bone: 'SkirtFront', path: 'rotation', values: rotations(loop([[0, 0, 0], [0.006, 0, 0], [0, 0, 0], [-0.005, 0, 0], [0, 0, 0]])) },
        { bone: 'SkirtBack', path: 'rotation', values: rotations(loop([[0, 0, 0], [-0.005, 0, 0], [0, 0, 0], [0.006, 0, 0], [0, 0, 0]])) },
        { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.10, 0, -0.04], [-0.08, 0.01, -0.03], [-0.11, 0, -0.04], [-0.09, -0.01, -0.05], [-0.10, 0, -0.04]])) },
        { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.28, 0.02, 0.04], [0.30, 0, 0.035], [0.27, -0.02, 0.04], [0.31, 0, 0.05], [0.28, 0.02, 0.04]])) },
        { bone: 'Hand_L', path: 'rotation', values: rotations(loop([[0, 0, -0.03], [0.015, 0, -0.025], [0, 0, -0.035], [-0.012, 0, -0.03], [0, 0, -0.03]])) },
        { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[0.01, 0, 0.025], [0.02, 0, 0.018], [0.005, 0, 0.028], [-0.015, 0, 0.032], [0.01, 0, 0.025]])) },
        { bone: 'Hand_R', path: 'rotation', values: rotations(loop([[0, 0, 0.02], [0, 0.01, 0.01], [0, 0, 0.025], [0, -0.01, 0.015], [0, 0, 0.02]])) },
      ],
    },
    {
      name: 'walk_ward_round_in_place_1p1mps', times: walkTimes, nominalSpeedMps: 1.1,
      tracks: [
        { bone: 'Hips', path: 'translation', values: translations(loop([[0.008, 0.91, 0], [0, 0.925, 0], [-0.008, 0.91, 0], [0, 0.923, 0]])) },
        { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.035, 0.035, -0.025], [0.015, 0, 0], [0.035, -0.035, 0.025], [0.015, 0, 0]])) },
        { bone: 'Chest', path: 'rotation', values: rotations(loop([[-0.025, -0.03, 0.02], [-0.01, 0, 0], [-0.025, 0.03, -0.02], [-0.01, 0, 0]])) },
        { bone: 'Head', path: 'rotation', values: rotations(loop([[0.005, -0.08, -0.02], [0.02, -0.03, 0], [0.005, 0.04, 0.02], [0.02, -0.02, 0]])) },
        { bone: 'UpperLeg_L', path: 'rotation', values: rotations(loop([[-0.34, 0, -0.015], [0.04, 0, 0], [0.34, 0, 0.015], [-0.06, 0, 0]])) },
        { bone: 'LowerLeg_L', path: 'rotation', values: rotations(loop([[0.10, 0, 0], [0.38, 0, 0], [0.08, 0, 0], [0.22, 0, 0]])) },
        { bone: 'Foot_L', path: 'rotation', values: rotations(loop([[-0.06, 0, 0], [0.14, 0, 0], [0.05, 0, 0], [-0.10, 0, 0]])) },
        { bone: 'UpperLeg_R', path: 'rotation', values: rotations(loop([[0.34, 0, 0.015], [-0.06, 0, 0], [-0.34, 0, -0.015], [0.04, 0, 0]])) },
        { bone: 'LowerLeg_R', path: 'rotation', values: rotations(loop([[0.08, 0, 0], [0.22, 0, 0], [0.10, 0, 0], [0.38, 0, 0]])) },
        { bone: 'Foot_R', path: 'rotation', values: rotations(loop([[0.05, 0, 0], [-0.10, 0, 0], [-0.06, 0, 0], [0.14, 0, 0]])) },
        { bone: 'Toe_L', path: 'rotation', values: rotations(loop([[-0.04, 0, 0], [0.10, 0, 0], [0.03, 0, 0], [-0.08, 0, 0]])) },
        { bone: 'Toe_R', path: 'rotation', values: rotations(loop([[0.03, 0, 0], [-0.08, 0, 0], [-0.04, 0, 0], [0.10, 0, 0]])) },
        { bone: 'SkirtFront', path: 'rotation', values: rotations(loop([[0.012, 0, 0], [-0.02, 0, 0], [0.012, 0, 0], [-0.018, 0, 0]])) },
        { bone: 'SkirtBack', path: 'rotation', values: rotations(loop([[-0.01, 0, 0], [0.018, 0, 0], [-0.01, 0, 0], [0.016, 0, 0]])) },
        { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.12, 0, -0.05], [-0.08, 0, -0.04], [-0.06, 0, -0.03], [-0.10, 0, -0.04]])) },
        { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.30, 0, 0.04], [0.28, 0, 0.04], [0.32, 0, 0.05], [0.29, 0, 0.04]])) },
        { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[-0.22, 0, 0.03], [0, 0, 0.02], [0.22, 0, 0.03], [0, 0, 0.02]])) },
        { bone: 'LowerArm_R', path: 'rotation', values: rotations(loop([[0.12, 0, 0], [0.04, 0, 0], [0.12, 0, 0], [0.20, 0, 0]])) },
      ],
    },
    {
      name: 'run_procession_in_place_2p5mps', times: runTimes, nominalSpeedMps: 2.5,
      tracks: [
        { bone: 'Hips', path: 'translation', values: translations(loop([[0.012, 0.91, 0], [0, 0.945, 0], [-0.012, 0.91, 0], [0, 0.94, 0]])) },
        { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.10, 0.07, -0.045], [0.06, 0, 0], [0.10, -0.07, 0.045], [0.06, 0, 0]])) },
        { bone: 'Chest', path: 'rotation', values: rotations(loop([[-0.02, -0.055, 0.04], [0.01, 0, 0], [-0.02, 0.055, -0.04], [0.01, 0, 0]])) },
        { bone: 'Head', path: 'rotation', values: rotations(loop([[-0.04, -0.10, -0.03], [-0.02, -0.02, 0], [-0.04, 0.08, 0.03], [-0.02, -0.02, 0]])) },
        { bone: 'UpperLeg_L', path: 'rotation', values: rotations(loop([[-0.62, 0, -0.02], [0.08, 0, 0], [0.62, 0, 0.02], [-0.10, 0, 0]])) },
        { bone: 'LowerLeg_L', path: 'rotation', values: rotations(loop([[0.16, 0, 0], [0.62, 0, 0], [0.10, 0, 0], [0.38, 0, 0]])) },
        { bone: 'Foot_L', path: 'rotation', values: rotations(loop([[-0.12, 0, 0], [0.24, 0, 0], [0.08, 0, 0], [-0.18, 0, 0]])) },
        { bone: 'UpperLeg_R', path: 'rotation', values: rotations(loop([[0.62, 0, 0.02], [-0.10, 0, 0], [-0.62, 0, -0.02], [0.08, 0, 0]])) },
        { bone: 'LowerLeg_R', path: 'rotation', values: rotations(loop([[0.10, 0, 0], [0.38, 0, 0], [0.16, 0, 0], [0.62, 0, 0]])) },
        { bone: 'Foot_R', path: 'rotation', values: rotations(loop([[0.08, 0, 0], [-0.18, 0, 0], [-0.12, 0, 0], [0.24, 0, 0]])) },
        { bone: 'Toe_L', path: 'rotation', values: rotations(loop([[-0.08, 0, 0], [0.18, 0, 0], [0.05, 0, 0], [-0.14, 0, 0]])) },
        { bone: 'Toe_R', path: 'rotation', values: rotations(loop([[0.05, 0, 0], [-0.14, 0, 0], [-0.08, 0, 0], [0.18, 0, 0]])) },
        { bone: 'SkirtFront', path: 'rotation', values: rotations(loop([[0.025, 0, 0], [-0.045, 0, 0], [0.025, 0, 0], [-0.04, 0, 0]])) },
        { bone: 'SkirtBack', path: 'rotation', values: rotations(loop([[-0.02, 0, 0], [0.04, 0, 0], [-0.02, 0, 0], [0.035, 0, 0]])) },
        { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.16, 0, -0.06], [-0.10, 0, -0.05], [-0.05, 0, -0.03], [-0.11, 0, -0.05]])) },
        { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.34, 0, 0.05], [0.30, 0, 0.04], [0.38, 0, 0.06], [0.31, 0, 0.05]])) },
        { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[-0.48, 0, 0.04], [0.04, 0, 0.02], [0.48, 0, 0.04], [0.02, 0, 0.02]])) },
        { bone: 'LowerArm_R', path: 'rotation', values: rotations(loop([[0.22, 0, 0], [0.08, 0, 0], [0.22, 0, 0], [0.36, 0, 0]])) },
      ],
    },
  ];
}

function nightClips() {
  const idleTimes = [0, 0.48, 0.96, 1.44, 1.92, 2.40];
  const walkTimes = [0, 0.25, 0.50, 0.75, 1.00];
  const runTimes = [0, 0.2025, 0.405, 0.6075, 0.81];
  return [
    {
      name: 'idle_fever_tremor', times: idleTimes, nominalSpeedMps: 0,
      tracks: [
        { bone: 'Hips', path: 'translation', values: translations(loop([[0, 0.91, 0], [0.003, 0.916, 0], [-0.002, 0.908, 0], [0.002, 0.914, 0], [-0.003, 0.909, 0]])) },
        { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.12, 0, -0.03], [0.145, -0.02, -0.012], [0.105, 0.018, 0.02], [0.15, -0.012, 0.035], [0.115, 0.01, -0.025]])) },
        { bone: 'Chest', path: 'rotation', values: rotations(loop([[0.07, 0.02, 0.045], [0.045, -0.015, 0.02], [0.09, 0.01, -0.025], [0.04, -0.02, -0.04], [0.075, 0.015, 0.035]])) },
        { bone: 'Head', path: 'rotation', values: rotations(loop([[-0.08, -0.12, 0.08], [-0.04, -0.06, 0.12], [-0.11, 0.04, 0.05], [-0.03, 0.10, 0.14], [-0.09, -0.04, 0.07]])) },
        { bone: 'Jaw', path: 'rotation', values: rotations(loop([[0.04, 0, -0.02], [0.08, 0.01, -0.03], [0.03, -0.01, -0.015], [0.09, 0, -0.035], [0.05, 0.01, -0.02]])) },
        { bone: 'SkirtFront', path: 'rotation', values: rotations(loop([[0, 0, 0], [0.01, 0, -0.004], [-0.005, 0, 0.004], [0.012, 0, -0.005], [-0.004, 0, 0.003]])) },
        { bone: 'SkirtBack', path: 'rotation', values: rotations(loop([[0, 0, 0], [-0.008, 0, 0.003], [0.005, 0, -0.003], [-0.01, 0, 0.004], [0.004, 0, -0.002]])) },
        { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.16, 0.02, -0.03], [-0.20, 0, -0.02], [-0.12, -0.02, -0.04], [-0.22, 0.01, -0.025], [-0.15, 0, -0.035]])) },
        { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.24, 0, 0.06], [0.32, 0.02, 0.04], [0.20, -0.02, 0.08], [0.35, 0, 0.03], [0.25, 0, 0.06]])) },
        { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[-0.08, -0.02, 0.035], [-0.14, 0, 0.025], [-0.06, 0.02, 0.04], [-0.16, -0.01, 0.02], [-0.09, 0, 0.035]])) },
        { bone: 'LowerArm_R', path: 'rotation', values: rotations(loop([[0.16, 0, -0.05], [0.24, -0.02, -0.03], [0.12, 0.02, -0.07], [0.28, 0, -0.02], [0.17, 0, -0.05]])) },
        { bone: 'Hand_R', path: 'rotation', values: rotations(loop([[0.08, 0, 0.06], [0.16, 0.02, 0.03], [0.04, -0.02, 0.08], [0.18, 0, 0.02], [0.09, 0, 0.06]])) },
      ],
    },
    {
      name: 'walk_restraint_limp_in_place_1p1mps', times: walkTimes, nominalSpeedMps: 1.1,
      tracks: [
        { bone: 'Hips', path: 'translation', values: translations(loop([[0.010, 0.91, 0], [0, 0.927, 0], [-0.007, 0.91, 0], [0, 0.919, 0]])) },
        { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.17, 0.05, -0.055], [0.13, 0, -0.01], [0.17, -0.04, 0.04], [0.14, 0, 0.015]])) },
        { bone: 'Chest', path: 'rotation', values: rotations(loop([[0.10, -0.04, 0.055], [0.07, 0, 0.015], [0.10, 0.035, -0.04], [0.075, 0, -0.01]])) },
        { bone: 'Head', path: 'rotation', values: rotations(loop([[-0.12, -0.10, 0.08], [-0.07, -0.03, 0.04], [-0.12, 0.08, 0.12], [-0.06, 0.02, 0.05]])) },
        { bone: 'Jaw', path: 'rotation', values: rotations(loop([[0.07, 0, -0.025], [0.04, 0, -0.015], [0.08, 0, -0.03], [0.04, 0, -0.015]])) },
        { bone: 'UpperLeg_L', path: 'rotation', values: rotations(loop([[-0.28, 0, -0.025], [0.02, 0, 0], [0.25, 0, 0.03], [-0.04, 0, 0]])) },
        { bone: 'LowerLeg_L', path: 'rotation', values: rotations(loop([[0.18, 0, 0.02], [0.44, 0, 0], [0.10, 0, -0.02], [0.26, 0, 0]])) },
        { bone: 'Foot_L', path: 'rotation', values: rotations(loop([[-0.08, 0, 0.03], [0.16, 0, 0], [0.06, 0, -0.03], [-0.12, 0, 0]])) },
        { bone: 'UpperLeg_R', path: 'rotation', values: rotations(loop([[0.38, 0, 0.035], [-0.08, 0, 0], [-0.40, 0, -0.035], [0.04, 0, 0]])) },
        { bone: 'LowerLeg_R', path: 'rotation', values: rotations(loop([[0.08, 0, -0.02], [0.20, 0, 0], [0.14, 0, 0.02], [0.50, 0, 0]])) },
        { bone: 'Foot_R', path: 'rotation', values: rotations(loop([[0.06, 0, -0.03], [-0.10, 0, 0], [-0.10, 0, 0.03], [0.20, 0, 0]])) },
        { bone: 'Toe_L', path: 'rotation', values: rotations(loop([[-0.06, 0, 0.02], [0.13, 0, 0], [0.04, 0, -0.02], [-0.10, 0, 0]])) },
        { bone: 'Toe_R', path: 'rotation', values: rotations(loop([[0.04, 0, -0.02], [-0.08, 0, 0], [-0.07, 0, 0.02], [0.16, 0, 0]])) },
        { bone: 'SkirtFront', path: 'rotation', values: rotations(loop([[0.035, 0, -0.01], [-0.055, 0, 0], [0.03, 0, 0.01], [-0.04, 0, 0]])) },
        { bone: 'SkirtBack', path: 'rotation', values: rotations(loop([[-0.03, 0, 0.008], [0.045, 0, 0], [-0.025, 0, -0.008], [0.035, 0, 0]])) },
        { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.34, 0.04, -0.045], [-0.12, 0, -0.03], [0.16, -0.04, -0.01], [-0.08, 0, -0.03]])) },
        { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.34, 0, 0.08], [0.20, 0, 0.05], [0.30, 0, 0.02], [0.42, 0, 0.06]])) },
        { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[0.18, -0.03, 0.035], [-0.10, 0, 0.025], [-0.38, 0.04, 0.05], [-0.12, 0, 0.03]])) },
        { bone: 'LowerArm_R', path: 'rotation', values: rotations(loop([[0.24, 0, -0.05], [0.36, 0, -0.03], [0.30, 0, -0.08], [0.18, 0, -0.04]])) },
      ],
    },
    {
      name: 'run_cold_charge_in_place_2p5mps', times: runTimes, nominalSpeedMps: 2.5,
      tracks: [
        { bone: 'Hips', path: 'translation', values: translations(loop([[0.014, 0.91, 0], [0, 0.95, 0], [-0.014, 0.91, 0], [0, 0.946, 0]])) },
        { bone: 'Spine', path: 'rotation', values: rotations(loop([[0.31, 0.08, -0.07], [0.26, 0, -0.025], [0.31, -0.08, 0.07], [0.26, 0, 0.025]])) },
        { bone: 'Chest', path: 'rotation', values: rotations(loop([[0.20, -0.06, 0.07], [0.15, 0, 0.02], [0.20, 0.06, -0.07], [0.15, 0, -0.02]])) },
        { bone: 'Head', path: 'rotation', values: rotations(loop([[-0.22, -0.13, 0.10], [-0.17, -0.03, 0.06], [-0.22, 0.12, 0.15], [-0.17, 0.03, 0.07]])) },
        { bone: 'Jaw', path: 'rotation', values: rotations(loop([[0.10, 0, -0.035], [0.06, 0, -0.025], [0.11, 0, -0.04], [0.06, 0, -0.025]])) },
        { bone: 'UpperLeg_L', path: 'rotation', values: rotations(loop([[-0.76, 0, -0.03], [0.12, 0, 0], [0.74, 0, 0.03], [-0.14, 0, 0]])) },
        { bone: 'LowerLeg_L', path: 'rotation', values: rotations(loop([[0.22, 0, 0], [0.78, 0, 0], [0.12, 0, 0], [0.48, 0, 0]])) },
        { bone: 'Foot_L', path: 'rotation', values: rotations(loop([[-0.14, 0, 0], [0.30, 0, 0], [0.10, 0, 0], [-0.22, 0, 0]])) },
        { bone: 'UpperLeg_R', path: 'rotation', values: rotations(loop([[0.74, 0, 0.03], [-0.14, 0, 0], [-0.76, 0, -0.03], [0.12, 0, 0]])) },
        { bone: 'LowerLeg_R', path: 'rotation', values: rotations(loop([[0.12, 0, 0], [0.48, 0, 0], [0.22, 0, 0], [0.78, 0, 0]])) },
        { bone: 'Foot_R', path: 'rotation', values: rotations(loop([[0.10, 0, 0], [-0.22, 0, 0], [-0.14, 0, 0], [0.30, 0, 0]])) },
        { bone: 'Toe_L', path: 'rotation', values: rotations(loop([[-0.10, 0, 0], [0.22, 0, 0], [0.07, 0, 0], [-0.16, 0, 0]])) },
        { bone: 'Toe_R', path: 'rotation', values: rotations(loop([[0.07, 0, 0], [-0.16, 0, 0], [-0.10, 0, 0], [0.22, 0, 0]])) },
        { bone: 'SkirtFront', path: 'rotation', values: rotations(loop([[0.065, 0, -0.015], [-0.09, 0, 0], [0.06, 0, 0.015], [-0.08, 0, 0]])) },
        { bone: 'SkirtBack', path: 'rotation', values: rotations(loop([[-0.055, 0, 0.012], [0.075, 0, 0], [-0.05, 0, -0.012], [0.065, 0, 0]])) },
        { bone: 'UpperArm_L', path: 'rotation', values: rotations(loop([[-0.72, 0.08, -0.06], [-0.58, 0, -0.04], [-0.48, -0.08, -0.03], [-0.62, 0, -0.05]])) },
        { bone: 'LowerArm_L', path: 'rotation', values: rotations(loop([[0.58, 0, 0.12], [0.44, 0, 0.09], [0.52, 0, 0.06], [0.66, 0, 0.11]])) },
        { bone: 'UpperArm_R', path: 'rotation', values: rotations(loop([[-1.02, -0.08, 0.06], [-0.92, 0, 0.045], [-1.08, 0.08, 0.07], [-0.94, 0, 0.05]])) },
        { bone: 'LowerArm_R', path: 'rotation', values: rotations(loop([[0.24, 0, -0.10], [0.34, 0, -0.07], [0.18, 0, -0.12], [0.30, 0, -0.08]])) },
        { bone: 'Hand_R', path: 'rotation', values: rotations(loop([[0.18, 0, 0.10], [0.10, 0, 0.07], [0.22, 0, 0.12], [0.12, 0, 0.08]])) },
      ],
    },
  ];
}

function createManifest(spec, result) {
  return {
    schemaVersion: 1,
    packId: `codex-original-entity-${spec.kind}-v1`,
    created: CREATED,
    status: 'review-candidate',
    generator: {
      tool: 'OpenAI Codex deterministic procedural glTF builder',
      script: '../tools/build-nurses.mjs',
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
      path: `${spec.kind}.glb`,
      role: 'rigged-animated-entity',
      kind: spec.kind,
      displayName: spec.displayName,
      rigId: RIG_ID,
      rigSignatureSha256: RIG_SIGNATURE,
      format: 'glTF 2.0 GLB',
      coordinateSystem: 'Y-up',
      units: 'metres',
      feetAtOrigin: Math.abs(result.bounds.min[1]) < 1e-6,
      upright: true,
      dimensionsMetres: {
        width: Number(result.size[0].toFixed(6)),
        height: Number(result.size[1].toFixed(6)),
        depth: Number(result.size[2].toFixed(6)),
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
      clips: spec.clips.map((clip) => ({
        name: clip.name,
        durationSeconds: clip.times.at(-1),
        inPlace: true,
        nominalSpeedMps: clip.nominalSpeedMps,
        ...(clip.groundContactSamples ? {
          groundContactSamples: clip.groundContactSamples,
          groundCompensationTargetMetres: clip.groundClearanceMetres,
        } : {}),
      })),
      bytes: result.glb.byteLength,
      sha256: result.sha256,
    }],
  };
}

function buildNurse(spec) {
  const outputDir = join(ENTITIES_DIR, spec.kind);
  const outputFile = join(outputDir, `${spec.kind}.glb`);
  const result = buildSkinnedGLB({
    bones,
    geometry: spec.geometry,
    clips: spec.clips,
    meshNodeName: `${spec.nodePrefix}Mesh`,
    meshName: spec.displayName,
    sceneName: `${spec.nodePrefix}Entity`,
    skinName: 'OriginalWardNurseRig',
    materialName: `${spec.nodePrefix}_VertexColor`,
    nodeExtras: { kind: spec.kind, forwardAxis: '+Z', feetAtOrigin: true, upright: true, rigId: RIG_ID },
    assetExtras: {
      created: CREATED,
      kind: spec.kind,
      design: spec.design,
      rigId: RIG_ID,
      rigSignatureSha256: RIG_SIGNATURE,
      units: 'metres',
      yUp: true,
      inPlaceAnimations: true,
    },
    meshExtras: { targetHeightMetres: spec.targetHeight, topology: 'procedural-low-poly', upright: true, rigId: RIG_ID },
    roughness: spec.roughness,
  });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputFile, result.glb);
  writeFileSync(join(outputDir, 'asset-manifest.json'), `${JSON.stringify(createManifest(spec, result), null, 2)}\n`);
  return {
    file: outputFile,
    bytes: result.glb.byteLength,
    sha256: result.sha256,
    vertices: result.vertexCount,
    triangles: result.triangleCount,
    bones: result.boneCount,
    materials: 1,
    dimensionsMetres: result.size.map((value) => Number(value.toFixed(4))),
    clips: spec.clips.map((clip) => clip.name),
  };
}

const grey = buildGreyGeometry();
const night = buildNightGeometry();
scaleVerticalGeometry(grey.geometry);
scaleVerticalGeometry(night.geometry);
const greyAnimations = greyClips();
const nightAnimations = nightClips();
constrainLocomotionLegExcursion(greyAnimations);
constrainLocomotionLegExcursion(nightAnimations);
scaleVerticalTracks(greyAnimations);
scaleVerticalTracks(nightAnimations);

const groundContacts = {
  greyIdle: [
    0, 0.000302498, 0.000604996, 0.000907495, 0.001209993, 0.001512491, 0.001814989, 0.002117488,
    0.002419986, 0.002722484, 0.003024982, 0.003327480, 0.003629979, 0.003811478, 0.003508980, 0.003206481,
    0.002903983, 0.002601485, 0.002298987, 0.001996488, 0.001693990, 0.001391492, 0.001088994, 0.000786496,
    0.000483997, 0.000181499, -0.000120999, -0.000423497, -0.000725996, -0.001028494, -0.001330992, -0.001633490,
    -0.001935989, -0.002238487, -0.002540985, -0.002843483, -0.003145982, -0.003448480, -0.003750978, -0.003690478,
    -0.003387980, -0.003085482, -0.002782984, -0.002480485, -0.002177987, -0.001875489, -0.001572991, -0.001270493,
    -0.000967995, -0.000665496, -0.000362998, -0.000060500, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  greyWalk: [
    -0.025146366, -0.022432426, -0.019696879, -0.016939919, -0.014161741, -0.011362542, -0.008944256, -0.006616024,
    -0.008509256, -0.012100690, -0.015595800, -0.018992647, -0.022289321, -0.025483939, -0.028574652, -0.031559639,
    -0.034463366, -0.033973237, -0.033493359, -0.032997560, -0.032485925, -0.031958537, -0.031415482, -0.030856843,
    -0.030282708, -0.029693162, -0.029088292, -0.028468187, -0.027832933, -0.027182621, -0.026517339, -0.025837177,
    -0.025142225, -0.022549539, -0.019935246, -0.017299541, -0.014642618, -0.011964674, -0.009699848, -0.007489665,
    -0.009475157, -0.013187847, -0.016804214, -0.020322318, -0.023740249, -0.027056124, -0.030268095, -0.033374340,
    -0.036399325, -0.035788459, -0.035187843, -0.034571307, -0.033938934, -0.033290809, -0.032627015, -0.031947638,
    -0.031252764, -0.030542479, -0.029816871, -0.029076026, -0.028320034, -0.027548982, -0.026762960, -0.025962058,
    -0.025146366,
  ],
  greyRun: [
    -0.039318227, -0.034590190, -0.029793440, -0.024928836, -0.019997252, -0.014999579, -0.009936718, -0.004809586,
    -0.008133376, -0.013619455, -0.018788885, -0.023631435, -0.029325452, -0.035011575, -0.040337254, -0.045290897,
    -0.049861294, -0.049492301, -0.049067588, -0.048587661, -0.048053032, -0.047464219, -0.046821750, -0.046126158,
    -0.045377982, -0.044577770, -0.043726074, -0.042823455, -0.041870479, -0.040917651, -0.040431359, -0.039896296,
    -0.039312917, -0.034887705, -0.030393780, -0.025832002, -0.021203247, -0.016508403, -0.011748373, -0.006924072,
    -0.010550690, -0.016339602, -0.021811867, -0.026957253, -0.032940639, -0.038932952, -0.044564831, -0.049824686,
    -0.054701305, -0.054033518, -0.053309998, -0.052531254, -0.051697800, -0.050810154, -0.049868842, -0.048874397,
    -0.047827360, -0.046728276, -0.045577699, -0.044376189, -0.043124311, -0.041829486, -0.041041020, -0.040203782,
    -0.039318227,
  ],
  nightIdle: [
    0, 0.000453750, 0.000907499, 0.001361249, 0.001814999, 0.002268748, 0.002722498, 0.003176248,
    0.003629998, 0.004083747, 0.004537497, 0.004991247, 0.005444996, 0.005686995, 0.005081994, 0.004476993,
    0.003871992, 0.003266990, 0.002661989, 0.002056988, 0.001451987, 0.000846986, 0.000241985, -0.000363016,
    -0.000968018, -0.001573019, -0.001754518, -0.001300768, -0.000847019, -0.000393269, 0.000060481, 0.000514230,
    0.000967980, 0.001421729, 0.001875479, 0.002329229, 0.002782978, 0.003236728, 0.003690477, 0.003645104,
    0.003266983, 0.002888861, 0.002510739, 0.002132617, 0.001754496, 0.001376374, 0.000998252, 0.000620131,
    0.000242009, -0.000136113, -0.000514235, -0.000892356, -0.000907480, -0.000831857, -0.000756234, -0.000680610,
    -0.000604987, -0.000529364, -0.000453740, -0.000378117, -0.000302493, -0.000226870, -0.000151247, -0.000075623,
    0,
  ],
  nightWalk: [
    -0.028731201, -0.025586852, -0.022410809, -0.019203396, -0.015964937, -0.012695762, -0.009396202, -0.010701163,
    -0.014207296, -0.017624678, -0.020951097, -0.024184374, -0.027322368, -0.030370528, -0.033362644, -0.037045646,
    -0.040775499, -0.039675229, -0.038549764, -0.037399349, -0.036224233, -0.035348404, -0.034536413, -0.033700285,
    -0.032840218, -0.031956412, -0.031049071, -0.030118399, -0.029164601, -0.028187885, -0.027188462, -0.026166541,
    -0.025122337, -0.022740754, -0.020343023, -0.017929349, -0.015499938, -0.013054999, -0.010915153, -0.012604434,
    -0.018171278, -0.023573435, -0.028805837, -0.033863524, -0.038741643, -0.044019223, -0.049720373, -0.055226308,
    -0.060531344, -0.058513393, -0.056454987, -0.054356593, -0.052218686, -0.050079244, -0.047940987, -0.045765022,
    -0.043633735, -0.041896174, -0.040122069, -0.038311793, -0.036465724, -0.034584243, -0.032667735, -0.030716590,
    -0.028731201,
  ],
  nightRun: [
    -0.046588841, -0.040969266, -0.035565830, -0.030060444, -0.024454566, -0.018749682, -0.012947310, -0.007182747,
    -0.014140149, -0.020611823, -0.027111343, -0.034434743, -0.041211541, -0.047420140, -0.053039824, -0.058050807,
    -0.062434277, -0.062122480, -0.061714649, -0.061211758, -0.060614802, -0.059924797, -0.059142778, -0.058269802,
    -0.057306945, -0.056255302, -0.055115989, -0.053890140, -0.052578905, -0.051183454, -0.049704976, -0.048144674,
    -0.046503770, -0.041203963, -0.036042998, -0.030780087, -0.025416686, -0.019954282, -0.014394392, -0.008872326,
    -0.016072213, -0.022786374, -0.029498760, -0.037069531, -0.044093727, -0.050549750, -0.056416884, -0.061675341,
    -0.066306309, -0.065757973, -0.065113581, -0.064374112, -0.063540559, -0.062613938, -0.061595285, -0.060485656,
    -0.059286127, -0.057997793, -0.056621768, -0.055159186, -0.053611199, -0.051978975, -0.050263702, -0.048466584,
    -0.046588841,
  ],
};

if (!RAW_GROUND_SCAN) {
  groundCompensate(greyAnimations[0], groundContacts.greyIdle);
  groundCompensate(greyAnimations[1], groundContacts.greyWalk);
  groundCompensate(greyAnimations[2], groundContacts.greyRun);
  groundCompensate(nightAnimations[0], groundContacts.nightIdle);
  groundCompensate(nightAnimations[1], groundContacts.nightWalk);
  groundCompensate(nightAnimations[2], groundContacts.nightRun);
}
const outputs = [
  buildNurse({
    kind: 'nurse',
    displayName: 'Grey Nurse',
    nodePrefix: 'GreyNurse',
    design: 'original pale ward-counter with ledger cap and forearm chart board',
    targetHeight: 1.78,
    geometry: grey.geometry,
    clips: greyAnimations,
    roughness: 0.95,
  }),
  buildNurse({
    kind: 'nurse2',
    displayName: 'Night Nurse',
    nodePrefix: 'NightNurse',
    design: 'original sickly restraint attendant with collapsed cap and torn apron',
    targetHeight: 1.80,
    geometry: night.geometry,
    clips: nightAnimations,
    roughness: 0.97,
  }),
];

console.log(JSON.stringify(outputs, null, 2));
