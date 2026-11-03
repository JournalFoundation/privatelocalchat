// The app lock and the "not locked" reminder.
//   With a passcode the app opens on a closed padlock and a passphrase field. It is a screen lock: it hides chats, it does not encrypt what the browser stores.
//   With no passcode the app opens on a short reminder (an open padlock inside a countdown ring) with a button to add one; doing nothing continues into the app.
// Everything the page provides is passed in, so this file reads on its own. createLock({...}).start() runs once as the page starts.

export function createLock({ el, createEmoji, readJson, writeJson, openAppDialog, confirmDialog, showToast, loadCrypto, passField, focusComposer, onLock }) {
  // app lock: a passphrase screen over the app. It hides chats; it does not encrypt what the browser stores.
  const LOCK_KEY = 'plc.lock.v1';
  let lockCfg = readJson(localStorage, LOCK_KEY, null);
  const appEl = document.getElementById('app');
  const lockScreen = el('div', 'lock-screen'); lockScreen.id = 'lockScreen'; lockScreen.setAttribute('role', 'dialog'); lockScreen.setAttribute('aria-modal', 'true'); lockScreen.setAttribute('aria-label', 'Unlock Private Local Chat'); lockScreen.hidden = true; // shown only while locked (it used to cover an unlocked app until start-up finished)
  // padlocks (inline, so they look the same everywhere): closed when the app is locked, open on the "not locked" reminder
  const padlock = (open, cls = '') => {
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'padlock ' + (open ? 'open' : 'closed') + (cls ? ' ' + cls : ''));
    const body = document.createElementNS(NS, 'rect'); body.setAttribute('x', '9'); body.setAttribute('y', '21'); body.setAttribute('width', '30'); body.setAttribute('height', '21'); body.setAttribute('rx', '5'); body.setAttribute('fill', 'currentColor');
    const shackle = document.createElementNS(NS, 'path'); shackle.setAttribute('fill', 'none'); shackle.setAttribute('stroke', 'currentColor'); shackle.setAttribute('stroke-width', '4.5'); shackle.setAttribute('stroke-linecap', 'round');
    shackle.setAttribute('d', open ? 'M16 21 V14 a8 8 0 0 1 16 0' : 'M16 21 V14 a8 8 0 0 1 16 0 V21');
    const keyhole = document.createElementNS(NS, 'circle'); keyhole.setAttribute('cx', '24'); keyhole.setAttribute('cy', '31'); keyhole.setAttribute('r', '3.2'); keyhole.setAttribute('fill', 'var(--plc-background, #fff)');
    svg.append(shackle, body, keyhole); return svg;
  };
  const lockForm = el('form'); const lockHead = el('h2', null, 'Private Local Chat is locked');
  const lockIcon = el('div', 'lock-icon'); lockIcon.appendChild(padlock(false));
  const lockPassLabel = el('label', 'sr-only', 'Passphrase'); lockPassLabel.htmlFor = 'unlockPass';
  const lockPass = el('input'); lockPass.type = 'password'; lockPass.id = 'unlockPass'; lockPass.autocomplete = 'current-password'; lockPass.placeholder = 'Passphrase';
  const lockMsg = el('p', 'danger'); lockMsg.setAttribute('role', 'alert');
  const lockGo = el('button', 'primary', 'Unlock'); lockGo.type = 'submit';
  const lockForgot = el('button', 'link-btn', 'Forgot the passphrase?'); lockForgot.type = 'button';
  const lockNote = el('p', 'muted lock-note'); lockNote.hidden = true;
  lockForm.append(lockIcon, lockHead, lockNote, lockPassLabel, lockPass, lockGo, lockMsg, lockForgot); lockScreen.appendChild(lockForm); document.body.appendChild(lockScreen);
  let failures = 0, lockedUntil = 0, idleTimer = null, hiddenAt = 0;
  function setLockedUi(locked) {
    document.documentElement.classList.toggle('locked', locked);
    const waiting = locked || Boolean(document.getElementById('lockSplash')); // the not-locked reminder keeps the app out of reach too, until it is done
    appEl.inert = waiting; appEl.setAttribute('aria-hidden', String(waiting));
    lockScreen.hidden = !locked;
    if (locked) { lockPass.value = ''; lockMsg.textContent = ''; window.setTimeout(() => lockPass.focus(), 0); } else lockNote.hidden = true;
  }
  function lockNow() {
    if (!lockCfg) return;
    setLockedUi(true); onLock?.();
  }
  lockForm.addEventListener('submit', async event => {
    event.preventDefault();
    const c = await loadCrypto();
    const wait = Math.ceil((lockedUntil - Date.now()) / 1000);
    if (wait > 0) { lockMsg.textContent = 'Too many tries. Wait ' + wait + ' seconds.'; return; }
    if (lockGo.getAttribute('aria-busy') === 'true') return;
    lockGo.setAttribute('aria-busy', 'true');
    const ok = await c.verifyLock(lockCfg, lockPass.value);
    lockGo.removeAttribute('aria-busy');
    if (ok) { failures = 0; setLockedUi(false); armIdle(); focusComposer?.(); return; }
    failures++; const delay = c.lockDelaySeconds(failures); lockedUntil = Date.now() + delay * 1000;
    lockMsg.textContent = 'That passphrase is not right.' + (delay ? ' Wait ' + delay + ' seconds before trying again.' : '');
    lockPass.select();
  });
  lockForgot.addEventListener('click', async () => {
    const sure = await confirmDialog('Erase and start over?', 'There is no way to recover a forgotten passphrase. You can erase this app’s saved chats, documents, memory and settings in this browser and remove the lock. Downloaded models are kept. If you have a backup you can restore it afterwards.', 'Erase everything', { danger: true });
    if (!sure) return;
    try { localStorage.clear(); sessionStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('plc-docs'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); } catch { /* best effort */ }
    location.reload();
  });
  function armIdle() {
    window.clearTimeout(idleTimer);
    if (!lockCfg || !lockCfg.autoMinutes) return;
    idleTimer = window.setTimeout(lockNow, lockCfg.autoMinutes * 60000);
  }
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(t => window.addEventListener(t, () => { if (lockCfg && !document.documentElement.classList.contains('locked')) armIdle(); }, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => {
    if (!lockCfg) return;
    if (document.hidden) hiddenAt = Date.now();
    else if (lockCfg.autoMinutes && hiddenAt && Date.now() - hiddenAt > lockCfg.autoMinutes * 60000) lockNow();
  });
  const lockBtn = el('button', 'icon-btn'); lockBtn.appendChild(createEmoji('🔒')); lockBtn.type = 'button'; lockBtn.id = 'lockNowBtn'; lockBtn.title = 'Lock now'; lockBtn.setAttribute('aria-label', 'Lock now');
  lockBtn.addEventListener('click', lockNow);
  function syncLockUi() {
    if (lockCfg && !lockBtn.isConnected) document.getElementById('headerTools').appendChild(lockBtn); else if (!lockCfg) lockBtn.remove();
    if (!lockCfg) setLockedUi(false);
  }
  const DISCLAIMER = 'A passcode keeps casual snoopers out of this app. It is not strong protection: someone with enough skill and access to this device may still be able to read your chats. Also use your device’s own security: a device passcode, Face ID or fingerprint, and keep its software up to date.';
  const autoOptions = () => { const auto = el('select'); auto.id = 'lockAuto'; [['0', 'Only when I press Lock'], ['1', 'After 1 minute away'], ['5', 'After 5 minutes away'], ['15', 'After 15 minutes away']].forEach(([v, l]) => auto.appendChild(new Option(l, v))); return auto; };
  // Set a passcode. Any passphrase is allowed (one character is fine; it is the person's choice). After it is set the app locks at once and shows the closed padlock,
  // which also proves the passphrase was typed the way they meant it.
  async function openSetLock() {
    const c = await loadCrypto();
    const root = el('div');
    root.appendChild(el('p', null, 'Choose any passphrase you like: a single character, 1234, ABC or a long sentence. You will type it every time the app opens.'));
    const msg = el('p', 'danger'); msg.setAttribute('role', 'alert');
    const auto = autoOptions(), autoLab = el('label', null, 'Lock automatically'); autoLab.htmlFor = 'lockAuto';
    const [a, pa] = passField('New passphrase', 'lockNew1'), [b, pb] = passField('Repeat the passphrase', 'lockNew2');
    const fine = el('p', 'muted lock-disclaimer', DISCLAIMER);
    root.append(a, b, autoLab, auto, msg, fine);
    openAppDialog({ title: 'Add a passcode', content: root, actions: [{ label: 'Cancel' }, { label: 'Lock the app', primary: true, close: false, run: async (d, button) => {
      if (!pa.value.length) { msg.textContent = 'Type a passphrase (any length, even one character).'; return; }
      if (pa.value !== pb.value) { msg.textContent = 'The two passphrases do not match.'; return; }
      button.setAttribute('aria-busy', 'true'); msg.textContent = 'Setting up…';
      lockCfg = { ...(await c.createLock(pa.value)), autoMinutes: Number(auto.value) };
      writeJson(localStorage, LOCK_KEY, lockCfg); try { localStorage.removeItem(SPLASH_KEY); } catch { /* ignore */ }
      syncLockUi(); armIdle(); d.close();
      setLockedUi(true); lockNote.textContent = 'Passcode set. Type it to open the app.'; lockNote.hidden = false;
    } }] });
  }
  async function openLockSettings() {
    if (!lockCfg) { openSetLock(); return; }
    const c = await loadCrypto();
    const root = el('div');
    root.appendChild(el('p', 'muted', 'The lock keeps people who pick up your device from reading your chats. It is a screen lock: it does not encrypt what this browser stores, so someone with access to the browser’s files could still read them. ' + DISCLAIMER));
    const msg = el('p', 'danger'); msg.setAttribute('role', 'alert');
    const auto = autoOptions(); auto.value = String(lockCfg.autoMinutes || 0);
    const autoLab = el('label', null, 'Lock automatically'); autoLab.htmlFor = 'lockAuto';
    const [cur, pc] = passField('Passphrase (to turn the lock off)', 'lockCurrent'); pc.autocomplete = 'current-password';
    root.append(autoLab, auto, cur, msg);
    openAppDialog({ title: 'App lock', content: root, actions: [
      { label: 'Lock now', run: () => lockNow() },
      { label: 'Save', run: () => { lockCfg.autoMinutes = Number(auto.value); writeJson(localStorage, LOCK_KEY, lockCfg); armIdle(); } },
      { label: 'Turn lock off', danger: true, close: false, run: async d => {
        if (!await c.verifyLock(lockCfg, pc.value)) { msg.textContent = 'That passphrase is not right.'; return; }
        lockCfg = null; try { localStorage.removeItem(LOCK_KEY); } catch { /* ignore */ } syncLockUi(); d.close(); showToast('Lock is off.');
      } }
    ] });
  }

  // ---- the "not locked" reminder: when the app opens with no passcode, a short splash says so, with a countdown ring and a big open padlock to add one ----
  const SPLASH_KEY = 'plc.lockSplash.v1', SPLASH_MS = 2500;
  function showLockSplash() {
    const root = el('div', 'lock-splash'); root.id = 'lockSplash'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'splashTitle');
    const card = el('div', 'lock-splash-card');
    const title = el('h2', null, 'This app is not locked'); title.id = 'splashTitle';
    const lead = el('p', 'lock-splash-lead', 'Anyone who can use this device can open it and read your chats.');
    const NS = 'http://www.w3.org/2000/svg', ring = document.createElementNS(NS, 'svg'); ring.setAttribute('viewBox', '0 0 100 100'); ring.setAttribute('class', 'lock-ring'); ring.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(NS, 'circle'), arc = document.createElementNS(NS, 'circle');
    for (const c of [track, arc]) { c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', '46'); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '5'); }
    track.setAttribute('class', 'lock-ring-track'); arc.setAttribute('class', 'lock-ring-arc'); arc.style.animationDuration = SPLASH_MS + 'ms'; ring.append(track, arc);
    const add = el('button', 'lock-add'); add.type = 'button'; add.id = 'splashAdd'; add.setAttribute('aria-label', 'Add a passcode');
    add.append(ring, padlock(true, 'lock-add-icon'), el('span', 'lock-add-label', 'Add a passcode'));
    const skip = el('button', 'link-btn lock-skip', 'Continue without a passcode'); skip.type = 'button'; skip.id = 'splashSkip';
    const never = el('button', 'link-btn lock-never', 'Don’t remind me again'); never.type = 'button'; never.id = 'splashNever';
    const status = el('p', 'sr-only'); status.setAttribute('role', 'status'); status.textContent = 'This app is not locked. Continuing in a moment.';
    const fine = el('p', 'lock-disclaimer', DISCLAIMER);
    card.append(title, lead, add, skip, never, fine, status); root.appendChild(card); document.body.appendChild(root);
    appEl.inert = true; appEl.setAttribute('aria-hidden', 'true');
    let done = false, timer = null;
    const finish = after => {
      if (done) return; done = true; window.clearTimeout(timer);
      root.remove(); document.documentElement.classList.remove('splashing'); appEl.inert = false; appEl.removeAttribute('aria-hidden');
      if (after) after(); else focusComposer?.({ preventScroll: true });
    };
    timer = window.setTimeout(() => finish(), SPLASH_MS);
    add.addEventListener('click', () => finish(() => openSetLock()));
    skip.addEventListener('click', () => finish());
    never.addEventListener('click', () => { try { localStorage.setItem(SPLASH_KEY, 'off'); } catch { /* ignore */ } showToast('The reminder is off. You can turn it back on in Settings > Security.'); finish(); });
    add.focus({ preventScroll: true });
  }
  const reminderOn = () => { try { return localStorage.getItem(SPLASH_KEY) !== 'off'; } catch { return true; } };
  const setReminder = on => { try { if (on) localStorage.removeItem(SPLASH_KEY); else localStorage.setItem(SPLASH_KEY, 'off'); } catch { /* ignore */ } };
  return {
    get enabled() { return Boolean(lockCfg); },
    lockNow, openLockSettings, showSplash: showLockSplash, reminderOn, setReminder,
    /** The lock settings changed from outside (a settings import): show the lock button, or not. */
    sync: syncLockUi,
    /** Call once at start-up: locked, or the reminder, or straight into the app. */
    start() {
      if (lockCfg) { setLockedUi(true); syncLockUi(); }
      else if (reminderOn()) showLockSplash();
      else document.documentElement.classList.remove('splashing');
    }
  };
}
