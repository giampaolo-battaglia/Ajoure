// SVG export for XCS: closed cut paths at real size, holes before the outline, score lines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutGeometry, writeSvg, COLORS } from '../src/engine/export.js';
import { analyze } from '../src/engine/analyze.js';
import { readPng } from './helpers/png.mjs';

const PX_WASTE = 0, PX_WOOD = 1, PX_HOLE = 2, PX_LINE = 3;

/** A 60×40 plate (wood) with one round hole and one line across the wood (a floating detail). */
function plate() {
  const w = 80, h = 60;
  const classMap = new Uint8Array(w * h).fill(PX_WASTE);
  for (let y = 10; y < 50; y++) for (let x = 10; x < 70; x++) classMap[y * w + x] = PX_WOOD;
  for (let y = 10; y < 50; y++) for (let x = 10; x < 70; x++) if ((x - 30) ** 2 + (y - 30) ** 2 <= 64) classMap[y * w + x] = PX_HOLE;
  for (let y = 20; y < 40; y++) for (let x = 52; x < 55; x++) classMap[y * w + x] = PX_LINE; // a line inside the wood
  return { classMap, w, h, strokeW: 3 };
}

test('a plate with a hole: one outline, one hole, hole first; the line inside the wood is scored', () => {
  const g = cutGeometry(plate(), { details: 'score' });
  assert.equal(g.stats.pieces, 1);
  assert.equal(g.stats.holes, 1);
  assert.deepEqual(g.isHole, [true, false]);
  assert.equal(g.scores.length, 1);
  const svg = writeSvg(g, 10, { name: 'plate' });
  assert.match(svg, /width="(7\.9|8)\d*mm" height="(5\.9|6)\d*mm"/); // piece + 1 mm margin each side
  assert.match(svg, new RegExp(`stroke="${COLORS.cut}"`));
  assert.match(svg, new RegExp(`stroke="${COLORS.score}"`));
  const cut = svg.split('<g id="cut"')[1];
  const ds = [...cut.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ds.length, 2);
  for (const d of ds) assert.ok(d.startsWith('M') && d.endsWith('Z'), 'closed');
  // Real size: the outline spans ~6 mm × 4 mm at 10 px/mm.
  assert.ok(Math.abs(g.stats.widthMm - 6) < 0.15 && Math.abs(g.stats.heightMm - 4) < 0.15);
});

test('engrave and drop modes', () => {
  const e = cutGeometry(plate(), { details: 'engrave' });
  assert.equal(e.engrave.length, 1);
  assert.equal(e.scores.length, 0);
  const d = cutGeometry(plate(), { details: 'drop' });
  assert.equal(d.engrave.length + d.scores.length, 0);
  assert.ok(!writeSvg(d, 10).includes('id="score"'));
});

test('a line between wood and a hole is cut, never scored', () => {
  const p = plate();
  // Put the line on the hole's edge instead: it borders the hole, so it's part of the cut outline.
  for (let y = 20; y < 40; y++) for (let x = 52; x < 55; x++) p.classMap[y * p.w + x] = PX_WOOD;
  for (let y = 26; y < 34; y++) for (let x = 38; x < 41; x++) p.classMap[y * p.w + x] = PX_LINE;
  const g = cutGeometry(p, { details: 'score' });
  assert.equal(g.scores.length, 0);
});

test('Julie exports one outline per piece, every hole closed, at the estimated 50 mm', () => {
  const img = readPng(new URL('../fixtures/julie-input.png', import.meta.url).pathname);
  const res = analyze(img.data, img.width, img.height);
  const g = cutGeometry(res, { details: 'score' });
  const svg = writeSvg(g, res.pxPerMm, { estimated: true });
  assert.ok(Math.abs(g.stats.widthMm - 50) < 0.5, `${g.stats.widthMm} mm wide`);
  assert.ok(g.stats.holes >= 40, `${g.stats.holes} holes`);
  const cut = svg.split('<g id="cut"')[1];
  const ds = [...cut.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ds.length, g.stats.holes + g.stats.pieces);
  for (const d of ds) assert.ok(d.endsWith('Z'));
  assert.equal(new Set(ds).size, ds.length, 'no duplicate paths');
  assert.ok(g.scores.length > 0, 'stamens and veins are scored');
});
