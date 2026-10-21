// @ts-check
// Ajouré — app entry. Wires the canvas view, navigation, Navigator, loaders, the scan,
// the fixing tools (edits + undo) and the issue flow (focus, fix tray, ignore).

import { CanvasView } from './view.js';
import { NavigationInput } from './input.js';
import { Navigator } from './navigator.js';
import { loadBlob, bindLoaders, fetchSample, LoadError } from './loader.js';
import { bindTooltips, createToast, hintOnce, bindPanels } from './ui.js';
import { formatPercent, fitView, zoomAt } from './viewport.js';
import { Scanner } from './scanner.js';
import { loadSettings, saveSettings, bindPopover } from './settings.js';
import { EditDoc } from './doc.js';
import { ToolController, TOOL_NAMES } from './tools.js';
import { EDIT_WOOD, EDIT_HOLE, WOOD, PX_WOOD, PX_HOLE, PX_LINE } from '../engine/analyze.js';

/** @typedef {import('./scanner.js').ScanResult} ScanResult */
/** @typedef {import('../engine/analyze.js').Issue} Issue */
/** @typedef {import('./tools.js').ToolId} ToolId */
/** @typedef {import('./doc.js').Rect} Rect */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const app = $('app');
const stage = $('stage');
const docName = $('docName');
const zoomPill = $('zoomPill');
const fileInput = /** @type {HTMLInputElement} */ ($('fileInput'));
const toast = createToast($('toast'));

const view = new CanvasView(/** @type {HTMLCanvasElement} */ ($('view')), stage);

const navPanel = new Navigator(
  {
    well: $('navWell'),
    canvas: /** @type {HTMLCanvasElement} */ ($('navCanvas')),
    slider: /** @type {HTMLInputElement} */ ($('zoomSlider')),
    field: /** @type {HTMLInputElement} */ ($('zoomField')),
    zoomIn: $('zoomIn'),
    zoomOut: $('zoomOut'),
  },
  view,
);

// ---- document state -------------------------------------------------------------------

/** @type {ScanResult|null} */
let scan = null;
/** @type {EditDoc|null} */
let doc = null;
/** @type {HTMLCanvasElement|null} */
let editLayer = null;
/** Ignored issue ids (survive re-scans; matched by type + nearby position). */
const ignored = new Set();

const tools = new ToolController({
  view,
  getDoc: () => (view.image ? doc : null),
  getScan: () => scan,
  onPaint: (rect) => updateEditLayer(rect),
  onBucket: (region, cls, x, y) => bucketClick(region, cls, x, y),
  say: (m) => toast(m, 2200),
});

const toolButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.toolbar .tool'));
const input = new NavigationInput(stage, view, {
  onToolChange: (tool) => {
    for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    tools.setTool(tool);
    // The Bucket is about wood vs hole: show that view.
    if (tool === 'bucket' && scan) setMode('woodhole');
  },
  onClick: (x, y) => {
    const hit = view.hitMarker(x, y);
    if (!hit) {
      if (view.focusId) focusIssue(null);
      return false;
    }
    if (hit.length > 1) {
      // A cluster of pins: zoom in on it.
      view.glideTo(Math.min(64, view.current().scale * 2.5), { x, y });
      return true;
    }
    focusIssue(hit[0].id);
    return true;
  },
  onToolDown: (e, p) => tools.down(e, p),
  onToolMove: (e, p) => tools.move(e, p),
  onToolUp: (e, p) => tools.up(e, p),
  onHover: (p) => tools.hover(p),
});

for (const b of toolButtons) {
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    input.setTool(/** @type {ToolId} */ (b.dataset.tool));
  });
}

// Mac buttons don't keep keyboard focus after a click; this also keeps Space free for panning.
document.addEventListener('pointerup', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest?.('button');
  if (b) b.blur();
});

// Safari takes ⌘1/⌘2 and ⌘+/⌘−/⌘0 for itself; there, show the ⌃⌘ versions (both work everywhere).
const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const ZOOM_MOD = isSafari ? '⌃⌘' : '⌘';
if (isSafari) {
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-key]'))) {
    const k = el.dataset.key || '';
    if (/^⌘[0-9+−]$/.test(k)) el.dataset.key = ZOOM_MOD + k.slice(1);
  }
}

const viewCtl = $('viewCtl');
const actualBtn = $('actualBtn');
$('fitBtn').addEventListener('click', () => view.glideFit());
actualBtn.addEventListener('click', () => view.glideTo(1));

let dims = '';
view.onChange((v) => {
  zoomPill.textContent = view.image ? `${formatPercent(v.scale)}  ·  ${dims}` : '';
  // Show Fit / 100% once you've moved away from the fitted view.
  const f = fitView(v);
  const atFit =
    Math.abs(v.scale - f.scale) < 1e-4 && Math.abs(v.tx - f.tx) < 1 && Math.abs(v.ty - f.ty) < 1;
  viewCtl.dataset.visible = String(!!view.image && !atFit);
  actualBtn.hidden = Math.abs(v.scale - 1) < 1e-4;
});

// ---- opening images ---------------------------------------------------------------------

/** @param {Blob} blob @param {string} name */
async function open(blob, name) {
  try {
    const img = await loadBlob(blob, name);
    if (view.image) view.image.close();
    dims = `${img.width} × ${img.height} px`;
    docName.textContent = img.name;
    document.title = `${img.name} — Ajouré`;
    app.dataset.state = 'loaded';
    closeTray();
    view.setImage(img.bitmap);
    navPanel.setImage(img.bitmap);
    setMode('design');
    // Fresh document: empty edits layer, no ignored issues, empty history.
    doc = new EditDoc(img.width, img.height);
    doc.onChange((rect) => onDocChange(rect));
    editLayer = document.createElement('canvas');
    editLayer.width = img.width;
    editLayer.height = img.height;
    view.setEditLayer(editLayer);
    ignored.clear();
    updateUndoUi();
    runInitialScan(img.bitmap);
    hintOnce(
      $('hint'),
      'navigate',
      `Pinch or scroll to move around <span aria-hidden="true">·</span> hold <kbd>Space</kbd> to pan with any tool <span aria-hidden="true">·</span> <kbd>${ZOOM_MOD}0</kbd> fits`,
    );
  } catch (err) {
    toast(err instanceof LoadError ? err.message : 'Something went wrong opening that image.');
    if (!(err instanceof LoadError)) console.error(err);
  }
}

bindLoaders({ app, fileInput, onBlob: open });

$('openBtn').addEventListener('click', () => fileInput.click());
$('sampleBtn').addEventListener('click', async () => {
  try {
    await open(await fetchSample(), 'Julie mon Amour.png');
  } catch (err) {
    toast(err instanceof LoadError ? err.message : 'Couldn’t load the sample.');
  }
});

// ---- scanning ---------------------------------------------------------------------------

const scanner = new Scanner();
const scanStatus = $('scanStatus');
const issueList = $('issueList');
const issueCount = $('issueCount');
const modeButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-mode]'));
const modeWood = $('modeWood');

/** @param {'idle'|'scanning'|'issues'|'clean'|'error'} state @param {string} text */
function setStatus(state, text) {
  scanStatus.dataset.state = state;
  scanStatus.innerHTML = state === 'idle' ? '' : `<span class="dot"></span>`;
  scanStatus.append(text);
}

/** @param {ImageBitmap} bitmap */
async function runInitialScan(bitmap) {
  scan = null;
  modeWood.setAttribute('aria-disabled', 'true');
  renderIssues();
  setStatus('scanning', 'Scanning…');
  try {
    const t0 = performance.now();
    const res = await scanner.open(bitmap);
    if (!res || view.image !== bitmap) return; // a newer image arrived
    await applyScan(res, true);
    scanStatus.title = `Scanned in ${Math.round(performance.now() - t0)} ms`;
  } catch (err) {
    console.error(err);
    setStatus('error', 'Scan failed');
    toast('The scan failed on this image. Try another, or tell Claude what happened.');
  }
}

let recheckTimer = 0;
/** Re-check after an edit (debounced; only the latest state is analysed). */
function requestRecheck() {
  clearTimeout(recheckTimer);
  recheckTimer = window.setTimeout(async () => {
    if (!doc || !view.image) return;
    const image = view.image;
    setStatus('scanning', 'Checking…');
    try {
      const t0 = performance.now();
      const res = await scanner.update(doc.edits, doc.seeds);
      if (!res || view.image !== image) return;
      await applyScan(res, false);
      scanStatus.title = `Re-checked in ${Math.round(performance.now() - t0)} ms`;
    } catch (err) {
      console.error(err);
      setStatus('error', 'Check failed');
    }
  }, 60);
}

/** @param {ScanResult} res @param {boolean} initial */
async function applyScan(res, initial) {
  const before = scan ? scan.issues.filter((i) => i.status === 'open') : [];
  const prevOrder = scan ? openIssues().map((i) => i.id) : [];
  for (const i of res.issues) if (isIgnored(i)) i.status = 'ignored';
  // Issues that were open and are gone now: flash them green.
  if (!initial) {
    const gone = before.filter((o) => !res.issues.some((n) => sameIssue(o, n)));
    if (gone.length) view.addGhosts(gone);
  }
  scan = res;
  tools.setScale(res.pxPerMm);
  await view.setAnalysis(res);
  tools.clearHover();
  if (view.mode === 'woodhole' && view.woodHole) navPanel.setImage(view.woodHole);
  else navPanel.draw();
  modeWood.setAttribute('aria-disabled', 'false');
  modeWood.dataset.sub = 'White stays · grey is cut out · checkered is outside the piece';
  renderIssues();
  updateStatus();
  // Keep focus on the same issue if it's still there; otherwise move on to the next one.
  const fid = view.focusId;
  if (fid) {
    const still = res.issues.find((i) => i.id === fid);
    if (still) renderTray(still);
    else {
      const open = openIssues();
      const idx = prevOrder.indexOf(fid);
      const next = open.find((i) => prevOrder.indexOf(i.id) > idx) || open[0];
      if (next) focusIssue(next.id);
      else {
        focusIssue(null);
        toast('All clear — no leaks or islands left.', 2600);
      }
    }
  }
}

function updateStatus() {
  if (!scan) return;
  const open = openIssues();
  const leaks = open.filter((i) => i.type === 'leak').length;
  const islands = open.filter((i) => i.type === 'island').length;
  const specks = open.filter((i) => i.type === 'speck_island').length;
  const ign = scan.issues.length - open.length;
  const parts = [];
  if (leaks) parts.push(`${leaks} leak${leaks > 1 ? 's' : ''}`);
  if (islands) parts.push(`${islands} island${islands > 1 ? 's' : ''}`);
  if (specks) parts.push(`${specks} speck${specks > 1 ? 's' : ''}`);
  const tail = ign ? ` · ${ign} ignored` : '';
  if (leaks || islands) setStatus('issues', parts.join(' · ') + tail);
  else setStatus('clean', (specks ? `✓ No leaks or islands · ${parts[0]}` : '✓ No leaks or islands') + tail);
}

/** Open issues in list order. */
function openIssues() {
  return scan ? scan.issues.filter((i) => i.status === 'open') : [];
}

/** Same issue across two scans: same id, or same type within two 8-px cells. @param {Issue} a @param {Issue} b */
function sameIssue(a, b) {
  if (a.id === b.id) return true;
  return a.type === b.type && Math.abs(a.anchor[0] - b.anchor[0]) <= 16 && Math.abs(a.anchor[1] - b.anchor[1]) <= 16;
}

/** @param {Issue} i */
function isIgnored(i) {
  if (ignored.has(i.id)) return true;
  for (const id of ignored) {
    const m = /^(\w+)@(-?\d+),(-?\d+)/.exec(id);
    if (m && m[1] === i.type && Math.abs(+m[2] * 8 - i.anchor[0]) <= 16 && Math.abs(+m[3] * 8 - i.anchor[1]) <= 16) return true;
  }
  return false;
}

// ---- Issues list ----------------------------------------------------------------------

function renderIssues() {
  issueList.innerHTML = '';
  if (!scan) {
    issueCount.textContent = '';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = view.image ? 'Scanning for leaks and islands…' : 'Leaks and islands are listed here as soon as you drop an image.';
    issueList.append(p);
    return;
  }
  const open = openIssues();
  const ign = scan.issues.filter((i) => i.status === 'ignored');
  issueCount.textContent = open.length ? String(open.length) : '';
  if (!open.length) {
    const d = document.createElement('div');
    d.className = 'issue-empty';
    d.innerHTML = '<span class="dot"></span>No leaks or islands';
    issueList.append(d);
  }
  for (const i of open) issueList.append(issueRow(i));
  if (ign.length) {
    const h = document.createElement('div');
    h.className = 'issue-sub';
    h.textContent = `Ignored · ${ign.length}`;
    issueList.append(h);
    for (const i of ign) issueList.append(issueRow(i));
  }
}

/** @param {Issue} i */
function issueRow(i) {
  const b = document.createElement('button');
  b.className = 'issue-row';
  b.dataset.id = i.id;
  b.dataset.severity = i.severity;
  b.dataset.status = i.status;
  if (i.id === view.focusId) b.setAttribute('aria-current', 'true');
  const sev = document.createElement('span');
  sev.className = 'sev';
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = i.label;
  const d = document.createElement('span');
  d.className = 'd';
  d.textContent = i.status === 'ignored' ? `Ignored — ${i.detail}` : i.detail;
  b.append(sev, t, d);
  b.addEventListener('click', () => focusIssue(i.id));
  return b;
}

// ---- focus & fix tray ----------------------------------------------------------------

const tray = $('fixTray');
const ftTools = $('ftTools');
const ftQuick = $('ftQuick');
const ftIgnore = $('ftIgnore');

/** Zoom to an issue, highlight it everywhere and open the fix tray (null clears). @param {string|null} id */
function focusIssue(id) {
  view.setFocus(id);
  for (const row of issueList.querySelectorAll('.issue-row')) {
    if (/** @type {HTMLElement} */ (row).dataset.id === id) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  }
  const issue = id && scan ? scan.issues.find((i) => i.id === id) : null;
  if (!issue) return closeTray();
  view.glideToIssue(issue);
  renderTray(issue);
}

function closeTray() {
  tray.dataset.open = 'false';
  if (view.focusId) view.setFocus(null);
  for (const row of issueList.querySelectorAll('.issue-row[aria-current]')) row.removeAttribute('aria-current');
}

/** Which tools help with which issue, and the quick fix. */
const TRAY_TOOLS = /** @type {Record<string, ToolId[]>} */ ({
  leak: ['wood', 'connector'],
  island: ['connector', 'wood', 'hole'],
  speck_island: ['hole'],
});
const TOOL_ICON = /** @type {Record<string, string>} */ ({
  wood: 'i-brush', hole: 'i-brush', connector: 'i-connector', separator: 'i-scissors', bucket: 'i-bucket', revert: 'i-revert',
});

/** @param {Issue} issue */
function renderTray(issue) {
  const open = openIssues();
  const idx = open.findIndex((i) => i.id === issue.id);
  $('ftCount').textContent = idx >= 0 ? `${idx + 1}/${open.length}` : `–/${open.length}`;
  const sev = $('ftSev');
  sev.dataset.severity = issue.severity;
  sev.dataset.status = issue.status;
  $('ftTitle').textContent = issue.label;
  $('ftDetail').textContent = issue.detail;
  ftTools.innerHTML = '';
  for (const t of TRAY_TOOLS[issue.type] || []) {
    const b = document.createElement('button');
    b.className = `tool${t === 'wood' ? ' tool-wood' : t === 'hole' ? ' tool-hole' : ''}`;
    b.setAttribute('aria-pressed', String(input.tool === t));
    b.dataset.tip = TOOL_NAMES[t];
    b.dataset.key = { wood: 'W', hole: 'E', connector: 'C', separator: 'X', bucket: 'B', revert: 'R', hand: 'H', zoom: 'Z' }[t];
    b.dataset.side = 'top';
    b.innerHTML = `<svg><use href="#${TOOL_ICON[t]}"/></svg>${t === 'wood' || t === 'hole' ? '<i class="swatch"></i>' : ''}`;
    b.addEventListener('click', () => {
      input.setTool(t);
      renderTray(issue);
    });
    ftTools.append(b);
  }
  const quick = quickFixLabel(issue);
  ftQuick.hidden = !quick || issue.status !== 'open';
  ftQuick.textContent = quick || '';
  ftIgnore.textContent = issue.status === 'ignored' ? 'Restore' : 'Ignore';
  ftIgnore.dataset.tip = issue.status === 'ignored' ? 'Bring this issue back' : 'Ignore this issue';
  tray.dataset.open = 'true';
}

/** @param {Issue} issue */
function quickFixLabel(issue) {
  if (issue.type === 'leak' && issue.fix) return 'Close gap';
  if (issue.type === 'island' || issue.type === 'speck_island') return 'Remove';
  return '';
}

/** @param {number} dir */
function step(dir) {
  const open = openIssues();
  if (!open.length) return;
  const idx = open.findIndex((i) => i.id === view.focusId);
  const next = idx < 0 ? open[dir > 0 ? 0 : open.length - 1] : open[(idx + dir + open.length) % open.length];
  focusIssue(next.id);
}

function currentIssue() {
  return view.focusId && scan ? scan.issues.find((i) => i.id === view.focusId) || null : null;
}

/** The one-click fix for the focused issue. */
function quickFix() {
  const issue = currentIssue();
  if (!issue || issue.status !== 'open' || !doc || !scan) return;
  if (issue.type === 'leak' && issue.fix) {
    // Draw the missing bit of line in the drawing's own stroke width, a touch past both ends.
    const { ax, ay, bx, by } = issue.fix;
    const r = Math.max(1.5, scan.strokeW / 2);
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    doc.beginStroke('Close gap');
    updateEditLayer(doc.segment(ax - ux * r, ay - uy * r, bx + ux * r, by + uy * r, r, EDIT_WOOD));
    doc.endStroke();
  } else if (issue.type === 'island' || issue.type === 'speck_island') {
    const px = componentPixels(scan, issue);
    if (!px.length) return;
    doc.beginStroke(issue.type === 'island' ? 'Remove island' : 'Remove speck');
    updateEditLayer(doc.setPixels(px, EDIT_HOLE));
    doc.endStroke();
  }
}

/** Pixels of the loose wood piece an island issue points at (lines + wood, 8-connected). @param {ScanResult} s @param {Issue} issue */
function componentPixels(s, issue) {
  const { w, h, classMap } = s;
  const isWood = (/** @type {number} */ p) => classMap[p] === PX_WOOD || classMap[p] === PX_LINE;
  const start = issue.anchor[1] * w + issue.anchor[0];
  if (!isWood(start)) return [];
  const [bx, by, bw, bh] = issue.bbox;
  const seen = new Set([start]);
  const stack = [start];
  /** @type {number[]} */
  const out = [];
  while (stack.length) {
    const p = /** @type {number} */ (stack.pop());
    out.push(p);
    const x = p % w;
    const y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < bx - 1 || yy < by - 1 || xx > bx + bw || yy > by + bh || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (!seen.has(q) && isWood(q)) {
          seen.add(q);
          stack.push(q);
        }
      }
    }
  }
  return out;
}

function toggleIgnore() {
  const issue = currentIssue();
  if (!issue || !scan) return;
  if (issue.status === 'open') {
    ignored.add(issue.id);
    issue.status = 'ignored';
  } else {
    for (const id of [...ignored]) {
      const m = /^(\w+)@(-?\d+),(-?\d+)/.exec(id);
      if (id === issue.id || (m && m[1] === issue.type && Math.abs(+m[2] * 8 - issue.anchor[0]) <= 16 && Math.abs(+m[3] * 8 - issue.anchor[1]) <= 16)) ignored.delete(id);
    }
    issue.status = 'open';
  }
  renderIssues();
  updateStatus();
  navPanel.draw();
  view.requestRender();
  // Ignoring moves on to the next open issue, like archiving a message.
  if (issue.status === 'ignored') {
    const next = openIssues()[0];
    if (next) focusIssue(next.id);
    else renderTray(issue);
  } else renderTray(issue);
}

$('ftPrev').addEventListener('click', () => step(-1));
$('ftNext').addEventListener('click', () => step(1));
ftQuick.addEventListener('click', quickFix);
ftIgnore.addEventListener('click', toggleIgnore);
$('ftClose').addEventListener('click', () => closeTray());

// ---- edits -----------------------------------------------------------------------------

const PAINT_WOOD = [44, 44, 46, 255];
const PAINT_HOLE = [95, 95, 100, 255];

/** Redraw part of the edits layer from the document (null = nothing to redraw). @param {Rect|null} rect */
function updateEditLayer(rect) {
  if (!rect || !doc || !editLayer) return;
  const [x, y, w, h] = rect;
  const ctx = /** @type {CanvasRenderingContext2D} */ (editLayer.getContext('2d'));
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const e = doc.edits[(y + yy) * doc.w + x + xx];
      if (!e) continue;
      d.set(e === EDIT_WOOD ? PAINT_WOOD : PAINT_HOLE, (yy * w + xx) * 4);
    }
  }
  ctx.putImageData(img, x, y);
  view.requestRender();
}

/** @param {Rect|null} rect */
function onDocChange(rect) {
  updateEditLayer(rect);
  updateUndoUi();
  requestRecheck();
}

/** @param {number} region @param {number} cls @param {number} x @param {number} y */
function bucketClick(region, cls, x, y) {
  if (!doc || !scan) return;
  // Show the fill right away; the re-check confirms it (and updates islands/leaks).
  const px = cls === WOOD ? PX_WOOD : PX_HOLE;
  const { labels, classMap } = scan;
  for (let p = 0; p < labels.length; p++) if (labels[p] === region) classMap[p] = px;
  scan.regionClass[region] = cls;
  view.setAnalysis(scan);
  doc.addSeed({ x, y, cls }, cls === WOOD ? 'Bucket: wood' : 'Bucket: hole');
}

const undoBtn = $('undoBtn');
const redoBtn = $('redoBtn');
const editDot = $('editDot');
function updateUndoUi() {
  undoBtn.setAttribute('aria-disabled', String(!doc?.canUndo));
  redoBtn.setAttribute('aria-disabled', String(!doc?.canRedo));
  const last = doc?.undoStack[doc.undoStack.length - 1];
  const next = doc?.redoStack[doc.redoStack.length - 1];
  undoBtn.dataset.tip = last ? `Undo ${last.label}` : 'Undo';
  redoBtn.dataset.tip = next ? `Redo ${next.label}` : 'Redo';
  editDot.hidden = !doc?.edited;
}
function undo() {
  const label = doc?.undo();
  if (label) toast(`Undo ${label}`, 1200);
}
function redo() {
  const label = doc?.redo();
  if (label) toast(`Redo ${label}`, 1200);
}
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// ---- view modes ----------------------------------------------------------------------

/** @param {'design'|'woodhole'} mode */
function setMode(mode) {
  view.setMode(mode);
  for (const b of modeButtons) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  const src = mode === 'woodhole' && view.woodHole ? view.woodHole : view.image;
  if (src) navPanel.setImage(src);
}
for (const b of modeButtons) {
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    setMode(/** @type {'design'|'woodhole'} */ (b.dataset.mode));
  });
}

// ---- keyboard ----------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  if (t.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (t).type !== 'range' && /** @type {HTMLInputElement} */ (t).type !== 'checkbox') return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'o') {
    e.preventDefault();
    fileInput.click();
  } else if (mod && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && k === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && e.key === ',') {
    e.preventDefault();
    settingsPop.open();
  } else if (!mod && (e.key === '[' || e.key === ']')) {
    const label = tools.resize(e.key === ']' ? 1 : -1);
    if (label) toast(label, 900);
  } else if (e.key === 'Escape') {
    if (tools.conn || tools.sep) tools.cancel();
    else if (view.focusId) closeTray();
  } else if (!mod && !e.altKey && view.focusId) {
    if (k === 'n') step(1);
    else if (k === 'p') step(-1);
    else if (k === 'i') toggleIgnore();
    else if (e.key === 'Enter') {
      e.preventDefault();
      quickFix();
    }
  } else if (!mod && !e.altKey && scan && (k === 'n' || k === 'p') && openIssues().length) {
    step(k === 'n' ? 1 : -1);
  }
});

// ---- settings ----------------------------------------------------------------------

const settings = loadSettings();
const settingsPop = bindPopover($('settingsBtn'), $('settingsPop'));
const markerButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-markers]'));
/** @param {'box'|'pin'} style */
function applyMarkers(style) {
  settings.markers = style;
  view.setMarkerStyle(style);
  for (const b of markerButtons) b.setAttribute('aria-checked', String(b.dataset.markers === style));
}
for (const b of markerButtons) {
  b.addEventListener('click', () => {
    applyMarkers(/** @type {'box'|'pin'} */ (b.dataset.markers));
    saveSettings(settings);
  });
}
applyMarkers(settings.markers);
const showIgnored = /** @type {HTMLInputElement} */ ($('showIgnored'));
showIgnored.checked = settings.showIgnored;
view.showIgnored = settings.showIgnored;
showIgnored.addEventListener('change', () => {
  settings.showIgnored = showIgnored.checked;
  view.showIgnored = showIgnored.checked;
  view.requestRender();
  saveSettings(settings);
});

bindTooltips($('tooltip'));
bindPanels(document);

// Handy for debugging from the console.
Object.assign(window, {
  ajoure: {
    view, input, navPanel, tools,
    get scan() { return scan; },
    get doc() { return doc; },
    zoomAt,
  },
});
