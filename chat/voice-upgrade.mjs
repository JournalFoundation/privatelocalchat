// The controller for the optional downloaded read-aloud voice (docs/VOICE-ENGINE-PLAN.md). The system voice is the default and the answer
// whenever anything is unknown. States: system | offered | installing | testing | active | fallback.
//
//   system     the browser's voice is in use, nothing offered
//   offered    the device passed the checks; a quiet line may be shown (nothing is downloaded until the person taps Try it)
//   installing the voice files are downloading
//   testing    installed and measured; the person is hearing a sample and decides Keep or Use the system voice
//   active     the downloaded voice reads aloud
//   fallback   the voice was too slow, failed or stalled; it is removed (or unused) and the system voice stays. Remembered per device.
//
// Everything the browser or another module provides is injected so the whole flow runs in tests. The measurement modules
// (voice-probe.mjs: compute probe, storage-check.mjs: real write test) are imported lazily and may be missing: that means NO OFFER.
//   voice-probe.mjs   exports runVoiceProbe() (or runProbe/probe/default) -> { ms }
//   storage-check.mjs exports checkStorage(bytes) (or measureStorage/storageCheck/default) -> { usage, quota, writeOk }

import { pickVoiceEngine, voiceIsFastEnough, startDelayMs, isIOSDevice, VOICE_CONFIG, VOICE_ENGINES } from "../runtime/voice-pick.mjs";
import { createGaplessPlayer } from "./voice-player.mjs";

export const VOICE_KEY = "plc.voice.v1";
export const DECLINE_MS = 30 * 864e5;
export const SAMPLE_TEXT = "This is how I will read your answers aloud. If you like it, keep this voice.";
const TYPICAL_REPLY_SECONDS = 20;

const blank = () => ({ v: 1, engine: null, chosen: null, declinedAt: null, fallback: null });

const pickFn = (mod, names) => { for (const n of names) if (typeof mod?.[n] === "function") return mod[n]; return null; };

export function createVoiceController({
  factory,                       // async (engineId) -> engine (the fixed interface); a throw means the engine cannot be used
  storage = globalThis.localStorage,
  env = () => ({}),              // () -> { deviceMemoryGB, cores, webgpu }
  estimate = async () => globalThis.navigator?.storage?.estimate?.() ?? null,
  loadModule = (name) => import(new URL("./" + name, import.meta.url).href),
  userAgent = globalThis.navigator?.userAgent || "",
  maxTouchPoints = globalThis.navigator?.maxTouchPoints || 0,
  language = globalThis.navigator?.language || "en",
  now = () => Date.now(),
  config = VOICE_CONFIG,
  devOffer = false,
  createContext
} = {}) {
  let record = read();
  let state = "system", engine = null, engineId = null, sessionFallback = false, lastMetrics = null, candidate = null, player = null, decision = null;
  const listeners = new Set();
  const ios = isIOSDevice(userAgent, maxTouchPoints);

  function read() { try { const r = JSON.parse(storage.getItem(VOICE_KEY)); return r && r.v === 1 ? { ...blank(), ...r } : blank(); } catch { return blank(); } }
  function save() { try { storage.setItem(VOICE_KEY, JSON.stringify(record)); } catch { /* private mode: the choice lasts for this session only */ } }
  function set(next, extra = {}) { state = next; Object.assign(ctl.info, extra); for (const f of listeners) { try { f(ctl.snapshot()); } catch { /* a listener must not break the flow */ } } }
  async function engineFor(id) { if (!engine || engineId !== id) { engine = await factory(id); engineId = id; } return engine; }

  const ctl = {
    info: { reason: null, progress: null, candidate: null, bytes: 0 },
    isIOS: () => ios,
    get state() { return state; },
    get record() { return { ...record }; },
    snapshot: () => ({ state, ...ctl.info, engine: record.engine, label: VOICE_ENGINES[record.engine]?.label || null }),
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },

    /** Startup: if the person already keeps a downloaded voice and its files are there, it becomes active. */
    async init() {
      record = read();
      if (ios || !record.engine || record.chosen !== record.engine) return state;
      try {
        const e = await engineFor(record.engine);
        if ((await e.status()).installed) set("active", { reason: null });
        else { record.chosen = null; record.engine = null; save(); }
      } catch { /* engine code unavailable: system voice */ }
      return state;
    },

    /**
     * Decide whether to offer. Cheap checks first; the measurement modules are only loaded once the cheap checks pass, and a missing
     * module means no offer. Never throws.
     */
    async evaluate() {
      try { return (decision = await evaluate()); } catch (e) { return (decision = { offer: false, reason: "error:" + (e?.message || e) }); }
    },

    /** Called after a read-aloud with the system voice worked. Shows the offer at most once per session. */
    async afterSystemSpeak() {
      if (state !== "system" || decision) return state === "offered";
      const d = await ctl.evaluate();
      if (d.offer) set("offered", { candidate: d.candidate, bytes: d.downloadBytes, reason: null });
      return d.offer === true;
    },

    /** "Not now": quiet for 30 days. */
    dismiss() { record.declinedAt = now(); save(); set("system", { progress: null }); },

    /** "Try it": download, measure, then play a sample. Resolves { ok, reason? }; state is testing on success. */
    async accept() {
      if (state !== "offered" || !ctl.info.candidate) return { ok: false, reason: "not-offered" };
      const id = candidate = ctl.info.candidate;
      set("installing", { progress: { done: 0, total: ctl.info.bytes } });
      try {
        const e = await engineFor(id);
        await e.install((done, total) => set("installing", { progress: { done, total } }));
        set("testing", { progress: null });
        const chunks = [];
        const metrics = await e.speak(SAMPLE_TEXT, { onChunk: (s, r) => chunks.push([s, r]), speed: 1 });
        lastMetrics = metrics;
        if (!voiceIsFastEnough({ ...metrics, typicalReplySeconds: TYPICAL_REPLY_SECONDS }, config)) return await giveUp(id, "too-slow");
        // the sample is played from what was just made, so the person hears exactly what a reply will sound like
        const p = (player = createGaplessPlayer({ createContext }));
        for (const [s, r] of chunks) p.push(s, r);
        p.finish().catch(() => {});
        return { ok: true, metrics };
      } catch (err) {
        return await giveUp(id, "error: " + (err?.message || err));
      }
    },

    /** "Keep this voice". */
    keep() {
      if (state !== "testing") return false;
      player?.stop(); player = null;
      record = { ...record, engine: candidate, chosen: candidate, fallback: null }; save();
      set("active", { reason: null });
      return true;
    },

    /** "Use the system voice" after the sample: the downloaded files are deleted. */
    async decline() {
      player?.stop(); player = null;
      const id = candidate || record.engine;
      try { if (id) await (await engineFor(id)).remove(); } catch { /* nothing left to remove */ }
      record = { ...record, engine: null, chosen: "os" }; save();
      set("system", { progress: null });
    },

    /** Settings: Hear a sample (plays through the engine, or does nothing without one). */
    async hearSample() {
      if (!record.engine) return false;
      const e = await engineFor(record.engine);
      player?.stop(); const p = (player = createGaplessPlayer({ createContext }));
      await e.speak(SAMPLE_TEXT, { onChunk: (s, r) => p.push(s, r), speed: 1 });
      await p.finish();
      return true;
    },
    async unload() { try { await engine?.unload(); } catch { /* already unloaded */ } },
    /** Settings: Remove deletes the files and returns to the system voice; the offer stays quiet for 30 days. */
    async remove() {
      const id = record.engine || candidate;
      try { if (id) await (await engineFor(id)).remove(); } catch { /* nothing left to remove */ }
      player?.stop(); player = null;
      record = { ...record, engine: null, chosen: null, declinedAt: now() }; save();
      set("system", { progress: null });
    },
    /** Bytes the downloaded voice uses on this device (0 when none). */
    async bytes() { if (!record.engine) return 0; try { return (await (await engineFor(record.engine)).status()).bytes || 0; } catch { return 0; } },

    /** For chat/speech.mjs: an engine route while the downloaded voice is active, otherwise null (system voice). */
    route() {
      if (state !== "active" || sessionFallback || !engine) return null;
      const lead = lastMetrics ? Math.min(startDelayMs({ audioSeconds: TYPICAL_REPLY_SECONDS, realTimeFactor: lastMetrics.realTimeFactor, firstAudioMs: lastMetrics.firstAudioMs }), config.maxStartDelayMs) : 0;
      return {
        engine: { speak: (t, o) => engine.speak(t, o), fail: (err) => ctl.engineFailed(err) },
        options: { startDelayMs: Number.isFinite(lead) ? lead : 0, firstChunkMs: config.maxStartDelayMs + config.maxFirstAudioMs, createContext }
      };
    },
    /** The engine failed or stalled while reading: the system voice is used for the rest of the session and the device remembers why. */
    engineFailed(err) {
      sessionFallback = true;
      record.fallback = { reason: "runtime: " + (err?.message || err), engine: record.engine, at: now() }; save();
      set("fallback", { reason: record.fallback.reason });
    }
  };

  async function giveUp(id, reason) {
    player?.stop(); player = null;
    try { await (await engineFor(id)).remove(); } catch { /* partial files are retried by the next install */ }
    record = { ...record, engine: null, chosen: null, fallback: { reason, engine: id, at: now() } }; save();
    set("fallback", { reason, progress: null });
    return { ok: false, reason };
  }

  async function evaluate() {
    if (ios) return { offer: false, reason: "ios-system-voice-only" };
    if (record.chosen) return { offer: false, reason: "user-choice" };
    if (record.fallback) return { offer: false, reason: "fallback-remembered" };
    if (record.declinedAt && now() - record.declinedAt < DECLINE_MS) return { offer: false, reason: "declined-recently" };
    const base = { env: await env(), userAgent, maxTouchPoints, language, config, devOffer, installed: {}, chosen: null };
    let est = null; try { est = await estimate(); } catch { /* unknown */ }
    const storageNow = est && Number.isFinite(est.quota) ? { usage: est.usage || 0, quota: est.quota } : null;
    let d = pickVoiceEngine({ ...base, storage: storageNow });
    // a stage-1 "no" ends it here; only a device that passed the cheap checks reaches the measurement modules
    if (d.offer === false && d.reason !== "probe-needed" && d.reason !== "storage-unverified") return d;
    // the real write test is required for any offer (the estimate alone is not trusted); a missing module means no offer
    const smod = await tryLoad("storage-check.mjs"), check = pickFn(smod, ["checkStorage", "measureStorage", "storageCheck", "default"]);
    if (!check) return { offer: false, reason: "storage-test-unavailable" };
    const s = await check(Math.max(...Object.values(VOICE_ENGINES).map((e) => e.downloadBytes)));
    if (!s) return { offer: false, reason: "storage-test-unavailable" };
    base.storage = s;
    d = pickVoiceEngine({ ...base });
    if (d.reason === "probe-needed") {
      const mod = await tryLoad("voice-probe.mjs"), run = pickFn(mod, ["runVoiceProbe", "runProbe", "probe", "default"]);
      if (!run) return { offer: false, reason: "probe-unavailable" };
      const probe = await run();
      if (!probe || !Number.isFinite(probe.ms)) return { offer: false, reason: "probe-unavailable" };
      d = pickVoiceEngine({ ...base, probe });
    }
    return d;
  }
  async function tryLoad(name) { try { return await loadModule(name); } catch { return null; } }

  return ctl;
}
