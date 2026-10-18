// @ts-check
// Small UI helpers: tooltips, toast, one-time hints, collapsible panels.

/**
 * macOS-style tooltips for any [data-tip] element.
 * First one waits a beat; neighbours open instantly while one is showing.
 * @param {HTMLElement} tip
 */
export function bindTooltips(tip) {
  const OPEN_DELAY = 450;
  const WARM_MS = 400;
  /** @type {HTMLElement|null} */
  let target = null;
  let timer = 0;
  let lastHidden = 0;

  const show = (/** @type {HTMLElement} */ el, instant = false) => {
    const title = el.dataset.tip || '';
    const key = el.dataset.key;
    const sub = el.dataset.sub;
    tip.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'tt-title';
    row.append(title);
    if (key) {
      const k = document.createElement('span');
      k.className = 'tt-key';
      k.textContent = key;
      row.append(k);
    }
    tip.append(row);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'tt-sub';
      s.textContent = sub;
      tip.append(s);
    }
    tip.classList.toggle('instant', instant);
    position(el);
    tip.classList.add('show');
  };

  const position = (/** @type {HTMLElement} */ el) => {
    const r = el.getBoundingClientRect();
    const side = el.dataset.side || 'bottom';
    tip.style.transformOrigin =
      side === 'right' ? 'left center' : side === 'top' ? 'bottom center' : 'top center';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x;
    let y;
    if (side === 'right') {
      x = r.right + 8;
      y = r.top + r.height / 2 - th / 2;
    } else if (side === 'top') {
      x = r.left + r.width / 2 - tw / 2;
      y = r.top - th - 8;
    } else {
      x = r.left + r.width / 2 - tw / 2;
      y = r.bottom + 8;
    }
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - th - 8, y));
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
  };

  const hide = () => {
    clearTimeout(timer);
    if (tip.classList.contains('show')) lastHidden = performance.now();
    tip.classList.remove('show');
    target = null;
  };

  document.addEventListener('pointerover', (e) => {
    const el = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest?.('[data-tip]'));
    if (el === target) return;
    if (!el) return hide();
    const warm = tip.classList.contains('show') || performance.now() - lastHidden < WARM_MS;
    hide();
    target = el;
    if (warm) show(el, true);
    else timer = window.setTimeout(() => target === el && show(el), OPEN_DELAY);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
}

/** @param {HTMLElement} el */
export function createToast(el) {
  let timer = 0;
  return (/** @type {string} */ message, ms = 3200) => {
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove('show'), ms);
  };
}

/**
 * Show a hint once per browser (remembered locally; harmless if storage is blocked).
 * @param {HTMLElement} el @param {string} id @param {string} html @param {number} [ms]
 */
export function hintOnce(el, id, html, ms = 4500) {
  const key = `ajoure.hint.${id}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    /* storage unavailable: show it anyway */
  }
  el.innerHTML = html;
  requestAnimationFrame(() => el.classList.add('show'));
  window.setTimeout(() => el.classList.remove('show'), ms);
}

/** Collapsible sidebar sections. @param {ParentNode} root */
export function bindPanels(root) {
  for (const head of root.querySelectorAll('.panel-head')) {
    head.addEventListener('click', () => {
      const panel = /** @type {HTMLElement} */ (head.closest('.panel'));
      const open = panel.dataset.open !== 'true';
      panel.dataset.open = String(open);
      head.setAttribute('aria-expanded', String(open));
    });
  }
}
