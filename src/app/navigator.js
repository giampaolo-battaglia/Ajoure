// @ts-check
// Navigator panel: thumbnail + viewport rectangle, zoom slider and % field.

import {
  centerOn, viewCenter, stepScale, scaleToSlider, sliderToScale, formatPercent, zoomAt,
} from './viewport.js';

/** @typedef {import('./view.js').CanvasView} CanvasView */

export class Navigator {
  /**
   * @param {{well: HTMLElement, canvas: HTMLCanvasElement, slider: HTMLInputElement,
   *          field: HTMLInputElement, zoomIn: HTMLElement, zoomOut: HTMLElement}} els
   * @param {CanvasView} view
   */
  constructor(els, view) {
    this.els = els;
    this.view = view;
    const ctx = els.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    /** @type {HTMLCanvasElement|null} */
    this.thumb = null;
    this.tw = 0; // thumbnail size in CSS px
    this.th = 0;
    this.k = 1; // thumbnail px per image px
    this.dpr = window.devicePixelRatio || 1;
    /** @type {{dx:number, dy:number}|null} */
    this.drag = null;
    this.editing = false;
    this.accent = '';
    this.dim = '';
    this.readColors();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.readColors();
      this.draw();
    });

    view.onChange(() => this.draw());
    new ResizeObserver(() => this.layout()).observe(els.well);
    this.bind();
  }

  readColors() {
    const cs = getComputedStyle(document.documentElement);
    this.accent = cs.getPropertyValue('--accent').trim() || '#14857a';
    this.dim = cs.getPropertyValue('--nav-dim').trim() || 'rgba(0,0,0,.4)';
  }

  /** Build a downscaled thumbnail once per image. @param {ImageBitmap} bitmap */
  setImage(bitmap) {
    this.source = bitmap;
    this.layout();
  }

  layout() {
    const bitmap = this.source;
    if (!bitmap) return;
    const r = this.els.well.getBoundingClientRect();
    const pad = 10;
    const k = Math.min((r.width - pad * 2) / bitmap.width, (r.height - pad * 2) / bitmap.height);
    if (!(k > 0)) return;
    this.k = k;
    this.tw = Math.round(bitmap.width * k);
    this.th = Math.round(bitmap.height * k);
    this.dpr = window.devicePixelRatio || 1;
    const c = this.els.canvas;
    c.style.width = `${this.tw}px`;
    c.style.height = `${this.th}px`;
    c.width = Math.round(this.tw * this.dpr);
    c.height = Math.round(this.th * this.dpr);

    // Pre-render the thumbnail with progressive halving for a clean downscale.
    let src = /** @type {CanvasImageSource} */ (bitmap);
    let w = bitmap.width;
    let h = bitmap.height;
    while (w / 2 > c.width) {
      const step = document.createElement('canvas');
      step.width = Math.max(1, Math.round(w / 2));
      step.height = Math.max(1, Math.round(h / 2));
      const sctx = /** @type {CanvasRenderingContext2D} */ (step.getContext('2d'));
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(src, 0, 0, step.width, step.height);
      src = step;
      w = step.width;
      h = step.height;
    }
    const thumb = document.createElement('canvas');
    thumb.width = c.width;
    thumb.height = c.height;
    const tctx = /** @type {CanvasRenderingContext2D} */ (thumb.getContext('2d'));
    tctx.fillStyle = '#fff';
    tctx.fillRect(0, 0, thumb.width, thumb.height);
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(src, 0, 0, thumb.width, thumb.height);
    this.thumb = thumb;
    this.draw();
  }

  draw() {
    this.updateControls();
    const { ctx, thumb, dpr } = this;
    if (!thumb) return;
    const v = this.view.viewport;
    const c = this.els.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(thumb, 0, 0);

    // Viewport rectangle in thumbnail CSS px.
    const k = this.k;
    const x = (-v.tx / v.scale) * k;
    const y = (-v.ty / v.scale) * k;
    const w = (v.vw / v.scale) * k;
    const h = (v.vh / v.scale) * k;
    let rx = Math.max(0, x) * dpr;
    let ry = Math.max(0, y) * dpr;
    let rw = (Math.min(this.tw, x + w) - Math.max(0, x)) * dpr;
    let rh = (Math.min(this.th, y + h) - Math.max(0, y)) * dpr;
    const covers = x <= 0.5 && y <= 0.5 && x + w >= this.tw - 0.5 && y + h >= this.th - 0.5;
    if (covers || rw <= 0 || rh <= 0) {
      this.drawDots();
      return;
    }
    // Deep zooms would shrink the rectangle to a speck; keep it findable.
    const min = 8 * dpr;
    if (rw < min) { rx -= (min - rw) / 2; rw = min; }
    if (rh < min) { ry -= (min - rh) / 2; rh = min; }

    ctx.save();
    ctx.fillStyle = this.dim;
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    ctx.rect(rx, ry, rw, rh);
    ctx.fill('evenodd');
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(rx + 0.75 * dpr, ry + 0.75 * dpr, Math.max(0, rw - 1.5 * dpr), Math.max(0, rh - 1.5 * dpr));
    ctx.restore();
    this.drawDots();
  }

  /** Issue dots, so you always see where problems are even when zoomed deep into one. */
  drawDots() {
    const { ctx, dpr, k } = this;
    const cs = this.view.colors;
    for (const i of this.view.issues) {
      if (i.status !== 'open') continue;
      ctx.beginPath();
      ctx.arc(i.anchor[0] * k * dpr, i.anchor[1] * k * dpr, 3 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = i.severity === 'critical' ? cs.critical : i.severity === 'warning' ? cs.warning : cs.info;
      ctx.fill();
      ctx.lineWidth = 1.25 * dpr;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }

  updateControls() {
    const s = this.view.viewport.scale;
    const p = scaleToSlider(s);
    const { slider, field } = this.els;
    slider.value = String(Math.round(p * 1000));
    slider.style.setProperty('--fill', `${(p * 100).toFixed(2)}%`);
    if (!this.editing) field.value = formatPercent(s);
  }

  // ---- interaction ---------------------------------------------------------

  bind() {
    const { canvas, slider, field, zoomIn, zoomOut } = this.els;

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.thumb || e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const v = this.view.viewport;
      const p = this.toImage(e);
      const c = viewCenter(v);
      const halfW = v.vw / v.scale / 2;
      const halfH = v.vh / v.scale / 2;
      const inside = Math.abs(p.x - c.x) <= halfW && Math.abs(p.y - c.y) <= halfH;
      // Inside the rectangle: grab it where you clicked. Outside: jump there, then drag.
      this.drag = inside ? { dx: c.x - p.x, dy: c.y - p.y } : { dx: 0, dy: 0 };
      if (!inside) this.view.set(centerOn(v, p.x, p.y));
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) {
        canvas.style.cursor = this.thumb ? 'grab' : '';
        return;
      }
      const p = this.toImage(e);
      this.view.set(centerOn(this.view.viewport, p.x + this.drag.dx, p.y + this.drag.dy));
    });
    const end = () => {
      this.drag = null;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // Scroll or pinch over the thumbnail zooms around the view center.
    this.els.well.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.thumb) return;
        const v = this.view.viewport;
        const k = e.ctrlKey ? 0.01 : 0.0025;
        const d = Math.max(-60, Math.min(60, e.deltaY));
        this.view.set(zoomAt(v, v.scale * Math.exp(-d * k), v.vw / 2, v.vh / 2));
      },
      { passive: false },
    );

    slider.addEventListener('input', () => {
      const v = this.view.viewport;
      this.view.set(zoomAt(v, sliderToScale(Number(slider.value) / 1000), v.vw / 2, v.vh / 2));
    });

    zoomIn.addEventListener('click', () => this.view.glideTo(stepScale(this.view.current().scale, 1)));
    zoomOut.addEventListener('click', () => this.view.glideTo(stepScale(this.view.current().scale, -1)));

    field.addEventListener('focus', () => {
      this.editing = true;
      field.select();
    });
    field.addEventListener('blur', () => {
      this.editing = false;
      this.updateControls();
    });
    field.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing digits must not trigger tool shortcuts
      if (e.key === 'Enter') {
        const n = parseFloat(field.value.replace(',', '.'));
        if (Number.isFinite(n) && n > 0) {
          const v = this.view.viewport;
          this.view.set(zoomAt(v, n / 100, v.vw / 2, v.vh / 2));
        }
        field.blur();
      } else if (e.key === 'Escape') {
        field.blur();
      }
    });
  }

  /** @param {PointerEvent} e */
  toImage(e) {
    const r = this.els.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.k, y: (e.clientY - r.top) / this.k };
  }
}
