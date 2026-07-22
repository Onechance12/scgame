import { createHash } from 'node:crypto';

const COMPONENT = {
  FLOAT: 5126,
  UNSIGNED_SHORT: 5123,
};

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(v, scalar) {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return scale3(v, 1 / length);
}

function normalize4(v) {
  const length = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
  return v.map((value) => value / length);
}

export function quatFromEuler(x = 0, y = 0, z = 0) {
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

function rotate3(v, euler) {
  let [x, y, z] = v;
  const [rx, ry, rz] = euler || [0, 0, 0];
  let c = Math.cos(rx), s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

export class GeometryBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.joints = [];
    this.weights = [];
    this.indices = [];
  }

  vertex(position, normal, color, joint, secondaryJoint = null, secondaryWeight = 0) {
    const index = this.positions.length / 3;
    this.positions.push(...position);
    this.normals.push(...normalize3(normal));
    this.colors.push(...color);
    if (secondaryJoint == null || secondaryWeight <= 0) {
      this.joints.push(joint, 0, 0, 0);
      this.weights.push(1, 0, 0, 0);
    } else {
      this.joints.push(joint, secondaryJoint, 0, 0);
      this.weights.push(1 - secondaryWeight, secondaryWeight, 0, 0);
    }
    return index;
  }

  triangle(a, b, c) {
    this.indices.push(a, b, c);
  }

  addEllipsoid(center, radius, joint, color, options = {}) {
    const segments = options.segments || 12;
    const rings = options.rings || 8;
    const euler = options.euler || [0, 0, 0];
    const secondaryJoint = options.secondaryJoint ?? null;
    const secondaryWeight = options.secondaryWeight || 0;
    const pointFor = (unit) => add3(center, rotate3([
      unit[0] * radius[0], unit[1] * radius[1], unit[2] * radius[2],
    ], euler));
    const normalFor = (unit) => rotate3([
      unit[0] / radius[0], unit[1] / radius[1], unit[2] / radius[2],
    ], euler);
    const top = this.vertex(pointFor([0, 1, 0]), normalFor([0, 1, 0]), color, joint, secondaryJoint, secondaryWeight);
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
        row.push(this.vertex(pointFor(unit), normalFor(unit), color, joint, secondaryJoint, secondaryWeight));
      }
      ringIds.push(row);
    }
    const bottom = this.vertex(pointFor([0, -1, 0]), normalFor([0, -1, 0]), color, joint, secondaryJoint, secondaryWeight);
    for (let segment = 0; segment < segments; segment++) {
      this.triangle(top, ringIds[0][segment], ringIds[0][(segment + 1) % segments]);
    }
    for (let ring = 0; ring < ringIds.length - 1; ring++) {
      for (let segment = 0; segment < segments; segment++) {
        const next = (segment + 1) % segments;
        this.triangle(ringIds[ring][segment], ringIds[ring + 1][segment], ringIds[ring + 1][next]);
        this.triangle(ringIds[ring][segment], ringIds[ring + 1][next], ringIds[ring][next]);
      }
    }
    const last = ringIds.at(-1);
    for (let segment = 0; segment < segments; segment++) {
      this.triangle(last[segment], bottom, last[(segment + 1) % segments]);
    }
  }

  addTaperedTube(start, end, startRadius, endRadius, joint, color, options = {}) {
    const segments = options.segments || 8;
    const secondaryJoint = options.secondaryJoint ?? null;
    const secondaryWeight = options.secondaryWeight || 0;
    const axis = normalize3(sub3(end, start));
    const reference = Math.abs(axis[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize3(cross3(axis, reference));
    const v = normalize3(cross3(u, axis));
    const a = [], b = [];
    for (let segment = 0; segment < segments; segment++) {
      const angle = Math.PI * 2 * segment / segments;
      const radial = add3(scale3(u, Math.cos(angle)), scale3(v, Math.sin(angle)));
      a.push(this.vertex(add3(start, scale3(radial, startRadius)), radial, color, joint, secondaryJoint, secondaryWeight));
      b.push(this.vertex(add3(end, scale3(radial, endRadius)), radial, color, joint, secondaryJoint, secondaryWeight));
    }
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      this.triangle(a[segment], b[segment], b[next]);
      this.triangle(a[segment], b[next], a[next]);
    }
    const startCenter = this.vertex(start, scale3(axis, -1), color, joint, secondaryJoint, secondaryWeight);
    const endCenter = this.vertex(end, axis, color, joint, secondaryJoint, secondaryWeight);
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      this.triangle(startCenter, a[next], a[segment]);
      this.triangle(endCenter, b[segment], b[next]);
    }
  }

  addBox(center, size, joint, color, options = {}) {
    const secondaryJoint = options.secondaryJoint ?? null;
    const secondaryWeight = options.secondaryWeight || 0;
    const euler = options.euler || [0, 0, 0];
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
      const normal = rotate3(face.n, euler);
      const ids = face.p.map((point) => this.vertex(
        add3(center, rotate3(point, euler)), normal, color, joint, secondaryJoint, secondaryWeight,
      ));
      this.triangle(ids[0], ids[1], ids[2]);
      this.triangle(ids[0], ids[2], ids[3]);
    }
  }

  addDoubleSidedSheet(points, joint, color, normal = [0, 1, 0], options = {}) {
    if (points.length < 3) return;
    const backNormal = options.backNormal || scale3(normal, -1);
    const front = points.map((point) => this.vertex(point, normal, color, joint));
    const back = points.map((point) => this.vertex(point, backNormal, color, joint));
    for (let i = 1; i < points.length - 1; i++) {
      this.triangle(front[0], front[i], front[i + 1]);
      this.triangle(back[0], back[i + 1], back[i]);
    }
  }
}

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
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
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

function padBuffer(buffer, fill) {
  const padding = (4 - (buffer.byteLength % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, fill)]) : buffer;
}

export function buildSkinnedGLB(spec) {
  const { bones, geometry, clips } = spec;
  const boneIndex = Object.fromEntries(bones.map((bone, index) => [bone.name, index]));
  const globalJointPositions = bones.map(() => [0, 0, 0]);
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    globalJointPositions[i] = bone.parent < 0
      ? [...bone.translation]
      : add3(globalJointPositions[bone.parent], bone.translation);
  }

  const binary = new BinaryBuilder();
  const bounds = minMax(geometry.positions, 3);
  const positionAccessor = binary.addAccessor(
    new Float32Array(geometry.positions), COMPONENT.FLOAT, 'VEC3', geometry.positions.length / 3,
    { target: ARRAY_BUFFER, min: bounds.min, max: bounds.max },
  );
  const normalAccessor = binary.addAccessor(
    new Float32Array(geometry.normals), COMPONENT.FLOAT, 'VEC3', geometry.normals.length / 3,
    { target: ARRAY_BUFFER },
  );
  const colorAccessor = binary.addAccessor(
    new Float32Array(geometry.colors), COMPONENT.FLOAT, 'VEC4', geometry.colors.length / 4,
    { target: ARRAY_BUFFER },
  );
  const jointAccessor = binary.addAccessor(
    new Uint16Array(geometry.joints), COMPONENT.UNSIGNED_SHORT, 'VEC4', geometry.joints.length / 4,
    { target: ARRAY_BUFFER },
  );
  const weightAccessor = binary.addAccessor(
    new Float32Array(geometry.weights), COMPONENT.FLOAT, 'VEC4', geometry.weights.length / 4,
    { target: ARRAY_BUFFER },
  );
  const indexAccessor = binary.addAccessor(
    new Uint16Array(geometry.indices), COMPONENT.UNSIGNED_SHORT, 'SCALAR', geometry.indices.length,
    { target: ELEMENT_ARRAY_BUFFER, min: [Math.min(...geometry.indices)], max: [Math.max(...geometry.indices)] },
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
    const inputAccessors = new Map();
    const inputFor = (times) => {
      const key = times.join(',');
      if (inputAccessors.has(key)) return inputAccessors.get(key);
      const accessor = binary.addAccessor(
        new Float32Array(times), COMPONENT.FLOAT, 'SCALAR', times.length,
        { min: [times[0]], max: [times.at(-1)] },
      );
      inputAccessors.set(key, accessor);
      return accessor;
    };
    const samplers = [];
    const channels = [];
    for (const track of clip.tracks) {
      const trackTimes = track.times || clip.times;
      const outputAccessor = binary.addAccessor(
        new Float32Array(track.values), COMPONENT.FLOAT,
        track.path === 'rotation' ? 'VEC4' : 'VEC3', trackTimes.length,
      );
      const sampler = samplers.length;
      samplers.push({ input: inputFor(trackTimes), output: outputAccessor, interpolation: 'LINEAR' });
      channels.push({ sampler, target: { node: 1 + boneIndex[track.bone], path: track.path } });
    }
    animations.push({
      name: clip.name,
      samplers,
      channels,
      extras: { loop: true, inPlace: true, nominalSpeedMps: clip.nominalSpeedMps },
    });
  }

  const nodes = [{
    name: spec.meshNodeName,
    mesh: 0,
    skin: 0,
    extras: spec.nodeExtras,
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
      extras: spec.assetExtras,
    },
    scene: 0,
    scenes: [{ name: spec.sceneName, nodes: [0, 1] }],
    nodes,
    meshes: [{
      name: spec.meshName,
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
      extras: spec.meshExtras,
    }],
    materials: [{
      name: spec.materialName,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: spec.roughness ?? 0.94,
      },
      doubleSided: false,
    }],
    skins: [{
      name: spec.skinName,
      inverseBindMatrices: inverseBindAccessor,
      skeleton: 1,
      joints: bones.map((_, index) => 1 + index),
    }],
    animations,
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: binary.bufferViews,
    accessors: binary.accessors,
  };

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
  const sha256 = createHash('sha256').update(glb).digest('hex');
  const size = bounds.max.map((value, axis) => value - bounds.min[axis]);

  return {
    glb,
    sha256,
    bounds,
    size,
    vertexCount: geometry.positions.length / 3,
    triangleCount: geometry.indices.length / 3,
    boneCount: bones.length,
  };
}
