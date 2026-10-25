// @ts-check
// Talks to the analysis worker. Opening an image always wins; while a re-check is running,
// only the latest edit state is queued (intermediate ones are skipped).

/** @typedef {Omit<ReturnType<typeof import('../engine/analyze.js').analyzeEdited>, 'debug'|'autoMap'>} ScanResult */
/** @typedef {import('../engine/analyze.js').ScanOptions} ScanOptions */
/** @typedef {import('../engine/analyze.js').Seed} Seed */

export class Scanner {
  constructor() {
    this.worker = new Worker(new URL('../worker/analysis.worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    this.doc = 0; // bumps on every open; results for an older image are dropped
    this.busy = false;
    /** @type {null | {edits: Uint8Array, seeds: Seed[], opts?: ScanOptions, resolve: (r: ScanResult|null) => void, reject: (e: Error) => void}} */
    this.queued = null;
    /** @type {Map<number, {doc: number, resolve: (r: ScanResult|null) => void, reject: (e: Error) => void}>} */
    this.pending = new Map();
    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      this.busy = false;
      if (!ok) p.reject(new Error(error));
      else p.resolve(p.doc === this.doc ? result : null);
      this.flush();
    };
    this.worker.onerror = (e) => {
      this.busy = false;
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Analysis worker failed'));
      this.pending.clear();
    };
  }

  /**
   * Prepare and scan a new image.
   * @param {ImageBitmap} bitmap @param {object} [opts]
   * @returns {Promise<ScanResult|null>}
   */
  open(bitmap, opts = {}) {
    const { width: w, height: h } = bitmap;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const doc = ++this.doc;
    if (this.queued) this.queued.resolve(null);
    this.queued = null;
    return this.send({ kind: 'open', rgba, w, h, opts }, [rgba.buffer], doc);
  }

  /**
   * Re-check the current image with edits (and, optionally, new adjustments / width / material).
   * Resolves null if superseded by a newer request.
   * @param {Uint8Array} edits @param {Seed[]} seeds @param {ScanOptions} [opts]
   * @returns {Promise<ScanResult|null>}
   */
  update(edits, seeds, opts) {
    return new Promise((resolve, reject) => {
      // A superseded request's new options still count: carry them into the newer one.
      const carried = this.queued?.opts;
      if (this.queued) this.queued.resolve(null);
      const merged = carried || opts ? { ...carried, ...opts } : undefined;
      this.queued = { edits: Uint8Array.from(edits), seeds: seeds.map((s) => ({ ...s })), opts: merged, resolve, reject };
      this.flush();
    });
  }

  flush() {
    if (this.busy || !this.queued) return;
    const q = this.queued;
    this.queued = null;
    this.send({ kind: 'update', edits: q.edits, seeds: q.seeds, opts: q.opts }, [q.edits.buffer], this.doc).then(q.resolve, q.reject);
  }

  /** @param {object} msg @param {Transferable[]} transfer @param {number} doc @returns {Promise<ScanResult|null>} */
  send(msg, transfer, doc) {
    const id = ++this.seq;
    this.busy = true;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { doc, resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }
}
