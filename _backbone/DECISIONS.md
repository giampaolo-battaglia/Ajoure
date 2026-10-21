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
