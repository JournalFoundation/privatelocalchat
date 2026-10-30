// Speech that stays on the device. Reading aloud uses only voices the browser marks as local; dictation is offered only when the
// browser can confirm recognition runs on this device. If either cannot be confirmed the feature explains why and stays off:
// audio is never handed to a server-side recogniser or a remote voice.

const win = () => globalThis;

export const speechState = () => {
  const w = win();
  return { synth: Boolean(w.speechSynthesis && w.SpeechSynthesisUtterance), recognition: Boolean(w.SpeechRecognition || w.webkitSpeechRecognition) };
};

export function localVoices() {
  const s = win().speechSynthesis; if (!s) return [];
  return s.getVoices().filter((v) => v.localService === true);
}
export function bestVoice(preferredURI, lang = win().navigator?.language || "en") {
  const voices = localVoices(); if (!voices.length) return null;
  return voices.find((v) => v.voiceURI === preferredURI) || voices.find((v) => v.lang?.toLowerCase() === lang.toLowerCase()) || voices.find((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) || voices[0];
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

/** -> { stop(), done: Promise } ; rejects `done` with an Error when no local voice exists. */
export function speak(text, { voiceURI, rate = 1, onStart } = {}) {
  const w = win(), s = w.speechSynthesis;
  let stopped = false;
  const done = (async () => {
    if (!s || !w.SpeechSynthesisUtterance) throw new Error("This browser cannot read aloud.");
    await whenVoicesReady();
    const voice = bestVoice(voiceURI);
    if (!voice) throw new Error("No on-device voice is available in this browser. Read-aloud stays off rather than using a remote voice.");
    s.cancel();
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

/** -> { state: 'available'|'downloadable'|'unavailable', reason } */
export async function dictationAvailability(lang = win().navigator?.language || "en-US") {
  const w = win(), SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return { state: "unavailable", reason: "This browser has no speech recognition." };
  if (typeof SR.available !== "function" || !("processLocally" in SR.prototype)) return { state: "unavailable", reason: "This browser can’t confirm that speech recognition stays on your device, so dictation is turned off." };
  try {
    const status = await SR.available({ langs: [lang], processLocally: true });
    if (status === "available") return { state: "available", reason: "" };
    if (status === "downloadable" || status === "downloading") return { state: "downloadable", reason: "An on-device speech pack for " + lang + " needs to be downloaded first." };
    return { state: "unavailable", reason: "This browser has no on-device speech recognition for " + lang + "." };
  } catch { return { state: "unavailable", reason: "On-device speech recognition could not be checked." }; }
}
export async function installDictation(lang = win().navigator?.language || "en-US") {
  const SR = win().SpeechRecognition || win().webkitSpeechRecognition;
  return SR.install({ langs: [lang], processLocally: true });
}

/** Start local-only dictation. onText({ final, interim }) fires as words arrive. Returns { stop() }. */
export function startDictation({ lang = win().navigator?.language || "en-US", onText, onEnd, onError }) {
  const SR = win().SpeechRecognition || win().webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = lang; rec.continuous = true; rec.interimResults = true; rec.processLocally = true;
  if (rec.processLocally !== true) { onError?.(new Error("This browser would not keep recognition on the device, so dictation was not started.")); return { stop() {} }; }
  rec.onresult = (e) => {
    let fin = "", interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; (r.isFinal ? (fin += r[0].transcript) : (interim += r[0].transcript)); }
    onText?.({ final: fin, interim });
  };
  rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") onError?.(new Error("Dictation stopped: " + (e.error || "unknown error") + ".")); };
  rec.onend = () => onEnd?.();
  try { rec.start(); } catch (err) { onError?.(err); }
  return { stop() { try { rec.stop(); } catch { /* not running */ } } };
}
