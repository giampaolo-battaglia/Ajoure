// @ts-check
// "The piece you clicked": an area of paper is split into pieces at its narrow passages
// (narrower than ~1 mm). The Bucket fills one piece and seals the passages around it, so
// clicking the sky doesn't also flip the frame it touches through a hairline gap. Pure, no DOM.
// Works only inside the clicked area's bounding box, so a click answers quickly.

import { labelComponents } from './label.js';
import { distanceTo } from './distance.js';

/**
 * @param {Uint8Array} solid 1 = line or cut (paper = 0)
 * @param {number} w @param {number} h
 * @param {number} x @param {number} y the click
 * @param {number} coreR passages narrower than 2 × coreR px separate pieces
 * @returns {{seal: number[], pieces: number}} seal: image pixels to turn into line (the narrow
 *   passages between the clicked piece and the rest of its area); pieces: how many pieces the area has
 */
export function pieceAt(solid, w, h, x, y, coreR) {
  const start = y * w + x;
  if (x < 0 || y < 0 || x >= w || y >= h || solid[start]) return { seal: [], pieces: 0 };
  // 1. The clicked area (4-connected paper), and its bounding box.
  const inArea = new Uint8Array(w * h);
  let stack = [start];
  inArea[start] = 1;
  let x0 = x, y0 = y, x1 = x, y1 = y;
  while (stack.length) {
    const p = /** @type {number} */ (stack.pop());
    const px = p % w, py = (p - px) / w;
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
    if (px > 0 && !solid[p - 1] && !inArea[p - 1]) { inArea[p - 1] = 1; stack.push(p - 1); }
    if (px < w - 1 && !solid[p + 1] && !inArea[p + 1]) { inArea[p + 1] = 1; stack.push(p + 1); }
    if (py > 0 && !solid[p - w] && !inArea[p - w]) { inArea[p - w] = 1; stack.push(p - w); }
    if (py < h - 1 && !solid[p + w] && !inArea[p + w]) { inArea[p + w] = 1; stack.push(p + w); }
  }
  // 2. Work in a window around it (1 px border of "line" so distances are measured to the edge).
  const bx = Math.max(0, x0 - 1), by = Math.max(0, y0 - 1);
  const bw = Math.min(w - 1, x1 + 1) - bx + 1, bh = Math.min(h - 1, y1 + 1) - by + 1;
  const n = bw * bh;
  const local = new Uint8Array(n); // 1 = not this area
  for (let yy = 0; yy < bh; yy++) {
    const row = (by + yy) * w + bx;
    for (let xx = 0; xx < bw; xx++) local[yy * bw + xx] = inArea[row + xx] ? 0 : 1;
  }
  const toLine = distanceTo(local, bw, bh);
  // 3. Cores: the parts of this area deeper than coreR from any line.
  const core = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (!local[p] && toLine[p] >= coreR) core[p] = 1;
  const cores = labelComponents(core, bw, bh, 1, false);
  if (cores.count <= 1) return { seal: [], pieces: cores.count };
  // 4. Grow the cores back over the rest of the area (breadth-first ≈ nearest core).
  const own = new Int32Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let p = 0; p < n; p++) {
    if (cores.labels[p]) {
      own[p] = cores.labels[p];
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const px = p % bw;
    const nb = [px > 0 ? p - 1 : -1, px < bw - 1 ? p + 1 : -1, p - bw, p + bw];
    for (const q of nb) {
      if (q < 0 || q >= n || own[q] || local[q]) continue;
      own[q] = own[p];
      queue[tail++] = q;
    }
  }
  const lx = x - bx, ly = y - by;
  const mine = own[ly * bw + lx];
  if (!mine) return { seal: [], pieces: cores.count };
  // 5. The seam around the clicked piece: its pixels that touch another piece (plus 1 px, so the
  //    seal is a solid line that 4-connected paper can't slip through).
  const mark = new Uint8Array(n);
  /** @type {number[]} */
  const seal = [];
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      const p = yy * bw + xx;
      if (own[p] !== mine) continue;
      const nb = [xx > 0 ? p - 1 : -1, xx < bw - 1 ? p + 1 : -1, p - bw, p + bw];
      if (!nb.some((q) => q >= 0 && q < n && own[q] && own[q] !== mine)) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = xx + dx, sy = yy + dy;
          if (sx < 0 || sy < 0 || sx >= bw || sy >= bh) continue;
          const q = sy * bw + sx;
          if (mark[q] || local[q]) continue;
          mark[q] = 1;
          seal.push((by + sy) * w + bx + sx);
        }
      }
    }
  }
  stack = [];
  return { seal, pieces: cores.count };
}
