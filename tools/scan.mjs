// Run the engine on an image from the command line and write a picture of the result.
// Usage: node tools/scan.mjs fixtures/julie-input.png [out.png]

import { readPng, writePng } from '../tests/helpers/png.mjs';
import { analyze, PX_WOOD, PX_HOLE, PX_LINE } from '../src/engine/analyze.js';

const [, , input = 'fixtures/julie-input.png', out = 'out/scan.png'] = process.argv;
const img = readPng(input);
const res = analyze(img.data, img.width, img.height);

console.log(`${input}: ${img.width}×${img.height}, ${res.mode}, threshold ${res.threshold}`);
console.log(`stroke ${res.strokeW.toFixed(1)} px, ${res.pxPerMm.toFixed(2)} px/mm (est. ${res.widthMm} mm wide)`);
console.log(`${res.regionCount} regions, ${res.gapsTried} gaps tried, ${res.totalMs} ms`, res.timings);
console.log(`summary:`, res.summary);
for (const i of res.issues) console.log(`  [${i.severity}] ${i.label} — ${i.detail} @ ${i.anchor.join(',')}`);

// Picture: wood white, lines dark, holes grey, waste checker, issues as coloured rings.
const { width: w, height: h } = img;
const rgba = new Uint8ClampedArray(w * h * 4);
for (let p = 0; p < w * h; p++) {
  const c = res.classMap[p];
  const x = p % w;
  const y = (p - x) / w;
  const checker = ((x >> 3) + (y >> 3)) & 1 ? 225 : 240;
  const v = c === PX_WOOD ? [255, 255, 255] : c === PX_LINE ? [40, 40, 44] : c === PX_HOLE ? [95, 95, 100] : [checker, checker, checker];
  rgba.set([...v, 255], p * 4);
}
const ring = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number[]} */ col) => {
  for (let a = 0; a < 360; a += 1) {
    for (const r of [9, 10, 11]) {
      const x = Math.round(cx + r * Math.cos((a * Math.PI) / 180));
      const y = Math.round(cy + r * Math.sin((a * Math.PI) / 180));
      if (x >= 0 && y >= 0 && x < w && y < h) rgba.set([...col, 255], (y * w + x) * 4);
    }
  }
};
for (const i of res.issues) ring(i.anchor[0], i.anchor[1], i.severity === 'critical' ? [229, 72, 77] : [62, 140, 240]);
import('node:fs').then(({ mkdirSync }) => {
  mkdirSync(out.replace(/[^/]+$/, '') || '.', { recursive: true });
  writePng(out, w, h, rgba);
  console.log(`wrote ${out}`);
});
