// Water preview: the order water reaches pixels inside an area.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pourOrder } from '../src/app/water.js';

/** Labels from a picture: '#' line (0), anything else region 1. @param {string[]} rows */
function labelsOf(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const labels = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = rows[y][x] === '#' ? 0 : 1;
  return { labels, w, h };
}

test('water reaches every pixel of the area once, nearest first', () => {
  const { labels, w, h } = labelsOf(['.....', '.....', '.....']);
  const o = pourOrder(labels, w, 1, [0, 0, w - 1, h - 1], 2, 1);
  assert.equal(o.count, 15);
  assert.equal(new Set(o.order).size, 15);
  assert.equal(o.order[0], 1 * 5 + 2);
  for (let i = 1; i < o.count; i++) assert.ok(o.dist[i] >= o.dist[i - 1]);
});

test('water goes around a wall, through the gap, not across it', () => {
  // Two rooms joined by a one-pixel gap at the bottom (a leak).
  const rows = [
    '...#...',
    '...#...',
    '...#...',
    '.......',
  ];
  const { labels, w, h } = labelsOf(rows);
  const o = pourOrder(labels, w, 1, [0, 0, w - 1, h - 1], 1, 0);
  const at = (/** @type {number} */ x, /** @type {number} */ y) => o.dist[Array.from(o.order).indexOf(y * w + x)];
  // Just across the wall is far (around through the gap), not 3 steps away.
  assert.ok(at(5, 0) > at(1, 3), 'the room beyond the wall fills after the gap');
  assert.ok(at(5, 0) >= 5 * 7, 'path length counts the detour');
});

test('no diagonal squeeze between two line pixels', () => {
  const rows = [
    '.#',
    '#.',
  ];
  const { labels, w, h } = labelsOf(rows);
  const o = pourOrder(labels, w, 1, [0, 0, w - 1, h - 1], 0, 0);
  assert.equal(o.count, 1);
});
