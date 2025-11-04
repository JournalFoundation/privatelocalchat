# Private Local Chat
**Single‑file, privacy‑first chat UI for OpenAI‑compatible APIs.**
Zero dependencies · Works offline · Your chat history stays in your browser

```
privatelocalchat/
├── LICENSE
├── README.md
├── CONTRIBUTING.md
└── index.html
```

**Private Local Chat** is a tiny, self‑contained HTML app (one file!) that lets you chat with any OpenAI‑compatible endpoint while keeping your chat history **local**. The API can generate replies, but it never sees your stored chat history unless you send it in a message. You can save the page, open it offline, and import/export your chats or settings as portable JSON.

This project is offered by **[Journal Foundation](https://journalfoundation.org)** as a simple, auditable demo of privacy‑aware UI patterns. It also previews ideas that will grow into **[JournalNet](https://github.com/JournalFoundation/journalnet)**—a more capable system for private sync, end‑to‑end encryption, and sharing.

---

## Table of Contents
- [Why Private Local Chat?](#why-private-local-chat)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Supported Providers & Endpoints](#supported-providers--endpoints)
- [Import / Export & Preloaded Links](#import--export--preloaded-links)
- [Data Storage & Privacy](#data-storage--privacy)
- [Deployment](#deployment)
- [Customization](#customization)
- [Accessibility & Keyboard](#accessibility--keyboard)
- [Troubleshooting](#troubleshooting)
- [Roadmap: JournalNet](#roadmap-journalnet)
- [License](#license)

---

## Why Private Local Chat?

- **Local-first:** Chats are stored in your browser (`localStorage`). No backend. No database.
- **Portable:** It's literally a single `index.html`. Save it and run anywhere—desktop or mobile.
- **Compatible:** Works with OpenAI‑style `/v1/models` and `/v1/chat/completions` APIs (including many third-party gateways and local runtimes).
- **Auditable:** Inline HTML/CSS/JS; easy to read and fork.
- **Practical:** Import/export your chats and configuration. Preload a title/system/prompt via URL.

---

## Quick Start

### 1) Run the app
- **Easiest (desktop):** Open the hosted page, then **Right‑click → Save Page As…** and open the saved file locally.
- **iPhone (Safari):** Share → **Add to Home Screen** or **Save to Files**, then open.

*(You can also host the single file on GitHub Pages or any static host—see [Deployment](#deployment).)*

### 2) Pick an endpoint
Open the **Settings** sidebar. Use **Quick‑start endpoints** to auto‑fill a base URL, or paste your own OpenAI‑compatible base URL.

### 3) Add your API key (if required)
Paste your token in **API token**. It's **stored in `sessionStorage` only** (cleared when your tab/session ends).

### 4) Load models
Click **Refresh model list** and select a model. (If your provider needs a custom path, see [Customization](#customization).)

### 5) Start chatting
Create or select a chat thread. Edit the system prompt (optional). Type your message and **Send**.

---

## How It Works

- **Local data:**
  - Chat threads (titles, system prompts, messages) → `localStorage` under key `chatThreads`.
  - Session-only config (endpoint, token, selected model) → `sessionStorage` under key `chatConfig`.
  - Cached model list → `sessionStorage` under key `chatModels`.

- **API calls:**
  - Models list: derived from your base URL → `.../v1/models` (see `deriveModelsUrl()`).
  - Chat: derived from your base URL → `.../v1/chat/completions` (see `deriveChatCompletionsUrl()`).
  - Requests send `{ model, messages }` (system prompt included as the first message if present).
  - Responses are parsed for `choices[0].message.content` (or `choices[0].text` / `answer` as fallback).

- **Guardrails:** You can't send until a **thread**, **endpoint**, and **model** are set. Helpful notices point you to the right place.

---

## Supported Providers & Endpoints

The **Quick‑start endpoints** drop‑down includes many common OpenAI‑compatible bases:

- OpenAI, OpenRouter, Vercel AI Gateway, Cloudflare AI Gateway, Anyscale, Groq, Together, Fireworks, DeepSeek, Hyperbolic, DeepInfra, Perplexity, Hugging Face router, Hugging Face TGI (local), LoRAX (local), LM Studio (desktop), Ollama (local), RunPod (vLLM worker), Baseten, and **Custom**.

> **Note:** Out of the box, the client uses `Authorization: Bearer <token>` plus the OpenAI‑style paths above. If your provider requires additional headers or a different schema, you can tweak `sendToApi()` and the URL derivation helpers in `index.html`.

### Recipes

- **OpenAI:**
  Endpoint: `https://api.openai.com/v1` → paste key → refresh models → pick a model → chat.

- **Ollama (local):**
  Start Ollama, then select **Ollama (local)** (`http://localhost:11434/v1`). No token required.

- **LM Studio (desktop):**
  Start LM Studio server, select **LM Studio (desktop)** (`http://localhost:1234/v1`). No token required.

- **Gateways (OpenRouter/Vercel/Cloudflare/etc.):**
  Use the provided base URL and your gateway key. Some gateways can fan out to multiple providers.

---

## Import / Export & Preloaded Links

- **Chat history JSON:**
  Use **Export** / **Import** in the sidebar to move all threads between devices.

- **Configuration JSON:**
  Use **Export settings** / **Import settings** to move your endpoint, token, model list, and selection.

- **Per‑thread Markdown export:**
  Thread menu → **Export (.md)** to save a nicely formatted transcript.

- **Shareable preload links:**
  Thread menu → **Copy link with current title/system/prompt**
  You can also craft links manually with these query params:
  - `?title=...` — sets the chat title
  - `?system=...` — sets the system prompt
  - `?prompt=...` — pre-fills the message box
  - `?about=1` — opens the About dialog on load

Example:
```
index.html?title=Trip%20Planner&system=You%20are%20helpful.&prompt=Plan%20a%20weekend%20in%20Lisbon
```

---

## Data Storage & Privacy

- **Local only by default.** No network calls happen unless you click **Send** or **Refresh model list**.
- **Your chats remain in your browser** (`localStorage`). Delete threads or clear site data to remove them.
- **Tokens live in sessionStorage.** They're cleared when the tab/session ends.
- **What the API sees:** Only the messages in the request (including your system prompt and the visible chat context) are sent to the provider you configure. The provider may log requests according to its own policies—choose endpoints you trust.

> This is **not** a network anonymity tool. Your requests still go over the network to your chosen endpoint.

---

## Deployment

Because it's a single file, you can host it almost anywhere.

### GitHub Pages
1. Create a new repo and add `index.html`.
2. Commit and push.
3. Settings → **Pages** → Deploy from `main` (root).
4. Open the Pages URL to use the app.

### Any static host
Upload `index.html` and you're done.

---

## Customization

Open `index.html` and look for these areas:

- **Quick‑start endpoints:**
  `endpointOptions` array in JavaScript. Add or edit providers, default base URLs, and hints.

- **API behavior:**
  - `deriveModelsUrl(endpoint)` controls how the Models URL is built.
  - `deriveChatCompletionsUrl(endpoint)` controls how the Chat URL is built.
  - `sendToApi()` controls request body/headers and response parsing.
  Add headers here if your provider needs them.

- **Branding/UI copy:**
  The About dialog and promo banner live in HTML near the bottom; styles are inlined in the `<style>` block.

---

## Accessibility & Keyboard

- Semantic roles and ARIA labels in sidebar, notices, and modal.
- **Keyboard:**
  - `Esc` closes menus, sidebar (on mobile), and the About dialog.
  - Focus management when opening/closing panels.
- Respects **reduced motion** for animations (toasts).
- Color contrast tuned for readability.

Contributions to improve accessibility are very welcome.

---

## Troubleshooting

- **"You can't start chatting…" notice:**
  You need a selected thread, an API endpoint, and a model. The notice lists what's missing.

- **Auth issues:**
  After 2+ failed auth attempts, an "Authentication" helper appears with shortcuts to import settings or pick an endpoint.

- **No models returned:**
  Some providers don't expose `/v1/models`. You can either:
  - Enter the model name manually via a custom list (by editing code), or
  - Adjust `deriveModelsUrl()` / parsing logic to match your provider.

- **Gateway‑specific headers:**
  If your gateway needs extra headers (e.g., vendor‑specific auth), add them in `sendToApi()`.

---

## Roadmap: [JournalNet](https://github.com/JournalFoundation/journalnet)

Private Local Chat is a minimal demo. **[JournalNet](https://github.com/JournalFoundation/journalnet)** aims to provide:
- Automatic, selective sync across devices (opt‑in).
- **End‑to‑end encryption** with hardware‑backed keys where available.
- Large file support and shared spaces with fine‑grained permissions.
- Open, inspectable client and transport.

If these ideas resonate, see [CONTRIBUTING](./CONTRIBUTING.md) and help shape the roadmap.

---

## License

See [LICENSE](./LICENSE).
