// The page's side of the on-device text-to-speech engine (Kitten TTS nano 0.8 int8 in a same-origin worker, ONNX Runtime Web WASM).
// Nothing in the app calls this yet. It downloads the three model files once, verifies each against a pinned manifest, keeps them in the
// origin's private storage (OPFS) under their own directory, and synthesises speech on the device. The text never leaves the page.
//
//   const engine = createVoiceEngine({ baseUrl: "https://assets.privatelocal.chat/models/voice/kitten-nano-0.8-int8/" });
//   await engine.install(({ overallLoaded, overallTotal }) => ...);      // resumable per file by retry; verified by SHA-256
//   const stats = await engine.speak("Hello there.", { onChunk: ({ samples, sampleRate }) => play(samples), signal });
//   // stats: { audioSeconds, synthSeconds, realTimeFactor, firstAudioMs }
//   await engine.remove();                                                // deletes the directory
//
// Limits: English only; digits and abbreviations are not expanded; OPFS writing uses createWritable() (Chrome, Edge, Firefox, Safari 26+).

import { sha256 } from "../runtime/providers/vendor/noble-hashes/2.4.0/sha2.js";
import { retryDownload } from "../runtime/providers/download-retry.mjs";
import { KITTEN_NANO_MANIFEST } from "./voice-manifest.mjs";
import { SAMPLE_RATE } from "./voice-kitten.mjs";

export const VOICE_DIR = "plc-voice-kitten-nano-0.8";
const MARKER = "installed.json";
const SAMPLE_SENTENCE = "Hello, this is a sample of the voice that runs on your device.";
const DEFAULT_WORKER_URL = () => new URL("./vendor/voice/worker.js", import.meta.url).href;

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const failure = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const abortError = () => new DOMException("Speech cancelled", "AbortError");
const isMissing = (e) => e?.name === "NotFoundError";

/** Checks a manifest object (used for the one passed in): ids, names, sizes and 64-hex SHA-256 values. Throws on the first problem. */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.files) || !manifest.files.length) throw failure("bad-manifest", "the voice manifest lists no files");
  const roles = new Set();
  for (const f of manifest.files) {
    if (!f || typeof f.name !== "string" || !/^[A-Za-z0-9._-]+$/.test(f.name) || f.name === MARKER) throw failure("bad-manifest", `bad file name in the voice manifest: ${f?.name}`);
    if (!Number.isSafeInteger(f.bytes) || f.bytes <= 0) throw failure("bad-manifest", `bad size for ${f.name}`);
    if (!/^[0-9a-f]{64}$/.test(f.sha256 || "")) throw failure("bad-manifest", `bad SHA-256 for ${f.name}`);
    roles.add(f.role);
  }
  for (const role of ["model", "voices", "config"]) if (!roles.has(role)) throw failure("bad-manifest", `the voice manifest has no ${role} file`);
  return manifest;
}

export function createVoiceEngine({
  cachesImpl, baseUrl, manifest = KITTEN_NANO_MANIFEST, fetchImpl, workerUrl, dirName = VOICE_DIR, getRoot, createWorker, threads, attempts = 4, pause,
} = {}) {
  const fetchFn = fetchImpl || ((...args) => globalThis.fetch(...args));
  const root = getRoot || (() => globalThis.navigator.storage.getDirectory());
  const makeWorker = createWorker || ((url) => {
    if (typeof Worker !== "function") throw new Error("this browser cannot start a web worker");
    return new Worker(url, { type: "module", name: "voice-engine" });
  });
  const base = baseUrl ? (baseUrl.endsWith("/") ? baseUrl : baseUrl + "/") : null;
  const totalBytes = () => manifest.files.reduce((n, f) => n + f.bytes, 0);

  let worker = null, loading = null, loaded = false, installing = null, seq = 0, queue = Promise.resolve();
  const pending = new Map();

  const directory = async (create) => {
    try { return await (await root()).getDirectoryHandle(dirName, { create }); } catch (e) { if (!create && isMissing(e)) return null; throw e; }
  };
  const readMarker = async (dir) => {
    try { return JSON.parse(await (await (await dir.getFileHandle(MARKER)).getFile()).text()); } catch { return null; }
  };

  async function status() {
    const dir = await directory(false);
    let installed = false, bytes = 0;
    if (dir) {
      const marker = await readMarker(dir);
      if (marker?.id === manifest.id) {
        installed = true;
        for (const f of manifest.files) {
          try { const size = (await (await dir.getFileHandle(f.name)).getFile()).size; bytes += size; if (size !== f.bytes) installed = false; } catch { installed = false; }
        }
      }
    }
    return { id: manifest.id, installed, bytes: installed ? bytes : 0, totalBytes: totalBytes(), loaded, loading: Boolean(loading && !loaded), installing: Boolean(installing) };
  }

  async function removeDirectory() {
    try { await (await root()).removeEntry(dirName, { recursive: true }); } catch (e) { if (!isMissing(e)) throw e; }
  }

  async function downloadOne(dir, file, { signal, onBytes }) {
    const handle = await dir.getFileHandle(file.name, { create: true });
    return retryDownload(async () => {
      signal?.throwIfAborted();
      const response = await fetchFn(base + file.name, { signal });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${file.name}`), { status: response.status });
      const hash = sha256.create();
      let size = 0;
      const writable = await handle.createWritable(); // truncates: a retry starts the file over
      let ok = false;
      try {
        const take = async (chunk) => { hash.update(chunk); size += chunk.byteLength; await writable.write(chunk); onBytes(chunk.byteLength, size); };
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          for (;;) { const { done, value } = await reader.read(); if (done) break; await take(value); }
        } else await take(new Uint8Array(await response.arrayBuffer()));
        await writable.close(); ok = true;
      } finally { if (!ok) { try { await writable.abort?.(); } catch { /* already closed */ } } }
      const digest = hex(hash.digest());
      if (size !== file.bytes || digest !== file.sha256) {
        throw failure("hash-mismatch", `${file.name} does not match its pinned checksum (got ${size} bytes, SHA-256 ${digest.slice(0, 12)})`, { file: file.name });
      }
    }, { signal, attempts, pause, onRetry: (info) => onBytes(0, 0, info) });
  }

  function install(onProgress, { signal } = {}) {
    if (installing) return installing;
    if (!base) return Promise.reject(failure("no-base-url", "createVoiceEngine needs a baseUrl to install from"));
    installing = (async () => {
      validateManifest(manifest);
      const before = await status();
      if (before.installed) return before;
      await removeDirectory(); // never build on a half-written set
      const dir = await (await root()).getDirectoryHandle(dirName, { create: true });
      let done = 0;
      try {
        for (const file of manifest.files) {
          let fileLoaded = 0;
          await downloadOne(dir, file, {
            signal,
            onBytes: (delta, size, retry) => {
              if (retry) { onProgress?.({ file: file.name, phase: "retry", ...retry }); return; }
              fileLoaded = size;
              onProgress?.({ file: file.name, loaded: fileLoaded, total: file.bytes, overallLoaded: done + fileLoaded, overallTotal: totalBytes() });
            },
          });
          done += file.bytes;
        }
        const marker = await (await dir.getFileHandle(MARKER, { create: true })).createWritable();
        await marker.write(JSON.stringify({ id: manifest.id, installedAt: Date.now(), files: manifest.files.map(({ name, bytes, sha256: s }) => ({ name, bytes, sha256: s })) }));
        await marker.close();
      } catch (error) {
        await removeDirectory().catch(() => {});
        throw error;
      }
      return { ...(await status()), installing: false };
    })().finally(() => { installing = null; });
    return installing;
  }

  const discardWorker = (reason) => {
    const previous = worker;
    worker = null; loading = null; loaded = false;
    try { previous?.terminate(); } catch { /* gone */ }
    for (const p of pending.values()) p.reject(reason instanceof Error ? reason : new Error(`the voice worker stopped (${reason})`));
    pending.clear();
  };

  function call(message, handlers = {}, transfer) {
    return new Promise((resolve, reject) => {
      if (!worker) { reject(new Error("the voice worker is not running")); return; }
      const id = ++seq;
      pending.set(id, { ...handlers, resolve, reject });
      try { worker.postMessage({ id, ...message }, transfer); } catch (error) { pending.delete(id); reject(error); }
    });
  }

  function wire(instance) {
    instance.onmessage = ({ data }) => {
      if (instance !== worker || !data) return;
      const p = pending.get(data.id);
      if (!p) return;
      if (data.event === "chunk") { try { p.onChunk?.({ samples: data.samples, sampleRate: SAMPLE_RATE, index: data.index, count: data.count, text: data.text }); } catch { /* the caller's playback error is theirs */ } return; }
      pending.delete(data.id);
      if (data.ok) p.resolve(data); else p.reject(Object.assign(new Error(data.error?.message || "voice worker failed"), { name: data.error?.name || "Error" }));
    };
    instance.onerror = (event) => { if (instance === worker) discardWorker(new Error(event?.message || "the voice worker failed")); };
    instance.onmessageerror = () => { if (instance === worker) discardWorker("its message could not be read"); };
  }

  function load() {
    if (loading) return loading;
    loading = (async () => {
      const current = await status();
      if (!current.installed) throw failure("not-installed", "the voice is not installed");
      worker = makeWorker(workerUrl || DEFAULT_WORKER_URL());
      wire(worker);
      const files = Object.fromEntries(manifest.files.map((f) => [f.role, f.name]));
      const reply = await call({ op: "load", dir: dirName, files, threads });
      loaded = true;
      return { voices: reply.voices, loadMs: reply.loadMs };
    })().catch((error) => { discardWorker(error); throw error; });
    return loading;
  }

  async function unload() {
    if (worker && loaded) { try { await call({ op: "unload" }); } catch { /* terminated below anyway */ } }
    discardWorker("unloaded");
  }

  /** The service worker keeps the 13 MB ONNX Runtime files in the app cache the first time they are used. Removing the voice removes those too. */
  async function purgeRuntimeCache() {
    const store = cachesImpl || globalThis.caches;
    if (!store?.keys) return 0;
    let removed = 0;
    try {
      for (const name of await store.keys()) {
        const cache = await store.open(name);
        for (const request of await cache.keys()) {
          if (/\/vendor\/voice\/ort-wasm[^/]*$/.test(new URL(request.url).pathname) && await cache.delete(request)) removed++;
        }
      }
    } catch { /* a cache that cannot be cleaned is not fatal; the model files are already gone */ }
    return removed;
  }

  async function remove() {
    await unload();
    await removeDirectory();
    await purgeRuntimeCache();
    return status();
  }

  function speak(text, { onChunk, signal, speed, voice } = {}) {
    const run = async () => {
      signal?.throwIfAborted();
      await load();
      signal?.throwIfAborted();
      const started = performance.now();
      let target = null;
      const onAbort = () => { if (target !== null) try { worker?.postMessage({ op: "cancel", target }); } catch { /* worker gone */ } };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const reply = await new Promise((resolve, reject) => {
          if (!worker) { reject(new Error("the voice worker is not running")); return; }
          const id = ++seq; target = id;
          pending.set(id, { onChunk, resolve, reject });
          if (signal?.aborted) { pending.delete(id); reject(abortError()); return; }
          worker.postMessage({ id, op: "speak", text: String(text ?? ""), speed, voice });
        });
        if (signal?.aborted) throw abortError();
        const audioSeconds = reply.samples / SAMPLE_RATE;
        const synthSeconds = reply.synthMs / 1000;
        return {
          audioSeconds, synthSeconds, realTimeFactor: synthSeconds > 0 ? audioSeconds / synthSeconds : 0, firstAudioMs: reply.firstAudioMs,
          chunks: reply.chunks, wallSeconds: (performance.now() - started) / 1000,
        };
      } finally { signal?.removeEventListener("abort", onAbort); }
    };
    // one synthesis at a time: the worker has one session
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  async function sample(options = {}) {
    const parts = [];
    const stats = await speak(SAMPLE_SENTENCE, { ...options, onChunk: (c) => { parts.push(c.samples); options.onChunk?.(c); } });
    const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { audio.set(p, at); at += p.length; }
    return { ...stats, audio, sampleRate: SAMPLE_RATE };
  }

  return { status, install, remove, load, unload, speak, sample, get manifest() { return manifest; } };
}
