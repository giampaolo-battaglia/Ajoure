// Flow test engine: water from every hole, escaping only through flagged leaks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowTest, FLOW_ESCAPED, FLOW_CALM } from '../src/engine/flow.js';
import { PX_WOOD, PX_HOLE, PX_LINE } from '../src/engine/analyze.js';

/**
 * A 40×21 sheet split by a vertical line at x = 20: a hole on the left, wood on the right.
 * With `gap`, the line has a hole at y = 10 (a leak), so both sides are one region.
 * @param {boolean} gap
 */
function sheet(gap) {
  const w = 40, h = 21, n = w * h;
  const labels = new Int32Array(n);
  const fixed = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const line = x === 20 && !(gap && y === 10);
      labels[p] = line ? 0 : gap ? 1 : x < 20 ? 1 : 2;
      fixed[p] = x === 20 ? PX_LINE : x < 20 ? PX_HOLE : PX_WOOD;
    }
  }
  // Inside the frame only: no outside water in this test.
  return { labels, w, h, classMap: fixed, fixedClassMap: fixed };
}

test('water from a hole escapes through a flagged leak into the wood', () => {
  const s = sheet(true);
  const f = flowTest({ ...s, leaks: [{ x: 20, y: 10, ax: 20, ay: 9, bx: 20, by: 11 }] });
  let esc = 0, calm = 0;
  for (let i = 0; i < f.count; i++) {
    const x = f.order[i] % s.w;
    if (f.kind[i] === FLOW_ESCAPED) {
      esc++;
      assert.ok(x >= 18, 'escaped water is on the wood side (or in the 3-px closing stroke)');
    } else if (f.kind[i] === FLOW_CALM) {
      calm++;
      assert.ok(x < 20);
    }
  }
  assert.ok(esc > 300 && calm > 300);
  assert.equal(f.leaking, 1);
  assert.equal(f.gaps.length, 1);
  // Holes fill first; the escape comes after.
  let lastCalm = 0, firstEsc = Infinity;
  for (let i = 0; i < f.count; i++) {
    if (f.kind[i] === FLOW_CALM) lastCalm = Math.max(lastCalm, f.time[i]);
    else firstEsc = Math.min(firstEsc, f.time[i]);
  }
  assert.ok(firstEsc >= 0.45 * 65535 && lastCalm <= 0.6 * 65535);
});

test('a sealed hole holds: no escape, one check', () => {
  const s = sheet(false);
  const f = flowTest({ ...s, leaks: [] });
  for (let i = 0; i < f.count; i++) assert.equal(f.kind[i], FLOW_CALM);
  assert.equal(f.leaking, 0);
  assert.equal(f.sealed.length, 1);
  assert.equal(f.gaps.length, 0);
});

test('time order is monotonic', () => {
  const s = sheet(true);
  const f = flowTest({ ...s, leaks: [{ x: 20, y: 10, ax: 20, ay: 9, bx: 20, by: 11 }] });
  for (let i = 1; i < f.count; i++) assert.ok(f.time[i] >= f.time[i - 1]);
});
