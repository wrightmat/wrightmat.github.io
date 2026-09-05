// The "vitals" half of the Dashboard's Character widget — mounted by
// character-summary.js underneath its own name/character-picker card, for
// whichever of the viewer's own characters is currently selected. Always
// the viewer's own character, so unlike Card/Map there's no read-only mode.
//
// Shows whatever fields the character's System marks as combat-bound
// (resource/value/tags/modifier — the same Role vocabulary combat-tracker.js
// and Workbench's character view key off, bindings.js's findRoleBoundField),
// writing back through the same setAtDottedPath path combat-tracker.js's
// writeThroughToCharacter uses, so this widget, Workbench, and the Combat
// Tracker read/write one real value instead of three drifting copies. The
// Conditions field reuses combat-tracker.js's own tag-badge/input UI
// verbatim. Initiative is a one-way roll-and-push, exactly like Workbench's
// pushInitiativeToActiveEncounter — not persistent character state, so
// rolling it here just updates whichever encounter is currently
// spotlighted to this character's group.
//
// A full arbitrary-template sheet (every component a System/Template
// define, not just combat-bound ones) is out of scope — that engine lives
// in Workbench (workbench-character-view.js) as a whole-page controller
// with nothing factored out for reuse; duplicating it here would be a
// second, weaker implementation of the same thing.
import { findRoleBoundField, findBindingByRole } from "../bindings.js";
import { resolveDottedPath, setAtDottedPath } from "../dotted-path.js";
import { deriveConditionsVocabulary, renderTagBadges, renderTagDatalist, buildTagInputRow } from "./tag-editor.js";
import { connectLiveStream } from "../live.js";
import { rollExpression, resolveActiveDice, extractSystemDice } from "./dice-roll.js";
import { preloadDiceOverlay } from "./dice-overlay.js";
import { resolveGroupContext } from "./group-context.js";
import { resolveActiveSpotlightId } from "../spotlight.js";
import { el } from "../dom.js";
import { disposeTooltips, refreshTooltips } from "../tooltips.js";

const POLL_INTERVAL_MS = 30000;
const TAG_DATALIST_ID = "undercroft-character-sheet-tag-suggestions";
const NOTES_PREFIX = "undercroft.characterSheet.notes.";

function icon(name) {
  const span = el("span", "iconify");
  span.dataset.icon = name;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function numberInput(value, onCommit) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-control form-control-sm";
  input.style.width = "4.5rem";
  input.value = typeof value === "number" ? value : "";
  input.addEventListener("change", () => {
    const next = Number(input.value);
    if (Number.isNaN(next)) return;
    onCommit(next);
  });
  return input;
}

function loadNotes(characterId) {
  try {
    return localStorage.getItem(`${NOTES_PREFIX}${characterId}`) || "";
  } catch (error) {
    return "";
  }
}

function saveNotes(characterId, value) {
  try {
    localStorage.setItem(`${NOTES_PREFIX}${characterId}`, value);
  } catch (error) {
    // Local storage unavailable (private browsing, quota) — notes just won't persist past this session.
  }
}

export function initCharacterVitals(container, { dataManager, status, characterId, groupId = "", shareToken = "" } = {}) {
  if (!container || !dataManager || !characterId) {
    return { destroy() {} };
  }

  // The Initiative roller lives on this widget — warm up the 3D overlay
  // (and the user's chosen theme) now instead of on the first roll click.
  preloadDiceOverlay(dataManager);

  let destroyed = false;
  let character = null;
  let combatBindings = null;
  let conditionsVocabulary = null;
  let tempHpFallback; // only used when the System has no tempPath binding — ephemeral, not persisted
  let lastInitiativeRoll = null;
  // The active campaign Group's own System (if any) wins over this
  // character's own Assigned Systems for Initiative's dice. Empty until
  // loadActiveDice resolves — an empty array is exactly "no named dice."
  let activeDice = [];

  // Every field writes through its own fetch-modify-save round trip (see
  // persistBinding below) — two edits fired in quick succession could
  // otherwise race, with whichever save completes last silently
  // overwriting the other. Chaining every call through this one promise
  // serializes them so a field's fetch always sees the prior save applied.
  let pendingSave = Promise.resolve();

  // Ephemeral UI-only state for the Add Tag row's visibility toggle —
  // whether the NEXT condition added should be suppressed from map marker
  // badges. Kept consistent with combat-tracker.js's equivalent flag, even
  // though this widget's full-rebuild-every-render approach wouldn't strictly need it.
  let pendingConditionHidden = false;

  let liveStream = null;
  let pollTimer = 0;

  function renderError(message) {
    disposeTooltips(container);
    container.innerHTML = "";
    container.appendChild(el("p", "text-danger small mb-0", message));
  }

  async function loadSystemContext(systemId) {
    if (!systemId) return;
    try {
      // preferLocal: false — a Loom edit to the System's role bindings/conditions vocabulary must be visible immediately.
      const result = await dataManager.get("system", systemId, { preferLocal: false });
      const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
      const field = findRoleBoundField(fields);
      combatBindings = field && Array.isArray(field.values) ? field.values : null;
      conditionsVocabulary = deriveConditionsVocabulary(fields, combatBindings);
    } catch (error) {
      combatBindings = null;
      conditionsVocabulary = null;
    }
  }

  // Read-modify-write against a *fresh* fetch (preferLocal: false), not the
  // in-memory `character` — the sheet could have just changed elsewhere
  // (Workbench, the Combat Tracker). Queued through `pendingSave`.
  function persistBinding(recordField, value) {
    if (!recordField) return Promise.resolve();
    pendingSave = pendingSave.then(() => doPersistBinding(recordField, value));
    return pendingSave;
  }

  async function doPersistBinding(recordField, value) {
    try {
      const result = await dataManager.get("character", characterId, { preferLocal: false });
      const fresh = result.payload || {};
      setAtDottedPath(fresh, recordField, value);
      await dataManager.save("character", characterId, fresh);
      character = fresh;
    } catch (error) {
      status?.show(error.message || "Unable to save that change.", { type: "error" });
    } finally {
      if (!destroyed) render();
    }
  }

  // Same shape as doPersistBinding, but sets TWO things in one round trip:
  // the tags-binding's list, and hiddenTags — a fixed-key, suite-level
  // field (not a System binding) tracking which tags are hidden from map
  // marker badges (filtered in map-viewer.js's resolveMarkerConditionIcons).
  // Combined into one save so a hide-on-add can't race a separate write and land only half-applied.
  function persistTagsAndHiddenTags(recordField, list, hiddenList) {
    pendingSave = pendingSave.then(() => doPersistTagsAndHiddenTags(recordField, list, hiddenList));
    return pendingSave;
  }

  async function doPersistTagsAndHiddenTags(recordField, list, hiddenList) {
    try {
      const result = await dataManager.get("character", characterId, { preferLocal: false });
      const fresh = result.payload || {};
      setAtDottedPath(fresh, recordField, list);
      fresh.hiddenTags = hiddenList;
      await dataManager.save("character", characterId, fresh);
      character = fresh;
    } catch (error) {
      status?.show(error.message || "Unable to save that change.", { type: "error" });
    } finally {
      if (!destroyed) render();
    }
  }

  function addCondition(value) {
    const tagsEntry = findBindingByRole(combatBindings, "tags");
    if (!tagsEntry?.recordField) return;
    const current = resolveDottedPath(character, tagsEntry.recordField);
    const list = Array.isArray(current) ? current.slice() : [];
    if (list.includes(value)) return;
    list.push(value);
    const hiddenList = Array.isArray(character.hiddenTags) ? character.hiddenTags.slice() : [];
    if (pendingConditionHidden) hiddenList.push(value);
    pendingConditionHidden = false;
    void persistTagsAndHiddenTags(tagsEntry.recordField, list, hiddenList);
  }

  function removeCondition(value) {
    const tagsEntry = findBindingByRole(combatBindings, "tags");
    if (!tagsEntry?.recordField) return;
    const current = resolveDottedPath(character, tagsEntry.recordField);
    const list = (Array.isArray(current) ? current : []).filter((entry) => entry !== value);
    const hiddenList = (Array.isArray(character.hiddenTags) ? character.hiddenTags : []).filter((entry) => entry !== value);
    void persistTagsAndHiddenTags(tagsEntry.recordField, list, hiddenList);
  }

  // One-way roll-and-push, not a synced field — mirrors Workbench's own
  // pushInitiativeToActiveEncounter: finds whichever encounter is currently
  // spotlighted to this character's group and updates the combatant entry
  // there. Initiative isn't persistent character state.
  async function pushInitiativeToActiveEncounter(value) {
    if (!groupId && !shareToken) {
      status?.show("No active campaign to send initiative to.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      const encounterId = await resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind: "encounter" });
      if (!encounterId) {
        status?.show("No encounter is currently active for this campaign.", { type: "info", timeout: 2500 });
        return;
      }
      const result = await dataManager.get("encounter", encounterId, { preferLocal: false });
      const encounter = result.payload;
      const combatant = (encounter.combatants || []).find(
        (entry) => entry.refKind === "character" && entry.refId === characterId
      );
      if (!combatant) {
        status?.show("You're not in the active encounter yet.", { type: "info", timeout: 2500 });
        return;
      }
      combatant.initiative = value;
      const { id: _id, ...body } = encounter;
      await dataManager.save("encounter", encounterId, body);
      status?.show(`Initiative ${value} sent to the encounter.`, { type: "success", timeout: 2000 });
    } catch (error) {
      console.warn("Character sheet: unable to push initiative to the active encounter", error);
      status?.show("Unable to send initiative to the active encounter.", { type: "error" });
    }
  }

  async function rollInitiative(modifierEntry) {
    const modifierValue = modifierEntry?.recordField ? Number(resolveDottedPath(character, modifierEntry.recordField)) || 0 : 0;
    const sides = Number(String(modifierEntry?.die || "d20").replace(/^d/i, "")) || 20;
    const expression = modifierValue ? `1d${sides} + ${modifierValue}` : `1d${sides}`;
    const rolled = await rollExpression(expression, {
      status,
      label: modifierEntry?.name || "Initiative",
      dataManager,
      dice: activeDice,
    });
    if (!rolled) return;
    lastInitiativeRoll = rolled;
    render();
    await pushInitiativeToActiveEncounter(rolled.total);
  }

  function render() {
    if (destroyed) return;
    disposeTooltips(container);
    container.innerHTML = "";
    const wrap = el("div", "d-flex flex-column gap-2");

    const resource = findBindingByRole(combatBindings, "resource");
    const value = findBindingByRole(combatBindings, "value");
    const tags = findBindingByRole(combatBindings, "tags");
    const modifier = findBindingByRole(combatBindings, "modifier");

    if (!resource && !value && !tags && !modifier) {
      wrap.appendChild(
        el(
          "p",
          "text-body-secondary small mb-0",
          "This character's System has no HP/AC/Initiative/Conditions fields set up to show here."
        )
      );
    }

    if (resource) {
      const row = el("div", "d-flex align-items-center gap-2 flex-wrap");
      row.appendChild(icon("tabler:heart"));
      row.appendChild(el("span", "small text-body-secondary", resource.name || "HP"));
      const current = resource.recordField ? resolveDottedPath(character, resource.recordField) : undefined;
      row.appendChild(
        numberInput(typeof current === "number" ? current : undefined, (next) => persistBinding(resource.recordField, next))
      );
      if (resource.maxPath) {
        row.appendChild(el("span", "text-body-secondary", "/"));
        const max = resolveDottedPath(character, resource.maxPath);
        row.appendChild(
          numberInput(typeof max === "number" ? max : undefined, (next) => persistBinding(resource.maxPath, next))
        );
      } else if (typeof resource.max === "number") {
        // A literal ceiling (e.g. Daggerheart's Hope: max 6) is fixed System data — shown as plain text, not editable.
        row.appendChild(el("span", "text-body-secondary", "/"));
        row.appendChild(el("span", "small", String(resource.max)));
      }
      row.appendChild(el("span", "small text-body-secondary ms-2", "Temp"));
      const tempCurrent = resource.tempPath ? resolveDottedPath(character, resource.tempPath) : tempHpFallback;
      row.appendChild(
        numberInput(typeof tempCurrent === "number" ? tempCurrent : undefined, (next) => {
          if (resource.tempPath) {
            void persistBinding(resource.tempPath, next);
          } else {
            tempHpFallback = next;
            render();
          }
        })
      );
      wrap.appendChild(row);
    }

    if (value?.recordField) {
      const row = el("div", "d-flex align-items-center gap-2");
      row.appendChild(icon("tabler:shield"));
      row.appendChild(el("span", "small text-body-secondary", value.name || "AC"));
      const current = resolveDottedPath(character, value.recordField);
      row.appendChild(
        numberInput(typeof current === "number" ? current : undefined, (next) => persistBinding(value.recordField, next))
      );
      wrap.appendChild(row);
    }

    if (modifier) {
      const modifierValue = modifier.recordField ? Number(resolveDottedPath(character, modifier.recordField)) || 0 : 0;
      const row = el("div", "d-flex align-items-center gap-2 flex-wrap");
      row.appendChild(icon("tabler:dice-5"));
      row.appendChild(el("span", "small text-body-secondary", modifier.name || "Initiative"));
      // Shows the modifier right on the button so it's never ambiguous — e.g. "Roll (+3)".
      const rollButton = el(
        "button",
        "btn btn-outline-secondary btn-sm",
        `Roll (${modifierValue >= 0 ? "+" : ""}${modifierValue})`
      );
      rollButton.type = "button";
      rollButton.addEventListener("click", () => void rollInitiative(modifier));
      row.appendChild(rollButton);
      if (lastInitiativeRoll) {
        row.appendChild(
          el("span", "text-body-secondary small", `${lastInitiativeRoll.expression} → ${lastInitiativeRoll.total}`)
        );
      }
      wrap.appendChild(row);
    }

    if (tags?.recordField) {
      const current = resolveDottedPath(character, tags.recordField);
      const list = Array.isArray(current) ? current : [];
      const section = el("div", "d-flex flex-column gap-1");
      const labelRow = el("div", "d-flex align-items-center gap-1");
      labelRow.appendChild(icon("tabler:tag"));
      labelRow.appendChild(el("span", "small text-body-secondary", tags.name || "Conditions"));
      section.appendChild(labelRow);
      section.appendChild(
        renderTagBadges(list, conditionsVocabulary, {
          removable: true,
          onRemove: removeCondition,
          isHidden: (value) => (character.hiddenTags || []).includes(value),
        })
      );
      section.appendChild(
        buildTagInputRow(TAG_DATALIST_ID, {
          placeholder: "Add a condition…",
          onAdd: addCondition,
          hidden: pendingConditionHidden,
          onToggleHidden: () => {
            pendingConditionHidden = !pendingConditionHidden;
            render();
          },
        }).row
      );
      wrap.appendChild(section);
      renderTagDatalist(TAG_DATALIST_ID, conditionsVocabulary);
    }

    const notesSection = el("div", "d-flex flex-column gap-1 mt-1");
    notesSection.appendChild(el("span", "small text-body-secondary", "Notes (just for you — not saved to the server)"));
    const textarea = document.createElement("textarea");
    textarea.className = "form-control form-control-sm";
    textarea.rows = 3;
    textarea.value = loadNotes(characterId);
    textarea.addEventListener("input", () => saveNotes(characterId, textarea.value));
    notesSection.appendChild(textarea);
    wrap.appendChild(notesSection);

    container.appendChild(wrap);
    refreshTooltips(container);
  }

  async function load() {
    let result;
    try {
      result = await dataManager.get("character", characterId, { shareToken, preferLocal: false });
    } catch (error) {
      if (!destroyed) renderError("Unable to load this character.");
      return;
    }
    if (destroyed) return;
    character = result.payload || {};
    // Assigned Systems (systemIds) replaces the old singular `system` field
    // — this widget only needs one System, so the first entry wins.
    // `character.system` stays a fallback for a not-yet-resaved record.
    const systemId = Array.isArray(character.systemIds) ? character.systemIds[0] : character.system;
    await loadSystemContext(systemId);
    if (destroyed) return;
    await loadActiveDice();
    if (destroyed) return;
    render();
  }

  // Resolves which System's dice (if any) govern this character's
  // Initiative roll — the active campaign Group's System first, then this
  // character's Assigned Systems. A System's Rolls/Moves and any Tier-3
  // symbol dice are NOT surfaced here — that's the Dashboard's Dice Roller widget's job.
  async function loadActiveDice() {
    const groupContext = await resolveGroupContext(dataManager, { shareToken }).catch(() => null);
    const systemDefinition = await resolveActiveDice({ dataManager, groupContext, character }).catch(() => null);
    activeDice = extractSystemDice(systemDefinition);
  }

  void load();
  pollTimer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
  liveStream = connectLiveStream({ dataManager, groupId, kinds: ["character"], shareToken });
  liveStream.subscribe("character", () => void load());

  return {
    refresh: load,
    destroy() {
      destroyed = true;
      if (pollTimer) window.clearInterval(pollTimer);
      liveStream?.close();
      disposeTooltips(container);
      container.innerHTML = "";
    },
  };
}

// --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
// Standalone — no mounted widget instance required. Same fetch → resolve
// combat bindings → mutate → save shape as above, against a character id
// passed in per call rather than this widget's closure state.

export const CHARACTER_MACRO_ACTIONS = {
  adjustVital: { label: "Adjust HP/AC", params: ["field", "value", "delta"] },
  addCondition: { label: "Add condition", params: ["condition"] },
  removeCondition: { label: "Remove condition", params: ["condition"] },
};

async function loadMacroCombatBindings(dataManager, character) {
  const systemId = Array.isArray(character?.systemIds) ? character.systemIds[0] : character?.system;
  if (!systemId) return null;
  try {
    // preferLocal: false — same reasoning as loadSystemContext above.
    const result = await dataManager.get("system", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const field = findRoleBoundField(fields);
    return field && Array.isArray(field.values) ? field.values : null;
  } catch (error) {
    return null;
  }
}

export async function runCharacterMacroAction(action, { dataManager } = {}) {
  const characterId = action?.target;
  if (!characterId) {
    throw new Error("No character id given.");
  }
  // preferLocal: false — a read-modify-write round trip against whatever the character record actually is right now.
  const result = await dataManager.get("character", characterId, { preferLocal: false });
  const character = result?.payload;
  if (!character) {
    throw new Error(`Character "${characterId}" not found.`);
  }
  const combatBindings = await loadMacroCombatBindings(dataManager, character);
  const params = action?.params || {};
  const actionName = action?.action;

  if (actionName === "adjustVital") {
    const resource = findBindingByRole(combatBindings, "resource");
    const value = findBindingByRole(combatBindings, "value");
    const fieldBindings = {
      hp: resource?.recordField,
      maxHp: resource?.maxPath,
      tempHp: resource?.tempPath,
      ac: value?.recordField,
    };
    const recordField = fieldBindings[params.field];
    if (!recordField) {
      throw new Error(`This character's System has no "${params.field}" combat binding.`);
    }
    let next;
    if (params.delta !== undefined) {
      const current = Number(resolveDottedPath(character, recordField)) || 0;
      next = current + Number(params.delta);
    } else {
      next = Number(params.value);
    }
    setAtDottedPath(character, recordField, next);
  } else if (actionName === "addCondition" || actionName === "removeCondition") {
    const tags = findBindingByRole(combatBindings, "tags");
    if (!tags?.recordField) {
      throw new Error("This character's System has no conditions combat binding.");
    }
    const conditionValue = String(params.condition || "").trim();
    if (!conditionValue) {
      throw new Error("No condition given.");
    }
    const current = resolveDottedPath(character, tags.recordField);
    const list = Array.isArray(current) ? current.slice() : [];
    const index = list.indexOf(conditionValue);
    if (actionName === "addCondition") {
      if (index === -1) list.push(conditionValue);
    } else if (index !== -1) {
      list.splice(index, 1);
    }
    setAtDottedPath(character, tags.recordField, list);
  } else {
    throw new Error(`Unknown Character macro action "${actionName}".`);
  }

  await dataManager.save("character", characterId, character);
}
