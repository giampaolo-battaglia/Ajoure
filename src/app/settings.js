// @ts-check
// App preferences, remembered in this browser (harmless if storage is blocked).

const KEY = 'ajoure.settings';

/** @typedef {{markers: 'box'|'pin', showIgnored: boolean, bucketPreview: 'tint'|'water', flowMode: 'flow'|'quick', material: string, exportDetails: 'score'|'engrave'|'drop'}} Settings */

/** @type {Settings} */
export const DEFAULTS = Object.freeze({
  markers: /** @type {'box'|'pin'} */ ('box'),
  showIgnored: true,
  bucketPreview: /** @type {'tint'|'water'} */ ('tint'),
  flowMode: /** @type {'flow'|'quick'} */ ('flow'),
  material: '3 mm basswood',
  exportDetails: /** @type {'score'|'engrave'|'drop'} */ ('score'),
});

/** @returns {Settings} */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const s = { ...DEFAULTS, ...saved };
    if (s.markers !== 'box' && s.markers !== 'pin') s.markers = DEFAULTS.markers;
    s.showIgnored = s.showIgnored !== false;
    if (s.bucketPreview !== 'tint' && s.bucketPreview !== 'water') s.bucketPreview = DEFAULTS.bucketPreview;
    if (s.flowMode !== 'flow' && s.flowMode !== 'quick') s.flowMode = DEFAULTS.flowMode;
    if (!['score', 'engrave', 'drop'].includes(s.exportDetails)) s.exportDetails = DEFAULTS.exportDetails;
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

/** @param {Settings} s */
export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the choice still applies for this session */
  }
}

/**
 * A small popover anchored under its button. Closes on outside click or Esc.
 * @param {HTMLElement} button @param {HTMLElement} pop
 */
export function bindPopover(button, pop) {
  const place = () => {
    const r = button.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
    if (pop.dataset.align === 'left') pop.style.left = `${Math.round(Math.max(8, r.left - 8))}px`;
    else pop.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  };
  const open = () => {
    place();
    pop.dataset.open = 'true';
    button.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    if (pop.contains(document.activeElement)) /** @type {HTMLElement} */ (document.activeElement).blur();
    delete pop.dataset.open;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    pop.dataset.open ? close() : open();
  });
  document.addEventListener('pointerdown', (e) => {
    const t = /** @type {Node} */ (e.target);
    if (pop.dataset.open && !pop.contains(t) && !button.contains(t)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop.dataset.open) {
      close();
      e.stopPropagation();
    }
  }, true);
  window.addEventListener('resize', () => pop.dataset.open && place());
  return { open, close };
}
