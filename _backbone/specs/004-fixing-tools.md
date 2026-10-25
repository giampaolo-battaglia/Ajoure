# 004 — Fixing tools, edits and undo

**Status:** built 2026-10-21 (awaiting Giampi's hands-on check)
**Date:** 2026-10-21

## What it is
The Paint-style tools from SPEC §6.5, working on a separate **edits layer** so the original image is never changed,
with every edit re-checked automatically.

## Behavior
- **Bucket (B):** click a region to swap wood ↔ hole (⇧ forces wood, ⌥ forces hole). Hovering tints the whole region
  first, so a leak shows as the tint spilling into the neighbour. Picking the Bucket switches to the Wood/Hole view.
- **Wood brush (W):** paints material (line/wood). Default size = minimum wood width (1.0 mm).
- **Hole brush (E):** paints a cut (hole), even across lines. Default size = minimum hole width (0.5 mm).
- **Revert brush (R):** wipes edits under the brush back to the original.
- **Connector (C):** click A, then B → a wood bridge 1.2 × minimum wood width, rounded ends. Esc cancels.
- **Separator (X):** press-drag-release across a junction → a hole cut of minimum hole width.
- `[` / `]` resize the brush; the cursor shows the brush at true size; ⇧-click draws a straight stroke from the last point.
- Undo / redo: ⌘Z / ⇧⌘Z (also two buttons by the file name), 100 steps, covering strokes, bucket clicks and quick fixes.
- After each edit the image is re-scanned in the background (pins, islands, Wood/Hole view update in ~1 s; strokes show instantly).

## Added 2026-10-22
- Connector: after placing a bridge, drag the round handle at its middle to curve it (replaces the straight one, one undo step).
- **History** popover (clock button next to undo/redo): every step listed; click one to jump back or forward.
- The Navigator thumbnail shows your paint (and the adjusted trace) in Design view.

## Out of scope
- Decorative bridges (v3).
- Incremental (dirty-rect) re-analysis — full re-scan for now; target < 300 ms comes later.
- Saving edits to a project file (milestone 7); edits live until the page reloads.

## Done when
- On Julie, with only these tools, the scan reaches 0 leaks / 0 islands and the Wood/Hole view matches the hand-made result.
- Undo/redo walks back and forth through every edit without drift.
