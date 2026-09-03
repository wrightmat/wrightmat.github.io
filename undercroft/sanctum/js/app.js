import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls, escapeHtml } from "../../common/js/lib/auth-ui.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips, disposeTooltips, updateTooltipContent } from "../../common/js/lib/tooltips.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import {
  createJsonDataPanel,
  createToolbarButtonGroup,
  createCollapsibleSection,
  createIconButton,
  createEmptyStateCard,
  createCompactField,
  createFieldBox,
  createSearchableCheckList,
  createModeToggleGroup,
  createListRow,
} from "../../common/js/lib/ui-components.js";
import { createReferenceChip } from "../../common/js/lib/library-reference.js";
import {
  listLocationTypesForSystem,
  listLocationPurposesForSystem,
  listFeaturesForSystem,
  listResourcesForSystem,
  listSpeciesForSystem,
  listNpcsForSystem,
  listMonstersForSystem,
  listWondersForSystem,
  listSettingsForSystem,
  listLocationsForSetting,
} from "./lib/tables.js";
import { generateLocation, rerollAxis, matchesCategory } from "./lib/generator.js";
import { createLocationRecord, toPressExportShape } from "./lib/location-schema.js";
import { renderRelationshipEditor } from "../../common/js/lib/relationship-editor.js";
import { buildRelationshipGraph, fetchAllRelationships, saveRelationship, deleteRelationship } from "../../common/js/lib/relationship-graph.js";
import { createForceGraph } from "../../common/js/lib/graph-view.js";
import { generateLocationNote } from "./lib/llm-note.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
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
  setGenerateButtonReadiness,
} from "../../common/js/lib/generator-kit.js";
import { markRequiredControl } from "../../common/js/lib/dom.js";
import { resolveGroupContext, pickGroupDefaultId } from "../../common/js/lib/widgets/group-context.js";
import { openShop, closeShop, locationIsShop } from "../../common/js/lib/shop-transactions.js";
// Repository's own markdown renderer, reused for the Notes View mode — same
// as Crucible/Forge/Vault's own Notes preview.
import { renderMarkdown } from "../../repository/js/lib/markdown.js";

const ASSET_NEED_KINDS = ["resource", "npc", "monster", "wonder"];

let status = null;
let undoStack = null;
let performUndo = null;
let performRedo = null;
let dataManager = null;
let locationTypes = [];
let locationPurposes = [];
let features = [];
let resources = [];
let npcs = [];
let monsters = [];
let wonders = [];
let speciesOptions = [];
let environmentPropertyType = null;
let locationsInSetting = [];
let currentSettingId = null;
let currentLocationId = null;
let currentRecord = null;
// View/Edit toggle for the Notes box — same convention as Repository/
// Crucible/Forge/Vault's Notes toggle. Icon/label always describe what
// clicking switches TO. Defaults to "view" — read far more than edited,
// and markdown reads better rendered by default.
let notesMode = "view";
// Ownership metadata for Settings in the active System, used only for the
// Delete button's access gate — same rule/shape as Loom's
// systemAllowsDelete/libraryEntryAllowsDelete. Keyed by setting id.
let settingCatalog = new Map();
// "Clean" baseline for the Setting form — Save only lights up once the
// current fields actually differ from it, mirroring Loom's isDirty/
// markClean pattern for Systems.
let settingCleanSnapshot = null;
// Same idea for the Location record — established after loading an
// existing Location or right after a successful save, NOT after
// generating (freshly generated content is always unsaved/savable).
let locationCleanSnapshot = null;
// Ownership metadata for Locations in the current Setting, same role/shape
// as settingCatalog above.
let locationCatalog = new Map();

// Whole-record snapshot undo — same shape as Repository's own
// recordHistory/field-commit-debounce pair, reusing buildLocationSnapshot()
// (hoisted) so a Name/Notes edit (not synced onto currentRecord until Save/
// Export) is captured too. Generate Multi-Room is deliberately NOT wrapped
// — it's a bulk save of several NEW records straight to the server,
// nothing in-memory for undo to step through.
function recordSnapshot() {
  return JSON.stringify(buildLocationSnapshot());
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
  renderLocation(JSON.parse(json));
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

// Built and mounted before `elements` below queries for these buttons, so
// every selector/disabled-state call site elsewhere keeps working unchanged.
createToolbarButtonGroup([
  { action: "new", icon: "tabler:map-plus", label: "New Setting", attrs: { "data-new-setting": true } },
  { action: "save", label: "Save Setting", attrs: { "data-save-setting": true } },
  { action: "delete", label: "Delete Setting", disabled: true, attrs: { "data-delete-setting": true } },
]).forEach((button) => document.querySelector("[data-setting-toolbar-mount]")?.appendChild(button));
createToolbarButtonGroup([
  // One Generate button, not two — a room-count prompt (default 1) picks
  // which flow runs (handleGenerateAction): 1 room behaves like the old
  // single-location button, more than 1 runs the bulk multi-room flow
  // (auto-named parent + connected children, all saved immediately).
  // Starts disabled — nothing to generate FROM until the reference-data
  // load resolves; re-enabled by init() once that resolves.
  { action: "generate", icon: "tabler:map-2", label: "Generate", disabled: true, attrs: { "data-generate-location": true } },
  { action: "save", label: "Save", disabled: true, attrs: { "data-save-location": true } },
  { action: "duplicate", label: "Duplicate", disabled: true, attrs: { "data-duplicate-location": true } },
  { action: "delete", label: "Delete", disabled: true, attrs: { "data-delete-location": true } },
]).forEach((button) => document.querySelector("[data-location-toolbar-mount]")?.appendChild(button));
createToolbarButtonGroup([
  { action: "undo", label: "Undo", attrs: { "data-undo-location": true } },
  { action: "redo", label: "Redo", attrs: { "data-redo-location": true } },
]).forEach((button) => document.querySelector("[data-location-undo-toolbar-mount]")?.appendChild(button));
document.querySelector("[data-location-empty-state]")?.appendChild(
  createEmptyStateCard({
    message: "Nothing selected yet. Pick an existing Location above, or fill in the fields and click Generate.",
    variant: "inline",
  })
);

// Named data-field-mount (not data-inspector-mount) — that name is a
// separate bare marker for the Detail Inspector's collapsible wrapper; a
// keyed attribute of the same name would collide.
// replaceWith, not appendChild — an appended-into wrapper stays an
// empty-but-in-flow flex item even while hidden, silently spending a gap-3
// on both sides. Any class the static mount div carried is merged onto the
// built field first.
function mountField(key, element) {
  const mount = document.querySelector(`[data-field-mount="${key}"]`);
  if (!mount) return;
  if (mount.className) element.classList.add(...mount.classList);
  mount.replaceWith(element);
}

mountField("system-select", createCompactField({ type: "select", id: "sanctumSystemSelect", label: "System", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-system-select" }));
mountField(
  "setting-select",
  createCompactField({
    type: "select", id: "sanctumSettingSelect", label: "Setting", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-setting-select", helpTopic: "sanctum.setting",
  })
);
mountField("location-select", createCompactField({ type: "select", id: "sanctumLocationSelect", label: "Location", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-location-select" }));
mountField("type-override", createCompactField({ type: "select", id: "sanctumTypeOverride", label: "Type", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-type-override" }));
mountField("purpose-override", createCompactField({ type: "select", id: "sanctumPurposeOverride", label: "Purpose", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-purpose-override" }));
mountField("environment-override", createCompactField({ type: "select", id: "sanctumEnvironmentOverride", label: "Environment", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-environment-override" }));
mountField(
  "locked-features",
  createSearchableCheckList({
    id: "sanctumLockedFeatures", label: "Locked Features",
    dataAttr: "data-locked-features", helpTopic: "sanctum.lockedFeatures",
  })
);
// Same field-box style as Identity below (and Crucible's/Vault's/Forge's
// own Name box) — every tool's center-pane properties look and act the same.
mountField("location-name", createFieldBox({ key: "name", label: "Name", editable: true, colClass: null, dataAttr: "data-location-name" }));
mountField("setting-name", createCompactField({ type: "text", id: "sanctumSettingName", label: "Name", dataAttr: "data-setting-name" }));
mountField("setting-description", createCompactField({ type: "textarea", id: "sanctumSettingDescription", label: "Description", dataAttr: "data-setting-description", rows: 2 }));
mountField("calendar-days-per-week", createCompactField({ type: "number", id: "sanctumCalendarDaysPerWeek", label: "Days per week", dataAttr: "data-calendar-days-per-week", min: 0, step: 1 }));
mountField("calendar-epoch-label", createCompactField({ type: "text", id: "sanctumCalendarEpochLabel", label: "Epoch label", dataAttr: "data-calendar-epoch-label", placeholder: "e.g. YK" }));
mountField("calendar-starting-year", createCompactField({ type: "number", id: "sanctumCalendarStartingYear", label: "Starting year", dataAttr: "data-calendar-starting-year", step: 1 }));

const elements = {
  systemSelect: document.querySelector("[data-system-select]"),
  settingSelect: document.querySelector("[data-setting-select]"),
  newSettingButton: document.querySelector("[data-new-setting]"),
  deleteSettingButton: document.querySelector("[data-delete-setting]"),
  settingNameInput: document.querySelector("[data-setting-name]"),
  settingDescriptionInput: document.querySelector("[data-setting-description]"),
  saveSettingButton: document.querySelector("[data-save-setting]"),
  locationSelect: document.querySelector("[data-location-select]"),
  generationFields: document.querySelector("[data-generation-fields]"),
  deleteLocationButton: document.querySelector("[data-delete-location]"),
  typeOverride: document.querySelector("[data-type-override]"),
  purposeOverride: document.querySelector("[data-purpose-override]"),
  environmentOverride: document.querySelector("[data-environment-override]"),
  lockedFeatures: document.querySelector("[data-locked-features]"),
  locationRelationships: document.querySelector("[data-location-relationships]"),
  modeToggleMount: document.querySelector("[data-sanctum-mode-toggle-mount]"),
  relationshipsListMount: document.querySelector("[data-relationships-list-mount]"),
  relationshipsGraphWrap: document.querySelector("[data-relationships-graph-wrap]"),
  relationshipsGraphContainer: document.querySelector("[data-relationships-graph-container]"),
  relationshipsGraphContent: document.querySelector("[data-relationships-graph-content]"),
  relationshipsGraphSvg: document.querySelector("[data-relationships-graph-svg]"),
  relationshipsGraphControls: document.querySelector("[data-relationships-graph-controls]"),
  relationshipsGraphToolbarMount: document.querySelector("[data-relationships-graph-toolbar-mount]"),
  relationshipsGraphEmpty: document.querySelector("[data-relationships-graph-empty]"),
  generateButton: document.querySelector("[data-generate-location]"),
  saveButton: document.querySelector("[data-save-location]"),
  duplicateButton: document.querySelector("[data-duplicate-location]"),
  undoButton: document.querySelector("[data-undo-location]"),
  redoButton: document.querySelector("[data-redo-location]"),
  emptyState: document.querySelector("[data-location-empty-state]"),
  display: document.querySelector("[data-location-display]"),
  nameInput: document.querySelector("[data-location-name]"),
  identityFields: document.querySelector("[data-identity-fields]"),
  featureList: document.querySelector("[data-feature-list]"),
  addFeatureSelect: document.querySelector("[data-add-feature-select]"),
  addFeatureButton: document.querySelector("[data-add-feature-button]"),
  assetList: document.querySelector("[data-asset-list]"),
  addAssetKindSelect: document.querySelector("[data-add-asset-kind-select]"),
  addAssetEntitySelect: document.querySelector("[data-add-asset-entity-select]"),
  addAssetButton: document.querySelector("[data-add-asset-button]"),
  shopControls: document.querySelector("[data-shop-controls]"),
  shopStatus: document.querySelector("[data-shop-status]"),
  openShopButton: document.querySelector("[data-open-shop-button]"),
  closeShopButton: document.querySelector("[data-close-shop-button]"),
  needList: document.querySelector("[data-need-list]"),
  addNeedKindSelect: document.querySelector("[data-add-need-kind-select]"),
  addNeedEntitySelect: document.querySelector("[data-add-need-entity-select]"),
  addNeedButton: document.querySelector("[data-add-need-button]"),
  speciesWeightRows: document.querySelector("[data-species-weight-rows]"),
  speciesWeightTotal: document.querySelector("[data-species-weight-total]"),
  addSpeciesWeightButton: document.querySelector("[data-add-species-weight]"),
  settingSpeciesWeightRows: document.querySelector("[data-setting-species-weight-rows]"),
  settingSpeciesWeightTotal: document.querySelector("[data-setting-species-weight-total]"),
  addSettingSpeciesWeightButton: document.querySelector("[data-add-setting-species-weight]"),
  mixingCoefficientInput: document.querySelector("[data-mixing-coefficient]"),
  mixingCoefficientValue: document.querySelector("[data-mixing-coefficient-value]"),
  archetypeOverrideRows: document.querySelector("[data-archetype-override-rows]"),
  addArchetypeOverrideButton: document.querySelector("[data-add-archetype-override]"),
  fallbackNameRows: document.querySelector("[data-fallback-name-rows]"),
  addFallbackNameButton: document.querySelector("[data-add-fallback-name]"),
  daysPerWeekInput: document.querySelector("[data-calendar-days-per-week]"),
  weekdayNameRows: document.querySelector("[data-weekday-name-rows]"),
  addWeekdayNameButton: document.querySelector("[data-add-weekday-name]"),
  monthRows: document.querySelector("[data-month-rows]"),
  addMonthButton: document.querySelector("[data-add-month]"),
  moonCycleRows: document.querySelector("[data-moon-cycle-rows]"),
  addMoonCycleButton: document.querySelector("[data-add-moon-cycle]"),
  seasonRows: document.querySelector("[data-season-rows]"),
  addSeasonButton: document.querySelector("[data-add-season]"),
  epochLabelInput: document.querySelector("[data-calendar-epoch-label]"),
  startingYearInput: document.querySelector("[data-calendar-starting-year]"),
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
};

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

function slugify(name) {
  return (
    (name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "entity"
  );
}

function currentSystemId() {
  return elements.systemSelect?.value || "";
}

async function populateSystemSelect() {
  const systems = await listAllSystems(dataManager);
  // Disabled, not just blank — a real System is required before anything
  // else here is usable. Once chosen this option can't be reselected.
  renderRequiredSelectOptions(elements.systemSelect, systems, { placeholder: "Select a System" });
  markRequiredControl(elements.systemSelect, Boolean(elements.systemSelect?.value));
  return systems;
}

// --- Setting mini-editor (ported from Loom's Places panel) ------------------
async function populateSettingSelect(systemId) {
  if (!elements.settingSelect) return [];
  if (!systemId) {
    renderOptionalSelectOptions(elements.settingSelect, []);
    settingCatalog = new Map();
    markRequiredControl(elements.settingSelect, false);
    return [];
  }
  const settings = await listSettingsForSystem(dataManager, systemId);
  const sortedSettings = [...settings].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  // autoSelectSingle: true — a single available Setting gives a more
  // specific generation context with nothing lost by landing on it
  // automatically.
  renderOptionalSelectOptions(elements.settingSelect, sortedSettings, { autoSelectSingle: true });
  markRequiredControl(elements.settingSelect, Boolean(elements.settingSelect.value));
  await refreshSettingCatalog(settings.map((setting) => setting.id));
  // Returned (not just awaited) so init's active-group auto-default can
  // check the Setting it wants against what loaded, with no second fetch.
  return sortedSettings;
}

// Ownership metadata comes from the list response, not the full fetched
// body — same shape as Loom's own owner_id/owner_username/permissions
// cache for delete-gating. Local-only (anonymous, browser-storage) entries
// are always deletable.
async function refreshSettingCatalog(ids) {
  settingCatalog = await refreshOwnershipCatalog(dataManager, "setting", ids);
}

function settingAllowsDelete(id) {
  return allowsDelete(settingCatalog, id, { dataManager });
}

function createSettingSnapshot() {
  return {
    name: elements.settingNameInput?.value || "",
    description: elements.settingDescriptionInput?.value || "",
    // Cheap deep-compare via serialization, same as the plain string fields
    // above, just for a structured value.
    calendar: JSON.stringify(collectCalendarFromForm()),
    speciesWeights: JSON.stringify(collectSettingSpeciesWeightsFromForm()),
  };
}

function isSettingDirty() {
  if (!settingCleanSnapshot) return false;
  const current = createSettingSnapshot();
  return (
    settingCleanSnapshot.name !== current.name ||
    settingCleanSnapshot.description !== current.description ||
    settingCleanSnapshot.calendar !== current.calendar ||
    settingCleanSnapshot.speciesWeights !== current.speciesWeights
  );
}

// Requires an actual change (isSettingDirty) plus the minimum needed to
// save at all (a System and a non-empty name) — mirrors Loom's
// canSaveSystem exactly, just without the shared undo-stack machinery.
function canSaveSetting() {
  const name = (elements.settingNameInput?.value || "").trim();
  return Boolean(currentSystemId() && name) && isSettingDirty();
}

function canDeleteSetting() {
  return settingAllowsDelete(currentSettingId);
}

function updateSettingToolbarState() {
  if (elements.saveSettingButton) elements.saveSettingButton.disabled = !canSaveSetting();
  if (elements.deleteSettingButton) elements.deleteSettingButton.disabled = !canDeleteSetting();
}

function markSettingClean() {
  settingCleanSnapshot = createSettingSnapshot();
  updateSettingToolbarState();
}

function populateSettingForm(entity) {
  if (elements.settingNameInput) elements.settingNameInput.value = entity?.name || "";
  if (elements.settingDescriptionInput) elements.settingDescriptionInput.value = entity?.description || "";
  populateCalendarForm(entity?.calendar || null);
  populateSettingSpeciesWeights(entity);
  markSettingClean();
}

async function loadSettingIntoForm(id) {
  if (!id) {
    populateSettingForm(null);
    return;
  }
  try {
    // preferLocal: false — a Setting's own Species Weights (and everything
    // else edited here) must be visible immediately, not hidden behind a
    // stale local cache, same class of staleness Vault's/Crucible's own
    // System reads already guard against.
    const result = await dataManager.get("setting", id, { preferLocal: false });
    populateSettingForm(result?.payload || null);
  } catch (error) {
    populateSettingForm(null);
  }
}

// Every "Parent of"/"Connected to" `relationship` record touching a
// location:* id, PLUS any not-yet-migrated legacy value still sitting on a
// location's own raw parentId/connectedTo fields, turned into real
// relationship records the first time they're seen. Idempotent — checked
// against the current edge set before creating anything, so a Setting with
// nothing left to migrate does zero writes. This is what makes "no
// separate Sanctum relationship concept" true for EXISTING campaign data,
// not just newly authored ones.
async function migrateLegacyLocationRelationships(rawLocations) {
  const edges = await fetchAllRelationships(dataManager).catch(() => []);
  const existingKeys = new Set(
    edges
      .filter((edge) => edge.fromKind === "location" && edge.toKind === "location")
      .map((edge) => `${edge.fromId}|${edge.toId}|${edge.type}`)
  );
  const toCreate = [];
  rawLocations.forEach((location) => {
    if (location.parentId && location.parentId !== location.id) {
      const key = `${location.parentId}|${location.id}|Parent of`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        toCreate.push({ fromKind: "location", fromId: location.parentId, toKind: "location", toId: location.id, type: "Parent of" });
      }
    }
    (location.connectedTo || []).forEach((otherId) => {
      if (!otherId || otherId === location.id) return;
      // Connected To was always checked bidirectionally (A→B and B→A treated
      // as the same tie) — a single edge, either direction, satisfies both.
      if (existingKeys.has(`${location.id}|${otherId}|Connected to`) || existingKeys.has(`${otherId}|${location.id}|Connected to`)) return;
      existingKeys.add(`${location.id}|${otherId}|Connected to`);
      toCreate.push({ fromKind: "location", fromId: location.id, toKind: "location", toId: otherId, type: "Connected to" });
    });
  });
  if (toCreate.length) {
    await Promise.all(toCreate.map((edge) => saveRelationship(dataManager, edge).catch(() => {})));
  }
  return [...edges, ...toCreate];
}

// Attaches DERIVED parentId/connectedTo onto each location — the only
// source of truth for both, now that they're `relationship` records rather
// than fields on the Location itself. Every existing consumer
// (collectDescendantLocations, renameChildRoomsIfConfirmed) reads these two
// properties exactly as before; only WHERE the values come from changed.
function applyDerivedLocationHierarchy(rawLocations, edges) {
  const idSet = new Set(rawLocations.map((location) => location.id));
  return rawLocations.map((location) => {
    const parentEdge = edges.find(
      (edge) =>
        edge.fromKind === "location" &&
        edge.toKind === "location" &&
        edge.toId === location.id &&
        edge.type === "Parent of" &&
        idSet.has(edge.fromId)
    );
    const connectedTo = edges
      .filter(
        (edge) =>
          edge.fromKind === "location" &&
          edge.toKind === "location" &&
          edge.type === "Connected to" &&
          (edge.fromId === location.id || edge.toId === location.id)
      )
      .map((edge) => (edge.fromId === location.id ? edge.toId : edge.fromId))
      .filter((id) => idSet.has(id) && id !== location.id);
    return { ...location, parentId: parentEdge ? parentEdge.fromId : null, connectedTo };
  });
}

async function reloadLocationsForSetting(settingId) {
  const rawLocations = settingId ? await listLocationsForSetting(dataManager, settingId) : [];
  if (rawLocations.length) {
    const edges = await migrateLegacyLocationRelationships(rawLocations);
    locationsInSetting = applyDerivedLocationHierarchy(rawLocations, edges);
  } else {
    locationsInSetting = [];
  }
  populateLocationSelect();
  await refreshLocationCatalog(locationsInSetting.map((location) => location.id));
  updateActionButtons();
}

// Same shape/reasoning as refreshSettingCatalog above.
async function refreshLocationCatalog(ids) {
  locationCatalog = await refreshOwnershipCatalog(dataManager, "location", ids);
}

function locationAllowsDelete(id) {
  return allowsDelete(locationCatalog, id, { dataManager });
}

function canDeleteLocation() {
  return locationAllowsDelete(currentLocationId);
}

// The Type/Purpose/Environment/Locked Features overrides only matter for
// generating something new — once an existing Location is loaded they're
// just clutter. Purely visual: hiding never clears an override's
// underlying value, so a pinned override still applies next time Generate
// runs (handleGenerate always resets the Location select back to blank,
// which is what brings this section back into view afterward).
function updateGenerationFieldsVisibility() {
  elements.generationFields?.classList.toggle("d-none", Boolean(elements.locationSelect?.value));
}

function populateLocationSelect() {
  // Deliberately NOT autoSelectSingle, unlike populateSettingSelect above
  // — Location is what Sanctum GENERATES, not just a scoping/context
  // picker. Auto-loading the sole existing Location the moment its Setting
  // resolves broke the "pick your System/Setting, hit Generate" flow.
  renderOptionalSelectOptions(elements.locationSelect, locationsInSetting);
  updateGenerationFieldsVisibility();
}


// --- Reference data (location-type/location-purpose/feature/resource/species/npc/monster/wonder) ----
async function reloadReferenceData() {
  const systemId = currentSystemId();
  let fetchedFeatures;
  [locationTypes, locationPurposes, fetchedFeatures, resources, npcs, monsters, wonders, speciesOptions] = await Promise.all([
    listLocationTypesForSystem(dataManager, systemId),
    listLocationPurposesForSystem(dataManager, systemId),
    listFeaturesForSystem(dataManager, systemId),
    listResourcesForSystem(dataManager, systemId),
    listNpcsForSystem(dataManager, systemId),
    listMonstersForSystem(dataManager, systemId),
    listWondersForSystem(dataManager, systemId),
    listSpeciesForSystem(dataManager, systemId),
  ]);
  // The shared `feature` kind also holds Crucible's/Vault's own features —
  // filtered here, once, so every consumer of the module-level `features`
  // array only ever sees Sanctum's own location ones (generateLocation
  // applies the same filter internally; this was only visible in the two
  // UI pickers below).
  features = fetchedFeatures.filter(matchesCategory);
  environmentPropertyType = await loadEnvironmentPropertyType(systemId);
  populateOverrideSelect(elements.typeOverride, locationTypes, "Random");
  populateOverrideSelect(elements.purposeOverride, locationPurposes, "Random");
  populateEnvironmentSelect(elements.environmentOverride, "Random");
  // Identity's own Type/Purpose/Environment (renderIdentity below) rebuild
  // their options fresh every render from these same lists — no separate
  // static population needed, unlike the override selects above.
  populateLockedFeaturesSelect();
  populateAddFeatureSelect();
  populateAssetNeedKindSelects();
}

// Environment is just the "environment"-keyed array field on the active
// System's `fields` (Loom's Properties editor) — no separate propertyTypes
// concept. Translated to the legacy {id, label, values: [{id, label}]}
// shape so the rest of this file needs no changes.
async function loadEnvironmentPropertyType(systemId) {
  if (!systemId) return null;
  try {
    const result = await dataManager.get("systems", systemId);
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const field = fields.find((entry) => entry.type === "array" && entry.key === "environment");
    if (!field) return null;
    return {
      id: field.key,
      label: field.label || field.key,
      values: (field.values || []).map((value) => ({ id: slugify(value.name), label: value.name })),
    };
  } catch (error) {
    return null;
  }
}

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

function populateEnvironmentSelect(select, blankLabel) {
  if (!select) return;
  const previous = select.value;
  const values = environmentPropertyType?.values || [];
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = values.length ? blankLabel : "(System defines no Environment property)";
  select.appendChild(blank);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value.id;
    option.textContent = value.label || value.id;
    select.appendChild(option);
  });
  select.disabled = !values.length;
  if (values.some((value) => value.id === previous)) select.value = previous;
}

function populateLockedFeaturesSelect() {
  if (!elements.lockedFeatures) return;
  const eligible = features.filter(
    (feature) => (feature.tags?.categories || []).includes("location") || !feature.tags?.categories?.length
  );
  sharedPopulateLockedFeaturesCheckList(elements.lockedFeatures, eligible);
}

function populateAddFeatureSelect() {
  if (!elements.addFeatureSelect) return;
  const selectedIds = new Set(currentRecord?.featureIds || []);
  elements.addFeatureSelect.innerHTML = "";
  elements.addFeatureSelect.appendChild(createPlaceholderOption());
  features
    .filter((feature) => !selectedIds.has(feature.id))
    .forEach((feature) => {
      const option = document.createElement("option");
      option.value = feature.id;
      option.textContent = feature.name || feature.id;
      elements.addFeatureSelect.appendChild(option);
    });
}

// Every kind an Asset/Need entry can reference is cached up front (mirroring
// how Features/Resources already are), so the entity picker and label/
// description lookups never need a separate on-demand fetch.
function entityListForKind(kind) {
  return { resource: resources, npc: npcs, monster: monsters, wonder: wonders }[kind] || [];
}

function populateAssetNeedKindSelects() {
  [elements.addAssetKindSelect, elements.addNeedKindSelect].forEach((select) => {
    if (!select) return;
    const previous = select.value;
    select.innerHTML = "";
    ASSET_NEED_KINDS.forEach((kind) => {
      const option = document.createElement("option");
      option.value = kind;
      option.textContent = kind[0].toUpperCase() + kind.slice(1);
      select.appendChild(option);
    });
    select.value = ASSET_NEED_KINDS.includes(previous) ? previous : "resource";
  });
  populateAddEntitySelect(elements.addAssetKindSelect?.value || "resource", elements.addAssetEntitySelect);
  populateAddEntitySelect(elements.addNeedKindSelect?.value || "resource", elements.addNeedEntitySelect);
}

// Shared by the Add-Feature/Add-Asset/Add-Need selects — an unselected
// leading option so the first real entry doesn't look pre-chosen before
// the GM has actually picked one.
function createPlaceholderOption(label = "Select…") {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  return option;
}

function populateAddEntitySelect(kind, select) {
  if (!select) return;
  select.innerHTML = "";
  select.appendChild(createPlaceholderOption());
  entityListForKind(kind).forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.name || entry.id;
    select.appendChild(option);
  });
}

// --- Location Properties (optional; ported verbatim from Loom's Places panel) ----
// rowsEl/totalEl are parameters (not always elements.speciesWeightRows/
// elements.speciesWeightTotal) so this same row editor backs both the
// per-Location Species Weights (more specific) and the per-Setting Species
// Weights (the general default a Location without its own weights falls
// back to — see Forge's own effectiveSpeciesLocation, forge/js/app.js).
function renderSpeciesWeightRow(rowsEl, totalEl, entry = { entityId: "", weight: 0 }) {
  if (!rowsEl) return;
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  const optionsHtml = speciesOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.id)}"${option.id === entry.entityId ? " selected" : ""}>${escapeHtml(option.name || option.id)}</option>`
    )
    .join("");
  row.innerHTML = `
    <select class="form-select" data-species-weight-select>
      <option value="">Select a species…</option>
      ${optionsHtml}
    </select>
    <input class="form-control" type="number" min="0" step="1" style="max-width: 6rem" value="${Number(entry.weight) || 0}" data-species-weight-value />
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-species-weight aria-label="Remove species">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  rowsEl.appendChild(row);
  updateSpeciesWeightTotal(rowsEl, totalEl);
}

function updateSpeciesWeightTotal(rowsEl, totalEl) {
  if (!rowsEl || !totalEl) return;
  const total = Array.from(rowsEl.querySelectorAll("[data-species-weight-value]")).reduce(
    (sum, input) => sum + (Number(input.value) || 0),
    0
  );
  totalEl.textContent = `Total: ${total}`;
}

function renderArchetypeOverrideRow(roll = "", name = "") {
  if (!elements.archetypeOverrideRows) return;
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  row.innerHTML = `
    <input class="form-control" style="max-width: 6rem" type="text" placeholder="Roll" value="${escapeHtml(roll)}" data-archetype-override-roll />
    <input class="form-control" type="text" placeholder="Archetype name" value="${escapeHtml(name)}" data-archetype-override-name />
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-archetype-override aria-label="Remove override">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  elements.archetypeOverrideRows.appendChild(row);
}

function renderFallbackNameRow(entry = { name: "", weight: "" }) {
  if (!elements.fallbackNameRows) return;
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  const name = typeof entry === "string" ? entry : entry.name || "";
  const weight = typeof entry === "string" ? "" : entry.weight ?? "";
  row.innerHTML = `
    <input class="form-control" type="text" placeholder="Name" value="${escapeHtml(name)}" data-fallback-name />
    <input class="form-control" type="number" min="0" step="1" style="max-width: 6rem" placeholder="Weight" value="${escapeHtml(weight)}" data-fallback-weight />
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-fallback-name aria-label="Remove name">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  elements.fallbackNameRows.appendChild(row);
}

function populateNpcConfigForm(record) {
  if (elements.mixingCoefficientInput) {
    elements.mixingCoefficientInput.value = record?.mixingCoefficient ?? 0.2;
    if (elements.mixingCoefficientValue) {
      elements.mixingCoefficientValue.textContent = Number(elements.mixingCoefficientInput.value).toFixed(2);
    }
  }
  if (elements.speciesWeightRows) {
    elements.speciesWeightRows.innerHTML = "";
    (record?.speciesWeights || []).forEach((entry) => renderSpeciesWeightRow(elements.speciesWeightRows, elements.speciesWeightTotal, entry));
    updateSpeciesWeightTotal(elements.speciesWeightRows, elements.speciesWeightTotal);
  }
  if (elements.archetypeOverrideRows) {
    elements.archetypeOverrideRows.innerHTML = "";
    Object.entries(record?.archetypeOverrides || {}).forEach(([roll, override]) =>
      renderArchetypeOverrideRow(roll, override?.name || "")
    );
  }
  if (elements.fallbackNameRows) {
    elements.fallbackNameRows.innerHTML = "";
    (record?.genericNameFallback || []).forEach((entry) => renderFallbackNameRow(entry));
  }
}

// Shared by Location's own Species Weights (collectNpcConfigFromForm) and
// the Setting's general Species Weights (collectSettingSpeciesWeightsFromForm)
// — same row shape, same collection logic either way.
function readSpeciesWeightsFromRows(rowsEl) {
  return Array.from(rowsEl?.children || [])
    .map((row) => ({
      entityId: row.querySelector("[data-species-weight-select]").value,
      weight: Number(row.querySelector("[data-species-weight-value]").value) || 0,
    }))
    .filter((entry) => entry.entityId);
}

function collectNpcConfigFromForm() {
  const speciesWeights = readSpeciesWeightsFromRows(elements.speciesWeightRows);
  const archetypeOverrides = {};
  Array.from(elements.archetypeOverrideRows?.children || []).forEach((row) => {
    const roll = row.querySelector("[data-archetype-override-roll]").value.trim();
    const name = row.querySelector("[data-archetype-override-name]").value.trim();
    if (roll && name) archetypeOverrides[roll] = { name };
  });
  const genericNameFallback = Array.from(elements.fallbackNameRows?.children || [])
    .map((row) => {
      const name = row.querySelector("[data-fallback-name]").value.trim();
      const weight = row.querySelector("[data-fallback-weight]").value;
      if (!name) return null;
      return weight ? { name, weight: Number(weight) || 1 } : { name };
    })
    .filter(Boolean);
  return {
    mixingCoefficient: Number(elements.mixingCoefficientInput?.value) || 0,
    speciesWeights,
    archetypeOverrides,
    genericNameFallback,
  };
}

// --- Setting Properties: Species Weights (the general default a Location ---
// without its own weights falls back to — see Forge's effectiveSpeciesLocation)
function populateSettingSpeciesWeights(record) {
  if (!elements.settingSpeciesWeightRows) return;
  elements.settingSpeciesWeightRows.innerHTML = "";
  (record?.speciesWeights || []).forEach((entry) =>
    renderSpeciesWeightRow(elements.settingSpeciesWeightRows, elements.settingSpeciesWeightTotal, entry)
  );
  updateSpeciesWeightTotal(elements.settingSpeciesWeightRows, elements.settingSpeciesWeightTotal);
}

function collectSettingSpeciesWeightsFromForm() {
  return readSpeciesWeightsFromRows(elements.settingSpeciesWeightRows);
}

// --- Calendar (optional; read by the Dashboard Calendar widget) -------------
// Same row-editor shape as NPC Generation Config just above (editable
// per-row inputs, since these are freely-typed values, not references to
// other entities). A GM who never opens this section — or leaves it blank —
// saves a Setting with no `calendar` key at all; see hasCalendarContent
// below, checked at save time.
function renderWeekdayNameRow(name = "") {
  if (!elements.weekdayNameRows) return;
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  row.innerHTML = `
    <input class="form-control" type="text" placeholder="Weekday name" value="${escapeHtml(name)}" data-weekday-name />
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-weekday-name aria-label="Remove weekday">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  elements.weekdayNameRows.appendChild(row);
}

function renderMonthRow(entry = { name: "", days: 30 }) {
  if (!elements.monthRows) return;
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  row.innerHTML = `
    <input class="form-control" type="text" placeholder="Month name" value="${escapeHtml(entry.name || "")}" data-month-name />
    <input class="form-control" type="number" min="1" step="1" style="max-width: 6rem" placeholder="Days" value="${Number(entry.days) || 30}" data-month-days />
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-month aria-label="Remove month">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  elements.monthRows.appendChild(row);
}

function renderMoonCycleRow(entry = { name: "", days: 29 }) {
  if (!elements.moonCycleRows) return;
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  row.innerHTML = `
    <input class="form-control" type="text" placeholder="Moon name" value="${escapeHtml(entry.name || "")}" data-moon-cycle-name />
    <input class="form-control" type="number" min="1" step="1" style="max-width: 6rem" placeholder="Cycle days" value="${Number(entry.days) || 29}" data-moon-cycle-days />
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-moon-cycle aria-label="Remove moon">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  elements.moonCycleRows.appendChild(row);
}

// Same shape as renderMonthRow/renderMoonCycleRow — a name plus a length in
// days, cycling through the YEAR total (all Seasons' own `days` summed)
// rather than any one Month's or Moon's own cycle. Default length (91) is a
// plain quarter-of-a-360-day-year guess, same spirit as Month's/Moon's own
// defaults — just a starting number for a new row, never enforced.
function renderSeasonRow(entry = { name: "", days: 91 }) {
  if (!elements.seasonRows) return;
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  row.innerHTML = `
    <input class="form-control" type="text" placeholder="Season name" value="${escapeHtml(entry.name || "")}" data-season-name />
    <input class="form-control" type="number" min="1" step="1" style="max-width: 6rem" placeholder="Days" value="${Number(entry.days) || 91}" data-season-days />
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-season aria-label="Remove season">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  elements.seasonRows.appendChild(row);
}

function populateCalendarForm(calendar) {
  if (elements.daysPerWeekInput) elements.daysPerWeekInput.value = calendar?.daysPerWeek ?? "";
  if (elements.epochLabelInput) elements.epochLabelInput.value = calendar?.epochLabel || "";
  if (elements.startingYearInput) elements.startingYearInput.value = calendar?.startingYear ?? "";
  if (elements.weekdayNameRows) {
    elements.weekdayNameRows.innerHTML = "";
    (calendar?.weekdayNames || []).forEach((name) => renderWeekdayNameRow(name));
  }
  if (elements.monthRows) {
    elements.monthRows.innerHTML = "";
    (calendar?.months || []).forEach((entry) => renderMonthRow(entry));
  }
  if (elements.moonCycleRows) {
    elements.moonCycleRows.innerHTML = "";
    (calendar?.moonCycles || []).forEach((entry) => renderMoonCycleRow(entry));
  }
  if (elements.seasonRows) {
    elements.seasonRows.innerHTML = "";
    (calendar?.seasons || []).forEach((entry) => renderSeasonRow(entry));
  }
}

// Always returns a fully-shaped object (even all-empty) — that's what lets
// createSettingSnapshot diff it cheaply via JSON.stringify. Whether it's
// actually worth persisting is hasCalendarContent's own question, not this
// function's.
function collectCalendarFromForm() {
  return {
    daysPerWeek: Number(elements.daysPerWeekInput?.value) || 0,
    weekdayNames: Array.from(elements.weekdayNameRows?.children || [])
      .map((row) => row.querySelector("[data-weekday-name]").value.trim())
      .filter(Boolean),
    months: Array.from(elements.monthRows?.children || [])
      .map((row) => ({
        name: row.querySelector("[data-month-name]").value.trim(),
        days: Number(row.querySelector("[data-month-days]").value) || 0,
      }))
      .filter((entry) => entry.name && entry.days > 0),
    moonCycles: Array.from(elements.moonCycleRows?.children || [])
      .map((row) => ({
        name: row.querySelector("[data-moon-cycle-name]").value.trim(),
        days: Number(row.querySelector("[data-moon-cycle-days]").value) || 0,
      }))
      .filter((entry) => entry.name && entry.days > 0),
    seasons: Array.from(elements.seasonRows?.children || [])
      .map((row) => ({
        name: row.querySelector("[data-season-name]").value.trim(),
        days: Number(row.querySelector("[data-season-days]").value) || 0,
      }))
      .filter((entry) => entry.name && entry.days > 0),
    epochLabel: elements.epochLabelInput?.value.trim() || "",
    startingYear: Number(elements.startingYearInput?.value) || 0,
  };
}

function hasCalendarContent(calendar) {
  return Boolean(
    calendar.daysPerWeek ||
      calendar.weekdayNames.length ||
      calendar.months.length ||
      calendar.moonCycles.length ||
      calendar.seasons.length ||
      calendar.epochLabel ||
      calendar.startingYear
  );
}

// Features/Assets/Needs all look and function the same (including
// select-to-inspect) via ui-components.js's own shared createListRow, not
// a local duplicate — that shared version correctly renders a Feature's
// own hover-preview reference chip instead of stringifying it.
//
// Clears the selected-row highlight across every selectable list (only one
// thing is ever inspected at a time) and shows the given entity's full
// JSON in the right pane, or the empty state if there's nothing to show.
function selectInspectorEntry(row, entity) {
  [elements.featureList, elements.assetList, elements.needList].forEach((container) => {
    container?.querySelectorAll(".sanctum-row-selected").forEach((el) => el.classList.remove("sanctum-row-selected"));
  });
  if (!entity) {
    elements.inspectorEmpty?.classList.remove("d-none");
    elements.inspectorDetail?.classList.add("d-none");
    return;
  }
  row?.classList.add("sanctum-row-selected");
  elements.inspectorEmpty?.classList.add("d-none");
  elements.inspectorDetail?.classList.remove("d-none");
  if (elements.inspectorJson) elements.inspectorJson.textContent = JSON.stringify(entity, null, 2);
}

// --- Identity / Features / Assets / Needs / Relationships rendering --------
function featureLabel(id) {
  return sharedFeatureLabel(features, id);
}

// Type/Purpose/Environment as field boxes (same shared look Forge's/
// Crucible's/Vault's own Identity fields use) — editable selects, each with
// its own reroll button, rebuilt fresh every render the same way Crucible's/
// Vault's own renderIdentity work.
function renderIdentity(record) {
  if (!elements.identityFields) return;
  elements.identityFields.innerHTML = "";
  [
    {
      key: "typeId",
      label: "Type",
      value: record.typeId,
      options: locationTypes.map((entry) => ({ value: entry.id, label: entry.name || entry.id })),
    },
    {
      key: "purposeId",
      label: "Purpose",
      value: record.purposeId,
      options: locationPurposes.map((entry) => ({ value: entry.id, label: entry.name || entry.id })),
    },
    {
      key: "environment",
      label: "Environment",
      value: record.environment,
      options: (environmentPropertyType?.values || []).map((entry) => ({ value: entry.id, label: entry.label || entry.id })),
    },
  ].forEach(({ key, label, value, options }) => {
    elements.identityFields.appendChild(
      createFieldBox({
        key,
        label,
        type: "select",
        value: value || "",
        options: [{ value: "", label: "(none)" }, ...options],
        colClass: "col-6 col-md-4",
        editable: true,
        rerollable: true,
        dataAttr: "data-editable-identity",
      })
    );
  });
}

function renderFeatureList(record) {
  if (!elements.featureList) return;
  elements.featureList.innerHTML = "";
  record.featureIds.forEach((featureId) => {
    const feature = findById(features, featureId);
    const row = createListRow({
      title: createReferenceChip({ kind: "feature", id: featureId, name: feature?.name || featureId, dataManager }),
      description: feature?.description || "",
      onRemove: () => removeFeature(featureId),
      removeLabel: "Remove feature",
      onSelect: (row) => selectInspectorEntry(row, feature),
    });
    elements.featureList.appendChild(row);
  });
}

function removeFeature(featureId) {
  if (!currentRecord) return;
  const feature = findById(features, featureId);
  recordHistory(`remove ${feature?.name || "feature"}`, () => {
    currentRecord.featureIds = currentRecord.featureIds.filter((id) => id !== featureId);
  });
  refreshEditableLists();
}

function addFeature(featureId) {
  if (!currentRecord || !featureId) return;
  const feature = findById(features, featureId);
  recordHistory(`add ${feature?.name || "feature"}`, () => {
    if (!currentRecord.featureIds.includes(featureId)) currentRecord.featureIds.push(featureId);
  });
  refreshEditableLists();
}

function referenceLabel(kind, refId) {
  return findById(entityListForKind(kind), refId)?.name || refId;
}

function referenceDescription(kind, refId) {
  return findById(entityListForKind(kind), refId)?.description || "";
}

// `listKey` ("assets"|"needs") is which array on currentRecord the optional
// quantity input (below) mutates — both lists can carry one (a GM might
// want to know how much of a lacking Resource a place is short by, not
// only how much of a held one it has), left undefined/blank on any entry a
// GM doesn't touch. Sanctum's own "broad strokes, not a ledger" default
// (this tool's own CLAUDE.md) stays the norm except for entries a GM
// explicitly quantifies (shop stock — see shop-transactions.js's openShop,
// which only materializes quantified Assets into a shop's live inventory).
function renderReferenceList(container, entries, onRemove, { listKey } = {}) {
  if (!container) return;
  container.innerHTML = "";
  entries.forEach((entry, index) => {
    const entity = findById(entityListForKind(entry.kind), entry.refId);
    const description = entry.description || referenceDescription(entry.kind, entry.refId);
    // A Resource's own `price` (a documented freeform-JSON convention, see
    // undercroft/README.md's Code Conventions) is worth surfacing here so a
    // Shop-Feature Location's Asset list shows cost at a glance. Folded
    // into the shared description text rather than a new createListRow
    // column — the other kinds this row primitive renders have no price
    // concept.
    const price = entry.kind === "resource" ? entity?.price : null;
    const row = createListRow({
      title: `${entry.label || referenceLabel(entry.kind, entry.refId)} (${entry.kind})`,
      description: price ? [description, `Price: ${price}`].filter(Boolean).join(" — ") : description,
      onRemove: () => onRemove(index),
      removeLabel: "Remove",
      onSelect: (row) => selectInspectorEntry(row, entity || entry),
    });
    if (listKey) {
      const quantityInput = document.createElement("input");
      quantityInput.type = "number";
      quantityInput.min = "0";
      quantityInput.className = "form-control form-control-sm";
      quantityInput.style.width = "4.5rem";
      quantityInput.placeholder = "Qty";
      quantityInput.setAttribute("aria-label", `${entry.label || referenceLabel(entry.kind, entry.refId)} quantity`);
      if (Number.isFinite(entry.quantity)) quantityInput.value = String(entry.quantity);
      quantityInput.addEventListener("click", (event) => event.stopPropagation());
      quantityInput.addEventListener("change", () => {
        const raw = quantityInput.value.trim();
        recordHistory("set quantity", () => {
          if (raw === "") {
            delete currentRecord[listKey][index].quantity;
          } else {
            currentRecord[listKey][index].quantity = Math.max(0, Math.round(Number(raw)) || 0);
          }
        });
      });
      // Inserted before the row's own last child (createListRow's own
      // button group, holding Remove) so Remove stays rightmost.
      row.insertBefore(quantityInput, row.lastChild);
    }
    container.appendChild(row);
  });
}

function renderAssetsAndNeeds(record) {
  renderReferenceList(
    elements.assetList,
    record.assets || [],
    (index) => {
      recordHistory("remove asset", () => currentRecord.assets.splice(index, 1));
      refreshEditableLists();
    },
    { listKey: "assets" }
  );
  renderReferenceList(
    elements.needList,
    record.needs || [],
    (index) => {
      recordHistory("remove need", () => currentRecord.needs.splice(index, 1));
      refreshEditableLists();
    },
    { listKey: "needs" }
  );
}

function addAssetOrNeed(listKey, kind, refId) {
  if (!currentRecord || !refId) return;
  const entity = findById(entityListForKind(kind), refId);
  recordHistory(`add ${listKey === "assets" ? "asset" : "need"}`, () => {
    currentRecord[listKey].push({
      kind,
      refId,
      label: entity?.name || refId,
      description: entity?.description || "",
    });
  });
  refreshEditableLists();
}

// --- Shop (Open/Close, GM-only) ---------------------------------------------
//
// A shop's live inventory lives on the campaign Group as a Group Property
// (shop-transactions.js's own openShop/closeShop), not on the Location
// record — these controls just need to know which group is "active" for
// this session. resolveGroupContext is Sanctum's own existing mechanism
// (used above for default System/Setting picks), reused as-is and cached
// since it resolves to the same one group for the whole session.
let shopGroupIdPromise = null;
function loadShopGroupId() {
  if (!shopGroupIdPromise) {
    shopGroupIdPromise = resolveGroupContext(dataManager)
      .then((context) => context?.groupId || null)
      .catch(() => null);
  }
  return shopGroupIdPromise;
}

// Shown only when the selected Location carries feat.shop AND the viewer is
// a GM — matching every other GM-only control in the suite (dataManager.
// meetsTier convention). Sub-type Features (feat.shop-weapons, etc.) narrow
// what a shop sells, they don't gate whether Open/Close appears — only
// feat.shop itself does.
async function renderShopControls(record) {
  const controls = elements.shopControls;
  if (!controls) return;
  const isShop = locationIsShop(record?.featureIds);
  const isGm = dataManager?.meetsTier?.("gm");
  if (!isShop || !isGm) {
    controls.classList.add("d-none");
    return;
  }
  controls.classList.remove("d-none");
  const locationId = record.id;
  const groupId = await loadShopGroupId();
  if (currentRecord?.id !== locationId) return; // selection changed while awaiting
  if (!groupId) {
    if (elements.shopStatus) elements.shopStatus.textContent = "No active campaign group — select one to manage this shop.";
    elements.openShopButton?.classList.add("d-none");
    elements.closeShopButton?.classList.add("d-none");
    return;
  }
  const { propertyValues } = await dataManager.getGroupProperties(groupId).catch(() => ({ propertyValues: {} }));
  if (currentRecord?.id !== locationId) return; // selection changed while awaiting
  const shop = propertyValues?.[`shop:${locationId}`];
  const isOpen = !!(shop && Array.isArray(shop.items));
  if (elements.shopStatus) {
    elements.shopStatus.textContent = isOpen
      ? `Shop open — ${shop.items.length} item${shop.items.length === 1 ? "" : "s"} in stock.`
      : "Shop closed.";
  }
  elements.openShopButton?.classList.toggle("d-none", isOpen);
  elements.closeShopButton?.classList.toggle("d-none", !isOpen);
}

elements.openShopButton?.addEventListener("click", async () => {
  if (!currentRecord?.id) return;
  const groupId = await loadShopGroupId();
  if (!groupId) {
    status?.show("No active campaign group to open this shop in.", { type: "warning", timeout: 3000 });
    return;
  }
  try {
    await openShop({ dataManager, groupId, locationId: currentRecord.id });
    status?.show("Shop opened.", { type: "success", timeout: 1500 });
    await renderShopControls(currentRecord);
  } catch (error) {
    status?.show(`Unable to open shop: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

elements.closeShopButton?.addEventListener("click", async () => {
  if (!currentRecord?.id) return;
  const groupId = await loadShopGroupId();
  if (!groupId) return;
  const persistToLocation = window.confirm("Write the shop's final stock back onto this Location's Assets?");
  try {
    await closeShop({ dataManager, groupId, locationId: currentRecord.id, persistToLocation });
    status?.show("Shop closed.", { type: "success", timeout: 1500 });
    await renderShopControls(currentRecord);
  } catch (error) {
    status?.show(`Unable to close shop: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

// --- Relationships (Parent / Connected To / Children) -----------------------

// Every location in the current Setting whose parentId chain leads back to
// `locationId`, however deep — used by the delete handler to offer removing
// the whole subtree at once, not just direct children.
function collectDescendantLocations(locationId) {
  const descendants = [];
  const queue = [locationId];
  while (queue.length) {
    const id = queue.shift();
    locationsInSetting
      .filter((location) => location.parentId === id)
      .forEach((child) => {
        descendants.push(child);
        queue.push(child.id);
      });
  }
  return descendants;
}

// --- Relationships -----------------------------------------------------
//
// The suite-wide relationship graph — same shared relationship-editor.js/
// relationship-graph.js pair Forge/Crucible/Workbench use. Containment
// ("Parent of") and adjacency ("Connected to") are just two of this tool's
// own suggested types now, not a separate bespoke concept — Children needs
// no dedicated list, since an incoming "Parent of" edge from another
// Location already shows up in THIS Location's own list automatically,
// the same mechanism that makes Forge's Factions work with no special
// flag. locationsInSetting's own derived parentId/connectedTo still back
// the dungeon-rename cascade — this section is a separate, generic editor
// over the same underlying `relationship` records, not a competing source.
const RELATIONSHIP_TARGET_KINDS = [
  { id: "npc", label: "NPC" },
  { id: "location", label: "Location" },
  { id: "monster", label: "Monster" },
  { id: "character", label: "Character" },
];
const RELATIONSHIP_TYPE_SUGGESTIONS = [
  "Parent of",
  "Connected to",
  "Owned by",
  "Sacred to",
  "Haunted by",
  "Guarded by",
  "Home to",
  "Ruled by",
];

// "location" (the existing Identity/Features/Assets & Needs/NPC Config/
// Notes card stack) or "relationships" (a full-pane List/Graph view over
// this Location's own relationship edges) — mutually exclusive Modes,
// switched by the suite-wide Mode toggle group, mirroring Forge/Crucible/
// Repository's own split.
let mode = "location";
let relationshipsForceGraph = null;
let relationshipsIconByKind = {};

function renderModeToggle() {
  if (!elements.modeToggleMount) return;
  // Nothing to relate until a Location exists — disabled (not hidden)
  // until then, the same shared mechanism every other tool's Relationships
  // option now uses.
  createModeToggleGroup({
    container: elements.modeToggleMount,
    ariaLabel: "Sanctum view",
    options: [
      { value: "location", icon: "tabler:map-pin", label: "Location" },
      {
        value: "relationships",
        icon: "tabler:affiliate",
        label: "Relationships",
        disabled: !currentRecord,
        tooltip: currentRecord ? undefined : "Select or generate a Location first",
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
  elements.locationRelationships?.classList.toggle("d-none", !isRelationships);
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
    getNodeRadius: (node) => (node.kind === "location" && node.id === `location:${currentRecord?.id}` ? 20 : 14),
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
  // No Location loaded — clear rather than leave a stale prior Location's
  // relationships on screen.
  if (!currentRecord?.id) {
    elements.relationshipsListMount.innerHTML =
      '<p class="small text-body-secondary mb-0">Select or generate a Location to see its relationships.</p>';
    return;
  }
  await renderRelationshipEditor({
    container: elements.relationshipsListMount,
    sourceKind: "location",
    sourceId: currentRecord.id,
    targetKinds: RELATIONSHIP_TARGET_KINDS,
    typeSuggestions: RELATIONSHIP_TYPE_SUGGESTIONS,
    dataManager,
    status,
    onChange: () => {
      void refreshRelationshipsList();
      void refreshRelationshipsGraph();
      // A "Parent of"/"Connected to" edge just changed — re-derive so the
      // dungeon-generation rename cascade stays in sync immediately.
      void refreshLocationHierarchyFromRelationships();
    },
  });
}

async function refreshRelationshipsGraph() {
  const forceGraph = ensureRelationshipsForceGraph();
  if (!forceGraph || !currentRecord?.id) return;
  try {
    const { nodes, edges, iconByKind } = await buildRelationshipGraph(dataManager, {
      nodes: [{ kind: "location", id: currentRecord.id, label: currentRecord.name || currentRecord.id }],
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

// Re-derives locationsInSetting's own parentId/connectedTo from the current
// `relationship` records without a full Setting reload — cheap (one
// fetchAllRelationships call) and keeps collectDescendantLocations/
// renameChildRoomsIfConfirmed correct the moment a GM edits an edge through
// the generic Relationships editor above, not just after the next reload.
async function refreshLocationHierarchyFromRelationships() {
  if (!locationsInSetting.length) return;
  const edges = await fetchAllRelationships(dataManager).catch(() => []);
  locationsInSetting = applyDerivedLocationHierarchy(locationsInSetting, edges);
}

renderModeToggle();

// --- Full render / refresh ---------------------------------------------------

// The full "current state" of the Location, combining currentRecord's own
// live-mutated fields with whatever isn't synced into currentRecord until
// save time (Name/Notes/Setting/Parent/NPC config). Building this without
// mutating currentRecord lets the dirty-check compare "what would be saved
// right now" against the last saved/loaded baseline without actually
// performing a save.
function buildLocationSnapshot() {
  if (!currentRecord) return null;
  return {
    ...currentRecord,
    name: elements.nameInput?.value.trim() || "",
    notes: elements.notesText?.value || "",
    systemIds: currentSystemId() ? [currentSystemId()] : [],
    settingIds: (currentSettingId || elements.settingSelect?.value) ? [currentSettingId || elements.settingSelect.value] : [],
    ...collectNpcConfigFromForm(),
  };
}

function isLocationDirty() {
  if (!currentRecord) return false;
  // No baseline yet means this content has never been saved/loaded as-is
  // (e.g. a just-generated Location) — always considered savable.
  if (!locationCleanSnapshot) return true;
  try {
    return JSON.stringify(locationCleanSnapshot) !== JSON.stringify(buildLocationSnapshot());
  } catch (error) {
    return true;
  }
}

function canSaveLocation() {
  return Boolean(currentRecord) && isLocationDirty();
}

function markLocationClean() {
  locationCleanSnapshot = buildLocationSnapshot();
  updateActionButtons();
}

function renderNotesPreview() {
  if (!elements.notesPreview) return;
  // Disposed before the wipe — a date reference or missing wiki-link inside
  // Notes carries a real tooltip, and this reruns on every edit.
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
  // Icon describes what clicking switches TO, not the current state — same
  // convention as Repository's own toggle.
  elements.notesModeEyeIcon?.classList.toggle("d-none", isView);
  elements.notesModePencilIcon?.classList.toggle("d-none", !isView);
  if (elements.notesModeLabel) elements.notesModeLabel.textContent = isView ? "Edit" : "View";
  if (elements.notesModeToggle) updateTooltipContent(elements.notesModeToggle, isView ? "Edit" : "View");
  if (isView) renderNotesPreview();
}

function updateActionButtons() {
  const hasRecord = Boolean(currentRecord);
  if (elements.saveButton) elements.saveButton.disabled = !canSaveLocation();
  if (elements.duplicateButton) elements.duplicateButton.disabled = !hasRecord;
  if (elements.deleteLocationButton) elements.deleteLocationButton.disabled = !canDeleteLocation();
}

function refreshEditableLists() {
  if (!currentRecord) return;
  renderFeatureList(currentRecord);
  renderAssetsAndNeeds(currentRecord);
  populateAddFeatureSelect();
  jsonDataPanel.render();
  updateActionButtons();
  void renderShopControls(currentRecord);
}

function renderLocation(record) {
  currentRecord = record;
  renderModeToggle();
  if (!record) {
    locationCleanSnapshot = null;
    elements.emptyState?.classList.remove("d-none");
    elements.display?.classList.add("d-none");
    elements.shopControls?.classList.add("d-none");
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
  renderAssetsAndNeeds(record);
  populateAddFeatureSelect();
  void renderShopControls(record);
  populateNpcConfigForm(record);
  if (elements.notesText) elements.notesText.value = record.notes || "";
  if (notesMode === "view") renderNotesPreview();
  elements.inspectorEmpty?.classList.remove("d-none");
  elements.inspectorDetail?.classList.add("d-none");
  updateActionButtons();
  jsonDataPanel.render();
  if (mode === "relationships") void refreshRelationshipsSection();
}

function readLockedFeatureIds() {
  return sharedReadLockedFeatureIds(elements.lockedFeatures);
}

// --- Generate / Save / Export / Note ----------------------------------------

// The Generate button's own entry point — prompts for a room count (default
// "1", matching the old single-location button's behavior) and routes to
// whichever underlying flow that count calls for, rather than the GM
// picking between two separate buttons for what's really one decision.
// 1 room runs handleGenerate itself unchanged — NOT handleGenerateMultiRoom
// with roomCount=1, which would still produce a separate auto-saved parent
// shell plus one auto-saved, auto-named child room and a "Parent of" edge:
// a real behavior change from what a GM generating one simple Location has
// always gotten, not just the same result reached a different way.
function handleGenerateAction() {
  const roomCountInput = window.prompt("How many rooms should this generate?", "1");
  if (roomCountInput === null) return;
  const roomCount = Math.floor(Number(roomCountInput));
  if (!Number.isFinite(roomCount) || roomCount < 1) {
    status?.show("Enter a whole number of 1 or more.", { type: "warning", timeout: 2500 });
    return;
  }
  if (roomCount === 1) {
    handleGenerate();
  } else {
    void handleGenerateMultiRoom(roomCount);
  }
}

function handleGenerate() {
  // No Setting-selected guard needed — setGenerateButtonReadiness gives the
  // button a real `disabled` attribute whenever none is picked, and a
  // disabled button's click listener never fires, so this only runs once a
  // Setting is in effect.
  const settingId = currentSettingId || elements.settingSelect?.value;
  try {
    const generated = generateLocation(locationTypes, locationPurposes, features, resources, {
      systemId: currentSystemId() || null,
      settingId,
      typeId: elements.typeOverride?.value || "",
      purposeId: elements.purposeOverride?.value || "",
      environment: elements.environmentOverride?.value || "",
      environmentPropertyType,
      lockedFeatureIds: readLockedFeatureIds(),
    });
    // A fresh id, never the previously loaded Location's own — reusing it
    // (a leftover "regenerate in place" behavior) silently turned a Save
    // right after Generate into an overwrite of whatever was loaded before,
    // and left the Location select stuck on that old entry instead of
    // resetting to "New / Unsaved". Freshly generated content is always
    // unsaved regardless of whatever baseline a prior Location left behind.
    const record = createLocationRecord(generated, null);
    currentLocationId = null;
    if (elements.locationSelect) elements.locationSelect.value = "";
    updateGenerationFieldsVisibility();
    locationCleanSnapshot = null;
    recordHistory("generate location", () => renderLocation(record));
    status?.show("Location generated.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to generate: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

// Generates a parent Location plus a series of child Locations ("rooms" —
// could be a Complex's chambers, a Settlement's districts, or a market's
// stalls) and saves all of it immediately — every piece here is an
// existing Sanctum primitive, just orchestrated in a loop rather than the
// single, unsaved-into-the-editor record handleGenerate produces. Purpose
// is left free to vary per room — Environment is NOT: every room is pinned
// to the parent's own resolved Environment, since one physical place
// doesn't span multiple climates/terrains. An explicit Type/Purpose/
// Environment override, if set, applies to every room the same way it
// would to a plain handleGenerate() call — a deliberate pin, not a bug.
// `roomCount` is always >= 2 here — handleGenerateAction routes a count of
// 1 to handleGenerate() instead.
async function handleGenerateMultiRoom(roomCount) {
  const settingId = currentSettingId || elements.settingSelect?.value;
  if (!settingId) {
    status?.show("Select or save a Setting first.", { type: "warning", timeout: 2500 });
    return;
  }
  if (!dataManager) return;
  if (elements.generateButton) elements.generateButton.disabled = true;
  try {
    const genOptions = {
      systemId: currentSystemId() || null,
      settingId,
      typeId: elements.typeOverride?.value || "",
      purposeId: elements.purposeOverride?.value || "",
      environment: elements.environmentOverride?.value || "",
      environmentPropertyType,
      lockedFeatureIds: readLockedFeatureIds(),
    };

    const parentRecord = createLocationRecord(
      generateLocation(locationTypes, locationPurposes, features, resources, genOptions),
      null
    );
    // Purpose + Type, e.g. "Industry Settlement" — a real, descriptive
    // default tied to what was actually generated, rather than a fixed
    // literal implying every multi-room result is a dungeon.
    parentRecord.name =
      [findById(locationPurposes, parentRecord.purposeId)?.name, findById(locationTypes, parentRecord.typeId)?.name]
        .filter(Boolean)
        .join(" ") || "Location";
    await dataManager.save("location", parentRecord.id, toPressExportShape(parentRecord));

    // Rooms share the parent's own resolved Environment — pinned explicitly
    // here rather than left to each generateLocation call's own random
    // resolution, which previously let every room end up with an unrelated
    // Environment from the parent and from each other.
    const roomGenOptions = { ...genOptions, environment: parentRecord.environment || genOptions.environment };

    // A room's Type is also kept plausible relative to the parent's — see
    // the `scale` convention in undercroft/README.md's Location Type
    // conventions: a Region/Environment parent can have Complex/Structure/
    // Settlement rooms, but a Complex parent can't have a Region room.
    // Skipped when the parent's own Type has no `scale` set, so an
    // unscaled/custom Type taxonomy sees no behavior change.
    const parentTypeScale = findById(locationTypes, parentRecord.typeId)?.scale;
    const roomLocationTypes =
      typeof parentTypeScale === "number"
        ? locationTypes.filter((entry) => typeof entry.scale !== "number" || entry.scale <= parentTypeScale)
        : locationTypes;

    // Type + Purpose + Feature set identifies a room as a duplicate of
    // another sibling — two rooms with the exact same identity read as a
    // generation mistake, not a deliberate "twin rooms" choice. Assets/
    // Needs aren't part of this signature.
    function roomSignature(generated) {
      return `${generated.typeId || ""}|${generated.purposeId || ""}|${(generated.featureIds || []).slice().sort().join(",")}`;
    }
    const usedRoomSignatures = new Set();
    // Capped retries, not a guarantee — a small enough Type/Purpose/Feature
    // pool (or a large enough room count) can genuinely run out of distinct
    // combinations; this re-rolls when it easily can, and accepts a repeat
    // rather than looping forever once it can't.
    const MAX_ROOM_REROLLS = 8;

    const rooms = [];
    for (let index = 0; index < roomCount; index += 1) {
      let generated;
      let signature;
      for (let attempt = 0; attempt < MAX_ROOM_REROLLS; attempt += 1) {
        generated = generateLocation(roomLocationTypes, locationPurposes, features, resources, roomGenOptions);
        signature = roomSignature(generated);
        if (!usedRoomSignatures.has(signature)) break;
      }
      usedRoomSignatures.add(signature);
      const room = createLocationRecord(generated, null);
      // Prefaced with the parent's name — "Room 1" alone collides once more
      // than one multi-room Location exists in the same Setting.
      room.name = `${parentRecord.name} - Room ${index + 1}`;
      await dataManager.save("location", room.id, toPressExportShape(room));
      // Containment/adjacency are `relationship` records now, not fields on
      // the room itself — created AFTER the room's own save succeeds, since
      // a `relationship` record referencing a never-persisted id would be
      // an orphan. `room.id` is already stable (createLocationRecord stamps
      // it up front), so this is safe.
      await saveRelationship(dataManager, {
        fromKind: "location",
        fromId: parentRecord.id,
        toKind: "location",
        toId: room.id,
        type: "Parent of",
      });
      if (rooms.length) {
        // Branching-tree layout: mostly connects to the room just placed
        // (a snaking path), occasionally branches back to an earlier one —
        // simple to reason about, swappable for a different layout
        // algorithm later without touching room generation at all.
        const connectToPrevious = rooms.length === 1 || Math.random() < 0.6;
        const targetIndex = connectToPrevious ? rooms.length - 1 : Math.floor(Math.random() * (rooms.length - 1));
        await saveRelationship(dataManager, {
          fromKind: "location",
          fromId: room.id,
          toKind: "location",
          toId: rooms[targetIndex].id,
          type: "Connected to",
        });
      }
      rooms.push(room);
    }

    status?.show(`Generated "${parentRecord.name}" with ${roomCount} rooms.`, {
      type: "success",
      timeout: 2500,
    });
    await reloadLocationsForSetting(settingId);
    if (elements.locationSelect) elements.locationSelect.value = parentRecord.id;
    currentLocationId = parentRecord.id;
    renderLocation(parentRecord);
    markLocationClean();
  } catch (error) {
    status?.show(`Unable to generate: ${error.message}`, { type: "error", timeout: 4000 });
  } finally {
    // Not a plain `disabled = false` — restores the button through the same
    // readiness check every other path uses, so `.disabled`/tooltip state
    // stays correct even if a Setting stopped being valid mid-operation.
    updateGenerateButtonReadiness();
  }
}

// If `parentId`'s Location has direct children still following the
// "[Parent Name] - Room [n]" convention the multi-room Generate flow gives
// them, offers to re-prefix them to match a just-renamed parent. Only
// children whose name still starts with the OLD parent name are touched —
// a room the GM already renamed to something else no longer looks like it
// belongs to this convention.
async function renameChildRoomsIfConfirmed(parentId, previousName, newName) {
  const prefix = `${previousName} - `;
  const matchingChildren = locationsInSetting.filter(
    (location) => location.parentId === parentId && (location.name || "").startsWith(prefix)
  );
  if (!matchingChildren.length) return;
  const rename = window.confirm(
    `Rename ${matchingChildren.length} child location${matchingChildren.length === 1 ? "" : "s"} to match too? (e.g. "${matchingChildren[0].name}" → "${newName} - ${matchingChildren[0].name.slice(prefix.length)}")`
  );
  if (!rename) return;
  for (const child of matchingChildren) {
    try {
      // preferLocal: false — this reads-then-saves the child right back; a
      // stale local read here wouldn't just display wrong data, it would
      // silently overwrite that child's real, current server data with the
      // stale snapshot.
      const result = await dataManager.get("location", child.id, { preferLocal: false });
      const childRecord = createLocationRecord(result?.payload || {}, child.id);
      childRecord.name = `${newName} - ${child.name.slice(prefix.length)}`;
      await dataManager.save("location", child.id, toPressExportShape(childRecord));
    } catch (error) {
      // Best-effort — one failed child shouldn't block renaming the rest.
    }
  }
}

async function handleSave() {
  if (!currentRecord || !dataManager) return;
  const settingId = currentSettingId || elements.settingSelect?.value;
  if (!settingId) {
    status?.show("Select or save a Setting first.", { type: "warning", timeout: 2500 });
    return;
  }
  const name = elements.nameInput?.value.trim() || "";
  if (!name) {
    status?.show("Enter a Location name first.", { type: "warning", timeout: 2500 });
    return;
  }
  // Captured before currentRecord.name is overwritten below — Name isn't
  // live-synced into currentRecord until save time, so this is still the
  // last-saved/loaded value. Only an existing (already-saved) Location can
  // have children to rename.
  const previousName = currentRecord.name;
  const renaming = Boolean(currentLocationId) && previousName && previousName !== name;
  currentRecord.name = name;
  currentRecord.notes = elements.notesText?.value || "";
  // systemIds/settingIds (both plural) are the only System/Setting
  // association fields, matching every other Library kind's convention. A
  // Location only ever belongs to whichever one Setting is currently
  // selected here, so the array always holds exactly one entry today —
  // plural just future-proofs a place reachable from more than one Setting.
  currentRecord.systemIds = currentSystemId() ? [currentSystemId()] : [];
  currentRecord.settingIds = settingId ? [settingId] : [];
  Object.assign(currentRecord, collectNpcConfigFromForm());
  const id = currentLocationId || slugify(name);
  currentRecord.id = id;
  try {
    await dataManager.save("location", id, toPressExportShape(currentRecord));
    currentLocationId = id;
    status?.show("Saved.", { type: "success", timeout: 1500 });
    if (renaming) {
      await renameChildRoomsIfConfirmed(id, previousName, name);
    }
    await reloadLocationsForSetting(settingId);
    if (elements.locationSelect) elements.locationSelect.value = id;
    markLocationClean();
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

function handleExport() {
  if (!currentRecord) return;
  currentRecord.name = elements.nameInput?.value || "";
  currentRecord.notes = elements.notesText?.value || "";
  exportRecordAsJson(currentRecord, toPressExportShape);
}

function handleDuplicate() {
  if (!currentRecord) return;
  const source = buildLocationSnapshot();
  const duplicate = createLocationRecord({ ...source, name: `${source.name || "Location"} Copy` }, null);
  locationCleanSnapshot = null;
  currentLocationId = null;
  if (elements.locationSelect) elements.locationSelect.value = "";
  renderLocation(duplicate);
  status?.show("Duplicated — not yet saved.", { type: "info", timeout: 2000 });
}

async function handleGenerateNote() {
  const before = currentRecord ? recordSnapshot() : null;
  const success = await generateNoteForRecord({
    record: currentRecord,
    elements,
    status,
    generateNote: generateLocationNote,
    buildRequestBody: (record) => {
      const environmentLabel = record.environment
        ? environmentPropertyType?.values?.find((value) => value.id === record.environment)?.label || record.environment
        : "";
      return {
        name: record.name || "",
        typeLabel: record.typeId ? findById(locationTypes, record.typeId)?.name || record.typeId : "",
        purposeLabel: record.purposeId ? findById(locationPurposes, record.purposeId)?.name || record.purposeId : "",
        environmentLabel,
        features: record.featureIds.map((featureId) => {
          const feature = findById(features, featureId);
          return { name: feature?.name || featureId, description: feature?.description || "" };
        }),
        assets: (record.assets || []).map((entry) => entry.label || referenceLabel(entry.kind, entry.refId)),
        needs: (record.needs || []).map((entry) => entry.label || referenceLabel(entry.kind, entry.refId)),
      };
    },
  });
  // Programmatic .value assignment doesn't fire input/change, so the
  // delegated dirty-check listener won't see this — refresh explicitly.
  if (success) {
    if (before !== null) {
      const after = recordSnapshot();
      if (after !== before) undoStack.push({ label: "generate note", before, after });
    }
    if (notesMode === "view") renderNotesPreview();
    updateActionButtons();
  }
}

// --- Wiring ------------------------------------------------------------------
// Each section below adopts its own existing static `[data-xxx-panel]`
// markup (only the header+chevron wrapper is JS-built) as
// createCollapsibleSection's content. Notes keeps its "Generate Note"
// sibling button in static HTML (a shape createCollapsibleSection would
// clobber), so only its toggle button is built and mounted. Calendar is
// built before Setting Properties on purpose: Setting Properties adopts
// the whole `[data-setting-panel]` div, which contains Calendar's own
// mount point — Calendar has to already be migrated in place first.
function initCollapsibles() {
  document.querySelector("[data-inspector-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Inspector",
      collapsed: false,
      content: document.querySelector("[data-inspector-panel]"),
    }).section
  );

  document.querySelector("[data-identity-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Identity",
      helpTopic: "sanctum.identity",
      collapsed: false,
      content: document.querySelector("[data-identity-panel]"),
    }).section
  );

  document.querySelector("[data-features-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Features",
      helpTopic: "sanctum.features",
      collapsed: false,
      className: "d-flex flex-column gap-2",
      panelClassName: "d-flex flex-column gap-2",
      content: document.querySelector("[data-features-panel]"),
    }).section
  );

  document.querySelector("[data-assets-needs-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Assets & Needs",
      helpTopic: "sanctum.assets",
      collapsed: false,
      className: "d-flex flex-column gap-2",
      panelClassName: "d-flex flex-column gap-2",
      content: document.querySelector("[data-assets-needs-panel]"),
    }).section
  );

  document.querySelector("[data-npc-config-mount]")?.appendChild(
    createCollapsibleSection({
      // Renamed from "NPC Generation Config" per explicit feedback — a GM
      // looking to edit a Location's own settings couldn't find this
      // section under its old, narrower-sounding name. Content is
      // unchanged (still exactly the fields Forge reads to generate NPCs
      // here).
      label: "Properties",
      helpTopic: "sanctum.npcConfig",
      collapsed: true,
      className: "d-flex flex-column gap-2",
      panelClassName: "d-flex flex-column gap-3",
      content: document.querySelector("[data-npc-config-panel]"),
    }).section
  );

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

  document.querySelector("[data-setting-species-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Species Weights",
      helpTopic: "sanctum.settingSpeciesWeights",
      collapsed: true,
      className: "d-flex flex-column gap-2",
      content: document.querySelector("[data-setting-species-panel]"),
    }).section
  );

  document.querySelector("[data-calendar-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Calendar",
      helpTopic: "sanctum.calendar",
      collapsed: true,
      className: "d-flex flex-column gap-2",
      content: document.querySelector("[data-calendar-panel]"),
    }).section
  );

  document.querySelector("[data-setting-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Setting Properties",
      collapsed: false,
      content: document.querySelector("[data-setting-panel]"),
    }).section
  );

  document.querySelector("[data-json-mount]")?.appendChild(jsonDataPanel.section);
}

async function init() {
  const shell = initAppShell({
    namespace: "sanctum",
    storagePrefix: "undercroft.sanctum.undo",
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

  initCollapsibles();

  // Generate starts disabled (see its own toolbar definition above) —
  // recomputed once the reference-data load resolves. A Setting is the one
  // hard requirement (generateLocation degrades gracefully otherwise — a
  // zero-synergy Feature/Resource pick is never forced, per this tool's
  // own design). Previously the button stayed enabled with no Setting
  // picked and only warned reactively inside handleGenerate — same class
  // of bug as Crucible/Vault/Forge's own Generate buttons, fixed the same
  // way via the shared setGenerateButtonReadiness helper.
  function updateGenerateButtonReadiness() {
    const settingId = currentSettingId || elements.settingSelect?.value;
    const reason = settingId ? "" : "Select or save a Setting first.";
    setGenerateButtonReadiness(elements.generateButton, reason);
  }

  elements.generateButton?.addEventListener("click", handleGenerateAction);
  elements.saveButton?.addEventListener("click", handleSave);
  elements.duplicateButton?.addEventListener("click", handleDuplicate);
  elements.undoButton?.addEventListener("click", () => performUndo());
  elements.redoButton?.addEventListener("click", () => performRedo());
  elements.generateNoteButton?.addEventListener("click", handleGenerateNote);
  elements.nameInput?.addEventListener("input", () => scheduleFieldCommit("edit name"));
  elements.nameInput?.addEventListener("keydown", flushFieldCommitOnUndoRedo);
  elements.nameInput?.addEventListener("change", () => commitFieldEdit());
  elements.notesText?.addEventListener("input", () => scheduleFieldCommit("edit notes"));
  elements.notesText?.addEventListener("keydown", flushFieldCommitOnUndoRedo);
  elements.notesText?.addEventListener("change", () => commitFieldEdit());
  elements.notesModeToggle?.addEventListener("click", () => {
    // Notes isn't written back into currentRecord until Save/Export —
    // switching to View needs the live textarea value, not whatever was
    // last saved.
    if (currentRecord) currentRecord.notes = elements.notesText?.value || "";
    applyNotesMode(notesMode === "view" ? "edit" : "view");
  });

  elements.addFeatureButton?.addEventListener("click", () => {
    const featureId = elements.addFeatureSelect?.value;
    if (featureId) addFeature(featureId);
  });

  // Picking a Type/Purpose/Environment keeps currentRecord in sync — same
  // convention Crucible's own identityFields "change" listener uses.
  elements.identityFields?.addEventListener("change", (event) => {
    const target = event.target.closest("[data-editable-identity]");
    if (!target || !currentRecord) return;
    const key = target.dataset.editableIdentity;
    recordHistory(`edit ${key}`, () => {
      currentRecord[key] = target.value || null;
    });
    jsonDataPanel.render();
  });

  // Per-field reroll button (createFieldBox's own `rerollable` option) —
  // same convention Forge's/Crucible's/Vault's Identity fields use.
  // Rebuilds the whole Identity grid since renderIdentity is the single
  // source of truth for it now, matching Crucible's own reroll listener.
  elements.identityFields?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll-attribute]");
    if (!button || !currentRecord) return;
    const attribute = button.dataset.rerollAttribute;
    recordHistory(`reroll ${attribute}`, () => {
      currentRecord = rerollAxis(currentRecord, { locationTypes, locationPurposes, environmentPropertyType }, currentSystemId(), attribute);
    });
    renderIdentity(currentRecord);
    jsonDataPanel.render();
  });

  elements.addAssetKindSelect?.addEventListener("change", () =>
    populateAddEntitySelect(elements.addAssetKindSelect.value, elements.addAssetEntitySelect)
  );
  elements.addNeedKindSelect?.addEventListener("change", () =>
    populateAddEntitySelect(elements.addNeedKindSelect.value, elements.addNeedEntitySelect)
  );
  elements.addAssetButton?.addEventListener("click", () =>
    addAssetOrNeed("assets", elements.addAssetKindSelect?.value || "resource", elements.addAssetEntitySelect?.value)
  );
  elements.addNeedButton?.addEventListener("click", () =>
    addAssetOrNeed("needs", elements.addNeedKindSelect?.value || "resource", elements.addNeedEntitySelect?.value)
  );

  elements.addSpeciesWeightButton?.addEventListener("click", () => renderSpeciesWeightRow(elements.speciesWeightRows, elements.speciesWeightTotal));
  elements.speciesWeightRows?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-species-weight]")) {
      event.target.closest(".d-flex").remove();
      updateSpeciesWeightTotal(elements.speciesWeightRows, elements.speciesWeightTotal);
    }
  });
  elements.speciesWeightRows?.addEventListener("input", (event) => {
    if (event.target.matches("[data-species-weight-value]")) updateSpeciesWeightTotal(elements.speciesWeightRows, elements.speciesWeightTotal);
  });

  // Same row editor, targeting the Setting's own general Species Weights
  // (Setting Properties, right pane) — the default a Location without its
  // own Species Weights falls back to (see Forge's effectiveSpeciesLocation).
  elements.addSettingSpeciesWeightButton?.addEventListener("click", () => {
    renderSpeciesWeightRow(elements.settingSpeciesWeightRows, elements.settingSpeciesWeightTotal);
    updateSettingToolbarState();
  });
  elements.settingSpeciesWeightRows?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-species-weight]")) {
      event.target.closest(".d-flex").remove();
      updateSpeciesWeightTotal(elements.settingSpeciesWeightRows, elements.settingSpeciesWeightTotal);
      updateSettingToolbarState();
    }
  });
  elements.settingSpeciesWeightRows?.addEventListener("input", (event) => {
    if (event.target.matches("[data-species-weight-value]")) {
      updateSpeciesWeightTotal(elements.settingSpeciesWeightRows, elements.settingSpeciesWeightTotal);
    }
    updateSettingToolbarState();
  });
  elements.mixingCoefficientInput?.addEventListener("input", () => {
    if (elements.mixingCoefficientValue) {
      elements.mixingCoefficientValue.textContent = Number(elements.mixingCoefficientInput.value).toFixed(2);
    }
  });
  elements.addArchetypeOverrideButton?.addEventListener("click", () => renderArchetypeOverrideRow());
  elements.archetypeOverrideRows?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-archetype-override]")) event.target.closest(".d-flex").remove();
  });
  elements.addFallbackNameButton?.addEventListener("click", () => renderFallbackNameRow());
  elements.fallbackNameRows?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-fallback-name]")) event.target.closest(".d-flex").remove();
  });

  elements.daysPerWeekInput?.addEventListener("input", updateSettingToolbarState);
  elements.epochLabelInput?.addEventListener("input", updateSettingToolbarState);
  elements.startingYearInput?.addEventListener("input", updateSettingToolbarState);

  elements.addWeekdayNameButton?.addEventListener("click", () => {
    renderWeekdayNameRow();
    updateSettingToolbarState();
  });
  elements.weekdayNameRows?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-weekday-name]")) {
      event.target.closest(".d-flex").remove();
      updateSettingToolbarState();
    }
  });
  elements.weekdayNameRows?.addEventListener("input", updateSettingToolbarState);

  elements.addMonthButton?.addEventListener("click", () => {
    renderMonthRow();
    updateSettingToolbarState();
  });
  elements.monthRows?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-month]")) {
      event.target.closest(".d-flex").remove();
      updateSettingToolbarState();
    }
  });
  elements.monthRows?.addEventListener("input", updateSettingToolbarState);

  elements.addMoonCycleButton?.addEventListener("click", () => {
    renderMoonCycleRow();
    updateSettingToolbarState();
  });
  elements.moonCycleRows?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-moon-cycle]")) {
      event.target.closest(".d-flex").remove();
      updateSettingToolbarState();
    }
  });
  elements.moonCycleRows?.addEventListener("input", updateSettingToolbarState);

  elements.addSeasonButton?.addEventListener("click", () => {
    renderSeasonRow();
    updateSettingToolbarState();
  });
  elements.seasonRows?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-season]")) {
      event.target.closest(".d-flex").remove();
      updateSettingToolbarState();
    }
  });
  elements.seasonRows?.addEventListener("input", updateSettingToolbarState);

  // Delegated live-dirty-check: any text/number/range/select edit anywhere
  // in the Location display re-evaluates whether Save should light up,
  // without needing an individual listener wired to every field.
  // Add/remove actions (Features/Assets/Needs) are button clicks, so they
  // already call updateActionButtons() explicitly at their own call sites.
  // Relationships are handled entirely by the shared relationship-editor.js
  // component and never touch currentRecord/isLocationDirty — they're
  // their own `relationship` records, saved independently the moment
  // they're added or removed.
  elements.display?.addEventListener("input", updateActionButtons);
  elements.display?.addEventListener("change", updateActionButtons);

  // Named (not an inline listener) so the init flow below can also call
  // this directly when auto-selecting the active campaign group's System.
  async function handleSystemSelectChange() {
    markRequiredControl(elements.systemSelect, Boolean(elements.systemSelect.value));
    currentLocationId = null;
    // Independent fetches, run concurrently — reloadReferenceData's 8-kind
    // Promise.all (including the two largest kinds in the suite, feature
    // and monster) used to run to completion BEFORE the Setting picker's
    // own fetch even started, needlessly gating "which Setting can I pick"
    // behind data Settings never reads.
    const [, settings] = await Promise.all([reloadReferenceData(), populateSettingSelect(currentSystemId())]);
    // populateSettingSelect (via renderOptionalSelectOptions) keeps the
    // picker's own value selected whenever the previously-loaded Setting is
    // still in the new System's list (e.g. a multi-System Setting) —
    // mirrored here instead of unconditionally clearing, so the picker and
    // the right-pane content never disagree.
    const settingId = elements.settingSelect?.value || "";
    currentSettingId = settingId || null;
    updateGenerateButtonReadiness();
    await loadSettingIntoForm(settingId);
    await reloadLocationsForSetting(currentSettingId);
    // reloadLocationsForSetting -> populateLocationSelect never auto-selects
    // a Location (unlike Setting above) — Location is what Sanctum
    // GENERATES, so the center pane should stay blank and ready for
    // Generate. This only re-selects when renderOptionalSelectOptions' own
    // "keep the previous value if it's still valid" behavior left the
    // picker non-blank (e.g. switching System while the same Location
    // stays valid under it).
    if (elements.locationSelect?.value) {
      await selectLocation(elements.locationSelect.value);
    } else {
      renderLocation(null);
    }
    return settings;
  }
  elements.systemSelect?.addEventListener("change", handleSystemSelectChange);

  // Named for the same reason as handleSystemSelectChange above.
  async function handleSettingSelectChange() {
    const settingId = elements.settingSelect.value;
    markRequiredControl(elements.settingSelect, Boolean(settingId));
    currentSettingId = settingId || null;
    updateGenerateButtonReadiness();
    currentLocationId = null;
    await loadSettingIntoForm(settingId);
    await reloadLocationsForSetting(settingId);
    // Same cascade-completion as handleSystemSelectChange above.
    if (elements.locationSelect?.value) {
      await selectLocation(elements.locationSelect.value);
    } else {
      renderLocation(null);
    }
  }
  elements.settingSelect?.addEventListener("change", handleSettingSelectChange);

  elements.settingNameInput?.addEventListener("input", updateSettingToolbarState);
  elements.settingDescriptionInput?.addEventListener("input", updateSettingToolbarState);

  elements.newSettingButton?.addEventListener("click", () => {
    if (elements.settingSelect) elements.settingSelect.value = "";
    markRequiredControl(elements.settingSelect, false);
    currentSettingId = null;
    populateSettingForm(null);
  });

  // Same dirty checks the Save buttons already use — Sanctum had no guard
  // against navigating/closing away from unsaved edits (unlike Workbench,
  // which already had this).
  window.addEventListener("beforeunload", (event) => {
    if (!canSaveSetting() && !canSaveLocation()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  elements.saveSettingButton?.addEventListener("click", async () => {
    if (!dataManager) return;
    const systemId = currentSystemId();
    if (!systemId) {
      status?.show("Select a System first.", { type: "warning", timeout: 2000 });
      return;
    }
    const name = elements.settingNameInput?.value.trim();
    if (!name) {
      status?.show("Enter a Setting name first.", { type: "warning", timeout: 2500 });
      return;
    }
    const id = currentSettingId || slugify(name);
    const calendar = collectCalendarFromForm();
    const speciesWeights = collectSettingSpeciesWeightsFromForm();
    try {
      await dataManager.save("setting", id, {
        kind: "setting",
        systemIds: [systemId],
        name,
        description: elements.settingDescriptionInput?.value.trim() || "",
        // Omitted entirely (not even an empty object/array) unless the GM
        // actually filled the section in — same "optional fields start
        // absent" convention as every other optional field in this suite.
        ...(hasCalendarContent(calendar) ? { calendar } : {}),
        ...(speciesWeights.length ? { speciesWeights } : {}),
      });
      currentSettingId = id;
      status?.show(`Saved Setting ${id}.`, { type: "success", timeout: 2000 });
      await populateSettingSelect(systemId);
      elements.settingSelect.value = id;
      await reloadLocationsForSetting(id);
      markSettingClean();
    } catch (error) {
      status?.show(`Unable to save Setting: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });

  elements.deleteSettingButton?.addEventListener("click", async () => {
    if (!dataManager || !currentSettingId) return;
    if (!confirmDelete({ label: `setting "${currentSettingId}"` })) return;
    try {
      await dataManager.delete("setting", currentSettingId);
      status?.show("Deleted.", { type: "success", timeout: 2000 });
      currentSettingId = null;
      populateSettingForm(null);
      await populateSettingSelect(currentSystemId());
      await reloadLocationsForSetting(null);
      renderLocation(null);
    } catch (error) {
      status?.show(`Unable to delete: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });

  async function selectLocation(id) {
    const nextId = id || null;
    if (elements.locationSelect) elements.locationSelect.value = id || "";
    currentLocationId = nextId;
    updateGenerationFieldsVisibility();
    if (!id) {
      renderLocation(null);
      return;
    }
    try {
      // preferLocal: false — same reason loadSettingIntoForm needs it: a
      // Location's own Species Weights/Properties must be visible
      // immediately, not hidden behind a stale local cache.
      const result = await dataManager.get("location", id, { preferLocal: false });
      renderLocation(createLocationRecord(result?.payload || {}, id));
      markLocationClean();
    } catch (error) {
      status?.show(`Unable to load location: ${error.message}`, { type: "error", timeout: 4000 });
    }
  }

  elements.locationSelect?.addEventListener("change", () => {
    void selectLocation(elements.locationSelect.value);
  });

  elements.deleteLocationButton?.addEventListener("click", async () => {
    if (!dataManager || !currentLocationId) return;
    if (!confirmDelete({ label: `location "${currentLocationId}"` })) return;
    const settingId = currentSettingId || elements.settingSelect?.value || null;
    // Every descendant (not just direct children) — a grandchild would be
    // orphaned just the same if only its own parent gets deleted, so
    // "delete the children too" has to mean the whole subtree.
    const descendants = collectDescendantLocations(currentLocationId);
    const deleteDescendants =
      descendants.length > 0 &&
      window.confirm(
        `This location has ${descendants.length} child location${descendants.length === 1 ? "" : "s"}. Delete ${
          descendants.length === 1 ? "it" : "them"
        } too? They won't make much sense without their parent.`
      );
    try {
      const deletedIds = [currentLocationId];
      await dataManager.delete("location", currentLocationId);
      if (deleteDescendants) {
        for (const descendant of descendants) {
          await dataManager.delete("location", descendant.id);
          deletedIds.push(descendant.id);
        }
      }
      // Deleting a Location leaves whatever `relationship` records pointed
      // at it as true orphans — harmless (the graph/hierarchy derivation
      // already ignores any edge whose other end isn't in the current
      // Setting's own id set, same as a dangling parentId always was), but
      // best-effort cleaned up here rather than left to accumulate forever.
      const deletedIdSet = new Set(deletedIds);
      const relationships = await fetchAllRelationships(dataManager).catch(() => []);
      await Promise.all(
        relationships
          .filter((edge) => deletedIdSet.has(edge.fromId) || deletedIdSet.has(edge.toId))
          .map((edge) => deleteRelationship(dataManager, edge.id).catch(() => {}))
      );
      status?.show(
        deleteDescendants
          ? `Deleted, along with ${descendants.length} child location${descendants.length === 1 ? "" : "s"}.`
          : "Deleted.",
        { type: "success", timeout: 2000 }
      );
      currentLocationId = null;
      if (elements.locationSelect) elements.locationSelect.value = "";
      renderLocation(null);
      await reloadLocationsForSetting(settingId);
    } catch (error) {
      status?.show(`Unable to delete: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });

  // `?location=<id>` / `?setting=<id>` — a cross-tool deep link (Repository's
  // own kind-reference chips route here via KIND_TOOL_ROUTE) straight to
  // one specific record, same `?param=<id>`-read-at-bootstrap convention
  // Orrery's `?map=`/Loom's `?feature=` already establish.
  //
  // Two-phase, not one straight-line await chain — the original version
  // resolved the location's own System/Setting and ran the FULL cascade
  // (reloadReferenceData's 8 parallel fetches, then EVERY Location in the
  // Setting for the picker) before ever calling selectLocation, so a deep
  // link into a large campaign sat on a blank screen through all of that.
  // Phase 1 (awaited, blocks return): fetch just the target Location and
  // render it. Phase 2 (fired but NOT awaited): the System/Setting cascade
  // + full picker population, in the background — the record is already on
  // screen by the time this resolves. Feature/Resource/connected-location
  // names may briefly show as raw ids until this lands and its own final
  // selectLocation call re-renders with everything resolved.
  async function applyDeepLinkParams() {
    const params = new URLSearchParams(window.location.search);
    const locationId = params.get("location");
    const settingId = params.get("setting");
    if (!locationId && !settingId) return false;
    try {
      let targetSettingId = settingId;
      let targetSystemId = null;
      if (locationId) {
        const result = await dataManager.get("location", locationId, { preferLocal: false });
        const payload = result?.payload || {};
        targetSettingId = targetSettingId || payload.settingIds?.[0] || payload.settingId || null;
        targetSystemId = payload.systemIds?.[0] || payload.systemId || null;
        // Phase 1 — the record itself, on screen as fast as one fetch allows.
        await selectLocation(locationId);
      }
      if (!targetSystemId && targetSettingId) {
        const settingResult = await dataManager.get("setting", targetSettingId, { preferLocal: false });
        targetSystemId = settingResult?.payload?.systemIds?.[0] || null;
      }
      // Phase 2 — deliberately not awaited here; runs after this function
      // has already returned `true`.
      void (async () => {
        try {
          if (targetSystemId && elements.systemSelect) {
            elements.systemSelect.value = targetSystemId;
            await handleSystemSelectChange();
          }
          if (targetSettingId && elements.settingSelect) {
            elements.settingSelect.value = targetSettingId;
            await handleSettingSelectChange();
          }
          // handleSystemSelectChange/handleSettingSelectChange both reset
          // currentLocationId and render the empty state as part of their
          // own normal cascade — this restores the deep-linked Location,
          // now with every name/list Phase 1 didn't have yet.
          if (locationId) await selectLocation(locationId);
          updateGenerateButtonReadiness();
        } catch (error) {
          // Phase 1 already succeeded — a background failure here just
          // leaves the pickers under-populated, not worth an error toast on
          // top of a page already showing real content. Generate stays
          // disabled — reference data may never have loaded.
        }
      })();
      return true;
    } catch (error) {
      status?.show("Unable to open the linked record.", { type: "error", timeout: 3000 });
      return false;
    }
  }

  // If a campaign group is active and has its own System/Setting assigned,
  // default Sanctum's own pickers to THOSE specifically — a real, GM-chosen
  // fact about the campaign, not a guess — to make mid-campaign generation
  // faster. Falls through to the original placeholder sequence when
  // there's no active group, or its System/Setting isn't one this tool's
  // own lists contain. An explicit `?location=`/`?setting=` deep link
  // always wins over both.
  const systems = await populateSystemSelect();
  const deepLinked = await applyDeepLinkParams();
  if (!deepLinked) {
    const groupContext = await resolveGroupContext(dataManager).catch(() => null);
    const defaultSystemId = pickGroupDefaultId(groupContext, "systemId", systems);
    if (defaultSystemId) {
      elements.systemSelect.value = defaultSystemId;
      const settings = await handleSystemSelectChange();
      const defaultSettingId = pickGroupDefaultId(groupContext, "settingId", settings);
      if (defaultSettingId) {
        elements.settingSelect.value = defaultSettingId;
        await handleSettingSelectChange();
      }
    } else {
      // Same concurrency fix as handleSystemSelectChange's own copy of
      // this — independent fetches, no reason for one to gate the other.
      await Promise.all([reloadReferenceData(), populateSettingSelect(currentSystemId())]);
      populateSettingForm(null);
      await reloadLocationsForSetting(null);
      renderLocation(null);
    }
    // Both branches above resolve reference data for whatever System ended
    // up selected — safe to recompute readiness here regardless of which
    // one ran. The deepLinked case updates from inside its own Phase 2
    // background IIFE instead, once ITS reference-data load finishes.
    updateGenerateButtonReadiness();
  }

  initHelpSystem();
  refreshTooltips();
}

init();
