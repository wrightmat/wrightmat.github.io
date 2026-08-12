import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import {
  createJsonDataPanel,
  createToolbarButtonGroup,
  createCollapsibleSection,
  createEmptyStateCard,
  createCompactField,
  createIconButton,
  createFieldBox,
  createSearchableCheckList,
} from "../../common/js/lib/ui-components.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { listFeaturesForSystem, listEffectsForSystem, getSystemPropertyTypes, getSystemClasses } from "./lib/tables.js";
import { generateEffect, computeBudget, matchesCategory, rerollPropertyValue, resolveFeatureBudgetCost } from "./lib/generator.js";
import { createEffectRecord, toPressExportShape } from "./lib/effect-schema.js";
import { generateEffectNote } from "./lib/llm-note.js";
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
} from "../../common/js/lib/generator-kit.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
import { initToolSettings } from "../../common/js/lib/tool-settings.js";
import { setElementVisible, markRequiredControl } from "../../common/js/lib/dom.js";
import { resolveGroupContext, pickGroupDefaultId } from "../../common/js/lib/widgets/group-context.js";

let status = null;
let dataManager = null;
let features = [];
let propertyTypes = [];
// The active System's own casting classes (Wizard, Cleric, ...) — empty for
// any System with no "classes" field at all (most Systems), in which case
// the Casting Class select stays hidden entirely (see
// populateCastingClassSelect).
let classes = [];
let currentRecord = null;
// Every saved effect for the active System (Effect picker options) plus its
// ownership metadata — same role/shape as Crucible's monstersInSystem/
// monsterCatalog, itself mirroring Sanctum's locationsInSetting/
// locationCatalog. currentEffectId is tracked separately from currentRecord
// for the same reason Crucible tracks currentMonsterId separately.
let effectsInSystem = [];
let effectCatalog = new Map();
let currentEffectId = null;
// Tracks whether the record as last successfully saved differs from a live
// snapshot — built from currentRecord (feature add/remove already patches it
// directly) plus whatever's currently typed into Name/Notes, since those two
// fields aren't written back into currentRecord until Save/Export actually
// runs. Gates Save (dirty) and Delete (nothing saved yet) — see
// common/js/lib/dirty-gate.js, lifted from Crucible's original version of
// this exact pattern.
const dirtyGate = createDirtyGate({ buildSnapshot: () => toPressExportShape(buildRecordForSave()) });

// Built and mounted before `elements` below queries for these buttons by
// their data-*-effect attribute, so every existing selector/disabled-state
// call site elsewhere in this file keeps working unchanged.
createToolbarButtonGroup([
  { action: "generate", icon: "tabler:sparkles", label: "Generate Effect", primary: true, attrs: { "data-generate-effect": true } },
  { action: "save", label: "Save", disabled: true, attrs: { "data-save-effect": true } },
  { action: "export", label: "Export JSON", disabled: true, attrs: { "data-export-effect": true } },
  { action: "delete", label: "Delete", disabled: true, attrs: { "data-delete-effect": true } },
]).forEach((button) => document.querySelector("[data-effect-toolbar-mount]")?.appendChild(button));
document.querySelector("[data-effect-empty-state]")?.appendChild(
  createEmptyStateCard({
    message: "Nothing selected yet. Pick an existing Effect above, or fill in the fields and click Generate Effect.",
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
mountField("effect-select", createCompactField({ type: "select", id: "vaultEffectSelect", label: "Effect", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-effect-select" }));
// Hidden entirely for a System with no "classes" field (most Systems) —
// see populateCastingClassSelect. Casting Class narrows which Features are
// eligible (matchesClass, lib/generator.js) the same way a locked Signature
// Effect narrows the pick, so it's positioned right before the Property
// overrides that also constrain generation.
mountField("casting-class-select", createCompactField({ type: "select", id: "vaultCastingClassSelect", label: "Casting Class", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-casting-class-select" }));
mountField("signature-feature-override", createCompactField({ type: "select", id: "vaultSignatureOverride", label: "Signature Effect", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-signature-feature-override" }));
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
mountField("effect-name", createFieldBox({ key: "name", label: "Name", editable: true, colClass: null, dataAttr: "data-effect-name" }));

const elements = {
  systemSelect: document.querySelector("[data-system-select]"),
  effectSelect: document.querySelector("[data-effect-select]"),
  generationFields: document.querySelector("[data-generation-fields]"),
  castingClassSelect: document.querySelector("[data-casting-class-select]"),
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
  inspectorEmpty: document.querySelector("[data-inspector-empty]"),
  inspectorDetail: document.querySelector("[data-inspector-detail]"),
  inspectorJson: document.querySelector("[data-inspector-json]"),
};

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
});

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

// The conventional field-name fallback getSystemPropertyTypes applies on its
// own when given no explicit preference (its own "rarity" default parameter)
// — duplicated here only so the Settings modal can show what's actually in
// effect (e.g. "Rarity") instead of misleadingly showing "None" while
// generation quietly uses that field anyway. Mirrors Crucible's own
// resolveEffectiveFieldPreference/CONVENTIONAL_FIELD_DEFAULTS exactly.
const CONVENTIONAL_BUDGET_CEILING_FIELD = "rarity";

function resolveEffectiveBudgetCeilingField(systemId) {
  const stored = getBudgetCeilingFieldPreference(systemId);
  if (stored) return stored;
  return propertyTypes.some((propertyType) => propertyType.id === CONVENTIONAL_BUDGET_CEILING_FIELD)
    ? CONVENTIONAL_BUDGET_CEILING_FIELD
    : "";
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
async function refreshEffectCatalog(ids) {
  effectCatalog = await refreshOwnershipCatalog(dataManager, "effect", ids);
}

function effectAllowsDelete(id) {
  return allowsDelete(effectCatalog, id, { dataManager });
}

// Every saved Effect for the active System — same picker pattern as
// Crucible's Monster/Sanctum's Location: "New / unsaved" as the default so
// a fresh Generate Effect keeps working exactly as before.
async function populateEffectSelect() {
  if (!elements.effectSelect) return;
  const systemId = currentSystemId();
  effectsInSystem = systemId ? await listEffectsForSystem(dataManager, systemId) : [];
  const sorted = [...effectsInSystem].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  renderOptionalSelectOptions(elements.effectSelect, sorted, { previousValue: currentEffectId || "" });
  await refreshEffectCatalog(effectsInSystem.map((effect) => effect.id));
  updateGenerationFieldsVisibility();
}

// Casting Class/Property overrides/Signature Effect/Locked Features only
// matter for generating something new — once an existing Effect is loaded
// they're just clutter (same convention Sanctum/Crucible/Forge's own
// generation fields follow). Purely visual: hiding never clears an
// override's underlying value.
function updateGenerationFieldsVisibility() {
  elements.generationFields?.classList.toggle("d-none", Boolean(elements.effectSelect?.value));
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
  // Spell Levels only means anything for an effect whose Item Form IS
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
  [fetchedFeatures, propertyTypes, classes] = await Promise.all([
    listFeaturesForSystem(dataManager, systemId),
    // `|| undefined` (not the stored "" directly) so an unconfigured System
    // falls through to getSystemPropertyTypes's own "rarity" default instead
    // of resolving to no ceiling field at all — mirrors Crucible's own
    // combatScalingField/creatureTypeField `|| undefined` call pattern.
    getSystemPropertyTypes(dataManager, systemId, budgetCeilingField || undefined),
    getSystemClasses(dataManager, systemId),
  ]);
  // The shared `feature` kind also holds Sanctum's location features and
  // Crucible's monster features (tagged accordingly) — filtered here, once,
  // so every consumer of the module-level `features` array (generateEffect,
  // and the Locked/Signature/Add-feature selects below) only ever sees
  // Vault's own spell/item ones. generateEffect already applied this same
  // matchesCategory filter internally, so this was really only ever visible
  // in the three UI pickers — confirmed the identical bug reported (and
  // just fixed) in Crucible's own equivalent pickers.
  features = fetchedFeatures.filter(matchesCategory);
  populatePropertyOverrides();
  populateCastingClassSelect();
  populateOverrideSelect(elements.signatureOverride, features, "Random");
  populateLockedFeaturesSelect();
  populateAddFeatureSelect();
  await populateEffectSelect();
}

// Optional override, blank = "Any class" (unconstrained) — same convention
// as Signature Effect/property overrides. Hidden entirely (not just empty)
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
// rather than plain read-only text. Signature Effect is deliberately not
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
        options: (propertyType.values || []).map((value) => ({ value: value.id, label: value.label || value.id })),
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
    const hasTiers = Array.isArray(feature?.tiers) && feature.tiers.length > 0;
    const selectedTierId = record.featureTiers?.[featureId];
    const cost = resolveFeatureBudgetCost(feature || {}, record.featureTiers || {});

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
    // Only a feature that actually scales (feat.mending-pulse's Healing,
    // feat.giant-strength, ...) gets this — every other feature keeps the
    // exact same row shape it always had. Changing it recomputes the badge
    // and the whole budget readout together, same as add/remove already do.
    if (hasTiers) {
      const tierSelect = document.createElement("select");
      tierSelect.className = "form-select form-select-sm";
      tierSelect.style.maxWidth = "10rem";
      feature.tiers.forEach((tier) => {
        const option = document.createElement("option");
        option.value = tier.id;
        option.textContent = tier.shortName ? `${tier.name} (${tier.shortName})` : tier.name;
        option.selected = tier.id === selectedTierId;
        tierSelect.appendChild(option);
      });
      tierSelect.addEventListener("click", (event) => event.stopPropagation());
      tierSelect.addEventListener("change", () => {
        currentRecord.featureTiers = { ...(currentRecord.featureTiers || {}), [featureId]: tierSelect.value };
        recomputeBudget(currentRecord);
        refreshEffectView();
      });
      header.appendChild(tierSelect);
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
  currentRecord.featureIds = currentRecord.featureIds.filter((id) => id !== featureId);
  if (currentRecord.signatureFeatureId === featureId) currentRecord.signatureFeatureId = null;
  recomputeBudget(currentRecord);
  refreshEffectView();
}

function addFeature(featureId) {
  if (!currentRecord || !featureId) return;
  if (!currentRecord.featureIds.includes(featureId)) currentRecord.featureIds.push(featureId);
  // A freshly added tiered feature starts at its own first (cheapest) tier
  // — same "always a real, well-defined tier" guarantee generateEffect's
  // own output gives — so the tier <select> in renderFeatureList always has
  // something valid selected rather than defaulting silently.
  const feature = findById(features, featureId);
  if (Array.isArray(feature?.tiers) && feature.tiers.length) {
    currentRecord.featureTiers = { ...(currentRecord.featureTiers || {}) };
    if (!currentRecord.featureTiers[featureId]) currentRecord.featureTiers[featureId] = feature.tiers[0].id;
  }
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
  if (elements.deleteButton) {
    elements.deleteButton.disabled = !hasRecord || !dirtyGate.hasSaved() || !effectAllowsDelete(currentEffectId);
  }
}

function renderEffect(record) {
  currentRecord = record;
  if (!record) {
    elements.emptyState?.classList.remove("d-none");
    elements.display?.classList.add("d-none");
    updateActionButtons();
    jsonDataPanel.render();
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
  jsonDataPanel.render();
}

function handleGenerate() {
  try {
    const selectedClass = classes.find((entry) => entry.id === elements.castingClassSelect?.value);
    const generated = generateEffect(features, propertyTypes, {
      systemId: currentSystemId() || null,
      signatureFeatureId: elements.signatureOverride?.value || "",
      lockedFeatureIds: readLockedFeatureIds(),
      propertyOverrides: readPropertyOverrides(),
      allowedFeatureTags: selectedClass?.allowedFeatureTags || null,
    });
    const record = createEffectRecord(generated);
    dirtyGate.markDirty();
    // Freshly generated content is always unsaved, regardless of whichever
    // saved Effect the picker previously pointed at — mirrors Crucible's
    // handleGenerate/Sanctum's handleGenerate resetting the same way.
    currentEffectId = null;
    if (elements.effectSelect) elements.effectSelect.value = "";
    updateGenerationFieldsVisibility();
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
    currentEffectId = currentRecord.id;
    await populateEffectSelect();
    updateActionButtons();
    status?.show("Saved.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

async function handleDelete() {
  if (!currentRecord || !dataManager || !dirtyGate.hasSaved() || !effectAllowsDelete(currentEffectId)) return;
  const label = currentRecord.name || currentRecord.id;
  if (!confirmDelete({ label: `"${label}"` })) return;
  try {
    await dataManager.delete("effect", currentRecord.id);
    status?.show("Deleted.", { type: "success", timeout: 1500 });
    dirtyGate.markDirty();
    currentEffectId = null;
    renderEffect(null);
    await populateEffectSelect();
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
  const shell = initAppShell({
    namespace: "vault",
    storagePrefix: "undercroft.vault.undo",
    settingsSlotAttr: "data-vault-settings-slot",
  });
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
  // Changing a property value can change the budget (a ceiling-setting
  // property's own targetBudget, or any other property's cost) — recompute
  // it the same way add/removeFeature already do, not just re-render.
  elements.identityFields?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-editable-property]");
    if (!select || !currentRecord) return;
    const key = select.dataset.editableProperty;
    currentRecord.properties = { ...(currentRecord.properties || {}), [key]: select.value };
    recomputeBudget(currentRecord);
    // Form's own value gates Spell Levels' visibility (see renderIdentity) —
    // only a Form change needs the whole Identity grid rebuilt to reflect
    // that; every other property just updates its own already-visible select.
    if (key === "form") renderIdentity(currentRecord);
    refreshEffectView();
  });
  // Per-property reroll button (createFieldBox's own `rerollable` option) —
  // same convention Forge's Identity/4D and Crucible's Identity fields use.
  // Unlike a manual select change, the picked value never touched the DOM,
  // so the Identity grid needs a full re-render (not just refreshEffectView)
  // to show it.
  elements.identityFields?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll-attribute]");
    if (!button || !currentRecord) return;
    const key = button.dataset.rerollAttribute;
    const propertyType = propertyTypes.find((entry) => entry.id === key);
    const pick = rerollPropertyValue(propertyType, currentRecord.properties?.[key]);
    if (!pick) return;
    currentRecord.properties = { ...(currentRecord.properties || {}), [key]: pick.id };
    recomputeBudget(currentRecord);
    renderIdentity(currentRecord);
    refreshEffectView();
  });
  // Named (not an inline listener) so the init flow below can also call
  // this directly when auto-selecting the active campaign group's own
  // System.
  async function handleSystemSelectChange() {
    markRequiredControl(elements.systemSelect, Boolean(elements.systemSelect.value));
    // A different System means any previously loaded Effect (and the
    // reference data it was built from) is no longer relevant — same
    // reasoning as Crucible/Sanctum's own System change handlers.
    currentEffectId = null;
    renderEffect(null);
    await reloadReferenceData();
  }
  elements.systemSelect?.addEventListener("change", handleSystemSelectChange);

  elements.effectSelect?.addEventListener("change", async () => {
    const id = elements.effectSelect.value;
    currentEffectId = id || null;
    updateGenerationFieldsVisibility();
    if (!id) {
      renderEffect(null);
      return;
    }
    try {
      const result = await dataManager.get("effect", id);
      if (!result?.payload) {
        status?.show("Unable to load that effect.", { type: "error", timeout: 4000 });
        return;
      }
      // Not createEffectRecord — that function always stamps a fresh id and
      // createdAt (see effect-schema.js), which is right for a NEW
      // generation but would silently rewrite an existing record's real
      // creation time on every load.
      renderEffect({ ...result.payload, id });
      dirtyGate.markClean(toPressExportShape(currentRecord));
      updateActionButtons();
    } catch (error) {
      status?.show(`Unable to load effect: ${error.message}`, { type: "error", timeout: 4000 });
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
        options: [{ value: "", label: "None" }, ...propertyTypes.map((propertyType) => ({ value: propertyType.id, label: propertyType.label || propertyType.id }))],
        // Shows the effective value (falling back to "Rarity" when
        // unconfigured), not the raw stored "", so the modal doesn't
        // misleadingly show "None" while generation quietly uses Rarity
        // anyway — mirrors Crucible's own resolveEffectiveFieldPreference.
        getValue: () => resolveEffectiveBudgetCeilingField(currentSystemId()),
        setValue: async (fieldKey) => {
          setBudgetCeilingFieldPreference(currentSystemId(), fieldKey);
          await reloadReferenceData();
          if (currentRecord) {
            recomputeBudget(currentRecord);
            refreshEffectView();
          }
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
  elements.nameInput?.addEventListener("input", updateActionButtons);
  elements.notesText?.addEventListener("input", updateActionButtons);

  document.querySelector("[data-json-mount]")?.appendChild(jsonDataPanel.section);

  // If a campaign group is active (the header's Campaign dropdown) and that
  // group has its own System assigned, default Vault's System select to it
  // — a real, GM-chosen fact about the campaign being played, not a guess —
  // to make mid-campaign generation faster. Falls through to the original
  // "nothing chosen yet" placeholder whenever there's no active group, or
  // its System isn't one this tool's own list actually contains.
  const systems = await populateSystemSelect();
  const groupContext = await resolveGroupContext(dataManager).catch(() => null);
  const defaultSystemId = pickGroupDefaultId(groupContext, "systemId", systems);
  if (defaultSystemId) {
    elements.systemSelect.value = defaultSystemId;
    await handleSystemSelectChange();
  } else {
    await reloadReferenceData();
  }
  renderEffect(null);

  initHelpSystem();
  refreshTooltips();
}

init();
