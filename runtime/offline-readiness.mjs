// "Is this device ready to be used with no connection?", as a checklist a person can read. Pure: it only turns facts the app already has
// into items; the page and Settings decide how they look. (Offline plan 2.2.)
//
// facts (anything missing or null means "not known"):
//   app:       'current' (the saved copy is this version) | 'stale' (an update is saved, reload to use it) | 'none' (nothing saved yet)
//              | 'unsupported' (this browser cannot save the app)
//   runtime:   { saved, expected } number of model runtime files saved / expected, or null when the chat model is not an on-device one
//   mode:      'local' | 'api'
//   model:     { name, downloaded, loaded } the chosen on-device chat model, or null
//   voice:     { name, system, downloaded } the voice reading answers aloud
//   matching:  { needed, downloaded } the small matching model for search and Roberta; needed=false when nothing will ask for it
//   persisted: true | false | null  whether the browser promised not to delete the saved data
//   standalone: true when opened from the home screen
//
// Each item: { id, label, state: 'ready' | 'partial' | 'missing' | 'unknown' | 'na', detail, fix } where fix is the action that would
// make it ready ('reload' | 'save-runtime' | 'download-model' | 'download-voice' | 'download-matching' | 'persist') or null.
// The summary is 'ready' | 'almost' | 'not-ready' | 'api' and `text` is the one line shown above the list.

const item = (id, label, state, detail, fix = null) => ({ id, label, state, detail, fix });

export function offlineReadiness(f = {}) {
  const items = [];

  // The app itself
  if (f.app === 'unsupported') items.push(item('app', 'The app', 'missing', 'This browser cannot save the app for offline use.'));
  else if (f.app === 'current') items.push(item('app', 'The app', 'ready', 'Saved on this device.'));
  else if (f.app === 'stale') items.push(item('app', 'The app', 'partial', 'A newer version is saved. Reload once while online to use it.', 'reload'));
  else if (f.app === 'none') items.push(item('app', 'The app', 'missing', 'Not saved yet. Keep this page open while online for a moment.', 'reload'));
  else items.push(item('app', 'The app', 'unknown', 'Checking…'));

  // The chat model and what runs it
  if (f.mode === 'api') {
    items.push(item('model', 'Chat model', 'na', 'You are using a connected provider. It needs a connection; an on-device model does not.'));
  } else if (!f.model) {
    items.push(item('model', 'Chat model', 'unknown', 'Checking…'));
  } else if (!f.model.downloaded) {
    items.push(item('model', 'Chat model', 'missing', (f.model.name || 'The model') + ' is not downloaded yet.', 'download-model'));
  } else {
    items.push(item('model', 'Chat model', 'ready', (f.model.name || 'The model') + ' is saved on this device.'));
    if (f.runtime && f.runtime.expected > 0) {
      const { saved, expected } = f.runtime;
      if (saved >= expected) items.push(item('runtime', 'What runs the model', 'ready', 'Saved on this device.'));
      else if (saved > 0) items.push(item('runtime', 'What runs the model', 'partial', 'Some of it is saved (' + saved + ' of ' + expected + ' files).', 'save-runtime'));
      else items.push(item('runtime', 'What runs the model', 'missing', 'Not saved yet. It is saved the first time the model runs, or now.', 'save-runtime'));
    }
  }

  // The voice
  if (f.voice) {
    if (f.voice.system) items.push(item('voice', 'Voice', 'ready', 'Your device’s own voice works offline.'));
    else if (f.voice.downloaded) items.push(item('voice', 'Voice', 'ready', (f.voice.name || 'The voice') + ' is saved on this device.'));
    else items.push(item('voice', 'Voice', 'missing', (f.voice.name || 'The chosen voice') + ' is not downloaded yet.', 'download-voice'));
  }

  // The matching model (search and the phone-menu robot): optional, so it never makes the device "not ready" on its own
  if (f.matching?.needed) {
    items.push(f.matching.downloaded
      ? item('matching', 'Matching model', 'ready', 'Saved. Search by meaning works offline.')
      : item('matching', 'Matching model', 'partial', 'Not downloaded. Search still finds exact words offline.', 'download-matching'));
  }

  // Will the browser keep it
  if (f.persisted === true) items.push(item('storage', 'Keeping it', 'ready', 'The browser has promised to keep this data.'));
  else if (f.persisted === false) items.push(item('storage', 'Keeping it', 'partial', 'The browser may delete saved models when it needs space.', 'persist'));

  const needed = items.filter(i => i.id !== 'matching' && i.id !== 'storage');
  const blocking = needed.filter(i => i.state === 'missing');
  const partial = needed.filter(i => i.state === 'partial');
  const unknown = needed.filter(i => i.state === 'unknown');
  let summary, text;
  if (f.mode === 'api') { summary = 'api'; text = 'You are using a connected provider, which needs a connection. Switch to an on-device model to chat offline.'; }
  else if (blocking.length) { summary = 'not-ready'; text = 'Not ready for offline use yet: ' + blocking.map(i => i.label.toLowerCase()).join(' and ') + ' still to save.'; }
  else if (partial.length || unknown.length) { summary = 'almost'; text = unknown.length && !partial.length ? 'Checking whether this device is ready for offline use…' : 'Almost ready: ' + partial.map(i => i.label.toLowerCase()).join(' and ') + ' needs one more step.'; }
  else { summary = 'ready'; text = 'Ready for offline use. Chatting with your downloaded model needs no connection.'; }
  return { summary, text, items };
}
