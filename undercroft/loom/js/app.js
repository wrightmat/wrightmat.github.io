import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls, escapeHtml } from "../../common/js/lib/auth-ui.js";
import { initTierGate } from "../../common/js/lib/access.js";
import { updateJsonPreview } from "../../common/js/lib/json-preview.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { showConfirmModal } from "../../common/js/lib/confirm-modal.js";
import {
  createJsonDataPanel,
  createIconButton,
  createToolbarButtonGroup,
  createCollapsibleSection,
  createCompactField,
  createSearchableCheckList,
} from "../../common/js/lib/ui-components.js";
import { readLockedFeatureIds, populateStringChecklist } from "../../common/js/lib/generator-kit.js";
import { refreshTooltips, disposeTooltips } from "../../common/js/lib/tooltips.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { applyMapping } from "../../common/js/lib/mapping-engine.js";
import { deriveLookupTables } from "../../common/js/lib/system-lookup-tables.js";
import { createMappingCustomFunctions } from "../../common/js/lib/mapping-custom-functions.js";
import {
  loadSourceDataRaw,
  loadLibraryKinds,
  fetchKindEntriesWithIds,
  fetchKindEntrySummaries,
  mergeImportedCharacterData,
  listAvailableMappings,
  SOURCES,
  loadSrdData,
  loadFantasyStatblockDataBulk,
  loadMarkdownWonderDataBulk,
  normalizeSrdInput,
} from "../../common/js/lib/content-fetch.js";
import { convertStatBlockToFeatures, hasConvertibleStatBlock } from "../../common/js/lib/monster-feature-matching.js";
import { convertSpellOrItemToFeatures, hasConvertibleSpellItemStats } from "../../common/js/lib/vault-feature-matching.js";
import {
  promoteEmbeddedFeatures,
  hasEmbeddedFeatures,
  linkCharacterSpellReferences,
  linkCharacterInventoryReferences,
  linkCharacterSpeciesClassReferences,
  describeFeaturePromotionOutcome,
} from "../../common/js/lib/content-feature-matching.js";
import { initShareModal } from "../../common/js/lib/share-modal.js";
import { renderRelationshipEditor } from "../../common/js/lib/relationship-editor.js";
import { allowsDelete, confirmDelete } from "../../common/js/lib/ownership.js";
import { roleRank } from "../../common/js/lib/data-manager.js";
import { createSortable } from "../../common/js/lib/dnd.js";
import { loadClipLibrary, getAllClips } from "../../common/js/lib/audio-clip-library.js";
import { MACRO_ACTION_CATALOG } from "../../common/js/lib/widgets/macro-action-catalog.js";
import { listHaEntities } from "../../common/js/lib/widgets/home-assistant.js";
import { HANDOUT_KINDS, KIND_LABELS as HANDOUT_KIND_LABELS } from "../../common/js/lib/widgets/handout.js";
import {
  PROPERTY_TYPES,
  renderPropertyRow,
  initPropertySortable,
  wirePropertyContainerEvents,
  applyPropertyType,
  collectFieldFromRow,
  collectProperties,
  createPropertyInspector,
  findUnnamedValueEntries,
} from "../../common/js/lib/property-schema-editor.js";
import { resolveFieldRole } from "../../common/js/lib/field-roles.js";
import { validateSystemFields, loadReservedKeysSchema, isReservedKeyName } from "../../common/js/lib/system-validation.js";
import { fieldByKey } from "../../common/js/lib/bindings.js";

// SOURCES now imported from content-fetch.js (shared with Workbench's own
// player-facing Import Character picker) — see that module's own comment.

// Each button below is JS-built once but keeps the exact data-*
// attribute/selector the old static markup used, so every querySelector
// further down (undo/redo, library/system/macro, loomGroup*/loomUser*) still
// resolves unchanged.
createToolbarButtonGroup([
  { action: "new", label: "New Mapping", attrs: { "data-action": "new-mapping", "data-loom-view-panel": "import" } },
  { action: "save", label: "Save Mapping", disabled: true, attrs: { "data-action": "save-mapping", "data-loom-view-panel": "import" } },
  {
    action: "rename",
    icon: "tabler:pencil",
    label: "Rename Mapping",
    disabled: true,
    attrs: { "data-action": "rename-mapping", "data-loom-view-panel": "import" },
  },
]).forEach((button) => document.querySelector("[data-loom-toolbar-mount]")?.appendChild(button));
createToolbarButtonGroup([
  { action: "new", label: "New Entity", attrs: { "data-library-new": true, "data-loom-view-panel": "library", hidden: true } },
  {
    action: "save",
    label: "Save Entity",
    disabled: true,
    attrs: { "data-library-save": true, "data-loom-view-panel": "library", hidden: true },
  },
  {
    action: "duplicate",
    label: "Duplicate Entity",
    disabled: true,
    attrs: { "data-library-duplicate": true, "data-loom-view-panel": "library", hidden: true },
  },
  {
    action: "delete",
    label: "Delete Entity",
    disabled: true,
    attrs: { "data-library-delete": true, "data-loom-view-panel": "library", hidden: true },
  },
]).forEach((button) => document.querySelector("[data-loom-toolbar-mount]")?.appendChild(button));
createToolbarButtonGroup([
  { action: "new", label: "New System", attrs: { "data-system-new": true, "data-loom-view-panel": "systems", hidden: true } },
  {
    action: "save",
    label: "Save System",
    disabled: true,
    attrs: { "data-system-save": true, "data-loom-view-panel": "systems", hidden: true },
  },
  {
    action: "duplicate",
    label: "Duplicate System",
    disabled: true,
    attrs: { "data-system-duplicate": true, "data-loom-view-panel": "systems", hidden: true },
  },
  {
    action: "delete",
    label: "Delete System",
    disabled: true,
    attrs: { "data-system-delete": true, "data-loom-view-panel": "systems", hidden: true },
  },
]).forEach((button) => document.querySelector("[data-loom-toolbar-mount]")?.appendChild(button));
createToolbarButtonGroup([
  { action: "new", label: "New Macro", attrs: { "data-macro-new": true, "data-loom-view-panel": "macros", hidden: true } },
  {
    action: "save",
    label: "Save Macro",
    disabled: true,
    attrs: { "data-macro-save": true, "data-loom-view-panel": "macros", hidden: true },
  },
  {
    action: "duplicate",
    label: "Duplicate Macro",
    disabled: true,
    attrs: { "data-macro-duplicate": true, "data-loom-view-panel": "macros", hidden: true },
  },
  {
    action: "delete",
    label: "Delete Macro",
    disabled: true,
    attrs: { "data-macro-delete": true, "data-loom-view-panel": "macros", hidden: true },
  },
]).forEach((button) => document.querySelector("[data-loom-toolbar-mount]")?.appendChild(button));
// No New here (unlike System/Macro) — a blank Feature would be missing
// name/description/mechanics, which this tab doesn't author (that's the
// Library tab's job). Duplicate still makes sense on an existing Feature.
createToolbarButtonGroup([
  {
    action: "save",
    label: "Save Feature",
    disabled: true,
    attrs: { "data-feature-save": true, "data-loom-view-panel": "features", hidden: true },
  },
  {
    action: "duplicate",
    label: "Duplicate Feature",
    disabled: true,
    attrs: { "data-feature-duplicate": true, "data-loom-view-panel": "features", hidden: true },
  },
  {
    action: "delete",
    label: "Delete Feature",
    disabled: true,
    attrs: { "data-feature-delete": true, "data-loom-view-panel": "features", hidden: true },
  },
]).forEach((button) => document.querySelector("[data-loom-toolbar-mount]")?.appendChild(button));
createToolbarButtonGroup([
  {
    action: "new",
    icon: "tabler:user-plus",
    label: "New User",
    attrs: { "data-loom-user-new": true, "data-loom-view-panel": "users", hidden: true },
  },
  {
    action: "save",
    label: "Save User",
    disabled: true,
    attrs: { "data-loom-user-save": true, "data-loom-view-panel": "users", hidden: true },
  },
  {
    action: "duplicate",
    label: "Duplicate User",
    disabled: true,
    attrs: { "data-loom-user-duplicate": true, "data-loom-view-panel": "users", hidden: true },
  },
  {
    action: "delete",
    label: "Delete User",
    disabled: true,
    attrs: { "data-loom-user-delete": true, "data-loom-view-panel": "users", hidden: true },
  },
]).forEach((button) => document.querySelector("[data-loom-toolbar-mount]")?.appendChild(button));
createToolbarButtonGroup([
  {
    action: "new",
    icon: "tabler:folder-plus",
    label: "New Group",
    attrs: { "data-loom-group-new": true, "data-loom-view-panel": "groups", hidden: true },
  },
  {
    action: "save",
    label: "Save Group",
    disabled: true,
    attrs: { "data-loom-group-save": true, "data-loom-view-panel": "groups", hidden: true },
  },
  {
    action: "duplicate",
    label: "Duplicate Group",
    disabled: true,
    attrs: { "data-loom-group-duplicate": true, "data-loom-view-panel": "groups", hidden: true },
  },
  {
    action: "delete",
    label: "Delete Group",
    disabled: true,
    attrs: { "data-loom-group-delete": true, "data-loom-view-panel": "groups", hidden: true },
  },
]).forEach((button) => document.querySelector("[data-loom-toolbar-mount]")?.appendChild(button));
// Undo/Redo get their own group since they're shared across every tab (no
// data-loom-view-panel attr, always visible) — same convention every other
// tool's toolbar uses.
createToolbarButtonGroup([
  { action: "undo", label: "Undo", attrs: { "data-action": "undo-mapping" } },
  { action: "redo", label: "Redo", attrs: { "data-action": "redo-mapping" } },
]).forEach((button) => document.querySelector("[data-loom-undo-toolbar-mount]")?.appendChild(button));

// Small inline compact icon buttons, not part of the toolbar cluster above;
// `p-1` className matches the original markup's padding exactly.
document.querySelector("[data-system-add-property-mount]")?.appendChild(
  createIconButton({
    icon: "tabler:plus",
    label: "Add Property",
    className: "p-1",
    attrs: { "data-system-add-property": true },
  })
);
document.querySelector("[data-macro-add-action-mount]")?.appendChild(
  createIconButton({
    icon: "tabler:plus",
    label: "Add Action",
    className: "p-1",
    attrs: { "data-macro-add-action": true },
  })
);
document.querySelector("[data-feature-add-tier-mount]")?.appendChild(
  createIconButton({
    icon: "tabler:plus",
    label: "Add Tier",
    className: "p-1",
    attrs: { "data-feature-add-tier": true },
  })
);
document.querySelector("[data-loom-group-add-property-mount]")?.appendChild(
  createIconButton({
    icon: "tabler:plus",
    label: "Add Property",
    className: "p-1",
    attrs: { "data-loom-group-add-property": true },
  })
);
const loomGroupAddPropertyButton = document.querySelector("[data-loom-group-add-property]");

// Property Inspector toolbar (right pane) — built via createIconButton
// directly, not createToolbarButtonGroup: needs top tooltip placement (right
// pane, not bottom) and Required is a real pressed/unpressed toggle, not a
// fire-once action.
const propertyInspectorToolbarMount = document.querySelector("[data-property-inspector-toolbar-mount]");
if (propertyInspectorToolbarMount) {
  propertyInspectorToolbarMount.append(
    createIconButton({
      icon: "tabler:file-plus",
      label: "New Property",
      variant: "outline-primary",
      kind: "toolbar",
      tooltipPlacement: "top",
      attrs: { "data-system-inspector-new": true },
    }),
    createIconButton({
      icon: "tabler:trash",
      label: "Delete Property",
      variant: "outline-danger",
      kind: "toolbar",
      tooltipPlacement: "top",
      attrs: { "data-system-inspector-delete": true },
    }),
    createIconButton({
      icon: "tabler:copy",
      label: "Duplicate Property",
      variant: "outline-secondary",
      kind: "toolbar",
      tooltipPlacement: "top",
      attrs: { "data-system-inspector-duplicate": true },
    }),
    createIconButton({
      icon: "tabler:asterisk",
      label: "Mark as Required",
      variant: "outline-secondary",
      kind: "toolbar",
      tooltipPlacement: "top",
      attrs: { "data-system-inspector-required": true, "aria-pressed": "false" },
    })
  );
}

// Group's own Property Inspector toolbar (right pane) — same shape as
// Systems' above, scoped to Group Properties.
const groupPropertyInspectorToolbarMount = document.querySelector(
  "[data-loom-group-property-inspector-toolbar-mount]"
);
if (groupPropertyInspectorToolbarMount) {
  groupPropertyInspectorToolbarMount.append(
    createIconButton({
      icon: "tabler:file-plus",
      label: "New Property",
      variant: "outline-primary",
      kind: "toolbar",
      tooltipPlacement: "top",
      attrs: { "data-loom-group-inspector-new": true },
    }),
    createIconButton({
      icon: "tabler:trash",
      label: "Delete Property",
      variant: "outline-danger",
      kind: "toolbar",
      tooltipPlacement: "top",
      attrs: { "data-loom-group-inspector-delete": true },
    }),
    createIconButton({
      icon: "tabler:copy",
      label: "Duplicate Property",
      variant: "outline-secondary",
      kind: "toolbar",
      tooltipPlacement: "top",
      attrs: { "data-loom-group-inspector-duplicate": true },
    }),
    createIconButton({
      icon: "tabler:asterisk",
      label: "Mark as Required",
      variant: "outline-secondary",
      kind: "toolbar",
      tooltipPlacement: "top",
      attrs: { "data-loom-group-inspector-required": true, "aria-pressed": "false" },
    })
  );
}

// replaceWith, not appendChild (see press/js/app.js's mountInspectorField):
// an appended-into wrapper stays an empty flex item when its field is
// hidden, silently spending a gap-3. The mount's own classes are merged
// onto the built field first so the layout survives removal.
function mountField(key, element) {
  const mount = document.querySelector(`[data-field-mount="${key}"]`);
  if (!mount) return;
  if (mount.className) element.classList.add(...mount.classList);
  mount.replaceWith(element);
}
mountField("mapping-select", createCompactField({ type: "select", id: "loomMappingSelect", label: "Mapping", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-mapping-select" }));

const mappingSelect = document.querySelector("[data-mapping-select]");
// Adopts each section's existing static `[data-xxx-panel]` markup as content
// (only the header+chevron wrapper is JS-built). Selection/Mapping
// Tree/Entities/Data start expanded, matching their original markup.
const mappingsSection = createCollapsibleSection({
  label: "Selections",
  collapsed: false,
  content: document.querySelector("[data-mappings-panel]"),
});
document.querySelector("[data-mappings-mount]")?.appendChild(mappingsSection.section);

// Same "Selections" collapsible convention as every other tab. Each keeps
// its own tab-specific helpTopic so the explanatory content that used to
// live in a static heading stays reachable.
[
  ["systems", "loom.systems"],
  ["macros", "loom.macros"],
  ["features", "loom.features"],
  ["library", "loom.libraryTable"],
  ["users", "accounts.roles"],
  ["groups", "campaign.groups"],
].forEach(([tab, helpTopic]) => {
  const section = createCollapsibleSection({
    label: "Selections",
    helpTopic,
    collapsed: false,
    content: document.querySelector(`[data-${tab}-selections-panel]`),
  });
  document.querySelector(`[data-${tab}-selections-mount]`)?.appendChild(section.section);
});
const nodePalette = document.querySelector("[data-node-palette]");
const stepPaletteSection = document.querySelector("[data-step-palette-section]");
const stepPalette = document.querySelector("[data-step-palette]");
const sampleDataInput = document.querySelector("[data-sample-data-input]");
const sampleDataApplyButton = document.querySelector("[data-sample-data-apply]");
const sourceSelect = document.querySelector("[data-source-select]");
// A categorization tag on the mapping ($dataType) — never locks (unlike
// sourceSelect) and doesn't affect Fetch; controls which mappings
// Workbench's player-facing Import Character flow offers.
const dataTypeSelect = document.querySelector("[data-data-type-select]");
// Friendly name shown instead of the mapping's raw id in Workbench's Import
// Character picker (content-fetch.js's listCharacterMappings) — stamped at
// save time like dataTypeSelect above.
const mappingDescriptionInput = document.querySelector("[data-mapping-description]");
const sourceValueInput = document.querySelector("[data-source-value]");
// Shown instead of sourceValueInput only for a source flagged `file: true`
// (SOURCES, content-fetch.js) — currently just Fantasy Statblocks' markdown
// upload.
const sourceFileInput = document.querySelector("[data-source-file]");
const sourceValueLabelRow = document.querySelector("[data-source-value-label-row]");
const sourceFetchButton = document.querySelector("[data-source-fetch]");
const sourceFetchStatus = document.querySelector("[data-source-fetch-status]");
// Folder-picker for Fantasy Statblocks bulk import — can't reuse the
// `multiple` sourceFileInput since `webkitdirectory` forces folder-only mode
// on whichever input has it.
const sourceBulkFolderInput = document.querySelector("[data-source-bulk-folder]");
const sourceBulkFolderButton = document.querySelector("[data-source-bulk-folder-button]");
const bulkImportCard = document.querySelector("[data-bulk-import-card]");
const bulkSummary = document.querySelector("[data-bulk-summary]");
const bulkChecklist = document.querySelector("[data-bulk-checklist]");
const bulkSelectAllButton = document.querySelector("[data-bulk-select-all]");
const bulkSelectNoneButton = document.querySelector("[data-bulk-select-none]");
const bulkImportSelectedButton = document.querySelector("[data-bulk-import-selected]");
const bulkProgress = document.querySelector("[data-bulk-progress]");
const entitiesSummary = document.querySelector("[data-entities-summary]");
const entitiesList = document.querySelector("[data-entities-list]");
const entitiesSaveAllButton = document.querySelector("[data-entities-save-all]");
const entitiesSaveAllProgress = document.querySelector("[data-entities-save-all-progress]");
// Entities and Data (io) need programmatic re-collapse later (enterMappingMode's
// workflow-mode logic) — their setCollapsed is captured for that, same as
// treeSetCollapsed below.
const entitiesSection = createCollapsibleSection({
  label: "Entities",
  collapsed: false,
  content: document.querySelector("[data-entities-panel]"),
});
document.querySelector("[data-entities-mount]")?.appendChild(entitiesSection.section);
const entitiesSetCollapsed = entitiesSection.setCollapsed;
const ioSection = createCollapsibleSection({
  label: "Data",
  collapsed: false,
  content: document.querySelector("[data-io-panel]"),
});
document.querySelector("[data-io-mount]")?.appendChild(ioSection.section);
const ioSetCollapsed = ioSection.setCollapsed;
// Builds a chevron toggle only, for a header whose label/Refresh button stay
// static HTML — createCollapsibleSection isn't used since it would rebuild
// the whole header (see Orrery's identical helper).
function createCollapsibleToggleButton(mountSelector, collapsed) {
  const button = createIconButton({
    icon: "tabler:chevron-right",
    className: "collapsible-toggle",
    includeToggleLabel: true,
  });
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  document.querySelector(mountSelector)?.appendChild(button);
  return button;
}

const recentSavesContainer = document.querySelector("[data-recent-saves]");
const recentSavesRefreshButton = document.querySelector("[data-recent-saves-refresh]");
const recentSavesToggle = createCollapsibleToggleButton("[data-recent-saves-toggle-mount]", true);
const recentSavesPanel = document.querySelector("[data-recent-saves-panel]");
const treeContainer = document.querySelector("[data-mapping-tree]");
// Mapping Tree needs programmatic re-collapse later (enterMappingMode) — its
// setCollapsed is captured, same as entitiesSetCollapsed/ioSetCollapsed above.
const treeSection = createCollapsibleSection({
  label: "Mapping Tree",
  collapsed: false,
  content: document.querySelector("[data-mapping-tree-panel]"),
});
document.querySelector("[data-mapping-tree-mount]")?.appendChild(treeSection.section);
const treeSetCollapsed = treeSection.setCollapsed;
const inspectorContainer = document.querySelector("[data-inspector]");
const rawPreviewEl = document.querySelector("[data-raw-preview]");
const mappedPreviewEl = document.querySelector("[data-mapped-preview]");
const undoButton = document.querySelector('[data-action="undo-mapping"]');
const redoButton = document.querySelector('[data-action="redo-mapping"]');
const newButton = document.querySelector('[data-action="new-mapping"]');
const saveButton = document.querySelector('[data-action="save-mapping"]');
const renameButton = document.querySelector('[data-action="rename-mapping"]');

// --- Library / Systems DOM refs ---------------------------------------------

mountField("library-id", createCompactField({ type: "text", id: "loomLibraryId", label: "Id", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-library-id", disabled: true }));
mountField(
  "library-template-select",
  createCompactField({
    type: "select", id: "loomLibraryTemplate", label: "Assigned Template", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-library-template-select", helpTopic: "loom.libraryTemplate",
  })
);
mountField(
  "library-json",
  createCompactField({
    type: "textarea", id: "loomLibraryJson", label: "Entity JSON", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control form-control-sm font-monospace",
    dataAttr: "data-library-json", rows: 20, spellcheck: "false",
  })
);
mountField("system-id", createCompactField({ type: "text", id: "loomSystemId", label: "Id", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-system-id", disabled: true }));
mountField("system-title", createCompactField({ type: "text", id: "loomSystemTitle", label: "Title", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-system-title" }));
mountField("system-version", createCompactField({ type: "text", id: "loomSystemVersion", label: "Version", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-system-version" }));

const libraryIdInput = document.querySelector("[data-library-id]");
// Same collapsible pattern as Selection/Entities/Data/Mapping Tree above —
// adopts its pre-existing static list div as content.
const librarySystemList = document.querySelector("[data-library-system-list]");
const librarySystemSection = createCollapsibleSection({
  label: "Assigned Systems",
  collapsed: true,
  content: librarySystemList,
}).section;
document.querySelector("[data-library-system-mount]")?.appendChild(librarySystemSection);
const librarySettingList = document.querySelector("[data-library-setting-list]");
const librarySettingSection = createCollapsibleSection({
  label: "Assigned Settings",
  collapsed: true,
  content: librarySettingList,
}).section;
document.querySelector("[data-library-setting-mount]")?.appendChild(librarySettingSection);
const libraryTemplateSection = document.querySelector("[data-library-template-section]");
const libraryTemplateSelect = document.querySelector("[data-library-template-select]");
const libraryJsonTextarea = document.querySelector("[data-library-json]");
const libraryJsonError = document.querySelector("[data-library-json-error]");
const libraryContentNudge = document.querySelector("[data-library-content-nudge]");
const libraryNewButton = document.querySelector("[data-library-new]");
const librarySaveButton = document.querySelector("[data-library-save]");
const libraryDuplicateButton = document.querySelector("[data-library-duplicate]");
const libraryDeleteButton = document.querySelector("[data-library-delete]");
// Same "Select a ..." gating as Systems/Macros above.
const libraryEmpty = document.querySelector("[data-library-empty]");
const libraryPanel = document.querySelector("[data-library-panel]");
function setLibraryFormVisible(visible) {
  if (libraryEmpty) libraryEmpty.hidden = visible;
  if (libraryPanel) libraryPanel.classList.toggle("d-none", !visible);
}

mountField("system-select", createCompactField({ type: "select", id: "loomSystemSelect", label: "System", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-system-select" }));

const systemSelect = document.querySelector("[data-system-select]");
const systemIdInput = document.querySelector("[data-system-id]");
const systemTitleInput = document.querySelector("[data-system-title]");
const systemVersionInput = document.querySelector("[data-system-version]");
const systemPropertyRows = document.querySelector("[data-system-property-rows]");
// Reserved-key properties (buildSteps, derivedFormulas, fieldRoles, ...)
// render into their own group, above the ordinary Properties list, so a
// System-specific field and a suite-read-by-name one are never visually
// indistinguishable — see isReservedFieldKey/renderSystemFieldIntoGroups
// below. Kicked off now (not awaited) so the classification schema is
// already resolved by the time a System is actually loaded.
void loadReservedKeysSchema();
const systemReservedPropertyRows = document.querySelector("[data-system-reserved-property-rows]");
const systemReservedPropertiesSection = document.querySelector("[data-system-reserved-properties-section]");
const systemPropertiesWrapper = document.querySelector("[data-system-properties-wrapper]");
const systemNewButton = document.querySelector("[data-system-new]");
const systemSaveButton = document.querySelector("[data-system-save]");
const systemDuplicateButton = document.querySelector("[data-system-duplicate]");
const systemDeleteButton = document.querySelector("[data-system-delete]");
const systemAddPropertyButton = document.querySelector("[data-system-add-property]");
// Gated behind a "Select a system..." message, same convention as
// Groups/Users — hidden until a system is loaded or New is clicked, not
// shown just because a blank draft exists underneath.
const systemsEmpty = document.querySelector("[data-systems-empty]");
const systemsPanel = document.querySelector("[data-systems-panel]");
function setSystemFormVisible(visible) {
  if (systemsEmpty) systemsEmpty.hidden = visible;
  if (systemsPanel) systemsPanel.classList.toggle("d-none", !visible);
}
// Read-only live "whole record as it'll be saved" view (buildSystemPayload/
// renderSystemJsonPreview below), built via the shared ui-components.js
// factory instead of hand-written markup.
const systemJsonPanelInstance = createJsonDataPanel({
  label: "JSON Data",
  helpTopic: "loom.systemJsonPreview",
  getData: () => buildSystemPayload(),
  onExport: () => {
    const payload = buildSystemPayload();
    const id = (systemIdInput?.value || "").trim() || "system";
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  },
});
document.querySelector("[data-system-json-mount]")?.appendChild(systemJsonPanelInstance.section);
// Property Inspector (right pane) — a more spacious way to edit the selected
// Properties-list row, not a replacement for it: every field here proxies
// that row's own real input (createPropertyInspector,
// property-schema-editor.js), so either place edits the same thing.
const systemInspectorEmpty = document.querySelector("[data-system-inspector-empty]");
const systemInspectorDetails = document.querySelector("[data-system-inspector-details]");
const systemInspectorFields = document.querySelector("[data-system-inspector-fields]");
const systemInspectorNewButton = document.querySelector("[data-system-inspector-new]");
const systemInspectorDeleteButton = document.querySelector("[data-system-inspector-delete]");
const systemInspectorDuplicateButton = document.querySelector("[data-system-inspector-duplicate]");
const systemInspectorRequiredButton = document.querySelector("[data-system-inspector-required]");
// Collapsible, same convention as every other Loom section (see Group
// Property Inspector below). Expanded by default — unlike Assigned
// Systems/Settings, this was never collapsed before, so nothing changes for
// existing users.
const systemInspectorContent = document.querySelector("[data-system-inspector-content]");
const systemInspectorSection = createCollapsibleSection({
  label: "Property Inspector",
  collapsed: false,
  content: systemInspectorContent,
}).section;
document.querySelector("[data-system-inspector-mount]")?.appendChild(systemInspectorSection);

// Reserved Key Diagnostics — validates the currently-loaded System's own
// buildSteps/levelUpBindings/derivedFormulas/dice/rolls/decks/currency/
// inventory/travelMeans/levels/casterTypes/fieldRoles against
// common/data/reserved-keys.json (system-validation.js). Non-blocking: a
// wrong shape here is a real bug worth surfacing, but never something that
// stops a save. Collapsed by default — most saves have nothing to report.
const systemDiagnosticsList = document.createElement("div");
systemDiagnosticsList.className = "d-flex flex-column gap-2 small";
systemDiagnosticsList.textContent = "Not checked yet.";
async function runSystemDiagnostics({ silent = false } = {}) {
  const findings = await validateSystemFields(buildSystemPayload().fields);
  systemDiagnosticsList.innerHTML = "";
  if (!findings.length) {
    const ok = document.createElement("p");
    ok.className = "text-body-secondary mb-0";
    ok.textContent = "No issues found.";
    systemDiagnosticsList.appendChild(ok);
  } else {
    findings.forEach((finding) => {
      const row = document.createElement("div");
      row.className = "alert alert-warning py-1 px-2 mb-0";
      row.textContent = finding.message;
      systemDiagnosticsList.appendChild(row);
    });
    if (!silent) {
      status?.show(`Reserved Key Diagnostics found ${findings.length} issue${findings.length === 1 ? "" : "s"}.`, {
        type: "warning",
        timeout: 4000,
      });
    }
  }
  // A refresh (manual "Check now", or the fire-and-forget post-save check)
  // is worth surfacing on its own — expand rather than leave a fresh result
  // sitting behind a collapsed toggle the user has to know to open.
  setSystemDiagnosticsCollapsed(false);
  return findings;
}
const { section: systemDiagnosticsSection, setCollapsed: setSystemDiagnosticsCollapsed } = createCollapsibleSection({
  label: "Reserved Key Diagnostics",
  collapsed: true,
  actions: [{ icon: "tabler:refresh", label: "Check now", onClick: () => runSystemDiagnostics() }],
  content: systemDiagnosticsList,
});
document.querySelector("[data-system-diagnostics-mount]")?.appendChild(systemDiagnosticsSection);

// Reserved Bindings Checklist — walks the currently-loaded System's actual
// bindings (fieldRoles/combatBindings/derivedFormulas/levelUpBindings)
// against reserved-keys.json's own `bindings` registry, so a missing
// "once"-scoped binding (or an "unlimited"/"perKind" one nothing declares
// yet) is visible in Loom's own System editor for the first time, instead of
// only surfacing later as a thin/degraded generator result. Purely
// informational — a System is never required to use every binding a
// consumer knows about (Daggerheart has no "modifier"-role combatBinding at
// all, by design). Collapsed by default, same as Diagnostics.
function resolveBindingsField(fields, key) {
  if (key !== "combatBindings") return fieldByKey(fields, key);
  // combatBindings has no fixed key of its own — it's whichever field a
  // fieldRoles entry points at (binding "combatBindings"), same lookup
  // findRoleBoundField (bindings.js) does at runtime.
  const fieldRolesField = fieldByKey(fields, "fieldRoles");
  const entry = (Array.isArray(fieldRolesField?.values) ? fieldRolesField.values : []).find(
    (candidate) => candidate?.binding === "combatBindings"
  );
  return entry?.sourceField ? fieldByKey(fields, entry.sourceField) : null;
}
async function renderSystemBindingsChecklist() {
  systemBindingsChecklistList.innerHTML = "";
  const fields = buildSystemPayload().fields;
  const schema = await loadReservedKeysSchema();
  const sections = Object.entries(schema.bindings || {});
  let anyContent = false;
  sections.forEach(([key, bindingList]) => {
    if (!bindingList?.length) return;
    const field = resolveBindingsField(fields, key);
    const values = Array.isArray(field?.values) ? field.values : [];
    const rows = bindingList.map((entry) => {
      const matches = values.filter((value) => value?.binding === entry.name);
      let statusText;
      let ok;
      if (entry.scope === "perKind") {
        const kinds = [...new Set(matches.map((value) => value.libraryKind).filter(Boolean))];
        ok = kinds.length > 0;
        statusText = ok ? `Declared for: ${kinds.join(", ")}` : "Not declared";
      } else if (entry.scope === "once") {
        ok = matches.length > 0;
        statusText = matches.length > 1 ? `Declared ${matches.length}x (should be once)` : ok ? "Declared" : "Missing";
      } else {
        ok = matches.length > 0;
        statusText = ok ? `Declared (${matches.length}x)` : "Not declared";
      }
      return { name: entry.name, description: entry.description || "", ok, statusText, tooManyOnce: entry.scope === "once" && matches.length > 1 };
    });
    if (!field) {
      const row = document.createElement("div");
      row.className = "small text-body-secondary";
      row.textContent = `${key} — no field declared for this yet.`;
      systemBindingsChecklistList.appendChild(row);
      anyContent = true;
      return;
    }
    anyContent = true;
    const group = document.createElement("div");
    group.className = "d-flex flex-column gap-1";
    const heading = document.createElement("div");
    heading.className = "small fw-semibold text-body-secondary";
    heading.textContent = key;
    group.appendChild(heading);
    rows.forEach((row) => {
      const line = document.createElement("div");
      line.className = `small d-flex align-items-center gap-2 ${row.tooManyOnce ? "text-warning" : row.ok ? "" : "text-body-secondary"}`;
      const icon = document.createElement("span");
      icon.className = "iconify flex-shrink-0";
      icon.dataset.icon = row.tooManyOnce ? "tabler:alert-triangle" : row.ok ? "tabler:circle-check" : "tabler:circle-dashed";
      icon.setAttribute("aria-hidden", "true");
      line.appendChild(icon);
      const label = document.createElement("span");
      label.textContent = `${row.name} — ${row.statusText}`;
      if (row.description) label.title = row.description;
      line.appendChild(label);
      group.appendChild(line);
    });
    systemBindingsChecklistList.appendChild(group);
  });
  if (!anyContent) {
    const empty = document.createElement("p");
    empty.className = "text-body-secondary mb-0 small";
    empty.textContent = "This System declares no reserved keys with a bindings vocabulary yet.";
    systemBindingsChecklistList.appendChild(empty);
  }
  // Same reasoning as runSystemDiagnostics above — a refresh should surface
  // itself, not sit behind a collapsed toggle.
  setSystemBindingsChecklistCollapsed(false);
}
const systemBindingsChecklistList = document.createElement("div");
systemBindingsChecklistList.className = "d-flex flex-column gap-3 small";
systemBindingsChecklistList.textContent = "Not checked yet.";
const { section: systemBindingsChecklistSection, setCollapsed: setSystemBindingsChecklistCollapsed } = createCollapsibleSection({
  label: "Reserved Bindings Checklist",
  collapsed: true,
  actions: [{ icon: "tabler:refresh", label: "Check now", onClick: () => renderSystemBindingsChecklist() }],
  content: systemBindingsChecklistList,
});
document.querySelector("[data-system-bindings-checklist-mount]")?.appendChild(systemBindingsChecklistSection);

// Selecting a different System (or starting a new one) invalidates whatever
// the checklists above last showed — it described the PREVIOUS System's
// fields, not this one's. Cleared back to each panel's own pristine
// "Not checked yet." state (see newSystemEditor/loadSystemIntoEditor below)
// rather than left showing stale, now-mismatched results.
function resetSystemReservedChecks() {
  systemDiagnosticsList.innerHTML = "";
  systemDiagnosticsList.textContent = "Not checked yet.";
  setSystemDiagnosticsCollapsed(true);
  systemBindingsChecklistList.innerHTML = "";
  systemBindingsChecklistList.textContent = "Not checked yet.";
  setSystemBindingsChecklistCollapsed(true);
}

// Macros tab — its own dedicated authoring UI (mirrors Systems: select +
// New/Save/Delete), not bolted onto the generic Library JSON editor. The
// Library tab can still edit a "macro" entity as raw JSON, same relationship
// Systems has to its own kind.
mountField("macro-select", createCompactField({ type: "select", id: "loomMacroSelect", label: "Macro", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-macro-select" }));
mountField("macro-id", createCompactField({ type: "text", id: "loomMacroId", label: "Id", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-macro-id", disabled: true }));
mountField("macro-name", createCompactField({ type: "text", id: "loomMacroName", label: "Name", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-macro-name" }));
mountField("macro-icon", createCompactField({ type: "text", id: "loomMacroIcon", label: "Icon", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-macro-icon", placeholder: "tabler:bolt" }));

const macroRecordSelect = document.querySelector("[data-macro-select]");
const macroIdInput = document.querySelector("[data-macro-id]");
const macroNameInput = document.querySelector("[data-macro-name]");
const macroIconInput = document.querySelector("[data-macro-icon]");
const macroActionsList = document.querySelector("[data-macro-actions]");
const macroAddActionButton = document.querySelector("[data-macro-add-action]");
const macroNewButton = document.querySelector("[data-macro-new]");
const macroSaveButton = document.querySelector("[data-macro-save]");
const macroDuplicateButton = document.querySelector("[data-macro-duplicate]");
const macroDeleteButton = document.querySelector("[data-macro-delete]");
// Same "Select a ..." gating as Systems above.
const macrosEmpty = document.querySelector("[data-macros-empty]");
const macrosPanel = document.querySelector("[data-macros-panel]");
function setMacroFormVisible(visible) {
  if (macrosEmpty) macrosEmpty.hidden = visible;
  if (macrosPanel) macrosPanel.classList.toggle("d-none", !visible);
}

// The set of function names never depends on which lookup tables the
// factory closes over — an empty stand-in is enough just to enumerate them.
const CUSTOM_FUNCTION_NAMES = Object.keys(createMappingCustomFunctions({}));
// PROPERTY_TYPES and the Properties row editor (type-cycling, drag-to-reorder,
// nested fields, value lists) live in property-schema-editor.js, shared with
// Group Properties below.

let mappingDefinition = null;
let selectedNode = null;
let sampleData = {};
let currentMappingId = null;
let isApplyingHistory = false;
let dataManager = null;
// D&D 5e's lookup tables/custom functions for the live mapping preview —
// derived at runtime from sys.dnd5e's own fields via deriveLookupTables
// (system-lookup-tables.js), fetched once at startup since runLivePreview
// reads this synchronously. Defaults empty so the Mapping tab still works
// before the fetch resolves; only `lookup()` calls resolve blank until then.
let ddbLookupContext = { lookupTables: {}, customFunctions: createMappingCustomFunctions({}) };
let shareModal = null;
let undoStack = null;
let status = null;
let lastMappedResult = null;

// --- Undo/redo -------------------------------------------------------------
// One shared undo stack across every tab — the toolbar's Undo/Redo pair is
// always visible and dispatches by each entry's `type` to the matching tab's
// create/apply-snapshot pair. Whole-form JSON snapshots per domain (mirrors
// press/js/app.js's recordUndoableChange): cheap at this scale, and avoids
// tracking stable node/row identity across undo/redo. The per-tab
// create/apply functions are declared further down — works via `function`
// hoisting.
const SNAPSHOT_HANDLERS = {
  mapping: { create: createMappingSnapshot, apply: applyMappingSnapshot },
  library: { create: createLibrarySnapshot, apply: applyLibrarySnapshot },
  system: { create: createSystemSnapshot, apply: applySystemSnapshot },
  macro: { create: createMacroSnapshot, apply: applyMacroSnapshot },
  feature: { create: createFeatureSnapshot, apply: applyFeatureSnapshot },
};

// --- Save/Rename/Delete gating -----------------------------------------
// "Clean" baseline per tab reuses undo/redo's own snapshot functions, so
// dirty-checking needs no parallel tracking. Save lights up once state
// differs from that baseline; Rename/Delete only need a real loaded item.
const cleanSnapshots = { mapping: null, library: null, system: null, macro: null, feature: null };

// No-op placeholder, reassigned once real DOM/state is ready
// (buildSystemPayload below) — lets updateToolbarState call it
// unconditionally without a temporal-dead-zone error.
let renderSystemJsonPreview = () => {};

function markClean(type) {
  const handler = SNAPSHOT_HANDLERS[type];
  if (handler) cleanSnapshots[type] = handler.create();
  updateToolbarState();
}

function isDirty(type) {
  const handler = SNAPSHOT_HANDLERS[type];
  if (!handler || cleanSnapshots[type] === null) return false;
  return !snapshotsEqual(cleanSnapshots[type], handler.create());
}

function canSaveMapping() {
  return Boolean(mappingDefinition) && isDirty("mapping");
}

function canRenameMapping() {
  return Boolean(currentMappingId);
}

function canSaveLibrary() {
  const kind = loomLibraryTableState.activeKind;
  const id = (libraryIdInput?.value || "").trim();
  return Boolean(kind && id && currentLibraryEntity()) && isDirty("library");
}

function canDeleteLibrary() {
  if (!loomLibraryTableState.selectedKey) return false;
  const id = (libraryIdInput?.value || "").trim();
  return libraryEntryAllowsDelete(loomLibraryTableState.activeKind, id);
}

// Same "real id typed" gate as canDuplicateSystem, minus isDirty —
// duplicating an unmodified saved entity is just as valid as a mid-edit one.
function canDuplicateLibrary() {
  return Boolean(loomLibraryTableState.activeKind && (libraryIdInput?.value || "").trim() && currentLibraryEntity());
}

function canSaveSystem() {
  return Boolean((systemIdInput?.value || "").trim()) && isDirty("system");
}

function canDeleteSystem() {
  return systemAllowsDelete(systemSelect?.value);
}

// Same "real id typed" check Save uses, minus isDirty — duplicating an
// unmodified saved System is just as valid as a mid-edit one.
function canDuplicateSystem() {
  return Boolean((systemIdInput?.value || "").trim());
}

function canSaveMacro() {
  return Boolean((macroIdInput?.value || "").trim()) && isDirty("macro");
}

function canDeleteMacro() {
  const id = (macroIdInput?.value || "").trim() || macroRecordSelect?.value;
  return libraryEntryAllowsDelete("macro", id);
}

// Same "real id typed" gate as canDuplicateSystem/canDuplicateLibrary.
function canDuplicateMacro() {
  return Boolean((macroIdInput?.value || "").trim());
}

// Surfaces *why* Save is disabled for broken JSON — canSaveLibrary()
// silently requires valid JSON, but a disabled button alone can't
// distinguish "invalid JSON" from "nothing changed". Blank/untouched
// textarea is treated as neutral, not an error.
function updateLibraryJsonFeedback() {
  if (!libraryJsonTextarea) return;
  const raw = libraryJsonTextarea.value || "";
  let message = "";
  if (raw.trim()) {
    try {
      JSON.parse(raw);
    } catch (error) {
      message = `Invalid JSON: ${error.message}`;
    }
  }
  libraryJsonTextarea.classList.toggle("is-invalid", Boolean(message));
  if (libraryJsonError) {
    libraryJsonError.textContent = message;
    libraryJsonError.classList.toggle("d-none", !message);
  }
}

function updateToolbarState() {
  if (saveButton) saveButton.disabled = !canSaveMapping();
  if (renameButton) renameButton.disabled = !canRenameMapping();
  updateLibraryJsonFeedback();
  if (librarySaveButton) librarySaveButton.disabled = !canSaveLibrary();
  if (libraryDuplicateButton) libraryDuplicateButton.disabled = !canDuplicateLibrary();
  if (libraryDeleteButton) libraryDeleteButton.disabled = !canDeleteLibrary();
  if (systemSaveButton) systemSaveButton.disabled = !canSaveSystem();
  if (systemDuplicateButton) systemDuplicateButton.disabled = !canDuplicateSystem();
  if (systemDeleteButton) systemDeleteButton.disabled = !canDeleteSystem();
  if (macroSaveButton) macroSaveButton.disabled = !canSaveMacro();
  if (macroDuplicateButton) macroDuplicateButton.disabled = !canDuplicateMacro();
  if (macroDeleteButton) macroDeleteButton.disabled = !canDeleteMacro();
  updateFeatureEligibilityNote();
  if (featureSaveButton) featureSaveButton.disabled = !canSaveFeature();
  if (featureDuplicateButton) featureDuplicateButton.disabled = !canDuplicateFeature();
  if (featureDeleteButton) featureDeleteButton.disabled = !canDeleteFeature();
  renderSystemJsonPreview();
}

function createMappingSnapshot() {
  return { mappingDefinition: mappingDefinition ? JSON.parse(JSON.stringify(mappingDefinition)) : null };
}

function applyMappingSnapshot(snapshot) {
  mappingDefinition = snapshot?.mappingDefinition ? JSON.parse(JSON.stringify(snapshot.mappingDefinition)) : null;
  selectedNode = null;
  enterMappingMode(mappingDefinition);
  rerenderAll();
}

function snapshotsEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (error) {
    return false;
  }
}

function recordUndoableChange(type, action) {
  if (typeof action !== "function") return;
  const handler = SNAPSHOT_HANDLERS[type];
  if (isApplyingHistory || !undoStack || !handler) {
    action();
    updateToolbarState();
    return;
  }
  const before = handler.create();
  action();
  const after = handler.create();
  if (!snapshotsEqual(before, after)) {
    undoStack.push({ type, before, after });
  }
  updateToolbarState();
}

// Free-text/number/select fields can't wrap in recordUndoableChange like a
// button click — the field's already mutated by the time any listener
// fires. Instead this snapshots on focus-in and commits on `change`
// (blur/Enter, not per keystroke — one undo step per edit). `container` may
// be the field itself, or a row-holding container with `selector` naming
// which descendants count.
const pendingFieldUndoSnapshots = {};

function wireUndoTracking(container, type, { selector = null } = {}) {
  if (!container) return;
  const matchesTarget = (target) => (selector ? Boolean(target.closest(selector)) : target === container);
  container.addEventListener("focusin", (event) => {
    if (!matchesTarget(event.target)) return;
    const handler = SNAPSHOT_HANDLERS[type];
    if (isApplyingHistory || !undoStack || !handler) return;
    pendingFieldUndoSnapshots[type] = handler.create();
  });
  // Live on every keystroke — Save should light up as soon as content
  // differs, not only once the field loses focus (that's just when an undo
  // step commits).
  container.addEventListener("input", (event) => {
    if (!matchesTarget(event.target)) return;
    updateToolbarState();
  });
  container.addEventListener("change", (event) => {
    if (!matchesTarget(event.target)) return;
    const handler = SNAPSHOT_HANDLERS[type];
    if (isApplyingHistory || !undoStack || !handler) return;
    const before = pendingFieldUndoSnapshots[type];
    delete pendingFieldUndoSnapshots[type];
    if (before === undefined) return;
    const after = handler.create();
    if (!snapshotsEqual(before, after)) {
      undoStack.push({ type, before, after });
    }
    updateToolbarState();
  });
}

// --- Node / step factories -------------------------------------------------

function createNode(type) {
  switch (type) {
    case "object":
      return { type: "object", fields: {} };
    case "field":
      return { type: "field", bind: "" };
    case "pipeline":
      return { type: "pipeline", source: "", steps: [] };
    case "with":
      return { type: "with", bindings: {}, body: null };
    case "custom":
      return { type: "custom", fn: CUSTOM_FUNCTION_NAMES[0] || "", args: {} };
    default:
      throw new Error(`Unknown node type: ${type}`);
  }
}

function createStep(stepType) {
  switch (stepType) {
    case "map":
      return { step: "map", item: createNode("field") };
    case "filter":
      return { step: "filter", bind: "" };
    case "flatten":
      return { step: "flatten" };
    case "group-by":
      return { step: "group-by", bind: "" };
    case "sort":
      return { step: "sort", bind: "", direction: "asc" };
    case "dedup":
      return { step: "dedup", bind: "" };
    case "custom":
      return { step: "custom", fn: CUSTOM_FUNCTION_NAMES[0] || "", args: {} };
    default:
      throw new Error(`Unknown step type: ${stepType}`);
  }
}

// --- Tree rendering ----------------------------------------------------

function nodeLabel(node) {
  if (!node) return "";
  switch (node.type) {
    case "object":
      return `${Object.keys(node.fields || {}).length} field(s)`;
    case "field":
      return node.bind || "(empty bind)";
    case "pipeline":
      return `${typeof node.source === "string" ? node.source : node.source?.fn ? `custom:${node.source.fn}` : "(no source)"} — ${(node.steps || []).length} step(s)`;
    case "with":
      return `${Object.keys(node.bindings || {}).length} binding(s)${node.body ? "" : " — no body"}`;
    case "custom":
      return node.fn || "(no function)";
    default:
      return "";
  }
}

function stepLabel(step) {
  switch (step.step) {
    case "map":
      return "map";
    case "filter":
      return `filter: ${step.bind || ""}`;
    case "flatten":
      return "flatten";
    case "group-by":
      return `group-by: ${step.bind || ""}`;
    case "sort":
      return `sort: ${step.bind || ""} (${step.direction || "asc"})`;
    case "dedup":
      return `dedup: ${step.bind || ""}`;
    case "custom":
      return `custom: ${step.fn || ""}`;
    default:
      return step.step;
  }
}

function makeRemoveButton(onRemove) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline-danger btn-sm loom-node-remove";
  button.textContent = "×";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    recordUndoableChange("mapping", onRemove);
  });
  return button;
}

function renderNodeEl(node, { onRemove } = {}) {
  const el = document.createElement("div");
  el.className = "loom-node" + (node === selectedNode ? " loom-node--selected" : "");
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    selectNode(node);
  });

  const header = document.createElement("div");
  header.className = "loom-node-header";
  const labelWrap = document.createElement("div");
  const typeEl = document.createElement("div");
  typeEl.className = "loom-node-type";
  typeEl.textContent = node.type;
  const labelEl = document.createElement("div");
  labelEl.className = "loom-node-label";
  labelEl.textContent = nodeLabel(node);
  labelWrap.append(typeEl, labelEl);
  header.appendChild(labelWrap);
  if (onRemove) {
    header.appendChild(makeRemoveButton(onRemove));
  }
  el.appendChild(header);

  if (node.type === "object") {
    const childrenEl = document.createElement("div");
    childrenEl.className = "loom-node-children";
    const keys = Object.keys(node.fields || {});
    if (!keys.length) {
      childrenEl.appendChild(emptyHint("No fields yet — select this node, then click a palette entry."));
    }
    keys.forEach((key) => {
      const row = document.createElement("div");
      const keyLabel = document.createElement("div");
      keyLabel.className = "small text-body-secondary fw-semibold mt-1";
      keyLabel.textContent = key;
      row.appendChild(keyLabel);
      row.appendChild(
        renderNodeEl(node.fields[key], {
          onRemove: () => {
            if (selectedNode === node.fields[key]) selectedNode = node;
            delete node.fields[key];
            rerenderAll();
          },
        })
      );
      childrenEl.appendChild(row);
    });
    el.appendChild(childrenEl);
  }

  if (node.type === "with") {
    const bindingsEl = document.createElement("div");
    bindingsEl.className = "loom-node-children";
    const bindingsTitle = document.createElement("div");
    bindingsTitle.className = "small text-body-secondary fw-semibold";
    bindingsTitle.textContent = "Bindings";
    bindingsEl.appendChild(bindingsTitle);
    const keys = Object.keys(node.bindings || {});
    if (!keys.length) {
      bindingsEl.appendChild(emptyHint("No bindings yet."));
    }
    keys.forEach((key) => {
      const row = document.createElement("div");
      const keyLabel = document.createElement("div");
      keyLabel.className = "small text-body-secondary fw-semibold mt-1";
      keyLabel.textContent = key;
      row.appendChild(keyLabel);
      row.appendChild(
        renderNodeEl(node.bindings[key], {
          onRemove: () => {
            if (selectedNode === node.bindings[key]) selectedNode = node;
            delete node.bindings[key];
            rerenderAll();
          },
        })
      );
      bindingsEl.appendChild(row);
    });

    const bodyTitle = document.createElement("div");
    bodyTitle.className = "small text-body-secondary fw-semibold mt-2";
    bodyTitle.textContent = "Body";
    bindingsEl.appendChild(bodyTitle);
    if (node.body) {
      bindingsEl.appendChild(
        renderNodeEl(node.body, {
          onRemove: () => {
            if (selectedNode === node.body) selectedNode = node;
            node.body = null;
            rerenderAll();
          },
        })
      );
    } else {
      bindingsEl.appendChild(emptyHint("No body yet — select this node, then click a palette entry."));
    }
    el.appendChild(bindingsEl);
  }

  if (node.type === "pipeline") {
    const stepsEl = document.createElement("div");
    stepsEl.className = "loom-node-steps";
    const steps = node.steps || [];
    if (!steps.length) {
      stepsEl.appendChild(emptyHint("No steps yet — select this pipeline, then click a step in the palette."));
    }
    steps.forEach((step, index) => {
      const stepEl = document.createElement("div");
      stepEl.className = "loom-step" + (step === selectedNode ? " loom-step--selected" : "");
      stepEl.addEventListener("click", (event) => {
        event.stopPropagation();
        selectNode(step);
      });
      const row = document.createElement("div");
      row.className = "d-flex align-items-center justify-content-between";
      const text = document.createElement("span");
      text.textContent = `${index + 1}. ${stepLabel(step)}`;
      row.appendChild(text);
      row.appendChild(
        makeRemoveButton(() => {
          if (selectedNode === step) selectedNode = node;
          steps.splice(index, 1);
          rerenderAll();
        })
      );
      stepEl.appendChild(row);
      if (step.step === "map") {
        const itemWrap = document.createElement("div");
        itemWrap.className = "mt-1";
        itemWrap.appendChild(renderNodeEl(step.item, {}));
        stepEl.appendChild(itemWrap);
      }
      stepsEl.appendChild(stepEl);
    });
    el.appendChild(stepsEl);
  }

  return el;
}

function emptyHint(text) {
  const p = document.createElement("p");
  p.className = "loom-empty-hint mb-1";
  p.textContent = text;
  return p;
}

function renderTree() {
  if (!treeContainer) return;
  treeContainer.innerHTML = "";
  if (!mappingDefinition) {
    treeContainer.appendChild(emptyHint('No mapping loaded — click "Object" in the palette to start a new root node.'));
    return;
  }
  treeContainer.appendChild(
    renderNodeEl(mappingDefinition, {
      onRemove: () => {
        mappingDefinition = null;
        selectedNode = null;
        rerenderAll();
      },
    })
  );
}

// --- Inspector -----------------------------------------------------------

function inputRow(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "mb-2";
  const label = document.createElement("label");
  label.className = "form-label small text-body-secondary fw-semibold mb-1";
  label.textContent = labelText;
  wrap.append(label, inputEl);
  return wrap;
}

function bindTextInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control form-control-sm";
  input.value = value ?? "";
  input.addEventListener("change", () => {
    recordUndoableChange("mapping", () => onChange(input.value));
    renderTree();
    runLivePreview();
  });
  return input;
}

function bindSelect(options, value, onChange) {
  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    if (option === value) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => {
    recordUndoableChange("mapping", () => onChange(select.value));
    renderTree();
    runLivePreview();
  });
  return select;
}

function renderInspector() {
  if (!inspectorContainer) return;
  inspectorContainer.innerHTML = "";
  const node = selectedNode;
  if (!node) {
    inspectorContainer.appendChild(document.createElement("p")).className = "small text-body-secondary";
    inspectorContainer.lastChild.textContent = "Select a node in the tree to edit its properties.";
    return;
  }

  if (node.step) {
    // pipeline step
    inspectorContainer.appendChild(labelHeading(`Step: ${node.step}`));
    if ("bind" in node) {
      inspectorContainer.appendChild(
        inputRow("Bind (@path or =formula)", bindTextInput(node.bind, (value) => (node.bind = value)))
      );
    }
    if ("direction" in node) {
      inspectorContainer.appendChild(
        inputRow(
          "Direction",
          bindSelect(["asc", "desc"], node.direction, (value) => (node.direction = value))
        )
      );
    }
    if (node.step === "custom") {
      inspectorContainer.appendChild(
        inputRow(
          "Function",
          bindSelect(CUSTOM_FUNCTION_NAMES, node.fn, (value) => (node.fn = value))
        )
      );
    }
    return;
  }

  inspectorContainer.appendChild(labelHeading(`Node: ${node.type}`));
  if (node.type === "field") {
    inspectorContainer.appendChild(
      inputRow("Bind (@path or =formula)", bindTextInput(node.bind, (value) => (node.bind = value)))
    );
  }
  if (node.type === "pipeline") {
    const isCustomSource = node.source && typeof node.source === "object";
    const sourceKindSelect = bindSelect(["bind", "custom"], isCustomSource ? "custom" : "bind", (value) => {
      node.source = value === "custom" ? { fn: CUSTOM_FUNCTION_NAMES[0] || "", args: {} } : "";
      renderInspector();
    });
    inspectorContainer.appendChild(inputRow("Source kind", sourceKindSelect));
    if (isCustomSource) {
      inspectorContainer.appendChild(
        inputRow(
          "Source function",
          bindSelect(CUSTOM_FUNCTION_NAMES, node.source.fn, (value) => (node.source.fn = value))
        )
      );
    } else {
      inspectorContainer.appendChild(
        inputRow("Source bind (@path)", bindTextInput(typeof node.source === "string" ? node.source : "", (value) => (node.source = value)))
      );
    }
  }
  if (node.type === "custom") {
    inspectorContainer.appendChild(
      inputRow(
        "Function",
        bindSelect(CUSTOM_FUNCTION_NAMES, node.fn, (value) => (node.fn = value))
      )
    );
  }
  if (node.type === "object" || node.type === "with") {
    const hintRow = document.createElement("div");
    hintRow.className = "d-flex align-items-center gap-2";
    const hintLabel = document.createElement("span");
    hintLabel.className = "small text-body-secondary";
    hintLabel.textContent = "Use the Node Palette to add children to this node.";
    hintRow.appendChild(hintLabel);
    const help = document.createElement("span");
    help.className = "align-middle";
    help.dataset.helpTopic = "loom.nodePalette";
    help.dataset.helpInsert = "replace";
    hintRow.appendChild(help);
    inspectorContainer.appendChild(hintRow);
    initHelpSystem({ root: hintRow });
  }
}

function labelHeading(text) {
  const h = document.createElement("h3");
  h.className = "h6 mb-2";
  h.textContent = text;
  return h;
}

function selectNode(node) {
  selectedNode = node;
  const isPipeline = node && node.type === "pipeline";
  if (stepPaletteSection) stepPaletteSection.hidden = !isPipeline;
  renderTree();
  renderInspector();
}

function rerenderAll() {
  renderTree();
  renderInspector();
  runLivePreview();
}

// Delegated hover: event.target is always the topmost/innermost element the
// pointer is actually over, so .closest() finds exactly the right node/step
// to highlight — no ambiguity about which nested box "wins", and no flicker
// since it's one explicit class toggle instead of competing CSS :hover rules.
let hoveredEl = null;
function setHoveredElement(el) {
  if (hoveredEl === el) return;
  if (hoveredEl) hoveredEl.classList.remove("loom-hovered");
  hoveredEl = el;
  if (hoveredEl) hoveredEl.classList.add("loom-hovered");
}

if (treeContainer) {
  treeContainer.addEventListener("mouseover", (event) => {
    setHoveredElement(event.target.closest(".loom-node, .loom-step"));
  });
  treeContainer.addEventListener("mouseleave", () => setHoveredElement(null));
}

// --- Workflow mode: a mapping with a fixed $source favors the Entities
// pane; a new mapping (no $source yet) favors the Mapping Tree. Only fires
// on load/new/first-save, not every edit, so it doesn't fight manual
// collapse/expand.
//
// Data Source is never disabled — Loom is the only place $source can be
// edited (Workbench's Import Character flow has no such control), so
// locking it would make a mistagged $source unfixable short of hand-editing
// JSON. The Save handler always stamps whatever's currently selected.

// Toggles which of sourceValueInput/sourceFileInput is shown for `active` —
// shared with updateSourceUi below so the logic isn't duplicated.
function applySourceValueVisibility(active) {
  if (sourceValueInput) sourceValueInput.classList.toggle("d-none", Boolean(active.file));
  if (sourceFileInput) sourceFileInput.classList.toggle("d-none", !active.file);
  // Folder-picker button only makes sense for a `bulk: true` + `file: true`
  // source (Fantasy Statblocks) — SRD's own bulk fetch reads the typed
  // value/URL input above, no file picker needed.
  sourceBulkFolderButton?.classList.toggle("d-none", !(active.bulk && active.file));
  if (sourceFetchStatus) sourceFetchStatus.classList.add("d-none");
}

function applySourceSelection(source) {
  if (!sourceSelect) return;
  if (source) sourceSelect.value = source;
  const active = SOURCES.find((entry) => entry.id === sourceSelect.value) || SOURCES[0];
  if (sourceValueInput) sourceValueInput.placeholder = active.placeholder;
  applySourceValueVisibility(active);
  renderSourceValueLabel(active);
}

function enterMappingMode(definition) {
  const source = definition && typeof definition === "object" ? definition.$source : null;
  applySourceSelection(source || null);
  if (mappingDescriptionInput) {
    mappingDescriptionInput.value = (definition && typeof definition === "object" && definition.$description) || "";
  }
  // A source with a well-known list endpoint (the 5e API's documented URLs)
  // pre-fills it so picking the mapping alone is enough to fetch everything
  // of that kind. Only applied on a freshly loaded mapping — never
  // overwrites an in-progress edit.
  if (sourceValueInput && definition?.$defaultSourceValue) {
    sourceValueInput.value = definition.$defaultSourceValue;
  }
  if (dataTypeSelect) {
    const dataType = definition && typeof definition === "object" ? definition.$dataType : null;
    dataTypeSelect.value = dataType === "character" ? "character" : "other";
  }
  treeSetCollapsed(Boolean(source));
  entitiesSetCollapsed(!source);
  ioSetCollapsed(false);
}

// --- Palette handlers ------------------------------------------------------

function promptKey(promptText, defaultValue = "") {
  const key = window.prompt(promptText, defaultValue);
  if (key == null) return null;
  const trimmed = key.trim();
  return trimmed || null;
}

if (nodePalette) {
  nodePalette.addEventListener("click", (event) => {
    const button = event.target.closest("[data-palette-node-type]");
    if (!button) return;
    const type = button.dataset.paletteNodeType;

    if (!mappingDefinition) {
      recordUndoableChange("mapping", () => {
        mappingDefinition = createNode(type);
      });
      selectNode(mappingDefinition);
      rerenderAll();
      return;
    }

    if (!selectedNode) {
      status?.show("Select a node first (or remove the root to start over).", { type: "warning", timeout: 2500 });
      return;
    }

    if (selectedNode.type === "object") {
      const key = promptKey("Field name:");
      if (!key) return;
      recordUndoableChange("mapping", () => {
        selectedNode.fields[key] = createNode(type);
      });
      rerenderAll();
      return;
    }

    if (selectedNode.type === "with") {
      const key = promptKey("Binding name (leave blank to set as the body):");
      if (key === null) return;
      recordUndoableChange("mapping", () => {
        if (key) {
          selectedNode.bindings[key] = createNode(type);
        } else {
          selectedNode.body = createNode(type);
        }
      });
      rerenderAll();
      return;
    }

    status?.show(`A ${selectedNode.type} node can't have children added this way.`, { type: "warning", timeout: 2500 });
  });
}

if (stepPalette) {
  stepPalette.addEventListener("click", (event) => {
    const button = event.target.closest("[data-palette-step-type]");
    if (!button) return;
    if (!selectedNode || selectedNode.type !== "pipeline") {
      status?.show("Select a pipeline node first.", { type: "warning", timeout: 2000 });
      return;
    }
    recordUndoableChange("mapping", () => {
      selectedNode.steps.push(createStep(button.dataset.paletteStepType));
    });
    rerenderAll();
  });
}

// --- Live preview ----------------------------------------------------------

function runLivePreview() {
  updateJsonPreview(rawPreviewEl, null, sampleData);
  if (!mappingDefinition) {
    lastMappedResult = null;
    updateJsonPreview(mappedPreviewEl, null, { note: "No mapping defined yet." });
    renderEntities();
    return;
  }
  try {
    const result = applyMapping(mappingDefinition, sampleData, ddbLookupContext);
    lastMappedResult = result;
    updateJsonPreview(mappedPreviewEl, null, result);
  } catch (error) {
    lastMappedResult = null;
    updateJsonPreview(mappedPreviewEl, null, { error: error.message });
  }
  renderEntities();
}

if (sampleDataApplyButton) {
  sampleDataApplyButton.addEventListener("click", () => {
    try {
      sampleData = JSON.parse(sampleDataInput.value || "{}");
      status?.show("Sample data applied.", { type: "success", timeout: 1500 });
      runLivePreview();
    } catch (error) {
      status?.show(`Sample data isn't valid JSON: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// --- Source fetch ------------------------------------------------------

function renderSourceValueLabel(source) {
  if (!sourceValueLabelRow) return;
  sourceValueLabelRow.innerHTML = "";
  const labelRow = document.createElement("div");
  labelRow.className = "d-flex justify-content-between align-items-center gap-2 flex-wrap";
  const label = document.createElement("label");
  label.className = "form-label fw-semibold mb-0";
  label.setAttribute("for", source.file ? "loomSourceFile" : "loomSourceValue");
  label.textContent = source.valueLabel;
  labelRow.appendChild(label);
  if (source.helpTopic) {
    const help = document.createElement("span");
    help.className = "align-middle";
    help.dataset.helpTopic = source.helpTopic;
    help.dataset.helpInsert = "replace";
    help.dataset.helpPlacement = "left";
    labelRow.appendChild(help);
    initHelpSystem({ root: labelRow });
  }
  sourceValueLabelRow.appendChild(labelRow);
}

if (sourceSelect) {
  SOURCES.forEach((source) => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.label;
    sourceSelect.appendChild(option);
  });
  const updateSourceUi = () => {
    const source = SOURCES.find((entry) => entry.id === sourceSelect.value) || SOURCES[0];
    if (sourceValueInput) sourceValueInput.placeholder = source.placeholder;
    applySourceValueVisibility(source);
    renderSourceValueLabel(source);
  };
  sourceSelect.addEventListener("change", updateSourceUi);
  updateSourceUi();
}

// Whichever file input was used most recently — a single `<input>` can't
// offer both multi-select and `webkitdirectory` folder mode, so there are
// two, both feeding the same Fetch handler below.
let pickedFiles = null;

if (sourceFileInput) {
  sourceFileInput.addEventListener("change", () => {
    pickedFiles = sourceFileInput.files;
  });
}
if (sourceBulkFolderInput) {
  sourceBulkFolderInput.addEventListener("change", () => {
    pickedFiles = sourceBulkFolderInput.files;
  });
}
if (sourceBulkFolderButton) {
  sourceBulkFolderButton.addEventListener("click", () => sourceBulkFolderInput?.click());
}

// Which bulk loader a `file:true, bulk:true` source's multi-file pick feeds
// into — each source parses its files independently (raw records first,
// mapped at import time), so this dispatches on the selected source rather
// than assuming Fantasy Statblocks.
const BULK_FILE_LOADERS = {
  "fantasy-statblocks": loadFantasyStatblockDataBulk,
  "markdown-wonder": loadMarkdownWonderDataBulk,
};

function setFetchStatus(text) {
  if (!sourceFetchStatus) return;
  sourceFetchStatus.textContent = text;
  sourceFetchStatus.classList.toggle("d-none", !text);
}

// Fetch itself detects bulk vs. single: a list-shaped SRD result, or more
// than one file picked for Fantasy Statblocks, routes into the checklist
// below instead of the live preview — no separate Fetch All button (the
// existing Fetch button doubles as Fetch All when a directory is provided).
// Turns a bulk-fetch result array (SRD's `_bulkError`/`rateLimited`
// tagging) into one toast: plain success, or an explicit rate-limit callout
// (vs. the generic "N failed") since a rate limit means "try again later,"
// not "something's wrong with these records."
function bulkFetchSummary(items) {
  const total = items.length;
  const failed = items.filter((item) => item?._bulkError).length;
  if (!failed) return { message: `Fetched ${total} record${total === 1 ? "" : "s"}.`, ok: true };
  const succeeded = total - failed;
  const base = `Fetched ${succeeded} of ${total} record${total === 1 ? "" : "s"} — ${failed} failed`;
  const message = items.rateLimited
    ? `${base} (rate limited by the 5e API — wait a moment, then Fetch again to get the rest).`
    : `${base}.`;
  return { message, ok: false };
}

if (sourceFetchButton) {
  sourceFetchButton.addEventListener("click", async () => {
    const source = SOURCES.find((entry) => entry.id === sourceSelect?.value) || SOURCES[0];
    sourceFetchButton.disabled = true;
    setFetchStatus("Fetching…");
    // Tracks whether the try block ended in error/partial-failure — the
    // finally block only clears the status line on clean success, so a
    // failure (thrown error, or some bulk items rate-limited/failed) stays
    // visible next to the Fetch button instead of vanishing when it
    // re-enables.
    let statusMessage = "";
    try {
      if (source.file) {
        const files = Array.from(pickedFiles || []);
        if (!files.length) {
          status?.show("Choose a file to load.", { type: "warning", timeout: 2000 });
          return;
        }
        if (files.length > 1) {
          const onProgress = (completed, total) => setFetchStatus(`Fetching ${completed} of ${total}…`);
          const bulkLoader = BULK_FILE_LOADERS[source.id] || loadFantasyStatblockDataBulk;
          const items = await bulkLoader(files, onProgress);
          beginBulkImport(items);
          const summary = bulkFetchSummary(items);
          if (!summary.ok) statusMessage = summary.message;
          status?.show(summary.message, { type: summary.ok ? "success" : "warning", timeout: summary.ok ? 2000 : 6000 });
          return;
        }
        const raw = await loadSourceDataRaw(source, files[0]);
        sampleData = raw;
        if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
        runLivePreview();
        status?.show("Fetched.", { type: "success", timeout: 1500 });
        return;
      }
      const value = (sourceValueInput?.value || "").trim();
      if (!value) {
        status?.show("Enter a value to fetch.", { type: "warning", timeout: 2000 });
        return;
      }
      if (source.id === "srd") {
        const onProgress = (completed, total) => setFetchStatus(`Fetching ${completed} of ${total}…`);
        const result = await loadSrdData(value, onProgress);
        if (Array.isArray(result)) {
          beginBulkImport(result);
          const summary = bulkFetchSummary(result);
          if (!summary.ok) statusMessage = summary.message;
          status?.show(summary.message, { type: summary.ok ? "success" : "warning", timeout: summary.ok ? 2000 : 6000 });
          return;
        }
        sampleData = result;
        if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
        runLivePreview();
        status?.show("Fetched.", { type: "success", timeout: 1500 });
        return;
      }
      const raw = await loadSourceDataRaw(source, value);
      sampleData = raw;
      if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
      runLivePreview();
      status?.show("Fetched.", { type: "success", timeout: 1500 });
    } catch (error) {
      statusMessage = `Fetch failed: ${error.message}`;
      status?.show(statusMessage, { type: "error", timeout: 6000 });
    } finally {
      sourceFetchButton.disabled = false;
      setFetchStatus(statusMessage);
    }
  });
}

// --- Bulk import (checklist + Import Selected) -----------------------

// Raw records fetched in bulk, not yet mapped — mapping is deferred to
// import time per item, since the checklist only needs each item's raw
// `name`.
let bulkRawItems = [];
const bulkSelected = new Set();
// Indices already imported this session — a separate set (not splicing
// bulkRawItems) so bulkSelected's indices stay valid; renderBulkChecklist
// skips these to give the "row disappears" feedback without index-shifting
// bugs.
const bulkImported = new Set();

function bulkItemLabel(item) {
  return item?.name || item?._bulkFileName || "(unnamed)";
}

function beginBulkImport(items) {
  bulkRawItems = items;
  bulkSelected.clear();
  bulkImported.clear();
  if (bulkImportCard) bulkImportCard.classList.remove("d-none");
  if (bulkProgress) bulkProgress.textContent = "";
  renderBulkChecklist();
}

function renderBulkChecklist() {
  if (!bulkChecklist || !bulkSummary) return;
  bulkChecklist.innerHTML = "";
  if (!bulkRawItems.length) {
    bulkSummary.textContent = "No records fetched yet.";
    return;
  }
  const pending = bulkRawItems.filter((_, index) => !bulkImported.has(index));
  const failed = pending.filter((item) => item._bulkError);
  bulkSummary.textContent = `${bulkImported.size ? `${bulkImported.size} imported, ` : ""}${pending.length} remaining, ${
    bulkSelected.size
  } selected${failed.length ? `, ${failed.length} failed to parse (shown below, can't be selected)` : ""}.`;
  bulkRawItems.forEach((item, index) => {
    if (bulkImported.has(index)) return;
    const row = document.createElement("div");
    row.className = "d-flex align-items-center gap-2";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "form-check-input mt-0 flex-shrink-0";
    checkbox.checked = bulkSelected.has(index);
    checkbox.disabled = Boolean(item._bulkError);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) bulkSelected.add(index);
      else bulkSelected.delete(index);
      renderBulkChecklist();
    });
    const label = document.createElement("span");
    label.className = item._bulkError ? "small text-danger" : "small";
    label.textContent = item._bulkError ? `${bulkItemLabel(item)} — ${item._bulkError}` : bulkItemLabel(item);
    row.append(checkbox, label);
    bulkChecklist.appendChild(row);
  });
}

if (bulkSelectAllButton) {
  bulkSelectAllButton.addEventListener("click", () => {
    bulkRawItems.forEach((item, index) => {
      if (!item._bulkError && !bulkImported.has(index)) bulkSelected.add(index);
    });
    renderBulkChecklist();
  });
}
if (bulkSelectNoneButton) {
  bulkSelectNoneButton.addEventListener("click", () => {
    bulkSelected.clear();
    renderBulkChecklist();
  });
}

if (bulkImportSelectedButton) {
  bulkImportSelectedButton.addEventListener("click", async () => {
    if (!mappingDefinition) {
      status?.show("Load or build a mapping before importing.", { type: "warning", timeout: 2500 });
      return;
    }
    const indices = Array.from(bulkSelected).sort((a, b) => a - b);
    if (!indices.length) {
      status?.show("Select at least one record to import.", { type: "warning", timeout: 2000 });
      return;
    }
    bulkImportSelectedButton.disabled = true;
    let imported = 0;
    const failures = [];
    // Sequential, not Promise.all: a public free API shouldn't get hundreds
    // of parallel requests from one click, and Feature-matching benefits
    // from running in order (a later monster can reuse a Feature an earlier
    // one just created, e.g. Multiattack converging to one shared Feature).
    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i];
      const rawItem = bulkRawItems[index];
      const label = bulkItemLabel(rawItem);
      if (bulkProgress) bulkProgress.textContent = `Importing ${i + 1} of ${indices.length} (${label})…`;
      try {
        const mapped = applyMapping(mappingDefinition, rawItem, ddbLookupContext);
        const entities = deriveEntities(mapped);
        if (!entities.length) throw new Error("Mapping produced no save-able entity.");
        for (const entity of entities) {
          // SRD's own `index` (e.g. "adult-black-dragon") is already a
          // clean canonical slug — preferred over re-slugifying the name.
          // Fantasy Statblocks items have no `index`, falling back to the
          // single-save prompt's own default. `rawItem.url` is each item's
          // own detail URL, not the shared list-endpoint value
          // sourceValueInput holds.
          const autoId = rawItem.index || slugify(entity.name);
          const url = rawItem.url ? normalizeSrdInput(rawItem.url) : undefined;
          await saveEntity(entity, { autoId, url, quiet: true });
        }
        imported += 1;
        bulkImported.add(index);
        bulkSelected.delete(index);
        renderBulkChecklist();
      } catch (error) {
        failures.push({ name: label, error: error.message });
      }
    }
    bulkImportSelectedButton.disabled = false;
    loadRecentSaves();
    const summary = `Imported ${imported} of ${indices.length}${failures.length ? `, ${failures.length} failed` : ""}.`;
    if (bulkProgress) bulkProgress.textContent = summary;
    status?.show(summary, { type: failures.length ? "warning" : "success", timeout: 5000 });
    if (failures.length) console.warn("Bulk import failures:", failures);
  });
}

// --- Entities: one-to-many expansion + per-entity save ---------------------
// Convention, not engine metadata: a mapped {kind, name} result is the
// primary entity; ENTITY_ARRAY_FIELDS maps a field name to the entity kind
// its items save as. Explicit by design — arrays like saving_throws also
// carry {name,...} entries but aren't separate entities, so a field only
// qualifies if listed here. `subclasses` is NOT listed: it's just a
// lightweight ref array on the class — the full subclass list is its own
// mapping (ddb-subclass.json), producing entities directly via the
// Array.isArray branch below.
const ENTITY_ARRAY_FIELDS = { variants: "variant" };

function slugify(name) {
  return (
    (name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "entity"
  );
}

// A mapping's root can itself be a pipeline (e.g. ddb-subclass.json's root
// is a pipeline over `subclasses`, producing the array directly) — every
// item shaped like an entity ({kind, name}) is one, no wrapping object
// needed.
function deriveEntities(mappedResult) {
  if (Array.isArray(mappedResult)) {
    return mappedResult
      .filter((item) => item && typeof item === "object" && typeof item.kind === "string" && typeof item.name === "string")
      .map((item) => ({ kind: item.kind, name: item.name, data: item }));
  }
  if (!mappedResult || typeof mappedResult !== "object") return [];
  const entities = [];
  if (typeof mappedResult.kind === "string" && typeof mappedResult.name === "string") {
    entities.push({ kind: mappedResult.kind, name: mappedResult.name, data: mappedResult });
  }
  Object.entries(ENTITY_ARRAY_FIELDS).forEach(([key, kind]) => {
    const value = mappedResult[key];
    if (!Array.isArray(value)) return;
    value.forEach((item) => {
      if (item && typeof item === "object" && typeof item.name === "string") {
        entities.push({ kind, name: item.name, data: item });
      }
    });
  });
  return entities;
}

// `autoId`/`url`/`quiet` — set by the bulk-import loop, which saves
// potentially hundreds of entities in a row:
// - `autoId`: skips the id `window.prompt` (a hard blocker looped that
//   often) — used directly as the save id.
// - `url`: each bulk item has its own source URL, not the shared
//   `sourceValueInput` value (which holds the *list* endpoint for a bulk
//   fetch, not any one item's detail URL).
// - `quiet`: suppresses per-save toasts and the recent-saves reload — the
//   bulk loop shows its own aggregate summary instead.
// The single-import call site (Entities panel's per-row Save) passes none
// of these.
async function saveEntity(entity, { autoId, url: urlOverride, quiet = false } = {}) {
  // Same preference order as the bulk-import loop above — a mapping's own
  // `index` field (e.g. ddb-subclass.json's `compoundSlug`,
  // "barbarian-path-of-the-berserker" not just "path-of-the-berserker")
  // encodes disambiguating context a bare name-slug can't.
  const id = autoId || promptKey(`Save "${entity.name}" as (id):`, entity.data?.index || slugify(entity.name));
  if (!id) return;
  if (!dataManager) return;
  try {
    let data = entity.data;
    // Records what this record needs to redo the fetch+transform without
    // reopening Loom — Workbench's Re-import button shows only when both
    // `mapping` and `url` are present (content-fetch.js's
    // reimportViaMapping). `mapping` alone happens when applied to
    // hand-edited Sample Data — nothing to re-fetch from. Generic across
    // every kind — also the suite's standard "was this imported?" signal
    // (see Crucible's isImportedStatBlock).
    if (currentMappingId) {
      data = { ...data, mapping: currentMappingId };
    }
    const sourceValue = urlOverride || (sourceValueInput?.value || "").trim();
    if (sourceValue) {
      data = { ...data, url: sourceValue };
    }
    if (entity.kind === "character") {
      // mergeImportedCharacterData preserves template/systemIds/data/url/
      // mapping from whatever's already saved at this id — a plain
      // overwrite on re-import would silently wipe Workbench's
      // template/system assignment, making the character vanish from
      // Workbench's picker (filtered on `template`) though it still loads
      // fine here.
      try {
        // preferLocal: false, same reason as loadLibraryEntry — needs the
        // record actually on the server, not a stale local cache.
        const existing = await dataManager.get("character", id, { preferLocal: false });
        data = mergeImportedCharacterData(data, existing?.payload);
      } catch (error) {
        // No existing record at this id — nothing to preserve, first import.
      }
      // Every imported character needs at least one Assigned System —
      // without this, a brand-new DDB import would save with an empty
      // systemIds array, invisible to anything keyed off Assigned Systems
      // (combat-binding lookup, Workbench's `@`-suggestion list). Gated on
      // the mapping's own `$source === "ddb"` rather than unconditional, so
      // a future non-DDB mapping doesn't inherit this default by accident;
      // explicit data or a prior save's value always wins.
      if ((!Array.isArray(data.systemIds) || !data.systemIds.length) && mappingDefinition?.$source === "ddb") {
        data = { ...data, systemIds: ["sys.dnd5e"] };
      }
      // Verified name-match against Species/Class/Variant/Wonder libraries
      // (content-feature-matching.js) — unconditional here since a Loom
      // save is always explicit, never autosave, so no keystroke-spam
      // concern.
      await linkCharacterSpeciesClassReferences(dataManager, data);
      await linkCharacterSpellReferences(dataManager, data);
      await linkCharacterInventoryReferences(dataManager, data);
      // Same automatic-on-save promotion as Monster/Wonder/Species/Class/
      // Variant — imported `feats[]`/`features[]` prose becomes real
      // `featureIds`, mirroring Monster/NPC's shape. Both passes tag
      // `category:"character"` — every Feature needs some category
      // (untagged ones can't be found via Loom's Type filter), and a single
      // broad bucket is deliberate since Undercroft doesn't model
      // race/class/background/feat separately.
      if (hasEmbeddedFeatures(data, "feats") || hasEmbeddedFeatures(data, "features")) {
        const existingFeatures = await fetchKindEntriesWithIds(dataManager, "feature").then(
          (entries) => entries.map((entry) => ({ id: entry.id, ...entry.entity })),
          () => []
        );
        let matchedCount = 0;
        let createdCount = 0;
        let updatedCount = 0;
        let errors = [];
        for (const sourceField of ["feats", "features"]) {
          // `excludeSpeciesPropertyTraits` — a Character's "features" list
          // merges in racial traits (ddb-character.json's featuresTable),
          // which carry the same universal PROPERTIES (Size, Speed,
          // Creature Type) a Species' traits[] does. Harmless for "feats" —
          // passed for both loop iterations since the filter only matches
          // these specific names.
          const outcome = await promoteEmbeddedFeatures(data, {
            sourceField,
            category: "character",
            dataManager,
            existingFeatures,
            excludeSpeciesPropertyTraits: true,
          });
          matchedCount += outcome.matchedCount;
          createdCount += outcome.createdCount;
          updatedCount += outcome.updatedCount;
          errors = errors.concat(outcome.errors);
        }
        if (!quiet && (matchedCount || createdCount || updatedCount)) {
          status?.show(describeFeaturePromotionOutcome({ matchedCount, createdCount, updatedCount }), { type: "info", timeout: 4000 });
        }
        if (errors.length) {
          status?.show(
            `${entity.name || id}: ${errors.length} feature${errors.length === 1 ? "" : "s"} couldn't be converted (see console) — the rest of the character saved fine.`,
            { type: "warning", timeout: 6000 }
          );
        }
      }
    } else if (entity.kind === "monster") {
      // Same "every imported record needs an Assigned System" reasoning as
      // the character branch above — without systemIds, the conversion
      // below can't scope its matching to the right System's Feature
      // library.
      if (
        (!Array.isArray(data.systemIds) || !data.systemIds.length) &&
        (mappingDefinition?.$source === "ddb-monster" ||
          mappingDefinition?.$source === "fantasy-statblocks" ||
          mappingDefinition?.$source === "srd")
      ) {
        data = { ...data, systemIds: ["sys.dnd5e"] };
      }
      // Every monster import lands with real featureIds, unconditionally,
      // not an opt-in step (see monster-feature-matching.js). This is one
      // of its two call sites (Crucible's own handleSave is the other),
      // both automatic-on-save.
      if (hasConvertibleStatBlock(data)) {
        const existingFeatures = await fetchKindEntriesWithIds(dataManager, "feature").then(
          (entries) => entries.map((entry) => ({ id: entry.id, ...entry.entity })),
          () => []
        );
        const { matchedCount, createdCount, errors } = await convertStatBlockToFeatures(data, {
          dataManager,
          existingFeatures,
          monsterSlug: slugify(id),
        });
        if (!quiet && (matchedCount || createdCount)) {
          status?.show(
            `Matched ${matchedCount} trait${matchedCount === 1 ? "" : "s"}/action${matchedCount === 1 ? "" : "s"} to existing Features, created ${createdCount} new one${createdCount === 1 ? "" : "s"}.`,
            { type: "info", timeout: 4000 }
          );
        }
        // Surfaced regardless of `quiet` — a monster still saves fine with
        // a trait skipped (monster-feature-matching.js's own try/catch),
        // but that's real information loss a GM would otherwise only
        // discover much later, or never.
        if (errors?.length) {
          status?.show(
            `${entity.name || id}: ${errors.length} feature${errors.length === 1 ? "" : "s"} couldn't be converted (see console) — the rest of the monster saved fine.`,
            { type: "warning", timeout: 6000 }
          );
        }
      }
    } else if (entity.kind === "wonder") {
      // Vault's own spell/item counterpart to the monster branch above —
      // same automatic-on-save, no manual/backfill action anywhere. Never
      // both fire on the same record: hasConvertibleStatBlock keys off
      // monster's own ABILITY_GROUP_KEYS stats shape, this one off a
      // Wonder's own stats.mechanic/stats.name shape (see
      // vault-feature-matching.js's own hasConvertibleSpellItemStats).
      if (
        (!Array.isArray(data.systemIds) || !data.systemIds.length) &&
        mappingDefinition?.$source === "srd"
      ) {
        data = { ...data, systemIds: ["sys.dnd5e"] };
      }
      if (hasConvertibleSpellItemStats(data)) {
        const existingFeatures = await fetchKindEntriesWithIds(dataManager, "feature").then(
          (entries) => entries.map((entry) => ({ id: entry.id, ...entry.entity })),
          () => []
        );
        const { matchedCount, createdCount, errors } = await convertSpellOrItemToFeatures(data, {
          dataManager,
          existingFeatures,
          wonderSlug: slugify(id),
        });
        if (!quiet && (matchedCount || createdCount)) {
          status?.show(
            `Matched ${matchedCount} feature${matchedCount === 1 ? "" : "s"} to existing Features, created ${createdCount} new one${createdCount === 1 ? "" : "s"}.`,
            { type: "info", timeout: 4000 }
          );
        }
        if (errors?.length) {
          status?.show(
            `${entity.name || id}: ${errors.length} feature${errors.length === 1 ? "" : "s"} couldn't be converted (see console) — the rest of the wonder saved fine.`,
            { type: "warning", timeout: 6000 }
          );
        }
      }
    } else if (entity.kind === "species" || entity.kind === "variant" || entity.kind === "class") {
      // Same automatic-on-save promotion as Monster/Wonder above, via the
      // simpler generic engine (content-feature-matching.js) — a Species'
      // `traits[]`, a Class's `features[]` (class-level features, currently
      // only from ddb-class.json's import — the free 5e-api SRD source has
      // no viable single-fetch path to this content), or a Variant's
      // `features[]` (subclass features) become real `feature` Library
      // references instead of staying embedded flavor text. Species/Class/
      // Variant have no dedicated authoring tool (unlike Monster/Crucible
      // or Wonder/Vault) — Loom's saveEntity is their only save path.
      // Unlike Character above (mergeImportedCharacterData explicitly
      // preserves featureIds/featureParams), a fresh Species/Variant/Class
      // scrape never carried that forward, so this does the same
      // preservation here — without it, re-importing an already-imported
      // record wrongly excludes its own already-created "unique"-scoped
      // Features from matching, forcing every entry through create/
      // overwrite on every re-import (silently fine for byte-identical
      // text, but a real duplicate for anything hand-edited since).
      try {
        const existingRecord = await dataManager.get(entity.kind, id, { preferLocal: false });
        if (existingRecord?.payload?.featureIds) data.featureIds = existingRecord.payload.featureIds;
        if (existingRecord?.payload?.featureParams) data.featureParams = existingRecord.payload.featureParams;
        // dataManager.save is a full file overwrite, not a merge — a field
        // neither mapping produces would otherwise be silently wiped on
        // re-import. None of these five are derivable from either source:
        // `names` (Forge's NPC name-generator tables read this),
        // `icon`/`image`/`tagline` (hand-curated display metadata),
        // `updated_at` (DDB's species page has no such timestamp; only
        // matters for the DDB path).
        if (entity.kind === "species") {
          for (const field of ["names", "icon", "image", "tagline", "updated_at"]) {
            if (data[field] == null && existingRecord?.payload?.[field] != null) {
              data[field] = existingRecord.payload[field];
            }
          }
        }
      } catch (error) {
        // No existing record at this id — nothing to preserve, first import.
      }
      const sourceField = entity.kind === "species" ? "traits" : "features";
      if (hasEmbeddedFeatures(data, sourceField)) {
        const existingFeatures = await fetchKindEntriesWithIds(dataManager, "feature").then(
          (entries) => entries.map((entry) => ({ id: entry.id, ...entry.entity })),
          () => []
        );
        // Variant's own `parentId` (e.g. "barbarian") scopes a new one-off's
        // id by CLASS — nearly every subclass never actually collides on a
        // feature name, so this class-level default keeps their ids stable
        // across re-import; escalating everything to subclass-scoped would
        // change every already-imported feature's id, not just the
        // genuinely-colliding ones.
        // `disambiguationSlug` — the variant's own compound id (e.g.
        // "artificer-cartographer") — is a fallback only, used by
        // promoteEmbeddedFeatures to escalate a detected same-class-
        // different-content collision (e.g. every Artificer subclass has
        // its own "Tools of the Trade") to a more specific id instead of
        // silently overwriting.
        // Species/Class scope by their own name instead (no parent, no
        // finer-grained fallback below the Species/Class level itself).
        const parentPath = entity.kind === "variant" ? data.parentId || data.name : data.name;
        const disambiguationSlug = entity.kind === "variant" ? id : undefined;
        const isSpeciesDomain = entity.kind === "species" || (entity.kind === "variant" && data.parentKind === "species");
        // Cross-scope healing (Epic Boon/Extra Attack's "genuinely identical
        // across records" reuse) is allowed for both Class-feature and
        // Species/racial-variant — a real, distinct FEATURE (Darkvision,
        // Flight) worded identically across two species is fine to share,
        // same as Epic Boon. Only safe because Speed/Size/Height/Weight
        // aren't features at all (see excludeSpeciesPropertyTraits below) —
        // once those never reach promotion, sharing an actual feature's
        // exact text across species is legitimate too.
        const allowCrossScopeMatch = true;
        // Species' own scraped traits mix universal-shape PROPERTIES
        // (Height/Weight, Size, Speed, Creature Type, Ability Score
        // Increases, Languages, Life Span — fill-in-the-blank facts, not a
        // distinctive mechanic) in with actual FEATURES — none of the
        // former belong in the Feature library.
        const { matchedCount, createdCount, updatedCount, errors } = await promoteEmbeddedFeatures(data, {
          sourceField,
          parentPath,
          disambiguationSlug,
          allowCrossScopeMatch,
          excludeSpeciesPropertyTraits: isSpeciesDomain,
          category: "character",
          dataManager,
          existingFeatures,
        });
        if (!quiet && (matchedCount || createdCount || updatedCount)) {
          status?.show(describeFeaturePromotionOutcome({ matchedCount, createdCount, updatedCount }), { type: "info", timeout: 4000 });
        }
        if (errors?.length) {
          status?.show(
            `${entity.name || id}: ${errors.length} feature${errors.length === 1 ? "" : "s"} couldn't be converted (see console) — the rest of the ${entity.kind} saved fine.`,
            { type: "warning", timeout: 6000 }
          );
        }
      }
    }
    await dataManager.save(entity.kind, id, data);
    if (!quiet) {
      status?.show(`Saved ${entity.kind}/${id}.json.`, { type: "success", timeout: 2000 });
      loadRecentSaves();
    }
    await autoLinkEntityToSystems(entity.kind, id, data);
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

function renderEntities() {
  if (!entitiesList || !entitiesSummary) return;
  entitiesList.innerHTML = "";
  const entities = deriveEntities(lastMappedResult);
  if (!entities.length) {
    entitiesSummary.textContent =
      "No save-able entities in this mapping's output (expects a top-level {kind, name}, plus optionally top-level arrays of named items).";
    entitiesSaveAllButton?.classList.add("d-none");
    return;
  }
  const counts = {};
  entities.forEach((entity) => {
    counts[entity.kind] = (counts[entity.kind] || 0) + 1;
  });
  entitiesSummary.textContent = `This produced: ${Object.entries(counts)
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`)
    .join(" + ")}`;
  // Only worth its own button when there's more than one Save to loop —
  // a single entity already has its own row's own Save button right there.
  entitiesSaveAllButton?.classList.toggle("d-none", entities.length <= 1);

  entities.forEach((entity) => {
    const row = document.createElement("div");
    row.className = "d-flex align-items-center justify-content-between border rounded-3 px-2 py-1";
    const label = document.createElement("span");
    label.className = "small";
    label.textContent = `${entity.name} (${entity.kind})`;
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-outline-primary btn-sm";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => saveEntity(entity));
    row.append(label, saveBtn);
    entitiesList.appendChild(row);
  });
}

// Loops the same one-at-a-time saveEntity() a manual per-row Save click
// uses, minus its window.prompt — same `autoId` fallback the bulk-import
// loop relies on, so Save All never pops up N prompts. Sequential, not
// Promise.all, same reason as the bulk-import loop: Feature-matching
// benefits from running in order. Deliberately NOT passing `quiet` — Save
// All should behave exactly like clicking every row's Save button in
// sequence, including each entity's own toasts, not one silent batch with a
// summary at the end.
async function saveAllEntities() {
  if (!entitiesSaveAllButton) return;
  const entities = deriveEntities(lastMappedResult);
  if (!entities.length) return;
  entitiesSaveAllButton.disabled = true;
  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i];
    if (entitiesSaveAllProgress) entitiesSaveAllProgress.textContent = `Saving ${i + 1} of ${entities.length} (${entity.name})…`;
    const autoId = entity.data?.index || slugify(entity.name);
    await saveEntity(entity, { autoId });
  }
  entitiesSaveAllButton.disabled = false;
  if (entitiesSaveAllProgress) entitiesSaveAllProgress.textContent = "";
}
entitiesSaveAllButton?.addEventListener("click", saveAllEntities);

// --- Recent saves ------------------------------------------------------

async function loadRecentSaves() {
  if (!recentSavesContainer) return;
  let entries = [];
  try {
    const kinds = await loadLibraryKinds();
    const lists = await Promise.all(
      kinds.map(async (kind) => {
        if (!dataManager) return [];
        const { remote } = await dataManager.list(kind.id, { refresh: true, includeLocal: false });
        const items = dataManager.collectListEntries(remote, ["owned", "shared", "public"]);
        return items.map((entry) => ({
          kind: kind.id,
          filename: entry.id,
          modified: entry.modified_at ? Date.parse(entry.modified_at) / 1000 : 0,
        }));
      })
    );
    entries = lists.flat().sort((a, b) => b.modified - a.modified).slice(0, 15);
  } catch (error) {
    return;
  }
  recentSavesContainer.innerHTML = "";
  if (!entries.length) {
    const p = document.createElement("p");
    p.className = "small text-body-secondary mb-0";
    p.textContent = "No saved entries yet.";
    recentSavesContainer.appendChild(p);
    return;
  }
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "small";
    const when = entry.modified ? new Date(entry.modified * 1000).toLocaleString() : "";
    row.textContent = `${entry.kind}/${entry.filename}${when ? ` — ${when}` : ""}`;
    recentSavesContainer.appendChild(row);
  });
}

if (recentSavesRefreshButton) {
  recentSavesRefreshButton.addEventListener("click", () => loadRecentSaves());
}

if (recentSavesToggle && recentSavesPanel) {
  bindCollapsibleToggle(recentSavesToggle, recentSavesPanel, {
    collapsed: true,
    expandLabel: "Expand recent saves",
    collapseLabel: "Collapse recent saves",
  });
}

// --- View tabs (Import / Library / Systems) ---------------------------------
// Same nav-tabs convention as every other top-level view switcher. Only the
// active view's cards show, in the main pane AND the side panes (the
// mapping toolbar/palette/sample-data and tree Inspector are Import-only;
// Library/Systems carry their own pickers/toolbars inline).
const LOOM_VIEWS = ["import", "library", "systems", "macros", "features", "users", "groups", "auth"];
const loomViewTabsContainer = document.querySelector("[data-loom-view-tabs]");

function setLoomView(view) {
  if (!LOOM_VIEWS.includes(view)) return;
  document.querySelectorAll("[data-loom-view-tab]").forEach((tab) => {
    const isActive = tab.dataset.loomViewTab === view;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  // Same `.hidden` + `.d-none` combo as everywhere else — these panels
  // carry `.d-flex`, which Bootstrap declares `!important` and beats the
  // plain `[hidden]` UA rule alone.
  document.querySelectorAll("[data-loom-view-panel]").forEach((panel) => {
    const visible = panel.dataset.loomViewPanel === view;
    panel.hidden = !visible;
    panel.classList.toggle("d-none", !visible);
  });
  if (view === "groups") {
    void loomLoadGroups();
  } else if (view === "users") {
    void loomLoadUsers();
  } else if (view === "library") {
    void loomLoadLibraryTable();
  } else if (view === "macros") {
    void populateMacroSelect();
  } else if (view === "features") {
    void populateFeatureSelect();
  } else if (view === "auth") {
    void loomRenderAuthStatus();
  }
}

if (loomViewTabsContainer) {
  loomViewTabsContainer.addEventListener("click", (event) => {
    const button = event.target.closest("[data-loom-view-tab]");
    if (!button) return;
    setLoomView(button.dataset.loomViewTab);
  });
}

// --- Groups & Users tabs (ported from the retired Admin tool — Loom is now
// the suite's data-administration surface, tier-gated per tab below) --------
mountField("groups-select", createCompactField({ type: "select", id: "loomGroupsSelect", label: "Group", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-loom-groups-select" }));
mountField("group-name", createCompactField({ type: "text", id: "loomGroupName", label: "Name", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-loom-group-name" }));
mountField("group-system", createCompactField({ type: "select", id: "loomGroupSystem", label: "System", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-loom-group-system", helpTopic: "loom.groupSystem" }));
mountField("group-setting", createCompactField({ type: "select", id: "loomGroupSetting", label: "Setting", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-loom-group-setting", helpTopic: "loom.groupSetting" }));
mountField("group-template", createCompactField({ type: "select", id: "loomGroupTemplate", label: "Party Template", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-loom-group-template", helpTopic: "loom.groupTemplate" }));
mountField(
  "users-tier-filter",
  createCompactField({ type: "select", id: "loomUsersTierFilter", label: "Tier", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select form-select-sm", dataAttr: "data-loom-users-tier-filter" })
);
mountField("users-select", createCompactField({ type: "select", id: "loomUsersSelect", label: "User", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-loom-users-select" }));
mountField("user-username", createCompactField({ type: "text", id: "loomUserUsername", label: "Username", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-loom-user-username", disabled: true }));
mountField("user-email", createCompactField({ type: "email", id: "loomUserEmail", label: "Email", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-loom-user-email" }));
mountField(
  "user-password",
  createCompactField({ type: "password", id: "loomUserPassword", label: "Password", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-loom-user-password", autocomplete: "new-password" })
);
mountField("user-tier", createCompactField({ type: "select", id: "loomUserTier", label: "Tier", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-loom-user-tier" }));
mountField(
  "user-status",
  createCompactField({
    type: "select", id: "loomUserStatus", label: "Status", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-loom-user-status",
    options: [
      { value: "1", label: "Active" },
      { value: "0", label: "Inactive" },
    ],
  })
);
mountField(
  "auth-ddb-cookie",
  createCompactField({ type: "password", id: "loomAuthDdbCookie", label: "New session cookie", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-loom-auth-ddb-cookie", autocomplete: "off" })
);
mountField(
  "auth-anthropic-key",
  createCompactField({ type: "password", id: "loomAuthAnthropicKey", label: "New API key", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-loom-auth-anthropic-key", autocomplete: "off" })
);

const loomGroupsMessage = document.querySelector("[data-loom-groups-message]");
const loomGroupsSelect = document.querySelector("[data-loom-groups-select]");
const loomGroupEmpty = document.querySelector("[data-loom-group-empty]");
const loomGroupForm = document.querySelector("[data-loom-group-form]");
const loomGroupNameInput = document.querySelector("[data-loom-group-name]");
const loomGroupSystemSelect = document.querySelector("[data-loom-group-system]");
const loomGroupSettingSelect = document.querySelector("[data-loom-group-setting]");
const loomGroupTemplateSelect = document.querySelector("[data-loom-group-template]");
const loomGroupPropertyRows = document.querySelector("[data-loom-group-property-rows]");
const loomGroupMembersList = document.querySelector("[data-loom-group-members]");
const loomGroupMembersEmpty = document.querySelector("[data-loom-group-members-empty]");
const loomGroupShareBadge = document.querySelector("[data-loom-group-share-badge]");
const loomGroupShareGenerateButton = document.querySelector("[data-loom-group-share-generate]");
const loomGroupShareCopyButton = document.querySelector("[data-loom-group-share-copy]");
const loomGroupShareDisableButton = document.querySelector("[data-loom-group-share-disable]");
const loomGroupShareStatus = document.querySelector("[data-loom-group-share-status]");
const loomGroupNewButton = document.querySelector("[data-loom-group-new]");
const loomGroupSaveButton = document.querySelector("[data-loom-group-save]");
const loomGroupDuplicateButton = document.querySelector("[data-loom-group-duplicate]");
const loomGroupDeleteButton = document.querySelector("[data-loom-group-delete]");

// Property Inspector (right pane) — same mechanism as Systems' own
// (createPropertyInspector below). Collapsible, expanded by default for the
// same reason Systems' own is.
const groupInspectorEmpty = document.querySelector("[data-loom-group-inspector-empty]");
const groupInspectorDetails = document.querySelector("[data-loom-group-inspector-details]");
const groupInspectorFields = document.querySelector("[data-loom-group-inspector-fields]");
const groupInspectorNewButton = document.querySelector("[data-loom-group-inspector-new]");
const groupInspectorDeleteButton = document.querySelector("[data-loom-group-inspector-delete]");
const groupInspectorDuplicateButton = document.querySelector("[data-loom-group-inspector-duplicate]");
const groupInspectorRequiredButton = document.querySelector("[data-loom-group-inspector-required]");
const groupInspectorContent = document.querySelector("[data-loom-group-inspector-content]");
const groupInspectorSection = createCollapsibleSection({
  label: "Property Inspector",
  collapsed: false,
  content: groupInspectorContent,
}).section;
document.querySelector("[data-loom-group-inspector-mount]")?.appendChild(groupInspectorSection);

// Share link (right pane) — same static controls, moved into a collapsible
// section (existing static content div adopted as-is). Expanded by default,
// unlike Assigned Systems/Settings — a campaign's share link is the one
// thing a GM reaches for right after picking a group.
const loomGroupShareList = document.querySelector("[data-loom-group-share-list]");
const loomGroupShareSection = createCollapsibleSection({
  label: "Share link",
  collapsed: false,
  content: loomGroupShareList,
}).section;
document.querySelector("[data-loom-group-share-mount]")?.appendChild(loomGroupShareSection);

const loomUsersTierFilter = document.querySelector("[data-loom-users-tier-filter]");
const loomUsersSelect = document.querySelector("[data-loom-users-select]");
const loomUsersEmpty = document.querySelector("[data-loom-users-empty]");
const loomUsersForm = document.querySelector("[data-loom-users-form]");
const loomUserUsernameInput = document.querySelector("[data-loom-user-username]");
const loomUserEmailInput = document.querySelector("[data-loom-user-email]");
const loomUserTierSelect = document.querySelector("[data-loom-user-tier]");
const loomUserStatusInput = document.querySelector("[data-loom-user-status]");
const loomUserCreatedInput = document.querySelector("[data-loom-user-created]");
const loomUserLastActivityInput = document.querySelector("[data-loom-user-last-activity]");
const loomUserSaveButton = document.querySelector("[data-loom-user-save]");
const loomUserDuplicateButton = document.querySelector("[data-loom-user-duplicate]");
const loomUserDeleteButton = document.querySelector("[data-loom-user-delete]");
const loomUserNewButton = document.querySelector("[data-loom-user-new]");
const loomUserPasswordField = document.querySelector("[data-loom-user-password-field]");
const loomUserPasswordInput = document.querySelector("[data-loom-user-password]");

const LOOM_TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "player", label: "Player" },
  { value: "gm", label: "GM" },
  { value: "creator", label: "Creator" },
  { value: "admin", label: "Admin" },
];

const loomGroupsState = {
  items: [],
  loading: false,
  stale: true,
  selectedId: "",
  cleanName: null,
  cleanSystemId: null,
  cleanSettingId: null,
  cleanTemplateId: null,
  // JSON.stringify of the loaded group's `properties` schema — same
  // clean-baseline-snapshot shape as cleanName/cleanSystemId/cleanSettingId
  // above, for the Properties editor instead of a plain field.
  cleanPropertiesJson: null,
};
// Populated once per Groups-tab session rather than re-fetched on every
// render — same "load list, then render against it" split
// loomOwnedCharacters uses for the member picker.
let loomGroupSystemsCatalog = [];
// Same load-once shape as loomGroupSystemsCatalog, sourced from the same
// listAllSettings() the Assigned Settings checkboxes use — not filtered to
// the Group's selected System; a mismatched pairing is a GM authoring
// concern, not something this picker enforces.
let loomGroupSettingsCatalog = [];
const loomUsersState = { items: [], selectedTier: "", selectedUsername: "", clean: null, mode: "view" };
// Populated alongside loomLoadGroups() — the member picker needs the
// signed-in user's own saved characters; a lightweight Groups-tab-local
// fetch rather than porting Admin's whole Owned Content view-state machine
// over.
let loomOwnedCharacters = [];

function isLoomAdminSession() {
  return dataManager?.session?.user?.tier === "admin";
}

function loomFormatTier(tier) {
  if (!tier) return "Free";
  const option = LOOM_TIER_OPTIONS.find((item) => item.value === tier);
  return option ? option.label : tier;
}

const loomDateFormatter = typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function"
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
  : null;

function loomFormatTimestamp(value, fallback = "Unknown") {
  if (!value) return fallback;
  let source = value;
  if (typeof source === "string" && source.includes(" ") && !source.includes("T")) {
    source = source.replace(" ", "T");
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return value || fallback;
  return loomDateFormatter ? loomDateFormatter.format(date) : date.toLocaleString();
}

function loomFormatLastActivity(value) {
  return loomFormatTimestamp(value, "Never");
}

// --- Users tab ---------------------------------------------------------------
// Left pane: Tier filter + User select. Center pane: a full editable form —
// Save commits Email + Tier together via explicit toolbar buttons, same
// convention as Library/Systems, rather than the old table's
// auto-save-on-change tier select.

function loomPopulateUsersTierFilter() {
  if (!loomUsersTierFilter) return;
  const previous = loomUsersState.selectedTier;
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All tiers";
  fragment.appendChild(allOption);
  LOOM_TIER_OPTIONS.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    fragment.appendChild(opt);
  });
  loomUsersTierFilter.replaceChildren(fragment);
  loomUsersTierFilter.value = previous;
}

function loomFindUser(username) {
  return loomUsersState.items.find((user) => user.username === username) || null;
}

function loomRenderUsersSelect() {
  if (!loomUsersSelect) return;
  const selectedTier = loomUsersState.selectedTier;
  const users = selectedTier ? loomUsersState.items.filter((user) => user.tier === selectedTier) : loomUsersState.items;
  const sorted = [...users].sort((a, b) => (a.username || "").localeCompare(b.username || ""));
  const fragment = document.createDocumentFragment();
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = sorted.length ? "Select a user…" : "No users of this tier";
  fragment.appendChild(blank);
  sorted.forEach((user) => {
    const option = document.createElement("option");
    option.value = user.username;
    option.textContent = `${user.username} (${loomFormatTier(user.tier)})`;
    fragment.appendChild(option);
  });
  loomUsersSelect.replaceChildren(fragment);
  const stillValid = loomUsersState.selectedUsername && sorted.some((user) => user.username === loomUsersState.selectedUsername);
  loomUsersSelect.value = stillValid ? loomUsersState.selectedUsername : "";
  if (!stillValid) loomUsersState.selectedUsername = "";
  loomRenderUserForm();
}

function loomUserFormSnapshot() {
  return {
    email: (loomUserEmailInput?.value || "").trim(),
    tier: loomUserTierSelect?.value || "",
    status: loomUserStatusInput?.value || "1",
  };
}

function loomCanSaveUser() {
  if (loomUsersState.mode === "new") {
    return Boolean(
      (loomUserUsernameInput?.value || "").trim() &&
        (loomUserEmailInput?.value || "").trim() &&
        (loomUserPasswordInput?.value || "").trim()
    );
  }
  if (!loomUsersState.selectedUsername || !loomUsersState.clean) return false;
  const current = loomUserFormSnapshot();
  return (
    current.email !== loomUsersState.clean.email ||
    current.tier !== loomUsersState.clean.tier ||
    current.status !== loomUsersState.clean.status
  );
}

function loomUpdateUserToolbarState() {
  const isSelf = dataManager?.session?.user?.username === loomUsersState.selectedUsername;
  const lockSelfFields = loomUsersState.mode !== "new" && isSelf;
  if (loomUserSaveButton) loomUserSaveButton.disabled = !loomCanSaveUser();
  if (loomUserDuplicateButton) loomUserDuplicateButton.disabled = loomUsersState.mode === "new" || !loomUsersState.selectedUsername;
  if (loomUserDeleteButton) loomUserDeleteButton.disabled = loomUsersState.mode === "new" || !loomUsersState.selectedUsername;
  if (loomUserTierSelect) loomUserTierSelect.disabled = lockSelfFields;
  if (loomUserStatusInput) loomUserStatusInput.disabled = lockSelfFields;
}

function loomPopulateUserTierOptions() {
  if (!loomUserTierSelect) return;
  loomUserTierSelect.replaceChildren(
    ...LOOM_TIER_OPTIONS.map((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      return opt;
    })
  );
}

function loomRenderUserForm() {
  loomUsersState.mode = "view";
  if (loomUserPasswordField) loomUserPasswordField.hidden = true;
  if (loomUserPasswordInput) loomUserPasswordInput.value = "";
  if (loomUserUsernameInput) loomUserUsernameInput.disabled = true;
  const user = loomFindUser(loomUsersState.selectedUsername);
  const hasUser = Boolean(user);
  if (loomUsersEmpty) loomUsersEmpty.hidden = hasUser;
  if (loomUsersForm) loomUsersForm.classList.toggle("d-none", !hasUser);
  if (!hasUser) {
    loomUsersState.clean = null;
    loomUpdateUserToolbarState();
    return;
  }
  if (loomUserUsernameInput) loomUserUsernameInput.value = user.username;
  if (loomUserEmailInput) loomUserEmailInput.value = user.email || "";
  loomPopulateUserTierOptions();
  if (loomUserTierSelect) loomUserTierSelect.value = user.tier;
  if (loomUserStatusInput) loomUserStatusInput.value = user.is_active ? "1" : "0";
  if (loomUserCreatedInput) loomUserCreatedInput.textContent = loomFormatTimestamp(user.created_at, "Unknown");
  if (loomUserLastActivityInput) {
    loomUserLastActivityInput.textContent = loomFormatLastActivity(user.last_activity || user.last_login || user.created_at);
  }
  loomUsersState.clean = loomUserFormSnapshot();
  loomUpdateUserToolbarState();
}

async function loomLoadUsers({ force = false } = {}) {
  if (!isLoomAdminSession()) return;
  if (!force && loomUsersState.items.length) {
    loomPopulateUsersTierFilter();
    loomRenderUsersSelect();
    return;
  }
  try {
    const payload = await dataManager.listUsers();
    const users = Array.isArray(payload?.users) ? payload.users : [];
    loomUsersState.items = users;
    loomPopulateUsersTierFilter();
    loomRenderUsersSelect();
  } catch (error) {
    if (status) status.show(error.message || "Unable to load users", { type: "danger" });
  }
}

if (loomUsersTierFilter) {
  loomUsersTierFilter.addEventListener("change", () => {
    loomUsersState.selectedTier = loomUsersTierFilter.value || "";
    loomRenderUsersSelect();
  });
}

if (loomUsersSelect) {
  loomUsersSelect.addEventListener("change", () => {
    loomUsersState.selectedUsername = loomUsersSelect.value || "";
    loomRenderUserForm();
  });
}

if (loomUserEmailInput) {
  loomUserEmailInput.addEventListener("input", loomUpdateUserToolbarState);
}

if (loomUserTierSelect) {
  loomUserTierSelect.addEventListener("change", loomUpdateUserToolbarState);
}

if (loomUserStatusInput) {
  loomUserStatusInput.addEventListener("change", loomUpdateUserToolbarState);
}

if (loomUserUsernameInput) {
  loomUserUsernameInput.addEventListener("input", loomUpdateUserToolbarState);
}

if (loomUserPasswordInput) {
  loomUserPasswordInput.addEventListener("input", loomUpdateUserToolbarState);
}

if (loomUserNewButton) {
  loomUserNewButton.addEventListener("click", () => {
    loomUsersState.selectedUsername = "";
    if (loomUsersSelect) loomUsersSelect.value = "";
    loomUsersState.mode = "new";
    loomUsersState.clean = null;
    if (loomUsersEmpty) loomUsersEmpty.hidden = true;
    if (loomUsersForm) loomUsersForm.classList.remove("d-none");
    if (loomUserUsernameInput) {
      loomUserUsernameInput.disabled = false;
      loomUserUsernameInput.value = "";
    }
    if (loomUserEmailInput) loomUserEmailInput.value = "";
    if (loomUserPasswordField) loomUserPasswordField.hidden = false;
    if (loomUserPasswordInput) loomUserPasswordInput.value = "";
    loomPopulateUserTierOptions();
    if (loomUserTierSelect) loomUserTierSelect.value = "free";
    if (loomUserStatusInput) loomUserStatusInput.value = "1";
    if (loomUserCreatedInput) loomUserCreatedInput.textContent = "—";
    if (loomUserLastActivityInput) loomUserLastActivityInput.textContent = "—";
    loomUpdateUserToolbarState();
    loomUserUsernameInput?.focus();
  });
}

// A real user account can't be cloned the way content records can —
// username/email must be genuinely unique and a password can't be copied —
// so Duplicate here means "start a New user prefilled with this one's Tier"
// rather than a true clone: a real shortcut for an admin adding another
// account at the same access level, without pretending to copy identity or
// credentials it has no business copying.
if (loomUserDuplicateButton) {
  loomUserDuplicateButton.addEventListener("click", () => {
    const sourceUser = loomFindUser(loomUsersState.selectedUsername);
    if (!sourceUser) return;
    loomUsersState.selectedUsername = "";
    if (loomUsersSelect) loomUsersSelect.value = "";
    loomUsersState.mode = "new";
    loomUsersState.clean = null;
    if (loomUsersEmpty) loomUsersEmpty.hidden = true;
    if (loomUsersForm) loomUsersForm.classList.remove("d-none");
    if (loomUserUsernameInput) {
      loomUserUsernameInput.disabled = false;
      loomUserUsernameInput.value = "";
    }
    if (loomUserEmailInput) loomUserEmailInput.value = "";
    if (loomUserPasswordField) loomUserPasswordField.hidden = false;
    if (loomUserPasswordInput) loomUserPasswordInput.value = "";
    loomPopulateUserTierOptions();
    if (loomUserTierSelect) loomUserTierSelect.value = sourceUser.tier;
    if (loomUserStatusInput) loomUserStatusInput.value = "1";
    if (loomUserCreatedInput) loomUserCreatedInput.textContent = "—";
    if (loomUserLastActivityInput) loomUserLastActivityInput.textContent = "—";
    loomUpdateUserToolbarState();
    status?.show(`New user prefilled with ${loomFormatTier(sourceUser.tier)} tier — enter a username, email, and password.`, {
      type: "info",
      timeout: 3500,
    });
    loomUserUsernameInput?.focus();
  });
}

if (loomUserSaveButton) {
  loomUserSaveButton.addEventListener("click", async () => {
    if (loomUsersState.mode === "new") {
      const username = (loomUserUsernameInput?.value || "").trim();
      const email = (loomUserEmailInput?.value || "").trim();
      const password = (loomUserPasswordInput?.value || "").trim();
      const tier = loomUserTierSelect?.value || "free";
      if (!username || !email || !password) return;
      loomUserSaveButton.disabled = true;
      try {
        await dataManager.createUser({ username, email, password, tier });
        if (status) status.show(`Created ${username}.`, { type: "success", timeout: 2000 });
        loomUsersState.selectedUsername = username;
        await loomLoadUsers({ force: true });
      } catch (error) {
        if (status) status.show(error.message || "Unable to create user", { type: "danger" });
      } finally {
        loomUpdateUserToolbarState();
      }
      return;
    }
    const user = loomFindUser(loomUsersState.selectedUsername);
    if (!user || !loomUsersState.clean) return;
    const current = loomUserFormSnapshot();
    const emailChanged = current.email !== loomUsersState.clean.email;
    const tierChanged = current.tier !== loomUsersState.clean.tier;
    const statusChanged = current.status !== loomUsersState.clean.status;
    if (!emailChanged && !tierChanged && !statusChanged) return;
    loomUserSaveButton.disabled = true;
    try {
      if (emailChanged) {
        await dataManager.updateUserEmail(user.username, current.email);
        user.email = current.email;
      }
      if (tierChanged) {
        await dataManager.updateUserTier(user.username, current.tier);
        user.tier = current.tier;
      }
      if (statusChanged) {
        await dataManager.updateUserStatus(user.username, current.status === "1");
        user.is_active = current.status === "1";
      }
      if (status) status.show(`Saved ${user.username}.`, { type: "success", timeout: 2000 });
      loomUsersState.clean = loomUserFormSnapshot();
      loomRenderUsersSelect();
    } catch (error) {
      if (status) status.show(error.message || "Unable to save user", { type: "danger" });
    } finally {
      loomUpdateUserToolbarState();
    }
  });
}

if (loomUserDeleteButton) {
  loomUserDeleteButton.addEventListener("click", async () => {
    const user = loomFindUser(loomUsersState.selectedUsername);
    if (!user) return;
    const isSelf = dataManager?.session?.user?.username === user.username;
    const confirmationMessage = isSelf
      ? "Delete your own account? This will immediately end your session."
      : `Delete ${user.username}? This cannot be undone.`;
    if (!window.confirm(confirmationMessage)) return;
    loomUserDeleteButton.disabled = true;
    if (loomUserSaveButton) loomUserSaveButton.disabled = true;
    try {
      await dataManager.deleteUser(user.username);
      if (status) {
        status.show(isSelf ? "Your account has been deleted." : `Deleted ${user.username}.`, {
          type: "success",
          timeout: 2000,
        });
      }
      if (isSelf) {
        dataManager.clearSession();
        window.location.reload();
        return;
      }
      loomUsersState.selectedUsername = "";
      await loomLoadUsers({ force: true });
    } catch (error) {
      if (status) status.show(error.message || "Unable to delete user", { type: "danger" });
      loomUpdateUserToolbarState();
    }
  });
}

// --- Groups tab ---------------------------------------------------------------
// Left pane: Group select + New/Save/Delete toolbar. Center pane: the
// selected group's full detail — name, member roster, public share-link
// controls — same "one thing selected, details in the center pane"
// convention Library/Users/Systems use.

function loomRenderGroupsMessage(message) {
  const text = typeof message === "string" ? message.trim() : "";
  const hasMessage = Boolean(text);
  if (loomGroupsMessage) {
    loomGroupsMessage.textContent = text;
    loomGroupsMessage.hidden = !hasMessage;
  }
  if (loomGroupsSelect) loomGroupsSelect.hidden = hasMessage;
}

function loomFindGroup(id) {
  return loomGroupsState.items.find((group) => group.id === id) || null;
}

function loomFormatGroupCharacterLabel(entry) {
  if (!entry) return "Character";
  const id =
    typeof entry.id === "string" && entry.id
      ? entry.id
      : typeof entry.content_id === "string" && entry.content_id
        ? entry.content_id
        : "";
  const rawName = entry.label || entry.name || entry.title || id;
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : id || "Character";
  const rawTemplate = entry.template_title || entry.templateTitle || entry.template || entry.template_id;
  const templateLabel = typeof rawTemplate === "string" && rawTemplate.trim() ? rawTemplate.trim() : "";
  return templateLabel ? `${name} (${templateLabel})` : name;
}

// Workbench's own bootstrap reads ?record=<bucket>:<id>&share=<token> to
// pick a view and load the shared record, so every share link this tab
// generates must resolve to workbench/index.html.
function loomBuildShareUrl(bucket, id, token = "") {
  const pageMap = { groups: "../workbench/index.html" };
  const page = pageMap[bucket];
  if (!page) return window.location.href;
  const record = `${bucket}:${id}`;
  const url = new URL(page, window.location.href);
  url.searchParams.set("record", record);
  if (token) {
    url.searchParams.set("share", token);
  } else {
    url.searchParams.delete("share");
  }
  return url.toString();
}

async function loomCopyShareLink(url) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(url);
      if (status) status.show("Copied share link to clipboard", { type: "success", timeout: 1800 });
      return true;
    }
  } catch (error) {
    console.warn("Clipboard write failed", error);
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (successful && status) status.show("Copied share link to clipboard", { type: "success", timeout: 1800 });
    return successful;
  } catch (error) {
    console.warn("Fallback clipboard copy failed", error);
    if (status) status.show("Unable to copy link", { type: "danger" });
    return false;
  }
}

function loomRenderGroupsSelect() {
  if (!loomGroupsSelect) return;
  const list = loomGroupsState.items;
  if (!list.length) {
    loomRenderGroupsMessage("No groups yet. Create one to start organizing characters.");
    loomGroupsState.selectedId = "";
    loomRenderGroupDetail();
    return;
  }
  loomRenderGroupsMessage("");
  const sorted = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const fragment = document.createDocumentFragment();
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Select a group…";
  fragment.appendChild(blank);
  sorted.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.name || "Campaign group";
    fragment.appendChild(option);
  });
  loomGroupsSelect.replaceChildren(fragment);
  const stillValid = loomGroupsState.selectedId && sorted.some((group) => group.id === loomGroupsState.selectedId);
  loomGroupsSelect.value = stillValid ? loomGroupsState.selectedId : "";
  if (!stillValid) loomGroupsState.selectedId = "";
  loomRenderGroupDetail();
}

// The shared row editor (property-schema-editor.js) is undo/dirty-tracking-
// agnostic — unlike Systems (which plugs into Loom's whole-tab undo stack),
// the Groups tab has no undo stack at all, so this just marks the tab dirty
// via the same loomUpdateGroupsToolbarState() every other Group field
// change calls.
const groupPropertyCtx = {
  runChange: (fn) => {
    fn();
    loomUpdateGroupsToolbarState();
  },
  refreshTooltips,
  initHelpSystem,
  get status() {
    return status;
  },
  get dataManager() {
    return dataManager;
  },
  // No filterSystemId — a Group Property's own Library-linked values aren't
  // scoped to any System (every entity of the chosen kind is offered
  // regardless of the group's assigned System).
  //
  // "Public" — the one Group-only addition Systems has no equivalent of (no
  // System/Character field has a party-wide "who may edit this" concept).
  // Only added to TOP-LEVEL rows — nested sub-fields inherit their parent's
  // flag, same as this suite's other "permission lives on the whole field"
  // precedents.
  extraRowControls: (row, field) => {
    if (row.parentElement !== loomGroupPropertyRows) return;
    const firstLine = row.firstElementChild;
    const removeButton = firstLine?.querySelector("[data-property-remove]");
    if (!removeButton) return;
    const publicButton = document.createElement("button");
    publicButton.type = "button";
    publicButton.className = `btn btn-sm flex-shrink-0 ${field.public ? "btn-primary" : "btn-outline-secondary"}`;
    publicButton.setAttribute("data-property-public", "");
    publicButton.setAttribute("aria-pressed", field.public ? "true" : "false");
    publicButton.setAttribute("data-bs-toggle", "tooltip");
    publicButton.setAttribute("data-bs-placement", "top");
    publicButton.setAttribute("data-bs-title", "Public — any party member can edit this property's value");
    publicButton.setAttribute("aria-label", "Public");
    publicButton.innerHTML = '<span class="iconify" data-icon="tabler:users" aria-hidden="true"></span>';
    publicButton.addEventListener("click", () => {
      groupPropertyCtx.runChange(() => {
        const pressed = publicButton.getAttribute("aria-pressed") === "true";
        publicButton.setAttribute("aria-pressed", pressed ? "false" : "true");
        publicButton.classList.toggle("btn-primary", !pressed);
        publicButton.classList.toggle("btn-outline-secondary", pressed);
      });
    });
    firstLine.insertBefore(publicButton, removeButton);
    refreshTooltips(row);
  },
};

// Same as collectFieldFromRow, plus merging this row's own "Public" toggle
// back in — collectFieldFromRow has no idea that concept exists, so this
// reads it straight off the row's button. Assigned as
// groupPropertyCtx.collectField so the Property Inspector's Duplicate
// button preserves Public too, not just collectGroupProperties.
function collectGroupFieldFromRow(row) {
  const field = collectFieldFromRow(row, groupPropertyCtx);
  const publicButton = row.firstElementChild?.querySelector("[data-property-public]");
  if (publicButton) field.public = publicButton.getAttribute("aria-pressed") === "true";
  return field;
}

function collectGroupProperties() {
  if (!loomGroupPropertyRows) return [];
  return Array.from(loomGroupPropertyRows.children).map(collectGroupFieldFromRow).filter((field) => field.key);
}

function loomRenderGroupPropertyRows(properties) {
  if (!loomGroupPropertyRows) return;
  loomGroupPropertyRows.innerHTML = "";
  (properties || []).forEach((field) => renderPropertyRow(field, loomGroupPropertyRows, groupPropertyCtx));
}

function loomCanSaveGroup() {
  if (!loomGroupsState.selectedId || loomGroupsState.cleanName === null) return false;
  const nameChanged = (loomGroupNameInput?.value || "").trim() !== loomGroupsState.cleanName;
  const systemChanged = (loomGroupSystemSelect?.value || "") !== (loomGroupsState.cleanSystemId || "");
  const settingChanged = (loomGroupSettingSelect?.value || "") !== (loomGroupsState.cleanSettingId || "");
  const templateChanged = (loomGroupTemplateSelect?.value || "") !== (loomGroupsState.cleanTemplateId || "");
  const propertiesChanged = JSON.stringify(collectGroupProperties()) !== (loomGroupsState.cleanPropertiesJson ?? "[]");
  return nameChanged || systemChanged || settingChanged || templateChanged || propertiesChanged;
}

function loomUpdateGroupsToolbarState() {
  if (loomGroupSaveButton) loomGroupSaveButton.disabled = !loomCanSaveGroup();
  if (loomGroupDuplicateButton) loomGroupDuplicateButton.disabled = !loomGroupsState.selectedId;
  if (loomGroupDeleteButton) loomGroupDeleteButton.disabled = !loomGroupsState.selectedId;
}

function loomUpdateGroupShareDisplay(group, nextLink) {
  const link = nextLink || group?.share_link;
  if (link && link.token) {
    const url = loomBuildShareUrl("groups", group.id, link.token);
    if (loomGroupShareBadge) {
      loomGroupShareBadge.className = "badge text-bg-success align-self-start";
      loomGroupShareBadge.textContent = "Link active";
    }
    if (loomGroupShareCopyButton) {
      loomGroupShareCopyButton.hidden = false;
      loomGroupShareCopyButton.dataset.shareUrl = url;
    }
    if (loomGroupShareDisableButton) loomGroupShareDisableButton.hidden = false;
    if (loomGroupShareStatus) loomGroupShareStatus.textContent = url;
    if (loomGroupShareGenerateButton) loomGroupShareGenerateButton.hidden = true;
  } else {
    if (loomGroupShareBadge) {
      loomGroupShareBadge.className = "badge text-bg-secondary align-self-start";
      loomGroupShareBadge.textContent = "No link";
    }
    if (loomGroupShareCopyButton) {
      loomGroupShareCopyButton.hidden = true;
      loomGroupShareCopyButton.dataset.shareUrl = "";
    }
    if (loomGroupShareDisableButton) loomGroupShareDisableButton.hidden = true;
    if (loomGroupShareStatus) loomGroupShareStatus.textContent = "No link yet.";
    if (loomGroupShareGenerateButton) loomGroupShareGenerateButton.hidden = false;
  }
}

// Options for the Group System select — "None" (falls through to each
// character's own Assigned System, then the standard 7) plus every System
// listAllSystems() knows about. Rebuilds the whole option list each time
// (cheap, simplest way to stay in sync with loomGroupSystemsCatalog) then
// restores whichever value loomRenderGroupDetail sets afterward.
function loomPopulateGroupSystemSelect() {
  if (!loomGroupSystemSelect) return;
  const previous = loomGroupSystemSelect.value;
  loomGroupSystemSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "None";
  loomGroupSystemSelect.appendChild(blank);
  loomGroupSystemsCatalog.forEach((system) => {
    const option = document.createElement("option");
    option.value = system.id;
    option.textContent = system.title || system.id;
    loomGroupSystemSelect.appendChild(option);
  });
  if (Array.from(loomGroupSystemSelect.options).some((option) => option.value === previous)) {
    loomGroupSystemSelect.value = previous;
  }
}

// Byte-for-byte parallel to loomPopulateGroupSystemSelect above, sourced
// from loomGroupSettingsCatalog (listAllSettings()) instead.
function loomPopulateGroupSettingSelect() {
  if (!loomGroupSettingSelect) return;
  const previous = loomGroupSettingSelect.value;
  loomGroupSettingSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "None";
  loomGroupSettingSelect.appendChild(blank);
  loomGroupSettingsCatalog.forEach((setting) => {
    const option = document.createElement("option");
    option.value = setting.id;
    option.textContent = setting.title || setting.id;
    loomGroupSettingSelect.appendChild(option);
  });
  if (Array.from(loomGroupSettingSelect.options).some((option) => option.value === previous)) {
    loomGroupSettingSelect.value = previous;
  }
}

// Same System-filtered Template list populateLibraryTemplateSelect builds
// for a Character's `template` field — adapted for a Group's singular
// `systemId` instead of a `systemIds` array. Unlike that function, picking a
// Template here does NOT fold its schema back into the Group's System — the
// System select is Group's own independent field (it drives Party
// Inventory's System-matching), not something a Template pick should
// silently change. Re-fetched fresh each time a Group is selected or its
// System changes.
async function loomPopulateGroupTemplateSelect(systemId, currentTemplateId) {
  if (!loomGroupTemplateSelect) return;
  const previous = currentTemplateId !== undefined ? currentTemplateId || "" : loomGroupTemplateSelect.value;
  loomGroupTemplateSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "No template assigned";
  loomGroupTemplateSelect.appendChild(blank);
  if (!dataManager) return;
  try {
    const { remote } = await dataManager.list("templates", { refresh: true, includeLocal: false });
    const entries = dataManager.collectListEntries(remote, ["owned", "shared", "public", "items"]);
    entries
      // Print templates (category: "print") have nothing to do with "which
      // Workbench Template does this campaign's Party Data render" — same
      // exclusion populateLibraryTemplateSelect already applies.
      .filter((entry) => (entry.category || "character") === "character")
      .filter((entry) => !systemId || (entry.schema || entry.system) === systemId)
      .forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.title || entry.id;
        loomGroupTemplateSelect.appendChild(option);
      });
  } catch (error) {
    status?.show(`Unable to list templates: ${error.message}`, { type: "error", timeout: 4000 });
  }
  if (Array.from(loomGroupTemplateSelect.options).some((option) => option.value === previous)) {
    loomGroupTemplateSelect.value = previous;
  }
}

// Reads the System filter from the SELECT's live value (not group.system_id)
// so a not-yet-saved System choice narrows this list immediately — see the
// loomGroupSystemSelect "change" listener below, which calls this directly
// instead of the full loomRenderGroupDetail (which would stomp the live
// selection back to the saved value).
function loomRenderGroupMembersList(group) {
  if (!loomGroupMembersList) return;
  const members = Array.isArray(group?.members) ? group.members.filter((member) => member.content_type === "character") : [];
  loomGroupMembersList.innerHTML = "";
  const memberMap = new Map();
  members.forEach((member) => memberMap.set(member.content_id, member));
  const seenIds = new Set();
  const rows = [];
  // A Group with its own System narrows "available to add" down to
  // characters assigned to that System — leaving it unset shows everyone.
  // Characters already added stay visible regardless (memberMap.forEach
  // fallback below) — this only affects what's offered to ADD.
  const groupSystemId = loomGroupSystemSelect?.value || "";
  loomOwnedCharacters.forEach((character) => {
    if (groupSystemId) {
      const characterSystemIds = Array.isArray(character.systemIds)
        ? character.systemIds
        : character.system
          ? [character.system]
          : [];
      if (!characterSystemIds.includes(groupSystemId)) return;
    }
    let label = loomFormatGroupCharacterLabel({ ...character, id: character.id });
    if (character.missing) label = `${label} (not found)`;
    rows.push({ id: character.id, label, checked: memberMap.has(character.id) });
    if (memberMap.has(character.id)) seenIds.add(character.id);
  });
  memberMap.forEach((member, id) => {
    if (seenIds.has(id)) return;
    let label = loomFormatGroupCharacterLabel({ ...member, id });
    if (member.missing) {
      label = `${label} (not found)`;
    } else if (member.is_claimed) {
      const ownerLabel = member.owner_username ? member.owner_username : "claimed";
      label = `${label} (claimed by ${ownerLabel})`;
    } else {
      label = `${label} (available)`;
    }
    rows.push({ id, label, checked: true });
  });
  if (loomGroupMembersEmpty) loomGroupMembersEmpty.hidden = rows.length > 0;
  rows.forEach((row) => {
    const checkboxId = `loom-group-member-${row.id}`;
    const wrapper = document.createElement("div");
    wrapper.className = "form-check";
    wrapper.innerHTML = `
      <input class="form-check-input" type="checkbox" value="${escapeHtml(row.id)}" id="${escapeHtml(checkboxId)}" data-loom-group-member-checkbox ${row.checked ? "checked" : ""} />
      <label class="form-check-label small" for="${escapeHtml(checkboxId)}">${escapeHtml(row.label)}</label>
    `;
    loomGroupMembersList.appendChild(wrapper);
  });
  void initHelpSystem({ root: loomGroupMembersList.parentElement });
}

function loomRenderGroupDetail() {
  const group = loomFindGroup(loomGroupsState.selectedId);
  const hasGroup = Boolean(group);
  if (loomGroupEmpty) loomGroupEmpty.hidden = hasGroup;
  if (loomGroupForm) loomGroupForm.classList.toggle("d-none", !hasGroup);
  if (!hasGroup) {
    loomGroupsState.cleanName = null;
    loomGroupsState.cleanSystemId = null;
    loomGroupsState.cleanSettingId = null;
    loomGroupsState.cleanTemplateId = null;
    loomGroupsState.cleanPropertiesJson = null;
    if (loomGroupPropertyRows) loomGroupPropertyRows.innerHTML = "";
    groupPropertyInspector.selectRow(null);
    loomUpdateGroupsToolbarState();
    return;
  }
  if (loomGroupNameInput) loomGroupNameInput.value = group.name || "";
  loomGroupsState.cleanName = (group.name || "").trim();
  if (loomGroupSystemSelect) loomGroupSystemSelect.value = group.system_id || "";
  loomGroupsState.cleanSystemId = group.system_id || "";
  if (loomGroupSettingSelect) loomGroupSettingSelect.value = group.setting_id || "";
  loomGroupsState.cleanSettingId = group.setting_id || "";
  loomGroupsState.cleanTemplateId = group.template_id || "";
  void loomPopulateGroupTemplateSelect(group.system_id, group.template_id);

  loomRenderGroupMembersList(group);

  loomUpdateGroupShareDisplay(group);
  loomUpdateGroupsToolbarState();
  // Properties (the full schema) aren't part of the lightweight list-view
  // payload above — list_groups' server-side row shaping skips a kind's
  // full JSON body for a LIST response (avoids an N-file-reads cost).
  // Fetched separately via the same generic `dataManager.get("group", id)`
  // route the Library editor uses for every kind.
  void loomLoadGroupProperties(group.id);
}

async function loomLoadGroupProperties(groupId) {
  let properties = [];
  try {
    const result = await dataManager.get("group", groupId, { preferLocal: false });
    properties = Array.isArray(result?.payload?.properties) ? result.payload.properties : [];
  } catch (error) {
    console.error("Failed to load group properties", error);
    if (status) status.show(error.message || "Unable to load this group's Properties.", { type: "danger" });
  }
  // The GM may have already clicked a different group by the time this
  // resolves — a stale response landing after that would otherwise silently
  // repopulate the Properties editor for the WRONG group.
  if (loomGroupsState.selectedId !== groupId) return;
  loomRenderGroupPropertyRows(properties);
  // Rebuilt from scratch above — whatever was selected before is now a
  // detached DOM node, same reasoning as System's own resets.
  groupPropertyInspector.selectRow(null);
  loomGroupsState.cleanPropertiesJson = JSON.stringify(properties);
  loomUpdateGroupsToolbarState();
}

async function loomLoadGroups({ refresh = false } = {}) {
  if (!loomGroupsSelect) return;
  if (!dataManager.isAuthenticated()) {
    loomGroupsState.items = [];
    loomGroupsState.stale = true;
    loomRenderGroupsSelect();
    return;
  }
  if (loomGroupsState.loading) return;
  const shouldRefresh = refresh || loomGroupsState.stale;
  if (!shouldRefresh && loomGroupsState.items.length) {
    loomRenderGroupsSelect();
    return;
  }
  if (shouldRefresh) loomRenderGroupsMessage("Loading groups…");
  loomGroupsState.loading = true;
  try {
    const [groupsPayload, ownedPayload, systems, settings] = await Promise.all([
      dataManager.listGroups({ refresh: shouldRefresh }),
      dataManager.listOwnedContent({ refresh: shouldRefresh }),
      listAllSystems(),
      listAllSettings(),
    ]);
    const groups = Array.isArray(groupsPayload?.groups) ? groupsPayload.groups : [];
    loomOwnedCharacters = (ownedPayload?.items || []).filter((item) => item.bucket === "character");
    loomGroupSystemsCatalog = Array.isArray(systems) ? systems : [];
    loomPopulateGroupSystemSelect();
    loomGroupSettingsCatalog = Array.isArray(settings) ? settings : [];
    loomPopulateGroupSettingSelect();
    loomGroupsState.items = groups;
    loomGroupsState.stale = false;
    loomRenderGroupsSelect();
  } catch (error) {
    console.error("Failed to load groups", error);
    if (status) status.show(error.message || "Unable to load groups", { type: "danger" });
    if (loomGroupsState.items.length) {
      loomRenderGroupsSelect();
    } else {
      loomRenderGroupsMessage("Unable to load groups.");
    }
  } finally {
    loomGroupsState.loading = false;
  }
}

if (loomGroupsSelect) {
  loomGroupsSelect.addEventListener("change", () => {
    loomGroupsState.selectedId = loomGroupsSelect.value || "";
    loomRenderGroupDetail();
  });
}

if (loomGroupNameInput) {
  loomGroupNameInput.addEventListener("input", loomUpdateGroupsToolbarState);
}

if (loomGroupSystemSelect) {
  loomGroupSystemSelect.addEventListener("change", () => {
    loomUpdateGroupsToolbarState();
    // Re-render just the member list against the live (possibly unsaved)
    // selection — NOT the full loomRenderGroupDetail, which would reset this
    // select back to the saved group.system_id.
    loomRenderGroupMembersList(loomFindGroup(loomGroupsState.selectedId));
    // Cascades to the Template list the same way (a different System means
    // a different set of matching Templates), preserving the live selection
    // if still valid.
    void loomPopulateGroupTemplateSelect(loomGroupSystemSelect.value || "");
  });
}

if (loomGroupSettingSelect) {
  // No member-list re-render needed — Setting has no bearing on which
  // characters are offered (that's System-scoped only), unlike System above.
  loomGroupSettingSelect.addEventListener("change", loomUpdateGroupsToolbarState);
}

if (loomGroupTemplateSelect) {
  loomGroupTemplateSelect.addEventListener("change", loomUpdateGroupsToolbarState);
}

// Delegated add/remove-property/sub-field/record-field/value handling for
// the Group Properties editor — same shared-module wiring Systems uses,
// bound to groupPropertyCtx. One persistent instance; only its children are
// ever recreated.
wirePropertyContainerEvents(loomGroupPropertyRows, groupPropertyCtx);

if (loomGroupAddPropertyButton) {
  loomGroupAddPropertyButton.addEventListener("click", () => {
    groupPropertyCtx.runChange(() => renderPropertyRow({}, loomGroupPropertyRows, groupPropertyCtx));
  });
}

if (loomGroupNewButton) {
  loomGroupNewButton.addEventListener("click", async () => {
    if (!dataManager.isAuthenticated()) {
      if (status) status.show("Sign in to manage groups.", { type: "warning", timeout: 1800 });
      return;
    }
    const baseName = "Campaign group";
    const existing = new Set(loomGroupsState.items.map((group) => (group.name || "").trim().toLowerCase()));
    let candidate = baseName;
    let index = 2;
    while (existing.has(candidate.trim().toLowerCase())) {
      candidate = `${baseName} ${index}`;
      index += 1;
    }
    loomGroupNewButton.disabled = true;
    try {
      const result = await dataManager.createGroup({ name: candidate });
      if (status) status.show("Group created.", { type: "success", timeout: 1600 });
      loomGroupsState.selectedId = result?.id || "";
      await loomLoadGroups({ refresh: true });
    } catch (error) {
      console.error("Unable to create group", error);
      if (status) status.show(error.message || "Unable to create group", { type: "danger" });
    } finally {
      loomGroupNewButton.disabled = false;
    }
  });
}

// Clones the currently loaded group's System/Setting/Template/Properties
// (read live off the form) into a brand-new group — same two-step
// createGroup-then-updateGroup shape loomGroupNewButton uses, since a group
// has no client-side "unsaved draft" to stage into. Members are NOT copied —
// another group's claimed roster is campaign-specific, not a helpful default.
if (loomGroupDuplicateButton) {
  loomGroupDuplicateButton.addEventListener("click", async () => {
    const group = loomFindGroup(loomGroupsState.selectedId);
    if (!group || !dataManager.isAuthenticated()) return;
    const baseName = `${(loomGroupNameInput?.value || group.name || "Campaign group").trim()} Copy`;
    const existing = new Set(loomGroupsState.items.map((entry) => (entry.name || "").trim().toLowerCase()));
    let candidate = baseName;
    let index = 2;
    while (existing.has(candidate.trim().toLowerCase())) {
      candidate = `${baseName} ${index}`;
      index += 1;
    }
    loomGroupDuplicateButton.disabled = true;
    try {
      const result = await dataManager.createGroup({ name: candidate });
      await dataManager.updateGroup({
        id: result.id,
        name: candidate,
        systemId: loomGroupSystemSelect?.value || "",
        settingId: loomGroupSettingSelect?.value || "",
        templateId: loomGroupTemplateSelect?.value || "",
        properties: collectGroupProperties(),
      });
      if (status) status.show("Group duplicated.", { type: "success", timeout: 1600 });
      loomGroupsState.selectedId = result?.id || "";
      await loomLoadGroups({ refresh: true });
    } catch (error) {
      console.error("Unable to duplicate group", error);
      if (status) status.show(error.message || "Unable to duplicate group", { type: "danger" });
    } finally {
      loomGroupDuplicateButton.disabled = false;
    }
  });
}

if (loomGroupSaveButton) {
  loomGroupSaveButton.addEventListener("click", async () => {
    const group = loomFindGroup(loomGroupsState.selectedId);
    if (!group) return;
    const newName = (loomGroupNameInput?.value || "").trim();
    const newSystemId = loomGroupSystemSelect?.value || "";
    const newSettingId = loomGroupSettingSelect?.value || "";
    const newTemplateId = loomGroupTemplateSelect?.value || "";
    const newProperties = collectGroupProperties();
    if (!newName) return;
    if (
      newName === loomGroupsState.cleanName &&
      newSystemId === (loomGroupsState.cleanSystemId || "") &&
      newSettingId === (loomGroupsState.cleanSettingId || "") &&
      newTemplateId === (loomGroupsState.cleanTemplateId || "") &&
      JSON.stringify(newProperties) === (loomGroupsState.cleanPropertiesJson ?? "[]")
    )
      return;
    loomGroupSaveButton.disabled = true;
    if (loomGroupNameInput) loomGroupNameInput.disabled = true;
    if (loomGroupSystemSelect) loomGroupSystemSelect.disabled = true;
    if (loomGroupSettingSelect) loomGroupSettingSelect.disabled = true;
    if (loomGroupTemplateSelect) loomGroupTemplateSelect.disabled = true;
    try {
      await dataManager.updateGroup({
        id: group.id,
        name: newName,
        systemId: newSystemId,
        settingId: newSettingId,
        templateId: newTemplateId,
        properties: newProperties,
      });
      if (status) status.show("Group saved.", { type: "success", timeout: 1600 });
      await loomLoadGroups({ refresh: true });
    } catch (error) {
      console.error("Unable to save group", error);
      if (status) status.show(error.message || "Unable to save group", { type: "danger" });
    } finally {
      if (loomGroupNameInput) loomGroupNameInput.disabled = false;
      if (loomGroupSystemSelect) loomGroupSystemSelect.disabled = false;
      if (loomGroupSettingSelect) loomGroupSettingSelect.disabled = false;
      if (loomGroupTemplateSelect) loomGroupTemplateSelect.disabled = false;
      loomUpdateGroupsToolbarState();
    }
  });
}

if (loomGroupDeleteButton) {
  loomGroupDeleteButton.addEventListener("click", async () => {
    const group = loomFindGroup(loomGroupsState.selectedId);
    if (!group) return;
    if (!confirmDelete({ label: group.name || "this group" })) return;
    loomGroupDeleteButton.disabled = true;
    if (loomGroupSaveButton) loomGroupSaveButton.disabled = true;
    try {
      await dataManager.deleteGroup(group.id);
      if (status) status.show("Group deleted.", { type: "success", timeout: 1600 });
      loomGroupsState.selectedId = "";
      await loomLoadGroups({ refresh: true });
    } catch (error) {
      console.error("Unable to delete group", error);
      if (status) status.show(error.message || "Unable to delete group", { type: "danger" });
      loomUpdateGroupsToolbarState();
    }
  });
}

if (loomGroupMembersList) {
  loomGroupMembersList.addEventListener("change", async (event) => {
    const checkbox = event.target.closest("[data-loom-group-member-checkbox]");
    if (!checkbox) return;
    const group = loomFindGroup(loomGroupsState.selectedId);
    if (!group) return;
    const selected = Array.from(loomGroupMembersList.querySelectorAll("[data-loom-group-member-checkbox]:checked")).map(
      (input) => input.value
    );
    const checkboxes = Array.from(loomGroupMembersList.querySelectorAll("[data-loom-group-member-checkbox]"));
    checkboxes.forEach((input) => (input.disabled = true));
    // A not-yet-saved System choice drives this list's live filter — member
    // checkboxes auto-save independently of the Save button via the reload
    // below, which otherwise re-renders from the last-SAVED group and
    // discards the staged choice, resetting the filter to "show everyone."
    const pendingSystemId = loomGroupSystemSelect?.value || "";
    // Same reasoning for an unsaved pending Setting choice.
    const pendingSettingId = loomGroupSettingSelect?.value || "";
    try {
      await dataManager.updateGroupMembers({ id: group.id, characterIds: selected });
      if (status) status.show("Group updated.", { type: "success", timeout: 1400 });
      await loomLoadGroups({ refresh: true });
      const refreshed = loomFindGroup(loomGroupsState.selectedId);
      let needsToolbarUpdate = false;
      if (loomGroupSystemSelect && refreshed && pendingSystemId !== (refreshed.system_id || "")) {
        loomGroupSystemSelect.value = pendingSystemId;
        loomRenderGroupMembersList(refreshed);
        needsToolbarUpdate = true;
      }
      if (loomGroupSettingSelect && refreshed && pendingSettingId !== (refreshed.setting_id || "")) {
        loomGroupSettingSelect.value = pendingSettingId;
        needsToolbarUpdate = true;
      }
      if (needsToolbarUpdate) loomUpdateGroupsToolbarState();
    } catch (error) {
      console.error("Unable to update group members", error);
      if (status) status.show(error.message || "Unable to update group", { type: "danger" });
      checkboxes.forEach((input) => (input.disabled = false));
    }
  });
}

if (loomGroupShareGenerateButton) {
  loomGroupShareGenerateButton.addEventListener("click", async () => {
    const group = loomFindGroup(loomGroupsState.selectedId);
    if (!group) return;
    loomGroupShareGenerateButton.disabled = true;
    try {
      const link = await dataManager.createGroupShareLink(group.id);
      loomUpdateGroupShareDisplay(group, link);
      if (status) status.show("Share link created.", { type: "success", timeout: 1600 });
      await loomLoadGroups({ refresh: true });
    } catch (error) {
      console.error("Unable to create group link", error);
      if (status) status.show(error.message || "Unable to create link", { type: "danger" });
    } finally {
      loomGroupShareGenerateButton.disabled = false;
    }
  });
}

if (loomGroupShareCopyButton) {
  loomGroupShareCopyButton.addEventListener("click", async () => {
    const url = loomGroupShareCopyButton.dataset.shareUrl || "";
    if (!url) return;
    await loomCopyShareLink(url);
  });
}

if (loomGroupShareDisableButton) {
  loomGroupShareDisableButton.addEventListener("click", async () => {
    const group = loomFindGroup(loomGroupsState.selectedId);
    if (!group) return;
    loomGroupShareDisableButton.disabled = true;
    try {
      await dataManager.revokeGroupShareLink(group.id);
      loomUpdateGroupShareDisplay(group, null);
      if (status) status.show("Share link disabled.", { type: "success", timeout: 1600 });
      await loomLoadGroups({ refresh: true });
    } catch (error) {
      console.error("Unable to disable group link", error);
      if (status) status.show(error.message || "Unable to disable link", { type: "danger" });
    } finally {
      loomGroupShareDisableButton.disabled = false;
    }
  });
}

// --- Auth tab ------------------------------------------------------------
// Deployment-wide credentials (D&D Beyond session cookie, Anthropic API
// key) — admin-only (server/integrations.py's deployment_secrets store,
// server/ddb_auth_status.py for validity checks). No left-pane picker: two
// fixed credentials, nothing to filter/select. Expanded by default only
// when the cookie looks expired — re-derived every time fresh status comes
// in (loomRenderAuthDdbStatus below), not set once at mount.
const loomAuthDdbInstructionsSection = createCollapsibleSection({
  label: "How to get a new session cookie",
  collapsed: true,
  content: document.querySelector("[data-loom-auth-ddb-instructions-panel]"),
});
document.querySelector("[data-loom-auth-ddb-instructions-mount]")?.appendChild(loomAuthDdbInstructionsSection.section);
const loomAuthDdbStatus = document.querySelector("[data-loom-auth-ddb-status]");
const loomAuthDdbDetail = document.querySelector("[data-loom-auth-ddb-detail]");
const loomAuthDdbCheckButton = document.querySelector("[data-loom-auth-ddb-check]");
const loomAuthDdbSaveButton = document.querySelector("[data-loom-auth-ddb-save]");
const loomAuthDdbCookieInput = document.querySelector("[data-loom-auth-ddb-cookie]");
const loomAuthAnthropicStatus = document.querySelector("[data-loom-auth-anthropic-status]");
const loomAuthAnthropicSaveButton = document.querySelector("[data-loom-auth-anthropic-save]");
const loomAuthAnthropicKeyInput = document.querySelector("[data-loom-auth-anthropic-key]");

function loomFormatAuthCheckedAt(checkedAt) {
  if (!checkedAt) return "never checked";
  const date = new Date(`${checkedAt.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "checked at an unknown time";
  return `checked ${date.toLocaleString()}`;
}

function loomRenderAuthDdbStatus(ddb) {
  loomAuthDdbInstructionsSection.setCollapsed(ddb?.valid !== false);
  // The server distinguishes a genuinely-rejected cookie from a failed
  // probe from "not configured" in this text rather than one generic
  // "looks expired" (ddb_auth_status.py's _describe_outcome).
  if (loomAuthDdbDetail) {
    loomAuthDdbDetail.textContent = ddb?.detail || "";
    loomAuthDdbDetail.hidden = !ddb?.detail;
  }
  if (!loomAuthDdbStatus) return;
  if (!ddb?.configured) {
    loomAuthDdbStatus.textContent = "Not configured";
    return;
  }
  if (ddb.valid === true) {
    loomAuthDdbStatus.textContent = `Configured — looks valid (${loomFormatAuthCheckedAt(ddb.checkedAt)})`;
  } else if (ddb.valid === false) {
    loomAuthDdbStatus.textContent = `Configured — looks expired (${loomFormatAuthCheckedAt(ddb.checkedAt)})`;
  } else {
    loomAuthDdbStatus.textContent = "Configured — not yet checked";
  }
}

function loomRenderAuthAnthropicStatus(anthropic) {
  if (!loomAuthAnthropicStatus) return;
  loomAuthAnthropicStatus.textContent = anthropic?.configured ? "Configured" : "Not configured";
}

async function loomRenderAuthStatus() {
  if (!isLoomAdminSession()) return;
  if (loomAuthDdbStatus) loomAuthDdbStatus.textContent = "Checking…";
  if (loomAuthAnthropicStatus) loomAuthAnthropicStatus.textContent = "Checking…";
  try {
    const payload = await dataManager.getAuthCredentialsStatus();
    loomRenderAuthDdbStatus(payload?.ddb);
    loomRenderAuthAnthropicStatus(payload?.anthropic);
  } catch (error) {
    if (status) status.show(error.message || "Unable to load auth status", { type: "danger" });
  }
}

if (loomAuthDdbCheckButton) {
  loomAuthDdbCheckButton.addEventListener("click", async () => {
    loomAuthDdbCheckButton.disabled = true;
    try {
      const payload = await dataManager.checkDdbAuthStatus();
      loomRenderAuthDdbStatus(payload?.ddb);
    } catch (error) {
      if (status) status.show(error.message || "Unable to check D&D Beyond session", { type: "danger" });
    } finally {
      loomAuthDdbCheckButton.disabled = false;
    }
  });
}

if (loomAuthDdbSaveButton) {
  loomAuthDdbSaveButton.addEventListener("click", async () => {
    const cookie = loomAuthDdbCookieInput?.value.trim() || "";
    if (!cookie) return;
    loomAuthDdbSaveButton.disabled = true;
    try {
      await dataManager.saveDdbSessionCookie(cookie);
      if (loomAuthDdbCookieInput) loomAuthDdbCookieInput.value = "";
      if (status) status.show("D&D Beyond session saved.", { type: "success", timeout: 1600 });
      const payload = await dataManager.checkDdbAuthStatus();
      loomRenderAuthDdbStatus(payload?.ddb);
    } catch (error) {
      if (status) status.show(error.message || "Unable to save D&D Beyond session", { type: "danger" });
    } finally {
      loomAuthDdbSaveButton.disabled = false;
    }
  });
}

if (loomAuthAnthropicSaveButton) {
  loomAuthAnthropicSaveButton.addEventListener("click", async () => {
    const apiKey = loomAuthAnthropicKeyInput?.value.trim() || "";
    if (!apiKey) return;
    loomAuthAnthropicSaveButton.disabled = true;
    try {
      await dataManager.saveAnthropicApiKey(apiKey);
      if (loomAuthAnthropicKeyInput) loomAuthAnthropicKeyInput.value = "";
      if (status) status.show("Anthropic API key saved.", { type: "success", timeout: 1600 });
      await loomRenderAuthStatus();
    } catch (error) {
      if (status) status.show(error.message || "Unable to save Anthropic API key", { type: "danger" });
    } finally {
      loomAuthAnthropicSaveButton.disabled = false;
    }
  });
}

// --- Tab-level tier gating ----------------------------------------------------
// The whole tool is gated at GM tier and above (init()'s initTierGate), but
// not every tab makes sense at every tier above that floor: GM sees Groups
// and Macros (running a campaign — Macros is writeTier "gm", a GM's own
// table cues, not Creator-authored shareable content); Creator adds
// Import/Library/Systems (author reusable content); Admin adds Users
// (suite-wide tier management) on top of everything Creator sees.
const LOOM_CREATOR_TABS = ["import", "library", "systems"];

function loomAvailableViews() {
  const meetsCreator = Boolean(dataManager?.meetsTier?.("creator"));
  const isAdmin = isLoomAdminSession();
  return LOOM_VIEWS.filter((view) => {
    if (LOOM_CREATOR_TABS.includes(view)) return meetsCreator;
    if (view === "users" || view === "auth") return isAdmin;
    return true; // groups/macros: available to every tier the whole tool already requires (gm+)
  });
}

function updateLoomTabAvailability() {
  const available = new Set(loomAvailableViews());
  document.querySelectorAll("[data-loom-view-tab]").forEach((button) => {
    const view = button.dataset.loomViewTab;
    const visible = available.has(view);
    const item = button.closest("li") || button;
    item.classList.toggle("d-none", !visible);
    button.disabled = !visible;
  });
  // Always (re-)apply setLoomView, even when the active tab isn't changing —
  // it's what adds the `.d-none` class every non-active panel needs (the
  // static HTML only carries `hidden`, which Bootstrap's `.d-flex`
  // `!important` beats on its own).
  const activeButton = document.querySelector("[data-loom-view-tab].active");
  const activeView = activeButton?.dataset.loomViewTab;
  const nextView = activeView && available.has(activeView) ? activeView : loomAvailableViews()[0] || "groups";
  setLoomView(nextView);
}

// --- Library contents (browse/share across every owner + kind) -------------
// The Kind+Entity picker in the center pane below is for direct editing of
// one entity at a time; this left-pane select + right-pane inspector is the
// "manage the whole Library" surface the account page's Owned Content view
// doesn't try to be (that page only shows the signed-in user's own items) —
// Share reuses the same generic share modal Owned Content uses. The two
// pickers are independent: picking an item here only surfaces its
// metadata/Share action, it doesn't load it into the editor below.
const loomLibraryTableMessage = document.querySelector("[data-loom-library-table-message]");
mountField(
  "library-table-type",
  createCompactField({ type: "select", id: "loomLibraryTableType", label: "Type", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select form-select-sm", dataAttr: "data-loom-library-table-type" })
);
mountField(
  "library-table-select",
  createCompactField({ type: "select", id: "loomLibraryTableSelect", label: "Item", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-loom-library-table-select" })
);

const loomLibraryTableTypeSelect = document.querySelector("[data-loom-library-table-type]");
const loomLibraryTableSelect = document.querySelector("[data-loom-library-table-select]");
// Library Type is gated on the Type FILTER select alone — it shows the
// instant a type is picked, before any specific item is. Library Item stays
// gated on an actual selected item (no created/accessed/owner/share data
// exists for "a kind" in the abstract).
const loomLibraryTypeEmpty = document.querySelector("[data-loom-library-table-type-empty]");
const loomLibraryTypeDetails = document.querySelector("[data-loom-library-table-type-details]");
const loomLibraryInspectorEmpty = document.querySelector("[data-loom-library-table-inspector-empty]");
const loomLibraryInspectorDetails = document.querySelector("[data-loom-library-table-inspector-details]");
// "Library Type" (kind-level Viewable/Editable-by policy) and "Library Item"
// (this record's own Created/Owner/Share) are collapsible like nearly every
// right-pane section — adopts each pre-existing static list div as content.
// Unlike those, these sections are always present — only their content is
// gated: each opens with an empty "Select a..." message that gives way to
// real details once something's picked. Both start collapsed;
// loomRenderLibraryTypeInspector/loomRenderLibraryInspector below
// auto-expand (never auto-collapse) the moment there's something to show.
const loomLibraryTypeSection = createCollapsibleSection({
  label: "Library Type",
  collapsed: true,
  content: document.querySelector("[data-loom-library-type-list]"),
});
document.querySelector("[data-loom-library-type-mount]")?.appendChild(loomLibraryTypeSection.section);
const loomLibraryItemSection = createCollapsibleSection({
  label: "Library Item",
  collapsed: true,
  content: document.querySelector("[data-loom-library-item-list]"),
});
document.querySelector("[data-loom-library-item-mount]")?.appendChild(loomLibraryItemSection.section);

// Relationships for whichever item is selected via the Type/Item pickers —
// mirrors Workbench's own left-pane Relationships section, list editor only
// (no force graph). Re-rendered from loomRenderLibraryInspector(), the same
// choke point the Library Item card refreshes from on every selection change.
const LOOM_RELATIONSHIP_TYPE_SUGGESTIONS = [
  "Related to",
  "Part of",
  "Variant of",
  "Requires",
  "Grants",
  "Derived from",
  "Alternate of",
  "Associated with",
];
const loomRelationshipsListMount = document.querySelector("[data-loom-relationships-list-mount]");
const loomRelationshipsSection = createCollapsibleSection({
  label: "Relationships",
  helpTopic: "loom.relationships",
  collapsed: true,
  content: document.querySelector("[data-loom-relationships-panel]"),
});
document.querySelector("[data-loom-relationships-mount]")?.appendChild(loomRelationshipsSection.section);

// Every Library kind except relationship itself — cached since it only
// ever changes when a Kind entity is added/removed, not on every selection.
let loomRelationshipTargetKindsCache = null;
async function loomRelationshipTargetKinds() {
  if (loomRelationshipTargetKindsCache) return loomRelationshipTargetKindsCache;
  const kinds = await loadLibraryKinds();
  loomRelationshipTargetKindsCache = kinds
    .filter((kind) => kind.id !== "relationship")
    .map((kind) => ({ id: kind.id, label: kind.label || kind.id }));
  return loomRelationshipTargetKindsCache;
}

// Guards against a slow targetKinds fetch resolving after a newer selection
// has already moved on (e.g. rapid clicking through the Item picker).
let loomRelationshipsRequestToken = 0;
async function loomRefreshLibraryRelationships(item) {
  if (!loomRelationshipsListMount) return;
  const requestToken = ++loomRelationshipsRequestToken;
  if (!item || !item.bucket || !item.id) {
    loomRelationshipsListMount.innerHTML =
      '<p class="small text-body-secondary mb-0">Select a Library item to see its relationships.</p>';
    return;
  }
  const targetKinds = await loomRelationshipTargetKinds();
  if (requestToken !== loomRelationshipsRequestToken) return;
  await renderRelationshipEditor({
    container: loomRelationshipsListMount,
    sourceKind: item.bucket,
    sourceId: item.id,
    targetKinds,
    typeSuggestions: LOOM_RELATIONSHIP_TYPE_SUGGESTIONS,
    dataManager,
    status,
    onChange: () => void loomLoadLibraryTable({ refresh: true }),
  });
}
const loomLibraryInspectorId = document.querySelector("[data-loom-library-table-id]");
const loomLibraryInspectorCreated = document.querySelector("[data-loom-library-table-created]");
const loomLibraryInspectorAccessed = document.querySelector("[data-loom-library-table-accessed]");
const loomLibraryInspectorItemCount = document.querySelector("[data-loom-library-table-item-count]");
const loomLibraryInspectorReadTier = document.querySelector("[data-loom-library-table-read-tier]");
const loomLibraryInspectorWriteTier = document.querySelector("[data-loom-library-table-write-tier]");
const loomLibraryInspectorOwner = document.querySelector("[data-loom-library-table-owner]");
const loomLibraryInspectorPublic = document.querySelector("[data-loom-library-table-public]");
const loomLibraryInspectorShareSummary = document.querySelector("[data-loom-library-table-share-summary]");
const loomLibraryInspectorShareButton = document.querySelector("[data-loom-library-table-share]");
const loomLibraryInspectorRenameButton = document.querySelector("[data-loom-library-table-rename]");
let loomLibraryShareSummaryRequestToken = 0;

const loomLibraryTableState = {
  items: [],
  loading: false,
  stale: true,
  selectedType: "",
  selectedKey: "",
  // The kind of whatever is currently loaded in the center-pane editor —
  // set from the selected item's own bucket, or from selectedType when
  // starting a new, not-yet-saved entity (see the Library editor section
  // further down, which is the only thing that reads/writes this).
  activeKind: "",
};
let loomLibraryKindLabels = new Map();
// Each kind's own writeTier (common/data/kind/{id}.json) — the real, correct
// per-kind ownership-eligibility policy the server's own update_owner()
// enforces, read fresh alongside loomLibraryKindLabels rather than the
// account.js page's own WRITE_ROLE_REQUIREMENTS (which only ever covered
// the 3 legacy buckets, not every Library kind Loom's own browse table
// spans). See loomTierMeetsOwnerRequirement below.
let loomLibraryKindWriteTiers = new Map();
// This kind's own readTier — same source, shown alongside writeTier in the
// inspector so a Creator can see at a glance who can view vs. edit this
// kind of content, without having to go look up its kind.json.
let loomLibraryKindReadTiers = new Map();

function loomLibraryTypeLabel(bucket) {
  return loomLibraryKindLabels.get(bucket) || bucket;
}

function loomLibraryItemKey(item) {
  return `${item.bucket}:${item.id}`;
}

function loomLibraryTableShowMessage(message) {
  const text = typeof message === "string" ? message.trim() : "";
  const hasMessage = Boolean(text);
  if (loomLibraryTableMessage) {
    loomLibraryTableMessage.textContent = text;
    loomLibraryTableMessage.hidden = !hasMessage;
  }
  if (loomLibraryTableSelect) loomLibraryTableSelect.hidden = hasMessage;
}

function loomPopulateLibraryTableTypeFilter() {
  const select = loomLibraryTableTypeSelect;
  if (!select) return;
  const previous = loomLibraryTableState.selectedType;
  const buckets = Array.from(new Set(loomLibraryTableState.items.map((item) => item.bucket).filter(Boolean))).sort((a, b) =>
    loomLibraryTypeLabel(a).localeCompare(loomLibraryTypeLabel(b))
  );
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All types";
  fragment.appendChild(allOption);
  buckets.forEach((bucket) => {
    const option = document.createElement("option");
    option.value = bucket;
    option.textContent = loomLibraryTypeLabel(bucket);
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
  const stillValid = previous && buckets.includes(previous);
  select.value = stillValid ? previous : "";
  loomLibraryTableState.selectedType = stillValid ? previous : "";
}

function loomFindLibraryItem(key) {
  return loomLibraryTableState.items.find((item) => loomLibraryItemKey(item) === key) || null;
}

// A short, glanceable summary of who/what this item is shared with — the
// full breakdown lives in the Share modal; this is just enough to know
// whether it's worth opening.
function loomLibraryShareSummaryText(shares, link, isPublic) {
  const parts = [];
  if (isPublic) parts.push("Public");
  const list = Array.isArray(shares) ? shares : [];
  const allUsers = list.some((entry) => entry?.special === "all-users");
  const userCount = list.filter((entry) => entry?.type !== "group" && entry?.special !== "all-users").length;
  const groupCount = list.filter((entry) => entry?.type === "group").length;
  if (allUsers) {
    parts.push("Shared with all users");
  } else if (userCount || groupCount) {
    const bits = [];
    if (userCount) bits.push(`${userCount} user${userCount === 1 ? "" : "s"}`);
    if (groupCount) bits.push(`${groupCount} group${groupCount === 1 ? "" : "s"}`);
    parts.push(`Shared with ${bits.join(", ")}`);
  }
  if (link?.token) parts.push("Link active");
  return parts.length ? parts.join(" • ") : "Not shared";
}

async function loomRenderLibraryShareSummary(item) {
  if (!loomLibraryInspectorShareSummary) return;
  const token = ++loomLibraryShareSummaryRequestToken;
  if (!item || !dataManager) {
    loomLibraryInspectorShareSummary.textContent = "";
    return;
  }
  loomLibraryInspectorShareSummary.textContent = "Loading access…";
  try {
    const result = await dataManager.listShares(item.bucket, item.id);
    if (token !== loomLibraryShareSummaryRequestToken) return; // a newer selection already replaced this fetch
    loomLibraryInspectorShareSummary.textContent = loomLibraryShareSummaryText(result?.shares, result?.link, item.is_public);
  } catch (error) {
    if (token !== loomLibraryShareSummaryRequestToken) return;
    loomLibraryInspectorShareSummary.textContent = "Unable to load access";
  }
}

// Same "does this candidate's tier clear the bar" check account.js's own
// tierMeetsOwnerRequirement makes, but sourced from this kind's real
// writeTier policy (loomLibraryKindWriteTiers) instead of a hardcoded
// 3-bucket table, so every kind gets a correct answer. No policy on record
// means unconstrained — "absent = universal" like everywhere else in the suite.
function loomTierMeetsOwnerRequirement(tier, bucket) {
  const requirement = loomLibraryKindWriteTiers.get(bucket);
  return !requirement || roleRank(tier) >= roleRank(requirement);
}

function loomDescribeOwnerOption(username, tier) {
  const base = `${username} (${loomFormatTier(tier)})`;
  return dataManager?.session?.user?.username === username ? `${base} (You)` : base;
}

// Mirrors account.js's own buildOwnerOptions (current owner first, then —
// admin sessions only — every other tier-eligible user), scoped to whichever
// single item is selected instead of one row per table item.
function loomBuildOwnerOptions(bucket, currentOwner) {
  const options = [];
  const seen = new Set();
  const ownerUsername = currentOwner?.username || "";
  if (ownerUsername) {
    options.push({ value: ownerUsername, label: loomDescribeOwnerOption(ownerUsername, currentOwner.tier) });
    seen.add(ownerUsername);
  }
  if (!isLoomAdminSession()) return options;
  const current = dataManager?.session?.user;
  if (current?.username && !seen.has(current.username) && loomTierMeetsOwnerRequirement(current.tier, bucket)) {
    options.push({ value: current.username, label: loomDescribeOwnerOption(current.username, current.tier) });
    seen.add(current.username);
  }
  loomUsersState.items
    .filter((user) => user?.username && loomTierMeetsOwnerRequirement(user.tier, bucket))
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }))
    .forEach((user) => {
      if (seen.has(user.username)) return;
      options.push({ value: user.username, label: loomDescribeOwnerOption(user.username, user.tier) });
      seen.add(user.username);
    });
  return options;
}

// The kind's own policy (common/data/kind/{id}.json), not any one item's
// sharing — "who can see/edit ANY item of this kind" vs. Share's own "who
// can see/edit THIS ONE item" in Library Item below. Gated on the Type
// filter alone, so it appears the instant a type is picked. Defaults match
// the server's own load_kind_policy() fallback for a kind with no kind.json.
// Tracks the PREVIOUS hasType/hasItem, not just the current one — this
// re-runs on every Library table refresh, not only when selection changes,
// so auto-expanding only on the false→true edge keeps a manual re-collapse
// from being silently undone on the next refresh.
let loomLibraryTypeWasSelected = false;
function loomRenderLibraryTypeInspector() {
  const bucket = loomLibraryTableState.selectedType;
  const hasType = Boolean(bucket);
  if (loomLibraryTypeEmpty) loomLibraryTypeEmpty.hidden = hasType;
  if (loomLibraryTypeDetails) loomLibraryTypeDetails.classList.toggle("d-none", !hasType);
  if (hasType && !loomLibraryTypeWasSelected) loomLibraryTypeSection.setCollapsed(false);
  loomLibraryTypeWasSelected = hasType;
  if (!hasType) return;
  if (loomLibraryInspectorItemCount) {
    const count = loomLibraryTableState.items.filter((item) => item.bucket === bucket).length;
    loomLibraryInspectorItemCount.textContent = count.toLocaleString();
  }
  if (loomLibraryInspectorReadTier) loomLibraryInspectorReadTier.textContent = loomFormatTier(loomLibraryKindReadTiers.get(bucket) || "free");
  if (loomLibraryInspectorWriteTier) loomLibraryInspectorWriteTier.textContent = loomFormatTier(loomLibraryKindWriteTiers.get(bucket) || "admin");
}

// Same false→true edge tracking as loomLibraryTypeWasSelected above.
let loomLibraryItemWasSelected = false;
function loomRenderLibraryInspector() {
  loomRenderLibraryTypeInspector();
  const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
  const hasItem = Boolean(item);
  void loomRefreshLibraryRelationships(item);
  if (loomLibraryInspectorEmpty) loomLibraryInspectorEmpty.hidden = hasItem;
  if (loomLibraryInspectorDetails) loomLibraryInspectorDetails.classList.toggle("d-none", !hasItem);
  if (hasItem && !loomLibraryItemWasSelected) loomLibraryItemSection.setCollapsed(false);
  loomLibraryItemWasSelected = hasItem;
  if (!hasItem) {
    void loomRenderLibraryShareSummary(null);
    return;
  }
  if (loomLibraryInspectorId) loomLibraryInspectorId.textContent = `${item.bucket}/${item.id}.json`;
  if (loomLibraryInspectorCreated) loomLibraryInspectorCreated.textContent = loomFormatTimestamp(item.created_at, "Unknown");
  if (loomLibraryInspectorAccessed) loomLibraryInspectorAccessed.textContent = loomFormatTimestamp(item.last_accessed_at, "Never");
  if (loomLibraryInspectorOwner) {
    const currentOwner = { username: item.owner_username || "", tier: item.owner_tier || "" };
    const options = loomBuildOwnerOptions(item.bucket, currentOwner);
    loomLibraryInspectorOwner.innerHTML = "";
    if (!options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Unassigned";
      loomLibraryInspectorOwner.appendChild(option);
    } else {
      options.forEach(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        loomLibraryInspectorOwner.appendChild(option);
      });
    }
    loomLibraryInspectorOwner.value = currentOwner.username;
    // Only an admin session can actually change ownership (server-enforced
    // too, update_owner()) — a non-admin, or an item with nothing else to
    // switch to, sees a locked single-option select.
    loomLibraryInspectorOwner.disabled = !isLoomAdminSession() || options.length <= 1;
  }
  if (loomLibraryInspectorPublic) {
    loomLibraryInspectorPublic.checked = Boolean(item.is_public);
    // Same "owner or admin" tier the server enforces for sharing
    // (ensure_share_permission) — reuses the item-level Delete button's own
    // check rather than a parallel permission rule.
    loomLibraryInspectorPublic.disabled = !libraryEntryAllowsDelete(item.bucket, item.id);
  }
  // Admin-only (server-enforced too, rename_item) — same gate as the Owner
  // select above, not a separate/looser rule.
  if (loomLibraryInspectorRenameButton) loomLibraryInspectorRenameButton.classList.toggle("d-none", !isLoomAdminSession());
  void loomRenderLibraryShareSummary(item);
}

if (loomLibraryInspectorOwner) {
  loomLibraryInspectorOwner.addEventListener("change", async () => {
    const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
    if (!item) return;
    const previousUsername = item.owner_username || "";
    const selected = loomLibraryInspectorOwner.value;
    if (!selected || selected === previousUsername) {
      loomLibraryInspectorOwner.value = previousUsername;
      return;
    }
    // Same window.confirm pattern as every other hard-to-undo action in
    // Loom — changing an owner isn't destructive, but it does immediately
    // hand this item's edit/delete rights to someone else.
    const itemLabel = item.label || item.id;
    if (!window.confirm(`Change the owner of "${itemLabel}" from ${previousUsername || "Unassigned"} to ${selected}?`)) {
      loomLibraryInspectorOwner.value = previousUsername;
      return;
    }
    loomLibraryInspectorOwner.disabled = true;
    try {
      await dataManager.updateContentOwner(item.bucket, item.id, selected);
      if (status) status.show(`Owner changed to ${selected}.`, { type: "success", timeout: 2000 });
      await loomLoadLibraryTable({ refresh: true });
    } catch (error) {
      loomLibraryInspectorOwner.value = previousUsername;
      if (status) status.show(error.message || "Unable to change owner", { type: "danger" });
    } finally {
      loomLibraryInspectorOwner.disabled = !isLoomAdminSession();
    }
  });
}

// A shortcut for the SAME mechanism the Share modal's own "All Users" share
// target uses (sharing/revoking with this exact username is what flips
// library_items.is_public) — not a second, independent way to mark
// something public. Toggling here calls the exact same
// shareWithUser/revokeShare methods the modal's "All Users" row does.
const LOOM_ALL_USERS_USERNAME = "All Users";

if (loomLibraryInspectorPublic) {
  loomLibraryInspectorPublic.addEventListener("change", async () => {
    const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
    if (!item || !dataManager) return;
    const makePublic = loomLibraryInspectorPublic.checked;
    loomLibraryInspectorPublic.disabled = true;
    try {
      if (makePublic) {
        await dataManager.shareWithUser({ contentType: item.bucket, contentId: item.id, username: LOOM_ALL_USERS_USERNAME, permissions: "view" });
      } else {
        await dataManager.revokeShare({ contentType: item.bucket, contentId: item.id, username: LOOM_ALL_USERS_USERNAME });
      }
      // Kept in sync locally so the share summary line below reads
      // item.is_public immediately, rather than waiting on a refetch.
      item.is_public = makePublic;
      if (status) status.show(makePublic ? "Marked public." : "Marked private.", { type: "success", timeout: 2000 });
      void loomRenderLibraryShareSummary(item);
    } catch (error) {
      loomLibraryInspectorPublic.checked = !makePublic;
      if (status) status.show(error.message || "Unable to change visibility", { type: "danger" });
    } finally {
      loomLibraryInspectorPublic.disabled = !libraryEntryAllowsDelete(item.bucket, item.id);
    }
  });
}

// Two-step: a dry-run scan builds a confirmation prompt listing exactly
// what will change (rename_item's own {touched} summary), then — only once
// confirmed — the real rename runs. Everything a rename can touch is
// server-side/global, so there's nothing client-side to pre-check beyond
// "is something selected."
if (loomLibraryInspectorRenameButton) {
  loomLibraryInspectorRenameButton.addEventListener("click", async () => {
    const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
    if (!item || !dataManager) return;
    const newId = promptKey(`Rename "${item.id}" (${item.bucket}) to:`, item.id);
    if (!newId || newId === item.id) return;
    loomLibraryInspectorRenameButton.disabled = true;
    try {
      const preview = await dataManager.renameContent(item.bucket, item.id, newId, { dryRun: true });
      const touchedLines = preview.touched
        .map((entry) => `<li>${escapeHtml(entry.kind)}/${escapeHtml(entry.id)} — ${entry.count} reference${entry.count === 1 ? "" : "s"}</li>`)
        .join("");
      const bodyHtml = `
        <p>Renames <code>${escapeHtml(item.bucket)}/${escapeHtml(item.id)}</code> to <code>${escapeHtml(newId)}</code>.</p>
        ${
          preview.referenceCount
            ? `<p>${preview.referenceCount} reference${preview.referenceCount === 1 ? "" : "s"} across ${preview.touched.length} record${preview.touched.length === 1 ? "" : "s"} will be updated to match:</p><ul>${touchedLines}</ul>`
            : "<p>No other saved record currently references this one.</p>"
        }
      `;
      const confirmed = await showConfirmModal({
        title: "Rename this record?",
        bodyHtml,
        confirmLabel: "Rename",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;
      const result = await dataManager.renameContent(item.bucket, item.id, newId, { dryRun: false });
      // Every touched kind's own bulk-fetch cache needs invalidating, not
      // just this bucket's — a rename's reference repair can rewrite
      // records of any kind.
      const affectedKinds = new Set([item.bucket, ...result.touched.map((entry) => entry.kind)]);
      affectedKinds.forEach((kind) => window.dispatchEvent(new CustomEvent("workbench:content-saved", { detail: { bucket: kind } })));
      status?.show(`Renamed to "${newId}".`, { type: "success", timeout: 2500 });
      loomLibraryTableState.selectedKey = loomLibraryItemKey({ bucket: item.bucket, id: newId });
      await loomLoadLibraryTable({ refresh: true });
    } catch (error) {
      status?.show(error.message || "Unable to rename this record.", { type: "danger" });
    } finally {
      loomLibraryInspectorRenameButton.disabled = false;
    }
  });
}

function loomRenderLibraryTableSelect() {
  if (!loomLibraryTableSelect) return;
  const selectedType = loomLibraryTableState.selectedType;
  const items = selectedType
    ? loomLibraryTableState.items.filter((item) => item.bucket === selectedType)
    : loomLibraryTableState.items;
  if (!items.length) {
    loomLibraryTableShowMessage(selectedType ? "No saved content of this type yet." : "No saved content yet.");
    loomLibraryTableState.selectedKey = "";
    loomRenderLibraryInspector();
    return;
  }
  loomLibraryTableShowMessage("");
  const sorted = [...items].sort((a, b) => (a.label || a.id || "").localeCompare(b.label || b.id || ""));
  const fragment = document.createDocumentFragment();
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Select an item…";
  fragment.appendChild(blank);
  sorted.forEach((item) => {
    const option = document.createElement("option");
    option.value = loomLibraryItemKey(item);
    option.textContent = `${item.label || item.id} (${loomLibraryTypeLabel(item.bucket)})`;
    fragment.appendChild(option);
  });
  loomLibraryTableSelect.replaceChildren(fragment);
  const stillValid =
    loomLibraryTableState.selectedKey && items.some((item) => loomLibraryItemKey(item) === loomLibraryTableState.selectedKey);
  loomLibraryTableSelect.value = stillValid ? loomLibraryTableState.selectedKey : "";
  if (!stillValid) loomLibraryTableState.selectedKey = "";
  loomRenderLibraryInspector();
}

async function loomLoadLibraryTable({ refresh = false } = {}) {
  if (!loomLibraryTableSelect || !dataManager) return;
  if (!dataManager.isAuthenticated()) {
    loomLibraryTableState.items = [];
    loomLibraryTableShowMessage("Sign in to browse the Library.");
    return;
  }
  if (loomLibraryTableState.loading) return;
  const shouldRefresh = refresh || loomLibraryTableState.stale;
  if (shouldRefresh || !loomLibraryTableState.items.length) {
    loomLibraryTableShowMessage("Loading content…");
  }
  loomLibraryTableState.loading = true;
  // The Owner dropdown needs the full user list — admin-only, so a no-op
  // for non-admin sessions. Loaded here so it's populated before the
  // inspector needs it, not only when the Users tab is visited.
  if (isLoomAdminSession()) void loomLoadUsers();
  try {
    if (!loomLibraryKindLabels.size) {
      const kinds = await loadLibraryKinds();
      loomLibraryKindLabels = new Map(kinds.map((kind) => [kind.id, kind.label || kind.id]));
      loomLibraryKindWriteTiers = new Map(kinds.map((kind) => [kind.id, kind.writeTier || ""]));
      loomLibraryKindReadTiers = new Map(kinds.map((kind) => [kind.id, kind.readTier || ""]));
    }
    const payload = await dataManager.listOwnedContent({ scope: "all", refresh: shouldRefresh });
    const items = Array.isArray(payload?.items) ? payload.items : [];
    // Relationship records aren't directly browsable/editable as raw JSON
    // here — they're managed through the left pane's own Relationships
    // section, same as Workbench keeps them off its editing surfaces.
    // Filtered at the single source both the type-filter dropdown and the
    // item picker read from, so neither has to remember to exclude it
    // separately.
    loomLibraryTableState.items = items.filter((item) => item.bucket !== "relationship");
    loomLibraryTableState.stale = false;
    loomPopulateLibraryTableTypeFilter();
    loomRenderLibraryTableSelect();
  } catch (error) {
    console.error("Failed to load library contents", error);
    if (status) status.show(error.message || "Unable to load library contents", { type: "danger" });
    loomLibraryTableShowMessage("Unable to load library contents.");
  } finally {
    loomLibraryTableState.loading = false;
  }
}

// These two selects are the SINGLE picker for the Library tab — besides
// updating the right-pane inspector, they also drive the center-pane JSON
// editor via loomLoadPickedLibraryEntry() (defined further down; works via
// `function` hoisting).
if (loomLibraryTableTypeSelect) {
  loomLibraryTableTypeSelect.addEventListener("change", () => {
    loomLibraryTableState.selectedType = loomLibraryTableTypeSelect.value || "";
    loomRenderLibraryTableSelect();
    loomLoadPickedLibraryEntry();
  });
}

if (loomLibraryTableSelect) {
  loomLibraryTableSelect.addEventListener("change", () => {
    loomLibraryTableState.selectedKey = loomLibraryTableSelect.value || "";
    loomRenderLibraryInspector();
    loomLoadPickedLibraryEntry();
  });
}

if (loomLibraryInspectorShareButton) {
  loomLibraryInspectorShareButton.addEventListener("click", () => {
    const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
    if (!item || !shareModal) return;
    shareModal.open({ bucket: item.bucket, id: item.id, label: item.label || item.id, typeLabel: loomLibraryTypeLabel(item.bucket) });
  });
}

// Refresh the summary once the Share modal closes — access may have just
// changed, and the modal doesn't know about this inspector to notify it.
document.addEventListener("hidden.bs.modal", (event) => {
  if (!event.target?.hasAttribute?.("data-share-modal")) return;
  const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
  if (item) void loomRenderLibraryShareSummary(item);
});

// --- Systems: list every saved System (Workbench's own DataManager bucket —
// Loom is a second editor for the exact same data, not a separate store) ----

// Populated by every listAllSystems() call so canDeleteSystem() (a
// synchronous toolbar-state check) can look up the selected system's
// ownership without a fresh fetch.
let systemsCatalog = new Map();

async function listAllSystems() {
  if (!dataManager) return [];
  const merged = new Map();
  // Workbench ships sys.dnd5e as a "builtin" — a static JSON file, not a row
  // in the systems DB table — so it never shows up in dataManager.list()
  // on its own. Without this, the picker only shows Systems a creator has
  // saved, hiding the one every seed Location/Setting already points at.
  try {
    const builtins = await dataManager.listBuiltins();
    (builtins?.systems || []).forEach((entry) => {
      if (entry?.available) merged.set(entry.id, { id: entry.id, title: entry.title || entry.id, ownership: "builtin" });
    });
  } catch (error) {
    // builtins are a nice-to-have, not required
  }
  try {
    const listing = await dataManager.list("systems", { refresh: true });
    const remoteEntries = dataManager.collectListEntries(listing.remote, ["items", "owned", "shared", "public"]);
    remoteEntries.forEach((entry) =>
      merged.set(entry.id, {
        id: entry.id,
        title: entry.title || entry.id,
        ownerId: entry.owner_id ?? entry.ownerId ?? null,
        ownerUsername: entry.owner_username || entry.ownerUsername || "",
        isPublic: Boolean(entry.is_public),
        permissions: typeof entry.permissions === "string" ? entry.permissions.toLowerCase() : "",
      })
    );
    (listing.local || []).forEach((entry) => {
      if (!merged.has(entry.id)) {
        merged.set(entry.id, { id: entry.id, title: entry.payload?.title || entry.id, ownership: "local" });
      }
    });
  } catch (error) {
    // fall through with whatever builtins we already have
  }
  systemsCatalog = merged;
  return Array.from(merged.values()).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}

// Same shape as listAllSystems, minus the builtins merge — Settings have no
// builtin/shipped-as-a-static-file concept, they're always real saved
// "setting" Library records, authored in Sanctum.
async function listAllSettings() {
  if (!dataManager) return [];
  const merged = new Map();
  try {
    const listing = await dataManager.list("setting", { refresh: true });
    const remoteEntries = dataManager.collectListEntries(listing.remote, ["items", "owned", "shared", "public"]);
    remoteEntries.forEach((entry) =>
      merged.set(entry.id, {
        id: entry.id,
        title: entry.title || entry.name || entry.id,
        ownerId: entry.owner_id ?? entry.ownerId ?? null,
        ownerUsername: entry.owner_username || entry.ownerUsername || "",
        isPublic: Boolean(entry.is_public),
        permissions: typeof entry.permissions === "string" ? entry.permissions.toLowerCase() : "",
      })
    );
    (listing.local || []).forEach((entry) => {
      if (!merged.has(entry.id)) {
        merged.set(entry.id, { id: entry.id, title: entry.payload?.name || entry.payload?.title || entry.id, ownership: "local" });
      }
    });
  } catch (error) {
    // fall through with whatever's already merged
  }
  return Array.from(merged.values()).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}

// Owner-or-admin, same rule as Workbench's Template/Character delete gating.
// Systems have no "shared with edit permission" concept, unlike
// templates/characters, so ownership is the only non-admin path.
function systemAllowsDelete(id) {
  if (!id) return false;
  if (dataManager?.getUserTier() === "admin") return true;
  if (systemsCatalog.get(id)?.ownership === "builtin") return false;
  return allowsDelete(systemsCatalog, id, { dataManager });
}

// --- Library: browse/edit every saved entity of any kind --------------------
// The Entities panel above only shows the CURRENT mapping's fresh output —
// this is the only place a previously-saved entity can be reopened, edited
// as JSON, and assigned to Systems. The left-pane "Library Contents" Type +
// Item select is the ONE picker driving this editor — picking an item there
// loads it below and in the right-pane inspector.

// Ownership metadata for each kind's entries, refreshed whenever an entity
// is loaded for editing — same cache role as systemsCatalog above. Keyed by
// "kind:id" since ids aren't unique across kinds.
let libraryEntryCatalog = new Map();

async function refreshLibraryEntryCatalog(kind) {
  if (!kind || !dataManager) return;
  try {
    const { remote } = await dataManager.list(kind, { refresh: true, includeLocal: false });
    const entries = dataManager.collectListEntries(remote, ["owned", "shared", "public", "items"]);
    entries.forEach((entry) => {
      libraryEntryCatalog.set(`${kind}:${entry.id}`, {
        ownerId: entry.owner_id ?? entry.ownerId ?? null,
        ownerUsername: entry.owner_username || entry.ownerUsername || "",
        permissions: typeof entry.permissions === "string" ? entry.permissions.toLowerCase() : "",
      });
    });
  } catch (error) {
    status?.show(`Unable to list ${kind}s: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

// Owner-or-admin, same rule as systemAllowsDelete and Workbench's
// Template/Character delete gating — every kind has ownership now.
function libraryEntryAllowsDelete(kind, id) {
  if (!kind || !id) return false;
  return allowsDelete(libraryEntryCatalog, `${kind}:${id}`, { dataManager });
}

async function populateLibrarySystemCheckboxes(selectedIds) {
  if (!librarySystemList) return;
  // A System entity can't be assigned to itself — nonsensical the same way
  // a Template can't apply to non-character kinds (see
  // populateLibraryTemplateSelect's isCharacter check below).
  const isSystemKind = loomLibraryTableState.activeKind === "system";
  if (librarySystemSection) {
    // Plain `.hidden` silently loses to this wrapper's own `.d-flex`
    // (`display: flex !important`) — same fix as Press's setElementVisible:
    // an inline `!important` style is guaranteed to win.
    if (isSystemKind) {
      librarySystemSection.style.setProperty("display", "none", "important");
    } else {
      librarySystemSection.style.removeProperty("display");
    }
  }
  if (isSystemKind) {
    librarySystemList.innerHTML = "";
    return;
  }
  librarySystemList.innerHTML = "";
  const ids = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const systems = await listAllSystems();
  if (!systems.length) {
    const p = document.createElement("p");
    p.className = "small text-body-secondary mb-0";
    p.textContent = "No Systems saved yet — create one in the Systems panel below.";
    librarySystemList.appendChild(p);
    return;
  }
  systems.forEach((system) => {
    const checkboxId = `library-system-${system.id}`;
    const row = document.createElement("div");
    row.className = "form-check";
    row.innerHTML = `
      <input class="form-check-input" type="checkbox" value="${escapeHtml(system.id)}" id="${escapeHtml(checkboxId)}" data-library-system-checkbox ${ids.has(system.id) ? "checked" : ""} />
      <label class="form-check-label small" for="${escapeHtml(checkboxId)}">${escapeHtml(system.title)}</label>
    `;
    librarySystemList.appendChild(row);
  });
}

// Parallel to populateLibrarySystemCheckboxes above — a Setting entity
// can't be assigned to itself, same reasoning as System.
async function populateLibrarySettingCheckboxes(selectedIds) {
  if (!librarySettingList) return;
  const isSettingKind = loomLibraryTableState.activeKind === "setting";
  if (librarySettingSection) {
    if (isSettingKind) {
      librarySettingSection.style.setProperty("display", "none", "important");
    } else {
      librarySettingSection.style.removeProperty("display");
    }
  }
  if (isSettingKind) {
    librarySettingList.innerHTML = "";
    return;
  }
  librarySettingList.innerHTML = "";
  const ids = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const settings = await listAllSettings();
  if (!settings.length) {
    const p = document.createElement("p");
    p.className = "small text-body-secondary mb-0";
    p.textContent = "No Settings saved yet — create one in Sanctum.";
    librarySettingList.appendChild(p);
    return;
  }
  settings.forEach((setting) => {
    const checkboxId = `library-setting-${setting.id}`;
    const row = document.createElement("div");
    row.className = "form-check";
    row.innerHTML = `
      <input class="form-check-input" type="checkbox" value="${escapeHtml(setting.id)}" id="${escapeHtml(checkboxId)}" data-library-setting-checkbox ${ids.has(setting.id) ? "checked" : ""} />
      <label class="form-check-label small" for="${escapeHtml(checkboxId)}">${escapeHtml(setting.title)}</label>
    `;
    librarySettingList.appendChild(row);
  });
}

// Cascades from Assigned Systems above: only Templates built for one of this
// entity's assigned Systems are offered, same cascading-select pattern
// Sanctum's System > Setting > Location pickers use. Only shown for
// "character" — other kinds have no Workbench Template concept.
async function populateLibraryTemplateSelect(entity) {
  if (!libraryTemplateSection || !libraryTemplateSelect) return;
  const kind = loomLibraryTableState.activeKind || "";
  const isCharacter = kind === "character";
  libraryTemplateSection.hidden = !isCharacter;
  libraryTemplateSection.classList.toggle("d-none", !isCharacter);
  if (!isCharacter) return;
  const systemIds = new Set(Array.isArray(entity?.systemIds) ? entity.systemIds : []);
  libraryTemplateSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "No template assigned";
  libraryTemplateSelect.appendChild(blank);
  if (!dataManager) return;
  try {
    const { remote } = await dataManager.list("templates", { refresh: true, includeLocal: false });
    const entries = dataManager.collectListEntries(remote, ["owned", "shared", "public", "items"]);
    entries
      // The templates bucket also holds Press's print templates (category:
      // "print") — irrelevant here, so only character templates are offered.
      .filter((entry) => (entry.category || "character") === "character")
      .filter((entry) => !systemIds.size || systemIds.has(entry.schema || entry.system))
      .forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.title || entry.id;
        option.dataset.schema = entry.schema || entry.system || "";
        libraryTemplateSelect.appendChild(option);
      });
  } catch (error) {
    status?.show(`Unable to list templates: ${error.message}`, { type: "error", timeout: 4000 });
  }
  const current = entity?.template || "";
  if (Array.from(libraryTemplateSelect.options).some((option) => option.value === current)) {
    libraryTemplateSelect.value = current;
  }
}

if (libraryTemplateSelect) {
  libraryTemplateSelect.addEventListener("change", () => {
    recordUndoableChange("library", () => {
      const entity = currentLibraryEntity();
      if (!entity) return;
      const templateId = libraryTemplateSelect.value;
      if (templateId) {
        entity.template = templateId;
        const chosen = Array.from(libraryTemplateSelect.options).find((option) => option.value === templateId);
        // Folds the chosen Template's own System into this character's
        // Assigned Systems (systemIds) — the one mechanism every Library
        // kind uses for "which System(s) does this apply to" now. Additive
        // only — never removes an already-assigned System.
        if (chosen?.dataset.schema) {
          const ids = new Set(Array.isArray(entity.systemIds) ? entity.systemIds : []);
          ids.add(chosen.dataset.schema);
          entity.systemIds = Array.from(ids);
        }
      } else {
        delete entity.template;
      }
      libraryJsonTextarea.value = JSON.stringify(entity, null, 2);
      populateLibrarySystemCheckboxes(entity.systemIds);
    });
  });
}

// --- Features tab (its OWN tab — NOT a section inside the Library tab) -----
// The Library tab is the consistent raw-JSON fallback editor for every
// kind, full stop — it never grows kind-specific structured UI. A kind
// whose shape earns a structured editor gets its own
// `data-loom-view-panel="<kind>"` tab instead, same as Systems and Macros.
// This tab is the FULL structured editor for `feature` — every field is
// editable here, not just budgetCost/tags: those make a Feature eligible
// for Crucible's native generation, but a GM comparing near-duplicate
// Features needs to see actual description/mechanics differences too.
// `mechanics` is its own small JSON textarea rather than type-specific
// fields — its shape varies by `mechanics.type`, so one generic JSON box
// handles every variant without hand-building 4+ sub-forms; still one FIELD
// on a dedicated tab, not the whole entity, so this doesn't reopen the
// "Library tab is JSON-only" rule.
//
// Still no New button — a brand-new Feature (rare) still starts on the
// Library tab, where an id gets typed once; every other field is editable
// here immediately afterward.

mountField("feature-id", createCompactField({ type: "text", id: "loomFeatureId", label: "Id", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-feature-id", disabled: true }));
mountField("feature-name", createCompactField({ type: "text", id: "loomFeatureName", label: "Name", labelClass: "form-label fw-semibold mb-0", dataAttr: "data-feature-name" }));
mountField(
  "feature-description",
  createCompactField({
    type: "textarea", id: "loomFeatureDescription", label: "Description", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control form-control-sm",
    dataAttr: "data-feature-description", rows: 3,
  })
);
// Friendly controls, not raw JSON — a Feature's `mechanics` object only
// ever holds { type, text, scope } across every record in the Library (type
// is always one of exactly 8 known strings, text is free-form prose, scope
// is the separate "Scope" select below), so a select + plain textarea
// covers everything a JSON textarea would. Type's 8 options are exactly the
// mechanics.type values dispatched on elsewhere (feature-params-editor.js's
// isWeaponAttack/isSaveEffect/isActive checks) — ordered by frequency in
// the Library, not alphabetically.
mountField(
  "feature-mechanics-type",
  createCompactField({
    type: "select", id: "loomFeatureMechanicsType", label: "Mechanics Type", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-feature-mechanics-type", helpTopic: "loom.featureMechanics",
    options: [
      { value: "passive", label: "Passive" },
      { value: "active", label: "Active" },
      { value: "passive-or-triggered", label: "Passive or Triggered" },
      { value: "weapon-attack", label: "Weapon Attack" },
      { value: "save-effect", label: "Save Effect" },
      { value: "multiattack", label: "Multiattack" },
      { value: "drawback", label: "Drawback" },
      { value: "legendary-action-reference", label: "Legendary Action Reference" },
    ],
  })
);
mountField(
  "feature-mechanics-text",
  createCompactField({
    type: "textarea", id: "loomFeatureMechanicsText", label: "Mechanics Notes", labelClass: "form-label fw-semibold mb-0", controlClass: "form-control form-control-sm",
    dataAttr: "data-feature-mechanics-text", rows: 3,
  })
);
mountField(
  "feature-budget-cost",
  createCompactField({
    type: "number", id: "loomFeatureBudgetCost", label: "Cost Budget", labelClass: "form-label fw-semibold mb-0",
    dataAttr: "data-feature-budget-cost", min: "0",
  })
);
// "Generic" is the DEFAULT/unreviewed state, not a confirmed judgment —
// same "empty means unreviewed, not confirmed-reusable" convention
// budgetCost/tags use. The label used to read "Generic (eligible for
// native generation)" — misleading, since an untagged Feature (no
// tags.recipeSlots) is already excluded from Crucible's generation via a
// separate whitelist gate regardless of this select's value.
mountField(
  "feature-scope",
  createCompactField({
    type: "select", id: "loomFeatureScope", label: "Scope", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-feature-scope",
    options: [
      { value: "", label: "Generic (usable by any monster)" },
      { value: "unique", label: "Unique (not eligible for Crucible generation)" },
    ],
  })
);
mountField(
  "feature-type-filter",
  createCompactField({ type: "select", id: "loomFeatureTypeFilter", label: "Type", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select form-select-sm", dataAttr: "data-feature-type-filter" })
);
mountField("feature-select", createCompactField({ type: "select", id: "loomFeatureSelect", label: "Feature", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-feature-select" }));

const featureTypeFilterSelect = document.querySelector("[data-feature-type-filter]");
const featureRecordSelect = document.querySelector("[data-feature-select]");
const featureIdInput = document.querySelector("[data-feature-id]");
const featureNameInput = document.querySelector("[data-feature-name]");
const featureDescriptionInput = document.querySelector("[data-feature-description]");
const featureMechanicsTypeSelect = document.querySelector("[data-feature-mechanics-type]");
const featureMechanicsTextInput = document.querySelector("[data-feature-mechanics-text]");
const featureBudgetCostInput = document.querySelector("[data-feature-budget-cost]");
const featureScopeSelect = document.querySelector("[data-feature-scope]");
const featureEligibilityNote = document.querySelector("[data-feature-eligibility-note]");
const featureTiersList = document.querySelector("[data-feature-tiers]");
const featureTiersEmpty = document.querySelector("[data-feature-tiers-empty]");
const featureAddTierButton = document.querySelector("[data-feature-add-tier]");
const featureSuggestButton = document.querySelector("[data-feature-suggest]");
const featureSuggestStatus = document.querySelector("[data-feature-suggest-status]");
const featuresEmpty = document.querySelector("[data-features-empty]");
const featuresPanel = document.querySelector("[data-features-panel]");
const featureSaveButton = document.querySelector("[data-feature-save]");
const featureDuplicateButton = document.querySelector("[data-feature-duplicate]");
const featureDeleteButton = document.querySelector("[data-feature-delete]");
function setFeatureFormVisible(visible) {
  if (featuresEmpty) featuresEmpty.hidden = visible;
  if (featuresPanel) featuresPanel.classList.toggle("d-none", !visible);
}
function mountFeatureChecklist(mountSelector, label, helpTopic) {
  const mount = document.querySelector(mountSelector);
  if (!mount) return null;
  const field = createSearchableCheckList({ label, dataAttr: "data-checklist", helpTopic, maxHeight: "5rem" });
  mount.appendChild(field);
  return mount.querySelector("[data-checklist]");
}
const featureCategoriesList = mountFeatureChecklist("[data-feature-categories-mount]", "Categories");
const featureBehaviorsList = mountFeatureChecklist("[data-feature-behaviors-mount]", "Behaviors");
const featureRecipeSlotsList = mountFeatureChecklist("[data-feature-recipe-slots-mount]", "Recipe Slots");
const featureRolesList = mountFeatureChecklist("[data-feature-roles-mount]", "Roles");
const featureCreatureTypesList = mountFeatureChecklist("[data-feature-creature-types-mount]", "Creature Types");
const featureSynergizesList = mountFeatureChecklist("[data-feature-synergizes-mount]", "Synergizes With");
const featureConflictsList = mountFeatureChecklist("[data-feature-conflicts-mount]", "Conflicts With");

// The FULL entity, loaded once per selection — a field this tab's own
// controls don't directly own (`combat`, `systemIds`) still round-trips
// untouched on Save, since Save patches this SAME object.
let currentFeatureEntity = null;

// The Tiers list's own in-progress array — same "flat array is the source
// of truth while editing" convention macroEditorActions uses, not
// currentFeatureEntity.tiers directly, so reorder/add/remove can re-render
// freely before Save patches it back in.
let featureEditorTiers = [];

// Every vocabulary collector below does at least one server round trip;
// recomputing all of them on every Feature selection caused a real ~1s lag
// per click — fetchKindEntriesWithIds("feature") alone scans the full
// feature Library just to build the Behaviors/Categories vocabulary and the
// Synergizes/Conflicts picker's candidate list. Cached at module scope
// instead: the whole listing is fetched once and shared by all three (and
// by the Feature picker select — populateFeatureSelect below); the
// System-scoped vocab is cached per distinct systemIds combination. Some
// staleness is an acceptable trade for not re-fetching on every click —
// reset on every Save and on every fresh visit to this tab.
let featureLibraryEntriesCache = null;
let featureBehaviorVocabularyCache = null;
let featureCategoryVocabularyCache = null;
const featureSystemVocabularyCache = new Map();

function resetFeatureVocabularyCache() {
  featureLibraryEntriesCache = null;
  featureBehaviorVocabularyCache = null;
  featureCategoryVocabularyCache = null;
  featureSystemVocabularyCache.clear();
}

function loadFeatureLibraryEntries() {
  if (!featureLibraryEntriesCache) {
    featureLibraryEntriesCache = dataManager ? fetchKindEntriesWithIds(dataManager, "feature").catch(() => []) : Promise.resolve([]);
  }
  return featureLibraryEntriesCache;
}

function systemVocabKey(systemIds) {
  return (Array.isArray(systemIds) ? systemIds.slice().sort() : []).join("|");
}

// Live vocabulary for the Behaviors checklist — the union of every
// `tags.behaviors` value already used across the whole feature Library, not
// a hardcoded list (authored content, same as recipeSlots/roles/
// creatureTypes below). Returns `{value, label}` pairs (value === label
// here) so populateFeatureTagChecklists can treat every collector
// uniformly. Cached — shares the one loadFeatureLibraryEntries() fetch with
// collectFeatureCategoryVocabulary and the Synergizes/Conflicts picker.
async function collectFeatureBehaviorVocabulary() {
  if (featureBehaviorVocabularyCache) return featureBehaviorVocabularyCache;
  featureBehaviorVocabularyCache = (async () => {
    const entries = await loadFeatureLibraryEntries();
    const values = new Set();
    entries.forEach(({ entity }) => (entity?.tags?.behaviors || []).forEach((value) => values.add(value)));
    return Array.from(values, (value) => ({ value, label: value }));
  })();
  return featureBehaviorVocabularyCache;
}

// Same shape/reasoning as collectFeatureBehaviorVocabulary above, for
// `tags.categories` (which tool(s) this Feature belongs to —
// monster/spell/item/location).
async function collectFeatureCategoryVocabulary() {
  if (featureCategoryVocabularyCache) return featureCategoryVocabularyCache;
  featureCategoryVocabularyCache = (async () => {
    const entries = await loadFeatureLibraryEntries();
    const values = new Set();
    entries.forEach(({ entity }) => (entity?.tags?.categories || []).forEach((value) => values.add(value)));
    return Array.from(values, (value) => ({ value, label: value }));
  })();
  return featureCategoryVocabularyCache;
}

// Shared by the Recipe Slots/Roles vocabulary collectors below — both are
// Crucible-authored Library kinds scoped to a System the same way
// crucible/js/lib/tables.js's listKindForSystem scopes Archetype/Role/
// Feature lookups (mirrored locally rather than importing across tools).
// `pickValue(entity, map)` sets `map.set(storedValue, readableLabel)` — a
// Map since a Role's stored tag value is its lowercase id ("brute"), not
// its display name.
async function collectFeatureKindNamesForSystems(kind, systemIds, pickValue) {
  if (!dataManager) return [];
  try {
    const entries = await fetchKindEntriesWithIds(dataManager, kind);
    const ids = new Set(Array.isArray(systemIds) ? systemIds : []);
    const values = new Map();
    entries.forEach(({ entity }) => {
      const entitySystemIds = Array.isArray(entity?.systemIds) ? entity.systemIds : [];
      if (ids.size && entitySystemIds.length && !entitySystemIds.some((id) => ids.has(id))) return;
      pickValue(entity, values);
    });
    return Array.from(values, ([value, label]) => ({ value, label }));
  } catch (error) {
    return [];
  }
}

function collectFeatureRecipeSlotVocabulary(systemIds) {
  return collectFeatureKindNamesForSystems("monster-archetype", systemIds, (entity, values) => {
    const recipe = entity?.recipe || {};
    if (recipe.signatureSlot) values.set(recipe.signatureSlot, recipe.signatureSlot);
    (recipe.requiredSlots || []).forEach((slot) => values.set(slot, slot));
    (recipe.optionalSlots || []).forEach((slot) => values.set(slot, slot));
  });
}

// Stored as the Role's own lowercase `id` ("brute"), never its display
// `name` ("Brute") — using `.name` here would produce a checklist entry
// that never matches what's saved on a Feature, and a Feature already
// tagged with the id would show up as two separate rows once both forms
// were present in the vocabulary.
function collectFeatureRoleVocabulary(systemIds) {
  return collectFeatureKindNamesForSystems("monster-role", systemIds, (entity, values) => {
    if (entity?.id) values.set(entity.id, entity.name || entity.id);
  });
}

// Creature Types vocabulary — read straight off each Assigned System's own
// `fieldRoles` declaration (role "creatureType" — see field-roles.js), the
// same lookup Crucible's own generator uses, so the two never disagree.
// Unioned across every Assigned System since a Feature can carry more than
// one. Stored as the type's own lowercase `id`, never its display name,
// same reasoning as Roles above.
async function collectFeatureCreatureTypeVocabulary(systemIds) {
  if (!dataManager || !Array.isArray(systemIds) || !systemIds.length) return [];
  const values = new Map();
  for (const systemId of systemIds) {
    try {
      const result = await dataManager.get("systems", systemId, { preferLocal: false });
      const field = resolveFieldRole(result?.payload, "creatureType")?.fieldDef;
      (field?.values || []).forEach((value) => {
        if (value?.shortName) values.set(value.shortName, value.name || value.shortName);
      });
    } catch (error) {
      // Best-effort per System — one missing/unreadable System shouldn't
      // block the others from populating.
    }
  }
  return Array.from(values, ([value, label]) => ({ value, label }));
}

// Bundles the three System-scoped collectors above into ONE cached promise
// per distinct Assigned-Systems combination — most Features share the same
// systemIds, so repeat visits hit this cache instead of re-fetching
// monster-archetype/monster-role/each System record on every click.
function loadFeatureSystemVocabulary(systemIds) {
  const key = systemVocabKey(systemIds);
  if (!featureSystemVocabularyCache.has(key)) {
    featureSystemVocabularyCache.set(
      key,
      Promise.all([
        collectFeatureRecipeSlotVocabulary(systemIds),
        collectFeatureRoleVocabulary(systemIds),
        collectFeatureCreatureTypeVocabulary(systemIds),
      ]).then(([recipeSlots, roles, creatureTypes]) => ({ recipeSlots, roles, creatureTypes }))
    );
  }
  return featureSystemVocabularyCache.get(key);
}

// Already-selected values that fell out of a live vocabulary (a Recipe Slot
// from a deleted Archetype) still need to show up, checked — never silently
// drop authored data just because its source moved on. Shared by every
// checklist below, including Synergizes/Conflicts.
function withSelectedVocabulary(vocabulary, selected) {
  const known = new Set(vocabulary.map((item) => item.value));
  const extra = (selected || []).filter((value) => !known.has(value)).map((value) => ({ value, label: value }));
  return [...vocabulary, ...extra];
}

// Populates the Categories/Behaviors/Recipe Slots/Roles/Creature Types
// checklists for `entity` (a real loaded Feature, or a synthetic
// `{...currentFeatureEntity, tags: suggestion}` shape when applying an LLM
// suggestion) — always the full live vocabulary, with `entity.tags` checked
// and sorted to the top via populateStringChecklist's `selected` param.
// Never passes just the checked values as the whole list — that would wipe
// every other option from view.
async function populateFeatureTagChecklists(entity) {
  const systemIds = Array.isArray(entity?.systemIds) ? entity.systemIds : [];
  const tags = entity?.tags || {};
  const [categories, behaviors, systemVocabulary] = await Promise.all([
    collectFeatureCategoryVocabulary(),
    collectFeatureBehaviorVocabulary(),
    loadFeatureSystemVocabulary(systemIds),
  ]);
  const { recipeSlots, roles, creatureTypes } = systemVocabulary;
  const rows = [
    [featureCategoriesList, withSelectedVocabulary(categories, tags.categories), tags.categories],
    [featureBehaviorsList, withSelectedVocabulary(behaviors, tags.behaviors), tags.behaviors],
    [featureRecipeSlotsList, withSelectedVocabulary(recipeSlots, tags.recipeSlots), tags.recipeSlots],
    [featureRolesList, withSelectedVocabulary(roles, tags.roles), tags.roles],
    [featureCreatureTypesList, withSelectedVocabulary(creatureTypes, tags.creatureTypes), tags.creatureTypes],
  ];
  rows.forEach(([container, items, selected]) => populateStringChecklist(container, items, selected));
}

// Synergizes With / Conflicts With — plain references to OTHER Feature ids,
// not a tag vocabulary, so the "vocabulary" is just every other Feature
// (excluding this one) shown by name. Shares loadFeatureLibraryEntries()'s
// cached fetch with the Behaviors/Categories vocabulary above.
async function populateFeatureReferenceCheckLists(entity) {
  const entries = await loadFeatureLibraryEntries();
  const candidates = entries
    .filter(({ id }) => id !== entity?.id)
    .map(({ id, entity: candidate }) => ({ value: id, label: candidate?.name || id }));
  populateStringChecklist(featureSynergizesList, withSelectedVocabulary(candidates, entity?.synergizesWith), entity?.synergizesWith);
  populateStringChecklist(featureConflictsList, withSelectedVocabulary(candidates, entity?.conflictsWith), entity?.conflictsWith);
}

function readFeatureTagsFromChecklists() {
  return {
    categories: readLockedFeatureIds(featureCategoriesList),
    behaviors: readLockedFeatureIds(featureBehaviorsList),
    recipeSlots: readLockedFeatureIds(featureRecipeSlotsList),
    roles: readLockedFeatureIds(featureRolesList),
    creatureTypes: readLockedFeatureIds(featureCreatureTypesList),
  };
}

function readFeatureReferenceLists() {
  return {
    synergizesWith: readLockedFeatureIds(featureSynergizesList),
    conflictsWith: readLockedFeatureIds(featureConflictsList),
  };
}

// Type + Notes read straight off their own controls — no JSON parsing, so
// no invalid-JSON failure mode to guard against, unlike
// currentLibraryEntity() (Library tab) and its raw-JSON entity body.
function currentFeatureMechanics() {
  return { type: featureMechanicsTypeSelect?.value || "", text: featureMechanicsTextInput?.value || "" };
}

// Flags a real question the Scope field alone doesn't answer: even a
// Generic Feature is invisible to Crucible's generator until tagged with at
// least one Recipe Slot (generator.js's candidatesForSlot is a whitelist
// gate, separate from Scope). Scope's own eligibility meaning is stated in
// its select option now, so this note only ever needs to cover Recipe
// Slots — nothing shown once a Feature is already tagged.
function updateFeatureEligibilityNote() {
  if (!featureEligibilityNote) return;
  if (!currentFeatureEntity) {
    featureEligibilityNote.classList.add("d-none");
    return;
  }
  const hasRecipeSlots = readLockedFeatureIds(featureRecipeSlotsList).length > 0;
  const message = hasRecipeSlots
    ? ""
    : "Not currently eligible for native generation — no Recipe Slots tagged yet (an untagged Feature is invisible to slot-fill regardless of Scope).";
  featureEligibilityNote.textContent = message;
  featureEligibilityNote.classList.toggle("d-none", !message);
}

// Tiers editor — same row-list shape as the Macros tab's own
// macroEditorActions/renderMacroActionsEditor (add/remove/reorder a flat
// array, re-render on any change), reusing that tab's generic
// macroFieldRow/macroTextInput/macroTextarea/macroNumberInput DOM builders
// directly — plain field builders with no macro-specific logic despite the name.
function updateFeatureTier(index, patch) {
  recordUndoableChange("feature", () => {
    if (!featureEditorTiers[index]) return;
    featureEditorTiers[index] = { ...featureEditorTiers[index], ...patch };
    renderFeatureTiersEditor();
  });
}

function removeFeatureTier(index) {
  recordUndoableChange("feature", () => {
    featureEditorTiers.splice(index, 1);
    renderFeatureTiersEditor();
  });
}

function reorderFeatureTiers(oldIndex, newIndex) {
  if (oldIndex === newIndex) return;
  recordUndoableChange("feature", () => {
    const [moved] = featureEditorTiers.splice(oldIndex, 1);
    featureEditorTiers.splice(newIndex, 0, moved);
    renderFeatureTiersEditor();
  });
}

function renderFeatureTierRow(tier, index) {
  const row = document.createElement("div");
  row.className = "d-flex flex-column gap-2 border rounded p-2";

  const headerRow = document.createElement("div");
  headerRow.className = "d-flex align-items-start gap-2";

  const handle = document.createElement("span");
  handle.className = "iconify text-body-secondary mt-2";
  handle.dataset.icon = "tabler:grip-vertical";
  handle.setAttribute("data-sortable-handle", "");
  handle.setAttribute("aria-hidden", "true");
  handle.style.cursor = "grab";
  headerRow.appendChild(handle);

  const fieldsRow = document.createElement("div");
  fieldsRow.className = "row g-2 flex-grow-1";
  const idCol = document.createElement("div");
  idCol.className = "col-12 col-md-3";
  idCol.appendChild(
    macroInlineFieldRow(
      "Id",
      macroTextInput(tier.id, "minor", (value) => updateFeatureTier(index, { id: value.trim() }))
    )
  );
  const nameCol = document.createElement("div");
  nameCol.className = "col-12 col-md-4";
  nameCol.appendChild(
    macroInlineFieldRow(
      "Name",
      macroTextInput(tier.name, "Minor", (value) => updateFeatureTier(index, { name: value }))
    )
  );
  const shortNameCol = document.createElement("div");
  shortNameCol.className = "col-12 col-md-3";
  shortNameCol.appendChild(
    macroInlineFieldRow(
      "Short",
      macroTextInput(tier.shortName, "Minor", (value) => updateFeatureTier(index, { shortName: value }))
    )
  );
  const budgetCol = document.createElement("div");
  budgetCol.className = "col-12 col-md-2";
  budgetCol.appendChild(
    macroInlineFieldRow(
      "Cost",
      macroNumberInput(tier.budgetCost, (value) => updateFeatureTier(index, { budgetCost: value ?? 0 }))
    )
  );
  fieldsRow.append(idCol, nameCol, shortNameCol, budgetCol);
  headerRow.appendChild(fieldsRow);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "btn btn-outline-danger btn-sm p-1";
  removeButton.setAttribute("aria-label", "Remove tier");
  removeButton.setAttribute("data-bs-toggle", "tooltip");
  removeButton.setAttribute("data-bs-title", "Remove tier");
  removeButton.innerHTML = `<span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>`;
  removeButton.addEventListener("click", () => removeFeatureTier(index));
  headerRow.appendChild(removeButton);

  row.appendChild(headerRow);

  // Tier `mechanics.text` is the only per-tier mechanics field surfaced —
  // every tiered Feature keeps `mechanics.type` identical to the parent's
  // across all its tiers, so that value is copied from the parent
  // (currentFeatureMechanics()) on Save rather than duplicated per row. No
  // label — the placeholder already says what it is.
  row.appendChild(
    macroTextarea(
      tier.mechanics?.text,
      "What this tier means…",
      (value) => updateFeatureTier(index, { mechanics: { ...(featureEditorTiers[index]?.mechanics || {}), text: value } }),
      2
    )
  );

  return row;
}

let featureTiersSortable = null;

function renderFeatureTiersEditor() {
  if (!featureTiersList) return;
  // Disposed before the wipe — each tier row's Remove button carries a real
  // tooltip, and this reruns on every tier edit/add/remove/reorder (see
  // tooltips.js's BUG CLASS 2).
  disposeTooltips(featureTiersList);
  featureTiersList.innerHTML = "";
  if (featureTiersEmpty) featureTiersEmpty.classList.toggle("d-none", featureEditorTiers.length > 0);
  featureEditorTiers.forEach((tier, index) => {
    featureTiersList.appendChild(renderFeatureTierRow(tier || {}, index));
  });
  if (featureTiersSortable) {
    featureTiersSortable.destroy();
    featureTiersSortable = null;
  }
  if (featureEditorTiers.length > 1) {
    featureTiersSortable = createSortable(featureTiersList, {
      onEnd(event) {
        if (event.oldIndex === event.newIndex) return;
        reorderFeatureTiers(event.oldIndex, event.newIndex);
      },
    });
  }
  refreshTooltips(featureTiersList);
}

if (featureAddTierButton) {
  featureAddTierButton.addEventListener("click", () => {
    recordUndoableChange("feature", () => {
      featureEditorTiers.push({ id: "", name: "", shortName: "", budgetCost: 0, mechanics: { text: "" } });
      renderFeatureTiersEditor();
    });
  });
}

// Undo/dirty-tracking snapshot for this tab — every field this tab's
// controls can change, same SNAPSHOT_HANDLERS[type] convention every other
// tab registers itself under.
function createFeatureSnapshot() {
  return {
    id: featureRecordSelect?.value || "",
    name: featureNameInput?.value || "",
    description: featureDescriptionInput?.value || "",
    mechanicsType: featureMechanicsTypeSelect?.value || "",
    mechanicsText: featureMechanicsTextInput?.value || "",
    budgetCost: featureBudgetCostInput?.value || "",
    scope: featureScopeSelect?.value || "",
    tiers: JSON.parse(JSON.stringify(featureEditorTiers)),
    tags: readFeatureTagsFromChecklists(),
    references: readFeatureReferenceLists(),
  };
}

function applyFeatureSnapshot(snapshot) {
  if (!snapshot) return;
  if (featureRecordSelect) featureRecordSelect.value = snapshot.id || "";
  if (featureNameInput) featureNameInput.value = snapshot.name || "";
  if (featureDescriptionInput) featureDescriptionInput.value = snapshot.description || "";
  if (featureMechanicsTypeSelect) featureMechanicsTypeSelect.value = snapshot.mechanicsType || "";
  if (featureMechanicsTextInput) featureMechanicsTextInput.value = snapshot.mechanicsText || "";
  if (featureBudgetCostInput) featureBudgetCostInput.value = snapshot.budgetCost || "";
  if (featureScopeSelect) featureScopeSelect.value = snapshot.scope || "";
  featureEditorTiers = Array.isArray(snapshot.tiers) ? snapshot.tiers : [];
  renderFeatureTiersEditor();
  const stampChecked = (container, selected) => {
    if (!container) return;
    const selectedSet = new Set(selected || []);
    container.querySelectorAll("[data-checklist-options] input[type=checkbox]").forEach((input) => {
      input.checked = selectedSet.has(input.value);
    });
  };
  stampChecked(featureCategoriesList, snapshot.tags?.categories);
  stampChecked(featureBehaviorsList, snapshot.tags?.behaviors);
  stampChecked(featureRecipeSlotsList, snapshot.tags?.recipeSlots);
  stampChecked(featureRolesList, snapshot.tags?.roles);
  stampChecked(featureCreatureTypesList, snapshot.tags?.creatureTypes);
  stampChecked(featureSynergizesList, snapshot.references?.synergizesWith);
  stampChecked(featureConflictsList, snapshot.references?.conflictsWith);
}

// Resets the vocabulary cache on every fresh visit to this tab (a Save
// elsewhere might have introduced a new value since the cache was built).
// Also reuses the SAME loadFeatureLibraryEntries() fetch this triggers for
// the Feature picker itself, rather than a redundant full-Library fetch.
// Type filter narrows the Feature picker below by tags.categories — e.g.
// "monster" vs a Vault-authored "spell"/"item" — so similarly-named
// Features can be told apart without opening each one. Options are the
// distinct categories actually present (never hardcoded), rebuilt every visit.
function populateFeatureTypeFilter(entries) {
  if (!featureTypeFilterSelect) return;
  const current = featureTypeFilterSelect.value;
  const categories = new Set();
  entries.forEach(({ entity }) => (entity?.tags?.categories || []).forEach((category) => categories.add(category)));
  featureTypeFilterSelect.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All types";
  featureTypeFilterSelect.appendChild(all);
  Array.from(categories)
    .sort((a, b) => a.localeCompare(b))
    .forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category.charAt(0).toUpperCase() + category.slice(1);
      featureTypeFilterSelect.appendChild(option);
    });
  if (Array.from(featureTypeFilterSelect.options).some((option) => option.value === current)) {
    featureTypeFilterSelect.value = current;
  }
}

// `preserveSelection` (default true) re-selects whatever was already picked
// once reloading finishes, if it's still visible — right after Save and on
// initial load both want that. Switching the Type filter wants the
// opposite: a filtered list almost never still contains the previously-
// selected feature, and even when it does, staying selected reads as the
// Type change having done nothing — so that caller passes false.
async function populateFeatureSelect({ preserveSelection = true } = {}) {
  if (!featureRecordSelect || !dataManager) return;
  const current = featureRecordSelect.value;
  // Immediate, synchronous feedback before the slow part below starts —
  // loadFeatureLibraryEntries can take a real moment, and leaving the
  // select showing its previous option during that wait gave no indication
  // anything was happening.
  featureRecordSelect.innerHTML = "";
  const loadingOption = document.createElement("option");
  loadingOption.value = "";
  loadingOption.textContent = "Loading…";
  loadingOption.disabled = true;
  featureRecordSelect.appendChild(loadingOption);
  featureRecordSelect.value = "";

  resetFeatureVocabularyCache();
  const entries = await loadFeatureLibraryEntries();
  populateFeatureTypeFilter(entries);
  const selectedType = featureTypeFilterSelect?.value || "";
  const visibleEntries = selectedType
    ? entries.filter(({ entity }) => (entity?.tags?.categories || []).includes(selectedType))
    : entries;
  featureRecordSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = visibleEntries.length ? "Select a feature…" : "No features match this type";
  featureRecordSelect.appendChild(blank);
  visibleEntries
    .slice()
    .sort((a, b) => (a.entity?.name || a.id).localeCompare(b.entity?.name || b.id))
    .forEach(({ id, entity }) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = entity?.name || id;
      featureRecordSelect.appendChild(option);
    });
  if (preserveSelection && Array.from(featureRecordSelect.options).some((option) => option.value === current)) {
    featureRecordSelect.value = current;
  }
}

featureTypeFilterSelect?.addEventListener("change", () => {
  void populateFeatureSelect({ preserveSelection: false });
});

async function loadFeatureIntoEditor(id) {
  if (!dataManager) return;
  try {
    // preferLocal: false — same reasoning as loadMacroIntoEditor/
    // loadLibraryEntry: a stale local cache winning here would mean a
    // resave reverts whatever's actually on the server.
    const result = await dataManager.get("feature", id, { preferLocal: false });
    currentFeatureEntity = result.payload || null;
    if (!currentFeatureEntity) throw new Error("Not found");
    setFeatureFormVisible(true);
    if (featureIdInput) featureIdInput.value = id;
    if (featureNameInput) featureNameInput.value = currentFeatureEntity.name || id;
    if (featureDescriptionInput) featureDescriptionInput.value = currentFeatureEntity.description || "";
    if (featureMechanicsTypeSelect) featureMechanicsTypeSelect.value = currentFeatureEntity.mechanics?.type || "passive";
    if (featureMechanicsTextInput) featureMechanicsTextInput.value = currentFeatureEntity.mechanics?.text || "";
    if (featureBudgetCostInput) featureBudgetCostInput.value = String(currentFeatureEntity.budgetCost || 0);
    if (featureScopeSelect) featureScopeSelect.value = currentFeatureEntity.mechanics?.scope === "unique" ? "unique" : "";
    featureEditorTiers = Array.isArray(currentFeatureEntity.tiers)
      ? JSON.parse(JSON.stringify(currentFeatureEntity.tiers))
      : [];
    renderFeatureTiersEditor();
    await Promise.all([populateFeatureTagChecklists(currentFeatureEntity), populateFeatureReferenceCheckLists(currentFeatureEntity)]);
    if (featureSuggestStatus) featureSuggestStatus.classList.add("d-none");
    markClean("feature");
  } catch (error) {
    status?.show(`Unable to load feature: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

if (featureRecordSelect) {
  featureRecordSelect.addEventListener("change", () => {
    if (!featureRecordSelect.value) {
      currentFeatureEntity = null;
      featureEditorTiers = [];
      renderFeatureTiersEditor();
      setFeatureFormVisible(false);
      markClean("feature");
      return;
    }
    void loadFeatureIntoEditor(featureRecordSelect.value);
  });
}

wireUndoTracking(featureNameInput, "feature");
wireUndoTracking(featureDescriptionInput, "feature");
wireUndoTracking(featureMechanicsTypeSelect, "feature");
wireUndoTracking(featureMechanicsTextInput, "feature");
wireUndoTracking(featureBudgetCostInput, "feature");
wireUndoTracking(featureScopeSelect, "feature");
// A checklist's checkboxes are dynamically rebuilt rows, not one fixed
// field — same `selector` use wireUndoTracking's header comment anticipates.
// focusin (before the check/uncheck) + change (after) is the same two-phase
// capture every other field here needs.
[
  featureCategoriesList,
  featureBehaviorsList,
  featureRecipeSlotsList,
  featureRolesList,
  featureCreatureTypesList,
  featureSynergizesList,
  featureConflictsList,
].forEach((container) => {
  wireUndoTracking(container, "feature", { selector: 'input[type="checkbox"]' });
});

function canSaveFeature() {
  return Boolean(currentFeatureEntity && featureRecordSelect?.value && featureMechanicsTypeSelect?.value) && isDirty("feature");
}

function canDeleteFeature() {
  return Boolean(currentFeatureEntity && featureRecordSelect?.value) && libraryEntryAllowsDelete("feature", featureRecordSelect.value);
}

// No isDirty("feature")/mechanics requirement, unlike canSaveFeature —
// duplicating an unmodified saved Feature is just as valid as a mid-edit
// one (same reasoning canDuplicateSystem documents).
function canDuplicateFeature() {
  return Boolean(currentFeatureEntity && featureRecordSelect?.value);
}

if (featureSaveButton) {
  featureSaveButton.addEventListener("click", async () => {
    if (!dataManager || !currentFeatureEntity) return;
    const id = featureRecordSelect.value;
    const mechanics = currentFeatureMechanics();
    if (!mechanics.type) {
      status?.show("Choose a Mechanics Type before saving.", { type: "error", timeout: 3000 });
      return;
    }
    // Every tier needs its own non-blank, unique id — it's the storage key
    // record.featureTiers[feature.id] resolves against elsewhere (Vault/
    // Crucible's renderFeatureTierEditor), so a blank/duplicate id would
    // silently break that lookup.
    const tierIds = featureEditorTiers.map((tier) => (tier.id || "").trim());
    if (tierIds.some((tierId) => !tierId)) {
      status?.show("Every tier needs an id before saving.", { type: "error", timeout: 3000 });
      return;
    }
    if (new Set(tierIds).size !== tierIds.length) {
      status?.show("Tier ids must be unique.", { type: "error", timeout: 3000 });
      return;
    }
    currentFeatureEntity.name = (featureNameInput?.value || "").trim() || id;
    currentFeatureEntity.description = featureDescriptionInput?.value || "";
    currentFeatureEntity.mechanics = mechanics;
    currentFeatureEntity.budgetCost = Math.max(0, Math.round(Number(featureBudgetCostInput?.value)) || 0);
    if (featureScopeSelect?.value === "unique") currentFeatureEntity.mechanics.scope = "unique";
    else delete currentFeatureEntity.mechanics.scope;
    if (featureEditorTiers.length) {
      currentFeatureEntity.tiers = featureEditorTiers.map((tier) => ({
        id: (tier.id || "").trim(),
        name: tier.name || "",
        shortName: tier.shortName || tier.name || "",
        budgetCost: Math.max(0, Math.round(Number(tier.budgetCost)) || 0),
        mechanics: { type: mechanics.type, text: tier.mechanics?.text || "" },
      }));
    } else {
      delete currentFeatureEntity.tiers;
    }
    currentFeatureEntity.tags = { ...(currentFeatureEntity.tags || {}), ...readFeatureTagsFromChecklists() };
    Object.assign(currentFeatureEntity, readFeatureReferenceLists());
    try {
      await dataManager.save("feature", id, currentFeatureEntity);
      status?.show(`Saved feature ${id}.`, { type: "success", timeout: 2000 });
      markClean("feature");
      // A new name/tag/category value from this save should be visible next
      // time it's needed — populateFeatureSelect resets the vocabulary
      // cache and rebuilds the picker.
      await populateFeatureSelect();
      featureRecordSelect.value = id;
    } catch (error) {
      status?.show(`Unable to save feature: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// Same "-copy"/"-copyN" suffix convention generateDuplicateSystemId uses.
function generateDuplicateFeatureId(baseId) {
  const raw = (baseId || "").trim();
  const root = raw.replace(/(-copy\d*)$/i, "") || raw || "feature";
  const existingIds = new Set(
    Array.from(featureRecordSelect?.options || []).map((option) => option.value).filter(Boolean)
  );
  let candidate = `${root}-copy`;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${root}-copy${counter}`;
    counter += 1;
  }
  return candidate;
}

// Unlike Library/System/Macro's own duplicate handlers, a Feature has no
// typeable-id "staged, not yet saved" state — featureRecordSelect only
// holds ids that already exist on the server. Duplicate here saves the
// clone immediately under a fresh id, then loads it into the editor.
if (featureDuplicateButton) {
  featureDuplicateButton.addEventListener("click", async () => {
    if (!dataManager || !currentFeatureEntity || !featureRecordSelect?.value) return;
    const sourceId = featureRecordSelect.value;
    const newId = generateDuplicateFeatureId(sourceId);
    const duplicate = { ...currentFeatureEntity, id: newId, name: `${currentFeatureEntity.name || sourceId} Copy` };
    try {
      await dataManager.save("feature", newId, duplicate);
      status?.show(`Duplicated as "${newId}".`, { type: "success", timeout: 2500 });
      await populateFeatureSelect();
      featureRecordSelect.value = newId;
      await loadFeatureIntoEditor(newId);
    } catch (error) {
      status?.show(`Unable to duplicate feature: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

if (featureDeleteButton) {
  featureDeleteButton.addEventListener("click", async () => {
    if (!dataManager || !featureRecordSelect?.value) return;
    const id = featureRecordSelect.value;
    if (!confirmDelete({ label: `feature "${id}"` })) return;
    try {
      await dataManager.delete("feature", id);
      status?.show(`Deleted feature ${id}.`, { type: "success", timeout: 2000 });
    } catch (error) {
      dataManager.removeLocal("feature", id);
      status?.show(`Removed ${id} locally (server delete failed: ${error.message}).`, { type: "warning", timeout: 4000 });
    }
    currentFeatureEntity = null;
    featureRecordSelect.value = "";
    setFeatureFormVisible(false);
    await populateFeatureSelect();
  });
}

// LLM-assisted starting guess — POSTs this ONE Feature to
// /loom/suggest-feature-tags. Applies via populateFeatureTagChecklists —
// the SAME full-vocabulary render a normal load uses, with the suggestion's
// values as the checked set, so it never wipes the other options out.
// Never saves on its own; the GM still reviews and clicks Save.
//
// Not wrapped in recordUndoableChange — that helper snapshots synchronously
// around its action(), but populating the checklists here is async, so the
// "after" snapshot would be captured before the DOM finished updating.
// Skips a dedicated undo-stack entry (re-selecting the Feature without
// saving already discards it) but still calls updateToolbarState() so Save
// lights up once applied.
async function handleSuggestFeatureTags() {
  const id = featureRecordSelect?.value;
  if (!currentFeatureEntity || !id) return;
  const originalHtml = featureSuggestButton?.innerHTML;
  if (featureSuggestButton) {
    featureSuggestButton.disabled = true;
    featureSuggestButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Suggesting…';
  }
  if (featureSuggestStatus) featureSuggestStatus.classList.add("d-none");
  try {
    // Reads the LIVE, possibly-unsaved fields rather than
    // currentFeatureEntity's last-loaded values — an unsaved description
    // should still inform the suggestion.
    const response = await fetch("/loom/suggest-feature-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        features: [
          {
            id,
            name: featureNameInput?.value || "",
            description: featureDescriptionInput?.value || "",
            mechanicsType: currentFeatureMechanics()?.type || "passive",
          },
        ],
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    const suggestion = payload?.suggestions?.[id];
    if (!suggestion) throw new Error("No suggestion returned for this Feature.");
    if (featureBudgetCostInput) featureBudgetCostInput.value = String(suggestion.budgetCost ?? 0);
    // Scope isn't part of the suggestion payload (a "unique" judgment call
    // the LLM route deliberately doesn't make) — left as-is. Categories
    // isn't either — preserved from the current tags, not suggested.
    await populateFeatureTagChecklists({
      ...currentFeatureEntity,
      tags: {
        categories: currentFeatureEntity.tags?.categories || [],
        behaviors: suggestion.behaviors || [],
        recipeSlots: suggestion.recipeSlots || [],
        roles: suggestion.roles || [],
        creatureTypes: suggestion.creatureTypes || [],
      },
    });
    updateToolbarState();
    if (featureSuggestStatus) {
      featureSuggestStatus.textContent = "Suggestion applied above — review, then Save if it looks right.";
      featureSuggestStatus.classList.remove("d-none");
    }
  } catch (error) {
    status?.show(`Unable to suggest tags: ${error.message}`, { type: "error", timeout: 5000 });
  } finally {
    if (featureSuggestButton) {
      featureSuggestButton.disabled = false;
      featureSuggestButton.innerHTML = originalHtml;
    }
  }
}
featureSuggestButton?.addEventListener("click", handleSuggestFeatureTags);

// --- Macro Actions editor (Library tab, kind "macro" only) -----------------
// Same kind-gated-section pattern as populateLibraryTemplateSelect above,
// authoring the exact actions:[] array runMacro() (macro-runner.js) reads at
// execution time. Type/label/action metadata comes from the shared
// MACRO_ACTION_CATALOG (macro-action-catalog.js) — the same registry
// macro-runner.js's per-step toasts read — plus which `target` field (if
// any) each type takes. No `target` for Clock/Calendar — there's no
// portable "which one" to author, only "whichever is shown to the table,"
// resolved at run time (dashboard.js's findActiveWidgetInstance).
const MACRO_ACTION_TARGET_KINDS = {
  wled: "alias",
  combat: "encounterOrActive",
  character: "characterId",
};
const MACRO_ACTION_TYPES = Object.fromEntries(
  Object.entries(MACRO_ACTION_CATALOG).map(([type, def]) => [
    type,
    { ...def, target: MACRO_ACTION_TARGET_KINDS[type] || null },
  ])
);

function macroActionsFor(type) {
  return MACRO_ACTION_TYPES[type]?.actions || {};
}

function macroFieldRow(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "d-flex flex-column gap-1";
  const label = document.createElement("label");
  label.className = "form-label small mb-0 text-body-secondary";
  label.textContent = labelText;
  wrap.append(label, inputEl);
  return wrap;
}

// Label beside the input on one line, not stacked above it — for a row of
// several short fields (Tier editor's Id/Name/Short Name/Cost Budget) where
// a stacked label per field wastes vertical space.
function macroInlineFieldRow(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "d-flex align-items-center gap-1";
  const label = document.createElement("label");
  label.className = "form-label small mb-0 text-body-secondary text-nowrap";
  label.textContent = labelText;
  inputEl.classList.add("flex-grow-1");
  inputEl.style.minWidth = "0";
  wrap.append(label, inputEl);
  return wrap;
}

function macroTextInput(value, placeholder, onChange) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control form-control-sm";
  if (placeholder) input.placeholder = placeholder;
  input.value = value ?? "";
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

function macroTextarea(value, placeholder, onChange, rows = 3) {
  const textarea = document.createElement("textarea");
  textarea.className = "form-control form-control-sm font-monospace";
  textarea.rows = rows;
  if (placeholder) textarea.placeholder = placeholder;
  textarea.value = value ?? "";
  textarea.addEventListener("change", () => onChange(textarea.value));
  return textarea;
}

function macroNumberInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-control form-control-sm";
  if (value !== undefined && value !== null) input.value = value;
  input.addEventListener("change", () => onChange(input.value === "" ? undefined : Number(input.value)));
  return input;
}

function macroCheckbox(checked, labelText, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "form-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  const id = `library-macro-check-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked));
  const label = document.createElement("label");
  label.className = "form-check-label small";
  label.htmlFor = id;
  label.textContent = labelText;
  wrap.append(input, label);
  return wrap;
}

function macroSelect(options, value, onChange) {
  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  options.forEach(({ value: optValue, label }) => {
    const option = document.createElement("option");
    option.value = optValue;
    option.textContent = label;
    option.selected = optValue === (value ?? "");
    select.appendChild(option);
  });
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function macroClipOptions() {
  return [
    { value: "", label: "Select a clip…" },
    ...getAllClips().map((clip) => ({ value: clip.id, label: `${clip.name} (${clip.type})` })),
  ];
}

// Shared by every "pick one saved record of a kind" field below (Handout/
// Map's contentRef id, Character's target, Encounter's target) — one inline
// <select> populated via fetchKindEntrySummaries, never a modal picker: a
// modal adds a click for no benefit once the list is short enough for a
// dropdown (Handout/Map's own live widgets keep the modal for their initial
// "add" step, where the list can be much longer — this is Loom's
// authoring-time editor, not that picker).
function macroKindEntitySelect(kind, currentValue, onChange, { leadingOption } = {}) {
  const blank = leadingOption || { value: "", label: kind ? "Select…" : "Pick a kind first…" };
  const select = macroSelect([blank], currentValue || blank.value, onChange);
  select.disabled = !kind;
  if (dataManager && kind) {
    // Just an id -> label lookup for the dropdown — never reads any other
    // field off the picked record, so the metadata-only /list fetch
    // (fetchKindEntrySummaries) is enough.
    void fetchKindEntrySummaries(dataManager, kind)
      .then((entries) => {
        const current = select.value || currentValue || blank.value;
        select.innerHTML = "";
        [blank, ...entries.map(({ id, name }) => ({ value: id, label: name || id }))].forEach(
          ({ value, label }) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            option.selected = value === current;
            select.appendChild(option);
          }
        );
      })
      .catch(() => {});
  }
  return select;
}

function renderMacroParamField(fieldName, action, onUpdate) {
  const params = action.params && typeof action.params === "object" ? action.params : {};
  const setParam = (patch) => onUpdate({ ...params, ...patch });

  switch (fieldName) {
    case "presetId":
      return macroFieldRow("Preset id", macroNumberInput(params.presetId, (v) => setParam({ presetId: v })));
    case "value":
      return macroFieldRow("Value", macroNumberInput(params.value, (v) => setParam({ value: v })));
    case "delta":
      return macroFieldRow("Delta (+/-)", macroNumberInput(params.delta, (v) => setParam({ delta: v })));
    case "fx":
      return macroFieldRow("Effect index", macroNumberInput(params.fx, (v) => setParam({ fx: v })));
    case "segmentId":
      return macroFieldRow("Segment id (optional)", macroNumberInput(params.segmentId, (v) => setParam({ segmentId: v })));
    case "entityId": {
      // Populated from Home Assistant's live entity list rather than a
      // free-text field — same "pick from what exists" shape
      // macroKindEntitySelect gives every Library-kind reference field
      // above, backed by a live external fetch instead. Not
      // domain-restricted here (unlike the Lighting widget's own "Add an HA
      // light" flow) — this action can target any entity in any domain.
      const select = macroSelect([{ value: "", label: "Loading…" }], params.entityId || "", (v) => setParam({ entityId: v }));
      void listHaEntities(dataManager, { status }).then((entities) => {
        const current = select.value || params.entityId || "";
        select.innerHTML = "";
        [
          { value: "", label: entities.length ? "Select an entity…" : "No entities loaded — check your Home Assistant connection" },
          ...entities.map((entity) => ({ value: entity.entityId, label: `${entity.friendlyName} (${entity.entityId})` })),
        ].forEach(({ value, label }) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          option.selected = value === current;
          select.appendChild(option);
        });
      });
      return macroFieldRow("Entity", select);
    }
    case "domain":
      return macroFieldRow("Domain", macroTextInput(params.domain, "e.g. light, switch, script", (v) => setParam({ domain: v })));
    case "service":
      return macroFieldRow("Service", macroTextInput(params.service, "e.g. turn_on, set_temperature", (v) => setParam({ service: v })));
    case "data":
      return macroFieldRow(
        "Extra data (JSON, optional)",
        macroTextarea(params.data, '{"brightness": 200}', (v) => setParam({ data: v }))
      );
    case "clipId": {
      const select = macroSelect(macroClipOptions(), params.clipId || "", (v) => setParam({ clipId: v }));
      void loadClipLibrary().then(() => {
        const current = select.value || params.clipId || "";
        select.innerHTML = "";
        macroClipOptions().forEach(({ value, label }) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          option.selected = value === current;
          select.appendChild(option);
        });
      });
      return macroFieldRow("Clip", select);
    }
    case "clipType":
      return macroFieldRow(
        "Clip type",
        macroSelect(
          [
            { value: "sfx", label: "SFX" },
            { value: "music", label: "Music" },
          ],
          params.clipType || "sfx",
          (v) => setParam({ clipType: v })
        )
      );
    case "loop":
      return macroCheckbox(params.loop, "Loop", (v) => setParam({ loop: v }));
    case "broadcast":
      return macroCheckbox(params.broadcast, "Broadcast to the table", (v) => setParam({ broadcast: v }));
    case "announce":
      return macroCheckbox(params.announce, "Post result to the Game Log", (v) => setParam({ announce: v }));
    case "message":
      return macroFieldRow("Message", macroTextInput(params.message, "Text to post", (v) => setParam({ message: v })));
    case "expression":
      return macroFieldRow("Expression", macroTextInput(params.expression, "e.g. 2d6 + 3", (v) => setParam({ expression: v })));
    case "url":
      return macroFieldRow("URL", macroTextInput(params.url, "https://…", (v) => setParam({ url: v })));
    case "target":
      return macroFieldRow(
        "Effect label",
        macroTextInput(params.target, "e.g. Boss Burst, or a marker's own name", (v) => setParam({ target: v }))
      );
    case "condition":
      return macroFieldRow("Condition", macroTextInput(params.condition, "e.g. Poisoned", (v) => setParam({ condition: v })));
    case "field":
      return macroFieldRow(
        "Field",
        macroSelect(
          [
            { value: "hp", label: "HP" },
            { value: "maxHp", label: "Max HP" },
            { value: "tempHp", label: "Temp HP" },
            { value: "ac", label: "AC" },
          ],
          params.field || "hp",
          (v) => setParam({ field: v })
        )
      );
    case "refKind":
      return macroFieldRow(
        "Combatant kind",
        macroSelect(
          [
            { value: "monster", label: "Monster" },
            { value: "npc", label: "NPC" },
            { value: "character", label: "Character" },
          ],
          params.refKind || "monster",
          (v) => setParam({ refKind: v })
        )
      );
    case "refId":
      return macroFieldRow("Combatant id", macroTextInput(params.refId, "", (v) => setParam({ refId: v })));
    case "name":
      return macroFieldRow("Name (optional)", macroTextInput(params.name, "", (v) => setParam({ name: v })));
    case "filled":
      return macroFieldRow("Filled segments", macroNumberInput(params.filled, (v) => setParam({ filled: v })));
    case "minutes":
      return macroFieldRow("Minutes (+/-)", macroNumberInput(params.minutes, (v) => setParam({ minutes: v })));
    case "contentRef": {
      const contentRef = params.contentRef && typeof params.contentRef === "object" ? params.contentRef : {};
      const isMap = action.type === "map";
      const wrap = document.createElement("div");
      wrap.className = "d-flex flex-column gap-2";

      if (!isMap) {
        // Restricted to what Handout can actually render (HANDOUT_KINDS),
        // not every Library kind — offering the full list meant most
        // choices would 404 at run time.
        const kindOptions = [
          { value: "", label: "Select a kind…" },
          ...HANDOUT_KINDS.map((id) => ({ value: id, label: HANDOUT_KIND_LABELS[id] || id })),
        ];
        const kindSelect = macroSelect(kindOptions, contentRef.kind || "", (v) =>
          setParam({ contentRef: { kind: v, id: "" } })
        );
        wrap.appendChild(macroFieldRow("Content kind", kindSelect));
      }

      const targetKind = isMap ? "map" : contentRef.kind;
      const idSelect = macroKindEntitySelect(
        targetKind,
        contentRef.id,
        (v) => setParam({ contentRef: { ...contentRef, kind: targetKind, id: v } }),
        { leadingOption: { value: "", label: targetKind ? "Select…" : "Pick a kind first…" } }
      );
      wrap.appendChild(macroFieldRow("Content", idSelect));
      return wrap;
    }
    default:
      return null;
  }
}

function renderMacroTargetField(targetKind, action, onChange) {
  if (targetKind === "alias") {
    return macroFieldRow("Device alias", macroTextInput(action.target, "e.g. table-lights", onChange));
  }
  if (targetKind === "characterId") {
    const select = macroKindEntitySelect("character", action.target, onChange, {
      leadingOption: { value: "", label: "Select a character…" },
    });
    return macroFieldRow("Character", select);
  }
  if (targetKind === "encounterOrActive") {
    const select = macroKindEntitySelect("encounter", action.target || "active", onChange, {
      leadingOption: { value: "active", label: "Whichever is shown to the table" },
    });
    return macroFieldRow("Encounter", select);
  }
  return null;
}

// The Macros tab's own in-progress action list — source of truth while
// editing (unlike Systems' own Properties, which nest arbitrarily deep and
// read straight from the DOM instead; a flat actions array has no such
// need). newMacroEditor/loadMacroIntoEditor/applyMacroSnapshot all reset
// this before re-rendering.
let macroEditorActions = [];

function updateMacroAction(index, patch) {
  recordUndoableChange("macro", () => {
    if (!macroEditorActions[index]) return;
    macroEditorActions[index] = { ...macroEditorActions[index], ...patch };
    renderMacroActionsEditor();
  });
}

function removeMacroAction(index) {
  recordUndoableChange("macro", () => {
    macroEditorActions.splice(index, 1);
    renderMacroActionsEditor();
  });
}

function reorderMacroActions(oldIndex, newIndex) {
  if (oldIndex === newIndex) return;
  recordUndoableChange("macro", () => {
    const [moved] = macroEditorActions.splice(oldIndex, 1);
    macroEditorActions.splice(newIndex, 0, moved);
    renderMacroActionsEditor();
  });
}

function renderMacroActionRow(action, index) {
  const row = document.createElement("div");
  row.className = "d-flex flex-column gap-2 border rounded p-2";

  const headerRow = document.createElement("div");
  headerRow.className = "d-flex align-items-center gap-2";

  const handle = document.createElement("span");
  handle.className = "iconify text-body-secondary";
  handle.dataset.icon = "tabler:grip-vertical";
  handle.setAttribute("data-sortable-handle", "");
  handle.setAttribute("aria-hidden", "true");
  handle.style.cursor = "grab";
  headerRow.appendChild(handle);

  const typeOptions = [
    { value: "", label: "Select a widget…" },
    ...Object.entries(MACRO_ACTION_TYPES).map(([value, def]) => ({ value, label: def.label })),
  ];
  const typeSelect = macroSelect(typeOptions, action.type || "", (value) => {
    const firstAction = Object.keys(macroActionsFor(value))[0] || "";
    updateMacroAction(index, { type: value, action: firstAction, target: "", params: {} });
  });
  typeSelect.classList.add("flex-grow-1");
  headerRow.appendChild(typeSelect);

  if (action.type) {
    const actionOptions = Object.entries(macroActionsFor(action.type)).map(([value, def]) => ({
      value,
      label: def.label || value,
    }));
    const actionSelect = macroSelect(actionOptions, action.action || "", (value) => {
      updateMacroAction(index, { action: value, params: {} });
    });
    actionSelect.classList.add("flex-grow-1");
    headerRow.appendChild(actionSelect);
  }

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "btn btn-outline-danger btn-sm p-1";
  removeButton.setAttribute("aria-label", "Remove action");
  removeButton.setAttribute("data-bs-toggle", "tooltip");
  removeButton.setAttribute("data-bs-title", "Remove action");
  removeButton.innerHTML = `<span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>`;
  removeButton.addEventListener("click", () => removeMacroAction(index));
  headerRow.appendChild(removeButton);

  row.appendChild(headerRow);

  const typeDef = MACRO_ACTION_TYPES[action.type];
  if (typeDef?.target) {
    const targetField = renderMacroTargetField(typeDef.target, action, (value) => updateMacroAction(index, { target: value }));
    if (targetField) row.appendChild(targetField);
  }

  if (action.type && action.action) {
    const fields = macroActionsFor(action.type)[action.action]?.params || [];
    if (fields.length) {
      const fieldsWrap = document.createElement("div");
      fieldsWrap.className = "d-flex flex-column gap-2";
      fields.forEach((fieldName) => {
        const fieldEl = renderMacroParamField(fieldName, action, (nextParams) =>
          updateMacroAction(index, { params: nextParams })
        );
        if (fieldEl) fieldsWrap.appendChild(fieldEl);
      });
      row.appendChild(fieldsWrap);
    }
  }

  return row;
}

let macroActionsSortable = null;

function renderMacroActionsEditor() {
  if (!macroActionsList) return;
  // Disposed before the wipe — each action row's Remove button carries a
  // real tooltip, and this reruns on every add/remove/reorder (tooltips.js's
  // BUG CLASS 2).
  disposeTooltips(macroActionsList);
  macroActionsList.innerHTML = "";
  if (!macroEditorActions.length) {
    const empty = document.createElement("p");
    empty.className = "small text-body-secondary mb-0";
    empty.textContent = "No actions yet — add one below.";
    macroActionsList.appendChild(empty);
  } else {
    macroEditorActions.forEach((action, index) => {
      macroActionsList.appendChild(renderMacroActionRow(action || {}, index));
    });
  }
  if (macroActionsSortable) {
    macroActionsSortable.destroy();
    macroActionsSortable = null;
  }
  if (macroEditorActions.length > 1) {
    macroActionsSortable = createSortable(macroActionsList, {
      onEnd(event) {
        if (event.oldIndex === event.newIndex) return;
        reorderMacroActions(event.oldIndex, event.newIndex);
      },
    });
  }
  refreshTooltips(macroActionsList);
}

function currentMacroPayload() {
  return {
    id: (macroIdInput?.value || "").trim(),
    name: (macroNameInput?.value || "").trim(),
    icon: (macroIconInput?.value || "").trim(),
    actions: macroEditorActions,
  };
}

function createMacroSnapshot() {
  return JSON.parse(JSON.stringify(currentMacroPayload()));
}

function applyMacroSnapshot(snapshot) {
  if (!snapshot) return;
  if (macroIdInput) macroIdInput.value = snapshot.id || "";
  if (macroNameInput) macroNameInput.value = snapshot.name || "";
  if (macroIconInput) macroIconInput.value = snapshot.icon || "";
  macroEditorActions = Array.isArray(snapshot.actions) ? snapshot.actions : [];
  renderMacroActionsEditor();
}

// See newSystemEditor's own comment on `reveal` — same reasoning here.
function newMacroEditor({ reveal = true } = {}) {
  // Same "typeable only before the first save" id rule as Systems — once a
  // macro exists, its id is how a shared record stays stable.
  if (macroIdInput) {
    macroIdInput.value = "";
    macroIdInput.disabled = false;
  }
  if (macroNameInput) macroNameInput.value = "";
  if (macroIconInput) macroIconInput.value = "";
  macroEditorActions = [];
  renderMacroActionsEditor();
  if (reveal) setMacroFormVisible(true);
  markClean("macro");
}

async function loadMacroIntoEditor(id) {
  if (!dataManager) return;
  try {
    // preferLocal: false — same reasoning as loadSystemIntoEditor: a stale
    // local cache winning here would mean a resave reverts whatever's
    // actually on the server.
    const result = await dataManager.get("macro", id, { preferLocal: false });
    setMacroFormVisible(true);
    const payload = result.payload || {};
    if (macroIdInput) {
      macroIdInput.value = payload.id || id;
      macroIdInput.disabled = true;
    }
    if (macroNameInput) macroNameInput.value = payload.name || "";
    if (macroIconInput) macroIconInput.value = payload.icon || "";
    macroEditorActions = Array.isArray(payload.actions) ? payload.actions : [];
    renderMacroActionsEditor();
    await refreshLibraryEntryCatalog("macro");
    markClean("macro");
  } catch (error) {
    status?.show(`Unable to load macro: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

async function populateMacroSelect() {
  if (!macroRecordSelect || !dataManager) return;
  const current = macroRecordSelect.value;
  let entries = [];
  try {
    // The select's options only need id + display name — the macro body
    // loads separately once one is picked, so this list doesn't need every
    // macro's full body just to populate a dropdown.
    entries = await fetchKindEntrySummaries(dataManager, "macro");
  } catch (error) {
    status?.show(`Unable to list macros: ${error.message}`, { type: "error", timeout: 4000 });
  }
  macroRecordSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = entries.length ? "New macro…" : "No macros saved yet";
  macroRecordSelect.appendChild(blank);
  entries
    .slice()
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    .forEach(({ id, name }) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = name || id;
      macroRecordSelect.appendChild(option);
    });
  if (Array.from(macroRecordSelect.options).some((option) => option.value === current)) {
    macroRecordSelect.value = current;
  }
}

if (macroRecordSelect) {
  macroRecordSelect.addEventListener("change", () => {
    if (!macroRecordSelect.value) {
      newMacroEditor();
      return;
    }
    void loadMacroIntoEditor(macroRecordSelect.value);
  });
}

if (macroNewButton) {
  macroNewButton.addEventListener("click", () => {
    recordUndoableChange("macro", () => {
      if (macroRecordSelect) macroRecordSelect.value = "";
      newMacroEditor();
    });
  });
}

// Same "-copy"/"-copyN" suffix convention generateDuplicateSystemId uses.
function generateDuplicateMacroId(baseId) {
  const raw = (baseId || "").trim();
  const root = raw.replace(/(-copy\d*)$/i, "") || raw || "macro";
  const existingIds = new Set(
    Array.from(macroRecordSelect?.options || []).map((option) => option.value).filter(Boolean)
  );
  let candidate = `${root}-copy`;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${root}-copy${counter}`;
    counter += 1;
  }
  return candidate;
}

if (macroDuplicateButton) {
  macroDuplicateButton.addEventListener("click", () => {
    const sourceId = (macroIdInput?.value || "").trim();
    if (!sourceId) return;
    recordUndoableChange("macro", () => {
      const suggestedId = generateDuplicateMacroId(sourceId);
      if (macroIdInput) {
        macroIdInput.value = suggestedId;
        macroIdInput.disabled = false;
      }
      if (macroNameInput) {
        const baseName = (macroNameInput.value || "").trim() || sourceId;
        macroNameInput.value = `${baseName} Copy`;
      }
    });
    if (macroRecordSelect) macroRecordSelect.value = "";
    status?.show(`Duplicated "${sourceId}" — review the new Id/Name, then Save.`, { type: "info", timeout: 3000 });
  });
}

if (macroAddActionButton) {
  macroAddActionButton.addEventListener("click", () => {
    recordUndoableChange("macro", () => {
      macroEditorActions.push({ type: "", action: "", target: "", params: {} });
      renderMacroActionsEditor();
    });
  });
}

wireUndoTracking(macroIdInput, "macro");
wireUndoTracking(macroNameInput, "macro");
wireUndoTracking(macroIconInput, "macro");

if (macroSaveButton) {
  macroSaveButton.addEventListener("click", async () => {
    if (!dataManager) return;
    const id = (macroIdInput?.value || "").trim();
    if (!id) {
      status?.show("Macro id is required.", { type: "error", timeout: 3000 });
      return;
    }
    const payload = {
      name: (macroNameInput?.value || "").trim() || id,
      icon: (macroIconInput?.value || "").trim() || "tabler:bolt",
      actions: macroEditorActions,
    };
    try {
      // A macro's own id is filename/library_items metadata, never body
      // content — loadMacroIntoEditor falls back to the known id when a
      // loaded payload doesn't carry one.
      await dataManager.save("macro", id, payload);
      status?.show(`Saved macro ${id}.`, { type: "success", timeout: 2000 });
      if (macroIdInput) macroIdInput.disabled = true;
      await populateMacroSelect();
      macroRecordSelect.value = id;
      markClean("macro");
    } catch (error) {
      status?.show(`Unable to save macro: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

if (macroDeleteButton) {
  macroDeleteButton.addEventListener("click", async () => {
    if (!dataManager) return;
    const id = (macroIdInput?.value || "").trim() || macroRecordSelect?.value;
    if (!id) {
      status?.show("Select a macro to delete first.", { type: "warning", timeout: 2500 });
      return;
    }
    if (!confirmDelete({ label: `macro "${id}"` })) return;
    try {
      await dataManager.delete("macro", id);
      status?.show(`Deleted macro ${id}.`, { type: "success", timeout: 2000 });
    } catch (error) {
      dataManager.removeLocal("macro", id);
      status?.show(`Removed ${id} locally (server delete failed: ${error.message}).`, { type: "warning", timeout: 4000 });
    }
    newMacroEditor();
    if (macroRecordSelect) macroRecordSelect.value = "";
    await populateMacroSelect();
  });
}

function currentLibraryEntity() {
  try {
    return JSON.parse(libraryJsonTextarea?.value || "{}");
  } catch (error) {
    return null;
  }
}

function createLibrarySnapshot() {
  return {
    kind: loomLibraryTableState.activeKind || "",
    id: libraryIdInput?.value || "",
    json: libraryJsonTextarea?.value || "",
  };
}

function applyLibrarySnapshot(snapshot) {
  if (!snapshot) return;
  loomLibraryTableState.activeKind = snapshot.kind || "";
  if (libraryIdInput) libraryIdInput.value = snapshot.id;
  if (libraryJsonTextarea) libraryJsonTextarea.value = snapshot.json;
  const key = snapshot.kind && snapshot.id ? `${snapshot.kind}:${snapshot.id}` : "";
  loomLibraryTableState.selectedKey = loomFindLibraryItem(key) ? key : "";
  if (loomLibraryTableSelect) loomLibraryTableSelect.value = loomLibraryTableState.selectedKey;
  loomRenderLibraryInspector();
  populateLibrarySystemCheckboxes(currentLibraryEntity()?.systemIds);
  populateLibrarySettingCheckboxes(currentLibraryEntity()?.settingIds);
  populateLibraryTemplateSelect(currentLibraryEntity());
}

// See newSystemEditor's own comment on `reveal` — same reasoning here.
function newLibraryEntry({ reveal = true } = {}) {
  // Only a not-yet-saved entity gets a typeable Id — once it exists, the id
  // is how everything else refers to it, so changing it later would
  // silently break those references.
  if (libraryIdInput) {
    libraryIdInput.value = "";
    libraryIdInput.disabled = false;
  }
  if (libraryJsonTextarea) libraryJsonTextarea.value = "{}";
  populateLibrarySystemCheckboxes([]);
  populateLibrarySettingCheckboxes([]);
  populateLibraryTemplateSelect({});
  libraryContentNudge?.classList.add("d-none");
  if (reveal) setLibraryFormVisible(true);
  markClean("library");
}

// A lightweight nudge, never a gate — shown only when the loaded record
// looks player-facing (a Feature tagged "character") but has no `grants`
// authored, so the Character Builder engine (Workbench's Level Up/Add a
// Class/Build wizard) has nothing to offer for it. Computed fresh on every
// load, never persisted; doesn't guess whether a Feature SHOULD have
// grants (most legitimately don't) — just surfaces the fact plainly.
function updateLibraryContentNudge(kind, entity) {
  if (!libraryContentNudge) return;
  const isCharacterFeature =
    kind === "feature" && Array.isArray(entity?.tags?.categories) && entity.tags.categories.includes("character");
  const hasGrants = Array.isArray(entity?.grants) && entity.grants.length > 0;
  const show = isCharacterFeature && !hasGrants;
  libraryContentNudge.classList.toggle("d-none", !show);
  if (show) {
    libraryContentNudge.textContent =
      "This feature has no structured Character Builder data (grants) configured yet — the player will need to apply it manually.";
  }
}

async function loadLibraryEntry(kind, id) {
  try {
    // preferLocal: false — Loom is the authoritative editor for Library
    // content, and every load here feeds a load-then-save round trip. A
    // stale local cache entry silently winning would mean a resave reverts
    // whatever's actually on the server, with no visible sign anything was
    // wrong. Read-only display lookups elsewhere (e.g.
    // populateLibraryFieldDatalist) don't carry this risk since nothing writes
    // back from them.
    const entity = (await dataManager?.get(kind, id, { preferLocal: false }))?.payload;
    if (!entity) throw new Error("Not found");
    setLibraryFormVisible(true);
    updateLibraryContentNudge(kind, entity);
    if (libraryIdInput) {
      libraryIdInput.value = id;
      libraryIdInput.disabled = true;
    }
    if (libraryJsonTextarea) libraryJsonTextarea.value = JSON.stringify(entity, null, 2);
    await populateLibrarySystemCheckboxes(entity.systemIds);
    await populateLibrarySettingCheckboxes(entity.settingIds);
    await populateLibraryTemplateSelect(entity);
    await refreshLibraryEntryCatalog(kind);
    markClean("library");
  } catch (error) {
    // A 404 means the library_items row has no backing file — an orphan.
    // There's no content to lose, so clean it up automatically instead of
    // leaving a dead entry the user can never remove: the id field never
    // got set above, so canDeleteLibrary() had nothing to act on and the
    // Delete button stayed disabled.
    if (error?.status === 404) {
      try {
        await deleteLibraryEntry(kind, id);
        status?.show(`${kind}/${id} had no matching file — removed the orphaned entry.`, {
          type: "warning",
          timeout: 4000,
        });
        loomLibraryTableState.selectedKey = "";
        if (loomLibraryTableSelect) loomLibraryTableSelect.value = "";
        newLibraryEntry();
        await loomLoadLibraryTable({ refresh: true });
        loadRecentSaves();
      } catch (cleanupError) {
        status?.show(`Unable to clean up ${kind}/${id}: ${cleanupError.message}`, { type: "error", timeout: 4000 });
      }
      return;
    }
    // Any other failure (auth, network, ...) still isn't a reason to leave
    // stale id/state — set the id so a manual Delete at least has the right
    // target, same as the success path. Reveals the panel too, since the
    // Delete button lives inside it.
    setLibraryFormVisible(true);
    updateLibraryContentNudge(kind, null);
    if (libraryIdInput) {
      libraryIdInput.value = id;
      libraryIdInput.disabled = true;
    }
    updateToolbarState();
    status?.show(`Unable to load ${kind}/${id}: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

// Called by both the Type and Item select's "change" listeners — whichever
// changed, this loads whatever is now selected into the editor, or resets
// to a blank "new entity of this Type" state if nothing is selected.
function loomLoadPickedLibraryEntry() {
  const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
  if (item) {
    loomLibraryTableState.activeKind = item.bucket;
    loadLibraryEntry(item.bucket, item.id);
  } else {
    loomLibraryTableState.activeKind = loomLibraryTableState.selectedType || "";
    newLibraryEntry();
  }
}

if (libraryNewButton) {
  libraryNewButton.addEventListener("click", () => {
    const kind = loomLibraryTableState.selectedType || "";
    if (!kind) {
      status?.show("Select a Type in the left pane first.", { type: "warning", timeout: 2500 });
      return;
    }
    recordUndoableChange("library", () => {
      loomLibraryTableState.selectedKey = "";
      if (loomLibraryTableSelect) loomLibraryTableSelect.value = "";
      loomRenderLibraryInspector();
      loomLibraryTableState.activeKind = kind;
      newLibraryEntry();
    });
  });
}

// Same "-copy"/"-copyN" suffix convention generateDuplicateSystemId uses,
// scoped to this kind (a Library id only needs to be unique within its own
// bucket, not suite-wide).
function generateDuplicateLibraryId(kind, baseId) {
  const raw = (baseId || "").trim();
  const root = raw.replace(/(-copy\d*)$/i, "") || raw || kind || "entity";
  const existingIds = new Set(
    loomLibraryTableState.items.filter((item) => item.bucket === kind).map((item) => item.id).filter(Boolean)
  );
  let candidate = `${root}-copy`;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${root}-copy${counter}`;
    counter += 1;
  }
  return candidate;
}

// Clones the currently loaded entity's JSON in place — id and `name` (when
// present) get a fresh id/" Copy" suffix, every other field stays as shown.
// Same "in-DOM, review then Save" flow as systemDuplicateButton's handler.
if (libraryDuplicateButton) {
  libraryDuplicateButton.addEventListener("click", () => {
    const kind = loomLibraryTableState.activeKind;
    const sourceId = (libraryIdInput?.value || "").trim();
    const entity = currentLibraryEntity();
    if (!kind || !sourceId || !entity) return;
    const suggestedId = generateDuplicateLibraryId(kind, sourceId);
    recordUndoableChange("library", () => {
      if (libraryIdInput) {
        libraryIdInput.value = suggestedId;
        libraryIdInput.disabled = false;
      }
      const duplicate = { ...entity, id: suggestedId };
      if (typeof duplicate.name === "string") duplicate.name = `${duplicate.name || sourceId} Copy`;
      libraryJsonTextarea.value = JSON.stringify(duplicate, null, 2);
    });
    loomLibraryTableState.selectedKey = "";
    if (loomLibraryTableSelect) loomLibraryTableSelect.value = "";
    status?.show(`Duplicated "${sourceId}" — review the new Id/Name, then Save.`, { type: "info", timeout: 3000 });
  });
}

// Toggling a System checkbox writes straight back into the JSON textarea
// (not merged on save) so the textarea stays the single source of truth.
if (librarySystemList) {
  librarySystemList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-library-system-checkbox]");
    if (!checkbox) return;
    recordUndoableChange("library", () => {
      const entity = currentLibraryEntity();
      if (!entity) return;
      const ids = new Set(Array.isArray(entity.systemIds) ? entity.systemIds : []);
      if (checkbox.checked) ids.add(checkbox.value);
      else ids.delete(checkbox.value);
      entity.systemIds = Array.from(ids);
      libraryJsonTextarea.value = JSON.stringify(entity, null, 2);
      populateLibraryTemplateSelect(entity);
    });
  });
}

// Byte-for-byte parallel to the Assigned Systems handler above.
if (librarySettingList) {
  librarySettingList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-library-setting-checkbox]");
    if (!checkbox) return;
    recordUndoableChange("library", () => {
      const entity = currentLibraryEntity();
      if (!entity) return;
      const ids = new Set(Array.isArray(entity.settingIds) ? entity.settingIds : []);
      if (checkbox.checked) ids.add(checkbox.value);
      else ids.delete(checkbox.value);
      entity.settingIds = Array.from(ids);
      libraryJsonTextarea.value = JSON.stringify(entity, null, 2);
    });
  });
}

wireUndoTracking(libraryIdInput, "library");
wireUndoTracking(libraryJsonTextarea, "library");

// After saving an entity, opportunistically link it into any of its
// Assigned Systems' matching Properties (any array field whose values use
// `libraryKind` matching this entity's kind, with a values entry whose name
// matches and no `libraryField` yet). Keeps a System's roster pointing at
// real data without requiring every link by hand — only when the match is
// unambiguous (exactly one candidate); anything else is left for manual
// linking. Walks every array field uniformly (no more field-level
// `entityKind` gate) since `libraryKind` is a per-VALUE property now.
function findLibraryKindValues(fields, kind, matches = []) {
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    if (field?.type === "array" && Array.isArray(field.values)) {
      field.values.forEach((value) => {
        if (value && typeof value === "object" && value.libraryKind === kind) matches.push(value);
      });
    }
    if (Array.isArray(field?.children)) findLibraryKindValues(field.children, kind, matches);
    if (Array.isArray(field?.item?.children)) findLibraryKindValues(field.item.children, kind, matches);
  });
  return matches;
}

async function autoLinkEntityToSystems(kind, id, entity) {
  const systemIds = Array.isArray(entity?.systemIds) ? entity.systemIds : [];
  const entityName = (entity?.name || id || "").trim().toLowerCase();
  if (!systemIds.length || !entityName || !dataManager) return;
  for (const systemId of systemIds) {
    let payload;
    try {
      const result = await dataManager.get("systems", systemId);
      payload = result?.payload;
    } catch (error) {
      continue;
    }
    if (!payload || !Array.isArray(payload.fields)) continue;
    let matchCount = 0;
    let matchedEntry = null;
    findLibraryKindValues(payload.fields, kind).forEach((entry) => {
      if (!entry.libraryField && (entry.name || "").trim().toLowerCase() === entityName) {
        matchCount += 1;
        matchedEntry = entry;
      }
    });
    if (matchCount === 1 && matchedEntry) {
      matchedEntry.libraryField = id;
      try {
        await dataManager.save("systems", systemId, payload);
        status?.show(`Linked ${entity.name || id} to ${payload.title || systemId}.`, {
          type: "success",
          timeout: 2500,
        });
      } catch (error) {
        // Non-fatal — the entity itself already saved successfully.
      }
    }
  }
}

if (librarySaveButton) {
  librarySaveButton.addEventListener("click", async () => {
    const kind = loomLibraryTableState.activeKind;
    const id = (libraryIdInput?.value || "").trim();
    if (!kind) {
      status?.show("Select a Type in the left pane first.", { type: "warning", timeout: 2500 });
      return;
    }
    if (!id) {
      status?.show("Enter an id to save as.", { type: "warning", timeout: 2000 });
      return;
    }
    const entity = currentLibraryEntity();
    if (!entity) {
      status?.show("Entity JSON isn't valid — fix it before saving.", { type: "error", timeout: 3000 });
      return;
    }
    // Every character or monster needs at least one Assigned System —
    // downstream consumers (combat bindings, Feature-matching's
    // System-scoped candidate pool, Assigned-Systems-driven UI everywhere)
    // depend on it. The Systems checkbox list above writes straight into
    // this same JSON textarea, so this only fires if the GM saves a
    // brand-new record without checking any of them — newLibraryEntry()
    // starts every kind blank, unlike saveEntity's import-time defaults
    // (Mapping tool, above).
    if (
      (kind === "character" || kind === "monster") &&
      (!Array.isArray(entity.systemIds) || !entity.systemIds.length)
    ) {
      status?.show(`Check at least one Assigned System before saving a ${kind}.`, { type: "warning", timeout: 3000 });
      return;
    }
    try {
      if (!dataManager) throw new Error("Not signed in");
      await dataManager.save(kind, id, entity);
      status?.show(`Saved ${kind}/${id}.json.`, { type: "success", timeout: 2000 });
      await autoLinkEntityToSystems(kind, id, entity);
      await refreshLibraryEntryCatalog(kind);
      loomLibraryTableState.selectedType = kind;
      if (loomLibraryTableTypeSelect) loomLibraryTableTypeSelect.value = kind;
      loomLibraryTableState.selectedKey = `${kind}:${id}`;
      await loomLoadLibraryTable({ refresh: true });
      loadRecentSaves();
      markClean("library");
    } catch (error) {
      status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

async function deleteLibraryEntry(kind, id) {
  if (!dataManager) throw new Error("Not signed in");
  await dataManager.delete(kind, id);
}

if (libraryDeleteButton) {
  libraryDeleteButton.addEventListener("click", async () => {
    const kind = loomLibraryTableState.activeKind;
    const id = (libraryIdInput?.value || "").trim();
    if (!kind || !id) {
      status?.show("Select an entity to delete first.", { type: "warning", timeout: 2500 });
      return;
    }
    if (!confirmDelete({ label: `${kind}/${id}` })) return;
    try {
      await deleteLibraryEntry(kind, id);
      status?.show(`Deleted ${kind}/${id}.json.`, { type: "success", timeout: 2000 });
      loomLibraryTableState.selectedKey = "";
      if (loomLibraryTableSelect) loomLibraryTableSelect.value = "";
      newLibraryEntry();
      await loomLoadLibraryTable({ refresh: true });
      loadRecentSaves();
    } catch (error) {
      status?.show(`Unable to delete: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// --- Systems: Properties list-editor + System CRUD --------------------------
// No canvas/drag-drop — a System is just a list of Properties (form rows)
// plus whichever Library entities are assigned to it. Storage is unchanged
// from Workbench's own System Editor: the same DataManager "systems"
// bucket, same tier gating, same sharing.

// Object properties get a recursive "Sub-fields" list; Array properties are
// either Enum mode (a flat, System-defined list of fixed choices, same for
// every record — Rarity, Combat Bindings) or Records mode (a per-record
// repeating structure whose *shape*, not values, the System defines —
// Inventory > Name/Quantity/Weight/Notes). Both reuse this same row
// renderer for their children, so the tree can nest arbitrarily deep even
// though nothing today needs more than one level.
//
// Combat Bindings isn't a field type of its own — it's just whichever
// ordinary Enum-mode array field's values use the Binding column (see
// bindings.js's findRoleBoundField), so combat-tracker.js and Workbench's
// character view can find it without a fixed key name. Binding/RecordField/
// SourceField describe generic behavior — a resource with a ceiling, a
// standalone value, a tag list, a roll modifier — useful on any array's
// values, not only combat state. `recordField` is a plain dotted path
// (dotted-path.js's resolveDottedPath/setAtDottedPath) into a character
// record — no `@` prefix, the column itself already fixes what kind of
// thing the value holds. `sourceField` is a pointer at another field's key
// on this same System whose values are the valid options (e.g. a
// Tags-binding value pointing at a Conditions field). A binding needing
// more than one path (Resource's max/temp) or other field-specific metadata
// (Modifier's die) doesn't get a dedicated column — it's authored in that
// value's "Extra properties" JSON catch-all instead, same as any property
// specific to just one field (combatScaling's hitPoints/armorClass/...).
//
// Per-value columns are worth a dedicated input only when the same property
// name recurs across several System fields (cost:
// rarity+activation+form+combatScaling; sourceId: conditions+alignments+
// sizes+senses+speeds+components+skills+activation; shortName: alignments;
// libraryField: classes) — a bespoke checkbox for one field's own stat block
// doesn't generalize and would clutter every other array field's options row.
//
// The shared row editor (property-schema-editor.js) is undo/dirty-tracking-
// agnostic — this `ctx` plugs it into Loom's own whole-tab undo stack for
// Systems specifically. Getters (not plain properties) for
// status/dataManager/filterSystemId since those bindings are only assigned
// later during init — a plain property captured at module-eval time would
// freeze in at `null`.
const systemPropertyCtx = {
  runChange: (fn) => recordUndoableChange("system", fn),
  refreshTooltips,
  initHelpSystem,
  get status() {
    return status;
  },
  get dataManager() {
    return dataManager;
  },
  get filterSystemId() {
    return (systemIdInput?.value || "").trim();
  },
  // The `binding` column's <select> options depend on which reserved key a
  // field actually is — fieldRoles/derivedFormulas/levelUpBindings are their
  // own literal key, but combatBindings has no fixed key of its own: it's
  // whichever field a fieldRoles entry points at (binding "combatBindings").
  // Resolving that needs this System's OTHER rows' live, not-yet-saved state
  // — queried off the DOM rather than cached, so a fieldRoles edit made
  // elsewhere in the same editing session takes effect without a reload.
  resolveFieldBindingKey: (field) => {
    if (["fieldRoles", "derivedFormulas", "levelUpBindings"].includes(field?.key)) return field.key;
    const rows = [...Array.from(systemReservedPropertyRows?.children || []), ...Array.from(systemPropertyRows.children)];
    const fieldRolesRow = rows.find((row) => row.querySelector("[data-property-key]")?.value.trim() === "fieldRoles");
    // Reads the row's own STORED field (renderPropertyRow's row._originalField),
    // not a live DOM collect — a live collect would race combatBindings'
    // value rows resolving their own Binding <select> against fieldRoles'
    // OWN Binding <select> options, which populate asynchronously and may
    // not have landed yet at this point in the same render pass. This only
    // needs to be right at render/reload time, not reactive to an unsaved
    // in-session fieldRoles edit.
    const originalValues = fieldRolesRow?._originalField?.values;
    const match = Array.isArray(originalValues)
      ? originalValues.find((entry) => entry?.binding === "combatBindings" && entry?.sourceField === field?.key)
      : null;
    return match ? "combatBindings" : null;
  },
  captureDragSnapshot: () =>
    !isApplyingHistory && undoStack && SNAPSHOT_HANDLERS.system ? SNAPSHOT_HANDLERS.system.create() : null,
  commitDragSnapshot: (before) => {
    const handler = SNAPSHOT_HANDLERS.system;
    if (before && handler) {
      const after = handler.create();
      if (!snapshotsEqual(before, after)) {
        undoStack.push({ type: "system", before, after });
      }
    }
    updateToolbarState();
  },
  // Property Inspector integration (systemPropertyInspector below) — a
  // caller with no such panel omits these three and nothing fires.
  // Referencing systemPropertyInspector here before its own declaration is
  // safe: these arrow functions only run later, from an event, by which
  // point the module has finished evaluating.
  onRowSelected: (row) => systemPropertyInspector.selectRow(row),
  onRowChanged: (row) => {
    if (row === systemPropertyInspector.selectedRow) systemPropertyInspector.refresh();
  },
  onRowRemoved: (row) => {
    if (row === systemPropertyInspector.selectedRow) systemPropertyInspector.selectRow(null);
  },
};

// Thin, name-preserving wrappers around the shared editor, bound to
// systemPropertyCtx and defaulting to this tab's own top-level container —
// every pre-existing call site keeps working unchanged.
function renderSystemPropertyRow(field = {}, container = systemPropertyRows) {
  return renderPropertyRow(field, container, systemPropertyCtx);
}
function initSystemPropertySortable(container) {
  return initPropertySortable(container, systemPropertyCtx);
}
function applySystemPropertyType(row, typeButton, value) {
  return applyPropertyType(row, typeButton, value, systemPropertyCtx);
}

// Renders one top-level field into whichever group its CURRENT key belongs
// in — used only for the "load/rebuild the whole list from data" paths
// (loadSystemIntoEditor, applySystemSnapshot); the "New Property" button
// always targets the ordinary group directly (a brand new field starts
// with a blank key, which is never reserved).
function renderSystemFieldIntoGroups(field) {
  const container = isReservedKeyName(field?.key) ? systemReservedPropertyRows : systemPropertyRows;
  return renderSystemPropertyRow(field, container);
}

// Reserved keys first, regardless of their order in the stored `fields`
// array — combatBindings' own row (an ordinary field, discovered only
// indirectly via a fieldRoles entry) needs fieldRoles' row already rendered
// (row._originalField set — see systemPropertyCtx.resolveFieldBindingKey)
// by the time it resolves its own Binding <select> options. Fields aren't
// reordered on screen (reserved ones already render into their own
// container, see renderSystemFieldIntoGroups above) — this only changes
// which one renders first internally.
function renderSystemFieldsIntoGroups(fields) {
  const list = Array.isArray(fields) ? fields : [];
  list.filter((field) => isReservedKeyName(field?.key)).forEach(renderSystemFieldIntoGroups);
  list.filter((field) => !isReservedKeyName(field?.key)).forEach(renderSystemFieldIntoGroups);
}

// Reserved section is shown only "when they exist" (never an empty box) —
// called after every render/add/remove/rename that could change whether
// either group is populated.
function updateReservedPropertiesVisibility() {
  if (!systemReservedPropertiesSection) return;
  const hasReserved = Boolean(systemReservedPropertyRows?.children.length);
  systemReservedPropertiesSection.classList.toggle("d-none", !hasReserved);
}

// A top-level row's own Key input can change at any time (typed by hand, or
// via the reserved-key datalist) — this keeps its group in sync live,
// rather than only reclassifying on next load. Delegated once on the
// shared wrapper so it covers rows in either group without two listeners.
systemPropertiesWrapper?.addEventListener("input", (event) => {
  const keyInput = event.target.closest("[data-property-key]");
  if (!keyInput) return;
  const row = keyInput.closest(".border.rounded-3");
  const parent = row?.parentElement;
  // Only a TOP-LEVEL row's key decides its group — a nested Sub-field's own
  // Key input bubbles here too, but its closest top-level ancestor row (not
  // itself) is what actually sits in systemReservedPropertyRows/
  // systemPropertyRows, so a nested row is never itself relocated.
  if (parent !== systemReservedPropertyRows && parent !== systemPropertyRows) return;
  const targetContainer = isReservedKeyName(keyInput.value.trim()) ? systemReservedPropertyRows : systemPropertyRows;
  if (parent !== targetContainer) {
    targetContainer?.appendChild(row);
    updateReservedPropertiesVisibility();
  }
});
function collectSystemProperties() {
  // Reserved keys first, matching how they're always shown first — a
  // System's own saved `fields` order now mirrors the editor's grouping.
  return [
    ...collectProperties(systemReservedPropertyRows, systemPropertyCtx),
    ...collectProperties(systemPropertyRows, systemPropertyCtx),
  ];
}

// The one place that assembles a full System record from the editor's
// current form state — used by both Save and the live JSON Preview panel,
// so Preview is guaranteed to show exactly what Save writes.
function buildSystemPayload() {
  const id = (systemIdInput?.value || "").trim();
  return {
    id,
    title: (systemTitleInput?.value || "").trim() || id,
    version: (systemVersionInput?.value || "").trim() || "0.1",
    fields: collectSystemProperties(),
  };
}

// Read-only "the whole record as it'll be saved" view. Hooked into
// updateToolbarState (below) rather than a separate call site per edit —
// every System edit already runs through there (structural changes via
// recordUndoableChange, free-typed fields via wireUndoTracking's live
// `input` listener), the same single choke point Save-button-enabling
// already relies on, so this updates live without needing its own wiring.
renderSystemJsonPreview = systemJsonPanelInstance.render;

// Existing ids come straight off the System <select>'s already-populated
// options — no separate catalog needed, unlike Workbench's Template
// duplicate (which tracks its own templateCatalog Map for other reasons).
function generateDuplicateSystemId(baseId) {
  const raw = (baseId || "").trim();
  const root = raw.replace(/(-copy\d*)$/i, "") || raw || "system";
  const existingIds = new Set(
    Array.from(systemSelect?.options || []).map((option) => option.value).filter(Boolean)
  );
  let candidate = `${root}-copy`;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${root}-copy${counter}`;
    counter += 1;
  }
  return candidate;
}

async function populateSystemSelect() {
  if (!systemSelect) return;
  const systems = await listAllSystems();
  const previous = systemSelect.value;
  systemSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = systems.length ? "Select a system…" : "No systems yet";
  systemSelect.appendChild(blank);
  systems.forEach((system) => {
    const option = document.createElement("option");
    option.value = system.id;
    option.textContent = `${system.title} (${system.id})`;
    systemSelect.appendChild(option);
  });
  if (systems.some((system) => system.id === previous)) systemSelect.value = previous;
}

function createSystemSnapshot() {
  return {
    id: systemIdInput?.value || "",
    title: systemTitleInput?.value || "",
    version: systemVersionInput?.value || "",
    properties: collectSystemProperties(),
  };
}

function applySystemSnapshot(snapshot) {
  if (!snapshot) return;
  if (systemIdInput) systemIdInput.value = snapshot.id;
  if (systemTitleInput) systemTitleInput.value = snapshot.title;
  if (systemVersionInput) systemVersionInput.value = snapshot.version;
  if (systemPropertyRows) {
    systemPropertyRows.innerHTML = "";
    if (systemReservedPropertyRows) systemReservedPropertyRows.innerHTML = "";
    renderSystemFieldsIntoGroups(snapshot.properties);
    updateReservedPropertiesVisibility();
  }
  // Undo/redo rebuilds every row from scratch — whatever was selected
  // before is now a detached DOM node, not a meaningful selection to keep.
  systemPropertyInspector.selectRow(null);
}

// --- Property Inspector (right pane) ---------------------------------------
// A more spacious editing surface for whichever property row is currently
// selected in the Properties list — the list itself is untouched, this is
// purely additive. Shared factory (property-schema-editor.js's
// createPropertyInspector) — Group's own Properties tab gets the exact same
// mechanism below, not a hand-duplicated second copy.

function isLoomViewActive(view) {
  return document.querySelector("[data-loom-view-tab].active")?.dataset.loomViewTab === view;
}

const systemPropertyInspector = createPropertyInspector({
  ctx: systemPropertyCtx,
  rowsContainer: systemPropertyRows,
  emptyEl: systemInspectorEmpty,
  detailsEl: systemInspectorDetails,
  fieldsEl: systemInspectorFields,
  newButton: systemInspectorNewButton,
  deleteButton: systemInspectorDeleteButton,
  duplicateButton: systemInspectorDuplicateButton,
  requiredButton: systemInspectorRequiredButton,
  isActive: () => isLoomViewActive("systems"),
});

const groupPropertyInspector = createPropertyInspector({
  ctx: groupPropertyCtx,
  rowsContainer: loomGroupPropertyRows,
  emptyEl: groupInspectorEmpty,
  detailsEl: groupInspectorDetails,
  fieldsEl: groupInspectorFields,
  newButton: groupInspectorNewButton,
  deleteButton: groupInspectorDeleteButton,
  duplicateButton: groupInspectorDuplicateButton,
  requiredButton: groupInspectorRequiredButton,
  isActive: () => isLoomViewActive("groups"),
});

// Group Properties had no right-pane panel before this — wired here rather
// than inline on the groupPropertyCtx object literal above since
// groupPropertyInspector doesn't exist yet at that point in the file.
groupPropertyCtx.onRowSelected = (row) => groupPropertyInspector.selectRow(row);
groupPropertyCtx.onRowChanged = (row) => {
  if (row === groupPropertyInspector.selectedRow) groupPropertyInspector.refresh();
};
groupPropertyCtx.onRowRemoved = (row) => {
  if (row === groupPropertyInspector.selectedRow) groupPropertyInspector.selectRow(null);
};
// Preserves Public across the Inspector's own Duplicate button — see
// collectGroupFieldFromRow's own comment.
groupPropertyCtx.collectField = collectGroupFieldFromRow;

// `reveal` defaults to true (New click, select reset to blank, Delete's own
// "stay in a fresh draft" flow — all should show the form) — the one
// caller that suppresses it is page-load init below, which primes this
// editor's state without showing anything yet, matching Groups/Users'
// default "nothing selected" state.
function newSystemEditor({ reveal = true } = {}) {
  resetSystemReservedChecks();
  // Only a not-yet-saved System gets a typeable Id — once it exists, the id
  // is how Library entities' Assigned Systems and Templates refer to it.
  if (systemIdInput) {
    systemIdInput.value = "";
    systemIdInput.disabled = false;
  }
  if (systemTitleInput) systemTitleInput.value = "";
  if (systemVersionInput) systemVersionInput.value = "0.1";
  if (systemPropertyRows) systemPropertyRows.innerHTML = "";
  if (systemReservedPropertyRows) systemReservedPropertyRows.innerHTML = "";
  updateReservedPropertiesVisibility();
  systemPropertyInspector.selectRow(null);
  if (reveal) setSystemFormVisible(true);
  markClean("system");
}

async function loadSystemIntoEditor(id) {
  if (!dataManager) return;
  resetSystemReservedChecks();
  try {
    // preferLocal: false — the editor a creator uses to fix a System's
    // data must never show a stale locally-cached copy instead of what's
    // on the server. Same reasoning as combat-tracker.js's System reads.
    const result = await dataManager.get("systems", id, { preferLocal: false });
    setSystemFormVisible(true);
    const payload = result.payload || {};
    if (systemIdInput) {
      systemIdInput.value = payload.id || id;
      systemIdInput.disabled = true;
    }
    if (systemTitleInput) systemTitleInput.value = payload.title || "";
    if (systemVersionInput) systemVersionInput.value = payload.version || "";
    if (systemPropertyRows) {
      systemPropertyRows.innerHTML = "";
      if (systemReservedPropertyRows) systemReservedPropertyRows.innerHTML = "";
      await loadReservedKeysSchema();
      renderSystemFieldsIntoGroups(payload.fields);
      updateReservedPropertiesVisibility();
    }
    systemPropertyInspector.selectRow(null);
    markClean("system");
  } catch (error) {
    status?.show(`Unable to load system: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

if (systemSelect) {
  systemSelect.addEventListener("change", () => {
    if (!systemSelect.value) {
      newSystemEditor();
      return;
    }
    loadSystemIntoEditor(systemSelect.value);
  });
}

if (systemNewButton) {
  systemNewButton.addEventListener("click", () => {
    recordUndoableChange("system", () => {
      if (systemSelect) systemSelect.value = "";
      newSystemEditor();
    });
  });
}

// Clones the CURRENTLY LOADED/edited System in place — every Property row
// stays exactly as shown, only id (must be unique) and title get a
// "-copy"/"(Copy)" suffix. Doesn't round-trip through
// buildSystemPayload/collectSystemProperties + re-render — the rows are
// already in the DOM, so this only touches Id/Title and re-enables Id for
// editing. Matches this editor's simpler, non-modal "New System" flow
// rather than Workbench Template's modal-based duplicate.
if (systemDuplicateButton) {
  systemDuplicateButton.addEventListener("click", () => {
    const sourceId = (systemIdInput?.value || "").trim();
    if (!sourceId) return;
    recordUndoableChange("system", () => {
      const suggestedId = generateDuplicateSystemId(sourceId);
      if (systemIdInput) {
        systemIdInput.value = suggestedId;
        systemIdInput.disabled = false;
      }
      if (systemTitleInput) {
        const baseTitle = (systemTitleInput.value || "").trim() || sourceId;
        systemTitleInput.value = `${baseTitle} (Copy)`;
      }
    });
    if (systemSelect) systemSelect.value = "";
    status?.show(`Duplicated "${sourceId}" — review the new Id/Title, then Save.`, { type: "info", timeout: 3000 });
  });
}

if (systemAddPropertyButton) {
  systemAddPropertyButton.addEventListener("click", () => {
    recordUndoableChange("system", () => renderSystemPropertyRow());
  });
}

wireUndoTracking(systemIdInput, "system");
wireUndoTracking(systemTitleInput, "system");
wireUndoTracking(systemVersionInput, "system");
wireUndoTracking(systemPropertyRows, "system", {
  selector: "input, select, textarea",
});
wireUndoTracking(systemReservedPropertyRows, "system", {
  selector: "input, select, textarea",
});
// One persistent instance — unlike nested Sub-fields/Record fields
// containers (created fresh per row), this top-level container is never
// recreated, only its children, so it only needs wiring once. Two
// instances, one per group — reordering never drags a row across groups
// (renaming its Key to/from a reserved name is what moves it; see the
// systemPropertiesWrapper "input" listener above).
initSystemPropertySortable(systemPropertyRows);
initSystemPropertySortable(systemReservedPropertyRows);

// Delegated add/remove-property/sub-field/record-field/value handling, plus
// Property Inspector selection/refresh via systemPropertyCtx's own
// onRowSelected/onRowChanged/onRowRemoved — the shared editor's own
// property-schema-editor.js implementation; every recordUndoableChange
// call routes through systemPropertyCtx.runChange.
wirePropertyContainerEvents(systemPropertyRows, systemPropertyCtx);
wirePropertyContainerEvents(systemReservedPropertyRows, systemPropertyCtx);

if (systemSaveButton) {
  systemSaveButton.addEventListener("click", async () => {
    if (!dataManager) return;
    const payload = buildSystemPayload();
    if (!payload.id) {
      status?.show("System id is required.", { type: "error", timeout: 3000 });
      return;
    }
    const unnamed = findUnnamedValueEntries(payload.fields);
    if (unnamed.length) {
      const plural = unnamed.length === 1 ? "entry has" : "entries have";
      const proceed = await showConfirmModal({
        title: "Save without names?",
        bodyHtml: `<p>${unnamed.length} value ${plural} no name. A name helps identify an entry later — save anyway?</p>`,
        confirmLabel: "Save anyway",
        cancelLabel: "Go back",
      });
      if (!proceed) return;
    }
    try {
      // A System's own id is filename/library_items metadata, never body
      // content — systemIdInput's value is only used as the SAVE target id
      // below, never persisted inside the body itself.
      const { id: _systemId, ...bodyWithoutId } = payload;
      await dataManager.save("systems", payload.id, bodyWithoutId);
      status?.show(`Saved system ${payload.id}.`, { type: "success", timeout: 2000 });
      await populateSystemSelect();
      systemSelect.value = payload.id;
      await populateLibrarySystemCheckboxes(currentLibraryEntity()?.systemIds);
      markClean("system");
      // Fire-and-forget — a wrong reserved-key shape is worth surfacing, but
      // never something that should hold up or block the save itself.
      void runSystemDiagnostics();
      void renderSystemBindingsChecklist();
    } catch (error) {
      status?.show(`Unable to save system: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

if (systemDeleteButton) {
  systemDeleteButton.addEventListener("click", async () => {
    if (!dataManager) return;
    const id = (systemIdInput?.value || "").trim() || systemSelect.value;
    if (!id) {
      status?.show("Select a system to delete first.", { type: "warning", timeout: 2500 });
      return;
    }
    if (!confirmDelete({ label: `system "${id}"` })) return;
    try {
      await dataManager.delete("systems", id);
      status?.show(`Deleted system ${id}.`, { type: "success", timeout: 2000 });
    } catch (error) {
      // Covers an orphaned local-only record, or a remote delete failing
      // (e.g. a DB row with no matching file) — either way, a "not found"
      // system otherwise has no way to leave the picker.
      dataManager.removeLocal("systems", id);
      status?.show(`Removed ${id} locally (server delete failed: ${error.message}).`, { type: "warning", timeout: 4000 });
    }
    newSystemEditor();
    systemSelect.value = "";
    await populateSystemSelect();
    await populateLibrarySystemCheckboxes(currentLibraryEntity()?.systemIds);
  });
}

// --- Mapping load/save -------------------------------------------------
// listAvailableMappings imported from content-fetch.js, shared with
// Workbench's player-facing Import Character picker (listCharacterMappings).

async function populateMappingSelect() {
  if (!mappingSelect) return;
  const names = await listAvailableMappings();
  mappingSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = names.length ? "Select a mapping…" : "No saved mappings yet";
  mappingSelect.appendChild(blank);
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === currentMappingId) option.selected = true;
    mappingSelect.appendChild(option);
  });
}

// Switching mappings changes the expected data shape entirely — a class
// fetch means nothing to a species mapping — so the raw input, source-fetch
// value, and (via rerenderAll -> runLivePreview) the mapped output and
// Entities pane all reset rather than reusing data from a different shape.
function resetRawData() {
  sampleData = {};
  if (sourceValueInput) sourceValueInput.value = "";
  if (sourceFileInput) sourceFileInput.value = "";
  if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
}

async function loadMapping(id) {
  const url = new URL(`../mappings/${id}.json`, import.meta.url);
  // no-store: mapping files get edited/saved iteratively (including outside
  // the browser), so a stale cached copy is worse than the extra round trip.
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  mappingDefinition = await response.json();
  currentMappingId = id;
  selectedNode = null;
  // Only mapping-type entries — the undo stack is shared across every tab,
  // so a plain clear() would also wipe Library/System history.
  undoStack?.removeWhere((entry) => entry.type === "mapping");
  resetRawData();
  enterMappingMode(mappingDefinition);
  markClean("mapping");
  rerenderAll();
}

if (mappingSelect) {
  mappingSelect.addEventListener("change", async () => {
    const id = mappingSelect.value;
    if (!id) return;
    try {
      await loadMapping(id);
    } catch (error) {
      status?.show(`Unable to load mapping: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

async function saveMapping(id) {
  const response = await fetch(`/loom/mappings/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definition: mappingDefinition }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
}

if (newButton) {
  newButton.addEventListener("click", () => {
    mappingDefinition = null;
    selectedNode = null;
    currentMappingId = null;
    undoStack?.removeWhere((entry) => entry.type === "mapping");
    if (mappingSelect) mappingSelect.value = "";
    resetRawData();
    enterMappingMode(null);
    markClean("mapping");
    rerenderAll();
  });
}

// Same dirty checks the Save buttons use — Loom had no guard against
// navigating/closing away from unsaved edits (unlike Workbench).
window.addEventListener("beforeunload", (event) => {
  if (!canSaveMapping() && !canSaveLibrary() && !canSaveSystem()) return;
  event.preventDefault();
  event.returnValue = "";
});

if (saveButton) {
  saveButton.addEventListener("click", async () => {
    if (!mappingDefinition) {
      status?.show("Nothing to save yet.", { type: "warning", timeout: 2000 });
      return;
    }
    // Unconditional — Data Source is never disabled/locked, so whatever's
    // currently selected always wins on save, same as Data Type below.
    if (sourceSelect) {
      mappingDefinition.$source = sourceSelect.value;
    }
    if (dataTypeSelect) {
      mappingDefinition.$dataType = dataTypeSelect.value;
    }
    if (mappingDescriptionInput) {
      mappingDefinition.$description = mappingDescriptionInput.value.trim();
    }
    let id = currentMappingId;
    if (!id) {
      id = promptKey("Save as (mapping id):");
      if (!id) return;
    }
    try {
      await saveMapping(id);
      currentMappingId = id;
      status?.show(`Saved ${id}.json.`, { type: "success", timeout: 2000 });
      await populateMappingSelect();
      enterMappingMode(mappingDefinition);
      markClean("mapping");
    } catch (error) {
      status?.show(`Unable to save mapping: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

if (renameButton) {
  renameButton.addEventListener("click", async () => {
    if (!currentMappingId) {
      status?.show("Save this mapping first, then you can rename it.", { type: "warning", timeout: 2500 });
      return;
    }
    const newId = promptKey(`Rename "${currentMappingId}" to:`);
    if (!newId || newId === currentMappingId) return;
    try {
      const response = await fetch(`/loom/mappings/${encodeURIComponent(currentMappingId)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      currentMappingId = newId;
      status?.show(`Renamed to ${newId}.json.`, { type: "success", timeout: 2000 });
      await populateMappingSelect();
    } catch (error) {
      status?.show(`Unable to rename mapping: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// --- Init --------------------------------------------------------------

async function init() {
  const shell = initAppShell({
    namespace: "loom-mapping",
    storagePrefix: "undercroft.loom.undo",
    leftPaneLabel: "Toggle palette pane",
    rightPaneLabel: "Toggle inspector pane",
    onUndo: (entry) => {
      const handler = SNAPSHOT_HANDLERS[entry?.type];
      if (!handler || !entry?.before) return { applied: false };
      isApplyingHistory = true;
      try {
        handler.apply(entry.before);
      } finally {
        isApplyingHistory = false;
      }
      updateToolbarState();
      return null;
    },
    onRedo: (entry) => {
      const handler = SNAPSHOT_HANDLERS[entry?.type];
      if (!handler || !entry?.after) return { applied: false };
      isApplyingHistory = true;
      try {
        handler.apply(entry.after);
      } finally {
        isApplyingHistory = false;
      }
      updateToolbarState();
      return null;
    },
  });
  status = shell.status;
  undoStack = shell.undoStack;
  const auth = initAuthControls({ status });
  dataManager = auth.dataManager;
  shareModal = initShareModal({ dataManager, status });

  // Loom edits shared suite-wide data — gated to gm+ for the whole tool,
  // not just individual save actions, so lower-tier visitors can't view or
  // edit any of it. A whole-page gate (unlike Workbench's per-tab gating),
  // since Loom has no ungated view worth showing partially. Individual tabs
  // above this floor are further gated by updateLoomTabAvailability() below.
  const gate = initTierGate({
    root: document,
    dataManager,
    status,
    auth,
    requiredTier: "gm",
    gateSelector: "[data-tier-gate]",
    contentSelector: "[data-tier-content]",
    onGranted: () => window.location.reload(),
    onRevoked: () => window.location.reload(),
  });

  if (!gate.allowed) {
    return;
  }

  // preferLocal: false — a fellow author's edit to sys.dnd5e's fields must
  // be visible immediately in this session's mapping preview, not hidden
  // behind a stale local cache. Same convention as combat-tracker.js.
  try {
    const dnd5eSystem = await dataManager.get("system", "sys.dnd5e", { preferLocal: false });
    const lookupTables = deriveLookupTables(dnd5eSystem?.payload);
    ddbLookupContext = { lookupTables, customFunctions: createMappingCustomFunctions(lookupTables) };
  } catch (error) {
    // Mapping tab still works for editing structure; `lookup()` calls in the
    // live preview just resolve blank until this can be retried.
  }

  // Also picks the first available tab if the static HTML's default active
  // tab (Import) isn't available at this session's tier.
  updateLoomTabAvailability();

  // Proactive notice, not just an on-request status pill — catches the DDB
  // session cookie going stale unnoticed. type: "error" is the only
  // StatusManager variant that persists with a manual close button rather
  // than auto-dismissing — appropriate since this needs an admin's attention.
  if (isLoomAdminSession()) {
    dataManager
      .getAuthCredentialsStatus()
      .then((payload) => {
        if (payload?.ddb?.configured && payload.ddb.valid === false) {
          status.show("D&D Beyond session looks expired — see the Auth tab.", { type: "error" });
        }
      })
      .catch(() => {});
  }

  if (undoButton) undoButton.addEventListener("click", () => shell.undo());
  if (redoButton) redoButton.addEventListener("click", () => shell.redo());

  sampleData = {};
  if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
  await populateMappingSelect();
  enterMappingMode(mappingDefinition);
  markClean("mapping");
  rerenderAll();
  loadRecentSaves();

  // reveal: false on all three — primes each editor's blank-draft state so
  // it's ready the instant something is picked; the panel stays behind its
  // "Select a ..." message until a real user action (select change, New, or
  // a deep link below) explicitly reveals it.
  newLibraryEntry({ reveal: false });

  await populateSystemSelect();
  newSystemEditor({ reveal: false });

  newMacroEditor({ reveal: false });

  // Deep link from the Dashboard's Board widget (board.js's
  // renderMacroButtonCard) — clicking a macro-button card while rearranging
  // the layout lands here already on the Macros tab with that macro loaded.
  // Runs after updateLoomTabAvailability() so the tab is already visible.
  const deepLinkMacroId = new URLSearchParams(window.location.search).get("macro");
  if (deepLinkMacroId) {
    setLoomView("macros");
    await populateMacroSelect();
    if (macroRecordSelect) macroRecordSelect.value = deepLinkMacroId;
    await loadMacroIntoEditor(deepLinkMacroId);
  }

  // Deep link from Crucible's own Inspector ("Edit Feature", a new tab so
  // the GM's in-progress monster stays untouched) — same shape as the macro
  // deep link above.
  const deepLinkFeatureId = new URLSearchParams(window.location.search).get("feature");
  if (deepLinkFeatureId) {
    setLoomView("features");
    await populateFeatureSelect();
    if (featureRecordSelect) featureRecordSelect.value = deepLinkFeatureId;
    await loadFeatureIntoEditor(deepLinkFeatureId);
  }

  // Deep link from Repository's own kind-reference chips (KIND_TOOL_ROUTE)
  // for `system` — same shape as the macro/feature deep links above.
  // systemSelect's options are already populated, not scoped by anything
  // else, so this needs no cascade.
  const deepLinkSystemId = new URLSearchParams(window.location.search).get("system");
  if (deepLinkSystemId) {
    setLoomView("systems");
    if (systemSelect) systemSelect.value = deepLinkSystemId;
    await loadSystemIntoEditor(deepLinkSystemId);
  }

  // Deep link for every OTHER kind authored through Loom's generic Library
  // editor — one shared `?library=<kindId>:<id>` param rather than one per
  // kind, since they all go through this same table+editor. Mirrors the
  // type-filter + selectedKey bookkeeping the Save handler's success path
  // already does above.
  const deepLinkLibraryValue = new URLSearchParams(window.location.search).get("library");
  if (deepLinkLibraryValue) {
    const separatorIndex = deepLinkLibraryValue.indexOf(":");
    const kind = separatorIndex === -1 ? "" : deepLinkLibraryValue.slice(0, separatorIndex);
    const id = separatorIndex === -1 ? "" : deepLinkLibraryValue.slice(separatorIndex + 1);
    if (kind && id) {
      setLoomView("library");
      loomLibraryTableState.selectedType = kind;
      if (loomLibraryTableTypeSelect) loomLibraryTableTypeSelect.value = kind;
      await loomLoadLibraryTable({ refresh: true });
      loomLibraryTableState.selectedKey = `${kind}:${id}`;
      if (loomLibraryTableSelect) loomLibraryTableSelect.value = loomLibraryTableState.selectedKey;
      await loadLibraryEntry(kind, id);
    }
  }

  initHelpSystem({ root: document });
  refreshTooltips(document);
}

init();
