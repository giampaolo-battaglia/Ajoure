import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createViewport, zoomAt, fitView, panBy, stepScale, clampScale, visibleImageRect,
  lerpViewport, scaleToSlider, sliderToScale, formatPercent, MIN_SCALE, MAX_SCALE,
} from '../src/app/viewport.js';

const base = () => ({ ...createViewport(), vw: 1000, vh: 800, iw: 1024, ih: 1536 });

test('fit centers the image inside the padded view', () => {
  const v = fitView(base(), 40);
  assert.ok(Math.abs(v.scale - 720 / 1536) < 1e-9);
  assert.ok(Math.abs(v.tx + (1024 * v.scale) / 2 - 500) < 1e-9);
  assert.ok(Math.abs(v.ty - 40) < 1e-9);
});

test('zoomAt keeps the point under the cursor fixed', () => {
  const v0 = fitView(base());
  const px = 430, py = 310;
  const before = { x: (px - v0.tx) / v0.scale, y: (py - v0.ty) / v0.scale };
  const v1 = zoomAt(v0, v0.scale * 3.7, px, py);
  const after = { x: (px - v1.tx) / v1.scale, y: (py - v1.ty) / v1.scale };
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test('scale is clamped to 5%–6400%', () => {
  assert.equal(clampScale(0.001), MIN_SCALE);
  assert.equal(clampScale(1000), MAX_SCALE);
});

test('panning cannot lose the image entirely', () => {
  const v = panBy(fitView(base()), -100000, 100000);
  assert.ok(v.tx + v.iw * v.scale >= 64 - 1e-9);
  assert.ok(v.ty <= v.vh - 64 + 1e-9);
});

test('zoom steps walk the preset ladder', () => {
  assert.equal(stepScale(1, 1), 1.5);
  assert.equal(stepScale(1, -1), 0.6667);
  assert.equal(stepScale(0.7, -1), 0.6667);
  assert.equal(stepScale(64, 1), 64);
  assert.equal(stepScale(0.05, -1), 0.05);
});

test('visible rect is clipped to the image and snapped to pixels', () => {
  const v = { ...base(), scale: 10, tx: -505, ty: -1003 };
  const r = visibleImageRect(v);
  assert.deepEqual(r, { x: 50, y: 100, w: 101, h: 81 });
});

test('lerp hits both ends exactly', () => {
  const a = fitView(base());
  const b = zoomAt(a, 8, 200, 200);
  const e0 = lerpViewport(a, b, 0);
  const e1 = lerpViewport(a, b, 1);
  assert.ok(Math.abs(e0.scale - a.scale) < 1e-9 && Math.abs(e0.tx - a.tx) < 1e-6);
  assert.ok(Math.abs(e1.scale - b.scale) < 1e-9 && Math.abs(e1.tx - b.tx) < 1e-6);
});

test('slider mapping round-trips', () => {
  for (const s of [0.05, 0.37, 1, 8, 64]) assert.ok(Math.abs(sliderToScale(scaleToSlider(s)) - s) < 1e-9);
});

test('percent formatting', () => {
  assert.equal(formatPercent(1), '100%');
  assert.equal(formatPercent(0.0625), '6.3%');
  assert.equal(formatPercent(0.05), '5%');
  assert.equal(formatPercent(64), '6400%');
});
