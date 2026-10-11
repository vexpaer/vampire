'use strict';
// ---------------------------------------------------------------------------
// Boot, input, persistence, camera and the main loop. Also hosts a small
// autopilot (?bot=1) used for automated playtesting.
// ---------------------------------------------------------------------------

const Progress = {
  data: null,
  defaults() {
    return {
      achievements: {}, best: { time: 0, kills: 0, level: 0 }, totals: { runs: 0, kills: 0, wins: 0 },
      settings: { master: 0.8, music: 0.6, sfx: 0.85, numbers: true, shake: 1 }, lastChar: 'bellringer',
    };
  },
  load() {
    const d = Store.load();
    const def = this.defaults();
    this.data = d ? Object.assign(def, d, { settings: Object.assign(def.settings, d.settings || {}), best: Object.assign(def.best, d.best || {}), totals: Object.assign(def.totals, d.totals || {}) }) : def;
    G.settings = this.data.settings;
  },
  save() { Store.save(this.data); },
  unlock(id) {
    if (this.data.achievements[id]) return;
    if (Debug.bot) return; // automated runs never touch the real save
    this.data.achievements[id] = Date.now();
    this.save();
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (a) { UI.toast(a); UI.newAch.push(a); }
  },
  isCharUnlocked(c) { return !c.unlock || !!this.data.achievements[c.unlock]; },
  rerollsPerRun() { const a = this.data.achievements; return 1 + (a.win ? 1 : 0) + (a.twoEvo ? 1 : 0); },
  recordRun(victory) {
    if (Debug.bot) return;
    const d = this.data;
    d.totals.runs++; d.totals.kills += G.stats.kills; if (victory) d.totals.wins++;
    d.best.time = Math.max(d.best.time, Math.floor(G.time));
    d.best.kills = Math.max(d.best.kills, G.stats.kills);
    d.best.level = Math.max(d.best.level, G.player.level);
    if (G.time >= 180) this.unlock('survive3');
    if (G.time >= 300) this.unlock('eclipse');
    this.save();
  },
};

const Input = {
  keys: Object.create(null), queued: { dash: false, bell: false },
  touchAxis: { x: 0, y: 0 }, isTouch: false,
  init() {
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys = Object.create(null); if (G.state === 'play') UI.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') UI.pause(); });
    this.isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    this.initTouch();
  },
  onKey(e, down) {
    const c = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(c) && G.state !== 'title') e.preventDefault();
    if (down && e.repeat) { if (G.state === 'levelup' && /Arrow/.test(c)) UI.levelKey(c); return; }
    this.keys[c] = down;
    if (!down) return;
    if (G.state !== 'paused') Sfx.init();
    switch (G.state) {
      case 'play':
        if (c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyK') this.queued.dash = true;
        if (c === 'Space' || c === 'KeyL') this.queued.bell = true;
        if (c === 'Escape' || c === 'KeyP') UI.pause();
        break;
      case 'paused':
        if (c === 'Escape' || c === 'KeyP') { if (!UI.el.settings.hidden) UI.closePanel('settings'); else UI.resume(); }
        break;
      case 'levelup': UI.levelKey(c); break;
      case 'result':
        if (c === 'KeyR' || c === 'Enter') UI.restart();
        if (c === 'Escape') UI.toTitle();
        break;
      case 'title': {
        if (!UI.el.achievements.hidden || !UI.el.settings.hidden) { if (c === 'Escape') { UI.closePanel('achievements'); UI.closePanel('settings'); } break; }
        const m = /^Digit([1-5])$/.exec(c);
        if (m) { const ch = CHARACTERS[+m[1] - 1]; UI.selectedChar = ch.id; UI.renderChars(); Sfx.play('hover'); }
        if (c === 'Enter') UI.startRun();
        if (c === 'ArrowLeft' || c === 'ArrowRight') {
          const i = CHARACTERS.findIndex(x => x.id === UI.selectedChar);
          const n = (i + (c === 'ArrowLeft' ? CHARACTERS.length - 1 : 1)) % CHARACTERS.length;
          UI.selectedChar = CHARACTERS[n].id; UI.renderChars(); Sfx.play('hover');
        }
        break;
      }
    }
    if (c === 'KeyM' && G.state !== 'title') {
      G.settings.master = G.settings.master > 0 ? 0 : 0.8;
      Sfx.setVolumes(G.settings.master, G.settings.music, G.settings.sfx);
      const slider = document.getElementById('set-master');
      if (slider) slider.value = G.settings.master;
      UI.notice(G.settings.master > 0 ? 'Sound on' : 'Muted', 'bone', 1.2);
      Progress.save();
    }
  },
  axis() {
    if (Debug.bot) return Debug.botAxis();
    const k = this.keys;
    let x = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    let y = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
    if (!x && !y && (this.touchAxis.x || this.touchAxis.y)) return { x: this.touchAxis.x, y: this.touchAxis.y };
    if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
    return { x, y };
  },
  consume(a) { const v = this.queued[a]; this.queued[a] = false; return v; },
  initTouch() {
    const pad = document.getElementById('touch-stick'), knob = document.getElementById('touch-knob');
    let id = null, ox = 0, oy = 0;
    const R0 = 46;
    pad.addEventListener('pointerdown', e => { id = e.pointerId; ox = e.clientX; oy = e.clientY; pad.setPointerCapture(id); knob.style.left = ox + 'px'; knob.style.top = oy + 'px'; knob.classList.add('on'); Sfx.init(); });
    pad.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R0) { dx = dx / d * R0; dy = dy / d * R0; }
      this.touchAxis.x = Math.abs(dx) > 6 ? dx / R0 : 0; this.touchAxis.y = Math.abs(dy) > 6 ? dy / R0 : 0;
      const l = Math.hypot(this.touchAxis.x, this.touchAxis.y); if (l > 1) { this.touchAxis.x /= l; this.touchAxis.y /= l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const end = e => { if (e.pointerId !== id) return; id = null; this.touchAxis.x = this.touchAxis.y = 0; knob.style.transform = ''; knob.classList.remove('on'); };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
    document.getElementById('touch-dash').addEventListener('pointerdown', e => { e.preventDefault(); this.queued.dash = true; });
    document.getElementById('touch-bell').addEventListener('pointerdown', e => { e.preventDefault(); this.queued.bell = true; });
    document.getElementById('touch-pause').addEventListener('pointerdown', e => { e.preventDefault(); UI.pause(); });
  },
};

// ---- Autopilot & debug hooks (?bot=1&speed=4&start=300&char=moonwitch) ------
const Debug = {
  bot: false, speed: 1, start: 0,
  init() {
    const q = new URLSearchParams(location.search);
    this.bot = q.get('bot') === '1';
    this.speed = Math.max(1, Math.min(16, parseInt(q.get('speed') || '1', 10)));
    this.start = parseFloat(q.get('start') || '0');
    this.char = q.get('char');
    this.randomPicks = q.get('pick') === 'random';
    this.god = q.get('god') === '1';
    this.log = [];
    window.__G = G;
    window.__debug = this;
  },
  botAxis() {
    const P = G.player;
    let vx = 0, vy = 0;
    for (const e of G.enemies) {
      const dx = P.x - e.x, dy = P.y - e.y, d2 = dx * dx + dy * dy;
      const reach = e.boss ? 60 : e.elite ? 80 : 70;
      if (d2 > reach * reach || e.emerge > 0) continue;
      const w = (e.boss ? 6 : e.elite ? 3 : 1) / Math.max(30, d2);
      vx += dx * w; vy += dy * w;
    }
    G.shots.forEach(s => {
      const dx = P.x - s.x, dy = P.y - s.y, d2 = dx * dx + dy * dy;
      if (d2 > 70 * 70) return;
      const px = -s.vy, py = s.vx;
      const side = (dx * px + dy * py) > 0 ? 1 : -1;
      vx += px * side * 0.0015; vy += py * side * 0.0015;
    });
    for (const t of G.telegraphs) {
      if (t.type === 'circle') {
        const dx = P.x - t.x, dy = P.y - t.y, d = Math.hypot(dx, dy) || 1;
        if (d < t.r + 14) { vx += dx / d * 0.08; vy += dy / d * 0.08; }
      } else if (t.type === 'lane' && t.owner) {
        const a = t.owner.aimA, rx = P.x - t.owner.x, ry = P.y - t.owner.y;
        const along = rx * Math.cos(a) + ry * Math.sin(a), across = -rx * Math.sin(a) + ry * Math.cos(a);
        if (along > -10 && along < t.len + 10 && Math.abs(across) < t.w) {
          const s = across >= 0 ? 1 : -1;
          vx += -Math.sin(a) * s * 0.1; vy += Math.cos(a) * s * 0.1;
        }
      }
    }
    // Greed: drift toward loot when it is reasonably safe.
    const danger = Math.hypot(vx, vy);
    let best = null, bd = 1e9;
    for (const p of G.pickups) { const d = dist2(P.x, P.y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
    if (!best) for (const e of G.echoes) { const d = dist2(P.x, P.y, e.x, e.y); if (d < bd && d < 200 * 200) { bd = d; best = e; } }
    if (!best) G.gems.forEach(g => { const d = dist2(P.x, P.y, g.x, g.y); if (d < bd && d < 220 * 220) { bd = d; best = g; } });
    if (best && danger < 0.09) { const d = Math.sqrt(bd) || 1; const pull = danger < 0.03 ? 0.05 : 0.025; vx += (best.x - P.x) / d * pull; vy += (best.y - P.y) / d * pull; }
    // Stay away from walls and corners.
    const cx = ARENA.w / 2 - P.x, cy = ARENA.h * 0.55 - P.y;
    vx += cx * 0.000012; vy += cy * 0.000012;
    if (!vx && !vy) { vx = Math.cos(G.time * 0.4); vy = Math.sin(G.time * 0.3); }
    const l = Math.hypot(vx, vy) || 1;
    // Auto-dash and auto-bell when it matters.
    const close = G.enemies.filter(e => dist2(e.x, e.y, P.x, P.y) < 22 * 22).length;
    if (close >= 4 || (P.hp < P.s.maxHp * 0.35 && close >= 2)) Input.queued.dash = true;
    if (P.res >= 100 && (close >= 6 || (G.boss && Boss.state === 'tele') || P.hp < P.s.maxHp * 0.4 || G.tolls.length)) Input.queued.bell = true;
    return { x: vx / l, y: vy / l };
  },
  botLevel() {
    if (G.state === 'levelup' && performance.now() >= UI.lockUntil && !UI.choosing) {
      // Prefer evolutions, then weapons, then synergies.
      const rank = this.randomPicks ? () => Math.random()
        : o => ({ evolution: 100, weaponNew: 8, weaponUp: 7, covenant: 6, passiveNew: 5, passiveUp: 4, relic: 1 }[o.kind] || 0) + Math.random() * 3;
      let bi = 0;
      UI.opts.forEach((o, i) => { if (rank(o) > rank(UI.opts[bi])) bi = i; });
      UI.choose(bi);
    }
    if (G.state === 'result' && !this.reported) {
      this.reported = true;
      window.__result = { victory: G.victory, time: G.time, kills: G.stats.kills, level: G.player.level, dmg: G.stats.damageBy, weapons: G.player.weapons.map(w => w.id + ':' + w.lv), passives: G.player.passiveOrder.map(id => id + ':' + G.player.passives[id]), covenants: [...G.player.covenants], log: this.log };
    }
  },
  sample() {
    if (!this.bot || !G.player) return;
    const t = Math.floor(G.time / 15);
    if (t !== this.lastSample) {
      this.lastSample = t;
      this.log.push({ t: Math.round(G.time), lv: G.player.level, xp: Math.round(G.stats.xp), drop: Math.round(G.stats.xpDropped), hp: Math.round(G.player.hp), en: G.enemies.length, kills: G.stats.kills, boss: G.boss ? Math.round(G.boss.hp) : null, fps: Math.round(FPS.value) });
    }
  },
};

const FPS = { value: 60, acc: 0, n: 0, update(dt) { this.acc += dt; this.n++; if (this.acc >= 0.5) { this.value = this.n / this.acc; this.acc = 0; this.n = 0; } } };

function updateCamera(dt, snap) {
  const P = G.player, v = G.view;
  const tx = P.x + P.vx * 0.2 - v.w / 2, ty = P.y - 6 + P.vy * 0.2 - v.h / 2;
  const k = snap ? 1 : damp(7, dt);
  G.cam.x += (tx - G.cam.x) * k; G.cam.y += (ty - G.cam.y) * k;
  const m = 40;
  G.cam.x = v.w > ARENA.w + m * 2 ? (ARENA.w - v.w) / 2 : clamp(G.cam.x, -m, ARENA.w + m - v.w);
  G.cam.y = v.h > ARENA.h + m * 2 ? (ARENA.h - v.h) / 2 : clamp(G.cam.y, -m, ARENA.h + m - v.h);
}

function attractCamera(t) {
  const v = G.view;
  G.cam.x = 1200 + Math.sin(t * 0.045) * 420 - v.w / 2;
  G.cam.y = 760 + Math.sin(t * 0.031 + 1) * 380 - v.h / 2;
  if (Math.random() < 0.3) Parts.emit(G.cam.x + rand(v.w), G.cam.y + v.h + 4, rand(-6, 6), rand(-26, -10), rand(3, 6), 1, pick(['#8a8590', '#c6c0b5', '#ead18a']), { drag: 0.2, add: Math.random() < 0.3 });
}

let lastFrame = performance.now();
function loop(now) {
  const realDt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  G.realTime += realDt;
  FPS.update(realDt);

  if (G.state === 'play') {
    let dt = realDt;
    if (G.hitstopT > 0) { G.hitstopT -= realDt; dt = 0; }
    if (G.slowmo > 0) { G.slowmo -= realDt; dt *= 0.3; }
    if (dt > 0) {
      const reps = Debug.bot ? Debug.speed : 1;
      for (let r = 0; r < reps && G.state === 'play'; r++) {
        const steps = dt > 1 / 45 ? 2 : 1;
        for (let i = 0; i < steps; i++) updateGame(dt / steps);
        if (G.levelQueue > 0 || G.pendingChest > 0 || G.player.dead) break;
      }
    }
    updateCamera(realDt);
    const P = G.player;
    if (P.dead) {
      G.deathT += realDt;
      if (G.deathT > 2.0) UI.showResult(false);
    } else if (!G.victory) {
      if (G.levelQueue > 0) UI.openLevelUp('level');
      else if (G.pendingChest > 0) { G.pendingChest--; UI.openLevelUp('chest'); }
    }
    if (G.pendingEvolution && G.state === 'play') { celebrateEvolution(G.pendingEvolution); G.pendingEvolution = null; }
    Debug.sample();
  } else if (G.state === 'title') {
    attractCamera(G.realTime);
    Parts.update(realDt);
  }
  if (Debug.bot) Debug.botLevel();
  G.flash.a = Math.max(0, G.flash.a - realDt * 2.4);
  G.shake = Math.max(0, G.shake - realDt * 1.7);
  R.frame(G.realTime);
  requestAnimationFrame(loop);
}

function boot() {
  Debug.init();
  Progress.load();
  buildAssets();
  initPools();
  World.generate((Math.random() * 1e9) | 0);
  R.init();
  R.makeFogPatterns();
  Input.init();
  UI.init();
  const go = () => {
    UI.showTitle();
    if (Debug.bot) {
      UI.selectedChar = Debug.char && CHARACTERS.some(c => c.id === Debug.char) ? Debug.char : 'bellringer';
      UI.startRun();
      if (Debug.start > 0) skipTo(Debug.start);
    }
  };
  // Give the pixel fonts a moment to arrive; never block on them.
  const fonts = document.fonts ? Promise.race([
    Promise.all([document.fonts.load('16px "Pixelify Sans"', 'Aa0123456789'), document.fonts.load('16px "Jacquarda Bastarda 9"')]),
    new Promise(r => setTimeout(r, 1200)),
  ]) : Promise.resolve();
  fonts.catch(() => {}).then(go);
  requestAnimationFrame(loop);
  // Title music starts on the first interaction (browsers block autoplay).
  const firstGesture = () => {
    Sfx.init();
    Sfx.setVolumes(G.settings.master, G.settings.music, G.settings.sfx);
    if (G.state === 'title') Sfx.Music.start('title');
    window.removeEventListener('pointerdown', firstGesture);
    window.removeEventListener('keydown', firstGesture);
  };
  window.addEventListener('pointerdown', firstGesture);
  window.addEventListener('keydown', firstGesture);
}

// Debug helper: jump the run forward with a plausible build (testing only).
function skipTo(t) {
  const P = G.player;
  G.time = t;
  while (Director.eventIdx < EVENTS.length && EVENTS[Director.eventIdx].t < t - 1) Director.eventIdx++;
  const levels = Math.floor(t / 11);
  for (let i = 0; i < levels; i++) { applyOption(buildOptions('level')[0]); P.level++; }
  P.xpNext = xpForLevel(P.level);
  if (t >= 300) Director.mood = Director.moodTarget = 1;
}

window.addEventListener('load', boot);
