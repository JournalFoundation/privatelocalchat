# Voice runtime: on-device text-to-speech engine (Kitten TTS nano 0.8 int8)

Status: engine module only. Nothing in the app calls it yet (`chat/speech.mjs` and the shell are untouched). The plan is `docs/VOICE-ENGINE-PLAN.md`.

## Parts

| File | What it is |
|---|---|
| `chat/voice-engine.mjs` | Main-thread client: `createVoiceEngine({baseUrl, fetchImpl, workerUrl, manifest?})` returning `{status, install, remove, load, unload, speak, sample}`. |
| `chat/voice-kitten.mjs` | Pure Kitten pipeline pieces (symbol table, tokenizer, chunking, npy/npz parsing, voice/speed/style/trim). Node-testable. |
| `chat/voice-manifest.mjs` | Pinned names, sizes and SHA-256 of the three model files. |
| `chat/vendor/voice/` | The bundle: `worker.js`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`, `VERSIONS.json`, `worker.js.LEGAL.txt`. |
| `ops/voice/` | `package.json` + `package-lock.json` (pinned build inputs), `worker.src.mjs`, `build-worker.mjs`. |
| `tests/voice-engine.test.mjs`, `tests/e2e/voice-engine.e2e.mjs` | Unit tests (plain node) and the real-browser test with the real model. |

## API

- `status()` (async) -> `{id, installed, bytes, totalBytes, loaded, loading, installing}`. `installed` is true only when the marker file exists and every file has its pinned size.
- `install(onProgress)` downloads the three files from `baseUrl`, streams each through SHA-256 while writing it to OPFS directory `plc-voice-kitten-nano-0.8`, and refuses a size or hash mismatch (`error.code === "hash-mismatch"`), deleting the directory. Transient HTTP/network failures are retried with `runtime/providers/download-retry.mjs`. The progress callback gets `{file, loaded, total, overallLoaded, overallTotal}`. A marker file is written last.
- `load()` / `unload()` start and stop the worker (the model session). `remove()` unloads and deletes the directory.
- `speak(text, {onChunk, signal, speed, voice})` -> `{audioSeconds, synthSeconds, realTimeFactor, firstAudioMs, chunks}`. `onChunk({samples: Float32Array, sampleRate: 24000, index, count, text})` fires as each chunk is ready. One speak runs at a time. `voice` is an id or alias from `config.json` (default `Leo`); `speed` is multiplied by the voice's `speed_priors`.
- `sample()` speaks a fixed sentence and also returns the joined `audio`.

## Pipeline (matches the proven spike and KittenTTS 0.8)

text -> `chunk_text` (split at `.!?`, which are dropped; up to 400 characters, longer sentences packed by words; a comma is appended unless the chunk ends in `.!?,;:`) -> per chunk: split at punctuation `; : , . ! ? ¡ ¿ — … " « » " "`, phonemize each non-punctuation piece alone with `phonemize(piece, "en-us")` and put the marks back after the preceding word (the npm phonemizer drops punctuation, the reference uses `preserve_punctuation=True`) -> tokens `[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]` joined by single spaces (Unicode-aware: JavaScript's `\w` is ASCII only, which split every IPA sound into its own token and made the speech unintelligible) -> symbol index (178 symbols; unknown dropped) -> `[0, ...ids, 0]` int64 -> style row `min(len(chunk), rows-1)` of the voice, using the CHUNK length -> speed = speed x prior -> ONNX run -> drop the last 5000 samples -> 24 kHz float32. Synthesis is always one chunk at a time (whole-text inference fails in ORT).

Checked against KittenTTS's Python reference: `tests/fixtures/kitten-golden.json` holds reference phonemes and ids; the reference phonemes give identical ids for all 7 chunks and the npm phonemizer gives identical ids for 6 of 7 (it says `foːɹ` for "four" where the Python espeak build says `fɔːɹ`). The e2e output, transcribed with Whisper tiny.en, read back "The capital of France is Paris. This is a short test of on-device speech." (set `VOICE_WAV_OUT=/path.wav` to keep the audio).

## Limitations

- English only. Number and abbreviation expansion (KittenTTS `clean_text`) is not ported: "3" and "Dr." reach the phonemizer as written.
- Installing needs `FileSystemFileHandle.createWritable()` (Chromium, Firefox, Safari 26+). No fallback yet.
- The ORT WASM files in `chat/vendor/voice/` are excluded from the service worker's precache (`scripts/build.mjs`): they are cached on first use, not at install, so offline speech needs one online use of the worker first.
- The `.onnx`, `voices.npz` and `config.json` are not hosted yet; `baseUrl` must point at a host that sends CORS and (under COEP) usable cross-origin headers. Hosting and the Hugging Face revision pin are still to do (`docs/CDN-POPULATION.md`).
- Threads: the worker uses up to 4 WASM threads when the page is cross-origin isolated, otherwise 1.
- No telemetry of any kind. The worker has no network access beyond loading its own bundle files; text never leaves the page.

## Rebuilding the bundle

    cd ops/voice && npm ci --ignore-scripts && cd ../.. && node ops/voice/build-worker.mjs

esbuild is a dev dependency of `ops/voice` only; the app imports none of the npm packages at run time (they are bundled into the worker). The script prints a SHA-256 line per produced file.

## Pinned inputs

| Package | Version | Licence |
|---|---|---|
| `onnxruntime-web` | 1.31.1 (plain SIMD threaded build only; `onnxruntime-web/wasm` with the extern-wasm condition) | MIT |
| `phonemizer` | 1.2.1 (wrapper labelled Apache-2.0; embeds a JavaScript build of espeak-ng and its data, GPL-3.0, no GPL text shipped inside the package) | Apache-2.0 + GPL-3.0 inside |
| `fflate` | 0.8.3 | MIT |
| `esbuild` (build only) | 0.28.2 | MIT |

## Produced files (SHA-256)

| File | Bytes | SHA-256 |
|---|---|---|
| `chat/vendor/voice/worker.js` | 1386350 | `ad72533abb313357a04e0c6f3a3863170a998cf87e703f8646f425374db8d755` |
| `chat/vendor/voice/ort-wasm-simd-threaded.mjs` | 24738 | `30ed0b5cd1182ede931fea448afb567d4dc705ec957af09f108a2be5f770dac3` |
| `chat/vendor/voice/ort-wasm-simd-threaded.wasm` | 14848852 | `4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d` |
| `chat/vendor/voice/worker.js.LEGAL.txt` | 211 | `4054729dc1c74b457924965c7c26c781629a3968bfbdc80ab01eded2338a24d1` |
| `chat/vendor/voice/VERSIONS.json` | 298 | `5557f55d6153746d99be28842921f86181c0c50c5e8cd38b2aa8352ed1d7220a` |

## Model files (Kitten TTS nano 0.8 int8, `KittenML/kitten-tts-nano-0.8-int8`, Apache-2.0 on the card)

| File | Bytes | SHA-256 |
|---|---|---|
| `kitten_tts_nano_v0_8.onnx` | 24369971 | `f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc` |
| `voices.npz` | 3278902 | `8aa7cee235abb0739cb51e6559685f65a4dacd95568833d05699b1633f519b3f` |
| `config.json` | 688 | `b66006ccbeccd4de5fc3c9272059c47f5725df7215fd889785c03602652fab64` |

## Licensing note

The bundle contains espeak-ng (GPL-3.0). Per the plan, the repository `LICENSE` changes to GPL-3.0, with the GPL text, the espeak-ng source link and notices, in the commit that first ships this to users. This change only adds the module; it is not wired into the app.

## Measured (headless Chromium on Centroid, 16 cores, no GPU)

Short two-sentence text, 7.9 s of audio: real-time factor 2.3 to 5.8 (varies by run), first audio 0.6 to 1.0 s, 4 threads. One machine, not a calibration.
