# Really small models for the Galaxy S8+ and the iPhone 11 Pro

Started 2026-11-03. **Status: published, verified on desktop, the Galaxy S8+ and (on the processor) the iPhone 15 Pro; the iPhone 11 Pro still needs a by-hand check in a normal Safari tab** (see Results and To do).

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

- **Desktop, real app, from the CDN** (`docs/evidence/model-nano-cdn-check.json`, `model-mini-cdn-check.json`; and `tests/e2e/tiny-models.e2e.mjs`, a release check): download, SHA-256 check, load, answers, unload, remove: all pass for both.
- **Galaxy S8+ (Android 9, Chrome 131, 3.4 GB RAM, about 519 MB free, no GPU adapter)**, the real first-run flow on the dev site (`docs/evidence/small-models/s8plus.json`): the app picked `mini` by itself, downloaded it (about 10 minutes on that phone's connection; free space 519 -> 283 MB), loaded it and answered "The capital of France is Paris."; the follow-up ("Italy?") took 12 s and said "Rome". With the network denied (dev switch) a cold start showed the Offline pill, the checklist said "Ready for offline use", and it answered (the reply, "Good evening.", is a small-model quirk). The model was removed afterwards (free space back to about 492 MB). Before this change no model could be offered there: the 1.2 GB download did not fit.
- **iPhone 15 Pro (iOS 26.6.2), tiny models forced onto the processor** (the way the 11 Pro would run them; `docs/evidence/small-models/iphone15pro-cpu.json`): both load in about 1 s and the browser did not end the page. `mini` about 21 tokens/s, `nano` about 32 tokens/s, single thread; both answered the capital and the follow-up; `nano` rambled on the meeting question and `mini` gave "Friday" (no time). So `mini` is the one to offer first, and `nano` is only for when storage or memory is the limit.
- **iPhone 11 Pro (iOS 18.6.2): the picker is right (it now picks `mini`; `canPrepare` was false before), but the real run could not be done through the Safari automation session**: there `navigator.storage.getDirectory()` throws "UnknownError: The operation failed for an unknown transient reason (e.g. out of memory)" from the page and from a worker, every time, while IndexedDB and the Cache API work (the phone had 3.2 GB free, so it is not space). The 15 Pro on iOS 26 in the same kind of session is fine. This is most likely a WebKit limit of ephemeral (automation, Private Browsing) sessions on iOS 18. It showed a real app problem: the app blamed memory ("the default model needs about 6 GB"). `runtime/providers/errors.mjs` now classifies that wording, while saving or loading files, as "storage unavailable" with advice about Private Browsing, a restricted browser or a full disk (`tests/storage-unavailable.test.mjs`).

## To do

- [x] Galaxy S8+: download, chat, second turn, offline reopen, cleanup (2026-11-03).
- [x] iPhone, processor path for the tiny models, on a real iPhone (15 Pro, forced) (2026-11-03).
- [ ] **iPhone 11 Pro by hand in a normal Safari tab** (not Private Browsing): open the dev site, send a message, let it set itself up, then send a second message and check it answers again after force-quitting Safari. Needs the owner: the automation session cannot save files on iOS 18.
- [x] Measured speeds in the catalogue notes (memory is still an estimate: no tool here reads a phone page's memory).
- [x] The unhelpful "needs 6 GB" message for a failed storage call.

## Log

- 2026-11-03: candidates tested, `mini` and `nano` published to the CDN and added to the app; desktop checks pass; unit tests 1,023 pass.
- 2026-11-03: S8+ and iPhone 15 Pro (processor) results in; found that OPFS is unavailable in the 11 Pro's Safari automation session and fixed the misleading error text.
