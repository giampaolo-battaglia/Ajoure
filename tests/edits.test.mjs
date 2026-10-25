// Edits layer: wood paint, hole cuts and Bucket clicks, re-scanned from a prepared base.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { canvas, paint } from './helpers/draw.mjs';
import { readPng } from './helpers/png.mjs';
import { julieTruth, agreement } from './helpers/julie-truth.mjs';
import {
  prepare, analyzeEdited, EDIT_WOOD, EDIT_HOLE, EDIT_PAPER, WOOD, PX_WOOD, PX_HOLE,
} from '../src/engine/analyze.js';

const W = 240, H = 240;
const at = (/** @type {Uint8Array} */ m, /** @type {number} */ x, /** @type {number} */ y) => m[y * W + x];

function framed() {
  const c = canvas(W, H);
  c.rect(20, 20, 219, 219);
  c.rect(34, 34, 205, 205);
  return c;
}

test('painting wood across a gap closes the leak', () => {
  const c = framed();
  c.erase(110, 31, 113, 37);
  const base = prepare(c.rgba(), W, H);
  const before = analyzeEdited(base, null);
  assert.ok(before.summary.leaks >= 1);
  const edits = new Uint8Array(W * H);
  paint(edits, W, H, 106, 34, 117, 34, 2, EDIT_WOOD);
  const after = analyzeEdited(base, edits);
  assert.equal(after.summary.leaks, 0, JSON.stringify(after.issues.map((i) => i.label)));
  assert.equal(at(after.classMap, 120, 120), PX_HOLE);
});

test('cutting out an island removes it', () => {
  const c = framed();
  c.circle(120, 120, 14);
  const base = prepare(c.rgba(), W, H);
  assert.equal(analyzeEdited(base, null).summary.islands, 1);
  const edits = new Uint8Array(W * H);
  for (let y = 102; y <= 138; y++) for (let x = 102; x <= 138; x++) edits[y * W + x] = EDIT_HOLE;
  const after = analyzeEdited(base, edits);
  assert.equal(after.summary.islands, 0);
  assert.equal(at(after.classMap, 120, 120), PX_HOLE);
});

test('a hole cut across a line does not merge the regions on either side', () => {
  const c = framed();
  const base = prepare(c.rgba(), W, H);
  const edits = new Uint8Array(W * H);
  paint(edits, W, H, 120, 30, 120, 38, 2, EDIT_HOLE); // across the inner frame line
  const r = analyzeEdited(base, edits);
  assert.equal(at(r.classMap, 27, 120), PX_WOOD); // frame band stays wood
  assert.equal(at(r.classMap, 120, 120), PX_HOLE);
  assert.equal(r.summary.islands, 0);
  assert.equal(r.summary.leaks, 0);
});

test('the eraser turns a line back into paper: a star outline opened by it joins the area around it', () => {
  const c = framed();
  c.circle(120, 120, 20); // a "star" inside the big area
  const base = prepare(c.rgba(), W, H);
  const seeds = [{ x: 60, y: 60, cls: WOOD }]; // the big area is wood
  const before = analyzeEdited(base, null, seeds);
  assert.notEqual(before.labels[120 * W + 120], before.labels[60 * W + 60]);
  const edits = new Uint8Array(W * H);
  paint(edits, W, H, 138, 120, 143, 120, 4, EDIT_PAPER); // erase a bit of the circle's right side
  const after = analyzeEdited(base, edits, seeds);
  assert.equal(after.labels[120 * W + 120], after.labels[60 * W + 60], 'one area now');
  assert.equal(at(after.classMap, 120, 120), PX_WOOD);
  assert.equal(at(after.classMap, 140, 120), PX_WOOD, 'the erased pixels are paper of that area');
});

test('hole paint turned back into paper (the Bucket on a painted cut) follows the area again', () => {
  const c = framed();
  c.circle(120, 120, 20);
  const base = prepare(c.rgba(), W, H);
  const edits = new Uint8Array(W * H);
  paint(edits, W, H, 136, 120, 146, 120, 4, EDIT_HOLE); // "erased" with the hole brush: a forced cut
  const cut = analyzeEdited(base, edits, [{ x: 60, y: 60, cls: WOOD }]);
  assert.equal(at(cut.classMap, 141, 120), PX_HOLE);
  assert.equal(cut.labels[120 * W + 141], 0, 'a cut is not an area: the Bucket can’t fill it');
  for (let p = 0; p < edits.length; p++) if (edits[p] === EDIT_HOLE) edits[p] = EDIT_PAPER;
  const fixed = analyzeEdited(base, edits, [{ x: 60, y: 60, cls: WOOD }, { x: 141, y: 120, cls: WOOD }]);
  assert.equal(at(fixed.classMap, 141, 120), PX_WOOD);
  assert.equal(at(fixed.classMap, 120, 120), PX_WOOD);
});

test('a Bucket click forces its region, latest click wins', () => {
  const c = framed();
  const base = prepare(c.rgba(), W, H);
  const r1 = analyzeEdited(base, null, [{ x: 120, y: 120, cls: WOOD }]);
  assert.equal(at(r1.classMap, 120, 120), PX_WOOD);
  const r2 = analyzeEdited(base, null, [{ x: 120, y: 120, cls: WOOD }, { x: 100, y: 100, cls: 2 }]);
  assert.equal(at(r2.classMap, 120, 120), PX_HOLE);
});

test('Julie: closing each reported leak with wood paint ends with no leaks and matches the hand-made piece', () => {
  const F = (/** @type {string} */ f) => fileURLToPath(new URL(`../fixtures/${f}`, import.meta.url));
  const img = readPng(F('julie-input.png'));
  const { truth, w, h } = julieTruth(F('julie-input.png'), F('julie-handmade.png'));
  const base = prepare(img.data, img.width, img.height);
  // Like the app: fix one leak, re-scan (leaning on the previous answer), repeat.
  let after = analyzeEdited(base, null);
  const edits = new Uint8Array(w * h);
  for (let step = 0; step < 6; step++) {
    const leak = after.issues.find((i) => i.type === 'leak' && i.fix);
    if (!leak || !leak.fix) break;
    paint(edits, w, h, leak.fix.ax, leak.fix.ay, leak.fix.bx, leak.fix.by, after.strokeW / 2, EDIT_WOOD);
    after = analyzeEdited(base, edits, [], { prior: after.autoMap });
  }
  assert.equal(after.summary.leaks, 0, JSON.stringify(after.issues.map((i) => i.label)));
  const { ratio } = agreement(after.classMap, truth, w, h);
  assert.ok(ratio >= 0.99, `agreement ${(ratio * 100).toFixed(2)}%`);
});

test('re-scans are stable: an unrelated stroke changes nothing else', () => {
  const F = (/** @type {string} */ f) => fileURLToPath(new URL(`../fixtures/${f}`, import.meta.url));
  const img = readPng(F('julie-input.png'));
  const base = prepare(img.data, img.width, img.height);
  const first = analyzeEdited(base, null);
  const edits = new Uint8Array(img.width * img.height);
  paint(edits, img.width, img.height, 420, 300, 440, 320, 3, EDIT_WOOD);
  const again = analyzeEdited(base, edits, [], { prior: first.autoMap });
  assert.deepEqual(again.issues.map((i) => i.id).sort(), first.issues.map((i) => i.id).sort());
});

test('undoing a Bucket click brings the engine guess back (clicks never become the prior)', () => {
  const c = framed();
  const base = prepare(c.rgba(), W, H);
  const first = analyzeEdited(base, null);
  const clicked = analyzeEdited(base, null, [{ x: 120, y: 120, cls: WOOD }], { prior: first.autoMap });
  assert.equal(at(clicked.classMap, 120, 120), PX_WOOD);
  const undone = analyzeEdited(base, null, [], { prior: clicked.autoMap });
  assert.equal(at(undone.classMap, 120, 120), PX_HOLE);
});
