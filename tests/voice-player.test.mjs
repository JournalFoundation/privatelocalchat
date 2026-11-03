import test from "node:test";
import assert from "node:assert/strict";


test("on iPhone the audio session is set to playback while a player plays and put back after, so the ringer switch and the earpiece do not silence it", async () => {
  const { createGaplessPlayer } = await import("../chat/voice-player.mjs");
  const { fakeAudioContext } = await import("./helpers/fake-voice-engine.mjs");
  const audioSession = { type: "auto" };
  const a = createGaplessPlayer({ createContext: fakeAudioContext, audioSession });
  assert.equal(audioSession.type, "auto", "nothing is claimed before there is sound");
  a.push(new Float32Array(2400).fill(0.1), 24000);
  assert.equal(audioSession.type, "playback");
  const b = createGaplessPlayer({ createContext: fakeAudioContext, audioSession });
  b.push(new Float32Array(2400).fill(0.1), 24000);
  a.stop();
  assert.equal(audioSession.type, "playback", "still playing for the second player");
  await b.finish();
  assert.equal(audioSession.type, "auto", "put back when the last player is done");
});

test("a browser without audioSession plays as before", async () => {
  const { createGaplessPlayer } = await import("../chat/voice-player.mjs");
  const { fakeAudioContext } = await import("./helpers/fake-voice-engine.mjs");
  const p = createGaplessPlayer({ createContext: fakeAudioContext, audioSession: undefined });
  p.push(new Float32Array(2400).fill(0.1), 24000); await p.finish();
});
