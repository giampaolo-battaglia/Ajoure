# State — updated 2026-10-19

## Working
- Milestone 1 (spec 001): window layout, drop / paste / ⌘O / Julie sample, zoom & pan (trackpad, mouse, Space-drag, Zoom tool, ⌘ and ⌃⌘ shortcuts, bare +/−), Fit/100% buttons, Navigator, light/dark, tooltips.
- Milestone 2 (spec 002): instant scan in a Web Worker on every image — ink threshold, regions, waste, wood/hole guess, leaks (stroke-end gaps + necks), islands, specks.
- Scan UI: top-bar summary ("2 leaks · 1 island"), pins on canvas + Navigator dots, Issues list in plain words, click pin/row → glide & highlight (Esc clears), Wood/Hole view.
- Julie: 2 leaks (the two pockets sealed by hand) + 1 island (the i dot); 99.9% pixel match with the hand-made result once leaks are closed; ~0.7–1 s in Node, ~1.6 s in the browser.
- `npm test`: 24 tests (viewport, engine on synthetic drawings, Julie acceptance). `node tools/scan.mjs <image>` prints a scan and writes out/scan.png.
- `Start Ajoure.command` double-click launcher.

## In flight
- Milestone 2 built; waiting for Giampi's hands-on check on his own images.

## Next up
1. Giampi tries the scan on Julie and 2–3 other AI images; collect misses (false leaks, wrong wood/hole guesses).
2. Milestone 3 — Issues & focus: Fix tray, N/P next/previous, Ignore, resolved/ignored pin states, pin clustering when zoomed out.
3. Milestone 4 — Fixing tools: Bucket (hover preview shows leak spill), wood/hole brush, connector, separator, revert, undo/redo, live re-scan.
4. Milestone 5 — Flow test (Quick, then animated water).
5. Milestone 6 — Adjust panel + thin wood / near-touch / speck-hole checks + real size.
6. Milestone 7 — Floating details, outer-cut confirm, cut preview, SVG export for XCS, project save; then a real cut.

## Known broken
- Wood/hole guess is tuned on one image (Julie); expect misses on other styles — the Bucket (milestone 4) is the safety net.
- Only mm-estimated scale (50 mm wide) until size entry exists; leak widths shown in mm are estimates.
- Filled (silhouette) art: treated as dark = wood; no leak detection yet in that mode.

## Open questions
- Julie's i dot is a real island in the hand-made file too: was it glued, bridged, or did it fall out? (Decides whether "island" should default to bridge or drop.)
