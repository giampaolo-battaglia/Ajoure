// @ts-check
// Runs the analysis engine off the UI thread.

import { analyze } from '../engine/analyze.js';

self.onmessage = (/** @type {MessageEvent} */ e) => {
  const { id, rgba, w, h, opts } = e.data;
  try {
    const res = analyze(rgba, w, h, opts);
    // Internals stay here; everything else goes back, big arrays transferred (not copied).
    const { debug, ...result } = res;
    /** @type {Transferable[]} */
    const transfer = [result.classMap.buffer, result.labels.buffer];
    if (result.fixedClassMap) transfer.push(result.fixedClassMap.buffer);
    self.postMessage({ id, ok: true, result }, { transfer });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
