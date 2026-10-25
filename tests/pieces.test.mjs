// The Bucket's "piece": an area split at its narrow passages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pieceAt } from '../src/engine/pieces.js';
import { labelComponents } from '../src/engine/label.js';

/** Two 30×30 rooms joined by a corridor `cw` px wide; everything else is line. @param {number} cw */
function rooms(cw) {
  const w = 90, h = 40;
  const solid = new Uint8Array(w * h).fill(1);
  const open = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) solid[y * w + x] = 0;
  };
  open(5, 5, 35, 35);
  open(55, 5, 85, 35);
  open(35, 20 - (cw >> 1), 55, 20 - (cw >> 1) + cw);
  return { solid, w, h };
}

test('two rooms joined by a 3-px corridor are two pieces; sealing splits them', () => {
  const { solid, w, h } = rooms(3);
  const r = pieceAt(solid, w, h, 15, 15, 4.5);
  assert.equal(r.pieces, 2);
  assert.ok(r.seal.length > 0 && r.seal.length < 40, `${r.seal.length} px sealed`);
  for (const p of r.seal) solid[p] = 1;
  const c = labelComponents(solid, w, h, 0, false);
  assert.notEqual(c.labels[15 * w + 15], c.labels[15 * w + 70]);
});

test('a wide opening (20 px) is one piece: nothing sealed', () => {
  const { solid, w, h } = rooms(20);
  const r = pieceAt(solid, w, h, 15, 15, 4.5);
  assert.equal(r.seal.length, 0);
});

test('clicking a line does nothing', () => {
  const { solid, w, h } = rooms(3);
  assert.deepEqual(pieceAt(solid, w, h, 1, 1, 4.5), { seal: [], pieces: 0 });
});
