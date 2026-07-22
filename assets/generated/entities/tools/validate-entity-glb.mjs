#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MODEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'child', 'child.glb');
const modelPath = resolve(process.argv[2] || DEFAULT_MODEL);
const bytes = readFileSync(modelPath);
const manifestPath = resolve(dirname(modelPath), 'asset-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const assetRecord = manifest.assets?.find((asset) => asset.path === modelPath.split('/').at(-1));
const kind = assetRecord?.kind || 'unknown';
const errors = [];
const checks = [];

function check(condition, message) {
  if (condition) checks.push(message);
  else errors.push(message);
}

function near(a, b, epsilon = 1e-5) {
  return Math.abs(a - b) <= epsilon;
}

check(bytes.byteLength >= 20, 'GLB has a complete header');
check(bytes.readUInt32LE(0) === 0x46546c67, 'GLB magic is correct');
check(bytes.readUInt32LE(4) === 2, 'GLB version is 2');
check(bytes.readUInt32LE(8) === bytes.byteLength, 'GLB header byte length matches the file');

const jsonLength = bytes.readUInt32LE(12);
const jsonType = bytes.readUInt32LE(16);
check(jsonType === 0x4e4f534a, 'first GLB chunk is JSON');
const jsonStart = 20;
const jsonEnd = jsonStart + jsonLength;
const gltf = JSON.parse(bytes.subarray(jsonStart, jsonEnd).toString('utf8').trim());
const binHeader = jsonEnd;
const binLength = bytes.readUInt32LE(binHeader);
const binType = bytes.readUInt32LE(binHeader + 4);
const binStart = binHeader + 8;
check(binType === 0x004e4942, 'second GLB chunk is BIN');
check(binStart + binLength === bytes.byteLength, 'BIN chunk reaches the file boundary');
check(gltf.buffers?.length === 1 && gltf.buffers[0].uri == null, 'GLB is self-contained');
check(gltf.buffers[0].byteLength <= binLength, 'declared buffer fits the BIN chunk');

const componentReaders = {
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  5121: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  5122: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
};
const typeWidths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function accessorValues(index) {
  const accessor = gltf.accessors[index];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const component = componentReaders[accessor.componentType];
  const width = typeWidths[accessor.type];
  if (!component || !width) throw new Error(`unsupported accessor ${index}`);
  const stride = bufferView.byteStride || component.bytes * width;
  const start = binStart + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const values = [];
  for (let row = 0; row < accessor.count; row++) {
    for (let column = 0; column < width; column++) {
      values.push(component.read(dataView, start + row * stride + column * component.bytes));
    }
  }
  return { accessor, width, values };
}

check(gltf.asset?.version === '2.0', 'asset declares glTF 2.0');
check(gltf.meshes?.length === 1, 'model has one mesh');
check(gltf.meshes?.[0]?.primitives?.length === 1, 'model has one primitive');
check(gltf.materials?.length === 1, 'model has one material');
check(!gltf.textures?.length && !gltf.images?.length, 'model has no texture memory cost');
check(!gltf.extensionsUsed?.includes('KHR_materials_pbrSpecularGlossiness'), 'model uses metallic-roughness PBR only');

const primitive = gltf.meshes[0].primitives[0];
for (const semantic of ['POSITION', 'NORMAL', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']) {
  check(Number.isInteger(primitive.attributes[semantic]), `primitive includes ${semantic}`);
}
check(Number.isInteger(primitive.indices), 'primitive is indexed');

const position = accessorValues(primitive.attributes.POSITION);
const normal = accessorValues(primitive.attributes.NORMAL);
const joint = accessorValues(primitive.attributes.JOINTS_0);
const weight = accessorValues(primitive.attributes.WEIGHTS_0);
const index = accessorValues(primitive.indices);
const vertexCount = position.accessor.count;
const triangleCount = index.accessor.count / 3;
check(vertexCount === normal.accessor.count && vertexCount === joint.accessor.count && vertexCount === weight.accessor.count,
  'all vertex attributes have matching counts');
check(Number.isInteger(triangleCount), 'index count resolves to whole triangles');
check(triangleCount <= 15000, `triangle count ${triangleCount} is within the 15k cap`);
check(bytes.byteLength < 20 * 1024 * 1024, 'model is within the whole-PR 20 MiB budget');
check(index.values.every((value) => value >= 0 && value < vertexCount), 'all indices address valid vertices');
check(position.values.every(Number.isFinite) && normal.values.every(Number.isFinite), 'geometry contains only finite values');

const modelMin = [Infinity, Infinity, Infinity];
const modelMax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < position.values.length; i += 3) {
  for (let axis = 0; axis < 3; axis++) {
    modelMin[axis] = Math.min(modelMin[axis], position.values[i + axis]);
    modelMax[axis] = Math.max(modelMax[axis], position.values[i + axis]);
  }
}
const modelSize = modelMax.map((value, axis) => value - modelMin[axis]);
const minY = modelMin[1], maxY = modelMax[1];
check(Math.abs(minY) <= 1e-6, `feet are at origin (minimum Y ${minY.toFixed(7)} m)`);
if (kind === 'child') {
  check(modelSize[1] >= 1.1 && modelSize[1] <= 1.3,
    `bind height ${modelSize[1].toFixed(4)} m is child scale`);
} else if (kind === 'crawler') {
  check(modelSize[1] >= 0.56 && modelSize[1] <= 0.66,
    `bind height ${modelSize[1].toFixed(4)} m is crawler scale`);
  check(modelSize[0] >= 0.65 && modelSize[0] <= 0.82,
    `crawler width ${modelSize[0].toFixed(4)} m fits the corridor-safe silhouette`);
  check(modelSize[2] >= 1.3 && modelSize[2] <= 1.65,
    `crawler length ${modelSize[2].toFixed(4)} m is controlled around the logical collider`);
  check(modelSize[1] < modelSize[2] * 0.5, 'crawler is natively prone rather than an upright rig rotated at runtime');
  check(triangleCount <= 4500, `crawler triangle count ${triangleCount} meets the tighter Quest target`);
} else {
  check(modelSize[1] > 0 && modelSize[1] <= 2.5, `bind height ${modelSize[1].toFixed(4)} m is plausible`);
}

const skin = gltf.skins?.[0];
check(gltf.skins?.length === 1, 'model has one skin');
check(skin?.joints?.length >= 15, `skin has a usable ${skin?.joints?.length || 0}-joint rig`);
check(gltf.accessors[skin?.inverseBindMatrices]?.count === skin?.joints?.length,
  'inverse-bind matrix count matches the joint count');
const jointLimit = skin?.joints?.length || 0;
check(joint.values.every((value) => value >= 0 && value < jointLimit), 'all skin joint indices are valid');
let validWeightRows = true;
for (let row = 0; row < weight.values.length; row += 4) {
  const sum = weight.values[row] + weight.values[row + 1] + weight.values[row + 2] + weight.values[row + 3];
  if (!near(sum, 1, 1e-4) || weight.values.slice(row, row + 4).some((value) => value < 0 || value > 1)) {
    validWeightRows = false;
    break;
  }
}
check(validWeightRows, 'every vertex has normalized, non-negative skin weights');

const nodeNames = gltf.nodes.map((node) => node.name || '');
for (const required of ['Root', 'Hips', 'Spine', 'Chest', 'Head', 'UpperLeg_L', 'UpperLeg_R', 'UpperArm_L', 'UpperArm_R']) {
  check(nodeNames.includes(required), `rig contains ${required}`);
}
const meshNode = gltf.nodes.find((node) => node.mesh === 0);
const rootNode = gltf.nodes.find((node) => node.name === 'Root');
const identityVector = (value, expected) => value == null || value.every((item, index) => near(item, expected[index]));
check(identityVector(meshNode?.translation, [0, 0, 0]) && identityVector(meshNode?.rotation, [0, 0, 0, 1]) &&
  identityVector(meshNode?.scale, [1, 1, 1]), 'mesh node uses an identity transform');
check(identityVector(rootNode?.translation, [0, 0, 0]) && identityVector(rootNode?.rotation, [0, 0, 0, 1]) &&
  identityVector(rootNode?.scale, [1, 1, 1]), 'skeleton Root uses an identity transform');
check(meshNode?.extras?.forwardAxis === '+Z', 'entity declares local +Z as its forward axis');
check(meshNode?.extras?.kind === kind, 'mesh-node kind matches the per-model manifest');
if (kind === 'crawler') check(meshNode?.extras?.prone === true, 'crawler declares its native prone pose');

const animationNames = gltf.animations?.map((animation) => animation.name.toLowerCase()) || [];
for (const key of ['idle', 'walk', 'run']) {
  check(animationNames.some((name) => name.includes(key)), `animation names include ${key}`);
}

for (const animation of gltf.animations || []) {
  let hasMotion = false;
  let hasRootTranslation = false;
  let loopSeamClean = true;
  let maxHipXZ = 0;
  for (const channel of animation.channels) {
    const targetNode = gltf.nodes[channel.target.node];
    const sampler = animation.samplers[channel.sampler];
    const input = accessorValues(sampler.input);
    const output = accessorValues(sampler.output);
    check(input.accessor.count === output.accessor.count,
      `${animation.name}/${targetNode.name} input and output counts match`);
    for (let i = 1; i < input.values.length; i++) {
      if (!(input.values[i] > input.values[i - 1])) {
        errors.push(`${animation.name} key times are not strictly increasing`);
        break;
      }
    }
    const first = output.values.slice(0, output.width);
    const last = output.values.slice(-output.width);
    if (!first.every((value, index2) => near(value, last[index2], 2e-5))) loopSeamClean = false;
    for (let i = output.width; i < output.values.length; i++) {
      if (!near(output.values[i], output.values[i % output.width], 1e-4)) {
        hasMotion = true;
        break;
      }
    }
    if (targetNode.name === 'Root' && channel.target.path === 'translation') hasRootTranslation = true;
    if (targetNode.name === 'Hips' && channel.target.path === 'translation') {
      const baseX = targetNode.translation?.[0] || 0;
      const baseZ = targetNode.translation?.[2] || 0;
      for (let i = 0; i < output.values.length; i += 3) {
        maxHipXZ = Math.max(maxHipXZ, Math.abs(output.values[i] - baseX), Math.abs(output.values[i + 2] - baseZ));
      }
    }
  }
  check(hasMotion, `${animation.name} contains non-static posing`);
  check(loopSeamClean, `${animation.name} has matching first/last loop keys`);
  check(!hasRootTranslation, `${animation.name} has no root translation channel`);
  check(maxHipXZ <= 0.02, `${animation.name} stays in place (hip X/Z sway <= 2 cm)`);
}

const sha256 = createHash('sha256').update(bytes).digest('hex');
check(assetRecord?.bytes === bytes.byteLength, 'manifest byte count matches the GLB');
check(assetRecord?.sha256 === sha256, 'manifest SHA-256 matches the GLB');
check(assetRecord?.triangles === triangleCount, 'manifest triangle count matches geometry');
check(assetRecord?.materials === gltf.materials.length, 'manifest material count matches glTF');

if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  console.error(`entity GLB validation failed: ${checks.length} checks passed, ${errors.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`entity GLB validation OK: ${checks.length} checks passed`);
  console.log(JSON.stringify({
    model: modelPath,
    bytes: bytes.byteLength,
    sha256,
    vertices: vertexCount,
    triangles: triangleCount,
    dimensionsMetres: modelSize,
    joints: skin.joints.length,
    clips: gltf.animations.map((animation) => animation.name),
  }, null, 2));
}
