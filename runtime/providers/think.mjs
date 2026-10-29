// Empty think blocks. Qwen3.5 thinks by default; the app asks for enable_thinking:false on ordinary replies and WebLLM then starts the
// assistant text with an EMPTY block ("<think>\n\n</think>\n\n"). That exact empty block (whitespace tolerant) is removed from visible text
// and from anything parsed as JSON. A block with content is real reasoning and is never removed here: it passes through untouched.
const OPEN = "<think>"; const CLOSE = "</think>";
const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t";
const skipWs = (t, i) => { while (i < t.length && isWs(t[i])) i++; return i; };

/** "match" (end = index after the block and trailing whitespace), "prefix" (could still become one), or "no". */
export function emptyThinkAtStart(text) {
  let i = skipWs(text, 0);
  const rest = text.slice(i);
  if (rest.length < OPEN.length) return OPEN.startsWith(rest) ? { state: "prefix" } : { state: "no" };
  if (!rest.startsWith(OPEN)) return { state: "no" };
  let j = skipWs(text, i + OPEN.length);
  const tail = text.slice(j);
  if (tail.length < CLOSE.length) return CLOSE.startsWith(tail) ? { state: "prefix" } : { state: "no" };
  if (!tail.startsWith(CLOSE)) return { state: "no" };
  return { state: "match", end: skipWs(text, j + CLOSE.length) };
}

/** For finished text (JSON parsing, stored replies). */
export function stripEmptyThink(text) {
  const r = emptyThinkAtStart(String(text ?? ""));
  return r.state === "match" ? String(text).slice(r.end) : String(text ?? "");
}

/** Streaming filter: push deltas, get the visible part back. Output is held back only while the start could still be an empty block. */
export function createThinkFilter() {
  let pending = ""; let decided = false; let skipLead = false;
  return {
    push(delta) {
      if (decided) { if (skipLead) { const k = skipWs(delta, 0); if (k < delta.length) skipLead = false; return delta.slice(k); } return delta; }
      pending += delta;
      const r = emptyThinkAtStart(pending);
      if (r.state === "prefix") return "";
      decided = true;
      if (r.state === "match") { const out = pending.slice(r.end); skipLead = r.end >= pending.length; pending = ""; return out; }
      const out = pending; pending = ""; return out;
    },
    /** End of stream: whatever was held back is real text (or a lone partial block) and is released, never dropped. */
    flush() { const out = pending; pending = ""; decided = true; return out; }
  };
}
