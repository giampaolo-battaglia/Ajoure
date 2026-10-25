// Engraved areas and per-line choices (Engrave tool): the area stays wood, its surface burns as one
// solid shape (outline included); a click on a single floating line picks score or engrave for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvas } from './helpers/draw.mjs';
import {
  prepare, analyzeEdited, WOOD, PX_WOOD, SEED_ENGRAVE, SEED_LINE_SCORE, SEED_LINE_ENGRAVE, isAreaSeed,
} from '../src/engine/analyze.js';
import { cutGeometry, writeSvg, previewPaths } from '../src/engine/export.js';

const W = 200, H = 200;

/** A plate (one outline) with a ring drawn on it (the "bat") and a free line (a detail). */
function drawing() {
  const c = canvas(W, H);
  c.rect(20, 20, 179, 179);
  c.circle(80, 90, 22);
  c.line(130, 60, 130, 140);
  return c;
}

/** Bounding box of an outline list (px). @param {Float64Array[]} list */
function bbox(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of list) for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

test('an Engrave click makes the area wood, engraved, and a later Bucket click undoes it', () => {
  const base = prepare(drawing().rgba(), W, H);
  const plateSeed = { x: 40, y: 160, cls: WOOD };
  const s = analyzeEdited(base, null, [plateSeed, { x: 80, y: 90, cls: SEED_ENGRAVE }]);
  const r = s.labels[90 * W + 80];
  assert.equal(s.regionEngraved[r], 1);
  assert.equal(s.classMap[90 * W + 80], PX_WOOD);
  const plain = analyzeEdited(base, null, [plateSeed, { x: 80, y: 90, cls: SEED_ENGRAVE }, { x: 85, y: 95, cls: WOOD }]);
  assert.equal(plain.regionEngraved[plain.labels[90 * W + 80]], 0);
  // Line seeds never change an area.
  const lineOnly = analyzeEdited(base, null, [plateSeed, { x: 80, y: 90, cls: SEED_LINE_ENGRAVE }]);
  assert.deepEqual(Array.from(lineOnly.classMap), Array.from(analyzeEdited(base, null, [plateSeed]).classMap));
  assert.ok(isAreaSeed({ x: 0, y: 0, cls: SEED_ENGRAVE }) && !isAreaSeed({ x: 0, y: 0, cls: SEED_LINE_SCORE }));
});

test('the engraved area burns as one solid shape: its outline included, not scored', () => {
  const base = prepare(drawing().rgba(), W, H);
  const s = analyzeEdited(base, null, [{ x: 40, y: 160, cls: WOOD }, { x: 80, y: 90, cls: SEED_ENGRAVE }]);
  const g = cutGeometry(s, { details: 'score' });
  assert.equal(g.stats.engravedAreas, 1);
  const b = bbox(g.engraveAreas);
  // Ring radius 22 drawn with a 3 px pen: the silhouette reaches the outer edge of the pen (~23.5).
  assert.ok(b.x0 < 80 - 22.5 && b.x1 > 80 + 22.5, JSON.stringify(b));
  assert.ok(b.x0 > 80 - 26 && b.x1 < 80 + 26, JSON.stringify(b));
  // The ring isn't also scored; the free line still is.
  assert.equal(g.scores.length, 1);
  assert.ok(bbox(g.scores).x0 > 125);
  const svg = writeSvg(g, 4);
  assert.match(svg, /<g id="engrave" fill="#000000" fill-rule="evenodd"/);
  assert.match(svg, /id="engraved-areas"/);
  assert.ok(previewPaths(g).engraveAreas.length > 0);
});

test('a click on one line engraves just that line (or scores it when lines default to engrave)', () => {
  const base = prepare(drawing().rgba(), W, H);
  const s = analyzeEdited(base, null, [{ x: 40, y: 160, cls: WOOD }, { x: 80, y: 90, cls: WOOD }]);
  const all = cutGeometry(s, { details: 'score' });
  assert.equal(all.scores.length, 2); // the ring and the line
  const one = cutGeometry(s, { details: 'score', lineMarks: [{ x: 131, y: 100, cls: SEED_LINE_ENGRAVE }] });
  assert.equal(one.scores.length, 1);
  assert.equal(one.engrave.length, 1);
  assert.ok(bbox(one.engrave).x0 > 125);
  const back = cutGeometry(s, { details: 'engrave', lineMarks: [{ x: 131, y: 100, cls: SEED_LINE_SCORE }] });
  assert.equal(back.scores.length, 1);
  assert.ok(bbox(back.scores).x0 > 125);
  assert.ok(back.engrave.length >= 1);
  // A click far from any floating line does nothing.
  const none = cutGeometry(s, { details: 'score', lineMarks: [{ x: 100, y: 160, cls: SEED_LINE_ENGRAVE }] });
  assert.equal(none.scores.length, 2);
});

test('one line is a stroke from fork to fork: the click switches just that stroke', () => {
  const c = canvas(W, H);
  c.rect(20, 20, 179, 179);
  c.line(130, 50, 130, 150); // a stem…
  c.line(130, 100, 165, 100); // …with a branch: a T
  const base = prepare(c.rgba(), W, H);
  const s = analyzeEdited(base, null, [{ x: 40, y: 160, cls: WOOD }]);
  const g = cutGeometry(s, { details: 'score', lineMarks: [{ x: 131, y: 65, cls: SEED_LINE_ENGRAVE }] });
  const b = bbox(g.engrave);
  assert.ok(b.y0 < 55 && b.y1 < 108, `only the upper stroke (to the fork): ${JSON.stringify(b)}`);
  assert.ok(b.x1 < 140, 'not the branch');
  assert.ok(g.scores.length >= 2, 'the lower stem and the branch stay scored');
});
