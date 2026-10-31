// Which on-device model should this device use, without asking anyone? Phones and tablets get the small model; a capable desktop gets
// the larger one. A model that is already downloaded, or one the person chose, always wins. null means no model can run here.

const MOBILE = /iPhone|iPad|iPod|Android/;
export const isMobileDevice = (userAgent = "", maxTouchPoints = 0) => MOBILE.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

export function pickTier({ env, installed = {}, selection = {}, userAgent = "", maxTouchPoints = 0 }) {
  const gpu = env?.webgpu || {};
  if (!gpu.available || gpu.isFallbackAdapter) return { tier: null, reason: "no-gpu" };
  const supports = { light: Boolean(gpu.shaderF16), default: true }; // the larger model has a build that works without 16-bit shaders
  const mobile = isMobileDevice(userAgent, maxTouchPoints);
  const roomForLarge = !mobile && (env.deviceMemoryGB == null || env.deviceMemoryGB >= 8);
  const ok = (t) => supports[t] && (t !== "default" || roomForLarge || installed.default || selection.chosenBy === "human");
  if (selection.chosenBy === "human" && selection.tier && ok(selection.tier)) return { tier: selection.tier, reason: "chosen" };
  const have = ["light", "default"].filter((t) => installed[t] && ok(t));
  if (have.length) return { tier: have.includes(selection.tier) ? selection.tier : have[0], reason: "installed" };
  if (roomForLarge && supports.default) return { tier: "default", reason: "desktop" };
  if (supports.light) return { tier: "light", reason: mobile ? "mobile" : "small-device" };
  return { tier: null, reason: "no-f16-and-no-room" };
}
