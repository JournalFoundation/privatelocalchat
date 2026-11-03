// Bundle the voice workers (worker.js for Kitten, worker-kokoro.js for Kokoro) into chat/vendor/voice/ and copy the ONNX Runtime Web files it needs (plain SIMD threaded build only).
//   cd ops/voice && npm ci --ignore-scripts && cd ../.. && node ops/voice/build-worker.mjs
// esbuild is a dev dependency of ops/voice only; nothing in the app runtime imports it. Prints the SHA-256 of every produced file, which
// docs/VOICE-RUNTIME.md records. The build is deterministic for the pinned versions (ops/voice/package-lock.json).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nm = process.env.VOICE_NODE_MODULES || path.join(here, "node_modules");
if (!fs.existsSync(path.join(nm, "esbuild"))) throw new Error(`no esbuild in ${nm}: run "npm ci --ignore-scripts" in ops/voice first`);
const out = path.join(here, "../../chat/vendor/voice");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const { build } = await import(pathToFileURL(path.join(nm, "esbuild/lib/main.js")).href);
const common = {
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, treeShaking: true, legalComments: "linked",
  nodePaths: [nm],
  // the variant of onnxruntime-web that loads its WASM files from wasmPaths instead of inlining the loader
  conditions: ["onnxruntime-web-use-extern-wasm"],
  external: ["node:*", "fs", "path", "worker_threads", "os", "crypto"],
  logLevel: "info",
};
// the bundles contain GPL code, so they say so themselves (the minifier would otherwise drop every notice)
await build({
  ...common,
  entryPoints: [path.join(here, "worker.src.mjs")],
  outfile: path.join(out, "worker.js"),
  banner: { js: "/*! chat/vendor/voice/worker.js bundles eSpeak NG (GPL-3.0-or-later, https://github.com/espeak-ng/espeak-ng, via the npm package phonemizer 1.2.1), ONNX Runtime Web (MIT) and fflate (MIT). Private Local Chat is released under the GNU General Public License v3; see LICENSE and THIRD-PARTY-NOTICES.md. Rebuild: docs/VOICE-RUNTIME.md */" },
});
await build({
  ...common,
  entryPoints: [path.join(here, "worker-kokoro.src.mjs")],
  outfile: path.join(out, "worker-kokoro.js"),
  banner: { js: "/*! chat/vendor/voice/worker-kokoro.js bundles eSpeak NG (GPL-3.0-or-later, https://github.com/espeak-ng/espeak-ng, via the npm package phonemizer 1.2.1) and ONNX Runtime Web (MIT), and ports the text pipeline of kokoro-js (Apache-2.0). Private Local Chat is released under the GNU General Public License v3; see LICENSE and THIRD-PARTY-NOTICES.md. Rebuild: docs/VOICE-RUNTIME.md */" },
});

const dist = path.join(nm, "onnxruntime-web/dist");
for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) fs.copyFileSync(path.join(dist, f), path.join(out, f));

const read = (p) => JSON.parse(fs.readFileSync(path.join(nm, p, "package.json"), "utf8"));
const ort = read("onnxruntime-web"), phonemizer = read("phonemizer"), fflate = read("fflate");
fs.writeFileSync(path.join(out, "VERSIONS.json"), JSON.stringify({
  onnxruntimeWeb: ort.version, onnxruntimeLicense: ort.license,
  phonemizer: phonemizer.version, phonemizerLicense: phonemizer.license, phonemizerEmbeds: "espeak-ng (GPL-3.0)",
  fflate: fflate.version, fflateLicense: fflate.license,
  model: "KittenML/kitten-tts-nano-0.8-int8", modelLicense: "Apache-2.0",
}, null, 2) + "\n");

fs.writeFileSync(path.join(out, "VERSIONS-kokoro.json"), JSON.stringify({
  onnxruntimeWeb: ort.version, onnxruntimeLicense: ort.license,
  phonemizer: phonemizer.version, phonemizerLicense: phonemizer.license, phonemizerEmbeds: "espeak-ng (GPL-3.0)",
  pipelinePortedFrom: "kokoro-js 1.2.1 (Apache-2.0)",
  model: "onnx-community/Kokoro-82M-v1.0-ONNX (model_quantized.onnx)", modelLicense: "Apache-2.0",
}, null, 2) + "\n");

for (const f of fs.readdirSync(out).sort()) {
  const bytes = fs.readFileSync(path.join(out, f));
  console.log(`${crypto.createHash("sha256").update(bytes).digest("hex")}  ${bytes.length}  ${f}`);
}
