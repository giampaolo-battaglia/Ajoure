// Project files: the edits layer survives a round trip exactly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rle, unrle, toBase64, fromBase64, isProjectName } from '../src/app/project.js';

test('run-length encoding round-trips an edits layer and stays small', () => {
  const a = new Uint8Array(1024 * 1536);
  for (let i = 5000; i < 5400; i++) a[i] = 1;
  for (let i = 900000; i < 900050; i++) a[i] = 2;
  const r = rle(a);
  assert.ok(r.length < 100);
  assert.deepEqual(unrle(fromBase64(toBase64(r)), a.length), a);
});

test('empty and full layers', () => {
  for (const v of [0, 1]) {
    const a = new Uint8Array(1000).fill(v);
    assert.deepEqual(unrle(rle(a), 1000), a);
  }
});

test('project file names', () => {
  assert.ok(isProjectName('Julie.ajoure'));
  assert.ok(isProjectName('JULIE.AJOURE'));
  assert.ok(!isProjectName('julie.png'));
});
