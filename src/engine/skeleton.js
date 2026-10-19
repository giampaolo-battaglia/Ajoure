// @ts-check
// Line skeletons (Zhang–Suen thinning) and stroke endpoints. Pure, no DOM.

/**
 * Thin a binary mask to 1-px-wide centerlines.
 * @param {Uint8Array} mask @param {number} w @param {number} h
 * @returns {Uint8Array}
 */
export function thin(mask, w, h) {
  const s = new Uint8Array(mask.length);
  /** @type {number[]} */
  let list = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (mask[p]) {
        s[p] = 1;
        list.push(p);
      }
    }
  }
  let changed = true;
  /** @type {number[]} */
  const del = [];
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (const p of list) {
        if (!s[p]) continue;
        const p2 = s[p - w], p3 = s[p - w + 1], p4 = s[p + 1], p5 = s[p + w + 1];
        const p6 = s[p + w], p7 = s[p + w - 1], p8 = s[p - 1], p9 = s[p - w - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          (+(!p2 && p3)) + (+(!p3 && p4)) + (+(!p4 && p5)) + (+(!p5 && p6)) +
          (+(!p6 && p7)) + (+(!p7 && p8)) + (+(!p8 && p9)) + (+(!p9 && p2));
        if (a !== 1) continue;
        if (step === 0) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
        } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
        del.push(p);
      }
      for (const p of del) s[p] = 0;
      if (del.length) changed = true;
    }
    list = list.filter((p) => s[p] === 1);
  }
  return s;
}

/** Offsets of the 8 neighbours in circular order (N, NE, E, SE, S, SW, W, NW). @param {number} w */
function ring(w) {
  return [-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1];
}

/**
 * Crossing number (0→1 transitions around the pixel) and neighbour count.
 * @param {Uint8Array} s @param {number} p @param {number[]} R
 */
function crossing(s, p, R) {
  let cn = 0;
  let b = 0;
  for (let k = 0; k < 8; k++) {
    const a = s[p + R[k]];
    const c = s[p + R[(k + 1) % 8]];
    b += a;
    if (!a && c) cn++;
  }
  return { cn, b };
}

/**
 * Real stroke ends: skeleton tips that aren't tiny spurs or specks.
 * Walks up to `minLen` px from each tip; if it reaches a junction or dies out first, it's ignored.
 * @param {Uint8Array} s skeleton @param {number} w @param {number} h @param {number} minLen
 * @returns {{x:number, y:number, dx:number, dy:number}[]}  dx/dy point outward (direction the stroke was heading)
 */
export function strokeEnds(s, w, h, minLen) {
  const R = ring(w);
  /** @type {{x:number, y:number, dx:number, dy:number}[]} */
  const ends = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!s[p]) continue;
      const { cn, b } = crossing(s, p, R);
      if (cn !== 1 || b > 2 || b === 0) continue;
      // Walk inward along the stroke.
      const seen = new Set([p]);
      let cur = p;
      let ok = true;
      let steps = 0;
      for (; steps < minLen; steps++) {
        let next = -1;
        for (let k = 0; k < 8; k++) {
          const q = cur + R[k];
          if (s[q] && !seen.has(q)) {
            // prefer 4-neighbours (even k) to follow the line smoothly
            if (next === -1 || k % 2 === 0) next = q;
            if (k % 2 === 0) break;
          }
        }
        if (next === -1) {
          ok = false; // tiny fragment
          break;
        }
        const qx = next % w;
        const qy = (next - qx) / w;
        if (qx <= 0 || qy <= 0 || qx >= w - 1 || qy >= h - 1) break;
        if (steps > 0 && crossing(s, next, R).cn >= 3) {
          ok = false; // spur off a junction
          break;
        }
        seen.add(next);
        cur = next;
      }
      if (!ok) continue;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const len = Math.hypot(x - cx, y - cy) || 1;
      ends.push({ x, y, dx: (x - cx) / len, dy: (y - cy) / len });
    }
  }
  return ends;
}
