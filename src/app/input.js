// @ts-check
// Canvas navigation input: trackpad, mouse, Space-drag, Zoom tool, keyboard zoom.

import { stepScale, zoomAt } from './viewport.js';

/** @typedef {import('./view.js').CanvasView} CanvasView */
/** @typedef {'hand'|'zoom'} ToolId */

const PINCH_K = 0.01; // ctrl+wheel (pinch) sensitivity
const WHEEL_K = 0.0018; // mouse-wheel zoom sensitivity
const SCRUB_K = 0.012; // scrubby zoom: per px of horizontal drag
const LATCH_MS = 220; // keep the same mouse/trackpad verdict within one scroll burst

export class NavigationInput {
  /**
   * @param {HTMLElement} stage
   * @param {CanvasView} view
   * @param {{onToolChange: (t: ToolId) => void, onClick?: (x: number, y: number) => boolean}} hooks
   *   onClick: a click (no drag) on the canvas; return true if it was handled (e.g. a pin)
   */
  constructor(stage, view, hooks) {
    this.stage = stage;
    this.view = view;
    this.hooks = hooks;
    /** @type {ToolId} */
    this.tool = 'hand';
    this.space = false;
    this.alt = false;
    /** @type {null | {kind:'pan'|'zoom', id:number, x:number, y:number, sx:number, sy:number, scale0:number, moved:boolean, alt:boolean}} */
    this.drag = null;
    this.lastWheel = 0;
    this.lastWasMouse = false;
    this.gesture = /** @type {null | {scale0:number}} */ (null);
    this.overPin = false;
    this.bind();
    this.updateCursor();
  }

  /** @param {ToolId} t */
  setTool(t) {
    this.tool = t;
    this.hooks.onToolChange(t);
    this.updateCursor();
  }

  /** @param {MouseEvent} e */
  local(e) {
    const r = this.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  updateCursor() {
    let c = 'default';
    if (this.drag?.kind === 'pan' && this.drag.moved) c = 'grabbing';
    else if (!this.drag && !this.space && this.overPin) c = 'pointer';
    else if (this.drag?.kind === 'pan') c = 'grabbing';
    else if (this.drag?.kind === 'zoom' && this.drag.moved) c = 'ew-resize';
    else if (this.space || this.tool === 'hand') c = 'grab';
    else if (this.tool === 'zoom') c = this.alt ? 'zoom-out' : 'zoom-in';
    this.stage.dataset.cursor = c;
  }

  bind() {
    const { stage } = this;

    // Keep the browser from zooming the whole page anywhere in the app.
    document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }

    stage.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Safari pinch arrives as gesture events (with clientX/Y), not ctrl+wheel.
    stage.addEventListener('gesturestart', (e) => {
      this.gesture = { scale0: this.view.current().scale };
      e.preventDefault();
    });
    stage.addEventListener('gesturechange', (e) => {
      const ge = /** @type {any} */ (e);
      if (!this.gesture) return;
      const p = this.local(ge);
      this.view.set(zoomAt(this.view.viewport, this.gesture.scale0 * ge.scale, p.x, p.y));
      e.preventDefault();
    });
    stage.addEventListener('gestureend', () => { this.gesture = null; });

    stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    stage.addEventListener('pointermove', (e) => this.onPointerMove(e));
    stage.addEventListener('pointerup', (e) => this.onPointerUp(e));
    stage.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    stage.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => {
      this.space = false;
      this.alt = false;
      this.updateCursor();
    });
  }

  // ---- wheel ---------------------------------------------------------------

  /** @param {WheelEvent} e */
  onWheel(e) {
    e.preventDefault();
    if (!this.view.image || this.gesture) return;
    const p = this.local(e);
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; } // lines → px
    else if (e.deltaMode === 2) { dx *= this.view.viewport.vw; dy *= this.view.viewport.vh; }

    if (e.ctrlKey) {
      // Trackpad pinch (or ctrl+wheel): zoom around the fingers.
      const d = Math.max(-50, Math.min(50, dy));
      this.view.zoomBy(Math.exp(-d * PINCH_K), p.x, p.y);
      return;
    }

    if (this.isMouseWheel(e)) {
      // Mouse wheel zooms toward the cursor; Shift+wheel pans sideways.
      if (e.shiftKey) this.view.pan(-(dy || dx), 0);
      else this.view.zoomBy(Math.exp(-Math.max(-300, Math.min(300, dy)) * WHEEL_K), p.x, p.y);
      return;
    }

    // Two-finger scroll pans (macOS momentum included).
    this.view.pan(-dx, -dy);
  }

  /**
   * Browsers don't say which device a wheel event came from. Heuristic:
   * mouse wheels send line-mode deltas, or vertical-only notches whose legacy
   * wheelDelta is a multiple of 120; trackpads send fine, often fractional, x+y deltas.
   * @param {WheelEvent} e
   */
  isMouseWheel(e) {
    const now = e.timeStamp;
    if (now - this.lastWheel < LATCH_MS) {
      this.lastWheel = now;
      return this.lastWasMouse;
    }
    this.lastWheel = now;
    const legacy = /** @type {any} */ (e).wheelDeltaY;
    let mouse = false;
    if (e.deltaMode !== 0) mouse = true;
    else if (e.deltaX !== 0) mouse = false;
    else if (typeof legacy === 'number' && legacy !== 0 && legacy % 120 === 0) mouse = true;
    else if (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50) mouse = true;
    this.lastWasMouse = mouse;
    return mouse;
  }

  // ---- pointer -------------------------------------------------------------

  /** @param {PointerEvent} e */
  onPointerDown(e) {
    if (!this.view.image || this.drag) return; // ignore extra fingers/buttons mid-drag
    if (e.target !== this.view.canvas) return; // floating controls over the canvas handle their own clicks
    const p = this.local(e);
    const isPan = e.button === 1 || (e.button === 0 && (this.space || this.tool === 'hand'));
    const isZoom = e.button === 0 && !isPan && this.tool === 'zoom';
    if (!isPan && !isZoom) return;
    e.preventDefault();
    this.stage.setPointerCapture(e.pointerId);
    this.drag = {
      kind: isPan ? 'pan' : 'zoom',
      id: e.pointerId,
      x: p.x,
      y: p.y,
      sx: p.x,
      sy: p.y,
      scale0: this.view.current().scale,
      moved: false,
      alt: e.altKey,
    };
    this.updateCursor();
  }

  /** @param {PointerEvent} e */
  onPointerMove(e) {
    const d = this.drag;
    if (!d) {
      // Hovering: show a pointer over pins.
      if (e.target === this.view.canvas) {
        const p = this.local(e);
        const over = !!this.view.pinAt(p.x, p.y);
        if (over !== this.overPin) {
          this.overPin = over;
          this.updateCursor();
        }
      }
      return;
    }
    if (e.pointerId !== d.id) return;
    const p = this.local(e);
    if (d.kind === 'pan') {
      if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > 3) {
        d.moved = true;
        this.updateCursor();
      }
      this.view.pan(p.x - d.x, p.y - d.y);
    } else {
      if (!d.moved && Math.abs(p.x - d.sx) > 3) {
        d.moved = true;
        this.updateCursor();
      }
      if (d.moved) {
        const s = d.scale0 * Math.exp((p.x - d.sx) * SCRUB_K);
        this.view.set(zoomAt(this.view.viewport, s, d.sx, d.sy));
      }
    }
    d.x = p.x;
    d.y = p.y;
  }

  /** @param {PointerEvent} e */
  onPointerUp(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (!d.moved && e.type === 'pointerup' && this.hooks.onClick?.(d.sx, d.sy)) {
      this.updateCursor();
      return;
    }
    if (d.kind === 'zoom' && !d.moved && e.type === 'pointerup') {
      const dir = d.alt || e.altKey ? -1 : 1;
      this.view.glideTo(stepScale(this.view.current().scale, dir), { x: d.sx, y: d.sy });
    }
    this.updateCursor();
  }

  // ---- keyboard ------------------------------------------------------------

  /** @param {KeyboardEvent} e */
  onKeyDown(e) {
    if (isTyping(e)) return;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Alt') {
      this.alt = true;
      this.updateCursor();
    }

    if (e.code === 'Space') {
      e.preventDefault();
      if (!this.space) {
        this.space = true;
        this.updateCursor();
      }
      return;
    }

    // ⌘ or ⌃⌘ (Safari keeps ⌘1/⌘2 and page zoom for itself, so ⌃⌘ is the Safari-safe variant).
    if (mod && !e.altKey) {
      const v = this.view;
      switch (e.key) {
        case '=':
        case '+':
          e.preventDefault();
          v.glideTo(stepScale(v.current().scale, 1));
          return;
        case '-':
        case '_':
          e.preventDefault();
          v.glideTo(stepScale(v.current().scale, -1));
          return;
        case '0':
          e.preventDefault();
          v.glideFit();
          return;
        case '1':
          e.preventDefault();
          v.glideTo(1);
          return;
        case '2':
          e.preventDefault();
          v.glideTo(2);
          return;
      }
      return;
    }

    // Bare + / − also zoom: works in every browser, no modifier needed.
    if (!mod && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-')) {
      e.preventDefault();
      this.view.glideTo(stepScale(this.view.current().scale, e.key === '-' ? -1 : 1));
      return;
    }

    if (!mod && !e.altKey && !e.repeat) {
      const k = e.key.toLowerCase();
      if (k === 'h') this.setTool('hand');
      else if (k === 'z') this.setTool('zoom');
    }
  }

  /** @param {KeyboardEvent} e */
  onKeyUp(e) {
    if (e.key === 'Alt') {
      this.alt = false;
      this.updateCursor();
    }
    if (e.code === 'Space') {
      if (!isTyping(e)) e.preventDefault(); // stop Space from "clicking" a focused button
      this.space = false;
      this.updateCursor();
    }
  }
}

/** @param {KeyboardEvent} e */
function isTyping(e) {
  const t = /** @type {HTMLElement|null} */ (e.target);
  if (!t) return false;
  if (t.tagName === 'INPUT') return /** @type {HTMLInputElement} */ (t).type !== 'range';
  return t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
