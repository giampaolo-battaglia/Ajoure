# 003 — Issues & focus: fix tray, next/previous, ignore

**Status:** built 2026-10-21 (awaiting Giampi's hands-on check)
**Date:** 2026-10-21

## What it is
Going through the problems one by one, fast: focus an issue, fix it (or ignore it), move to the next.

## Behavior
- Clicking a marker or an Issues row focuses it: the view glides to it and the **Fix tray** slides up at the bottom of the canvas.
- The tray shows the issue in plain words, `◀ 2/3 ▶`, the tools that fit it, one **quick fix** and **Ignore**:
  - Leak → quick fix **Close gap** (draws the missing bit of line, in the drawing's stroke width); tools: Wood brush, Connector.
  - Island → quick fix **Remove** (cuts it out); tools: Connector, Wood brush.
  - Speck → quick fix **Remove**.
- Keys while focused: **N** / **P** next / previous, **Enter** quick fix, **I** ignore (or restore), **Esc** leave focus.
- When a re-scan no longer finds an issue, its marker turns green with a check and fades out; focus moves to the next open issue.
- Ignored issues keep a hollow grey marker (hidden if "Show ignored" is off in Settings) and sit at the bottom of the Issues list; ignoring survives re-scans (matched by type and position).
- The top bar turns to "✓ No leaks or islands" when nothing critical is open.
- Zoomed out, round pins that overlap merge into one pin with a count; clicking it zooms in.

## Out of scope
- Several suggested fixes to swipe through (v2). Only one quick fix per issue type here.
- History popover (undo/redo is keyboard + buttons, see 004).

## Done when
- On Julie: N/P walks the 3 issues; Enter on each leak closes it; Remove (or Connector) handles the i dot; the top bar says ✓.
