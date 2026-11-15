/* Working folder (v5.3.28): the user chooses a folder on their computer once; builds read edited documents from
   it and save their output into it, and the Import tab updates documents in it, instead of handing out ZIP
   files. Uses the browser's folder access (File System Access API: Chrome, Edge and the ISAF desktop app); the
   browser asks the user to allow it. Other browsers keep the ZIP downloads. Nothing about the folder is sent to
   the server. Before a file is replaced, the previous version is copied to _ISAF_backup/<date-time>/ in the
   folder. The chosen folder is remembered in this browser (IndexedDB). */
(() => {
  const BACKUP = '_ISAF_backup';
  const supported = () => typeof window.showDirectoryPicker === 'function';
  let handle = null, listeners = [];
  const emit = () => { for (const fn of listeners) { try { fn(handle); } catch {} } };

  // ------------------------------------------------------------ remembered folder (IndexedDB; may be unavailable)
  const db = () => new Promise((resolve, reject) => { const r = indexedDB.open('isaf-working-folder', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  async function store(value) { try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction('h', 'readwrite'); value ? t.objectStore('h').put(value, 'folder') : t.objectStore('h').delete('folder'); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch {} }
  async function restore() { try { const d = await db(); return await new Promise(res => { const r = d.transaction('h').objectStore('h').get('folder'); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch { return null; } }

  async function choose() {
    if (!supported()) throw new Error('This browser cannot save into a folder. Use Chrome or Edge, or keep using ZIP downloads.');
    const h = await window.showDirectoryPicker({ id: 'isaf-working-folder', mode: 'readwrite' });
    handle = h; await store(h); emit(); return h;
  }
  async function forget() { handle = null; await store(null); emit(); }
  /** Ask for read/write access if needed (call from a click). Returns false when the user refuses. */
  async function ready() {
    if (!handle) return false;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission?.(opts)) === 'granted') return true;
    return (await handle.requestPermission?.(opts)) === 'granted';
  }

  // ------------------------------------------------------------ reading
  /** Every .docx in the folder and its subfolders (not backups or Word lock files): [{path, file}]. */
  async function documents({ max = 2000 } = {}) {
    const out = [];
    async function walk(dir, prefix) {
      for await (const [name, entry] of dir.entries()) {
        if (out.length >= max) return;
        if (entry.kind === 'directory') { if (name !== BACKUP && !name.startsWith('.')) await walk(entry, prefix + name + '/'); }
        else if (/\.docx$/i.test(name) && !name.startsWith('~$')) out.push({ path: prefix + name, file: await entry.getFile() });
      }
    }
    await walk(handle, '');
    return out;
  }

  // ------------------------------------------------------------ small ZIP reader (stored and deflated entries)
  async function zipEntries(blob) {
    const tail = new DataView(await blob.slice(Math.max(0, blob.size - 65557)).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a ZIP file.');
    const cdSize = tail.getUint32(eocd + 12, true), cdOffset = tail.getUint32(eocd + 16, true);
    if (cdOffset === 0xffffffff) throw new Error('This ZIP is too large to unpack here.');
    const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const entries = [], dec = new TextDecoder();
    for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50;) {
      const method = cd.getUint16(p + 10, true), compressed = cd.getUint32(p + 20, true), n = cd.getUint16(p + 28, true), x = cd.getUint16(p + 30, true), c = cd.getUint16(p + 32, true), offset = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, n));
      if (!name.endsWith('/')) entries.push({ name, method, compressed, offset });
      p += 46 + n + x + c;
    }
    return entries;
  }
  async function zipRead(blob, entry) {
    const head = new DataView(await blob.slice(entry.offset, entry.offset + 30).arrayBuffer());
    const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const data = blob.slice(start, start + entry.compressed);
    if (entry.method === 0) return new Uint8Array(await data.arrayBuffer());
    if (entry.method !== 8) throw new Error(`Unsupported compression in ${entry.name}.`);
    return new Uint8Array(await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  /** ISAF identity of a generated Word document ({pn, doc, item, ...}), or null. */
  async function identity(file) {
    try {
      const e = (await zipEntries(file)).find(x => x.name === 'word/settings.xml');
      if (!e) return null;
      const xml = new TextDecoder().decode(await zipRead(file, e));
      const m = xml.match(/<w:docVar w:name="ISAF_DOC_IDENTITY" w:val="([^"]*)"\s*\/>/);
      if (!m) return null;
      return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&'));
    } catch { return null; }
  }

  // ------------------------------------------------------------ writing
  const stamp = () => new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
  const parts = path => String(path).replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..');
  async function dirFor(segments, create) { let d = handle; for (const s of segments) d = await d.getDirectoryHandle(s, { create }); return d; }
  async function existing(path) { const p = parts(path); try { return await (await dirFor(p.slice(0, -1), false)).getFileHandle(p.at(-1)); } catch { return null; } }
  async function put(path, data) {
    const p = parts(path), dir = await dirFor(p.slice(0, -1), true), fh = await dir.getFileHandle(p.at(-1), { create: true });
    const w = await fh.createWritable(); await w.write(data); await w.close();
  }
  /** Write files [{path, data}] into the folder; an existing file is copied to _ISAF_backup/<stamp>/ first. */
  async function writeFiles(files, { backupStamp = stamp() } = {}) {
    let written = 0, backedUp = 0; const failed = [];
    for (const f of files) {
      try {
        const old = await existing(f.path);
        if (old) { await put(`${BACKUP}/${backupStamp}/${parts(f.path).join('/')}`, await old.getFile()); backedUp++; }
        await put(f.path, f.data); written++;
      } catch (e) { failed.push({ path: f.path, error: e.message }); }
    }
    return { written, backedUp, failed, backup: backedUp ? `${BACKUP}/${backupStamp}` : '' };
  }
  async function remove(path) { const p = parts(path); await (await dirFor(p.slice(0, -1), false)).removeEntry(p.at(-1)); }
  /** Unpack a ZIP (a build) into the folder. A Word document that replaces an older file of the same document
      number under another name (a new revision or draft) moves the older file to the backup, so the folder
      holds one current file per document. */
  async function writeZip(blob, { backupStamp = stamp() } = {}) {
    const entries = await zipEntries(blob), files = [];
    for (const e of entries) files.push({ path: e.name, data: await zipRead(blob, e) });
    const incoming = new Map();
    for (const f of files) if (/\.docx$/i.test(f.path)) { const id = await identity(new Blob([f.data])); if (id?.pn) incoming.set(`${id.pn}|${id.doc}`, parts(f.path).join('/')); }
    let superseded = 0;
    if (incoming.size) {
      for (const d of await documents()) {
        const id = await identity(d.file), key = id?.pn && `${id.pn}|${id.doc}`;
        if (!key || !incoming.has(key) || incoming.get(key) === d.path) continue;
        try { await put(`${BACKUP}/${backupStamp}/${d.path}`, d.file); await remove(d.path); superseded++; } catch {}
      }
    }
    const result = await writeFiles(files, { backupStamp });
    result.superseded = superseded; result.backup = (result.backedUp || superseded) ? `${BACKUP}/${backupStamp}` : '';
    return result;
  }

  if (typeof indexedDB !== 'undefined') restore().then(h => { if (h && !handle) { handle = h; emit(); } });
  window.workingFolder = {
    supported, choose, forget, ready, documents, identity, writeFiles, writeZip, zipEntries, zipRead, stamp,
    get handle() { return handle; }, name: () => handle?.name || '',
    _use: h => { handle = h; emit(); }, // tests
    onChange: fn => { listeners.push(fn); fn(handle); },
  };
})();
