# State — updated 2026-10-21

## Working
- Milestone 1 (spec 001): window, drop / paste / ⌘O / Julie sample, zoom & pan (trackpad, mouse, Space-drag, Zoom tool, ⌘ and ⌃⌘ shortcuts, bare +/−), Fit/100% buttons, Navigator, light/dark, tooltips, Settings (⌘,).
- Milestone 2 (spec 002): instant scan in a Web Worker — threshold, regions, waste, wood/hole guess, leaks (stroke-end gaps + necks), islands, specks; Wood/Hole view; issue markers (dotted box default, pin optional).
- Milestone 3 (spec 003): fix tray (◀ n/N ▶, tools for the issue, quick fix, Ignore/Restore), N/P/Enter/I/Esc, resolved markers flash green, ignored markers hollow grey (Settings: show/hide), "Ignored" section in the list, pin clustering when zoomed out, focus moves on when an issue is fixed.
- Milestone 4 (spec 004): Bucket (hover tint shows leak spill; ⇧ wood, ⌥ hole; switches to Wood/Hole view), Wood/Hole/Revert brushes ([ ] size, ⇧-click straight line, true-size cursor), Connector (A→B bridge, 1.2 × min wood), Separator (drag cut, min hole), undo/redo (⌘Z / ⇧⌘Z / buttons, 100 steps), re-check after every edit (~1 s on Julie, debounced, latest state only).
- Quick fixes: Close gap (leaks, drawn in the drawing's stroke width) and Remove (islands/specks).
- Julie end-to-end in the browser: 3 × Enter → "✓ No leaks or islands"; undo/redo walks it back and forth.
- `npm test`: 37 tests (viewport, engine, edits, document/undo, Julie acceptance).

## In flight
- Milestones 3 + 4 built; waiting for Giampi's hands-on check (tool feel, brush sizes, tray layout on a smaller screen).

## Next up
1. Giampi tries fixing Julie and 2–3 other AI images with the tools; collect what feels slow or wrong.
2. Milestone 5 — Flow test (Quick fill, then animated water escaping through gaps).
3. Milestone 6 — Adjust panel + thin wood / near-touch / speck-hole checks + real size entry.
4. Milestone 7 — Floating details, outer-cut confirm, cut preview, SVG export for XCS, project save/autosave; then a real cut.

## Known broken
- Re-check is a full re-analysis (~1 s on Julie, more on big images); SPEC target is < 300 ms → incremental analysis later.
- Edits live only until the page reloads (no project save yet — milestone 7).
- Connector is straight only (no midpoint curving yet).
- Wood/hole guess tuned on one image (Julie); the Bucket is the safety net. Re-checks lean on the previous guess for stability.
- Scale is still the 50 mm estimate; mm values are estimates.
- Navigator thumbnail doesn't show paint strokes in Design view.

## Open questions
- Julie's i dot: glued, bridged, or fell out? (Decides whether Remove or Connector should be the island quick fix.)
