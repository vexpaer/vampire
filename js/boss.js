'use strict';
// ---------------------------------------------------------------------------
// The Hollow Archbishop. Two phases, telegraphed attacks with readable safe
// spaces, vulnerability windows after big moves, and a bell interaction:
// ringing the Last Bell during a wind-up interrupts it and staggers him.
// ---------------------------------------------------------------------------

const Boss = {
  e: null, phase: 1, state: 'none', stateT: 0, bag: [], attack: null, sub: 0, subT: 0,
  vulnT: 0, interruptCd: 0, transitionT: 0, uses: {},

  begin() {
    const P = G.player;
    Director.bossStarted = true;
    Director.moodTarget = 2;
    this.phase = 1; this.state = 'intro'; this.bag = []; this.vulnT = 0; this.interruptCd = 0; this.uses = {}; this.phaseT = 0;
    // A silent wave sweeps the courtyard clear before the duel.
    addRing({ x: P.x, y: P.y, maxR: 900, speed: 520, dmg: 0, knock: 0, src: 'purge', purge: true, color: COLORS.crimson, width: 3, follow: false });
    G.shots.clear();
    G.telegraphs.length = 0;
    screenFlash('#000', 0.6);
    Sfx.Music.stop();
    Sfx.play('bossToll');
    UI.banner('The Moon Dies', 'Something vast answers your bell', 'crimson', 1.9);
    G.fx.push({ type: 'delay', t: 2.6, fn: () => this.spawn() });
  },

  spawn() {
    const P = G.player;
    let x = clamp(P.x, 200, ARENA.w - 200), y = P.y - 120;
    if (y < ARENA.top + 30) y = P.y + 120;
    const hp = 11000 + P.level * 280;
    const e = spawnEnemy('archbishop', x, y, { force: true, emerge: 2.2 });
    e.hp = e.maxHp = hp;
    this.e = e; G.boss = e;
    this.state = 'intro'; this.stateT = 0.7;
    e.state = 'intro';
    Sfx.play('bossRoar');
    G.fx.push({ type: 'delay', t: 0.6, fn: () => { Sfx.Music.start('boss'); } });
    UI.bossTitle(ENEMIES.archbishop.title, 'Last Shepherd of the Silent Choir');
    addShake(0.5);
  },

  invulnerable(e) { return this.state === 'intro' || this.state === 'transition' || e.emerge > 0; },
  damageMul() { return this.vulnT > 0 ? 1.5 : 1; },
  // Each phase lasts long enough to show its patterns, however strong the build.
  hpFloor(e) {
    if (this.phase === 1 && this.phaseT < 16) return e.maxHp * 0.5 + 1;
    if (this.phase === 2 && this.phaseT < 16) return 1;
    return -Infinity;
  },
  telegraphing() { return this.state === 'tele'; },

  nextAttack() {
    if (!this.bag.length) {
      this.bag = this.phase === 1 ? shuffle(['charge', 'hymn', 'sanctum']) : shuffle(['charge3', 'spiral', 'procession', 'toll']);
      if (this.bag[0] === this.attack && this.bag.length > 1) this.bag.push(this.bag.shift());
    }
    return this.bag.shift();
  },

  setState(s, t) { this.state = s; this.stateT = t; this.e.state = s; },

  update(e, dt, d, dx, dy) {
    const P = G.player;
    if (this.vulnT > 0) this.vulnT -= dt;
    if (this.interruptCd > 0) this.interruptCd -= dt;
    if (this.state !== 'intro' && this.state !== 'transition') this.phaseT += dt;
    this.stateT -= dt;
    const out = { mx: 0, my: 0, spd: 0, accel: 6 };
    e.dmg = 22;

    // Phase change at half health
    if (this.phase === 1 && e.hp < e.maxHp * 0.5 && this.state !== 'transition') {
      this.phase = 2;
      this.phaseT = 0;
      this.bag = [];
      this.setState('transition', 2.6);
      G.shots.clear();
      G.telegraphs = G.telegraphs.filter(t => t.owner !== e && !t.boss);
      G.tolls.length = 0;
      Director.moodTarget = 3;
      hitstop(0.12);
      addShake(0.8);
      screenFlash(COLORS.crimson, 0.5);
      emitRing(e.x, e.y, 60, COLORS.crimson, 220);
      Sfx.play('phase');
      Sfx.play('bossRoar');
      UI.banner('The Archbishop Unmasked', 'The eclipse is complete. The choir sings for you.', 'crimson', 2.8);
      G.fx.push({ type: 'delay', t: 1.2, fn: () => {
        for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; Director.summon('gloomwing', e.x + Math.cos(a) * 60, e.y + Math.sin(a) * 60, 0.5); }
      } });
      return out;
    }

    switch (this.state) {
      case 'intro':
        if (this.stateT <= 0) this.setState('idle', 1.0);
        return out;
      case 'transition':
        e.y -= Math.sin(this.stateT * 6) * 0.2;
        if (this.stateT <= 0) this.setState('idle', 0.6);
        return out;
      case 'idle': {
        // Hover within melee reach and circle; never back away from the player.
        const want = this.phase === 2 ? 52 : 60;
        const k = Math.max(0, (d - want) / want);
        out.mx = (dx / d) * k + (-dy / d) * 0.45; out.my = (dy / d) * k + (dx / d) * 0.45;
        const l = Math.hypot(out.mx, out.my) || 1; out.mx /= l; out.my /= l;
        out.spd = (this.phase === 2 ? 58 : 44) * Math.min(1, Math.abs(k) * 2 + 0.3) + Math.max(0, d - want) * 0.5;
        // Glide in fast when the player has run far away, so the duel never stalls.
        if (d > 170) out.spd += (d - 170) * 1.1;
        if (this.stateT <= 0) this.startAttack(this.nextAttack());
        return out;
      }
      case 'winded':
        if (this.stateT <= 0) this.setState('idle', this.phase === 2 ? 0.8 : 1.2);
        return out;
    }
    return this.runAttack(e, dt, d, dx, dy, out);
  },

  startAttack(name) {
    const e = this.e;
    this.attack = name;
    this.sub = 0; this.subT = 0;
    this.uses[name] = (this.uses[name] || 0) + 1;
    const P = G.player;
    switch (name) {
      case 'charge':
      case 'charge3':
        this.charges = name === 'charge3' ? 3 : 1;
        this.beginChargeTele(name === 'charge3' ? 0.7 : 0.95);
        break;
      case 'hymn':
      case 'spiral':
        this.setState('tele', name === 'spiral' ? 0.75 : 0.9);
        G.telegraphs.push({ type: 'halo', owner: e, follow: true, t: 0, dur: this.stateT, r: 46, boss: true });
        Sfx.play('bossHymn');
        break;
      case 'sanctum':
      case 'procession':
        this.setState('tele', 0.55);
        Sfx.play('telegraph');
        break;
      case 'toll':
        this.setState('tele', 1.05);
        G.telegraphs.push({ type: 'halo', owner: e, follow: true, t: 0, dur: 1.05, r: 64, boss: true, bell: true });
        Sfx.play('telegraph');
        break;
    }
    void P;
  },

  beginChargeTele(dur) {
    const e = this.e;
    this.setState('tele', dur);
    e.aimA = Math.atan2(G.player.y - e.y, G.player.x - e.x);
    G.telegraphs.push({ type: 'lane', owner: e, follow: true, len: 380, w: 38, t: 0, dur, boss: true });
    Sfx.play('telegraph');
  },

  runAttack(e, dt, d, dx, dy, out) {
    const P = G.player;
    const a = this.attack;
    if (this.state === 'tele') {
      if ((a === 'charge' || a === 'charge3') && this.stateT > 0.25) e.aimA = Math.atan2(dy, dx);
      e.x += rand(-0.4, 0.4);
      if (this.stateT <= 0) {
        this.setState('act', 0);
        this.subT = 0; this.sub = 0;
        if (a === 'charge' || a === 'charge3') { this.chargeLeft = 380; Sfx.play('bossCharge'); addShake(0.2); }
        if (a === 'toll') this.fireToll();
        if (a === 'sanctum') this.castSanctum();
      }
      return out;
    }
    if (this.state !== 'act') return out;
    this.subT += dt;
    switch (a) {
      case 'charge':
      case 'charge3': {
        const sp = 540;
        out.mx = Math.cos(e.aimA); out.my = Math.sin(e.aimA); out.spd = sp; out.accel = 40;
        e.dmg = 28;
        this.chargeLeft -= sp * dt;
        if (Math.random() < dt * 40) addFx({ type: 'after', boss: true, x: e.x, y: e.y, face: e.face, life: 0.3, max: 0.3 });
        const hitWall = e.x < ARENA.pad + 20 || e.x > ARENA.w - ARENA.pad - 20 || e.y < 60 || e.y > ARENA.h - ARENA.pad - 20 || (e.y < 330 && e.x > 860 && e.x < 1540);
        if (this.chargeLeft <= 0 || hitWall) {
          e.vx *= 0.2; e.vy *= 0.2;
          emitDust(e.x, e.y + 10, 16);
          addShake(0.25);
          this.charges--;
          if (this.charges > 0) this.beginChargeTele(0.6);
          else { this.setState('winded', this.attack === 'charge3' ? 1.7 : 1.4); this.vulnT = this.stateT; addFx({ type: 'text', x: e.x, y: e.y - 44, text: 'WINDED', color: COLORS.gold, life: 1.2, max: 1.2 }); }
        }
        return out;
      }
      case 'hymn': {
        if (this.sub < 3 && this.subT >= this.sub * 0.55) {
          this.radial(30, 4, 3, 94, rand(TAU));
          this.sub++;
        }
        if (this.sub >= 3 && this.subT > 1.6) this.setState('idle', 1.2);
        return out;
      }
      case 'spiral': {
        this.spT = (this.spT || 0) - dt;
        if (this.subT < 3.2) {
          if (this.spT <= 0) {
            this.spT = 0.085;
            const base = this.subT * 2.3;
            for (let k = 0; k < 3; k++) this.shot(base + (k * TAU) / 3, 84);
            Sfx.play('enemyShot');
          }
        } else if (this.sub === 0) { this.sub = 1; this.radial(28, 4, 3, 90, rand(TAU)); }
        if (this.subT > 3.9) this.setState('idle', 0.9);
        return out;
      }
      case 'sanctum':
        if (this.subT > 1.7) this.setState('idle', 1.1);
        return out;
      case 'procession': {
        if (this.sub < 10 && this.subT >= this.sub * 0.24) {
          const lead = 0.3;
          this.pillar(P.x + P.vx * lead + rand(-6, 6), P.y + P.vy * lead + rand(-6, 6), 30, 0.85);
          if (this.sub === 0) for (let i = 0; i < 6; i++) { const ang = (i / 6) * TAU; Director.summon(i % 2 ? 'acolyte' : 'husk', P.x + Math.cos(ang) * 170, P.y + Math.sin(ang) * 130, 0.9); }
          this.sub++;
        }
        if (this.sub >= 10 && this.subT > 3.4) this.setState('idle', 0.9);
        return out;
      }
      case 'toll': {
        const second = this.uses.toll >= 2;
        if (second && this.sub === 0 && this.subT > 2.4) { this.sub = 1; this.fireToll(); }
        if (this.subT > (second ? 3.2 : 1.2)) {
          this.setState('winded', 2.0); this.vulnT = 2.0;
          addFx({ type: 'text', x: e.x, y: e.y - 44, text: 'HOLLOW', color: COLORS.gold, life: 1.4, max: 1.4 });
        }
        return out;
      }
    }
    return out;
  },

  shot(ang, speed) {
    const e = this.e;
    spawnShot({ x: e.x + Math.cos(ang) * 12, y: e.y - 10 + Math.sin(ang) * 12, ang, speed, dmg: 14, r: 4, life: 6, kind: 'boss' });
  },

  // A ring of orbs with evenly spaced, clearly visible gaps.
  radial(n, gaps, gapSize, speed, rot) {
    const skip = new Set();
    for (let g = 0; g < gaps; g++) {
      const c = Math.floor((g / gaps) * n + rot * n / TAU) % n;
      for (let k = 0; k < gapSize; k++) skip.add((c + k) % n);
    }
    for (let i = 0; i < n; i++) if (!skip.has(i)) this.shot(rot + (i / n) * TAU, speed);
    Sfx.play('enemyShot');
    addShake(0.1);
  },

  pillar(x, y, r, dur) {
    x = clamp(x, ARENA.pad, ARENA.w - ARENA.pad); y = clamp(y, ARENA.top - 30, ARENA.h - ARENA.pad);
    G.telegraphs.push({
      type: 'circle', boss: true, x, y, r, t: 0, dur,
      done: tg => {
        addFx({ type: 'pillar', x: tg.x, y: tg.y, r: tg.r, life: 0.5, max: 0.5 });
        addLightFlash(tg.x, tg.y, tg.r * 3, 'crimson', 0.35);
        emitSparks(tg.x, tg.y, 12, COLORS.crimsonHot, 90);
        World.scorch(tg.x, tg.y, tg.r * 0.7);
        Sfx.play('pillar');
        if (dist(tg.x, tg.y, G.player.x, G.player.y) < tg.r + G.player.r - 1) hurtPlayer(22, tg.x, tg.y);
      },
    });
  },

  castSanctum() {
    const P = G.player;
    const spots = [{ x: P.x, y: P.y }];
    let tries = 0;
    while (spots.length < 6 && tries++ < 40) {
      const s = { x: P.x + rand(-130, 130), y: P.y + rand(-100, 100) };
      if (spots.every(o => dist2(o.x, o.y, s.x, s.y) > 52 * 52)) spots.push(s);
    }
    for (const s of spots) this.pillar(s.x, s.y, 34, 1.15);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + rand(0.3);
      Director.summon('husk', P.x + Math.cos(a) * 165, P.y + Math.sin(a) * 125, 0.85);
    }
  },

  fireToll() {
    const e = this.e;
    const base = rand(TAU);
    G.tolls.push({ x: e.x, y: e.y, r: 14, speed: 128, maxR: 560, w: 10, gaps: [base, base + TAU / 3, base + (2 * TAU) / 3], gapW: 0.55, rot: 0, dmg: 26, hit: false });
    Sfx.play('bossToll');
    addShake(0.35);
    screenFlash(COLORS.crimson, 0.18);
    e.bellSwing = 1;
  },

  onBell(e) {
    if (this.state === 'tele' && this.interruptCd <= 0) {
      this.interruptCd = 9;
      G.telegraphs = G.telegraphs.filter(t => t.owner !== e);
      this.setState('winded', 1.8);
      this.vulnT = 1.8;
      e.exposedT = Math.max(e.exposedT, 6);
      hitstop(0.1);
      addShake(0.4);
      emitRing(e.x, e.y, 36, COLORS.cyan, 140);
      addFx({ type: 'text', x: e.x, y: e.y - 44, text: 'INTERRUPTED', color: COLORS.cyan, life: 1.5, max: 1.5 });
      G.stats.interrupted = true;
      Progress.unlock('interrupt');
    }
  },

  updateTolls(dt) {
    const P = G.player;
    for (const t of G.tolls) {
      t.r += t.speed * dt;
      t.rot += 0.3 * dt;
      if (t.r > t.maxR) t.dead = true;
      if (t.hit || P.dead) continue;
      const d = dist(P.x, P.y, t.x, t.y);
      if (Math.abs(d - t.r) < t.w / 2 + P.r) {
        const a = Math.atan2(P.y - t.y, P.x - t.x);
        const inGap = t.gaps.some(g => Math.abs(angleDiff(a, g + t.rot)) < t.gapW / 2);
        if (!inGap && P.inv <= 0 && P.dashT <= 0) { t.hit = true; hurtPlayer(t.dmg, t.x, t.y); }
      }
    }
    G.tolls = G.tolls.filter(t => !t.dead);
  },

  onDeath(e) {
    const P = G.player;
    G.victory = true;
    G.slowmo = 2.6;
    hitstop(0.15);
    screenFlash('#ffffff', 0.9);
    addShake(1);
    emitRing(e.x, e.y, 80, COLORS.gold, 260);
    emitRing(e.x, e.y, 60, COLORS.cyan, 180);
    emitAsh(e.x, e.y - 10, 60, '#c6c0b5');
    addLightFlash(e.x, e.y, 500, 'gold', 2.5);
    G.shots.clear(); G.telegraphs.length = 0; G.tolls.length = 0;
    addRing({ x: e.x, y: e.y, maxR: 900, speed: 420, dmg: 0, knock: 0, src: 'purge', purge: true, color: COLORS.gold, width: 3 });
    Director.moodTarget = -1;
    G.gems.forEach(g => { g.state = 1; g.spd = 0; });
    Sfx.Music.stop();
    Sfx.play('victory');
    G.fx.push({ type: 'delay', t: 0.8, fn: () => Sfx.play('bell') });
    G.fx.push({ type: 'delay', t: 2.5, fn: () => Sfx.Music.start('victory') });
    UI.banner('Dawn Breaks', 'The Last Bell rings out over a silent city', 'gold', 3.6);
    Progress.unlock('win');
    if (P.covenants.has('glass')) Progress.unlock('glassWin');
    G.fx.push({ type: 'delay', t: 4.6, fn: () => UI.showResult(true) });
  },
};
