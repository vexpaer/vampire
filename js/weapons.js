'use strict';
// ---------------------------------------------------------------------------
// Weapons. Each entry owns its numbers per level, its firing logic and any
// persistent visuals. Evolved forms are separate entries that replace the
// base weapon in its slot.
// ---------------------------------------------------------------------------

const wDmg = (base, P) => base * P.s.might * (G.buffs.fury > 0 ? 1.25 : 1);
const wCd = (base, P) => base * P.s.cdMul * (G.buffs.frenzy > 0 ? 0.625 : 1) * (G.buffs.fury > 0 ? 0.667 : 1);

// Single-target weapons lock onto elites and the boss when they are in reach.
function priorityTarget(x, y, range, exclude) {
  let best = null, bd = range * range;
  for (const e of G.enemies) {
    if (!(e.elite || e.boss) || e.dead || e.emerge > 0) continue;
    const d = dist2(x, y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best && Math.random() < 0.65 ? best : nearestEnemy(x, y, range, exclude);
}

function aimAngle(P, range = 260) {
  const t = nearestEnemy(P.x, P.y, range);
  return t ? Math.atan2(t.y - P.y, t.x - P.x) : P.aim;
}

// Lightning chain shared by the base and evolved forms.
function castChain(first, o) {
  const list = [first];
  let cur = first, jumps = o.jumps;
  while (jumps > 0 && list.length < 16) {
    const nxt = nearestEnemy(cur.x, cur.y, o.range, list);
    if (!nxt) break;
    if (G.player.covenants.has('stormConductor') && nxt.slowT > 0) jumps++;
    list.push(nxt);
    cur = nxt;
    jumps--;
  }
  const pts = [{ x: first.x + rand(-18, 18), y: first.y - 150 }];
  for (const e of list) {
    pts.push({ x: e.x, y: e.y - 3 });
    damageEnemy(e, o.dmg, { src: o.src, kb: 25, fromX: G.player.x, fromY: G.player.y });
    if (G.player.covenants.has('stormConductor') || o.slow) { e.slowT = Math.max(e.slowT, 1.6); e.slowAmt = Math.max(e.slowAmt, 0.4); }
    if (o.shock) e.shockT = 3;
    emitSparks(e.x, e.y - 3, 3, o.color || COLORS.cyan, 70);
  }
  addFx({ type: 'bolt', pts, life: 0.2, max: 0.2, color: o.color || COLORS.cyan, width: o.width || 1 });
  addLightFlash(first.x, first.y, 70, 'cyan', 0.15);
  Sfx.play('zap');
}

function placeSigil(x, y, o) {
  G.sigils.push({ x, y, r: o.r, t: 0, arm: o.arm, dmg: o.dmg, bleed: o.bleed, dbl: o.dbl, second: false, src: o.src, evolved: !!o.evolved, heal: o.heal || 0, rot: rand(TAU) });
}

const WEAPONS = {
  dagger: {
    name: 'Bone Daggers', icon: 'dagger', max: 5, role: 'Projectile · Single target',
    desc: [
      'Hurls bone daggers at the nearest enemy.',
      '+1 dagger per volley.',
      '+4 damage. Daggers pierce 1 more enemy.',
      '+1 dagger. Volleys 15% faster.',
      '+1 dagger. +5 damage.',
    ],
    stats(lv) {
      return {
        dmg: 10 + (lv >= 3 ? 4 : 0) + (lv >= 5 ? 5 : 0),
        count: 1 + (lv >= 2) + (lv >= 4) + (lv >= 5),
        pierce: lv >= 3 ? 1 : 0,
        cd: lv >= 4 ? 0.8 : 0.95,
      };
    },
    update(w, dt, P) {
      const st = this.stats(w.lv);
      w.t -= dt;
      if (w.t <= 0 && !w.burst) { w.burst = st.count + P.s.amount; w.bt = 0; w.t = wCd(st.cd, P); w.targets = []; }
      if (w.burst > 0) {
        w.bt -= dt;
        while (w.burst > 0 && w.bt <= 0) {
          const tgt = priorityTarget(P.x, P.y, 300, w.targets) || nearestEnemy(P.x, P.y, 300);
          if (tgt) w.targets.push(tgt);
          const ang = (tgt ? Math.atan2(tgt.y - P.y, tgt.x - P.x) : P.aim) + rand(-0.05, 0.05);
          spawnProj({ kind: 'dagger', x: P.x, y: P.y - 4, ang, speed: 270 * P.s.projSpeed, dmg: wDmg(st.dmg, P), pierce: st.pierce, life: 1.2, r: 3, knock: 45, src: 'dagger' });
          Sfx.play('dagger');
          w.burst--; w.bt += 0.055;
        }
      }
    },
  },

  ossuary: {
    name: 'Ossuary Tempest', icon: 'ossuary', evolved: true, base: 'dagger', role: 'Evolved · Homing barrage',
    evoDesc: 'A ring of spectral blades orbits you, endlessly launching homing bone spears that pierce three foes.',
    update(w, dt, P) {
      const n = 6 + P.s.amount * 2;
      w.spin = (w.spin || 0) + dt * 3.4;
      if (!w.blades || w.blades.length !== n) w.blades = Array.from({ length: n }, () => ({ ready: 1 }));
      for (const b of w.blades) b.ready = Math.min(1, b.ready + dt / 0.85);
      w.t = (w.t || 0) - dt;
      if (w.t <= 0) {
        w.t = wCd(0.12, P);
        const tgt = priorityTarget(P.x, P.y, 330);
        if (tgt) {
          w.idx = ((w.idx || 0) + 1) % n;
          for (let k = 0; k < n; k++) {
            const i = (w.idx + k) % n, b = w.blades[i];
            if (b.ready < 1) continue;
            const a = w.spin + (i * TAU) / n;
            const R = 24 * P.s.area;
            const bx = P.x + Math.cos(a) * R, by = P.y - 4 + Math.sin(a) * R;
            spawnProj({ kind: 'spear', x: bx, y: by, ang: Math.atan2(tgt.y - by, tgt.x - bx), speed: 300 * P.s.projSpeed, dmg: wDmg(20, P), pierce: 3, life: 1.3, r: 3, knock: 50, homing: 7, src: 'ossuary' });
            b.ready = 0;
            Sfx.play('dagger');
            break;
          }
        }
      }
    },
    draw(w, ctx, cx, cy) {
      if (!w.blades) return;
      const P = G.player, n = w.blades.length, R = 24 * P.s.area;
      const spr = Assets.sprites.spear.frames[0];
      for (let i = 0; i < n; i++) {
        const b = w.blades[i];
        if (b.ready < 0.15) continue;
        const a = w.spin + (i * TAU) / n;
        const x = P.x + Math.cos(a) * R - cx, y = P.y - 4 + Math.sin(a) * R - cy;
        ctx.save();
        ctx.globalAlpha = 0.35 + b.ready * 0.65;
        ctx.translate(Math.round(x), Math.round(y));
        ctx.rotate(a);
        ctx.drawImage(spr, -5, -1);
        ctx.restore();
      }
    },
  },

  scythe: {
    name: 'Spectral Scythe', icon: 'scythe', max: 5, role: 'Melee · Crowd sweep',
    desc: [
      'Sweeps a spectral scythe through enemies around you.',
      '+25% sweep size.',
      '+10 damage. Heavier knockback.',
      'Also sweeps behind you.',
      'Sweeps 20% faster. +10 damage.',
    ],
    stats(lv) {
      return {
        dmg: 22 + (lv >= 3 ? 10 : 0) + (lv >= 5 ? 10 : 0),
        radius: 50 * (lv >= 2 ? 1.25 : 1),
        cd: lv >= 5 ? 1.76 : 2.2,
        knock: lv >= 3 ? 200 : 150,
        back: lv >= 4,
      };
    },
    update(w, dt, P) {
      const st = this.stats(w.lv);
      w.t -= dt;
      if (w.t <= 0) {
        w.t = wCd(st.cd, P);
        w.side = -(w.side || 1);
        const dir = aimAngle(P, 140);
        const r = st.radius * P.s.area, dmg = wDmg(st.dmg, P);
        const extra = P.s.amount;
        for (let k = 0; k <= extra; k++) {
          const delay = k * 0.14;
          addSweep({ dir, side: k % 2 ? -w.side : w.side, arc: 3.5, dur: 0.26, r, dmg, knock: st.knock, src: 'scythe', delay });
          if (st.back) addSweep({ dir: dir + Math.PI, side: k % 2 ? w.side : -w.side, arc: 3.5, dur: 0.26, r, dmg, knock: st.knock, src: 'scythe', delay });
        }
        Sfx.play('scythe');
      }
    },
  },

  harvestMoon: {
    name: 'Harvest Moon', icon: 'harvestMoon', evolved: true, base: 'scythe', role: 'Evolved · Full-circle reaping',
    evoDesc: 'Full-circle double sweeps that hurl piercing crescent blades in every direction.',
    update(w, dt, P) {
      w.t = (w.t || 0) - dt;
      if (w.t <= 0) {
        w.t = wCd(1.5, P);
        const r = 72 * P.s.area, dmg = wDmg(34, P);
        const dir = aimAngle(P, 200);
        addSweep({ dir, side: 1, arc: TAU, dur: 0.34, r, dmg, knock: 210, src: 'harvestMoon', evolved: true });
        addSweep({ dir: dir + Math.PI, side: -1, arc: TAU, dur: 0.34, r: r * 0.8, dmg, knock: 160, src: 'harvestMoon', delay: 0.18, evolved: true });
        const waves = 6 + P.s.amount * 2;
        for (let i = 0; i < waves; i++) {
          const a = dir + (i * TAU) / waves;
          spawnProj({ kind: 'crescent', x: P.x, y: P.y - 4, ang: a, speed: 200 * P.s.projSpeed, dmg: wDmg(24, P), pierce: -1, life: 0.95 * P.s.duration, r: 7 * P.s.area, knock: 90, src: 'harvestMoon' });
        }
        Sfx.play('scythe');
        Sfx.play('orb');
      }
    },
  },

  orbs: {
    name: 'Moonfire Orbs', icon: 'orbs', max: 5, role: 'Orbit · Area control',
    desc: [
      'Pale moons orbit you, searing anything they touch.',
      '+1 moon.',
      '+6 damage. +20% orbit radius.',
      '+1 moon. Moons stay out 1s longer.',
      '+1 moon. Moons orbit 30% faster.',
    ],
    stats(lv) {
      return {
        n: 2 + (lv >= 2) + (lv >= 4) + (lv >= 5),
        dmg: 12 + (lv >= 3 ? 6 : 0),
        R: 44 * (lv >= 3 ? 1.2 : 1),
        dur: 4 + (lv >= 4 ? 1 : 0),
        cd: 2.0,
        spd: lv >= 5 ? 4.1 : 3.15,
      };
    },
    update(w, dt, P) {
      const st = this.stats(w.lv);
      const od = P.covenants.has('orbitingDeath');
      const n = st.n + P.s.amount + (od ? 2 : 0);
      const R = st.R * P.s.area * (od ? 1.4 : 1);
      const dur = (st.dur + (od ? 2 : 0)) * P.s.duration;
      if (w.active) { w.at -= dt; if (w.at <= 0) { w.active = false; w.t = wCd(st.cd, P); } }
      else { w.t -= dt; if (w.t <= 0) { w.active = true; w.at = dur; } }
      w.fade = approach(w.fade || 0, w.active ? 1 : 0, dt * 4);
      w.ang = (w.ang || 0) + st.spd * dt;
      w.pos = w.pos || [];
      w.pos.length = 0;
      if (w.fade <= 0.01) return;
      const rr = R * (0.5 + 0.5 * w.fade);
      const orbR = 6 * P.s.area;
      const dmg = wDmg(st.dmg, P);
      for (let i = 0; i < n; i++) {
        const a = w.ang + (i * TAU) / n;
        const ox = P.x + Math.cos(a) * rr, oy = P.y - 4 + Math.sin(a) * rr;
        w.pos.push(ox, oy);
        if (w.fade < 0.6) continue;
        const cnt = queryEnemies(ox, oy, orbR);
        for (let k = 0; k < cnt; k++) {
          const e = QBUF[k];
          if (G.time - e.orbT < 0.4) continue;
          e.orbT = G.time;
          damageEnemy(e, dmg, { src: 'orbs', kb: 70, fromX: P.x, fromY: P.y });
          Sfx.play('orb');
        }
      }
    },
    draw(w, ctx, cx, cy) { drawOrbs(w, ctx, cx, cy, false); },
  },

  eclipseHalo: {
    name: 'Eclipse Halo', icon: 'eclipseHalo', evolved: true, base: 'orbs', role: 'Evolved · Permanent burning ring',
    evoDesc: 'A permanent, breathing ring of eclipsed moons that sets every enemy it touches alight.',
    update(w, dt, P) {
      const od = P.covenants.has('orbitingDeath');
      const n = 6 + P.s.amount + (od ? 2 : 0);
      w.ang = (w.ang || 0) + 2.7 * dt;
      w.fade = 1;
      const breathe = (Math.sin(G.time * 1.7) + 1) / 2;
      const R = lerp(34, 96, breathe) * P.s.area * (od ? 1.25 : 1);
      w.pos = w.pos || [];
      w.pos.length = 0;
      const orbR = 7 * P.s.area, dmg = wDmg(24, P);
      for (let i = 0; i < n; i++) {
        const a = w.ang + (i * TAU) / n;
        const ox = P.x + Math.cos(a) * R, oy = P.y - 4 + Math.sin(a) * R;
        w.pos.push(ox, oy);
        const cnt = queryEnemies(ox, oy, orbR);
        for (let k = 0; k < cnt; k++) {
          const e = QBUF[k];
          if (G.time - e.orbT < 0.35) continue;
          e.orbT = G.time;
          damageEnemy(e, dmg, { src: 'eclipseHalo', kb: 60, fromX: P.x, fromY: P.y });
          e.burnT = 2 * P.s.duration; e.burnDps = Math.max(e.burnDps, 12 * P.s.might);
          Sfx.play('orb');
        }
      }
    },
    draw(w, ctx, cx, cy) { drawOrbs(w, ctx, cx, cy, true); },
  },

  grave: {
    name: 'Gravebreaker', icon: 'grave', max: 5, role: 'Heavy · Piercing knockback',
    desc: [
      'Hurls a heavy spectral tombstone at the nearest foe, crushing through lines of enemies.',
      '+15 damage.',
      '+1 tombstone, thrown in a spread.',
      '+30% size and knockback. 10% faster.',
      '+20 damage. Tombstones shatter in an explosion.',
    ],
    stats(lv) {
      return {
        dmg: 40 + (lv >= 2 ? 15 : 0) + (lv >= 5 ? 20 : 0),
        count: 1 + (lv >= 3 ? 1 : 0),
        size: lv >= 4 ? 1.3 : 1,
        knock: 280 * (lv >= 4 ? 1.25 : 1),
        cd: 2.7 * (lv >= 4 ? 0.9 : 1),
        explode: lv >= 5,
      };
    },
    update(w, dt, P) {
      const st = this.stats(w.lv);
      w.t -= dt;
      if (w.t <= 0) {
        w.t = wCd(st.cd, P);
        const dir = aimAngle(P, 300);
        const n = st.count + P.s.amount;
        for (let i = 0; i < n; i++) {
          const ang = dir + (i - (n - 1) / 2) * 0.28;
          spawnProj({
            kind: 'slab', x: P.x, y: P.y - 4, ang, speed: 165 * P.s.projSpeed, dmg: wDmg(st.dmg, P), pierce: -1,
            life: 1.5 * P.s.duration, r: 8 * st.size * P.s.area, scale: st.size * P.s.area, knock: st.knock, src: 'grave',
            explode: st.explode ? 42 * P.s.area : 0, heavy: true,
          });
        }
        Sfx.play('grave');
      }
    },
  },

  titansRequiem: {
    name: "Titan's Requiem", icon: 'titansRequiem', evolved: true, base: 'grave', role: 'Evolved · Seismic slam',
    evoDesc: 'Slam the earth: a crushing shockwave, then tombstones erupt outward in every cardinal direction.',
    update(w, dt, P) {
      w.t = (w.t || 0) - dt;
      if (w.t <= 0) {
        w.t = wCd(2.3, P);
        w.rot = (w.rot || 0) + Math.PI / 4;
        addRing({ x: P.x, y: P.y, maxR: 96 * P.s.area, speed: 420, dmg: wDmg(55, P), knock: 330, src: 'titansRequiem', color: COLORS.bone, width: 4 });
        const n = 4 + P.s.amount * 2;
        for (let i = 0; i < n; i++) {
          const a = w.rot + (i * TAU) / n;
          spawnProj({ kind: 'slab', x: P.x, y: P.y - 4, ang: a, speed: 215 * P.s.projSpeed, dmg: wDmg(62, P), pierce: -1, life: 1.15 * P.s.duration, r: 11 * P.s.area, scale: 1.4 * P.s.area, knock: 300, src: 'titansRequiem', heavy: true, explode: 36 * P.s.area });
        }
        addShake(0.45);
        hitstop(0.045);
        emitDust(P.x, P.y, 18);
        Sfx.play('hitHeavy');
        Sfx.play('grave');
      }
    },
  },

  chain: {
    name: 'Chain Lightning', icon: 'chain', max: 5, role: 'Chain · Rewards dense crowds',
    desc: [
      'Calls lightning onto an enemy; it leaps to 3 more.',
      '+2 leaps.',
      '+6 damage.',
      'Calls two strikes per cast.',
      '+2 leaps. Casts 15% faster.',
    ],
    stats(lv) {
      return {
        dmg: 14 + (lv >= 3 ? 6 : 0),
        jumps: 3 + (lv >= 2 ? 2 : 0) + (lv >= 5 ? 2 : 0),
        strikes: 1 + (lv >= 4 ? 1 : 0),
        cd: 1.6 * (lv >= 5 ? 0.85 : 1),
      };
    },
    update(w, dt, P) {
      const st = this.stats(w.lv);
      w.t -= dt;
      if (w.t <= 0) {
        w.t = wCd(st.cd, P);
        const n = st.strikes + P.s.amount;
        for (let i = 0; i < n; i++) {
          const first = randomEnemyNear(P.x, P.y, 210);
          if (!first) break;
          castChain(first, { jumps: st.jumps, range: 78 * Math.sqrt(P.s.area), dmg: wDmg(st.dmg, P), src: 'chain' });
        }
      }
    },
  },

  tempestChoir: {
    name: 'Tempest Choir', icon: 'tempestChoir', evolved: true, base: 'chain', role: 'Evolved · Storm that never ends',
    evoDesc: 'Three storms per cast leap up to ten times, Shocking (+20% damage taken) and slowing all they touch.',
    update(w, dt, P) {
      w.t = (w.t || 0) - dt;
      if (w.t <= 0) {
        w.t = wCd(0.95, P);
        const n = 3 + P.s.amount;
        for (let i = 0; i < n; i++) {
          const first = randomEnemyNear(P.x, P.y, 240);
          if (!first) break;
          castChain(first, { jumps: 10, range: 110 * Math.sqrt(P.s.area), dmg: wDmg(26, P), src: 'tempestChoir', shock: true, slow: true, color: '#d8fffb', width: 2 });
        }
      }
    },
  },

  sigil: {
    name: 'Blood Sigil', icon: 'sigil', max: 5, role: 'Delayed area · Bleed',
    desc: [
      'Inscribes a blood sigil beneath enemies. It detonates and makes them Bleed.',
      '+1 sigil.',
      '+25% sigil size. +10 damage.',
      '+1 sigil. Bleeding is twice as strong.',
      'Sigils detonate twice.',
    ],
    stats(lv) {
      return {
        n: 1 + (lv >= 2) + (lv >= 4),
        dmg: 30 + (lv >= 3 ? 10 : 0),
        r: 34 * (lv >= 3 ? 1.25 : 1),
        bleed: lv >= 4 ? 8 : 4,
        cd: 2.4,
        dbl: lv >= 5,
      };
    },
    update(w, dt, P) {
      const st = this.stats(w.lv);
      w.t -= dt;
      if (w.t <= 0) {
        w.t = wCd(st.cd, P);
        const n = st.n + P.s.amount;
        const used = [];
        for (let i = 0; i < n; i++) {
          let spot = densestSpot(P.x, P.y, 175, used, st.r * 0.9);
          if (!spot) spot = { x: P.x + rand(-80, 80), y: P.y + rand(-60, 60) };
          used.push(spot);
          placeSigil(spot.x, spot.y, { r: st.r * P.s.area, arm: 0.85, dmg: wDmg(st.dmg, P), bleed: st.bleed * P.s.bleedMul * P.s.might, dbl: st.dbl, src: 'sigil' });
        }
        Sfx.play('sigilArm');
      }
    },
  },

  crimsonCathedral: {
    name: 'Crimson Cathedral', icon: 'crimsonCathedral', evolved: true, base: 'sigil', role: 'Evolved · Healing pentagram',
    evoDesc: 'A pentagram of vast sigils erupts around you, leaving pools of blood and healing you for every enemy struck.',
    update(w, dt, P) {
      w.t = (w.t || 0) - dt;
      if (w.t <= 0) {
        w.t = wCd(2.2, P);
        w.rot = (w.rot || 0) + 0.63;
        const r = 50 * P.s.area, dmg = wDmg(48, P), bleed = 10 * P.s.bleedMul * P.s.might;
        const pts = [];
        for (let i = 0; i < 5; i++) {
          const a = w.rot + (i * TAU) / 5 - Math.PI / 2;
          const x = P.x + Math.cos(a) * 88 * P.s.area, y = P.y + Math.sin(a) * 88 * P.s.area;
          pts.push({ x, y });
          placeSigil(x, y, { r, arm: 0.7, dmg, bleed, src: 'crimsonCathedral', evolved: true, heal: 1 });
        }
        const used = [];
        for (let i = 0; i < 1 + P.s.amount; i++) {
          const spot = densestSpot(P.x, P.y, 200, used, r);
          if (!spot) break;
          used.push(spot);
          placeSigil(spot.x, spot.y, { r, arm: 0.7, dmg, bleed, src: 'crimsonCathedral', evolved: true, heal: 1 });
        }
        addFx({ type: 'pentagram', pts, life: 0.75, max: 0.75 });
        Sfx.play('sigilArm');
      }
    },
  },
};

function drawOrbs(w, ctx, cx, cy, eclipse) {
  if (!w.pos || !w.pos.length) return;
  const P = G.player;
  const r = (eclipse ? 4.5 : 3.5) * P.s.area;
  ctx.save();
  for (let i = 0; i < w.pos.length; i += 2) {
    const x = w.pos[i] - cx, y = w.pos[i + 1] - cy;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 * w.fade;
    ctx.drawImage(Assets.lights.cyan, x - r * 4, y - r * 4, r * 8, r * 8);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = w.fade;
    if (eclipse) {
      ctx.fillStyle = COLORS.cyan;
      ctx.beginPath(); ctx.arc(x, y, r + 1.2, 0, TAU); ctx.fill();
      ctx.fillStyle = COLORS.ink;
      ctx.beginPath(); ctx.arc(x + 0.8, y - 0.4, r, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = '#d9fffb';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x - 1), Math.round(y - 1.5), 2, 2);
    }
  }
  ctx.restore();
}
