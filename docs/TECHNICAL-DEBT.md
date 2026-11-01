# Technical debt

A running list of known shortcuts, gaps and drift, newest review first. Each item says why it matters and what a fix looks like. Remove an item when it is fixed; add the date and a line to the review log at the bottom when you add one.

Last reviewed: 2026-11-01. Related, not duplicated here: `docs/IPHONE-INVESTIGATION.md` (open iPhone memory investigation), `docs/CHAT-FEATURES.md` ("Limits you should know about"), `docs/RELEASE-RECORD-2026-11-01.md` (what is unverified for the sharing release), `docs/PUBLIC-SITE.md` (public-site configuration).

## Process and safety nets

1. **Browser tests are not run by CI.** `.github/workflows/deploy.yml` runs `npm test` and the Python dev-tools tests; the Playwright suites in `tests/e2e/` (13 of them) are only run by hand with `node tests/e2e/<name>.e2e.mjs`. A regression in the UI can reach production. *Fix:* add a CI job that installs Chromium (`npx playwright install --with-deps chromium`) and runs `npm run e2e` before the deploy step; the suites are hermetic (fake API, local server) and take a few minutes.
2. **`npm run e2e` stops at the first failure** (`|| exit 1`) and prints little. Consider a runner that runs all suites and summarises.
3. **No linter or formatter.** `index.html` is hand-formatted JavaScript; style drifts between the old inline code and the newer `.mjs` modules.
4. **Commit titles over 100 characters** exist (two on 2026-11-01). `.gitlint` asks for at most 100, but nothing in CI enforces it. Either enforce it or relax the config.
5. **Agent worktrees are not git-ignored.** `.claude/worktrees/` is only excluded locally (`.git/info/exclude`); a stray `git add -A` once staged an embedded repository. *Fix:* add `.claude/worktrees/` to `.gitignore`.
6. **Version numbers disagree.** `package.json` says 2.0.0 while semantic-release tags are v0.x, and the app, Updates page and release record each need to pick one. Decide which is canonical (`docs/PUBLIC-SITE.md` currently uses the tags).

## Code structure

7. **`index.html` is a 5,600-line inline script** (`CLAUDE.md` still says about 4.5k). New features were put in modules (`chat/*.mjs`, `runtime/`) and reach the page through hook arrays (`contextProviders`, `beforeSendHooks`, `replyListeners`, ...) and the `transferApp` facade, which works but leaves two styles side by side and a large block of state (config, tokens, threads, drafts) that only the inline script can touch. *Fix:* move storage, tokens and config into modules with tests, one slice at a time, starting with the endpoint-token logic.
8. **Two sources of truth for the API token.** `config.token` (mirrors the visible field) and `endpointTokens` (keyed by endpoint identity) can disagree; requests now use `authTokenFor(endpoint)` but several paths still write `config.token` directly. *Fix:* make `endpointTokens` the only store and derive the field from it.
9. **Native `confirm` / `alert` / `prompt` are still used** in 10 places (clear history, reset settings, endpoint-switch key copy, a few errors). They cannot be styled, break on some embedded browsers and are hard to test. Replace with `openAppDialog` / `confirmDialog`.
10. **Legacy CSS and variables.** `chat/chat.css` and the inline `<style>` still define the old `--color-*` tokens, which `chat/brand.css` maps onto `--plc-*`; the unused `.voice-status` rule is still there. Remove once nothing reads the old variables.
11. **The About modal and the Help sheet overlap.** The modal is kept as "Quick summary of this app" and is still reachable from the Help sheet and the first-run screens; the public `/about/` page is the canonical version. Decide whether to keep both.
12. **Duplicated release-path rewriting.** `scripts/build.mjs` rewrites asset paths for `index.html` and, separately, for the public pages (`scripts/public-site.mjs`); a third entry point would need a third copy.
13. **The head script in `index.html` (stale-build repair, start-failure banner) is plain ES5 by design** and duplicates a little logic with `local-models.js`' service-worker registration. Keep it small; do not let it grow.

## Runtime and models

14. **CPU (WebAssembly) path is unmeasured on a real model.** It is proven with a tiny fixture only (`tests/e2e/cpu.e2e.mjs`): no tokens-per-second for Qwen3.5-2B, and the runtime is single-threaded because no multi-thread build is vendored. The fixture also cannot exercise the chat endpoint. *Fix:* measure on a real machine with the GPU disabled, record it in `docs/`, and consider a multi-thread build (the site is already cross-origin isolated).
15. **Catalogue defaults still point at original hosts** (Hugging Face, raw.githubusercontent.com, the owner's media host) while the deployed page overrides every model URL to `assets.privatelocal.chat` in `local-models.js`. The defaults are misleading and a forgotten override would silently change where files come from.
16. **Large runtime files are cached best-effort** by the service worker so a phone cannot get stuck on an old version, which means offline readiness for the model runtime can be incomplete until first use. The offline-ready indicator should reflect that precisely.
17. **iPhone memory limit** is an open investigation (`docs/IPHONE-INVESTIGATION.md`); the CPU fallback is deliberately not offered on iPhone/iPad because of it.
18. **Model-download stall watchdog** (2 minutes without progress) was unit-tested but never reproduced on a real phone; the threshold is a guess.

## Privacy, security and data

19. **API tokens live unencrypted in `sessionStorage`** (`chatConfig`, `chatEndpointTokens`). Fine for the threat model stated on the Privacy page, but worth revisiting if app lock should cover them.
20. **Old settings links carry a plaintext token in the query string.** They are still read for compatibility and the Privacy page says so. Consider a sunset date for the legacy reader.
21. **Privacy statements are checked by reading code, not by a test.** "No analytics, no cookies, only these hosts" can drift silently. *Fix:* add a test that scans `index.html`, `local-models.js`, `chat/`, `runtime/` and the public pages for third-party hosts and tracking APIs and compares them with an allowlist.
22. **Help copy names UI labels** ("Advanced model controls", "Verify / repair", "Remove download", ...). Renaming a control breaks the instructions without any test failing (it already happened once with the backup buttons). *Fix:* add a test that each quoted label exists in `index.html`.

## Speech

23. **WebKit microphone permission is untestable here.** Dictation and voice conversation were built from the platform's documented behaviour and tested against mocks; DuckDuckGo on iOS and Safari were not exercised. Two assumptions are unverified: that `resultIndex` behaves as in Chrome on WebKit, and that voice mode's recogniser restarts without a tap are allowed after the first permission.
24. **Voice mode has no echo cancellation** beyond turning the microphone off while it speaks, so a speakerphone setup may cut replies short.

## Public site and operations (all need the owner)

25. **Unset configuration in `site-config.json`:** support email and owner, Discussions URL and owner, hosting-log note, verification date, demo. The site hides what depends on them; the Help copy for contact and community is minimal until then.
26. **Unverified infrastructure facts:** log retention for the Pages projects and the R2 domain; the live `robots.txt` (and any edge content-signal policy) versus the generated file; the `privatelocalchat.com` redirect rule (outside this repo); Search Console; social-preview checks in real services.
27. **No demonstration video** and no genuine ratings or reviews, so none are claimed.
28. **Physical-device checks never done:** scanning a QR with a phone camera, a real native share sheet, enlarged text and the on-screen keyboard on a phone, and the stale-Safari / home-screen-app repair path on the reporter's device.
29. **Known-issue entries on `/help/` were derived from repository documents**, not re-tested; each says so. Re-verify and update the dates at every release.

## Review log

* 2026-11-01: first version, written after the sharing / transfer / public-pages release.
