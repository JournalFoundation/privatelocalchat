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
  const { ctl } = make({ ctl: { devOffer: false } });
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
  ({ ctl } = make({ ctl: { estimate: async () => ({ usage: 0, quota: 1e7 }) } }));
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
    assert.equal(ctl.state, "fallback");
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

test("the player holds chunks until released, then plays them back to back", async () => {
  const ctx = fakeAudioContext(), p = createGaplessPlayer({ createContext: () => ctx, hold: true });
  p.push(new Float32Array(100), 100); assert.equal(ctx.scheduled.length, 0);
  p.release(); p.push(new Float32Array(100), 100);
  await p.finish();
  assert.equal(ctx.scheduled.length, 2);
});
