# State — updated 2026-10-25

## Working
- Milestone 1 (spec 001): window, drop / paste / ⌘O / Julie sample, zoom & pan, Fit/100% buttons, Navigator, light/dark, tooltips, Settings (⌘,).
- Milestone 2 (spec 002): instant scan in a Web Worker — regions, waste, wood/hole guess, leaks (stroke-end gaps + necks), islands, specks; Wood/Hole view; issue markers.
- Milestone 3 (spec 003): fix tray, N/P/Enter/I/Esc, resolved/ignored markers, pin clustering.
- Milestone 4 (spec 004): Bucket (tint or Water preview), Wood/Hole/Revert brushes, Connector (drag midpoint to curve), Separator, undo/redo + History popover, re-check after every edit; Navigator shows paint.
- Milestone 5 (spec 005): Flow test — T / button, Flow (animated) or Quick; holes fill blue, leaks break at half time with amber ripples, escaped water amber; ✓ on holes that held.
- Milestone 6 (spec 006): Adjust panel (Auto, Invert, Brightness, Contrast, Threshold, Smooth, Sharpen, Despeckle, Line weight, hold \\ to compare, issue deltas); real width entry; material picker (4 starting profiles); Thin wood (Thicken), Near-touch, Speck hole (Fill) checks with "est" badges.
- Structure checks (leaks, islands) are scale-free: same result whatever width/material.
- Open / Save anywhere: Open and Save buttons in the top bar (⌘O / ⌘S, also while typing in a box). Save writes a `.ajoure` project (image + edits + Bucket clicks + adjustments + width + material + ignored issues); opening it restores everything (history starts fresh). Dot by the name = unsaved changes; "Save changes?" sheet before replacing unsaved work; warning on closing the tab.
- Brush size bar on the canvas for Wood / Hole / Revert / Connector / Separator: − / slider / + / size in mm (type a value) / Default.
- Second real image: `fixtures/paris-input.png` ("Julie je t'aime", Eiffel tower) — 10 leaks + the sun's 2 openings → 12 × Enter → clean; tests in `tests/paris.test.mjs`.
- "Open outline" hints (info): a line that stops short of the next one (≤ 3 mm) where closing would make a piece of its own ≥ 100 mm² (Paris: the sun). Quick fix: Close outline.
- Smart Bucket: fills the piece you click, sealing its narrow passages (< 1 mm) to the rest of its area with wood in the same undo step (Paris: sky → hole without flipping the frame; plain Bucket gave 21 islands).
- Julie: 2 leaks · 1 island · 6 near-touches (est.) → 3 × Enter → "✓ No leaks or islands"; Flow test then says every hole holds.
- `npm test`: 68 tests (… plus project files, Bucket pieces, Paris).

- Milestone 7 (spec 007), first part: **Export SVG** (⇧⌘E) for XCS — mm size, closed smooth cut paths (holes first), score lines for floating details (or engrave / drop), warnings for open issues and the size estimate; **Cut** view shows the piece in basswood from the same geometry.

- Spec 008: **Plan view** (what stays / falls out; what the laser cuts, scores, engraves) with legend, click-to-pick-out and hover explanations; **Engrave tool** (G): click an area to burn it solid (outline included), click a line to switch score ↔ engrave; engraving in the Cut view and the SVG. Score lines now come out whole (graph-based skeleton tracing).
- Save in place + versions inside the `.ajoure` file (History → Saved versions), Save as… (⇧⌘S). Eraser (E) turns lines back into paper; Hole brush is K; Bucket on hole paint makes it wood.
- The `.ajoure` file keeps the full step history (up to 500 steps, with times; settings changes included) and saved-version markers; gzip-compressed (format 3). History → click any step, even after reopening.
- `npm test`: 77 tests.

## In flight
- Milestones 4–6 built; waiting for Giampi's hands-on check (Flow test feel, Adjust sliders, material values, near-touch usefulness).

## Next up
1. Giampi tries Julie + 2–3 other AI images end to end (Adjust → fix → Flow test); note what's slow or wrong.
2. Open the exported SVG in XCS: check the size, that red = cut and blue = score map cleanly, and the cut order.
   Then the rest of milestone 7: confirm the outer cut (per-detail Score / Engrave is done via the Engrave tool).
   Also check in XCS that the engrave fills (fill-rule even-odd) come through as filled shapes.
3. Milestone 8 — Real cut: Julie in 3 mm basswood on the M2; done when it comes out as one intact piece. Calibrate the material values from it.

## Known broken
- Re-check is a full re-analysis (~1.3 s on Julie with the mm checks; more on big images); SPEC target < 300 ms → incremental analysis later.
- Edits and adjustments live only until the page reloads (project save is milestone 7).
- Material values are guesses until calibrated with test cuts.
- Near-touch has no quick fix (a hole stamp would cut into the lines) — tools only.
- Wood/hole guess tuned on Julie only; the Bucket is the safety net.
- Flow test computes in ~0.5 s before the animation starts (no progress cue yet).

## Notes from Paris (2026-10-22)
- Mixed drawings (outlined shapes + single lines) are where pieces merge: single lines stop short of their neighbours; until those are closed, a merged area gets one answer.
- Ajouré reads the Paris sky around the sun as wood and the clouds as holes (sturdier: otherwise every cloud line is a 0.75 mm strut). Both are valid; the Bucket decides.

## Open questions
- Julie's i dot: glued, bridged, or fell out? (Decides whether Remove or Connector should be the island quick fix.)
- Julie's real width in mm? (Turns the "est" badges off and makes the near-touch numbers exact.)
