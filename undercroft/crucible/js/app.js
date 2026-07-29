import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { updateJsonPreview } from "../../common/js/lib/json-preview.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import {
  listCreatureTypesForSystem,
  listArchetypesForSystem,
  listRolesForSystem,
  listFeaturesForSystem,
  loadCombatScalingLevels,
  listArrayFieldOptions,
  loadAbilityFieldDefs,
} from "./lib/tables.js";
import { generateMonster } from "./lib/generator.js";
import { deriveStats } from "./lib/stats.js";
import { createMonsterRecord, toPressExportShape } from "./lib/monster-schema.js";
import { generateMonsterNote } from "./lib/llm-note.js";
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
let creatureTypes = [];
let archetypes = [];
let roles = [];
let features = [];
let combatScalingLevels = [];
let arrayFieldOptions = [];
// The active System's own ability key/label list (see stats.js#deriveStats,
// which reads this same data independently for generation) — kept here too
// so renderStats' display rows use the System's real ability vocabulary
// instead of a second hardcoded STR/DEX/CON/INT/WIS/CHA copy.
let abilityFieldDefs = [];
let currentRecord = null;
// Tracks whether the record as last successfully saved differs from a live
// snapshot — built from currentRecord plus whatever's currently typed into
// Name/Notes, since those two fields aren't written back into currentRecord
// until Save/Export actually runs — to gate the Save button the same way
// Loom/Workbench's editors do, and to know whether Delete has anything real
// on the server to target (see common/js/lib/dirty-gate.js).
const dirtyGate = createDirtyGate({ buildSnapshot: () => toPressExportShape(buildRecordForSave()) });

const elements = {
  systemSelect: document.querySelector("[data-system-select]"),
  creatureTypeOverride: document.querySelector("[data-creature-type-override]"),
  archetypeOverride: document.querySelector("[data-archetype-override]"),
  roleOverride: document.querySelector("[data-role-override]"),
  combatScalingOverride: document.querySelector("[data-combat-scaling-override]"),
  combatScalingFieldSelect: document.querySelector("[data-combat-scaling-field]"),
  signatureOverride: document.querySelector("[data-signature-feature-override]"),
  lockedFeatures: document.querySelector("[data-locked-features]"),
  generateButton: document.querySelector("[data-generate-monster]"),
  saveButton: document.querySelector("[data-save-monster]"),
  deleteButton: document.querySelector("[data-delete-monster]"),
  exportButton: document.querySelector("[data-export-monster]"),
  emptyState: document.querySelector("[data-monster-empty-state]"),
  display: document.querySelector("[data-monster-display]"),
  nameInput: document.querySelector("[data-monster-name]"),
  identityFields: document.querySelector("[data-identity-fields]"),
  featureList: document.querySelector("[data-feature-list]"),
  recipeSummary: document.querySelector("[data-recipe-summary]"),
  statsFields: document.querySelector("[data-stats-fields]"),
  statsActions: document.querySelector("[data-stats-actions]"),
  statsBudget: document.querySelector("[data-stats-budget]"),
  notesText: document.querySelector("[data-notes-text]"),
  generateNoteButton: document.querySelector("[data-generate-note]"),
  jsonPreview: document.querySelector("[data-monster-json-preview]"),
  jsonBytes: document.querySelector("[data-monster-json-bytes]"),
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

// Which array field Crucible treats as combat-scaling data is a Crucible tool
// preference, not System data — it's not game content, it's "which of this
// System's fields does Crucible's own generator special-case," so it lives in
// this browser's local storage (keyed per System), never in the System record
// edited in Loom. Mirrors Vault's budgetCeilingField preference exactly (see
// vault/js/app.js).
const COMBAT_SCALING_BUCKET = "crucible-settings";

function getCombatScalingFieldPreference(systemId) {
  if (!dataManager || !systemId) return "";
  return dataManager.getLocal(COMBAT_SCALING_BUCKET, systemId)?.combatScalingField || "";
}

function setCombatScalingFieldPreference(systemId, fieldKey) {
  if (!dataManager || !systemId) return;
  if (fieldKey) {
    dataManager.saveLocal(COMBAT_SCALING_BUCKET, systemId, { combatScalingField: fieldKey });
  } else {
    dataManager.removeLocal(COMBAT_SCALING_BUCKET, systemId);
  }
}

function populateCombatScalingFieldSelect(selectedFieldKey) {
  const select = elements.combatScalingFieldSelect;
  if (!select) return;
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "None";
  select.appendChild(blank);
  arrayFieldOptions.forEach((field) => {
    const option = document.createElement("option");
    option.value = field.key;
    option.textContent = field.label || field.key;
    select.appendChild(option);
  });
  if (arrayFieldOptions.some((field) => field.key === selectedFieldKey)) {
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
  const combatScalingField = getCombatScalingFieldPreference(systemId);
  [creatureTypes, archetypes, roles, features, combatScalingLevels, arrayFieldOptions, abilityFieldDefs] = await Promise.all([
    listCreatureTypesForSystem(dataManager, systemId),
    listArchetypesForSystem(dataManager, systemId),
    listRolesForSystem(dataManager, systemId),
    listFeaturesForSystem(dataManager, systemId),
    loadCombatScalingLevels(dataManager, systemId, combatScalingField || undefined),
    listArrayFieldOptions(dataManager, systemId),
    loadAbilityFieldDefs(dataManager, systemId),
  ]);
  populateOverrideSelect(elements.creatureTypeOverride, creatureTypes, "Random");
  populateOverrideSelect(elements.archetypeOverride, archetypes, "Random");
  populateOverrideSelect(elements.roleOverride, roles, "Random");
  populateOverrideSelect(elements.combatScalingOverride, combatScalingLevels, "Random");
  populateOverrideSelect(elements.signatureOverride, features, "Random");
  populateLockedFeaturesSelect();
  populateCombatScalingFieldSelect(combatScalingField);
}

function featureLabel(id) {
  return sharedFeatureLabel(features, id);
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

function statField(label, value) {
  const col = document.createElement("div");
  col.className = "col-6 col-md-3";
  const labelEl = document.createElement("div");
  labelEl.className = "small text-body-secondary text-uppercase";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = "fw-semibold";
  valueEl.textContent = value;
  col.append(labelEl, valueEl);
  return col;
}

function renderStats(record) {
  if (!elements.statsFields) return;
  elements.statsFields.innerHTML = "";
  if (elements.statsActions) elements.statsActions.innerHTML = "";
  if (elements.statsBudget) elements.statsBudget.textContent = "";
  const stats = record.stats;
  if (!stats) return;

  const abilities = stats.abilities || {};
  const hitPoints = stats.hitPoints || {};
  const rows = [
    ["Challenge", stats.challengeRating || "—"],
    ["Armor Class", stats.armorClass ?? "—"],
    ["Hit Points", hitPoints.max != null ? `${hitPoints.current ?? hitPoints.max}/${hitPoints.max}` : "—"],
    ["Save DC", stats.saveDC ?? "—"],
    // Whichever ability keys the active System actually defines (see
    // abilityFieldDefs above) — not a fixed STR/DEX/CON/INT/WIS/CHA list.
    ...abilityFieldDefs.map(({ key, label }) => [label, abilities[key] ?? "—"]),
  ];
  if (stats.damageResistances?.length) rows.push(["Resistances", stats.damageResistances.join(", ")]);
  if (stats.damageImmunities?.length) rows.push(["Immunities", stats.damageImmunities.join(", ")]);
  if (stats.senses?.length) rows.push(["Senses", stats.senses.join(", ")]);
  rows.forEach(([label, value]) => elements.statsFields.appendChild(statField(label, value)));

  (stats.actions || []).forEach((action) => {
    const row = document.createElement("div");
    row.className = "d-flex justify-content-between gap-2";
    const labelEl = document.createElement("span");
    labelEl.className = "text-body-secondary";
    labelEl.textContent = action.name;
    const valueEl = document.createElement("span");
    const bonus = action.attackBonus >= 0 ? `+${action.attackBonus}` : `${action.attackBonus}`;
    valueEl.textContent = `${bonus} to hit, ${action.damageDice} ${action.damageType || ""} damage`.trim();
    row.append(labelEl, valueEl);
    elements.statsActions?.appendChild(row);
  });

  if (stats.budget && elements.statsBudget) {
    const { target, spent, remaining } = stats.budget;
    elements.statsBudget.textContent = `Feature budget: ${spent} / ${target} spent (${remaining} remaining)`;
  }
}

// What Save/Export would actually write right now — currentRecord.name/
// .notes only get synced from their input fields inside handleSave/
// handleExport themselves, so a live dirty-check needs this instead of
// reading currentRecord directly (a name/notes edit wouldn't otherwise be
// visible until the next save).
function buildRecordForSave() {
  if (!currentRecord) return null;
  return {
    ...currentRecord,
    name: elements.nameInput?.value || "",
    notes: elements.notesText?.value || "",
  };
}

function updateActionButtons() {
  const hasRecord = Boolean(currentRecord);
  if (elements.saveButton) elements.saveButton.disabled = !hasRecord || !dirtyGate.isDirty();
  if (elements.deleteButton) elements.deleteButton.disabled = !hasRecord || !dirtyGate.hasSaved();
  if (elements.exportButton) elements.exportButton.disabled = !hasRecord;
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
  renderStats(record);
  if (elements.notesText) elements.notesText.value = record.notes || "";
  elements.inspectorEmpty?.classList.remove("d-none");
  elements.inspectorDetail?.classList.add("d-none");
  updateActionButtons();
  updateJsonPreview(elements.jsonPreview, elements.jsonBytes, toPressExportShape(record));
}

function readLockedFeatureIds() {
  return sharedReadLockedFeatureIds(elements.lockedFeatures);
}

async function handleGenerate() {
  try {
    const systemId = currentSystemId() || null;
    const generated = generateMonster(creatureTypes, archetypes, roles, features, {
      systemId,
      creatureTypeId: elements.creatureTypeOverride?.value || "",
      archetypeId: elements.archetypeOverride?.value || "",
      roleId: elements.roleOverride?.value || "",
      signatureFeatureId: elements.signatureOverride?.value || "",
      lockedFeatureIds: readLockedFeatureIds(),
    });
    const { stats } = await deriveStats({
      systemId,
      combatScalingId: elements.combatScalingOverride?.value || "",
      role: findById(roles, generated.roleId),
      creatureType: findById(creatureTypes, generated.creatureTypeId),
      features: generated.featureIds.map((id) => findById(features, id)).filter(Boolean),
      dataManager,
    });
    const record = createMonsterRecord({ ...generated, stats });
    dirtyGate.markDirty();
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
    const exported = toPressExportShape(currentRecord);
    await dataManager.save("monster", currentRecord.id, exported);
    dirtyGate.markClean(exported);
    status?.show("Saved.", { type: "success", timeout: 1500 });
    updateActionButtons();
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

async function handleDelete() {
  if (!currentRecord || !dataManager || !dirtyGate.hasSaved()) return;
  const label = currentRecord.name || currentRecord.id;
  if (!confirmDelete({ label: `"${label}"` })) return;
  try {
    await dataManager.delete("monster", currentRecord.id);
    status?.show("Deleted.", { type: "success", timeout: 1500 });
    dirtyGate.markDirty();
    renderMonster(null);
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
    generateNote: generateMonsterNote,
    // Leave name blank rather than falling back to record.id here — an id
    // like "mon_abc123" would look like a real name to the server and stop
    // it from suggesting one.
    buildRequestBody: (record) => ({
      name: record.name || "",
      creatureType: findById(creatureTypes, record.creatureTypeId)?.name || record.creatureTypeId,
      archetype: findById(archetypes, record.archetypeId)?.name || record.archetypeId,
      role: findById(roles, record.roleId)?.name || record.roleId,
      signatureFeature: record.signatureFeatureId ? featureLabel(record.signatureFeatureId) : "",
      features: record.featureIds.map((featureId) => {
        const feature = findById(features, featureId);
        return { name: feature?.name || featureId, description: feature?.description || "" };
      }),
    }),
  });
  if (success) updateActionButtons();
}

async function init() {
  const shell = initAppShell({ namespace: "crucible", storagePrefix: "undercroft.crucible.undo" });
  status = shell.status;
  const auth = initAuthControls({
    status,
  });
  dataManager = auth.dataManager;

  // Same dirty check updateActionButtons already uses for the Save button —
  // Crucible had no guard at all against navigating/closing away from
  // unsaved edits (unlike Workbench, which already had this).
  window.addEventListener("beforeunload", (event) => {
    if (!currentRecord || !dirtyGate.isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  elements.generateButton?.addEventListener("click", handleGenerate);
  elements.saveButton?.addEventListener("click", handleSave);
  elements.deleteButton?.addEventListener("click", handleDelete);
  elements.exportButton?.addEventListener("click", handleExport);
  elements.generateNoteButton?.addEventListener("click", handleGenerateNote);
  elements.systemSelect?.addEventListener("change", () => reloadReferenceData());
  elements.combatScalingFieldSelect?.addEventListener("change", () => {
    setCombatScalingFieldPreference(currentSystemId(), elements.combatScalingFieldSelect.value);
    reloadReferenceData();
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
  renderMonster(null);

  initHelpSystem();
  refreshTooltips();
}

init();
