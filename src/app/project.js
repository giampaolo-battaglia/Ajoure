// @ts-check
// Project files (.ajoure): the original image plus everything you did to it, in one JSON file.
// Undo history isn't kept: reopening starts a fresh history from the saved state.

export const PROJECT_EXT = '.ajoure';
const FORMAT = 'ajoure-project';
const VERSION = 1;

/**
 * @typedef {Object} ProjectData
 * @property {string} name
 * @property {Blob} image  the original image (PNG)
 * @property {number} w @property {number} h
 * @property {Uint8Array} edits
 * @property {import('../engine/analyze.js').Seed[]} seeds
 * @property {import('../engine/adjust.js').Adjustments} adjust
 * @property {number|null} widthMm
 * @property {string} material
 * @property {string[]} ignored
 */

/** @param {string} name */
export function isProjectName(name) {
  return name.toLowerCase().endsWith(PROJECT_EXT);
}

/**
 * Pack a project into a JSON blob.
 * @param {ProjectData} p
 */
export async function encodeProject(p) {
  const json = {
    format: FORMAT,
    version: VERSION,
    app: 'Ajouré',
    savedAt: new Date().toISOString(),
    name: p.name,
    w: p.w,
    h: p.h,
    image: await blobToDataUrl(p.image),
    edits: toBase64(rle(p.edits)),
    seeds: p.seeds,
    adjust: p.adjust,
    widthMm: p.widthMm,
    material: p.material,
    ignored: p.ignored,
  };
  return new Blob([JSON.stringify(json)], { type: 'application/json' });
}

/**
 * @param {Blob} blob
 * @returns {Promise<ProjectData>}
 */
export async function decodeProject(blob) {
  /** @type {any} */
  let j;
  try {
    j = JSON.parse(await blob.text());
  } catch {
    throw new Error('That project file is damaged (not valid JSON).');
  }
  if (!j || j.format !== FORMAT) throw new Error('That isn’t an Ajouré project file.');
  if (j.version > VERSION) throw new Error('That project was saved by a newer Ajouré.');
  const image = await (await fetch(j.image)).blob();
  const edits = unrle(fromBase64(j.edits || ''), j.w * j.h);
  return {
    name: String(j.name || 'Untitled'),
    image,
    w: j.w,
    h: j.h,
    edits,
    seeds: Array.isArray(j.seeds) ? j.seeds : [],
    adjust: j.adjust,
    widthMm: typeof j.widthMm === 'number' ? j.widthMm : null,
    material: String(j.material || ''),
    ignored: Array.isArray(j.ignored) ? j.ignored.map(String) : [],
  };
}

/**
 * Save a blob where the user chooses (Chrome) or to Downloads (Safari).
 * @param {Blob} blob @param {string} filename
 * @param {{description: string, mime: string, ext: string}} [kind] defaults to an Ajouré project
 * @returns {Promise<'saved'|'downloaded'|'cancelled'>}
 */
export async function saveBlob(blob, filename, kind = { description: 'Ajouré project', mime: 'application/json', ext: PROJECT_EXT }) {
  const w = /** @type {any} */ (window);
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: kind.description, accept: { [kind.mime]: [kind.ext] } }],
      });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return 'saved';
    } catch (err) {
      if (err && /** @type {any} */ (err).name === 'AbortError') return 'cancelled';
      // Not allowed here (e.g. inside a frame): fall back to a download.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

// ---- encoding helpers (pure) -------------------------------------------------------

/**
 * Run-length encode bytes as [value, count] pairs (count as 4 little-endian bytes).
 * The edits layer is mostly zeros, so this is tiny.
 * @param {Uint8Array} a
 */
export function rle(a) {
  /** @type {number[]} */
  const out = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let j = i + 1;
    while (j < a.length && a[j] === v && j - i < 0xffffffff) j++;
    const n = j - i;
    out.push(v, n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    i = j;
  }
  return Uint8Array.from(out);
}

/** @param {Uint8Array} r @param {number} size */
export function unrle(r, size) {
  const out = new Uint8Array(size);
  let p = 0;
  for (let i = 0; i + 4 < r.length && p < size; i += 5) {
    const v = r[i];
    const n = r[i + 1] | (r[i + 2] << 8) | (r[i + 3] << 16) | (r[i + 4] << 24);
    out.fill(v, p, Math.min(size, p + (n >>> 0)));
    p += n >>> 0;
  }
  return out;
}

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** @param {string} b64 */
export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** @param {Blob} blob @returns {Promise<string>} */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
