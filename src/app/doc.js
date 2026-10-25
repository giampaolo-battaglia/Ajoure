// @ts-check
// The editable document: an edits layer over the original image (never changed), Bucket clicks,
// the scan settings (adjustments, width, material), and undo/redo over all of them. The history is
// saved inside the project file, so you can go back in time after reopening. Pure data, no DOM.

import { EDIT_NONE } from '../engine/analyze.js';

/** @typedef {import('../engine/analyze.js').Seed} Seed */
/** @typedef {[number, number, number, number]} Rect  x, y, w, h in image px */
/**
 * What a scan is run with; part of the document so it's undoable and saved with the history.
 * @typedef {{adjust: import('../engine/adjust.js').Adjustments, widthMm: number|null, material: string}} DocSettings
 */
/**
 * @typedef {Object} Patch
 * @property {string} label
 * @property {Rect|null} rect
 * @property {Uint8Array|null} before
 * @property {Uint8Array|null} after
 * @property {Seed[]} seedsBefore
 * @property {Seed[]} seedsAfter
 * @property {{before: DocSettings, after: DocSettings}} [settings] a settings change
 * @property {number} [id] unique within the document (saved versions point at it)
 * @property {number} [at] when (ms since 1970)
 * @property {string} [key] settings changes with the same key in a row merge into one step
 */

/** Steps kept (in memory and in the file). A step is ~1–2 kB; 500 is well under the image's size. */
export const MAX_UNDO = 500;
/** Settings changes to the same control within this long merge into one step (a slider drag). */
const MERGE_MS = 2000;

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
    /** @type {DocSettings} */
    this.settings = { adjust: /** @type {any} */ ({}), widthMm: null, material: '' };
    /** next step id */
    this.nextId = 1;
    /** the state before the oldest step still kept: 0 = as opened; else the id of the last step dropped */
    this.baseId = 0;
  }

  /** The step the document is at now (0 / baseId = before any kept step). */
  get stepId() {
    const top = this.undoStack[this.undoStack.length - 1];
    return top ? /** @type {number} */ (top.id) : this.baseId;
  }

  /** Is a step (by id) still in the history? */
  hasStep(/** @type {number} */ id) {
    return id === this.baseId || this.undoStack.some((p) => p.id === id) || this.redoStack.some((p) => p.id === id);
  }

  // ---- settings -----------------------------------------------------------------

  /**
   * Change the scan settings as an undoable step. Changes to the same control (`key`) in a row,
   * within a couple of seconds, merge into one step — dragging a slider is one step, not fifty.
   * @param {DocSettings} next @param {string} label @param {string} [key]
   */
  changeSettings(next, label, key) {
    const before = cloneSettings(this.settings);
    const after = cloneSettings(next);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const top = this.undoStack[this.undoStack.length - 1];
    const now = Date.now();
    if (key && top && top.key === key && top.settings && !this.redoStack.length && now - (top.at || 0) < MERGE_MS) {
      top.settings.after = after;
      top.label = label;
      top.at = now;
      this.settings = cloneSettings(after);
      this.emit(null, label);
      return;
    }
    this.settings = cloneSettings(after);
    this.push({ label, rect: null, before: null, after: null, seedsBefore: this.seeds.slice(), seedsAfter: this.seeds.slice(), settings: { before, after }, key });
    this.emit(null, label);
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
  /**
   * Finish the stroke as one undo step. With `seed`, a Bucket click is part of the same step
   * (the smart Bucket seals narrow passages and fills in one go).
   * @param {Seed} [seed]
   */
  endStroke(seed) {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return false;
    if (s.x1 < 0) {
      if (!seed) return false;
      this.addSeed(seed, s.label);
      return true;
    }
    /** @type {Rect} */
    const rect = [s.x0, s.y0, s.x1 - s.x0 + 1, s.y1 - s.y0 + 1];
    const before = crop(s.before, this.w, rect);
    const after = crop(this.edits, this.w, rect);
    if (equal(before, after) && !seed) return false;
    const seedsBefore = this.seeds.slice();
    if (seed) this.seeds = [...this.seeds, seed];
    this.push({ label: s.label, rect, before, after, seedsBefore, seedsAfter: this.seeds.slice() });
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
    p.id = this.nextId++;
    p.at = p.at || Date.now();
    this.undoStack.push(p);
    if (this.undoStack.length > MAX_UNDO) this.baseId = /** @type {number} */ (/** @type {Patch} */ (this.undoStack.shift()).id);
    this.redoStack = [];
  }

  /** @returns {string|null} label of what was undone */
  undo() {
    const p = this.undoStack.pop();
    if (!p) return null;
    this.apply(p, false);
    this.redoStack.push(p);
    this.emit(p.rect, p.label); // after the stacks are settled, so listeners see the final state
    return p.label;
  }

  /** @returns {string|null} label of what was redone */
  redo() {
    const p = this.redoStack.pop();
    if (!p) return null;
    this.apply(p, true);
    this.undoStack.push(p);
    this.emit(p.rect, p.label);
    return p.label;
  }

  /** @param {Patch} p @param {boolean} forward */
  apply(p, forward) {
    if (p.rect) paste(this.edits, this.w, p.rect, /** @type {Uint8Array} */ (forward ? p.after : p.before));
    this.seeds = (forward ? p.seedsAfter : p.seedsBefore).slice();
    if (p.settings) this.settings = cloneSettings(forward ? p.settings.after : p.settings.before);
    this.lastPoint = null;
  }

  /** Any edits at all? (for the "original" indicator) */
  hasEdits() {
    if (this.seeds.length) return true;
    for (let i = 0; i < this.edits.length; i++) if (this.edits[i] !== EDIT_NONE) return true;
    return false;
  }
}

/** @param {DocSettings} s @returns {DocSettings} */
export function cloneSettings(s) {
  return { adjust: { ...s.adjust }, widthMm: s.widthMm, material: s.material };
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
