// What the vault does with each browser storage key. This table is the code twin of docs/evidence/encryption/storage-inventory.json (tests/storage-inventory.test.mjs
// fails if they differ). user, setting and transient keys are kept in the vault when it is on; plain, test and device keys stay in the browser's own storage.

export const KEY_CLASSES = Object.freeze({
  "chatThreads": { store: "local", class: "user" },
  "plc.activeThread.v1": { store: "local", class: "user" },
  "plc.drafts.v1": { store: "local", class: "user" },
  "plc.prefs.v1": { store: "local", class: "setting" },
  "plc.folders.v1": { store: "local", class: "user" },
  "plc.presets.v1": { store: "local", class: "user" },
  "plc.memory.v1": { store: "local", class: "user" },
  "plc.modelMemory.v1": { store: "local", class: "setting" },
  "plc.voice.v2": { store: "local", class: "setting" },
  "plc.voice.v1": { store: "local", class: "setting" },
  "plc.inferenceMode.v1": { store: "local", class: "setting" },
  "plc.models.v1": { store: "local", class: "setting" },
  "plc.shell.pins.v1": { store: "local", class: "user" },
  "plc.shell.collapsed": { store: "local", class: "plain" },
  "plc.downloadIntent.v1": { store: "local", class: "plain" },
  "plc.offlineHint.v1": { store: "local", class: "plain" },
  "plc.lockSplash.v1": { store: "local", class: "plain" },
  "plc.lock.v1": { store: "local", class: "plain" },
  "plc.speechInputUnusable": { store: "local", class: "plain" },
  "plc.test.voice": { store: "local", class: "test" },
  "chatConfig": { store: "session", class: "user" },
  "chatModels": { store: "session", class: "setting" },
  "chatEndpointTokens": { store: "session", class: "user" },
  "plc.draft": { store: "session", class: "transient" },
  "plc.pendingToken.v1": { store: "session", class: "transient" },
  "plc.update.tried": { store: "session", class: "plain" },
  "promoDismissed": { store: "session", class: "plain" },
  "plc.vault.v1": { store: "local", class: "plain" },
  "plc.theme.v1": { store: "local", class: "plain" },
});

export const VAULTED_CLASSES = Object.freeze(["user", "setting", "transient"]);
export const classOf = (key) => KEY_CLASSES[key]?.class || "unknown";
export const isVaulted = (key) => VAULTED_CLASSES.includes(classOf(key));
export const vaultedKeys = (store) => Object.entries(KEY_CLASSES).filter(([, v]) => v.store === store && VAULTED_CLASSES.includes(v.class)).map(([k]) => k);
