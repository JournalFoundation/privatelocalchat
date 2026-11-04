// A storage backend for wllama's cache manager that keeps model files in IndexedDB, in 16 MiB chunks, for browsers where OPFS cannot be opened.
// Seen on an iPhone 11 Pro (iOS 18.6.2, Safari): navigator.storage.getDirectory() rejects with "UnknownError: The operation failed for an unknown transient reason".
// Why not the Cache API: it works there, but reading a response (Response.blob()) loads the WHOLE body into memory, and the runtime re-opens the source file several times while
// it loads a model (progressive source release), so a 223 MB model blew the page up. IndexedDB hands back each stored chunk as a file-backed Blob; the file is a Blob made of
// those chunks, so opening it again costs nothing. A file's metadata record is written last, so a write that does not finish leaves no file. Same interface as the vendored
// OPFS backend (wllama v1q): isSupported, read, write, getSize, list, delete. Pure but for the indexedDB and IDBKeyRange passed in.

const CHUNK = 16 * 1024 * 1024;
const META = (name) => "m:" + name;
const CHUNK_KEY = (name, i) => "c:" + name + ":" + i;

const request = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error || new Error("IndexedDB request failed")); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed")); tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted")); });

export function createIdbFileBackend({ indexedDB = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange, dbName = "plc-model-files-v1" } = {}) {
  let dbPromise = null;
  const db = () => (dbPromise ||= new Promise((resolve, reject) => {
    const open = indexedDB.open(dbName, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore("files"); };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => { dbPromise = null; reject(open.error || new Error("IndexedDB could not be opened")); };
  }));
  const store = async (mode) => { const tx = (await db()).transaction("files", mode); return { tx, files: tx.objectStore("files") }; };
  const get = async (key) => { const { tx, files } = await store("readonly"); const v = await request(files.get(key)); void tx; return v; };
  const put = async (key, value) => { const { tx, files } = await store("readwrite"); files.put(value, key); await done(tx); };
  async function removeChunks(name) {
    const { tx, files } = await store("readwrite");
    files.delete(keyRange.bound("c:" + name + ":", "c:" + name + ";", false, true)); // every chunk of this file (":" sorts just before ";")
    files.delete(META(name));
    await done(tx);
  }
  return {
    kind: "indexeddb",
    isSupported: () => Boolean(indexedDB?.open && keyRange?.bound),
    /** The file as a Blob made of the stored chunks, or null when it is not there. */
    async read(key) {
      try {
        const meta = await get(META(key));
        if (!meta) return null;
        const parts = [];
        for (let i = 0; i < meta.chunks; i++) { const part = await get(CHUNK_KEY(key, i)); if (!part) return null; parts.push(part); }
        return new Blob(parts, { type: "application/octet-stream" });
      } catch { return null; }
    },
    /** Stores the stream. Nothing is kept unless the whole stream arrived. */
    async write(key, stream) {
      await removeChunks(key);
      const reader = stream.getReader();
      let size = 0, chunks = 0, pending = [], pendingBytes = 0;
      const flush = async () => {
        if (!pendingBytes) return;
        const bytes = new Uint8Array(pendingBytes); let at = 0;
        for (const p of pending) { bytes.set(p, at); at += p.byteLength; }
        pending = []; pendingBytes = 0;
        await put(CHUNK_KEY(key, chunks++), new Blob([bytes]));
      };
      try {
        for (;;) {
          const { done: finished, value } = await reader.read();
          if (finished) break;
          size += value.byteLength; pending.push(value); pendingBytes += value.byteLength;
          if (pendingBytes >= CHUNK) await flush();
        }
        await flush();
        await put(META(key), { size, chunks });
      } catch (error) { await removeChunks(key).catch(() => {}); throw error; }
    },
    /** Size in bytes, or -1 when it is not there. */
    async getSize(key) { try { const meta = await get(META(key)); return meta ? meta.size : -1; } catch { return -1; } },
    async list() {
      const { tx, files } = await store("readonly");
      const keys = await request(files.getAllKeys(keyRange.bound("m:", "m;", false, true)));
      void tx;
      const out = [];
      for (const k of keys) { const meta = await get(k); if (meta) out.push({ key: String(k).slice(2), size: meta.size }); }
      return out;
    },
    async delete(key) { await removeChunks(key); },
  };
}
