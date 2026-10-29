// wllama (llama.cpp compiled to WebAssembly + WebGPU) adapter, OPFS storage operations, for the light tier (Qwen3.5-2B Q4_0).
// Provenance: productionised from spikes/llm/provider/adapters/wllama.js (FAB-02). Runtime: the owner's vendored wllama.js and wasm
// build retained-v1q-chat-stable-slim-20260901 (../vendor/wllama/v1q/, copied from spikes/llm/vendor/wllama/v1q/; origin
// /srv/speechtest-recovered commit 3f8549ce7b6c08dd453a05be374d12afcbba73e0, one patch: absoluteUrl() works inside a Worker).
//
// Production changes: the adapter never downloads (storageOps.install does, visibly and with size + SHA-256 checks against the owner's
// immutable manifest); load() refuses with not-installed / cache-corrupt; no grammar exists in this build, so a structured request is
// ANSWERED BY VALIDATION: the host checks the finished text against the schema and a miss is attempt-failed (output-invalid), never repaired.
// The adapter does not rewrite the mind's prompt: the mind must put the schema instruction in the prompt itself.
import { compareInventory, planInstall, createRateTracker, hex } from "../verify.mjs";
export { preflight } from "./webgpu.mjs";

const wllamaCache = new Map(); // runtime dir -> Wllama (used only for its cache manager in storage ops)

async function openRuntime(runtimeDir) {
  const base = new URL(runtimeDir.endsWith("/") ? runtimeDir : runtimeDir + "/", self.location.href).href;
  const { Wllama } = await import(/* @vite-ignore */ base + "wllama.js");
  return { base, Wllama };
}

async function cacheManagerFor(runtimeDir) {
  let w = wllamaCache.get(runtimeDir);
  if (!w) {
    const { base, Wllama } = await openRuntime(runtimeDir);
    w = new Wllama({ default: base + "default.wasm", "single-thread/wllama.wasm": base + "default.wasm" }, { useMultiThread: false, allowOffline: true, logger: { debug() {}, log() {}, warn() {}, error() {} } });
    wllamaCache.set(runtimeDir, w);
  }
  return w.cacheManager;
}

async function measure(cm, files) {
  const list = await cm.list(); const actual = new Map(); const noMeta = [];
  for (const f of files) {
    const name = await cm.getNameFromURL(f.url);
    const entry = list.find((e) => e.name === name);
    if (!entry) continue;
    const m = entry.metadata;
    // an interrupted download leaves bytes without metadata (metadata is written last): never a usable file
    if (!m?.originalURL || m.originalSize !== entry.size) { actual.set(f.path, -1); noMeta.push(f.path); continue; }
    actual.set(f.path, entry.size);
  }
  return { actual, noMeta };
}

async function inspect({ files, runtimeDir }) {
  const t0 = performance.now(); const cm = await cacheManagerFor(runtimeDir);
  const { actual, noMeta } = await measure(cm, files);
  const inv = compareInventory(files, actual);
  return { ...inv, partialNoMetadata: noMeta, ms: Math.round(performance.now() - t0), engine: "wllama", where: "OPFS (wllama cache)" };
}

async function sha256OfBlob(blob) { return hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())); }

async function verify({ files, runtimeDir, deep = false }, hooks = {}) {
  const inv = await inspect({ files, runtimeDir });
  if (!deep) return { ...inv, deep: false, hashMismatch: [] };
  const cm = await cacheManagerFor(runtimeDir); const hashMismatch = []; let done = 0;
  for (const f of files) {
    if (hooks.signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    if (inv.missing.includes(f.path) || inv.bad.some((b) => b.path === f.path)) continue;
    const blob = await cm.open(f.url); if (!blob) { hashMismatch.push({ path: f.path, why: "unreadable" }); continue; }
    const got = await sha256OfBlob(blob);
    if (f.sha256 && got !== f.sha256) hashMismatch.push({ path: f.path, want: f.sha256, got, why: "sha256" });
    hooks.onProgress?.({ phase: "hash", filesDone: ++done, filesTotal: files.length });
  }
  const state = hashMismatch.length ? "corrupt" : inv.state;
  return { ...inv, state, ok: state === "complete", deep: true, hashMismatch, bad: [...inv.bad, ...hashMismatch] };
}

async function removeFiles({ files, runtimeDir, paths = null }) {
  const cm = await cacheManagerFor(runtimeDir); let removed = 0;
  for (const f of files) { if (paths && !paths.includes(f.path)) continue; await cm.delete(f.url); removed++; }
  return { removed, requested: removed };
}

async function install({ files, runtimeDir, verifyHash = true, deep = false }, { onProgress, signal } = {}) {
  const cm = await cacheManagerFor(runtimeDir);
  const inv = deep ? await verify({ files, runtimeDir, deep: true }, { signal }) : await inspect({ files, runtimeDir });
  const plan = planInstall(files, inv);
  const total = files.reduce((n, f) => n + f.bytes, 0);
  const rate = createRateTracker({ windowMs: 6000 });
  // files with partial bytes but no metadata are not in inv.bad (they were reported as -1 => wrongSize => bad); delete them first, loudly
  for (const p of plan.deleteFirst) { const f = files.find((x) => x.path === p); await cm.delete(f.url); }
  for (const f of plan.todo) { const name = await cm.getNameFromURL(f.url); await cm.delete(name).catch(() => {}); } // an orphan without metadata
  let fetched = 0; let filesDone = files.length - plan.todo.length;
  const report = (active) => { const t = performance.now(); rate.add(fetched, t); onProgress?.({ phase: "install", bytesDone: plan.bytesKept + fetched, bytesKept: plan.bytesKept, bytesTotal: total, filesDone, filesTotal: files.length, active: active ? [active] : [], bytesPerSecond: rate.bytesPerSecond(), etaSeconds: rate.etaSeconds(plan.bytesToFetch - fetched) }); };
  report(null);
  for (const f of plan.todo) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    let mine = 0; let lastT = 0;
    try {
      await cm.download(f.url, { signal, progressCallback: ({ loaded }) => { fetched += loaded - mine; mine = loaded; const t = performance.now(); if (t - lastT > 400) { lastT = t; report(f.path); } } });
      const m = await cm.getMetadata(await cm.getNameFromURL(f.url));
      const size = await cm.getSize(await cm.getNameFromURL(f.url));
      if (size !== f.bytes || (m && m.originalSize && m.originalSize !== f.bytes)) throw Object.assign(new Error(`download size mismatch for ${f.path}: stored ${size} bytes, the catalogue says ${f.bytes}`), { code: "cache-corrupt" });
      if (verifyHash && f.sha256) {
        const blob = await cm.open(f.url);
        const got = blob ? await sha256OfBlob(blob) : "unreadable";
        if (got !== f.sha256) throw Object.assign(new Error(`checksum mismatch for ${f.path}: sha256 ${got}, the catalogue says ${f.sha256}`), { code: "cache-corrupt" });
      }
    } catch (e) {
      fetched -= mine;
      await cm.delete(f.url).catch(() => {}); // leave nothing half-written behind
      throw e;
    }
    filesDone++; report(null);
  }
  const after = await inspect({ files, runtimeDir });
  if (!after.ok) throw Object.assign(new Error(`cache-incomplete after install: ${after.missing.length} missing, ${after.bad.length} bad`), { code: "cache-corrupt", detail: { missing: after.missing.slice(0, 20), bad: after.bad.slice(0, 20) } });
  return { ...after, fetchedBytes: fetched, keptBytes: plan.bytesKept, replaced: plan.deleteFirst, filesFetched: plan.todo.length };
}

export const storageOps = { inspect, verify, install, remove: removeFiles, repair: (args, hooks) => install({ ...args, deep: true }, hooks) };

export class WllamaAdapter {
  constructor() { this.w = null; this.info = null; this.cfg = null; }

  async load(config, { onProgress }) {
    const cfg = this.cfg = config;
    const rt = cfg.runtime;
    if (!Array.isArray(cfg.files) || cfg.files.length === 0) throw Object.assign(new Error("wllama load config needs the catalogue file list (config.files)"), { name: "ConfigError" });
    // 1) the OPFS cache must hold exactly the catalogue
    const tr = performance.now();
    const inv = await inspect({ files: cfg.files, runtimeDir: rt.dir });
    const cacheCheckMs = Math.round(performance.now() - tr);
    if (!inv.ok) {
      const what = inv.state === "corrupt"
        ? `cache-corrupt: ${inv.bad.length} model file(s) in the browser cache do not match the catalogue (${inv.bad.slice(0, 4).map((b) => `${b.path} is ${b.got} bytes, expected ${b.want}`).join("; ")})`
        : `not-installed: ${inv.missing.length} of ${inv.files} model files are not in the browser cache`;
      throw Object.assign(new Error(what), { name: "ModelCacheError", detail: { state: inv.state, missing: inv.missing.slice(0, 20), bad: inv.bad.slice(0, 20) } });
    }
    const { base, Wllama } = await openRuntime(rt.dir);
    const compatRes = await fetch(base + "compat-worker.js", { cache: "force-cache", credentials: "omit" });
    if (!compatRes.ok) throw new Error(`compat-worker-http-${compatRes.status}`);
    const compatCode = await compatRes.text();
    this.nativeLines = [];
    const quiet = { debug: (...a) => this._native(a), log: (...a) => this._native(a), warn: (...a) => this._native(a), error: (...a) => this._native(a) };
    this.w = new Wllama({ default: base + "default.wasm", "single-thread/wllama.wasm": base + "default.wasm" }, {
      useMultiThread: false, parallelDownloads: 1, allowOffline: true, expectedBuildId: rt.buildId, forceCompat: rt.cls === "compat", logger: quiet
    });
    this.w.setCompat({ wasm: base + "compat.wasm", worker: { code: compatCode } }, "firefox_safari");
    const res = this.w.getWorkerResources();
    if ((rt.cls === "compat") !== (res.compat === true)) throw new Error(`runtime class mismatch: wanted ${rt.cls}, got compat=${res.compat}`);
    const k = cfg.knobs || {};
    if (k.initialMemoryMiB) this.w.setFlightKnobs?.({ initialMemoryMiB: k.initialMemoryMiB });
    if (k.offloadTiedEmbedding) this.w.enableTiedEmbeddingOffload?.({ schemaField: true });
    if (k.progressiveSourceRelease) this.w.enableProgressiveSourceRelease?.({ recycleWindowBytes: k.recycleWindowBytes || 0 });

    const url = new URL(cfg.modelUrl, self.location.href).href;
    const timings = { cacheCheckMs };
    const models = await this.w.modelManager.getModels();
    const model = models.find((m) => m.url === url);
    if (!model) throw Object.assign(new Error("not-installed: wllama's own model list does not contain the verified files (run Repair)"), { name: "ModelCacheError" });
    timings.stagedFrom = "cache"; timings.stagedBytes = model.size;

    const c = cfg.context || {};
    const tCons0 = performance.now();
    onProgress?.({ phase: "construct-begin" });
    try { await this.w.loadModelFromUrl(url, {
      n_ctx: c.n_ctx ?? 4096, n_batch: c.n_batch, n_ubatch: c.n_ubatch, n_threads: 1, n_parallel: 1,
      cache_type_k: c.cache_type_k ?? "f16", cache_type_v: c.cache_type_v ?? "f16",
      flash_attn_policy: c.flash_attn_policy, fused_gdn_auto: c.fused_gdn_auto, fused_gdn_ar: c.fused_gdn_ar, fused_gdn_ch: c.fused_gdn_ch,
      sched_max_splits_hint: c.sched_max_splits_hint, ctx_checkpoints: c.ctx_checkpoints, checkpoint_every_n_tokens: c.checkpoint_every_n_tokens, checkpoint_clear_policy: c.checkpoint_clear_policy, jinja: c.jinja ?? true, reasoning: false, reasoning_budget_tokens: 0, n_gpu_layers: -1,
      no_kv_offload: false, cache_idle_slots: false, warmup: c.warmup ?? false, useCache: true, parallelDownloads: 1,
      progressCallback: () => {}
    });
    } catch (error) {
      error.detail = {...error.detail, nativeLog: this.nativeLines.slice(-30)};
      error.message += ' ' + this.nativeLines.slice(-4).join(' | ');
      throw error;
    }
    timings.constructMs = Math.round(performance.now() - tCons0);
    if (k.progressiveSourceRelease) { try { this.w.releaseModelSource?.(); } catch (e) { this._native([`releaseModelSource failed: ${e?.message || e}`]); } }

    const ctx = this.w.getLoadedContextInfo();
    const meta = ctx.metadata || {};
    this.info = {
      modelId: cfg.modelId, runtime: `wllama/${rt.buildId}/${rt.cls}`, timings,
      context: { n_ctx: ctx.n_ctx, n_batch: ctx.n_batch, n_ubatch: ctx.n_ubatch, n_vocab: ctx.n_vocab, n_ctx_train: ctx.n_ctx_train },
      gguf: { arch: meta["general.architecture"], name: meta["general.name"], file_type: meta["general.file_type"] },
      capabilities: {
        kind: "local-webgpu", structuredEnforced: [], structuredValidated: ["json-schema", "json-object"], structuredEnforcement: { json_schema: "validated", json_object: "validated" },
        quantization: cfg.quantization || null, license: cfg.license || null, runtimeName: "wllama", runtimeVersion: rt.buildId,
        contextWindowTokens: ctx.n_ctx, maxOutputTokens: 1024
      }
    };
    this.info.runtimeMemory = await this._mem();
    return this.info;
  }

  _native(args) { const t = args.map(String).join(" ").slice(0, 300); this.nativeLines.push(t); if (this.nativeLines.length > 400) this.nativeLines.shift(); }
  async _mem() { try { return await this.w.getRuntimeMemory(); } catch (e) { return { error: String(e?.message || e) }; } }

  async run(req, signal, emit) {
    const s = req.sampling || {};
    const params = {
      messages: req.messages, stream: true, abortSignal: signal, cache_prompt: req.cachePrompt !== false,
      max_tokens: req.maxTokens, temperature: s.temperature ?? 0, top_p: s.topP ?? 1, top_k: s.topK ?? (s.temperature ? 40 : 1), seed: s.seed ?? 1,
      chat_template_kwargs: { enable_thinking: req.thinking === true }
    };
    if (s.repetitionPenalty) params.repeat_penalty = s.repetitionPenalty;
    if (req.stop?.length) params.stop = req.stop;
    const gen = await this.w.createChatCompletion(params);
    let usage = null; let finish = null; let timings = null;
    // the runtime's iterator is a down-levelled hand-written one; consumed with next() like every other token path here
    const it = gen[Symbol.asyncIterator]();
    for (;;) {
      const { value: chunk, done } = await it.next();
      if (done) break;
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta?.content ?? choice?.text ?? "";
      if (delta) emit({ delta });
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk?.usage) usage = chunk.usage;
      if (chunk?.timings) timings = chunk.timings;
    }
    emit({
      usage: {
        promptTokens: usage?.prompt_tokens ?? null, completionTokens: usage?.completion_tokens ?? null,
        cachedPromptTokens: usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_tokens_reused ?? null,
        engineTimings: timings || null, ...this._diagUsage()
      },
      finish: finish === "length" ? "length" : "stop"
    });
  }

  _diagUsage() {
    const d = this.w?.getLastGenerationDiagnostics?.();
    if (!d?.usage) return {};
    return { promptTokens: d.usage.promptTokens, cachedPromptTokens: d.usage.reusedTokens, completionTokens: d.usage.completionTokens, nativeTiming: d.timing || null };
  }

  async stats() {
    return { runtimeMemory: await this._mem(), lastGenerationDiagnostics: this.w?.getLastGenerationDiagnostics?.() ?? null, nativeLinesSample: this.nativeLines?.slice(-40) ?? [], info: this.info };
  }

  async unload() {
    try { await this.w?.exit(); } finally { this.w = null; }
  }
}
