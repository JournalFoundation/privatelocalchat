// Attached and library documents live in IndexedDB (conversations stay small in localStorage). A temporary chat's documents are
// kept in memory only.
const DB = "plc-docs", STORE = "docs";
const memory = new Map();
let opening = null;
const open = () => (opening ||= new Promise((resolve, reject) => {
  if (typeof indexedDB === "undefined") return reject(new Error("This browser cannot store documents."));
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "id" }); };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => { opening = null; reject(r.error || new Error("Document storage is unavailable.")); };
}));
const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode); const store = tx.objectStore(STORE); let result;
    Promise.resolve(fn(store)).then((v) => { result = v; }, reject);
    tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error("Document storage was interrupted."));
  });
};
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const docStore = {
  async put(doc) { if (doc.temporary) { memory.set(doc.id, doc); return; } await run("readwrite", (s) => req(s.put(doc))); },
  async get(id) { if (memory.has(id)) return memory.get(id); return run("readonly", (s) => req(s.get(id))); },
  async getMany(ids) { return Promise.all(ids.map((id) => this.get(id))); },
  async remove(id) { memory.delete(id); await run("readwrite", (s) => req(s.delete(id))); },
  /** Records without their text, for lists and the storage screen. */
  async list() {
    const out = [...memory.values()].map(meta);
    await run("readonly", (s) => new Promise((resolve, reject) => {
      const c = s.openCursor(); c.onerror = () => reject(c.error);
      c.onsuccess = () => { const cur = c.result; if (!cur) return resolve(); out.push(meta(cur.value)); cur.continue(); };
    }));
    return out;
  },
  async all() { const base = [...memory.values()]; const stored = await run("readonly", (s) => req(s.getAll())); return base.concat(stored); },
  /** Documents with library === true whose scope is everywhere or the given project. */
  async libraryFor(folderId) { return (await this.all()).filter((d) => d.library && d.scope !== "off" && (d.scope === "all" || (folderId && d.scope === folderId))); },
  /** Drop documents that no conversation or library entry refers to any more. */
  async prune(referencedIds) {
    const keep = new Set(referencedIds); let removed = 0;
    for (const d of await this.list()) if (!d.library && !keep.has(d.id)) { await this.remove(d.id); removed++; }
    return removed;
  },
  async clear() { memory.clear(); await run("readwrite", (s) => req(s.clear())); }
};
const meta = ({ id, name, kind, size, addedAt, pages, chars, library, scope, temporary, width, height }) => ({ id, name, kind, size, addedAt, pages, chars, library: Boolean(library), scope, temporary: Boolean(temporary), width, height, bytes: (chars ?? 0) * 2 + (size && kind === "image" ? size : 0) });
