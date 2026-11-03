# Model memory management: plan

Status: PLAN ONLY, nothing below is built yet. Written 2026-11-02 after a survey of the code.

## Why

A phone or small laptop cannot hold the chat model and a voice model (and the matching model, and later image or OCR models) at the same time. Today each
model manages its own memory in its own way, so nothing can say "give this model the whole device". The owner wants:

1. A setting, **"One model at a time"** (working name), that unloads every other model when one is about to be used, and loads the chat model again when it
   is time to generate. It costs latency and gives the model in use the whole device.
2. The setting lives in Settings, and is **offered** when a voice model or the chat model fails.
3. It applies to every model kind, including ones that do not exist yet (image generation, OCR, others). So memory needs one logical manager that every
   model kind registers with. It does not need one screen: each model keeps its own controls and cues.

## Survey: what holds memory today

| Model kind | Code | Load / unload today | Idle handling | Memory estimate |
|---|---|---|---|---|
| Chat model, on device (WebLLM on GPU; wllama on CPU) | `runtime/providers/model-host.mjs` (`load`, `unload`, `state.load.state` = unloaded / loading / ready / faulted / unloading), `runtime/providers/client.mjs`, `local-models.js` (`freeMemory`, `ensureReady`, `userFreed`, `shouldAutoLoad` in `runtime/auto-load.mjs`), `runtime/prepare.mjs` | Loaded by `ensureReady` before a send (`index.html` ~3151, ~3171) and by auto-load at start; unloaded only by the person ("Free memory") or a tier switch | None | `item.info.memory.steadyBytes` |
| Voice (Kitten, Kokoro), ONNX Runtime Web in a worker | `chat/voice-choice.mjs`, `chat/voice-engine.mjs` | Loads at the first read; `release()` unloads (idle 60 s, chat model loading, "Free the memory") | 60 s idle, built 2026-11-02 | about +250 MB / +420 MB (`docs/VOICE-MEMORY.md`, desktop only) |
| Matching / embedding model (`mdbr-leaf-ir`, about 24 MB) | `chat/embedder.mjs`, used by `chat/intent-router.mjs` (Roberta) | `ready()` loads, `terminate()` stops it | own 120 s idle terminate | small (tens of MB) |
| Search embedding (Ctrl/Cmd+K, `chat/shell/shell.mjs` ~545) | creates its **own** `createEmbedder({})` instance, separate from Roberta's in `index.html` ~4694: the same model can be in memory twice, each in its own worker | same `ready()` / `terminate()`, same 120 s idle | same | same, doubled |
| PDF.js | `chat/pdf.mjs` | loaded on demand, no resident model | none needed | transient |
| Speech recognition | browser's own `SpeechRecognition` | not our memory | n/a | n/a |
| Image generation, OCR | none (`docs/CHAT-FEATURES.md`: "OCR is not available offline yet") | | | |
| Remote API mode | nothing local | nothing to unload | n/a | n/a |

Findings that shape the design:

- The chat model's "free memory" path sets `userFreed`, which stops auto-load. A policy unload must **not** set it (or the chat model would never come
  back), and `ensureReady` already clears it, so lazy reload at generation works.
- The chat host already classifies failures (`runtime/providers/errors.mjs`: `out-of-memory`, `load-failed`) and the voice side records crashes
  (`pending` / `speaking` flags). Both are ready-made triggers for the offer.
- Each model kind has its own idle timer and its own state names. There is no shared place to ask "what is in memory right now".
- The voice pill dot (hollow / amber / solid / ringed) built on 2026-11-02 is the cue pattern to reuse for other kinds.

## Design

### 1. One logical manager: `runtime/memory-manager.mjs`

A small, dependency-free module with injectable timers and storage (so unit tests need no browser). Every model kind registers a **resident**:

```
register({
  id, kind,            // "chat-llm" | "voice" | "embedding" | later "image" | "ocr"
  label,               // what the person sees: "Qwen3.5-9B", "Kitten voice"
  estimateBytes(),     // may be null when unknown
  state(),             // "unloaded" | "loading" | "loaded" | "busy" | "unloading" | "faulted"
  unload(),            // free memory, keep files; must be safe to call when idle
  isBusy(),            // generating, reading aloud, embedding right now: never unloaded under it
})
```

Core calls:

- `acquire(id, {reason})` -> lease. Under policy "one at a time" it first unloads every other loaded resident that is not busy and waits for busy ones to
  finish (queue, in order); under "keep" it does nothing extra. Returns `lease.release()`.
- `snapshot()` / `subscribe()` -> `{ policy, residents: [{id, kind, label, state, estimateBytes, waitingFor}] }`, the one source for all cues.
- `policy`: `"keep"` (today's behaviour plus the idle timers) or `"one-at-a-time"`; stored under `plc.memory.v1` (new key: add to `privacy/index.html`
  and to settings export/import if settings are exported).
- Events (`policy-unload`, `reload-needed`, `failed`) so the UI can explain what happened.

The manager never loads anything by itself. A model loads lazily the way it does now; the manager only decides what must be out of the way first. That
keeps every kind's own loading code, error handling and progress as they are.

### 2. Adapters (thin, one per kind)

- **Chat LLM**: wraps `localModels`: `unload` = host unload without setting `userFreed`; `isBusy` = generating; acquire is called at the existing
  `ensureReady` call sites. Auto-load at start is skipped under "one at a time" (the model loads when the first message is sent).
- **Voice**: wraps `voiceCtl.release()`; acquire is called from the voice `route().engine.speak`, `hearSample` and the download self-test. The
  existing idle timer stays as a second mechanism under "keep".
- **Embedding**: wraps `embedder.terminate()` / `ready()`; the embedder's own idle timer stays.
- **Future kinds** (image generation, OCR, ...): register the same contract. A short "adding a model kind" section will be added to this doc and to
  `CLAUDE.md`.

### 3. The setting

- Name (working): **"One model at a time"**. Settings > Models gets a switch with plain text: "Free the other models from memory whenever one is
  in use, so it gets the whole device. Replies and reading start a little later because models reload when needed." Default **off**.
- A small **Memory** card in Settings (logical, not central: each model keeps its own controls): lists what is loaded now, with state and size, and an
  "Unload" button per resident and "Unload all". Its content is the manager snapshot.

### 4. Visual cues (every kind, same words)

- Each model's own control shows its state: the voice pill dot exists; the chat model pill gets the same dot states (hollow = downloaded not loaded,
  amber pulse = loading, solid = loaded, ringed = working).
- While the manager swaps models, the status line says what and why: "Unloading Kitten voice to make room for Qwen3.5-9B…", then "Loading
  Qwen3.5-9B…". Never an unexplained pause. Names are always specific (chat model, voice, ...); see the 2026-11-02 naming fix.

### 5. Offers on failure (never automatic)

Trigger: chat model load or generation fails with class `out-of-memory` or `load-failed`; a voice fails to start or reads fail twice; the next start
finds the "page ended while loading/reading" flag. Offer once per session per kind: "This device may be short of memory. Turn on One model at a time?"
with **Turn on**, **Not now**, **Don't ask again**. It never turns itself on, never blocks a retry, and is not shown when the setting is already on.

### 6. Known costs and edge cases

- **Voice calls** (Roberta) alternate generate and speak every turn. Under "one at a time" each turn reloads two models. The setting stays available
  there, with a one-line warning in the card, and a measurement on the iPhone decides whether calls get a different rule.
- Reload failure after a swap (the chat model cannot come back): say so in plain words, keep the chat, offer Retry; never lose the draft message.
- Never unload under a busy resident: generation, reading and embedding finish first. A swap that waits shows "Waiting for X to finish".
- Downloads write straight to storage and do not hold model memory, so they are not blocked by the policy.
- Policy unloads must not set `userFreed`, and must not count as failures against any model.
- Reload speed is the main cost; measure `loadMs` (already recorded for the chat model) and the voice load on real devices before promising numbers.

## Build order

1. `runtime/memory-manager.mjs` + unit tests (policy, queueing, busy residents, subscribe). No behaviour change.
2. Adapters for chat LLM, voice, embedding; register them; acquire at the existing call sites. Policy stays "keep" so nothing changes yet.
3. The setting, persistence, privacy page entry, the Memory card in Settings, status line wording.
4. Chat model pill dot parity; cues in the Memory card.
5. Failure offers (LLM out-of-memory / load-failed, voice failures, crash flag).
6. e2e with fake models (swap order, busy waits, reload failure, offer shown once); real-device run on the iPhone 15 Pro: swap latency both ways.
7. Docs: `CLAUDE.md` architecture bullet, `docs/CHAT-FEATURES.md`, `docs/TECHNICAL-DEBT.md`, "adding a model kind".

## Decisions needed from the owner

1. **Name**: "One model at a time" is a placeholder. Alternatives: "Give each model the whole device", "Save memory (swap models)".
2. **Default**: off everywhere, or on by default for devices the app already knows are small (iPhone, low-memory Android)? Recommendation: off, but
   the failure offer is the path in.
3. **Voice calls**: allow the setting during calls as is (slow turns), or exempt calls and say so?
4. **Later, a smarter mode**: an "Automatic" policy that uses `estimateBytes` and the device memory to unload only when the models would not fit
   together. Recommendation: build the manager so it is possible, ship "keep" and "one at a time" first.
5. **Search embedding**: it does not share the Roberta embedder (two instances, two workers). Recommendation: make the manager's embedding resident a single shared instance that both callers use, a small change done in build step 2.
