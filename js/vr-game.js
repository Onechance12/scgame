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
const KEY_FOR = { mose: 'key_mose', incinerator: 'key_incinerator', roof: 'key_roof', sanctum: 'key_sanctum' };
const TILE = World.TILE;

// ---- three core objects ----
let renderer, scene, camera, dolly, clock;
let flashlight, flashState = true;
let ambient, fog;
let floorGroup = null;          // geometry of the current floor
let TEX = {};                   // CC0 texture cache (Poly Haven)
let propSolids = [];            // furniture collision boxes (metres)
let flickers = [];              // flickering ceiling fixtures
let emberProp = null;           // the incinerator's glow (basement)
let surgeTimer = 14;            // power-surge scare countdown
let blackoutUntil = 0;         // ms timestamp fixtures are forced dark
let animatedProps = [];        // mobiles / rocking things
let nurseryActive = false;     // player currently inside a haunted nursery
let nurseryTimer = 0, nurseryMusicTimer = 3;
let peekers = [];              // children behind the walls, peeking through paintings
let peekSpawnTimer = 6;
let peekMats = null;
let realMode = false;          // 24-hour real-time survival vs one-night
let startEpoch = 0;            // Date.now() when the night began (wall clock)
let documents = [];            // findable story papers
let docMeshes = new Map();
let docPanelTimer = 0;
let ritual = null;             // ritual room state
let ritMats = null;
let childrenFreed = false;     // ritual outcome
let xrSupported = false;
let autosaveT = 8;
let wakeLock = null;
let moodLights = [];           // per-room coloured lights
let carter = null, carterTimer = 50;   // the chain-dragging apparition
let fallingDebris = [], debrisKept = [], dropCooldown = 25;
let morgueScared = false, sceneAnims = [];
const SAVE_KEY = 'collegehill_save';
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

  ambient = new THREE.AmbientLight(0x3a4652, 0.14);
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
  flashlight = new THREE.SpotLight(0xfff2d6, 30, LIGHT_RANGE * TILE_M, CONE, 0.5, 1.2);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024);
  flashlight.shadow.camera.near = 0.1;
  flashlight.shadow.camera.far = LIGHT_RANGE * TILE_M;
  flashlight.target.position.set(0, 0, -1);
  camera.add(flashlight);
  camera.add(flashlight.target);

  clock = new THREE.Clock();

  loadTextures();
  setupControllers();
  setupVignette();
  setupWristPanel();
  setupBigPanel();

  window.addEventListener('resize', onResize);
  bindDesktopInput();
  bindUI();
  checkXR();
  offerResume();

  document.addEventListener('visibilitychange', () => { saveState(); if (document.visibilityState === 'visible' && realMode) requestWake(); });
  window.addEventListener('beforeunload', saveState);

  renderer.setAnimationLoop(render);
}

// ---- persistence (so a 24-hour night survives the headset sleeping) ----
function saveState() {
  if (!data || !player || state === 'MENU') return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 2, realMode, startEpoch,
      floor: player.floor, x: player.x, y: player.y,
      fear: player.fear, battery: player.battery, hasLight: player.hasLight,
      inv: player.inv, keys: player.keys,
      itemsTaken: data.items.filter((i) => i.taken).map((i) => i.id),
      objectives: data.objectives.map((o) => o.done),
      docs: documents.filter((d) => d.found).map((d) => d.id),
      ritualLit: ritual ? ritual.nodes.filter((n) => n.lit).length : 0,
      ritualDone: !!(ritual && ritual.done),
      childrenFreed,
      survival: (typeof Survival !== 'undefined') ? Survival.serialize() : undefined,
      finished: state === 'WIN' || state === 'DEAD',
    }));
  } catch (e) { /* storage full / disabled */ }
}
function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }

function offerResume() {
  const s = loadSave();
  if (!s || s.finished) return;
  const btn = document.getElementById('btn-resume-save');
  if (!btn) return;
  const mins = Math.max(0, Math.floor((Date.now() - (s.startEpoch || Date.now())) / 60000));
  const dur = mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm';
  btn.textContent = '↺ RESUME — ' + (s.realMode ? '24-Hour' : 'One Night') + ', ' + dur + ' in';
  btn.style.display = 'block';
}

async function requestWake() {
  try { if (navigator.wakeLock && (!wakeLock || wakeLock.released)) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
}

function checkXR() {
  const note = document.getElementById('xr-note');
  const btnVR = document.getElementById('btn-vr');
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      xrSupported = ok;
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
  if (c === sources.left && !interactTarget) { Survival.drink(); return; }  // left trigger: drink
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
  c.font = "72px 'Creepster', cursive";
  c.fillText(title, 512, 130);
  c.fillStyle = '#b7c0c8';
  c.font = "30px 'IM Fell', serif";
  (lines || []).forEach((l, i) => c.fillText(l, 512, 210 + i * 46));
  c.fillStyle = '#8a95a0';
  c.font = "26px 'Special Elite', monospace";
  c.fillText('— pull the trigger to continue —', 512, 470);
  bigTex.needsUpdate = true;
}
function hideBigPanel() { bigPanel.visible = false; }

// ============================================================ new game
function bindUI() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('btn-vr', () => enterVR());
  on('btn-desktop', () => startDesktop());
  on('btn-resume', resumeGame);
  on('btn-restart', () => newGame());
  on('btn-restart-dead', () => newGame());
  on('btn-restart-win', () => newGame());
  on('mode-night', () => setMode(false));
  on('mode-24', () => setMode(true));
  on('btn-resume-save', () => {
    const s = loadSave(); if (!s) return;
    if (xrSupported) enterVR(s); else startDesktop(s);
  });
}
function setMode(v) {
  realMode = v;
  const n = document.getElementById('mode-night'), t = document.getElementById('mode-24');
  if (n) n.classList.toggle('selected', !v);
  if (t) t.classList.toggle('selected', v);
}

function enterVR(saved) {
  if (!navigator.xr) { startDesktop(saved); return; }
  Audio2.init(); Audio2.resume();
  const sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
  navigator.xr.requestSession('immersive-vr', sessionInit).then((session) => {
    isVR = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setSession(session);
    session.addEventListener('end', () => { isVR = false; });
    wristPanel.visible = true;
    document.getElementById('vr-crosshair').style.display = 'none';
    newGame(saved);
  }).catch((err) => {
    console.warn('VR session failed:', err);
    startDesktop(saved);
  });
}

function startDesktop(saved) {
  isVR = false;
  Audio2.init(); Audio2.resume();
  document.getElementById('vr-hud').classList.add('show');
  document.getElementById('vr-crosshair').style.display = 'block';
  document.getElementById('controls-hint').textContent =
    'WASD move · mouse look · F flashlight · E interact · Q spirit box · C drink · V medkit · Tab case file · Shift run · P pause';
  // desktop uses camera-mounted flashlight
  if (flashlight.parent !== camera) { flashlight.parent.remove(flashlight); flashlight.parent.remove(flashlight.target); camera.add(flashlight); camera.add(flashlight.target); flashlight.position.set(0.15, -0.05, 0); flashlight.target.position.set(0, 0, -1); }
  newGame(saved);
}

function newGame(saved) {
  hideAllScreens();
  hideBigPanel();
  data = World.build();
  ents = Entities.spawnAll(data);
  documents = data.documents || [];
  ritual = data.ritual ? { floor: data.ritual.floor, cx: data.ritual.cx, cy: data.ritual.cy, done: false,
    nodes: data.ritual.nodes.map((n) => ({ dx: n.dx, dy: n.dy, lit: false })) } : null;
  childrenFreed = false;
  Survival.init({
    player: () => player, ents: () => ents, data: () => data, docs: () => documents,
    subtitle: showSubtitle, audio: Audio2, powerSurge: () => powerSurge(), save: () => saveState(),
  });
  Survival.reset();
  const sp = World.spawn(data);
  player = {
    floor: sp.floor, x: sp.x + 0.5, y: sp.y + 0.5,
    aim: 0, fear: 12, stamina: 100, battery: 100,
    hasLight: false, lightOn: false, hidden: false, inv: {}, keys: {},
  };
  hour = 0; elapsed = 0; messages = []; spiritHold = 0; spiritActive = false;
  deathBy = ''; ambientEventTimer = 5; scareCooldown = 0; docPanelTimer = 0;
  nurseryActive = false; nurseryTimer = 0; nurseryMusicTimer = 3; surgeTimer = 20; blackoutUntil = 0;
  data.objectives.forEach((o) => (o.done = false));

  if (saved) restoreFrom(saved); else { startEpoch = Date.now(); }

  buildFloor(player.floor);
  placeDollyAtTile(player.x, player.y);
  flashState = true;
  flashlight.visible = !!(player.hasLight && player.lightOn);
  state = 'PLAY';
  Audio2.startAmbient();
  if (realMode) requestWake();
  if (saved) { showSubtitle('You come back to yourself where you left off. It never left.', 4); }
  else runIntro(0);
  saveState();
}

function restoreFrom(s) {
  realMode = !!s.realMode;
  setMode(realMode);
  startEpoch = s.startEpoch || Date.now();
  player.floor = s.floor; player.x = s.x; player.y = s.y;
  player.fear = s.fear || 12; player.battery = s.battery == null ? 100 : s.battery;
  player.hasLight = !!s.hasLight; player.lightOn = false;
  player.inv = s.inv || {}; player.keys = s.keys || {};
  (s.itemsTaken || []).forEach((id) => { const it = data.items.find((i) => i.id === id); if (it) it.taken = true; });
  (s.objectives || []).forEach((done, i) => { if (data.objectives[i]) data.objectives[i].done = done; });
  (s.docs || []).forEach((id) => { const d = documents.find((dd) => dd.id === id); if (d) d.found = true; });
  childrenFreed = !!s.childrenFreed;
  if (s.survival) Survival.restore(s.survival);
  if (ritual) {
    ritual.done = !!s.ritualDone;
    for (let i = 0; i < (s.ritualLit || 0) && i < ritual.nodes.length; i++) ritual.nodes[i].lit = true;
  }
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

// ============================================================ textures (CC0)
function loadTextures() {
  const L = new THREE.TextureLoader();
  const load = (file, rx, ry, srgb = true) => {
    const t = L.load('assets/textures/' + file, undefined, undefined,
      () => console.warn('texture missing:', file)); // fail-soft: keep flat colour
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    if (srgb && 'colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  TEX.wallD = load('wall_diff.jpg', 1, 1.2);
  TEX.wallN = load('wall_nor.jpg', 1, 1.2, false);
  TEX.wall2D = load('wall2_diff.jpg', 1, 1.2);
  TEX.wall2N = load('wall2_nor.jpg', 1, 1.2, false);
  TEX.floorD = load('floor_diff.jpg', World.W, World.H);
  TEX.floorN = load('floor_nor.jpg', World.W, World.H, false);
  TEX.ceilD = load('ceiling_diff.jpg', World.W / 2, World.H / 2);
  TEX.doorD = load('door_diff.jpg', 1, 1);
  // per-room floor skins (repeat set per-room via clone)
  TEX.rooms = {
    tile: load('floor_tiles_06_diff.jpg', 1, 1),
    bigtile: load('large_floor_tiles_02_diff.jpg', 1, 1),
    lino: load('old_linoleum_flooring_01_diff.jpg', 1, 1),
    wood: load('wood_floor_worn_diff.jpg', 1, 1),
    conc: load('worn_concrete_floor_diff.jpg', 1, 1),
    carpet: load('dirty_carpet_diff.jpg', 1, 1),
    mosaic: load('old_mosaic_floor_diff.jpg', 1, 1),
    metal: load('rusty_metal_04_diff.jpg', 1, 1),
  };
}

// which floor skin each room type wears
const ROOM_FLOOR = {
  lobby: 'mosaic', admitting: 'mosaic', waiting: 'carpet', cafeteria: 'carpet',
  er: 'tile', surgery: 'tile', prep: 'tile', xray: 'tile', autopsy: 'tile', pharmacy: 'tile', bath: 'tile',
  kitchen: 'bigtile', ward: 'lino', room207: 'lino', maternity: 'lino', quarters: 'lino', matron: 'lino',
  station: 'lino', records: 'lino', linen: 'lino', iso: 'lino', recovery: 'lino', mose: 'lino',
  chapel: 'wood', sanctum: 'wood', attic: 'wood', nursery: 'wood', bell: 'wood',
  morgue: 'conc', storage: 'conc', laundry: 'conc', ritual: 'conc', supply: 'conc', landing: 'conc',
  incinerator: 'metal', boiler: 'metal',
};

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
  doorMeshes.clear(); itemMeshes.clear(); docMeshes.clear(); candleLights = [];
  moodLights = []; carter = null; fallingDebris = []; debrisKept = []; sceneAnims = [];
  entityMeshes.forEach((v) => v.group && scene.remove(v.group));
  entityMeshes.clear();

  const g = data.floors[fi].grid;
  floorGroup = new THREE.Group();
  scene.add(floorGroup);

  const spanX = World.W * TILE_M, spanZ = World.H * TILE_M;

  // floor + ceiling (CC0 textures)
  const floorMat = new THREE.MeshStandardMaterial({ map: TEX.floorD, normalMap: TEX.floorN, color: 0x8f9299, roughness: .95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanZ), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(spanX / 2, 0, spanZ / 2);
  floor.receiveShadow = true;
  floorGroup.add(floor);

  const ceilMat = new THREE.MeshStandardMaterial({ map: TEX.ceilD, color: 0x6d7076, roughness: 1 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanZ), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(spanX / 2, WALL_H, spanZ / 2);
  floorGroup.add(ceil);

  // per-room floor skins — every room type wears its own floor
  data.floors[fi].rooms.forEach((r) => {
    const key = ROOM_FLOOR[r.tag];
    const tex = key && TEX.rooms && TEX.rooms[key];
    if (!tex) return;
    const t2 = tex.clone(); t2.needsUpdate = true;
    t2.repeat.set(Math.max(1, (r.w - 2) / 2.2), Math.max(1, (r.h - 2) / 2.2));
    const mat = new THREE.MeshStandardMaterial({ map: t2, color: 0x93969c, roughness: .95 });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry((r.w - 2) * TILE_M, (r.h - 2) * TILE_M), mat);
    pl.rotation.x = -Math.PI / 2;
    pl.position.set((r.x + r.w / 2) * TILE_M, 0.02, (r.y + r.h / 2) * TILE_M);
    pl.receiveShadow = true;
    floorGroup.add(pl);
  });

  // count walls -> instanced
  let wallCount = 0;
  for (let y = 0; y < World.H; y++) for (let x = 0; x < World.W; x++) if (g[y][x] === TILE.WALL) wallCount++;
  const wallGeo = new THREE.BoxGeometry(TILE_M, WALL_H, TILE_M);
  const wallMat = new THREE.MeshStandardMaterial({
    map: fi === 0 ? TEX.wall2D : TEX.wallD,
    normalMap: fi === 0 ? TEX.wall2N : TEX.wallN,
    color: 0xb7bac0, roughness: .95,
  });
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

  // furniture + fixtures (props.js)
  propSolids = []; flickers = []; emberProp = null;
  if (window.Props) {
    try {
      const p = Props.populate(fi, data, { TILE_M, WALL_H });
      floorGroup.add(p.group);
      propSolids = p.solids || [];
      flickers = p.fixtures || [];
      emberProp = p.ember || null;
      animatedProps = p.animated || [];
      moodLights = p.moods || [];
    } catch (e) { console.warn('props failed:', e); }
  }

  // children behind the walls
  try { buildPeekers(fi); } catch (e) { console.warn('peekers failed:', e); peekers = []; }

  // story documents on this floor
  documents.forEach((d) => { if (!d.found && d.floor === fi) addDocMesh(d); });

  // the ritual chamber (basement only)
  if (ritual && fi === ritual.floor) { try { buildRitual(); } catch (e) { console.warn('ritual failed:', e); } }

  // items on this floor
  data.items.forEach((it) => { if (!it.taken && it.floor === fi) addItemMesh(it); });

  // entities present on this floor get meshes
  ents.forEach((e) => { if (e.floor === fi) ensureEntityMesh(e); });
}

// ---- Case File / journal (desktop) ----
let journalOpen = false;
function toggleJournal() {
  const el = document.getElementById('journal');
  if (!el || !data) return;
  journalOpen = !journalOpen;
  if (!journalOpen) { el.classList.remove('show'); return; }
  const done = data.objectives.filter((o) => o.done).length;
  let html = '<div class="folder"><h2>CASE FILE — COLLEGE HILL</h2>';
  html += '<p class="sub">The Old Hospital on College Hill · Williamson, WV · 1928–1988</p>';
  html += '<h3>Truths (' + done + '/' + data.objectives.length + ')</h3><ul>';
  data.objectives.forEach((o) => { html += `<li class="${o.done ? 'done' : ''}">${o.done ? '✔' : '○'} <b>${o.title}</b> — <span class="hint">${o.hint}</span></li>`; });
  html += '</ul><h3>The Dead</h3><ul>';
  html += '<li><b>The Grey Nurse</b> (Ada Coyle) — died in the ER after a crash on her way to work. Still walks her rounds.</li>';
  html += '<li><b>Mose Blackburn</b> — 1962; went out a third-floor window. Swears he did not jump.</li>';
  html += '<li><b>The Children</b> — the basement ward; bound here by the night staff so the beds stayed full.</li>';
  html += '<li><b>The Ash</b> — what the incinerator kept, and what the ritual could set loose.</li>';
  html += '</ul><h3>Documents</h3>';
  const found = documents.filter((d) => d.found);
  if (!found.length) html += '<p class="hint">Nothing filed yet. Search the rooms — letters, patient files, newspaper clippings, a diary.</p>';
  else {
    html += `<p class="hint">${found.length} of ${documents.length} recovered.</p>`;
    found.forEach((d) => { html += `<div class="casedoc ${d.type}"><b>${d.title}</b><br><span class="hint">${d.body.join('<br>')}</span></div>`; });
  }
  el.innerHTML = html + '<p class="tip">TAB TO CLOSE THE FILE</p></div>';
  el.classList.add('show');
}

// ---- the children behind the walls ----
function makePeekMats() {
  peekMats = {
    frame: new THREE.MeshStandardMaterial({ color: 0x2a1e12, roughness: .9 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 1 }),
    eye: new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }),
  };
}

function makePeeker(m) {
  const wx = (m.x + 0.5) * TILE_M, wz = (m.y + 0.5) * TILE_M;
  const nx = m.nx, nz = m.nz;
  const off = TILE_M / 2 - 0.03;
  const px = wx + nx * off, pz = wz + nz * off;
  const yaw = Math.atan2(nx, nz);            // portrait faces into the room
  const grp = new THREE.Group();
  grp.position.set(px, 1.5, pz); grp.rotation.y = yaw;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.9, 0.04), peekMats.frame);
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.78), peekMats.canvas);
  canvas.position.z = 0.03;
  grp.add(frame); grp.add(canvas);
  const eyeGeo = new THREE.SphereGeometry(0.036, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, peekMats.eye.clone());
  const eyeR = new THREE.Mesh(eyeGeo, peekMats.eye.clone());
  eyeL.position.set(-0.09, 0.05, 0.05); eyeR.position.set(0.09, 0.05, 0.05);
  eyeL.visible = eyeR.visible = false;
  grp.add(eyeL); grp.add(eyeR);
  floorGroup.add(grp);
  return { grp, eyeL, eyeR, wx: px, wz: pz, tileX: m.x + nx + 0.5, tileY: m.y + nz + 0.5,
    state: 'hidden', t: 0, stepT: 0, laughed: false, cool: 2 + Math.random() * 4,
    fleeV: 0, fleePan: 0, fleeDir: 1 };
}

function buildPeekers(fi) {
  peekers = []; peekSpawnTimer = 5;
  if (!peekMats) makePeekMats();
  const g = data.floors[fi].grid;
  const cand = [];
  for (let y = 1; y < World.H - 1; y++) for (let x = 1; x < World.W - 1; x++) {
    if (g[y][x] !== TILE.WALL) continue;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const t = g[y + dy][x + dx];
      if (t === TILE.FLOOR || t === TILE.HIDE) { cand.push({ x, y, nx: dx, nz: dy }); break; }
    }
  }
  const want = Math.min(12, cand.length);
  const step = Math.max(1, Math.floor(cand.length / Math.max(1, want)));
  for (let i = 0; i < cand.length && peekers.length < want; i += step) peekers.push(makePeeker(cand[i]));
}

function startFlee(p, pan, vol, wasLit) {
  p.state = 'fleeing'; p.t = 1.1; p.laughed = false; p.stepT = 0;
  p.fleeV = Math.max(0.4, vol); p.fleePan = pan; p.fleeDir = pan >= 0 ? 1 : -1;
  p.eyeL.visible = p.eyeR.visible = false;
  if (wasLit) player.fear = Math.min(100, player.fear + 3);
  Audio2.footstepPan(pan, 0.1 * p.fleeV);
}

// manage watchers, reveal on flashlight, flee with running footsteps + laughter
function updatePeekers(dt) {
  if (!peekers.length) return;
  camera.getWorldPosition(tmpV); const pxp = tmpV.x, pzp = tmpV.z;
  camera.getWorldDirection(tmpV2); const fYaw = Math.atan2(tmpV2.x, tmpV2.z);
  let active = 0;
  for (const p of peekers) if (p.state !== 'hidden') active++;

  peekSpawnTimer -= dt;
  if (peekSpawnTimer <= 0) {
    peekSpawnTimer = 2.5 + Math.random() * 3.5;
    if (active < 2) {
      const pool = peekers.filter((p) => p.state === 'hidden' && p.cool <= 0 &&
        Math.hypot(p.wx - pxp, p.wz - pzp) / TILE_M < 9.5 && Math.hypot(p.wx - pxp, p.wz - pzp) / TILE_M > 2.2);
      const best = pool[Math.floor(Math.random() * pool.length)];
      if (best) { best.state = 'watching'; best.t = 3.5 + Math.random() * 3; best.stepT = 0.2; }
    }
  }

  for (const p of peekers) {
    if (p.state === 'hidden') { if (p.cool > 0) p.cool -= dt; continue; }
    p.t -= dt;
    const dx = p.wx - pxp, dz = p.wz - pzp;
    const d = Math.hypot(dx, dz) / TILE_M;
    const pan = Math.max(-1, Math.min(1, Math.sin(normAng(Math.atan2(dx, dz) - fYaw))));
    const vol = Math.max(0, 1 - d / 10);

    if (p.state === 'watching') {
      p.eyeL.visible = p.eyeR.visible = true;
      p.eyeL.material.color.setHex(0x260404); p.eyeR.material.color.setHex(0x260404); // faint, only just there
      p.stepT -= dt;
      if (p.stepT <= 0) { p.stepT = 0.45 + Math.random() * 0.6; Audio2.footstepPan(pan, 0.06 * vol); if (Math.random() < 0.22) Audio2.laughPan(pan, 0.03 * vol); }
      if (beamHits(p.tileX, p.tileY) && d < LIGHT_RANGE) {
        p.state = 'revealed'; p.t = 0.4; Audio2.stinger(false);
        player.fear = Math.min(100, player.fear + 7);
        showSubtitle('Eyes — watching you through a hole in the painting.', 2);
      } else if (p.t <= 0) { startFlee(p, pan, vol, false); }
      player.fear = Math.min(100, player.fear + dt * 0.5);
    } else if (p.state === 'revealed') {
      const glow = Math.sin(performance.now() / 40) > 0 ? 0xff3020 : 0xaa1010;
      p.eyeL.material.color.setHex(glow); p.eyeR.material.color.setHex(glow);
      if (p.t <= 0) startFlee(p, pan, vol, true);
    } else if (p.state === 'fleeing') {
      p.eyeL.visible = p.eyeR.visible = false;
      p.fleeV *= Math.pow(0.5, dt / 0.5);
      p.stepT -= dt;
      if (p.stepT <= 0) { p.stepT = 0.13; Audio2.footstepPan(p.fleePan, 0.1 * p.fleeV); p.fleePan = Math.max(-1, Math.min(1, p.fleePan + p.fleeDir * 0.08)); }
      if (!p.laughed && p.t < 0.5) { p.laughed = true; Audio2.laughPan(p.fleePan, 0.05); }
      if (p.t <= 0) { p.state = 'hidden'; p.cool = 4 + Math.random() * 5; }
    }
  }
}

// true if a world-space point (metres) lies inside any solid prop (+radius)
function solidBlocked(xm, zm) {
  const R = 0.32;
  for (let i = 0; i < propSolids.length; i++) {
    const s = propSolids[i];
    if (xm > s.x0 - R && xm < s.x1 + R && zm > s.z0 - R && zm < s.z1 + R) return true;
  }
  return false;
}

function addDoor(x, y, wx, wz, locked) {
  const mat = new THREE.MeshStandardMaterial({ map: TEX.doorD, color: locked ? 0x9a5050 : 0x9a8a76, roughness: .85, emissive: locked ? 0x300000 : 0x000000 });
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

const ITEM_COLORS = { flashlight: 0xffe08a, battery: 0x8affa0, emf: 0x7ad0ff, spiritbox: 0xc99cff, candlekit: 0xffb86b, key: 0xffd24a, draught: 0x9ae0c8, backpack: 0xb08a5a, medkit: 0xff8a8a, teddy: 0xd8a06a };
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

// ---- story documents ----
function addDocMesh(d) {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xd8d2b0, emissive: 0x4a3f18, emissiveIntensity: 0.6, side: THREE.DoubleSide, roughness: 1 }));
  paper.rotation.x = -Math.PI / 2.2;
  g.add(paper);
  const pl = new THREE.PointLight(0xffe4a0, 0.35, 2.5, 2); pl.position.y = 0.3; g.add(pl);
  g.position.set((d.x + 0.5) * TILE_M, 1.0, (d.y + 0.5) * TILE_M);
  g.userData.doc = true;
  floorGroup.add(g);
  docMeshes.set(d.id, g);
}

// ---- ritual chamber ----
function ritualMats() {
  if (ritMats) return ritMats;
  ritMats = {
    wax: new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: .9 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffcf7a, fog: false }),
    altar: new THREE.MeshStandardMaterial({ color: 0x1a1418, roughness: .8, emissive: 0x1a0004, emissiveIntensity: .4 }),
    sigil: new THREE.MeshBasicMaterial({ color: 0x5a0d0d, fog: false }),
  };
  return ritMats;
}
function buildRitual() {
  const m = ritualMats();
  ritual.altarTileX = ritual.cx + 0.5; ritual.altarTileY = ritual.cy + 0.5;
  // altar
  const altar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.85, 0.8), m.altar);
  altar.position.set(ritual.altarTileX * TILE_M, 0.42, ritual.altarTileY * TILE_M);
  floorGroup.add(altar);
  // a faint sigil ring on the floor
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.4 * TILE_M / 2.7, 1.55 * TILE_M / 2.7, 24), m.sigil);
  ring.rotation.x = -Math.PI / 2; ring.position.set(ritual.altarTileX * TILE_M, 0.03, ritual.altarTileY * TILE_M);
  floorGroup.add(ring);
  // candles
  ritual.nodes.forEach((n) => {
    const tx = ritual.cx + n.dx, ty = ritual.cy + n.dy;
    n.tileX = tx + 0.5; n.tileY = ty + 0.5;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.42, 8), m.wax));
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), m.flame);
    flame.position.y = 0.3; flame.visible = n.lit; g.add(flame);
    const light = new THREE.PointLight(0xffb060, n.lit ? 0.9 : 0, 3.2, 2); light.position.y = 0.45; g.add(light);
    g.position.set(n.tileX * TILE_M, 0.21, n.tileY * TILE_M);
    n.mesh = g; n.flame = flame; n.light = light;
    floorGroup.add(g);
  });
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
  else if (e.kind === 'crawler') { bodyColor = 0x14121a; headColor = 0x1a1620; emis = 0x0a0010; }

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
  if (e.kind === 'crawler') grp.scale.set(1.2, 0.42, 1.5); // low, long, wrong
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
  if (dxT !== 0 && passableFor(player.floor, nx + sx, player.y + r) && passableFor(player.floor, nx + sx, player.y - r) &&
      !solidBlocked((nx + sx) * TILE_M, player.y * TILE_M)) {
    dolly.position.x += dxT * TILE_M;
  }
  if (dyT !== 0 && passableFor(player.floor, player.x + r, ny + sy) && passableFor(player.floor, player.x - r, ny + sy) &&
      !solidBlocked(player.x * TILE_M, (ny + sy) * TILE_M)) {
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
    if (k === 'tab') { e.preventDefault(); toggleJournal(); }
    if (k === 'c' && state === 'PLAY') Survival.drink();
    if (k === 'v' && state === 'PLAY') Survival.useMedkit();
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
  const doc = documents.find((d) => !d.found && d.floor === player.floor &&
    Math.hypot(d.x + 0.5 - player.x, d.y + 0.5 - player.y) < 1.4);
  if (doc) return readDocument(doc);
  if (ritual && player.floor === ritual.floor && ritualInteract()) return;
  if (t === TILE.EXIT) return tryExit();
  const obj = objectiveHere();
  if (obj && (obj.type === 'document' || obj.type === 'bell')) return completeObjective(obj);
  if (Survival.tryInteract()) return;
  showSubtitle('Nothing here.', 1.2);
}

function pickupItem(it) {
  if (['draught', 'backpack', 'medkit', 'teddy'].includes(it.type)) {
    if (Survival.onPickup(it)) {
      it.taken = true;
      const m2 = itemMeshes.get(it.id);
      if (m2) { floorGroup.remove(m2); itemMeshes.delete(it.id); }
    }
    return;
  }
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

function readDocument(doc) {
  doc.found = true; Audio2.pickup();
  const m = docMeshes.get(doc.id); if (m) { floorGroup.remove(m); docMeshes.delete(doc.id); }
  if (isVR) showDocPanel(doc); else showDocDom(doc);
  showSubtitle('Added to Case File — ' + doc.title, 3.5);
  player.fear = Math.max(0, player.fear - 3);
  saveState();
}

// desktop: the document as an actual sheet of paper you hold up to the light
const DOC_TAGS = { clipping: 'PRESS CUTTING', letter: 'CORRESPONDENCE', file: 'PATIENT RECORD', report: 'POLICE EVIDENCE', diary: 'PRIVATE DIARY' };
function showDocDom(doc) {
  const el = document.getElementById('docview');
  if (!el) { showDocPanel(doc); return; }
  el.className = 'show ' + (doc.type || 'file');
  el.innerHTML = '<div class="paper"><span class="doctag">' + (DOC_TAGS[doc.type] || 'EVIDENCE') + '</span>' +
    '<h4>' + doc.title + '</h4>' +
    doc.body.map((l) => '<p>' + l + '</p>').join('') +
    '<div class="dochint">FILED TO CASE FILE · CLICK OR PRESS E TO PUT IT DOWN</div></div>';
  const close = () => { el.className = ''; el.innerHTML = ''; };
  el.onclick = close;
  el.dataset.open = '1';
  const onKey = (ev) => { if (['e', 'escape', 'tab'].includes(ev.key.toLowerCase())) { close(); window.removeEventListener('keydown', onKey, true); } };
  window.addEventListener('keydown', onKey, true);
}
function wrapDraw(c, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = ''; let yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) { c.fillText(line, x, yy); line = w; yy += lh; }
    else line = test;
  }
  if (line) c.fillText(line, x, yy);
  return yy + lh;
}
function showDocPanel(doc) {
  bigPanel.visible = true; docPanelTimer = 11;
  const c = bigCtx; c.clearRect(0, 0, 1024, 512);
  c.fillStyle = 'rgba(10,9,5,0.94)'; c.fillRect(0, 0, 1024, 512);
  c.strokeStyle = 'rgba(120,100,50,0.5)'; c.lineWidth = 3; c.strokeRect(40, 30, 944, 452);
  c.textAlign = 'center'; c.fillStyle = '#e8dfa0'; c.font = "40px 'Special Elite', monospace";
  c.fillText(doc.title, 512, 92);
  c.textAlign = 'left'; c.fillStyle = '#cbc4a2'; c.font = "26px 'Special Elite', monospace";
  let y = 150;
  doc.body.forEach((line) => { y = wrapDraw(c, line, 80, y, 860, 34) + 8; });
  c.textAlign = 'center'; c.fillStyle = '#7a746a'; c.font = "20px 'Special Elite', monospace";
  c.fillText('— saved to your Case File (open with Tab) —', 512, 462);
  bigTex.needsUpdate = true;
}

// returns true if a ritual candle/altar was interacted with
function ritualInteract() {
  const n = ritual.nodes.find((nn) => !nn.lit && Math.hypot(nn.tileX - player.x, nn.tileY - player.y) < 1.3);
  if (n) { lightRitualCandle(n); return true; }
  if (!ritual.done && Math.hypot(ritual.altarTileX - player.x, ritual.altarTileY - player.y) < 1.5) {
    if (!ritual.nodes.every((nn) => nn.lit)) { showSubtitle('Five candles must burn before the circle will open.', 3); return true; }
    if (!player.inv.spiritbox) { showSubtitle('The altar wants a voice. You need the spirit box.', 3); return true; }
    performRitual(); return true;
  }
  return false;
}
function lightRitualCandle(n) {
  n.lit = true; if (n.flame) n.flame.visible = true; if (n.light) n.light.intensity = 0.9;
  Audio2.pickup(); Audio2.whisper(0.5);
  const c = ritual.nodes.filter((x) => x.lit).length;
  showSubtitle('A candle catches. (' + c + '/5)  The air drops a degree.', 2.6);
  player.fear = Math.min(100, player.fear + 2);
  saveState();
}
function performRitual() {
  ritual.done = true; Audio2.stinger(true); player.fear = Math.min(100, player.fear + 15);
  playLore('ritual', () => {
    childrenFreed = true;
    const child = ents.find((e) => e.kind === 'child');
    if (child) { child.state = Entities.S.DORMANT; child.wakeHour = 999; }
    const ash = ents.find((e) => e.kind === 'ash'); if (ash) ash.awake();
    showSubtitle('The children go quiet. But the circle is open now — and it is not empty.', 4.5);
    saveState();
  });
}

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
        if (dm) { dm.material.color.setHex(0x9a8a76); dm.material.emissive.setHex(0x000000); }
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
  docMeshes.forEach((g) => { g.rotation.y += dt * 0.6; g.position.y = 1.0 + Math.sin(performance.now() / 500) * 0.06; });
  if (ritual && player && player.floor === ritual.floor) {
    ritual.nodes.forEach((n) => { if (n.lit && n.light) n.light.intensity = 0.9 * (0.7 + Math.random() * 0.4); });
  }
}

// flickering / dying fluorescent fixtures + the incinerator glow
function updateFixtures(dt) {
  const black = performance.now() < blackoutUntil;
  for (const f of flickers) {
    if (black) { f.tube.material.emissiveIntensity = 0.01; if (f.light) f.light.intensity = 0; continue; }
    f.nextFlick -= dt;
    if (f.dead) {
      if (f.nextFlick <= 0) {
        f.nextFlick = 2 + Math.random() * 5;
        if (Math.random() < 0.5) { f.tube.material.emissiveIntensity = 0.7; if (Math.random() < 0.5) Audio2.buzz(0.03); }
        else f.tube.material.emissiveIntensity = 0.02;
      }
      continue;
    }
    if (f.nextFlick <= 0) {
      f.nextFlick = 0.05 + Math.random() * 0.9;
      const flick = Math.random() < 0.22;
      f.on = !flick;
      f.tube.material.emissiveIntensity = f.on ? 0.9 : 0.06;
      if (f.light) f.light.intensity = f.on ? f.base : 0.05;
      if (flick && Math.random() < 0.4) Audio2.buzz(0.03);
    }
  }
  if (emberProp) emberProp.traverse((o) => { if (o.material && o.material.emissive && o.material.emissiveIntensity > 0.5) o.material.emissiveIntensity = 1.1 + Math.random() * 0.9; });
  for (const m of moodLights) {
    m.light.intensity = black ? 0 : m.base * (0.72 + Math.random() * 0.4);
  }
}

// ---- the Chain-Carter: a pale thing dragging a chained gurney, far off ----
function spawnCarter() {
  if (carter || !player) return;
  const midY = 15.5;
  const side = Math.random() < 0.5 ? -1 : 1;
  const cx = Math.max(5, Math.min(World.W - 5, player.x + side * (8 + Math.random() * 3)));
  if (Math.abs(cx - player.x) < 6) return;
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 1 });
  const pale = new THREE.MeshStandardMaterial({ color: 0x8a929c, emissive: 0x161c22, roughness: 1 });
  const grp = new THREE.Group();
  const fig = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.42, 1.7, 8), pale); fig.position.y = 0.85; grp.add(fig);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), pale); head.position.y = 1.85; grp.add(head);
  const cart = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.75, 1.9), dark); cart.position.set(0, 0.45, 1.6); grp.add(cart);
  const lump = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 1 })); lump.position.set(0, 0.9, 1.6); grp.add(lump);
  for (let i = 0; i < 4; i++) {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 5, 8), dark);
    link.position.set(0.22, 0.55 - i * 0.1, 0.55 + i * 0.22); grp.add(link);
  }
  grp.position.set(cx * TILE_M, 0, midY * TILE_M);
  grp.visible = false;                       // invisible until the beam finds it
  floorGroup.add(grp);
  carter = { grp, x: cx, y: midY, dir: -side, life: 22, revealed: false, revealT: 0, soundT: 0.2 };
}
function updateCarter(dt) {
  carterTimer -= dt;
  if (!carter) { if (carterTimer <= 0) { carterTimer = 70 + Math.random() * 60; spawnCarter(); } return; }
  const c = carter;
  c.life -= dt;
  c.x += c.dir * dt * 0.45;
  c.grp.position.x = c.x * TILE_M;
  const dx = c.x - player.x, dy = c.y - player.y;
  const d = Math.hypot(dx, dy);
  c.soundT -= dt;
  if (c.soundT <= 0 && d < 22) {
    c.soundT = 1.25 + Math.random() * 0.5;
    camera.getWorldDirection(tmpV2);
    const fYaw = Math.atan2(tmpV2.x, tmpV2.z);
    const pan = Math.max(-1, Math.min(1, Math.sin(normAng(Math.atan2(dx, dy) - fYaw))));
    Audio2.chains(pan, Math.max(0.15, 1 - d / 22));
  }
  if (!c.revealed && beamHits(c.x, c.y)) {
    c.revealed = true; c.revealT = 1.5; c.grp.visible = true;
    Audio2.stinger(false); Audio2.chains(0, 1);
    player.fear = Math.min(100, player.fear + 9);
    showSubtitle('Something pale is dragging a chained gurney down the hall. It stops. It looks at you.', 3.5);
  }
  if (c.revealed) {
    c.revealT -= dt;
    c.grp.rotation.y = Math.atan2(player.x - c.x, player.y - c.y);
    if (c.revealT <= 0) {
      floorGroup.remove(c.grp); carter = null;
      Audio2.chains(0, 0.5);
      setTimeout(() => Audio2.chains(0, 0.24), 650);
      setTimeout(() => Audio2.chains(0, 0.1), 1350);
      showSubtitle('Chains, running away into the dark. Then nothing.', 3);
      return;
    }
  }
  if (carter && (c.life <= 0 || d > 26)) { floorGroup.remove(c.grp); carter = null; }
}

// ---- falling ceiling panels / light fixtures ----
function dropScare() {
  camera.getWorldDirection(tmpV);
  const len = Math.hypot(tmpV.x, tmpV.z) || 1;
  const fx = player.x + (tmpV.x / len) * 3.5;
  const fy = player.y + (tmpV.z / len) * 3.5;
  if (!passableFor(player.floor, fx, fy)) return;
  const isLight = Math.random() < 0.4;
  const mesh = new THREE.Mesh(
    isLight ? new THREE.BoxGeometry(1.5, 0.1, 0.3) : new THREE.BoxGeometry(1.1, 0.07, 1.1),
    isLight ? new THREE.MeshStandardMaterial({ color: 0xd8dde2, emissive: 0x8aa0b8, emissiveIntensity: 0.9 })
            : new THREE.MeshStandardMaterial({ color: 0x57534c, roughness: 1 }));
  mesh.position.set(fx * TILE_M, WALL_H - 0.08, fy * TILE_M);
  floorGroup.add(mesh);
  fallingDebris.push({ mesh, vy: 0, isLight, spin: (Math.random() - 0.5) * 3 });
  if (isLight) Audio2.buzz(0.09);
}
function updateDrops(dt) {
  for (let i = fallingDebris.length - 1; i >= 0; i--) {
    const f = fallingDebris[i];
    f.vy += 9.8 * dt;
    f.mesh.position.y -= f.vy * dt;
    f.mesh.rotation.z += f.spin * dt; f.mesh.rotation.x += f.spin * 0.6 * dt;
    if (f.mesh.position.y <= 0.06) {
      f.mesh.position.y = 0.06;
      f.mesh.rotation.set((Math.random() - 0.5) * 0.2, f.mesh.rotation.y, (Math.random() - 0.5) * 0.4);
      Audio2.crash();
      if (f.isLight) { Audio2.buzz(0.1); f.mesh.material.emissiveIntensity = 0; }
      player.fear = Math.min(100, player.fear + 12);
      showSubtitle(f.isLight ? 'A light fixture tears loose and bursts on the tile in front of you.'
                             : 'A ceiling panel crashes down right in front of you.', 3);
      debrisKept.push(f.mesh);
      if (debrisKept.length > 6) { const old = debrisKept.shift(); floorGroup.remove(old); }
      fallingDebris.splice(i, 1);
    }
  }
}

// ---- the morgue set-piece: a drawer slides open, the body comes out ----
function morgueScare() {
  const r = data.floors[0].rooms.find((rr) => rr.tag === 'morgue');
  if (!r) { morgueScared = true; return; }
  morgueScared = true;
  const bx = r.x + 1.6, bz = r.cy - 1.2;
  const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.6),
    new THREE.MeshStandardMaterial({ color: 0xb7bcc4, metalness: .6, roughness: .4 }));
  drawer.position.set(bx * TILE_M, 0.6, bz * TILE_M);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.24, 1.5),
    new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 1 }));
  body.position.set(bx * TILE_M, 0.85, bz * TILE_M);
  floorGroup.add(drawer); floorGroup.add(body);
  Audio2.creak();
  let t = 0;
  sceneAnims.push((dt) => {
    t += dt;
    if (t < 1.2) {                              // the drawer rolls out on its own
      drawer.position.z = (bz + t * 0.9) * TILE_M;
      body.position.z = drawer.position.z;
      if (t + dt >= 1.2) Audio2.drag();
      return true;
    }
    if (t < 2.2) {                              // the body tips off the tray
      const k = (t - 1.2);
      body.position.y = 0.85 - k * 0.7;
      body.rotation.x = k * 1.2;
      if (t + dt >= 2.2) {
        Audio2.thud(); Audio2.stinger(true);
        player.fear = Math.min(100, player.fear + 16);
        showSubtitle('A drawer was not latched. The body inside it is on the floor now — pointed at you.', 4.5);
      }
      return true;
    }
    if (t < 3.6) {                              // it rolls. bodies should not roll.
      const k = 1 - (t - 2.2) / 1.4;
      body.position.y = 0.14;
      body.rotation.x += dt * 4 * k;
      body.position.x += dt * 0.5 * k;
      return true;
    }
    return false;                               // it stays where it stopped
  });
}
function updateSceneAnims(dt) {
  for (let i = sceneAnims.length - 1; i >= 0; i--) if (!sceneAnims[i](dt)) sceneAnims.splice(i, 1);
}

function powerSurge() {
  blackoutUntil = performance.now() + 1400;
  Audio2.slam(); Audio2.stinger(true);
  player.fear = Math.min(100, player.fear + 12);
  showSubtitle('The power dies. Everything goes black.', 2.4);
}

// mobiles spin, cribs & rocking horses rock — harder when the nursery is awake
function animateProps(dt) {
  const boost = nurseryActive ? 1 : 0.28;
  for (const a of animatedProps) {
    if (a.kind === 'spin') a.obj.rotation.y += dt * (0.35 + boost * 0.9);
    else if (a.kind === 'rock') { a.phase += dt * (0.8 + boost * 2.0); a.obj.rotation.z = Math.sin(a.phase) * (0.025 + boost * 0.11); }
  }
}

// The haunted nursery: step inside and the children notice you.
function nurseryUpdate(dt) {
  const inN = inRoom(player.floor, 'nursery') || inRoom(player.floor, 'maternity');
  const wasActive = nurseryActive;
  nurseryActive = inN && !childrenFreed;
  if (!inN) { nurseryTimer = 0; return; }
  if (childrenFreed) { // the ritual set them free — the room is only sad now
    nurseryTimer -= dt;
    if (nurseryTimer <= 0) { nurseryTimer = 6 + Math.random() * 6; if (Math.random() < 0.5) Audio2.laugh(); }
    return;
  }
  if (!wasActive) { showSubtitle('The mobile begins to turn. Something in here is awake.', 3); nurseryMusicTimer = 1.2; Audio2.rattle(); }
  player.fear = Math.min(100, player.fear + dt * 1.7);   // cold dread
  const child = ents.find((e) => e.kind === 'child');
  if (child && child.awake) child.awake();               // draw the Child to you
  // the music box winds up on its own
  nurseryMusicTimer -= dt;
  if (nurseryMusicTimer <= 0) { nurseryMusicTimer = 9 + Math.random() * 6; Audio2.musicBox(0.85 + Math.random() * 0.25); }
  // periodic child sounds + peek scares
  nurseryTimer -= dt;
  if (nurseryTimer <= 0) {
    nurseryTimer = 2.4 + Math.random() * 3;
    const r = Math.random();
    if (r < 0.28) Audio2.babyCry();
    else if (r < 0.55) Audio2.laugh();
    else if (r < 0.78) Audio2.humming();
    else Audio2.rattle();
    if (Math.random() < 0.28) {
      Audio2.whisper(1); player.fear = Math.min(100, player.fear + 5);
      const lines = ['A crib is rocking on its own.', 'Small footsteps circle you in the dark.', '“Will you stay and play with me?”', 'Something small is breathing under a crib.', 'A ball rolls slowly across the floor toward you.'];
      showSubtitle(lines[Math.floor(Math.random() * lines.length)], 2.6);
    }
  }
}

function update(dt) {
  // time is driven by the real wall clock (so a 24h night survives sleeps/reloads)
  elapsed = (Date.now() - startEpoch) / 1000;
  hour = realMode ? Math.min(24, elapsed / 3600) : elapsed * (24 / GAME_SECONDS);

  autosaveT -= dt;
  if (autosaveT <= 0) { autosaveT = 10; saveState(); }
  if (docPanelTimer > 0) { docPanelTimer -= dt; if (docPanelTimer <= 0) hideBigPanel(); }

  if (isVR) vrLocomotion(dt);
  else desktopUpdate(dt);
  playerTileFromCamera();

  // flashlight battery + aim
  if (player.lightOn && player.battery > 0) {
    player.battery = Math.max(0, player.battery - dt * (realMode ? 0.05 : 1.6));
    if (player.battery <= 0) { player.lightOn = false; flashlight.visible = false; showSubtitle('The flashlight dies. Darkness.', 2.5); }
    flashFlicker = player.battery < 20 ? (0.55 + Math.random() * 0.45) : 1;
    flashlight.intensity = 30 * flashFlicker;
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
    peace: Survival.peaceActive(),
    beamHits: (ex, ey) => beamHits(ex, ey),
    onCatch: (e) => { deathBy = catchLine(e); die(); },
  };
  let nearest = Infinity, hunting = false;
  const eDt = dt * Survival.entityTimeScale();
  ents.forEach((e) => {
    e.update(eDt, data, player, ctx);
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

  // flickering fixtures + animated toys + the haunted nursery + wall children
  updateFixtures(dt);
  animateProps(dt);
  nurseryUpdate(dt);
  updatePeekers(dt);
  Survival.update(dt, hour, realMode);
  if (player.fear >= 96) Survival.useMedkit();   // last-second mercy, if you carry one

  // scripted horrors
  updateCarter(dt);
  updateDrops(dt);
  updateSceneAnims(dt);
  if (dropCooldown > 0) dropCooldown -= dt;
  if (!morgueScared && player.floor === 0 && inRoom(0, 'morgue')) morgueScare();

  // power-surge blackout scare (more frequent as the night deepens)
  surgeTimer -= dt;
  if (surgeTimer <= 0) {
    surgeTimer = 45 + Math.random() * 40 - hour * 1.2;
    if (hour > 2 && Math.random() < 0.6) powerSurge();
  }

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
  if (realMode && hour >= 24 && state === 'PLAY') win();   // survived the full 24 hours
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
  const rise = realMode ? 0.7 : 2.2;                  // gentler baseline over a real night
  if (!lit) player.fear = Math.min(100, player.fear + dt * (rise * night));
  else player.fear = Math.max(0, player.fear - dt * (realMode ? 4.2 : 3.2));
  if (player.hidden) player.fear = Math.min(100, player.fear + dt * 1.4);
  if (nearCandle()) player.fear = Math.max(0, player.fear - dt * 5);
}
function catchLine(e) {
  return ({
    nurse: 'The Grey Nurse reaches you. “You should have followed the rules.”',
    mose: 'Mose Blackburn’s shadow closes over you. He was never going to let you leave unheard.',
    child: 'The small cold hand finds yours and does not let go.',
    ash: 'The Ash folds around you. The fire finally has a name for you.',
    crawler: 'The Crawler is on you before you can turn — it was always faster than it looked.',
  })[e.kind] || 'It takes you.';
}
function ambientEvent() {
  if (state !== 'PLAY') return;
  if (dropCooldown <= 0 && hour > 1 && Math.random() < 0.22) { dropCooldown = 75; dropScare(); return; }
  const roll = Math.random();
  // floor-flavoured sounds
  if (player.floor === 0 && Math.random() < 0.45) {
    const c = Math.random();
    if (c < 0.3) Audio2.drip(); else if (c < 0.55) Audio2.laugh();
    else if (c < 0.75) Audio2.babyCry(2); else if (c < 0.9) Audio2.humming(); else Audio2.musicBox(0.8);
    return;
  }
  if (player.floor === 1 && Math.random() < 0.3) { Audio2.drag(); return; }
  if (roll < 0.30) Audio2.whisper(0.6 + hour / 24);
  else if (roll < 0.50) Audio2.creak();
  else if (roll < 0.62) { Audio2.footstep(0.05); Audio2.footstep(0.05); }
  else if (roll < 0.72) Audio2.drip();
  else if (roll < 0.82) Audio2.drag();
  else if (roll < 0.90 && hour > 3) Audio2.scream(2);
  else if (scareCooldown <= 0 && player.fear > 30) {
    Audio2.stinger(false); player.fear = Math.min(100, player.fear + 8); scareCooldown = 12;
    const lines = ['Something moved at the edge of the beam.', 'A gurney rolls in the dark down the hall.', 'Cold breath on the back of your neck.', 'Footsteps right behind you. Nothing there.', 'A child is laughing two rooms over.'];
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
  const doc = documents.find((d) => !d.found && d.floor === player.floor && Math.hypot(d.x + 0.5 - player.x, d.y + 0.5 - player.y) < 1.4);
  if (doc) return 'Trigger — read the ' + doc.type + ' (' + doc.title + ')';
  if (ritual && player.floor === ritual.floor) {
    const n = ritual.nodes.find((nn) => !nn.lit && Math.hypot(nn.tileX - player.x, nn.tileY - player.y) < 1.3);
    if (n) return 'Trigger — light the ritual candle';
    if (!ritual.done && Math.hypot(ritual.altarTileX - player.x, ritual.altarTileY - player.y) < 1.5) return 'Trigger — the altar' + (ritual.nodes.every((nn) => nn.lit) ? ' (speak into the spirit box)' : ' (light all five candles first)');
  }
  const o = objectiveHere();
  if (o && o.type === 'document') return 'Trigger — read';
  if (o && o.type === 'bell') return 'Trigger — ring the dawn bell';
  if (o && o.type === 'spiritbox') return 'Hold left grip — spirit box';
  const sp = Survival.interactPrompt();
  if (sp) return sp;
  return null;
}
function itemName(t) { return ({ flashlight: 'flashlight', battery: 'batteries', emf: 'EMF reader', spiritbox: 'spirit box', candlekit: 'candles', key: 'key', draught: 'Quiet Draught', backpack: 'backpack', medkit: 'medkit', teddy: 'teddy bear' })[t] || t; }

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
    const st = Survival.hudText(); if (st) bits.push(st);
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
  c.fillStyle = '#cdd6de'; c.font = "26px 'Special Elite', monospace"; c.textAlign = 'left';
  c.fillText(fmtClock(), 14, 34);
  c.textAlign = 'right'; c.fillStyle = '#9aa7b0'; c.fillText(`Truths ${done}/4`, 306, 34);
  // bars
  bar(c, 14, 52, 'FEAR', player.fear, '#e02a2a');
  bar(c, 14, 92, 'LIGHT', player.battery, '#8aff9e');
  bar(c, 14, 132, 'BODY', player.stamina, '#7ad0ff');
  c.fillStyle = '#c9a24a'; c.font = "18px 'Special Elite', monospace"; c.textAlign = 'left';
  const next = data.objectives.find((o) => !o.done);
  c.fillText(next ? next.title.slice(0, 30) : 'Reach the front doors', 14, 184);
  wristTex.needsUpdate = true;
}
function bar(c, x, y, label, v, col) {
  c.fillStyle = '#8a95a0'; c.font = "16px 'Special Elite', monospace"; c.textAlign = 'left';
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
  state = 'DEAD'; stopSpirit(); Audio2.stinger(true); clearSave();
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
  state = 'WIN'; stopSpirit(); clearSave();
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
