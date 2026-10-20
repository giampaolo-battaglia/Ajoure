// @ts-check
// Ajouré — app entry. Wires the canvas view, navigation, Navigator, loaders and the scan.

import { CanvasView } from './view.js';
import { NavigationInput } from './input.js';
import { Navigator } from './navigator.js';
import { loadBlob, bindLoaders, fetchSample, LoadError } from './loader.js';
import { bindTooltips, createToast, hintOnce, bindPanels } from './ui.js';
import { formatPercent, fitView } from './viewport.js';
import { Scanner } from './scanner.js';
import { loadSettings, saveSettings, bindPopover } from './settings.js';

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

const toolButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.tool'));
const input = new NavigationInput(stage, view, {
  onToolChange: (tool) => {
    for (const b of toolButtons) {
      if (b.getAttribute('aria-disabled') === 'true') continue;
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    }
  },
  onClick: (x, y) => {
    const pin = view.pinAt(x, y);
    if (!pin) {
      if (view.focusId) focusIssue(null);
      return false;
    }
    focusIssue(pin.id);
    return true;
  },
});

for (const b of toolButtons) {
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    const t = b.dataset.tool;
    if (t === 'hand' || t === 'zoom') input.setTool(t);
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

/** @param {Blob} blob @param {string} name */
async function open(blob, name) {
  try {
    const img = await loadBlob(blob, name);
    if (view.image) view.image.close();
    dims = `${img.width} × ${img.height} px`;
    docName.textContent = img.name;
    document.title = `${img.name} — Ajouré`;
    app.dataset.state = 'loaded';
    view.setImage(img.bitmap);
    navPanel.setImage(img.bitmap);
    setMode('design');
    runScan(img.bitmap);
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

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    fileInput.click();
  }
});

// ---- scan ------------------------------------------------------------------------

const scanner = new Scanner();
const scanStatus = $('scanStatus');
const issueList = $('issueList');
const issueCount = $('issueCount');
const modeButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-mode]'));
const modeWood = $('modeWood');
/** @type {import('./scanner.js').ScanResult|null} */
let scan = null;

/** @param {'idle'|'scanning'|'issues'|'clean'|'error'} state @param {string} text */
function setStatus(state, text) {
  scanStatus.dataset.state = state;
  scanStatus.innerHTML = state === 'idle' ? '' : `<span class="dot"></span>`;
  scanStatus.append(text);
}

/** @param {ImageBitmap} bitmap */
async function runScan(bitmap) {
  scan = null;
  modeWood.setAttribute('aria-disabled', 'true');
  renderIssues();
  setStatus('scanning', 'Scanning…');
  try {
    const t0 = performance.now();
    const res = await scanner.scan(bitmap);
    if (!res || view.image !== bitmap) return; // a newer image arrived
    scan = res;
    await view.setAnalysis(res);
    navPanel.draw();
    modeWood.setAttribute('aria-disabled', 'false');
    modeWood.dataset.sub = 'White stays · grey is cut out · checkered is outside the piece';
    renderIssues();
    const { leaks, islands, specks } = res.summary;
    const parts = [];
    if (leaks) parts.push(`${leaks} leak${leaks > 1 ? 's' : ''}`);
    if (islands) parts.push(`${islands} island${islands > 1 ? 's' : ''}`);
    if (specks) parts.push(`${specks} speck${specks > 1 ? 's' : ''}`);
    if (leaks || islands) setStatus('issues', parts.join(' · '));
    else setStatus('clean', specks ? `No leaks or islands · ${parts[0]}` : 'No leaks or islands');
    scanStatus.title = `Scanned in ${Math.round(performance.now() - t0)} ms`;
  } catch (err) {
    console.error(err);
    setStatus('error', 'Scan failed');
    toast('The scan failed on this image. Try another, or tell Claude what happened.');
  }
}

function renderIssues() {
  issueList.innerHTML = '';
  if (!scan) {
    issueCount.textContent = '';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = view.image ? 'Scanning for leaks and islands…' : 'Leaks and islands are pinned here as soon as you drop an image.';
    issueList.append(p);
    return;
  }
  const open = scan.issues.filter((i) => i.status === 'open');
  issueCount.textContent = open.length ? String(open.length) : '';
  if (!open.length) {
    const d = document.createElement('div');
    d.className = 'issue-empty';
    d.innerHTML = '<span class="dot"></span>No leaks or islands found';
    issueList.append(d);
    return;
  }
  for (const i of open) {
    const b = document.createElement('button');
    b.className = 'issue-row';
    b.dataset.id = i.id;
    b.dataset.severity = i.severity;
    if (i.id === view.focusId) b.setAttribute('aria-current', 'true');
    const sev = document.createElement('span');
    sev.className = 'sev';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = i.label;
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = i.detail;
    b.append(sev, t, d);
    b.addEventListener('click', () => focusIssue(i.id));
    issueList.append(b);
  }
}

/** Zoom to an issue and highlight it everywhere (null clears). @param {string|null} id */
function focusIssue(id) {
  view.setFocus(id);
  for (const row of issueList.querySelectorAll('.issue-row')) {
    if (/** @type {HTMLElement} */ (row).dataset.id === id) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  }
  const issue = id && scan ? scan.issues.find((i) => i.id === id) : null;
  if (issue) view.glideToIssue(issue);
}

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

window.addEventListener('keydown', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  if (t.tagName === 'INPUT') return;
  if (e.key === 'Escape' && view.focusId) focusIssue(null);
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
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault();
    settingsPop.open();
  }
});

bindTooltips($('tooltip'));
bindPanels(document);

// Handy for debugging from the console.
Object.assign(window, { ajoure: { view, input, navPanel, get scan() { return scan; } } });
