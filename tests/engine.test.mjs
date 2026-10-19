// Engine unit tests on tiny synthetic drawings (black lines on white), 4 px per mm.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, PX_WOOD, PX_HOLE, PX_WASTE, PX_LINE } from '../src/engine/analyze.js';
import { otsu } from '../src/engine/raster.js';
import { labelComponents } from '../src/engine/label.js';
import { distanceTo } from '../src/engine/distance.js';

const W = 240, H = 240;

/** A tiny drawing surface: white paper, 3-px black pens. */
function canvas() {
  const ink = new Uint8Array(W * H);
  const dot = (/** @type {number} */ x, /** @type {number} */ y, r = 1.5) => {
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++)
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++)
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && (xx - x) ** 2 + (yy - y) ** 2 <= r * r) ink[yy * W + xx] = 1;
  };
  const line = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
  };
  const rect = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => {
    line(x0, y0, x1, y0); line(x1, y0, x1, y1); line(x1, y1, x0, y1); line(x0, y1, x0, y0);
  };
  const circle = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r, gapDeg = 0) => {
    for (let a = gapDeg / 2; a <= 360 - gapDeg / 2; a += 0.5) dot(cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180));
  };
  const rgba = () => {
    const out = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let p = 0; p < W * H; p++) if (ink[p]) out.set([0, 0, 0, 255], p * 4);
    return out;
  };
  return { ink, line, rect, circle, rgba, erase: (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ink[y * W + x] = 0;
  } };
}

/** A framed piece: outer line, frame band (wood), inner line, hole inside. 200 px wide → 4 px/mm at 50 mm. */
function framed() {
  const c = canvas();
  c.rect(20, 20, 219, 219);
  c.rect(34, 34, 205, 205);
  return c;
}

const at = (/** @type {Uint8Array} */ m, /** @type {number} */ x, /** @type {number} */ y) => m[y * W + x];

test('otsu splits a two-tone image between the tones', () => {
  const g = new Uint8Array(1000).map((_, i) => (i < 500 ? 20 : 230));
  const t = otsu(g);
  assert.ok(t >= 20 && t < 230);
});

test('labeling counts 4- and 8-connected components differently', () => {
  // Two pixels touching only diagonally.
  const m = new Uint8Array(9);
  m[0] = 1;
  m[4] = 1;
  assert.equal(labelComponents(m, 3, 3, 1, false).count, 2);
  assert.equal(labelComponents(m, 3, 3, 1, true).count, 1);
});

test('distance transform is exact on a single point', () => {
  const f = new Uint8Array(25);
  f[12] = 1;
  const d = distanceTo(f, 5, 5);
  assert.equal(d[12], 0);
  assert.ok(Math.abs(d[0] - Math.hypot(2, 2)) < 1e-6);
});

test('a clean frame: band is wood, inside is a hole, outside is waste, no issues', () => {
  const c = framed();
  const r = analyze(c.rgba(), W, H);
  assert.equal(r.mode, 'lineart');
  assert.equal(at(r.classMap, 5, 5), PX_WASTE);
  assert.equal(at(r.classMap, 27, 120), PX_WOOD);
  assert.equal(at(r.classMap, 120, 120), PX_HOLE);
  assert.equal(at(r.classMap, 20, 120), PX_LINE);
  assert.equal(r.issues.length, 0, JSON.stringify(r.issues.map((i) => i.label)));
});

test('an outlined dot floating in the hole is an island', () => {
  const c = framed();
  c.circle(120, 120, 14);
  const r = analyze(c.rgba(), W, H);
  assert.equal(at(r.classMap, 120, 120), PX_WOOD);
  const islands = r.issues.filter((i) => i.type === 'island');
  assert.equal(islands.length, 1);
  assert.ok(Math.hypot(islands[0].anchor[0] - 120, islands[0].anchor[1] - 120) < 20);
});

test('a stem joining the dot to the frame removes the island', () => {
  const c = framed();
  c.circle(120, 120, 14);
  // Double-line stem from the circle down to the inner frame line.
  c.line(115, 133, 115, 205);
  c.line(125, 133, 125, 205);
  c.erase(117, 129, 123, 136); // open the circle into the stem
  c.erase(117, 203, 123, 207); // open the frame into the stem
  const r = analyze(c.rgba(), W, H);
  assert.equal(r.summary.islands, 0, JSON.stringify(r.issues.map((i) => i.label)));
});

test('a small gap in the inner frame line is a leak', () => {
  const c = framed();
  c.erase(110, 31, 113, 37); // 4-px break in the inner line (1 mm at 4 px/mm)
  const r = analyze(c.rgba(), W, H);
  const leaks = r.issues.filter((i) => i.type === 'leak');
  assert.ok(leaks.length >= 1, JSON.stringify(r.issues.map((i) => i.label)));
  const l = leaks[0];
  assert.ok(Math.hypot(l.anchor[0] - 111.5, l.anchor[1] - 34) < 8, `leak at ${l.anchor}`);
  assert.equal(l.severity, 'critical');
  assert.ok(l.fix && l.fix.kind === 'close');
  // With the leak closed, the inside is a hole again.
  assert.equal(at(/** @type {Uint8Array} */ (r.fixedClassMap), 120, 120), PX_HOLE);
});

test('white-on-black art is inverted automatically', () => {
  const c = framed();
  const rgba = c.rgba();
  for (let i = 0; i < rgba.length; i += 4) rgba[i] = rgba[i + 1] = rgba[i + 2] = 255 - rgba[i];
  const r = analyze(rgba, W, H);
  assert.equal(r.inverted, true);
  assert.equal(at(r.classMap, 120, 120), PX_HOLE);
});
