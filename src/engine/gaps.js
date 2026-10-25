// @ts-check
// Candidate gaps: places where a stroke stops just short of another line.
// For each real stroke end, find the nearest ink that is close in a straight line
// but far away along the ink itself (so it's a different part of the drawing). Pure, no DOM.

import { emptyAlong, drawLine } from './raster.js';
import { labelComponents } from './label.js';

/**
 * @typedef {{ax:number, ay:number, bx:number, by:number, gapPx:number}} Gap
 */

/**
 * @param {Uint8Array} ink @param {number} w @param {number} h
 * @param {{x:number, y:number, dx:number, dy:number}[]} ends
 * @param {{searchR:number, geoLimit:number, strokeW:number}} o
 * @returns {Gap[]}
 */
export function findGaps(ink, w, h, ends, o) {
  const stamp = new Int32Array(w * h);
  const front = new Int32Array(w * h);
  /** @type {Gap[]} */
  const gaps = [];
  const R = Math.ceil(o.searchR);
  const R2 = o.searchR * o.searchR;

  ends.forEach((e, i) => {
    const id = i + 1;
    // 1. Walk the ink from the stroke end, up to geoLimit steps: that's "this same line".
    const start = e.y * w + e.x;
    let head = 0;
    let tail = 0;
    front[tail++] = start;
    stamp[start] = id;
    for (let depth = 0; depth < o.geoLimit && head < tail; depth++) {
      const end = tail;
      while (head < end) {
        const p = front[head++];
        const x = p % w;
        const y = (p - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (ink[q] && stamp[q] !== id) {
              stamp[q] = id;
              front[tail++] = q;
            }
          }
        }
      }
    }
    // 2. Nearest ink within searchR that this walk didn't reach, roughly ahead of the stroke.
    let best = -1;
    let bestD = Infinity;
    for (let dy = -R; dy <= R; dy++) {
      const y = e.y + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const x = e.x + dx;
        if (x < 0 || x >= w) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        const q = y * w + x;
        if (!ink[q] || stamp[q] === id) continue;
        // Not behind the stroke end: the gap continues the line's direction (within ~100°).
        const along = (dx * e.dx + dy * e.dy) / Math.sqrt(d2);
        if (along < -0.2) continue;
        if (d2 < bestD) {
          bestD = d2;
          best = q;
        }
      }
    }
    if (best < 0) return;
    const bx = best % w;
    const by = (best - bx) / w;
    const gapPx = emptyAlong(ink, w, e.x, e.y, bx, by);
    if (gapPx < 0.5) return; // already touching
    gaps.push({ ax: e.x, ay: e.y, bx, by, gapPx });
  });

  // Two ends facing each other give the same gap twice: keep the shorter.
  gaps.sort((a, b) => a.gapPx - b.gapPx);
  /** @type {Gap[]} */
  const kept = [];
  for (const g of gaps) {
    const mx = (g.ax + g.bx) / 2;
    const my = (g.ay + g.by) / 2;
    const dup = kept.some((k) => Math.hypot((k.ax + k.bx) / 2 - mx, (k.ay + k.by) / 2 - my) < o.strokeW * 1.5);
    if (!dup) kept.push(g);
  }
  return kept;
}

/**
 * Necks: places where a paper region is pinched narrower than the leak width between two bigger parts.
 * Catches gaps without a stroke end — e.g. two curves that run into each other but never quite touch.
 * Method: keep only paper deeper than `coreR` from any line (the "cores"), grow the cores back,
 * and wherever two different cores meet inside one region, that seam is a neck.
 * @param {Uint8Array} ink @param {Float32Array} toInk distance from paper to the nearest ink
 * @param {number} w @param {number} h
 * @param {{coreR:number, minPart:number}} o
 * @returns {Gap[]}
 */
export function findNecks(ink, toInk, w, h, o) {
  const n = w * h;
  const own = new Int32Array(n);
  const queue = new Int32Array(n);
  let qt = 0;
  // 1. Cores, labelled with a flood fill.
  let cores = 0;
  for (let p = 0; p < n; p++) {
    if (ink[p] || own[p] || toInk[p] < o.coreR) continue;
    cores++;
    const start = qt;
    own[p] = cores;
    queue[qt++] = p;
    for (let k = start; k < qt; k++) {
      const s = queue[k];
      const x = s % w;
      const nbs = [x > 0 ? s - 1 : -1, x < w - 1 ? s + 1 : -1, s - w, s + w];
      for (const q of nbs) {
        if (q < 0 || q >= n || ink[q] || own[q] || toInk[q] < o.coreR) continue;
        own[q] = cores;
        queue[qt++] = q;
      }
    }
  }
  // 2. Grow every core back out over the shallow paper (breadth-first ≈ nearest core).
  for (let k = 0; k < qt; k++) {
    const s = queue[k];
    const x = s % w;
    const nbs = [x > 0 ? s - 1 : -1, x < w - 1 ? s + 1 : -1, s - w, s + w];
    for (const q of nbs) {
      if (q < 0 || q >= n || ink[q] || own[q]) continue;
      own[q] = own[s];
      queue[qt++] = q;
    }
  }
  const area = new Int32Array(cores + 1);
  for (let p = 0; p < n; p++) if (own[p]) area[own[p]]++;

  // 3. Seams between different cores.
  /** @type {Map<number, number[]>} */
  const seams = new Map();
  const K = cores + 1;
  const add = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ p) => {
    const key = a < b ? a * K + b : b * K + a;
    let list = seams.get(key);
    if (!list) seams.set(key, (list = []));
    list.push(p);
  };
  for (let p = 0; p < n; p++) {
    const a = own[p];
    if (!a) continue;
    const x = p % w;
    if (x < w - 1 && own[p + 1] && own[p + 1] !== a) add(a, own[p + 1], a > own[p + 1] ? p : p + 1);
    if (p + w < n && own[p + w] && own[p + w] !== a) add(a, own[p + w], a > own[p + w] ? p : p + w);
  }

  // 4. Each seam between two big-enough parts becomes a cut across the neck.
  /** @type {Gap[]} */
  const out = [];
  for (const [key, px] of seams) {
    const a = Math.floor(key / K);
    const b = key % K;
    if (area[a] < o.minPart || area[b] < o.minPart) continue;
    if (px.length > 6 * o.coreR + 6) continue; // a long border isn't a neck
    let sx = 0, sy = 0, depth = 0;
    for (const p of px) {
      const x = p % w;
      sx += x;
      sy += (p - x) / w;
      if (toInk[p] > depth) depth = toInk[p];
    }
    const cx = sx / px.length;
    const cy = sy / px.length;
    // Principal direction of the seam pixels.
    let xx = 0, yy = 0, xy = 0;
    for (const p of px) {
      const x = (p % w) - cx;
      const y = (p - (p % w)) / w - cy;
      xx += x * x;
      yy += y * y;
      xy += x * y;
    }
    const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let lo = Infinity, hi = -Infinity;
    for (const p of px) {
      const t = ((p % w) - cx) * dx + ((p - (p % w)) / w - cy) * dy;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    // Extend one pixel past each end so the cut meets the lines on both sides.
    out.push({
      ax: Math.round(cx + (lo - 1) * dx),
      ay: Math.round(cy + (lo - 1) * dy),
      bx: Math.round(cx + (hi + 1) * dx),
      by: Math.round(cy + (hi + 1) * dy),
      gapPx: Math.max(1, 2 * depth - 1),
    });
  }
  return out;
}

/**
 * Openings: places where a line stops short of the next one (up to `maxGapPx`) and closing it
 * would make a sizeable piece of its own — typically a circle that doesn't quite close (a sun
 * drawn behind a tower). All nearby openings are closed together on a copy, so a shape with two
 * openings is still found. Gaps that matter as leaks are reported as leaks instead; these are hints.
 * @param {Uint8Array} solid the drawing as it is (1 = line or cut)
 * @param {Int32Array} closedLabels areas with the leak-sized candidates closed (what the guess used)
 * @param {Int32Array} nowLabels areas of the drawing as it is (nothing closed)
 * @param {number} w @param {number} h
 * @param {{x:number, y:number, dx:number, dy:number}[]} ends stroke ends
 * @param {{minGapPx:number, maxGapPx:number, minPartPx:number, strokeW:number, area?: ArrayLike<number>}} o
 * @returns {Gap[]}
 */
export function findOpenings(solid, closedLabels, nowLabels, w, h, ends, o) {
  const R = o.maxGapPx + o.strokeW / 2 + 1;
  const wide = findGaps(solid, w, h, ends, { searchR: R, geoLimit: Math.round(2 * R + 2 * o.strokeW), strokeW: o.strokeW })
    .filter((g) => g.gapPx > o.minGapPx && g.gapPx <= o.maxGapPx);
  if (!wide.length) return [];
  // Close every candidate (and keep the leak-sized closures already in closedLabels).
  const n = w * h;
  const shut = new Uint8Array(n);
  for (let p = 0; p < n; p++) shut[p] = closedLabels[p] ? 0 : 1;
  for (const g of wide) drawLine(shut, w, h, g.ax, g.ay, g.bx, g.by, 1);
  const parts = labelComponents(shut, w, h, 0, false);
  /** @type {Gap[]} */
  const out = [];
  for (const g of wide) {
    const len = Math.hypot(g.bx - g.ax, g.by - g.ay) || 1;
    const nx = -(g.by - g.ay) / len, ny = (g.bx - g.ax) / len;
    const cx = (g.ax + g.bx) / 2, cy = (g.ay + g.by) / 2;
    /** First open pixel on one side of the closing stroke. @param {number} sgn */
    const side = (sgn) => {
      for (let t = 2; t <= o.strokeW + 8; t++) {
        const x = Math.round(cx + sgn * nx * t), y = Math.round(cy + sgn * ny * t);
        if (x < 0 || y < 0 || x >= w || y >= h) return -1;
        const q = y * w + x;
        if (parts.labels[q]) return q;
      }
      return -1;
    };
    const a = side(1), b = side(-1);
    if (a < 0 || b < 0) continue;
    const pa = parts.labels[a], pb = parts.labels[b];
    if (pa === pb || parts.border[pa] || parts.border[pb]) continue; // no split, or it's the outside
    if (Math.min(parts.area[pa], parts.area[pb]) < o.minPartPx) continue;
    // Only if it matters: in the drawing as it is, both sides are still one area.
    if (nowLabels[a] !== nowLabels[b]) continue;
    out.push(g);
  }
  return out;
}
