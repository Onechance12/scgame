/* ============================================================================
 * vr-game.js — COLLEGE HILL: 24 Hours, in VR (WebXR + Three.js).
 *
 * A first-person survival-horror build for Meta Quest (WebXR) with a desktop
 * fallback. Reuses the shared map (World), entity AI (Entities), and the
 * procedural audio engine (Audio2) from the 2D version.
 *
 * Coordinate mapping:  tile (x, y)  ->  world (x*TILE_M, height, y*TILE_M)
 * The whole detection/AI layer lives in tile space, so we sync the player's
 * tile coords from the camera each frame and let Entities do the rest.
 * ==========================================================================*/

/* Loaded as a classic script after three.min.js (global THREE) and after
 * audio.js / world.js / entities.js. Wrapped in an IIFE to avoid colliding
 * with those scripts' top-level declarations (e.g. TILE). */
(() => {
const THREE = window.THREE;

const TILE_M = 2.7;      // metres per map tile
const WALL_H = 3.2;      // wall / ceiling height
const EYE = 1.6;         // eye height (standing)
const LIGHT_RANGE = 8.5; // flashlight reach, in tiles (matches AI)
const CONE = 0.62;       // flashlight cone half-angle (rad), matches AI
const GAME_SECONDS = 1080;
const HOURS_PER_SEC = 24 / GAME_SECONDS;
const KEY_FOR = { mose: 'key_mose', incinerator: 'key_incinerator', roof: 'key_roof' };
const TILE = World.TILE;

// ---- three core objects ----
let renderer, scene, camera, dolly, clock;
let flashlight, flashState = true;
let ambient, fog;
let floorGroup = null;          // geometry of the current floor
let doorMeshes = new Map();     // "x,y" -> mesh (for unlocking locked doors)
let itemMeshes = new Map();     // item.id -> mesh
let entityMeshes = new Map();   // entity -> {group,...}
let candleLights = [];
let vignette;                   // comfort + fear ring attached to camera
let wristPanel, wristCtx, wristTex; // in-VR HUD
let bigPanel, bigCtx, bigTex;   // in-VR message/title panel

// ---- controllers ----
let controller1, controller2, grip1, grip2;
let sources = { left: null, right: null };
let snapCooldown = 0;

// ---- game state (ported) ----
let data, ents, player;
let state = 'MENU';   // MENU | PLAY | PAUSE | DEAD | WIN
let hour = 0, elapsed = 0;
let messages = [], msgText = '', msgTimer = 0;
let spiritActive = false, spiritHold = 0;
let ambientEventTimer = 6, scareCooldown = 0, flashFlicker = 1;
let interactTarget = null, deathBy = '';
let isVR = false;
let desk = { yaw: 0, pitch: 0, dragging: false, px: 0, py: 0 }; // desktop look
let hudTick = 0;

const keys = {};
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// ============================================================ boot
init();

function init() {
  const app = document.getElementById('app');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  app.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03030a);
  fog = new THREE.FogExp2(0x03030a, 0.055);
  scene.fog = fog;

  ambient = new THREE.AmbientLight(0x3a4652, 0.10);
  scene.add(ambient);
  const moon = new THREE.DirectionalLight(0x25406a, 0.10);
  moon.position.set(6, 20, 4);
  scene.add(moon);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 120);
  dolly = new THREE.Group();          // locomotion rig: holds camera + controllers
  dolly.add(camera);
  scene.add(dolly);
  camera.position.set(0, EYE, 0);

  // Flashlight — parented to the right hand in VR, to the camera on desktop.
  flashlight = new THREE.SpotLight(0xfff2d6, 22, LIGHT_RANGE * TILE_M, CONE, 0.5, 1.2);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024);
  flashlight.shadow.camera.near = 0.1;
  flashlight.shadow.camera.far = LIGHT_RANGE * TILE_M;
  flashlight.target.position.set(0, 0, -1);
  camera.add(flashlight);
  camera.add(flashlight.target);

  clock = new THREE.Clock();

  setupControllers();
  setupVignette();
  setupWristPanel();
  setupBigPanel();

  window.addEventListener('resize', onResize);
  bindDesktopInput();
  bindUI();
  checkXR();

  renderer.setAnimationLoop(render);
}

function checkXR() {
  const note = document.getElementById('xr-note');
  const btnVR = document.getElementById('btn-vr');
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      if (ok) {
        note.innerHTML = 'Headset detected. Press <b>ENTER IN VR</b> and put it on. ' +
          'Left stick to walk, right stick to snap-turn, trigger to interact, grip to toggle the flashlight, hold left grip for the spirit box.';
      } else {
        btnVR.disabled = true; btnVR.style.opacity = .5;
        note.innerHTML = 'No VR headset on this device. On a <b>Meta Quest</b>, open this page in the Quest browser (served over HTTPS) and the VR button lights up. Use <b>Play on Desktop</b> here.';
      }
    }).catch(() => {});
  } else {
    btnVR.disabled = true; btnVR.style.opacity = .5;
    note.innerHTML = 'This browser has no WebXR. On a <b>Meta Quest</b>, open this URL (HTTPS) in the Quest browser. Meanwhile, <b>Play on Desktop</b> works here.';
  }
}

// ============================================================ controllers
function setupControllers() {
  controller1 = renderer.xr.getController(0);
  controller2 = renderer.xr.getController(1);
  dolly.add(controller1); dolly.add(controller2);

  const factory = makeHandMesh();
  grip1 = renderer.xr.getControllerGrip(0);
  grip2 = renderer.xr.getControllerGrip(1);
  grip1.add(factory.clone()); grip2.add(factory.clone());
  dolly.add(grip1); dolly.add(grip2);

  [controller1, controller2].forEach((c) => {
    c.addEventListener('connected', (e) => {
      const hand = e.data && e.data.handedness;
      c.userData.inputSource = e.data;
      if (hand === 'left') {
        sources.left = c;
        // move the wrist HUD onto the actual left hand's grip
        const lg = (c === controller1) ? grip1 : grip2;
        if (wristPanel.parent) wristPanel.parent.remove(wristPanel);
        lg.add(wristPanel);
      } else if (hand === 'right') { sources.right = c; attachFlashlightTo(c); }
    });
    c.addEventListener('disconnected', () => { c.userData.inputSource = null; });
    c.addEventListener('selectstart', () => onTrigger(c));       // interact
    c.addEventListener('squeezestart', () => onSqueezeStart(c)); // flashlight / spirit
    c.addEventListener('squeezeend', () => onSqueezeEnd(c));
  });
}

function attachFlashlightTo(c) {
  // move the flashlight from the camera onto the right controller
  camera.remove(flashlight); camera.remove(flashlight.target);
  c.add(flashlight); c.add(flashlight.target);
  flashlight.position.set(0, 0, 0);
  flashlight.target.position.set(0, 0, -1);
}

function makeHandMesh() {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.02, 0.03, 0.10, 8);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: .8 }));
  m.rotation.x = -Math.PI / 2;
  g.add(m);
  // little flashlight body on the right hand look
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.022, 0.12, 10),
    new THREE.MeshStandardMaterial({ color: 0x222428, roughness: .6, metalness: .3 }));
  body.rotation.x = -Math.PI / 2; body.position.z = -0.06;
  g.add(body);
  return g;
}

function onTrigger(c) {
  if (state === 'DEAD' || state === 'WIN' || state === 'MENU') { restartFromPanel(); return; }
  if (state !== 'PLAY') return;
  interact();
}
function onSqueezeStart(c) {
  if (state !== 'PLAY') return;
  if (c === sources.right) toggleFlash();
  else if (c === sources.left) startSpirit();
}
function onSqueezeEnd(c) {
  if (c === sources.left) stopSpirit();
}

// ============================================================ vignette / panels
function setupVignette() {
  const size = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(size / 2, size / 2, size * 0.30, size / 2, size / 2, size * 0.52);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
  vignette = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mat);
  vignette.position.set(0, 0, -1);
  vignette.renderOrder = 999;
  camera.add(vignette);
}

function setupWristPanel() {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200;
  wristCtx = cv.getContext('2d');
  wristTex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: wristTex, transparent: true });
  wristPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.10), mat);
  wristPanel.position.set(0, 0.04, -0.06);
  wristPanel.rotation.x = -Math.PI / 3;
  wristPanel.visible = false;
  // attached to left grip when connected; add to grip1 now (handedness set later)
  grip1.add(wristPanel);
}

function setupBigPanel() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
  bigCtx = cv.getContext('2d');
  bigTex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: bigTex, transparent: true, depthTest: false });
  bigPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), mat);
  bigPanel.position.set(0, 0, -1.8);
  bigPanel.renderOrder = 1000;
  bigPanel.visible = false;
  camera.add(bigPanel);
}

function showBigPanel(title, lines, color) {
  bigPanel.visible = true;
  const c = bigCtx;
  c.clearRect(0, 0, 1024, 512);
  c.fillStyle = 'rgba(4,4,8,0.86)';
  c.fillRect(0, 0, 1024, 512);
  c.textAlign = 'center';
  c.fillStyle = color || '#e7edf2';
  c.font = 'bold 90px Courier New';
  c.fillText(title, 512, 130);
  c.fillStyle = '#b7c0c8';
  c.font = '30px Courier New';
  (lines || []).forEach((l, i) => c.fillText(l, 512, 210 + i * 46));
  c.fillStyle = '#8a95a0';
  c.font = '26px Courier New';
  c.fillText('— pull the trigger to continue —', 512, 470);
  bigTex.needsUpdate = true;
}
function hideBigPanel() { bigPanel.visible = false; }

// ============================================================ new game
function bindUI() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('btn-vr', enterVR);
  on('btn-desktop', () => startDesktop());
  on('btn-resume', resumeGame);
  on('btn-restart', () => newGame());
  on('btn-restart-dead', () => newGame());
  on('btn-restart-win', () => newGame());
}

function enterVR() {
  if (!navigator.xr) { startDesktop(); return; }
  Audio2.init(); Audio2.resume();
  const sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
  navigator.xr.requestSession('immersive-vr', sessionInit).then((session) => {
    isVR = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setSession(session);
    session.addEventListener('end', () => { isVR = false; });
    wristPanel.visible = true;
    document.getElementById('vr-crosshair').style.display = 'none';
    newGame();
  }).catch((err) => {
    console.warn('VR session failed:', err);
    startDesktop();
  });
}

function startDesktop() {
  isVR = false;
  Audio2.init(); Audio2.resume();
  document.getElementById('vr-hud').classList.add('show');
  document.getElementById('vr-crosshair').style.display = 'block';
  document.getElementById('controls-hint').textContent =
    'WASD move · drag mouse to look · click to lock pointer · F flashlight · E interact · Q spirit box · Shift run · P pause';
  // desktop uses camera-mounted flashlight
  if (flashlight.parent !== camera) { flashlight.parent.remove(flashlight); flashlight.parent.remove(flashlight.target); camera.add(flashlight); camera.add(flashlight.target); flashlight.position.set(0.2, -0.2, 0); flashlight.target.position.set(0, 0, -1); }
  newGame();
}

function newGame() {
  hideAllScreens();
  hideBigPanel();
  data = World.build();
  ents = Entities.spawnAll(data);
  const sp = World.spawn(data);
  player = {
    floor: sp.floor, x: sp.x + 0.5, y: sp.y + 0.5,
    aim: 0, fear: 12, stamina: 100, battery: 100,
    hasLight: false, lightOn: false, hidden: false, inv: {}, keys: {},
  };
  hour = 0; elapsed = 0; messages = []; spiritHold = 0; spiritActive = false;
  deathBy = ''; ambientEventTimer = 5; scareCooldown = 0;
  data.objectives.forEach((o) => (o.done = false));
  buildFloor(player.floor);
  placeDollyAtTile(player.x, player.y);
  flashState = true; player.lightOn = false; flashlight.visible = false; player.hasLight = false;
  state = 'PLAY';
  Audio2.startAmbient();
  runIntro(0);
}

const INTRO = [
  ['COLLEGE HILL', ['The Old Hospital on College Hill', 'Williamson, West Virginia'], '#e7edf2'],
  ['1928', ['Opened after the old hospital burned.', 'Closed in 1988. Never emptied.'], '#c9a24a'],
  ['24 HOURS', ['Your ride is gone. The doors are chained.', 'They have until dawn with you.'], '#e02a2a'],
  ['FIND THE LIGHT', ['A flashlight waits in the lobby.', 'Then find the truth of the dead.'], '#9aa7b0'],
];
function runIntro(i) {
  if (state !== 'PLAY') return;
  if (i >= INTRO.length) { hideBigPanel(); showSubtitle('Grab the flashlight. Pull the trigger to interact.', 5); return; }
  const [t, l, c] = INTRO[i];
  showBigPanel(t, l, c);
  showSubtitle(l.join('  '), 3);
  setTimeout(() => runIntro(i + 1), 3200);
}

// ============================================================ world geometry
function disposeGroup(g) {
  if (!g) return;
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }
  });
  scene.remove(g);
}

function buildFloor(fi) {
  disposeGroup(floorGroup);
  doorMeshes.clear(); itemMeshes.clear(); candleLights = [];
  entityMeshes.forEach((v) => v.group && scene.remove(v.group));
  entityMeshes.clear();

  const g = data.floors[fi].grid;
  floorGroup = new THREE.Group();
  scene.add(floorGroup);

  const spanX = World.W * TILE_M, spanZ = World.H * TILE_M;

  // floor + ceiling
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanZ), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(spanX / 2, 0, spanZ / 2);
  floor.receiveShadow = true;
  floorGroup.add(floor);

  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0d0d12, roughness: 1 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanZ), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(spanX / 2, WALL_H, spanZ / 2);
  floorGroup.add(ceil);

  // count walls -> instanced
  let wallCount = 0;
  for (let y = 0; y < World.H; y++) for (let x = 0; x < World.W; x++) if (g[y][x] === TILE.WALL) wallCount++;
  const wallGeo = new THREE.BoxGeometry(TILE_M, WALL_H, TILE_M);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: .95 });
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  walls.castShadow = true; walls.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  let wi = 0;
  for (let y = 0; y < World.H; y++) {
    for (let x = 0; x < World.W; x++) {
      const t = g[y][x];
      const wx = (x + 0.5) * TILE_M, wz = (y + 0.5) * TILE_M;
      if (t === TILE.WALL) {
        m4.makeTranslation(wx, WALL_H / 2, wz);
        walls.setMatrixAt(wi++, m4);
      } else if (t === TILE.DOOR || t === TILE.LOCKED) {
        addDoor(x, y, wx, wz, t === TILE.LOCKED);
      } else if (t === TILE.CANDLE) {
        addCandle(wx, wz);
      } else if (t === TILE.UP || t === TILE.DOWN) {
        addStairs(wx, wz, t === TILE.UP);
      } else if (t === TILE.EXIT) {
        addExit(wx, wz);
      } else if (t === TILE.HIDE) {
        addLocker(wx, wz);
      }
    }
  }
  walls.instanceMatrix.needsUpdate = true;
  floorGroup.add(walls);

  // items on this floor
  data.items.forEach((it) => { if (!it.taken && it.floor === fi) addItemMesh(it); });

  // entities present on this floor get meshes
  ents.forEach((e) => { if (e.floor === fi) ensureEntityMesh(e); });
}

function addDoor(x, y, wx, wz, locked) {
  const mat = new THREE.MeshStandardMaterial({ color: locked ? 0x5a1e1e : 0x3a2a1c, roughness: .8, emissive: locked ? 0x300000 : 0x000000 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(TILE_M * 0.9, WALL_H * 0.92, 0.18), mat);
  door.position.set(wx, WALL_H * 0.46, wz);
  door.castShadow = true;
  floorGroup.add(door);
  if (locked) doorMeshes.set(x + ',' + y, door);
}
function addCandle(wx, wz) {
  const light = new THREE.PointLight(0xffb455, 1.4, 5.5, 2);
  light.position.set(wx, 1.1, wz);
  floorGroup.add(light);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd07a }));
  flame.position.copy(light.position);
  floorGroup.add(flame);
  candleLights.push({ light, base: 1.4 });
}
function addStairs(wx, wz, up) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x223247, roughness: .9, emissive: 0x0a1830 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(TILE_M * 0.8, 0.5, TILE_M * 0.8), mat);
  m.position.set(wx, 0.25, wz); floorGroup.add(m);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 4),
    new THREE.MeshBasicMaterial({ color: 0x7fb0ff }));
  arrow.position.set(wx, 1.0, wz);
  arrow.rotation.x = up ? 0 : Math.PI;
  floorGroup.add(arrow);
}
function addExit(wx, wz) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x123a24, emissive: 0x0a5030, roughness: .6 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(TILE_M * 0.95, WALL_H * 0.95, 0.25), mat);
  m.position.set(wx, WALL_H * 0.47, wz); floorGroup.add(m);
}
function addLocker(wx, wz) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x30323c, metalness: .3, roughness: .7 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(TILE_M * 0.6, WALL_H * 0.8, TILE_M * 0.4), mat);
  m.position.set(wx, WALL_H * 0.4, wz); m.castShadow = true;
  floorGroup.add(m);
}

const ITEM_COLORS = { flashlight: 0xffe08a, battery: 0x8affa0, emf: 0x7ad0ff, spiritbox: 0xc99cff, candlekit: 0xffb86b, key: 0xffd24a };
function addItemMesh(it) {
  const col = ITEM_COLORS[it.type] || 0xffffff;
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .7, roughness: .3 }));
  g.add(mesh);
  const pl = new THREE.PointLight(col, 0.6, 3, 2); g.add(pl);
  g.position.set((it.x + 0.5) * TILE_M, 1.1, (it.y + 0.5) * TILE_M);
  g.userData.spin = mesh;
  floorGroup.add(g);
  itemMeshes.set(it.id, g);
}

// ---- entity meshes ----
function ensureEntityMesh(e) {
  if (entityMeshes.has(e)) return entityMeshes.get(e);
  const grp = new THREE.Group();
  let bodyColor = 0xaeb8c0, headColor = 0xe7edf2, emis = 0x0, scale = 1;
  if (e.kind === 'nurse') { bodyColor = 0x9aa7b0; headColor = 0xd7dde3; emis = 0x20242a; }
  else if (e.kind === 'mose') { bodyColor = 0x20181a; headColor = 0x241a1a; emis = 0x080000; }
  else if (e.kind === 'child') { bodyColor = 0x8b95a0; headColor = 0xaab4be; scale = 0.55; emis = 0x101418; }
  else if (e.kind === 'ash') { bodyColor = 0x120a08; headColor = 0x1a0e08; emis = 0x180800; }

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28 * scale, 0.42 * scale, 1.5 * scale, 10),
    new THREE.MeshStandardMaterial({ color: bodyColor, emissive: emis, emissiveIntensity: .6, roughness: 1 }));
  body.position.y = 0.75 * scale; body.castShadow = true; grp.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22 * scale, 12, 12),
    new THREE.MeshStandardMaterial({ color: headColor, emissive: emis, emissiveIntensity: .5, roughness: 1 }));
  head.position.y = 1.65 * scale; head.castShadow = true; grp.add(head);
  // eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: e.kind === 'mose' ? 0xff3020 : 0x05070a });
  [-0.08, 0.08].forEach((ex) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035 * scale, 6, 6), eyeMat);
    eye.position.set(ex * scale, 1.68 * scale, 0.19 * scale); grp.add(eye);
  });
  if (e.kind === 'ash') {
    const glow = new THREE.PointLight(0xff5a1e, 0.8, 4, 2); glow.position.y = 1; grp.add(glow);
    grp.userData.ember = glow;
  }
  grp.visible = false;
  scene.add(grp);
  const rec = { group: grp, body, head };
  entityMeshes.set(e, rec);
  return rec;
}

// ============================================================ locomotion
function placeDollyAtTile(tx, ty) {
  // Put the dolly so the *camera* ends up over (tx,ty). Camera local pos may be
  // offset by the headset; approximate by placing dolly and letting head track.
  dolly.position.set(tx * TILE_M - camera.position.x, 0, ty * TILE_M - camera.position.z);
}

function playerTileFromCamera() {
  camera.getWorldPosition(tmpV);
  player.x = tmpV.x / TILE_M;
  player.y = tmpV.z / TILE_M;
}

function passableFor(fi, x, y) {
  if (x < 0 || y < 0 || x >= World.W || y >= World.H) return false;
  const t = data.floors[fi].grid[Math.floor(y)][Math.floor(x)];
  return t === TILE.FLOOR || t === TILE.DOOR || t === TILE.UP || t === TILE.DOWN ||
    t === TILE.HIDE || t === TILE.CANDLE || t === TILE.EXIT;
}
function tileAt(fi, x, y) {
  if (x < 0 || y < 0 || x >= World.W || y >= World.H) return TILE.VOID;
  return data.floors[fi].grid[Math.floor(y)][Math.floor(x)];
}

// Move the dolly by (dxTiles, dyTiles) with wall collision in tile space.
function moveDolly(dxT, dyT) {
  playerTileFromCamera();
  const r = 0.24;
  const nx = player.x + dxT, ny = player.y + dyT;
  const sx = dxT > 0 ? r : -r, sy = dyT > 0 ? r : -r;
  if (dxT !== 0 && passableFor(player.floor, nx + sx, player.y + r) && passableFor(player.floor, nx + sx, player.y - r)) {
    dolly.position.x += dxT * TILE_M;
  }
  if (dyT !== 0 && passableFor(player.floor, player.x + r, ny + sy) && passableFor(player.floor, player.x - r, ny + sy)) {
    dolly.position.z += dyT * TILE_M;
  }
}

function readAxes(controller) {
  const src = controller && controller.userData.inputSource;
  if (!src || !src.gamepad) return [0, 0];
  const a = src.gamepad.axes;
  // Quest thumbstick is axes[2],axes[3]
  const x = a.length >= 4 ? a[2] : a[0];
  const y = a.length >= 4 ? a[3] : a[1];
  return [Math.abs(x) > 0.15 ? x : 0, Math.abs(y) > 0.15 ? y : 0];
}

function vrLocomotion(dt) {
  // heading = camera yaw in world
  camera.getWorldDirection(tmpV);
  const yaw = Math.atan2(tmpV.x, tmpV.z); // forward
  const [lx, ly] = readAxes(sources.left);
  if (lx || ly) {
    const speed = (keysSprint() ? 6 : 3.4);
    // forward is -y stick; strafe is x
    const fwd = -ly, str = lx;
    const dz = (Math.cos(yaw) * fwd + Math.cos(yaw + Math.PI / 2) * str);
    const dx = (Math.sin(yaw) * fwd + Math.sin(yaw + Math.PI / 2) * str);
    const step = speed * dt / TILE_M;
    moveDolly(dx * step, dz * step);
  }
  // snap turn on right stick x
  const [rx] = readAxes(sources.right);
  snapCooldown -= dt;
  if (Math.abs(rx) > 0.7 && snapCooldown <= 0) {
    snapTurn(rx > 0 ? -Math.PI / 6 : Math.PI / 6);
    snapCooldown = 0.3;
  }
}
function keysSprint() { return false; } // VR: no sprint stick button by default

function snapTurn(rad) {
  // rotate the dolly around the player's current head position
  camera.getWorldPosition(tmpV);
  dolly.position.sub(tmpV);
  dolly.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), rad);
  dolly.position.add(tmpV);
  dolly.rotateY(rad);
}

// ============================================================ desktop input
function bindDesktopInput() {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(); keys[k] = true;
    if (state === 'MENU') return;
    if (k === 'f') toggleFlash();
    if (k === 'e' && state === 'PLAY') interact();
    if (k === 'q' && state === 'PLAY') startSpirit();
    if (k === 'p' || k === 'escape') { if (state === 'PLAY') pause(); else if (state === 'PAUSE') resumeGame(); }
    if ((k === 'enter' || k === ' ') && (state === 'DEAD' || state === 'WIN')) newGame();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase(); keys[k] = false;
    if (k === 'q') stopSpirit();
  });
  const cv = renderer.domElement;
  cv.addEventListener('mousedown', (e) => {
    if (isVR) return;
    if (document.pointerLockElement !== cv) cv.requestPointerLock && cv.requestPointerLock();
    desk.dragging = true;
  });
  window.addEventListener('mouseup', () => desk.dragging = false);
  window.addEventListener('mousemove', (e) => {
    if (isVR || state !== 'PLAY') return;
    if (document.pointerLockElement === cv) {
      desk.yaw -= e.movementX * 0.0025;
      desk.pitch -= e.movementY * 0.0025;
    } else if (desk.dragging) {
      desk.yaw -= e.movementX * 0.0025;
      desk.pitch -= e.movementY * 0.0025;
    }
    desk.pitch = Math.max(-1.2, Math.min(1.2, desk.pitch));
  });
}

function desktopUpdate(dt) {
  // look
  camera.rotation.order = 'YXZ';
  camera.rotation.y = desk.yaw;
  camera.rotation.x = desk.pitch;
  camera.position.set(0, EYE, 0);
  // move
  let fwd = 0, str = 0;
  if (keys['w'] || keys['arrowup']) fwd += 1;
  if (keys['s'] || keys['arrowdown']) fwd -= 1;
  if (keys['a'] || keys['arrowleft']) str -= 1;
  if (keys['d'] || keys['arrowright']) str += 1;
  const sprint = keys['shift'] && player.stamina > 1;
  if (fwd || str) {
    const speed = sprint ? 6 : 3.4;
    const yaw = desk.yaw;
    const dx = -Math.sin(yaw) * fwd + Math.cos(yaw) * str;
    const dz = -Math.cos(yaw) * fwd - Math.sin(yaw) * str;
    const len = Math.hypot(dx, dz) || 1;
    const step = speed * dt / TILE_M;
    moveDolly((dx / len) * step, (dz / len) * step);
    if (sprint) player.stamina = Math.max(0, player.stamina - dt * 26);
  }
  if (!sprint) player.stamina = Math.min(100, player.stamina + dt * 14);
  player.moving = !!(fwd || str);
  player.sprinting = sprint && player.moving;
}

// ============================================================ actions (ported)
function toggleFlash() {
  if (!player.hasLight) return;
  if (player.battery <= 0) { player.lightOn = false; flashlight.visible = false; return; }
  player.lightOn = !player.lightOn;
  flashlight.visible = player.lightOn;
}
function startSpirit() {
  if (!player.inv.spiritbox) { showSubtitle('You need the spirit box (found in Records).', 2.5); return; }
  if (spiritActive) return;
  spiritActive = true; Audio2.spiritStart();
}
function stopSpirit() { if (spiritActive) { spiritActive = false; Audio2.spiritStop(); } }

function interact() {
  const t = tileAt(player.floor, player.x, player.y);
  if (t === TILE.UP) return changeFloor(1);
  if (t === TILE.DOWN) return changeFloor(-1);
  if (t === TILE.HIDE) { player.hidden = !player.hidden; showSubtitle(player.hidden ? 'You press into the dark and go still…' : 'You come out.', 2); return; }
  const it = data.items.find((i) => !i.taken && i.floor === player.floor &&
    Math.hypot(i.x + 0.5 - player.x, i.y + 0.5 - player.y) < 1.4);
  if (it) return pickupItem(it);
  if (t === TILE.EXIT) return tryExit();
  const obj = objectiveHere();
  if (obj && (obj.type === 'document' || obj.type === 'bell')) return completeObjective(obj);
  showSubtitle('Nothing here.', 1.2);
}

function pickupItem(it) {
  it.taken = true; Audio2.pickup();
  const mesh = itemMeshes.get(it.id);
  if (mesh) { floorGroup.remove(mesh); itemMeshes.delete(it.id); }
  switch (it.type) {
    case 'flashlight':
      player.hasLight = true; player.lightOn = true; flashlight.visible = true;
      showSubtitle('Flashlight. Grip to toggle. The dead see its beam.', 4.5); break;
    case 'battery':
      player.battery = Math.min(100, player.battery + 45); showSubtitle('Batteries. +45% light.', 2); break;
    case 'emf': player.inv.emf = true; showSubtitle('EMF reader — it ticks when the dead are near.', 3); break;
    case 'spiritbox': player.inv.spiritbox = true; showSubtitle('Spirit box. Hold the left grip to listen. They answer — and come.', 4.5); break;
    case 'candlekit': player.inv.candles = (player.inv.candles || 0) + 3; showSubtitle('Candles — their light steadies your heart.', 3); break;
    case 'key': player.keys[it.id] = true; showSubtitle('A key: ' + keyLabel(it.id), 3); break;
  }
}
function keyLabel(id) { return ({ key_mose: 'Room 3-East', key_incinerator: 'the Incinerator', key_roof: 'Roof Access' })[id] || id; }

function changeFloor(dir) {
  const nf = Math.max(0, Math.min(4, player.floor + dir));
  if (nf === player.floor) return;
  player.floor = nf;
  Audio2.creak();
  buildFloor(nf);
  const landX = Math.max(4, Math.min(World.W - 5, Math.round(player.x)));
  placeDollyAtTile(landX + 0.5, 15.5);
  player.hidden = false;
  const f = data.floors[nf];
  showSubtitle(f.name + ' — ' + f.subtitle, 3.4);
}

// ---- objectives (ported) ----
function objectiveHere() { return data.objectives.find((o) => !o.done && o.floor === player.floor && inRoom(o.floor, o.tag)); }
function inRoom(fi, tag) {
  const r = data.floors[fi].rooms.find((rr) => rr.tag === tag);
  if (!r) return false;
  return player.x >= r.x && player.x <= r.x + r.w && player.y >= r.y && player.y <= r.y + r.h;
}
function completeObjective(o) {
  if (o.requiresAll) {
    const others = data.objectives.filter((x) => x !== o);
    if (!others.every((x) => x.done)) { showSubtitle('Not yet. Three truths remain unspoken.', 3); return; }
  }
  o.done = true;
  playLore(o.lore, () => {
    if (o.id === 'roof') return win();
    showSubtitle('A truth spoken. The building shifts around you.', 3);
    if (o.id === 'basement') { showSubtitle('Something in the incinerator wakes.', 3.5); Audio2.stinger(true); const a = ents.find((e) => e.kind === 'ash'); if (a) a.awake(); }
    updateDesktopObjective();
  });
}
function tryExit() {
  if (data.objectives.every((o) => o.done)) win();
  else showSubtitle('The chain holds. The hospital won’t let you leave with its secrets unspoken.', 3.5);
}
function unlockedForObjective(o) {
  const r = data.floors[o.floor].rooms.find((rr) => rr.tag === o.tag);
  if (!r) return true;
  return data.floors[o.floor].grid[r.doorY][r.doorX] !== TILE.LOCKED;
}
function updateSpiritObjective(dt) {
  if (!spiritActive) { spiritHold = Math.max(0, spiritHold - dt); return; }
  const o = data.objectives.find((x) => !x.done && x.type === 'spiritbox' && x.floor === player.floor && inRoom(x.floor, x.tag));
  if (!o) { spiritHold = Math.max(0, spiritHold - dt * 0.5); return; }
  if (o.needsKey && !unlockedForObjective(o)) { showSubtitle('The door to ' + keyLabel(o.needsKey) + ' is still locked.', 2); return; }
  spiritHold += dt;
  if (Math.random() < dt * 2.4) Audio2.spiritWord();
  if (spiritHold > 4.5) { spiritHold = 0; stopSpirit(); completeObjective(o); }
}
function playLore(key, done) {
  const lines = (data.LORE[key] || []).slice();
  let i = 0;
  const step = () => {
    if (i >= lines.length) { if (done) done(); return; }
    showSubtitle(lines[i], 2.8); Audio2.whisper(0.8); i++;
    setTimeout(step, 2600);
  };
  step();
}

// ---- unlock locked doors you stand next to with the key ----
function tryUnlockAhead() {
  const g = data.floors[player.floor].grid;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const xx = Math.floor(player.x) + i, yy = Math.floor(player.y) + j;
    if (g[yy] && g[yy][xx] === TILE.LOCKED) {
      const room = data.floors[player.floor].rooms.find((r) => r.doorX === xx && r.doorY === yy);
      const keyId = room && KEY_FOR[room.tag];
      if (keyId && player.keys[keyId]) {
        g[yy][xx] = TILE.DOOR; Audio2.creak();
        const dm = doorMeshes.get(xx + ',' + yy);
        if (dm) { dm.material.color.setHex(0x3a2a1c); dm.material.emissive.setHex(0x000000); }
        showSubtitle('The lock gives. ' + (room ? room.name : '') + ' opens.', 2.5);
      }
    }
  }
}

// ============================================================ main loop
function render() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state === 'PLAY') update(dt);
  else if (state === 'MENU') { camera.position.set(0, EYE, 0); }
  spinItems(dt);
  renderer.render(scene, camera);
}

function spinItems(dt) {
  itemMeshes.forEach((g) => { if (g.userData.spin) { g.userData.spin.rotation.y += dt * 1.5; g.position.y = 1.1 + Math.sin(performance.now() / 400) * 0.08; } });
  candleLights.forEach((c) => { c.light.intensity = c.base * (0.75 + Math.random() * 0.35); });
}

function update(dt) {
  elapsed += dt; hour = elapsed * HOURS_PER_SEC;

  if (isVR) vrLocomotion(dt);
  else desktopUpdate(dt);
  playerTileFromCamera();

  // flashlight battery + aim
  if (player.lightOn && player.battery > 0) {
    player.battery = Math.max(0, player.battery - dt * 1.6);
    if (player.battery <= 0) { player.lightOn = false; flashlight.visible = false; showSubtitle('The flashlight dies. Darkness.', 2.5); }
    flashFlicker = player.battery < 20 ? (0.55 + Math.random() * 0.45) : 1;
    flashlight.intensity = 22 * flashFlicker;
  }
  // aim yaw (of the flashlight) in tile space for AI
  const beamObj = flashlight.parent || camera;
  beamObj.getWorldDirection(tmpV); // -Z of the object
  // flashlight points along its local -Z as a spotlight toward target; approximate with parent forward
  player.aim = Math.atan2(tmpV.z, tmpV.x); // world X/Z -> tile x/y angle

  tryUnlockAhead();

  // noise
  let noise = 0;
  if (player.moving) noise = player.sprinting ? 0.55 : 0.12;
  if (isVR && (readAxes(sources.left)[0] || readAxes(sources.left)[1])) noise = Math.max(noise, 0.14);
  if (spiritActive) noise = Math.max(noise, 0.85);
  if (player.hidden) noise = 0;

  updateFear(dt);

  // entities
  const ctx = {
    hour, noise,
    playerLit: isPlayerLit(),
    beamHits: (ex, ey) => beamHits(ex, ey),
    onCatch: (e) => { deathBy = catchLine(e); die(); },
  };
  let nearest = Infinity, hunting = false;
  ents.forEach((e) => {
    e.update(dt, data, player, ctx);
    if (e.floor === player.floor) {
      ensureEntityMesh(e);
      const rec = entityMeshes.get(e);
      rec.group.visible = true;
      rec.group.position.set(e.x * TILE_M, 0, e.y * TILE_M);
      // face the player
      rec.group.lookAt(camera.getWorldPosition(tmpV2).x, 0, camera.getWorldPosition(tmpV2).z);
      if (e.kind === 'ash' && rec.group.userData.ember) rec.group.userData.ember.intensity = 0.5 + Math.random();
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      nearest = Math.min(nearest, d);
      if (e.state === Entities.S.HUNT) hunting = true;
    } else if (entityMeshes.has(e)) {
      entityMeshes.get(e).group.visible = false;
    }
  });
  if (hunting && Math.random() < dt * 3) Audio2.chase(true);
  if (nearest < 5) player.fear = Math.min(100, player.fear + (5 - nearest) * dt * 2.4);
  if (player.inv.emf && nearest < 9 && Math.random() < dt * (2 + (5 - nearest / 9 * 5))) Audio2.emf(Math.max(1, Math.round(5 - nearest / 9 * 5)));

  updateSpiritObjective(dt);

  // ambient scares
  ambientEventTimer -= dt;
  if (ambientEventTimer <= 0) { ambientEventTimer = 5 + Math.random() * 9 - hour * 0.1; ambientEvent(); }
  if (scareCooldown > 0) scareCooldown -= dt;

  interactTarget = findInteract();

  Audio2.setFear(player.fear);
  Audio2.tickHeart(dt);

  // fog + fear visuals
  fog.density = 0.05 + (player.fear / 100) * 0.05 + (player.hidden ? 0.06 : 0);
  const redness = player.fear > 45 ? (player.fear - 45) / 55 : 0;
  scene.background.setRGB(0.012 + redness * 0.06, 0.012, 0.04);
  // vignette: comfort during movement + fear pulse
  let vig = 0;
  if (player.moving) vig = 0.35;
  vig = Math.max(vig, redness * 0.6);
  if (player.hidden) vig = Math.max(vig, 0.55);
  vignette.material.opacity += (vig - vignette.material.opacity) * Math.min(1, dt * 6);
  if (redness > 0) {
    vignette.material.color.setRGB(1, 0.2, 0.2);
    if (Math.sin(performance.now() / (300 - redness * 150)) > 0.6) vignette.material.opacity = Math.min(1, vignette.material.opacity + 0.15);
  } else vignette.material.color.setRGB(0, 0, 0);

  tickSubtitle(dt);
  hudTick -= dt;
  if (hudTick <= 0) { hudTick = 0.15; updateHUD(); }

  if (player.fear >= 100 && state === 'PLAY') { deathBy = deathBy || 'Your heart gave out.'; die(); }
}

function beamHits(ex, ey) {
  if (!player.lightOn || player.battery <= 0) return false;
  const dx = ex - player.x, dy = ey - player.y;
  const d = Math.hypot(dx, dy);
  if (d > LIGHT_RANGE) return false;
  const ang = Math.atan2(dy, dx);
  let da = Math.abs(normAng(ang - player.aim));
  if (da > CONE) return false;
  return Entities.lineOfSight(data.floors[player.floor].grid, player.x, player.y, ex, ey);
}
function isPlayerLit() {
  if (player.lightOn && player.battery > 0) return true;
  const g = data.floors[player.floor].grid;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const yy = Math.floor(player.y) + j, xx = Math.floor(player.x) + i;
    if (g[yy] && g[yy][xx] === TILE.CANDLE && Math.hypot(i, j) < 2.5) return true;
  }
  return false;
}
function nearCandle() {
  const g = data.floors[player.floor].grid;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const yy = Math.floor(player.y) + j, xx = Math.floor(player.x) + i;
    if (g[yy] && g[yy][xx] === TILE.CANDLE) return true;
  }
  return false;
}
function updateFear(dt) {
  const lit = isPlayerLit();
  const night = 0.5 + Math.min(1, hour / 12) * 0.9;
  if (!lit) player.fear = Math.min(100, player.fear + dt * (2.2 * night));
  else player.fear = Math.max(0, player.fear - dt * 3.2);
  if (player.hidden) player.fear = Math.min(100, player.fear + dt * 1.4);
  if (nearCandle()) player.fear = Math.max(0, player.fear - dt * 5);
}
function catchLine(e) {
  return ({
    nurse: 'The Grey Nurse reaches you. “You should have followed the rules.”',
    mose: 'Mose Blackburn’s shadow closes over you. He was never going to let you leave unheard.',
    child: 'The small cold hand finds yours and does not let go.',
    ash: 'The Ash folds around you. The fire finally has a name for you.',
  })[e.kind] || 'It takes you.';
}
function ambientEvent() {
  if (state !== 'PLAY') return;
  const roll = Math.random();
  if (roll < 0.4) Audio2.whisper(0.6 + hour / 24);
  else if (roll < 0.7) Audio2.creak();
  else if (roll < 0.85) { Audio2.footstep(0.05); Audio2.footstep(0.05); }
  else if (scareCooldown <= 0 && player.fear > 30) {
    Audio2.stinger(false); player.fear = Math.min(100, player.fear + 8); scareCooldown = 12;
    const lines = ['Something moved at the edge of the beam.', 'A door slams somewhere below.', 'Cold breath on the back of your neck.', 'Footsteps right behind you. Nothing there.'];
    showSubtitle(lines[Math.floor(Math.random() * lines.length)], 2.2);
  }
}
function findInteract() {
  const t = tileAt(player.floor, player.x, player.y);
  if (t === TILE.UP) return 'Trigger — climb the stairs up';
  if (t === TILE.DOWN) return 'Trigger — descend the stairs';
  if (t === TILE.HIDE) return player.hidden ? 'Trigger — leave hiding' : 'Trigger — hide here';
  if (t === TILE.EXIT) return 'Trigger — the chained front doors';
  const it = data.items.find((i) => !i.taken && i.floor === player.floor && Math.hypot(i.x + 0.5 - player.x, i.y + 0.5 - player.y) < 1.4);
  if (it) return 'Trigger — take the ' + itemName(it.type);
  const o = objectiveHere();
  if (o && o.type === 'document') return 'Trigger — read';
  if (o && o.type === 'bell') return 'Trigger — ring the dawn bell';
  if (o && o.type === 'spiritbox') return 'Hold left grip — spirit box';
  return null;
}
function itemName(t) { return ({ flashlight: 'flashlight', battery: 'batteries', emf: 'EMF reader', spiritbox: 'spirit box', candlekit: 'candles', key: 'key' })[t] || t; }

// ============================================================ HUD
function updateHUD() {
  const done = data.objectives.filter((o) => o.done).length;
  // desktop DOM HUD
  setBar('fear-fill', player.fear); setBar('battery-fill', player.battery); setBar('stamina-fill', player.stamina);
  setText('clock', fmtClock());
  setText('objective-count', `Truths: ${done}/${data.objectives.length}`);
  const inv = document.getElementById('inventory');
  if (inv) {
    const bits = [];
    if (player.hasLight) bits.push(player.lightOn ? '🔦 ON' : '🔦 off');
    if (player.inv.emf) bits.push('📶 EMF');
    if (player.inv.spiritbox) bits.push(spiritActive ? '📻 …' : '📻');
    Object.keys(player.keys).forEach(() => bits.push('🗝'));
    inv.textContent = bits.join('   ');
  }
  const prompt = document.getElementById('interact-prompt');
  if (prompt) { prompt.textContent = interactTarget || ''; prompt.style.opacity = interactTarget ? 1 : 0; }
  updateDesktopObjective();
  // in-VR wrist panel
  drawWrist(done);
}
function drawWrist(done) {
  if (!wristCtx) return;
  const c = wristCtx; c.clearRect(0, 0, 320, 200);
  c.fillStyle = 'rgba(6,6,10,0.85)'; c.fillRect(0, 0, 320, 200);
  c.fillStyle = '#cdd6de'; c.font = '26px Courier New'; c.textAlign = 'left';
  c.fillText(fmtClock(), 14, 34);
  c.textAlign = 'right'; c.fillStyle = '#9aa7b0'; c.fillText(`Truths ${done}/4`, 306, 34);
  // bars
  bar(c, 14, 52, 'FEAR', player.fear, '#e02a2a');
  bar(c, 14, 92, 'LIGHT', player.battery, '#8aff9e');
  bar(c, 14, 132, 'BODY', player.stamina, '#7ad0ff');
  c.fillStyle = '#c9a24a'; c.font = '18px Courier New'; c.textAlign = 'left';
  const next = data.objectives.find((o) => !o.done);
  c.fillText(next ? next.title.slice(0, 30) : 'Reach the front doors', 14, 184);
  wristTex.needsUpdate = true;
}
function bar(c, x, y, label, v, col) {
  c.fillStyle = '#8a95a0'; c.font = '16px Courier New'; c.textAlign = 'left';
  c.fillText(label, x, y + 14);
  c.strokeStyle = 'rgba(255,255,255,.2)'; c.strokeRect(x + 70, y, 220, 18);
  c.fillStyle = col; c.fillRect(x + 71, y + 1, 218 * Math.max(0, Math.min(1, v / 100)), 16);
}
function setBar(id, v) { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, v)) + '%'; }
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function updateDesktopObjective() {
  const el = document.getElementById('objective'); if (!el) return;
  const next = data.objectives.find((o) => !o.done);
  if (!next) { el.textContent = 'All truths spoken. Reach the front doors.'; return; }
  el.innerHTML = `<b>OBJECTIVE:</b> ${next.title}<br><span class="hint">${next.hint}</span>`;
}
function fmtClock() {
  const total = (18 + hour) % 24, h = Math.floor(total), m = Math.floor((total - h) * 60);
  const hh = ((h + 11) % 12) + 1, ap = h < 12 ? 'AM' : 'PM';
  return `${hh}:${m.toString().padStart(2, '0')} ${ap}`;
}

// subtitles (DOM for desktop; also appear on the big panel briefly for VR)
function showSubtitle(text, dur) { messages.push({ text, t: dur || 2.5 }); }
function tickSubtitle(dt) {
  const el = document.getElementById('subtitle');
  if (messages.length) {
    msgText = messages[0].text;
    if (el) { el.textContent = msgText; el.style.opacity = 1; }
    messages[0].t -= dt;
    if (messages[0].t <= 0) messages.shift();
  } else if (el) el.style.opacity = 0;
}

// ============================================================ state
function pause() {
  if (state !== 'PLAY') return;
  state = 'PAUSE'; stopSpirit(); Audio2.suspend();
  if (!isVR) document.getElementById('pausescreen').classList.add('show');
}
function resumeGame() {
  if (state !== 'PAUSE') return;
  document.getElementById('pausescreen').classList.remove('show');
  state = 'PLAY'; Audio2.resume(); clock.getDelta();
}
function die() {
  if (state === 'DEAD') return;
  state = 'DEAD'; stopSpirit(); Audio2.stinger(true);
  setTimeout(() => Audio2.suspend(), 1600);
  if (isVR) showBigPanel('YOU DIED', [deathBy].concat(data.LORE.ending_bad), '#e02a2a');
  else {
    setText('death-reason', deathBy);
    const dl = document.getElementById('death-lore'); if (dl) dl.innerHTML = data.LORE.ending_bad.map((l) => `<p>${l}</p>`).join('');
    document.getElementById('deathscreen').classList.add('show');
  }
}
function win() {
  if (state === 'WIN') return;
  state = 'WIN'; stopSpirit();
  if (isVR) showBigPanel('DAWN', data.LORE.ending_good, '#8affb0');
  else {
    const wl = document.getElementById('win-lore'); if (wl) wl.innerHTML = data.LORE.ending_good.map((l) => `<p>${l}</p>`).join('');
    document.getElementById('winscreen').classList.add('show');
  }
  setTimeout(() => Audio2.suspend(), 6000);
}
function restartFromPanel() { newGame(); }
function hideAllScreens() {
  ['startscreen', 'pausescreen', 'deathscreen', 'winscreen'].forEach((id) => { const el = document.getElementById(id); if (el) el.classList.remove('show'); });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function normAng(a) { while (a > Math.PI) a -= 6.28318; while (a < -Math.PI) a += 6.28318; return a; }

})();
