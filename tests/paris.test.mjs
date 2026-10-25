// Second real image: "Julie je t'aime" (Eiffel tower). Mixed drawing: outlined shapes (frame, tower,
// letters) and single lines (sun, clouds, arcs) that often stop short of the next line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, analyzeEdited } from '../src/engine/analyze.js';
import { readPng } from './helpers/png.mjs';

const img = readPng(new URL('../fixtures/paris-input.png', import.meta.url).pathname);
const base = prepare(img.data, img.width, img.height);
const { w, h } = base;
const first = analyzeEdited(base, null, []);

test('Paris: the gaps between lines are pinned as leaks', () => {
  assert.ok(first.summary.leaks >= 8 && first.summary.leaks <= 12, `${first.summary.leaks} leaks`);
  assert.equal(first.summary.islands, 0);
});

test('Paris: the sun circle that stops short of the tower is flagged as an open outline', () => {
  const sun = first.issues.find((i) => i.type === 'opening' && Math.hypot(i.anchor[0] - 526, i.anchor[1] - 158) < 15);
  assert.ok(sun, 'open outline at the sun');
  assert.equal(sun.severity, 'info');
  assert.ok(sun.fix && sun.fix.kind === 'close');
});

test('Paris: closing every leak and open outline, one by one, leaves the sun as its own piece', () => {
  const edits = new Uint8Array(w * h);
  /** @param {{ax:number, ay:number, bx:number, by:number}} f @param {number} r */
  const close = (f, r) => {
    const L = Math.hypot(f.bx - f.ax, f.by - f.ay) || 1;
    const ux = (f.bx - f.ax) / L, uy = (f.by - f.ay) / L;
    const ax = f.ax - ux * r, ay = f.ay - uy * r, bx = f.bx + ux * r, by = f.by + uy * r;
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
    for (let k = 0; k <= n; k++) {
      const cx = ax + ((bx - ax) * k) / n, cy = ay + ((by - ay) * k) / n;
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
        for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.25) edits[y * w + x] = 1;
      }
    }
  };
  /** @type {Uint8Array|null} */
  let prior = null;
  let res = first;
  for (let i = 0; i < 20; i++) {
    res = analyzeEdited(base, edits, [], { prior });
    prior = res.autoMap;
    const todo = res.issues.find((x) => (x.type === 'leak' || x.type === 'opening') && x.fix?.kind === 'close');
    if (!todo || todo.fix?.kind !== 'close') break;
    close(todo.fix, Math.max(1.5, res.strokeW / 2));
  }
  assert.equal(res.summary.leaks, 0);
  assert.equal(res.summary.openings, 0);
  assert.equal(res.summary.islands, 0);
  const sun = res.labels[180 * w + 600];
  const sky = res.labels[120 * w + 660];
  assert.ok(sun && sky && sun !== sky, 'sun and sky are separate pieces');
});
