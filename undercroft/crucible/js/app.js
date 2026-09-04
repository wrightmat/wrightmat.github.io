import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips, disposeTooltips, updateTooltipContent, setDisabledTooltip } from "../../common/js/lib/tooltips.js";
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
import {
  listCreatureTypesForSystem,
  listArchetypesForSystem,
  listRolesForSystem,
  listFeaturesForSystem,
  listMonstersForSystem,
  loadCombatScalingLevels,
  loadAbilityFieldDefs,
} from "./lib/tables.js";
import { resolveFieldRole } from "../../common/js/lib/field-roles.js";
import { generateMonster, getMonsterGenerationBlockReason, matchesCategory, rerollAttribute } from "./lib/generator.js";
import { deriveStats } from "./lib/stats.js";
import { loadSystemFields, deriveCombatBindings } from "../../common/js/lib/widgets/combat-bindings.js";
import { fetchKindEntriesWithIds } from "../../common/js/lib/content-fetch.js";
import { buildKindToolUrl } from "../../common/js/lib/kind-tool-route.js";
import { convertLibraryRecord, seedCharacterDefaults } from "../../common/js/lib/library-record-convert.js";
import { loadArrayFieldValues } from "../../common/js/lib/generator-kit.js";
import { createMonsterRecord, toPressExportShape } from "./lib/monster-schema.js";
import { hasConvertibleStatBlock, convertStatBlockToFeatures } from "../../common/js/lib/monster-feature-matching.js";
import { createReferenceChip } from "../../common/js/lib/library-reference.js";
// The weapon-attack/rider/save-effect/`options`-menu editor — shared with
// Vault's own Basic Authoring mode rather than a second hand-rolled copy.
import { createFeatureParamsEditor } from "../../common/js/lib/feature-params-editor.js";
// Reused as-is from Repository. No options passed — Crucible has no page
// index/wiki-link/dice/macro/encounter context, and renderMarkdown degrades
// gracefully without any of that.
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
  setGenerateButtonReadiness,
} from "../../common/js/lib/generator-kit.js";
import { markRequiredControl, setElementVisible } from "../../common/js/lib/dom.js";
import { resolveGroupContext, pickGroupDefaultId } from "../../common/js/lib/widgets/group-context.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
import { createTokenImageField } from "../../common/js/lib/token-picker.js";
import { abilityModifier, averageDiceRoll, computeAttackBonus, computeSaveDC, computeAverageDamage } from "../../common/js/lib/derived-formulas.js";
import { renderRelationshipEditor } from "../../common/js/lib/relationship-editor.js";
import { buildRelationshipGraph } from "../../common/js/lib/relationship-graph.js";
import { createForceGraph } from "../../common/js/lib/graph-view.js";

let status = null;
let undoStack = null;
let performUndo = null;
let performRedo = null;
let dataManager = null;
let creatureTypes = [];
let archetypes = [];
let roles = [];
let features = [];
let combatScalingLevels = [];
// The active System's own ability key/label list, so renderStats' display
// rows use the System's real vocabulary instead of a hardcoded STR/DEX/...
let abilityFieldDefs = [];
// Which of these ability keys the System stores its stat block under —
// "abilities" for D&D, "traits" for Daggerheart, ... — never hardcoded.
let abilityFieldKey = "";
// The active System's own live-play-state bindings (HP/AC/Initiative/...);
// deriveStats writes each value through setAtBinding against whatever path
// these declare, never a hardcoded "stats.hitPoints" assumption. null for a
// System with no Role-bound field at all.
let combatBindings = null;
let derivedFormulas = [];
let currentRecord = null;
const featureParamsEditor = createFeatureParamsEditor({
  getRecord: () => currentRecord,
  onParamsChanged: () => refreshAfterFeatureEdit(),
  saveFeature: (feature) => dataManager.save("feature", feature.id, feature),
  onFeatureSaved: () => renderFeatureList(currentRecord),
  getAbilityFieldDefs: () => abilityFieldDefs,
});
// Which row in the Features list the Inspector panel is showing — tracked at
// module level so the Multiattack editor's "Add" button (attached once, at
// init) knows which Feature to edit without it threaded through as an arg.
let selectedFeatureId = null;
// Every saved monster for the active System plus its ownership metadata.
// currentMonsterId tracks which saved id (if any) the picker points at,
// separate from currentRecord (the live, possibly-unsaved data).
let monstersInSystem = [];
let monsterCatalog = new Map();
let currentMonsterId = null;
// Whether the record as last saved differs from a live snapshot — built from
// currentRecord plus whatever's typed into Name/Notes, since those two only
// land on currentRecord at Save/Export time — to gate the Save button and
// know whether Delete has anything real on the server to target.
const dirtyGate = createDirtyGate({ buildSnapshot: () => toPressExportShape(buildRecordForSave()) });

// Whole-record snapshot undo. Snapshots use buildRecordForSave() (not
// currentRecord directly) so a Name/Notes edit is still captured; restoring
// goes through renderMonster, which writes record.name/record.notes back
// into their live inputs. Feature-params sub-edits (routed through the
// shared featureParamsEditor) are NOT wrapped here — undo is scoped to this
// file's own primary mutation points, not every nested editing surface.
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
  renderMonster(JSON.parse(json));
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

// Mounted before `elements` below queries for these buttons, so every
// selector/disabled-state call site elsewhere in this file keeps working.
createToolbarButtonGroup([
  // Starts disabled — nothing to generate FROM until reloadReferenceData
  // resolves; re-enabled by init() once it does.
  { action: "generate", label: "Generate Monster", disabled: true, attrs: { "data-generate-monster": true } },
  { action: "save", label: "Save", disabled: true, attrs: { "data-save-monster": true } },
  { action: "duplicate", label: "Duplicate", disabled: true, attrs: { "data-duplicate-monster": true } },
  { action: "delete", label: "Delete", disabled: true, attrs: { "data-delete-monster": true } },
]).forEach((button) => document.querySelector("[data-monster-toolbar-mount]")?.appendChild(button));
createToolbarButtonGroup([
  { action: "undo", label: "Undo", attrs: { "data-undo-monster": true } },
  { action: "redo", label: "Redo", attrs: { "data-redo-monster": true } },
]).forEach((button) => document.querySelector("[data-monster-undo-toolbar-mount]")?.appendChild(button));
// A genuinely new, cross-tool action — not a 5th slot on the primary
// cluster above, and not a second toolbar row either. Lives in its own
// "Monster Properties" Inspector section instead (mounted below).
createToolbarButtonGroup([
  {
    icon: "tabler:user-plus",
    label: "Convert to Character",
    disabled: true,
    attrs: { "data-convert-to-character-monster": true },
  },
]).forEach((button) => document.querySelector("[data-monster-convert-toolbar-mount]")?.appendChild(button));
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
]).forEach((button) => document.querySelector("[data-feature-inspector-toolbar-mount]")?.appendChild(button));
document.querySelector("[data-monster-empty-state]")?.appendChild(
  createEmptyStateCard({
    message: "Nothing selected yet. Pick an existing Monster above, or fill in the fields and click Generate Monster.",
    variant: "inline",
  })
);

// replaceWith, not appendChild — an appended-into wrapper stays an
// empty-but-in-flow flex item even while its field is conditionally hidden,
// silently spending a full gap-3 on both sides. Any class the static mount
// div carried is merged onto the built field first so removing the wrapper
// doesn't lose that layout.
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
mountField(
  "convert-character-name",
  createCompactField({
    type: "text", id: "crucibleConvertCharacterName", label: "Character Name", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control",
    dataAttr: "data-convert-character-name", required: true,
  })
);
mountField(
  "convert-character-template",
  createCompactField({
    type: "select", id: "crucibleConvertCharacterTemplate", label: "Template", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-convert-character-template", required: true,
  })
);
// Same field-box style as Identity/Stats below, so Name/Image match the
// boxes around them instead of standing out with plain form-control styling.
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
  duplicateButton: document.querySelector("[data-duplicate-monster]"),
  deleteButton: document.querySelector("[data-delete-monster]"),
  undoButton: document.querySelector("[data-undo-monster]"),
  redoButton: document.querySelector("[data-redo-monster]"),
  convertToCharacterButton: document.querySelector("[data-convert-to-character-monster]"),
  convertCharacterForm: document.querySelector("[data-convert-to-character-form]"),
  convertCharacterNameInput: document.querySelector("[data-convert-character-name]"),
  convertCharacterTemplateSelect: document.querySelector("[data-convert-character-template]"),
  convertCharacterSubmitButton: document.querySelector("[data-convert-to-character-submit]"),
  convertToCharacterModalEl: document.getElementById("convert-to-character-modal"),
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
  monsterRelationships: document.querySelector("[data-monster-relationships]"),
  modeToggleMount: document.querySelector("[data-crucible-mode-toggle-mount]"),
  relationshipsListMount: document.querySelector("[data-relationships-list-mount]"),
  relationshipsGraphWrap: document.querySelector("[data-relationships-graph-wrap]"),
  relationshipsGraphContainer: document.querySelector("[data-relationships-graph-container]"),
  relationshipsGraphContent: document.querySelector("[data-relationships-graph-content]"),
  relationshipsGraphSvg: document.querySelector("[data-relationships-graph-svg]"),
  relationshipsGraphControls: document.querySelector("[data-relationships-graph-controls]"),
  relationshipsGraphToolbarMount: document.querySelector("[data-relationships-graph-toolbar-mount]"),
  relationshipsGraphEmpty: document.querySelector("[data-relationships-graph-empty]"),
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
  multiattackEditor: document.querySelector("[data-multiattack-editor]"),
  multiattackOptions: document.querySelector("[data-multiattack-options]"),
  multiattackEmptyNote: document.querySelector("[data-multiattack-empty-note]"),
  multiattackAddOptionButton: document.querySelector("[data-multiattack-add-option-button]"),
  featureParamsEditor: document.querySelector("[data-feature-params-editor]"),
  editFeatureButton: document.querySelector("[data-edit-feature-button]"),
  featureBasicId: document.querySelector("[data-feature-basic-id]"),
  featureBasicName: document.querySelector("[data-feature-basic-name]"),
  featureBasicDescription: document.querySelector("[data-feature-basic-description]"),
  featureBasicBudgetCost: document.querySelector("[data-feature-basic-budget-cost]"),
};

// Monster Properties — currently just Convert to Character, but its own
// section (not the Inspector's) since it's about the Monster itself, not
// whatever the Inspector happens to be showing (Feature detail). Starts
// collapsed; expandMonsterPropertiesSection opens it on generate/select.
const monsterPropertiesSection = createCollapsibleSection({
  label: "Monster Properties",
  collapsed: true,
  content: document.querySelector("[data-monster-properties-panel]"),
});
document.querySelector("[data-monster-properties-mount]")?.appendChild(monsterPropertiesSection.section);
function expandMonsterPropertiesSection() {
  monsterPropertiesSection.setCollapsed(false);
}

// Adopts each section's existing static `[data-xxx-panel]` markup (content
// stays hand-authored HTML — only the header+chevron wrapper is JS-built).
// Notes keeps its "Generate Note" sibling button in static HTML, so only
// its toggle is built and mounted.
{
  const inspectorSection = createCollapsibleSection({
    label: "Inspector",
    collapsed: false,
    content: document.querySelector("[data-inspector-panel]"),
  });
  document.querySelector("[data-inspector-mount]")?.appendChild(inspectorSection.section);

  // Nested collapsible, inside the Inspector's own collapsible content —
  // collapsed by default since it's a diagnostic/power-user detail, not
  // something a GM needs open the way the structured editors above it are.
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
      helpTopic: "crucible.identity",
      collapsed: false,
      content: document.querySelector("[data-identity-panel]"),
    }).section
  );

  // Toggle-only (not the full createCollapsibleSection header) — the
  // Feature budget summary is static HTML in the header that a built
  // header would clobber.
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

  // Collapsed by default — a supplementary detail (which slot each feature
  // filled), not something the GM needs open at a glance.
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

// Which array field Crucible treats as combat-scaling/creature-type data is
// a Crucible tool preference, not System data — lives in local storage
async function populateSystemSelect() {
  const systems = await listAllSystems(dataManager);
  // Disabled, not just blank — a real System is required before anything
  // else in this tool is usable, so the picker shouldn't silently fall back
  // to whichever System sorts first. Can't be reselected once chosen.
  renderRequiredSelectOptions(elements.systemSelect, systems, { placeholder: "Select a System" });
  markRequiredControl(elements.systemSelect, Boolean(elements.systemSelect?.value));
  return systems;
}

// Ownership metadata comes from the list response, not the full fetched
// body. Local-only (anonymous, browser-storage) entries are always
// deletable, since it's just this browser's own storage.
async function refreshMonsterCatalog(ids) {
  monsterCatalog = await refreshOwnershipCatalog(dataManager, "monster", ids);
}

function monsterAllowsDelete(id) {
  return allowsDelete(monsterCatalog, id, { dataManager });
}

// Every saved Monster for the active System, scoped by System alone (no
// Setting concept here). "New / unsaved" is the default so a fresh Generate
// Monster keeps working as before.
async function populateMonsterSelect() {
  if (!elements.monsterSelect) return;
  const systemId = currentSystemId();
  monstersInSystem = systemId ? await listMonstersForSystem(dataManager, systemId) : [];
  const sorted = [...monstersInSystem].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  renderOptionalSelectOptions(elements.monsterSelect, sorted, { previousValue: currentMonsterId || "" });
  await refreshMonsterCatalog(monstersInSystem.map((monster) => monster.id));
  updateGenerationFieldsVisibility();
}

// The generation overrides only matter for generating something new — once
// an existing Monster is loaded they're just clutter. Purely visual: hiding
// never clears an override's underlying value.
function updateGenerationFieldsVisibility() {
  elements.generationFields?.classList.toggle("d-none", Boolean(elements.monsterSelect?.value));
}

// Creature Type/Archetype/Role/signature Feature are all optional overrides
// — blank = "Random" — not a required cascade.
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
  let fetchedFeatures;
  let systemFields;
  [creatureTypes, archetypes, roles, fetchedFeatures, combatScalingLevels, abilityFieldDefs, systemFields] = await Promise.all([
    listCreatureTypesForSystem(dataManager, systemId),
    listArchetypesForSystem(dataManager, systemId),
    listRolesForSystem(dataManager, systemId),
    listFeaturesForSystem(dataManager, systemId),
    loadCombatScalingLevels(dataManager, systemId),
    loadAbilityFieldDefs(dataManager, systemId),
    loadSystemFields(dataManager, systemId),
  ]);
  abilityFieldKey = resolveFieldRole({ fields: systemFields }, "abilityScores")?.sourceField || "abilities";
  combatBindings = deriveCombatBindings(systemFields);
  derivedFormulas = (systemFields || []).find((entry) => entry?.key === "derivedFormulas")?.values || [];
  // The shared `feature` kind also holds Sanctum's location features and
  // Vault's spell/item features — filtered here, once, so every consumer of
  // the module-level `features` array only ever sees Crucible's own.
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
// SRD/DDB/Fantasy Statblocks import saves to the same shared kind.
// Provenance (`record.mapping`, the suite's standard "was this imported?"
// signal), not data shape, is the correct discriminator — feature-matching
// normalizes an imported record's traits/actions into `featureIds` the same
// way native generation does, so shape alone can't tell them apart.
function isImportedStatBlock(record) {
  return Boolean(record?.mapping);
}

// `data-editable-identity` is this section's own write-back attribute,
// distinct from Stats' own `data-editable-stat` since the two sections
// write into different parts of the record (top-level here vs. `record.stats`).
function renderIdentity(record) {
  if (!elements.identityFields) return;
  elements.identityFields.innerHTML = "";
  // Creature Type always renders (every monster carries it regardless of
  // provenance). Archetype/Role are Crucible's own generation axes an
  // imported record never has. Signature Feature isn't a field here — it's
  // already shown, labeled "Signature", on its own row in the Features list.
  // blankLabel: an unrecognized value (e.g. an import whose raw type didn't
  // resolve) would otherwise silently render as whichever option sorts
  // first alphabetically — a confidently wrong answer instead of "nothing
  // chosen". Native generation's blank truly means "resolve randomly"; an
  // imported record has no such reroll-on-save behavior, so it gets a
  // different label.
  const imported = isImportedStatBlock(record);
  const fields = [
    { key: "type", label: "Creature Type", value: record.type, source: creatureTypes, blankLabel: imported ? "— Unset —" : "Random" },
  ];
  if (!imported) {
    fields.push(
      { key: "archetypeId", label: "Archetype", value: record.archetypeId, source: archetypes, blankLabel: "Random" },
      { key: "roleId", label: "Role", value: record.roleId, source: roles, blankLabel: "Random" }
    );
  }
  fields.forEach(({ key, label, value, source, blankLabel }) => {
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
  selectedFeatureId = feature ? featureId : null;
  if (!feature) {
    elements.inspectorEmpty?.classList.remove("d-none");
    elements.inspectorDetail?.classList.add("d-none");
    return;
  }
  elements.inspectorEmpty?.classList.add("d-none");
  elements.inspectorDetail?.classList.remove("d-none");
  renderFeatureBasicInfo(feature);
  renderMultiattackEditor(feature);
  featureParamsEditor.renderFeatureParamsEditor(feature, elements.featureParamsEditor);
  if (elements.inspectorJson) elements.inspectorJson.textContent = JSON.stringify(feature, null, 2);
}

// Enabled only when mechanics.scope === "unique".
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

// Saves straight through dataManager.save("feature", ...) — a Feature-record
// edit, not a monster-record one, so the monster's own dirtyGate/Save button
// don't apply. `description` and `mechanics.text` are kept in sync when both
// are plain strings, so the Raw JSON view doesn't show a stale duplicate.
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

// A shared Feature's per-monster numbers live in
// currentRecord.featureParams[feature.id], NOT on the Feature itself. So
// editing any of them is editing part of the monster record, exactly like
// add/removeFeature below: marks the record dirty and waits for the
// monster's own Save button, rather than an independent immediate save.
// Named generically since the shared featureParamsEditor's weapon-attack/
// save-effect editors share this exact same commit path.
function refreshAfterFeatureEdit() {
  dirtyGate.markDirty();
  renderFeatureList(currentRecord);
  jsonDataPanel.render();
  updateActionButtons();
}

// A Multiattack's attack-reference data has two possible shapes on
// record.featureParams[featureId] — read here as a normalized list of option
// GROUPS (each an {featureId,count}[] AND-combination) so every caller has
// one shape to reason about: the flat `attacks` (a fixed combination, no
// real choice) is just `options` with one entry.
function multiattackOptionGroups(params) {
  if (Array.isArray(params?.options)) return params.options;
  if (Array.isArray(params?.attacks)) return [params.attacks];
  return [];
}

// Manual authoring/repair for Multiattack's own attack-reference list (see
// monster-feature-matching.js's extractMultiattackReferences) — the
// automatic prose-parsing this comes from can't, and shouldn't, attempt to
// structure a genuine CHOICE ("two Claws, two Bites, or one of each" —
// Aartuk Elder's own Multiattack), so an ability whose combination really is
// fixed but got imported with unusual phrasing extraction couldn't parse, or
// one a GM wants to type in by hand for a native monster, had no way to end
// up with a live-computed description without this. Hidden entirely for
// anything that isn't `mechanics.type === "multiattack"` — every other
// Feature kind has nothing here to edit.
//
// A single option group renders with NO visible "option" chrome (no border,
// no "Option 1" label, no remove-group button) — the common case (~200 of
// ~240 Multiattacks are a fixed combination, not a choice) shouldn't look
// more complex than it did before this workstream. That chrome only appears
// once a second option exists, via the "Add option" button below.
function renderMultiattackEditor(feature) {
  if (!elements.multiattackEditor) return;
  const isMultiattack = feature?.mechanics?.type === "multiattack";
  setElementVisible(elements.multiattackEditor, isMultiattack, "flex");
  if (!isMultiattack || !currentRecord) return;

  // Read-only here — never normalizes missing options/attacks onto the
  // record just from being viewed. Only an actual edit (add/remove below)
  // creates or mutates the real data, so merely selecting a choice-
  // structured Multiattack (which legitimately has no attacks/options at
  // all) can't leave stray in-memory state, or a false "unsaved changes"
  // prompt, behind. Always shows at least one (empty) group so a GM can
  // start authoring from scratch.
  const params = currentRecord.featureParams?.[feature.id];
  const groups = multiattackOptionGroups(params);
  const displayGroups = groups.length ? groups : [[]];
  const totalAttackCount = displayGroups.reduce((sum, group) => sum + group.length, 0);
  if (elements.multiattackEmptyNote) setElementVisible(elements.multiattackEmptyNote, totalAttackCount === 0);

  if (!elements.multiattackOptions) return;
  // Dispose every tooltip under this container BEFORE wiping it — the
  // "lingering tooltip" bug class (see tooltips.js's own header): a
  // trailing refreshTooltips() only re-arms freshly-rebuilt content, it
  // does nothing for a popup a just-destroyed option's own tooltip left
  // behind on <body>.
  disposeTooltips(elements.multiattackOptions);
  elements.multiattackOptions.innerHTML = "";
  displayGroups.forEach((group, groupIndex) => {
    elements.multiattackOptions.appendChild(renderMultiattackOptionGroup(feature, displayGroups, group, groupIndex));
  });
  // The remove/add buttons above carry their own tooltip (createIconButton's
  // `label`) — Bootstrap only wires up tooltip behavior for elements present
  // when it scans the page, so freshly-inserted ones need this same explicit
  // re-scan every other dynamically-tooltipped control in this file already
  // calls after rendering.
  refreshTooltips();
}

// Writes a normalized `groups` array (option-group list) back onto the
// record in whichever shape fits: a single group collapses back to the
// legacy flat `attacks` key (so a GM who adds then removes a second option
// ends up with the same simple shape they started with, not a permanently
// promoted `options: [[...]]`), 2+ groups use `options`.
function writeMultiattackOptionGroups(feature, groups) {
  const featureParams = currentRecord.featureParams || (currentRecord.featureParams = {});
  const params = featureParams[feature.id] || (featureParams[feature.id] = {});
  delete params.attacks;
  delete params.options;
  if (groups.length <= 1) params.attacks = groups[0] || [];
  else params.options = groups;
}

function renderMultiattackOptionGroup(feature, groups, group, groupIndex) {
  const showChrome = groups.length > 1;
  const wrapper = document.createElement("div");
  wrapper.className = showChrome ? "d-flex flex-column gap-2 border rounded-3 p-2" : "d-flex flex-column gap-2";

  if (showChrome) {
    const header = document.createElement("div");
    header.className = "d-flex align-items-center justify-content-between gap-2";
    const label = document.createElement("span");
    label.className = "small text-body-secondary fw-semibold";
    label.textContent = groupIndex === 0 ? "Option 1" : `or Option ${groupIndex + 1}`;
    // Reordering swaps this option's position in the `options` array — the
    // rendered "or"-list (multiattackDescriptionText) and the editor's own
    // "Option N" labels both just read off that array order, so a swap here
    // is the entire fix, no separate ordering field to keep in sync.
    const moveUpButton = createIconButton({
      icon: "tabler:arrow-up",
      label: "Move option up",
      variant: "outline-secondary",
      attrs: { disabled: groupIndex === 0 },
      onClick: () => {
        const nextGroups = groups.slice();
        [nextGroups[groupIndex - 1], nextGroups[groupIndex]] = [nextGroups[groupIndex], nextGroups[groupIndex - 1]];
        writeMultiattackOptionGroups(feature, nextGroups);
        renderMultiattackEditor(feature);
        refreshAfterFeatureEdit();
      },
    });
    const moveDownButton = createIconButton({
      icon: "tabler:arrow-down",
      label: "Move option down",
      variant: "outline-secondary",
      attrs: { disabled: groupIndex === groups.length - 1 },
      onClick: () => {
        const nextGroups = groups.slice();
        [nextGroups[groupIndex], nextGroups[groupIndex + 1]] = [nextGroups[groupIndex + 1], nextGroups[groupIndex]];
        writeMultiattackOptionGroups(feature, nextGroups);
        renderMultiattackEditor(feature);
        refreshAfterFeatureEdit();
      },
    });
    const removeGroupButton = createIconButton({
      icon: "tabler:trash",
      label: "Remove option",
      variant: "outline-danger",
      onClick: () => {
        const nextGroups = groups.filter((_, index) => index !== groupIndex);
        writeMultiattackOptionGroups(feature, nextGroups);
        renderMultiattackEditor(feature);
        refreshAfterFeatureEdit();
      },
    });
    const controls = document.createElement("div");
    controls.className = "d-flex align-items-center gap-1";
    controls.append(moveUpButton, moveDownButton, removeGroupButton);
    header.append(label, controls);
    wrapper.appendChild(header);
  }

  const rowsContainer = document.createElement("div");
  rowsContainer.className = "d-flex flex-column gap-2";
  group.forEach((attack, attackIndex) => {
    rowsContainer.appendChild(renderMultiattackRow(feature, groups, groupIndex, group, attack, attackIndex));
  });
  wrapper.appendChild(rowsContainer);
  wrapper.appendChild(renderMultiattackAddRow(feature, groups, groupIndex, group));
  return wrapper;
}

function renderMultiattackRow(feature, groups, groupIndex, group, attack, attackIndex) {
  const referenced = findById(features, attack.featureId);

  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";

  const name = document.createElement("span");
  name.className = "small flex-grow-1";
  // A referenced Feature that no longer resolves is shown in red rather
  // than silently vanishing from the list.
  name.textContent = referenced?.name || `${attack.featureId} (missing)`;
  if (!referenced) name.classList.add("text-danger");

  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.className = "form-control form-control-sm flex-shrink-0";
  countInput.style.maxWidth = "4.5rem";
  countInput.value = String(attack.count);
  countInput.addEventListener("change", () => {
    attack.count = Math.max(1, Math.round(Number(countInput.value)) || 1);
    countInput.value = String(attack.count);
    writeMultiattackOptionGroups(feature, groups);
    refreshAfterFeatureEdit();
  });

  const removeButton = createIconButton({
    icon: "tabler:trash",
    label: "Remove attack",
    variant: "outline-danger",
    onClick: () => {
      group.splice(attackIndex, 1);
      writeMultiattackOptionGroups(feature, groups);
      renderMultiattackEditor(feature);
      refreshAfterFeatureEdit();
    },
  });

  row.append(name, countInput, removeButton);
  return row;
}

// Every other Feature already on this monster, minus Multiattack itself and
// any OTHER Multiattack-type Feature. Scoped to ONE option group — adding an
// already-listed Feature again within that SAME group bumps its existing
// count instead of creating a second entry (a Feature can legitimately
// appear in more than one option, so this dedupes within a group, not across).
function renderMultiattackAddRow(feature, groups, groupIndex, group) {
  const row = document.createElement("div");
  row.className = "d-flex gap-2 align-items-center";

  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  const listedIds = new Set(group.map((attack) => attack.featureId));
  select.appendChild(createPlaceholderOption());
  (currentRecord?.featureIds || [])
    .filter((id) => id !== feature.id)
    .map((id) => findById(features, id))
    .filter((candidate) => candidate && candidate.mechanics?.type !== "multiattack")
    .forEach((candidate) => {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = listedIds.has(candidate.id) ? `${candidate.name || candidate.id} (already listed)` : candidate.name || candidate.id;
      select.appendChild(option);
    });

  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.className = "form-control form-control-sm flex-shrink-0";
  countInput.style.maxWidth = "4.5rem";
  countInput.min = "1";
  countInput.placeholder = "1";
  countInput.setAttribute("aria-label", "Attack count");
  // Starts blank — a pre-filled count next to an unselected placeholder read
  // as if a real attack were already queued up. Defaults to 1 once a real
  // Feature is picked.
  select.addEventListener("change", () => {
    if (select.value && !countInput.value) countInput.value = "1";
  });

  const addButton = createIconButton({
    icon: "tabler:plus",
    label: "Add attack",
    variant: "outline-secondary",
    onClick: () => {
      const targetId = select.value;
      if (!targetId) return;
      const count = Math.max(1, Math.round(Number(countInput.value)) || 1);
      const existing = group.find((attack) => attack.featureId === targetId);
      if (existing) existing.count += count;
      else group.push({ featureId: targetId, count });
      writeMultiattackOptionGroups(feature, groups);
      renderMultiattackEditor(feature);
      refreshAfterFeatureEdit();
    },
  });

  row.append(select, countInput, addButton);
  return row;
}

// "Add option" promotes the current single fixed combination into the first
// entry of a real choice, appending a fresh empty group alongside it.
function addMultiattackOption() {
  if (!currentRecord) return;
  const feature = findById(features, selectedFeatureId);
  if (!feature || feature.mechanics?.type !== "multiattack") return;
  const params = currentRecord.featureParams?.[feature.id];
  const groups = multiattackOptionGroups(params);
  const nextGroups = [...(groups.length ? groups : [[]]), []];
  writeMultiattackOptionGroups(feature, nextGroups);
  renderMultiattackEditor(feature);
  refreshAfterFeatureEdit();
}

// weapon-attack/rider/save-effect/options-menu editing lives in the shared
// featureParamsEditor instance created above.

// Every free-text ability list an imported stat block can carry, in the
// order they read most naturally. Each entry's own {name, description}
// already carries its full content, so these render directly rather than
// through Crucible's own Feature-lookup flow.
const IMPORTED_STAT_BLOCK_ABILITY_GROUPS = [
  ["traits", ""],
  ["actions", "Action"],
  ["bonusActions", "Bonus Action"],
  ["reactions", "Reaction"],
  ["legendaryActions", "Legendary Action"],
  ["lairActions", "Lair Action"],
];

// Display labels for a Feature's own `combat.actionCost` — renderFeatureList's
// right-side pill below, not shown for a trait (no actionCost).
const ACTION_COST_LABELS = {
  action: "Action",
  "bonus-action": "Bonus Action",
  reaction: "Reaction",
  "legendary-action": "Legendary",
  "lair-action": "Lair Action",
};

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];

// Multiattack is a single shared `feat.multiattack` Feature — this
// monster's own attack-reference list lives in
// record.featureParams[feature.id], not on the Feature itself.
// `attacks` is a live reference to this SAME monster's other Features, so
// resolving each referenced Feature's CURRENT name keeps the displayed text
// in sync automatically instead of going stale. Falls back to the original
// imported text whenever attacks is absent or a referenced Feature no
// longer resolves, rather than showing a broken partial sentence.
// Returns null (never a wrong-but-plausible sentence) on any resolution failure.
function describeSingleAttackSentence(attacks) {
  if (!Array.isArray(attacks) || !attacks.length) return null;
  const resolved = [];
  let total = 0;
  for (const attack of attacks) {
    const referenced = findById(features, attack.featureId);
    if (!referenced) return null;
    total += attack.count;
    resolved.push({ name: referenced.name, count: attack.count });
  }
  // A single attack type ("makes three Tentacle attacks") reads far more
  // naturally than the multi-type sentence shape below forced onto it.
  if (resolved.length === 1) {
    const { name, count } = resolved[0];
    return `The creature makes ${COUNT_WORDS[count] || count} ${name} attack${count === 1 ? "" : "s"}.`;
  }
  const parts = resolved.map(({ name, count }) => `${COUNT_WORDS[count] || count} with its ${name}`);
  const list = `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `The creature makes ${COUNT_WORDS[total] || total} attacks: ${list}.`;
}

// A single option's resolved {featureId,count} list is "one of each" of
// EVERY OTHER option's own distinct attack types (e.g. "two Branch attacks,
// two Radiant Pellet attacks, or one of each") — rendering that expansion
// word-for-word loses the much more natural "one of each" phrasing.
// Detected here at render time so the stored shape stays the same simple
// `{featureId,count}[]` every option already uses.
function isOneOfEachOption(resolved, groups, index) {
  if (!resolved.every((entry) => entry.count === 1)) return false;
  const otherFeatureIds = new Set();
  groups.forEach((group, otherIndex) => {
    if (otherIndex === index) return;
    (group || []).forEach((attack) => otherFeatureIds.add(attack.featureId));
  });
  if (!otherFeatureIds.size) return false;
  const resolvedIds = new Set(resolved.map((entry) => entry.featureId));
  if (resolvedIds.size !== otherFeatureIds.size) return false;
  for (const id of resolvedIds) {
    if (!otherFeatureIds.has(id)) return false;
  }
  return true;
}

// Same AND-combination resolution as describeSingleAttackSentence above, but
// as a bare fragment (no "The creature makes ..." lead-in) — meant to be
// embedded as one clause of a larger "X, Y, or Z" sentence. Only reached for
// a genuine choice (2+ options). Items join with "and" rather than a comma
// so a 3+-option Multiattack never reads ambiguously about where one option
// ends and the next begins.
function describeAttackCombination(attacks, groups, index) {
  if (!Array.isArray(attacks) || !attacks.length) return null;
  const resolved = [];
  for (const attack of attacks) {
    const referenced = findById(features, attack.featureId);
    if (!referenced) return null;
    resolved.push({ featureId: attack.featureId, name: referenced.name, count: attack.count });
  }
  if (isOneOfEachOption(resolved, groups, index)) return "one of each";
  const parts = resolved.map(({ name, count }) => `${COUNT_WORDS[count] || count} ${name} attack${count === 1 ? "" : "s"}`);
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// Extends describeSingleAttackSentence to a genuine CHOICE ("two Branch
// attacks, two Radiant Pellet attacks, or one of each"). A single option
// renders exactly as describeSingleAttackSentence; 2+ options join each
// fragment with an Oxford-comma-style list, even for exactly 2 (so "X, or
// Y" reads consistently). Never attempts DPR math across options — the
// goal is correct representation of the choice, not combat math.
function multiattackDescriptionText(feature, record) {
  const params = record?.featureParams?.[feature?.id];
  const fallback = params?.text || feature?.mechanics?.text || feature?.description || "";
  const groups = multiattackOptionGroups(params);
  if (!groups.length) return fallback;
  if (groups.length === 1) return describeSingleAttackSentence(groups[0]) || fallback;
  const fragments = groups.map((attacks, index) => describeAttackCombination(attacks, groups, index));
  if (fragments.some((fragment) => fragment == null)) return fallback;
  const joined = `${fragments.slice(0, -1).join(", ")}, or ${fragments[fragments.length - 1]}`;
  return `The creature makes ${joined}.`;
}

// A signed "+N"/"-N" fragment for embedding a bare ability modifier inside a
// dice-expression display string (literal mode never needs this — its
// `damageDice` already has the modifier baked in as text).
function formatDiceModifier(modifier) {
  if (!modifier) return "";
  return modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`;
}

// A shared weapon-attack Feature carries no numbers of its own; this
// monster's OWN copy's numbers live in record.featureParams instead —
// computed into the same sentence shape 5e's own stat blocks use. Falls
// back to the Feature's own generic description if there's no
// featureParams entry (defensive; shouldn't happen in practice).
//
// Two param shapes: LITERAL (`attackBonus`/`damageDice` already have this
// monster's own numbers baked in) and FORMULA (detected by `ability` —
// `damageDice` is a bare base die, and the attack bonus/damage modifier are
// computed live from this monster's own ability score + proficiency bonus).
// Formula mode is what makes a shared weapon-attack Feature genuinely
// reusable by a new native-generated monster.
//
// A rider clause tacked onto an otherwise-normal computed attack (a charge
// bonus, "plus N acid damage", "or be knocked prone") — per-monster data
// layered on a shared template's computed sentence, not a feature-level
// menu. Rider dice are always literal/flat, never formula-computed,
// regardless of whether the base attack itself is literal or formula mode.
function riderClauseText(rider) {
  if (!rider?.kind) return "";
  if (rider.kind === "secondary-damage") {
    const avg = averageDiceRoll(rider.dice, derivedFormulas);
    if (avg == null) return "";
    return ` plus ${avg} (${rider.dice}) ${rider.damageType} damage.`;
  }
  if (rider.kind === "save-or-condition") {
    if (!rider.saveAbility || !rider.saveDC || !rider.condition) return "";
    const duration = rider.duration ? ` for ${rider.duration}` : "";
    const savingAbility = rider.saveAbility.charAt(0).toUpperCase() + rider.saveAbility.slice(1);
    // `targetRestriction` overrides the default "a creature" wording for
    // cases that aren't unconditional (e.g. "If the target is a humanoid").
    const article = /^[aeiou]/i.test(rider.targetRestriction || "creature") ? "an" : "a";
    return ` If the target is ${article} ${rider.targetRestriction || "creature"}, it must succeed on a DC ${rider.saveDC} ${savingAbility} saving throw or be ${rider.condition}${duration}.`;
  }
  // A save-based rider that deals bonus damage on a failed save (half on
  // success) instead of a condition — the same shape
  // saveEffectDescriptionText's own base sentence uses, riding on a
  // single-target weapon attack instead of an area effect.
  if (rider.kind === "save-or-damage") {
    if (!rider.saveAbility || !rider.saveDC || !rider.dice || !rider.damageType) return "";
    const avg = averageDiceRoll(rider.dice, derivedFormulas);
    if (avg == null) return "";
    const savingAbility = rider.saveAbility.charAt(0).toUpperCase() + rider.saveAbility.slice(1);
    const trailingNote = rider.trailingNote ? ` ${rider.trailingNote}` : "";
    return ` The target must make a DC ${rider.saveDC} ${savingAbility} saving throw, taking ${avg} (${rider.dice}) ${rider.damageType} damage on a failed save, or half as much damage on a successful one.${trailingNote}`;
  }
  if (rider.kind === "charge-bonus") {
    const avg = averageDiceRoll(rider.dice, derivedFormulas);
    if (avg == null || !rider.triggerDistance) return "";
    return ` If the creature moved ${rider.triggerDistance}+ feet straight toward the target immediately before the hit, the target takes an extra ${avg} (${rider.dice}) ${rider.damageType} damage.`;
  }
  // A secondary damage bonus whose TYPE isn't a literal fixed value —
  // "damage of the type to which the creature has resistance" — never
  // baked in as a literal `damageType` the way `secondary-damage` is.
  if (rider.kind === "resistance-type-damage") {
    const avg = averageDiceRoll(rider.dice, derivedFormulas);
    if (avg == null) return "";
    return ` plus ${avg} (${rider.dice}) damage of the type to which the creature has resistance.`;
  }
  // An unconditional on-hit effect, no saving throw — doesn't fit
  // save-or-condition or either damage-only kind. Fixed/non-scaling
  // wording; `condition` carries the whole trailing clause.
  if (rider.kind === "condition-no-save") {
    if (!rider.condition) return "";
    return ` If the target is a creature, it ${rider.condition}.`;
  }
  return "";
}

// The 5e Versatile weapon property ("or N2 (dice2) TYPE damage if used with
// two hands") — an alternate damage VALUE for the same hit, not a
// conditional extra effect, so it's its own field rather than a 5th rider
// kind: it inserts INTO the base "Hit: ..." sentence (before the period),
// and can coexist with a real rider. Same literal-vs-formula duality as the
// base attack, using the SAME ability score/modifier as primary damage.
function versatileClauseText(params, record) {
  if (!params.versatile?.damageDice) return "";
  let avg;
  let dice;
  if (params.ability) {
    const abilityScore = record.stats?.abilities?.[params.ability];
    if (abilityScore == null) return "";
    avg = computeAverageDamage(params.versatile.damageDice, abilityScore, derivedFormulas);
    dice = `${params.versatile.damageDice}${formatDiceModifier(abilityModifier(abilityScore, derivedFormulas))}`;
  } else {
    avg = averageDiceRoll(params.versatile.damageDice, derivedFormulas);
    dice = params.versatile.damageDice;
  }
  if (avg == null) return "";
  return `, or ${avg} (${dice}) ${params.damageType} damage if used with two hands`;
}

// `kind: "MeleeOrRanged"` (a finesse/thrown weapon usable either way) carries
// BOTH `meleeDistance`/`rangeDistance` instead of the classic single
// `distanceLabel`/`distance` pair, so it needs its own clause text.
function distanceClauseText(params) {
  if (params.kind === "MeleeOrRanged") {
    return `reach ${params.meleeDistance} ft. or range ${params.rangeDistance} ft.`;
  }
  return `${params.distanceLabel} ${params.distance} ft.`;
}

function weaponAttackDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const fallback = feature?.description || "";
  if (!params) return fallback;
  const rider = riderClauseText(params.rider);
  const versatile = versatileClauseText(params, record);
  const distanceClause = distanceClauseText(params);
  const attackLead = params.kind === "MeleeOrRanged" ? "Melee or Ranged" : params.kind;
  if (params.ability) {
    const abilityScore = record.stats?.abilities?.[params.ability];
    const proficiencyBonus = record.stats?.proficiencyBonus;
    if (abilityScore == null || proficiencyBonus == null) return fallback;
    const attackBonus = computeAttackBonus(abilityScore, proficiencyBonus, derivedFormulas);
    const avg = computeAverageDamage(params.damageDice, abilityScore, derivedFormulas);
    if (avg == null) return fallback;
    const modifier = abilityModifier(abilityScore, derivedFormulas);
    return `${attackLead} ${params.attackKind} Attack: +${attackBonus} to hit, ${distanceClause}, one target. Hit: ${avg} (${params.damageDice}${formatDiceModifier(modifier)}) ${params.damageType} damage${versatile}.${rider}`;
  }
  const avg = averageDiceRoll(params.damageDice, derivedFormulas);
  if (avg == null) return fallback;
  // A bare flat damageDice ("1", no "d") — real 5e source text omits the
  // dice parenthetical entirely when the average is 1, so it's dropped here
  // whenever there's no real dice notation to show.
  const diceNote = /\d+d\d+/i.test(params.damageDice) ? ` (${params.damageDice})` : "";
  return `${attackLead} ${params.attackKind} Attack: +${params.attackBonus} to hit, ${distanceClause}, one target. Hit: ${avg}${diceNote} ${params.damageType} damage${versatile}.${rider}`;
}

// weaponAttackDescriptionText's sibling for `mechanics.type ===
// "save-effect"` (a breath weapon, almost always). Unlike weapon-attack,
// the damage dice are NEVER formula-computed — a breath weapon's damage
// scales with size/age category, not an ability modifier — only the DC is:
// `params.dcAbility` (defaulted to Constitution) drives computeSaveDC
// against this monster's own score. `params.ability` (always literal) is
// the TARGET's own saving-throw ability.
// `params.rider` mirrors the weapon-attack rider concept, with two kinds:
// - `fail-condition`: outcome is more than "damage, or half damage" (a
//   push, a stun) — REPLACES the base sentence's damage clause entirely.
// - `trailing-note`: a narrative addendum tacked on AFTER the normal
//   damage/save sentence, which stays intact.
function saveEffectDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const fallback = feature?.description || "";
  if (!params) return fallback;
  const dcAbilityScore = record.stats?.abilities?.[params.dcAbility];
  const proficiencyBonus = record.stats?.proficiencyBonus;
  if (dcAbilityScore == null || proficiencyBonus == null) return fallback;
  const dc = computeSaveDC(dcAbilityScore, proficiencyBonus, derivedFormulas);
  const width = params.lineWidth ? ` that is ${params.lineWidth} feet wide` : "";
  const savingAbility = params.ability.charAt(0).toUpperCase() + params.ability.slice(1);
  // 5e's own convention: the back-reference always says "that line" for a
  // line, but "that area" (never "that cone"/"that sphere") otherwise.
  const areaBackref = params.areaShape === "line" ? "line" : "area";
  const lead = `The creature ${params.verb} ${params.substance} in a ${params.areaSize}-foot ${params.areaShape}${width}.`;
  if (params.rider?.kind === "fail-condition" && params.rider.conditionText) {
    return `${lead} Each creature in that ${areaBackref} must make a DC ${dc} ${savingAbility} saving throw. ${params.rider.conditionText}`;
  }
  const avg = averageDiceRoll(params.damageDice, derivedFormulas);
  if (avg == null) return fallback;
  const base =
    `${lead} Each creature in that ${areaBackref} must make a DC ${dc} ${savingAbility} saving throw, taking ${avg} ` +
    `(${params.damageDice}) ${params.damageType} damage on a failed save, or half as much damage on a successful one.`;
  return params.rider?.kind === "trailing-note" && params.rider.conditionText ? `${base} ${params.rider.conditionText}` : base;
}

// Feature-level "menu of named sub-effects" (feature.options — an ability
// with several named alternatives). Deliberately NOT Tiers: every option
// always belongs to the ability at once (no single pick) — how resolution
// happens (random roll, fixed, per-turn choice) is flavor text, not
// something the data model distinguishes.
// Builds the base description plus an indented, bold-headed bulleted list
// as a real DOM structure — a plain `.textContent` string with embedded
// "\n"s renders as one unbroken run-on paragraph without `white-space: pre-line`.
function renderFeatureOptionsDescription(container, feature) {
  container.textContent = feature.description || "";
  if (!Array.isArray(feature.options) || !feature.options.length) return;
  const list = document.createElement("ul");
  list.className = "mb-0 ps-3";
  feature.options.forEach((option) => {
    const item = document.createElement("li");
    if (option?.name) {
      const strong = document.createElement("strong");
      strong.textContent = `${option.name}. `;
      item.appendChild(strong);
    }
    item.appendChild(document.createTextNode(option?.mechanics?.text || ""));
    list.appendChild(item);
  });
  container.appendChild(list);
}

// `mechanics.type === "legendary-action-reference"` — a legendary action
// that just re-invokes another already-defined ability by name, rather than
// carrying its own mechanical effect. `referencedFeatureIds` keeps the
// referenced ability's NAME in sync automatically if it's ever renamed.
// Two or more ids join with "or"; `{names}` in `template` is replaced with
// that joined list.
function legendaryActionReferenceDescriptionText(feature) {
  const ref = feature?.legendaryActionReference;
  if (!ref?.referencedFeatureIds?.length) return feature?.description || "";
  const names = ref.referencedFeatureIds.map((id) => findById(features, id)?.name || id).join(" or ");
  return (ref.template || "The creature uses its {names} ability.").replace("{names}", names);
}

function renderFeatureList(record) {
  if (!elements.featureList) return;
  // Disposed before the wipe — each row's Remove button carries a real
  // tooltip, and this reruns on every feature add/remove.
  disposeTooltips(elements.featureList);
  elements.featureList.innerHTML = "";
  // NOT isImportedStatBlock — that's a provenance question, stays true
  // forever once true. This asks whether the record's raw stat-block
  // content has been converted into real Feature references yet —
  // `featureIds` is the right signal regardless of provenance, since
  // feature-matching runs automatically on every save now.
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
  // Same row shape as Vault's own renderFeatureList (info + Remove button),
  // minus Vault's cost/refund badge (its own budget-economy concept). A
  // feature with real combat mechanics gets its attackBonus/damageDice line
  // shown right here instead of a second, numbers-only entry under Stats.
  const actions = record.stats?.actions || [];
  const matchedActionNames = new Set();
  record.featureIds.forEach((featureId) => {
    const feature = findById(features, featureId);
    // Which of a shared tiered Feature's own tiers (e.g. Legendary
    // Resistance's 1/3/4/5-per-day variants) THIS monster's copy uses.
    // Absent entirely for a non-tiered Feature.
    const tier = feature?.tiers?.find((entry) => entry.id === record.featureTiers?.[featureId]);
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
    // Hover-preview chip — resolves against the same Feature record
    // regardless of which tier's name is shown here.
    header.appendChild(
      createReferenceChip({ kind: "feature", id: featureId, name: tier?.name || feature?.name || featureId, dataManager })
    );
    if (isSignature) {
      const badge = document.createElement("span");
      badge.className = "badge text-bg-primary";
      badge.textContent = "Signature";
      header.appendChild(badge);
    }

    const description = document.createElement("div");
    description.className = "small text-body-secondary";
    if (!tier && Array.isArray(feature?.options) && feature.options.length) {
      renderFeatureOptionsDescription(description, feature);
    } else {
      let descriptionText = tier?.mechanics?.text;
      if (!descriptionText) {
        if (feature?.mechanics?.type === "multiattack") descriptionText = multiattackDescriptionText(feature, record);
        else if (feature?.mechanics?.type === "weapon-attack") descriptionText = weaponAttackDescriptionText(feature, record);
        else if (feature?.mechanics?.type === "save-effect") descriptionText = saveEffectDescriptionText(feature, record);
        else if (feature?.mechanics?.type === "legendary-action-reference") descriptionText = legendaryActionReferenceDescriptionText(feature);
        else descriptionText = feature?.description || "";
      }
      description.textContent = descriptionText;
    }

    info.append(header, description);

    if (action) {
      const mechanics = document.createElement("div");
      mechanics.className = "small fw-semibold";
      mechanics.textContent = actionDetailsText(action);
      info.appendChild(mechanics);
    }

    const side = document.createElement("div");
    side.className = "d-flex align-items-center gap-2 flex-shrink-0";

    // Muted pill, not badge text-bg-primary like Signature — the two never
    // compete for attention in the same row. Absent for a trait (passive,
    // not action-economy-costed).
    const actionCost = feature?.combat?.actionCost;
    if (actionCost && ACTION_COST_LABELS[actionCost]) {
      const costBadge = document.createElement("span");
      costBadge.className = "badge rounded-pill crucible-action-cost-pill";
      costBadge.textContent = ACTION_COST_LABELS[actionCost];
      side.appendChild(costBadge);
    }

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
    side.appendChild(removeButton);

    row.append(info, side);
    row.addEventListener("click", () => selectFeatureRow(featureId));
    elements.featureList.appendChild(row);
  });

  // buildActions falls back to one generic "Attack"/"Multiattack" entry
  // when nothing selected is combat-tagged, with no matching Feature — a
  // plain, non-removable row here keeps it visible instead of dropped.
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
  refreshTooltips(elements.featureList);
}

// A blank first option so the select doesn't silently read as "the
// alphabetically-first feature is already chosen" once populated.
function createPlaceholderOption(label = "Select…") {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  return option;
}

// Every compatible Feature not already on this Monster. Only meaningful for
// a native Crucible record; an imported stat block has no `features`
// reference pool to add from.
function populateAddFeatureSelect() {
  if (!elements.addFeatureSelect) return;
  // Same "featureIds presence, not provenance" reasoning as
  // renderFeatureList above.
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
// Target/Spent/Remaining display. An imported stat block has no budget
// concept, so the whole summary stays hidden rather than showing zeroes.
function renderFeatureBudget(record) {
  const budget = record && !isImportedStatBlock(record) ? record.stats?.budget : null;
  // Not `.hidden = !budget` — data-budget-summary carries Bootstrap's
  // author-origin `.d-flex`, which beats the `[hidden]` UA rule regardless
  // of the `hidden` property. setElementVisible forces `display` inline instead.
  if (elements.budgetSummary) setElementVisible(elements.budgetSummary, Boolean(budget), "flex");
  if (!budget) return;
  if (elements.budgetTarget) elements.budgetTarget.textContent = String(budget.target);
  if (elements.budgetSpent) elements.budgetSpent.textContent = String(budget.spent);
  if (elements.budgetRemaining) {
    elements.budgetRemaining.textContent = String(budget.remaining);
    elements.budgetRemaining.classList.toggle("crucible-budget-over", budget.remaining < 0);
  }
}

// Re-derives spent/remaining from whatever's currently selected, so manual
// add/remove and the original generation can never disagree about the
// running total. Target doesn't change here — it comes from the resolved
// Combat Scaling level at generation time, not feature selection.
function recomputeMonsterBudget(record) {
  if (!record?.stats?.budget) return null;
  const target = record.stats.budget.target;
  const spent = (record.featureIds || []).reduce((sum, featureId) => sum + Number(findById(features, featureId)?.budgetCost ?? 0), 0);
  record.stats.budget = { target, spent, remaining: target - spent };
  return record.stats.budget;
}

// Manual add/remove mutate featureIds directly — deliberately NOT re-running
// recipe-slot matching (recipeFulfillment keeps showing whatever generation
// originally resolved).
function removeFeature(featureId) {
  if (!currentRecord || !Array.isArray(currentRecord.featureIds)) return;
  const feature = findById(features, featureId);
  recordHistory(`remove ${feature?.name || "feature"}`, () => {
    currentRecord.featureIds = currentRecord.featureIds.filter((id) => id !== featureId);
    if (currentRecord.signatureFeatureId === featureId) currentRecord.signatureFeatureId = null;
  });
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
  const feature = findById(features, featureId);
  recordHistory(`add ${feature?.name || "feature"}`, () => {
    if (!currentRecord.featureIds.includes(featureId)) currentRecord.featureIds.push(featureId);
  });
  dirtyGate.markDirty();
  recomputeMonsterBudget(currentRecord);
  renderFeatureList(currentRecord);
  renderFeatureBudget(currentRecord);
  populateAddFeatureSelect();
  jsonDataPanel.render();
  updateActionButtons();
}

function renderRecipeSummary(record) {
  // No Archetype recipe concept for an imported stat block — the whole
  // card is hidden. `.d-none` toggle, not `.hidden` — Bootstrap's `.card`
  // sets an author-origin `display: flex` the `[hidden]` UA rule can't beat.
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
// fields). Wraps the shared createFieldBox — `data-editable-stat`/
// `data-editable-stat-suffix` (read by the statsFields write-back listener
// below) are preserved via dataAttr. Crucible's Stats fields are always
// editable (unlike Forge's Identity/4D, which reuse the same box read-only).
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
  const modifier = abilityModifier(score, derivedFormulas);
  return `(${modifier >= 0 ? "+" : ""}${modifier})`;
}

// Same "+N"/"-N" convention as abilityModifierText, minus the parens — used
// for Proficiency Bonus, always shown/typed with an explicit sign.
// `Number()` parses a leading "+" back out fine, so this round-trips
// through the plain-number write-back branch unchanged.
function formatSignedNumber(value) {
  if (value === "" || value === null || value === undefined) return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric >= 0 ? `+${numeric}` : String(numeric);
}

// Comma-joined for both display and editing; split back into an array on
// write-back below (statsFields' "input" listener).
function joinListValue(list) {
  return Array.isArray(list) && list.length ? list.join(", ") : "";
}

// Shared by renderStats' field list and the statsFields write-back listener
// below, so the two can't drift apart. Resistances/Immunities/
// Vulnerabilities all read/write the SAME `stats.proficiencies.defenses`
// array, filtered/tagged by `type` — this is the type each box's key maps to.
const DEFENSE_TYPE_BY_STAT_KEY = {
  damageResistances: "resistance",
  damageImmunities: "immunity",
  damageVulnerabilities: "vulnerability",
};

// stats.senses is `{passives:{perception,...}, darkvision, blindsight, ...}`
// — but Crucible's own Senses box stays a single plain-text comma list, same
// UI as every other list-shaped stat. These two functions reshape between
// the two: display excludes `passives` (Passive Perception has its own
// separate stat card); parsing re-derives each named sense from the same
// `senses` vocabulary the mapping layer's parsers use, always preserving
// whatever `passives` the record already had.
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

// stats.speed is `{walk, burrow, climb, fly, swim}`, same reshape-
// underneath approach as senses above. `walk` renders bare (no "Walk"
// prefix), matching standard 5e phrasing; every other mode is prefixed by
// its own name. `hover` (a sparse boolean) is a sibling of `fly`, not a
// numeric speed of its own — excluded from the generic loop and instead
// appended as a "(hover)" suffix on the fly segment specifically.
function formatSpeedValue(speed) {
  if (!speed || typeof speed !== "object") return "";
  return Object.entries(speed)
    .filter(([key, value]) => key !== "hover" && value)
    .map(([key, value]) => {
      const text = key === "walk" ? `${value} ft.` : `${key.charAt(0).toUpperCase()}${key.slice(1)} ${value} ft.`;
      return key === "fly" && speed.hover ? `${text} (hover)` : text;
    })
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
      const key = (match[1] || "walk").toLowerCase();
      result[key] = Number(match[2]);
      if (key === "fly" && /hover/i.test(part)) result.hover = true;
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

  // Row 1: every ability the active System defines — 6-per-row at md+, so a
  // standard 6-ability System fills exactly one row.
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

  // Row 2: Challenge, AC, Current HP, Max HP, Hit Dice, Proficiency — 6 × 2
  // = 12 columns, filling the row exactly. Save DC moved to Row 6, next to
  // Spells, since it's a Crucible-native generation concept, not real
  // per-monster import data the way Proficiency is.
  //
  // The Hit Dice card shows stats.hitPoints.diceString (the full roll
  // formula) in place of the bare stats.hitDice whenever a source provided
  // it — one card, not two. Editing writes back to whichever is shown.
  const hitDiceValue = hitPoints.diceString || stats.hitDice || "";
  const hitDiceKey = hitPoints.diceString ? "hitPointsDiceString" : "hitDice";
  [
    ["challengeRating", "Challenge", stats.challengeRating ?? ""],
    ["armorClass", "Armor Class", stats.armorClass ?? ""],
    ["currentHp", "Current HP", hitPoints.current ?? hitPoints.max ?? ""],
    ["maxHp", "Max HP", hitPoints.max ?? ""],
    [hitDiceKey, "Hit Dice", hitDiceValue],
    ["proficiencyBonus", "Proficiency Bonus", formatSignedNumber(stats.proficiencyBonus)],
  ].forEach(([key, label, value]) => {
    elements.statsFields.appendChild(buildStatCard({ key, label, value }));
  });

  // Row 3: Passive Perception, Speed, Size, Alignment (col-md-2 each);
  // Languages (col-md-4, tends to hold more text). No "Type" here —
  // Identity's own Creature Type select is the single home for that fact
  // now, so a second copy down here was just a duplicate.
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

  // Row 4: Resistances, Immunities, Vulnerabilities (col-md-4 each). Always
  // rendered, even empty, now that they're editable — a blank field is how
  // a GM adds one that wasn't rolled.
  //
  // All three read from the single unified `stats.proficiencies.defenses`
  // array, filtered by `type`. Immunities also includes condition
  // immunities (a condition immunity is just `type: "immunity"` too).
  // Editing a box re-splits ONLY that type's entries and merges with the
  // other two types' untouched entries — this loses any `condition`/`value`
  // sub-fields on edited entries, same lossiness as any other list field here.
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

  // Row 5: Senses, Saving Throws, Skills (col-md-4 each). Saving Throws/
  // Skills come off an import as `[{name, value}]`; feature-matching
  // already flattens both to a plain "Con +5, Wis +3" string during
  // conversion — this just displays/edits that string directly.
  [
    ["senses", "Senses", formatSensesValue(stats.senses)],
    ["savingThrows", "Saving Throws", stats.savingThrows ?? ""],
    ["skills", "Skills", stats.skills ?? ""],
  ].forEach(([key, label, value]) => {
    elements.statsFields.appendChild(buildStatCard({ key, label, value, colClass: "col-8 col-md-4" }));
  });

  // Row 6: Save DC, Spells — Save DC lives here, not with the "real"
  // imported stats in Row 2, because it isn't actually one: it's a
  // Crucible-native generation value, no import mapping populates it (real
  // D&D monsters have several save DCs, one per ability, embedded in text).
  // It's an optional manual GM note, positioned next to Spells since that's
  // the stat it's most often about. Spells gets a 3-row textarea (not a
  // single-line input) since it's far longer than any other stat here.
  elements.statsFields.appendChild(buildStatCard({ key: "saveDC", label: "Save DC", value: stats.saveDC ?? "", colClass: "col-3 col-md-2" }));
  elements.statsFields.appendChild(
    buildStatCard({
      key: "spells",
      label: "Spells",
      value: stats.spells ?? "",
      compact: false,
      colClass: "col-9 col-md-10",
      type: "textarea",
      rows: 3,
    })
  );

  // Actions and the Feature budget both moved out of Stats — see
  // renderFeatureList/renderFeatureBudget. A Crucible-generated action
  // shares its name with the Feature it came from, so it renders inline on
  // that Feature's own row instead of a second entry down here.
}

// What Save/Export would actually write right now — currentRecord.name/
// .notes only get synced from their input fields inside handleSave/
// handleExport, so a live dirty-check needs this instead of reading
// currentRecord directly.
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
  if (elements.duplicateButton) elements.duplicateButton.disabled = !hasRecord;
  // Not saved-gated like Delete — a freshly generated, not-yet-saved
  // Monster can convert too. Does need a System to filter the Template picker.
  if (elements.convertToCharacterButton) {
    setDisabledTooltip(
      elements.convertToCharacterButton,
      !hasRecord
        ? "Generate or select a Monster first."
        : !Array.isArray(currentRecord.systemIds) || !currentRecord.systemIds.length
          ? "Assign a System to this Monster before converting."
          : ""
    );
  }
}

// One button, not a two-way radio group — clicking it steps to the OTHER
// mode each time. Icon/label always describe what clicking will switch TO,
// not the current state. Defaults to "view" — Notes are read far more often
// than edited.
let notesMode = "view";

function renderNotesPreview() {
  if (!elements.notesPreview) return;
  // Disposed before the wipe — a date/wiki-link reference inside Notes
  // carries a real tooltip, and this reruns on every edit.
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
  // switches TO, not the current state) and vice versa.
  elements.notesModeEyeIcon?.classList.toggle("d-none", isView);
  elements.notesModePencilIcon?.classList.toggle("d-none", !isView);
  if (elements.notesModeLabel) elements.notesModeLabel.textContent = isView ? "Edit" : "View";
  if (elements.notesModeToggle) updateTooltipContent(elements.notesModeToggle, isView ? "Edit" : "View");
  if (isView) renderNotesPreview();
}

function renderMonster(record) {
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
  // Rebuilt each render, like Identity below — image isn't read from the
  // DOM at save time the way name/notes are; it commits straight to
  // currentRecord.image on blur/library-pick instead.
  if (elements.imageMount) {
    elements.imageMount.innerHTML = "";
    elements.imageMount.appendChild(
      createTokenImageField({
        id: "crucibleMonsterImage",
        label: "Image",
        // Matches the Name field box it sits inline beside.
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
  if (mode === "relationships") void refreshRelationshipsSection();
}

// --- Relationships -----------------------------------------------------
//
// Crucible's own target-kind whitelist and type-suggestion vocabulary for
// the shared relationship-editor.js/relationship-graph.js modules. Ecology/
// territory ties, not social ones — a Monster's suggestions read
// differently than an NPC's.
const RELATIONSHIP_TARGET_KINDS = [
  { id: "npc", label: "NPC" },
  { id: "location", label: "Location" },
  { id: "monster", label: "Monster" },
  { id: "character", label: "Character" },
];
const RELATIONSHIP_TYPE_SUGGESTIONS = [
  "Prey of",
  "Predator of",
  "Pack with",
  "Serves",
  "Shares territory with",
];

// "monster" (the Identity/Features/Stats/Notes card stack) or
// "relationships" (a full-pane List/Graph view over this Monster's own
// relationship edges) — mutually exclusive Modes, switched by the
// suite-wide Mode toggle group in the header row above the main pane.
let mode = "monster";
let relationshipsForceGraph = null;
let relationshipsIconByKind = {};

function renderModeToggle() {
  if (!elements.modeToggleMount) return;
  // Nothing to relate until a Monster exists — disabled (not hidden) until
  // then, via createModeToggleGroup's own disabled/tooltip option support.
  createModeToggleGroup({
    container: elements.modeToggleMount,
    ariaLabel: "Crucible view",
    options: [
      { value: "monster", icon: "tabler:skull", label: "Monster" },
      {
        value: "relationships",
        icon: "tabler:affiliate",
        label: "Relationships",
        disabled: !currentRecord,
        tooltip: currentRecord ? undefined : "Select or generate a Monster first",
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
  elements.monsterRelationships?.classList.toggle("d-none", !isRelationships);
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
    getNodeRadius: (node) => (node.kind === "monster" && node.id === `monster:${currentRecord?.id}` ? 20 : 14),
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
  // No Monster loaded — clear rather than leave a stale prior Monster's
  // relationships on screen.
  if (!currentRecord?.id) {
    elements.relationshipsListMount.innerHTML =
      '<p class="small text-body-secondary mb-0">Select or generate a Monster to see its relationships.</p>';
    return;
  }
  await renderRelationshipEditor({
    container: elements.relationshipsListMount,
    sourceKind: "monster",
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
      nodes: [{ kind: "monster", id: currentRecord.id, label: currentRecord.name || currentRecord.id }],
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

function readLockedFeatureIds() {
  return sharedReadLockedFeatureIds(elements.lockedFeatures);
}

async function handleGenerate() {
  // No readiness guard needed — setGenerateButtonReadiness gives the button
  // a real `disabled` attribute whenever this would fail, and a disabled
  // button's click listener never fires.
  const systemId = currentSystemId() || null;
  try {
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
      creatureType: findById(creatureTypes, generated.type),
      features: generated.featureIds.map((id) => findById(features, id)).filter(Boolean),
      dataManager,
      abilityFieldDefs,
      abilityFieldKey,
      combatBindings,
      derivedFormulas,
    });
    const record = createMonsterRecord({ ...generated, stats });
    dirtyGate.markDirty();
    // Freshly generated content is always unsaved, regardless of whichever
    // saved Monster the picker previously pointed at.
    currentMonsterId = null;
    if (elements.monsterSelect) elements.monsterSelect.value = "";
    updateGenerationFieldsVisibility();
    recordHistory("generate monster", () => renderMonster(record));
    expandMonsterPropertiesSection();
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
    // Every monster save gets its remaining raw stat-block groups converted
    // into real Feature references, unconditionally. Loom's saveEntity
    // already does this for imports made through Loom; Crucible's own save
    // bypasses saveEntity entirely, so it needs the same call directly.
    // Idempotent — a safe no-op once nothing's left to convert.
    let conversionErrors = [];
    if (hasConvertibleStatBlock(currentRecord.stats)) {
      const conversionResult = await convertStatBlockToFeatures(currentRecord, {
        dataManager,
        existingFeatures: features,
        monsterSlug: currentRecord.id,
      });
      conversionErrors = conversionResult?.errors || [];
    }
    // Default mode ("auto"): an anonymous GM saves locally to their own
    // browser, a signed-in user gets a real owned/shareable record.
    const exported = toPressExportShape(currentRecord);
    await dataManager.save("monster", currentRecord.id, exported);
    dirtyGate.markClean(exported);
    currentMonsterId = currentRecord.id;
    // A monster still saves fine with one or more traits skipped — surfaced
    // here rather than staying silent, since that's real information loss
    // a GM would otherwise discover much later, or never.
    if (conversionErrors.length) {
      status?.show(
        `Saved, but ${conversionErrors.length} feature${conversionErrors.length === 1 ? "" : "s"} couldn't be converted (see console).`,
        { type: "warning", timeout: 6000 }
      );
    } else {
      status?.show("Saved.", { type: "success", timeout: 1500 });
    }
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

function generateMonsterId() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `mon_${suffix}`;
}

function handleDuplicate() {
  if (!currentRecord) return;
  const source = buildRecordForSave();
  const duplicate = { ...source, id: generateMonsterId(), name: `${source.name || "Monster"} Copy` };
  dirtyGate.markDirty();
  currentMonsterId = null;
  if (elements.monsterSelect) elements.monsterSelect.value = "";
  renderMonster(duplicate);
  expandMonsterPropertiesSection();
  status?.show("Duplicated — not yet saved.", { type: "info", timeout: 2000 });
}

// --- Convert to Character -------------------------------------------------
// Mirrors forge/js/app.js's own identical block. Kept in sync between the
// two files rather than factored out, since each tool's own
// `elements`/`currentRecord` plumbing differs enough that a shared version
// would need its own adapter layer for little real savings.
function generateCharacterId(name) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `cha_${crypto.randomUUID()}`;
  }
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `cha_${slug || "character"}_${rand}`;
}

let convertToCharacterModalInstance = null;

async function loadConvertTemplateOptions(systemIds) {
  const entries = await fetchKindEntriesWithIds(dataManager, "template").catch(() => []);
  return entries
    .filter(({ entity }) => entity?.schema && systemIds.includes(entity.schema))
    .map(({ id, entity }) => ({ id, title: entity.title || id, schema: entity.schema }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

function updateConvertSubmitReadiness() {
  if (!elements.convertCharacterSubmitButton) return;
  const hasTemplate = Boolean(elements.convertCharacterTemplateSelect?.value);
  const hasName = Boolean(elements.convertCharacterNameInput?.value.trim());
  elements.convertCharacterSubmitButton.disabled = !hasTemplate || !hasName;
}

async function openConvertToCharacterModal() {
  if (!currentRecord || !Array.isArray(currentRecord.systemIds) || !currentRecord.systemIds.length) return;
  const source = buildRecordForSave();
  if (elements.convertCharacterForm) elements.convertCharacterForm.classList.remove("was-validated");
  if (elements.convertCharacterNameInput) elements.convertCharacterNameInput.value = source.name || "";
  if (elements.convertCharacterTemplateSelect) {
    elements.convertCharacterTemplateSelect.innerHTML = "";
    const loading = document.createElement("option");
    loading.value = "";
    loading.textContent = "Loading…";
    elements.convertCharacterTemplateSelect.appendChild(loading);
  }
  updateConvertSubmitReadiness();
  const bsModal =
    elements.convertToCharacterModalEl && window.bootstrap && typeof window.bootstrap.Modal === "function"
      ? window.bootstrap.Modal.getOrCreateInstance(elements.convertToCharacterModalEl)
      : null;
  convertToCharacterModalInstance = bsModal;
  bsModal?.show();

  const options = await loadConvertTemplateOptions(currentRecord.systemIds);
  if (!elements.convertCharacterTemplateSelect) return;
  elements.convertCharacterTemplateSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = options.length ? "Select a template…" : "No templates available for this System";
  elements.convertCharacterTemplateSelect.appendChild(blank);
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.id;
    opt.dataset.schema = option.schema;
    opt.textContent = option.title;
    elements.convertCharacterTemplateSelect.appendChild(opt);
  });
  updateConvertSubmitReadiness();
}

elements.convertToCharacterButton?.addEventListener("click", () => void openConvertToCharacterModal());
elements.convertCharacterNameInput?.addEventListener("input", updateConvertSubmitReadiness);
elements.convertCharacterTemplateSelect?.addEventListener("change", updateConvertSubmitReadiness);

elements.convertCharacterForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentRecord) return;
  const name = elements.convertCharacterNameInput?.value.trim() || "";
  const templateId = elements.convertCharacterTemplateSelect?.value || "";
  const selectedOption = elements.convertCharacterTemplateSelect?.selectedOptions?.[0];
  const templateSchema = selectedOption?.dataset.schema || "";
  if (!name || !templateId) {
    elements.convertCharacterForm.classList.add("was-validated");
    return;
  }
  const id = generateCharacterId(name);
  const converted = convertLibraryRecord(buildRecordForSave(), {
    fromKind: "monster",
    toKind: "character",
    systemId: templateSchema,
    templateId,
    name,
  });
  const [abilityDefs, skillValues, derivedFormulas] = await Promise.all([
    loadAbilityFieldDefs(dataManager, templateSchema),
    loadArrayFieldValues(dataManager, templateSchema, "skills"),
    loadArrayFieldValues(dataManager, templateSchema, "derivedFormulas"),
  ]);
  const payload = seedCharacterDefaults(converted, { abilityDefs, skillDefs: skillValues, derivedFormulas });
  try {
    await dataManager.save("characters", id, payload);
  } catch (error) {
    status?.show(error?.message || "Unable to create the character.", { type: "error" });
    return;
  }
  // The Monster itself was never saved (only converted-and-saved as a
  // Character) — without this, beforeunload's dirty check still sees it as
  // unsaved and throws up a prompt on the next line's navigation.
  dirtyGate.markClean();
  convertToCharacterModalInstance?.hide();
  status?.show(`Converted to ${name}.`, { type: "success", timeout: 2000 });
  const href = buildKindToolUrl("character", id);
  if (href) window.location.href = href;
});

async function handleGenerateNote() {
  const before = currentRecord ? recordSnapshot() : null;
  const success = await generateNoteForRecord({
    record: currentRecord,
    elements,
    status,
    generateNote: generateMonsterNote,
    // Leave name blank rather than falling back to record.id — an id like
    // "mon_abc123" would look like a real name to the server and stop it
    // from suggesting one.
    buildRequestBody: (record) => {
      const imported = isImportedStatBlock(record);
      // Archetype/Role/Signature Feature are native-generation-only —
      // imported records never have these. `features` uses featureIds
      // whenever populated regardless of provenance (feature-matching runs
      // on every save), so a converted import's real Feature references are
      // sent; only a not-yet-converted record falls back to raw groups.
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
    namespace: "crucible",
    storagePrefix: "undercroft.crucible.undo",
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

  // Generate starts disabled — recomputed once reloadReferenceData
  // resolves. Proactively disables (with an explanatory tooltip) instead of
  // unconditionally enabling — getMonsterGenerationBlockReason mirrors
  // generateMonster's own eligibility check exactly, so this can't drift
  // out of sync with what actually happens on click.
  function updateGenerateButtonReadiness() {
    const reason = getMonsterGenerationBlockReason(creatureTypes, archetypes, roles, { systemId: currentSystemId() });
    setGenerateButtonReadiness(elements.generateButton, reason);
  }

  // Same dirty check updateActionButtons uses for the Save button.
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
  elements.multiattackAddOptionButton?.addEventListener("click", addMultiattackOption);
  // Named (not an inline listener) so the init flow below can also call
  // this directly when auto-selecting the active campaign group's System.
  async function handleSystemSelectChange() {
    markRequiredControl(elements.systemSelect, Boolean(elements.systemSelect.value));
    // A different System means any previously loaded Monster (and the
    // reference data it was built from) is no longer relevant.
    currentMonsterId = null;
    renderMonster(null);
    await reloadReferenceData();
    updateGenerateButtonReadiness();
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
      const result = await dataManager.get("monster", id, { preferLocal: false });
      if (!result?.payload) {
        status?.show("Unable to load that monster.", { type: "error", timeout: 4000 });
        return;
      }
      // Not createMonsterRecord — that always stamps a fresh id/createdAt,
      // right for a NEW generation but would rewrite an existing record's
      // real creation time on every load.
      renderMonster({ ...result.payload, id });
      dirtyGate.markClean(toPressExportShape(currentRecord));
      expandMonsterPropertiesSection();
      updateActionButtons();
    } catch (error) {
      status?.show(`Unable to load monster: ${error.message}`, { type: "error", timeout: 4000 });
    }
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
    scheduleFieldCommit(`edit ${key}`);
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
    } else if (key === "hitPointsDiceString") {
      currentRecord = { ...currentRecord, stats: { ...stats, hitPoints: { ...(stats.hitPoints || {}), diceString: input.value } } };
    } else if (key === "armorClass" || key === "saveDC" || key === "proficiencyBonus") {
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
      // types' entries untouched — loses any condition/value sub-fields on
      // entries in the EDITED type, same lossiness as any other list field here.
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
  elements.statsFields?.addEventListener("keydown", flushFieldCommitOnUndoRedo);
  elements.statsFields?.addEventListener("change", () => commitFieldEdit());

  // Per-field reroll button (createFieldBox's `rerollable` option). Only
  // wired for the non-imported branch's select boxes, so no
  // isImportedStatBlock guard is needed here.
  elements.identityFields?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll-attribute]");
    if (!button || !currentRecord) return;
    const attribute = button.dataset.rerollAttribute;
    recordHistory(`reroll ${attribute}`, () => {
      renderMonster(rerollAttribute(currentRecord, { creatureTypes, archetypes, roles, features }, currentSystemId(), attribute));
    });
  });

  // Picking a Creature Type/Archetype/Role keeps currentRecord in sync —
  // "change" (not "input") since these are all selects, none needing
  // Stats' own live per-keystroke recompute.
  elements.identityFields?.addEventListener("change", (event) => {
    const target = event.target.closest("[data-editable-identity]");
    if (!target || !currentRecord) return;
    const key = target.dataset.editableIdentity;
    recordHistory(`edit ${key}`, () => {
      currentRecord = { ...currentRecord, [key]: target.value || null };
    });
    jsonDataPanel.render();
    updateActionButtons();
  });

  document.querySelector("[data-json-mount]")?.appendChild(jsonDataPanel.section);

  // `?monster=<id>` — a cross-tool deep link (Repository's kind-reference
  // chips route here). A bulk-imported bestiary entry may carry no
  // systemIds, in which case the System cascade below is skipped and
  // reloadReferenceData's own default System list is trusted to include it.
  // Two-phase, not one straight-line await chain — Phase 1 (awaited): render
  // THIS monster directly, fast. Phase 2 (fired but not awaited): the System
  // reference-data reload populates monsterSelect's option list, so the
  // full reload doesn't block showing the linked record first.
  async function applyDeepLinkParams() {
    const params = new URLSearchParams(window.location.search);
    const monsterId = params.get("monster");
    if (!monsterId) return false;
    try {
      const result = await dataManager.get("monster", monsterId, { preferLocal: false });
      const payload = result?.payload || {};
      const targetSystemId = payload.systemIds?.[0] || null;
      // Phase 1 — the monster itself, on screen as fast as one fetch allows.
      currentMonsterId = monsterId;
      updateGenerationFieldsVisibility();
      renderMonster({ ...payload, id: monsterId });
      dirtyGate.markClean(toPressExportShape(currentRecord));
      expandMonsterPropertiesSection();
      updateActionButtons();
      // Phase 2 — deliberately not awaited; runs after this function has
      // already returned `true`. NOT handleSystemSelectChange, which resets
      // currentMonsterId and calls renderMonster(null) first — that would
      // wipe the monster Phase 1 already rendered. Setting systemSelect's
      // value directly and calling reloadReferenceData straight keeps
      // Phase 1's render on screen the whole time. monsterSelect's value is
      // set without dispatching "change" since the monster is already
      // loaded and shown; re-dispatching would just re-fetch it for nothing.
      void (async () => {
        try {
          if (targetSystemId && elements.systemSelect) {
            elements.systemSelect.value = targetSystemId;
          }
          await reloadReferenceData();
          if (elements.monsterSelect) elements.monsterSelect.value = monsterId;
          updateGenerateButtonReadiness();
        } catch (error) {
          // Phase 1 already succeeded — a background failure here just
          // leaves the picker under-populated, not worth an error toast.
          // Generate stays disabled since reference data may never have loaded.
        }
      })();
      return true;
    } catch (error) {
      status?.show("Unable to open the linked record.", { type: "error", timeout: 3000 });
      return false;
    }
  }

  // If a campaign group is active and has its own System assigned, default
  // Crucible's System select to it. Falls through to the "nothing chosen
  // yet" placeholder otherwise. An explicit `?monster=` deep link always
  // wins over both.
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
    renderMonster(null);
    // Both branches above resolve reference data for whatever System ended
    // up selected — safe to recompute readiness here regardless of which one
    // ran. The deepLinked === true case updates from its own Phase 2
    // background IIFE instead, once ITS reference-data load finishes.
    updateGenerateButtonReadiness();
  }

  initHelpSystem();
  refreshTooltips();
}

init();
