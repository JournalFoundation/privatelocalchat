# Offline plan: an app that works without a connection, says so, and is tested that way

This is a **living plan**, the same shape as `docs/RESTRUCTURE-PLAN.md`: where we are, where we are going, the order, and a log that is updated as we learn. It does not have to be right at the start; each phase ends by correcting this page. `docs/ARCHITECTURE.md` stays the description of how the app is put together now; anything this plan adds (a folder, an event, a window global) goes there too.

Started 2026-11-03. **Status: draft, waiting for the owner's approval.** Nothing below has been built except the pre-work in "What we know".

## Where we need to be

1. **It works.** After the app has been opened once online, and the person has used a model once, everything that does not need the internet works with no internet: opening the app cold, the conversations, chatting with a downloaded model, documents, search, voice, the lock, backups, the public pages. A cold start offline never ends in a failure banner.
2. **It says so, plainly, and at the right moment.** The person always knows whether they are online, what will and will not work in that state, and whether the device is *ready* for offline use before they need it. No guessing, no jargon, no alarms for something that is fine.
3. **It never lies and never switches silently.** Local mode never falls back to an API. An action that needs a connection says why it cannot run and what will happen when the connection returns.
4. **It is tested the way a person uses it**: a real browser with the service worker on and the network cut, on every release; and on the real iPhone and Mac Safari, which behave differently from Chromium.
5. **It looks designed.** One small visual language for connection and readiness (a pill, a checklist, a few calm messages), consistent with the existing model-state vocabulary, light and dark, small screens and large text.

## What we know (pre-work, 2026-11-03)

Read from the code and measured on the current build (`155d2a6`, headless Chromium, service worker on, then the network cut and the page reloaded):

- **The shell works offline.** 163 files are saved, the page reopens offline, `window.__plcBooted` is true, no failure banner. The restructure did not break it. The earlier doubt ("I have not tested since the restructure") is closed for the page itself.
- **A real defect.** Two runtime files fail to load offline: `runtime/providers/vendor/noble-hashes/2.4.0/_md.js` and `_u64.js`. Cause: `scripts/build.mjs` (the `walk` that builds the service worker's file list) skips every file whose name starts with `_`, to leave out `_headers`-style files, and so drops these two. `sha2.js` imports them, and `runtime/providers/hash-blob-chunks.mjs` (checking downloaded model files) and `chat/voice/voice-engine.mjs` import `sha2.js`. Offline on a cold start, the checksum step cannot load. **What this breaks in practice is not yet measured** (phase 0 does that); the existing offline receipts passed because the page had been open online first.
- **There is no connection indicator.** The UI never listens to the browser's online/offline events. The only offline statements are a line in Settings (`#offlineStatus`), the model's status text ("Everything needed is saved on this device") and the download phase "Waiting for connection".
- **Readiness is a yes/no.** The runtime files (WebLLM/wllama, many MB) are saved best-effort and never block an update (debt item 16), so "ready offline" can be true while the runtime is missing. The probe (`runtime/offline-status.mjs`) only compares the cache name.
- **Tests that exist:** `voice-offline.e2e` (voice, with the page already open), `public-pages.e2e` (public pages offline), the old `work/check-full-browser-offline.mjs` (full lifecycle with a real model, not in CI, not re-run since the restructure), unit tests for the probe and download recovery. **No suite loads the whole app cold, offline, with a real model.**
- **Devices, reached today:** Mac Safari answers over SSH (`ssh -p 2222 jbenac@192.168.29.228`, macOS 26.7.1, two Safari windows open; the older `work/control-mac-*.py` scripts drive it with `osascript`). Boiler (192.168.29.164) is up and shows **two iPhones and a Galaxy phone on its USB bus**; the iPhone bridge is `dev-tools/operator-safari-controller.py` (needs `pymobiledevice3` and a `--usbmux-socket`, which is not on this machine; getting that lane back is the first device task). `idevice_id` on this machine sees nothing, as expected.

## Principles (carried over from what worked in the restructure)

- **One commit per piece, pushed to `main` and `dev`; tick and date the step here; keep `ARCHITECTURE.md` true.** A test fails if the architecture page drifts; this plan gets the same protection (see "Automation").
- **Measure before changing.** Each phase starts by writing the test that shows the problem, then fixes it. Pure logic goes in a pure module with unit tests; each feature gets one smoke e2e, not a pile.
- **Failures found on a device are recorded here**, with the fix and the test that now catches it. The voice work found three bugs only on real hardware; expect the same here.
- **Device safety (from `docs/VOICE-ENGINE-PLAN.md`, unchanged):** do not clear user data on a device; check battery (15%+) and free space before any download; read only the tab this work opened; one automation session per phone; no overlapping Safari inspector clients (quit Safari on the Mac while phones are attached); remove what was installed and turn diagnostics capture and remote control off afterward; never commit device identifiers or credentials. The user may take a phone at any moment, so release devices promptly.
- **Nothing in production that is only for testing.** Test hooks stay inside the `DEV_DIAGNOSTICS` markers or `dev-tools/`.

## Phases, in order

Each phase: write the failing test first, fix, run `npm test` and `npm run e2e -- <area>`, tick and date here, update `ARCHITECTURE.md` if needed, commit, push both branches.

### Phase 0: learn what is true (no product change except fixes for what is proven broken)

- [x] **0.1 Precache completeness** (2026-11-03, `tests/offline-precache.test.mjs`; the build now skips the root control files by exact name, so `_md.js` and `_u64.js` are saved). A unit test over the built `dist/`: walk the import graph of every module the page, workers and `local-models.js` can load and fail if any file is not in the service worker's list. Fix the `_` rule in `build.mjs` (skip by exact name, not by prefix). This test catches the whole class of bug, not only these two files.
- [x] **0.2 Cold-offline matrix in Chromium** (2026-11-03, `tests/e2e/offline-model.e2e.mjs`, result in `docs/evidence/offline/matrix-chromium.json`; the matrix below the list). Still to run: offline before any model was used, offline mid-download, update available while cached. Original plan text: (script now, a suite in phase 3): open online and wait for ready; cut the network; close the page and open a new one; then try each feature and write down what fails: boot, conversations, a downloaded model (the real 2B), checksum verify on load, documents, search (including the embedding model), voice read-aloud, voice call, lock, backups, export, public pages. Produce `docs/evidence/offline/matrix-chromium.json`. Include the variants: offline before any model was used; offline in the middle of a download; update available while cached.
- [x] **0.3 Request audit** (2026-11-03, both suites record every failed and every outside request). Original plan text: Record every request the page attempts while offline and every third-party host contacted online; any request that is not needed for the feature in use is a finding.
- [~] **0.4 Device lanes back** (2026-11-03: Mac Safari and the iPhone 11 Pro done, evidence in `docs/evidence/offline/matrix-mac-safari.json` and `matrix-iphone11pro.json`; the iPhone 15 Pro is attached to Boiler but its USB multiplexer does not list it, so it still needs a replug or unlock; the `pymobiledevice3` environment is `work/devtools-venv`, the socket is forwarded from Boiler with `ssh -L work/boiler-usbmux.sock:/var/run/usbmuxd boiler`; Mac Safari is driven in a window of its own with the app served from here through the existing reverse tunnel, and "offline" is the server being stopped). Original plan text: Restore the iPhone bridge from Boiler (usbmux socket, pairing cache, Remote Automation) and confirm the Mac lane; run 0.2 by hand on the iPhone 15 Pro (iOS 26.x) and on Mac Safari, record `matrix-iphone15pro.json` and `matrix-mac-safari.json`. Safari differs on service-worker lifetime, storage eviction, and what "offline" means in airplane mode versus a cut tunnel; the matrix must say which was used. The iPhone 11 Pro (no WebGPU, about 1 GB quota) is added if the owner wants the old-iPhone case.
- [ ] **0.5 Review this plan** with the results and rewrite phases 1 to 5 where the facts disagree with it. This is the step that makes the plan honest.

### What the Chromium matrix showed (2026-11-03, build `59e18b7`, real 2B model, fresh profile)

| Check | Result |
|---|---|
| App saved by the worker after first visit | yes (165 files; 8 of them the model runtime) |
| Real reply from the downloaded model, online | yes, 194 s including the download, on this machine's CPU |
| New browser process, network cut: the app opens cold | **yes**, no banner, page finished starting |
| The earlier conversation is there | yes |
| The model is still installed and loads | yes |
| A real reply from the model with no connection | **yes** (the checksum step loads: the `_md.js` fix is in this build) |
| Help opens its own page offline | yes |
| Search by words offline | the first run's check used the wrong selectors; the fast suite now proves it (passes) |
| A connection indicator a person can see | **no** (phase 3) |
| Back online: opens, keeps the conversation | yes |
| Requests while offline | one: the matching model's `tokenizer_config.json` from the CDN (search asks for the matching model the first time; it fails quietly and keyword search still works). Allowed, but the UI should say "Matching model not downloaded" instead of failing silently (phase 3.2 lists it) |

Not shown by this run, still open: how the old build (without the `_` fix) behaves offline in practice (the fix is already in; not worth rebuilding the old state to prove it), the runtime-before-first-use variant, mid-download, and every device. On this desktop the runtime files are saved within about 20 s of the first visit, so debt item 16 is a risk for slow connections and phones, not a measured gap here.

### Phase 1: make it work (fix what Phase 0 proved)

Done so far (2026-11-03): the `_` files missing from the service worker's list; a provider failure offline now says so in words; a download interrupted by losing the connection now says it is waiting and resumes (measured, fixed, with a release check); a dead connection that the browser calls online is noticed. Still open: the offline-before-any-model variant on the phones, and an update arriving while offline (covered by the checklist's "One more step" line and unit tests only).

Likely, to be confirmed or struck by phase 0: the `_` files (0.1); saving the model runtime files before they are needed, or saying precisely when they are not saved (debt item 16); an interrupted app update while offline; behaviours that fail with a generic error instead of an offline one (provider calls, link opens, document fetches, the embedding model download); anything the iPhone does differently (eviction of cached files, storage persistence). Every fix gets the test from phase 0 that showed it.

### Phase 2: the connection layer (small, pure, tested)

- [x] **2.1 `chat/connection/connection.mjs`: `createConnection(host)`** (2026-11-03; `tests/connection.test.mjs`; created by `chat/connection/connection-glue.mjs`, which index.html creates; fires `connection:changed`; read by the shell as `plcApp.offline.connection`) (pure state machine: `online`, `offline`, `reconnecting`, with a settle delay so a flicker does not flash a banner; the browser's `navigator.onLine` is a hint, not truth, so a failed request from the app can also mark offline and a success can mark online). Fires `connection:changed` on the event list in `chat/events.mjs`; `window.plcApp` gets `connection` for modules outside the page.
- [x] **2.2 `runtime/offline-readiness.mjs`** (pure, 2026-11-03; `tests/offline-readiness.test.mjs`; facts from `chat/connection/offline-facts.mjs`, `tests/offline-facts.test.mjs`; the service worker now also reports how many model runtime files are saved and can save the missing ones on request. The matching-model line is not fed yet: the embedder has no "is it downloaded" answer, so it is left out until one exists): turns the facts the app already has (service-worker cache present and current, runtime files present, model downloaded, voice downloaded, matching model downloaded, storage persistent) into a checklist of items, each `ready | missing | partial | unknown` with the action that fixes it. Replaces the single yes/no.
- [~] **2.3 A reason for every refusal** (`offlineReason(kind)` in `chat/connection/connection.mjs`, tested; used by a provider failure in the sender and by the download fix; the other controls are phase 3.3): one function mapping "needs a connection" to the sentence a person sees, used by every control that cannot run offline, so the wording is the same everywhere.

### Phase 3: the interface

Designed with the owner's brief in mind: visual, calm, informative, with the right hints. Concretely, to be refined with mock-ups before building (see "Open questions").

- [x] **3.1 The connection pill** (2026-11-03, `chat/shell/connection-pill.mjs`; checked in light, dark, desktop and a 390 px phone; its menu is short: what is going on, only the lines that need a fix, a way to Settings). Original plan text: Beside the model pill; shown only when it carries information. Offline with a local model: a quiet "Offline · on-device chat works" in the accent colour used for "downloaded/loaded", not a warning colour. Offline with an API provider selected: "This provider needs a connection" and the send button explains itself. Back online: a short "Back online", then it disappears. Respects reduced motion; has an accessible name and live-region announcement.
- [x] **3.2 Ready for offline use** (2026-11-03, `chat/shell/offline-section.mjs` and `offline-checklist.mjs`; app, chat model, runtime files, voice, keeping it; fix buttons for reload, save the runtime now, download, ask to keep). Original plan text: Settings > Models gets a checklist (app, chat model and runtime, voice, matching model, storage persistence) built from 2.2, with a fix button on each missing line ("Save the runtime now"), and one summary the person can trust. The same summary is reachable from the pill and from About.
- [x] **3.3 Offline-aware controls** (2026-11-03: revised after measuring. A download started offline already queues ("Download will continue when connected", the existing download recovery), which is better than a disabled button, so downloads stay enabled and the Models page says what they do offline. The provider's model refresh is disabled with its reason, but only for a provider on the internet: a provider on this device (localhost) or your own network can still answer, so the pill says that instead (`providerPlace`). Original plan text: Download, provider refresh, sharing by link, anything that needs the network is disabled with the reason beside it, never silently inert. Interrupted downloads show "Waiting for connection" and resume with "Back online, continuing".
- [~] **3.4 Teaching moments** (2026-11-03: the first time a model is ready to answer, one quiet line ("Your model is ready for offline use…" or "One more step before this works offline…"), each kind shown once ever; `offlineHint` in `runtime/offline-readiness.mjs`, tested. The "keeping it" advice is a checklist line with a button rather than a toast, and the update prompt already exists ("Save draft and reload"); an install-to-home-screen hint is left out because browsers expose no reliable way to know it applies). Original plan text:, each shown once and dismissible: after the first model loads ("You can use this without internet" or "One more step to save the app"), when installing to the home screen is possible, when the browser may delete saved data (persistence not granted), when an update is ready ("Reload to update; your chats are kept").
- [x] **3.5 Help and the public pages** (2026-11-03: the offline section of Help rewritten to the checklist's own words; `tests/offline-help.test.mjs` fails if a line, state word, button or the pill's words change in the app and not in Help). Original plan text: A Help section "Using it offline" that matches the checklist wording exactly; `docs` drift test in the same style as the privacy/help-label tests so the words cannot drift.
- [ ] **3.6 Visual pass.** Light and dark, 320 px width, 200% text, VoiceOver and keyboard; screenshots on the iPhone and the Mac recorded in `docs/evidence/offline/`.

### Phase 4: the test suite and the device checks

- [~] **4.1 `tests/e2e/offline.e2e.mjs`** (fast, in CI; written and passing 2026-11-03 for the shell-only checks; the pill, the checklist and the refusals are added as phase 3 lands; not yet in the CI workflow): shell-only cold-offline; the pill appears and goes; the checklist reflects reality; refusals explain themselves; no unexpected requests.
- [~] **4.2 `tests/e2e/offline-model.e2e.mjs`** (written; passed on 2026-11-03 except for one check that was then corrected): (release check, minutes, downloads the 2B): the full lifecycle in "Phase 0.2", with a real reply offline, a voice read-aloud offline, then back online.
- [ ] **4.3 Real devices, scripted as far as the platform allows**: the same scenarios on the iPhone 15 Pro and Mac Safari through the owned bridge, evidence files committed (no identifiers), including airplane mode on the phone if the bridge survives it (it may not; if so, the result says "by hand" and records what the owner saw).
- [ ] **4.4 CI wiring**: 4.1 runs on every push; 4.2 is in the release checklist (`docs/OPERATIONS.md`) and the device runs are listed in `docs/ACCEPTANCE.md` as qualified or open.

### Phase 5: close out

- [ ] Update `docs/ARCHITECTURE.md`, `docs/TECHNICAL-DEBT.md` (item 16 fixed or restated), `docs/ACCEPTANCE.md`, the project `CLAUDE.md`; summarise outcomes here; list what stays open (for example an iOS behaviour that cannot be fixed, only explained).

## Automation (the checks, so the plan cannot rot)

- `tests/offline-precache.test.mjs` (0.1): every importable file is in the service worker list.
- `tests/offline-readiness.test.mjs`, `tests/connection.test.mjs` (phase 2): pure modules, all states.
- `tests/offline-plan.test.mjs`: this page names every file it says it will create once the step is ticked (a ticked step whose file is missing fails), the same drift protection `architecture-doc.test.mjs` gives the architecture page.
- The e2e suites above; the device runs write evidence files that the plan links.

## Open questions (my recommended answer in brackets; I will proceed on these unless told otherwise)

1. Should "Ready for offline use" ever be automatic (save the runtime in the background after the first model loads)? [Yes for the small shell and the runtime already needed by the chosen model; never download a model the person did not choose.]
2. Show the connection pill all the time or only when offline? [Only when it carries information.]
3. Is the iPhone 11 Pro in scope, or only the 15 Pro and the Mac? [15 Pro and Mac first; 11 Pro only for the readiness checklist and the "this device is limited" wording.]
4. Is a full model download in CI acceptable? [No; keep it a release check.]

## Log (newest first; add a line with every finding)

- 2026-11-03: mid-download variant (new release check `tests/e2e/offline-download.e2e.mjs`). Measured on the real 2B download: for about 30 seconds after the connection was cut the status still read "Downloading… 0.15 GB" with no movement (the stall timeout), and after that it read "Failed to fetch… press Download again", although the download was queued and resumes by itself. Fixed in `local-models.js`: as soon as the connection layer says offline, or the recovery is waiting, the status reads "Waiting for a connection. The download carries on by itself, and what is saved is kept (X of Y so far)." The release check now cuts the network, expects that wording within 15 seconds, still within 45 seconds more, resumes on return, and removes the partial files.

- 2026-11-03: a dead connection that the browser still calls online (dead Wi-Fi, and also how the phone's development network switch looks) was invisible to the pill. The connection layer now checks the app's own origin directly (`/version.json?probe=…`, no saved copy) when the page comes to the front, when the browser reports a change, every 5 minutes while open and every 15 seconds while offline; a failed check is believed at once. Privacy page updated: it is the same file the app already fetched at start, and it carries nothing about the person.

- 2026-11-03: phase 3.1 and 3.2 are in, and a provider failure while offline now says "You are offline. This provider needs a connection…" instead of "Failed to fetch". Found by the chat-core suite: a stream that drops on a working connection must not be called offline, so a network failure is only called offline when the connection layer agrees (the browser says so, or two requests in a row failed); otherwise the text is "Could not reach the provider…".

- 2026-11-03: Devices. Mac Safari (macOS 26.7.1) and iPhone 11 Pro (iOS 18.6.2) both open the saved app cold with the origin or network denied, keep local data, and report "Offline app ready". Both report `persisted=false` (Safari does not promise to keep data) and the iPhone's quota is about 1 GB. The dev-only network switch served the app for `/help`; it now uses the same page lookup as production. The 15 Pro is not listed by Boiler's USB multiplexer.

- 2026-11-03: Chromium matrix with the real 2B model: cold offline open, conversation kept, real offline reply, public pages, back online all pass. The only request while offline is the matching model for search. New: `tests/e2e/offline.e2e.mjs` (fast) and `offline-model.e2e.mjs` (release). Pure modules for the connection state, the readiness checklist and the refusal sentences are in with tests; the page does not use them yet.

- 2026-11-03: 0.1 done. The new test builds `main` and `dev` into a temp folder, checks every shipped file is in the worker's list (except the voice files fetched on demand) and every relative import resolves to a saved file. It fails on the old build rule and passes on the new one.
- 2026-11-03: baseline on `155d2a6`. Shell reopens offline (163 files saved). Found `_md.js` and `_u64.js` missing from the service worker list (cause: `walk` in `scripts/build.mjs` skips names starting with `_`). Mac Safari reachable over SSH; Boiler up with two iPhones and a Galaxy on USB; the iPhone bridge needs `pymobiledevice3` and a usbmux socket, not present on this machine.
