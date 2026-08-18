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
  createFieldBox,
  createModeToggleGroup,
} from "../../common/js/lib/ui-components.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { renderRelationshipEditor } from "../../common/js/lib/relationship-editor.js";
import { buildRelationshipGraph } from "../../common/js/lib/relationship-graph.js";
import { createForceGraph } from "../../common/js/lib/graph-view.js";
import { initToolSettings } from "../../common/js/lib/tool-settings.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import {
  loadForgeTables,
  listSettingsForSystem,
  listLocationsForSetting,
  listNpcsForLocation,
  listNpcsForSetting,
  loadLocation,
  loadSetting,
  loadSpeciesProfilesForLocation,
  getSpeciesOptions,
  getArchetypeOptions,
  getAttitudeLabel,
  loadAlignmentFaces,
  loadAbilityFieldDefs,
  listArrayFieldOptions,
  loadArchetypeTable,
  loadNpcAttitudes,
  GENDER_FACES,
  AGE_FACES,
  RELATIONSHIP_STATUS_FACES,
  ORIENTATION_FACES,
} from "./lib/tables.js";
import { generateNpc, rerollAttribute } from "./lib/generator.js";
import { createNpcRecord, toPressExportShape } from "./lib/npc-schema.js";
import { generateCharacterNote } from "./lib/llm-note.js";
import { buildLocationPressTemplate } from "./lib/press-export.js";
import { createDirtyGate } from "../../common/js/lib/dirty-gate.js";
import { abilityModifier } from "../../common/js/lib/dnd-rules.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
import { createTokenImageField } from "../../common/js/lib/token-picker.js";
import { renderRequiredSelectOptions, renderOptionalSelectOptions } from "../../common/js/lib/generator-kit.js";
import { markRequiredControl } from "../../common/js/lib/dom.js";
import { resolveGroupContext, pickGroupDefaultId } from "../../common/js/lib/widgets/group-context.js";
// Repository's own markdown renderer (dice/task-list/callout/wiki-link
// awareness, degrading gracefully without any of that for a plain note) —
// reused as-is for the Note field's View mode, same as Crucible/Vault/
// Sanctum's own identical Notes preview.
import { renderMarkdown } from "../../repository/js/lib/markdown.js";

// Built and mounted before any of the querySelector("[data-*-npc]") lines
// below, so every existing selector/disabled-state call site elsewhere in
// this file keeps working unchanged.
createToolbarButtonGroup([
  { action: "generate", icon: "tabler:users", label: "Generate NPC", attrs: { "data-generate-npc": true } },
  { action: "save", label: "Save", disabled: true, attrs: { "data-save-npc": true } },
  { action: "duplicate", label: "Duplicate", disabled: true, attrs: { "data-duplicate-npc": true } },
  { action: "delete", label: "Delete", disabled: true, attrs: { "data-delete-npc": true } },
]).forEach((button) => document.querySelector("[data-npc-toolbar-mount]")?.appendChild(button));
// A small visual break, not a functional one — same physical Undo/Redo
// buttons, just their own little two-button group with a gap before it
// (`ms-2` on the mount div), same convention every other tool's toolbar
// now uses.
createToolbarButtonGroup([
  { action: "undo", label: "Undo", attrs: { "data-undo-npc": true } },
  { action: "redo", label: "Redo", attrs: { "data-redo-npc": true } },
]).forEach((button) => document.querySelector("[data-npc-undo-toolbar-mount]")?.appendChild(button));
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
    message: "Nothing selected yet. Pick an existing NPC above, or fill in the fields and click Generate NPC.",
    variant: "inline",
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
mountField("npc-select", createCompactField({ type: "select", id: "forgeNpcSelect", label: "NPC", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-npc-select" }));
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
const npcSelect = document.querySelector("[data-npc-select]");
const generationFields = document.querySelector("[data-generation-fields]");
const speciesOverrideSelect = document.querySelector("[data-species-override]");
const archetypeOverrideSelect = document.querySelector("[data-archetype-override]");
const alignmentOverrideSelect = document.querySelector("[data-alignment-override]");
const genderOverrideSelect = document.querySelector("[data-gender-override]");
const generateButton = document.querySelector("[data-generate-npc]");

const npcEmptyState = document.querySelector("[data-npc-empty-state]");
const npcDisplay = document.querySelector("[data-npc-display]");
const identityFields = document.querySelector("[data-identity-fields]");
// Name renders here instead of inside identityFields' own grid — its own
// row, inline with Image (see renderNpc) — same "Name+Image inline, image
// on the right" layout Crucible/Vault/Sanctum's own Identity sections use.
const nameMount = document.querySelector("[data-name-mount]");
const npcImageMount = document.querySelector('[data-field-mount="npc-image"]');
const fourDFields = document.querySelector("[data-fourd-fields]");
const statsFields = document.querySelector("[data-stats-fields]");
// The whole Stats card (Identity/4D/Note each have their own sibling
// card too) — hidden entirely rather than shown with an explanatory
// message when there's nothing to display, see renderStats below.
const statsCard = statsFields?.closest(".card") || null;
const generateNoteButton = document.querySelector("[data-generate-note]");
const noteText = document.querySelector("[data-note-text]");
const notePreview = document.querySelector("[data-note-preview]");
const noteModeToggle = document.querySelector("[data-note-mode-toggle]");
const noteModeEyeIcon = document.querySelector('[data-note-mode-icon="view"]');
const noteModePencilIcon = document.querySelector('[data-note-mode-icon="edit"]');
const noteModeLabel = document.querySelector("[data-note-mode-label]");

const npcRelationshipsEl = document.querySelector("[data-npc-relationships]");
const modeToggleMountEl = document.querySelector("[data-forge-mode-toggle-mount]");
const relationshipsListMount = document.querySelector("[data-relationships-list-mount]");
const relationshipsGraphWrap = document.querySelector("[data-relationships-graph-wrap]");
const relationshipsGraphContainer = document.querySelector("[data-relationships-graph-container]");
const relationshipsGraphContent = document.querySelector("[data-relationships-graph-content]");
const relationshipsGraphSvg = document.querySelector("[data-relationships-graph-svg]");
const relationshipsGraphEmpty = document.querySelector("[data-relationships-graph-empty]");
const relationshipsGraphControls = document.querySelector("[data-relationships-graph-controls]");
const relationshipsGraphToolbarMount = document.querySelector("[data-relationships-graph-toolbar-mount]");

const saveButton = document.querySelector("[data-save-npc]");
const duplicateButton = document.querySelector("[data-duplicate-npc]");
const deleteButton = document.querySelector("[data-delete-npc]");
const undoButton = document.querySelector("[data-undo-npc]");
const redoButton = document.querySelector("[data-redo-npc]");
const jsonDataPanel = createJsonDataPanel({
  label: "JSON Data",
  getData: () => (currentRecord ? toPressExportShape(currentRecord) : {}),
  onExport: () => handleExportNpc(),
});

const selectionsSection = createCollapsibleSection({
  label: "Selections",
  collapsed: false,
  content: document.querySelector("[data-selections-panel]"),
});
document.querySelector("[data-selections-mount]")?.appendChild(selectionsSection.section);

// Adopts each section's existing static `[data-xxx-panel]` markup (its own
// content stays hand-authored HTML — only the header+chevron wrapper is
// JS-built) as createCollapsibleSection's content — same pattern Sanctum's
// own initCollapsibles/Crucible's own module-top-level block use. Every
// section here is expanded by default (collapsed: false), unlike Crucible's
// own Recipe Fulfillment — Forge has nothing that warrants starting
// collapsed. Note keeps its "Generate Note" sibling button in static HTML
// (a shape createCollapsibleSection would clobber by rebuilding the whole
// header), so only its toggle button is built and mounted.
const inspectorSection = createCollapsibleSection({
  label: "Component Properties",
  helpTopic: "forge.inspector",
  collapsed: false,
  content: document.querySelector("[data-inspector-panel]"),
});
document.querySelector("[data-inspector-mount]")?.appendChild(inspectorSection.section);

document.querySelector("[data-identity-mount]")?.appendChild(
  createCollapsibleSection({
    label: "Identity",
    helpTopic: "forge.identity",
    collapsed: false,
    content: document.querySelector("[data-identity-panel]"),
  }).section
);

document.querySelector("[data-fourd-mount]")?.appendChild(
  createCollapsibleSection({
    label: "4D",
    helpTopic: "forge.fourD",
    collapsed: false,
    content: document.querySelector("[data-fourd-panel]"),
  }).section
);

document.querySelector("[data-stats-mount]")?.appendChild(
  createCollapsibleSection({
    label: "Stats",
    helpTopic: "forge.stats",
    collapsed: false,
    content: document.querySelector("[data-stats-panel]"),
  }).section
);

{
  const noteToggle = createIconButton({
    icon: "tabler:chevron-right",
    className: "collapsible-toggle",
    includeToggleLabel: true,
  });
  noteToggle.setAttribute("aria-expanded", "true");
  document.querySelector("[data-note-toggle-mount]")?.appendChild(noteToggle);
  bindCollapsibleToggle(noteToggle, document.querySelector("[data-note-panel]"), {
    collapsed: false,
    expandLabel: "Expand character note",
    collapseLabel: "Collapse character note",
  });
}
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
let undoStack = null;
let performUndo = null;
let performRedo = null;
let tables = null;
let currentLocation = null;
// The active Setting's own full record (not just its id) — needed for its
// general Species Weights (effectiveSpeciesLocation below), the fallback a
// Location without its own falls back to. Only Location used to be fetched
// in full; Setting was previously tracked purely by settingSelect.value.
let currentSetting = null;
// Every Location belonging to the currently selected Setting — {id, name,
// parentId} pairs (listLocationsForSetting's own shape), refreshed by
// populateLocationSelectOptions. Kept globally (not just on the left-pane
// <select>) so the Identity Location field's own editable select
// (renderNpc's identityFields loop) can source its options without a
// second fetch.
let locationsInSetting = [];
let currentRecord = null;
// Gates Save (dirty relative to the last save) and Delete (only a record
// that's actually been saved, not just generated/rerolled locally, can be
// deleted) — see common/js/lib/dirty-gate.js. currentRecord is kept live
// (every edit/reroll patches it directly, unlike Crucible's separate input
// fields), so the snapshot is just its own export shape.
const dirtyGate = createDirtyGate({ buildSnapshot: () => (currentRecord ? toPressExportShape(currentRecord) : null) });

// Whole-record snapshot undo — same shape/reasoning as Repository's own
// recordHistory/field-commit-debounce pair (repository/js/app.js): snapshot
// currentRecord before a mutation, apply it, push an undo entry only if the
// JSON actually changed. Coarser than field-level diffing, consistent with
// this file's existing "patch currentRecord directly, no diffing" style.
function recordHistory(label, applyChange) {
  if (!currentRecord) {
    applyChange();
    return;
  }
  const before = JSON.stringify(currentRecord);
  applyChange();
  const after = JSON.stringify(currentRecord);
  if (before !== after) undoStack.push({ label, before, after });
}

function applyRecordSnapshot(json) {
  if (!json) return;
  renderNpc(JSON.parse(json));
}

// Debounced commit for live-typed fields (Identity/4D/Stats/Note inputs,
// which patch currentRecord directly on every keystroke without a full
// renderNpc) — one undo entry per burst of typing, not one per keystroke.
// See Repository's own FIELD_COMMIT_DEBOUNCE_MS comment for why the keydown
// flush listener is needed (app-shell's global Ctrl+Z handler would
// otherwise fire before an in-flight debounce window commits).
const FIELD_COMMIT_DEBOUNCE_MS = 600;
let fieldCommitTimer = 0;
let fieldCommitLabel = "";
let fieldEditBaseline = null;

function commitFieldEdit() {
  window.clearTimeout(fieldCommitTimer);
  fieldCommitTimer = 0;
  if (!currentRecord || fieldEditBaseline === null) return;
  const after = JSON.stringify(currentRecord);
  if (after !== fieldEditBaseline) undoStack.push({ label: fieldCommitLabel, before: fieldEditBaseline, after });
  fieldEditBaseline = null;
}

function scheduleFieldCommit(label) {
  if (fieldEditBaseline === null) fieldEditBaseline = JSON.stringify(currentRecord);
  fieldCommitLabel = label;
  window.clearTimeout(fieldCommitTimer);
  fieldCommitTimer = window.setTimeout(commitFieldEdit, FIELD_COMMIT_DEBOUNCE_MS);
}

function flushFieldCommitOnUndoRedo(event) {
  const key = (event.key || "").toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") commitFieldEdit();
}

let selectedFieldKey = null;
// Guards the Location inspector's own async fetch (updateInspector below)
// against a race: if the GM selects a different field (or a different
// Location) before an in-flight fetch resolves, the stale response must not
// overwrite whatever the inspector should show now.
let locationInspectorRequestId = 0;
let dataManager = null;
// Every saved NPC at the currently selected Location (NPC picker options)
// plus its ownership metadata — same role/shape as Crucible's
// monstersInSystem/monsterCatalog, Vault's effectsInSystem/effectCatalog,
// Sanctum's locationsInSetting/locationCatalog. currentNpcId is tracked
// separately from currentRecord for the same reason those tools track their
// own current*Id separately.
let npcsAtLocation = [];
let npcCatalog = new Map();
let currentNpcId = null;

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
  if (!next.archetypeField && !next.attitudeField && !(next.statsKeys && next.statsKeys.length)) {
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

// Which array field on the active System supplies NPC Attitude levels —
// same "per-tool preference, not System data" pattern as Archetype's own
// npcTypes field preference above.
function getAttitudeFieldPreference(systemId) {
  return getForgeSystemSettings(systemId).attitudeField || "";
}

function setAttitudeFieldPreference(systemId, fieldKey) {
  setForgeSystemSetting(systemId, "attitudeField", fieldKey || "");
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

// Every array field the active System defines, for the Archetype/Attitude
// field pickers (same shape Crucible's own fieldPreferenceOptions uses for
// its Combat Scaling/Creature Type field pickers) — "None" is a real,
// deliberate choice (a System with no archetype table/attitude scale
// authored yet).
function fieldPreferenceOptions() {
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

// Same reasoning as CONVENTIONAL_ARCHETYPE_FIELD/resolveEffectiveArchetypeField
// above, for the Attitude field preference.
const CONVENTIONAL_ATTITUDE_FIELD = "npcAttitudes";

function resolveEffectiveAttitudeField(rawValue) {
  if (rawValue) return rawValue;
  return arrayFieldOptions.some((field) => field.key === CONVENTIONAL_ATTITUDE_FIELD) ? CONVENTIONAL_ATTITUDE_FIELD : "";
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
  const attitudeField = getAttitudeFieldPreference(systemId);
  const [alignmentFaces, abilityFieldDefs, fieldOptions, archetypeTable, npcAttitudes] = await Promise.all([
    loadAlignmentFaces(dataManager, systemId),
    loadAbilityFieldDefs(dataManager, systemId),
    listArrayFieldOptions(dataManager, systemId),
    loadArchetypeTable(dataManager, systemId, archetypeField || undefined),
    loadNpcAttitudes(dataManager, systemId, attitudeField || undefined),
  ]);
  arrayFieldOptions = fieldOptions;
  ABILITY_FIELD_DEFS = abilityFieldDefs;
  ABILITY_KEYS = new Set(abilityFieldDefs.map((entry) => entry.key));
  archetypeStatKeyOptions = statsKeyOptionsFrom(archetypeTable.statsByName);
  if (tables) {
    tables.alignmentFaces = alignmentFaces;
    tables.archetype = { entries: archetypeTable.entries };
    tables.stats = resolveArchetypeStats(archetypeTable.statsByName, systemId);
    tables.npcAttitudes = npcAttitudes;
    // Threaded through to getStatsForArchetype (lib/tables.js, via
    // generator.js's own resolveStats) so it can tell an ability score
    // apart from any other kind of stat and bundle it into stats.abilities
    // — the shape Crucible's monsters/Characters both already use.
    tables.abilityKeys = ABILITY_KEYS;
  }
  populateSelectOptions(alignmentOverrideSelect, alignmentFaces);
}

function formatIdentityValue(key, value) {
  if (key === "attitude") {
    return `${getAttitudeLabel(tables?.npcAttitudes, value)} (${value})`;
  }
  return String(value ?? "");
}

// A field's own vocabulary as <select> options ({value, label} pairs), or
// null for a field that's still a free-typed text box (Relationship — a
// combined status+orientation string with no single fixed vocabulary of its
// own). Species/Archetype/Alignment/Age are all label strings stored as-is
// on the record (value === label, same convention every one of these
// already used before becoming selects); Gender's own fixed table has
// weighted duplicate faces (Male x3 for the roll, but only one "Male"
// *choice*), so it's deduped for display; Attitude is the one numeric-valued
// field, sourced from the active System's own npcAttitudes data (see
// loadNpcAttitudes/refreshSystemVocabulary) instead of a hardcoded label
// list. Location is the one id-valued field (record.locationId, not
// record.identity.location — see renderNpc's own identityFields loop) and
// the one field with a real, always-present blank choice: unlike every
// other axis here, "no Location" is a normal, valid state (Location is
// optional), not just a display fallback for a value that doesn't match.
function identitySelectOptions(key) {
  switch (key) {
    case "species":
      return uniqueLabelOptions(getSpeciesOptions(effectiveSpeciesLocation(), tables?.speciesProfiles).map((entry) => entry.label));
    case "archetype":
      return uniqueLabelOptions(getArchetypeOptions(tables?.archetype, currentLocation).map((entry) => entry.name));
    case "alignment":
      return uniqueLabelOptions(tables?.alignmentFaces || []);
    case "gender":
      return uniqueLabelOptions(GENDER_FACES);
    case "age":
      return uniqueLabelOptions(AGE_FACES);
    case "attitude":
      return (tables?.npcAttitudes || []).map((entry) => ({ value: entry.value, label: entry.label }));
    case "location":
      return [
        { value: "", label: "No Location" },
        ...locationsInSetting.map((location) => ({ value: location.id, label: location.name })),
      ];
    default:
      return null;
  }
}

function uniqueLabelOptions(labels) {
  return Array.from(new Set(labels.filter(Boolean))).map((label) => ({ value: label, label }));
}

// A generated NPC's current value for a select-backed Identity field isn't
// always guaranteed to be among that field's "normal" candidate options
// (Species can resolve to "Other" with zero location weights; Archetype can
// resolve to "Unknown"; System vocabulary can change after generation) —
// silently defaulting the <select> to whatever its first option happens to
// be, while the record still holds the real value underneath, would
// misrepresent the record. Appending the current value as its own option
// when missing keeps the select honest.
function ensureOptionIncludesValue(options, value) {
  if (value === "" || value === null || value === undefined || options.some((option) => option.value === value)) {
    return options;
  }
  return [...options, { value, label: String(value) }];
}

function abilityModifierText(score) {
  const modifier = abilityModifier(score);
  return `(${modifier >= 0 ? "+" : ""}${modifier})`;
}

// Forge's own field-box implementation, originally hand-rolled here, is now
// the shared createFieldBox (common/js/lib/ui-components.js) — Crucible's
// Stats/Identity fields and Vault's Identity fields render the exact same
// box today. Kept as a thin local alias so every call site below (Name/
// Identity/4D/Stats) needs no changes.
const buildFieldCard = createFieldBox;

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

// Forge's own generation (getStatsForArchetype, lib/tables.js) always nests
// ability scores under stats.abilities — the same shape Crucible's monsters
// and Characters both already use (see crucible/js/lib/stats.js#deriveStats,
// sys.dnd5e.json's own "abilities" object field) — confirmed the actual
// suite-wide standard, not a Forge-specific choice, after this shape's own
// bug report. A saved NPC with one or more ability scores sitting FLAT on
// `stats` instead (an inconsistency from earlier in this tool's own
// development, since corrected on both existing saved records directly —
// see undercroft/common/data/npc/*.json) would render as a jumble of
// unlabeled ability-score boxes mixed in among armorClass/hitPoints/etc.,
// each missing its own (+N) modifier suffix. This is a pure failsafe, not
// something normal generation/editing relies on — it folds any of the
// active System's own ability keys (ABILITY_KEYS) found sitting flat on
// `stats` back into `stats.abilities` (merging with whatever's already
// nested there, if anything) at load time, so a record in that shape,
// however it got there, still renders correctly.
function normalizeStats(stats) {
  if (!stats) return stats;
  const flatAbilityKeys = Array.from(ABILITY_KEYS).filter((key) => stats[key] !== undefined);
  if (!flatAbilityKeys.length) return stats;
  const abilities = { ...(stats.abilities && typeof stats.abilities === "object" ? stats.abilities : {}) };
  const rest = { ...stats };
  flatAbilityKeys.forEach((key) => {
    abilities[key] = rest[key];
    delete rest[key];
  });
  return { ...rest, abilities };
}

// Schema-driven: renders whatever keys are actually present on the resolved
// stats object instead of assuming D&D's fixed "6 abilities + AC + HP"
// shape (see getStatsForArchetype in lib/tables.js) — a different System's
// archetypeStats field can carry an entirely different set of keys (or
// none at all). `abilities` and `hitPoints` are the two keys still
// special-cased: `abilities` (a nested object — the active System's own
// ability keys, e.g. strength/dexterity/...) renders as one box per
// ability, each with its field's short label and a live (+N) modifier
// suffix, ahead of everything else; `hitPoints` as a max/current pair.
// Every other key gets a plain title-cased label. A string-valued entry
// (e.g. a Daggerheart Adversary's Feature text) renders full-width instead
// of jammed into the compact number-box grid.
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

  // Abilities render first, in the active System's own field order (not
  // raw object insertion order) — stats.abilities is the suite-wide nested
  // shape Crucible's monsters and Characters both already use (see
  // getStatsForArchetype, lib/tables.js), not a Forge-specific flat one.
  // The compound "abilities.<key>" carried in data-editable-field (and its
  // suffix's matching data-editable-suffix) is what tells the write-back
  // listener below to patch the nested object, not a flat stats.<key>.
  if (stats.abilities && typeof stats.abilities === "object") {
    ABILITY_FIELD_DEFS.forEach(({ key, label }) => {
      const value = stats.abilities[key];
      if (value === undefined) return;
      statsFields.appendChild(
        buildFieldCard({
          key: `abilities.${key}`,
          label,
          value: value ?? "",
          suffix: abilityModifierText(value),
          rerollable: false,
          colClass: "col-4 col-md-2",
          compact: true,
          editable: true,
        })
      );
    });
  }

  const compactEntries = [];
  const wideEntries = [];
  Object.entries(stats).forEach(([key, value]) => {
    // hitPoints/abilities get their own dedicated boxes below. `initiative`
    // is a `{bonus, advantage?, disadvantage?}` object now (this suite's
    // one shared initiative shape — see the monster-data-alignment plan),
    // not a flat number — Combat Tracker already reads it generically via
    // the System's own combatBindings, and there's no dedicated box for it
    // here (same "combat-only, no static-editor UI needed" reasoning Temp
    // HP uses), so it's excluded here rather than rendered as a raw object.
    if (key === "hitPoints" || key === "abilities" || key === "initiative") return;
    (typeof value === "string" && value.length > 12 ? wideEntries : compactEntries).push([key, value]);
  });
  compactEntries.forEach(([key, value]) => {
    statsFields.appendChild(
      buildFieldCard({
        key,
        label: titleCaseKey(key),
        value: value ?? "",
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
  duplicateButton.disabled = !currentRecord;
  deleteButton.disabled = !currentRecord || !dirtyGate.hasSaved() || !npcAllowsDelete(currentNpcId);
}

function renderNpc(record) {
  currentRecord = record;
  npcEmptyState.classList.toggle("d-none", Boolean(record));
  npcDisplay.classList.toggle("d-none", !record || mode === "relationships");
  refreshActionButtons();
  renderModeToggle();

  if (!record) {
    jsonDataPanel.render();
    if (mode === "relationships") void refreshRelationshipsSection();
    return;
  }
  // See normalizeStats' own comment — a pure failsafe, folding any stray
  // flat ability keys back into stats.abilities in place, so every render/
  // save/edit from here on sees (and persists) the correct nested shape.
  record.stats = normalizeStats(record.stats);

  // Its own small card rather than an IDENTITY_FIELD_DEFS entry — image
  // isn't reroll-able like the rest of Identity, it's a picked/inherited
  // link (see forge/js/lib/generator.js's `image` field and the Token
  // Library picker, common/js/lib/token-picker.js). Rebuilt on every render
  // like the rest of Identity/4D — safe because createTokenImageField only
  // commits on blur/select, never mid-keystroke, so there's no cursor-jump
  // risk the identity "input" listener below has to dodge.
  if (npcImageMount) {
    npcImageMount.innerHTML = "";
    npcImageMount.appendChild(
      createTokenImageField({
        id: "forgeNpcImage",
        label: "Image",
        // Matches the Name field box it sits inline beside — per explicit
        // feedback that Image looking visually different from every other
        // field box (including Forge's own) was the thing to fix.
        boxed: true,
        value: record.image || "",
        dataManager,
        status,
        onSelect: (url) => {
          currentRecord = { ...currentRecord, image: url };
          dirtyGate.markDirty();
          jsonDataPanel.render();
          refreshActionButtons();
        },
      })
    );
  }

  // Name renders on its own, inline with Image (see nameMount above) —
  // excluded from the grid loop below, which now only covers the other 8
  // identity fields (Species/Archetype/Alignment/Gender/Age/Relationship/
  // Attitude/Location).
  if (nameMount) {
    nameMount.innerHTML = "";
    nameMount.appendChild(
      buildFieldCard({
        key: "name",
        label: "Name",
        value: formatIdentityValue("name", record.name),
        rerollable: true,
        editable: true,
        selectable: true,
        colClass: "flex-grow-1",
      })
    );
  }

  identityFields.innerHTML = "";
  IDENTITY_FIELD_DEFS.filter(({ key }) => key !== "name").forEach(({ key, label }) => {
    // Location lives at record.locationId (a top-level field, not nested
    // under record.identity like every other Identity axis) since it's a
    // real id reference to a Location entity, not a rolled/typed value —
    // same reason its stored value is an id rather than a label, unlike
    // every other field here. Never rerollable (there's no random-Location
    // mechanic), but editable like everything else — picking a different
    // Location (or "No Location") here only changes this record's own
    // reference, the same restrained "no cascading side effects" behavior
    // every other Identity field's edit already has. Relationship stays
    // free text (see identitySelectOptions). Every other field is a select
    // over its own real vocabulary.
    const value = key === "location" ? record.locationId || "" : record.identity[key];
    const options = identitySelectOptions(key);
    identityFields.appendChild(
      buildFieldCard({
        key,
        label,
        value,
        type: options ? "select" : "text",
        options: options ? ensureOptionIncludesValue(options, value) : [],
        rerollable: key !== "location",
        editable: true,
        selectable: true,
      })
    );
  });

  fourDFields.innerHTML = "";
  FOURD_FIELD_DEFS.forEach(({ key, label }) => {
    fourDFields.appendChild(
      buildFieldCard({
        key,
        label,
        value: record.fourD[key],
        type: "select",
        options: ensureOptionIncludesValue(
          (tables?.fourD?.[key] || []).map((entry) => ({ value: entry, label: entry })),
          record.fourD[key]
        ),
        rerollable: true,
        editable: true,
        selectable: true,
      })
    );
  });

  renderStats(record.stats);

  noteText.value = record.note || "";
  if (noteMode === "view") renderNotePreview();
  jsonDataPanel.render();

  // Regenerating/rerolling replaces the Identity/4D boxes wholesale, so the
  // selected box's highlight (and, for a roll-driven inspector view, its
  // JSON) needs to be reapplied against the fresh markup/data.
  updateFieldSelectionUI();
  if (selectedFieldKey) {
    updateInspector();
  }
  if (mode === "relationships") void refreshRelationshipsSection();
}

// --- Relationships ---------------------------------------------------------
//
// Forge's own target-kind whitelist and type-suggestion vocabulary for the
// shared relationship-editor.js/relationship-graph.js modules (see that
// pair's own header comments for the full suite-wide mechanism). No
// "Organization" concept lives here at all — an NPC other NPCs point at
// with "Member of" edges just shows those rows in ITS OWN Relationships
// list too, the reverse direction of the exact same query every NPC runs.
const RELATIONSHIP_TARGET_KINDS = [
  { id: "npc", label: "NPC" },
  { id: "location", label: "Location" },
  { id: "monster", label: "Monster" },
  { id: "character", label: "Character" },
];
const RELATIONSHIP_TYPE_SUGGESTIONS = [
  "Member of",
  "Leads",
  "Allied with",
  "Enemy of",
  "Parent of",
  "Child of",
  "Sibling of",
  "Married to",
  "Mentor of",
  "Rival of",
];

// "npc" (the existing Identity/4D/Stats/Notes card stack) or
// "relationships" (a full-pane List/Graph view over this NPC's own
// relationship edges) — mutually exclusive Modes, switched by the
// suite-wide Mode toggle group (createModeToggleGroup) in the header row
// above the main pane, exactly mirroring Repository's own Page-vs-
// Relationships split. Relationships is no longer a collapsible card
// inside NPC mode — see setMode/renderModeToggle below.
let mode = "npc";
let relationshipsForceGraph = null;

function renderModeToggle() {
  if (!modeToggleMountEl) return;
  // Nothing to relate until an NPC exists — disabled (not hidden) until
  // then, via createButtonCheckGroup's own disabled/tooltip option support
  // (ui-components.js), the same mechanism every other tool's Relationships
  // option now uses too (previously each hand-rolled an identical
  // post-render querySelector('input[value="relationships"]').disabled
  // patch — consolidated onto this one shared mechanism instead).
  createModeToggleGroup({
    container: modeToggleMountEl,
    ariaLabel: "Forge view",
    options: [
      { value: "npc", icon: "tabler:users", label: "NPC" },
      {
        value: "relationships",
        icon: "tabler:affiliate",
        label: "Relationships",
        disabled: !currentRecord,
        tooltip: currentRecord ? undefined : "Select or generate an NPC first",
      },
    ],
    value: mode,
    onChange: (next) => setMode(next),
  });
}

function setMode(nextMode) {
  mode = nextMode;
  const isRelationships = mode === "relationships";
  npcDisplay?.classList.toggle("d-none", isRelationships || !currentRecord);
  npcRelationshipsEl?.classList.toggle("d-none", !isRelationships);
  renderModeToggle();
  if (isRelationships) void refreshRelationshipsSection();
}

function ensureRelationshipsForceGraph() {
  if (relationshipsForceGraph || !relationshipsGraphContainer) return relationshipsForceGraph;
  relationshipsForceGraph = createForceGraph({
    container: relationshipsGraphContainer,
    content: relationshipsGraphContent,
    svg: relationshipsGraphSvg,
    emptyMount: relationshipsGraphEmpty,
    getNodeRadius: (node) => (node.kind === "npc" && node.id === `npc:${currentRecord?.id}` ? 20 : 14),
    getNodeIcon: (node) => relationshipsIconByKind?.[node.kind] || null,
    // The relationship's own type ("Member of," "Leads," ...) as small text
    // over its line — see graph-view.js's own edgeLabelZoomThreshold for why
    // this stays hidden until zoomed in past the default.
    getEdgeLabel: (edge) => edge.type || null,
    classPrefix: "relationship-graph",
    emptyIcon: "tabler:affiliate",
    emptyMessage: "No relationships yet.",
    defaultZoom: 1.4,
  });
  // Same reason Sanctum's own Relationships graph / Repository's own
  // Relationships stop this event from bubbling to `container` —
  // PanZoomController's own setPointerCapture (fired on every pointerdown
  // regardless of target) otherwise hijacks the click these zoom buttons
  // need.
  relationshipsGraphControls?.addEventListener("pointerdown", (event) => event.stopPropagation());
  [
    { icon: "tabler:zoom-out", label: "Zoom out", onClick: () => relationshipsForceGraph.zoomBy(-0.25) },
    { icon: "tabler:refresh", label: "Reset zoom", onClick: () => relationshipsForceGraph.reset() },
    { icon: "tabler:zoom-in", label: "Zoom in", onClick: () => relationshipsForceGraph.zoomBy(0.25) },
  ].forEach((config) => relationshipsGraphToolbarMount?.appendChild(createIconButton(config)));
  return relationshipsForceGraph;
}

let relationshipsIconByKind = {};

async function refreshRelationshipsList() {
  if (!relationshipsListMount) return;
  // No NPC loaded — clear rather than leave a stale prior NPC's own
  // relationships on screen.
  if (!currentRecord?.id) {
    relationshipsListMount.innerHTML = '<p class="small text-body-secondary mb-0">Select or generate an NPC to see its relationships.</p>';
    return;
  }
  await renderRelationshipEditor({
    container: relationshipsListMount,
    sourceKind: "npc",
    sourceId: currentRecord.id,
    targetKinds: RELATIONSHIP_TARGET_KINDS,
    typeSuggestions: RELATIONSHIP_TYPE_SUGGESTIONS,
    dataManager,
    status,
    onChange: () => {
      void refreshRelationshipsList();
      void refreshRelationshipsGraph();
    },
  });
}

async function refreshRelationshipsGraph() {
  const forceGraph = ensureRelationshipsForceGraph();
  if (!forceGraph || !currentRecord?.id) return;
  try {
    const { nodes, edges, iconByKind } = await buildRelationshipGraph(dataManager, {
      nodes: [{ kind: "npc", id: currentRecord.id, label: currentRecord.name || currentRecord.id }],
    });
    relationshipsIconByKind = iconByKind;
    forceGraph.setGraph({ nodes, edges });
  } catch (error) {
    status?.show("Unable to build the Relationships graph.", { type: "error" });
  }
}

// currentRecord.id is always set by the time this is reachable — renderNpc
// only calls this from its own post-record-loaded path, and createNpcRecord/
// the load-existing-NPC path (js/lib/npc-schema.js) both always stamp one,
// even for a freshly generated, not-yet-saved NPC.
async function refreshRelationshipsSection() {
  await refreshRelationshipsList();
  void refreshRelationshipsGraph();
}

renderModeToggle();

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

// The Location a GM picks is optional and, per its own design, only ever
// contributes naming/species context — but a Location with no Species
// Weights of its own (or no Location at all) used to always fall through
// straight to "Other," even when the active Setting has a perfectly good
// general population defined (Setting Properties' own Species Weights,
// right pane in Sanctum). This resolves which speciesWeights list actually
// applies: the Location's own when it has one, else the Setting's, else
// neither (still "Other," same as before) — a plain, real Location object
// otherwise so every other field it carries (archetypeOverrides, id, ...)
// keeps working exactly as it already did.
function effectiveSpeciesLocation() {
  const locationWeights = currentLocation?.speciesWeights;
  if (Array.isArray(locationWeights) && locationWeights.length) return currentLocation;
  const settingWeights = currentSetting?.speciesWeights;
  if (Array.isArray(settingWeights) && settingWeights.length) {
    return { ...(currentLocation || {}), speciesWeights: settingWeights };
  }
  return currentLocation;
}

// Re-derives everything that depends on "what Species can be rolled/picked
// right now" — the Species Name Profile cache (needed for both the roll AND
// the override select's own labels) and the override selects themselves —
// against effectiveSpeciesLocation()'s resolved population. Called whenever
// System, Setting, or Location changes, since any of the three can change
// which population is actually in effect.
async function refreshSpeciesContext() {
  const location = effectiveSpeciesLocation();
  tables.speciesProfiles = await loadSpeciesProfilesForLocation(location);
  populateLocationOverrides(location);
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

// System/Setting are "pick one of these existing, required things" selects
// — no in-place creation exists for either in Forge (they're authored in
// Sanctum now, see this file's own System>Setting>Location comment above) —
// so both get the disabled-placeholder, forced-choice treatment System
// already used. Location is NOT required to generate (it only contributes
// naming/species-weighting context — generateNpc and everything it calls
// tolerate a null Location), so it gets the same "New/unsaved"-style
// always-selectable blank the NPC picker below uses, minus the red
// required-field border.
async function populateSystemSelect() {
  const systems = await listAllSystems();
  renderRequiredSelectOptions(systemSelect, systems, { placeholder: systems.length ? "Select a System" : "No Systems yet" });
  markRequiredControl(systemSelect, Boolean(systemSelect.value));
  return systems;
}

async function populateSettingSelect(systemId) {
  const settings = await listSettingsForSystem(dataManager, systemId);
  // listSettingsForSystem itself returns server order, not name order —
  // alphabetized here the same way Sanctum's own populateSettingSelect
  // sorts its (otherwise-identical) list.
  const sortedSettings = [...settings].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  renderRequiredSelectOptions(settingSelect, sortedSettings, { placeholder: settings.length ? "Select a Setting" : "No Settings yet" });
  markRequiredControl(settingSelect, Boolean(settingSelect.value));
  return sortedSettings;
}

async function populateLocationSelectOptions(settingId) {
  const locations = await listLocationsForSetting(dataManager, settingId);
  locationsInSetting = locations;
  renderOptionalSelectOptions(locationSelect, locations, { blankLabel: locations.length ? "No Location" : "No Locations yet" });
  return locations;
}

// Ownership metadata comes from the list response, not the full fetched
// body — mirrors Sanctum's refreshLocationCatalog/Crucible's
// refreshMonsterCatalog/Vault's refreshEffectCatalog exactly. Local-only
// (anonymous, browser-storage) entries are always deletable, since it's
// just this browser's own storage.
async function refreshNpcCatalog(ids) {
  npcCatalog = await refreshOwnershipCatalog(dataManager, "npc", ids);
}

function npcAllowsDelete(id) {
  return allowsDelete(npcCatalog, id, { dataManager });
}

// Every saved NPC at the currently selected Location — same picker pattern
// as Sanctum's Location/Crucible's Monster/Vault's Effect: "New / unsaved"
// as the default so a fresh Generate NPC keeps working exactly as before.
// With no Location selected (it's optional now), falls back to every NPC
// belonging to the whole Setting (via its own settingIds — see
// listNpcsForSetting/generateNpc, lib/tables.js and lib/generator.js)
// instead of an empty list — confirmed real bug this fixes: a campaign's
// auto-selected System/Setting (see init()'s own active-group default)
// never auto-selects a Location, so a GM's own previously-saved NPCs never
// showed up until that exact Location was reselected by hand.
async function populateNpcSelect() {
  if (!npcSelect) return;
  if (currentLocation) {
    npcsAtLocation = await listNpcsForLocation(dataManager, currentLocation.id);
  } else if (settingSelect.value) {
    npcsAtLocation = await listNpcsForSetting(dataManager, settingSelect.value);
  } else {
    npcsAtLocation = [];
  }
  const sorted = [...npcsAtLocation].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  renderOptionalSelectOptions(npcSelect, sorted, { previousValue: currentNpcId || "" });
  await refreshNpcCatalog(npcsAtLocation.map((npc) => npc.id));
  updateGenerationFieldsVisibility();
}

// Species/Archetype/Alignment/Gender overrides only matter for generating
// something new — once an existing NPC is loaded they're just clutter (same
// convention Sanctum/Crucible/Vault's own generation fields follow). Purely
// visual: hiding never clears an override's underlying value.
function updateGenerationFieldsVisibility() {
  generationFields?.classList.toggle("d-none", Boolean(npcSelect?.value));
}

async function selectLocation(id) {
  if (!id) {
    currentLocation = null;
  } else {
    try {
      currentLocation = await loadLocation(dataManager, id);
    } catch (error) {
      status?.show(`Unable to load location: ${error.message}`, { type: "error", timeout: 4000 });
      return;
    }
  }
  locationSelect.value = id;
  // Reset which saved NPC (if any) the picker points at — a different
  // Location has its own distinct set of saved NPCs — but deliberately
  // don't clear whatever NPC is currently displayed: Forge already left a
  // generated/loaded NPC on screen across a Location change before this
  // change, and forcing it away here would risk losing an unsaved NPC the
  // GM didn't ask to discard just for browsing a different Location.
  currentNpcId = null;
  await populateNpcSelect();
  await refreshSpeciesContext();
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
  [identityFields, fourDFields, nameMount].filter(Boolean).forEach((container) => {
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
    // Reflects THIS record's own locationId — not necessarily the left
    // pane's currentLocation, which the record's own Location field is no
    // longer tied to (see renderNpc's identityFields loop and
    // handleIdentityFieldInput). Reuses the already-loaded currentLocation
    // object when it happens to be the same Location (the common case —
    // no extra fetch); otherwise loads the record's own Location fresh.
    const locationId = currentRecord?.locationId || "";
    if (!locationId) {
      populateLocationForm(null);
      return;
    }
    if (currentLocation?.id === locationId) {
      populateLocationForm(currentLocation);
      return;
    }
    const requestId = ++locationInspectorRequestId;
    loadLocation(dataManager, locationId)
      .then((location) => {
        if (requestId === locationInspectorRequestId) populateLocationForm(location);
      })
      .catch(() => {
        if (requestId === locationInspectorRequestId) populateLocationForm(null);
      });
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
      return tables?.npcAttitudes || [];
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
  if (!tables) return;
  try {
    const overrides = readOverrides();
    const record = createNpcRecord(
      generateNpc(effectiveSpeciesLocation(), tables, { overrides, systemId: systemSelect.value, settingId: settingSelect.value })
    );
    dirtyGate.markDirty();
    // Freshly generated content is always unsaved, regardless of whichever
    // saved NPC the picker previously pointed at — mirrors Crucible/Vault/
    // Sanctum's own Generate handlers resetting the same way.
    currentNpcId = null;
    if (npcSelect) npcSelect.value = "";
    updateGenerationFieldsVisibility();
    recordHistory("generate NPC", () => renderNpc(record));
  } catch (error) {
    status?.show(`Unable to generate: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

[identityFields, fourDFields, nameMount].filter(Boolean).forEach((container) => {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll-attribute]");
    if (!button || !currentRecord || !tables) return;
    const attribute = button.dataset.rerollAttribute;
    recordHistory(`reroll ${attribute}`, () => {
      renderNpc(rerollAttribute(currentRecord, tables, effectiveSpeciesLocation(), attribute));
    });
  });
});

// Clicking an Identity or 4D box selects it and surfaces its details in the
// inspector — guarded so a click on the reroll button or the Name field's
// inline input (both nested inside the box) doesn't also toggle selection.
[identityFields, fourDFields, nameMount].filter(Boolean).forEach((container) => {
  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-reroll-attribute]") || event.target.closest("[data-editable-field]")) return;
    const box = event.target.closest("[data-select-field]");
    if (!box) return;
    selectField(box.dataset.selectField);
  });
});

// Typing directly into an editable field keeps the record in sync without
// re-running renderNpc — same reasoning as the note textarea below:
// resetting .value mid-edit would jump the cursor. Name lives at the
// record's top level (see undercroft/forge/js/lib/generator.js) and renders
// in its own container (nameMount, inline with Image); every other Identity
// field lives under record.identity; 4D fields under record.fourD — one
// shared handler covers all three containers. Attitude is the one special
// case: its stored value is the raw 1-6 number, displayed with a derived
// label suffix (see renderNpc's identityFields loop), so its suffix span
// needs the same live-update-on-edit treatment Stats' ability scores get.
function handleIdentityFieldInput(event) {
  const input = event.target.closest("[data-editable-field]");
  if (!input || !currentRecord) return;
  const field = input.dataset.editableField;
  scheduleFieldCommit(`edit ${field}`);
  if (field === "name") {
    currentRecord = { ...currentRecord, name: input.value };
  } else if (field === "location") {
    // A top-level id reference, not part of `identity` — see renderNpc's
    // own identityFields loop. Blank ("No Location") stores null, same
    // "absent means unset" convention locationId already used everywhere
    // else in this file.
    currentRecord = { ...currentRecord, locationId: input.value || null };
  } else if (FOURD_FIELD_DEFS.some((entry) => entry.key === field)) {
    currentRecord = { ...currentRecord, fourD: { ...currentRecord.fourD, [field]: input.value } };
  } else if (IDENTITY_FIELD_DEFS.some((entry) => entry.key === field)) {
    // Attitude is the one numeric-valued Identity field (a <select> whose
    // option values are real numbers, but <select>.value always reads back
    // as a string) — every other field stores its label string as-is.
    const nextValue = field === "attitude" ? Number(input.value) || 0 : input.value;
    currentRecord = { ...currentRecord, identity: { ...currentRecord.identity, [field]: nextValue } };
  }
  jsonDataPanel.render();
  refreshActionButtons();
}
identityFields.addEventListener("input", handleIdentityFieldInput);
fourDFields.addEventListener("input", handleIdentityFieldInput);
nameMount?.addEventListener("input", handleIdentityFieldInput);
identityFields.addEventListener("keydown", flushFieldCommitOnUndoRedo);
fourDFields.addEventListener("keydown", flushFieldCommitOnUndoRedo);
nameMount?.addEventListener("keydown", flushFieldCommitOnUndoRedo);
identityFields.addEventListener("change", () => commitFieldEdit());
fourDFields.addEventListener("change", () => commitFieldEdit());
nameMount?.addEventListener("change", () => commitFieldEdit());

// Typing directly into a Stats field keeps the record in sync the same way
// — ability scores also live-update their (+N) modifier suffix alongside,
// since that's derived rather than stored. `abilities.<key>` (renderStats'
// own compound data-editable-field for an ability box) patches the nested
// stats.abilities object; hitPoints stays the other special-cased key (a
// max/current pair); every other key is a flat stats[field] write, coerced
// to a number only if it already held one (so a text stat like a
// Daggerheart Adversary's Feature line doesn't get silently zeroed).
statsFields.addEventListener("input", (event) => {
  const input = event.target.closest("[data-editable-field]");
  if (!input || !currentRecord?.stats) return;
  const field = input.dataset.editableField;
  scheduleFieldCommit(`edit ${field}`);
  if (field === "currentHp" || field === "maxHp") {
    const numericValue = Number(input.value) || 0;
    const hpKey = field === "currentHp" ? "current" : "max";
    currentRecord = {
      ...currentRecord,
      stats: { ...currentRecord.stats, hitPoints: { ...currentRecord.stats.hitPoints, [hpKey]: numericValue } },
    };
  } else if (field.startsWith("abilities.")) {
    const abilityKey = field.slice("abilities.".length);
    const numericValue = Number(input.value) || 0;
    currentRecord = {
      ...currentRecord,
      stats: { ...currentRecord.stats, abilities: { ...currentRecord.stats.abilities, [abilityKey]: numericValue } },
    };
    const suffixEl = statsFields.querySelector(`[data-editable-suffix="${field}"]`);
    if (suffixEl) suffixEl.textContent = abilityModifierText(numericValue);
  } else {
    const previousValue = currentRecord.stats[field];
    const nextValue = typeof previousValue === "number" ? Number(input.value) || 0 : input.value;
    currentRecord = { ...currentRecord, stats: { ...currentRecord.stats, [field]: nextValue } };
  }
  jsonDataPanel.render();
  refreshActionButtons();
});
statsFields.addEventListener("keydown", flushFieldCommitOnUndoRedo);
statsFields.addEventListener("change", () => commitFieldEdit());

generateNoteButton.addEventListener("click", async () => {
  if (!currentRecord) return;
  generateNoteButton.disabled = true;
  const originalHtml = generateNoteButton.innerHTML;
  generateNoteButton.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Generating…';
  try {
    const note = await generateCharacterNote(currentRecord);
    recordHistory("generate note", () => {
      currentRecord = { ...currentRecord, note };
      renderNpc(currentRecord);
    });
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
  scheduleFieldCommit("edit note");
  currentRecord = { ...currentRecord, note: noteText.value };
  jsonDataPanel.render();
  refreshActionButtons();
});
noteText.addEventListener("keydown", flushFieldCommitOnUndoRedo);
noteText.addEventListener("change", () => commitFieldEdit());

// View/Edit toggle for the Note box itself — same button as Repository's
// own Edit/View button (undercroft/repository/js/app.js#applyMode) for the
// identical concept, and the same behavior Crucible/Vault/Sanctum's own
// Notes toggle uses (this suite's one shared Notes-field convention).
// Icon/label always describe what clicking will switch TO, not the current
// state. Defaults to "view" — a freshly-loaded record's note is read far
// more often than edited, and a note written with markdown in mind
// (headings, lists, callouts) reads better rendered than as raw source by
// default.
let noteMode = "view";

function renderNotePreview() {
  if (!notePreview) return;
  notePreview.innerHTML = "";
  notePreview.appendChild(renderMarkdown(currentRecord?.note || ""));
}

function applyNoteMode(mode) {
  noteMode = mode;
  const isView = mode === "view";
  noteText.classList.toggle("d-none", isView);
  notePreview?.classList.toggle("d-none", !isView);
  // Showing the eye while in Edit mode (the icon describes what clicking
  // switches TO, not the current state) and vice versa — same convention
  // Repository's own toggle uses.
  noteModeEyeIcon?.classList.toggle("d-none", isView);
  noteModePencilIcon?.classList.toggle("d-none", !isView);
  if (noteModeLabel) noteModeLabel.textContent = isView ? "Edit" : "View";
  noteModeToggle?.setAttribute("data-bs-title", isView ? "Edit" : "View");
  refreshTooltips();
  if (isView) renderNotePreview();
}

noteModeToggle?.addEventListener("click", () => {
  // Note isn't written back into currentRecord until Save/Export (see
  // handleSave) — switching to View needs the live textarea value, not
  // whatever was last saved, so it's synced here same as handleSave
  // already does.
  if (currentRecord) currentRecord = { ...currentRecord, note: noteText.value };
  applyNoteMode(noteMode === "view" ? "edit" : "view");
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
    currentNpcId = currentRecord.id;
    await populateNpcSelect();
    refreshActionButtons();
    status?.show("Saved.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

deleteButton.addEventListener("click", async () => {
  if (!currentRecord || !dataManager || !dirtyGate.hasSaved() || !npcAllowsDelete(currentNpcId)) return;
  const label = currentRecord.name || currentRecord.id;
  if (!confirmDelete({ label: `"${label}"` })) return;
  try {
    await dataManager.delete("npc", currentRecord.id);
    status?.show("Deleted.", { type: "success", timeout: 1500 });
    dirtyGate.markDirty();
    currentNpcId = null;
    renderNpc(null);
    await populateNpcSelect();
  } catch (error) {
    status?.show(`Unable to delete: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

function handleExportNpc() {
  if (!currentRecord) return;
  const record = toPressExportShape(currentRecord);
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentRecord.name || currentRecord.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function generateNpcId() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `npc_${suffix}`;
}

duplicateButton.addEventListener("click", () => {
  if (!currentRecord) return;
  const duplicate = { ...currentRecord, id: generateNpcId(), name: `${currentRecord.name || "NPC"} Copy` };
  dirtyGate.markDirty();
  currentNpcId = null;
  if (npcSelect) npcSelect.value = "";
  renderNpc(duplicate);
  status?.show("Duplicated — not yet saved.", { type: "info", timeout: 2000 });
});

undoButton.addEventListener("click", () => performUndo());
redoButton.addEventListener("click", () => performRedo());

// Named (not an inline listener) so the init flow below can also call this
// directly when auto-selecting the active campaign group's own System.
async function handleSystemSelectChange() {
  const systemId = systemSelect.value;
  markRequiredControl(systemSelect, Boolean(systemId));
  currentLocation = null;
  currentSetting = null;
  currentNpcId = null;
  // Settings returned (not just awaited) so the init flow's own active-group
  // auto-default can check the Setting it wants against what actually loaded
  // for this System, without a second, redundant fetch.
  const [, settings] = await Promise.all([refreshSystemVocabulary(systemId), populateSettingSelect(systemId)]);
  await populateLocationSelectOptions("");
  await populateNpcSelect();
  // Archetype's own table is System-wide, not Location-dependent (only its
  // 22/23 "Setting Specific" overrides are — see getArchetypeOptions), so
  // its override select needs to populate here too, not only inside
  // selectLocation — otherwise, now that picking a Location is optional,
  // a GM who generates without ever selecting one sees an empty Archetype
  // override list even though nothing about it actually needed a Location.
  // currentLocation/currentSetting are both null at this point (reset
  // above), so effectiveSpeciesLocation() resolves to null too — this also
  // correctly leaves the Species override empty until a Setting or Location
  // is picked.
  await refreshSpeciesContext();
  return settings;
}
systemSelect.addEventListener("change", handleSystemSelectChange);

// Named for the same reason as handleSystemSelectChange above.
async function handleSettingSelectChange() {
  const settingId = settingSelect.value;
  markRequiredControl(settingSelect, Boolean(settingId));
  currentLocation = null;
  currentNpcId = null;
  try {
    currentSetting = settingId ? await loadSetting(dataManager, settingId) : null;
  } catch (error) {
    currentSetting = null;
  }
  // No auto-selecting the first Location anymore — matches Sanctum's own
  // Setting/Location pickers, which always land on an explicit "nothing
  // chosen yet" state and let the GM pick deliberately, rather than
  // silently defaulting to whichever Location happens to sort first.
  await populateLocationSelectOptions(settingId);
  await populateNpcSelect();
  // The Setting's own Species Weights become the fallback the moment it's
  // picked (effectiveSpeciesLocation) — refresh here too, not just on
  // Location change, so the Species override select reflects it right away
  // even before any Location is selected.
  await refreshSpeciesContext();
}
settingSelect.addEventListener("change", handleSettingSelectChange);

locationSelect.addEventListener("change", () => selectLocation(locationSelect.value));

npcSelect?.addEventListener("change", async () => {
  const id = npcSelect.value;
  currentNpcId = id || null;
  updateGenerationFieldsVisibility();
  if (!id) {
    renderNpc(null);
    return;
  }
  try {
    const result = await dataManager.get("npc", id);
    if (!result?.payload) {
      status?.show("Unable to load that NPC.", { type: "error", timeout: 4000 });
      return;
    }
    // Not createNpcRecord — that function always stamps a fresh id and
    // createdAt (see npc-schema.js), which is right for a NEW generation
    // but would silently rewrite an existing record's real creation time
    // on every load.
    renderNpc({ ...result.payload, id });
    dirtyGate.markClean(toPressExportShape(currentRecord));
    refreshActionButtons();
  } catch (error) {
    status?.show(`Unable to load NPC: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

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

// `?npc=<id>` — a cross-tool deep link (Repository's own kind-reference
// chips route here via KIND_TOOL_ROUTE, see repository/js/app.js), same
// `?param=<id>`-read-at-bootstrap convention Orrery's own `?map=` and Loom's
// own `?feature=` already establish. An npc record only carries its own
// System/Setting (systemIds/settingIds — never a locationId, confirmed
// against the real schema), so the cascade here only needs those two levels,
// not a third for Location the way Sanctum's own deep link does.
//
// Two-phase, not one straight-line await chain — same "show the linked
// record first, load everything else in the background" fix Sanctum's own
// deep link needed once a campaign had enough saved NPCs/Locations for the
// full cascade to be genuinely slow. Phase 1 (awaited, blocks return):
// render THIS npc directly (reusing renderNpc + the same dirty-baseline
// call npcSelect's own change handler makes — not that handler itself,
// since it reads the id off npcSelect.value, which has no matching
// <option> yet this early). Phase 2 (fired but not awaited): the System/
// Setting cascade populates npcSelect's own option list (scoped by
// Setting) and species/archetype reference data; a real "change" event
// re-dispatched at the end both puts the picker's own displayed selection
// in sync and re-renders with anything reference-data-dependent resolved.
async function applyDeepLinkParams() {
  const params = new URLSearchParams(window.location.search);
  const npcId = params.get("npc");
  if (!npcId) return false;
  try {
    const result = await dataManager.get("npc", npcId);
    const payload = result?.payload || {};
    const targetSystemId = payload.systemIds?.[0] || null;
    const targetSettingId = payload.settingIds?.[0] || null;
    // Phase 1 — the NPC itself, on screen as fast as one fetch allows.
    currentNpcId = npcId;
    updateGenerationFieldsVisibility();
    renderNpc({ ...payload, id: npcId });
    dirtyGate.markClean(toPressExportShape(currentRecord));
    // Phase 2 — deliberately not awaited here; runs after this function has
    // already returned `true`.
    void (async () => {
      try {
        if (targetSystemId) {
          systemSelect.value = targetSystemId;
          await handleSystemSelectChange();
        }
        if (targetSettingId) {
          settingSelect.value = targetSettingId;
          await handleSettingSelectChange();
        }
        if (npcSelect) {
          npcSelect.value = npcId;
          npcSelect.dispatchEvent(new Event("change"));
        }
      } catch (error) {
        // Phase 1 already succeeded — a background failure here just
        // leaves the picker under-populated, not worth an error toast on
        // top of a page that's already showing real content.
      }
    })();
    return true;
  } catch (error) {
    status?.show("Unable to open the linked record.", { type: "error", timeout: 3000 });
    return false;
  }
}

// --- Init ----------------------------------------------------------------

async function init() {
  const shell = initAppShell({
    namespace: "forge",
    storagePrefix: "undercroft.forge.undo",
    settingsSlotAttr: "data-forge-settings-slot",
    onUndo: (entry) => {
      if (!entry) return null;
      applyRecordSnapshot(entry.before);
      return { message: entry.label ? `Undid ${entry.label}` : "Undid last action" };
    },
    onRedo: (entry) => {
      if (!entry) return null;
      applyRecordSnapshot(entry.after);
      return { message: entry.label ? `Redid ${entry.label}` : "Redid last action" };
    },
  });
  status = shell.status;
  undoStack = shell.undoStack;
  performUndo = shell.undo;
  performRedo = shell.redo;
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
          options: fieldPreferenceOptions(),
          getValue: () => resolveEffectiveArchetypeField(getArchetypeFieldPreference(systemId)),
          setValue: (value) => {
            setArchetypeFieldPreference(systemId, value);
            refreshSystemVocabulary(systemId);
          },
        },
        {
          key: "attitudeField",
          type: "select",
          label: "Attitude field",
          options: fieldPreferenceOptions(),
          getValue: () => resolveEffectiveAttitudeField(getAttitudeFieldPreference(systemId)),
          setValue: (value) => {
            setAttitudeFieldPreference(systemId, value);
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

  // No blanket auto-selected defaults (previously always sys.dnd5e /
  // forgotten-realms / sword-coast, regardless of who was signed in) — the
  // GM picks System, then Setting, then Location explicitly, same
  // forced-choice convention Sanctum/Crucible/Vault's own System select
  // uses. The one exception: if a campaign group is active (the header's
  // Campaign dropdown) and that group has its own System/Setting assigned,
  // default to THOSE specifically — a real, GM-chosen fact about the
  // campaign being played, not a guess — to make mid-campaign generation
  // faster. Falls through to the original "nothing chosen yet" placeholders
  // whenever there's no active group, or its System/Setting isn't one this
  // tool's own lists actually contain.
  const systems = await populateSystemSelect();
  const deepLinked = await applyDeepLinkParams();
  if (!deepLinked) {
    const groupContext = await resolveGroupContext(dataManager).catch(() => null);
    const defaultSystemId = pickGroupDefaultId(groupContext, "systemId", systems);
    if (defaultSystemId) {
      systemSelect.value = defaultSystemId;
      const settings = await handleSystemSelectChange();
      const defaultSettingId = pickGroupDefaultId(groupContext, "settingId", settings);
      if (defaultSettingId) {
        settingSelect.value = defaultSettingId;
        await handleSettingSelectChange();
      }
    } else {
      await populateSettingSelect("");
      await populateLocationSelectOptions("");
      await populateNpcSelect();
    }
    renderNpc(null);
  }
  initHelpSystem({ root: document });
  refreshTooltips(document);
}

init();
