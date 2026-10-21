# Changelog

Newest at the top. One entry per working session. Describe what changed
for the user, not which lines were edited.

---

## 2026-10-21
- Water preview for the Bucket (Settings → Bucket preview → Water): water poured at the cursor spreads through the area with ripples and a wavy deep-blue front; a leak shows as water escaping through the gap. Tint stays the default. Big areas are worked out in the background so the cursor never stalls.
- Settings: "Show ignored issues" row laid out side by side again (a CSS rule was overriding it).
- Milestone 3: fix tray at the bottom of the canvas for the focused issue — ◀ ▶ (N/P), the right tools, a quick fix (Enter: Close gap / Remove) and Ignore (I); fixed issues flash green and focus moves to the next; ignored ones stay as grey markers (toggle in Settings) and in an "Ignored" section; overlapping pins merge into a count when zoomed out.
- Milestone 4: Bucket, Wood/Hole/Revert brushes, Connector and Separator all work, on a separate edits layer (the original image is never changed); every edit is re-checked automatically; undo/redo with ⌘Z / ⇧⌘Z or the arrows by the file name.
- Re-checks are stable: they lean on the previous answer, so fixing one leak no longer makes new ones appear elsewhere; undoing a Bucket click restores the original guess.

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
