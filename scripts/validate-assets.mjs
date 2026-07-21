// validate-assets.mjs — fail CI when the asset tree is broken.
// 1. Every literal 'assets/...' path referenced in the JS must exist on disk.
// 2. Every scene.gltf under assets/models must be valid JSON whose buffer and
//    image URIs all resolve beside it (a missing .bin or texture = broken model).
// Zero dependencies — plain node.
import fs from 'fs';
import path from 'path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL:', msg); };

// ---- 1. referenced paths exist ----
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join(root, 'js', f));
const refRe = /['"](assets\/[A-Za-z0-9_\-./]+\.(?:gltf|glb|jpg|jpeg|png|bin|woff2))['"]/g;
const referenced = new Set();
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(refRe)) referenced.add(m[1]);
}
for (const rel of referenced) {
  if (!fs.existsSync(path.join(root, rel))) fail('referenced but missing on disk: ' + rel);
}
console.log('checked ' + referenced.size + ' referenced asset paths');

// ---- 2. every model's internal URIs resolve ----
let gltfCount = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.gltf')) {
      gltfCount++;
      let doc;
      try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); }
      catch (err) { fail('invalid gltf JSON: ' + path.relative(root, p)); continue; }
      const base = path.dirname(p);
      const uris = []
        .concat((doc.buffers || []).map((b) => b.uri))
        .concat((doc.images || []).map((i) => i.uri))
        .filter((u) => u && !u.startsWith('data:'));
      for (const u of uris) {
        if (!fs.existsSync(path.join(base, decodeURIComponent(u)))) {
          fail(path.relative(root, p) + ' -> missing dependency: ' + u);
        }
      }
    }
  }
}
walk(path.join(root, 'assets', 'models'));
console.log('checked ' + gltfCount + ' glTF files for dangling buffer/image URIs');

if (failures) { console.error(failures + ' asset failure(s)'); process.exit(1); }
console.log('assets OK');
