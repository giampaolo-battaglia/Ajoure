# Changelog

Newest at the top. One entry per working session. Describe what changed
for the user, not which lines were edited.

---

## 2026-10-20
- Issue markers are now red dotted squares around each problem zone (tinted when selected); Settings (top-right button or ⌘,) lets you switch back to round pins. The choice is remembered.

## 2026-10-19
- Milestone 2: dropping an image now scans it instantly and pins every leak and island; summary in the top bar, plain-words Issues list, click to glide to a problem, Wood/Hole view.
- On Julie it finds both pockets sealed by hand and the loose i dot; its wood/hole map matches the hand-made result on 99.9% of pixels once the leaks are closed.
- Automated tests against the hand-made Julie and synthetic drawings (24 total); `tools/scan.mjs` to scan from Terminal.

## 2026-10-18
- Safari-friendly shortcuts: ⌃⌘0/1/2/+/− and bare +/− (Safari keeps ⌘1/⌘2/⌘0/⌘± for itself); tooltips show ⌃⌘ in Safari.
- Fit and 100% buttons appear at the bottom right of the canvas once you zoom or pan away from the fitted view.
- Fixed: buttons floating over the canvas didn't respond to clicks.
- Added `Start Ajoure.command`: double-click in Finder to launch Ajouré in the browser (reuses it if already running).
- Milestone 1 built: Ajouré opens in the browser with `npm start`; drop, paste or open an image (or try Julie) and move around it with trackpad, mouse or keyboard; Navigator thumbnail with zoom slider.
- Version history turned on (git), Julie input + hand-made result added as test fixtures.
- First look at Julie: found where the hand-made version closed leaks; notes in STATE.
- Spec 001 drafted: app shell, image loading, zoom/pan, Navigator.
- Local server will be a zero-dependency Node script (Node 24 on the Mac).

## 2026-10-17
- Project initialized: spec v0.3 saved to `docs/SPEC.md`, backbone created.
- Stack chosen: plain HTML/CSS/JS with JSDoc type checks, engine tested in Node.
