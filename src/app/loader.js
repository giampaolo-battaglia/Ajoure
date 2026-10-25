// @ts-check
// Getting images in: drag-and-drop, paste, Open dialog, bundled sample.

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const EXT = /\.(png|jpe?g|webp)$/i;
const MAX_PIXELS = 80_000_000; // ~ 8000 × 10000

/**
 * @typedef {{name: string, bitmap: ImageBitmap, width: number, height: number}} LoadedImage
 */

export class LoadError extends Error {}

/**
 * @param {Blob} blob @param {string} name
 * @returns {Promise<LoadedImage>}
 */
export async function loadBlob(blob, name) {
  if (!ACCEPTED.includes(blob.type) && !EXT.test(name)) {
    throw new LoadError('Ajouré opens PNG, JPG and WebP images.');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new LoadError('That image couldn’t be read. Is the file complete?');
  }
  if (bitmap.width * bitmap.height > MAX_PIXELS) {
    bitmap.close();
    throw new LoadError('That image is too large (over 80 megapixels).');
  }
  return { name: displayName(name), bitmap, width: bitmap.width, height: bitmap.height };
}

/** "julie-input.png" → "julie-input" @param {string} name */
function displayName(name) {
  return name.replace(/\.[a-z0-9]+$/i, '') || 'Untitled';
}

/**
 * Wire up every way an image can arrive.
 * @param {{
 *   app: HTMLElement, fileInput: HTMLInputElement,
 *   onBlob: (blob: Blob, name: string, handle?: Promise<any>|null) => void,
 * }} opts
 */
export function bindLoaders({ app, fileInput, onBlob }) {
  // Drag and drop anywhere on the window.
  let depth = 0;
  const hasFiles = (/** @type {DragEvent} */ e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    app.dataset.dragging = 'true';
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) delete app.dataset.dragging;
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    delete app.dataset.dragging;
    const file = e.dataTransfer?.files?.[0];
    // Chrome can also give the dropped file itself, so Save can write back to a dropped project.
    const item = /** @type {any} */ (e.dataTransfer?.items?.[0]);
    const handle = item && typeof item.getAsFileSystemHandle === 'function' ? item.getAsFileSystemHandle().catch(() => null) : null;
    if (file) onBlob(file, file.name, handle);
  });

  // Paste (⌘V) an image or an image file.
  window.addEventListener('paste', (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          onBlob(file, file.name && file.name !== 'image.png' ? file.name : 'Pasted image.png');
          return;
        }
      }
    }
  });

  // Open dialog.
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) onBlob(file, file.name);
    fileInput.value = '';
  });
}

/** Fetch the bundled Julie sample. */
export async function fetchSample() {
  const res = await fetch('fixtures/julie-input.png');
  if (!res.ok) throw new LoadError('The sample image is missing from the fixtures folder.');
  return res.blob();
}
