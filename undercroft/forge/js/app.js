import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls, escapeHtml } from "../../common/js/lib/auth-ui.js";
import { expandPane } from "../../common/js/lib/panes.js";
import {
  createJsonDataPanel,
  createToolbarButtonGroup,
  createIconButton,
  createCollapsibleSection,
  createEmptyStateCard,
  createCompactField,
} from "../../common/js/lib/ui-components.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { initToolSettings } from "../../common/js/lib/tool-settings.js";
import {
  loadForgeTables,
  listSettingsForSystem,
  listLocationsForSetting,
  loadLocation,
  loadSpeciesProfilesForLocation,
  getSpeciesOptions,
  getArchetypeOptions,
  getAttitudeLabel,
  loadAlignmentFaces,
  loadAbilityFieldDefs,
  listArrayFieldOptions,
  loadArchetypeTable,
  GENDER_FACES,
  AGE_FACES,
  RELATIONSHIP_STATUS_FACES,
  ORIENTATION_FACES,
  ATTITUDE_LABELS,
} from "./lib/tables.js";
import { generateNpc, rerollAttribute } from "./lib/generator.js";
import { createNpcRecord, toPressExportShape } from "./lib/npc-schema.js";
import { generateCharacterNote } from "./lib/llm-note.js";
import { buildLocationPressTemplate } from "./lib/press-export.js";
import { createDirtyGate } from "../../common/js/lib/dirty-gate.js";
import { abilityModifier } from "../../common/js/lib/dnd-rules.js";
import { confirmDelete } from "../../common/js/lib/ownership.js";

// Built and mounted before any of the querySelector("[data-*-npc]") lines
// below, so every existing selector/disabled-state call site elsewhere in
// this file keeps working unchanged.
createToolbarButtonGroup([
  { action: "generate", icon: "tabler:dice-5", label: "Generate NPC", primary: true, attrs: { "data-generate-npc": true } },
  { action: "save", label: "Save", disabled: true, attrs: { "data-save-npc": true } },
  { action: "export", label: "Export JSON", disabled: true, attrs: { "data-export-npc": true } },
  { action: "delete", label: "Delete", disabled: true, attrs: { "data-delete-npc": true } },
]).forEach((button) => document.querySelector("[data-npc-toolbar-mount]")?.appendChild(button));
document.querySelector("[data-export-location-template-mount]")?.appendChild(
  createIconButton({
    icon: "tabler:printer",
    label: "Export Press Template",
    kind: "toolbar",
    className: "flex-shrink-0",
    attrs: { "data-export-location-template": true },
  })
);
document.querySelector("[data-npc-empty-state]")?.appendChild(
  createEmptyStateCard({
    icon: "tabler:dice-5",
    message: "No NPC generated yet. Choose a Location and click Generate NPC.",
  })
);

// Named data-field-mount (not data-inspector-mount) — this file's own
// [data-inspector-mount] selector below is a single bare marker for the
// Component Properties collapsible wrapper; a keyed attribute of the same
// name would collide with it (attribute selectors match on presence, not
// value, so the bare querySelector could pick up one of these instead).
// replaceWith, not appendChild — see press/js/app.js's mountInspectorField
// for why: an appended-into wrapper stays an empty-but-in-flow flex item
// even while its field is conditionally hidden, silently spending a full
// gap-3 on both sides of it. Any class the static mount div itself carried
// is merged onto the built field first so removing the wrapper doesn't
// lose that layout.
function mountField(key, element) {
  const mount = document.querySelector(`[data-field-mount="${key}"]`);
  if (!mount) return;
  if (mount.className) element.classList.add(...mount.classList);
  mount.replaceWith(element);
}
mountField(
  "system-select",
  createCompactField({
    type: "select", id: "forgeSystemSelect", label: "System", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-system-select", helpTopic: "forge.generate",
  })
);
mountField("setting-select", createCompactField({ type: "select", id: "forgeSettingSelect", label: "Setting", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-setting-select" }));
mountField("location-select", createCompactField({ type: "select", id: "forgeLocationSelect", label: "Location", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-location-select" }));
mountField(
  "species-override",
  createCompactField({
    type: "select", id: "forgeSpeciesOverride", label: "Species", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-species-override", helpTopic: "forge.overrides",
  })
);
mountField("archetype-override", createCompactField({ type: "select", id: "forgeArchetypeOverride", label: "Archetype", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-archetype-override" }));
mountField("alignment-override", createCompactField({ type: "select", id: "forgeAlignmentOverride", label: "Alignment", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-alignment-override" }));
mountField("gender-override", createCompactField({ type: "select", id: "forgeGenderOverride", label: "Gender", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-gender-override" }));
mountField("location-name", createCompactField({ type: "text", id: "forgeLocationName", label: "Name", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control", dataAttr: "data-location-name", readonly: true }));
mountField("location-system", createCompactField({ type: "text", id: "forgeLocationSystem", label: "System", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control", dataAttr: "data-location-system", readonly: true }));
mountField("location-setting", createCompactField({ type: "text", id: "forgeLocationSetting", label: "Setting", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control", dataAttr: "data-location-setting", readonly: true }));
mountField("species-label", createCompactField({ type: "text", id: "forgeSpeciesLabel", label: "Label", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control", dataAttr: "data-species-label", readonly: true }));
mountField(
  "species-name-mode",
  createCompactField({
    type: "select", id: "forgeSpeciesNameMode", label: "Name Mode", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-species-name-mode", helpTopic: "forge.nameMode", disabled: true,
    options: [
      { value: "blend", label: "Blended" },
      { value: "synonym", label: "Synonyms" },
    ],
  })
);
mountField(
  "species-last-name-form",
  createCompactField({
    type: "select", id: "forgeSpeciesLastNameForm", label: "Last Name Form", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-species-last-name-form", disabled: true,
    options: [
      { value: "none", label: "None" },
      { value: "family", label: "Family" },
      { value: "clan", label: "Clan" },
      { value: "patronymic", label: "Patronymic" },
    ],
  })
);
mountField(
  "species-first-names",
  createCompactField({
    type: "textarea", label: "First Names", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control form-control-sm font-monospace",
    dataAttr: "data-species-first-names", helpTopic: "forge.speciesProfileEditor", rows: 8, readonly: true,
  })
);
mountField(
  "species-last-names",
  createCompactField({
    type: "textarea", label: "Last Names", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control form-control-sm font-monospace",
    dataAttr: "data-species-last-names", rows: 8, readonly: true,
  })
);

const systemSelect = document.querySelector("[data-system-select]");
const settingSelect = document.querySelector("[data-setting-select]");
const locationSelect = document.querySelector("[data-location-select]");
const speciesOverrideSelect = document.querySelector("[data-species-override]");
const archetypeOverrideSelect = document.querySelector("[data-archetype-override]");
const alignmentOverrideSelect = document.querySelector("[data-alignment-override]");
const genderOverrideSelect = document.querySelector("[data-gender-override]");
const generateButton = document.querySelector("[data-generate-npc]");

const npcEmptyState = document.querySelector("[data-npc-empty-state]");
const npcDisplay = document.querySelector("[data-npc-display]");
const identityFields = document.querySelector("[data-identity-fields]");
const fourDFields = document.querySelector("[data-fourd-fields]");
const statsFields = document.querySelector("[data-stats-fields]");
// The whole Stats card (Identity/4D/Note each have their own sibling
// card too) — hidden entirely rather than shown with an explanatory
// message when there's nothing to display, see renderStats below.
const statsCard = statsFields?.closest(".card") || null;
const generateNoteButton = document.querySelector("[data-generate-note]");
const noteText = document.querySelector("[data-note-text]");

const saveButton = document.querySelector("[data-save-npc]");
const exportButton = document.querySelector("[data-export-npc]");
const deleteButton = document.querySelector("[data-delete-npc]");
const jsonDataPanel = createJsonDataPanel({
  label: "JSON Data",
  getData: () => (currentRecord ? toPressExportShape(currentRecord) : {}),
});

// Adopts the existing static `[data-inspector-panel]` markup (its own
// content stays hand-authored HTML — only the header+chevron wrapper is
// JS-built) as this section's content; createCollapsibleSection's own
// internal bindCollapsibleToggle replaces the old standalone one below.
const inspectorSection = createCollapsibleSection({
  label: "Component Properties",
  helpTopic: "forge.inspector",
  collapsed: false,
  content: document.querySelector("[data-inspector-panel]"),
});
document.querySelector("[data-inspector-mount]")?.appendChild(inspectorSection.section);
const inspectorPanel = document.querySelector("[data-inspector-panel]");
const inspectorEmpty = document.querySelector("[data-inspector-empty]");
const inspectorLocation = document.querySelector("[data-inspector-location]");
const inspectorSpecies = document.querySelector("[data-inspector-species]");
const inspectorRoll = document.querySelector("[data-inspector-roll]");
const inspectorRollTitle = document.querySelector("[data-inspector-roll-title]");
const inspectorRollCurrent = document.querySelector("[data-inspector-roll-current]");
const inspectorRollJson = document.querySelector("[data-inspector-roll-json]");

const exportLocationTemplateButton = document.querySelector("[data-export-location-template]");
const locationNameInput = document.querySelector("[data-location-name]");
const locationSystemInput = document.querySelector("[data-location-system]");
const locationSettingInput = document.querySelector("[data-location-setting]");
const speciesWeightRows = document.querySelector("[data-species-weight-rows]");
const speciesWeightTotal = document.querySelector("[data-species-weight-total]");
const mixingCoefficientInput = document.querySelector("[data-mixing-coefficient]");
const mixingCoefficientValue = document.querySelector("[data-mixing-coefficient-value]");
const archetypeOverrideRows = document.querySelector("[data-archetype-override-rows]");

const speciesLabelInput = document.querySelector("[data-species-label]");
const speciesNameModeSelect = document.querySelector("[data-species-name-mode]");
const speciesLastNameFormSelect = document.querySelector("[data-species-last-name-form]");
const speciesFirstNamesTextarea = document.querySelector("[data-species-first-names]");
const speciesLastNamesTextarea = document.querySelector("[data-species-last-names]");
const speciesLastNamesGroup = document.querySelector("[data-species-last-names-group]");

let status = null;
let tables = null;
let currentLocation = null;
let currentRecord = null;
// Gates Save (dirty relative to the last save) and Delete (only a record
// that's actually been saved, not just generated/rerolled locally, can be
// deleted) — see common/js/lib/dirty-gate.js. currentRecord is kept live
// (every edit/reroll patches it directly, unlike Crucible's separate input
// fields), so the snapshot is just its own export shape.
const dirtyGate = createDirtyGate({ buildSnapshot: () => (currentRecord ? toPressExportShape(currentRecord) : null) });
let selectedFieldKey = null;
let dataManager = null;

const IDENTITY_FIELD_DEFS = [
  { key: "name", label: "Name" },
  { key: "species", label: "Species" },
  { key: "archetype", label: "Archetype" },
  { key: "alignment", label: "Alignment" },
  { key: "gender", label: "Gender" },
  { key: "age", label: "Age" },
  { key: "relationship", label: "Relationship" },
  { key: "attitude", label: "Attitude" },
  { key: "location", label: "Location" },
];

const FOURD_FIELD_DEFS = [
  { key: "description", label: "Description" },
  { key: "demeanor", label: "Demeanor" },
  { key: "drive", label: "Drive" },
  { key: "direction", label: "Direction" },
];

// Both read from the active System's own "alignments"/"abilities" fields
// (loadAlignmentFaces/loadAbilityFieldDefs in lib/tables.js) rather than a
// second hardcoded copy — refreshed by refreshSystemVocabulary() whenever
// the System select changes, so switching Systems immediately reflects that
// System's own vocabulary instead of always showing D&D 5e's.
let ABILITY_FIELD_DEFS = [];
let ABILITY_KEYS = new Set();

// Every top-level array field the active System defines — refreshed
// alongside everything else in refreshSystemVocabulary, used to populate
// the Settings modal's Archetype field picker below.
let arrayFieldOptions = [];

// Every key (besides `name`) present on any entry of the currently-resolved
// Archetype table — refreshed alongside arrayFieldOptions, used to populate
// the Settings modal's Stats picker (which of those keys should actually be
// generated/shown as Stats). Empty for a System whose archetype entries
// carry nothing but a name (Blades in the Dark) — so the Stats picker has
// nothing to offer, exactly matching "Stats is not a concept this System
// has."
let archetypeStatKeyOptions = [];

// Which array field on the active System supplies the Archetype roll table
// (name *and* Stats both live on the same entries — see loadArchetypeTable
// in lib/tables.js) — same "per-tool preference, not System data" pattern
// Crucible uses for its own Combat Scaling field/Creature Type field
// settings (crucible/js/app.js), mirrored here: one merged per-System
// record (dataManager.getLocal/saveLocal replaces the whole record for a
// given (bucket, id), so writing one setting straight through would
// silently wipe the other one's already-saved value), removed entirely
// once both preferences are back to their unset state.
const FORGE_SETTINGS_BUCKET = "forge-settings";

function getForgeSystemSettings(systemId) {
  if (!dataManager || !systemId) return {};
  return dataManager.getLocal(FORGE_SETTINGS_BUCKET, systemId) || {};
}

function setForgeSystemSetting(systemId, key, value) {
  if (!dataManager || !systemId) return;
  const next = { ...getForgeSystemSettings(systemId), [key]: value };
  // An empty statsKeys carries no information (see getStatsKeysPreference
  // below — it's treated the same as never having set it), so it doesn't
  // keep this record alive on its own.
  if (!next.archetypeField && !(next.statsKeys && next.statsKeys.length)) {
    dataManager.removeLocal(FORGE_SETTINGS_BUCKET, systemId);
  } else {
    dataManager.saveLocal(FORGE_SETTINGS_BUCKET, systemId, next);
  }
}

function getArchetypeFieldPreference(systemId) {
  return getForgeSystemSettings(systemId).archetypeField || "";
}

function setArchetypeFieldPreference(systemId, fieldKey) {
  setForgeSystemSetting(systemId, "archetypeField", fieldKey || "");
}

// An empty selection is treated exactly like "never configured" — both
// default to every key the active System's archetype entries happen to
// carry (so D&D shows all 6 abilities + AC + HP with zero configuration).
// There's no way to deliberately mean "show zero Stats for a System that
// has them" here on purpose — and there shouldn't be: the Stats picker is
// a native <select multiple>, where a single plain click (no ctrl/cmd)
// deselects every other option, so "nothing checked" is far more likely to
// be an accidental slip than a real decision. Treating it as "not
// configured" instead of "permanently disabled" is what actually matches
// the Settings modal's own behavior elsewhere (Archetype field's "None" is
// a real, deliberate choice from a single-select dropdown — a fundamentally
// safer gesture than emptying a multiselect).
function getStatsKeysPreference(systemId) {
  const stored = getForgeSystemSettings(systemId).statsKeys;
  return Array.isArray(stored) && stored.length ? stored : null;
}

function setStatsKeysPreference(systemId, keys) {
  setForgeSystemSetting(systemId, "statsKeys", Array.isArray(keys) ? keys : []);
}

// Every array field the active System defines, for the Archetype field
// picker — "None" is a real, valid choice (a System with no archetype
// table authored yet).
function archetypeFieldOptions() {
  return [{ value: "", label: "None" }, ...arrayFieldOptions.map((field) => ({ value: field.key, label: field.label || field.key }))];
}

// The conventional field-name fallback loadArchetypeTable applies on its
// own when given no explicit preference — duplicated here only so the
// Settings modal can show what's actually in effect (e.g. "NPC Types")
// instead of misleadingly showing "None" while generation quietly uses
// that field anyway.
const CONVENTIONAL_ARCHETYPE_FIELD = "npcTypes";

// Display-only: the value the Settings modal should show as "currently in
// effect" — the explicit stored choice if there is one, else the
// conventional default key IF the active System actually defines a field
// with that name, else genuinely "None". Kept separate from
// getArchetypeFieldPreference (used for the real loadArchetypeTable call in
// refreshSystemVocabulary), which stays a plain "raw preference or ''" —
// the loader already applies this same conventional default itself when
// given '', so resolving it again here is purely about what the dropdown
// displays, not a second source of truth for generation.
function resolveEffectiveArchetypeField(rawValue) {
  if (rawValue) return rawValue;
  return arrayFieldOptions.some((field) => field.key === CONVENTIONAL_ARCHETYPE_FIELD) ? CONVENTIONAL_ARCHETYPE_FIELD : "";
}

// Every key (besides `name`) present on any archetype entry, nice-labeled —
// reuses the exact same labeling renderStats uses (a System's own ability
// short names where they match, else Title Case), so the Settings modal's
// checklist and the generated Stats card always agree on what a key is
// called.
function statsKeyOptionsFrom(statsByName) {
  const abilityDefByKey = new Map(ABILITY_FIELD_DEFS.map((def) => [def.key, def]));
  const keys = new Set();
  Object.values(statsByName || {}).forEach((entry) => {
    Object.keys(entry).forEach((key) => {
      if (key !== "name") keys.add(key);
    });
  });
  return Array.from(keys).map((key) => ({
    value: key,
    label: abilityDefByKey.get(key)?.label || titleCaseKey(key),
  }));
}

// Which of an archetype's own keys actually become the generated NPC's
// Stats — a real saved subset if one exists, else every key available (see
// getStatsKeysPreference above; an empty saved selection counts as "none
// exists" there, not as a request for zero keys). Returns a name-keyed map
// matching getStatsForArchetype's own expected shape, filtered down to just
// the resolved keys — empty entirely only when the System's own archetype
// entries have no extra keys at all, which is exactly how a Stats-less
// System (Blades in the Dark) ends up contributing nothing to a generated
// NPC's `stats`.
function resolveArchetypeStats(statsByName, systemId) {
  const explicitKeys = getStatsKeysPreference(systemId);
  const availableKeys = archetypeStatKeyOptions.map((option) => option.value);
  const keys = explicitKeys !== null ? explicitKeys : availableKeys;
  const result = {};
  if (!keys.length) return result;
  Object.entries(statsByName || {}).forEach(([name, entry]) => {
    const filtered = {};
    keys.forEach((key) => {
      if (entry[key] !== undefined) filtered[key] = entry[key];
    });
    if (Object.keys(filtered).length) result[name] = filtered;
  });
  return result;
}

// Called once at init (after the default System is selected) and again on
// every System select change — keeps the alignment override dropdown, the
// ability-score card labels/keys, and the Archetype table (Stats included)
// in sync with whichever System is currently active.
async function refreshSystemVocabulary(systemId) {
  const archetypeField = getArchetypeFieldPreference(systemId);
  const [alignmentFaces, abilityFieldDefs, fieldOptions, archetypeTable] = await Promise.all([
    loadAlignmentFaces(dataManager, systemId),
    loadAbilityFieldDefs(dataManager, systemId),
    listArrayFieldOptions(dataManager, systemId),
    loadArchetypeTable(dataManager, systemId, archetypeField || undefined),
  ]);
  arrayFieldOptions = fieldOptions;
  ABILITY_FIELD_DEFS = abilityFieldDefs;
  ABILITY_KEYS = new Set(abilityFieldDefs.map((entry) => entry.key));
  archetypeStatKeyOptions = statsKeyOptionsFrom(archetypeTable.statsByName);
  if (tables) {
    tables.alignmentFaces = alignmentFaces;
    tables.archetype = { entries: archetypeTable.entries };
    tables.stats = resolveArchetypeStats(archetypeTable.statsByName, systemId);
  }
  populateSelectOptions(alignmentOverrideSelect, alignmentFaces);
}

function formatIdentityValue(key, value) {
  if (key === "attitude") {
    return `${getAttitudeLabel(value)} (${value})`;
  }
  return String(value ?? "");
}

function abilityModifierText(score) {
  const modifier = abilityModifier(score);
  return `(${modifier >= 0 ? "+" : ""}${modifier})`;
}

function buildFieldCard({
  key,
  label,
  value,
  rerollable,
  colClass = "col-12 col-md-6 col-lg-4",
  compact = false,
  editable = false,
  selectable = false,
  suffix = "",
}) {
  const col = document.createElement("div");
  col.className = colClass;
  const box = document.createElement("div");
  if (compact) {
    box.className = "d-flex flex-column align-items-center justify-content-center text-center border rounded-3 p-1 h-100";
    const labelLine = `<div class="text-uppercase text-body-secondary" style="font-size: 0.65rem">${escapeHtml(label)}</div>`;
    if (editable) {
      // Same .forge-inline-edit blend-in idiom as the Name field, just sized
      // for a compact box — the raw score/number is what's editable, kept
      // separate from the (+N) ability modifier (recomputed live, not stored).
      box.innerHTML = `${labelLine}<div class="d-flex align-items-center justify-content-center gap-1"><input type="text" class="forge-inline-edit small fw-semibold text-center" style="width: 2.5rem" value="${escapeHtml(value)}" data-editable-field="${key}" aria-label="Edit ${label}" />${
        suffix ? `<span class="small text-body-secondary" data-editable-suffix="${key}">${escapeHtml(suffix)}</span>` : ""
      }</div>`;
    } else {
      box.innerHTML = `${labelLine}<div class="fw-semibold small">${escapeHtml(value)}</div>`;
    }
    col.appendChild(box);
    return col;
  }
  box.className = "d-flex align-items-center justify-content-between gap-2 border rounded-3 p-2 h-100";
  if (selectable) {
    box.dataset.selectField = key;
  }
  const text = document.createElement("div");
  text.className = "flex-grow-1";
  const labelLine = document.createElement("div");
  labelLine.className = "small text-uppercase text-body-secondary";
  labelLine.textContent = label;
  text.appendChild(labelLine);
  if (editable) {
    // Looks like the plain value line (see .forge-inline-edit) until
    // hovered/focused — an <input> the whole time, just styled to blend in.
    const input = document.createElement("input");
    input.type = "text";
    input.className = "forge-inline-edit";
    input.value = value;
    input.dataset.editableField = key;
    input.setAttribute("aria-label", `Edit ${label}`);
    text.appendChild(input);
  } else {
    const valueLine = document.createElement("div");
    valueLine.className = "fw-semibold";
    valueLine.textContent = value;
    text.appendChild(valueLine);
  }
  box.appendChild(text);
  if (rerollable) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary btn-sm flex-shrink-0";
    button.dataset.rerollAttribute = key;
    button.setAttribute("aria-label", `Reroll ${label}`);
    button.innerHTML = `<span class="iconify" data-icon="tabler:refresh" aria-hidden="true"></span>`;
    box.appendChild(button);
  }
  col.appendChild(box);
  return col;
}

// "strength" -> "Strength", "attackModifier" -> "Attack Modifier" — used for
// any stats key with no matching ABILITY_FIELD_DEFS short name, so a
// System's own archetypeStats keys (whatever shape it happens to use) still
// get a readable label with zero per-System UI code.
function titleCaseKey(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

// Schema-driven: renders whatever keys are actually present on the resolved
// stats object instead of assuming D&D's fixed "6 abilities + AC + HP"
// shape (see getStatsForArchetype in lib/tables.js) — a different System's
// archetypeStats field can carry an entirely different set of keys (or
// none at all). `hitPoints` is the one key still special-cased, as a
// max/current pair — worth keeping the nice split display, only rendered
// if present. A key matching one of the active System's own ability
// fields (ABILITY_FIELD_DEFS) gets that field's short label and a live
// (+N) modifier suffix; every other key gets a plain title-cased label. A
// string-valued entry (e.g. a Daggerheart Adversary's Feature text) renders
// full-width instead of jammed into the compact number-box grid.
//
// No stats at all — whether this System has no Stats bound (Blades in the
// Dark) or this particular archetype has no block within a System that
// otherwise does (D&D's Wildcard/setting-specific rolls) — hides the whole
// card rather than showing it with an explanatory message; there's nothing
// useful to look at either way.
function renderStats(stats) {
  statsFields.innerHTML = "";
  if (!stats) {
    statsCard?.classList.add("d-none");
    return;
  }
  statsCard?.classList.remove("d-none");
  const abilityDefByKey = new Map(ABILITY_FIELD_DEFS.map((def) => [def.key, def]));
  const compactEntries = [];
  const wideEntries = [];
  Object.entries(stats).forEach(([key, value]) => {
    if (key === "hitPoints") return;
    (typeof value === "string" && value.length > 12 ? wideEntries : compactEntries).push([key, value]);
  });
  compactEntries.forEach(([key, value]) => {
    const abilityDef = abilityDefByKey.get(key);
    statsFields.appendChild(
      buildFieldCard({
        key,
        label: abilityDef?.label || titleCaseKey(key),
        value: value ?? "",
        suffix: abilityDef ? abilityModifierText(value) : "",
        rerollable: false,
        colClass: "col-4 col-md-2",
        compact: true,
        editable: true,
      })
    );
  });
  if (stats.hitPoints) {
    statsFields.appendChild(
      buildFieldCard({
        key: "currentHp",
        label: "Current HP",
        value: stats.hitPoints?.current ?? "",
        rerollable: false,
        colClass: "col-4",
        compact: true,
        editable: true,
      })
    );
    statsFields.appendChild(
      buildFieldCard({
        key: "maxHp",
        label: "Max HP",
        value: stats.hitPoints?.max ?? "",
        rerollable: false,
        colClass: "col-4",
        compact: true,
        editable: true,
      })
    );
  }
  wideEntries.forEach(([key, value]) => {
    statsFields.appendChild(
      buildFieldCard({
        key,
        label: titleCaseKey(key),
        value: value ?? "",
        rerollable: false,
        colClass: "col-12",
        compact: false,
        editable: true,
      })
    );
  });
}

// Save (dirty-gated) and Delete (saved-gated) button state, shared by
// renderNpc's full re-render and the in-place field-edit handlers below
// (which patch currentRecord directly and skip a full renderNpc to avoid
// jumping the edited input's cursor).
function refreshActionButtons() {
  saveButton.disabled = !currentRecord || !dirtyGate.isDirty();
  exportButton.disabled = !currentRecord;
  deleteButton.disabled = !currentRecord || !dirtyGate.hasSaved();
}

function renderNpc(record) {
  currentRecord = record;
  npcEmptyState.classList.toggle("d-none", Boolean(record));
  npcDisplay.classList.toggle("d-none", !record);
  refreshActionButtons();

  if (!record) {
    jsonDataPanel.render();
    return;
  }

  identityFields.innerHTML = "";
  IDENTITY_FIELD_DEFS.forEach(({ key, label }) => {
    identityFields.appendChild(
      buildFieldCard({
        key,
        label,
        value:
          key === "location"
            ? currentLocation?.name || ""
            : formatIdentityValue(key, key === "name" ? record.name : record.identity[key]),
        rerollable: key !== "location",
        editable: key === "name",
        selectable: true,
      })
    );
  });

  fourDFields.innerHTML = "";
  FOURD_FIELD_DEFS.forEach(({ key, label }) => {
    fourDFields.appendChild(
      buildFieldCard({ key, label, value: record.fourD[key], rerollable: true, selectable: true })
    );
  });

  renderStats(record.stats);

  noteText.value = record.note || "";
  jsonDataPanel.render();

  // Regenerating/rerolling replaces the Identity/4D boxes wholesale, so the
  // selected box's highlight (and, for a roll-driven inspector view, its
  // JSON) needs to be reapplied against the fresh markup/data.
  updateFieldSelectionUI();
  if (selectedFieldKey) {
    updateInspector();
  }
}

// --- Manual overrides ----------------------------------------------------
// Blank ("Random") is the default in every select; a non-blank value is
// passed straight through to generateNpc, which uses it instead of rolling
// that one attribute. Species/Archetype options depend on the selected
// Location and get repopulated whenever it changes; Alignment/Gender are
// fixed tables, populated once. Options may be plain strings (value===label)
// or {value, label} pairs (Species, where the value is a speciesId but the
// label shown is the profile's own display name).
function populateSelectOptions(selectEl, options, { blankLabel = "Random" } = {}) {
  const previous = selectEl.value;
  selectEl.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = blankLabel;
  selectEl.appendChild(blank);
  options.forEach((entry) => {
    const value = typeof entry === "string" ? entry : entry.value;
    const label = typeof entry === "string" ? entry : entry.label;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    selectEl.appendChild(option);
  });
  const values = options.map((entry) => (typeof entry === "string" ? entry : entry.value));
  if (values.includes(previous)) {
    selectEl.value = previous;
  }
}

// Alignment is intentionally NOT populated here — it's System-dependent (see
// refreshSystemVocabulary), so it's populated once a System is known rather
// than from a fixed constant at startup.
function populateFixedOverrides() {
  populateSelectOptions(genderOverrideSelect, [...new Set(GENDER_FACES)]);
}

function populateLocationOverrides(location) {
  const speciesOptions = getSpeciesOptions(location, tables.speciesProfiles).map((entry) => ({
    value: entry.speciesId,
    label: entry.label,
  }));
  populateSelectOptions(speciesOverrideSelect, speciesOptions);
  const archetypeNames = getArchetypeOptions(tables.archetype, location).map((entry) => entry.name);
  populateSelectOptions(archetypeOverrideSelect, archetypeNames);
}

function readOverrides() {
  return {
    species: speciesOverrideSelect.value,
    archetype: archetypeOverrideSelect.value,
    alignment: alignmentOverrideSelect.value,
    gender: genderOverrideSelect.value,
  };
}

// --- System > Setting > Location cascading selects --------------------------
// Locations are authored in Sanctum, Species in Loom — these three selects
// just pick which already-saved Location to generate from, mirroring the
// same System/Setting/Location tree Sanctum's own picker presents.

async function listAllSystems() {
  if (!dataManager) return [];
  const merged = new Map();
  // Workbench ships sys.dnd5e as a "builtin" (a static JSON file, not a row
  // in the systems DB table), so it never shows up in dataManager.list()
  // below on its own — without this, the picker only shows Systems a
  // creator has actually saved, hiding the one every seed Location/Setting
  // already points at.
  try {
    const builtins = await dataManager.listBuiltins();
    (builtins?.systems || []).forEach((entry) => {
      if (entry?.available) merged.set(entry.id, { id: entry.id, title: entry.title || entry.id });
    });
  } catch (error) {
    // builtins are a nice-to-have, not required
  }
  try {
    const listing = await dataManager.list("systems");
    const remoteEntries = dataManager.collectListEntries(listing.remote, ["items", "owned", "shared", "public"]);
    remoteEntries.forEach((entry) => merged.set(entry.id, { id: entry.id, title: entry.title || entry.id }));
    (listing.local || []).forEach((entry) => {
      if (!merged.has(entry.id)) {
        merged.set(entry.id, { id: entry.id, title: entry.payload?.title || entry.id });
      }
    });
  } catch (error) {
    // fall through with whatever builtins we already have
  }
  return Array.from(merged.values()).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}

async function populateSystemSelect() {
  const systems = await listAllSystems();
  const previous = systemSelect.value;
  systemSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = systems.length ? "Select a system…" : "No systems yet";
  systemSelect.appendChild(blank);
  systems.forEach((system) => {
    const option = document.createElement("option");
    option.value = system.id;
    option.textContent = system.title;
    systemSelect.appendChild(option);
  });
  if (systems.some((system) => system.id === previous)) systemSelect.value = previous;
  return systems;
}

async function populateSettingSelect(systemId) {
  const settings = await listSettingsForSystem(dataManager, systemId);
  settingSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = settings.length ? "Select a setting…" : "No settings yet";
  settingSelect.appendChild(blank);
  settings.forEach((setting) => {
    const option = document.createElement("option");
    option.value = setting.id;
    option.textContent = setting.name;
    settingSelect.appendChild(option);
  });
  return settings;
}

async function populateLocationSelectOptions(settingId) {
  const locations = await listLocationsForSetting(dataManager, settingId);
  locationSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = locations.length ? "Select a location…" : "No locations yet";
  locationSelect.appendChild(blank);
  locations.forEach((location) => {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.name;
    locationSelect.appendChild(option);
  });
  return locations;
}

async function selectLocation(id) {
  currentLocation = await loadLocation(id);
  locationSelect.value = id;
  tables.speciesProfiles = await loadSpeciesProfilesForLocation(currentLocation);
  populateLocationOverrides(currentLocation);

  // The Location Identity box (and the inspector, if it's the one currently
  // selected) reflect whatever's chosen up here in the left pane, not just
  // whatever was true at the last renderNpc.
  const locationValue = identityFields.querySelector('[data-select-field="location"] .fw-semibold');
  if (locationValue) locationValue.textContent = currentLocation?.name || "";
  if (selectedFieldKey === "location") {
    updateInspector();
  }
}

// --- Location inspector (read-only — edited in Sanctum) --------------------

function renderSpeciesWeightRow(entry = { entityId: "", weight: 0 }) {
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  const options = Array.from(tables?.speciesProfiles?.values() || []);
  const optionsHtml = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.id)}"${option.id === entry.entityId ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
    .join("");
  row.innerHTML = `
    <select class="form-select" data-species-weight-select disabled>
      <option value="">Select a species…</option>
      ${optionsHtml}
    </select>
    <input class="form-control" type="number" min="0" step="1" style="max-width: 6rem" value="${Number(entry.weight) || 0}" data-species-weight-value readonly />
  `;
  speciesWeightRows.appendChild(row);
  updateSpeciesWeightTotal();
}

function updateSpeciesWeightTotal() {
  const total = Array.from(speciesWeightRows.querySelectorAll("[data-species-weight-value]")).reduce(
    (sum, input) => sum + (Number(input.value) || 0),
    0
  );
  speciesWeightTotal.textContent = `Total: ${total}`;
}

function renderArchetypeOverrideRows(overrides = {}) {
  archetypeOverrideRows.innerHTML = "";
  const overridable = (tables.archetype.entries || []).filter((entry) => entry.overridable);
  overridable.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "d-flex align-items-center gap-2";
    row.dataset.archetypeOverrideRoll = String(entry.roll);
    const value = overrides[String(entry.roll)]?.name || "";
    row.innerHTML = `
      <label class="form-label mb-0 flex-shrink-0" style="width: 5rem">Roll ${entry.roll}</label>
      <input class="form-control" type="text" placeholder="Setting-specific archetype name" value="${escapeHtml(value)}" data-archetype-override-value readonly />
    `;
    archetypeOverrideRows.appendChild(row);
  });
}

function populateLocationForm(location) {
  locationNameInput.value = location?.name || "";
  locationSystemInput.value = systemSelect.selectedOptions[0]?.textContent || "";
  locationSettingInput.value = settingSelect.selectedOptions[0]?.textContent || "";
  mixingCoefficientInput.value = location?.mixingCoefficient ?? 0.2;
  mixingCoefficientValue.textContent = Number(mixingCoefficientInput.value).toFixed(2);
  speciesWeightRows.innerHTML = "";
  (location?.speciesWeights || []).forEach((entry) => renderSpeciesWeightRow(entry));
  renderArchetypeOverrideRows(location?.archetypeOverrides || {});
  updateSpeciesWeightTotal();
}

// --- Species inspector (read-only — edited in Loom) -------------------------

function toggleSpeciesLastNamesVisibility() {
  speciesLastNamesGroup.hidden = speciesLastNameFormSelect.value === "none";
}

// Pool entries may be a bare string or {name, weight} (see
// name-generator.js's normalizeNamePool) — this read-only summary only
// needs the name itself, one per line.
function namePoolLines(pool) {
  return (pool || []).map((entry) => (typeof entry === "string" ? entry : entry?.name || "")).filter(Boolean).join("\n");
}

function populateSpeciesForm(profile) {
  speciesLabelInput.value = profile?.label || "";
  speciesNameModeSelect.value = profile?.nameMode === "synonym" ? "synonym" : "blend";
  speciesLastNameFormSelect.value = profile?.lastNameForm || "none";
  speciesFirstNamesTextarea.value = namePoolLines(profile?.firstNames);
  speciesLastNamesTextarea.value = namePoolLines(profile?.lastNames);
  toggleSpeciesLastNamesVisibility();
}

// --- Identity/4D box selection / inspector ------------------------------
// Standard Undercroft select-then-inspect convention: clicking an Identity
// or 4D box selects it and surfaces its details in the right-pane inspector.
// Location and Species get their existing full editors; everything else
// gets a read-only dump of the JSON data driving it, alongside this NPC's
// current rolled value.

function selectField(key) {
  selectedFieldKey = selectedFieldKey === key ? null : key;
  updateFieldSelectionUI();
  updateInspector();
}

function updateFieldSelectionUI() {
  [identityFields, fourDFields].forEach((container) => {
    container.querySelectorAll("[data-select-field]").forEach((box) => {
      box.classList.toggle("forge-field-selected", box.dataset.selectField === selectedFieldKey);
    });
  });
}

// Setting `.hidden` alone silently does nothing here: these panels carry
// Bootstrap's `.d-flex` (declared `!important`), which beats the `[hidden]`
// UA rule regardless of the property. Toggling `.d-none` (also `!important`,
// and generated after `.d-flex` in Bootstrap's own stylesheet, so it wins
// the tie) is what actually hides them — same convention as setCollapsibleState.
function setInspectorSectionVisible(section, visible) {
  section.hidden = !visible;
  section.classList.toggle("d-none", !visible);
}

function updateInspector() {
  setInspectorSectionVisible(inspectorEmpty, !selectedFieldKey);
  setInspectorSectionVisible(inspectorLocation, selectedFieldKey === "location");
  setInspectorSectionVisible(inspectorSpecies, selectedFieldKey === "species");
  setInspectorSectionVisible(
    inspectorRoll,
    Boolean(selectedFieldKey) && selectedFieldKey !== "location" && selectedFieldKey !== "species"
  );

  if (!selectedFieldKey) return;

  // Both queried live, not as module-top-level consts — the toggle button
  // lives in the header and the pane <aside> itself is now also JS-built
  // (initAppShell()'s buildPaneShell), both later than this module's own
  // top-level code runs; an eager query for either here would have
  // captured null permanently.
  const rightPane = document.querySelector('[data-pane="right"]');
  const rightPaneToggle = document.querySelector('[data-pane-toggle="right"]');
  if (rightPane && rightPaneToggle) {
    expandPane(rightPane, rightPaneToggle);
  }

  if (selectedFieldKey === "location") {
    populateLocationForm(currentLocation);
    return;
  }

  if (selectedFieldKey === "species") {
    const speciesId = currentRecord?.rolls?.species?.speciesId || null;
    const profile = speciesId ? tables.speciesProfiles?.get(speciesId) || null : null;
    populateSpeciesForm(profile);
    return;
  }

  const def = IDENTITY_FIELD_DEFS.find((entry) => entry.key === selectedFieldKey) || FOURD_FIELD_DEFS.find((entry) => entry.key === selectedFieldKey);
  inspectorRollTitle.textContent = def?.label || selectedFieldKey;
  inspectorRollCurrent.textContent = currentRecord ? `This NPC's roll: ${getFieldCurrentValue(selectedFieldKey)}` : "";
  inspectorRollJson.textContent = JSON.stringify(getFieldTableData(selectedFieldKey), null, 2);
}

// This NPC's own resolved value for a given field — Identity attributes
// live under `record.identity`, 4D attributes under `record.fourD`.
function getFieldCurrentValue(key) {
  if (FOURD_FIELD_DEFS.some((entry) => entry.key === key)) {
    return currentRecord?.fourD?.[key] ?? "";
  }
  return formatIdentityValue(key, currentRecord?.identity?.[key]);
}

// The full JSON backing each field — a static table for most (the same data
// getArchetypeOptions/rollAlignment/rollFourD/etc. already draw from), or,
// for Name, the Species Name Profile(s) exemplar-interpolation actually used
// for this specific NPC (there's no fixed table behind Name anymore).
function getFieldTableData(key) {
  switch (key) {
    case "archetype":
      return getArchetypeOptions(tables.archetype, currentLocation);
    case "alignment":
      return tables?.alignmentFaces || [];
    case "gender":
      return GENDER_FACES;
    case "age":
      return AGE_FACES;
    case "relationship":
      return { status: RELATIONSHIP_STATUS_FACES, orientation: ORIENTATION_FACES };
    case "attitude":
      return ATTITUDE_LABELS;
    case "name": {
      const nameRoll = currentRecord?.rolls?.name;
      if (!nameRoll) return {};
      return {
        generation: nameRoll,
        primaryProfile: tables.speciesProfiles?.get(nameRoll.primarySpeciesId) || null,
        partnerProfile: nameRoll.partnerSpeciesId ? tables.speciesProfiles?.get(nameRoll.partnerSpeciesId) || null : null,
      };
    }
    case "description":
    case "demeanor":
    case "drive":
    case "direction":
      return tables.fourD?.[key] ?? [];
    default:
      return currentRecord?.rolls?.[key] ?? {};
  }
}

// --- Event wiring ------------------------------------------------------

generateButton.addEventListener("click", () => {
  if (!settingSelect.value) {
    status?.show("Select a Setting first.", { type: "warning", timeout: 2500 });
    return;
  }
  if (!currentLocation) {
    status?.show("Select a Location first.", { type: "warning", timeout: 2500 });
    return;
  }
  if (!tables) return;
  try {
    const overrides = readOverrides();
    const record = createNpcRecord(generateNpc(currentLocation, tables, { overrides }));
    dirtyGate.markDirty();
    renderNpc(record);
  } catch (error) {
    status?.show(`Unable to generate: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

[identityFields, fourDFields].forEach((container) => {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll-attribute]");
    if (!button || !currentRecord || !currentLocation || !tables) return;
    renderNpc(rerollAttribute(currentRecord, tables, currentLocation, button.dataset.rerollAttribute));
  });
});

// Clicking an Identity or 4D box selects it and surfaces its details in the
// inspector — guarded so a click on the reroll button or the Name field's
// inline input (both nested inside the box) doesn't also toggle selection.
[identityFields, fourDFields].forEach((container) => {
  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-reroll-attribute]") || event.target.closest("[data-editable-field]")) return;
    const box = event.target.closest("[data-select-field]");
    if (!box) return;
    selectField(box.dataset.selectField);
  });
});

// Typing directly into an editable field (currently just Name, which lives
// at the record's top level — see undercroft/forge/js/lib/generator.js —
// not nested in `identity` like the rest of the rolled Identity block) keeps
// the record in sync without re-running renderNpc — same reasoning as the
// note textarea below: resetting .value mid-edit would jump the cursor.
identityFields.addEventListener("input", (event) => {
  const input = event.target.closest("[data-editable-field]");
  if (!input || !currentRecord) return;
  const field = input.dataset.editableField;
  currentRecord = field === "name" ? { ...currentRecord, name: input.value } : currentRecord;
  jsonDataPanel.render();
  refreshActionButtons();
});

// Typing directly into a Stats field keeps the record in sync the same way
// — ability scores also live-update their (+N) modifier suffix alongside,
// since that's derived rather than stored. hitPoints stays the one
// special-cased key (a max/current pair); every other key is a flat
// stats[field] write, coerced to a number only if it already held one (so
// a text stat like a Daggerheart Adversary's Feature line doesn't get
// silently zeroed).
statsFields.addEventListener("input", (event) => {
  const input = event.target.closest("[data-editable-field]");
  if (!input || !currentRecord?.stats) return;
  const field = input.dataset.editableField;
  if (field === "currentHp" || field === "maxHp") {
    const numericValue = Number(input.value) || 0;
    const hpKey = field === "currentHp" ? "current" : "max";
    currentRecord = {
      ...currentRecord,
      stats: { ...currentRecord.stats, hitPoints: { ...currentRecord.stats.hitPoints, [hpKey]: numericValue } },
    };
  } else {
    const previousValue = currentRecord.stats[field];
    const nextValue = typeof previousValue === "number" ? Number(input.value) || 0 : input.value;
    currentRecord = { ...currentRecord, stats: { ...currentRecord.stats, [field]: nextValue } };
    if (ABILITY_KEYS.has(field)) {
      const suffixEl = statsFields.querySelector(`[data-editable-suffix="${field}"]`);
      if (suffixEl) suffixEl.textContent = abilityModifierText(nextValue);
    }
  }
  jsonDataPanel.render();
  refreshActionButtons();
});

generateNoteButton.addEventListener("click", async () => {
  if (!currentRecord) return;
  generateNoteButton.disabled = true;
  const originalHtml = generateNoteButton.innerHTML;
  generateNoteButton.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Generating…';
  try {
    const note = await generateCharacterNote(currentRecord);
    currentRecord = { ...currentRecord, note };
    renderNpc(currentRecord);
    status?.show("Note generated.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to generate note: ${error.message}`, { type: "error", timeout: 5000 });
  } finally {
    generateNoteButton.disabled = false;
    generateNoteButton.innerHTML = originalHtml;
  }
});

// Typing directly in the note box (writing one from scratch, or editing
// what Generate Note produced) keeps the record in sync without re-running
// renderNpc — resetting .value mid-edit would jump the cursor.
noteText.addEventListener("input", () => {
  if (!currentRecord) return;
  currentRecord = { ...currentRecord, note: noteText.value };
  jsonDataPanel.render();
  refreshActionButtons();
});

// Same dirty check refreshActionButtons already uses for the Save button —
// Forge had no guard at all against navigating/closing away from unsaved
// edits (unlike Workbench, which already had this).
window.addEventListener("beforeunload", (event) => {
  if (!currentRecord || !dirtyGate.isDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

saveButton.addEventListener("click", async () => {
  if (!currentRecord) return;
  const record = toPressExportShape(currentRecord);
  try {
    // Shared Library, not a Forge-only directory — Press (or any other
    // tool) can read undercroft/common/data/npc/{id}.json directly, the
    // same way it already reads other Library kinds. Default mode ("auto")
    // matters here: Forge has no whole-tool login gate, so an anonymous GM
    // keeps saving locally to their own browser exactly as before, while a
    // signed-in user's NPC becomes a real, owned, shareable record.
    await dataManager.save("npc", currentRecord.id, record);
    dirtyGate.markClean(record);
    refreshActionButtons();
    status?.show("Saved.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

deleteButton.addEventListener("click", async () => {
  if (!currentRecord || !dataManager || !dirtyGate.hasSaved()) return;
  const label = currentRecord.name || currentRecord.id;
  if (!confirmDelete({ label: `"${label}"` })) return;
  try {
    await dataManager.delete("npc", currentRecord.id);
    status?.show("Deleted.", { type: "success", timeout: 1500 });
    dirtyGate.markDirty();
    renderNpc(null);
  } catch (error) {
    status?.show(`Unable to delete: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

exportButton.addEventListener("click", () => {
  if (!currentRecord) return;
  const record = toPressExportShape(currentRecord);
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentRecord.name || currentRecord.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

systemSelect.addEventListener("change", async () => {
  const systemId = systemSelect.value;
  currentLocation = null;
  await Promise.all([refreshSystemVocabulary(systemId), populateSettingSelect(systemId)]);
  await populateLocationSelectOptions("");
});

settingSelect.addEventListener("change", async () => {
  const settingId = settingSelect.value;
  currentLocation = null;
  const locations = await populateLocationSelectOptions(settingId);
  if (locations.length) {
    await selectLocation(locations[0].id);
  }
});

locationSelect.addEventListener("change", () => selectLocation(locationSelect.value));

exportLocationTemplateButton.addEventListener("click", async () => {
  if (!currentLocation) {
    status?.show("Select a location first.", { type: "error", timeout: 3000 });
    return;
  }
  try {
    const templateId = `forge-npc-reference-${currentLocation.id}`;
    const settingName = settingSelect.selectedOptions[0]?.textContent || "";
    const template = await buildLocationPressTemplate(currentLocation, tables, templateId, dataManager, { settingName });
    template.category = "print";
    await dataManager.save("templates", templateId, template);
    status?.show(`Exported Press template ${templateId}.`, { type: "success", timeout: 2500 });
  } catch (error) {
    status?.show(`Unable to export template: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

speciesLastNameFormSelect.addEventListener("change", () => toggleSpeciesLastNamesVisibility());

// --- Init ----------------------------------------------------------------

async function init() {
  const shell = initAppShell({
    namespace: "forge",
    storagePrefix: "undercroft.forge.undo",
    settingsSlotAttr: "data-forge-settings-slot",
  });
  status = shell.status;
  const auth = initAuthControls({
    status,
  });
  dataManager = auth.dataManager;

  // Archetype field picker + Stats key checklist, in a gear-icon Settings
  // modal (upper-left of the header) — same shared module and visual
  // pattern Crucible's own Settings button already uses. Each definition's
  // getValue/setValue defers straight to the per-System
  // dataManager.getLocal/saveLocal helpers above rather than this module's
  // own flat store, since the value is genuinely scoped per-System, not
  // per-tool (see tool-settings.js's own comment on that option).
  initToolSettings({
    toolId: "forge",
    dataManager,
    status,
    title: "Forge Settings",
    definitions: () => {
      const systemId = systemSelect.value;
      return [
        {
          key: "archetypeField",
          type: "select",
          label: "Archetype field",
          options: archetypeFieldOptions(),
          getValue: () => resolveEffectiveArchetypeField(getArchetypeFieldPreference(systemId)),
          setValue: (value) => {
            setArchetypeFieldPreference(systemId, value);
            refreshSystemVocabulary(systemId);
          },
        },
        {
          key: "statsKeys",
          type: "multiselect",
          label: "Stats",
          // Every key the active System's own Archetype entries carry
          // (besides name) — empty for a System with no Stats concept at
          // all (Blades in the Dark), so this picker has nothing to offer
          // instead of a misleading always-populated list.
          options: archetypeStatKeyOptions,
          getValue: () => getStatsKeysPreference(systemId) ?? archetypeStatKeyOptions.map((option) => option.value),
          setValue: (values) => {
            setStatsKeysPreference(systemId, values);
            refreshSystemVocabulary(systemId);
          },
        },
      ];
    },
    // Queried live (not via a captured const) because the header — and this
    // mount point inside it — is built by initAppShell() itself, above.
    mountButton: (button) => document.querySelector("[data-forge-settings-slot]")?.appendChild(button),
  });

  document.querySelector("[data-json-mount]")?.appendChild(jsonDataPanel.section);
  // The static markup only carries `hidden` on the Location/Species/Roll
  // panels, which Bootstrap's `!important` `.d-flex` beats on its own (see
  // setInspectorSectionVisible) — run the real visibility logic once up
  // front so nothing but the empty state shows before anything is selected.
  updateInspector();

  tables = await loadForgeTables();
  populateFixedOverrides();

  const systems = await populateSystemSelect();
  const defaultSystemId = systems.some((system) => system.id === "sys.dnd5e") ? "sys.dnd5e" : systems[0]?.id;
  if (defaultSystemId) {
    systemSelect.value = defaultSystemId;
    await refreshSystemVocabulary(defaultSystemId);
    const settings = await populateSettingSelect(defaultSystemId);
    const defaultSettingId = settings.some((setting) => setting.id === "forgotten-realms")
      ? "forgotten-realms"
      : settings[0]?.id;
    if (defaultSettingId) {
      settingSelect.value = defaultSettingId;
      const locations = await populateLocationSelectOptions(defaultSettingId);
      const defaultLocationId = locations.some((location) => location.id === "sword-coast")
        ? "sword-coast"
        : locations[0]?.id;
      if (defaultLocationId) {
        await selectLocation(defaultLocationId);
      }
    }
  }

  renderNpc(null);
  initHelpSystem({ root: document });
  refreshTooltips(document);
}

init();
