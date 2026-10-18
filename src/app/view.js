// @ts-check
// Canvas view: owns the viewport, draws the image crisply, animates zooms.

import {
  createViewport, fitView, zoomAt, panBy, clampPan, centerOn, visibleImageRect, lerpViewport,
} from './viewport.js';

/** @typedef {import('./viewport.js').Viewport} Viewport */

const GLIDE_MS = 160;
const GRID_FROM = 8; // pixel grid appears above 800%

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

    new ResizeObserver(() => this.resize()).observe(host);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.colors = readColors();
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
    ctx.imageSmoothingEnabled = v.scale < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, r.x, r.y, r.w, r.h, ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);

    if (v.scale >= GRID_FROM) this.drawGrid(r, s, ox, oy);
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
  };
}
