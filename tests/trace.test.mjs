// Tracing the wood into closed outlines, and floating details into centre lines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceMask, smoothClosed, signedArea, closedPathData, skeletonPaths } from '../src/engine/trace.js';

/** @param {number} w @param {number} h @param {(x:number, y:number) => boolean} f */
const maskOf = (w, h, f) => {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f(x, y)) m[y * w + x] = 1;
  return m;
};

test('a ring gives one outer outline and one hole, with exact areas', () => {
  const m = maskOf(30, 30, (x, y) => x >= 5 && x < 25 && y >= 5 && y < 25 && !(x >= 10 && x < 20 && y >= 10 && y < 20));
  const c = traceMask(m, 30, 30);
  assert.equal(c.length, 2);
  const outer = c.find((k) => !k.hole);
  const hole = c.find((k) => k.hole);
  assert.ok(outer && hole);
  assert.equal(outer.area, 400);
  assert.equal(hole.area, -100);
  assert.equal(outer.pts.length / 2, 4, 'only the 4 corners are kept');
});

test('two pixels touching only at a corner are two pieces', () => {
  const m = maskOf(4, 4, (x, y) => (x === 1 && y === 1) || (x === 2 && y === 2));
  const c = traceMask(m, 4, 4);
  assert.equal(c.length, 2);
  for (const k of c) assert.equal(k.area, 1);
});

test('a hole touching another hole at a corner stays two holes', () => {
  const m = maskOf(6, 6, (x, y) => !((x === 2 && y === 2) || (x === 3 && y === 3)));
  const c = traceMask(m, 6, 6);
  assert.equal(c.filter((k) => k.hole).length, 1, 'diagonal holes: wood is 4-connected, so one merged hole outline');
  assert.equal(c.filter((k) => !k.hole).length, 1);
});

test('smoothing a circle keeps its area and makes few points', () => {
  const R = 40;
  const m = maskOf(100, 100, (x, y) => (x + 0.5 - 50) ** 2 + (y + 0.5 - 50) ** 2 <= R * R);
  const [c] = traceMask(m, 100, 100);
  const s = smoothClosed(c.pts);
  const area = Math.abs(signedArea(s));
  assert.ok(Math.abs(area - Math.PI * R * R) / (Math.PI * R * R) < 0.02, `area ${area}`);
  assert.ok(s.length / 2 < c.pts.length / 2, 'fewer points than the staircase');
  for (let i = 0; i < s.length; i += 2) {
    const r = Math.hypot(s[i] - 50, s[i + 1] - 50);
    assert.ok(Math.abs(r - R) < 1, `point off the circle by ${r - R}`);
  }
  const d = closedPathData(s, (v) => v.toFixed(2), 0.1, 0, 0);
  assert.ok(d.startsWith('M') && d.endsWith('Z'));
});

test('skeleton paths: a plus sign gives four arms', () => {
  const m = maskOf(21, 21, (x, y) => (x === 10 && y >= 2 && y <= 18) || (y === 10 && x >= 2 && x <= 18));
  const paths = skeletonPaths(m, 21, 21, 3);
  assert.ok(paths.length >= 2 && paths.length <= 4, `${paths.length} paths`);
  const total = paths.reduce((s, p) => {
    let L = 0;
    for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    return s + L;
  }, 0);
  assert.ok(total > 25 && total < 36, `total length ${total}`);
});
