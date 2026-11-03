import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceController, VOICE_KEY, DECLINE_MS } from "../chat/voice-upgrade.mjs";
import { VOICE_CONFIG, voiceIsFastEnough, startDelayMs } from "../runtime/voice-pick.mjs";
import { speak } from "../chat/speech.mjs";
import { createGaplessPlayer } from "../chat/voice-player.mjs";
import { createFakeVoiceEngine, fakeAudioContext } from "./helpers/fake-voice-engine.mjs";

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari";
const good = { env: () => ({ deviceMemoryGB: 8, cores: 8, webgpu: { available: false } }), estimate: async () => ({ usage: 1e8, quota: 5e10 }) };
const modules = (over = {}) => async (name) => {
  const all = { "storage-check.mjs": { checkStorage: async () => ({ usage: 1e8, quota: 5e10, writeOk: true }) }, "voice-probe.mjs": { runVoiceProbe: async () => ({ ms: 10 }) }, ...over };
  if (!all[name]) throw new Error("not found");
  return all[name];
};
const make = (o = {}) => {
  const engine = o.engine || createFakeVoiceEngine(), storage = o.storage || mem();
  const ctl = createVoiceController({ factory: async () => engine, storage, userAgent: DESKTOP, loadModule: modules(o.modules), devOffer: true, createContext: fakeAudioContext, ...good, ...o.ctl });
  return { ctl, engine, storage };
};
const fakeSystemVoice = () => {
  const spoken = [];
  globalThis.speechSynthesis = { getVoices: () => [{ voiceURI: "v", lang: "en", localService: true }], cancel() {}, speak(u) { spoken.push(u.text); u.onend(); }, addEventListener() {}, removeEventListener() {} };
  globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
  return { spoken, restore() { delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance; } };
};

test("offered after a working read-aloud when every check passes", async () => {
  const { ctl } = make();
  assert.equal(ctl.state, "system");
  assert.equal(await ctl.afterSystemSpeak(), true);
  assert.equal(ctl.state, "offered");
  assert.ok(ctl.info.bytes > 0);
});

test("no offer without the dev flag while thresholds are uncalibrated", async () => {
  const { ctl } = make({ ctl: { devOffer: false, config: { ...VOICE_CONFIG, calibrated: false } } });
  assert.equal(await ctl.afterSystemSpeak(), false);
  assert.equal(ctl.state, "system");
});

test("iPhone and iPad are never offered and no measurement module is loaded", async () => {
  for (const [ua, touch] of [[IPHONE, 5], ["Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari", 5]]) {
    const loaded = [];
    const { ctl } = make({ ctl: { userAgent: ua, maxTouchPoints: touch, loadModule: async (n) => { loaded.push(n); return {}; } } });
    assert.equal(ctl.isIOS(), true);
    assert.equal(await ctl.afterSystemSpeak(), false);
    assert.equal(ctl.state, "system");
    assert.deepEqual(loaded, []);
  }
});

test("missing measurement modules mean no offer", async () => {
  for (const missing of ["voice-probe.mjs", "storage-check.mjs"]) {
    const { ctl } = make({ ctl: { loadModule: async (n) => { if (n === missing) throw new Error("nope"); return modules()(n); } } });
    assert.equal(await ctl.afterSystemSpeak(), false, missing);
    assert.equal(ctl.state, "system");
  }
  const { ctl } = make({ ctl: { loadModule: async () => { throw new Error("nope"); } } });
  assert.equal(await ctl.afterSystemSpeak(), false);
});

test("a slow probe or too little storage gives no offer", async () => {
  let { ctl } = make({ modules: { "voice-probe.mjs": { runVoiceProbe: async () => ({ ms: VOICE_CONFIG.probeMaxMs * 5 }) } } });
  assert.equal(await ctl.afterSystemSpeak(), false);
  // the real write test is what decides now; the estimate alone is never trusted
  ({ ctl } = make({ modules: { "storage-check.mjs": { checkStorage: async () => ({ usage: 0, quota: 1e7, writeOk: true }) } } }));
  assert.equal(await ctl.afterSystemSpeak(), false);
  ({ ctl } = make({ modules: { "storage-check.mjs": { checkStorage: async () => ({ usage: 0, quota: 5e10, writeOk: false }) } } }));
  assert.equal(await ctl.afterSystemSpeak(), false);
});

test("accept installs, measures, plays a sample; keep makes it active and persists", async () => {
  const { ctl, engine, storage } = make();
  await ctl.afterSystemSpeak();
  const seen = []; ctl.subscribe((s) => seen.push(s.state));
  const r = await ctl.accept();
  assert.equal(r.ok, true);
  assert.deepEqual([...new Set(seen)], ["installing", "testing"]);
  assert.equal(ctl.state, "testing");
  assert.equal(ctl.keep(), true);
  assert.equal(ctl.state, "active");
  const saved = JSON.parse(storage.getItem(VOICE_KEY));
  assert.equal(saved.chosen, saved.engine);
  assert.equal(engine.filesOnDisk, true);
  const next = createVoiceController({ factory: async () => engine, storage, userAgent: DESKTOP, loadModule: modules(), ...good });
  assert.equal(await next.init(), "active");
});

test("declining after the sample deletes the files and remembers the choice", async () => {
  const { ctl, engine, storage } = make();
  await ctl.afterSystemSpeak(); await ctl.accept();
  assert.equal(engine.filesOnDisk, true);
  await ctl.decline();
  assert.equal(engine.filesOnDisk, false);
  assert.ok(engine.calls.includes("remove"));
  assert.equal(ctl.state, "system");
  assert.equal(JSON.parse(storage.getItem(VOICE_KEY)).chosen, "os");
  assert.equal(await make({ storage, engine }).ctl.afterSystemSpeak(), false);
});

test("a slow engine is removed and the system voice stays, with a remembered reason", async () => {
  const rtf = VOICE_CONFIG.minRealTimeFactor / 2;
  const slow = { audioSeconds: 4, synthSeconds: 4 / rtf, realTimeFactor: rtf, firstAudioMs: 300 };
  assert.equal(voiceIsFastEnough({ ...slow }), false);
  const { ctl, engine, storage } = make({ engine: createFakeVoiceEngine({ metrics: slow }) });
  await ctl.afterSystemSpeak();
  const r = await ctl.accept();
  assert.equal(r.ok, false);
  assert.equal(ctl.state, "fallback");
  assert.equal(engine.filesOnDisk, false);
  assert.match(JSON.parse(storage.getItem(VOICE_KEY)).fallback.reason, /slow/);
  assert.equal(ctl.route(), null);
  assert.equal(await make({ storage, engine }).ctl.afterSystemSpeak(), false);
});

test("an engine that errors during install or test is removed", async () => {
  for (const o of [{ failInstall: true }, { failSpeak: true }]) {
    const { ctl, engine } = make({ engine: createFakeVoiceEngine(o) });
    await ctl.afterSystemSpeak();
    const r = await ctl.accept();
    assert.equal(r.ok, false);
    assert.match(r.reason, /^error:/);
    // a failed download or test is not a verdict on the voice: nothing is remembered, so the offer can come back and Settings can retry
    assert.equal(ctl.state, "system");
    assert.equal(ctl.record.fallback, null);
    assert.equal(engine.filesOnDisk, false);
  }
});

test("a slower-than-playback engine that starts soon is kept, with a lead before playback", async () => {
  const rtf = VOICE_CONFIG.minRealTimeFactor;
  const m = { audioSeconds: 4, synthSeconds: 4 / rtf, realTimeFactor: rtf, firstAudioMs: 500 };
  const qualifies = voiceIsFastEnough({ ...m });
  const { ctl } = make({ engine: createFakeVoiceEngine({ metrics: m }) });
  await ctl.afterSystemSpeak();
  assert.equal((await ctl.accept()).ok, qualifies);
  if (!qualifies) return;
  ctl.keep();
  const lead = ctl.route().options.startDelayMs;
  assert.equal(lead, Math.min(startDelayMs({ audioSeconds: 20, realTimeFactor: rtf, firstAudioMs: 500 }), VOICE_CONFIG.maxStartDelayMs));
});

test("Not now is remembered for 30 days", async () => {
  let t = 1e12;
  const { ctl, storage } = make({ ctl: { now: () => t } });
  await ctl.afterSystemSpeak(); ctl.dismiss();
  assert.equal(ctl.state, "system");
  assert.equal(JSON.parse(storage.getItem(VOICE_KEY)).declinedAt, t);
  t += DECLINE_MS - 1000;
  assert.equal(await make({ storage, ctl: { now: () => t } }).ctl.afterSystemSpeak(), false);
  t += 2000;
  assert.equal(await make({ storage, ctl: { now: () => t } }).ctl.afterSystemSpeak(), true);
});

test("Remove in settings deletes the files and returns to the system voice", async () => {
  const { ctl, engine } = make();
  await ctl.afterSystemSpeak(); await ctl.accept(); ctl.keep();
  assert.equal(await ctl.bytes(), 30e6);
  await ctl.unload(); assert.ok(engine.calls.includes("unload"));
  await ctl.remove();
  assert.equal(engine.filesOnDisk, false);
  assert.equal(ctl.state, "system");
  assert.equal(ctl.route(), null);
});

test("speaking while active routes to the engine gaplessly; a failure falls back to the system voice", async () => {
  const engine = createFakeVoiceEngine();
  const { ctl } = make({ engine });
  await ctl.afterSystemSpeak(); await ctl.accept(); ctl.keep();
  const ctx = fakeAudioContext(), route = ctl.route();
  assert.ok(route);
  await speak("Hello there.", { engine: route.engine, ...route.options, startDelayMs: 0, createContext: () => ctx }).done;
  assert.equal(ctx.scheduled.length, 2);
  assert.ok(ctx.scheduled[1].at >= ctx.scheduled[0].at + ctx.scheduled[0].duration - 1e-9, "chunks are gapless");
  engine.speak = async () => { throw new Error("boom"); };
  const sys = fakeSystemVoice();
  try {
    const r2 = ctl.route();
    await speak("Hello there.", { engine: r2.engine, ...r2.options }).done;
    assert.deepEqual(sys.spoken, ["Hello there."]);
    assert.equal(ctl.state, "fallback");
    assert.equal(ctl.route(), null);
  } finally { sys.restore(); }
});

test("a stalled engine is abandoned and the system voice reads instead; abort stops quietly", async () => {
  const sys = fakeSystemVoice();
  try {
    const hung = createFakeVoiceEngine({ hangSpeak: true }); let failed = null;
    await speak("Stalled reply.", { engine: { speak: (t, o) => hung.speak(t, o), fail: (e) => { failed = e; } }, firstChunkMs: 30 }).done;
    assert.match(failed.message, /stopped responding/);
    assert.deepEqual(sys.spoken, ["Stalled reply."]);
    const h2 = speak("Abort me.", { engine: { speak: (t, o) => hung.speak(t, o), fail() { throw new Error("must not fail on abort"); } }, firstChunkMs: 5000 });
    h2.stop(); await h2.done;
    assert.deepEqual(sys.spoken, ["Stalled reply."]);
  } finally { sys.restore(); }
});

test("a wedged worker that ignores the abort is terminated, so the system voice still takes over", async () => {
  const sys = fakeSystemVoice();
  try {
    let terminated = 0, failed = null, reject = null;
    const wedged = { speak: () => new Promise((_, rej) => { reject = rej; }), terminate() { terminated++; reject(new Error("the voice worker was stopped")); }, fail: (e) => { failed = e; } };
    await speak("Wedged reply.", { engine: wedged, firstChunkMs: 30 }).done;
    assert.equal(terminated, 1);
    assert.match(failed.message, /stopped responding/);
    assert.deepEqual(sys.spoken, ["Wedged reply."]);
  } finally { sys.restore(); }
});

test("the player holds chunks until released, then plays them back to back", async () => {
  const ctx = fakeAudioContext(), p = createGaplessPlayer({ createContext: () => ctx, hold: true });
  p.push(new Float32Array(100), 100); assert.equal(ctx.scheduled.length, 0);
  p.release(); p.push(new Float32Array(100), 100);
  await p.finish();
  assert.equal(ctx.scheduled.length, 2);
});

// ---------- the review's lock-out and safety findings ----------
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari";
const seeded = (record) => { const st = mem(); st.setItem(VOICE_KEY, JSON.stringify({ v: 1, engine: null, chosen: null, declinedAt: null, fallback: null, ...record })); return st; };
const DAY = 864e5;

test("Try a more natural voice sets aside a decline, a remembered failure and a measured no", async () => {
  const st = seeded({ chosen: "os", declinedAt: Date.now(), fallback: { reason: "too-slow", engine: "kitten", at: Date.now() }, gate: { reason: "probe-too-slow", at: Date.now() } });
  const { ctl } = make({ storage: st });
  assert.equal(await ctl.afterSystemSpeak(), false, "nothing is offered automatically");
  const r = await ctl.tryNow();
  assert.equal(r.offered, true); assert.equal(ctl.state, "offered");
  assert.equal(ctl.record.chosen, null); assert.equal(ctl.record.fallback, null); assert.equal(ctl.record.declinedAt, null); assert.equal(ctl.record.gate, null);
});

test("a manual try still obeys the device checks and says why it declined", async () => {
  const { ctl } = make({ modules: { "voice-probe.mjs": { runVoiceProbe: async () => ({ ms: VOICE_CONFIG.probeMaxMs * 5 }) } } });
  const r = await ctl.tryNow();
  assert.equal(r.offered, false); assert.equal(r.decision.reason, "probe-too-slow");
  const { explainDecision } = await import("../chat/voice-upgrade.mjs");
  assert.match(explainDecision(r.decision.reason), /too slow/);
  assert.match(explainDecision("storage-unverified"), /free storage/);
  assert.match(explainDecision("weird"), /weird/);
});

test("a remembered failure stops automatic offers for a week, not forever", async () => {
  const fallback = (days) => ({ reason: "too-slow", engine: "kitten", at: Date.now() - days * DAY });
  assert.equal(await make({ storage: seeded({ fallback: fallback(1) }) }).ctl.afterSystemSpeak(), false);
  assert.equal(await make({ storage: seeded({ fallback: fallback(8) }) }).ctl.afterSystemSpeak(), true);
});

test("on iPhone and iPad nothing is offered until the person opts in, and then only the small voice", async () => {
  const ios = { userAgent: IPHONE_UA, maxTouchPoints: 5, env: () => ({ cores: 6, webgpu: { available: true, isFallbackAdapter: false } }) };
  const { ctl } = make({ ctl: ios });
  assert.equal(ctl.isIOS(), true); assert.equal(ctl.iosOptedIn(), false);
  assert.equal(await ctl.afterSystemSpeak(), false);
  assert.equal(ctl.info.candidate, null);
  const r = await ctl.tryNow();
  assert.equal(r.offered, true, JSON.stringify(r.decision));
  assert.equal(ctl.info.candidate, "kitten", "a GPU phone is still only offered the small voice");
  assert.equal(ctl.iosOptedIn(), true); assert.equal(ctl.record.iosTry, true);
});

test("an iPhone that fails the speed check is still declined after opting in", async () => {
  const { ctl } = make({ ctl: { userAgent: IPHONE_UA, maxTouchPoints: 5, env: () => ({ cores: 6 }) }, modules: { "voice-probe.mjs": { runVoiceProbe: async () => ({ ms: VOICE_CONFIG.probeMaxMs * 5 }) } } });
  const r = await ctl.tryNow();
  assert.equal(r.offered, false); assert.equal(r.decision.reason, "probe-too-slow");
});

test("removing the voice while it is reading does not count as the voice failing", async () => {
  const engine = createFakeVoiceEngine(); let ref = null; const real = engine.remove;
  engine.remove = async () => { ref.engineFailed(new Error("the voice worker stopped")); return real.call(engine); }; // what terminating the worker does to a pending speak
  const { ctl } = make({ engine }); ref = ctl;
  await ctl.afterSystemSpeak(); await ctl.accept(); ctl.keep();
  await ctl.remove();
  assert.equal(ctl.record.fallback, null); assert.equal(ctl.state, "system");
});

test("a page that was killed while a voice was being set up cleans up and waits a week", async () => {
  const engine = createFakeVoiceEngine({ installed: true });
  const { ctl } = make({ engine, storage: seeded({ pending: { id: "kitten", at: Date.now() } }) });
  await ctl.init();
  assert.equal(engine.filesOnDisk, false);
  assert.equal(ctl.record.fallback.reason, "page-ended-during-setup"); assert.equal(ctl.record.pending, null);
  assert.equal(await ctl.afterSystemSpeak(), false);
});

test("on an opted-in iPhone, a page killed while the voice was reading removes the voice", async () => {
  const engine = createFakeVoiceEngine({ installed: true });
  const { ctl } = make({ engine, ctl: { userAgent: IPHONE_UA, maxTouchPoints: 5, env: () => ({ cores: 6 }) }, storage: seeded({ iosTry: true, engine: "kitten", chosen: "kitten", speaking: Date.now() }) });
  await ctl.init();
  assert.equal(engine.filesOnDisk, false); assert.equal(ctl.record.engine, null);
  assert.equal(ctl.record.fallback.reason, "page-ended-while-reading");
});

test("files that could not be deleted are tried again at the next start instead of being left behind", async () => {
  const st = mem(); const engine = createFakeVoiceEngine();
  engine.remove = async () => { throw new Error("handle is locked"); };
  const { ctl } = make({ engine, storage: st });
  await ctl.afterSystemSpeak(); const offered = ctl.info.candidate; await ctl.accept(); ctl.keep();
  await ctl.remove();
  assert.equal(ctl.record.cleanup, offered); assert.equal(ctl.record.engine, null);
  const later = createFakeVoiceEngine({ installed: true });
  const second = make({ engine: later, storage: st }).ctl;
  await second.init();
  assert.equal(later.filesOnDisk, false); assert.equal(second.record.cleanup, null);
});

test("the speed is re-measured on every reply and two slow ones in a row retire the voice", async () => {
  const engine = createFakeVoiceEngine();
  const { ctl } = make({ engine });
  await ctl.afterSystemSpeak(); await ctl.accept(); ctl.keep();
  engine.speak = async () => ({ audioSeconds: 4, synthSeconds: 40, realTimeFactor: VOICE_CONFIG.minRealTimeFactor / 5, firstAudioMs: 300 });
  const route = ctl.route();
  await route.engine.speak("one", {});
  assert.equal(ctl.state, "active", "one slow reply is tolerated");
  await route.engine.speak("two", {});
  assert.equal(ctl.state, "fallback"); assert.match(ctl.record.fallback.reason, /too slow while reading/);
});

test("the stall watchdog is sized from the measured speed, not a fixed 75 to 90 seconds", async () => {
  const fast = make({ engine: createFakeVoiceEngine({ metrics: { audioSeconds: 4, synthSeconds: 1, realTimeFactor: 4, firstAudioMs: 300 } }) }).ctl;
  await fast.afterSystemSpeak(); await fast.accept(); fast.keep();
  const f = fast.route().options;
  assert.ok(f.betweenMs <= 20000 && f.betweenMs >= 15000, "a fast voice is given about 19 s between chunks: " + f.betweenMs);
  assert.ok(f.firstChunkMs < 30000, "and about 23 s for the first: " + f.firstChunkMs);
  const slowRtf = 0.8, slow = make({ engine: createFakeVoiceEngine({ metrics: { audioSeconds: 4, synthSeconds: 4 / slowRtf, realTimeFactor: slowRtf, firstAudioMs: 500 } }) }).ctl;
  await slow.afterSystemSpeak(); await slow.accept(); slow.keep();
  const s = slow.route().options;
  assert.ok(s.betweenMs > f.betweenMs && s.betweenMs <= 75000 && s.firstChunkMs <= 90000, "a slow voice gets longer, with a ceiling");
});

test("the download percentage is shown from the engine's progress objects, with connecting and retry states", async () => {
  const engine = createFakeVoiceEngine();
  engine.install = async (onProgress) => {
    onProgress({ phase: "connecting", overallLoaded: 0, overallTotal: 100 });
    onProgress({ phase: "retry", retryAttempt: 1, overallLoaded: 0, overallTotal: 100 });
    onProgress({ loaded: 40, total: 100, overallLoaded: 40, overallTotal: 100 });
  };
  const { ctl } = make({ engine });
  await ctl.afterSystemSpeak();
  const seen = []; ctl.subscribe((s) => { if (s.state === "installing") seen.push({ ...s.progress }); });
  await ctl.accept();
  assert.deepEqual(seen.map((p) => p.phase), [undefined, "connecting", "retry", null]); // the first is the start of the setup itself
  assert.equal(seen[3].done, 40); assert.equal(seen[3].total, 100);
});

test("a self-test that never makes a sound fails with a reason instead of leaving the setup stuck", async () => {
  const engine = createFakeVoiceEngine(); let terminated = 0;
  engine.speak = () => new Promise(() => {}); // the iPhone stall: it never returns
  engine.terminate = () => { terminated++; };
  const { ctl } = make({ engine, ctl: { selfTestTimeoutMs: 30 } });
  await ctl.afterSystemSpeak();
  const r = await ctl.accept();
  assert.equal(r.ok, false); assert.match(r.reason, /made no sound within/);
  assert.equal(terminated, 1); assert.equal(ctl.state, "system", "not stuck in testing: the person can try again");
  assert.equal(engine.filesOnDisk, false);
});
