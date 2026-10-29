# Development diagnostics

This module is maintained on `dev`. It is built and activated only for `dev.privatelocal.chat`.
The production build excludes the UI, modules, receiver worker, routes, and debug host hooks,
even if this source is later promoted to `main`. Tests inspect both build outputs.

Diagnostics are off by default. Open **Development diagnostics**, enter an HTTPS receiver URL,
choose whether to **Save diagnostics on this device**, and press **Start diagnostics**. Stop is
explicit; saved events remain available for export or later upload. No prompts, replies, API
credentials, or raw native logs are recorded. State transitions, event timing, numeric memory
observations, download progress, model-host status and page lifecycle events are recorded.

With local saving enabled, events are committed to IndexedDB before load/generation actions.
The bounded queue survives offline operation and page reopening. Events upload in batches when
connectivity returns and are removed only after acknowledgement. A failed upload keeps them.
The queue is bounded to 2,000 events, approximately 4 MB maximum; the oldest events are dropped
when full. Browser storage may still be evicted or unavailable. An OS process kill cannot emit a
final event; the last committed events provide the lead-up, and the next page-start marks a new
page session. Memory metrics are observations, not a confirmed OS termination diagnosis.

The optional project receiver uses a private R2 bucket, `privatelocalchat-debug-private`, bound
only to the development Pages project as `DEBUG_LOGS`. The operator read/admin credential is the
Pages secret `DEBUG_READ_TOKEN`, with its local copy outside Git at
`/root/.config/privatelocalchat/debug-read-token`. Sessions use random write-capability URLs and
expire after seven days. Read access requires the separate operator credential. Other HTTPS
receivers may be used if they accept the documented JSON batch format and appropriate CORS.

Create a session with `python dev-tools/operator-session.py new`; give the returned receiver URL
to the tester. Fetch saved server events with `python dev-tools/operator-session.py read --out
work/evidence/iphone-session.json`. Only users who explicitly enable diagnostics send events.
The receiver and administrator endpoints return 404 on hosts other than the exact development
hostname. The production project has no diagnostic bucket binding or receiver worker.
