'use strict';
// ---------------------------------------------------------------------------
// Core simulation: run state, player, enemies, combat, pickups, particles,
// effects and level-up option generation.
// ---------------------------------------------------------------------------

const G = {
  state: 'title', time: 0, realTime: 0,
  view: { w: 640, h: 360, scale: 3 },
  cam: { x: 0, y: 0, sx: 0, sy: 0 },
  player: null, enemies: [], grid: null,
  projs: null, shots: null, gems: null, numbers: null,
  pickups: [], echoes: [], sweeps: [], rings: [], sigils: [], pools: [], fx: [], corpses: [], telegraphs: [], tolls: [], lights: [],
  shake: 0, hitstopT: 0, timeScale: 1, slowmo: 0, flash: { color: '#fff', a: 0 },
  buffs: { frenzy: 0, fury: 0 }, stats: null, uid: 1, levelQueue: 0, rerolls: 1,
  boss: null, victory: false, deathT: 0, hints: null, ambient: null, settings: null,
};

const QBUF = new Array(1024);
const MAX_ENEMIES = 340;

// ---- Particles (struct of arrays, ring buffer) --------------------------------
const PART_MAX = 1600;
const Parts = {
  x: new Float32Array(PART_MAX), y: new Float32Array(PART_MAX), vx: new Float32Array(PART_MAX), vy: new Float32Array(PART_MAX),
  life: new Float32Array(PART_MAX), max: new Float32Array(PART_MAX), size: new Float32Array(PART_MAX),
  grav: new Float32Array(PART_MAX), drag: new Float32Array(PART_MAX), add: new Uint8Array(PART_MAX),
  col: new Array(PART_MAX).fill('#fff'), cursor: 0,
  emit(x, y, vx, vy, life, size, col, o = {}) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % PART_MAX;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.col[i] = col;
    this.grav[i] = o.grav || 0; this.drag[i] = o.drag === undefined ? 3 : o.drag; this.add[i] = o.add ? 1 : 0;
  },
  update(dt) {
    for (let i = 0; i < PART_MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr; this.vy[i] = this.vy[i] * dr + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
    }
  },
  clear() { this.life.fill(0); },
};

function emitSparks(x, y, n, col, spd = 90) {
  for (let i = 0; i < n; i++) {
    const a = rand(TAU), s = rand(0.3, 1) * spd;
    Parts.emit(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.15, 0.35), rand(1, 2), col, { add: 1, drag: 6 });
  }
}
function emitBlood(x, y, n, dirX = 0, dirY = 0) {
  for (let i = 0; i < n; i++) {
    const a = rand(TAU), s = rand(20, 80);
    Parts.emit(x, y, Math.cos(a) * s + dirX * 60, Math.sin(a) * s - 40 + dirY * 60, rand(0.3, 0.6), rand(1, 2), pick(['#8a1022', '#c22035', '#6c0f1d']), { grav: 260, drag: 2 });
  }
}
function emitAsh(x, y, n, col = '#8a8590') {
  for (let i = 0; i < n; i++) {
    Parts.emit(x + rand(-4, 4), y + rand(-6, 2), rand(-12, 12), rand(-40, -15), rand(0.5, 1.1), rand(1, 2), col, { drag: 1.5 });
  }
}
function emitDust(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(TAU), s = rand(30, 110);
    Parts.emit(x, y, Math.cos(a) * s, Math.sin(a) * s * 0.6, rand(0.3, 0.7), rand(1.5, 3), pick(['#6a6470', '#4a4650', '#8a8590']), { drag: 4 });
  }
}
function emitRing(x, y, n, col, spd, add = 1) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.1, 0.1), s = spd * rand(0.85, 1.1);
    Parts.emit(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.55), rand(1, 2.5), col, { add, drag: 3 });
  }
}

// ---- Small helpers -------------------------------------------------------------
function addFx(o) { if (G.fx.length < 260) G.fx.push(o); }
function addLightFlash(x, y, r, color, dur) { if (G.lights.length < 60) G.lights.push({ x, y, r, color, t: dur, max: dur }); }
function addShake(a) { G.shake = Math.min(1, G.shake + a * (G.settings ? G.settings.shake : 1)); }
function hitstop(t) { G.hitstopT = Math.min(0.12, Math.max(G.hitstopT, t)); }
function screenFlash(color, a) { G.flash.color = color; G.flash.a = Math.max(G.flash.a, a); }
function onScreen(x, y, m = 20) {
  return x > G.cam.x - m && x < G.cam.x + G.view.w + m && y > G.cam.y - m && y < G.cam.y + G.view.h + m;
}
function addNumber(x, y, val, kind) {
  if (!G.settings.numbers) return;
  // Under heavy load keep only the numbers that matter most.
  const active = G.numbers.countActive();
  const vital = kind === 'player' || kind === 'heal';
  if (!vital && active > 34 && kind !== 'crit') return;
  if (!vital && active > 60) return;
  const n = G.numbers.get();
  if (!n) return;
  n.x = x + rand(-3, 3); n.y = y; n.vy = -38; n.t = 0; n.kind = kind;
  n.text = typeof val === 'number' ? String(Math.max(1, Math.round(val))) : val;
}

// ---- Spatial queries -------------------------------------------------------------
function queryEnemies(x, y, r) { return G.grid.query(x, y, r, QBUF, QBUF.length); }

function nearestEnemy(x, y, maxR, exclude) {
  let best = null, bd = maxR * maxR;
  for (const e of G.enemies) {
    if (e.dead || e.emerge > 0) continue;
    const d = dist2(x, y, e.x, e.y);
    if (d < bd && (!exclude || !exclude.includes(e))) { bd = d; best = e; }
  }
  return best;
}

function randomEnemyNear(x, y, r) {
  let pickE = null, n = 0;
  const r2 = r * r;
  for (const e of G.enemies) {
    if (e.dead || e.emerge > 0) continue;
    if (dist2(x, y, e.x, e.y) > r2) continue;
    if (!onScreen(e.x, e.y, 0)) continue;
    n++;
    if (Math.random() * n < 1) pickE = e;
  }
  return pickE;
}

function densestSpot(x, y, r, used, minSep) {
  let best = null, bestScore = 0;
  const r2 = r * r;
  const cands = [];
  for (const e of G.enemies) {
    if (e.dead || e.emerge > 0) continue;
    if (dist2(x, y, e.x, e.y) < r2) cands.push(e);
  }
  if (!cands.length) return null;
  for (let k = 0; k < 10; k++) {
    const e = cands[(Math.random() * cands.length) | 0];
    if (used && used.some(u => dist2(u.x, u.y, e.x, e.y) < minSep * minSep)) continue;
    const score = queryEnemies(e.x, e.y, 30) + (e.elite || e.boss ? 6 : 0);
    if (score > bestScore) { bestScore = score; best = { x: e.x, y: e.y }; }
  }
  return best;
}

// ---- Run setup --------------------------------------------------------------------
function makePlayer(char) {
  const P = {
    char, x: 1200, y: 1430, vx: 0, vy: 0, r: 5, hp: 100, s: null,
    level: 1, xp: 0, xpNext: xpForLevel(1),
    weapons: [], passives: {}, passiveOrder: [], covenants: new Set(),
    face: 1, aim: -Math.PI / 2, moving: false, animT: 0,
    inv: 0, dashT: 0, dashDir: 0, dashCharges: 1, dashRecharge: 0, dashHits: [],
    res: 0, bellCd: 0, bellNotified: false, bellSwing: 0,
    lastRitesUsed: false, soulCount: 0, hurtT: 0, hpTrail: 100, heartT: 0, trailT: 0,
    dead: false, deathT: 0,
    hasWeapon(id) { return this.weapons.some(w => w.id === id); },
    passiveLv(id) { return this.passives[id] || 0; },
  };
  return P;
}

function xpForLevel(lv) { return Math.floor(5 + (lv - 1) * 2.0 + Math.pow(lv - 1, 2) * 0.25); }

function recomputeStats() {
  const P = G.player;
  const s = Object.assign({}, BASE_STATS);
  P.char.apply(s);
  for (const id of P.passiveOrder) PASSIVES[id].apply(s, P.passives[id]);
  if (P.covenants.has('glass')) { s.maxHp *= 0.6; s.crit += 0.2; s.critMul += 1; }
  if (P.covenants.has('moonlitStride')) s.dashCharges += 1;
  if (P.covenants.has('deepReservoir')) { s.resGain *= 1.4; s.bellRadius *= 1.3; }
  s.bonusMight = G.stats ? G.stats.relicMight : 0;
  s.might *= 1 + s.bonusMight;
  s.maxHp = Math.round(s.maxHp);
  const old = P.s;
  P.s = s;
  if (old) {
    if (s.maxHp > old.maxHp) P.hp += s.maxHp - old.maxHp;
    P.hp = Math.min(P.hp, s.maxHp);
    if (s.dashCharges > old.dashCharges) P.dashCharges += s.dashCharges - old.dashCharges;
  } else {
    P.hp = s.maxHp; P.hpTrail = s.maxHp; P.dashCharges = s.dashCharges;
  }
}

function newRun(charId) {
  const char = CHARACTERS.find(c => c.id === charId) || CHARACTERS[0];
  World.generate((Math.random() * 1e9) | 0);
  G.time = 0; G.uid = 1; G.levelQueue = 0; G.pendingChest = 0; G.pendingEvolution = null; G.resultShown = false;
  G.shatterT = G.harvestT = G.heavyT = -9; G.bellPulse = 0;
  G.enemies.length = 0;
  G.projs.clear(); G.shots.clear(); G.gems.clear(); G.numbers.clear(); Parts.clear();
  for (const k of ['pickups', 'echoes', 'sweeps', 'rings', 'sigils', 'pools', 'fx', 'corpses', 'telegraphs', 'tolls', 'lights']) G[k].length = 0;
  G.shake = 0; G.hitstopT = 0; G.timeScale = 1; G.slowmo = 0; G.flash.a = 0;
  G.buffs.frenzy = 0; G.buffs.fury = 0;
  G.boss = null; G.victory = false; G.deathT = 0;
  G.stats = {
    kills: 0, xp: 0, xpDropped: 0, damageBy: {}, damageTaken: 0, elites: 0, rings: 0, evolutions: 0, relicMight: 0,
    peakLevel: 1, chests: 0, interrupted: false, harvestKills: 0, thief: false,
  };
  G.hints = { move: 0, dash: 0, bell: 0, bellShown: false, t: 0 };
  G.rerolls = Progress.rerollsPerRun();
  const P = makePlayer(char);
  G.player = P;
  recomputeStats();
  P.weapons.push({ id: char.weapon, lv: char.startLevel || 1, t: 0.4 });
  G.cam.x = P.x - G.view.w / 2; G.cam.y = P.y - G.view.h / 2;
  Director.reset();
  G.state = 'play';
}

// ---- Player --------------------------------------------------------------------------
function updatePlayer(dt) {
  const P = G.player, s = P.s;
  if (P.dead) return;
  const ax = Input.axis();
  P.moving = ax.x !== 0 || ax.y !== 0;
  if (P.moving) {
    P.aim = Math.atan2(ax.y, ax.x);
    if (ax.x !== 0) P.face = ax.x > 0 ? 1 : -1;
    G.hints.move += dt;
  }

  if (P.dashT > 0) {
    P.dashT -= dt;
    const sp = 360;
    P.vx = Math.cos(P.dashDir) * sp; P.vy = Math.sin(P.dashDir) * sp;
    P.trailT -= dt;
    if (P.trailT <= 0) {
      P.trailT = 0.025;
      addFx({ type: 'after', x: P.x, y: P.y, face: P.face, frame: 0, life: 0.28, max: 0.28 });
      if (P.covenants.has('moonlitStride')) G.pools.push({ x: P.x, y: P.y, r: 11 * s.area, t: 1.8, max: 1.8, dps: 26 * s.might, tick: 0, kind: 'moon' });
    }
    if (P.covenants.has('moonlitStride')) {
      const n = queryEnemies(P.x, P.y, 12);
      for (let i = 0; i < n; i++) {
        const e = QBUF[i];
        if (P.dashHits.includes(e.uid)) continue;
        P.dashHits.push(e.uid);
        damageEnemy(e, 28 * s.might, { src: 'moonlitStride', kb: 90, fromX: P.x, fromY: P.y });
      }
    }
  } else {
    const tx = ax.x * s.speed, ty = ax.y * s.speed;
    const k = damp(P.moving ? 16 : 22, dt);
    P.vx += (tx - P.vx) * k; P.vy += (ty - P.vy) * k;
  }
  P.x += P.vx * dt; P.y += P.vy * dt;
  World.collide(P, P.r);
  P.x = clamp(P.x, ARENA.pad, ARENA.w - ARENA.pad);
  P.y = clamp(P.y, ARENA.pad + 10, ARENA.h - ARENA.pad);
  if (P.y < 340 && P.x > 860 && P.x < 1540) P.y = 340;

  const spd = Math.hypot(P.vx, P.vy);
  P.animT += dt * (spd > 10 ? spd / 9 : 0);

  if (P.inv > 0) P.inv -= dt;
  if (P.hurtT > 0) P.hurtT -= dt;
  P.hpTrail = approach(P.hpTrail, P.hp, dt * 40 * (P.hpTrail > P.hp ? 1 : 3));

  // Dash charges
  if (P.dashCharges < s.dashCharges) {
    P.dashRecharge += dt;
    if (P.dashRecharge >= s.dashCd) { P.dashRecharge = 0; P.dashCharges++; }
  } else P.dashRecharge = 0;
  if (Input.consume('dash')) tryDash();
  if (Input.consume('bell')) ringBell(false);

  // Regeneration
  if (s.regen > 0 && P.hp < s.maxHp) P.hp = Math.min(s.maxHp, P.hp + s.regen * dt);

  if (P.bellCd > 0) P.bellCd -= dt;
  if (P.bellSwing > 0) P.bellSwing -= dt;
  if (P.res >= 100 && !P.bellNotified) {
    P.bellNotified = true;
    Sfx.play('bellReady');
    addFx({ type: 'text', x: P.x, y: P.y - 22, text: 'THE BELL IS READY', color: COLORS.cyan, life: 1.6, max: 1.6 });
    G.hints.bellShown = true;
  }

  // Low health heartbeat
  if (P.hp < s.maxHp * 0.3) {
    P.heartT -= dt;
    if (P.heartT <= 0) { P.heartT = 0.85; Sfx.play('heart'); }
  }
}

function tryDash() {
  const P = G.player;
  if (P.dashT > 0 || P.dead) return;
  if (P.dashCharges <= 0) { Sfx.play('deny'); return; }
  P.dashCharges--;
  const ax = Input.axis();
  P.dashDir = ax.x || ax.y ? Math.atan2(ax.y, ax.x) : P.aim;
  P.dashT = 0.17;
  P.inv = Math.max(P.inv, 0.26);
  P.dashHits.length = 0;
  P.trailT = 0;
  emitDust(P.x, P.y + 4, 8);
  Sfx.play('dash');
  G.hints.dash = 1;
}

function ringBell(free) {
  const P = G.player;
  if (!free) {
    if (P.res < 100 || P.bellCd > 0) {
      Sfx.play('deny');
      if (P.res < 100) addFx({ type: 'text', x: P.x, y: P.y - 20, text: 'Resonance ' + Math.floor(P.res) + '%', color: COLORS.cyanDim, life: 0.8, max: 0.8 });
      return;
    }
    P.res = 0;
  }
  P.bellNotified = false;
  P.bellCd = 1.2;
  P.bellSwing = 1.0;
  G.stats.rings++;
  G.hints.bell = 1;
  Progress.unlock('firstToll');
  const R = P.s.bellRadius;
  addRing({ x: P.x, y: P.y, maxR: R, speed: R / 0.42, dmg: (24 + P.level * 2.2) * P.s.might, knock: 330, src: 'bell', bell: true, color: COLORS.cyan, width: 5 });
  if (P.covenants.has('echoingPeal')) {
    for (let i = 1; i <= 2; i++) G.fx.push({ type: 'delay', t: i * 0.55, fn: () => {
      addRing({ x: G.player.x, y: G.player.y, maxR: R * 0.8, speed: R / 0.45, dmg: (16 + G.player.level * 1.5) * G.player.s.might, knock: 220, src: 'bell', bell: true, echo: true, color: COLORS.cyan, width: 3 });
      Sfx.play('bellEcho');
    } });
  }
  if (P.covenants.has('resonantFury')) { G.buffs.fury = 7; }
  // Silence every hostile toll and projectile near the bell.
  for (const t of G.tolls) { t.dead = true; emitRing(t.x, t.y, 30, COLORS.crimson, t.r * 2); }
  G.shots.forEach(sh => { if (dist2(sh.x, sh.y, P.x, P.y) < (R * 1.15) ** 2) { sh.active = false; emitSparks(sh.x, sh.y, 3, COLORS.cyan, 50); } });
  hitstop(0.07);
  addShake(0.5);
  screenFlash(COLORS.cyan, 0.32);
  addLightFlash(P.x, P.y, R * 1.6, 'cyan', 0.6);
  emitRing(P.x, P.y, 48, COLORS.cyan, R * 1.8);
  Sfx.play('bell');
}

function hurtPlayer(dmg, sx, sy) {
  const P = G.player;
  if (P.inv > 0 || P.dashT > 0 || P.dead || G.state !== 'play' || G.victory || Debug.god) return;
  const amount = Math.max(1, Math.round(dmg - P.s.armor));
  P.hp -= amount;
  P.inv = 0.6;
  P.hurtT = 0.25;
  G.stats.damageTaken += amount;
  addNumber(P.x, P.y - 14, amount, 'player');
  addShake(0.32);
  screenFlash(COLORS.crimson, 0.2);
  emitBlood(P.x, P.y - 4, 6, P.x - sx, P.y - sy);
  Sfx.play('hurt');
  // Breathing room: shove the nearest attackers back.
  const n = queryEnemies(P.x, P.y, 30);
  for (let i = 0; i < n; i++) {
    const e = QBUF[i];
    if (e.boss) continue;
    const d = Math.max(1, dist(P.x, P.y, e.x, e.y));
    const f = 140 * (1 - (e.kbResist || 0));
    e.kx += ((e.x - P.x) / d) * f; e.ky += ((e.y - P.y) / d) * f;
  }
  if (P.hp <= 0) {
    if (P.covenants.has('lastRites') && !P.lastRitesUsed) {
      P.lastRitesUsed = true;
      P.hp = Math.round(P.s.maxHp * 0.5);
      P.inv = 1.5;
      ringBell(true);
      UI.banner('Last Rites', 'Not yet. The bell is not finished with you.', 'cyan');
      return;
    }
    P.hp = 0;
    playerDies();
  }
}

function playerDies() {
  const P = G.player;
  P.dead = true;
  G.deathT = 0;
  G.slowmo = 1.6;
  screenFlash('#000', 0.5);
  addShake(0.6);
  emitBlood(P.x, P.y - 4, 20);
  Sfx.play('death');
  Sfx.Music.stop();
}

function healPlayer(v) {
  const P = G.player;
  const before = P.hp;
  P.hp = Math.min(P.s.maxHp, P.hp + v);
  const got = P.hp - before;
  if (got >= 1) addNumber(P.x, P.y - 14, '+' + Math.round(got), 'heal');
}

// ---- Enemies ---------------------------------------------------------------------------
function spawnEnemy(type, x, y, o = {}) {
  if (G.enemies.length >= MAX_ENEMIES && !o.force) return null;
  const d = ENEMIES[type];
  const t = G.time;
  const hpMul = d.boss ? 1 : d.elite ? 1 + t / 170 : 1 + t / 60 * 0.2 + Math.max(0, t - 180) / 60 * 0.2;
  const e = {
    uid: G.uid++, type, def: d, x, y, vx: 0, vy: 0, kx: 0, ky: 0, r: d.r,
    hp: d.hp * hpMul * (o.hpMul || 1), maxHp: 0, dmg: d.dmg * (1 + t / 420 * 0.5), speed: d.speed * rand(0.92, 1.08),
    mass: d.mass, armor: d.armor || 0, kbResist: d.kbResist || 0, xp: d.xp, elite: !!d.elite, boss: !!d.boss,
    face: 1, animT: rand(10), flash: 0, stunT: 0, slowT: 0, slowAmt: 0, exposedT: 0, cursedT: 0, shockT: 0,
    bleedT: 0, bleedDps: 0, burnT: 0, burnDps: 0, dotT: 0, orbT: -9, poolT: -9,
    state: 'move', stateT: 0, cd: rand(1, 3), aimA: 0, side: chance(0.5) ? 1 : -1, wob: rand(TAU), off: rand(-0.35, 0.35),
    emerge: o.emerge || 0, emergeMax: o.emerge || 0, life: 0, dead: false,
  };
  e.maxHp = e.hp;
  G.enemies.push(e);
  return e;
}

function enemySpeed(e) {
  let s = e.speed;
  if (e.slowT > 0) s *= 1 - e.slowAmt;
  if (e.cursedT > 0) s *= 0.65;
  return s;
}

function updateEnemies(dt) {
  const P = G.player;
  // Rebuild the spatial grid from current positions.
  G.grid.clear();
  for (const e of G.enemies) if (!e.dead && e.emerge <= 0) G.grid.insert(e);

  const hw = G.view.w / 2, hh = G.view.h / 2;
  for (let idx = 0; idx < G.enemies.length; idx++) {
    const e = G.enemies[idx];
    if (e.dead) continue;
    e.life += dt;
    if (e.emerge > 0) { e.emerge -= dt; if (e.emerge <= 0 && !e.boss) emitDust(e.x, e.y, 5); continue; }
    if (e.flash > 0) e.flash -= dt;
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowAmt = 0; }
    if (e.exposedT > 0) e.exposedT -= dt;
    if (e.cursedT > 0) e.cursedT -= dt;
    if (e.shockT > 0) e.shockT -= dt;
    // Damage over time ticks twice a second to keep numbers readable.
    if (e.bleedT > 0 || e.burnT > 0) {
      e.dotT += dt;
      if (e.bleedT > 0) e.bleedT -= dt;
      if (e.burnT > 0) e.burnT -= dt;
      if (e.dotT >= 0.5) {
        const dmg = ((e.bleedT > 0 ? e.bleedDps : 0) + (e.burnT > 0 ? e.burnDps : 0)) * e.dotT;
        e.dotT = 0;
        if (e.bleedT > 0 && Math.random() < 0.5) emitBlood(e.x, e.y - 3, 1);
        damageEnemy(e, dmg, { src: e.bleedT > 0 ? 'bleed' : 'burn', noCrit: true, dot: true });
        if (e.dead) continue;
      }
      if (e.bleedT <= 0) e.bleedDps = 0;
      if (e.burnT <= 0) e.burnDps = 0;
    }

    const dx = P.x - e.x, dy = P.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    let mx = 0, my = 0, spd = enemySpeed(e), accel = 7;

    if (e.stunT > 0) {
      e.stunT -= dt;
      spd = 0;
    } else if (e.marchT > 0) {
      // Authored formations march in a straight line before breaking ranks.
      e.marchT -= dt;
      mx = e.mdx; my = e.mdy; accel = 10;
    } else if (e.boss) {
      const r = Boss.update(e, dt, d, dx, dy);
      mx = r.mx; my = r.my; spd = r.spd; accel = r.accel || 6;
    } else {
      switch (e.def.behavior) {
        case 'chase': {
          const a = Math.atan2(dy, dx) + e.off * Math.min(1, d / 160);
          mx = Math.cos(a); my = Math.sin(a);
          break;
        }
        case 'flank': {
          e.wob += dt * 5;
          if (d > 60) {
            const px = -dy / d, py = dx / d;
            const off = Math.min(d * 0.55, 100) * e.side;
            const tx = P.x + px * off - e.x, ty = P.y + py * off - e.y;
            const td = Math.hypot(tx, ty) || 1;
            mx = tx / td + px * Math.sin(e.wob) * 0.4; my = ty / td + py * Math.sin(e.wob) * 0.4;
          } else { mx = dx / d; my = dy / d; }
          accel = 4;
          break;
        }
        case 'ranged': enemyRanged(e, dt, d, dx, dy); mx = e.mx; my = e.my; spd *= e.spdMul; break;
        case 'charger': enemyCharger(e, dt, d, dx, dy); mx = e.mx; my = e.my; spd = e.spdOverride !== undefined ? e.spdOverride : spd; accel = e.accelOverride || 7; break;
        case 'flee': {
          e.wob += dt;
          const a = Math.atan2(-dy, -dx) + Math.sin(e.wob * 1.3) * 0.9;
          mx = Math.cos(a); my = Math.sin(a);
          if (e.life > 24) { e.dead = true; e.escaped = true; addFx({ type: 'text', x: e.x, y: e.y - 14, text: 'The thief escaped', color: COLORS.goldDim, life: 1.4, max: 1.4 }); emitSparks(e.x, e.y, 14, COLORS.gold, 60); continue; }
          if (Math.random() < dt * 8) Parts.emit(e.x + rand(-3, 3), e.y - 4, rand(-6, 6), rand(-20, -8), 0.6, 1, COLORS.gold, { add: 1, drag: 1 });
          break;
        }
        case 'warden': eliteWarden(e, dt, d, dx, dy); mx = e.mx; my = e.my; spd *= e.spdMul; break;
        case 'matriarch': eliteMatriarch(e, dt, d, dx, dy); mx = e.mx; my = e.my; spd *= e.spdMul; accel = 3; break;
        case 'flayer': enemyCharger(e, dt, d, dx, dy, true); mx = e.mx; my = e.my; spd = e.spdOverride !== undefined ? e.spdOverride : spd; accel = e.accelOverride || 7; break;
      }
    }

    // Slide around scenery instead of grinding against it.
    if (e.slideT > 0 && (mx || my)) {
      e.slideT -= dt;
      const sx = -my * e.slideSide, sy = mx * e.slideSide;
      mx = mx * 0.35 + sx; my = my * 0.35 + sy;
      const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    }
    const k = damp(accel, dt);
    e.vx += (mx * spd - e.vx) * k; e.vy += (my * spd - e.vy) * k;
    const kd = Math.exp(-9 * dt);
    e.kx *= kd; e.ky *= kd;
    e.x += (e.vx + e.kx) * dt; e.y += (e.vy + e.ky) * dt;
    if (Math.abs(e.vx) > 4) e.face = e.vx > 0 ? 1 : -1;
    e.animT += dt * (e.def.anim || 4) * (spd > 0 ? 1 : 0.2);

    // Separation from neighbours (capped work per enemy)
    if (!e.boss) {
      const n = G.grid.query(e.x, e.y, e.r + 2, QBUF, 10);
      for (let i = 0; i < n; i++) {
        const o = QBUF[i];
        if (o === e || o.boss) continue;
        const sx = e.x - o.x, sy = e.y - o.y;
        const rr = e.r + o.r;
        const d2 = sx * sx + sy * sy;
        if (d2 < rr * rr && d2 > 0.0001) {
          const dd = Math.sqrt(d2), push = (rr - dd) * 0.5;
          const w = o.mass / (e.mass + o.mass);
          e.x += (sx / dd) * push * w * 1.2; e.y += (sy / dd) * push * w * 1.2;
        }
      }
      if (!e.def.flying) {
        const o = World.collide(e, e.r);
        if (o && !(e.slideT > 0)) {
          const ocx = o.t === 'c' ? o.x : o.x + o.w / 2, ocy = o.t === 'c' ? o.y : o.y + o.h / 2;
          const ddx = P.x - e.x, ddy = P.y - e.y;
          e.slideSide = (ddx * (e.y - ocy) - ddy * (e.x - ocx)) > 0 ? 1 : -1;
          e.slideT = 0.45;
        }
      }
      // Keep a thin ring around the player instead of stacking onto them.
      const pd = Math.hypot(e.x - P.x, e.y - P.y);
      const minD = e.r + P.r - 2;
      if (pd < minD && pd > 0.01) { e.x = P.x + ((e.x - P.x) / pd) * minD; e.y = P.y + ((e.y - P.y) / pd) * minD; }
    }
    e.x = clamp(e.x, -260, ARENA.w + 260);
    e.y = clamp(e.y, -260, ARENA.h + 260);

    // Contact damage
    if (e.stunT <= 0 && e.dmg > 0 && !P.dead) {
      const cr = e.r + P.r - 1;
      if (dist2(e.x, e.y, P.x, P.y) < cr * cr) hurtPlayer(e.dmg, e.x, e.y);
    }

    // Stragglers far behind are recycled ahead of the player to keep pressure honest.
    if (!e.elite && !e.boss && e.def.special !== 'thief' && (Math.abs(e.x - P.x) > hw + 360 || Math.abs(e.y - P.y) > hh + 320)) {
      const pos = Director.spawnPos(40);
      e.x = pos.x; e.y = pos.y; e.kx = 0; e.ky = 0;
    }
  }

  // Compact dead enemies
  let w = 0;
  for (let i = 0; i < G.enemies.length; i++) { const e = G.enemies[i]; if (!e.dead) G.enemies[w++] = e; }
  G.enemies.length = w;
}

function enemyRanged(e, dt, d, dx, dy) {
  e.spdMul = 1;
  if (e.state === 'cast') {
    e.stateT -= dt;
    e.mx = 0; e.my = 0; e.spdMul = 0;
    if (e.stateT <= 0) {
      e.state = 'move';
      e.cd = rand(2.8, 3.8);
      const a = Math.atan2(G.player.y - e.y, G.player.x - e.x);
      spawnShot({ x: e.x + e.face * 3, y: e.y - 6, ang: a, speed: 86, dmg: 9 + G.time / 60, r: 3.5, life: 4.5, kind: 'orb' });
      Sfx.play('enemyShot');
    }
    return;
  }
  e.cd -= dt;
  if (d > 150) { e.mx = dx / d; e.my = dy / d; }
  else if (d < 100) { e.mx = -dx / d; e.my = -dy / d; }
  else {
    if (Math.random() < dt * 0.4) e.side *= -1;
    e.mx = (-dy / d) * e.side; e.my = (dx / d) * e.side; e.spdMul = 0.6;
  }
  if (e.cd <= 0 && d < 250 && onScreen(e.x, e.y, -6)) { e.state = 'cast'; e.stateT = 0.75; }
}

// Shared by hounds (single dash) and the Bone Flayer elite (triple dash).
function enemyCharger(e, dt, d, dx, dy, elite = false) {
  e.spdOverride = undefined; e.accelOverride = undefined;
  switch (e.state) {
    case 'aim': {
      e.stateT -= dt;
      e.mx = 0; e.my = 0; e.spdOverride = 0;
      if (e.stateT > 0.22) e.aimA = Math.atan2(dy, dx);
      if (e.stateT <= 0) { e.state = 'dash'; e.stateT = elite ? 0.38 : 0.45; Sfx.play('charge'); }
      break;
    }
    case 'dash': {
      e.stateT -= dt;
      e.mx = Math.cos(e.aimA); e.my = Math.sin(e.aimA);
      e.spdOverride = elite ? 400 : 300; e.accelOverride = 30;
      if (Math.random() < dt * 40) Parts.emit(e.x, e.y + 2, rand(-10, 10), rand(-10, 10), 0.3, 2, '#5a5560', { drag: 4 });
      if (e.stateT <= 0) {
        if (elite && e.chain > 1) { e.chain--; e.state = 'aim'; e.stateT = 0.5; addTelegraphLane(e, 0.5); }
        else { e.state = 'rest'; e.stateT = elite ? 0.8 : 0.5; }
      }
      break;
    }
    case 'rest':
      e.stateT -= dt; e.mx = dx / d; e.my = dy / d; e.spdOverride = e.speed * 0.3;
      if (e.stateT <= 0) { e.state = 'move'; e.cd = elite ? rand(3, 4) : rand(3, 4.5); }
      break;
    default:
      e.cd -= dt;
      e.mx = dx / d; e.my = dy / d;
      if (e.cd <= 0 && d < (elite ? 190 : 145) && onScreen(e.x, e.y, -4)) {
        e.state = 'aim'; e.stateT = elite ? 0.65 : 0.75; e.chain = elite ? 3 : 1;
        addTelegraphLane(e, e.stateT);
      }
  }
}

function addTelegraphLane(e, dur) {
  G.telegraphs.push({ type: 'lane', owner: e, follow: true, len: e.elite ? 170 : 125, w: e.r * 2 + 6, t: 0, dur, dmg: 0 });
  if (e.elite) Sfx.play('telegraph');
}

function eliteWarden(e, dt, d, dx, dy) {
  e.spdMul = 1; e.mx = dx / d; e.my = dy / d;
  if (e.state === 'slam') { e.mx = 0; e.my = 0; e.spdMul = 0; e.stateT -= dt; if (e.stateT <= 0) { e.state = 'move'; e.cd = 4.2; } return; }
  e.cd -= dt;
  if (e.cd <= 0 && d < 160) {
    e.state = 'slam'; e.stateT = 1.4;
    const R = 72;
    G.telegraphs.push({
      type: 'circle', owner: e, x: e.x, y: e.y, r: R, t: 0, dur: 1.0,
      done: tg => {
        addShake(0.4); emitDust(tg.x, tg.y, 26); emitRing(tg.x, tg.y, 30, COLORS.crimson, 160, 1);
        addFx({ type: 'shock', x: tg.x, y: tg.y, r: R, life: 0.35, max: 0.35, color: COLORS.crimson });
        Sfx.play('hitHeavy');
        if (dist(tg.x, tg.y, G.player.x, G.player.y) < R + G.player.r) hurtPlayer(26, tg.x, tg.y);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + rand(0.3);
          Director.summon('husk', tg.x + Math.cos(a) * 46, tg.y + Math.sin(a) * 46);
        }
      },
    });
    Sfx.play('telegraph');
  }
}

function eliteMatriarch(e, dt, d, dx, dy) {
  e.spdMul = 1;
  e.wob += dt;
  // Circle the player at a distance, weaving.
  const desired = 120;
  const radial = (d - desired) / desired;
  const tx = (dx / d) * radial + (-dy / d) * e.side * 0.9, ty = (dy / d) * radial + (dx / d) * e.side * 0.9;
  const tl = Math.hypot(tx, ty) || 1;
  e.mx = tx / tl; e.my = ty / tl;
  if (Math.random() < dt * 0.25) e.side *= -1;
  e.cd -= dt;
  e.cd2 = (e.cd2 === undefined ? 2 : e.cd2) - dt;
  if (e.cd <= 0) {
    e.cd = 3.4;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      Director.summon('gloomwing', e.x + Math.cos(a) * 24, e.y + Math.sin(a) * 24, 0.35);
    }
    emitSparks(e.x, e.y, 16, COLORS.crimson, 80);
  }
  if (e.cd2 <= 0 && d < 260) {
    e.cd2 = 5;
    e.state = 'cast';
    G.telegraphs.push({
      type: 'fan', owner: e, follow: true, t: 0, dur: 0.7, ang: Math.atan2(dy, dx), spread: 0.9, len: 90,
      done: tg => {
        const a0 = Math.atan2(G.player.y - e.y, G.player.x - e.x);
        for (let i = -2; i <= 2; i++) spawnShot({ x: e.x, y: e.y - 4, ang: a0 + i * 0.22, speed: 96, dmg: 12, r: 3.5, life: 4, kind: 'orb' });
        Sfx.play('enemyShot');
      },
    });
    Sfx.play('telegraph');
  }
}

// ---- Combat ---------------------------------------------------------------------------
function damageEnemy(e, amount, o = {}) {
  if (e.dead || e.emerge > 0) return 0;
  if (e.boss && Boss.invulnerable(e)) {
    if (!o.dot && Math.random() < 0.2) addNumber(e.x, e.y - 30, 'IMMUNE', 'immune');
    return 0;
  }
  const P = G.player;
  let dmg = amount;
  let crit = false;
  if (!o.noCrit && Math.random() < P.s.crit) { dmg *= P.s.critMul; crit = true; }
  if (e.exposedT > 0) dmg *= 1.5;
  if (e.cursedT > 0) dmg *= 1.35;
  if (e.shockT > 0) dmg *= 1.2;
  if (e.boss) dmg *= Boss.damageMul(e);
  if (e.armor) dmg = Math.max(dmg * 0.3, dmg - e.armor);
  e.hp -= dmg;
  if (e.boss) e.hp = Math.max(e.hp, Boss.hpFloor(e));
  if (G.time >= (e.flashReady || 0)) { e.flash = 0.08; e.flashReady = G.time + (e.boss || e.elite ? 0.22 : 0.12); }
  G.stats.damageBy[o.src] = (G.stats.damageBy[o.src] || 0) + dmg;

  if (!o.dot || dmg >= 4) addNumber(e.x, e.y - e.r * 2 - 2, dmg, crit ? 'crit' : o.dot ? (o.src === 'burn' ? 'burn' : 'bleed') : 'hit');
  if (o.kb) {
    const fx = o.fromX !== undefined ? e.x - o.fromX : 0, fy = o.fromY !== undefined ? e.y - o.fromY : 0;
    const fd = Math.hypot(fx, fy) || 1;
    const f = o.kb * (1 - e.kbResist) / (0.6 + e.mass * 0.4);
    e.kx += (fx / fd) * f; e.ky += (fy / fd) * f;
  }
  if (!o.dot) Sfx.play(o.heavy ? 'hitHeavy' : 'hit');
  if (o.bleed) { e.bleedT = 3 * P.s.duration; e.bleedDps = Math.max(e.bleedDps, o.bleed); }
  if (P.covenants.has('serrated') && SERRATED_SRC.has(o.src)) { e.bleedT = 2.5 * P.s.duration; e.bleedDps = Math.max(e.bleedDps, 3.5 * P.s.might * P.s.bleedMul); }
  if (crit && P.covenants.has('glass') && G.time - (G.shatterT || 0) > 0.06) {
    G.shatterT = G.time;
    explodeAt(e.x, e.y, 26, dmg * 0.3, { src: 'glass', noCrit: true, color: COLORS.cyan, small: true, exclude: e });
  }
  if (e.hp <= 0) killEnemy(e, o.src);
  return dmg;
}
const SERRATED_SRC = new Set(['dagger', 'ossuary', 'scythe', 'harvestMoon', 'grave', 'titansRequiem']);

function explodeAt(x, y, r, dmg, o = {}) {
  // Reached from inside other QBUF loops (crit shatter, harvest bursts), so it
  // must not write to the shared buffer.
  const list = [];
  G.grid.query(x, y, r, list, 256);
  for (const e of list) {
    if (e === o.exclude) continue;
    damageEnemy(e, dmg, { src: o.src, noCrit: o.noCrit, kb: o.kb || 60, fromX: x, fromY: y, bleed: o.bleed });
  }
  addFx({ type: 'burst', x, y, r, life: o.small ? 0.2 : 0.3, max: o.small ? 0.2 : 0.3, color: o.color || COLORS.crimson });
  if (!o.small) { addLightFlash(x, y, r * 2.2, o.light || 'crimson', 0.25); emitSparks(x, y, 10, o.color || COLORS.crimson, r * 3); }
  return list.length;
}

function killEnemy(e, src) {
  if (e.dead) return;
  e.dead = true;
  const P = G.player;
  G.stats.kills++;
  if (G.stats.kills === 1000) Progress.unlock('kills1000');
  const spr = Assets.sprites[e.def.sprite];
  if (G.corpses.length < 160) G.corpses.push({ spr, x: e.x, y: e.y, flip: e.face < 0, t: 0, big: e.elite || e.boss });
  emitAsh(e.x, e.y, e.elite ? 16 : 3);
  if (Math.random() < 0.55) { emitBlood(e.x, e.y - 3, e.elite ? 14 : 3); World.stain(e.x, e.y + 2, e.elite ? 4 : 1.2); }
  Sfx.play('kill');

  if (e.boss) { Boss.onDeath(e); return; }

  // Drops
  if (e.xp > 0) {
    if (e.elite) for (let i = 0; i < 8; i++) dropGem(e.x + rand(-16, 16), e.y + rand(-12, 12), 5);
    else dropGem(e.x, e.y, e.xp);
  }
  const echoChance = (e.cursedT > 0 ? 3 : 1) * 0.055;
  if (e.elite) dropEcho(e.x, e.y, 50);
  else if (Math.random() < echoChance && G.echoes.length < 14) dropEcho(e.x, e.y, 10);
  if (!e.elite && Math.random() < 0.0045) dropPickup('chalice', e.x, e.y);
  if (!e.elite && Math.random() < 0.0016) dropPickup('chime', e.x, e.y);

  if (e.def.special === 'thief') {
    G.stats.thief = true;
    Progress.unlock('thief');
    dropPickup('chest', e.x, e.y);
    dropPickup(G.player.hp < G.player.s.maxHp * 0.6 ? 'chalice' : 'chime', e.x + 14, e.y);
    for (let i = 0; i < 5; i++) dropGem(e.x + rand(-14, 14), e.y + rand(-10, 10), 5);
    UI.banner('Caught the Lantern Thief', 'A reliquary spills from its lantern', 'gold', 2.2);
  }

  if (e.elite) {
    G.stats.elites++;
    Progress.unlock('elite');
    dropPickup('chest', e.x, e.y);
    G.slowmo = 0.5;
    hitstop(0.1);
    addShake(0.6);
    screenFlash(COLORS.gold, 0.25);
    emitRing(e.x, e.y, 40, COLORS.gold, 160);
    addLightFlash(e.x, e.y, 200, 'gold', 0.8);
    Sfx.play('eliteDie');
    UI.banner(e.def.title + ' Vanquished', 'Its reliquary lies open', 'gold', 2.2);
    if (P.covenants.has('executioner')) triggerFrenzy();
  }

  if (P.covenants.has('executioner') && G.stats.kills % 150 === 0) triggerFrenzy();

  if (e.bleedT > 0 && P.covenants.has('crimsonHarvest') && G.time - (G.harvestT || 0) > 0.07) {
    G.harvestT = G.time;
    const dps = Math.max(e.bleedDps, 4);
    const hits = explodeAt(e.x, e.y, 34 * P.s.area, (14 + dps * 2) * P.s.might, { src: 'crimsonHarvest', bleed: dps, noCrit: true });
    G.stats.harvestKills += hits;
    Sfx.play('explode');
  }
}

function triggerFrenzy() {
  G.buffs.frenzy = 8;
  Sfx.play('frenzy');
  screenFlash(COLORS.gold, 0.15);
  addFx({ type: 'text', x: G.player.x, y: G.player.y - 24, text: 'FRENZY', color: COLORS.gold, life: 1.2, max: 1.2 });
}

// ---- Player projectiles -------------------------------------------------------------
function spawnProj(o) {
  const p = G.projs.get();
  if (!p) return null;
  p.kind = o.kind; p.x = o.x; p.y = o.y; p.ang = o.ang;
  p.vx = Math.cos(o.ang) * o.speed; p.vy = Math.sin(o.ang) * o.speed; p.speed = o.speed;
  p.dmg = o.dmg; p.inf = o.pierce < 0; p.pierce = Math.max(0, o.pierce); p.life = o.life; p.max = o.life;
  p.r = o.r; p.knock = o.knock || 0; p.src = o.src; p.homing = o.homing || 0; p.explode = o.explode || 0;
  p.heavy = !!o.heavy; p.scale = o.scale || 1; p.spin = 0; p.hits.length = 0; p.firstHit = false;
  return p;
}

function updateProjs(dt) {
  G.projs.forEach(p => {
    p.life -= dt;
    if (p.homing) {
      const t = nearestEnemy(p.x, p.y, 160);
      if (t) {
        const want = Math.atan2(t.y - p.y, t.x - p.x);
        p.ang += clamp(angleDiff(p.ang, want), -p.homing * dt, p.homing * dt);
        p.vx = Math.cos(p.ang) * p.speed; p.vy = Math.sin(p.ang) * p.speed;
      }
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === 'slab') {
      p.spin += dt * 2;
      if (Math.random() < dt * 30) Parts.emit(p.x + rand(-p.r, p.r), p.y + rand(-p.r, p.r), rand(-10, 10), rand(-10, 10), 0.4, rand(1, 2.5), pick(['#8a8590', '#6a6470']), { drag: 4 });
    } else if (p.kind === 'spear' && Math.random() < dt * 40) {
      Parts.emit(p.x, p.y, -p.vx * 0.1, -p.vy * 0.1, 0.25, 1, COLORS.cyan, { add: 1, drag: 4 });
    } else if (p.kind === 'crescent' && Math.random() < dt * 30) {
      Parts.emit(p.x, p.y, -p.vx * 0.05, -p.vy * 0.05, 0.3, 1.5, '#d9fffb', { add: 1, drag: 4 });
    }
    const n = queryEnemies(p.x, p.y, p.r);
    for (let i = 0; i < n; i++) {
      const e = QBUF[i];
      if (p.hits.includes(e.uid)) continue;
      p.hits.push(e.uid);
      damageEnemy(e, p.dmg, { src: p.src, kb: p.knock, fromX: p.x - p.vx, fromY: p.y - p.vy, heavy: p.heavy });
      if (p.heavy && !p.firstHit) {
        p.firstHit = true;
        if (G.time - (G.heavyT || 0) > 0.3) { G.heavyT = G.time; hitstop(0.035); addShake(0.12); Sfx.play('graveHit'); }
        emitDust(e.x, e.y, 5);
      } else if (p.kind === 'dagger') emitSparks(e.x, e.y - 2, 2, COLORS.bone, 60);
      if (!p.inf) {
        if (p.pierce <= 0) { p.life = 0; break; }
        p.pierce--;
      }
    }
    const outside = p.x < -300 || p.y < -300 || p.x > ARENA.w + 300 || p.y > ARENA.h + 300;
    if (p.life <= 0 || outside) {
      if (p.explode && !outside) {
        explodeAt(p.x, p.y, p.explode, p.dmg * 0.6, { src: p.src, kb: 120, color: COLORS.bone, light: 'warm' });
        emitDust(p.x, p.y, 12);
        Sfx.play('graveHit');
      }
      p.active = false;
    }
  });
}

// ---- Enemy projectiles ----------------------------------------------------------------
function spawnShot(o) {
  const s = G.shots.get();
  if (!s) return null;
  s.x = o.x; s.y = o.y; s.vx = Math.cos(o.ang) * o.speed; s.vy = Math.sin(o.ang) * o.speed;
  s.dmg = o.dmg; s.r = o.r; s.life = o.life; s.kind = o.kind || 'orb'; s.t = 0;
  return s;
}

function updateShots(dt) {
  const P = G.player;
  G.shots.forEach(s => {
    s.life -= dt; s.t += dt;
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.life <= 0) { s.active = false; return; }
    const rr = s.r + P.r - 1.5;
    if (!P.dead && dist2(s.x, s.y, P.x, P.y) < rr * rr && P.inv <= 0 && P.dashT <= 0) {
      hurtPlayer(s.dmg, s.x, s.y);
      emitSparks(s.x, s.y, 6, COLORS.crimson, 60);
      s.active = false;
    }
  });
}

// ---- Sweeps (scythe arcs), rings (shockwaves), sigils, pools -------------------------
function addSweep(o) {
  G.sweeps.push(Object.assign({ t: -(o.delay || 0), hit: [] }, o));
}

function updateSweeps(dt) {
  const P = G.player;
  for (const s of G.sweeps) {
    s.t += dt;
    if (s.t < 0) continue;
    const p = Math.min(1, s.t / s.dur);
    const prog = Ease.outCubic(p) * s.arc;
    const start = s.dir - (s.side * s.arc) / 2;
    s.cur = start + s.side * prog;
    s.start = start;
    const n = queryEnemies(P.x, P.y, s.r);
    for (let i = 0; i < n; i++) {
      const e = QBUF[i];
      if (s.hit.includes(e.uid)) continue;
      const a = Math.atan2(e.y - P.y, e.x - P.x);
      let rel = angleDiff(start, a) * s.side;
      if (rel < 0) rel += TAU;
      if (rel <= prog + 0.15 || s.arc >= TAU - 0.01 && p >= 1) {
        s.hit.push(e.uid);
        damageEnemy(e, s.dmg, { src: s.src, kb: s.knock, fromX: P.x, fromY: P.y });
        emitSparks(e.x, e.y - 3, 2, s.evolved ? COLORS.cyan : COLORS.bone, 70);
      }
    }
  }
  G.sweeps = G.sweeps.filter(s => s.t < s.dur + 0.12);
}

function addRing(o) { G.rings.push(Object.assign({ r: 0, hit: [] }, o)); }

function updateRings(dt) {
  const P = G.player;
  for (const g of G.rings) {
    if (g.follow) { g.x = P.x; g.y = P.y; }
    g.r = Math.min(g.maxR, g.r + g.speed * dt);
    const n = queryEnemies(g.x, g.y, g.r);
    for (let i = 0; i < n; i++) {
      const e = QBUF[i];
      if (g.hit.includes(e.uid)) continue;
      g.hit.push(e.uid);
      if (g.purge) { if (!e.boss) silentKill(e); continue; }
      const iron = g.bell && P.covenants.has('ironRequiem');
      damageEnemy(e, g.dmg * (iron ? 4 : 1), { src: g.src, kb: g.knock * (iron ? 0.4 : 1), fromX: g.x, fromY: g.y, heavy: g.bell });
      if (g.bell) {
        if (!e.boss) e.stunT = Math.max(e.stunT, g.echo ? 0.6 : 1.1);
        if (e.elite || e.boss || iron) e.exposedT = Math.max(e.exposedT, 5);
        if (P.covenants.has('funeralCurse')) e.cursedT = 8;
        if (e.boss) Boss.onBell(e);
        // Interrupt telegraphed attacks
        for (const t of G.telegraphs) if (t.owner === e && !e.boss) t.cancel = true;
        if (e.def.behavior === 'charger' || e.def.behavior === 'flayer' || e.def.behavior === 'ranged') { e.state = 'move'; e.cd = Math.max(e.cd, 1.5); }
        if (e.def.behavior === 'warden' && e.state === 'slam') { e.state = 'move'; e.cd = 2.5; }
      }
    }
  }
  G.rings = G.rings.filter(g => g.r < g.maxR);
}

// Removes an enemy without drops (finale purge).
function silentKill(e) {
  if (e.dead) return;
  e.dead = true;
  if (G.corpses.length < 160) G.corpses.push({ spr: Assets.sprites[e.def.sprite], x: e.x, y: e.y, flip: e.face < 0, t: 0, big: e.elite });
  emitAsh(e.x, e.y, 3);
}

function updateSigils(dt) {
  const P = G.player;
  for (const s of G.sigils) {
    s.t += dt;
    s.rot += dt * 2;
    if (s.t >= s.arm) {
      const n = queryEnemies(s.x, s.y, s.r);
      const list = QBUF.slice(0, n);
      let healed = 0;
      for (const e of list) {
        damageEnemy(e, s.dmg, { src: s.src, kb: 50, fromX: s.x, fromY: s.y, bleed: s.bleed });
        if (s.heal && healed < 4) healed++;
      }
      if (healed) healPlayer(healed * s.heal);
      addFx({ type: 'burst', x: s.x, y: s.y, r: s.r, life: 0.32, max: 0.32, color: COLORS.crimson, sigil: true });
      addLightFlash(s.x, s.y, s.r * 2.6, 'crimson', 0.3);
      emitBlood(s.x, s.y, 6);
      emitSparks(s.x, s.y, 10, COLORS.crimsonHot, s.r * 3);
      if (s.evolved) G.pools.push({ x: s.x, y: s.y, r: s.r * 0.8, t: 2.4, max: 2.4, dps: 10 * P.s.might, bleed: s.bleed, tick: 0, kind: 'blood' });
      addShake(0.08);
      Sfx.play('sigilBoom');
      if (s.dbl && !s.second) { s.second = true; s.t = s.arm - 0.35; }
      else s.done = true;
    }
  }
  G.sigils = G.sigils.filter(s => !s.done);
}

function updatePools(dt) {
  for (const p of G.pools) {
    p.t -= dt;
    p.tick -= dt;
    if (p.tick <= 0) {
      p.tick = 0.4;
      const n = queryEnemies(p.x, p.y, p.r);
      for (let i = 0; i < n; i++) {
        const e = QBUF[i];
        if (G.time - e.poolT < 0.35) continue;
        e.poolT = G.time;
        damageEnemy(e, p.dps * 0.4, { src: p.kind === 'moon' ? 'moonlitStride' : 'crimsonCathedral', noCrit: true, dot: true, bleed: p.bleed });
      }
    }
  }
  G.pools = G.pools.filter(p => p.t > 0);
}

// ---- Telegraphs (enemy attack warnings) ------------------------------------------------
function updateTelegraphs(dt) {
  for (const t of G.telegraphs) {
    if (t.owner && (t.owner.dead || (t.owner.stunT > 0 && !t.owner.boss))) t.cancel = true;
    if (t.cancel) { t.gone = true; if (t.x !== undefined) emitSparks(t.x, t.y, 8, COLORS.cyan, 60); continue; }
    if (t.follow && t.owner) { t.x = t.owner.x; t.y = t.owner.y; t.ang = t.type === 'lane' ? t.owner.aimA : Math.atan2(G.player.y - t.owner.y, G.player.x - t.owner.x); }
    t.t += dt;
    if (t.t >= t.dur) { t.gone = true; if (t.done) t.done(t); }
  }
  G.telegraphs = G.telegraphs.filter(t => !t.gone);
}

// ---- Pickups ----------------------------------------------------------------------------
function dropGem(x, y, v) {
  G.stats.xpDropped += v;
  // A crowded floor folds new shards into a nearby one so the field stays readable.
  if (G.gems.countActive() > 200) {
    let near = null, bd = 50 * 50;
    G.gems.forEach(o => { if (o.state === 0) { const d = dist2(o.x, o.y, x, y); if (d < bd) { bd = d; near = o; } } });
    if (near) { near.v += v; near.tier = near.v >= 12 ? 2 : near.v >= 3 ? 1 : 0; return; }
  }
  let g = G.gems.get();
  if (!g) {
    // Pool full: fold the value into a random existing shard.
    const items = G.gems.items;
    g = items[(Math.random() * items.length) | 0];
    g.v += v; g.tier = g.v >= 12 ? 2 : g.v >= 3 ? 1 : 0;
    return;
  }
  g.x = x + rand(-2, 2); g.y = y + rand(-2, 2); g.v = v; g.tier = v >= 12 ? 2 : v >= 3 ? 1 : 0;
  g.state = 0; g.spd = 0; g.t = rand(10); g.pop = 0.25;
  const a = rand(TAU); g.vx = Math.cos(a) * 30; g.vy = Math.sin(a) * 30;
}

function updateGems(dt) {
  const P = G.player, mr = P.s.magnet;
  const mr2 = mr * mr;
  G.gems.forEach(g => {
    g.t += dt;
    if (g.pop > 0) { g.pop -= dt; g.x += g.vx * dt; g.y += g.vy * dt; g.vx *= 0.9; g.vy *= 0.9; }
    const dx = P.x - g.x, dy = P.y - 2 - g.y;
    const d2 = dx * dx + dy * dy;
    if (g.state === 0 && d2 < mr2 && !P.dead) { g.state = 1; g.spd = -40; }
    if (g.state === 1) {
      g.spd = Math.min(560, g.spd + 900 * dt);
      const d = Math.sqrt(d2) || 1;
      g.x += (dx / d) * g.spd * dt; g.y += (dy / d) * g.spd * dt;
      if (d < 7) {
        g.active = false;
        gainXp(g.v);
        Sfx.play('xp');
        if (P.covenants.has('soulMagnet')) {
          P.soulCount++;
          if (P.soulCount >= 60) {
            P.soulCount = 0;
            addRing({ x: P.x, y: P.y, maxR: 125 * P.s.area, speed: 420, dmg: (40 + P.level * 2) * P.s.might, knock: 140, src: 'soulMagnet', color: COLORS.gold, width: 4, follow: true });
            addLightFlash(P.x, P.y, 260, 'gold', 0.5);
            Sfx.play('nova');
          }
        }
      }
    }
  });
}

function dropEcho(x, y, v) {
  G.echoes.push({ x, y, v, t: 0, state: 0, spd: 0, ph: rand(TAU) });
}

function updateEchoes(dt) {
  const P = G.player;
  for (const e of G.echoes) {
    e.t += dt;
    const dx = P.x - e.x, dy = P.y - 4 - e.y, d = Math.hypot(dx, dy) || 1;
    if (e.state === 0 && d < 30 + P.s.magnet * 0.45 && !P.dead) e.state = 1;
    if (e.state === 1) {
      e.spd = Math.min(420, e.spd + 700 * dt);
      e.x += (dx / d) * e.spd * dt; e.y += (dy / d) * e.spd * dt;
      if (d < 8) {
        e.done = true;
        const gain = e.v * P.s.resGain;
        P.res = Math.min(100, P.res + gain);
        G.bellPulse = 0.35;
        Sfx.play('echo');
        emitSparks(P.x, P.y - 6, 6, COLORS.cyan, 50);
      }
    } else {
      e.y += Math.sin(e.t * 3 + e.ph) * 6 * dt;
      if (Math.random() < dt * 10) Parts.emit(e.x + rand(-2, 2), e.y + rand(-2, 2), rand(-4, 4), rand(-18, -6), 0.5, 1, COLORS.cyan, { add: 1, drag: 1 });
    }
    if (e.t > 30) e.done = true;
  }
  G.echoes = G.echoes.filter(e => !e.done);
}

function dropPickup(type, x, y) {
  G.pickups.push({ type, x, y, t: 0 });
}

function updatePickups(dt) {
  const P = G.player;
  for (const p of G.pickups) {
    p.t += dt;
    if (p.type !== 'chest' && p.t > 45) { p.done = true; continue; }
    const d = dist(P.x, P.y, p.x, p.y);
    if (p.type !== 'chest' && d < P.s.magnet * 0.5) { p.x += (P.x - p.x) * damp(6, dt); p.y += (P.y - p.y) * damp(6, dt); }
    if (d < 12 && !P.dead) {
      p.done = true;
      if (p.type === 'chalice') { healPlayer(30); Sfx.play('heal'); emitSparks(P.x, P.y - 4, 12, COLORS.crimsonHot, 50); }
      else if (p.type === 'chime') {
        G.gems.forEach(g => { g.state = 1; g.spd = 0; });
        Sfx.play('bellReady');
        screenFlash(COLORS.gold, 0.12);
        addFx({ type: 'text', x: P.x, y: P.y - 22, text: 'The chime calls every shard', color: COLORS.gold, life: 1.4, max: 1.4 });
      } else if (p.type === 'chest') {
        G.stats.chests++;
        Sfx.play('chest');
        emitRing(p.x, p.y, 30, COLORS.gold, 120);
        addLightFlash(p.x, p.y, 160, 'gold', 0.6);
        G.pendingChest = (G.pendingChest || 0) + 1;
      }
    }
  }
  G.pickups = G.pickups.filter(p => !p.done);
}

// ---- Experience and upgrades ------------------------------------------------------------
function gainXp(v) {
  const P = G.player;
  P.xp += v * P.s.growth;
  G.stats.xp += v;
  while (P.xp >= P.xpNext) {
    P.xp -= P.xpNext;
    P.level++;
    P.xpNext = xpForLevel(P.level);
    G.levelQueue++;
    G.stats.peakLevel = P.level;
  }
}

const BASE_WEAPONS = ['dagger', 'scythe', 'orbs', 'grave', 'chain', 'sigil'];
function ownsWeaponLine(P, base) { return P.weapons.some(w => w.id === base || (WEAPONS[w.id].base === base)); }

function buildOptions(mode) {
  const P = G.player;
  const cands = [];
  const evoCands = [];
  for (const w of P.weapons) {
    const ev = EVOLUTIONS[w.id];
    if (ev && w.lv >= WEAPONS[w.id].max && P.passiveLv(ev.pair) > 0) evoCands.push({ kind: 'evolution', id: ev.into, from: w.id, w: 1000 });
  }
  if (mode === 'chest' && evoCands.length) return [evoCands[0]];
  cands.push(...evoCands);

  const pairsWanted = new Set();
  for (const w of P.weapons) { const ev = EVOLUTIONS[w.id]; if (ev) pairsWanted.add(ev.pair); }

  for (const w of P.weapons) {
    const def = WEAPONS[w.id];
    if (!def.evolved && w.lv < def.max) cands.push({ kind: 'weaponUp', id: w.id, w: 10 + (w.lv >= 3 ? 2 : 0) });
  }
  if (P.weapons.length < 4) {
    for (const id of BASE_WEAPONS) if (!ownsWeaponLine(P, id)) cands.push({ kind: 'weaponNew', id, w: P.weapons.length < 2 ? 8 : 5 });
  }
  for (const id of P.passiveOrder) {
    if (P.passives[id] < PASSIVES[id].max) cands.push({ kind: 'passiveUp', id, w: 7 * (pairsWanted.has(id) ? 1.4 : 1) });
  }
  if (P.passiveOrder.length < 4) {
    for (const id of Object.keys(PASSIVES)) {
      if (P.passives[id]) continue;
      let w = 4.5;
      if (pairsWanted.has(id)) {
        w *= 2.2;
        if (P.weapons.some(x => EVOLUTIONS[x.id] && EVOLUTIONS[x.id].pair === id && x.lv >= WEAPONS[x.id].max)) w *= 2;
      }
      cands.push({ kind: 'passiveNew', id, w });
    }
  }
  if (P.level >= 3 || mode === 'chest') {
    for (const [id, c] of Object.entries(COVENANTS)) {
      if (P.covenants.has(id) || !c.req(P)) continue;
      cands.push({ kind: 'covenant', id, w: mode === 'chest' ? 14 : (c.tag === 'Synergy' ? 3.2 : 2.2) });
    }
  }

  const out = [];
  let covenants = 0;
  const pool = cands.slice();
  while (out.length < 3 && pool.length) {
    const c = weightedPick(pool, x => (x.kind === 'covenant' && covenants >= (mode === 'chest' ? 2 : 1) ? 0 : x.w));
    if (!c) break;
    pool.splice(pool.indexOf(c), 1);
    if (c.kind === 'covenant') covenants++;
    out.push(c);
  }
  const relics = shuffle([{ kind: 'relic', id: 'restore' }, { kind: 'relic', id: 'resonance' }, { kind: 'relic', id: 'might' }]);
  while (out.length < 3) out.push(relics.pop());
  return out;
}

const RELICS = {
  restore: { name: 'Blood of the Saint', icon: 'restore', text: 'Restore 40% of your Max HP.' },
  resonance: { name: 'Captured Echo', icon: 'resonance', text: 'Gain 60 Resonance immediately.' },
  might: { name: 'Martyr\'s Fang', icon: 'might', text: '+5% damage for the rest of the run.' },
};

function describeOption(o) {
  const P = G.player;
  const d = { kind: o.kind, id: o.id, chips: [] };
  if (o.kind === 'weaponNew' || o.kind === 'weaponUp') {
    const def = WEAPONS[o.id];
    const lv = o.kind === 'weaponNew' ? 1 : P.weapons.find(w => w.id === o.id).lv + 1;
    Object.assign(d, { name: def.name, icon: def.icon, rarity: o.kind === 'weaponNew' ? 'rare' : 'common', tag: 'Weapon', level: o.kind === 'weaponNew' ? 'New' : 'Lv ' + (lv - 1) + ' → ' + lv, text: def.desc[lv - 1], sub: def.role, maxLv: def.max, curLv: lv });
    const ev = EVOLUTIONS[o.id];
    if (ev) d.chips.push({ text: 'Evolves with ' + PASSIVES[ev.pair].name + (P.passiveLv(ev.pair) ? ' ✓' : ''), cls: P.passiveLv(ev.pair) ? 'chip-evo' : 'chip-dim' });
  } else if (o.kind === 'passiveNew' || o.kind === 'passiveUp') {
    const def = PASSIVES[o.id];
    const lv = (P.passives[o.id] || 0) + 1;
    Object.assign(d, { name: def.name, icon: def.icon, rarity: 'common', tag: 'Passive', level: lv === 1 ? 'New' : 'Lv ' + (lv - 1) + ' → ' + lv, text: def.text, maxLv: def.max, curLv: lv });
    for (const [wid, ev] of Object.entries(EVOLUTIONS)) {
      if (ev.pair === o.id && P.hasWeapon(wid)) d.chips.push({ text: 'Evolves ' + WEAPONS[wid].name, cls: 'chip-evo' });
    }
  } else if (o.kind === 'covenant') {
    const c = COVENANTS[o.id];
    Object.assign(d, { name: c.name, icon: c.icon, rarity: 'covenant', tag: c.tag === 'Bell' ? 'Bell Covenant' : 'Covenant', level: c.tag, text: c.text });
    if (c.tag === 'Synergy') d.chips.push({ text: 'Synergy with your build', cls: 'chip-syn' });
    if (c.tag === 'Risk') d.chips.push({ text: 'High risk, high reward', cls: 'chip-risk' });
  } else if (o.kind === 'evolution') {
    const def = WEAPONS[o.id];
    Object.assign(d, { name: def.name, icon: def.icon, rarity: 'evolution', tag: 'Evolution', level: WEAPONS[o.from].name + ' ascends', text: def.evoDesc, sub: def.role });
  } else if (o.kind === 'relic') {
    const r = RELICS[o.id];
    Object.assign(d, { name: r.name, icon: r.icon, rarity: 'relic', tag: 'Relic', level: 'Consumable', text: r.text });
  }
  return d;
}

function applyOption(o) {
  const P = G.player;
  switch (o.kind) {
    case 'weaponNew':
      P.weapons.push({ id: o.id, lv: 1, t: 0.2 });
      if (P.weapons.length >= 4) Progress.unlock('fullChoir');
      break;
    case 'weaponUp': P.weapons.find(w => w.id === o.id).lv++; break;
    case 'passiveNew': P.passives[o.id] = 1; P.passiveOrder.push(o.id); break;
    case 'passiveUp': P.passives[o.id]++; break;
    case 'covenant': P.covenants.add(o.id); break;
    case 'evolution': {
      const w = P.weapons.find(x => x.id === o.from);
      if (!w) break;
      for (const k of Object.keys(w)) delete w[k];
      Object.assign(w, { id: o.id, lv: 5, t: 0.3 });
      G.stats.evolutions++;
      Progress.unlock('evolve');
      if (G.stats.evolutions >= 2) Progress.unlock('twoEvo');
      G.pendingEvolution = o.id;
      break;
    }
    case 'relic':
      if (o.id === 'restore') healPlayer(P.s.maxHp * 0.4);
      if (o.id === 'resonance') P.res = Math.min(100, P.res + 60);
      if (o.id === 'might') G.stats.relicMight += 0.05;
      break;
  }
  recomputeStats();
}

function celebrateEvolution(id) {
  const P = G.player;
  screenFlash(COLORS.cyan, 0.55);
  hitstop(0.1);
  addShake(0.5);
  emitRing(P.x, P.y, 60, COLORS.cyan, 200);
  emitRing(P.x, P.y, 30, COLORS.gold, 120);
  addLightFlash(P.x, P.y, 300, 'cyan', 1.2);
  addRing({ x: P.x, y: P.y, maxR: 140, speed: 360, dmg: 60 * P.s.might, knock: 300, src: id, color: COLORS.cyan, width: 4 });
  Sfx.play('evolve');
  UI.banner('Evolution: ' + WEAPONS[id].name, WEAPONS[id].evoDesc, 'cyan', 3.2);
}

// ---- Effects bookkeeping ------------------------------------------------------------------
function updateFx(dt) {
  for (const f of G.fx) {
    if (f.type === 'delay') { f.t -= dt; if (f.t <= 0) { f.fn(); f.done = true; } continue; }
    f.life -= dt;
    if (f.type === 'text') f.y -= dt * 14;
    if (f.life <= 0) f.done = true;
  }
  G.fx = G.fx.filter(f => !f.done);
  for (const c of G.corpses) c.t += dt;
  G.corpses = G.corpses.filter(c => c.t < (c.big ? 0.9 : 0.42));
  for (const l of G.lights) l.t -= dt;
  G.lights = G.lights.filter(l => l.t > 0);
  G.numbers.forEach(n => { n.t += dt; n.y += n.vy * dt; n.vy *= Math.exp(-3 * dt); if (n.t > 0.75) n.active = false; });
}

// ---- Main simulation step -------------------------------------------------------------------
function updateGame(dt) {
  G.time += dt;
  World.stainsThisFrame = 0;
  if (G.buffs.frenzy > 0) G.buffs.frenzy -= dt;
  if (G.buffs.fury > 0) G.buffs.fury -= dt;
  if (G.bellPulse > 0) G.bellPulse -= dt;
  G.hints.t += dt;

  updatePlayer(dt);
  if (!G.player.dead) for (const w of G.player.weapons) WEAPONS[w.id].update(w, dt, G.player);
  Director.update(dt);
  updateEnemies(dt);
  updateProjs(dt);
  updateShots(dt);
  updateSweeps(dt);
  updateRings(dt);
  updateSigils(dt);
  updatePools(dt);
  updateTelegraphs(dt);
  Boss.updateTolls(dt);
  updateGems(dt);
  updateEchoes(dt);
  updatePickups(dt);
  Parts.update(dt);
  updateFx(dt);
}

function initPools() {
  G.projs = new Pool(() => ({ hits: [] }), 420);
  G.shots = new Pool(() => ({}), 320);
  G.gems = new Pool(() => ({}), 520);
  G.numbers = new Pool(() => ({}), 110);
  G.grid = new SpatialGrid(-300, -300, ARENA.w + 300, ARENA.h + 300, 32, 1024);
}
