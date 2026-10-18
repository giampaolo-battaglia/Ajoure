# Ajouré

**One-liner:** A Mac desktop app that turns an AI-generated decorative image into a laser-ready SVG for fully cut-out (openwork) pieces, showing every place the design will fail before you burn wood.
**For:** Giampi first (xTool M2 + XCS, Art Nouveau bookmarks/pendants); later laser hobbyists and Etsy-style makers.
**Status:** in development (v1, nothing built yet)

## Why this exists
- AI line-art looks clean but isn't cuttable: leaky strokes merge holes, unattached pieces fall out, hairline strokes burn away.
- Today it's fixed by hand with the Paint bucket and brush, and mistakes only show up after a cut.

## Stack & tooling
- Plain HTML + CSS + JavaScript (ES modules), no framework, no build step
- Type safety via JSDoc + `// @ts-check` (editor checks only, nothing compiled)
- Runs locally in Chrome/Safari on macOS via `npm start` (zero-dependency Node static server; Workers can't load from file://). Mac has Node 24 and Python 3.9.
- Analysis in Web Workers on typed arrays; Canvas 2D for editing, WebGL for compositing + Flow animation
- Engine tests run in Node (`node --test`), dev-only deps allowed in package.json; the app itself ships zero npm deps
- Third-party code (e.g. potrace port) is vendored into `vendor/`, not installed
- Later: wrap as a native Mac app with Tauri, no rewrite

## Ground rules
- The full product spec is `docs/SPEC.md` (v0.3). It wins over memory; changes to it are logged in DECISIONS.md.
- `src/engine/` is pure: no DOM, no canvas, no globals. Same code runs in the Worker and in Node tests.
- UI thread never runs heavy analysis; anything over ~16 ms goes to the Worker.
- The checker never silently changes the design; only explicit user actions/auto-fixes do.
- The Julie bookmark (input + hand-made result) is acceptance test #1; engine changes are checked against it.
- Apple-Design-Award bar for the UI: native Mac feel, calm, one accent (teal), severity colors only for issues.
- Images never leave the machine. No server, accounts or network calls.

## Layout
- `docs/SPEC.md` — product + technical spec v0.3
- `_backbone/` — this file, STATE, DECISIONS, CHANGELOG, feature specs
- `index.html`, `styles/` — app shell (planned)
- `src/app/` — UI: canvas view, tools, panels (planned)
- `src/engine/` — pure analysis: threshold, regions, classification, issues, export (planned)
- `src/worker/` — Worker entry that wraps the engine (planned)
- `vendor/` — vendored third-party JS (planned)
- `tests/`, `fixtures/` — Node tests and test images incl. Julie (planned)

## Not doing (v1)
- Accounts, cloud, payments, AI generation
- Suggested-fix swipe (v2), decorative Art Nouveau bridges (v3), iPad/touch (v3)
- Multi-layer pieces, DXF export, direct machine control
