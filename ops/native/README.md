# Production native runtime

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
