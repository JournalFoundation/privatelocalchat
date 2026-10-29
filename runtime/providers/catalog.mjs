// The model catalogue: two tiers, their official sources, licences, sizes and the exact files each one is made of.
// Decision row 65 (plan/DECISIONS.md): default = WebLLM + Qwen3.5-9B (q4f16_1 where the GPU has shader-f16, q4f32_1 where it does not,
// chosen by the capability probe, not by device class); light = wllama retained-v1q + Qwen3.5-2B Q4_0. No other model is offered.
//
// Sources are the model's official hosts (see MODELS.md). A deployment or test may point a tier at another origin with
// `resolveSources(overrides)`: that is an explicit, visible setting (the manager shows "source: override <origin>"), never a fallback.
import { CATALOG_DATA } from "./catalog-data.mjs";

const MiB = 1 << 20;
const W = CATALOG_DATA.webllmQwen35_9b;
const L = CATALOG_DATA.wllamaQwen35_2b;

/** The WebLLM builds of the default model. f16 is preferred; f32 exists for GPUs without shader-f16. */
export const WEBLLM_VARIANTS = Object.freeze(["q4f16_1", "q4f32_1"]);
export const DEFAULT_VARIANT = "q4f16_1";

export const OFFICIAL_SOURCES = Object.freeze({
  // HuggingFace pinned commits (immutable), one per build; every LFS sha256 is in catalog-data.mjs
  webllmModelBase: Object.freeze(Object.fromEntries(WEBLLM_VARIANTS.map((v) => [v, `https://huggingface.co/${W[v].repo}/resolve/${W[v].commit}/`]))),
  // binary-mlc-llm-libs (Apache-2.0) tracks the WebLLM release; each file is checked against the sha256 pinned here
  webllmLibBase: Object.freeze(Object.fromEntries(WEBLLM_VARIANTS.map((v) => [v, "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_86/base/"]))),
  // the owner's immutable manifest-addressed repackaging of Qwen/Qwen3.5-2B (Apache-2.0) as Q4_0 GGUF shards
  wllamaModelBase: L.baseUrl
});

const f16Bytes = W.q4f16_1.files.reduce((n, f) => n + f.bytes, 0) + W.q4f16_1.lib.bytes;
const f32Bytes = W.q4f32_1.files.reduce((n, f) => n + f.bytes, 0) + W.q4f32_1.lib.bytes;

export const VARIANT_INFO = Object.freeze({
  q4f16_1: Object.freeze({ variant: "q4f16_1", modelId: "Qwen3.5-9B-q4f16_1-MLC", quantization: "q4f16_1", needsF16: true, downloadBytes: f16Bytes, memory: { steadyBytes: 6.4e9, peakBytes: 9.0e9, note: "WebLLM's own vram_required_MB 6433 for this build; steady and peak here are estimates until measured on the Mac" } }),
  q4f32_1: Object.freeze({ variant: "q4f32_1", modelId: "Qwen3.5-9B-q4f32_1-MLC", quantization: "q4f32_1", needsF16: false, downloadBytes: f32Bytes, memory: { steadyBytes: 7.5e9, peakBytes: 10.5e9, note: "WebLLM's own vram_required_MB 7545 for this build; steady and peak here are estimates until measured on the Mac" } })
});

export const TIERS = Object.freeze({
  default: Object.freeze({
    tier: "default", label: "Qwen3.5-9B (quality)", engine: "webllm", adapter: "webllm",
    modelId: VARIANT_INFO[DEFAULT_VARIANT].modelId, family: "Qwen3.5", paramsB: 9, quantization: DEFAULT_VARIANT,
    license: "Apache-2.0", licenseNote: "Base model Qwen/Qwen3.5-9B (Apache-2.0). The MLC repack's own card carries no licence field.",
    runtime: { name: "web-llm", version: "0.2.86", license: "Apache-2.0" },
    contextWindowTokens: 4096, maxOutputTokens: 1024,
    structured: { "json-schema": "grammar" },
    downloadBytes: VARIANT_INFO[DEFAULT_VARIANT].downloadBytes,
    memory: VARIANT_INFO[DEFAULT_VARIANT].memory,
    speed: { decodeTokPerSec: "not yet measured", bodyStepSeconds: "not yet measured", chatTurnFirstTokenSeconds: "not yet measured", loadSecondsWarm: "not yet measured" },
    strengths: "The owner's default (DECISIONS 65). It thinks by default; the app turns thinking off for ordinary replies. Judge its behaviour by reading it.",
    cacheKind: "Cache API (webllm/model, webllm/config, webllm/wasm)"
  }),
  light: Object.freeze({
    tier: "light", label: "Qwen3.5-2B (light)", engine: "wllama", adapter: "wllama",
    modelId: "qwen3.5-2b-q4_0", family: "Qwen3.5", paramsB: 2.0, quantization: "Q4_0",
    license: "Apache-2.0", licenseNote: "Qwen/Qwen3.5-2B (Apache-2.0), quantised by the owner's pinned toolchain.",
    runtime: { name: "wllama", version: "3.5.1 retained-v1q-chat-stable-slim-20260901", license: "owner build of llama.cpp (MIT) via wllama (MIT)" },
    contextWindowTokens: 4096, maxOutputTokens: 1024,
    structured: { "json-schema": "validated" },
    downloadBytes: L.totalBytes,
    memory: { steadyBytes: 2.3e9, peakBytes: 2.8e9, note: "about 2.3 GB resident (measured)" },
    speed: { decodeTokPerSec: "about 30", bodyStepSeconds: "about 4.4", chatTurnFirstTokenSeconds: "about 1.7", loadSecondsWarm: 5 },
    strengths: "Small and quick to load. Cautions: it is NOT grammar constrained (the reply is checked after it is written and a bad one fails the attempt), it picked an offer in every one of 10 'nothing fits' trials, and its prose is weaker.",
    cacheKind: "OPFS (wllama cache directory)"
  })
});

export const TIER_ORDER = Object.freeze(["default", "light"]);

/** The build of the default model for a GPU: f16 where shader-f16 exists, else f32. Capability decides (DEC 57). null: no WebGPU. */
export function chooseWebllmVariant(env) {
  if (!env?.webgpu?.available) return null;
  return env.webgpu.shaderF16 ? "q4f16_1" : "q4f32_1";
}

const perVariant = (v) => (typeof v === "string" ? Object.fromEntries(WEBLLM_VARIANTS.map((q) => [q, v.endsWith("/") ? v : v + "/"])) : Object.fromEntries(WEBLLM_VARIANTS.map((q) => [q, v[q] ? (v[q].endsWith("/") ? v[q] : v[q] + "/") : OFFICIAL_SOURCES.webllmModelBase[q]])));

/** Merge explicit overrides over the official sources. Returns { sources, label } where label is shown to the human.
 *  webllmModelBase / webllmLibBase may be a string (the same URL for both builds; valid only if that place serves the build in use)
 *  or { q4f16_1, q4f32_1 }. */
export function resolveSources(overrides = null) {
  if (!overrides) return { sources: { ...OFFICIAL_SOURCES }, label: "official hosts", overridden: false };
  const sources = { ...OFFICIAL_SOURCES };
  if (overrides.webllmModelBase) sources.webllmModelBase = perVariant(overrides.webllmModelBase);
  if (overrides.webllmLibBase) sources.webllmLibBase = perVariant(overrides.webllmLibBase);
  if (overrides.wllamaModelBase) sources.wllamaModelBase = overrides.wllamaModelBase.endsWith("/") ? overrides.wllamaModelBase : overrides.wllamaModelBase + "/";
  // WebLLM rewrites a model URL that lacks /resolve/<rev>/ by appending resolve/main/, which would silently miss every cached file
  for (const v of WEBLLM_VARIANTS) if (!/.+\/resolve\/.+\//.test(sources.webllmModelBase[v])) throw new RangeError(`webllmModelBase.${v} must contain /resolve/<revision>/ (WebLLM would rewrite it otherwise): ${sources.webllmModelBase[v]}`);
  const flat = [...Object.values(sources.webllmModelBase), ...Object.values(sources.webllmLibBase), sources.wllamaModelBase];
  const origins = [...new Set(flat.map((u) => { try { return new URL(u).origin; } catch { return String(u); } }).filter((o) => o !== "https://huggingface.co" && o !== "https://raw.githubusercontent.com" && o !== new URL(L.baseUrl).origin))];
  return { sources, label: "OVERRIDE: " + origins.join(", "), overridden: true };
}

/** The files that make up a tier (for the default tier, one build of it), with the URL each is fetched from, the cache scope and expected size/hash. */
export function tierFiles(tier, sources = OFFICIAL_SOURCES, variant = DEFAULT_VARIANT) {
  if (tier === "default") {
    const V = W[variant]; if (!V) throw new RangeError(`unknown WebLLM build ${variant}`);
    const files = V.files.map((f) => ({
      path: f.path, bytes: f.bytes, sha256: f.sha256, url: sources.webllmModelBase[variant] + f.path,
      scope: f.path === "mlc-chat-config.json" ? "webllm/config" : "webllm/model"
    }));
    files.push({ path: V.lib.path, bytes: V.lib.bytes, sha256: V.lib.sha256, url: sources.webllmLibBase[variant] + V.lib.path, scope: "webllm/wasm" });
    return files;
  }
  if (tier === "light") return L.files.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256, url: sources.wllamaModelBase + f.path, scope: "opfs" }));
  throw new RangeError(`unknown tier ${tier}`);
}

/** The `load` config the host Worker's adapters take. `runtimeDir` is where the app serves the vendored wllama build (same origin). */
export function loadConfigFor(tier, { sources = OFFICIAL_SOURCES, runtimeDir = null, variant = DEFAULT_VARIANT } = {}) {
  const t = TIERS[tier];
  if (!t) throw new RangeError(`unknown tier ${tier}`);
  if (tier === "default") {
    const vi = VARIANT_INFO[variant]; if (!vi) throw new RangeError(`unknown WebLLM build ${variant}`);
    return {
      adapter: "webllm", tier, variant, modelId: vi.modelId, modelBase: sources.webllmModelBase[variant], modelLib: sources.webllmLibBase[variant] + W[variant].lib.path,
      contextWindow: t.contextWindowTokens, quantization: vi.quantization, license: t.license, files: tierFiles("default", sources, variant)
    };
  }
  const files = tierFiles("light", sources);
  return {
    adapter: "wllama", tier, modelId: t.modelId, modelUrl: files[0].url, quantization: t.quantization, license: t.license, files,
    runtime: { dir: runtimeDir, buildId: "retained-v1q-chat-stable-slim-20260901", cls: "compat" },
    context: {
      n_ctx: t.contextWindowTokens, n_batch: 512, n_ubatch: 512, flash_attn_policy: -1, fused_gdn_auto: true, fused_gdn_ar: true, fused_gdn_ch: true,
      sched_max_splits_hint: 128, ctx_checkpoints: 1, checkpoint_every_n_tokens: 64, checkpoint_clear_policy: "replace-on-reset-and-terminate"
    },
    knobs: { initialMemoryMiB: 128, offloadTiedEmbedding: true, progressiveSourceRelease: true, recycleWindowBytes: 96 * MiB }
  };
}
