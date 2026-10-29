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
