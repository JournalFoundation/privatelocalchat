# Development diagnostics

This module is maintained on `dev`. It is built and activated only for `dev.privatelocal.chat`.
The production build excludes the UI, modules, receiver worker, routes, and debug host hooks,
even if this source is later promoted to `main`. Tests inspect both build outputs.

Entering an HTTPS receiver URL immediately enables streaming. The URL and disk-saving choice
persist across reloads and browser restarts. There is no separate Start button or automatic
turnoff. Clear the URL to stop; saved events remain available for export or later upload.
Every event triggers an immediate upload attempt. Active loading and generation are sampled
up to four times per second, with one-second idle sampling. Numeric runtime memory requests
are coalesced so a slow provider cannot accumulate pending probes. Conversations and API
credentials are excluded. State transitions, timing, numeric memory, download progress,
filtered construction logs and page lifecycle events are recorded.

With local saving enabled, events are committed to IndexedDB before load/generation actions.
The bounded queue survives offline operation and page reopening. Events upload in batches when
connectivity returns and are removed only after acknowledgement. A failed upload keeps them.
The queue is bounded to 2,000 events, approximately 4 MB maximum plus an optional 1 MiB native ring; the oldest events are dropped
when full. Browser storage may still be evicted or unavailable. An OS process kill cannot emit a
final event; the last committed events provide the lead-up, and the next page-start marks a new
page session. Memory metrics are observations, not a confirmed OS termination diagnosis.

The optional project receiver uses a private R2 bucket, `privatelocalchat-debug-private`, bound
only to the development Pages project as `DEBUG_LOGS`. The operator read/admin credential is the
Pages secret `DEBUG_READ_TOKEN`, with its local copy outside Git at
`/root/.config/privatelocalchat/debug-read-token`. Sessions use random write-capability URLs and
remain active until explicitly revoked by an authenticated operator DELETE request. Read access requires the separate operator credential. Other HTTPS
receivers may be used if they accept the documented JSON batch format and appropriate CORS.

Create a session with `python dev-tools/operator-session.py new`; give the returned receiver URL
to the tester. Fetch saved server events with `python dev-tools/operator-session.py read --out
work/evidence/iphone-session.json`. Entering a receiver URL enables diagnostics; devices without a URL send no events.
The receiver and administrator endpoints return 404 on hosts other than the exact development
hostname. The production project has no diagnostic bucket binding or receiver worker.

When both a receiver and local saving are enabled, the 2B runtime also enables its existing
fixed-size native construction journal for that model session. It records and flushes numeric
PRE/POST boundaries in the native worker before dangerous operations. After a page restart,
dev recovers the latest 64 valid records before the next user-initiated load and uploads them
through the normal acknowledged queue. Recovery never clears or overwrites the ring. The
reader checks record size, magic, schema and CRC; torn records are ignored. It does not poll
the ring during construction. Clearing the URL stops uploads; an already-running native
recorder ends with its model-worker session. These hooks are stripped from production output.

Native counters are allocation/logical proxies, not process RSS or an iOS memory-limit
measurement. Raw payload slots have phase-dependent meanings; operation and phase codes are
preserved so a retained-generation receipt is not mistaken for a construction allocation.
Source counters can be historical after release; interpret them alongside release markers.

Use `operator-session.py read --recent` for the newest bounded stream window during live
testing. Full reads follow all historical pages. Timestamp-ordered batch keys keep recent
reads independent of session length; retrying an identical batch overwrites the same object.

The desktop receipt in `docs/evidence/dev-native-journal.json` records real inference,
forced renderer-crash recovery and a live receiver acknowledgement. It also confirms zero
retained model-source handles and late reads after release, with one bounded native
checkpoint. Those findings apply to the tested desktop run, not an iPhone reliability claim.

Recovery also runs when a receiver/local-saving choice is first configured and before a
subsequent model load. Concurrent recovery requests share one promise. Transient OPFS lock
errors receive bounded backoff; exhausted reads produce a diagnostic failure event instead
of being silently classified as a missing journal. The construction-crash receipt includes
an unfinished Wasm initialization PRE recovered and verified at the receiver after restart.
