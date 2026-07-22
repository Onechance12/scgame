/* ============================================================================
 * audio.js — Procedural horror audio engine (Web Audio API).
 * Everything is synthesized live. There are no sound files.
 * A single AudioContext, unlocked by the player's first click (Start).
 * ==========================================================================*/

const Audio2 = (() => {
  let ctx = null;
  let master = null;
  let ambientGain = null;
  let started = false;
  let fear = 0;           // 0..100, drives heartbeat + dread
  let heartTimer = 0;
  let noiseBuffer = null;

  // pseudo-random that doesn't need Math.random seeding elsewhere
  let seed = 1337;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  function makeNoiseBuffer() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
    return buf;
  }

  function noiseSource() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer;
    s.loop = true;
    return s;
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    noiseBuffer = makeNoiseBuffer();
  }

  function now() { return ctx.currentTime; }

  // ---- Ambient bed: two detuned low drones + a slow filtered-noise wind ----
  let droneA, droneB, wind, windFilter;
  function startAmbient() {
    if (started || !ctx) return;
    started = true;
    if (ctx.state === 'suspended') ctx.resume();

    ambientGain = ctx.createGain();
    ambientGain.gain.value = 0.0;
    ambientGain.connect(master);
    ambientGain.gain.linearRampToValueAtTime(0.5, now() + 4);

    droneA = ctx.createOscillator();
    droneA.type = 'sine';
    droneA.frequency.value = 42;
    const ga = ctx.createGain(); ga.gain.value = 0.18;
    droneA.connect(ga); ga.connect(ambientGain); droneA.start();

    droneB = ctx.createOscillator();
    droneB.type = 'sine';
    droneB.frequency.value = 42.7; // beat frequency ~0.7Hz -> unease
    const gb = ctx.createGain(); gb.gain.value = 0.14;
    droneB.connect(gb); gb.connect(ambientGain); droneB.start();

    // faint high metallic shimmer that fades in with fear
    const shimmer = ctx.createOscillator();
    shimmer.type = 'triangle';
    shimmer.frequency.value = 2100;
    shimmerGain = ctx.createGain(); shimmerGain.gain.value = 0.0;
    shimmer.connect(shimmerGain); shimmerGain.connect(ambientGain); shimmer.start();

    wind = noiseSource();
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 320;
    windFilter.Q.value = 6;
    const wg = ctx.createGain(); wg.gain.value = 0.09;
    wind.connect(windFilter); windFilter.connect(wg); wg.connect(ambientGain);
    wind.start();

    // slowly sweep the wind filter forever for a breathing hallway
    sweepWind();
  }

  let shimmerGain;
  function sweepWind() {
    if (!windFilter) return;
    const t = now();
    const target = 200 + rnd() * 500;
    windFilter.frequency.cancelScheduledValues(t);
    windFilter.frequency.linearRampToValueAtTime(target, t + 6 + rnd() * 6);
    setTimeout(sweepWind, 6000 + rnd() * 6000);
  }

  function setFear(v) {
    fear = Math.max(0, Math.min(100, v));
    if (shimmerGain) {
      const g = (fear / 100) * 0.02;
      shimmerGain.gain.setTargetAtTime(g, now(), 1.5);
    }
    if (droneA && droneB) {
      // detune widens with fear -> more dissonant beating
      const beat = 0.7 + (fear / 100) * 2.5;
      droneB.frequency.setTargetAtTime(42 + beat, now(), 2);
    }
  }

  // ---- Heartbeat, rate scales with fear. Called from game update(dt). ----
  function tickHeart(dt) {
    if (!started) return;
    const bpm = 48 + (fear / 100) * 92;         // 48 -> 140
    const interval = 60 / bpm;
    heartTimer -= dt;
    if (heartTimer <= 0) {
      heartTimer = interval;
      if (fear > 22) heartbeat(0.15 + (fear / 100) * 0.5);
    }
  }

  function heartbeat(vol) {
    const t = now();
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.24);
    // second thump
    const t2 = t + 0.22;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(70, t2);
    o2.frequency.exponentialRampToValueAtTime(34, t2 + 0.12);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t2);
    g2.gain.exponentialRampToValueAtTime(vol * 0.7, t2 + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.2);
    o2.connect(g2); g2.connect(master);
    o2.start(t2); o2.stop(t2 + 0.22);
  }

  // ---- Whisper: band-passed noise burst, random pan, breathy envelope ----
  function whisper(intensity = 1) {
    if (!started) return;
    const t = now();
    const s = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + rnd() * 1400;
    bp.Q.value = 8;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = rnd() * 2 - 1;
    s.connect(bp); bp.connect(g);
    if (pan) { g.connect(pan); pan.connect(master); } else { g.connect(master); }
    s.start(t);
    // syllable-like amplitude wobble
    const dur = 0.6 + rnd() * 1.0;
    let tt = t;
    while (tt < t + dur) {
      const seg = 0.08 + rnd() * 0.09;
      g.gain.linearRampToValueAtTime(0.05 * intensity + rnd() * 0.06 * intensity, tt + seg * 0.5);
      g.gain.linearRampToValueAtTime(0.006, tt + seg);
      tt += seg;
    }
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.1);
    s.stop(t + dur + 0.15);
    // sweep the formant for a "word" shape
    bp.frequency.linearRampToValueAtTime(500 + rnd() * 1600, t + dur);
  }

  // ---- Spirit box: chopped noise + swept bandpass, gated on/off ----
  let sbNoise, sbGate, sbFilter, sbInterval, sbActive = false;
  function spiritStart() {
    if (!started || sbActive) return;
    sbActive = true;
    sbNoise = noiseSource();
    sbFilter = ctx.createBiquadFilter();
    sbFilter.type = 'bandpass';
    sbFilter.frequency.value = 1400;
    sbFilter.Q.value = 3;
    sbGate = ctx.createGain();
    sbGate.gain.value = 0.0;
    sbNoise.connect(sbFilter); sbFilter.connect(sbGate); sbGate.connect(master);
    sbNoise.start();
    // scanning chop ~ 6-9 Hz
    sbInterval = setInterval(() => {
      const t = now();
      sbFilter.frequency.setValueAtTime(500 + rnd() * 3200, t);
      sbGate.gain.cancelScheduledValues(t);
      sbGate.gain.setValueAtTime(rnd() > 0.35 ? 0.10 : 0.0, t);
      sbGate.gain.setTargetAtTime(0.0, t + 0.03, 0.03);
    }, 120);
  }
  function spiritStop() {
    if (!sbActive) return;
    sbActive = false;
    clearInterval(sbInterval);
    const t = now();
    if (sbGate) sbGate.gain.setTargetAtTime(0.0, t, 0.05);
    if (sbNoise) sbNoise.stop(t + 0.3);
    sbNoise = null;
  }
  // A spoken "word" through the box: two formant tones + noise, choppy.
  function spiritWord() {
    if (!started) return;
    const t = now();
    const formants = [
      [720, 1240], [530, 1840], [660, 1720], [400, 900], [600, 2400]
    ];
    const f = formants[Math.floor(rnd() * formants.length)];
    const dur = 0.35 + rnd() * 0.35;
    [f[0], f[1]].forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 12;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(bp); bp.connect(g); g.connect(master);
      o.start(t);
      // choppy gate to sound radio-broken
      let tt = t;
      while (tt < t + dur) {
        const seg = 0.05 + rnd() * 0.05;
        g.gain.setValueAtTime(rnd() > 0.3 ? (0.06 - i * 0.02) : 0.0, tt);
        tt += seg;
      }
      g.gain.setTargetAtTime(0.0, t + dur, 0.02);
      o.stop(t + dur + 0.05);
    });
  }

  // ---- EMF beeps: 1..5 severity ----
  function emf(level) {
    if (!started || level <= 0) return;
    const t = now();
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 700 + level * 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.04, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.07);
  }

  // ---- One-shot SFX ----
  function footstep(vol = 0.05) {
    if (!started) return;
    const t = now();
    const s = noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(lp); lp.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.1);
  }

  function creak() {
    if (!started) return;
    const t = now();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120 + rnd() * 60, t);
    o.frequency.linearRampToValueAtTime(60 + rnd() * 40, t + 0.9);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(bp); bp.connect(g); g.connect(master);
    o.start(t); o.stop(t + 1.05);
  }

  function pickup() {
    if (!started) return;
    const t = now();
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.22);
  }

  // ---- Jump-scare stinger: dissonant cluster + noise slam ----
  function stinger(big = false) {
    if (!started) return;
    const t = now();
    // noise slam
    const s = noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(big ? 0.6 : 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 1.4 : 0.7));
    s.connect(hp); hp.connect(g); g.connect(master);
    s.start(t); s.stop(t + (big ? 1.5 : 0.8));
    // dissonant strings cluster
    const freqs = big ? [110, 116.5, 220, 233, 466, 494] : [220, 233, 466];
    freqs.forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(big ? 0.08 : 0.05, t + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 1.6 : 0.8));
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2500;
      o.connect(lp); lp.connect(og); og.connect(master);
      o.start(t); o.stop(t + (big ? 1.7 : 0.9));
    });
  }

  // low sub "presence" swell — when an entity gets close
  function dread() {
    if (!started) return;
    const t = now();
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 28;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 2.5);
  }

  function chase(on) {
    // rising panic pulse handled by fear/heart; add a shrill when on
    if (!started || !on) return;
    const t = now();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.42);
  }

  // ---- NEW: environmental horror sounds ----------------------------------

  // Electrical zap of a failing fluorescent tube.
  function buzz(vol = 0.05) {
    if (!started) return;
    const t = now();
    const s = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3200 + rnd() * 2000; bp.Q.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + rnd() * 0.06);
    s.connect(bp); bp.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.14);
    // 60Hz hum under it
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
    const og = ctx.createGain(); og.gain.setValueAtTime(vol * 0.4, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    o.connect(lp); lp.connect(og); og.connect(master); o.start(t); o.stop(t + 0.12);
  }

  // Distant wail — far-off, reverberant, human but wrong.
  function scream(dist = 1) {
    if (!started) return;
    const t = now();
    const vol = 0.06 / Math.max(1, dist);
    [220, 223].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 1.4, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 1.6);
      // vibrato
      const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
      const lfg = ctx.createGain(); lfg.gain.value = 8;
      lfo.connect(lfg); lfg.connect(o.frequency); lfo.start(t); lfo.stop(t + 1.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
      o.connect(lp); lp.connect(g); g.connect(master);
      o.start(t); o.stop(t + 1.8);
    });
  }

  // Long metallic scrape — a gurney or drawer dragged across tile.
  function drag() {
    if (!started) return;
    const t = now();
    const s = noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, t); bp.frequency.linearRampToValueAtTime(1800, t + 1.4); bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.2);
    g.gain.linearRampToValueAtTime(0.02, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    s.connect(bp); bp.connect(g); g.connect(master);
    s.start(t); s.stop(t + 1.7);
  }

  // A child's giggle — a few pitched blips.
  function laugh() {
    if (!started) return;
    const t = now();
    const notes = [0, 0.12, 0.24, 0.34, 0.46];
    notes.forEach((dt, i) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = 620 + (i % 2 ? 90 : -60) + rnd() * 40;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.04, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.1);
      o.connect(g); g.connect(master); o.start(t + dt); o.stop(t + dt + 0.12);
    });
  }

  // Slow water drip.
  function drip() {
    if (!started) return;
    const t = now();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
  }

  // Heavy door slam.
  function slam() {
    if (!started) return;
    const t = now();
    const s = noiseSource();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    s.connect(lp); lp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.32);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.2);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.4, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.3);
  }

  // ---- NEW: children / nursery horror -----------------------------------

  // Infant cry — thin, piercing, wailing up and down.
  function babyCry(dist = 1) {
    if (!started) return;
    const t = now();
    const vol = 0.07 / Math.max(1, dist);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(920, t + 0.3);
    o.frequency.linearRampToValueAtTime(600, t + 0.6);
    o.frequency.linearRampToValueAtTime(980, t + 0.95);
    o.frequency.linearRampToValueAtTime(420, t + 1.5);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 13;
    const lg = ctx.createGain(); lg.gain.value = 24; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + 1.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.1);
    g.gain.setValueAtTime(vol, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(bp); bp.connect(g); g.connect(master); o.start(t); o.stop(t + 1.6);
  }

  // A single music-box bell note (inharmonic partials).
  function bellNote(freq, t, vol) {
    [[1, vol], [2.76, vol * 0.3], [5.4, vol * 0.1]].forEach(([m, v]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.35);
    });
  }
  // A slow, slightly-detuned lullaby that drags at the end.
  function musicBox(speed = 1) {
    if (!started) return;
    const t0 = now();
    const base = 523.25; // C5
    const mel = [0, 4, 7, 4, 0, 4, 7, 9, 7, 4, 2, 0];
    let tt = t0;
    mel.forEach((st, i) => {
      const detune = 1 + Math.sin(i * 1.7) * 0.005;      // out of tune
      const slow = i > 8 ? 1.03 : 1;                       // pitch sags at the end
      const freq = base * Math.pow(2, st / 12) * detune / slow;
      bellNote(freq, tt, 0.05);
      tt += (0.36 / speed) + (i > 8 ? 0.06 * (i - 8) : 0); // tempo drags
    });
  }

  // A child humming a wandering tune.
  function humming() {
    if (!started) return;
    const t0 = now(); const notes = [0, 2, 3, 2, 0, -2, 0]; const base = 330;
    let tt = t0;
    notes.forEach((st) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base * Math.pow(2, st / 12);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5;
      const lg = ctx.createGain(); lg.gain.value = 4; lfo.connect(lg); lg.connect(o.frequency); lfo.start(tt); lfo.stop(tt + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.04, tt + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.46);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
      o.connect(lp); lp.connect(g); g.connect(master); o.start(tt); o.stop(tt + 0.5);
      tt += 0.42;
    });
  }

  // Baby rattle — quick shakes.
  function rattle() {
    if (!started) return;
    const t = now();
    for (let i = 0; i < 5; i++) {
      const tt = t + i * 0.08;
      const s = noiseSource();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.04, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.05);
      s.connect(bp); bp.connect(g); g.connect(master); s.start(tt); s.stop(tt + 0.06);
    }
  }

  // ---- NEW: positional (surround) sounds for the kids behind the walls ----

  // returns an input gain node wired through a stereo panner to master
  function panOut(pan) {
    const g = ctx.createGain();
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p); p.connect(master);
    } else { g.connect(master); }
    return g;
  }

  // A single footstep heard from a direction (pan -1..1) at a volume.
  function footstepPan(pan, vol) {
    if (!started) return;
    const t = now();
    const s = noiseSource();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 210;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.001, vol || 0.05), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(lp); lp.connect(g); g.connect(panOut(pan));
    s.start(t); s.stop(t + 0.1);
    // little scuff of a small foot
    const s2 = noiseSource();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime((vol || 0.05) * 0.5, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s2.connect(hp); hp.connect(g2); g2.connect(panOut(pan)); s2.start(t); s2.stop(t + 0.06);
  }

  // A child's giggle from a direction.
  function laughPan(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan);
    const notes = [0, 0.11, 0.22, 0.32, 0.44];
    notes.forEach((dt, i) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = 640 + (i % 2 ? 90 : -60) + rnd() * 40;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol || 0.04), t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.1);
      o.connect(g); g.connect(out); o.start(t + dt); o.stop(t + dt + 0.12);
    });
  }

  // ---- NEW: chains, falling debris, bodies ------------------------------

  // Chain links dragged over concrete, from a direction. vol 0..1.
  function chains(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan || 0);
    const v = Math.max(0.01, Math.min(1, vol == null ? 0.5 : vol));
    // drag bed
    const s = noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, t); bp.frequency.linearRampToValueAtTime(1100, t + 0.9); bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 * v, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    s.connect(bp); bp.connect(g); g.connect(out); s.start(t); s.stop(t + 1.2);
    // link clinks
    let tt = t + 0.05;
    for (let i = 0; i < 5 + Math.floor(rnd() * 3); i++) {
      const f = 2400 + rnd() * 2400;
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = f; hp.Q.value = 14;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, tt);
      og.gain.exponentialRampToValueAtTime(0.05 * v, tt + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, tt + 0.09);
      o.connect(hp); hp.connect(og); og.connect(out);
      o.start(tt); o.stop(tt + 0.1);
      tt += 0.08 + rnd() * 0.16;
    }
  }

  // Heavy crash — a ceiling panel or light fixture hitting the floor.
  function crash() {
    if (!started) return;
    const t = now();
    const s = noiseSource();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(lp); lp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.55);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.42);
    // settling clatter
    let tt = t + 0.25;
    for (let i = 0; i < 4; i++) {
      const s2 = noiseSource();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500 + rnd() * 1500; bp.Q.value = 6;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.12 / (i + 1), tt);
      g2.gain.exponentialRampToValueAtTime(0.0001, tt + 0.12);
      s2.connect(bp); bp.connect(g2); g2.connect(master); s2.start(tt); s2.stop(tt + 0.13);
      tt += 0.09 + rnd() * 0.12;
    }
  }

  // A body-weight thud, then a slowing roll.
  function thud() {
    if (!started) return;
    const t = now();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.22);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.36);
    // roll bumps, slowing
    let tt = t + 0.3, gap = 0.22;
    for (let i = 0; i < 5; i++) {
      const o2 = ctx.createOscillator(); o2.type = 'sine';
      o2.frequency.setValueAtTime(70 - i * 6, tt); o2.frequency.exponentialRampToValueAtTime(30, tt + 0.1);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.22 / (i * 0.6 + 1), tt);
      g2.gain.exponentialRampToValueAtTime(0.0001, tt + 0.14);
      o2.connect(g2); g2.connect(master); o2.start(tt); o2.stop(tt + 0.16);
      tt += gap; gap *= 1.35;
    }
  }

  // Outdoor wind gust — a slow filtered-noise swell.
  function gust(vol) {
    if (!started) return;
    const t = now();
    const s = noiseSource();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(240, t);
    lp.frequency.linearRampToValueAtTime(700, t + 1.6);
    lp.frequency.linearRampToValueAtTime(200, t + 3.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol || 0.16, t + 1.4);
    g.gain.linearRampToValueAtTime(0.0001, t + 3.6);
    s.connect(lp); lp.connect(g); g.connect(master);
    s.start(t); s.stop(t + 3.7);
  }

  // ---- the voices of the dead — every one directional (pan -1..1) ---------

  // Low guttural growl — Mose. Slow saw with a wobble, heavily lowpassed.
  function growlPan(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan); const v = vol || 0.1;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(78, t);
    o.frequency.linearRampToValueAtTime(58, t + 1.1);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 11;
    const lg = ctx.createGain(); lg.gain.value = 14;
    lfo.connect(lg); lg.connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o.stop(t + 1.35); lfo.start(t); lfo.stop(t + 1.35);
  }

  // A dead man's moan — the Risen. Sine gliding down with a shiver.
  function moanPan(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan); const v = vol || 0.08;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(196, t);
    o.frequency.linearRampToValueAtTime(122, t + 1.6);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6.5;
    const lg = ctx.createGain(); lg.gain.value = 7; lfo.connect(lg); lg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.4);
    g.gain.linearRampToValueAtTime(v * 0.6, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.85);
  }

  // Wet hiss — the Crawler / a beam-struck spirit. Highpassed noise swell.
  function hissPan(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan); const v = vol || 0.08;
    const s = noiseSource();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    s.connect(hp); hp.connect(g); g.connect(out); s.start(t); s.stop(t + 0.75);
  }

  // Slow ragged breathing right beside you. Two bandpassed noise breaths.
  function breathPan(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan); const v = vol || 0.05;
    [0, 1.05].forEach((dt) => {
      const s = noiseSource();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 460 + rnd() * 120; bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.linearRampToValueAtTime(v, t + dt + 0.32);
      g.gain.linearRampToValueAtTime(0.0001, t + dt + 0.85);
      s.connect(bp); bp.connect(g); g.connect(out); s.start(t + dt); s.stop(t + dt + 0.9);
    });
  }

  // The hunt-scream: a rising shriek + noise burst from a direction. The jump scare.
  function screechPan(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan); const v = vol == null ? 0.3 : vol;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(1650, t + 0.28);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.62);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    o.connect(bp); bp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.8);
    const s = noiseSource();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(v * 0.6, t + 0.04);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(hp); hp.connect(g2); g2.connect(out); s.start(t); s.stop(t + 0.55);
  }

  // A nurse humming her round, from a direction — same tune as the ward.
  function humPan(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan); const v = vol || 0.035;
    const notes = [392, 440, 392, 330, 294, 330, 392];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); const st = t + i * 0.42;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(v, st + 0.1);
      g.gain.linearRampToValueAtTime(0.0001, st + 0.4);
      o.connect(g); g.connect(out); o.start(st); o.stop(st + 0.45);
    });
  }

  // Wet gnawing + bone clicks — the Ghoul at its work.
  function gnawPan(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan); const v = vol || 0.06;
    let tt = t;
    for (let i = 0; i < 6; i++) {
      const s = noiseSource();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300 + rnd() * 500; bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(v, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.12);
      s.connect(bp); bp.connect(g); g.connect(out); s.start(tt); s.stop(tt + 0.14);
      if (rnd() < 0.4) { // a bone click
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2000 + rnd() * 1500;
        const og = ctx.createGain(); og.gain.setValueAtTime(v * 0.5, tt + 0.05); og.gain.exponentialRampToValueAtTime(0.0001, tt + 0.1);
        o.connect(og); og.connect(out); o.start(tt + 0.05); o.stop(tt + 0.11);
      }
      tt += 0.16 + rnd() * 0.2;
    }
  }

  // Ember crackle — the Ash passing. Sparse hot pops.
  function cracklePan(pan, vol) {
    if (!started) return;
    const t = now(); const out = panOut(pan); const v = vol || 0.05;
    let tt = t;
    for (let i = 0; i < 8; i++) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1400 + rnd() * 2600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(v * (0.4 + rnd() * 0.6), tt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.05);
      o.connect(g); g.connect(out); o.start(tt); o.stop(tt + 0.06);
      tt += 0.06 + rnd() * 0.22;
    }
  }

  // The ward: raising the cross rings a bright, holy chord that drives the dead back.
  function wardChime(vol) {
    if (!started) return;
    const t = now(); const v = vol || 0.06;
    // a shimmering major chord (a chapel bell + choir)
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i < 2 ? 'triangle' : 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); const st = t + i * 0.02;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(v * (1 - i * 0.15), st + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 1.1);
      o.connect(g); g.connect(master); o.start(st); o.stop(st + 1.2);
    });
    // a soft high shimmer on top
    const s = noiseSource();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(v * 0.3, t + 0.05); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    s.connect(hp); hp.connect(g2); g2.connect(master); s.start(t); s.stop(t + 0.65);
  }

  // A payphone ringing in an empty building: two-tone electric bell, far too cheerful.
  function phoneRing(vol) {
    if (!started) return;
    const t = now(); const v = vol || 0.08;
    // one ring = two 1s bursts of a warbling bell
    for (let burst = 0; burst < 2; burst++) {
      const bt = t + burst * 2.0;
      [1180, 1520].forEach((f) => {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const trem = ctx.createOscillator(); trem.type = 'square'; trem.frequency.value = 20;   // the bell clapper
        const tg = ctx.createGain(); tg.gain.value = 0.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, bt);
        g.gain.linearRampToValueAtTime(v * 0.5, bt + 0.03);
        g.gain.setValueAtTime(v * 0.5, bt + 0.95);
        g.gain.exponentialRampToValueAtTime(0.0001, bt + 1.1);
        trem.connect(tg.gain);
        o.connect(tg); tg.connect(g); g.connect(master);
        o.start(bt); o.stop(bt + 1.15); trem.start(bt); trem.stop(bt + 1.15);
      });
    }
  }

  // The crowbar: a fast air-cutting whoosh when swung.
  function swish(vol) {
    if (!started) return;
    const t = now(); const v = vol || 0.1;
    const s = noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.26);
  }

  // ---- glass: a mirror letting go. Burst of bright noise + ringing shard partials ----
  function glassCore(out, vol, t) {
    const s = noiseSource();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    s.connect(hp); hp.connect(g); g.connect(out); s.start(t); s.stop(t + 0.4);
    // shard pings — many fast, high, detuned rings dying at different rates
    for (let i = 0; i < 9; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = 1800 + rnd() * 4200;
      const og = ctx.createGain();
      const dt0 = rnd() * 0.12;
      og.gain.setValueAtTime(0.0001, t + dt0);
      og.gain.exponentialRampToValueAtTime(vol * (0.25 + rnd() * 0.3), t + dt0 + 0.008);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dt0 + 0.15 + rnd() * 0.4);
      o.connect(og); og.connect(out); o.start(t + dt0); o.stop(t + dt0 + 0.6);
    }
    // settling tinkles
    let tt = t + 0.3;
    for (let i = 0; i < 5; i++) {
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 2400 + rnd() * 3000;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(vol * 0.12 / (i + 1), tt);
      g2.gain.exponentialRampToValueAtTime(0.0001, tt + 0.1);
      o2.connect(g2); g2.connect(out); o2.start(tt); o2.stop(tt + 0.12);
      tt += 0.06 + rnd() * 0.1;
    }
  }
  function glassShatter(vol) { if (!started) return; glassCore(master, vol == null ? 0.5 : vol, now()); }
  function glassShatterPan(pan, vol) { if (!started) return; glassCore(panOut(pan), vol == null ? 0.12 : vol, now()); }

  // ---- the basement generator ----
  function generatorCrank(vol) {   // one hard pull: flywheel chug + belt squeal
    if (!started) return;
    const t = now(), v = vol == null ? 0.3 : vol;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(28, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + 0.6);
    const s = noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 3;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(v * 0.5, t + 0.05); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    s.connect(bp); bp.connect(g2); g2.connect(master); s.start(t); s.stop(t + 0.45);
  }
  function generatorStart() {   // sputter… sputter… ROAR, settling into the hum
    if (!started) return;
    const t = now();
    [0, 0.35, 0.62].forEach((dt0, i) => {
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(30 + i * 8, t + dt0);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.22, t + dt0); g.gain.exponentialRampToValueAtTime(0.0001, t + dt0 + 0.22);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      o.connect(lp); lp.connect(g); g.connect(master); o.start(t + dt0); o.stop(t + dt0 + 0.25);
    });
    const s = noiseSource();
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 500;
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.0001, t + 0.9); g3.gain.exponentialRampToValueAtTime(0.5, t + 1.05);
    g3.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    s.connect(lp2); lp2.connect(g3); g3.connect(master); s.start(t + 0.9); s.stop(t + 2.3);
  }
  let genHum = null;
  function genHumStart() {   // the powered floors carry a low diesel-and-mains drone
    if (!started || genHum) return;
    const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(master);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    o1.connect(lp); lp.connect(g);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 110;
    const g2 = ctx.createGain(); g2.gain.value = 0.3; o2.connect(g2); g2.connect(g);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6.5;
    const lg = ctx.createGain(); lg.gain.value = 0.008;
    lfo.connect(lg); lg.connect(g.gain);
    o1.start(); o2.start(); lfo.start();
    g.gain.exponentialRampToValueAtTime(0.05, now() + 1.2);
    genHum = { g, stopAll: () => { try { o1.stop(); o2.stop(); lfo.stop(); } catch (e) { } } };
  }
  function genHumStop() {
    if (!genHum) return;
    const h = genHum; genHum = null;
    try { h.g.gain.exponentialRampToValueAtTime(0.0001, now() + 0.6); } catch (e) { }
    setTimeout(() => { h.stopAll(); try { h.g.disconnect(); } catch (e) { } }, 800);
  }

  function setMasterVolume(v) { if (master) master.gain.value = v; }
  function suspend() { if (ctx) ctx.suspend(); }
  function resume() { if (ctx) ctx.resume(); }
  function isStarted() { return started; }

  return {
    init, startAmbient, setFear, tickHeart, whisper,
    spiritStart, spiritStop, spiritWord, emf, footstep, creak,
    pickup, stinger, dread, chase, setMasterVolume, suspend, resume, isStarted,
    buzz, scream, drag, laugh, drip, slam,
    babyCry, musicBox, humming, rattle,
    footstepPan, laughPan, chains, crash, thud, gust,
    growlPan, moanPan, hissPan, breathPan, screechPan, humPan, gnawPan, cracklePan, wardChime, swish, phoneRing,
    glassShatter, glassShatterPan, generatorCrank, generatorStart, genHumStart, genHumStop,
  };
})();
if (typeof window !== 'undefined') window.Audio2 = Audio2;
