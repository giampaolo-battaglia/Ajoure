// @ts-check
// "Water" Bucket preview: water poured where the cursor is spreads through the
// area under it, so a leak shows as water escaping through the gap.
//
// The order the water reaches each pixel is a geodesic distance from the cursor,
// measured inside the area only (it has to go around lines, and squeeze through
// gaps). Computed once when the cursor enters an area; each frame then paints only
// the pixels the front newly reached, so the animation stays cheap even for big areas.

// Step costs 5 / 7 / 11 (straight, diagonal, knight's move): a cheap distance whose
// fronts are round 16-gons rather than diamonds or octagons.
const ORTHO = 5;
const DIAG = 7;
const KNIGHT = 11;
/** [dx, dy, cost] */
const STEPS = [
  [1, 0, ORTHO], [-1, 0, ORTHO], [0, 1, ORTHO], [0, -1, ORTHO],
  [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG],
  [1, 2, KNIGHT], [2, 1, KNIGHT], [-1, 2, KNIGHT], [-2, 1, KNIGHT],
  [1, -2, KNIGHT], [2, -1, KNIGHT], [-1, -2, KNIGHT], [-2, -1, KNIGHT],
];
const SDX = Int8Array.from(STEPS, (t) => t[0]);
const SDY = Int8Array.from(STEPS, (t) => t[1]);
const SC = Int8Array.from(STEPS, (t) => t[2]);

/**
 * Order of the pixels of region `r` inside a box, by walking distance from (sx, sy).
 * @param {Int32Array|Uint32Array} labels image-sized region labels
 * @param {number} w image width
 * @param {number} r region id
 * @param {[number, number, number, number]} box x0, y0, x1, y1 (inclusive) of the region
 * @param {number} sx @param {number} sy start point (image px, inside the region)
 * @returns {{order: Int32Array, dist: Int32Array, count: number, maxDist: number, bw: number, bh: number}}
 *   order: box-local pixel indices, nearest first; dist: their distance (in px × 5)
 */
export function pourOrder(labels, w, r, box, sx, sy) {
  const [x0, y0, x1, y1] = box;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const n = bw * bh;
  const inside = new Uint8Array(n);
  let total = 0;
  for (let y = 0; y < bh; y++) {
    const row = (y0 + y) * w + x0;
    for (let x = 0; x < bw; x++) {
      if (labels[row + x] === r) {
        inside[y * bw + x] = 1;
        total++;
      }
    }
  }
  const order = new Int32Array(total);
  const dist = new Int32Array(total);
  const best = new Int32Array(n).fill(-1);
  let count = 0;
  let maxDist = 0;
  const lx = Math.min(bw - 1, Math.max(0, Math.round(sx) - x0));
  const ly = Math.min(bh - 1, Math.max(0, Math.round(sy) - y0));
  const start = ly * bw + lx;
  if (!inside[start]) return { order, dist, count: 0, maxDist: 0, bw, bh };

  // Dial's algorithm: a ring of buckets indexed by distance (costs ≤ KNIGHT, so KNIGHT + 1 buckets).
  const RING = KNIGHT + 1;
  /** @type {Int32Array[]} */
  const buckets = Array.from({ length: RING }, () => new Int32Array(64));
  const sizes = new Int32Array(RING);
  /** @param {number} b @param {number} p */
  const push = (b, p) => {
    if (sizes[b] === buckets[b].length) {
      const grown = new Int32Array(buckets[b].length * 2);
      grown.set(buckets[b]);
      buckets[b] = grown;
    }
    buckets[b][sizes[b]++] = p;
  };
  best[start] = 0;
  push(0, start);
  let pending = 1;
  const done = new Uint8Array(n);
  for (let d = 0; pending > 0; d++) {
    const b = d % RING;
    // The bucket can grow while we drain it (no zero-cost steps, so it can't, but stay safe).
    for (let i = 0; i < sizes[b]; i++) {
      const p = buckets[b][i];
      pending--;
      if (done[p] || best[p] !== d) continue;
      done[p] = 1;
      order[count] = p;
      dist[count++] = d;
      maxDist = d;
      const x = p % bw;
      const y = (p - x) / bw;
      for (let si = 0; si < 16; si++) {
        const dx = SDX[si];
        const dy = SDY[si];
        const cost = SC[si];
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
        const q = yy * bw + xx;
        if (!inside[q] || done[q]) continue;
        // Never jump a line: the cells the step passes are in the area too. A diagonal may
        // round one corner (the area is 4-connected), a knight's move needs both cells it crosses.
        if (cost === DIAG) {
          if (!inside[y * bw + xx] && !inside[yy * bw + x]) continue;
        } else if (cost === KNIGHT) {
          // e.g. (2, 1) crosses (1, 0) and (1, 1)
          const sx1 = dx > 0 ? 1 : -1;
          const sy1 = dy > 0 ? 1 : -1;
          const mx = dx === 2 || dx === -2 ? x + sx1 : x;
          const my = dy === 2 || dy === -2 ? y + sy1 : y;
          if (!inside[my * bw + mx] || !inside[(y + sy1) * bw + (x + sx1)]) continue;
        }
        const nd = d + cost;
        if (best[q] !== -1 && best[q] <= nd) continue;
        best[q] = nd;
        push(nd % RING, q);
        pending++;
      }
    }
    sizes[b] = 0;
  }
  return { order, dist, count, maxDist, bw, bh };
}

/**
 * A liquid edge: nudge each pixel's arrival by a smooth ripple (a few screen px), then
 * re-sort. Fixed in image space, so the wobble doesn't shimmer as the front moves.
 * @param {ReturnType<typeof pourOrder>} o @param {number} x0 @param {number} y0 @param {number} scale
 */
export function wobble(o, x0, y0, scale) {
  const { order, dist, count, bw } = o;
  if (!count) return o;
  const k = 1 / Math.max(scale, 0.05); // image px per screen px
  const amp = 4 * k * ORTHO; // ±4 screen px
  const f1 = 1 / (34 * k), f2 = 1 / (21 * k), f3 = 1 / (13 * k);
  const key = new Int32Array(count);
  let maxKey = 0;
  for (let i = 0; i < count; i++) {
    const p = order[i];
    const x = (p % bw) + x0;
    const y = ((p - (p % bw)) / bw) + y0;
    const n = 0.55 * Math.sin(x * f1 + 1.7 * Math.sin(y * f2)) + 0.45 * Math.sin(y * f1 * 1.13 - 1.3 * Math.sin(x * f3));
    const v = Math.max(0, Math.round(dist[i] + amp * (1 + n)));
    key[i] = v;
    if (v > maxKey) maxKey = v;
  }
  // Counting sort by the new key (keys are small integers).
  const start = new Int32Array(maxKey + 2);
  for (let i = 0; i < count; i++) start[key[i] + 1]++;
  for (let v = 1; v < start.length; v++) start[v] += start[v - 1];
  const nOrder = new Int32Array(count);
  const nDist = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const j = start[key[i]]++;
    nOrder[j] = order[i];
    nDist[j] = key[i];
  }
  return { ...o, order: nOrder, dist: nDist, maxDist: maxKey };
}

/** Wet area over time: quick start, gentle finish. @param {number} u */
const easeOut = (u) => 1 - Math.pow(1 - u, 1.6);

export const WATER = Object.freeze({
  body: [64, 140, 255, 112], // calm water
  edge: [22, 98, 232, 220], // the deeper leading edge, readable on white wood and on grey holes
  edgePx: 6, // front width on screen, CSS px
  speed: 650, // CSS px per second on screen
  minMs: 500,
  maxMs: 2400,
});

/**
 * One pour: a box-sized canvas that fills a bit more on every tick.
 */
export class Pour {
  /**
   * @param {ReturnType<typeof pourOrder>} o pour order (usually passed through wobble())
   * @param {number} x0 @param {number} y0 box origin, image px
   * @param {number} scale current zoom (screen px per image px), sets pace and front width
   * @param {boolean} instant reduced motion: show the result at once
   * @param {{x:number, y:number, w:number, h:number}|null} visible image rect on screen: the pour is
   *   paced to fill what you can see; anything off-screen fills at the end
   */
  constructor(o, x0, y0, scale, instant, visible = null) {
    this.o = o;
    this.x = x0;
    this.y = y0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = o.bw;
    this.canvas.height = o.bh;
    this.g = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.img = this.g.createImageData(o.bw, o.bh);
    this.band = Math.max(ORTHO * 1.5, (WATER.edgePx / Math.max(scale, 1e-3)) * ORTHO);
    // Pace by what's on screen: the visible wet area grows at a steady rate, however far
    // the water has to detour off-screen to get there (no dead time, no sudden flood).
    let vis = o.dist.subarray(0, o.count);
    if (visible) {
      const vx0 = visible.x - x0, vy0 = visible.y - y0;
      const vx1 = vx0 + visible.w, vy1 = vy0 + visible.h;
      const keep = new Int32Array(o.count);
      let k = 0;
      for (let i = 0; i < o.count; i++) {
        const p = o.order[i];
        const x = p % o.bw;
        const y = (p - x) / o.bw;
        if (x >= vx0 && x < vx1 && y >= vy0 && y < vy1) keep[k++] = o.dist[i];
      }
      if (k) vis = keep.subarray(0, k);
    }
    /** distances of the on-screen pixels, nearest first */
    this.vis = vis;
    const side = Math.sqrt(vis.length) * scale; // on-screen size of the visible water, CSS px
    this.dur = Math.min(WATER.maxMs, Math.max(WATER.minMs, (1.6 * side / WATER.speed) * 1000));
    this.t0 = performance.now();
    this.reached = 0; // order[0, reached) are wet
    this.settled = 0; // order[0, settled) are calm (behind the front)
    this.finished = false;
    if (instant) this.paintTo(Infinity);
  }

  /** Advance to time `now`. @param {number} now @returns {boolean} true while still flowing */
  tick(now) {
    if (this.finished) return false;
    const u = Math.min(1, (now - this.t0) / this.dur);
    const vis = this.vis;
    const front = u >= 1 || !vis.length ? Infinity : vis[Math.min(vis.length - 1, Math.floor(easeOut(u) * vis.length))];
    this.paintTo(front);
    return !this.finished;
  }

  /** @param {number} front distance the water has reached (px × 5) */
  paintTo(front) {
    const { order, dist, count, bw } = this.o;
    const d = this.img.data;
    let minX = bw, minY = this.o.bh, maxX = -1, maxY = -1;
    /** @param {number} i @param {number[]} c */
    const paint = (i, c) => {
      const p = order[i];
      const k = p * 4;
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = c[3];
      const x = p % bw;
      const y = (p - x) / bw;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    while (this.reached < count && dist[this.reached] <= front) paint(this.reached++, WATER.edge);
    const calm = front === Infinity ? Infinity : front - this.band;
    while (this.settled < this.reached && dist[this.settled] <= calm) paint(this.settled++, WATER.body);
    if (maxX >= 0) this.g.putImageData(this.img, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
    if (this.settled >= count) this.finished = true;
  }
}

export const FLOW_COLORS = Object.freeze({
  calm: [64, 140, 255, 112],
  calmEdge: [22, 98, 232, 220],
  escaped: [245, 158, 40, 150], // warm amber: what the leak would take with it
  escapedEdge: [214, 110, 0, 230],
});

/**
 * Flow test reveal: an image-sized canvas the water fills over `dur` ms, every hole in parallel.
 * Fed by the worker's flowTest() result (pixels already in time order).
 */
export class FlowReveal {
  /**
   * @param {import('../engine/flow.js').FlowResult} f
   * @param {number} w @param {number} h
   * @param {number} dur ms (0 = all at once)
   */
  constructor(f, w, h, dur) {
    this.f = f;
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.img = this.g.createImageData(w, h);
    this.dur = dur;
    this.t0 = performance.now();
    this.reached = 0;
    this.settled = 0;
    this.band = 2200; // front width, in time units (of 65535)
    this.finished = false;
    if (!dur) this.paintTo(Infinity);
  }

  /** When (ms after the start) the front reaches flow time `k` (0…1). @param {number} k */
  timeOf(k) {
    if (!this.dur) return 0;
    const v = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * k))) / Math.PI;
    return Math.pow(v, 1 / 0.85) * this.dur;
  }

  /** Progress 0…1 at `now`. @param {number} now */
  progress(now) {
    return this.dur ? Math.min(1, (now - this.t0) / this.dur) : 1;
  }

  /** @param {number} now @returns {boolean} still flowing */
  tick(now) {
    if (this.finished) return false;
    const u = this.progress(now);
    // Gentle start (the pour), steady middle, soft settle.
    const e = u < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * Math.pow(u, 0.85)) : 1;
    this.paintTo(u >= 1 ? Infinity : e * (65535 + this.band));
    return !this.finished;
  }

  /** Jump to the end. */
  finish() {
    this.paintTo(Infinity);
  }

  /** @param {number} front */
  paintTo(front) {
    const { order, time, kind, count } = this.f;
    const d = this.img.data;
    const w = this.w;
    let minY = this.h, maxY = -1;
    /** @param {number} i @param {boolean} edge */
    const paint = (i, edge) => {
      const p = order[i];
      const c = kind[i] === 2 ? (edge ? FLOW_COLORS.escapedEdge : FLOW_COLORS.escaped) : edge ? FLOW_COLORS.calmEdge : FLOW_COLORS.calm;
      const k = p * 4;
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = c[3];
      const y = (p / w) | 0;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    while (this.reached < count && time[this.reached] <= front) paint(this.reached++, true);
    const calm = front === Infinity ? Infinity : front - this.band;
    while (this.settled < this.reached && time[this.settled] <= calm) paint(this.settled++, false);
    if (maxY >= 0) this.g.putImageData(this.img, 0, 0, 0, minY, w, maxY - minY + 1);
    if (this.settled >= count) this.finished = true;
  }
}
