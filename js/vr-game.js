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
let dust = null, dustBase = null;
let stepT = 0, lastTileType = -1, lowBatWarned = false;
// player options (persisted): swapHands = move on right stick; walkLook = hold A/X to glide; bright = dim-lights mode
// fov = desktop field of view in degrees (a VR headset's FOV is fixed by its lenses)
const OPTS = Object.assign({ swapHands: false, walkLook: true, bright: true, haunt: 'restless', fov: 72, skipIntro: false },
  (() => { try { return JSON.parse(localStorage.getItem('collegehill_opts')) || {}; } catch (e) { return {}; } })());
// once you've walked up the hill once, the game remembers — so "skip the walk-up"
// can drop you straight inside with the lantern & knowledge you'd have gathered
function tutorialDone() { try { return localStorage.getItem('collegehill_tut_done') === '1'; } catch (e) { return false; } }
function setTutorialDone() { try { localStorage.setItem('collegehill_tut_done', '1'); } catch (e) { } }
// difficulty ("Haunt level"): scales the dead's speed, senses, and numbers
const HAUNT = {
  faint: { speedMul: 0.82, senseMul: 0.78, extra: false, label: 'FAINT' },
  restless: { speedMul: 1.0, senseMul: 1.0, extra: false, label: 'RESTLESS' },
  infested: { speedMul: 1.2, senseMul: 1.22, extra: true, label: 'INFESTED' },
};
const HAUNT_ORDER = ['faint', 'restless', 'infested'];
// the arsenal — declared up top because save validation runs at boot, before play
const WEAPONS = {
  crowbar: { name: 'Crowbar', model: 'crowbar', scale: 0.52, reach: 2.6, cone: 1.15, cd: 0.9, scare: 1.7, knock: 0.6, heavy: false },
  pipe: { name: 'Lead Pipe', model: 'w_pipe', scale: 0.6, reach: 2.7, cone: 1.1, cd: 0.9, scare: 1.7, knock: 0.7, heavy: false },
  bat: { name: 'Baseball Bat', model: 'w_bat', scale: 0.66, reach: 2.8, cone: 1.2, cd: 0.85, scare: 1.9, knock: 0.8, heavy: false },
  machete: { name: 'Machete', model: 'w_machete', scale: 0.5, reach: 2.4, cone: 1.0, cd: 0.7, scare: 1.3, knock: 0.4, heavy: false },
  cleaver: { name: 'Bone Cleaver', model: 'w_cleaver', scale: 0.34, reach: 2.2, cone: 0.95, cd: 0.65, scare: 1.2, knock: 0.35, heavy: false },
  axe: { name: 'Fire Axe', model: 'w_axe', scale: 0.62, reach: 2.7, cone: 1.1, cd: 1.05, scare: 2.4, knock: 1.0, heavy: true },
  sledge: { name: 'Sledgehammer', model: 'w_sledge', scale: 0.72, reach: 2.9, cone: 1.15, cd: 1.35, scare: 3.0, knock: 1.4, heavy: true },
};
const WEAPON_ORDER = ['crowbar', 'pipe', 'bat', 'machete', 'cleaver', 'axe', 'sledge'];
function saveOpts() { try { localStorage.setItem('collegehill_opts', JSON.stringify(OPTS)); } catch (e) { } }
const FOV_STEPS = [72, 85, 100, 110, 120];
function fovNow() { return Math.min(120, Math.max(60, OPTS.fov | 0 || 72)); }
function applyFov() { if (!camera) return; camera.fov = fovNow(); camera.updateProjectionMatrix(); }
let hemi = null, lanternLight = null, stickBtnWas = false;
let heldCross = null, brandishing = false, wardChimeT = 0, wardTaught = false;   // the defensive cross
let swingT = 0, swingCd = 0, weaponTaught = false, swingQueued = false;  // weapon swing state
let deskUseDown = false;   // desktop: left-mouse held (brandish / use)
// dropping things: tap = use/cycle, HOLD = let go. What you drop stays where it fell.
let dropSeq = 0, droppedLight = null;         // droppedLight: the flashlight item lying somewhere, maybe still lit
let aHoldT = 0, aDropped = false, bHoldT = 0, bDropped = false, xDownAt = 0, fDownAt = 0;
let fxMixers = [];   // animated set-piece FX (ritual flames, the glyph arch)
// the basement generator: crank it (LOUD) and the bottom two floors get what
// little power the 1988 lines still carry
let powerOn = false, crankT = 0, crankTick = 0, genRec = null, genHumOn = false, boilerWarned = false;
// THE SURGE: turning the power on wakes the basement. They chase until you bolt
// the stairwell door behind you, hide long enough, earn peace — or reach the
// Matron and put her between you and them.
let powerChase = false, chasers = [], surgeT = 0, lockWindowT = 0, chaserArriveT = 0, chaseRefreshT = 0, chaseHideT = 0, chaseFailT = 0, doorBolted = false, stairArrive = null;
// mirror trigger-scares: armed points that fire ONCE as you pass — a distant
// shatter down the hall, or the mirror beside you letting go of the wall
let scareTriggers = [], fallingMirrors = [], firedScares = new Set();
let phoneRang = false;   // the 3:33 AM payphone (once a night)
let fogWisps = [], atmoDrips = [], atmoShafts = [];   // drifting fog, ceiling drips, flickering light shafts
const WARD_RANGE = 6.5;
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
let doorMeshes = new Map();     // current floor: "x,y" -> hinged interactive door
let doorStates = new Map();     // visit-stable closed/open state: "floor:x,y" -> closed
let doorFloorIndices = new WeakMap(); // grid identity -> floor index (hot AI-path lookup)
let safePlayer = { floor: -1, x: 0, y: 0 }; // last collision-valid tracked-head position
let hideTiles = [], exitRec = null;
// entities.js updates every hunter, including those on floors that are not
// currently rendered. Current-floor collision follows the animated leaf;
// streamed-out floors follow their visit-stable door state (and locked tiles).
window.RuntimeDoorBlocked = (grid, x, y) => {
  if (!data || !grid) return false;
  let fi = doorFloorIndices.get(grid);
  if (fi === undefined) {
    fi = data.floors.findIndex((floor) => floor.grid === grid);
    if (fi < 0) return false;
    doorFloorIndices.set(grid, fi);
  }
  const tx = Math.floor(x), ty = Math.floor(y);
  if (player && fi === player.floor) {
    const liveDoor = doorMeshes.get(tx + ',' + ty);
    if (liveDoor) return !!liveDoor.blocked;
  }
  const tile = grid[ty] && grid[ty][tx];
  if (tile === TILE.LOCKED) return true;
  return tile === TILE.DOOR && doorStates.get(fi + ':' + tx + ',' + ty) === true;
};
let itemMeshes = new Map();     // item.id -> mesh
let entityMeshes = new Map();   // entity -> {group,...}
let candleLights = [];
let vignette;                   // comfort + fear ring attached to camera
let wristPanel, wristCtx, wristTex; // in-VR HUD
let bigPanel, bigCtx, bigTex;   // in-VR message/title panel

// ---- controllers ----
let controller1, controller2, grip1, grip2;
let sources = { left: null, right: null };
let snapCooldown = 0, prevBBtn = false;
let crouched = false, jumpY = 0, jumpVel = 0, prevStickMove = false, prevStickTurn = false, crouchLerp = 0;
let tripTimer = 1e9, tripping = false, tripT = 0, tripLen = 0, tripY = 0, sprintHold = 0;   // running wears you down; you go down every 20–45 min
let wristMenu = false, prevYBtn = false, wristMenuPanel = null, wristMenuCtx = null, wristMenuTex = null, wristMenuT = 0;
// the watch is a little touch screen: a face with icons you tap with your other
// hand's fingertip — 🎒 opens the pack, ⚙ opens settings, 🔦 flips your light
let watchView = 'watch', watchUsed = false, watchArmed = true, watchHover = -1, watchFaceT = 0;
const _tv1 = new THREE.Vector3(), _tv2 = new THREE.Vector3();

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
let interactTarget = null, deathBy = '', lastKiller = '';
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

  camera = new THREE.PerspectiveCamera(fovNow(), window.innerWidth / window.innerHeight, 0.05, 120);
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

  // NOTE: no asset loading here. The menu opens instantly; models and textures
  // load in staged groups when the player actually starts a night (prepareGame).
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
  if (!data || !player || state === 'MENU' || state === 'INTRO') return;
  const s = {
    v: 2, realMode, startEpoch,
    floor: player.floor, x: player.x, y: player.y,
    fear: player.fear, battery: player.battery, hasLight: player.hasLight, faith: player.faith,
    inv: player.inv, keys: player.keys, rite: player.rite, weapons: player.weapons, tool: player.tool,
    itemsTaken: data.items.filter((i) => i.taken && !i.dropped).map((i) => i.id),
    drops: data.items.filter((i) => i.dropped && !i.taken).map((i) => ({ floor: i.floor, x: i.x, y: i.y, type: i.type, id: i.id, kind: i.kind, lit: !!i.lit })),
    objectives: data.objectives.map((o) => o.done),
    objIds: data.objectives.map((o) => o.id),   // ids beside positions, so content edits can't silently remap truths
    docs: documents.filter((d) => d.found).map((d) => d.id),
    ritualFilled: ritual ? ritual.nodes.filter((n) => n.filled).map((n) => n.anchor) : [],
    ritualDone: !!(ritual && ritual.done),
    childrenFreed, spiritsFreed, powerOn, scares: [...firedScares], doorBolted,
    survival: (typeof Survival !== 'undefined') ? Survival.serialize() : undefined,
    finished: state === 'WIN' || state === 'DEAD',
  };
  // signed-in players get a private per-account save slot; guests use the shared one
  if (window.Accounts && Accounts.current()) { Accounts.saveGame(s); }
  else { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { } }
}
function loadSave() {
  let s = null;
  if (window.Accounts && Accounts.current()) s = Accounts.loadGame();
  else { try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }
  return validateSave(s);
}
// ---- the save boundary: never feed untrusted localStorage straight into the game ----
// A save that fails hard checks is QUARANTINED (kept under another key for
// recovery), not silently deleted — and never restored.
function validateSave(s) {
  const quarantine = () => {
    try { localStorage.setItem(SAVE_KEY + '_quarantine', JSON.stringify(s)); } catch (e) { }
    console.warn('save failed validation — quarantined');
    return null;
  };
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (typeof s.v === 'number' && s.v > 2) return quarantine();          // future schema — don't guess
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const fin = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!int(s.floor, 0, 4)) return quarantine();
  if (!fin(s.x, 0, World.W) || !fin(s.y, 0, World.H)) return quarantine();
  // soft fields: clamp / default rather than reject
  const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  s.fear = num(s.fear, 12, 0, 100); s.battery = num(s.battery, 100, 0, 100); s.faith = num(s.faith, 100, 0, 100);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  s.inv = obj(s.inv); s.keys = obj(s.keys); s.rite = obj(s.rite);
  const wIn = obj(s.weapons); s.weapons = {}; WEAPON_ORDER.forEach((k) => { if (wIn[k]) s.weapons[k] = true; });
  s.tool = (s.tool === 'cross' || s.weapons[s.tool]) ? s.tool : 'bare';
  const strs = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 64) : [];
  s.itemsTaken = strs(s.itemsTaken); s.docs = strs(s.docs); s.ritualFilled = strs(s.ritualFilled); s.scares = strs(s.scares);
  s.objectives = Array.isArray(s.objectives) ? s.objectives.map((b) => !!b) : [];
  const DROP_TYPES = { weapon: 1, ward: 1, flashlight: 1 };
  s.drops = (Array.isArray(s.drops) ? s.drops : []).filter((d) =>
    d && typeof d === 'object' && DROP_TYPES[d.type] && int(d.floor, 0, 4) &&
    fin(d.x, -1, World.W) && fin(d.y, -1, World.H) && typeof d.id === 'string' && d.id.length <= 48 &&
    (d.kind == null || WEAPONS[d.kind]));
  if (!Number.isFinite(s.startEpoch) || s.startEpoch > Date.now() + 60e3) s.startEpoch = Date.now();
  return s;
}
function clearSave() {
  if (window.Accounts && Accounts.current()) { Accounts.clearGame(); return; }
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
}

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
          'Left hand holds the <b>flashlight</b> (<b>B</b> toggles); right hand is your <b>tool hand</b> — press <b>A</b> to cycle bare → cross → weapons, then <b>squeeze the grip</b> to raise the cross or swing a weapon. Left stick walk (shove to run) · right stick snap-turn · trigger interact · hold left grip for the spirit box · tap your <b>watch</b> for pack & settings · click sticks to crouch / jump.';
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
        sources.leftGrip = (c === controller1) ? grip1 : grip2;
        // move the wrist HUD onto the actual left hand's grip
        if (wristPanel.parent) wristPanel.parent.remove(wristPanel);
        sources.leftGrip.add(wristPanel);
        dressGrip(sources.leftGrip, 'left');
      } else if (hand === 'right') {
        sources.right = c;
        sources.rightGrip = (c === controller1) ? grip1 : grip2;
        dressGrip(sources.rightGrip, 'right');
      }
      mountFlashlightHand();   // the light rides your off (move) hand; tools ride the dominant one
    });
    c.addEventListener('disconnected', () => { c.userData.inputSource = null; });
    c.addEventListener('selectstart', () => onTrigger(c));       // interact
    c.addEventListener('squeezestart', () => onSqueezeStart(c)); // flashlight / spirit
    c.addEventListener('squeezeend', () => onSqueezeEnd(c));
  });
}

function attachFlashlightTo(c) {
  if (!c) return;
  if (flashlight.parent) { flashlight.parent.remove(flashlight); flashlight.parent.remove(flashlight.target); }
  c.add(flashlight); c.add(flashlight.target);
  flashlight.position.set(0, 0, 0);
  flashlight.target.position.set(0, 0, -1);
}
// the flashlight lives in your OFF (move) hand so the dominant hand is free for
// the cross or a weapon — the two-handed loadout the whole system is built around
function mountFlashlightHand() {
  const off = OPTS.swapHands ? sources.right : sources.left;
  if (off) attachFlashlightTo(off);
}

function makeHandMesh() {
  const g = new THREE.Group();
  g.userData.fallbackHand = true;   // replaced by the real hand model once it loads
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

// A survivor's skin: mottled tone, grime worked into the pores, scuff streaks,
// and dried blood — someone who has spent all night in this building. Shared by
// both hands (the model ships untextured but carries clean UVs).
let survivorSkin = null;
function survivorSkinTex() {
  if (survivorSkin) return survivorSkin;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#c9a184'; x.fillRect(0, 0, 512, 512);          // base skin
  let s = 1234567; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 900; i++) {                                // mottling — living skin is never one colour
    const warm = rnd() < 0.5;
    x.fillStyle = warm ? `rgba(${170 + (rnd() * 40) | 0},${110 + (rnd() * 30) | 0},${85 + (rnd() * 25) | 0},0.08)`
                       : `rgba(${140 + (rnd() * 30) | 0},${95 + (rnd() * 25) | 0},${80 + (rnd() * 20) | 0},0.07)`;
    x.beginPath(); x.arc(rnd() * 512, rnd() * 512, 3 + rnd() * 22, 0, 6.283); x.fill();
  }
  for (let i = 0; i < 260; i++) {                                // grime worked into the creases
    x.fillStyle = `rgba(${40 + (rnd() * 30) | 0},${32 + (rnd() * 22) | 0},${26 + (rnd() * 16) | 0},${0.05 + rnd() * 0.09})`;
    x.beginPath(); x.ellipse(rnd() * 512, rnd() * 512, 2 + rnd() * 14, 1 + rnd() * 4, rnd() * 3.14, 0, 6.283); x.fill();
  }
  for (let i = 0; i < 46; i++) {                                 // scuffs and scratches
    const sx = rnd() * 512, sy = rnd() * 512, a = rnd() * 6.28, l = 8 + rnd() * 42;
    x.strokeStyle = rnd() < 0.4 ? `rgba(120,45,40,${0.18 + rnd() * 0.2})` : `rgba(90,70,60,${0.14 + rnd() * 0.16})`;
    x.lineWidth = 0.6 + rnd() * 1.6;
    x.beginPath(); x.moveTo(sx, sy);
    x.quadraticCurveTo(sx + Math.cos(a + 0.4) * l * 0.5, sy + Math.sin(a + 0.4) * l * 0.5, sx + Math.cos(a) * l, sy + Math.sin(a) * l); x.stroke();
  }
  for (let n = 0; n < 7; n++) {                                  // dried blood — a few spatters, clustered
    const bx = rnd() * 512, by = rnd() * 512;
    for (let i = 0; i < 14; i++) {
      const r2 = rnd() * 26;
      x.fillStyle = `rgba(${88 + (rnd() * 30) | 0},${14 + (rnd() * 12) | 0},${12 + (rnd() * 10) | 0},${0.22 + rnd() * 0.3})`;
      x.beginPath(); x.arc(bx + (rnd() - 0.5) * 2 * r2, by + (rnd() - 0.5) * 2 * r2, 0.7 + rnd() * 3.4, 0, 6.283); x.fill();
    }
  }
  survivorSkin = new THREE.CanvasTexture(c);
  if ('colorSpace' in survivorSkin) survivorSkin.colorSpace = THREE.SRGBColorSpace;
  survivorSkin.anisotropy = 4;
  return survivorSkin;
}

// Real first-person hands on the grips. The source model is one rig holding BOTH
// arms, so each grip gets a clone with the OTHER arm's bones collapsed to nothing
// (cheap, no clipping planes, skinning still valid). The wrist bone is anchored
// to the grip origin and the forearm aimed back along the controller.
function dressGrip(grip, hand) {
  const src = (window.HeroModels || {}).vrhands;
  if (!src || !grip || grip.userData.dressedHand === hand) return;
  for (let i = grip.children.length - 1; i >= 0; i--) {
    const ch = grip.children[i];
    if (ch.userData.fallbackHand || ch.userData.handDress) grip.remove(ch);
  }
  try {
    const m = skeletonClone(src);
    // NOTE: GLTFLoader sanitises bone names — 'hand.R_010' arrives as 'handR_010'
    const suff = hand === 'left' ? 'l' : 'r', other = hand === 'left' ? 'r' : 'l';
    let handBone = null, foreBone = null, idxBone = null, pnkBone = null;
    m.traverse((o) => {
      if (!o.isBone) return;
      const n = o.name.toLowerCase();
      if (n.includes('clavicle' + other) || n.includes('deltoid' + other) || n.includes('upper_arm' + other)) o.scale.setScalar(0.0001);   // vanish the other arm
      if (!handBone && n.includes('hand' + suff)) handBone = o;
      if (!foreBone && n.includes('forearm' + suff) && !n.includes('001') && !n.includes('end')) foreBone = o;
      if (!idxBone && n.includes('palm_index' + suff)) idxBone = o;
      if (!pnkBone && n.includes('palm_pinky' + suff)) pnkBone = o;
    });
    if (!handBone) return;
    m.updateMatrixWorld(true);
    // human scale: normalise the forearm (elbow→wrist) to ~26 cm
    const hp = handBone.getWorldPosition(new THREE.Vector3());
    const fp = (foreBone || handBone).getWorldPosition(new THREE.Vector3());
    m.scale.setScalar(0.26 / (hp.distanceTo(fp) || 1));
    m.updateMatrixWorld(true);
    // FULL-frame aim — aligning only the forearm axis leaves the roll to the bind
    // pose, which put the palm upside-down on a real Quest. Build a rig basis
    // (forearm + palm normal from the knuckle line) and map it onto how a hand
    // actually sits on a Touch controller: wrist forward of the elbow, palm
    // facing inward around the handle.
    const hp2 = handBone.getWorldPosition(new THREE.Vector3());
    const fp2 = (foreBone || handBone).getWorldPosition(new THREE.Vector3());
    const F = hp2.clone().sub(fp2).normalize();                    // elbow → wrist
    let N;
    if (idxBone && pnkBone) {
      const Kn = pnkBone.getWorldPosition(new THREE.Vector3())
        .sub(idxBone.getWorldPosition(new THREE.Vector3())).normalize();   // across the knuckles
      N = new THREE.Vector3().crossVectors(F, Kn).normalize();             // palm-ish normal
      if (hand === 'left') N.negate();                                     // mirrored side, mirrored normal
    } else N = new THREE.Vector3(0, 1, 0);
    const K2 = new THREE.Vector3().crossVectors(N, F).normalize();
    const N2 = new THREE.Vector3().crossVectors(F, K2).normalize();
    const mRig = new THREE.Matrix4().makeBasis(K2, N2, F);
    const Ft = new THREE.Vector3(0, 0.32, -0.95).normalize();              // forearm runs back-down to the elbow
    const NtR = new THREE.Vector3(hand === 'right' ? -1 : 1, 0.22, 0).normalize();   // palm wraps inward
    const Kt = new THREE.Vector3().crossVectors(NtR, Ft).normalize();
    const Nt2 = new THREE.Vector3().crossVectors(Ft, Kt).normalize();
    const mT = new THREE.Matrix4().makeBasis(Kt, Nt2, Ft);
    const q = new THREE.Quaternion().setFromRotationMatrix(mT.multiply(mRig.transpose()));
    m.quaternion.premultiply(q);
    m.updateMatrixWorld(true);
    m.position.sub(handBone.getWorldPosition(new THREE.Vector3()));   // wrist sits at the grip
    // the survivor's skin: mottled, grimy, scuffed, blood-flecked
    const skin = survivorSkinTex();
    m.traverse((o) => {
      if (!(o.isMesh && o.material)) return;
      o.material = o.material.clone();
      o.material.map = skin;
      o.material.bumpMap = skin; o.material.bumpScale = 0.6;   // scuffs & spatter get a hint of relief
      if (o.material.color) o.material.color.set(0xb8a293);    // let the texture carry the tone, graded down
      if (o.material.roughness != null) o.material.roughness = 0.82;
      if (o.material.metalness != null) o.material.metalness = 0.02;
      o.material.needsUpdate = true; o.frustumCulled = false;
    });
    // collect this hand's finger bones so the fingers can actually grip
    const fingers = [];
    m.traverse((o) => {
      if (!o.isBone) return;
      const n = o.name.toLowerCase();
      const fm = n.match(/(?:f_(index|middle|ring|pinky)|(thumb))0([123])([rl])_/);
      if (fm && fm[4] === suff && !n.includes('end')) {
        fingers.push({ b: o, rest: o.quaternion.clone(), finger: fm[1] || 'thumb', thumb: !!fm[2], seg: +fm[3] });
      }
    });
    const holder = new THREE.Group(); holder.userData.handDress = true;
    holder.add(m); grip.add(holder);
    // the left wrist wears an actual watch — the thing the wrist HUD lives on
    if (hand === 'left' && (window.HeroModels || {}).smartwatch) {
      const w = window.HeroModels.smartwatch.clone();
      let wb = new THREE.Box3().setFromObject(w);
      const wref = Math.max(wb.max.x - wb.min.x, wb.max.y - wb.min.y, wb.max.z - wb.min.z) || 1;
      w.scale.setScalar(0.055 / wref);
      wb = new THREE.Box3().setFromObject(w);
      const wc = wb.getCenter(new THREE.Vector3());
      w.position.sub(wc);
      w.position.add(new THREE.Vector3(0, 0.015, 0.02));   // sits on top of the wrist
      w.rotation.set(-Math.PI / 2.6, 0, 0);
      w.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.frustumCulled = false; } });
      holder.add(w);
    }
    grip.userData.dressedHand = hand;
    grip.userData.fingers = fingers;
    grip.userData.curl = { t: 0, g: 0 };
  } catch (e) { console.warn('hand dress failed:', e); }
}

// Fingers follow the controller: index curls with the trigger, the other three
// with the grip squeeze, the thumb tucks a little with either. Smoothed so the
// hand closes like a hand, not a switch.
const CURL_AXIS = new THREE.Vector3(1, 0, 0);
let CURL_SIGN = 1;
const _curlQ = new THREE.Quaternion();
function updateHands(dt) {
  [[sources.left, sources.leftGrip], [sources.right, sources.rightGrip]].forEach(([src, grip]) => {
    if (!grip || !grip.userData.fingers || !grip.userData.fingers.length) return;
    const gp = src && src.userData.inputSource && src.userData.inputSource.gamepad;
    const bv = (i) => { const b = gp && gp.buttons && gp.buttons[i]; return b ? (b.value != null ? b.value : (b.pressed ? 1 : 0)) : 0; };
    const cur = grip.userData.curl;
    cur.t += (bv(0) - cur.t) * Math.min(1, dt * 14);
    cur.g += (bv(1) - cur.g) * Math.min(1, dt * 14);
    const rest = 0.14;   // a hand at rest is never flat
    for (const f of grip.userData.fingers) {
      const amt = f.thumb ? rest + Math.max(cur.t, cur.g) * 0.4
        : f.finger === 'index' ? Math.max(rest, cur.t)
        : Math.max(rest, cur.g);
      const ang = amt * (f.thumb ? 0.5 : [0.6, 0.85, 0.7][f.seg - 1]) * CURL_SIGN;
      f.b.quaternion.copy(f.rest).multiply(_curlQ.setFromAxisAngle(CURL_AXIS, ang));
    }
  });
}

function skipCine() {
  // let returning players skip the walk-up — but never on a stray first-frame input
  if (!cine || (cine.intro && cine.intro.t < 1.5)) return;
  endCinematic();
}
function onTrigger(c) {
  if (state === 'INTRO') { introInteract(); return; }   // pick up / read / step through the doors
  if (state === 'DEAD' || state === 'WIN' || state === 'MENU') { restartFromPanel(); return; }
  if (state !== 'PLAY') return;
  if (c === sources.left && !interactTarget) { Survival.drink(); return; }  // left trigger: drink
  interact();
}
function onSqueezeStart(c) {
  if (state !== 'PLAY') return;
  const R = OPTS.swapHands ? sources.left : sources.right;
  const L = OPTS.swapHands ? sources.right : sources.left;
  // dominant grip USES whatever's in that hand: swing a weapon (cross brandish is
  // a held state, read live in wantsBrandish). Off grip = the spirit box.
  if (c === R) { if (currentWeapon()) swingQueued = true; }
  else if (c === L) startSpirit();
}
function onSqueezeEnd(c) {
  const L = OPTS.swapHands ? sources.right : sources.left;
  if (c === L) stopSpirit();
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
  const cv = document.createElement('canvas'); cv.width = 384; cv.height = 280;
  wristCtx = cv.getContext('2d');
  wristTex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: wristTex, transparent: true });
  wristPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 0.146), mat);
  wristPanel.position.set(0, 0.055, -0.055);
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
  const fb = document.getElementById('opt-fov');
  if (fb) {
    const paintF = () => { fb.textContent = '👁 FOV: ' + fovNow() + '°'; fb.classList.toggle('selected', fovNow() !== 72); };
    fb.onclick = () => {
      const i = FOV_STEPS.indexOf(fovNow());
      OPTS.fov = FOV_STEPS[(i + 1) % FOV_STEPS.length] || 72;
      saveOpts(); applyFov(); paintF();
    };
    paintF();
  }
  optBtn('opt-skip', 'skipIntro', (o) => '🚶 Walk-up: ' + (o.skipIntro ? 'SKIP (start inside)' : 'FULL'));
  optBtn('opt-bright', 'bright', (o) => '💡 Lights: ' + (o.bright ? 'DIM' : 'PITCH-DARK'));
  optBtn('opt-swap', 'swapHands', (o) => '🕹 Move stick: ' + (o.swapHands ? 'RIGHT' : 'LEFT'));
  optBtn('opt-walklook', 'walkLook', (o) => '👣 Hold X/Y (move hand) to walk: ' + (o.walkLook ? 'ON' : 'OFF'));
  on('btn-resume-save', () => {
    const s = loadSave(); if (!s) return;
    if (xrSupported) enterVR(s); else startDesktop(s);
  });
  bindAccountUI();
  bindMPUI();
}

// ---- account bar: sign in with phone + PIN, records, leaderboard ----
function refreshAcctBar() {
  const A = window.Accounts; if (!A) return;
  const phone = A.current();
  const status = document.getElementById('acct-status');
  const toggle = document.getElementById('acct-toggle');
  const signout = document.getElementById('acct-signout');
  const strip = document.getElementById('records-strip');
  const profLink = document.getElementById('acct-profile');
  if (phone) {
    const r = A.records() || {};
    if (status) status.innerHTML = 'Signed in as <b>' + A.maskPhone(phone) + '</b>';
    if (toggle) toggle.style.display = 'none';
    if (signout) signout.style.display = '';
    if (profLink) profLink.style.display = '';
    if (strip) strip.innerHTML = r.bestTimeSec
      ? 'Best survived: <b>' + A.fmtTime(r.bestTimeSec) + '</b> · Nights won: <b>' + (r.nightsSurvived || 0) + '</b> · Rites: <b>' + (r.ritesCompleted || 0) + '</b> · Deaths: <b>' + (r.deaths || 0) + '</b>'
      : 'No runs yet — survive the night and set your record.';
  } else {
    if (status) status.textContent = 'Not signed in (playing as guest)';
    if (toggle) toggle.style.display = '';
    if (signout) signout.style.display = 'none';
    if (profLink) profLink.style.display = 'none';
    if (strip) strip.innerHTML = '';
  }
  offerResume();   // the resume button follows the active account's save
}
function renderLeaderboard() {
  const A = window.Accounts; if (!A) return;
  const rows = A.leaderboard(); const me = A.current();
  const tb = document.querySelector('#lb-table tbody'); if (!tb) return;
  let h = '<tr><th class="rank">#</th><th>Player</th><th>Best time</th><th>Dawns</th><th>Rites</th><th>Deaths</th></tr>';
  if (!rows.length) h += '<tr><td colspan="6" style="color:#7a8590">No records yet. Be the first to survive.</td></tr>';
  rows.slice(0, 12).forEach((r, i) => {
    h += '<tr class="' + (r.phone === me ? 'me' : '') + '"><td class="rank">' + (i + 1) + '</td><td>' + r.mask +
      '</td><td>' + (r.best ? A.fmtTime(r.best) : '—') + '</td><td>' + r.nights + '</td><td>' + (r.rites ? '⚱' + r.rites : '—') + '</td><td>' + r.deaths + '</td></tr>';
  });
  tb.innerHTML = h;
}
// ---- the profile: every night you've played, and how it ended ----
function renderProfile() {
  const A = window.Accounts; if (!A || !A.current()) return;
  const r = A.records() || {}; const runs = A.history();
  const sum = document.getElementById('pf-sum');
  if (sum) sum.innerHTML =
    'Signed in as <b>' + A.maskPhone(A.current()) + '</b> · Longest night: <b>' + (r.bestTimeSec ? A.fmtTime(r.bestTimeSec) : '—') + '</b><br>' +
    'Dawns: <b>' + (r.nightsSurvived || 0) + '</b> · Rites completed: <b>' + (r.ritesCompleted || 0) + '</b> · Deaths: <b>' + (r.deaths || 0) + '</b> · Time inside: <b>' + A.fmtTime(r.totalPlaySec || 0) + '</b>';
  const tb = document.querySelector('#pf-table tbody'); if (!tb) return;
  let h = '<tr><th>Night</th><th>Outcome</th><th>Survived</th><th>Truths</th></tr>';
  if (!runs.length) h += '<tr><td colspan="4" style="color:#7a8590">No nights on record yet. The hospital is waiting.</td></tr>';
  runs.slice(0, 15).forEach((run) => {
    const when = new Date(run.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const out = run.out === 'death' ? '<span class="out-death">💀 Taken by ' + (run.by || 'the dark') + '</span>'
      : run.out === 'unbound' ? '<span class="out-unbound">⚱ The Unbinding — every soul freed</span>'
      : '<span class="out-dawn">🌅 Survived to dawn</span>';
    h += '<tr><td class="when">' + when + (run.mode === '24h' ? ' · 24H' : '') + '</td><td>' + out + '</td><td>' + A.fmtTime(run.sec) + '</td><td>' + (run.truths || 0) + '/4</td></tr>';
  });
  tb.innerHTML = h;
}
function bindAccountUI() {
  const A = window.Accounts; if (!A) return;
  const $ = (id) => document.getElementById(id);
  const panel = $('signin'), board = $('leaderboard'), prof = $('profile');
  const show = (el, on2) => el && el.classList.toggle('show', on2);
  if ($('acct-toggle')) $('acct-toggle').onclick = () => { show(board, false); show(prof, false); show(panel, !panel.classList.contains('show')); if ($('in-err')) $('in-err').textContent = ''; const ph = $('in-phone'); if (ph) ph.focus(); };
  if ($('in-cancel')) $('in-cancel').onclick = () => show(panel, false);
  if ($('acct-signout')) $('acct-signout').onclick = () => { A.signOut(); show(prof, false); refreshAcctBar(); };
  if ($('acct-board')) $('acct-board').onclick = () => { show(panel, false); show(prof, false); renderLeaderboard(); show(board, !board.classList.contains('show')); };
  if ($('lb-close')) $('lb-close').onclick = () => show(board, false);
  if ($('acct-profile')) $('acct-profile').onclick = () => { show(panel, false); show(board, false); renderProfile(); show(prof, !prof.classList.contains('show')); };
  if ($('pf-close')) $('pf-close').onclick = () => show(prof, false);
  const doSignIn = () => {
    const res = A.signIn($('in-phone').value, $('in-pin').value);
    if (!res.ok) { if ($('in-err')) $('in-err').textContent = res.err; return; }
    $('in-pin').value = '';
    show(panel, false); refreshAcctBar();
    showToast(res.isNew ? 'Account created. Your record starts tonight.' : 'Welcome back. Your night is where you left it.');
  };
  if ($('in-go')) $('in-go').onclick = doSignIn;
  if ($('in-pin')) $('in-pin').onkeydown = (e) => { if (e.key === 'Enter') doSignIn(); };
  refreshAcctBar();
}
function showToast(msg) {
  let t = document.getElementById('acct-toast');
  if (!t) { t = document.createElement('div'); t.id = 'acct-toast';
    t.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:50;background:rgba(10,12,18,.95);border:1px solid #2f8a55;color:#bfeecf;padding:10px 18px;border-radius:6px;font-size:14px;pointer-events:none;transition:opacity .4s';
    document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = '0'; }, 3200);
}
function setMode(v) {
  realMode = v;
  const n = document.getElementById('mode-night'), t = document.getElementById('mode-24');
  if (n) n.classList.toggle('selected', !v);
  if (t) t.classList.toggle('selected', v);
}

// ============================================================ staged boot
// prepareGame gates the start of a night on 'core' (+ 'intro' when the walk-up
// will play); 'cast' and 'props' stream in behind it and refresh the scene
// when they land. Called once per page — restarts reuse everything.
let prepPromise = null, texturesLoaded = false;
function prepareGame(saved) {
  if (prepPromise) return prepPromise;
  if (!texturesLoaded) { texturesLoaded = true; loadTextures(); }
  const introNeeded = !saved && !OPTS.skipIntro;
  const blocking = introNeeded ? ['core', 'intro'] : ['core'];
  Assets.onProgress(loadingTick);
  prepPromise = Assets.loadGroups(blocking).then(() => {
    // hands may have connected before the models arrived
    dressGrip(sources.leftGrip, 'left'); dressGrip(sources.rightGrip, 'right');
    // the rest of the hospital streams in while you climb the hill
    Assets.loadGroups(['cast']).then(castArrived);
    Assets.loadGroups(['props']).then(propsArrived);
  });
  return prepPromise;
}
// props landed mid-night: rebuild the current floor once so real furniture
// replaces the sparse first build (masked with a comfort blink)
function propsArrived() {
  if (state !== 'PLAY' || !data) return;
  const preferredX = player.x, preferredY = player.y;
  const stayHidden = player.hidden && hideSpot;
  comfortBlink(0.8);
  buildFloor(player.floor);
  if (stayHidden) placeDollyAtTile(hideSpot.x, hideSpot.y);
  else placeDollyAtNearestSafe(preferredX, preferredY);
}
// cast landed: drop any procedural fallback shrouds so the real apparitions
// take over on their next visible frame
function castArrived() {
  if (!ents) return;
  entityMeshes.forEach((rec, e) => {
    if (!rec.hasModel) { if (rec.group.parent) rec.group.parent.remove(rec.group); entityMeshes.delete(e); }
  });
  // set-pieces that need cast models and may have missed their floor build
  if (state === 'PLAY' && player && player.floor === 4 && !matronApp && !matronGone) {
    try { buildMatronApparition(4); } catch (e) { }
  }
}
// ---- loading screen (DOM on desktop; mirrored onto the big panel in VR) ----
let loadTickT = 0;
function showLoading() {
  const el = document.getElementById('loadscreen'); if (el) el.classList.add('show');
  loadingTick(0, 1);
}
function hideLoading() { const el = document.getElementById('loadscreen'); if (el) el.classList.remove('show'); }
function loadingTick(done, wanted) {
  const now = performance.now();
  if (now - loadTickT < 200) return; loadTickT = now;
  const p = Assets.progress();
  const pct = p.wanted ? Math.round((p.done / p.wanted) * 100) : 0;
  const fill = document.getElementById('load-fill'); if (fill) fill.style.width = pct + '%';
  const count = document.getElementById('load-count'); if (count) count.textContent = pct + '%';
  if (isVR && state === 'MENU') showBigPanel('OPENING THE HOSPITAL', ['The house is waking… ' + pct + '%'], '#cfd6de');
}

function enterVR(saved) {
  if (!navigator.xr) { startDesktop(saved); return; }
  Audio2.init(); Audio2.resume();
  const sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
  // the session request stays FIRST after the click — the user gesture must not
  // be spent waiting on downloads (WebXR would reject it)
  navigator.xr.requestSession('immersive-vr', sessionInit).then((session) => {
    isVR = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setSession(session);
    let sessionEnded = false;
    session.addEventListener('end', () => { isVR = false; sessionEnded = true; });
    wristPanel.visible = true;
    document.getElementById('vr-crosshair').style.display = 'none';
    showBigPanel('OPENING THE HOSPITAL', ['The house is waking…'], '#cfd6de');
    prepareGame(saved).then(() => {
      // taking the headset off mid-load aborts the start — never begin a night
      // behind a dead session
      if (!sessionEnded) newGame(saved);
    });
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
    'WASD move · Shift run · mouse look · Space jump · Z crouch · F flashlight · E interact · X cycle held item · hold LMB/R raise CROSS · LMB/G swing WEAPON · Q spirit box · C drink · V medkit · Tab case file · P pause';
  // desktop uses camera-mounted flashlight
  if (flashlight.parent !== camera) { flashlight.parent.remove(flashlight); flashlight.parent.remove(flashlight.target); camera.add(flashlight); camera.add(flashlight.target); flashlight.position.set(0.15, -0.05, 0); flashlight.target.position.set(0, 0, -1); }
  showLoading();
  prepareGame(saved).then(() => { hideLoading(); newGame(saved); });
}

function newGame(saved) {
  hideAllScreens();
  hideBigPanel();
  data = World.build();
  doorFloorIndices = new WeakMap();
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
    aim: 0, fear: 8, stamina: 100, battery: 100, faith: 100,
    // you START with the flashlight in your hand and lit — no fumbling in the dark
    hasLight: true, lightOn: true, hidden: false, inv: {}, keys: {}, rite: {},
    weapons: {}, tool: 'bare',   // the dominant-hand loadout: bare → cross → weapons
  };
  // A settling-in grace: for the first ~100s of a fresh night the dead stay in
  // their dens and won't hunt, fear can't kill, and the game teaches you.
  graceUntil = saved ? 0 : 100;
  onboardStep = saved ? -1 : 0; onboardT = saved ? 0 : 3;
  hour = 0; elapsed = 0; messages = []; spiritHold = 0; spiritActive = false; phoneRang = false; matronGone = false;
  deathBy = ''; lastKiller = ''; ambientEventTimer = 5; scareCooldown = 0; docPanelTimer = 0;
  nurseryActive = false; nurseryTimer = 0; nurseryMusicTimer = 3; surgeTimer = 20; blackoutUntil = 0;
  // clear set-piece state so a scare from a previous night can't bleed into this one
  morgueScared = false; carter = null; carterTimer = 50; fallingDebris = []; debrisKept = []; sceneAnims = []; riteClimax = false;
  dropSeq = 0; droppedLight = null; aHoldT = 0; aDropped = false; bHoldT = 0; bDropped = false; fxMixers = []; hideSpot = null; pausedAt = 0;
  powerOn = false; crankT = 0; genRec = null; boilerWarned = false; firedScares = new Set(); scareTriggers = []; fallingMirrors = [];
  powerChase = false; chasers = []; surgeT = 0; lockWindowT = 0; chaserArriveT = 0; chaseHideT = 0; doorBolted = false; stairArrive = null;
  doorStates.clear(); safePlayer.floor = -1;
  if (genHumOn) { genHumOn = false; Audio2.genHumStop(); }
  tripTimer = 1200 + Math.random() * 1500; tripping = false; tripT = 0; tripY = 0; sprintHold = 0;
  watchView = 'watch'; watchUsed = false; watchArmed = true; watchHover = -1;
  if (wristMenuPanel && wristMenuPanel.parent) wristMenuPanel.parent.remove(wristMenuPanel);
  data.objectives.forEach((o) => (o.done = false));

  if (saved) restoreFrom(saved); else { startEpoch = Date.now(); }

  buildFloor(player.floor);
  placeDollyAtNearestSafe(player.x, player.y);
  flashState = true;
  flashlight.visible = !!(player.hasLight && player.lightOn);
  state = 'PLAY';
  Audio2.startAmbient();
  if (realMode) requestWake();
  if (saved) { showSubtitle('You come back to yourself where you left off. It never left.', 4); saveState(); }
  else if (OPTS.skipIntro) {
    // straight inside, already carrying what the walk-up would have given you
    grantTutorialKit();
    graceUntil = 40;   // a shorter settle than a first-timer's 100 — you know the drill
    showSubtitle('You already know the way in. The chain’s off the door, the lantern’s on your belt — and they’re waiting.', 5);
    onboardStep = -1;   // no hand-holding for a veteran
    saveState();
  } else startCinematic();   // the walk up College Hill
}
// hand a skipping player the kit they'd have collected on the tutorial walk
function grantTutorialKit() {
  player.hasLight = true; player.lightOn = true; flashlight.visible = true;
  if (window.Survival && Survival.give) Survival.give('lantern');
}

function restoreFrom(s) {
  realMode = !!s.realMode;
  setMode(realMode);
  startEpoch = s.startEpoch || Date.now();
  player.floor = s.floor; player.x = s.x; player.y = s.y;
  player.fear = s.fear == null ? 12 : s.fear; player.battery = s.battery == null ? 100 : s.battery;
  player.faith = s.faith == null ? 100 : s.faith;
  player.hasLight = !!s.hasLight; player.lightOn = false;
  player.inv = s.inv || {}; player.keys = s.keys || {}; player.rite = s.rite || {};
  player.weapons = s.weapons || {}; player.tool = s.tool || 'bare';
  (s.itemsTaken || []).forEach((id) => { const it = data.items.find((i) => i.id === id); if (it) it.taken = true; });
  (s.drops || []).forEach((d) => {
    const it = Object.assign({ taken: false, dropped: true }, d);
    data.items.push(it);
    if (it.type === 'flashlight') droppedLight = it;
    dropSeq++;   // keep new drop ids unique past the restored ones
  });
  if (Array.isArray(s.objIds) && s.objIds.length === (s.objectives || []).length) {
    // restore by stable id — immune to objective reordering between versions
    s.objIds.forEach((id, i) => { const o = data.objectives.find((x) => x.id === id); if (o) o.done = !!s.objectives[i]; });
  } else (s.objectives || []).forEach((done, i) => { if (data.objectives[i]) data.objectives[i].done = done; });
  (s.docs || []).forEach((id) => { const d = documents.find((dd) => dd.id === id); if (d) d.found = true; });
  childrenFreed = !!s.childrenFreed; spiritsFreed = !!s.spiritsFreed;
  powerOn = !!s.powerOn; firedScares = new Set(s.scares || []); doorBolted = !!s.doorBolted;
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
  // ground — the hill itself. A displaced field of pine-needle forest floor:
  // gentle humps and hollows everywhere EXCEPT dead flat under the walk-up path
  // and in front of the facade, so the onboarding walk (and every hand-placed
  // prop near it) stays honest. Bias is upward: props sink into rises (reads
  // fine in the dark) instead of floating over hollows (never does).
  const gGeo = new THREE.PlaneGeometry(160, 160, 72, 72);
  {
    const pos = gGeo.attributes.position;
    const uv = gGeo.attributes.uv;
    let hs = 77003; const hr = () => { hs = (hs * 1103515245 + 12345) & 0x7fffffff; return hs / 0x7fffffff; };
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), ly = pos.getY(i);
      const wz = -40 - ly;   // world z after the -PI/2 tilt
      let h = Math.sin(lx * 0.11 + 1.7) * Math.sin(ly * 0.09 + 0.6) * 0.55
            + Math.sin(lx * 0.23 - 0.9) * Math.sin(ly * 0.21 + 2.2) * 0.30
            + (hr() - 0.5) * 0.10;
      h = Math.max(h * 0.4 + 0.1, -0.16);
      const offPath = Math.min(1, Math.max(0, (Math.abs(lx) - 2.6) / 5));
      const offDoor = Math.min(1, Math.max(0, (-wz - 7) / 7));
      pos.setZ(i, h * offPath * offDoor);
      // Absolute metre UVs keep the leaf/clay scale stable across the full
      // displaced mesh and line up with the hospital's horizontal surfaces.
      uv.setXY(i, (doorX + lx) / TILE_M, wz / TILE_M);
    }
    gGeo.computeVertexNormals();
    uv.needsUpdate = true;
  }
  const groundMat = TEX.groundMat || new THREE.MeshStandardMaterial({ map: TEX.groundForest, color: 0x596057, roughness: 1 });
  const gnd = new THREE.Mesh(gGeo, groundMat);
  gnd.rotation.x = -Math.PI / 2; gnd.position.set(doorX, -0.02, -40); g.add(gnd);
  // the worn dirt path everyone before you took, ending at a cracked concrete
  // apron below the front steps
  const path = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 48),
    new THREE.MeshStandardMaterial({ map: dirtPathTex(), transparent: true, depthWrite: false, roughness: 1 }));
  path.rotation.x = -Math.PI / 2; path.position.set(doorX, 0.015, -27.5); path.renderOrder = 1; g.add(path);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.2),
    new THREE.MeshStandardMaterial({ map: crackedApronTex(), color: 0x5e6165, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(doorX, 0.012, -2.0); g.add(apron);
  // facade
  const wallM = new THREE.MeshStandardMaterial({ map: TEX.wallD, color: 0x596068, roughness: .95 });
  const fac = new THREE.Mesh(new THREE.BoxGeometry(46, 15, 2), wallM);
  fac.position.set(doorX, 7.5, -1); g.add(fac);
  // window grid — every pane its own kind of dead: pitch black, faint cold,
  // boarded over. One alive and flickering. Deterministic per night.
  let wseed = 20517; const wrnd = () => { wseed = (wseed * 1103515245 + 12345) & 0x7fffffff; return wseed / 0x7fffffff; };
  const boardM = new THREE.MeshStandardMaterial({ color: 0x2e2118, roughness: 1 });
  let flickWin = null;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) {
    const alive = (r === 2 && c === 6);
    const wm = new THREE.MeshStandardMaterial({ color: 0x05070c, emissive: 0x0a1524, emissiveIntensity: 0.5 });
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2), wm);
    const wx2 = doorX - 20 + c * 5, wy2 = 3.4 + r * 3.4;
    w.position.set(wx2, wy2, 0.02);
    if (alive) { flickWin = w; wm.emissive.setHex(0x8a5a1a); }
    else {
      const roll = wrnd();
      if (roll < 0.35) wm.emissiveIntensity = 0.02;                                 // pitch dead
      else if (roll < 0.5) { wm.emissive.setHex(0x1a2434); wm.emissiveIntensity = 0.9; }   // faint cold glow
      if (roll > 0.72) {   // boarded over from the inside
        for (let bi = 0; bi < 3; bi++) {
          const bd = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 0.05), boardM);
          bd.position.set(wx2 + (wrnd() - 0.5) * 0.2, wy2 - 0.7 + bi * 0.7 + (wrnd() - 0.5) * 0.15, 0.08);
          bd.rotation.z = (wrnd() - 0.5) * 0.3;
          g.add(bd);
        }
      }
    }
    g.add(w);
  }
  // grime: decades of rain streaking down from every sill, mould pooling at the base
  const gc = document.createElement('canvas'); gc.width = 1024; gc.height = 512;
  const gx = gc.getContext('2d');
  for (let c = 0; c < 9; c++) for (let r = 0; r < 4; r++) {
    const sx2 = ((doorX - 20 + c * 5 - (doorX - 23)) / 46) * 1024, sy2 = 512 - ((3.4 + r * 3.4 - 1.1) / 15) * 512;
    for (let s = 0; s < 5; s++) {
      const off = (wrnd() - 0.5) * 26, len = 40 + wrnd() * 130, wdt = 2 + wrnd() * 6;
      const gr = gx.createLinearGradient(0, sy2, 0, sy2 + len);
      gr.addColorStop(0, 'rgba(10,10,12,' + (0.25 + wrnd() * 0.3) + ')'); gr.addColorStop(1, 'rgba(10,10,12,0)');
      gx.fillStyle = gr; gx.fillRect(sx2 + off - wdt / 2, sy2, wdt, len);
    }
  }
  for (let i = 0; i < 60; i++) {   // mould blooming up from the foundations
    gx.fillStyle = 'rgba(8,12,8,' + (0.10 + wrnd() * 0.2) + ')';
    gx.beginPath(); gx.arc(wrnd() * 1024, 512 - wrnd() * 60, 10 + wrnd() * 42, 0, 6.283); gx.fill();
  }
  const grimeT = new THREE.CanvasTexture(gc);
  const grime = new THREE.Mesh(new THREE.PlaneGeometry(46, 15),
    new THREE.MeshBasicMaterial({ map: grimeT, transparent: true, opacity: 0.85, depthWrite: false }));
  grime.position.set(doorX, 7.5, 0.04); g.add(grime);
  // the sign: COLLEGE HILL HOSPITAL, half its letters gone dark, one end sagging
  const sc3 = document.createElement('canvas'); sc3.width = 1024; sc3.height = 96;
  const sx3 = sc3.getContext('2d');
  sx3.fillStyle = '#14161a'; sx3.fillRect(0, 0, 1024, 96);
  sx3.strokeStyle = '#2a2d33'; sx3.lineWidth = 5; sx3.strokeRect(4, 4, 1016, 88);
  sx3.font = "64px 'IM Fell', 'Georgia', serif"; sx3.textAlign = 'center'; sx3.textBaseline = 'middle';
  const title = 'COLLEGE  HILL  HOSPITAL';
  let tx3 = 512 - sx3.measureText(title).width / 2;
  sx3.textAlign = 'left';
  for (const ch of title) {
    const dead = wrnd() < 0.28;
    sx3.fillStyle = dead ? '#23262b' : (wrnd() < 0.2 ? '#7a8188' : '#565d66');
    sx3.fillText(ch, tx3, 50);
    tx3 += sx3.measureText(ch).width;
  }
  // the real facade sign (generated aged enamel) when available; canvas fallback otherwise
  let signT, signW = 9.5, signH = 0.9;
  const genSign = signTex('college-hill-hospital-est-1928');
  if (genSign) { signT = genSign; signW = 8.2; signH = 2.05; }
  else { signT = new THREE.CanvasTexture(sc3); if ('colorSpace' in signT) signT.colorSpace = THREE.SRGBColorSpace; }
  const sign2 = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH),
    new THREE.MeshStandardMaterial({ map: signT, transparent: !!genSign, emissive: 0xffffff, emissiveMap: signT, emissiveIntensity: 0.14, roughness: 0.9 }));
  sign2.position.set(doorX, genSign ? 5.3 : 4.9, 0.1); sign2.rotation.z = -0.022;   // one bolt gave out years ago
  g.add(sign2);
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
  const mist = new THREE.Points(mg, new THREE.PointsMaterial({ map: softDotTex(), color: 0x8a93a0, size: 1.35, transparent: true, opacity: 0.09, depthWrite: false }));
  mist.frustumCulled = false; g.add(mist);
  // the children's playground you pass on the way up — swing set and carousel,
  // rusted still. In the wind, the carousel turns. Slowly. On its own.
  const mixers = [];
  const yard = (gltf, wx, wz, targetW, yaw, slow) => {
    if (!gltf || !gltf.scene) return;
    const m = skeletonClone(gltf.scene);
    let b = new THREE.Box3().setFromObject(m); const sz = b.getSize(new THREE.Vector3());
    const ref = Math.max(sz.x, sz.z) || 1; m.scale.setScalar(targetW / ref);
    b = new THREE.Box3().setFromObject(m); const c = b.getCenter(new THREE.Vector3());
    m.position.set(wx - c.x, -b.min.y - 0.02, wz - c.z); m.rotation.y = yaw;
    m.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.color) o.material.color.multiplyScalar(0.5); o.frustumCulled = false; } });
    if (gltf.animations && gltf.animations.length) {
      const mx = new THREE.AnimationMixer(m);
      const a = mx.clipAction(gltf.animations[0]); a.timeScale = slow; a.play();
      mixers.push(mx);
    }
    g.add(m);
  };
  const MOB = window.MobModels || {};
  yard(MOB.playgroundG, doorX - 13, -20, 7.5, 0.5, 0.5);
  yard(MOB.carouselG, doorX + 12, -27, 5.5, -0.4, 0.22);
  // dead oaks crowd the hillside — dark shapes either side of the path up
  const oakSrc = (window.HeroModels || {}).oaktrees;
  if (oakSrc) {
    [[-24, -14, 0.3, 6.2], [22, -22, 1.8, 7.0], [-19, -36, 3.6, 5.4], [27, -40, 5.1, 6.6], [-30, -46, 2.4, 7.4]].forEach(([ox, oz, yaw, sc]) => {
      const t = oakSrc.clone();
      let b = new THREE.Box3().setFromObject(t);
      const h = (b.max.y - b.min.y) || 1;
      t.scale.setScalar(sc / h);
      b = new THREE.Box3().setFromObject(t);
      const c2 = b.getCenter(new THREE.Vector3());
      t.position.set(doorX + ox - c2.x, -b.min.y - 0.05, oz - c2.z);
      t.rotation.y = yaw;
      t.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.color) o.material.color.multiplyScalar(0.32); o.frustumCulled = false; } });
      g.add(t);
    });
  }
  // the 1928 lampposts line the path — two dead for decades, and the last one,
  // nearest the doors, still sputtering off the same sick current as the window
  let liveLamp = null;
  const lampSrc = (window.HeroModels || {}).streetlamp;
  if (lampSrc) {
    [[-4.5, -32, false], [4.8, -18, false], [-4.2, -6, true]].forEach(([ox, oz, alive]) => {
      const lp = lampSrc.clone();
      let b = new THREE.Box3().setFromObject(lp);
      const h = (b.max.y - b.min.y) || 1;
      lp.scale.setScalar(3.6 / h);
      b = new THREE.Box3().setFromObject(lp);
      const c4 = b.getCenter(new THREE.Vector3());
      lp.position.set(doorX + ox - c4.x, -b.min.y, oz - c4.z);
      const emissives = [];
      lp.traverse((o) => {
        if (!(o.isMesh && o.material)) return;
        o.material = o.material.clone();
        if (o.material.emissive && (o.material.emissive.r + o.material.emissive.g + o.material.emissive.b) > 0.2) {
          if (alive) emissives.push(o.material);
          else { o.material.emissive.setHex(0x000000); if (o.material.color) o.material.color.setHex(0x1a1c20); }   // burnt out
        } else if (o.material.color) o.material.color.multiplyScalar(0.5);
      });
      if (alive) {
        const pl = new THREE.PointLight(0xffd9a0, 1.1, 13, 2);
        pl.position.set(doorX + ox, 3.3, oz);
        g.add(pl);
        liveLamp = { light: pl, mats: emissives, base: 1.1 };
      }
      g.add(lp);
    });
  }
  // forty years of neglect: wild grass in every crack, lichened boulders,
  // moss eating the ground — the hill taking its grounds back
  const scatter = (srcKey, spots, dark) => {
    const src = (window.HeroModels || {})[srcKey];
    if (!src) return;
    spots.forEach(([ox, oz, yaw, sc]) => {
      const it = src.clone();
      let b = new THREE.Box3().setFromObject(it);
      const ref = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) || 1;
      it.scale.setScalar(sc / ref);
      b = new THREE.Box3().setFromObject(it);
      const cc = b.getCenter(new THREE.Vector3());
      it.position.set(doorX + ox - cc.x, -b.min.y - 0.02, oz - cc.z);
      it.rotation.y = yaw;
      it.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.color) o.material.color.multiplyScalar(dark); o.frustumCulled = false; } });
      g.add(it);
    });
  };
  scatter('wildgrass', [[-3.8, -10, 0.4, 1.6], [4.4, -13, 2.1, 1.3], [-5.2, -24, 1.1, 1.5], [5.6, -29, 3.6, 1.7], [-4.6, -38, 5.2, 1.4],
    [3.9, -42, 0.9, 1.6], [-11, -17, 2.8, 1.8], [10, -21, 4.4, 1.5], [-15, -30, 1.7, 1.9], [14, -35, 3.1, 1.6], [7.5, -4, 5.6, 1.4], [-8.5, -5, 2.3, 1.7]], 0.42);
  scatter('mossrock', [[-7, -12, 0.7, 1.1], [8, -26, 2.4, 1.5], [-13, -34, 4.1, 0.8], [12, -9, 1.2, 1.3], [-9, -44, 3.3, 1.0], [16, -44, 5.0, 1.7]], 0.45);
  scatter('mosspatch', [[-5, -15, 1.0, 2.6], [6, -33, 2.9, 3.1], [-12, -27, 0.3, 2.8], [10, -14, 4.6, 2.4]], 0.5);
  // the hospital's transformer cabinet, rusted dead beside the doors
  const boxSrc = (window.HeroModels || {}).elecbox;
  if (boxSrc) {
    const eb = boxSrc.clone();
    let b = new THREE.Box3().setFromObject(eb);
    const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) || 1;
    eb.scale.setScalar(2.1 / w);
    b = new THREE.Box3().setFromObject(eb);
    const c3 = b.getCenter(new THREE.Vector3());
    eb.position.set(doorX + 17 - c3.x, -b.min.y, -2.6 - c3.z);
    eb.rotation.y = 0.15;
    eb.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.color) o.material.color.multiplyScalar(0.5); } });
    g.add(eb);
  }
  // a cold West Virginia night sky: a dome of stars and a low, hazy moon.
  // (procedural — a million-face scan would kill the Quest; this is ~free)
  const NS = 720, sp = new Float32Array(NS * 3), sc2 = new Float32Array(NS * 3);
  let seed = 481516; const srnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < NS; i++) {
    const az = srnd() * Math.PI * 2, el = 0.06 + Math.pow(srnd(), 0.7) * 1.45, R = 130;
    sp[i * 3] = doorX + Math.cos(az) * Math.cos(el) * R;
    sp[i * 3 + 1] = Math.sin(el) * R;
    sp[i * 3 + 2] = -20 + Math.sin(az) * Math.cos(el) * R;
    const warm = srnd() < 0.18, br = 0.55 + srnd() * 0.45;
    sc2[i * 3] = br * (warm ? 1 : 0.85); sc2[i * 3 + 1] = br * 0.9; sc2[i * 3 + 2] = br * (warm ? 0.75 : 1);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(sc2, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ map: softDotTex(), size: 1.4, vertexColors: true, transparent: true, opacity: 0.9, fog: false, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending }));
  stars.frustumCulled = false; g.add(stars);
  // the moon — a pale disc in a wide sick halo, low over the hill
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(190,200,220,0.55)'), transparent: true, opacity: 0.34, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  moonHalo.scale.set(34, 34, 1); moonHalo.position.set(doorX - 42, 46, -95); g.add(moonHalo);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(225,230,240,0.95)'), transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
  moon.scale.set(9, 9, 1); moon.position.copy(moonHalo.position); g.add(moon);
  // and the moon actually LIGHTS the hill — a thin cold wash so the building
  // and grounds read as shapes, not a void (this is what makes it creepy AF
  // instead of just black)
  const moonlight = new THREE.DirectionalLight(0x93a0c0, 0.85);
  moonlight.position.copy(moonHalo.position);
  const mlTarget = new THREE.Object3D(); mlTarget.position.set(doorX, 0, -12);
  g.add(mlTarget); moonlight.target = mlTarget; g.add(moonlight);
  // ---- the thing that lives on the grounds ----
  // You hear it circling in the dark. Then it sprints in and SLAMS the wall
  // beside the doors. It stays there, heaving, until you get close — and bolts.
  let runner = null;
  const runSrc = MOB.runner096;
  if (runSrc && runSrc.scene) {
    try {
      const model = skeletonClone(runSrc.scene);
      const mx = new THREE.AnimationMixer(model);
      const clip = (key) => runSrc.animations.find((a) => a.name.toLowerCase().includes(key)) || null;
      const acts = {
        run: clip('|running') || clip('running'),
        slam: clip('teslagatehit'),
        rage: clip('idle_rage') || clip('panic'),
      };
      Object.keys(acts).forEach((k) => { if (acts[k]) acts[k] = mx.clipAction(acts[k]); });
      model.updateMatrixWorld(true);
      let bb = new THREE.Box3().setFromObject(model, true);
      const bh = (bb.max.y - bb.min.y) || 1;
      model.scale.setScalar(1.75 / bh);   // crouched height — it is much longer than it is tall
      model.updateMatrixWorld(true);
      bb = new THREE.Box3().setFromObject(model, true);
      model.position.y = -bb.min.y;
      model.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.color) o.material.color.multiplyScalar(0.75); o.frustumCulled = false; } });
      const holder = new THREE.Group();
      holder.add(model); holder.visible = false;
      g.add(holder);
      runner = { obj: holder, mixer: mx, acts, phase: 'wait', pt: 0, stepT: 0, from: null, to: null, dur: 1 };
    } catch (e) { console.warn('runner build failed:', e); }
  }
  scene.add(g);
  return { g, doorX, flickWin, mist, mixers, stars, liveLamp, runner, shakeT: 0, t: 0, gustT: 1.5, cardI: 0 };
}
const CINE_CARDS = [
  [2, 'COLLEGE HILL', ['Williamson, West Virginia']],
  [9, '1928 — 1988', ['Four floors. A basement below them.', 'Never emptied.']],
  [17, 'THEY KNOW YOU ARE COMING', ['The chain on the doors will hold until dawn.']],
];
// ============================================================================
// The approach is now an INTERACTIVE onboarding walk. You climb College Hill
// yourself and, one prompt at a time, learn every control that keeps you alive:
//   0 WATCH      raise your wrist / open the pack   (Y  · Tab)
//   1 FLASHLIGHT thumb your light on in the dark    (B  · F)
//   2 LANTERN    walk to the gatepost, take it      (walk + Trigger/E)
//   3 NEWSPAPER  read the story of this place        (Trigger/E, then read)
//   4 LOG        vault the storm-felled oak          (stick-click · Space)
//   5 DOORS      climb the steps, go inside          (walk to the threshold)
// The runner circles the grounds and slams the wall mid-climb; the dead inside
// wake the instant the doors boom shut behind you.
const INTRO_CLIPPING = {
  title: 'THE WILLIAMSON DAILY — Oct. 1988',
  type: 'clipping',
  body: [
    'COLLEGE HILL HOSPITAL TO CLOSE AFTER SIXTY YEARS',
    'The county has ordered the doors of the Old Hospital chained by month’s end,',
    'ending six decades on the hill above town. Built in 1928 for the miners and',
    'their families, it saw the fever wards, the long tuberculosis winters — and,',
    'in its final years, the children’s wing on the fourth floor that staff would',
    'not speak of. “Some of them never went home,” a retiring nurse told this paper.',
    '“We kept the lamps lit on four. You learned not to ask who for.” Records for',
    'the west wing were never recovered. The building is to be sealed — not emptied.',
    '',
    '— and across the margin, in pencil, hard enough to tear the paper:',
    'THEY ARE STILL ON THE FOURTH FLOOR.  DON’T LET YOUR LIGHT GO OUT.',
  ],
};
function startCinematic() {
  cine = buildExterior();
  addIntroProps(cine);
  cine.intro = {
    step: 0, stepT: 0, t: 0, reprompt: 0, skipT: 0,
    inst: null, action: '',
    lanternTaken: false, noteReady: false, noteRead: false, loggedOver: false,
    runnerCue: 'wait', heldLantern: null, banner: null, climb: 0, panelT: 0,
  };
  state = 'INTRO';
  // you start with the light OFF — the very first lesson is finding its switch
  player.hasLight = true; player.lightOn = false; flashlight.visible = false;
  jumpY = 0; jumpVel = 0; crouched = false;
  // night air, not corridor air — outside you can see the building loom.
  fog.density = 0.02;
  Audio2.gust(0.2);
  // face the hospital: it sits at +z from the foot of the hill, so orient the
  // player toward it (VR turns the rig; desktop points the look-yaw up the path)
  if (isVR) { dolly.rotation.set(0, Math.PI, 0); desk.yaw = 0; }
  else { dolly.rotation.set(0, 0, 0); desk.yaw = Math.PI; }
  desk.pitch = 0;
  dolly.position.set(cine.doorX - camera.position.x, 0, -46 - camera.position.z);
  comfortBlink(1);
}

// ---- the props you meet on the way up: a lantern, a newspaper, a fallen oak ----
function buildHeldLantern() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2622, metalness: 0.6, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a1e16, emissive: 0x140c05, emissiveIntensity: 0.4, transparent: true, opacity: 0.55 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.03, 10), metal);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.11, 10), glass); body.position.y = 0.07;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.045, 0.03, 10), metal); cap.position.y = 0.135;
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 6, 12), metal); bail.position.y = 0.162; bail.rotation.x = Math.PI / 2;
  g.add(base, body, cap, bail);
  for (let i = 0; i < 4; i++) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.11, 5), metal); bar.position.set(Math.cos(i * 1.57) * 0.048, 0.07, Math.sin(i * 1.57) * 0.048); g.add(bar); }
  return g;
}
function addIntroProps(c) {
  const doorX = c.doorX, g = c.g;
  const metal = new THREE.MeshStandardMaterial({ color: 0x24201c, metalness: 0.5, roughness: 0.7 });
  // gatepost with a hanging storm lantern, glowing faintly to draw the eye
  const lx = doorX - 1.85, lz = -33;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.0, 0.18), new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.95 }));
  post.position.set(lx, 1.0, lz); post.rotation.z = 0.05; g.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.06), metal); arm.position.set(lx + 0.29, 1.85, lz); g.add(arm);
  const lant = buildHeldLantern(); lant.scale.setScalar(1.7); lant.position.set(lx + 0.55, 1.42, lz); g.add(lant);
  const lg = new THREE.PointLight(0xffb85a, 0.55, 4.5, 2); lg.position.set(lx + 0.55, 1.56, lz); g.add(lg);
  const lhalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(255,180,90,0.75)'), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  lhalo.scale.set(1.5, 1.5, 1); lhalo.position.copy(lg.position); g.add(lhalo);
  c._lantern = { wx: lx + 0.55, wz: lz, mesh: lant, light: lg, halo: lhalo };
  // a newspaper snagged against a rock, half-buried in leaves
  const nx = doorX + 1.1, nz = -23;
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5), new THREE.MeshStandardMaterial({ color: 0x3a3d3a, roughness: 1 }));
  rock.position.set(nx + 0.32, 0.2, nz); rock.scale.y = 0.6; g.add(rock);
  // the actual front page of the Williamson Daily, October 1988 (generated prop art)
  const paperMat = TEX.newsprint
    ? new THREE.MeshStandardMaterial({ map: TEX.newsprint, color: 0xd8d2c4, roughness: 1, side: THREE.DoubleSide, emissive: 0x36322a, emissiveIntensity: 0.35, emissiveMap: TEX.newsprint })
    : new THREE.MeshStandardMaterial({ color: 0xb8b09a, roughness: 1, side: THREE.DoubleSide, emissive: 0x2a2820, emissiveIntensity: 0.25 });
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.62), paperMat);
  paper.position.set(nx, 0.42, nz); paper.rotation.set(-0.7, 0.4, 0.15); g.add(paper);
  const nhalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(205,214,230,0.55)'), transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending }));
  nhalo.scale.set(1.15, 1.15, 1); nhalo.position.set(nx, 0.5, nz); g.add(nhalo);
  c._note = { wx: nx, wz: nz, mesh: paper, halo: nhalo };
  // a storm-felled oak lying across the path — you jump this
  const logZ = -14;
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 11, 12), new THREE.MeshStandardMaterial({ map: TEX.doorD, color: 0x4a3a28, roughness: 1 }));
  log.rotation.z = Math.PI / 2; log.rotation.y = 0.04; log.position.set(doorX, 0.42, logZ); g.add(log);
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.5, 8), new THREE.MeshStandardMaterial({ color: 0x3a2e20, roughness: 1 }));
  branch.position.set(doorX - 2.3, 0.55, logZ + 0.5); branch.rotation.set(0.4, 0, 1.2); g.add(branch);
  c._log = { z: logZ, mesh: log };
}

// ---- a cross-platform prompt banner floating low in front of you (VR + desktop) ----
function introWrap(ctx, text, maxW) {
  const words = String(text).split(' '); const lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function introBanner(inst, action) {
  const c = cine; if (!c) return;
  if (!c.intro.banner) {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
    const ctx = cv.getContext('2d'); const tex = new THREE.CanvasTexture(cv);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.23), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0.98 }));
    mesh.position.set(0, -0.42, -1.15); mesh.renderOrder = 1200; camera.add(mesh);
    c.intro.banner = { mesh, ctx, tex };
  }
  const b = c.intro.banner, ctx = b.ctx;
  ctx.clearRect(0, 0, 1024, 256);
  ctx.fillStyle = 'rgba(6,8,12,0.82)'; ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = 'rgba(201,162,74,0.5)'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, 1012, 244);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = "40px 'Special Elite', monospace"; ctx.fillStyle = '#e7edf2';
  const lines = introWrap(ctx, inst, 940).slice(0, 2);
  const startY = action ? 66 : (lines.length > 1 ? 98 : 128);
  lines.forEach((l, i) => ctx.fillText(l, 512, startY + i * 46));
  if (action) { ctx.fillStyle = '#ffcf6a'; ctx.font = "44px 'Special Elite', monospace"; ctx.fillText(action, 512, 198); }
  b.tex.needsUpdate = true; b.mesh.visible = true;
}
function setPrompt(inst, action) {
  const I = cine.intro; action = action || '';
  if (inst === I.inst && action === I.action) return;
  I.inst = inst; I.action = action; introBanner(inst, action);
}

function introUpdate(dt) {
  const c = cine; if (!c) return;
  const I = c.intro; c.t += dt; I.t += dt;
  // desktop look rides the mouse; VR look is the headset itself
  if (!isVR) { camera.rotation.order = 'YXZ'; camera.rotation.y = desk.yaw; camera.rotation.x = desk.pitch; camera.position.set(0, EYE, 0); }
  introLocomotion(dt);
  // jump arc (shared with the interior)
  if (jumpY > 0) { jumpY += jumpVel * dt; jumpVel -= 9.6 * dt; if (jumpY <= 0) { jumpY = 0; jumpVel = 0; Audio2.thud(0.12); } }
  // climb the front steps near the doors
  camera.getWorldPosition(tmpV);
  I.climb = (I.step >= 5 && tmpV.z > -0.4) ? Math.min(0.55, (tmpV.z + 0.4) * 0.5) : Math.max(0, I.climb - dt);
  dolly.position.y = jumpY + I.climb;
  introAmbient(dt);
  introRunner(dt);
  introSteps(dt);
  // story panels (opening card, the newspaper in VR) fade themselves out
  if (I.panelT > 0) { I.panelT -= dt; if (I.panelT <= 0) hideBigPanel(); }
  vignette.material.opacity *= 0.985;
}

function introAmbient(dt) {
  const c = cine;
  if (c.flickWin) c.flickWin.material.emissiveIntensity = Math.random() < 0.06 ? 0.05 : 0.5 + Math.random() * 0.5;
  if (c.mixers) c.mixers.forEach((m) => m.update(dt));
  if (c.stars) c.stars.material.opacity = 0.82 + Math.sin(c.t * 0.7) * 0.08 + Math.sin(c.t * 2.3) * 0.04;
  if (c.liveLamp) {
    const on = Math.random() < 0.94, k = on ? (0.6 + Math.random() * 0.6) : 0.04;
    c.liveLamp.light.intensity = c.liveLamp.base * k;
    c.liveLamp.mats.forEach((m2) => { m2.emissiveIntensity = on ? 0.7 + Math.random() * 0.5 : 0.03; });
  }
  if (c._lantern && !c.intro.lanternTaken) { c._lantern.light.intensity = 0.45 + Math.sin(c.t * 3) * 0.12; c._lantern.mesh.rotation.z = Math.sin(c.t * 0.9) * 0.05; }
  c.mist.position.x = Math.sin(c.t * 0.15) * 2;
  c.gustT -= dt;
  if (c.gustT <= 0) { c.gustT = 4 + Math.random() * 4; Audio2.gust(0.1 + Math.random() * 0.12); if (Math.random() < 0.3) Audio2.creak(); }
  if (c.shakeT > 0) { c.shakeT -= dt; const a = Math.max(0, c.shakeT / 0.55) * 0.05; dolly.position.x += (Math.random() - 0.5) * a; }
}

function introLocomotion(dt) {
  const c = cine;
  if (isVR) { updateHands(dt); updateWatch(dt);
    watchFaceT += dt; if (watchFaceT > 0.2 && data) { watchFaceT = 0; if (watchView === 'watch') drawWrist(data.objectives.filter((o) => o.done).length); } }
  camera.getWorldDirection(tmpV);
  const yaw = Math.atan2(tmpV.x, tmpV.z);
  let fwd = 0, str = 0;
  if (isVR) { const [lx, ly] = readAxes(OPTS.swapHands ? sources.right : sources.left); fwd = -ly; str = lx; }
  else { if (keys['w'] || keys['arrowup']) fwd += 1; if (keys['s'] || keys['arrowdown']) fwd -= 1; if (keys['a'] || keys['arrowleft']) str -= 1; if (keys['d'] || keys['arrowright']) str += 1; }
  let moved = false;
  if (fwd || str) {
    const speed = 3.2;
    const dz = Math.cos(yaw) * fwd + Math.cos(yaw - Math.PI / 2) * str;
    const dx = Math.sin(yaw) * fwd + Math.sin(yaw - Math.PI / 2) * str;
    const len = Math.hypot(dx, dz) || 1;
    introWalk((dx / len) * speed * dt, (dz / len) * speed * dt); moved = true;
  }
  // VR hold-to-walk (X on the move hand)
  if (isVR && OPTS.walkLook) {
    const ms = OPTS.swapHands ? sources.right : sources.left;
    const gp = ms && ms.userData.inputSource && ms.userData.inputSource.gamepad;
    if (gp && gp.buttons && gp.buttons[4] && gp.buttons[4].pressed) {
      camera.getWorldDirection(tmpV); const l = Math.hypot(tmpV.x, tmpV.z) || 1;
      introWalk((tmpV.x / l) * 3.0 * dt, (tmpV.z / l) * 3.0 * dt); moved = true;
    }
  }
  if (isVR) {   // snap-turn so they can orient on the hill
    const ts = OPTS.swapHands ? sources.left : sources.right;
    const [rx] = readAxes(ts); snapCooldown -= dt;
    if (Math.abs(rx) > 0.7 && snapCooldown <= 0) { snapTurn(rx > 0 ? -Math.PI / 6 : Math.PI / 6); snapCooldown = 0.3; }
    // deliberate skip: hold BOTH grips for a second (never a stray tap)
    const lg = sources.left && sources.left.userData.inputSource && sources.left.userData.inputSource.gamepad;
    const rg = sources.right && sources.right.userData.inputSource && sources.right.userData.inputSource.gamepad;
    const bothSq = lg && rg && lg.buttons[1] && rg.buttons[1] && lg.buttons[1].pressed && rg.buttons[1].pressed;
    c.intro.skipT = bothSq ? c.intro.skipT + dt : 0;
    if (c.intro.skipT > 1.0) skipCine();
    // the same buttons the interior uses, so the lessons transfer: Y watch, B light, stick-click jump
    const moveHand = OPTS.swapHands ? sources.right : sources.left;
    const gM = moveHand && moveHand.userData.inputSource && moveHand.userData.inputSource.gamepad;   // move hand
    const gT = ts && ts.userData.inputSource && ts.userData.inputSource.gamepad;   // turn hand
    const yNow = !!(gM && gM.buttons && gM.buttons[5] && gM.buttons[5].pressed);
    if (yNow && !prevYBtn) toggleWristMenu();
    prevYBtn = yNow;
    const bNow = !!(gT && gT.buttons && gT.buttons[5] && gT.buttons[5].pressed);
    if (bNow && !prevBBtn) toggleFlash();
    prevBBtn = bNow;
    const stNow = !!(gT && gT.buttons && gT.buttons[3] && gT.buttons[3].pressed);
    if (stNow && !prevStickTurn && jumpY <= 0) { jumpVel = 2.7; jumpY = 0.001; }   // enough apex to clear the fallen oak
    prevStickTurn = stNow;
  }
  player.moving = moved;
  if (moved) { stepT -= dt; if (stepT <= 0) { stepT = 0.5; Audio2.footstep(0.03); } } else stepT = 0.15;
}
function introWalk(dxW, dzW) {
  const c = cine, doorX = c.doorX;
  camera.getWorldPosition(tmpV);
  const px = tmpV.x, pz = tmpV.z;
  let nx = Math.max(doorX - 7, Math.min(doorX + 7, px + dxW));
  let nz = Math.max(-48, Math.min(1.15, pz + dzW));
  // the fallen oak blocks the path unless you're airborne over it (both platforms
  // clear it: desktop apex ≈0.38 m, VR ≈0.35 m, gate at 0.24)
  const L = c._log;
  if (L && jumpY < 0.24) { const band = 0.55; if (pz <= L.z - band && nz > L.z - band) nz = L.z - band; }
  dolly.position.x += (nx - px);
  dolly.position.z += (nz - pz);
}

function introSteps(dt) {
  const c = cine, I = c.intro;
  camera.getWorldPosition(tmpV);
  const px = tmpV.x, pz = tmpV.z, doorX = c.doorX;
  const A_TRIG = isVR ? '▶ Trigger' : 'E';
  switch (I.step) {
    case 0:   // WATCH
      if (I.stepT === 0) { I.stepT = 1; showBigPanel(CINE_CARDS[0][1], CINE_CARDS[0][2], '#cfd6de'); I.panelT = 4.5;
        setPrompt(isVR ? 'Turn up your left wrist and tap an icon on your watch' : 'Check your watch — the hour, and everything in your pack',
          isVR ? 'Tap it  ·  or press Y' : 'Press TAB'); }
      if ((isVR && watchUsed) || (!isVR && journalOpen)) { hideBigPanel(); introSetStep(1); }
      break;
    case 1:   // FLASHLIGHT
      if (I.stepT === 0) { I.stepT = 1; setPrompt(isVR ? 'Pitch dark on the hill. Thumb your flashlight ON' : 'It is pitch dark. Switch your flashlight ON', isVR ? '▶ Press B' : 'Press F'); }
      if (player.lightOn && player.battery > 0) { Audio2.buzz(0.04); introSetStep(2); }
      break;
    case 2:   // WALK to the lantern
      if (I.stepT === 0) { I.stepT = 1; c.intro.runnerCue = 'distant';
        setPrompt('A storm lantern hangs on the gatepost ahead. Walk to it', isVR ? 'Left stick to move' : 'W / arrow keys'); }
      if (!I.lanternTaken && Math.hypot(px - c._lantern.wx, pz - c._lantern.wz) < 2.6)
        setPrompt('A storm lantern hangs on the gatepost ahead. Walk to it', A_TRIG + ' — take the lantern');
      if (I.lanternTaken) introSetStep(3);
      break;
    case 3:   // NEWSPAPER
      if (I.stepT === 0) { I.stepT = 1; I.noteReady = true;
        setPrompt('No matches — you’ll light it inside. Keep climbing. Something pale is snagged on the rocks', 'Keep going'); }
      if (!I.noteRead && Math.hypot(px - c._note.wx, pz - c._note.wz) < 2.6)
        setPrompt('A newspaper, caught against a stone', A_TRIG + ' — pick it up and read');
      if (I.noteRead) introSetStep(4);
      break;
    case 4:   // JUMP the log
      if (I.stepT === 0) { I.stepT = 1; c.intro.runnerCue = 'charge';
        setPrompt('A storm-felled oak lies across the path. JUMP it', isVR ? 'Click the right stick' : 'Press SPACE'); }
      if (pz > c._log.z + 0.35) { I.loggedOver = true; introSetStep(5); }
      break;
    case 5:   // DOORS
      if (I.stepT === 0) { I.stepT = 1; c.intro.runnerCue = 'flee'; setPrompt('The doors wait at the top of the steps. Go inside', ''); }
      if (pz > -1.5 && Math.abs(px - doorX) < 2.3) setPrompt('The doors wait at the top of the steps', A_TRIG + ' — push through');
      if (pz > 0.35 && Math.abs(px - doorX) < 2.5) endCinematic();
      break;
  }
}
function introSetStep(n) { const I = cine.intro; I.step = n; I.stepT = 0; I.inst = null; I.action = ''; }

function introInteract() {
  const c = cine; if (!c) return;
  const I = c.intro;
  camera.getWorldPosition(tmpV); const px = tmpV.x, pz = tmpV.z;
  if (!I.lanternTaken && c._lantern && Math.hypot(px - c._lantern.wx, pz - c._lantern.wz) < 2.8) {
    I.lanternTaken = true; Audio2.pickup(); Audio2.whisper(0.3);
    [c._lantern.mesh, c._lantern.light, c._lantern.halo].forEach((o) => { if (o && o.parent) o.parent.remove(o); });
    mountHeldLantern();
    setPrompt('A dented storm lantern, still full of oil — but not a match on you. The kitchen will have some', '');
    return;
  }
  if (I.noteReady && !I.noteRead && c._note && Math.hypot(px - c._note.wx, pz - c._note.wz) < 2.8) {
    I.noteRead = true; Audio2.pickup();
    [c._note.mesh, c._note.halo].forEach((o) => { if (o && o.parent) o.parent.remove(o); });
    if (isVR) { showDocPanel(INTRO_CLIPPING); I.panelT = 12; } else showDocDom(INTRO_CLIPPING);
    return;
  }
  if (I.step >= 5 && pz > -1.6 && Math.abs(px - c.doorX) < 2.5) endCinematic();
}
function mountHeldLantern() {
  const c = cine; if (c.intro.heldLantern) return;
  const g = buildHeldLantern();
  const off = isVR ? (OPTS.swapHands ? sources.rightGrip : sources.leftGrip) : camera;
  if (off) { off.add(g); if (isVR) { g.position.set(0, -0.02, -0.04); g.rotation.set(0, 0, 0); } else { g.position.set(0.28, -0.28, -0.5); g.scale.setScalar(0.9); } }
  c.intro.heldLantern = g;
}

function introRunner(dt) {
  const c = cine, R = c.runner; if (!R) return;
  R.mixer.update(dt);
  const doorX = c.doorX, cue = c.intro.runnerCue;
  const moveLerp = () => {
    R.pt += dt; const k = Math.min(1, R.pt / R.dur);
    const x = R.from[0] + (R.to[0] - R.from[0]) * k, z = R.from[1] + (R.to[1] - R.from[1]) * k;
    R.obj.position.set(x, 0, z);
    R.obj.rotation.y = Math.atan2(R.to[0] - R.from[0], R.to[1] - R.from[1]);
    R.stepT -= dt; if (R.stepT <= 0) { R.stepT = 0.16; Audio2.footstepPan(Math.max(-1, Math.min(1, (x - doorX) / 24)), 0.16); }
    return k >= 1;
  };
  switch (R.phase) {
    case 'wait':
      if (cue === 'distant') { R.phase = 'distant'; R.pt = 0; Audio2.growlPan(0.8, 0.14); }
      break;
    case 'distant':
      R.pt += dt;
      if (cue === 'charge' && R.pt > 0.3) {
        R.phase = 'charge'; R.obj.visible = true;
        if (R.acts.run) { R.acts.run.reset().setLoop(THREE.LoopRepeat, Infinity).play(); R.acts.run.timeScale = 1.6; }
        R.from = [doorX + 38, -30]; R.to = [doorX + 8.5, -2.4]; R.dur = 1.9; R.pt = 0;
      }
      break;
    case 'charge':
      if (moveLerp()) {
        R.phase = 'slam';
        if (R.acts.run) R.acts.run.fadeOut(0.08);
        if (R.acts.slam) { R.acts.slam.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.05).play(); R.acts.slam.clampWhenFinished = true; }
        R.obj.rotation.y = Math.PI;
        Audio2.crash(0.7); Audio2.thud(0.9); Audio2.screechPan(0.5, 0.16);
        comfortBlink(0.9); haptic(0.9, 140); c.shakeT = 0.55; R.pt = 0;
        showSubtitle('IT HIT THE BUILDING.', 2.5);
      }
      break;
    case 'slam':
      R.pt += dt;
      if (R.pt > 1.1) { R.phase = 'rage'; if (R.acts.rage) R.acts.rage.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play(); if (R.acts.slam) R.acts.slam.fadeOut(0.3); }
      break;
    case 'rage':
      if (Math.random() < dt * 0.7) Audio2.breathPan(0.35, 0.12);
      if (cue === 'flee') {
        R.phase = 'flee';
        if (R.acts.rage) R.acts.rage.fadeOut(0.1);
        if (R.acts.run) { R.acts.run.reset().fadeIn(0.05).play(); R.acts.run.timeScale = 1.9; }
        Audio2.screechPan(0.6, 0.22);
        R.from = [doorX + 8.5, -2.4]; R.to = [doorX + 52, -24]; R.dur = 1.7; R.pt = 0;
        showSubtitle('It looked at you. And it RAN.', 3);
      }
      break;
    case 'flee':
      if (moveLerp()) { R.obj.visible = false; R.phase = 'gone'; }
      break;
  }
}
// You cross the threshold — the doors boom shut, and the dead wake to the sound.
function endCinematic() {
  if (!cine) return;
  const c = cine;
  // strip the tutorial rig off the hand/camera before we tear the scene down
  if (c.intro) {
    if (c.intro.heldLantern && c.intro.heldLantern.parent) c.intro.heldLantern.parent.remove(c.intro.heldLantern);
    if (c.intro.banner && c.intro.banner.mesh.parent) c.intro.banner.mesh.parent.remove(c.intro.banner.mesh);
  }
  hideBigPanel();
  // the lantern you took off the gatepost comes inside with you (unlit — the
  // matches are in the kitchen, like the walk-up promised)
  if (c.intro && c.intro.lanternTaken && window.Survival && Survival.give) Survival.give('lantern');
  fog.density = 0.055;   // the building's air closes back in
  Audio2.creak(); Audio2.slam();
  comfortBlink(1);
  disposeGroup(c.g); cine = null;
  const sp = World.spawn(data);
  placeDollyAtNearestSafe(sp.x + 0.5, sp.y + 0.5);
  dolly.position.y = 0; dolly.rotation.set(0, 0, 0);
  jumpY = 0; jumpVel = 0; crouched = false;
  // the clock — and the 24-hour night — begins the instant you're inside
  startEpoch = Date.now(); elapsed = 0; hour = 0;
  graceUntil = 14;   // a breath to find your feet, then the house comes alive
  onboardStep = 0; onboardT = 4.5;
  setTutorialDone();   // you've done the walk — next time you can skip straight in
  state = 'PLAY';
  clock.getDelta();
  Audio2.stinger(false);
  showSubtitle('The doors boom shut behind you. The chain rattles down the outside. You’re inside now.', 5);
  // and the house answers, from the floor above
  setTimeout(() => { if (state === 'PLAY') { Audio2.whisper(0.6); Audio2.creak(); showSubtitle('Something on the floor above shifts its weight. It heard the door open.', 4.5); } }, 3400);
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
  TEX.sharedMaterials = new Set();
  const shared = (mat) => { TEX.sharedMaterials.add(mat); return mat; };
  TEX.wallD = load('wall_diff.jpg', 1, 1.2);
  TEX.wallN = load('wall_nor.jpg', 1, 1.2, false);
  TEX.wall2D = load('wall2_diff.jpg', 1, 1.2);
  TEX.wall2N = load('wall2_nor.jpg', 1, 1.2, false);
  // Horizontal surfaces carry world-space UVs. Keep their textures at unit
  // repeat so one source image always covers the same number of metres,
  // independent of the size of the room mesh using it.
  TEX.floorD = load('floor_diff.jpg', 1, 1);
  TEX.floorN = load('floor_nor.jpg', 1, 1, false);
  TEX.ceilD = load('ceiling_diff.jpg', 1, 1);
  TEX.doorD = load('door_diff.jpg', 1, 1);
  // Per-room floor skins — one shared GPU texture/material per skin. Physical
  // repeat is encoded in each room's UVs, never here on the shared texture.
  // Horror upgrades (Screaming Brain Studios, CC0): grimy tile/lino/concrete.
  TEX.rooms = {
    tile: load('horror/floor_tile.jpg', 1, 1),
    bigtile: load('large_floor_tiles_02_diff.jpg', 1, 1),
    lino: load('horror/floor_lino.jpg', 1, 1),
    wood: load('wood_floor_worn_diff.jpg', 1, 1),
    conc: load('horror/floor_conc.jpg', 1, 1),
    carpet: load('dirty_carpet_diff.jpg', 1, 1),
    mosaic: load('old_mosaic_floor_diff.jpg', 1, 1),
    metal: load('horror/metal_rust.jpg', 1, 1),
    bloodwood: load('horror/floor_bloodwood.jpg', 1, 1),   // blood soaked into the boards
  };
  TEX.groundForest = load('horror/ground_forest.jpg', 1, 1);   // world-metre UVs set the hillside repeat
  // one material per skin, shared by every room using it
  TEX.roomMats = {};
  Object.keys(TEX.rooms).forEach((k) => {
    TEX.roomMats[k] = shared(new THREE.MeshStandardMaterial({ map: TEX.rooms[k], color: 0x93969c, roughness: .95 }));
  });
  // Generated corridor/ceiling materials load as an atomic albedo+normal pair.
  // Until both maps succeed, the old CC0 material remains attached, so a
  // missing/partial pack can never turn a level black or leave a mismatched
  // normal map. Unit repeat pairs with buildHorizontalSurfaceGeometry below.
  const SURFACE_ROOT = 'assets/generated/codex-ceiling-floor-pack-v1/';
  const configureSurface = (t, srgb) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
    if ('colorSpace' in t && srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const surfaceMaterialFrom = (albedoPath, normalPath, fallbackMap, fallbackNormal, opts) => {
    const mat = shared(new THREE.MeshStandardMaterial({
      map: fallbackMap, normalMap: fallbackNormal,
      color: opts.color, roughness: opts.roughness, metalness: 0,
    }));
    let albedo = null, normal = null, failed = false;
    const commit = () => {
      if (failed || !albedo || !normal) return;
      mat.map = albedo; mat.normalMap = normal; mat.needsUpdate = true;
    };
    const fetch = (path, srgb, ready) => {
      L.load(path, (t) => { ready(configureSurface(t, srgb)); commit(); }, undefined, () => {
        failed = true;
        console.warn('surface texture missing; keeping CC0 fallback:', path);
      });
    };
    fetch(albedoPath, true, (t) => { albedo = t; });
    fetch(normalPath, false, (t) => { normal = t; });
    return mat;
  };
  const surfaceMaterial = (base, fallbackMap, fallbackNormal, opts) => surfaceMaterialFrom(
    SURFACE_ROOT + base + '-albedo.jpg', SURFACE_ROOT + base + '-normal.png', fallbackMap, fallbackNormal, opts);
  // Claude's approved checker albedo already lives in surface-kit-v1. Pair it
  // with this pass's derived normal instead of shipping/loading a duplicate.
  const surfaceMaterialWithAlbedo = (base, albedoPath, fallbackMap, fallbackNormal, opts) => surfaceMaterialFrom(
    albedoPath, SURFACE_ROOT + base + '-normal.png', fallbackMap, fallbackNormal, opts);
  // A neutral normal keeps ceiling materials in the same shader variant while
  // their generated normals stream in, avoiding a first-look compile hitch.
  TEX.flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  TEX.flatNormal.wrapS = TEX.flatNormal.wrapT = THREE.RepeatWrapping;
  TEX.flatNormal.needsUpdate = true;
  TEX.corridorMats = {
    lino: surfaceMaterialWithAlbedo('floors/checker-hospital-linoleum',
      'assets/generated/surface-kit-v1/checker-hospital-linoleum-albedo.jpg', TEX.floorD, TEX.floorN,
      { color: 0x8f9299, roughness: .92 }),
    terrazzo: surfaceMaterial('floors/ground-floor-terrazzo', TEX.floorD, TEX.floorN, { color: 0x8f9299, roughness: .9 }),
    concrete: surfaceMaterial('floors/basement-sealed-concrete', TEX.floorD, TEX.floorN, { color: 0x8f9299, roughness: .96 }),
    oak: surfaceMaterial('floors/upper-floor-dark-oak', TEX.floorD, TEX.floorN, { color: 0x8f9299, roughness: .94 }),
    // The third floor reuses the existing large slate-grey tile instead of
    // repeating the second floor's checker pattern.
    slate: shared(new THREE.MeshStandardMaterial({ map: TEX.rooms.bigtile, color: 0x8f9498, roughness: .96 })),
  };
  const legacyCeiling = ceilingPlasterTex();
  legacyCeiling.repeat.set(1, 1); // geometry carries its intended 4-tile period
  TEX.ceilingMats = {
    plaster: surfaceMaterial('ceilings/aged-calcimine-plaster', TEX.ceilD, TEX.flatNormal, { color: 0x6d7076, roughness: 1 }),
    panels: surfaceMaterial('ceilings/midcentury-fiberboard-panels', TEX.ceilD, TEX.flatNormal, { color: 0x6d7076, roughness: 1 }),
    concrete: surfaceMaterial('ceilings/basement-painted-concrete', TEX.ceilD, TEX.flatNormal, { color: 0x6d7076, roughness: 1 }),
    legacy: shared(new THREE.MeshStandardMaterial({ map: legacyCeiling, color: 0x8f8d87, roughness: 1 })),
    boards: shared(new THREE.MeshStandardMaterial({ map: TEX.rooms.wood, color: 0x625b54, roughness: 1 })),
  };
  TEX.roomMats.checker = TEX.corridorMats.lino;
  TEX.groundMat = surfaceMaterial('ground/appalachian-wet-leaf-clay', TEX.groundForest, TEX.flatNormal,
    { color: 0x697069, roughness: 1 });
  TEX.thresholdMat = shared(new THREE.MeshStandardMaterial({ color: 0x342d26, roughness: .72, metalness: .18 }));
  // Interior wall skins: two good high-res plaster bases (own instances at repeat 1,1 —
  // world-space UVs in buildWallGeometry carry the tiling, so no per-tile "cheese" copy).
  const wRose = load('wall_diff.jpg', 1, 1), wRoseN = load('wall_nor.jpg', 1, 1, false),
        wGrey = load('painted_plaster_wall_diff.jpg', 1, 1);
  // one tinted material per floor so each level still reads distinct
  // Codex visual pack v1 (generated for this game — provenance in assets/generated/codex-visual-pack-v1)
  const gload = (p, rx, ry) => {
    const t = L.load(p, undefined, undefined, () => console.warn('texture missing:', p));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    if (rx) t.repeat.set(rx, ry);
    return t;
  };
  const wGreen = gload('assets/generated/codex-visual-pack-v1/walls/hospital-green-painted-plaster-albedo.jpg', 1, 1.2);
  const wFloral = gload('assets/generated/codex-visual-pack-v1/walls/1920s-floral-wallpaper-albedo.jpg', 1, 1.2);
  TEX.fire8 = gload('assets/generated/codex-visual-pack-v1/flames/fire-orange-8x8.png');
  TEX.newsprint = gload('assets/generated/codex-visual-pack-v1/newspaper/williamson-daily-october-1988.png');
  TEX.wallMats = [
    new THREE.MeshStandardMaterial({ map: wGreen, color: 0xb9beb2, roughness: .95 }),                   // 1 surgical-green plaster, peeling
    new THREE.MeshStandardMaterial({ map: wFloral, color: 0xb8b0a4, roughness: .94 }),                  // 2 water-stained 1920s wallpaper
    new THREE.MeshStandardMaterial({ map: wGrey, color: 0x82927c, roughness: .96 }),                    // 3 damp mould grey-green
    new THREE.MeshStandardMaterial({ map: wRose, normalMap: wRoseN, color: 0x847b76, roughness: .96 }), // 4 dim, dust-warm
  ];
  TEX.wallMatBase = new THREE.MeshStandardMaterial({ map: wGrey, color: 0x64696a, roughness: .97 });    // 0 cold damp concrete-grey
  // retexture maps for prop models that shipped a flat/plain baseColor (own instances)
  TEX.propTex = {
    wood: load('wood_floor_worn_diff.jpg', 1.6, 1.1),
    metal: load('rusty_metal_04_diff.jpg', 1.5, 1.5),
    conc: load('worn_concrete_floor_diff.jpg', 1.4, 1.4),
  };
  // blood / drip / grime decals (RGBA, alpha baked from luminance) — no tiling
  const loadDecal = (file) => { const t = L.load('assets/textures/' + file, undefined, undefined, () => {}); if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  TEX.blood = ['blood1', 'blood2', 'blood3'].map((n) => loadDecal('horror/decals/' + n + '.png'));
  TEX.drip = ['drip1', 'drip2'].map((n) => loadDecal('horror/decals/' + n + '.png'));
  TEX.grime = [loadDecal('horror/decals/grime1.png')];
}

// which floor skin each room type wears
const ROOM_FLOOR = {
  lobby: 'mosaic', admitting: 'mosaic', waiting: 'carpet', cafeteria: 'carpet',
  er: 'checker', surgery: 'checker', prep: 'checker', xray: 'checker', autopsy: 'checker', pharmacy: 'checker', bath: 'tile',
  kitchen: 'bigtile', ward: 'lino', room207: 'lino', maternity: 'lino', quarters: 'lino', matron: 'lino',
  station: 'lino', records: 'lino', linen: 'lino', iso: 'lino', recovery: 'lino',
  chapel: 'wood', sanctum: 'wood', attic: 'wood', nursery: 'wood', bell: 'wood',
  mose: 'bloodwood', ritual: 'bloodwood',   // the two rooms where the worst of it happened
  morgue: 'conc', storage: 'conc', laundry: 'conc', supply: 'conc', landing: 'conc',
  incinerator: 'metal', boiler: 'metal',
};
const ROOM_CEILING = {
  nursery: 'plaster', xray: 'panels', storage: 'concrete', autopsy: 'panels', morgue: 'concrete',
  incinerator: 'concrete', boiler: 'concrete', ritual: 'concrete', laundry: 'concrete',
  lobby: 'plaster', admitting: 'plaster', records: 'plaster', pharmacy: 'panels', er: 'panels',
  waiting: 'plaster', kitchen: 'panels', cafeteria: 'plaster',
  ward: 'panels', station: 'panels', maternity: 'panels', room207: 'plaster', linen: 'plaster', bath: 'concrete',
  surgery: 'panels', recovery: 'panels', mose: 'plaster', prep: 'panels', supply: 'concrete', iso: 'panels', landing: 'plaster',
  quarters: 'plaster', matron: 'plaster', sanctum: 'plaster', attic: 'boards', chapel: 'boards', bell: 'boards', roof: 'boards',
};
// Level identity for the broad corridor slab and ceiling. Rooms keep their
// role-specific skins above; these maps establish a stable material language
// between rooms without adding any per-room material instances.
const CORRIDOR_FLOOR_BY_LEVEL = ['concrete', 'terrazzo', 'lino', 'slate', 'oak'];
const CEILING_BY_LEVEL = ['concrete', 'plaster', 'panels', 'legacy', 'boards'];
const FLOOR_REPEAT_M = TILE_M;       // generated floor swatches represent 2.7 m square
const CEILING_REPEAT_M = TILE_M * 2; // 8x8 panel sheet -> period-correct ~67.5 cm panels
const ceilingRepeatMetres = (key) => key === 'legacy' ? TILE_M * 4 : CEILING_REPEAT_M;

// ============================================================ world geometry
function disposeGroup(g) {
  if (!g) return;
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        // Shared surface materials survive floor changes; disposing them here
        // forced a shader/GPU re-upload when the same shared material returned.
        if (!(TEX.sharedMaterials && TEX.sharedMaterials.has(m))) m.dispose();
      });
    }
  });
  scene.remove(g);
}

// A four-vertex horizontal plane whose UVs are derived from absolute world X/Z
// coordinates. Adjacent meshes therefore meet at the same texture phase, and a
// 2.7 m swatch remains 2.7 m in a linen closet, a ward, or the full corridor.
function buildHorizontalSurfaceGeometry(x0, z0, width, depth, metresPerRepeat, faceUp, phase) {
  const hw = width / 2, hd = depth / 2;
  const x1 = x0 + width, z1 = z0 + depth, n = faceUp ? 1 : -1;
  const pu = phase ? phase.u : 0, pv = phase ? phase.v : 0;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -hw, 0, -hd, -hw, 0, hd, hw, 0, hd, hw, 0, -hd,
  ], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, n, 0, 0, n, 0, 0, n, 0, 0, n, 0,
  ], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([
    x0 / metresPerRepeat + pu, z0 / metresPerRepeat + pv,
    x0 / metresPerRepeat + pu, z1 / metresPerRepeat + pv,
    x1 / metresPerRepeat + pu, z1 / metresPerRepeat + pv,
    x1 / metresPerRepeat + pu, z0 / metresPerRepeat + pv,
  ], 2));
  geo.setIndex(faceUp ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  return geo;
}

// Rooms that share a material still get a deterministic fractional phase.
// Ward 2-A and Ward 2-B therefore read as related construction, not cloned
// texture stamps, without allocating another texture or material.
function roomSurfacePhase(fi, room, ceiling) {
  let h = 2166136261 ^ fi;
  const label = (room.name || room.tag || '') + (ceiling ? ':ceiling' : ':floor');
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 16777619);
  return { u: ((h >>> 0) & 7) / 8, v: ((h >>> 3) & 7) / 8 };
}

// Build wall geometry as exposed faces only, with continuous WORLD-SPACE UVs so the
// texture flows across tiles instead of copy-pasting the same image every 2 m.
function buildWallGeometry(g) {
  const solid = (x, y) => (x < 0 || y < 0 || x >= World.W || y >= World.H) ? true : (g[y][x] === TILE.WALL);
  const H = WALL_H, TW = 3.0, vTop = H / 3.2;   // one texture ≈ 3 m wide, full wall height tall
  const pos = [], nor = [], uv = [], idx = [];
  let vi = 0;
  const quad = (v0, v1, v2, v3, nx, ny, nz, u0, u1) => {
    pos.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2], v3[0], v3[1], v3[2]);
    for (let k = 0; k < 4; k++) nor.push(nx, ny, nz);
    uv.push(u0, 0, u1, 0, u1, vTop, u0, vTop);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4;
  };
  for (let y = 0; y < World.H; y++) for (let x = 0; x < World.W; x++) {
    if (g[y][x] !== TILE.WALL) continue;
    const x0 = x * TILE_M, x1 = (x + 1) * TILE_M, z0 = y * TILE_M, z1 = (y + 1) * TILE_M;
    if (!solid(x, y - 1)) quad([x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0], 0, 0, -1, x1 / TW, x0 / TW);
    if (!solid(x, y + 1)) quad([x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1], 0, 0, 1, x0 / TW, x1 / TW);
    if (!solid(x - 1, y)) quad([x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0], -1, 0, 0, z0 / TW, z1 / TW);
    if (!solid(x + 1, y)) quad([x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1], 1, 0, 0, z1 / TW, z0 / TW);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function buildFloor(fi) {
  disposeGroup(floorGroup);
  doorMeshes.clear(); itemMeshes.clear(); docMeshes.clear(); candleLights = [];
  hideTiles = []; exitRec = null;
  moodLights = []; carter = null; fallingDebris = []; debrisKept = []; sceneAnims = [];
  entityMeshes.forEach((v) => v.group && scene.remove(v.group));
  entityMeshes.clear();

  const g = data.floors[fi].grid;
  floorGroup = new THREE.Group();
  scene.add(floorGroup);

  const spanX = World.W * TILE_M, spanZ = World.H * TILE_M;

  // Per-level corridor floor + ceiling. Generated material pairs fail-soft to
  // the original CC0 tile/plaster maps and remain shared across rebuilds.
  const floorMat = (TEX.corridorMats && TEX.corridorMats[CORRIDOR_FLOOR_BY_LEVEL[fi]]) ||
    new THREE.MeshStandardMaterial({ map: TEX.floorD, normalMap: TEX.floorN, color: 0x8f9299, roughness: .95 });
  const floor = new THREE.Mesh(buildHorizontalSurfaceGeometry(0, 0, spanX, spanZ, FLOOR_REPEAT_M, true), floorMat);
  floor.position.set(spanX / 2, 0, spanZ / 2);
  floor.receiveShadow = true;
  floorGroup.add(floor);

  const levelCeilingKey = CEILING_BY_LEVEL[fi];
  const ceilMat = (TEX.ceilingMats && TEX.ceilingMats[levelCeilingKey]) ||
    new THREE.MeshStandardMaterial({ map: TEX.ceilD, color: 0x6d7076, roughness: 1 });
  const ceil = new THREE.Mesh(buildHorizontalSurfaceGeometry(0, 0, spanX, spanZ, ceilingRepeatMetres(levelCeilingKey), false), ceilMat);
  ceil.position.set(spanX / 2, WALL_H, spanZ / 2);
  floorGroup.add(ceil);

  // per-room floor skins — every room type wears its own floor
  data.floors[fi].rooms.forEach((r) => {
    const key = ROOM_FLOOR[r.tag];
    const mat = key && TEX.roomMats && TEX.roomMats[key];
    if (!mat) return;
    const x0 = (r.x + 1) * TILE_M, z0 = (r.y + 1) * TILE_M;
    const width = (r.w - 2) * TILE_M, depth = (r.h - 2) * TILE_M;
    const pl = new THREE.Mesh(buildHorizontalSurfaceGeometry(
      x0, z0, width, depth, FLOOR_REPEAT_M, true, roomSurfacePhase(fi, r, false)), mat);
    pl.position.set((r.x + r.w / 2) * TILE_M, 0.02, (r.y + r.h / 2) * TILE_M);
    floorGroup.add(pl);
  });

  // Ceiling overlays give rooms their own architectural history while the
  // corridor ceiling keeps each level recognizable. Skip identical pairs so
  // this adds only the transitions that are actually visible.
  data.floors[fi].rooms.forEach((r) => {
    const key = ROOM_CEILING[r.tag];
    const mat = key && TEX.ceilingMats && TEX.ceilingMats[key];
    if (!mat || key === levelCeilingKey) return;
    const x0 = (r.x + 1) * TILE_M, z0 = (r.y + 1) * TILE_M;
    const width = (r.w - 2) * TILE_M, depth = (r.h - 2) * TILE_M;
    const pl = new THREE.Mesh(buildHorizontalSurfaceGeometry(
      x0, z0, width, depth, ceilingRepeatMetres(key), false, roomSurfacePhase(fi, r, true)), mat);
    pl.position.set((r.x + r.w / 2) * TILE_M, WALL_H - 0.018, (r.y + r.h / 2) * TILE_M);
    floorGroup.add(pl);
  });

  // A thin shared threshold masks material changes cleanly and makes every room
  // entrance readable in flashlight light without becoming a collision step.
  if (TEX.thresholdMat) {
    const rooms = data.floors[fi].rooms;
    const strips = new THREE.InstancedMesh(new THREE.BoxGeometry(1.72, 0.018, 0.13), TEX.thresholdMat, rooms.length);
    const matrix = new THREE.Matrix4();
    rooms.forEach((r, i) => {
      matrix.makeTranslation((r.doorX + 0.5) * TILE_M, 0.031, (r.doorY + 0.5) * TILE_M);
      strips.setMatrixAt(i, matrix);
    });
    strips.instanceMatrix.needsUpdate = true;
    floorGroup.add(strips);
  }

  // walls — exposed-face geometry with continuous world-space UVs (no per-tile repeat),
  // one tinted plaster material per floor so levels stay distinct
  const wallMat = fi === 0 ? TEX.wallMatBase : (TEX.wallMats[(fi - 1) % TEX.wallMats.length] || TEX.wallMats[0]);
  const walls = new THREE.Mesh(buildWallGeometry(g), wallMat);
  walls.castShadow = true; walls.receiveShadow = true;
  floorGroup.add(walls);
  // collision & fixture state resets FIRST — addStairs pushes stair colliders
  propSolids = []; flickers = []; emberProp = null; fxMixers = [];
  // fixtures the grid still drives: doors, candles, stairs, exits, hide-lockers
  for (let y = 0; y < World.H; y++) {
    for (let x = 0; x < World.W; x++) {
      const t = g[y][x];
      const wx = (x + 0.5) * TILE_M, wz = (y + 0.5) * TILE_M;
      if (t === TILE.DOOR || t === TILE.LOCKED) addDoor(x, y, wx, wz, t === TILE.LOCKED);
      else if (t === TILE.CANDLE) addCandle(wx, wz);
      else if (t === TILE.UP || t === TILE.DOWN) addStairs(wx, wz, t === TILE.UP);
      else if (t === TILE.EXIT) addExit(wx, wz);
      else if (t === TILE.HIDE) addLocker(wx, wz);
    }
  }

  // furniture + fixtures (props.js)
  if (window.Props) {
    try {
      const p = Props.populate(fi, data, { TILE_M, WALL_H });
      mergeStaticProps(p.group);   // collapse static furniture into few draw calls
      floorGroup.add(p.group);
      propSolids = propSolids.concat(p.solids || []);   // keep the stair colliders
      flickers = p.fixtures || [];
      emberProp = p.ember || null;
      animatedProps = p.animated || [];
      moodLights = p.moods || [];
    } catch (e) { console.warn('props failed:', e); }
  }

  // the generator (basement), restored power, and the mirror trigger-scares
  try {
    if (fi === 0) addGenerator();
    if (powerOn && fi <= 1) reviveFixtures();
    buildScareTriggers(fi);
    mountSigns(fi);
  } catch (e) { console.warn('power/scares failed:', e); }

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
  // The Matron herself keeps her old room — a hooded shape frozen mid-reach.
  // Not a hunter: a set-piece scare. Walk too close and she is simply… gone.
  try { buildMatronApparition(fi); } catch (e) { console.warn('matron failed:', e); }

  // real hospital furniture scattered through the wards, halls and rooms
  try { placeHorrorProps(fi); } catch (e) { console.warn('horror props failed:', e); }
  // blood, drips and grime on the floors of the worst rooms
  try { placeDecals(fi); } catch (e) { console.warn('decals failed:', e); }
  // cobwebs, ceiling pipes, light shafts, drifting fog + ceiling drips
  try { addAtmosphere(fi); } catch (e) { console.warn('atmosphere failed:', e); }

  // items on this floor
  data.items.forEach((it) => { if (!it.taken && it.floor === fi) addItemMesh(it); });

  // entities present on this floor get meshes
  ents.forEach((e) => { if (e.floor === fi) ensureEntityMesh(e); });

  // prewarm every material/shader now, so the first jump-scare never hitches
  try { renderer.compile(scene, camera); } catch (e) { /* headless GL quirks — safe to skip */ }
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
  html += '<li><b>The Nightmare</b> — what the surgical wing dreamed up in sixty years of ether and screaming. It wakes in the deepest hours.</li>';
  html += '<li><b>The Wraith</b> — the cold spot in the attic dark. It does not walk. It does not need to.</li>';
  html += '<li><b>The Matron</b> — she who bound them all still keeps her room on the fourth floor. Do not walk up to her. She hates being interrupted.</li>';
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
  const found = documents.filter((d) => d.found);
  html += `</ul><h3>Evidence (${found.length}/${documents.length})</h3>`;
  if (!found.length) html += '<p class="hint">Nothing filed yet. Search the rooms — letters, patient files, newspaper clippings, a diary. The pages point to the keys, the tools, and the truths.</p>';
  else {
    found.forEach((d) => { html += `<div class="casedoc ${d.type}"><b>${d.title}</b><br><span class="hint">${d.body.join('<br>')}</span></div>`; });
    const left = documents.length - found.length;
    if (left) html += `<p class="hint">…and ${left} more page${left > 1 ? 's' : ''} still out there in the dark.</p>`;
  }
  el.innerHTML = html + '<p class="tip">TAB TO CLOSE THE FILE</p></div>';
  el.classList.add('show');
}

// ---- the Matron's apparition (4th floor set-piece) ----
let matronApp = null, matronGone = false;
function buildMatronApparition(fi) {
  matronApp = null;
  if (fi !== 4 || matronGone) return;
  const src = (window.MobModels || {}).matronW;
  const room = data.floors[4].rooms.find((r) => r.tag === 'matron');
  if (!src || !src.scene || !room) return;
  const model = skeletonClone(src.scene);
  // freeze her mid-lunge — the run cycle's ugliest frame, held forever
  if (src.animations && src.animations.length) {
    const mx = new THREE.AnimationMixer(model);
    mx.clipAction(src.animations[0]).play(); mx.update(0.4);
  }
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model, true);
  const h = (box.max.y - box.min.y) || 1;
  model.scale.setScalar(1.85 / h);
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model, true);
  model.position.y = -box.min.y + 0.12;   // she does not quite touch the floor
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    o.frustumCulled = false;
    o.material = o.material.clone();
    if (o.material.color) o.material.color.lerp(new THREE.Color(0x2c2733), 0.4);
    if (o.material.map) o.material.map.anisotropy = 4;
  });
  const grp = new THREE.Group();
  grp.add(model);
  const wx = (room.cx + 0.5 + (room.w > 5 ? 1 : 0)) * TILE_M, wz = (room.cy + 0.2) * TILE_M;
  grp.position.set(wx, 0, wz);
  grp.rotation.y = Math.PI * 0.8;   // half-turned away, reaching for something long gone
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(120,110,160,0.4)'), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
  aura.scale.set(2.4, 2.4, 1); aura.position.y = 1.1; grp.add(aura);
  floorGroup.add(grp);
  matronApp = { grp, tx: wx / TILE_M, ty: wz / TILE_M, seen: false, fading: 0 };
}
function matronUpdate(dt) {
  const m = matronApp;
  if (!m || player.floor !== 4) return;
  if (m.fading > 0) {   // dissolving out of the world
    m.fading -= dt;
    const op = Math.max(0, m.fading / 0.7);
    m.grp.traverse((o) => { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = op; } });
    if (m.fading <= 0) {
      floorGroup.remove(m.grp); matronApp = null; matronGone = true;
      showSubtitle('Cold air where she stood. The Matron was never going to leave her ward.', 4.5);
    }
    return;
  }
  const d = Math.hypot(m.tx - player.x, m.ty - player.y);
  if (!m.seen && d < 8 && inRoom(4, 'matron')) {
    m.seen = true;
    Audio2.whisper(0.8); Audio2.dread();
    player.fear = Math.min(100, player.fear + 8);
    showSubtitle('A hooded shape stands in the Matron’s room. It has not moved in fifty years. Probably.', 5);
  }
  if (powerChase) return;   // mid-chase, reaching her is salvation — matronRescue owns this moment
  if (d < 2.3) {   // you walked up to her. she declines the meeting.
    m.fading = 0.7;
    Audio2.screechPan(panTo({ x: m.tx, y: m.ty }), 0.14);
    player.fear = Math.min(100, player.fear + 12);
    comfortBlink(0.9); haptic(0.6, 90);
  }
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
// ============================================================ staged assets
// The old loader fired ~480 requests in one Promise.all the moment the page
// opened. Now assets load in GROUPS through a bounded queue (4 roots at a
// time): 'core' + 'intro' gate the start of a night; 'cast' and 'props'
// stream in behind the walk-up (the tutorial climb IS the loading screen).
// Every consumer already fail-softs on a missing model, so streaming is safe.
const Assets = (() => {
  const MODELS = {}, MOB = {}, PACKSCENES = {};
  window.HeroModels = MODELS; window.MobModels = MOB;   // live objects, filled as loads land
  const DEFS = [];
  const hero = (group, key, url) => DEFS.push({ group, key, url, kind: 'hero' });
  const mob = (group, key, url) => DEFS.push({ group, key, url, kind: 'mob' });
  const pk = (group, key, url) => DEFS.push({ group, key, url, kind: 'pack' });

  // ---- core: hands, watch, weapons, the matchbox — needed the moment play starts
  hero('core', 'vrhands', 'assets/models/horror/vrhands/scene.gltf');
  hero('core', 'smartwatch', 'assets/models/horror/smartwatch/scene.gltf');
  hero('core', 'matches', 'assets/models/horror/matches/scene.gltf');
  pk('core', 'weapons', 'assets/models/horror/weapons/scene.gltf');
  // ---- intro: everything the walk-up cinematic shows
  hero('intro', 'oaktrees', 'assets/models/horror/oaktrees/scene.gltf');
  hero('intro', 'elecbox', 'assets/models/horror/elecbox/scene.gltf');
  hero('intro', 'streetlamp', 'assets/models/horror/streetlamp/scene.gltf');
  hero('intro', 'wildgrass', 'assets/models/horror/wildgrass/scene.gltf');
  hero('intro', 'mossrock', 'assets/models/horror/mossrock/scene.gltf');
  hero('intro', 'mosspatch', 'assets/models/horror/mosspatch/scene.gltf');
  mob('intro', 'playgroundG', 'assets/models/horror/playground/scene.gltf');
  mob('intro', 'carouselG', 'assets/models/horror/carousel/scene.gltf');
  mob('intro', 'runner096', 'assets/models/horror/scp096/scene.gltf');
  // ---- cast: every apparition (they roam between floors — never floor-scoped)
  mob('cast', 'helene', 'assets/models/sketchfab/helene/scene.gltf');
  mob('cast', 'anne', 'assets/models/sketchfab/anne/scene.gltf');
  mob('cast', 'wolfram', 'assets/models/sketchfab/wolfram/scene.gltf');
  mob('cast', 'horrorkid', 'assets/models/horror/horrorkid/scene.gltf');
  mob('cast', 'crawler2', 'assets/models/horror/crawler2/scene.gltf');
  mob('cast', 'ghoul', 'assets/models/horror/ghoul/scene.gltf');
  mob('cast', 'closer', 'assets/models/horror/closer/scene.gltf');
  mob('cast', 'undead', 'assets/models/horror/undead/scene.gltf');
  mob('cast', 'nightmare1', 'assets/models/horror/nightmare1/scene.gltf');
  mob('cast', 'wraith', 'assets/models/horror/wraith/scene.gltf');
  mob('cast', 'ghost', 'assets/models/monsters/ghost.glb');
  mob('cast', 'skel', 'assets/models/monsters/skeleton.glb');
  mob('cast', 'kaykit', 'assets/models/monsters/skeleton_warrior.glb');
  mob('cast', 'matronW', 'assets/models/horror/matron/scene.gltf');
  mob('cast', 'flamefx', 'assets/models/horror/flametest/scene.gltf');
  mob('cast', 'glyphfx', 'assets/models/horror/glypharch/scene.gltf');
  // ---- props: the furniture and dressing of the whole hospital
  hero('props', 'bed', 'assets/models/GothicBed_01/GothicBed_01_1k.gltf');
  hero('props', 'rocker', 'assets/models/Rockingchair_01/Rockingchair_01_1k.gltf');
  hero('props', 'chair', 'assets/models/WoodenChair_01/WoodenChair_01_1k.gltf');
  hero('props', 'table', 'assets/models/WoodenTable_01/WoodenTable_01_1k.gltf');
  hero('props', 'cabinet', 'assets/models/drawer_cabinet/drawer_cabinet_1k.gltf');
  hero('props', 'boiler', 'assets/models/barrel_stove/barrel_stove_1k.gltf');
  hero('props', 'candles', 'assets/models/brass_candleholders/brass_candleholders_1k.gltf');
  [['hospbed', 'hospbed'], ['horrorbed', 'horrorbed'], ['gurney', 'gurney'], ['wheelchair', 'wheelchair'],
    ['rewheelchair', 'rewheelchair'], ['clock', 'clock'], ['caftable', 'caftable'], ['bin', 'bin'],
    ['examtable', 'examtable'], ['locker', 'locker'], ['metalcab', 'metalcab'], ['deadbody', 'deadbody'],
    ['deadcovered', 'deadcovered'], ['coffin', 'coffin'], ['bloodybath', 'bloodybath'], ['bathcab', 'bathcab'],
    ['oldtv', 'oldtv'], ['payphone', 'payphone'], ['vending', 'vending'], ['bookshelf', 'bookshelf'],
    ['candle', 'candle'], ['cross', 'cross'], ['ceilinglights', 'ceilinglights'], ['gasstove', 'gasstove'],
    ['voodoohang', 'voodoohang'], ['shovel', 'shovel'], ['bloodytarp', 'bloodytarp'], ['wallblood', 'wallblood'],
    ['evidenceboard', 'evidenceboard'], ['cannedgoods', 'cannedgoods'], ['toolset', 'toolset'], ['kitchenware', 'kitchenware'],
    ['staircase', 'staircase'], ['piano', 'piano'], ['planks', 'planks'], ['scarebear', 'scarebear'],
    ['ventvalve', 'ventvalve'], ['ouija', 'ouija'], ['wallphone', 'wallphone'], ['radiator', 'radiator'],
    ['mirrorh', 'mirrorh'], ['bathcounter', 'bathcounter'], ['bloodysofa', 'bloodysofa'],
    ['barrel', 'barrel'], ['candlemodel', 'candle'], ['firesheet', 'flames'],
  ].forEach(([k, d]) => hero('props', k, 'assets/models/horror/' + d + '/scene.gltf'));
  pk('props', 'clockpack', 'assets/models/horror/clockpack/scene.gltf');
  pk('props', 'cobwebpack', 'assets/models/horror/cobwebpack/scene.gltf');

  const PACKITEMS = {
    brokenclock: ['clockpack', 'clock007'], brokenclock2: ['clockpack', 'clock010'],
    cobwebA: ['cobwebpack', 'cobweb002'], cobwebB: ['cobwebpack', 'cobweb004'], cobwebC: ['cobwebpack', 'cobweb006'],
    crowbar: ['weapons', 'crowbarobj'], w_bat: ['weapons', 'baseballbatobj'], w_machete: ['weapons', 'macheteobj'],
    w_cleaver: ['weapons', 'cleaverobj'], w_axe: ['weapons', 'axeobj'], w_pipe: ['weapons', 'metalpipeobj'],
    w_sledge: ['weapons', 'sledgehammerobj'],
  };
  function extractPack(packKey) {
    const sc = PACKSCENES[packKey]; if (!sc) return;
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    Object.entries(PACKITEMS).forEach(([key, [pkKey, want]]) => {
      if (pkKey !== packKey || MODELS[key]) return;
      let node = null; sc.traverse((o) => { if (!node && o.isMesh && norm(o.name).includes(want)) node = o; });
      if (!node) { console.warn('pack item not found:', key, want); return; }
      node.updateWorldMatrix(true, false);
      const clone = node.clone(true);
      node.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
      const holder = new THREE.Group(); holder.add(clone);
      MODELS[key] = holder;
    });
  }

  // bounded queue: at most 4 root loads in flight; per-key dedupe; fail-soft
  const L = new GLTFLoader();
  const started = new Map();   // key -> promise
  const waiting = [];
  let active = 0, doneCount = 0, wantedCount = 0;
  const progressCbs = [];
  function pump() {
    while (active < 4 && waiting.length) {
      const job = waiting.shift(); active++;
      L.loadAsync(job.url)
        .then((g) => {
          if (job.kind === 'mob') { MOB[job.key] = g; if (job.key === 'ghost') MODELS.ghostGLB = g.scene; if (job.key === 'skel') MODELS.skelGLB = g.scene; }
          else if (job.kind === 'pack') { PACKSCENES[job.key] = g.scene; extractPack(job.key); }
          else MODELS[job.key] = g.scene;
        })
        .catch(() => console.warn('asset load failed (fallback stays):', job.key))
        .finally(() => { active--; doneCount++; progressCbs.forEach((cb) => { try { cb(doneCount, wantedCount); } catch (e) { } }); job.done(); pump(); });
    }
  }
  function loadKey(def) {
    if (started.has(def.key + '|' + def.group)) return started.get(def.key + '|' + def.group);
    wantedCount++;
    const p = new Promise((res) => { waiting.push({ ...def, done: res }); });
    started.set(def.key + '|' + def.group, p);
    pump();
    return p;
  }
  // resolves when every asset in the groups has settled (loaded or failed-soft)
  function loadGroups(names) {
    const defs = DEFS.filter((d) => names.includes(d.group));
    return Promise.all(defs.map(loadKey)).then(() => { });
  }
  function progress() { return { done: doneCount, wanted: wantedCount }; }
  return { loadGroups, progress, onProgress: (cb) => progressCbs.push(cb) };
})();

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
// Every particle system shares this soft radial dot — untextured THREE.Points
// render as hard SQUARES (the "floating boxes" from the playtest screenshots).
// Cache lives ON the function: callers run during init, before top-level lets.
function softDotTex() {
  if (softDotTex.t) return softDotTex.t;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (softDotTex.t = new THREE.CanvasTexture(c));
}
// The upper floors' ceiling: pressed-plaster coffers on a one-tile grid, wearing
// sixty years of water rings, hairline cracks, and the odd panel that came down
// to bare lath. One cached 512² canvas, tiled so each repeat spans 4 map tiles
// (panel seams land exactly on the 2.7 m tile grid).
function ceilingPlasterTex() {
  if (ceilingPlasterTex.t) return ceilingPlasterTex.t;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  let s = 909; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  x.fillStyle = '#8a877d'; x.fillRect(0, 0, 512, 512);
  // aged mottle — plaster never weathers evenly
  for (let i = 0; i < 260; i++) {
    const gl = 118 + (r() * 34 | 0);
    x.fillStyle = 'rgba(' + gl + ',' + (gl - 4) + ',' + (gl - 12) + ',' + (0.05 + r() * 0.08).toFixed(3) + ')';
    x.beginPath(); x.arc(r() * 512, r() * 512, 4 + r() * 26, 0, 6.283); x.fill();
  }
  // panel seams every 128 px (= one map tile) with a faint pressed inner bevel
  x.strokeStyle = 'rgba(40,38,32,0.45)'; x.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    x.beginPath(); x.moveTo(i * 128 + (i && i < 4 ? (r() - 0.5) * 2 : 0), 0); x.lineTo(i * 128, 512); x.stroke();
    x.beginPath(); x.moveTo(0, i * 128); x.lineTo(512, i * 128 + (i && i < 4 ? (r() - 0.5) * 2 : 0)); x.stroke();
  }
  x.strokeStyle = 'rgba(206,202,188,0.16)'; x.lineWidth = 1;
  for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) x.strokeRect(px * 128 + 10, py * 128 + 10, 108, 108);
  // water rings — brown-edged stains blooming through from the floor above
  for (let i = 0; i < 7; i++) {
    const sx = r() * 512, sy = r() * 512, rad = 22 + r() * 55;
    const gr = x.createRadialGradient(sx, sy, rad * 0.35, sx, sy, rad);
    gr.addColorStop(0, 'rgba(96,78,52,0.10)'); gr.addColorStop(0.82, 'rgba(88,66,38,0.16)');
    gr.addColorStop(0.94, 'rgba(70,50,26,0.34)'); gr.addColorStop(1, 'rgba(70,50,26,0)');
    x.fillStyle = gr; x.beginPath(); x.arc(sx, sy, rad, 0, 6.283); x.fill();
  }
  // hairline cracks wandering across the panels
  x.strokeStyle = 'rgba(38,36,30,0.5)'; x.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    let cx = r() * 512, cy = r() * 512, a = r() * 6.283;
    x.beginPath(); x.moveTo(cx, cy);
    for (let k = 0; k < 7; k++) { a += (r() - 0.5) * 1.1; cx += Math.cos(a) * (7 + r() * 15); cy += Math.sin(a) * (7 + r() * 15); x.lineTo(cx, cy); }
    x.stroke();
  }
  // two sagging patches: plaster half-gone, lath ghosting through — kept subtle
  // because this texture repeats every four tiles and hard black voids would
  // read as wallpaper under a flashlight
  for (let i = 0; i < 2; i++) {
    const px = 96 + r() * 320, py = 96 + r() * 320;
    x.fillStyle = 'rgba(32,30,26,0.55)';
    x.beginPath(); x.moveTo(px + 12 + r() * 8, py);
    for (let k = 1; k < 8; k++) { const a = k / 8 * 6.283; x.lineTo(px + Math.cos(a) * (9 + r() * 12), py + Math.sin(a) * (9 + r() * 12)); }
    x.closePath(); x.fill();
    x.strokeStyle = 'rgba(70,58,40,0.45)'; x.lineWidth = 2;
    for (let k = -1; k <= 1; k++) { x.beginPath(); x.moveTo(px - 15, py + k * 6); x.lineTo(px + 15, py + k * 6); x.stroke(); }
    x.strokeStyle = 'rgba(38,36,30,0.5)'; x.lineWidth = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(World.W / 4, World.H / 4);
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (ceilingPlasterTex.t = t);
}
// The walk-up's worn dirt path: bare trodden earth down the middle, edges
// dissolving into the pine needles (alpha), two faint foot-worn ruts.
function dirtPathTex() {
  if (dirtPathTex.t) return dirtPathTex.t;
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const x = c.getContext('2d');
  let s = 5150; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  // bare-earth blobs bunched toward the centre line, thinning to nothing at the edges
  for (let i = 0; i < 900; i++) {
    const cx = 64 + (r() + r() - 1) * 44, cy = r() * 512;
    const edge = 1 - Math.min(1, Math.abs(cx - 64) / 58);
    const tone = 52 + r() * 26;
    x.fillStyle = 'rgba(' + (tone + 14 | 0) + ',' + (tone | 0) + ',' + (tone * 0.62 | 0) + ',' + (0.14 + edge * 0.5 * r()).toFixed(3) + ')';
    x.beginPath(); x.arc(cx, cy, 3 + r() * 9, 0, 6.283); x.fill();
  }
  // two foot-worn ruts wandering down the length
  for (const off of [-13, 13]) {
    x.strokeStyle = 'rgba(34,28,18,0.35)'; x.lineWidth = 7;
    x.beginPath(); x.moveTo(64 + off + (r() - 0.5) * 6, 0);
    for (let yy = 32; yy <= 512; yy += 32) x.lineTo(64 + off + (r() - 0.5) * 10, yy);
    x.stroke();
  }
  // scattered stones pressed into the tread
  for (let i = 0; i < 40; i++) {
    const gl = 96 + r() * 50 | 0;
    x.fillStyle = 'rgba(' + gl + ',' + gl + ',' + (gl - 8) + ',' + (0.3 + r() * 0.4).toFixed(2) + ')';
    x.beginPath(); x.arc(64 + (r() - 0.5) * 70, r() * 512, 1 + r() * 2.5, 0, 6.283); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 5); t.anisotropy = 4;
  return (dirtPathTex.t = t);
}
// The cracked concrete apron at the foot of the front steps.
function crackedApronTex() {
  if (crackedApronTex.t) return crackedApronTex.t;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  let s = 1928; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  x.fillStyle = '#7d7f82'; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 120; i++) {
    const gl = 110 + r() * 32 | 0;
    x.fillStyle = 'rgba(' + gl + ',' + gl + ',' + (gl + 3) + ',' + (0.06 + r() * 0.1).toFixed(3) + ')';
    x.beginPath(); x.arc(r() * 256, r() * 128, 3 + r() * 14, 0, 6.283); x.fill();
  }
  // expansion joints, then the cracks that ignored them
  x.strokeStyle = 'rgba(44,45,48,0.6)'; x.lineWidth = 2;
  for (const jx of [85, 170]) { x.beginPath(); x.moveTo(jx, 0); x.lineTo(jx, 128); x.stroke(); }
  x.strokeStyle = 'rgba(38,38,40,0.65)'; x.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let cx = r() * 256, cy = r() * 128, a = r() * 6.283;
    x.beginPath(); x.moveTo(cx, cy);
    for (let k = 0; k < 6; k++) { a += (r() - 0.5) * 1.2; cx += Math.cos(a) * (6 + r() * 14); cy += Math.sin(a) * (6 + r() * 14); x.lineTo(cx, cy); }
    x.stroke();
  }
  // moss creeping in from the corners
  for (let i = 0; i < 26; i++) {
    const nearX = r() < 0.5 ? r() * 46 : 256 - r() * 46, nearY = r() < 0.5 ? r() * 30 : 128 - r() * 30;
    x.fillStyle = 'rgba(38,52,32,' + (0.10 + r() * 0.2).toFixed(2) + ')';
    x.beginPath(); x.arc(nearX, nearY, 3 + r() * 9, 0, 6.283); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (crackedApronTex.t = t);
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
  const m = new THREE.PointsMaterial({ map: softDotTex(), color: 0xc9ba98, size: 0.018, transparent: true,
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
  // One hinged leaf per room. Unlocked doors remember their open/closed state
  // across floor revisits; locked leaves remain shut until interacted with.
  const mat = new THREE.MeshStandardMaterial({ map: TEX.doorD, color: locked ? 0x9a5050 : 0x9a8a76, roughness: .85, emissive: locked ? 0x300000 : 0x000000 });
  const hinge = new THREE.Group();
  hinge.position.set(wx - TILE_M * 0.44, 0, wz);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(TILE_M * 0.88, WALL_H * 0.92, 0.14), mat);
  leaf.position.set(TILE_M * 0.44, WALL_H * 0.46, 0);
  leaf.castShadow = true;
  hinge.add(leaf);
  // deterministic per-door swing so it doesn't change on revisit
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  const openYaw = (0.9 + (h % 80) / 100) * ((h >> 3) % 2 ? 1 : -1);
  const stateKey = player.floor + ':' + x + ',' + y;
  const closed = locked || doorStates.get(stateKey) === true;
  hinge.rotation.y = closed ? 0 : openYaw;
  floorGroup.add(hinge);
  doorMeshes.set(x + ',' + y, {
    g: hinge, m: leaf, x, y, stateKey, openYaw,
    locked: !!locked, closed, blocked: closed, targetYaw: closed ? 0 : openYaw,
  });
}
function addCandle(wx, wz) {
  // a real cluster of melted candles when the model is in; procedural fallback otherwise
  const HM = window.HeroModels || {};
  let flameY = 1.1;
  if (HM.candlemodel) {
    const cm = HM.candlemodel.clone();
    let b = new THREE.Box3().setFromObject(cm);
    const h = (b.max.y - b.min.y) || 1;
    cm.scale.setScalar(0.5 / h);
    b = new THREE.Box3().setFromObject(cm);
    const ctr = b.getCenter(new THREE.Vector3());
    cm.position.set(wx - ctr.x, -b.min.y, wz - ctr.z);
    cm.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.frustumCulled = true; } });
    floorGroup.add(cm);
    flameY = 0.52;
  } else {
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd07a }));
    flame.position.set(wx, flameY, wz);
    floorGroup.add(flame);
  }
  const light = new THREE.PointLight(0xffb455, 1.4, 5.5, 2);
  light.position.set(wx, flameY, wz);
  floorGroup.add(light);
  // a soft warm glow halo so the flame reads as a bright bloom in the dark
  const halo = glowSprite('rgba(255,190,110,0.9)', 0.9, wx, flameY + 0.02, wz, 0.7);
  candleLights.push({ light, base: 1.4, halo });
}
// ============================================================ atmosphere pass
// Cobwebs in the corners, pipes and conduit along the ceilings, volumetric light
// shafts under the corridor fixtures, low drifting fog, and water dripping from
// the ceilings of the wet rooms. Runs once per floor build.
let webTex = null;
function cobwebTex() {
  if (webTex) return webTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.strokeStyle = 'rgba(210,214,220,0.5)'; x.lineWidth = 1;
  for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(4, 4); const a = (i / 9) * (Math.PI / 2); x.lineTo(4 + Math.cos(a) * 150, 4 + Math.sin(a) * 150); x.stroke(); }
  for (let r = 14; r < 128; r += 15) { x.beginPath(); for (let i = 0; i <= 9; i++) { const a = (i / 9) * (Math.PI / 2); const px = 4 + Math.cos(a) * r, py = 4 + Math.sin(a) * r; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
  return (webTex = new THREE.CanvasTexture(c));
}
function addAtmosphere(fi) {
  fogWisps = []; atmoDrips = []; atmoShafts = [];
  const rooms = data.floors[fi].rooms || [];
  const g = data.floors[fi].grid;
  let seed = 31337 + fi * 613;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const webMat = new THREE.MeshBasicMaterial({ map: cobwebTex(), transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.8, metalness: 0.3 });
  const wetRooms = ['bath', 'morgue', 'boiler', 'incinerator', 'laundry', 'kitchen', 'autopsy', 'storage'];

  rooms.forEach((r) => {
    // cobwebs strung across the top corners
    const nWeb = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < nWeb; i++) {
      const cx = (rnd() < 0.5 ? r.x + 0.9 : r.x + r.w - 0.9), cz = (rnd() < 0.5 ? r.y + 0.9 : r.y + r.h - 0.9);
      const web = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), webMat);
      web.position.set(cx * TILE_M, WALL_H - 0.5 - rnd() * 0.4, cz * TILE_M);
      web.rotation.set(-0.5, rnd() * 6.28, rnd() * 0.6); floorGroup.add(web);
    }
    // dripping water in the wet rooms
    if (wetRooms.includes(r.tag) && rnd() < 0.85) {
      const dx = (r.x + 1 + Math.floor(rnd() * Math.max(1, r.w - 2))), dz = (r.y + 1 + Math.floor(rnd() * Math.max(1, r.h - 2)));
      if (g[dz] && g[dz][dx] === TILE.FLOOR) addDrip(dx + 0.5, dz + 0.5);
    }
    // a thin, low ground-haze drifting through the bigger/worse rooms
    if (r.w >= 4 && r.h >= 4 && rnd() < 0.5) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(140,150,165,0.35)'), transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.NormalBlending, fog: true }));
      const sz = 3.5 + rnd() * 2.5; s.scale.set(sz, sz * 0.34, 1);   // wide + flat = a haze, not a ball
      s.position.set((r.cx + 0.5) * TILE_M, 0.28 + rnd() * 0.15, (r.cy + 0.5) * TILE_M);
      floorGroup.add(s);
      fogWisps.push({ s, x0: s.position.x, z0: s.position.z, phase: rnd() * 6.28, amp: 1 + rnd() * 1.3, tgt: 0.05 + rnd() * 0.06 });
    }
  });

  // corridors: ceiling pipes running the length + light shafts under the pendants
  [data.CORR_TOP, data.CORR_BOT].forEach((cy, ci) => {
    if (cy == null) return;
    const pz = (cy + 0.5) * TILE_M;
    for (const off of [-0.6, 0.0, 0.7]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05 + rnd() * 0.03, 0.05, (World.W - 8) * TILE_M, 7), pipeMat);
      pipe.rotation.z = Math.PI / 2; pipe.position.set((World.W / 2) * TILE_M, WALL_H - 0.18 - Math.abs(off) * 0.12, pz + off);
      floorGroup.add(pipe);
    }
    for (let x = 6; x < World.W - 6; x += 10 + Math.floor(rnd() * 4)) {
      if (g[cy] && g[cy][x] === TILE.FLOOR) {
        const shaft = lightShaft((x + 0.5) * TILE_M, pz, 0xbcd0e8, 0.7, 0.035);
        atmoShafts.push({ m: shaft, base: 0.035, phase: rnd() * 6.28 });
      }
    }
  });
  // the odd faint god-ray from a tall room fixture
  rooms.forEach((r) => { if (r.w >= 5 && rnd() < 0.3) { const shaft = lightShaft((r.cx + 0.5) * TILE_M, (r.cy + 0.5) * TILE_M, 0xffe6b0, 0.85, 0.03); atmoShafts.push({ m: shaft, base: 0.03, phase: rnd() * 6.28 }); } });
}
function addDrip(wx, wz) {
  const N = 5, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = wx * TILE_M + (Math.random() - 0.5) * 0.1; pos[i * 3 + 1] = WALL_H - Math.random() * WALL_H; pos[i * 3 + 2] = wz * TILE_M + (Math.random() - 0.5) * 0.1; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDotTex(), color: 0x9fb4c4, size: 0.05, transparent: true, opacity: 0.7, depthWrite: false }));
  floorGroup.add(pts);
  atmoDrips.push({ pts, pos, wx: wx * TILE_M, wz: wz * TILE_M, vy: new Float32Array(N).map(() => 1 + Math.random() * 2) });
  // a small dark puddle where it lands
  const pud = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), new THREE.MeshStandardMaterial({ color: 0x10161c, roughness: 0.25, metalness: 0.4, transparent: true, opacity: 0.85 }));
  pud.rotation.x = -Math.PI / 2; pud.position.set(wx * TILE_M, 0.036, wz * TILE_M); floorGroup.add(pud);
}
function updateAtmosphere(dt) {
  const t = performance.now() / 1000;
  for (const w of fogWisps) {
    w.s.position.x = w.x0 + Math.sin(t * 0.12 + w.phase) * w.amp;
    w.s.position.z = w.z0 + Math.cos(t * 0.09 + w.phase) * w.amp * 0.6;
    w.s.material.opacity += (w.tgt - w.s.material.opacity) * Math.min(1, dt * 0.6);
  }
  for (const d of atmoDrips) {
    const p = d.pos; let moved = false;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] -= d.vy[i / 3] * dt; moved = true;
      if (p[i + 1] < 0.05) { p[i + 1] = WALL_H - 0.1; }
    }
    if (moved) d.pts.geometry.attributes.position.needsUpdate = true;
  }
  for (const s of atmoShafts) { s.m.material.opacity = s.base * (0.65 + Math.abs(Math.sin(t * 0.7 + s.phase)) * 0.7); }
}
// ---- shared glow (fake bloom) + volumetric light shaft helpers ----
function glowSprite(hex, size, x, y, z, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex(hex), transparent: true, opacity: opacity == null ? 0.6 : opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1); s.position.set(x, y, z); floorGroup.add(s); return s;
}
let shaftTex = null;
function lightShaftTex() {
  if (shaftTex) return shaftTex;
  const c = document.createElement('canvas'); c.width = 32; c.height = 128; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(0.5, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 128);
  return (shaftTex = new THREE.CanvasTexture(c));
}
// a soft cone of light falling from a ceiling fixture to the floor (VR-cheap, no real light)
function lightShaft(wx, wz, color, radius, opacity) {
  const geo = new THREE.ConeGeometry(radius || 0.85, WALL_H - 0.2, 14, 1, true);
  const mat = new THREE.MeshBasicMaterial({ map: lightShaftTex(), color: color || 0xffe6b0, transparent: true,
    opacity: opacity == null ? 0.09 : opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(wx, (WALL_H - 0.2) / 2 + 0.1, wz);   // apex at the ceiling fixture, spreading to the floor
  floorGroup.add(m);
  return m;
}
const STAIR_TUNE = { runM: 5.4, edgeM: 0.7 };
function addStairs(wx, wz, up) {
  const model = (window.HeroModels || {}).staircase;
  const tileY = Math.floor(wz / TILE_M);
  const ct = data.CORR_TOP, cb = data.CORR_BOT;
  if (model && ct != null && cb != null) {
    const s = model.clone();
    let b = new THREE.Box3().setFromObject(s); const sz = b.getSize(new THREE.Vector3());
    const run = Math.max(sz.x, sz.z) || 1;         // the model's long (run/climb) axis
    s.scale.setScalar(STAIR_TUNE.runM / run);
    if (sz.x >= sz.z) s.rotation.y = Math.PI / 2;  // align the run to world Z (corridor depth)
    b = new THREE.Box3().setFromObject(s); const ctr = b.getCenter(new THREE.Vector3()); const bs = b.getSize(new THREE.Vector3());
    s.position.x -= ctr.x; s.position.z -= ctr.z; s.position.y -= b.min.y;
    s.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.color) o.material.color.multiplyScalar(0.82); if (o.material.roughness != null) o.material.roughness = Math.min(1, o.material.roughness + 0.15); o.frustumCulled = true; } });
    const g = new THREE.Group(); g.add(s);
    // the flight CLIMBS INTO the outer wall — you walk up it and the building
    // takes you. Its top is flush with the wall face, its base opens onto the
    // corridor, right over the transition tile.
    const topEdge = Math.abs(tileY - ct) <= Math.abs(tileY - cb);
    g.rotation.y = topEdge ? Math.PI : 0;   // top-edge flight faces the corridor, climbing -z into the wall
    const wallFace = topEdge ? ct * TILE_M : (cb + 1) * TILE_M;
    const centerZ = topEdge ? wallFace + bs.z / 2 : wallFace - bs.z / 2;
    g.position.set(wx, 0, centerZ);
    floorGroup.add(g);
    // colliders: side railings the full run (you can't strafe through the rails)
    // and a block at the top against the wall — but the base and the transition
    // tile stay open so walking UP the flight still changes floors.
    const halfW = Math.min(bs.x / 2, 0.85);
    const z0 = Math.min(wallFace, topEdge ? wallFace + bs.z : wallFace - bs.z);
    const z1 = Math.max(wallFace, topEdge ? wallFace + bs.z : wallFace - bs.z);
    propSolids.push({ x0: wx - halfW - 0.14, z0, x1: wx - halfW + 0.02, z1 });      // left rail
    propSolids.push({ x0: wx + halfW - 0.02, z0, x1: wx + halfW + 0.14, z1 });      // right rail
    const topBlockZ = topEdge ? [wallFace, wallFace + 0.55] : [wallFace - 0.55, wallFace];
    propSolids.push({ x0: wx - halfW, z0: topBlockZ[0], x1: wx + halfW, z1: topBlockZ[1] });   // top of the flight
    // a dim glowing STAIRS sign floating at the base, so nobody mistakes a doorway
    const signC = document.createElement('canvas'); signC.width = 256; signC.height = 64;
    const sx2 = signC.getContext('2d');
    sx2.fillStyle = '#06140a'; sx2.fillRect(0, 0, 256, 64);
    sx2.fillStyle = '#57d47f'; sx2.font = "bold 34px 'Special Elite', monospace"; sx2.textAlign = 'center';
    sx2.fillText(up ? 'STAIRS ▲' : 'STAIRS ▼', 128, 44);
    const signT = new THREE.CanvasTexture(signC); if ('colorSpace' in signT) signT.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.18),
      new THREE.MeshBasicMaterial({ map: signT, transparent: true, opacity: 0.85, fog: false, side: THREE.DoubleSide }));
    const signZ = topEdge ? wallFace + bs.z + 0.25 : wallFace - bs.z - 0.25;
    sign.position.set(wx, 2.05, signZ);
    sign.rotation.y = topEdge ? 0 : Math.PI;
    floorGroup.add(sign);
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: .95 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(TILE_M * 0.8, 0.5, TILE_M * 0.8), mat);
    m.position.set(wx, 0.25, wz); floorGroup.add(m);
  }
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
  exitRec = { x: wx / TILE_M, y: wz / TILE_M };
  // The chained leaves are solid. The player uses them from the interior tile
  // instead of walking through a closed mesh to trigger the ending.
  propSolids.push({ x0: wx - TILE_M * 0.49, z0: wz - 0.13, x1: wx + TILE_M * 0.49, z1: wz + 0.16 });
}
function mkBox(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
function addLocker(wx, wz) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x30323c, metalness: .3, roughness: .7 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(TILE_M * 0.6, WALL_H * 0.8, TILE_M * 0.4), mat);
  m.position.set(wx, WALL_H * 0.4, wz); m.castShadow = true;
  floorGroup.add(m);
  hideTiles.push({ x: wx / TILE_M, y: wz / TILE_M });
  propSolids.push({ x0: wx - TILE_M * 0.3, z0: wz - TILE_M * 0.2, x1: wx + TILE_M * 0.3, z1: wz + TILE_M * 0.2 });
}

const ITEM_COLORS = { flashlight: 0xffe08a, battery: 0x8affa0, emf: 0x7ad0ff, spiritbox: 0xc99cff, candlekit: 0xffb86b, key: 0xffd24a, draught: 0x9ae0c8, backpack: 0xb08a5a, medkit: 0xff8a8a, teddy: 0xd8a06a, lantern: 0xffc04a, anchor: 0xd8b24a, censer: 0xe0c060, ward: 0xfff0c0, weapon: 0xb8c2cc, matches: 0xffa04a };
function addItemMesh(it) {
  const col = ITEM_COLORS[it.type] || 0xffffff;
  const g = new THREE.Group();
  // the seven teddies are REAL bears now — a ceramic children's bear sitting in
  // the dark, googly eyes catching the flashlight, with a soft locator glow
  if (it.type === 'teddy' && (window.HeroModels || {}).scarebear) {
    const bear = window.HeroModels.scarebear.clone();
    let b = new THREE.Box3().setFromObject(bear);
    const h = (b.max.y - b.min.y) || 1;
    bear.scale.setScalar(0.34 / h);
    b = new THREE.Box3().setFromObject(bear);
    const ctr = b.getCenter(new THREE.Vector3());
    bear.position.set(-ctr.x, -b.min.y, -ctr.z);
    bear.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.map) o.material.map.anisotropy = 4; o.frustumCulled = true; } });
    let hsh = 0; for (const ch of String(it.id)) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
    bear.rotation.y = (hsh % 628) / 100;   // each bear faces its own way, every night the same
    g.add(bear);
    const glowB = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(255,255,255,0.85)'), color: 0xd8a06a, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    glowB.scale.set(0.55, 0.55, 1); glowB.position.y = 0.2; g.add(glowB);
    g.position.set((it.x + 0.5) * TILE_M, 0.02, (it.y + 0.5) * TILE_M);   // it sits on the floor, like it was left there
    floorGroup.add(g);
    itemMeshes.set(it.id, g);
    return;
  }
  // the matchbox is a REAL box of matches spilled on the kitchen counter-height —
  // small, warm-glowing, exactly where a cook would have left them
  if (it.type === 'matches' && (window.HeroModels || {}).matches) {
    const m = window.HeroModels.matches.clone();
    let b = new THREE.Box3().setFromObject(m);
    const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) || 1;
    m.scale.setScalar(0.32 / w);
    b = new THREE.Box3().setFromObject(m);
    const ctr = b.getCenter(new THREE.Vector3());
    m.position.set(-ctr.x, -b.min.y, -ctr.z);
    m.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); if (o.material.map) o.material.map.anisotropy = 4; o.frustumCulled = true; } });
    g.add(m);
    const glowM = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(255,255,255,0.85)'), color: 0xffa04a, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    glowM.scale.set(0.5, 0.5, 1); glowM.position.y = 0.12; g.add(glowM);
    g.position.set((it.x + 0.5) * TILE_M, 0.9, (it.y + 0.5) * TILE_M);   // counter height by the stove
    floorGroup.add(g);
    itemMeshes.set(it.id, g);
    return;
  }
  // weapons lie on the floor as their REAL models — dropped or placed
  const wKind = it.type === 'weapon' ? ((it.kind && WEAPONS[it.kind]) ? it.kind : (WEAPONS[it.id] ? it.id : 'crowbar')) : null;
  if (wKind && (window.HeroModels || {})[WEAPONS[wKind].model]) {
    const cfg = WEAPONS[wKind];
    const m = window.HeroModels[cfg.model].clone();
    let b = new THREE.Box3().setFromObject(m);
    const ref = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
    m.scale.setScalar(cfg.scale / ref);
    m.rotation.set(Math.PI / 2, 0, 0);   // lying flat
    let hsh = 0; for (const ch of String(it.id)) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
    const hold = new THREE.Group(); hold.add(m); hold.rotation.y = (hsh % 628) / 100;
    const b2 = new THREE.Box3().setFromObject(hold);
    hold.position.y = -b2.min.y + 0.015;
    m.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.frustumCulled = true; } });
    g.add(hold);
    const glowW = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(255,255,255,0.8)'), color: 0xb8c2cc, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    glowW.scale.set(0.55, 0.55, 1); glowW.position.y = 0.12; g.add(glowW);
    g.position.set((it.x + 0.5) * TILE_M, 0.02, (it.y + 0.5) * TILE_M);
    floorGroup.add(g);
    itemMeshes.set(it.id, g);
    return;
  }
  // the dropped flashlight — a real light source lying where you left it,
  // beam raking the floor, waiting for you to come back for it
  if (it.type === 'flashlight' && it.dropped) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.19, 10),
      new THREE.MeshStandardMaterial({ color: 0x22262c, metalness: 0.5, roughness: 0.5 }));
    body.rotation.z = Math.PI / 2; body.position.y = 0.035; g.add(body);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.028, 10),
      new THREE.MeshBasicMaterial({ color: it.lit ? 0xfff2d6 : 0x2a2a2a }));
    lens.rotation.y = -Math.PI / 2; lens.position.set(0.098, 0.035, 0); g.add(lens);
    const spot = new THREE.SpotLight(0xfff2d6, 20, LIGHT_RANGE * TILE_M * 0.7, CONE, 0.5, 1.3);
    spot.position.set(0.1, 0.05, 0);
    const tgt = new THREE.Object3D(); tgt.position.set(6, 0.05, 0);
    g.add(tgt); spot.target = tgt; g.add(spot);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(255,240,210,0.9)'), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(0.5, 0.5, 1); halo.position.set(0.1, 0.05, 0); g.add(halo);
    spot.visible = halo.visible = !!it.lit;
    g.userData.dropLight = { spot, halo, lens };
    let hsh2 = 0; for (const ch of String(it.id)) hsh2 = (hsh2 * 31 + ch.charCodeAt(0)) | 0;
    g.rotation.y = (hsh2 % 628) / 100;
    g.position.set((it.x + 0.5) * TILE_M, 0.02, (it.y + 0.5) * TILE_M);
    floorGroup.add(g);
    itemMeshes.set(it.id, g);
    return;
  }
  const isRite = it.type === 'anchor' || it.type === 'censer';
  // Rite relics read as a larger, slowly-turning octahedron in a cold gold — set apart from loot.
  const mesh = new THREE.Mesh(
    isRite ? new THREE.OctahedronGeometry(0.2, 0) : new THREE.IcosahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: isRite ? 0.8 : 1.1, roughness: .3 }));
  g.add(mesh);   // emissive core — no per-item PointLight (Quest perf)
  // a soft additive glow halo so pickups bloom and are findable in the dark
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(255,255,255,0.85)'), color: col, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(0.7, 0.7, 1); g.add(glow);
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
  barrel:      { by: 'h',    size: 0.95, tint: 0x6a4a2a, tintAmt: 0.30 },
  hospbed:     { by: 'long', size: 2.05, tint: 0x8a8f86, tintAmt: 0.25 },
  horrorbed:   { by: 'long', size: 2.00, tint: 0x7a6a5a, tintAmt: 0.25 },
  gurney:      { by: 'long', size: 2.05, tint: 0x9098a0, tintAmt: 0.20 },
  wheelchair:  { by: 'h',    size: 1.10, tint: 0x60666e, tintAmt: 0.30 },
  rewheelchair:{ by: 'h',    size: 1.10, tint: 0x60666e, tintAmt: 0.30 },
  clock:       { by: 'h',    size: 2.10, tint: 0x3a2a1a, tintAmt: 0.35 },
  caftable:    { by: 'long', size: 1.70, tint: 0x6a5238, tintAmt: 0.30, retex: 'wood' },   // model ships a flat-grey map — give it real worn wood
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
  // batch 3 — clutter & set-pieces
  evidenceboard:{ by: 'long', size: 1.85, tint: 0x9a8f7a, tintAmt: 0.10, mount: 'wall' },
  cannedgoods: { by: 'long', size: 0.62, tint: 0x8a8a86, tintAmt: 0.14 },
  toolset:     { by: 'long', size: 0.66, tint: 0x8a8580, tintAmt: 0.16 },
  kitchenware: { by: 'long', size: 1.05, tint: 0x9098a0, tintAmt: 0.16 },
  brokenclock: { by: 'h',    size: 0.40, tint: 0x8a8578, tintAmt: 0.14, mount: 'wall', delight: true },
  brokenclock2:{ by: 'h',    size: 0.42, tint: 0x8a8578, tintAmt: 0.14, mount: 'wall', delight: true },
  cobwebA:     { by: 'long', size: 1.10, tint: 0xcfd6de, tintAmt: 0.10, mount: 'ceiling', web: true },
  cobwebB:     { by: 'long', size: 1.30, tint: 0xcfd6de, tintAmt: 0.10, mount: 'ceiling', web: true },
  cobwebC:     { by: 'long', size: 1.15, tint: 0xcfd6de, tintAmt: 0.10, mount: 'ceiling', web: true },
  // batch 4
  crowbar:     { by: 'long', size: 0.60, tint: 0x5a4a42, tintAmt: 0.20, mount: 'flat' },
  scarebear:   { by: 'h',    size: 0.85, tint: 0x8a7a68, tintAmt: 0.30 },   // the big one in the nursery
  elecbox:     { by: 'long', size: 1.75, tint: 0x8a8580, tintAmt: 0.15 },
  ventvalve:   { by: 'long', size: 0.55, tint: 0x5a5e64, tintAmt: 0.25, mount: 'ceiling' },
  ouija:       { by: 'long', size: 2.60, tint: 0xbfc2c8, tintAmt: 0.08, mount: 'flat' },
  wallphone:   { by: 'h',    size: 0.72, tint: 0x4a3a2c, tintAmt: 0.18, mount: 'wall' },
  radiator:    { by: 'long', size: 1.15, tint: 0x6a5a4a, tintAmt: 0.22 },
  mirrorh:     { by: 'h',    size: 0.92, tint: 0x9aa2aa, tintAmt: 0.12, mount: 'wall' },
  bathcounter: { by: 'long', size: 1.45, tint: 0x8a8578, tintAmt: 0.18 },
  bloodysofa:  { by: 'long', size: 2.25, tint: 0x6a5f58, tintAmt: 0.20 },
  piano:       { by: 'long', size: 1.55, tint: 0x2a2420, tintAmt: 0.22 },
  planks:      { by: 'long', size: 1.35, tint: 0x6a5236, tintAmt: 0.20, mount: 'wall' },
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
  const retexMap = (cfg.retex && TEX.propTex) ? TEX.propTex[cfg.retex] : null;
  obj.traverse((o) => {
    if (!(o.isMesh && o.material)) return;
    let m = o.material.clone();
    if (cfg.delight && m.isMeshBasicMaterial) {   // unlit -> lit so it darkens with the scene
      m = new THREE.MeshStandardMaterial({ map: m.map, color: (m.color ? m.color.clone() : new THREE.Color(0xffffff)), roughness: 0.7, metalness: 0.05 });
    }
    if (retexMap) { m.map = retexMap; if (m.metalness != null) m.metalness = 0.1; m.needsUpdate = true; }
    if (m.map) m.map.anisotropy = 4;   // crisp at grazing angles, not smeared
    if (m.color) m.color.lerp(new THREE.Color(cfg.tint), cfg.tintAmt);
    if (m.roughness != null) m.roughness = Math.min(1, m.roughness + 0.2);
    if (cfg.web) { m.transparent = true; m.depthWrite = false; m.side = THREE.DoubleSide; if (!(m.opacity < 1)) m.opacity = 0.9; }
    o.material = m; o.frustumCulled = true;
  });
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
  storage:    [['metalcab', 0.7], ['barrel', 0.6], ['shovel', 0.6], ['locker', 0.5]],
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
  incinerator:[['shovel', 0.7], ['barrel', 0.7], ['metalcab', 0.5], ['wallblood', 0.5]],
  boiler:     [['barrel', 0.9], ['shovel', 0.6], ['barrel', 0.6], ['metalcab', 0.5]],
  laundry:    [['metalcab', 0.6], ['barrel', 0.5], ['shovel', 0.4]],
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
  // never let furniture intersect furniture that's already there (incl. props.js pieces)
  const solidsOverlap = (b, mount) => {
    if (mount === 'ceiling' || mount === 'wall') return false;
    const pad = 0.06;   // allow a whisker of contact, never interpenetration
    for (const s of propSolids)
      if (b.min.x + pad < s.x1 && b.max.x - pad > s.x0 && b.min.z + pad < s.z1 && b.max.z - pad > s.z0) return true;
    return false;
  };
  const claim = (b) => {   // mark every tile the footprint covers so nothing else lands there
    for (let ty = Math.floor(b.min.z / TILE_M); ty <= Math.floor(b.max.z / TILE_M); ty++)
      for (let tx = Math.floor(b.min.x / TILE_M); tx <= Math.floor(b.max.x / TILE_M); tx++)
        used.add(tx + ',' + ty);
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
    if (solidsOverlap(b, mount)) return false;         // would sit inside other furniture
    grp.add(p.grp);
    if (p.solid) { propSolids.push({ x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z }); claim(b); }
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
  // ---- arranged layouts: furniture set up like a real room, only a little disturbed ----
  // world-space placement (footprint-checked) for smooth, aligned rows
  const placeW = (key, wx, wz, yaw) => {
    const cfg = HPROP_CFG[key]; const mount = (cfg && cfg.mount) || 'floor';
    const tx = Math.floor(wx / TILE_M), ty = Math.floor(wz / TILE_M);
    if (!isFloor(tx, ty)) return false;
    const p = makeHProp(key, wx, wz, yaw); if (!p) return false;
    const b = new THREE.Box3().setFromObject(p.grp);
    if (!footprintClear(b, mount)) return false;
    if (solidsOverlap(b, mount)) return false;   // rows skip a slot rather than merge into other furniture
    grp.add(p.grp);
    if (p.solid) { propSolids.push({ x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z }); claim(b); }
    return b;   // truthy; callers can read the box (for stacking things on top)
  };
  // set something ON a surface (a table top, a mattress) — no collision, no wall test
  const placeTop = (key, wx, wz, yaw, topY) => {
    const p = makeHProp(key, wx, wz, yaw); if (!p) return false;
    p.grp.position.y = topY - 0.015;   // settle a hair into the surface, never float
    grp.add(p.grp);
    return true;
  };
  // mostly-tidy facing, but every so often something's been knocked out of place
  const askew = (base) => (base || 0) + (rnd() < 0.15 ? (rnd() - 0.5) * 0.85 : (rnd() - 0.5) * 0.13);
  // a neat row of `key` along a wall of room r. side N/S/E/W. inset = tiles off the wall.
  const wallRow = (r, side, key, inset, yaw, step, limit, out) => {
    step = step || 2.0; let n = 0;
    const tryAt = (wx, wz) => {
      const yw = askew(yaw);
      const b = placeW(key, wx, wz, yw);
      if (b) { n++; if (out) out.push({ wx, wz, yaw: yw, top: b.max.y }); }
    };
    if (side === 'N' || side === 'S') {
      const tz = side === 'N' ? r.y + inset : r.y + r.h - inset;
      for (let tx = r.x + 1.2; tx <= r.x + r.w - 1.1; tx += step) { if (limit && n >= limit) break; tryAt(tx * TILE_M, tz * TILE_M); }
    } else {
      const tx = side === 'W' ? r.x + inset : r.x + r.w - inset;
      for (let tz = r.y + 1.2; tz <= r.y + r.h - 1.1; tz += step) { if (limit && n >= limit) break; tryAt(tx * TILE_M, tz * TILE_M); }
    }
    return n;
  };
  const centerP = (r, key, yaw, ox, oz) => placeW(key, (r.cx + 0.5 + (ox || 0)) * TILE_M, (r.cy + 0.5 + (oz || 0)) * TILE_M, askew(yaw));
  const bed = () => (rnd() < 0.5 ? 'hospbed' : 'horrorbed');
  // hang a wall item (board / clock) flush against a wall, facing into the room.
  // The tile BEHIND the mount must be actual WALL — never a doorway or open floor,
  // or the thing hangs in mid-air (the floating-clock bug from real Quest play).
  const wallAt = (tx, ty) => g[ty] && g[ty][tx] === TILE.WALL;
  const wallMount = (r, key, sidePref) => {
    const sides = sidePref ? [sidePref] : ['N', 'S', 'E', 'W'].sort(() => rnd() - 0.5);
    for (const side of sides) for (let t = 0; t < 5; t++) {
      let tx, tz, yaw, ox = 0, oz = 0, nx = 0, nz = 0;
      if (side === 'N') { tx = r.x + 1 + Math.floor(rnd() * (r.w - 2)); tz = r.y + 1; yaw = 0; oz = -0.42; nz = -1; }
      else if (side === 'S') { tx = r.x + 1 + Math.floor(rnd() * (r.w - 2)); tz = r.y + r.h - 2; yaw = Math.PI; oz = 0.42; nz = 1; }
      else if (side === 'W') { tz = r.y + 1 + Math.floor(rnd() * (r.h - 2)); tx = r.x + 1; yaw = Math.PI / 2; ox = -0.42; nx = -1; }
      else { tz = r.y + 1 + Math.floor(rnd() * (r.h - 2)); tx = r.x + r.w - 2; yaw = -Math.PI / 2; ox = 0.42; nx = 1; }
      if (!isFloor(tx, tz)) continue;
      if (!wallAt(tx + nx, tz + nz)) continue;   // nothing to hang it on — try elsewhere
      if (placeW(key, (tx + 0.5 + ox) * TILE_M, (tz + 0.5 + oz) * TILE_M, yaw)) return true;
    }
    return false;
  };
  // a cobweb up in a room corner (ceiling-mounted, no collision)
  const cornerWeb = (r) => {
    const web = ['cobwebA', 'cobwebB', 'cobwebC'][Math.floor(rnd() * 3)];
    const cs = [[r.x + 1, r.y + 1, Math.PI * 0.25], [r.x + r.w - 2, r.y + 1, -Math.PI * 0.25],
                [r.x + 1, r.y + r.h - 2, Math.PI * 0.75], [r.x + r.w - 2, r.y + r.h - 2, -Math.PI * 0.75]];
    const c = cs[Math.floor(rnd() * 4)];
    place(web, c[0], c[1], c[2]);
  };
  const CAT = {
    ward: 'ward', recovery: 'ward', iso: 'ward', room207: 'ward', maternity: 'ward', mose: 'ward', quarters: 'ward',
    surgery: 'clinic', autopsy: 'clinic', xray: 'clinic', er: 'clinic', admitting: 'clinic',
    morgue: 'morgue', pharmacy: 'store', supply: 'store', storage: 'store', linen: 'store', station: 'store',
    records: 'library', matron: 'library', attic: 'library', cafeteria: 'dining', kitchen: 'dining',
    lobby: 'waiting', waiting: 'waiting', chapel: 'chapel', sanctum: 'chapel', bath: 'bath',
    incinerator: 'boiler', boiler: 'boiler', laundry: 'boiler', ritual: 'ritual', nursery: 'nursery',
  };
  rooms.forEach((r) => {
    const cat = CAT[r.tag]; if (!cat) return;
    switch (cat) {
      case 'ward': {  // beds in tidy rows against the walls, lockers to one side
        const beds = [];
        wallRow(r, 'N', bed(), 1.5, 0, 2.2, 0, beds);
        if (r.h >= 5) wallRow(r, 'S', bed(), 1.5, Math.PI, 2.2, 0, beds);
        wallRow(r, 'W', 'locker', 0.9, Math.PI / 2, 2.4, 2);
        if (rnd() < 0.6) wallRow(r, 'E', 'radiator', 0.85, -Math.PI / 2, 3.5, 1);   // 1928 heat, long cold
        // one bed was never emptied — a sheeted body still lies in it
        // (bbox top is the HEADBOARD — the mattress sits well below it)
        if (beds.length && rnd() < 0.3) { const bd = beds[Math.floor(rnd() * beds.length)]; placeTop('deadcovered', bd.wx, bd.wz, bd.yaw, Math.min(bd.top * 0.55, 0.5)); }
        if (rnd() < 0.5) placeIn(r, 'wheelchair', yaw4());
        if (r.tag === 'maternity' && rnd() < 0.6) centerP(r, 'oldtv', 0);
        break;
      }
      case 'clinic':  // an operating/exam table centred, cabinets banked on the wall
        centerP(r, 'examtable', r.w >= r.h ? 0 : Math.PI / 2);
        wallRow(r, 'N', 'metalcab', 1.0, 0, 2.1, 3);
        if (r.tag === 'surgery' || r.tag === 'er') placeIn(r, 'gurney', yaw4());
        if (r.tag === 'er') wallRow(r, 'S', 'locker', 0.9, Math.PI, 2.4, 2);
        break;
      case 'morgue':  // coffins lined along a wall, slab centred
        wallRow(r, 'W', 'coffin', 1.4, Math.PI / 2, 2.4, 3);
        centerP(r, 'examtable', 0);
        wallRow(r, 'N', 'metalcab', 1.0, 0, 2.1, 2);
        placeIn(r, 'deadcovered', yaw4());
        break;
      case 'store':   // banks of cabinets and lockers down the walls
        wallRow(r, 'N', 'metalcab', 1.0, 0, 2.0, 4);
        wallRow(r, 'S', 'locker', 0.9, Math.PI, 2.2, 3);
        if (r.tag === 'storage' || r.tag === 'supply') placeIn(r, 'shovel', yaw4());
        if (r.tag === 'pharmacy' || r.tag === 'supply') { centerP(r, 'cannedgoods', yaw4(), r.w * 0.14, 0); if (rnd() < 0.6) placeIn(r, 'cannedgoods', yaw4()); }
        if (rnd() < 0.5) placeIn(r, 'toolset', yaw4());
        break;
      case 'library': // shelves lined up along the walls
        wallRow(r, 'N', 'bookshelf', 1.0, 0, 1.9, 4);
        if (r.w >= 5) wallRow(r, 'S', 'bookshelf', 1.0, Math.PI, 1.9, 3);
        if (r.tag === 'records') wallMount(r, 'evidenceboard');   // the investigation board
        if (r.tag === 'matron') { centerP(r, 'oldtv', 0, r.w * 0.18, 0); placeIn(r, 'bloodysofa', yaw4()); wallMount(r, 'wallphone'); if (rnd() < 0.6) wallMount(r, 'brokenclock'); if (rnd() < 0.6) placeIn(r, 'candle', 0); }
        if (rnd() < 0.4) wallRow(r, 'E', 'radiator', 0.85, -Math.PI / 2, 3.5, 1);
        break;
      case 'dining': { // tables in a tidy grid — abandoned meals still ON them
        const tables = [];
        for (let gx = r.x + 2; gx <= r.x + r.w - 1.5; gx += 2.6) for (let gz = r.y + 2; gz <= r.y + r.h - 1.5; gz += 2.4) {
          const wx = gx * TILE_M, wz = gz * TILE_M, yw = askew(0);
          const b = placeW('caftable', wx, wz, yw);
          if (b) tables.push({ wx, wz, yaw: yw, top: b.max.y });
        }
        if (r.tag === 'kitchen') {
          wallRow(r, 'N', 'gasstove', 1.0, 0, 2.0, 2); wallRow(r, 'S', 'metalcab', 1.0, Math.PI, 2.2, 3);
          if (tables.length) placeTop('kitchenware', tables[0].wx, tables[0].wz, yaw4(), tables[0].top);   // pots & pans on the prep table
          else centerP(r, 'kitchenware', yaw4(), 0, r.h * 0.16);
        } else {
          wallRow(r, 'W', 'vending', 1.0, Math.PI / 2, 2.5, 1);
          // a meal someone never finished
          if (tables.length && rnd() < 0.8) { const tb = tables[Math.floor(rnd() * tables.length)]; placeTop('cannedgoods', tb.wx, tb.wz, yaw4(), tb.top); }
        }
        break;
      }
      case 'waiting': // a couple of rows of waiting-room seats, machines against a wall
        wallRow(r, 'N', 'wheelchair', 1.6, 0, 1.7);
        if (r.h >= 5) wallRow(r, 'S', 'wheelchair', 1.6, Math.PI, 1.7);
        if (rnd() < 0.8) wallRow(r, 'W', 'vending', 1.0, Math.PI / 2, 3, 1);
        if (r.tag === 'lobby') { wallMount(r, 'brokenclock'); placeIn(r, 'payphone', 0); wallMount(r, 'wallphone'); placeIn(r, 'oldtv', 0); wallMount(r, 'evidenceboard'); if (rnd() < 0.6) wallRow(r, 'S', 'piano', 1.1, Math.PI, 3, 1); }
        else { if (rnd() < 0.5) wallMount(r, 'brokenclock'); if (rnd() < 0.7) placeIn(r, 'bloodysofa', yaw4()); }
        break;
      case 'chapel':  // cross at the front, a line of candles before it, an old piano to the side
        centerP(r, 'cross', 0, 0, -(r.h * 0.32));
        wallRow(r, 'N', 'candle', 1.3, 0, 1.5, 4);
        if (rnd() < 0.8) wallRow(r, 'E', 'piano', 1.1, -Math.PI / 2, 3, 1);
        break;
      case 'bath':    // tubs one wall, counter + MIRROR the other, a vent overhead
        wallRow(r, 'W', 'bloodybath', 1.3, Math.PI / 2, 2.6, 2);
        wallRow(r, 'E', 'bathcounter', 0.9, -Math.PI / 2, 2.6, 1);
        wallMount(r, 'mirrorh', 'E');   // never trust what it shows you
        wallRow(r, 'E', 'bathcab', 0.9, -Math.PI / 2, 2.4, 1);
        if (rnd() < 0.8) placeIn(r, 'ventvalve', yaw4());
        break;
      case 'boiler':  // industrial banks + tools scattered on the floor
        wallRow(r, 'N', 'metalcab', 1.0, 0, 2.2, 3);
        wallRow(r, 'S', 'elecbox', 1.2, Math.PI, 3.2, 1);   // the dead transformer, still humming in your head
        placeIn(r, 'shovel', yaw4());
        centerP(r, 'toolset', yaw4(), r.w * 0.16, 0);
        if (rnd() < 0.5) placeIn(r, 'toolset', yaw4());
        break;
      case 'ritual':  // the séance circle is still chalked where they left it
        centerP(r, 'bloodytarp', 0);
        centerP(r, 'ouija', rnd() * 6.28, r.w * 0.22, r.h * 0.18);
        wallRow(r, 'N', 'candle', 1.3, 0, 1.6, 4);
        break;
      case 'nursery':
        if (rnd() < 0.7) placeIn(r, 'oldtv', yaw4());
        if (rnd() < 0.6) placeIn(r, 'voodoohang', 0);
        placeIn(r, 'scarebear', yaw4());   // it faces a different way every night
        break;
    }
    // one small out-of-place touch: a knocked bin or a lone wheelchair
    if (rnd() < 0.45) placeIn(r, rnd() < 0.6 ? 'bin' : 'wheelchair', yaw4());
    // cobwebs collecting in the corners, and the odd stopped clock
    if (rnd() < 0.6) cornerWeb(r);
    if (rnd() < 0.3) cornerWeb(r);
    if (cat !== 'waiting' && cat !== 'library' && rnd() < 0.22) wallMount(r, rnd() < 0.5 ? 'brokenclock' : 'brokenclock2');
    // some rooms have been boarded up — planks nailed across a wall
    if (rnd() < 0.28) wallMount(r, 'planks');
  });
  // corridor dressing: dead pendant lights hang down the halls (no collision),
  // and the odd abandoned wheelchair sits against the corridor ends
  [data.CORR_TOP, data.CORR_BOT].forEach((cy) => {
    if (cy == null) return;
    for (let x = 5; x < World.W - 5; x += 7 + Math.floor(rnd() * 3)) {
      if (isFloor(x, cy)) place('ceilinglights', x, cy, 0);
      const vx = x + 3;   // a dead vent grille between the pendants
      if (rnd() < 0.6 && isFloor(vx, cy + 1)) place('ventvalve', vx, cy + 1, yaw4());
      // a cold radiator against the corridor wall every so often
      if (rnd() < 0.4) {
        const topSide = cy === data.CORR_TOP;
        placeW('radiator', (x + 1.5) * TILE_M, (cy + (topSide ? 0.24 : 0.76)) * TILE_M, topSide ? 0 : Math.PI);
      }
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
    // a REAL animated flame licks up from a seated anchor's bowl
    const MOB2 = window.MobModels || {};
    if (MOB2.flamefx && MOB2.flamefx.scene) {
      const fm = MOB2.flamefx.scene.clone(true);
      let fb = new THREE.Box3().setFromObject(fm);
      const fh = (fb.max.y - fb.min.y) || 1;
      fm.scale.setScalar(0.42 / fh);
      fb = new THREE.Box3().setFromObject(fm);
      const fc = fb.getCenter(new THREE.Vector3());
      fm.position.set(-fc.x, 0.4 - fb.min.y, -fc.z);
      fm.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.depthWrite = false; o.frustumCulled = false; } });
      fm.visible = n.filled;
      g.add(fm);
      n.flameModel = fm;
      if (MOB2.flamefx.animations && MOB2.flamefx.animations.length) {
        const fmx = new THREE.AnimationMixer(fm);
        fmx.clipAction(MOB2.flamefx.animations[0]).play();
        fxMixers.push(fmx);
      }
    }
    g.position.set(n.tileX * TILE_M, 0.31, n.tileY * TILE_M);
    n.mesh = g; n.token = token; n.flame = flame; n.light = light;
    floorGroup.add(g);
  });
  // the Chaos Glyph — a slowly-turning arcane arch hanging over the altar,
  // burned into the air by whoever bound the children here
  const MOB3 = window.MobModels || {};
  if (MOB3.glyphfx && MOB3.glyphfx.scene) {
    const gl = MOB3.glyphfx.scene.clone(true);
    let gb = new THREE.Box3().setFromObject(gl);
    const gw = Math.max(gb.max.x - gb.min.x, gb.max.z - gb.min.z) || 1;
    gl.scale.setScalar(2.4 / gw);
    gb = new THREE.Box3().setFromObject(gl);
    const gc = gb.getCenter(new THREE.Vector3());
    gl.position.set(ritual.altarTileX * TILE_M - gc.x, 1.7 - gc.y, ritual.altarTileY * TILE_M - gc.z);
    gl.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.depthWrite = false; if (o.material.emissive) o.material.emissiveIntensity = Math.max(0.6, o.material.emissiveIntensity || 0); o.frustumCulled = false; } });
    floorGroup.add(gl);
    if (MOB3.glyphfx.animations && MOB3.glyphfx.animations.length) {
      const gmx = new THREE.AnimationMixer(gl);
      gmx.clipAction(MOB3.glyphfx.animations[0]).play();
      fxMixers.push(gmx);
    } else { ritual.glyphSpin = gl; }
  }
  // the altar fire — two crossed flame planes that ignite once all four anchors
  // are seated. Prefers the generated uniform 8×8 flipbook (ping-pong playback
  // hides the sheet's first/last luminance jump); falls back to the old strip.
  let t1 = null, mode = null;
  if (TEX.fire8) { t1 = TEX.fire8.clone(); mode = 'grid8'; }
  else if ((window.HeroModels || {}).firesheet) {
    const src = window.HeroModels.firesheet;
    src.traverse((o) => { if (!t1 && o.isMesh && o.material && o.material.map) t1 = o.material.map.clone(); });
    if (t1) mode = 'strip';
  }
  if (t1) {
    t1.needsUpdate = true;
    t1.wrapS = t1.wrapT = THREE.RepeatWrapping;
    if (mode === 'grid8') { t1.repeat.set(1 / 8, 1 / 8); t1.offset.set(0, 7 / 8); }
    else { t1.repeat.set(1 / 16, 0.117); t1.offset.set(0, 0.751); }
    const fmat = new THREE.MeshBasicMaterial({ map: t1, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const fireG = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.3), fmat);
      pl.rotation.y = i * Math.PI / 2;
      pl.position.y = 0.65; fireG.add(pl);
    }
    const fl = new THREE.PointLight(0xff7a2a, 0, 6, 2); fl.position.y = 0.9; fireG.add(fl);
    fireG.position.set(ritual.altarTileX * TILE_M, 0.8, ritual.altarTileY * TILE_M);
    fireG.visible = false;
    floorGroup.add(fireG);
    ritual.altarFire = { g: fireG, tex: t1, light: fl, t: 0, mode, frame: 0 };
  }
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
  crawler: { key: 'crawler2', targetH: 0.62, translucent: false, opacity: 1, tint: 0x54514a, tintAmt: 0.72, emissive: 0x0e0604, aura: 'rgba(80,10,20,0.5)', auraS: 2.0, yaw: 0 },
  // The Ash — the Closer's straitjacketed body, charred and wreathed in living embers (the 1926 fire's dead)
  ash: { key: 'closer', targetH: 1.92, translucent: false, opacity: 1, tint: 0x2a1810, tintAmt: 0.6, emissive: 0x501403, aura: 'rgba(255,90,20,0.5)', auraS: 3.0, yaw: 0 },
  // The Ghoul — a hunched, blood-clawed corpse-eater that haunts the basement
  ghoul: { key: 'ghoul', targetH: 1.72, translucent: false, opacity: 1, tint: 0x5a5a4a, tintAmt: 0.35, emissive: 0x0a0402, aura: 'rgba(70,30,10,0.5)', auraS: 2.4, yaw: 0 },
  // The Risen — a blood-caked dead patient stalking the top floor
  undead: { key: 'undead', targetH: 1.86, translucent: false, opacity: 1, tint: 0x5a3232, tintAmt: 0.28, emissive: 0x140404, aura: 'rgba(120,20,20,0.5)', auraS: 2.5, yaw: 0 },
  // The Nightmare — a huge pallid thing that should not run as fast as it does
  nightmare: { key: 'nightmare1', targetH: 2.15, translucent: false, opacity: 1, tint: 0x4a4046, tintAmt: 0.4, emissive: 0x0c0203, aura: 'rgba(110,20,30,0.55)', auraS: 3.0, yaw: Math.PI },
  // The Wraith — half-there, drifting above the boards
  wraith: { key: 'wraith', targetH: 1.92, translucent: true, opacity: 0.85, tint: 0x9aa6bc, tintAmt: 0.32, fly: true, aura: 'rgba(140,160,210,0.5)', auraS: 2.7, yaw: Math.PI },
};
function auraSprite(rec, grp, hex, size, y) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex(hex), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1); s.position.y = y; grp.add(s); rec.aura = s;
}
function buildEmbers(rec, grp) {
  const N = 90, ep = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = Math.random() * 6.28, r = 0.3 + Math.random() * 0.7; ep[i * 3] = Math.cos(a) * r; ep[i * 3 + 1] = 0.2 + Math.random() * 1.9; ep[i * 3 + 2] = Math.sin(a) * r; }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  rec.embers = new THREE.Points(eg, new THREE.PointsMaterial({ map: softDotTex(), color: 0xff6a1e, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
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
          idle: find('flying_idle', 'battle_idle', 'idle', 'static', 'take 001') || src.animations[0],
          walk: find('walking_a', 'walk_forward', 'walk', 'approach', 'flying_idle') || null,   // *_forward first: some rigs list *_backward earlier
          run: find('running_a', 'run_forward', 'sprint', 'run', 'charge', 'overwhelm', 'fast_flying') || null,
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
        if (o.material.map) o.material.map.anisotropy = 4;   // the dead deserve crisp skin too
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
    rec.embers = new THREE.Points(eg, new THREE.PointsMaterial({ map: softDotTex(), color: 0xff6a1e, size: 0.045, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
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

// ============================================================ the ward (defense)
// The Warding Cross: hold it up (R on desktop, right-hand A button in VR) and it
// glows, ringing a holy chord that drives the nearby dead back — while your FAITH
// holds. Faith drains as you brandish and recovers when you lower it (faster by
// candlelight). Your one real defense besides running.
function buildHeldCross() {
  const g = new THREE.Group();
  const src = (window.HeroModels || {}).cross;
  if (src) {
    const m = src.clone();
    const box = new THREE.Box3().setFromObject(m); const sz = box.getSize(new THREE.Vector3());
    const ref = Math.max(sz.x, sz.y, sz.z) || 1; m.scale.setScalar(0.42 / ref);
    const c2 = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()); m.position.sub(c2);
    m.rotation.x = 0.2; g.add(m);
  } else { // fallback: two crossed bars
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7 });
    g.add(mkBox(0.05, 0.42, 0.05, mat, 0, 0, 0));
    g.add(mkBox(0.26, 0.05, 0.05, mat, 0, 0.08, 0));
  }
  const glow = new THREE.PointLight(0xfff0c0, 0, 6, 2); g.add(glow); g.userData.glow = glow;
  // a warm holy aura sprite
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTex('rgba(255,240,190,0.85)'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  aura.scale.set(1.4, 1.4, 1); g.add(aura); g.userData.aura = aura;
  g.position.set(0.16, -0.16, -0.42);   // held in the lower-right of view
  g.visible = false; g.userData.gripMounted = false; camera.add(g);
  return g;
}
// In VR the cross/crowbar belong IN the dominant hand, not glued to your face.
// Desktop keeps the classic lower-corner view-model. Re-mounts on hand connect.
function mountHeld(g, kind) {
  const grip = isVR ? (OPTS.swapHands ? sources.leftGrip : sources.rightGrip) : null;
  const want = grip || camera;
  if (g.parent !== want) {
    if (g.parent) g.parent.remove(g);
    want.add(g);
    g.userData.gripMounted = !!grip;
    if (grip) {
      if (kind === 'cross') { g.position.set(0, 0.03, -0.05); g.rotation.set(-0.45, 0, 0); }
      else { g.position.set(0, 0, -0.03); g.rotation.set(-0.7, 0, 0); }
    } else {
      if (kind === 'cross') { g.position.set(0.16, -0.16, -0.42); g.rotation.set(0, 0, 0); }
      else { g.position.set(-0.2, -0.2, -0.44); g.rotation.set(0, 0, 0); }
    }
  }
  return g.userData.gripMounted;
}
// ================= the loadout: flashlight in one hand, a tool in the other =====
// Your off hand holds the light. Your dominant hand holds ONE tool at a time —
// bare, the iron cross, or any weapon you've found — and you cycle which with A
// (X on desktop). The dominant grip USES whatever's in it: hold to brandish the
// cross, squeeze to swing a weapon. Weapons can't kill the dead, but a solid hit
// knocks them back and sends them recoiling — room to run.
const weaponMeshes = {};
let prevABtn = false;
function currentWeapon() { return (player && player.tool && WEAPONS[player.tool]) ? WEAPONS[player.tool] : null; }
function toolList() {
  const list = ['bare'];
  if (player.inv && player.inv.cross) list.push('cross');
  WEAPON_ORDER.forEach((k) => { if (player.weapons && player.weapons[k]) list.push(k); });
  return list;
}
function toolLabel(t) { return t === 'bare' ? 'Empty hands' : t === 'cross' ? 'the Iron Cross' : WEAPONS[t].name; }
function cycleTool(dir) {
  const list = toolList();
  if (list.length <= 1) { showSubtitle('Nothing to hold yet — find the cross in the chapel, or a weapon in the wards.', 2.8); return; }
  let i = list.indexOf(player.tool); if (i < 0) i = 0;
  player.tool = list[(i + (dir || 1) + list.length) % list.length];
  showSubtitle('In hand: ' + toolLabel(player.tool), 1.8);
  Audio2.pickup(); haptic(0.3, 40, OPTS.swapHands ? 'left' : 'right');
}
// ---- dropping: whatever leaves your hand becomes a real item on the floor ----
function spawnDrop(fields) {
  const it = Object.assign({ floor: player.floor, x: player.x - 0.5, y: player.y - 0.5, taken: false, dropped: true }, fields);
  data.items.push(it);
  addItemMesh(it);
  Audio2.thud(0.18);
  saveState();
  return it;
}
function dropCurrentTool() {
  if (!player || state !== 'PLAY') return;
  if (player.tool === 'cross' && player.inv.cross) {
    player.inv.cross = false; player.tool = 'bare';
    spawnDrop({ type: 'ward', id: 'drop_cross_' + (dropSeq++) });
    showSubtitle('You set the iron cross down at your feet.', 2.5);
  } else if (WEAPONS[player.tool] && player.weapons && player.weapons[player.tool]) {
    const kind = player.tool;
    player.weapons[kind] = false; player.tool = 'bare';
    player.inv.weapon = WEAPON_ORDER.some((k) => player.weapons[k]);
    spawnDrop({ type: 'weapon', kind, id: 'drop_w_' + kind + '_' + (dropSeq++) });
    showSubtitle('You drop the ' + WEAPONS[kind].name.toLowerCase() + '. It’ll still be here. Probably.', 2.5);
  } else { showSubtitle('Empty hands — nothing to drop.', 1.6); return; }
  haptic(0.4, 60, OPTS.swapHands ? 'left' : 'right');
}
function dropFlashlight() {
  if (!player || state !== 'PLAY' || !player.hasLight) return;
  const lit = !!(player.lightOn && player.battery > 0);
  player.hasLight = false; player.lightOn = false; flashlight.visible = false;
  droppedLight = spawnDrop({ type: 'flashlight', id: 'drop_light_' + (dropSeq++), lit });
  showSubtitle(lit ? 'The flashlight hits the floor — still burning where it fell.' : 'You drop the dead flashlight.', 3);
  haptic(0.4, 60, OPTS.swapHands ? 'right' : 'left');
}
function wantsBrandish() {
  if (!player || !player.inv || !player.inv.cross || player.tool !== 'cross') return false;
  if (!isVR) return !!keys['r'] || deskUseHeld();
  // VR: hold the dominant grip while the cross is equipped
  const dom = OPTS.swapHands ? sources.left : sources.right;
  const gp = dom && dom.userData.inputSource && dom.userData.inputSource.gamepad;
  return !!(gp && gp.buttons && gp.buttons[1] && gp.buttons[1].pressed);
}
function deskUseHeld() { return !!deskUseDown; }
function updateWard(dt) {
  if (!heldCross) heldCross = buildHeldCross();
  mountHeld(heldCross, 'cross');
  const active = wantsBrandish() && player.faith > 2;
  brandishing = active;
  if (active) {
    player.faith = Math.max(0, player.faith - dt * 20);
    if (!wardTaught) { wardTaught = true; showSubtitle('The cross blazes. The dead recoil from it — but your faith is burning down. Don’t lean on it.', 4.5); }
    // drive back every nearby soul on this floor
    let hit = false;
    ents.forEach((e) => {
      if (e.floor !== player.floor) return;
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < WARD_RANGE) { e.warded = 0.45; if (e.state === Entities.S.HUNT || d < 4) hit = true; }
    });
    wardChimeT -= dt;
    if (wardChimeT <= 0) { wardChimeT = 1.1; Audio2.wardChime(0.05 + (hit ? 0.03 : 0)); }
    if (hit) { player.fear = Math.max(0, player.fear - dt * 6); haptic(0.25, 40); }
  } else {
    player.faith = Math.min(100, player.faith + dt * (nearCandle() ? 22 : 11));
  }
  // visual: raise + glow the cross while brandishing (only when it's the equipped tool)
  heldCross.visible = player.tool === 'cross' && (brandishing || isVR);   // in VR it's always in hand; on desktop only when raised
  const glow = heldCross.userData.glow, aura = heldCross.userData.aura;
  const targetGlow = brandishing ? 2.4 + Math.sin(performance.now() / 90) * 0.6 : 0;
  glow.intensity += (targetGlow - glow.intensity) * Math.min(1, dt * 10);
  aura.material.opacity += ((brandishing ? 0.85 : 0) - aura.material.opacity) * Math.min(1, dt * 8);
  if (!heldCross.userData.gripMounted) {   // desktop view-model: raise it when brandished
    const targetY = brandishing ? -0.02 : -0.16;
    heldCross.position.y += (targetY - heldCross.position.y) * Math.min(1, dt * 9);
  }   // in-hand (VR): the player raises their own arm — the glow does the talking
}

// ---- weapons: each swing knocks the dead back and sends them recoiling ----
function buildHeldWeaponOf(kind) {
  const cfg = WEAPONS[kind];
  const g = new THREE.Group();
  const src = (window.HeroModels || {})[cfg.model];
  if (src) {
    const m = src.clone();
    const box = new THREE.Box3().setFromObject(m); const sz = box.getSize(new THREE.Vector3());
    const ref = Math.max(sz.x, sz.y, sz.z) || 1; m.scale.setScalar(cfg.scale / ref);
    const c2 = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()); m.position.sub(c2);
    m.rotation.set(0.5, 0.3, -0.9);   // gripped, head up
    m.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.frustumCulled = false; } });
    g.add(m);
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3e46, metalness: .6, roughness: .5 });
    g.add(mkBox(0.05, 0.5, 0.05, mat, 0, 0, 0));
  }
  g.position.set(-0.2, -0.2, -0.44); g.visible = false; camera.add(g);
  return g;
}
function weaponMesh(kind) { return weaponMeshes[kind] || (weaponMeshes[kind] = buildHeldWeaponOf(kind)); }
function wantsSwing() {
  if (!currentWeapon()) return false;
  if (!isVR) return !!keys['g'] || swingQueued;
  return swingQueued;   // VR: the dominant-grip squeezestart queues one swing
}
function doSwing(cfg) {
  swingT = 0.3; swingCd = cfg.cd; Audio2.swish(0.1);
  camera.getWorldDirection(tmpV2);
  const fYaw = Math.atan2(tmpV2.x, tmpV2.z);
  const grid = data.floors[player.floor].grid;
  let landed = false;
  ents.forEach((e) => {
    if (e.floor !== player.floor) return;
    const dx = e.x - player.x, dy = e.y - player.y, d = Math.hypot(dx, dy);
    if (d > cfg.reach) return;
    const ang = Math.abs(normAng(Math.atan2(dx, dy) - fYaw));
    if (ang > cfg.cone) return;
    e.warded = Math.max(e.warded || 0, cfg.scare);   // it recoils and flees…
    e.slow = Math.max(e.slow || 0, cfg.scare + 1);   // …and staggers
    const len = d || 1; if (e.moveDirect) e.moveDirect(grid, e.x + (dx / len) * 4, e.y + (dy / len) * 4, cfg.knock);   // knocked back a step
    landed = true;
  });
  if (landed) {
    Audio2.thud(cfg.heavy ? 0.7 : 0.5); Audio2.screechPan(0, 0.08);
    player.fear = Math.max(0, player.fear - (cfg.heavy ? 6 : 4));
    haptic(cfg.heavy ? 0.85 : 0.55, cfg.heavy ? 90 : 60);
    if (!weaponTaught) { weaponTaught = true; showSubtitle('The ' + cfg.name.toLowerCase() + ' connects — it reels back and breaks away. Steel scares the dead; it won’t put them down for good.', 5); }
  } else haptic(0.2, 40);
}
function updateMelee(dt) {
  if (swingCd > 0) swingCd -= dt;
  if (swingT > 0) swingT -= dt;
  const cfg = currentWeapon();
  // hide any weapon that isn't the one in hand
  for (const k in weaponMeshes) if (k !== player.tool) weaponMeshes[k].visible = false;
  if (!cfg) { swingQueued = false; return; }
  const g = weaponMesh(player.tool);
  const wanted = wantsSwing(); swingQueued = false;
  if (wanted && swingCd <= 0 && swingT <= 0 && !brandishing) doSwing(cfg);
  const onGrip = mountHeld(g, 'weapon');
  g.visible = !brandishing;
  const sw = swingT > 0 ? (0.3 - swingT) / 0.3 : 0;
  const arc = sw > 0 ? Math.sin(sw * Math.PI) : 0;
  if (onGrip) { g.rotation.set(-arc * 1.1, 0, arc * 0.2); g.position.set(0, arc * 0.02, -0.03 - arc * 0.08); }
  else { g.rotation.set(-arc * 1.5, 0, arc * 0.5); g.position.set(-0.2, -0.2 + arc * 0.1, -0.44 - arc * 0.16); }
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
  nightmare: 'Something enormous unfolds in the dark of the surgical wing — and ROARS.',
  wraith: 'The cold deepens. The Wraith turns its hollow face toward you and drifts faster.',
};
// footstep cadence + weight per kind (interval seconds, volume multiplier)
const STEP_STYLE = {
  nurse: [0.52, 0.9], nurse2: [0.5, 0.9], mose: [0.62, 1.7], child: [0.3, 0.55],
  crawler: [0.17, 0.45], ghoul: [0.42, 1.1], undead: [0.48, 1.3], ash: [0, 0],   // the Ash doesn't step — it crackles
  nightmare: [0.66, 1.9], wraith: [0, 0],   // the Wraith glides — you only hear the cold hum
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
      case 'nightmare': hunt ? Audio2.growlPan(pan, v * 1.5) : Audio2.breathPan(pan, v * 1.2); break;
      case 'wraith': hunt ? Audio2.moanPan(pan, v) : Audio2.humPan(pan, v * 0.8); break;
    }
  }

  // --- ragged breathing when it is almost on top of you ---
  if (d < 3.6 && !hunt) {
    rec.breathT -= dt;
    if (rec.breathT <= 0) { rec.breathT = 2.4 + Math.random() * 1.2; Audio2.breathPan(pan, 0.04 + (1 - d / 3.6) * 0.05); }
  }

  // --- spider-sense: something close that you CAN'T SEE pulses the controller
  // on the side it's coming from, faster as it closes. Your skin knows first. ---
  if (d < 7 && e.state !== Entities.S.DORMANT) {
    camera.getWorldDirection(tmpV2);
    const toE = Math.atan2(e.x - player.x, e.y - player.y);
    const rel = normAng(toE - Math.atan2(tmpV2.x, tmpV2.z));
    if (Math.abs(rel) > 1.2) {   // outside your field of view
      rec.senseT = (rec.senseT || 0) - dt;
      if (rec.senseT <= 0) {
        rec.senseT = 0.4 + (d / 7) * 1.4;   // 7m: slow tap … arm's length: drumroll
        haptic(0.12 + (1 - d / 7) * 0.5, 50, pan < 0 ? 'left' : 'right');
      }
    }
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
  safePlayer = { floor: player ? player.floor : -1, x: tx, y: ty };
  if (player) { player.x = tx; player.y = ty; }
}

function playerTileFromCamera() {
  camera.getWorldPosition(tmpV);
  player.x = tmpV.x / TILE_M;
  player.y = tmpV.z / TILE_M;
}

function passableFor(fi, x, y) {
  if (x < 0 || y < 0 || x >= World.W || y >= World.H) return false;
  const ix = Math.floor(x), iy = Math.floor(y);
  const t = data.floors[fi].grid[iy][ix];
  const door = fi === player.floor && doorMeshes.get(ix + ',' + iy);
  if (door && door.blocked) return false;
  return t === TILE.FLOOR || t === TILE.DOOR || t === TILE.UP || t === TILE.DOWN ||
    t === TILE.HIDE || t === TILE.CANDLE || t === TILE.EXIT;
}
function tileAt(fi, x, y) {
  if (x < 0 || y < 0 || x >= World.W || y >= World.H) return TILE.VOID;
  return data.floors[fi].grid[Math.floor(y)][Math.floor(x)];
}

function canStandAt(fi, x, y) {
  const r = 0.24;
  return passableFor(fi, x - r, y - r) && passableFor(fi, x + r, y - r) &&
    passableFor(fi, x - r, y + r) && passableFor(fi, x + r, y + r) &&
    !solidBlocked(x * TILE_M, y * TILE_M);
}

// Streaming furniture can arrive after the player has already entered a room.
// Preserve their exact spot when it remains clear; otherwise choose the nearest
// valid tile centre so a newly loaded bed/cabinet can never materialize around
// the headset and pin the player inside its collider.
function placeDollyAtNearestSafe(preferredX, preferredY) {
  if (canStandAt(player.floor, preferredX, preferredY)) {
    placeDollyAtTile(preferredX, preferredY);
    return false;
  }
  const candidates = [];
  for (let y = 0; y < World.H; y++) for (let x = 0; x < World.W; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    const d2 = (cx - preferredX) ** 2 + (cy - preferredY) ** 2;
    candidates.push({ x: cx, y: cy, d2 });
  }
  candidates.sort((a, b) => a.d2 - b.d2);
  const safe = candidates.find((p) => canStandAt(player.floor, p.x, p.y));
  if (safe) {
    placeDollyAtTile(safe.x, safe.y);
    showSubtitle('The room settles around you.', 1.8);
    return true;
  }
  // Every floor has a clear corridor by construction. Keep the last known
  // logical position untouched if a corrupt/custom layout violates that rule.
  safePlayer.floor = -1;
  return false;
}

// Counter room-scale headset translation if the tracked head crosses a wall,
// closed door, or furniture collider without going through moveDolly().
function enforceTrackedCollision() {
  if (player.hidden && hideSpot) { player.x = hideSpot.x; player.y = hideSpot.y; return; }
  camera.getWorldPosition(tmpV);
  const x = tmpV.x / TILE_M, y = tmpV.z / TILE_M;
  if (safePlayer.floor !== player.floor) safePlayer = { floor: player.floor, x: player.x, y: player.y };
  if (canStandAt(player.floor, x, y)) {
    safePlayer.x = x; safePlayer.y = y;
    player.x = x; player.y = y;
    return;
  }
  dolly.position.x += (safePlayer.x - x) * TILE_M;
  dolly.position.z += (safePlayer.y - y) * TILE_M;
  player.x = safePlayer.x; player.y = safePlayer.y;
}

// Move the dolly by (dxTiles, dyTiles) with axis-separated swept collision.
function moveDolly(dxT, dyT) {
  playerTileFromCamera();
  let px = player.x, py = player.y;
  const nx = px + dxT;
  if (dxT !== 0 && canStandAt(player.floor, nx, py)) {
    dolly.position.x += dxT * TILE_M;
    px = nx; player.x = px;
  }
  const ny = py + dyT;
  if (dyT !== 0 && canStandAt(player.floor, px, ny)) {
    dolly.position.z += dyT * TILE_M;
    py = ny; player.y = py;
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
  updateHands(dt);   // fingers track the triggers before anything else moves
  updateWatch(dt);   // and the other hand can be poking the watch's touch screen
  // heading = camera yaw in world
  camera.getWorldDirection(tmpV);
  const yaw = Math.atan2(tmpV.x, tmpV.z); // forward
  const moveSrc = OPTS.swapHands ? sources.right : sources.left;
  const turnSrc = OPTS.swapHands ? sources.left : sources.right;
  const [lx, ly] = readAxes(moveSrc);
  // shove the stick to the rim to break into a run — costs stamina, and a runner
  // is louder and more likely to catch a foot
  const mag = Math.hypot(lx, ly);
  if (mag > 0.92 && !crouched && player.stamina > 1) sprintHold += dt; else sprintHold = 0;
  const sprinting = sprintHold > 0.3 && player.stamina > 1;
  if ((lx || ly) && !tripping && !player.hidden) {
    const speed = crouched ? 2.1 : (sprinting ? 6.2 : 4.2);   // m/s — careful / brisk / running
    // forward is -y stick; strafe is x. Right vector = yaw - 90° (was +90°: inverted!)
    const fwd = -ly, str = lx;
    const dz = (Math.cos(yaw) * fwd + Math.cos(yaw - Math.PI / 2) * str);
    const dx = (Math.sin(yaw) * fwd + Math.sin(yaw - Math.PI / 2) * str);
    const step = speed * dt / TILE_M;
    moveDolly(dx * step, dz * step);
    player.moving = true;
  } else player.moving = false;
  player.sprinting = sprinting && player.moving;
  if (player.sprinting) player.stamina = Math.max(0, player.stamina - dt * 24);
  else player.stamina = Math.min(100, player.stamina + dt * 12);
  // look-to-walk option: hold X on the MOVE hand only — that hand's Y is the
  // wrist pack, and the other hand's A/B are the cross and the flashlight
  if (OPTS.walkLook && !player.hidden) {
    const g = moveSrc && moveSrc.userData.inputSource && moveSrc.userData.inputSource.gamepad;
    const pressed = g && g.buttons && (g.buttons[4] && g.buttons[4].pressed);
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
  // B on the tool hand: TAP toggles the flashlight, HOLD (~0.7s) drops it where you stand
  const gT = turnSrc && turnSrc.userData.inputSource && turnSrc.userData.inputSource.gamepad;
  const bNow = !!(gT && gT.buttons && gT.buttons[5] && gT.buttons[5].pressed);
  if (state === 'PLAY') {
    if (bNow) { bHoldT += dt; if (!bDropped && bHoldT > 0.7) { bDropped = true; dropFlashlight(); } }
    else { if (prevBBtn && !bDropped && bHoldT < 0.45) toggleFlash(); bHoldT = 0; bDropped = false; }
  }
  prevBBtn = bNow;
  // A on the tool hand: TAP cycles what you hold (bare → cross → weapons), HOLD drops it
  const aNow = !!(gT && gT.buttons && gT.buttons[4] && gT.buttons[4].pressed);
  if (state === 'PLAY') {
    if (aNow) { aHoldT += dt; if (!aDropped && aHoldT > 0.7) { aDropped = true; dropCurrentTool(); } }
    else { if (prevABtn && !aDropped && aHoldT < 0.45) cycleTool(1); aHoldT = 0; aDropped = false; }
  }
  prevABtn = aNow;
  // stick clicks: move-hand = crouch toggle, turn-hand = jump
  const gM = moveSrc && moveSrc.userData.inputSource && moveSrc.userData.inputSource.gamepad;
  const smNow = !!(gM && gM.buttons && gM.buttons[3] && gM.buttons[3].pressed);
  if (smNow && !prevStickMove && state === 'PLAY' && !player.hidden) crouched = !crouched;
  prevStickMove = smNow;
  const stNow = !!(gT && gT.buttons && gT.buttons[3] && gT.buttons[3].pressed);
  if (stNow && !prevStickTurn && state === 'PLAY' && jumpY <= 0 && !crouched && !player.hidden) { jumpVel = 2.7; jumpY = 0.001; }
  prevStickTurn = stNow;
  // Y on the move hand: the wrist pack menu
  const yNow = !!(gM && gM.buttons && gM.buttons[5] && gM.buttons[5].pressed);
  if (yNow && !prevYBtn && state === 'PLAY') toggleWristMenu();
  prevYBtn = yNow;
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
    if (k === 'f' && !e.repeat) { if (state === 'PLAY') fDownAt = performance.now(); else toggleFlash(); }
    if (k === 'e') { if (state === 'PLAY') interact(); else if (state === 'INTRO') introInteract(); }
    if (k === 'q' && state === 'PLAY') startSpirit();
    if (k === 'p' || k === 'escape') { if (state === 'PLAY') pause(); else if (state === 'PAUSE') resumeGame(); }
    if (k === 'tab') { e.preventDefault(); toggleJournal(); }
    if (k === 'c' && state === 'PLAY') Survival.drink();
    if (k === 'v' && state === 'PLAY') Survival.useMedkit();
    if (k === 'l' && state === 'PLAY') Survival.toggleLantern();
    if (k === ' ' && (state === 'PLAY' || state === 'INTRO') && jumpY <= 0 && !crouched && !player.hidden) { jumpVel = 2.7; jumpY = 0.001; }
    if (k === 'z' && state === 'PLAY' && !player.hidden) crouched = !crouched;
    if (k === 'x' && !e.repeat && state === 'PLAY') xDownAt = performance.now();
    if ((k === 'enter' || k === ' ') && (state === 'DEAD' || state === 'WIN')) newGame();
    if ((k === 'enter' || k === 'escape') && state === 'INTRO') skipCine();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase(); keys[k] = false;
    if (k === 'q') stopSpirit();
    // tap = use, hold ≥0.6s = drop (flashlight on F, held tool on X)
    if (k === 'f' && state === 'PLAY') { (performance.now() - fDownAt > 600) ? dropFlashlight() : toggleFlash(); }
    if (k === 'x' && state === 'PLAY') { (performance.now() - xDownAt > 600) ? dropCurrentTool() : cycleTool(1); }
  });
  const cv = renderer.domElement;
  cv.addEventListener('mousedown', (e) => {
    if (isVR) return;
    if (document.pointerLockElement !== cv) cv.requestPointerLock && cv.requestPointerLock();
    else if (state === 'PLAY' && e.button === 0) { swingQueued = true; deskUseDown = true; }   // left click: swing / raise the equipped tool
    desk.dragging = true;
  });
  window.addEventListener('mouseup', (e) => { desk.dragging = false; if (e.button === 0) deskUseDown = false; });
  window.addEventListener('mousemove', (e) => {
    if (isVR || (state !== 'PLAY' && state !== 'INTRO')) return;
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
  if ((fwd || str) && !tripping && !player.hidden) {
    const speed = crouched ? 1.8 : (sprint ? 6.2 : 3.4);
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
// ---- the stumble: every 20–45 min your legs betray you (sooner if you run) ----
function startTrip() {
  tripping = true;
  tripLen = player.sprinting ? 1.9 : 1.35;
  tripT = tripLen;
  tripTimer = 1200 + Math.random() * 1500;   // next one in 20–45 minutes
  crouched = false;
  Audio2.thud(0.55); Audio2.footstep(0.09); Audio2.creak();
  haptic(0.8, 160);
  comfortBlink(0.8);
  player.fear = Math.min(100, player.fear + (player.sprinting ? 9 : 5));
  showSubtitle(player.sprinting
    ? 'Your foot catches — you go down HARD, palms slapping the cold floor.'
    : 'You stumble in the dark and drop to a knee.', 3.2);
}
function updateTrip(dt) {
  if (!tripping) {
    const grace = elapsed < graceUntil;
    if (!grace && !player.hidden && state === 'PLAY') {
      tripTimer -= dt * (player.sprinting ? 1.9 : 1);   // running wears you into a fall sooner
      if (tripTimer <= 0) startTrip();
    }
    if (tripY !== 0) tripY += (0 - tripY) * Math.min(1, dt * 8);
    return;
  }
  tripT -= dt;
  // drop fast onto your hands, sprawl a beat, then push back up to your feet
  const target = tripT > tripLen - 0.25 ? -0.62 : (tripT > 0.4 ? -0.55 : 0);
  tripY += (target - tripY) * Math.min(1, dt * 11);
  if (tripT <= 0) { tripping = false; showSubtitle('You get your feet back under you.', 1.8); }
}
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
  if (t === TILE.DOWN && player.floor === 1 && powerChase && lockWindowT > 0) return lockBasementDoor();
  if (t === TILE.DOWN && player.floor === 1 && doorBolted) {
    doorBolted = false;
    showSubtitle('You slide the bolt back. The dark below is quiet. Probably.', 3);
    return changeFloor(-1);
  }
  if (t === TILE.DOWN) return changeFloor(-1);
  // hiding is ANCHORED: you tuck into this spot and stay until you interact again.
  // (Movement is locked while hidden — no walking the halls silent and uncatchable.)
  if (player.hidden) { leaveHide(); return; }
  const hide = nearestHideForInteraction();
  if (hide) { enterHide(hide); return; }
  if (exitRec && Math.hypot(exitRec.x - player.x, exitRec.y - player.y) < 1.35) return tryExit();
  if (interactDoorNearby()) return;
  const it = data.items.find((i) => !i.taken && i.floor === player.floor &&
    Math.hypot(i.x + 0.5 - player.x, i.y + 0.5 - player.y) < 1.4);
  if (it) return pickupItem(it);
  const doc = documents.find((d) => !d.found && d.floor === player.floor &&
    Math.hypot(d.x + 0.5 - player.x, d.y + 0.5 - player.y) < 1.4);
  if (doc) return readDocument(doc);
  if (player.floor === 0 && genRec && !powerOn && Math.hypot(genRec.tx - player.x, genRec.ty - player.y) < 1.9) return startCrank();
  if (ritual && player.floor === ritual.floor && ritualInteract()) return;
  const obj = objectiveHere();
  // docId'd truths complete by READING their page, not by standing in the room
  if (obj && ((obj.type === 'document' && !obj.docId) || obj.type === 'bell')) return completeObjective(obj);
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
  if (['draught', 'backpack', 'medkit', 'teddy', 'battery', 'lantern', 'matches'].includes(it.type)) {
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
      player.hasLight = true; player.lightOn = player.battery > 0; flashlight.visible = player.lightOn;
      if (droppedLight && it.id === droppedLight.id) { droppedLight = null; showSubtitle('The flashlight is back in your hand. Don’t drop it again.', 3); }
      else showSubtitle(isVR ? 'Flashlight. B toggles it. The dead see its beam.' : 'Flashlight. F to toggle. The dead see its beam.', 4.5);
      break;
    case 'battery':
      player.battery = Math.min(100, player.battery + 45); showSubtitle('Batteries. +45% light.', 2); break;
    case 'emf': player.inv.emf = true; showSubtitle('EMF reader — it ticks when the dead are near.', 3); break;
    case 'spiritbox': player.inv.spiritbox = true; showSubtitle('Spirit box. Hold the left grip to listen. They answer — and come.', 4.5); break;
    case 'candlekit': player.inv.candles = (player.inv.candles || 0) + 3; showSubtitle('Candles — their light steadies your heart.', 3); break;
    case 'key': player.keys[it.id] = true; showSubtitle('A key: ' + keyLabel(it.id), 3); break;
    case 'ward':
      player.inv.cross = true; player.tool = 'cross';
      showSubtitle(isVR
        ? 'A heavy iron cross — now in your dominant hand. HOLD that grip to raise it and drive the dead back while your faith holds. Press A to switch hands-items.'
        : 'A heavy iron cross. Hold R (or left-click) to raise it and drive the dead back while your faith holds. Press X to switch what you hold.', 6);
      break;
    case 'weapon': {
      const kind = (it.kind && WEAPONS[it.kind]) ? it.kind : (WEAPONS[it.id] ? it.id : 'crowbar');
      player.weapons = player.weapons || {}; player.weapons[kind] = true; player.inv.weapon = true; player.tool = kind;
      const cfg = WEAPONS[kind];
      showSubtitle(isVR
        ? 'A ' + cfg.name + ' — in your tool hand. SQUEEZE the dominant grip to swing; a solid hit knocks the dead back and sends them fleeing. Press A to cycle what you hold.'
        : 'A ' + cfg.name + '. Left-click / G to swing; a solid hit knocks the dead back and sends them fleeing. Press X to cycle what you hold. It won’t kill them — but it buys you room.', 6);
      break;
    }
  }
}
function keyLabel(id) {
  return ({ key_mose: 'Room 3-East', key_incinerator: 'the Incinerator', key_roof: 'Roof Access',
    key_sanctum: 'the Sanctum',
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
  // some documents ARE the quest: reading the right page completes its truth
  const o = data.objectives.find((x) => !x.done && x.type === 'document' && x.docId === doc.id);
  if (o) completeObjective(o);
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
  ritual.done = true; Audio2.stinger(true);
  player.fear = Math.min(player.fear, 25);   // the circle steadies you for the working
  if (realMode) {
    // 24-HOUR SURVIVAL: even the Rite doesn't empty this house for good. It buys
    // the longest silence there is — half an hour — and full faith. Then they return.
    if (window.Survival && Survival.grantPeace) Survival.grantPeace(30, 'sanctum');
    player.faith = 100;
    ents.forEach((e) => { e.state = Entities.S.DORMANT; e.target = null; e.lastSeen = null; e.path = null; });
    playLore('unbinding', () => {
      showSubtitle('The circle takes them down, every one. Thirty minutes of true silence. But this house has been hungry since 1928 — they WILL come back.', 7);
      saveState();
    });
    return;
  }
  riteClimax = true;
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
  placeDollyAtNearestSafe(landX + 0.5, 15.5);
  player.hidden = false;
  // the surge chase follows you through stairwells — unless you bolt the door
  if (powerChase && chasers.length) {
    stairArrive = { x: landX + 0.5, y: 15.5 };
    if (nf === 1 && dir > 0) {
      lockWindowT = 6; chaserArriveT = 0;
      showSubtitle('The stairwell door swings loose behind you — BOLT IT. NOW.', 4);
    } else { lockWindowT = 0; chaserArriveT = 3.0; }
  }
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
    // ONE NIGHT: the last truth (the bell) opens the way out. 24-HOUR: truths
    // never end the night — they buy you PEACE. The dead always come back.
    if (o.id === 'roof') {
      if (!realMode) return win();
      if (window.Survival && Survival.grantPeace) Survival.grantPeace(15, 'sanctum');
      player.fear = Math.max(0, player.fear - 40);
      showSubtitle('The bell tolls over Williamson. Every soul in the building goes still — fifteen minutes of real silence. But the ride still comes at 6 PM.', 6);
      updateDesktopObjective();
      return;
    }
    showSubtitle('A truth spoken. The building shifts around you.', 3);
    if (realMode) {
      if (window.Survival && Survival.grantPeace) Survival.grantPeace(8, 'truth');
      player.fear = Math.max(0, player.fear - 25);
      showSubtitle('The truth settles something. For eight minutes, the house rests.', 4);
    }
    if (o.id === 'basement') { showSubtitle('Something in the incinerator wakes.', 3.5); Audio2.stinger(true); const a = ents.find((e) => e.kind === 'ash'); if (a) a.awake(); }
    updateDesktopObjective();
  });
}
function tryExit() {
  if (realMode) {
    // 24-hour survival: the doors open when the ride comes back, and not before
    const left = Math.max(0, 24 - hour);
    showSubtitle(left > 0.02
      ? 'The chain holds. Your ride comes at 6 PM tomorrow — ' + (left >= 1 ? Math.ceil(left) + ' hours' : 'minutes') + ' to go.'
      : 'The chain is loosening…', 4);
    return;
  }
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

function nearestDoorForInteraction() {
  let nearest = null, nearestD = 1.25;
  camera.getWorldDirection(tmpV2);
  doorMeshes.forEach((door) => {
    const dx = door.x + 0.5 - player.x, dy = door.y + 0.5 - player.y;
    const d = Math.hypot(dx, dy);
    if (d <= 0 || d >= nearestD) return;
    const facing = (tmpV2.x * dx + tmpV2.z * dy) / d;
    if (d < 0.58 || facing > 0.12) { nearestD = d; nearest = door; }
  });
  return nearest ? { door: nearest, distance: nearestD } : null;
}

// ---- interact with the nearest faced room door: unlock, open, or close ----
function interactDoorNearby() {
  const hit = nearestDoorForInteraction();
  if (!hit) return false;
  const nearest = hit.door, nearestD = hit.distance;

  const room = data.floors[player.floor].rooms.find((r) => r.doorX === nearest.x && r.doorY === nearest.y);
  if (nearest.locked) {
    const keyId = room && KEY_FOR[room.tag];
    if (!keyId || !player.keys[keyId]) {
      Audio2.rattle();
      showSubtitle(keyId ? 'Locked — you need the key to ' + keyLabel(keyId) + '.' : 'The lock has no keyhole on this side.', 2.6);
      return true;
    }
    data.floors[player.floor].grid[nearest.y][nearest.x] = TILE.DOOR;
    if (room) room.locked = false;
    nearest.locked = false; nearest.closed = false; nearest.blocked = true; nearest.targetYaw = nearest.openYaw;
    doorStates.set(nearest.stateKey, false);
    nearest.m.material.color.setHex(0x9a8a76);
    nearest.m.material.emissive.setHex(0x000000);
    ents.forEach((e) => { e.path = null; e.pathTimer = 0; });
    Audio2.creak();
    showSubtitle('The lock gives. ' + (room ? room.name : 'The door') + ' opens.', 2.5);
    saveState();
    return true;
  }

  const doorDx = Math.abs(nearest.x + 0.5 - player.x);
  const doorDy = Math.abs(nearest.y + 0.5 - player.y);
  if (!nearest.closed && doorDx < 0.76 && doorDy < 0.76) {
    showSubtitle('Step clear of the doorway before closing it.', 1.8);
    return true;
  }
  nearest.closed = !nearest.closed;
  nearest.targetYaw = nearest.closed ? 0 : nearest.openYaw;
  if (nearest.closed) nearest.blocked = true;
  doorStates.set(nearest.stateKey, nearest.closed);
  ents.forEach((e) => { e.path = null; e.pathTimer = 0; });
  Audio2.creak();
  showSubtitle(nearest.closed ? 'The door closes.' : 'The door opens.', 1.4);
  return true;
}

function updateDoors(dt) {
  const blend = Math.min(1, dt * 7);
  doorMeshes.forEach((door) => {
    door.g.rotation.y += (door.targetYaw - door.g.rotation.y) * blend;
    // A door becomes passable only after the leaf has visibly cleared most of
    // the opening. Closing reserves collision immediately so nobody can enter
    // the swing while it is moving.
    if (!door.closed && Math.abs(door.g.rotation.y) > 0.68) door.blocked = false;
  });
}

// ============================================================ main loop
function render() {
  const dt = Math.min(clock.getDelta(), 0.1);   // tolerate frame dips without eating movement
  if (state === 'PLAY') update(dt);
  else if (state === 'INTRO') { introUpdate(dt); tickSubtitle(dt); }
  else if (state === 'MENU') { camera.position.set(0, EYE, 0); }
  netTick(dt);
  spinItems(dt);
  renderer.render(scene, camera);
}

function spinItems(dt) {
  itemMeshes.forEach((g) => { if (g.userData.spin) { g.userData.spin.rotation.y += dt * 1.5; g.position.y = 1.1 + Math.sin(performance.now() / 400) * 0.08; } });
  candleLights.forEach((c) => { const f = 0.75 + Math.random() * 0.35; c.light.intensity = c.base * f; if (c.halo) c.halo.material.opacity = 0.55 * f + 0.15; });
  docMeshes.forEach((g) => { g.rotation.y += dt * 0.6; g.position.y = 1.0 + Math.sin(performance.now() / 500) * 0.06; });
  fxMixers.forEach((m) => m.update(dt));   // ritual flames + the glyph arch breathe
  if (ritual && player && player.floor === ritual.floor) {
    ritual.nodes.forEach((n) => {
      if (n.flameModel) n.flameModel.visible = n.filled;
      if (n.filled) {
        if (n.light) n.light.intensity = 0.9 * (0.7 + Math.random() * 0.4);
        if (n.token) { n.token.rotation.y += dt * 1.2; n.token.position.y = 0.5 + Math.sin(performance.now() / 500) * 0.04; }
      }
    });
    // all four anchors seated -> the altar itself catches fire (sprite-sheet flipbook)
    const AF = ritual.altarFire;
    if (AF) {
      const burning = ritual.nodes.every((n) => n.filled);
      AF.g.visible = burning;
      if (burning) {
        AF.t += dt;
        if (AF.t > 0.055) {
          AF.t = 0; AF.frame++;
          if (AF.mode === 'grid8') {
            // 64 frames, ping-ponged (0..63..0) so the loop never pops
            const cyc = AF.frame % 126;
            const idx = cyc < 63 ? cyc : 126 - cyc;
            AF.tex.offset.set((idx % 8) / 8, 1 - (((idx / 8) | 0) + 1) / 8);
          } else {
            AF.tex.offset.set((AF.frame % 16) / 16, 0.751);
          }
        }
        AF.light.intensity = 1.6 + Math.random() * 0.9;
      }
    }
    if (ritual.glyphSpin) ritual.glyphSpin.rotation.y += dt * 0.25;
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

function haptic(intensity, ms, hand) {   // rumble hands (VR only, fail-soft); hand: 'left'|'right'|both
  const set = hand === 'left' ? [sources.left] : hand === 'right' ? [sources.right] : [sources.left, sources.right];
  set.forEach((c) => {
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

  // 3:33 AM — the payphone in the lobby rings. Nobody has paid the bill since 1988.
  if (!phoneRang && hour >= 9.55) {
    phoneRang = true;
    if (hour > 10.4) { /* resumed a save past 3:33 — the moment has passed */ } else {
    const here = player.floor === 1;
    for (let i = 0; i < 4; i++) setTimeout(() => { if (state === 'PLAY') Audio2.phoneRing(here ? 0.09 : 0.035); }, i * 4200);
    setTimeout(() => { if (state !== 'PLAY') return;
      showSubtitle(here ? 'The payphone in the lobby is ringing.' : 'Somewhere below, faintly — a payphone is ringing.', 4.5);
      player.fear = Math.min(100, player.fear + (here ? 7 : 3));
    }, 900);
    setTimeout(() => { if (state === 'PLAY' && player.floor === 1) showSubtitle('It stops mid-ring. As if someone answered.', 4); }, 4 * 4200 - 1600);
    }
  }

  enforceTrackedCollision();
  if (isVR) vrLocomotion(dt);
  else desktopUpdate(dt);
  // jump arc + crouch height + a stumble dip, applied to the rig as one vertical offset
  if (jumpY > 0) { jumpY += jumpVel * dt; jumpVel -= 9.6 * dt; if (jumpY <= 0) { jumpY = 0; jumpVel = 0; Audio2.thud(0.12); } }
  crouchLerp += ((crouched ? -0.72 : 0) - crouchLerp) * Math.min(1, dt * 8);
  updateTrip(dt);
  dolly.position.y = jumpY + crouchLerp + tripY;
  enforceTrackedCollision();
  // hidden = anchored: logical position stays pinned to the hide spot no matter
  // what the headset (or a stuck stick) does
  if (player.hidden && hideSpot) { player.x = hideSpot.x; player.y = hideSpot.y; }

  // flashlight battery + aim
  if (player.lightOn && player.battery > 0) {
    player.battery = Math.max(0, player.battery - dt * (realMode ? 0.05 : 0.35));
    if (player.battery <= 0) { player.lightOn = false; flashlight.visible = false; showSubtitle('The flashlight dies. Darkness.', 2.5); }
    flashFlicker = player.battery < 20 ? (0.55 + Math.random() * 0.45) : 1;
    flashlight.intensity = 30 * flashFlicker;
  }
  // a dropped, still-lit flashlight keeps eating the battery from across the dark
  if (droppedLight && !droppedLight.taken && droppedLight.lit) {
    player.battery = Math.max(0, player.battery - dt * (realMode ? 0.05 : 0.35));
    if (player.battery <= 0) {
      droppedLight.lit = false;
      const rec = itemMeshes.get(droppedLight.id);
      if (rec && rec.userData.dropLight) { rec.userData.dropLight.spot.visible = false; rec.userData.dropLight.halo.visible = false; rec.userData.dropLight.lens.material.color.setHex(0x2a2a2a); }
      showSubtitle('Somewhere in the dark, your flashlight gutters out.', 3.5);
    }
  }
  // aim yaw (of the flashlight) in tile space for AI
  const beamObj = flashlight.parent || camera;
  beamObj.getWorldDirection(tmpV); // -Z of the object
  // flashlight points along its local -Z as a spotlight toward target; approximate with parent forward
  player.aim = Math.atan2(tmpV.z, tmpV.x); // world X/Z -> tile x/y angle

  updateDoors(dt);

  // noise
  let noise = 0;
  if (player.moving) noise = player.sprinting ? 0.55 : 0.12;
  const moveStick = OPTS.swapHands ? sources.right : sources.left;
  if (isVR && (readAxes(moveStick)[0] || readAxes(moveStick)[1])) noise = Math.max(noise, 0.14);
  if (spiritActive) noise = Math.max(noise, 0.85);
  if (crankT > 0) noise = Math.max(noise, 0.9);   // the crank carries through the whole basement
  if (crouched) noise *= 0.45;   // low and slow — the dead hear less of you
  if (jumpY > 0.05) noise = Math.max(noise, 0.4);   // jumping is NOT quiet
  if (player.hidden) noise = 0;

  const grace = elapsed < graceUntil;
  updateOnboarding(dt);
  updateFear(dt, grace);
  updateWisp(dt);

  // entities
  // 24-HOUR SURVIVAL sharpens as it goes: the dead get faster and keener the
  // deeper into the day you survive (up to +25% by the end). The mental game.
  const baseDiff = HAUNT[OPTS.haunt] || HAUNT.restless;
  const grind = realMode ? 1 + Math.min(0.25, hour * 0.011) : 1;
  const ctx = {
    hour, noise,
    playerLit: isPlayerLit(),
    peace: Survival.peaceActive() || grace,   // the dead keep to their dens during the grace
    diff: grind === 1 ? baseDiff : { speedMul: baseDiff.speedMul * grind, senseMul: baseDiff.senseMul * grind, extra: baseDiff.extra, label: baseDiff.label },
    beamHits: (ex, ey) => beamHits(ex, ey),
    onCatch: (e) => { deathBy = catchLine(e); lastKiller = e.name; die(); },
  };
  updateWard(dt);   // apply the cross's ward BEFORE the dead act this frame (no lag)
  updateMelee(dt);  // and the weapon swing, same frame-order guarantee
  updateGenerator(dt);
  updateScares(dt);
  updateChase(dt);
  // the boiler room is guarded — first steps inside earn the warning
  if (!boilerWarned && player.floor === 0 && !powerOn && inRoom(0, 'boiler')) {
    boilerWarned = true;
    showSubtitle('Something feeds near the generator. Go low. Go slow.', 4.5);
    const gh = ents.find((e) => e.kind === 'ghoul');
    if (gh && genRec && gh.floor === 0) { gh.target = { x: genRec.tx, y: genRec.ty }; gh.path = null; }
  }
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
  const isMoving = player.moving || (isVR && (readAxes(moveStick)[0] || readAxes(moveStick)[1]));
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
  updateAtmosphere(dt);
  // flickering fixtures + animated toys + the haunted nursery + wall children
  updateFixtures(dt);
  animateProps(dt);
  nurseryUpdate(dt);
  matronUpdate(dt);
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

  // the heart knows before you do: proximity to anything awake drives the pulse
  // even when fear is low — closer = faster, a hunter close = hammering
  let dangerPulse = 0;
  ents.forEach((e) => {
    if (e.floor !== player.floor || e.state === Entities.S.DORMANT) return;
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < 12) dangerPulse = Math.max(dangerPulse, (1 - d / 12) * (e.state === Entities.S.HUNT ? 100 : 62));
  });
  Audio2.setFear(Math.max(player.fear, dangerPulse));
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
// ============================================================ wayfinding signs
// Aged enamel signs (generated pack) hung over the doorways they name — the
// hospital finally tells you where you are.
const SIGN_FOR_TAG = { maternity: 'maternity', surgery: 'surgery', xray: 'x-ray', records: 'records', morgue: 'morgue', autopsy: 'autopsy', pharmacy: 'pharmacy', chapel: 'chapel' };
const WARD_SIGNS = ['ward-2-a', 'ward-2-b'];
const signTexCache = {};
function signTex(name) {
  if (signTexCache[name] !== undefined) return signTexCache[name];
  const t = new THREE.TextureLoader().load('assets/generated/codex-visual-pack-v1/signs/' + name + '.png',
    undefined, undefined, () => { signTexCache[name] = null; });
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  return (signTexCache[name] = t);
}
function mountSigns(fi) {
  let wardIdx = 0;
  const grid = data.floors[fi].grid;
  (data.floors[fi].rooms || []).forEach((r) => {
    let key = r.tag === 'ward' ? WARD_SIGNS[wardIdx++ % WARD_SIGNS.length] : SIGN_FOR_TAG[r.tag];
    if (r.locked || (r.doorY != null && grid[r.doorY] && grid[r.doorY][r.doorX] === TILE.LOCKED)) key = 'no-admittance';   // what the county bolted stays nameless
    if (!key || r.doorX == null) return;
    const t = signTex(key); if (!t) return;
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.4),
      new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.85, emissive: 0x30302c, emissiveIntensity: 0.35, emissiveMap: t, side: THREE.DoubleSide, depthWrite: false }));
    // hung over the doorway, in the door's own plane
    sp.position.set((r.doorX + 0.5) * TILE_M, 2.42, (r.doorY + 0.5) * TILE_M);
    sp.renderOrder = 2;
    floorGroup.add(sp);
  });
}

// ============================================================ the generator
// A hulking 1920s unit in the boiler room. Cranking it is a held, LOUD ritual —
// the dead hear every pull — and what it buys is thin: the bottom two floors
// get a scatter of half-alive tubes. The wards above lost their lines in '88.
function addGenerator() {
  genRec = null;
  const r = data.floors[0].rooms.find((rr) => rr.tag === 'boiler');
  if (!r) return;
  const tx = r.cx + (r.w > 4 ? 1.2 : 0.6), ty = r.cy - 0.4;
  const wx = tx * TILE_M, wz = ty * TILE_M;
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2e3236, metalness: 0.7, roughness: 0.55 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x5a3a24, metalness: 0.4, roughness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a703a, metalness: 0.8, roughness: 0.4 });
  const block = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.8), iron); block.position.y = 0.65; g.add(block);
  const skid = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.2, 1.0), rust); skid.position.y = 0.1; g.add(skid);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.3, 12), rust);
  tank.rotation.z = Math.PI / 2; tank.position.set(0, 1.28, -0.18); g.add(tank);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 18), iron);
  wheel.position.set(0.82, 0.7, 0); wheel.rotation.y = Math.PI / 2; g.add(wheel);
  for (let i = 0; i < 3; i++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.56, 0.04), iron); spoke.rotation.x = i * Math.PI / 3; spoke.position.copy(wheel.position); g.add(spoke); }
  const crank = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), brass);
  crank.position.set(0.86, 0.95, 0.18); crank.rotation.z = 0.5; g.add(crank);
  const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.09, 14), new THREE.MeshStandardMaterial({ color: 0xd8d2b8, emissive: 0x221a08, emissiveIntensity: 0.4 }));
  gauge.position.set(-0.4, 1.05, 0.41); g.add(gauge);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.07, 0.004), new THREE.MeshBasicMaterial({ color: 0x8a1212 }));
  needle.position.set(-0.4, 1.05, 0.415); needle.rotation.z = 1.1; g.add(needle);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), rust);
  pipe.position.set(-0.6, 1.75, -0.3); g.add(pipe);
  // cables running off toward the wall — where the building drinks from it
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 }));
  cable.rotation.z = Math.PI / 2.3; cable.position.set(-1.4, 0.4, 0); g.add(cable);
  g.position.set(wx, 0, wz);
  g.rotation.y = 0.3;
  floorGroup.add(g);
  propSolids.push({ x0: wx - 0.95, z0: wz - 0.6, x1: wx + 0.95, z1: wz + 0.6 });
  genRec = { g, needle, wheel, tx, ty };
}
function reviveFixtures() {
  // "barely any lights work": a seeded ~40% of the dead tubes come back, dim and nervous
  let seed = 777 + player.floor;
  const rr = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  flickers.forEach((f) => {
    if (f.dead && rr() < 0.4) { f.dead = false; f.on = true; f.base = Math.max(f.base, f.light ? 0.9 : 0); f.nextFlick = rr() * 2; }
  });
}
function startCrank() {
  if (powerOn || crankT > 0) return;
  crankT = 4.2; crankTick = 0;
  showSubtitle('You haul on the crank. It is VERY loud. Keep pulling — and pray nothing is close.', 4);
}
function updateGenerator(dt) {
  // the hum follows you: on powered floors it lives in the walls
  const wantHum = powerOn && player.floor <= 1;
  if (wantHum !== genHumOn) { genHumOn = wantHum; if (wantHum) Audio2.genHumStart(); else Audio2.genHumStop(); }
  if (genRec && powerOn) { genRec.wheel.rotation.x += dt * 7; genRec.g.position.y = Math.sin(performance.now() / 60) * 0.004; genRec.needle.rotation.z = 0.2 + Math.sin(performance.now() / 300) * 0.15; }
  if (crankT <= 0) return;
  // cranking: stand your ground. Moving lets the flywheel die.
  if (player.moving) { crankT = 0; showSubtitle('The flywheel spins down. It needs your whole weight, uninterrupted.', 3); return; }
  crankT -= dt; crankTick -= dt;
  if (crankTick <= 0) { crankTick = 0.85; Audio2.generatorCrank(0.32); haptic(0.5, 90); if (genRec) genRec.wheel.rotation.x += 0.9; }
  if (crankT <= 0) {
    powerOn = true;
    Audio2.generatorStart();
    reviveFixtures();
    showSubtitle('The generator catches. Down here and the first floor, a few tubes stutter alive…', 4);
    surgeT = 1.8;   // …and then the basement answers
    saveState();
  }
}

// ============================================================ the surge chase
function startPowerChase() {
  chasers = ents.filter((e) => e.floor === 0 && e.kind !== 'ash').slice(0, 3);
  if (!chasers.length) chasers = ents.filter((e) => e.kind === 'ghoul').slice(0, 1);
  if (!chasers.length) return;
  chasers.forEach((e) => { if (e.awake) e.awake(); e.state = Entities.S.HUNT; e.lastSeen = { x: player.x, y: player.y }; e.cooldown = 8; e.path = null; });
  powerChase = true; chaseFailT = 110; chaseHideT = 0; doorBolted = false;
  Audio2.stinger(true); Audio2.chase(true); haptic(0.9, 250);
  player.fear = Math.min(100, player.fear + 12);
  showSubtitle('The current sings through the walls — and every throat in the basement opens at once. RUN. Up the stairs. BOLT THE DOOR.', 6);
}
function updateChase(dt) {
  if (surgeT > 0) { surgeT -= dt; if (surgeT <= 0) startPowerChase(); }
  if (!powerChase) return;
  chaseFailT -= dt;
  // they smell the current on you — the hunt does not decay on its own
  chaseRefreshT -= dt;
  if (chaseRefreshT <= 0) {
    chaseRefreshT = 1.2;
    chasers.forEach((e) => { if (e.floor === player.floor && !player.hidden) { e.state = Entities.S.HUNT; e.lastSeen = { x: player.x, y: player.y }; e.cooldown = 6; } });
  }
  // the bolt window: reach floor 1 and you have seconds before they're at the door
  if (lockWindowT > 0) { lockWindowT -= dt; if (lockWindowT <= 0) chaserArriveT = 0.1; }
  if (chaserArriveT > 0) {
    chaserArriveT -= dt;
    if (chaserArriveT <= 0 && stairArrive) {
      chasers.forEach((e, i) => { e.floor = player.floor; e.x = stairArrive.x + (i - 1) * 0.7; e.y = stairArrive.y; e.state = Entities.S.HUNT; e.lastSeen = { x: player.x, y: player.y }; e.path = null; });
      Audio2.slam(); Audio2.screechPan(0, 0.2);
      showSubtitle('The stairwell door BURSTS open behind you.', 3);
    }
  }
  // OUT 1: go still, stay hidden — they lose the scent
  if (player.hidden) { chaseHideT += dt; if (chaseHideT > 8) return endPowerChase('hide'); } else chaseHideT = 0;
  // OUT 2: an earned peace (draught, sanctum, a truth) disperses the hunt
  if (Survival.peaceActive()) return endPowerChase('peace');
  // OUT 3: the Matron. Put the soul-trapper between you and them.
  if (matronApp && !matronGone && player.floor === 4 && Math.hypot(matronApp.tx - player.x, matronApp.ty - player.y) < 3.4) return matronRescue();
  if (chaseFailT <= 0) return endPowerChase('faded');
}
function endPowerChase(reason) {
  powerChase = false; lockWindowT = 0; chaserArriveT = 0; chaseHideT = 0; surgeT = 0;
  chasers.forEach((e) => { e.floor = 0; e.state = Entities.S.PATROL; e.path = null; e.lastSeen = null; });
  chasers = [];
  if (reason === 'hide') showSubtitle('The footsteps circle… stop… and drag away down the stairwell. They’ve gone back to the dark.', 5);
  else if (reason === 'peace') showSubtitle('The quiet takes them mid-stride. They turn, lost, and sink back toward the basement.', 5);
  else if (reason === 'faded') showSubtitle('Somewhere behind you, the hunt loses your thread. For now.', 4);
  saveState();
}
function lockBasementDoor() {
  doorBolted = true;
  Audio2.slam(); Audio2.rattle(); haptic(0.7, 150);
  endPowerChase('bolted');
  player.fear = Math.max(0, player.fear - 8);
  showSubtitle('The bolt drops. Something hits the door. Once. Twice. …Then, quiet.', 5);
  let n = 0;
  const pound = setInterval(() => { if (state !== 'PLAY' || ++n > 3) return clearInterval(pound); Audio2.thud(0.5); Audio2.rattle(); }, 900);
}
function matronRescue() {
  powerChase = false; lockWindowT = 0; chaserArriveT = 0; chaseHideT = 0;
  Audio2.scream(); Audio2.stinger(true); comfortBlink(1); haptic(1, 300);
  // she takes them — a game-hour of silence from the ones she dragged down
  chasers.forEach((e) => { e.floor = 0; e.state = Entities.S.DORMANT; e.wakeHour = Math.min(23, hour + 1); e.path = null; e.lastSeen = null; });
  chasers = [];
  player.fear = Math.min(100, player.fear + 10);   // saved — but you'll never unsee it
  // and she spends herself doing it: when you look back, the corner is empty
  if (matronApp) { floorGroup.remove(matronApp.grp); matronApp = null; }
  matronGone = true;
  showSubtitle('The hooded thing finally MOVES — one step, arms opening. The dead behind you scream as she takes them. When you look back, the corner is empty.', 7);
  saveState();
}

// ============================================================ mirror scares
// Trigger points armed per floor, fired ONCE each, persisted through saves.
// The effects don't exist until your footsteps reach them.
function buildScareTriggers(fi) {
  scareTriggers = []; fallingMirrors = [];
  const g = data.floors[fi].grid;
  let seed = 4242 + fi * 131;
  const rr = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ct = data.CORR_TOP || 14, cb = data.CORR_BOT || 17;
  // 2 distant-shatter points along the corridor
  for (let i = 0; i < 2; i++) {
    const x = 8 + Math.floor(rr() * (World.W - 16));
    const id = 'f' + fi + '_far_' + i;
    scareTriggers.push({ id, kind: 'far', x: x + 0.5, y: (ct + cb) / 2 + 0.5, r: 1.8, fired: firedScares.has(id) });
  }
  // 1–2 falling mirrors mounted on corridor walls, tipped by your passing
  const nFall = 1 + (rr() < 0.5 ? 1 : 0);
  for (let i = 0; i < nFall; i++) {
    const x = 7 + Math.floor(rr() * (World.W - 14));
    const topSide = rr() < 0.5;
    const wallY = topSide ? ct : cb;   // corridor edge rows — walls line them
    const yTile = topSide ? ct - 1 : cb + 1;
    if (!g[yTile] || g[yTile][x] !== TILE.WALL) continue;   // needs a real wall behind it
    const id = 'f' + fi + '_fall_' + x;
    const wx = (x + 0.5) * TILE_M;
    const wz = (yTile + (topSide ? 1 : 0)) * TILE_M + (topSide ? 0.06 : -0.06);
    // the mirror itself: aged frame + a glass pane that still shows too much
    const grp = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.82, 0.05), new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.8 }));
    grp.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.72),
      new THREE.MeshStandardMaterial({ color: 0x9aa8b2, metalness: 0.9, roughness: 0.18, emissive: 0x0a0e12, emissiveIntensity: 0.4 }));
    glass.position.z = 0.028; grp.add(glass);
    grp.position.set(wx, 1.55, wz);
    grp.rotation.y = topSide ? 0 : Math.PI;
    floorGroup.add(grp);
    const fired = firedScares.has(id);
    if (fired) { grp.rotation.x = topSide ? 1.45 : -1.45; grp.position.y = 0.45; }   // already down: it lies where it fell
    scareTriggers.push({ id, kind: 'fall', x: x + 0.5, y: (ct + cb) / 2 + 0.5, r: 2.2, fired, grp, topSide, glass });
  }
}
function fireScare(s) {
  s.fired = true; firedScares.add(s.id);
  if (s.kind === 'far') {
    // a mirror lets go somewhere you can't see
    const pan = Math.random() < 0.5 ? -0.8 : 0.8;
    Audio2.glassShatterPan(pan, 0.14);
    player.fear = Math.min(100, player.fear + 6);
    showSubtitle('Somewhere down the hall, a mirror lets go of the wall.', 3.5);
  } else {
    fallingMirrors.push({ s, t: 0, vel: 0 });
  }
  saveState();
}
function updateScares(dt) {
  for (const s of scareTriggers) {
    if (s.fired || player.floor === undefined) continue;
    if (Math.hypot(s.x - player.x, s.y - player.y) < s.r) fireScare(s);
  }
  // falling mirrors: tip, accelerate, SHATTER
  for (let i = fallingMirrors.length - 1; i >= 0; i--) {
    const fm = fallingMirrors[i];
    fm.t += dt; fm.vel += dt * 6;
    const grp = fm.s.grp;
    const dir = fm.s.topSide ? 1 : -1;
    grp.rotation.x += dir * fm.vel * dt;
    grp.position.y = Math.max(0.45, grp.position.y - fm.vel * dt * 0.55);
    if (Math.abs(grp.rotation.x) >= 1.45 || grp.position.y <= 0.45) {
      grp.rotation.x = dir * 1.45; grp.position.y = 0.45;
      fallingMirrors.splice(i, 1);
      // the LOUD part
      Audio2.glassShatter(0.6);
      haptic(0.8, 120);
      comfortBlink(0.5);
      player.fear = Math.min(100, player.fear + 14);
      showSubtitle('THE MIRROR COMES OFF THE WALL AND SHATTERS.', 3);
      if (fm.s.glass) fm.s.glass.visible = false;
      glassBurst(grp.position.x, grp.position.z);
      // the dead heard that too — anything near comes to look
      ents.forEach((e) => {
        if (e.floor !== player.floor) return;
        if (Math.hypot(e.x - grp.position.x / TILE_M, e.y - grp.position.z / TILE_M) < 12) {
          e.lastSeen = { x: grp.position.x / TILE_M, y: grp.position.z / TILE_M };
          if (e.state !== Entities.S.HUNT && e.state !== Entities.S.DORMANT) { e.state = Entities.S.SEARCH; e.path = null; }
        }
      });
    }
  }
}
function glassBurst(wx, wz) {
  const N = 36, pos = new Float32Array(N * 3), vel = [];
  for (let i = 0; i < N; i++) {
    pos[i * 3] = wx + (Math.random() - 0.5) * 0.3; pos[i * 3 + 1] = 0.5 + Math.random() * 0.4; pos[i * 3 + 2] = wz + (Math.random() - 0.5) * 0.3;
    vel.push([(Math.random() - 0.5) * 2.2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2.2]);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDotTex(), color: 0xcfe4f2, size: 0.05, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false;
  floorGroup.add(pts);
  let life = 1.3;
  // sceneAnims contract: return truthy to stay alive, falsy to be removed
  sceneAnims.push((dt) => {
    life -= dt;
    for (let i = 0; i < N; i++) {
      vel[i][1] -= dt * 6;
      pos[i * 3] += vel[i][0] * dt; pos[i * 3 + 1] = Math.max(0.02, pos[i * 3 + 1] + vel[i][1] * dt); pos[i * 3 + 2] += vel[i][2] * dt;
    }
    geo.attributes.position.needsUpdate = true;
    pts.material.opacity = Math.max(0, life / 1.3);
    if (life <= 0) { floorGroup.remove(pts); return false; }
    return true;
  });
}

// ---- anchored hiding: interact beside a solid locker; emerge where you entered ----
let hideSpot = null;
function nearestHideForInteraction() {
  let best = null, bestD = 1.35;
  for (const tile of hideTiles) {
    const d = Math.hypot(tile.x - player.x, tile.y - player.y);
    if (d < bestD) { best = tile; bestD = d; }
  }
  return best;
}
function enterHide(target) {
  hideSpot = { floor: player.floor, x: target.x, y: target.y, exitX: player.x, exitY: player.y };
  player.hidden = true; player.moving = false; crouched = false;
  placeDollyAtTile(hideSpot.x, hideSpot.y);
  showSubtitle('You press into the dark and go still…  (interact again to come out)', 2.5);
}
function leaveHide() {
  const old = hideSpot;
  player.hidden = false; hideSpot = null;
  if (old) placeDollyAtNearestSafe(old.exitX, old.exitY);
  showSubtitle('You come out.', 2);
}
function isPlayerLit() {
  if (player.lightOn && player.battery > 0) return true;
  if (Survival.lanternActive()) return true;
  // standing in the pool of your own dropped, still-burning flashlight counts
  if (droppedLight && droppedLight.lit && !droppedLight.taken && droppedLight.floor === player.floor &&
    Math.hypot(droppedLight.x + 0.5 - player.x, droppedLight.y + 0.5 - player.y) < 2.5) return true;
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
  'Follow the pale wisp — it drifts toward whatever the house wants you to find next.',
  'Your free hand is your TOOL hand. Tap A (X on desktop) to cycle the cross or a weapon into it — HOLD to drop it. Hold B (F) to drop the flashlight; it burns on where it falls.',
  'Keep your light on. The dead can see its beam — but the dark feeds fear and hides what’s coming.',
  'Four truths are buried in these walls. Uncover them and survive till dawn, and the doors open. Fail, and you stay.',
];
function updateOnboarding(dt) {
  if (onboardStep < 0 || onboardStep >= ONBOARD.length) return;
  onboardT -= dt;
  if (onboardT <= 0) {
    let line = ONBOARD[onboardStep];
    // the last line states the mode's contract
    if (onboardStep === ONBOARD.length - 1 && realMode) {
      line = 'This is the LONG NIGHT: 24 real hours, no pause, and the dead only get keener. The truths won’t free you — but each one you speak buys minutes of real peace. Last until 6 PM tomorrow.';
    }
    showSubtitle(line, 4.6);
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
  if (t === TILE.DOWN && player.floor === 1 && powerChase && lockWindowT > 0) return '🚨 Trigger — SLAM the door and BOLT IT (' + Math.ceil(lockWindowT) + 's)';
  if (t === TILE.DOWN && player.floor === 1 && doorBolted) return 'Trigger — unbolt the stairwell door and descend';
  if (t === TILE.UP || t === TILE.DOWN) {
    const nf = Math.max(0, Math.min(4, player.floor + (t === TILE.UP ? 1 : -1)));
    const need = STAIR_KEYS[nf];
    if (need && !player.keys[need]) return 'Locked stairwell — needs the key to ' + keyLabel(need);
    return t === TILE.UP ? 'Trigger — climb the stairs up' : 'Trigger — descend the stairs';
  }
  if (player.hidden) return 'Trigger — leave hiding';
  if (nearestHideForInteraction()) return 'Trigger — hide here';
  if (exitRec && Math.hypot(exitRec.x - player.x, exitRec.y - player.y) < 1.35) return 'Trigger — the chained front doors';
  const doorHit = nearestDoorForInteraction();
  if (doorHit) {
    const door = doorHit.door;
    const room = data.floors[player.floor].rooms.find((r) => r.doorX === door.x && r.doorY === door.y);
    if (door.locked) {
      const keyId = room && KEY_FOR[room.tag];
      return keyId && player.keys[keyId]
        ? 'Trigger — unlock ' + (room ? room.name : 'the door')
        : 'Locked — needs ' + (keyId ? keyLabel(keyId) : 'a key');
    }
    return door.closed ? 'Trigger — open the door' : 'Trigger — close the door';
  }
  if (player.floor === 0 && genRec && !powerOn && Math.hypot(genRec.tx - player.x, genRec.ty - player.y) < 1.9)
    return crankT > 0 ? 'KEEP STILL — the flywheel is turning' : 'Trigger — crank the generator (it will be LOUD)';
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
  if (o && o.type === 'document' && !o.docId) return 'Trigger — read';
  if (o && o.type === 'document' && o.docId) return 'The ledger is here somewhere — find the page';
  if (o && o.type === 'bell') return 'Trigger — ring the dawn bell';
  if (o && o.type === 'spiritbox') return 'Hold left grip — spirit box';
  const sp = Survival.interactPrompt();
  if (sp) return sp;
  return null;
}
function itemName(t) { return ({ flashlight: 'flashlight', battery: 'batteries', emf: 'EMF reader', spiritbox: 'spirit box', candlekit: 'candles', key: 'key', draught: 'Quiet Draught', backpack: 'backpack', medkit: 'medkit', teddy: 'teddy bear', anchor: 'Spirit Anchor', censer: 'Matron’s Censer', ward: 'Warding Cross', weapon: 'weapon', lantern: 'storm lantern', matches: 'box of matches' })[t] || t; }
function itemDisplay(it) {
  if (it.type === 'anchor') { const a = data.rite.anchors.find((x) => x.key === it.anchor); return a ? a.name : 'Spirit Anchor'; }
  if (it.type === 'weapon') { const k = (it.kind && WEAPONS[it.kind]) ? it.kind : (WEAPONS[it.id] ? it.id : 'crowbar'); return WEAPONS[k].name; }
  return itemName(it.type);
}

// ============================================================ HUD
function updateHUD() {
  const done = data.objectives.filter((o) => o.done).length;
  // desktop DOM HUD
  setBar('fear-fill', player.fear); setBar('battery-fill', player.battery); setBar('stamina-fill', player.stamina);
  const fm = document.getElementById('faith-meter');
  if (fm) { fm.style.display = player.inv.cross ? '' : 'none'; if (player.inv.cross) setBar('faith-fill', player.faith); }
  setText('clock', fmtClock());
  setText('objective-count', `Truths: ${done}/${data.objectives.length}`);
  const inv = document.getElementById('inventory');
  if (inv) {
    const bits = [];
    if (player.hasLight) bits.push(player.lightOn ? '🔦 ON' : '🔦 off');
    if (player.inv.emf) bits.push('📶 EMF');
    if (player.inv.spiritbox) bits.push(spiritActive ? '📻 …' : '📻');
    if (player.inv.cross) bits.push((brandishing ? '✝✨ ' : '✝ ') + Math.round(player.faith) + '%');
    if (player.inv.weapon) bits.push(swingCd > 0 ? '⚒ …' : '⚒');
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
// ---- the wrist watch: a touch screen you tap with your other hand ----
function ensureWristMenuPanel() {
  if (wristMenuPanel) return;
  const c = document.createElement('canvas'); c.width = 512; c.height = 560;
  wristMenuCtx = c.getContext('2d');
  wristMenuTex = new THREE.CanvasTexture(c);
  if ('colorSpace' in wristMenuTex) wristMenuTex.colorSpace = THREE.SRGBColorSpace;
  wristMenuPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.26),
    new THREE.MeshBasicMaterial({ map: wristMenuTex, transparent: true, opacity: 0.96, fog: false, side: THREE.DoubleSide }));
  wristMenuPanel.position.set(0, 0.20, -0.04);
  wristMenuPanel.rotation.x = -Math.PI / 3.2;
}
// switch the watch face / pack / settings, showing or hiding the floating panel
function setWatchView(v) {
  ensureWristMenuPanel();
  watchView = v; wristMenu = (v === 'pack'); watchHover = -1; watchArmed = false;
  const host = wristPanel && wristPanel.parent;
  if (v === 'watch') { if (wristMenuPanel.parent) wristMenuPanel.parent.remove(wristMenuPanel); }
  else if (host) { if (wristMenuPanel.parent !== host) host.add(wristMenuPanel); if (v === 'pack') drawWristMenu(); else drawWatchSettings(); }
  Audio2.pickup();
}
// Y button (or the tutorial) flips the pack open/closed
function toggleWristMenu() { setWatchView(watchView === 'pack' ? 'watch' : 'pack'); watchUsed = true; }
// the fingertip of the hand NOT wearing the watch (right hand); falls back to the
// controller tip if the hand model / finger bones aren't present
function pokeTip() {
  const grip = sources.rightGrip; if (!grip) return null;
  const fs = grip.userData.fingers;
  if (fs && fs.length) { for (const f of fs) if (f.finger === 'index' && f.seg === 3) return f.b.getWorldPosition(_tv1); }
  grip.getWorldPosition(_tv1); grip.getWorldDirection(_tv2);
  return _tv1.add(_tv2.multiplyScalar(0.09));
}
// each frame: which button is the fingertip over, and did it press through?
function updateWatch(dt) {
  if (!isVR || !wristPanel || !wristPanel.parent) { watchHover = -1; return; }
  const active = watchView === 'watch'
    ? { panel: wristPanel, cw: 384, ch: 280, view: 'watch' }
    : (wristMenuPanel && wristMenuPanel.parent ? { panel: wristMenuPanel, cw: 512, ch: 560, view: watchView } : null);
  if (!active) { watchHover = -1; return; }
  const tip = pokeTip(); if (!tip) { watchHover = -1; return; }
  const lp = active.panel.worldToLocal(tip.clone());
  const W = active.panel.geometry.parameters.width, H = active.panel.geometry.parameters.height;
  let hov = -1;
  if (Math.abs(lp.x) <= W / 2 && Math.abs(lp.y) <= H / 2 && Math.abs(lp.z) < 0.06) {
    const u = (lp.x + W / 2) / W * active.cw, v = (H / 2 - lp.y) / H * active.ch;
    const btns = active.view === 'watch' ? watchFaceButtons() : watchMenuButtons(active.view);
    for (let i = 0; i < btns.length; i++) { const b = btns[i]; if (u >= b.x && u <= b.x + b.w && v >= b.y && v <= b.y + b.h) { hov = i; break; } }
    if (hov >= 0 && Math.abs(lp.z) < 0.014 && watchArmed) { watchArmed = false; fireWatch(active.view, hov); }
  }
  // re-arm only when the finger leaves the button entirely (hov becomes -1 when it
  // pulls back past 0.06 or slides off) — so a finger pushed THROUGH the thin panel
  // can't fire a second time on the way back out
  if (hov === -1) watchArmed = true;
  if (hov !== watchHover) {
    watchHover = hov;
    const done = data ? data.objectives.filter((o) => o.done).length : 0;
    if (watchView === 'watch') drawWrist(done); else if (watchView === 'pack') drawWristMenu(); else drawWatchSettings();
  }
}
function fireWatch(view, i) {
  watchUsed = true; haptic(0.4, 45, OPTS.swapHands ? 'left' : 'right');
  if (view === 'watch') {
    if (i === 0) setWatchView('pack'); else if (i === 1) setWatchView('settings'); else if (i === 2) { toggleFlash(); Audio2.pickup(); }
  } else if (view === 'pack') { if (i === 0) setWatchView('watch'); }
  else if (view === 'settings') {
    const b = watchMenuButtons('settings')[i];
    if (b.id === 'back') setWatchView('watch');
    else { if (b.id === 'haunt') { const k = HAUNT_ORDER.indexOf(OPTS.haunt); OPTS.haunt = HAUNT_ORDER[(k + 1) % 3]; } else OPTS[b.id] = !OPTS[b.id]; saveOpts(); applyBrightness(); drawWatchSettings(); Audio2.pickup(); }
  }
}
function drawWristMenu() {
  if (!wristMenuCtx) return;
  const c = wristMenuCtx; c.clearRect(0, 0, 512, 560);
  c.fillStyle = 'rgba(8,9,14,0.93)'; c.fillRect(0, 0, 512, 560);
  c.strokeStyle = 'rgba(201,162,74,0.5)'; c.strokeRect(3, 3, 506, 554);
  c.fillStyle = '#e7edf2'; c.font = "30px 'Special Elite', monospace"; c.textAlign = 'left';
  c.fillText('YOUR PACK', 20, 40);
  c.font = "22px 'Special Elite', monospace";
  const sv = Survival.state();
  const lines = [];
  lines.push(['🔦', 'Flashlight ' + (player.lightOn ? 'ON' : 'off') + ' — ' + Math.round(player.battery) + '%', '#8aff9e']);
  lines.push(['🔋', 'Spare batteries: ' + sv.batteries + '/' + sv.maxBatteries, '#9aa7b0']);
  lines.push(['✊', 'In hand: ' + toolLabel(player.tool) + (currentWeapon() && swingCd > 0 ? ' (recovering)' : ''), '#e8cf7a']);
  if (player.inv.cross) lines.push(['✝', 'Iron Cross — faith ' + Math.round(player.faith) + '%', '#e8cf7a']);
  if (player.weapons) { const ws = WEAPON_ORDER.filter((k) => player.weapons[k]).map((k) => WEAPONS[k].name); if (ws.length) lines.push(['⚒', 'Weapons: ' + ws.join(', '), '#b8c2cc']); }
  if (player.inv.emf) lines.push(['📶', 'EMF reader', '#7ad0ff']);
  if (player.inv.spiritbox) lines.push(['📻', 'Spirit box (hold left grip)', '#c99cff']);
  lines.push(['🍶', 'Quiet Draughts: ' + sv.draughts + '/' + sv.maxDraughts, '#9ae0c8']);
  lines.push(['⚕', 'Medkits: ' + sv.medkits, '#ff8a8a']);
  if (sv.lantern) lines.push(['🏮', 'Storm lantern — ' + (sv.lanternOn ? 'lit, ' + Math.round(sv.lanternFuel) + '%' : sv.matches ? 'unlit' : 'needs matches (kitchen)'), '#ffc04a']);
  lines.push(['🎒', sv.backpack ? 'Backpack (bigger pockets)' : 'No backpack yet — basement storage', '#b08a5a']);
  lines.push(['🧸', 'Teddies: ' + sv.teddies.length + '/7', '#d8a06a']);
  const heldKeys = Object.keys(player.keys);
  lines.push(['🗝', heldKeys.length ? heldKeys.map((id) => KEY_SHORT[id] || '?').join(' · ') : 'No keys yet', '#ffd24a']);
  if (data.rite && player.rite) {
    const carried = data.rite.anchors.filter((a) => player.rite[a.key]).length;
    const seated = (ritual && ritual.nodes) ? ritual.nodes.filter((n) => n.filled).length : 0;
    lines.push(['⚱', 'Rite: ' + seated + '/4 seated' + (carried ? ' · ' + carried + ' carried' : '') + (player.rite.censer ? ' · censer ✓' : ''), '#d8b24a']);
  }
  let y = 84;
  for (const [ic, txt, col] of lines) {
    c.fillStyle = '#8a95a0'; c.fillText(ic, 20, y);
    c.fillStyle = col; c.fillText(txt.slice(0, 34), 62, y);
    y += 36;
  }
  c.fillStyle = '#c9a24a'; c.font = "20px 'Special Elite', monospace"; c.textAlign = 'left';
  const next = data.objectives.find((o) => !o.done);
  c.fillText('▶ ' + (next ? next.title.slice(0, 36) : 'Reach the front doors'), 20, 530);
  c.fillStyle = '#6a7580'; c.font = "16px 'Special Elite', monospace";
  c.fillText('Tap BACK, or press Y', 20, 552);
  // BACK button — poke it to return to the watch face
  const bk = watchMenuButtons('pack')[0], hov = watchView === 'pack' && watchHover === 0;
  c.fillStyle = hov ? 'rgba(201,162,74,0.35)' : 'rgba(255,255,255,0.06)'; roundRectC(c, bk.x, bk.y, bk.w, bk.h, 8); c.fill();
  c.strokeStyle = hov ? '#e8cf7a' : 'rgba(255,255,255,0.2)'; c.lineWidth = hov ? 3 : 1.5; roundRectC(c, bk.x, bk.y, bk.w, bk.h, 8); c.stroke();
  c.fillStyle = hov ? '#ffe9a8' : '#cdd6de'; c.font = "22px 'Special Elite', monospace"; c.textAlign = 'center'; c.fillText('↩ BACK', bk.x + bk.w / 2, bk.y + 31);
  wristMenuTex.needsUpdate = true;
}
function drawWatchSettings() {
  if (!wristMenuCtx) return;
  const c = wristMenuCtx; c.clearRect(0, 0, 512, 560);
  c.fillStyle = 'rgba(8,9,14,0.95)'; c.fillRect(0, 0, 512, 560);
  c.strokeStyle = 'rgba(201,162,74,0.5)'; c.lineWidth = 1; c.strokeRect(3, 3, 506, 554);
  c.fillStyle = '#e7edf2'; c.font = "30px 'Special Elite', monospace"; c.textAlign = 'left'; c.fillText('SETTINGS', 24, 48);
  const labels = {
    bright: '💡 Lights: ' + (OPTS.bright ? 'DIM' : 'PITCH-DARK'),
    haunt: '💀 Haunt: ' + HAUNT[OPTS.haunt].label,
    swapHands: '🕹 Move stick: ' + (OPTS.swapHands ? 'RIGHT' : 'LEFT'),
    skipIntro: '🚶 Walk-up: ' + (OPTS.skipIntro ? 'SKIP' : 'FULL'),
    back: '↩ BACK TO WATCH',
  };
  watchMenuButtons('settings').forEach((b, i) => {
    const hov = watchHover === i;
    c.fillStyle = b.id === 'back' ? 'rgba(160,18,18,0.28)' : (hov ? 'rgba(201,162,74,0.3)' : 'rgba(255,255,255,0.05)');
    roundRectC(c, b.x, b.y, b.w, b.h, 10); c.fill();
    c.strokeStyle = hov ? '#e8cf7a' : 'rgba(255,255,255,0.2)'; c.lineWidth = hov ? 3 : 1.5; roundRectC(c, b.x, b.y, b.w, b.h, 10); c.stroke();
    c.fillStyle = hov ? '#ffe9a8' : '#e7edf2'; c.font = "24px 'Special Elite', monospace"; c.textAlign = 'left';
    c.fillText(labels[b.id], b.x + 20, b.y + 37);
  });
  c.fillStyle = '#6a7580'; c.font = "16px 'Special Elite', monospace"; c.fillText('Tap a row with your other hand', 24, 546);
  wristMenuTex.needsUpdate = true;
}

function roundRectC(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
const WATCH_ICONS = [['🎒', 'PACK'], ['⚙', 'SET'], ['🔦', 'LIGHT']];
function watchFaceButtons() { return [{ x: 12, y: 216, w: 114, h: 54 }, { x: 135, y: 216, w: 114, h: 54 }, { x: 258, y: 216, w: 114, h: 54 }]; }
function watchMenuButtons(view) {
  if (view === 'pack') return [{ id: 'back', x: 344, y: 12, w: 152, h: 46 }];
  if (view === 'settings') return [
    { id: 'bright', x: 24, y: 74, w: 464, h: 58 }, { id: 'haunt', x: 24, y: 140, w: 464, h: 58 },
    { id: 'swapHands', x: 24, y: 206, w: 464, h: 58 }, { id: 'skipIntro', x: 24, y: 272, w: 464, h: 58 },
    { id: 'back', x: 24, y: 352, w: 464, h: 58 },
  ];
  return [];
}
function drawWrist(done) {
  if (!wristCtx) return;
  const c = wristCtx; c.clearRect(0, 0, 384, 280);
  c.fillStyle = 'rgba(6,6,10,0.86)'; c.fillRect(0, 0, 384, 280);
  c.strokeStyle = 'rgba(201,162,74,0.3)'; c.lineWidth = 2; c.strokeRect(3, 3, 378, 274);
  c.fillStyle = '#cdd6de'; c.font = "30px 'Special Elite', monospace"; c.textAlign = 'left';
  c.fillText(fmtClock(), 16, 40);
  c.textAlign = 'right'; c.fillStyle = '#9aa7b0';
  c.fillText(`Truths ${done}/4` + (player.inv.weapon ? (swingCd > 0 ? '  ⚒…' : '  ⚒') : ''), 368, 40);
  // bars (compact rows so faith fits when you carry the cross)
  const hasFaith = !!player.inv.cross;
  const rows = hasFaith ? [58, 96, 134, 172] : [62, 106, 150];
  bar(c, 16, rows[0], 'FEAR', player.fear, '#e02a2a');
  bar(c, 16, rows[1], 'LIGHT', player.battery, '#8aff9e');
  bar(c, 16, rows[2], 'BODY', player.stamina, '#7ad0ff');
  if (hasFaith) bar(c, 16, rows[3], 'FAITH', player.faith, '#e8cf7a');
  c.fillStyle = '#c9a24a'; c.font = "17px 'Special Elite', monospace"; c.textAlign = 'left';
  const next = data.objectives.find((o) => !o.done);
  c.fillText((next ? next.title : 'Reach the front doors').slice(0, 32), 16, 202);
  // the icon row — poke these with your other hand
  const fb = watchFaceButtons();
  c.textAlign = 'center';
  fb.forEach((b, i) => {
    const hov = watchView === 'watch' && watchHover === i;
    c.fillStyle = hov ? 'rgba(201,162,74,0.35)' : 'rgba(255,255,255,0.06)'; roundRectC(c, b.x, b.y, b.w, b.h, 9); c.fill();
    c.strokeStyle = hov ? '#e8cf7a' : 'rgba(255,255,255,0.18)'; c.lineWidth = hov ? 3 : 1.5; roundRectC(c, b.x, b.y, b.w, b.h, 9); c.stroke();
    c.fillStyle = (i === 2 && player.lightOn) ? '#8aff9e' : '#e7edf2'; c.font = "30px 'Special Elite', monospace";
    c.fillText(WATCH_ICONS[i][0], b.x + b.w / 2, b.y + 30);
    c.fillStyle = hov ? '#ffe9a8' : '#9aa7b0'; c.font = "15px 'Special Elite', monospace";
    c.fillText(i === 2 ? (player.lightOn ? 'ON' : 'LIGHT') : WATCH_ICONS[i][1], b.x + b.w / 2, b.y + 48);
  });
  wristTex.needsUpdate = true;
  if (watchView !== 'watch' && (wristMenuT = (wristMenuT + 1) % 24) === 0) { if (watchView === 'pack') drawWristMenu(); else drawWatchSettings(); }
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

// ============================================================ multiplayer
// Up to 4 investigators share the seeded hospital. js/multiplayer.js owns the
// wire (PeerJS, host-relayed star); this side feeds it your transform and
// renders your friends as hooded investigators with live flashlights.
const netAvatars = new Map();   // peer id -> avatar record
const NET_JACKETS = [0x2c3c55, 0x4a3a26, 0x4e2a32, 0x33422e];   // navy / waxed-tan / oxblood / moss
const _netV = new THREE.Vector3();

function netMyState() {
  camera.getWorldDirection(_netV);
  camera.getWorldPosition(tmpV);
  return {
    f: player.floor, x: +player.x.toFixed(2), y: +player.y.toFixed(2), h: +tmpV.y.toFixed(2),
    ry: +Math.atan2(-_netV.x, -_netV.z).toFixed(2),
    l: (player.hasLight && player.lightOn && player.battery > 0) ? 1 : 0,
    hid: player.hidden ? 1 : 0,
    t: player.tool || 'bare',   // what the tool hand holds — friends see your cross or iron
  };
}
function netJacketIdx(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % NET_JACKETS.length; }

function netNameTag(name) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(6,8,12,0.7)'; c.fillRect(24, 12, 208, 40);
  c.font = '24px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#e7edf2'; c.fillText(String(name).slice(0, 14), 128, 33);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
  sp.scale.set(0.85, 0.21, 1);
  return sp;
}

function buildNetAvatar(name, idx) {
  const grp = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: NET_JACKETS[idx % NET_JACKETS.length], roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb08a70, roughness: 0.7 });
  const legG = new THREE.CapsuleGeometry(0.055, 0.62, 3, 8);
  const l1 = new THREE.Mesh(legG, dark); l1.position.set(-0.09, 0.42, 0);
  const l2 = new THREE.Mesh(legG, dark); l2.position.set(0.09, 0.42, 0);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 12), jacket);
  torso.position.y = 1.05;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), jacket); hood.position.y = 1.52;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8), skin); face.position.set(0, 1.51, -0.05);
  // right-hand flashlight — barrel always in hand, glow group toggles with their light
  const torch = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.15, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  const glow = new THREE.Group();
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 10), new THREE.MeshBasicMaterial({ color: 0xfff2d6 }));
  lens.position.z = -0.078;
  const spot = new THREE.SpotLight(0xfff2d6, 9, 13, 0.42, 0.55, 1.5);
  const tgt = new THREE.Object3D(); tgt.position.set(0, -0.15, -6);
  glow.add(lens, spot, tgt); spot.target = tgt;
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.4, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2d6, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  beam.rotation.x = -Math.PI / 2; beam.position.z = -1.78;
  glow.add(beam);
  torch.add(barrel, glow);
  torch.position.set(-0.24, 1.18, -0.12);   // the flashlight rides the OFF hand, same as yours
  torch.rotation.x = -0.06;
  // the tool hand shows what they're carrying: a pale iron cross, or a dark length of steel
  const toolG = new THREE.Group(); toolG.position.set(0.24, 1.12, -0.1);
  const ironM = new THREE.MeshStandardMaterial({ color: 0xd8ccc0, emissive: 0x776644, emissiveIntensity: 0.45, metalness: 0.6, roughness: 0.4 });
  const crossG = new THREE.Group();
  const cb1 = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.17, 0.022), ironM);
  const cb2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.022), ironM); cb2.position.y = 0.035;
  crossG.add(cb1, cb2); crossG.rotation.x = -0.3;
  const wbar = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.44, 0.035), dark.clone());
  wbar.rotation.z = 0.55; wbar.position.y = 0.06;
  crossG.visible = wbar.visible = false;
  toolG.add(crossG, wbar);
  const tag = netNameTag(name); tag.position.y = 1.86;
  grp.add(l1, l2, torso, hood, face, torch, toolG, tag);
  return { grp, torso, glow, tag, yaw: 0, bobT: 0, torsoY: 1.05, toolCross: crossG, toolBar: wbar };
}

function netTick(dt) {
  const M = window.MP;
  if (!M || !M.active()) {
    if (netAvatars.size) { netAvatars.forEach((av) => scene.remove(av.grp)); netAvatars.clear(); }
    return;
  }
  if (state === 'PLAY' && player) M.send(netMyState());
  const tNow = performance.now();
  const inPlay = state === 'PLAY' && player;
  M.peers().forEach((p, id) => {
    if (!p.st) return;
    let av = netAvatars.get(id);
    if (!av) { av = buildNetAvatar(p.name, netJacketIdx(id)); netAvatars.set(id, av); scene.add(av.grp); av.grp.position.set(p.st.x * TILE_M, 0, p.st.y * TILE_M); }
    const st = p.st;
    const show = inPlay && st.f === player.floor && !st.hid && (tNow - p.at) < 6000;
    av.grp.visible = show;
    if (!show) return;
    av.glow.visible = !!st.l;
    if (av.toolCross) { av.toolCross.visible = st.t === 'cross'; av.toolBar.visible = !!st.t && st.t !== 'bare' && st.t !== 'cross'; }
    const wx = st.x * TILE_M, wz = st.y * TILE_M;
    const dx = wx - av.grp.position.x, dz = wz - av.grp.position.z;
    const far = Math.hypot(dx, dz);
    if (far > 6) av.grp.position.set(wx, 0, wz);   // stairs / respawn — don't glide through the building
    else { const k = Math.min(1, dt * 10); av.grp.position.x += dx * k; av.grp.position.z += dz * k; }
    av.yaw += normAng((st.ry || 0) - av.yaw) * Math.min(1, dt * 10);
    av.grp.rotation.y = av.yaw;
    // crouch and jump both read straight off their head height (1.65 standing)
    const sy = Math.min(1.12, Math.max(0.6, (st.h || 1.65) / 1.65));
    av.grp.scale.y += (sy - av.grp.scale.y) * Math.min(1, dt * 8);
    const moving = far > 0.03 && far < 6;
    av.bobT += dt * (moving ? 10 : 0);
    av.torso.position.y = av.torsoY + (moving ? Math.sin(av.bobT) * 0.018 : 0);
  });
  netAvatars.forEach((av, id) => { if (!M.peers().has(id)) { scene.remove(av.grp); netAvatars.delete(id); } });
}

// ---- start-screen room controls: SOLO / HOST / JOIN ----
function bindMPUI() {
  const M = window.MP; if (!M) return;
  const el = (id) => document.getElementById(id);
  const panel = el('mp-panel'), statusEl = el('mp-status'), codeRow = el('mp-code-row'),
    codeEl = el('mp-code'), joinRow = el('mp-join-row'), rosterEl = el('mp-roster'), codeIn = el('mp-code-in');
  const escName = (s) => String(s).replace(/[<>&]/g, '');
  const guestName = 'GUEST-' + (10 + ((Math.random() * 90) | 0));
  const myName = () => (window.Accounts && Accounts.current()) ? Accounts.maskPhone(Accounts.current()) : guestName;
  let mpMode = 'solo';
  const paint = () => {
    [['mp-solo', 'solo'], ['mp-host', 'host'], ['mp-join', 'join']].forEach(([id, m]) => { const b = el(id); if (b) b.classList.toggle('selected', m === mpMode); });
    if (panel) panel.classList.toggle('show', mpMode !== 'solo');
    if (codeRow) codeRow.style.display = mpMode === 'host' ? '' : 'none';
    if (joinRow) joinRow.style.display = (mpMode === 'join' && !M.active()) ? '' : 'none';
    if (codeEl) codeEl.textContent = M.code();
  };
  const refreshRoster = () => {
    if (rosterEl) rosterEl.innerHTML = M.active()
      ? 'Investigators (' + M.count() + '/4): ' + M.roster().map((p) => '<b>' + escName(p.name) + (p.me ? ' (you)' : '') + '</b>').join(' · ')
      : '';
    paint();
  };
  M.onStatus((msg, kind) => { if (statusEl) { statusEl.textContent = msg; statusEl.className = kind || ''; } });
  M.onEvent((ev) => {
    refreshRoster();
    if (ev.kind === 'roster') return;
    if (state === 'PLAY' || state === 'CINE') {
      if (ev.kind === 'join') showSubtitle(ev.name + ' has entered the hospital.', 3.5);
      else if (ev.kind === 'leave') showSubtitle(ev.name + "'s light went out.", 3.5);
      else if (ev.kind === 'death') showSubtitle(ev.name + ' was taken — ' + (ev.by || 'the dark') + '.', 4.5);
      else if (ev.kind === 'win') showSubtitle(ev.name + ' made it to dawn.', 4);
    }
  });
  const onBtn = (id, fn) => { const b = el(id); if (b) b.onclick = fn; };
  onBtn('mp-solo', () => { M.leave(); mpMode = 'solo'; if (statusEl) statusEl.textContent = ''; refreshRoster(); });
  onBtn('mp-host', () => { mpMode = 'host'; M.setName(myName()); M.host(); refreshRoster(); });
  onBtn('mp-join', () => { mpMode = 'join'; paint(); if (codeIn) codeIn.focus(); });
  onBtn('mp-connect', () => { M.setName(myName()); M.join(codeIn ? codeIn.value : ''); });
  if (codeIn) codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { M.setName(myName()); M.join(codeIn.value); } });
  onBtn('mp-copy', () => { try { navigator.clipboard.writeText(M.code()); } catch (e) { } });
}

// ============================================================ state
// free the mouse so the player can click menu buttons (desktop pointer-lock play)
function freeCursor() { if (!isVR) { try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { } } }
let pausedAt = 0;
function pause() {
  if (state !== 'PLAY') return;
  if (realMode) {
    // 24-HOUR SURVIVAL: there is no pause. The clock is the challenge.
    // Your breaks are the ones you EARN — draughts, the chapel, the truths.
    showSubtitle('There is no pause in the long night. The chapel holds peace. So do the truths.', 4.5);
    return;
  }
  pausedAt = Date.now();
  state = 'PAUSE'; stopSpirit(); Audio2.suspend(); freeCursor();
  if (!isVR) document.getElementById('pausescreen').classList.add('show');
}
function resumeGame() {
  if (state !== 'PAUSE') return;
  // One Night's compressed clock FREEZES while paused (the 24-hour clock never
  // pauses at all) — shift the epoch so paused time simply didn't happen
  if (pausedAt) { startEpoch += Date.now() - pausedAt; pausedAt = 0; }
  document.getElementById('pausescreen').classList.remove('show');
  state = 'PLAY'; Audio2.resume(); clock.getDelta();
}
function runMeta() { return { truths: data.objectives.filter((o) => o.done).length, mode: realMode ? '24h' : 'night' }; }
function filedLine() {
  return (window.Accounts && Accounts.current())
    ? 'Filed to your record (📜 My Nights): survived ' + Accounts.fmtTime(elapsed) + '.' : null;
}
function die() {
  if (state === 'DEAD') return;
  if (window.MP && MP.active()) MP.event({ kind: 'death', by: lastKiller || 'Fear itself' });
  if (window.Accounts) Accounts.recordDeath(elapsed, lastKiller || 'Fear itself', runMeta());
  state = 'DEAD'; stopSpirit(); Audio2.stinger(true); clearSave(); freeCursor();
  setTimeout(() => Audio2.suspend(), 1600);
  const filed = filedLine();
  if (isVR) showBigPanel('YOU DIED', [deathBy].concat(data.LORE.ending_bad, filed ? [filed] : []), '#e02a2a');
  else {
    setText('death-reason', deathBy);
    const dl = document.getElementById('death-lore');
    if (dl) dl.innerHTML = data.LORE.ending_bad.map((l) => `<p>${l}</p>`).join('') + (filed ? `<p class="hint" style="color:#8a95a0">${filed}</p>` : '');
    document.getElementById('deathscreen').classList.add('show');
  }
  refreshAcctBar();   // records strip + resume state stay current for the menu
}
function win() {
  if (state === 'WIN') return;
  if (window.MP && MP.active()) MP.event({ kind: 'win' });
  // in 24-hour survival, finishing the Rite along the way still counts on your record
  if (window.Accounts) Accounts.recordWin(elapsed, !!(realMode && ritual && ritual.done), runMeta());
  state = 'WIN'; stopSpirit(); clearSave(); freeCursor();
  const filedW = filedLine();
  const title = realMode ? '6:00 PM — THE RIDE CAME BACK' : 'DAWN';
  const doneT = data.objectives.filter((o) => o.done).length;
  const lines = realMode
    ? ['Twenty-four hours in the Old Hospital on College Hill.', 'You lasted every one of them.',
      doneT ? 'Truths uncovered along the way: ' + doneT + '/' + data.objectives.length + (ritual && ritual.done ? ' — and the Rite performed.' : '.') : 'You survived on nerve alone. The truths are still down there.']
    : data.LORE.ending_good;
  if (isVR) showBigPanel(title, lines.concat(filedW ? [filedW] : []), '#8affb0');
  else {
    const ws = document.getElementById('winscreen');
    const h2 = ws && ws.querySelector('h2'); if (h2) h2.textContent = title;
    const reason = ws && ws.querySelector('.reason'); if (reason) reason.textContent = realMode ? 'You survived 24 real hours in the Old Hospital on College Hill.' : 'You survived the night at the Old Hospital on College Hill.';
    const wl = document.getElementById('win-lore'); if (wl) wl.innerHTML = lines.map((l) => `<p>${l}</p>`).join('') + (filedW ? `<p class="hint" style="color:#8a95a0">${filedW}</p>` : '');
    document.getElementById('winscreen').classList.add('show');
  }
  refreshAcctBar();
  setTimeout(() => Audio2.suspend(), 6000);
}
// The true ending — reached by completing the Unbinding Rite (not just surviving).
function trueEnding() {
  if (state === 'WIN') return;
  if (window.MP && MP.active()) MP.event({ kind: 'win' });
  if (window.Accounts) Accounts.recordWin(elapsed, true, runMeta());
  riteClimax = false;
  state = 'WIN'; stopSpirit(); clearSave(); freeCursor();
  const title = 'THE HOUSE IS EMPTY';
  if (isVR) showBigPanel(title, data.LORE.ending_true, '#bfeecf');
  else {
    const ws = document.getElementById('winscreen');
    const h2 = ws && ws.querySelector('h2'); if (h2) h2.textContent = title;
    const reason = ws && ws.querySelector('.reason'); if (reason) reason.textContent = 'You performed the Unbinding Rite and set every soul free.';
    const wl = document.getElementById('win-lore'); if (wl) wl.innerHTML = data.LORE.ending_true.map((l) => `<p>${l}</p>`).join('') + (filedLine() ? `<p class="hint" style="color:#8a95a0">${filedLine()}</p>` : '');
    ws.classList.add('show');
  }
  refreshAcctBar();
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
