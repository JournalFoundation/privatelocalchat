# Encryption at rest: everything the person keeps is sealed, saved as it happens, and tested that way

This is a **living plan**, the same shape as `docs/OFFLINE-PLAN.md` and `docs/RESTRUCTURE-PLAN.md`: where we are, where we are going, the order, and a log that is updated as we learn. It does not have to be right at the start; each phase ends by correcting this page. `docs/ARCHITECTURE.md` stays the description of how the app is put together now; anything this plan adds (a folder, an event, a window global) goes there too.

Proposed 2026-11-04; made a living plan the same day. **Status: phase 0 done (the inventory and its guard); the vault itself is not built. Unlock with the owner's face is a goal (Phase 5), with the real face needed only in its last step.** The decisions marked **(owner)** are listed with a recommended answer under "Open questions"; work on phases 1 and 2 can start on the recommendations.

## Goal

Everything the person creates or chooses is stored encrypted on the device and readable only after they enter their passphrase. Every prompt,
every reply (while it streams) and every settings change is sealed and written as soon as the app has it, so closing the tab, a crash or the
phone killing the page loses at most about a second of a streaming reply and nothing else.

**The owner wants to unlock with their face (Face ID on iPhone, Touch ID on Mac).** That is a goal, not an optional extra: a passkey with the WebAuthn PRF extension releases a secret from the device's secure hardware after Face ID, and that secret wraps the vault key (Phase 5). The passphrase stays as the fallback and the recovery. **Nobody's physical face is needed until the very last step**: everything before it is built and proven with a virtual authenticator and automated tests; the single real-Face-ID check on the owner's phone is the final step of Phase 5 (5.4).

Not encrypted (by design): the app itself (HTML/JS/CSS, service worker cache), model weights and runtimes in OPFS, and the few bytes the
lock screen needs before unlock (see "Readable before unlock").

## What this does not protect against

Say these plainly in the UI and in `docs/`; they are the honest limits.

1. **Whoever serves the app.** It is a web app: a changed `index.html` could read the passphrase or the decrypted chats. (Owner already knows.)
2. **The running browser.** Once unlocked, chats are plaintext in page memory; the browser, extensions with page access, and anything that can
   read the process's memory or swap can see them.
3. **Offline guessing of a weak passphrase.** With a copy of the browser's files, an attacker can try passphrases as fast as their hardware
   allows. PBKDF2 slows each guess; it cannot save a short passphrase. The Face ID / Touch ID passkey (Phase 5) helps here: the secret comes from the device's secure hardware, so copied files alone are not enough.
4. **Metadata.** The number, sizes and write times of records show roughly how much and when the person chats. Which models are downloaded is
   visible from OPFS. Padding (Phase 4) reduces the size signal; nothing hides the timing.
5. **Flash remanence.** Deleted or overwritten bytes may stay physically on flash. Per-chat keys (crypto-shredding) are the answer for data
   written after this ships; plaintext written *before* migration may survive on the device regardless.
6. **A forgotten passphrase.** There is no recovery and there must not be one. Encrypted backups (`chat/transfer/backups.mjs`) are the safety net.

## Principles

- **One commit per piece, pushed to `main` and `dev`; tick and date the step here; keep `ARCHITECTURE.md` true.** `tests/encryption-plan.test.mjs` protects this page the way `tests/architecture-doc.test.mjs` protects the architecture page (see "Automation").
- **Measure before changing.** Each phase starts with the test that shows the problem or the property, then the change. The pure logic (keys, log, reducer) has no DOM and is tested in `node --test`; the app is tested the way a person uses it.
- **Nothing is trusted that was not checked by reading it back.** Migration verifies by decrypting and comparing before it deletes anything. The first release never deletes the plaintext copy on its own (see the log of phase 2 when it is written).
- **An unencrypted mode keeps working** until the owner decides otherwise: the formats `CLAUDE.md` says to preserve (`chatThreads`, `chatConfig`, `chatModels`) are still what the app reads and writes when the vault is off.
- **Say the limits plainly.** The "What this does not protect against" list is shown in the app and kept true; the app never says "secure" without saying what it does not cover.
- **Device safety (from `docs/OFFLINE-PLAN.md`, unchanged):** do not clear user data on a device; read only the tab this work opened; one automation session per phone; never commit device identifiers or credentials. Test passphrases and test chats are synthetic.
- **No person is needed until the end.** Phases 0 to 5.3 are proven by tests and virtual authenticators. The owner's face is asked for once, in step 5.4, after everything else is green. Do not ask for a face (or a phone in hand) earlier.
- **Nothing in production that is only for testing.** Test hooks stay inside the `DEV_DIAGNOSTICS` markers or `dev-tools/`.

## Hardware targets (what is actually tested on)

| Target | Used for | Notes |
|---|---|---|
| This machine, Chromium | every push: unit tests, browser tests, the virtual authenticator | the only target that runs without a person |
| The Veriton (Linux, DGX Spark class) | unlock timing and a real-browser run of the vault tests on a second Linux machine | browser reached as in the Vulkan/GPU work; it may be busy with other jobs, so check before using it and never stop what it is running |
| Mac Safari (macOS 26.7) | unlock timing, passkey support, Touch ID optional in 5.4 | reached over SSH; driven in a window of its own |
| iPhone 15 Pro (iOS) | unlock timing, passkey support, and the one real Face ID check (5.4) | **the only iOS device in this plan**; the iPhone 11 Pro is out until the owner says it is back |
| Galaxy S8+ (Android) | unlock timing on the slowest phone (decides the iteration count), passkey support with the phone's own screen lock | reached as in the tiny-models work |

Not targets: Windows, other Linux desktops, other iPhones. The iPhone 11 Pro returns to the list only when the owner says so.

## What is stored today (survey)

The machine-checked version of this table is `docs/evidence/encryption/storage-inventory.json` (every key, its class and its owner); this prose table is the readable summary. The inventory found things the first survey missed: pinned items (`plc.shell.pins.v1`), the chosen on-device model (`plc.models.v1`), the connect-or-local mode (`plc.inferenceMode.v1`), the pending download (`plc.downloadIntent.v1`), and that **`plc.memory.v1` was written by two different features** (see the log, 2026-11-04).

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
- **Face ID / Touch ID key (Phase 5, a goal):** a passkey with the WebAuthn PRF extension yields a secret from the device's secure hardware; the DEK can
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

## Phases, in order

Each phase: write the failing test first, change, run `npm test` and `npm run e2e -- <area>`, tick and date here, update `ARCHITECTURE.md` if needed, commit, push both branches.

### Phase 0: learn what is true (no vault yet)

- [x] **0.1 Storage inventory and its guard** (2026-11-04, `docs/evidence/encryption/storage-inventory.json`, `tests/storage-inventory.test.mjs`). Every key, database and file that touches browser storage is listed with a class (user / setting / plain / transient / test / device) and an owner. A key the source uses that is not listed, a file that starts using storage, a listed key that is gone, a key named by a file that is not its owner, and a test-only key outside the page's markers all fail the test. This is the "every new key is classified" check that was planned for phase 3; it exists now so nothing new is added unclassified while the vault is built.
- [x] **0.2 One key, one owner** (2026-11-04, `tests/memory-manager.test.mjs`, `runtime/memory-manager.mjs`). The inventory showed that the model-memory switch and the assistant's memory items both wrote `plc.memory.v1`, each overwriting the other (the person's memory items could be erased by flipping "One model at a time"). The switch now has its own key, `plc.modelMemory.v1`, and reads the old one once to carry its choice over.
- [ ] **0.3 Unlock time on real devices.** Measure PBKDF2-SHA-256 at 600,000 iterations (and AES-GCM of a typical record) on this machine, the Veriton, the Mac Safari, the iPhone 15 Pro and the Galaxy S8+; record in `docs/evidence/encryption/kdf-timing.json`. Decides the iteration count (target: unlock under about 1 s on the slowest phone, the Galaxy S8+, otherwise raise the number on strong devices only and store it in the header).
- [ ] **0.4 Baseline sizes.** How big `chatThreads` is today for a heavy user (synthetic 500 chats, 10,000 messages), how long a save takes, and how close that is to the 5 MB localStorage limit. Decides compaction thresholds and whether the move to IndexedDB is also a fix for a limit people can hit.
- [ ] **0.5 Review this plan** with the results of 0.3 and 0.4 and rewrite phases 1 to 6 where the facts disagree. This is the step that makes the plan honest.

### Phase 1: the vault core (pure, no UI)

- [ ] **1.1 Keys.** `chat/vault/vault.mjs`: passphrase to KEK, random DEK wrapped by it, per-chat and per-document keys wrapped by the DEK, passphrase change re-wraps only the DEK. Tests: right passphrase unwraps, wrong one fails, NFKC-equivalent passphrases agree, the DEK is imported non-extractable.
- [ ] **1.2 The log.** Append with AAD `plc-vault/1|seq|keyId`, replay, snapshots, compaction. Tests: a changed byte, a swapped `seq`, a swapped `keyId`, a record moved to another chat, a replayed old record and a truncated log all fail to open or are reported; deleting a chat's key makes its records unreadable while the others still open.
- [ ] **1.3 The reducer.** Events to state (`thread.*`, `message.*`, `doc.*`, `setting.set`). Test: replaying a corpus of synthetic, real-shaped chats gives exactly the state the app holds today (`chatThreads` shape), including partial replies and deletions.
- [ ] **1.4 Storage adapter.** An IndexedDB adapter and an in-memory one behind one interface, so the same tests run on both; `durability: "strict"` where the browser has it, and a plain fallback that says so.

### Phase 2: chats and documents through the vault (opt-in)

- [ ] **2.1 `chat/vault/vault-store.mjs`**, the one storage interface; backed by today's plaintext keys when the vault is off, so nothing changes for people who do not turn it on.
- [ ] **2.2 `thread-state.mjs` and `doc-store.mjs` use it.** The prompt is written before it goes to the model or the API; a streaming reply is checkpointed about once a second, on hide and on page hide; a killed page shows "reply interrupted" at the next unlock.
- [ ] **2.3 Lock and unlock UI** (`chat/lock/lock.mjs` becomes the vault's unlock); the not-locked reminder (`plc.lockSplash.v1`) is reconsidered; `vault:unlocked`, `vault:locked` and `vault:write-failed` join `chat/events.mjs`.
- [ ] **2.4 Migration both ways** with read-back verification before any plaintext is removed; the person is told what flash may keep (limit 5).
- [ ] **2.5 e2e.** No plaintext at rest (marker scan), kill the page mid-reply, wrong passphrase, migration on and off, backup and restore round trip.

### Phase 3: every setting through the vault

- [ ] **3.1 Move each `user` and `setting` key of the inventory** (provider config and API keys, voice, prefs, folders, presets, drafts, memory, pins, model choice) behind the same interface. Decide first what happens to API keys, which today live only for the tab (open question 6).
- [ ] **3.2 Flip the inventory guard** (`tests/storage-inventory.test.mjs`) from "classified" to "no `user` or `setting` key is read or written outside the vault interface"; the allow-list is the `plain`, `transient` and `test` classes.
- [ ] **3.3 Transient keys** (`plc.draft`, `plc.pendingToken.v1`) never hold plaintext content while the vault is on.

### Phase 4: hardening

- [ ] **4.1 Two tabs**: Web Locks single writer, `BroadcastChannel` for "seq N is new"; the fallback without Web Locks refuses to write and says why.
- [ ] **4.2 Record padding** (open question 4) and auto-lock on hide (open question 3).
- [ ] **4.3 Iteration count** chosen from 0.3 and measured again on the devices after the vault exists; evidence in `docs/evidence/encryption/`.
- [ ] **4.4 Failure honesty**: a full disk, a write that fails, a browser that clears storage; each says what happened and what is safe.

### Phase 5: unlock with Face ID / Touch ID (a passkey with PRF as a second way to wrap the vault key)

The aim is that the person taps "Unlock", looks at the phone, and the vault opens. The passphrase keeps working beside it and stays the only way back if the passkey is lost. Built after the passphrase flow of Phases 1 to 4, because it is a second wrap of the same vault key, not a different vault.

- [ ] **5.1 Learn what is true on the devices we have** (before writing the feature): does `navigator.credentials.create` with the PRF extension work, with the platform authenticator, on Mac Safari, the iPhone 15 Pro, the Galaxy S8+ (Android, its own browser lock) and Chromium on this machine and on the Veriton; does it work in an installed home-screen app as well as in a tab; what happens in a private window. Probe pages only, results in `docs/evidence/encryption/passkey-prf.json`. No face is needed to learn *support* where the browser reports it; where a real prompt is unavoidable, it is saved for 5.4 and the step says so.
- [ ] **5.2 Pure logic, tested with no hardware.** `chat/vault/passkey.mjs`: feature detection, the PRF salt per vault, HKDF of the PRF output to a wrapping key, wrap and unwrap of the vault key, multiple passkeys, removing one, every failure mapped to a plain sentence. Unit tests use a fake authenticator that returns deterministic PRF output.
- [ ] **5.3 Browser tests with a virtual authenticator.** Chromium's virtual platform authenticator (with user verification and PRF switched on) drives the whole flow in `tests/e2e/vault-passkey.e2e.mjs`: add a passkey, lock, unlock with it, remove it, unlock with the passphrase, a browser without PRF falls back with a clear message, a cancelled prompt leaves the vault locked. Safari-specific behaviour that Chromium cannot show is recorded in 5.1 and handled in code. No person is involved.
- [ ] **5.4 The one real check: the owner's face, last.** On the iPhone 15 Pro (and the Mac if wanted), add the passkey, lock, unlock with Face ID, then lock and unlock with the passphrase. Done once, at the end, after everything above is green; the owner is asked for ten minutes then and not before. Evidence in `docs/evidence/encryption/faceid-iphone15pro.md`.

What the interface must say: the passkey is kept by the device's account (Apple passkeys sync through iCloud Keychain, so it is **not** bound to one phone); each site address has its own passkey, so `dev.privatelocal.chat` and `privatelocal.chat` do not share one; a lost passkey is recovered with the passphrase, and a lost passphrase with no passkey is not recoverable. A prompt that only checks the face and releases no key is not encryption and is never offered.

### Phase 6: default on (owner decision)

- [ ] **6.1 New installs are asked for a passphrase at first run**; existing installs are offered the switch once and never forced.

## Automation (the checks, so the plan cannot rot)

- `tests/encryption-plan.test.mjs`: this page keeps its phases, its status line and its log; a ticked step may only name files that exist; the tests named under this heading must exist; the inventory file named here must parse. The same drift protection `tests/offline-plan.test.mjs` and `tests/architecture-doc.test.mjs` give their pages.
- `tests/storage-inventory.test.mjs` (0.1): every storage key and every file that uses browser storage is classified; one owner per key.
- `tests/memory-manager.test.mjs` (0.2): the switch never touches the memory items' key.
- `tests/vault.test.mjs`, `tests/vault-reducer.test.mjs`, `tests/vault-store.test.mjs` (phases 1 and 2): keys, tamper detection, replay equals today's state, the storage adapter on both back ends. Created with their phase.
- `tests/e2e/vault.e2e.mjs` (phase 2): no plaintext at rest (a marker string written in a chat, then every `localStorage`, `sessionStorage` and IndexedDB record scanned), the page killed mid-reply, wrong and changed passphrase, two tabs, migration on and off, backup and restore. Runs on every push once it exists.
- `tests/e2e/vault-perf.e2e.mjs` (phase 4): unlock time and per-write latency with a 10,000-message chat; the limits are written in the test.
- `tests/vault-passkey.test.mjs` (5.2) and `tests/e2e/vault-passkey.e2e.mjs` (5.3): the passkey flow with a fake authenticator and Chromium's virtual one. Created with phase 5.
- Device runs (the hardware targets above) write evidence files under `docs/evidence/encryption/` that this page links; a device-only finding is recorded in the log with the test that now catches it.
- `docs/evidence/encryption/storage-inventory.json` is the one list of what the app keeps; phase 3 turns its guard from "classified" into "only through the vault".

## Open questions (my recommended answer in brackets; I will proceed on these unless told otherwise)

1. Opt-in first, or required for everyone from the start? [Opt-in through phases 1 to 5; revisit as phase 6.]
2. Theme readable before unlock? [Yes, plain: it reveals nothing about chats.]
3. Lock (and reload) when the app is hidden, or only after the idle timer? [Only after the idle timer by default, with "lock when I leave" as a choice.]
4. Pad record sizes (more storage, less leakage) or not? [Pad to 1 KB buckets; it is cheap and hides the length of short messages.]
5. Unlock with the owner's face (Face ID / Touch ID) through a passkey with PRF: [Yes, a goal. An added way to unlock beside the passphrase, never a replacement; built after the passphrase flow; everything automated first, the real face needed only for step 5.4 at the end.]
6. API keys are kept only for the tab today (`sessionStorage`). Should the vault keep them across sessions? [Yes, inside the vault only: unlocking is then the one step, and a key is never in plaintext on disk. Provide a "do not remember keys" switch.]
7. Should the first release ever delete the plaintext copy by itself after migrating? [No: it offers it, after the encrypted copy is read back and an encrypted backup exists.]

## Log (newest first; add a line with every finding)

* 2026-11-04: hardware targets fixed by the owner: add the Galaxy S8+ and the Veriton; the iPhone 11 Pro is out for now (unavailable), so the iPhone 15 Pro is the only iOS device in this plan. The S8+ is now the slowest phone for the iteration count.
* 2026-11-04: owner decision: the vault must open with Face ID, and their physical face is not needed until the end. Phase 5 rewritten (passkey with PRF; learn device support, pure logic, virtual-authenticator browser tests, one real Face ID check last); the words "device-bound" were wrong (Apple passkeys sync through iCloud Keychain) and are gone; question 5 answered yes.
* 2026-11-04: **found while writing the inventory: `plc.memory.v1` was shared by the assistant's memory items (`chat/assistant/assistant.mjs`) and the "One model at a time" switch (`runtime/memory-manager.mjs`).** Each rewrote the whole value, so flipping the switch could erase the person's memory items and saving a memory item reset the switch. Fixed: the switch has `plc.modelMemory.v1` and reads the old key once; `tests/memory-manager.test.mjs` and `tests/storage-inventory.test.mjs` now catch the class. Memory items already lost this way cannot be recovered.
* 2026-11-04: the first survey missed four keys (`plc.shell.pins.v1`, `plc.models.v1`, `plc.inferenceMode.v1`, `plc.downloadIntent.v1`); the inventory test would have caught them, which is why it came first.
* 2026-11-04: plan proposed (branch `claude/vigilant-ride-beaez6`) and made a living plan: phases with steps, an Automation section, recommended answers and this log.
