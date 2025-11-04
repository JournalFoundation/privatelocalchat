# Contributing Guide

Thanks for your interest in improving **Private Local Chat**! This project is deliberately minimal: a single HTML file with inline CSS/JS and **no build step**. Contributions that keep it simple, auditable, and privacy‑first are especially appreciated.

- [Project Goals](#project-goals)
- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Code Style & Principles](#code-style--principles)
- [Privacy, Security & UX](#privacy-security--ux)
- [Testing & QA Checklist](#testing--qa-checklist)
- [Submitting Changes](#submitting-changes)
- [Issue Triage](#issue-triage)
- [License & Attribution](#license--attribution)
- [Community Expectations](#community-expectations)

---

## Project Goals

- **Single file**: keep everything in `index.html` (HTML/CSS/JS).
- **Zero deps**: no frameworks, no build tools, no external assets.
- **Local-first**: chats in `localStorage`, config in `sessionStorage`.
- **OpenAI‑compatible**: `/v1/models` + `/v1/chat/completions` by default.
- **Readable & accessible**: clear structure, ARIA where appropriate.
- **No hidden network calls**: only when the user triggers them.

---

## Ways to Contribute

- **Bug fixes**: UI quirks, edge cases, broken flows.
- **Docs**: better README examples, provider notes, troubleshooting.
- **Accessibility**: keyboard nav, focus management, contrast, ARIA.
- **Providers**: add/update quick‑start endpoints (keep text concise).
- **Features (small & scoped)**:
  - Optional streaming mode (behind a simple toggle).
  - Better error surfaces / retry flows.
  - Export formats (e.g., JSONL) if lightweight.
- **Refactors** that improve clarity without adding complexity.

> Prefer small, focused PRs. Open an issue first for larger proposals so we can align on approach.

---

## Development Setup

No toolchain required.

- **Option A: Open directly**
  Double‑click `index.html` to run it.

- **Option B: Serve locally (optional)**
  Any static server works:
  ```bash
  # Python:
  python -m http.server 8080

  # Node:
  npx serve .

  # Go:
  go run github.com/cortesi/modd/cmd/minihttp@latest -addr :8080
  ```

Then open `http://localhost:8080/index.html`.

- **Testing providers**
  Use a local runtime (Ollama, LM Studio) or a gateway (OpenRouter, etc.).
  For cloud APIs, set your key, refresh models, pick a model, and chat.

---

## Code Style & Principles

- **Vanilla JS** (ES2019+). No transpilers. Keep functions small and named.
- **Inline CSS**: prefer utility-ish rules, avoid heavy nesting.
- **HTML first**: meaningful elements, ARIA labels, sensible tab order.
- **Minimal state**: use small objects (e.g., `config`, `threads`) and helpers.
- **No external calls** unless the user clicks a button that clearly implies one.
- **Preserve simplicity**: if a feature needs heavy infrastructure, propose it for JournalNet instead.

---

## Privacy, Security & UX

- **Never phone home.** No analytics. No remote fonts. No auto‑updates.
- **Tokens** must remain in `sessionStorage` only (ephemeral).
- **Imports**: validate JSON shape; fail fast with human‑readable errors.
- **Endpoints**: default to OpenAI‑compatible paths; allow customization via small, obvious helpers.
- **Errors**: don't leak tokens in logs or UI.
- **Keyboard & Screen Readers**: maintain focus traps, visible focus, and Escape handling.

---

## Testing & QA Checklist

Please run through this list before opening a PR:

- **Baseline**

  - [ ] Loads with no console errors in Chrome, Firefox, and Safari (latest).
  - [ ] Works when opened directly from disk and when served over `http://localhost`.

- **No‑network behavior**

  - [ ] No requests are made until **Refresh model list** or **Send** is clicked.

- **Endpoints**

  - [ ] OpenAI: models load, chat works.
  - [ ] One local provider (e.g., Ollama or LM Studio) works without a token.

- **Storage**

  - [ ] Chats persist across reloads (localStorage).
  - [ ] Config and models clear when the tab is closed (sessionStorage).

- **Accessibility**

  - [ ] Sidebar and About dialog are keyboard accessible (open/close/focus).
  - [ ] Notices are announced and actionable.
  - [ ] Contrast and reduced‑motion preferences respected.

- **Regression checks**

  - [ ] Import/export history and settings work.
  - [ ] Thread menu: Rename, Export (.md), Delete, Copy link.
  - [ ] URL params: `?title=`, `?system=`, `?prompt=` and `?about=1` work.

---

## Submitting Changes

1. **Fork** the repository and create a branch:

   ```
   git checkout -b feat/your-change
   ```
2. **Keep PRs small and focused.** Include a short summary, rationale, and screenshots (if UI).
3. **Reference issues** if applicable (e.g., "Fixes #123").
4. **Stay within scope:** single‑file, zero‑dep. If uncertain, open an issue first.

**Commit messages:** use clear, imperative language. Conventional Commits are welcome but not required.

---

## Issue Triage

- **Bugs:** include repro steps, browser/version, and any console output.
- **Features:** explain the user benefit in 2–3 sentences; propose the smallest viable change.
- **Providers:** include base URL, sample response format, and whether it adheres to OpenAI endpoints.

Maintainers may suggest deferring heavier features to **JournalNet** to keep this demo trim and auditable.

---

## License & Attribution

By contributing, you agree that your contributions will be licensed under the repository's [LICENSE](./LICENSE).

---

## Community Expectations

Be respectful, constructive, and kind. We welcome newcomers and thoughtful critique.
If you observe behavior that harms the community, please open a private maintainer issue or email the project contact listed in the repo.
