/* ============================================================================
 * props.js — furniture & set dressing for the Old Hospital (Three.js).
 * Builds recognizable silhouettes from primitives (beds, gurneys, morgue
 * drawers, operating tables, a large kitchen, pews, boilers, the incinerator…)
 * and places them per room by tag. Returns geometry to add, solid collision
 * boxes (metres), and flickering light fixtures.
 *
 * Loaded as a classic script after three.min.js; uses the global THREE and the
 * global World. vr-game.js calls Props.populate(fi, data, {TILE_M, WALL_H}).
 * ==========================================================================*/

const Props = (() => {
  const T = () => window.THREE;

  // Deterministic per-floor RNG. Furniture placement writes COLLISION (solids),
  // so it must reproduce exactly on floor revisits and across co-op peers —
  // Math.random() reshuffled the room every rebuild. Seeded in populate().
  let _seed = 1;
  function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function reseed(s) { _seed = s; }

  // ---- shared materials (created lazily so THREE exists) ----
  let M = null;
  function mats() {
    if (M) return M;
    const THREE = T();
    const s = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.9 : r, metalness: m || 0 });
    M = {
      metal: s(0x8b9098, 0.5, 0.4),
      steel: s(0xb7bcc4, 0.35, 0.7),
      white: s(0xc2c6cc, 0.8, 0),
      sheet: s(0x9aa0a8, 0.95, 0),
      mattress: s(0x565a62, 1, 0),
      wood: s(0x5b4632, 0.85, 0),
      darkwood: s(0x3c2e20, 0.85, 0),
      rubber: s(0x161619, 0.9, 0),
      dark: s(0x24242b, 0.9, 0.1),
      rust: s(0x5a3b2a, 1, 0.2),
      porcelain: s(0xd6dade, 0.5, 0),
      stain: new THREE.MeshStandardMaterial({ color: 0x3a0d0d, roughness: 1 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0xff5a1e, emissiveIntensity: 1.4 }),
      window: new THREE.MeshStandardMaterial({ color: 0x0a0f18, emissive: 0x24406a, emissiveIntensity: 0.6 }),
      tube: new THREE.MeshStandardMaterial({ color: 0xdfe6ea, emissive: 0xcfe6ff, emissiveIntensity: 0.9 }),
      brass: s(0x9a7b32, 0.4, 0.6),
      // dusty, faded toy colours for the nursery
      toyR: s(0x7a3b3b, 0.9, 0), toyB: s(0x3b4a7a, 0.9, 0), toyY: s(0x8a7a3b, 0.9, 0),
      plush: s(0x6a4f38, 1, 0),
    };
    return M;
  }

  const box = (w, h, d, mat, x, y, z) => { const m = new (T().Mesh)(new (T().BoxGeometry)(w, h, d), mat); m.position.set(x || 0, y || 0, z || 0); return m; };
  const cyl = (rt, rb, h, mat, x, y, z, seg) => { const m = new (T().Mesh)(new (T().CylinderGeometry)(rt, rb, h, seg || 10), mat); m.position.set(x || 0, y || 0, z || 0); return m; };
  const sph = (r, mat, x, y, z) => { const m = new (T().Mesh)(new (T().SphereGeometry)(r, 10, 10), mat); m.position.set(x || 0, y || 0, z || 0); return m; };

  // ---------- prop builders: each returns a Group with userData.fw/fd (metres)
  function bed(bloody) {
    const g = new (T().Group)(), m = mats();
    [[-0.36, -0.9], [0.36, -0.9], [-0.36, 0.9], [0.36, 0.9]].forEach(([x, z]) => g.add(box(0.06, 0.5, 0.06, m.metal, x, 0.25, z)));
    g.add(box(0.82, 0.08, 1.95, m.metal, 0, 0.5, 0));
    g.add(box(0.74, 0.14, 1.8, m.mattress, 0, 0.6, 0));
    g.add(box(0.7, 0.12, 1.0, m.sheet, 0, 0.62, 0.35));       // rumpled blanket
    g.add(box(0.44, 0.09, 0.3, m.sheet, 0, 0.71, -0.72));     // pillow
    g.add(box(0.86, 0.55, 0.05, m.metal, 0, 0.58, -0.98));    // headboard
    g.add(box(0.86, 0.4, 0.05, m.metal, 0, 0.5, 0.98));       // footboard
    // side rails
    g.add(box(0.04, 0.05, 1.2, m.steel, -0.42, 0.78, 0.1));
    g.add(box(0.04, 0.05, 1.2, m.steel, 0.42, 0.78, 0.1));
    // patient chart on the footboard
    g.add(box(0.24, 0.32, 0.02, m.sheet, 0, 0.62, 1.02));
    if (bloody) {
      g.add(box(0.5, 0.02, 0.6, m.stain, 0, 0.68, 0.1));
      g.add(box(0.34, 0.015, 0.4, m.stain, 0.14, 0.029, 0.62)); // above the room floor overlay
    }
    g.userData = { fw: 0.95, fd: 2.1 };
    return g;
  }
  function casket() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.75, 0.45, 2.0, m.darkwood, 0, 0.35, 0));
    g.add(box(0.8, 0.07, 2.05, m.wood, 0, 0.61, 0));           // lid, slightly ajar
    g.children[1].rotation.z = 0.06; g.children[1].position.x = 0.06;
    g.add(box(0.06, 0.2, 0.06, m.wood, -0.34, 0.1, -0.9));
    g.add(box(0.06, 0.2, 0.06, m.wood, 0.34, 0.1, 0.9));
    g.userData = { fw: 0.85, fd: 2.1 };
    return g;
  }
  function shroudBody() {
    const g = new (T().Group)(), m = mats();
    g.add(cyl(0.1, 0.14, 0.85, m.steel, 0, 0.42, 0));          // slab
    g.add(box(0.7, 0.08, 1.9, m.steel, 0, 0.85, 0));
    // the body under the sheet
    g.add(box(0.5, 0.22, 1.6, m.sheet, 0, 0.99, 0));
    g.add(box(0.34, 0.16, 0.3, m.sheet, 0, 1.06, -0.6));       // head
    g.add(box(0.12, 0.1, 0.16, m.sheet, -0.1, 1.05, 0.55));    // feet
    g.userData = { fw: 0.8, fd: 2.0 };
    return g;
  }
  function crib() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.8, 0.06, 1.1, m.metal, 0, 0.5, 0));
    g.add(box(0.72, 0.1, 1.0, m.mattress, 0, 0.56, 0));
    for (let i = -0.35; i <= 0.35; i += 0.1) { g.add(box(0.02, 0.4, 0.02, m.metal, i, 0.72, 0.52)); g.add(box(0.02, 0.4, 0.02, m.metal, i, 0.72, -0.52)); }
    g.userData = { fw: 0.85, fd: 1.15 };
    return g;
  }
  function wheelchair() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.5, 0.06, 0.5, m.rubber, 0, 0.5, 0));
    g.add(box(0.5, 0.55, 0.06, m.rubber, 0, 0.78, -0.25));
    g.add(cyl(0.28, 0.28, 0.05, m.dark, -0.3, 0.28, 0.05, 12)); g.children[g.children.length - 1].rotation.z = Math.PI / 2;
    g.add(cyl(0.28, 0.28, 0.05, m.dark, 0.3, 0.28, 0.05, 12)); g.children[g.children.length - 1].rotation.z = Math.PI / 2;
    g.userData = { fw: 0.7, fd: 0.8 };
    return g;
  }
  function operatingTable() {
    const g = new (T().Group)(), m = mats();
    g.add(cyl(0.12, 0.16, 0.8, m.steel, 0, 0.4, 0));
    g.add(box(0.7, 0.1, 1.9, m.steel, 0, 0.85, 0));
    g.add(box(0.6, 0.02, 0.7, m.stain, 0, 0.91, 0));
    g.userData = { fw: 0.8, fd: 2.0 };
    return g;
  }
  function examLight() { // overhead surgical light (emissive, no real light for perf)
    const g = new (T().Group)(), m = mats();
    g.add(cyl(0.02, 0.02, 1.2, m.metal, 0, 2.2, 0));
    const dome = cyl(0.32, 0.32, 0.12, m.tube, 0, 1.6, 0, 16); g.add(dome);
    g.userData = { fw: 0.7, fd: 0.7, solid: false };
    return g;
  }
  function morgueDrawers() { // bank of body drawers against a wall
    const g = new (T().Group)(), m = mats();
    g.add(box(1.9, 1.7, 0.7, m.steel, 0, 0.85, 0));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      g.add(box(0.56, 0.5, 0.02, m.metal, -0.62 + c * 0.62, 0.4 + r * 0.55, 0.36));
      g.add(box(0.14, 0.03, 0.03, m.dark, -0.62 + c * 0.62, 0.4 + r * 0.55, 0.39)); // handle
    }
    g.userData = { fw: 1.95, fd: 0.75 };
    return g;
  }
  function slab() {
    const g = new (T().Group)(), m = mats();
    g.add(cyl(0.1, 0.14, 0.85, m.steel, 0, 0.42, 0));
    g.add(box(0.7, 0.08, 1.9, m.steel, 0, 0.85, 0));
    g.userData = { fw: 0.8, fd: 2.0 };
    return g;
  }
  function cabinet() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.6, 1.7, 0.45, m.metal, 0, 0.85, 0));
    g.add(box(0.02, 1.5, 0.02, m.dark, 0.12, 0.9, 0.24));
    g.userData = { fw: 0.65, fd: 0.5 };
    return g;
  }
  function shelf() {
    const g = new (T().Group)(), m = mats();
    for (let i = 0; i < 4; i++) g.add(box(1.2, 0.04, 0.4, m.wood, 0, 0.3 + i * 0.5, 0));
    g.add(box(0.04, 2, 0.4, m.wood, -0.58, 1, 0)); g.add(box(0.04, 2, 0.4, m.wood, 0.58, 1, 0));
    for (let i = 0; i < 5; i++) g.add(cyl(0.06, 0.06, 0.18, m.porcelain, -0.4 + i * 0.2, 0.85, 0, 8));
    g.userData = { fw: 1.25, fd: 0.45 };
    return g;
  }
  function crates() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.6, 0.6, 0.6, m.darkwood, 0, 0.3, 0));
    g.add(box(0.55, 0.5, 0.55, m.darkwood, 0.1, 0.85, 0.05));
    g.add(box(0.5, 0.45, 0.5, m.wood, -0.2, 0.22, 0.35));
    g.userData = { fw: 0.9, fd: 0.9 };
    return g;
  }
  function chair() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.4, 0.05, 0.4, m.wood, 0, 0.45, 0));
    g.add(box(0.4, 0.5, 0.05, m.wood, 0, 0.7, -0.18));
    [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]].forEach(([x, z]) => g.add(box(0.04, 0.45, 0.04, m.wood, x, 0.22, z)));
    g.userData = { fw: 0.45, fd: 0.45 };
    return g;
  }
  function table() {
    const g = new (T().Group)(), m = mats();
    g.add(box(1.1, 0.06, 0.7, m.wood, 0, 0.72, 0));
    [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]].forEach(([x, z]) => g.add(box(0.06, 0.7, 0.06, m.wood, x, 0.36, z)));
    g.userData = { fw: 1.15, fd: 0.75 };
    return g;
  }
  function desk() {
    const g = new (T().Group)(), m = mats();
    g.add(box(1.4, 0.07, 0.7, m.darkwood, 0, 0.75, 0));
    g.add(box(0.6, 0.7, 0.65, m.darkwood, -0.35, 0.38, 0));
    g.userData = { fw: 1.45, fd: 0.75 };
    return g;
  }
  function counter() {
    const g = new (T().Group)(), m = mats();
    g.add(box(1.8, 0.9, 0.65, m.metal, 0, 0.45, 0));
    g.add(box(1.85, 0.05, 0.7, m.steel, 0, 0.92, 0));
    // abandoned mid-shift: mugs, bottles, a tray of somebody's last meal
    for (let i = 0; i < 3 + (rnd() * 3 | 0); i++) {
      const r = rnd();
      const xo = (rnd() - 0.5) * 1.5, zo = (rnd() - 0.5) * 0.45;
      if (r < 0.4) g.add(cyl(0.045, 0.045, 0.09, m.porcelain, xo, 0.99, zo, 8));
      else if (r < 0.7) g.add(cyl(0.035, 0.045, 0.2, m.dark, xo, 1.05, zo, 8));
      else { g.add(box(0.3, 0.02, 0.2, m.steel, xo, 0.96, zo)); g.add(cyl(0.05, 0.06, 0.03, m.rust, xo, 0.98, zo, 8)); }
    }
    if (rnd() < 0.4) { const t = cyl(0.045, 0.045, 0.09, m.porcelain, (rnd() - 0.5) * 1.4, 0.965, 0.1, 8); t.rotation.z = Math.PI / 2; g.add(t); } // tipped mug
    g.userData = { fw: 1.85, fd: 0.7 };
    return g;
  }
  function stove() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.9, 0.9, 0.7, m.dark, 0, 0.45, 0));
    for (let i = 0; i < 4; i++) g.add(cyl(0.12, 0.12, 0.03, m.rubber, -0.22 + (i % 2) * 0.44, 0.92, -0.15 + Math.floor(i / 2) * 0.3, 12));
    g.add(box(1.0, 0.1, 0.75, m.metal, 0, 2.0, 0)); // hood
    g.add(box(0.1, 1.1, 0.1, m.metal, 0, 1.45, -0.3));
    g.userData = { fw: 1.0, fd: 0.8 };
    return g;
  }
  function sink() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.8, 0.85, 0.55, m.porcelain, 0, 0.42, 0));
    g.add(box(0.6, 0.1, 0.4, m.dark, 0, 0.8, 0));
    g.add(cyl(0.03, 0.03, 0.3, m.metal, 0, 1.0, -0.15, 8));
    g.userData = { fw: 0.85, fd: 0.6 };
    return g;
  }
  function bathtub() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.85, 0.6, 1.7, m.porcelain, 0, 0.3, 0));
    g.add(box(0.65, 0.15, 1.5, m.stain, 0, 0.5, 0));
    g.userData = { fw: 0.9, fd: 1.75 };
    return g;
  }
  function ivStand() {
    const g = new (T().Group)(), m = mats();
    g.add(cyl(0.02, 0.02, 1.7, m.metal, 0, 0.85, 0));
    g.add(cyl(0.2, 0.2, 0.02, m.dark, 0, 0.05, 0, 6));
    g.add(box(0.12, 0.25, 0.04, m.sheet, 0.08, 1.5, 0));
    g.userData = { fw: 0.4, fd: 0.4, solid: false };
    return g;
  }
  function boiler() {
    const g = new (T().Group)(), m = mats();
    g.add(cyl(0.55, 0.6, 2.2, m.rust, 0, 1.1, 0, 14));
    g.add(cyl(0.08, 0.08, 1.4, m.rust, 0.6, 1.5, 0, 8));
    g.add(cyl(0.08, 0.08, 1.0, m.rust, -0.5, 1.2, 0.3, 8));
    g.userData = { fw: 1.2, fd: 1.2 };
    return g;
  }
  function incinerator() {
    const g = new (T().Group)(), m = mats();
    g.add(box(1.6, 1.8, 1.4, m.rust, 0, 0.9, 0));
    g.add(box(0.9, 0.9, 0.05, m.glow, 0, 0.7, 0.72)); // glowing door
    g.add(cyl(0.14, 0.14, 2.0, m.rust, 0.55, 2.4, 0, 8)); // flue
    g.userData = { fw: 1.65, fd: 1.45, ember: true };
    return g;
  }
  function washer() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.7, 0.9, 0.7, m.white, 0, 0.45, 0));
    g.add(cyl(0.25, 0.25, 0.06, m.dark, 0, 0.55, 0.36, 14)); g.children[g.children.length - 1].rotation.x = Math.PI / 2;
    g.userData = { fw: 0.75, fd: 0.75 };
    return g;
  }
  function pew() {
    const g = new (T().Group)(), m = mats();
    g.add(box(2.2, 0.08, 0.4, m.darkwood, 0, 0.45, 0));
    g.add(box(2.2, 0.6, 0.06, m.darkwood, 0, 0.7, -0.18));
    g.add(box(0.06, 0.45, 0.4, m.darkwood, -1.0, 0.22, 0)); g.add(box(0.06, 0.45, 0.4, m.darkwood, 1.0, 0.22, 0));
    g.userData = { fw: 2.3, fd: 0.5 };
    return g;
  }
  function cross() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.16, 2.2, 0.16, m.darkwood, 0, 1.1, 0));
    g.add(box(1.0, 0.16, 0.16, m.darkwood, 0, 1.6, 0));
    g.userData = { fw: 1.1, fd: 0.3 };
    return g;
  }
  function altar() {
    const g = new (T().Group)(), m = mats();
    g.add(box(1.4, 0.9, 0.7, m.darkwood, 0, 0.45, 0));
    g.add(cyl(0.05, 0.05, 0.3, m.brass, -0.4, 1.05, 0, 8)); g.add(cyl(0.05, 0.05, 0.3, m.brass, 0.4, 1.05, 0, 8));
    g.userData = { fw: 1.45, fd: 0.75 };
    return g;
  }
  function bell() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.1, 2.2, 0.1, m.darkwood, -0.7, 1.6, 0)); g.add(box(0.1, 2.2, 0.1, m.darkwood, 0.7, 1.6, 0));
    g.add(box(1.6, 0.1, 0.1, m.darkwood, 0, 2.7, 0));
    const b = cyl(0.35, 0.5, 0.7, m.brass, 0, 2.2, 0, 16); g.add(b);
    g.userData = { fw: 1.6, fd: 0.6 };
    return g;
  }
  function xrayMachine() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.8, 1.6, 0.6, m.white, 0, 0.8, 0));
    g.add(cyl(0.05, 0.05, 1.2, m.metal, 0, 1.6, 0.4)); g.children[g.children.length - 1].rotation.x = Math.PI / 2.5;
    g.add(box(0.4, 0.4, 0.3, m.dark, 0, 1.7, 0.9));
    g.userData = { fw: 0.85, fd: 0.9 };
    return g;
  }
  function windowProp() { // the third-floor window Mose fell from
    const g = new (T().Group)(), m = mats();
    g.add(box(1.3, 1.6, 0.1, m.window, 0, 1.3, 0));
    g.add(box(1.4, 0.08, 0.14, m.darkwood, 0, 0.5, 0)); g.add(box(1.4, 0.08, 0.14, m.darkwood, 0, 2.1, 0));
    g.add(box(0.08, 1.6, 0.14, m.darkwood, 0, 1.3, 0));
    g.userData = { fw: 1.4, fd: 0.3, solid: false };
    return g;
  }
  function preptable() {
    const g = new (T().Group)(), m = mats();
    g.add(box(1.6, 0.06, 0.9, m.steel, 0, 0.92, 0));
    [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]].forEach(([x, z]) => g.add(box(0.06, 0.9, 0.06, m.metal, x, 0.46, z)));
    g.userData = { fw: 1.65, fd: 0.95 };
    return g;
  }
  function tray() {
    const g = new (T().Group)(), m = mats();
    g.add(cyl(0.02, 0.02, 0.9, m.metal, 0, 0.45, 0));
    g.add(box(0.5, 0.04, 0.35, m.steel, 0, 0.9, 0));
    g.userData = { fw: 0.5, fd: 0.4, solid: false };
    return g;
  }
  function rocker() { return chair(); }
  function papers() { // loose paperwork dropped on the floor overnight
    const g = new (T().Group)(), m = mats();
    for (let i = 0; i < 4; i++) {
      const p = new (T().Mesh)(new (T().PlaneGeometry)(0.21, 0.3), m.sheet);
      p.rotation.x = -Math.PI / 2; p.rotation.z = rnd() * 6.28;
      p.position.set((rnd() - 0.5) * 0.9, 0.034 + i * 0.002, (rnd() - 0.5) * 0.9);
      g.add(p);
    }
    g.userData = { fw: 0.4, fd: 0.4, solid: false };
    return g;
  }
  function pipes() {
    const g = new (T().Group)(), m = mats();
    g.add(cyl(0.1, 0.1, 3, m.rust, 0, 2.6, 0, 8)); g.children[0].rotation.z = Math.PI / 2;
    g.add(cyl(0.08, 0.08, 2, m.rust, 0.5, 2.2, 0, 8));
    g.userData = { fw: 0.4, fd: 0.4, solid: false };
    return g;
  }

  // ---- nursery / children builders ----
  function bassinet() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.55, 0.32, 0.9, m.white, 0, 0.78, 0));
    g.add(box(0.48, 0.16, 0.82, m.mattress, 0, 0.82, 0));
    [[-0.22, -0.38], [0.22, -0.38], [-0.22, 0.38], [0.22, 0.38]].forEach(([x, z]) => g.add(cyl(0.02, 0.02, 0.62, m.metal, x, 0.31, z, 6)));
    g.userData = { fw: 0.6, fd: 1.0, anim: 'rock' };
    return g;
  }
  function rockingHorse() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.7, 0.24, 0.26, m.plush, 0, 0.62, 0));
    g.add(box(0.24, 0.34, 0.2, m.plush, 0.34, 0.85, 0));
    g.add(box(0.05, 0.06, 1.0, m.wood, -0.2, 0.16, 0));
    g.add(box(0.05, 0.06, 1.0, m.wood, 0.2, 0.16, 0));
    [[-0.2, -0.3], [0.2, -0.3], [-0.2, 0.3], [0.2, 0.3]].forEach(([x, z]) => g.add(box(0.05, 0.4, 0.05, m.wood, x, 0.4, z)));
    g.userData = { fw: 0.8, fd: 0.5, anim: 'rock' };
    return g;
  }
  function teddy() {
    const g = new (T().Group)(), m = mats();
    g.add(sph(0.16, m.plush, 0, 0.18, 0));
    g.add(sph(0.12, m.plush, 0, 0.42, 0));
    g.add(sph(0.05, m.plush, -0.09, 0.5, 0)); g.add(sph(0.05, m.plush, 0.09, 0.5, 0));
    g.add(sph(0.06, m.plush, -0.17, 0.16, 0.05)); g.add(sph(0.06, m.plush, 0.17, 0.16, 0.05));
    g.add(sph(0.015, m.dark, -0.04, 0.44, 0.11)); g.add(sph(0.015, m.dark, 0.04, 0.44, 0.11)); // eyes
    g.userData = { fw: 0.4, fd: 0.4, solid: false };
    return g;
  }
  function toyBlocks() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.13, 0.13, 0.13, m.toyR, 0, 0.065, 0));
    g.add(box(0.13, 0.13, 0.13, m.toyB, 0.02, 0.2, 0.02));
    g.add(box(0.13, 0.13, 0.13, m.toyY, -0.12, 0.065, 0.14));
    g.userData = { fw: 0.4, fd: 0.4, solid: false };
    return g;
  }
  function ball() {
    const g = new (T().Group)(), m = mats();
    g.add(sph(0.17, m.toyR, 0, 0.17, 0));
    g.userData = { fw: 0.4, fd: 0.4, solid: false };
    return g;
  }
  function mobile() {
    const THREE = T(), g = new THREE.Group(), m = mats();
    g.add(cyl(0.008, 0.008, 0.5, m.metal, 0, 2.95, 0, 5));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 6, 14), m.metal);
    ring.rotation.x = Math.PI / 2; ring.position.y = 2.65; g.add(ring);
    const cols = [m.toyR, m.toyB, m.toyY, m.plush];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2, x = Math.cos(a) * 0.26, z = Math.sin(a) * 0.26;
      g.add(cyl(0.004, 0.004, 0.25, m.metal, x, 2.5, z, 4));
      g.add(sph(0.06, cols[i], x, 2.36, z));
    }
    g.userData = { fw: 0.6, fd: 0.6, anim: 'spin', solid: false };
    return g;
  }
  function toybox() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.7, 0.45, 0.5, m.darkwood, 0, 0.22, 0));
    g.add(box(0.72, 0.06, 0.52, m.wood, 0, 0.47, 0));
    g.userData = { fw: 0.75, fd: 0.55 };
    return g;
  }
  function incubator() {
    const g = new (T().Group)(), m = mats();
    g.add(box(0.8, 0.16, 0.55, m.white, 0, 0.78, 0));
    g.add(box(0.7, 0.4, 0.45, m.window, 0, 1.05, 0));
    [[-0.32, -0.2], [0.32, -0.2], [-0.32, 0.2], [0.32, 0.2]].forEach(([x, z]) => g.add(box(0.05, 0.7, 0.05, m.metal, x, 0.35, z)));
    g.userData = { fw: 0.85, fd: 0.6 };
    return g;
  }

  // ---- shared decal textures (newsprint / blood / scorch), built once ----
  // NOTE: these are cache-once builders. They must NOT draw from the seeded
  // placement stream — consuming it only on the first floor build would shift
  // every later placement and break floor-revisit determinism.
  let DECALS = null;
  function decals() {
    if (DECALS) return DECALS;
    const THREE = T();
    let ds = 424242; const drnd = () => { ds = (ds * 1103515245 + 12345) & 0x7fffffff; return ds / 0x7fffffff; };
    const make = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); return t; };
    DECALS = {
      news: make((x) => { x.fillStyle = '#b6ae96'; x.fillRect(0, 0, 128, 128);
        x.fillStyle = '#2a2620'; x.fillRect(8, 6, 112, 14);
        for (let r = 28; r < 122; r += 6) { x.fillStyle = 'rgba(40,36,30,' + (0.5 + drnd() * 0.3) + ')'; x.fillRect(8 + (r % 12 ? 0 : 66), r, r % 12 ? 52 : 54, 2); } }),
      blood: make((x) => { x.clearRect(0, 0, 128, 128);
        for (let i = 0; i < 9; i++) { const g = x.createRadialGradient(64, 64, 2, 64, 64, 20 + i * 6);
          g.addColorStop(0, 'rgba(90,8,8,0.55)'); g.addColorStop(1, 'rgba(60,4,4,0)'); x.fillStyle = g;
          x.beginPath(); x.arc(50 + drnd() * 28, 50 + drnd() * 28, 18 + drnd() * 26, 0, 6.28); x.fill(); }
        for (let i = 0; i < 12; i++) { x.fillStyle = 'rgba(80,6,6,0.5)'; x.fillRect(30 + drnd() * 70, 60 + drnd() * 40, 2, 8 + drnd() * 26); } }),
      scorch: make((x) => { x.clearRect(0, 0, 128, 128);
        const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
        g.addColorStop(0, 'rgba(8,6,4,0.9)'); g.addColorStop(0.6, 'rgba(16,12,8,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.beginPath(); x.arc(64, 64, 62, 0, 6.28); x.fill(); }),
    };
    return DECALS;
  }
  function decalPlane(kind, w, h) {
    const THREE = T();
    const m = new THREE.MeshBasicMaterial({ map: decals()[kind], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.userData = { solid: false, fw: 0.1, fd: 0.1 };
    return p;
  }
  function newspaper() { // scattered front pages
    const g = new (T().Group)();
    for (let i = 0; i < 3; i++) {
      const p = decalPlane('news', 0.32, 0.45);
      p.rotation.x = -Math.PI / 2; p.rotation.z = rnd() * 6.28;
      p.position.set((rnd() - 0.5) * 1.1, 0.034 + i * 0.003, (rnd() - 0.5) * 1.1);
      g.add(p);
    }
    g.userData = { fw: 0.4, fd: 0.4, solid: false };
    return g;
  }
  function bloodpool() {
    const g = new (T().Group)();
    const p = decalPlane('blood', 0.9 + rnd() * 0.8, 0.9 + rnd() * 0.8);
    p.rotation.x = -Math.PI / 2; p.rotation.z = rnd() * 6.28; p.position.y = 0.034;
    g.add(p);
    g.userData = { fw: 0.3, fd: 0.3, solid: false };
    return g;
  }

  const BUILDERS = {
    bed, crib, wheelchair, operating: operatingTable, examlight: examLight, drawers: morgueDrawers,
    slab, cabinet, shelf, crates, chair, table, desk, counter, stove, sink, bathtub, iv: ivStand,
    boiler, incinerator, washer, pew, cross, altar, bell, xraymachine: xrayMachine, window: windowProp,
    preptable, tray, rocker, pipes, cart: crates, papers, newspaper, bloodpool,
    bassinet, rockinghorse: rockingHorse, teddy, toyblocks: toyBlocks, ball, mobile, toybox, incubator,
    casket, shroud: shroudBody,
  };

  // tag -> {items, style}
  const FILL = {
    nursery: { items: [], style: 'nursery', mood: 0x9a6a2a },
    maternity: { items: ['incubator', 'incubator', 'bassinet', 'bassinet', 'rocker'], style: 'walls', mood: 0x8a5a3a },
    er: { items: ['bed', 'bed', 'bed', 'bed', 'iv', 'iv', 'examlight', 'cabinet', 'tray'], style: 'walls', mood: 0x6a8a9a },
    ward: { items: ['bed', 'bed', 'bed', 'bed', 'bed', 'bed', 'cabinet', 'iv', 'wheelchair'], style: 'walls' },
    recovery: { items: ['bed', 'bed', 'bed', 'bed', 'iv', 'tray', 'cabinet'], style: 'walls' },
    room207: { items: ['bed', 'wheelchair', 'cabinet'], style: 'walls' },
    iso: { items: ['bed'], style: 'center' },
    quarters: { items: ['bed', 'bed', 'bed', 'bed', 'cabinet', 'cabinet', 'chair', 'chair'], style: 'walls' },
    morgue: { items: ['drawers', 'drawers', 'slab'], style: 'morgue', mood: 0x3a6a58 },
    autopsy: { items: ['shroud', 'shroud', 'cabinet'], style: 'center', mood: 0x4a7a66 },
    incinerator: { items: ['incinerator'], style: 'center', mood: 0x8a2a10 },
    boiler: { items: ['boiler', 'boiler', 'pipes'], style: 'walls' },
    laundry: { items: ['washer', 'washer', 'cart'], style: 'walls' },
    storage: { items: ['casket', 'casket', 'casket', 'shelf', 'crates'], style: 'walls', mood: 0x2a4a6a },
    supply: { items: ['shelf', 'shelf', 'crates'], style: 'walls' },
    records: { items: ['shelf', 'shelf', 'cabinet', 'cabinet'], style: 'walls' },
    attic: { items: ['crates', 'crates', 'shelf'], style: 'walls' },
    pharmacy: { items: ['shelf', 'counter'], style: 'walls' },
    lobby: { items: ['counter', 'counter', 'chair', 'chair', 'chair', 'wheelchair', 'wheelchair', 'crates'], style: 'walls' },
    admitting: { items: ['desk', 'desk', 'chair', 'chair', 'cabinet', 'cabinet'], style: 'walls' },
    waiting: { items: ['chair', 'chair', 'chair', 'chair', 'chair', 'chair', 'chair', 'chair', 'table'], style: 'rows' },
    kitchen: { items: ['counter', 'counter', 'stove', 'shelf', 'preptable'], style: 'kitchen' },
    cafeteria: { items: ['table', 'chair', 'table', 'chair', 'table', 'chair', 'table', 'chair', 'table'], style: 'rows' },
    station: { items: ['desk', 'cabinet', 'cabinet'], style: 'walls' },
    surgery: { items: ['operating', 'examlight', 'tray', 'cabinet'], style: 'center', mood: 0x8a9aa8 },
    prep: { items: ['sink', 'counter', 'shelf'], style: 'walls' },
    mose: { items: ['bed', 'window', 'wheelchair'], style: 'mose' },
    chapel: { items: ['pew', 'pew', 'pew', 'pew', 'cross', 'altar'], style: 'chapel', mood: 0xaa7a2a },
    sanctum: { items: ['altar', 'cross', 'chair'], style: 'center', mood: 0xc09a4a },
    ritual: { items: [], style: 'center', mood: 0x7a1010 },
    bell: { items: ['bell'], style: 'center' },
    bath: { items: ['bathtub', 'sink'], style: 'walls' },
    linen: { items: ['shelf', 'shelf'], style: 'walls' },
    matron: { items: ['desk', 'cabinet'], style: 'walls' },
    xray: { items: ['xraymachine', 'table'], style: 'center' },
  };
  const DEFAULT_FILL = { items: ['chair', 'table', 'crates', 'cabinet'], style: 'walls' };

  // prop name -> hero glTF model key (see vr-game loadHeroModels)
  const HERO_MAP = { bed: 'bed', rocker: 'rocker', chair: 'chair', table: 'table', cabinet: 'cabinet', boiler: 'boiler' };
  const HERO_FP = {
    bed: { fw: 1.15, fd: 2.2 }, rocker: { fw: 0.7, fd: 1.05 }, chair: { fw: 0.55, fd: 0.55 },
    table: { fw: 1.7, fd: 0.95 }, cabinet: { fw: 0.75, fd: 0.55 }, boiler: { fw: 0.95, fd: 0.95 },
  };

  // place props for one room
  function fillRoom(group, solids, animated, room, TILE_M, bloodyChance, reserved) {
    const spec = FILL[room.tag] || DEFAULT_FILL;
    const items = spec.items;
    // room interior in metres, inset well clear of the walls (so nothing clips).
    // Tiny rooms fall back to a smaller inset so they still get their centre piece.
    const inset = (room.w >= 4 && room.h >= 4) ? 1.2 : 0.7;
    const x0 = (room.x + inset) * TILE_M, x1 = (room.x + room.w - inset) * TILE_M;
    const z0 = (room.y + inset) * TILE_M, z1 = (room.y + room.h - inset) * TILE_M;
    const cx = (room.x + room.w / 2) * TILE_M, cz = (room.y + room.h / 2) * TILE_M;

    // The carved room's outer tile ring is wall. Keep the full footprint of every
    // standing prop inside the actual floor rectangle, not merely its origin.
    const edgePad = 0.12;
    const roomBox = {
      x0: (room.x + 1) * TILE_M + edgePad,
      x1: (room.x + room.w - 1) * TILE_M - edgePad,
      z0: (room.y + 1) * TILE_M + edgePad,
      z1: (room.y + room.h - 1) * TILE_M - edgePad,
    };
    const doorX = (room.doorX + 0.5) * TILE_M;
    const doorAtNearZ = room.doorY <= room.y;
    const laneDepth = Math.min(TILE_M * 2.2, (roomBox.z1 - roomBox.z0) * 0.42);
    const doorLane = {
      x0: doorX - 0.72, x1: doorX + 0.72,
      z0: doorAtNearZ ? roomBox.z0 : roomBox.z1 - laneDepth,
      z1: doorAtNearZ ? roomBox.z0 + laneDepth : roomBox.z1,
    };
    const occupied = [];       // includes non-colliding floor dressing such as IVs/trays
    let placedFloor = 0;
    const overlays = new Set(['bloodpool', 'papers', 'newspaper']);
    const freeOverlap = new Set(['bloodpool']);   // a stain may sit beneath furniture; loose paper may not
    const overhead = new Set(['examlight', 'mobile', 'pipes', 'window']);
    const rotatedFootprint = (fw, fd, yaw) => {
      const c = Math.abs(Math.cos(yaw || 0)), s = Math.abs(Math.sin(yaw || 0));
      return { w: fw * c + fd * s, d: fw * s + fd * c };
    };
    const overlaps = (a, b, pad) => a.x0 + pad < b.x1 && a.x1 - pad > b.x0 && a.z0 + pad < b.z1 && a.z1 - pad > b.z0;

    // never drop furniture inside furniture that's already standing there
    const clashes = (a) => {
      const pad = 0.06;
      for (const s of solids)
        if (overlaps(a, s, pad)) return true;
      for (const o of occupied)
        if (overlaps(a, o, pad)) return true;
      return false;
    };
    const discard = (g) => g && g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    const fit = (name, xm, zm, fw, fd, yaw) => {
      const fp = rotatedFootprint(fw, fd, yaw);
      if (overhead.has(name)) return { xm, zm, fp, box: null };
      if (fp.w > roomBox.x1 - roomBox.x0 || fp.d > roomBox.z1 - roomBox.z0) return null;
      // Wall layouts intentionally propose centres close to the edge. Nudge only
      // as far as needed to keep the complete footprint out of the wall.
      xm = Math.max(roomBox.x0 + fp.w / 2, Math.min(roomBox.x1 - fp.w / 2, xm));
      zm = Math.max(roomBox.z0 + fp.d / 2, Math.min(roomBox.z1 - fp.d / 2, zm));
      const box = { x0: xm - fp.w / 2, x1: xm + fp.w / 2, z0: zm - fp.d / 2, z1: zm + fp.d / 2 };
      if (overlaps(box, doorLane, 0)) return null;
      if ((reserved || []).some((spot) => overlaps(box, spot, 0.06))) return null;
      if (!freeOverlap.has(name) && clashes(box)) return null;
      return { xm, zm, fp, box };
    };
    const register = (name, rec, solid) => {
      if (!rec.box || overlays.has(name) || overhead.has(name)) return;
      placedFloor++;
      if (solid) solids.push(rec.box);
      else occupied.push(rec.box);
    };
    const place = (name, xm, zm, rotY) => {
      // real glTF furniture when available (loaded by vr-game.js)
      const hm = (typeof window !== 'undefined') && window.HeroModels;
      const hkey = HERO_MAP[name];
      if (hm && hkey && hm[hkey]) {
        const fp = HERO_FP[name] || { fw: 0.8, fd: 0.8 };
        const yaw = (rotY || 0) + (rnd() - 0.5) * 0.25;   // nothing sits perfectly square
        const rec = fit(name, xm, zm, fp.fw, fp.fd, yaw);
        if (!rec) return false;
        const g = hm[hkey].clone();
        g.position.set(rec.xm, 0, rec.zm);
        g.rotation.y = yaw;
        if (name === 'chair' && rnd() < 0.22) {              // knocked over overnight
          g.rotation.z = Math.PI / 2 * (rnd() < 0.5 ? 1 : -1);
          g.position.y = 0.25;
        }
        group.add(g);
        register(name, rec, true);
        return true;
      }
      const b = BUILDERS[name]; if (!b) return false;
      const g = b(name === 'bed' && rnd() < bloodyChance);
      const fw = g.userData.fw || 0.6, fd = g.userData.fd || 0.6;
      const rec = fit(name, xm, zm, fw, fd, rotY || 0);
      if (!rec) { discard(g); return false; }
      g.position.set(rec.xm, 0, rec.zm); g.rotation.y = rotY || 0;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      group.add(g);
      register(name, rec, g.userData.solid !== false);
      if (g.userData.ember) group.userData.ember = g;
      if (g.userData.anim) animated.push({ obj: g, kind: g.userData.anim, phase: rnd() * 6 });
      return true;
    };

    // light grit pass — the arranged furniture (vr-game.js) carries the room now,
    // so this just adds a few loose bits of debris, not a pile of random junk
    const areaT = (room.w - 2) * (room.h - 2);
    const CLUTTER = ['papers', 'newspaper', 'tray', 'iv', 'papers', 'newspaper'];
    const nClutter = Math.min(6, Math.max(1, Math.floor(areaT / 14)));
    // wall details: blood smears + 1926 fire scorch marks climbing the walls
    const wallDetail = (kind, count) => {
      for (let i = 0; i < count; i++) {
        const onX = rnd() < 0.5;
        const p = decalPlane(kind, 1.1 + rnd(), 1.2 + rnd());
        if (onX) { p.position.set(rnd() < 0.5 ? x0 + 0.06 : x1 - 0.06, 0.9 + rnd() * 1.2, z0 + rnd() * (z1 - z0)); p.rotation.y = p.position.x < (x0 + x1) / 2 ? Math.PI / 2 : -Math.PI / 2; }
        else { p.position.set(x0 + rnd() * (x1 - x0), 0.9 + rnd() * 1.2, rnd() < 0.5 ? z0 + 0.06 : z1 - 0.06); p.rotation.y = p.position.z < (z0 + z1) / 2 ? 0 : Math.PI; }
        group.add(p);
      }
    };
    const bloody = ['morgue', 'autopsy', 'er', 'surgery', 'iso', 'room207'].includes(room.tag);
    const burnt = ['boiler', 'incinerator', 'ritual', 'storage', 'laundry', 'kitchen'].includes(room.tag);
    if (bloody) { wallDetail('blood', 2 + (rnd() * 3 | 0)); if (rnd() < 0.8) place('bloodpool', cx + (rnd() - 0.5) * 2, cz + (rnd() - 0.5) * 2, 0); }
    if (burnt) wallDetail('scorch', 2 + (rnd() * 3 | 0));
    // EVERY room now carries some wall grime — the walls are never bare/identical
    if (!bloody && !burnt) wallDetail(rnd() < 0.5 ? 'blood' : 'scorch', 1 + (rnd() * 2 | 0));
    const style = spec.style;
    if (style === 'rows') {
      // grid fill
      const cols = Math.min(items.length, 3);
      const rows = Math.ceil(items.length / cols);
      let i = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols && i < items.length; c++, i++) {
        const xm = x0 + (x1 - x0) * (cols === 1 ? 0.5 : c / (cols - 1));
        const zm = z0 + (z1 - z0) * (rows === 1 ? 0.5 : r / (rows - 1));
        place(items[i], xm, zm, 0);
      }
    } else if (style === 'center') {
      items.forEach((it, i) => {
        const zm = z0 + (z1 - z0) * (items.length === 1 ? 0.5 : i / (items.length - 1));
        place(it, cx, zm, 0);
      });
    } else if (style === 'morgue') {
      // drawers hug the two long walls, slab centre
      place('drawers', x0, cz - 1.2, Math.PI / 2);
      place('drawers', x1, cz + 1.2, Math.PI / 2);
      place('slab', cx, cz, 0);
    } else if (style === 'chapel') {
      // Face the altar away from whichever wall owns the door. Two pew banks leave
      // a real centre aisle instead of putting every bench across the entry line.
      const frontZ = doorAtNearZ ? z1 : z0;
      const intoRoom = doorAtNearZ ? -1 : 1;
      const face = doorAtNearZ ? Math.PI : 0;
      place('cross', cx, frontZ, face);
      place('altar', cx, frontZ + intoRoom * 0.9, face);
      let pew = 0;
      items.forEach((it) => {
        if (it !== 'pew') return;
        const row = Math.floor(pew / 2), side = (pew % 2) ? 1 : -1;
        place('pew', cx + side * 1.8, frontZ + intoRoom * (2.0 + row * 1.2), face);
        pew++;
      });
    } else if (style === 'kitchen') {
      // counters along top & bottom walls, prep table centre
      place('counter', cx - 2, z0, 0); place('counter', cx, z0, 0); place('counter', cx + 2, z0, 0);
      place('stove', x1 - 0.5, z0, 0);
      place('shelf', x0, cz, Math.PI / 2);
      place('preptable', cx, cz + 0.5, 0);
      place('counter', cx, z1, Math.PI);
    } else if (style === 'mose') {
      place('window', cx, z0 - 0.4, 0);   // the window, on the far wall
      place('bed', x0 + 0.6, cz, 0);
      place('wheelchair', x1 - 0.6, cz, 0);
    } else if (style === 'nursery') {
      // the haunted children's ward — rows of cribs, a mobile, scattered toys
      const nCrib = 3;
      for (let i = 0; i < nCrib; i++) {
        const xm = x0 + (x1 - x0) * (nCrib === 1 ? 0.5 : i / (nCrib - 1));
        place('crib', xm, z0, 0); place('crib', xm, z1, Math.PI);
      }
      place('bassinet', x0, cz, Math.PI / 2);
      place('bassinet', x1, cz, Math.PI / 2);
      place('rockinghorse', cx - 1.1, cz, 0.3);
      place('toybox', cx + 1.3, cz + 0.6, 0);
      place('mobile', cx, cz - 0.4, 0);
      place('teddy', cx + 0.4, cz - 0.2, 0);
      place('ball', cx - 0.6, cz + 0.9, 0);
      place('toyblocks', cx + 0.2, cz + 1.1, 0);
    } else { // 'walls' — alternate along top then bottom wall, facing centre
      const top = [], bot = [];
      items.forEach((it, i) => (i % 2 ? bot : top).push(it));
      const lay = (arr, zm, rot) => arr.forEach((it, i) => {
        const xm = x0 + (x1 - x0) * (arr.length === 1 ? 0.5 : i / (arr.length - 1));
        place(it, xm, zm, rot);
      });
      lay(top, z0, 0);
      lay(bot, z1, Math.PI);
    }

    // Sparse large rooms need one or two readable silhouettes, not random piles.
    // Fill only side-wall slots, stop at a small density target, and leave the
    // authored ritual/nursery/chapel layouts alone for their later set-pieces.
    const noFill = ['ritual', 'nursery', 'chapel', 'kitchen', 'morgue', 'mose'];
    const desired = areaT >= 70 ? 3 : 2;
    if (!noFill.includes(room.tag) && placedFloor < desired) {
      const service = ['boiler', 'incinerator', 'laundry', 'storage', 'supply', 'records', 'linen', 'attic', 'landing', 'roof'].includes(room.tag);
      const clinical = ['er', 'surgery', 'prep', 'xray', 'autopsy', 'ward', 'recovery', 'iso', 'room207', 'maternity', 'pharmacy', 'bath'].includes(room.tag);
      const fillers = service ? ['crates', 'shelf', 'cart'] : clinical ? ['wheelchair', 'iv', 'tray', 'shelf'] : ['wheelchair', 'crates', 'tray'];
      const dz = Math.min((roomBox.z1 - roomBox.z0) * 0.22, TILE_M * 1.4);
      const slots = [
        [roomBox.x0 + 0.55, cz - dz, Math.PI / 2],
        [roomBox.x1 - 0.55, cz + dz, -Math.PI / 2],
        [roomBox.x0 + 0.55, cz + dz, Math.PI / 2],
        [roomBox.x1 - 0.55, cz - dz, -Math.PI / 2],
      ];
      for (let i = 0; i < slots.length && placedFloor < desired; i++) {
        const [sx, sz, syaw] = slots[i];
        place(fillers[i % fillers.length], sx, sz, syaw);
      }
    }

    // Loose paper goes in last so it can avoid furniture footprints and the door
    // runway. It remains non-colliding and therefore cannot narrow traversal.
    for (let i = 0; i < nClutter; i++) {
      const cxm = x0 + rnd() * (x1 - x0);
      const czm = z0 + rnd() * (z1 - z0);
      place(CLUTTER[Math.floor(rnd() * CLUTTER.length)], cxm, czm, rnd() * 6.28);
    }
  }

  // ---------- fluorescent ceiling fixtures (some flicker / are dead) ----------
  function makeFixtures(group, fi, TILE_M, WALL_H) {
    const THREE = T(), m = mats();
    const fixtures = [];
    const addTube = (tx, tz, withLight) => {
      const tube = box(1.6, 0.08, 0.28, m.tube.clone(), (tx) * TILE_M, WALL_H - 0.12, (tz) * TILE_M);
      tube.material.emissiveIntensity = 0.9;
      group.add(tube);
      let light = null;
      if (withLight) {
        light = new THREE.PointLight(0xcfe0ff, 0.0, 7 * TILE_M / 2.7, 2);
        light.position.set(tx * TILE_M, WALL_H - 0.4, tz * TILE_M);
        group.add(light);
      }
      // some dead tubes hang broken off the ceiling by one wire
      const dead = rnd() < 0.28;
      if (dead && rnd() < 0.5) {
        tube.rotation.z = 0.55 + rnd() * 0.3;
        tube.position.y -= 0.42;
        tube.position.x += 0.5;
        const wire = box(0.02, 0.5, 0.02, m.dark || mats().dark, tube.position.x - 0.75, WALL_H - 0.25, tube.position.z);
        group.add(wire);
        // glass shards on the floor beneath
        for (let s = 0; s < 4; s++) group.add(box(0.05, 0.01, 0.08, mats().tube, tube.position.x + (rnd() - 0.5), 0.031, tube.position.z + (rnd() - 0.5)));
      }
      fixtures.push({ tube, light, dead, on: !dead, base: withLight ? 1.1 : 0, phase: rnd() * 6, nextFlick: rnd() * 3 });
    };
    // corridor tubes every ~8 tiles; REAL lights only on every other one (Quest perf)
    const ct = (_data && _data.CORR_TOP) || 14, cb = (_data && _data.CORR_BOT) || 17;
    const midY = Math.floor((ct + cb) / 2);
    let li = 0;
    for (let x = 6; x < World.W - 4; x += 8) addTube(x + 0.5, midY + 0.5, (li++ % 2) === 0);
    // a tube in every room (emissive only — no light cost)
    (data_rooms(fi) || []).forEach((r) => addTube(r.cx + 0.5, r.cy + 0.5, false));
    return fixtures;
  }
  let _data = null;
  function data_rooms(fi) { return _data && _data.floors[fi] && _data.floors[fi].rooms; }

  // ---------- public ----------
  function populate(fi, data, opts) {
    _data = data;
    reseed(90210 ^ (fi * 7919 + 1));   // same night, same floor -> same rooms, same collision
    const THREE = T();
    const TILE_M = opts.TILE_M, WALL_H = opts.WALL_H;
    const group = new THREE.Group();
    const solids = [];
    const animated = [];
    const reservedFor = (room) => {
      const keep = [];
      const grid = data.floors[fi].grid;
      const special = new Set([data.TILE.HIDE, data.TILE.EXIT, data.TILE.CANDLE]);
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
        if (!special.has(grid[y] && grid[y][x])) continue;
        keep.push({
          x0: x * TILE_M + 0.1, x1: (x + 1) * TILE_M - 0.1,
          z0: y * TILE_M + 0.1, z1: (y + 1) * TILE_M - 0.1,
        });
      }
      const reservePickup = (entry) => {
        if (!entry || entry.floor !== fi || entry.taken || entry.found) return;
        if (entry.x < room.x || entry.x >= room.x + room.w || entry.y < room.y || entry.y >= room.y + room.h) return;
        const x = (entry.x + 0.5) * TILE_M, z = (entry.y + 0.5) * TILE_M, half = 0.62;
        keep.push({ x0: x - half, x1: x + half, z0: z - half, z1: z + half });
      };
      (data.items || []).forEach(reservePickup);
      (data.documents || []).forEach(reservePickup);
      return keep;
    };
    data.floors[fi].rooms.forEach((room) => {
      try { fillRoom(group, solids, animated, room, TILE_M, fi === 1 || fi === 0 ? 0.25 : 0.12, reservedFor(room)); }
      catch (e) { /* never let one room break the floor */ }
    });
    // corridor clutter — abandoned gurneys, wheelchairs, crates along the walls
    (() => {
      const ct = data.CORR_TOP || 14, cb = data.CORR_BOT || 17;
      const doorXs = [];
      data.floors[fi].rooms.forEach((r) => doorXs.push((r.doorX + 0.5) * TILE_M));
      const CORR = ['wheelchair', 'cart', 'bed', 'bed', 'chair', 'crates', 'iv', 'shelf', 'wheelchair', 'cabinet'];
      const corridor = { z0: ct * TILE_M + 0.16, z1: (cb + 1) * TILE_M - 0.16 };
      const centreZ = (corridor.z0 + corridor.z1) / 2;
      const corridorPlaced = [];
      const overlaps = (a, b, pad) => a.x0 + pad < b.x1 && a.x1 - pad > b.x0 && a.z0 + pad < b.z1 && a.z1 - pad > b.z0;
      // candles, lockers, stairs, and the exit keep their whole tile clear
      const specials = [];
      const grid = data.floors[fi].grid;
      const SP = new Set([data.TILE.CANDLE, data.TILE.HIDE, data.TILE.EXIT, data.TILE.UP, data.TILE.DOWN]);
      for (let y = ct; y <= cb; y++) for (let sx = 0; sx < (data.W || 64); sx++) {
        if (!SP.has(grid[y][sx])) continue;
        specials.push({ x0: sx * TILE_M - 0.05, x1: (sx + 1) * TILE_M + 0.05, z0: y * TILE_M - 0.05, z1: (y + 1) * TILE_M + 0.05 });
      }
      let slot = 0;
      for (let x = 5; x < (data.W || 64) - 5; x += 4, slot++) {
        const xx = x + (rnd() - 0.5) * 2;
        const top = (slot % 2) === 0;
        const name = CORR[Math.floor(rnd() * CORR.length)];
        const b = BUILDERS[name]; if (!b) continue;
        const g = b();
        const yaw = (top ? 0 : Math.PI) + (rnd() - 0.5) * 0.32;
        const fw = g.userData.fw || 0.6, fd = g.userData.fd || 0.6;
        const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
        const w = fw * c + fd * s, d = fw * s + fd * c;
        const xm = (xx + 0.5) * TILE_M;
        const zm = top ? corridor.z0 + d / 2 + 0.18 : corridor.z1 - d / 2 - 0.18;
        const rec = { x0: xm - w / 2, x1: xm + w / 2, z0: zm - d / 2, z1: zm + d / 2 };
        // Keep a broad centre aisle, door approaches, and other props clear.
        const blocksCentre = top ? rec.z1 > centreZ - 0.9 : rec.z0 < centreZ + 0.9;
        const blocksDoor = doorXs.some((dx) => rec.x0 < dx + TILE_M * 1.15 && rec.x1 > dx - TILE_M * 1.15);
        const blocksProp = corridorPlaced.some((p) => overlaps(rec, p, 0.12)) || solids.some((p) => overlaps(rec, p, 0.08));
        const blocksSpecial = specials.some((p) => overlaps(rec, p, 0));
        if (blocksCentre || blocksDoor || blocksProp || blocksSpecial) { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); continue; }
        g.position.set(xm, 0, zm);
        g.rotation.y = yaw;
        group.add(g);
        corridorPlaced.push(rec);
        if (g.userData.solid !== false) {
          solids.push(rec);
        }
      }
    })();

    const fixtures = makeFixtures(group, fi, TILE_M, WALL_H);
    // per-room coloured mood lights (dim, flickered by the game)
    const moods = [];
    data.floors[fi].rooms.forEach((room) => {
      const spec = FILL[room.tag];
      if (!spec || !spec.mood) return;
      const l = new THREE.PointLight(spec.mood, 0.55, 6.5, 2);
      l.position.set((room.cx + 0.5) * TILE_M, WALL_H - 0.7, (room.cy + 0.5) * TILE_M);
      group.add(l);
      moods.push({ light: l, base: 0.55 });
    });
    return { group, solids, fixtures, ember: group.userData.ember || null, animated, moods };
  }

  return { populate };
})();
if (typeof window !== 'undefined') window.Props = Props;
