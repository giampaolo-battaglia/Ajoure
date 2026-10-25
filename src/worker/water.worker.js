// @ts-check
// Works out the water's path for big areas off the UI thread, so the cursor never stalls.

import { pourOrder, wobble } from '../app/water.js';
import { flowTest } from '../engine/flow.js';
import { pieceAt } from '../engine/pieces.js';
import { cutGeometry, writeSvg, previewPaths } from '../engine/export.js';

/** @type {Int32Array|Uint32Array|null} */
let labels = null;
let width = 0;

self.onmessage = (/** @type {MessageEvent} */ e) => {
  const m = e.data;
  if (m.kind === 'labels') {
    labels = m.labels;
    width = m.w;
    return;
  }
  if (m.kind === 'piece') {
    // The Bucket's piece, from the latest scan's areas (0 = line or cut).
    const solid = new Uint8Array(m.labels.length);
    for (let p = 0; p < solid.length; p++) solid[p] = m.labels[p] ? 0 : 1;
    const pc = pieceAt(solid, m.w, m.h, m.x, m.y, m.coreR);
    const seal = Int32Array.from(pc.seal);
    self.postMessage({ id: m.id, piece: { seal, pieces: pc.pieces } }, { transfer: [seal.buffer] });
    return;
  }
  if (m.kind === 'export') {
    // The laser file and the Cut preview come from the same geometry.
    const g = cutGeometry(m.scan, { details: m.details, lineMarks: m.lineMarks });
    const svg = writeSvg(g, m.scan.pxPerMm, m.meta);
    self.postMessage({ id: m.id, exported: { svg, preview: previewPaths(g), stats: g.stats } });
    return;
  }
  if (m.kind === 'flow') {
    const f = flowTest(m.scan);
    self.postMessage({ id: m.id, flow: f }, { transfer: [f.order.buffer, f.time.buffer, f.kind.buffer] });
    return;
  }
  if (m.kind === 'pour' && labels) {
    const o = wobble(pourOrder(labels, width, m.r, m.box, m.sx, m.sy), m.box[0], m.box[1], m.scale);
    self.postMessage({ id: m.id, o }, { transfer: [o.order.buffer, o.dist.buffer] });
  }
};
