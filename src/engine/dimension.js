// @ts-check
// Dimension checks (SPEC §4, §8.7): thin wood, near-touch (holes too narrow for the kerf) and
// speck holes. They need a scale, so they're "estimated" until the real width is entered.
// Pure, no DOM.

import { distanceTo } from './distance.js';
import { labelComponents } from './label.js';

const PX_WOOD = 1, PX_HOLE = 2, PX_LINE = 3;

/**
 * @typedef {import('./analyze.js').Issue} Issue
 * @typedef {{where: (x:number, y:number) => string, mm: (v:number) => string, area: (v:number) => string, id: (type:string, x:number, y:number) => string}} Describe
 */

/**
 * @param {{classMap: Uint8Array, w: number, h: number, pxPerMm: number, estimated: boolean,
 *          profile: {minWoodWidth: number, minHoleWidth: number, minHoleArea: number}}} s
 * @param {Describe} d
 * @returns {Issue[]}
 */
export function dimensionChecks(s, d) {
  const { classMap, w, h, pxPerMm, profile, estimated } = s;
  const n = w * h;
  const wood = new Uint8Array(n);
  const hole = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const c = classMap[p];
    if (c === PX_LINE || c === PX_WOOD) wood[p] = 1;
    else if (c === PX_HOLE) hole[p] = 1;
  }
  /** @type {Issue[]} */
  const issues = [];

  // Speck holes first: tiny holes are reported as specks, not also as "near-touch".
  const minHolePx = profile.minHoleArea * pxPerMm * pxPerMm;
  const holes = labelComponents(hole, w, h, 1, false);
  const speck = new Uint8Array(holes.count + 1);
  for (let c = 1; c <= holes.count; c++) {
    if (holes.area[c] >= minHolePx) continue;
    speck[c] = 1;
    const ax = holes.sumX[c] / holes.area[c];
    const ay = holes.sumY[c] / holes.area[c];
    /** @type {number[]} */
    const pixels = [];
    for (let y = holes.minY[c]; y <= holes.maxY[c]; y++) {
      for (let x = holes.minX[c]; x <= holes.maxX[c]; x++) if (holes.labels[y * w + x] === c) pixels.push(y * w + x);
    }
    const mm2 = holes.area[c] / (pxPerMm * pxPerMm);
    issues.push({
      id: d.id('speck_hole', ax, ay),
      type: 'speck_hole',
      severity: 'info',
      family: 'dimension',
      estimated,
      label: `Speck hole, ${d.where(ax, ay)}`,
      detail: `A ${d.area(mm2)} hole is too small to cut cleanly; usually just filled`,
      bbox: [holes.minX[c], holes.minY[c], holes.maxX[c] - holes.minX[c] + 1, holes.maxY[c] - holes.minY[c] + 1],
      anchor: [Math.round(ax), Math.round(ay)],
      measure: mm2,
      status: 'open',
      fix: { kind: 'fill', pixels },
    });
  }
  const holeNoSpeck = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (hole[p] && !speck[holes.labels[p]]) holeNoSpeck[p] = 1;

  narrowSpots(wood, profile.minWoodWidth * pxPerMm, 1.5, (spot) => {
    const mm = spot.width / pxPerMm;
    issues.push({
      id: d.id('thin', spot.x, spot.y),
      type: 'thin',
      severity: 'warning',
      family: 'dimension',
      estimated,
      label: `Thin wood, ${d.where(spot.x, spot.y)}`,
      detail: `Only ${d.mm(mm)} wide (needs ${d.mm(profile.minWoodWidth)}); it may burn through or snap`,
      bbox: spot.bbox,
      anchor: [spot.x, spot.y],
      measure: mm,
      status: 'open',
      fix: { kind: 'thicken', pts: spot.pts, r: (profile.minWoodWidth * pxPerMm) / 2 },
    });
  }, w, h);

  narrowSpots(holeNoSpeck, profile.minHoleWidth * pxPerMm, 3, (spot) => {
    const mm = spot.width / pxPerMm;
    issues.push({
      id: d.id('near_touch', spot.x, spot.y),
      type: 'near_touch',
      severity: 'warning',
      family: 'dimension',
      estimated,
      label: `Near-touch, ${d.where(spot.x, spot.y)}`,
      detail: `Two edges only ${d.mm(mm)} apart (needs ${d.mm(profile.minHoleWidth)}); the laser may fuse or char them`,
      bbox: spot.bbox,
      anchor: [spot.x, spot.y],
      measure: mm,
      status: 'open',
      fix: { kind: 'widen', pts: spot.pts, r: (profile.minHoleWidth * pxPerMm) / 2 },
    });
  }, w, h);

  return issues;
}

/**
 * Places where a shape is narrower than `minW` px: ridge points of the distance-to-edge map
 * (the shape's centre line) whose local width is too small, grouped into spots.
 * Corners are not spots: where two lines meet at a sharp angle the shape tapers to a point,
 * so the last couple of px (under 2 px wide) are ignored, and a spot must stay narrow for
 * `runK` × minW along its length — a narrow channel, not just the tip of a wedge.
 * @param {Uint8Array} mask @param {number} minW @param {number} runK
 * @param {(spot: {x:number, y:number, width:number, bbox:[number,number,number,number], pts:number[]}) => void} emit
 * @param {number} w @param {number} h
 */
function narrowSpots(mask, minW, runK, emit, w, h) {
  const n = w * h;
  const outside = new Uint8Array(n);
  for (let p = 0; p < n; p++) outside[p] = mask[p] ^ 1;
  const dist = distanceTo(outside, w, h); // ≥ 1 inside the shape
  const cand = new Uint8Array(n);
  let any = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      const dp = dist[p];
      const width = 2 * dp - 0.5; // ±0.5 px for odd/even pixel widths
      if (width >= minW || width < 2) continue;
      // Ridge: no neighbour is deeper (the centre line of the stroke).
      if (dist[p - 1] > dp || dist[p + 1] > dp || dist[p - w] > dp || dist[p + w] > dp ||
        dist[p - w - 1] > dp || dist[p - w + 1] > dp || dist[p + w - 1] > dp || dist[p + w + 1] > dp) continue;
      cand[p] = 1;
      any++;
    }
  }
  if (!any) return;
  // Group nearby ridge points (gap ≤ 2 px) into spots.
  const grown = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!cand[p]) continue;
    const x = p % w, y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) grown[yy * w + xx] = 1;
    }
  }
  const spots = labelComponents(grown, w, h, 1, true);
  const best = new Int32Array(spots.count + 1).fill(-1);
  const count = new Int32Array(spots.count + 1);
  /** @type {number[][]} */
  const pts = Array.from({ length: spots.count + 1 }, () => []);
  for (let p = 0; p < n; p++) {
    if (!cand[p]) continue;
    const c = spots.labels[p];
    count[c]++;
    if (best[c] < 0 || dist[p] < dist[best[c]]) best[c] = p;
    pts[c].push(p);
  }
  const minRun = Math.max(4, minW * runK);
  for (let c = 1; c <= spots.count; c++) {
    if (count[c] < minRun || best[c] < 0) continue;
    const p = best[c];
    const x = p % w, y = (p - x) / w;
    // Keep the fix light: at most 48 points along the spot.
    const all = pts[c];
    const step = Math.max(1, Math.ceil(all.length / 48));
    /** @type {number[]} */
    const sample = [];
    for (let i = 0; i < all.length; i += step) sample.push(all[i] % w, Math.floor(all[i] / w));
    emit({
      x, y,
      width: Math.max(1, 2 * dist[p] - 0.5),
      bbox: [spots.minX[c], spots.minY[c], spots.maxX[c] - spots.minX[c] + 1, spots.maxY[c] - spots.minY[c] + 1],
      pts: sample,
    });
  }
}
