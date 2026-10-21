// @ts-check
// The editable document: an edits layer over the original image (never changed), Bucket clicks,
// and undo/redo. Pure data, no DOM.

import { EDIT_NONE } from '../engine/analyze.js';

/** @typedef {import('../engine/analyze.js').Seed} Seed */
/** @typedef {[number, number, number, number]} Rect  x, y, w, h in image px */
/**
 * @typedef {Object} Patch
 * @property {string} label
 * @property {Rect|null} rect
 * @property {Uint8Array|null} before
 * @property {Uint8Array|null} after
 * @property {Seed[]} seedsBefore
 * @property {Seed[]} seedsAfter
 */

const MAX_UNDO = 100;

export class EditDoc {
  /** @param {number} w @param {number} h */
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.edits = new Uint8Array(w * h);
    /** @type {Seed[]} */
    this.seeds = [];
    /** @type {Patch[]} */
    this.undoStack = [];
    /** @type {Patch[]} */
    this.redoStack = [];
    /** @type {Set<(rect: Rect|null, label: string) => void>} */
    this.listeners = new Set();
    /** @type {null | {label: string, before: Uint8Array, x0: number, y0: number, x1: number, y1: number}} */
    this.stroke = null;
    /** @type {[number, number]|null} last painted point, for ⇧-click straight lines */
    this.lastPoint = null;
  }

  /** @param {(rect: Rect|null, label: string) => void} fn */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** @param {Rect|null} rect @param {string} label */
  emit(rect, label) {
    for (const fn of this.listeners) fn(rect, label);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get edited() {
    return this.undoStack.length > 0;
  }

  // ---- pixel strokes ---------------------------------------------------------

  /** @param {string} label */
  beginStroke(label) {
    this.stroke = { label, before: Uint8Array.from(this.edits), x0: Infinity, y0: Infinity, x1: -1, y1: -1 };
  }

  /**
   * Paint a disc. Returns the changed rect (for redrawing), or null.
   * @param {number} cx @param {number} cy @param {number} r radius in image px @param {number} value EDIT_*
   * @returns {Rect|null}
   */
  stamp(cx, cy, r, value) {
    const { w, h, edits } = this;
    const rr = r * r + 0.25;
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    if (x1 < x0 || y1 < y0) return null;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rr) edits[y * w + x] = value;
      }
    }
    this.grow(x0, y0, x1, y1);
    this.lastPoint = [cx, cy];
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }

  /**
   * Paint a thick segment (a chain of discs).
   * @param {number} ax @param {number} ay @param {number} bx @param {number} by @param {number} r @param {number} value
   * @returns {Rect|null}
   */
  segment(ax, ay, bx, by, r, value) {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.5)));
    /** @type {Rect|null} */
    let rect = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      rect = union(rect, this.stamp(ax + (bx - ax) * t, ay + (by - ay) * t, r, value));
    }
    return rect;
  }

  /**
   * Set an arbitrary list of pixels (used by quick fixes like "Remove island").
   * @param {Iterable<number>} pixels @param {number} value @returns {Rect|null}
   */
  setPixels(pixels, value) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const p of pixels) {
      this.edits[p] = value;
      const x = p % this.w;
      const y = (p - x) / this.w;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    this.grow(x0, y0, x1, y1);
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }

  /** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
  grow(x0, y0, x1, y1) {
    const s = this.stroke;
    if (!s) return;
    s.x0 = Math.min(s.x0, x0);
    s.y0 = Math.min(s.y0, y0);
    s.x1 = Math.max(s.x1, x1);
    s.y1 = Math.max(s.y1, y1);
  }

  /** Finish the stroke and record it for undo. Returns false if nothing changed. */
  endStroke() {
    const s = this.stroke;
    this.stroke = null;
    if (!s || s.x1 < 0) return false;
    /** @type {Rect} */
    const rect = [s.x0, s.y0, s.x1 - s.x0 + 1, s.y1 - s.y0 + 1];
    const before = crop(s.before, this.w, rect);
    const after = crop(this.edits, this.w, rect);
    if (equal(before, after)) return false;
    this.push({ label: s.label, rect, before, after, seedsBefore: this.seeds.slice(), seedsAfter: this.seeds.slice() });
    this.emit(rect, s.label);
    return true;
  }

  // ---- bucket ------------------------------------------------------------------

  /** @param {Seed} seed @param {string} label */
  addSeed(seed, label) {
    const before = this.seeds.slice();
    this.seeds = [...this.seeds, seed];
    this.push({ label, rect: null, before: null, after: null, seedsBefore: before, seedsAfter: this.seeds.slice() });
    this.emit(null, label);
  }

  // ---- history ----------------------------------------------------------------

  /** @param {Patch} p */
  push(p) {
    this.undoStack.push(p);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  /** @returns {string|null} label of what was undone */
  undo() {
    const p = this.undoStack.pop();
    if (!p) return null;
    this.apply(p, false);
    this.redoStack.push(p);
    return p.label;
  }

  /** @returns {string|null} label of what was redone */
  redo() {
    const p = this.redoStack.pop();
    if (!p) return null;
    this.apply(p, true);
    this.undoStack.push(p);
    return p.label;
  }

  /** @param {Patch} p @param {boolean} forward */
  apply(p, forward) {
    if (p.rect) paste(this.edits, this.w, p.rect, /** @type {Uint8Array} */ (forward ? p.after : p.before));
    this.seeds = (forward ? p.seedsAfter : p.seedsBefore).slice();
    this.lastPoint = null;
    this.emit(p.rect, p.label);
  }

  /** Any edits at all? (for the "original" indicator) */
  hasEdits() {
    if (this.seeds.length) return true;
    for (let i = 0; i < this.edits.length; i++) if (this.edits[i] !== EDIT_NONE) return true;
    return false;
  }
}

/** @param {Rect|null} a @param {Rect|null} b @returns {Rect|null} */
export function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0] + a[2], b[0] + b[2]);
  const y1 = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x0, y0, x1 - x0, y1 - y0];
}

/** @param {Uint8Array} src @param {number} w @param {Rect} r */
function crop(src, w, r) {
  const out = new Uint8Array(r[2] * r[3]);
  for (let y = 0; y < r[3]; y++) out.set(src.subarray((r[1] + y) * w + r[0], (r[1] + y) * w + r[0] + r[2]), y * r[2]);
  return out;
}

/** @param {Uint8Array} dst @param {number} w @param {Rect} r @param {Uint8Array} data */
function paste(dst, w, r, data) {
  for (let y = 0; y < r[3]; y++) dst.set(data.subarray(y * r[2], (y + 1) * r[2]), (r[1] + y) * w + r[0]);
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function equal(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
