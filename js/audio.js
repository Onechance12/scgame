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

  function setMasterVolume(v) { if (master) master.gain.value = v; }
  function suspend() { if (ctx) ctx.suspend(); }
  function resume() { if (ctx) ctx.resume(); }
  function isStarted() { return started; }

  return {
    init, startAmbient, setFear, tickHeart, whisper,
    spiritStart, spiritStop, spiritWord, emf, footstep, creak,
    pickup, stinger, dread, chase, setMasterVolume, suspend, resume, isStarted,
  };
})();
