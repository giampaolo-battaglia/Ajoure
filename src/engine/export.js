// @ts-check
// SVG export for XCS (SPEC §9): the scan's wood becomes closed cut lines at real size (mm);
// floating details (lines with wood on both sides, e.g. stamens) become score lines, engraved
// fills, or nothing. One colour per job so XCS can assign cut / score / engrave by colour.
// Pure, no DOM: runs in the helper worker and in Node tests.

import { traceMask, smoothClosed, closedPathData, skeletonPaths, skeletonKinds, signedArea } from './trace.js';
import { distanceTo } from './distance.js';
import { thin } from './skeleton.js';
import { labelComponents } from './label.js';

const PX_WASTE = 0, PX_WOOD = 1, PX_HOLE = 2, PX_LINE = 3;

/** Colours XCS maps to processing types. */
export const COLORS = Object.freeze({ cut: '#FF0000', score: '#0000FF', engrave: '#000000' });

/**
 * @typedef {'score'|'engrave'|'drop'} DetailMode
 * @typedef {Object} CutGeometry
 * @property {Float64Array[]} cuts   smoothed closed outlines (px), holes first, then outer edges
 * @property {boolean[]} isHole
 * @property {Float64Array[]} scores open polylines (px)
 * @property {Float64Array[]} engrave closed outlines of engraved lines (px; fill even-odd)
 * @property {Float64Array[]} engraveAreas closed outlines of engraved areas, with their outline (px; fill even-odd)
 * @property {{x0:number, y0:number, x1:number, y1:number}} box  the piece (px)
 * @property {{pieces:number, holes:number, cutMm:number, scoreMm:number, details:number, scored:number, engravedLines:number, engravedAreas:number, widthMm:number, heightMm:number}} stats
 */

/** Seed classes for one line (see analyze.js). */
const LINE_SCORE = 4, LINE_ENGRAVE = 5;

/**
 * @param {{classMap: Uint8Array, w: number, h: number, strokeW: number,
 *          labels?: Int32Array, regionEngraved?: Uint8Array}} scan
 * @param {{details?: DetailMode, lineMarks?: {x:number, y:number, cls:number}[]}} [opts]
 *   details: what floating lines become by default; lineMarks: Engrave-tool clicks on single lines
 * @returns {CutGeometry}
 */
export function cutGeometry(scan, opts = {}) {
  const { classMap, w, h } = scan;
  const n = w * h;
  const mode = opts.details ?? 'score';
  const sw = Math.max(1, scan.strokeW || 2);
  const wood = new Uint8Array(n);
  const notWood = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const c = classMap[p];
    if (c === PX_WOOD || c === PX_LINE) wood[p] = 1;
    else notWood[p] = 1;
  }
  const ink = new Uint8Array(n);
  const notInk = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (classMap[p] === PX_LINE) ink[p] = 1;
    else notInk[p] = 1;
  }

  // Engraved areas (Engrave tool): the area's paper plus the lines drawn around and inside it,
  // so a bat drawn as an outline burns as one solid silhouette. A line that only touches the
  // shape (a branch leaving it) is taken for about half a stroke, then stops.
  const areaEng = new Uint8Array(n);
  let nAreaPx = 0;
  if (scan.labels && scan.regionEngraved) {
    const { labels, regionEngraved } = scan;
    for (let p = 0; p < n; p++) {
      if (classMap[p] === PX_WOOD && regionEngraved[labels[p]]) {
        areaEng[p] = 1;
        nAreaPx++;
      }
    }
  }
  if (nAreaPx) {
    const other = new Uint8Array(n);
    for (let p = 0; p < n; p++) other[p] = !ink[p] && !areaEng[p] ? 1 : 0;
    const toEng = distanceTo(areaEng, w, h);
    const toOther = distanceTo(other, w, h);
    for (let p = 0; p < n; p++) {
      if (ink[p] && toEng[p] <= Math.max(sw * 1.5, toOther[p] + sw) + 1) areaEng[p] = 1;
    }
  }

  // Floating details (SPEC §4.1, §8.8): lines with wood on both sides, so they're never cut.
  // Judged on the line's centre: floating if no hole or outside lies within the line's own
  // half-width (plus a margin) — a line along a hole always has the hole right next to it.
  const skel = thin(ink, w, h);
  const half = distanceTo(notInk, w, h); // on the centre line: half the stroke width
  const toOpen = distanceTo(notWood, w, h);
  // Hysteresis: clearly floating somewhere (strong), and the line keeps going while it stays
  // nearly floating (weak) — so a stamen isn't chopped up where it passes close to a hole.
  const floatSkel = new Uint8Array(n);
  const stack = [];
  for (let p = 0; p < n; p++) {
    if (skel[p] && !areaEng[p] && toOpen[p] > half[p] + 1.5) {
      floatSkel[p] = 1;
      stack.push(p);
    }
  }
  const nb8 = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  while (stack.length) {
    const p = /** @type {number} */ (stack.pop());
    const x = p % w;
    for (const o of nb8) {
      const q = p + o;
      if (q < 0 || q >= n || Math.abs((q % w) - x) > 1 || !skel[q] || floatSkel[q] || areaEng[q]) continue;
      if (toOpen[q] > half[q] + 0.25) {
        floatSkel[q] = 1;
        stack.push(q);
      }
    }
  }

  // Each floating line is scored, engraved or dropped: the default for all of them, unless an
  // Engrave-tool click picked something else for one. "One line" is a stroke from fork to fork
  // (or end), so clicking the moon's rim doesn't also switch the castle it touches.
  const kind = skeletonKinds(floatSkel, w, h);
  // Forks and the pixels right around them separate the strokes (diagonal neighbours of a fork
  // would otherwise still touch each other).
  const runs = Uint8Array.from(floatSkel);
  for (let p = 0; p < n; p++) {
    if (kind[p] !== 3) continue;
    const x = p % w;
    runs[p] = 0;
    for (const o of nb8) {
      const q = p + o;
      if (q >= 0 && q < n && Math.abs((q % w) - x) <= 1) runs[q] = 0;
    }
  }
  const lines = labelComponents(runs, w, h, 1, true);
  const lineMode = /** @type {DetailMode[]} */ (new Array(lines.count + 1).fill(mode));
  for (const m of opts.lineMarks || []) {
    if (m.cls !== LINE_SCORE && m.cls !== LINE_ENGRAVE) continue;
    const c = nearestLabel(lines.labels, w, h, m.x, m.y, Math.ceil(sw * 1.5) + 4);
    if (c) lineMode[c] = m.cls === LINE_ENGRAVE ? 'engrave' : 'score';
  }
  const scoreSkel = new Uint8Array(n);
  const engraveSkel = new Uint8Array(n);
  let nScore = 0, nEngrave = 0;
  /** @param {number} p @param {DetailMode} md */
  const put = (p, md) => {
    if (md === 'score' && !scoreSkel[p]) {
      scoreSkel[p] = 1;
      nScore++;
    } else if (md === 'engrave' && !engraveSkel[p]) {
      engraveSkel[p] = 1;
      nEngrave++;
    }
  };
  for (let p = 0; p < n; p++) {
    if (!floatSkel[p]) continue;
    const c = lines.labels[p];
    if (c) {
      put(p, lineMode[c]);
      continue;
    }
    // A fork joins the strokes around it: it takes each of their choices (or the default alone).
    const x = p % w, y = (p - x) / w;
    let any = false;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const cq = lines.labels[yy * w + xx];
        if (cq) {
          put(p, lineMode[cq]);
          any = true;
        }
      }
    }
    if (!any) put(p, mode);
  }

  // Cut lines: every outline of the wood. Tiny bits (< 2 px²) are noise.
  /** @type {Float64Array[]} */
  const holes = [];
  /** @type {Float64Array[]} */
  const outers = [];
  for (const c of traceMask(wood, w, h)) {
    if (Math.abs(c.area) < 2) continue;
    const sigma = Math.min(1.2, Math.sqrt(Math.abs(c.area)) / 6);
    const s = smoothClosed(c.pts, Math.max(0.5, sigma), 0.3);
    if (s.length < 6) continue;
    (c.hole ? holes : outers).push(s);
  }

  /** @type {Float64Array[]} */
  const scores = nScore ? skeletonPaths(scoreSkel, w, h, Math.max(5, Math.round(sw * 1.2))) : [];
  /** @type {Float64Array[]} */
  const engrave = [];
  if (nEngrave) {
    // The full drawn width of those lines: grow each centre-line pixel back by its half-width.
    const floating = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (!engraveSkel[p]) continue;
      const r = half[p] + 0.5;
      const x = p % w, y = (p - x) / w;
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || dx * dx + dy * dy > r * r) continue;
          const q = yy * w + xx;
          if (ink[q] && !areaEng[q]) floating[q] = 1;
        }
      }
    }
    for (const c of traceMask(floating, w, h)) {
      if (Math.abs(c.area) < 4) continue;
      engrave.push(smoothClosed(c.pts, 0.8, 0.25));
    }
  }
  /** @type {Float64Array[]} */
  const engraveAreas = [];
  let nAreas = 0;
  if (nAreaPx) {
    for (const c of traceMask(areaEng, w, h)) {
      if (Math.abs(c.area) < 4) continue;
      // Same smoothing as the cut lines: a shape's edge is as clean as the cut next to it.
      const s = smoothClosed(c.pts, Math.max(0.5, Math.min(1.2, Math.sqrt(Math.abs(c.area)) / 6)), 0.3);
      if (s.length < 6) continue;
      engraveAreas.push(s);
      if (!c.hole) nAreas++;
    }
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of outers) {
    for (let i = 0; i < s.length; i += 2) {
      if (s[i] < x0) x0 = s[i];
      if (s[i] > x1) x1 = s[i];
      if (s[i + 1] < y0) y0 = s[i + 1];
      if (s[i + 1] > y1) y1 = s[i + 1];
    }
  }
  if (!outers.length) { x0 = y0 = 0; x1 = w; y1 = h; }
  const cuts = [...holes, ...outers]; // insides first, then the outline: the piece stays put while cutting
  return {
    cuts,
    isHole: cuts.map((_, i) => i < holes.length),
    scores,
    engrave,
    engraveAreas,
    box: { x0, y0, x1, y1 },
    stats: {
      pieces: outers.length,
      holes: holes.length,
      cutMm: 0,
      scoreMm: 0,
      details: scores.length + engrave.length,
      scored: scores.length,
      engravedLines: engrave.length,
      engravedAreas: nAreas,
      widthMm: 0,
      heightMm: 0,
    },
  };
}

/**
 * The label nearest to (x, y) within r px (0 if none).
 * @param {Int32Array} labels @param {number} w @param {number} h @param {number} x @param {number} y @param {number} r
 */
function nearestLabel(labels, w, h, x, y, r) {
  let best = 0, bestD = Infinity;
  const cx = Math.round(x), cy = Math.round(y);
  for (let yy = Math.max(0, cy - r); yy <= Math.min(h - 1, cy + r); yy++) {
    for (let xx = Math.max(0, cx - r); xx <= Math.min(w - 1, cx + r); xx++) {
      const c = labels[yy * w + xx];
      if (!c) continue;
      const d = (xx - x) * (xx - x) + (yy - y) * (yy - y);
      if (d < bestD && d <= r * r) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/** @param {Float64Array} p @param {boolean} closed */
function lengthOf(p, closed) {
  let L = 0;
  const n = p.length / 2;
  for (let i = 1; i < n; i++) L += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
  if (closed && n > 2) L += Math.hypot(p[0] - p[2 * n - 2], p[1] - p[2 * n - 1]);
  return L;
}

/**
 * Write the SVG. Units are mm: width/height carry "mm", the viewBox is in mm, so XCS imports it
 * at real size. A 1 mm margin around the piece.
 * @param {CutGeometry} g @param {number} pxPerMm @param {{name?: string, material?: string, estimated?: boolean}} [meta]
 */
export function writeSvg(g, pxPerMm, meta = {}) {
  const k = 1 / pxPerMm;
  const margin = 1;
  const ox = g.box.x0 - margin * pxPerMm;
  const oy = g.box.y0 - margin * pxPerMm;
  const W = (g.box.x1 - g.box.x0) * k + 2 * margin;
  const H = (g.box.y1 - g.box.y0) * k + 2 * margin;
  const f = (/** @type {number} */ v) => (Math.round(v * 1000) / 1000).toString();
  const cutPaths = g.cuts.map((c) => `    <path d="${closedPathData(c, f, k, ox, oy)}"/>`);
  const scorePaths = g.scores.map((p) => {
    const parts = [];
    for (let i = 0; i < p.length; i += 2) parts.push(`${i ? 'L' : 'M'}${f((p[i] - ox) * k)} ${f((p[i + 1] - oy) * k)}`);
    return `    <path d="${parts.join('')}"/>`;
  });
  // Engraving: one compound path per kind, filled even-odd, so a ring or a shape with a hole in
  // it burns as drawn (the inner outline is a gap, not a second filled shape).
  const compound = (/** @type {Float64Array[]} */ list) => list.map((c) => closedPathData(c, f, k, ox, oy)).join('');
  const engravePaths = [];
  if (g.engraveAreas.length) engravePaths.push(`    <path id="engraved-areas" d="${compound(g.engraveAreas)}"/>`);
  if (g.engrave.length) engravePaths.push(`    <path id="engraved-lines" d="${compound(g.engrave)}"/>`);
  g.stats.cutMm = g.cuts.reduce((s, c) => s + lengthOf(c, true), 0) * k;
  g.stats.scoreMm = g.scores.reduce((s, p) => s + lengthOf(p, false), 0) * k;
  g.stats.widthMm = W - 2 * margin;
  g.stats.heightMm = H - 2 * margin;
  const esc = (/** @type {string} */ s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] || c);
  const desc = [
    `Made with Ajouré. ${f(g.stats.widthMm)} × ${f(g.stats.heightMm)} mm${meta.estimated ? ' (size estimated)' : ''}.`,
    meta.material ? `Material: ${meta.material}.` : '',
    `Red (${COLORS.cut}) = cut, ${g.stats.holes} holes + ${g.stats.pieces} outline${g.stats.pieces > 1 ? 's' : ''}.`,
    g.scores.length ? `Blue (${COLORS.score}) = score, ${g.scores.length} lines.` : '',
    g.engrave.length || g.engraveAreas.length
      ? `Black fill = engrave${g.stats.engravedAreas ? `, ${g.stats.engravedAreas} area${g.stats.engravedAreas > 1 ? 's' : ''}` : ''}${g.engrave.length ? `, ${g.engrave.length} line${g.engrave.length > 1 ? 's' : ''}` : ''}.`
      : '',
  ].filter(Boolean).join(' ');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">`,
    `  <title>${esc(meta.name || 'Ajouré piece')}</title>`,
    `  <desc>${esc(desc)}</desc>`,
  ];
  if (engravePaths.length) lines.push(`  <g id="engrave" fill="${COLORS.engrave}" fill-rule="evenodd" stroke="none">`, ...engravePaths, '  </g>');
  if (scorePaths.length) lines.push(`  <g id="score" fill="none" stroke="${COLORS.score}" stroke-width="0.1" stroke-linecap="round" stroke-linejoin="round">`, ...scorePaths, '  </g>');
  lines.push(`  <g id="cut" fill="none" stroke="${COLORS.cut}" stroke-width="0.1">`, ...cutPaths, '  </g>', '</svg>', '');
  return lines.join('\n');
}

/**
 * Path data in image px for drawing the preview (all outlines; fill with evenodd for the wood).
 * @param {CutGeometry} g
 */
export function previewPaths(g) {
  const f = (/** @type {number} */ v) => v.toFixed(2);
  return {
    wood: g.cuts.map((c) => closedPathData(c, f, 1, 0, 0)).join(''),
    outline: g.cuts.filter((_, i) => !g.isHole[i]).map((c) => closedPathData(c, f, 1, 0, 0)).join(''),
    scores: g.scores.map((p) => {
      const parts = [];
      for (let i = 0; i < p.length; i += 2) parts.push(`${i ? 'L' : 'M'}${f(p[i])} ${f(p[i + 1])}`);
      return parts.join('');
    }).join(''),
    engrave: g.engrave.map((c) => closedPathData(c, f, 1, 0, 0)).join(''),
    engraveAreas: g.engraveAreas.map((c) => closedPathData(c, f, 1, 0, 0)).join(''),
  };
}

export { signedArea };
