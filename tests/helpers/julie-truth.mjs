// Ground truth from Giampi's hand-made Julie result, aligned onto the input image.
// The hand-made file is a screenshot with a different crop and scale, so we align by bounding boxes:
// the drawing's ink bbox in the input ↔ the piece's bbox (white wood + black lines) in the hand-made.

import { readPng } from './png.mjs';
import { labelComponents } from '../../src/engine/label.js';
import { PX_WOOD, PX_HOLE, PX_LINE } from '../../src/engine/analyze.js';

export const TRUTH_WOOD = 1;
export const TRUTH_HOLE = 2;

/**
 * @param {string} inputPath @param {string} handmadePath
 * @returns {{w:number, h:number, truth:Uint8Array}} per input pixel: 0 outside the piece, 1 wood, 2 hole
 */
export function julieTruth(inputPath, handmadePath) {
  const a = readPng(inputPath);
  const b = readPng(handmadePath);
  const { width: w, height: h } = a;

  // Input ink bbox.
  let ix0 = w, iy0 = h, ix1 = 0, iy1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      if (0.299 * a.data[j] + 0.587 * a.data[j + 1] + 0.114 * a.data[j + 2] <= 128) {
        if (x < ix0) ix0 = x;
        if (x > ix1) ix1 = x;
        if (y < iy0) iy0 = y;
        if (y > iy1) iy1 = y;
      }
    }
  }

  // Hand-made: the largest blob of white-or-black is the piece (grey is holes and the canvas grid).
  const bw = b.width, bh = b.height;
  const gray = new Float32Array(bw * bh);
  const piece = new Uint8Array(bw * bh);
  for (let p = 0; p < bw * bh; p++) {
    const j = p * 4;
    gray[p] = (b.data[j] + b.data[j + 1] + b.data[j + 2]) / 3;
    piece[p] = gray[p] > 200 || gray[p] < 60 ? 1 : 0;
  }
  const comps = labelComponents(piece, bw, bh, 1, true);
  let big = 1;
  for (let c = 2; c <= comps.count; c++) if (comps.area[c] > comps.area[big]) big = c;
  const hx0 = comps.minX[big], hy0 = comps.minY[big], hx1 = comps.maxX[big], hy1 = comps.maxY[big];
  const sx = (hx1 - hx0) / (ix1 - ix0);
  const sy = (hy1 - hy0) / (iy1 - iy0);

  const truth = new Uint8Array(w * h);
  for (let y = iy0; y <= iy1; y++) {
    for (let x = ix0; x <= ix1; x++) {
      const hx = Math.round((x - ix0) * sx + hx0);
      const hy = Math.round((y - iy0) * sy + hy0);
      if (hx < 0 || hy < 0 || hx >= bw || hy >= bh) continue;
      const g = gray[hy * bw + hx];
      truth[y * w + x] = g > 200 || g < 60 ? TRUTH_WOOD : TRUTH_HOLE;
    }
  }
  // Everything outside the hand-made piece silhouette is outside (not scored).
  for (let y = iy0; y <= iy1; y++) {
    for (let x = ix0; x <= ix1; x++) {
      const hx = Math.round((x - ix0) * sx + hx0);
      const hy = Math.round((y - iy0) * sy + hy0);
      if (hx < 0 || hy < 0 || hx >= bw || hy >= bh) continue;
      if (comps.labels[hy * bw + hx] !== big && truth[y * w + x] === TRUTH_HOLE && !insideHull(comps, big, hx, hy)) truth[y * w + x] = 0;
    }
  }
  return { w, h, truth };
}

/** Rough "inside the piece" test: within the piece bbox row span. */
function insideHull(/** @type {any} */ comps, /** @type {number} */ c, /** @type {number} */ x, /** @type {number} */ y) {
  return x > comps.minX[c] + 2 && x < comps.maxX[c] - 2 && y > comps.minY[c] + 2 && y < comps.maxY[c] - 2;
}

/**
 * Pixel agreement between an engine class map and the truth, ignoring a band
 * around truth edges (the two images never align to the pixel).
 * @param {Uint8Array} classMap @param {Uint8Array} truth @param {number} w @param {number} h
 */
export function agreement(classMap, truth, w, h) {
  const band = 2;
  let agree = 0, total = 0;
  /** @type {Uint8Array} */
  const err = new Uint8Array(w * h); // 1 = we say wood, truth hole; 2 = we say hole, truth wood
  for (let y = band; y < h - band; y++) {
    for (let x = band; x < w - band; x++) {
      const p = y * w + x;
      const t = truth[p];
      const c = classMap[p];
      if (!t || (c !== PX_WOOD && c !== PX_HOLE && c !== PX_LINE)) continue;
      let edge = false;
      for (let d = -band; d <= band && !edge; d++) {
        if (truth[p + d] !== t || truth[p + d * w] !== t) edge = true;
      }
      if (edge) continue;
      const ours = c === PX_HOLE ? TRUTH_HOLE : TRUTH_WOOD;
      total++;
      if (ours === t) agree++;
      else err[p] = ours === TRUTH_WOOD ? 1 : 2;
    }
  }
  return { ratio: total ? agree / total : 0, err };
}
