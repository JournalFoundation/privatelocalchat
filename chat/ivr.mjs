// Roberta's phone menu as a state machine. It knows nothing about the page: speech, the actions behind menu items (start the download, open
// the share sheet, ...) and the matcher that turns something a person said into a menu item are all injected, so the whole call can be tested.
//
//   const ivr = createIvr({ getContext, say, stopSpeech, actions, router, onChange });
//   ivr.start();            introduction, then the main menu
//   ivr.press("3");         a keypad press (barges in on anything being said)
//   ivr.hear("is this sending my data to the cloud");   something said or typed, matched by meaning
//
// Keys: 1-9 choose, 0 hears the menu again, * goes back, # starts chatting. A press always interrupts what is being said.
import { NODES, MAIN_MENU, KEY_TO_NODE, menuPrompt, menuItems, introScript, FALLBACK_SAY } from "./ivr-content.mjs";

export function createIvr({ getContext, say, stopSpeech = () => {}, actions = {}, router = null, onChange = () => {}, now = () => Date.now() }) {
  let nodeId = null;                 // null = the main menu
  const stack = [];                  // where "back" goes
  let token = 0;                     // makes late speech from an interrupted turn harmless
  let phase = "idle";                // idle | speaking | menu
  let pendingAction = null;          // an action that needs a tap (browsers only allow a file chooser inside a gesture)
  let started = false, matching = false;
  const transcript = [];

  const ctx = () => getContext();
  const emit = () => onChange(snapshot());
  function snapshot() {
    const c = ctx();
    return { started, phase, matching, nodeId, items: menuItems(nodeId, c), pendingAction, transcript: transcript.slice(-30), title: nodeId ? NODES[nodeId].label(c) : "Main menu" };
  }
  const note = (who, text) => { transcript.push({ who, text, at: now() }); };

  /** Speaks sentences in order; resolves when finished or when something interrupted it. */
  async function speak(lines, mine = token) {
    const spoken = lines.filter(Boolean);
    if (!spoken.length) return;
    phase = "speaking"; emit();
    for (const line of spoken) {
      if (mine !== token) return;
      note("roberta", line); emit();
      try { await say([line]); } catch { /* a voice that fails is not the person's problem; the text is shown */ }
    }
    if (mine === token) { phase = "menu"; emit(); }
  }

  function interrupt() { token++; try { stopSpeech(); } catch { /* nothing playing */ } }

  async function playMenu(mine) {
    await speak(menuPrompt(nodeId, ctx()), mine);
  }

  async function open(id, { viaGesture = false } = {}) {
    const node = NODES[id];
    if (!node) return;
    interrupt(); const mine = token;
    pendingAction = null;
    if (node.children.length) { stack.push(nodeId); nodeId = id; }
    else if (!MAIN_MENU.includes(id) && nodeId !== id) { /* a leaf reached by speech: stay where we were so "back" works */ }
    if (node.action && actions[node.action]) {
      if (node.needsGesture && !viaGesture) pendingAction = { id: node.action, label: pendingLabel(node.action) };
      else { try { actions[node.action]({ viaGesture, node: id, context: ctx() }); } catch { /* the page reports its own errors */ } }
    }
    if (viaGesture && node.key) note("you", `Pressed ${node.key === "#" ? "pound" : node.key}`);
    await speak(node.say(ctx()), mine);
    if (mine !== token) return;
    if (node.children.length) await playMenu(mine);
    else if (pendingAction) await speak([`Tap the button on your screen to ${pendingLabel(node.action).toLowerCase()}.`], mine);
    else await speak([nodeId ? "Press a number for another topic, star to go back, or zero to hear these options." : "Press zero to hear the menu."], mine);
    emit();
  }

  const pendingLabel = (action) => ({ openImport: "Choose a backup file", openShare: "Open the share sheet", openExport: "Open Transfer chats and backups", openTransferSettings: "Open Transfer settings", startVoicemail: "Start recording" }[action] || "Continue");

  function back() {
    interrupt(); const mine = token;
    nodeId = stack.length ? stack.pop() : null; pendingAction = null;
    return playMenu(mine);
  }

  const api = {
    get state() { return snapshot(); },
    /** The introduction, then the main menu. */
    async start() {
      started = true; interrupt(); const mine = token; nodeId = null; stack.length = 0; pendingAction = null;
      await speak(introScript(ctx()), mine);
      if (mine === token) await playMenu(mine);
    },
    /** A keypad press: 0-9, * or #. `viaGesture` is true when it came from a real tap or key press. */
    async press(key, { viaGesture = true } = {}) {
      const k = String(key);
      if (!/^[0-9*#]$/.test(k)) return;
      if (k === "0") { interrupt(); const mine = token; pendingAction = null; return playMenu(mine); }
      if (k === "*") return back();
      if (k === "#") return open("chat", { viaGesture });
      const parent = nodeId && NODES[nodeId];
      if (parent?.children?.length) {
        const child = parent.children[Number(k) - 1];
        if (child) return open(child, { viaGesture });
      } else if (KEY_TO_NODE[k] && MAIN_MENU.includes(KEY_TO_NODE[k])) return open(KEY_TO_NODE[k], { viaGesture });
      interrupt(); const mine = token;
      await speak([`${k} isn't one of the options.`], mine);
      await playMenu(mine);
    },
    /** Something said or typed. Matched by meaning; a confident match behaves like the key press for it. */
    async hear(text) {
      const said = String(text || "").trim();
      if (!said) return;
      interrupt(); const mine = token; note("you", said);
      if (!router) { await speak(FALLBACK_SAY(ctx()), mine); return; }
      matching = true; emit();
      let result;
      try { result = await router.route(said); } catch { result = null; } finally { matching = false; }
      if (mine !== token) return;
      const intent = result?.intent;
      if (!intent || result.confidence === "low") {
        const near = (result?.candidates || []).filter((x) => x.intent && !x.intent.startsWith("ctl.")).slice(0, 2);
        await speak(FALLBACK_SAY(ctx()), mine);
        if (near.length && mine === token) await speak([`Did you mean ${near.map((x) => NODES[x.intent].label(ctx()).replace(/^to /, "")).join(", or ")}?`], mine);
        return;
      }
      if (intent === "ctl.repeat") { pendingAction = null; return playMenu(mine); }
      if (intent === "ctl.back") return back();
      return open(intent, { viaGesture: false });
    },
    /** Runs the action that was waiting for a tap. */
    runPending() {
      if (!pendingAction) return;
      const { id } = pendingAction; pendingAction = null; emit();
      try { actions[id]?.({ viaGesture: true, context: ctx() }); } catch { /* the page reports its own errors */ }
    },
    interrupt() { interrupt(); phase = "menu"; emit(); },
    stop() { interrupt(); started = false; phase = "idle"; nodeId = null; stack.length = 0; pendingAction = null; emit(); },
    refresh: emit
  };
  return api;
}
