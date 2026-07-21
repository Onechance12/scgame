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

/* ES module. Classic scripts (audio/world/entities/props/survival) load first
 * and set window globals; we hand them THREE via window for props.js. */
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as skeletonClone } from './utils/SkeletonUtils.js';
window.THREE = THREE;
(() => {

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
let spiritsFreed = false;      // the Unbinding Rite completed (true ending)
let riteClimax = false;        // during the unbind sequence — the house can't take you now
let xrSupported = false;
let autosaveT = 8;
let wakeLock = null;
let moodLights = [];           // per-room coloured lights
let heroReady = Promise.resolve();
let dust = null, dustBase = null;
let stepT = 0, lastTileType = -1, lowBatWarned = false;
// player options (persisted): swapHands = move on right stick; walkLook = hold A/X to glide; bright = dim-lights mode
const OPTS = Object.assign({ swapHands: false, walkLook: true, bright: true, haunt: 'restless' },
  (() => { try { return JSON.parse(localStorage.getItem('collegehill_opts')) || {}; } catch (e) { return {}; } })());
// difficulty ("Haunt level"): scales the dead's speed, senses, and numbers
const HAUNT = {
  faint: { speedMul: 0.82, senseMul: 0.78, extra: false, label: 'FAINT' },
  restless: { speedMul: 1.0, senseMul: 1.0, extra: false, label: 'RESTLESS' },
  infested: { speedMul: 1.2, senseMul: 1.22, extra: true, label: 'INFESTED' },
};
const HAUNT_ORDER = ['faint', 'restless', 'infested'];
function saveOpts() { try { localStorage.setItem('collegehill_opts', JSON.stringify(OPTS)); } catch (e) { } }
let hemi = null, lanternLight = null, stickBtnWas = false;
function lightMul() { return OPTS.bright ? 1.9 : 1; }   // "dim lights" vs pitch-dark hardcore
function applyBrightness() {
  if (ambient) ambient.intensity = OPTS.bright ? 0.26 : 0.10;
  if (hemi) hemi.intensity = OPTS.bright ? 0.4 : 0.22;
  if (renderer) renderer.toneMappingExposure = OPTS.bright ? 1.35 : 1.2;
}
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
let graceUntil = 0;            // seconds of elapsed play during which the dead stay dormant
let onboardStep = -1, onboardT = 0;   // opening tutorial sequence
let wisp = null;              // the guiding spirit-light that drifts toward your objective
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
  // Quest: no shadow maps (mobile GPU killer); filmic tone for the horror look
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.xr.enabled = true;
  if (renderer.xr.setFoveation) renderer.xr.setFoveation(1);  // aggressive foveated rendering
  app.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03030a);
  fog = new THREE.FogExp2(0x03030a, 0.055);
  scene.fog = fog;

  ambient = new THREE.AmbientLight(0x3a4652, 0.10);
  scene.add(ambient);
  // hemisphere gives cheap depth (cool from above, rot from below)
  hemi = new THREE.HemisphereLight(0x2c3a4c, 0x0c0906, 0.22);
  scene.add(hemi);
  applyBrightness();
  const moon = new THREE.DirectionalLight(0x25406a, 0.08);
  moon.position.set(6, 20, 4);
  scene.add(moon);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 120);
  dolly = new THREE.Group();          // locomotion rig: holds camera + controllers
  dolly.add(camera);
  scene.add(dolly);
  camera.position.set(0, EYE, 0);

  // Flashlight — parented to the right hand in VR, to the camera on desktop.
  flashlight = new THREE.SpotLight(0xfff2d6, 30, LIGHT_RANGE * TILE_M, CONE, 0.5, 1.2);
  flashlight.castShadow = false;   // no shadow maps on Quest
  flashlight.target.position.set(0, 0, -1);
  camera.add(flashlight);
  camera.add(flashlight.target);

  clock = new THREE.Clock();

  loadTextures();
  heroReady = loadHeroModels();      // real furniture, preloads during the menu
  flashlight.map = makeBeamCookie(); // textured beam — dappled, real
  makeDust();
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
      inv: player.inv, keys: player.keys, rite: player.rite,
      itemsTaken: data.items.filter((i) => i.taken).map((i) => i.id),
      objectives: data.objectives.map((o) => o.done),
      docs: documents.filter((d) => d.found).map((d) => d.id),
      ritualFilled: ritual ? ritual.nodes.filter((n) => n.filled).map((n) => n.anchor) : [],
      ritualDone: !!(ritual && ritual.done),
      childrenFreed, spiritsFreed,
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

function skipCine() {
  // don't let an accidental early trigger (finger on the button as the session
  // starts) nuke the whole walk-up — only allow a skip after a couple of seconds
  if (cine && cine.t < 3) { cine.skipHinted = true; return; }
  endCinematic();
}
function onTrigger(c) {
  if (state === 'CINE') { skipCine(); return; }   // skip the approach (after it's begun)
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
  const optBtn = (id, key, label) => {
    const el = document.getElementById(id); if (!el) return;
    const paint = () => { el.textContent = label(OPTS); el.classList.toggle('selected', !!OPTS[key]); };
    el.onclick = () => { OPTS[key] = !OPTS[key]; saveOpts(); applyBrightness(); paint(); };
    paint();
  };
  const hb = document.getElementById('opt-haunt');
  if (hb) {
    const paintH = () => { hb.textContent = '💀 Haunt: ' + HAUNT[OPTS.haunt].label; hb.classList.toggle('selected', OPTS.haunt !== 'restless'); };
    hb.onclick = () => { const i = HAUNT_ORDER.indexOf(OPTS.haunt); OPTS.haunt = HAUNT_ORDER[(i + 1) % 3]; saveOpts(); paintH(); };
    paintH();
  }
  optBtn('opt-bright', 'bright', (o) => '💡 Lights: ' + (o.bright ? 'DIM' : 'PITCH-DARK'));
  optBtn('opt-swap', 'swapHands', (o) => '🕹 Move stick: ' + (o.swapHands ? 'RIGHT' : 'LEFT'));
  optBtn('opt-walklook', 'walkLook', (o) => '👣 Hold A/X to walk: ' + (o.walkLook ? 'ON' : 'OFF'));
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
    heroReady.then(() => newGame(saved));
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
  heroReady.then(() => newGame(saved));
}

function newGame(saved) {
  hideAllScreens();
  hideBigPanel();
  data = World.build();
  ents = Entities.spawnAll(data, { extra: (HAUNT[OPTS.haunt] || HAUNT.restless).extra });
  documents = data.documents || [];
  ritual = data.ritual ? { floor: data.ritual.floor, cx: data.ritual.cx, cy: data.ritual.cy, done: false,
    nodes: data.ritual.nodes.map((n) => ({ dx: n.dx, dy: n.dy, anchor: n.anchor, name: n.name, filled: false })) } : null;
  childrenFreed = false; spiritsFreed = false;
  Survival.init({
    player: () => player, ents: () => ents, data: () => data, docs: () => documents,
    subtitle: showSubtitle, audio: Audio2, powerSurge: () => powerSurge(), save: () => saveState(),
  });
  Survival.reset();
  const sp = World.spawn(data);
  player = {
    floor: sp.floor, x: sp.x + 0.5, y: sp.y + 0.5,
    aim: 0, fear: 8, stamina: 100, battery: 100,
    // you START with the flashlight in your hand and lit — no fumbling in the dark
    hasLight: true, lightOn: true, hidden: false, inv: {}, keys: {}, rite: {},
  };
  // A settling-in grace: for the first ~100s of a fresh night the dead stay in
  // their dens and won't hunt, fear can't kill, and the game teaches you.
  graceUntil = saved ? 0 : 100;
  onboardStep = saved ? -1 : 0; onboardT = saved ? 0 : 3;
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
  if (saved) { showSubtitle('You come back to yourself where you left off. It never left.', 4); saveState(); }
  else startCinematic();   // the walk up College Hill
}

function restoreFrom(s) {
  realMode = !!s.realMode;
  setMode(realMode);
  startEpoch = s.startEpoch || Date.now();
  player.floor = s.floor; player.x = s.x; player.y = s.y;
  player.fear = s.fear || 12; player.battery = s.battery == null ? 100 : s.battery;
  player.hasLight = !!s.hasLight; player.lightOn = false;
  player.inv = s.inv || {}; player.keys = s.keys || {}; player.rite = s.rite || {};
  (s.itemsTaken || []).forEach((id) => { const it = data.items.find((i) => i.id === id); if (it) it.taken = true; });
  (s.objectives || []).forEach((done, i) => { if (data.objectives[i]) data.objectives[i].done = done; });
  (s.docs || []).forEach((id) => { const d = documents.find((dd) => dd.id === id); if (d) d.found = true; });
  childrenFreed = !!s.childrenFreed; spiritsFreed = !!s.spiritsFreed;
  // stairwell-key compatibility: a save from before the lockdown update (or any
  // save made past a stairwell) must never strand the player — grant the keys
  // for every floor between the start floor and wherever they already are.
  if (player.floor !== 1) {
    const lo = Math.min(1, player.floor), hi = Math.max(1, player.floor);
    for (let f = lo; f <= hi; f++) { const k = STAIR_KEYS[f]; if (k) player.keys[k] = true; }
  }
  if (s.survival) Survival.restore(s.survival);
  if (ritual) {
    ritual.done = !!s.ritualDone;
    const filled = s.ritualFilled || [];
    ritual.nodes.forEach((n) => { if (filled.includes(n.anchor)) n.filled = true; });
  }
}

// ============================================================ the approach
// A first-person cinematic: you walk up College Hill through the mist toward
// the dark hospital, wind gusting, one window flickering. Trigger/Enter skips.
let cine = null;
function buildExterior() {
  const g = new THREE.Group();
  const lobbyR = data.floors[1].rooms.find((r) => r.tag === 'lobby');
  const doorX = (lobbyR ? lobbyR.cx + 0.5 : 12) * TILE_M;
  // ground
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ color: 0x131510, roughness: 1 }));
  gnd.rotation.x = -Math.PI / 2; gnd.position.set(doorX, -0.02, -40); g.add(gnd);
  // facade
  const wallM = new THREE.MeshStandardMaterial({ map: TEX.wallD, color: 0x7a7d84, roughness: .95 });
  const fac = new THREE.Mesh(new THREE.BoxGeometry(46, 15, 2), wallM);
  fac.position.set(doorX, 7.5, -1); g.add(fac);
  // window grid — dead panes, one alive and flickering
  const winM = new THREE.MeshStandardMaterial({ color: 0x05070c, emissive: 0x0a1524, emissiveIntensity: .5 });
  let flickWin = null;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2), (r === 2 && c === 6) ? winM.clone() : winM);
    w.position.set(doorX - 20 + c * 5, 3.4 + r * 3.4, 0.02);
    if (r === 2 && c === 6) { flickWin = w; w.material.emissive.setHex(0x8a5a1a); }
    g.add(w);
  }
  // door + steps
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 0.3),
    new THREE.MeshStandardMaterial({ map: TEX.doorD, color: 0x6a5a46, roughness: .9 }));
  door.position.set(doorX, 1.7, 0.1); g.add(door);
  const steps = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 3),
    new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 1 }));
  steps.position.set(doorX, 0.25, 1.6); g.add(steps);
  // mist
  const N = 260, mp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { mp[i * 3] = doorX + (Math.random() - 0.5) * 70; mp[i * 3 + 1] = Math.random() * 2.2; mp[i * 3 + 2] = -Math.random() * 55; }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const mist = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0x8a93a0, size: 0.9, transparent: true, opacity: 0.10, depthWrite: false }));
  mist.frustumCulled = false; g.add(mist);
  scene.add(g);
  return { g, doorX, flickWin, mist, t: 0, gustT: 1.5, cardI: 0 };
}
const CINE_CARDS = [
  [2, 'COLLEGE HILL', ['Williamson, West Virginia']],
  [9, '1928 — 1988', ['Four floors. A basement below them.', 'Never emptied.']],
  [17, 'THEY KNOW YOU ARE COMING', ['The chain on the doors will hold until dawn.']],
];
function startCinematic() {
  cine = buildExterior();
  state = 'CINE';
  Audio2.gust(0.2);
  dolly.rotation.set(0, 0, 0);
  dolly.position.set(cine.doorX - camera.position.x, 0, -46 - camera.position.z);
  comfortBlink(1);
}
function cineUpdate(dt) {
  const c = cine; if (!c) return;
  c.t += dt;
  // slow walk toward the doors with a breath of sway
  const speed = 2.0;
  dolly.position.z += speed * dt;
  dolly.position.x = (c.doorX - camera.position.x) + Math.sin(c.t * 0.7) * 0.35;
  vignette.material.opacity = Math.max(vignette.material.opacity, 0.35);
  // flickering upstairs window
  if (c.flickWin) c.flickWin.material.emissiveIntensity = Math.random() < 0.06 ? 0.05 : 0.5 + Math.random() * 0.5;
  // mist drift + wind
  c.mist.position.x = Math.sin(c.t * 0.15) * 2;
  c.gustT -= dt;
  if (c.gustT <= 0) { c.gustT = 4 + Math.random() * 4; Audio2.gust(0.1 + Math.random() * 0.12); if (Math.random() < 0.35) Audio2.creak(); }
  // title cards
  const card = CINE_CARDS[c.cardI];
  if (card && c.t >= card[0]) { showBigPanel(card[1], card[2], '#cfd6de'); c.cardI++; }
  if (c.t > 6 && c.cardI === 1 && Math.random() < dt * 0.2) Audio2.whisper(0.4);
  // let the player know this is the approach, and that it can be skipped
  if (!c.skipShown && (c.t > 3 || c.skipHinted)) { c.skipShown = true; showSubtitle(isVR ? 'Walking up College Hill…  (trigger to skip)' : 'Walking up College Hill…  (Enter to skip)', 4); }
  // arrive at the steps
  const camZ = dolly.position.z + camera.position.z;
  if (camZ >= -3.2) endCinematic();
}
function endCinematic() {
  if (!cine) return;
  hideBigPanel();
  Audio2.creak(); Audio2.slam();
  comfortBlink(1);
  disposeGroup(cine.g); cine = null;
  const sp = World.spawn(data);
  placeDollyAtTile(sp.x + 0.5, sp.y + 0.5);
  dolly.rotation.set(0, 0, 0);
  state = 'PLAY';
  clock.getDelta();
  showSubtitle('The doors close behind you. The chain rattles down outside.', 4);
  // the opening tutorial (updateOnboarding) takes it from here
  saveState();
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
  // per-room floor skins — ONE shared GPU texture per skin (fixed repeat)
  // Horror upgrades (Screaming Brain Studios, CC0): grimy tile/lino/concrete.
  TEX.rooms = {
    tile: load('horror/floor_tile.jpg', 5, 4),
    bigtile: load('large_floor_tiles_02_diff.jpg', 4, 3),
    lino: load('horror/floor_lino.jpg', 5, 4),
    wood: load('wood_floor_worn_diff.jpg', 4, 3),
    conc: load('horror/floor_conc.jpg', 5, 4),
    carpet: load('dirty_carpet_diff.jpg', 4, 3),
    mosaic: load('old_mosaic_floor_diff.jpg', 4, 3),
    metal: load('horror/metal_rust.jpg', 3, 3),
  };
  // one material per skin, shared by every room using it
  TEX.roomMats = {};
  Object.keys(TEX.rooms).forEach((k) => {
    TEX.roomMats[k] = new THREE.MeshStandardMaterial({ map: TEX.rooms[k], color: 0x93969c, roughness: .95 });
  });
  // Horror wall skins — a different grimy wall per floor (peeling, rust, mould, grunge)
  TEX.hwall = [load('horror/wall_f1.jpg', 1, 1.2), load('horror/wall_f2.jpg', 1, 1.2),
               load('horror/wall_f3.jpg', 1, 1.2), load('horror/wall_f4.jpg', 1, 1.2)];
  TEX.hwallBase = load('horror/wall_base.jpg', 1.4, 1.4);
  // blood / drip / grime decals (RGBA, alpha baked from luminance) — no tiling
  const loadDecal = (file) => { const t = L.load('assets/textures/' + file, undefined, undefined, () => {}); if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  TEX.blood = ['blood1', 'blood2', 'blood3'].map((n) => loadDecal('horror/decals/' + n + '.png'));
  TEX.drip = ['drip1', 'drip2'].map((n) => loadDecal('horror/decals/' + n + '.png'));
  TEX.grime = [loadDecal('horror/decals/grime1.png')];
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
    const mat = key && TEX.roomMats && TEX.roomMats[key];
    if (!mat) return;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry((r.w - 2) * TILE_M, (r.h - 2) * TILE_M), mat);
    pl.rotation.x = -Math.PI / 2;
    pl.position.set((r.x + r.w / 2) * TILE_M, 0.02, (r.y + r.h / 2) * TILE_M);
    floorGroup.add(pl);
  });

  // count walls -> instanced
  let wallCount = 0;
  for (let y = 0; y < World.H; y++) for (let x = 0; x < World.W; x++) if (g[y][x] === TILE.WALL) wallCount++;
  const wallGeo = new THREE.BoxGeometry(TILE_M, WALL_H, TILE_M);
  // horror wall skin per floor (basement uses the mossy-stone skin); Poly Haven as fallback
  const hw = fi === 0 ? TEX.hwallBase : (TEX.hwall && TEX.hwall[fi - 1]);
  const wallMat = new THREE.MeshStandardMaterial({
    map: hw || (fi === 0 ? TEX.wall2D : TEX.wallD),
    normalMap: hw ? null : (fi === 0 ? TEX.wall2N : TEX.wallN),
    color: hw ? 0x9aa0a8 : 0xb7bac0, roughness: .96,
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
      mergeStaticProps(p.group);   // collapse static furniture into few draw calls
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

  // model set-pieces: a skeleton kneels at the ritual altar; a ghost circles the chapel
  const HM = window.HeroModels || {};
  if (fi === 0 && HM.skelGLB && ritual) {
    const sk = HM.skelGLB.clone();
    sk.scale.set(1.25, 1.25, 1.25);
    sk.position.set((ritual.cx + 1.6) * TILE_M, 0, (ritual.cy + 0.5) * TILE_M);
    sk.lookAt((ritual.cx + 0.5) * TILE_M, 0.8, (ritual.cy + 0.5) * TILE_M);
    floorGroup.add(sk);
  }
  if (fi === 4 && HM.ghostGLB) {
    const ch = data.floors[4].rooms.find((r) => r.tag === 'chapel');
    if (ch) {
      const pivot = new THREE.Group();
      pivot.position.set((ch.cx + 0.5) * TILE_M, 2.1, (ch.cy + 0.5) * TILE_M);
      const gh = HM.ghostGLB.clone();
      gh.scale.set(2.2, 2.2, 2.2);
      gh.position.x = 2.2;
      gh.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.7; } });
      pivot.add(gh);
      floorGroup.add(pivot);
      animatedProps.push({ obj: pivot, kind: 'spin', phase: 0 });
    }
  }

  // real hospital furniture scattered through the wards, halls and rooms
  try { placeHorrorProps(fi); } catch (e) { console.warn('horror props failed:', e); }
  // blood, drips and grime on the floors of the worst rooms
  try { placeDecals(fi); } catch (e) { console.warn('decals failed:', e); }

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
  html += '<li><b>The Ash</b> — what the incinerator kept, and what the Rite could set loose.</li>';
  html += '<li><b>The Ghoul</b> — it was never a patient. It came up through the basement drains for the unclaimed dead, and stayed.</li>';
  html += '<li><b>The Risen</b> — a patient who died on the top floor and would not stay dead. It walks the quarters and the chapel still, looking for the way out you found.</li>';
  html += '</ul><h3>The Unbinding Rite</h3>';
  if (ritual && data.rite) {
    const rc = player.rite || {};
    html += '<p class="hint">Gather each soul’s anchor (each unlocked by its truth), carry them to the basement circle, seat all four, then swing the Matron’s Censer at the altar to set every spirit free.</p><ul>';
    data.rite.anchors.forEach((a) => {
      const node = ritual.nodes.find((n) => n.anchor === a.key);
      const seated = node && node.filled;
      const held = rc[a.key];
      const cls = seated ? 'done' : '';
      const st = seated ? '✔ seated' : held ? '▲ carried — take it to the circle' : (riteGateMet(a.gate) ? '○ ready to collect' : '🔒 ' + a.gateHint);
      html += `<li class="${cls}"><b>${a.name}</b> — <span class="hint">${st}</span></li>`;
    });
    html += `<li class="${player.rite.censer ? 'done' : ''}"><b>The Matron’s Censer</b> — <span class="hint">${player.rite.censer ? '✔ in hand' : '○ the Matron’s room, 4th floor'}</span></li>`;
    html += `<li class="${(ritual && ritual.done) ? 'done' : ''}"><b>Perform the Rite</b> — <span class="hint">${ritual.done ? '✔ the house is empty' : 'all four seated + censer, at the altar'}</span></li>`;
    html += '</ul>';
  }
  html += '<h3>Side Quests</h3><ul>';
  const sv = Survival.state();
  html += `<li class="${sv.teddies.length >= 7 ? 'done' : ''}">${sv.teddies.length >= 7 ? '✔' : '○'} <b>The Seven Teddies</b> — ${sv.teddies.length}/7 found. All seven earn the children's blessing (and their anchor).</li>`;
  html += `<li class="${sv.safeOpened ? 'done' : ''}">${sv.safeOpened ? '✔' : '○'} <b>The Matron's Safe</b> — three dates from the Case File open it (4th floor).</li>`;
  html += `<li class="${sv.lantern ? 'done' : ''}">${sv.lantern ? '✔' : '○'} <b>The Chapel Lantern</b> — a backup light hangs in the chapel.</li>`;
  html += `<li>○ <b>Gear</b> — 🔋${sv.batteries}/${sv.maxBatteries} spares · 🍶${sv.draughts}/${sv.maxDraughts} · ⚕${sv.medkits} · ${sv.backpack ? '🎒 backpack' : 'no backpack yet'}</li>`;
  const heldKeys = Object.keys(player.keys);
  html += `<li>○ <b>Keys</b> — ${heldKeys.length ? heldKeys.map((id) => '🗝 ' + keyLabel(id)).join(' · ') : 'none yet. The stairwells were locked ward by ward in ’88 — find the keys to climb.'}</li>`;
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
  eyeL.userData.anim = true; eyeR.userData.anim = true;   // exclude from merging
  grp.add(eyeL); grp.add(eyeR);
  (peekerParent || floorGroup).add(grp);
  return { grp, eyeL, eyeR, wx: px, wz: pz, tileX: m.x + nx + 0.5, tileY: m.y + nz + 0.5,
    state: 'hidden', t: 0, stepT: 0, laughed: false, cool: 2 + Math.random() * 4,
    fleeV: 0, fleePan: 0, fleeDir: 1 };
}

let peekerParent = null;
function buildPeekers(fi) {
  peekers = []; peekSpawnTimer = 5;
  if (!peekMats) makePeekMats();
  peekerParent = new THREE.Group();
  floorGroup.add(peekerParent);
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
  mergeStaticProps(peekerParent);   // portraits collapse to ~2 draw calls; eyes stay live
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

// ---- real furniture (Poly Haven glTF, CC0) ----
function loadHeroModels() {
  const L = new GLTFLoader();
  const defs = { bed: 'GothicBed_01', rocker: 'Rockingchair_01', chair: 'WoodenChair_01',
    table: 'WoodenTable_01', cabinet: 'drawer_cabinet', boiler: 'barrel_stove', candles: 'brass_candleholders' };
  const MODELS = {};
  const loads = Object.entries(defs).map(([k, id]) =>
    L.loadAsync('assets/models/' + id + '/' + id + '_1k.gltf')
      .then((g) => { MODELS[k] = g.scene; })
      .catch((e) => console.warn('hero model failed:', id)));
  // apparition models WITH animation clips.
  // Primary cast: Sketchfab "The Heilwald Loophole" nurses + creatures (CC-BY-4.0, credited in CREDITS.txt).
  // Fallback cast: Kenney/Quaternius/KayKit (CC0) — kept loaded for set-pieces.
  const MOB = {};
  const monsters = [
    // real horror cast (gltf dirs)
    ['helene', 'sketchfab/helene/scene.gltf'],
    ['anne', 'sketchfab/anne/scene.gltf'],
    ['wolfram', 'sketchfab/wolfram/scene.gltf'],
    ['horrorkid', 'horror/horrorkid/scene.gltf'],   // the Child — a bound nursery child
    ['crawler2', 'horror/crawler2/scene.gltf'],   // the crawling mutated human
    ['ghoul', 'horror/ghoul/scene.gltf'],         // the Ghoul — basement corpse-eater
    ['closer', 'horror/closer/scene.gltf'],       // the Closer — the Ash's new body
    ['undead', 'horror/undead/scene.gltf'],        // the Risen — a dead patient walking the top floor
    // legacy CC0 (set-pieces + fallback)
    ['ghost', 'monsters/ghost.glb'], ['skel', 'monsters/skeleton.glb'], ['kaykit', 'monsters/skeleton_warrior.glb'],
  ];
  monsters.forEach(([k, f]) => loads.push(L.loadAsync('assets/models/' + f).then((g) => { MOB[k] = g; }).catch((e) => console.warn('mob load failed:', f))));
  // real horror furniture (CC-BY, credited) — fills the wards, halls and rooms
  const HPROPS = { hospbed: 'hospbed', horrorbed: 'horrorbed', gurney: 'gurney', wheelchair: 'wheelchair',
    rewheelchair: 'rewheelchair', clock: 'clock', caftable: 'caftable', bin: 'bin',
    // batch 2 — a full hospital's dressing
    examtable: 'examtable', locker: 'locker', metalcab: 'metalcab', deadbody: 'deadbody', deadcovered: 'deadcovered',
    coffin: 'coffin', bloodybath: 'bloodybath', bathcab: 'bathcab', oldtv: 'oldtv', payphone: 'payphone',
    vending: 'vending', bookshelf: 'bookshelf', candle: 'candle', cross: 'cross', ceilinglights: 'ceilinglights',
    gasstove: 'gasstove', voodoohang: 'voodoohang', shovel: 'shovel', bloodytarp: 'bloodytarp', wallblood: 'wallblood' };
  Object.entries(HPROPS).forEach(([k, d]) => loads.push(
    L.loadAsync('assets/models/horror/' + d + '/scene.gltf').then((g) => { MODELS[k] = g.scene; }).catch((e) => console.warn('prop load failed:', d))));
  return Promise.all(loads).then(() => {
    window.HeroModels = MODELS; window.MobModels = MOB;
    if (MOB.ghost) MODELS.ghostGLB = MOB.ghost.scene;   // keep chapel/altar set-pieces working
    if (MOB.skel) MODELS.skelGLB = MOB.skel.scene;
  });
}

// ---- atmosphere: dappled flashlight cookie + dust motes in the beam ----
function makeBeamCookie() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 12, 128, 128, 128);
  g.addColorStop(0, '#fff'); g.addColorStop(0.65, '#c9c9c9'); g.addColorStop(1, '#000');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    x.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.22) + ')';
    x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 20, 0, 6.28); x.fill();
  }
  return new THREE.CanvasTexture(c);
}
function makeDust() {
  const N = 130;
  dustBase = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    dustBase[i * 3] = (Math.random() - 0.5) * 7;
    dustBase[i * 3 + 1] = 0.2 + Math.random() * 2.3;
    dustBase[i * 3 + 2] = (Math.random() - 0.5) * 7;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(dustBase.slice(), 3));
  const m = new THREE.PointsMaterial({ color: 0xc9ba98, size: 0.018, transparent: true,
    opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  dust = new THREE.Points(g, m);
  dust.frustumCulled = false;
  scene.add(dust);
}
function updateDust(dt) {
  if (!dust) return;
  dust.visible = !!(player && player.hasLight && player.lightOn);
  if (!dust.visible) return;
  camera.getWorldPosition(tmpV);
  dust.position.set(tmpV.x, 0, tmpV.z);
  const a = dust.geometry.attributes.position.array;
  const t = performance.now() / 1000;
  for (let i = 0; i < a.length; i += 3) {
    a[i] = dustBase[i] + Math.sin(t * 0.3 + i) * 0.25;
    a[i + 1] = dustBase[i + 1] + Math.sin(t * 0.17 + i * 1.7) * 0.15;
    a[i + 2] = dustBase[i + 2] + Math.cos(t * 0.23 + i * 0.9) * 0.25;
  }
  dust.geometry.attributes.position.needsUpdate = true;
}

// ---- static-prop merger: hundreds of furniture meshes -> ~1 draw call per material
function mergeStaticProps(group) {
  group.updateMatrixWorld(true);
  const skip = new Set();
  group.traverse((o) => {
    if (o.userData && (o.userData.anim || o.userData.ember)) o.traverse((c) => skip.add(c));
  });
  const buckets = new Map();
  const originals = [];
  group.traverse((o) => {
    if (!o.isMesh || skip.has(o)) return;
    if (o.material && o.material.emissiveIntensity !== undefined && o.userData.flicker) return;
    const key = o.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [] });
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    buckets.get(key).geos.push(g);
    originals.push(o);
  });
  originals.forEach((o) => { if (o.parent) o.parent.remove(o); o.geometry.dispose(); });
  buckets.forEach(({ mat, geos }) => {
    let count = 0; geos.forEach((g) => count += g.attributes.position.count);
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    let o3 = 0, o2 = 0;
    geos.forEach((g) => {
      pos.set(g.attributes.position.array, o3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
      o3 += g.attributes.position.count * 3;
      o2 += g.attributes.position.count * 2;
      g.dispose();
    });
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    group.add(new THREE.Mesh(bg, mat));
  });
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
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: .95 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(TILE_M * 0.8, 0.5, TILE_M * 0.8), mat);
  m.position.set(wx, 0.25, wz); floorGroup.add(m);
  // a small dim EXIT-style sign so you can find the stairwell — not a glowing block
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 4),
    new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: 0x2a6a2a, emissiveIntensity: 0.5 }));
  arrow.position.set(wx, WALL_H - 0.3, wz);
  arrow.rotation.x = up ? 0 : Math.PI;
  floorGroup.add(arrow);
}
function addExit(wx, wz) {
  // the chained front doors — real double doors, dark wood, chains across
  const wood = new THREE.MeshStandardMaterial({ map: TEX.doorD, color: 0x5a4a38, roughness: .9 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 1 });
  const g = new THREE.Group(); g.position.set(wx, 0, wz);
  // frame
  g.add(mkBox(TILE_M * 1.02, WALL_H * 0.98, 0.12, frame, 0, WALL_H * 0.49, -0.06));
  // two door leaves
  g.add(mkBox(TILE_M * 0.46, WALL_H * 0.9, 0.16, wood, -TILE_M * 0.24, WALL_H * 0.46, 0.02));
  g.add(mkBox(TILE_M * 0.46, WALL_H * 0.9, 0.16, wood, TILE_M * 0.24, WALL_H * 0.46, 0.02));
  // handles
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: .6, roughness: .5 });
  g.add(mkBox(0.06, 0.2, 0.06, brass, -0.12, WALL_H * 0.46, 0.12));
  g.add(mkBox(0.06, 0.2, 0.06, brass, 0.12, WALL_H * 0.46, 0.12));
  // heavy chains slung across the doors + a padlock
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: .7, roughness: .55 });
  for (let cy = 1.0; cy <= 2.1; cy += 0.55) {
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, TILE_M * 0.95, 6), chainMat);
    chain.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.06; chain.position.set(0, cy, 0.16);
    g.add(chain);
  }
  g.add(mkBox(0.14, 0.2, 0.08, chainMat, 0, 1.55, 0.2)); // padlock
  // a small dim green EXIT sign above the frame (so it's findable, not a wall)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: 0x2f7a2f, emissiveIntensity: 0.6 }));
  sign.position.set(0, WALL_H * 0.98, 0.14); g.add(sign);
  floorGroup.add(g);
}
function mkBox(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
function addLocker(wx, wz) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x30323c, metalness: .3, roughness: .7 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(TILE_M * 0.6, WALL_H * 0.8, TILE_M * 0.4), mat);
  m.position.set(wx, WALL_H * 0.4, wz); m.castShadow = true;
  floorGroup.add(m);
}

const ITEM_COLORS = { flashlight: 0xffe08a, battery: 0x8affa0, emf: 0x7ad0ff, spiritbox: 0xc99cff, candlekit: 0xffb86b, key: 0xffd24a, draught: 0x9ae0c8, backpack: 0xb08a5a, medkit: 0xff8a8a, teddy: 0xd8a06a, lantern: 0xffc04a, anchor: 0xd8b24a, censer: 0xe0c060 };
function addItemMesh(it) {
  const col = ITEM_COLORS[it.type] || 0xffffff;
  const g = new THREE.Group();
  const isRite = it.type === 'anchor' || it.type === 'censer';
  // Rite relics read as a larger, slowly-turning octahedron in a cold gold — set apart from loot.
  const mesh = new THREE.Mesh(
    isRite ? new THREE.OctahedronGeometry(0.2, 0) : new THREE.IcosahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: isRite ? 0.8 : 1.1, roughness: .3 }));
  g.add(mesh);   // emissive glow only — no per-item PointLight (Quest perf)
  if (isRite) {  // a faint halo ring so relics feel special and findable
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.015, 6, 20),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, fog: false }));
    halo.rotation.x = Math.PI / 2; g.add(halo);
  }
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
  g.add(paper);   // emissive paper only — no light
  g.position.set((d.x + 0.5) * TILE_M, 1.0, (d.y + 0.5) * TILE_M);
  g.userData.doc = true;
  floorGroup.add(g);
  docMeshes.set(d.id, g);
}

// ---- blood / drip / grime decals on the floor of the worst rooms ----
function placeDecals(fi) {
  if (!TEX.blood || !TEX.blood.length) return;
  const rooms = data.floors[fi].rooms || [];
  const g = data.floors[fi].grid;
  let seed = 4242 + fi * 331;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  // how many decals each kind of room earns (the more clinical/violent, the more)
  const HORROR = { er: 3, surgery: 3, morgue: 4, incinerator: 4, autopsy: 3, ritual: 3,
    ward: 2, iso: 2, kitchen: 2, boiler: 2, room207: 2, mose: 2, recovery: 1, maternity: 1, pharmacy: 1, bath: 1, nursery: 1 };
  const grp = new THREE.Group();
  const pick = () => { const r = rnd(); return r < 0.5 ? TEX.blood[Math.floor(rnd() * TEX.blood.length)] : r < 0.78 ? TEX.drip[Math.floor(rnd() * TEX.drip.length)] : TEX.grime[0]; };
  rooms.forEach((r) => {
    const n = HORROR[r.tag]; if (!n || r.w < 3 || r.h < 3) return;
    for (let k = 0; k < n; k++) {
      const tx = r.x + 1 + Math.floor(rnd() * (r.w - 2));
      const ty = r.y + 1 + Math.floor(rnd() * (r.h - 2));
      if (!g[ty] || g[ty][tx] !== TILE.FLOOR) continue;
      const size = 0.9 + rnd() * 1.4;
      const mat = new THREE.MeshStandardMaterial({ map: pick(), transparent: true, opacity: 0.72 + rnd() * 0.26,
        roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      pl.rotation.x = -Math.PI / 2; pl.rotation.z = rnd() * 6.28;
      pl.position.set((tx + 0.5) * TILE_M, 0.02, (ty + 0.5) * TILE_M);
      grp.add(pl);
    }
  });
  // the corridors carry old traffic: drag-marks, drips and grime down the halls
  [data.CORR_TOP, data.CORR_BOT].forEach((cy) => {
    if (cy == null) return;
    for (let x = 4; x < World.W - 4; x += 3 + Math.floor(rnd() * 4)) {
      if (rnd() > 0.55 || !g[cy] || g[cy][x] !== TILE.FLOOR) continue;
      const size = 0.8 + rnd() * 1.0;
      const tex = rnd() < 0.25 ? TEX.blood[Math.floor(rnd() * TEX.blood.length)] : (rnd() < 0.5 ? TEX.drip[Math.floor(rnd() * TEX.drip.length)] : TEX.grime[0]);
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.55 + rnd() * 0.3,
        roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      pl.rotation.x = -Math.PI / 2; pl.rotation.z = rnd() * 6.28;
      pl.position.set((x + 0.5) * TILE_M, 0.02, (cy + 0.5) * TILE_M);
      grp.add(pl);
    }
  });
  floorGroup.add(grp);
}
// ---- real horror furniture (CC-BY hospital props) ----
// Each model ships at a different authored scale, so normalize by bounding box to
// a real-world size, ground it, age the material, then register a collision box.
const HPROP_CFG = {
  hospbed:     { by: 'long', size: 2.05, tint: 0x8a8f86, tintAmt: 0.25 },
  horrorbed:   { by: 'long', size: 2.00, tint: 0x7a6a5a, tintAmt: 0.25 },
  gurney:      { by: 'long', size: 2.05, tint: 0x9098a0, tintAmt: 0.20 },
  wheelchair:  { by: 'h',    size: 1.10, tint: 0x60666e, tintAmt: 0.30 },
  rewheelchair:{ by: 'h',    size: 1.10, tint: 0x60666e, tintAmt: 0.30 },
  clock:       { by: 'h',    size: 2.10, tint: 0x3a2a1a, tintAmt: 0.35 },
  caftable:    { by: 'long', size: 1.70, tint: 0x556070, tintAmt: 0.25 },
  bin:         { by: 'h',    size: 1.00, tint: 0x2c3a2c, tintAmt: 0.30 },
  // batch 2 — hospital dressing. mount: floor (default, collides) / flat / ceiling / wall (no collision)
  examtable:   { by: 'long', size: 2.00, tint: 0x9098a0, tintAmt: 0.20 },
  locker:      { by: 'h',    size: 1.85, tint: 0x6a6a4a, tintAmt: 0.22 },
  metalcab:    { by: 'h',    size: 1.80, tint: 0x50565e, tintAmt: 0.28 },
  deadbody:    { by: 'h',    size: 1.70, tint: 0x8a6a66, tintAmt: 0.15 },
  deadcovered: { by: 'long', size: 1.90, tint: 0x9a9a94, tintAmt: 0.18 },
  coffin:      { by: 'long', size: 2.00, tint: 0x5a4636, tintAmt: 0.30 },
  bloodybath:  { by: 'long', size: 1.60, tint: 0xaeb2b0, tintAmt: 0.15 },
  bathcab:     { by: 'h',    size: 1.40, tint: 0x6a5a44, tintAmt: 0.28 },
  oldtv:       { by: 'long', size: 0.72, tint: 0x3a3a40, tintAmt: 0.28 },
  payphone:    { by: 'h',    size: 1.35, tint: 0x30343a, tintAmt: 0.30 },
  vending:     { by: 'h',    size: 1.90, tint: 0x7a3a3a, tintAmt: 0.22 },
  bookshelf:   { by: 'h',    size: 1.85, tint: 0x5a4636, tintAmt: 0.28 },
  candle:      { by: 'h',    size: 0.42, tint: 0xcfc6b0, tintAmt: 0.10, light: true },
  cross:       { by: 'long', size: 1.15, tint: 0x6a5636, tintAmt: 0.28 },
  ceilinglights:{ by: 'h',   size: 0.55, tint: 0x44484e, tintAmt: 0.20, mount: 'ceiling' },
  gasstove:    { by: 'h',    size: 1.00, tint: 0x8a8f92, tintAmt: 0.20 },
  voodoohang:  { by: 'h',    size: 0.55, tint: 0x9a8a6a, tintAmt: 0.18, mount: 'ceiling' },
  shovel:      { by: 'long', size: 1.20, tint: 0x5a5250, tintAmt: 0.28 },
  bloodytarp:  { by: 'long', size: 1.90, tint: 0x6a6a80, tintAmt: 0.12, mount: 'flat' },
  wallblood:   { by: 'long', size: 1.60, tint: 0x9a9088, tintAmt: 0.10, mount: 'wall' },
};
function makeHProp(key, wx, wz, yaw) {
  const src = (window.HeroModels || {})[key];
  const cfg = HPROP_CFG[key];
  if (!src || !cfg) return null;
  const mount = cfg.mount || 'floor';
  const obj = src.clone();
  let box = new THREE.Box3().setFromObject(obj);
  const sz = box.getSize(new THREE.Vector3());
  const ref = cfg.by === 'h' ? (sz.y || 1) : (Math.max(sz.x, sz.z) || 1);
  obj.scale.setScalar(cfg.size / ref);
  box = new THREE.Box3().setFromObject(obj);
  const ctr = box.getCenter(new THREE.Vector3());
  obj.position.x -= ctr.x; obj.position.z -= ctr.z;
  if (mount === 'ceiling') obj.position.y -= box.max.y;        // top flush with the ceiling, hangs down
  else if (mount === 'wall') obj.position.y -= ctr.y;          // centred on the wall
  else obj.position.y -= box.min.y;                            // floor / flat: sit on the ground
  obj.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.color) o.material.color.lerp(new THREE.Color(cfg.tint), cfg.tintAmt); if (o.material.roughness != null) o.material.roughness = Math.min(1, o.material.roughness + 0.2); o.frustumCulled = true; } });
  const grp = new THREE.Group();
  grp.add(obj); grp.rotation.y = yaw;
  const gy = mount === 'ceiling' ? WALL_H - 0.04 : mount === 'wall' ? 1.45 : 0;
  grp.position.set(wx, gy, wz);
  if (cfg.light) { const l = new THREE.PointLight(0xffb060, 0.7, 3.4, 2); l.position.y = cfg.size + 0.05; grp.add(l);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd48a, fog: false })); fl.position.y = cfg.size + 0.02; grp.add(fl); }
  return { grp, solid: mount === 'floor' };
}
// which props each room type wears, with a spawn chance each. 'bed' picks a bed model.
const ROOM_PROPS = {
  surgery:    [['examtable', 1], ['bloodytarp', 0.5], ['metalcab', 0.6], ['ceilinglights', 0.7]],
  er:         [['examtable', 0.7], ['gurney', 0.6], ['locker', 0.5], ['ceilinglights', 0.7]],
  admitting:  [['gurney', 0.8], ['payphone', 0.5], ['metalcab', 0.5]],
  morgue:     [['deadcovered', 1], ['deadbody', 0.8], ['coffin', 0.7], ['examtable', 0.6]],
  autopsy:    [['examtable', 1], ['deadcovered', 0.7], ['metalcab', 0.5]],
  xray:       [['metalcab', 0.6], ['examtable', 0.5]],
  ward:       [['bed', 1], ['locker', 0.6], ['deadcovered', 0.35], ['ceilinglights', 0.6]],
  recovery:   [['bed', 1], ['wheelchair', 0.6], ['oldtv', 0.4]],
  iso:        [['bed', 1], ['locker', 0.5], ['wallblood', 0.5]],
  room207:    [['bed', 1], ['locker', 0.5], ['oldtv', 0.4]],
  maternity:  [['bed', 1], ['voodoohang', 0.4], ['oldtv', 0.3]],
  mose:       [['bed', 1], ['locker', 0.5], ['wallblood', 0.4]],
  quarters:   [['bed', 0.7], ['oldtv', 0.6], ['bookshelf', 0.5]],
  bath:       [['bloodybath', 0.9], ['bathcab', 0.7]],
  pharmacy:   [['metalcab', 0.9], ['locker', 0.5]],
  supply:     [['metalcab', 0.8], ['shovel', 0.4]],
  storage:    [['metalcab', 0.7], ['shovel', 0.6], ['locker', 0.5]],
  station:    [['metalcab', 0.7], ['bookshelf', 0.5], ['wheelchair', 0.5]],
  records:    [['bookshelf', 1], ['metalcab', 0.5]],
  linen:      [['metalcab', 0.6], ['locker', 0.6]],
  lobby:      [['clock', 0.8], ['payphone', 0.7], ['vending', 0.7], ['oldtv', 0.4]],
  waiting:    [['oldtv', 0.7], ['payphone', 0.5], ['vending', 0.5], ['wheelchair', 0.5]],
  cafeteria:  [['caftable', 0.9], ['vending', 0.7], ['gasstove', 0.5]],
  kitchen:    [['gasstove', 0.9], ['caftable', 0.7], ['metalcab', 0.5]],
  chapel:     [['cross', 1], ['candle', 0.9], ['clock', 0.4]],
  sanctum:    [['cross', 0.8], ['candle', 0.9]],
  matron:     [['bookshelf', 0.7], ['clock', 0.6], ['candle', 0.6], ['oldtv', 0.4]],
  ritual:     [['bloodytarp', 0.9], ['candle', 1], ['cross', 0.5]],
  incinerator:[['shovel', 0.7], ['metalcab', 0.5], ['wallblood', 0.5]],
  boiler:     [['shovel', 0.6], ['metalcab', 0.5]],
  laundry:    [['metalcab', 0.6], ['shovel', 0.4]],
  nursery:    [['voodoohang', 0.6], ['oldtv', 0.4], ['candle', 0.5]],
  attic:      [['bookshelf', 0.5], ['candle', 0.5], ['voodoohang', 0.4]],
};
function placeHorrorProps(fi) {
  const HM = window.HeroModels || {};
  if (!HM.hospbed && !HM.examtable) return;   // props didn't load — skip quietly
  const g = data.floors[fi].grid;
  const rooms = data.floors[fi].rooms || [];
  let seed = 90210 + fi * 7919;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const yaw4 = () => Math.floor(rnd() * 4) * (Math.PI / 2);
  const grp = new THREE.Group();
  const isFloor = (tx, ty) => g[ty] && g[ty][tx] === TILE.FLOOR;
  const used = new Set();
  // every tile the footprint covers must be floor — no furniture poking through walls
  const footprintClear = (b, mount) => {
    if (mount === 'ceiling' || mount === 'wall') return true;
    const pad = 0.15;
    for (let ty = Math.floor((b.min.z + pad) / TILE_M); ty <= Math.floor((b.max.z - pad) / TILE_M); ty++)
      for (let tx = Math.floor((b.min.x + pad) / TILE_M); tx <= Math.floor((b.max.x - pad) / TILE_M); tx++)
        if (!isFloor(tx, ty)) return false;
    return true;
  };
  const place = (key, tx, ty, yaw) => {
    const k = tx + ',' + ty;
    const cfg = HPROP_CFG[key]; const mount = (cfg && cfg.mount) || 'floor';
    if (!isFloor(tx, ty)) return false;
    if ((mount === 'floor' || mount === 'flat') && used.has(k)) return false;   // don't stack furniture on one tile
    const p = makeHProp(key, (tx + 0.5) * TILE_M, (ty + 0.5) * TILE_M, yaw);
    if (!p) return false;
    const b = new THREE.Box3().setFromObject(p.grp);
    if (!footprintClear(b, mount)) { return false; }   // would clip a wall — try elsewhere
    grp.add(p.grp);
    if (p.solid) { propSolids.push({ x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z }); used.add(k); }
    else if (mount === 'flat') used.add(k);
    return true;
  };
  // pick an interior tile, retrying a few spots so a wall-clip doesn't drop the prop
  const placeIn = (r, key, yaw) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const tx = r.x + 1 + Math.floor(rnd() * Math.max(1, r.w - 2));
      const ty = r.y + 1 + Math.floor(rnd() * Math.max(1, r.h - 2));
      if (place(key, tx, ty, yaw)) return true;
    }
    return false;
  };
  rooms.forEach((r) => {
    const list = ROOM_PROPS[r.tag]; if (!list) return;
    list.forEach(([prop, chance]) => {
      if (rnd() > chance) return;
      const key = prop === 'bed' ? (rnd() < 0.5 ? 'hospbed' : 'horrorbed') : prop;
      placeIn(r, key, yaw4());
    });
    // extra beds fill out the big wards (more stuff!)
    if (list.some((p) => p[0] === 'bed')) {
      const extra = r.w * r.h > 40 ? 2 : r.w * r.h > 26 ? 1 : 0;
      for (let i = 0; i < extra; i++) if (rnd() < 0.75) placeIn(r, rnd() < 0.5 ? 'hospbed' : 'horrorbed', yaw4());
    }
    // a little loose clutter in every furnished room so nothing feels bare
    if (rnd() < 0.6) placeIn(r, rnd() < 0.5 ? 'bin' : 'wheelchair', yaw4());
  });
  // corridor dressing: dead pendant lights hang down the halls (no collision),
  // and the odd abandoned wheelchair sits against the corridor ends
  [data.CORR_TOP, data.CORR_BOT].forEach((cy) => {
    if (cy == null) return;
    for (let x = 5; x < World.W - 5; x += 7 + Math.floor(rnd() * 3)) {
      if (isFloor(x, cy)) place('ceilinglights', x, cy, 0);
    }
  });
  floorGroup.add(grp);
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
const ANCHOR_TINT = { ada: 0xcfe0f0, mose: 0x9a3a2a, child: 0xe0c060, ash: 0xff6a1e };
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
  // four anchor pedestals — an empty stone cradle each, until its relic is seated
  ritual.nodes.forEach((n) => {
    const tx = ritual.cx + n.dx, ty = ritual.cy + n.dy;
    n.tileX = tx + 0.5; n.tileY = ty + 0.5;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.62, 8), m.wax));   // the plinth
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.1, 0.08, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1418, roughness: .8 }));
    bowl.position.y = 0.35; g.add(bowl);
    // the seated relic token (hidden until filled) + its glow
    const tint = ANCHOR_TINT[n.anchor] || 0xffcf7a;
    const token = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0),
      new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 1.0, roughness: .3 }));
    token.position.y = 0.5; token.visible = n.filled; g.add(token);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: tint, fog: false }));
    flame.position.y = 0.6; flame.visible = n.filled; g.add(flame);
    const light = new THREE.PointLight(tint, n.filled ? 0.9 : 0, 3.2, 2); light.position.y = 0.6; g.add(light);
    g.position.set(n.tileX * TILE_M, 0.31, n.tileY * TILE_M);
    n.mesh = g; n.token = token; n.flame = flame; n.light = light;
    floorGroup.add(g);
  });
}

// ---- entity meshes ----
// spectral apparitions: layered translucent shrouds, glow auras, ember swarms
let auraTexCache = {};
function auraTex(hex) {
  if (auraTexCache[hex]) return auraTexCache[hex];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.35, hex); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return (auraTexCache[hex] = new THREE.CanvasTexture(c));
}
// kind -> animated model + spectral styling
const MOBMAP = {
  // The Grey Nurse — Nurse Helene, drained pale & half-there
  nurse: { key: 'helene', targetH: 1.78, translucent: true, opacity: 0.8, tint: 0xbcccdd, tintAmt: 0.34, aura: 'rgba(150,180,220,0.5)', auraS: 2.4, yaw: Math.PI },
  // The Night Nurse — Nurse Anne, sicklier, a charger
  nurse2: { key: 'anne', targetH: 1.8, translucent: true, opacity: 0.82, tint: 0xaecdb4, tintAmt: 0.3, aura: 'rgba(140,200,150,0.45)', auraS: 2.4, yaw: Math.PI },
  // The Child — Fantasma, a small floating phantom
  child: { key: 'horrorkid', targetH: 1.18, translucent: false, opacity: 1, tint: 0xb8b0aa, tintAmt: 0.22, aura: 'rgba(150,60,60,0.45)', auraS: 1.8, yaw: 0 },
  // Mose the Lurching Orderly — Wolfram, tall & dark, he can run
  mose: { key: 'wolfram', targetH: 2.02, translucent: false, opacity: 1, tint: 0x2a2530, tintAmt: 0.45, emissive: 0x0a0004, aura: 'rgba(60,10,10,0.55)', auraS: 2.8, yaw: Math.PI },
  // The Crawler — a mutated human dragging itself along the floor (prone, so targetH is its low height)
  crawler: { key: 'crawler2', targetH: 0.62, translucent: false, opacity: 1, tint: 0x6a5a52, tintAmt: 0.4, emissive: 0x120404, aura: 'rgba(80,10,20,0.5)', auraS: 2.0, yaw: 0 },
  // The Ash — the Closer's straitjacketed body, charred and wreathed in living embers (the 1926 fire's dead)
  ash: { key: 'closer', targetH: 1.92, translucent: false, opacity: 1, tint: 0x2a1810, tintAmt: 0.6, emissive: 0x501403, aura: 'rgba(255,90,20,0.5)', auraS: 3.0, yaw: 0 },
  // The Ghoul — a hunched, blood-clawed corpse-eater that haunts the basement
  ghoul: { key: 'ghoul', targetH: 1.72, translucent: false, opacity: 1, tint: 0x5a5a4a, tintAmt: 0.35, emissive: 0x0a0402, aura: 'rgba(70,30,10,0.5)', auraS: 2.4, yaw: 0 },
  // The Risen — a blood-caked dead patient stalking the top floor
  undead: { key: 'undead', targetH: 1.86, translucent: false, opacity: 1, tint: 0x5a3232, tintAmt: 0.28, emissive: 0x140404, aura: 'rgba(120,20,20,0.5)', auraS: 2.5, yaw: 0 },
};
function auraSprite(rec, grp, hex, size, y) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex(hex), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1); s.position.y = y; grp.add(s); rec.aura = s;
}
function buildEmbers(rec, grp) {
  const N = 90, ep = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = Math.random() * 6.28, r = 0.3 + Math.random() * 0.7; ep[i * 3] = Math.cos(a) * r; ep[i * 3 + 1] = 0.2 + Math.random() * 1.9; ep[i * 3 + 2] = Math.sin(a) * r; }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  rec.embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xff6a1e, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  grp.add(rec.embers);
  const glow = new THREE.PointLight(0xff5a1e, 0.8, 4, 2); glow.position.y = 1; grp.add(glow); grp.userData.ember = glow;
}
function ensureEntityMesh(e) {
  if (entityMeshes.has(e)) return entityMeshes.get(e);
  const grp = new THREE.Group();
  const rec = { group: grp, phase: Math.random() * 6.28, gown: [], embers: null, aura: null, mixer: null, clips: null, cur: null, action: null, yaw: 0, hasModel: false,
    stepT: 0, voiceT: 4 + Math.random() * 6, breathT: 0, lastState: 0, beamCd: 0 };
  const MOB = window.MobModels || {};
  const map = MOBMAP[e.kind];
  // --- real animated model path ---
  if (map && MOB[map.key] && MOB[map.key].scene) {
    try {
      const src = MOB[map.key];
      const model = skeletonClone(src.scene);
      // Set up animation FIRST so we can pose the rig to a real idle frame before
      // measuring — bind-pose bounds are unreliable for these skinned rigs.
      if (src.animations && src.animations.length) {
        rec.mixer = new THREE.AnimationMixer(model);
        const find = (...keys) => { for (const k of keys) { const c = src.animations.find((a) => a.name.toLowerCase().includes(k)); if (c) return c; } return null; };
        rec.clips = {
          idle: find('flying_idle', 'idle', 'static', 'take 001') || src.animations[0],
          walk: find('walking_a', 'walk', 'approach', 'flying_idle') || null,
          run: find('running_a', 'sprint', 'run', 'charge', 'overwhelm', 'fast_flying') || null,
        };
        rec.clips.walk = rec.clips.walk || rec.clips.idle;
        rec.clips.run = rec.clips.run || rec.clips.walk;
        rec.mixer.clipAction(rec.clips.idle).play();
        rec.mixer.update(0);   // pose to the first idle frame for an accurate bounds read
      }
      // Height-normalize using PRECISE (skinned-aware) bounds so every apparition
      // lands at human scale with its feet on the floor, regardless of authored scale.
      model.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(model, true);
      const h = (box.max.y - box.min.y) || 1;
      model.scale.setScalar(map.targetH / h);
      if (map.low) model.scale.y *= 0.62;
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model, true);
      model.position.y = -box.min.y + (map.fly ? 0.3 : 0);
      model.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        o.frustumCulled = false;
        o.material = o.material.clone();
        if (o.material.color) o.material.color.lerp(new THREE.Color(map.tint), map.tintAmt != null ? map.tintAmt : 0.55);
        if (o.material.emissive && map.emissive != null) o.material.emissive.setHex(map.emissive);
        if (map.translucent) { o.material.transparent = true; o.material.opacity = map.opacity; o.material.depthWrite = false; }
      });
      grp.add(model); rec.hasModel = true; rec.yaw = map.yaw || 0;
      if (rec.mixer) { rec.action = rec.mixer.clipAction(rec.clips.idle); rec.action.play(); rec.cur = rec.clips.idle; }
      if (e.kind === 'ash') buildEmbers(rec, grp);
      auraSprite(rec, grp, map.aura, map.auraS, map.targetH * 0.6);
      grp.visible = false; scene.add(grp); entityMeshes.set(e, rec); return rec;
    } catch (err) { console.warn('mob model build failed', e.kind, err); }
  }
  // --- fallback: procedural spectral shroud ---
  const shroud = (color, op, r0, r1, h, y) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 12, 1, true),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: op, roughness: 1, side: THREE.DoubleSide, depthWrite: false }));
    m.position.y = y; grp.add(m); rec.gown.push(m); return m;
  };
  const head = (color, op, r, y) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: op, roughness: 1 }));
    m.position.y = y; grp.add(m); return m;
  };
  const eyes = (color, r, y, spread, glowing) => [-spread, spread].forEach((ex) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 6),
      glowing ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshBasicMaterial({ color: 0x000000 }));
    m.position.set(ex, y, 0.16); grp.add(m);
  });
  const aura = (hex, size, y) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex(hex), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.set(size, size, 1); s.position.y = y; grp.add(s); rec.aura = s;
  };
  if (e.kind === 'nurse' || e.kind === 'nurse2') {  // the Nurses: layered pale gown, black eye-pits
    shroud(0xdfe4ea, 0.42, 0.16, 0.55, 1.75, 0.88);
    shroud(0xaab4c0, 0.30, 0.20, 0.66, 1.85, 0.92);
    shroud(0x8a95a2, 0.18, 0.26, 0.8, 1.9, 0.95);
    head(0xd8dde4, 0.8, 0.19, 1.86);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.26), new THREE.MeshStandardMaterial({ color: 0xeef2f6, transparent: true, opacity: 0.85 }));
    cap.position.y = 2.02; grp.add(cap);
    eyes(0x000000, 0.032, 1.88, 0.075, false);
    aura('rgba(150,180,220,0.5)', 2.6, 1.1);
  } else if (e.kind === 'mose') {     // Mose: a tall shadow, burning eyes
    shroud(0x0a0a0e, 0.92, 0.2, 0.6, 2.0, 1.0);
    shroud(0x14141c, 0.5, 0.28, 0.78, 2.1, 1.05);
    head(0x0c0c10, 0.95, 0.2, 2.12);
    eyes(0xff2a18, 0.035, 2.14, 0.08, true);
    aura('rgba(60,10,10,0.55)', 2.8, 1.2);
  } else if (e.kind === 'child') {    // the Child: small, too bright, hollow eyes
    shroud(0xe8ecf0, 0.5, 0.1, 0.34, 0.95, 0.48);
    shroud(0xc2cad2, 0.28, 0.14, 0.42, 1.0, 0.5);
    head(0xe4e9ee, 0.85, 0.13, 1.05);
    eyes(0x000000, 0.024, 1.07, 0.052, false);
    aura('rgba(190,210,235,0.5)', 1.7, 0.6);
  } else if (e.kind === 'crawler') {  // the Crawler: a low black wrongness
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x0a0810, transparent: true, opacity: 0.9, roughness: 1 }));
    body.scale.set(1.3, 0.45, 1.8); body.position.y = 0.3; grp.add(body); rec.gown.push(body);
    head(0x0e0c14, 0.95, 0.16, 0.5);
    eyes(0xff2a18, 0.03, 0.52, 0.07, true);
    aura('rgba(80,10,20,0.5)', 1.6, 0.35);
  } else {                            // the Ash: a swarm of embers around a char core
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x0c0806, roughness: 1, transparent: true, opacity: 0.9 }));
    core.position.y = 1.1; grp.add(core); rec.gown.push(core);
    const N = 110, ep = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * 6.28, r = 0.3 + Math.random() * 0.7;
      ep[i * 3] = Math.cos(a) * r; ep[i * 3 + 1] = 0.2 + Math.random() * 1.9; ep[i * 3 + 2] = Math.sin(a) * r;
    }
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    rec.embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xff6a1e, size: 0.045, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    grp.add(rec.embers);
    const glow = new THREE.PointLight(0xff5a1e, 0.8, 4, 2); glow.position.y = 1; grp.add(glow);
    grp.userData.ember = glow;
    aura('rgba(255,90,20,0.55)', 3.0, 1.1);
  }
  grp.visible = false;
  scene.add(grp);
  entityMeshes.set(e, rec);
  return rec;
}
// per-frame spectral motion + animation + facing
function animateGhost(rec, e, dt) {
  const t = performance.now() / 1000 + rec.phase;
  const hunt = e.state === Entities.S.HUNT;
  // face movement direction when moving, else face the player
  let yaw;
  if (e.moving) { const dirX = Math.cos(e.facing), dirZ = Math.sin(e.facing); yaw = Math.atan2(dirX, dirZ); }
  else { camera.getWorldPosition(tmpV2); yaw = Math.atan2(tmpV2.x - e.x * TILE_M, tmpV2.z - e.y * TILE_M); }
  rec.group.rotation.y = yaw + (rec.yaw || 0);

  if (rec.hasModel) {
    if (rec.mixer) {
      rec.mixer.update(dt);
      const want = !e.moving ? rec.clips.idle : (e.fast ? rec.clips.run : rec.clips.walk);
      if (want && rec.cur !== want) {
        const next = rec.mixer.clipAction(want);
        next.reset().fadeIn(0.22).play();
        if (rec.action) rec.action.fadeOut(0.22);
        rec.action = next; rec.cur = want;
      }
    }
    if (rec.aura) rec.aura.material.opacity = (hunt ? 0.6 : 0.32) + Math.sin(t * 5) * 0.1;
    if (rec.embers) rec.embers.rotation.y += dt * (hunt ? 3.5 : 1.2);
    return;
  }
  // shroud fallback: float, sway
  rec.group.position.y = Math.sin(t * (hunt ? 3.2 : 1.6)) * 0.07 + (e.kind === 'child' ? 0 : 0.05);
  rec.gown.forEach((m2, i) => { m2.rotation.y = Math.sin(t * 0.8 + i) * 0.15; m2.rotation.z = Math.sin(t * 1.1 + i * 2) * 0.05; });
  if (rec.aura) rec.aura.material.opacity = (hunt ? 0.6 : 0.35) + Math.sin(t * 5) * 0.12;
  if (rec.embers) rec.embers.rotation.y += dt * (hunt ? 3.5 : 1.2);
}

// ============================================================ entity audio
// Every one of the dead is HEARD in surround: cadenced footsteps panned to where
// it walks, its own voice when it idles nearby, ragged breathing when it is
// almost on top of you, and a directional shriek the instant a hunt begins.
const HUNT_LINES = {
  nurse: 'The Grey Nurse snaps her head toward you. Her round just changed.',
  nurse2: 'Down the ward, the Night Nurse goes very still — then starts toward you.',
  mose: 'A roar from Mose — heavy footsteps, faster than a man that size should be.',
  child: 'The Child stops singing. The skittering turns your way.',
  crawler: 'A wet hiss — the Crawler has your scent.',
  ash: 'The embers flare. The Ash begins to drift toward you, crackling.',
  ghoul: 'The gnawing stops. The Ghoul is done with the dead — it wants something fresher.',
  undead: 'The Risen lets out a broken moan and lurches into a run.',
};
// footstep cadence + weight per kind (interval seconds, volume multiplier)
const STEP_STYLE = {
  nurse: [0.52, 0.9], nurse2: [0.5, 0.9], mose: [0.62, 1.7], child: [0.3, 0.55],
  crawler: [0.17, 0.45], ghoul: [0.42, 1.1], undead: [0.48, 1.3], ash: [0, 0],   // the Ash doesn't step — it crackles
};
function panTo(e) {
  camera.getWorldDirection(tmpV2);
  const fYaw = Math.atan2(tmpV2.x, tmpV2.z);
  return Math.max(-1, Math.min(1, Math.sin(normAng(Math.atan2(e.x - player.x, e.y - player.y) - fYaw))));
}
let lightStaggerTaught = false;
function entitySounds(rec, e, dt, d) {
  if (d > 17) { rec.lastState = e.state; return; }
  const pan = panTo(e);
  const near = Math.max(0, 1 - d / 16);
  const hunt = e.state === Entities.S.HUNT;

  // --- the jump scare: the moment a hunt begins, it SCREAMS from its direction ---
  if (hunt && rec.lastState !== Entities.S.HUNT) {
    Audio2.screechPan(pan, 0.12 + near * 0.3);
    if (d < 8) {
      Audio2.stinger(false); haptic(0.9, 160);
      player.fear = Math.min(100, player.fear + 7 + near * 6);
      if (scareCooldown <= 0) { showSubtitle(HUNT_LINES[e.kind] || 'It has seen you. RUN.', 3); scareCooldown = 6; }
    }
  }
  rec.lastState = e.state;

  // --- cadenced footsteps, panned to where it walks ---
  const st = STEP_STYLE[e.kind] || [0.5, 1];
  if (e.moving && st[0] > 0) {
    rec.stepT -= dt * (hunt ? 1.8 : 1) * (e.kind === 'child' ? (e.fast ? 1.6 : 1) : 1);
    if (rec.stepT <= 0) {
      rec.stepT = st[0];
      Audio2.footstepPan(pan, (0.02 + near * 0.075) * st[1] * (hunt ? 1.35 : 1));
    }
  }

  // --- its voice, every few seconds, from its direction ---
  rec.voiceT -= dt * (hunt ? 1.7 : 1);
  if (rec.voiceT <= 0 && d < 14) {
    rec.voiceT = hunt ? 2.5 + Math.random() * 2 : 6 + Math.random() * 7;
    const v = 0.03 + near * 0.09;
    switch (e.kind) {
      case 'nurse': case 'nurse2': hunt ? Audio2.hissPan(pan, v) : Audio2.humPan(pan, v * 0.6); break;
      case 'child': Audio2.laughPan(pan, v); break;
      case 'mose': Audio2.growlPan(pan, v * 1.3); break;
      case 'crawler': Audio2.hissPan(pan, v); break;
      case 'ghoul': hunt ? Audio2.hissPan(pan, v) : Audio2.gnawPan(pan, v); break;
      case 'undead': Audio2.moanPan(pan, v * 1.2); break;
      case 'ash': Audio2.cracklePan(pan, v); break;
    }
  }

  // --- ragged breathing when it is almost on top of you ---
  if (d < 3.6 && !hunt) {
    rec.breathT -= dt;
    if (rec.breathT <= 0) { rec.breathT = 2.4 + Math.random() * 1.2; Audio2.breathPan(pan, 0.04 + (1 - d / 3.6) * 0.05); }
  }

  // --- the flashlight beam staggers a hunter (it hates the light) ---
  if (rec.beamCd > 0) rec.beamCd -= dt;
  if (hunt && player.lightOn && player.battery > 0 && rec.beamCd <= 0 && beamHits(e.x, e.y)) {
    rec.beamCd = 3.2;
    e.slow = 1.1;
    Audio2.hissPan(pan, 0.14 + near * 0.14);
    if (!lightStaggerTaught) { lightStaggerTaught = true; showSubtitle('The beam catches it — it flinches from the light. It won’t stop it for long.', 3.5); }
  }
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
  return [Math.abs(x) > 0.12 ? x : 0, Math.abs(y) > 0.12 ? y : 0];
}

function vrLocomotion(dt) {
  // heading = camera yaw in world
  camera.getWorldDirection(tmpV);
  const yaw = Math.atan2(tmpV.x, tmpV.z); // forward
  const moveSrc = OPTS.swapHands ? sources.right : sources.left;
  const turnSrc = OPTS.swapHands ? sources.left : sources.right;
  const [lx, ly] = readAxes(moveSrc);
  if (lx || ly) {
    const speed = 4.2;   // m/s — VR walking wants to feel a touch brisk
    // forward is -y stick; strafe is x. Right vector = yaw - 90° (was +90°: inverted!)
    const fwd = -ly, str = lx;
    const dz = (Math.cos(yaw) * fwd + Math.cos(yaw - Math.PI / 2) * str);
    const dx = (Math.sin(yaw) * fwd + Math.sin(yaw - Math.PI / 2) * str);
    const step = speed * dt / TILE_M;
    moveDolly(dx * step, dz * step);
  }
  // look-to-walk option: hold A/X (or either grip button 4/5) to glide where you look
  if (OPTS.walkLook) {
    const pressed = [sources.left, sources.right].some((c) => {
      const g = c && c.userData.inputSource && c.userData.inputSource.gamepad;
      return g && g.buttons && ((g.buttons[4] && g.buttons[4].pressed) || (g.buttons[5] && g.buttons[5].pressed));
    });
    if (pressed) {
      camera.getWorldDirection(tmpV);
      const l = Math.hypot(tmpV.x, tmpV.z) || 1;
      const step = 3.4 * dt / TILE_M;
      moveDolly((tmpV.x / l) * step, (tmpV.z / l) * step);
    }
  }
  // snap turn on the other stick's x
  const [rx] = readAxes(turnSrc);
  snapCooldown -= dt;
  if (Math.abs(rx) > 0.7 && snapCooldown <= 0) {
    snapTurn(rx > 0 ? -Math.PI / 6 : Math.PI / 6);
    snapCooldown = 0.3;
  }
}
function keysSprint() { return false; } // VR: no sprint stick button by default

function comfortBlink(strength) {   // brief vignette pulse to ease VR discomfort
  if (vignette) vignette.material.opacity = Math.max(vignette.material.opacity, strength);
}
function snapTurn(rad) {
  comfortBlink(0.75);
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
    if (k === 'l' && state === 'PLAY') Survival.toggleLantern();
    if ((k === 'enter' || k === ' ') && (state === 'DEAD' || state === 'WIN')) newGame();
    if ((k === 'enter' || k === ' ' || k === 'e') && state === 'CINE') skipCine();
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

function riteGateMet(gate) {
  if (!gate) return true;
  if (gate.obj) { const o = data.objectives.find((x) => x.id === gate.obj); if (!o || !o.done) return false; }
  if (gate.blessed && !Survival.state().blessed) return false;
  return true;
}
function pickupItem(it) {
  // --- Unbinding Rite: gated anchors + the censer ---
  if (it.type === 'anchor' || it.type === 'censer') {
    const anc = it.type === 'anchor' ? data.rite.anchors.find((a) => a.key === it.anchor) : null;
    if (it.type === 'anchor' && !riteGateMet(it.gate)) { showSubtitle(anc ? anc.gateHint : 'It won’t come loose yet.', 4); return; }
    it.taken = true; Audio2.pickup(); Audio2.whisper(0.5);
    const mesh0 = itemMeshes.get(it.id); if (mesh0) { floorGroup.remove(mesh0); itemMeshes.delete(it.id); }
    if (it.type === 'anchor') { player.rite[it.anchor] = true; showSubtitle((anc ? anc.took + ' ' : '') + 'A Spirit Anchor — carry it to the circle in the basement.', 5); }
    else { player.rite.censer = true; showSubtitle('The Matron’s Censer. Swing it over the altar once the four anchors are seated.', 5); }
    player.fear = Math.min(100, player.fear + 4);
    saveState();
    return;
  }
  if (['draught', 'backpack', 'medkit', 'teddy', 'battery', 'lantern'].includes(it.type)) {
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
function keyLabel(id) {
  return ({ key_mose: 'Room 3-East', key_incinerator: 'the Incinerator', key_roof: 'Roof Access',
    key_stairs0: 'the Basement Stairwell', key_stairs2: 'the 2nd-Floor Stairwell',
    key_stairs3: 'the Surgical Wing (3rd floor)', key_stairs4: 'the Attic Stair (4th floor)' })[id] || id;
}
const KEY_SHORT = { key_mose: '3E', key_incinerator: 'Incin', key_roof: 'Roof', key_stairs0: 'Bsmt', key_stairs2: 'Ward', key_stairs3: 'Surg', key_stairs4: 'Attic' };

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

// returns true if a ritual pedestal/altar was interacted with
function ritualInteract() {
  // seat a carried anchor onto its matching pedestal
  const near = ritual.nodes.find((nn) => Math.hypot(nn.tileX - player.x, nn.tileY - player.y) < 1.3);
  if (near) {
    if (near.filled) { showSubtitle('This anchor is already seated.', 2); return true; }
    if (player.rite[near.anchor]) { seatAnchor(near); return true; }
    // player is at a pedestal but doesn't hold the matching relic
    showSubtitle('An empty pedestal — it wants ' + near.name + '.', 3); return true;
  }
  if (!ritual.done && Math.hypot(ritual.altarTileX - player.x, ritual.altarTileY - player.y) < 1.6) {
    const seated = ritual.nodes.filter((nn) => nn.filled).length;
    if (seated < ritual.nodes.length) { showSubtitle('The circle is not whole. ' + seated + ' of ' + ritual.nodes.length + ' anchors seated.', 3); return true; }
    if (!player.rite.censer) { showSubtitle('The altar waits. You need the Matron’s Censer to let them go.', 3.5); return true; }
    performUnbinding(); return true;
  }
  return false;
}
function seatAnchor(n) {
  n.filled = true; player.rite[n.anchor] = false;
  if (n.token) n.token.visible = true;
  if (n.flame) n.flame.visible = true;
  if (n.light) n.light.intensity = 0.9;
  Audio2.pickup(); Audio2.whisper(0.6); Audio2.stinger(false);
  const c = ritual.nodes.filter((x) => x.filled).length;
  showSubtitle(n.name + ' settles onto the pedestal. (' + c + '/' + ritual.nodes.length + ')  The circle warms.', 3.4);
  player.fear = Math.min(100, player.fear + 3);
  saveState();
}
function performUnbinding() {
  ritual.done = true; riteClimax = true; Audio2.stinger(true);
  player.fear = Math.min(player.fear, 25);   // the circle steadies you for the working
  // Freeze every soul the instant the censer swings — nothing can take you now.
  spiritsFreed = true; childrenFreed = true;
  ents.forEach((e) => { e.state = Entities.S.DORMANT; e.wakeHour = 999; e.target = null; e.lastSeen = null; e.path = null; if (e.den) e.den = []; });
  // the censer swings — free them one after another, then the true dawn
  playLore('unbinding', () => {
    showSubtitle('One by one, the circle lets them go. The building exhales. It is finally empty.', 5);
    saveState();
    setTimeout(() => { if (state !== 'DEAD' && state !== 'WIN') trueEnding(); }, 6000);
  });
}

// the hospital was locked down ward by ward in '88 — each stairwell needs its key
const STAIR_KEYS = { 0: 'key_stairs0', 2: 'key_stairs2', 3: 'key_stairs3', 4: 'key_stairs4' };
const STAIR_HINTS = {
  0: 'The kitchen staff kept the basement key.',
  2: 'The ward keys were filed away in Records.',
  3: 'The surgical-wing key hung at the 2nd-floor nurses’ station.',
  4: 'The attic-stair key was left up in Recovery, 3rd floor.',
};
function changeFloor(dir) {
  const nf = Math.max(0, Math.min(4, player.floor + dir));
  if (nf === player.floor) return;
  const need = STAIR_KEYS[nf];
  if (need && !player.keys[need]) {
    Audio2.rattle(); Audio2.creak();
    showSubtitle('The stairwell door to ' + data.floors[nf].name.toLowerCase() + ' is locked. ' + STAIR_HINTS[nf], 4);
    return;
  }
  player.floor = nf;
  Audio2.creak();
  comfortBlink(1);   // black-blink the stair transition
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
  const dt = Math.min(clock.getDelta(), 0.1);   // tolerate frame dips without eating movement
  if (state === 'PLAY') update(dt);
  else if (state === 'CINE') { cineUpdate(dt); tickSubtitle(dt); vignette.material.opacity *= 0.995; }
  else if (state === 'MENU') { camera.position.set(0, EYE, 0); }
  spinItems(dt);
  renderer.render(scene, camera);
}

function spinItems(dt) {
  itemMeshes.forEach((g) => { if (g.userData.spin) { g.userData.spin.rotation.y += dt * 1.5; g.position.y = 1.1 + Math.sin(performance.now() / 400) * 0.08; } });
  candleLights.forEach((c) => { c.light.intensity = c.base * (0.75 + Math.random() * 0.35); });
  docMeshes.forEach((g) => { g.rotation.y += dt * 0.6; g.position.y = 1.0 + Math.sin(performance.now() / 500) * 0.06; });
  if (ritual && player && player.floor === ritual.floor) {
    ritual.nodes.forEach((n) => {
      if (n.filled) {
        if (n.light) n.light.intensity = 0.9 * (0.7 + Math.random() * 0.4);
        if (n.token) { n.token.rotation.y += dt * 1.2; n.token.position.y = 0.5 + Math.sin(performance.now() / 500) * 0.04; }
      }
    });
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
      if (f.light) f.light.intensity = f.on ? f.base * lightMul() : 0.05;
      if (flick && Math.random() < 0.4) Audio2.buzz(0.03);
    }
  }
  if (emberProp) emberProp.traverse((o) => { if (o.material && o.material.emissive && o.material.emissiveIntensity > 0.5) o.material.emissiveIntensity = 1.1 + Math.random() * 0.9; });
  for (const m of moodLights) {
    m.light.intensity = black ? 0 : m.base * lightMul() * (0.72 + Math.random() * 0.4);
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

function haptic(intensity, ms) {   // rumble both hands (VR only, fail-soft)
  [sources.left, sources.right].forEach((c) => {
    try {
      const g = c && c.userData.inputSource && c.userData.inputSource.gamepad;
      if (g && g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(intensity, ms);
    } catch (e) { }
  });
}
function powerSurge() {
  haptic(1, 220);
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
    player.battery = Math.max(0, player.battery - dt * (realMode ? 0.05 : 0.35));
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

  const grace = elapsed < graceUntil;
  updateOnboarding(dt);
  updateFear(dt, grace);
  updateWisp(dt);

  // entities
  const ctx = {
    hour, noise,
    playerLit: isPlayerLit(),
    peace: Survival.peaceActive() || grace,   // the dead keep to their dens during the grace
    diff: HAUNT[OPTS.haunt] || HAUNT.restless,
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
      if (!rec.hasModel) rec.group.position.set(e.x * TILE_M, 0, e.y * TILE_M);
      else { rec.group.position.x = e.x * TILE_M; rec.group.position.z = e.y * TILE_M; }
      if (e.kind === 'ash' && rec.group.userData.ember) rec.group.userData.ember.intensity = 0.5 + Math.random();
      animateGhost(rec, e, eDt);
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      entitySounds(rec, e, dt, d);
      nearest = Math.min(nearest, d);
      if (e.state === Entities.S.HUNT) hunting = true;
    } else if (entityMeshes.has(e)) {
      entityMeshes.get(e).group.visible = false;
    }
  });
  if (hunting && Math.random() < dt * 3) { Audio2.chase(true); haptic(0.5, 80); }
  if (nearest < 5) player.fear = Math.min(100, player.fear + (5 - nearest) * dt * 2.4);
  // one of the dead nearby makes the flashlight stutter — your own light warns you
  if (player.lightOn && player.battery > 0 && nearest < 4.5) {
    flashlight.intensity = 30 * flashFlicker * (0.35 + Math.random() * 0.65);
    if (Math.random() < dt * 1.6) Audio2.buzz(0.03);
  }
  if (player.inv.emf && nearest < 9 && Math.random() < dt * (2 + (5 - nearest / 9 * 5))) Audio2.emf(Math.max(1, Math.round(5 - nearest / 9 * 5)));

  updateSpiritObjective(dt);

  // your own footsteps — quiet, cadenced with movement (sprint = faster, louder)
  const isMoving = player.moving || (isVR && (readAxes(sources.left)[0] || readAxes(sources.left)[1]));
  if (isMoving && !player.hidden) {
    stepT -= dt;
    if (stepT <= 0) { stepT = player.sprinting ? 0.34 : 0.52; Audio2.footstep(player.sprinting ? 0.05 : 0.028); }
  } else stepT = 0.15;
  // crossing a doorway — the hinge complains
  const tNow = tileAt(player.floor, player.x, player.y);
  if (tNow === TILE.DOOR && lastTileType !== TILE.DOOR && Math.random() < 0.5) Audio2.creak();
  lastTileType = tNow;
  // dying flashlight panics once
  if (player.lightOn && player.battery < 20 && !lowBatWarned) { lowBatWarned = true; showSubtitle('The flashlight is dying. Find batteries — or learn the dark.', 3.5); }
  if (player.battery >= 45) lowBatWarned = false;

  // the backup lantern: warm 360° glow that follows you, flickering like flame
  if (!lanternLight) {
    lanternLight = new THREE.PointLight(0xffb45a, 0, 9, 2);
    scene.add(lanternLight);
  }
  const lantOn = Survival.lanternActive();
  if (lantOn) {
    camera.getWorldPosition(tmpV);
    lanternLight.position.set(tmpV.x, tmpV.y - 0.45, tmpV.z);
    lanternLight.intensity = 2.6 * (0.85 + Math.random() * 0.3);
  } else lanternLight.intensity = 0;
  // VR: clicking the move stick toggles the lantern
  const mvSrc = OPTS.swapHands ? sources.right : sources.left;
  const mg = mvSrc && mvSrc.userData.inputSource && mvSrc.userData.inputSource.gamepad;
  const stickBtn = mg && mg.buttons && mg.buttons[3] && mg.buttons[3].pressed;
  if (stickBtn && !stickBtnWas) Survival.toggleLantern();
  stickBtnWas = !!stickBtn;

  updateDust(dt);
  // flickering fixtures + animated toys + the haunted nursery + wall children
  updateFixtures(dt);
  animateProps(dt);
  nurseryUpdate(dt);
  updatePeekers(dt);
  Survival.update(dt, hour, realMode);
  if (riteClimax) player.fear = Math.min(player.fear, 40);   // the Rite holds the dread at bay
  if (player.fear >= 96 && !riteClimax) Survival.useMedkit();   // last-second mercy, if you carry one

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

  if (player.fear >= 100 && state === 'PLAY' && !riteClimax) { deathBy = deathBy || 'Your heart gave out.'; die(); }
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
  if (Survival.lanternActive()) return true;
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
function updateFear(dt, grace) {
  const lit = isPlayerLit();
  const night = 0.5 + Math.min(1, hour / 12) * 0.9;
  const rise = (realMode ? 0.7 : 2.2) * (grace ? 0.25 : 1);   // barely climbs while you settle in
  if (!lit) player.fear = Math.min(100, player.fear + dt * (rise * night));
  else player.fear = Math.max(0, player.fear - dt * (realMode ? 4.2 : 3.2));
  if (player.hidden) player.fear = Math.min(100, player.fear + dt * 1.4);
  if (nearCandle()) player.fear = Math.max(0, player.fear - dt * 5);
  if (grace) player.fear = Math.min(player.fear, 55);         // the grace can never kill you
}
// ---- the opening tutorial: a few clear lines while the night holds its breath ----
const ONBOARD = [
  'You’re inside. The flashlight is already in your hand — its beam is lit.',
  'Move with the left stick (WASD on desktop). Look with your head (mouse).',
  'Trigger / E picks things up and reads documents. Tab opens your Case File.',
  'Follow the pale wisp — it drifts toward whatever you must do next.',
  'Keep your light on — but know the dead can see its beam. Dark hides you; it also feeds fear.',
  'The dead still keep to their dens. In a minute the night turns. Follow the wisp. Survive till dawn.',
];
function updateOnboarding(dt) {
  if (onboardStep < 0 || onboardStep >= ONBOARD.length) return;
  onboardT -= dt;
  if (onboardT <= 0) {
    showSubtitle(ONBOARD[onboardStep], 4.6);
    onboardStep++; onboardT = 5.0;
    if (onboardStep >= ONBOARD.length) { onboardStep = -1;
      setTimeout(() => { if (state === 'PLAY') showSubtitle('The building knows you’re here now.', 3.5); }, 5200); }
  }
}
// ---- the guiding wisp: a faint spirit-light hovering toward your next task ----
function currentGoal() {
  if (ritual && ritual.done) { const r = data.floors[1].rooms.find((x) => x.tag === 'lobby'); return r ? { floor: 1, x: r.cx, y: r.cy, label: 'the front doors' } : null; }
  const o = data.objectives.find((x) => !x.done);
  if (!o) { const r = data.floors[1].rooms.find((x) => x.tag === 'lobby'); return r ? { floor: 1, x: r.cx, y: r.cy, label: 'the front doors' } : null; }
  const r = data.floors[o.floor].rooms.find((x) => x.tag === o.tag);
  return r ? { floor: o.floor, x: r.cx, y: r.cy, label: o.title } : null;
}
function updateWisp(dt) {
  if (!wisp) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, fog: false }));
    g.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(150,210,255,0.7)'), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(1.1, 1.1, 1); g.add(halo);
    const light = new THREE.PointLight(0x9fd4ff, 0.7, 4, 2); g.add(light);
    g.visible = false; scene.add(g);
    wisp = { g, core, halo, light, x: player.x, y: player.y, phase: 0 };
  }
  const goal = currentGoal();
  const onGoalFloor = goal && goal.floor === player.floor;
  // the wisp guides you from the very first moment — follow it to your next task
  const show = !!goal && state === 'PLAY';
  wisp.g.visible = show;
  if (!show) return;
  wisp.phase += dt;
  // drift toward a point a couple of tiles ahead of you in the goal's direction
  let tx, ty;
  if (onGoalFloor) { const dx = goal.x - player.x, dy = goal.y - player.y, len = Math.hypot(dx, dy) || 1;
    tx = player.x + (dx / len) * Math.min(3.0, len); ty = player.y + (dy / len) * Math.min(3.0, len);
  } else { // off-floor: hover over the nearest stairs pointing the way
    const st = nearestStairTile(); if (st) { tx = st.x; ty = st.y; } else { tx = player.x; ty = player.y; }
  }
  wisp.x += (tx - wisp.x) * Math.min(1, dt * 2.2);
  wisp.y += (ty - wisp.y) * Math.min(1, dt * 2.2);
  wisp.g.position.set(wisp.x * TILE_M, 1.5 + Math.sin(wisp.phase * 2) * 0.12, wisp.y * TILE_M);
  wisp.core.material.opacity = 0.8 + Math.sin(wisp.phase * 6) * 0.2;
  wisp.light.intensity = 0.6 + Math.sin(wisp.phase * 4) * 0.2;
}
function nearestStairTile() {
  const g = data.floors[player.floor].grid;
  const goal = currentGoal(); if (!goal) return null;
  const wantUp = goal.floor > player.floor;
  let best = null, bd = Infinity;
  for (let y = 0; y < World.H; y++) for (let x = 0; x < World.W; x++) {
    const t = g[y][x];
    if ((wantUp && t === TILE.UP) || (!wantUp && t === TILE.DOWN)) {
      const d = Math.hypot(x - player.x, y - player.y);
      if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
    }
  }
  return best;
}
function catchLine(e) {
  return ({
    nurse: 'The Grey Nurse reaches you. “You should have followed the rules.”',
    nurse2: 'The Night Nurse catches your wrist with cold fingers. “Back to bed. You’re not discharged.”',
    mose: 'Mose Blackburn’s shadow closes over you. He was never going to let you leave unheard.',
    child: 'The small cold hand finds yours and does not let go.',
    ash: 'The Ash folds around you. The fire finally has a name for you.',
    crawler: 'The Crawler is on you before you can turn — it was always faster than it looked.',
    ghoul: 'The Ghoul drags you down among the drawers. It has been so hungry, and so patient.',
    undead: 'The Risen gets its bloodied hands on you. Whatever it used to be, it only knows to pull you down now.',
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
  if (t === TILE.UP || t === TILE.DOWN) {
    const nf = Math.max(0, Math.min(4, player.floor + (t === TILE.UP ? 1 : -1)));
    const need = STAIR_KEYS[nf];
    if (need && !player.keys[need]) return 'Locked stairwell — needs the key to ' + keyLabel(need);
    return t === TILE.UP ? 'Trigger — climb the stairs up' : 'Trigger — descend the stairs';
  }
  if (t === TILE.HIDE) return player.hidden ? 'Trigger — leave hiding' : 'Trigger — hide here';
  if (t === TILE.EXIT) return 'Trigger — the chained front doors';
  const it = data.items.find((i) => !i.taken && i.floor === player.floor && Math.hypot(i.x + 0.5 - player.x, i.y + 0.5 - player.y) < 1.4);
  if (it) return 'Trigger — take the ' + itemDisplay(it);
  const doc = documents.find((d) => !d.found && d.floor === player.floor && Math.hypot(d.x + 0.5 - player.x, d.y + 0.5 - player.y) < 1.4);
  if (doc) return 'Trigger — read the ' + doc.type + ' (' + doc.title + ')';
  if (ritual && player.floor === ritual.floor) {
    const n = ritual.nodes.find((nn) => Math.hypot(nn.tileX - player.x, nn.tileY - player.y) < 1.3);
    if (n) return n.filled ? 'The ' + n.name + ' rests here' : (player.rite[n.anchor] ? 'Trigger — seat ' + n.name : 'Pedestal — needs ' + n.name);
    if (!ritual.done && Math.hypot(ritual.altarTileX - player.x, ritual.altarTileY - player.y) < 1.6) {
      const seated = ritual.nodes.filter((nn) => nn.filled).length;
      if (seated < ritual.nodes.length) return 'The altar — ' + seated + '/' + ritual.nodes.length + ' anchors seated';
      return player.rite.censer ? 'Trigger — perform the Unbinding Rite' : 'The altar — you need the Matron’s Censer';
    }
  }
  const o = objectiveHere();
  if (o && o.type === 'document') return 'Trigger — read';
  if (o && o.type === 'bell') return 'Trigger — ring the dawn bell';
  if (o && o.type === 'spiritbox') return 'Hold left grip — spirit box';
  const sp = Survival.interactPrompt();
  if (sp) return sp;
  return null;
}
function itemName(t) { return ({ flashlight: 'flashlight', battery: 'batteries', emf: 'EMF reader', spiritbox: 'spirit box', candlekit: 'candles', key: 'key', draught: 'Quiet Draught', backpack: 'backpack', medkit: 'medkit', teddy: 'teddy bear', anchor: 'Spirit Anchor', censer: 'Matron’s Censer' })[t] || t; }
function itemDisplay(it) { if (it.type === 'anchor') { const a = data.rite.anchors.find((x) => x.key === it.anchor); return a ? a.name : 'Spirit Anchor'; } return itemName(it.type); }

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
    Object.keys(player.keys).forEach((id) => bits.push('🗝' + (KEY_SHORT[id] || '')));
    // Unbinding Rite progress: seated/total, carried anchors, censer
    if (ritual && data.rite) {
      const rc = player.rite || {};
      const carried = data.rite.anchors.filter((a) => rc[a.key]).length;
      const seated = ritual.nodes.filter((n) => n.filled).length;
      if (seated || carried || rc.censer) bits.push('⚱ Rite ' + seated + '/' + ritual.nodes.length + (carried ? ' (+' + carried + ' held)' : '') + (rc.censer ? ' 🕯' : ''));
    }
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
function setBar(id, v) {
  const el = document.getElementById(id); if (!el) return;
  el.style.width = Math.max(0, Math.min(100, v)) + '%';
  if (id === 'battery-fill') el.style.background = v < 20 ? 'linear-gradient(90deg,#5a0000,#c41f1f)' : '';
}
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
// The true ending — reached by completing the Unbinding Rite (not just surviving).
function trueEnding() {
  if (state === 'WIN') return;
  riteClimax = false;
  state = 'WIN'; stopSpirit(); clearSave();
  const title = 'THE HOUSE IS EMPTY';
  if (isVR) showBigPanel(title, data.LORE.ending_true, '#bfeecf');
  else {
    const ws = document.getElementById('winscreen');
    const h2 = ws && ws.querySelector('h2'); if (h2) h2.textContent = title;
    const reason = ws && ws.querySelector('.reason'); if (reason) reason.textContent = 'You performed the Unbinding Rite and set every soul free.';
    const wl = document.getElementById('win-lore'); if (wl) wl.innerHTML = data.LORE.ending_true.map((l) => `<p>${l}</p>`).join('');
    ws.classList.add('show');
  }
  setTimeout(() => Audio2.suspend(), 8000);
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
