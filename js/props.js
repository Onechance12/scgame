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
      g.add(box(0.34, 0.015, 0.4, m.stain, 0.14, 0.005, 0.62)); // dripped to the floor
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

  const BUILDERS = {
    bed, crib, wheelchair, operating: operatingTable, examlight: examLight, drawers: morgueDrawers,
    slab, cabinet, shelf, crates, chair, table, desk, counter, stove, sink, bathtub, iv: ivStand,
    boiler, incinerator, washer, pew, cross, altar, bell, xraymachine: xrayMachine, window: windowProp,
    preptable, tray, rocker, pipes, cart: crates,
    bassinet, rockinghorse: rockingHorse, teddy, toyblocks: toyBlocks, ball, mobile, toybox, incubator,
    casket, shroud: shroudBody,
  };

  // tag -> {items, style}
  const FILL = {
    nursery: { items: [], style: 'nursery', mood: 0x9a6a2a },
    maternity: { items: ['incubator', 'incubator', 'bassinet', 'bassinet', 'rocker'], style: 'walls', mood: 0x8a5a3a },
    er: { items: ['bed', 'bed', 'bed', 'iv', 'examlight'], style: 'walls', mood: 0x6a8a9a },
    ward: { items: ['bed', 'bed', 'bed', 'bed'], style: 'walls' },
    recovery: { items: ['bed', 'bed', 'bed', 'iv'], style: 'walls' },
    room207: { items: ['bed', 'wheelchair', 'cabinet'], style: 'walls' },
    iso: { items: ['bed'], style: 'center' },
    quarters: { items: ['bed', 'bed', 'cabinet', 'chair'], style: 'walls' },
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
    lobby: { items: ['counter', 'chair', 'chair', 'wheelchair'], style: 'walls' },
    admitting: { items: ['desk', 'chair', 'cabinet'], style: 'walls' },
    waiting: { items: ['chair', 'chair', 'chair', 'chair', 'chair', 'chair'], style: 'rows' },
    kitchen: { items: ['counter', 'counter', 'stove', 'shelf', 'preptable'], style: 'kitchen' },
    cafeteria: { items: ['table', 'table', 'table', 'chair', 'chair', 'chair'], style: 'rows' },
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
  const DEFAULT_FILL = { items: ['chair', 'crates'], style: 'walls' };

  // place props for one room
  function fillRoom(group, solids, animated, room, TILE_M, bloodyChance) {
    const spec = FILL[room.tag] || DEFAULT_FILL;
    const items = spec.items;
    // room interior in metres, inset from walls
    const x0 = (room.x + 1.2) * TILE_M, x1 = (room.x + room.w - 1.2) * TILE_M;
    const z0 = (room.y + 1.2) * TILE_M, z1 = (room.y + room.h - 1.2) * TILE_M;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

    const place = (name, xm, zm, rotY) => {
      const b = BUILDERS[name]; if (!b) return;
      const g = b(name === 'bed' && Math.random() < bloodyChance);
      g.position.set(xm, 0, zm); g.rotation.y = rotY || 0;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      group.add(g);
      if (g.userData.solid !== false) {
        const fw = g.userData.fw || 0.6, fd = g.userData.fd || 0.6;
        const rot = Math.abs((rotY || 0) % Math.PI) > 0.7; // ~90deg -> swap footprint
        const w = rot ? fd : fw, d = rot ? fw : fd;
        solids.push({ x0: xm - w / 2, z0: zm - d / 2, x1: xm + w / 2, z1: zm + d / 2 });
      }
      if (g.userData.ember) group.userData.ember = g;
      if (g.userData.anim) animated.push({ obj: g, kind: g.userData.anim, phase: Math.random() * 6 });
    };

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
      // pews in rows facing an altar+cross at the far (z0) end
      place('altar', cx, z0 + 0.4, 0);
      place('cross', cx, z0, 0);
      let row = 0;
      items.forEach((it) => { if (it === 'pew') { place('pew', cx, z0 + 1.6 + row * 1.0, 0); row++; } });
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
      // start mostly-off; corridor lights flicker to life
      const dead = Math.random() < 0.28;
      fixtures.push({ tube, light, dead, on: !dead, base: withLight ? 1.1 : 0, phase: Math.random() * 6, nextFlick: Math.random() * 3 });
    };
    // corridor line (with real lights) every ~8 tiles
    const ct = (_data && _data.CORR_TOP) || 14, cb = (_data && _data.CORR_BOT) || 17;
    const midY = Math.floor((ct + cb) / 2);
    for (let x = 6; x < World.W - 4; x += 8) addTube(x + 0.5, midY + 0.5, true);
    // a few room tubes (emissive only)
    (data_rooms(fi) || []).forEach((r, i) => { if (i % 2 === 0) addTube(r.cx + 0.5, r.cy + 0.5, false); });
    return fixtures;
  }
  let _data = null;
  function data_rooms(fi) { return _data && _data.floors[fi] && _data.floors[fi].rooms; }

  // ---------- public ----------
  function populate(fi, data, opts) {
    _data = data;
    const THREE = T();
    const TILE_M = opts.TILE_M, WALL_H = opts.WALL_H;
    const group = new THREE.Group();
    const solids = [];
    const animated = [];
    data.floors[fi].rooms.forEach((room) => {
      try { fillRoom(group, solids, animated, room, TILE_M, fi === 1 || fi === 0 ? 0.25 : 0.12); }
      catch (e) { /* never let one room break the floor */ }
    });
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
