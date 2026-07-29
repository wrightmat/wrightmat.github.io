import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { updateJsonPreview } from "../../common/js/lib/json-preview.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { listFeaturesForSystem, getSystemPropertyTypes } from "./lib/tables.js";
import { generateEffect, computeBudget } from "./lib/generator.js";
import { createEffectRecord, toPressExportShape } from "./lib/effect-schema.js";
import { generateEffectNote } from "./lib/llm-note.js";
import { createDirtyGate } from "../../common/js/lib/dirty-gate.js";
import {
  listAllSystems,
  findById,
  featureLabel as sharedFeatureLabel,
  readLockedFeatureIds as sharedReadLockedFeatureIds,
  exportRecordAsJson,
  generateNoteForRecord,
} from "../../common/js/lib/generator-kit.js";
import { confirmDelete } from "../../common/js/lib/ownership.js";

let status = null;
let dataManager = null;
let features = [];
let propertyTypes = [];
let currentRecord = null;
// Tracks whether the record as last successfully saved differs from a live
// snapshot — built from currentRecord (feature add/remove already patches it
// directly) plus whatever's currently typed into Name/Notes, since those two
// fields aren't written back into currentRecord until Save/Export actually
// runs. Gates Save (dirty) and Delete (nothing saved yet) — see
// common/js/lib/dirty-gate.js, lifted from Crucible's original version of
// this exact pattern.
const dirtyGate = createDirtyGate({ buildSnapshot: () => toPressExportShape(buildRecordForSave()) });

const elements = {
  systemSelect: document.querySelector("[data-system-select]"),
  budgetCeilingFieldSelect: document.querySelector("[data-budget-ceiling-field]"),
  propertyOverridesContainer: document.querySelector("[data-property-overrides]"),
  signatureOverride: document.querySelector("[data-signature-feature-override]"),
  lockedFeatures: document.querySelector("[data-locked-features]"),
  generateButton: document.querySelector("[data-generate-effect]"),
  saveButton: document.querySelector("[data-save-effect]"),
  exportButton: document.querySelector("[data-export-effect]"),
  deleteButton: document.querySelector("[data-delete-effect]"),
  emptyState: document.querySelector("[data-effect-empty-state]"),
  display: document.querySelector("[data-effect-display]"),
  nameInput: document.querySelector("[data-effect-name]"),
  identityFields: document.querySelector("[data-identity-fields]"),
  featureList: document.querySelector("[data-feature-list]"),
  addFeatureSelect: document.querySelector("[data-add-feature-select]"),
  addFeatureButton: document.querySelector("[data-add-feature-button]"),
  budgetTarget: document.querySelector("[data-budget-target]"),
  budgetSpent: document.querySelector("[data-budget-spent]"),
  budgetRemaining: document.querySelector("[data-budget-remaining]"),
  notesText: document.querySelector("[data-notes-text]"),
  generateNoteButton: document.querySelector("[data-generate-note]"),
  jsonPreview: document.querySelector("[data-effect-json-preview]"),
  jsonBytes: document.querySelector("[data-effect-json-bytes]"),
  inspectorEmpty: document.querySelector("[data-inspector-empty]"),
  inspectorDetail: document.querySelector("[data-inspector-detail]"),
  inspectorJson: document.querySelector("[data-inspector-json]"),
  inspectorToggle: document.querySelector("[data-inspector-toggle]"),
  inspectorToggleLabel: document.querySelector("[data-inspector-toggle-label]"),
  inspectorPanel: document.querySelector("[data-inspector-panel]"),
};

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

function getBudgetCeilingFieldPreference(systemId) {
  if (!dataManager || !systemId) return "";
  return dataManager.getLocal(BUDGET_CEILING_BUCKET, systemId)?.budgetCeilingField || "";
}

function setBudgetCeilingFieldPreference(systemId, fieldKey) {
  if (!dataManager || !systemId) return;
  if (fieldKey) {
    dataManager.saveLocal(BUDGET_CEILING_BUCKET, systemId, { budgetCeilingField: fieldKey });
  } else {
    dataManager.removeLocal(BUDGET_CEILING_BUCKET, systemId);
  }
}

function populateBudgetCeilingFieldSelect(selectedFieldKey) {
  const select = elements.budgetCeilingFieldSelect;
  if (!select) return;
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "None";
  select.appendChild(blank);
  propertyTypes.forEach((propertyType) => {
    const option = document.createElement("option");
    option.value = propertyType.id;
    option.textContent = propertyType.label || propertyType.id;
    select.appendChild(option);
  });
  if (propertyTypes.some((propertyType) => propertyType.id === selectedFieldKey)) {
    select.value = selectedFieldKey;
  }
}

async function populateSystemSelect() {
  const systems = await listAllSystems(dataManager);
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

// Signature Effect is an optional override — blank = "Random" — exactly like
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

// One dropdown per System-defined property type — nothing here is
// hardcoded to "Rarity"/"Activation"/"Form" as concepts; whatever
// propertyTypes the active System defines is what gets rendered.
function populatePropertyOverrides() {
  if (!elements.propertyOverridesContainer) return;
  const previous = readPropertyOverrides();
  elements.propertyOverridesContainer.innerHTML = "";
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
  });
}

function readPropertyOverrides() {
  const overrides = {};
  if (!elements.propertyOverridesContainer) return overrides;
  Array.from(elements.propertyOverridesContainer.querySelectorAll("[data-property-override]")).forEach((select) => {
    if (select.value) overrides[select.dataset.propertyOverride] = select.value;
  });
  return overrides;
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

async function reloadReferenceData() {
  const systemId = currentSystemId();
  const budgetCeilingField = getBudgetCeilingFieldPreference(systemId);
  [features, propertyTypes] = await Promise.all([
    listFeaturesForSystem(dataManager, systemId),
    getSystemPropertyTypes(dataManager, systemId, budgetCeilingField),
  ]);
  populatePropertyOverrides();
  populateOverrideSelect(elements.signatureOverride, features, "Random");
  populateLockedFeaturesSelect();
  populateAddFeatureSelect();
  populateBudgetCeilingFieldSelect(budgetCeilingField);
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

function renderIdentity(record) {
  if (!elements.identityFields) return;
  elements.identityFields.innerHTML = "";
  const rows = propertyTypes.map((propertyType) => [
    propertyType.label || propertyType.id,
    propertyValueLabel(propertyType.id, record.properties?.[propertyType.id]),
  ]);
  rows.push(["Signature Effect", record.signatureFeatureId ? featureLabel(record.signatureFeatureId) : "(none)"]);
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

// Recomputed fresh from whatever's currently selected — kept in sync with
// the shared computeBudget helper so the automatic generator and manual
// add/remove editing can never disagree about the running total.
function recomputeBudget(record) {
  const selectedFeatures = record.featureIds.map((id) => findById(features, id)).filter(Boolean);
  record.budget = computeBudget(selectedFeatures, record.properties, propertyTypes);
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
    const cost = Number(feature?.budgetCost ?? 0);

    const row = document.createElement("div");
    row.className = "border rounded-3 p-2 d-flex align-items-start justify-content-between gap-2";
    row.dataset.featureRow = featureId;

    const info = document.createElement("div");
    info.className = "flex-grow-1";

    const header = document.createElement("div");
    header.className = "d-flex align-items-center gap-2 flex-wrap";
    const name = document.createElement("span");
    name.className = "fw-semibold";
    name.textContent = feature?.name || featureId;
    header.appendChild(name);
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
    description.textContent = feature?.description || "";

    info.append(header, description);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn btn-outline-danger btn-sm flex-shrink-0";
    removeButton.setAttribute("aria-label", "Remove feature");
    removeButton.innerHTML = '<span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>';
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeFeature(featureId);
    });

    row.append(info, removeButton);
    row.addEventListener("click", () => selectFeatureRow(featureId));
    elements.featureList.appendChild(row);
  });
}

function refreshEffectView() {
  if (!currentRecord) return;
  renderFeatureList(currentRecord);
  renderBudget(currentRecord);
  populateAddFeatureSelect();
  updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(currentRecord));
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
  currentRecord.featureIds = currentRecord.featureIds.filter((id) => id !== featureId);
  if (currentRecord.signatureFeatureId === featureId) currentRecord.signatureFeatureId = null;
  recomputeBudget(currentRecord);
  refreshEffectView();
}

function addFeature(featureId) {
  if (!currentRecord || !featureId) return;
  if (!currentRecord.featureIds.includes(featureId)) currentRecord.featureIds.push(featureId);
  recomputeBudget(currentRecord);
  refreshEffectView();
}

function readLockedFeatureIds() {
  return sharedReadLockedFeatureIds(elements.lockedFeatures);
}

function updateActionButtons() {
  const hasRecord = Boolean(currentRecord);
  if (elements.saveButton) elements.saveButton.disabled = !hasRecord || !dirtyGate.isDirty();
  if (elements.exportButton) elements.exportButton.disabled = !hasRecord;
  if (elements.deleteButton) elements.deleteButton.disabled = !hasRecord || !dirtyGate.hasSaved();
}

function renderEffect(record) {
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
  renderBudget(record);
  populateAddFeatureSelect();
  if (elements.notesText) elements.notesText.value = record.notes || "";
  elements.inspectorEmpty?.classList.remove("d-none");
  elements.inspectorDetail?.classList.add("d-none");
  updateActionButtons();
  updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(record));
}

function handleGenerate() {
  try {
    const generated = generateEffect(features, propertyTypes, {
      systemId: currentSystemId() || null,
      signatureFeatureId: elements.signatureOverride?.value || "",
      lockedFeatureIds: readLockedFeatureIds(),
      propertyOverrides: readPropertyOverrides(),
    });
    const record = createEffectRecord(generated);
    dirtyGate.markDirty();
    renderEffect(record);
    status?.show("Effect generated.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to generate: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

async function handleSave() {
  if (!currentRecord || !dataManager) return;
  currentRecord.name = elements.nameInput?.value || "";
  currentRecord.notes = elements.notesText?.value || "";
  try {
    // Default mode ("auto") matters here exactly like Crucible/Forge's save:
    // an anonymous GM saves locally to their own browser, a signed-in user
    // gets a real owned/shareable record — Vault has no whole-tool login gate.
    const exported = toPressExportShape(currentRecord);
    await dataManager.save("effect", currentRecord.id, exported);
    dirtyGate.markClean(exported);
    updateActionButtons();
    status?.show("Saved.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

async function handleDelete() {
  if (!currentRecord || !dataManager || !dirtyGate.hasSaved()) return;
  const label = currentRecord.name || currentRecord.id;
  if (!confirmDelete({ label: `"${label}"` })) return;
  try {
    await dataManager.delete("effect", currentRecord.id);
    status?.show("Deleted.", { type: "success", timeout: 1500 });
    dirtyGate.markDirty();
    renderEffect(null);
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

async function handleGenerateNote() {
  const success = await generateNoteForRecord({
    record: currentRecord,
    elements,
    status,
    generateNote: generateEffectNote,
    // Leave name blank rather than falling back to record.id here — an id
    // like "eff_abc123" would look like a real name to the server and stop
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
  if (success) updateActionButtons();
}

async function init() {
  const shell = initAppShell({ namespace: "vault", storagePrefix: "undercroft.vault.undo" });
  status = shell.status;
  const auth = initAuthControls({
    status,
  });
  dataManager = auth.dataManager;

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
  elements.exportButton?.addEventListener("click", handleExport);
  elements.deleteButton?.addEventListener("click", handleDelete);
  elements.generateNoteButton?.addEventListener("click", handleGenerateNote);
  elements.addFeatureButton?.addEventListener("click", () => {
    const featureId = elements.addFeatureSelect?.value;
    if (featureId) addFeature(featureId);
  });
  elements.systemSelect?.addEventListener("change", () => reloadReferenceData());
  elements.budgetCeilingFieldSelect?.addEventListener("change", () => {
    const fieldKey = elements.budgetCeilingFieldSelect.value;
    setBudgetCeilingFieldPreference(currentSystemId(), fieldKey);
    propertyTypes.forEach((propertyType) => {
      propertyType.setsBudgetCeiling = propertyType.id === fieldKey;
    });
    if (currentRecord) {
      recomputeBudget(currentRecord);
      refreshEffectView();
    }
  });
  // Name/Notes aren't written back into currentRecord until Save/Export
  // actually runs (see buildRecordForSave) — without this, editing either
  // field wouldn't re-enable an already-saved record's Save button until
  // some unrelated re-render happened to call updateActionButtons() again.
  elements.nameInput?.addEventListener("input", updateActionButtons);
  elements.notesText?.addEventListener("input", updateActionButtons);

  bindCollapsibleToggle(elements.inspectorToggle, elements.inspectorPanel, {
    collapsed: false,
    expandLabel: "Expand inspector",
    collapseLabel: "Collapse inspector",
    labelElement: elements.inspectorToggleLabel,
  });

  await populateSystemSelect();
  await reloadReferenceData();
  renderEffect(null);

  initHelpSystem();
  refreshTooltips();
}

init();
