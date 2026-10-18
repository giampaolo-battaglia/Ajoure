// @ts-check
// Pure view math: no DOM. Screen point = image point * scale + (tx, ty), in CSS pixels.

/**
 * @typedef {Object} Viewport
 * @property {number} scale  image px → CSS px
 * @property {number} tx     image origin x on screen (CSS px)
 * @property {number} ty     image origin y on screen (CSS px)
 * @property {number} vw     view width (CSS px)
 * @property {number} vh     view height (CSS px)
 * @property {number} iw     image width (px)
 * @property {number} ih     image height (px)
 */

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 64;
/** Minimum CSS px of the image that must stay on screen while panning. */
export const KEEP_VISIBLE = 64;

/** Preset zoom levels used by ⌘+ / ⌘− and the zoom tool (Photoshop-like). */
export const ZOOM_STEPS = [
  0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32,
  48, 64,
];

/** @returns {Viewport} */
export function createViewport() {
  return { scale: 1, tx: 0, ty: 0, vw: 0, vh: 0, iw: 0, ih: 0 };
}

/** @param {number} s */
export function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * Keep at least KEEP_VISIBLE px of the image inside the view.
 * @param {Viewport} v
 * @returns {Viewport}
 */
export function clampPan(v) {
  if (!v.iw || !v.ih) return v;
  const w = v.iw * v.scale;
  const h = v.ih * v.scale;
  const keepX = Math.min(KEEP_VISIBLE, w);
  const keepY = Math.min(KEEP_VISIBLE, h);
  const tx = Math.min(v.vw - keepX, Math.max(keepX - w, v.tx));
  const ty = Math.min(v.vh - keepY, Math.max(keepY - h, v.ty));
  return tx === v.tx && ty === v.ty ? v : { ...v, tx, ty };
}

/**
 * Zoom to `scale`, keeping the image point under screen (px, py) fixed.
 * @param {Viewport} v @param {number} scale @param {number} px @param {number} py
 * @returns {Viewport}
 */
export function zoomAt(v, scale, px, py) {
  const s = clampScale(scale);
  const ix = (px - v.tx) / v.scale;
  const iy = (py - v.ty) / v.scale;
  return clampPan({ ...v, scale: s, tx: px - ix * s, ty: py - iy * s });
}

/** @param {Viewport} v @param {number} dx @param {number} dy @returns {Viewport} */
export function panBy(v, dx, dy) {
  return clampPan({ ...v, tx: v.tx + dx, ty: v.ty + dy });
}

/**
 * Scale and position that fit the whole image with padding.
 * @param {Viewport} v @param {number} [pad]
 * @returns {Viewport}
 */
export function fitView(v, pad = 40) {
  if (!v.iw || !v.ih || !v.vw || !v.vh) return v;
  const s = clampScale(Math.min((v.vw - pad * 2) / v.iw, (v.vh - pad * 2) / v.ih));
  return { ...v, scale: s, tx: (v.vw - v.iw * s) / 2, ty: (v.vh - v.ih * s) / 2 };
}

/**
 * Center the view on an image point, optionally at a new scale.
 * @param {Viewport} v @param {number} ix @param {number} iy @param {number} [scale]
 * @returns {Viewport}
 */
export function centerOn(v, ix, iy, scale = v.scale) {
  const s = clampScale(scale);
  return clampPan({ ...v, scale: s, tx: v.vw / 2 - ix * s, ty: v.vh / 2 - iy * s });
}

/** Image point currently at the view center. @param {Viewport} v */
export function viewCenter(v) {
  return { x: (v.vw / 2 - v.tx) / v.scale, y: (v.vh / 2 - v.ty) / v.scale };
}

/** @param {Viewport} v @param {number} x @param {number} y */
export function screenToImage(v, x, y) {
  return { x: (x - v.tx) / v.scale, y: (y - v.ty) / v.scale };
}

/**
 * Visible part of the image, in image pixel coords, snapped outward to whole pixels.
 * @param {Viewport} v
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function visibleImageRect(v) {
  const x0 = Math.max(0, Math.floor(-v.tx / v.scale));
  const y0 = Math.max(0, Math.floor(-v.ty / v.scale));
  const x1 = Math.min(v.iw, Math.ceil((v.vw - v.tx) / v.scale));
  const y1 = Math.min(v.ih, Math.ceil((v.vh - v.ty) / v.scale));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Next preset zoom level above (dir > 0) or below (dir < 0) the current scale.
 * @param {number} s @param {number} dir
 */
export function stepScale(s, dir) {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > s * 1.001) ?? MAX_SCALE;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < s / 1.001) return ZOOM_STEPS[i];
  return MIN_SCALE;
}

/**
 * Interpolate between two viewports: scale in log space, view center linearly.
 * @param {Viewport} a @param {Viewport} b @param {number} t 0..1
 * @returns {Viewport}
 */
export function lerpViewport(a, b, t) {
  const s = Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * t);
  const ca = viewCenter(a);
  const cb = viewCenter(b);
  const cx = ca.x + (cb.x - ca.x) * t;
  const cy = ca.y + (cb.y - ca.y) * t;
  return { ...b, scale: s, tx: b.vw / 2 - cx * s, ty: b.vh / 2 - cy * s };
}

/** Log-scale slider position (0..1) for a scale, and back. */
export function scaleToSlider(/** @type {number} */ s) {
  return (Math.log(s) - Math.log(MIN_SCALE)) / (Math.log(MAX_SCALE) - Math.log(MIN_SCALE));
}
export function sliderToScale(/** @type {number} */ p) {
  return Math.exp(Math.log(MIN_SCALE) + p * (Math.log(MAX_SCALE) - Math.log(MIN_SCALE)));
}

/** "37%", "100%", "6400%" — whole numbers above 10%, one decimal below. @param {number} s */
export function formatPercent(s) {
  const p = s * 100;
  return (p >= 10 ? Math.round(p).toString() : p.toFixed(1).replace(/\.0$/, '')) + '%';
}
