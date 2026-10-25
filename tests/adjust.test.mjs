// Adjustments (SPEC §5.2), dimension checks (SPEC §4, §8.7) and scale-free structure checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustGray, adjustInk, isAdjusted, NO_ADJUST } from '../src/engine/adjust.js';
import { analyze, prepare, analyzeEdited } from '../src/engine/analyze.js';
import { readPng } from './helpers/png.mjs';

const fixture = (/** @type {string} */ f) => new URL(`../fixtures/${f}`, import.meta.url).pathname;

test('isAdjusted only when something differs from the defaults', () => {
  assert.equal(isAdjusted(NO_ADJUST), false);
  assert.equal(isAdjusted({ ...NO_ADJUST, lineWeight: 1 }), true);
  assert.equal(isAdjusted({ threshold: null }), false);
  assert.equal(isAdjusted({ invert: 'on' }), true);
});

test('brightness and contrast move grey values the right way', () => {
  const g = Uint8Array.from([50, 128, 200]);
  const brighter = adjustGray(g, 3, 1, { brightness: 50 });
  assert.ok(brighter[0] > 50 && brighter[2] > 200);
  const punchier = adjustGray(g, 3, 1, { contrast: 50 });
  assert.ok(punchier[0] < 50 && punchier[2] > 200 && Math.abs(punchier[1] - 128) <= 1);
});

test('line weight +1 closes a 2-px gap; -1 thins a 5-px line', () => {
  const w = 20, h = 9;
  const ink = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) if (x < 9 || x > 10) ink[4 * w + x] = 1; // a line with a 2-px gap
  adjustInk(ink, w, h, { lineWeight: 1 });
  assert.equal(ink[4 * w + 9], 1);
  assert.equal(ink[4 * w + 10], 1);
  const thick = new Uint8Array(w * h);
  for (let y = 2; y <= 6; y++) for (let x = 0; x < w; x++) thick[y * w + x] = 1;
  adjustInk(thick, w, h, { lineWeight: -1 });
  assert.equal(thick[2 * w + 10], 0);
  assert.equal(thick[4 * w + 10], 1);
});

test('despeckle removes loose dots but keeps lines', () => {
  const w = 20, h = 10;
  const ink = new Uint8Array(w * h);
  ink[2 * w + 3] = ink[2 * w + 4] = 1; // a 2-px dot
  for (let x = 0; x < w; x++) ink[7 * w + x] = 1; // a line
  adjustInk(ink, w, h, { despeckle: 4 });
  assert.equal(ink[2 * w + 3], 0);
  assert.equal(ink[7 * w + 10], 1);
});

const img = readPng(fixture('julie-input.png'));

test('Julie: leaks and islands do not depend on the entered width (structure is scale-free)', () => {
  for (const widthMm of [35, 70, 120]) {
    const res = analyze(img.data, img.width, img.height, { widthMm });
    assert.equal(res.summary.leaks, 2, `leaks at ${widthMm} mm`);
    assert.equal(res.summary.islands, 1, `islands at ${widthMm} mm`);
    assert.equal(res.estimated, false);
  }
});

test('Julie: dimension issues are few, marked estimated, and shrink with a bigger real size', () => {
  const est = analyze(img.data, img.width, img.height);
  const dims = est.issues.filter((i) => i.family === 'dimension');
  assert.ok(dims.length <= 12, `${dims.length} dimension issues at the estimate`);
  assert.ok(dims.every((i) => i.estimated));
  const big = analyze(img.data, img.width, img.height, { widthMm: 100 });
  assert.ok(big.issues.filter((i) => i.family === 'dimension').length <= dims.length);
});

test('Julie: a small piece in a stiff material shows thin wood, and Thicken-style paint fixes it', () => {
  const profile = { name: 'test', thicknessMm: 3, kerfMm: 0.15, minWoodWidth: 1.5, minHoleWidth: 0.4, minHoleArea: 0.5, minIslandArea: 0.5, leakGapMm: 0.6 };
  const base = prepare(img.data, img.width, img.height, { widthMm: 20 });
  const res = analyzeEdited(base, null, [], { profile });
  const thin = res.issues.filter((i) => i.type === 'thin');
  assert.ok(thin.length > 0, 'thin wood found');
  const t = thin[0];
  assert.ok(t.fix && t.fix.kind === 'thicken');
  const edits = new Uint8Array(img.width * img.height);
  const { pts, r } = /** @type {{pts:number[], r:number}} */ (t.fix);
  for (let k = 0; k + 1 < pts.length; k += 2) {
    const cx = pts[k], cy = pts[k + 1];
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= (r + 0.5) ** 2) edits[y * img.width + x] = 1;
    }
  }
  const after = analyzeEdited(base, edits, [], { profile });
  assert.ok(!after.issues.some((i) => i.type === 'thin' && i.id === t.id), 'that thin spot is gone');
});
