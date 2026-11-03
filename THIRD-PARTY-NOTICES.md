# Third-party notices

Private Local Chat is released under the **GNU General Public License, version 3** (`LICENSE`). Earlier releases were published under the Apache License 2.0 and remain available under it for the code they contained. The change takes effect with the release that first bundles the voice engine described below.

## Software bundled with the app

| Component | Used for | Licence | Source |
|---|---|---|---|
| **eSpeak NG** (embedded in the npm package `phonemizer` 1.2.1, file `chat/vendor/voice/worker.js`) | Turning text into phonemes for the optional downloaded read-aloud voices (Kitten and Kokoro) | **GPL-3.0-or-later** | https://github.com/espeak-ng/espeak-ng |
| `phonemizer` 1.2.1 (JavaScript wrapper, by Xenova) | Loads the eSpeak NG build above | Apache-2.0 | https://github.com/xenova/phonemizer.js |
| ONNX Runtime Web 1.31.1 | Runs the voice model in the browser (`chat/vendor/voice/`) | MIT | https://github.com/microsoft/onnxruntime |
| fflate 0.8.3 | Reads the voice file archive | MIT | https://github.com/101arrowz/fflate |
| pdf.js (`chat/vendor/pdfjs/`, Mozilla Foundation) | Reading PDF attachments | Apache-2.0 (notice at the top of the file) | https://github.com/mozilla/pdf.js |
| QRCode.js (`chat/vendor/qrcode.js`) | Share and transfer QR codes | MIT, Copyright (c) 2012 davidshimjs. The file is byte-identical to upstream `qrcode.min.js` (19,927 bytes, SHA-256 starting `c541ef06`); the licence text is `chat/vendor/qrcode.js.LICENSE` | https://github.com/davidshimjs/qrcodejs |
| noble-hashes (`runtime/providers/vendor/noble-hashes/`) | SHA-256 checks of downloaded files | MIT | https://github.com/paulmillr/noble-hashes |
| wllama and the llama.cpp engine inside it (`runtime/providers/vendor/wllama/`) | Running GGUF models | MIT | https://github.com/ngxson/wllama |
| WebLLM, transformers.js and the other runtimes listed in `docs/RUNTIMES.md` and `docs/EMBEDDINGS.md` | On-device language models and search | Apache-2.0 / MIT, see those documents | see those documents |

The complete corresponding source of every GPL-covered part is this repository, which also contains the script that rebuilds the voice worker (`ops/voice/`, see `docs/VOICE-RUNTIME.md`). The eSpeak NG source is available at the address above. Apache-2.0 and MIT components are combined with this program under the terms of GPL-3.0, which permits it.

## Models (downloaded files, not part of the program)

| Model | Used for | Licence | Hosted at |
|---|---|---|---|
| Kitten TTS nano 0.8 (int8), KittenML | Optional natural read-aloud voice | Apache-2.0 (model card) | `models/Kitten-TTS-Nano-0.8-int8/` on the project asset host, with its licence text beside the files |
| Kokoro-82M v1.0 (q8 ONNX), hexgrad / onnx-community | Optional, more natural read-aloud voice on devices that can run it | Apache-2.0 (model card). The model card names training audio under CC BY 3.0 (Koniwa) and CC BY 4.0 (SIWIS), plus synthetic audio; the data notice is stored with the licence text | `models/Kokoro-82M-v1.0-ONNX-q8/` on the project asset host, with its licence text beside the files |
| Qwen3.5, LFM2.5, Granite 4.0 | On-device chat | Apache-2.0, LFM Open License v1.0 | see `docs/RUNTIMES.md` and the licence text stored beside each model |

Model files are separate works. Their licences, not the GPL, apply to them.
