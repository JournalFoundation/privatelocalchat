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
export const GATE_COOLDOWN_MS = 14 * 864e5;
/** A remembered failure (too slow, repeated runtime failure, a page that ended during setup) stops automatic offers for this long, never forever. */
export const FALLBACK_MS = 7 * 864e5;

/** Plain words for a decision, for the places that tell the person why a voice was not offered. */
export function explainDecision(reason = "") {
  const r = String(reason);
  if (r === "probe-too-slow" || r.startsWith("gate-remembered:probe-too-slow")) return "This device is too slow to run a more natural voice comfortably.";
  if (r === "not-enough-free-storage" || r.startsWith("gate-remembered:not-enough")) return "There is not enough free storage on this device for it.";
  if (r === "storage-unverified" || r === "storage-unknown" || r === "storage-test-unavailable") return "The browser would not let the app check how much free storage there is, so it did not try.";
  if (r === "low-memory" || r === "too-few-cores" || r === "memory-unknown-on-mobile") return "This device does not report enough memory or processor cores for it.";
  if (r === "language-not-covered") return "The more natural voices read English only.";
  if (r === "probe-unavailable" || r === "probe-needed") return "The speed check could not run on this device.";
  if (r === "ios-system-voice-only") return "iPhone and iPad use the system voice unless you choose to try a downloaded one.";
  return "This device did not pass the checks (" + r + ").";
}
export const SAMPLE_TEXT = "This is how I will read your answers aloud. If you like it, keep this voice.";
const TYPICAL_REPLY_SECONDS = 20;
/** Engines that exist in this build. */
export const IMPLEMENTED = Object.freeze(["kitten", "kokoro"]);

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
  let removing = false, slowStreak = 0, evaluating = null, state = "system", engine = null, engineId = null, sessionFallback = false, lastMetrics = null, candidate = null, player = null, decision = null;
  const listeners = new Set();
  const ios = isIOSDevice(userAgent, maxTouchPoints);
  /** iPhone and iPad are blocked by default; a person who opted in with "Try a more natural voice" is allowed. */
  const iosAllowed = () => ios && record.iosTry === true;
  const markSpeaking = (on) => { if (!iosAllowed()) return; record.speaking = on ? now() : null; save(); };
  // A normal close or navigation says so; a page the system killed does not, and that is what the guards below look for.
  try { globalThis.addEventListener?.("pagehide", () => { if (record.pending || record.speaking) { record.pending = null; record.speaking = null; save(); } }); } catch { /* no window */ }
  async function removeFiles(id) { try { await (await engineFor(id)).remove(); return true; } catch { return false; } }

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
      if (ios && !iosAllowed()) return state;
      // a page that was killed while setting a voice up or reading in it: the half-made files go and the voice is not tried again for a week
      if (record.pending) { const id = record.pending.id; record.pending = null; await removeFiles(id); record = { ...record, engine: null, chosen: null, fallback: { reason: "page-ended-during-setup", engine: id, at: now() } }; save(); return state; }
      if (record.speaking && record.engine) { const id = record.engine; record.speaking = null; save(); await giveUp(id, "page-ended-while-reading"); return state; }
      if (record.cleanup) { if (await removeFiles(record.cleanup)) { record.cleanup = null; save(); } }
      if (!record.engine || record.chosen !== record.engine) return state;
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
    async evaluate({ manual = false } = {}) {
      if (evaluating) return evaluating;
      evaluating = (async () => {
        try { return (decision = await evaluate(manual)); } catch (e) { return (decision = { offer: false, reason: "error:" + (e?.message || e) }); } finally { evaluating = null; }
      })();
      return evaluating;
    },

    /** Called after a read-aloud with the system voice worked. Shows the offer at most once per session. */
    async afterSystemSpeak() {
      if (state !== "system" || decision) return state === "offered";
      const d = await ctl.evaluate();
      if (d.offer) set("offered", { candidate: d.candidate, bytes: d.downloadBytes, reason: null });
      return d.offer === true;
    },

    /**
     * "Try a more natural voice" (Settings): the person asked, so every remembered refusal is set aside (a decline, a failure, a measured no) and, on iPhone and
     * iPad, the opt-in is recorded. The device is checked as usual; the answer is the offer or a plain reason.
     */
    async tryNow() {
      if (state === "installing" || state === "testing") return { offered: false, decision: { offer: false, reason: "busy" } };
      if (state === "active" || state === "offered") return { offered: state === "offered", decision: { offer: state === "offered", reason: state } };
      record = { ...record, chosen: record.chosen === "os" ? null : record.chosen, fallback: null, gate: null, declinedAt: null, ...(ios ? { iosTry: true } : {}) };
      save(); decision = null; sessionFallback = false;
      const d = await ctl.evaluate({ manual: true });
      if (d.offer) set("offered", { candidate: d.candidate, bytes: d.downloadBytes, reason: null });
      return { offered: d.offer === true, decision: d };
    },
    /** True on an iPhone or iPad where the person has opted in to trying a downloaded voice. */
    iosOptedIn: () => iosAllowed(),

    /** "Not now": quiet for 30 days. */
    dismiss() { record.declinedAt = now(); save(); set("system", { progress: null }); },

    /** "Try it": download, measure, then play a sample. Resolves { ok, reason? }; state is testing on success. */
    async accept() {
      if (state !== "offered" || !ctl.info.candidate) return { ok: false, reason: "not-offered" };
      const id = candidate = ctl.info.candidate;
      set("installing", { progress: { done: 0, total: ctl.info.bytes } });
      record.pending = { id, at: now() }; save(); // cleared when setup ends; if the page is killed first, the next start cleans up
      try {
        const e = await engineFor(id);
        await e.install((done, total) => set("installing", { progress: { done, total } }));
        set("testing", { progress: null });
        const chunks = [];
        const metrics = await e.speak(SAMPLE_TEXT, { onChunk: (s, r) => chunks.push([s, r]), speed: 1 });
        lastMetrics = metrics;
        if (!voiceIsFastEnough({ ...metrics, typicalReplySeconds: TYPICAL_REPLY_SECONDS }, config)) return await giveUp(id, "too-slow");
        record.pending = null; save();
        // the sample is played from what was just made, so the person hears exactly what a reply will sound like
        const p = (player = createGaplessPlayer({ createContext }));
        for (const [s, r] of chunks) p.push(s, r);
        p.finish().catch(() => {});
        return { ok: true, metrics };
      } catch (err) {
        // a failed download or a storage error is not a verdict on the voice: nothing is remembered, so the next offer (or a tap in Settings) can try again
        return await giveUp(id, "error: " + (err?.message || err), { remember: false });
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
      removing = true; const removed = id ? await removeFiles(id) : true; removing = false;
      record = { ...record, engine: null, chosen: "os", cleanup: removed ? null : id }; save();
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
      removing = true; const removed = id ? await removeFiles(id) : true; removing = false;
      player?.stop(); player = null;
      // if the files could not be deleted (a locked handle, another tab), the id is kept so the next start tries again instead of leaving them behind
      record = { ...record, engine: null, chosen: null, declinedAt: now(), speaking: null, cleanup: removed ? null : id }; save();
      set("system", { progress: null });
    },
    /** Bytes the downloaded voice uses on this device (0 when none). */
    async bytes() { if (!record.engine) return 0; try { return (await (await engineFor(record.engine)).status()).bytes || 0; } catch { return 0; } },

    /** For chat/speech.mjs: an engine route while the downloaded voice is active, otherwise null (system voice). */
    route() {
      if (state !== "active" || sessionFallback || !engine) return null;
      const lead = lastMetrics ? Math.min(startDelayMs({ audioSeconds: TYPICAL_REPLY_SECONDS, realTimeFactor: lastMetrics.realTimeFactor, firstAudioMs: lastMetrics.firstAudioMs }), config.maxStartDelayMs) : 0;
      // A chunk is at most about 25 s of speech, so the time to make one is 25 s divided by the measured speed. The watchdog waits three times that (not a fixed 75 to 90 s),
      // with a floor for a cold start and a ceiling for a device that is nearly stopped.
      const rtf = lastMetrics?.realTimeFactor, perChunkMs = Number.isFinite(rtf) && rtf > 0 ? (25 / rtf) * 1000 : 60000;
      const firstChunkMs = Math.min(90000, Math.max(20000, Math.round(perChunkMs * 3 + config.maxFirstAudioMs)));
      const betweenMs = Math.min(75000, Math.max(15000, Math.round(perChunkMs * 3)));
      const speak = async (t, o) => {
        markSpeaking(true);
        try {
          const r = await engine.speak(t, o);
          // the speed is re-measured on every reply (the sample was taken on an idle device): two slow replies in a row mean this voice no longer keeps up here
          if (r && Number.isFinite(r.realTimeFactor)) {
            lastMetrics = { ...lastMetrics, realTimeFactor: r.realTimeFactor, firstAudioMs: Number.isFinite(r.firstAudioMs) ? r.firstAudioMs : lastMetrics?.firstAudioMs };
            slowStreak = r.realTimeFactor < config.minRealTimeFactor ? slowStreak + 1 : 0;
            if (slowStreak >= 2) { slowStreak = 0; ctl.engineFailed(new Error("too slow while reading")); }
          }
          return r;
        } finally { markSpeaking(false); }
      };
      return {
        engine: { speak, terminate: () => engine.terminate?.(), fail: (err) => ctl.engineFailed(err) },
        options: { startDelayMs: Number.isFinite(lead) ? lead : 0, firstChunkMs, betweenMs, createContext }
      };
    },
    /** The engine failed or stalled while reading: the system voice is used for the rest of the session and the device remembers why. */
    engineFailed(err) {
      if (removing || !record.engine) return; // the person removed the voice while it was reading: that is not a failure of the voice
      sessionFallback = true;
      const previous = record.fallback?.runtime && record.fallback.engine === record.engine ? record.fallback.count || 1 : 0;
      record.fallback = { reason: "runtime: " + (err?.message || err), engine: record.engine, at: now(), runtime: true, count: previous + 1 }; save();
      set("fallback", { reason: record.fallback.reason });
      // a second failure means this voice does not work here: delete it rather than failing again every session
      if (record.fallback.count >= 2 && record.engine) void giveUp(record.engine, "repeated-failure");
    }
  };

  async function giveUp(id, reason, { remember = true } = {}) {
    player?.stop(); player = null;
    removing = true; const removed = await removeFiles(id); removing = false;
    record = { ...record, engine: null, chosen: null, pending: null, speaking: null, cleanup: removed ? null : id, fallback: remember ? { reason, engine: id, at: now() } : record.fallback }; save();
    set(remember ? "fallback" : "system", { reason, progress: null });
    return { ok: false, reason };
  }

  async function evaluate(manual = false) {
    if (ios && !iosAllowed() && !manual) return { offer: false, reason: "ios-system-voice-only" };
    // files left by an install or test the page never finished (closed, crashed or killed), or by a removal that failed, are removed before anything else
    if (!record.engine) { for (const id of IMPLEMENTED) { try { const e = await engineFor(id), st = await e.status(); if (st.installed || st.bytes > 0) await e.remove(); } catch { /* nothing to clean */ } } record.cleanup = null; }
    if (!manual) {
      if (record.chosen) return { offer: false, reason: "user-choice" };
      if (record.fallback && now() - record.fallback.at < FALLBACK_MS) return { offer: false, reason: "fallback-remembered" };
      if (record.declinedAt && now() - record.declinedAt < DECLINE_MS) return { offer: false, reason: "declined-recently" };
      if (record.gate && now() - record.gate.at < GATE_COOLDOWN_MS) return { offer: false, reason: "gate-remembered:" + record.gate.reason };
    }
    const asked = manual || iosAllowed();
    const base = { env: await env(), userAgent, maxTouchPoints, language, config, devOffer, installed: {}, chosen: null };
    let est = null; try { est = await estimate(); } catch { /* unknown */ }
    const storageNow = est && Number.isFinite(est.quota) ? { usage: est.usage || 0, quota: est.quota } : null;
    let d = pickVoiceEngine({ ...base, only: IMPLEMENTED, manual: asked, storage: storageNow });
    // a stage-1 "no" ends it here; only a device that passed the cheap checks reaches the measurement modules
    if (d.offer === false && d.reason !== "probe-needed" && d.reason !== "storage-unverified") return d;
    // the real write test is required for any offer (the estimate alone is not trusted); a missing module means no offer
    const smod = await tryLoad("storage-check.mjs"), check = pickFn(smod, ["checkStorage", "measureStorage", "storageCheck", "default"]);
    if (!check) return { offer: false, reason: "storage-test-unavailable" };
    const s = await check({ bytes: Math.max(...Object.values(VOICE_ENGINES).filter((e) => IMPLEMENTED.includes(e.id)).map((e) => e.downloadBytes)) });
    if (!s) return { offer: false, reason: "storage-test-unavailable" };
    base.storage = s;
    d = pickVoiceEngine({ ...base, only: IMPLEMENTED, manual: asked });
    if (d.reason === "probe-needed") {
      const mod = await tryLoad("voice-probe.mjs"), run = pickFn(mod, ["runComputeProbe", "runVoiceProbe", "runProbe", "probe", "default"]);
      if (!run) return { offer: false, reason: "probe-unavailable" };
      const probe = await run();
      if (!probe || !Number.isFinite(probe.ms)) return { offer: false, reason: "probe-unavailable" };
      d = pickVoiceEngine({ ...base, only: IMPLEMENTED, manual: asked, probe });
    }
    // a measured "no" about the device itself is remembered for a while, so the write test and the probe do not run every session
    if (!manual && d.offer === false && (d.reason === "probe-too-slow" || d.reason === "not-enough-free-storage")) { record.gate = { reason: d.reason, at: now() }; save(); }
    return d;
  }
  async function tryLoad(name) { try { return await loadModule(name); } catch { return null; } }

  return ctl;
}
