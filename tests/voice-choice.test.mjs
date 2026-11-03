import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceChoice, CHOICE_KEY, VOICES, SAMPLE_TEXT } from "../chat/voice-choice.mjs";
import { VOICE_CONFIG } from "../runtime/voice-pick.mjs";
import { createFakeVoiceEngine, fakeAudioContext } from "./helpers/fake-voice-engine.mjs";

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari";
const OLD_ANDROID = "Mozilla/5.0 (Linux; Android 5.1; SM-T670) Chrome/60 Mobile Safari";

function make(o = {}) {
  const engines = o.engines || {};
  const factory = async (id) => (engines[id] ||= createFakeVoiceEngine(o.fake?.[id] || o.fake || {}));
  const storage = o.storage || mem();
  const ctl = createVoiceChoice({ factory, storage, userAgent: DESKTOP, createContext: fakeAudioContext, env: () => ({ cores: 8, deviceMemoryGB: 8 }), selfTestTimeoutMs: 2000, ...o.ctl });
  return { ctl, engines, storage, factory };
}
const voice = (snap, id) => snap.voices.find((v) => v.id === id);

test("the system voice is the default and every voice is listed, on every device", async () => {
  for (const userAgent of [DESKTOP, IPHONE, OLD_ANDROID]) {
    const { ctl } = make({ ctl: { userAgent, maxTouchPoints: userAgent === DESKTOP ? 0 : 5, env: () => ({}) } });
    const s = await ctl.init();
    assert.equal(s.selected, "os");
    assert.deepEqual(s.voices.map((v) => v.id), ["os", "kitten", "kokoro"]);
    assert.equal(voice(s, "kitten").state, "none"); assert.equal(voice(s, "kokoro").state, "none");
  }
});

test("choosing a voice that is not downloaded downloads it at once, with visible progress, and selects it", async () => {
  const { ctl, engines } = make();
  await ctl.init();
  const seen = []; ctl.subscribe((s) => seen.push(voice(s, "kitten").state + ":" + (voice(s, "kitten").progress?.phase ?? voice(s, "kitten").progress?.done ?? "")));
  const r = await ctl.select("kitten");
  assert.equal(r.ok, true);
  assert.ok(seen.some((x) => x.startsWith("installing")), "an installing state was visible: " + seen.join(" "));
  assert.ok(seen.some((x) => x.startsWith("testing")), "then a testing state");
  const s = ctl.snapshot();
  assert.equal(s.selected, "kitten"); assert.equal(voice(s, "kitten").state, "ready");
  assert.deepEqual(engines.kitten.calls.slice(0, 2), ["install", "speak"]);
  assert.equal(s.totalBytes, 30e6);
});

test("progress shows connecting, retrying and the real percentage", async () => {
  const engine = createFakeVoiceEngine();
  engine.install = async (onProgress) => {
    onProgress({ phase: "connecting", overallLoaded: 0, overallTotal: 100 });
    onProgress({ phase: "retry", retryAttempt: 1, overallLoaded: 0, overallTotal: 100 });
    onProgress({ loaded: 40, total: 100, overallLoaded: 40, overallTotal: 100 });
  };
  const { ctl } = make({ engines: { kitten: engine } });
  await ctl.init();
  const seen = []; ctl.subscribe((s) => { const k = voice(s, "kitten"); if (k.state === "installing" && k.progress) seen.push({ ...k.progress }); });
  await ctl.select("kitten");
  const phases = seen.map((p) => p.phase);
  assert.ok(phases.includes("connecting") && phases.includes("retry"));
  assert.ok(seen.some((p) => p.done === 40 && p.total === 100));
});

test("nothing is gated by the device: an old Android tablet and an iPhone can download any voice", async () => {
  for (const [userAgent, maxTouchPoints] of [[OLD_ANDROID, 5], [IPHONE, 5]]) {
    const { ctl } = make({ ctl: { userAgent, maxTouchPoints, env: () => ({ cores: 1 }) } });
    await ctl.init();
    for (const id of ["kitten", "kokoro"]) {
      const r = await ctl.select(id);
      assert.equal(r.ok, true, userAgent + " " + id);
      assert.equal(ctl.snapshot().selected, id);
    }
  }
});

test("a failed download is explained, nothing is kept, the selection does not change, and the voice can be tried again after one confirmation", async () => {
  const engine = createFakeVoiceEngine({ failInstall: true });
  const { ctl } = make({ engines: { kitten: engine } });
  await ctl.init();
  const r = await ctl.select("kitten");
  assert.equal(r.ok, false); assert.match(r.reason, /download failed/);
  let s = ctl.snapshot();
  assert.equal(voice(s, "kitten").state, "failed"); assert.match(voice(s, "kitten").error, /download failed/);
  assert.equal(s.selected, "os", "the person keeps the voice they had");
  assert.equal(s.notice.kind, "error"); assert.match(s.notice.text, /could not be set up/);
  assert.equal(engine.filesOnDisk, false);
  // trying the same thing again asks once...
  const again = await ctl.select("kitten");
  assert.equal(again.needsConfirm, true); assert.match(again.reason, /download failed/); assert.equal(again.count, 1);
  // ...and then goes ahead
  const confirmed = await ctl.select("kitten", { confirmed: true });
  assert.equal(confirmed.ok, false);
  assert.equal(ctl.snapshot().voices.find((v) => v.id === "kitten").failures.count, 2);
});

test("there is no limit: fifty confirmed attempts all go ahead, and a success clears the failure history", async () => {
  const engine = createFakeVoiceEngine({ failInstall: true });
  const { ctl } = make({ engines: { kitten: engine } });
  await ctl.init();
  await ctl.select("kitten");
  for (let i = 0; i < 49; i++) { const r = await ctl.select("kitten", { confirmed: true }); assert.equal(r.ok, false); assert.notEqual(r.needsConfirm, true); }
  assert.equal(voice(ctl.snapshot(), "kitten").failures.count, 50);
  engine.install = async () => { engine._ok = true; };
  const ok = await ctl.select("kitten", { confirmed: true });
  assert.equal(ok.ok, true);
  assert.equal(voice(ctl.snapshot(), "kitten").failures, null);
});

test("a download can be cancelled; nothing is kept and it is not counted as a failure", async () => {
  const engine = createFakeVoiceEngine();
  engine.install = (onProgress, { signal } = {}) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("Download cancelled"), { name: "AbortError" }))));
  const { ctl } = make({ engines: { kitten: engine } });
  await ctl.init();
  const run = ctl.select("kitten");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(voice(ctl.snapshot(), "kitten").state, "installing");
  ctl.cancel("kitten");
  const r = await run;
  assert.equal(r.cancelled, true);
  const s = ctl.snapshot();
  assert.equal(voice(s, "kitten").state, "none"); assert.equal(voice(s, "kitten").failures, null); assert.equal(s.selected, "os");
});

test("a self-test that never makes a sound fails with a reason instead of leaving the setup stuck", async () => {
  const engine = createFakeVoiceEngine(); let terminated = 0;
  engine.speak = () => new Promise(() => {}); // the Safari stall that was found on an iPhone
  engine.terminate = () => { terminated++; };
  const { ctl } = make({ engines: { kitten: engine }, ctl: { selfTestTimeoutMs: 30 } });
  await ctl.init();
  const r = await ctl.select("kitten");
  assert.equal(r.ok, false); assert.match(r.reason, /made no sound within/);
  assert.equal(terminated, 1);
  assert.notEqual(voice(ctl.snapshot(), "kitten").state, "testing");
  assert.equal(engine.filesOnDisk, false);
});

test("a slow voice is kept and selected, and the person is told how slow it is (information, not a verdict)", async () => {
  const m = { audioSeconds: 4, synthSeconds: 40, realTimeFactor: 0.1, firstAudioMs: 3000 };
  const { ctl } = make({ fake: { metrics: m } });
  await ctl.init();
  const r = await ctl.select("kokoro");
  assert.equal(r.ok, true);
  const s = ctl.snapshot();
  assert.equal(s.selected, "kokoro"); assert.equal(voice(s, "kokoro").state, "ready");
  assert.equal(s.notice.kind, "slow"); assert.match(s.notice.text, /0\.1× real time/);
});

test("removing a voice deletes its files and returns to the system voice; other voices stay", async () => {
  const { ctl, engines } = make();
  await ctl.init();
  await ctl.select("kitten"); await ctl.select("kokoro");
  assert.equal(ctl.snapshot().selected, "kokoro");
  await ctl.remove("kokoro");
  let s = ctl.snapshot();
  assert.equal(s.selected, "os"); assert.equal(voice(s, "kokoro").state, "none");
  assert.equal(engines.kokoro.filesOnDisk, false); assert.equal(engines.kitten.filesOnDisk, true); assert.equal(voice(s, "kitten").state, "ready");
  assert.equal(s.totalBytes, 30e6);
  assert.equal((await ctl.select("kitten")).ok, true, "a downloaded voice is selected without downloading again");
  assert.equal(engines.kitten.calls.filter((c) => c === "install").length, 1);
});

test("the choice and the downloaded voices survive a restart; a selection whose files are gone falls back to the system voice", async () => {
  const storage = mem();
  const first = make({ storage });
  await first.ctl.init(); await first.ctl.select("kitten");
  const second = make({ storage, engines: { kitten: createFakeVoiceEngine({ installed: true }) } });
  const s = await second.ctl.init();
  assert.equal(s.selected, "kitten"); assert.equal(voice(s, "kitten").state, "ready");
  const third = make({ storage, engines: { kitten: createFakeVoiceEngine({ installed: false }) } });
  assert.equal((await third.ctl.init()).selected, "os");
});

test("a person who kept a downloaded voice in the earlier version keeps it", async () => {
  const storage = mem(); storage.setItem("plc.voice.v1", JSON.stringify({ v: 1, engine: "kokoro", chosen: "kokoro" }));
  const { ctl } = make({ storage, engines: { kokoro: createFakeVoiceEngine({ installed: true }) } });
  assert.equal((await ctl.init()).selected, "kokoro");
});

test("reading routes through the selected voice; the system voice is never routed", async () => {
  const { ctl } = make();
  await ctl.init();
  assert.equal(ctl.route(), null);
  await ctl.select("kitten");
  const route = ctl.route();
  assert.ok(route && typeof route.engine.speak === "function");
  await ctl.select("os");
  assert.equal(ctl.route(), null);
});

test("a failure while reading falls back for that reply, keeps the choice, and a second failure in a row returns to the system voice", async () => {
  const { ctl } = make();
  await ctl.init(); await ctl.select("kitten");
  const route = ctl.route();
  route.engine.fail(new Error("worker stopped"));
  let s = ctl.snapshot();
  assert.equal(s.selected, "kitten", "still the chosen voice");
  assert.equal(ctl.route(), null, "this session reads with the system voice after a failure");
  assert.match(s.notice.text, /worker stopped/);
  await ctl.select("kitten"); // choosing it again retries
  assert.ok(ctl.route(), "choosing the voice again turns it back on");
  ctl.engineFailed(new Error("again"));
  s = ctl.snapshot();
  assert.equal(s.selected, "os"); assert.match(s.notice.text, /failed twice/);
  assert.equal(voice(s, "kitten").state, "ready", "the voice is still downloaded");
});

test("two slow replies in a row are reported, never punished", async () => {
  const { ctl, engines } = make();
  await ctl.init(); await ctl.select("kitten");
  engines.kitten.speak = async () => ({ audioSeconds: 4, synthSeconds: 40, realTimeFactor: VOICE_CONFIG.minRealTimeFactor / 5, firstAudioMs: 300 });
  ctl.clearNotice();
  const route = ctl.route();
  await route.engine.speak("one", {}); assert.equal(ctl.snapshot().notice, null);
  await route.engine.speak("two", {});
  assert.equal(ctl.snapshot().notice.kind, "slow");
  assert.equal(ctl.snapshot().selected, "kitten");
});

test("the stall watchdog is sized from the measured speed, with a floor and a ceiling", async () => {
  const fast = make({ fake: { metrics: { audioSeconds: 4, synthSeconds: 1, realTimeFactor: 4, firstAudioMs: 300 } } }).ctl;
  await fast.init(); await fast.select("kitten");
  const f = fast.route().options;
  assert.ok(f.betweenMs >= 15000 && f.betweenMs <= 20000, String(f.betweenMs)); assert.ok(f.firstChunkMs < 30000, String(f.firstChunkMs));
  const slow = make({ fake: { metrics: { audioSeconds: 4, synthSeconds: 5, realTimeFactor: 0.8, firstAudioMs: 500 } } }).ctl;
  await slow.init(); await slow.select("kitten");
  const s = slow.route().options;
  assert.ok(s.betweenMs > f.betweenMs && s.betweenMs <= 75000 && s.firstChunkMs <= 90000);
});

test("a page killed while a voice was being set up cleans up, says so, and the voice can be tried again", async () => {
  const storage = mem(); storage.setItem(CHOICE_KEY, JSON.stringify({ v: 2, selected: "os", failures: {}, pending: { id: "kokoro", at: Date.now() }, speaking: null }));
  const engine = createFakeVoiceEngine({ installed: true });
  const { ctl } = make({ storage, engines: { kokoro: engine } });
  const s = await ctl.init();
  assert.equal(engine.filesOnDisk, false);
  assert.match(s.notice.text, /page ended while it was downloading/);
  assert.equal(voice(s, "kokoro").failures.count, 1);
  assert.equal((await ctl.select("kokoro")).needsConfirm, true, "one confirmation, then it goes ahead");
});

test("a page killed while reading in a voice returns to the system voice, says why, and keeps the download", async () => {
  const storage = mem(); storage.setItem(CHOICE_KEY, JSON.stringify({ v: 2, selected: "kitten", failures: {}, pending: null, speaking: { id: "kitten", at: Date.now() } }));
  const { ctl } = make({ storage, engines: { kitten: createFakeVoiceEngine({ installed: true }) } });
  const s = await ctl.init();
  assert.equal(s.selected, "os"); assert.equal(voice(s, "kitten").state, "ready");
  assert.match(s.notice.text, /in use when the page ended/);
});

test("advice recommends a voice and warns about slowness but never blocks a choice", async () => {
  const withProbe = (ms, extra = {}) => make({ ctl: { loadModule: async () => ({ runComputeProbe: async () => ({ ms }) }), ...extra } }).ctl;
  let a = await withProbe(100).advise();
  assert.equal(a.recommended, "kokoro");
  a = await withProbe(VOICE_CONFIG.qualityProbeMaxMs + 50).advise();
  assert.equal(a.recommended, "kitten"); assert.match(a.notes.kokoro, /slow/);
  const slow = withProbe(VOICE_CONFIG.probeMaxMs * 4);
  a = await slow.advise();
  assert.equal(a.recommended, null); assert.match(a.notes.kitten, /slow/); assert.match(a.notes.kokoro, /slow/);
  await slow.init();
  assert.equal((await slow.select("kokoro")).ok, true, "a device the advice calls slow can still choose any voice");
  const ios = withProbe(100, { userAgent: IPHONE, maxTouchPoints: 5 });
  a = await ios.advise();
  assert.equal(a.recommended, "kitten", "on an iPhone only the small voice is recommended"); assert.match(a.notes.kitten, /Safari limits memory/);
});

test("the sample text is a short sentence", () => { assert.ok(SAMPLE_TEXT.length < 80); assert.equal(VOICES.length, 3); });

test("a stale error message is cleared by the next choice and by a successful download", async () => {
  const engine = createFakeVoiceEngine({ failInstall: true });
  const { ctl } = make({ engines: { kitten: engine } });
  await ctl.init();
  await ctl.select("kitten");
  assert.equal(ctl.snapshot().notice.kind, "error");
  engine.install = async () => {};
  await ctl.select("kitten", { confirmed: true });
  assert.equal(ctl.snapshot().notice, null, "the working voice shows no old failure");
  assert.equal(ctl.snapshot().selected, "kitten");
});
