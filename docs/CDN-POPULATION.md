# Populating the CDN (task for an agent or operator with Cloudflare access)

> ## DONE (2026-11-02): the search model is on the project CDN
>
> `ops/cloudflare/publish-embedding.py` uploaded all 10 objects (36,858,671 bytes) to `models/memory/79cbff1e617b319a/` and verified each over
> the public URL (bytes, CORS, content type). The app now reads it from `https://assets.privatelocal.chat/models/memory/`; Task 2 below is done
> and `tests/e2e/ivr-semantic.e2e.mjs` passes against the new host. Task 3 is still open.

**Rule:** every model file the app downloads, of any kind (language, search, and later speech-to-text and text-to-speech), is served from one
host: `https://assets.privatelocal.chat` (R2 bucket `privatelocalchat-assets`, provisioned by `ops/cloudflare/provision-cdn.py`; see
`ops/cloudflare/CDN-OPERATIONS.txt`). The app should not depend on another project's storage or on Hugging Face / GitHub at run time.

## State on 2026-11-02

| Kind | On `assets.privatelocal.chat`? | Notes |
|---|---|---|
| Qwen3.5-9B WebLLM (q4f16_1, q4f32_1) and Qwen3.5-2B GGUF | **Yes** (275 objects, 11.3 GB, `models/catalog.json`) | Done. Verified by `ops/cloudflare/verify-cdn.py`. |
| Small search model for Roberta (MongoDB/mdbr-leaf-ir int8 ONNX + ONNX Runtime WASM, about 37 MB) | **Yes** (10 objects, `models/memory/79cbff1e617b319a/`) | Done 2026-11-02; app switched over. |
| LFM2.5-2.6B Q3_K_M (6 files, 1.37 GB) and Granite 4.0 H 1B Q4_K_M (12 files, 0.90 GB) | **Yes** (published 2026-11-02 with `ops/cloudflare/publish-gguf.py`, listed in `models/catalog.json`) | Every file was downloaded from the earlier host, checked against its SHA-256, uploaded, and read back over the public URL. Licences are stored beside the weights. |
| Text-to-speech, speech-to-text models | Not used yet (the app uses the browser's own speech services) | Later; follow the layout below. |

Coding sessions have no Cloudflare credentials, so this could not be done there. `ops/cloudflare/publish-embedding.py --dry-run` was run in
such a session on 2026-11-02: all eight files downloaded from the current host and matched their pinned SHA-256 values. Nothing was uploaded.

## Task 1: publish the search-model set

1. Machine with the operator token at `/root/.config/privatelocalchat/cloudflare-api-token` (outside Git; never print or copy it) and `boto3`.
2. `python3 ops/cloudflare/publish-embedding.py --dry-run` should end with `10 objects, 36858671 bytes` and no MISMATCH.
3. `python3 ops/cloudflare/publish-embedding.py` uploads to `models/memory/79cbff1e617b319a/` (same version string and layout as the source, so
   the bytes are provably the pinned ones), with `Cache-Control: public, max-age=31536000, immutable` and a `sha256` metadata value per object.
   It keeps identical existing objects, refuses to replace different ones, then re-downloads every object from the public URL with
   `Origin: https://privatelocal.chat` and checks bytes, CORS and content type. Exit code 0 means all good.
4. Check by hand what the script only prints: `Cross-Origin-Resource-Policy`. The app is cross-origin isolated (COEP `require-corp`). The
   worker fetches with CORS, which is enough, but if the existing model rules do not add `cross-origin-resource-policy: cross-origin`, add it
   to the response-header transform in `provision-cdn.py` (the same rule that sets `no-store` on weights) so any non-CORS load also works.
   `.wasm` must come back as `application/wasm`. Range requests are not needed for this set.
5. Do not publish the source set's `rerank/` files: the app never fetches them.

## Task 2: point the app at the CDN (done)

`EMBEDDING_ASSET_HOST` in `chat/embedding-config.mjs` is `https://assets.privatelocal.chat/models/memory/`; the Privacy page, the Updates entry and
`docs/EMBEDDINGS.md` say the same, and `tests/e2e/ivr-semantic.e2e.mjs` proves the real model loads from the project host and that a reload
makes no request to it (Cache API).

## Task 3: stop depending on other hosts for models

`docs/TECHNICAL-DEBT.md` item 15: the catalogue defaults still name Hugging Face, `raw.githubusercontent.com` and `media.techofourown.com`,
overridden at run time by `local-models.js`. Make the defaults point at `assets.privatelocal.chat` so a forgotten override cannot change where
files come from. Then simplify the three "No, a catalogue default" rows on the Privacy page.

## Adding another language model (the recipe used for LFM2.5 and Granite)

1. Describe it in `ops/cloudflare/gguf-models.json` (source host, per-file size and SHA-256, destination prefix, licence file, load context and sampling).
2. `python3 ops/cloudflare/publish-gguf.py <key> --dry-run`, then without `--dry-run` (needs boto3 and the operator token; a throw-away venv works). It refuses to replace a different object.
3. `python3 ops/cloudflare/update-catalog-index.py` adds it to the public `models/catalog.json` index and to `model-cdn-manifest.json`.
4. Add it to `runtime/providers/catalog-data.mjs` and a tier in `runtime/providers/catalog.mjs`, an option in `index.html`'s `localModelSelect`, the Privacy page and the Updates feed.
5. Prove it with a real download: `node work/check-new-models.mjs <tier> <origin>` (download, verify, load, generate, unload, remove; writes `docs/evidence/model-<tier>-cdn-check.json`).

## Layout convention for anything new (speech models later)

* `models/<family>/<pinned revision or content hash>/<files>`: one immutable directory per version; a changed byte is a new path. Existing
  families: `models/Qwen3.5-9B-*-MLC/resolve/<commit>/`, `models/Qwen3.5-2B/<revision>/`, `models/memory/<hash>/`. Suggested for later:
  `models/tts/<name>/<revision>/` and `models/stt/<name>/<revision>/`.
* Pin every file by SHA-256 in the repository (a manifest or `pinned-model-catalog.json`), and check it in the publisher and, where files are
  large, in the app.
* Ship the upstream LICENSE next to each model. Add the model to `models/catalog.json` and the Privacy page's downloads table in the same change.
* Never overwrite an object. CORS must allow `https://privatelocal.chat` and the dev origin; weights (`.gguf`, `.bin`) get `no-store` from the
  existing transform so the offline copy is the app's own; everything else is `immutable`.
* Large files are kept by the app in OPFS or the Cache API, not in the service worker precache.

## Done means

All objects verified over the public URL; the app reads the search model from `assets.privatelocal.chat`; the Privacy page, Updates entry,
`docs/EMBEDDINGS.md` and the debt list say the same; the dev site shows Roberta matching speech with the model served from the project CDN.
