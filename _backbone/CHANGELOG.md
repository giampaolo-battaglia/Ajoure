# Changelog

Newest at the top. One entry per working session. Describe what changed
for the user, not which lines were edited.

---

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
