// @ts-check
// Canvas view: owns the viewport, draws the image crisply, animates zooms.

import {
  createViewport, fitView, zoomAt, panBy, clampPan, centerOn, visibleImageRect, lerpViewport,
} from './viewport.js';

/** @typedef {import('./viewport.js').Viewport} Viewport */

const GLIDE_MS = 160;
const GRID_FROM = 8; // pixel grid appears above 800%
const PIN_R = 9; // pin radius, CSS px

/** @typedef {import('../engine/analyze.js').Issue} Issue */
/** @typedef {'design'|'woodhole'} ViewMode */

export class CanvasView {
  /** @param {HTMLCanvasElement} canvas @param {HTMLElement} host */
  constructor(canvas, host) {
    this.canvas = canvas;
    this.host = host;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    /** @type {Viewport} */
    this.v = createViewport();
    /** @type {ImageBitmap|null} */
    this.image = null;
    this.dpr = window.devicePixelRatio || 1;
    /** @type {Set<(v: Viewport) => void>} */
    this.listeners = new Set();
    this.frame = 0;
    /** @type {{from: Viewport, to: Viewport, start: number, dur: number, anchor?: {x:number,y:number}}|null} */
    this.anim = null;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.colors = readColors();
    /** @type {ViewMode} */
    this.mode = 'design';
    /** @type {ImageBitmap|null} wood/hole picture built from the scan */
    this.woodHole = null;
    /** @type {Issue[]} */
    this.issues = [];
    /** @type {string|null} */
    this.focusId = null;
    /** @type {CanvasPattern|null} */
    this.checker = null;
    this.checkerDpr = 0;

    new ResizeObserver(() => this.resize()).observe(host);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.colors = readColors();
      this.checker = null;
      this.requestRender();
    });
    this.resize();
  }

  /** @param {(v: Viewport) => void} fn */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get viewport() { return this.v; }

  /** @param {ImageBitmap} bitmap */
  setImage(bitmap) {
    this.image = bitmap;
    this.anim = null;
    this.issues = [];
    this.focusId = null;
    if (this.woodHole) this.woodHole.close();
    this.woodHole = null;
    this.v = fitView({ ...this.v, iw: bitmap.width, ih: bitmap.height });
    this.emit();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const first = this.v.vw === 0;
    // Keep the same image point at the view center across resizes.
    const cx = (this.v.vw / 2 - this.v.tx) / this.v.scale;
    const cy = (this.v.vh / 2 - this.v.ty) / this.v.scale;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.v = { ...this.v, vw: w, vh: h };
    if (this.image) this.v = first ? fitView(this.v) : centerOn(this.v, cx, cy);
    this.emit();
  }

  // ---- analysis overlay ------------------------------------------------------

  /**
   * Show a scan: pins now, the wood/hole picture as soon as it's built.
   * @param {{w:number, h:number, classMap: Uint8Array, issues: Issue[]}} res
   */
  async setAnalysis(res) {
    this.issues = res.issues;
    this.emit();
    const { w, h, classMap } = res;
    const data = new ImageData(w, h);
    const px = new Uint32Array(data.data.buffer);
    // Little-endian ABGR: wood white, lines near-black, holes grey, waste transparent.
    const COLORS = [0x00000000, 0xffffffff, 0xff645f5f, 0xff2e2c2c];
    for (let i = 0; i < classMap.length; i++) px[i] = COLORS[classMap[i]];
    const bmp = await createImageBitmap(data);
    if (this.woodHole) this.woodHole.close();
    this.woodHole = bmp;
    this.requestRender();
  }

  /** @param {ViewMode} mode */
  setMode(mode) {
    this.mode = mode;
    this.requestRender();
  }

  /** @param {string|null} id */
  setFocus(id) {
    this.focusId = id;
    this.requestRender();
  }

  /**
   * The pin under a screen point, if any.
   * @param {number} x @param {number} y
   * @returns {Issue|null}
   */
  pinAt(x, y) {
    const v = this.v;
    let best = null;
    let bestD = (PIN_R + 4) ** 2;
    for (const i of this.issues) {
      if (i.status !== 'open') continue;
      const px = i.anchor[0] * v.scale + v.tx;
      const py = i.anchor[1] * v.scale + v.ty;
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Glide so an issue sits in the middle, comfortably zoomed. @param {Issue} issue */
  glideToIssue(issue) {
    if (!this.image) return;
    const from = this.current();
    const [, , bw, bh] = issue.bbox;
    const fill = 0.6;
    let s = Math.min((from.vw * fill) / Math.max(bw, 1), (from.vh * fill) / Math.max(bh, 1));
    s = Math.max(Math.min(s, 6), Math.min(from.scale, 6), 1);
    this.startGlide(from, centerOn(from, issue.anchor[0], issue.anchor[1], s));
  }

  // ---- viewport changes -------------------------------------------------

  /** Replace the viewport immediately (cancels any glide). @param {Viewport} next */
  set(next) {
    this.anim = null;
    this.v = clampPan(next);
    this.emit();
  }

  /** @param {number} dx @param {number} dy */
  pan(dx, dy) {
    if (!this.image) return;
    this.set(panBy(this.current(), dx, dy));
  }

  /** Zoom by a factor around a screen point, immediately. @param {number} factor @param {number} x @param {number} y */
  zoomBy(factor, x, y) {
    if (!this.image) return;
    this.set(zoomAt(this.current(), this.current().scale * factor, x, y));
  }

  /**
   * Glide to a scale, anchored on a screen point (default: view center).
   * @param {number} scale @param {{x:number,y:number}} [anchor]
   */
  glideTo(scale, anchor) {
    if (!this.image) return;
    const from = this.current();
    const a = anchor ?? { x: from.vw / 2, y: from.vh / 2 };
    this.startGlide(from, zoomAt(from, scale, a.x, a.y), a);
  }

  /** Glide to fit the whole image. */
  glideFit() {
    if (!this.image) return;
    const from = this.current();
    this.startGlide(from, fitView(from));
  }

  /**
   * @param {Viewport} from @param {Viewport} to @param {{x:number,y:number}} [anchor]
   */
  startGlide(from, to, anchor) {
    if (this.reduceMotion.matches) return this.set(to);
    this.anim = { from, to, start: performance.now(), dur: GLIDE_MS, anchor };
    this.requestRender();
  }

  /** Viewport including any in-progress glide, so new input continues from what's on screen. */
  current() {
    if (this.anim) this.v = this.sampleAnim(performance.now());
    return this.v;
  }

  /** @param {number} now */
  sampleAnim(now) {
    const a = /** @type {NonNullable<CanvasView['anim']>} */ (this.anim);
    const t = Math.min(1, (now - a.start) / a.dur);
    const e = 1 - Math.pow(1 - t, 4); // strong ease-out
    if (t >= 1) {
      this.anim = null;
      return a.to;
    }
    if (a.anchor) {
      // Keep the anchor point fixed for the whole glide.
      const s = Math.exp(Math.log(a.from.scale) + (Math.log(a.to.scale) - Math.log(a.from.scale)) * e);
      return zoomAt(a.from, s, a.anchor.x, a.anchor.y);
    }
    return lerpViewport(a.from, a.to, e);
  }

  emit() {
    this.requestRender();
    for (const fn of this.listeners) fn(this.v);
  }

  // ---- drawing -------------------------------------------------------------

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      if (this.anim) {
        this.v = this.sampleAnim(now);
        for (const fn of this.listeners) fn(this.v);
        if (this.anim) this.requestRender();
      }
      this.draw();
    });
  }

  draw() {
    const { ctx, dpr, v, image, colors } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.stage;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!image) return;

    const s = v.scale * dpr;
    const ox = v.tx * dpr;
    const oy = v.ty * dpr;

    // Soft page shadow under the image (clipped to the view to keep numbers small).
    const pad = 40 * dpr;
    const x0 = Math.max(-pad, ox);
    const y0 = Math.max(-pad, oy);
    const x1 = Math.min(this.canvas.width + pad, ox + v.iw * s);
    const y1 = Math.min(this.canvas.height + pad, oy + v.ih * s);
    if (x1 > x0 && y1 > y0) {
      ctx.save();
      ctx.shadowColor = colors.pageShadow;
      ctx.shadowBlur = 18 * dpr;
      ctx.shadowOffsetY = 3 * dpr;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }

    const r = visibleImageRect(v);
    if (!r) return;
    const showWood = this.mode === 'woodhole' && this.woodHole;
    if (showWood && x1 > x0 && y1 > y0) {
      // Waste shows as a quiet checkerboard (screen-space, so it doesn't swim when zooming).
      ctx.fillStyle = this.checkerPattern();
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.imageSmoothingEnabled = v.scale < 1;
    ctx.imageSmoothingQuality = 'high';
    const src = showWood ? /** @type {ImageBitmap} */ (this.woodHole) : image;
    ctx.drawImage(src, r.x, r.y, r.w, r.h, ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);

    if (v.scale >= GRID_FROM) this.drawGrid(r, s, ox, oy);
    this.drawPins();
  }

  drawPins() {
    const { ctx, dpr, v } = this;
    if (!this.issues.length) return;
    const pad = 20;
    for (const i of this.issues) {
      if (i.status !== 'open') continue;
      const x = (i.anchor[0] * v.scale + v.tx) * dpr;
      const y = (i.anchor[1] * v.scale + v.ty) * dpr;
      if (x < -pad * dpr || y < -pad * dpr || x > this.canvas.width + pad * dpr || y > this.canvas.height + pad * dpr) continue;
      const focused = i.id === this.focusId;
      const r = (focused ? PIN_R + 2 : PIN_R) * dpr;
      const color = i.severity === 'critical' ? this.colors.critical : i.severity === 'warning' ? this.colors.warning : this.colors.info;
      ctx.save();
      if (focused) {
        ctx.beginPath();
        ctx.arc(x, y, r + 6 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = color + '33';
        ctx.fill();
      }
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 4 * dpr;
      ctx.shadowOffsetY = 1 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      // Glyph
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      const u = r / PIN_R;
      if (i.type === 'leak') {
        // a drop
        ctx.beginPath();
        ctx.moveTo(x, y - 5 * u);
        ctx.bezierCurveTo(x + 1.5 * u, y - 2.5 * u, x + 4 * u, y - 0.5 * u, x + 4 * u, y + 1.5 * u);
        ctx.arc(x, y + 1.5 * u, 4 * u, 0, Math.PI, false);
        ctx.bezierCurveTo(x - 4 * u, y - 0.5 * u, x - 1.5 * u, y - 2.5 * u, x, y - 5 * u);
        ctx.fill();
      } else if (i.type === 'island') {
        // an island: dot inside a ring
        ctx.lineWidth = 1.5 * u;
        ctx.beginPath();
        ctx.arc(x, y, 4.2 * u, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 1.8 * u, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 2 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  checkerPattern() {
    if (this.checker && this.checkerDpr === this.dpr) return this.checker;
    const size = Math.round(8 * this.dpr);
    const c = document.createElement('canvas');
    c.width = c.height = size * 2;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.fillStyle = this.colors.checkerA;
    g.fillRect(0, 0, size * 2, size * 2);
    g.fillStyle = this.colors.checkerB;
    g.fillRect(0, 0, size, size);
    g.fillRect(size, size, size, size);
    this.checker = /** @type {CanvasPattern} */ (this.ctx.createPattern(c, 'repeat'));
    this.checkerDpr = this.dpr;
    return this.checker;
  }

  /** @param {{x:number,y:number,w:number,h:number}} r @param {number} s @param {number} ox @param {number} oy */
  drawGrid(r, s, ox, oy) {
    const { ctx } = this;
    // Fade the grid in between 800% and 1200%.
    const alpha = Math.min(1, (this.v.scale - GRID_FROM) / 4 + 0.35);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const top = oy + r.y * s;
    const bottom = oy + (r.y + r.h) * s;
    const left = ox + r.x * s;
    const right = ox + (r.x + r.w) * s;
    for (let x = r.x; x <= r.x + r.w; x++) {
      const px = Math.round(ox + x * s) + 0.5;
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
    }
    for (let y = r.y; y <= r.y + r.h; y++) {
      const py = Math.round(oy + y * s) + 0.5;
      ctx.moveTo(left, py);
      ctx.lineTo(right, py);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (/** @type {string} */ n, /** @type {string} */ f) => cs.getPropertyValue(n).trim() || f;
  return {
    stage: get('--stage', '#dcdce0'),
    pageShadow: get('--page-shadow', 'rgba(0,0,0,.2)'),
    grid: get('--grid', 'rgba(0,0,0,.15)'),
    critical: get('--critical', '#e5484d'),
    warning: get('--warning', '#f5a524'),
    info: get('--info', '#3e8cf0'),
    checkerA: get('--checker-a', '#e9e9ec'),
    checkerB: get('--checker-b', '#dedee2'),
  };
}
