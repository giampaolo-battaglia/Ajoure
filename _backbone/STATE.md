# State — updated 2026-10-18

## Working
- App shell (spec 001): window layout, empty-state drop zone, drop / paste / ⌘O / Julie sample loading.
- Zoom & pan: pinch, two-finger pan, wheel zoom to cursor, middle-drag, Space-drag, Zoom tool (click/⌥-click/scrub), ⌘+/⌘−/⌘0/⌘1/⌘2, 5%–6400%, pixel grid above 800%.
- Navigator: thumbnail, draggable viewport rect, click-to-jump, scroll-to-zoom, log slider, editable %.
- Light/dark, reduced motion, tooltips with shortcuts, one-time navigation hint.
- `npm start` (zero-dependency server, auto-opens browser), `npm test` (9 viewport tests), JSDoc type-check clean.
- Verified in headless Chromium (no console errors). Not yet tried on Giampi's Mac with real trackpad/mouse or in Safari.

## In flight
- Spec 001 built; waiting for Giampi's hands-on check (trackpad vs mouse-wheel detection is the main risk).

## Next up
1. Giampi tries milestone 1 on his Mac (Chrome + Safari, trackpad + mouse); fix anything that feels off.
2. Write spec 002 — engine core (SPEC 8.1–8.6) against Julie: threshold, regions, wood/hole guess, outer cut, islands, both leak kinds → pins, scored automatically vs the hand-made result.
3. Fixing tools: Bucket with hover preview, wood/hole brush, connector, separator, undo/redo.
4. Flow test (Quick, then animated).
5. Dimension checks, Adjust panel, finishing details, size, cut preview, SVG export, test cut.

## Known broken
- n/a

## Notes for the engine milestone (from the Julie first look, 2026-10-18)
- Input 1024×1536, ink threshold 128 works; strokes ~6 px wide; only 70 regions (4-connectivity).
- The hand-made result aligns to the input by bounding box (scale ≈1.10) → it can be scored automatically (acceptance tests 2–3).
- The whole wood network (frame band, vines, leaf interiors, some petals) is one connected region, which is expected and correct.
- Two kinds of leaks the hand-made fixed: (a) hole areas connected into the wood network (2 spots, critical); (b) one hole region the user split into several holes by closing lines (3 regions, ~6 gaps). Engine must detect both.

## Open questions
- None blocking.