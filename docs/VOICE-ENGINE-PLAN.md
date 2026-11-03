# Better voices than the system voice: integrated plan

Status: **planned, not built** (written 2026-11-02). Nothing in this document ships yet. Every number marked *unverified* comes from third-party write-ups and has not been measured by this project.

## Goal

Read-aloud currently uses the operating system's voice (`speechSynthesis`, `chat/speech.mjs`). On devices that can handle it, offer a more natural on-device voice with as little friction as possible. People who cannot run one keep the system voice and never see an offer. This follows the way the app already picks a language model for the device (`runtime/auto-tier.mjs`, `runtime/prepare.mjs`).

## Settled decisions

- **System voice stays the default.** Nothing changes for anyone until they accept an offer.
- **iPhone and iPad always keep the system voice.** Safari hides the device model, and the investigation in `docs/IPHONE-INVESTIGATION.md` shows a hard process memory limit (about 2 GB) that the 2B chat model already nearly fills. No voice model is loaded, offered or downloaded there. Revisit only after a real-phone test and a separate decision.
- **No gated downloads.** Models that need an account or an acceptance step on another site are out for now (this excludes Pocket TTS). Letting people bring their own models is a possible much-later feature.
- **Licences.** Apache-2.0 and MIT are accepted. GPL-3.0 is accepted for the combined app: John Benac, the sole author of the code, chose to relicense. The `LICENSE` file changes from Apache-2.0 to GPL-3.0 in the same commit that first ships a GPL component (espeak-ng), together with the GPL text, the espeak-ng source link and notices beside any hosted copy. Use-restricted (OpenRAIL-M), non-commercial and custom community licences stay excluded.
- **One voice model on disk at a time**, with Unload and Remove in Settings, like the language models.
- **Real-time speech is nice, not required** (owner decision, 2026-11-02). A voice slower than playback is kept if sound starts soon and playback can begin gaplessly after a bearable wait (it buffers ahead). It is rejected only when it is hopelessly slow. The person also hears a sample and decides.

## Principles for every assumption

An assumption is allowed only if it passes one of three tests:

1. **It fails safe.** If it is wrong, the person keeps the system voice and loses nothing. Wrongly not offering a voice is cheap. Loading a model a device cannot hold risks a crash or a full disk.
2. **It was measured at runtime, on that device.**
3. **There is hard evidence for it.** The only one today is the iPhone and iPad memory limit.

We cannot tell an old, busy Android phone from a powerful new Android laptop by platform name, user-agent string or version. Chrome reduces the user agent and rounds and caps `deviceMemory`. So everything outside iOS is decided by measurement.

## How the app decides (three stages)

A pure function next to `pickTier`, for example `pickVoiceEngine({env, userAgent, maxTouchPoints, installed, chosen})`. It returns the system voice or an engine id, plus a reason. A choice the person made always wins. Nothing downloads without a tap.

1. **Cheap gate.** iPhone or iPad: stop, system voice. Otherwise read signals we already collect (`deviceMemory`, `hardwareConcurrency`, WebGPU adapter, `navigator.storage.estimate()`). Too little memory, too few cores or too little free storage: system voice, no offer.
2. **Compute probe, no download.** A fraction-of-a-second benchmark in a worker (for example a small WASM matrix workload). Below the threshold: no offer.
3. **Real measurement after the person opts in and the voice is installed.** Speak a sample and measure the real-time factor (audio seconds divided by synthesis seconds), the time to first audio and the resulting start delay for a typical 20 s reply (`startDelayMs`). Real time is not required, but if sound does not start soon (`maxFirstAudioMs`), the reply would wait too long (`maxStartDelayMs`) or the voice is below `minRealTimeFactor`, switch back to the system voice automatically and remove the files, telling the person.

Then keep watching: the app already detects a stalled read-aloud (`watchSpeech`). The same check applies to the downloaded voice; on a stall or underrun, use the system voice for the rest of the session and remember that for the device.

**Memory next to the chat model.** The voice model loads only when the chat model is idle or after a reply finishes, and only if the chat model's resident size plus the voice leaves headroom. Otherwise the system voice speaks.

**Judging the system voice.** The browser gives no quality measure, only `getVoices()` metadata (name, language, local or network, default). Names such as "Enhanced", "Premium", "Siri" (Apple) or "Natural" (Microsoft) are hints. They may only decide whether it is worth showing the suggestion. They never block or force anything. The real judge is the person: a "Hear a sample" button beside a one-time "keep the system voice / try the better voice" choice.

**Thresholds** (memory, cores, probe score, real-time factor) live in one config file marked *uncalibrated*. Any figure used before calibration, such as 4 GB, 2 cores or 2x real time, is a placeholder.

## Offer and settings (no friction)

- Offer only after a first read-aloud has worked, as one quiet line with the size shown first ("A more natural voice is available, 90 MB, works offline").
- Download with the existing resumable installer, hashes verified, resumable, with stall recovery. Switch over when ready; fall back to the system voice if loading fails.
- Settings gets a card per voice: current engine, size, Unload, Remove and the storage total, plus "Hear a sample".

## Candidate engines

Weights licences were checked on model cards in the earlier research; re-check each at hosting time and record revision and hashes. Sizes and speeds are *unverified* third-party figures.

| Engine | Weights licence | Size (*unverified*) | Notes |
|---|---|---|---|
| Kitten TTS nano 0.8 | Apache-2.0 | about 25 MB (int8) | English only, 8 voices, lowest quality. Needs espeak-ng. |
| Kokoro-82M, q8 | Apache-2.0 | about 90 MB | Best quality of the small models, 54 voices, 8 languages (English strongest). Use WASM with the q8 file. One community export reports wrong output with the fp16 and q4f16 WebGPU variants. |
| Soprano-1.1-80M | Apache-2.0 | 80M parameters | English only. An iOS build is claimed; no phone benchmark found. Evaluate later. |
| Pocket TTS | CC-BY-4.0, gated | about 242 MB | **Excluded for now (gated).** |
| Supertonic 3 | OpenRAIL-M | n/a | **Excluded (use restrictions).** |
| Kitten TTS 2, Chatterbox Turbo, Piper | custom / MIT but too heavy / GPL engine plus per-voice licences | n/a | **Excluded** for size or licence reasons. |

One runtime could cover several engines: sherpa-onnx (Apache-2.0) lists Kokoro, KittenTTS and others with WebAssembly builds; Kokoro also runs through `kokoro-js` on transformers.js. Check what is already vendored for the search model before adding any runtime, and pin anything new in `docs/RUNTIMES.md` with its hash.

## The phonemizer (espeak-ng)

- Kitten lists `espeakng_loader` and `phonemizer` as hard requirements.
- Kokoro in Python (`misaki`, Apache-2.0) uses espeak only as an optional fallback for unknown words.
- `kokoro-js` depends on the npm `phonemizer` package, which describes itself as a text-to-phones converter using eSpeak NG and is labelled Apache-2.0. The label probably covers only the wrapper; the compiled espeak-ng inside is GPL-3.0. **To do:** open the package contents and confirm exactly what it bundles, so the notices are right.
- With the GPL-3.0 decision above, bundling espeak-ng is acceptable. Source link, GPL text and notices must ship with it.

## Hosting on the CDN

The existing publisher (`ops/cloudflare/publish-gguf.py`) is GGUF-specific. Generalise it into one manifest-driven publisher (file names, sizes, SHA-256, source revision, licence file) for ONNX and other files.

- Download each file, check the hash, upload to immutable keys under `models/<name>/<revision>/`, re-read every file over the public URL (hash, CORS, content type).
- `manifest.json` and `LICENSE.txt` beside the weights; list the model in the public `models/catalog.json` index.
- Never replace an existing different object; publish a new key instead (`docs/OPERATIONS.md`).
- Take licences and revisions from primary model cards, not aggregator sites. Follow `docs/CDN-POPULATION.md` and add the new recipe there.

## Test fleet and what each device proves

Facts below were read from the devices on 2026-11-02. Anything not listed is not yet known and is established by the first step of the verification plan.

| Device | Where it is attached | Known facts | Role in this work |
|---|---|---|---|
| iPhone 15 Pro | USB on Boiler, Safari automation bridge | iOS 26.6.2, WebGPU available, about 41 GB browser quota | iOS rule: system voice only. Also the dev-only exploration device (see below). |
| iPhone 11 Pro | USB on Boiler, second Safari automation bridge | iOS 18.6.2, no WebGPU in Safari, about 1 GB quota | The "old iPhone" case. Must stay on the system voice with no offer, no download and no model load. |
| Galaxy S8+ (SM-G955U) | USB on Boiler, `adb` | Android 9, about 3.4 GB RAM, Chrome, Samsung Internet and Firefox installed, data partition almost full (about 490 MB free), battery died several times | The "constrained Android phone" case: tight storage and memory, so it proves the fail-safe paths. |
| Boiler (Linux desktop) | host of the USB devices | Chromium or Chrome and Firefox available. Whether WebGPU works there with flags must be established first | Real-browser desktop lane, GPU and non-GPU. |
| Centroid (this server) | local | Headless Chromium, no GPU (processor path); Playwright WebKit with the iPhone profile | Automated lane: unit tests, headless end-to-end, WebKit/iPhone-profile checks. |
| Mac (Safari, SSH) | SSH | Safari on macOS, with Develop-menu inspector interference known to affect iPhone sessions when it runs | Desktop Safari lane (system voice quality, offer decision). Quit Safari there while the phones are attached to it. |
| Galaxy View tablet (SM-T670) | not detected on Boiler | Android 5.1.1 expected | Optional "very old Android" case if it can be connected. |

## Implementation plan (workstreams)

1. **Voice probe and harness** (dev-only). Inside the `DEV_DIAGNOSTICS` markers: a compute probe, a synthesis real-time-factor and time-to-first-audio harness, and logging through the existing receiver. Output a JSON report per device to `docs/evidence/`. Production builds contain none of it.
2. **Selection function** `pickVoiceEngine` next to `pickTier`, with the three stages and the config of thresholds (marked uncalibrated). Pure and unit-tested.
3. **Publisher and hosting.** Generalise the publisher, host Kitten nano and Kokoro q8 with licences and hashes, list them in `models/catalog.json`, record the recipe in `docs/CDN-POPULATION.md`.
4. **Engine runtime.** A worker that runs the engine, a pinned runtime recorded in `docs/RUNTIMES.md`, hashes verified on every file, resumable download using the existing installer, and espeak-ng with its notices.
5. **Speech integration.** `chat/speech.mjs` routes `speak()` to the system voice or the engine. Stall watchdog applies to both. Automatic fallback is stateful per device and never loops.
6. **Settings and offer.** One quiet offer after a working first read-aloud, a Settings card with size, "Hear a sample", Unload and Remove, and a storage total. One voice model on disk at a time.
7. **Licence and notices.** Switch `LICENSE` to GPL-3.0 in the commit that first ships espeak-ng, with the GPL text, source link and third-party notices. Update the Privacy page and Updates feed.
8. **Docs.** `docs/CHAT-FEATURES.md`, `docs/CDN-POPULATION.md`, `docs/RUNTIMES.md`, `docs/TECHNICAL-DEBT.md`, `CLAUDE.md`.

## Verification plan

Each lane has an exit criterion. A later lane does not start until the earlier one passes, and nothing is offered to the public until every lane passes.

**Lane 0: inventory (before any code).** Record what each device and browser really reports: WebGPU adapter details, `deviceMemory`, cores, storage estimate and quota, installed voices from `getVoices()` (names, languages, local or network). Establish whether Boiler's Chromium and Firefox get a real GPU with flags (`--enable-unsafe-webgpu --enable-features=Vulkan`, `chrome://gpu`, `vulkaninfo`; Firefox Nightly with `dom.webgpu.enabled`). Output: an evidence file per device, no model downloads.

**Lane 1: unit tests (Centroid, `npm test`).**
- `pickVoiceEngine` across a device matrix: iPhone and iPad (always system voice, any memory), old Android, new Android, low-memory desktop, large desktop with and without a GPU, missing `deviceMemory`, quota too small, chosen-by-user override, installed engine present or removed.
- Every stage fails safe: a missing signal means "no offer", never "offer".
- Config: thresholds only from the config file.
- Publisher: manifest validation, refuses to replace a different immutable object.
- Selection never reads the user agent for anything beyond the documented iOS rule.

**Lane 2: automated end-to-end (Centroid, headless).**
- Playwright Chromium on the processor path, and WebKit with the iPhone profile: iPhone profile shows no offer and no voice asset requests at all (checked in the network log).
- Engine download, hash check, synthesis, measurement, Remove: the storage estimate returns to its baseline after Remove.
- Failure injection: stalled download (recovery), interrupted download (resume), wrong hash (refused and cleaned up), quota error, forced-slow synthesis (automatic fallback and file removal), Remove while speaking, engine switch, offline use after install.

**Lane 3: real browsers on Boiler (desktop).**
- Chromium with the WebGPU flags and without: record whether the engine runs on the GPU path or the processor path and the measured real-time factor.
- Firefox stable (expected no WebGPU) and Firefox Nightly with the flag, if worthwhile.
- Full download, synthesise, Remove cycle, with storage checked before and after.

**Lane 4: real phones through the existing automation.**
- *iPhone 11 Pro and iPhone 15 Pro:* verify the system voice is used, no offer is shown, no voice assets are requested, no model is loaded, and storage use is unchanged. This is a negative test and must pass on both.
- *Galaxy S8+:* read the probe result and the offer decision. With about 490 MB free the storage gate must decide correctly; run the full cycle only if the gate allows it, and only with battery at 15% or more. Confirm Remove returns storage to the baseline.
- *Mac Safari:* system voice quality check, offer decision and full cycle.

**Lane 5: dev command channel on the real dev page.** Use the dev remote-control actions (`use-model`, `remove-model`, `state`, plus new voice actions) to drive and read results on devices where Safari automation is not available. Content capture is turned off after each run.

**Lane 6: production checks.** After merge, the same lanes against `privatelocal.chat`, plus `scripts/verify-release.mjs`, and confirmation that production contains no probe or diagnostics code.

**Calibration.** The probe score and real-time factor are logged on every device above. Thresholds are set from those results with a safety margin, and the numbers and the devices behind them go into `docs/evidence/`. Until then, the config stays marked uncalibrated and the offer is off by default behind a dev flag.

**Exploration, not shipping.** The iPhone 15 Pro has WebGPU and plenty of storage. A dev-only spike can measure whether a tiny engine could ever run beside the chat model there. The result is evidence for a future decision. The shipping rule (all iOS keeps the system voice) does not change because of it.

## Acceptance criteria

- iPhone and iPad: system voice only, with no voice asset requests, no downloads, no model loads (verified on both phones).
- Storage after Remove equals the storage before install, within a small tolerance, on every device where the cycle runs.
- Only one voice model is ever on disk; switching engines removes the previous one.
- Every file is verified against its pinned SHA-256 before use; a mismatch is refused and cleaned up.
- A hopelessly slow or stalled engine (below the minimum factor, first sound too late, or an unbearable start delay) falls back to the system voice automatically and removes its files. Slower-than-playback voices that start soon are kept.
- A device that fails any gate is never offered the voice and sees no extra UI.
- Reading aloud works offline after install.
- Production builds contain no probe, diagnostics or remote-control code.
- `LICENSE`, the GPL text, espeak-ng source link and notices are present and match what ships.
- `npm test` and the e2e suites pass; evidence files exist for each lane.

## Device and data safety rules

- Do not clear user browser data on any device. Remove only the files this work installed.
- Check battery (15% or more) and free storage before any download. Never download onto a device that has less free space than the model plus a safety margin.
- Read only the tab or page this work opened; do not list or touch other tabs.
- After each test, remove the installed model, confirm storage is back to baseline, close automation sessions and tunnels, and turn off content capture and remote control on the diagnostics session.
- One automation session per phone, separate session folders, and no overlapping Safari inspector clients (quit Safari on the Mac while phones are attached to it).
- Never commit credentials, receiver URLs, device identifiers or recorded content.

## Parallelism, subagents and batching

Parallel work is used where it is safe and avoided where devices or decisions are shared. The cost is real: every fresh subagent starts with no context, so its brief must be precise, and its results are checked before use.

**Safe to run in parallel (read-only or disjoint)**
- **Lane 0 inventory.** One reader per device (iPhone 15 Pro, iPhone 11 Pro, Galaxy S8+, Mac, Boiler, Centroid). Each writes a small JSON report to `docs/evidence/` and changes nothing on its device.
- **Source verification.** Model cards, licences, revisions and hashes for each candidate engine, and what the npm `phonemizer` package bundles. One lookup each, from primary sources only. The agent that gathers a claim does not also verify it.
- **Independent build pieces on different files**, each in its own git worktree: the selection function and its tests, the generalised publisher, the Settings card. They are merged by hand, then the full suite is run once.
- **Independent review.** After implementation, a fresh reviewer is given the code and the acceptance criteria, not my conclusions.

**Batching**
- Run Lane 1 (the whole device matrix) and Lane 2 (the whole failure-injection set) as single runs.
- Publish all files of one model in one pass: download, hash check, upload, public read-back.
- Collect device facts with one script per device, not many small commands.

**Must stay serial, with one owner**
- **Each phone has one automation owner at a time.** One bridge, its own session folder, no second client. Two agents on one phone is how stale sessions were created.
- **Downloads and storage.** One model download at a time on any device, with the storage check before and after, so the one-model-at-a-time rule holds and the numbers mean something.
- **Calibration runs.** Quiet machines only. No parallel load on Boiler or Centroid while the real-time factor is measured.
- **Decisions.** Licensing, thresholds, wording of the offer, and merge or release choices are made once, by one person.
- **The Galaxy S8+.** Battery at 15% or more, storage checked, one careful operator.
- **Real-device lanes (3 to 5)** run serially, device by device.

**Order of use**
1. Fan out Lane 0 and the source verification.
2. Build in parallel worktrees with disjoint files, merge, run everything once.
3. Run Lanes 3 to 5 serially.
4. Independent review, then Lane 6 on production.

**Checks on delegated work.** Licence findings and numbers returned by any subagent are confirmed against the primary source before they go into this document or into `LICENSE`. Subagents never receive credentials, receiver URLs or device identifiers they do not need, and never run anything that changes a device.

## Rollout

Everything lands on `dev` first. The dev flag keeps the offer hidden until calibration is finished. Merge to `main` only after Lanes 0 to 5 pass, then run Lane 6 on production. The `LICENSE` change ships in the same release as espeak-ng.

## Progress and findings (2026-11-02)

**Done**
- Lane 0 inventory on six browsers across five devices: `docs/evidence/lane0/inventory.json` (read-only, no downloads, voice names omitted).
- Primary-source verification of the candidate files and runtime pieces (two research passes, with the key figures re-checked directly).
- `runtime/voice-pick.mjs` (the three-stage selection rule, every rule failing safe, thresholds in one uncalibrated config) and `tests/voice-pick.test.mjs`.

**Lane 0 results**

| Browser | Cores | Memory reported | WebGPU adapter | shader-f16 | Reference loop |
|---|---|---|---|---|---|
| iPhone 15 Pro, Safari | 4 | hidden | Apple | yes | 19 ms |
| iPhone 11 Pro, Safari | 4 | hidden | none (API absent) | n/a | 53 ms |
| Mac, Safari | 8 | hidden | Apple | yes | 18 ms |
| Galaxy S8+, Chrome (Android 9) | 8 | 4 GB (rounded) | none (API present, no adapter) | n/a | **487 ms** |
| Boiler, Chromium with flags | 12 | 32 GB | NVIDIA (RTX 3060) | **no** | 66 ms |
| Boiler, Chromium default | 12 | 32 GB | none | n/a | 63 ms |
| Centroid, headless Chromium | 16 | 32 GB | none | n/a | 62 ms |
| Centroid, WebKit (iPhone profile) | 8 | hidden | none | n/a | 64 ms |

- The WebGPU flags make a real GPU adapter appear on Boiler; without them there is none. The adapter there does not offer `shader-f16`, so fp16 model variants would not be usable on it.
- Safari reports `hardwareConcurrency` of 4 on both iPhones whatever the chip, and no `deviceMemory`. Cores and memory cannot separate these phones. That is another reason the iOS rule is platform-based.
- The simple reference loop separates the fast Apple chips (about 18 ms) from the iPhone 11 Pro (53 ms) and from the x86 browsers (about 62 to 66 ms), but not usefully between desktop and old phone. It is only a placeholder probe. A better probe (a small WASM workload, run in a worker) is part of workstream 1.
- **Galaxy S8+ (read at 8% battery, read-only):** the reference loop took 487 ms, 7 to 25 times slower than every other device, so even this crude probe separates it clearly. Chrome reported zero voices (the page may have been in the background; to be re-read in the foreground).
- **Chrome's storage estimate cannot be trusted on a phone.** It reported a 34 GB quota while the data partition had about 430 MB free: the quota is a share of total disk. `pickVoiceEngine` therefore never accepts the estimate alone on mobile. It requires `storage.writeOk`, the result of really writing the download size plus a margin to private storage and deleting it again (workstream 1 builds that check). Without it the answer is "storage-unverified" and nothing is offered.
- The Mac's Safari already holds about 5 GB of browser storage for `privatelocal.chat` from earlier model testing. Nothing was cleared.

**Verified source facts**
- **Kokoro (ONNX):** `onnx-community/Kokoro-82M-v1.0-ONNX`, not gated, labelled Apache-2.0, repository commit `1939ad2a8e41`. `onnx/model_quantized.onnx` is 92,361,116 bytes, SHA-256 `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478`. There are 54 voice files of about 522 KB each. Neither repository has a LICENSE file; the cards state the licence. The original card also names CC-BY training audio and synthetic audio from closed providers, so record that in the notices.
- **Kitten nano 0.8:** `KittenML/kitten-tts-nano-0.8` now redirects to `kitten-tts-nano-0.8-fp32`. The int8 repository is `KittenML/kitten-tts-nano-0.8-int8`; its model is 24,369,971 bytes (SHA-256 starts `f7b0afcb`) and `voices.npz` is 3,278,902 bytes. Not gated, Apache-2.0 on the cards. The fp32 repository changed on 2026-10-30, so pin a commit at hosting time.
- **Phonemizer:** the npm `phonemizer` 1.2.1 (Apache-2.0 label) embeds a JavaScript build of espeak-ng and its data in a single 1.3 MB file, and ships no GPL text. Kokoro in the browser (`kokoro-js` 1.2.1) depends on it; Kitten's code uses `phonemizer` and `espeakng_loader` (both GPL-3.0). With the GPL-3.0 decision, shipping espeak-ng is acceptable if we also ship the GPL text, the source link and notices.
- **`kokoro-js` voices:** the voice base URL is hard-coded to Hugging Face and cannot be configured, so we host the voice files on the CDN and load them ourselves (or patch the library).
- **Runtime already in the repo:** `chat/vendor/embedding/worker.js` bundles transformers.js 4.2.0 and ONNX Runtime 1.26.0-dev, loaded by `chat/embedder.mjs` and redirected to our CDN by `ops/embedding/model-env.mjs`. Its pinned hashes are in `docs/EMBEDDINGS.md`. It is older than `onnxruntime-web` 1.31.1 and has no WebGPU build hosted. `kokoro-js` declares transformers.js 3.5.x, so it may need adapting.

**Spike result (2026-11-02): Kokoro q8 runs in a browser, but below real time on CPU.** `docs/evidence/voice/kokoro-wasm-spike.json`. In headless Chromium on Centroid (16 cores, no GPU, cross-origin isolated) through `kokoro-js` and transformers.js, the WASM backend produced valid 24 kHz audio, loading in about 10 s once cached. A warm 4.9 s sentence took 8.8 s with one thread (real-time factor 0.56) and 5.8 s with eight threads (0.86). Even a fast desktop CPU cannot stay ahead of playback, so:
- Real time is not required, so Kokoro is allowed on a real GPU adapter or a desktop-class CPU (probe at or below `qualityProbeMaxMs`), where it would run at 0.5 to 0.9 times playback speed with buffering. A slower CPU gets the small voice or the system voice.
- The small voice (Kitten nano, designed for CPU) is the main candidate for everyone else. It has not been run yet: its next spike must prove it runs under ONNX Runtime Web and measure its real-time factor. If it also falls short, the honest result is that most devices keep the system voice.
- Kokoro on the GPU path is still untested (Boiler's RTX 3060 adapter lacks `shader-f16`, so only the fp32 variant could run there, and one community export reports wrong output on fp16 WebGPU).

**Spike result (2026-11-02): Kitten nano int8 runs in browsers on every device class tried.** `docs/evidence/voice/kitten-wasm-spike.json`. Same sentence (6.67 s of speech), warm second generation, ONNX Runtime Web WASM, files served from a local test server:

| Device / browser | Reference loop | Threads | Real-time factor | Notes |
|---|---|---|---|---|
| Mac, Safari | 18 ms | 4 | **3.95** | load 24 s was my SSH tunnel moving 24 MB |
| Centroid, Chromium (16 cores, no GPU) | 62 ms | 1 / 4 | 2.0 / 2.75 | load about 1.3 s |
| Centroid, WebKit | 64 ms | 4 | 2.52 | |
| Boiler, Chromium (with and without GPU flags) | 66 ms | 1 / 4 | 1.87 / 2.6 | the GPU flags change nothing for this CPU model |
| Brutus, Firefox 156 (4-core Intel N100) | not collected | 2 / 4 | 1.54 / 1.59 | weak desktop CPU |
| Galaxy S8+, Chrome 10 (8 cores, 4 GB) | 487 ms | 4 | **0.26** | 25.5 s to make 6.7 s of speech; load 7.9 s |

The probe ordering is consistent with the real results (lower ms, faster voice). The S8+ would wait more than a minute for 20 s of speech, so it is rejected by the "hopelessly slow" test while the N100 desktop is accepted. **Correction:** these factors were measured with a tokenizer bug (see below) that made the model input about 1.5 times longer, so they are slightly pessimistic and must be re-measured with the corrected pipeline.

**Intelligibility (2026-11-02): fixed, then verified.** The first independent check (Whisper, `docs/evidence/voice/kitten-intelligibility.json`) found the spike's speech unintelligible (mean word error rate about 1.0). Kitten's own Python reference on the same model files scored 0.12, so the model was fine and the browser port had three bugs: (1) JavaScript's `\\w` is ASCII only, so every IPA symbol became its own token with a space between sounds (use `/[\\p{L}\\p{N}_]+|[^\\p{L}\\p{N}_\\s]/gu`); (2) the npm phonemizer drops punctuation which the model expects (phonemize the pieces between punctuation and put it back); (3) the reference works one punctuated chunk at a time with the style row chosen by chunk length, and whole-text input of long text fails. With these fixed, 6 of 7 chunks produce token ids identical to the reference (the seventh differs in one vowel because the browser espeak-ng build is older), Whisper recovers the sentences with a mean word error rate of 0.10, and a five-sentence paragraph works when chunked. The reference ids are saved as `tests/fixtures/kitten-golden-ids.json`. Numbers and abbreviations are not expanded by this pipeline (the reference has a text preprocessor for that); "24" and "365" are spoken correctly only when written as words in these tests, so number expansion is a gap to close.

**Unverified (do not rely on)**
- That the Kitten int8 and Kokoro q8 files run under ONNX Runtime Web (WASM). This is the first thing the Lane 2 spike must prove.
- Separate licences of the voices, tokenizer and config files, and Kitten's training-data licences.
- Whether espeak-ng's data files carry licences other than GPL-3.0.

## Rollout status: complete (2026-11-02)

**State: shipped and verified.** Both voice tiers, the selection rule, the measurement modules, the Settings card, the dev command channel actions and the GPL-3.0 relicence are live on `dev` and on production (`privatelocal.chat`, commit `ca2d90d`). Nothing from this plan is outstanding.

| Lane | Final result |
|---|---|
| 0 Inventory | Done: seven browser runs across five devices (`docs/evidence/lane0/inventory.json`). |
| 1 Unit tests | 895 pass, including the device matrix, the real Galaxy S8+ numbers, the reference token ids for both voices and the 517-case text pre-processor corpus. |
| 2 Automated end to end | Both engines install from the intercepted CDN files, speak, read back correctly through an independent recogniser (Kitten word error rate 0.10, Kokoro 0.0), and remove with storage back to baseline; the offer flow, a stalled worker and a failing voice are covered. |
| 3 Real desktop browsers | Centroid and Boiler Chromium and the Mac's Safari are offered Kokoro (2.0 to 2.3 times real time, first sound 1.0 to 1.3 s); the weak N100 desktop's Firefox is offered Kitten (3.2 times). All install from the CDN and remove cleanly (`docs/evidence/voice/lane-results.json`, `lane-results-kokoro.json`). |
| 4 Real phones | iPhone 11 Pro and iPhone 15 Pro, on dev and on production: `ios-system-voice-only`, no offer, no voice engine, probe, storage check, worker or runtime file requested (the 15 Pro has WebGPU and a 41 GB quota). Galaxy S8+: declined by the probe (about 2,000 to 4,000 ms against the 800 ms limit; Kitten ran at 0.26 times there). |
| 5 Dev command channel | `voice-state`, `voice-decide` and `voice-cycle` work through the real command path for both voices; the cycle only runs when the device's own decision is an offer. |
| 6 Production | `verify-release` passes; the live page contains no test hook or debug code; the debug receiver route does not exist (404); the real Kokoro voice installs from the CDN and speaks on the live site. |

**Independent review.** A fresh reviewer read the whole diff. Both blockers (a stall watchdog too short for slow voices, and a worker that never recovered) and the main should-fix items were fixed before release; the remainder are technical debt items 47 to 52.

**Decisions made**
- Real-time speech is nice, not required (owner). Slower voices are kept when sound starts soon and the wait is bearable.
- Licence: GPL-3.0-only for the combined app because of eSpeak NG (owner). The bundles carry their own GPL notice, `THIRD-PARTY-NOTICES.md` lists every component, and the Kokoro model card's training-data attribution is stored with its licence text.
- Kokoro is built as the plan's second tier (q8 on WebAssembly, 96.5 MB). The larger fp32 GPU variant (326 MB, 6.7 times real time on an RTX 3060, word error rate 0.0; `docs/evidence/voice/kokoro-webgpu-spike.json`) was measured and deliberately not built.
- The five commits under the placeholder identity "Your Name" look like automated work on the owner's behalf (same days as 66 owner commits, repository full of Codex branches); no outside author appears in the history.
- `qrcode.js` is byte-identical to upstream's MIT-licensed file; its licence text sits beside it.
- Galaxy S8+ storage: with the owner's approval the `dev.privatelocal.chat` origin was cleared on the phone; it held 3.9 MB and free space moved 288 to 290 MB, so the earlier drop was not caused by the test files (each run removed what it installed).

## Open items

None for this plan.

Possible future work, outside it (see the technical debt list, items 41 to 52, for detail):
- The fp32 GPU variant of Kokoro, if a 326 MB opt-in download is ever wanted.
- Languages beyond English (Kokoro covers several; the small engine is English only).
- Whether a tiny engine could ever fit on iPhone beside the chat model (a dev-only spike on the iPhone 15 Pro first; the shipping rule for iOS stays as it is until then).
- Soprano-class models, and Pocket TTS while its download remains gated.

## Sources (from the earlier research; check again when hosting)

Model cards and repositories: Kokoro-82M and its ONNX build, KittenTTS and the nano 0.8 card, Soprano-1.1-80M, Pocket TTS and the Kyutai voices licences, Supertonic 3, Piper voices and piper1-gpl, sherpa-onnx and its TTS docs; a roundup of local TTS models (yaps.ai, 10 Oct 2026) and an on-device TTS benchmark (Picovoice, 2026). The benchmark ran on a desktop in Python, so its figures are indicative only.

## Measurement modules

The two real measurements that `runtime/voice-pick.mjs` consumes. Both are plain browser modules with injectable dependencies, never reject, and fail safe (a failure reads as "slow" or "no space", so the person keeps the system voice). Neither contains diagnostics.

- **`chat/voice-probe.mjs`, `runComputeProbe({workerFactory, now, timeoutMs})` returns `{ms, backend, timedOut?, error?}`.** Stage 2. Runs in an inline Blob Web Worker so the page never blocks. The workload is repeated 4096-float dot products (the inner loop of neural-network inference) in a hand-assembled WebAssembly module (`buildDotModule`, no toolchain), with an equivalent typed-array JS loop when WebAssembly is missing (`backend: "js"`). A short warm-up, then 5 timed chunks; `ms` is the median chunk scaled to the whole workload, so lower is faster. About 140 to 160 ms on the 16-core Centroid desktop (headless Chromium, wasm) and about 410 to 480 ms for the JS fallback. A hard timeout (default 4000 ms) terminates the worker and reports the cap, so a very slow device returns a large `ms` instead of hanging. This replaces the old plain-JS reference loop (18 ms Mac and iPhone 15 Pro, 53 ms iPhone 11 Pro, 62 to 66 ms x86, 487 ms Galaxy S8+), so `probeMaxMs` in the config must be recalibrated on the new scale; it is still uncalibrated.
- **`chat/storage-check.mjs`, `checkStorage({bytes, margin = 64 MB, storage})` returns `{usage, quota, writeOk}`.** Stage 1 on mobile. Reads `navigator.storage.estimate()` (`usage` and `quota` are `null` when unavailable) and really writes `bytes + margin` of fresh random data in 4 MB chunks to a temporary OPFS file, then always deletes it in a `finally` path. `writeOk` is true only if the whole write and the delete succeeded; a `QuotaExceededError`, missing OPFS or any failure gives false. Temporary files named `plc-storage-check-*` left by earlier aborted runs are removed first, and nothing else in OPFS is touched. It exists because Chrome on Android reported a 34 GB quota on a phone with about 430 MB free.

Tests: `tests/voice-probe.test.mjs`, `tests/storage-check.test.mjs` (fakes, in `npm test`) and `tests/e2e/voice-measure.e2e.mjs` (real headless Chromium: finite probe, `writeOk` true, a mid-write quota error, and OPFS files back to baseline).
