import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips, disposeTooltips, updateTooltipContent } from "../../common/js/lib/tooltips.js";
import {
  createJsonDataPanel,
  createToolbarButtonGroup,
  createCollapsibleSection,
  createEmptyStateCard,
  createCompactField,
  createIconButton,
  createFieldBox,
  createSearchableCheckList,
  createModeToggleGroup,
} from "../../common/js/lib/ui-components.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { renderRelationshipEditor } from "../../common/js/lib/relationship-editor.js";
import { createReferenceChip } from "../../common/js/lib/library-reference.js";
import { buildRelationshipGraph } from "../../common/js/lib/relationship-graph.js";
import { createForceGraph } from "../../common/js/lib/graph-view.js";
import { listFeaturesForSystem, listWondersForSystem, getSystemPropertyTypes, getSystemClasses, guessBudgetCeilingFieldKey } from "./lib/tables.js";
import { generateWonder, getWonderGenerationBlockReason, computeBudget, matchesCategory, rerollPropertyValue, resolveFeatureBudgetCost } from "./lib/generator.js";
import { createWonderRecord, toPressExportShape } from "./lib/wonder-schema.js";
import { convertSpellOrItemToFeatures, hasConvertibleSpellItemStats } from "../../common/js/lib/vault-feature-matching.js";
// Same shared weapon-attack/rider/save-effect/options editor Crucible's own
// Inspector uses (feature-params-editor.js) — see that module's own comment
// for why it moved out of Crucible into a shared home. Vault's own
// mechanics types (item-passive-bonus, see vault-feature-matching.js —
// feat.damage/feat.healing both use the ordinary "active" type, dispatched
// by feature id instead) don't need any of the weapon-attack/save-effect
// branches this editor also renders, but a pinned/locked Feature from
// outside Vault's own spell/item category pool (never produced by
// generation, only possible via hand-edited JSON) could theoretically still
// be one — instantiated the same way regardless, so nothing crashes on that
// edge case.
import { createFeatureParamsEditor } from "../../common/js/lib/feature-params-editor.js";
import { generateWonderNote } from "./lib/llm-note.js";
import { createDirtyGate } from "../../common/js/lib/dirty-gate.js";
import {
  listAllSystems,
  findById,
  featureLabel as sharedFeatureLabel,
  readLockedFeatureIds as sharedReadLockedFeatureIds,
  populateLockedFeaturesCheckList as sharedPopulateLockedFeaturesCheckList,
  exportRecordAsJson,
  generateNoteForRecord,
  renderRequiredSelectOptions,
  renderOptionalSelectOptions,
  loadAbilityFieldDefs,
  setGenerateButtonReadiness,
  listObjectFieldOptions,
} from "../../common/js/lib/generator-kit.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
import { initToolSettings } from "../../common/js/lib/tool-settings.js";
import { setElementVisible, markRequiredControl } from "../../common/js/lib/dom.js";
import { resolveGroupContext, pickGroupDefaultId } from "../../common/js/lib/widgets/group-context.js";
// Repository's own markdown renderer (dice/task-list/callout/wiki-link
// awareness, degrading gracefully without any of that for a plain note) —
// reused as-is for the Notes field's View mode, same as Crucible/Forge/
// Sanctum's own identical Notes preview.
import { renderMarkdown } from "../../repository/js/lib/markdown.js";

let status = null;
let undoStack = null;
let performUndo = null;
let performRedo = null;
let dataManager = null;
let features = [];
let propertyTypes = [];
// Which propertyTypes entry guessBudgetCeilingFieldKey would auto-pick for
// the active System — same "ride along, no second round trip" shape as
// abilityFieldGuess below, computed straight from propertyTypes itself
// (already the isGeneratorPropertyField-eligible candidate list) rather
// than a separate fetch.
let budgetCeilingFieldGuess = "";
// The active System's own casting classes (Wizard, Cleric, ...) — empty for
// any System with no "classes" field at all (most Systems), in which case
// the Casting Class select stays hidden entirely (see
// populateCastingClassSelect).
let classes = [];
let currentRecord = null;
// Which row in the Features list the Inspector panel is currently showing
// — same module-level tracking Crucible's own selectedFeatureId uses, so
// the Edit Feature toolbar button (registered once, at init) can look up
// the right feature at click time.
let selectedFeatureId = null;
// Read once per System reload (reloadReferenceData) — the active System's
// own ability fields, e.g. so an "active"-type Feature's own `ability`
// param (Ability Score Increase's own "which ability" choice) renders as a
// real select instead of free text (see feature-params-editor.js's own
// ABILITY_LIKE_PARAM_KEYS).
let abilityFieldDefs = [];
// Candidate list for the abilityField settings preference below — every
// object-type field the active System defines — plus which one
// guessAbilityFieldKey would auto-pick, so the dropdown can pre-select and
// label it instead of offering a separate "Auto-detect" placeholder option.
let objectFieldOptions = [];
let abilityFieldGuess = "";
const featureParamsEditor = createFeatureParamsEditor({
  getRecord: () => currentRecord,
  // A tier change (renderFeatureTierEditor) is now reached through this
  // SAME hook as an ordinary params edit — recomputeBudget before
  // refreshWonderView, same as addFeature/removeFeature already do,
  // because renderBudget only recomputes when record.budget is unset
  // (`record.budget || recomputeBudget(record)`) and would otherwise show
  // a stale total after a tier change specifically (budget depends on
  // featureTiers, never on featureParams — recomputing on every params
  // edit too is harmless, just a no-op for the ones that don't affect it).
  onParamsChanged: () => {
    if (currentRecord) recomputeBudget(currentRecord);
    refreshWonderView();
  },
  saveFeature: (feature) => dataManager.save("feature", feature.id, feature),
  onFeatureSaved: () => refreshWonderView(),
  getAbilityFieldDefs: () => abilityFieldDefs,
  // Drives the "Delete Parameter" toolbar button's own enabled state —
  // independent of selectedFeatureId (Edit Feature's own gate), since a
  // Feature can be selected in the list with no param row selected within
  // its own generic active-params grid yet.
  onParamSelectionChanged: (hasSelection) => {
    if (elements.deleteParamButton) elements.deleteParamButton.disabled = !hasSelection;
  },
});
// View/Edit toggle for the Notes box — same button as Repository's own
// Edit/View button (undercroft/repository/js/app.js#applyMode) for the
// identical concept, and the same behavior Crucible/Forge/Sanctum's own
// Notes toggle uses (this suite's one shared Notes-field convention).
// Icon/label always describe what clicking will switch TO, not the current
// state. Defaults to "view" — a freshly-loaded record's notes are read far
// more often than edited, and a note written with markdown in mind
// (headings, lists, callouts) reads better rendered than as raw source by
// default.
let notesMode = "view";
// Every saved wonder for the active System (Wonder picker options) plus its
// ownership metadata — same role/shape as Crucible's monstersInSystem/
// monsterCatalog, itself mirroring Sanctum's locationsInSetting/
// locationCatalog. currentWonderId is tracked separately from currentRecord
// for the same reason Crucible tracks currentMonsterId separately.
let wondersInSystem = [];
let wonderCatalog = new Map();
let currentWonderId = null;
// Tracks whether the record as last successfully saved differs from a live
// snapshot — built from currentRecord (feature add/remove already patches it
// directly) plus whatever's currently typed into Name/Notes, since those two
// fields aren't written back into currentRecord until Save/Export actually
// runs. Gates Save (dirty) and Delete (nothing saved yet) — see
// common/js/lib/dirty-gate.js, lifted from Crucible's original version of
// this exact pattern.
const dirtyGate = createDirtyGate({ buildSnapshot: () => toPressExportShape(buildRecordForSave()) });

// Whole-record snapshot undo — same shape/reasoning as Crucible's own
// recordHistory/field-commit-debounce pair (crucible/js/app.js), reusing
// buildRecordForSave() (defined below, referenced here since function
// declarations hoist) so a Name/Notes edit — not synced onto currentRecord
// until Save/Export, see that function's own comment — is captured too.
// Restoring goes through renderWonder, which already writes record.name/
// record.notes back into their live input fields. Feature-params sub-edits
// (routed through the shared featureParamsEditor) are intentionally NOT
// wrapped here, same scoping decision as Crucible's — that mutation happens
// inside a shared module this pass isn't touching.
function recordSnapshot() {
  return JSON.stringify(buildRecordForSave());
}

function recordHistory(label, applyChange) {
  if (!currentRecord) {
    applyChange();
    return;
  }
  const before = recordSnapshot();
  applyChange();
  const after = recordSnapshot();
  if (before !== after) undoStack.push({ label, before, after });
}

function applyRecordSnapshot(json) {
  if (!json) return;
  renderWonder(JSON.parse(json));
}

const FIELD_COMMIT_DEBOUNCE_MS = 600;
let fieldCommitTimer = 0;
let fieldCommitLabel = "";
let fieldEditBaseline = null;

function commitFieldEdit() {
  window.clearTimeout(fieldCommitTimer);
  fieldCommitTimer = 0;
  if (!currentRecord || fieldEditBaseline === null) return;
  const after = recordSnapshot();
  if (after !== fieldEditBaseline) undoStack.push({ label: fieldCommitLabel, before: fieldEditBaseline, after });
  fieldEditBaseline = null;
}

function scheduleFieldCommit(label) {
  if (fieldEditBaseline === null) fieldEditBaseline = recordSnapshot();
  fieldCommitLabel = label;
  window.clearTimeout(fieldCommitTimer);
  fieldCommitTimer = window.setTimeout(commitFieldEdit, FIELD_COMMIT_DEBOUNCE_MS);
}

function flushFieldCommitOnUndoRedo(event) {
  const key = (event.key || "").toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") commitFieldEdit();
}

// Built and mounted before `elements` below queries for these buttons by
// their data-*-wonder attribute, so every existing selector/disabled-state
// call site elsewhere in this file keeps working unchanged.
createToolbarButtonGroup([
  // Starts disabled — nothing to generate FROM until reloadReferenceData
  // (init()'s own cascade, below) resolves; clicking it before then threw
  // straight out of generateWonder (features/propertyTypes still their
  // initial empty state). Re-enabled by init() once that resolves.
  { action: "generate", icon: "tabler:sparkles", label: "Generate Wonder", disabled: true, attrs: { "data-generate-wonder": true } },
  { action: "save", label: "Save", disabled: true, attrs: { "data-save-wonder": true } },
  { action: "duplicate", label: "Duplicate", disabled: true, attrs: { "data-duplicate-wonder": true } },
  { action: "delete", label: "Delete", disabled: true, attrs: { "data-delete-wonder": true } },
]).forEach((button) => document.querySelector("[data-wonder-toolbar-mount]")?.appendChild(button));
// A small visual break, not a functional one — same convention every other
// tool's toolbar now uses (see forge/js/app.js's own comment).
createToolbarButtonGroup([
  { action: "undo", label: "Undo", attrs: { "data-undo-wonder": true } },
  { action: "redo", label: "Redo", attrs: { "data-redo-wonder": true } },
]).forEach((button) => document.querySelector("[data-wonder-undo-toolbar-mount]")?.appendChild(button));
createToolbarButtonGroup([
  {
    label: "Edit Feature",
    icon: "tabler:external-link",
    disabled: true,
    attrs: { "data-edit-feature-button": true },
    onClick: () => {
      const feature = findById(features, selectedFeatureId);
      if (feature) window.open(`../loom/index.html?feature=${encodeURIComponent(feature.id)}`, "_blank", "noopener");
    },
  },
  {
    label: "Delete Parameter",
    icon: "tabler:trash",
    variant: "outline-danger",
    disabled: true,
    attrs: { "data-delete-param-button": true },
    // Select-then-delete for the generic active-params grid's own rows
    // (feature-params-editor.js's own setSelectedParam/deleteSelectedParam)
    // — this button's own enabled state is driven by the editor's
    // onParamSelectionChanged hook below, not by selectedFeatureId, since a
    // Feature can be selected with no param row selected within it yet.
    onClick: () => featureParamsEditor.deleteSelectedParam(),
  },
]).forEach((button) => document.querySelector("[data-feature-inspector-toolbar-mount]")?.appendChild(button));
document.querySelector("[data-wonder-empty-state]")?.appendChild(
  createEmptyStateCard({
    message: "Nothing selected yet. Pick an existing Wonder above, or fill in the fields and click Generate Wonder.",
    variant: "inline",
  })
);

// Named data-field-mount (not data-inspector-mount) — this file's own
// [data-inspector-mount] selector below is a single bare marker for the
// Detail Inspector's collapsible wrapper; a keyed attribute of the same
// name would collide with it (attribute selectors match on presence, not
// value).
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
mountField("system-select", createCompactField({ type: "select", id: "vaultSystemSelect", label: "System", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-system-select" }));
mountField("wonder-select", createCompactField({ type: "select", id: "vaultWonderSelect", label: "Wonder", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-wonder-select" }));
// Hidden entirely for a System with no "classes" field (most Systems) —
// see populateCastingClassSelect. Casting Class narrows which Features are
// eligible (matchesClass, lib/generator.js) the same way a locked Signature
// Feature narrows the pick, so it's positioned right before the Property
// overrides that also constrain generation.
mountField("casting-class-select", createCompactField({ type: "select", id: "vaultCastingClassSelect", label: "Casting Class", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-casting-class-select" }));
mountField("signature-feature-override", createCompactField({ type: "select", id: "vaultSignatureOverride", label: "Signature Feature", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-signature-feature-override" }));
mountField(
  "locked-features",
  createSearchableCheckList({
    id: "vaultLockedFeatures", label: "Locked Features",
    dataAttr: "data-locked-features", helpTopic: "vault.lockedFeatures",
  })
);
// Same field-box style as Identity below (and Forge/Crucible's own Name
// box) — per explicit feedback that every tool's center-pane properties
// should look and act the same.
mountField("wonder-name", createFieldBox({ key: "name", label: "Name", editable: true, colClass: null, dataAttr: "data-wonder-name" }));

const elements = {
  systemSelect: document.querySelector("[data-system-select]"),
  wonderSelect: document.querySelector("[data-wonder-select]"),
  generationFields: document.querySelector("[data-generation-fields]"),
  castingClassSelect: document.querySelector("[data-casting-class-select]"),
  propertyOverridesContainer: document.querySelector("[data-property-overrides]"),
  signatureOverride: document.querySelector("[data-signature-feature-override]"),
  lockedFeatures: document.querySelector("[data-locked-features]"),
  generateButton: document.querySelector("[data-generate-wonder]"),
  saveButton: document.querySelector("[data-save-wonder]"),
  duplicateButton: document.querySelector("[data-duplicate-wonder]"),
  deleteButton: document.querySelector("[data-delete-wonder]"),
  undoButton: document.querySelector("[data-undo-wonder]"),
  redoButton: document.querySelector("[data-redo-wonder]"),
  emptyState: document.querySelector("[data-wonder-empty-state]"),
  display: document.querySelector("[data-wonder-display]"),
  nameInput: document.querySelector("[data-wonder-name]"),
  identityFields: document.querySelector("[data-identity-fields]"),
  featureList: document.querySelector("[data-feature-list]"),
  addFeatureSelect: document.querySelector("[data-add-feature-select]"),
  addFeatureButton: document.querySelector("[data-add-feature-button]"),
  budgetTarget: document.querySelector("[data-budget-target]"),
  budgetSpent: document.querySelector("[data-budget-spent]"),
  budgetRemaining: document.querySelector("[data-budget-remaining]"),
  notesText: document.querySelector("[data-notes-text]"),
  notesPreview: document.querySelector("[data-notes-preview]"),
  notesModeToggle: document.querySelector("[data-notes-mode-toggle]"),
  notesModeEyeIcon: document.querySelector('[data-notes-mode-icon="view"]'),
  notesModePencilIcon: document.querySelector('[data-notes-mode-icon="edit"]'),
  notesModeLabel: document.querySelector("[data-notes-mode-label]"),
  generateNoteButton: document.querySelector("[data-generate-note]"),
  inspectorEmpty: document.querySelector("[data-inspector-empty]"),
  inspectorDetail: document.querySelector("[data-inspector-detail]"),
  inspectorJson: document.querySelector("[data-inspector-json]"),
  featureParamsEditor: document.querySelector("[data-feature-params-editor]"),
  featureBasicId: document.querySelector("[data-feature-basic-id]"),
  featureBasicName: document.querySelector("[data-feature-basic-name]"),
  featureBasicDescription: document.querySelector("[data-feature-basic-description]"),
  featureBasicBudgetCost: document.querySelector("[data-feature-basic-budget-cost]"),
  editFeatureButton: document.querySelector("[data-edit-feature-button]"),
  deleteParamButton: document.querySelector("[data-delete-param-button]"),
  wonderRelationships: document.querySelector("[data-wonder-relationships]"),
  modeToggleMount: document.querySelector("[data-vault-mode-toggle-mount]"),
  relationshipsListMount: document.querySelector("[data-relationships-list-mount]"),
  relationshipsGraphWrap: document.querySelector("[data-relationships-graph-wrap]"),
  relationshipsGraphContainer: document.querySelector("[data-relationships-graph-container]"),
  relationshipsGraphContent: document.querySelector("[data-relationships-graph-content]"),
  relationshipsGraphSvg: document.querySelector("[data-relationships-graph-svg]"),
  relationshipsGraphControls: document.querySelector("[data-relationships-graph-controls]"),
  relationshipsGraphToolbarMount: document.querySelector("[data-relationships-graph-toolbar-mount]"),
  relationshipsGraphEmpty: document.querySelector("[data-relationships-graph-empty]"),
};

// Wonder Properties — no content yet (Vault has no Convert-style action of
// its own today, unlike Forge/Crucible's own "NPC Properties"/"Monster
// Properties"), but the section exists now for structural consistency
// across all three generators' right-pane layout, ready for whatever gets
// added here later. Starts (and stays) collapsed — nothing populates it yet.
{
  const wonderPropertiesSection = createCollapsibleSection({
    label: "Wonder Properties",
    collapsed: true,
    content: document.querySelector("[data-wonder-properties-panel]"),
  });
  document.querySelector("[data-wonder-properties-mount]")?.appendChild(wonderPropertiesSection.section);
}

// Adopts each section's existing static `[data-xxx-panel]` markup (its own
// content stays hand-authored HTML — only the header+chevron wrapper is
// JS-built) as createCollapsibleSection's content — same pattern Sanctum's
// own initCollapsibles/Crucible's own module-top-level block use. Every
// section here is expanded by default. Features and Notes both keep extra
// header content in static HTML (Features' own budget summary; Notes' own
// "Generate Note" button) that createCollapsibleSection's built header would
// clobber, so only their toggle button is built and mounted — same as
// Crucible/Forge/Sanctum's own Notes sections.
{
  const inspectorSection = createCollapsibleSection({
    label: "Inspector",
    collapsed: false,
    content: document.querySelector("[data-inspector-panel]"),
  });
  document.querySelector("[data-inspector-mount]")?.appendChild(inspectorSection.section);

  // Collapsed by default (raw JSON is a power-user/debugging view, not
  // something a GM needs open by default the way the structured Basic
  // Info/tier/params editors above it are) — same "adopt the existing
  // static element as content" pattern as every other createCollapsibleSection
  // call here, mirroring Crucible's own identical Raw JSON section exactly.
  // elements.inspectorJson keeps working unchanged (its own querySelector
  // ref stays valid after appendChild relocates the element).
  document.querySelector("[data-inspector-json-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Raw JSON",
      collapsed: true,
      content: document.querySelector("[data-inspector-json]"),
    }).section
  );

  document.querySelector("[data-identity-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Identity",
      helpTopic: "vault.identity",
      collapsed: false,
      content: document.querySelector("[data-identity-panel]"),
    }).section
  );

  const featuresToggle = createIconButton({
    icon: "tabler:chevron-right",
    className: "collapsible-toggle",
    includeToggleLabel: true,
  });
  featuresToggle.setAttribute("aria-expanded", "true");
  document.querySelector("[data-features-toggle-mount]")?.appendChild(featuresToggle);
  bindCollapsibleToggle(featuresToggle, document.querySelector("[data-features-panel]"), {
    collapsed: false,
    expandLabel: "Expand features",
    collapseLabel: "Collapse features",
  });

  const notesToggle = createIconButton({
    icon: "tabler:chevron-right",
    className: "collapsible-toggle",
    includeToggleLabel: true,
  });
  notesToggle.setAttribute("aria-expanded", "true");
  document.querySelector("[data-notes-toggle-mount]")?.appendChild(notesToggle);
  bindCollapsibleToggle(notesToggle, document.querySelector("[data-notes-panel]"), {
    collapsed: false,
    expandLabel: "Expand notes",
    collapseLabel: "Collapse notes",
  });
}

const jsonDataPanel = createJsonDataPanel({
  label: "JSON Data",
  getData: () => (currentRecord ? toPressExportShape(currentRecord) : null),
  onExport: () => handleExport(),
});

const selectionsSection = createCollapsibleSection({
  label: "Selections",
  collapsed: false,
  content: document.querySelector("[data-selections-panel]"),
});
document.querySelector("[data-selections-mount]")?.appendChild(selectionsSection.section);

function currentSystemId() {
  return elements.systemSelect?.value || "";
}

// Which generator-property field Vault treats as the budget ceiling is a
// Vault tool preference, not System data — it's not game content, it's
// "which of this System's fields does Vault's own generator special-case,"
// so it lives in this browser's local storage (keyed per System), never in
// the System record edited in Loom. See common/docs/... — this replaced an
// earlier attempt that stored it on the System itself before being corrected.
const BUDGET_CEILING_BUCKET = "vault-settings";

// Both budgetCeilingField and abilityField below share this one merged
// per-System record (dataManager.getLocal/saveLocal replaces the whole
// record for a given (bucket, id) — writing one setting straight through
// saveLocal, as this used to, would silently wipe out the other one's
// already-saved value for that same System). Mirrors Forge's/Crucible's own
// getForgeSystemSettings+setForgeSystemSetting /
// getCrucibleSystemSettings+setCrucibleSystemSetting pattern exactly.
function getVaultSystemSettings(systemId) {
  if (!dataManager || !systemId) return {};
  return dataManager.getLocal(BUDGET_CEILING_BUCKET, systemId) || {};
}

function setVaultSystemSetting(systemId, key, value) {
  if (!dataManager || !systemId) return;
  const next = { ...getVaultSystemSettings(systemId), [key]: value };
  if (!next.budgetCeilingField && !next.abilityField) {
    dataManager.removeLocal(BUDGET_CEILING_BUCKET, systemId);
  } else {
    dataManager.saveLocal(BUDGET_CEILING_BUCKET, systemId, next);
  }
}

function getBudgetCeilingFieldPreference(systemId) {
  return getVaultSystemSettings(systemId).budgetCeilingField || "";
}

function setBudgetCeilingFieldPreference(systemId, fieldKey) {
  setVaultSystemSetting(systemId, "budgetCeilingField", fieldKey || "");
}

// Which object field is this System's ability/stat block — same per-System,
// per-browser tool preference shape as budgetCeilingField above, feeding
// loadAbilityFieldDefs' own preferredKey param instead of it always
// assuming a field literally named "abilities" (see
// feedback_settings_preference_with_guessed_default). Empty/unset falls
// through to loadAbilityFieldDefs' own shape-based guess.
function getAbilityFieldPreference(systemId) {
  return getVaultSystemSettings(systemId).abilityField || "";
}

function setAbilityFieldPreference(systemId, fieldKey) {
  setVaultSystemSetting(systemId, "abilityField", fieldKey || "");
}

async function populateSystemSelect() {
  const systems = await listAllSystems(dataManager);
  // Disabled, not just blank — a real System is required before anything
  // else in this tool is usable, so the picker shouldn't silently fall back
  // to whichever System happens to sort first (previously "Blades in the
  // Dark"). Once a real System is chosen this option can't be reselected.
  renderRequiredSelectOptions(elements.systemSelect, systems, { placeholder: "Select a System" });
  markRequiredControl(elements.systemSelect, Boolean(elements.systemSelect?.value));
  return systems;
}

// Ownership metadata comes from the list response, not the full fetched
// body — mirrors Sanctum's refreshLocationCatalog/Crucible's
// refreshMonsterCatalog exactly. Local-only (anonymous, browser-storage)
// entries are always deletable, since it's just this browser's own storage.
async function refreshWonderCatalog(ids) {
  wonderCatalog = await refreshOwnershipCatalog(dataManager, "wonder", ids);
}

function wonderAllowsDelete(id) {
  return allowsDelete(wonderCatalog, id, { dataManager });
}

// Every saved Wonder for the active System — same picker pattern as
// Crucible's Monster/Sanctum's Location: "New / unsaved" as the default so
// a fresh Generate Wonder keeps working exactly as before.
async function populateWonderSelect() {
  if (!elements.wonderSelect) return;
  const systemId = currentSystemId();
  wondersInSystem = systemId ? await listWondersForSystem(dataManager, systemId) : [];
  const sorted = [...wondersInSystem].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  renderOptionalSelectOptions(elements.wonderSelect, sorted, { previousValue: currentWonderId || "" });
  await refreshWonderCatalog(wondersInSystem.map((wonder) => wonder.id));
  updateGenerationFieldsVisibility();
}

// Casting Class/Property overrides/Signature Feature/Locked Features only
// matter for generating something new — once an existing Wonder is loaded
// they're just clutter (same convention Sanctum/Crucible/Forge's own
// generation fields follow). Purely visual: hiding never clears an
// override's underlying value.
function updateGenerationFieldsVisibility() {
  elements.generationFields?.classList.toggle("d-none", Boolean(elements.wonderSelect?.value));
}

// Signature Feature is an optional override — blank = "Random" — exactly like
// Crucible's Creature Type/Archetype/Role/signature Feature selects.
function populateOverrideSelect(select, entries, blankLabel) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = blankLabel;
  select.appendChild(blank);
  entries.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.name || entry.id;
    select.appendChild(option);
  });
  if (entries.some((entry) => entry.id === previous)) select.value = previous;
}

function populateLockedFeaturesSelect() {
  sharedPopulateLockedFeaturesCheckList(elements.lockedFeatures, features);
}

// One dropdown per System-defined property type — nothing here is
// hardcoded to "Rarity"/"Activation"/"Form" as concepts; whatever
// propertyTypes the active System defines is what gets rendered.
function populatePropertyOverrides() {
  if (!elements.propertyOverridesContainer) return;
  const previous = readPropertyOverrides();
  elements.propertyOverridesContainer.innerHTML = "";
  let formSelect = null;
  let spellLevelsWrapper = null;
  propertyTypes.forEach((propertyType) => {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-1";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold mb-0";
    label.textContent = propertyType.label || propertyType.id;
    const select = document.createElement("select");
    select.className = "form-select";
    select.dataset.propertyOverride = propertyType.id;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Random";
    select.appendChild(blank);
    (propertyType.values || []).forEach((value) => {
      const option = document.createElement("option");
      option.value = value.id;
      option.textContent = value.label || value.id;
      select.appendChild(option);
    });
    if (previous[propertyType.id] && Array.from(select.options).some((option) => option.value === previous[propertyType.id])) {
      select.value = previous[propertyType.id];
    }
    wrapper.append(label, select);
    elements.propertyOverridesContainer.appendChild(wrapper);
    if (propertyType.id === "form") formSelect = select;
    if (propertyType.id === "spellLevels") spellLevelsWrapper = wrapper;
  });
  // Spell Levels only means anything for a wonder whose Item Form IS
  // "Spell" (no physical vessel) — every other Form has its own real-world
  // shape instead. "Random" (the default, no override pinned) still shows
  // it, since generation could still land on Spell. See renderIdentity's
  // own matching check for the post-generation half of this.
  if (formSelect && spellLevelsWrapper) {
    const syncSpellLevelsVisibility = () => {
      spellLevelsWrapper.classList.toggle("d-none", Boolean(formSelect.value) && formSelect.value !== "spell");
    };
    formSelect.addEventListener("change", syncSpellLevelsVisibility);
    syncSpellLevelsVisibility();
  }
}

function readPropertyOverrides() {
  const overrides = {};
  if (!elements.propertyOverridesContainer) return overrides;
  Array.from(elements.propertyOverridesContainer.querySelectorAll("[data-property-override]")).forEach((select) => {
    if (select.value) overrides[select.dataset.propertyOverride] = select.value;
  });
  return overrides;
}

function createPlaceholderOption(label = "Select…") {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  return option;
}

function populateAddFeatureSelect() {
  if (!elements.addFeatureSelect) return;
  const selectedIds = new Set(currentRecord?.featureIds || []);
  elements.addFeatureSelect.innerHTML = "";
  elements.addFeatureSelect.appendChild(createPlaceholderOption());
  features
    .filter((feature) => !selectedIds.has(feature.id))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    .forEach((feature) => {
      const option = document.createElement("option");
      option.value = feature.id;
      option.textContent = feature.name || feature.id;
      elements.addFeatureSelect.appendChild(option);
    });
}

async function reloadReferenceData() {
  const systemId = currentSystemId();
  const budgetCeilingField = getBudgetCeilingFieldPreference(systemId);
  let fetchedFeatures;
  let objectFieldResult;
  [fetchedFeatures, propertyTypes, classes, objectFieldResult, abilityFieldDefs] = await Promise.all([
    listFeaturesForSystem(dataManager, systemId),
    // `|| undefined` (not the stored "" directly) so an unconfigured System
    // falls through to getSystemPropertyTypes's own guessBudgetCeilingFieldKey
    // guess (then "rarity" as the last resort) instead of resolving to no
    // ceiling field at all — mirrors Crucible's own combatScalingField/
    // creatureTypeField `|| undefined` call pattern.
    getSystemPropertyTypes(dataManager, systemId, budgetCeilingField || undefined),
    getSystemClasses(dataManager, systemId),
    listObjectFieldOptions(dataManager, systemId),
    loadAbilityFieldDefs(dataManager, systemId, getAbilityFieldPreference(systemId)),
  ]);
  objectFieldOptions = objectFieldResult.options;
  abilityFieldGuess = objectFieldResult.guessedKey;
  budgetCeilingFieldGuess = guessBudgetCeilingFieldKey(propertyTypes.map((propertyType) => propertyType.id));
  // The shared `feature` kind also holds Sanctum's location features and
  // Crucible's monster features (tagged accordingly) — filtered here, once,
  // so every consumer of the module-level `features` array (generateWonder,
  // and the Locked/Signature/Add-feature selects below) only ever sees
  // Vault's own spell/item ones. generateWonder already applied this same
  // matchesCategory filter internally, so this was really only ever visible
  // in the three UI pickers — confirmed the identical bug reported (and
  // just fixed) in Crucible's own equivalent pickers.
  features = fetchedFeatures.filter(matchesCategory);
  populatePropertyOverrides();
  populateCastingClassSelect();
  populateOverrideSelect(elements.signatureOverride, features, "Random");
  populateLockedFeaturesSelect();
  populateAddFeatureSelect();
  await populateWonderSelect();
}

// Optional override, blank = "Any class" (unconstrained) — same convention
// as Signature Feature/property overrides. Hidden entirely (not just empty)
// for a System with no "classes" field at all, matching how the Symbol Dice
// stepper only shows up for a System that actually declares one.
function populateCastingClassSelect() {
  if (!elements.castingClassSelect) return;
  const wrapper = elements.castingClassSelect.parentElement;
  if (!classes.length) {
    setElementVisible(wrapper, false);
    elements.castingClassSelect.innerHTML = "";
    return;
  }
  setElementVisible(wrapper, true, "flex");
  const previous = elements.castingClassSelect.value;
  elements.castingClassSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Any class";
  elements.castingClassSelect.appendChild(blank);
  classes.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    elements.castingClassSelect.appendChild(option);
  });
  if (classes.some((entry) => entry.id === previous)) {
    elements.castingClassSelect.value = previous;
  }
}

function featureLabel(id) {
  return sharedFeatureLabel(features, id);
}

function propertyValueLabel(propertyTypeId, valueId) {
  if (!valueId) return "(random)";
  const propertyType = propertyTypes.find((entry) => entry.id === propertyTypeId);
  const value = propertyType?.values?.find((entry) => entry.id === valueId);
  return value?.label || valueId;
}

// Editable — a select per property type, listing that type's own real
// values (Rarity/Activation/Item Form/...), matching how Crucible/Forge/
// Sanctum's own Identity fields are all directly editable post-generation
// rather than plain read-only text. Signature Feature is deliberately not
// included here — it's already shown, clearly labeled "Signature", on its
// own Feature's row at the top of the Features list, so repeating it here
// was redundant.
function renderIdentity(record) {
  if (!elements.identityFields) return;
  elements.identityFields.innerHTML = "";
  propertyTypes.forEach((propertyType) => {
    // Same "only means something for a bare Spell" reasoning as
    // populatePropertyOverrides' own pre-generation check — here Form is
    // always resolved to a concrete value (generation never leaves it
    // blank), so the check is exact: show only when it's actually "spell".
    if (propertyType.id === "spellLevels" && record.properties?.form !== "spell") return;
    elements.identityFields.appendChild(
      createFieldBox({
        key: propertyType.id,
        label: propertyType.label || propertyType.id,
        type: "select",
        value: record.properties?.[propertyType.id] || "",
        // A leading blank option — createFieldBox's own select only ever
        // sets `select.value` when a matching option is present (see its
        // own comment); with none of these `option.value`s ever "" before,
        // a wonder with no resolved value for this property type (a
        // markdown-imported mundane item has no rarity at all — confirmed
        // real: Alchemist's Fire, Elixir of Health) silently rendered
        // whatever the browser defaults an unselected <select> to — its
        // FIRST option, "Common" — indistinguishable from a wonder that
        // genuinely resolved to that value. Same "(random)"-style honesty
        // propertyValueLabel above already gives note-generation text.
        options: [{ value: "", label: "—" }, ...(propertyType.values || []).map((value) => ({ value: value.id, label: value.label || value.id }))],
        colClass: "col-6 col-md-3",
        editable: true,
        rerollable: true,
        dataAttr: "data-editable-property",
      })
    );
  });
}

// Recomputed fresh from whatever's currently selected — kept in sync with
// the shared computeBudget helper so the automatic generator and manual
// add/remove editing can never disagree about the running total.
function recomputeBudget(record) {
  const selectedFeatures = record.featureIds.map((id) => findById(features, id)).filter(Boolean);
  record.budget = computeBudget(selectedFeatures, record.properties, propertyTypes, record.featureTiers || {});
  return record.budget;
}

function renderBudget(record) {
  const budget = record.budget || recomputeBudget(record);
  if (elements.budgetTarget) elements.budgetTarget.textContent = String(budget.target);
  if (elements.budgetSpent) elements.budgetSpent.textContent = String(budget.spent);
  if (elements.budgetRemaining) {
    elements.budgetRemaining.textContent = String(budget.remaining);
    elements.budgetRemaining.classList.toggle("vault-budget-over", budget.remaining < 0);
  }
}

function selectFeatureRow(featureId) {
  Array.from(elements.featureList?.querySelectorAll("[data-feature-row]") || []).forEach((row) => {
    row.classList.toggle("vault-feature-selected", row.dataset.featureRow === featureId);
  });
  const feature = findById(features, featureId);
  selectedFeatureId = feature ? featureId : null;
  if (!feature) {
    elements.inspectorEmpty?.classList.remove("d-none");
    elements.inspectorDetail?.classList.add("d-none");
    return;
  }
  elements.inspectorEmpty?.classList.add("d-none");
  elements.inspectorDetail?.classList.remove("d-none");
  renderFeatureBasicInfo(feature);
  featureParamsEditor.renderFeatureParamsEditor(feature, elements.featureParamsEditor);
  if (elements.inspectorJson) elements.inspectorJson.textContent = JSON.stringify(feature, null, 2);
}

// Mirrors Crucible's own renderFeatureBasicInfo/updateFeatureBasicInfo
// exactly (crucible/js/app.js) — editable here only for a Feature marked
// Unique (Loom's own Scope field), same gating reasoning. In practice every
// one of Vault's own spell/item Features is shared across many Wonders by
// design (this whole atomic-Feature model exists specifically so they
// are), so these three fields read as permanently disabled here — Edit
// Feature (opens Loom) is the real editing path, exactly like Crucible's
// own non-unique Features already work today.
function renderFeatureBasicInfo(feature) {
  if (elements.featureBasicId) elements.featureBasicId.value = feature.id;
  if (elements.featureBasicName) elements.featureBasicName.value = feature.name || "";
  if (elements.featureBasicDescription) elements.featureBasicDescription.value = feature.description || "";
  if (elements.featureBasicBudgetCost) elements.featureBasicBudgetCost.value = String(feature.budgetCost ?? 0);

  const isUnique = feature.mechanics?.scope === "unique";
  [elements.featureBasicName, elements.featureBasicDescription, elements.featureBasicBudgetCost].forEach((field) => {
    if (field) field.disabled = !isUnique;
  });
  if (elements.editFeatureButton) elements.editFeatureButton.disabled = false;
}

// Saves straight through dataManager.save("feature", ...) — a Feature-
// record edit, not a Wonder-record one, so the Wonder's own dirty-
// gate/Save button don't apply, same immediate-save path Crucible's own
// version uses. description/mechanics.text kept in sync when both are
// plain strings, matching every prior migration this session's own
// convention for a plain "passive"/"active" Feature.
async function updateFeatureBasicInfo(feature, patch) {
  Object.assign(feature, patch);
  if ("description" in patch && feature.mechanics && typeof feature.mechanics.text === "string") {
    feature.mechanics.text = patch.description;
  }
  await dataManager.save("feature", feature.id, feature);
  renderFeatureList(currentRecord);
}

elements.featureBasicName?.addEventListener("change", () => {
  const feature = findById(features, selectedFeatureId);
  if (feature) updateFeatureBasicInfo(feature, { name: elements.featureBasicName.value });
});
elements.featureBasicDescription?.addEventListener("change", () => {
  const feature = findById(features, selectedFeatureId);
  if (feature) updateFeatureBasicInfo(feature, { description: elements.featureBasicDescription.value });
});
elements.featureBasicBudgetCost?.addEventListener("change", () => {
  const feature = findById(features, selectedFeatureId);
  if (!feature) return;
  const value = Math.max(0, Math.round(Number(elements.featureBasicBudgetCost.value)) || 0);
  elements.featureBasicBudgetCost.value = String(value);
  updateFeatureBasicInfo(feature, { budgetCost: value });
});

// A shared parameterized template's own live-computed description text —
// same "shared, number-free template Feature plus per-record data on the
// record" convention Crucible's weaponAttackDescriptionText/
// saveEffectDescriptionText (crucible/js/app.js) already use, for Vault's
// own new mechanics types (vault-feature-matching.js). `params.scaling.values`
// is a `{level: diceString}` map straight from the 5e API's own
// damage_at_slot_level/damage_at_character_level/heal_at_slot_level shape —
// the LOWEST level entry is the headline number, every other level becomes
// a trailing scaling note rather than picking just one (unlike a monster's
// own Recharge/Day frequency tiers, a spell's own slot level is chosen
// fresh at every cast, not a fixed property of this one Wonder record).
function scalingNoteText(scaling) {
  const entries = Object.entries(scaling?.values || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (entries.length < 2) return "";
  const label = scaling.by === "slot" ? "slot level" : "character level";
  return ` Scales by ${label}: ${entries.map(([level, dice]) => `${level} — ${dice}`).join(", ")}.`;
}

// feat.damage's own render — shared by every wonder (spell or item) whose
// own primary damage resolved cleanly (see vault-feature-matching.js's own
// `mechanic.kind === "damage"` fast path), not just spells, despite the
// scaling-ladder shape being far more common for a spell's own damage.
function damageDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const entries = Object.entries(params?.scaling?.values || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!entries.length) return feature.description || "";
  const [, baseDice] = entries[0];
  const damageType = params.damageType || "";
  const resolution =
    params.resolutionKind === "save"
      ? `Each target must make a ${params.saveAbility || ""} saving throw, taking ${baseDice} ${damageType} damage on a failure${params.saveEffect === "half" ? ", or half as much on a success" : ""}.`
      : `On a hit, the target takes ${baseDice} ${damageType} damage.`;
  const area = params.areaShape && params.areaSize ? ` Affects a ${params.areaSize}-foot ${params.areaShape}.` : "";
  return `${resolution}${area}${scalingNoteText(params.scaling)}`;
}

// Only reached for a NON-variant flat-bonus item (Ring of Protection) — a
// variant-family item (Weapon +1/+2/+3) is a Feature with `tiers` instead,
// whose own per-tier `mechanics.text` already carries the full sentence
// (see vault-feature-matching.js's own resolvePassiveBonusFeature), so
// featureDescriptionText's own tier-resolution below never reaches this.
function itemPassiveBonusDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params) return feature.description || "";
  return `You have a +${params.bonusValue} bonus to ${params.bonusTarget}.`;
}

// The generic clause-recognized Features below (vault-feature-matching.js's
// own CLAUSE_RECOGNIZERS) all share `mechanics.type: "active"` — the same
// generic type Vault's own pre-existing starter Features already use — so
// unlike item-passive-bonus they can't be told apart by TYPE alone (same
// reason feat.damage/feat.healing, despite being just as parameterized,
// are also dispatched by id below rather than a dedicated mechanics type).
// Dispatched by id instead, right below. Each of these
// still resolves its OWN tier text first when tiered (featureDescriptionText's
// own tier-resolution below runs before any of this is reached), so these
// functions only ever handle the tier-LESS compound-fact case (params
// carrying everything) or the independent-magnitude case with no tier
// currently selected — a genuinely tiered Feature with a real tier picked
// never reaches here at all.
// The four functions below all build ONE self-sufficient sentence combining
// this record's own tier (the magnitude — resistance/+2/Set to 19/...) with
// its own params (the "which X" — damage type/skill/ability). Previously
// the tier alone showed via a live <select> right in the Features list row
// and only the "which X" half needed spelling out here; now that the tier
// picker lives in the Inspector instead (feature-params-editor.js's own
// renderFeatureTierEditor), the list row's own description text is the
// ONLY place the tier's magnitude is visible at a glance, so every one of
// these has to say both halves plainly.
function damageModificationDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const tier = feature.tiers?.find((entry) => entry.id === record.featureTiers?.[feature.id]);
  if (!params?.damageType) return feature.description || "";
  const verb = tier?.id === "immunity" ? "Immune to" : tier?.id === "vulnerability" ? "Vulnerable to" : "Resistant to";
  return `${verb} ${params.damageType} damage.`;
}

function skillBonusDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const tier = feature.tiers?.find((entry) => entry.id === record.featureTiers?.[feature.id]);
  if (!params?.skill) return feature.description || "";
  const bonus = tier?.id === "advantage" ? "Advantage on" : tier?.shortName ? `A ${tier.shortName} bonus to` : "A bonus to";
  return `${bonus} ${params.skill} checks.`;
}

function abilityScoreIncreaseDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const tier = feature.tiers?.find((entry) => entry.id === record.featureTiers?.[feature.id]);
  if (!params?.ability) return feature.description || "";
  const ability = params.ability.charAt(0).toUpperCase() + params.ability.slice(1);
  if (tier?.id?.startsWith("set-")) return `Sets the ${ability} score to ${tier.shortName}.`;
  if (tier?.id?.startsWith("increase-")) return `Increases the ${ability} score by ${tier.shortName}.`;
  return `Applies to the ${ability} score.`;
}

function protectionBonusDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const tier = feature.tiers?.find((entry) => entry.id === record.featureTiers?.[feature.id]);
  const bonus = tier?.shortName || "a";
  const alsoSaves = params?.alsoSavingThrows ?? (params?.ac && params?.savingThrows);
  return alsoSaves ? `Grants ${bonus} bonus to AC and saving throws.` : `Grants ${bonus} bonus to AC.`;
}

function setAcDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.base) return feature.description || "";
  const modifier = params.modifier ? ` + the wearer's own ${params.modifier} modifier` : "";
  return `The wearer's own AC becomes ${params.base}${modifier}.`;
}

function acMinimumDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.minimum) return feature.description || "";
  return `The wearer's own AC can't be less than ${params.minimum}.`;
}

// `spellName`/`spellLevel` are one compound fact (never split into a tier —
// see feature-import-core.js's own module comment on why) — this Feature
// has no tiers at all, so this is the ONLY render path for it.
function castASpellDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.spellName) return feature.description || "";
  const level = params.spellLevel ? ` (${params.spellLevel})` : "";
  const dc = params.saveDC ? `, save DC ${params.saveDC}` : "";
  return `Casts ${params.spellName}${level}${dc}.`;
}

// `speedType`/`distance` are likewise one compound fact — no tiers.
function speedModificationDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.speedType) return feature.description || "";
  const distance = typeof params.distance === "number" ? `${params.distance} feet` : `equal to your ${params.distance}`;
  return `Grants a ${params.speedType} speed ${distance}.`;
}

// `damageDice`/`damageType` are one compound fact (like `feat.cast-a-spell`'s
// own spellName/spellLevel) — never split into a tier. `saveDC`/
// `saveAbility`/`saveEffect` are only present for the save-conditional
// shape (Arrow of Slaying: fails a save to take it in full, half on a
// success) — absent entirely for a plain unconditional grant (Flame Tongue).
function extraDamageDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.damageDice) return feature.description || "";
  const base = `Deals an extra ${params.damageDice} ${params.damageType || ""} damage`;
  // `saveAbility`, not `saveDC`, is the real "is this a save-conditional
  // clause at all" signal now — a spell's own save DC is never a literal
  // number in its own text (vault-feature-matching.js's own
  // `extra-damage` recognizer only ever sets `saveDC` when the source text
  // actually states one, but still sets `saveAbility`/`saveEffect` for a
  // spell's DC-less save clause).
  if (!params.saveAbility) return `${base} on a hit.`;
  const half = params.saveEffect === "half" ? ", or half as much on a success" : "";
  const dc = params.saveDC ? `DC ${params.saveDC} ` : "";
  return `${base} on a failed ${dc}${params.saveAbility} saving throw${half}.`;
}

function darkvisionDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.range) return feature.description || "";
  return `Grants darkvision out to ${params.range} feet.`;
}

// `curseText` is the curse's own specific drawback, preserved verbatim
// (see vault-feature-matching.js's own "Curse" clause dispatch) since the
// actual mechanic varies too much item to item to structure further.
function curseDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.curseText) return feature.description || "";
  return params.curseText;
}

function savingThrowAdvantageDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.against) return feature.description || "";
  return `Grants advantage on saving throws against ${params.against}.`;
}

// An item's own healing is usually one fixed value (`healingDice`); a
// spell's own healing usually scales instead (`scaling`, the same
// {by, values} ladder shape feat.damage's own render uses) — checked first
// since a record carrying both would mean the scaling ladder is the real
// data and healingDice is stale/redundant.
function healingDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const entries = Object.entries(params?.scaling?.values || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (entries.length) {
    const [, baseDice] = entries[0];
    return `Restores ${baseDice} hit points.${scalingNoteText(params.scaling)}`;
  }
  if (!params?.healingDice) return feature.description || "";
  return `Restores ${params.healingDice} hit points.`;
}

function attackerDisadvantageDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.attackType) return feature.description || "";
  const scope = params.attackType === "spell" ? "Spell attacks" : "Attacks";
  return `${scope} against the wearer are made with disadvantage.`;
}

// Mirrors Crucible's own multiattackDescriptionText (crucible/js/app.js) —
// the same Multiattack-shaped concept, applied to a menu of spells instead
// of a menu of attacks.
function spellMenuDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const spells = Array.isArray(params?.spells) ? params.spells : [];
  if (!spells.length) return feature.description || "";
  const list = spells.map((s) => (s.charges ? `${s.name} (${s.charges} charge${s.charges === 1 ? "" : "s"})` : s.name)).join(", ");
  const dc = params.saveDC ? ` Spells cast this way use a save DC of ${params.saveDC}.` : "";
  return `On activation, casts one of the following: ${list}.${dc}`;
}

function chargesDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.max) return feature.description || "";
  const recharge = params.rechargeFormula ? ` Regains ${params.rechargeFormula} expended charges daily at dawn.` : "";
  return `Has ${params.max} charges.${recharge}`;
}

function imposeConditionDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.condition) return feature.description || "";
  const duration = params.duration ? ` for ${params.duration}` : "";
  // `saveDC` is optional — a spell's own text never states a literal DC
  // (vault-feature-matching.js's own `impose-condition` recognizer only
  // sets it when the source text actually has one).
  const dc = params.saveDC ? `DC ${params.saveDC} ` : "";
  const trigger =
    params.trigger === "hit"
      ? "On a hit,"
      : params.trigger === "automatic"
        ? ""
        : `On a failed ${dc}${params.saveAbility || ""} saving throw,`;
  return `${trigger} the target becomes ${params.condition}${duration}.`.trim();
}

function speedIncreaseDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.mode) return feature.description || "";
  if (params.mode === "double") return "Doubles the wearer's own walking speed.";
  if (params.mode === "minimum") return `Sets the wearer's own walking speed to at least ${params.distance} feet.`;
  if (params.mode === "dash") return "Lets the wearer take the Dash action as a bonus action.";
  return `Increases the wearer's own walking speed by ${params.distance} feet.`;
}

function jumpIncreaseDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.multiplier) return feature.description || "";
  return `Multiplies the wearer's own jump distance by ${params.multiplier}.`;
}

function weaponProficiencyDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.weapons) return feature.description || "";
  return `Grants proficiency with ${params.weapons}.`;
}

function modifiesRollDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const rollType = params?.rollType || "roll";
  if (params?.mode === "bonus-die") {
    if (!params.die) return feature.description || "";
    const subtract = params.sign === "subtract";
    return `Rolls ${params.die} and ${subtract ? "subtracts it from" : "adds it to"} the ${rollType}.`;
  }
  if (!params?.value) return feature.description || "";
  return `Instead of rolling for a ${rollType} roll, the user can take ${params.value} on the die.`;
}

// `params` is null (not just missing `tool`) for the common "proficient
// with whatever tool this transforms into/represents" case (see the
// `tool-proficiency` clause recognizer, vault-feature-matching.js) — falls
// back to the shared Feature's own generic description text for that case,
// same convention every params-optional render function here already uses.
function toolProficiencyDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.tool) return feature.description || "";
  return `Grants proficiency with ${params.tool}.`;
}

function personalTeleportationDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.range) return feature.description || "";
  return `On activation, teleports the user (and everything worn/carried) to a familiar location within ${params.range} feet, on the same plane.`;
}

function vehicleDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.ac) return feature.description || "";
  return `AC ${params.ac}, ${params.hp} hit points.`;
}

function resourceProductionDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.resourceText) return feature.description || "";
  return `Produces ${params.resourceText}.`;
}

function obscurementDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.level) return feature.description || "";
  return `Fills an area with a ${params.level} cloud.`;
}

function detectionDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.detects) return feature.description || "";
  const range = params.range ? ` within ${params.range} ${params.rangeUnit || "feet"}` : "";
  return `Reveals the presence or direction of ${params.detects}${range}.`;
}

function createLightDarknessDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (params?.mode === "darkness") {
    if (!params.radius) return feature.description || "";
    return `Fills a ${params.radius}-foot-radius sphere with magical darkness.`;
  }
  if (!params?.dimRadius && !params?.brightRadius) return feature.description || "";
  if (params.brightRadius) return `Sheds bright light out to ${params.brightRadius} feet and dim light out to ${params.dimRadius} feet.`;
  return `Sheds dim light out to ${params.dimRadius} feet.`;
}

function lockControlDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.action) return feature.description || "";
  return `${params.action[0].toUpperCase()}${params.action.slice(1)}s a door, chest, or similar object.`;
}

function randomEffectDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const named = Array.isArray(params?.options) ? params.options : [];
  if (named.length) {
    const names = named.map((entry) => entry?.name).filter(Boolean);
    const residual = params?.optionCount ? `, plus ${params.optionCount} more (see its notes)` : "";
    return `Consult this Wonder's own table: ${names.join(", ")}${residual}.`;
  }
  if (!params?.optionCount) return feature.description || "";
  return `Consult this Wonder's own table (${params.optionCount} options) — see its notes.`;
}

function adhesiveManipulationDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.mode) return feature.description || "";
  return params.mode === "bond" ? "Bonds two objects together, near-permanently." : "Instantly dissolves an adhesive bond, including a magical one.";
}

function truesightDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.range) return feature.description || "";
  return `Grants truesight out to ${params.range} feet.`;
}

function damageReductionDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.reductionDice) return feature.description || "";
  return `On a reaction, reduces damage from a hit by ${params.reductionDice}.`;
}

function forcedMovementDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.distance) return feature.description || "";
  return `Pushes the target ${params.distance} feet away.`;
}

function damageOverTimeDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.damageDice) return feature.description || "";
  return `The target takes ${params.damageDice} ${params.damageType || ""} damage at the start of each of its own turns, until ended.`;
}

function temporaryHitPointsDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.dice) return feature.description || "";
  return `Grants ${params.dice} temporary hit points.`;
}

function grantsAdvantageDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.rollType) return feature.description || "";
  return `Grants advantage on ${params.rollType}.`;
}

// Mirrors damageDescriptionText's own sentence shape, but every value
// here is the item's own literal fixed number (see vault-feature-
// matching.js's own CLAUSE_RECOGNIZERS "area-damage-save-half"/"-binary")
// rather than a caster-scaled `scaling` table — an item has no spell slot
// to scale by.
function areaDamageBurstDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  if (!params?.damageDice) return feature.description || "";
  const dc = params.saveDC ? `DC ${params.saveDC} ` : "";
  const rider = params.rider ? ` and ${params.rider}` : "";
  const half = params.saveEffect === "half" ? " On a success, a target takes half as much damage." : "";
  const area = params.areaShape && params.areaSize ? `In a ${params.areaSize}-foot ${params.areaShape}, e` : "E";
  return `${area}ach target must make a ${dc}${params.saveAbility || ""} saving throw, taking ${params.damageDice} ${params.damageType || ""} damage on a failure${rider}.${half}`;
}

// Featureless-param Features (no per-record data at all needed to render —
// "No Critical Hits"/"Water Breathing" always mean the same thing) just use
// their own shared static description, same as any plain "passive" Feature.
const FEATURE_ID_DESCRIPTION_TEXT = {
  "feat.damage-modification": damageModificationDescriptionText,
  "feat.skill-bonus": skillBonusDescriptionText,
  "feat.ability-score-increase": abilityScoreIncreaseDescriptionText,
  "feat.protection-bonus": protectionBonusDescriptionText,
  "feat.set-ac": setAcDescriptionText,
  "feat.ac-minimum": acMinimumDescriptionText,
  "feat.cast-a-spell": castASpellDescriptionText,
  "feat.speed-modification": speedModificationDescriptionText,
  "feat.darkvision": darkvisionDescriptionText,
  "feat.temporary-hit-points": temporaryHitPointsDescriptionText,
  "feat.area-damage-burst": areaDamageBurstDescriptionText,
  "feat.curse": curseDescriptionText,
  "feat.spell-menu": spellMenuDescriptionText,
  "feat.extra-damage": extraDamageDescriptionText,
  "feat.damage": damageDescriptionText,
  "feat.saving-throw-advantage": savingThrowAdvantageDescriptionText,
  "feat.healing": healingDescriptionText,
  "feat.attacker-disadvantage": attackerDisadvantageDescriptionText,
  "feat.charges": chargesDescriptionText,
  "feat.impose-condition": imposeConditionDescriptionText,
  "feat.speed-increase": speedIncreaseDescriptionText,
  "feat.jump-increase": jumpIncreaseDescriptionText,
  "feat.weapon-proficiency": weaponProficiencyDescriptionText,
  "feat.modifies-roll": modifiesRollDescriptionText,
  "feat.tool-proficiency": toolProficiencyDescriptionText,
  "feat.personal-teleportation": personalTeleportationDescriptionText,
  "feat.vehicle": vehicleDescriptionText,
  "feat.resource-production": resourceProductionDescriptionText,
  "feat.obscurement": obscurementDescriptionText,
  "feat.detection": detectionDescriptionText,
  "feat.create-light-darkness": createLightDarknessDescriptionText,
  "feat.lock-control": lockControlDescriptionText,
  "feat.random-effect": randomEffectDescriptionText,
  "feat.adhesive-manipulation": adhesiveManipulationDescriptionText,
  "feat.truesight": truesightDescriptionText,
  "feat.damage-reduction": damageReductionDescriptionText,
  "feat.forced-movement": forcedMovementDescriptionText,
  "feat.damage-over-time": damageOverTimeDescriptionText,
  "feat.grants-advantage": grantsAdvantageDescriptionText,
};

// Single entry point renderFeatureList (below) and any future selected-
// feature detail view call — resolves a selected tier's own text first
// (same priority Crucible's own renderFeatureList gives feature.tiers),
// then whichever live-computed text this Feature's own mechanics.type OR
// (for the generic `"active"` clause-recognized Features) own id needs,
// then the shared Feature's own static description for anything else (a
// plain "passive" Feature, or a record-scoped one-off created for a
// genuinely unrecognized spell/item clause).
function featureDescriptionText(feature, record, featureId) {
  const tier = feature?.tiers?.find((entry) => entry.id === record.featureTiers?.[featureId]);
  if (tier?.mechanics?.text) return tier.mechanics.text;
  const byId = FEATURE_ID_DESCRIPTION_TEXT[feature?.id];
  if (byId) return byId(feature, record);
  switch (feature?.mechanics?.type) {
    case "item-passive-bonus":
      return itemPassiveBonusDescriptionText(feature, record);
    default:
      // A pure tier ladder with no dedicated description function above
      // (Weapon Enhancement, Spell Attack Bonus, Ranged Damage Bonus,
      // General Bonus, Mending Pulse, ...) — the tier's own terse name
      // ("+2", "Superior") means nothing without the feature's own name
      // for context, unlike a monster's own self-descriptive tier names
      // (Crucible's "Legendary Resistance (3/Day)"), so it's prefixed
      // here rather than shown alone.
      return tier ? `${tier.name}${tier.shortName && tier.shortName !== tier.name ? ` (${tier.shortName})` : ""} — ${feature?.description || ""}` : feature?.description || "";
  }
}

function renderFeatureList(record) {
  if (!elements.featureList) return;
  // Disposed before the wipe — each row's own Remove button carries a real
  // tooltip now, and this reruns on every feature add/remove. See
  // tooltips.js's own BUG CLASS 2.
  disposeTooltips(elements.featureList);
  elements.featureList.innerHTML = "";
  record.featureIds.forEach((featureId) => {
    const feature = findById(features, featureId);
    const isSignature = featureId === record.signatureFeatureId;
    const cost = resolveFeatureBudgetCost(feature || {}, record.featureTiers || {});

    const row = document.createElement("div");
    row.className = "border rounded-3 p-2 d-flex align-items-start justify-content-between gap-2";
    row.dataset.featureRow = featureId;

    const info = document.createElement("div");
    info.className = "flex-grow-1";

    const header = document.createElement("div");
    header.className = "d-flex align-items-center gap-2 flex-wrap";
    // Hover-preview chip (library-reference.js), same suite-wide "displayed
    // inline wherever needed" primitive Character's own Features tab uses.
    header.appendChild(createReferenceChip({ kind: "feature", id: featureId, name: feature?.name || featureId, dataManager }));
    if (isSignature) {
      const badge = document.createElement("span");
      badge.className = "badge text-bg-primary";
      badge.textContent = "Signature";
      header.appendChild(badge);
    }
    const costBadge = document.createElement("span");
    costBadge.className = `badge ${cost < 0 ? "text-bg-success" : "text-bg-secondary"}`;
    costBadge.textContent = cost >= 0 ? `Cost ${cost}` : `Refund ${Math.abs(cost)}`;
    header.appendChild(costBadge);

    const description = document.createElement("div");
    description.className = "small text-body-secondary";
    description.textContent = feature ? featureDescriptionText(feature, record, featureId) : "";

    info.append(header, description);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn btn-outline-danger btn-sm flex-shrink-0";
    removeButton.setAttribute("aria-label", "Remove feature");
    removeButton.setAttribute("data-bs-toggle", "tooltip");
    removeButton.setAttribute("data-bs-title", "Remove feature");
    removeButton.innerHTML = '<span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>';
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeFeature(featureId);
    });

    row.append(info, removeButton);
    row.addEventListener("click", () => selectFeatureRow(featureId));
    elements.featureList.appendChild(row);
  });
  refreshTooltips(elements.featureList);
}

function refreshWonderView() {
  if (!currentRecord) return;
  renderFeatureList(currentRecord);
  renderBudget(currentRecord);
  populateAddFeatureSelect();
  jsonDataPanel.render();
  updateActionButtons();
}

// What Save/Export would actually write right now — name/notes only get
// synced from their input fields inside handleSave/handleExport themselves,
// so a live dirty-check needs this instead of reading currentRecord directly.
function buildRecordForSave() {
  if (!currentRecord) return null;
  return {
    ...currentRecord,
    name: elements.nameInput?.value || "",
    notes: elements.notesText?.value || "",
  };
}

function removeFeature(featureId) {
  if (!currentRecord) return;
  const feature = findById(features, featureId);
  recordHistory(`remove ${feature?.name || "feature"}`, () => {
    currentRecord.featureIds = currentRecord.featureIds.filter((id) => id !== featureId);
    if (currentRecord.signatureFeatureId === featureId) currentRecord.signatureFeatureId = null;
  });
  recomputeBudget(currentRecord);
  refreshWonderView();
}

function addFeature(featureId) {
  if (!currentRecord || !featureId) return;
  // A freshly added tiered feature starts at its own first (cheapest) tier
  // — same "always a real, well-defined tier" guarantee generateWonder's
  // own output gives — so the Inspector's own tier select (feature-params-
  // editor.js's renderFeatureTierEditor) always has something valid
  // selected rather than defaulting silently.
  const feature = findById(features, featureId);
  recordHistory(`add ${feature?.name || "feature"}`, () => {
    if (!currentRecord.featureIds.includes(featureId)) currentRecord.featureIds.push(featureId);
    if (Array.isArray(feature?.tiers) && feature.tiers.length) {
      currentRecord.featureTiers = { ...(currentRecord.featureTiers || {}) };
      if (!currentRecord.featureTiers[featureId]) currentRecord.featureTiers[featureId] = feature.tiers[0].id;
    }
  });
  recomputeBudget(currentRecord);
  refreshWonderView();
}

function readLockedFeatureIds() {
  return sharedReadLockedFeatureIds(elements.lockedFeatures);
}

function renderNotesPreview() {
  if (!elements.notesPreview) return;
  // Disposed before the wipe — a `` `date:...` `` reference or a missing
  // wiki-link inside Notes both carry real tooltips now, and this reruns on
  // every edit. See tooltips.js's own BUG CLASS 2.
  disposeTooltips(elements.notesPreview);
  elements.notesPreview.innerHTML = "";
  elements.notesPreview.appendChild(renderMarkdown(currentRecord?.notes || ""));
  refreshTooltips(elements.notesPreview);
}

function applyNotesMode(mode) {
  notesMode = mode;
  const isView = mode === "view";
  elements.notesText?.classList.toggle("d-none", isView);
  elements.notesPreview?.classList.toggle("d-none", !isView);
  // Showing the eye while in Edit mode (the icon describes what clicking
  // switches TO, not the current state) and vice versa — same convention
  // Repository's own toggle uses.
  elements.notesModeEyeIcon?.classList.toggle("d-none", isView);
  elements.notesModePencilIcon?.classList.toggle("d-none", !isView);
  if (elements.notesModeLabel) elements.notesModeLabel.textContent = isView ? "Edit" : "View";
  if (elements.notesModeToggle) updateTooltipContent(elements.notesModeToggle, isView ? "Edit" : "View");
  if (isView) renderNotesPreview();
}

function updateActionButtons() {
  const hasRecord = Boolean(currentRecord);
  if (elements.saveButton) elements.saveButton.disabled = !hasRecord || !dirtyGate.isDirty();
  if (elements.duplicateButton) elements.duplicateButton.disabled = !hasRecord;
  if (elements.deleteButton) {
    elements.deleteButton.disabled = !hasRecord || !dirtyGate.hasSaved() || !wonderAllowsDelete(currentWonderId);
  }
}

function renderWonder(record) {
  currentRecord = record;
  renderModeToggle();
  if (!record) {
    elements.emptyState?.classList.remove("d-none");
    elements.display?.classList.add("d-none");
    updateActionButtons();
    jsonDataPanel.render();
    if (mode === "relationships") void refreshRelationshipsSection();
    return;
  }
  elements.emptyState?.classList.add("d-none");
  elements.display?.classList.toggle("d-none", mode === "relationships");
  if (elements.nameInput) elements.nameInput.value = record.name || "";
  renderIdentity(record);
  renderFeatureList(record);
  renderBudget(record);
  populateAddFeatureSelect();
  if (elements.notesText) elements.notesText.value = record.notes || "";
  if (notesMode === "view") renderNotesPreview();
  elements.inspectorEmpty?.classList.remove("d-none");
  elements.inspectorDetail?.classList.add("d-none");
  updateActionButtons();
  jsonDataPanel.render();
  if (mode === "relationships") void refreshRelationshipsSection();
}

// --- Relationships -----------------------------------------------------
//
// Vault's own target-kind whitelist and type-suggestion vocabulary for the
// shared relationship-editor.js/relationship-graph.js modules — see that
// pair's own header comments for the full suite-wide mechanism, and Forge's
// own app.js for the first tool this pattern shipped on. Item/spell-
// flavored suggestions, not social or ecological ones — a Wonder's own
// natural relationships read differently than an NPC's or a Monster's.
const RELATIONSHIP_TARGET_KINDS = [
  { id: "npc", label: "NPC" },
  { id: "location", label: "Location" },
  { id: "monster", label: "Monster" },
  { id: "character", label: "Character" },
  { id: "wonder", label: "Wonder" },
];
const RELATIONSHIP_TYPE_SUGGESTIONS = [
  "Requires",
  "Counters",
  "Variant of",
  "Crafted from",
  "Found in",
];

// "wonder" (the existing Identity/Features/Notes card stack) or
// "relationships" (a full-pane List/Graph view over this Wonder's own
// relationship edges) — mutually exclusive Modes, switched by the
// suite-wide Mode toggle group (createModeToggleGroup) in the header row
// above the main pane, exactly mirroring Forge/Crucible/Sanctum's own split.
let mode = "wonder";
let relationshipsForceGraph = null;
let relationshipsIconByKind = {};

function renderModeToggle() {
  if (!elements.modeToggleMount) return;
  // Nothing to relate until a Wonder exists — disabled (not hidden) until
  // then, via createButtonCheckGroup's own disabled/tooltip option support
  // (ui-components.js), the same mechanism every other tool's Relationships
  // option now uses too (previously each hand-rolled an identical
  // post-render querySelector('input[value="relationships"]').disabled
  // patch — consolidated onto this one shared mechanism instead).
  createModeToggleGroup({
    container: elements.modeToggleMount,
    ariaLabel: "Vault view",
    options: [
      { value: "wonder", icon: "tabler:wand", label: "Wonder" },
      {
        value: "relationships",
        icon: "tabler:affiliate",
        label: "Relationships",
        disabled: !currentRecord,
        tooltip: currentRecord ? undefined : "Select or generate a Wonder first",
      },
    ],
    value: mode,
    onChange: (next) => setMode(next),
  });
}

function setMode(nextMode) {
  mode = nextMode;
  const isRelationships = mode === "relationships";
  elements.display?.classList.toggle("d-none", isRelationships || !currentRecord);
  elements.wonderRelationships?.classList.toggle("d-none", !isRelationships);
  renderModeToggle();
  if (isRelationships) void refreshRelationshipsSection();
}

function ensureRelationshipsForceGraph() {
  if (relationshipsForceGraph || !elements.relationshipsGraphContainer) return relationshipsForceGraph;
  relationshipsForceGraph = createForceGraph({
    container: elements.relationshipsGraphContainer,
    content: elements.relationshipsGraphContent,
    svg: elements.relationshipsGraphSvg,
    emptyMount: elements.relationshipsGraphEmpty,
    getNodeRadius: (node) => (node.kind === "wonder" && node.id === `wonder:${currentRecord?.id}` ? 20 : 14),
    getNodeIcon: (node) => relationshipsIconByKind?.[node.kind] || null,
    getEdgeLabel: (edge) => edge.type || null,
    classPrefix: "relationship-graph",
    emptyIcon: "tabler:affiliate",
    emptyMessage: "No relationships yet.",
    defaultZoom: 1.4,
  });
  elements.relationshipsGraphControls?.addEventListener("pointerdown", (event) => event.stopPropagation());
  [
    { icon: "tabler:zoom-out", label: "Zoom out", onClick: () => relationshipsForceGraph.zoomBy(-0.25) },
    { icon: "tabler:refresh", label: "Reset zoom", onClick: () => relationshipsForceGraph.reset() },
    { icon: "tabler:zoom-in", label: "Zoom in", onClick: () => relationshipsForceGraph.zoomBy(0.25) },
  ].forEach((config) => elements.relationshipsGraphToolbarMount?.appendChild(createIconButton(config)));
  return relationshipsForceGraph;
}

async function refreshRelationshipsList() {
  if (!elements.relationshipsListMount) return;
  // No Wonder loaded — clear rather than leave a stale prior Wonder's own
  // relationships on screen.
  if (!currentRecord?.id) {
    elements.relationshipsListMount.innerHTML =
      '<p class="small text-body-secondary mb-0">Select or generate a Wonder to see its relationships.</p>';
    return;
  }
  await renderRelationshipEditor({
    container: elements.relationshipsListMount,
    sourceKind: "wonder",
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
      nodes: [{ kind: "wonder", id: currentRecord.id, label: currentRecord.name || currentRecord.id }],
    });
    relationshipsIconByKind = iconByKind;
    forceGraph.setGraph({ nodes, edges });
  } catch (error) {
    status?.show?.("Unable to build the Relationships graph.", { type: "error" });
  }
}

async function refreshRelationshipsSection() {
  await refreshRelationshipsList();
  void refreshRelationshipsGraph();
}

renderModeToggle();

function handleGenerate() {
  // No readiness guard needed here — setGenerateButtonReadiness gives the
  // button a real `disabled` attribute whenever this would fail, and a
  // disabled button's click listener never fires at all (mouse or
  // keyboard), so this handler only ever runs when generation is genuinely
  // ready.
  try {
    const selectedClass = classes.find((entry) => entry.id === elements.castingClassSelect?.value);
    const generated = generateWonder(features, propertyTypes, {
      systemId: currentSystemId() || null,
      signatureFeatureId: elements.signatureOverride?.value || "",
      lockedFeatureIds: readLockedFeatureIds(),
      propertyOverrides: readPropertyOverrides(),
      allowedFeatureTags: selectedClass?.allowedFeatureTags || null,
    });
    const record = createWonderRecord(generated);
    dirtyGate.markDirty();
    // Freshly generated content is always unsaved, regardless of whichever
    // saved Wonder the picker previously pointed at — mirrors Crucible's
    // handleGenerate/Sanctum's handleGenerate resetting the same way.
    currentWonderId = null;
    if (elements.wonderSelect) elements.wonderSelect.value = "";
    updateGenerationFieldsVisibility();
    recordHistory("generate wonder", () => renderWonder(record));
    status?.show("Wonder generated.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to generate: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

async function handleSave() {
  if (!currentRecord || !dataManager) return;
  currentRecord.name = elements.nameInput?.value || "";
  currentRecord.notes = elements.notesText?.value || "";
  try {
    // Every Wonder save gets its remaining raw stats.mechanic (an imported
    // spell/item's own recognized structured mechanic, or unrecognized
    // stats.description) converted into a real Feature reference,
    // unconditionally — mirrors Crucible's own handleSave exactly (see
    // vault-feature-matching.js's own module comment). Loom's saveEntity
    // already does this for imports made through Loom; this save bypasses
    // saveEntity entirely (writes straight to dataManager.save), so it
    // needs the same call directly. Idempotent — hasConvertibleSpellItemStats
    // is false once nothing's left to convert (the converter deletes
    // record.stats once consumed), so this is a safe no-op on every
    // subsequent save of the same record.
    let conversionErrors = [];
    if (hasConvertibleSpellItemStats(currentRecord)) {
      const conversionResult = await convertSpellOrItemToFeatures(currentRecord, {
        dataManager,
        existingFeatures: features,
        wonderSlug: currentRecord.id,
      });
      conversionErrors = conversionResult?.errors || [];
    }
    // Default mode ("auto") matters here exactly like Crucible/Forge's save:
    // an anonymous GM saves locally to their own browser, a signed-in user
    // gets a real owned/shareable record — Vault has no whole-tool login gate.
    const exported = toPressExportShape(currentRecord);
    await dataManager.save("wonder", currentRecord.id, exported);
    dirtyGate.markClean(exported);
    currentWonderId = currentRecord.id;
    await populateWonderSelect();
    updateActionButtons();
    if (conversionErrors.length) {
      status?.show(
        `Saved, but ${conversionErrors.length} feature${conversionErrors.length === 1 ? "" : "s"} couldn't be converted (see console).`,
        { type: "warning", timeout: 5000 }
      );
    } else {
      status?.show("Saved.", { type: "success", timeout: 1500 });
    }
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

async function handleDelete() {
  if (!currentRecord || !dataManager || !dirtyGate.hasSaved() || !wonderAllowsDelete(currentWonderId)) return;
  const label = currentRecord.name || currentRecord.id;
  if (!confirmDelete({ label: `"${label}"` })) return;
  try {
    await dataManager.delete("wonder", currentRecord.id);
    status?.show("Deleted.", { type: "success", timeout: 1500 });
    dirtyGate.markDirty();
    currentWonderId = null;
    renderWonder(null);
    await populateWonderSelect();
  } catch (error) {
    status?.show(`Unable to delete: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

function handleExport() {
  if (!currentRecord) return;
  currentRecord.name = elements.nameInput?.value || "";
  currentRecord.notes = elements.notesText?.value || "";
  exportRecordAsJson(currentRecord, toPressExportShape);
}

function generateWonderId() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `won_${suffix}`;
}

function handleDuplicate() {
  if (!currentRecord) return;
  const source = buildRecordForSave();
  const duplicate = { ...source, id: generateWonderId(), name: `${source.name || "Wonder"} Copy` };
  dirtyGate.markDirty();
  currentWonderId = null;
  if (elements.wonderSelect) elements.wonderSelect.value = "";
  renderWonder(duplicate);
  status?.show("Duplicated — not yet saved.", { type: "info", timeout: 2000 });
}

async function handleGenerateNote() {
  const before = currentRecord ? recordSnapshot() : null;
  const success = await generateNoteForRecord({
    record: currentRecord,
    elements,
    status,
    generateNote: generateWonderNote,
    // Leave name blank rather than falling back to record.id here — an id
    // like "won_abc123" would look like a real name to the server and stop
    // it from suggesting one.
    buildRequestBody: (record) => {
      const propertySummary = {};
      propertyTypes.forEach((propertyType) => {
        const valueId = record.properties?.[propertyType.id];
        if (valueId) propertySummary[propertyType.label || propertyType.id] = propertyValueLabel(propertyType.id, valueId);
      });
      return {
        name: record.name || "",
        properties: propertySummary,
        signatureFeature: record.signatureFeatureId ? featureLabel(record.signatureFeatureId) : "",
        features: record.featureIds.map((featureId) => {
          const feature = findById(features, featureId);
          return { name: feature?.name || featureId, description: feature?.description || "" };
        }),
      };
    },
  });
  if (success) {
    if (before !== null) {
      const after = recordSnapshot();
      if (after !== before) undoStack.push({ label: "generate note", before, after });
    }
    if (notesMode === "view") renderNotesPreview();
    updateActionButtons();
  }
}

async function init() {
  const shell = initAppShell({
    namespace: "vault",
    storagePrefix: "undercroft.vault.undo",
    settingsSlotAttr: "data-vault-settings-slot",
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

  // Generate starts disabled (see its own toolbar definition above) —
  // recomputed once reloadReferenceData has actually resolved, from every
  // path that can reach "loading is done" below (the plain init cascade,
  // handleSystemSelectChange, or applyDeepLinkParams' own background Phase
  // 2). Proactively disables (with an explanatory tooltip, via the shared
  // setGenerateButtonReadiness helper) instead of unconditionally enabling —
  // getWonderGenerationBlockReason mirrors generateWonder's own eligible-
  // Features check, so this can never drift out of sync with what actually
  // happens on click.
  function updateGenerateButtonReadiness() {
    const reason = getWonderGenerationBlockReason(features, { systemId: currentSystemId() });
    setGenerateButtonReadiness(elements.generateButton, reason);
  }

  // Same dirty check updateActionButtons already uses for the Save button —
  // Vault had no guard at all against navigating/closing away from
  // unsaved edits (unlike Workbench, which already had this).
  window.addEventListener("beforeunload", (event) => {
    if (!currentRecord || !dirtyGate.isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  elements.generateButton?.addEventListener("click", handleGenerate);
  elements.saveButton?.addEventListener("click", handleSave);
  elements.deleteButton?.addEventListener("click", handleDelete);
  elements.duplicateButton?.addEventListener("click", handleDuplicate);
  elements.undoButton?.addEventListener("click", () => performUndo());
  elements.redoButton?.addEventListener("click", () => performRedo());
  elements.generateNoteButton?.addEventListener("click", handleGenerateNote);
  elements.addFeatureButton?.addEventListener("click", () => {
    const featureId = elements.addFeatureSelect?.value;
    if (featureId) addFeature(featureId);
  });
  // Changing a property value can change the budget (a ceiling-setting
  // property's own targetBudget, or any other property's cost) — recompute
  // it the same way add/removeFeature already do, not just re-render.
  elements.identityFields?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-editable-property]");
    if (!select || !currentRecord) return;
    const key = select.dataset.editableProperty;
    recordHistory(`edit ${key}`, () => {
      currentRecord.properties = { ...(currentRecord.properties || {}), [key]: select.value };
    });
    recomputeBudget(currentRecord);
    // Form's own value gates Spell Levels' visibility (see renderIdentity) —
    // only a Form change needs the whole Identity grid rebuilt to reflect
    // that; every other property just updates its own already-visible select.
    if (key === "form") renderIdentity(currentRecord);
    refreshWonderView();
  });
  // Per-property reroll button (createFieldBox's own `rerollable` option) —
  // same convention Forge's Identity/4D and Crucible's Identity fields use.
  // Unlike a manual select change, the picked value never touched the DOM,
  // so the Identity grid needs a full re-render (not just refreshWonderView)
  // to show it.
  elements.identityFields?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll-attribute]");
    if (!button || !currentRecord) return;
    const key = button.dataset.rerollAttribute;
    const propertyType = propertyTypes.find((entry) => entry.id === key);
    const pick = rerollPropertyValue(propertyType, currentRecord.properties?.[key]);
    if (!pick) return;
    recordHistory(`reroll ${key}`, () => {
      currentRecord.properties = { ...(currentRecord.properties || {}), [key]: pick.id };
    });
    recomputeBudget(currentRecord);
    renderIdentity(currentRecord);
    refreshWonderView();
  });
  // Named (not an inline listener) so the init flow below can also call
  // this directly when auto-selecting the active campaign group's own
  // System.
  async function handleSystemSelectChange() {
    markRequiredControl(elements.systemSelect, Boolean(elements.systemSelect.value));
    // A different System means any previously loaded Wonder (and the
    // reference data it was built from) is no longer relevant — same
    // reasoning as Crucible/Sanctum's own System change handlers.
    currentWonderId = null;
    renderWonder(null);
    await reloadReferenceData();
    updateGenerateButtonReadiness();
  }
  elements.systemSelect?.addEventListener("change", handleSystemSelectChange);

  elements.wonderSelect?.addEventListener("change", async () => {
    const id = elements.wonderSelect.value;
    currentWonderId = id || null;
    updateGenerationFieldsVisibility();
    if (!id) {
      renderWonder(null);
      return;
    }
    try {
      // preferLocal: false — `id` always comes from elements.wonderSelect,
      // populated by listWondersForSystem's own fetchKindEntriesWithIds
      // (`includeLocal: false`), so it's already guaranteed to be a
      // server-known wonder; defaulting to a local-preferring get() here
      // silently served a stale per-record snapshot whenever the server
      // copy changed after this browser's own local cache of it was first
      // populated (confirmed live: Arrow of Slaying's own corrected
      // featureIds never appeared in Vault after a direct data fix, even
      // though Loom's own equally-fresh fetch showed it immediately) — the
      // exact same bug fetchKindEntriesWithIds' own comment already
      // documents and fixes for the list-then-fetch-each path, just missed
      // at this single-record load path.
      const result = await dataManager.get("wonder", id, { preferLocal: false });
      if (!result?.payload) {
        status?.show("Unable to load that wonder.", { type: "error", timeout: 4000 });
        return;
      }
      // Not createWonderRecord — that function always stamps a fresh id and
      // createdAt (see wonder-schema.js), which is right for a NEW
      // generation but would silently rewrite an existing record's real
      // creation time on every load.
      renderWonder({ ...result.payload, id });
      dirtyGate.markClean(toPressExportShape(currentRecord));
      updateActionButtons();
    } catch (error) {
      status?.show(`Unable to load wonder: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });

  // Budget ceiling field picker, moved into a gear-icon Settings modal
  // (upper-left of the header) — same shared module and visual pattern
  // Repository's own Settings button already uses. getValue/setValue defer
  // straight to the per-System dataManager.getLocal/saveLocal preference
  // above rather than this module's own flat store (see tool-settings.js's
  // own comment on that option).
  initToolSettings({
    toolId: "vault",
    dataManager,
    status,
    title: "Vault Settings",
    definitions: () => [
      {
        key: "budgetCeilingField",
        type: "select",
        label: "Budget ceiling field",
        helpTopic: "vault.budgetCeilingField",
        // "(auto-detected)" on the guessed field's own option label — same
        // convention as abilityField below — plus a real "None" option so a
        // GM can explicitly force no ceiling field for a System that
        // genuinely wants every property type treated as pure spend.
        options: [
          { value: "", label: "None" },
          ...propertyTypes.map((propertyType) => ({
            value: propertyType.id,
            label:
              propertyType.id === budgetCeilingFieldGuess && !getBudgetCeilingFieldPreference(currentSystemId())
                ? `${propertyType.label || propertyType.id} (auto-detected)`
                : propertyType.label || propertyType.id,
          })),
        ],
        getValue: () => getBudgetCeilingFieldPreference(currentSystemId()) || budgetCeilingFieldGuess,
        setValue: async (fieldKey) => {
          setBudgetCeilingFieldPreference(currentSystemId(), fieldKey);
          await reloadReferenceData();
          if (currentRecord) {
            recomputeBudget(currentRecord);
            refreshWonderView();
          }
        },
      },
      {
        key: "abilityField",
        type: "select",
        label: "Ability field",
        helpTopic: "vault.abilityField",
        // No separate "Auto-detect" option — the guessed field (whichever
        // Object property guessAbilityFieldKey picked) IS the selected
        // value until the GM actually picks a different one, with " (auto-
        // detected)" on its own option label as the only indicator. Once a
        // real preference is stored (even re-picking the same field
        // explicitly), that suffix drops — see getValue below.
        options: objectFieldOptions.map((field) => ({
          value: field.key,
          label:
            field.key === abilityFieldGuess && !getAbilityFieldPreference(currentSystemId())
              ? `${field.label || field.key} (auto-detected)`
              : field.label || field.key,
        })),
        getValue: () => getAbilityFieldPreference(currentSystemId()) || abilityFieldGuess,
        setValue: async (fieldKey) => {
          setAbilityFieldPreference(currentSystemId(), fieldKey);
          await reloadReferenceData();
        },
      },
    ],
    // Queried live (not via `elements`, unlike everything else in this
    // object) because the header — and this mount point inside it — is now
    // built by initAppShell() itself, which runs after `elements` above is
    // already constructed; an eager query here would have captured null.
    mountButton: (button) => document.querySelector("[data-vault-settings-slot]")?.appendChild(button),
  });

  // Name/Notes aren't written back into currentRecord until Save/Export
  // actually runs (see buildRecordForSave) — without this, editing either
  // field wouldn't re-enable an already-saved record's Save button until
  // some unrelated re-render happened to call updateActionButtons() again.
  elements.nameInput?.addEventListener("input", () => {
    scheduleFieldCommit("edit name");
    updateActionButtons();
  });
  elements.nameInput?.addEventListener("keydown", flushFieldCommitOnUndoRedo);
  elements.nameInput?.addEventListener("change", () => commitFieldEdit());
  elements.notesText?.addEventListener("input", () => {
    scheduleFieldCommit("edit notes");
    updateActionButtons();
  });
  elements.notesText?.addEventListener("keydown", flushFieldCommitOnUndoRedo);
  elements.notesText?.addEventListener("change", () => commitFieldEdit());
  elements.notesModeToggle?.addEventListener("click", () => {
    // Notes isn't written back into currentRecord until Save/Export (see
    // buildRecordForSave) — switching to View needs the live textarea
    // value, not whatever was last saved, so it's synced here same as
    // Save/Export already does.
    if (currentRecord) currentRecord.notes = elements.notesText?.value || "";
    applyNotesMode(notesMode === "view" ? "edit" : "view");
  });

  document.querySelector("[data-json-mount]")?.appendChild(jsonDataPanel.section);

  // `?wonder=<id>` — a cross-tool deep link (Repository's own kind-reference
  // chips route here via KIND_TOOL_ROUTE, see repository/js/app.js), same
  // `?param=<id>`-read-at-bootstrap convention Orrery's own `?map=` and
  // Loom's own `?feature=` already establish. Vault has no Setting concept
  // (same as Crucible), so System alone is the scope. Dispatches a real
  // "change" event to actually load the wonder rather than duplicating
  // wonderSelect's own change-handler body a second time here.
  // Two-phase, not one straight-line await chain — same "show the linked
  // record first, load everything else in the background" fix Sanctum's
  // own deep link needed once a campaign had enough saved content for the
  // full System reference-data reload to be genuinely slow. Phase 1
  // (awaited, blocks return): render THIS wonder directly (reusing
  // renderWonder + the same dirty-baseline call wonderSelect's own change
  // handler makes — not that handler itself, since it reads the id off
  // wonderSelect.value, which has no matching <option> yet this early).
  // Phase 2 (fired but not awaited): the System reference-data reload
  // populates wonderSelect's own option list; a real "change" event
  // re-dispatched at the end puts the picker's own displayed selection in
  // sync.
  async function applyDeepLinkParams() {
    const params = new URLSearchParams(window.location.search);
    const wonderId = params.get("wonder");
    if (!wonderId) return false;
    try {
      const result = await dataManager.get("wonder", wonderId, { preferLocal: false });
      const payload = result?.payload || {};
      const targetSystemId = payload.systemIds?.[0] || null;
      // Phase 1 — the wonder itself, on screen as fast as one fetch allows.
      currentWonderId = wonderId;
      updateGenerationFieldsVisibility();
      renderWonder({ ...payload, id: wonderId });
      dirtyGate.markClean(toPressExportShape(currentRecord));
      updateActionButtons();
      // Phase 2 — deliberately not awaited here; runs after this function
      // has already returned `true`. NOT handleSystemSelectChange (which
      // resets currentWonderId and calls renderWonder(null) before its own
      // reloadReferenceData) — that wiped the wonder Phase 1 had ALREADY
      // rendered, leaving the screen blank for the ~700-record Wonder
      // catalog fetch's own full duration instead of just quietly finishing
      // in the background behind an already-correct view. Setting
      // systemSelect's own value directly and calling reloadReferenceData()
      // straight (same reference-data fetch, minus the reset) keeps Phase
      // 1's render on screen the whole time. wonderSelect's own value is set
      // without dispatching "change" for the same reason — the wonder is
      // already loaded and correctly shown; re-dispatching would only
      // re-fetch and re-render it a second time for no benefit.
      void (async () => {
        try {
          if (targetSystemId && elements.systemSelect) {
            elements.systemSelect.value = targetSystemId;
          }
          await reloadReferenceData();
          if (elements.wonderSelect) elements.wonderSelect.value = wonderId;
          updateGenerateButtonReadiness();
        } catch (error) {
          // Phase 1 already succeeded — a background failure here just
          // leaves the picker under-populated, not worth an error toast on
          // top of a page that's already showing real content. Generate
          // stays disabled in this case — reference data may never have
          // loaded, and clicking it would just throw straight back out.
        }
      })();
      return true;
    } catch (error) {
      status?.show("Unable to open the linked record.", { type: "error", timeout: 3000 });
      return false;
    }
  }

  // If a campaign group is active (the header's Campaign dropdown) and that
  // group has its own System assigned, default Vault's System select to it
  // — a real, GM-chosen fact about the campaign being played, not a guess —
  // to make mid-campaign generation faster. Falls through to the original
  // "nothing chosen yet" placeholder whenever there's no active group, or
  // its System isn't one this tool's own list actually contains. An
  // explicit `?wonder=` deep link always wins over both.
  const systems = await populateSystemSelect();
  const deepLinked = await applyDeepLinkParams();
  if (!deepLinked) {
    const groupContext = await resolveGroupContext(dataManager).catch(() => null);
    const defaultSystemId = pickGroupDefaultId(groupContext, "systemId", systems);
    if (defaultSystemId) {
      elements.systemSelect.value = defaultSystemId;
      await handleSystemSelectChange();
    } else {
      await reloadReferenceData();
    }
    renderWonder(null);
    // Both branches above resolve reference data for whatever System ended
    // up selected — safe to recompute readiness here regardless of which one
    // ran. The deepLinked === true case updates from inside its own Phase 2
    // background IIFE instead (applyDeepLinkParams above), once ITS
    // reference-data load actually finishes.
    updateGenerateButtonReadiness();
  }

  initHelpSystem();
  refreshTooltips();
}

init();
