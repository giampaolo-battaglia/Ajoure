// @ts-check
// Fixing tools (SPEC §6.5): Bucket, Wood brush, Hole brush, Revert brush, Connector, Separator.
// Works in image pixels; the document records the edits, the view shows them.

import { EDIT_NONE, EDIT_WOOD, EDIT_HOLE, WOOD, HOLE, WASTE, BASSWOOD_3MM } from '../engine/analyze.js';
import { pourOrder, wobble, Pour } from './water.js';
import { visibleImageRect } from './viewport.js';

/** @typedef {'hand'|'zoom'|'bucket'|'wood'|'hole'|'revert'|'connector'|'separator'} ToolId */
/** @typedef {import('./doc.js').EditDoc} EditDoc */
/** @typedef {import('./doc.js').Rect} Rect */
/** @typedef {import('./scanner.js').ScanResult} ScanResult */
/** @typedef {import('./view.js').CanvasView} CanvasView */

/** Tools that change the design (everything but Hand and Zoom). */
export const EDIT_TOOLS = /** @type {ToolId[]} */ (['bucket', 'wood', 'hole', 'revert', 'connector', 'separator']);
/** Tools shown as a brush circle instead of the system cursor. */
export const BRUSH_TOOLS = /** @type {ToolId[]} */ (['wood', 'hole', 'revert', 'connector', 'separator']);

export const TOOL_NAMES = /** @type {Record<ToolId, string>} */ ({
  hand: 'Hand',
  zoom: 'Zoom',
  bucket: 'Bucket',
  wood: 'Wood brush',
  hole: 'Hole brush',
  revert: 'Revert brush',
  connector: 'Connector',
  separator: 'Separator',
});

export class ToolController {
  /**
   * @param {{
   *   view: CanvasView,
   *   getDoc: () => EditDoc|null,
   *   getScan: () => ScanResult|null,
   *   onPaint: (rect: Rect|null) => void,
   *   onBucket: (region: number, cls: number, x: number, y: number) => void,
   *   say: (msg: string) => void,
   * }} o
   */
  constructor(o) {
    this.o = o;
    /** @type {ToolId} */
    this.tool = 'hand';
    /** Brush diameters in image px (set from the material once the scale is known). */
    this.size = { wood: 8, hole: 4, revert: 12, connector: 10, separator: 4 };
    this.sizedFor = 0;
    /** @type {{x:number, y:number}|null} last pointer position in image px */
    this.last = null;
    /** @type {{ax:number, ay:number}|null} connector's first point */
    this.conn = null;
    /** @type {{ax:number, ay:number}|null} separator drag start */
    this.sep = null;
    this.painting = false;
    /** Bucket hover cache */
    this.hoverRegion = 0;
    /** @type {{scan: ScanResult, boxes: Int32Array}|null} */
    this.boxes = null;
    this.accent = [20, 133, 122];
    this.accentCss = '#14857a';
    this.pxPerMm = 0;
    /** @type {'tint'|'water'} how the Bucket previews the area under the cursor */
    this.preview = 'tint';
    /** @type {Worker|null} computes the water's path for big areas */
    this.waterWorker = null;
    /** @type {ScanResult|null} scan whose labels the water worker holds */
    this.waterScan = null;
    this.pourId = 0;
    /** @type {((d: {id: number, o: any}) => void)|undefined} */
    this.waterDone = undefined;
    this.readAccent();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readAccent());
  }

  readAccent() {
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (m) this.accent = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    this.accentCss = hex || '#14857a';
  }

  /**
   * Default brush sizes from the material's minimum widths (SPEC §6.5), once per image scale.
   * @param {number} pxPerMm
   */
  setScale(pxPerMm) {
    if (this.sizedFor === pxPerMm) return;
    this.sizedFor = pxPerMm;
    const p = BASSWOOD_3MM;
    this.size.wood = Math.max(2, p.minWoodWidth * pxPerMm);
    this.size.hole = Math.max(2, p.minHoleWidth * pxPerMm);
    this.size.revert = Math.max(4, this.size.wood * 1.5);
    this.size.connector = Math.max(2, p.minWoodWidth * 1.2 * pxPerMm);
    this.size.separator = Math.max(2, p.minHoleWidth * pxPerMm);
    this.pxPerMm = pxPerMm;
  }

  /** @param {ToolId} t */
  setTool(t) {
    this.cancel();
    this.tool = t;
    this.refreshOverlay();
  }

  /** Abandon a half-made connector/separator and clear hover feedback. */
  cancel() {
    this.conn = null;
    this.sep = null;
    this.o.view.toolOverlay = null;
    this.clearHover();
    this.o.view.requestRender();
  }

  /** `[` / `]`: resize the current brush. Returns a label for feedback, or null. @param {number} dir */
  resize(dir) {
    const t = this.tool;
    if (!(t === 'wood' || t === 'hole' || t === 'revert' || t === 'connector' || t === 'separator')) return null;
    const k = dir > 0 ? 1.25 : 0.8;
    this.size[t] = Math.max(1, Math.min(400, this.size[t] * k));
    this.refreshOverlay();
    const mm = this.pxPerMm ? `${(this.size[t] / this.pxPerMm).toFixed(2)} mm` : `${Math.round(this.size[t])} px`;
    return `${TOOL_NAMES[t]} · ${mm}`;
  }

  // ---- pointer -------------------------------------------------------------------

  /**
   * @param {PointerEvent} e @param {{x:number, y:number}} p image px
   * @returns {boolean} true if the tool took the press (the input then captures the pointer)
   */
  down(e, p) {
    const doc = this.o.getDoc();
    if (!doc || e.button !== 0) return false;
    const t = this.tool;
    this.last = p;
    if (t === 'bucket') {
      this.bucket(e, p);
      return true;
    }
    if (t === 'wood' || t === 'hole' || t === 'revert') {
      const value = t === 'wood' ? EDIT_WOOD : t === 'hole' ? EDIT_HOLE : EDIT_NONE;
      const r = this.size[t] / 2;
      doc.beginStroke(TOOL_NAMES[t]);
      this.painting = true;
      // ⇧-click: straight line from the last painted point.
      const from = e.shiftKey && doc.lastPoint ? doc.lastPoint : null;
      this.o.onPaint(from ? doc.segment(from[0], from[1], p.x, p.y, r, value) : doc.stamp(p.x, p.y, r, value));
      return true;
    }
    if (t === 'connector') {
      if (!this.conn) {
        this.conn = { ax: p.x, ay: p.y };
        this.refreshOverlay();
        return true;
      }
      const { ax, ay } = this.conn;
      this.conn = null;
      doc.beginStroke('Connector');
      this.o.onPaint(doc.segment(ax, ay, p.x, p.y, this.size.connector / 2, EDIT_WOOD));
      doc.endStroke();
      this.refreshOverlay();
      return true;
    }
    if (t === 'separator') {
      this.sep = { ax: p.x, ay: p.y };
      this.refreshOverlay();
      return true;
    }
    return false;
  }

  /** @param {PointerEvent} e @param {{x:number, y:number}} p */
  move(e, p) {
    const doc = this.o.getDoc();
    const t = this.tool;
    if (this.painting && doc && this.last) {
      const value = t === 'wood' ? EDIT_WOOD : t === 'hole' ? EDIT_HOLE : EDIT_NONE;
      const size = t === 'wood' || t === 'hole' || t === 'revert' ? this.size[t] : 4;
      this.o.onPaint(doc.segment(this.last.x, this.last.y, p.x, p.y, size / 2, value));
    }
    this.last = p;
    this.refreshOverlay();
  }

  /** @param {PointerEvent} e @param {{x:number, y:number}} p */
  up(e, p) {
    const doc = this.o.getDoc();
    if (this.painting && doc) {
      this.painting = false;
      doc.endStroke();
    }
    if (this.tool === 'separator' && this.sep && doc) {
      const { ax, ay } = this.sep;
      this.sep = null;
      if (Math.hypot(p.x - ax, p.y - ay) >= 2) {
        doc.beginStroke('Separator');
        this.o.onPaint(doc.segment(ax, ay, p.x, p.y, this.size.separator / 2, EDIT_HOLE));
        doc.endStroke();
      }
    }
    this.last = p;
    this.refreshOverlay();
  }

  /** Pointer moved with no button down (or left the canvas: null). @param {{x:number, y:number}|null} p */
  hover(p) {
    this.last = p;
    if (!p) {
      this.o.view.toolOverlay = null;
      this.clearHover();
      this.o.view.requestRender();
      return;
    }
    if (this.tool === 'bucket') this.hoverBucket(p);
    else this.clearHover();
    this.refreshOverlay();
  }

  refreshOverlay() {
    const view = this.o.view;
    const p = this.last;
    const t = this.tool;
    const color = this.accentCss || '#14857a';
    if (!p || !BRUSH_TOOLS.includes(t)) {
      view.toolOverlay = null;
    } else if (t === 'connector' && this.conn) {
      view.toolOverlay = { kind: 'line', ax: this.conn.ax, ay: this.conn.ay, bx: p.x, by: p.y, r: this.size.connector / 2, color };
    } else if (t === 'separator' && this.sep) {
      view.toolOverlay = { kind: 'line', ax: this.sep.ax, ay: this.sep.ay, bx: p.x, by: p.y, r: this.size.separator / 2, color: '#e5484d' };
    } else {
      const size = /** @type {number} */ (this.size[/** @type {'wood'} */ (t)]);
      view.toolOverlay = { kind: 'brush', x: p.x, y: p.y, r: size / 2, color };
    }
    view.requestRender();
  }

  // ---- bucket ---------------------------------------------------------------------

  /** @param {PointerEvent} e @param {{x:number, y:number}} p */
  bucket(e, p) {
    const scan = this.o.getScan();
    if (!scan) return this.o.say('Still scanning — try again in a second.');
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= scan.w || y >= scan.h) return;
    const r = scan.labels[y * scan.w + x];
    if (!r) return this.o.say('That’s a line or a cut — click inside an area.');
    const cur = scan.regionClass[r];
    if (cur === WASTE) return this.o.say('That area is outside the piece.');
    const cls = e.shiftKey ? WOOD : e.altKey ? HOLE : cur === WOOD ? HOLE : WOOD;
    if (cls === cur && (e.shiftKey || e.altKey)) return;
    this.o.onBucket(r, cls, x, y);
  }

  /** @param {'tint'|'water'} style */
  setPreview(style) {
    this.preview = style;
    this.clearHover();
    if (this.tool === 'bucket' && this.last) this.hoverBucket(this.last);
  }

  /**
   * Show the whole area under the cursor, so a leak shows as the preview spilling
   * past the gap: a flat tint, or (Settings) water poured at the cursor.
   * @param {{x:number, y:number}} p
   */
  hoverBucket(p) {
    const scan = this.o.getScan();
    const view = this.o.view;
    if (!scan) return this.clearHover();
    const water = this.preview === 'water';
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const r = x >= 0 && y >= 0 && x < scan.w && y < scan.h ? scan.labels[y * scan.w + x] : 0;
    // Water may run outside the piece too: that's how a hole open to the edge shows.
    if (!r || (!water && scan.regionClass[r] === WASTE)) return this.clearHover();
    if (r === this.hoverRegion) return; // same area: keep the preview (or the pour being worked out)
    this.hoverRegion = r;
    const boxes = this.regionBoxes(scan);
    const x0 = boxes[r * 4], y0 = boxes[r * 4 + 1], x1 = boxes[r * 4 + 2], y1 = boxes[r * 4 + 3];
    if (water) {
      this.pour(scan, r, [x0, y0, x1, y1], x, y, p);
      return;
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const c = document.createElement('canvas');
    c.width = bw;
    c.height = bh;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    const img = g.createImageData(bw, bh);
    const d = img.data;
    const [ar, ag, ab] = this.accent;
    for (let yy = 0; yy < bh; yy++) {
      const row = (y0 + yy) * scan.w + x0;
      for (let xx = 0; xx < bw; xx++) {
        if (scan.labels[row + xx] === r) {
          const k = (yy * bw + xx) * 4;
          d[k] = ar;
          d[k + 1] = ag;
          d[k + 2] = ab;
          d[k + 3] = 110;
        }
      }
    }
    g.putImageData(img, 0, 0);
    view.hover = { canvas: c, x: x0, y: y0 };
    view.requestRender();
  }

  /**
   * Pour water at (x, y) in region r. Small areas are worked out at once; big ones
   * (the space around the piece) in a worker, so the cursor never stalls.
   * @param {ScanResult} scan @param {number} r @param {[number, number, number, number]} box
   * @param {number} x @param {number} y @param {{x:number, y:number}} p
   */
  pour(scan, r, box, x, y, p) {
    const view = this.o.view;
    const id = ++this.pourId;
    view.hover = null;
    const start = (/** @type {ReturnType<typeof pourOrder>} */ order) => {
      if (id !== this.pourId || this.hoverRegion !== r || this.o.getScan() !== scan) return;
      const calm = view.reduceMotion.matches;
      const pour = new Pour(order, box[0], box[1], view.viewport.scale, calm, visibleImageRect(view.viewport));
      view.hover = {
        canvas: pour.canvas, x: box[0], y: box[1],
        tick: (now) => pour.tick(now),
        ripple: calm ? undefined : { x: p.x, y: p.y, t0: pour.t0 },
      };
      view.requestRender();
    };
    const area = (box[2] - box[0] + 1) * (box[3] - box[1] + 1);
    if (area < 250_000 || typeof Worker === 'undefined') {
      start(wobble(pourOrder(scan.labels, scan.w, r, box, x, y), box[0], box[1], view.viewport.scale));
      return;
    }
    if (!this.waterWorker) {
      this.waterWorker = new Worker(new URL('../worker/water.worker.js', import.meta.url), { type: 'module' });
      this.waterWorker.onmessage = (e) => this.waterDone?.(e.data);
    }
    if (this.waterScan !== scan) {
      this.waterWorker.postMessage({ kind: 'labels', labels: scan.labels, w: scan.w });
      this.waterScan = scan;
    }
    this.waterDone = (d) => d.id === id && start(d.o);
    this.waterWorker.postMessage({ kind: 'pour', id, r, box, sx: x, sy: y, scale: view.viewport.scale });
  }

  clearHover() {
    this.pourId++;
    this.hoverRegion = 0;
    if (this.o.view.hover) {
      this.o.view.hover = null;
      this.o.view.requestRender();
    }
  }

  /** Bounding boxes of every region of a scan (computed once per scan). @param {ScanResult} scan */
  regionBoxes(scan) {
    if (this.boxes && this.boxes.scan === scan) return this.boxes.boxes;
    const n = scan.regionCount + 1;
    const b = new Int32Array(n * 4);
    for (let r = 0; r < n; r++) {
      b[r * 4] = scan.w;
      b[r * 4 + 1] = scan.h;
      b[r * 4 + 2] = -1;
      b[r * 4 + 3] = -1;
    }
    const { labels, w } = scan;
    for (let p = 0; p < labels.length; p++) {
      const r = labels[p];
      if (!r) continue;
      const x = p % w;
      const y = (p - x) / w;
      if (x < b[r * 4]) b[r * 4] = x;
      if (y < b[r * 4 + 1]) b[r * 4 + 1] = y;
      if (x > b[r * 4 + 2]) b[r * 4 + 2] = x;
      if (y > b[r * 4 + 3]) b[r * 4 + 3] = y;
    }
    this.boxes = { scan, boxes: b };
    return b;
  }
}
