// Connection and offline readiness for the page: creates the connection state (chat/connection/connection.mjs), gathers the facts for the offline
// checklist and offers the fixes it lists. The shell and Settings read it through window.plcApp.offline; nothing here draws anything.
//
// createConnectionGlue(host) needs from the page:
//   events        the event list (connection:changed is fired here)
//   models()      window.localModels
//   voice()       the voice picker snapshot (or a promise of it), or null
//   toast(text)   the page's toast
//   endpoint()    the connected provider's address (where an on-device provider can still answer offline)
//   probeUrl      the address of a small file on the app's own origin used to check reachability (default /version.json)
// Returns { connection, readiness(), subscribe(fn) -> off, fix(action), reason(kind), isNetworkError(err), noteRequest(ok, err) }.
import { createConnection, offlineReason, providerPlace } from './connection.mjs';
import { createOfflineFacts } from './offline-facts.mjs';
import { offlineReadiness, offlineHint } from '../../runtime/offline-readiness.mjs';

// The words browsers use when a request could not leave the device or got no answer. A server that answered "no" is not one of these.
const NETWORK_MESSAGE = /failed to fetch|load failed|networkerror|network request failed|network error|internet connection appears to be offline|err_internet_disconnected|err_network/i;
export function isNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  if (typeof err.status === 'number' || typeof err.statusCode === 'number') return false;
  return err.name === 'TypeError' ? NETWORK_MESSAGE.test(String(err.message || '')) || !err.message : NETWORK_MESSAGE.test(String(err.message || err));
}

export function createConnectionGlue(host) {
  const connection = createConnection({
    isOnline: () => navigator.onLine !== false,
    listen: (name, fn) => { window.addEventListener(name, fn); return () => window.removeEventListener(name, fn); },
    setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: id => clearTimeout(id),
    onChange: info => { host.events.emit('connection:changed', info); window.dispatchEvent(new Event('connection-changed')); notify(); },
  });
  const facts = createOfflineFacts({
    models: () => host.models?.(), app: () => host.models?.()?.offlineApp,
    voice: () => host.voice?.(), persisted: () => navigator.storage?.persisted?.() ?? Promise.resolve(null),
    standalone: () => navigator.standalone === true || matchMedia?.('(display-mode: standalone)').matches,
  });
  // Is the app's own origin reachable? The browser's online flag stays true behind a dead Wi-Fi, so this asks directly. It talks only to the origin that
  // served the app, only when the page comes back to the front, when the browser reports a change, and slowly while it is open (faster while offline,
  // to notice the return). The query string makes it skip the saved copy, so it tests the network and not the cache.
  let probing = false;
  async function probe(force = false) {
    if (probing || (!force && document.visibilityState === 'hidden')) return; // a page in the background does not ask, except the one check at start-up
    probing = true;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch((host.probeUrl || '/version.json') + '?probe=' + Date.now(), { cache: 'no-store', signal: controller.signal });
      if (response) connection.reportSuccess();
    } catch (error) { connection.reportFailure({ definitive: true }); }
    finally { clearTimeout(timeout); probing = false; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') probe(); });
  window.addEventListener('focus', () => probe());
  window.addEventListener('online', () => setTimeout(() => probe(), 300));
  setTimeout(() => probe(true), 2500); // once at start-up, so a page opened on a dead connection says so
  setInterval(() => { if (connection.state === 'offline') probe(); }, 15000);
  setInterval(() => probe(), 300000);
  const listeners = new Set();
  let timer = null;
  function notify() { clearTimeout(timer); timer = setTimeout(async () => { const r = await readiness(); for (const fn of [...listeners]) { try { fn(r, connection); } catch (e) { console.error(e); } } }, 50); }
  async function readiness() { return offlineReadiness(await facts.read()); }
  for (const name of ['offline-status', 'local-model-state']) window.addEventListener(name, notify);

  // The first time a model is ready to answer: one quiet line about offline use (each kind of line is shown once, ever).
  const HINT_KEY = 'plc.offlineHint.v1';
  let hintArmed = true;
  window.addEventListener('local-model-state', () => {
    const L = host.models?.();
    if (!hintArmed || !L || L.mode !== 'local' || L.state?.load?.state !== 'ready') return;
    hintArmed = false;
    setTimeout(async () => {
      try {
        const seen = JSON.parse(localStorage.getItem(HINT_KEY) || '{}');
        const hint = offlineHint(await readiness());
        if (!hint || seen[hint.kind]) return;
        seen[hint.kind] = true; localStorage.setItem(HINT_KEY, JSON.stringify(seen));
        host.toast?.(hint.text);
      } catch { /* a hint is never worth an error */ }
    }, 2500);
  });

  async function fix(action) {
    const L = host.models?.();
    if (action === 'reload') { location.reload(); return true; }
    if (action === 'save-runtime') { await L?.saveRuntime?.(); notify(); return true; }
    if (action === 'download-model') { if (!connection.online) { host.toast?.(offlineReason('download')); return false; } L?.download?.(); return true; }
    if (action === 'persist') { await L?.requestPersist?.(); notify(); return true; }
    return false;
  }

  // A control that needs the connection: disabled with the reason while offline (when `applies()` says it matters), as it was before otherwise.
  function gate(el, kind, applies = () => true) {
    if (!el) return;
    const original = { title: el.getAttribute('title') };
    const apply = () => {
      const block = connection.state === 'offline' && applies();
      if (block) { if (!el.dataset.offlineBlocked) { el.dataset.offlineBlocked = '1'; el.dataset.wasDisabled = el.disabled ? '1' : ''; } el.disabled = true; el.setAttribute('aria-disabled', 'true'); el.title = offlineReason(kind); }
      else if (el.dataset.offlineBlocked) { delete el.dataset.offlineBlocked; el.disabled = el.dataset.wasDisabled === '1'; delete el.dataset.wasDisabled; el.removeAttribute('aria-disabled'); if (original.title == null) el.removeAttribute('title'); else el.title = original.title; }
    };
    host.events.on('connection:changed', apply); apply();
  }

  return {
    connection, readiness, fix, gate, isNetworkError, probe,
    reason: offlineReason,
    /** 'device' | 'network' | 'internet': where the connected provider is, so a provider on this device is not called a problem offline. */
    providerPlace: () => providerPlace(host.endpoint?.()),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** The page saw a request finish (ok) or fail (err): a network failure counts toward "offline", a reply from a server counts toward "online". */
    noteRequest(ok, err) { if (ok) connection.reportSuccess(); else if (isNetworkError(err)) connection.reportFailure(); },
  };
}
