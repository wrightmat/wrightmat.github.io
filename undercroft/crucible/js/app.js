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
import {
  listCreatureTypesForSystem,
  listArchetypesForSystem,
  listRolesForSystem,
  listFeaturesForSystem,
  listMonstersForSystem,
  loadCombatScalingLevels,
  listArrayFieldOptions,
  loadAbilityFieldDefs,
} from "./lib/tables.js";
import { generateMonster, matchesCategory, rerollAttribute } from "./lib/generator.js";
import { deriveStats } from "./lib/stats.js";
import { createMonsterRecord, toPressExportShape } from "./lib/monster-schema.js";
import { hasConvertibleStatBlock, convertStatBlockToFeatures } from "../../common/js/lib/monster-feature-matching.js";
// Reused as-is from Repository, not reimplemented — the same "never
// recreate shared code" precedent common/js/lib/widgets/handout.js already
// set for this exact function. No options passed: Crucible has no page
// index/wiki-link/dice/macro/encounter context to wire up, and
// renderMarkdown degrades gracefully without any of that (dice/task-
// checkbox/callout rendering still work; `[[wiki links]]` just render as
// "missing" links, which a Notes field never has anyway).
import { renderMarkdown } from "../../repository/js/lib/markdown.js";
import { generateMonsterNote } from "./lib/llm-note.js";
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
import { markRequiredControl, setElementVisible } from "../../common/js/lib/dom.js";
import { resolveGroupContext, pickGroupDefaultId } from "../../common/js/lib/widgets/group-context.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
import { createTokenImageField } from "../../common/js/lib/token-picker.js";
import { initToolSettings } from "../../common/js/lib/tool-settings.js";
import { abilityModifier } from "../../common/js/lib/dnd-rules.js";

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
// Every saved monster for the active System (Monster picker options) plus
// its ownership metadata — same role/shape as Sanctum's locationsInSetting/
// locationCatalog. Tracking currentMonsterId separately from currentRecord
// mirrors Sanctum's currentLocationId too: currentRecord holds the live,
// possibly-edited-but-unsaved data, while this is just "which saved id (if
// any) is the picker currently pointed at."
let monstersInSystem = [];
let monsterCatalog = new Map();
let currentMonsterId = null;
// Tracks whether the record as last successfully saved differs from a live
// snapshot — built from currentRecord plus whatever's currently typed into
// Name/Notes, since those two fields aren't written back into currentRecord
// until Save/Export actually runs — to gate the Save button the same way
// Loom/Workbench's editors do, and to know whether Delete has anything real
// on the server to target (see common/js/lib/dirty-gate.js).
const dirtyGate = createDirtyGate({ buildSnapshot: () => toPressExportShape(buildRecordForSave()) });

// Built and mounted before `elements` below queries for these buttons by
// their data-*-monster attribute, so every existing selector/disabled-state
// call site elsewhere in this file keeps working unchanged.
createToolbarButtonGroup([
  { action: "generate", label: "Generate Monster", primary: true, attrs: { "data-generate-monster": true } },
  { action: "save", label: "Save", disabled: true, attrs: { "data-save-monster": true } },
  { action: "export", label: "Export JSON", disabled: true, attrs: { "data-export-monster": true } },
  { action: "delete", label: "Delete", disabled: true, attrs: { "data-delete-monster": true } },
]).forEach((button) => document.querySelector("[data-monster-toolbar-mount]")?.appendChild(button));
document.querySelector("[data-monster-empty-state]")?.appendChild(
  createEmptyStateCard({
    message: "Nothing selected yet. Pick an existing Monster above, or fill in the fields and click Generate Monster.",
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
mountField("system-select", createCompactField({ type: "select", id: "crucibleSystemSelect", label: "System", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-system-select" }));
mountField("monster-select", createCompactField({ type: "select", id: "crucibleMonsterSelect", label: "Monster", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-monster-select" }));
mountField(
  "creature-type-override",
  createCompactField({
    type: "select", id: "crucibleCreatureTypeOverride", label: "Creature Type", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-creature-type-override", helpTopic: "crucible.overrides",
  })
);
mountField("archetype-override", createCompactField({ type: "select", id: "crucibleArchetypeOverride", label: "Archetype", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-archetype-override" }));
mountField("role-override", createCompactField({ type: "select", id: "crucibleRoleOverride", label: "Role", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-role-override" }));
mountField(
  "combat-scaling-override",
  createCompactField({
    type: "select", id: "crucibleCombatScalingOverride", label: "Combat Scaling", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-combat-scaling-override", helpTopic: "crucible.combatScaling",
  })
);
mountField("signature-feature-override", createCompactField({ type: "select", id: "crucibleSignatureOverride", label: "Signature Feature", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-signature-feature-override" }));
mountField(
  "locked-features",
  createSearchableCheckList({
    id: "crucibleLockedFeatures", label: "Locked Features",
    dataAttr: "data-locked-features", helpTopic: "crucible.lockedFeatures",
  })
);
// Same field-box style as Identity/Stats below (and Forge's own Name box) —
// per explicit feedback that Name/Image standing out with plain
// Bootstrap form-control styling, instead of matching the boxes around
// them, was exactly the inconsistency to fix.
mountField("monster-name", createFieldBox({ key: "name", label: "Name", editable: true, colClass: null, dataAttr: "data-monster-name" }));

const elements = {
  systemSelect: document.querySelector("[data-system-select]"),
  monsterSelect: document.querySelector("[data-monster-select]"),
  generationFields: document.querySelector("[data-generation-fields]"),
  creatureTypeOverride: document.querySelector("[data-creature-type-override]"),
  archetypeOverride: document.querySelector("[data-archetype-override]"),
  roleOverride: document.querySelector("[data-role-override]"),
  combatScalingOverride: document.querySelector("[data-combat-scaling-override]"),
  signatureOverride: document.querySelector("[data-signature-feature-override]"),
  lockedFeatures: document.querySelector("[data-locked-features]"),
  generateButton: document.querySelector("[data-generate-monster]"),
  saveButton: document.querySelector("[data-save-monster]"),
  deleteButton: document.querySelector("[data-delete-monster]"),
  exportButton: document.querySelector("[data-export-monster]"),
  emptyState: document.querySelector("[data-monster-empty-state]"),
  display: document.querySelector("[data-monster-display]"),
  nameInput: document.querySelector("[data-monster-name]"),
  imageMount: document.querySelector('[data-field-mount="monster-image"]'),
  identityFields: document.querySelector("[data-identity-fields]"),
  featureList: document.querySelector("[data-feature-list]"),
  addFeatureSelect: document.querySelector("[data-add-feature-select]"),
  addFeatureButton: document.querySelector("[data-add-feature-button]"),
  budgetSummary: document.querySelector("[data-budget-summary]"),
  budgetTarget: document.querySelector("[data-budget-target]"),
  budgetSpent: document.querySelector("[data-budget-spent]"),
  budgetRemaining: document.querySelector("[data-budget-remaining]"),
  recipeCard: document.querySelector("[data-recipe-card]"),
  recipeSummary: document.querySelector("[data-recipe-summary]"),
  statsFields: document.querySelector("[data-stats-fields]"),
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

// Adopts each section's existing static `[data-xxx-panel]` markup (its own
// content stays hand-authored HTML — only the header+chevron wrapper is
// JS-built) as createCollapsibleSection's content — same pattern Sanctum's
// own initCollapsibles uses. Notes keeps its "Generate Note" sibling button
// in static HTML (a shape createCollapsibleSection would clobber by
// rebuilding the whole header), so only its toggle button is built and
// mounted, the same way Sanctum's own Notes section does.
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
      helpTopic: "crucible.identity",
      collapsed: false,
      content: document.querySelector("[data-identity-panel]"),
    }).section
  );

  // Toggle-only (not the full createCollapsibleSection header) — same
  // reasoning as Notes below: the Feature budget summary is static HTML in
  // the header that createCollapsibleSection's own built header would
  // clobber. Mirrors Vault's own Features section exactly.
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

  document.querySelector("[data-stats-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Stats",
      helpTopic: "crucible.stats",
      collapsed: false,
      content: document.querySelector("[data-stats-panel]"),
    }).section
  );

  // Moved to the bottom of the page and collapsed by default — a
  // supplementary detail (which slot each feature filled), not something
  // the GM needs open at a glance every time, unlike Identity/Features/Stats.
  document.querySelector("[data-recipe-mount]")?.appendChild(
    createCollapsibleSection({
      label: "Recipe Fulfillment",
      helpTopic: "crucible.recipe",
      collapsed: true,
      content: document.querySelector("[data-recipe-panel]"),
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
}

const jsonDataPanel = createJsonDataPanel({
  label: "JSON Data",
  getData: () => (currentRecord ? toPressExportShape(currentRecord) : null),
});

function currentSystemId() {
  return elements.systemSelect?.value || "";
}

// Which array field Crucible treats as combat-scaling data — and, separately,
// which one it treats as creature-type data — is a Crucible tool preference,
// not System data: it's not game content, it's "which of this System's
// fields does Crucible's own generator special-case," so it lives in this
// browser's local storage (keyed per System), never in the System record
// edited in Loom. Mirrors Vault's budgetCeilingField preference exactly (see
// vault/js/app.js). Both settings share one per-System record (read/write
// through the small helpers below, not saveLocal directly) since
// dataManager.saveLocal replaces the whole record for a given (bucket, id) —
// writing one setting straight through saveLocal would silently wipe out
// the other one's already-saved value for that same System.
const CRUCIBLE_SETTINGS_BUCKET = "crucible-settings";

function getCrucibleSystemSettings(systemId) {
  if (!dataManager || !systemId) return {};
  return dataManager.getLocal(CRUCIBLE_SETTINGS_BUCKET, systemId) || {};
}

function setCrucibleSystemSetting(systemId, key, value) {
  if (!dataManager || !systemId) return;
  const next = { ...getCrucibleSystemSettings(systemId), [key]: value };
  if (!next.combatScalingField && !next.creatureTypeField) {
    dataManager.removeLocal(CRUCIBLE_SETTINGS_BUCKET, systemId);
  } else {
    dataManager.saveLocal(CRUCIBLE_SETTINGS_BUCKET, systemId, next);
  }
}

function getCombatScalingFieldPreference(systemId) {
  return getCrucibleSystemSettings(systemId).combatScalingField || "";
}

function setCombatScalingFieldPreference(systemId, fieldKey) {
  setCrucibleSystemSetting(systemId, "combatScalingField", fieldKey || "");
}

// Different Systems use different nomenclature for this concept (5e's own
// "Creature Type" vocabulary vs. another game's "Kind"/"Origin"/whatever it
// calls its own version) — see listCreatureTypesForSystem's own comment in
// lib/tables.js — so which array field supplies it is configurable exactly
// like combatScalingField above, defaulting to "creatureTypes" there when
// unset.
function getCreatureTypeFieldPreference(systemId) {
  return getCrucibleSystemSettings(systemId).creatureTypeField || "";
}

function setCreatureTypeFieldPreference(systemId, fieldKey) {
  setCrucibleSystemSetting(systemId, "creatureTypeField", fieldKey || "");
}

// Both settings share the same option list (every top-level array field the
// active System defines) — built once here rather than duplicated in each
// definition below.
function fieldPreferenceOptions() {
  return [{ value: "", label: "None" }, ...arrayFieldOptions.map((field) => ({ value: field.key, label: field.label || field.key }))];
}

// The conventional field-name fallback each loader applies on its own when
// given no explicit preference (loadCombatScalingLevels's/
// listCreatureTypesForSystem's own default parameters) — duplicated here
// only so the Settings modal can show what's actually in effect (e.g.
// "Creature Types") instead of misleadingly showing "None" while generation
// quietly uses that field anyway.
const CONVENTIONAL_FIELD_DEFAULTS = {
  combatScalingField: "combatScaling",
  creatureTypeField: "creatureTypes",
};

// Display-only: the value the Settings modal should show as "currently in
// effect" for one of these pickers — the explicit stored choice if there is
// one, else the conventional default key IF the active System actually
// defines a field with that name, else genuinely nothing ("None"). Kept
// separate from getCombatScalingFieldPreference/getCreatureTypeFieldPreference
// (used for the real Promise.all calls in reloadReferenceData), which stay a
// plain "raw preference or ''" — the loader functions they feed already
// apply this same conventional default themselves when given '', so
// resolving it again here is purely about what the dropdown displays, not a
// second source of truth for generation.
function resolveEffectiveFieldPreference(prefKey, rawValue) {
  if (rawValue) return rawValue;
  const conventionalDefault = CONVENTIONAL_FIELD_DEFAULTS[prefKey];
  return arrayFieldOptions.some((field) => field.key === conventionalDefault) ? conventionalDefault : "";
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
// body — mirrors Sanctum's refreshSettingCatalog/refreshLocationCatalog
// exactly. Local-only (anonymous, browser-storage) entries are always
// deletable, since it's just this browser's own storage.
async function refreshMonsterCatalog(ids) {
  monsterCatalog = await refreshOwnershipCatalog(dataManager, "monster", ids);
}

function monsterAllowsDelete(id) {
  return allowsDelete(monsterCatalog, id, { dataManager });
}

// Every saved Monster for the active System — Sanctum's Location picker is
// the direct precedent (list scoped by the current context, "New / unsaved"
// as the default so a fresh Generate Monster keeps working exactly as
// before). Crucible has no Setting concept, so System alone is the scope.
async function populateMonsterSelect() {
  if (!elements.monsterSelect) return;
  const systemId = currentSystemId();
  monstersInSystem = systemId ? await listMonstersForSystem(dataManager, systemId) : [];
  const sorted = [...monstersInSystem].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  renderOptionalSelectOptions(elements.monsterSelect, sorted, { previousValue: currentMonsterId || "" });
  await refreshMonsterCatalog(monstersInSystem.map((monster) => monster.id));
  updateGenerationFieldsVisibility();
}

// The Creature Type/Archetype/Role/Combat Scaling/Signature/Locked Features
// overrides only matter for generating something new — once an existing
// Monster is loaded they're just clutter (same convention Sanctum/Forge/
// Vault's own generation fields follow). Purely visual: hiding never clears
// an override's underlying value.
function updateGenerationFieldsVisibility() {
  elements.generationFields?.classList.toggle("d-none", Boolean(elements.monsterSelect?.value));
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
  sharedPopulateLockedFeaturesCheckList(elements.lockedFeatures, features);
}

async function reloadReferenceData() {
  const systemId = currentSystemId();
  const combatScalingField = getCombatScalingFieldPreference(systemId);
  const creatureTypeField = getCreatureTypeFieldPreference(systemId);
  let fetchedFeatures;
  [creatureTypes, archetypes, roles, fetchedFeatures, combatScalingLevels, arrayFieldOptions, abilityFieldDefs] = await Promise.all([
    listCreatureTypesForSystem(dataManager, systemId, creatureTypeField || undefined),
    listArchetypesForSystem(dataManager, systemId),
    listRolesForSystem(dataManager, systemId),
    listFeaturesForSystem(dataManager, systemId),
    loadCombatScalingLevels(dataManager, systemId, combatScalingField || undefined),
    listArrayFieldOptions(dataManager, systemId),
    loadAbilityFieldDefs(dataManager, systemId),
  ]);
  // The shared `feature` kind also holds Sanctum's location features and
  // Vault's spell/item features (tagged accordingly) — filtered here, once,
  // right after fetching, so every consumer of the module-level `features`
  // array (generateMonster, and the Locked/Signature/Add-feature selects
  // below) only ever sees Crucible's own monster ones. Confirmed real bug
  // this fixes: unfiltered, all three leaked non-monster features in.
  features = fetchedFeatures.filter(matchesCategory);
  populateOverrideSelect(elements.creatureTypeOverride, creatureTypes, "Random");
  populateOverrideSelect(elements.archetypeOverride, archetypes, "Random");
  populateOverrideSelect(elements.roleOverride, roles, "Random");
  populateOverrideSelect(elements.combatScalingOverride, combatScalingLevels, "Random");
  populateOverrideSelect(elements.signatureOverride, features, "Random");
  populateLockedFeaturesSelect();
  populateAddFeatureSelect();
  await populateMonsterSelect();
}

function featureLabel(id) {
  return sharedFeatureLabel(features, id);
}

// The "monster" Library kind isn't exclusively Crucible's own output — an
// SRD/DDB/Fantasy Statblocks import saves straight to the same shared kind.
// Provenance (`record.mapping`, stamped by Loom's saveEntity/Crucible's own
// handleSave on any mapping-driven save — the suite's standard "was this
// imported?" signal, same field Character already uses), not data shape, is
// the correct discriminator — shape is deliberately NOT reliable here:
// Feature-matching (monster-feature-matching.js) normalizes an imported
// record's traits/actions into `featureIds` the same way native generation
// does, so a converted import and a native monster are MEANT to end up
// structurally identical. Checking `featureIds` presence used to conflate
// "has been feature-matched" with "was generated by Crucible," which is
// wrong on both counts.
function isImportedStatBlock(record) {
  return Boolean(record?.mapping);
}

// Field boxes now (createFieldBox, same as Stats below) — per explicit
// feedback that these needed to be editable, not read-only text. An
// imported record has no Type/Archetype/Role/Signature Feature (those are
// Crucible's own generation axes) — Size/Type/Alignment/Speed are the
// closest equivalent identity summary its own stat block actually has, so
// that branch gets free-typed text boxes instead of vocabulary selects.
// `data-editable-identity` is this section's own write-back attribute (see
// the identityFields "change" listener below) — distinct from Stats' own
// `data-editable-stat` since the two sections write into different parts
// of the record (top-level fields here vs. `record.stats` there, except
// the imported branch, which — like Stats — does write into `record.stats`).
function renderIdentity(record) {
  if (!elements.identityFields) return;
  elements.identityFields.innerHTML = "";
  // An imported stat block with no featureIds yet (see isImportedStatBlock)
  // has no Creature Type/Archetype/Role concept — Size/Type/Alignment/Speed
  // used to render here as a substitute, but those now live in the Stats
  // section as ordinary editable stat cards (renderStats), the same place
  // every other "random mechanical thing" an imported record carries (Hit
  // Dice, Saving Throws, Skills, ...) already does — so there's nothing left
  // for Identity itself to show until this record has real featureIds.
  if (isImportedStatBlock(record)) return;
  // Signature Feature deliberately isn't a field here — it's already shown,
  // clearly labeled "Signature", on its own Feature's row in the Features
  // list below (renderFeatureList), so a second control for the same fact
  // up here was redundant.
  [
    { key: "type", label: "Creature Type", value: record.type, source: creatureTypes },
    { key: "archetypeId", label: "Archetype", value: record.archetypeId, source: archetypes },
    { key: "roleId", label: "Role", value: record.roleId, source: roles },
  ].forEach(({ key, label, value, source, blankLabel }) => {
    const options = source.map((entry) => ({ value: entry.id, label: entry.name || entry.id }));
    if (blankLabel) options.unshift({ value: "", label: blankLabel });
    elements.identityFields.appendChild(
      createFieldBox({
        key,
        label,
        type: "select",
        value: value || "",
        options,
        colClass: "col-6 col-md-3",
        editable: true,
        rerollable: true,
        dataAttr: "data-editable-identity",
      })
    );
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

// Every free-text ability list an imported stat block can carry, in the
// order they read most naturally — Traits first (no prefix, they're the
// "baseline" the rest sit alongside), then Actions, then the situational
// ones. Each entry's own {name, description} already carries its full
// content, so these render directly rather than through Crucible's own
// Feature-lookup/inspector flow (findById(features, ...) has nothing to
// find here — there's no shared Feature entity behind free-text prose).
const IMPORTED_STAT_BLOCK_ABILITY_GROUPS = [
  ["traits", ""],
  ["actions", "Action"],
  ["bonusActions", "Bonus Action"],
  ["reactions", "Reaction"],
  ["legendaryActions", "Legendary Action"],
  ["lairActions", "Lair Action"],
];

function renderFeatureList(record) {
  if (!elements.featureList) return;
  elements.featureList.innerHTML = "";
  // NOT isImportedStatBlock — that's a provenance question (did this record
  // come from an import?) and stays true forever once it does, by design.
  // This branch is asking a different question: has this record's raw
  // stat-block content actually been converted into real Feature
  // references yet? `featureIds` is the right signal for that regardless
  // of provenance — Feature-matching (monster-feature-matching.js) runs
  // automatically on every save now (Crucible's own handleSave, or Loom's
  // saveEntity), so a freshly-imported-and-saved monster has real
  // featureIds just like a native one; only a record that hasn't been
  // saved through that path yet (or was imported before this pipeline
  // existed) still has raw traits/actions/etc. to show read-only here.
  if (!Array.isArray(record.featureIds)) {
    const stats = record.stats || {};
    IMPORTED_STAT_BLOCK_ABILITY_GROUPS.forEach(([key, groupLabel]) => {
      (stats[key] || []).forEach((entry) => {
        const row = document.createElement("div");
        row.className = "border rounded-3 p-2";
        const header = document.createElement("div");
        header.className = "d-flex align-items-center justify-content-between gap-2";
        const name = document.createElement("span");
        name.className = "fw-semibold";
        name.textContent = groupLabel ? `${entry.name} (${groupLabel})` : entry.name;
        header.appendChild(name);
        const description = document.createElement("div");
        description.className = "small text-body-secondary";
        description.textContent = entry.description || "";
        row.append(header, description);
        elements.featureList.appendChild(row);
      });
    });
    if (!elements.featureList.children.length) {
      const empty = document.createElement("p");
      empty.className = "small text-body-secondary mb-0";
      empty.textContent = "No traits or actions on this record.";
      elements.featureList.appendChild(empty);
    }
    return;
  }
  // Same row shape as Vault's own renderFeatureList (info + a Remove
  // button) — minus Vault's cost/refund badge, which is Vault's own budget-
  // economy concept and has no equivalent in Crucible's recipe-slot model.
  // A feature with real combat mechanics (buildActions, crucible/js/lib/
  // stats.js — shares its name with the feature it came from) gets its
  // attackBonus/damageDice line shown right here, instead of a second,
  // numbers-only entry elsewhere — that duplication (e.g. "Overrun" showing
  // once in Features with no mechanics and again under Stats with only the
  // mechanics) was a real, confirmed source of confusion.
  const actions = record.stats?.actions || [];
  const matchedActionNames = new Set();
  record.featureIds.forEach((featureId) => {
    const feature = findById(features, featureId);
    const isSignature = featureId === record.signatureFeatureId;
    const action = actions.find((entry) => entry.name === (feature?.name || featureId));
    if (action) matchedActionNames.add(action.name);

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

    const description = document.createElement("div");
    description.className = "small text-body-secondary";
    description.textContent = feature?.description || "";

    info.append(header, description);

    if (action) {
      const mechanics = document.createElement("div");
      mechanics.className = "small fw-semibold";
      mechanics.textContent = actionDetailsText(action);
      info.appendChild(mechanics);
    }

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

  // buildActions falls back to one generic "Attack"/"Multiattack" entry
  // when nothing selected is combat-tagged — it has no matching Feature by
  // design, so it wouldn't otherwise show up anywhere. A plain, non-
  // removable row here keeps it visible instead of silently dropped.
  actions
    .filter((action) => !matchedActionNames.has(action.name))
    .forEach((action) => {
      const row = document.createElement("div");
      row.className = "border rounded-3 p-2";
      const name = document.createElement("div");
      name.className = "fw-semibold";
      name.textContent = action.name;
      const mechanics = document.createElement("div");
      mechanics.className = "small text-body-secondary";
      mechanics.textContent = actionDetailsText(action);
      row.append(name, mechanics);
      elements.featureList.appendChild(row);
    });
}

// Same small helper Sanctum's own app.js already has — a disabled-looking
// blank first option so the select doesn't silently read as "the
// alphabetically-first feature is already chosen" the moment it's populated.
function createPlaceholderOption(label = "Select…") {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  return option;
}

// Every compatible Feature not already on this Monster — same convention as
// Vault's own populateAddFeatureSelect. Only meaningful for a native
// Crucible record; an imported stat block has no `features` reference pool
// to add from at all (see isImportedStatBlock/IMPORTED_STAT_BLOCK_ABILITY_GROUPS).
function populateAddFeatureSelect() {
  if (!elements.addFeatureSelect) return;
  // Same "featureIds presence, not provenance" reasoning as renderFeatureList
  // above — an imported-and-converted monster can add more Features same as
  // a native one; only a not-yet-converted record (still showing raw
  // traits/actions read-only) has nothing to add to yet.
  if (!currentRecord || !Array.isArray(currentRecord.featureIds)) {
    elements.addFeatureSelect.innerHTML = "";
    return;
  }
  const selectedIds = new Set(currentRecord.featureIds || []);
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

// Feature budget summary in the Features header, matching Vault's own
// Target/Spent/Remaining display exactly. An imported stat block has no
// budget concept at all (see isImportedStatBlock), so the whole summary
// stays hidden for those rather than showing zeroes.
function renderFeatureBudget(record) {
  const budget = record && !isImportedStatBlock(record) ? record.stats?.budget : null;
  // Not `.hidden = !budget` — data-budget-summary carries Bootstrap's own
  // `.d-flex` (an author-origin display rule), which always beats the
  // `[hidden]` UA-stylesheet rule regardless of the `hidden` property/
  // attribute, so setting `.hidden` alone silently no-ops here (confirmed
  // real bug: switching from a native monster to an imported one left the
  // stale budget from the previous record visibly on screen).
  // setElementVisible forces `display` inline instead, which wins.
  if (elements.budgetSummary) setElementVisible(elements.budgetSummary, Boolean(budget), "flex");
  if (!budget) return;
  if (elements.budgetTarget) elements.budgetTarget.textContent = String(budget.target);
  if (elements.budgetSpent) elements.budgetSpent.textContent = String(budget.spent);
  if (elements.budgetRemaining) {
    elements.budgetRemaining.textContent = String(budget.remaining);
    elements.budgetRemaining.classList.toggle("crucible-budget-over", budget.remaining < 0);
  }
}

// Re-derives spent/remaining from whatever's currently selected — same
// "recompute fresh, don't trust a stale value" reasoning as Vault's own
// recomputeBudget, so manual add/remove and the original generation can
// never disagree about the running total. Target itself doesn't change
// here — it comes from the resolved Combat Scaling level at generation
// time, not from feature selection.
function recomputeMonsterBudget(record) {
  if (!record?.stats?.budget) return null;
  const target = record.stats.budget.target;
  const spent = (record.featureIds || []).reduce((sum, featureId) => sum + Number(findById(features, featureId)?.budgetCost ?? 0), 0);
  record.stats.budget = { target, spent, remaining: target - spent };
  return record.stats.budget;
}

// Manual add/remove mutate featureIds directly, same as Vault's own
// add/removeFeature — deliberately NOT re-running recipe-slot matching
// (recipeFulfillment keeps showing whatever generation originally
// resolved), same as a manual Vault edit never retroactively changes which
// Signature Effect was chosen.
function removeFeature(featureId) {
  if (!currentRecord || !Array.isArray(currentRecord.featureIds)) return;
  currentRecord.featureIds = currentRecord.featureIds.filter((id) => id !== featureId);
  if (currentRecord.signatureFeatureId === featureId) currentRecord.signatureFeatureId = null;
  dirtyGate.markDirty();
  recomputeMonsterBudget(currentRecord);
  renderFeatureList(currentRecord);
  renderFeatureBudget(currentRecord);
  populateAddFeatureSelect();
  jsonDataPanel.render();
  updateActionButtons();
}

function addFeature(featureId) {
  if (!currentRecord || !featureId || !Array.isArray(currentRecord.featureIds)) return;
  if (!currentRecord.featureIds.includes(featureId)) currentRecord.featureIds.push(featureId);
  dirtyGate.markDirty();
  recomputeMonsterBudget(currentRecord);
  renderFeatureList(currentRecord);
  renderFeatureBudget(currentRecord);
  populateAddFeatureSelect();
  jsonDataPanel.render();
  updateActionButtons();
}

function renderRecipeSummary(record) {
  // No Archetype recipe concept at all for an imported stat block — the
  // whole card is hidden rather than shown with a "not applicable" message
  // (which is what this used to do). `.card` toggle, not the [data-recipe-
  // panel]'s own `.hidden` — same reasoning as renderFeatureBudget: Bootstrap's
  // `.card` component itself sets `display: flex`, an author-origin rule
  // `.hidden`'s UA-stylesheet rule can't beat, but the `.d-none` utility
  // class (also author-origin, `!important`) reliably can — same pattern
  // Forge's own statsCard hide/show already uses.
  const imported = isImportedStatBlock(record);
  elements.recipeCard?.classList.toggle("d-none", imported);
  if (!elements.recipeSummary || imported) return;
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

// `compact` gives the small square number-box (abilities, Challenge/AC/HP/
// Save DC); non-compact gives a full-width labeled row (the freeform list
// fields — Resistances/Immunities/Senses).
// Crucible's own field-box implementation, originally hand-rolled here
// nearly identically to Forge's, is now the shared createFieldBox (common/
// js/lib/ui-components.js) — Forge's own fields and Vault's Identity fields
// render the exact same box today. `data-editable-stat`/
// `data-editable-stat-suffix` (this tool's own established attribute names,
// read by the statsFields write-back listener below) are preserved via
// dataAttr/the suffix element's own dataset, so no other code here needs to
// change. Crucible's Stats fields are always editable (unlike Forge's
// Identity/4D, which reuse the same box read-only) — always passed through.
function buildStatCard({ key, label, value, compact = true, colClass = "col-4 col-md-2", suffix = "", type = "text", rows }) {
  return createFieldBox({
    key,
    label,
    value,
    compact,
    colClass,
    suffix,
    type,
    rows,
    editable: true,
    dataAttr: "data-editable-stat",
    suffixDataAttr: "data-editable-stat-suffix",
  });
}

function abilityModifierText(score) {
  const modifier = abilityModifier(score);
  return `(${modifier >= 0 ? "+" : ""}${modifier})`;
}

// Comma-joined for both display and editing — the same convention this
// session's own Fantasy Statblocks/DDB monster mapping work already
// settled on for these same fields (damageResistances/damageImmunities/
// senses as plain string arrays); split back into an array on write-back
// below (statsFields' own "input" listener).
function joinListValue(list) {
  return Array.isArray(list) && list.length ? list.join(", ") : "";
}

// Shared by renderStats' field list and the statsFields write-back listener
// below, so the two can't quietly drift apart. Resistances/Immunities/
// Vulnerabilities all read/write the SAME underlying `stats.proficiencies.
// defenses` array now (this suite's one shared shape — see the monster-
// data-alignment plan), filtered/tagged by `type` — this is the type each
// box's own key maps to.
const DEFENSE_TYPE_BY_STAT_KEY = {
  damageResistances: "resistance",
  damageImmunities: "immunity",
  damageVulnerabilities: "vulnerability",
};

// stats.senses is `{passives:{perception,...}, darkvision, blindsight, ...}`
// (this suite's one shared senses shape, aligned across every import source
// and Character — see the monster-data-alignment plan) — but Crucible's own
// Senses box stays a single plain-text comma list, same UI as every other
// list-shaped stat, per explicit direction not to build a new structured
// editor for this. These two functions reshape between the two: display
// excludes `passives` (Passive Perception has its own separate stat card,
// reading/writing `senses.passives.perception` directly); parsing re-derives
// each named sense from the SAME `senses` System vocabulary the mapping
// layer's own parsers use, and always preserves whatever `passives` the
// record already had (this box never touches passive scores).
function formatSensesValue(senses) {
  if (!senses || typeof senses !== "object") return "";
  return Object.entries(senses)
    .filter(([key]) => key !== "passives")
    .map(([key, value]) => `${key.charAt(0).toUpperCase()}${key.slice(1)} ${value} ft.`)
    .join(", ");
}

function parseSensesText(text, existingSenses, sensesVocabulary) {
  const names = new Set((sensesVocabulary || []).map((entry) => entry.id || entry.name));
  const result = existingSenses?.passives ? { passives: existingSenses.passives } : {};
  String(text || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const match = part.match(/^([A-Za-z]+)\s+(\d+)/);
      if (!match) return;
      const key = match[1].toLowerCase();
      if (names.size && !names.has(key)) return;
      result[key] = Number(match[2]);
    });
  return result;
}

// stats.speed is `{walk, burrow, climb, fly, swim}` (this suite's one
// shared speed shape, aligned across every import source and Character —
// see the monster-data-alignment plan), same reshape-underneath approach
// as senses above — Crucible's own Speed box stays a single plain-text
// comma list. `walk` renders bare (no "Walk" prefix), matching standard 5e
// stat-block phrasing; every other mode is prefixed by its own name.
function formatSpeedValue(speed) {
  if (!speed || typeof speed !== "object") return "";
  return Object.entries(speed)
    .filter(([, value]) => value)
    .map(([key, value]) => (key === "walk" ? `${value} ft.` : `${key.charAt(0).toUpperCase()}${key.slice(1)} ${value} ft.`))
    .join(", ");
}

function parseSpeedText(text) {
  const result = {};
  String(text || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const match = part.match(/^([A-Za-z]+)?\s*(\d+)/);
      if (!match) return;
      result[(match[1] || "walk").toLowerCase()] = Number(match[2]);
    });
  return result;
}

// Shared by renderFeatureList's mechanical-detail line and its unmatched-
// action fallback row below.
function actionDetailsText(action) {
  if (!action) return "";
  const bonus = action.attackBonus >= 0 ? `+${action.attackBonus}` : `${action.attackBonus}`;
  return `${bonus} to hit, ${action.damageDice} ${action.damageType || ""} damage`.trim();
}

function renderStats(record) {
  if (!elements.statsFields) return;
  elements.statsFields.innerHTML = "";
  const stats = record.stats;
  if (!stats) return;

  const abilities = stats.abilities || {};
  const hitPoints = stats.hitPoints || {};

  // Row 1: every ability the active System defines (see abilityFieldDefs
  // above) together — col-4 col-md-2 is the same compact-grid sizing
  // Forge's own buildFieldCard uses for its number boxes, 6-per-row at
  // md+, so a standard 6-ability System fills exactly one row.
  abilityFieldDefs.forEach(({ key, label }) => {
    elements.statsFields.appendChild(
      buildStatCard({
        key: `ability:${key}`,
        label,
        value: abilities[key] ?? "",
        suffix: abilityModifierText(abilities[key] ?? 10),
      })
    );
  });

  // Row 2: Challenge, AC, Current HP, Max HP, Hit Dice, Save DC — all 1×
  // the ability score box's own width (default sizing), 6 × 2 = 12 columns,
  // filling the row exactly at md+ (same 6-per-row fit Row 1 abilities use).
  // Condensed from two separate rows: Current/Max HP no longer get a wider
  // box (a wider box around a single short number just left the input tiny
  // and the rest of the box empty), and Hit Dice/Save DC moved up here from
  // the old Row 3 to fill the row out.
  [
    ["challengeRating", "Challenge", stats.challengeRating ?? ""],
    ["armorClass", "Armor Class", stats.armorClass ?? ""],
    ["currentHp", "Current HP", hitPoints.current ?? hitPoints.max ?? ""],
    ["maxHp", "Max HP", hitPoints.max ?? ""],
    ["hitDice", "Hit Dice", stats.hitDice ?? ""],
    ["saveDC", "Save DC", stats.saveDC ?? ""],
  ].forEach(([key, label, value]) => {
    elements.statsFields.appendChild(buildStatCard({ key, label, value }));
  });

  // Row 3: Passive Perception, Speed, Size, Alignment — 1× the ability
  // score box's width each (col-md-2); Languages — 2× (col-md-4), since it
  // tends to hold more text than a single word/number. 4 × 2 + 4 = 12
  // columns, filling the row exactly at md+. No "Type" here — an imported
  // record's own free-text type used to render as a Stats field (a
  // stand-in for the Creature Type concept it otherwise had none of), but
  // Identity's own Creature Type select (renderIdentity) is the real,
  // single home for that now; a second copy down here was just a duplicate
  // of the same fact. These (and every field through Skills below) fall
  // through the write-back listener's own generic "any other plain string
  // stat" branch — no special-casing needed there.
  [
    ["passivePerception", "Passive Perception", stats.senses?.passives?.perception ?? ""],
    ["speed", "Speed", formatSpeedValue(stats.speed)],
    ["size", "Size", stats.size ?? ""],
    ["alignment", "Alignment", stats.alignment ?? ""],
  ].forEach(([key, label, value]) => {
    elements.statsFields.appendChild(buildStatCard({ key, label, value }));
  });
  elements.statsFields.appendChild(
    buildStatCard({
      key: "languages",
      label: "Languages",
      value: joinListValue(stats.proficiencies?.languages),
      colClass: "col-8 col-md-4",
    })
  );

  // Row 4: Resistances, Immunities, Vulnerabilities — 2× the ability score
  // box's width each (col-md-4), same 3 × 4 = 12 full-row fit as Row 3's
  // Languages box.
  // Always rendered (even empty) now that they're editable — a blank
  // Resistances field is how a GM adds one that wasn't rolled, same as any
  // other stat. Vulnerabilities only ever has real values on an imported
  // record today (see isImportedStatBlock) — Crucible's own generator
  // doesn't produce it — but it renders unconditionally here too, same
  // "always show, even blank" convention as the others.
  //
  // All three read from the single unified `stats.proficiencies.defenses`
  // array (this suite's one shared shape — matching every import mapping's
  // own defenses function and Character's own proficiencies.defenses
  // exactly), filtered by `type`. Immunities also includes condition
  // immunities — 5.5e no longer distinguishes them, and neither does this
  // shape (a condition immunity is just `type: "immunity"` too, same as a
  // damage immunity). Editing a box re-splits ONLY that type's entries and
  // merges with the other two types' untouched entries (see the
  // statsFields write-back listener below) — this loses any `condition`/
  // `value` sub-fields on entries in the edited type, same lossiness plain-
  // text editing already has for every other list field here.
  [
    ["damageResistances", "Resistances", "resistance"],
    ["damageImmunities", "Immunities", "immunity"],
    ["damageVulnerabilities", "Vulnerabilities", "vulnerability"],
  ].forEach(([key, label, type]) => {
    const value = joinListValue(
      (stats.proficiencies?.defenses || []).filter((entry) => entry.type === type).map((entry) => entry.name)
    );
    elements.statsFields.appendChild(buildStatCard({ key, label, value, colClass: "col-8 col-md-4" }));
  });

  // Row 5: Senses, Saving Throws, Skills — 2× the ability score box's width
  // each (col-md-4), same 3 × 4 = 12 full-row fit as Row 4. Saving
  // Throws/Skills come off an import as `[{name, value}]` (e.g.
  // `[{name:"Con", value:5}]`); nothing in Crucible reads that shape
  // programmatically (deriveStats' own native output has no equivalent
  // field at all), so monster-feature-matching.js already flattens both to
  // a plain "Con +5, Wis +3" string during conversion — this just
  // displays/edits that string directly.
  [
    ["senses", "Senses", formatSensesValue(stats.senses)],
    ["savingThrows", "Saving Throws", stats.savingThrows ?? ""],
    ["skills", "Skills", stats.skills ?? ""],
  ].forEach(([key, label, value]) => {
    elements.statsFields.appendChild(buildStatCard({ key, label, value, colClass: "col-8 col-md-4" }));
  });

  // Row 6: Spells stays its own full-width row — genuinely irregular shape
  // (an intro sentence plus per-frequency spell lists), and far longer than
  // any other stat here, so it doesn't belong squeezed into a 2-wide box.
  // A 3-row textarea (not a single-line input) so that shape is actually
  // readable/editable in place instead of scrolling horizontally.
  elements.statsFields.appendChild(
    buildStatCard({
      key: "spells",
      label: "Spells",
      value: stats.spells ?? "",
      compact: false,
      colClass: "col-12",
      type: "textarea",
      rows: 3,
    })
  );

  // Actions (attackBonus/damageDice math) and the Feature budget both moved
  // out of Stats — see renderFeatureList/renderFeatureBudget. A
  // Crucible-generated action shares its name with the Feature it came
  // from (buildActions, crucible/js/lib/stats.js), so it now renders
  // inline on that Feature's own row instead of duplicated as a second,
  // numbers-only entry down here.
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
  if (elements.deleteButton) {
    elements.deleteButton.disabled = !hasRecord || !dirtyGate.hasSaved() || !monsterAllowsDelete(currentMonsterId);
  }
  if (elements.exportButton) elements.exportButton.disabled = !hasRecord;
}

// One button, not a two-way radio group — clicking it steps to the OTHER
// mode each time, same toggle-not-select idiom Repository's own Edit/View
// button uses (undercroft/repository/js/app.js#applyMode) for the identical
// concept. Icon/label always describe what clicking will switch TO, not the
// current state. Defaults to "edit" (unlike Repository, which defaults new
// pages to edit but existing ones to view) — Notes here is a small single
// field actively being typed into or Generated, not a page being read.
let notesMode = "edit";

function renderNotesPreview() {
  if (!elements.notesPreview) return;
  elements.notesPreview.innerHTML = "";
  elements.notesPreview.appendChild(renderMarkdown(currentRecord?.notes || ""));
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
  elements.notesModeToggle?.setAttribute("data-bs-title", isView ? "Edit" : "View");
  refreshTooltips();
  if (isView) renderNotesPreview();
}

function renderMonster(record) {
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
  // Rebuilt each render, like Identity below — image isn't read from the DOM
  // at save time the way name/notes are (see buildRecordForSave); it commits
  // straight to currentRecord.image on blur/library-pick instead, same as
  // Forge's own NPC Image field.
  if (elements.imageMount) {
    elements.imageMount.innerHTML = "";
    elements.imageMount.appendChild(
      createTokenImageField({
        id: "crucibleMonsterImage",
        label: "Image",
        // Matches the Name field box (createFieldBox) it sits inline
        // beside — per explicit feedback that Image looking visually
        // different from every other field box was the thing to fix.
        boxed: true,
        value: record.image || "",
        dataManager,
        status,
        onSelect: (url) => {
          currentRecord.image = url;
          dirtyGate.markDirty();
          updateActionButtons();
        },
      })
    );
  }
  renderIdentity(record);
  renderFeatureList(record);
  renderFeatureBudget(record);
  populateAddFeatureSelect();
  renderRecipeSummary(record);
  renderStats(record);
  if (elements.notesText) elements.notesText.value = record.notes || "";
  if (notesMode === "view") renderNotesPreview();
  elements.inspectorEmpty?.classList.remove("d-none");
  elements.inspectorDetail?.classList.add("d-none");
  updateActionButtons();
  jsonDataPanel.render();
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
      combatScalingField: getCombatScalingFieldPreference(systemId),
      combatScalingId: elements.combatScalingOverride?.value || "",
      role: findById(roles, generated.roleId),
      creatureType: findById(creatureTypes, generated.type),
      features: generated.featureIds.map((id) => findById(features, id)).filter(Boolean),
      dataManager,
    });
    const record = createMonsterRecord({ ...generated, stats });
    dirtyGate.markDirty();
    // Freshly generated content is always unsaved, regardless of whichever
    // saved Monster the picker previously pointed at — mirrors Sanctum's
    // handleGenerate resetting locationCleanSnapshot the same way.
    currentMonsterId = null;
    if (elements.monsterSelect) elements.monsterSelect.value = "";
    updateGenerationFieldsVisibility();
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
    // Every monster save gets its remaining raw stat-block groups (traits/
    // actions/bonusActions/reactions/legendaryActions/lairActions)
    // converted into real Feature references, unconditionally — not an
    // opt-in extra step, no button anywhere for this (see
    // monster-feature-matching.js's own module comment). Loom's saveEntity
    // already does this for imports made through Loom; Crucible's own save
    // here bypasses saveEntity entirely (writes straight to
    // dataManager.save), so it needs the same call directly. Idempotent —
    // hasConvertibleStatBlock is false once nothing's left to convert, so
    // this is a safe no-op on every subsequent save of the same record.
    if (hasConvertibleStatBlock(currentRecord.stats)) {
      await convertStatBlockToFeatures(currentRecord, {
        dataManager,
        existingFeatures: features,
        monsterSlug: currentRecord.id,
      });
    }
    // Default mode ("auto") matters here exactly like Forge's NPC save: an
    // anonymous GM saves locally to their own browser, a signed-in user gets
    // a real owned/shareable record — Crucible has no whole-tool login gate.
    const exported = toPressExportShape(currentRecord);
    await dataManager.save("monster", currentRecord.id, exported);
    dirtyGate.markClean(exported);
    currentMonsterId = currentRecord.id;
    status?.show("Saved.", { type: "success", timeout: 1500 });
    await populateMonsterSelect();
    updateActionButtons();
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

async function handleDelete() {
  if (!currentRecord || !dataManager || !dirtyGate.hasSaved() || !monsterAllowsDelete(currentMonsterId)) return;
  const label = currentRecord.name || currentRecord.id;
  if (!confirmDelete({ label: `"${label}"` })) return;
  try {
    await dataManager.delete("monster", currentRecord.id);
    status?.show("Deleted.", { type: "success", timeout: 1500 });
    dirtyGate.markDirty();
    currentMonsterId = null;
    renderMonster(null);
    await populateMonsterSelect();
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
    buildRequestBody: (record) => {
      const imported = isImportedStatBlock(record);
      // Archetype/Role/Signature Feature are genuinely native-generation-
      // only concepts — an imported record never has these, converted or
      // not — but `features` uses featureIds whenever they're populated
      // (regardless of import provenance), same "featureIds presence, not
      // provenance" reasoning as renderFeatureList/populateAddFeatureSelect
      // above: Feature-matching runs automatically on every save now, so a
      // converted import's real Feature references are the accurate thing
      // to send, not its now-empty raw stats.traits/actions groups. Only a
      // record that hasn't been converted yet falls back to those raw
      // groups.
      const hasFeatureIds = Array.isArray(record.featureIds) && record.featureIds.length > 0;
      const stats = record.stats || {};
      return {
        name: record.name || "",
        creatureType: findById(creatureTypes, record.type)?.name || record.type || "",
        archetype: imported ? "" : findById(archetypes, record.archetypeId)?.name || record.archetypeId,
        role: imported ? "" : findById(roles, record.roleId)?.name || record.roleId,
        signatureFeature: !imported && record.signatureFeatureId ? featureLabel(record.signatureFeatureId) : "",
        features: hasFeatureIds
          ? record.featureIds.map((featureId) => {
              const feature = findById(features, featureId);
              return { name: feature?.name || featureId, description: feature?.description || "" };
            })
          : IMPORTED_STAT_BLOCK_ABILITY_GROUPS.flatMap(([key]) => stats[key] || []).map((entry) => ({
              name: entry.name || "",
              description: entry.description || "",
            })),
      };
    },
  });
  if (success) updateActionButtons();
}

async function init() {
  const shell = initAppShell({
    namespace: "crucible",
    storagePrefix: "undercroft.crucible.undo",
    settingsSlotAttr: "data-crucible-settings-slot",
  });
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
  elements.addFeatureButton?.addEventListener("click", () => {
    const featureId = elements.addFeatureSelect?.value;
    if (featureId) addFeature(featureId);
  });
  // Named (not an inline listener) so the init flow below can also call
  // this directly when auto-selecting the active campaign group's own
  // System.
  async function handleSystemSelectChange() {
    markRequiredControl(elements.systemSelect, Boolean(elements.systemSelect.value));
    // A different System means any previously loaded Monster (and the
    // reference data it was built from) is no longer relevant — same
    // reasoning as Sanctum resetting currentSettingId/currentLocationId on
    // its own System change.
    currentMonsterId = null;
    renderMonster(null);
    await reloadReferenceData();
  }
  elements.systemSelect?.addEventListener("change", handleSystemSelectChange);

  elements.monsterSelect?.addEventListener("change", async () => {
    const id = elements.monsterSelect.value;
    currentMonsterId = id || null;
    updateGenerationFieldsVisibility();
    if (!id) {
      renderMonster(null);
      return;
    }
    try {
      // preferLocal: false — this app changed Deep One Priest's own file
      // directly on disk (a manual conversion, not a save through this
      // app), and any GM who'd already loaded it once had that pre-
      // conversion copy sitting in their browser's local cache ever since —
      // the exact same stale-cache bug class fixed repeatedly elsewhere in
      // this suite this session (Sanctum/Forge's own Setting/Location
      // loaders, the shared fetchKindEntriesWithIds). A monster select
      // should always show what's actually on the server right now.
      const result = await dataManager.get("monster", id, { preferLocal: false });
      if (!result?.payload) {
        status?.show("Unable to load that monster.", { type: "error", timeout: 4000 });
        return;
      }
      // Not createMonsterRecord — that function always stamps a fresh id
      // and createdAt (see monster-schema.js), which is right for a NEW
      // generation but would silently rewrite an existing record's real
      // creation time on every load.
      renderMonster({ ...result.payload, id });
      dirtyGate.markClean(toPressExportShape(currentRecord));
      updateActionButtons();
    } catch (error) {
      status?.show(`Unable to load monster: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });

  // Combat Scaling/Creature Type field pickers, moved into a gear-icon
  // Settings modal (upper-left of the header) — same shared module and
  // visual pattern Repository's own Settings button already uses. Each
  // definition's getValue/setValue defers straight to the per-System
  // dataManager.getLocal/saveLocal helpers above rather than this module's
  // own flat store, since the value is genuinely scoped per-System, not
  // per-tool (see tool-settings.js's own comment on that option).
  initToolSettings({
    toolId: "crucible",
    dataManager,
    status,
    title: "Crucible Settings",
    definitions: () => {
      const systemId = currentSystemId();
      const options = fieldPreferenceOptions();
      return [
        {
          key: "combatScalingField",
          type: "select",
          label: "Combat scaling field",
          helpTopic: "crucible.combatScalingField",
          options,
          getValue: () => resolveEffectiveFieldPreference("combatScalingField", getCombatScalingFieldPreference(systemId)),
          setValue: (value) => {
            setCombatScalingFieldPreference(systemId, value);
            reloadReferenceData();
          },
        },
        {
          key: "creatureTypeField",
          type: "select",
          label: "Creature type field",
          helpTopic: "crucible.creatureTypeField",
          options,
          getValue: () => resolveEffectiveFieldPreference("creatureTypeField", getCreatureTypeFieldPreference(systemId)),
          setValue: (value) => {
            setCreatureTypeFieldPreference(systemId, value);
            reloadReferenceData();
          },
        },
      ];
    },
    // Queried live (not via `elements`) because the header — and this
    // mount point inside it — is now built by initAppShell() itself, which
    // runs after `elements` above is already constructed; an eager query
    // here would have captured null.
    mountButton: (button) => document.querySelector("[data-crucible-settings-slot]")?.appendChild(button),
  });

  // Name/Notes aren't written back into currentRecord until Save/Export
  // actually runs (see buildRecordForSave) — without this, editing either
  // field wouldn't re-enable an already-saved record's Save button until
  // some unrelated re-render happened to call updateActionButtons() again.
  elements.nameInput?.addEventListener("input", updateActionButtons);
  elements.notesText?.addEventListener("input", updateActionButtons);
  elements.notesModeToggle?.addEventListener("click", () => {
    // Notes isn't written back into currentRecord until Save/Export (see
    // buildRecordForSave) — switching to View needs the live textarea value,
    // not whatever was last saved, so it's synced here same as handleSave
    // already does.
    if (currentRecord) currentRecord.notes = elements.notesText?.value || "";
    applyNotesMode(notesMode === "view" ? "edit" : "view");
  });

  // Typing directly into a Stats field keeps currentRecord in sync the same
  // way Forge's own statsFields listener does (forge/js/app.js) — writes
  // straight into currentRecord.stats without a full renderStats() re-run
  // (which would jump the cursor mid-keystroke), and relies on
  // updateActionButtons' own live dirtyGate.isDirty() diffing rather than
  // an explicit markDirty() call, same reasoning Forge's version documents.
  elements.statsFields?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-editable-stat]");
    if (!input || !currentRecord?.stats) return;
    const key = input.dataset.editableStat;
    const stats = currentRecord.stats;
    if (key.startsWith("ability:")) {
      const abilityKey = key.slice("ability:".length);
      const numericValue = Number(input.value) || 0;
      currentRecord = { ...currentRecord, stats: { ...stats, abilities: { ...(stats.abilities || {}), [abilityKey]: numericValue } } };
      const suffixEl = elements.statsFields.querySelector(`[data-editable-stat-suffix="${key}"]`);
      if (suffixEl) suffixEl.textContent = abilityModifierText(numericValue);
    } else if (key === "currentHp" || key === "maxHp") {
      const numericValue = Number(input.value) || 0;
      const hpKey = key === "currentHp" ? "current" : "max";
      currentRecord = { ...currentRecord, stats: { ...stats, hitPoints: { ...(stats.hitPoints || {}), [hpKey]: numericValue } } };
    } else if (key === "armorClass" || key === "saveDC") {
      currentRecord = { ...currentRecord, stats: { ...stats, [key]: Number(input.value) || 0 } };
    } else if (key === "senses") {
      currentRecord = { ...currentRecord, stats: { ...stats, senses: parseSensesText(input.value, stats.senses) } };
    } else if (key === "speed") {
      currentRecord = { ...currentRecord, stats: { ...stats, speed: parseSpeedText(input.value) } };
    } else if (key === "passivePerception") {
      currentRecord = {
        ...currentRecord,
        stats: { ...stats, senses: { ...(stats.senses || {}), passives: { ...(stats.senses?.passives || {}), perception: Number(input.value) || 0 } } },
      };
    } else if (key === "languages") {
      const list = input.value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      currentRecord = { ...currentRecord, stats: { ...stats, proficiencies: { ...(stats.proficiencies || {}), languages: list } } };
    } else if (DEFENSE_TYPE_BY_STAT_KEY[key]) {
      const type = DEFENSE_TYPE_BY_STAT_KEY[key];
      const entries = input.value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((name) => ({ name, type }));
      // Re-split ONLY this box's own type, merged with the other two
      // types' entries untouched — this loses any condition/value
      // sub-fields on entries in the EDITED type (there's no way to tell
      // which edited name corresponds to which original entry anymore
      // once they're combined into one comma-separated box), same
      // lossiness plain-text editing already has for every other list
      // field here.
      const otherEntries = (stats.proficiencies?.defenses || []).filter((entry) => entry.type !== type);
      currentRecord = {
        ...currentRecord,
        stats: { ...stats, proficiencies: { ...(stats.proficiencies || {}), defenses: [...otherEntries, ...entries] } },
      };
    } else {
      // challengeRating, or any other plain string stat.
      currentRecord = { ...currentRecord, stats: { ...stats, [key]: input.value } };
    }
    jsonDataPanel.render();
    updateActionButtons();
  });

  // Per-field reroll button (createFieldBox's own `rerollable` option) —
  // same convention Forge's Identity/4D fields use. Only wired for the
  // non-imported branch's 4 select boxes (buildStatCard/renderIdentity
  // never sets `rerollable` on an imported stat block's free-text boxes),
  // so no isImportedStatBlock guard is needed here.
  elements.identityFields?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll-attribute]");
    if (!button || !currentRecord) return;
    renderMonster(rerollAttribute(currentRecord, { creatureTypes, archetypes, roles, features }, currentSystemId(), button.dataset.rerollAttribute));
  });

  // Picking a Creature Type/Archetype/Role/Signature Feature (or, for an
  // imported stat block, typing a Size/Type/Alignment/Speed) keeps
  // currentRecord in sync — "change" (not "input", unlike Stats above)
  // since these are select-driven except the imported branch, and neither
  // branch needs Stats' own live per-keystroke recompute.
  elements.identityFields?.addEventListener("change", (event) => {
    const target = event.target.closest("[data-editable-identity]");
    if (!target || !currentRecord) return;
    const key = target.dataset.editableIdentity;
    if (isImportedStatBlock(currentRecord)) {
      currentRecord = { ...currentRecord, stats: { ...currentRecord.stats, [key]: target.value } };
    } else {
      currentRecord = { ...currentRecord, [key]: target.value || null };
    }
    jsonDataPanel.render();
    updateActionButtons();
  });

  document.querySelector("[data-json-mount]")?.appendChild(jsonDataPanel.section);

  // If a campaign group is active (the header's Campaign dropdown) and that
  // group has its own System assigned, default Crucible's System select to
  // it — a real, GM-chosen fact about the campaign being played, not a
  // guess — to make mid-campaign generation faster. Falls through to the
  // original "nothing chosen yet" placeholder whenever there's no active
  // group, or its System isn't one this tool's own list actually contains.
  const systems = await populateSystemSelect();
  const groupContext = await resolveGroupContext(dataManager).catch(() => null);
  const defaultSystemId = pickGroupDefaultId(groupContext, "systemId", systems);
  if (defaultSystemId) {
    elements.systemSelect.value = defaultSystemId;
    await handleSystemSelectChange();
  } else {
    await reloadReferenceData();
  }
  renderMonster(null);

  initHelpSystem();
  refreshTooltips();
}

init();
