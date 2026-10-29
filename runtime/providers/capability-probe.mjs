// Startup capability probe (owner decision row 57: capability decides, no phone/desktop classes).
// Pure ladder logic with injected probes, so every rung can be shown in Node by forcing results. Output is ONE profile object:
//   { format, at, env, ladders: { main, embedder, reranker }, concurrency, geometry, chosen, reasons[], timingsMs, humanChoice }
// Rules: a rung is used only if it REALLY works (an attempt that returns); a failed or timed-out attempt is recorded with its raw
// message and the next smaller rung is tried; the probe never runs after startup on its own. Failures after startup are not
// downgrades: they are loud errors with recovery (model-host.mjs). The user may re-probe, and may move UP only by explicit action.

export const PROFILE_FORMAT = "cfp-capability-profile/1";

/** Read what the browser says about itself. `nav` is injectable. Every field states "unavailable" rather than guessing. */
export async function gatherEnv(nav = globalThis.navigator) {
  const env = { webgpu: { available: false }, deviceMemoryGB: nav?.deviceMemory ?? null, storage: null, userAgentMemory: "unavailable", crossOriginIsolated: !!globalThis.crossOriginIsolated };
  try {
    if (!nav?.gpu) env.webgpu.reason = "navigator.gpu is undefined";
    else {
      const a = await nav.gpu.requestAdapter();
      if (!a) env.webgpu.reason = "requestAdapter() returned no adapter";
      else env.webgpu = { available: true, shaderF16: a.features?.has?.("shader-f16") ?? false, maxBufferSize: a.limits?.maxBufferSize ?? null, maxStorageBufferBindingSize: a.limits?.maxStorageBufferBindingSize ?? null };
    }
  } catch (e) { env.webgpu = { available: false, reason: `requestAdapter threw: ${e?.message || e}` }; }
  try { const e = await nav?.storage?.estimate?.(); env.storage = e ? { usage: e.usage ?? null, quota: e.quota ?? null } : null; } catch (e) { env.storage = { error: String(e?.message || e) }; }
  if (typeof globalThis.performance?.measureUserAgentSpecificMemory === "function") {
    env.userAgentMemory = "measurement pending";
    const reading = performance.measureUserAgentSpecificMemory().then(result => { env.userAgentMemory = result.bytes; }, error => { env.userAgentMemory = `refused: ${error?.message || error}`; });
    // This optional observation may wait for a browser GC cycle. It must not block model controls.
    await Promise.race([reading, new Promise(resolve => setTimeout(resolve, 1000))]);
  }
  return env;
}

const withTimeout = (p, ms, label) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Object.assign(new Error(`probe timeout after ${ms} ms (${label})`), { code: "probe-timeout" })), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/** Why a rung is skipped without being attempted (requirements known before trying). Returns a string or null. */
export function skipReason(rung, env) {
  if (rung.requiresWebGPU !== false && !env.webgpu.available) return `WebGPU unavailable (${env.webgpu.reason})`;
  if (rung.needsF16 && !env.webgpu.shaderF16) return "shader-f16 not supported by this GPU adapter";
  if (rung.downloadBytes && env.storage?.quota != null && env.storage.quota - (env.storage.usage ?? 0) < rung.downloadBytes && !rung.installed) return `storage quota too small for the ${rung.downloadBytes}-byte download`;
  if (rung.peakBytes && env.deviceMemoryGB != null && env.deviceMemoryGB * 1e9 < rung.peakBytes) return `navigator.deviceMemory reports ${env.deviceMemoryGB} GB, below the ${(rung.peakBytes / 1e9).toFixed(1)} GB peak this rung needs (a hint only; Safari does not expose it)`;
  if (rung.notCatalogued) return "not catalogued: no pinned files exist for this rung yet";
  return null;
}

async function ladder(name, rungs, env, attempt, { timeoutMs, startAt = 0, now }) {
  const out = { name, tried: [], chosen: null };
  for (let i = startAt; i < rungs.length; i++) {
    const r = rungs[i]; const skip = skipReason(r, env);
    if (skip) { out.tried.push({ id: r.id, outcome: "skipped", reason: skip }); continue; }
    const t0 = now();
    try {
      const detail = await withTimeout(attempt(name, r), r.timeoutMs ?? timeoutMs, r.id);
      out.tried.push({ id: r.id, outcome: "succeeded", ms: Math.round(now() - t0), detail: detail ?? null });
      out.chosen = r.id; return out;
    } catch (e) {
      out.tried.push({ id: r.id, outcome: e?.code === "probe-timeout" ? "timed-out" : "failed", ms: Math.round(now() - t0), message: String(e?.message || e), class: e?.class ?? null });
    }
  }
  return out;
}

/**
 * ladders: { main: [rung], embedder: [rung], reranker: [rung] }  rung = { id, tier?, needsF16?, peakBytes?, downloadBytes?, installed?, notCatalogued?, timeoutMs? }
 * attempt(ladderName, rung) -> Promise: really loads it (and leaves it loaded if it is the chosen main rung). Throws on failure.
 * humanChoice: rung id the user chose explicitly; the main ladder STARTS there and never climbs above it on its own.
 */
export async function runProbe({ ladders, attempt, env = null, humanChoice = null, timeoutMs = 120000, now = () => performance.now(), concurrencyFor = defaultConcurrency, geometryFor = defaultGeometry, modelSource = null, nav }) {
  const t0 = now(); const e = env ?? await gatherEnv(nav);
  const timings = { env: Math.round(now() - t0) };
  const startAt = humanChoice ? Math.max(0, ladders.main.findIndex((r) => r.id === humanChoice)) : 0;
  const result = { format: PROFILE_FORMAT, at: Date.now(), env: e, ladders: {}, humanChoice, reasons: [], timingsMs: timings };
  for (const name of ["main", "embedder", "reranker"]) {
    if (!ladders[name]) continue;
    const s = now(); result.ladders[name] = await ladder(name, ladders[name], e, attempt, { timeoutMs, startAt: name === "main" ? startAt : 0, now }); timings[name] = Math.round(now() - s);
  }
  const main = result.ladders.main; const emb = result.ladders.embedder;
  result.chosen = { main: main?.chosen ?? null, embedder: emb?.chosen ?? null, reranker: result.ladders.reranker?.chosen ?? null };
  if (!result.chosen.main) result.reasons.push("NO main model could be loaded: " + (main?.tried ?? []).map((t) => `${t.id}: ${t.reason || t.message}`).join("; "));
  else if (main.tried.some((t) => t.outcome !== "succeeded")) result.reasons.push("main model is below the top rung because: " + main.tried.filter((t) => t.outcome !== "succeeded").map((t) => `${t.id} ${t.outcome} (${t.reason || t.message})`).join("; "));
  if (humanChoice && startAt > 0) result.reasons.push(`ladder started at ${humanChoice} because the user chose it; moving up needs an explicit action`);
  // keyword-only is allowed ONLY where the embedder genuinely cannot load, and the profile says why
  result.embedderMode = result.chosen.embedder ? "embedder" : emb ? "keyword-only" : "not-tried"; // (no ladder supplied: the embedder was never attempted, which says nothing about whether it can load)
  if (!result.chosen.embedder) result.reasons.push(emb ? "keyword-only retrieval: no embedder rung loaded: " + emb.tried.map((t) => `${t.id}: ${t.reason || t.message}`).join("; ") : "the embedder was not tried: no embedder ladder was supplied to this probe, so nothing is known about whether it can load");
  // Model source (mirror vs official hosts) is chosen at startup by the app (public/src/runtime/models.js selectModelSource, also exposed as
  // window.__cfpModelSource). It is one of the stated startup selections, recorded here verbatim with its forced/offline-reuse flags.
  result.modelSource = modelSource ?? { chosen: null, reason: "no model-source selection was supplied to the probe" };
  result.reasons.push(`model source: ${result.modelSource.chosen ?? result.modelSource.source ?? "unrecorded"}${result.modelSource.reason ? " (" + result.modelSource.reason + ")" : ""}`);
  result.concurrency = concurrencyFor(e, result.chosen); result.geometry = geometryFor(e, result.chosen);
  result.timingsMs.total = Math.round(now() - t0);
  return result;
}

// Concurrency: serialized until measured otherwise (FAB-07p has no measurement showing a gain; WebLLM serializes requests).
export function defaultConcurrency() { return { level: 1, reason: "single decode stream: concurrent decoding has not been measured to help in Safari" }; }
// Geometry (geo.json + planner) costs memory and load time: on only when the main model really loaded and the GPU adapter is available.
export function defaultGeometry(env, chosen) {
  if (!chosen.main) return { enabled: false, reason: "no main model loaded" };
  if (!env.webgpu.available) return { enabled: false, reason: "WebGPU unavailable" };
  return { enabled: true, reason: "main model loaded and WebGPU available" };
}
