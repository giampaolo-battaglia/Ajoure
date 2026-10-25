// @ts-check
// Runs the analysis engine off the UI thread. Keeps the prepared image and the
// previous answer between messages, so a re-check after an edit is cheaper and stable.

import { prepare, analyzeEdited } from '../engine/analyze.js';

/** @type {ReturnType<typeof prepare>|null} */
let base = null;
/** @type {Uint8Array|null} previous scan's own guess (before Bucket clicks), with leaks closed */
let prior = null;
/** @type {import('../engine/analyze.js').ScanOptions} */
let options = {};
/** @type {{rgba: Uint8ClampedArray, w: number, h: number}|null} the source pixels, kept to re-prepare */
let source = null;
/** What prepare() depends on; a change means re-preparing the image. */
const prepKey = (/** @type {any} */ o) => JSON.stringify({ a: o.adjust || null, w: o.widthMm ?? null });

self.onmessage = (/** @type {MessageEvent} */ e) => {
  const msg = e.data;
  try {
    let res;
    if (msg.kind === 'open') {
      options = msg.opts || {};
      source = { rgba: msg.rgba, w: msg.w, h: msg.h };
      prior = null;
      base = prepare(msg.rgba, msg.w, msg.h, options);
      res = analyzeEdited(base, null, [], options);
      res.timings = { prepare: base.prepMs, ...res.timings };
      res.totalMs += base.prepMs;
    } else if (msg.kind === 'update') {
      if (!base || !source) throw new Error('No image to re-check');
      // New adjustments, width or material: re-prepare if the image itself changes.
      if (msg.opts) {
        const next = { ...options, ...msg.opts };
        if (prepKey(next) !== prepKey(options)) {
          base = prepare(source.rgba, source.w, source.h, next);
          // Adjustments change the drawing itself: the old guess no longer lines up, start fresh.
          // A new width or material doesn't move a pixel, so the guess stays (and stays stable).
          if (JSON.stringify(next.adjust || null) !== JSON.stringify(options.adjust || null)) prior = null;
        }
        options = next;
      }
      res = analyzeEdited(base, msg.edits, msg.seeds || [], { ...options, prior });
    } else {
      return;
    }
    prior = res.autoMap;
    // Internals stay here; everything else goes back, big arrays transferred (not copied).
    const { debug, autoMap, ...result } = res;
    /** @type {Transferable[]} */
    const transfer = [result.classMap.buffer, result.labels.buffer];
    if (result.fixedClassMap) transfer.push(result.fixedClassMap.buffer);
    self.postMessage({ id: msg.id, ok: true, result }, { transfer });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
