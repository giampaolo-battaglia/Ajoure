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

test('the whole step history round-trips inside the (compressed) project, and you can go back in time', async () => {
  const { encodeProject, decodeProject } = await import('../src/app/project.js');
  const { EditDoc } = await import('../src/app/doc.js');
  const w = 60, h = 40;
  const d = new EditDoc(w, h);
  d.settings = { adjust: { brightness: 0 }, widthMm: null, material: '3 mm basswood' };
  d.beginStroke('Wood brush'); d.segment(5, 5, 30, 5, 2, 1); d.endStroke();
  d.addSeed({ x: 10, y: 20, cls: 1 }, 'Bucket: wood');
  d.changeSettings({ ...d.settings, widthMm: 52 }, 'Width 52 mm');
  d.beginStroke('Eraser'); d.segment(10, 5, 14, 5, 2, 3); d.endStroke({ x: 12, y: 30, cls: 3 });
  d.beginStroke('Hole brush'); d.segment(40, 30, 50, 30, 1, 2); d.endStroke();
  d.undo(); // one step on the redo stack
  const savedAt = d.stepId;
  const png = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' });
  const blob = await encodeProject({
    name: 'Bat', image: png, w, h, edits: d.edits, seeds: d.seeds, adjust: /** @type {any} */ (d.settings.adjust), widthMm: 52, material: '3 mm basswood', ignored: [],
    versions: [{ savedAt: '2026-10-25T10:00:00Z', label: 'No leaks', stepId: savedAt }],
    history: { undo: d.undoStack, redo: d.redoStack, baseId: d.baseId, nextId: d.nextId },
  });
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  assert.deepEqual([...head], [0x1f, 0x8b], 'gzip');
  const p = await decodeProject(blob);
  assert.equal(p.versions?.[0].stepId, savedAt);
  const hist = /** @type {NonNullable<typeof p.history>} */ (p.history);
  assert.deepEqual(hist.undo.map((q) => q.label), d.undoStack.map((q) => q.label));
  assert.deepEqual(hist.redo.map((q) => q.label), ['Hole brush']);
  // A fresh document with the saved state + history behaves exactly like the original.
  const r = new EditDoc(w, h);
  r.edits.set(p.edits);
  r.seeds = p.seeds;
  r.settings = { adjust: p.adjust, widthMm: p.widthMm, material: p.material };
  r.undoStack = hist.undo; r.redoStack = hist.redo; r.baseId = hist.baseId; r.nextId = hist.nextId;
  /** @param {EditDoc} x */
  const state = (x) => JSON.stringify([Array.from(x.edits), x.seeds, x.settings.widthMm]);
  // Replay both back to the start, step by step.
  while (d.canUndo || r.canUndo) {
    assert.equal(state(r), state(d));
    d.undo(); r.undo();
  }
  assert.equal(state(r), state(d));
  assert.ok(r.edits.every((v) => v === 0) && r.seeds.length === 0 && r.settings.widthMm === null, 'back to the opened image');
  while (d.canRedo) { d.redo(); r.redo(); assert.equal(state(r), state(d)); }
});

test('older files open: plain JSON, version snapshots from before, no history', async () => {
  const { decodeProject } = await import('../src/app/project.js');
  const w = 40, h = 30;
  const e1 = new Uint8Array(w * h); e1[5] = 1;
  const pack = (/** @type {Uint8Array} */ e) => toBase64(rle(e));
  const base = { format: 'ajoure-project', name: 'Bat', w, h, image: 'data:image/png;base64,iVBORw0KGgo=', seeds: [], adjust: {}, widthMm: 52, material: '3 mm basswood', ignored: [] };
  const v2 = { ...base, version: 2, edits: pack(e1), versions: [{ savedAt: '2026-10-24T10:00:00Z', label: '5 leaks', edits: pack(e1), seeds: [], adjust: {}, widthMm: null, material: '3 mm basswood', ignored: [] }] };
  const p = await decodeProject(new Blob([JSON.stringify(v2)]));
  assert.deepEqual(p.versions?.[0].snapshot?.edits, e1);
  assert.equal(p.history, undefined);
  const old = await decodeProject(new Blob([JSON.stringify({ ...base, version: 1, edits: pack(e1) })]));
  assert.deepEqual(old.versions, []);
  await assert.rejects(decodeProject(new Blob([JSON.stringify({ ...base, version: 4, edits: '' })])), /newer/);
});
