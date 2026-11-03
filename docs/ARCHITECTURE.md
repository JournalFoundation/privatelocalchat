# How this app is put together

A static, no-framework browser app: one HTML page, ES modules, no build step for the code itself (`scripts/build.mjs` only copies, versions and checksums). This page says where things live and how they talk, so a new feature has an obvious place. Written 2026-11-03 after the first extraction (the lock and the dialogs) out of `index.html`.

## Three layers

1. **Pure modules** (no DOM, everything the browser provides is passed in). They read on their own and are unit-tested in plain Node.
   `chat/voice.mjs` (call turn-taking), `chat/voice-choice.mjs` (voice picker), `runtime/memory-manager.mjs`, `chat/models-view.mjs`, `runtime/download-recovery.mjs`, `chat/intent-router.mjs`, `chat/markdown.mjs`, `chat/crypto.mjs`, the provider layer in `runtime/providers/`.
2. **Feature modules** (own the DOM of one feature). Each is a `createX({...everything it needs...})` function that the page calls once; it returns a small object. They never reach into the page's variables.
   `chat/lock/lock.mjs` (app lock and the not-locked reminder), `chat/call/call.mjs` (the voice call screen: orb, status, model chips, message list, stall notice), `chat/events.mjs` (the event list), `chat/models/services.mjs` (the memory manager, the shared embedding model and the voice choice, created once), `chat/dialogs.mjs` (modal dialogs), `chat/shell/` (rail, panel, Settings, pickers, search), `chat/transfer-ui.mjs`, `chat/roberta-ui.mjs`, `chat/memory-offer.mjs`.
3. **The host page**, `index.html`: boot, the chat core (threads, sending, streaming, rendering), and the glue that creates the feature modules and hands them what they need. It is still large (about 5,450 lines, most of it one script) and is being shrunk one feature at a time: **move a feature out by turning its block into `createX({...})`, passing in what it used from the page, and replacing outside uses with the returned object.** The lock, the dialogs and the voice call are the worked examples: `createCall(host)` in `chat/call/call.mjs` lists the page's capabilities it needs in its header comment, which is the pattern to copy.

## How features talk to each other

These are the official connection points; anything else is a bug waiting to happen.

**The event list, `chat/events.mjs`** (a feature adds a listener with `events.on(name, fn)`; the chat core and features fire events by name; a name that is not in the list is an error, so a typo fails at once). The table at the top of that file is the official list:

| Event | Fires | For |
|---|---|---|
| `thread:selected` | `emit(thread)` | a conversation was shown: stop speech, close the canvas, refresh presets |
| `send:before` | `emit()` | a message is being sent, before the composer is read (dictation stops here) |
| `send:intercept` | `intercept(text, thread)` | answer without the model; a listener returns `true` when it handled it (Roberta's slash commands) |
| `prompt:ready` | `emitAwait(message)` | a user message before it is kept or edited: exact tools rewrite it, the voice call marks it |
| `context:collect` | `collect(thread, view)` | add to what the model is told; each listener returns `{ preamble?, attachmentText?, sources? }` |
| `reply:start` / `reply:text` / `reply:end` | `emit(...)` | a reply began, grew (the voice call speaks it as it is written), finished |

`emit` never lets one listener's error stop the others (it is logged); `emitAwait`, `collect` and `intercept` wait for each listener in turn and let errors through. `messageDecorators` and `messageActionHandlers` (extra buttons on a message) are separate, because they shape rendering rather than moments.

**Window globals** (each has one owner; modules outside the page use these instead of importing the page):

| Global | Owner | Purpose |
|---|---|---|
| `plcApp` | `index.html` | the facade the shell uses: threads, open library/help/share, attach files, `loadVoice()`, `loadMemory()`, `getEmbedder()`, `lock`, `openLockSettings()`... |
| `plcShell` | `chat/shell` | open Settings or search from outside |
| `plcDialogs` | `chat/dialogs.mjs` | `confirm`, `alert`, `copyText` for modules that cannot be handed the dialogs |
| `localModels` | `local-models.js` | the chat model: state, `view`, actions (`ensureReady`, `freeMemory`, `setMode`...) |
| `plcMemoryReady`, `plcOneAtATime` | `index.html` (published from `chat/models/services.mjs`) | the memory manager promise, and a flag it keeps for `local-models.js` |

## Models and memory

Three kinds of model sit in memory: the chat model (`local-models.js` over `runtime/providers/`), downloaded voices (`chat/voice-engine.mjs`, picked through `chat/voice-choice.mjs`) and the small embedding model (`chat/embedder.mjs`). `runtime/memory-manager.mjs` is the one place that knows what is loaded; with "One model at a time" on it unloads the others before one is used. `chat/models-view.mjs` gives every model the same row shape and the same state words, which Settings > Models, both composer menus, the storage screen and the call screen's chips all use. See `docs/MODEL-MEMORY-PLAN.md` and `docs/MODEL-UI-PLAN.md`.

## Where things live

```
index.html              host page: boot, chat core, glue
local-models.js         the chat model controller (window.localModels)
runtime/                model hosting, downloads, memory manager, voice advice
runtime/providers/      the on-device model runtimes (WebLLM, wllama) behind one client
chat/                   feature code, still flat (voice-*, ivr/roberta, documents, transfer...)
chat/shell/             the app shell: rail, panel, Settings page and pickers
chat/lock/              the app lock
chat/call/              the voice call screen
chat/models/            model services: memory manager, shared embedder, voice choice
chat/vendor/            bundled third-party code (voice worker, embedding worker, pdf.js, qr)
ops/                    publishing and build tooling for models and workers (not shipped)
tests/                  unit tests (fast) and tests/e2e (real browser)
docs/                   plans, evidence and procedures
```

`chat/` is flat on purpose for now; grouping it into domain folders (`voice/`, `documents/`, `transfer/`, `roberta/`) is a mechanical move to do once the features are extracted, so imports only change once.

## Testing without ceremony

- **Always:** `npm test` (unit tests, about a minute). The pure modules are where the logic is, and these tests are cheap.
- **For the area you touched:** `npm run e2e -- <part of a suite name>` (for example `npm run e2e -- voice lock`). Suites run one at a time, because each builds `dist/` and two at once collide.
- **Before a release:** `npm run e2e` runs every suite (about ten minutes). CI runs the unit tests and the voice suites; the full browser sweep is a release check, not a per-change habit.
- **One smoke e2e per feature** is enough. Put logic in a pure module and test it there rather than through the browser.
