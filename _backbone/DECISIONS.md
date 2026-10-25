# Decisions

Append-only. Newest at the bottom. Never edit a past entry — supersede it
with a new one that says what changed and why.

---

## 001 — Product spec v0.3 is the v1 baseline
**Date:** 2026-10-17
**Chose:** Build v1 from `docs/SPEC.md` v0.3 (safety net: pins, Bucket, brushes, Flow test, SVG export).
**Because:** Two review rounds already shaped it; key calls inside it: size optional, 3 mm basswood default, floating details = Score/Engrave/Drop in a finishing step, outer cut auto-detected + confirmed, iPad moved to v3.
**Rejected:** Starting with AI-suggested fixes (v2) — the detection engine has to be trustworthy first.
**Revisit if:** Julie testing shows the pin-and-fix loop is not the bottleneck.

## 002 — Plain HTML/CSS/JS, no framework, no build step
**Date:** 2026-10-17
**Chose:** Vanilla ES modules + JSDoc `@ts-check`; Node only for dev-time tests; vendored libs.
**Because:** Giampi wants v1 simple. The app is canvas-heavy with small side panels, so a framework buys little; speed comes from typed arrays and Workers either way.
**Rejected:** TypeScript + Svelte via Vite (my earlier suggestion) — nicer component code and compiler checks, but adds a toolchain to install and maintain.
**Revisit if:** UI state (panels, history popover, focus mode) gets tangled enough that a small reactive layer would clearly pay off. Preact can be added via a vendored ES module without a build step.

## 003 — Engine is pure and shared between Worker and Node tests
**Date:** 2026-10-17
**Chose:** `src/engine/` has no DOM access; it takes and returns typed arrays.
**Because:** Lets Claude test leak/island detection against Julie headlessly, and keeps the UI thread free.
**Rejected:** Analysis mixed into canvas code — faster to start, impossible to test.
**Revisit if:** Never, expected to hold.

## 004 — Keyboard zooms glide, but only briefly
**Date:** 2026-10-18
**Chose:** ⌘+/⌘−/⌘0/⌘1/⌘2 and the Zoom tool glide over 160 ms with a strong ease-out; glides are interruptible and become instant with Reduce Motion. Pinch, wheel and drags never animate (they follow the hand).
**Because:** SPEC 6.2 asks for eased keyboard zooms, but frequently-used keyboard actions feel slow if animated longer (design-engineering rule of thumb).
**Rejected:** 250–300 ms glides (felt sluggish on repeat); no animation at all (loses spatial context on big jumps like ⌘0).
**Revisit if:** Giampi finds keyboard zoom laggy → drop to 0 ms.

## 005 — Leaks are judged by what closing them changes
**Date:** 2026-10-19
**Chose:** Collect gap candidates (stroke ends within 0.6 mm of another line, plus "necks" where paper is pinched below 1.0 mm between two areas ≥ 8 mm²), close them all on a copy, guess wood/hole on the copy, and pin only the gaps whose closing separates wood from hole/outside.
**Because:** Julie's two hand-sealed pockets open through 0.64 mm and 0.96 mm, wider than SPEC's 0.6 mm and with no stroke end (curves that almost touch). Widening the stroke-end limit alone cut through the script letters and flooded false leaks; the neck rule with a size floor catches both pockets and nothing else on Julie.
**Rejected:** SPEC §8.6 opening-only method (no way to tell intended openings from leaks); a single wider gap limit (17–58 false leaks).
**Revisit if:** other images show necks wrongly flagged (raise neckMinPartMm2) or real leaks missed (raise neckGapMm). Both live in DETECTION in src/engine/analyze.js.

## 006 — Wood/hole guess = "disagree with your neighbours", weighted by shared outline
**Date:** 2026-10-19
**Chose:** Each region prefers the opposite class to the regions it shares lines with; wood–wood costs 0.4, hole–hole 3, scaled by shared outline length over the geometric mean of both outlines; long thin regions lean wood. Solved by seeded annealing (4 runs) + ICM, so results are repeatable.
**Because:** Julie measurements: a neighbour-count rule failed on the background around the lettering; strict alternation failed on overlapping petals; plain ICM got stuck with flowers inverted. This model scores 97.7% as-is / 99.9% with leaks closed.
**Rejected:** degree-based guess (79–87%), even/odd parity from the outside (petals wrong), averaged shares (92%).
**Revisit if:** a second reference image disagrees; weights live in WEIGHTS in src/engine/classify.js and tests/julie.test.mjs guards regressions.

## 007 — Edits are a separate layer; re-checks lean on the previous guess
**Date:** 2026-10-21
**Chose:** One byte per pixel of edits (none / wood paint / hole cut) over the prepared image, plus Bucket clicks stored as seed points (x, y, class; latest wins). Hole paint is a cut: it never merges the regions on either side. Every edit triggers a full re-analysis in the worker, which leans on the previous scan's own guess (prior weight 1.5); Bucket clicks are applied after the guess and never feed the prior.
**Because:** Keeps the original untouched and undo trivial (rect patches). Without the prior, fixing one Julie leak re-shuffled borderline regions and produced 3 new false leaks; with it, fixing leaks one by one ends at 0 leaks and 99.9% agreement. Seeding the prior with clicks made undo of a Bucket click not restore the old guess.
**Rejected:** Majority-overlap carry-over of region classes (SPEC §7.1) — seed points are simpler and survive splits; incremental dirty-rect analysis — later, once behaviour is right.
**Revisit if:** re-checks get too slow on big images (go incremental) or the prior makes the app "stick" to a wrong guess (lower PRIOR_WEIGHT in src/engine/analyze.js).

## 008 — One quick fix per issue type now, the swipe later
**Date:** 2026-10-21
**Chose:** The fix tray offers a single computed fix: Close gap (draw the gap segment the engine already found, in the drawing's stroke width) for leaks, Remove (cut out the loose piece) for islands and specks.
**Because:** The engine already knows the exact gap segment, so the best fix costs nothing; it turns Julie into three Enters. Several candidates to swipe through stay in v2 (SPEC §11).
**Rejected:** Shipping the tray with tools only (slower, and the data was already there).
**Revisit if:** Giampi prefers bridging islands by default (then Connector becomes the island quick fix).

## 009 — Water preview: geodesic pour, paced by what's on screen
**Date:** 2026-10-21
**Chose:** Water fills pixels in order of walking distance from the cursor inside the area (5/7/11 chamfer steps, never jumping a line), nudged by a smooth image-space ripple for a liquid edge. The pour is timed by the share of the on-screen area that's wet, not by distance, and each frame paints only the newly reached pixels. Areas over 250k px are computed in a small worker. Tint stays the default; Water is a Settings choice.
**Because:** Paced by distance, a zoomed-in view sat still while the water travelled off-screen, then flooded in one frame. The plain 5/7 distance gave octagonal fronts that looked mechanical. The area outside the piece (~1M px) took ~120–180 ms on the main thread.
**Rejected:** Real fluid simulation (heavy, no clearer); restarting the pour on every mouse move (it restarts only when the cursor enters a different area).
**Revisit if:** milestone 5's Flow test needs a different look; reuse this engine rather than writing a second one.

## 010 — Flow test: sealed = today's drawing with only the flagged leaks closed
**Date:** 2026-10-22
**Chose:** Water pours from the deepest point of every hole (and invisibly from outside) through the drawing as it is; "where it should stop" comes from the same drawing with only the pinned leaks closed, each sealed area taking the scan's leak-free guess by majority. Holes fill in the first half, leaks break at the half mark, escapes flood the second half.
**Because:** Using the scan's fully-closed preview (every candidate gap closed) made water "escape" through gaps that were never pinned — amber in places with no marker. Timing by distance alone made the gap flash after 5 % of the pour, before the holes had visibly filled.
**Rejected:** Per-region quick tint only (no story); WebGL shader (canvas with incremental painting is fast enough: no long tasks).
**Revisit if:** a leak the Flow test shows isn't pinned (or vice versa) — they must always agree.

## 011 — Structure checks are scale-free; width and material only drive the mm checks
**Date:** 2026-10-22
**Chose:** Leak detection always uses the 50 mm reference scale and the default 0.6 mm gap, whatever width/material is set. Thin wood, near-touch, speck checks and brush sizes use the real width and the chosen material.
**Because:** With the real width, Julie went from 2 leaks to 8 at 70 mm (smaller "significant part" area in px). SPEC §4 says structure rules don't depend on size.
**Revisit if:** very large or very small pieces need a different leak sensitivity — then make it an explicit setting, not a side effect of width.

## 012 — Mm checks ignore corners; adjustments re-prepare and reset the prior
**Date:** 2026-10-22
**Chose:** Thin/near-touch spots come from the centre line of the shape; the last couple of px of a wedge (where two lines meet) are ignored and a spot must stay narrow for 1.5× (wood) / 3× (holes) the minimum width. Image adjustments re-run prepare() in the worker and drop the stability prior (a different trace no longer lines up with the old guess).
**Because:** Without the corner rule Julie showed 77 near-touches, nearly all at line junctions; with it, 6 real ~0.45 mm channels. Keeping the prior after Line weight → Reset left Julie at 1 leak instead of 2.
**Revisit if:** a real thin strut is missed (lower the run factor) or the list gets noisy on other images.

## 013 — Project files are one JSON with the original image inside
**Date:** 2026-10-22
**Chose:** `.ajoure` = JSON: original image as a data URL, edits layer run-length encoded (base64), Bucket clicks, adjustments, width, material name, ignored issue ids. Chrome saves through the "Save as" dialog; Safari downloads to Downloads. Undo history isn't saved.
**Because:** One self-contained file to move around or back up; edits are mostly zeros (a few KB encoded); no server, no extra dependencies.
**Revisit if:** files get big (high-res images) → zip container; or history across sessions is wanted.

## 014 — Open outlines are hints; all candidates are closed together to find them
**Date:** 2026-10-22
**Chose:** Stroke ends up to 3 mm from the next line are all closed on a copy; a candidate is reported (info, not critical) only if both sides are then separate pieces ≥ 100 mm² and the drawing as it is still joins them.
**Because:** On Paris the sun has two openings (1.25 mm and 0.47 mm); checked one at a time, neither seemed to matter. Checking per candidate on Julie gave ~20 false hints (leaf veins); the size floor + joint closing gives 2 on Paris (both the sun) and 2 harmless ones on Julie.
**Revisit if:** hints get noisy on new images (raise the size floor) or miss real outlines (raise the 3 mm reach).

## 015 — The Bucket fills the piece, not the whole connected area
**Date:** 2026-10-22
**Chose:** On click, the worker splits the clicked area at its narrow passages (< 1 mm, same limit as leak necks); if there's more than one piece, the passages around the clicked one are painted wood and the fill applies to it — one undo step, with a toast saying so. A single-piece area behaves exactly as before.
**Because:** On Paris the sky was joined to the frame/vines/letters through hairline gaps that aren't leaks (wood both sides); a plain Bucket click on the sky flipped the whole piece (21 islands, 141 thin spots). With pieces: sky only, 0 islands.
**Rejected:** Bucketing the analysis' closed regions without changing the drawing (the cut would still be joined); asking the user to find the gap themselves (that was the complaint).
**Revisit if:** someone wants the old "flood everything connected" — add ⌥⇧-click for it.

## 016 — Own tracer instead of vendoring potrace
**Date:** 2026-10-23
**Chose:** Crack-following outlines (closed and duplicate-free by construction) + resampling, Gaussian smoothing (σ ≈ 1.2 px) and Douglas–Peucker (0.3 px), drawn as cubic Béziers whose handles are a third of each segment and may bulge at most ⅓ px; > 50° turns stay corners.
**Because:** No dependency (PROJECT ground rules), ~0.3 s for Julie, and the outline stays within a fraction of a pixel of the scan (≈ 0.05 mm at 8 px/mm, under the 0.15 mm kerf). Plain Catmull–Rom overshot next to long straight edges (spikes) and its averaged tangents made long edges wavy — the handle-length and bulge rules fixed both.
**Rejected:** potrace port (bigger, GPL); polylines only (fine for the laser, but heavier files and visible facets in XCS).
**Revisit if:** XCS shows jaggies on small curves (lower the tolerance) or files get large.

## 017 — SVG conventions for XCS
**Date:** 2026-10-23
**Chose:** width/height in mm + viewBox in mm, 1 mm margin; one path per outline; holes before outer outlines; stroke colours red #FF0000 (cut), blue #0000FF (score, open paths), black fill (engrave); stroke 0.1 mm, no fill on cut paths.
**Because:** XCS assigns processing by colour and imports physical units from mm attributes; cutting insides first keeps the piece from shifting once its outline is free.
**Revisit if:** the first import in XCS shows a different scale (some tools assume 96 dpi px) or ignores the colours.

## 018 — Width changes keep the stability guess
**Date:** 2026-10-23
**Chose:** The worker drops its previous guess (prior) only when the adjustments change, not when width or material change.
**Because:** Entering 52 mm after fixing Julie re-prepared the image, dropped the prior, and a fixed leak came back. Width and material don't move a pixel.

## 019 — Engraving is a paint on the area, not a third material class
**Date:** 2026-10-25
**Chose:** An engraved area stays wood in the analysis (`regionEngraved` beside `regionClass`); the Engrave tool adds a seed like the Bucket. Line choices are seeds too, read only by the export.
**Because:** Engraving doesn't change what holds together, so leaks/islands/thin checks must not change; seeds already give undo, save/reopen and "latest click wins".
**Revisit if:** engraved areas need their own checks (e.g. a tiny engraved island next to a cut charring).

## 020 — One "line" is a stroke from fork to fork
**Date:** 2026-10-25
**Chose:** Per-line score/engrave applies to the stroke between forks (forks found by neighbour runs), not to the whole connected drawing.
**Because:** On the Halloween bookmark the moon's rim, the castle and its spires are one connected network; clicking the rim switched the castle too.
**Revisit if:** people expect a click to take a whole outline (then add ⌥-click = whole network).

## 021 — Engrave fills are compound even-odd paths
**Date:** 2026-10-25
**Chose:** All engraved areas in one path, all engraved lines in another, `fill-rule="evenodd"` on the group.
**Because:** One path per contour filled a ring's inner contour as a second solid shape.
**Revisit if:** XCS ignores fill-rule (then emit outer + its holes per path with opposite winding).
