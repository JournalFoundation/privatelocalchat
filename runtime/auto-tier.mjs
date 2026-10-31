// Which on-device model should this device use, without asking anyone? Phones and tablets get the small model; a capable desktop gets
// the larger one. A model that is already downloaded, or one the person chose, always wins. null means no model can run here.

const MOBILE = /iPhone|iPad|iPod|Android/;
export const isMobileDevice = (userAgent = "", maxTouchPoints = 0) => MOBILE.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

const IOS = /iPhone|iPad|iPod/;

/**
 * Can the small model run on the processor (WebAssembly) instead of a graphics card? Same model, same files: only where the maths happens
 * changes, so it is slower. Not offered on iPhone and iPad, where the browser kills a page that holds that much memory (docs/IPHONE-INVESTIGATION.md),
 * nor where WebAssembly SIMD is missing or the device reports under 4 GB.
 */
export function cpuBackendSupport({ env, userAgent = "", maxTouchPoints = 0 }) {
  const wasm = env?.wasm;
  if (!wasm?.available) return { ok: false, reason: "no-wasm" };
  if (wasm.simd === false) return { ok: false, reason: "no-simd" };
  if (IOS.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return { ok: false, reason: "ios-memory-limit" };
  if (env.deviceMemoryGB != null && env.deviceMemoryGB < 4) return { ok: false, reason: "low-memory" };
  return { ok: true, reason: "cpu" };
}

/** Can the graphics card run the small (2B) model? It needs a real GPU with 16-bit shaders. */
export const gpuRunsLight = (env) => Boolean(env?.webgpu?.available && !env.webgpu.isFallbackAdapter && env.webgpu.shaderF16);

/** Where the small model runs on this device: "gpu" when it can, else "cpu" when that is possible, else "gpu" (the load will say what is missing). */
export function lightBackend({ env, userAgent = "", maxTouchPoints = 0 }) {
  if (gpuRunsLight(env)) return "gpu";
  return cpuBackendSupport({ env, userAgent, maxTouchPoints }).ok ? "cpu" : "gpu";
}

export function pickTier({ env, installed = {}, selection = {}, userAgent = "", maxTouchPoints = 0 }) {
  const gpu = env?.webgpu || {};
  const cpu = cpuBackendSupport({ env, userAgent, maxTouchPoints }).ok;
  // no usable graphics card: the small model on the processor, if the device can
  if (!gpu.available || gpu.isFallbackAdapter) return cpu ? { tier: "light", backend: "cpu", reason: "no-gpu-cpu" } : { tier: null, reason: "no-gpu" };
  const supports = { light: Boolean(gpu.shaderF16), default: true }; // the larger model has a build that works without 16-bit shaders
  const mobile = isMobileDevice(userAgent, maxTouchPoints);
  const roomForLarge = !mobile && (env.deviceMemoryGB == null || env.deviceMemoryGB >= 8);
  const ok = (t) => supports[t] && (t !== "default" || roomForLarge || installed.default || selection.chosenBy === "human");
  const withBackend = (t, reason) => (t === "light" && !supports.light ? { tier: t, backend: "cpu", reason } : { tier: t, reason });
  if (selection.chosenBy === "human" && selection.tier && (ok(selection.tier) || (selection.tier === "light" && cpu))) return withBackend(selection.tier, "chosen");
  const have = ["light", "default"].filter((t) => installed[t] && (ok(t) || (t === "light" && cpu)));
  if (have.length) { const t = have.includes(selection.tier) ? selection.tier : have[0]; return withBackend(t, "installed"); }
  if (roomForLarge && supports.default) return { tier: "default", reason: "desktop" };
  if (supports.light) return { tier: "light", reason: mobile ? "mobile" : "small-device" };
  if (cpu) return { tier: "light", backend: "cpu", reason: "no-f16-cpu" };
  return { tier: null, reason: "no-f16-and-no-room" };
}
