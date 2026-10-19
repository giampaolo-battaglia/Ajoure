// @ts-check
// Connected-component labeling with per-component stats. Pure, no DOM.

/**
 * @typedef {Object} Components
 * @property {Int32Array} labels   0 = not part of any component
 * @property {number} count
 * @property {Int32Array} area      indexed by label (0 unused)
 * @property {Int32Array} minX @property {Int32Array} minY
 * @property {Int32Array} maxX @property {Int32Array} maxY
 * @property {Uint8Array} border    1 if the component touches the image edge
 * @property {Float64Array} sumX @property {Float64Array} sumY  for centroids
 */

/**
 * Label pixels where mask[i] === value.
 * @param {Uint8Array} mask @param {number} w @param {number} h
 * @param {number} value @param {boolean} conn8  8-connectivity if true, else 4
 * @returns {Components}
 */
export function labelComponents(mask, w, h, value, conn8) {
  const n = w * h;
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  /** @type {number[]} */ const area = [0];
  /** @type {number[]} */ const minX = [0];
  /** @type {number[]} */ const minY = [0];
  /** @type {number[]} */ const maxX = [0];
  /** @type {number[]} */ const maxY = [0];
  /** @type {number[]} */ const border = [0];
  /** @type {number[]} */ const sumX = [0];
  /** @type {number[]} */ const sumY = [0];
  let count = 0;

  for (let i = 0; i < n; i++) {
    if (mask[i] !== value || labels[i] !== 0) continue;
    count++;
    let a = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, b = 0, sx = 0, sy = 0;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = count;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      a++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) b = 1;
      const l = x > 0, r = x < w - 1, u = y > 0, d = y < h - 1;
      let q;
      if (l && mask[(q = p - 1)] === value && labels[q] === 0) { labels[q] = count; stack[sp++] = q; }
      if (r && mask[(q = p + 1)] === value && labels[q] === 0) { labels[q] = count; stack[sp++] = q; }
      if (u && mask[(q = p - w)] === value && labels[q] === 0) { labels[q] = count; stack[sp++] = q; }
      if (d && mask[(q = p + w)] === value && labels[q] === 0) { labels[q] = count; stack[sp++] = q; }
      if (conn8) {
        if (l && u && mask[(q = p - w - 1)] === value && labels[q] === 0) { labels[q] = count; stack[sp++] = q; }
        if (r && u && mask[(q = p - w + 1)] === value && labels[q] === 0) { labels[q] = count; stack[sp++] = q; }
        if (l && d && mask[(q = p + w - 1)] === value && labels[q] === 0) { labels[q] = count; stack[sp++] = q; }
        if (r && d && mask[(q = p + w + 1)] === value && labels[q] === 0) { labels[q] = count; stack[sp++] = q; }
      }
    }
    area.push(a);
    minX.push(x0);
    minY.push(y0);
    maxX.push(x1);
    maxY.push(y1);
    border.push(b);
    sumX.push(sx);
    sumY.push(sy);
  }

  return {
    labels,
    count,
    area: Int32Array.from(area),
    minX: Int32Array.from(minX),
    minY: Int32Array.from(minY),
    maxX: Int32Array.from(maxX),
    maxY: Int32Array.from(maxY),
    border: Uint8Array.from(border),
    sumX: Float64Array.from(sumX),
    sumY: Float64Array.from(sumY),
  };
}
