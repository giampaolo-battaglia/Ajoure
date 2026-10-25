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
import { EditDoc, union } from './doc.js';
import { ToolController, TOOL_NAMES } from './tools.js';
import { FlowReveal } from './water.js';
import { encodeProject, decodeProject, saveBlob, isProjectName, writeToHandle, pickFileToOpen, PROJECT_EXT, MAX_VERSIONS } from './project.js';
import { EDIT_WOOD, EDIT_HOLE, EDIT_PAPER, WOOD, HOLE, PX_WOOD, PX_HOLE, PX_LINE, SEED_ENGRAVE, SEED_LINE_SCORE, SEED_LINE_ENGRAVE, MATERIALS, BASSWOOD_3MM, REFERENCE_WIDTH_MM, DETECTION } from '../engine/analyze.js';
import { NO_ADJUST, isAdjusted } from '../engine/adjust.js';

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
/** @type {HTMLCanvasElement|null} the eraser's paint */
let paperLayer = null;
/** Ignored issue ids (survive re-scans; matched by type + nearby position). */
const ignored = new Set();
/**
 * What the next scan should use: image adjustments and the real width (per image), material (remembered).
 * @type {{adjust: import('../engine/adjust.js').Adjustments, widthMm: number|null, profile: import('../engine/analyze.js').Material}}
 */
const scanOpts = { adjust: { ...NO_ADJUST }, widthMm: null, profile: BASSWOOD_3MM };
/** The scan summary before the latest adjustment, to show "leaks 7 → 2". @type {Record<string, number>|null} */
let deltaFrom = null;

const tools = new ToolController({
  view,
  getDoc: () => (view.image ? doc : null),
  getScan: () => scan,
  onPaint: (rect) => updateEditLayer(rect),
  onBucket: (region, cls, x, y) => bucketClick(region, cls, x, y),
  onEngrave: (region, x, y) => engraveArea(region, x, y),
  onEngraveLine: (x, y) => engraveLine(x, y),
  onCutToWood: (x, y) => cutToWood(x, y),
  say: (m) => toast(m, 2200),
});

const toolButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.toolbar .tool'));
const input = new NavigationInput(stage, view, {
  onToolChange: (tool) => {
    for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    tools.setTool(tool);
    syncToolOpts();
    // Editing happens on the drawing, not on the cut preview or the plan (the Engrave tool works on the plan).
    if ((view.mode === 'cut' || view.mode === 'plan') && tool !== 'hand' && tool !== 'zoom' && tool !== 'engrave') setMode('design');
    // The Bucket is about wood vs hole: show that view. Engraving is about what the laser does: the plan.
    if (tool === 'bucket' && scan) setMode('woodhole');
    if (tool === 'engrave' && scan) setMode('plan');
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
  onHover: (p) => {
    tools.hover(p);
    planTip(p);
  },
  toolCursor: () => tools.cursor(),
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

/** The original image file of the open document (saved inside projects). @type {Blob|null} */
let imageBlob = null;
/** Unsaved-changes tracking: every change bumps changeSeq; saving catches savedSeq up. */
let changeSeq = 0;
let savedSeq = 0;
const isDirty = () => !!doc && changeSeq !== savedSeq;
function markChanged() {
  changeSeq++;
  updateDirty();
}
function updateDirty() {
  editDot.hidden = !isDirty();
}

/** The .ajoure file this document lives in (Chrome: Save writes back to it). @type {any} */
let fileHandle = null;
/** Every save of this project, oldest first (kept inside the file). @type {import('./project.js').SavedVersion[]} */
let versions = [];

/**
 * Open anything: an image, or an Ajouré project. Asks first if there are unsaved changes.
 * @param {Blob} blob @param {string} name @param {Promise<any>|any} [handle] the file itself, when the browser gives it
 */
async function open(blob, name, handle = null) {
  if (!(await confirmDiscard())) return;
  if (isProjectName(name) || blob.type === 'application/json') {
    try {
      const p = await decodeProject(blob);
      const h = await Promise.resolve(handle).catch(() => null);
      await openImage(p.image, `${p.name}.png`, p);
      fileHandle = h && h.kind === 'file' ? h : null;
      versions = p.versions || [];
      renderVersions();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That project couldn’t be opened.');
    }
    return;
  }
  await openImage(blob, name, null);
  fileHandle = null; // an image is never overwritten: the first Save asks where the project goes
  versions = [];
  renderVersions();
}

/** Open dialog: keeps hold of the file in Chrome (so Save writes back to it), plain picker elsewhere. */
async function openDialog() {
  const r = await pickFileToOpen();
  if (r === 'unsupported') return fileInput.click();
  if (r) open(r.file, r.file.name, r.handle);
}

/**
 * @param {Blob} blob @param {string} name
 * @param {import('./project.js').ProjectData|null} restore  a saved project to put back
 */
async function openImage(blob, name, restore) {
  try {
    const img = await loadBlob(blob, name);
    if (restore && (img.width !== restore.w || img.height !== restore.h)) throw new LoadError('That project’s image doesn’t match its edits.');
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
    paperLayer = document.createElement('canvas');
    paperLayer.width = img.width;
    paperLayer.height = img.height;
    view.setEditLayer(editLayer, paperLayer);
    ignored.clear();
    imageBlob = blob;
    scanOpts.adjust = { ...NO_ADJUST };
    scanOpts.widthMm = null;
    deltaFrom = null;
    if (restore) {
      // Put the saved work back; the history starts fresh from here.
      doc.edits.set(restore.edits);
      doc.seeds = restore.seeds.map((q) => ({ ...q }));
      scanOpts.adjust = { ...NO_ADJUST, ...restore.adjust };
      scanOpts.widthMm = restore.widthMm;
      const m = MATERIALS.find((x) => x.name === restore.material);
      if (m) {
        scanOpts.profile = m;
        $('materialName').textContent = m.name;
        renderMaterials();
      }
      for (const id of restore.ignored) ignored.add(id);
      // The step history saved with the project: go back in time as if you'd never closed it.
      if (restore.history) {
        doc.undoStack = restore.history.undo;
        doc.redoStack = restore.history.redo;
        doc.baseId = restore.history.baseId;
        doc.nextId = restore.history.nextId;
      }
      updateEditLayer([0, 0, img.width, img.height]);
    }
    doc.settings = currentSettings();
    changeSeq = savedSeq = 0;
    updateDirty();
    syncAdjustUi();
    updateUndoUi();
    runInitialScan(img.bitmap, !!restore && (restore.seeds.length > 0 || restore.edits.some((v) => v !== 0)));
    if (restore) toast(`Opened project “${restore.name}”`, 1600);
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

$('openBtn').addEventListener('click', () => openDialog());
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
const modePlan = $('modePlan');
const planLegend = $('planLegend');

/** The last finished check's summary (a saved version is labelled with it). */
let lastResultText = '';
/** @param {'idle'|'scanning'|'issues'|'warn'|'clean'|'error'} state @param {string} text */
function setStatus(state, text) {
  if (state !== 'scanning' && state !== 'idle' && state !== 'error') lastResultText = text;
  scanStatus.dataset.state = state;
  scanStatus.innerHTML = state === 'idle' ? '' : `<span class="dot"></span>`;
  const t = document.createElement('span');
  t.className = 'st-text';
  t.textContent = text;
  scanStatus.append(t);
  scanStatus.title = text; // the whole line, if the pill is too narrow to show it
}

/** @param {ImageBitmap} bitmap @param {boolean} [withEdits] a restored project: re-check with its edits right after */
async function runInitialScan(bitmap, withEdits = false) {
  scan = null;
  clearFlow();
  flowBtn.setAttribute('aria-disabled', 'true');
  exportBtn.setAttribute('aria-disabled', 'true');
  modeCut.setAttribute('aria-disabled', 'true');
  modePlan.setAttribute('aria-disabled', 'true');
  if (view.mode === 'cut' || view.mode === 'plan') setMode('design');
  view.setCutPreview(null, 1);
  modeWood.setAttribute('aria-disabled', 'true');
  renderIssues();
  setStatus('scanning', 'Scanning…');
  try {
    const t0 = performance.now();
    const res = await scanner.open(bitmap, { ...scanOpts });
    if (!res || view.image !== bitmap) return; // a newer image arrived
    await applyScan(res, true);
    if (withEdits) requestRecheck();
    scanStatus.title += ` · scanned in ${Math.round(performance.now() - t0)} ms`;
  } catch (err) {
    console.error(err);
    setStatus('error', 'Scan failed');
    toast('The scan failed on this image. Try another, or tell Claude what happened.');
  }
}

let recheckTimer = 0;
let optsChanged = false;
/** Re-check after an edit or a settings change (debounced; only the latest state is analysed). @param {boolean} [withOpts] */
function requestRecheck(withOpts = false) {
  if (withOpts) {
    markChanged();
    if (!optsChanged && scan) deltaFrom = { ...scan.summary };
    optsChanged = true;
  }
  clearTimeout(recheckTimer);
  recheckTimer = window.setTimeout(async () => {
    if (!doc || !view.image) return;
    const image = view.image;
    setStatus('scanning', 'Checking…');
    try {
      const t0 = performance.now();
      const opts = optsChanged ? { ...scanOpts } : undefined;
      optsChanged = false;
      const res = await scanner.update(doc.edits, doc.seeds, opts);
      if (!res || view.image !== image) return;
      await applyScan(res, false);
      scanStatus.title += ` · re-checked in ${Math.round(performance.now() - t0)} ms`;
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
  clearFlow();
  flowBtn.setAttribute('aria-disabled', 'false');
  exportBtn.setAttribute('aria-disabled', 'false');
  modeCut.setAttribute('aria-disabled', 'false');
  modePlan.setAttribute('aria-disabled', 'false');
  if (view.mode === 'cut' || view.mode === 'plan') showCutPreview();
  tools.setScale(res.pxPerMm, scanOpts.profile);
  view.setAdjusted(isAdjusted(scanOpts.adjust) ? traceCanvas(res) : null);
  syncScanControls(res);
  await view.setAnalysis(res);
  tools.clearHover();
  refreshNavigator();
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
  const n = (/** @type {string} */ t) => open.filter((i) => i.type === t).length;
  const leaks = n('leak');
  const islands = n('island');
  const ign = scan.issues.length - open.length;
  /** @type {[number, string, string][]} */
  const rest = [
    [n('thin'), 'thin spot', 'thin spots'],
    [n('near_touch'), 'near-touch', 'near-touches'],
    [n('speck_island') + n('speck_hole'), 'speck', 'specks'],
    [n('opening'), 'open outline', 'open outlines'],
  ];
  const restText = rest.filter(([c]) => c).map(([c, one, many]) => `${c} ${c > 1 ? many : one}`);
  const est = scan.estimated && restText.length ? ' (est.)' : '';
  const parts = [];
  if (leaks) parts.push(`${leaks} leak${leaks > 1 ? 's' : ''}`);
  if (islands) parts.push(`${islands} island${islands > 1 ? 's' : ''}`);
  const tail = ign ? ` · ${ign} ignored` : '';
  if (leaks || islands) setStatus('issues', [...parts, ...restText].join(' · ') + est + tail);
  else if (restText.length) setStatus('warn', `✓ No leaks or islands · ${restText.join(' · ')}${est}${tail}`);
  else setStatus('clean', '✓ No leaks or islands' + tail);
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
    d.innerHTML = '<span class="dot"></span>Nothing to fix';
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
  if (i.estimated && i.status !== 'ignored') {
    const est = document.createElement('span');
    est.className = 'badge';
    est.textContent = 'est';
    est.title = 'Measured with the estimated size; enter the real width for exact numbers';
    t.append(' ', est);
  }
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
  thin: ['wood', 'revert'],
  near_touch: ['hole', 'separator', 'revert'],
  speck_hole: ['wood', 'bucket'],
  opening: ['wood', 'connector', 'bucket'],
});
const TOOL_ICON = /** @type {Record<string, string>} */ ({
  wood: 'i-brush', hole: 'i-brush', eraser: 'i-eraser', connector: 'i-connector', separator: 'i-scissors', bucket: 'i-bucket', engrave: 'i-engrave', revert: 'i-revert',
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
    b.dataset.key = { wood: 'W', hole: 'K', eraser: 'E', connector: 'C', separator: 'X', bucket: 'B', engrave: 'G', revert: 'R', hand: 'H', zoom: 'Z' }[t];
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
  if (issue.type === 'opening' && issue.fix?.kind === 'close') return 'Close outline';
  if (issue.type === 'island' || issue.type === 'speck_island') return 'Remove';
  if (issue.type === 'speck_hole' && issue.fix?.kind === 'fill') return 'Fill';
  if (issue.type === 'thin' && issue.fix?.kind === 'thicken') return 'Thicken';
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
  if ((issue.type === 'leak' || issue.type === 'opening') && issue.fix?.kind === 'close') {
    // Draw the missing bit of line in the drawing's own stroke width, a touch past both ends.
    const { ax, ay, bx, by } = issue.fix;
    const r = Math.max(1.5, scan.strokeW / 2);
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    doc.beginStroke(issue.type === 'leak' ? 'Close gap' : 'Close outline');
    updateEditLayer(doc.segment(ax - ux * r, ay - uy * r, bx + ux * r, by + uy * r, r, EDIT_WOOD));
    doc.endStroke();
  } else if (issue.type === 'island' || issue.type === 'speck_island') {
    const px = componentPixels(scan, issue);
    if (!px.length) return;
    doc.beginStroke(issue.type === 'island' ? 'Remove island' : 'Remove speck');
    updateEditLayer(doc.setPixels(px, EDIT_HOLE));
    doc.endStroke();
  } else if (issue.fix?.kind === 'fill') {
    doc.beginStroke('Fill speck hole');
    updateEditLayer(doc.setPixels(issue.fix.pixels, EDIT_WOOD));
    doc.endStroke();
  } else if (issue.fix?.kind === 'thicken') {
    // Wood discs of the minimum width along the thin stretch: it can only get wider.
    const { pts, r } = issue.fix;
    doc.beginStroke('Thicken');
    /** @type {Rect|null} */
    let dirty = null;
    for (let k = 0; k + 1 < pts.length; k += 2) dirty = union(dirty, doc.stamp(pts[k], pts[k + 1], r + 0.5, EDIT_WOOD));
    updateEditLayer(dirty);
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
  markChanged();
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
const PAINT_PAPER = [255, 255, 255, 255];

/** Redraw part of the edits layer from the document (null = nothing to redraw). @param {Rect|null} rect */
function updateEditLayer(rect) {
  if (!rect || !doc || !editLayer || !paperLayer) return;
  const [x, y, w, h] = rect;
  const ctx = /** @type {CanvasRenderingContext2D} */ (editLayer.getContext('2d'));
  const pctx = /** @type {CanvasRenderingContext2D} */ (paperLayer.getContext('2d'));
  const img = ctx.createImageData(w, h);
  const pimg = pctx.createImageData(w, h);
  const d = img.data;
  const pd = pimg.data;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const e = doc.edits[(y + yy) * doc.w + x + xx];
      if (!e) continue;
      if (e === EDIT_PAPER) pd.set(PAINT_PAPER, (yy * w + xx) * 4);
      else d.set(e === EDIT_WOOD ? PAINT_WOOD : PAINT_HOLE, (yy * w + xx) * 4);
    }
  }
  ctx.putImageData(img, x, y);
  pctx.putImageData(pimg, x, y);
  view.requestRender();
}

/** @param {Rect|null} rect */
function onDocChange(rect) {
  markChanged();
  clearFlow();
  updateEditLayer(rect);
  updateUndoUi();
  // A settings step (or undoing one): the scan runs with the document's settings.
  if (doc && settingsKey(doc.settings) !== settingsKey(currentSettings())) {
    applySettings(doc.settings);
    requestRecheck(true);
  } else requestRecheck();
}

/** The settings the next scan uses, as the document stores them. @returns {import('./doc.js').DocSettings} */
function currentSettings() {
  return { adjust: { ...scanOpts.adjust }, widthMm: scanOpts.widthMm, material: scanOpts.profile.name };
}
/** @param {import('./doc.js').DocSettings} st */
const settingsKey = (st) => JSON.stringify([{ ...NO_ADJUST, ...st.adjust }, st.widthMm, st.material]);
/** Put settings into effect (controls follow). @param {import('./doc.js').DocSettings} st */
function applySettings(st) {
  scanOpts.adjust = { ...NO_ADJUST, ...st.adjust };
  scanOpts.widthMm = st.widthMm;
  const m = MATERIALS.find((x) => x.name === st.material);
  if (m && m !== scanOpts.profile) {
    scanOpts.profile = m;
    $('materialName').textContent = m.name;
    renderMaterials();
  }
  syncAdjustUi();
}
/**
 * Change adjustments / width / material as a step in the history (undoable, saved, timed).
 * @param {Partial<import('./doc.js').DocSettings>} partial @param {string} label @param {string} [key] merge a slider drag into one step
 */
function changeSettings(partial, label, key) {
  const next = { ...currentSettings(), ...partial };
  if (!doc) {
    applySettings(next);
    requestRecheck(true);
    return;
  }
  doc.changeSettings(next, label, key);
}

/** @type {Worker|null} the idle helper thread (water, Flow test, Bucket pieces) */
let helperWorker = null;
let helperId = 0;
function helper() {
  if (!helperWorker) {
    helperWorker = new Worker(new URL('../worker/water.worker.js', import.meta.url), { type: 'module' });
  }
  return helperWorker;
}
/**
 * The Bucket's piece at (x, y), worked out on the helper thread so it never waits behind a re-check.
 * @param {ScanResult} s @param {number} x @param {number} y
 * @returns {Promise<{seal: Int32Array, pieces: number}>}
 */
function findPiece(s, x, y) {
  const id = ++helperId;
  const coreR = (DETECTION.neckGapMm * (s.piece.w / REFERENCE_WIDTH_MM)) / 2 + 0.5;
  return new Promise((resolve) => {
    const w = helper();
    const onMsg = (/** @type {MessageEvent} */ e) => {
      if (e.data.id !== id || !e.data.piece) return;
      w.removeEventListener('message', onMsg);
      resolve(e.data.piece);
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ kind: 'piece', id, labels: s.labels, w: s.w, h: s.h, x, y, coreR });
  });
}

/**
 * Bucket: fill the piece you clicked. If its area runs into other pieces through narrow passages
 * (under ~1 mm), those passages are sealed with wood in the same step, so only this piece changes.
 * @param {number} region @param {number} cls @param {number} x @param {number} y
 */
async function bucketClick(region, cls, x, y) {
  if (!doc || !scan) return;
  const d0 = doc;
  const label = cls === SEED_ENGRAVE ? 'Engrave area' : cls === WOOD ? (scan.regionEngraved?.[region] ? 'Clear engraving' : 'Bucket: wood') : 'Bucket: hole';
  let piece = null;
  try {
    piece = await findPiece(scan, x, y);
  } catch (err) {
    console.error(err);
  }
  if (doc !== d0 || !scan) return;
  if (piece && piece.seal.length) {
    doc.beginStroke(label);
    updateEditLayer(doc.setPixels(Array.from(piece.seal), EDIT_WOOD));
    doc.endStroke({ x, y, cls });
    toast('Filled just this piece: its narrow joins to the rest were sealed with wood (⌘Z to undo)', 3200);
    return;
  }
  // A single piece: show the fill right away; the re-check confirms it (and updates islands/leaks).
  const px = cls === HOLE ? PX_HOLE : PX_WOOD;
  const { labels, classMap } = scan;
  for (let p = 0; p < labels.length; p++) if (labels[p] === region) classMap[p] = px;
  scan.regionClass[region] = cls === HOLE ? HOLE : WOOD;
  if (scan.regionEngraved) scan.regionEngraved[region] = cls === SEED_ENGRAVE ? 1 : 0;
  view.setAnalysis(scan);
  doc.addSeed({ x, y, cls }, label);
}

/**
 * Bucket on hole paint (a cut you painted, e.g. to remove a line): that stroke becomes paper again,
 * part of the area around it, and that area becomes wood — one undo step.
 * @param {number} x @param {number} y
 */
function cutToWood(x, y) {
  if (!doc) return;
  const { w, h, edits } = doc;
  const start = y * w + x;
  if (edits[start] !== EDIT_HOLE) return;
  /** @type {number[]} */
  const px = [start];
  const seen = new Uint8Array(w * h);
  seen[start] = 1;
  for (let i = 0; i < px.length; i++) {
    const p = px[i];
    const cx = p % w, cy = (p - cx) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (!seen[q] && edits[q] === EDIT_HOLE) {
          seen[q] = 1;
          px.push(q);
        }
      }
    }
  }
  doc.beginStroke('Bucket: wood');
  updateEditLayer(doc.setPixels(px, EDIT_PAPER));
  doc.endStroke({ x, y, cls: WOOD });
  toast('That was hole paint: it’s paper again, and the area around it is now wood (⌘Z to undo)', 3200);
}

/**
 * Engrave tool on an area: burn its whole surface (a hole becomes engraved wood); on an engraved
 * area, clear it back to plain wood. Same narrow-join handling as the Bucket.
 * @param {number} region @param {number} x @param {number} y
 */
function engraveArea(region, x, y) {
  if (!scan) return;
  const on = !scan.regionEngraved?.[region];
  const wasHole = scan.regionClass[region] === HOLE;
  bucketClick(region, on ? SEED_ENGRAVE : WOOD, x, y);
  if (on && wasHole) toast('That part was a hole: now it stays, burned dark (⌘Z to undo)', 2800);
}

/**
 * Engrave tool on a line: a line with wood on both sides switches between score and engrave.
 * Lines along a hole are cut edges; lines around an engraved area are part of that shape.
 * @param {number} x @param {number} y
 */
function engraveLine(x, y) {
  if (!doc || !scan) return;
  const hit = view.planHit(x + 0.5, y + 0.5);
  if (hit === 'cut') return toast('That line is a cut edge: the laser goes right through it. Only lines with wood on both sides can be scored or engraved.', 3600);
  if (hit === 'engraveArea') return toast('That line belongs to an engraved shape. Click inside the shape to clear it.', 3000);
  if (hit === 'outside') return toast('That’s outside the piece.', 2000);
  const cls = hit === 'score' ? SEED_LINE_ENGRAVE : SEED_LINE_SCORE;
  doc.addSeed({ x, y, cls }, cls === SEED_LINE_ENGRAVE ? 'Engrave line' : 'Score line');
  toast(cls === SEED_LINE_ENGRAVE ? 'This line will be engraved (bold, filled)' : 'This line will be scored (thin)', 1600);
}

const undoBtn = $('undoBtn');
const redoBtn = $('redoBtn');
const editDot = $('editDot');
function updateUndoUi() {
  historyBtn.setAttribute('aria-disabled', String(!doc || (!doc.canUndo && !doc.canRedo && !versions.length)));
  renderHistory();
  undoBtn.setAttribute('aria-disabled', String(!doc?.canUndo));
  redoBtn.setAttribute('aria-disabled', String(!doc?.canRedo));
  const last = doc?.undoStack[doc.undoStack.length - 1];
  const next = doc?.redoStack[doc.redoStack.length - 1];
  undoBtn.dataset.tip = last ? `Undo ${last.label}` : 'Undo';
  redoBtn.dataset.tip = next ? `Redo ${next.label}` : 'Redo';
  updateDirty();
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

// History popover: every step, newest at the bottom; click one to jump there.
const historyBtn = $('historyBtn');
const historyList = $('historyList');
const historyPop = bindPopover(historyBtn, $('historyPop'));
function renderHistory() {
  if (!doc) {
    historyList.replaceChildren();
    return;
  }
  const d = doc;
  const patches = [...d.undoStack, ...[...d.redoStack].reverse()];
  const cur = d.undoStack.length;
  /** step id → when it was saved */
  const saved = new Map(versions.filter((v) => v.stepId != null).map((v) => [v.stepId, v.savedAt]));
  const rows = [{ label: d.baseId ? 'Earlier steps' : 'Opened image', id: d.baseId, at: 0 }, ...patches.map((p) => ({ label: p.label, id: p.id ?? -1, at: p.at || 0 }))];
  historyList.replaceChildren(...rows.map((row, i) => {
    const li = document.createElement('li');
    li.dataset.current = String(i === cur);
    li.dataset.future = String(i > cur);
    const b = document.createElement('button');
    const n = document.createElement('span');
    n.className = 'h-step';
    n.textContent = i ? String(i) : '';
    const label = document.createElement('span');
    label.className = 'h-label';
    label.textContent = row.label;
    b.append(n, label);
    const when = saved.get(row.id);
    if (when) {
      const tag = document.createElement('span');
      tag.className = 'h-saved';
      tag.textContent = 'Saved';
      tag.title = `Saved ${fmtWhen(when)}`;
      b.append(tag);
    }
    if (row.at) {
      const t = document.createElement('span');
      t.className = 'h-time';
      t.textContent = fmtWhen(new Date(row.at).toISOString());
      b.append(t);
    }
    b.addEventListener('click', () => jumpTo(i));
    li.append(b);
    return li;
  }));
  renderVersionList();
  historyList.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' });
}
/** Go to the state right after a step (by id). @param {number} id */
function jumpToStep(id) {
  if (!doc) return;
  if (id === doc.baseId) return jumpTo(0);
  const u = doc.undoStack.findIndex((p) => p.id === id);
  if (u >= 0) return jumpTo(u + 1);
  const r = doc.redoStack.findIndex((p) => p.id === id);
  if (r >= 0) jumpTo(doc.undoStack.length + (doc.redoStack.length - r));
}
/** @param {number} i number of steps to keep applied */
function jumpTo(i) {
  if (!doc) return;
  while (doc.undoStack.length > i && doc.undo());
  while (doc.undoStack.length < i && doc.redo());
}
void historyPop;

// ---- view modes ----------------------------------------------------------------------

/** @typedef {import('./view.js').ViewMode} ViewMode */
/** @param {ViewMode} mode */
function setMode(mode) {
  view.setMode(mode);
  for (const b of modeButtons) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  if (mode === 'cut' || mode === 'plan') showCutPreview();
  planLegend.dataset.open = String(mode === 'plan');
  if (mode !== 'plan') hidePlanTip();
  refreshNavigator();
}

/** The Navigator thumbnail shows what the canvas shows, including your paint. */
function refreshNavigator() {
  if (view.mode === 'woodhole' && view.woodHole) return navPanel.setImage(view.woodHole);
  const base = view.designSource();
  if (!base) return;
  if (!doc?.edited || !editLayer) return navPanel.setImage(base);
  const c = document.createElement('canvas');
  c.width = base.width;
  c.height = base.height;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.drawImage(base, 0, 0);
  if (paperLayer) g.drawImage(paperLayer, 0, 0);
  g.drawImage(editLayer, 0, 0);
  navPanel.setImage(c);
}
for (const b of modeButtons) {
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    setMode(/** @type {ViewMode} */ (b.dataset.mode));
  });
}

// ---- adjust, width and material (SPEC §5.2, §5.5) -------------------------------------------

const adjustBody = $('adjustBody');
const adjRows = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.adj-row'));
const adjInvert = /** @type {HTMLInputElement} */ ($('adjInvert'));
const ADJ_FMT = /** @type {Record<string, (v: number) => string>} */ ({
  brightness: (v) => (v > 0 ? `+${v}` : String(v)),
  contrast: (v) => (v > 0 ? `+${v}` : String(v)),
  smooth: (v) => (v ? `${v} px` : 'Off'),
  sharpen: (v) => (v ? `${v}` : 'Off'),
  despeckle: (v) => (v ? `≤ ${v} px²` : 'Off'),
  lineWeight: (v) => (v ? `${v > 0 ? '+' : ''}${v} px` : '0'),
});

/** The adjusted image as a crisp black & white trace (what the analysis sees). @param {ScanResult} res */
function traceCanvas(res) {
  const c = document.createElement('canvas');
  c.width = res.w;
  c.height = res.h;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const img = g.createImageData(res.w, res.h);
  const d = img.data;
  for (let p = 0; p < res.classMap.length; p++) {
    const v = res.classMap[p] === PX_LINE ? 28 : 255;
    d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v;
    d[p * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Sliders and labels from scanOpts (and the latest scan, for the automatic threshold). */
function syncAdjustUi() {
  const a = scanOpts.adjust;
  let changed = 0;
  for (const row of adjRows) {
    const key = /** @type {keyof import('../engine/adjust.js').Adjustments} */ (row.dataset.adj);
    const input = /** @type {HTMLInputElement} */ (row.querySelector('input'));
    const out = /** @type {HTMLOutputElement} */ (row.querySelector('output'));
    if (key === 'threshold') {
      const auto = scan?.autoThreshold ?? 128;
      const v = a.threshold ?? auto;
      input.value = String(v);
      out.textContent = a.threshold == null ? `Auto · ${auto}` : String(v);
      row.dataset.changed = String(a.threshold != null);
      if (a.threshold != null) changed++;
    } else {
      const v = /** @type {number} */ (a[key]);
      input.value = String(v);
      out.textContent = ADJ_FMT[key](v);
      row.dataset.changed = String(v !== NO_ADJUST[key]);
      if (v !== NO_ADJUST[key]) changed++;
    }
  }
  if (a.invert !== 'auto') changed++;
  $('adjustCount').textContent = changed ? String(changed) : '';
}

/** After a scan: Invert reflects what was used; chips show width and material; Δ line. @param {ScanResult} res */
function syncScanControls(res) {
  adjInvert.checked = res.inverted;
  adjustBody.dataset.disabled = 'false';
  $('materialBtn').setAttribute('aria-disabled', 'false');
  $('widthBtn').setAttribute('aria-disabled', 'false');
  $('materialName').textContent = scanOpts.profile.name;
  $('widthText').textContent = `${fmtWidth(res.widthMm)} mm`;
  $('widthEst').hidden = !res.estimated;
  syncAdjustUi();
  const delta = $('adjDelta');
  if (deltaFrom) {
    const was = deltaFrom;
    const now = res.summary;
    /** @type {[string, number, number][]} */
    const rows = [
      ['Leaks', was.leaks, now.leaks],
      ['Islands', was.islands, now.islands],
      ['Thin', was.thin ?? 0, now.thin],
      ['Near-touch', was.nearTouch ?? 0, now.nearTouch],
    ];
    const shown = rows.filter(([, a, b]) => a || b);
    delta.innerHTML = shown.length
      ? shown.map(([k, a, b]) => `${k} ${a} → <b>${b}</b>`).join(' · ')
      : 'No issues before or after';
    deltaFrom = null;
  }
}

/** @param {number} mm */
function fmtWidth(mm) {
  return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
}

for (const row of adjRows) {
  const key = /** @type {keyof import('../engine/adjust.js').Adjustments} */ (row.dataset.adj);
  const input = /** @type {HTMLInputElement} */ (row.querySelector('input'));
  const name = row.querySelector('label')?.textContent || key;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    const fmt = key === 'threshold' ? String(v) : ADJ_FMT[key](v);
    changeSettings({ adjust: { ...scanOpts.adjust, [key]: v } }, `${name} ${fmt}`, `adj:${key}`);
  });
  // Double-click a label: back to the default for that one.
  row.querySelector('label')?.addEventListener('dblclick', () => {
    changeSettings({ adjust: { ...scanOpts.adjust, [key]: NO_ADJUST[key] } }, `${name}: default`);
  });
}
adjInvert.addEventListener('change', () => {
  changeSettings({ adjust: { ...scanOpts.adjust, invert: adjInvert.checked ? 'on' : 'off' } }, adjInvert.checked ? 'Invert on' : 'Invert off');
});
$('adjAuto').addEventListener('click', () => {
  changeSettings({ adjust: { ...NO_ADJUST, despeckle: 4 } }, 'Auto adjust');
  toast('Auto: automatic threshold and a light clean-up', 1600);
});
$('adjReset').addEventListener('click', () => {
  changeSettings({ adjust: { ...NO_ADJUST } }, 'Reset adjustments');
});

// Hold \ to compare with the original.
window.addEventListener('keydown', (e) => {
  if (e.key === '\\' && !e.metaKey && !e.ctrlKey && /** @type {HTMLElement} */ (e.target).tagName !== 'INPUT') view.setShowOriginal(true);
});
window.addEventListener('keyup', (e) => {
  if (e.key === '\\') view.setShowOriginal(false);
});
window.addEventListener('blur', () => view.setShowOriginal(false));

// Material
const materialPop = bindPopover($('materialBtn'), $('materialPop'));
const materialList = $('materialList');
function renderMaterials() {
  materialList.replaceChildren(...MATERIALS.map((m) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(m.name === scanOpts.profile.name));
    b.innerHTML = `<span class="rl-title"></span><span class="rl-sub"></span>`;
    /** @type {HTMLElement} */ (b.firstChild).textContent = m.name;
    /** @type {HTMLElement} */ (b.lastChild).textContent = `Wood ≥ ${m.minWoodWidth} mm · holes ≥ ${m.minHoleWidth} mm · kerf ${m.kerfMm} mm`;
    b.addEventListener('click', () => {
      settings.material = m.name;
      saveSettings(settings);
      materialPop.close();
      if (m === scanOpts.profile) return;
      changeSettings({ material: m.name }, `Material: ${m.name}`);
      if (!doc) {
        renderMaterials();
        $('materialName').textContent = m.name;
      }
    });
    return b;
  }));
}

// Width
const widthPop = bindPopover($('widthBtn'), $('widthPop'));
const widthInput = /** @type {HTMLInputElement} */ ($('widthInput'));
$('widthBtn').addEventListener('click', () => {
  widthInput.value = scan && !scan.estimated ? fmtWidth(scan.widthMm) : '';
  widthInput.placeholder = scan ? `${fmtWidth(scan.widthMm)} (estimate)` : '';
  setTimeout(() => widthInput.focus(), 0);
});
$('widthForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = parseFloat(widthInput.value.replace(',', '.'));
  if (!(v >= 5 && v <= 2000)) {
    toast('Enter a width between 5 and 2000 mm', 1800);
    return;
  }
  const mm = Math.round(v * 10) / 10;
  widthPop.close();
  changeSettings({ widthMm: mm }, `Width ${fmtWidth(mm)} mm`);
});
$('widthReset').addEventListener('click', () => {
  widthPop.close();
  changeSettings({ widthMm: null }, 'Width: estimate');
});
$('widthReset').textContent = `Use the estimate (${REFERENCE_WIDTH_MM} mm)`;

// ---- brush size bar ------------------------------------------------------------------------

const toolOpts = $('toolOpts');
const toSize = /** @type {HTMLInputElement} */ ($('toSize'));
const toVal = /** @type {HTMLInputElement} */ ($('toVal'));
const SIZE_MIN = 1, SIZE_MAX = 400; // image px
/** px ↔ slider position (log scale, so small brushes get room). */
const sizeToSlider = (/** @type {number} */ px) => Math.round((Math.log(px / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN)) * 1000);
const sliderToSize = (/** @type {number} */ v) => SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, v / 1000);
/** @param {number} px */
function fmtSize(px) {
  if (!tools.pxPerMm) return String(Math.round(px));
  const mm = px / tools.pxPerMm;
  return mm < 1 ? mm.toFixed(2) : mm < 10 ? mm.toFixed(1) : String(Math.round(mm));
}
function syncToolOpts() {
  const t = tools.tool;
  const on = tools.sized && !!doc;
  toolOpts.dataset.open = String(on);
  if (!on) return;
  const px = /** @type {number} */ (tools.size[/** @type {'wood'} */ (t)]);
  $('toName').textContent = TOOL_NAMES[t];
  toSize.value = String(sizeToSlider(px));
  if (document.activeElement !== toVal) toVal.value = fmtSize(px);
  const unit = toolOpts.querySelector('.to-unit');
  if (unit) unit.textContent = tools.pxPerMm ? 'mm' : 'px';
  const def = /** @type {number} */ (tools.defaults[/** @type {'wood'} */ (t)]);
  $('toReset').hidden = Math.abs(def - px) < 0.01;
  toSize.title = `${Math.round(px)} px`;
}
tools.onSize = () => syncToolOpts();
toSize.addEventListener('input', () => tools.setSize(sliderToSize(Number(toSize.value))));
$('toMinus').addEventListener('click', () => tools.resize(-1));
$('toPlus').addEventListener('click', () => tools.resize(1));
$('toReset').addEventListener('click', () => {
  tools.setSize(/** @type {number} */ (tools.defaults[/** @type {'wood'} */ (tools.tool)]));
});
toVal.addEventListener('change', () => {
  const v = parseFloat(toVal.value.replace(',', '.'));
  if (v > 0) tools.setSize(tools.pxPerMm ? v * tools.pxPerMm : v);
  else syncToolOpts();
});
toVal.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') toVal.blur();
  e.stopPropagation(); // typing a number shouldn't switch tools
});
toVal.addEventListener('blur', () => syncToolOpts());

// ---- open & save ---------------------------------------------------------------------------

/**
 * Save the project. Like a document: the first Save asks where; after that ⌘S writes back to the
 * same file (Chrome), and every save is kept as a version inside it. Save as… always asks.
 * Safari can't write back to a file: each save goes to Downloads (still with every version inside).
 * @param {boolean} [as] Save as… (a new file)
 * @returns {Promise<boolean>} saved
 */
async function saveProject(as = false) {
  if (!doc || !imageBlob || !view.image) {
    toast('Open an image first', 1400);
    return false;
  }
  const name = docName.textContent || 'Untitled';
  const d = doc;
  // A save is a marker on the current step (old saves whose steps were replaced are dropped).
  /** @type {import('./project.js').SavedVersion} */
  const version = { savedAt: new Date().toISOString(), label: versionLabel(), stepId: d.stepId };
  const kept = versions.filter((v) => v.snapshot || (v.stepId != null && d.hasStep(v.stepId)));
  const last = kept[kept.length - 1];
  if (last && last.stepId === version.stepId) kept.pop(); // saved again with no change: just the newer time
  const list = [...kept, version].slice(-MAX_VERSIONS);
  const blob = await encodeProject({
    name, image: imageBlob, w: d.w, h: d.h, edits: d.edits, seeds: d.seeds,
    adjust: scanOpts.adjust, widthMm: scanOpts.widthMm, material: scanOpts.profile.name, ignored: [...ignored],
    versions: list,
    history: { undo: d.undoStack, redo: d.redoStack, baseId: d.baseId, nextId: d.nextId },
  });
  const at = changeSeq;
  /** @type {'inplace'|'saved'|'downloaded'|'cancelled'} */
  let r = 'cancelled';
  if (!as && fileHandle && (await writeToHandle(fileHandle, blob))) r = 'inplace';
  else r = await saveBlob(blob, `${name}${PROJECT_EXT}`, undefined, (h) => (fileHandle = h));
  if (r === 'cancelled') return false;
  versions = list;
  renderVersions();
  savedSeq = at;
  updateDirty();
  const file = fileHandle?.name || `${name}${PROJECT_EXT}`;
  const n = list.length;
  toast(
    r === 'downloaded'
      ? `Saved to Downloads as “${file}” (version ${n} inside)`
      : `Saved “${file}”${n > 1 ? ` · version ${n}` : ''}`,
    2200,
  );
  return true;
}

/** A few words for a saved version: what the scan said then. */
function versionLabel() {
  return lastResultText.trim().replace(/\s*\(est\.\)$/, '') || 'Saved';
}

/** @param {string} iso */
function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return time;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}
/** Saved versions changed (a save, an open): list them and refresh the History button. */
function renderVersions() {
  renderVersionList();
  updateUndoUi();
}
/** Saved versions in the History popover, newest first; click one to go back to it. */
function renderVersionList() {
  const versionsBox = $('versionsBox');
  const versionList = $('versionList');
  const list = versions.filter((v) => v.snapshot || (v.stepId != null && doc?.hasStep(v.stepId)));
  versionsBox.hidden = !list.length;
  versionList.replaceChildren(...list.map((v, i) => {
    const li = document.createElement('li');
    li.dataset.latest = String(i === list.length - 1);
    li.dataset.current = String(v.stepId != null && v.stepId === doc?.stepId);
    const b = document.createElement('button');
    const when = document.createElement('span');
    when.className = 'v-when';
    when.textContent = fmtWhen(v.savedAt);
    const label = document.createElement('span');
    label.className = 'v-label';
    label.textContent = v.label;
    b.append(when, label);
    b.title = `${v.label} — click to go back to this version`;
    b.addEventListener('click', () => restoreVersion(v));
    li.append(b);
    return li;
  }).reverse());
}

/**
 * Go back to a saved version: the drawing, Bucket/Engrave clicks, adjustments, width and material.
 * Unsaved work is offered a save first; saving afterwards adds a new version (nothing is lost).
 * @param {import('./project.js').SavedVersion} v
 */
async function restoreVersion(v) {
  if (!doc || !imageBlob) return;
  if (v.stepId != null) {
    // A step in the history: just go there (undoable, nothing lost).
    if (!doc.hasStep(v.stepId)) return toast('That version was replaced by later edits.', 2200);
    jumpToStep(v.stepId);
    toast(`Back to the version saved ${fmtWhen(v.savedAt)}`, 1800);
    return;
  }
  const sn = /** @type {NonNullable<typeof v.snapshot>} */ (v.snapshot);
  historyPop.close();
  if (!(await confirmDiscard())) return;
  const name = docName.textContent || 'Untitled';
  const latest = v === versions[versions.length - 1];
  await openImage(imageBlob, `${name}.png`, {
    name, image: imageBlob, w: doc.w, h: doc.h,
    edits: sn.edits, seeds: sn.seeds, adjust: sn.adjust, widthMm: sn.widthMm, material: sn.material, ignored: sn.ignored,
  });
  if (!latest) markChanged();
  toast(latest ? 'Back to the saved file' : `Back to the version from ${fmtWhen(v.savedAt)} · Save to keep it`, 2600);
}

const sheet = $('sheet');
/**
 * "Save changes?" before something replaces the current document.
 * @returns {Promise<boolean>} true = go ahead
 */
function confirmDiscard() {
  if (!isDirty()) return Promise.resolve(true);
  $('sheetTitle').textContent = `Save changes to “${docName.textContent}”?`;
  sheet.hidden = false;
  requestAnimationFrame(() => (sheet.dataset.open = 'true'));
  $('sheetSave').focus();
  return new Promise((resolve) => {
    /** @param {'save'|'discard'|'cancel'} what */
    const done = async (what) => {
      delete sheet.dataset.open;
      sheet.hidden = true;
      cleanup();
      if (what === 'cancel') return resolve(false);
      if (what === 'discard') return resolve(true);
      resolve(await saveProject());
    };
    const onSave = () => done('save');
    const onDiscard = () => done('discard');
    const onCancel = () => done('cancel');
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    };
    const cleanup = () => {
      $('sheetSave').removeEventListener('click', onSave);
      $('sheetDiscard').removeEventListener('click', onDiscard);
      $('sheetCancel').removeEventListener('click', onCancel);
      window.removeEventListener('keydown', onKey, true);
    };
    $('sheetSave').addEventListener('click', onSave);
    $('sheetDiscard').addEventListener('click', onDiscard);
    $('sheetCancel').addEventListener('click', onCancel);
    window.addEventListener('keydown', onKey, true);
  });
}

$('tbOpen').addEventListener('click', () => openDialog());
$('tbSave').addEventListener('click', (e) => saveProject(e.altKey));
window.addEventListener('beforeunload', (e) => {
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---- export & cut preview (SPEC §9, §5 step 9) -----------------------------------------------

const exportBtn = $('exportBtn');
const modeCut = $('modeCut');
const exportSheet = $('exportSheet');
/** @typedef {{svg: string, preview: {wood: string, outline: string, scores: string, engrave: string, engraveAreas: string}, stats: import('../engine/export.js').CutGeometry['stats']}} Exported */
/** @type {{scan: ScanResult, details: string, marks: string, result: Promise<Exported>}|null} */
let exportCache = null;
const detailsMode = () => /** @type {'score'|'engrave'|'drop'} */ (settings.exportDetails || 'score');
/** Engrave-tool clicks on single lines (score / engrave), oldest first. */
const lineMarks = () => (doc ? doc.seeds.filter((q) => q.cls === SEED_LINE_SCORE || q.cls === SEED_LINE_ENGRAVE) : []);

/** The laser file and preview for a scan (worked out once per scan and details choice). @param {ScanResult} s */
function exported(s) {
  const details = detailsMode();
  const marks = JSON.stringify(lineMarks());
  if (exportCache && exportCache.scan === s && exportCache.details === details && exportCache.marks === marks) return exportCache.result;
  const id = ++helperId;
  const result = /** @type {Promise<Exported>} */ (new Promise((resolve) => {
    const w = helper();
    const onMsg = (/** @type {MessageEvent} */ e) => {
      if (e.data.id !== id || !e.data.exported) return;
      w.removeEventListener('message', onMsg);
      resolve(e.data.exported);
    };
    w.addEventListener('message', onMsg);
    w.postMessage({
      kind: 'export', id, details,
      scan: { classMap: s.classMap, w: s.w, h: s.h, strokeW: s.strokeW, pxPerMm: s.pxPerMm, labels: s.labels, regionEngraved: s.regionEngraved },
      lineMarks: lineMarks(),
      meta: { name: docName.textContent || 'Ajouré piece', material: scanOpts.profile.name, estimated: s.estimated },
    });
  }));
  exportCache = { scan: s, details, marks, result };
  return result;
}

async function showCutPreview() {
  if (!scan) return;
  const s0 = scan;
  const r = await exported(s0);
  if (scan !== s0) return;
  view.setCutPreview(r.preview, scanOpts.profile.kerfMm * s0.pxPerMm);
}

/** @param {number} mm */
const fmtLen = (mm) => (mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`);

async function openExport() {
  if (!scan || exportBtn.getAttribute('aria-disabled') === 'true') return;
  const s0 = scan;
  exportSheet.hidden = false;
  requestAnimationFrame(() => (exportSheet.dataset.open = 'true'));
  $('exMat').textContent = scanOpts.profile.name;
  $('exSize').textContent = `${fmtWidth(s0.widthMm)} mm wide${s0.estimated ? ' (estimated)' : ''}`;
  for (const b of detailButtons) b.setAttribute('aria-checked', String(b.dataset.details === detailsMode()));
  // What's still wrong, so nobody burns wood by surprise.
  const open = openIssues();
  const crit = open.filter((i) => i.severity === 'critical');
  const warn = $('exWarn');
  /** @type {string[]} */
  const notes = [];
  if (crit.length) {
    const leaks = crit.filter((i) => i.type === 'leak').length;
    const islands = crit.filter((i) => i.type === 'island').length;
    const what = [leaks ? `${leaks} leak${leaks > 1 ? 's' : ''}` : '', islands ? `${islands} loose piece${islands > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
    notes.push(`<p><b>${what} still open.</b> ${islands ? 'Loose pieces fall out when cut. ' : ''}You can export anyway, or <button class="btn btn-small" id="exReview" type="button">Review</button></p>`);
  }
  if (s0.estimated) notes.push('<p>The size is the <b>50 mm estimate</b>. Set the real width first so the cut comes out the right size.</p>');
  warn.hidden = !notes.length;
  warn.dataset.level = crit.length ? 'critical' : 'warning';
  warn.innerHTML = notes.join('');
  $('exReview')?.addEventListener('click', () => {
    closeExport();
    if (crit[0]) focusIssue(crit[0].id);
  });
  $('exGo').focus();
  await fillExportFacts(s0);
}

/** @param {ScanResult} s0 */
async function fillExportFacts(s0) {
  $('exCut').textContent = 'Working it out…';
  const r = await exported(s0);
  if (scan !== s0) return;
  const st = r.stats;
  $('exSize').textContent = `${fmtWidth(Math.round(st.widthMm * 10) / 10)} × ${fmtWidth(Math.round(st.heightMm * 10) / 10)} mm${s0.estimated ? ' (estimated)' : ''}`;
  const parts = [`${st.holes} hole${st.holes === 1 ? '' : 's'} + ${st.pieces > 1 ? `${st.pieces} outlines` : 'the outline'}`, `${fmtLen(st.cutMm)} of cutting`];
  if (st.scored) parts.push(`${st.scored} score line${st.scored === 1 ? '' : 's'} (${fmtLen(st.scoreMm)})`);
  const eng = [st.engravedAreas ? `${st.engravedAreas} area${st.engravedAreas === 1 ? '' : 's'}` : '', st.engravedLines ? `${st.engravedLines} line${st.engravedLines === 1 ? '' : 's'}` : ''].filter(Boolean);
  if (eng.length) parts.push(`engraved: ${eng.join(' + ')}`);
  $('exCut').textContent = parts.join(' · ');
}

function closeExport() {
  delete exportSheet.dataset.open;
  exportSheet.hidden = true;
}

async function doExport() {
  if (!scan) return;
  const r = await exported(scan);
  const name = docName.textContent || 'Ajouré piece';
  const res = await saveBlob(new Blob([r.svg], { type: 'image/svg+xml' }), `${name}.svg`, { description: 'SVG for the laser', mime: 'image/svg+xml', ext: '.svg' });
  if (res === 'cancelled') return;
  closeExport();
  toast(res === 'saved' ? `Exported “${name}.svg” — open it in xTool Creative Space` : `Saved “${name}.svg” to Downloads — open it in xTool Creative Space`, 3200);
}

const detailButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-details]'));
for (const b of detailButtons) {
  b.addEventListener('click', () => {
    settings.exportDetails = /** @type {'score'|'engrave'|'drop'} */ (b.dataset.details);
    saveSettings(settings);
    for (const x of detailButtons) x.setAttribute('aria-checked', String(x === b));
    if (scan && !exportSheet.hidden) fillExportFacts(scan);
    if (view.mode === 'cut' || view.mode === 'plan') showCutPreview();
  });
}
// ---- plan view: legend and plain-words tip ------------------------------------------------

const planItems = /** @type {NodeListOf<HTMLButtonElement>} */ (planLegend.querySelectorAll('[data-layer]'));
for (const b of planItems) {
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    for (const x of planItems) x.setAttribute('aria-pressed', String(on && x === b));
    view.setPlanFocus(on ? /** @type {import('./view.js').PlanLayer} */ (b.dataset.layer) : null);
  });
}
const planTipEl = $('planTip');
/** @type {Record<string, [string, string, string, string]>} title, text, swatch class, what the Engrave tool would do */
const PLAN_TIPS = {
  cut: ['Cut', 'The laser goes right through here.', 'sw-cut', 'Cut edges can’t be engraved'],
  score: ['Score', 'A thin line burned on the surface. Nothing is removed.', 'sw-score', 'Click to engrave this line instead'],
  engraveLine: ['Engraved line', 'Burned at full width on the surface. Nothing is removed.', 'sw-engrave', 'Click to score it instead'],
  engraveArea: ['Engraved', 'This whole shape is burned dark on the surface. It stays.', 'sw-engrave', 'Click to clear the engraving'],
  stays: ['Stays', 'Plain wood, part of your piece.', 'sw-wood', 'Click to engrave this whole shape'],
  removed: ['Falls out', 'Cut out along its edge and removed.', 'sw-removed', 'Click to keep it, engraved'],
  outside: ['Trimmed away', 'Outside the outline.', 'sw-removed', ''],
};
let tipKey = '';
function hidePlanTip() {
  planTipEl.hidden = true;
  tipKey = '';
}
/** @param {{x:number, y:number}|null} p image px */
function planTip(p) {
  if (!p || view.mode !== 'plan' || !view.cutPreview || view.showOriginal) return hidePlanTip();
  const hit = view.planHit(p.x, p.y);
  if (!hit) return hidePlanTip();
  const [title, text, sw, act] = PLAN_TIPS[hit];
  const engraving = tools.tool === 'engrave';
  const key = `${hit}|${engraving}`;
  if (key !== tipKey) {
    $('ptTitle').innerHTML = `<i class="sw ${sw}"></i>${title}`;
    $('ptText').textContent = text;
    $('ptAct').textContent = engraving ? act : '';
    tipKey = key;
  }
  planTipEl.hidden = false;
  const v = view.current();
  const sx = p.x * v.scale + v.tx, sy = p.y * v.scale + v.ty;
  const W = stage.clientWidth, H = stage.clientHeight;
  const tw = planTipEl.offsetWidth, th = planTipEl.offsetHeight;
  const left = sx + 16 + tw > W - 8 ? sx - 16 - tw : sx + 16;
  const top = Math.min(H - th - 8, Math.max(8, sy + 18));
  planTipEl.style.left = `${Math.max(8, left)}px`;
  planTipEl.style.top = `${top}px`;
}
stage.addEventListener('pointerleave', hidePlanTip);
stage.addEventListener('pointerdown', hidePlanTip);

exportBtn.addEventListener('click', openExport);
$('exCancel').addEventListener('click', closeExport);
$('exGo').addEventListener('click', doExport);
$('exPreview').addEventListener('click', () => {
  closeExport();
  setMode('cut');
});
$('exSizeBtn').addEventListener('click', () => {
  closeExport();
  $('widthBtn').click();
});
exportSheet.addEventListener('pointerdown', (e) => {
  if (e.target === exportSheet) closeExport();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !exportSheet.hidden) {
    e.stopPropagation();
    closeExport();
  }
}, true);

// ---- flow test (SPEC §6.6) -------------------------------------------------------------

const flowBtn = $('flowBtn');
const flowPop = bindPopover($('flowModeBtn'), $('flowPop'));
const FLOW_MS = 2800;
/** @type {Worker|null} */
let flowWorker = null;
let flowId = 0;
let flowToast = 0;

/** Pour water into every hole; amber shows where it escapes. Pressing again clears it. */
async function runFlowTest() {
  if (!scan || flowBtn.getAttribute('aria-disabled') === 'true') return;
  if (view.flow) return clearFlow();
  const id = ++flowId;
  const s0 = scan;
  flowBtn.setAttribute('aria-pressed', 'true');
  if (!flowWorker) flowWorker = helper();
  const leaks = s0.issues
    .filter((i) => i.type === 'leak' && i.status !== 'ignored')
    .flatMap((i) => (i.fix?.kind === 'close' ? [{ x: i.anchor[0], y: i.anchor[1], ax: i.fix.ax, ay: i.fix.ay, bx: i.fix.bx, by: i.fix.by }] : []));
  /** @type {import('../engine/flow.js').FlowResult} */
  const f = await new Promise((resolve) => {
    const w = /** @type {Worker} */ (flowWorker);
    const fid = ++helperId;
    const onMsg = (/** @type {MessageEvent} */ e) => {
      if (e.data.id !== fid || !e.data.flow) return;
      w.removeEventListener('message', onMsg);
      resolve(e.data.flow);
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ kind: 'flow', id: fid, scan: { labels: s0.labels, w: s0.w, h: s0.h, classMap: s0.classMap, fixedClassMap: s0.fixedClassMap, leaks } });
  });
  if (id !== flowId || scan !== s0) return;
  // "Reduce motion" falls back to Quick.
  const quick = settings.flowMode === 'quick' || view.reduceMotion.matches;
  const reveal = new FlowReveal(f, s0.w, s0.h, quick ? 0 : FLOW_MS);
  view.flow = { reveal, quick, gaps: f.gaps, held: f.sealed, tEnd: 0 };
  view.requestRender();
  const n = f.gaps.length;
  const msg = n
    ? `Water escapes through ${n} gap${n > 1 ? 's' : ''}: the amber is what ${n > 1 ? 'they' : 'it'} would take with ${n > 1 ? 'them' : 'it'}`
    : `Every hole holds water ✓ (${f.holes} tested)`;
  clearTimeout(flowToast);
  flowToast = window.setTimeout(() => view.flow && toast(msg, 3600), quick ? 200 : FLOW_MS * 0.8);
}

function clearFlow() {
  flowId++;
  clearTimeout(flowToast);
  if (flowBtn) flowBtn.setAttribute('aria-pressed', 'false');
  if (view.flow) {
    view.flow = null;
    view.requestRender();
  }
}

/** Esc / click: jump to the end of the pour, or put the water away if it's done. */
function skipOrClearFlow() {
  const fl = view.flow;
  if (!fl) return;
  if (!fl.reveal.finished) {
    fl.reveal.finish();
    fl.reveal.dur = 1; // timed effects (gap ripples) now count as reached
    fl.reveal.t0 = performance.now() - 1;
    view.requestRender();
  } else clearFlow();
}

flowBtn.addEventListener('click', runFlowTest);
stage.addEventListener('pointerdown', (e) => {
  if (view.flow && !view.flow.reveal.finished && e.button === 0) {
    skipOrClearFlow();
    e.stopPropagation();
    e.preventDefault();
  }
}, true);
const flowModeButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-flowmode]'));
/** @param {'flow'|'quick'} m */
function applyFlowMode(m) {
  settings.flowMode = m;
  for (const b of flowModeButtons) b.setAttribute('aria-checked', String(b.dataset.flowmode === m));
  flowBtn.dataset.sub = m === 'quick' ? 'Fill every hole at once and see where water escapes' : 'Pour water into every hole and watch where it escapes';
}
for (const b of flowModeButtons) {
  b.addEventListener('click', () => {
    applyFlowMode(/** @type {'flow'|'quick'} */ (b.dataset.flowmode));
    saveSettings(settings);
    flowPop.close();
  });
}

// ---- keyboard ----------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  // Open and Save work from anywhere, even while typing in a box.
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    openExport();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'o')) {
    e.preventDefault();
    t.blur?.();
    if (e.key.toLowerCase() === 's') saveProject(e.shiftKey);
    else openDialog();
    return;
  }
  if (t.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (t).type !== 'range' && /** @type {HTMLInputElement} */ (t).type !== 'checkbox') return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'o') {
    e.preventDefault();
    openDialog();
  } else if (mod && k === 's') {
    e.preventDefault();
    saveProject(e.shiftKey);
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
    tools.resize(e.key === ']' ? 1 : -1);
  } else if (e.key === 'Escape' && view.flow) {
    skipOrClearFlow();
  } else if (!mod && !e.altKey && k === 't' && !e.repeat) {
    runFlowTest();
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
applyFlowMode(settings.flowMode);
scanOpts.profile = MATERIALS.find((m) => m.name === settings.material) || BASSWOOD_3MM;
renderMaterials();
$('materialName').textContent = scanOpts.profile.name;
const showIgnored = /** @type {HTMLInputElement} */ ($('showIgnored'));
showIgnored.checked = settings.showIgnored;
view.showIgnored = settings.showIgnored;
showIgnored.addEventListener('change', () => {
  settings.showIgnored = showIgnored.checked;
  view.showIgnored = showIgnored.checked;
  view.requestRender();
  saveSettings(settings);
});

const previewButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-preview]'));
/** @param {'tint'|'water'} style */
function applyPreview(style) {
  settings.bucketPreview = style;
  tools.setPreview(style);
  for (const b of previewButtons) b.setAttribute('aria-checked', String(b.dataset.preview === style));
}
for (const b of previewButtons) {
  b.addEventListener('click', () => {
    applyPreview(/** @type {'tint'|'water'} */ (b.dataset.preview));
    saveSettings(settings);
  });
}
applyPreview(settings.bucketPreview);

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
