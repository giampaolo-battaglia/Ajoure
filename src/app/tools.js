// @ts-check
// Fixing tools (SPEC §6.5): Bucket, Engrave, Wood brush, Hole brush, Eraser, Revert brush, Connector, Separator.
// Works in image pixels; the document records the edits, the view shows them.

import { EDIT_NONE, EDIT_WOOD, EDIT_HOLE, EDIT_PAPER, WOOD, HOLE, WASTE, PX_LINE, BASSWOOD_3MM } from '../engine/analyze.js';
import { pourOrder, wobble, Pour } from './water.js';
import { visibleImageRect } from './viewport.js';
import { union } from './doc.js';

/** @typedef {'hand'|'zoom'|'bucket'|'engrave'|'wood'|'hole'|'eraser'|'revert'|'connector'|'separator'} ToolId */
/** @typedef {'wood'|'hole'|'eraser'|'revert'|'connector'|'separator'} SizedTool */
/** Brushes that paint the edits layer, and what they paint. */
const PAINT = /** @type {Record<string, number>} */ ({ wood: EDIT_WOOD, hole: EDIT_HOLE, eraser: EDIT_PAPER, revert: EDIT_NONE });
const SIZED = ['wood', 'hole', 'eraser', 'revert', 'connector', 'separator'];
/** @typedef {import('./doc.js').EditDoc} EditDoc */
/** @typedef {import('./doc.js').Rect} Rect */
/** @typedef {import('./scanner.js').ScanResult} ScanResult */
/** @typedef {import('./view.js').CanvasView} CanvasView */

/** Tools that change the design (everything but Hand and Zoom). */
export const EDIT_TOOLS = /** @type {ToolId[]} */ (['bucket', 'engrave', 'wood', 'hole', 'eraser', 'revert', 'connector', 'separator']);
/** Tools shown as a brush circle instead of the system cursor. */
export const BRUSH_TOOLS = /** @type {ToolId[]} */ (['wood', 'hole', 'eraser', 'revert', 'connector', 'separator']);

export const TOOL_NAMES = /** @type {Record<ToolId, string>} */ ({
  hand: 'Hand',
  zoom: 'Zoom',
  bucket: 'Bucket',
  engrave: 'Engrave',
  wood: 'Wood brush',
  hole: 'Hole brush',
  eraser: 'Eraser',
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
   *   onEngrave: (region: number, x: number, y: number) => void,
   *   onEngraveLine: (x: number, y: number) => void,
   *   onCutToWood: (x: number, y: number) => void,
   *   say: (msg: string) => void,
   * }} o
   */
  constructor(o) {
    this.o = o;
    /** @type {ToolId} */
    this.tool = 'hand';
    /** Brush diameters in image px (set from the material once the scale is known). */
    this.size = { wood: 8, hole: 4, eraser: 8, revert: 12, connector: 10, separator: 4 };
    /** The material's sizes, for "Default". */
    this.defaults = { ...this.size };
    /** @type {((tool: ToolId) => void)|null} told when a brush size changes */
    this.onSize = null;
    this.sizedFor = '';
    /** @type {{x:number, y:number}|null} last pointer position in image px */
    this.last = null;
    /** @type {{ax:number, ay:number}|null} connector's first point */
    this.conn = null;
    /** @type {{ax:number, ay:number}|null} separator drag start */
    this.sep = null;
    /**
     * The connector just placed: its midpoint can be dragged to curve it (SPEC §6.5).
     * @type {{ax:number, ay:number, bx:number, by:number, mx:number, my:number, patch: object}|null}
     */
    this.lastConn = null;
    /** dragging the last connector's midpoint */
    this.curving = false;
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
   * Default brush sizes from the material's minimum widths (SPEC §6.5), once per scale and material.
   * @param {number} pxPerMm @param {{name: string, minWoodWidth: number, minHoleWidth: number}} [p]
   */
  setScale(pxPerMm, p = BASSWOOD_3MM) {
    const key = `${pxPerMm}|${p.name}`;
    if (this.sizedFor === key) return;
    this.sizedFor = key;
    this.size.wood = Math.max(2, p.minWoodWidth * pxPerMm);
    this.size.hole = Math.max(2, p.minHoleWidth * pxPerMm);
    this.size.revert = Math.max(4, this.size.wood * 1.5);
    this.size.eraser = Math.max(4, this.size.wood * 1.5);
    this.size.connector = Math.max(2, p.minWoodWidth * 1.2 * pxPerMm);
    this.size.separator = Math.max(2, p.minHoleWidth * pxPerMm);
    this.defaults = { ...this.size };
    this.pxPerMm = pxPerMm;
    this.onSize?.(this.tool);
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
    this.dropConnHandle();
    this.o.view.toolOverlay = null;
    this.clearHover();
    this.o.view.requestRender();
  }

  /** Does the current tool have a size? */
  get sized() {
    const t = this.tool;
    return SIZED.includes(t);
  }

  /** Set the current brush's diameter (image px, 1…400). @param {number} px */
  setSize(px) {
    const t = this.tool;
    if (!SIZED.includes(t)) return;
    this.size[/** @type {SizedTool} */ (t)] = Math.max(1, Math.min(400, px));
    this.refreshOverlay();
    this.onSize?.(t);
  }

  /** `[` / `]`: resize the current brush. Returns a label for feedback, or null. @param {number} dir */
  resize(dir) {
    const t = this.tool;
    if (!SIZED.includes(t)) return null;
    const st = /** @type {SizedTool} */ (t);
    const k = dir > 0 ? 1.25 : 0.8;
    this.setSize(this.size[st] * k);
    const mm = this.pxPerMm ? `${(this.size[st] / this.pxPerMm).toFixed(2)} mm` : `${Math.round(this.size[st])} px`;
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
    if (t === 'engrave') {
      this.engrave(p);
      return true;
    }
    if (t in PAINT) {
      const value = PAINT[t];
      const r = this.size[/** @type {SizedTool} */ (t)] / 2;
      doc.beginStroke(TOOL_NAMES[t]);
      this.painting = true;
      // ⇧-click: straight line from the last painted point.
      const from = e.shiftKey && doc.lastPoint ? doc.lastPoint : null;
      this.o.onPaint(from ? doc.segment(from[0], from[1], p.x, p.y, r, value) : doc.stamp(p.x, p.y, r, value));
      return true;
    }
    if (t === 'connector') {
      if (!this.conn && this.nearConnHandle(p)) {
        this.curving = true;
        this.refreshOverlay();
        return true;
      }
      if (!this.conn) {
        this.dropConnHandle();
        this.conn = { ax: p.x, ay: p.y };
        this.refreshOverlay();
        return true;
      }
      const { ax, ay } = this.conn;
      this.conn = null;
      doc.beginStroke('Connector');
      this.o.onPaint(doc.segment(ax, ay, p.x, p.y, this.size.connector / 2, EDIT_WOOD));
      if (doc.endStroke()) {
        this.lastConn = {
          ax, ay, bx: p.x, by: p.y, mx: (ax + p.x) / 2, my: (ay + p.y) / 2,
          patch: doc.undoStack[doc.undoStack.length - 1],
        };
      }
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
      const value = PAINT[t] ?? EDIT_NONE;
      const size = t in PAINT ? this.size[/** @type {SizedTool} */ (t)] : 4;
      this.o.onPaint(doc.segment(this.last.x, this.last.y, p.x, p.y, size / 2, value));
    }
    this.last = p;
    this.refreshOverlay();
  }

  /** @param {PointerEvent} e @param {{x:number, y:number}} p */
  up(e, p) {
    const doc = this.o.getDoc();
    if (this.curving) {
      this.curving = false;
      if (doc && this.lastConn) this.curveConnector(doc, p);
      this.refreshOverlay();
      return;
    }
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
    if (this.tool === 'bucket' || this.tool === 'engrave') this.hoverBucket(p);
    else this.clearHover();
    this.refreshOverlay();
  }

  refreshOverlay() {
    const view = this.o.view;
    const p = this.last;
    const t = this.tool;
    const color = this.accentCss || '#14857a';
    const doc = this.o.getDoc();
    // The curve handle stays only while the connector is the latest edit.
    if (this.lastConn && (!doc || doc.undoStack[doc.undoStack.length - 1] !== this.lastConn.patch)) this.lastConn = null;
    view.connHandle = t === 'connector' && this.lastConn && !this.conn ? { x: this.lastConn.mx, y: this.lastConn.my } : null;
    if (t === 'connector' && this.curving && this.lastConn && p) {
      const c = this.lastConn;
      const cx = 2 * p.x - (c.ax + c.bx) / 2;
      const cy = 2 * p.y - (c.ay + c.by) / 2;
      view.toolOverlay = { kind: 'curve', ax: c.ax, ay: c.ay, cx, cy, bx: c.bx, by: c.by, r: this.size.connector / 2, color };
      view.connHandle = { x: p.x, y: p.y };
    } else if (!p || !BRUSH_TOOLS.includes(t) || (t === 'connector' && !this.conn && this.nearConnHandle(p))) {
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

  // ---- connector curve ---------------------------------------------------------------

  /** Is p on the last connector's midpoint handle? (10 screen px) @param {{x:number, y:number}} p */
  nearConnHandle(p) {
    const c = this.lastConn;
    const doc = this.o.getDoc();
    if (!c || !doc || doc.undoStack[doc.undoStack.length - 1] !== c.patch) return false;
    const d = Math.hypot(p.x - c.mx, p.y - c.my) * this.o.view.viewport.scale;
    return d <= 10;
  }

  /** A system cursor to show instead of the brush circle, if any. */
  cursor() {
    if (this.tool !== 'connector') return null;
    if (this.curving) return 'grabbing';
    return !this.conn && this.last && this.nearConnHandle(this.last) ? 'grab' : null;
  }

  dropConnHandle() {
    this.lastConn = null;
    this.curving = false;
    this.o.view.connHandle = null;
  }

  /**
   * Replace the last (straight) connector with a curve through the dragged midpoint.
   * One undo step: the straight bridge is undone first, then the curve is drawn.
   * @param {EditDoc} doc @param {{x:number, y:number}} m new midpoint
   */
  curveConnector(doc, m) {
    const c = /** @type {NonNullable<ToolController['lastConn']>} */ (this.lastConn);
    if (Math.hypot(m.x - c.mx, m.y - c.my) < 0.5) return;
    if (doc.undoStack[doc.undoStack.length - 1] !== c.patch) return this.dropConnHandle();
    doc.undo();
    doc.redoStack.pop(); // the straight version is replaced, not redoable
    const cx = 2 * m.x - (c.ax + c.bx) / 2;
    const cy = 2 * m.y - (c.ay + c.by) / 2;
    const r = this.size.connector / 2;
    const len = Math.hypot(cx - c.ax, cy - c.ay) + Math.hypot(c.bx - cx, c.by - cy);
    const n = Math.max(4, Math.ceil(len / Math.max(1, r)));
    doc.beginStroke('Connector');
    /** @type {import('./doc.js').Rect|null} */
    let dirty = null;
    let px = c.ax, py = c.ay;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const x = u * u * c.ax + 2 * u * t * cx + t * t * c.bx;
      const y = u * u * c.ay + 2 * u * t * cy + t * t * c.by;
      dirty = union(dirty, doc.segment(px, py, x, y, r, EDIT_WOOD));
      px = x;
      py = y;
    }
    this.o.onPaint(dirty);
    if (doc.endStroke()) {
      c.mx = m.x;
      c.my = m.y;
      c.patch = doc.undoStack[doc.undoStack.length - 1];
    } else this.dropConnHandle();
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
    if (!r) {
      // Hole paint is a cut you painted: the Bucket can make it wood (it becomes part of the area again).
      const doc = this.o.getDoc();
      if (doc && doc.edits[y * scan.w + x] === EDIT_HOLE && !e.altKey) return this.o.onCutToWood(x, y);
      return this.o.say('That’s a line — click inside an area. To remove a line, use the Eraser (E).');
    }
    const cur = scan.regionClass[r];
    if (cur === WASTE) return this.o.say('That area is outside the piece.');
    const cls = e.shiftKey ? WOOD : e.altKey ? HOLE : cur === WOOD ? HOLE : WOOD;
    if (cls === cur && (e.shiftKey || e.altKey)) return;
    this.o.onBucket(r, cls, x, y);
  }

  /**
   * Engrave: click an area to burn its whole surface (click it again to clear); click a line with
   * wood on both sides to switch it between score and engrave. Lines along a hole are cut edges.
   * @param {{x:number, y:number}} p
   */
  engrave(p) {
    const scan = this.o.getScan();
    if (!scan) return this.o.say('Still scanning — try again in a second.');
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= scan.w || y >= scan.h) return;
    const q = y * scan.w + x;
    const r = scan.labels[q];
    if (!r || scan.classMap[q] === PX_LINE) return this.o.onEngraveLine(x, y);
    if (scan.regionClass[r] === WASTE) return this.o.say('That’s outside the piece.');
    this.o.onEngrave(r, x, y);
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
    const water = this.preview === 'water' && this.tool === 'bucket';
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
    const [ar, ag, ab] = this.tool === 'engrave' ? [110, 58, 20] : this.accent;
    for (let yy = 0; yy < bh; yy++) {
      const row = (y0 + yy) * scan.w + x0;
      for (let xx = 0; xx < bw; xx++) {
        if (scan.labels[row + xx] === r) {
          const k = (yy * bw + xx) * 4;
          d[k] = ar;
          d[k + 1] = ag;
          d[k + 2] = ab;
          d[k + 3] = this.tool === 'engrave' ? 70 : 110;
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

