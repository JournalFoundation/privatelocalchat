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
| Speech | Read-aloud uses only voices the browser marks local. Dictation and the hands-free voice loop run only when the browser confirms recognition stays on the device, and explain why when it cannot. Availability is checked on first use, never at start-up. | `chat/speech.mjs` |
| Device readiness | Downloaded / Loaded / Ready for offline use are shown separately; one button performs the next step. Repair, restart, removal and diagnostics are under Advanced. Free memory unloads the model and keeps the download. | `local-models.js`, `index.html` |
| Context | A meter shows how full the model's window is. Older messages can be condensed into a summary that replaces them *in what the model sees only*; the saved conversation is never shortened. | `chat/context.mjs` |
| Storage and backups | One screen for models, conversations, attachments, the library, browser persistence and the last backup, with a backup reminder. Encrypted full backups (PBKDF2-SHA-256, AES-256-GCM). | `chat/crypto.mjs`, `index.html` |
| App lock | A passphrase screen over the app, auto-lock when idle or away, throttled retries. | `chat/crypto.mjs` |

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
* **Dictation and voice conversation are browser-dependent.** They stay off unless the browser can prove recognition is local, which today means recent Chromium with an installed on-device language pack. Safari/iOS does not currently expose that, so they stay off there.
* **Exact-answer detection is conservative.** It acts on clear arithmetic, unit and date questions and ignores things that merely look like them (`2026-03-05`, `pages 10-20`).
* **Local performance is untested here.** Browser tests use a scripted provider, so response quality and speed on a real iPhone or WebGPU device still need the existing acceptance scripts.

## Tests

```sh
npm test            # unit tests for every pure module (Node)
npm run e2e         # browser tests: builds dist/, serves it, and drives it with Playwright against a scripted OpenAI-style server
```

`tests/e2e/fake-api.mjs` is an OpenAI-compatible server whose behaviour is chosen by the last prompt (`fail-once`, `fail-mid`, `length`, `slow`, `markdown`, citations when excerpts are present). Speech APIs are replaced by mocks in `assistant.e2e.mjs`, because a headless browser has no voices or recogniser.

## Adding to the chat

The inline script exposes a few hook lists so features do not need to edit the send path: `contextProviders` (add instructions or document text to the prompt), `messageDecorators` + `messageActionHandlers` (add a button to a message), `sendInterceptors` (answer a typed command without the model), `userMessageHooks`, `afterReplyHooks`, and `threadSelectedHooks`. New logic belongs in a pure module under `chat/` with a Node test, then wired in through one of these.
