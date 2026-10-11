'use strict';
// ---------------------------------------------------------------------------
// Procedural audio: every sound is synthesised with the Web Audio API, so the
// game ships without audio files. Sounds favour low, percussive, tactile
// layers (thumps, filtered noise, inharmonic bells) over retro beeps.
// ---------------------------------------------------------------------------

const Sfx = (() => {
  let ctx = null, master, sfxBus, musicBus, warnBus, comp, noiseBuf, revIn;
  const vol = { master: 0.8, music: 0.6, sfx: 0.85 };
  const lastPlayed = Object.create(null);
  let voices = 0;
  const MAX_VOICES = 56;

  function makeImpulse(seconds, decay) {
    const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    master = ctx.createGain(); master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    warnBus = ctx.createGain(); warnBus.connect(master);
    const conv = ctx.createConvolver(); conv.buffer = makeImpulse(3.2, 2.6);
    revIn = ctx.createGain(); revIn.gain.value = 0.55;
    revIn.connect(conv); conv.connect(master);
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
  }

  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(vol.master, t, 0.03);
    sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.03);
    warnBus.gain.setTargetAtTime(Math.max(vol.sfx, 0.0001) * 1.1, t, 0.03);
    musicBus.gain.setTargetAtTime(vol.music * 0.7, t, 0.03);
  }

  function setVolumes(m, mu, s) { vol.master = m; vol.music = mu; vol.sfx = s; applyVolumes(); }

  const ready = () => ctx && ctx.state === 'running';
  const can = (name, interval) => {
    const now = performance.now();
    if (lastPlayed[name] && now - lastPlayed[name] < interval * 1000) return false;
    lastPlayed[name] = now;
    return true;
  };

  function track(src, nodes) {
    voices++;
    src.onended = () => { voices--; for (const n of nodes) n.disconnect(); };
  }

  // Oscillator voice with pitch glide, envelope and optional filter sweep.
  function tone(o) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const dur = o.dur;
    const os = ctx.createOscillator();
    os.type = o.type || 'sine';
    os.frequency.setValueAtTime(Math.max(1, o.f), t0);
    if (o.f1) os.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + (o.glide || dur));
    if (o.detune) os.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.a || 0.004;
    const peak = Math.max(0.0002, o.vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    if (o.hold) g.gain.setValueAtTime(peak, t0 + a + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = os;
    const nodes = [os, g];
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter; f.Q.value = o.q || 0.7;
      f.frequency.setValueAtTime(o.ff, t0);
      if (o.ff1) f.frequency.exponentialRampToValueAtTime(o.ff1, t0 + dur);
      node.connect(f); node = f; nodes.push(f);
    }
    node.connect(g);
    g.connect(o.bus || sfxBus);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(revIn); nodes.push(s); }
    os.start(t0); os.stop(t0 + dur + 0.05);
    track(os, nodes);
  }

  // Filtered noise burst: whooshes, impacts, crackle.
  function noise(o) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const dur = o.dur;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass'; f.Q.value = o.q || 0.8;
    f.frequency.setValueAtTime(o.ff || 2000, t0);
    if (o.ff1) f.frequency.exponentialRampToValueAtTime(o.ff1, t0 + dur);
    const g = ctx.createGain();
    const a = o.a || 0.003;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    const nodes = [src, f, g];
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(revIn); nodes.push(s); }
    const off = Math.random() * 1.5;
    src.start(t0, off, dur + 0.05);
    track(src, nodes);
  }

  // Inharmonic additive bell: the voice of the game's central mechanic.
  const BELL_PARTIALS = [
    [0.5, 0.55, 1.0], [1, 1, 0.85], [1.183, 0.55, 0.6], [1.506, 0.45, 0.5], [2, 0.42, 0.42],
    [2.514, 0.26, 0.33], [2.662, 0.2, 0.3], [3.011, 0.18, 0.24], [4.166, 0.11, 0.17], [5.433, 0.07, 0.12],
  ];
  function bell(f, dur, v, bus, rev, delay = 0, partials = BELL_PARTIALS.length) {
    for (let i = 0; i < partials; i++) {
      const p = BELL_PARTIALS[i];
      tone({ type: 'sine', f: f * p[0] * (1 + (Math.random() - 0.5) * 0.003), dur: dur * p[2], vol: v * p[1], a: 0.002, bus, rev, delay });
    }
    noise({ filter: 'bandpass', ff: f * 6, q: 2, dur: 0.06, vol: v * 0.35, bus, delay });
  }

  const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
  let xpCombo = 0, xpComboT = 0;

  const sounds = {
    dagger() {
      if (!can('dagger', 0.045)) return;
      const p = rand(0.9, 1.15);
      noise({ filter: 'bandpass', ff: 3200 * p, ff1: 900, q: 1.4, dur: 0.09, vol: 0.09 });
      tone({ type: 'triangle', f: 1100 * p, f1: 500, dur: 0.05, vol: 0.025 });
    },
    hit() {
      if (!can('hit', 0.028)) return;
      tone({ type: 'sine', f: rand(160, 200), f1: 60, dur: 0.08, vol: 0.16 });
      noise({ filter: 'lowpass', ff: 2200, dur: 0.035, vol: 0.06 });
    },
    hitHeavy() {
      if (!can('hitHeavy', 0.08)) return;
      tone({ type: 'sine', f: 120, f1: 38, dur: 0.22, vol: 0.4 });
      noise({ filter: 'lowpass', ff: 1200, ff1: 200, dur: 0.18, vol: 0.28 });
    },
    kill() {
      if (!can('kill', 0.03)) return;
      noise({ filter: 'bandpass', ff: rand(700, 1100), q: 1.1, dur: 0.1, vol: 0.09 });
      tone({ type: 'square', f: rand(200, 260), f1: 70, dur: 0.07, vol: 0.025, filter: 'lowpass', ff: 900 });
    },
    scythe() {
      if (!can('scythe', 0.08)) return;
      noise({ filter: 'bandpass', ff: 500, ff1: 2600, q: 1.6, dur: 0.24, vol: 0.13, a: 0.03 });
      tone({ type: 'sine', f: 320, f1: 140, dur: 0.2, vol: 0.05 });
    },
    orb() {
      if (!can('orb', 0.09)) return;
      tone({ type: 'sine', f: pick([784, 880, 988, 1175]), dur: 0.16, vol: 0.035, rev: 0.2 });
    },
    grave() {
      if (!can('grave', 0.1)) return;
      noise({ filter: 'lowpass', ff: 500, ff1: 120, dur: 0.3, vol: 0.2, a: 0.02 });
      tone({ type: 'sine', f: 95, f1: 42, dur: 0.32, vol: 0.32 });
    },
    graveHit() {
      if (!can('graveHit', 0.06)) return;
      noise({ filter: 'bandpass', ff: 420, q: 1.2, dur: 0.14, vol: 0.22 });
      tone({ type: 'triangle', f: 140, f1: 60, dur: 0.12, vol: 0.12 });
    },
    zap() {
      if (!can('zap', 0.06)) return;
      noise({ filter: 'highpass', ff: 2600, dur: 0.16, vol: 0.1 });
      noise({ filter: 'bandpass', ff: 5200, q: 3, dur: 0.05, vol: 0.08, delay: 0.04 });
      tone({ type: 'sawtooth', f: 1400, f1: 180, dur: 0.1, vol: 0.035, filter: 'lowpass', ff: 3000 });
    },
    sigilArm() {
      if (!can('sigilArm', 0.12)) return;
      tone({ type: 'sine', f: 110, f1: 165, dur: 0.5, vol: 0.05, a: 0.1 });
    },
    sigilBoom() {
      if (!can('sigilBoom', 0.07)) return;
      tone({ type: 'sine', f: 82, f1: 30, dur: 0.38, vol: 0.32 });
      noise({ filter: 'lowpass', ff: 1600, ff1: 160, dur: 0.36, vol: 0.24 });
    },
    explode() {
      if (!can('explode', 0.06)) return;
      tone({ type: 'sine', f: 100, f1: 34, dur: 0.3, vol: 0.25 });
      noise({ filter: 'lowpass', ff: 2000, ff1: 200, dur: 0.28, vol: 0.18 });
    },
    xp() {
      if (!can('xp', 0.022)) return;
      const now = performance.now();
      if (now - xpComboT > 900) xpCombo = 0;
      xpComboT = now;
      const semi = PENTA[Math.min(PENTA.length - 1, (xpCombo++ / 3) | 0)];
      const f = 523 * Math.pow(2, semi / 12);
      tone({ type: 'sine', f, dur: 0.09, vol: 0.04 });
      tone({ type: 'triangle', f: f * 2, dur: 0.05, vol: 0.012 });
    },
    echo() {
      if (!can('echo', 0.05)) return;
      tone({ type: 'sine', f: 1046, dur: 0.5, vol: 0.05, rev: 0.4 });
      tone({ type: 'sine', f: 1568, dur: 0.4, vol: 0.03, rev: 0.4, delay: 0.03 });
      noise({ filter: 'highpass', ff: 6000, dur: 0.25, vol: 0.02 });
    },
    heal() {
      tone({ type: 'triangle', f: 392, dur: 0.5, vol: 0.06, rev: 0.3 });
      tone({ type: 'triangle', f: 494, dur: 0.5, vol: 0.05, rev: 0.3, delay: 0.06 });
      tone({ type: 'triangle', f: 587, dur: 0.6, vol: 0.05, rev: 0.3, delay: 0.12 });
    },
    levelup() {
      const notes = [0, 3, 7, 12, 15];
      notes.forEach((s, i) => bell(392 * Math.pow(2, s / 12), 0.9, 0.06, sfxBus, 0.5, i * 0.06, 5));
    },
    cardIn() {
      noise({ filter: 'bandpass', ff: 900, ff1: 2200, q: 1.2, dur: 0.16, vol: 0.05, a: 0.03 });
    },
    hover() {
      if (!can('hover', 0.04)) return;
      noise({ filter: 'bandpass', ff: 2400, q: 3, dur: 0.025, vol: 0.05 });
      tone({ type: 'triangle', f: 660, dur: 0.04, vol: 0.015 });
    },
    select() {
      bell(523, 1.3, 0.08, sfxBus, 0.6, 0, 6);
      noise({ filter: 'bandpass', ff: 600, ff1: 3000, q: 1, dur: 0.25, vol: 0.06, a: 0.04 });
    },
    deny() {
      if (!can('deny', 0.2)) return;
      tone({ type: 'square', f: 110, dur: 0.12, vol: 0.05, filter: 'lowpass', ff: 600 });
      tone({ type: 'square', f: 92, dur: 0.14, vol: 0.05, filter: 'lowpass', ff: 600, delay: 0.08 });
    },
    bell() {
      bell(98, 4.2, 0.24, warnBus, 0.9);
      tone({ type: 'sine', f: 55, f1: 40, dur: 1.6, vol: 0.4, bus: warnBus });
      noise({ filter: 'lowpass', ff: 3000, ff1: 300, dur: 0.6, vol: 0.18, bus: warnBus });
    },
    bellEcho() {
      bell(131, 2.4, 0.11, sfxBus, 0.8);
    },
    bellReady() {
      bell(784, 1.6, 0.06, warnBus, 0.6, 0, 6);
      bell(1175, 1.4, 0.04, warnBus, 0.6, 0.12, 6);
    },
    hurt() {
      if (!can('hurt', 0.1)) return;
      tone({ type: 'sawtooth', f: 150, f1: 55, dur: 0.18, vol: 0.13, filter: 'lowpass', ff: 700, bus: warnBus });
      noise({ filter: 'lowpass', ff: 900, dur: 0.12, vol: 0.18, bus: warnBus });
    },
    dash() {
      noise({ filter: 'bandpass', ff: 700, ff1: 2400, q: 1.1, dur: 0.18, vol: 0.12, a: 0.01 });
      tone({ type: 'sine', f: 220, f1: 440, dur: 0.12, vol: 0.03 });
    },
    telegraph() {
      if (!can('telegraph', 0.25)) return;
      tone({ type: 'sine', f: 280, f1: 760, dur: 0.55, vol: 0.06, a: 0.2, bus: warnBus });
      tone({ type: 'triangle', f: 140, f1: 380, dur: 0.55, vol: 0.04, a: 0.2, bus: warnBus });
    },
    enemyShot() {
      if (!can('enemyShot', 0.08)) return;
      tone({ type: 'square', f: 330, f1: 140, dur: 0.12, vol: 0.035, filter: 'lowpass', ff: 1200 });
    },
    charge() {
      if (!can('charge', 0.15)) return;
      noise({ filter: 'lowpass', ff: 300, ff1: 1400, dur: 0.35, vol: 0.14, a: 0.05 });
      tone({ type: 'sawtooth', f: 70, f1: 140, dur: 0.3, vol: 0.06, filter: 'lowpass', ff: 500 });
    },
    elite() {
      tone({ type: 'sawtooth', f: 55, dur: 1.6, vol: 0.16, a: 0.25, filter: 'lowpass', ff: 260, ff1: 520, bus: warnBus, rev: 0.5 });
      tone({ type: 'sawtooth', f: 55.6, dur: 1.6, vol: 0.14, a: 0.25, filter: 'lowpass', ff: 260, ff1: 520, bus: warnBus });
      tone({ type: 'sawtooth', f: 82.4, dur: 1.4, vol: 0.08, a: 0.3, filter: 'lowpass', ff: 300, bus: warnBus, delay: 0.25 });
    },
    eliteDie() {
      bell(196, 2.2, 0.12, sfxBus, 0.7);
      tone({ type: 'sine', f: 80, f1: 30, dur: 0.6, vol: 0.4 });
      noise({ filter: 'lowpass', ff: 2400, ff1: 200, dur: 0.6, vol: 0.25 });
    },
    chest() {
      [0, 4, 7, 11, 14].forEach((s, i) => tone({ type: 'triangle', f: 659 * Math.pow(2, s / 12), dur: 0.4, vol: 0.05, delay: i * 0.05, rev: 0.4 }));
    },
    evolve() {
      [0, 7, 12, 16, 19, 24].forEach((s, i) => bell(262 * Math.pow(2, s / 12), 2.0, 0.07, sfxBus, 0.8, i * 0.09, 6));
      tone({ type: 'sawtooth', f: 65, dur: 2.2, vol: 0.08, a: 0.4, filter: 'lowpass', ff: 300, ff1: 1600 });
    },
    nova() {
      noise({ filter: 'bandpass', ff: 300, ff1: 3000, q: 0.8, dur: 0.4, vol: 0.15, a: 0.05 });
      bell(523, 1.2, 0.06, sfxBus, 0.5, 0.05, 5);
    },
    frenzy() {
      tone({ type: 'sawtooth', f: 110, f1: 220, dur: 0.4, vol: 0.06, filter: 'lowpass', ff: 800, ff1: 2400 });
      bell(330, 1.0, 0.05, sfxBus, 0.5, 0.05, 5);
    },
    heart() {
      tone({ type: 'sine', f: 64, f1: 40, dur: 0.16, vol: 0.28, bus: warnBus });
      tone({ type: 'sine', f: 60, f1: 38, dur: 0.18, vol: 0.2, bus: warnBus, delay: 0.17 });
    },
    bossRoar() {
      tone({ type: 'sawtooth', f: 90, f1: 38, dur: 1.4, vol: 0.18, a: 0.08, filter: 'lowpass', ff: 900, ff1: 200, bus: warnBus, rev: 0.6 });
      tone({ type: 'sawtooth', f: 93, f1: 40, dur: 1.4, vol: 0.14, a: 0.08, filter: 'lowpass', ff: 900, ff1: 200, bus: warnBus });
      noise({ filter: 'bandpass', ff: 500, ff1: 150, q: 0.9, dur: 1.2, vol: 0.18, a: 0.1, bus: warnBus });
    },
    bossToll() {
      bell(65, 4.5, 0.26, warnBus, 1.0);
      tone({ type: 'sawtooth', f: 32.7, dur: 2.2, vol: 0.12, filter: 'lowpass', ff: 200, bus: warnBus });
    },
    bossCharge() {
      noise({ filter: 'lowpass', ff: 200, ff1: 1800, dur: 0.5, vol: 0.22, a: 0.05, bus: warnBus });
      tone({ type: 'sawtooth', f: 50, f1: 100, dur: 0.5, vol: 0.12, filter: 'lowpass', ff: 600, bus: warnBus });
    },
    bossHymn() {
      [0, 3, 7].forEach((s, i) => tone({ type: 'sawtooth', f: 262 * Math.pow(2, s / 12), dur: 0.9, vol: 0.035, a: 0.4, filter: 'bandpass', ff: 900, q: 2, bus: warnBus, rev: 0.7, delay: i * 0.02 }));
    },
    pillar() {
      if (!can('pillar', 0.06)) return;
      noise({ filter: 'bandpass', ff: 300, ff1: 2400, q: 0.8, dur: 0.4, vol: 0.18 });
      tone({ type: 'sine', f: 90, f1: 40, dur: 0.3, vol: 0.2 });
    },
    phase() {
      bell(49, 5, 0.25, warnBus, 1.0);
      tone({ type: 'sawtooth', f: 41, f1: 30, dur: 3, vol: 0.18, a: 0.3, filter: 'lowpass', ff: 400, ff1: 120, bus: warnBus });
      noise({ filter: 'lowpass', ff: 4000, ff1: 100, dur: 2.5, vol: 0.25, bus: warnBus });
    },
    death() {
      bell(73, 5, 0.2, warnBus, 1.0);
      tone({ type: 'sawtooth', f: 110, f1: 27, dur: 2.5, vol: 0.12, filter: 'lowpass', ff: 900, ff1: 80, bus: warnBus });
    },
    victory() {
      [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => bell(294 * Math.pow(2, s / 12), 3, 0.08, warnBus, 0.9, i * 0.14, 7));
    },
    banner() {
      tone({ type: 'sawtooth', f: 73, dur: 1.2, vol: 0.07, a: 0.2, filter: 'lowpass', ff: 300, ff1: 900, rev: 0.6 });
      bell(147, 2.2, 0.06, sfxBus, 0.7, 0.05, 6);
    },
    achievement() {
      bell(880, 1.4, 0.05, sfxBus, 0.6, 0, 6);
      bell(1319, 1.2, 0.04, sfxBus, 0.6, 0.1, 6);
    },
  };

  function play(name) {
    if (!ready()) return;
    if (voices > MAX_VOICES && !['bell', 'hurt', 'telegraph', 'bossToll', 'bossRoar', 'phase', 'death', 'victory', 'levelup'].includes(name)) return;
    const fn = sounds[name];
    if (fn) fn();
  }

  // -------------------------------------------------------------------------
  // Music: a drone bed plus a lookahead step sequencer whose layers are added
  // as the run escalates. The boss swaps to an organ-and-choir arrangement.
  // -------------------------------------------------------------------------
  const Music = {
    mode: 'off', intensity: 0, step: 0, bar: 0, nextTime: 0, timer: null, drone: null,
    root: 73.42,
    chords: {
      calm: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -1, 2]],
      boss: [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 11, 14]],
      victory: [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [7, 11, 14]],
    },
    bpm() {
      if (this.mode === 'boss') return 124;
      if (this.mode === 'victory') return 72;
      return [76, 82, 92, 104, 116][this.intensity] || 82;
    },
    note(semi, oct = 0) { return this.root * Math.pow(2, semi / 12 + oct); },
    start(mode) {
      if (!ctx) return;
      this.mode = mode;
      this.root = mode === 'boss' ? 65.41 : 73.42;
      if (!this.drone) this.makeDrone();
      this.retuneDrone();
      if (!this.timer) {
        this.nextTime = ctx.currentTime + 0.1;
        this.step = 0; this.bar = 0;
        this.timer = setInterval(() => this.schedule(), 30);
      }
    },
    stop() {
      this.mode = 'off';
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.drone) {
        const t = ctx.currentTime;
        this.drone.gain.gain.setTargetAtTime(0.0001, t, 0.6);
        const d = this.drone; this.drone = null;
        setTimeout(() => { d.oscs.forEach(o => { try { o.stop(); } catch (e) { /* already stopped */ } }); d.gain.disconnect(); }, 3000);
      }
    },
    setIntensity(n) { this.intensity = clamp(n, 0, 4); if (this.drone) this.retuneDrone(); },
    makeDrone() {
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 2;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
      const lfoG = ctx.createGain(); lfoG.gain.value = 90;
      lfo.connect(lfoG); lfoG.connect(f.frequency);
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 9;
      const o3 = ctx.createOscillator(); o3.type = 'sine';
      o1.connect(f); o2.connect(f); o3.connect(g); f.connect(g); g.connect(musicBus);
      [o1, o2, o3, lfo].forEach(o => o.start());
      this.drone = { gain: g, filter: f, oscs: [o1, o2, o3, lfo], o1, o2, o3 };
    },
    retuneDrone() {
      const d = this.drone, t = ctx.currentTime;
      const r = this.mode === 'boss' ? 65.41 / 2 : 73.42 / 2;
      d.o1.frequency.setTargetAtTime(r, t, 0.8);
      d.o2.frequency.setTargetAtTime(r * 1.5, t, 0.8);
      d.o3.frequency.setTargetAtTime(r, t, 0.8);
      const cut = this.mode === 'boss' ? 520 : this.mode === 'victory' ? 900 : 200 + this.intensity * 70;
      d.filter.frequency.setTargetAtTime(cut, t, 1.5);
      const lvl = this.mode === 'victory' ? 0.05 : this.mode === 'boss' ? 0.11 : 0.07 + this.intensity * 0.01;
      d.gain.gain.setTargetAtTime(lvl, t, 1.2);
    },
    schedule() {
      if (!ctx || this.mode === 'off') return;
      const spb = 60 / this.bpm() / 4;
      while (this.nextTime < ctx.currentTime + 0.14) {
        this.playStep(this.step, this.nextTime - ctx.currentTime);
        this.nextTime += spb;
        this.step = (this.step + 1) % 16;
        if (this.step === 0) this.bar++;
      }
    },
    playStep(s, delay) {
      const M = musicBus, I = this.intensity, mode = this.mode;
      const chordSet = this.chords[mode === 'boss' ? 'boss' : mode === 'victory' ? 'victory' : 'calm'];
      const barsPerChord = mode === 'boss' ? 1 : 2;
      const chord = chordSet[Math.floor(this.bar / barsPerChord) % chordSet.length];
      if (delay < 0) delay = 0;

      // Pad
      if (s === 0 && this.bar % barsPerChord === 0) {
        const len = 60 / this.bpm() * 4 * barsPerChord;
        if (mode === 'boss') {
          // Cathedral organ: stacked squares and saws, octave-doubled.
          for (const semi of chord) {
            tone({ type: 'square', f: this.note(semi, 1), dur: len, vol: 0.02, a: 0.06, hold: len * 0.7, filter: 'lowpass', ff: 1300, bus: M, rev: 0.6, delay });
            tone({ type: 'sawtooth', f: this.note(semi, 2), dur: len, vol: 0.012, a: 0.06, hold: len * 0.7, filter: 'lowpass', ff: 1800, bus: M, rev: 0.6, delay });
          }
          tone({ type: 'sawtooth', f: this.note(chord[0], 0), dur: len, vol: 0.03, a: 0.05, hold: len * 0.7, filter: 'lowpass', ff: 500, bus: M, delay });
        } else {
          for (const semi of chord) {
            tone({ type: 'triangle', f: this.note(semi, 2), dur: len * 1.1, vol: mode === 'victory' ? 0.03 : 0.018 + I * 0.003, a: len * 0.35, hold: len * 0.3, filter: 'lowpass', ff: 1000, bus: M, rev: 0.7, delay });
          }
        }
      }
      if (mode === 'victory') {
        if (s % 4 === 0 && Math.random() < 0.6) {
          const semi = pick(chord) + 24 + pick([0, 12]);
          bell(this.note(semi, 0), 2.2, 0.025, M, 0.8, delay, 6);
        }
        return;
      }
      if (mode === 'title') {
        if (s === 0 && this.bar % 2 === 0) bell(this.note(pick(chord) + 24, 0), 3, 0.022, M, 0.9, delay, 6);
        return;
      }

      if (mode === 'boss') {
        if (s % 4 === 0) tone({ type: 'sine', f: 110, f1: 40, dur: 0.28, vol: 0.32, bus: M, delay });
        if (s === 4 || s === 12) noise({ filter: 'bandpass', ff: 1700, q: 0.9, dur: 0.16, vol: 0.12, bus: M, delay, rev: 0.3 });
        if (s % 2 === 1) noise({ filter: 'highpass', ff: 7000, dur: 0.03, vol: 0.03, bus: M, delay });
        if (s === 14 || s === 15) tone({ type: 'sine', f: s === 14 ? 160 : 120, f1: 60, dur: 0.2, vol: 0.16, bus: M, delay });
        if (s % 2 === 0) {
          const arp = [0, 3, 7, 12, 7, 3, 10, 7];
          const semi = chord[0] + arp[(s / 2) % arp.length] + 24;
          tone({ type: 'sawtooth', f: this.note(semi, 0), dur: 0.16, vol: 0.022, filter: 'lowpass', ff: 2200, ff1: 700, bus: M, delay });
        }
        if (s === 0 && this.bar % 2 === 0) {
          // Hollow choir: formant-filtered saw swells.
          for (const semi of [chord[0] + 12, chord[2] + 12]) {
            tone({ type: 'sawtooth', f: this.note(semi, 1), dur: 1.8, vol: 0.022, a: 0.6, filter: 'bandpass', ff: 820, q: 3, bus: M, rev: 0.9, delay });
          }
        }
        return;
      }

      // Calm / escalating survival layers
      if (I >= 1 && (s === 0 || s === 8)) tone({ type: 'sine', f: 92, f1: 44, dur: 0.38, vol: 0.2 + I * 0.03, bus: M, delay });
      if (I >= 2) {
        if (s === 6 || s === 14) tone({ type: 'sine', f: 130, f1: 64, dur: 0.24, vol: 0.12, bus: M, delay });
        if (s % 4 === 2) noise({ filter: 'highpass', ff: 6500, dur: 0.035, vol: 0.025, bus: M, delay });
      }
      if (I >= 3) {
        if (s === 4 || s === 12) noise({ filter: 'bandpass', ff: 1500, q: 0.8, dur: 0.14, vol: 0.07, bus: M, delay, rev: 0.25 });
        if (s % 2 === 0) {
          const tones = [chord[0], chord[1], chord[2], chord[1] + 12, chord[2], chord[0] + 12, chord[1], chord[2] + 12];
          const semi = tones[(s / 2) % tones.length] + 24;
          tone({ type: 'triangle', f: this.note(semi, 0), dur: 0.22, vol: 0.022, filter: 'lowpass', ff: 2600, bus: M, rev: 0.3, delay });
        }
      }
      if (I >= 4) {
        if (s % 4 === 0 && s !== 0 && s !== 8) tone({ type: 'sine', f: 100, f1: 44, dur: 0.24, vol: 0.18, bus: M, delay });
        if (s % 2 === 1) noise({ filter: 'highpass', ff: 8000, dur: 0.025, vol: 0.02, bus: M, delay });
        if (this.bar % 4 === 3 && s >= 12) tone({ type: 'sine', f: 180 - (s - 12) * 20, f1: 70, dur: 0.18, vol: 0.13, bus: M, delay });
      }
      if (I === 0 && s === 0 && this.bar % 2 === 1) bell(this.note(pick(chord) + 24, 0), 2.6, 0.02, M, 0.9, delay, 6);
    },
  };

  return {
    init, play, setVolumes, Music,
    get ready() { return ready(); },
    get ctx() { return ctx; },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  };
})();
