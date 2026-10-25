# Changelog

Newest at the top. One entry per working session. Describe what changed
for the user, not which lines were edited.

---

## 2026-10-25
- New **Plan** view: wood you keep, parts that fall out (hatched), and what the laser does — red cut, blue score, brown engrave — with a legend. Click a legend item to pick it out; hover anything for a plain-words explanation.
- New **Engrave** tool (G): click a shape to burn it solid, outline included (the bat filled in); click again to clear. Click a line drawn on the wood to switch it between a thin score and a bold engrave. Works on holes too (they stay, engraved).
- "Floating details" in the export sheet is now "Lines on wood" (Score / Engrave / None), the same switch as in the legend. The sheet counts engraved areas and lines.
- Score lines come out in one piece instead of short bits (Julie: 130 lines instead of 166).
- New test image: the Halloween bookmark.

## 2026-10-23 (afternoon)
- **Export SVG** (⇧⌘E): the cut file for xTool Creative Space, at real size in mm. Red = cut (holes first, then the outline), blue = score lines for details drawn on the wood (stamens, veins) — or engrave them, or drop them. The export sheet shows the size, how much will be cut, and warns about open leaks or an estimated size.
- **Cut** view: the piece as it comes out of the laser — basswood, see-through holes, burnt edges, scored details.
- Fixed: entering the width no longer brings back a leak you had fixed.
- Fixed: a long status line no longer covers the Design / Wood/Hole / Cut buttons.

## 2026-10-23
- Re-check of the whole build: 59 tests, type check and 7 browser runs (Julie, Paris, save/reopen, brush bar, Flow test) all pass with no errors.
- Bucket clicks answer in ~0.1 s even while a re-check is running (the piece lookup moved to the idle helper thread and only looks inside the clicked area); before, a click could wait 1–2 s.

## 2026-10-22 (evening)
- Open and Save buttons in the top bar (⌘O / ⌘S work anywhere). Save writes a .ajoure project with the image, your edits and settings; open it to continue where you left off. A dot by the name shows unsaved changes, and Ajouré asks before replacing them.
- Brush size bar: whenever a brush (or the Connector / Separator) is selected, a small bar on the canvas shows its size in mm with − / slider / + / Default; type an exact size.
- New "Open outline" hint: a line stopping just short of the next one where closing it would make a piece of its own (e.g. a sun circle that doesn't close). One click closes it.
- Smarter Bucket: it fills just the piece you click; if that area is joined to others through narrow passages, those get sealed with wood in the same step.
- Tested on a second design (Paris / "Julie je t'aime"); added as a test image.

## 2026-10-22
- Flow test (T or the button): every hole fills with water; where a leak lets it out, it breaks with an amber ripple and the escaped water shows in amber — what the leak would take with it. Flow (animated) or Quick, remembered.
- Adjust panel: Auto, Invert, Brightness, Contrast, Threshold, and under More: Smooth, Sharpen, Despeckle, Line weight. Shows how each change moves the issue counts; hold \\ to compare with the original.
- Real width (mm) and material in the top bar; new mm checks: Thin wood (quick fix Thicken), Near-touch, Speck hole (quick fix Fill), marked "est" until the real width is set.
- Leaks and islands no longer change when you enter a width or pick a material.
- Connector: drag the handle in the middle of a new bridge to curve it. History popover next to undo/redo. Navigator shows your paint.

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
