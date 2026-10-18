# Ajouré — Product & Technical Spec

*Working title. "Ajouré" is the French term for pierced openwork: a design made by cutting material away.*

**Owner:** Giampi (GPB Creative Labs)
**Version:** 0.3, MVP spec (revised after second review)
**Target machine (first user):** xTool M2 laser, xTool Creative Space (XCS) for cutting
**Platform v1:** desktop (macOS first), mouse and trackpad
**Status:** Ready for development of v1

---

## 1. Purpose

Ajouré turns an AI-generated (or hand-drawn) decorative image into an SVG that can be **fully cut** on a laser, never engraved.

The output is a single piece of wood (or acrylic, card, leather) where the design is formed by holes. Examples: Art Nouveau bookmarks, ornaments, pendants, panels.

The app does one job very well: the moment an image is dropped in, it shows every place where the design **will fail at the laser**. It then helps fix each one in seconds: manually (brush, connector, separator), with suggested fixes, or with a mix of both.

It should feel like a tiny, beautiful mix of MS Paint and Photoshop: instantly understandable, with depth when you need it.

### 1.1 The problem it solves

AI image generators produce images that look clean but are not structurally cuttable:

- **Leaks:** a stroke doesn't fully close, for example the bottom of an "e" or the tip of a leaf. The hole inside the shape merges with the neighboring hole and becomes one big cut. A whole letter or petal is lost.
- **Islands:** a piece of wood (a letter, a petal, a dot) isn't attached to the rest of the design. It falls out when cut.
- **Near-touches:** two strokes look separate on screen but are closer than the laser kerf. The laser fuses or burns through them.
- **Too thin:** wood strokes thinner than the material can survive. They snap or char away.
- **Specks:** tiny stray pixels that become meaningless micro-cuts.

Today the user fixes these by hand in a paint program, using the paint bucket to see where fills leak and a brush to close gaps. This works, but it is slow and easy to get wrong. Errors are only discovered after burning a piece of wood.

### 1.2 Reference case (acceptance test #1)

The "Julie mon Amour" bookmark has two files:

- **Input:** AI-generated **line-art** image. A black-outline "coloring page" style, where every shape (frame, vines, leaves, petals, letters) is drawn as outlines on white.
- **Output (hand-made):** the same design as a **filled wood/hole map**. White is wood that stays; dark gray is holes the laser removes. Only small changes to the drawing were needed (closing a few gaps, connecting a few strokes), but those few changes decided whether the piece worked.

**Key insight:** the core action of the app is the one the user already does in Paint. Bucket-click each region to declare it **wood** or **hole**, and fix the lines wherever a bucket fill leaks. Ajouré automates the detection, makes the leaks visible (the **Flow test**, §6.6) and makes the fixing fast.

---

## 2. Users

- **v1 user:** Giampi. A maker with an xTool M2 who wants very sophisticated cut-out pieces from AI images. He is comfortable with tools, but wants speed and confidence, not a CAD learning curve.
- **Later (public release):** laser hobbyists and small Etsy-style makers on xTool, Glowforge and LightBurn setups who face the same "my AI image doesn't cut" problem.

Design for v1 first. Don't build accounts, cloud or payments in v1.

---

## 3. Core concepts (shared vocabulary)

| Term | Meaning |
|---|---|
| **Wood** | Material that stays. Displayed white. |
| **Hole** | Material removed by the laser. Displayed dark gray. |
| **Waste** | Everything outside the **outer cut** of the piece. Displayed as a subtle checkerboard. It is cut away as well, but it is not a "hole". |
| **Outer cut** | The outline of the finished piece: the one line that separates the piece from the sheet. Detected automatically and confirmed by the user (§5.3). |
| **Line** | Pixels of the original drawing's strokes (line-art input only). Lines are boundaries between regions; on export they belong to the wood (§7.3). |
| **Region** | A connected area of non-line pixels. The unit the bucket acts on. |
| **Main body** | The largest connected wood component, normally the one that includes the frame. Everything wood must connect to it. |
| **Island** | A wood component not connected to the main body. |
| **Leak** | A place where two regions that should be separate are joined through a narrow gap in a line. |
| **Bridge / Connector** | Wood added to join an island to the main body, or to close a leak. |
| **Separator** | A hole cut added to split two areas that are wrongly joined. |
| **Floating detail** | A line drawn inside a wood area, with wood on both sides (§4.1). |
| **Issue / Pin** | A detected problem with a location, type, severity and suggested fixes. |
| **Kerf** | Width of material burned away by the laser beam (default 0.15 mm, user-adjustable). |

---

## 4. Fabrication rules (what the checker enforces)

Two families of rules:

- **Structure rules (scale-free):** islands and leaks. They depend only on what is connected to what. They run **immediately on import**, before any size is known.
- **Dimension rules (need a scale):** thin wood, near-touch, specks. They use millimeters. If the user hasn't set a size, they use an **estimated scale** (§5.5) and are marked "estimated".

All mm values live in a **Material profile**. Default profile: **3 mm basswood** (to be calibrated with test cuts).

| Rule | Family | Default (3 mm basswood) | Issue type if violated |
|---|---|---|---|
| Every wood pixel belongs to the main body | Structure | — | **Island** (critical) |
| No gap in a line joins two regions that should be separate | Structure | gap ≤ 0.6 mm (or ≤ 1% of piece width without scale) | **Leak** (critical) |
| Wood width ≥ `min_wood_width` everywhere | Dimension | 1.0 mm | **Thin wood** (warning) |
| Hole width ≥ `min_hole_width` (kerf safety) | Dimension | 0.5 mm | **Near-touch** (warning) |
| Hole area ≥ `min_hole_area` | Dimension | 0.5 mm² | **Speck hole** (info, auto-fixable) |
| Island area ≥ `min_island_area`, otherwise remove instead of bridge | Dimension | 0.5 mm² | **Speck island** (info, auto-fixable) |
| Line with wood on both sides | Structure | — | **Floating detail** (finishing step, not a pin; see §4.1) |

Severity colors: critical = red, warning = amber, info = blue.

The checker reports, but never silently changes the design (except for auto-fixes the user explicitly runs).

### 4.1 Floating details (e.g. flower stamens), in plain words

In the Julie bookmark, the center of each flower has thin lines with little dots: the stamens. Those lines are drawn **on top of a petal**, and the petal is wood. So there is wood on both sides of the line, and no hole for the line to be the edge of.

Floating details are **never cut**, since a cut would only weaken the piece. Ajouré offers two choices:

1. **Score** (default): a thin, shallow line burned on the surface along the drawn line, giving a crisp, fine look.
2. **Engrave**: a slightly bolder, filled burn of the line's full width, for a darker, more visible detail.

There is also **Drop**, which removes the line from the file altogether.

The little dots at the end of the stamens can be real tiny **holes** if they're big enough: bucket them as hole during the main work.

**This is a secondary, finishing step.** Floating details don't appear as pins and don't count as issues during the main work (the paint-split: Bucket, fixes, Flow test). They only show up afterwards, in the **Finishing details** step (§5, step 7), once the structure is done. Score is applied to all of them by default, so the user can simply skip that step.

---

## 5. User flow (v1)

The rule of the flow: **show problems first, ask questions later.**

1. **Drop.** Drag a PNG, JPG or WebP onto the window (or paste, or Open).
2. **Instant scan** (no setup, under 2 s). The app:
   - auto-detects the input type: *line art* (outlines on white, like Julie) or *filled* (dark/light masses)
   - auto-adjusts the image (auto levels and threshold, §5.2)
   - splits it into regions, guesses wood/hole for each (§8.4) and finds the outer cut (§5.3)
   - runs a **quick Flow test** on every hole region (§6.6) and pins every **leak** and **island** right away
   - shows a one-line summary: "3 leaks · 1 island · 2 thin spots (estimated)"
3. **Adjust (optional).** If the trace looks wrong (broken lines, gray fuzz, inverted colors), open **Adjust** and tune the image (§5.2). Everything re-analyzes live.
4. **Review regions.** Bucket-click any region to toggle wood ↔ hole. Low-confidence guesses are subtly outlined, so you review those first.
5. **Confirm outer cut** (one click, §5.3).
6. **Fix.** Go through the pins. Each one zooms in and offers the right tools (§6.4). Run the Flow test again (animated, if you like) to prove everything is contained.
7. **Finishing details (secondary, skippable).** Only once the structure is fixed, a small, calm panel lists floating details such as stamens (§4.1). They're highlighted in a soft blue on the canvas, all preset to **Score**. The user can switch any of them to Engrave or Drop, all at once or one by one, or just press Continue.
8. **Size (optional, §5.5).** Enter the real width (e.g. 50 mm). Dimension checks switch from "estimated" to exact.
9. **Preview cut.** See the piece as it would come out of the laser, with scored details drawn as fine burn lines.
10. **Export** an SVG ready for XCS (§9). Export is allowed with open issues, but a confirmation lists them.

### 5.2 Image adjustments ("Adjust" panel)

The goal is a clean black/white split before analysis. All adjustments are **non-destructive** (a stack that can be reordered, toggled and reset), live-previewed, and re-analyzed in a worker. They are cheap to implement on canvas pixel data, and small libraries exist for most of them. Press **\\** (backslash) to hold a before/after view.

**Basic (always visible):**

| Control | What it does | Why it matters here |
|---|---|---|
| **Auto** | One click: auto levels + Otsu threshold + light despeckle | 90% of images need nothing else. |
| **Invert** | Swap black and white | For images drawn white-on-black, or when wood/hole reads backwards. |
| **Brightness** | Global lighten/darken | Rescues gray, faded lines. |
| **Contrast** | Push darks darker, lights lighter | Separates lines from paper. |
| **Threshold** ("hardness") | The single cutoff between ink and paper, with a live split view | The most important slider: decides what counts as a line. |

**More (collapsed under "More"):**

| Control | What it does |
|---|---|
| **Levels** | Black point, gamma, white point, with a live histogram. A precise version of brightness/contrast. |
| **Sharpen / Unsharp mask** | Crisper edges on blurry AI output. |
| **Smooth** | Light blur before threshold, which removes jagged or noisy edges. |
| **Despeckle** | Median filter that removes isolated dots, with a size slider. |
| **Line weight** | Thicken or thin all lines by N px (morphological dilate/erode). Thickening alone often closes many hairline gaps at once; thinning separates near-touches. Shows the issue count change live ("leaks 7 → 2"). |
| **Rotate / Flip / Crop** | Basic framing. |

### 5.3 Outer cut: how it's found and confirmed

The outer cut is the outline of the finished piece. The app proposes it based on the main components found in the image, shows it as a dashed accent-colored line, and the user confirms it with one click ("Outer cut ✓").

**Detection logic:**

1. **Framed design** (like the Julie bookmark): the app looks for a wood component that forms a **closed loop enclosing most of the other wood**. If found, the outer cut is the **outside edge of that frame**, including anything attached to its outside (such as the hanging ring). Everything outside it is waste.
2. **Unframed design** (a floating ornament, a pendant shape): the outer cut is the **outside silhouette of the main body**, following the design's own edge.
3. **Ambiguous** (several large components, or none dominant): the app picks the largest component, shows the candidates, and asks the user to click the one that is the piece.

**Options in the Outer cut popover:**

- **Follow design** (default, as above)
- **Add a border:** wraps the design in a new frame (rectangle, rounded rectangle, oval or arch), with a margin and frame width in mm. Useful for unframed AI images.
- **Draw custom:** the user draws the outline with a simple pen tool.

Wood outside the confirmed outer cut is reported as an **island** ("outside the piece"), with options *include* or *drop*.

### 5.5 Size (optional)

- Without a size, the app assumes an **estimated scale**: piece width = 50 mm by default, editable in the top bar. Dimension issues carry an "estimated" badge.
- Structure issues (leaks, islands) never depend on size, so they are exact from the first second.
- Setting a size (top bar, or at export) removes the "estimated" badges.
- Export always writes real mm. If no size was set, the export dialog pre-fills the estimate for confirmation.

---

## 6. UI concepts

### 6.0 Visual style: the bar is an Apple Design Award

The target is the polish of a best-in-class Mac app: minimal, calm, precise. Every powerful thing is one hover or one keystroke away, never in your face.

- **Feel:** native macOS. System font (SF Pro via `-apple-system`), translucent sidebars with backdrop blur (vibrancy feel), generous spacing, crisp 1 px hairlines, soft shadows only on floating elements.
- **Color:** neutral chrome (graphite in dark mode, soft white in light mode, following the system setting). One accent color for selection and active tools; a warm, elegant teal is suggested. Severity colors are reserved for issues. The design canvas is always the most vivid thing on screen.
- **Motion:** spring-based, short (150–300 ms), purposeful: zoom to an issue, a pin resolving, panels sliding. Respect "Reduce motion".
- **Discoverability:**
  - Every tool has a tooltip showing its name and shortcut.
  - A **command palette** (⌘K) finds any action.
  - Contextual hints appear once and then go away ("Hold Space to pan").
- **Empty state:** a beautiful drop zone with a sample design (e.g. a demo bookmark) to try instantly.
- **Progressive disclosure:** basics visible; advanced settings in collapsible "More" sections.
- **No clutter:** no modal dialogs during the main work, except export confirmation.

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● ● ●  Julie-bookmark   Material: 3mm basswood ▾   Width: 50mm (est)  │
│        View: [Design | Wood/Hole | Cut]   ▶ Flow test    Export SVG  │
├────┬──────────────────────────────────────────────┬──────────────────┤
│ ✋  │                                              │ NAVIGATOR        │
│ 🪣  │                                              │ ┌──────────────┐ │
│ ✎W │                                              │ │  ▭ viewport  │ │
│ ✎H │                Canvas                        │ └──────────────┘ │
│ ⟷  │     (pins over the design, live overlays)    │ − ──●──── + 400% │
│ ✂  │                                              ├──────────────────┤
│ ⌫  │                                              │ ISSUES  3·2·2    │
│ 🔍 │                                              │ ● Leak · "e"   ▸ │
│    │                                              │ ● Island · dot ▸ │
│    │                                              │ ...              │
│    │                                              ├──────────────────┤
│    │                                              │ ADJUST        ▸  │
├────┴──────────────────────────────────────────────┴──────────────────┤
│ Fix tray (when an issue is focused):  tools · ◀ 1/4 ▶ · Ignore · ✓    │
└──────────────────────────────────────────────────────────────────────┘
```

- **Left:** slim vertical toolbar.
- **Center:** canvas.
- **Right sidebar** (collapsible sections, resizable):
  1. **Navigator** (§6.3)
  2. **Issues** list
  3. **Adjust** panel (§5.2)
- **Bottom:** the Fix tray, only when an issue is focused.

### 6.2 Canvas navigation: zoom and pan that feel effortless

It should feel exactly like the best native apps, with zero learning.

**Trackpad:**
- **Pinch** to zoom, centered on the fingers (browser `wheel` events with `ctrlKey`, plus Safari gesture events)
- **Two-finger scroll** pans in every direction
- **Two-finger double-tap** (smart zoom) toggles between "fit" and "100%"

**Mouse:**
- **Scroll wheel** zooms toward the cursor (default). A Photoshop-style option is available in preferences: wheel scrolls, ⌥+wheel zooms.
- **Middle-button drag** pans.

**Any device:**
- **Hold Space + drag** pans with any active tool (the cursor turns into a hand); release to return to the tool.
- **Z + drag left/right** for scrubby zoom (Photoshop-style); click with the zoom tool to zoom in, ⌥-click to zoom out.

**Keyboard:**
- ⌘+ / ⌘− zoom; ⌘0 fit to window; ⌘1 100%; ⌘2 200%
- **F** focuses the selected issue

**Behavior:**
- Zoom from 5% to 6400%, continuous, always anchored under the cursor or fingers.
- Smooth eased transitions for keyboard and fit zooms; inertia on trackpad pans; 60 fps.
- Pixel grid appears above 800%.
- The zoom % is always visible (Navigator and status area).

### 6.3 Navigator (right sidebar, like Photoshop's)

- Thumbnail of the whole design (in the current view mode) with a **viewport rectangle** showing what the canvas displays.
- **Drag the rectangle** to move around; **click** anywhere on the thumbnail to jump there; **scroll** over it to zoom.
- Zoom slider plus an editable % field, with − / + buttons.
- **Issue dots** are drawn on the thumbnail too, so you always see where the remaining problems are, even when zoomed deep into one.
- During a Flow test, the thumbnail shows the flow spreading in miniature.

### 6.4 Issues: pins, list and focus mode

- A **pin** is a small colored circle with an icon by type: island, leak, thin, near-touch, speck. Pins cluster with a count when zoomed out. Floating details never get pins (they belong to the Finishing details step).
- **Issues list:** grouped by severity, each with a plain-words label ("Leak: bottom of the 'e' in Julie", "Island: dot of the 'i'") and its measurement ("gap 0.3 mm").
- **Focus mode** (click a pin or a list item):
  1. The canvas glides and zooms so the issue fills about 60% of the view.
  2. The issue area is outlined. Islands pulse softly; leaks show the gap with a glowing point between the two regions.
  3. The **Fix tray** opens at the bottom. In v1 it holds the tools relevant to that issue type plus "Ignore". In v2 it adds suggested fixes (§11).
  4. Keyboard: `N` / `P` = next/previous issue, `I` = ignore, `Enter` = accept the current suggestion (v2), `Esc` = leave focus.
- Resolved pins pop to green, then fade out. Ignored pins stay as hollow gray circles (toggle visibility).
- Status in the top bar turns into "✓ Ready to cut" when no critical issues remain.

### 6.5 Tools

| Tool | Key | Behavior |
|---|---|---|
| **Hand** | H (hold Space) | Pan the view. |
| **Bucket** | B | Click a region to toggle wood ↔ hole. Shift-click forces wood; ⌥-click forces hole. **Hovering** a region previews its full extent with a soft tint before clicking, so a leak is visible because the tint spills into the neighbor. |
| **Wood brush** | W | Paint wood (adds line/material). Use it to close a gap or thicken a stroke. |
| **Hole brush** | E | Paint hole (removes material). Use it to separate touching strokes or widen a hole. |
| **Connector** | C | Click point A, then point B: creates a wood bridge of `min_wood_width × 1.2`, with rounded ends. Drag the midpoint to curve it. |
| **Separator** | X | Click-drag across a junction: cuts a hole line of `min_hole_width`. |
| **Revert brush** | R | Restores the original (adjusted) pixels under the brush. |
| **Zoom** | Z | Click to zoom in, ⌥-click to zoom out, drag for scrubby zoom. |

**Common behavior:**
- Brush size uses `[` and `]`, shown as a crisp cursor circle at true size. Defaults come from the rules (wood brush = `min_wood_width`, hole brush = `min_hole_width`), so the default stroke is always "legal".
- Shift-click draws a straight stroke from the last point (Photoshop habit).
- Every edit triggers re-analysis in under 300 ms (§10).
- Undo/redo of at least 100 steps (⌘Z, ⇧⌘Z), plus a **History** popover in the top bar.

### 6.6 Flow test ("does it hold water?")

This is the signature interaction. It's the Paint bucket made visible and elegant: pour liquid into a hole region and watch where it goes. If a region isn't sealed, the liquid escapes through the gap, and the gap lights up.

**How to trigger it:**
- **▶ Flow test** button (key **T**) tests every hole region at once.
- **Bucket tool + T held + click** tests just the region you click.
- The first, quick version runs automatically on import (step 2 of the flow).

**Two modes** (toggle next to the button; the choice is remembered):

1. **Quick** (default for auto-runs): each region fills instantly with a 150 ms fade. Contained regions get a calm tint; leaking ones turn amber, with the gap point glowing.
2. **Flow** (animated, the showpiece):
   - Liquid spreads from the click point, or from a "raindrop" in each region for "test all", following the shape of the region like water filling a mold.
   - **Look:** translucent water (soft teal, matching the accent color) with a slightly brighter leading edge and a very subtle shimmer. It's restrained and elegant, not cartoonish. An optional "ink" style looks like watercolor ink blooming in water.
   - **When the front passes through a gap narrower than the leak threshold:** the gap point flashes, a small ripple expands from it, a pin drops in, and the liquid that escaped is tinted warm amber, so you see exactly what the leak would have taken with it.
   - **When a region is sealed:** the liquid settles and stills, with a gentle shimmer. A tiny check appears.
   - **Timing:** the whole test lasts about 2–4 s regardless of image size; regions fill in parallel. Click or press Esc to skip to the end.
   - **Sound** (optional, off by default): a soft water sound and a faint "tick" for each leak found.
- **Respect "Reduce motion":** that setting falls back to Quick mode.

**Implementation note:**
- In a worker, compute a **geodesic distance map** from the seed point(s) inside each hole region (a BFS that cannot cross lines or wood).
- The animation then only reveals pixels where `distance < t × speed`, frame by frame. This is cheap on canvas, or very cheap as a WebGL shader (one texture lookup per pixel).
- Leak points are known in advance from the analysis (§8.6). The animation triggers the flash when the front reaches them.

---

## 7. Data model

### 7.1 Raster state (source of truth for v1)

The app works on a raster at working resolution: the input is upscaled so that the estimated 1 mm ≥ 20 px, capped for performance.

- `source: ImageData` — original import (never modified).
- `adjustments: Adjustment[]` — non-destructive stack (§5.2). Applying it to `source` produces `adjusted`.
- `ink: Uint8Array` — 1 = line/ink pixel (line art) or dark pixel (filled), from `adjusted`, then **edits overlaid**.
- `edits: Uint8Array` — per-pixel user override: 0 = none, 1 = forced wood/ink, 2 = forced hole. Kept separate so adjustments can change without losing brush work.
- `regionId: Int32Array` — connected-component label of each non-ink pixel.
- `regionClass: Map<regionId, 'wood' | 'hole' | 'waste'>` — set by auto-guess and bucket clicks.
- `outerCut: { mode: 'follow' | 'border' | 'custom', confirmed: boolean, params }`
- `woodMask: Uint8Array` — derived.
- `issues: Issue[]` — derived.
- `history: Patch[]` — undo stack (changed pixel rectangles, class changes, adjustment changes).

**Region identity across edits:** when an edit or adjustment splits or merges regions, carry over the class by majority overlap with the previous labels, so the user's bucket choices survive.

### 7.2 Issue object

```ts
type Issue = {
  id: string;
  type: 'island' | 'leak' | 'thin' | 'near_touch' | 'speck_hole' | 'speck_island' | 'floating_detail';
  severity: 'critical' | 'warning' | 'info';
  family: 'structure' | 'dimension';
  estimated: boolean;          // true if it depends on an estimated scale
  label: string;               // plain words, e.g. "Leak: bottom of the 'e'"
  bbox: [x, y, w, h];          // pixels
  anchor: [x, y];              // pin position
  measure?: number;            // gap or stroke width in mm
  regions?: number[];
  status: 'open' | 'resolved' | 'ignored';
  suggestions?: Suggestion[];  // v2
};
```

### 7.3 Lines on export (line-art input)

The drawn lines are part of the **wood** (they are the outline the eye sees, as in the Julie result). The laser path is the boundary between wood (lines ∪ wood regions) and holes/waste. So a line between two holes becomes a thin wood strut, and must pass the `min_wood_width` check. Floating details follow §4.1.

---

## 8. Algorithms (v1)

### 8.1 Preprocess
Apply the adjustment stack (§5.2) → threshold → remove ink specks below the speck size.

### 8.2 Regions
Connected-component labeling (4-connectivity for regions, 8-connectivity for ink) with two-pass union-find on typed arrays.

### 8.3 Outer cut and waste
Follow §5.3:
1. Find wood components.
2. Test each large one for a closed loop that encloses most other wood (a frame).
3. The outer cut is the outer boundary of the main body (framed) or its silhouette (unframed).
4. Regions outside it are `waste`.

### 8.4 Auto-classification guess (line art)
Heuristic; the user corrects it with the Bucket.
1. Waste = outside the outer cut.
2. Compute the **thickness** of each region (max of the distance transform) and its area.
3. Thin, elongated regions (thickness < 2 × `min_wood_width`) are guessed **wood**: these are "double-line" strokes like the frame band and vines.
4. Closed shapes enclosed by a single contour (petals, leaves, letter bodies) are guessed **wood** when they sit inside or attach to a wood stroke, otherwise **hole**. Fallback: alternate classes across shared boundaries (parity flood from waste: waste → wood → hole → wood…).
5. Give each guess a confidence score. Low-confidence regions get a subtle dashed outline.

v1 just needs to be "mostly right". The Bucket makes corrections cost one click.

### 8.5 Islands
Connected components of `woodMask` (8-connectivity). All components except the main body are islands. Those below `min_island_area` are speck islands.

### 8.6 Leaks
- For each hole region, compute a morphological **opening** with radius = gap threshold / 2. If the opened region splits into 2+ significant parts, the narrow neck between them is a gap → report a leak at the neck, with its width.
- Also report a leak between a hole region and the waste when they meet through a thin neck.
- Extra cue (raises confidence): the neck lines up with two line endpoints facing each other (endpoint detection on the skeleton of `ink`).
- Store the neck points; the Flow test uses them (§6.6).

### 8.7 Thin wood and near-touch
- Distance transform of `woodMask` → skeleton → points where 2 × distance < `min_wood_width` → cluster them into issues.
- Same on the hole mask with `min_hole_width` → near-touch issues.

### 8.8 Floating details
Ink pixels with wood regions on both sides → cluster by connected ink component → one issue each.

### 8.9 Flow test
Geodesic BFS distance map per hole region, from the seed (click point, or the region's deepest interior point for "test all"). Computed in the worker, sent as a `Float32Array` or texture.

### 8.10 Incremental analysis
After a brush stroke, recompute inside the dirty rectangle expanded by a margin. Island and region checks are global but fast with union-find. All analysis runs in a **Web Worker**, so the UI never blocks.

---

## 9. Export

**SVG for XCS:**
- `width`/`height` in mm, with a `viewBox` in mm units (1 user unit = 1 mm).
- Vectorize the boundaries of `woodMask` with a potrace-style tracer: smooth Bézier curves, corner detection, and a configurable simplification tolerance (default 0.05 mm).
- **Cut group** (`id="cut"`, stroke `#FF0000`, `stroke-width 0.1`, `fill none`): the outer cut plus every hole contour, as closed paths. No duplicated or overlapping paths.
- **Score group** (`id="score"`, stroke `#0000FF`): floating details set to *score*, as centerline paths.
- **Engrave group** (`id="engrave"`, fill `#000000`): floating details set to *engrave*, as filled line shapes.
- Floating details are never in the cut group.
- No embedded raster, no transforms on paths, no `<text>`.
- Optional "Export filled" variant: one compound path with `fill-rule="evenodd"`, black.

**Also export:**
- `project.ajoure.json` — source image reference, adjustment stack, edits, region classes, outer cut, ignored issues and settings.
- PNG of the wood/hole map (for sharing).

**Optional kerf compensation** (off by default): offset hole contours inward by kerf/2, so dimensions are exact.

---

## 10. Technical architecture (v1)

- **Desktop web app**, running fully locally in Chrome or Safari on macOS. No server and no account; images never leave the machine. It can later be wrapped as a native Mac app (e.g. Tauri) without rewriting it.
- **Stack:** TypeScript with Canvas 2D for editing, and WebGL for display compositing and the Flow animation. Web Workers do the analysis. Keep the UI layer light: vanilla or Preact/Svelte.
- **Libraries:**
  - Vectorization: a JS port of potrace (or an equivalent) behind a swappable interface.
  - Image ops (labeling, distance transforms, morphology, BFS, levels, unsharp mask, median): implement them on typed arrays (simple and fast), or use OpenCV.js if bundle size is acceptable. Small canvas filter libraries exist for gamma, posterize and levels if needed.
- **Performance targets** (M1/M2 MacBook):
  - 2000×8000 px working image: instant scan < 2 s
  - Re-analysis after a stroke < 300 ms
  - Adjustment slider preview at ≥ 30 fps (analysis can lag slightly behind and catch up)
  - Pan, zoom and Flow animation at 60 fps
- **Persistence:** autosave the project to IndexedDB. Open and save `.ajoure.json`.

---

## 11. Roadmap

### v1: Safety net (this build)
- Instant scan with leak and island pins on import
- Adjust panel
- Region classification with the Bucket
- Outer cut detection and confirmation
- All checks from §4
- Pins, Issues list, focus mode and Navigator
- Manual tools and undo/redo
- Flow test (Quick and animated)
- Optional size
- Cut preview
- SVG export

### v2: The swipe (suggested fixes)
- For each issue, generate 3–6 candidate fixes. Examples:
  - **Island:** shortest bridge to the main body; bridge along the nearest stroke direction; two short bridges for a large island; remove the island.
  - **Leak:** close the gap by joining the facing endpoints (straight or curved); close at the narrowest point; or "it's intended", which merges the regions.
  - **Thin wood:** thicken locally; thicken the whole stroke; convert to hole.
- **Fix tray:** ◀ ▶ (trackpad swipe or arrow keys) cycles through candidates with a live preview on the canvas; ✓ applies the fix. Each candidate has a tiny label ("bridge left", "along the vine").
- Candidates are computed, not generated by AI: a geometric search over directions and attach points, scored by length, visibility and strength.
- "Fix all critical with best suggestion", reviewable afterwards.

### v3: Signature and touch
- **Decorative bridges:** Art Nouveau tendril, small leaf, curl, whiplash curve. Generated as vector geometry that follows the local stroke flow, so fixes look like part of the drawing. An optional generative model for local in-style inpainting is offered as one candidate among the computed ones.
- **iPad + Apple Pencil version.**

### Later
- Prompt helper: generation prompts that produce cut-friendly images ("single connected ornamental piece, thick outlines, no floating elements").
- Direct generation inside the app.
- Material library and kerf calibration test-card generator.
- Multi-layer pieces and 3D-print mode (simplify messy color regions), the sister application of the same engine.
- Public release: native packaging, landing page, license.

---

## 12. Acceptance criteria (v1)

1. Drop the **Julie** line-art input: within 2 s, leaks and islands are pinned, without the user setting anything.
2. The auto classification gets at least 90% of regions right.
3. Every place where the hand-made Julie result differs structurally from the input (gaps closed, strokes connected) is flagged as an issue.
4. The animated Flow test visibly escapes through each of those gaps before fixing, and is fully contained after fixing.
5. With Bucket and brush only, a user reproduces a cuttable version equivalent to the hand-made Julie result in **under 10 minutes**.
6. The outer cut follows the outside of the frame, including the hanging ring, and is confirmed in one click.
7. After fixing, the checker reports **0 critical issues**. A cut in 3 mm basswood on the xTool M2 produces one intact piece with no fallen letters or petals.
8. The exported SVG opens in XCS at the correct physical size, with closed paths only and no duplicate lines.
9. Navigation (pinch, two-finger pan, wheel zoom to cursor, Space-drag, Navigator drag) all work smoothly, with no UI freeze above 300 ms during editing.

---

## 13. Out of scope for v1
Accounts, cloud sync, payments, AI generation, suggested-fix swipe (v2), decorative bridges (v3), iPad/touch (v3), multi-layer projects, DXF export, direct machine control.

## 14. Decisions log
- Size is optional; problems are shown before any setup. *(v0.2)*
- Default material: 3 mm basswood. *(v0.2)*
- Floating details (e.g. stamens) are never cut: they are **Score** (default), Engrave or Drop. They are handled in a secondary Finishing details step, after the main paint-split work, and never as issue pins. *(v0.3)*
- Outer cut is auto-detected from the main components, and the user confirms it; a "Add a border" option is available. *(v0.2)*
- iPad moved to v3. *(v0.2)*
