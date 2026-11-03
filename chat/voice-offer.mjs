// The quiet offer line for the downloaded read-aloud voice. It reuses existing classes (set-note, set-btn from chat/shell.css) and is
// shown once, near the message actions, only when the controller says the device passed every check.

const mb = (n) => Math.max(1, Math.round(n / 1e6)) + " MB";

export function showVoiceOffer(ctl, anchor, { doc = document } = {}) {
  if (ctl.state !== "offered" || !anchor?.parentNode) return null;
  doc.getElementById("voiceOffer")?.remove(); // a fresh offer (for example from Settings) replaces an earlier line that is still showing
  const line = doc.createElement("div");
  line.id = "voiceOffer"; line.className = "set-note"; line.setAttribute("role", "group"); line.setAttribute("aria-label", "Voice offer");
  const text = doc.createElement("span"), controls = doc.createElement("span");
  const button = (label, onclick, id) => { const b = doc.createElement("button"); b.type = "button"; b.className = "set-btn"; b.id = id; b.textContent = label; b.addEventListener("click", onclick); return b; };
  const show = (message, ...buttons) => { text.textContent = message + " "; controls.replaceChildren(...buttons); };
  const gone = () => line.remove();
  const offer = () => show("A more natural voice is available, " + mb(ctl.info.bytes) + ", works offline.",
    button("Try it", try_, "voiceOfferTry"), button("Not now", () => { ctl.dismiss(); gone(); }, "voiceOfferLater"));
  const verdict = () => show("This is the new voice. Keep it?",
    button("Keep this voice", () => { ctl.keep(); show("Done. Replies will be read in this voice. You can change it in Settings."); setTimeout(gone, 4000); }, "voiceOfferKeep"),
    button("Use the system voice", async () => { await ctl.decline(); gone(); }, "voiceOfferSystem"));
  async function try_() {
    const off = ctl.subscribe((s) => { if (s.state === "installing" && s.progress?.total) text.textContent = "Downloading the voice, " + Math.round((s.progress.done / s.progress.total) * 100) + "%. "; });
    show("Downloading the voice, 0%.");
    const r = await ctl.accept(); off();
    if (!r.ok) {
      const failed = String(r.reason || "").startsWith("error:"); // a failed download or setup says so and can be retried; only a slow voice is "not good enough"
      show(failed ? "The download or setup failed (" + String(r.reason).slice(6).trim().slice(0, 120) + "). Nothing was kept. You can try again from Settings > Voice." : "The voice did not work well enough on this device, so it was removed. The system voice stays.");
      setTimeout(gone, 8000); return;
    }
    verdict();
  }
  line.append(text, controls);
  anchor.parentNode.insertBefore(line, anchor.nextSibling);
  offer();
  return line;
}
