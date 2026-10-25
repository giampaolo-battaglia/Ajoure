# 005 — Flow test

**Status:** built 2026-10-22 (awaiting Giampi's hands-on check)
**Date:** 2026-10-22

## What it is
SPEC §6.6, "does it hold water?": pour water into every hole at once and watch where it escapes.

## Behavior
- **Flow test** button or **T**: tests every hole. Press again (or Esc when done) to put the water away.
- Caret next to the button: **Flow** (animated, default) or **Quick** (everything at once, 150 ms fade). Remembered.
  "Reduce motion" always uses Quick.
- Flow (~2.8 s): every hole fills in parallel from its deepest point (blue, deeper-blue leading edge, liquid wobble).
  At the halfway mark the leaks break: each gap flashes with amber ripples, and the escaped water floods out in
  **amber** — what that leak would take with it (on Julie: the frame, vines and letters).
- Water from outside the piece is invisible unless it gets in (shown amber too).
- Holes that held get a tiny ✓ for a moment (only where big enough on screen).
- Click or Esc during the pour skips to the end. Any edit or re-check clears the water.
- A toast sums it up: "Water escapes through 2 gaps…" or "Every hole holds water ✓ (49 tested)".

## How
- `src/engine/flow.js` (pure, in the water worker): "sealed" = today's drawing with only the flagged leaks closed,
  each sealed area taking the class the scan expects for it; multi-source geodesic pour (5/7/11 steps) through the
  open drawing; escaped = water standing where the sealed piece has another class.
- `FlowReveal` in `src/app/water.js` paints only newly reached pixels each frame.

## Out of scope
- Bucket + T-click to test one region (the Water bucket preview covers it), sound, auto-run on import (pins do that job).

## Done when
- On Julie: water escapes through both pinned gaps before fixing; after the 3 quick fixes every hole holds. ✓
