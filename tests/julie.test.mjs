// Acceptance tests against the Julie reference (SPEC §1.2, §12).
// Truth = Giampi's hand-made wood/hole version, aligned onto the AI input.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/png.mjs';
import { julieTruth, agreement } from './helpers/julie-truth.mjs';
import { analyze } from '../src/engine/analyze.js';

const F = (/** @type {string} */ f) => fileURLToPath(new URL(`../fixtures/${f}`, import.meta.url));
const img = readPng(F('julie-input.png'));
const { truth, w, h } = julieTruth(F('julie-input.png'), F('julie-handmade.png'));
const res = analyze(img.data, img.width, img.height);

// The two pockets Giampi sealed by hand (input pixel coords), found in the first look on 2026-10-18.
const POCKETS = [
  { name: 'left of the A in Amour', box: [353, 991, 472, 1145] },
  { name: 'right of the bottom flower', box: [635, 1290, 680, 1385] },
];
const near = (/** @type {number[]} */ b, /** @type {[number, number]} */ p, m = 15) =>
  p[0] >= b[0] - m && p[0] <= b[2] + m && p[1] >= b[1] - m && p[1] <= b[3] + m;

test('scans Julie as line art in a reasonable time', () => {
  assert.equal(res.mode, 'lineart');
  // SPEC target is < 2 s for a much bigger image on an M1; keep CI headroom here.
  assert.ok(res.totalMs < 4000, `scan took ${res.totalMs} ms`);
});

test('wood/hole guess matches the hand-made result once leaks are closed (≥ 97%)', () => {
  const { ratio } = agreement(/** @type {Uint8Array} */ (res.fixedClassMap), truth, w, h);
  assert.ok(ratio >= 0.97, `agreement ${(ratio * 100).toFixed(2)}%`);
});

test('even before fixing, most of the piece is already right (≥ 95%)', () => {
  const { ratio } = agreement(res.classMap, truth, w, h);
  assert.ok(ratio >= 0.95, `agreement ${(ratio * 100).toFixed(2)}%`);
});

test('every pocket Giampi sealed by hand gets a leak pin', () => {
  const leaks = res.issues.filter((i) => i.type === 'leak');
  for (const p of POCKETS) {
    assert.ok(
      leaks.some((l) => near(p.box, l.anchor)),
      `no leak near ${p.name}; leaks at ${leaks.map((l) => l.anchor.join(',')).join(' ')}`,
    );
  }
});

test('no flood of false leaks', () => {
  assert.ok(res.summary.leaks <= 4, `${res.summary.leaks} leaks`);
});

test('the dot of the i in "Julie" is flagged as an island', () => {
  const islands = res.issues.filter((i) => i.type === 'island');
  assert.ok(islands.some((i) => near([585, 660, 625, 700], i.anchor, 5)), JSON.stringify(islands.map((i) => i.anchor)));
});

test('every issue has plain-words text, a location and a status', () => {
  for (const i of res.issues) {
    assert.match(i.label, /^(Leak|Island|Speck|Thin wood|Near-touch|Speck hole|Open outline), /);
    assert.ok(i.detail.length > 10);
    assert.equal(i.status, 'open');
    assert.ok(i.anchor[0] >= 0 && i.anchor[0] < w && i.anchor[1] >= 0 && i.anchor[1] < h);
  }
});
