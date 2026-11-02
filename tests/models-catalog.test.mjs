import test from "node:test";
import assert from "node:assert/strict";
import { TIERS, TIER_ORDER, tierFiles, loadConfigFor, isWllamaTier, resolveSources, OFFICIAL_SOURCES } from "../runtime/providers/catalog.mjs";
import { pickTier } from "../runtime/auto-tier.mjs";
import manifest from "../ops/cloudflare/gguf-models.json" with { type: "json" };

const CDN = "https://assets.privatelocal.chat/models/";

test("LFM2.5 and Granite are catalogued tiers served only from the project CDN", () => {
  assert.deepEqual(TIER_ORDER, ["default", "light", "lfm", "granite"]);
  for (const t of ["lfm", "granite"]) {
    assert.ok(isWllamaTier(t));
    const files = tierFiles(t);
    assert.ok(files.length >= 6);
    assert.ok(files.every((f) => f.url.startsWith(CDN) && /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0 && f.scope === "opfs"));
    assert.equal(files.reduce((n, f) => n + f.bytes, 0), TIERS[t].downloadBytes);
    const cfg = loadConfigFor(t, { backend: "cpu" });
    assert.equal(cfg.adapter, "wllama"); assert.equal(cfg.modelUrl, files[0].url); assert.match(files[0].path, /00001-of-000\d\d\.gguf$/);
    assert.equal(cfg.context.n_gpu_layers, 0); assert.equal(cfg.context.fused_gdn_auto, undefined);
    assert.ok(TIERS[t].sampling.temperature > 0 && TIERS[t].sampling.temperature <= 0.5);
  }
  assert.equal(loadConfigFor("light", { backend: "gpu" }).context.fused_gdn_auto, true);
});

test("the repository manifest and the catalogue agree on every file", () => {
  for (const [key, tier] of [["lfm25_2_6b_q3", "lfm"], ["granite40_h_1b_q4km", "granite"]]) {
    const m = manifest[key], files = tierFiles(tier);
    assert.equal(m.files.length, files.length);
    m.files.forEach((f, i) => { assert.equal(files[i].path, f.path); assert.equal(files[i].sha256, f.sha256); assert.equal(files[i].bytes, f.bytes); });
    assert.ok(files[0].url.includes(m.prefix));
  }
});

test("a tier base can be overridden explicitly and the label says so", () => {
  const r = resolveSources({ wllamaTierBase: { lfm: "https://example.test/lfm" } });
  assert.equal(r.sources.wllamaTierBase.lfm, "https://example.test/lfm/");
  assert.equal(r.sources.wllamaTierBase.granite, OFFICIAL_SOURCES.wllamaTierBase.granite);
  assert.equal(r.overridden, true);
});

const gpu = { webgpu: { available: true, shaderF16: true }, wasm: { available: true, simd: true }, deviceMemoryGB: 16 };
test("a model the person chose is honoured, on the GPU and on the processor; nothing picks it for them", () => {
  assert.equal(pickTier({ env: gpu, selection: { tier: "lfm", chosenBy: "human" } }).tier, "lfm");
  assert.equal(pickTier({ env: gpu, selection: { tier: "granite", chosenBy: "human" } }).tier, "granite");
  assert.equal(pickTier({ env: gpu, installed: { granite: true }, selection: { tier: "light", chosenBy: "default" } }).tier, "granite");
  const cpu = { webgpu: { available: false }, wasm: { available: true, simd: true }, deviceMemoryGB: 16 };
  const c = pickTier({ env: cpu, selection: { tier: "lfm", chosenBy: "human" } });
  assert.deepEqual([c.tier, c.backend], ["lfm", "cpu"]);
  assert.equal(pickTier({ env: gpu, selection: { tier: "light", chosenBy: "default" } }).tier, "default");
  assert.equal(pickTier({ env: { ...gpu, deviceMemoryGB: 4 }, selection: { tier: "light", chosenBy: "default" } }).tier, "light");
});

import { createThinkFilter, stripEmptyThink } from "../runtime/providers/think.mjs";
test("empty think blocks in a row are removed, streamed in any split, and real reasoning is kept", () => {
  const run = (parts) => { const f = createThinkFilter(); return parts.map((p) => f.push(p)).join("") + f.flush(); };
  assert.equal(run(["<think></think><think></think>ready"]), "ready");
  assert.equal(run(["<th", "ink></th", "ink><think>", "</think>\n", "ready ", "now"]), "ready now");
  assert.equal(run(["\nThe capital"]), "\nThe capital");
  assert.equal(run(["<think>real thought</think>answer"]), "<think>real thought</think>answer");
  assert.equal(stripEmptyThink("<think>\n\n</think>\n\nhi"), "hi");
  assert.equal(run(["<think></think>"]), "");
  assert.equal(run(["<think>", "</think>", "<think>", "</think>", "ready"]), "ready");
  assert.equal(run(["<think></think>\n", "\nready"]), "ready");
});
