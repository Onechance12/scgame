/* ============================================================================
 * survival.js — the 24-hour survival economy.
 * Inventory (backpack, drinks, medkits), the Quiet Draught (5 real minutes of
 * peace — the dead cannot find you), the Sanctum (a locked safe room granting
 * a 30-minute protected break on a cooldown), the Matron's safe puzzle, the
 * seven hidden teddy bears, and a 24-hour almanac: one authored event for
 * every hour of the night. Loaded as a classic script; hooks provided by
 * vr-game.js via Survival.init(hooks).
 * ==========================================================================*/

const Survival = (() => {
  let H = null;          // hooks {player, ents, data, subtitle, audio, powerSurge, save, inRoom}
  let realMode = false;

  const S = {
    draughts: 1,         // start with one small mercy
    maxDraughts: 2,      // backpack raises to 5
    backpack: false,
    medkits: 0,
    batteries: 0,        // spare flashlight batteries (auto-loaded at empty)
    maxBatteries: 2,     // backpack raises to 5
    lantern: false,      // the backup lantern
    lanternOn: false,
    lanternFuel: 100,
    teddies: [],         // collected teddy ids
    blessed: false,      // all 7 teddies -> the children's blessing
    safeOpened: false,
    peaceUntil: 0,       // epoch ms — active Quiet Draught / Sanctum peace
    peaceKind: '',
    sanctumReadyAt: 0,   // epoch ms cooldown gate
    lastAlmanacHour: -1,
    boostUntil: 0,       // witching-hour entity speed boost
  };

  // ---------- the 24-hour almanac: one authored beat per hour of the night --
  // h = in-game hour since 6 PM (0..23). Fires once when the hour is reached.
  const ALMANAC = [
    { h: 0, t: 'The sun is down. The chain on the doors has gone cold.', fx: 'creak' },
    { h: 1, t: 'Shift change. Somewhere, a cart rolls over tile. No one pushes it.', fx: 'drag' },
    { h: 2, t: 'The Night Nurse clocks in. She still counts the beds.', fx: 'steps' },
    { h: 3, t: 'Pipes knock in the walls — or something knocks back.', fx: 'drip' },
    { h: 4, t: 'The kitchen. Something is crawling between the counters.', fx: 'drag' },
    { h: 5, t: '11 PM. The children are awake now. Listen.', fx: 'laugh' },
    { h: 6, t: 'MIDNIGHT. Every door in the hospital breathes in.', fx: 'slam' },
    { h: 7, t: 'The mobile in the nursery turns without wind.', fx: 'music' },
    { h: 8, t: '2 AM. The power grid begins to fail.', fx: 'surge' },
    { h: 9, t: '3 AM — THE WITCHING HOUR. They are fastest now. Hide, or burn light.', fx: 'witch' },
    { h: 10, t: 'Whispers move room to room like a rumor.', fx: 'whisper' },
    { h: 11, t: '5 AM. A false grey light in the windows. It is lying to you.', fx: 'dread' },
    { h: 12, t: '6 AM. The dead remember dying. The building grieves.', fx: 'scream' },
    { h: 13, t: 'Morning rounds. The Grey Nurse checks pulses that stopped decades ago.', fx: 'steps' },
    { h: 14, t: '8 AM. Even haunted places doze. Breathe. Restock. Read.', fx: 'quiet' },
    { h: 15, t: 'A radio in the walls hums a hymn from 1937.', fx: 'music' },
    { h: 16, t: '10 AM. The Ash stokes itself. The basement warms.', fx: 'dread' },
    { h: 17, t: 'Nooning. Dust hangs still. The eyes in the paintings do not.', fx: 'whisper' },
    { h: 18, t: 'The afternoon stretches wrong — clocks disagree with each other.', fx: 'creak' },
    { h: 19, t: '1 PM. A child hums the lullaby back at the music box.', fx: 'hum' },
    { h: 20, t: '2 PM. Something heavy is dragged across the floor above you.', fx: 'drag' },
    { h: 21, t: '3 PM. The mirror hour. The witching hour’s reflection. They surge again.', fx: 'witch' },
    { h: 22, t: '4 PM. The building knows you are close to leaving. It gets desperate.', fx: 'surge' },
    { h: 23, t: '5 PM. One hour. The dead gather in the lobby to watch the doors.', fx: 'scream' },
  ];

  function fireAlmanac(entry) {
    const A = H.audio;
    H.subtitle('— ' + entry.t + ' —', 5);
    switch (entry.fx) {
      case 'creak': A.creak(); break;
      case 'drag': A.drag(); break;
      case 'steps': A.footstepPan(-0.6, 0.07); setTimeout(() => A.footstepPan(0.6, 0.07), 400); break;
      case 'drip': A.drip(); setTimeout(() => A.drip(), 700); break;
      case 'laugh': A.laughPan(0, 0.05); break;
      case 'slam': A.slam(); break;
      case 'music': A.musicBox(0.9); break;
      case 'surge': if (H.powerSurge) H.powerSurge(); break;
      case 'witch': S.boostUntil = Date.now() + (realMode ? 3600e3 : 45e3); A.stinger(true); break;
      case 'whisper': A.whisper(1); break;
      case 'dread': A.dread(); break;
      case 'scream': A.scream(1.5); break;
      case 'hum': A.humming(); break;
      case 'quiet': { const p = H.player(); p.fear = Math.max(0, p.fear - 20); break; }
    }
  }

  // ---------- peace ----------
  function peaceActive() { return Date.now() < S.peaceUntil; }
  function peaceRemaining() { return Math.max(0, S.peaceUntil - Date.now()); }
  function startPeace(mins, kind) {
    S.peaceUntil = Date.now() + mins * 60e3;
    S.peaceKind = kind;
    H.audio.musicBox(1.1);
    H.subtitle(kind === 'sanctum'
      ? 'The Sanctum seals behind you. For ' + mins + ' minutes, nothing dead may enter.'
      : 'Warmth spreads through your chest. For ' + mins + ' minutes, they cannot find you.', 5);
  }

  function drink() {
    if (S.draughts <= 0) { H.subtitle('No draughts left. The matron’s safe held more, once.', 3); return; }
    if (peaceActive()) { H.subtitle('The last mercy is still working. Don’t waste this one.', 3); return; }
    S.draughts--;
    H.audio.pickup();
    startPeace(realMode ? 5 : 1.5, 'draught');
    const p = H.player(); p.fear = Math.max(0, p.fear - 25);
    H.save();
  }

  function useMedkit() {
    if (S.medkits <= 0) return false;
    S.medkits--; const p = H.player();
    p.fear = Math.max(0, p.fear - 45);
    H.subtitle('You bandage nothing and everything. Your heart slows.', 3);
    H.audio.pickup(); H.save();
    return true;
  }

  // ---------- pickups routed from vr-game ----------
  function onPickup(it) {
    const A = H.audio;
    switch (it.type) {
      case 'draught':
        if (S.draughts >= S.maxDraughts) { H.subtitle('No room for another draught.' + (S.backpack ? '' : ' A backpack would help.'), 3); return false; }
        S.draughts++; A.pickup();
        H.subtitle('A Quiet Draught (' + S.draughts + '/' + S.maxDraughts + '). Drink it (C / left trigger) for five minutes of peace.', 4.5);
        break;
      case 'backpack':
        S.backpack = true; S.maxDraughts = 5; S.maxBatteries = 5; A.pickup();
        // pre-packed: someone left in a hurry and never came back for it
        S.batteries += 2; S.draughts = Math.min(S.maxDraughts, S.draughts + 1); S.medkits++;
        H.subtitle('An orderly’s backpack — pre-packed: 2 batteries, a draught, a medkit. They never came back for it.', 5);
        break;
      case 'battery': {
        const p = H.player();
        if (p.battery < 55) { p.battery = Math.min(100, p.battery + 45); H.subtitle('Batteries — straight into the flashlight.', 2.5); }
        else if (S.batteries < S.maxBatteries) { S.batteries++; H.subtitle('Spare batteries pocketed. (' + S.batteries + '/' + S.maxBatteries + ')', 2.5); }
        else { H.subtitle('No room for more batteries.', 2); return false; }
        A.pickup();
        break;
      }
      case 'lantern':
        // the chapel lantern comes with a matchbook tucked under the bail — lights at once
        S.lantern = true; S.lanternOn = true; S.matches = true; A.pickup();
        H.subtitle('An old hurricane lantern, a matchbook under the bail. Soft light all around you — toggle it with L (or click the left stick). It burns slow.', 5);
        break;
      case 'matches':
        S.matches = true; A.pickup();
        if (S.lantern && !S.lanternOn && S.lanternFuel > 0) {
          S.lanternOn = true;
          H.subtitle('Kitchen matches. You strike one — the storm lantern takes the flame. Soft gold light all around you.', 4.5);
        } else H.subtitle('A box of kitchen matches. Now — something worth lighting.', 3);
        break;
      case 'medkit':
        S.medkits++; A.pickup();
        H.subtitle('A field medkit (' + S.medkits + '). Use it when your heart is failing (V).', 3.5);
        break;
      case 'teddy': {
        if (!S.teddies.includes(it.id)) S.teddies.push(it.id);
        A.laughPan(0, 0.04); A.pickup();
        const n = S.teddies.length;
        H.subtitle('A child’s teddy bear. (' + n + '/7)' + (n < 7 ? ' Somewhere, a small voice says thank you.' : ''), 4);
        if (n >= 7 && !S.blessed) {
          S.blessed = true;
          H.audio.musicBox(1);
          H.subtitle('All seven found. THE CHILDREN’S BLESSING: they will slow the dead around you, always.', 6);
        }
        break;
      }
      default: return false;
    }
    H.save();
    return true;
  }

  // ---------- the Matron's safe (floor 4) ----------
  function safeRoom() { const r = H.data().floors[4].rooms.find((x) => x.tag === 'matron'); return r || null; }
  function nearSafe() {
    const r = safeRoom(); if (!r) return false;
    const p = H.player();
    return p.floor === 4 && Math.hypot(r.x + 1.5 - p.x, r.y + 1.5 - p.y) < 1.6;
  }
  function codeKnown() {
    const docs = H.docs();
    return ['doc_fire', 'doc_dedication', 'doc_police'].every((id) => { const d = docs.find((x) => x.id === id); return d && d.found; });
  }
  function trySafe() {
    if (S.safeOpened) return false;
    if (!nearSafe()) return false;
    if (!codeKnown()) {
      H.subtitle('A heavy safe. The dial wants three dates. The case file will know them: the fire, the opening, the shooting.', 5);
      return true;
    }
    S.safeOpened = true;
    H.audio.creak(); H.audio.pickup();
    const p = H.player();
    p.keys.key_sanctum = true;
    S.draughts = Math.min(S.maxDraughts, S.draughts + 2);
    S.medkits++;
    H.subtitle('26 – 28 – 62. The safe opens: the SANCTUM KEY, two draughts, a medkit. The matron kept mercy locked up.', 6);
    H.save();
    return true;
  }

  // ---------- the Sanctum (locked room, floor 4) ----------
  function sanctumRoom() { return H.data().floors[4].rooms.find((x) => x.tag === 'sanctum') || null; }
  function inSanctum() {
    const r = sanctumRoom(); if (!r) return false;
    const p = H.player();
    return p.floor === 4 && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }
  function trySanctum() {
    if (!inSanctum() || peaceActive()) return false;
    const now = Date.now();
    if (now < S.sanctumReadyAt) {
      const m = Math.ceil((S.sanctumReadyAt - now) / 60e3);
      H.subtitle('The Sanctum’s candles are spent. They re-form in ' + m + ' min.', 3.5);
      return true;
    }
    startPeace(realMode ? 30 : 3, 'sanctum');
    S.sanctumReadyAt = now + (realMode ? 150 : 8) * 60e3; // every 2.5h real / 8min compressed
    const p = H.player(); p.fear = Math.max(0, p.fear - 40);
    H.save();
    return true;
  }

  // ---------- prompts / interact ----------
  function interactPrompt() {
    if (nearSafe() && !S.safeOpened) return codeKnown() ? 'Trigger — enter the dates into the matron’s safe' : 'Trigger — a locked safe (three dates)';
    if (inSanctum() && !peaceActive()) return 'Trigger — kneel: claim the Sanctum’s protection';
    if (S.draughts > 0 && !peaceActive()) return null; // drinking has its own key; keep prompt clean
    return null;
  }
  function tryInteract() { return trySafe() || trySanctum(); }

  // ---------- per-frame ----------
  function update(dt, hour, real) {
    realMode = real;
    // hourly almanac
    const hr = Math.floor(hour);
    if (hr !== S.lastAlmanacHour && hr >= 0 && hr < 24) {
      S.lastAlmanacHour = hr;
      const entry = ALMANAC.find((a) => a.h === hr);
      if (entry) fireAlmanac(entry);
    }
    // peace calms the heart
    if (peaceActive()) { const p = H.player(); p.fear = Math.max(0, p.fear - dt * 2.5); }
    // auto-load a spare battery the moment the flashlight dies
    const p = H.player();
    if (p.battery <= 0.5 && S.batteries > 0) {
      S.batteries--; p.battery = 100;
      H.subtitle('You slam in a fresh battery in the dark. (' + S.batteries + ' spare)', 3);
      H.audio.pickup(); H.save();
    }
    // lantern fuel
    if (S.lanternOn) {
      S.lanternFuel = Math.max(0, S.lanternFuel - dt * (real ? 0.012 : 0.25));
      if (S.lanternFuel <= 0) { S.lanternOn = false; H.subtitle('The lantern gutters out.', 2.5); }
    }
  }
  function lanternActive() { return S.lantern && S.lanternOn && S.lanternFuel > 0; }
  function toggleLantern() {
    if (!S.lantern) { H.subtitle('You don’t have a lantern. One hangs somewhere in the chapel.', 2.5); return; }
    if (S.lanternFuel <= 0) { H.subtitle('The lantern is dry.', 2); return; }
    if (!S.lanternOn && !S.matches) { H.subtitle('Nothing to light it with. There were matches in this place once — try the kitchen.', 3.5); return; }
    S.lanternOn = !S.lanternOn; H.audio.pickup();
  }

  function entityTimeScale() {
    let s = 1;
    if (Date.now() < S.boostUntil) s *= 1.5;      // witching hours
    if (S.blessed) s *= 0.8;                       // the children slow the dead
    if (peaceActive()) s *= 0.85;
    return s;
  }

  function hudText() {
    const bits = [];
    if (peaceActive()) {
      const ms = peaceRemaining(), m = Math.floor(ms / 60e3), s2 = Math.floor((ms % 60e3) / 1000);
      bits.push((S.peaceKind === 'sanctum' ? '⛨ ' : '☕ ') + m + ':' + String(s2).padStart(2, '0'));
    }
    if (S.draughts > 0) bits.push('🍶' + S.draughts);
    if (S.medkits > 0) bits.push('⚕' + S.medkits);
    if (S.batteries > 0) bits.push('🔋' + S.batteries);
    if (lanternActive()) bits.push('🏮 ' + Math.round(S.lanternFuel) + '%');
    else if (S.lantern) bits.push('🏮 off');
    if (S.backpack) bits.push('🎒');
    if (S.teddies.length) bits.push('🧸' + S.teddies.length + '/7');
    return bits.join('  ');
  }

  // ---------- persistence ----------
  function serialize() {
    return { draughts: S.draughts, maxDraughts: S.maxDraughts, backpack: S.backpack, medkits: S.medkits,
      batteries: S.batteries, maxBatteries: S.maxBatteries, lantern: S.lantern, lanternOn: S.lanternOn, lanternFuel: S.lanternFuel, matches: S.matches,
      teddies: S.teddies, blessed: S.blessed, safeOpened: S.safeOpened,
      peaceUntil: S.peaceUntil, peaceKind: S.peaceKind, sanctumReadyAt: S.sanctumReadyAt,
      lastAlmanacHour: S.lastAlmanacHour };
  }
  function restore(o) { if (o) Object.assign(S, o); }
  function reset() {
    Object.assign(S, { draughts: 1, maxDraughts: 2, backpack: false, medkits: 0, teddies: [], blessed: false,
      safeOpened: false, peaceUntil: 0, peaceKind: '', sanctumReadyAt: 0, lastAlmanacHour: -1, boostUntil: 0 });
  }

  function init(hooks) { H = hooks; }

  function reset2() {
    Object.assign(S, { batteries: 0, maxBatteries: 2, lantern: false, lanternOn: false, lanternFuel: 100, matches: false });
  }
  // grant an item outright (no pickup prompt) — used to hand over the kit a
  // returning player would otherwise collect on the tutorial walk-up
  function give(type) {
    if (type === 'lantern') { S.lantern = true; S.lanternFuel = 100; }
    else if (type === 'backpack') { S.backpack = true; S.maxDraughts = 5; S.maxBatteries = 5; }
    else if (type === 'battery') { S.batteries = Math.min(S.maxBatteries, S.batteries + 1); }
    else if (type === 'medkit') { S.medkits++; }
  }
  return { init, reset: () => { reset(); reset2(); }, update, onPickup, give, drink, useMedkit, tryInteract, interactPrompt,
    peaceActive, entityTimeScale, hudText, serialize, restore, lanternActive, toggleLantern, state: () => S };
})();
if (typeof window !== 'undefined') window.Survival = Survival;
