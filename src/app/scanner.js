// @ts-check
// Talks to the analysis worker. Newer scans win: a stale result is dropped.

/** @typedef {Omit<ReturnType<typeof import('../engine/analyze.js').analyze>, 'debug'>} ScanResult */

export class Scanner {
  constructor() {
    this.worker = new Worker(new URL('../worker/analysis.worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    /** @type {Map<number, {resolve: (r: ScanResult) => void, reject: (e: Error) => void}>} */
    this.pending = new Map();
    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Analysis worker failed'));
      this.pending.clear();
    };
  }

  /**
   * Scan an image. Resolves with null if a newer scan started meanwhile.
   * @param {ImageBitmap} bitmap @param {object} [opts]
   * @returns {Promise<ScanResult|null>}
   */
  async scan(bitmap, opts = {}) {
    const id = ++this.seq;
    const { width: w, height: h } = bitmap;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const result = await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, rgba, w, h, opts }, [rgba.buffer]);
    });
    return id === this.seq ? result : null;
  }
}
