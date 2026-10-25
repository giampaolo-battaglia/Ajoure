// @ts-check
// Canvas view: owns the viewport, draws the image crisply, animates zooms.

import {
  createViewport, fitView, zoomAt, panBy, clampPan, centerOn, visibleImageRect, lerpViewport,
} from './viewport.js';

/** @typedef {import('./viewport.js').Viewport} Viewport */

const GLIDE_MS = 160;
const GRID_FROM = 8; // pixel grid appears above 800%
const PIN_R = 9; // pin radius, CSS px
const BOX_MIN = 28; // smallest issue box, CSS px
const BOX_PAD = 8; // breathing room around the issue zone, CSS px
const DOT_GAP = 5; // spacing of the dots on a box outline, CSS px

/** @typedef {'box'|'pin'} MarkerStyle */

/** @typedef {import('../engine/analyze.js').Issue} Issue */
/** @typedef {'design'|'woodhole'|'plan'|'cut'} ViewMode */
/** @typedef {'stays'|'removed'|'cut'|'score'|'engrave'} PlanLayer */

/** Plan view colours (the legend's swatches use the same). */
export const PLAN_COLORS = Object.freeze({
  wood: '#ecd9b6',
  cut: '#e5332a',
  score: '#2563eb',
  engrave: '#5a3214',
});

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
    /** @type {MarkerStyle} how issues are drawn on the canvas */
    this.markerStyle = 'box';
    this.showIgnored = true;
    /** @type {HTMLCanvasElement|null} the user's paint (wood / hole), image-sized */
    this.editLayer = null;
    /** @type {HTMLCanvasElement|null} the eraser's paint (paper white), image-sized */
    this.paperLayer = null;
    /**
     * Bucket hover preview (image coords). `tick` advances an animated pour and says
     * whether it's still flowing; `ripple` is where the water was poured.
     * @type {{canvas: HTMLCanvasElement, x: number, y: number, tick?: (now: number) => boolean, ripple?: {x: number, y: number, t0: number}}|null}
     */
    this.hover = null;
    /** @type {null | {kind:'brush', x:number, y:number, r:number, color:string} | {kind:'line', ax:number, ay:number, bx:number, by:number, r:number, color:string} | {kind:'curve', ax:number, ay:number, cx:number, cy:number, bx:number, by:number, r:number, color:string}} */
    this.toolOverlay = null;
    /**
     * Flow test overlay: the water, where it escapes (gap flashes) and the holes that held (checks).
     * @type {null | {reveal: import('./water.js').FlowReveal, quick: boolean, gaps: {x:number, y:number, t:number}[], held: {x:number, y:number, area:number}[], tEnd: number}}
     */
    this.flow = null;
    /**
     * Cut preview geometry (image px): the wood outlines (fill even-odd), score lines, engraving.
     * @type {null | {wood: Path2D, outline: Path2D|null, scores: Path2D|null, engrave: Path2D|null, engraveAreas: Path2D|null, kerfPx: number}}
     */
    this.cutPreview = null;
    /** @type {PlanLayer|null} Plan view: the legend item being looked at (the rest is dimmed) */
    this.planFocus = null;
    /** @type {CanvasPattern|null} */
    this.hatch = null;
    this.hatchDpr = 0;
    /** @type {CanvasRenderingContext2D|null} for hit-testing the plan paths */
    this.hitCtx = null;
    /** @type {CanvasPattern|null} */
    this.grain = null;
    /** @type {HTMLCanvasElement|null} adjusted trace for Design view */
    this.adjusted = null;
    /** holding \\ to compare with the original */
    this.showOriginal = false;
    /** @type {{x:number, y:number}|null} the last connector's midpoint handle (drag to curve) */
    this.connHandle = null;
    /** @type {{issue: Issue, t0: number}[]} resolved markers fading out */
    this.ghosts = [];
    /** @type {{x:number, y:number, issues: Issue[]}[]} pin clusters on screen (CSS px), for hit-testing */
    this.clusters = [];
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
    this.adjusted = null;
    this.flow = null;
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

  /** What Design view draws: the adjusted black & white trace when adjustments are on, else the image. */
  designSource() {
    if (this.showOriginal) return this.image;
    return this.adjusted || this.image;
  }

  /** @param {HTMLCanvasElement|null} c the adjusted trace (null = no adjustments) */
  setAdjusted(c) {
    this.adjusted = c;
    this.requestRender();
  }

  /** Hold-to-compare (\\): show the original image, whatever the view. @param {boolean} on */
  setShowOriginal(on) {
    if (this.showOriginal === on) return;
    this.showOriginal = on;
    this.requestRender();
  }

  // ---- analysis overlay ------------------------------------------------------

  /**
   * Show a scan: pins now, the wood/hole picture as soon as it's built.
   * @param {{w:number, h:number, classMap: Uint8Array, issues: Issue[], labels?: Int32Array, regionEngraved?: Uint8Array}} res
   */
  async setAnalysis(res) {
    this.issues = res.issues;
    this.emit();
    const { w, h, classMap, labels, regionEngraved } = res;
    const data = new ImageData(w, h);
    const px = new Uint32Array(data.data.buffer);
    // Little-endian ABGR: wood white, lines near-black, holes grey, waste transparent.
    const COLORS = [0x00000000, 0xffffffff, 0xff645f5f, 0xff2e2c2c];
    for (let i = 0; i < classMap.length; i++) px[i] = COLORS[classMap[i]];
    // Engraved areas: still wood, tinted the colour of a burn.
    if (labels && regionEngraved && regionEngraved.some((v) => v)) {
      for (let i = 0; i < classMap.length; i++) if (classMap[i] === 1 && regionEngraved[labels[i]]) px[i] = 0xff6a9ac4;
    }
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

  /** @param {MarkerStyle} style */
  setMarkerStyle(style) {
    this.markerStyle = style;
    this.requestRender();
  }

  /**
   * Screen-space square around an issue's zone (CSS px), used by the "box" markers.
   * @param {Issue} i
   */
  issueBox(i) {
    const v = this.v;
    const [bx, by, bw, bh] = i.bbox;
    const cx = (bx + bw / 2) * v.scale + v.tx;
    const cy = (by + bh / 2) * v.scale + v.ty;
    const side = Math.max(BOX_MIN, Math.max(bw, bh) * v.scale + 2 * BOX_PAD);
    return { x: cx - side / 2, y: cy - side / 2, side };
  }

  /** Issues that currently have a visible marker. */
  visibleIssues() {
    return this.issues.filter((i) => i.status === 'open' || (i.status === 'ignored' && this.showIgnored));
  }

  /**
   * The issue marker under a screen point, if any (pin or box, whichever is showing).
   * @param {number} x @param {number} y
   * @returns {Issue|null}
   */
  pinAt(x, y) {
    const hit = this.hitMarker(x, y);
    return hit ? hit[0] : null;
  }

  /**
   * All issues under a screen point: one for a box or single pin, several for a pin cluster.
   * @param {number} x @param {number} y
   * @returns {Issue[]|null}
   */
  hitMarker(x, y) {
    if (this.markerStyle === 'box') {
      // Inside a box (with a little slack); the smallest box wins when they overlap.
      let best = null;
      let bestSide = Infinity;
      for (const i of this.visibleIssues()) {
        const b = this.issueBox(i);
        const m = 4;
        if (x >= b.x - m && x <= b.x + b.side + m && y >= b.y - m && y <= b.y + b.side + m && b.side < bestSide) {
          bestSide = b.side;
          best = i;
        }
      }
      return best ? [best] : null;
    }
    let best = null;
    let bestD = (PIN_R + 4) ** 2;
    for (const c of this.clusters) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c.issues;
      }
    }
    return best;
  }

  /** Mark issues as just resolved: they flash green and fade. @param {Issue[]} list */
  addGhosts(list) {
    const t0 = performance.now();
    for (const issue of list) this.ghosts.push({ issue, t0 });
    this.requestRender();
  }

  /**
   * @param {HTMLCanvasElement|null} layer wood / hole paint
   * @param {HTMLCanvasElement|null} [paper] eraser paint (shown on the drawing only; Wood/Hole shows the scan there)
   */
  setEditLayer(layer, paper = null) {
    this.editLayer = layer;
    this.paperLayer = paper;
    this.requestRender();
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

    if (this.mode === 'cut' && !this.showOriginal) {
      this.drawCut(s, ox, oy);
      this.drawToolOverlay();
      return;
    }
    if (this.mode === 'plan' && !this.showOriginal && this.cutPreview) {
      this.drawPlan(s, ox, oy);
      this.drawHover(ox, oy, s);
      return;
    }

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
    const showWood = this.mode === 'woodhole' && this.woodHole && !this.showOriginal;
    if (showWood && x1 > x0 && y1 > y0) {
      // Waste shows as a quiet checkerboard (screen-space, so it doesn't swim when zooming).
      ctx.fillStyle = this.checkerPattern();
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.imageSmoothingEnabled = v.scale < 1;
    ctx.imageSmoothingQuality = 'high';
    const src = showWood ? /** @type {ImageBitmap} */ (this.woodHole) : /** @type {ImageBitmap|HTMLCanvasElement} */ (this.designSource());
    ctx.drawImage(src, r.x, r.y, r.w, r.h, ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);
    // The user's paint shows at once, before the re-check comes back.
    if (this.paperLayer && !this.showOriginal && !showWood) ctx.drawImage(this.paperLayer, r.x, r.y, r.w, r.h, ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);
    if (this.editLayer && !this.showOriginal) ctx.drawImage(this.editLayer, r.x, r.y, r.w, r.h, ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);
    if (this.flow) this.drawFlow(ox, oy, s);
    this.drawHover(ox, oy, s);

    if (v.scale >= GRID_FROM) this.drawGrid(r, s, ox, oy);
    this.drawPins();
    this.drawGhosts();
    this.drawToolOverlay();
  }

  /** Bucket / Engrave hover preview. @param {number} ox @param {number} oy @param {number} s */
  drawHover(ox, oy, s) {
    if (!this.hover) return;
    const hv = this.hover;
    const now = performance.now();
    if (hv.tick && hv.tick(now)) this.requestRender();
    this.ctx.drawImage(hv.canvas, ox + hv.x * s, oy + hv.y * s, hv.canvas.width * s, hv.canvas.height * s);
    if (hv.ripple) this.drawRipple(hv.ripple, now);
  }

  /** @param {{wood: string, outline?: string, scores: string, engrave: string, engraveAreas?: string}|null} d path data (image px) @param {number} kerfPx */
  setCutPreview(d, kerfPx) {
    this.cutPreview = d ? {
      wood: new Path2D(d.wood),
      outline: d.outline ? new Path2D(d.outline) : null,
      scores: d.scores ? new Path2D(d.scores) : null,
      engrave: d.engrave ? new Path2D(d.engrave) : null,
      engraveAreas: d.engraveAreas ? new Path2D(d.engraveAreas) : null,
      kerfPx,
    } : null;
    this.requestRender();
  }

  /** @param {PlanLayer|null} layer */
  setPlanFocus(layer) {
    this.planFocus = layer;
    this.requestRender();
  }

  /** Diagonal hatching over a light checker: "this falls away" (screen space). */
  hatchPattern() {
    if (this.hatch && this.hatchDpr === this.dpr) return this.hatch;
    const d = this.dpr;
    const size = Math.round(12 * d);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.fillStyle = this.colors.checkerA;
    g.fillRect(0, 0, size, size);
    g.strokeStyle = this.colors.checkerB;
    g.lineWidth = 2 * d;
    g.beginPath();
    for (const o of [-size, 0, size]) {
      g.moveTo(o, size);
      g.lineTo(o + size, 0);
    }
    g.stroke();
    this.hatch = /** @type {CanvasPattern} */ (this.ctx.createPattern(c, 'repeat'));
    this.hatchDpr = d;
    return this.hatch;
  }

  /**
   * The plan: what stays (wood), what falls out (hatched), and what the laser does —
   * cut (red), score (blue), engrave (dark brown fill). Lines keep a constant on-screen width.
   * @param {number} s @param {number} ox @param {number} oy
   */
  drawPlan(s, ox, oy) {
    const { ctx, dpr, v } = this;
    const cp = /** @type {NonNullable<CanvasView['cutPreview']>} */ (this.cutPreview);
    const f = this.planFocus;
    const dim = (/** @type {PlanLayer} */ k) => (f && f !== k ? 0.22 : 1);
    // Everything that isn't wood falls away: hatch the image area (holes show it through the wood).
    const x0 = Math.max(0, ox), y0 = Math.max(0, oy);
    const x1 = Math.min(this.canvas.width, ox + v.iw * s), y1 = Math.min(this.canvas.height, oy + v.ih * s);
    ctx.save();
    ctx.globalAlpha = f === 'removed' ? 1 : f ? 0.5 : 1;
    ctx.fillStyle = this.hatchPattern();
    if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    ctx.save();
    ctx.setTransform(s, 0, 0, s, ox, oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const px = dpr / s; // one CSS px in image units
    // Wood, lifted a little.
    ctx.save();
    ctx.globalAlpha = f === 'removed' ? 0.35 : dim('stays') < 1 ? 0.55 : 1;
    ctx.shadowColor = 'rgba(40, 24, 8, 0.28)';
    ctx.shadowBlur = 10 * dpr;
    ctx.shadowOffsetY = 3 * dpr;
    ctx.fillStyle = PLAN_COLORS.wood;
    ctx.fill(cp.wood, 'evenodd');
    ctx.restore();
    // Engraving: whole shapes and bold lines.
    ctx.save();
    ctx.globalAlpha = dim('engrave');
    ctx.fillStyle = PLAN_COLORS.engrave;
    if (cp.engraveAreas) ctx.fill(cp.engraveAreas, 'evenodd');
    if (cp.engrave) ctx.fill(cp.engrave, 'evenodd');
    ctx.restore();
    // Score lines.
    if (cp.scores) {
      ctx.save();
      ctx.globalAlpha = dim('score');
      ctx.lineWidth = (f === 'score' ? 2.5 : 1.6) * px;
      ctx.strokeStyle = PLAN_COLORS.score;
      ctx.stroke(cp.scores);
      ctx.restore();
    }
    // Cut lines on top.
    ctx.save();
    ctx.globalAlpha = dim('cut');
    ctx.lineWidth = (f === 'cut' ? 2.5 : 1.6) * px;
    ctx.strokeStyle = PLAN_COLORS.cut;
    ctx.stroke(cp.wood);
    ctx.restore();
    ctx.restore();
  }

  /**
   * What the plan shows at an image point: a cut, score or engraved line, an engraved area,
   * wood that stays, or something that falls out. Lines are picked within a few screen px.
   * @param {number} x @param {number} y image px
   * @returns {null | 'cut'|'score'|'engraveLine'|'engraveArea'|'stays'|'removed'|'outside'}
   */
  planHit(x, y) {
    const cp = this.cutPreview;
    if (!cp) return null;
    if (!this.hitCtx) this.hitCtx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
    const g = this.hitCtx;
    const tol = Math.max(1.5, 5 / this.v.scale); // 5 CSS px
    g.lineWidth = tol * 2;
    g.lineCap = g.lineJoin = 'round';
    if (cp.engrave && g.isPointInPath(cp.engrave, x, y, 'evenodd')) return 'engraveLine';
    if (cp.scores && g.isPointInStroke(cp.scores, x, y)) return 'score';
    if (g.isPointInStroke(cp.wood, x, y)) return 'cut';
    if (cp.engraveAreas && g.isPointInPath(cp.engraveAreas, x, y, 'evenodd')) return 'engraveArea';
    if (g.isPointInPath(cp.wood, x, y, 'evenodd')) return 'stays';
    if (x < 0 || y < 0 || x >= this.v.iw || y >= this.v.ih) return null;
    return cp.outline && g.isPointInPath(cp.outline, x, y, 'evenodd') ? 'removed' : 'outside';
  }

  /** A soft basswood grain, in image px (so it zooms with the wood). */
  woodGrain() {
    if (this.grain) return this.grain;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.fillStyle = '#ecd9b6';
    g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * c.width;
      const wv = 0.6 + Math.random() * 2.2;
      g.strokeStyle = `rgba(${150 + Math.random() * 40}, ${105 + Math.random() * 30}, 60, ${0.05 + Math.random() * 0.08})`;
      g.lineWidth = wv;
      g.beginPath();
      for (let y = 0; y <= c.height; y += 16) {
        const xx = x + Math.sin(y / (60 + i) + i) * 6 + Math.sin(y / 23 + i * 3) * 1.5;
        if (y === 0) g.moveTo(xx, y);
        else g.lineTo(xx, y);
      }
      g.stroke();
    }
    this.grain = /** @type {CanvasPattern} */ (this.ctx.createPattern(c, 'repeat'));
    return this.grain;
  }

  /**
   * The piece as it comes out of the laser: basswood, see-through holes, burnt edges, scores.
   * @param {number} s @param {number} ox @param {number} oy
   */
  drawCut(s, ox, oy) {
    const { ctx, dpr } = this;
    const cp = this.cutPreview;
    if (!cp) return;
    ctx.save();
    ctx.setTransform(s, 0, 0, s, ox, oy);
    // The piece, lifted off the table a little.
    ctx.shadowColor = 'rgba(40, 24, 8, 0.34)';
    ctx.shadowBlur = 14 * dpr;
    ctx.shadowOffsetY = 5 * dpr;
    ctx.fillStyle = this.woodGrain();
    ctx.fill(cp.wood, 'evenodd');
    ctx.shadowColor = 'transparent';
    // Burnt edges: a dark kerf line with a soft scorch just inside.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.save();
    ctx.clip(cp.wood, 'evenodd');
    ctx.lineWidth = cp.kerfPx * 5;
    ctx.strokeStyle = 'rgba(120, 66, 24, 0.16)';
    ctx.stroke(cp.wood);
    ctx.lineWidth = cp.kerfPx * 2.2;
    ctx.strokeStyle = 'rgba(92, 50, 18, 0.45)';
    ctx.stroke(cp.wood);
    ctx.restore();
    ctx.lineWidth = Math.max(cp.kerfPx, 0.6 / s * dpr);
    ctx.strokeStyle = 'rgba(58, 30, 10, 0.9)';
    ctx.stroke(cp.wood);
    if (cp.engrave || cp.engraveAreas) {
      ctx.fillStyle = 'rgba(70, 36, 12, 0.82)';
      if (cp.engraveAreas) ctx.fill(cp.engraveAreas, 'evenodd');
      if (cp.engrave) ctx.fill(cp.engrave, 'evenodd');
    }
    if (cp.scores) {
      ctx.lineWidth = Math.max(cp.kerfPx * 0.9, 0.5 / s * dpr);
      ctx.strokeStyle = 'rgba(78, 40, 14, 0.85)';
      ctx.stroke(cp.scores);
    }
    ctx.restore();
  }

  /** @param {number} ox @param {number} oy @param {number} s */
  drawFlow(ox, oy, s) {
    const fl = /** @type {NonNullable<CanvasView['flow']>} */ (this.flow);
    const { ctx, dpr, v } = this;
    const now = performance.now();
    const r = fl.reveal;
    let alive = r.tick(now);
    const u = r.progress(now);
    if (!alive && !fl.tEnd) fl.tEnd = now;
    ctx.save();
    // Quick mode: a 150 ms fade.
    if (fl.quick) {
      const a = Math.min(1, (now - r.t0) / 150);
      ctx.globalAlpha = a;
      if (a < 1) alive = true;
    }
    ctx.imageSmoothingEnabled = v.scale < 1;
    ctx.drawImage(r.canvas, ox, oy, r.w * s, r.h * s);
    ctx.restore();
    // Gaps flash and ripple (amber) as the water reaches them.
    for (const g of fl.gaps) {
      const since = fl.quick ? now - r.t0 : now - (r.t0 + r.timeOf(g.t));
      if (since < 0) { alive = true; continue; }
      const cx = (g.x * v.scale + v.tx) * dpr;
      const cy = (g.y * v.scale + v.ty) * dpr;
      ctx.save();
      // A soft glow that stays while the result shows.
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16 * dpr);
      const k = since < 400 ? 1 - since / 800 : Math.max(0.55, 0.5 + 0.12 * Math.cos(((since - 400) / 600) * Math.PI));
      glow.addColorStop(0, `rgba(255, 190, 80, ${0.95 * k})`);
      glow.addColorStop(1, 'rgba(255, 150, 30, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, 16 * dpr, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        const q = (since - i * 180) / 1000;
        if (q < 0 || q >= 1) continue;
        const e = 1 - (1 - q) ** 3;
        ctx.beginPath();
        ctx.arc(cx, cy, (6 + 34 * e) * dpr, 0, Math.PI * 2);
        ctx.lineWidth = (2.4 - 1.6 * q) * dpr;
        ctx.strokeStyle = `rgba(240, 140, 20, ${0.9 * (1 - q)})`;
        ctx.stroke();
      }
      ctx.restore();
      if (since < 1400) alive = true; // ripples and a short glow pulse, then it holds still
    }
    // Holes that held: a tiny check, briefly, once everything has settled.
    if (fl.tEnd) {
      const since = now - fl.tEnd;
      if (since < 1800) {
        alive = true;
        const a = since < 250 ? since / 250 : since > 1300 ? Math.max(0, (1800 - since) / 500) : 1;
        ctx.save();
        ctx.globalAlpha = a;
        for (const hd of fl.held) {
          if (hd.area * v.scale * v.scale < 900) continue; // too small on screen to label
          const cx = (hd.x * v.scale + v.tx) * dpr;
          const cy = (hd.y * v.scale + v.ty) * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, 7 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx - 3.2 * dpr, cy + 0.2 * dpr);
          ctx.lineTo(cx - 0.8 * dpr, cy + 2.6 * dpr);
          ctx.lineTo(cx + 3.4 * dpr, cy - 2.4 * dpr);
          ctx.lineWidth = 1.6 * dpr;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = '#2b6fe0';
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    void u;
    if (alive) this.requestRender();
  }

  /** Rings spreading from where the water was poured. @param {{x:number, y:number, t0:number}} rp @param {number} now */
  drawRipple(rp, now) {
    const RING_MS = 900;
    const { ctx, dpr, v } = this;
    const cx = (rp.x * v.scale + v.tx) * dpr;
    const cy = (rp.y * v.scale + v.ty) * dpr;
    let alive = false;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const u = (now - rp.t0 - i * 220) / RING_MS;
      if (u < 0) { alive = true; continue; }
      if (u >= 1) continue;
      alive = true;
      const e = 1 - (1 - u) * (1 - u) * (1 - u);
      ctx.beginPath();
      ctx.arc(cx, cy, (4 + 30 * e) * dpr, 0, Math.PI * 2);
      ctx.lineWidth = (2.2 - 1.4 * u) * dpr;
      ctx.strokeStyle = `rgba(150, 205, 255, ${0.9 * (1 - u)})`;
      ctx.stroke();
    }
    ctx.restore();
    if (alive) this.requestRender();
  }

  drawToolOverlay() {
    const o = this.toolOverlay;
    const { ctx, dpr, v } = this;
    const sx = (/** @type {number} */ x) => (x * v.scale + v.tx) * dpr;
    const sy = (/** @type {number} */ y) => (y * v.scale + v.ty) * dpr;
    if (this.connHandle) {
      const h = this.connHandle;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx(h.x), sy(h.y), 5.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 3 * dpr;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = this.colors.accent;
      ctx.stroke();
      ctx.restore();
    }
    if (!o) return;
    ctx.save();
    if (o.kind === 'curve') {
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(2 * dpr, 2 * o.r * v.scale * dpr);
      ctx.strokeStyle = o.color;
      ctx.beginPath();
      ctx.moveTo(sx(o.ax), sy(o.ay));
      ctx.quadraticCurveTo(sx(o.cx), sy(o.cy), sx(o.bx), sy(o.by));
      ctx.stroke();
    } else if (o.kind === 'brush') {
      const r = Math.max(1.5 * dpr, o.r * v.scale * dpr);
      ctx.beginPath();
      ctx.arc(sx(o.x), sy(o.y), r, 0, Math.PI * 2);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.lineWidth = 1.25 * dpr;
      ctx.strokeStyle = o.color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx(o.x), sy(o.y), 1.25 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = o.color;
      ctx.fill();
    } else {
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(2 * dpr, 2 * o.r * v.scale * dpr);
      ctx.strokeStyle = o.color;
      ctx.beginPath();
      ctx.moveTo(sx(o.ax), sy(o.ay));
      ctx.lineTo(sx(o.bx), sy(o.by));
      ctx.stroke();
      ctx.globalAlpha = 1;
      for (const [x, y] of [[o.ax, o.ay], [o.bx, o.by]]) {
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), 3.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = o.color;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Resolved issues: a green marker with a check, fading out over 700 ms. */
  drawGhosts() {
    if (!this.ghosts.length) return;
    const now = performance.now();
    this.ghosts = this.ghosts.filter((g) => now - g.t0 < 700);
    const { ctx, dpr, v } = this;
    for (const g of this.ghosts) {
      const t = (now - g.t0) / 700;
      const x = (g.issue.anchor[0] * v.scale + v.tx) * dpr;
      const y = (g.issue.anchor[1] * v.scale + v.ty) * dpr;
      const r = (PIN_R + 2 * t) * dpr;
      ctx.save();
      ctx.globalAlpha = 1 - t * t;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.colors.ok;
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 4 * dpr, y + 0.2 * dpr);
      ctx.lineTo(x - 1.2 * dpr, y + 3 * dpr);
      ctx.lineTo(x + 4.2 * dpr, y - 3 * dpr);
      ctx.lineWidth = 2 * dpr;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
    if (this.ghosts.length) this.requestRender();
  }

  drawPins() {
    this.clusters = [];
    if (!this.issues.length) return;
    if (this.markerStyle === 'box') return this.drawBoxes();
    const { ctx, dpr, v } = this;
    const pad = 20;
    // Group pins that would overlap on screen into one pin with a count.
    /** @type {{x:number, y:number, issues: Issue[]}[]} */
    const clusters = [];
    for (const i of this.visibleIssues()) {
      const x = i.anchor[0] * v.scale + v.tx;
      const y = i.anchor[1] * v.scale + v.ty;
      if (x < -pad || y < -pad || x > this.canvas.width / dpr + pad || y > this.canvas.height / dpr + pad) continue;
      const c = clusters.find((k) => (k.x - x) ** 2 + (k.y - y) ** 2 < (PIN_R * 1.6) ** 2 && k.issues[0].status === i.status);
      if (c) c.issues.push(i);
      else clusters.push({ x, y, issues: [i] });
    }
    this.clusters = clusters;
    for (const c of clusters) {
      const i = c.issues[0];
      const focused = c.issues.some((k) => k.id === this.focusId);
      const x = c.x * dpr;
      const y = c.y * dpr;
      const r = (focused ? PIN_R + 2 : PIN_R) * dpr;
      const ignored = i.status === 'ignored';
      const worst = c.issues.find((k) => k.severity === 'critical') || i;
      const color = ignored ? this.colors.ignored : sevColor(this.colors, worst.severity);
      ctx.save();
      if (focused) {
        ctx.beginPath();
        ctx.arc(x, y, r + 6 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = color + '33';
        ctx.fill();
      }
      if (ignored) {
        // Hollow grey ring: still there, but set aside.
        ctx.beginPath();
        ctx.arc(x, y, r - 1 * dpr, 0, Math.PI * 2);
        ctx.lineWidth = 3.5 * dpr;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.stroke();
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.restore();
        continue;
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
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      const u = r / PIN_R;
      if (c.issues.length > 1) {
        ctx.font = `600 ${Math.round(10 * u)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(c.issues.length), x, y + 0.5 * dpr);
      } else if (i.type === 'leak') {
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

  /** Issue zones as squares made of dots, in the severity colour. */
  drawBoxes() {
    const { ctx, dpr } = this;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    for (const i of this.visibleIssues()) {
      const b = this.issueBox(i);
      if (b.x > W || b.y > H || b.x + b.side < 0 || b.y + b.side < 0) continue;
      const focused = i.id === this.focusId;
      const color = i.status === 'ignored' ? this.colors.ignored : sevColor(this.colors, i.severity);
      const r = (focused ? 1.9 : i.status === 'ignored' ? 1.2 : 1.5) * dpr;
      ctx.save();
      if (focused) {
        ctx.fillStyle = color + '1f';
        ctx.fillRect(b.x * dpr, b.y * dpr, b.side * dpr, b.side * dpr);
      }
      // Dots evenly spaced along each side, corners included.
      const n = Math.max(4, Math.round(b.side / DOT_GAP));
      const step = (b.side * dpr) / n;
      const x0 = b.x * dpr;
      const y0 = b.y * dpr;
      const s = b.side * dpr;
      /** @type {[number, number][]} */
      const pts = [];
      for (let k = 0; k < n; k++) {
        pts.push([x0 + k * step, y0]);
        pts.push([x0 + s, y0 + k * step]);
        pts.push([x0 + s - k * step, y0 + s]);
        pts.push([x0, y0 + s - k * step]);
      }
      // A soft white halo keeps the dots readable over black lines and grey holes alike.
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      for (const [px, py] of pts) {
        ctx.moveTo(px + r + 0.9 * dpr, py);
        ctx.arc(px, py, r + 0.9 * dpr, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const [px, py] of pts) {
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
      ctx.fill();
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
    ok: get('--ok', '#2f9e6b'),
    accent: get('--accent', '#14857a'),
    ignored: get('--ignored', '#9a9aa0'),
    checkerA: get('--checker-a', '#e9e9ec'),
    checkerB: get('--checker-b', '#dedee2'),
  };
}

/** @param {ReturnType<typeof readColors>} c @param {string} sev */
function sevColor(c, sev) {
  return sev === 'critical' ? c.critical : sev === 'warning' ? c.warning : c.info;
}
