import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryManager, MEMORY_KEY } from "../runtime/memory-manager.mjs";

const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; }, m }; };
function model(id, { state = "unloaded", busy = false, light = false, failUnload = false } = {}) {
  const r = { id, kind: id, label: id + " label", light, st: state, busy, calls: [], state: () => r.st, isBusy: () => r.busy,
    async unload() { r.calls.push("unload"); if (!failUnload) r.st = "unloaded"; } };
  return r;
}
const fast = { wait: () => new Promise((r) => setImmediate(r)) };

test("the default is keep, and the policy is stored", () => {
  const storage = mem(); const m = createMemoryManager({ storage });
  assert.equal(m.policy, "keep");
  m.setPolicy("one-at-a-time");
  assert.equal(createMemoryManager({ storage }).policy, "one-at-a-time");
  assert.ok(JSON.parse(storage.m[MEMORY_KEY]).policy);
  assert.throws(() => m.setPolicy("automatic"), /unknown memory policy/);
});

test("under keep nothing is unloaded: the app tries what was asked", async () => {
  const m = createMemoryManager({ storage: mem(), ...fast }); const llm = model("llm", { state: "loaded" }), tts = model("tts");
  m.register(llm); m.register(tts);
  const lease = await m.acquire("tts"); lease.release();
  assert.deepEqual(llm.calls, []);
});

test("under one-at-a-time every other model in memory is unloaded first, files are not the manager's business", async () => {
  const m = createMemoryManager({ storage: mem(), ...fast }); m.setPolicy("one-at-a-time");
  const llm = model("llm", { state: "loaded" }), tts = model("tts"), emb = model("emb", { state: "loaded", light: true });
  [llm, tts, emb].forEach((r) => m.register(r));
  const lease = await m.acquire("tts");
  assert.deepEqual(llm.calls, ["unload"]); assert.deepEqual(emb.calls, ["unload"]);
  lease.release();
});

test("a model that is already alone in memory is not touched, and a light model never evicts a heavy one", async () => {
  const m = createMemoryManager({ storage: mem(), ...fast }); m.setPolicy("one-at-a-time");
  const llm = model("llm", { state: "loaded" }), emb = model("emb", { light: true });
  m.register(llm); m.register(emb);
  (await m.acquire("emb")).release();
  assert.deepEqual(llm.calls, [], "the matching model does not push the chat model out");
  (await m.acquire("llm")).release();
  assert.deepEqual(llm.calls, []);
});

test("a busy model is waited for, never unloaded under its feet, and the person is told", async () => {
  const m = createMemoryManager({ storage: mem(), ...fast }); m.setPolicy("one-at-a-time");
  const llm = model("llm", { state: "loaded", busy: true }), tts = model("tts"); m.register(llm); m.register(tts);
  const seen = []; m.subscribe((s) => { if (s.activity) seen.push(s.activity.text); });
  let got = false; const p = m.acquire("tts").then((l) => { got = true; return l; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(got, false); assert.deepEqual(llm.calls, []);
  assert.ok(seen.some((t) => /Waiting for llm label to finish before tts label/.test(t)), seen.join("|"));
  llm.busy = false; await p;
  assert.deepEqual(llm.calls, ["unload"]);
  assert.ok(seen.some((t) => /Unloading llm label to make room for tts label/.test(t)));
  assert.equal(m.snapshot().activity, null, "the message clears");
});

test("a lease keeps a model from being unloaded until it is released", async () => {
  const m = createMemoryManager({ storage: mem(), ...fast }); m.setPolicy("one-at-a-time");
  const a = model("a", { state: "loaded" }), b = model("b"); m.register(a); m.register(b);
  const lease = await m.acquire("a");
  let got = false; const p = m.acquire("b").then(() => { got = true; });
  await new Promise((r) => setTimeout(r, 20)); assert.equal(got, false);
  lease.release(); await p; assert.deepEqual(a.calls, ["unload"]);
});

test("a model that will not unload does not hang the next one: the app goes on and tries", async () => {
  const m = createMemoryManager({ storage: mem(), ...fast }); m.setPolicy("one-at-a-time");
  const stuck = model("stuck", { state: "loaded", failUnload: true }), b = model("b"); m.register(stuck); m.register(b);
  const lease = await m.acquire("b"); lease.release();
  assert.deepEqual(stuck.calls, ["unload"]);
});

test("unloadAll skips busy models; snapshot lists every resident with its state; unregistering removes it", async () => {
  const m = createMemoryManager({ storage: mem(), ...fast });
  const a = model("a", { state: "loaded" }), b = model("b", { state: "loaded", busy: true }); const off = m.register(a); m.register(b);
  assert.equal(await m.unloadAll(), 1); assert.deepEqual(b.calls, []);
  assert.deepEqual(m.snapshot().residents.map((r) => [r.id, r.state, r.busy]), [["a", "unloaded", false], ["b", "loaded", true]]);
  off(); assert.equal(m.snapshot().residents.length, 1);
});

test("declining the offer is remembered", () => {
  const storage = mem(); const m = createMemoryManager({ storage }); m.declineOffer();
  assert.equal(createMemoryManager({ storage }).offerDeclined, true);
});
