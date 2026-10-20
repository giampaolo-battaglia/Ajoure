// @ts-check
// App preferences, remembered in this browser (harmless if storage is blocked).

const KEY = 'ajoure.settings';

/** @typedef {{markers: 'box'|'pin'}} Settings */

/** @type {Settings} */
export const DEFAULTS = Object.freeze({ markers: 'box' });

/** @returns {Settings} */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const s = { ...DEFAULTS, ...saved };
    if (s.markers !== 'box' && s.markers !== 'pin') s.markers = DEFAULTS.markers;
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
    pop.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  };
  const open = () => {
    place();
    pop.dataset.open = 'true';
    button.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    delete pop.dataset.open;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => (pop.dataset.open ? close() : open()));
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
