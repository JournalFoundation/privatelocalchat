// Get an on-device model ready for a message: choose a model, download it if needed, load it, and report progress as it goes.
// The person never has to know the steps. Built on the model host and the download recovery, which do the real work.
import { pickTier } from "./auto-tier.mjs";

/** What is happening right now, in terms a progress display can show. s: model-host state, r: download-recovery state. */
export function progressOf(s, r = {}) {
  const tier = s.selection.tier, item = s.tiers[tier], modelName = item?.info?.modelId || "the model";
  const base = { tier, modelName, totalBytes: item?.info?.downloadBytes ?? null };
  if (s.load.state === "ready") return { ...base, phase: "ready", fraction: 1 };
  if (r.phase === "offline") return { ...base, phase: "offline" };
  if (r.phase === "another-tab") return { ...base, phase: "another-tab" };
  if (r.phase === "retrying" || s.transfer?.phase === "retry-wait") return { ...base, phase: "retrying", retryInMs: r.retryInMs || s.transfer?.retryDelayMs || 0 };
  if (s.busy === "install" || r.phase === "downloading") {
    const t = s.transfer || {}, total = t.bytesTotal || base.totalBytes || 0, done = Math.min(total, t.bytesDone || 0);
    return { ...base, phase: "download", bytesDone: done, totalBytes: total, fraction: total ? done / total : 0, bytesPerSecond: t.bytesPerSecond ?? null, etaSeconds: t.etaSeconds ?? null };
  }
  if (s.busy === "load" || r.phase === "loading") return { ...base, phase: "load" };
  if (s.busy === "verify" || s.busy === "repair" || r.phase === "checking" || r.phase === "complete") return { ...base, phase: "check" };
  return { ...base, phase: "starting" };
}

export function createPreparer({ host, recovery, getEnv, subscribe, userAgent = () => "", maxTouchPoints = () => 0, onChosen = () => {} }) {
  let switching = false;
  const choice = () => {
    const s = host.getState();
    return pickTier({ env: getEnv(), installed: { light: s.tiers.light.install.ok === true, default: s.tiers.default.install.ok === true }, selection: s.selection, userAgent: userAgent(), maxTouchPoints: maxTouchPoints() });
  };
  const waitIdle = async () => { for (let i = 0; i < 200 && host.getState().busy; i++) await new Promise((r) => setTimeout(r, 50)); };

  async function start(tier) {
    await waitIdle();
    if (host.getState().selection.tier !== tier) await host.selectTier(tier, { confirmed: true });
    const s = host.getState();
    if (s.tiers[tier].install.ok === true) { if (s.load.state === "unloaded") host.load().catch(() => {}); }
    else recovery.start(tier);
  }

  return {
    choice,
    /** Model, size and whether it came from the device class, for "about 5.6 GB, once". */
    info() {
      const c = choice(), s = host.getState(), item = c.tier ? s.tiers[c.tier] : null;
      return { tier: c.tier, reason: c.reason, modelName: item?.info?.modelId ?? null, downloadBytes: item?.info?.downloadBytes ?? null, memoryBytes: item?.info?.memory?.steadyBytes ?? null, installed: item?.install.ok === true };
    },
    /** Resolves when a model is loaded and ready to answer. Rejects with a readable error, or AbortError if `signal` fires. */
    async ensureReady({ signal, onProgress } = {}) {
      const c = choice();
      if (!c.tier) throw Object.assign(new Error("On-device chat is not available in this browser."), { code: "unsupported" });
      if (host.getState().load.state === "ready") { onProgress?.(progressOf(host.getState(), recovery.state)); return; }
      onChosen(c);
      await start(c.tier);
      return new Promise((resolve, reject) => {
        let done = false, timer = null;
        const finish = (fn, value) => { if (done) return; done = true; unsubscribe(); clearInterval(timer); signal?.removeEventListener("abort", onAbort); fn(value); };
        const onAbort = () => finish(reject, Object.assign(new Error("Stopped."), { name: "AbortError" }));
        const check = () => {
          const s = host.getState(), r = recovery.state;
          if (s.load.state === "ready") { onProgress?.(progressOf(s, r)); return finish(resolve); }
          if (s.load.state === "faulted" || r.phase === "load-failed") return finish(reject, Object.assign(new Error(s.load.lastError?.message || "The model could not be loaded."), { code: "load-failed", advice: s.load.lastError?.advice }));
          if (r.phase === "cancelled" && !switching && !s.busy) return finish(reject, Object.assign(new Error("The download was stopped."), { code: "cancelled" }));
          // downloaded but nothing is loading it (for example it failed to start earlier): load it now
          if (!s.busy && !r.pending && s.tiers[s.selection.tier].install.ok === true && s.load.state === "unloaded") host.load().catch(() => {});
          onProgress?.(progressOf(s, r));
        };
        const unsubscribe = subscribe(check);
        timer = setInterval(check, 1000);
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
        check();
      });
    },
    /** Change the model while a download is running ("use the smaller model"); a pending ensureReady keeps waiting. */
    async switchTier(tier) {
      switching = true;
      try { recovery.cancel(); await waitIdle(); await start(tier); } finally { switching = false; }
    }
  };
}
