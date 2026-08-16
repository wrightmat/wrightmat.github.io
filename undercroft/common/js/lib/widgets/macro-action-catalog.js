// The canonical "what does this action type/action pair mean to a human"
// registry for the Macro system — every widget type that exports its own
// *_MACRO_ACTIONS constant is reused verbatim; Handout/Map/Browser/Game Log
// have no widget file of their own to pull one from (macro-runner.js
// handles those inline, no live widget instance involved), so their entries
// are hand-written here to match macro-runner.js's own action/param names
// exactly. Both loom/js/app.js's Macro editor (Type/Action pickers, per-
// field labels) and macro-runner.js's per-step toasts read from this ONE
// place, so a label can't drift between "what you authored" and "what ran."
import { WLED_MACRO_ACTIONS } from "./wled.js";
import { HA_MACRO_ACTIONS } from "./home-assistant.js";
import { SOUNDBOARD_MACRO_ACTIONS } from "./soundboard.js";
import { COMBAT_MACRO_ACTIONS } from "./combat-tracker.js";
import { CHARACTER_MACRO_ACTIONS } from "./character-sheet.js";
import { DICEROLLER_MACRO_ACTIONS } from "./dice-roller.js";
import { CLOCK_MACRO_ACTIONS } from "./clocks.js";
import { CALENDAR_MACRO_ACTIONS } from "./calendar.js";

export const MACRO_ACTION_CATALOG = {
  wled: { label: "WLED", actions: WLED_MACRO_ACTIONS },
  homeAssistant: { label: "Home Assistant", actions: HA_MACRO_ACTIONS },
  soundboard: { label: "Soundboard", actions: SOUNDBOARD_MACRO_ACTIONS },
  handout: {
    label: "Handout",
    actions: {
      show: { label: "Show to table", params: ["contentRef"] },
      hide: { label: "Hide from table", params: ["contentRef"] },
    },
  },
  map: {
    label: "Map",
    actions: {
      show: { label: "Show to table", params: ["contentRef"] },
      hide: { label: "Hide from table", params: ["contentRef"] },
    },
  },
  browser: {
    label: "Browser",
    actions: {
      show: { label: "Show to table", params: ["url"] },
      hide: { label: "Hide from table" },
    },
  },
  gamelog: {
    label: "Game Log",
    actions: { post: { label: "Post a message", params: ["message"] } },
  },
  diceroller: { label: "Dice Roller", actions: DICEROLLER_MACRO_ACTIONS },
  combat: { label: "Combat Tracker", actions: COMBAT_MACRO_ACTIONS },
  character: { label: "Character", actions: CHARACTER_MACRO_ACTIONS },
  clock: { label: "Clock", actions: CLOCK_MACRO_ACTIONS },
  calendar: { label: "Calendar", actions: CALENDAR_MACRO_ACTIONS },
};

// "WLED: Apply preset" / "Soundboard: Play a clip" — used for the per-step
// toast (macro-runner.js) and anywhere else a single action needs a short,
// human description rather than its raw {type, action} shape.
export function describeMacroAction(action) {
  const typeDef = MACRO_ACTION_CATALOG[action?.type];
  const actionDef = typeDef?.actions?.[action?.action];
  const typeLabel = typeDef?.label || action?.type || "Unknown";
  const actionLabel = actionDef?.label || action?.action || "action";
  return `${typeLabel}: ${actionLabel}`;
}
