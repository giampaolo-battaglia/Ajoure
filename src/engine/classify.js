// @ts-check
// Wood / hole guess for line-art regions. A heuristic, tuned on the Julie reference; the Bucket fixes the rest.
//
// What we know about coloring-page style art:
//  - Everything outside the outermost line is waste; regions just inside it are wood (the frame or silhouette).
//  - Across a line, wood and hole usually alternate: holes are wrapped by wood.
//  - Wood next to wood across a line is common (overlapping petals, letters on a ribbon) and costs a little.
//  - Hole next to hole across a line is unusual (the line would be a lone thin strut) and costs more.
//  - Thin regions are the insides of double-line strokes (vines, letters, frame bands): wood.
// Costs are weighted by how much of a region's outline each neighbour shares, so a big
// background region isn't pushed around by a tiny dot it happens to touch.
// The guess minimises the total cost with iterated conditional modes (ICM).

export const WASTE = 0;
export const WOOD = 1;
export const HOLE = 2;

/**
 * Tunable weights (scored against the hand-made Julie in tests/julie.test.mjs).
 * @type {Readonly<{holeHole:number, woodWood:number, thin:number, thinRatio:number, elongation:number, holeBias:number, norm:'avg'|'geo'|'big'}>}
 */
export const WEIGHTS = Object.freeze({
  holeHole: 3, // cost per unit of outline shared with another hole (or waste)
  woodWood: 0.4, // cost per unit of outline shared with another wood region
  thin: 3, // bias toward wood for stroke interiors
  thinRatio: 2.5, // "thin" = widest inscribed circle < thinRatio × stroke width…
  elongation: 4, // …and long: area > elongation × width² (round dots and counters don't count)
  holeBias: 0.05, // slight preference for hole when everything else is equal
  norm: 'geo', // how a shared edge is weighed: 'avg' of both shares, 'geo' mean, 'big' (÷ larger outline)
});

/**
 * @param {{
 *   count: number,
 *   area: Int32Array,
 *   waste: Uint8Array,              // 1 for waste regions (fixed)
 *   thickness: Float32Array,        // widest inscribed diameter per region (px)
 *   nb: {q:number, c:number}[][],   // strong neighbours across one line
 *   contact: Float64Array,
 *   strokeW: number,
 * }} g
 * @param {Partial<typeof WEIGHTS>} [weights]
 * @returns {{cls: Uint8Array, confidence: Float32Array, energy: number}}
 */
export function classifyRegions(g, weights = {}) {
  const W = { ...WEIGHTS, ...weights };
  const K = g.count + 1;
  const unary = new Float64Array(K); // extra cost of HOLE vs WOOD, before neighbours
  for (let r = 1; r < K; r++) {
    if (!g.waste[r]) unary[r] = unaryHole(g, W, r);
  }
  const model = { g, W, unary };

  const free = [];
  for (let r = 1; r < K; r++) if (!g.waste[r]) free.push(r);
  free.sort((a, b) => g.area[b] - g.area[a]); // big regions first: they anchor the small ones

  // Start from the unary preference, then anneal (single flips, Metropolis) and polish with ICM.
  // Plain ICM gets stuck in "inverted" clusters (petals as holes, background as wood); annealing escapes them.
  const cls = new Uint8Array(K);
  for (let r = 1; r < K; r++) cls[r] = g.waste[r] ? WASTE : unary[r] < 0 ? HOLE : WOOD;
  icm(model, cls, free);
  let best = Uint8Array.from(cls);
  let bestE = energy(model, cls);
  const start = Uint8Array.from(cls);
  const sweeps = 300;
  for (let run = 0; run < 4; run++) {
    const rand = mulberry32(0x41a0 + run * 7919);
    const x = Uint8Array.from(start);
    for (let s = 0; s < sweeps; s++) {
      const T = 0.6 * Math.pow(0.005 / 0.6, s / (sweeps - 1));
      for (const r of free) {
        const d = delta(model, x, r);
        if (d < 0 || rand() < Math.exp(-d / T)) x[r] = x[r] === HOLE ? WOOD : HOLE;
      }
    }
    icm(model, x, free);
    const e = energy(model, x);
    if (e < bestE - 1e-9) {
      best = x;
      bestE = e;
    }
  }

  const confidence = new Float32Array(K);
  for (const r of free) confidence[r] = Math.min(1, Math.abs(delta(model, best, r)));
  for (let r = 1; r < K; r++) if (g.waste[r]) confidence[r] = 1;
  return { cls: best, confidence, energy: bestE };
}

/**
 * @typedef {{g: Parameters<typeof classifyRegions>[0], W: typeof WEIGHTS, unary: Float64Array}} Model
 */

/** Symmetric pair cost between two neighbours sharing `len` px of line. @param {Model} m */
function pairCost(m, /** @type {number} */ r, /** @type {number} */ q, /** @type {number} */ cr, /** @type {number} */ cq, /** @type {number} */ len) {
  const hr = cr !== WOOD;
  const hq = cq !== WOOD;
  const k = hr && hq ? m.W.holeHole : !hr && !hq ? m.W.woodWood : 0;
  if (!k) return 0;
  const tr = m.g.contact[r] || 1;
  const tq = m.g.contact[q] || 1;
  if (m.W.norm === 'geo') return (k * len) / Math.sqrt(tr * tq);
  if (m.W.norm === 'big') return (k * len) / Math.max(tr, tq);
  return (k * len * (1 / tr + 1 / tq)) / 2;
}

/** Total cost of a labelling. @param {Model} m @param {Uint8Array} cls */
export function energy(m, cls) {
  let e = 0;
  for (let r = 1; r < cls.length; r++) {
    if (cls[r] === HOLE) e += m.unary[r];
    for (const { q, c } of m.g.nb[r]) if (q > r) e += pairCost(m, r, q, cls[r], cls[q], c);
  }
  return e;
}

/** Change in total cost if region r flips. @param {Model} m @param {Uint8Array} cls @param {number} r */
function delta(m, cls, r) {
  const from = cls[r];
  const to = from === HOLE ? WOOD : HOLE;
  let d = (to === HOLE ? m.unary[r] : 0) - (from === HOLE ? m.unary[r] : 0);
  for (const { q, c } of m.g.nb[r]) d += pairCost(m, r, q, to, cls[q], c) - pairCost(m, r, q, from, cls[q], c);
  return d;
}

/** Greedy best-response sweeps until nothing improves. @param {Model} m @param {Uint8Array} cls @param {number[]} free */
function icm(m, cls, free) {
  for (let pass = 0; pass < 50; pass++) {
    let changed = 0;
    for (const r of free) {
      if (delta(m, cls, r) < -1e-9) {
        cls[r] = cls[r] === HOLE ? WOOD : HOLE;
        changed++;
      }
    }
    if (!changed) break;
  }
}

/** Small deterministic PRNG so scans are repeatable. @param {number} a */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Energy of an arbitrary labelling (for tests: is the truth cheaper than our answer?). */
export function energyOf(/** @type {Parameters<typeof classifyRegions>[0]} */ g, /** @type {Uint8Array} */ cls, weights = {}) {
  const W = { ...WEIGHTS, ...weights };
  const unary = new Float64Array(g.count + 1);
  for (let r = 1; r <= g.count; r++) if (!g.waste[r]) unary[r] = unaryHole(g, W, r);
  return energy({ g, W, unary }, cls);
}

/** Extra cost of calling region r a hole, from its own shape. */
function unaryHole(/** @type {Parameters<typeof classifyRegions>[0]} */ g, /** @type {typeof WEIGHTS} */ W, /** @type {number} */ r) {
  const t = g.thickness[r];
  const stroke = t < W.thinRatio * g.strokeW && g.area[r] > W.elongation * t * t;
  return stroke ? W.thin : -W.holeBias;
}
