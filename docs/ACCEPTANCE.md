# Release acceptance

The seven required gates are production Pages hosting and canonical redirects; isolated development hosting; tested Actions deployment from both branches; complete verified model CDN; actual on-device inference including offline reopen; removal of the obsolete banner with preserved user data and working code/feedback links; and evidence plus operating instructions.

Status is **in progress**. CDN publication is verified in `ops/cloudflare/`. Remaining runtime, browser, deployment, and device checks must be recorded before declaring the migration complete.

Required browser evidence covers a fresh visit, a seeded returning user's conversations and API settings, interrupted model download and resumption, generation and cancellation, offline generation, offline reopen, and failures without API fallback. Desktop and real iPhone results must name the browser/device and tested commit. Browser emulation is not a substitute for real iPhone verification.
