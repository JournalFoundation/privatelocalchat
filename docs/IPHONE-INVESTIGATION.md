# iPhone reliability investigation

Updated: 2026-10-30 UTC. Owner: the agent continuing this investigation, with John providing physical iPhone observations when a qualified experiment needs them.

**Status: open.** The leading investigative path is to test whether reducing WebKit optimizing compiler allocation improves survival on the iPhone. Local controls demonstrate a substantial compiler-related allocation outside native memory counters. They do not establish the cause of the latest iPhone restart or qualify a fix.

This is the living plan and decision record. Keep the current state and next action accurate, append results to the experiment log, and preserve failed controls. [Release acceptance](ACCEPTANCE.md) remains the authority for completing the migration.

## Current state and next action

- The iPhone 15 Pro can download, load, and generate, including offline, but construction and longer generation have also caused abrupt page replacement.
- The latest recorded failure occurred on development commit `c41c9f524f9bc754639aeffa3c01df80824294e3`, during a slow Gettysburg response. The last progress event recorded 100 stream chunks, not an attested count of 100 native tokens. A replacement page started at `2026-10-30T01:59:07.174Z`.
- The development placement experiment requests zero GPU-offloaded layers but still puts the tied embedding/output head on GPU. It is not fully CPU inference. Moving weights between CPU and GPU does not establish a reduction in total process footprint.
- The 51-function compiler candidate is live on development at commit `eb8a16d6b1cb24efb9c4a8b73e5e156c3140d4a3`, variant `privatelocalchat-compiler-control-20261030-v1`, Wasm SHA-256 `dbaf064fbeefcae1ab86322a9e52b2fc0de2e52e1f9e00cf72a787ed1f1142fc`. Physical iPhone comparison remains pending. Its reproducible transform and receipt are in `ops/native/compiler-control.mjs` and `ops/native/compiler-control.json`.
- Initial E01 qualification has passed byte reconstruction, real-GPU output parity, ten retained GPU turns including 512 native tokens, cancellation/recovery, fresh-context reset without weight reload, offline generation, a 30-second hold, and all 35 repository checks. The reduced-placement profile passed a real 512-token response and a separate focused recovery/reset/offline session with a 30-second hold; its additional ten-turn stress run was intentionally stopped and is not a pass. A renewed external WebKit comparison with 30-second holds measured 1531.6 MiB after-generation peak for the baseline and 818.8 MiB for the candidate. See [the E01 receipt](evidence/dev-compiler-control.json).
- The deployment workflow succeeded. All three published runtime files match their pins, and the published app completed the 7/28/512-token sequence with baseline-identical text. The receiver received the browser's variant and full hash. Production remains at `4d74acdc856b02212cd2a3afa18aa245bcaae189`.
- E02 produced a completed **211-native-token** reply on the same phone page session without a user-observed restart. Native timings were 123.1 seconds of prompt processing and 172.1 seconds of decoding; 173 prompt tokens were evaluated, with zero reuse. The initial Gettysburg response was only 12 native tokens. Content-free diagnostics cannot establish the exact prompts, answer text or word counts. See [the first physical trial](evidence/iphone-compiler-first-trial.json). This supports continuing the candidate, not a completed release gate or causal proof.
- **Next action:** E03 adds verified full local request/response objects, saved active-chat capture, and bounded two-way commands through the opted-in dev channel. Preserve compiler bytes and placement. Use the connected Mac as an additional inspection route. Subsequent GPU-offload restoration is a separate E04 experiment, with the observation policy held fixed across that comparison. Production promotion remains outside these experiments.

## Evidence and its limits

The durable, content-free research snapshot is [evidence/iphone-compiler-research.json](evidence/iphone-compiler-research.json). Raw measurements and harnesses remain in the ignored `work/` directory; those working files are not included in a repository clone.

The archive explicitly identifies compiler, JavaScriptCore, and driver memory outside native accounting. Some later conclusions nevertheless equate finished inference with nothing running. Browser compilation and other asynchronous work can continue after a native request finishes. Flat Wasm, allocator, checkpoint, pipeline, or queue counters therefore cannot establish flat browser footprint.

Our native runtime was exercised in Linux WPE WebKit 26.4 with verified real model bytes and a non-computing GPU substitute. This executes native GPU graph and shader-building paths but allocates no real model-weight GPU buffers and produces no meaningful model answers. External process RSS sampling found:

| Control | Peak RSS after generation in MiB | Interpretation |
| --- | ---: | --- |
| Original binary, first and reverse-order runs | 1531.3 / 1541.5 | Delayed surge reproduced |
| Same binary, OMG optimizing tier disabled | 729.4 / 731.9 | Large reduction with compiler setting changed |
| 15 bodies larger than 40 KB excluded from OMG | 1089.7 | Partial reduction |
| Three shader-building functions excluded | 1562.4 | Does not sufficiently explain the surge |
| Attention-mask wrapper alone excluded | 1450.0 | Does not sufficiently explain the surge |
| Same binary, OMG candidate size limited to 20 KB | 807.7 | Size-range control reduces the surge |
| 51 bodies larger than 20 KB excluded from OMG | 818.1 | Binary control reproduces the reduction |

All these controls ended with the same 274,464,768-byte Wasm capacity, approximately 262 MiB, and one bounded checkpoint. The compiler controls generated 256 native tokens against the GPU substitute. These are **phase-specific peaks after generation**, not the overall construction peaks.

A separate original-binary run waited 25 seconds after Ready before inference. It still reached 1467.6 MiB about 3.8 seconds after inference completed. Back-to-back loading and generation do not alone explain the second surge.

The 51-body binary also passed three retained turns on real Chromium/Vulkan hardware with baseline-identical text and native completion counts of 7, 28, and 512. This establishes execution correctness for those cases, not general model parity or iPhone survival. Fully CPU local controls did not show a reduction in their dominant construction peak; they exercise different placement and code paths.

Linux RSS is not iOS physical footprint, Linux WebKit 26.4 is not the phone's WebKit, and host compiler concurrency can differ. Do not add these RSS figures to phone GPU allocation figures to predict an iPhone peak. The earlier supplied Jetsam report establishes approximately 2 GiB per-process-limit terminations in DuckDuckGo WebContent; it predates the latest restart by almost seven hours. See [the historical report summary](evidence/iphone-jetsam-150503.json).

## Leading experiment

### E01 Qualify the compiler control independently

Prepare a development-only runtime candidate with an explicit variant identity and SHA-256. The existing laboratory binary retains the baseline native build ID, so that ID alone cannot distinguish it. Record exact bytes and hash rather than treating a matching build string as sufficient provenance.

Keep model bytes, GPU placement, context, batches, checkpoint policy, queue policy, prompts, output limits, storage path, and diagnostic policy fixed against the selected baseline. Do not combine this experiment with restoring full GPU placement, changing models, trimming prompts, or adding new per-token instrumentation.

Before the phone trial:

1. Attest the artifact actually fetched and executed, including the complete worker/glue/Wasm combination and effective configuration.
2. Repeat real-GPU deterministic output comparisons and longer retained conversations, including a 512-token response, cancellation and subsequent recovery, and a context reset without reloading weights. The existing three-turn comparison is a starting receipt, not completion of this gate.
3. Repeat phase-specific external process sampling in supported local WebKit controls. Include loading, Ready hold, prefill, generation, and at least 30 seconds after generation. Track the allocation introduced by the control itself and performance changes.
4. Preserve production exclusions. Experimental runtime selection and diagnostics must remain development-only and unavailable on the production hostname after any future source promotion.
5. Write the candidate identity, checks, outcome, and precise phone procedure into this log. Preserve the previous artifact for rollback.

Padding bodies beyond the optimizing compiler size threshold is a diagnostic intervention. It is not an accepted permanent mitigation. A maintainable build or source change requires its own measured memory, correctness, and latency qualification; a smaller Wasm file alone is not evidence of lower compiler memory.

### E02 Run one retained iPhone session

After E01 passes, use the existing diagnostic receiver and durable local saving. Collect available device/browser information automatically. Ask John only for actions or observations that the stream cannot supply.

Use the existing failed baseline as the initial reference; do not demand another unchanged crash simply to repeat it. For the candidate, load once, hold Ready for 30 seconds, send three short prompts, then one long response of up to 512 actual native completion tokens, and observe for at least 30 seconds afterward. Keep the model loaded between steps. If the session survives, continue into longer multi-turn, cancellation, rolling-context, and offline checks as separate recorded stages.

Stop at the first unexpected replacement or white screen. Reconnect/reopen only as needed to recover saved events. Do not repeatedly reconstruct or automatically retry native generation after a loss. Robust download retries remain a separate behavior.

Record actual prompt tokens evaluated/reused, completion tokens, graph work, timings, checkpoint and queue bounds, stream/observer counts, recovered native fences, and page identity transitions. OS termination evidence is valuable when available, but another Jetsam report is not a prerequisite for learning from the run. Label the termination cause unknown when it is unknown.

### E03 Interpret and choose the next branch

| Outcome | Next decision |
| --- | --- |
| Candidate survives the previously failing workload | Treat this as evidence that compiler treatment is protective; repeat paced sessions and qualify margin before attributing the entire failure or accepting a fix |
| Candidate still fails | Check artifact/configuration identity and surviving evidence, then pursue browser footprint and resource lifetime; the local compiler finding remains valid |
| Output differs or the candidate introduces errors | Reject it as a phone candidate and repair the control first |
| Improvement depends on other simultaneous changes | Mark the comparison confounded and isolate those changes locally before another phone campaign |
| Native ledgers remain flat | Continue external/indirect footprint investigation; do not classify the process as memory-stable |

## Other investigative paths

Pursue these as evidence directs, with one primary question per experiment.

| Priority | Path | Discriminating investigation |
| --- | --- | --- |
| 1 | Actual browser footprint | Attribute time-resolved process peaks on real WebKit/GPU hardware when accessible. Controlled touched-ballast measurements can estimate available margin when category attribution is unavailable, but measure their own overhead and avoid repeated destructive trials |
| 2 | GPU driver and resource lifetime | Distinguish submitted work, completed work, object release, and physical reclamation. Examine mappings, readback/staging buffers, driver caches, and live resources; creation counts alone cannot establish residency |
| 3 | Wasm and model-source overlap | Compare capacity with touched physical pages and allocator liveness; audit source handles, read windows, upload copies, and release boundaries during construction and first use |
| 4 | JavaScript and observer pressure | Run a same-runtime comparison of current versus bounded/coalesced observation with identical native work. Count messages, serialization, retained objects, durable writes, and outbox bounds. Historical Mac observer results do not qualify the phone |
| 5 | Hybrid recurrent state | Use a dense attention-only model as one mechanism control after the shared paths are better constrained. Differences in model size, kernels and workload are confounds; a different model surviving would implicate, not uniquely prove, a hybrid defect |
| 6 | Lifecycle and deliberate teardown | Audit worker termination, visibility transitions, context/device loss, admission failures and teardown reasons. Preserve this classification alongside every branch; earlier research found successful Ready followed by an intentional application termination misclassified as an OS loss |

## Qualification and stop rules

The investigation closes only when a maintainable candidate completes repeated paced sessions on the actual device, including loading, sustained multi-turn and long generation, cancellation/recovery, rolling reset, offline generation and offline reopen. Keep model weights retained through each applicable sequence. Document observed margin and measurement limits; do not choose a headroom threshold merely because one short reply passed.

Require bounded checkpoint, queue, observer and allocator behavior, plus evidence about browser-process peaks. The migration and production promotion remain open until the [release acceptance](ACCEPTANCE.md) device gate is satisfied. A finite test campaign establishes the tested operating envelope, not universal crash freedom.

Stop unchanged crash repetitions, short-answer-only qualification, and attempts to turn an unknown process loss into a handled-error diagnosis. Do not silently replace the model, cap answers to conceal the failing workload, or repeatedly shrink context/batches without a discriminating measurement. Preserve user conversation data and the disclosed diagnostic privacy boundary.

## Experiment log

Dates below are UTC. Historical entries are a research baseline; linked receipts define their narrower scope.

| Date | Experiment or decision | Outcome and consequence |
| --- | --- | --- |
| 2026-10-30 | Bounded native GPU queue and checkpoint policy reviewed | Bounds were attested, but the phone still restarted; those bounds do not establish total process margin |
| 2026-10-30 | Existing reduced GPU placement on iPhone | Automatic download/load reached Ready; longer generation restarted. Placement alone is insufficient; see [placement receipt](evidence/dev-model-placement.json) |
| 2026-10-30 | Historical Jetsam report correlated | Earlier WebContent per-process-limit losses confirmed; latest restart cause remains unproved |
| 2026-10-30 | Historical research audited | Prompt/dose narratives revised, observer controls scoped to Mac, stale source accounting and deliberate teardown distinguished from OS loss |
| 2026-10-30 | Independent upstream compiler example reproduced in both orders | Delayed browser allocation reproduced without model weights or GPU; establishes the mechanism class locally |
| 2026-10-30 | Fully CPU app controls | Dominant construction peak not removed by padding or valid OMG-off setting. An earlier run using invalid `JSC_useWasmOMGJIT` was rejected; the valid option is `JSC_useOMGJIT` |
| 2026-10-30 | Native GPU-path compiler controls | Normal versus OMG-off delayed peaks reproduced in reverse order; native capacity identical |
| 2026-10-30 | Narrow function controls | Three shader builders and the attention-mask wrapper individually insufficient; retain these negative results |
| 2026-10-30 | 20 KB candidate-size setting and 51-body binary control | Both substantially reduced the local delayed peak. Three real-GPU turns matched baseline text and token counts |
| 2026-10-30 | Loading separated from inference by a 25-second hold | A second delayed surge persisted after inference; timing overlap alone is insufficient |
| 2026-10-30 | Plan adopted | Prioritize compiler-control qualification, then a single retained iPhone session. E01 remains pending beyond the existing laboratory checks; no research candidate deployed |
| 2026-10-30 | E01 candidate prepared | Reproducible 51-body transform reconstructs the exact baseline; worker, wrapper and inference settings preserved. Dev build metadata and startup diagnostics distinguish the variant from its unchanged native build string |
| 2026-10-30 | E01 parity and full-GPU endurance | Baseline-identical text and 7/28/512-token turns; ten retained candidate turns plus cancellation/recovery, fresh-context reset, offline reply and hold passed. All 35 repository checks passed, including production exclusion |
| 2026-10-30 | E01 insufficient workload corrected | Initial integer-list fixture abbreviated its response to 13 tokens. Rejected as a long-generation stimulus, then reran using the verified 512-token sequence; this was a fixture limitation, not an application crash |
| 2026-10-30 | E01 phase measurement repeated | With 30-second Ready and post-generation holds, after-generation peaks were 1531.6 MiB baseline and 818.8 MiB candidate in the local non-computing GPU control. Actual iPhone margin remains unmeasured |
| 2026-10-30 | E01 reduced-placement long response | The desktop phone-placement profile completed 7-token and 512-token replies with unchanged 945,422,336-byte Wasm capacity and zero pending graph batches. The additional long-continuation run was intentionally stopped by the operator because of expensive CPU prefill; it is not a completed ten-turn result or a crash. Reduced-placement cancellation/reset/offline checks use a separate focused session |
| 2026-10-30 | E01 focused reduced-placement checks | Three short turns, cancellation and subsequent reply, fresh-context reset without reloading weights, offline generation, and a 30-second hold passed in a separate activation. Initial candidate qualification is recorded in [the E01 receipt](evidence/dev-compiler-control.json); physical iPhone comparison remains open |
| 2026-10-30 | E01 development deployment verified | [Workflow 41012496116](https://github.com/JournalFoundation/privatelocalchat/actions/runs/41012496116) deployed `eb8a16d`. Runtime read-back hashes matched all three pins; published real-GPU 7/28/512-token replies matched the independent baseline. Receiver provenance verified; production unchanged. E02 requested and awaiting the physical candidate session |
| 2026-10-30 | Published parity helper corrected | Candidate-only live mode initially compared its result to itself. An independent comparison of the saved published output against the earlier baseline confirmed all three replies and token counts match; the operator helper now requires that separate baseline receipt |
| 2026-10-30 | E02 initial phone trial | The user multitasked during downloading, resumed, and reached automatic Ready in 5.35 seconds. Three short replies and an initial 12-token Gettysburg reply completed. A subsequent longer reply completed 211 native tokens with no observed replacement; same page identity, one checkpoint, fixed Wasm capacity and zero pending graph batches. Exact prompt/answer content and 50-word compliance were not captured |
| 2026-10-30 | E03 live Safari finding | Live Cloudflare browser command/reassembly proof passed. USB Safari preserved model files and settings, but the diagnostic IndexedDB open stalled while a fresh test database and OPFS journal read completed. Bound storage waits, keep memory uploads working and avoid forcing an existing-journal schema upgrade. Do not classify this as an inference crash |
| 2026-10-30 | E03 local qualification | 45 tests passed; real Chromium/Vulkan completed 512 native tokens, reconstructed all 514 stream objects and matched terminal/UI text. Remote state, chat, profile, load, prompt, stop and unload passed. See [receipt](evidence/dev-two-way-control.json). Live deployment and physical remote generation remain to verify |
| 2026-10-30 | USB route enabled | Remote Automation permission enabled by John; created a separate phone Safari context, evaluated the actual dev build and configured its own receiver without using the other project’s tab. This is additional Safari evidence, not a substitute for ordinary phone-browser qualification |
| 2026-10-30 | E03 scope authorized | User explicitly requested full prompt/response objects, streamed token text, and remote control through the user-entered receiver URL. Implement development-only consent, command/result receipts, crash-safe non-replay, and agent-driven tests. Existing content-free sessions must not silently enable content capture without local choice or their owner's explicit session authorization |
| 2026-10-30 | Mac route restored | Active Mac SSH endpoint discovered; a separate Safari window opened for this app and its build read successfully through JavaScript. USB phone-target attachment is still being established; other project windows and inspector sessions must remain untouched |

## How to maintain this plan

After every meaningful experiment or decision, update the current state and next action, append a dated log entry, and add or link a content-free evidence receipt. Record failed, invalid, inconclusive and confounded results as explicitly as passes. Correct earlier interpretations with a dated correction rather than silently erasing the history.

Each new receipt should identify the question, baseline and candidate hashes, changed variable, hardware/browser, effective configuration, observer policy, workload and actual native work, phase-specific measurements, result, limitations, and resulting decision. Separate wall-clock UTC timestamps from elapsed times and observation from inference. Persist enough summary/provenance in Git that loss of ignored working files does not erase the finding.

Keep raw device reports, private telemetry, receiver URLs/capabilities, credentials, device identifiers and conversation content outside Git. Public summaries must honor the existing diagnostics disclosure. Commit plan and receipt updates together when practical. A documentation update does not itself authorize or imply deployment or promotion; keep the deployment status explicit.

## References

- [Development diagnostics](DEV-DIAGNOSTICS.md), [native runtime operations](../ops/native/README.md), and [runtime provenance](RUNTIMES.md).
- [WebKit bug 304810](https://bugs.webkit.org/show_bug.cgi?id=304810), including a reported compiler-memory failure on iOS 26.6.2 build 23G90. Similarity does not establish this app's latest failure cause.
- [Independent compiler reproduction](https://github.com/frankhinek/webkit-wasm-compiler-memory-repro), inspected at revision `16fb14700468a866bee731666060af274eb91d85`.
- Local historical sources: `/srv/speechtest-lab-data/`, `/srv/speechtest-recovered/docs/`, `/srv/speechtest-cleanroom/WAVE2-CHANGES.md`, and `/srv/vitruvian/docs/residency-execution-plan.md`. Their conclusions apply to their attested configurations, not automatically to this app.
- Detailed local synthesis and original receipt hashes: `work/evidence/iphone-memory-research.json`. Experiment harnesses and raw samples remain under `work/`.

### USB automation scope

The USB WebDriver route creates an isolated Safari automation session. Its storage starts empty
and is discarded when that session ends; it cannot certify ordinary PWA persistence across
new automation sessions. Keep a single session alive for download, load and conversation trials.
The normal Safari window on the Mac is a separate comparison, with its own diagnostic receiver.
See [WebKit’s iOS WebDriver isolation description](https://webkit.org/blog/9395/webdriver-is-coming-to-safari-in-ios-13/).

On build 997bf35, physical remote state/chat/load commands received acknowledged receipts. Two
loads with the native recorder enabled returned InvalidStateError before native construction.
Disabling that recorder allowed model parsing to progress, but subsequent telemetry and USB
responses stopped. No new relevant iOS crash report was available at inspection time. This
localizes a recorder-sensitive startup failure without proving the reason for the later loss.
The app reports the unavailable IndexedDB fallback explicitly; it cannot promise durable offline
capture while that fallback is active. A fresh uninterrupted automation-session trial is next.

### Storage-worker cleanup follow-up

The fresh USB session repeatedly retained 3 verified files (564,402,176 bytes) while later writes
reported `Failed to write to file`. The model-download request retried automatically. Stop that
unchanged repetition to investigate cleanup. The device identifies as iPhone16,1 on iOS 26.6.2
build 23G90 and reports roughly 76.5 GB data space available.

Inspection found a concrete vendored-writer lifetime defect: an open rejection occurs before
the returned close function exists; a close rejection skips `worker.terminate()`. The application
now owns model-cache writes with unconditional worker termination, input cancellation and
bounded operation waits. Cache keys, metadata, model hashes and pinned native bytes are retained.
The [cleanup receipt](evidence/opfs-writer-cleanup.json) records fault tests and actual browser
cache-manager integration. A causal role in historical phone failures remains unproven.

The normal Mac Safari window completed 7- and 512-native-token replies through the live command
channel. All 550 captured objects were complete; stream text, terminal text, requests and saved
chat matched. The long reply took about 1.05 seconds of prefill and 20.39 seconds of decoding.
See [the Safari receipt](evidence/dev-safari-two-way-control.json). This is real WebKit/Metal
evidence, not physical iPhone acceptance. Separately, 51 content frames survived an actual
desktop browser close/reopen offline, stayed queued after an invalid acknowledgement and
drained after a valid acknowledgement with exact object reconstruction.

### Physical storage finding and correction

The fresh writer still encountered failures. A bounded USB system-log capture then recorded
APFS ENOSPC (errno 28) for WebKit.Networking and other iOS services. A tiny independent OPFS
probe returned the generic UnknownError text suggesting an unknown reason, for example memory;
that JavaScript wording did not reveal the actual no-space failure. Preserve reason-agnostic
retry and cleanup rather than inferring the cause from that message.

**Correction:** the earlier 76.5 GB `TotalDataAvailable` reading was not usable immediate
headroom. After removing this isolated automation session’s 564,402,176 model bytes, the device
reported only 505,454,592 bytes in `AmountDataAvailable`. Its normal browser chats/model files
were not touched. The test download intent was cancelled and zero model bytes remained in the
isolated session. Ask for at least 3 GB of real headroom before another model download.
The [storage receipt](evidence/iphone-usb-storage-failure.json) records this finding and scope.
This explains the observed write failures, not all previous generation-time restarts.

E03 has live Chromium and normal macOS Safari command/full-stream proof. Physical iPhone
commands, receiver configuration, downloads and load-failure capture were exercised unattended,
but remote physical generation and durable offline qualification remain open. Production stays
at its previously deployed commit; do not promote this work based on desktop success.
