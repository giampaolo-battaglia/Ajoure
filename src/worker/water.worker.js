// @ts-check
// Works out the water's path for big areas off the UI thread, so the cursor never stalls.

import { pourOrder, wobble } from '../app/water.js';

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
  if (m.kind === 'pour' && labels) {
    const o = wobble(pourOrder(labels, width, m.r, m.box, m.sx, m.sy), m.box[0], m.box[1], m.scale);
    self.postMessage({ id: m.id, o }, { transfer: [o.order.buffer, o.dist.buffer] });
  }
};
