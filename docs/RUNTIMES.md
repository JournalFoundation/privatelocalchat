# Model and runtime provenance

The model catalogue is pinned in `runtime/providers/catalog-data.mjs`. Public delivery URLs use only the project's asset domain, configured in `local-models.js`.

- Qwen3.5-9B: `mlc-ai/Qwen3.5-9B-q4f16_1-MLC` revision `c7c5d3f5a81e37b8facbb72970940a1b131314a8`, or `mlc-ai/Qwen3.5-9B-q4f32_1-MLC` revision `f8f042bfb68cb88573af4c8e0ef9b1a26bef4ad0` when shader-f16 is unavailable. Both are derived from the Apache-2.0 Qwen model. Each variant has a matching pinned compiled model library.
- Qwen3.5-2B: source revision `15852e8c16360a2fea060d615a32b45270f8a8fc`, Apache-2.0, quantized as Q4_0 GGUF with 13 shards.
- WebLLM 0.2.86: Apache-2.0. Its license accompanies the vendored bundle.
- wllama: retained `v1q-chat-stable-slim-20260901` build of wllama/llama.cpp, MIT. `default.wasm`, `compat.wasm`, `compat-worker.js`, and `wllama.js` must remain together. The older 2.x runtime is not compatible with this configuration.

The public catalogue and `ops/cloudflare/model-cdn-manifest.json` record every model file's exact size, SHA-256, and immutable URL. `model-object-verification.json` records a complete destination read-back and hash verification; `public-cdn-verification.json` records browser-delivery HTTP checks.

Upstream projects: https://github.com/mlc-ai/web-llm, https://github.com/ngxson/wllama, https://github.com/ggml-org/llama.cpp, https://huggingface.co/Qwen/Qwen3.5-2B, https://huggingface.co/Qwen/Qwen3.5-9B.
