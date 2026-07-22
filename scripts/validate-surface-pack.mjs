#!/usr/bin/env node

// Validate the generated floor/ceiling pack without image-library dependencies.
// Checks manifest coverage, byte counts, SHA-256, PNG/JPEG dimensions and color
// modes, duplicate paths, total budget accounting, and every runtime material pair.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pack = path.join(root, 'assets/generated/codex-ceiling-floor-pack-v1');
const manifestPath = path.join(pack, 'asset-manifest.json');
const runtimePath = path.join(root, 'js/vr-game.js');
let failures = 0;
const fail = (message) => { failures++; console.error(`FAIL: ${message}`); };

let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
catch (err) {
  console.error(`FAIL: invalid manifest: ${err.message}`);
  process.exit(1);
}

function dimensions(buffer, extension) {
  if (extension === '.png') {
    if (buffer.length < 26 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
    const pngModes = { 0: 'L', 2: 'RGB', 3: 'P', 4: 'LA', 6: 'RGBA' };
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      mode: pngModes[buffer[25]] || `PNG-color-type-${buffer[25]}`,
    };
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const components = buffer[offset + 9];
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
          mode: components === 1 ? 'L' : components === 3 ? 'RGB' : components === 4 ? 'CMYK' : `${components}-component`,
        };
      }
      offset += 2 + length;
    }
  }
  return null;
}

function walkImages(dir, base = dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkImages(absolute, base));
    else if (/\.(?:png|jpe?g)$/i.test(entry.name)) result.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return result.sort();
}

if (!Array.isArray(manifest.assets)) fail('manifest.assets must be an array');
const records = Array.isArray(manifest.assets) ? manifest.assets : [];
const listed = new Set();
let totalBytes = 0;
for (const record of records) {
  if (!record || typeof record.path !== 'string') { fail('asset record has no path'); continue; }
  if (listed.has(record.path)) fail(`duplicate manifest path: ${record.path}`);
  listed.add(record.path);
  const absolute = path.join(pack, record.path);
  if (!absolute.startsWith(pack + path.sep)) { fail(`path escapes pack: ${record.path}`); continue; }
  if (!fs.existsSync(absolute)) { fail(`missing derivative: ${record.path}`); continue; }
  const bytes = fs.readFileSync(absolute);
  totalBytes += bytes.length;
  if (record.bytes !== bytes.length) fail(`${record.path}: bytes ${bytes.length}, manifest ${record.bytes}`);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (record.sha256 !== hash) fail(`${record.path}: SHA-256 mismatch`);
  const size = dimensions(bytes, path.extname(record.path).toLowerCase());
  if (!size) fail(`${record.path}: unreadable PNG/JPEG header`);
  else if (record.width !== size.width || record.height !== size.height) {
    fail(`${record.path}: dimensions ${size.width}x${size.height}, manifest ${record.width}x${record.height}`);
  }
  if (size && record.mode !== size.mode) fail(`${record.path}: mode ${size.mode}, manifest ${record.mode}`);
}

const onDisk = walkImages(pack);
for (const image of onDisk) if (!listed.has(image)) fail(`image missing from manifest: ${image}`);
for (const image of listed) if (!onDisk.includes(image)) fail(`manifest image missing from disk: ${image}`);

if (manifest.budget?.derivativeImageCount !== onDisk.length) {
  fail(`image count ${onDisk.length}, manifest budget ${manifest.budget?.derivativeImageCount}`);
}
if (manifest.budget?.derivativeImageBytes !== totalBytes) {
  fail(`image bytes ${totalBytes}, manifest budget ${manifest.budget?.derivativeImageBytes}`);
}

const runtime = fs.readFileSync(runtimePath, 'utf8');
const runtimeBases = [...runtime.matchAll(/surfaceMaterial\('([^']+)'/g)].map((match) => match[1]);
for (const base of runtimeBases) {
  for (const suffix of ['-albedo.jpg', '-normal.png']) {
    const rel = `${base}${suffix}`;
    if (!listed.has(rel)) fail(`runtime surface missing from manifest: ${rel}`);
  }
}
const inheritedPairs = [...runtime.matchAll(/surfaceMaterialWithAlbedo\('([^']+)',\s*'([^']+)'/g)]
  .map((match) => ({ base: match[1], albedo: match[2] }));
for (const pair of inheritedPairs) {
  const normal = `${pair.base}-normal.png`;
  if (!listed.has(normal)) fail(`inherited runtime surface normal missing from manifest: ${normal}`);
  const absolute = path.join(root, pair.albedo);
  if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute)) {
    fail(`inherited runtime albedo missing from repository: ${pair.albedo}`);
  }
}

if (failures) {
  console.error(`${failures} surface-pack failure(s)`);
  process.exit(1);
}
console.log(`surface pack OK: ${onDisk.length} images, ${totalBytes} bytes, ${runtimeBases.length} local + ${inheritedPairs.length} inherited runtime material pairs`);
