# 008 — Plan view and the Engrave tool

**Status:** built 2026-10-25 (awaiting Giampi's hands-on check)
**Date:** 2026-10-25

## Why
Giampi, looking at a Halloween bookmark in Wood/Hole: "I'm confused" about cut vs score vs engrave vs "design",
and "when it's engraved, I want to paint the whole shape" (the bat filled in, not just its outline).
The Wood/Hole view answers *what falls out*; nothing showed *what the laser does*.

## The model (shown to the user in these words)
- The wood: **Stays** or **Falls out** (holes and everything outside the outline).
- The laser: **Cut** (right through: every edge between wood and a hole — automatic), **Score** (thin surface line),
  **Engrave** (filled surface burn: a whole shape, or a line at full width).
- An area gets one of three paints: wood, hole, or **engraved** (stays, surface burned).
- A line with wood on both sides is scored, engraved or left out ("Lines on wood": the default for all,
  switchable per line). A line around an engraved area is part of that shape.
- "Design" is just the input drawing.

## Behavior
- **Plan** view (top bar, between Wood/Hole and Cut): wood flat beige with a soft shadow, falling-out parts hatched,
  red cut lines, blue score lines, dark-brown engraving. Lines keep a constant on-screen width.
- **Legend** (floating, top of the canvas, Plan view only): Stays · Falls out | Cut · Score · Engrave | Lines on wood:
  Score / Engrave / None. Clicking a legend item picks that layer out (the rest dims); again to clear.
  "Lines on wood" is the same setting as the export sheet's (renamed there from "Floating details", Drop → None).
- **Hover tip** in Plan view: what's under the cursor in plain words ("Falls out — cut out along its edge and removed"),
  plus, with the Engrave tool, what a click would do ("Click to engrave this whole shape").
- **Engrave tool** (G, flame icon; switches to the Plan view):
  - click an area → the whole area burns solid, outline included (a hole becomes engraved wood); click again → plain wood;
  - click a line with wood on both sides → score ↔ engrave for that stroke (fork to fork);
  - click a cut edge → explains it can't be engraved; a line of an engraved shape → "click inside the shape".
  - Hover shows the area in a burnt tint. Narrow joins are sealed like the Bucket. Undoable; saved in the project.
- Wood/Hole view tints engraved areas tan. Cut view shows engraved areas burnt. Bucket on an engraved area clears it.
- Export: engraved areas + engraved lines in the black-fill `engrave` group, each kind one compound path with
  `fill-rule="evenodd"` (a ring burns as a ring). Export sheet counts "engraved: 2 areas + 1 line".

## How
- Seeds gain classes: `SEED_ENGRAVE` (3; area → wood + `regionEngraved`), `SEED_LINE_SCORE` (4), `SEED_LINE_ENGRAVE` (5)
  (line seeds don't touch the analysis; export reads them). Latest click per area wins.
- `export.js`: engraved area = its paper + ink within reach (`toEng ≤ max(1.5·stroke, toOther + stroke) + 1`), so the
  outline joins and a branch leaving the shape stops after ~half a stroke. Floating lines are split into strokes at
  forks (crossing number); each stroke takes its line mark (nearest within ~1.5 strokes) or the default.
- `trace.js`: `skeletonKinds` (end / line / fork by neighbour runs) and a graph-based `skeletonPaths` — a curve's
  staircase is no longer read as forks, so score lines come out whole (Julie 166 → 130 lines; rings close).
- Plan rendering and hit-testing use the export's preview paths (+ `outline` = outer edges, to tell holes from outside).

## Test image
`fixtures/halloween-input.png` — rebuilt from Giampi's Wood/Hole screenshot (cropped at the bottom; a stand-in until
the original is in the folder).

## Out of scope (next)
- Per-line marks are stored by position; if the drawing changes a lot, a mark may land on another stroke.
- Engrave power/speed per material (XCS sets it by colour layer for now).
