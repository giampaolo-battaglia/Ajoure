// @ts-check
// Project files (.ajoure): the original image plus everything you did to it, in one file.
// Like a document: Save writes back to the same file. The file keeps the whole step history
// (every stroke, click and settings change, with its time — only the small patch each step
// changed, ~1–2 kB), so after reopening you can still go back to any step. Saved versions are
// markers in that history. The file is gzip-compressed (older plain-JSON files still open).

export const PROJECT_EXT = '.ajoure';
const FORMAT = 'ajoure-project';
const VERSION = 3;
/** Saved versions listed in a project. */
export const MAX_VERSIONS = 50;

/** @typedef {import('./doc.js').Patch} Patch */
/** @typedef {import('./doc.js').DocSettings} DocSettings */
/** @typedef {import('../engine/analyze.js').Seed} Seed */

/**
 * @typedef {Object} ProjectData
 * @property {string} name
 * @property {Blob} image  the original image (PNG)
 * @property {number} w @property {number} h
 * @property {Uint8Array} edits
 * @property {Seed[]} seeds
 * @property {import('../engine/adjust.js').Adjustments} adjust
 * @property {number|null} widthMm
 * @property {string} material
 * @property {string[]} ignored
 * @property {SavedVersion[]} [versions] every save, oldest first
 * @property {History} [history] the steps (undo + redo), to go back in time after reopening
 */
/**
 * @typedef {Object} History
 * @property {Patch[]} undo  oldest first; the current state is after the last one
 * @property {Patch[]} redo  as on the redo stack (next step to redo last)
 * @property {number} baseId @property {number} nextId
 */
/**
 * A save. New saves point at a step in the history (stepId); files from before that kept a full
 * copy instead (snapshot).
 * @typedef {Object} SavedVersion
 * @property {string} savedAt ISO time
 * @property {string} label what it looked like then ("2 leaks", "No leaks or islands")
 * @property {number} [stepId]
 * @property {{edits: Uint8Array, seeds: Seed[], adjust: import('../engine/adjust.js').Adjustments, widthMm: number|null, material: string, ignored: string[]}} [snapshot]
 */

/** @param {SavedVersion} v */
function packVersion(v) {
  if (v.stepId != null) return { savedAt: v.savedAt, label: v.label, stepId: v.stepId };
  const sn = /** @type {NonNullable<SavedVersion['snapshot']>} */ (v.snapshot);
  return { savedAt: v.savedAt, label: v.label, ...sn, edits: toBase64(rle(sn.edits)) };
}
/** @param {any} j @param {number} size @returns {SavedVersion} */
function unpackVersion(j, size) {
  const v = { savedAt: String(j.savedAt || ''), label: String(j.label || '') };
  if (typeof j.stepId === 'number') return { ...v, stepId: j.stepId };
  return {
    ...v,
    snapshot: {
      edits: unrle(fromBase64(j.edits || ''), size),
      seeds: Array.isArray(j.seeds) ? j.seeds : [],
      adjust: j.adjust,
      widthMm: typeof j.widthMm === 'number' ? j.widthMm : null,
      material: String(j.material || ''),
      ignored: Array.isArray(j.ignored) ? j.ignored.map(String) : [],
    },
  };
}

/** @param {Seed[]} a @param {Seed[]} b */
const sameSeeds = (a, b) => a.length === b.length && a.every((q, i) => q === b[i] || (q.x === b[i].x && q.y === b[i].y && q.cls === b[i].cls));

/**
 * One step, compact: the rect's before/after run-length encoded, and the Bucket/Engrave click it
 * added (not the whole list of clicks).
 * @param {Patch} p
 */
export function packPatch(p) {
  /** @type {any} */
  const o = { id: p.id, at: p.at, label: p.label };
  if (p.key) o.key = p.key;
  if (p.rect && p.before && p.after) {
    o.rect = p.rect;
    o.b = toBase64(rle(p.before));
    o.a = toBase64(rle(p.after));
  }
  const sb = p.seedsBefore, sa = p.seedsAfter;
  if (sa.length === sb.length + 1 && sameSeeds(sb, sa.slice(0, -1))) o.seed = sa[sa.length - 1];
  else if (!sameSeeds(sb, sa)) {
    o.seedsBefore = sb;
    o.seedsAfter = sa;
  }
  if (p.settings) o.settings = p.settings;
  return o;
}

/**
 * Rebuild the steps around the saved state (whose clicks are `seeds`).
 * @param {any} j saved history @param {Seed[]} seeds
 * @returns {History}
 */
export function unpackHistory(j, seeds) {
  /** @param {any} o @returns {Patch} */
  const base = (o) => {
    /** @type {Patch} */
    const p = { id: o.id, at: o.at, label: String(o.label || ''), rect: null, before: null, after: null, seedsBefore: [], seedsAfter: [] };
    if (o.key) p.key = o.key;
    if (o.rect && o.b != null && o.a != null) {
      p.rect = o.rect;
      const size = o.rect[2] * o.rect[3];
      p.before = unrle(fromBase64(o.b), size);
      p.after = unrle(fromBase64(o.a), size);
    }
    if (o.settings) p.settings = o.settings;
    return p;
  };
  const undo = (Array.isArray(j?.undo) ? j.undo : []).map(base);
  const redo = (Array.isArray(j?.redo) ? j.redo : []).map(base);
  const raw = new Map([...(j?.undo || []), ...(j?.redo || [])].map((o) => [o.id, o]));
  // Clicks: walk back from the saved state through the undo steps, and forward through the redo steps.
  let cur = seeds.slice();
  for (let i = undo.length - 1; i >= 0; i--) {
    const o = raw.get(undo[i].id);
    undo[i].seedsAfter = o.seedsAfter ? o.seedsAfter : cur.slice();
    undo[i].seedsBefore = o.seedsBefore ? o.seedsBefore : o.seed ? cur.slice(0, -1) : cur.slice();
    cur = undo[i].seedsBefore;
  }
  cur = seeds.slice();
  for (let i = redo.length - 1; i >= 0; i--) {
    const o = raw.get(redo[i].id);
    redo[i].seedsBefore = o.seedsBefore ? o.seedsBefore : cur.slice();
    redo[i].seedsAfter = o.seedsAfter ? o.seedsAfter : o.seed ? [...cur, o.seed] : cur.slice();
    cur = redo[i].seedsAfter;
  }
  const ids = [...undo, ...redo].map((p) => /** @type {number} */ (p.id) || 0);
  return {
    undo,
    redo,
    baseId: typeof j?.baseId === 'number' ? j.baseId : 0,
    nextId: Math.max(typeof j?.nextId === 'number' ? j.nextId : 1, ...ids.map((i) => i + 1)),
  };
}

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
    versions: (p.versions || []).slice(-MAX_VERSIONS).map(packVersion),
    history: p.history
      ? { undo: p.history.undo.map(packPatch), redo: p.history.redo.map(packPatch), baseId: p.history.baseId, nextId: p.history.nextId }
      : undefined,
  };
  const text = new Blob([JSON.stringify(json)], { type: 'application/json' });
  // Compressed: the history (and the rest) shrinks ~4×; the image inside is already compressed.
  if (typeof CompressionStream === 'undefined') return text;
  const gz = text.stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(gz).arrayBuffer()], { type: 'application/octet-stream' });
}

/**
 * @param {Blob} blob
 * @returns {Promise<ProjectData>}
 */
export async function decodeProject(blob) {
  /** @type {any} */
  let j;
  try {
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    const gz = head[0] === 0x1f && head[1] === 0x8b;
    if (gz && typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open compressed projects.');
    const text = gz ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await blob.text();
    j = JSON.parse(text);
  } catch (err) {
    if (err instanceof Error && /browser/.test(err.message)) throw err;
    throw new Error('That project file is damaged (not valid JSON).');
  }
  if (!j || j.format !== FORMAT) throw new Error('That isn’t an Ajouré project file.');
  if (j.version > VERSION) throw new Error('That project was saved by a newer Ajouré.');
  const image = await (await fetch(j.image)).blob();
  const edits = unrle(fromBase64(j.edits || ''), j.w * j.h);
  const versions = Array.isArray(j.versions) ? j.versions.map((/** @type {any} */ v) => unpackVersion(v, j.w * j.h)) : [];
  const seeds = Array.isArray(j.seeds) ? j.seeds : [];
  return {
    name: String(j.name || 'Untitled'),
    image,
    w: j.w,
    h: j.h,
    edits,
    seeds,
    adjust: j.adjust,
    widthMm: typeof j.widthMm === 'number' ? j.widthMm : null,
    material: String(j.material || ''),
    ignored: Array.isArray(j.ignored) ? j.ignored.map(String) : [],
    versions,
    history: j.history ? unpackHistory(j.history, seeds) : undefined,
  };
}

/**
 * Write a blob into a file the user already chose (Save on a project opened or saved before).
 * Asks for permission again if the browser dropped it.
 * @param {any} handle FileSystemFileHandle @param {Blob} blob
 * @returns {Promise<boolean>} written
 */
export async function writeToHandle(handle, blob) {
  try {
    let perm = await handle.queryPermission?.({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await handle.requestPermission?.({ mode: 'readwrite' });
    if (perm && perm !== 'granted') return false;
    const out = await handle.createWritable();
    await out.write(blob);
    await out.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick a file to open with the system dialog, keeping a handle so Save can write back to it
 * (Chrome). Returns null when not supported (use the plain file input) or cancelled.
 * @returns {Promise<{file: File, handle: any}|null|'unsupported'>}
 */
export async function pickFileToOpen() {
  const w = /** @type {any} */ (window);
  if (typeof w.showOpenFilePicker !== 'function') return 'unsupported';
  try {
    const [handle] = await w.showOpenFilePicker({
      types: [
        { description: 'Images and Ajouré projects', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'], 'application/json': [PROJECT_EXT] } },
      ],
      excludeAcceptAllOption: false,
      multiple: false,
    });
    return { file: await handle.getFile(), handle };
  } catch (err) {
    if (err && /** @type {any} */ (err).name === 'AbortError') return null;
    return 'unsupported';
  }
}

/**
 * Save a blob where the user chooses (Chrome) or to Downloads (Safari).
 * @param {Blob} blob @param {string} filename
 * @param {{description: string, mime: string, ext: string}} [kind] defaults to an Ajouré project
 * @param {(handle: any) => void} [onHandle] told the file the user picked (to save back to it later)
 * @returns {Promise<'saved'|'downloaded'|'cancelled'>}
 */
export async function saveBlob(blob, filename, kind = { description: 'Ajouré project', mime: 'application/json', ext: PROJECT_EXT }, onHandle) {
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
      onHandle?.(handle);
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
async function blobToDataUrl(blob) {
  return `data:${blob.type || 'image/png'};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}
