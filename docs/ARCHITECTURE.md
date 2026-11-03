# How this app is put together

A static, no-framework browser app: one HTML page, ES modules, no build step for the code itself (`scripts/build.mjs` only copies, versions and checksums). This page says where things live and how they talk, so a new feature has an obvious place. Written 2026-11-03 after the first extraction (the lock and the dialogs) out of `index.html`.

## Three layers

1. **Pure modules** (no DOM, everything the browser provides is passed in). They read on their own and are unit-tested in plain Node.
   `chat/voice.mjs` (call turn-taking), `chat/voice-choice.mjs` (voice picker), `runtime/memory-manager.mjs`, `chat/models-view.mjs`, `runtime/download-recovery.mjs`, `chat/intent-router.mjs`, `chat/markdown.mjs`, `chat/crypto.mjs`, the provider layer in `runtime/providers/`.
2. **Feature modules** (own the DOM of one feature). Each is a `createX({...everything it needs...})` function that the page calls once; it returns a small object. They never reach into the page's variables.
   `chat/lock/lock.mjs` (app lock and the not-locked reminder), `chat/dialogs.mjs` (modal dialogs), `chat/shell/` (rail, panel, Settings, pickers, search), `chat/transfer-ui.mjs`, `chat/roberta-ui.mjs`, `chat/memory-offer.mjs`.
3. **The host page**, `index.html`: boot, the chat core (threads, sending, streaming, rendering), and the glue that creates the feature modules and hands them what they need. It is still large (about 5,800 lines, most of it one script) and is being shrunk one feature at a time: **move a feature out by turning its block into `createX({...})`, passing in what it used from the page, and replacing outside uses with the returned object.** The lock and the dialogs are the worked example (`git show` the commit that added `chat/lock/lock.mjs`).

## How features talk to each other

There is no event bus yet. These are the official connection points; anything else is a bug waiting to happen.

**Hook arrays in `index.html`** (a feature pushes a function; the chat core calls them):

| Array | Called | Used by |
|---|---|---|
| `threadSelectedHooks` | after a conversation is shown | |
| `beforeSendHooks` | as a message is sent, before the composer is read and cleared | dictation stops here |
| `userMessageHooks` | on a prompt before it is sent | exact tools |
| `contextProviders` | to add to what the model is sent (async, returns `{ preamble }`) | voice call style |
| `replyListeners` | `{ start, text(full), end }` as a reply is written | the voice call |
| `afterReplyHooks` | after a finished reply | |

**Window globals** (each has one owner; modules outside the page use these instead of importing the page):

| Global | Owner | Purpose |
|---|---|---|
| `plcApp` | `index.html` | the facade the shell uses: threads, open library/help/share, attach files, `loadVoice()`, `loadMemory()`, `getEmbedder()`, `lock`, `openLockSettings()`... |
| `plcShell` | `chat/shell` | open Settings or search from outside |
| `plcDialogs` | `chat/dialogs.mjs` | `confirm`, `alert`, `copyText` for modules that cannot be handed the dialogs |
| `localModels` | `local-models.js` | the chat model: state, `view`, actions (`ensureReady`, `freeMemory`, `setMode`...) |
| `plcMemoryReady`, `plcOneAtATime` | `index.html` | the memory manager promise, and a flag it keeps for `local-models.js` |

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
