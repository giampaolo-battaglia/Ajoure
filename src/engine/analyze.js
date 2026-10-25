// @ts-check
// The instant scan: image → ink → regions → wood/hole guess → leaks & islands. Pure, no DOM.
// Runs in a Web Worker in the app and directly in Node for tests.

import { toGray, otsu, binarize, fraction, drawLine } from './raster.js';
import { labelComponents } from './label.js';
import { distanceTo } from './distance.js';
import { thin, strokeEnds } from './skeleton.js';
import { findGaps, findNecks, findOpenings } from './gaps.js';
import { regionGraph } from './regions.js';
import { classifyRegions, WASTE, WOOD, HOLE } from './classify.js';
import { adjustGray, adjustInk, isAdjusted } from './adjust.js';
import { dimensionChecks } from './dimension.js';

export { WASTE, WOOD, HOLE };
/** Per-pixel display classes in `classMap`. */
export const PX_WASTE = 0, PX_WOOD = 1, PX_HOLE = 2, PX_LINE = 3;

/**
 * @typedef {{name: string, thicknessMm: number, kerfMm: number, minWoodWidth: number, minHoleWidth: number,
 *            minHoleArea: number, minIslandArea: number, leakGapMm: number}} Material
 */
/** Default material: 3 mm basswood (SPEC §4). Lengths in mm, areas in mm². */
export const BASSWOOD_3MM = Object.freeze({
  name: '3 mm basswood',
  thicknessMm: 3,
  kerfMm: 0.15,
  minWoodWidth: 1.0,
  minHoleWidth: 0.5,
  minHoleArea: 0.5,
  minIslandArea: 0.5,
  leakGapMm: 0.6,
});

/**
 * Materials to pick from. Starting values to be calibrated with test cuts (SPEC §4); only the
 * dimension checks (thin wood, near-touch, specks) and brush sizes use them, never leak detection.
 * @type {readonly Material[]}
 */
export const MATERIALS = Object.freeze([
  BASSWOOD_3MM,
  Object.freeze({ ...BASSWOOD_3MM, name: '1.5 mm basswood', thicknessMm: 1.5, kerfMm: 0.12, minWoodWidth: 0.7, minHoleWidth: 0.4 }),
  Object.freeze({ ...BASSWOOD_3MM, name: '3 mm birch plywood', kerfMm: 0.18, minWoodWidth: 1.2, minHoleWidth: 0.5 }),
  Object.freeze({ ...BASSWOOD_3MM, name: '3 mm acrylic', kerfMm: 0.12, minWoodWidth: 1.5, minHoleWidth: 0.4, minHoleArea: 0.8 }),
]);

/**
 * Leak detection tuning (not material-specific). Measured on Julie: the two pockets Giampi closed
 * by hand open through 0.64 mm and 0.96 mm necks, wider than the 0.6 mm stroke-end limit,
 * so necks get their own, wider limit but must separate two sizeable areas.
 */
export const DETECTION = Object.freeze({
  neckGapMm: 1.0, // widest pinch between two areas that still counts as a leak
  neckMinPartMm2: 8, // both sides of a neck must be at least this big
  openingMaxMm: 3.0, // "open outline" hints: a stroke end up to this far from the next line…
  openingMinPartMm2: 100, // …where closing it would cut off a piece at least this big
});

/**
 * @typedef {Object} Issue
 * @property {string} id
 * @property {'island'|'leak'|'speck_island'|'thin'|'near_touch'|'speck_hole'|'opening'} type
 * @property {'critical'|'warning'|'info'} severity
 * @property {'structure'|'dimension'} family
 * @property {boolean} estimated
 * @property {string} label
 * @property {string} detail
 * @property {[number, number, number, number]} bbox  x, y, w, h in image px
 * @property {[number, number]} anchor
 * @property {number} [measure]   mm (gap) or mm² (island)
 * @property {number[]} [regions]
 * @property {'open'|'resolved'|'ignored'} status
 * @property {{kind:'close', ax:number, ay:number, bx:number, by:number} | {kind:'fill', pixels:number[]} | {kind:'thicken'|'widen', pts:number[], r:number}} [fix]
 */

/**
 * @typedef {{widthMm?: number|null, threshold?: number, profile?: Material,
 *            adjust?: Partial<import('./adjust.js').Adjustments>,
 *            weights?: Partial<typeof import('./classify.js').WEIGHTS>,
 *            detection?: Partial<typeof DETECTION>,
 *            prior?: Uint8Array|null, dimensions?: boolean}} ScanOptions
 *   prior: the previous scan's autoMap (its guess before Bucket clicks); re-scans lean toward it
 *   so only what you changed moves.
 * @typedef {{x:number, y:number, cls:number}} Seed  a click that decides something at (x, y):
 *   WOOD / HOLE (Bucket) or SEED_ENGRAVE (Engrave tool) force the area there; SEED_LINE_SCORE /
 *   SEED_LINE_ENGRAVE (Engrave tool on a line) choose how that floating line is burned (used by export).
 * @typedef {ReturnType<typeof prepare>} Base
 */

/** The estimated piece width when none is entered, and the fixed scale for structure checks. */
export const REFERENCE_WIDTH_MM = 50;

/** How strongly a re-scan sticks to the previous scan's wood/hole answer (same units as WEIGHTS). */
const PRIOR_WEIGHT = 1.5;

/** Edit values in the edits layer (one byte per pixel). */
export const EDIT_NONE = 0, EDIT_WOOD = 1, EDIT_HOLE = 2, EDIT_PAPER = 3;

/**
 * Seed classes beyond WOOD (1) and HOLE (2). An engraved area is wood whose surface is burned;
 * line seeds don't change any area, they only pick score or engrave for one floating line.
 */
export const SEED_ENGRAVE = 3, SEED_LINE_SCORE = 4, SEED_LINE_ENGRAVE = 5;
/** Does this seed decide an area (Bucket / Engrave on an area)? @param {Seed} s */
export const isAreaSeed = (s) => s.cls === WOOD || s.cls === HOLE || s.cls === SEED_ENGRAVE;
/** The area class a seed forces (an engraved area is wood). @param {Seed} s */
const seedClass = (s) => (s.cls === SEED_ENGRAVE ? WOOD : s.cls);

/**
 * One-off image preparation: threshold, clean-up, line art vs filled, scale. Done once per image;
 * every later re-check after an edit starts from this.
 * @param {Uint8ClampedArray|Uint8Array} rgba @param {number} w @param {number} h @param {ScanOptions} [opts]
 */
export function prepare(rgba, w, h, opts = {}) {
  const t0 = now();
  const estimated = opts.widthMm == null;
  const widthMm = opts.widthMm ?? REFERENCE_WIDTH_MM;

  // Ink: adjustments (SPEC §5.2), auto threshold, flip white-on-black, drop dust.
  const adj = opts.adjust || {};
  const gray0 = toGray(rgba, w, h);
  const gray = isAdjusted(adj) ? adjustGray(gray0, w, h, adj) : gray0;
  const autoThreshold = otsu(gray);
  const threshold = adj.threshold ?? opts.threshold ?? autoThreshold;
  const ink = binarize(gray, threshold);
  const inverted = adj.invert === 'on' ? true : adj.invert === 'off' ? false : fraction(ink) > 0.5;
  if (inverted) for (let i = 0; i < ink.length; i++) ink[i] ^= 1;
  const dust = labelComponents(ink, w, h, 1, true);
  for (let p = 0; p < ink.length; p++) if (ink[p] && dust.area[dust.labels[p]] < 6) ink[p] = 0;
  // Pinholes: specks of paper a few pixels big, trapped inside lines, become line.
  const pin = labelComponents(ink, w, h, 0, false);
  for (let p = 0; p < ink.length; p++) if (!ink[p] && !pin.border[pin.labels[p]] && pin.area[pin.labels[p]] < 12) ink[p] = 1;
  if (isAdjusted(adj)) adjustInk(ink, w, h, adj);
  const mode = /** @type {'lineart'|'filled'} */ (fraction(ink) < 0.3 ? 'lineart' : 'filled');

  // Scale: the piece (everything not touching the image edge) is assumed widthMm wide.
  const regions = labelComponents(ink, w, h, 0, false);
  const waste = new Uint8Array(regions.count + 1);
  for (let r = 1; r <= regions.count; r++) waste[r] = regions.border[r];
  const piece = pieceBox(regions.labels, waste, w, h);
  const pxPerMm = piece.w / widthMm;
  // Structure checks (leaks) are scale-free (SPEC §4): they always use the reference scale, so
  // entering the real width or changing material only affects the mm checks.
  const structPxPerMm = piece.w / REFERENCE_WIDTH_MM;
  return { w, h, ink, threshold, autoThreshold, inverted, mode, piece, pxPerMm, structPxPerMm, widthMm, estimated, prepMs: Math.round(now() - t0) };
}

/**
 * Full scan of a prepared image with the user's edits applied.
 * @param {Base} base
 * @param {Uint8Array|null} edits  per pixel: EDIT_NONE / EDIT_WOOD (material) / EDIT_HOLE (cut) / EDIT_PAPER (erased)
 * @param {Seed[]} seeds  Bucket clicks, oldest first
 * @param {ScanOptions} [opts]
 */
export function analyzeEdited(base, edits, seeds = [], opts = {}) {
  const t0 = now();
  const { w, h, mode, pxPerMm, piece, widthMm, estimated, threshold, inverted } = base;
  const sPx = base.structPxPerMm ?? pxPerMm; // leak detection scale (fixed, see prepare)
  const n = w * h;
  const timings = /** @type {Record<string, number>} */ ({});
  let tLast = t0;
  const mark = (/** @type {string} */ k) => {
    const t = now();
    timings[k] = Math.round(t - tLast);
    tLast = t;
  };
  const profile = opts.profile ?? BASSWOOD_3MM;

  // 1. Apply edits: wood paint becomes line, hole paint becomes a cut (never wood, never merges regions),
  //    the eraser turns lines back into paper (which then belongs to the area around it).
  const ink = Uint8Array.from(base.ink);
  const cut = new Uint8Array(n);
  if (edits) {
    for (let p = 0; p < n; p++) {
      const e = edits[p];
      if (e === EDIT_WOOD) ink[p] = 1;
      else if (e === EDIT_HOLE) {
        ink[p] = 0;
        cut[p] = 1;
      } else if (e === EDIT_PAPER) ink[p] = 0;
    }
  }
  /** Lines and cuts both separate paper regions. */
  const solid = new Uint8Array(n);
  for (let p = 0; p < n; p++) solid[p] = ink[p] | cut[p];

  // 2. Regions of paper; anything touching the image edge is waste.
  const regions = labelComponents(solid, w, h, 0, false);
  const waste = new Uint8Array(regions.count + 1);
  for (let r = 1; r <= regions.count; r++) waste[r] = regions.border[r];
  mark('regions');

  // 3. Typical stroke width from the line skeleton.
  const paper = new Uint8Array(n);
  for (let i = 0; i < n; i++) paper[i] = ink[i] ^ 1;
  const toPaper = distanceTo(paper, w, h);
  const skel = thin(ink, w, h);
  const strokeW = estimateStroke(skel, toPaper);
  mark('skeleton');

  /** Internals for tools/tests; not sent to the UI. @type {Record<string, any>} */
  const debug = {};
  /** What the piece looks like with every detected leak closed (same pixel classes as classMap). */
  let fixedClassMap = /** @type {Uint8Array|null} */ (null);
  /** The guess before Bucket clicks, per pixel (worker-only: the next re-check's prior). */
  let autoMap = /** @type {Uint8Array|null} */ (null);
  let regionClass = new Uint8Array(regions.count + 1);
  let confidence = new Float32Array(regions.count + 1).fill(1);
  /** @type {Issue[]} */
  const issues = [];
  /** @type {import('./gaps.js').Gap[]} */
  let gaps = [];

  if (mode === 'lineart') {
    // 4. Find gaps where a line stops just short of another, and close them all on a copy.
    const ends = strokeEnds(skel, w, h, Math.max(3, Math.round(strokeW * 1.5)));
    const gapMax = BASSWOOD_3MM.leakGapMm * sPx;
    const searchR = gapMax + strokeW / 2 + 1;
    gaps = findGaps(ink, w, h, ends, { searchR, geoLimit: Math.round(2 * searchR + 2 * strokeW), strokeW });
    // Necks: pinches in the paper narrower than the leak width (curves that almost touch).
    const toSolidRaw = distanceTo(solid, w, h);
    const det = { ...DETECTION, ...opts.detection };
    const necks = findNecks(solid, toSolidRaw, w, h, {
      coreR: (det.neckGapMm * sPx) / 2 + 0.5,
      minPart: Math.max(4 * strokeW * strokeW, det.neckMinPartMm2 * sPx * sPx),
    });
    for (const nk of necks) {
      const mx = (nk.ax + nk.bx) / 2;
      const my = (nk.ay + nk.by) / 2;
      if (!gaps.some((g) => Math.hypot((g.ax + g.bx) / 2 - mx, (g.ay + g.by) / 2 - my) < strokeW * 1.5)) gaps.push(nk);
    }
    const closedInk = Uint8Array.from(solid);
    for (const g of gaps) drawLine(closedInk, w, h, g.ax, g.ay, g.bx, g.by, 1);
    mark('gaps');

    // 5. Guess wood/hole on the closed drawing (what you'd get after fixing the gaps).
    const closed = labelComponents(closedInk, w, h, 0, false);
    const cWaste = new Uint8Array(closed.count + 1);
    for (let r = 1; r <= closed.count; r++) cWaste[r] = closed.border[r];
    const toInk = distanceTo(closedInk, w, h);
    const thickness = new Float32Array(closed.count + 1);
    for (let p = 0; p < n; p++) {
      const r = closed.labels[p];
      if (r && 2 * toInk[p] > thickness[r]) thickness[r] = 2 * toInk[p];
    }
    const graph = regionGraph(closedInk, closed.labels, closed.count, w, h, Math.max(6, strokeW));
    // Stability: lean toward what the previous scan decided for these pixels.
    let priorBias = null;
    if (opts.prior && opts.prior.length === n) {
      const pv = new Float64Array((closed.count + 1) * 2);
      for (let p = 0; p < n; p++) {
        const q = closed.labels[p];
        if (!q) continue;
        const c = opts.prior[p];
        if (c === PX_WOOD) pv[q * 2]++;
        else if (c === PX_HOLE) pv[q * 2 + 1]++;
      }
      priorBias = new Float64Array(closed.count + 1);
      for (let q = 1; q <= closed.count; q++) {
        const t = pv[q * 2] + pv[q * 2 + 1];
        if (t) priorBias[q] = PRIOR_WEIGHT * ((pv[q * 2] - pv[q * 2 + 1]) / t);
      }
    }
    const guess = classifyRegions({
      count: closed.count,
      area: closed.area,
      waste: cWaste,
      thickness,
      nb: graph.nb,
      contact: graph.contact,
      strokeW,
    }, opts.weights, priorBias);
    // The engine's own answer, before your Bucket clicks — this (not your clicks) is what the
    // next re-check leans on, so undoing a click really brings the old guess back.
    const autoCls = Uint8Array.from(guess.cls);
    autoMap = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (closedInk[p]) continue; // lines: not a vote either way
      const c = autoCls[closed.labels[p]];
      autoMap[p] = c === WOOD ? PX_WOOD : c === HOLE ? PX_HOLE : PX_WASTE;
    }
    // Bucket clicks win over the guess (latest click wins if several land in one region).
    for (const s of seeds) {
      if (!isAreaSeed(s)) continue;
      const q = closed.labels[s.y * w + s.x];
      if (q && !cWaste[q]) guess.cls[q] = seedClass(s);
    }
    mark('classify');
    debug.closed = closed;
    debug.guess = guess;
    debug.graph = graph;
    debug.thickness = thickness;
    debug.model = { count: closed.count, area: closed.area, waste: cWaste, thickness, nb: graph.nb, contact: graph.contact, strokeW };

    // 6. A gap is a leak when closing it separates wood from hole (or from the outside).
    for (const g of gaps) {
      const c = gapCenter(solid, w, g);
      const nx = -(g.by - g.ay);
      const ny = g.bx - g.ax;
      const nl = Math.hypot(nx, ny) || 1;
      const a = sideLabel(closedInk, closed.labels, w, h, c.x, c.y, nx / nl, ny / nl, strokeW + 4);
      const b = sideLabel(closedInk, closed.labels, w, h, c.x, c.y, -nx / nl, -ny / nl, strokeW + 4);
      if (!a || !b || a === b) continue;
      const ca = guess.cls[a];
      const cb = guess.cls[b];
      if (ca === cb || (ca !== WOOD && cb !== WOOD)) continue;
      (debug.leakSides ??= []).push({ c, a, b, ca, cb, areaA: closed.area[a], areaB: closed.area[b], confA: guess.confidence[a], confB: guess.confidence[b],
        ra: regions.labels[sidePx(closedInk, w, h, c, nx / nl, ny / nl, strokeW + 4)], rb: regions.labels[sidePx(closedInk, w, h, c, -nx / nl, -ny / nl, strokeW + 4)] });
      const gapMm = g.gapPx / pxPerMm;
      const into = ca === WASTE || cb === WASTE ? 'the outside' : 'a hole';
      const s = Math.round(strokeW * 4);
      issues.push({
        id: issueId('leak', c.x, c.y),
        type: 'leak',
        severity: 'critical',
        family: 'structure',
        estimated: false,
        label: `Leak, ${where(c.x, c.y, piece)}`,
        detail: `Gap of ${fmtMm(gapMm)} joins the wood to ${into}`,
        bbox: [Math.round(c.x - s), Math.round(c.y - s), 2 * s, 2 * s],
        anchor: [Math.round(c.x), Math.round(c.y)],
        measure: gapMm,
        regions: [regions.labels[Math.round(c.y) * w + Math.round(c.x)]].filter(Boolean),
        status: 'open',
        fix: { kind: 'close', ax: g.ax, ay: g.ay, bx: g.bx, by: g.by },
      });
    }

    // 6b. Open outlines (hints): a line stops a bit too far from the next one to be a leak, but
    //     closing it would make a sizeable piece of its own (a sun circle that doesn't close).
    const openings = findOpenings(solid, closed.labels, regions.labels, w, h, ends, {
      minGapPx: 0.5,
      maxGapPx: det.openingMaxMm * sPx,
      minPartPx: det.openingMinPartMm2 * sPx * sPx,
      strokeW,
      area: closed.area,
    });
    mark('leaks');
    const leakAt = issues.filter((i) => i.type === 'leak').map((i) => i.anchor);
    for (const g of openings) {
      const c = gapCenter(solid, w, g);
      if (leakAt.some(([x, y]) => Math.hypot(x - c.x, y - c.y) < strokeW * 4)) continue;
      const gapMm = g.gapPx / pxPerMm;
      const s2 = Math.round(strokeW * 4);
      issues.push({
        id: issueId('opening', c.x, c.y),
        type: 'opening',
        severity: 'info',
        family: 'structure',
        estimated: false,
        label: `Open outline, ${where(c.x, c.y, piece)}`,
        detail: `A line stops ${fmtMm(gapMm)} short of the next one; if the shape inside should be its own piece, close it`,
        bbox: [Math.round(Math.min(g.ax, g.bx) - s2), Math.round(Math.min(g.ay, g.by) - s2), Math.round(Math.abs(g.bx - g.ax) + 2 * s2), Math.round(Math.abs(g.by - g.ay) + 2 * s2)],
        anchor: [Math.round(c.x), Math.round(c.y)],
        measure: gapMm,
        status: 'open',
        fix: { kind: 'close', ax: g.ax, ay: g.ay, bx: g.bx, by: g.by },
      });
    }

    mark('openings');
    // Preview with the leaks closed: only the closures that are real leaks are kept as lines.
    const fixedInk = Uint8Array.from(ink);
    for (const i of issues) if (i.type === 'leak' && i.fix && i.fix.kind === 'close') drawLine(fixedInk, w, h, i.fix.ax, i.fix.ay, i.fix.bx, i.fix.by, 1);
    fixedClassMap = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (fixedInk[p]) fixedClassMap[p] = PX_LINE;
      else if (cut[p]) fixedClassMap[p] = PX_HOLE;
      else {
        const c = guess.cls[closed.labels[p]];
        fixedClassMap[p] = c === WOOD ? PX_WOOD : c === HOLE ? PX_HOLE : PX_WASTE;
      }
    }

    // 7. Each region takes the majority class of the closed regions it covers.
    const votes = new Float64Array((regions.count + 1) * 3);
    for (let p = 0; p < n; p++) {
      const r = regions.labels[p];
      const q = closed.labels[p];
      if (r && q) votes[r * 3 + guess.cls[q]]++;
    }
    for (let r = 1; r <= regions.count; r++) {
      if (waste[r]) {
        regionClass[r] = WASTE;
        continue;
      }
      const vw = votes[r * 3 + WOOD];
      const vh = votes[r * 3 + HOLE] + votes[r * 3 + WASTE];
      regionClass[r] = vw >= vh ? WOOD : HOLE;
    }
    // Confidence per region: the closed region covering most of it.
    confidence = new Float32Array(regions.count + 1).fill(1);
    const seen = new Uint8Array(regions.count + 1);
    for (let p = 0; p < n; p++) {
      const r = regions.labels[p];
      const q = closed.labels[p];
      if (r && q && !seen[r]) {
        seen[r] = 1;
        confidence[r] = guess.confidence[q];
      }
    }
  } else {
    // Filled art: dark masses are the wood, every enclosed light area is a hole.
    for (let r = 1; r <= regions.count; r++) regionClass[r] = waste[r] ? WASTE : HOLE;
    mark('classify');
  }

  // Bucket clicks also decide the (unclosed) region they landed in — that's what the bucket fills.
  // Engrave clicks make the region wood with a burned surface; any later area click there undoes it.
  const regionEngraved = new Uint8Array(regions.count + 1);
  for (const s of seeds) {
    if (!isAreaSeed(s)) continue;
    const r = regions.labels[s.y * w + s.x];
    if (r && !waste[r]) {
      regionClass[r] = seedClass(s);
      regionEngraved[r] = s.cls === SEED_ENGRAVE ? 1 : 0;
      confidence[r] = 1;
    }
  }

  // 8. Per-pixel map for display, and the wood mask (lines belong to the wood, cuts never do).
  const classMap = new Uint8Array(n);
  const wood = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (ink[p]) {
      classMap[p] = PX_LINE;
      wood[p] = 1;
    } else if (cut[p]) {
      classMap[p] = PX_HOLE;
    } else {
      const c = regionClass[regions.labels[p]];
      classMap[p] = c === WOOD ? PX_WOOD : c === HOLE ? PX_HOLE : PX_WASTE;
      if (c === WOOD) wood[p] = 1;
    }
  }

  // 9. Islands: wood not connected to the main body.
  const parts = labelComponents(wood, w, h, 1, true);
  let main = 0;
  for (let c = 1; c <= parts.count; c++) if (!main || parts.area[c] > parts.area[main]) main = c;
  const mm2 = pxPerMm * pxPerMm;
  for (let c = 1; c <= parts.count; c++) {
    if (c === main) continue;
    const areaMm = parts.area[c] / mm2;
    const speck = areaMm < profile.minIslandArea;
    const ax = parts.sumX[c] / parts.area[c];
    const ay = parts.sumY[c] / parts.area[c];
    const anchor = nearestIn(parts.labels, c, w, h, ax, ay, parts);
    issues.push({
      id: issueId(speck ? 'speck_island' : 'island', ax, ay),
      type: speck ? 'speck_island' : 'island',
      severity: speck ? 'info' : 'critical',
      family: 'structure',
      estimated: speck && estimated,
      label: speck ? `Speck, ${where(ax, ay, piece)}` : `Island, ${where(ax, ay, piece)}`,
      detail: speck
        ? `Tiny loose piece (${fmtArea(areaMm)}); usually just removed`
        : `Not attached to the rest (${fmtArea(areaMm)}); it will fall out when cut`,
      bbox: [parts.minX[c], parts.minY[c], parts.maxX[c] - parts.minX[c] + 1, parts.maxY[c] - parts.minY[c] + 1],
      anchor,
      measure: areaMm,
      status: 'open',
    });
  }
  mark('islands');

  // 10. Dimension checks in mm (thin wood, near-touch, speck holes).
  if (opts.dimensions !== false) {
    issues.push(...dimensionChecks(
      { classMap, w, h, pxPerMm, estimated, profile },
      { where: (x, y) => where(x, y, piece), mm: fmtMm, area: fmtArea, id: issueId },
    ));
    mark('dimensions');
  }

  const sev = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => sev[a.severity] - sev[b.severity] || a.anchor[1] - b.anchor[1]);
  // Ids must be unique even if two issues land in the same 8-px cell.
  const used = new Set();
  for (const i of issues) {
    let id = i.id;
    for (let k = 2; used.has(id); k++) id = `${i.id}~${k}`;
    used.add(id);
    i.id = id;
  }

  const summary = {
    leaks: issues.filter((i) => i.type === 'leak').length,
    islands: issues.filter((i) => i.type === 'island').length,
    specks: issues.filter((i) => i.type === 'speck_island').length,
    thin: issues.filter((i) => i.type === 'thin').length,
    openings: issues.filter((i) => i.type === 'opening').length,
    nearTouch: issues.filter((i) => i.type === 'near_touch').length,
    speckHoles: issues.filter((i) => i.type === 'speck_hole').length,
  };

  return {
    w,
    h,
    mode,
    threshold,
    autoThreshold: base.autoThreshold ?? threshold,
    inverted,
    strokeW,
    pxPerMm,
    widthMm,
    estimated,
    piece,
    regionCount: regions.count,
    gapsTried: gaps.length,
    labels: regions.labels,
    regionClass,
    regionEngraved,
    confidence,
    classMap,
    fixedClassMap,
    autoMap,
    issues,
    summary,
    timings,
    debug,
    totalMs: Math.round(now() - t0),
  };
}

/**
 * Prepare + scan in one go (no edits).
 * @param {Uint8ClampedArray|Uint8Array} rgba @param {number} w @param {number} h @param {ScanOptions} [opts]
 */
export function analyze(rgba, w, h, opts = {}) {
  const base = prepare(rgba, w, h, opts);
  const res = analyzeEdited(base, null, [], opts);
  res.timings = { prepare: base.prepMs, ...res.timings };
  res.totalMs += base.prepMs;
  return res;
}

/** Stable-ish id: type + position on an 8-px grid, so an issue keeps its id across re-scans. */
function issueId(/** @type {string} */ type, /** @type {number} */ x, /** @type {number} */ y) {
  return `${type}@${Math.round(x / 8)},${Math.round(y / 8)}`;
}

// ---- helpers ------------------------------------------------------------------

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Bounding box of everything that isn't waste.
 * @param {Int32Array} labels @param {Uint8Array} waste @param {number} w @param {number} h
 */
function pieceBox(labels, waste, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = labels[y * w + x];
      if (r && waste[r]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** @param {Uint8Array} skel @param {Float32Array} toPaper */
function estimateStroke(skel, toPaper) {
  /** @type {number[]} */
  const v = [];
  for (let p = 0; p < skel.length; p++) if (skel[p]) v.push(toPaper[p]);
  if (!v.length) return 3;
  v.sort((a, b) => a - b);
  return Math.max(1, 2 * v[v.length >> 1]);
}

/**
 * Middle of the empty stretch along a gap segment.
 * @param {Uint8Array} ink @param {number} w @param {import('./gaps.js').Gap} g
 */
function gapCenter(ink, w, g) {
  const len = Math.hypot(g.bx - g.ax, g.by - g.ay);
  const steps = Math.max(1, Math.round(len * 2));
  let sx = 0, sy = 0, n = 0;
  for (let s = 0; s <= steps; s++) {
    const x = g.ax + ((g.bx - g.ax) * s) / steps;
    const y = g.ay + ((g.by - g.ay) * s) / steps;
    if (!ink[Math.round(y) * w + Math.round(x)]) {
      sx += x;
      sy += y;
      n++;
    }
  }
  return n ? { x: sx / n, y: sy / n } : { x: (g.ax + g.bx) / 2, y: (g.ay + g.by) / 2 };
}

/**
 * First region label found stepping from (x, y) along (dx, dy), skipping ink.
 * @param {Uint8Array} ink @param {Int32Array} labels @param {number} w @param {number} h
 * @param {number} x @param {number} y @param {number} dx @param {number} dy @param {number} maxStep
 */
function sideLabel(ink, labels, w, h, x, y, dx, dy, maxStep) {
  for (let k = 1; k <= maxStep; k++) {
    const px = Math.round(x + dx * k);
    const py = Math.round(y + dy * k);
    if (px < 0 || py < 0 || px >= w || py >= h) return 0;
    const p = py * w + px;
    if (!ink[p] && labels[p]) return labels[p];
  }
  return 0;
}

/** Index of the first non-ink pixel stepping from c along (dx, dy). */
function sidePx(/** @type {Uint8Array} */ ink, /** @type {number} */ w, /** @type {number} */ h, /** @type {{x:number,y:number}} */ c, /** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ maxStep) {
  for (let k = 1; k <= maxStep; k++) {
    const px = Math.round(c.x + dx * k);
    const py = Math.round(c.y + dy * k);
    if (px < 0 || py < 0 || px >= w || py >= h) return 0;
    const p = py * w + px;
    if (!ink[p]) return p;
  }
  return 0;
}

/**
 * A pixel of component c close to (x, y) — centroids can fall outside ring shapes.
 * @param {Int32Array} labels @param {number} c @param {number} w @param {number} h
 * @param {number} x @param {number} y @param {import('./label.js').Components} parts
 * @returns {[number, number]}
 */
function nearestIn(labels, c, w, h, x, y, parts) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (labels[iy * w + ix] === c) return [ix, iy];
  let best = /** @type {[number, number]} */ ([ix, iy]);
  let bestD = Infinity;
  for (let yy = parts.minY[c]; yy <= parts.maxY[c]; yy++) {
    for (let xx = parts.minX[c]; xx <= parts.maxX[c]; xx++) {
      if (labels[yy * w + xx] !== c) continue;
      const d = (xx - x) * (xx - x) + (yy - y) * (yy - y);
      if (d < bestD) {
        bestD = d;
        best = [xx, yy];
      }
    }
  }
  return best;
}

/** Plain-words position inside the piece: "upper left", "middle", "bottom right"… */
function where(/** @type {number} */ x, /** @type {number} */ y, /** @type {{x:number,y:number,w:number,h:number}} */ b) {
  const fx = (x - b.x) / Math.max(1, b.w);
  const fy = (y - b.y) / Math.max(1, b.h);
  const v = fy < 0.2 ? 'top' : fy < 0.4 ? 'upper' : fy < 0.6 ? 'middle' : fy < 0.8 ? 'lower' : 'bottom';
  const hz = fx < 0.34 ? 'left' : fx > 0.66 ? 'right' : '';
  if (v === 'middle' && !hz) return 'center';
  return hz ? `${v} ${hz}` : v === 'middle' ? 'center' : v;
}

/** @param {number} mm */
function fmtMm(mm) {
  return `${mm < 1 ? mm.toFixed(2) : mm.toFixed(1)} mm`;
}
/** @param {number} mm2 */
function fmtArea(mm2) {
  return `${mm2 < 10 ? mm2.toFixed(1) : Math.round(mm2)} mm²`;
}
