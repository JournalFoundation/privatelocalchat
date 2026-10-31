// Speech through the browser's own services: on an iPhone that is Apple's, in Chrome it is Google's, elsewhere whatever the
// browser provides. Where the browser offers no speech recognition or voices, the matching buttons are simply not shown.

const win = () => globalThis;

export const speechSupport = () => {
  const w = win();
  return { synth: Boolean(w.speechSynthesis && w.SpeechSynthesisUtterance), recognition: Boolean(w.SpeechRecognition || w.webkitSpeechRecognition) };
};

/** Voices that run on the device first (they start faster and work offline), then any others. */
export function voices() {
  const s = win().speechSynthesis; if (!s) return [];
  const all = s.getVoices();
  return [...all.filter((v) => v.localService), ...all.filter((v) => !v.localService)];
}
export function bestVoice(preferredURI, lang = win().navigator?.language || "en") {
  const list = voices(); if (!list.length) return null;
  const same = (v) => v.lang?.toLowerCase() === lang.toLowerCase(), close = (v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase());
  const local = list.filter((v) => v.localService);
  return list.find((v) => v.voiceURI === preferredURI) || local.find(same) || local.find(close) || list.find(same) || list.find(close) || list[0];
}
/** Voices load asynchronously in several browsers. */
export function whenVoicesReady(timeoutMs = 1500) {
  const s = win().speechSynthesis; if (!s) return Promise.resolve([]);
  if (s.getVoices().length) return Promise.resolve(s.getVoices());
  return new Promise((resolve) => { const done = () => { s.removeEventListener?.("voiceschanged", done); resolve(s.getVoices()); }; s.addEventListener?.("voiceschanged", done); setTimeout(done, timeoutMs); });
}

/** Sentence-sized pieces: long utterances stall in some engines. */
export function speechChunks(text, max = 220) {
  const out = [];
  for (const para of String(text).split(/\n+/)) {
    const sentences = para.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [para];
    let cur = "";
    for (const s of sentences) {
      if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ""; }
      if (s.length > max) { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim()); } else cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out.filter(Boolean);
}

/** -> { stop(), done: Promise } ; `done` rejects with a readable Error when the browser has no voice. */
export function speak(text, { voiceURI, rate = 1, onStart, interrupt = true } = {}) {
  const w = win(), s = w.speechSynthesis;
  let stopped = false;
  const done = (async () => {
    if (!s || !w.SpeechSynthesisUtterance) throw new Error("This browser cannot read aloud.");
    await whenVoicesReady();
    const voice = bestVoice(voiceURI);
    if (!voice) throw new Error("This browser has no voice installed for reading aloud.");
    if (interrupt) s.cancel();
    onStart?.();
    for (const piece of speechChunks(text)) {
      if (stopped) return;
      await new Promise((resolve) => {
        const u = new w.SpeechSynthesisUtterance(piece); u.voice = voice; u.lang = voice.lang; u.rate = rate;
        u.onend = resolve; u.onerror = resolve; s.speak(u);
      });
    }
  })();
  return { done, stop() { stopped = true; try { s?.cancel(); } catch { /* idle */ } } };
}

export const dictationMessage = (code) => ({
  "not-allowed": "This browser did not allow speech recognition. Check that the microphone is allowed for this site in your browser or system settings.",
  "service-not-allowed": "Speech recognition is turned off for this browser. Turn on dictation (on iPhone: Settings > General > Keyboard > Enable Dictation) and try again.",
  "audio-capture": "No microphone was found.",
  network: "Dictation needs a connection in this browser right now."
}[code] || `Dictation stopped (${code || "unknown error"}).`);

/** Ask the browser for the microphone directly, to tell "you blocked it" from "this browser gives websites no speech-to-text". */
export async function probeMicrophone() {
  const md = win().navigator?.mediaDevices;
  if (!md?.getUserMedia) return { state: "unsupported" };
  try { const stream = await md.getUserMedia({ audio: true }); stream.getTracks().forEach((t) => t.stop()); return { state: "granted" }; }
  catch (e) { return { state: e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "denied" : e?.name === "NotFoundError" ? "none" : "error", name: e?.name }; }
}

/**
 * Start dictation with the browser's recogniser. onText({ final, interim }) fires as words arrive.
 * Returns { stop(), abort() }: stop() lets pending words arrive; abort() drops everything still in flight (used when a message is sent,
 * because recognisers deliver late results after stop() and those words must never reach the next message).
 * Call it directly from a tap: WebKit only shows the microphone prompt for a recognition started inside a user gesture.
 */
export function startDictation({ lang = win().navigator?.language || "en-US", onText, onEnd, onError }) {
  const SR = win().SpeechRecognition || win().webkitSpeechRecognition;
  const rec = new SR();
  let dead = false;
  rec.lang = lang; rec.continuous = true; rec.interimResults = true;
  rec.onresult = (e) => {
    if (dead) return;
    let fin = "", interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; (r.isFinal ? (fin += r[0].transcript) : (interim += r[0].transcript)); }
    onText?.({ final: fin, interim });
  };
  rec.onerror = (e) => { if (dead) return; if (e.error !== "no-speech" && e.error !== "aborted") onError?.(Object.assign(new Error(dictationMessage(e.error)), { code: e.error })); };
  rec.onend = () => { if (!dead) onEnd?.(); };
  try { rec.start(); } catch (err) { onError?.(err); }
  return { stop() { try { rec.stop(); } catch { /* not running */ } }, abort() { dead = true; rec.onresult = rec.onerror = rec.onend = null; try { rec.abort(); } catch { try { rec.stop(); } catch { /* not running */ } } } };
}
