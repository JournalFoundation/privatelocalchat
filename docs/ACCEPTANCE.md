# Release acceptance

The migration remains **in progress** because the real iPhone path has an unresolved abrupt
page restart. Hosting and desktop inference are verified; they do not close the device gate.

| Requirement | Current evidence | Result |
| --- | --- | --- |
| 1. Cloudflare production, canonical redirects, GitHub Pages disabled | `evidence/hosting-and-releases.json`; canonical 2B browser test blocked homelab requests and completed offline generation/reopen | Passed |
| 2. Separate dev deployment and visible identity | Separate Pages projects and branch/domain assignments in hosting evidence; both HTML shells display environment, version, commit | Passed |
| 3. Actions for main/dev and manual redeploy | Successful push/manual runs from both branches in hosting evidence; `deploy.yml` validates before upload, serializes each branch and skips stale SHAs; `OPERATIONS.md` documents rollback | Passed |
| 4. Complete project model CDN | `ops/cloudflare/model-object-verification.json` read-back hashes and sizes, public HTTP checks, pinned catalogue, runtime/license documentation | Passed |
| 5. On-device runtime, controls, offline reopen, real devices | Production 2B and dev 9B desktop receipts; interruption/resumption and cancellation receipts; real iPhone generated online and offline but also abruptly restarted | Open: iPhone reliability |
| 6. Public app and preserved data | Storage migration receipt; merged/deployed source/feedback links, public-submission notice and GitHub issue forms; no cutover banner | Passed |
| 7. Evidence and operating instructions; no acceptance failures | Evidence and operations documented, but iPhone acceptance still fails | Open until device failure is resolved |

## Desktop evidence

`evidence/production-2b-browser.json` records a fresh production installation, interrupted download
and resumption, actual online generation, offline generation, and offline page reopening followed
by loading and generation. Requests to homelab addresses were blocked; no unexpected network
requests were observed. `evidence/dev-9b-browser.json` records actual 9B f32 generation with the
same offline/reopen checks. `evidence/dev-cancellation.json` records Stop during streamed output
and a subsequent completed generation without reloading the model. These are real runtimes and
model files, not mocked inference. Browser/GPU settings and the Linux shader-f16 limitation are
recorded in `evidence/desktop-environment.json`.

`evidence/storage-migration.json` seeds the previous app's storage on the same origin, then serves
the replacement build and checks conversations/API settings survive. This is a synthetic returning
user fixture, not access to a person's private conversations. `evidence/hosting-and-releases.json`
records current project assignments, successful Actions runs, canonical redirects preserving an
encoded path/query, and GitHub Pages returning 404 after disablement.

## iPhone evidence and remaining check

`evidence/iphone-check.json` records user observations and a content-free summary of received
diagnostics. On an iPhone 15 Pro using DuckDuckGo 26.6, the 2B model downloaded, loaded and replied.
The user also confirmed generation in airplane mode after loading the already-downloaded model.
The original offline navigation redirect defect was fixed and independently retested on desktop.

The same phone also restarted during construction and later after approximately twelve seconds
of generation. A new page session appeared without a handled JavaScript error or completion.
Downloaded model files remained complete after the restart. This does not establish whether the
OS killed a process, the GPU failed, or another browser/runtime condition caused the restart.
The development-only durable diagnostic stream is now collecting the lead-up automatically.
The migration cannot be declared complete until loading and a short multi-turn conversation,
including offline reopening, pass on this device without the unresolved restart.
