// The voice call: a phone call with the assistant. It rings, connects, shows how long it has run, and ends with a summary. The orb moves differently for listening,
// thinking, writing the reply, making the voice and speaking; two chips show the chat model and the voice with their memory state; the call's messages are listed with older
// ones fading; a spoken reply whose sound never starts is given up on and explained. Underneath: listen -> send -> speak the reply while it is written -> listen again
// (chat/voice.mjs, which has no DOM). The page provides everything this needs in `host`; createCall(host) returns { active, start, end, stop }.
//
// host: el, icons, prefs(), showToast, providerName, messageForm, messageInput, growComposer, sendMessage(), abortReply(), currentThreadId(), chatReady(),
//       loadSpeech(), loadVoice(), ensureCallSounds(), callSounds(), callSoundsOn(), loadVoiceChoice(), voiceOpts(), cleanText(text), moduleBase(),
//       explainSpeechInputFailure(code), endDictation(opts), stopSpeaking(), voiceButton(), replyListeners[], contextProviders[]

export function createCall(host) {
  const { el, icons, showToast, providerName, messageForm, messageInput, growComposer, replyListeners, contextProviders } = host;
  let speechMod = null, voiceMod = null;
  const setPressed = on => host.voiceButton()?.setAttribute('aria-pressed', String(on));
  let voiceSession = null, voiceUi = null, wakeLock = null;
  const CALL_RING_MS = 1600;
  const call = { startedAt: null, ticker: null, endedTimer: null, prev: 'idle', failed: false, log: [], noticeTimer: null, lastVoiceNotice: 0 };
  const callSoundsOn = () => host.callSoundsOn();
  const buzz = ms => { try { if (callSoundsOn()) navigator.vibrate?.(ms); } catch { /* not supported */ } };
  const callIcon = (name, fallback) => { const n = icons ? icons.iconNode(name) : null; if (n) return n; const f = el('span', null, fallback); f.setAttribute('aria-hidden', 'true'); return f; };
  function buildVoiceUi() {
    const root = el('section', 'call'); root.id = 'voiceSheet'; root.hidden = true; root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Voice call');
    const top = el('div', 'call-top');
    const name = el('p', 'call-name', 'Private Local Chat');
    const status = el('p', 'call-status'); status.id = 'callStatus'; status.setAttribute('role', 'status');
    const timer = el('p', 'call-timer', '0:00'); timer.id = 'callTimer'; timer.setAttribute('role', 'timer'); timer.setAttribute('aria-live', 'off');
    top.append(name, status, timer);
    // which models are in memory right now: the chat model and the voice (chips follow the same states as the pickers)
    const models = el('div', 'call-models'); models.setAttribute('role', 'group'); models.setAttribute('aria-label', 'Models in use');
    const chip = id => { const c = el('span', 'call-chip'); c.id = id; c.dataset.state = 'none'; c.append(el('span', 'call-chip-dot'), el('span', 'call-chip-text')); models.appendChild(c); return c; };
    const chipChat = chip('callChipChat'), chipVoice = chip('callChipVoice');
    const avatar = el('div', 'call-avatar'); avatar.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= 3; i++) avatar.appendChild(el('span', 'call-ring r' + i));
    const face = el('span', 'call-face'); const mark = el('img'); mark.src = '/brand/mark-dark.svg'; mark.alt = ''; mark.width = 64; mark.height = 64; face.appendChild(mark); avatar.appendChild(face);
    const captionBox = el('div', 'call-captions');
    const who = el('p', 'call-who'); who.setAttribute('aria-hidden', 'true');
    const caption = el('p', 'call-caption'); caption.id = 'voiceCaption'; caption.setAttribute('aria-live', 'off');
    captionBox.append(who, caption);
    const log = el('ol', 'call-log'); log.setAttribute('aria-label', 'This call'); log.setAttribute('aria-live', 'off');
    const notice = el('p', 'call-notice'); notice.setAttribute('role', 'status'); notice.hidden = true;
    const hint = el('p', 'call-hint voice-hint');
    const sendNow = el('button', 'call-link', 'Send now'); sendNow.type = 'button'; sendNow.id = 'callSendNow'; sendNow.hidden = true;
    const resume = el('button', 'call-pill', 'Tap to talk'); resume.type = 'button'; resume.id = 'callResume'; resume.hidden = true;
    const control = (id, icon, fallback, label, cls) => {
      const wrap = el('div', 'call-control'); const b = el('button', 'call-btn' + (cls ? ' ' + cls : '')); b.type = 'button'; b.id = id;
      b.appendChild(callIcon(icon, fallback)); const text = el('span', 'call-control-label', label); wrap.append(b, text); return { wrap, b, text };
    };
    const mute = control('voiceMute', 'mic', '🎙', 'Mute'); mute.b.setAttribute('aria-pressed', 'false'); mute.b.setAttribute('aria-label', 'Mute microphone');
    const skip = control('voiceInterrupt', 'skip', '⏭', 'Skip'); skip.b.setAttribute('aria-label', 'Skip what is being said');
    const end = control('voiceEnd', 'hangup', '✕', 'End call', 'call-end'); end.b.setAttribute('aria-label', 'End call');
    const row = el('div', 'call-controls'); row.append(mute.wrap, skip.wrap, end.wrap);
    root.append(top, models, avatar, log, captionBox, notice, hint, sendNow, resume, row);
    messageForm.parentNode.insertBefore(root, messageForm);
    sendNow.addEventListener('click', () => voiceSession?.tap());
    resume.addEventListener('click', () => voiceSession?.tap());
    mute.b.addEventListener('click', () => { const on = mute.b.getAttribute('aria-pressed') !== 'true'; voiceSession?.setMuted(on); });
    skip.b.addEventListener('click', () => voiceSession?.interrupt());
    end.b.addEventListener('click', () => endVoice());
    root.addEventListener('keydown', e => { if (e.key === 'Escape') endVoice(); });
    return { root, status, timer, who, caption, hint, sendNow, resume, mute, skip, end, models, chipChat, chipVoice, log, notice };
  }
  const callElapsed = () => (call.startedAt === null ? 0 : (Date.now() - call.startedAt) / 1000);
  function startTimer() {
    call.startedAt = Date.now(); voiceUi.timer.textContent = '0:00';
    clearInterval(call.ticker); call.ticker = setInterval(() => { voiceUi.timer.textContent = voiceMod.formatDuration(callElapsed()); }, 1000);
  }
  function hideCall() {
    clearInterval(call.ticker); clearTimeout(call.endedTimer); clearTimeout(call.stallTimer); clearInterval(call.waitTicker); call.ticker = call.endedTimer = call.stallTimer = call.waitTicker = null; call.startedAt = null;
    clearTimeout(call.noticeTimer); call.noticeTimer = null; call.log = [];
    if (voiceUi) { voiceUi.root.hidden = true; voiceUi.notice.hidden = true; voiceUi.notice.textContent = ''; voiceUi.log.textContent = ''; }
    document.body.classList.remove('voice-on');
  }
  const callWords = {
    connecting: ['Calling…', ''],
    listening: ['Listening', ''],
    thinking: ['Thinking…', ''],
    speaking: ['Speaking', '']
  };
  // finer than the state: what the app is really doing right now (thinking, writing the text, making the sound, playing it)
  const callPhaseWords = { 'thinking:thinking': 'Thinking…', 'thinking:writing': 'Writing the reply…', 'speaking:preparing': 'Preparing the voice…', 'speaking:playing': 'Speaking' };
  // what the call is waiting on, said out loud on screen instead of a silent pause
  function callWaitNote() {
    const lm = window.localModels;
    if (!lm || lm.mode !== 'local') return 'Talking with ' + providerName() + '. Answers are written by an AI model.';
    if (lm.ready) return 'Talking with the model on this device. Answers are written by an AI model, not scripted.';
    const st = lm.state, t = st?.transfer, cm = 'the chat model' + (st?.tiers?.[st.selection.tier]?.info?.modelId ? ' ' + st.tiers[st.selection.tier].info.modelId : '');
    if (st?.busy && t) return 'Downloading ' + cm + ': ' + Math.round(((t.bytesDone || 0) / Math.max(1, t.bytesTotal || 1)) * 100) + '%. The call continues when it is ready.';
    if (st?.busy || lm.installed) return 'Loading ' + cm + ' into memory. The call continues when it is ready.';
    return 'The on-device model is not downloaded yet. Pick it in the model menu to download it, then call again.';
  }
  // A notice on the call screen that stays a while (a spoken reply that could not be made, a voice that fell back to the system voice).
  function showCallNotice(text, ms = 14000) {
    if (!voiceUi) return;
    clearTimeout(call.noticeTimer);
    voiceUi.notice.textContent = text; voiceUi.notice.hidden = !text;
    if (text) call.noticeTimer = setTimeout(() => { if (voiceUi) { voiceUi.notice.hidden = true; voiceUi.notice.textContent = ''; } }, ms);
  }
  // A spoken reply whose sound never starts is given up on, and the reply stays on screen as text. This is the "making the sound" phase only: once sound is playing it is fine.
  function watchSpeech(state, info) {
    clearTimeout(call.stallTimer); call.stallTimer = null;
    if (state !== 'speaking' || info.phase !== 'preparing') return;
    let base = 35000; // longer than the voice engine's own limit, which falls back to the system voice first
    /* DEV_DIAGNOSTICS_START */
    if (window.__plcCallStallMs) base = window.__plcCallStallMs; // test hook: stripped from production builds
    /* DEV_DIAGNOSTICS_END */
    const ms = base + String(info.caption || '').length * 150;
    call.stallTimer = setTimeout(() => {
      if (call.prev !== 'speaking') return;
      try { voiceSession?.interrupt(); } catch { /* the call may already have ended */ }
      showCallNotice('The spoken reply stalled: the voice made no sound in time. The reply is shown as text instead. You can keep talking.', 20000);
    }, ms);
  }
  // ---- the models in memory (chips) ----
  let modelsViewMod = null;
  const chipWord = vm => ({ loaded: 'loaded', busy: 'working', loading: 'loading…', downloaded: 'unloaded', none: 'not downloaded', testing: 'testing…', failed: 'failed' }[vm.state] || (vm.state === 'downloading' ? 'downloading' + (vm.progress != null ? ' ' + Math.round(vm.progress * 100) + '%' : '') : ''));
  async function refreshCallChips() {
    if (!voiceUi || voiceUi.root.hidden) return;
    modelsViewMod ||= await import(host.moduleBase() + 'chat/models-view.mjs');
    const lm = window.localModels, ui = voiceUi;
    if (lm?.mode === 'api') { ui.chipChat.dataset.state = 'provider'; ui.chipChat.querySelector('.call-chip-text').textContent = 'Replies: ' + providerName(); }
    else if (lm?.state) {
      const vm = modelsViewMod.languageRows(lm.state, { mode: 'local' }).find(r => r.inUse) || modelsViewMod.languageRows(lm.state, { mode: 'local' })[0];
      ui.chipChat.dataset.state = vm ? vm.state : 'none'; ui.chipChat.querySelector('.call-chip-text').textContent = 'Chat model ' + (vm ? (vm.modelId || vm.label) + ': ' + chipWord(vm) : '');
    }
    const vctl = await host.loadVoiceChoice().catch(() => null);
    if (vctl) {
      const sel = modelsViewMod.voiceRows(vctl.snapshot()).find(r => r.inUse);
      if (!sel || sel.kind === 'system') { ui.chipVoice.dataset.state = 'system'; ui.chipVoice.querySelector('.call-chip-text').textContent = 'Voice: system voice'; }
      else { ui.chipVoice.dataset.state = sel.state; ui.chipVoice.querySelector('.call-chip-text').textContent = 'Voice ' + sel.label + ': ' + chipWord(sel); }
    }
  }
  window.addEventListener('local-model-state', () => { refreshCallChips().catch(() => {}); });
  host.loadVoiceChoice().then(c => { c?.subscribe(snap => {
    refreshCallChips().catch(() => {});
    const n = snap.notice; if (voiceSession?.active && n && n.kind === 'error' && n.at !== call.lastVoiceNotice) { call.lastVoiceNotice = n.at; showCallNotice(n.text); }
  }); }).catch(() => {});
  // ---- the call's messages, fading as the list grows ----
  const CALL_LOG_MAX = 6;
  function callLogAdd(who, text) { call.log.push({ who, text }); if (call.log.length > 40) call.log.shift(); renderCallLog(); }
  function callLogLive(text) { // the reply being written: one entry that grows
    const last = call.log[call.log.length - 1];
    if (last && last.live) last.text = text; else call.log.push({ who: 'Private Local Chat', text, live: true });
    renderCallLog();
  }
  function callLogEnd(text) { const last = call.log[call.log.length - 1]; if (last && last.live) { if (text) last.text = text; delete last.live; } renderCallLog(); }
  function renderCallLog() {
    if (!voiceUi) return;
    const items = call.log.slice(-CALL_LOG_MAX), box = voiceUi.log; box.textContent = '';
    items.forEach((m, i) => {
      const age = items.length - 1 - i; // 0 = newest
      const li = el('li', 'call-log-item ' + (m.who === 'You' ? 'you' : 'them') + (m.live ? ' live' : ''));
      li.style.opacity = String(Math.max(0.16, 1 - age * 0.2));
      li.append(el('span', 'call-log-who', m.who), el('span', 'call-log-text', m.text));
      box.appendChild(li);
    });
    box.scrollTop = box.scrollHeight;
  }
  function renderVoice(state, info = {}) {
    renderVoiceInner(state, info);
    if (!voiceUi) return;
    watchSpeech(state, info);
    if (state === 'thinking' && info.phase === 'thinking') showCallNotice('');
    clearInterval(call.waitTicker); call.waitTicker = null;
    refreshCallChips().catch(() => {});
    if (state === 'connecting' || state === 'thinking') {
      const put = () => { if (voiceUi) voiceUi.hint.textContent = callWaitNote(); };
      put(); call.waitTicker = setInterval(() => { if (call.prev === 'connecting' || call.prev === 'thinking') put(); else { clearInterval(call.waitTicker); call.waitTicker = null; } }, 1000);
    } else if (state === 'listening' && !info.caption) voiceUi.hint.textContent = callWaitNote();
  }
  function renderVoiceInner(state, info = {}) {
    if (!voiceUi) return;
    const ui = voiceUi, before = call.prev; call.prev = state;
    if (state === 'idle') {
      // hanging up shows how long the call lasted for a moment, like a phone; a call that never connected just closes
      clearInterval(call.ticker); call.ticker = null;
      if (call.startedAt !== null && !call.failed && !ui.root.hidden) {
        ui.timer.textContent = voiceMod.formatDuration(callElapsed());
        ui.root.dataset.state = 'ended'; ui.status.textContent = 'Call ended'; ui.who.textContent = ''; ui.caption.textContent = ''; ui.hint.textContent = '';
        ui.sendNow.hidden = ui.resume.hidden = true;
        if (callSoundsOn()) host.callSounds()?.ended(); buzz(40);
        clearTimeout(call.endedTimer); call.endedTimer = setTimeout(hideCall, 2400);
      } else hideCall();
      return;
    }
    clearTimeout(call.endedTimer); call.endedTimer = null;
    ui.root.hidden = false; ui.root.dataset.state = state; ui.root.dataset.phase = info.phase || ''; document.body.classList.add('voice-on');
    if (state === 'connecting') {
      call.startedAt = null; call.failed = false; ui.timer.textContent = '0:00';
      ui.status.textContent = callWords.connecting[0]; ui.who.textContent = ''; ui.caption.textContent = ''; ui.hint.textContent = '';
      ui.sendNow.hidden = ui.resume.hidden = ui.skip.wrap.hidden = true; ui.mute.wrap.hidden = false; ui.end.text.textContent = 'End call'; ui.end.b.setAttribute('aria-label', 'End call');
      host.callSounds()?.ringback();
      return;
    }
    if (state === 'error') {
      call.failed = true; clearInterval(call.ticker); call.ticker = null;
      ui.status.textContent = 'Call failed'; ui.who.textContent = ''; ui.caption.textContent = ''; ui.hint.textContent = info.message || '';
      ui.sendNow.hidden = ui.resume.hidden = ui.skip.wrap.hidden = ui.mute.wrap.hidden = true; ui.end.text.textContent = 'Close'; ui.end.b.setAttribute('aria-label', 'Close the call screen');
      host.explainSpeechInputFailure(info.code).then(m => { ui.hint.textContent = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network'].includes(info.code) ? m : (info.message || m); }).catch(() => {});
      return;
    }
    if (call.startedAt === null) { startTimer(); if (before === 'connecting') { host.callSounds()?.connected(); buzz(25); } }
    const muted = state === 'paused' && info.reason === 'muted', hold = state === 'paused' && info.reason === 'background';
    ui.status.textContent = muted ? 'Muted' : hold ? 'On hold' : state === 'paused' ? 'Tap to talk' : callPhaseWords[state + ':' + (info.phase || '')] || (callWords[state] || ['', ''])[0];
    ui.hint.textContent = muted ? 'Your microphone is off. Unmute to talk.' : hold ? 'The call was put on hold while the app was in the background.' : '';
    const speaking = state === 'speaking', yours = state === 'listening' || state === 'thinking';
    ui.who.textContent = info.caption ? (speaking ? 'Private Local Chat' : yours ? 'You' : '') : '';
    ui.root.classList.toggle('call-has-log', call.log.length > 0);
    ui.caption.textContent = info.caption || '';
    ui.sendNow.hidden = !(state === 'listening' && info.caption);
    ui.resume.hidden = !(state === 'paused' && !muted);
    ui.skip.wrap.hidden = !(speaking || state === 'thinking');
    ui.mute.wrap.hidden = false; ui.end.text.textContent = 'End call'; ui.end.b.setAttribute('aria-label', 'End call');
    const micOff = Boolean(info.muted);
    ui.mute.b.setAttribute('aria-pressed', String(micOff)); ui.mute.b.setAttribute('aria-label', micOff ? 'Unmute microphone' : 'Mute microphone');
    ui.mute.text.textContent = micOff ? 'Unmute' : 'Mute';
    const want = micOff ? 'mic-off' : 'mic';
    if (ui.mute.b.dataset.icon !== want) { ui.mute.b.dataset.icon = want; ui.mute.b.replaceChildren(callIcon(want, '🎙')); }
  }
  async function keepScreenOn(on) {
    try {
      if (on && navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
    } catch { /* the screen may simply turn off */ }
  }
  // a spoken (empty) utterance made inside the tap lets iPhone Safari speak later, when the reply arrives
  const unlockSpeech = () => { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* no voices */ } };
  function ensureVoiceSession() {
    if (voiceSession || !speechMod || !voiceMod) return voiceSession;
    voiceUi ||= buildVoiceUi();
    voiceSession = voiceMod.createVoiceSession({
      listen: handlers => speechMod.startDictation(handlers),
      speakOne: text => speechMod.speak(text, { voiceURI: host.prefs().voiceURI, rate: host.prefs().speechRate || 1, interrupt: false, onAudio: () => voiceSession?.audioStarted(), ...host.voiceOpts() }),
      send: async text => {
        replyBegan = false; callLogAdd('You', text);
        messageInput.value = text; growComposer();
        await host.sendMessage();
        if (!replyBegan) voiceSession.replyEnded({ stopped: true }); // answered without the model, or not sent
      },
      abortReply: () => host.abortReply(),
      clean: text => host.cleanText(text), // markdown that slipped through is not read out as symbols
      onState: renderVoice, connectMs: CALL_RING_MS, unlockAudio: () => { unlockSpeech(); host.callSounds()?.unlock(); }, keepAwake: keepScreenOn
    });
    return voiceSession;
  }
  let replyBegan = false;
  async function startVoice() {
    if (voiceSession?.active) return;
    if (!host.chatReady()) { showToast('The model is not ready yet.'); return; }
    host.endDictation({ abort: true }); host.stopSpeaking();
    speechMod = await host.loadSpeech(); voiceMod = await host.loadVoice(); await host.ensureCallSounds();
    const session = ensureVoiceSession(); if (!session) return;
    setPressed(true);
    call.log = []; renderCallLog();
    session.start();
    voiceUi.mute.b.focus({ preventScroll: true });
  }
  function endVoice() {
    if (!voiceSession) return;
    voiceSession.stop(); setPressed(false);
    messageInput.focus({ preventScroll: true });
  }
  host.voiceButton()?.addEventListener('click', () => { if (voiceSession?.active) endVoice(); else startVoice(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && voiceSession?.active && !document.querySelector('.app-dialog')) endVoice(); });
  // the reply, as it is written, goes to the voice
  replyListeners.push({
    start: thread => { replyBegan = true; if (voiceSession?.active && thread.id === host.currentThreadId()) voiceSession.replyStarted(); },
    text: (thread, full) => { if (voiceSession?.active && thread.id === host.currentThreadId()) { voiceSession.replyText(full); callLogLive(full); } },
    end: (thread, msg) => {
      if (!voiceSession?.active) return;
      callLogEnd(msg.content || '');
      if (msg.status === 'stopped' || msg.status === 'cancelled') voiceSession.replyEnded({ stopped: true });
      else voiceSession.replyEnded({ text: msg.content || '', ok: msg.status !== 'failed' });
    }
  });
  contextProviders.push(async () => voiceSession?.active && voiceMod ? { preamble: [voiceMod.VOICE_STYLE] } : {});
  document.addEventListener('visibilitychange', () => { if (document.hidden) voiceSession?.pause('background'); });
  window.addEventListener('pagehide', () => { if (voiceSession?.active) voiceSession.stop(); host.callSounds()?.close(); });
  document.getElementById('stopGeneration').addEventListener('click', () => { if (voiceSession?.active) voiceSession.interrupt(); });

  return {
    get active() { return Boolean(voiceSession?.active); },
    start: startVoice, end: endVoice,
    /** Hang up without any ceremony (the app was locked, the page is going away). */
    stop() { voiceSession?.stop(); }
  };
}
