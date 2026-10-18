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
