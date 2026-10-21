// Tiny synthetic drawings for tests: white paper, 3-px black pens.

/** @param {number} W @param {number} H */
export function canvas(W, H) {
  const ink = new Uint8Array(W * H);
  const dot = (/** @type {number} */ x, /** @type {number} */ y, r = 1.5) => {
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++)
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++)
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && (xx - x) ** 2 + (yy - y) ** 2 <= r * r) ink[yy * W + xx] = 1;
  };
  const line = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
  };
  const rect = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => {
    line(x0, y0, x1, y0); line(x1, y0, x1, y1); line(x1, y1, x0, y1); line(x0, y1, x0, y0);
  };
  const circle = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r) => {
    for (let a = 0; a <= 360; a += 0.5) dot(cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180));
  };
  const erase = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ink[y * W + x] = 0;
  };
  const rgba = () => {
    const out = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let p = 0; p < W * H; p++) if (ink[p]) out.set([0, 0, 0, 255], p * 4);
    return out;
  };
  return { ink, line, rect, circle, erase, rgba };
}

/**
 * Stamp a thick segment into an edits layer.
 * @param {Uint8Array} edits @param {number} W @param {number} H
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} r @param {number} value
 */
export function paint(edits, W, H, x0, y0, x1, y1, r, value) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let i = 0; i <= n; i++) {
    const cx = x0 + ((x1 - x0) * i) / n;
    const cy = y0 + ((y1 - y0) * i) / n;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (x >= 0 && y >= 0 && x < W && y < H && (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.25) edits[y * W + x] = value;
  }
}
