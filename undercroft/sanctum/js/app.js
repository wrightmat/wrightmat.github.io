import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initSpotlightButton } from "../../common/js/lib/spotlight.js";
import { updateJsonPreview } from "../../common/js/lib/json-preview.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import {
  listLocationTypesForSystem,
  listLocationPurposesForSystem,
  listFeaturesForSystem,
  listResourcesForSystem,
  listSpeciesForSystem,
  listNpcsForSystem,
  listMonstersForSystem,
  listEffectsForSystem,
  listSettingsForSystem,
  listLocationsForSetting,
} from "./lib/tables.js";
import { generateLocation } from "./lib/generator.js";
import { createLocationRecord, toPressExportShape } from "./lib/location-schema.js";
import { generateLocationNote } from "./lib/llm-note.js";

const ASSET_NEED_KINDS = ["resource", "npc", "monster", "effect"];

let status = null;
let dataManager = null;
let locationTypes = [];
let locationPurposes = [];
let features = [];
let resources = [];
let npcs = [];
let monsters = [];
let effects = [];
let speciesOptions = [];
let environmentPropertyType = null;
let locationsInSetting = [];
let currentSettingId = null;
let currentLocationId = null;
let currentRecord = null;
// Handle returned by initSpotlightButton (common/js/lib/spotlight.js) — its
// own refresh() is the single source of truth for the button's disabled
// state (has a record AND an active campaign group), called from
// updateActionButtons alongside every other action-button gate rather than
// this file separately tracking "hasRecord" on its own and racing with it.
let spotlightControl = null;
// Ownership metadata for Settings in the active System, used only for the
// Delete button's access gate (owner-or-admin) — same rule and shape as
// Loom's systemAllowsDelete/libraryEntryAllowsDelete. Keyed by setting id.
let settingCatalog = new Map();
// "Clean" baseline for the Setting form (name/description at last load/save)
// — Save only lights up once the current fields actually differ from it,
// mirroring Loom's isDirty/markClean pattern for Systems.
let settingCleanSnapshot = null;
// Same idea for the Location record — established after loading an existing
// Location or right after a successful save, NOT after generating (freshly
// generated content is always unsaved/savable until proven otherwise).
let locationCleanSnapshot = null;
// Ownership metadata for Locations in the current Setting, same role/shape
// as settingCatalog above — used only for the Delete button's access gate.
let locationCatalog = new Map();

const elements = {
  systemSelect: document.querySelector("[data-system-select]"),
  settingSelect: document.querySelector("[data-setting-select]"),
  settingToggle: document.querySelector("[data-setting-toggle]"),
  settingToggleLabel: document.querySelector("[data-setting-toggle-label]"),
  settingPanel: document.querySelector("[data-setting-panel]"),
  newSettingButton: document.querySelector("[data-new-setting]"),
  deleteSettingButton: document.querySelector("[data-delete-setting]"),
  settingNameInput: document.querySelector("[data-setting-name]"),
  settingDescriptionInput: document.querySelector("[data-setting-description]"),
  saveSettingButton: document.querySelector("[data-save-setting]"),
  locationSelect: document.querySelector("[data-location-select]"),
  deleteLocationButton: document.querySelector("[data-delete-location]"),
  typeOverride: document.querySelector("[data-type-override]"),
  purposeOverride: document.querySelector("[data-purpose-override]"),
  environmentOverride: document.querySelector("[data-environment-override]"),
  lockedFeatures: document.querySelector("[data-locked-features]"),
  parentSelect: document.querySelector("[data-parent-select]"),
  connectedToList: document.querySelector("[data-connected-to-list]"),
  addConnectionSelect: document.querySelector("[data-add-connection-select]"),
  addConnectionButton: document.querySelector("[data-add-connection-button]"),
  childrenList: document.querySelector("[data-children-list]"),
  generateButton: document.querySelector("[data-generate-location]"),
  saveButton: document.querySelector("[data-save-location]"),
  exportButton: document.querySelector("[data-export-location]"),
  spotlightButton: document.querySelector("[data-spotlight-location]"),
  emptyState: document.querySelector("[data-location-empty-state]"),
  display: document.querySelector("[data-location-display]"),
  nameInput: document.querySelector("[data-location-name]"),
  identityTypeSelect: document.querySelector("[data-identity-type]"),
  identityPurposeSelect: document.querySelector("[data-identity-purpose]"),
  identityEnvironmentSelect: document.querySelector("[data-identity-environment]"),
  featuresToggle: document.querySelector("[data-features-toggle]"),
  featuresToggleLabel: document.querySelector("[data-features-toggle-label]"),
  featuresPanel: document.querySelector("[data-features-panel]"),
  featureList: document.querySelector("[data-feature-list]"),
  addFeatureSelect: document.querySelector("[data-add-feature-select]"),
  addFeatureButton: document.querySelector("[data-add-feature-button]"),
  assetsNeedsToggle: document.querySelector("[data-assets-needs-toggle]"),
  assetsNeedsToggleLabel: document.querySelector("[data-assets-needs-toggle-label]"),
  assetsNeedsPanel: document.querySelector("[data-assets-needs-panel]"),
  assetList: document.querySelector("[data-asset-list]"),
  addAssetKindSelect: document.querySelector("[data-add-asset-kind-select]"),
  addAssetEntitySelect: document.querySelector("[data-add-asset-entity-select]"),
  addAssetButton: document.querySelector("[data-add-asset-button]"),
  needList: document.querySelector("[data-need-list]"),
  addNeedKindSelect: document.querySelector("[data-add-need-kind-select]"),
  addNeedEntitySelect: document.querySelector("[data-add-need-entity-select]"),
  addNeedButton: document.querySelector("[data-add-need-button]"),
  relationshipsToggle: document.querySelector("[data-relationships-toggle]"),
  relationshipsToggleLabel: document.querySelector("[data-relationships-toggle-label]"),
  relationshipsPanel: document.querySelector("[data-relationships-panel]"),
  notesToggle: document.querySelector("[data-notes-toggle]"),
  notesToggleLabel: document.querySelector("[data-notes-toggle-label]"),
  notesPanel: document.querySelector("[data-notes-panel]"),
  npcConfigToggle: document.querySelector("[data-npc-config-toggle]"),
  npcConfigToggleLabel: document.querySelector("[data-npc-config-toggle-label]"),
  npcConfigPanel: document.querySelector("[data-npc-config-panel]"),
  speciesWeightRows: document.querySelector("[data-species-weight-rows]"),
  speciesWeightTotal: document.querySelector("[data-species-weight-total]"),
  addSpeciesWeightButton: document.querySelector("[data-add-species-weight]"),
  mixingCoefficientInput: document.querySelector("[data-mixing-coefficient]"),
  mixingCoefficientValue: document.querySelector("[data-mixing-coefficient-value]"),
  archetypeOverrideRows: document.querySelector("[data-archetype-override-rows]"),
  addArchetypeOverrideButton: document.querySelector("[data-add-archetype-override]"),
  fallbackNameRows: document.querySelector("[data-fallback-name-rows]"),
  addFallbackNameButton: document.querySelector("[data-add-fallback-name]"),
  notesText: document.querySelector("[data-notes-text]"),
  generateNoteButton: document.querySelector("[data-generate-note]"),
  jsonToggle: document.querySelector("[data-json-toggle]"),
  jsonToggleLabel: document.querySelector("[data-json-toggle-label]"),
  jsonPanel: document.querySelector("[data-json-panel]"),
  jsonPreview: document.querySelector("[data-location-json-preview]"),
  jsonBytes: document.querySelector("[data-location-json-bytes]"),
  inspectorEmpty: document.querySelector("[data-inspector-empty]"),
  inspectorDetail: document.querySelector("[data-inspector-detail]"),
  inspectorJson: document.querySelector("[data-inspector-json]"),
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

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

// --- Systems (own small copy, same as Crucible/Vault/Forge each keep) ------
async function listAllSystems() {
  if (!dataManager) return [];
  try {
    const listing = await dataManager.list("systems", { refresh: true });
    const entries = dataManager.collectListEntries(listing.remote, ["items", "owned", "shared", "public"]);
    return entries.map((entry) => ({ id: entry.id, title: entry.title || entry.id })).sort((a, b) => a.title.localeCompare(b.title));
  } catch (error) {
    return [];
  }
}

async function populateSystemSelect() {
  const systems = await listAllSystems();
  const previous = elements.systemSelect?.value;
  if (!elements.systemSelect) return systems;
  elements.systemSelect.innerHTML = "";
  systems.forEach((system) => {
    const option = document.createElement("option");
    option.value = system.id;
    option.textContent = system.title;
    elements.systemSelect.appendChild(option);
  });
  if (systems.some((system) => system.id === previous)) elements.systemSelect.value = previous;
  return systems;
}

// --- Setting mini-editor (ported from Loom's Places panel) ------------------
async function populateSettingSelect(systemId) {
  if (!elements.settingSelect) return;
  elements.settingSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "New / unsaved";
  elements.settingSelect.appendChild(blank);
  if (!systemId) {
    settingCatalog = new Map();
    return;
  }
  const settings = await listSettingsForSystem(dataManager, systemId);
  settings.forEach((setting) => {
    const option = document.createElement("option");
    option.value = setting.id;
    option.textContent = setting.name || setting.id;
    elements.settingSelect.appendChild(option);
  });
  await refreshSettingCatalog(settings.map((setting) => setting.id));
}

// Ownership metadata comes from the list response, not the full fetched
// body — a second, lightweight dataManager.list() call (only entries in
// this System's already-correct id set are kept), mirroring exactly how
// Loom's listAllSystems/populateLibraryEntrySelect cache owner_id/
// owner_username/permissions for their own delete-gating. Local-only
// (anonymous, browser-storage) entries are included too and tagged
// `ownership: "local"` — those are always deletable, since it's just the
// current browser's own storage with no real access-control question.
async function refreshSettingCatalog(ids) {
  settingCatalog = new Map();
  if (!dataManager || !ids.length) return;
  const idSet = new Set(ids);
  try {
    const listing = await dataManager.list("setting", { refresh: true });
    const remoteEntries = dataManager.collectListEntries(listing.remote, ["owned", "shared", "public", "items"]);
    remoteEntries.forEach((entry) => {
      if (!idSet.has(entry.id)) return;
      settingCatalog.set(entry.id, {
        ownerId: entry.owner_id ?? entry.ownerId ?? null,
        ownerUsername: entry.owner_username || entry.ownerUsername || "",
        permissions: typeof entry.permissions === "string" ? entry.permissions.toLowerCase() : "",
      });
    });
    (listing.local || []).forEach((entry) => {
      if (!idSet.has(entry.id) || settingCatalog.has(entry.id)) return;
      settingCatalog.set(entry.id, { ownership: "local" });
    });
  } catch (error) {
    // leave settingCatalog empty — Delete stays gated off defensively
  }
}

// Owner-or-admin, same rule as Loom's systemAllowsDelete/libraryEntryAllowsDelete.
function settingAllowsDelete(id) {
  if (!id) return false;
  if (dataManager?.getUserTier() === "admin") return true;
  const metadata = settingCatalog.get(id);
  if (!metadata) return false;
  if (metadata.ownership === "local") return true;
  if (metadata.permissions === "edit") return true;
  const user = dataManager?.session?.user;
  if (!user || !dataManager.isAuthenticated()) return false;
  if (metadata.ownerId !== null && metadata.ownerId !== undefined && user.id !== undefined && user.id !== null) {
    if (String(metadata.ownerId) === String(user.id)) return true;
  }
  if (metadata.ownerUsername && user.username) {
    return metadata.ownerUsername.toLowerCase() === user.username.toLowerCase();
  }
  return false;
}

function createSettingSnapshot() {
  return {
    name: elements.settingNameInput?.value || "",
    description: elements.settingDescriptionInput?.value || "",
  };
}

function isSettingDirty() {
  if (!settingCleanSnapshot) return false;
  const current = createSettingSnapshot();
  return settingCleanSnapshot.name !== current.name || settingCleanSnapshot.description !== current.description;
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
  markSettingClean();
}

async function loadSettingIntoForm(id) {
  if (!id) {
    populateSettingForm(null);
    return;
  }
  try {
    const result = await dataManager.get("setting", id);
    populateSettingForm(result?.payload || null);
  } catch (error) {
    populateSettingForm(null);
  }
}

async function reloadLocationsForSetting(settingId) {
  locationsInSetting = settingId ? await listLocationsForSetting(dataManager, settingId) : [];
  populateLocationSelect();
  populateParentSelect();
  populateAddConnectionSelect();
  await refreshLocationCatalog(locationsInSetting.map((location) => location.id));
  if (currentRecord) renderChildrenList(currentRecord);
  updateActionButtons();
}

// Same shape/reasoning as refreshSettingCatalog above: ownership metadata
// comes from the list response (owned/shared/public + local), not the full
// fetched body, and local-only entries are always deletable.
async function refreshLocationCatalog(ids) {
  locationCatalog = new Map();
  if (!dataManager || !ids.length) return;
  const idSet = new Set(ids);
  try {
    const listing = await dataManager.list("location", { refresh: true });
    const remoteEntries = dataManager.collectListEntries(listing.remote, ["owned", "shared", "public", "items"]);
    remoteEntries.forEach((entry) => {
      if (!idSet.has(entry.id)) return;
      locationCatalog.set(entry.id, {
        ownerId: entry.owner_id ?? entry.ownerId ?? null,
        ownerUsername: entry.owner_username || entry.ownerUsername || "",
        permissions: typeof entry.permissions === "string" ? entry.permissions.toLowerCase() : "",
      });
    });
    (listing.local || []).forEach((entry) => {
      if (!idSet.has(entry.id) || locationCatalog.has(entry.id)) return;
      locationCatalog.set(entry.id, { ownership: "local" });
    });
  } catch (error) {
    // leave locationCatalog empty — Delete stays gated off defensively
  }
}

// Owner-or-admin, same rule as settingAllowsDelete/Loom's systemAllowsDelete.
function locationAllowsDelete(id) {
  if (!id) return false;
  if (dataManager?.getUserTier() === "admin") return true;
  const metadata = locationCatalog.get(id);
  if (!metadata) return false;
  if (metadata.ownership === "local") return true;
  if (metadata.permissions === "edit") return true;
  const user = dataManager?.session?.user;
  if (!user || !dataManager.isAuthenticated()) return false;
  if (metadata.ownerId !== null && metadata.ownerId !== undefined && user.id !== undefined && user.id !== null) {
    if (String(metadata.ownerId) === String(user.id)) return true;
  }
  if (metadata.ownerUsername && user.username) {
    return metadata.ownerUsername.toLowerCase() === user.username.toLowerCase();
  }
  return false;
}

function canDeleteLocation() {
  return locationAllowsDelete(currentLocationId);
}

function populateLocationSelect() {
  if (!elements.locationSelect) return;
  const previous = elements.locationSelect.value;
  elements.locationSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "New / unsaved";
  elements.locationSelect.appendChild(blank);
  locationsInSetting.forEach((location) => {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.name || location.id;
    elements.locationSelect.appendChild(option);
  });
  if (locationsInSetting.some((location) => location.id === previous)) elements.locationSelect.value = previous;
}

function populateParentSelect() {
  if (!elements.parentSelect) return;
  const previous = elements.parentSelect.value;
  elements.parentSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "(none — top level)";
  elements.parentSelect.appendChild(blank);
  locationsInSetting
    .filter((location) => location.id !== currentLocationId)
    .forEach((location) => {
      const option = document.createElement("option");
      option.value = location.id;
      option.textContent = location.name || location.id;
      elements.parentSelect.appendChild(option);
    });
  if (locationsInSetting.some((location) => location.id === previous)) elements.parentSelect.value = previous;
}

function populateAddConnectionSelect() {
  if (!elements.addConnectionSelect) return;
  const connected = new Set(currentRecord?.connectedTo || []);
  elements.addConnectionSelect.innerHTML = "";
  const candidates = locationsInSetting.filter((location) => location.id !== currentLocationId && !connected.has(location.id));
  if (!candidates.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "(no other locations in this Setting yet)";
    elements.addConnectionSelect.appendChild(placeholder);
    elements.addConnectionSelect.disabled = true;
    if (elements.addConnectionButton) elements.addConnectionButton.disabled = true;
    return;
  }
  elements.addConnectionSelect.disabled = false;
  if (elements.addConnectionButton) elements.addConnectionButton.disabled = false;
  candidates.forEach((location) => {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.name || location.id;
    elements.addConnectionSelect.appendChild(option);
  });
}

// --- Reference data (location-type/location-purpose/feature/resource/species/npc/monster/effect) ----
async function reloadReferenceData() {
  const systemId = currentSystemId();
  [locationTypes, locationPurposes, features, resources, npcs, monsters, effects, speciesOptions] = await Promise.all([
    listLocationTypesForSystem(dataManager, systemId),
    listLocationPurposesForSystem(dataManager, systemId),
    listFeaturesForSystem(dataManager, systemId),
    listResourcesForSystem(dataManager, systemId),
    listNpcsForSystem(dataManager, systemId),
    listMonstersForSystem(dataManager, systemId),
    listEffectsForSystem(dataManager, systemId),
    listSpeciesForSystem(dataManager, systemId),
  ]);
  environmentPropertyType = await loadEnvironmentPropertyType(systemId);
  populateOverrideSelect(elements.typeOverride, locationTypes, "Random");
  populateOverrideSelect(elements.purposeOverride, locationPurposes, "Random");
  populateEnvironmentSelect(elements.environmentOverride, "Random");
  populateOverrideSelect(elements.identityTypeSelect, locationTypes, "(none)");
  populateOverrideSelect(elements.identityPurposeSelect, locationPurposes, "(none)");
  populateEnvironmentSelect(elements.identityEnvironmentSelect, "(none)");
  populateLockedFeaturesSelect();
  populateAddFeatureSelect();
  populateAssetNeedKindSelects();
}

// Environment is just the "environment"-keyed array field on the active
// System's `fields` (Loom's "Properties" editor) — no separate propertyTypes
// concept exists anymore. Translated to the legacy {id, label, values:
// [{id, label}]} shape so the rest of this file needs no changes.
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
  const previouslySelected = new Set(Array.from(elements.lockedFeatures.selectedOptions).map((option) => option.value));
  elements.lockedFeatures.innerHTML = "";
  features
    .filter((feature) => (feature.tags?.categories || []).includes("location") || !feature.tags?.categories?.length)
    .forEach((feature) => {
      const option = document.createElement("option");
      option.value = feature.id;
      option.textContent = feature.name || feature.id;
      option.selected = previouslySelected.has(feature.id);
      elements.lockedFeatures.appendChild(option);
    });
}

function populateAddFeatureSelect() {
  if (!elements.addFeatureSelect) return;
  const selectedIds = new Set(currentRecord?.featureIds || []);
  elements.addFeatureSelect.innerHTML = "";
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
// how Features/Resources already are), so the entity picker and the
// label/description lookups for already-added entries never need a
// separate on-demand fetch.
function entityListForKind(kind) {
  return { resource: resources, npc: npcs, monster: monsters, effect: effects }[kind] || [];
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

function populateAddEntitySelect(kind, select) {
  if (!select) return;
  select.innerHTML = "";
  entityListForKind(kind).forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.name || entry.id;
    select.appendChild(option);
  });
}

// --- NPC Generation Config (optional; ported verbatim from Loom's Places panel) ----
function renderSpeciesWeightRow(entry = { entityId: "", weight: 0 }) {
  if (!elements.speciesWeightRows) return;
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
  elements.speciesWeightRows.appendChild(row);
  updateSpeciesWeightTotal();
}

function updateSpeciesWeightTotal() {
  if (!elements.speciesWeightRows || !elements.speciesWeightTotal) return;
  const total = Array.from(elements.speciesWeightRows.querySelectorAll("[data-species-weight-value]")).reduce(
    (sum, input) => sum + (Number(input.value) || 0),
    0
  );
  elements.speciesWeightTotal.textContent = `Total: ${total}`;
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
    (record?.speciesWeights || []).forEach((entry) => renderSpeciesWeightRow(entry));
    updateSpeciesWeightTotal();
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

function collectNpcConfigFromForm() {
  const speciesWeights = Array.from(elements.speciesWeightRows?.children || [])
    .map((row) => ({
      entityId: row.querySelector("[data-species-weight-select]").value,
      weight: Number(row.querySelector("[data-species-weight-value]").value) || 0,
    }))
    .filter((entry) => entry.entityId);
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

// --- Shared row renderer (Features/Assets/Needs all look and function the ---
// --- same, per explicit design feedback — including select-to-inspect) ------
function createListRow({ title, description, onRemove, removeLabel = "Remove", onSelect }) {
  const row = document.createElement("div");
  row.className = "border rounded-3 p-2 d-flex align-items-start justify-content-between gap-2";

  const info = document.createElement("div");
  info.className = "flex-grow-1";
  const titleEl = document.createElement("div");
  titleEl.className = "fw-semibold";
  titleEl.textContent = title;
  info.appendChild(titleEl);
  if (description) {
    const descriptionEl = document.createElement("div");
    descriptionEl.className = "small text-body-secondary";
    descriptionEl.textContent = description;
    info.appendChild(descriptionEl);
  }

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "btn btn-outline-danger btn-sm flex-shrink-0";
  removeButton.setAttribute("aria-label", removeLabel);
  removeButton.innerHTML = '<span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>';
  removeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    onRemove();
  });

  row.append(info, removeButton);
  if (onSelect) {
    row.classList.add("sanctum-clickable-row");
    row.addEventListener("click", () => onSelect(row));
  }
  return row;
}

// Clears the selected-row highlight across every selectable list (Features,
// Assets, Needs — only one thing is ever inspected at a time) and shows the
// given entity's full JSON in the right pane, or the empty state if there's
// nothing to show (a removed entry, or a reference whose entity couldn't be
// found).
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
function findById(list, id) {
  return list.find((entry) => entry.id === id) || null;
}

function featureLabel(id) {
  const feature = findById(features, id);
  return feature ? feature.name || feature.id : id;
}

function locationLabel(id) {
  const location = findById(locationsInSetting, id);
  return location ? location.name || location.id : id;
}

// Type/Purpose/Environment are real, editable selects (not read-only text) —
// a GM can change any of them on an already-generated Location without
// having to regenerate the whole thing. Options are populated once by
// reloadReferenceData(); this just syncs the current record's values onto
// them whenever a Location is loaded or generated.
function syncIdentitySelects(record) {
  if (elements.identityTypeSelect) elements.identityTypeSelect.value = record.typeId || "";
  if (elements.identityPurposeSelect) elements.identityPurposeSelect.value = record.purposeId || "";
  if (elements.identityEnvironmentSelect) elements.identityEnvironmentSelect.value = record.environment || "";
}

function renderFeatureList(record) {
  if (!elements.featureList) return;
  elements.featureList.innerHTML = "";
  record.featureIds.forEach((featureId) => {
    const feature = findById(features, featureId);
    const row = createListRow({
      title: feature?.name || featureId,
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
  currentRecord.featureIds = currentRecord.featureIds.filter((id) => id !== featureId);
  refreshEditableLists();
}

function addFeature(featureId) {
  if (!currentRecord || !featureId) return;
  if (!currentRecord.featureIds.includes(featureId)) currentRecord.featureIds.push(featureId);
  refreshEditableLists();
}

function referenceLabel(kind, refId) {
  return findById(entityListForKind(kind), refId)?.name || refId;
}

function referenceDescription(kind, refId) {
  return findById(entityListForKind(kind), refId)?.description || "";
}

function renderReferenceList(container, entries, onRemove) {
  if (!container) return;
  container.innerHTML = "";
  entries.forEach((entry, index) => {
    const entity = findById(entityListForKind(entry.kind), entry.refId);
    const row = createListRow({
      title: `${entry.label || referenceLabel(entry.kind, entry.refId)} (${entry.kind})`,
      description: entry.description || referenceDescription(entry.kind, entry.refId),
      onRemove: () => onRemove(index),
      removeLabel: "Remove",
      onSelect: (row) => selectInspectorEntry(row, entity || entry),
    });
    container.appendChild(row);
  });
}

function renderAssetsAndNeeds(record) {
  renderReferenceList(elements.assetList, record.assets || [], (index) => {
    currentRecord.assets.splice(index, 1);
    refreshEditableLists();
  });
  renderReferenceList(elements.needList, record.needs || [], (index) => {
    currentRecord.needs.splice(index, 1);
    refreshEditableLists();
  });
}

function addAssetOrNeed(listKey, kind, refId) {
  if (!currentRecord || !refId) return;
  const entity = findById(entityListForKind(kind), refId);
  currentRecord[listKey].push({
    kind,
    refId,
    label: entity?.name || refId,
    description: entity?.description || "",
  });
  refreshEditableLists();
}

// --- Relationships (Parent / Connected To / Children) -----------------------
function renderConnectedToList(record) {
  if (!elements.connectedToList) return;
  elements.connectedToList.innerHTML = "";
  const connections = record.connectedTo || [];
  if (!connections.length) {
    elements.connectedToList.innerHTML = '<p class="small text-body-secondary mb-0">Not connected to any other location yet.</p>';
    return;
  }
  connections.forEach((id) => {
    const row = createListRow({
      title: locationLabel(id),
      onRemove: () => {
        currentRecord.connectedTo = currentRecord.connectedTo.filter((entry) => entry !== id);
        renderConnectedToList(currentRecord);
        populateAddConnectionSelect();
        updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(currentRecord));
        updateActionButtons();
      },
      removeLabel: "Remove connection",
    });
    elements.connectedToList.appendChild(row);
  });
}

// Children are never stored — always computed from the Setting's location
// list by filtering on parentId, exactly like Forge's settingId filtering.
function renderChildrenList(record) {
  if (!elements.childrenList) return;
  elements.childrenList.innerHTML = "";
  const children = locationsInSetting.filter((location) => location.parentId === (currentLocationId || record?.id));
  if (!children.length) {
    elements.childrenList.textContent = "(none yet)";
    return;
  }
  children.forEach((child) => {
    const row = document.createElement("div");
    row.textContent = child.name || child.id;
    elements.childrenList.appendChild(row);
  });
}

// --- Full render / refresh ---------------------------------------------------

// The full "current state" of the Location, combining currentRecord's own
// live-mutated fields (typeId/purposeId/environment/featureIds/assets/needs/
// connectedTo — all updated directly wherever they're edited) with whatever
// isn't synced into currentRecord until save time (Name/Notes/Setting/
// Parent/NPC config). Building this without mutating currentRecord lets the
// dirty-check compare "what would be saved right now" against the last
// saved/loaded baseline without actually performing a save.
function buildLocationSnapshot() {
  if (!currentRecord) return null;
  return {
    ...currentRecord,
    name: elements.nameInput?.value.trim() || "",
    notes: elements.notesText?.value || "",
    systemIds: currentSystemId() ? [currentSystemId()] : [],
    settingId: currentSettingId || elements.settingSelect?.value || null,
    parentId: elements.parentSelect?.value || null,
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

function updateActionButtons() {
  const hasRecord = Boolean(currentRecord);
  if (elements.saveButton) elements.saveButton.disabled = !canSaveLocation();
  if (elements.exportButton) elements.exportButton.disabled = !hasRecord;
  if (elements.deleteLocationButton) elements.deleteLocationButton.disabled = !canDeleteLocation();
  spotlightControl?.refresh();
}

function refreshEditableLists() {
  if (!currentRecord) return;
  renderFeatureList(currentRecord);
  renderAssetsAndNeeds(currentRecord);
  populateAddFeatureSelect();
  updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(currentRecord));
  updateActionButtons();
}

function renderLocation(record) {
  currentRecord = record;
  if (!record) {
    locationCleanSnapshot = null;
    elements.emptyState?.classList.remove("d-none");
    elements.display?.classList.add("d-none");
    updateActionButtons();
    updateJsonPreview(elements.jsonPreview, elements.jsonBytes, null);
    return;
  }
  elements.emptyState?.classList.add("d-none");
  elements.display?.classList.remove("d-none");
  if (elements.nameInput) elements.nameInput.value = record.name || "";
  syncIdentitySelects(record);
  renderFeatureList(record);
  renderAssetsAndNeeds(record);
  populateAddFeatureSelect();
  populateNpcConfigForm(record);
  if (elements.parentSelect) elements.parentSelect.value = record.parentId || "";
  renderConnectedToList(record);
  populateAddConnectionSelect();
  renderChildrenList(record);
  if (elements.notesText) elements.notesText.value = record.notes || "";
  elements.inspectorEmpty?.classList.remove("d-none");
  elements.inspectorDetail?.classList.add("d-none");
  updateActionButtons();
  updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(record));
}

function readLockedFeatureIds() {
  if (!elements.lockedFeatures) return [];
  return Array.from(elements.lockedFeatures.selectedOptions).map((option) => option.value);
}

// --- Generate / Save / Export / Note ----------------------------------------
function handleGenerate() {
  const settingId = currentSettingId || elements.settingSelect?.value;
  if (!settingId) {
    status?.show("Select or save a Setting first.", { type: "warning", timeout: 2500 });
    return;
  }
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
    const record = createLocationRecord(generated, currentLocationId);
    // Freshly generated content is always unsaved, regardless of whatever
    // baseline a previously loaded/saved Location left behind.
    locationCleanSnapshot = null;
    renderLocation(record);
    status?.show("Location generated.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to generate: ${error.message}`, { type: "error", timeout: 4000 });
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
  currentRecord.name = name;
  currentRecord.notes = elements.notesText?.value || "";
  // systemIds (plural) is the only System-association field — matches every
  // other Library kind's convention (and what Loom's generic "Assigned
  // Systems" checkboxes read), rather than a separate singular systemId.
  currentRecord.systemIds = currentSystemId() ? [currentSystemId()] : [];
  currentRecord.settingId = settingId;
  currentRecord.parentId = elements.parentSelect?.value || null;
  Object.assign(currentRecord, collectNpcConfigFromForm());
  const id = currentLocationId || slugify(name);
  currentRecord.id = id;
  try {
    await dataManager.save("location", id, toPressExportShape(currentRecord));
    currentLocationId = id;
    status?.show("Saved.", { type: "success", timeout: 1500 });
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
  const record = toPressExportShape(currentRecord);
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${record.name || record.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleGenerateNote() {
  if (!currentRecord) return;
  currentRecord.name = elements.nameInput?.value || "";
  const originalHtml = elements.generateNoteButton?.innerHTML;
  if (elements.generateNoteButton) {
    elements.generateNoteButton.disabled = true;
    elements.generateNoteButton.innerHTML =
      '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Generating…';
  }
  try {
    const environmentLabel = currentRecord.environment
      ? environmentPropertyType?.values?.find((value) => value.id === currentRecord.environment)?.label || currentRecord.environment
      : "";
    const { name, note } = await generateLocationNote({
      name: currentRecord.name || "",
      typeLabel: currentRecord.typeId ? findById(locationTypes, currentRecord.typeId)?.name || currentRecord.typeId : "",
      purposeLabel: currentRecord.purposeId ? findById(locationPurposes, currentRecord.purposeId)?.name || currentRecord.purposeId : "",
      environmentLabel,
      features: currentRecord.featureIds.map((featureId) => {
        const feature = findById(features, featureId);
        return { name: feature?.name || featureId, description: feature?.description || "" };
      }),
      assets: (currentRecord.assets || []).map((entry) => entry.label || referenceLabel(entry.kind, entry.refId)),
      needs: (currentRecord.needs || []).map((entry) => entry.label || referenceLabel(entry.kind, entry.refId)),
    });
    currentRecord.name = name;
    currentRecord.notes = note;
    if (elements.nameInput) elements.nameInput.value = name;
    if (elements.notesText) elements.notesText.value = note;
    // Programmatic .value assignment doesn't fire input/change, so the
    // delegated dirty-check listener won't see this — refresh explicitly.
    updateActionButtons();
    status?.show("Note generated.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to generate note: ${error.message}`, { type: "error", timeout: 5000 });
  } finally {
    if (elements.generateNoteButton) {
      elements.generateNoteButton.disabled = false;
      elements.generateNoteButton.innerHTML = originalHtml;
    }
  }
}

// --- Wiring ------------------------------------------------------------------
function initCollapsibles() {
  bindCollapsibleToggle(elements.jsonToggle, elements.jsonPanel, {
    collapsed: true,
    expandLabel: "Expand JSON preview",
    collapseLabel: "Collapse JSON preview",
    labelElement: elements.jsonToggleLabel,
  });
  bindCollapsibleToggle(elements.settingToggle, elements.settingPanel, {
    collapsed: false,
    expandLabel: "Expand setting properties",
    collapseLabel: "Collapse setting properties",
    labelElement: elements.settingToggleLabel,
  });
  bindCollapsibleToggle(elements.npcConfigToggle, elements.npcConfigPanel, {
    collapsed: true,
    expandLabel: "Expand NPC Generation Config",
    collapseLabel: "Collapse NPC Generation Config",
    labelElement: elements.npcConfigToggleLabel,
  });
  bindCollapsibleToggle(elements.featuresToggle, elements.featuresPanel, {
    collapsed: false,
    expandLabel: "Expand features",
    collapseLabel: "Collapse features",
    labelElement: elements.featuresToggleLabel,
  });
  bindCollapsibleToggle(elements.assetsNeedsToggle, elements.assetsNeedsPanel, {
    collapsed: false,
    expandLabel: "Expand assets and needs",
    collapseLabel: "Collapse assets and needs",
    labelElement: elements.assetsNeedsToggleLabel,
  });
  bindCollapsibleToggle(elements.relationshipsToggle, elements.relationshipsPanel, {
    collapsed: true,
    expandLabel: "Expand relationships",
    collapseLabel: "Collapse relationships",
    labelElement: elements.relationshipsToggleLabel,
  });
  bindCollapsibleToggle(elements.notesToggle, elements.notesPanel, {
    collapsed: false,
    expandLabel: "Expand notes",
    collapseLabel: "Collapse notes",
    labelElement: elements.notesToggleLabel,
  });
}

async function init() {
  const shell = initAppShell({ namespace: "sanctum", storagePrefix: "undercroft.sanctum.undo" });
  status = shell.status;
  const auth = initAuthControls({ status });
  dataManager = auth.dataManager;

  initCollapsibles();

  elements.generateButton?.addEventListener("click", handleGenerate);
  elements.saveButton?.addEventListener("click", handleSave);
  elements.exportButton?.addEventListener("click", handleExport);
  elements.generateNoteButton?.addEventListener("click", handleGenerateNote);
  spotlightControl = initSpotlightButton({
    button: elements.spotlightButton,
    dataManager,
    status,
    getKind: () => "location",
    getId: () => currentRecord?.id,
    getLabel: () => currentRecord?.name,
  });

  elements.addFeatureButton?.addEventListener("click", () => {
    const featureId = elements.addFeatureSelect?.value;
    if (featureId) addFeature(featureId);
  });

  elements.identityTypeSelect?.addEventListener("change", () => {
    if (!currentRecord) return;
    currentRecord.typeId = elements.identityTypeSelect.value || null;
    updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(currentRecord));
  });
  elements.identityPurposeSelect?.addEventListener("change", () => {
    if (!currentRecord) return;
    currentRecord.purposeId = elements.identityPurposeSelect.value || null;
    updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(currentRecord));
  });
  elements.identityEnvironmentSelect?.addEventListener("change", () => {
    if (!currentRecord) return;
    currentRecord.environment = elements.identityEnvironmentSelect.value || null;
    updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(currentRecord));
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

  elements.addSpeciesWeightButton?.addEventListener("click", () => renderSpeciesWeightRow());
  elements.speciesWeightRows?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-species-weight]")) {
      event.target.closest(".d-flex").remove();
      updateSpeciesWeightTotal();
    }
  });
  elements.speciesWeightRows?.addEventListener("input", (event) => {
    if (event.target.matches("[data-species-weight-value]")) updateSpeciesWeightTotal();
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

  elements.addConnectionButton?.addEventListener("click", () => {
    const id = elements.addConnectionSelect?.value;
    if (!id || !currentRecord) return;
    if (!currentRecord.connectedTo.includes(id)) currentRecord.connectedTo.push(id);
    renderConnectedToList(currentRecord);
    populateAddConnectionSelect();
    updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(currentRecord));
    updateActionButtons();
  });

  // Delegated live-dirty-check: any text/number/range/select edit anywhere
  // in the Location display (Name, Notes, Identity selects, Parent select,
  // NPC Generation Config fields) re-evaluates whether Save should light
  // up, without needing an individual listener wired to every single field.
  // Add/remove actions (Features/Assets/Needs/Connected To) are button
  // clicks, not input/change events, so they already call
  // updateActionButtons() explicitly at their own call sites above.
  elements.display?.addEventListener("input", updateActionButtons);
  elements.display?.addEventListener("change", updateActionButtons);

  elements.systemSelect?.addEventListener("change", async () => {
    currentSettingId = null;
    currentLocationId = null;
    await reloadReferenceData();
    await populateSettingSelect(currentSystemId());
    populateSettingForm(null);
    await reloadLocationsForSetting(null);
    renderLocation(null);
  });

  elements.settingSelect?.addEventListener("change", async () => {
    const settingId = elements.settingSelect.value;
    currentSettingId = settingId || null;
    currentLocationId = null;
    await loadSettingIntoForm(settingId);
    await reloadLocationsForSetting(settingId);
    renderLocation(null);
  });

  elements.settingNameInput?.addEventListener("input", updateSettingToolbarState);
  elements.settingDescriptionInput?.addEventListener("input", updateSettingToolbarState);

  elements.newSettingButton?.addEventListener("click", () => {
    if (elements.settingSelect) elements.settingSelect.value = "";
    currentSettingId = null;
    populateSettingForm(null);
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
    try {
      await dataManager.save("setting", id, {
        kind: "setting",
        systemIds: [systemId],
        name,
        description: elements.settingDescriptionInput?.value.trim() || "",
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
    if (!window.confirm(`Delete setting "${currentSettingId}"? This can't be undone.`)) return;
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

  elements.locationSelect?.addEventListener("change", async () => {
    const id = elements.locationSelect.value;
    currentLocationId = id || null;
    if (!id) {
      renderLocation(null);
      return;
    }
    try {
      const result = await dataManager.get("location", id);
      renderLocation(createLocationRecord(result?.payload || {}, id));
      markLocationClean();
    } catch (error) {
      status?.show(`Unable to load location: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });

  elements.deleteLocationButton?.addEventListener("click", async () => {
    if (!dataManager || !currentLocationId) return;
    if (!window.confirm(`Delete location "${currentLocationId}"? This can't be undone.`)) return;
    const settingId = currentSettingId || elements.settingSelect?.value || null;
    try {
      await dataManager.delete("location", currentLocationId);
      status?.show("Deleted.", { type: "success", timeout: 2000 });
      currentLocationId = null;
      if (elements.locationSelect) elements.locationSelect.value = "";
      renderLocation(null);
      await reloadLocationsForSetting(settingId);
    } catch (error) {
      status?.show(`Unable to delete: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });

  await populateSystemSelect();
  await reloadReferenceData();
  await populateSettingSelect(currentSystemId());
  populateSettingForm(null);
  await reloadLocationsForSetting(null);
  renderLocation(null);

  initHelpSystem();
  refreshTooltips();
}

init();
