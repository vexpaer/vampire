'use strict';
// ---------------------------------------------------------------------------
// Rendering. The world is drawn at low resolution and upscaled with nearest
// neighbour for crisp pixels. A light map is multiplied over the scenery,
// then characters and emissive effects are drawn unlit so the action always
// reads clearly. The HUD and numbers go on a full-resolution canvas on top.
// ---------------------------------------------------------------------------

const R = {
  canvas: null, ctx: null, ui: null, uctx: null, light: null, lctx: null,
  vignette: null, fogPale: null, fogRed: null, u: 3, dpr: 1, rl: [], bellCyan: null, beam: null,

  init() {
    this.canvas = document.getElementById('world');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.ui = document.getElementById('ui');
    this.uctx = this.ui.getContext('2d');
    this.light = makeCanvas(16, 16);
    this.lctx = this.light.getContext('2d');
    this.bellCyan = silhouette(Assets.icons.bellIcon, COLORS.cyan);
    this.bellDim = silhouette(Assets.icons.bellIcon, '#26232c');
    this.beam = (() => {
      const c = makeCanvas(64, 512), g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 64, 0);
      grad.addColorStop(0, 'rgba(160,175,220,0)'); grad.addColorStop(0.5, 'rgba(160,175,220,0.5)'); grad.addColorStop(1, 'rgba(160,175,220,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 64, 512);
      return c;
    })();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const devW = Math.max(320, Math.floor(window.innerWidth * dpr)), devH = Math.max(240, Math.floor(window.innerHeight * dpr));
    const scale = Math.max(1, Math.floor(Math.min(devH / 330, devW / 300)));
    const vw = Math.ceil(devW / scale), vh = Math.ceil(devH / scale);
    this.canvas.width = vw; this.canvas.height = vh;
    this.canvas.style.width = (vw * scale) / dpr + 'px'; this.canvas.style.height = (vh * scale) / dpr + 'px';
    this.ui.width = devW; this.ui.height = devH;
    this.ui.style.width = devW / dpr + 'px'; this.ui.style.height = devH / dpr + 'px';
    this.light.width = vw; this.light.height = vh;
    this.dpr = dpr; this.u = scale;
    G.view.w = vw; G.view.h = vh; G.view.scale = scale;
    this.ctx.imageSmoothingEnabled = false;
    // Vignette
    this.vignette = makeCanvas(vw, vh);
    const vg = this.vignette.getContext('2d');
    const grad = vg.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.32, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(4,3,8,0.72)');
    vg.fillStyle = grad; vg.fillRect(0, 0, vw, vh);
    this.redVignette = makeCanvas(vw, vh);
    const rg = this.redVignette.getContext('2d');
    const g2 = rg.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.28, vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
    g2.addColorStop(0, 'rgba(120,0,20,0)'); g2.addColorStop(1, 'rgba(150,10,30,0.75)');
    rg.fillStyle = g2; rg.fillRect(0, 0, vw, vh);
    if (World.fog) this.makeFogPatterns();
  },

  makeFogPatterns() {
    const tint = (r, g, b) => {
      const c = makeCanvas(World.fog.width, World.fog.height), x = c.getContext('2d');
      x.drawImage(World.fog, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(0, 0, c.width, c.height);
      return this.ctx.createPattern(c, 'repeat');
    };
    const t = World.fogTint;
    this.fogPale = tint(t[0], t[1], t[2]);
    this.fogRed = tint(170, 40, 60);
  },

  ambient() {
    const m = Director.mood;
    const keys = { '-1': [214, 196, 182], 0: [138, 136, 160], 1: [112, 104, 132], 2: [128, 86, 98], 3: [104, 62, 76] };
    const lo = Math.floor(m), hi = Math.ceil(m), t = m - lo;
    const a = keys[lo] || keys[0], b = keys[hi] || keys[0];
    return [lerp(a[0], b[0], t) | 0, lerp(a[1], b[1], t) | 0, lerp(a[2], b[2], t) | 0];
  },

  drawLight(x, y, r, color, a) {
    const img = Assets.lights[color] || Assets.lights.warm;
    this.lctx.globalAlpha = clamp(a, 0, 1);
    this.lctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  },

  // ======================================================================
  frame(time) {
    if (!World.ground) return;
    this.renderWorld(time);
    this.renderUI(time);
  },

  renderWorld(time) {
    const ctx = this.ctx, v = G.view;
    const sh = G.shake * G.shake * 5;
    const ox = sh ? rand(-sh, sh) : 0, oy = sh ? rand(-sh, sh) : 0;
    const cx = Math.round(G.cam.x + ox), cy = Math.round(G.cam.y + oy);
    G.cam.sx = cx; G.cam.sy = cy;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#08070a';
    ctx.fillRect(0, 0, v.w, v.h);

    // Ground
    const sx = Math.max(0, cx), sy = Math.max(0, cy);
    const ex = Math.min(ARENA.w, cx + v.w), ey = Math.min(ARENA.h, cy + v.h);
    if (ex > sx && ey > sy) ctx.drawImage(World.ground, sx, sy, ex - sx, ey - sy, sx - cx, sy - cy, ex - sx, ey - sy);

    this.drawFountain(ctx, cx, cy, time);
    this.drawPools(ctx, cx, cy);
    const playing = G.state !== 'title' && G.player;
    if (playing) this.drawShadows(ctx, cx, cy);

    this.renderLight(cx, cy, time);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.light, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    if (playing) {
      this.drawSigils(ctx, cx, cy, time);
      this.drawTelegraphs(ctx, cx, cy, time);
      this.drawCorpses(ctx, cx, cy);
      this.drawPickups(ctx, cx, cy, time);
      this.drawEntities(ctx, cx, cy, time);
      for (const w of G.player.weapons) { const d = WEAPONS[w.id]; if (d.draw) d.draw(w, ctx, cx, cy); }
      this.drawSweeps(ctx, cx, cy);
      this.drawProjectiles(ctx, cx, cy, time);
      this.drawShots(ctx, cx, cy, time);
      this.drawRings(ctx, cx, cy);
      this.drawFx(ctx, cx, cy, time);
    }
    this.drawCandles(ctx, cx, cy, time);
    this.drawParticles(ctx, cx, cy);
    this.drawFog(ctx, cx, cy, time);

    // Overlays
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0);
    if (playing) {
      const P = G.player;
      const low = P.hp / P.s.maxHp;
      if (low < 0.35 && !P.dead) {
        ctx.globalAlpha = (0.35 - low) / 0.35 * (0.55 + 0.45 * Math.sin(time * 6.5));
        ctx.drawImage(this.redVignette, 0, 0);
      }
      if (G.buffs.fury > 0 || G.buffs.frenzy > 0) {
        ctx.globalAlpha = 0.18 + 0.06 * Math.sin(time * 8);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(this.vignette, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (P.dead) {
        ctx.globalAlpha = Math.min(0.65, G.deathT * 0.4);
        ctx.fillStyle = '#050407';
        ctx.fillRect(0, 0, v.w, v.h);
      }
    }
    if (G.flash.a > 0.01) {
      ctx.globalAlpha = Math.min(1, G.flash.a);
      ctx.fillStyle = G.flash.color;
      ctx.fillRect(0, 0, v.w, v.h);
    }
    ctx.globalAlpha = 1;
  },

  renderLight(cx, cy, time) {
    const l = this.lctx, v = G.view;
    const amb = this.ambient();
    l.globalCompositeOperation = 'source-over';
    l.globalAlpha = 1;
    l.fillStyle = `rgb(${amb[0]},${amb[1]},${amb[2]})`;
    l.fillRect(0, 0, v.w, v.h);
    l.globalCompositeOperation = 'lighter';

    // Drifting moonbeams (fade as the moon is swallowed)
    const beamA = clamp(0.5 - Director.mood * 0.3, 0, 0.5);
    if (beamA > 0.02) {
      l.save();
      l.globalAlpha = beamA * 0.5;
      for (let i = 0; i < 3; i++) {
        const bx = ((i * 520 - cx * 0.9 + time * 9) % 1560 + 1560) % 1560 - 300;
        l.setTransform(1, 0, 0, 1, bx, -80);
        l.rotate(-0.5);
        l.drawImage(this.beam, 0, 0, 90 + i * 30, 900);
      }
      l.restore();
      l.globalCompositeOperation = 'lighter';
    }

    const vis = (x, y, r) => x + r > cx && x - r < cx + v.w && y + r > cy && y - r < cy + v.h;
    for (const c of World.candles) {
      if (!vis(c.x, c.y, 30)) continue;
      const f = 0.85 + Math.sin(time * 9 + c.ph) * 0.08 + Math.sin(time * 23 + c.ph * 2) * 0.05;
      this.drawLight(c.x - cx, c.y - cy, 24 * f, 'warm', 0.5 * f);
    }
    for (const g of World.glows) {
      if (!vis(g.x, g.y, g.r)) continue;
      const p = g.pulse ? 0.8 + Math.sin(time * 1.3 + g.x) * 0.2 : 1;
      this.drawLight(g.x - cx, g.y - cy, g.r, g.color, g.a * p);
    }
    if (G.state === 'title' || !G.player) { l.globalAlpha = 1; l.globalCompositeOperation = 'source-over'; return; }

    const P = G.player;
    const pr = P.dead ? 110 : 170 - Math.max(0, Director.mood - 1) * 22;
    this.drawLight(P.x - cx, P.y - 4 - cy, pr, 'warm', 0.85);
    this.drawLight(P.x - cx, P.y - 4 - cy, 40, 'white', 0.25);
    if (P.res >= 100) this.drawLight(P.x - cx, P.y - 18 - cy, 40, 'cyan', 0.4 + Math.sin(time * 5) * 0.1);
    for (const e of G.echoes) if (vis(e.x, e.y, 20)) this.drawLight(e.x - cx, e.y - cy, 18, 'cyan', 0.5);
    for (const p of G.pickups) if (vis(p.x, p.y, 40)) this.drawLight(p.x - cx, p.y - cy, p.type === 'chest' ? 50 : 26, p.type === 'chalice' ? 'crimson' : 'gold', 0.6);
    for (const s of G.sigils) if (vis(s.x, s.y, s.r)) this.drawLight(s.x - cx, s.y - cy, s.r * 1.6, 'crimson', 0.15 + 0.35 * (s.t / s.arm));
    for (const e of G.enemies) {
      if (e.boss) { if (vis(e.x, e.y, 120)) this.drawLight(e.x - cx, e.y - 14 - cy, 110, 'crimson', 0.45); continue; }
      if (e.elite && vis(e.x, e.y, 80)) this.drawLight(e.x - cx, e.y - cy, 70, 'crimson', 0.35);
      else if (e.def.special === 'thief' && vis(e.x, e.y, 60)) this.drawLight(e.x - cx, e.y - cy, 55, 'gold', 0.7);
    }
    G.shots.forEach(s => { if (vis(s.x, s.y, 20)) this.drawLight(s.x - cx, s.y - cy, 16, 'crimson', 0.5); });
    G.projs.forEach(p => {
      if (p.kind === 'spear' || p.kind === 'crescent') { if (vis(p.x, p.y, 20)) this.drawLight(p.x - cx, p.y - cy, 18, 'cyan', 0.4); }
      else if (p.kind === 'slab' && vis(p.x, p.y, 30)) this.drawLight(p.x - cx, p.y - cy, 30, 'moon', 0.35);
    });
    for (const w of P.weapons) {
      if (w.pos && w.pos.length) for (let i = 0; i < w.pos.length; i += 2) this.drawLight(w.pos[i] - cx, w.pos[i + 1] - cy, 22, 'cyan', 0.35 * (w.fade || 1));
    }
    for (const g of G.rings) if (g.bell) this.drawLight(g.x - cx, g.y - cy, g.r + 20, 'cyan', 0.35 * (1 - g.r / g.maxR));
    for (const f of G.lights) this.drawLight(f.x - cx, f.y - cy, f.r, f.color, f.t / f.max);
    l.globalAlpha = 1;
    l.globalCompositeOperation = 'source-over';
  },

  drawFountain(ctx, cx, cy, time) {
    const f = World.fountain;
    const x = f.x - cx, y = f.y - cy;
    if (x < -60 || y < -60 || x > G.view.w + 60 || y > G.view.h + 60) return;
    // Moon reflection, rippling; it reddens as the eclipse deepens.
    const m = Director.mood;
    const col = m > 1.5 ? '#a8303f' : m > 0.5 ? '#6b7085' : '#c8d2e6';
    ctx.globalAlpha = 0.5 + Math.sin(time * 0.8) * 0.1;
    ctx.fillStyle = col;
    const rx = x - 10 + Math.sin(time * 1.1) * 1.5, ry = y + 10;
    ctx.beginPath(); ctx.ellipse(rx, ry, 6, 3, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 4; i++) {
      const w = 10 + i * 4, yy = ry + 4 + i * 3;
      ctx.fillRect(Math.round(rx - w / 2 + Math.sin(time * 2 + i) * 2), Math.round(yy), w, 1);
    }
    ctx.globalAlpha = 1;
  },

  drawPools(ctx, cx, cy) {
    for (const p of G.pools) {
      const a = Math.min(1, p.t / p.max * 1.5);
      ctx.globalAlpha = (p.kind === 'moon' ? 0.35 : 0.5) * a;
      ctx.fillStyle = p.kind === 'moon' ? COLORS.cyanDim : '#5a0c18';
      ctx.beginPath(); ctx.ellipse(p.x - cx, p.y - cy, p.r, p.r * 0.7, 0, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  drawShadows(ctx, cx, cy) {
    ctx.fillStyle = 'rgba(5,4,8,0.5)';
    const v = G.view;
    ctx.beginPath();
    for (const e of G.enemies) {
      const x = e.x - cx, y = e.y - cy;
      if (x < -30 || y < -30 || x > v.w + 30 || y > v.h + 30) continue;
      const w = e.r * (e.boss ? 1.6 : 1.2);
      ctx.moveTo(x + w, y + 1);
      ctx.ellipse(x, y + 1, w, w * 0.4, 0, 0, TAU);
    }
    const P = G.player;
    ctx.moveTo(P.x - cx + 6, P.y - cy + 1);
    ctx.ellipse(P.x - cx, P.y - cy + 1, 6, 2.5, 0, 0, TAU);
    ctx.fill();
  },

  drawCandles(ctx, cx, cy, time) {
    ctx.globalCompositeOperation = 'lighter';
    for (const c of World.candles) {
      const x = c.x - cx, y = c.y - cy;
      if (x < -4 || y < -6 || x > G.view.w + 4 || y > G.view.h + 4) continue;
      const fl = Math.sin(time * 11 + c.ph) > 0.2 ? 1 : 0;
      ctx.fillStyle = '#ffe1a0';
      ctx.fillRect(x - 0.5 | 0, y - 1 - fl, 1, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 0.5 | 0, y, 1, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
  },

  drawSigils(ctx, cx, cy, time) {
    for (const s of G.sigils) {
      const x = s.x - cx, y = s.y - cy;
      const p = clamp(s.t / s.arm, 0, 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, 0.72);
      ctx.globalAlpha = 0.55 + 0.45 * p;
      ctx.strokeStyle = s.evolved ? COLORS.gold : COLORS.crimson;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, s.r, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s.r * 0.78, 0, TAU); ctx.stroke();
      // Rotating rune star
      ctx.rotate(s.rot);
      ctx.strokeStyle = COLORS.crimsonHot;
      ctx.beginPath();
      for (let i = 0; i <= 5; i++) {
        const a = (i * 2 * TAU) / 5;
        const px = Math.cos(a) * s.r * 0.75, py = Math.sin(a) * s.r * 0.75;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.fillStyle = COLORS.gold;
        ctx.fillRect(Math.cos(a) * s.r * 0.89 - 0.5, Math.sin(a) * s.r * 0.89 - 0.5, 1.5, 1.5);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12 + 0.3 * p * p;
      ctx.fillStyle = COLORS.crimson;
      ctx.beginPath(); ctx.arc(0, 0, s.r * p, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  drawTelegraphs(ctx, cx, cy, time) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 18);
    for (const t of G.telegraphs) {
      const p = clamp(t.t / t.dur, 0, 1);
      ctx.save();
      if (t.type === 'circle') {
        const x = t.x - cx, y = t.y - cy;
        ctx.translate(x, y); ctx.scale(1, 0.75);
        ctx.globalAlpha = 0.14 + 0.08 * pulse;
        ctx.fillStyle = COLORS.crimson;
        ctx.beginPath(); ctx.arc(0, 0, t.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(0, 0, t.r * p, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = COLORS.crimsonHot; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, t.r, 0, TAU); ctx.stroke();
      } else if (t.type === 'lane' && t.owner) {
        const x = t.owner.x - cx, y = t.owner.y - cy;
        ctx.translate(x, y); ctx.rotate(t.owner.aimA);
        const w = t.w, L = t.len;
        ctx.globalAlpha = 0.14 + 0.08 * pulse;
        ctx.fillStyle = COLORS.crimson;
        ctx.fillRect(0, -w / 2, L, w);
        ctx.globalAlpha = 0.32;
        ctx.fillRect(0, -w / 2, L * p, w);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = COLORS.crimsonHot;
        ctx.fillRect(0, -w / 2, L, 1); ctx.fillRect(0, w / 2 - 1, L, 1);
        // Chevrons racing toward the target
        ctx.globalAlpha = 0.7;
        for (let i = 0; i < 5; i++) {
          const cxp = ((i / 5) * L + time * 160) % L;
          ctx.beginPath(); ctx.moveTo(cxp, -w / 4); ctx.lineTo(cxp + 6, 0); ctx.lineTo(cxp, w / 4);
          ctx.strokeStyle = COLORS.crimsonHot; ctx.lineWidth = 1.5; ctx.stroke();
        }
      } else if (t.type === 'fan' && t.owner) {
        const x = t.owner.x - cx, y = t.owner.y - cy;
        ctx.translate(x, y);
        ctx.globalAlpha = 0.16 + 0.1 * pulse;
        ctx.fillStyle = COLORS.crimson;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, t.len, t.ang - t.spread / 2, t.ang + t.spread / 2); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.8; ctx.strokeStyle = COLORS.crimsonHot; ctx.lineWidth = 1; ctx.stroke();
      } else if (t.type === 'halo' && t.owner) {
        const x = t.owner.x - cx, y = t.owner.y - 14 - cy;
        ctx.translate(x, y);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25 + 0.5 * p;
        ctx.strokeStyle = t.bell ? COLORS.crimsonHot : COLORS.crimson;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, t.r * (1.4 - p * 0.6), 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.15 * p;
        ctx.fillStyle = COLORS.crimson;
        ctx.beginPath(); ctx.arc(0, 0, t.r * (1.4 - p * 0.6), 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  drawCorpses(ctx, cx, cy) {
    for (const c of G.corpses) {
      const s = c.spr;
      if (!s || !s.dissolve) continue;
      const dur = c.big ? 0.9 : 0.42;
      const fi = Math.min(3, Math.floor((c.t / dur) * 4));
      const img = c.flip ? s.dissolveFlip[fi] : s.dissolve[fi];
      ctx.globalAlpha = 1 - (c.t / dur) * 0.5;
      ctx.drawImage(img, Math.round(c.x - cx - s.w / 2), Math.round(c.y - cy - s.h + 2 - c.t * 8));
    }
    ctx.globalAlpha = 1;
  },

  drawPickups(ctx, cx, cy, time) {
    const v = G.view;
    const spr = [Assets.sprites.gemS.frames[0], Assets.sprites.gemM.frames[0], Assets.sprites.gemL.frames[0]];
    G.gems.forEach(g => {
      const x = g.x - cx, y = g.y - cy;
      if (x < -8 || y < -8 || x > v.w + 8 || y > v.h + 8) return;
      const img = spr[g.tier];
      const bob = g.state ? 0 : Math.round(Math.sin(g.t * 3) * 1);
      ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2 + bob));
      if (g.tier > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        const r = g.tier === 2 ? 9 : 6;
        ctx.drawImage(Assets.lights.gold, x - r, y - r + bob, r * 2, r * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    });
    // Echo fragments: cyan wisps
    for (const e of G.echoes) {
      const x = e.x - cx, y = e.y - cy;
      if (x < -10 || y < -10 || x > v.w + 10 || y > v.h + 10) continue;
      const blink = e.t > 25 ? (Math.sin(e.t * 20) > 0 ? 1 : 0.3) : 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6 * blink;
      ctx.drawImage(Assets.lights.cyan, x - 9, y - 9, 18, 18);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = blink;
      const f = Math.floor(time * 8 + e.ph) % 2;
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(Math.round(x - 1), Math.round(y - 2 - f), 3, 4 + f);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x), Math.round(y - 1), 1, 2);
      ctx.globalAlpha = 1;
    }
    for (const p of G.pickups) {
      const x = p.x - cx, y = p.y - cy;
      if (x < -30 || y < -60 || x > v.w + 30 || y > v.h + 30) continue;
      const name = p.type === 'chest' ? 'chest' : p.type === 'chalice' ? 'chalice' : 'chime';
      const img = Assets.sprites[name].frames[0];
      const bob = Math.round(Math.sin(p.t * 2.5) * 1.5);
      if (p.type === 'chest') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25 + 0.1 * Math.sin(time * 3);
        ctx.fillStyle = COLORS.gold;
        ctx.fillRect(Math.round(x - 3), Math.round(y - 60), 6, 56);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(Assets.lights.gold, x - 18, y - 18, 36, 36);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height + 2 + bob));
    }
  },

  drawEntities(ctx, cx, cy, time) {
    const v = G.view, rl = this.rl;
    rl.length = 0;
    for (const e of G.enemies) {
      const x = e.x - cx, y = e.y - cy;
      if (x < -50 || y < -20 || x > v.w + 50 || y > v.h + 60) continue;
      rl.push(e);
    }
    rl.push(G.player);
    rl.sort((a, b) => a.y - b.y);
    for (const e of rl) {
      if (e === G.player) this.drawPlayer(ctx, cx, cy, time);
      else if (e.boss) this.drawBoss(ctx, e, cx, cy, time);
      else this.drawEnemy(ctx, e, cx, cy, time);
    }
  },

  drawEnemy(ctx, e, cx, cy, time) {
    const s = Assets.sprites[e.def.sprite];
    const fi = Math.floor(e.animT) % s.frames.length;
    const flip = e.face < 0;
    let img = e.flash > 0 ? (flip ? s.whiteFlip[fi] : s.white[fi]) : (flip ? s.flip[fi] : s.frames[fi]);
    let x = Math.round(e.x - cx - s.w / 2), y = Math.round(e.y - cy - s.h + 2);
    if (e.def.flying) y += Math.round(Math.sin(e.animT * 0.9) * 1.5) - 5;
    if (e.elite) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(time * 4);
      ctx.strokeStyle = COLORS.crimson; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(e.x - cx, e.y - cy + 1, e.r + 5, (e.r + 5) * 0.45, 0, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (e.emerge > 0) {
      const p = 1 - e.emerge / e.emergeMax;
      const hh = Math.max(1, Math.round(s.h * p));
      ctx.globalAlpha = 0.4 + p * 0.6;
      ctx.drawImage(flip ? s.flip[0] : s.frames[0], 0, 0, s.w, hh, x, y + s.h - hh, s.w, hh);
      ctx.globalAlpha = 1;
      return;
    }
    if ((e.exposedT > 0 || e.cursedT > 0) && e.flash <= 0) {
      const ghost = s.ghost[fi];
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 10);
      const gi = flip ? mirrorCache(ghost) : ghost;
      ctx.drawImage(gi, x - 1, y); ctx.drawImage(gi, x + 1, y); ctx.drawImage(gi, x, y - 1); ctx.drawImage(gi, x, y + 1);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(img, x, y);
    if (e.slowT > 0 && e.flash <= 0) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(flip ? mirrorCache(s.ghost[fi]) : s.ghost[fi], x, y);
      ctx.globalAlpha = 1;
    }
    if (e.stunT > 0) {
      ctx.fillStyle = COLORS.cyan;
      for (let i = 0; i < 2; i++) {
        const a = time * 6 + i * Math.PI;
        ctx.fillRect(Math.round(e.x - cx + Math.cos(a) * 5), Math.round(y - 2 + Math.sin(a) * 1.5), 1, 1);
      }
    }
    if (e.state === 'cast' && e.def.behavior === 'ranged') {
      const p = 1 - e.stateT / 0.75;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + p * 0.5;
      const hx = e.x - cx + e.face * 3, hy = e.y - cy - 6;
      ctx.drawImage(Assets.lights.crimson, hx - 4 - p * 6, hy - 4 - p * 6, 8 + p * 12, 8 + p * 12);
      ctx.fillStyle = COLORS.crimsonHot;
      ctx.fillRect(Math.round(hx - 1), Math.round(hy - 1), 2, 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (e.bleedT > 0 && Math.sin(time * 7 + e.uid) > 0.8) {
      ctx.fillStyle = COLORS.crimsonHot;
      ctx.fillRect(Math.round(e.x - cx), Math.round(e.y - cy - s.h + 4), 1, 1);
    }
    if (e.burnT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = COLORS.cyan;
      const fx = Math.round(e.x - cx + Math.sin(time * 13 + e.uid) * 2);
      ctx.fillRect(fx, Math.round(y - 1 - (time * 10 + e.uid) % 3), 1, 2);
      ctx.globalCompositeOperation = 'source-over';
    }
  },

  drawBoss(ctx, e, cx, cy, time) {
    const s = Assets.sprites.archbishop;
    const flip = e.face < 0;
    const fall = e.emerge > 0 ? e.emerge / e.emergeMax : 0;
    const hover = Math.round(Math.sin(time * 1.6) * 2) - 8;
    let x = Math.round(e.x - cx - s.w / 2), y = Math.round(e.y - cy - s.h + 2 + hover - fall * 140);
    const p2 = Boss.phase === 2;
    ctx.globalAlpha = 1 - fall * 0.6;
    // Phase two: a crown of black spikes and candle flames behind the mitre.
    if (p2) {
      const hx = e.x - cx, hy = y + 6;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(time * 0.4);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        ctx.fillStyle = '#0d0b10';
        ctx.save(); ctx.rotate(a); ctx.fillRect(14, -1, 9, 2); ctx.restore();
        if (i % 3 === 0) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = COLORS.crimsonHot;
          ctx.fillRect(Math.round(Math.cos(a) * 24) - 1, Math.round(Math.sin(a) * 24) - 1, 2, 2);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      ctx.restore();
    }
    if (Boss.vulnT > 0) {
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(time * 14);
      const gw = silhouetteCache(s, 'gold', flip);
      ctx.drawImage(gw, x - 1, y); ctx.drawImage(gw, x + 1, y); ctx.drawImage(gw, x, y - 1); ctx.drawImage(gw, x, y + 1);
      ctx.globalAlpha = 1 - fall * 0.6;
    } else if (e.exposedT > 0) {
      ctx.globalAlpha = 0.45 + 0.3 * Math.sin(time * 10);
      const gw = flip ? mirrorCache(s.ghost[0]) : s.ghost[0];
      ctx.drawImage(gw, x - 1, y); ctx.drawImage(gw, x + 1, y); ctx.drawImage(gw, x, y - 1); ctx.drawImage(gw, x, y + 1);
      ctx.globalAlpha = 1 - fall * 0.6;
    }
    const img = e.flash > 0 ? (flip ? s.whiteFlip[0] : s.white[0]) : (flip ? s.flip[0] : s.frames[0]);
    ctx.drawImage(img, x, y);
    // Glowing eyes
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = p2 ? COLORS.crimsonHot : COLORS.cyan;
    const ex = flip ? s.w - 1 : 0;
    const eyeX1 = x + Math.abs(ex - 10), eyeX2 = x + Math.abs(ex - 14);
    ctx.globalAlpha = 0.9;
    ctx.fillRect(eyeX1, y + 13, 1, 1); ctx.fillRect(eyeX2, y + 13, 1, 1);
    ctx.globalAlpha = 0.4;
    ctx.drawImage(p2 ? Assets.lights.crimson : Assets.lights.cyan, x + s.w / 2 - 8, y + 6, 16, 16);
    ctx.globalCompositeOperation = 'source-over';
    // Crozier with a hanging bell
    const side = flip ? -1 : 1;
    const sx0 = e.x - cx + side * 13, top = y - 4;
    ctx.globalAlpha = 1 - fall * 0.6;
    ctx.fillStyle = '#9b7c3a';
    ctx.fillRect(Math.round(sx0), Math.round(top + 6), 1, s.h - 6);
    ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx0 + side * 4, top + 6, 4, Math.PI, flip ? Math.PI * 2.0 : 0, !flip); ctx.stroke();
    const swing = (e.bellSwing || 0) > 0 ? Math.sin(time * 18) * 0.6 * e.bellSwing : Math.sin(time * 1.4) * 0.15;
    if (e.bellSwing > 0) e.bellSwing -= 1 / 60;
    const bx = sx0 + side * 8 + Math.sin(swing) * 4, by = top + 10 + Math.cos(swing) * 3;
    ctx.fillStyle = Boss.state === 'tele' && Boss.attack === 'toll' ? COLORS.crimsonHot : COLORS.gold;
    ctx.beginPath(); ctx.moveTo(bx - 3, by + 4); ctx.lineTo(bx - 2, by); ctx.lineTo(bx + 2, by); ctx.lineTo(bx + 3, by + 4); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  },

  drawPlayer(ctx, cx, cy, time) {
    const P = G.player;
    const s = Assets.sprites[P.char.sprite];
    const moving = Math.hypot(P.vx, P.vy) > 12;
    const fi = moving ? Math.floor(P.animT) % 2 : 0;
    const flip = P.face < 0;
    const x = Math.round(P.x - cx - s.w / 2), y = Math.round(P.y - cy - s.h + 2) + (moving && fi ? -1 : 0);
    if (P.dead) {
      const d = s.dissolve[Math.min(3, Math.floor(G.deathT * 2.5))];
      ctx.globalAlpha = Math.max(0, 1 - G.deathT * 0.4);
      ctx.drawImage(flip ? mirrorCache(d) : d, x, y + Math.min(4, G.deathT * 6));
      ctx.globalAlpha = 1;
      return;
    }
    // Pale gold ground ring keeps the player legible in a crowd.
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(P.x - cx, P.y - cy + 1, 8, 3.5, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    const blink = P.inv > 0 && P.dashT <= 0 && Math.floor(time * 18) % 2 === 0;
    if (!blink) {
      const img = P.hurtT > 0 ? (flip ? s.whiteFlip[fi] : s.white[fi]) : (flip ? s.flip[fi] : s.frames[fi]);
      ctx.drawImage(img, x, y);
    }
    // The Last Bell hovers overhead once Resonance is full, and swings when rung.
    if (P.res >= 100 || P.bellSwing > 0) {
      const bell = Assets.icons.bellIcon;
      const swing = P.bellSwing > 0 ? Math.sin(P.bellSwing * 24) * 0.5 * P.bellSwing : Math.sin(time * 3) * 0.12;
      const bx = P.x - cx, by = y - 9 + Math.round(Math.sin(time * 4) * 1);
      ctx.save();
      ctx.translate(Math.round(bx), Math.round(by - 6));
      ctx.rotate(swing);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + Math.sin(time * 5) * 0.2;
      ctx.drawImage(Assets.lights.cyan, -12, -6, 24, 24);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(bell, 0, 0, 16, 16, -4, 0, 8, 8);
      ctx.restore();
    }
  },

  drawSweeps(ctx, cx, cy) {
    const P = G.player;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of G.sweeps) {
      if (s.t < 0 || s.cur === undefined) continue;
      const fade = s.t > s.dur ? 1 - (s.t - s.dur) / 0.12 : 1;
      const x = P.x - cx, y = P.y - 4 - cy;
      const trail = Math.min(s.arc, 1.5);
      const a1 = s.cur, a0 = s.cur - s.side * trail;
      const col = s.evolved ? COLORS.cyan : COLORS.bone;
      for (let i = 0; i < 4; i++) {
        const t0 = a1 - s.side * trail * (i / 4), t1 = a1 - s.side * trail * ((i + 1) / 4);
        ctx.globalAlpha = 0.42 * fade * (1 - i / 4);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, s.r, Math.min(t0, t1), Math.max(t0, t1));
        ctx.arc(x, y, s.r * 0.62, Math.max(t0, t1), Math.min(t0, t1), true);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 0.95 * fade;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, s.r, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a1) * s.r * 0.55, y + Math.sin(a1) * s.r * 0.55); ctx.lineTo(x + Math.cos(a1) * s.r * 1.05, y + Math.sin(a1) * s.r * 1.05); ctx.stroke();
    }
    ctx.restore();
  },

  drawProjectiles(ctx, cx, cy) {
    const v = G.view;
    G.projs.forEach(p => {
      const x = p.x - cx, y = p.y - cy;
      if (x < -30 || y < -30 || x > v.w + 30 || y > v.h + 30) return;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      if (p.kind === 'dagger' || p.kind === 'spear') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = p.kind === 'spear' ? COLORS.cyan : COLORS.bone;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-Math.cos(p.ang) * 10, -Math.sin(p.ang) * 10); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.rotate(p.ang);
        const img = Assets.sprites[p.kind].frames[0];
        ctx.drawImage(img, -img.width + 2, -1);
      } else if (p.kind === 'crescent') {
        ctx.rotate(p.ang);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5 * Math.min(1, p.life / 0.2);
        ctx.drawImage(Assets.lights.cyan, -p.r * 2, -p.r * 2, p.r * 4, p.r * 4);
        ctx.globalAlpha = Math.min(1, p.life / 0.2);
        ctx.strokeStyle = '#e9fffd'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(-p.r * 0.6, 0, p.r, -1.1, 1.1); ctx.stroke();
      } else if (p.kind === 'slab') {
        const img = Assets.sprites.slab.frames[0];
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.drawImage(Assets.lights.moon, -p.r * 2.2, -p.r * 2.2, p.r * 4.4, p.r * 4.4);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.95;
        ctx.rotate(Math.sin(p.spin) * 0.35);
        const sc = Math.max(1, Math.round(p.scale));
        ctx.drawImage(img, -img.width * sc / 2, -img.height * sc / 2, img.width * sc, img.height * sc);
      }
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  },

  drawShots(ctx, cx, cy, time) {
    const v = G.view;
    G.shots.forEach(s => {
      const x = s.x - cx, y = s.y - cy;
      if (x < -10 || y < -10 || x > v.w + 10 || y > v.h + 10) return;
      const r = s.r;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6;
      ctx.drawImage(Assets.lights.crimson, x - r * 3, y - r * 3, r * 6, r * 6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.ink;
      ctx.beginPath(); ctx.arc(x, y, r + 1, 0, TAU); ctx.fill();
      ctx.fillStyle = s.kind === 'boss' ? '#ff2f4c' : COLORS.crimson;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd6dc';
      const pr = (Math.sin(time * 14 + s.t * 5) > 0 ? 1.5 : 1);
      ctx.fillRect(Math.round(x - pr / 2), Math.round(y - pr / 2), Math.ceil(pr), Math.ceil(pr));
    });
  },

  drawRings(ctx, cx, cy) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const g of G.rings) {
      const k = g.r / g.maxR;
      const x = g.x - cx, y = g.y - cy;
      if (g.purge) {
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.strokeStyle = g.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, g.r, 0, TAU); ctx.stroke();
        continue;
      }
      ctx.globalAlpha = (1 - k) * 0.95;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = Math.max(1, g.width * (1 - k * 0.7));
      ctx.beginPath(); ctx.arc(x, y, g.r, 0, TAU); ctx.stroke();
      if (g.bell) {
        ctx.globalAlpha = (1 - k) * 0.6;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, g.r * 0.86, 0, TAU); ctx.stroke();
        ctx.globalAlpha = (1 - k) * 0.12;
        ctx.fillStyle = g.color;
        ctx.beginPath(); ctx.arc(x, y, g.r, 0, TAU); ctx.fill();
      }
    }
    // Hostile tolls: crimson rings with gaps you can slip through.
    for (const t of G.tolls) {
      const x = t.x - cx, y = t.y - cy;
      const gapsSorted = t.gaps.map(gp => gp + t.rot).sort((a, b) => a - b);
      for (let i = 0; i < gapsSorted.length; i++) {
        const a0 = gapsSorted[i] + t.gapW / 2;
        const a1 = (i + 1 < gapsSorted.length ? gapsSorted[i + 1] : gapsSorted[0] + TAU) - t.gapW / 2;
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = COLORS.ink; ctx.lineWidth = t.w + 2;
        ctx.beginPath(); ctx.arc(x, y, t.r, a0, a1); ctx.stroke();
        ctx.strokeStyle = COLORS.crimson; ctx.lineWidth = t.w;
        ctx.beginPath(); ctx.arc(x, y, t.r, a0, a1); ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = COLORS.crimsonHot; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, t.r, a0, a1); ctx.stroke();
      }
    }
    ctx.restore();
  },

  drawFx(ctx, cx, cy, time) {
    for (const f of G.fx) {
      if (f.type === 'delay' || f.type === 'text') continue;
      const k = 1 - f.life / f.max;
      const x = f.x - cx, y = f.y - cy;
      ctx.save();
      switch (f.type) {
        case 'bolt': {
          ctx.globalCompositeOperation = 'lighter';
          const pts = f.pts;
          for (let pass = 0; pass < 2; pass++) {
            ctx.globalAlpha = (pass ? 1 : 0.35) * (1 - k);
            ctx.strokeStyle = pass ? '#ffffff' : f.color;
            ctx.lineWidth = pass ? f.width : f.width + 2.5;
            ctx.beginPath();
            for (let i = 0; i < pts.length - 1; i++) {
              const a = pts[i], b = pts[i + 1];
              if (i === 0) ctx.moveTo(a.x - cx, a.y - cy);
              const segs = 3;
              for (let s = 1; s <= segs; s++) {
                const t = s / segs;
                const jx = s < segs ? rand(-4, 4) : 0, jy = s < segs ? rand(-4, 4) : 0;
                ctx.lineTo(lerp(a.x, b.x, t) - cx + jx, lerp(a.y, b.y, t) - cy + jy);
              }
            }
            ctx.stroke();
          }
          break;
        }
        case 'burst': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.translate(x, y);
          if (f.sigil) ctx.scale(1, 0.75);
          ctx.globalAlpha = (1 - k) * 0.55;
          ctx.fillStyle = f.color;
          ctx.beginPath(); ctx.arc(0, 0, f.r * (0.4 + k * 0.7), 0, TAU); ctx.fill();
          ctx.globalAlpha = (1 - k);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(0, 0, f.r * (0.5 + k * 0.6), 0, TAU); ctx.stroke();
          break;
        }
        case 'shock': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.translate(x, y); ctx.scale(1, 0.75);
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = f.color; ctx.lineWidth = 3 * (1 - k) + 1;
          ctx.beginPath(); ctx.arc(0, 0, f.r * (0.6 + k * 0.5), 0, TAU); ctx.stroke();
          break;
        }
        case 'pentagram': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - k) * 0.8;
          ctx.strokeStyle = COLORS.crimsonHot; ctx.lineWidth = 1;
          ctx.beginPath();
          const order = [0, 2, 4, 1, 3, 0];
          order.forEach((i, n) => { const p = f.pts[i]; if (n === 0) ctx.moveTo(p.x - cx, p.y - cy); else ctx.lineTo(p.x - cx, p.y - cy); });
          ctx.stroke();
          break;
        }
        case 'pillar': {
          ctx.globalCompositeOperation = 'lighter';
          const w = f.r * 0.9 * (1 - k * 0.5);
          ctx.globalAlpha = (1 - k) * 0.8;
          const grad = ctx.createLinearGradient(0, y - 90, 0, y);
          grad.addColorStop(0, 'rgba(255,74,94,0)'); grad.addColorStop(0.6, 'rgba(255,74,94,0.8)'); grad.addColorStop(1, 'rgba(255,220,225,1)');
          ctx.fillStyle = grad;
          ctx.fillRect(x - w / 2, y - 90, w, 90);
          ctx.translate(x, y); ctx.scale(1, 0.75);
          ctx.strokeStyle = COLORS.crimsonHot; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, f.r * (0.8 + k * 0.4), 0, TAU); ctx.stroke();
          break;
        }
        case 'after': {
          if (f.boss) {
            const s = Assets.sprites.archbishop;
            ctx.globalAlpha = (1 - k) * 0.35;
            const img = silhouetteCache(s, 'crimson', f.face < 0);
            ctx.drawImage(img, Math.round(x - s.w / 2), Math.round(y - s.h - 6));
          } else {
            const s = Assets.sprites[G.player.char.sprite];
            ctx.globalAlpha = (1 - k) * 0.5;
            const img = f.face < 0 ? mirrorCache(s.ghost[0]) : s.ghost[0];
            ctx.drawImage(img, Math.round(x - s.w / 2), Math.round(y - s.h + 2));
          }
          break;
        }
        case 'rise': {
          ctx.translate(x, y); ctx.scale(1, 0.4);
          ctx.globalAlpha = 0.6 * (1 - k * 0.5);
          ctx.fillStyle = '#0d0b10';
          ctx.beginPath(); ctx.arc(0, 0, 4 + k * 5, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.5 * (1 - k);
          ctx.strokeStyle = COLORS.crimson; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, 6 + k * 4, 0, TAU); ctx.stroke();
          break;
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  drawParticles(ctx, cx, cy) {
    const v = G.view;
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass ? 'lighter' : 'source-over';
      for (let i = 0; i < PART_MAX; i++) {
        if (Parts.life[i] <= 0 || Parts.add[i] !== pass) continue;
        const x = Parts.x[i] - cx, y = Parts.y[i] - cy;
        if (x < -4 || y < -4 || x > v.w + 4 || y > v.h + 4) continue;
        ctx.globalAlpha = Math.min(1, (Parts.life[i] / Parts.max[i]) * 1.4);
        ctx.fillStyle = Parts.col[i];
        const s = Parts.size[i];
        ctx.fillRect(Math.round(x), Math.round(y), s, s);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  drawFog(ctx, cx, cy, time) {
    if (!this.fogPale) return;
    const v = G.view;
    const red = Director.mood > 1.5;
    const pat = red ? this.fogRed : this.fogPale;
    const layers = [[0.6, 7, 0.1, 2], [0.85, -11, 0.07, 3]];
    for (const [par, drift, a, sc] of layers) {
      const offX = cx * par + time * drift, offY = cy * par + time * drift * 0.3;
      pat.setTransform(new DOMMatrix().scaleSelf(sc, sc).translateSelf(-offX / sc, -offY / sc));
      ctx.globalAlpha = a * (red ? 1.3 : 1) * (G.state === 'title' ? 1.4 : 1);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, v.w, v.h);
    }
    ctx.globalAlpha = 1;
  },

  // ======================================================================
  // UI canvas: crisp text, numbers, HUD
  renderUI(time) {
    const c = this.uctx, u = this.u;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.ui.width, this.ui.height);
    c.imageSmoothingEnabled = false;
    if (G.state === 'title' || !G.player) return;
    this.drawWorldUI(c, u, time);
    if (G.settings.hud !== false) this.drawHUD(c, u, time);
  },

  font(px, display) { return `${Math.round(px * this.u)}px ${display ? '"Jacquarda Bastarda 9", "UnifrakturMaguntia", serif' : '"Pixelify Sans", "Courier New", monospace'}`; },

  text(c, str, x, y, size, color, align = 'left', display = false, outline = true) {
    c.font = this.font(size, display);
    c.textAlign = align;
    c.textBaseline = 'middle';
    if (outline) {
      c.lineWidth = Math.max(2, this.u * 1.2);
      c.strokeStyle = 'rgba(8,6,12,0.92)';
      c.lineJoin = 'round';
      c.strokeText(str, x, y);
    }
    c.fillStyle = color;
    c.fillText(str, x, y);
  },

  drawWorldUI(c, u, time) {
    const cx = G.cam.sx, cy = G.cam.sy, v = G.view;
    const W = (x) => (x - cx) * u, H = (y) => (y - cy) * u;
    // Damage numbers
    G.numbers.forEach(n => {
      const a = n.t < 0.55 ? 1 : 1 - (n.t - 0.55) / 0.2;
      c.globalAlpha = clamp(a, 0, 1);
      let size = 7, col = '#d8d2c6';
      if (n.kind === 'crit') { size = 10 + Math.max(0, 0.12 - n.t) * 30; col = '#fff1c9'; }
      else if (n.kind === 'bleed') { size = 6; col = COLORS.crimsonHot; }
      else if (n.kind === 'burn') { size = 6; col = COLORS.cyan; }
      else if (n.kind === 'player') { size = 10; col = COLORS.crimsonHot; }
      else if (n.kind === 'heal') { size = 9; col = COLORS.gold; }
      else if (n.kind === 'immune') { size = 6; col = '#8a8590'; }
      this.text(c, n.kind === 'crit' ? n.text + '!' : n.text, W(n.x), H(n.y), size, col, 'center');
    });
    c.globalAlpha = 1;
    for (const f of G.fx) {
      if (f.type !== 'text') continue;
      c.globalAlpha = clamp(f.life / f.max * 2, 0, 1);
      this.text(c, f.text, W(f.x), H(f.y), 8, f.color, 'center');
    }
    c.globalAlpha = 1;
    // Elite health bars and off-screen indicators
    const P = G.player;
    for (const e of G.enemies) {
      if (!(e.elite || e.def.special === 'thief') || e.emerge > 0) continue;
      const s = Assets.sprites[e.def.sprite];
      if (onScreen(e.x, e.y, 0)) {
        if (e.elite) {
          const bw = 30, bx = W(e.x) - (bw * u) / 2, by = H(e.y - s.h - 6);
          c.fillStyle = 'rgba(8,6,12,0.85)'; c.fillRect(bx - u, by - u, (bw + 2) * u, 4 * u);
          c.fillStyle = '#3a0a12'; c.fillRect(bx, by, bw * u, 2 * u);
          c.fillStyle = e.exposedT > 0 ? COLORS.cyan : COLORS.crimson; c.fillRect(bx, by, bw * u * clamp(e.hp / e.maxHp, 0, 1), 2 * u);
        }
      } else {
        this.edgeArrow(c, u, e.x, e.y, e.elite ? COLORS.crimson : COLORS.gold, time);
      }
    }
    for (const p of G.pickups) if (p.type === 'chest' && !onScreen(p.x, p.y, 0)) this.edgeArrow(c, u, p.x, p.y, COLORS.gold, time);
    if (G.boss && !G.boss.dead && G.boss.emerge <= 0 && !onScreen(G.boss.x, G.boss.y, 0)) this.edgeArrow(c, u, G.boss.x, G.boss.y, COLORS.crimsonHot, time, 1.6);
    void P; void v;
  },

  edgeArrow(c, u, wx, wy, color, time, size = 1) {
    const v = G.view;
    const cx = G.cam.sx + v.w / 2, cy = G.cam.sy + v.h / 2;
    const a = Math.atan2(wy - cy, wx - cx);
    const m = 14;
    const hw = v.w / 2 - m, hh = v.h / 2 - m;
    const t = Math.min(Math.abs(Math.cos(a)) > 1e-3 ? hw / Math.abs(Math.cos(a)) : 1e9, Math.abs(Math.sin(a)) > 1e-3 ? hh / Math.abs(Math.sin(a)) : 1e9);
    const x = (v.w / 2 + Math.cos(a) * t) * u, y = (v.h / 2 + Math.sin(a) * t) * u;
    c.save();
    c.translate(x, y); c.rotate(a);
    c.globalAlpha = 0.75 + 0.25 * Math.sin(time * 6);
    c.fillStyle = color;
    c.scale(size, size);
    c.beginPath(); c.moveTo(6 * u, 0); c.lineTo(-3 * u, -4 * u); c.lineTo(-3 * u, 4 * u); c.closePath(); c.fill();
    c.restore();
    c.globalAlpha = 1;
  },

  icon(c, name, x, y, scale) {
    const img = Assets.icons[name];
    if (!img) return;
    c.drawImage(img, Math.round(x), Math.round(y), img.width * scale, img.height * scale);
  },

  drawHUD(c, u, time) {
    const P = G.player, v = G.view;
    const Wpx = v.w * u;
    // --- Experience bar
    c.fillStyle = '#0d0b10'; c.fillRect(0, 0, Wpx, 5 * u);
    c.fillStyle = '#2a2418'; c.fillRect(0, 0, Wpx, 4 * u);
    const xpk = clamp(P.xp / P.xpNext, 0, 1);
    c.fillStyle = COLORS.goldDim; c.fillRect(0, 0, Wpx * xpk, 4 * u);
    c.fillStyle = COLORS.gold; c.fillRect(0, 0, Wpx * xpk, 2 * u);
    this.text(c, 'LV ' + P.level, Wpx - 6 * u, 11 * u, 8, COLORS.gold, 'right');

    // --- Health
    const hx = 8 * u, hy = 10 * u, hw = 96 * u, hh = 7 * u;
    c.fillStyle = '#0d0b10'; c.fillRect(hx - u, hy - u, hw + 2 * u, hh + 2 * u);
    c.fillStyle = '#2a0b12'; c.fillRect(hx, hy, hw, hh);
    c.fillStyle = '#e7e1d3'; c.fillRect(hx, hy, hw * clamp(P.hpTrail / P.s.maxHp, 0, 1), hh);
    const hpk = clamp(P.hp / P.s.maxHp, 0, 1);
    const lowPulse = hpk < 0.3 ? 0.5 + 0.5 * Math.sin(time * 10) : 0;
    c.fillStyle = lowPulse > 0.5 ? COLORS.crimsonHot : COLORS.crimson; c.fillRect(hx, hy, hw * hpk, hh);
    c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(hx, hy, hw * hpk, 2 * u);
    this.text(c, Math.ceil(P.hp) + ' / ' + P.s.maxHp, hx + hw + 5 * u, hy + hh / 2, 7, COLORS.bone);

    // --- Dash charges
    for (let i = 0; i < P.s.dashCharges; i++) {
      const dx = hx + i * 10 * u, dy = hy + hh + 4 * u;
      const ready = i < P.dashCharges;
      const prog = i === P.dashCharges ? P.dashRecharge / P.s.dashCd : 0;
      c.save(); c.translate(dx + 3 * u, dy + 3 * u); c.rotate(Math.PI / 4);
      c.fillStyle = '#0d0b10'; c.fillRect(-3 * u, -3 * u, 6 * u, 6 * u);
      c.fillStyle = ready ? COLORS.cyan : '#1f3a40'; c.fillRect(-2 * u, -2 * u, 4 * u, 4 * u);
      if (!ready && prog > 0) { c.fillStyle = COLORS.cyanDim; c.fillRect(-2 * u, 2 * u - 4 * u * prog, 4 * u, 4 * u * prog); }
      c.restore();
    }
    this.text(c, 'DASH', hx + P.s.dashCharges * 10 * u + 2 * u, hy + hh + 7 * u, 6, '#7d7884');

    // --- Buffs
    let bxp = hx + 44 * u;
    const buff = (label, t, col) => { this.text(c, label + ' ' + Math.ceil(t), bxp, hy + hh + 7 * u, 6, col); bxp += 40 * u; };
    if (G.buffs.frenzy > 0) buff('FRENZY', G.buffs.frenzy, COLORS.gold);
    if (G.buffs.fury > 0) buff('FURY', G.buffs.fury, COLORS.cyan);

    // --- Weapons and passives
    let y = hy + hh + 14 * u;
    P.weapons.forEach((w, i) => {
      const def = WEAPONS[w.id];
      const x = hx + i * 19 * u;
      c.fillStyle = 'rgba(13,11,16,0.75)'; c.fillRect(x - u, y - u, 18 * u, 18 * u);
      if (def.evolved) { c.strokeStyle = COLORS.cyan; c.lineWidth = u; c.strokeRect(x - u * 0.5, y - u * 0.5, 17 * u, 17 * u); }
      this.icon(c, def.icon, x, y, u);
      if (!def.evolved) for (let k = 0; k < def.max; k++) { c.fillStyle = k < w.lv ? COLORS.gold : '#3a3542'; c.fillRect(x + k * 3 * u + u, y + 17 * u, 2 * u, 2 * u); }
    });
    y += 22 * u;
    P.passiveOrder.forEach((id, i) => {
      const def = PASSIVES[id];
      const x = hx + i * 19 * u;
      c.fillStyle = 'rgba(13,11,16,0.75)'; c.fillRect(x - u, y - u, 18 * u, 18 * u);
      this.icon(c, def.icon, x, y, u);
      for (let k = 0; k < def.max; k++) { c.fillStyle = k < P.passives[id] ? COLORS.bone : '#3a3542'; c.fillRect(x + k * 3 * u + u, y + 17 * u, 2 * u, 2 * u); }
    });
    if (P.covenants.size) {
      y += (P.passiveOrder.length ? 22 : 0) * u;
      let i = 0;
      for (const id of P.covenants) {
        const x = hx + (i % 8) * 17 * u, yy = y + Math.floor(i / 8) * 17 * u;
        c.fillStyle = 'rgba(36,28,14,0.75)'; c.fillRect(x - u, yy - u, 17 * u, 17 * u);
        this.icon(c, COVENANTS[id].icon, x, yy, u);
        i++;
      }
    }

    // --- Moon timer
    const mx = (v.w / 2) * u, my = 14 * u;
    const prog = clamp(G.time / 390, 0, 1);
    const mr = 7 * u;
    c.fillStyle = '#0d0b10'; c.beginPath(); c.arc(mx - 30 * u, my, mr + u, 0, TAU); c.fill();
    c.fillStyle = Director.mood > 1.5 ? '#b0283c' : Director.mood < 0 ? '#f2e2b8' : '#d9dbe6';
    c.beginPath(); c.arc(mx - 30 * u, my, mr, 0, TAU); c.fill();
    if (Director.mood >= 0) {
      c.fillStyle = '#0d0b10';
      c.beginPath(); c.arc(mx - 30 * u + (1 - prog) * mr * 2.1, my - prog * u, mr * (0.96 + prog * 0.06), 0, TAU); c.fill();
    }
    this.text(c, fmtTime(G.time), mx - 18 * u, my, 13, COLORS.bone, 'left', false);
    const phase = PHASES[Director.phase];
    if (!(G.boss && !G.boss.dead)) this.text(c, phase.name.toUpperCase(), mx, my + 13 * u, 6, Director.phase >= 3 ? COLORS.crimsonHot : '#8a8590', 'center');

    // --- Kills
    this.icon(c, 'skullIcon', Wpx - 64 * u, 16 * u, u * 0.75);
    this.text(c, String(G.stats.kills), Wpx - 50 * u, 21 * u, 8, COLORS.bone);

    // --- Resonance bell: the bell fills with cyan from the rim upward.
    const bx = (v.w / 2) * u, by = (v.h - 30) * u;
    const res = P.res / 100;
    const full = P.res >= 100;
    const ring = 21 * u;
    if (full) {
      c.globalAlpha = 0.3 + 0.25 * Math.sin(time * 5);
      c.fillStyle = COLORS.cyan;
      c.beginPath(); c.arc(bx, by, ring + 3 * u, 0, TAU); c.fill();
      c.globalAlpha = 1;
    }
    c.fillStyle = 'rgba(13,11,16,0.85)';
    c.beginPath(); c.arc(bx, by, ring + u, 0, TAU); c.fill();
    c.strokeStyle = '#2b2733'; c.lineWidth = 2 * u;
    c.beginPath(); c.arc(bx, by, ring - u, 0, TAU); c.stroke();
    c.strokeStyle = full ? COLORS.cyan : COLORS.cyanDim;
    c.beginPath(); c.arc(bx, by, ring - u, -Math.PI / 2, -Math.PI / 2 + TAU * res); c.stroke();
    const bsz = 32 * u; // the 16px icon at 2 logical pixels per icon pixel
    const bx0 = Math.round(bx - bsz / 2), by0 = Math.round(by - bsz / 2 + 2 * u);
    c.drawImage(this.bellDim, bx0, by0, bsz, bsz);
    const fh = Math.round(16 * res);
    if (fh > 0) c.drawImage(this.bellCyan, 0, 16 - fh, 16, fh, bx0, by0 + (16 - fh) * (bsz / 16), bsz, fh * (bsz / 16));
    if (full) this.text(c, 'SPACE · RING', bx, by + 26 * u, 7, COLORS.cyan, 'center');
    else this.text(c, Math.floor(P.res) + '%', bx, by + 26 * u, 6, '#6a8f95', 'center');

    // --- Boss bar
    if (G.boss && !G.boss.dead && G.boss.emerge <= 0) {
      const e = G.boss;
      const bw = Math.min(360, v.w * 0.6) * u, bxx = (v.w * u - bw) / 2, byy = 36 * u;
      this.text(c, e.def.title, v.w * u / 2, byy - 6 * u, 11, Boss.phase === 2 ? COLORS.crimsonHot : COLORS.bone, 'center', true);
      c.fillStyle = '#0d0b10'; c.fillRect(bxx - u, byy - u, bw + 2 * u, 7 * u);
      c.fillStyle = '#2a0b12'; c.fillRect(bxx, byy, bw, 5 * u);
      const k = clamp(e.hp / e.maxHp, 0, 1);
      c.fillStyle = Boss.vulnT > 0 ? COLORS.gold : e.exposedT > 0 ? COLORS.cyan : COLORS.crimson;
      c.fillRect(bxx, byy, bw * k, 5 * u);
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(bxx, byy, bw * k, u);
      c.fillStyle = COLORS.bone; c.fillRect(bxx + bw * 0.5 - u / 2, byy - u, u, 7 * u);
      if (Boss.vulnT > 0) this.text(c, 'VULNERABLE', v.w * u / 2, byy + 12 * u, 7, COLORS.gold, 'center');
      else if (Boss.state === 'tele' && G.player.res >= 100 && Boss.interruptCd <= 0) this.text(c, 'RING THE BELL TO INTERRUPT', v.w * u / 2, byy + 12 * u, 7, COLORS.cyan, 'center');
    }

    // --- Control hints (fade once each action is understood)
    const hints = [];
    const ht = G.hints.t;
    if (G.hints.move < 1.5 && ht < 20) hints.push(['WASD / ARROWS', 'Move']);
    if (!G.hints.dash && ht > 2 && ht < 45) hints.push(['SHIFT', 'Dash through danger']);
    if (!G.hints.bell && (G.hints.bellShown || (ht > 6 && ht < 40))) hints.push(['SPACE', G.player.res >= 100 ? 'Ring the Last Bell' : 'Ring the Bell (collect cyan Echoes)']);
    hints.forEach((h, i) => {
      const yy = (v.h - 74 - i * 13) * u;
      const a = 0.75 + 0.25 * Math.sin(time * 3 + i);
      c.globalAlpha = a;
      c.font = this.font(7);
      const kw = c.measureText(h[0]).width + 8 * u;
      const tw = c.measureText(h[1]).width;
      const total = kw + 6 * u + tw;
      const x0 = (v.w * u - total) / 2;
      c.fillStyle = 'rgba(13,11,16,0.85)'; c.fillRect(x0 - 3 * u, yy - 6 * u, total + 6 * u, 12 * u);
      c.strokeStyle = '#4a4552'; c.lineWidth = u; c.strokeRect(x0, yy - 4.5 * u, kw, 9 * u);
      this.text(c, h[0], x0 + kw / 2, yy, 7, COLORS.gold, 'center', false, false);
      this.text(c, h[1], x0 + kw + 6 * u, yy, 7, COLORS.bone, 'left', false, false);
    });
    c.globalAlpha = 1;
  },
};

// Lazily mirrored canvases for rarely-flipped variants.
const _mirrorCache = new WeakMap();
function mirrorCache(img) {
  let m = _mirrorCache.get(img);
  if (!m) { m = mirror(img); _mirrorCache.set(img, m); }
  return m;
}
const _silCache = {};
function silhouetteCache(s, color, flip) {
  const key = s.name + color + flip;
  if (!_silCache[key]) {
    const base = silhouette(s.frames[0], color === 'gold' ? COLORS.gold : color === 'crimson' ? COLORS.crimson : color);
    _silCache[key] = flip ? mirror(base) : base;
  }
  return _silCache[key];
}
