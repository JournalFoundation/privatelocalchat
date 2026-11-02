# Populating the CDN (task for an agent or operator with Cloudflare access)

> ## ACTION REQUIRED: someone with the Cloudflare token must run ONE command
>
> The CDN `assets.privatelocal.chat` is **missing the small search model** that Roberta uses (about 37 MB). Until it is uploaded, the app
> downloads it from another project's host (`assets.sonalon.com`). A coding session could not upload it: it has no Cloudflare credentials
> and GitHub refuses workflow files from it. Everything else is ready and the files were already verified byte for byte (dry run).
>
> **Option A: from any machine with the operator token (about 1 minute):**
>
>     git checkout claude/lucid-tesla-qhjgmk        # or main once merged
>     pip install boto3
>     python3 ops/cloudflare/publish-embedding.py --dry-run     # must end "dry run: nothing uploaded", no MISMATCH
>     CLOUDFLARE_API_TOKEN=<token> python3 ops/cloudflare/publish-embedding.py    # or leave the variable unset and use
>                                                                                  # /root/.config/privatelocalchat/cloudflare-api-token
>
> It must finish with `OK` for all 10 objects and exit 0. The token needs R2 write access to bucket `privatelocalchat-assets`.
>
> **Option B: from GitHub (uses the repo secret `CLOUDFLARE_API_TOKEN`):**
>
>     git mv ops/cloudflare/publish-cdn-assets.workflow.yml .github/workflows/publish-cdn-assets.yml
>     git commit -m "ci: publish CDN assets" && git push
>
> then Actions -> "Publish CDN assets" -> Run workflow (it also runs on a push to the branch named in the file). It fails with a clear error if
> the secret's token cannot write to R2; use Option A then. Remove the workflow afterwards if you do not want it kept.
>
> **After it succeeds, tell the next coding session "the CDN is populated"** and it will do Task 2 below (point the app at the CDN,
> fix the Privacy page, re-run the real-model browser test). Do NOT change `EMBEDDING_ASSET_HOST` before the upload is verified: Roberta's
> semantic matching would silently fall back to keywords.

**Rule:** every model file the app downloads, of any kind (language, search, and later speech-to-text and text-to-speech), is served from one
host: `https://assets.privatelocal.chat` (R2 bucket `privatelocalchat-assets`, provisioned by `ops/cloudflare/provision-cdn.py`; see
`ops/cloudflare/CDN-OPERATIONS.txt`). The app should not depend on another project's storage or on Hugging Face / GitHub at run time.

## State on 2026-11-02

| Kind | On `assets.privatelocal.chat`? | Notes |
|---|---|---|
| Qwen3.5-9B WebLLM (q4f16_1, q4f32_1) and Qwen3.5-2B GGUF | **Yes** (275 objects, 11.3 GB, `models/catalog.json`) | Done. Verified by `ops/cloudflare/verify-cdn.py`. |
| Small search model for Roberta (MongoDB/mdbr-leaf-ir int8 ONNX + ONNX Runtime WASM, about 37 MB) | **No.** Served today from `assets.sonalon.com/models/memory/79cbff1e617b319a/` | **This is the task.** |
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

## Task 2: point the app at the CDN (a code change, after Task 1 verifies)

1. `chat/embedding-config.mjs`: change `EMBEDDING_ASSET_HOST` to `https://assets.privatelocal.chat/models/memory/`. Keep `EMBEDDING_ASSET_VERSION`.
2. `privacy/index.html`: in the downloads table, change the search-model row's host to `assets.privatelocal.chat (the project's own storage)`
   and drop "a sister project's storage, for now"; run `node scripts/public-site.mjs sync`. In `updates/entries.json` change the bullet that
   says the model comes from `assets.sonalon.com`. Delete item 27 in `docs/TECHNICAL-DEBT.md`.
3. `docs/EMBEDDINGS.md`: state that the set is on the project host; keep the Sonalon note only as provenance.
4. `npm test`, `node tests/e2e/ivr-semantic.e2e.mjs` (it downloads the real model through `EMBEDDING_ASSET_HOST`, so it proves the new host works
   from `https://privatelocal.chat`-style isolation), then the dev deploy (`docs/OPERATIONS.md`) and a check in a real browser that Roberta's
   search model loads from `assets.privatelocal.chat` (network panel) and that a reload makes no request to it (Cache API).

## Task 3: stop depending on other hosts for models

`docs/TECHNICAL-DEBT.md` item 15: the catalogue defaults still name Hugging Face, `raw.githubusercontent.com` and `media.techofourown.com`,
overridden at run time by `local-models.js`. Make the defaults point at `assets.privatelocal.chat` so a forgotten override cannot change where
files come from. Then simplify the three "No, a catalogue default" rows on the Privacy page.

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
