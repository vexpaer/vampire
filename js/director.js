'use strict';
// ---------------------------------------------------------------------------
// Wave director: a time-keyed spawn stream plus authored set pieces
// (processions, encirclements, flocks, elites) and the finale trigger.
// ---------------------------------------------------------------------------

const Director = {
  acc: 0, eventIdx: 0, phase: 0, intensity: -1, mood: 0, moodTarget: 0, bossStarted: false,
  lastElite: null, eliteOrder: [],

  reset() {
    this.acc = 0; this.eventIdx = 0; this.phase = 0; this.intensity = -1;
    this.mood = 0; this.moodTarget = 0; this.bossStarted = false;
    this.eliteOrder = shuffle(['warden', 'matriarch', 'flayer']);
    this.addT = 0;
  },

  phaseAt(t) {
    let p = 0;
    for (let i = 0; i < PHASES.length; i++) if (t >= PHASES[i].t) p = i;
    return p;
  },

  rateAt(t) {
    for (let i = 0; i < SPAWN_KEYS.length - 1; i++) {
      const a = SPAWN_KEYS[i], b = SPAWN_KEYS[i + 1];
      if (t >= a.t && t < b.t) return lerp(a.rate, b.rate, (t - a.t) / (b.t - a.t));
    }
    return 0;
  },

  mixAt(t) {
    let m = SPAWN_KEYS[0].mix;
    for (const k of SPAWN_KEYS) if (t >= k.t) m = k.mix;
    return m;
  },

  update(dt) {
    const t = G.time;
    this.phase = this.phaseAt(t);
    const inten = this.bossStarted ? 4 : t < 30 ? 0 : t < 90 ? 1 : t < 180 ? 2 : t < 300 ? 3 : 4;
    if (inten !== this.intensity && !this.bossStarted) { this.intensity = inten; Sfx.Music.setIntensity(inten); }
    this.mood = approach(this.mood, this.moodTarget, dt * (G.victory ? 1.6 : 0.35));

    while (this.eventIdx < EVENTS.length && EVENTS[this.eventIdx].t <= t) this.runEvent(EVENTS[this.eventIdx++]);

    if (!this.bossStarted) {
      let rate = this.rateAt(t);
      // Never let the courtyard feel empty: catch up when the population is thin.
      const minPop = 15 + t * 0.6;
      const pop = G.enemies.length;
      if (pop < minPop) rate *= 1.5 + 1.5 * (1 - pop / minPop);
      // Soft cap: a struggling build faces a crowded screen, never an impossible one.
      else if (pop > 170) rate *= clamp(1 - (pop - 170) / 160, 0.2, 1);
      this.acc += rate * dt;
      let guard = 0;
      while (this.acc >= 1 && guard++ < 20) { this.acc -= 1; this.spawnFromMix(); }
    } else if (G.boss && !G.boss.dead && Boss.state !== 'intro' && !G.victory) {
      // A thin stream of the faithful keeps experience flowing during the duel.
      this.addT -= dt;
      if (this.addT <= 0 && G.enemies.length < 70) {
        this.addT = Boss.phase === 2 ? 0.7 : 1.1;
        const type = weightedPick(['husk', 'gloomwing', 'acolyte'], k => (k === 'husk' ? 3 : k === 'gloomwing' ? 1.5 : Boss.phase === 2 ? 1 : 0.5));
        const p = this.spawnPos(30);
        spawnEnemy(type, p.x, p.y);
      }
    }
  },

  spawnFromMix() {
    const mix = this.mixAt(G.time);
    const type = weightedPick(Object.keys(mix), k => mix[k]);
    const group = type === 'husk' ? randi(2, 4) : type === 'gloomwing' ? randi(2, 3) : type === 'penitent' ? randi(1, 2) : 1;
    this.acc -= group - 1;
    const p = this.spawnPos(30);
    for (let i = 0; i < group; i++) spawnEnemy(type, p.x + rand(-14, 14), p.y + rand(-14, 14));
  },

  // A point just outside the visible screen, inside the extended arena and
  // never inside scenery. Biased toward where the player is heading.
  spawnPos(margin = 30) {
    const P = G.player, v = G.view;
    const cx = G.cam.x + v.w / 2, cy = G.cam.y + v.h / 2;
    const hw = v.w / 2 + margin, hh = v.h / 2 + margin;
    for (let tries = 0; tries < 14; tries++) {
      let x, y;
      if (P.moving && Math.random() < 0.45) {
        const a = P.aim + rand(-0.75, 0.75);
        const ca = Math.cos(a), sa = Math.sin(a);
        const tt = Math.min(Math.abs(ca) > 1e-3 ? hw / Math.abs(ca) : 1e9, Math.abs(sa) > 1e-3 ? hh / Math.abs(sa) : 1e9);
        x = cx + ca * tt; y = cy + sa * tt;
      } else {
        let r = Math.random() * (hw * 4 + hh * 4);
        if (r < hw * 2) { x = cx - hw + r; y = cy - hh; }
        else if ((r -= hw * 2) < hw * 2) { x = cx - hw + r; y = cy + hh; }
        else if ((r -= hw * 2) < hh * 2) { x = cx - hw; y = cy - hh + r; }
        else { r -= hh * 2; x = cx + hw; y = cy - hh + r; }
      }
      if (x < -110 || x > ARENA.w + 110 || y < -110 || y > ARENA.h + 110) continue;
      if (y < 400 && x > 800 && x < 1600) continue; // behind the cathedral
      if (World.blocked(x, y, 6)) continue;
      return { x, y };
    }
    return { x: clamp(cx + (Math.random() < 0.5 ? -hw : hw), 0, ARENA.w), y: clamp(cy + rand(-hh, hh), 420, ARENA.h) };
  },

  // Enemies rising from the ground near the player get a visible emergence
  // window so nothing ever appears on top of you without warning.
  summon(type, x, y, emerge = 0.75) {
    x = clamp(x, ARENA.pad, ARENA.w - ARENA.pad); y = clamp(y, ARENA.top - 40, ARENA.h - ARENA.pad);
    if (World.blocked(x, y, 4)) return null;
    const P = G.player;
    if (dist(x, y, P.x, P.y) < 28) return null;
    if (G.enemies.length >= MAX_ENEMIES + 30) return null;
    const e = spawnEnemy(type, x, y, { emerge, force: true });
    if (e) addFx({ type: 'rise', x, y, life: emerge + 0.2, max: emerge + 0.2 });
    return e;
  },

  runEvent(ev) {
    const P = G.player;
    if (this.bossStarted && ev.type !== 'boss') return;
    switch (ev.type) {
      case 'banner': {
        const ph = PHASES[ev.phase];
        UI.banner(ph.name, ph.sub, ev.phase === 3 ? 'crimson' : 'bone', 3);
        Sfx.play('banner');
        if (ev.phase === 3) { this.moodTarget = 1; screenFlash('#000', 0.35); }
        break;
      }
      case 'procession': {
        const side = chance(0.5) ? 1 : -1;
        const sx = G.cam.x + G.view.w / 2 - side * (G.view.w / 2 + 40);
        for (let i = 0; i < ev.n; i++) {
          const e = spawnEnemy(ev.kind, sx - side * (i >> 1) * 14, P.y - 20 + (i % 2) * 22 + rand(-3, 3));
          if (e) { e.marchT = 7; e.mdx = side; e.mdy = 0; }
        }
        break;
      }
      case 'flock': {
        const make = side => {
          const a = rand(TAU);
          const ox = P.x + Math.cos(a) * 330, oy = P.y + Math.sin(a) * 230;
          const dx = P.x - ox, dy = P.y - oy, d = Math.hypot(dx, dy) || 1;
          for (let i = 0; i < ev.n; i++) {
            const e = spawnEnemy('gloomwing', ox + rand(-26, 26) - (dx / d) * i * 5, oy + rand(-26, 26) - (dy / d) * i * 5);
            if (e) { e.marchT = 5.5; e.mdx = dx / d; e.mdy = dy / d; e.speed *= 1.15; }
          }
          void side;
        };
        make(1);
        if (ev.both) G.fx.push({ type: 'delay', t: 1.2, fn: () => make(-1) });
        Sfx.play('telegraph');
        break;
      }
      case 'ring': {
        const gapA = rand(TAU), gapB = gapA + Math.PI + rand(-0.5, 0.5);
        const inGap = a => Math.abs(angleDiff(a, gapA)) < 0.36 || Math.abs(angleDiff(a, gapB)) < 0.36;
        for (let i = 0; i < ev.n; i++) {
          const a = (i / ev.n) * TAU;
          if (inGap(a)) continue;
          this.summon(ev.kind, P.x + Math.cos(a) * ev.r, P.y + Math.sin(a) * ev.r * 0.8, 1.0);
        }
        if (ev.outer) for (let i = 0; i < ev.outerN; i++) {
          const a = (i / ev.outerN) * TAU + 0.2;
          if (inGap(a)) continue;
          this.summon(ev.outer, P.x + Math.cos(a) * (ev.r + 50), P.y + Math.sin(a) * (ev.r + 50) * 0.8, 1.2);
        }
        UI.banner('', 'The dead rise around you. Find the gap.', 'crimson', 1.8, true);
        Sfx.play('telegraph');
        break;
      }
      case 'thief': {
        const p = this.spawnPos(10);
        spawnEnemy('thief', p.x, p.y, { force: true });
        UI.banner('', 'A Lantern Thief flickers at the edge of sight', 'gold', 2.2, true);
        break;
      }
      case 'elite': {
        const type = this.eliteOrder[(this.eliteIdx = ((this.eliteIdx || 0) + 1)) % 3];
        const p = this.spawnPos(20);
        const e = spawnEnemy(type, p.x, p.y, { force: true });
        if (e && ev.escort) {
          for (let i = 0; i < 6; i++) spawnEnemy(chance(0.5) ? 'penitent' : 'hound', p.x + rand(-30, 30), p.y + rand(-30, 30), { force: true });
        }
        UI.banner('An Elite Approaches', ENEMIES[type].title, 'crimson', 2.4);
        Sfx.play('elite');
        break;
      }
      case 'pack': {
        const p = this.spawnPos(40);
        for (let i = 0; i < ev.n; i++) spawnEnemy(ev.kind, p.x + rand(-24, 24), p.y + rand(-24, 24), { force: true });
        break;
      }
      case 'phalanx': {
        const a = rand(TAU);
        const ox = P.x + Math.cos(a) * 300, oy = P.y + Math.sin(a) * 210;
        const px = -Math.sin(a), py = Math.cos(a);
        for (let i = 0; i < ev.n; i++) {
          const off = (i - (ev.n - 1) / 2) * 20;
          const e = spawnEnemy(ev.kind, ox + px * off, oy + py * off, { force: true });
          if (e) { e.marchT = 6; e.mdx = -Math.cos(a); e.mdy = -Math.sin(a); }
        }
        UI.banner('', 'A phalanx of penitents advances', 'crimson', 1.8, true);
        break;
      }
      case 'boss': Boss.begin(); break;
    }
  },
};
