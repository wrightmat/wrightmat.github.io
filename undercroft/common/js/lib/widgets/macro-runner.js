// The Dashboard Macro execution engine — runs a saved `macro` Library
// record's own `actions` array in order, dispatching each to whichever
// widget module owns that action type. See the "macro" kind and the Board
// widget's own macro-button cards (board.js), the primary trigger surface.
//
// Every action handler below is a standalone function taking
// `(action, {dataManager, groupContext, status})` — none require a live,
// mounted widget instance (a macro is portable/shareable content, not tied
// to one arrangement of cards). Handout/Map/Browser/Game Log need no
// widget-specific code — they're direct dataManager calls, since "show this
// to the table" and "post a message" are already generic, content-addressed
// operations (any (kind,id) pair works, posted by anyone).
import { runWledMacroAction, resolveWledDeviceByAlias, promptForWledAlias } from "./wled.js";
import { runHaMacroAction } from "./home-assistant.js";
import { runSoundboardMacroAction } from "./soundboard.js";
import { runCombatMacroAction } from "./combat-tracker.js";
import { runCharacterMacroAction } from "./character-sheet.js";
import { runDiceRollerMacroAction } from "./dice-roller.js";
import { runDeckMacroAction } from "./deck.js";
import { describeMacroAction } from "./macro-action-catalog.js";

// A macro-owned spotlight id for kinds with no Library record of their own
// (Browser is one of server/groups.py's _INLINE_SPOTLIGHT_KINDS) — distinct
// from any real widget instanceId (always `w_xxxxx`), so a macro-triggered
// broadcast can never collide with a live widget's own slot. Soundboard
// keeps its own copy of this constant since its actions live in that file.
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
// which `kind` string "show"/"hide" targets.
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

// Replays a placed, non-looping particle effect via whichever Map widget is
// currently shown (`widgetInstance`, resolved by dashboard.js's
// ensureWidgetForMacroAction — same "no widget shown, no auto-create"
// restriction Clock/Calendar have, since an effect can't conjure a Map into
// existence). Replays locally through triggerByLabel, then broadcasts so
// the rest of the table sees it too, mirroring deck.js's runDeckMacroAction.
async function runEffectsMacroAction(action, { dataManager, groupContext, widgetInstance }) {
  if (action?.action !== "trigger") {
    throw new Error(`Unknown Effects macro action "${action?.action}".`);
  }
  if (!widgetInstance || typeof widgetInstance.triggerByLabel !== "function") {
    throw new Error("No map currently shown to the table.");
  }
  const target = String(action?.params?.target || "").trim();
  if (!target) throw new Error("No effect label given.");
  const elementId = widgetInstance.triggerByLabel(target);
  const groupId = groupContext?.groupId;
  if (groupId && widgetInstance.mapId) {
    await dataManager.postEffectBroadcast({ groupId, mapId: widgetInstance.mapId, elementId });
  }
}

// Clock/Calendar have no standalone runner — their real state lives only in
// whichever mounted widget instance is currently shown to the table, so
// this just requires ensureWidget found one before delegating, with a clear
// named failure rather than a silent no-op when it didn't.
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
  homeAssistant: runHaMacroAction,
  soundboard: runSoundboardMacroAction,
  combat: runCombatMacroAction,
  character: runCharacterMacroAction,
  diceroller: runDiceRollerMacroAction,
  deck: runDeckMacroAction,
  browser: runBrowserMacroAction,
  gamelog: runGamelogMacroAction,
  handout: makeContentRefMacroAction("handout"),
  map: makeContentRefMacroAction("map"),
  effects: runEffectsMacroAction,
  clock: makeLiveWidgetMacroAction("clock"),
  calendar: makeLiveWidgetMacroAction("calendar"),
};

// `ctx.wledDevices` is threaded separately from the generic dataManager/
// groupContext/status trio — WLED is the one action type that needs a
// per-account resource list to resolve its `target` alias against.
//
// `ensureWidget(action)` (optional) is called once per action, before its
// handler runs — dashboard.js's ensureWidgetForMacroAction gives the GM a
// live, on-screen control surface (auto-added if missing) for the widget
// type an action just touched (see soundboard.js's runMacroAction for where
// this matters: ephemeral in-browser playback state). Its return value (a
// mounted widget's instance handle, or null) is handed to the handler as
// `widgetInstance`. Left undefined by callers with no widget grid at all
// (journal-macro.js's Journal-triggered runs) — this whole mechanism is
// opt-in.
//
// `onWledDevicesChange` (optional) — called with the updated device list
// whenever a missing alias resolves below, so a caller keeping its own live
// copy (dashboard.js's module state, read by the WLED widget) doesn't go
// stale until a reload. The resolved list is always persisted durably
// regardless; this callback is purely an optional in-memory-copy update.
export async function runMacro(macro, { dataManager, groupContext, status, wledDevices = [], ensureWidget, onWledDevicesChange } = {}) {
  const actions = Array.isArray(macro?.actions) ? macro.actions : [];
  // Mutated in place as aliases get resolved below, so every remaining
  // action in this same run (and the "already asked about this one" guard
  // just below) sees the newly-aliased device immediately.
  let devices = Array.isArray(wledDevices) ? wledDevices : [];
  // One prompt per distinct alias per run, even if several actions
  // reference the same still-unresolved alias — not a full up-front scan,
  // so a macro with only one unresolvable alias among several other fine
  // actions still runs everything else instead of blocking on it.
  const askedAliases = new Set();
  for (const action of actions) {
    const handler = ACTION_HANDLERS[action?.type];
    if (!handler) {
      status?.show?.(`"${macro?.name || "Macro"}": unknown action type "${action?.type}".`, {
        type: "error",
        timeout: 3000,
      });
      continue;
    }
    // Checked here, right before dispatch, so ANY caller of runMacro (Board
    // widget cards, a Journal page's inline macro chip, anywhere else) gets
    // the same "alias it right now" popup for free.
    if (action?.type === "wled") {
      const alias = String(action?.target || "").trim();
      const key = alias.toLowerCase();
      if (alias && !askedAliases.has(key) && !resolveWledDeviceByAlias(devices, alias)) {
        askedAliases.add(key);
        const updated = await promptForWledAlias({ dataManager, status, alias, devices });
        if (updated) {
          devices = updated;
          onWledDevicesChange?.(devices);
        }
        // Cancelled, or nothing to pick from — devices stays as-is, and the
        // handler call below fails with its own normal error, caught by the
        // same try/catch every other action failure goes through.
      }
    }
    let widgetInstance = null;
    if (typeof ensureWidget === "function") {
      try {
        // Awaited — Clock/Calendar's "create" action needs to await a
        // Setting picker before adding a Calendar widget; every other
        // action type's resolution stays synchronous, and awaiting a plain
        // (non-Promise) value is a no-op.
        widgetInstance = await ensureWidget(action);
      } catch (error) {
        // Best-effort — the action itself still runs standalone below.
      }
    }
    try {
      await handler(action, { dataManager, groupContext, status, wledDevices: devices, widgetInstance });
      // One toast per successful step — no caller of this module shows an
      // overall "Ran ..." summary, so a multi-step macro (lights + music +
      // a handout) would otherwise give no confirmation of which effects
      // actually fired.
      status?.show?.(`✓ ${describeMacroAction(action)}`, { type: "success", timeout: 1800 });
    } catch (error) {
      // One bad step (an unreachable WLED device, an unresolved alias, a
      // missing clip) doesn't abort the rest of the macro — a GM firing a
      // multi-effect macro mid-scene needs the sound and handout to still
      // fire even if one light is unplugged.
      status?.show?.(`✗ ${describeMacroAction(action)}: ${error?.message || error}`, {
        type: "error",
        timeout: 4000,
      });
    }
  }
}
