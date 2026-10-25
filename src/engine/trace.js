// @ts-check
// Tracing (SPEC §9): the wood mask becomes smooth, closed outlines for the laser, and floating
// details become centre lines to score. Pure, no DOM. Coordinates are image px; the SVG writer
// converts to mm.
//
// Outlines follow the pixel edges between wood and not-wood ("crack following"), so every outline
// is closed by construction and two neighbouring outlines never share a line. Wood counts as
// 4-connected: two wood pixels touching only at a corner are separate (the laser would cut
// through that point anyway). The staircase is then smoothed and simplified into Bézier curves.

const DX = [1, 0, -1, 0]; // edge directions: 0 = +x, 1 = +y, 2 = −x, 3 = −y (y down)
const DY = [0, 1, 0, -1];

/**
 * @typedef {{pts: Float64Array, hole: boolean, area: number}} Contour
 *   pts: x0,y0,x1,y1,… (closed, last ≠ first); area: signed px² (> 0 outer, < 0 hole)
 */

/**
 * Outlines of a mask (1 = inside). Outer outlines run counter-clockwise on screen, holes clockwise.
 * @param {Uint8Array} mask @param {number} w @param {number} h
 * @returns {Contour[]}
 */
export function traceMask(mask, w, h) {
  const W = w + 1;
  // Up to two outgoing edges per pixel corner (two only at a saddle: diagonal pixels).
  const out1 = new Int8Array(W * (h + 1)).fill(-1);
  const out2 = new Int8Array(W * (h + 1)).fill(-1);
  const at = (/** @type {number} */ x, /** @type {number} */ y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  /** @param {number} vx @param {number} vy @param {number} d */
  const add = (vx, vy, d) => {
    const v = vy * W + vx;
    if (out1[v] < 0) out1[v] = d;
    else out2[v] = d;
  };
  let edges = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      // Each side facing outside gets an edge; going round one lone pixel: top ←, left ↓, bottom →, right ↑.
      if (!at(x, y - 1)) { add(x + 1, y, 2); edges++; }
      if (!at(x - 1, y)) { add(x, y, 1); edges++; }
      if (!at(x, y + 1)) { add(x, y + 1, 0); edges++; }
      if (!at(x + 1, y)) { add(x + 1, y + 1, 3); edges++; }
    }
  }
  /** @type {Contour[]} */
  const contours = [];
  const used1 = new Uint8Array(W * (h + 1));
  const used2 = new Uint8Array(W * (h + 1));
  for (let sv = 0; sv < out1.length; sv++) {
    for (let slot = 0; slot < 2; slot++) {
      const d0 = slot ? out2[sv] : out1[sv];
      if (d0 < 0 || (slot ? used2[sv] : used1[sv])) continue;
      /** @type {number[]} */
      const pts = [];
      let v = sv;
      let d = d0;
      if (slot) used2[v] = 1;
      else used1[v] = 1;
      let prevD = -1;
      let guard = 0;
      while (guard++ <= edges) {
        const vx = v % W, vy = (v - vx) / W;
        if (d !== prevD) pts.push(vx, vy); // keep corners only
        prevD = d;
        v = (vy + DY[d]) * W + (vx + DX[d]);
        // Next edge: at a saddle, hug the pixel we're going round (turn left on screen, i.e. the
        // turn with negative cross product), which keeps wood 4-connected.
        let nd = -1;
        const a = out1[v], b = out2[v];
        if (b >= 0) {
          const ca = DX[d] * DY[a] - DY[d] * DX[a];
          const pickA = !used1[v] && (ca < 0 || used2[v]);
          if (pickA) { nd = a; used1[v] = 1; } else if (!used2[v]) { nd = b; used2[v] = 1; } else if (!used1[v]) { nd = a; used1[v] = 1; }
        } else if (a >= 0 && !used1[v]) {
          nd = a;
          used1[v] = 1;
        }
        if (nd < 0) break; // back at the start
        d = nd;
      }
      if (pts.length >= 6) {
        const p = Float64Array.from(pts);
        const area = signedArea(p);
        contours.push({ pts: p, hole: area < 0, area });
      }
    }
  }
  return contours;
}

/** Shoelace area (y down: counter-clockwise on screen is positive here). @param {Float64Array} p */
export function signedArea(p) {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1];
  }
  return a / 2;
}

/**
 * Smooth a closed staircase outline: resample along the outline every ~0.5 px, Gaussian-smooth
 * (sigma px, wrapping around), then simplify (Douglas–Peucker, tol px).
 * @param {Float64Array} pts closed polygon (corners) @param {number} sigma @param {number} tol
 * @returns {Float64Array}
 */
export function smoothClosed(pts, sigma = 1.2, tol = 0.3) {
  const n = pts.length / 2;
  // 1. Resample: the midpoint of every unit step (that alone removes the staircase corners).
  /** @type {number[]} */
  const s = [];
  for (let i = 0; i < n; i++) {
    const ax = pts[2 * i], ay = pts[2 * i + 1];
    const j = (i + 1) % n;
    const bx = pts[2 * j], by = pts[2 * j + 1];
    const len = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let k = 0; k < len; k++) s.push(ax + ((bx - ax) * (k + 0.5)) / len, ay + ((by - ay) * (k + 0.5)) / len);
  }
  const m = s.length / 2;
  if (m < 4) return Float64Array.from(s);
  // 2. Gaussian smoothing around the loop (kernel in samples ≈ px).
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel = [];
  let ks = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    ks += v;
  }
  const sm = new Float64Array(2 * m);
  const rr = Math.min(r, Math.floor((m - 1) / 2));
  for (let i = 0; i < m; i++) {
    let x = 0, y = 0, wsum = 0;
    for (let k = -rr; k <= rr; k++) {
      const j = (((i + k) % m) + m) % m;
      const wv = kernel[k + r];
      x += s[2 * j] * wv;
      y += s[2 * j + 1] * wv;
      wsum += wv;
    }
    sm[2 * i] = x / wsum;
    sm[2 * i + 1] = y / wsum;
  }
  void ks;
  // 3. Simplify.
  return simplifyClosed(sm, tol);
}

/**
 * Douglas–Peucker on a closed loop (split at the two farthest-apart points).
 * @param {Float64Array} p @param {number} tol
 */
export function simplifyClosed(p, tol) {
  const n = p.length / 2;
  if (n <= 4) return p;
  // Anchor at point 0 and the point farthest from it.
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (p[2 * i] - p[0]) ** 2 + (p[2 * i + 1] - p[1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  dp(p, 0, far, tol, keep, n);
  dp(p, far, n, tol, keep, n);
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return Float64Array.from(out);
}

/** @param {Float64Array} p @param {number} a @param {number} b (exclusive end, may equal n = wrap to 0) @param {number} tol @param {Uint8Array} keep @param {number} n */
function dp(p, a, b, tol, keep, n) {
  const stack = [[a, b]];
  while (stack.length) {
    const [i0, i1] = /** @type {number[]} */ (stack.pop());
    if (i1 - i0 < 2) continue;
    const j1 = i1 % n;
    const ax = p[2 * i0], ay = p[2 * i0 + 1], bx = p[2 * j1], by = p[2 * j1 + 1];
    const dx = bx - ax, dy = by - ay;
    const L = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((p[2 * i] - ax) * dy - (p[2 * i + 1] - ay) * dx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best < 0) continue;
    keep[best] = 1;
    stack.push([i0, best], [best, i1]);
  }
}

/**
 * Closed smooth path through the points, as SVG path data (cubic Béziers). Each segment's
 * handles are a third of that segment's length, so a long straight edge next to short curved
 * bits never overshoots; turns sharper than ~50° stay sharp corners.
 * @param {Float64Array} p @param {(v: number) => string} f number formatter
 * @param {number} sx @param {number} ox @param {number} oy  x' = (x − ox) × sx
 */
export function closedPathData(p, f, sx, ox, oy) {
  const n = p.length / 2;
  if (n < 3) return '';
  const X = (/** @type {number} */ i) => (p[2 * (((i % n) + n) % n)] - ox) * sx;
  const Y = (/** @type {number} */ i) => (p[2 * (((i % n) + n) % n) + 1] - oy) * sx;
  // Unit tangents leaving (tOut) and arriving (tIn) at each point.
  const tOutX = new Float64Array(n), tOutY = new Float64Array(n), tInX = new Float64Array(n), tInY = new Float64Array(n);
  const COS_CORNER = Math.cos((50 * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    let ax = X(i) - X(i - 1), ay = Y(i) - Y(i - 1);
    let bx = X(i + 1) - X(i), by = Y(i + 1) - Y(i);
    const la = Math.hypot(ax, ay) || 1e-9, lb = Math.hypot(bx, by) || 1e-9;
    ax /= la; ay /= la; bx /= lb; by /= lb;
    if (ax * bx + ay * by < COS_CORNER) {
      // A corner: arrive along the incoming edge, leave along the outgoing one.
      tInX[i] = ax; tInY[i] = ay;
      tOutX[i] = bx; tOutY[i] = by;
    } else {
      let tx = ax + bx, ty = ay + by;
      const lt = Math.hypot(tx, ty) || 1e-9;
      tx /= lt; ty /= lt;
      tInX[i] = tOutX[i] = tx;
      tInY[i] = tOutY[i] = ty;
    }
  }
  const parts = [`M${f(X(0))} ${f(Y(0))}`];
  const maxBulge = 0.35 * sx; // a handle may pull the curve at most ~⅓ px off the outline
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = X(j) - X(i), dy = Y(j) - Y(i);
    const len = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / len, uy = dy / len;
    const L = len / 3;
    // Long straight edges stay straight: if a tangent would bulge the curve too far, aim the
    // handle along the segment instead.
    let ax = tOutX[i], ay = tOutY[i];
    if (L * Math.abs(ax * uy - ay * ux) > maxBulge) { ax = ux; ay = uy; }
    let bx = tInX[j], by = tInY[j];
    if (L * Math.abs(bx * uy - by * ux) > maxBulge) { bx = ux; by = uy; }
    const c1x = X(i) + ax * L, c1y = Y(i) + ay * L;
    const c2x = X(j) - bx * L, c2y = Y(j) - by * L;
    parts.push(`C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(X(j))} ${f(Y(j))}`);
  }
  parts.push('Z');
  return parts.join('');
}

/**
 * What each skeleton pixel is: 0 = not skeleton, 1 = an end, 2 = on a line, 3 = a fork. Read from
 * the number of separate neighbour runs around the pixel, so the steps of a diagonal or a curve
 * are not mistaken for forks.
 * @param {Uint8Array} skel @param {number} w @param {number} h
 */
export function skeletonKinds(skel, w, h) {
  const n = w * h;
  const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const at = (/** @type {number} */ x, /** @type {number} */ y) => x >= 0 && y >= 0 && x < w && y < h && skel[y * w + x] === 1;
  const kind = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!skel[p]) continue;
    const x = p % w, y = (p - x) / w;
    let runs = 0, count = 0;
    for (let i = 0; i < 8; i++) {
      const a = at(x + ring[i][0], y + ring[i][1]);
      const b = at(x + ring[(i + 1) % 8][0], y + ring[(i + 1) % 8][1]);
      if (a) count++;
      if (!a && b) runs++;
    }
    kind[p] = count === 0 ? 1 : runs <= 1 ? (count >= 7 ? 3 : 1) : runs === 2 ? 2 : 3;
  }
  return kind;
}

/**
 * Centre lines of a thin mask (floating details), as open polylines in px.
 * The skeleton is read as a graph: ends and forks are nodes (by the number of separate neighbour
 * runs around a pixel, so the steps of a diagonal or a curve are not mistaken for forks), each
 * run between two nodes becomes one path, and closed rings become one path that returns to its start.
 * @param {Uint8Array} skel 1-px skeleton @param {number} w @param {number} h
 * @param {number} minLen drop loose bits (spurs, specks) shorter than this (px)
 * @returns {Float64Array[]}
 */
export function skeletonPaths(skel, w, h, minLen = 4) {
  const n = w * h;
  // Neighbours in circular order: N, NE, E, SE, S, SW, W, NW; orthogonal ones are tried first when walking.
  const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const order = [0, 2, 4, 6, 1, 3, 5, 7];
  const at = (/** @type {number} */ x, /** @type {number} */ y) => x >= 0 && y >= 0 && x < w && y < h && skel[y * w + x] === 1;
  const kind = skeletonKinds(skel, w, h);
  const visited = new Uint8Array(n);
  /** @type {Float64Array[]} */
  const paths = [];
  const done = new Set(); // node–node steps already drawn
  const pt = (/** @type {number} */ p, /** @type {number[]} */ pts) => pts.push((p % w) + 0.5, Math.floor(p / w) + 0.5);
  /** Neighbours of p (skeleton), orthogonal first. @param {number} p */
  const around = (p) => {
    const x = p % w, y = (p - x) / w;
    /** @type {number[]} */
    const out = [];
    for (const i of order) {
      const xx = x + ring[i][0], yy = y + ring[i][1];
      if (at(xx, yy)) out.push(yy * w + xx);
    }
    return out;
  };
  /**
   * Walk from node `a` through `q` until the next node (or a dead end).
   * @param {number} a @param {number} q
   */
  const trace = (a, q) => {
    /** @type {number[]} */
    const pts = [];
    pt(a, pts);
    let prev = a, cur = q, endNode = -1;
    for (;;) {
      pt(cur, pts);
      if (kind[cur] !== 2) {
        endNode = cur;
        break;
      }
      visited[cur] = 1;
      let next = -1, node = -1;
      for (const r of around(cur)) {
        if (r === prev) continue;
        if (kind[r] !== 2) {
          if (node < 0 && !(r === a && pts.length <= 4)) node = r;
        } else if (!visited[r] && next < 0) next = r;
      }
      if (next < 0) next = node;
      if (next < 0) break;
      prev = cur;
      cur = next;
    }
    return { pts, endNode };
  };
  const keep = (/** @type {number[]} */ pts, /** @type {boolean} */ joined) => {
    if (joined || pts.length / 2 >= minLen) paths.push(smoothOpen(Float64Array.from(pts), 1.2, 0.3));
  };
  // Runs that start at an end or a fork.
  for (let a = 0; a < n; a++) {
    if (kind[a] === 0 || kind[a] === 2) continue;
    for (const q of around(a)) {
      if (kind[q] === 2) {
        if (visited[q]) continue;
        const { pts, endNode } = trace(a, q);
        // Fork-to-fork runs are kept however short (they join lines); loose ends must be long enough.
        keep(pts, kind[a] === 3 && endNode >= 0 && kind[endNode] === 3);
      } else {
        const key = a < q ? `${a},${q}` : `${q},${a}`;
        if (done.has(key)) continue;
        done.add(key);
        /** @type {number[]} */
        const pts = [];
        pt(a, pts);
        pt(q, pts);
        keep(pts, kind[a] === 3 && kind[q] === 3);
      }
    }
  }
  // What's left are closed rings: walk once around and back to the start.
  for (let p = 0; p < n; p++) {
    if (kind[p] !== 2 || visited[p]) continue;
    /** @type {number[]} */
    const pts = [];
    let prev = -1, cur = p;
    for (;;) {
      visited[cur] = 1;
      pt(cur, pts);
      let next = -1;
      for (const r of around(cur)) {
        if (r !== prev && kind[r] === 2 && !visited[r]) {
          next = r;
          break;
        }
      }
      if (next < 0) break;
      prev = cur;
      cur = next;
    }
    if (pts.length / 2 < minLen) continue;
    const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
    if (Math.abs(lx - pts[0]) <= 1 && Math.abs(ly - pts[1]) <= 1 && pts.length >= 8) {
      // A closed ring: smooth it as a loop, then return to the start so the line closes.
      const c = smoothClosed(Float64Array.from(pts), 1.2, 0.3);
      const closed = new Float64Array(c.length + 2);
      closed.set(c);
      closed[c.length] = c[0];
      closed[c.length + 1] = c[1];
      paths.push(closed);
    } else paths.push(smoothOpen(Float64Array.from(pts), 1.2, 0.3));
  }
  return paths;
}

/**
 * Smooth an open polyline (Gaussian along its length, ends pinned), then simplify.
 * @param {Float64Array} p @param {number} sigma @param {number} tol
 */
export function smoothOpen(p, sigma = 1.2, tol = 0.3) {
  // Resample about every px so the smoothing is even.
  /** @type {number[]} */
  const s = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let j = 1; j <= k; j++) s.push(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k);
  }
  const m = s.length / 2;
  if (m < 3) return Float64Array.from(s);
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const out = new Float64Array(2 * m);
  for (let i = 0; i < m; i++) {
    // Narrow the window near the ends so they stay where they are.
    const rr = Math.min(r, i, m - 1 - i);
    let x = 0, y = 0, ws = 0;
    for (let k = -rr; k <= rr; k++) {
      const wv = Math.exp(-(k * k) / (2 * sigma * sigma));
      x += s[2 * (i + k)] * wv;
      y += s[2 * (i + k) + 1] * wv;
      ws += wv;
    }
    out[2 * i] = x / ws;
    out[2 * i + 1] = y / ws;
  }
  return simplifyOpen(out, tol);
}

/** @param {Float64Array} p @param {number} tol */
export function simplifyOpen(p, tol) {
  const n = p.length / 2;
  if (n <= 2) return p;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i0, i1] = /** @type {number[]} */ (stack.pop());
    const ax = p[2 * i0], ay = p[2 * i0 + 1], bx = p[2 * i1], by = p[2 * i1 + 1];
    const dx = bx - ax, dy = by - ay;
    const L = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((p[2 * i] - ax) * dy - (p[2 * i + 1] - ay) * dx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best < 0) continue;
    keep[best] = 1;
    stack.push([i0, best], [best, i1]);
  }
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return Float64Array.from(out);
}
