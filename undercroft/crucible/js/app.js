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
  listArrayFieldOptions,
  loadAbilityFieldDefs,
} from "./lib/tables.js";
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
// The weapon-attack/rider/save-effect/`options`-menu editor — extracted
// from this file into a shared module (feature-params-editor.js) so
// Vault's own Basic Authoring mode can offer the exact same editing
// surface once it has its own parameterized spell/item mechanics types,
// instead of a second hand-rolled copy. Instantiated once below, once
// every hook it depends on (currentRecord, dataManager, abilityFieldDefs,
// renderFeatureList) is in scope.
import { createFeatureParamsEditor } from "../../common/js/lib/feature-params-editor.js";
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
  setGenerateButtonReadiness,
  listObjectFieldOptions,
} from "../../common/js/lib/generator-kit.js";
import { markRequiredControl, setElementVisible } from "../../common/js/lib/dom.js";
import { resolveGroupContext, pickGroupDefaultId } from "../../common/js/lib/widgets/group-context.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
import { createTokenImageField } from "../../common/js/lib/token-picker.js";
import { initToolSettings } from "../../common/js/lib/tool-settings.js";
import { abilityModifier, averageDiceRoll, computeAttackBonus, computeSaveDC, computeAverageDamage } from "../../common/js/lib/dnd-rules.js";
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
let arrayFieldOptions = [];
// Which array field guessCombatScalingFieldKey/guessCreatureTypeFieldKey
// would auto-pick for the active System — same "ride along with the
// options fetch, no second round trip" shape as abilityFieldGuess below,
// so each settings dropdown can pre-select its own guess and label it
// instead of offering a separate "Auto-detect" placeholder option.
let combatScalingFieldGuess = "";
let creatureTypeFieldGuess = "";
// Candidate list for the abilityField settings preference below — every
// object-type field the active System defines, since an ability/stat block
// is always authored as one (unlike arrayFieldOptions' array fields) — plus
// which one guessAbilityFieldKey would auto-pick, so the dropdown can
// pre-select and label it instead of offering a separate "Auto-detect"
// placeholder option.
let objectFieldOptions = [];
let abilityFieldGuess = "";
// The active System's own ability key/label list (see stats.js#deriveStats,
// which reads this same data independently for generation) — kept here too
// so renderStats' display rows use the System's real ability vocabulary
// instead of a second hardcoded STR/DEX/CON/INT/WIS/CHA copy.
let abilityFieldDefs = [];
// Which of these ability keys the active System actually stores its stat
// block under — "abilities" for D&D, "traits" for Daggerheart, ... — never
// hardcoded (see stats.js#deriveStats' own header comment).
let abilityFieldKey = "";
// The active System's own live-play-state bindings (HP/AC/Initiative/...) —
// stats.js#deriveStats writes each generated value through setAtBinding
// against whatever path THIS System's own combatBindings declare, never a
// hardcoded "stats.hitPoints"-shaped assumption. null for a System with no
// Role-bound field at all.
let combatBindings = null;
let currentRecord = null;
const featureParamsEditor = createFeatureParamsEditor({
  getRecord: () => currentRecord,
  onParamsChanged: () => refreshAfterFeatureEdit(),
  saveFeature: (feature) => dataManager.save("feature", feature.id, feature),
  onFeatureSaved: () => renderFeatureList(currentRecord),
  getAbilityFieldDefs: () => abilityFieldDefs,
});
// Which row in the Features list the Inspector panel is currently showing —
// selectFeatureRow's own state, tracked at module level so the Multiattack
// editor's "Add" button (attached once, at init, like every other button in
// this file) knows which Feature to edit without needing it threaded through
// as an argument.
let selectedFeatureId = null;
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

// Whole-record snapshot undo — same shape/reasoning as Repository's own
// recordHistory/field-commit-debounce pair (repository/js/app.js). Snapshots
// use buildRecordForSave() (not currentRecord directly) so a Name/Notes edit
// — which only lands on currentRecord at Save/Export time, see
// buildRecordForSave's own comment — is still captured; restoring a snapshot
// goes through renderMonster, which already writes record.name/record.notes
// back into their live input fields. Feature-params sub-edits (Multiattack/
// weapon-attack/save-effect, routed through the shared featureParamsEditor)
// are intentionally NOT wrapped here — that mutation happens inside a shared
// module this pass isn't touching, consistent with scoping undo to this
// file's own primary mutation points (reroll, feature add/remove, Generate,
// Name/Notes/Stats edits) rather than every nested editing surface.
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

// Built and mounted before `elements` below queries for these buttons by
// their data-*-monster attribute, so every existing selector/disabled-state
// call site elsewhere in this file keeps working unchanged.
createToolbarButtonGroup([
  // Starts disabled — nothing to generate FROM until reloadReferenceData
  // (init()'s own cascade, below) resolves; clicking it before then threw
  // straight out of generateMonster (creatureTypes/archetypes/etc. still
  // their initial empty arrays). Re-enabled by init() once that resolves.
  { action: "generate", label: "Generate Monster", disabled: true, attrs: { "data-generate-monster": true } },
  { action: "save", label: "Save", disabled: true, attrs: { "data-save-monster": true } },
  { action: "duplicate", label: "Duplicate", disabled: true, attrs: { "data-duplicate-monster": true } },
  { action: "delete", label: "Delete", disabled: true, attrs: { "data-delete-monster": true } },
]).forEach((button) => document.querySelector("[data-monster-toolbar-mount]")?.appendChild(button));
// A small visual break, not a functional one — same convention every other
// tool's toolbar now uses (see forge/js/app.js's own comment).
createToolbarButtonGroup([
  { action: "undo", label: "Undo", attrs: { "data-undo-monster": true } },
  { action: "redo", label: "Redo", attrs: { "data-redo-monster": true } },
]).forEach((button) => document.querySelector("[data-monster-undo-toolbar-mount]")?.appendChild(button));
// A genuinely new, cross-tool action, not a 5th slot on the primary
// Generate/Save/Duplicate/Delete cluster above, and NOT a second row on
// that same left-pane toolbar either — that still reads as part of the
// primary action bar regardless of grouping. Lives in its own "Monster
// Properties" section in the right-pane Inspector instead (mounted below,
// alongside inspectorSection) — see forge/js/app.js's identical comment
// for the shared reasoning.
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

// Monster Properties — currently just the Convert to Character action, but
// its own named section (not the Inspector's) since it's about the
// generated Monster itself, not whatever the Inspector below happens to be
// showing (Feature detail). Starts collapsed; expandMonsterPropertiesSection
// (below) opens it whenever a new Monster is generated or selected — see
// forge/js/app.js's identical npcPropertiesSection.
const monsterPropertiesSection = createCollapsibleSection({
  label: "Monster Properties",
  collapsed: true,
  content: document.querySelector("[data-monster-properties-panel]"),
});
document.querySelector("[data-monster-properties-mount]")?.appendChild(monsterPropertiesSection.section);
function expandMonsterPropertiesSection() {
  monsterPropertiesSection.setCollapsed(false);
}

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

  // The raw JSON dump is a nested collapsible section OF ITS OWN, inside
  // the Inspector's own already-collapsible content — collapsed by default
  // (unlike Inspector itself) since it's a diagnostic/power-user detail, not
  // something a GM needs open by default the way the structured
  // Multiattack/weapon-attack/save-effect editors above it are. Same
  // "adopt the existing static element as content" pattern as every other
  // createCollapsibleSection call here — elements.inspectorJson keeps
  // working unchanged (its own querySelector ref stays valid after
  // appendChild relocates the element, same as any DOM move).
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
  if (!next.combatScalingField && !next.creatureTypeField && !next.abilityField) {
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

// Which object field is this System's ability/stat block — same per-System,
// per-browser tool preference shape as combatScalingField/creatureTypeField
// above, feeding loadAbilityFieldDefs' own preferredKey param instead of it
// always assuming a field literally named "abilities" (see
// feedback_settings_preference_with_guessed_default). Empty/unset falls
// through to loadAbilityFieldDefs' own shape-based guess, not a fixed
// conventional default — unlike combatScalingField/creatureTypeField, there
// isn't one single "usual" key name here worth hardcoding as a fallback.
function getAbilityFieldPreference(systemId) {
  return getCrucibleSystemSettings(systemId).abilityField || "";
}

function setAbilityFieldPreference(systemId, fieldKey) {
  setCrucibleSystemSetting(systemId, "abilityField", fieldKey || "");
}

// combatScalingField/creatureTypeField share the same candidate list (every
// top-level array field the active System defines), but each has its own
// guessed key — `guessedKey`/`rawPreference` parameterize which one this
// call is for. A real "None" option (unlike abilityField, which has no
// off-switch) lets a GM explicitly force "no field" for a System that
// genuinely has neither concept, distinguishing that from "never
// configured yet". Same "(auto-detected)" labeling convention as
// abilityField below — the guessed field IS the selected value until the
// GM picks something else, no separate "Auto-detect" placeholder.
function fieldPreferenceOptions(guessedKey, rawPreference) {
  return [
    { value: "", label: "None" },
    ...arrayFieldOptions.map((field) => ({
      value: field.key,
      label:
        field.key === guessedKey && !rawPreference
          ? `${field.label || field.key} (auto-detected)`
          : field.label || field.key,
    })),
  ];
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
  let objectFieldResult;
  let arrayFieldResult;
  let systemFields;
  [creatureTypes, archetypes, roles, fetchedFeatures, combatScalingLevels, arrayFieldResult, objectFieldResult, abilityFieldDefs, systemFields] =
    await Promise.all([
      listCreatureTypesForSystem(dataManager, systemId, creatureTypeField || undefined),
      listArchetypesForSystem(dataManager, systemId),
      listRolesForSystem(dataManager, systemId),
      listFeaturesForSystem(dataManager, systemId),
      loadCombatScalingLevels(dataManager, systemId, combatScalingField || undefined),
      listArrayFieldOptions(dataManager, systemId),
      listObjectFieldOptions(dataManager, systemId),
      loadAbilityFieldDefs(dataManager, systemId, getAbilityFieldPreference(systemId)),
      loadSystemFields(dataManager, systemId),
    ]);
  objectFieldOptions = objectFieldResult.options;
  abilityFieldGuess = objectFieldResult.guessedKey;
  abilityFieldKey = getAbilityFieldPreference(systemId) || abilityFieldGuess || "abilities";
  combatBindings = deriveCombatBindings(systemFields);
  arrayFieldOptions = arrayFieldResult.options;
  combatScalingFieldGuess = arrayFieldResult.guessedCombatScalingKey;
  creatureTypeFieldGuess = arrayFieldResult.guessedCreatureTypeKey;
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
// feedback that these needed to be editable, not read-only text.
// `data-editable-identity` is this section's own write-back attribute (see
// the identityFields "change" listener below) — distinct from Stats' own
// `data-editable-stat` since the two sections write into different parts
// of the record (top-level fields here vs. `record.stats` there).
function renderIdentity(record) {
  if (!elements.identityFields) return;
  elements.identityFields.innerHTML = "";
  // Creature Type is real data every monster carries regardless of
  // provenance (record.type — a native generation's own vocabulary pick, or
  // an imported stat block's own genuine type, e.g. "humanoid"), so it
  // always renders. Archetype/Role are Crucible's own generation axes an
  // imported record never has (see isImportedStatBlock) — Signature Feature
  // deliberately isn't a field here either way — it's already shown,
  // clearly labeled "Signature", on its own Feature's row in the Features
  // list below (renderFeatureList), so a second control for the same fact
  // up here was redundant.
  // blankLabel was always supported here but never actually set on any of
  // these three fields — an unset/unrecognized value (e.g. a value with no
  // matching option, like an import whose raw type didn't resolve — see
  // resolveCreatureType, mapping-custom-functions.js) silently rendered as
  // whichever real option happens to come first alphabetically ("Aberration"),
  // reading as a confidently wrong answer instead of "nothing chosen."
  // Native generation's blank truly means "resolve randomly" (see this
  // tool's own CLAUDE.md); an imported record has no such reroll-on-save
  // behavior, so it gets a plainly different label instead of implying one.
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

// Enabled only when mechanics.scope === "unique" — see crucible.feature-
// basic-info (help-topics.json) for the GM-facing explanation.
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

// Saves straight through dataManager.save("feature", ...), same immediate-
// save path the shared featureParamsEditor's own options editor uses (a
// Feature-record edit, not a monster-record one, so the monster's own
// dirtyGate/Save button don't apply). `description` and `mechanics.text` are kept in sync when both
// are plain strings — this session's own established convention for a
// one-off passive Feature (every prior migration script this session kept
// them identical), even though rendering only ever reads `description`
// for a plain "passive" Feature; leaving `mechanics.text` stale would
// still read as a real inconsistency in the Raw JSON view.
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

// A shared Feature's own per-monster numbers live in
// currentRecord.featureParams[feature.id] (monster-feature-matching.js's
// buildMultiattackParams/parseWeaponAttack/parseSaveEffect — the same
// "shared, content-free template Feature plus per-monster data on the
// record" shape every one of Multiattack/weapon-attack/save-effect uses),
// NOT on the Feature itself. So editing any of them is editing part of the
// monster record, exactly like add/removeFeature below: marks the record
// dirty and waits for the monster's own Save button, rather than an
// independent immediate save. Refreshed together after every edit: the
// Features list row's own live-computed text (multiattackDescriptionText/
// weaponAttackDescriptionText/saveEffectDescriptionText all read
// featureParams fresh every render), the left-pane JSON Data panel, and the
// Save button's own enabled state. Named generically (not
// "...MultiattackEdit") since the shared featureParamsEditor's own weapon-
// attack/save-effect editors share this exact same commit path.
function refreshAfterFeatureEdit() {
  dirtyGate.markDirty();
  renderFeatureList(currentRecord);
  jsonDataPanel.render();
  updateActionButtons();
}

// A Multiattack's own attack-reference data has two possible shapes on
// record.featureParams[featureId], read here as a normalized list of option
// GROUPS (each an {featureId,count}[] AND-combination) so every caller
// (editor, renderer) has one shape to reason about: the legacy/common flat
// `attacks` (a fixed combination, no real choice) is just `options` with one
// entry. `attacks` is kept as its own key for the common case rather than
// forced into `options` on every save — see monster-feature-matching.js's
// buildMultiattackParams — this reader just papers over the two shapes.
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
  // A referenced Feature that no longer resolves (removed from this
  // monster, or deleted outright) is shown in red rather than silently
  // vanishing from the list — same "never lose information silently"
  // rule multiattackDescriptionText's own fallback already follows, just
  // surfaced here instead of just falling back to plain text.
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
// any OTHER Multiattack-type Feature (attacking "with" a Multiattack isn't a
// real 5e concept) — same candidate pool populateAddFeatureSelect draws
// from (currentRecord.featureIds), just filtered differently. Scoped to ONE
// option group — adding an already-listed Feature again, within that SAME
// group, bumps its existing count instead of creating a second entry (a
// Feature can legitimately appear in more than one option, so this only
// dedupes within a single group, not across groups).
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
  // Starts blank rather than a real "1" — a pre-filled count next to an
  // unselected "Select…" placeholder read as if a real attack were already
  // queued up to add. Once a real Feature is picked, default the count to 1
  // (still freely editable) rather than leaving it blank at that point,
  // since a genuine attack-to-add always needs SOME count.
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
// entry of a real choice, appending a fresh empty group alongside it — used
// both to start a brand-new choice-structured Multiattack from scratch (both
// groups start empty) and to add a THIRD+ alternative to an already-choice-
// structured one.
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

// weapon-attack/rider/save-effect/options-menu editing now lives in the
// shared featureParamsEditor instance (feature-params-editor.js) created
// above — see its own module comment for why this moved out of here.

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

// Display labels for a Feature's own `combat.actionCost` (monster-feature-
// matching.js's ACTION_COST_BY_GROUP_KEY vocabulary) — renderFeatureList's
// own right-side pill below, not shown at all for a trait (no actionCost).
const ACTION_COST_LABELS = {
  action: "Action",
  "bonus-action": "Bonus Action",
  reaction: "Reaction",
  "legendary-action": "Legendary",
  "lair-action": "Lair Action",
};

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];

// Multiattack is a single shared `feat.multiattack` Feature (like
// feat.bite/feat.claw) — this monster's own attack-reference list lives in
// record.featureParams[feature.id] instead of on the Feature itself (see
// monster-feature-matching.js's buildMultiattackParams), so this needs
// `record` the same way weaponAttackDescriptionText below already does.
// `attacks` is a live reference to this SAME monster's other Features, not
// stored prose — resolving each referenced Feature's CURRENT name here means
// renaming/editing e.g. a Bite Feature keeps Multiattack's own displayed
// text in sync automatically, instead of a static string silently going
// stale. Falls back to the original imported text (params.text) whenever
// attacks is absent (extraction failed, or the ability was choice-
// structured — see extractMultiattackReferences) or any referenced Feature
// no longer resolves, rather than showing a broken partial sentence.
// Resolves one option group (an AND-combination) into its own sentence,
// preserving the EXACT phrasing this function produced before options
// existed — a single-group Multiattack (the ~200 already-simple cases) must
// keep rendering identically, not gain new "option" language it doesn't
// need. Returns null (never a wrong-but-plausible sentence) if any
// referenced Feature no longer resolves.
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
  // naturally than the multi-type sentence shape below forced onto it
  // ("makes three attacks: three with its Tentacle") — confirmed live: this
  // WAS the general-case phrasing for every single-type Multiattack (the
  // large majority of them) until caught during a review of the re-import
  // this whole Multiattack pipeline is meant to withstand.
  if (resolved.length === 1) {
    const { name, count } = resolved[0];
    return `The creature makes ${COUNT_WORDS[count] || count} ${name} attack${count === 1 ? "" : "s"}.`;
  }
  const parts = resolved.map(({ name, count }) => `${COUNT_WORDS[count] || count} with its ${name}`);
  const list = `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `The creature makes ${COUNT_WORDS[total] || total} attacks: ${list}.`;
}

// A single option's resolved {featureId,count} list is "one of each" of
// EVERY OTHER option's own distinct attack types — Aartuk Elder's own third
// option ("two Branch attacks, two Radiant Pellet attacks, or one of
// each"), which extraction already resolves to a concrete {Branch:1,
// RadiantPellet:1} list (monster-feature-matching.js's own
// EACH_OF_PREVIOUS_OPTIONS_PATTERN) so the editor UI has real, editable rows
// — but rendering that expansion word-for-word ("one Branch attack and one
// Radiant Pellet attack") loses the much more natural "one of each" the
// original text actually said. Detected here at render time instead of
// baked into storage, so the stored shape stays the same simple
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

// Same AND-combination resolution as describeSingleAttackSentence above,
// but as a bare fragment (no "The creature makes ..." lead-in, no
// total-count preamble) — meant to be embedded as one clause of a larger
// "X, Y, or Z" sentence, never shown on its own. Only reached when there's
// a genuine choice (2+ options); a single option always goes through
// describeSingleAttackSentence instead. Each item within the option is its
// own "N Name attack(s)" phrase (matching the single-item convention, NOT
// the "N with its Name" shape a real bug here used to produce — confirmed
// live: Aartuk Elder's own Multiattack rendered "two with its Branch and
// two with its Radiant Pellet", not "two Branch attacks and two Radiant
// Pellet attacks"), joined with "and" — "and", not a comma, specifically so
// a 3+-option Multiattack (Bukavac's own 4-way choice, some of whose
// options are themselves 2-item combinations) never reads ambiguously
// where one option ends and the next begins; only multiattackDescriptionText
// itself (not this function) knows how many top-level options exist.
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

// Extends multiattackDescriptionText's original single-combination
// rendering to a genuine CHOICE ("two Branch attacks, two Radiant Pellet
// attacks, or one of each") — record.featureParams["feat.multiattack"]'s
// `options` field (see monster-feature-matching.js's
// extractMultiattackReferences/buildMultiattackParams and
// multiattackOptionGroups above). A single option renders EXACTLY as before
// this workstream (describeSingleAttackSentence, unchanged); 2+ options
// join each option's own fragment (describeAttackCombination) with an
// Oxford-comma-style list ("X, Y, or Z" — used even for exactly 2 options,
// so "X, or Y" reads consistently whether there are 2 or more alternatives),
// never attempting DPR/average-damage-across-options math — the value here
// is correct representation of the choice, not combat math derived from it.
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

// A signed "+N"/"-N" fragment for embedding a bare ability modifier inside
// a dice-expression display string (formula mode's own "1d10 + 4" — literal
// mode never needs this, its own stored `damageDice` already has the
// modifier baked in as text).
function formatDiceModifier(modifier) {
  if (!modifier) return "";
  return modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`;
}

// A shared weapon-attack Feature (feat.bite, feat.claw, ... — monster-
// feature-matching.js's parseWeaponAttack) carries no numbers of its own;
// this monster's OWN copy's numbers live in record.featureParams instead
// (parallel to record.featureTiers) — computed into the same sentence
// shape 5e's own stat blocks use, rather than the shared Feature storing
// (and every monster re-storing) a static string. Falls back to the
// Feature's own generic description whenever this monster has no
// featureParams entry for it — a defensive case that shouldn't happen in
// practice (every weapon-attack Feature is created WITH a featureParams
// entry), but never worth a broken/blank row if it somehow does.
//
// Two param shapes: LITERAL (today's imported data — `attackBonus`/
// `damageDice` already have this monster's own numbers, including any
// ability modifier, baked straight into stored values) and FORMULA
// (detected by the presence of `ability` instead — `damageDice` is a bare
// base die with NO modifier embedded, e.g. "1d10", and the attack bonus/
// damage modifier are computed live from THIS monster's own
// `stats.abilities[params.ability]` + `stats.proficiencyBonus` via
// dnd-rules.js's computeAttackBonus/computeAverageDamage). Formula mode is
// what makes a shared weapon-attack Feature genuinely reusable by a
// brand-new native-generated monster — no per-monster hand-authored numbers
// needed, just picking the Feature and setting `ability`/base `damageDice`
// at selection time.
// A rider clause tacked onto an otherwise-normal computed attack (Peryton's
// charge bonus, "plus N acid damage", "or be knocked prone") — the OTHER
// shape from feature.options above: per-monster data layered on a shared
// template's own computed sentence, not a feature-level menu. Rider dice
// are always literal/flat (a secondary damage type or a charge bonus never
// scales with the attacker's own ability modifier in real 5e design, the
// same reasoning saveEffectDescriptionText's own damage dice already rely
// on) — never formula-computed, regardless of whether the base attack
// itself is in literal or formula mode.
function riderClauseText(rider) {
  if (!rider?.kind) return "";
  if (rider.kind === "secondary-damage") {
    const avg = averageDiceRoll(rider.dice);
    if (avg == null) return "";
    return ` plus ${avg} (${rider.dice}) ${rider.damageType} damage.`;
  }
  if (rider.kind === "save-or-condition") {
    if (!rider.saveAbility || !rider.saveDC || !rider.condition) return "";
    const duration = rider.duration ? ` for ${rider.duration}` : "";
    const savingAbility = rider.saveAbility.charAt(0).toUpperCase() + rider.saveAbility.slice(1);
    // `targetRestriction` overrides the default "a creature" wording for
    // the real cases that aren't unconditional — a whole lycanthropy-curse
    // cluster only triggers "If the target is a humanoid, ...", Ghast/
    // Ghoul's own Claws only trigger "If the target is a creature other
    // than an undead, ...". Omitted (default "a creature") is still the
    // overwhelmingly common case.
    const article = /^[aeiou]/i.test(rider.targetRestriction || "creature") ? "an" : "a";
    return ` If the target is ${article} ${rider.targetRestriction || "creature"}, it must succeed on a DC ${rider.saveDC} ${savingAbility} saving throw or be ${rider.condition}${duration}.`;
  }
  // A save-based rider that deals BONUS DAMAGE on a failed save (half on a
  // success) instead of a condition — the same "taking N (dice) TYPE
  // damage on a failed save, or half as much damage on a successful one"
  // shape saveEffectDescriptionText's own base sentence uses, just riding
  // on a single-target weapon attack instead of an area effect (a whole
  // cluster of venomous Bite/Claw attacks: Giant Poisonous Snake, Giant
  // Spider, Phase Spider, Guardian Naga, ...).
  if (rider.kind === "save-or-damage") {
    if (!rider.saveAbility || !rider.saveDC || !rider.dice || !rider.damageType) return "";
    const avg = averageDiceRoll(rider.dice);
    if (avg == null) return "";
    const savingAbility = rider.saveAbility.charAt(0).toUpperCase() + rider.saveAbility.slice(1);
    const trailingNote = rider.trailingNote ? ` ${rider.trailingNote}` : "";
    return ` The target must make a DC ${rider.saveDC} ${savingAbility} saving throw, taking ${avg} (${rider.dice}) ${rider.damageType} damage on a failed save, or half as much damage on a successful one.${trailingNote}`;
  }
  if (rider.kind === "charge-bonus") {
    const avg = averageDiceRoll(rider.dice);
    if (avg == null || !rider.triggerDistance) return "";
    return ` If the creature moved ${rider.triggerDistance}+ feet straight toward the target immediately before the hit, the target takes an extra ${avg} (${rider.dice}) ${rider.damageType} damage.`;
  }
  // A secondary damage bonus whose TYPE isn't a literal fixed value —
  // "damage of the type to which the creature has resistance" (Dragonsoul,
  // Orc of the Onyx Scale's own identical Shortsword rider) — a dragon-
  // blooded/elemental-themed humanoid dealing bonus damage that matches
  // whatever it's own resistance happens to be, never baked in as a
  // literal `damageType` the way `secondary-damage` above is.
  if (rider.kind === "resistance-type-damage") {
    const avg = averageDiceRoll(rider.dice);
    if (avg == null) return "";
    return ` plus ${avg} (${rider.dice}) damage of the type to which the creature has resistance.`;
  }
  // An UNCONDITIONAL on-hit effect, no saving throw at all — confirmed
  // live: Blood Lash's own "...it can't regain hit points until the start
  // of [name]'s next turn" (Murgaxor, Oriq Blood Mage) doesn't fit save-
  // or-condition (no DC, no save) or either damage-only kind. Genuinely
  // fixed/non-scaling wording, unlike the other 3 kinds' own varying
  // dice/DC/distance — `condition` carries the whole trailing clause.
  if (rider.kind === "condition-no-save") {
    if (!rider.condition) return "";
    return ` If the target is a creature, it ${rider.condition}.`;
  }
  return "";
}

// The 5e Versatile weapon property ("or N2 (dice2) TYPE damage if used
// with two hands") — an alternate damage VALUE for the same hit, not a
// conditional extra effect, so it's its own field (`params.versatile`)
// rather than a 5th rider kind: it needs to insert INTO the base "Hit:
// ..." sentence (before the period), not append after it the way every
// rider kind does, and it can genuinely coexist with a real rider
// (confirmed live: 5 of 8 "Longsword" one-offs stacked Versatile AND a
// secondary-damage rider together — Autumn Eladrin's own "...or 6 (1d10 +
// 1) slashing damage if used with two hands, plus 22 (5d8) psychic
// damage." has both). Same literal-vs-formula duality as the base attack:
// `versatile.damageDice` already has the modifier baked in for literal
// mode, is a bare base die for formula mode (computed via the SAME
// ability score/modifier as the primary damage, matching real 5e design
// — a Versatile weapon's two-handed die is bigger, never a different
// governing ability).
function versatileClauseText(params, record) {
  if (!params.versatile?.damageDice) return "";
  let avg;
  let dice;
  if (params.ability) {
    const abilityScore = record.stats?.abilities?.[params.ability];
    if (abilityScore == null) return "";
    avg = computeAverageDamage(params.versatile.damageDice, abilityScore);
    dice = `${params.versatile.damageDice}${formatDiceModifier(abilityModifier(abilityScore))}`;
  } else {
    avg = averageDiceRoll(params.versatile.damageDice);
    dice = params.versatile.damageDice;
  }
  if (avg == null) return "";
  return `, or ${avg} (${dice}) ${params.damageType} damage if used with two hands`;
}

// `kind: "MeleeOrRanged"` (a finesse/thrown weapon usable either way in one
// combined sentence — parseWeaponAttack's own MELEE_OR_RANGED_PATTERN,
// monster-feature-matching.js) carries BOTH `meleeDistance`/`rangeDistance`
// instead of the classic single `distanceLabel`/`distance` pair, so it
// needs its own distance-clause text rather than the plain
// "reach/range N ft." every other kind renders.
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
    const attackBonus = computeAttackBonus(abilityScore, proficiencyBonus);
    const avg = computeAverageDamage(params.damageDice, abilityScore);
    if (avg == null) return fallback;
    const modifier = abilityModifier(abilityScore);
    return `${attackLead} ${params.attackKind} Attack: +${attackBonus} to hit, ${distanceClause}, one target. Hit: ${avg} (${params.damageDice}${formatDiceModifier(modifier)}) ${params.damageType} damage${versatile}.${rider}`;
  }
  const avg = averageDiceRoll(params.damageDice);
  if (avg == null) return fallback;
  // A bare flat damageDice ("1", no "d") — real source text for a handful
  // of tiny creatures omits the dice parenthetical entirely when the
  // average is 1 ("Hit: 1 piercing damage.") rather than "(1d4 - 1)".
  // Rendering "(1)" for that case would be a cosmetic regression from the
  // real 5e convention, so the parenthetical is dropped whenever there's no
  // real dice notation to show.
  const diceNote = /\d+d\d+/i.test(params.damageDice) ? ` (${params.damageDice})` : "";
  return `${attackLead} ${params.attackKind} Attack: +${params.attackBonus} to hit, ${distanceClause}, one target. Hit: ${avg}${diceNote} ${params.damageType} damage${versatile}.${rider}`;
}

// weaponAttackDescriptionText's own sibling for `mechanics.type ===
// "save-effect"` (monster-feature-matching.js's parseSaveEffect — a breath
// weapon, almost always). Unlike weapon-attack, the damage dice here are
// NEVER formula-computed — a breath weapon's damage scales with the
// monster's size/age category in real 5e design, not with an ability
// modifier — only the DC is: `params.dcAbility` (defaulted to Constitution
// by parseSaveEffect, 5e's own universal breath-weapon convention) drives
// computeSaveDC against THIS monster's own ability score, exactly the way
// weaponAttackDescriptionText's own formula mode computes an attack bonus.
// `params.ability` (kept separate, always literal) is the TARGET's own
// saving-throw ability — real per-monster variance read off the original
// text, nothing to compute since it has nothing to do with this monster's
// own stats.
// `params.rider` mirrors weaponAttackDescriptionText's own rider concept,
// with two kinds specific to the save-effect shape (see
// SAVE_EFFECT_FAIL_CONDITION_PATTERN's own comment in
// monster-feature-matching.js for why these store literal per-monster text
// rather than decomposed fields):
// - `fail-condition`: the failed/successful-save outcome is more than just
//   "damage, or half damage" (a push, a condition, a stun) — REPLACES the
//   base sentence's own damage clause, since the rider text already
//   contains its own "On a failed save.../On a successful save..." pair
//   with its own damage numbers baked in.
// - `trailing-note`: a narrative addendum tacked on AFTER the normal
//   damage/save sentence, which stays intact and unmodified (a creature
//   slain by the damage rises as undead, a temporary-hit-points side
//   effect, ...).
function saveEffectDescriptionText(feature, record) {
  const params = record.featureParams?.[feature.id];
  const fallback = feature?.description || "";
  if (!params) return fallback;
  const dcAbilityScore = record.stats?.abilities?.[params.dcAbility];
  const proficiencyBonus = record.stats?.proficiencyBonus;
  if (dcAbilityScore == null || proficiencyBonus == null) return fallback;
  const dc = computeSaveDC(dcAbilityScore, proficiencyBonus);
  const width = params.lineWidth ? ` that is ${params.lineWidth} feet wide` : "";
  const savingAbility = params.ability.charAt(0).toUpperCase() + params.ability.slice(1);
  // 5e's own real convention (confirmed against every sample this pattern
  // was built from): the back-reference always says "that line" for a
  // line, but "that area" — never "that cone"/"that sphere" — for anything
  // else.
  const areaBackref = params.areaShape === "line" ? "line" : "area";
  const lead = `The creature ${params.verb} ${params.substance} in a ${params.areaSize}-foot ${params.areaShape}${width}.`;
  if (params.rider?.kind === "fail-condition" && params.rider.conditionText) {
    return `${lead} Each creature in that ${areaBackref} must make a DC ${dc} ${savingAbility} saving throw. ${params.rider.conditionText}`;
  }
  const avg = averageDiceRoll(params.damageDice);
  if (avg == null) return fallback;
  const base =
    `${lead} Each creature in that ${areaBackref} must make a DC ${dc} ${savingAbility} saving throw, taking ${avg} ` +
    `(${params.damageDice}) ${params.damageType} damage on a failed save, or half as much damage on a successful one.`;
  return params.rider?.kind === "trailing-note" && params.rider.conditionText ? `${base} ${params.rider.conditionText}` : base;
}

// Feature-level "menu of named sub-effects" (feature.options — an ability
// that presents several named alternatives, e.g. Iron Cobra's Bite rolling
// one random poison effect, Gem Stalker's Crystal Dart varying by the kind
// of dragon that made it, a dragon's own "uses one of the following breath
// weapons"). Deliberately NOT Tiers: every option always belongs to the
// ability at once (no record.featureTiers-style single pick) — how
// resolution actually happens (random roll, fixed per individual, or the
// attacker's own per-turn choice) is flavor text, not something the data
// model distinguishes.
// Builds the base description plus an indented, bold-headed bulleted list
// for feature.options directly into `container` — a real DOM structure
// so the list is actually readable (a plain `.textContent` string with
// embedded "\n"s, this function's own original shape, renders as one
// unbroken run-on paragraph in a `<div>` — browsers don't respect literal
// newlines without `white-space: pre-line`, and even then a bulleted list
// reads far better than wrapped prose for a genuine menu of alternatives).
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
// that just re-invokes another already-defined ability by name ("The
// creature uses its Command Aquatic Creature ability, even if it has not
// recharged.", "The creature makes one Tentacle attack."), rather than
// carrying its own real mechanical effect. `legendaryActionReference`
// lives on the Feature itself (these are already monster-specific one-off
// content, same as `options` above — no per-monster featureParams
// indirection needed for something this inherently flavor-named).
// `referencedFeatureIds` keeps the referenced ability's own NAME in sync
// automatically if it's ever renamed — a monster whose "Command Aquatic
// Creature" gets renamed doesn't leave this wrapper's own text stale.
// Two or more ids join with "or" (Adult Topaz Dragon's own "uses Psychic
// Step or Spellcasting" shape) — `{names}` in `template` is replaced with
// that joined list; `template` defaults to a plain generic sentence for a
// Feature that doesn't need Deep One's own "even if it has not recharged"
// qualifier.
function legendaryActionReferenceDescriptionText(feature) {
  const ref = feature?.legendaryActionReference;
  if (!ref?.referencedFeatureIds?.length) return feature?.description || "";
  const names = ref.referencedFeatureIds.map((id) => findById(features, id)?.name || id).join(" or ");
  return (ref.template || "The creature uses its {names} ability.").replace("{names}", names);
}

function renderFeatureList(record) {
  if (!elements.featureList) return;
  // Disposed before the wipe — each row's own Remove button carries a real
  // tooltip now, and this reruns on every feature add/remove. See
  // tooltips.js's own BUG CLASS 2.
  disposeTooltips(elements.featureList);
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
    // Which of a shared tiered Feature's own tiers (monster-feature-
    // matching.js's resolveDayFrequencyTier, e.g. Legendary Resistance's
    // 1/3/4/5-per-day variants) THIS monster's own copy uses — same
    // record.featureTiers convention Vault's own wonders already use, just
    // a per-frequency mechanics.text here instead of Vault's per-tier
    // budgetCost. Absent entirely for a non-tiered Feature (tier stays
    // undefined, every ?? below just falls through to the base Feature).
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
    // Hover-preview chip (library-reference.js), same suite-wide "displayed
    // inline wherever needed" primitive Character's own Features tab uses —
    // resolves against the same Feature record regardless of which tier's
    // own name is shown here.
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

    // Muted pill — deliberately not badge text-bg-primary like Signature
    // above, so the two never compete for attention in the same row;
    // absent entirely for a trait (ACTION_COST_BY_GROUP_KEY has no
    // "traits" entry — passive, not action-economy-costed, same convention
    // native generation's own traits-less output already implies).
    // crucible-action-cost-pill (css/styles.css) — text-bg-light read as
    // illegible (light grey background, light grey text); a solid darker
    // grey background with near-black text instead.
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
  refreshTooltips(elements.featureList);
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
// Signature Feature was chosen.
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

// Same "+N"/"-N" convention as abilityModifierText above, minus the
// parens — used for Proficiency Bonus, which is always shown/typed with an
// explicit sign (a bare "2" reads as ambiguous where "+2" doesn't).
// `Number()` parses a leading "+" back out fine, so this round-trips
// through the plain-number write-back branch unchanged.
function formatSignedNumber(value) {
  if (value === "" || value === null || value === undefined) return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric >= 0 ? `+${numeric}` : String(numeric);
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
// `hover` (a sparse boolean, only present when true — the 5e API's own
// {fly, hover} shape, see mapping-custom-functions.js's
// formatSpeedFromObject) is a sibling of `fly`, not a numeric speed of its
// own, so it's excluded from the generic per-key loop and instead appended
// as a "(hover)" suffix on the fly segment specifically — 5e's own
// convention always pairs hover with flying, never any other movement type.
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

  // Row 2: Challenge, AC, Current HP, Max HP, Hit Dice, Proficiency — all 1×
  // the ability score box's own width (default sizing), 6 × 2 = 12 columns,
  // filling the row exactly at md+ (same 6-per-row fit Row 1 abilities use).
  // Condensed from two separate rows: Current/Max HP no longer get a wider
  // box (a wider box around a single short number just left the input tiny
  // and the rest of the box empty), and Hit Dice/Proficiency moved up here
  // from the old Row 3 to fill the row out. Save DC moved down to Row 6,
  // next to Spells — see that row's own comment for why (it's a Crucible-
  // native generation concept, not real per-monster import data the way
  // Proficiency genuinely is).
  //
  // The Hit Dice card shows stats.hitPoints.diceString (the full roll
  // formula, e.g. "18d10+36") in place of the bare stats.hitDice ("18d10")
  // whenever a source actually provided it — one card, not two, so this
  // stays a single slot in the row rather than growing/wrapping it.
  // Editing writes back to whichever one is currently shown (see the
  // hitPointsDiceString branch below).
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

  // Row 6: Save DC, Spells — Save DC lives here, not up in Row 2 with the
  // rest of the "real" imported stats, because it isn't actually one:
  // sys.dnd5e.json's own Save DC is a single scalar keyed by Combat
  // Scaling level, Crucible's own native-generation table (crucible/js/
  // lib/stats.js) — no import mapping populates it (confirmed: real D&D
  // monsters don't have one Save DC, they have several, one per ability —
  // spellcasting, breath weapon, Frightful Presence, ... — each embedded in
  // that ability's own text). It stays here purely as an optional manual
  // GM note, positioned small and next to Spells since that's the stat
  // it's most often actually about. Spells keeps its own genuinely
  // irregular shape (an intro sentence plus per-frequency spell lists) and
  // most of the row's width — far longer than any other stat here, so a
  // 3-row textarea (not a single-line input) keeps it readable/editable in
  // place instead of scrolling horizontally.
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
  if (elements.duplicateButton) elements.duplicateButton.disabled = !hasRecord;
  // Not saved-gated like Delete — a freshly generated, not-yet-saved Monster
  // can convert too (mirrors Duplicate's own gate). Does need a System to
  // filter the Template picker against.
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
// mode each time, same toggle-not-select idiom Repository's own Edit/View
// button uses (undercroft/repository/js/app.js#applyMode) for the identical
// concept. Icon/label always describe what clicking will switch TO, not the
// current state. Defaults to "view" (same default Forge/Vault/Sanctum's own
// identical Notes toggle uses) — a freshly-loaded record's Notes are read
// far more often than edited, and a note written with markdown in mind
// (headings, lists, callouts) reads better rendered than as raw source by
// default.
let notesMode = "view";

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
  if (mode === "relationships") void refreshRelationshipsSection();
}

// --- Relationships -----------------------------------------------------
//
// Crucible's own target-kind whitelist and type-suggestion vocabulary for
// the shared relationship-editor.js/relationship-graph.js modules — see
// that pair's own header comments for the full suite-wide mechanism, and
// Forge's own app.js for the first tool this pattern shipped on. Ecology/
// territory ties, not social ones — a Monster's own suggestions read
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

// "monster" (the existing Identity/Features/Stats/Notes card stack) or
// "relationships" (a full-pane List/Graph view over this Monster's own
// relationship edges) — mutually exclusive Modes, switched by the
// suite-wide Mode toggle group (createModeToggleGroup) in the header row
// above the main pane, exactly mirroring Forge/Repository's own split.
let mode = "monster";
let relationshipsForceGraph = null;
let relationshipsIconByKind = {};

function renderModeToggle() {
  if (!elements.modeToggleMount) return;
  // Nothing to relate until a Monster exists — disabled (not hidden) until
  // then, via createButtonCheckGroup's own disabled/tooltip option support
  // (ui-components.js), the same mechanism every other tool's Relationships
  // option now uses too (previously each hand-rolled an identical
  // post-render querySelector('input[value="relationships"]').disabled
  // patch — consolidated onto this one shared mechanism instead).
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
  // No Monster loaded — clear rather than leave a stale prior Monster's own
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
  // No readiness guard needed here — setGenerateButtonReadiness gives the
  // button a real `disabled` attribute whenever this would fail, and a
  // disabled button's click listener never fires at all (mouse or
  // keyboard), so this handler only ever runs when generation is genuinely
  // ready.
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
      combatScalingField: getCombatScalingFieldPreference(systemId),
      combatScalingId: elements.combatScalingOverride?.value || "",
      role: findById(roles, generated.roleId),
      creatureType: findById(creatureTypes, generated.type),
      features: generated.featureIds.map((id) => findById(features, id)).filter(Boolean),
      dataManager,
      abilityFieldDefs,
      abilityFieldKey,
      combatBindings,
    });
    const record = createMonsterRecord({ ...generated, stats });
    dirtyGate.markDirty();
    // Freshly generated content is always unsaved, regardless of whichever
    // saved Monster the picker previously pointed at — mirrors Sanctum's
    // handleGenerate resetting locationCleanSnapshot the same way.
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
    let conversionErrors = [];
    if (hasConvertibleStatBlock(currentRecord.stats)) {
      const conversionResult = await convertStatBlockToFeatures(currentRecord, {
        dataManager,
        existingFeatures: features,
        monsterSlug: currentRecord.id,
      });
      conversionErrors = conversionResult?.errors || [];
    }
    // Default mode ("auto") matters here exactly like Forge's NPC save: an
    // anonymous GM saves locally to their own browser, a signed-in user gets
    // a real owned/shareable record — Crucible has no whole-tool login gate.
    const exported = toPressExportShape(currentRecord);
    await dataManager.save("monster", currentRecord.id, exported);
    dirtyGate.markClean(exported);
    currentMonsterId = currentRecord.id;
    // A monster still saves fine with one or more of its own traits
    // skipped (see monster-feature-matching.js's own try/catch) — surfaced
    // here rather than staying silent, since that's real information loss
    // a GM would otherwise only discover much later, or never.
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
// Mirrors forge/js/app.js's own identical block — same helper
// (convertLibraryRecord), same id shape, same Template-picker filter, same
// navigation. Kept in sync between the two files rather than factored into
// a shared function, since each tool's own `elements`/`currentRecord`
// plumbing differs enough that a shared version would need its own
// adapter layer for little real savings.
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
  const [abilityDefs, skillValues] = await Promise.all([
    loadAbilityFieldDefs(dataManager, templateSchema),
    loadArrayFieldValues(dataManager, templateSchema, "skills"),
  ]);
  const payload = seedCharacterDefaults(converted, { abilityDefs, skillDefs: skillValues });
  try {
    await dataManager.save("characters", id, payload);
  } catch (error) {
    status?.show(error?.message || "Unable to create the character.", { type: "error" });
    return;
  }
  // The Monster itself was never saved this session (only converted-and-
  // saved as a Character instead) — without this, beforeunload's own dirty
  // check below still sees it as unsaved and throws up a "leave unsaved
  // changes?" browser prompt on the very next line's navigation, even
  // though nothing is actually about to be lost.
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
    settingsSlotAttr: "data-crucible-settings-slot",
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
  // getMonsterGenerationBlockReason mirrors generateMonster's own
  // Archetype/Role eligibility check exactly, so this can never drift out of
  // sync with what actually happens on click.
  function updateGenerateButtonReadiness() {
    const reason = getMonsterGenerationBlockReason(creatureTypes, archetypes, roles, { systemId: currentSystemId() });
    setGenerateButtonReadiness(elements.generateButton, reason);
  }

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
      expandMonsterPropertiesSection();
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
      return [
        {
          key: "combatScalingField",
          type: "select",
          label: "Combat scaling field",
          helpTopic: "crucible.combatScalingField",
          options: fieldPreferenceOptions(combatScalingFieldGuess, getCombatScalingFieldPreference(systemId)),
          getValue: () => getCombatScalingFieldPreference(systemId) || combatScalingFieldGuess,
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
          options: fieldPreferenceOptions(creatureTypeFieldGuess, getCreatureTypeFieldPreference(systemId)),
          getValue: () => getCreatureTypeFieldPreference(systemId) || creatureTypeFieldGuess,
          setValue: (value) => {
            setCreatureTypeFieldPreference(systemId, value);
            reloadReferenceData();
          },
        },
        {
          key: "abilityField",
          type: "select",
          label: "Ability field",
          helpTopic: "crucible.abilityField",
          // No separate "Auto-detect" option — the guessed field (whichever
          // Object property guessAbilityFieldKey picked) IS the selected
          // value until the GM actually picks a different one, with " (auto-
          // detected)" on its own option label as the only indicator. Once a
          // real preference is stored (even re-picking the same field
          // explicitly), that suffix drops — see getValue below.
          options: objectFieldOptions.map((field) => ({
            value: field.key,
            label:
              field.key === abilityFieldGuess && !getAbilityFieldPreference(systemId)
                ? `${field.label || field.key} (auto-detected)`
                : field.label || field.key,
          })),
          getValue: () => getAbilityFieldPreference(systemId) || abilityFieldGuess,
          setValue: (value) => {
            setAbilityFieldPreference(systemId, value);
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
  elements.statsFields?.addEventListener("keydown", flushFieldCommitOnUndoRedo);
  elements.statsFields?.addEventListener("change", () => commitFieldEdit());

  // Per-field reroll button (createFieldBox's own `rerollable` option) —
  // same convention Forge's Identity/4D fields use. Only wired for the
  // non-imported branch's 4 select boxes (buildStatCard/renderIdentity
  // never sets `rerollable` on an imported stat block's free-text boxes),
  // so no isImportedStatBlock guard is needed here.
  elements.identityFields?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll-attribute]");
    if (!button || !currentRecord) return;
    const attribute = button.dataset.rerollAttribute;
    recordHistory(`reroll ${attribute}`, () => {
      renderMonster(rerollAttribute(currentRecord, { creatureTypes, archetypes, roles, features }, currentSystemId(), attribute));
    });
  });

  // Picking a Creature Type/Archetype/Role keeps currentRecord in sync —
  // "change" (not "input", unlike Stats above) since these are all selects,
  // and none need Stats' own live per-keystroke recompute. All three are
  // top-level record fields regardless of provenance (renderIdentity above).
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

  // `?monster=<id>` — a cross-tool deep link (Repository's own kind-
  // reference chips route here via KIND_TOOL_ROUTE, see repository/js/app.js),
  // same `?param=<id>`-read-at-bootstrap convention Orrery's own `?map=` and
  // Loom's own `?feature=` already establish. A monster record only carries
  // its own System (Crucible has no Setting concept at all — see
  // populateMonsterSelect's own comment); a bulk-imported bestiary entry may
  // carry no systemIds at all, in which case the System cascade below is
  // skipped and reloadReferenceData()'s own current/default System list is
  // trusted to already include it (the suite-wide "no tag = universal"
  // convention). Dispatches a real "change" event to actually load the
  // monster rather than duplicating monsterSelect's own change-handler body.
  // Two-phase, not one straight-line await chain — same "show the linked
  // record first, load everything else in the background" fix Sanctum's
  // own deep link needed once a campaign had enough saved content for the
  // full System reference-data reload to be genuinely slow. Phase 1
  // (awaited, blocks return): render THIS monster directly (reusing
  // renderMonster + the same dirty-baseline call monsterSelect's own
  // change handler makes — not that handler itself, since it reads the id
  // off monsterSelect.value, which has no matching <option> yet this
  // early). Phase 2 (fired but not awaited): the System reference-data
  // reload populates monsterSelect's own option list; a real "change"
  // event re-dispatched at the end puts the picker's own displayed
  // selection in sync.
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
      // Phase 2 — deliberately not awaited here; runs after this function
      // has already returned `true`. NOT handleSystemSelectChange (which
      // resets currentMonsterId and calls renderMonster(null) before its
      // own reloadReferenceData) — that wiped the monster Phase 1 had
      // ALREADY rendered, leaving the screen blank for however long the
      // System's own reference-data fetch takes instead of just quietly
      // finishing in the background behind an already-correct view.
      // Setting systemSelect's own value directly and calling
      // reloadReferenceData() straight (same fetch, minus the reset) keeps
      // Phase 1's render on screen the whole time. monsterSelect's own
      // value is set without dispatching "change" for the same reason —
      // the monster is already loaded and correctly shown; re-dispatching
      // would only re-fetch and re-render it a second time for no benefit.
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
  // group has its own System assigned, default Crucible's System select to
  // it — a real, GM-chosen fact about the campaign being played, not a
  // guess — to make mid-campaign generation faster. Falls through to the
  // original "nothing chosen yet" placeholder whenever there's no active
  // group, or its System isn't one this tool's own list actually contains.
  // An explicit `?monster=` deep link always wins over both.
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
    // ran. The deepLinked === true case updates from inside its own Phase 2
    // background IIFE instead (applyDeepLinkParams above), once ITS
    // reference-data load actually finishes. (handleSystemSelectChange's own
    // branch already called this itself, but a second, idempotent call here
    // costs nothing and keeps this block correct even if that changes.)
    updateGenerateButtonReadiness();
  }

  initHelpSystem();
  refreshTooltips();
}

init();
