// The edits document: strokes, Bucket clicks, undo/redo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditDoc, MAX_UNDO } from '../src/app/doc.js';
import { EDIT_WOOD, EDIT_HOLE } from '../src/engine/analyze.js';

test('a stroke records one undo step and undo/redo restore pixels exactly', () => {
  const d = new EditDoc(50, 50);
  d.beginStroke('Wood brush');
  d.segment(10, 10, 40, 10, 2, EDIT_WOOD);
  assert.equal(d.endStroke(), true);
  const after = Uint8Array.from(d.edits);
  assert.equal(d.edits[10 * 50 + 25], EDIT_WOOD);
  assert.equal(d.undo(), 'Wood brush');
  assert.ok(d.edits.every((v) => v === 0));
  assert.equal(d.redo(), 'Wood brush');
  assert.deepEqual(d.edits, after);
});

test('an empty stroke is not recorded', () => {
  const d = new EditDoc(20, 20);
  d.beginStroke('Hole brush');
  assert.equal(d.endStroke(), false);
  assert.equal(d.canUndo, false);
});

test('painting over identical pixels is not recorded', () => {
  const d = new EditDoc(20, 20);
  d.beginStroke('a');
  d.stamp(10, 10, 2, EDIT_HOLE);
  d.endStroke();
  d.beginStroke('b');
  d.stamp(10, 10, 2, EDIT_HOLE);
  assert.equal(d.endStroke(), false);
  assert.equal(d.undoStack.length, 1);
});

test('Bucket clicks are undoable and a new edit clears redo', () => {
  const d = new EditDoc(20, 20);
  d.addSeed({ x: 5, y: 5, cls: 1 }, 'Bucket: wood');
  d.addSeed({ x: 6, y: 6, cls: 2 }, 'Bucket: hole');
  d.undo();
  assert.equal(d.seeds.length, 1);
  assert.equal(d.canRedo, true);
  d.beginStroke('Wood brush');
  d.stamp(3, 3, 1, EDIT_WOOD);
  d.endStroke();
  assert.equal(d.canRedo, false);
  d.undo();
  d.undo();
  assert.equal(d.seeds.length, 0);
});

test('history keeps at most MAX_UNDO steps; the dropped ones become the base', () => {
  const d = new EditDoc(30, 30);
  for (let i = 0; i < MAX_UNDO + 20; i++) d.addSeed({ x: 1, y: 1, cls: 1 }, `s${i}`);
  assert.equal(d.undoStack.length, MAX_UNDO);
  assert.equal(d.baseId, 20);
  assert.ok(d.hasStep(20) && !d.hasStep(19));
});

test('settings changes are steps; a slider drag merges into one; undo brings the old settings back', () => {
  const d = new EditDoc(30, 30);
  const s0 = { adjust: { brightness: 0 }, widthMm: null, material: 'basswood' };
  d.settings = s0;
  d.changeSettings({ ...s0, adjust: { brightness: 10 } }, 'Brightness +10', 'adj:brightness');
  d.changeSettings({ ...s0, adjust: { brightness: 25 } }, 'Brightness +25', 'adj:brightness');
  assert.equal(d.undoStack.length, 1);
  assert.equal(d.undoStack[0].label, 'Brightness +25');
  d.changeSettings({ ...d.settings, widthMm: 52 }, 'Width 52 mm');
  assert.equal(d.undoStack.length, 2);
  d.undo();
  assert.equal(d.settings.widthMm, null);
  assert.equal(/** @type {any} */ (d.settings.adjust).brightness, 25);
  d.undo();
  assert.equal(/** @type {any} */ (d.settings.adjust).brightness, 0);
  d.redo();
  d.redo();
  assert.equal(d.settings.widthMm, 52);
  // No change, no step.
  d.changeSettings({ ...d.settings }, 'nothing');
  assert.equal(d.undoStack.length, 2);
});

test('listeners hear about every change with the changed rect', () => {
  const d = new EditDoc(30, 30);
  /** @type {any[]} */
  const seen = [];
  d.onChange((rect, label) => seen.push([rect, label]));
  d.beginStroke('Wood brush');
  d.stamp(15, 15, 3, EDIT_WOOD);
  d.endStroke();
  d.undo();
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0][0], [12, 12, 7, 7]);
});
