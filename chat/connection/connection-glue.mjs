// Connection and offline readiness for the page: creates the connection state (chat/connection/connection.mjs), gathers the facts for the offline
// checklist and offers the fixes it lists. The shell and Settings read it through window.plcApp.offline; nothing here draws anything.
//
// createConnectionGlue(host) needs from the page:
//   events        the event list (connection:changed is fired here)
//   models()      window.localModels
//   voice()       the voice picker snapshot (or a promise of it), or null
//   toast(text)   the page's toast
// Returns { connection, readiness(), subscribe(fn) -> off, fix(action), reason(kind), isNetworkError(err), noteRequest(ok, err) }.
import { createConnection, offlineReason } from './connection.mjs';
import { createOfflineFacts } from './offline-facts.mjs';
import { offlineReadiness } from '../../runtime/offline-readiness.mjs';

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
    onChange: info => { host.events.emit('connection:changed', info); notify(); },
  });
  const facts = createOfflineFacts({
    models: () => host.models?.(), app: () => host.models?.()?.offlineApp,
    voice: () => host.voice?.(), persisted: () => navigator.storage?.persisted?.() ?? Promise.resolve(null),
    standalone: () => navigator.standalone === true || matchMedia?.('(display-mode: standalone)').matches,
  });
  const listeners = new Set();
  let timer = null;
  function notify() { clearTimeout(timer); timer = setTimeout(async () => { const r = await readiness(); for (const fn of [...listeners]) { try { fn(r, connection); } catch (e) { console.error(e); } } }, 50); }
  async function readiness() { return offlineReadiness(await facts.read()); }
  for (const name of ['offline-status', 'local-model-state']) window.addEventListener(name, notify);

  async function fix(action) {
    const L = host.models?.();
    if (action === 'reload') { location.reload(); return true; }
    if (action === 'save-runtime') { await L?.saveRuntime?.(); notify(); return true; }
    if (action === 'download-model') { if (!connection.online) { host.toast?.(offlineReason('download')); return false; } L?.download?.(); return true; }
    if (action === 'persist') { await L?.requestPersist?.(); notify(); return true; }
    return false;
  }

  return {
    connection, readiness, fix, isNetworkError,
    reason: offlineReason,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** The page saw a request finish (ok) or fail (err): a network failure counts toward "offline", a reply from a server counts toward "online". */
    noteRequest(ok, err) { if (ok) connection.reportSuccess(); else if (isNetworkError(err)) connection.reportFailure(); },
  };
}
