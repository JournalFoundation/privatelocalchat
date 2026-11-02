// Choosing a text-to-speech voice for this device. The system voice is the default and the answer whenever anything is unknown:
// every rule here fails safe (no offer, nothing downloaded). Thresholds are PLACEHOLDERS until they are calibrated on real devices
// (docs/VOICE-ENGINE-PLAN.md, Lane 0 to 5); `calibrated` stays false until then and the offer stays hidden.

export const VOICE_CONFIG = Object.freeze({
  calibrated: false,
  // stage 1 gate (cheap signals)
  minMemoryGB: 4,            // placeholder
  minCores: 4,               // placeholder
  minFreeStorageMB: 600,     // placeholder: free space that must remain after the download
  storageHeadroomFactor: 3,  // free space must be at least this many times the download
  // stage 2 gate (compute probe, milliseconds for the reference loop in chat/voice-probe; lower is faster)
  probeMaxMs: 120,           // placeholder
  // stage 3 (after install): audio seconds produced per second of compute; below this the system voice takes over again
  minRealTimeFactor: 2,      // placeholder
  qualityMinMemoryGB: 8      // placeholder: memory (or unknown on desktop) needed for the larger voice, which also needs a real GPU adapter
});

/** Candidates. `tier` orders them; sizes are the bytes the person would download (model plus voices). */
export const VOICE_ENGINES = Object.freeze({
  kitten: Object.freeze({ id: "kitten", label: "Kitten TTS nano", tier: 1, downloadBytes: 24369971 + 3278902, languages: ["en"] }),
  kokoro: Object.freeze({ id: "kokoro", label: "Kokoro", tier: 2, downloadBytes: 92361116 + 10 * 522240, languages: ["en"] })
});

const IOS = /iPhone|iPad|iPod/;
const MOBILE = /iPhone|iPad|iPod|Android/;
/** iPhone, iPad, and an iPad that reports itself as a Mac. The one platform rule with hard evidence (docs/IPHONE-INVESTIGATION.md). */
export const isIOSDevice = (userAgent = "", maxTouchPoints = 0) => IOS.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
const isMobile = (userAgent, maxTouchPoints) => MOBILE.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

const os = (reason, extra = {}) => ({ engine: "os", offer: false, reason, ...extra });

/**
 * @param {object} a
 * @param {object} a.env              capability probe result: { deviceMemoryGB, cores, webgpu:{available,isFallbackAdapter} }
 * @param {string} a.userAgent
 * @param {number} a.maxTouchPoints
 * @param {{usage:number,quota:number,writeOk?:boolean}|null} a.storage   navigator.storage.estimate() in bytes. Chrome sizes the quota from TOTAL disk,
 *        not free space (a phone with 430 MB free reported a 34 GB quota), so on mobile the estimate is never trusted alone: `writeOk` is the
 *        result of really writing the download size plus a margin to private storage and deleting it again.
 * @param {{ms:number}|null} a.probe  compute probe result; null when it has not run yet
 * @param {string} a.language         BCP-47 language of the chat, e.g. "en" or "en-US"
 * @param {string|null} a.chosen      "os", an engine id, or null when the person has not chosen
 * @param {Record<string,boolean>} a.installed   engine ids whose verified files are on disk
 * @param {number} a.chatModelResidentGB  memory the loaded chat model holds (0 when none is loaded)
 * @param {boolean} a.devOffer        dev flag that shows the offer while thresholds are uncalibrated
 * @param {object} a.config
 */
export function pickVoiceEngine({ env = {}, userAgent = "", maxTouchPoints = 0, storage = null, probe = null, language = "en", chosen = null, installed = {}, chatModelResidentGB = 0, devOffer = false, config = VOICE_CONFIG } = {}) {
  // 1. what the person decided always wins
  if (chosen === "os") return os("user-choice");
  if (chosen && VOICE_ENGINES[chosen] && installed[chosen]) return { engine: chosen, offer: false, reason: "user-choice-installed", loadWhen: loadPolicy(env, VOICE_ENGINES[chosen], chatModelResidentGB) };

  // 2. hard evidence: iPhone and iPad never load a second model beside the chat model
  if (isIOSDevice(userAgent, maxTouchPoints)) return os("ios-system-voice-only");

  // 3. coverage: the small engines are English only
  const lang = String(language || "").toLowerCase().split("-")[0];
  const candidates = Object.values(VOICE_ENGINES).filter((e) => e.languages.includes(lang));
  if (!candidates.length) return os("language-not-covered");

  // 4. stage 1: cheap signals. Anything missing is "no", never "yes".
  const mobile = isMobile(userAgent, maxTouchPoints);
  const mem = Number.isFinite(env.deviceMemoryGB) ? env.deviceMemoryGB : null;
  const cores = Number.isFinite(env.cores) ? env.cores : null;
  if (cores === null || cores < config.minCores) return os("too-few-cores", { stage: 1 });
  if (mobile && mem === null) return os("memory-unknown-on-mobile", { stage: 1 });
  if (mem !== null && mem < config.minMemoryGB) return os("low-memory", { stage: 1 });
  if (!storage || !Number.isFinite(storage.quota) || !Number.isFinite(storage.usage)) return os("storage-unknown", { stage: 1 });
  const freeMB = (storage.quota - storage.usage) / 1e6;
  // a mobile browser's estimate can overstate free space by orders of magnitude: it must be proven with a real write
  if (mobile && storage.writeOk !== true) return os(storage.writeOk === false ? "not-enough-free-storage" : "storage-unverified", { stage: 1, needsStorageTest: storage.writeOk === undefined });

  // the larger voice needs memory headroom (or, on desktop where memory is hidden, a fast probe below)
  // Measured 2026-11-02: Kokoro q8 on WASM/CPU ran at 0.56x (1 thread) to 0.86x (8 threads) real time on a 16-core desktop, so it needs a real GPU adapter
  const realGpu = Boolean(env.webgpu?.available) && !env.webgpu?.isFallbackAdapter;
  const wantQuality = realGpu && (mem !== null ? mem >= config.qualityMinMemoryGB : !mobile) && candidates.some((c) => c.tier === 2);
  const pick = (wantQuality ? candidates.find((c) => c.tier === 2) : candidates.find((c) => c.tier === 1)) || candidates[0];
  const needMB = (pick.downloadBytes / 1e6) * config.storageHeadroomFactor;
  if (freeMB < Math.max(needMB, config.minFreeStorageMB + pick.downloadBytes / 1e6)) {
    // the smaller voice may still fit
    const small = candidates.find((c) => c.tier === 1);
    if (small && small !== pick && freeMB >= Math.max((small.downloadBytes / 1e6) * config.storageHeadroomFactor, config.minFreeStorageMB + small.downloadBytes / 1e6)) return decide(small);
    return os("not-enough-free-storage", { stage: 1, freeMB: Math.round(freeMB) });
  }
  return decide(pick);

  function decide(engine) {
    // 5. stage 2: the compute probe has to have run and passed
    if (!probe || !Number.isFinite(probe.ms)) return os("probe-needed", { stage: 2, needsProbe: true, candidate: engine.id });
    if (probe.ms > config.probeMaxMs) return os("probe-too-slow", { stage: 2, ms: probe.ms });
    // 6. offered only when calibrated, or when the dev flag asks for it
    const offerOk = config.calibrated === true || devOffer === true;
    return { engine: "os", offer: offerOk, candidate: engine.id, reason: offerOk ? "offer" : "uncalibrated", stage: 2,
      loadWhen: loadPolicy(env, engine, chatModelResidentGB), downloadBytes: engine.downloadBytes };
  }
}

/** The voice model loads beside the chat model only when memory is known and there is room; otherwise it waits until the chat model is idle. */
export function loadPolicy(env, engine, chatModelResidentGB = 0) {
  const mem = Number.isFinite(env?.deviceMemoryGB) ? env.deviceMemoryGB : null;
  if (mem === null) return "when-idle";
  const needGB = engine.tier === 2 ? 1.2 : 0.5;
  return mem - chatModelResidentGB >= needGB + 1 ? "with-chat" : "when-idle";
}

/** Stage 3: after install. True when the voice keeps comfortably ahead of playback and starts quickly; otherwise it is removed. */
export function voiceIsFastEnough({ realTimeFactor, firstAudioMs }, config = VOICE_CONFIG) {
  return Number.isFinite(realTimeFactor) && realTimeFactor >= config.minRealTimeFactor && Number.isFinite(firstAudioMs) && firstAudioMs <= 3000;
}
