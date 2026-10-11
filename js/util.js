'use strict';
// ---------------------------------------------------------------------------
// Shared math, randomness, pools and spatial partitioning.
// Every script shares the global scope (no modules) so the game runs from
// file:// as well as from any static host.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const chance = p => Math.random() < p;
const pick = arr => arr[(Math.random() * arr.length) | 0];
const sign = v => (v < 0 ? -1 : 1);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
const angleDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const damp = (k, dt) => 1 - Math.exp(-k * dt); // frame-rate independent smoothing factor

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function weightedPick(items, weightOf) {
  let total = 0;
  for (const it of items) total += Math.max(0, weightOf(it));
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(0, weightOf(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// Seeded RNG for deterministic world generation (mulberry32).
function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  rng.pick = arr => arr[Math.floor(rng() * arr.length)];
  rng.chance = p => rng() < p;
  return rng;
}

// 2D value noise, tileable over `period` lattice cells.
function makeNoise(seed, period = 256) {
  const rng = makeRng(seed);
  const vals = new Float32Array(period * period);
  for (let i = 0; i < vals.length; i++) vals[i] = rng();
  const smooth = t => t * t * (3 - 2 * t);
  const at = (x, y) => vals[((y % period + period) % period) * period + ((x % period + period) % period)];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
  };
  n.fbm = (x, y, oct = 4) => {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { sum += n(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return sum / norm;
  };
  return n;
}

const Ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outQuad: t => 1 - (1 - t) * (1 - t),
};

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// Uniform grid over the (extended) arena. Linked lists in typed arrays: no
// per-frame allocation, O(1) inserts, cheap neighbourhood queries.
class SpatialGrid {
  constructor(minX, minY, maxX, maxY, cell, capacity) {
    this.minX = minX; this.minY = minY; this.cell = cell;
    this.cols = Math.ceil((maxX - minX) / cell);
    this.rows = Math.ceil((maxY - minY) / cell);
    this.head = new Int32Array(this.cols * this.rows);
    this.next = new Int32Array(capacity);
    this.items = new Array(capacity);
    this.count = 0;
  }
  clear() { this.head.fill(-1); this.count = 0; }
  cellX(x) { return clamp(((x - this.minX) / this.cell) | 0, 0, this.cols - 1); }
  cellY(y) { return clamp(((y - this.minY) / this.cell) | 0, 0, this.rows - 1); }
  insert(e) {
    if (this.count >= this.next.length) return;
    const i = this.count++;
    const c = this.cellY(e.y) * this.cols + this.cellX(e.x);
    this.items[i] = e;
    this.next[i] = this.head[c];
    this.head[c] = i;
  }
  // Fills `out` with entities whose centre lies within r (+ their radius) of (x,y).
  query(x, y, r, out, max = 9999) {
    let n = 0;
    const x0 = this.cellX(x - r - 16), x1 = this.cellX(x + r + 16);
    const y0 = this.cellY(y - r - 16), y1 = this.cellY(y + r + 16);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.head[cy * this.cols + cx];
        while (i !== -1) {
          const e = this.items[i];
          const rr = r + e.r;
          const dx = e.x - x, dy = e.y - y;
          if (dx * dx + dy * dy <= rr * rr) {
            out[n++] = e;
            if (n >= max) return n;
          }
          i = this.next[i];
        }
      }
    }
    return n;
  }
}

// Minimal object pool: objects are recycled instead of garbage collected.
class Pool {
  constructor(factory, size) {
    this.items = [];
    this.factory = factory;
    for (let i = 0; i < size; i++) { const o = factory(); o.active = false; this.items.push(o); }
    this.cursor = 0;
  }
  get() {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n;
      const o = this.items[i];
      if (!o.active) { this.cursor = (i + 1) % n; o.active = true; return o; }
    }
    return null; // pool exhausted: callers simply skip the effect
  }
  forEach(fn) { for (const o of this.items) if (o.active) fn(o); }
  clear() { for (const o of this.items) o.active = false; }
  countActive() { let c = 0; for (const o of this.items) if (o.active) c++; return c; }
}

const Store = {
  key: 'lastbell.save.v1',
  load() {
    try { const raw = localStorage.getItem(this.key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  },
  save(data) {
    try { localStorage.setItem(this.key, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  },
};
