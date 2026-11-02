import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import voice from "../ops/cloudflare/voice-models.json" with { type: "json" };
import gguf from "../ops/cloudflare/gguf-models.json" with { type: "json" };

const dir = new URL("../ops/cloudflare/", import.meta.url);

test("every voice model file has a path, a byte count and a SHA-256, and the totals add up", () => {
  for (const [key, m] of Object.entries(voice)) {
    assert.ok(m.files.length > 0, key);
    const paths = new Set();
    for (const f of m.files) {
      assert.ok(typeof f.path === "string" && f.path && !f.path.includes("/") && !f.path.includes(".."), f.path);
      assert.ok(Number.isInteger(f.bytes) && f.bytes > 0, f.path);
      assert.match(f.sha256, /^[0-9a-f]{64}$/, f.path);
      assert.ok(!paths.has(f.path), "duplicate " + f.path);
      paths.add(f.path);
    }
    assert.equal(m.files.reduce((n, f) => n + f.bytes, 0), m.model.totalBytes, key);
  }
});

test("prefixes are unique across all published sets and end in a pinned revision directory", () => {
  const prefixes = [...Object.values(voice), ...Object.values(gguf)].map((m) => m.prefix);
  assert.equal(new Set(prefixes).size, prefixes.length);
  for (const p of Object.values(voice).map((m) => m.prefix)) {
    assert.match(p, /^models\/[A-Za-z0-9._-]+\/[0-9a-f]{40}\/$/);
  }
});

test("no entry points at another project's host; the source is Hugging Face at a pinned commit", () => {
  for (const [key, m] of Object.entries(voice)) {
    const text = JSON.stringify(m);
    assert.ok(!/techofourown|sonalon/i.test(text), key);
    const url = new URL(m.sourceBase);
    assert.equal(url.hostname, "huggingface.co");
    assert.ok(url.pathname.includes("/resolve/" + m.model.sourceRevision + "/"), key);
    assert.ok(m.prefix.endsWith(m.model.sourceRevision + "/"), key);
    assert.ok(!m.prefix.includes("://"));
  }
});

test("Kitten TTS nano int8 pins the real hashes and records the licence split", () => {
  const m = voice.kitten_nano_int8;
  const by = Object.fromEntries(m.files.map((f) => [f.path, f]));
  assert.equal(by["kitten_tts_nano_v0_8.onnx"].bytes, 24369971);
  assert.ok(by["kitten_tts_nano_v0_8.onnx"].sha256.startsWith("f7b0afcbee92"));
  assert.equal(by["voices.npz"].bytes, 3278902);
  assert.equal(by["config.json"].bytes, 688);
  assert.equal(m.licenseName, "Apache-2.0");
  assert.match(m.note, /espeak-ng/);
  assert.match(m.note, /GPL-3\.0/);
  assert.equal(m.prefix, "models/Kitten-TTS-Nano-0.8-int8/84781d74e29ee25217551556398b42f80593a813/");
});

test("each licence file exists and names the model and Apache-2.0", () => {
  for (const [key, m] of Object.entries(voice)) {
    const url = new URL(m.licenseFile, dir);
    assert.ok(existsSync(url), key);
    const text = readFileSync(url, "utf8");
    assert.match(text, /KittenML\/kitten-tts-nano-0\.8-int8/);
    assert.match(text, /Apache License/);
  }
});
