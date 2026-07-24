import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initSpotlightButton } from "../../common/js/lib/spotlight.js";
import { updateJsonPreview } from "../../common/js/lib/json-preview.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import {
  listCreatureTypesForSystem,
  listArchetypesForSystem,
  listRolesForSystem,
  listFeaturesForSystem,
} from "./lib/tables.js";
import { generateMonster } from "./lib/generator.js";
import { createMonsterRecord, toPressExportShape } from "./lib/monster-schema.js";
import { generateMonsterNote } from "./lib/llm-note.js";

let status = null;
let dataManager = null;
let creatureTypes = [];
let archetypes = [];
let roles = [];
let features = [];
let currentRecord = null;
// Handle returned by initSpotlightButton — its refresh() is the single
// source of truth for the button's disabled state (has a record AND an
// active campaign group), called alongside every other action-button gate.
let spotlightControl = null;

const elements = {
  systemSelect: document.querySelector("[data-system-select]"),
  creatureTypeOverride: document.querySelector("[data-creature-type-override]"),
  archetypeOverride: document.querySelector("[data-archetype-override]"),
  roleOverride: document.querySelector("[data-role-override]"),
  signatureOverride: document.querySelector("[data-signature-feature-override]"),
  lockedFeatures: document.querySelector("[data-locked-features]"),
  generateButton: document.querySelector("[data-generate-monster]"),
  saveButton: document.querySelector("[data-save-monster]"),
  exportButton: document.querySelector("[data-export-monster]"),
  spotlightButton: document.querySelector("[data-spotlight-monster]"),
  emptyState: document.querySelector("[data-monster-empty-state]"),
  display: document.querySelector("[data-monster-display]"),
  nameInput: document.querySelector("[data-monster-name]"),
  identityFields: document.querySelector("[data-identity-fields]"),
  featureList: document.querySelector("[data-feature-list]"),
  recipeSummary: document.querySelector("[data-recipe-summary]"),
  notesText: document.querySelector("[data-notes-text]"),
  generateNoteButton: document.querySelector("[data-generate-note]"),
  jsonPreview: document.querySelector("[data-monster-json-preview]"),
  jsonBytes: document.querySelector("[data-monster-json-bytes]"),
  inspectorEmpty: document.querySelector("[data-inspector-empty]"),
  inspectorDetail: document.querySelector("[data-inspector-detail]"),
  inspectorJson: document.querySelector("[data-inspector-json]"),
};

function currentSystemId() {
  return elements.systemSelect?.value || "";
}

// Systems themselves are still the "systems" DataManager bucket (same as
// every other tool) — Creature Type/Archetype/Role/Feature are the four new
// kinds specific to Crucible, cascading off whichever System is selected.
async function listAllSystems() {
  if (!dataManager) return [];
  try {
    const listing = await dataManager.list("systems", { refresh: true });
    const entries = dataManager.collectListEntries(listing.remote, ["items", "owned", "shared", "public"]);
    return entries
      .map((entry) => ({ id: entry.id, title: entry.title || entry.id }))
      .sort((a, b) => a.title.localeCompare(b.title));
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
  if (systems.some((system) => system.id === previous)) {
    elements.systemSelect.value = previous;
  }
  return systems;
}

// Creature Type / Archetype / Role / signature Feature are all optional
// overrides — blank = "Random" — exactly like Forge's Species/Archetype/
// Alignment/Gender selects, not a required cascade.
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
  if (!elements.lockedFeatures) return;
  const previouslySelected = new Set(
    Array.from(elements.lockedFeatures.selectedOptions).map((option) => option.value)
  );
  elements.lockedFeatures.innerHTML = "";
  features.forEach((feature) => {
    const option = document.createElement("option");
    option.value = feature.id;
    option.textContent = feature.name || feature.id;
    option.selected = previouslySelected.has(feature.id);
    elements.lockedFeatures.appendChild(option);
  });
}

async function reloadReferenceData() {
  const systemId = currentSystemId();
  [creatureTypes, archetypes, roles, features] = await Promise.all([
    listCreatureTypesForSystem(dataManager, systemId),
    listArchetypesForSystem(dataManager, systemId),
    listRolesForSystem(dataManager, systemId),
    listFeaturesForSystem(dataManager, systemId),
  ]);
  populateOverrideSelect(elements.creatureTypeOverride, creatureTypes, "Random");
  populateOverrideSelect(elements.archetypeOverride, archetypes, "Random");
  populateOverrideSelect(elements.roleOverride, roles, "Random");
  populateOverrideSelect(elements.signatureOverride, features, "Random");
  populateLockedFeaturesSelect();
}

function findById(list, id) {
  return list.find((entry) => entry.id === id) || null;
}

function featureLabel(id) {
  const feature = findById(features, id);
  return feature ? feature.name || feature.id : id;
}

function renderIdentity(record) {
  if (!elements.identityFields) return;
  elements.identityFields.innerHTML = "";
  const rows = [
    ["Creature Type", findById(creatureTypes, record.creatureTypeId)?.name || record.creatureTypeId],
    ["Archetype", findById(archetypes, record.archetypeId)?.name || record.archetypeId],
    ["Role", findById(roles, record.roleId)?.name || record.roleId],
    ["Signature Feature", record.signatureFeatureId ? featureLabel(record.signatureFeatureId) : "(unfulfilled)"],
  ];
  rows.forEach(([label, value]) => {
    const col = document.createElement("div");
    col.className = "col-6 col-md-3";
    const labelEl = document.createElement("div");
    labelEl.className = "small text-body-secondary text-uppercase";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "fw-semibold";
    valueEl.textContent = value;
    col.append(labelEl, valueEl);
    elements.identityFields.appendChild(col);
  });
}

function selectFeatureRow(featureId) {
  Array.from(elements.featureList?.querySelectorAll("[data-feature-row]") || []).forEach((row) => {
    row.classList.toggle("crucible-feature-selected", row.dataset.featureRow === featureId);
  });
  const feature = findById(features, featureId);
  if (!feature) {
    elements.inspectorEmpty?.classList.remove("d-none");
    elements.inspectorDetail?.classList.add("d-none");
    return;
  }
  elements.inspectorEmpty?.classList.add("d-none");
  elements.inspectorDetail?.classList.remove("d-none");
  if (elements.inspectorJson) elements.inspectorJson.textContent = JSON.stringify(feature, null, 2);
}

function renderFeatureList(record) {
  if (!elements.featureList) return;
  elements.featureList.innerHTML = "";
  record.featureIds.forEach((featureId) => {
    const feature = findById(features, featureId);
    const isSignature = featureId === record.signatureFeatureId;
    const row = document.createElement("div");
    row.className = "border rounded-3 p-2";
    row.dataset.featureRow = featureId;

    const header = document.createElement("div");
    header.className = "d-flex align-items-center justify-content-between gap-2";
    const name = document.createElement("span");
    name.className = "fw-semibold";
    name.textContent = feature?.name || featureId;
    header.appendChild(name);
    if (isSignature) {
      const badge = document.createElement("span");
      badge.className = "badge text-bg-primary ms-1";
      badge.textContent = "Signature";
      header.appendChild(badge);
    }

    const description = document.createElement("div");
    description.className = "small text-body-secondary";
    description.textContent = feature?.description || "";

    row.append(header, description);
    row.addEventListener("click", () => selectFeatureRow(featureId));
    elements.featureList.appendChild(row);
  });
}

function renderRecipeSummary(record) {
  if (!elements.recipeSummary) return;
  elements.recipeSummary.innerHTML = "";
  const fulfillment = record.recipeFulfillment || {};
  const rows = [["Signature", fulfillment.signatureSlot === "filled" ? "Filled" : "Unfulfilled"]];
  Object.entries(fulfillment.requiredSlots || {}).forEach(([slot, featureId]) => {
    rows.push([`Required: ${slot}`, featureId ? featureLabel(featureId) : "Unfulfilled"]);
  });
  Object.entries(fulfillment.optionalSlots || {}).forEach(([slot, featureId]) => {
    rows.push([`Optional: ${slot}`, featureId ? featureLabel(featureId) : "(not filled)"]);
  });
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "d-flex justify-content-between gap-2";
    const labelEl = document.createElement("span");
    labelEl.className = "text-body-secondary";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    elements.recipeSummary.appendChild(row);
  });
}

function updateActionButtons() {
  const hasRecord = Boolean(currentRecord);
  if (elements.saveButton) elements.saveButton.disabled = !hasRecord;
  if (elements.exportButton) elements.exportButton.disabled = !hasRecord;
  spotlightControl?.refresh();
}

function renderMonster(record) {
  currentRecord = record;
  if (!record) {
    elements.emptyState?.classList.remove("d-none");
    elements.display?.classList.add("d-none");
    updateActionButtons();
    updateJsonPreview(elements.jsonPreview, elements.jsonBytes, null);
    return;
  }
  elements.emptyState?.classList.add("d-none");
  elements.display?.classList.remove("d-none");
  if (elements.nameInput) elements.nameInput.value = record.name || "";
  renderIdentity(record);
  renderFeatureList(record);
  renderRecipeSummary(record);
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

function handleGenerate() {
  try {
    const generated = generateMonster(creatureTypes, archetypes, roles, features, {
      systemId: currentSystemId() || null,
      creatureTypeId: elements.creatureTypeOverride?.value || "",
      archetypeId: elements.archetypeOverride?.value || "",
      roleId: elements.roleOverride?.value || "",
      signatureFeatureId: elements.signatureOverride?.value || "",
      lockedFeatureIds: readLockedFeatureIds(),
    });
    const record = createMonsterRecord(generated);
    renderMonster(record);
    status?.show("Monster generated.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to generate: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

async function handleSave() {
  if (!currentRecord || !dataManager) return;
  currentRecord.name = elements.nameInput?.value || "";
  currentRecord.notes = elements.notesText?.value || "";
  try {
    // Default mode ("auto") matters here exactly like Forge's NPC save: an
    // anonymous GM saves locally to their own browser, a signed-in user gets
    // a real owned/shareable record — Crucible has no whole-tool login gate.
    await dataManager.save("monster", currentRecord.id, toPressExportShape(currentRecord));
    status?.show("Saved.", { type: "success", timeout: 1500 });
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
    // Leave name blank rather than falling back to currentRecord.id here —
    // an id like "mon_abc123" would look like a real name to the server and
    // stop it from suggesting one.
    const { name, note } = await generateMonsterNote({
      name: currentRecord.name || "",
      creatureType: findById(creatureTypes, currentRecord.creatureTypeId)?.name || currentRecord.creatureTypeId,
      archetype: findById(archetypes, currentRecord.archetypeId)?.name || currentRecord.archetypeId,
      role: findById(roles, currentRecord.roleId)?.name || currentRecord.roleId,
      signatureFeature: currentRecord.signatureFeatureId ? featureLabel(currentRecord.signatureFeatureId) : "",
      features: currentRecord.featureIds.map((featureId) => {
        const feature = findById(features, featureId);
        return { name: feature?.name || featureId, description: feature?.description || "" };
      }),
    });
    currentRecord.name = name;
    currentRecord.notes = note;
    if (elements.nameInput) elements.nameInput.value = name;
    if (elements.notesText) elements.notesText.value = note;
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

async function init() {
  const shell = initAppShell({ namespace: "crucible", storagePrefix: "undercroft.crucible.undo" });
  status = shell.status;
  const auth = initAuthControls({ status });
  dataManager = auth.dataManager;

  elements.generateButton?.addEventListener("click", handleGenerate);
  elements.saveButton?.addEventListener("click", handleSave);
  elements.exportButton?.addEventListener("click", handleExport);
  spotlightControl = initSpotlightButton({
    button: elements.spotlightButton,
    dataManager,
    status,
    getKind: () => "monster",
    getId: () => currentRecord?.id,
    getLabel: () => currentRecord?.name,
  });
  elements.generateNoteButton?.addEventListener("click", handleGenerateNote);
  elements.systemSelect?.addEventListener("change", () => reloadReferenceData());

  await populateSystemSelect();
  await reloadReferenceData();
  renderMonster(null);

  initHelpSystem();
  refreshTooltips();
}

init();
