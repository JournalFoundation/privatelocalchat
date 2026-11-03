# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Private Local Chat: a static, no-framework browser app (WebGPU/WASM local LLMs, or an explicitly chosen OpenAI-compatible API). GitHub `JournalFoundation/privatelocalchat` is the source of truth; Cloudflare Pages serves the app, R2 (`assets.privatelocal.chat`) serves model files. This repo is **not** deployed via the homelab/Flux/Caddy stack described in the global instructions.

## Commands

Node 22+, Python 3.

```sh
npm ci
npm test                                        # node --test tests/*.test.mjs
node --test tests/download-retry.test.mjs       # single test file
python3 -m unittest discover -s dev-tools/tests -v   # dev-tools Python tests (CI runs these too)
DEPLOY_BRANCH=dev npm run build                 # or DEPLOY_BRANCH=main; each build wipes dist/
node scripts/serve.mjs                          # serves dist/ at http://127.0.0.1:18171
DEPLOY_SITE_URL=<url> GITHUB_SHA=$(git rev-parse HEAD) GITHUB_REF_NAME=<branch> node scripts/verify-release.mjs
```

There is no linter. Commits must be Conventional Commits with body lines ≤100 chars (commitlint/gitlint; semantic-release runs from `main`).

## Architecture

- **`index.html`** (~5.7k lines) is the single-page chat app: the markup, the inline script and the chat engine. It owns the storage formats that must be preserved: `chatThreads` (localStorage) and `chatConfig`/`chatModels` (sessionStorage). Local mode must never silently fall back to an API.
- **`local-models.js` / `local-models.css`** bridge the UI to local models (model panel, download/load flow). **`conversation-messages.mjs`** shapes messages for the model.
- **`runtime/`** is the provider layer: `providers/` (catalog, host worker + `client.mjs`, `adapters/` incl. wllama, hash/OPFS download writers, retry/recovery, `vendor/wllama/v1q` pinned native WASM). `runtime/download-recovery.mjs` and `offline-status.mjs` support resumable downloads and offline UX. Runtime artifacts are pinned by SHA-256; see `docs/RUNTIMES.md` before replacing any. Models are catalogue tiers in `runtime/providers/catalog.mjs` (`default` Qwen3.5-9B on WebLLM; `light` Qwen3.5-2B, `lfm` LFM2.5-2.6B and `granite` Granite 4.0 H 1B on wllama); adding one follows the recipe in `docs/CDN-POPULATION.md`.
- **App shell (`chat/shell/`, `chat/shell.css`)**: the one and only layout (ChatGPT-style). `shell.mjs` is mounted at the end of `index.html`'s inline script and builds the icon rail, panel items, header Temporary/"..." buttons, the composer "+" menu and model picker, the Settings page, the Ctrl/Cmd+K search overlay (`hybrid-search.mjs`: keyword + on-device embedding model, fused by rank) and Roberta's page. It *moves* the model/API form, import/export controls and theme toggle from `index.html` into the Settings page so their ids and listeners keep working. `registry.mjs` holds the data-driven entries (rail, explore, plus menu) and the date grouping of the chat list. It talks to the page only through `window.plcApp` (defined at the end of `index.html`: `openLibrary`, `openHelp`, `openShare`, `attachFiles`, ...), never by clicking hidden buttons. There is no alternate layout and no flag: every e2e suite in `tests/e2e/` drives the shell exactly as a person would (visible controls only).
- **Voice picker (`chat/voice-choice.mjs`, the voice pill and Settings > Voice in `chat/shell/shell.mjs`, `chat/voice-engine.mjs`, `runtime/voice-pick.mjs`, `ops/voice/`)**: the person chooses how answers are read aloud from a voice menu beside the model menu: the system voice, or a downloaded voice (Kitten, Kokoro: ONNX Runtime Web in a worker with an eSpeak NG phonemizer, bundled into `chat/vendor/voice/worker*.js`). Choosing a voice that is not downloaded downloads it at once. NOTHING is gated by a device test: `runtime/voice-pick.mjs` only produces advice ("recommended" / "may be slow"); a failure is explained and the next try asks for one confirmation and goes ahead. Downloads use the same worker OPFS writer as the language models. The combined app is GPL-3.0 because of eSpeak NG (`THIRD-PARTY-NOTICES.md`). Plan and evidence: `docs/VOICE-ENGINE-PLAN.md`, `docs/evidence/voice/`.
- **`scripts/build.mjs`** produces `dist/`: copies app files into a versioned `releases/<commit>/` path (index.html rewrites asset URLs to it), injects `window.APP_BUILD`, verifies pinned runtime checksums (`ops/native/production-runtime.json`, compiler-control receipt), writes `version.json`, `_headers` (COOP/COEP required for WASM threads), and generates `sw.js` from `scripts/service-worker.js` (precaches every shell file; cache name includes commit).
- **Dev vs production builds from one source**: code between `/* DEV_DIAGNOSTICS_START */` … `/* DEV_DIAGNOSTICS_END */` markers is **stripped from non-dev builds** (index.html, local-models.js, adapters/wllama.mjs, host-core.mjs, client.mjs, sw.js). The `dev` build additionally overlays `dev-tools/native-runtime/*` (instrumented wasm), copies `dev-tools/*.mjs` + `start.js`, and installs `dev-tools/receiver-worker.js` as the Pages `_worker.js` (opt-in telemetry receiver, R2-backed). Production must never contain diagnostics UI/receiver/logging — keep new diagnostics inside the markers or `dev-tools/`.
- **Branches**: `dev` → dev.privatelocal.chat (Pages project `privatelocalchat-dev`), `main` → privatelocal.chat. Push triggers `.github/workflows/deploy.yml` (tests, build, wrangler deploy, verification). Work on `dev`, promote by merging to `main`. Model objects in R2 are immutable; publish new keys rather than replacing (`docs/OPERATIONS.md`).
- **`ops/`** (Cloudflare/R2 publishing + native compiler-control tooling) and **`docs/`** (MAINTAINER-HANDOFF, OPERATIONS, ACCEPTANCE, RUNTIMES, DEV-DIAGNOSTICS, IPHONE-INVESTIGATION, TECHNICAL-DEBT) hold procedures; read the relevant doc before runtime or release changes. Runtime changes need real model generation and offline checks, not just mocks.
- **`work/`** is git-ignored scratch (one-off device probes, browser proofs, private state/tokens like `cloudflare-state.json`). Don't commit from it or print secrets in it; `work/CONTINUATION.md` is a historical handoff log. `.gitlab-ci.yml` is not used.

## Constraints

- Never commit credentials, browser profiles, or user conversations; diagnostics must not capture prompts/replies/API keys.
- No references to the project the runtime was originally sourced from may appear in code, UI, docs, or public metadata.
- Browser tests on this box use dedicated profiles on `/media/Vivarium/…`; don't clear unrelated browser storage.
