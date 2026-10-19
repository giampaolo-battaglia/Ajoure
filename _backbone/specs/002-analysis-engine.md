# 002 — Analysis engine: instant scan, pins, Wood/Hole view

**Status:** built 2026-10-18 (awaiting Giampi's hands-on check)
**Date:** 2026-10-18

## What it is
The moment an image is dropped, Ajouré works out what is wood, what is a hole and what is outside the
piece, then pins every leak and island — before any setup. This is SPEC §5 step 2 and §8.1–8.6.

## Behavior
- Dropping/pasting/opening an image starts a scan in a background worker; the UI never freezes.
- The top bar shows "Scanning…", then a summary ("2 leaks · 1 island") or "No leaks or islands".
- Pins appear on the canvas (red = critical, blue = info) and as dots on the Navigator thumbnail.
- The Issues panel lists each issue in plain words with where it is ("Leak, lower left — Gap of 0.68 mm joins the wood to a hole").
- Clicking a pin or a list row glides to it at a comfortable zoom and highlights it; Esc or clicking empty canvas clears it.
- The Wood/Hole view (top bar) shows wood white, lines dark, holes grey, outside-the-piece checkered.
- White-on-black images are flipped automatically; filled (silhouette) art is treated as dark = wood.

## How it decides (short)
- Ink: Otsu threshold, dust (< 6 px) removed, pinholes (< 12 px of paper inside lines) filled.
- Regions: paper areas between lines; those touching the image edge are waste.
- Leak candidates, two detectors:
  1. stroke ends that stop within 0.6 mm of another line (SPEC leak limit);
  2. necks — places where paper is pinched below 1.0 mm between two areas of ≥ 8 mm² (curves that almost touch).
- All candidates are closed on a copy; wood/hole is guessed on that closed copy; a candidate is a leak only if
  closing it separates wood from hole (or from the outside). That's the Paint-bucket logic, automated.
- Wood/hole guess: each region picks the class that disagrees with its neighbours across lines,
  weighted by how much outline they share; wood-next-to-wood is cheap (overlapping petals),
  hole-next-to-hole is expensive; long thin regions (stroke insides) lean wood. Solved by annealing + ICM, deterministic.
- Islands: wood (lines + wood regions) not connected to the biggest piece; tiny ones (< 0.5 mm²) are "specks".
- Without a real size, the piece is assumed 50 mm wide (SPEC §5.5).

## Out of scope (later milestones)
- Fixing anything: Bucket, brushes, connector, separator, undo (milestone 4). The scan only reports.
- Fix tray, N/P navigation, Ignore, pin clustering (milestone 3).
- Thin wood, near-touch and speck-hole checks; Adjust panel; real size entry (milestone 6).
- Outer-cut confirmation UI, floating-detail finishing step, export (milestone 7).
- Low-confidence region outlines (comes with the Bucket).

## Done when
- Julie scans in about 1–2 s, with pins on both pockets Giampi sealed by hand and on the loose dot of the i.
- With the found leaks closed, the wood/hole map matches the hand-made result on ≥ 97% of pixels (measured: 99.9%).
- `npm test` passes (24 tests: engine on synthetic drawings, Julie acceptance, viewport).

## Measured on Julie (2026-10-18)
- 1024×1536, threshold 135, stroke 6 px, 7.8 px/mm (estimated), ~1.0 s in Node, ~1.6 s in the browser incl. decoding.
- Found: 2 leaks (0.68 mm and ~1.2 mm openings) + 1 island (the i dot, 11 mm²).
- Pixel agreement with the hand-made result: 97.7% as-is, 99.9% with the 2 leaks closed.
