# 007 — SVG export and Cut preview

**Status:** built 2026-10-23 (awaiting a real cut on the M2)
**Date:** 2026-10-23

## What it is
SPEC §9 and §5 steps 7–10: the cut file for xTool Creative Space, and a preview of the piece as it comes out of the laser.

## Behavior
- **Export SVG** (button, ⇧⌘E) opens a sheet: size (with Change…), material, what will be cut ("49 holes + the outline · 2.43 m of cutting · 166 score lines"), and a **Floating details** choice: **Score** (default) · Engrave · Drop (remembered).
- Warnings before export: open leaks / loose pieces ("Review" jumps to the first), and the 50 mm estimate if no real width was entered. Export is still allowed.
- The SVG: width/height in **mm** + viewBox in mm (XCS imports at real size), 1 mm margin; one closed path per outline, **holes first, then the outline** (the piece stays put while cutting); colours: **red #FF0000 = cut**, **blue #0000FF = score** (open centre lines), **black fill = engrave**. Title = file name; desc = size, material and counts.
- **Cut** view (top bar): basswood grain, see-through holes, burnt kerf edges (material kerf), score/engrave marks — drawn from the exact export geometry. Picking an editing tool goes back to Design.
- Chrome asks where to save; Safari saves to Downloads.

## How
- `src/engine/trace.js`: outlines by crack-following along pixel edges (always closed, never duplicated; wood 4-connected), resample + Gaussian smoothing + Douglas–Peucker, Béziers with handles ⅓ of the segment and a ⅓-px bulge limit (straight edges stay straight, sharp turns stay corners). Skeleton → open centre lines for scores.
- `src/engine/export.js`: wood = lines + wood areas; floating details = centre-line pixels with no hole/outside within their half-width (+ margin), grown along the line (hysteresis) so stamens aren't chopped up.
- Runs in the helper worker; Julie exports in ~0.3 s.

## Out of scope (next)
- Choosing Score / Engrave / Drop per detail (one choice for all for now), confirming the outer cut, kerf compensation, project-level export settings.

## Done when
- The SVG opens in XCS at the right size, closed paths only, no duplicates (SPEC §12 #8) — checked in tests; to confirm in XCS.
- A real cut of Julie in 3 mm basswood comes out as one piece (milestone 8).
