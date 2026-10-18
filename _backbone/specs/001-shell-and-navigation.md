# 001 — App shell, image loading and canvas navigation

**Status:** building (built 2026-10-18, awaiting hands-on check)
**Date:** 2026-10-18

## What it is
The first runnable Ajouré: the full Mac-style window, a drop zone, your image on the canvas,
and zoom/pan that feels like a native app. No analysis yet; this is the stage everything else sits on.

## Behavior
- Start: `npm start` in the Ajoure folder starts a tiny built-in local server (Node, zero dependencies) and prints the URL to open in Chrome or Safari.
- Layout matches SPEC §6.1: top bar, slim left toolbar, canvas, right sidebar (Navigator, Issues, Adjust), all present.
- Tools and controls that belong to later milestones are visible but disabled, with a tooltip saying so. Hand (H) and Zoom (Z) work.
- Empty state: a calm drop zone with a "Try the Julie sample" button.
- Loading: drag-and-drop a PNG/JPG/WebP onto the window, paste with ⌘V, or ⌘O / Open. The image appears fitted to the window; the file name shows in the top bar.
- Trackpad: pinch zooms around the fingers; two-finger scroll pans in every direction (macOS momentum included).
- Mouse: scroll wheel zooms toward the cursor; middle-button drag pans.
- Any device: hold Space + drag to pan, release to go back to the tool. Zoom tool: click = in, ⌥-click = out, drag left/right = scrubby zoom.
- Keyboard: ⌘+ / ⌘− zoom, ⌘0 fit, ⌘1 100%, ⌘2 200%; these glide with a short eased animation.
- Zoom range 5%–6400%, always anchored under the cursor/fingers. Pixels stay crisp when zoomed in; a pixel grid appears above 800%.
- Navigator: thumbnail with a viewport rectangle; drag it to move, click to jump, scroll over it to zoom; slider, editable %, and −/+ buttons. The zoom % is always visible.
- Follows system light/dark; one teal accent; respects "Reduce motion" (glides become instant).

## Out of scope
- Any analysis: regions, pins, Issues list content, Flow test.
- Bucket, brushes, connector, separator, undo/redo, History.
- Adjust panel controls, material/size fields (shown as placeholders only).
- Command palette (⌘K), preferences (Photoshop-style wheel option), autosave, export.
- Two-finger double-tap smart zoom (browsers don't reliably expose it; revisit with the Tauri wrap).

## Depends on
- Decisions 002 (plain HTML/CSS/JS) and 003 (pure engine, not used yet).

## Done when
- Giampi runs `npm start`, drops Julie in Chrome and Safari, and pinch, pan, wheel-zoom, Space-drag and Navigator-drag all feel smooth with no stutter.
- The view never jumps when zooming: the point under the cursor stays put.
- No errors in the browser console.

## Known risk
- Browsers don't say whether a wheel event came from a mouse or a trackpad. I'll use the usual heuristic (pinch arrives as ctrl+wheel; mouse wheels send large stepped deltas). If a particular mouse is misread, we add a preference toggle.
