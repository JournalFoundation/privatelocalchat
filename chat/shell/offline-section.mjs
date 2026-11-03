// Settings > Models > "Ready for offline use": one summary line and the checklist (runtime/offline-readiness.mjs), with a button on every line that
// something would fix. Draws only; the facts and the fixes come from app.offline.
import { renderChecklist } from "./offline-checklist.mjs";

export function buildOfflineSection({ app, h }) {
  const offline = app.offline;
  const body = h("div", { class: "set-card", id: "offlineCard" });
  const summary = h("p", { class: "set-desc off-summary", id: "offlineSummary", role: "status", "aria-live": "polite", text: "Checking whether this device is ready for offline use…" });
  const section = h("section", { id: "offlineSection", "aria-labelledby": "offlineHead" },
    h("h3", { class: "set-sub", id: "offlineHead", text: "Ready for offline use" }), summary, body);
  async function paint(result) {
    result = result || await offline.readiness();
    summary.textContent = result.text; summary.dataset.summary = result.summary;
    body.textContent = "";
    body.append(renderChecklist(h, result, { onFix: (action) => offline.fix(action) }));
  }
  if (offline) { offline.subscribe(paint); paint(); } else section.hidden = true;
  return { section, paint };
}
