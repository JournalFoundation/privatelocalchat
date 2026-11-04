# Really small models for the Galaxy S8+ and the iPhone 11 Pro

Started 2026-11-03. **Status: models published and verified on desktop; phone verification in progress** (see the log).

## Why

The smallest model was 901 MB (Granite 4.0 H 1B), the 2B Qwen is 1.2 GB. The S8+ has about 430 MB of free storage and no usable GPU adapter; the iPhone 11 Pro has no WebGPU and about 1 GB of browser quota, and the app refuses CPU models on iPhone and iPad (memory limit). Neither phone could run any model.

## What was decided, and why

- **Licence first.** Policy (memory `licence-policy-apache-open-source`): Apache-2.0 and MIT are accepted; custom licences are not without the owner's say-so. An outside suggestion put Gemma 3 270M first, but its licence is the Gemma terms (custom), and Falcon-H1-Tiny and LFM2.5-350M are "other" licences. **Not added.** SmolLM2 and Granite 4.0 H 350M are Apache-2.0.
- **Test in the app's own runtime, not a demo.** `work/probe-gguf.mjs` loads a GGUF through the real host worker and the retained wllama build on the CPU path and chats with it (the files are served by a small local server because Playwright's `route.fulfill` cannot carry a body over about 100 MB). All three candidates loaded:

| Model (file) | Size | Desktop CPU | Answers |
|---|---|---|---|
| SmolLM2-135M-Instruct Q4_K_M | 105 MB | about 10 tok/s | capital right, follow-up right, wordy; wrong on "three primary colours" |
| SmolLM2-360M-Instruct Q4_0 | 230 MB | about 5 tok/s | correct, terse; slower than Granite 350M at the same size, so not added |
| **Granite 4.0 H 350M Q4_K_M** | 223 MB | about 12 tok/s | correct and short on all four questions |

- **Two tiers:** `mini` = Granite 4.0 H 350M (try first), `nano` = SmolLM2-135M (smallest, weakest; for when storage is the limit). Both are single files, published unchanged from IBM's and bartowski's repositories at pinned commits (`ops/cloudflare/gguf-models.json`, `publish-gguf.py`), served from `assets.privatelocal.chat`, listed in `models/catalog.json`.
- **Policy change in `runtime/auto-tier.mjs`:** the tiny tiers may run on the processor on iPhone/iPad and with 2 GB of memory; the 2B and 1B models still may not. A phone with no usable graphics card now starts with `mini`; a desktop without one keeps `light`; a person's choice and an already downloaded model keep their place. The backend (processor or card) is decided per model (`tierBackend`).

## Results

- Desktop, real app, from the CDN (`docs/evidence/model-nano-cdn-check.json`, `model-mini-cdn-check.json`): download, SHA-256 check, load, two replies, unload, remove: all passed for both.

## To do

- [ ] Galaxy S8+: download and chat with `mini` and `nano` on the real phone (storage, memory, speed, a second turn, offline reopen).
- [ ] iPhone 11 Pro: the same on the processor, watching for the browser ending the page.
- [ ] Record measured memory and speed in the catalogue notes and here; choose which tiny model a phone is given by default from the measurements.
- [ ] Settings > Models: confirm the tiny models and the room check read well on a phone.

## Log

- 2026-11-03: candidates tested, `mini` and `nano` published to the CDN and added to the app; desktop checks pass; unit tests 1,023 pass.
