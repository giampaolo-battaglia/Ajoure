// @ts-check
// Image adjustments (SPEC §5.2): applied to the grey image before the threshold, and to the ink
// mask after it. Non-destructive: the source is never changed; prepare() runs them every time.
// Pure, no DOM.

import { distanceTo } from './distance.js';
import { labelComponents } from './label.js';

/**
 * @typedef {Object} Adjustments
 * @property {number} brightness  -100…100 (0 = unchanged)
 * @property {number} contrast    -100…100
 * @property {number|null} threshold  0…255 cut-off between ink and paper; null = automatic (Otsu)
 * @property {'auto'|'on'|'off'} invert  swap black and white; auto = when most of the image is dark
 * @property {number} smooth      0…4 px light blur before the threshold (removes jaggies)
 * @property {number} sharpen     0…100 unsharp mask
 * @property {number} despeckle   0…40: remove loose ink dots and paper specks up to this many px²
 * @property {number} lineWeight  -3…+3 px: thin or thicken every line
 */

/** @type {Readonly<Adjustments>} */
export const NO_ADJUST = Object.freeze({
  brightness: 0, contrast: 0, threshold: null, invert: 'auto', smooth: 0, sharpen: 0, despeckle: 0, lineWeight: 0,
});

/** Is anything changed from the defaults? @param {Partial<Adjustments>|null|undefined} a */
export function isAdjusted(a) {
  if (!a) return false;
  const k = /** @type {(keyof Adjustments)[]} */ (Object.keys(NO_ADJUST));
  return k.some((key) => a[key] !== undefined && a[key] !== NO_ADJUST[key]);
}

/**
 * Brightness / contrast / smooth / sharpen on a grey image. Returns a new array.
 * @param {Uint8Array} gray @param {number} w @param {number} h @param {Partial<Adjustments>} a
 */
export function adjustGray(gray, w, h, a) {
  let g = Float32Array.from(gray);
  const b = (a.brightness ?? 0) * 1.28; // ±128
  const c = a.contrast ?? 0;
  const k = c >= 0 ? 1 + c / 33 : 1 + c / 100; // up to ×4 / down to ×0
  if (b || c) for (let i = 0; i < g.length; i++) g[i] = (g[i] - 128) * k + 128 + b;
  const sm = Math.round(a.smooth ?? 0);
  if (sm > 0) g = boxBlur(boxBlur(g, w, h, sm), w, h, sm);
  const sh = (a.sharpen ?? 0) / 50; // 0…2
  if (sh > 0) {
    const bl = boxBlur(boxBlur(g, w, h, 1), w, h, 1);
    for (let i = 0; i < g.length; i++) g[i] += sh * (g[i] - bl[i]);
  }
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = g[i] < 0 ? 0 : g[i] > 255 ? 255 : Math.round(g[i]);
  return out;
}

/**
 * Despeckle and line weight on the ink mask (in place).
 * @param {Uint8Array} ink 1 = line @param {number} w @param {number} h @param {Partial<Adjustments>} a
 */
export function adjustInk(ink, w, h, a) {
  const sp = Math.round(a.despeckle ?? 0);
  if (sp > 0) {
    const dots = labelComponents(ink, w, h, 1, true);
    for (let p = 0; p < ink.length; p++) if (ink[p] && dots.area[dots.labels[p]] <= sp) ink[p] = 0;
    const holes = labelComponents(ink, w, h, 0, false);
    for (let p = 0; p < ink.length; p++) if (!ink[p] && !holes.border[holes.labels[p]] && holes.area[holes.labels[p]] <= sp) ink[p] = 1;
  }
  const lw = a.lineWeight ?? 0;
  if (lw > 0) {
    const d = distanceTo(ink, w, h);
    for (let p = 0; p < ink.length; p++) if (!ink[p] && d[p] <= lw) ink[p] = 1;
  } else if (lw < 0) {
    const paper = new Uint8Array(ink.length);
    for (let p = 0; p < ink.length; p++) paper[p] = ink[p] ^ 1;
    const d = distanceTo(paper, w, h);
    for (let p = 0; p < ink.length; p++) if (ink[p] && d[p] <= -lw) ink[p] = 0;
  }
  return ink;
}

/**
 * Separable box blur.
 * @param {Float32Array} src @param {number} w @param {number} h @param {number} r
 */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * k;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * k;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
