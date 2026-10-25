# 006 — Adjust and measurements

**Status:** built 2026-10-22 (awaiting Giampi's hands-on check)
**Date:** 2026-10-22

## What it is
SPEC §5.2 Adjust panel, §5.5 piece width, §4 material and the dimension checks in millimetres.

## Behavior
- **Adjust** panel (sidebar): Auto (auto threshold + light despeckle), Invert, Reset; Brightness, Contrast, Threshold
  (shows "Auto · 135" until moved); under **More**: Smooth, Sharpen, Despeckle, Line weight (−3…+3 px).
  Every change re-checks (~1 s) and shows the change in issues ("Leaks 2 → 4 · Near-touch 6 → 3").
  Double-click a slider's label to reset it. Design view shows the adjusted black & white trace; hold **\\** to
  compare with the original. Edits stay (adjustments never rotate/crop, so pixels stay aligned).
- **Width** chip: enter the real width in mm (finished piece, outside edge to outside edge); "est" badge disappears.
  "Use the estimate (50 mm)" goes back.
- **Material** chip: 3 mm basswood (default), 1.5 mm basswood, 3 mm birch plywood, 3 mm acrylic — starting values,
  to calibrate with test cuts. Sets the minimum wood/hole widths, brush sizes and the mm checks. Remembered.
- New issues (amber = warning, blue = info, "est" badge while the width is estimated):
  - **Thin wood** — wood narrower than the material's minimum; quick fix **Thicken** (wood paint along the spot).
  - **Near-touch** — a hole channel narrower than the minimum hole width; tools only (Hole brush, Separator, Revert).
  - **Speck hole** — a hole smaller than the minimum area; quick fix **Fill**.
- Leaks and islands never change with width or material (structure checks use the fixed 50 mm reference scale).

## Out of scope
- Levels with histogram, Rotate/Flip/Crop (would misalign the edits layer), an adjustment stack you can reorder.

## Done when
- Julie at the estimate: 2 leaks, 1 island, a handful of near-touches (real ~0.45 mm channels), no corner noise. ✓
- Entering any width keeps 2 leaks / 1 island. ✓
