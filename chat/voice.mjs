// Speech-to-speech conversation. Pure logic (no DOM, no browser speech objects): everything the browser provides is injected, so the
// turn-taking can be tested end to end.
//
//   listening -> (a pause after speaking) -> thinking -> speaking -> listening ...
//
// Replies are spoken sentence by sentence while they are still being written, so the first words come out quickly. The microphone is
// off while the app speaks (no echo), the person can interrupt at any time, and a recogniser that stops by itself is restarted.

export const VOICE_STYLE = "The person is talking with you by voice and your reply will be read aloud. Reply the way a person speaks: short, natural sentences, usually one to three. Do not use Markdown, bullet lists, tables, emoji or code blocks. If a long answer is needed, give the headline first and offer to go on.";

const END = /([.!?…。！？]+["')\]]*)(\s+|$)/;

const CODE_NOTE = "I left a code block out of the spoken reply.";

/** The part of a reply worth reading aloud: fenced code is replaced by one short note. Only ever grows as the reply grows. */
function speakable(full) {
  const lines = full.split("\n"); let inCode = false, noted = false, out = "";
  for (let i = 0; i < lines.length; i++) {
    const last = i === lines.length - 1, line = lines[i];
    if (last && /^\s*`{0,3}$/.test(line) && line.trim()) continue; // a fence being typed: wait to see what it is
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      if (inCode && !noted) { noted = true; out += CODE_NOTE + (last ? "" : "\n"); }
      continue;
    }
    if (!inCode) out += line + (last ? "" : "\n");
  }
  return out;
}

/** Turns a growing reply into speakable sentences. update(fullText) can be called as often as text arrives. */
export function createSentenceStream({ onSentence, clean = (s) => s, minChars = 18 }) {
  let used = 0;
  const emit = (raw) => {
    const text = clean(raw).replace(/https?:\/\/\S+/g, "a link").replace(/\s+/g, " ").trim();
    if (text && /[\p{L}\p{N}]/u.test(text)) onSentence(text);
  };
  return {
    update(full, { final = false } = {}) {
      const body = speakable(full);
      if (body.length < used) used = body.length;
      let pending = body.slice(used);
      for (;;) {
        // a sentence ends at . ! ? or a line break, and is spoken once it has some substance
        let cut = -1;
        const m = END.exec(pending);
        const nl = pending.indexOf("\n");
        if (m && (m.index + m[1].length < pending.length || final || m[2])) cut = m.index + m[0].length;
        if (nl !== -1 && (cut === -1 || nl + 1 < cut)) cut = nl + 1;
        if (cut === -1) break;
        let piece = pending.slice(0, cut);
        if (piece.trim().length < minChars && !final && cut < pending.length && !piece.endsWith("\n")) { // too short to speak alone ("Dr.", "OK."): join the next sentence
          const next = END.exec(pending.slice(cut));
          if (!next) break;
          piece = pending.slice(0, cut + next.index + next[0].length);
        }
        used += piece.length; pending = pending.slice(piece.length);
        emit(piece);
      }
      if (final && pending.trim()) { used += pending.length; emit(pending); }
    },
    reset() { used = 0; }
  };
}

/** Speaks queued sentences one after another. speakOne(text) -> { done: Promise, stop() }. */
export function createSpeaker(speakOne, { onError } = {}) {
  const queue = []; let current = null, running = false, waiters = [], generation = 0;
  const settle = () => { if (!running && !queue.length) { const w = waiters; waiters = []; w.forEach((f) => f()); } };
  async function run() {
    if (running) return; running = true;
    const mine = generation;
    while (queue.length && mine === generation) {
      const text = queue.shift();
      current = speakOne(text);
      try { await current.done; } catch (e) { if (mine === generation) { queue.length = 0; onError?.(e); } }
      current = null;
    }
    if (mine === generation) running = false;
    settle();
  }
  return {
    enqueue(text) { queue.push(text); void run(); },
    clear() { generation++; queue.length = 0; const c = current; current = null; running = false; try { c?.stop(); } catch { /* nothing playing */ } settle(); },
    get busy() { return running || queue.length > 0; },
    idle() { return running || queue.length ? new Promise((r) => waiters.push(r)) : Promise.resolve(); }
  };
}

export function createVoiceSession({ listen, speakOne, send, abortReply, onState = () => {}, clean = (s) => s, unlockAudio = () => {}, keepAwake = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, silenceMs = 1400, restartMs = 250, minChars = 2 }) {
  let active = false, confirmed = false, state = "idle", heard = "", rec = null, silence = null, restart = null, replyDone = true, muted = false, turn = 0, spokeAny = false;
  const set = (next, info = {}) => { state = next; onState(next, { heard, muted, ...info }); };
  const speaker = createSpeaker(speakOne, { onError: (e) => { fail(e.message || "This browser could not speak the reply."); } });
  const stream = createSentenceStream({ clean, onSentence: (text) => { spokeAny = true; speaker.enqueue(text); if (state !== "speaking") set("speaking", { caption: text }); } });
  const stopListening = () => { clearTimer(silence); clearTimer(restart); silence = restart = null; try { rec?.abort(); } catch { /* not running */ } rec = null; };
  function fail(message, code) { stopListening(); speaker.clear(); active = false; keepAwake(false); set("error", { message, code }); }

  function startListening() {
    if (!active || muted) return;
    stopListening(); heard = ""; set("listening", { caption: "" });
    rec = listen({
      onText: ({ final, interim }) => {
        confirmed = true;
        if (state !== "listening") return;
        heard = (heard.replace(/\s*$/, " ") + (final || "")).trimStart();
        const live = (heard + (interim ? (heard ? " " : "") + interim : "")).trim();
        onState("listening", { heard: live, muted, caption: live });
        if (live) { clearTimer(silence); silence = setTimer(() => submit(), silenceMs); }
      },
      onEnd: () => { // the recogniser stopped by itself (browsers end it after silence)
        confirmed = true;
        if (!active || state !== "listening") return;
        if (heard.trim().length >= minChars) submit(); else { clearTimer(restart); restart = setTimer(() => startListening(), restartMs); }
      },
      onError: (e) => {
        if (["not-allowed", "service-not-allowed", "audio-capture"].includes(e?.code)) {
          // the very first start failing means the browser will not do it; later on it is usually only that this restart was not a tap
          if (confirmed && e.code !== "audio-capture") { stopListening(); set("paused", { reason: "tap" }); } else fail(e.message, e.code);
        } else if (state === "listening") { clearTimer(restart); restart = setTimer(() => startListening(), 1000); } }
    });
  }

  function submit() {
    if (!active || state !== "listening") return;
    const text = heard.trim();
    if (text.length < minChars) return;
    stopListening();
    turn++; replyDone = false; spokeAny = false; stream.reset();
    set("thinking", { caption: text });
    Promise.resolve().then(() => send(text)).catch((e) => fail(e?.message || "The message could not be sent."));
  }

  function maybeListenAgain() {
    if (!active || !replyDone) return;
    speaker.idle().then(() => { if (active && replyDone && !speaker.busy && (state === "speaking" || state === "thinking")) startListening(); });
  }

  return {
    get state() { return state; },
    get active() { return active; },
    start() { if (active) return; active = true; confirmed = false; muted = false; unlockAudio(); keepAwake(true); startListening(); },
    stop() { active = false; stopListening(); speaker.clear(); abortReply(); keepAwake(false); set("idle"); },
    /** Tap on the orb: send what was heard now, or interrupt speech. */
    tap() { if (state === "listening") submit(); else if (state === "speaking" || state === "thinking") this.interrupt(); else if (state === "paused" && !muted) { startListening(); } },
    interrupt() {
      if (!active || (state !== "speaking" && state !== "thinking")) return;
      speaker.clear(); replyDone = true; abortReply(); startListening();
    },
    setMuted(value) { muted = Boolean(value); if (!active) return; if (muted) { stopListening(); if (state === "listening") set("paused", { reason: "muted" }); } else if (state === "paused") startListening(); },
    /** The page went to the background: browsers stop the microphone, so wait for a tap. */
    pause(reason = "background") { if (!active) return; if (state === "listening") { stopListening(); set("paused", { reason }); } },
    resume() { if (active && state === "paused" && !muted) startListening(); },
    // the app reports the reply as it is written
    replyStarted() { if (!active) return; replyDone = false; spokeAny = false; stream.reset(); if (state !== "thinking") set("thinking"); },
    replyText(full) { if (active && !replyDone) stream.update(full); },
    replyEnded({ text = "", ok = true, stopped = false } = {}) {
      if (!active) return;
      if (stopped) { // the reply was cut short (interrupted, or never began): nothing more to say, so listen again
        if (!replyDone || state === "thinking") { replyDone = true; speaker.clear(); startListening(); }
        return;
      }
      replyDone = true;
      if (ok) stream.update(text, { final: true });
      else if (!spokeAny) { speaker.enqueue("Sorry, that did not work. Try again."); }
      if (!speaker.busy) startListening(); else maybeListenAgain();
    }
  };
}
