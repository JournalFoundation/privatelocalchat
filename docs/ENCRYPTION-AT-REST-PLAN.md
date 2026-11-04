# Encryption at rest: plan

Status: PROPOSED 2026-11-04. Nothing built yet. Written after a survey of the code; the decisions marked **(owner)** are open.

## Goal

Everything the person creates or chooses is stored encrypted on the device and readable only after they enter their passphrase. Every prompt,
every reply (while it streams) and every settings change is sealed and written as soon as the app has it, so closing the tab, a crash or the
phone killing the page loses at most about a second of a streaming reply and nothing else.

Not encrypted (by design): the app itself (HTML/JS/CSS, service worker cache), model weights and runtimes in OPFS, and the few bytes the
lock screen needs before unlock (see "Readable before unlock").

## What this does not protect against

Say these plainly in the UI and in `docs/`; they are the honest limits.

1. **Whoever serves the app.** It is a web app: a changed `index.html` could read the passphrase or the decrypted chats. (Owner already knows.)
2. **The running browser.** Once unlocked, chats are plaintext in page memory; the browser, extensions with page access, and anything that can
   read the process's memory or swap can see them.
3. **Offline guessing of a weak passphrase.** With a copy of the browser's files, an attacker can try passphrases as fast as their hardware
   allows. PBKDF2 slows each guess; it cannot save a short passphrase. The optional device-bound key (Phase 5) closes this.
4. **Metadata.** The number, sizes and write times of records show roughly how much and when the person chats. Which models are downloaded is
   visible from OPFS. Padding (Phase 4) reduces the size signal; nothing hides the timing.
5. **Flash remanence.** Deleted or overwritten bytes may stay physically on flash. Per-chat keys (crypto-shredding) are the answer for data
   written after this ships; plaintext written *before* migration may survive on the device regardless.
6. **A forgotten passphrase.** There is no recovery and there must not be one. Encrypted backups (`chat/transfer/backups.mjs`) are the safety net.

## What is stored today (survey)

| Where | Key / store | Contents | Owner |
|---|---|---|---|
| localStorage | `chatThreads` | every saved chat (titles, system prompts, messages), whole list rewritten on each save | `chat/core/thread-state.mjs` |
| localStorage | `plc.activeThread.v1` | id of the open chat | `index.html` |
| localStorage | `plc.drafts.v1` | unsent composer text per chat | `index.html` |
| localStorage | `plc.prefs.v1` | preferences (theme etc.) | `index.html` |
| localStorage | `plc.folders.v1`, `plc.presets.v1` | folders, prompt presets | `chat/shell/registry.mjs` area |
| localStorage | `plc.memory.v1` | "One model at a time" switch | `runtime/memory-manager.mjs` |
| localStorage | `plc.voice.v2` | chosen voice and voice settings | `chat/voice/` |
| localStorage | `plc.shell.collapsed`, `plc.offlineHint.v1`, `plc.lockSplash.v1`, `plc.speechInputUnusable` | UI state | shell, connection, lock |
| localStorage | `plc.lock.v1` | lock verifier (PBKDF2 → AES-GCM of a constant) and auto-lock minutes | `chat/lock/lock.mjs`, `chat/crypto.mjs` |
| sessionStorage | `chatConfig`, `chatModels`, `chatEndpointTokens` | provider config, model list, **API keys** | `chat/provider/provider-settings.mjs` |
| sessionStorage | `plc.draft`, `plc.pendingToken.v1`, `promoDismissed` | transient | various |
| IndexedDB | `plc-docs` / `docs` | attached and library documents | `chat/documents/doc-store.mjs` |
| memory only | search index | keyword + embedding index of chats | `chat/shell/hybrid-search.mjs` |
| OPFS / Cache Storage | models, runtimes, app shell | not user data | `runtime/`, `scripts/service-worker.js` |

Already in place: `chat/crypto.mjs` (WebCrypto PBKDF2-SHA-256, 600 000 iterations → AES-256-GCM, authenticated metadata) used by backups,
settings transfer and the lock verifier. The lock (`chat/lock/lock.mjs`) is a screen lock only and says so.

Every new key added to the app must be classified in this table (user data → vault; UI-before-unlock → plain). A test enforces it (Phase 3).

## Design

### Keys

- **Passphrase key (KEK):** PBKDF2-SHA-256 over the NFKC passphrase, random 16-byte salt, iterations stored with it (start at 600 000; measure
  on a mid-range phone and keep unlock under ~1 s). Used only to unwrap the vault key.
- **Vault key (DEK):** random AES-256-GCM key, created once. Stored only wrapped (AES-KW or AES-GCM) by the KEK. After unlock it is imported
  as a **non-extractable** `CryptoKey` and held in memory; it is never in storage in the clear. Changing the passphrase re-wraps the DEK
  only; no data is re-encrypted.
- **Per-chat keys:** each chat gets its own random key, stored (wrapped by the DEK) inside the vault's key table. Deleting a chat deletes its
  key, so its old records become unreadable even if their bytes linger (crypto-shredding). Documents get per-document keys the same way.
- **Optional device key (Phase 5):** a passkey with the WebAuthn PRF extension yields a secret from the device's secure hardware; the DEK can
  be wrapped by it as a second (or required) factor. Stolen files alone are then useless.

The lock verifier in `plc.lock.v1` is replaced by the wrapped DEK: a passphrase is right exactly when the DEK unwraps.

### Storage: an append-only encrypted log in IndexedDB

New database `plc-vault` with object stores:

- `header` (one row, plaintext): `{ format: "plc-vault/1", kdf, iterations, salt, wrappedDek, deviceWrap?, createdAt }`.
- `log` (keyPath `seq`, auto-increment): `{ seq, keyId, iv, data }`. `data` is AES-GCM ciphertext of one event; the AAD is
  `"plc-vault/1|" + seq + "|" + keyId`, so records cannot be moved, swapped between chats or replayed at another position.
- `snapshots`: periodic compacted state (see Compaction), also encrypted, also AAD-bound to its `upToSeq`.

Why IndexedDB, not localStorage: WebCrypto is asynchronous and localStorage writes are synchronous (so encrypt-then-store needs async storage
anyway), localStorage is capped around 5 MB, and IndexedDB gives transactions with a completion event.

Event types (plaintext inside the ciphertext, versioned):

```
thread.create {id, title, systemPrompt, createdAt}
thread.update {id, title?, systemPrompt?, folder?, ...}
thread.delete {id}                      // and the chat key is destroyed
message.add   {threadId, message}       // the prompt, before it is sent to the model
message.partial {threadId, messageId, text}   // streaming checkpoint, replaces previous partial
message.final {threadId, messageId, message}
message.edit / message.delete
doc.put {id, ...} / doc.delete {id}
setting.set {key, value}               // every former localStorage/sessionStorage user key
```

The in-memory state after unlock is `snapshot + replay(log after snapshot)`. The rest of the app keeps working on that in-memory state exactly
as it does now; only the persistence layer changes.

### Durability: "saved as soon as the app has it"

- Each event is one IndexedDB `readwrite` transaction opened with `{ durability: "strict" }` where supported. The write counts as saved on
  `oncomplete`; the UI does not show anything as saved before that.
- A prompt is written (`message.add`) **before** it is handed to the model or the API.
- While a reply streams, `message.partial` is written about once per second (and on `visibilitychange` → hidden and `pagehide`), then
  `message.final` when it ends. A killed page leaves the last partial, shown as "reply interrupted" on next unlock.
- Writes are serialised through one queue per tab, so ordering is the order of events. Encryption happens in the page (`crypto.subtle` is
  fast enough for chat-sized records); no plaintext is ever handed to storage.

### Compaction

When the log since the last snapshot exceeds a threshold (e.g. 2 000 records or 5 MB) and the app is idle, write a new encrypted snapshot of the
full state, then delete the log records it covers and older snapshots in one transaction. Superseded partials are dropped. Deleted chats'
records are dropped (and are already unreadable because their key is gone).

### Two tabs

Only one tab may write. Use `navigator.locks.request("plc-vault-writer", ...)`; other tabs open read-only and receive new events over a
`BroadcastChannel` (ciphertext only, or just "seq N is new; read it"). If the writer tab closes, the next tab takes the lock and replays from
the log. Without Web Locks, fall back to "this chat is open in another tab" and refuse to write.

### Lock and unlock

- Unlock: derive KEK → unwrap DEK → read snapshot + log → build state → mount the app. Until then the app shows only the lock screen; no user
  data is in memory.
- Lock (button, auto-lock minutes from the existing lock, optionally on hide): drop the DEK reference, clear in-memory state, reload the page
  (the only reliable way to drop everything the page built from the data). The person is warned if a reply is still streaming.
- The current lock feature becomes this: "Lock with a passphrase" now means "encrypt with a passphrase". There is no unencrypted lock.
- **(owner)** Is a passphrase required for everyone, or is the vault opt-in (with plaintext storage as today when off)? Recommendation: opt-in
  first (Phase 1–3), make it the default later; an unencrypted mode must keep working for people who choose it.

### Readable before unlock

Only what the lock screen needs: `header`, the theme (so the lock screen is not a white flash in dark mode) and the lock-screen layout flags.
**(owner)** Accept theme as plaintext, or show a neutral lock screen and encrypt theme too? Recommendation: keep theme plain; it reveals
nothing about the person's chats.

### Search, voice, models

- The search index is built in memory after unlock and never stored. If it is ever cached, it goes into the vault like any other event.
- Voice choice, the memory switch and model choice move into `setting.set`. Before unlock no voice or model is auto-loaded.
- Model files stay in OPFS, unencrypted. Which models are downloaded remains visible (limit 4).

### Backups and transfer

Encrypted backups keep their own format (`plc-encrypted-backup/1`) and their own passphrase prompt; a backup is made from the unlocked
in-memory state. Restore writes events into the vault. Plain (unencrypted) export stays possible but asks for confirmation through
`window.plcDialogs.confirm` and says the file is readable by anyone.

### Migration of existing data

On turning the vault on: read every plaintext key and `plc-docs`, write them as events into a new vault, verify by decrypting and comparing,
then delete the plaintext keys and the `plc-docs` database. Tell the person that copies written before encryption may remain on the device's
flash and that the only way to be sure is to clear the site's data after making an encrypted backup. Turning the vault off is the reverse and
asks for the passphrase and a confirmation.

## Code shape

- `chat/vault/vault.mjs` (pure, tested with `fake-indexeddb` or an in-memory adapter in `node --test`): keys, wrap/unwrap, append, read,
  compaction, events → state reducer.
- `chat/vault/vault-store.mjs`: the one storage interface the rest of the app uses (`get/set` for settings, thread and document operations).
  `thread-state.mjs`, `doc-store.mjs`, provider settings, voice, prefs and the memory switch call this instead of `localStorage`,
  `sessionStorage` or `indexedDB` directly. When the vault is off it is backed by today's plaintext keys, so the formats `CLAUDE.md` says to
  preserve keep working.
- `chat/lock/lock.mjs` becomes the vault's unlock/lock UI.
- New events in `chat/events.mjs` (`vault:unlocked`, `vault:locked`, `vault:write-failed`); update `docs/ARCHITECTURE.md` and
  `docs/RESTRUCTURE-PLAN.md` as the architecture test requires.

## Phases

1. **Vault core.** `chat/vault/vault.mjs` + unit tests: key wrapping, append with AAD, replay, tamper detection (changed byte, swapped seq,
   swapped keyId all fail), passphrase change, per-chat key deletion makes records unreadable, compaction.
2. **Chats and documents through the vault (opt-in).** Storage interface; `thread-state.mjs` and `doc-store.mjs` use it; prompt-before-send
   and streaming checkpoints; lock/unlock UI; migration both ways. e2e: kill the page mid-reply and confirm the partial is there after unlock.
3. **All settings through the vault.** Provider config and API keys, voice, prefs, folders, presets, drafts, memory switch. A test that greps
   for `localStorage`/`sessionStorage`/`indexedDB.open` outside the vault and an allow-list (like `tests/no-native-dialogs.test.mjs` does for
   dialogs) and fails on any unclassified key.
4. **Hardening.** Web Locks + BroadcastChannel for tabs; optional size padding of records (round up to 1 KB buckets); auto-lock on hide;
   iteration count measured on real phones (iPhone, mid-range Android) and recorded in `docs/evidence/`.
5. **Device-bound key (optional).** WebAuthn PRF passkey as an extra wrap of the DEK; clear fallback when the browser lacks PRF.
6. **Default on (owner decision).** New installs are asked for a passphrase at first run.

## Tests and checks

- Unit: everything in Phase 1; reducer replay equals the pre-vault state for a corpus of real-shaped (synthetic) chats.
- No plaintext at rest: e2e writes a chat containing a marker string, then scans localStorage, sessionStorage and every IndexedDB record for
  the marker; must find nothing.
- Crash safety: e2e closes the page during streaming, reopens, unlocks, checks the last partial.
- Wrong passphrase, changed passphrase, two tabs, migration on and off, backup/restore round trip.
- Performance: unlock time and per-write latency on the reference phones; a chat with 10 000 messages still unlocks in reasonable time
  (snapshot size and replay length are bounded by compaction).

## Open questions (owner)

1. Opt-in first, or required for everyone from the start?
2. Theme readable before unlock?
3. Lock (and reload) when the app is hidden, or only after the idle timer?
4. Pad record sizes (more storage, less leakage) or not?
5. Offer the device-bound passkey as an extra factor, as a replacement for the passphrase, or not at all?
