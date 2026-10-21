// @ts-check
// Runs the analysis engine off the UI thread. Keeps the prepared image and the
// previous answer between messages, so a re-check after an edit is cheaper and stable.

import { prepare, analyzeEdited } from '../engine/analyze.js';

/** @type {ReturnType<typeof prepare>|null} */
let base = null;
/** @type {Uint8Array|null} previous scan's own guess (before Bucket clicks), with leaks closed */
let prior = null;
/** @type {object} */
let options = {};

self.onmessage = (/** @type {MessageEvent} */ e) => {
  const msg = e.data;
  try {
    let res;
    if (msg.kind === 'open') {
      options = msg.opts || {};
      base = prepare(msg.rgba, msg.w, msg.h, options);
      res = analyzeEdited(base, null, [], options);
      res.timings = { prepare: base.prepMs, ...res.timings };
      res.totalMs += base.prepMs;
    } else if (msg.kind === 'update') {
      if (!base) throw new Error('No image to re-check');
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
