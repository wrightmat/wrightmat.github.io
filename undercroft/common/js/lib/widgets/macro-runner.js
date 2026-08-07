// The Dashboard Macro execution engine — runs a saved `macro` Library
// record's own `actions` array in order, dispatching each action to
// whichever widget module owns that action type. See the "macro" kind
// (common/data/kind/macro.json) and the Macro board widget
// (macro-board.js), the primary Phase 1 trigger surface.
//
// Every action handler below is a standalone function taking
// `(action, {dataManager, groupContext, status})` — none of them require a
// live, mounted widget instance anywhere on this dashboard (that's the
// whole point: a macro is portable/shareable content, not something tied
// to one specific arrangement of cards). Handout/Map/Browser/Game Log need
// no widget-specific code at all — they're direct dataManager calls, since
// "show this to the table" and "post a message" are already generic,
// content-addressed operations with nothing widget-instance-specific about
// them (see spotlight.js's own resolveSpotlightData: any (kind,id) pair
// works, posted by anyone).
import { runWledMacroAction } from "./wled.js";
import { runSoundboardMacroAction } from "./soundboard.js";
import { runCombatMacroAction } from "./combat-tracker.js";
import { runCharacterMacroAction } from "./character-sheet.js";
import { runDiceRollerMacroAction } from "./dice-roller.js";
import { describeMacroAction } from "./macro-action-catalog.js";

// A macro-owned spotlight id for kinds with no Library record of their own
// (Browser is one of server/groups.py's own _INLINE_SPOTLIGHT_KINDS) —
// distinct from any real widget instanceId (always `w_xxxxx`, see
// dashboard.js's generateInstanceId), so a macro-triggered broadcast can
// never collide with a live widget's own broadcast slot. Soundboard keeps
// its own copy of this same constant (soundboard.js) since its actions live
// in that file, not here.
const MACRO_SPOTLIGHT_ID = "macro";

async function runBrowserMacroAction(action, { dataManager, groupContext }) {
  const groupId = groupContext?.groupId;
  if (!groupId) {
    throw new Error("No active campaign to show/hide this to.");
  }
  if (action?.action === "show") {
    const url = String(action?.params?.url || "").trim();
    if (!url) throw new Error("No URL given.");
    await dataManager.spotlightToGroup({
      groupId,
      contentType: "browser",
      contentId: MACRO_SPOTLIGHT_ID,
      skipShare: true,
      data: { url },
    });
    return;
  }
  if (action?.action === "hide") {
    await dataManager.clearSpotlight({ groupId, kind: "browser", id: MACRO_SPOTLIGHT_ID });
    return;
  }
  throw new Error(`Unknown Browser macro action "${action?.action}".`);
}

async function runGamelogMacroAction(action, { dataManager, groupContext }) {
  if (action?.action !== "post") {
    throw new Error(`Unknown Game Log macro action "${action?.action}".`);
  }
  const message = String(action?.params?.message || "").trim();
  if (!message) throw new Error("No message given.");
  const groupId = groupContext?.groupId;
  if (!groupId) throw new Error("No active campaign to post to.");
  await dataManager.createGroupLogEntry({ groupId, type: "message", message });
}

// Handout/Map share the exact same shape — a real Library `contentRef`
// (kind+id, optionally a print templateId), no widget-specific code beyond
// which server-side `kind` string "show"/"hide" target.
function makeContentRefMacroAction(defaultKind) {
  return async function runContentRefMacroAction(action, { dataManager, groupContext }) {
    const groupId = groupContext?.groupId;
    if (!groupId) throw new Error("No active campaign to show/hide this to.");
    const contentRef = action?.params?.contentRef;
    const kind = contentRef?.kind || defaultKind;
    const id = contentRef?.id;
    if (action?.action === "show") {
      if (!id) throw new Error("No content to show — this action needs a contentRef.");
      await dataManager.spotlightToGroup({
        groupId,
        contentType: kind,
        contentId: id,
        templateId: contentRef?.templateId || undefined,
      });
      return;
    }
    if (action?.action === "hide") {
      if (!id) throw new Error("No content to hide — this action needs a contentRef.");
      await dataManager.clearSpotlight({ groupId, kind, id });
      return;
    }
    throw new Error(`Unknown ${defaultKind} macro action "${action?.action}".`);
  };
}

// Clock/Calendar have no standalone runner of their own (unlike every other
// handler here) — their real state lives only in whichever mounted widget
// instance is currently shown to the table (see clocks.js/calendar.js's own
// runMacroAction), so all this does is require that dashboard.js's
// ensureWidget actually found one (via findActiveWidgetInstance) before
// delegating to it. A clear, named failure ("nothing shown right now")
// rather than a silent no-op when it didn't.
function makeLiveWidgetMacroAction(label) {
  return async function runLiveWidgetMacroAction(action, { widgetInstance } = {}) {
    if (!widgetInstance || typeof widgetInstance.runMacroAction !== "function") {
      throw new Error(`No ${label} currently shown to the table.`);
    }
    return widgetInstance.runMacroAction(action);
  };
}

const ACTION_HANDLERS = {
  wled: runWledMacroAction,
  soundboard: runSoundboardMacroAction,
  combat: runCombatMacroAction,
  character: runCharacterMacroAction,
  diceroller: runDiceRollerMacroAction,
  browser: runBrowserMacroAction,
  gamelog: runGamelogMacroAction,
  handout: makeContentRefMacroAction("handout"),
  map: makeContentRefMacroAction("map"),
  clock: makeLiveWidgetMacroAction("clock"),
  calendar: makeLiveWidgetMacroAction("calendar"),
};

// `ctx.wledDevices` is threaded through separately from the generic
// dataManager/groupContext/status trio — WLED is the one action type that
// needs a per-account resource list to resolve its own `target` alias
// against (see wled.js's own resolveWledDeviceByAlias), not something a
// Library-content-addressed action (Handout, Combat's encounter id, ...)
// needs at all.
//
// `ensureWidget(action)` (optional) is called once per action, before its
// handler runs — dashboard.js's own ensureWidgetForMacroAction is what the
// Macro board widget passes, giving the GM a live, on-screen control
// surface (auto-added if missing) for the widget type an action just
// touched — see soundboard.js's own runMacroAction for the type where this
// actually matters (ephemeral in-browser playback state, not just "does a
// record/device already reflect this"). Its return value (a mounted
// widget's own instance handle, or null) is handed to the action handler
// as `widgetInstance`; every handler that doesn't care simply ignores it.
// Left undefined entirely by callers with no widget grid to add to at all
// (journal-macro.js's own Journal-triggered runs) — no behavior change
// there, this whole mechanism is opt-in.
export async function runMacro(macro, { dataManager, groupContext, status, wledDevices = [], ensureWidget } = {}) {
  const actions = Array.isArray(macro?.actions) ? macro.actions : [];
  for (const action of actions) {
    const handler = ACTION_HANDLERS[action?.type];
    if (!handler) {
      status?.show?.(`"${macro?.name || "Macro"}": unknown action type "${action?.type}".`, {
        type: "error",
        timeout: 3000,
      });
      continue;
    }
    let widgetInstance = null;
    if (typeof ensureWidget === "function") {
      try {
        widgetInstance = ensureWidget(action);
      } catch (error) {
        // Best-effort — the action itself still runs standalone below.
      }
    }
    try {
      await handler(action, { dataManager, groupContext, status, wledDevices, widgetInstance });
      // One toast per successful step, in addition to the caller's own
      // overall "Ran ..." summary (macro-board.js) — a multi-step macro like
      // "Haunted Forest" (lights + music + a handout) otherwise gives no
      // visible confirmation of which of its several real-world effects
      // actually fired, only that the macro as a whole finished.
      status?.show?.(`✓ ${describeMacroAction(action)}`, { type: "success", timeout: 1800 });
    } catch (error) {
      // One bad step (an unreachable WLED device, an unresolved device
      // alias, a missing clip) doesn't abort the rest of the macro — see
      // the plan's own "Verification" section for why this matters at the
      // table: a GM firing "Haunted Forest" mid-scene needs the sound and
      // handout to still fire even if one light is unplugged.
      status?.show?.(`✗ ${describeMacroAction(action)}: ${error?.message || error}`, {
        type: "error",
        timeout: 4000,
      });
    }
  }
}
