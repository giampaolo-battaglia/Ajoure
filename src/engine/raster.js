// @ts-check
// Pixel basics: grayscale, Otsu threshold, ink mask, line drawing. Pure, no DOM.

/**
 * RGBA → luminance, composited over white (transparent = paper).
 * @param {Uint8ClampedArray|Uint8Array} rgba @param {number} w @param {number} h
 */
export function toGray(rgba, w, h) {
  const n = w * h;
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = rgba[j + 3] / 255;
    const l = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    g[i] = Math.round(l * a + 255 * (1 - a));
  }
  return g;
}

/**
 * Otsu's threshold: pixels <= t are "dark".
 * @param {Uint8Array} gray
 */
export function otsu(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT;
}

/**
 * @param {Uint8Array} gray @param {number} t
 * @returns {Uint8Array} 1 = ink (dark), 0 = paper
 */
export function binarize(gray, t) {
  const ink = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) ink[i] = gray[i] <= t ? 1 : 0;
  return ink;
}

/** Fraction of pixels set. @param {Uint8Array} m */
export function fraction(m) {
  let c = 0;
  for (let i = 0; i < m.length; i++) c += m[i];
  return c / m.length;
}

/**
 * Draw a thick line into a mask (value 1), as a chain of filled discs.
 * @param {Uint8Array} m @param {number} w @param {number} h
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} r disc radius
 */
export function drawLine(m, w, h, x0, y0, x1, y1, r) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len * 2));
  const rr = r * r;
  const ri = Math.ceil(r);
  for (let s = 0; s <= steps; s++) {
    const cx = x0 + ((x1 - x0) * s) / steps;
    const cy = y0 + ((y1 - y0) * s) / steps;
    const ix = Math.round(cx);
    const iy = Math.round(cy);
    for (let dy = -ri; dy <= ri; dy++) {
      const y = iy + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -ri; dx <= ri; dx++) {
        const x = ix + dx;
        if (x < 0 || x >= w) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rr + 0.25) m[y * w + x] = 1;
      }
    }
  }
}

/**
 * Count pixels along a segment where the mask is 0 (the "gap" length in px).
 * @param {Uint8Array} m @param {number} w
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 */
export function emptyAlong(m, w, x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.round(len));
  let empty = 0;
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x0 + ((x1 - x0) * s) / steps);
    const y = Math.round(y0 + ((y1 - y0) * s) / steps);
    if (!m[y * w + x]) empty++;
  }
  return (empty * len) / steps;
}
