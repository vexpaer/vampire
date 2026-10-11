'use strict';
// ---------------------------------------------------------------------------
// The arena: an abandoned cathedral courtyard. Static scenery is painted once
// per run into a single ground canvas (landmarks fixed, minor details seeded
// per run). Animated details (candles, stained glass, fountain) are listed
// for the renderer.
// ---------------------------------------------------------------------------

const World = {
  ground: null, gctx: null,
  obstacles: [], obsGrid: null, obsCell: 200,
  candles: [], glows: [], fog: null, seed: 1,
  fountain: { x: 1200, y: 1250, r: 30 },
  plaza: { x: 1200, y: 1250, r: 215 },
  stainsThisFrame: 0,
  fogTint: [200, 205, 220],

  inStone(x, y) {
    const p = this.plaza;
    if (dist2(x, y, p.x, p.y) < p.r * p.r) return true;
    if (x > 1138 && x < 1262 && y > 330) return true;            // nave road
    if (y > 1193 && y < 1307) return true;                        // east-west road
    if (x > 830 && x < 1570 && y > 326 && y < 470) return true;   // forecourt
    if (x > 1800 && x < 2020 && y > 520 && y < 690) return true;  // chapel floor
    return false;
  },

  generate(seed) {
    this.seed = seed;
    const rng = makeRng(seed);
    const W = ARENA.w, H = ARENA.h;
    if (!this.ground) { this.ground = makeCanvas(W, H); this.gctx = this.ground.getContext('2d'); }
    const g = this.gctx;
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    this.obstacles = [];
    this.candles = [];
    this.glows = [];

    // --- Earth: blocky value noise upscaled for a pixel-art grain.
    const noise = makeNoise(seed * 7 + 3, 64);
    const BW = W / 4, BH = H / 4;
    const lo = makeCanvas(BW, BH), lg = lo.getContext('2d');
    const img = lg.createImageData(BW, BH);
    const d = img.data;
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < BW; x++) {
        const n = noise.fbm(x / 22, y / 22, 3);
        const fine = noise(x / 3.1 + 40, y / 3.1 + 17);
        const v = 34 + n * 22 + fine * 7;
        const warm = noise(x / 60 + 90, y / 60 + 12);
        const i = (y * BW + x) * 4;
        d[i] = v + warm * 6; d[i + 1] = v - 1 + warm * 3; d[i + 2] = v + 6 - warm * 4; d[i + 3] = 255;
      }
    }
    lg.putImageData(img, 0, 0);
    g.drawImage(lo, 0, 0, W, H);

    // Dead grass tufts and pebbles on the earth.
    for (let i = 0; i < 9000; i++) {
      const x = rng() * W, y = rng() * H;
      if (this.inStone(x, y)) continue;
      const t = rng();
      if (t < 0.6) {
        g.fillStyle = rng.pick(['#3a3833', '#33312d', '#43403a', '#2d2b29']);
        g.fillRect(x | 0, y | 0, 1, 2 + (rng() * 2) | 0);
        g.fillRect((x + 1) | 0, (y + 1) | 0, 1, 1 + (rng() * 2) | 0);
      } else {
        g.fillStyle = rng.pick(['#4a4650', '#3e3a44', '#2a2730']);
        g.fillRect(x | 0, y | 0, 1 + (rng() * 2) | 0, 1);
      }
    }

    // --- Flagstone roads and forecourt
    const stoneCol = () => {
      const v = 52 + rng() * 13;
      return `rgb(${v | 0},${(v - 3) | 0},${(v + 5) | 0})`;
    };
    const drawStone = (x, y, w, h) => {
      g.fillStyle = 'rgba(20,18,24,0.55)';
      g.fillRect(x, y, w, h);
      g.fillStyle = stoneCol();
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
      // Worn, rounded corners
      g.fillStyle = 'rgba(20,18,24,0.5)';
      g.fillRect(x + 1, y + 1, 1, 1); g.fillRect(x + w - 2, y + 1, 1, 1);
      g.fillRect(x + 1, y + h - 2, 1, 1); g.fillRect(x + w - 2, y + h - 2, 1, 1);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(x + 2, y + 1, w - 4, 1);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x + 2, y + h - 2, w - 4, 1);
      if (rng() < 0.3) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x + 2 + rng() * (w - 6), y + 2 + rng() * (h - 5), 2 + rng() * 3, 1 + rng() * 2); }
      if (rng() < 0.14) this.crack(g, rng, x + rng() * w, y + rng() * h, 3 + rng() * 9);
    };
    const edgeErode = (x, y) => {
      // Stones near a road's edge crumble away irregularly.
      const n = noise(x / 18 + 300, y / 18 + 200);
      return n < 0.28;
    };
    for (let y = 320; y < H;) {
      const rh = rng.pick([12, 15, 18, 18, 21]);
      let x = -rng.int(0, 20);
      while (x < W) {
        const w = rng.int(16, 34);
        const cx = x + w / 2, cy = y + rh / 2;
        if (this.inStone(cx, cy) && dist2(cx, cy, this.plaza.x, this.plaza.y) > (this.plaza.r + 4) ** 2) {
          const nearEdge = !this.inStone(cx + 22, cy) || !this.inStone(cx - 22, cy) || !this.inStone(cx, cy + 22) || !this.inStone(cx, cy - 22);
          if (!(nearEdge && edgeErode(cx, cy)) && rng() > 0.03) {
            // Occasionally split a slab into two smaller stones.
            if (w > 26 && rng() < 0.3) { const h1 = Math.floor(rh / 2); drawStone(x | 0, y, w, h1); drawStone(x | 0, y + h1, w, rh - h1); }
            else drawStone(x | 0, y, w, rh);
          }
        }
        x += w;
      }
      y += rh;
    }

    // --- Plaza: concentric rings of stone around the fountain
    const P0 = this.plaza;
    for (let r = 40; r < P0.r; r += 13) {
      const n = Math.round((TAU * r) / 22);
      const off = rng() * TAU;
      for (let i = 0; i < n; i++) {
        if (r > P0.r - 30 && rng() < 0.18) continue;
        const a0 = off + (i / n) * TAU, a1 = off + ((i + 1) / n) * TAU - 0.025;
        g.beginPath();
        g.arc(P0.x, P0.y, r + 12, a0, a1);
        g.arc(P0.x, P0.y, r + 1, a1, a0, true);
        g.closePath();
        g.fillStyle = 'rgba(20,18,24,0.6)';
        g.fill();
        g.beginPath();
        g.arc(P0.x, P0.y, r + 11, a0 + 0.01, a1 - 0.01);
        g.arc(P0.x, P0.y, r + 2, a1 - 0.01, a0 + 0.01, true);
        g.closePath();
        g.fillStyle = stoneCol();
        g.fill();
      }
    }
    // A pale inlaid circle: the old moon dial
    g.strokeStyle = 'rgba(200,196,186,0.18)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(P0.x, P0.y, 150, 0, TAU); g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      g.fillStyle = 'rgba(210,205,190,0.28)';
      g.fillRect((P0.x + Math.cos(a) * 150 - 2) | 0, (P0.y + Math.sin(a) * 150 - 2) | 0, 4, 4);
    }
    for (let i = 0; i < 40; i++) this.crack(g, rng, P0.x + rng.range(-P0.r, P0.r) * 0.8, P0.y + rng.range(-P0.r, P0.r) * 0.8, 6 + rng() * 18);

    // --- Perimeter walls
    this.drawWalls(g, rng);

    // --- Cathedral facade (north)
    this.drawCathedral(g, rng);

    // --- Fountain
    this.drawFountain(g);

    // --- Colonnade along the nave road
    const colY = [520, 640, 760, 880, 1000];
    colY.forEach((y, i) => {
      for (const x of [1110, 1290]) {
        const broken = (i + (x > 1200 ? 1 : 0)) % 2 === 1 || rng() < 0.15;
        this.prop(g, broken ? 'pillarBroken' : 'pillar', x, y);
        this.addCircle(x, y - 3, 7);
        if (rng() < 0.4) this.rubble(g, rng, x + rng.range(-12, 12), y + rng.range(2, 10), 4);
      }
    });

    // --- Statues ringing the plaza
    const sAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
    sAngles.forEach((a, i) => {
      const x = Math.round(P0.x + Math.cos(a) * 250), y = Math.round(P0.y + Math.sin(a) * 250);
      this.prop(g, i === 1 || (i === 3 && rng() < 0.5) ? 'statueBroken' : 'statue', x, y);
      this.addCircle(x, y - 4, 9);
      this.candleCluster(g, rng, x, y + 8, 3);
    });

    // --- The great fallen bell
    this.prop(g, 'bellRuin', 1540, 1000);
    this.addCircle(1540, 994, 13);
    this.crack(g, rng, 1528, 1004, 30);
    this.crack(g, rng, 1556, 1002, 24);

    // --- Graveyard (south-west)
    this.drawGraveyard(g, rng);

    // --- Ruined chapel (east)
    this.drawChapel(g, rng);

    // --- Crater of bones (south-east)
    const cx0 = 1860, cy0 = 1880;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(cx0, cy0, 90, 60, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath(); g.ellipse(cx0, cy0 + 4, 60, 38, 0, 0, TAU); g.fill();
    for (let i = 0; i < 26; i++) this.prop(g, rng() < 0.75 ? 'bones' : 'skull', cx0 + rng.range(-70, 70), cy0 + rng.range(-40, 45), false);

    // --- Skeletal trees (seeded per run)
    const trees = [];
    let tries = 0;
    while (trees.length < 26 && tries++ < 900) {
      const x = rng.range(90, W - 90), y = rng.range(500, H - 90);
      if (this.inStone(x, y) || this.inStone(x + 20, y) || this.inStone(x - 20, y)) continue;
      if (x > 260 && x < 940 && y > 1450 && y < 2290) continue; // graveyard interior
      if (x > 1760 && x < 2060 && y > 490 && y < 720) continue; // chapel
      if (dist2(x, y, cx0, cy0) < 120 * 120) continue;
      if (this.blocked(x, y, 40)) continue;
      if (trees.some(t => dist2(t.x, t.y, x, y) < 150 * 150)) continue;
      trees.push({ x, y });
    }
    for (const t of trees) { this.drawTree(g, rng, t.x, t.y); this.addCircle(t.x, t.y - 2, 5); }

    // --- Scattered remnants
    for (let i = 0; i < 140; i++) {
      const x = rng.range(70, W - 70), y = rng.range(420, H - 70);
      if (this.blocked(x, y, 18)) continue;
      const t = rng();
      if (t < 0.35) this.prop(g, 'bones', x, y, false);
      else if (t < 0.45) this.prop(g, 'skull', x, y, false);
      else if (t < 0.75) this.rubble(g, rng, x, y, 3 + (rng() * 4) | 0);
      else if (t < 0.9) this.stainOld(g, rng, x, y);
      else this.candleCluster(g, rng, x, y, 1 + (rng() * 2) | 0);
    }

    // Moonlight: very soft diagonal shading baked over everything.
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(140,150,190,0.05)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    this.buildObsGrid();
    if (!this.fog) this.fog = this.makeFog();
    this.fogTint = [rng.int(190, 210), rng.int(196, 214), rng.int(210, 230)];
  },

  prop(g, name, x, y, shadow = true) {
    const s = Assets.sprites[name];
    if (!s) return;
    const img = s.frames[0];
    const px = Math.round(x - img.width / 2), py = Math.round(y - img.height + 2);
    if (shadow) {
      g.fillStyle = 'rgba(5,4,8,0.45)';
      g.beginPath(); g.ellipse(x + 3, y + 1, img.width * 0.55, 3.5, 0, 0, TAU); g.fill();
      // Long moon shadow cast toward the south-east
      g.fillStyle = 'rgba(5,4,8,0.18)';
      g.beginPath();
      g.moveTo(px + 2, y); g.lineTo(px + img.width, y);
      g.lineTo(px + img.width + img.height * 0.5, y + img.height * 0.35); g.lineTo(px + 2 + img.height * 0.5, y + img.height * 0.35);
      g.closePath(); g.fill();
    }
    g.drawImage(img, px, py);
  },

  crack(g, rng, x, y, len) {
    g.fillStyle = 'rgba(10,8,14,0.55)';
    let a = rng() * TAU;
    for (let i = 0; i < len; i++) {
      g.fillRect(x | 0, y | 0, 1, 1);
      a += rng.range(-0.7, 0.7);
      x += Math.cos(a); y += Math.sin(a);
      if (rng() < 0.08) this.crack(g, rng, x, y, len * 0.4);
    }
  },

  rubble(g, rng, x, y, n) {
    for (let i = 0; i < n; i++) {
      const rx = x + rng.range(-7, 7), ry = y + rng.range(-4, 4);
      const w = 2 + (rng() * 3) | 0, h = 1 + (rng() * 2) | 0;
      g.fillStyle = '#16141a'; g.fillRect(rx | 0, (ry + 1) | 0, w, h);
      g.fillStyle = rng.pick(['#58535e', '#4a4650', '#666070']); g.fillRect(rx | 0, ry | 0, w, h);
    }
  },

  stainOld(g, rng, x, y) {
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(${60 + rng() * 30},10,20,${0.12 + rng() * 0.12})`;
      g.fillRect((x + rng.range(-8, 8)) | 0, (y + rng.range(-5, 5)) | 0, 2 + (rng() * 4) | 0, 1 + (rng() * 3) | 0);
    }
  },

  candleCluster(g, rng, x, y, n) {
    for (let i = 0; i < n; i++) {
      const cx = Math.round(x + rng.range(-9, 9)), cy = Math.round(y + rng.range(-3, 4));
      const h = 3 + (rng() * 4) | 0;
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(cx - 1, cy, 4, 1);
      g.fillStyle = '#d8d0bd'; g.fillRect(cx, cy - h, 2, h);
      g.fillStyle = '#a8a090'; g.fillRect(cx + 1, cy - h, 1, h);
      this.candles.push({ x: cx + 1, y: cy - h - 1, ph: rng() * TAU });
    }
  },

  drawTree(g, rng, x, y) {
    const h = rng.range(26, 40);
    // Shadow cast by moonlight
    g.strokeStyle = 'rgba(5,4,8,0.22)';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + h * 0.7, y + h * 0.45); g.stroke();
    g.fillStyle = 'rgba(5,4,8,0.4)';
    g.beginPath(); g.ellipse(x + 1, y + 1, 7, 3, 0, 0, TAU); g.fill();
    const branch = (bx, by, a, len, w, depth) => {
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      g.strokeStyle = depth > 2 ? '#141217' : '#1c1a20';
      g.lineWidth = w;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();
      if (w > 1.5) {
        g.strokeStyle = 'rgba(160,155,150,0.18)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(bx - w / 2 + 0.5, by); g.lineTo(ex - w / 2 + 0.5, ey); g.stroke();
      }
      if (depth <= 0 || len < 3) return;
      const k = rng.int(2, 3);
      for (let i = 0; i < k; i++) branch(ex, ey, a + rng.range(-0.75, 0.75), len * rng.range(0.55, 0.78), Math.max(1, w * 0.62), depth - 1);
    };
    // Gnarled roots
    for (let i = 0; i < 3; i++) branch(x, y, rng.range(-0.3, 0.3) + (i - 1) * 1.2 + Math.PI / 2, 5, 1.5, 0);
    branch(x, y, -Math.PI / 2 + rng.range(-0.15, 0.15), h * 0.45, 4, 4);
  },

  drawWalls(g, rng) {
    const W = ARENA.w, H = ARENA.h, T = 40;
    const block = (x, y, w, h) => {
      g.fillStyle = '#1b1920'; g.fillRect(x, y, w, h);
      for (let by = y; by < y + h; by += 8) {
        let bx = x - (((by - y) / 8) % 2 ? 6 : 0);
        while (bx < x + w) {
          const bw = 10 + ((rng() * 3) | 0) * 2;
          const v = 44 + rng() * 14;
          g.fillStyle = `rgb(${v | 0},${(v - 2) | 0},${(v + 5) | 0})`;
          const x0 = Math.max(bx, x), x1 = Math.min(bx + bw - 1, x + w);
          if (x1 > x0) g.fillRect(x0, by, x1 - x0, 7);
          bx += bw;
        }
      }
    };
    block(0, 0, W, T); block(0, H - T, W, T); block(0, 0, T, H); block(W - T, 0, T, H);
    // Inner lip shadow
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(T, T, W - T * 2, 4); g.fillRect(T, H - T - 2, W - T * 2, 2);
    g.fillRect(T, T, 3, H - T * 2); g.fillRect(W - T - 3, T, 3, H - T * 2);
    // Crumbled breaches
    for (let i = 0; i < 18; i++) {
      const side = i % 4;
      const p = rng.range(200, W - 200);
      const [x, y, w, h] = side === 0 ? [p, H - T, 50, T] : side === 1 ? [0, p, T, 50] : side === 2 ? [W - T, p, T, 50] : [p, H - T, 30, T];
      g.fillStyle = 'rgba(12,10,15,0.7)';
      g.fillRect(x + 6, y + 6, w - 12, h - 12);
      this.rubble(g, rng, x + w / 2, y + h / 2, 6);
    }
  },

  drawCathedral(g, rng) {
    const X0 = 860, X1 = 1540, Y1 = 330;
    // Facade wall
    const wall = (x, y, w, h, base) => {
      g.fillStyle = '#151318'; g.fillRect(x, y, w, h);
      for (let by = y + 1; by < y + h - 1; by += 7) {
        let bx = x + 1 - ((((by - y) / 7) | 0) % 2 ? 5 : 0);
        while (bx < x + w - 1) {
          const bw = 9 + ((rng() * 3) | 0) * 3;
          const v = base + rng() * 10;
          g.fillStyle = `rgb(${v | 0},${(v - 2) | 0},${(v + 6) | 0})`;
          const x0 = Math.max(bx, x + 1), x1 = Math.min(bx + bw - 1, x + w - 1);
          if (x1 > x0) g.fillRect(x0, by, x1 - x0, 6);
          bx += bw;
        }
      }
    };
    // Shadow at the foot of the facade
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(X0 - 10, Y1 - 2, X1 - X0 + 20, 16);
    wall(900, 110, 600, 220, 40);
    // Gable
    g.save();
    g.beginPath(); g.moveTo(980, 112); g.lineTo(1200, 8); g.lineTo(1420, 112); g.closePath(); g.clip();
    wall(980, 0, 440, 114, 46);
    g.restore();
    g.strokeStyle = '#5c5766'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(980, 112); g.lineTo(1200, 8); g.lineTo(1420, 112); g.stroke();
    // Towers
    for (const tx of [X0, X1 - 130]) {
      wall(tx, 20, 130, 310, 50);
      g.fillStyle = '#5a5563'; g.fillRect(tx, 20, 130, 3);
      g.fillStyle = '#0c0b0f';
      for (const wy of [60, 150, 230]) { this.lancet(g, tx + 52, wy, 26, 52, '#0c0b0f'); }
      // Broken crenellations
      for (let cx = tx; cx < tx + 130; cx += 16) if (rng() < 0.7) { g.fillStyle = '#4a4552'; g.fillRect(cx, 10, 10, 10); }
    }
    // Buttresses
    for (const bx of [990, 1110, 1290, 1410]) {
      g.fillStyle = '#4e4957'; g.fillRect(bx, 110, 10, 220);
      g.fillStyle = '#2c2832'; g.fillRect(bx + 7, 110, 3, 220);
    }
    // Lancet windows with faint stained glass
    for (const lx of [1030, 1340]) {
      this.lancet(g, lx, 160, 30, 90, '#120e16');
      g.fillStyle = 'rgba(60,140,150,0.25)'; g.fillRect(lx + 4, 190, 8, 54);
      g.fillStyle = 'rgba(150,30,50,0.25)'; g.fillRect(lx + 16, 190, 8, 54);
      this.glows.push({ x: lx + 15, y: 210, r: 60, color: 'cyan', a: 0.25 });
    }
    // Rose window
    const rx = 1200, ry = 165, rr = 44;
    g.fillStyle = '#4d4856'; g.beginPath(); g.arc(rx, ry, rr + 6, 0, TAU); g.fill();
    g.fillStyle = '#0d0a10'; g.beginPath(); g.arc(rx, ry, rr, 0, TAU); g.fill();
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * TAU, a1 = ((i + 1) / 12) * TAU;
      g.fillStyle = i % 3 === 0 ? 'rgba(170,30,50,0.55)' : i % 3 === 1 ? 'rgba(60,160,170,0.45)' : 'rgba(200,170,100,0.35)';
      if (i === 4 || i === 5) g.fillStyle = 'rgba(10,8,12,1)'; // shattered panes
      g.beginPath(); g.moveTo(rx, ry); g.arc(rx, ry, rr - 4, a0 + 0.04, a1 - 0.04); g.closePath(); g.fill();
    }
    g.strokeStyle = '#6a6474'; g.lineWidth = 2;
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr); g.stroke(); }
    g.beginPath(); g.arc(rx, ry, rr * 0.45, 0, TAU); g.stroke();
    g.fillStyle = '#6a6474'; g.beginPath(); g.arc(rx, ry, 6, 0, TAU); g.fill();
    this.glows.push({ x: rx, y: ry, r: 120, color: 'crimson', a: 0.35, pulse: true });
    // Great door
    this.lancet(g, 1160, 232, 80, 98, '#060508');
    g.fillStyle = 'rgba(120,20,35,0.35)'; g.fillRect(1172, 280, 56, 50);
    g.strokeStyle = '#5c5766'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(1158, 330); g.lineTo(1158, 270); g.quadraticCurveTo(1158, 232, 1200, 228); g.quadraticCurveTo(1242, 232, 1242, 270); g.lineTo(1242, 330); g.stroke();
    this.glows.push({ x: 1200, y: 310, r: 90, color: 'crimson', a: 0.4, pulse: true });
    // Steps
    for (let s = 0; s < 5; s++) {
      const y = 330 + s * 10, inset = 20 - s * 4;
      g.fillStyle = '#26232b'; g.fillRect(1100 + inset, y, 200 - inset * 2, 10);
      g.fillStyle = '#5a5563'; g.fillRect(1100 + inset, y, 200 - inset * 2, 2);
    }
    // Damage: holes and rubble along the base
    for (let i = 0; i < 26; i++) {
      const x = rng.range(X0 + 10, X1 - 10), y = rng.range(Y1 - 8, Y1 + 30);
      this.rubble(g, rng, x, y, 5);
    }
    for (let i = 0; i < 9; i++) {
      const x = rng.range(910, 1490), y = rng.range(120, 300);
      g.fillStyle = '#0d0b10';
      g.fillRect(x | 0, y | 0, rng.int(6, 16), rng.int(4, 10));
    }
    for (let i = 0; i < 14; i++) this.crack(g, rng, rng.range(900, 1500), rng.range(110, 320), 20 + rng() * 30);
    // Guardian statues by the steps
    this.prop(g, 'statue', 1076, 360); this.addCircle(1076, 356, 9);
    this.prop(g, 'statueBroken', 1324, 360); this.addCircle(1324, 356, 9);
    this.candleCluster(g, rng, 1180, 334, 3);
    this.candleCluster(g, rng, 1222, 334, 3);
    this.obstacles.push({ t: 'r', x: X0, y: 0, w: X1 - X0, h: Y1 });
  },

  lancet(g, x, y, w, h, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y + h); g.lineTo(x, y + w * 0.6);
    g.quadraticCurveTo(x, y, x + w / 2, y);
    g.quadraticCurveTo(x + w, y, x + w, y + w * 0.6);
    g.lineTo(x + w, y + h); g.closePath(); g.fill();
  },

  drawFountain(g) {
    const { x, y } = this.fountain;
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.ellipse(x + 3, y + 4, 38, 34, 0, 0, TAU); g.fill();
    g.fillStyle = '#5f5a68'; g.beginPath(); g.arc(x, y, 34, 0, TAU); g.fill();
    g.fillStyle = '#7a7484'; g.beginPath(); g.arc(x, y - 1, 33, Math.PI, TAU); g.fill();
    g.fillStyle = '#2a2730'; g.beginPath(); g.arc(x, y, 29, 0, TAU); g.fill();
    g.fillStyle = '#0c1219'; g.beginPath(); g.arc(x, y, 27, 0, TAU); g.fill();
    // Broken crescent-moon spire in the centre
    g.fillStyle = '#4a4552'; g.beginPath(); g.arc(x, y + 2, 7, 0, TAU); g.fill();
    g.fillStyle = '#b8b2a6'; g.beginPath(); g.arc(x, y - 6, 7, 0, TAU); g.fill();
    g.fillStyle = '#0c1219'; g.beginPath(); g.arc(x + 3, y - 8, 6, 0, TAU); g.fill();
    this.addCircle(x, y, 31);
  },

  drawGraveyard(g, rng) {
    const X0 = 280, Y0 = 1470, X1 = 930, Y1 = 2270;
    // Darker, softer earth
    g.fillStyle = 'rgba(10,8,12,0.22)'; g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    // Iron fence with wide gaps
    const fence = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / 6);
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        if ((i % 40) > 30) continue; // gaps
        g.fillStyle = '#121016'; g.fillRect(x | 0, (y - 8) | 0, 1, 9);
        g.fillStyle = '#3a3642'; g.fillRect(x | 0, (y - 9) | 0, 1, 1);
      }
      g.strokeStyle = '#121016'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, y0 - 6); g.lineTo(x1, y1 - 6); g.stroke();
    };
    fence(X0, Y0, X1, Y0); fence(X0, Y1, X1, Y1); fence(X0, Y0, X0, Y1); fence(X1, Y0, X1, Y1);
    // Rows of graves
    for (let y = Y0 + 50; y < Y1 - 30; y += 44) {
      for (let x = X0 + 40; x < X1 - 30; x += 34) {
        if (rng() < 0.28) continue;
        const gx = x + rng.range(-6, 6), gy = y + rng.range(-5, 5);
        // Grave mound
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect((gx - 6) | 0, (gy + 1) | 0, 12, 14);
        g.fillStyle = 'rgba(80,70,60,0.18)'; g.fillRect((gx - 5) | 0, (gy + 2) | 0, 10, 12);
        this.prop(g, rng.pick(['tomb1', 'tomb2', 'tomb3']), gx, gy);
        if (rng() < 0.12) this.candleCluster(g, rng, gx, gy + 6, 2);
      }
    }
    // Two mausoleums
    for (const [mx, my] of [[470, 1700], [760, 2030]]) this.drawMausoleum(g, rng, mx, my);
  },

  drawMausoleum(g, rng, x, y) {
    const w = 70, h = 58;
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x - w / 2 + 6, y + 4, w, 12);
    g.fillStyle = '#16141a'; g.fillRect(x - w / 2, y - h, w, h);
    g.fillStyle = '#4f4a58'; g.fillRect(x - w / 2 + 2, y - h + 2, w - 4, h - 4);
    g.fillStyle = '#625c6c'; g.fillRect(x - w / 2 + 2, y - h + 2, w - 4, 14);
    g.fillStyle = '#3a3642'; for (let i = 0; i < 5; i++) g.fillRect(x - w / 2 + 6 + i * 13, y - h + 18, 4, h - 22);
    this.lancet(g, x - 10, y - 34, 20, 34, '#08070a');
    g.fillStyle = 'rgba(60,160,170,0.18)'; g.fillRect(x - 6, y - 24, 12, 22);
    this.glows.push({ x, y: y - 10, r: 40, color: 'cyan', a: 0.18 });
    this.candleCluster(g, rng, x - 22, y + 4, 2);
    this.candleCluster(g, rng, x + 22, y + 4, 2);
    for (let i = 0; i < 3; i++) this.crack(g, rng, x + rng.range(-30, 30), y - rng.range(10, 50), 14);
    this.obstacles.push({ t: 'r', x: x - w / 2, y: y - h + 10, w, h: h - 10 });
  },

  drawChapel(g, rng) {
    const X0 = 1800, Y0 = 520, X1 = 2020, Y1 = 690, T = 12;
    // Cracked chequered floor already laid by the road pass; add a dais and altar.
    g.fillStyle = '#2c2832'; g.fillRect(1880, 540, 60, 26);
    g.fillStyle = '#625c6c'; g.fillRect(1880, 540, 60, 3);
    g.fillStyle = '#4a4552'; g.fillRect(1895, 546, 30, 12);
    this.candleCluster(g, rng, 1910, 548, 4);
    const seg = (x, y, w, h) => {
      g.fillStyle = '#16141a'; g.fillRect(x, y, w, h);
      g.fillStyle = '#58535f'; g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.fillStyle = '#6e6878'; g.fillRect(x + 1, y + 1, w - 2, 2);
      this.obstacles.push({ t: 'r', x, y, w, h });
    };
    // North wall with a breach, west and east walls broken, south side open.
    seg(X0, Y0, 80, T); seg(X0 + 140, Y0, X1 - X0 - 140, T);
    seg(X0, Y0, T, 70);
    seg(X1 - T, Y0, T, 50); seg(X1 - T, Y0 + 110, T, 60);
    for (let i = 0; i < 12; i++) this.rubble(g, rng, rng.range(X0, X1), rng.range(Y0, Y1 + 10), 4);
    this.glows.push({ x: 1910, y: 548, r: 50, color: 'warm', a: 0.3 });
  },

  addCircle(x, y, r) { this.obstacles.push({ t: 'c', x, y, r }); },

  blocked(x, y, margin) {
    for (const o of this.obstacles) {
      if (o.t === 'c') { if (dist2(x, y, o.x, o.y) < (o.r + margin) ** 2) return true; }
      else if (x > o.x - margin && x < o.x + o.w + margin && y > o.y - margin && y < o.y + o.h + margin) return true;
    }
    return false;
  },

  buildObsGrid() {
    const c = this.obsCell;
    const cols = Math.ceil(ARENA.w / c) + 1, rows = Math.ceil(ARENA.h / c) + 1;
    this.obsCols = cols; this.obsRows = rows;
    this.obsGrid = Array.from({ length: cols * rows }, () => []);
    for (const o of this.obstacles) {
      const x0 = o.t === 'c' ? o.x - o.r : o.x, x1 = o.t === 'c' ? o.x + o.r : o.x + o.w;
      const y0 = o.t === 'c' ? o.y - o.r : o.y, y1 = o.t === 'c' ? o.y + o.r : o.y + o.h;
      for (let cy = Math.max(0, Math.floor((y0 - 24) / c)); cy <= Math.min(rows - 1, Math.floor((y1 + 24) / c)); cy++) {
        for (let cx = Math.max(0, Math.floor((x0 - 24) / c)); cx <= Math.min(cols - 1, Math.floor((x1 + 24) / c)); cx++) {
          this.obsGrid[cy * cols + cx].push(o);
        }
      }
    }
  },

  // Push a circle out of any obstacle. Returns the obstacle touched, or null.
  collide(ent, r) {
    if (!this.obsGrid) return null;
    const cx = Math.floor(ent.x / this.obsCell), cy = Math.floor(ent.y / this.obsCell);
    if (cx < 0 || cy < 0 || cx >= this.obsCols || cy >= this.obsRows) return null;
    const list = this.obsGrid[cy * this.obsCols + cx];
    let hit = null;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.t === 'c') {
        const dx = ent.x - o.x, dy = ent.y - o.y, rr = o.r + r;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr) {
          const dd = Math.sqrt(d2) || 0.01;
          ent.x = o.x + (dx / dd) * rr; ent.y = o.y + (dy / dd) * rr;
          hit = o;
        }
      } else {
        const nx = clamp(ent.x, o.x, o.x + o.w), ny = clamp(ent.y, o.y, o.y + o.h);
        const dx = ent.x - nx, dy = ent.y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 < r * r) {
          if (d2 > 0.0001) {
            const dd = Math.sqrt(d2);
            ent.x = nx + (dx / dd) * r; ent.y = ny + (dy / dd) * r;
          } else {
            // Centre inside the rectangle: exit through the nearest side.
            const l = ent.x - o.x, rt = o.x + o.w - ent.x, t = ent.y - o.y, b = o.y + o.h - ent.y;
            const m = Math.min(l, rt, t, b);
            if (m === l) ent.x = o.x - r; else if (m === rt) ent.x = o.x + o.w + r;
            else if (m === t) ent.y = o.y - r; else ent.y = o.y + o.h + r;
          }
          hit = o;
        }
      }
    }
    return hit;
  },

  // Fresh blood soaks into the stones and stays for the rest of the run.
  stain(x, y, size, crimsonBias = 1) {
    if (this.stainsThisFrame > 8 || !this.gctx) return;
    this.stainsThisFrame++;
    const g = this.gctx;
    const n = 3 + (size * 2) | 0;
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(${(70 + Math.random() * 50) * crimsonBias | 0},${8 + Math.random() * 8 | 0},${16 + Math.random() * 10 | 0},${0.18 + Math.random() * 0.2})`;
      const w = 1 + (Math.random() * size * 1.5) | 0;
      g.fillRect((x + rand(-size * 2, size * 2)) | 0, (y + rand(-size, size)) | 0, w, Math.max(1, (w * 0.6) | 0));
    }
  },

  scorch(x, y, r) {
    if (!this.gctx) return;
    const g = this.gctx;
    g.fillStyle = 'rgba(8,6,10,0.07)';
    g.beginPath(); g.ellipse(x, y, r, r * 0.7, 0, 0, TAU); g.fill();
  },

  makeFog() {
    const S = 256, c = makeCanvas(S, S), x = c.getContext('2d');
    const n = makeNoise(991, 8);
    const img = x.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let xx = 0; xx < S; xx++) {
        const v = n.fbm(xx / 32, y / 32, 4);
        const a = clamp((v - 0.42) * 2.6, 0, 1);
        const i = (y * S + xx) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = a * 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  },
};
