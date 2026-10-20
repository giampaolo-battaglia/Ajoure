# Ajouré

Turns an AI-generated decorative image into a laser-ready SVG for fully cut-out (openwork) pieces,
and shows every place the design will fail before you burn wood.

## Run it

Double-click **Start Ajoure.command** in Finder. It opens Ajouré in your browser;
close that Terminal window to stop it.

Or from Terminal:

```sh
npm start
```

This starts a tiny local server (no installs needed) and opens Ajouré in your browser.
If it doesn't open by itself, go to the address it prints (usually http://localhost:5173).
Stop it with Ctrl+C.

## Test it

```sh
npm test
```

## Where things are

- `docs/SPEC.md` — the product spec
- `_backbone/` — project state, decisions, changelog, feature specs
- `src/app/` — the user interface
- `src/engine/` — analysis: wood/hole, leaks, islands (`node tools/scan.mjs fixtures/julie-input.png` to try it from Terminal)
- `fixtures/` — test images (Julie input + hand-made result)

## What the scan shows

Drop an image and Ajouré scans it at once: the top bar sums up what it found, red dotted boxes mark
**leaks** (a gap joining a hole to the wood) and **islands** (wood that would fall out),
and **Wood/Hole** in the top bar shows what stays (white) and what gets cut (grey).
Prefer round pins? Open **Settings** (top-right button, or ⌘,) and pick **Pin**.

## Navigation cheat sheet

| Action | Trackpad | Mouse | Keyboard |
|---|---|---|---|
| Zoom | Pinch | Scroll wheel | + / − (or ⌘+ / ⌘−) |
| Pan | Two-finger scroll | Middle-drag | Hold Space + drag |
| Fit / 100% / 200% | | Buttons at bottom right | ⌘0 / ⌘1 / ⌘2 |
| Hand / Zoom tool | | | H / Z (⌥-click zooms out, drag to scrub) |
| Jump to an issue | Click a pin or a row in Issues | | Esc to clear |

**In Safari**, ⌘1, ⌘2, ⌘0 and ⌘+/⌘− belong to Safari itself, so use **⌃⌘** (Control+Command) instead:
⌃⌘0 fit, ⌃⌘1 100%, ⌃⌘2 200%, ⌃⌘+ / ⌃⌘− zoom. These work in Chrome too.
