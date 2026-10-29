# Development native checkpoints

The diagnostic compatibility runtime derives from the pinned product-slim v1q native
sources. Its only source changes are the build identity and numeric PRE/POST checkpoints
in `iphone-tail-diagnostics.patch`. Model files, load wire (69 request / 23 response fields),
context, batch sizes, kernel policies, and checkpoint ownership are unchanged.

`dev-tools/native-runtime/manifest.json` binds the source-input hashes, patch hash, compiler
release, and published artifact sizes/hashes. The build uses Emscripten 4.0.20, compatibility
Wasm32/Asyncify, WebGPU, product-slim, and the same 96 MiB link-time floor as the base runtime.
The application continues to request its existing 128 MiB initial runtime memory.

To rebuild from the corresponding pinned source tree and an Emscripten 4.0.20 SDK:

```sh
python ops/native/build-debug-runtime.py \
  --source /path/to/pinned-native-source \
  --toolchain /path/to/emscripten-4.0.20/install \
  --node /path/to/node \
  --workdir /path/to/new-isolated-build
```

The script verifies source and patch pins, copies into a fresh directory, applies the patch,
and builds there. It preserves the input checkout and active SDK configuration. Generated
artifacts are written under the isolated build's `runtime/`; compare their manifest before
replacing the checked-in dev artifacts. Keep upstream MIT/BSD notices with distributions;
the unchanged notices remain in the normal vendored runtime directory.

Only `dev` builds overlay these three files and the expected runtime identity. Production
builds retain the original runtime bytes, including after a source promotion. Unit checks
verify both artifact identities. The debug runtime paths are served only on the exact
`dev.privatelocal.chat` hostname. The compatibility build is the app's existing forced path;
the untouched default Wasm is not part of this diagnostic variant.

Phase 11 fences cover the post-graph native loading path:

| Operation | Boundary |
| --- | --- |
| 1 | Sequence-removal capability check |
| 2 | Initial memory clear |
| 3 | Two-token capability decode |
| 4 | Partial-sequence removal |
| 5 | Final memory clear |
| 6 | Capability-check synchronization |
| 7 | Common model/context initialization |
| 8 | Slot reset |
| 9 | Batch initialization |
| 10 | Server initialization |
| 11 | Chat-template parsing |
| 12 | Chat-template example formatting |
| 13 | Native load-model wrapper |
| 14 | Final GPU upload drain |
| 15 | Metadata receipt construction |

Phase 12 covers graph allocation (1), split allocation (2), split computation (3), async
graph computation (4), and backend synchronization (5). Those additional graph fences stop
when native readiness is reached. Edge 1 is PRE and edge 2 is POST. Counters are allocation
observations rather than process RSS. A last PRE identifies an interrupted interval, not a
confirmed OS memory-kill diagnosis.

The compatibility worker also connects its actual WebGPU buffer/pipeline creation sites
to the existing post-Ready counters. `instrument-webgpu.mjs` applies this transformation
after compilation and refuses ambiguous sites. These counters measure cumulative creation,
not live residency or process RSS. Earlier dev builds defined the counters without calling
them; their zeros do not establish an absence of post-Ready allocations. The production
worker remains unchanged.

The queue variant applies `iphone-queue-bound.patch` after the tail patch and
uses build identity `privatelocalchat-queue-20261029-v2`. The manifest pins both
patches and the additional original backend source. Its default profile submits
32 kernels per batch, limits outstanding graph batches to two across graph
boundaries, and waits for queue completion at each graph end. The default backend
previously had an unlimited configured maximum.

Same-binary laboratory controls use Emscripten ENV `PLC_WEBGPU_MAX_INFLIGHT`
(0 selects the unbounded control; default 2) and `PLC_WEBGPU_SUBMIT_BATCH`
(default 32). They are not product UI settings. Generation diagnostics expose
`webGpuQueue`: submitted and explicitly completed graph batches, pending count,
in-flight high-water, wait count/time, graph evaluations, and actual policy values.
These are command-accounting counters, not physical GPU memory measurements.
Phase14/op1/POST stores a sparse summary every16 graphs: operationSerial=graph
count; slots176/184/192/200=submitted/completed/waits/in-flight high-water.

See `docs/evidence/dev-queue-policy.json` for the same-binary real-GPU comparison.
All three arms completed the retained workload; the bounded arms attested maximum
two outstanding graph batches and zero pending batches at generation completion.
iPhone retained-operation qualification remains open.

## Production native runtime

`production-runtime.json` pins the production artifacts, original source inputs, wrapper
and queue patch. It uses two in-flight graph batches, 32 kernels per submission and
queue completion at each graph end. The full 4096-token window remains available.

Rebuild with the pinned Emscripten 4.0.20 toolchain in a new isolated directory:

```sh
python3 ops/native/build-debug-runtime.py \
  --manifest ops/native/production-runtime.json \
  --source /path/to/pinned/wllama \
  --toolchain /path/to/emscripten-4.0.20/install \
  --node /path/to/node \
  --workdir /path/to/new-output
```

The script verifies source and wrapper hashes before applying the patch. Despite its
legacy filename, the selected production manifest disables development instrumentation.
Only the three pinned runtime files are copied into the app. Operator scripts and
profile manifests are not served by the site. Preserve upstream notices in the vendor
directory. Development uses a separate instrumented artifact.

See `docs/evidence/production-queue-candidate.json` for local real-browser checks.
Those checks do not establish iPhone reliability or a production deployment.
