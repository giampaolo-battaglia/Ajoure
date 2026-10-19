// @ts-check
// Region adjacency across lines. Two regions are neighbours when a single drawn line separates them.
// Each ink pixel is given to its nearest region (a Voronoi split of the line along its centre);
// where two owners meet inside the ink, those regions touch. Pure, no DOM.

/**
 * @typedef {Object} RegionGraph
 * @property {Int32Array} owner     for ink pixels: the region that owns this half of the line
 * @property {{q:number, c:number}[][]} nb   strong neighbours per region (c = contact length in px)
 * @property {Float64Array} contact  total strong contact per region
 */

/**
 * @param {Uint8Array} ink @param {Int32Array} labels region labels (0 on ink)
 * @param {number} count @param {number} w @param {number} h @param {number} minContact
 * @returns {RegionGraph}
 */
export function regionGraph(ink, labels, count, w, h, minContact) {
  const n = w * h;
  const owner = new Int32Array(labels);
  const queue = new Int32Array(n);
  let qt = 0;
  // Seed: ink pixels touching a region.
  for (let p = 0; p < n; p++) {
    if (!ink[p]) continue;
    const x = p % w;
    let o = 0;
    if (x > 0 && labels[p - 1]) o = labels[p - 1];
    else if (x < w - 1 && labels[p + 1]) o = labels[p + 1];
    else if (p >= w && labels[p - w]) o = labels[p - w];
    else if (p + w < n && labels[p + w]) o = labels[p + w];
    if (o) {
      owner[p] = o;
      queue[qt++] = p;
    }
  }
  // Grow owners through the ink (BFS ≈ nearest region).
  let qh = 0;
  while (qh < qt) {
    const p = queue[qh++];
    const o = owner[p];
    const x = p % w;
    if (x > 0 && ink[p - 1] && !owner[p - 1]) { owner[p - 1] = o; queue[qt++] = p - 1; }
    if (x < w - 1 && ink[p + 1] && !owner[p + 1]) { owner[p + 1] = o; queue[qt++] = p + 1; }
    if (p >= w && ink[p - w] && !owner[p - w]) { owner[p - w] = o; queue[qt++] = p - w; }
    if (p + w < n && ink[p + w] && !owner[p + w]) { owner[p + w] = o; queue[qt++] = p + w; }
  }
  // Count contacts where two owners meet inside the ink.
  /** @type {Map<number, number>} */
  const contacts = new Map();
  const K = count + 1;
  const bump = (/** @type {number} */ a, /** @type {number} */ b) => {
    if (!a || !b || a === b) return;
    const key = a < b ? a * K + b : b * K + a;
    contacts.set(key, (contacts.get(key) || 0) + 1);
  };
  for (let p = 0; p < n; p++) {
    if (!ink[p]) continue;
    const x = p % w;
    if (x < w - 1 && ink[p + 1]) bump(owner[p], owner[p + 1]);
    if (p + w < n && ink[p + w]) bump(owner[p], owner[p + w]);
  }
  /** @type {{q:number, c:number}[][]} */
  const nb = Array.from({ length: K }, () => []);
  const contact = new Float64Array(K);
  for (const [key, c] of contacts) {
    if (c < minContact) continue;
    const a = Math.floor(key / K);
    const b = key % K;
    nb[a].push({ q: b, c });
    nb[b].push({ q: a, c });
    contact[a] += c;
    contact[b] += c;
  }
  return { owner, nb, contact };
}
