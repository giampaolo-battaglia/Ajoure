// @ts-check
// Ajouré — app entry. Wires the canvas view, navigation, Navigator and loaders.

import { CanvasView } from './view.js';
import { NavigationInput } from './input.js';
import { Navigator } from './navigator.js';
import { loadBlob, bindLoaders, fetchSample, LoadError } from './loader.js';
import { bindTooltips, createToast, hintOnce, bindPanels } from './ui.js';
import { formatPercent, fitView } from './viewport.js';

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

bindTooltips($('tooltip'));
bindPanels(document);

// Handy for debugging from the console.
Object.assign(window, { ajoure: { view, input, navPanel } });
