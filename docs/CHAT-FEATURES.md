# Everyday chat features

What the chat experience does beyond running a model, where each part lives, what is stored where, and what it deliberately does not do. Source of truth for behaviour is the tests named below.

## What is here

| Area | Behaviour | Code |
|---|---|---|
| Answers | Safe Markdown (headings, lists, tables, code, links). Generated HTML is shown as text; images are never fetched; only `http(s)` and `mailto` links are clickable. Answers stream into the message itself in local and API mode. | `chat/markdown.mjs`, `chat/stream.mjs` |
| Message controls | Copy answer / code block, edit a prompt and resend (with Undo), retry a failed request in place, regenerate (earlier answers kept as versions), continue a stopped / cut-off / failed answer, leave a message out of what the model sees. | `index.html` (`runReply`, `createMessageEl`) |
| Safety of routing | Every reply is bound to the conversation and message that asked for it, so switching chats mid-answer is safe. Drafts are kept per conversation and survive reloads. | `runReply`, `persistDraftNow` |
| Interruptions | Stop, a failed engine, a dropped connection, a closed or discarded page all keep what was written and say so on the message. | `chat/threads.mjs` (`normalizeMessage`), `local-models.js` |
| Finding work | Local full-text search (titles and messages, accent-insensitive, archived chats included) opening the matching passage; recent-first ordering; derived titles; pin, archive, Trash with Undo, temporary chats, projects with shared instructions, duplicate and branch. | `chat/search.mjs`, `chat/threads.mjs` |
| Importing | Preview first; merge by default, replace only when chosen. Also reads ChatGPT and Claude data exports (the `.zip` or `conversations.json`). | `chat/foreign-import.mjs`, `chat/zip.mjs` |
| Documents | Attach text, Markdown, CSV, code and text-based PDF files (PDF.js, on this device). Short files go to the model whole; long ones are searched (BM25) and cited by number and page. A document library applies to all chats or one project. Pictures go to API providers only. | `chat/documents.mjs`, `chat/retrieval.mjs`, `chat/pdf.mjs`, `chat/doc-store.mjs` |
| Outputs | Save an answer as `.md` / `.txt`, a table as CSV, a code block as a file; edit longer drafts in a side editor and ask the assistant to revise them. | `chat/exports.mjs` |
| Personalisation | Standing instructions, assistant presets, an explicit and editable memory (never used in temporary chats). | `index.html` (assistant block) |
| Exact answers | Arithmetic, unit conversion and date questions are computed by a small parser (no `eval`). `/calc`, `/convert`, `/date` answer immediately; the same questions inside normal messages are computed and handed to the model as given. | `chat/tools.mjs` |
| Speech | Read-aloud, dictation and voice conversation use the browser's own speech services (Apple's on an iPhone). **Dictation** writes into the composer; sending (or switching chats) aborts the recogniser, so late words never reach the next message, and typing while dictating is kept. **Voice conversation** (headphones button) is speech-to-speech: it listens, sends after a pause, speaks the reply sentence by sentence while it is still being written, then listens again; tapping the orb sends now or interrupts, the microphone is off while the app speaks (no echo), muting and the background pause it, the screen stays awake, Escape ends it, and the model is told to answer in short spoken sentences without Markdown or code (code is skipped with a spoken note). A microphone failure is explained (blocked for this site vs. a browser that never lets sites use speech recognition); in the second case the controls are removed and stay hidden for 14 days. | `chat/speech.mjs`, `chat/voice.mjs`, `index.html` (speech block) |
| Brand and layout | PrivateLocal.Chat identity from the brand packet (`brand/`, `chat/brand.css`): wordmark, tokens, light/dark, an "On this device" / "Connected" badge on every chat. Phones get finger-sized targets, a tap-to-reveal action row and Enter-adds-a-line; desktops get hover actions and Enter-sends. Enter behaviour lives in Memory & preferences. | `chat/brand.css`, `chat/icons.mjs` |
| Device readiness | Downloaded / Loaded / Ready for offline use are shown separately; one button performs the next step. Repair, restart, removal and diagnostics are under Advanced. Free memory unloads the model and keeps the download. | `local-models.js`, `index.html` |
| Context | A meter shows how full the model's window is. Older messages can be condensed into a summary that replaces them *in what the model sees only*; the saved conversation is never shortened. | `chat/context.mjs` |
| Storage and backups | One screen for models, conversations, attachments, the library, browser persistence and the last backup, with a backup reminder. Encrypted full backups (PBKDF2-SHA-256, AES-256-GCM). | `chat/crypto.mjs`, `index.html` |
| App lock | A passphrase screen over the app, auto-lock when idle or away, throttled retries. | `chat/crypto.mjs` |

## Controls that cannot be used are not shown

No button is ever shown disabled. If an action is unavailable (a model already downloaded, nothing to free, no speech recognition, pictures with an on-device model) the control is hidden instead, and in-flight work uses `aria-busy`. `tests/e2e/mobile.e2e.mjs` fails if a visible button is disabled.

## First message, no setup

Sending a message (or pressing the welcome button) is all it takes. `runtime/prepare.mjs` picks a model for the device (`runtime/auto-tier.mjs`: phones and tablets get the 2B model, a capable desktop gets the 9B model, an installed or explicitly chosen model always wins), downloads it, loads it, and the message is answered automatically. While that happens the reply bubble (or the welcome screen) shows a progress card: stage, percent, size, time left, and one reassuring paragraph. There is no confirmation dialog; the size is stated on the card, and on a desktop there is a "use the smaller model" link. Stop during setup removes the empty reply but leaves the question; a failed download says why and Retry does not duplicate the message. `tests/e2e/firstrun.e2e.mjs` drives this with a scripted model bridge, since headless browsers have no GPU.

**No graphics card? The processor runs it.** On-device chat no longer needs WebGPU. When the browser has no usable GPU (no WebGPU, no adapter, only a software renderer, or no 16-bit shaders on a small device), the same Qwen3.5-2B model and the same downloaded files run on the processor through WebAssembly (`n_gpu_layers: 0`, nothing offloaded; `runtime/auto-tier.mjs` `pickTier` / `lightBackend`, `runtime/providers/catalog.mjs` `loadConfigFor(..., { backend: "cpu" })`). It is slower, and the app says so on the setup card, the status line and the Advanced panel (with what to try to get the card working). It is not offered on iPhone or iPad (the browser kills a page that holds that much memory, see `docs/IPHONE-INVESTIGATION.md`), without WebAssembly SIMD, or on devices reporting under 4 GB. The larger 9B model still needs a GPU. This is a placement of the same model, not a silent switch to another one: `window.localModels.backend` and the model host state (`backend.light`) always say which is in use. The runtime is single-threaded (no multi-thread build is vendored), so a faster processor build is a possible later improvement. `tests/e2e/cpu.e2e.mjs` proves the path in a browser with no adapter using a tiny fixture model (`tests/fixtures/tiny-llama.gguf`, random weights).

**Stalled downloads.** `runtime/download-recovery.mjs` watches the byte count: if nothing arrives for two minutes (a phone that sat at 64% for a quarter of an hour) the transfer is abandoned and restarted, a wedged host is restarted too, and the shards already saved are reused rather than fetched again. The card says "The download stalled. Restarting it now".

## Stale copies and failed starts

The app ships a plain-JavaScript guard in `index.html`: if `/version.json` names a newer build than the one running, the saved service-worker copy is cleared and the page reloads once (a banner with an Update button is shown instead if that already happened, so it can never loop); if the app does not finish starting, a banner says so with the build number and the same fix. The service worker (`scripts/service-worker.js`) requires only the small startup files to install and then takes over at once; the multi-megabyte model runtimes are cached afterwards, best effort, and as they are first used, so a phone that cannot finish a 36 MB install is no longer stuck on an old version.

A downloaded model loads by itself when the app opens or when on-device chat is chosen (`runtime/auto-load.mjs`), unless the person freed memory this session.

## Where data lives

| Data | Place |
|---|---|
| Conversations | `localStorage` `chatThreads` (temporary chats are never written) |
| Unsent drafts | `localStorage` `plc.drafts.v1` |
| Preferences, memory, presets, projects | `plc.prefs.v1`, `plc.memory.v1`, `plc.presets.v1`, `plc.folders.v1` |
| Attached files and the library | IndexedDB `plc-docs` (a temporary chat's files stay in memory) |
| Lock | `plc.lock.v1` (a salted verifier, never the passphrase) |

Everything stays in the browser. Documents are read, indexed and searched on the device; nothing is uploaded.

## Limits you should know about

* **Context window.** The bundled models run with a 4,096-token window shared by the conversation and the reply, so very long answers end when it is full (the message says so and offers Continue or a summary). Raising it costs memory, which matters most on iPhone. There is no sliding-window mode that drops old turns automatically.
* **The lock is a screen lock.** It stops casual access. It does not encrypt `localStorage` or IndexedDB, so someone with access to the browser's files can still read them. An encrypted backup is the protected copy. A forgotten passphrase cannot be recovered: the only way back in is to erase the app's data and restore a backup.
* **Pictures need a vision-capable API provider.** The on-device models here read text only, and the app says so instead of pretending.
* **Scanned PDFs** have no text to read and are refused with an explanation; OCR is not available offline yet.
* **Speech depends on the browser.** Some app web views (DuckDuckGo on iPhone, for one) expose speech recognition but never let a website use it; this cannot be tested from a desktop, so the app detects the failure and hides the controls. Dictation and voice conversation appear only where the browser has speech recognition, and may send audio to that browser's speech service (Apple's on iPhone). That is an accepted trade-off for an app that also lets people connect their own providers; it is not a claim that voice never leaves the device.
* **Exact-answer detection is conservative.** It acts on clear arithmetic, unit and date questions and ignores things that merely look like them (`2026-03-05`, `pages 10-20`).
* **Processor speed is unmeasured.** The processor path is verified to load and generate with a tiny test model; how many words per second Qwen3.5-2B manages on a given computer's processor has not been measured, so expect it to be slow.
* **Local performance is untested here.** Browser tests use a scripted provider, so response quality and speed on a real iPhone or WebGPU device still need the existing acceptance scripts.

## Tests

```sh
npm test            # unit tests for every pure module (Node)
npm run e2e         # browser tests: builds dist/, serves it, and drives it with Playwright against a scripted OpenAI-style server
```

`tests/e2e/fake-api.mjs` is an OpenAI-compatible server whose behaviour is chosen by the last prompt (`fail-once`, `fail-mid`, `length`, `slow`, `speak`, `speak-long`, `markdown`, citations when excerpts are present). Speech APIs are replaced by mocks in `assistant.e2e.mjs`, because a headless browser has no voices or recogniser.

## Adding to the chat

The inline script exposes a few hook lists so features do not need to edit the send path: `contextProviders` (add instructions or document text to the prompt), `messageDecorators` + `messageActionHandlers` (add a button to a message), `sendInterceptors` (answer a typed command without the model), `userMessageHooks`, `afterReplyHooks`, and `threadSelectedHooks`. New logic belongs in a pure module under `chat/` with a Node test, then wired in through one of these.
