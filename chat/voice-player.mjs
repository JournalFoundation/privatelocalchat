// Gapless playback of synthesised audio: chunks (Float32Array + sample rate) are queued as AudioBuffers and each one starts exactly
// where the previous one ends. The AudioContext is injected so this can be tested without a browser.

// On iPhone and iPad a page's Web Audio is, by default, "ambient": the ringer switch (silent mode) mutes it and, after the microphone was used, it can go to the
// quiet earpiece instead of the speaker. The system voice is not affected, which made downloaded voices look silent unless headphones were plugged in.
// navigator.audioSession.type = "playback" (Safari 16.4+) says "this is media the person asked to hear": it plays through the speaker, ignoring the ringer switch.
// It is set while a player is playing and put back afterwards. A count keeps overlapping players from restoring it under each other.
let sessionUsers = 0, sessionBefore = null;
function claimSpeaker(session) {
  try {
    if (!session) return () => {};
    if (sessionUsers++ === 0) { sessionBefore = session.type; if (session.type !== "playback") session.type = "playback"; }
    let done = false;
    return () => { if (done) return; done = true; if (--sessionUsers === 0) { try { if (sessionBefore != null && session.type === "playback") session.type = sessionBefore; } catch { /* leave it */ } sessionBefore = null; } };
  } catch { sessionUsers = Math.max(0, sessionUsers - 1); return () => {}; }
}

export function createGaplessPlayer({ createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(), hold = false, audioSession = globalThis.navigator?.audioSession } = {}) {
  let giveBackSpeaker = () => {};
  // hold: chunks are kept (not played) until release(), so a voice slower than playback can build a lead and then play without stutter
  let held = hold; const queue = [];
  let ctx = null, next = 0, pending = 0, ended = false, stopped = false, waiter = null;
  const sources = new Set();
  let closed = false;
  const closeContext = () => { if (closed || !ctx) return; closed = true; giveBackSpeaker(); try { Promise.resolve(ctx.close?.()).catch(() => {}); } catch { /* already closed */ } };
  const settle = () => { if (waiter && ended && pending === 0) { const w = waiter; waiter = null; w(); } };
  return {
    /** Queue one chunk. */
    push(samples, sampleRate) {
      if (stopped || !samples?.length) return;
      if (held) { queue.push([samples, sampleRate]); return; }
      if (!ctx) giveBackSpeaker = claimSpeaker(audioSession);
      ctx ||= createContext();
      try { ctx.resume?.(); } catch { /* already running */ }
      const buf = ctx.createBuffer(1, samples.length, sampleRate);
      if (buf.copyToChannel) buf.copyToChannel(samples, 0); else buf.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination);
      const at = Math.max(next, ctx.currentTime + 0.02);
      next = at + buf.duration;
      pending++; sources.add(src);
      src.onended = () => { sources.delete(src); pending--; settle(); };
      src.start(at);
    },
    /** Start playing what was held, and everything after it. */
    release() { held = false; const q = queue.splice(0); for (const [a, r] of q) this.push(a, r); },
    /** No more chunks are coming. Resolves when everything queued has been played (or the player was stopped). */
    finish() {
      if (held) this.release(); ended = true;
      // the audio context is closed when playback is over, so repeated read-alouds do not pile up open contexts
      return (pending === 0 ? Promise.resolve() : new Promise((r) => { waiter = r; })).then(closeContext);
    },
    stop() {
      stopped = true; ended = true;
      for (const s of sources) { try { s.onended = null; s.stop(); } catch { /* not started */ } }
      sources.clear(); queue.length = 0; pending = 0; settle();
      closeContext();
    },
    get started() { return next > 0; }
  };
}
