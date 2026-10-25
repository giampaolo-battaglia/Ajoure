// @ts-check
// Flow test (SPEC §6.6, §8.9): pour water into every hole at once and see where it goes.
//
// "Sealed" is the piece as it should be: the drawing as it is now with only the flagged leaks
// closed, each sealed area taking the class the scan expects for it (its leak-free guess).
// Water starts at the deepest point of each sealed hole (and, invisibly, outside the piece)
// and spreads through the drawing as it is now, unable to cross lines or cuts. Wherever it
// reaches a pixel that should be something else (wood, or outside), it has escaped through
// a gap: that water is shown amber. Pure, no DOM: runs in a worker and in Node tests.

import { labelComponents } from './label.js';
import { drawLine } from './raster.js';

const PX_WASTE = 0, PX_WOOD = 1, PX_HOLE = 2, PX_LINE = 3;

/** What each revealed pixel is. */
export const FLOW_CALM = 1; // water inside its own hole
export const FLOW_ESCAPED = 2; // water that got out through a gap

const ORTHO = 5, DIAG = 7, KNIGHT = 11;
const STEPS = [
  [1, 0, ORTHO], [-1, 0, ORTHO], [0, 1, ORTHO], [0, -1, ORTHO],
  [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG],
  [1, 2, KNIGHT], [2, 1, KNIGHT], [-1, 2, KNIGHT], [-2, 1, KNIGHT],
  [1, -2, KNIGHT], [2, -1, KNIGHT], [-1, -2, KNIGHT], [-2, -1, KNIGHT],
];
const SDX = Int8Array.from(STEPS, (t) => t[0]);
const SDY = Int8Array.from(STEPS, (t) => t[1]);
const SC = Int8Array.from(STEPS, (t) => t[2]);
const TIME_MAX = 65535;

/**
 * @typedef {Object} FlowResult
 * @property {Int32Array} order   image pixel indices to reveal, in time order
 * @property {Uint16Array} time   when each is reached (0…65535 = start…end of the pour)
 * @property {Uint8Array} kind    FLOW_CALM / FLOW_ESCAPED per entry
 * @property {number} count
 * @property {{x:number, y:number, t:number}[]} gaps     where water escapes, and when (0…1)
 * @property {{x:number, y:number, area:number}[]} sealed   holes that held (seed point, area px)
 * @property {number} holes        holes tested
 * @property {number} leaking      holes whose water escaped (or that outside water got into)
 * @property {number} ms
 */

/**
 * @param {{
 *   labels: Int32Array, w: number, h: number,
 *   classMap: Uint8Array, fixedClassMap?: Uint8Array|null,
 *   leaks?: {x:number, y:number, ax:number, ay:number, bx:number, by:number}[],
 * }} scan
 * @returns {FlowResult}
 */
export function flowTest(scan) {
  const t0 = Date.now();
  const { labels, w, h } = scan;
  const n = w * h;
  const guess = scan.fixedClassMap || scan.classMap;

  // 0. Sealed areas: current barriers (lines, cuts) plus the flagged leaks closed.
  const barrier = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (!labels[p]) barrier[p] = 1;
  for (const g of scan.leaks || []) drawLine(barrier, w, h, g.ax, g.ay, g.bx, g.by, 1);
  const areas = labelComponents(barrier, w, h, 0, false);
  const votes = new Int32Array((areas.count + 1) * 3);
  for (let p = 0; p < n; p++) {
    const a = areas.labels[p];
    const g = guess[p];
    if (a && g !== PX_LINE) votes[a * 3 + g]++;
  }
  const areaCls = new Uint8Array(areas.count + 1);
  for (let a = 1; a <= areas.count; a++) {
    const v0 = votes[a * 3 + PX_WASTE], v1 = votes[a * 3 + PX_WOOD], v2 = votes[a * 3 + PX_HOLE];
    areaCls[a] = v1 >= v0 && v1 >= v2 ? PX_WOOD : v2 >= v0 ? PX_HOLE : PX_WASTE;
  }
  // Per pixel: what it should be. The closing strokes themselves count as line.
  const sealed = new Uint8Array(n);
  for (let p = 0; p < n; p++) sealed[p] = areas.labels[p] ? areaCls[areas.labels[p]] : PX_LINE;

  // 1. Sealed holes (4-connected) and the outside, each a water source.
  const holeMask = new Uint8Array(n);
  const wasteMask = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!labels[p]) continue; // lines and cuts: water can't be there
    if (sealed[p] === PX_HOLE) holeMask[p] = 1;
    else if (sealed[p] === PX_WASTE) wasteMask[p] = 1;
  }
  const holes = labelComponents(holeMask, w, h, 1, false);
  const outside = labelComponents(wasteMask, w, h, 1, false);
  const nh = holes.count;
  const nSrc = nh + outside.count;
  // Source s (1…nh) = hole s; nh + k = outside part k.
  /** @param {number} p */
  const compOf = (p) => (holeMask[p] ? holes.labels[p] : wasteMask[p] ? nh + outside.labels[p] : 0);

  // 2. Deepest point of each source (two-pass chamfer distance to its edge).
  const depth = new Uint16Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const c = compOf(p);
      if (!c) continue;
      let d = 65535;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        compOf(p - 1) !== c || compOf(p + 1) !== c || compOf(p - w) !== c || compOf(p + w) !== c;
      if (edge) d = 3;
      else {
        d = Math.min(depth[p - 1] + 3, depth[p - w] + 3);
        if (x + 1 < w && compOf(p - w + 1) === c) d = Math.min(d, depth[p - w + 1] + 4);
        if (compOf(p - w - 1) === c) d = Math.min(d, depth[p - w - 1] + 4);
      }
      depth[p] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      const c = compOf(p);
      if (!c) continue;
      let d = depth[p];
      if (x + 1 < w && compOf(p + 1) === c) d = Math.min(d, depth[p + 1] + 3);
      if (y + 1 < h && compOf(p + w) === c) d = Math.min(d, depth[p + w] + 3);
      if (y + 1 < h && x + 1 < w && compOf(p + w + 1) === c) d = Math.min(d, depth[p + w + 1] + 4);
      if (y + 1 < h && x > 0 && compOf(p + w - 1) === c) d = Math.min(d, depth[p + w - 1] + 4);
      depth[p] = d;
    }
  }
  const seed = new Int32Array(nSrc + 1).fill(-1);
  for (let p = 0; p < n; p++) {
    const c = compOf(p);
    if (c && (seed[c] < 0 || depth[p] > depth[seed[c]])) seed[c] = p;
  }

  // 3. All sources pour at once (Dial's algorithm on 5/7/11 steps, never jumping a line).
  const dist = new Int32Array(n).fill(-1);
  const src = new Int32Array(n);
  const done = new Uint8Array(n);
  const RING = KNIGHT + 1;
  /** @type {Int32Array[]} */
  const buckets = Array.from({ length: RING }, () => new Int32Array(1024));
  const sizes = new Int32Array(RING);
  /** @param {number} b @param {number} p */
  const push = (b, p) => {
    if (sizes[b] === buckets[b].length) {
      const g = new Int32Array(buckets[b].length * 2);
      g.set(buckets[b]);
      buckets[b] = g;
    }
    buckets[b][sizes[b]++] = p;
  };
  let pending = 0;
  for (let c = 1; c <= nSrc; c++) {
    const p = seed[c];
    if (p < 0) continue;
    dist[p] = 0;
    src[p] = c;
    push(0, p);
    pending++;
  }
  const visited = new Int32Array(n);
  let nv = 0;
  for (let d = 0; pending > 0; d++) {
    const b = d % RING;
    for (let i = 0; i < sizes[b]; i++) {
      const p = buckets[b][i];
      pending--;
      if (done[p] || dist[p] !== d) continue;
      done[p] = 1;
      visited[nv++] = p;
      const x = p % w;
      const y = (p - x) / w;
      for (let si = 0; si < 16; si++) {
        const dx = SDX[si], dy = SDY[si], cost = SC[si];
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (!labels[q] || done[q]) continue;
        if (cost === DIAG) {
          if (!labels[y * w + xx] && !labels[yy * w + x]) continue;
        } else if (cost === KNIGHT) {
          const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
          const mx = dx === 2 || dx === -2 ? x + sx : x;
          const my = dy === 2 || dy === -2 ? y + sy : y;
          if (!labels[my * w + mx] || !labels[(y + sy) * w + (x + sx)]) continue;
        }
        const nd = d + cost;
        if (dist[q] !== -1 && dist[q] <= nd) continue;
        dist[q] = nd;
        src[q] = src[p];
        push(nd % RING, q);
        pending++;
      }
    }
    sizes[b] = 0;
  }

  // 4. Escaped = water standing where the sealed piece has something else.
  //    Hole water in another hole isn't a leak (same class); outside water is only shown where it got in.
  const srcClass = (/** @type {number} */ c) => (c <= nh ? PX_HOLE : PX_WASTE);
  /** @param {number} p @param {number} c */
  const isEscaped = (p, c) => {
    const pc = sealed[p];
    return pc === PX_LINE || pc !== srcClass(c);
  };
  const maxOwn = new Int32Array(nSrc + 1);
  const minEsc = new Int32Array(nSrc + 1).fill(0x7fffffff);
  const maxEsc = new Int32Array(nSrc + 1);
  const leakySrc = new Uint8Array(nSrc + 1);
  const invaded = new Uint8Array(nh + 1);
  for (let i = 0; i < nv; i++) {
    const p = visited[i];
    const c = src[p];
    const d = dist[p];
    if (isEscaped(p, c)) {
      leakySrc[c] = 1;
      if (d < minEsc[c]) minEsc[c] = d;
      if (d > maxEsc[c]) maxEsc[c] = d;
      if (holeMask[p]) invaded[holes.labels[p]] = 1;
    } else if (d > maxOwn[c]) maxOwn[c] = d;
  }

  // 5. Timing (0…1): every hole fills in parallel during the first half; at the halfway mark
  //    the leaks break and the escaped water floods out. A small ripple gives a liquid edge.
  const OWN = 0.55, BREAK = 0.5;
  const keys = new Uint16Array(nv);
  const kinds = new Uint8Array(nv);
  let m = 0;
  const idx = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const p = visited[i];
    const c = src[p];
    const escaped = isEscaped(p, c);
    if (srcClass(c) === PX_WASTE && !escaped) continue; // the sea outside stays invisible
    const x = p % w, y = (p - x) / w;
    const wob = 0.6 * Math.sin(x * 0.11 + 1.7 * Math.sin(y * 0.07)) + 0.4 * Math.sin(y * 0.09 - 1.3 * Math.sin(x * 0.05));
    const d = dist[p] + ORTHO * 2 * (1 + wob);
    let u;
    if (!escaped) u = (OWN * d) / (Math.max(maxOwn[c], ORTHO * 6) + ORTHO * 4);
    else u = BREAK + ((1 - BREAK) * (d - minEsc[c])) / (Math.max(maxEsc[c] - minEsc[c], ORTHO * 6) + ORTHO * 4);
    keys[m] = Math.round(Math.min(1, Math.max(0, u)) * TIME_MAX);
    kinds[m] = escaped ? FLOW_ESCAPED : FLOW_CALM;
    idx[m++] = p;
  }
  // Counting sort by time.
  const start = new Int32Array(TIME_MAX + 2);
  for (let i = 0; i < m; i++) start[keys[i] + 1]++;
  for (let v = 1; v < start.length; v++) start[v] += start[v - 1];
  const order = new Int32Array(m);
  const time = new Uint16Array(m);
  const kind = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    const j = start[keys[i]]++;
    order[j] = idx[i];
    time[j] = keys[i];
    kind[j] = kinds[i];
  }

  // 6. Each leak's gap flashes when it breaks (the halfway mark), if water actually got there.
  /** @type {{x:number, y:number, t:number}[]} */
  const gaps = [];
  for (const g of scan.leaks || []) {
    let hit = false;
    const gx = Math.round(g.x), gy = Math.round(g.y);
    for (let yy = gy - 6; yy <= gy + 6 && !hit; yy++) {
      for (let xx = gx - 6; xx <= gx + 6; xx++) {
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && dist[yy * w + xx] >= 0) { hit = true; break; }
      }
    }
    if (hit) gaps.push({ x: g.x, y: g.y, t: BREAK });
  }

  // 7. Holes that held: neither leaked nor got outside water in.
  /** @type {{x:number, y:number, area:number}[]} */
  const held = [];
  let leaking = 0;
  for (let c = 1; c <= nh; c++) {
    if (seed[c] < 0) continue;
    if (leakySrc[c] || invaded[c]) {
      leaking++;
      continue;
    }
    held.push({ x: seed[c] % w, y: Math.floor(seed[c] / w), area: holes.area[c] });
  }

  return { order, time, kind, count: m, gaps, sealed: held, holes: nh, leaking, ms: Date.now() - t0 };
}
