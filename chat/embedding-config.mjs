// Where the small embedding model comes from, and what it is. This is the ONE place that names the host and the version.
//
// The model files and the ONNX Runtime WASM are a content-addressed set that the owner's other project, Sonalon, already publishes on its
// asset CDN: the version below is the first 16 hex digits of the SHA-256 of every file's path and hash, so a changed byte is a new path and
// the objects are immutable. The CDN sends CORS (`*`) and CORP (`cross-origin`), which this site's cross-origin isolation (COEP) needs.
//
// To serve the same files from this project's own asset host later: upload the set (docs/EMBEDDINGS.md says how) to
//   https://assets.privatelocal.chat/models/memory/<version>/   (embed/... and runtime/ort-wasm-simd-threaded.{mjs,wasm})
// and change EMBEDDING_ASSET_HOST (and the version, if the set changed) below. Nothing else needs to change.

export const EMBEDDING_ASSET_HOST = "https://assets.sonalon.com/models/memory/";
export const EMBEDDING_ASSET_VERSION = "79cbff1e617b319a";
export const EMBEDDING_MODEL_BASE = `${EMBEDDING_ASSET_HOST}${EMBEDDING_ASSET_VERSION}/`;
export const EMBEDDING_WASM_BASE = `${EMBEDDING_MODEL_BASE}runtime/`;

export { EMBEDDING_MODEL } from "./embedding-model.mjs";
