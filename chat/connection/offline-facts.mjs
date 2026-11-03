// Gathers the facts runtime/offline-readiness.mjs turns into a checklist, from what the page already knows. No DOM.
//
// createOfflineFacts(host) needs:
//   models()        the chat model controller (window.localModels): mode, state, installed, ready
//   app()           what the service worker said last: { supported, controlled, current, bulkSaved, bulkExpected } or null when not asked yet
//   voice()         the voice picker's snapshot (or a promise of it), or null when it is not available
//   persisted()     Promise<boolean|null> whether the browser promised to keep the data
//   standalone()    true when opened from the home screen
// Returns { read() -> facts }.

export function createOfflineFacts(host) {
  return {
    async read() {
      const L = host.models?.() || null, app = host.app?.() || null;
      let snap = null; try { snap = (await host.voice?.()) || null; } catch { /* the voice module is optional here */ }
      const facts = { standalone: Boolean(host.standalone?.()) };

      // the saved copy of the app
      if (app && app.supported === false) facts.app = 'unsupported';
      else if (app && app.checked === false) facts.app = undefined;
      else if (app && app.controlled === false) facts.app = 'none';
      else if (app && app.current === true) facts.app = 'current';
      else if (app && app.current === false) facts.app = 'stale';

      // the chat model
      facts.mode = L?.mode === 'api' ? 'api' : 'local';
      const state = L?.state;
      if (state) {
        const tier = state.selection?.tier, item = state.tiers?.[tier];
        if (item) {
          facts.model = { name: item.info?.label || 'On-device model', downloaded: item.install?.ok === true, loaded: state.load?.state === 'ready' };
          if (app && app.bulkExpected > 0) facts.runtime = { saved: app.bulkSaved || 0, expected: app.bulkExpected };
        }
      }

      // the voice
      if (snap) {
        const chosen = snap.voices?.find(v => v.id === snap.selected);
        if (chosen) facts.voice = chosen.id === 'os' ? { system: true } : { name: chosen.label, system: false, downloaded: chosen.state === 'ready' };
      }

      try { facts.persisted = (await host.persisted?.()) ?? null; } catch { facts.persisted = null; }
      return facts;
    },
  };
}
