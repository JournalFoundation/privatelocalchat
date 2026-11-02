import test from 'node:test';
import assert from 'node:assert/strict';
import { runComputeProbe, buildDotModule, measureKernel } from '../chat/voice-probe.mjs';

test('the hand-assembled wasm module is valid and computes a dot product', () => {
  const bytes = buildDotModule();
  assert.ok(WebAssembly.validate(bytes));
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  const f = new Float32Array(inst.exports.mem.buffer);
  for (let i = 0; i < 8; i++) { f[i] = i + 1; f[4096 + i] = 2; }
  assert.equal(inst.exports.dot(8, 1), 72);
  assert.equal(inst.exports.dot(8, 3), 216);
  assert.equal(inst.exports.dot(8, 0), 0);
});

test('measureKernel works with wasm and falls back to a JS loop without it', () => {
  const clock = () => performance.now();
  const w = measureKernel(buildDotModule(), 256, 50, 3, clock);
  const j = measureKernel(null, 256, 50, 3, clock);
  assert.equal(w.backend, 'wasm');
  assert.equal(j.backend, 'js');
  for (const r of [w, j]) { assert.ok(Number.isFinite(r.ms) && r.ms >= 0); assert.ok(r.sink); }
});

// A fake worker that answers through the real kernel, like the Blob worker does.
const kernelWorker = (reply) => () => {
  const w = { terminated: false, terminate() { this.terminated = true; }, postMessage(d) { setImmediate(() => w.onmessage({ data: reply(d) })); } };
  return w;
};

test('runComputeProbe returns the worker measurement and terminates the worker', async () => {
  let made;
  const factory = () => (made = kernelWorker((d) => ({ ok: true, ...measureKernel(d.wasm, 256, 20, 2, () => performance.now()) }))());
  const r = await runComputeProbe({ workerFactory: factory });
  assert.ok(Number.isFinite(r.ms) && r.ms >= 0);
  assert.equal(r.backend, 'wasm');
  assert.ok(made.terminated);
});

test('the result is normalised so a slower device reports a larger ms', async () => {
  const run = (ms) => runComputeProbe({ workerFactory: kernelWorker(() => ({ ok: true, ms, backend: 'wasm' })) });
  const [fast, slow] = [await run(100), await run(900)];
  assert.ok(fast.ms < slow.ms);
});

test('a worker that never answers times out with the cap, not a hang', async () => {
  let t = 0;
  const w = { terminated: false, terminate() { this.terminated = true; }, postMessage() {} };
  const r = await runComputeProbe({ workerFactory: () => w, timeoutMs: 80, now: () => (t += 40) });
  assert.deepEqual(r, { ms: 80, backend: 'unknown', timedOut: true });
  assert.ok(w.terminated);
});

test('a result above the cap is clamped to the cap', async () => {
  const r = await runComputeProbe({ timeoutMs: 500, workerFactory: kernelWorker(() => ({ ok: true, ms: 9999, backend: 'js' })) });
  assert.equal(r.ms, 500);
});

test('worker creation failure, worker error and a bad reply all give the cap and never reject', async () => {
  assert.equal((await runComputeProbe({ timeoutMs: 700, workerFactory: () => { throw new Error('no Worker'); } })).ms, 700);
  const errW = () => ({ terminate() {}, postMessage() { setImmediate(() => errW.w.onerror({ message: 'boom' })); } });
  const w = errW(); errW.w = w;
  assert.equal((await runComputeProbe({ timeoutMs: 700, workerFactory: () => w })).ms, 700);
  assert.equal((await runComputeProbe({ timeoutMs: 700, workerFactory: kernelWorker(() => ({ ok: false, error: 'x' })) })).ms, 700);
});
