import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls, escapeHtml } from "../../common/js/lib/auth-ui.js";
import { initTierGate } from "../../common/js/lib/access.js";
import { updateJsonPreview } from "../../common/js/lib/json-preview.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import {
  createJsonDataPanel,
  createIconButton,
  createToolbarButtonGroup,
  createCollapsibleSection,
  createCompactField,
} from "../../common/js/lib/ui-components.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { applyMapping } from "../../common/js/lib/mapping-engine.js";
import { deriveLookupTables } from "../../common/js/lib/system-lookup-tables.js";
import { createMappingCustomFunctions } from "../../common/js/lib/mapping-custom-functions.js";
import {
  loadSourceDataRaw,
  loadLibraryKinds,
  fetchKindEntriesWithIds,
  mergeImportedCharacterData,
  listAvailableMappings,
  SOURCES,
} from "../../common/js/lib/content-fetch.js";
import { initShareModal } from "../../common/js/lib/share-modal.js";
import { allowsDelete, confirmDelete } from "../../common/js/lib/ownership.js";
import { roleRank } from "../../common/js/lib/data-manager.js";
import { createSortable } from "../../common/js/lib/dnd.js";
import { loadClipLibrary, getAllClips } from "../../common/js/lib/audio-clip-library.js";
import { MACRO_ACTION_CATALOG } from "../../common/js/lib/widgets/macro-action-catalog.js";
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
} from "../../common/js/lib/property-schema-editor.js";

// SOURCES now imported from content-fetch.js (shared with Workbench's own
// player-facing Import Character picker) — see that module's own comment.

// Built and mounted before any of this file's many querySelector("[data-*]")
// lines below (undo/redo/mapping consts here, library/system/macro consts
// further down, loomGroup*/loomUser* consts much later in the file) — every
// one of them keeps working unchanged since each JS-created button carries
// the exact same data-* attribute/selector its static markup used to.
createToolbarButtonGroup([
  { action: "undo", label: "Undo", attrs: { "data-action": "undo-mapping" } },
  { action: "redo", label: "Redo", attrs: { "data-action": "redo-mapping" } },
]).forEach((button) => document.querySelector("[data-loom-toolbar-mount]")?.appendChild(button));
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
    action: "delete",
    label: "Delete Macro",
    disabled: true,
    attrs: { "data-macro-delete": true, "data-loom-view-panel": "macros", hidden: true },
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
    action: "delete",
    label: "Delete Group",
    disabled: true,
    attrs: { "data-loom-group-delete": true, "data-loom-view-panel": "groups", hidden: true },
  },
]).forEach((button) => document.querySelector("[data-loom-toolbar-mount]")?.appendChild(button));

// "Add Property"/"Add Action" — small inline compact-kind buttons (top
// tooltip, plain icon), not part of the left-pane toolbar cluster above.
// Original markup used `btn-sm p-1` rather than createIconButton's own
// compact-kind padding; `p-1` is added via className to match exactly.
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
document.querySelector("[data-loom-group-add-property-mount]")?.appendChild(
  createIconButton({
    icon: "tabler:plus",
    label: "Add Property",
    className: "p-1",
    attrs: { "data-loom-group-add-property": true },
  })
);
const loomGroupAddPropertyButton = document.querySelector("[data-loom-group-add-property]");

// Property Inspector toolbar (right pane) — New/Delete/Duplicate/Required
// Property. Built directly via createIconButton rather than
// createToolbarButtonGroup: it needs top tooltip placement (this toolbar
// sits in the right pane, unlike the bottom-placement left-pane clusters
// above) and Required is a genuine pressed/unpressed toggle
// (aria-pressed), not a fire-once action, so it doesn't fit the
// New/Save/Delete preset shape.
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
mountField("mapping-select", createCompactField({ type: "select", id: "loomMappingSelect", label: "Mapping", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select", dataAttr: "data-mapping-select" }));

const mappingSelect = document.querySelector("[data-mapping-select]");
// Adopts each section's existing static `[data-xxx-panel]` markup (its own
// content stays hand-authored HTML — only the header+chevron wrapper is
// JS-built) as the collapsible section's content; createCollapsibleSection's
// own internal bindCollapsibleToggle replaces the old standalone calls
// below. Selection/Mapping Tree/Entities/Data all start expanded
// (collapsed: false), matching their original aria-expanded="true" markup.
const mappingsSection = createCollapsibleSection({
  label: "Selection",
  collapsed: false,
  content: document.querySelector("[data-mappings-panel]"),
});
document.querySelector("[data-mappings-mount]")?.appendChild(mappingsSection.section);
const nodePalette = document.querySelector("[data-node-palette]");
const stepPaletteSection = document.querySelector("[data-step-palette-section]");
const stepPalette = document.querySelector("[data-step-palette]");
const sampleDataInput = document.querySelector("[data-sample-data-input]");
const sampleDataApplyButton = document.querySelector("[data-sample-data-apply]");
const sourceSelect = document.querySelector("[data-source-select]");
// Purely a categorization tag on the mapping itself ($dataType, see
// enterMappingMode/the Save handler below) — unlike sourceSelect, it never
// locks (a GM can freely retag a mapping's data type at any time) and has
// no bearing on how Fetch behaves. Controls which mappings Workbench's own
// player-facing "Import Character" flow offers.
const dataTypeSelect = document.querySelector("[data-data-type-select]");
// A friendly name shown in place of this mapping's own raw id in
// Workbench's player-facing "Import Character" picker (content-fetch.js's
// listCharacterMappings) — same "stamp at save time" handling as
// dataTypeSelect above, no live dirty-tracking wiring needed.
const mappingDescriptionInput = document.querySelector("[data-mapping-description]");
const sourceValueInput = document.querySelector("[data-source-value]");
// Shown instead of sourceValueInput above only for a source flagged
// `file: true` (SOURCES, content-fetch.js) — currently just Fantasy
// Statblocks' own markdown upload; every other source's value is typed
// text/a URL.
const sourceFileInput = document.querySelector("[data-source-file]");
const sourceValueLabelRow = document.querySelector("[data-source-value-label-row]");
const sourceFetchButton = document.querySelector("[data-source-fetch]");
const entitiesSummary = document.querySelector("[data-entities-summary]");
const entitiesList = document.querySelector("[data-entities-list]");
// Entities and Data (io) both need programmatic re-collapse later
// (enterMappingMode's workflow-mode logic below) — their setCollapsed
// return values are captured for that, same as treeSetCollapsed below.
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
// Builds and mounts a collapsible-section chevron toggle via the shared
// factory, for a header whose other content (label, Refresh button) stays
// static HTML — the section-level createCollapsibleSection isn't used here
// since it would rebuild the whole header, conflicting with that sibling
// Refresh button (see Orrery's identical helper for the precedent).
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
// Mapping Tree needs programmatic re-collapse later (enterMappingMode's
// workflow-mode logic below) — its setCollapsed return value is captured
// for that, same as entitiesSetCollapsed/ioSetCollapsed above.
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
// Assigned Systems/Settings are collapsible for the same reason every other
// Loom section is (Selection/Entities/Data/Mapping Tree above) — adopts its
// own pre-existing static list div as content, same pattern as those.
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
const libraryNewButton = document.querySelector("[data-library-new]");
const librarySaveButton = document.querySelector("[data-library-save]");
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
const systemNewButton = document.querySelector("[data-system-new]");
const systemSaveButton = document.querySelector("[data-system-save]");
const systemDuplicateButton = document.querySelector("[data-system-duplicate]");
const systemDeleteButton = document.querySelector("[data-system-delete]");
const systemAddPropertyButton = document.querySelector("[data-system-add-property]");
// Gated behind a "Select a system..." message, same convention as Groups/
// Users — hidden until a system is loaded or New is explicitly clicked (see
// newSystemEditor/loadSystemIntoEditor below), not shown by default just
// because a blank draft exists in the form underneath.
const systemsEmpty = document.querySelector("[data-systems-empty]");
const systemsPanel = document.querySelector("[data-systems-panel]");
function setSystemFormVisible(visible) {
  if (systemsEmpty) systemsEmpty.hidden = visible;
  if (systemsPanel) systemsPanel.classList.toggle("d-none", !visible);
}
// Read-only, live "the whole record as it'll be saved" view — see
// buildSystemPayload/renderSystemJsonPreview below. Built via the shared
// ui-components.js factory (pilot migration) instead of hand-written markup
// + separate collapsible/copy wiring.
const systemJsonPanelInstance = createJsonDataPanel({
  label: "JSON Data",
  helpTopic: "loom.systemJsonPreview",
  getData: () => buildSystemPayload(),
});
document.querySelector("[data-system-json-mount]")?.appendChild(systemJsonPanelInstance.section);
// Property Inspector (right pane) — a second, more spacious way to edit
// whichever property row is currently selected in the Properties list above,
// for anyone who finds that list's single-row-per-property layout cramped or
// confusing. Deliberately NOT a replacement for that list — every field here
// proxies the selected row's own real input (see createPropertyInspector,
// common/js/lib/property-schema-editor.js), so editing in either place is
// the exact same edit, just through a different control.
const systemInspectorEmpty = document.querySelector("[data-system-inspector-empty]");
const systemInspectorDetails = document.querySelector("[data-system-inspector-details]");
const systemInspectorFields = document.querySelector("[data-system-inspector-fields]");
const systemInspectorNewButton = document.querySelector("[data-system-inspector-new]");
const systemInspectorDeleteButton = document.querySelector("[data-system-inspector-delete]");
const systemInspectorDuplicateButton = document.querySelector("[data-system-inspector-duplicate]");
const systemInspectorRequiredButton = document.querySelector("[data-system-inspector-required]");
// Collapsible, same convention as every other right-pane/Loom section — see
// the Group Property Inspector's identical wrapping further down. Expanded
// by default: unlike Assigned Systems/Settings/Share link, this was never
// collapsed before it became a collapsible section, so nothing changes for
// anyone with the tab already open.
const systemInspectorContent = document.querySelector("[data-system-inspector-content]");
const systemInspectorSection = createCollapsibleSection({
  label: "Property Inspector",
  collapsed: false,
  content: systemInspectorContent,
}).section;
document.querySelector("[data-system-inspector-mount]")?.appendChild(systemInspectorSection);

// Macros tab — its own dedicated authoring UI (mirrors the Systems tab
// above: a select of existing records + New/Save/Delete, editing one at a
// time), NOT a section bolted onto the generic Library JSON editor. The
// generic Library tab (libraryJsonTextarea etc. above) still edits a
// "macro" kind entity too, same as any other kind, but as raw JSON only —
// this tab is the non-JSON authoring surface for it, same relationship
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
// PROPERTY_TYPES, and the whole Properties row editor (type-cycling,
// drag-to-reorder, nested Sub-fields/Record fields, value lists) now live in
// common/js/lib/property-schema-editor.js, shared with the Group Properties
// editor below — see that module's own header comment.

let mappingDefinition = null;
let selectedNode = null;
let sampleData = {};
let currentMappingId = null;
let isApplyingHistory = false;
let dataManager = null;
// The D&D 5e System's lookup tables/custom functions for the live mapping
// preview below — used to be a static import from common/js/lib/
// lookup-tables.js, now derived at runtime from sys.dnd5e's own fields
// (edited in Loom itself) via system-lookup-tables.js's deriveLookupTables,
// fetched once at startup (see init()) since runLivePreview() reads this
// synchronously on every mapping edit. Defaults to empty so the Mapping tab
// still works for editing structure before the fetch resolves — only
// `lookup()` calls resolve blank until then.
let ddbLookupContext = { lookupTables: {}, customFunctions: createMappingCustomFunctions({}) };
let shareModal = null;
let undoStack = null;
let status = null;
let lastMappedResult = null;

// --- Undo/redo -------------------------------------------------------------
// One shared undo stack across every tab (Import/Library/Systems) — the
// toolbar's Undo/Redo pair is always visible (see setLoomView) and
// dispatches by each pushed entry's `type` to the matching tab's
// create/apply-snapshot pair below. Whole-form JSON snapshots per domain,
// mirroring press/js/app.js's recordUndoableChange pattern: cheap to
// diff/clone at this scale, and side-steps having to track stable node/row
// identity across undo/redo (selection/focus just resets, same as the
// original mapping-only version already did). The Library/System
// create/apply functions are declared further down (with the rest of each
// tab's own logic) — referencing them here works because `function`
// declarations hoist fully, unlike `const`.
const SNAPSHOT_HANDLERS = {
  mapping: { create: createMappingSnapshot, apply: applyMappingSnapshot },
  library: { create: createLibrarySnapshot, apply: applyLibrarySnapshot },
  system: { create: createSystemSnapshot, apply: applySystemSnapshot },
  macro: { create: createMacroSnapshot, apply: applyMacroSnapshot },
};

// --- Save/Rename/Delete gating -----------------------------------------
// "Clean" baseline per tab (the state at last load/new/save) — reuses the
// same per-type snapshot functions undo/redo already has, so dirty-checking
// doesn't need its own parallel tracking. Save only lights up once the
// current state actually differs from that baseline; Rename/Delete only
// need a real, currently-loaded item (an id), not necessarily a change.
const cleanSnapshots = { mapping: null, library: null, system: null, macro: null };

// Declared here (a no-op placeholder, reassigned once real DOM/state is
// ready — see buildSystemPayload/collectSystemProperties below) so
// updateToolbarState below can call it unconditionally on every System
// edit without a `let`-in-temporal-dead-zone ReferenceError: this const
// block sits well before that later reassignment runs, `let` has no TDZ
// issue once past its own declaration, only before it.
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

function canSaveSystem() {
  return Boolean((systemIdInput?.value || "").trim()) && isDirty("system");
}

function canDeleteSystem() {
  return systemAllowsDelete(systemSelect?.value);
}

// Enabled off the same "there's a real id typed" check Save uses, but
// without also requiring isDirty("system") — duplicating an unmodified,
// already-saved System is exactly as valid as duplicating a mid-edit one.
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

// Surfaces *why* Save is disabled for the common case of broken JSON —
// canSaveLibrary() already silently requires currentLibraryEntity() to
// parse, but a disabled button with no explanation left the user unable to
// tell "invalid JSON" apart from "nothing changed yet" (see the npc title
// fix: a test edit that broke the JSON looked identical to no edit at all).
// Blank/untouched textarea is treated as neutral, not an error, so this
// doesn't fire before anything's ever been loaded.
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
  if (libraryDeleteButton) libraryDeleteButton.disabled = !canDeleteLibrary();
  if (systemSaveButton) systemSaveButton.disabled = !canSaveSystem();
  if (systemDuplicateButton) systemDuplicateButton.disabled = !canDuplicateSystem();
  if (systemDeleteButton) systemDeleteButton.disabled = !canDeleteSystem();
  if (macroSaveButton) macroSaveButton.disabled = !canSaveMacro();
  if (macroDeleteButton) macroDeleteButton.disabled = !canDeleteMacro();
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

// Free-text/number/select fields (Library's id/JSON, System's id/title/
// version/property rows) can't be wrapped in recordUndoableChange the way a
// button click can — the browser already mutated the field by the time any
// listener fires. Instead this snapshots on focus-in (before the edit) and
// compares against a snapshot on commit
// (`change`, which fires once on blur/Enter, not per keystroke — one undo
// step per edit rather than one per character). `container` may be the
// field itself (non-delegated) or a row-holding container with `selector`
// naming which descendants count (for dynamically added/removed rows).
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
  // Live, on every keystroke — Save should light up as soon as the content
  // actually differs, not only once the field loses focus (that's just when
  // an undo *step* gets committed, a coarser granularity — see below).
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

// --- Workflow mode: a mapping with a fixed $source (already saved/loaded)
// favors the Entities pane; a brand-new mapping (no $source yet) favors the
// Mapping Tree instead. Input/Output stays expanded either way. This only
// fires on actual mode transitions (load/new/first-save), not on every
// small edit, so it doesn't fight the user's own manual collapse/expand.
//
// Data Source itself is never disabled — Loom is the only place a mapping's
// $source can be edited at all (Workbench's own player-facing Import
// Character flow has no such control, see content-fetch.js), so locking it
// here once set would make a mistagged mapping's $source permanently
// unfixable short of hand-editing its JSON file. applySourceSelection just
// reflects the mapping's own current value; the Save handler below now
// always stamps whatever's currently selected, not only when unset.

// Toggles which of sourceValueInput/sourceFileInput is actually shown for
// `active` — the one place both this function and updateSourceUi below
// (Data Source dropdown's own change handler) need to agree on which
// element to display, so it isn't duplicated between them.
function applySourceValueVisibility(active) {
  if (sourceValueInput) sourceValueInput.classList.toggle("d-none", Boolean(active.file));
  if (sourceFileInput) sourceFileInput.classList.toggle("d-none", !active.file);
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

if (sourceFetchButton) {
  sourceFetchButton.addEventListener("click", async () => {
    const source = SOURCES.find((entry) => entry.id === sourceSelect?.value) || SOURCES[0];
    // A `file: true` source's value is the picked File itself, not typed
    // text — loadSourceDataRaw's own "fantasy-statblocks" case (
    // content-fetch.js) reads it via readTextFile, same as the existing
    // "json" source already does via readJsonFile.
    const value = source.file ? sourceFileInput?.files?.[0] || null : (sourceValueInput?.value || "").trim();
    if (!value) {
      status?.show(source.file ? "Choose a file to load." : "Enter a value to fetch.", { type: "warning", timeout: 2000 });
      return;
    }
    try {
      const raw = await loadSourceDataRaw(source, value);
      sampleData = raw;
      if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
      runLivePreview();
      status?.show("Fetched.", { type: "success", timeout: 1500 });
    } catch (error) {
      status?.show(`Fetch failed: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// --- Entities: one-to-many expansion + per-entity save ---------------------
// Convention, not engine metadata: a mapped result with a top-level {kind,
// name} is the primary entity; ENTITY_ARRAY_FIELDS below map a specific field
// name to the entity kind its items should be saved as. Explicit by design —
// reference arrays like saving_throws/proficiencies also carry {name, ...}
// entries but aren't separate entities to save, so a field only qualifies if
// it's actually listed here, never just by shape. `subclasses` is NOT listed:
// it's deliberately just a lightweight ref array on the class ({index, name,
// url}, matching the 5e API's class shape) — the full subclass list is its
// own separate mapping (ddb-subclass.json), whose pipeline root already
// produces subclass entities directly via the Array.isArray branch below.
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

// A mapping's root can itself be a pipeline (e.g. ddb-subclass.json applies
// to the same class-page fetch as ddb-class.json, but its root is a pipeline
// over `subclasses` producing the full array directly) — every item that
// looks like an entity ({kind, name}) is one, no wrapping object needed.
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

async function saveEntity(entity) {
  const id = promptKey(`Save "${entity.name}" as (id):`, slugify(entity.name));
  if (!id) return;
  if (!dataManager) return;
  try {
    let data = entity.data;
    if (entity.kind === "character") {
      // content-fetch.js's own mergeImportedCharacterData preserves
      // template/systemIds/data/url/mapping from whatever's already saved
      // at this id — see its own comment for why a plain overwrite here
      // (re-importing to refresh an existing character's mapped fields)
      // would otherwise silently wipe Workbench's own template/system
      // assignment, making the character vanish from Workbench's own
      // picker (which filters on `template` being set) even though the
      // record itself still exists and loads fine here in Loom.
      try {
        // preferLocal: false for the same reason loadLibraryEntry uses it —
        // this specifically needs the record actually on the server right
        // now, not a possibly-stale local cache from an earlier save.
        const existing = await dataManager.get("character", id, { preferLocal: false });
        data = mergeImportedCharacterData(entity.data, existing?.payload);
      } catch (error) {
        // No existing record at this id — nothing to preserve, first import.
      }
      // Records exactly what this character would need to redo this same
      // fetch+transform later without reopening Loom at all — Workbench's
      // own "Re-import" button (workbench-character-view.js) shows up only
      // when both are present, and passes them straight to content-fetch.js's
      // reimportViaMapping. `mapping` alone (no `url`) happens when the
      // mapping was applied to hand-pasted/edited Sample Data rather than a
      // real fetch — nothing to re-fetch from, so `url` is deliberately left
      // unset rather than storing an empty placeholder.
      if (currentMappingId) {
        data = { ...data, mapping: currentMappingId };
      }
      const sourceValue = (sourceValueInput?.value || "").trim();
      if (sourceValue) {
        data = { ...data, url: sourceValue };
      }
      // Every imported (or created) character needs at least one Assigned
      // System — without this, a brand-new DDB import (nothing to preserve
      // above, and the mapping itself never produces a systemIds field —
      // see the comment above) would save with an empty array, invisible to
      // anything keyed off Assigned Systems (character-sheet.js's own
      // combat-binding lookup, Workbench's `@`-suggestion field list, ...).
      // Gated on the currently loaded mapping's own declared `$source`
      // ("ddb", ddb-character.json's root) rather than hardcoded
      // unconditionally — a future non-DDB character mapping wouldn't
      // inherit this default by accident; still explicit user data
      // (`entity.data.systemIds`, if the mapping ever DOES start producing
      // one) or a prior save's own preserved value always wins over this.
      if ((!Array.isArray(data.systemIds) || !data.systemIds.length) && mappingDefinition?.$source === "ddb") {
        data = { ...data, systemIds: ["sys.dnd5e"] };
      }
    }
    await dataManager.save(entity.kind, id, data);
    status?.show(`Saved ${entity.kind}/${id}.json.`, { type: "success", timeout: 2000 });
    await autoLinkEntityToSystems(entity.kind, id, data);
    loadRecentSaves();
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
    return;
  }
  const counts = {};
  entities.forEach((entity) => {
    counts[entity.kind] = (counts[entity.kind] || 0) + 1;
  });
  entitiesSummary.textContent = `This produced: ${Object.entries(counts)
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`)
    .join(" + ")}`;

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
// Same nav-tabs convention as every other top-level view switcher in the
// suite (Workbench's Template/Edit/Play, Press's Live Preview/Grid View).
// Only the
// active view's cards show — in the main pane, AND in the left/right panes
// (the mapping toolbar/palette/sample-data on the left and the tree Inspector
// on the right are Import-only; Library/Systems carry their own
// pickers/toolbars inline, so they don't need anything extra from either
// side pane).
const LOOM_VIEWS = ["import", "library", "systems", "macros", "users", "groups"];
const loomViewTabsContainer = document.querySelector("[data-loom-view-tabs]");

function setLoomView(view) {
  if (!LOOM_VIEWS.includes(view)) return;
  document.querySelectorAll("[data-loom-view-tab]").forEach((tab) => {
    const isActive = tab.dataset.loomViewTab === view;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  // Same `.hidden` + `.d-none` combo as everywhere else this session — these
  // panels carry `.d-flex`, which Bootstrap declares `!important` and beats
  // the plain `[hidden]` UA rule on its own.
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
const loomGroupDeleteButton = document.querySelector("[data-loom-group-delete]");

// Property Inspector (right pane) — same mechanism as Systems' own, see
// createPropertyInspector below. Collapsible, same as Systems' own; expanded
// by default for the same "wasn't collapsed before this became a
// collapsible section" reasoning.
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

// Share link (right pane, below Property Inspector) — same static controls
// as before, just moved out of the main pane into a collapsible section,
// same convention as Assigned Systems/Settings above (an existing static
// content div adopted as-is). Expanded by default, unlike Assigned Systems/
// Settings — a campaign's share link is the one thing on this tab a GM
// reaches for right after picking a group, not a rarely-needed detail.
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
  // JSON.stringify of the loaded group's own `properties` schema — same
  // "clean baseline snapshot, compare on demand" shape as cleanName/
  // cleanSystemId/cleanSettingId above, just for the Properties editor
  // (common/js/lib/property-schema-editor.js) instead of a plain field.
  cleanPropertiesJson: null,
};
// Populated once per Groups-tab session (systems don't change while this tab
// is open) rather than re-fetched on every loomRenderGroupDetail call — same
// "load list, then render selection against it" split loomOwnedCharacters
// already uses for the member picker.
let loomGroupSystemsCatalog = [];
// Same "load once per Groups-tab session" shape as loomGroupSystemsCatalog,
// sourced from the same listAllSettings() the "Assigned Settings" checkbox
// section (populateLibrarySettingCheckboxes) already uses — not filtered to
// the Group's own selected System, deliberately: a mismatched System/Setting
// pairing is an authoring concern for the GM to notice, not something this
// picker enforces.
let loomGroupSettingsCatalog = [];
const loomUsersState = { items: [], selectedTier: "", selectedUsername: "", clean: null, mode: "view" };
// Populated alongside loomLoadGroups() — the Groups tab's member picker needs
// the signed-in user's own saved characters (same shape Admin's Owned Content
// tab used to track), but Loom otherwise has no reason to track "my owned
// content" as its own concept, so this is a lightweight, Groups-tab-local
// fetch rather than porting that whole view-state machine over too.
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
// Left pane: Tier filter + User select (who to look at). Center pane: a full
// editable form for whoever's selected — Save commits Email + Tier together
// (explicit Save/Delete toolbar buttons, the same convention Library/Systems
// already use, rather than the old table's auto-save-on-change tier select).

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
// Left pane: Group select (which to look at) + New/Save/Delete toolbar.
// Center pane: the selected group's full detail — name, member roster, and
// public share-link controls — what used to live in a per-row collapsible
// table section now shown directly, the same "one thing selected, its
// details shown in the center pane" convention Library/Users/Systems use.

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

// Workbench's own bootstrap (workbench.js) is what actually reads
// ?record=<bucket>:<id>&share=<token> to pick a view and load the shared
// record, so every share link this tab generates must resolve to
// workbench/index.html regardless of which page built the link.
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

// The shared row editor (common/js/lib/property-schema-editor.js) is
// undo/dirty-tracking-agnostic — unlike Systems (which plugs into Loom's
// whole-tab undo stack, see systemPropertyCtx), the Groups tab has no undo
// stack of its own at all (member checkboxes already auto-save immediately,
// with no undo either), so this just re-renders/marks the tab dirty via the
// exact same loomUpdateGroupsToolbarState() every other Group field change
// already calls.
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
  // scoped to any one System the way a System's own Properties are to
  // itself (that System IS the thing being edited); every entity of the
  // chosen Library kind is offered here regardless of the group's own
  // assigned System.
  //
  // "Public" — the one Group-only addition Systems has no equivalent of
  // (no System/Character field has a party-wide "who may edit this value"
  // concept; a Character's own fields are always editable by that
  // character's own owner). Only added to TOP-LEVEL property rows (this
  // row's own parent is the top-level container, not a nested Sub-fields/
  // Record-fields container) — nested sub-fields inherit their parent's
  // flag rather than getting their own, same as this suite's other
  // "permission lives on the whole field, not each of its pieces"
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
// state back in — collectFieldFromRow itself has no idea that concept
// exists (it's a Group-only addition, see groupPropertyCtx's own comment),
// so this reads it straight off the row's button right after, the one place
// that both the field object and its own DOM row are still both in hand
// together. Assigned as groupPropertyCtx.collectField below so the Property
// Inspector's own Duplicate button (createPropertyInspector, common/js/lib/
// property-schema-editor.js) preserves Public the same way Save already
// does, not just top-level collectGroupProperties.
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
// listAllSystems() knows about, same catalog the Systems tab itself lists
// from. Rebuilds the whole option list each time (cheap, and simplest way to
// stay in sync with loomGroupSystemsCatalog without a separate diffing pass)
// then restores whichever value loomRenderGroupDetail sets afterward.
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

// Same System-filtered Template list populateLibraryTemplateSelect already
// builds for a Character's own `template` field — adapted for a Group's
// singular `systemId` instead of a `systemIds` array (a Group only ever has
// one assigned System, unlike a Character's Assigned Systems list). Unlike
// that function, picking a Template here does NOT fold its schema back into
// the Group's own System — the System select above is Group's own
// independent, explicit field (it already drives Party Inventory's own
// System-matching), not something a Template pick should silently change.
// Re-fetched fresh (not cached) each time a Group is selected or its System
// changes, matching populateLibraryTemplateSelect's own "always current"
// convention.
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

// Reads the System filter from the SELECT's own live value (not
// group.system_id) so a not-yet-saved System choice narrows this list
// immediately, the same way any other unsaved edit previews live — see the
// loomGroupSystemSelect "change" listener below, which calls this directly
// instead of the full loomRenderGroupDetail (which would otherwise stomp the
// live selection back to the saved value).
function loomRenderGroupMembersList(group) {
  if (!loomGroupMembersList) return;
  const members = Array.isArray(group?.members) ? group.members.filter((member) => member.content_type === "character") : [];
  loomGroupMembersList.innerHTML = "";
  const memberMap = new Map();
  members.forEach((member) => memberMap.set(member.content_id, member));
  const seenIds = new Set();
  const rows = [];
  // A Group with its own System narrows "available to add" down to
  // characters assigned to that same System — leaving the Group's System
  // unset (the common case for a brand-new campaign) shows everyone, same
  // as before this filter existed. Characters already added stay visible
  // regardless (see the memberMap.forEach fallback below) — this only
  // affects what's offered to ADD, never removes an existing member.
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
  // payload above — list_groups' own server-side row shaping deliberately
  // skips a kind's full JSON body for a LIST response (same reason
  // list_bucket/list_owned_content never include one either, to avoid an
  // N-file-reads cost). Fetched separately, via the exact same generic
  // content route (`dataManager.get("group", id)`) Loom's own raw-JSON
  // Library editor already uses for every kind, once this specific group
  // becomes the one being edited.
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
  // The GM may have already clicked a different group (or navigated away)
  // by the time this resolves — a stale response landing after that would
  // otherwise silently repopulate the Properties editor for the WRONG group.
  if (loomGroupsState.selectedId !== groupId) return;
  loomRenderGroupPropertyRows(properties);
  // Rebuilt from scratch above — whatever was selected before (if anything)
  // is now a detached DOM node, same reasoning as System's own
  // loadSystemIntoEditor/applySystemSnapshot resets.
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
    // very select back to the saved group.system_id.
    loomRenderGroupMembersList(loomFindGroup(loomGroupsState.selectedId));
    // Cascades to the Template list the same way (a different System means
    // a different, possibly empty, set of matching Templates) — keeps
    // whatever's currently typed/selected in the Template select if it's
    // still a valid option for the new System, same "preserve the live
    // unsaved value" reasoning as the member-list re-render above.
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
// the Group Properties editor — same shared-module wiring Systems uses
// (systemPropertyCtx/wirePropertyContainerEvents above), just bound to
// groupPropertyCtx instead. One persistent instance, same "never recreated,
// only its children are" reasoning as Systems' own equivalent call.
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
    // A not-yet-saved System choice (the dropdown, staged until the Save
    // button is clicked) drives this list's own live filter — member
    // checkboxes auto-save immediately and independently of that Save
    // button, via the reload below, which otherwise re-renders the whole
    // detail panel from the server's last-SAVED group and silently discards
    // the staged choice, resetting the filter to "show everyone."
    const pendingSystemId = loomGroupSystemSelect?.value || "";
    // Same reasoning applies to an unsaved pending Setting choice.
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

// --- Tab-level tier gating ----------------------------------------------------
// The whole tool is gated at GM tier and above (see init()'s initTierGate
// call), but not every tab makes sense at every tier above that floor: GM
// sees Groups and Macros (running a campaign — Macros' own kind is
// writeTier "gm" in common/data/kind/macro.json, a GM's own table cues, not
// Creator-authored shareable content in the same sense Systems/Templates
// are); Creator adds Import/Library/Systems (author reusable, shareable
// content); Admin adds Users (suite-wide tier management) on top of
// everything Creator sees.
const LOOM_CREATOR_TABS = ["import", "library", "systems"];

function loomAvailableViews() {
  const meetsCreator = Boolean(dataManager?.meetsTier?.("creator"));
  const isAdmin = isLoomAdminSession();
  return LOOM_VIEWS.filter((view) => {
    if (LOOM_CREATOR_TABS.includes(view)) return meetsCreator;
    if (view === "users") return isAdmin;
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
  // it's what actually adds the `.d-none` class every non-active panel needs
  // (the static HTML only carries the `hidden` attribute, which Bootstrap's
  // `.d-flex` `!important` rule beats on its own; see setLoomView's own
  // comment). Skipping this call whenever no tab-switch was needed used to
  // leave every panel visible at once on a fresh load.
  const activeButton = document.querySelector("[data-loom-view-tab].active");
  const activeView = activeButton?.dataset.loomViewTab;
  const nextView = activeView && available.has(activeView) ? activeView : loomAvailableViews()[0] || "groups";
  setLoomView(nextView);
}

// --- Library contents (browse/share across every owner + kind) -------------
// The Kind+Entity picker in the center pane below is for direct editing of
// one entity at a time; this left-pane select + right-pane inspector is the
// "manage the whole Library" surface the account page's Owned Content view
// intentionally doesn't try to be (that page only ever shows the signed-in
// user's own items) — Share reuses the exact same generic share modal Owned
// Content uses. The two pickers are deliberately independent: picking an
// item here only surfaces its metadata/Share action, it doesn't load it into
// the Kind+Entity editor below.
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
// Library Type is gated on the Type FILTER select alone (loomLibraryTableState
// .selectedType) — it shows the instant a type is picked, before any
// specific item is. Library Item stays gated on an actual selected item (it
// has nothing to show without one: no created/accessed/owner/share data
// exists for "a kind" in the abstract).
const loomLibraryTypeEmpty = document.querySelector("[data-loom-library-table-type-empty]");
const loomLibraryTypeDetails = document.querySelector("[data-loom-library-table-type-details]");
const loomLibraryInspectorEmpty = document.querySelector("[data-loom-library-table-inspector-empty]");
const loomLibraryInspectorDetails = document.querySelector("[data-loom-library-table-inspector-details]");
// "Library Type" (kind-level policy — Viewable/Editable by) and "Library
// Item" (this one record's own Created/Owner/Share) are collapsible for the
// same reason nearly every right-pane section in the suite is — adopts each
// pre-existing static list div as content, same pattern as Assigned
// Systems/Settings above. Unlike those, these two sections themselves are
// always present (not gated behind a "select something" swap) — only their
// CONTENT is: each one's own list still opens with an empty "Select a ..."
// message (data-loom-library-table-type-empty/-inspector-empty) that gives
// way to real details once something's picked, same convention as the
// center-pane's own gating. Both start collapsed; loomRenderLibraryTypeInspector/
// loomRenderLibraryInspector below auto-expand (never auto-collapse — a
// manual re-collapse after inspecting stays collapsed, this only ever opens
// it for you) the moment there's something worth showing.
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
const loomLibraryInspectorCreated = document.querySelector("[data-loom-library-table-created]");
const loomLibraryInspectorAccessed = document.querySelector("[data-loom-library-table-accessed]");
const loomLibraryInspectorReadTier = document.querySelector("[data-loom-library-table-read-tier]");
const loomLibraryInspectorWriteTier = document.querySelector("[data-loom-library-table-write-tier]");
const loomLibraryInspectorOwner = document.querySelector("[data-loom-library-table-owner]");
const loomLibraryInspectorShareSummary = document.querySelector("[data-loom-library-table-share-summary]");
const loomLibraryInspectorShareButton = document.querySelector("[data-loom-library-table-share]");
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
// full breakdown (add/remove specific users or groups, public link
// controls) lives in the Share modal itself; this is just enough to know
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
// tierMeetsOwnerRequirement makes, but sourced from this kind's own real
// writeTier policy (loomLibraryKindWriteTiers, populated in
// loomLoadLibraryTable) instead of a hardcoded 3-bucket table — every kind
// Loom's own Library browse table spans gets a correct answer this way, not
// just character/template/system. No policy on record for a kind (a custom
// creator-defined kind with no kind.json, or the value simply absent) means
// unconstrained — same "absent = universal" convention used everywhere else
// in this suite.
function loomTierMeetsOwnerRequirement(tier, bucket) {
  const requirement = loomLibraryKindWriteTiers.get(bucket);
  return !requirement || roleRank(tier) >= roleRank(requirement);
}

function loomDescribeOwnerOption(username, tier) {
  const base = `${username} (${loomFormatTier(tier)})`;
  return dataManager?.session?.user?.username === username ? `${base} (You)` : base;
}

// Mirrors account.js's own buildOwnerOptions exactly (current owner first,
// then — admin sessions only — every other tier-eligible user), just
// scoped to whichever single item is selected here instead of one row per
// item in a table.
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

// The kind's own policy (common/data/kind/{id}.json), not any one item's own
// sharing — "who can see/edit ANY item of this kind" vs. Share's own "who
// can see/edit THIS ONE item" in Library Item below. Gated on the Type
// filter select alone, so it appears the instant a type is picked in the
// left pane, before any specific item is — the Library Item section below
// is the one that needs an actual selected item. Defaults match the
// server's own load_kind_policy() fallback for a kind with no kind.json on
// disk.
// Tracks the PREVIOUS hasType/hasItem, not just the current one — this
// function re-runs on every Library table refresh, not only when the
// selection actually changes (loomRenderLibraryTableSelect calls it
// unconditionally), so auto-expanding only on the false→true edge is what
// keeps a manual re-collapse (while the same type/item is still selected)
// from being silently undone the next time the table happens to refresh.
let loomLibraryTypeWasSelected = false;
function loomRenderLibraryTypeInspector() {
  const bucket = loomLibraryTableState.selectedType;
  const hasType = Boolean(bucket);
  if (loomLibraryTypeEmpty) loomLibraryTypeEmpty.hidden = hasType;
  if (loomLibraryTypeDetails) loomLibraryTypeDetails.classList.toggle("d-none", !hasType);
  if (hasType && !loomLibraryTypeWasSelected) loomLibraryTypeSection.setCollapsed(false);
  loomLibraryTypeWasSelected = hasType;
  if (!hasType) return;
  if (loomLibraryInspectorReadTier) loomLibraryInspectorReadTier.textContent = loomFormatTier(loomLibraryKindReadTiers.get(bucket) || "free");
  if (loomLibraryInspectorWriteTier) loomLibraryInspectorWriteTier.textContent = loomFormatTier(loomLibraryKindWriteTiers.get(bucket) || "admin");
}

// Same false→true edge tracking as loomLibraryTypeWasSelected above.
let loomLibraryItemWasSelected = false;
function loomRenderLibraryInspector() {
  loomRenderLibraryTypeInspector();
  const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
  const hasItem = Boolean(item);
  if (loomLibraryInspectorEmpty) loomLibraryInspectorEmpty.hidden = hasItem;
  if (loomLibraryInspectorDetails) loomLibraryInspectorDetails.classList.toggle("d-none", !hasItem);
  if (hasItem && !loomLibraryItemWasSelected) loomLibraryItemSection.setCollapsed(false);
  loomLibraryItemWasSelected = hasItem;
  if (!hasItem) {
    void loomRenderLibraryShareSummary(null);
    return;
  }
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
    // Only an admin session can actually change ownership (the server hard-
    // enforces this too — see update_owner()) — a non-admin, or an item
    // with nothing else to switch to, sees a locked single-option select,
    // same convention account.js's own row-level dropdown uses.
    loomLibraryInspectorOwner.disabled = !isLoomAdminSession() || options.length <= 1;
  }
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
    // Same window.confirm pattern as every other significant/hard-to-undo
    // action in Loom (deleting a user/group/macro/system, above) — changing
    // an owner isn't destructive, but it does immediately hand this item's
    // edit/delete rights to someone else, so it deserves the same pause.
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
  // The Owner dropdown (loomBuildOwnerOptions) needs the full user list —
  // admin-only, same as the Owner control itself, so this is a no-op for
  // any non-admin session. Loaded here (not only when the Users tab is
  // visited) so it's already populated before the inspector needs it.
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
    loomLibraryTableState.items = items;
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
// updating the right-pane inspector here, they also drive the center-pane
// JSON editor via loomLoadPickedLibraryEntry(), defined alongside the rest
// of the editor logic further down (referencing it here works because
// `function` declarations hoist fully, unlike `const`).
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
// changed, and the modal itself doesn't know about this inspector to notify
// it directly.
document.addEventListener("hidden.bs.modal", (event) => {
  if (!event.target?.hasAttribute?.("data-share-modal")) return;
  const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
  if (item) void loomRenderLibraryShareSummary(item);
});

// --- Systems: list every saved System (Workbench's own DataManager bucket —
// Loom is a second editor for the exact same data, not a separate store) ----

// Populated by every listAllSystems() call so canDeleteSystem() (a synchronous
// toolbar-state check) can look up the currently-selected system's ownership
// without a fresh fetch.
let systemsCatalog = new Map();

async function listAllSystems() {
  if (!dataManager) return [];
  const merged = new Map();
  // Workbench ships sys.dnd5e as a "builtin" — a static JSON file, not a row
  // in the systems DB table — so it never shows up in dataManager.list()
  // below on its own. Without this, the picker only ever shows Systems a
  // creator has actually saved, hiding the one every seed Location/Setting
  // already points at.
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
// builtin/shipped-as-a-static-file concept (unlike sys.dnd5e), they're
// always real saved "setting" Library records, authored in Sanctum.
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

// Owner-or-admin, same rule as everywhere else this session (Workbench's
// Template/Character delete gating): a System can be deleted by an admin
// regardless of ownership, or by whichever user actually owns it. Systems
// have no "shared with edit permission" concept today, unlike templates/
// characters, so ownership is the only non-admin path.
function systemAllowsDelete(id) {
  if (!id) return false;
  if (dataManager?.getUserTier() === "admin") return true;
  if (systemsCatalog.get(id)?.ownership === "builtin") return false;
  return allowsDelete(systemsCatalog, id, { dataManager });
}

// --- Library: browse/edit every saved entity of any kind --------------------
// The Entities panel above only ever shows the CURRENT mapping's fresh
// output — this is the only place a previously-saved entity can be reopened,
// edited directly as JSON, and assigned to (or removed from) Systems. The
// left-pane "Library Contents" Type + Item select (see the Library contents
// section above) is the ONE picker driving this editor — there's no separate
// Kind/Entity select here anymore, so picking an item on the left is what
// loads it below and in the right-pane inspector.

// Ownership metadata for each kind's entries, refreshed whenever an entity is
// loaded for editing — same "cache for a synchronous toolbar check" role as
// systemsCatalog above. Keyed by "kind:id" since ids aren't guaranteed unique
// across kinds.
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

// Owner-or-admin, same rule as the Systems tab (systemAllowsDelete) and
// Workbench's Template/Character delete gating — every kind has ownership
// now.
function libraryEntryAllowsDelete(kind, id) {
  if (!kind || !id) return false;
  return allowsDelete(libraryEntryCatalog, `${kind}:${id}`, { dataManager });
}

async function populateLibrarySystemCheckboxes(selectedIds) {
  if (!librarySystemList) return;
  // A System entity can't be assigned to itself — nonsensical the same way
  // a Template can't apply to non-character kinds (see
  // populateLibraryTemplateSelect's isCharacter check just below).
  const isSystemKind = loomLibraryTableState.activeKind === "system";
  if (librarySystemSection) {
    // Plain `.hidden` silently loses to this wrapper's own `.d-flex`
    // (Bootstrap's `display: flex !important`) — same bug/fix as Press's
    // own setElementVisible: an inline `!important` style is the one thing
    // guaranteed to win regardless of class order.
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

// Byte-for-byte parallel to populateLibrarySystemCheckboxes above — a
// Setting entity can't be assigned to itself, same reasoning as System.
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
// entity's assigned Systems are offered, the same cascading-select pattern
// Sanctum's System > Setting > Location pickers use. Only shown for the
// "character" kind — the other kinds have no Workbench Template concept.
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
      // The templates bucket now also holds Press's print templates
      // (category: "print") — irrelevant to "which Workbench Template does
      // this character open with", so only character templates are offered.
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
        // Assigned Systems (systemIds) instead of the old singular `system`
        // field — that legacy key is gone; Assigned Systems (the same
        // librarySystemList checkboxes above) is the one mechanism every
        // Library kind uses for "which System(s) does this apply to" now.
        // Additive only (never removes an already-assigned System the
        // author picked independently of the Template cascade).
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

// --- Macro Actions editor (Library tab, kind "macro" only) -----------------
// Same kind-gated-section pattern as populateLibraryTemplateSelect above,
// authoring the exact actions:[] array runMacro() (macro-runner.js) reads
// at execution time. Type/label/action metadata comes from the shared
// MACRO_ACTION_CATALOG (macro-action-catalog.js) — the same registry
// macro-runner.js's own per-step toasts read — plus one more thing only
// this authoring UI needs: which kind of `target` field (if any) each type
// takes. No `target` for Clock/Calendar — see their own *_MACRO_ACTIONS
// comment: there's no portable "which one" to author into a shared macro,
// only "whichever is currently shown to the table," resolved at run time
// (dashboard.js's findActiveWidgetInstance).
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

function macroTextInput(value, placeholder, onChange) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control form-control-sm";
  if (placeholder) input.placeholder = placeholder;
  input.value = value ?? "";
  input.addEventListener("change", () => onChange(input.value));
  return input;
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
// <select> populated via fetchKindEntriesWithIds, never a modal picker. This
// used to be two different patterns (an inline select for Character/
// Encounter, a "Choose…" button opening openContentPicker for Handout/Map);
// unified onto the inline-select shape since it's what every other
// reference field here already used, and a modal adds a click for no benefit
// once the list is short enough to live in a dropdown (the same content
// picker Handout/Map's own live widgets use for their initial "add" step,
// where the list can be much longer, keeps the modal — this is Loom's
// authoring-time editor, not that picker).
function macroKindEntitySelect(kind, currentValue, onChange, { leadingOption } = {}) {
  const blank = leadingOption || { value: "", label: kind ? "Select…" : "Pick a kind first…" };
  const select = macroSelect([blank], currentValue || blank.value, onChange);
  select.disabled = !kind;
  if (dataManager && kind) {
    void fetchKindEntriesWithIds(dataManager, kind)
      .then((entries) => {
        const current = select.value || currentValue || blank.value;
        select.innerHTML = "";
        [blank, ...entries.map(({ id, entity }) => ({ value: id, label: entity?.name || entity?.title || id }))].forEach(
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
        // Restricted to what Handout can actually render (HANDOUT_KINDS,
        // imported from handout.js) — not every Library kind. This used to
        // offer the full kind list, which meant most choices would 404 at
        // run time; picking a real kind from Handout's own actual palette
        // is a matching-precedent fix, not just a smaller list.
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
// editing (unlike the Systems tab's own Properties, which nest arbitrarily
// deep and so read straight from the DOM instead via collectSystemProperties;
// a flat actions array has no such need). newMacroEditor/loadMacroIntoEditor/
// applyMacroSnapshot all reset this before re-rendering.
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
  removeButton.title = "Remove action";
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
  // macro exists, its id is how a shared record and any future reference to
  // it stay stable.
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
    // preferLocal: false — same reasoning as loadSystemIntoEditor: this is
    // the authoritative editor for macro content, so a stale local cache
    // entry silently winning over the current server file would mean a
    // resave here reverts whatever's actually on the server.
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
    entries = await fetchKindEntriesWithIds(dataManager, "macro");
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
    .sort((a, b) => (a.entity?.name || a.id).localeCompare(b.entity?.name || b.id))
    .forEach(({ id, entity }) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = entity?.name || id;
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
      id,
      name: (macroNameInput?.value || "").trim() || id,
      icon: (macroIconInput?.value || "").trim() || "tabler:bolt",
      actions: macroEditorActions,
    };
    try {
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
  // is how everything else (Systems' Assigned entries, Templates, share
  // records) refers to it, so changing it later would silently break those
  // references.
  if (libraryIdInput) {
    libraryIdInput.value = "";
    libraryIdInput.disabled = false;
  }
  if (libraryJsonTextarea) libraryJsonTextarea.value = "{}";
  populateLibrarySystemCheckboxes([]);
  populateLibrarySettingCheckboxes([]);
  populateLibraryTemplateSelect({});
  if (reveal) setLibraryFormVisible(true);
  markClean("library");
}

async function loadLibraryEntry(kind, id) {
  try {
    // preferLocal: false — Loom is the authoritative editor for Library
    // content, and every load here feeds a load-then-save round trip
    // (edit the JSON textarea, hit Save). A stale local cache entry (left
    // over from an earlier save made by this same browser, anonymous or
    // not) silently winning over the current server file would mean this
    // resave reverts whatever's actually on the server — including any
    // fix applied directly to the file, or a change made from a different
    // tab/session — without any visible sign anything was wrong. Read-only
    // display lookups elsewhere in Loom (e.g. populateValueEntitySelect)
    // don't carry this risk, since nothing gets written back from them.
    const entity = (await dataManager?.get(kind, id, { preferLocal: false }))?.payload;
    if (!entity) throw new Error("Not found");
    setLibraryFormVisible(true);
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
    // A 404 means the library_items row has no backing file at all — an
    // orphan (a row registered — e.g. by an old test that wrote straight to
    // the DB — with nothing ever saved to match it). There's no content to
    // lose, so clean it up automatically instead of leaving a dead entry the
    // user can never remove: the id field never got set above (the throw
    // happens before that), so canDeleteLibrary() had nothing correct to act
    // on and the Delete button stayed disabled.
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
    // stale id/state from whatever was loaded before — set the id so a
    // manual Delete at least has the right target, same as the success path.
    // Reveals the panel too, since that Delete button lives inside it.
    setLibraryFormVisible(true);
    if (libraryIdInput) {
      libraryIdInput.value = id;
      libraryIdInput.disabled = true;
    }
    updateToolbarState();
    status?.show(`Unable to load ${kind}/${id}: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

// Called by both the Type and Item select's own "change" listeners (see the
// Library Contents section above) — whichever one changed, this loads
// whatever is now selected into the editor below, or resets to a blank "new
// entity of this Type" state if nothing (existing) is selected.
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

// Toggling a System checkbox writes straight back into the JSON textarea
// (rather than merging on save) so the textarea always stays the single
// source of truth for what's about to be saved.
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
// Assigned Systems' matching Properties (an array field whose entityKind
// matches this entity's kind, with a values entry whose name matches this
// entity's own name and no entityId yet). This is what keeps a System's
// roster pointing at real data without requiring every link to be made by
// hand in the Systems tab — but only when the match is unambiguous
// (exactly one candidate); anything else is left for manual linking there.
function findEntityKindFields(fields, kind, matches = []) {
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    if (field?.type === "array" && field.entityKind === kind && Array.isArray(field.values)) {
      matches.push(field);
    }
    if (Array.isArray(field?.children)) findEntityKindFields(field.children, kind, matches);
    if (Array.isArray(field?.item?.children)) findEntityKindFields(field.item.children, kind, matches);
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
    findEntityKindFields(payload.fields, kind).forEach((field) => {
      field.values.forEach((entry) => {
        if (
          entry &&
          typeof entry === "object" &&
          !entry.entityId &&
          (entry.name || "").trim().toLowerCase() === entityName
        ) {
          matchCount += 1;
          matchedEntry = entry;
        }
      });
    });
    if (matchCount === 1 && matchedEntry) {
      matchedEntry.entityId = id;
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
    // Every character needs at least one Assigned System (systemIds) — the
    // Systems checkbox list right above already writes straight into this
    // same JSON textarea (see librarySystemList's own "change" handler), so
    // this only ever fires if the GM saves a brand-new character without
    // checking any of them first. Library's own generic newLibraryEntry()
    // starts every kind blank, character included, so there's nothing
    // upstream that already guarantees this the way saveEntity's own DDB-
    // import default does (Mapping tool, above).
    if (kind === "character" && (!Array.isArray(entity.systemIds) || !entity.systemIds.length)) {
      status?.show("Check at least one Assigned System before saving a character.", { type: "warning", timeout: 3000 });
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
// plus whichever Library entities are assigned to it (from the Library panel
// above). Storage is unchanged from Workbench's own System Editor: the same
// DataManager "systems" bucket, same tier gating, same sharing.

// Object properties get a recursive "Sub-fields" list (their own nested
// property rows, e.g. Abilities > Strength/Dexterity/...); Array properties
// are either Enum mode — a flat, System-defined list of fixed choices, the
// same for every record (Rarity, Combat Bindings' own entries) — or Records
// mode, a per-record repeating structure whose *shape* (not values) the
// System defines (Inventory > Name/Quantity/Weight/Notes; each character has
// its own different actual items). Both nesting shapes reuse this same row
// renderer for their children, so the tree can go arbitrarily deep even
// though nothing in this codebase's real data needs more than one level.
// Combat Bindings isn't a field type of its own, or even a flagged field —
// it's just whichever ordinary Enum-mode array field's values happen to use
// the Role column (see common/js/lib/bindings.js's findRoleBoundField),
// so common/js/lib/widgets/combat-tracker.js and Workbench's character view
// can find it without assuming a fixed key name or needing a separate marker
// checkbox. Role/Binding/Source field describe generic behavior (a resource
// with a ceiling, a standalone value, a tag list, a roll modifier), a
// generic @-path pointer, and a generic pointer at another array field —
// useful on any array's values, not only a System's live combat state. A
// role's own extra metadata that's still just a single field's own quirk
// (Resource's max/temp path, Modifier's die) isn't a dedicated column —
// it's authored in that value's "Extra properties" JSON instead.
// Per-value columns worth a dedicated, structured input because the same
// property name recurs across several System fields (cost/targetBudget:
// rarity+activation+form+combatScaling; sourceId: conditions+alignments+
// sizes+senses+speeds+components+skills+activation; shortName: alignments;
// entityId: classes). A property specific to just one field (combatScaling's
// hitPoints/armorClass/damagePerRound/attackBonus/saveDC) isn't promoted here
// — it stays in that value's "Extra properties" catch-all instead, since a
// bespoke checkbox for a single field's own stat block doesn't generalize
// and would clutter every other array field's options row.
//
// The last 3 (role/binding/sourceField) are general-purpose, not specific to
// any one field or consumer: `role` is a small fixed vocabulary describing
// *structural behavior*, not a game concept — resource (a number with a max,
// optionally a temp buffer), value (one standalone number), tags (a
// multi-select status list), or modifier (a number that feeds a roll) — any
// array's values can use it for whatever purpose calls for that shape.
// Whichever field's values happen to use it is what
// common/js/lib/widgets/combat-tracker.js and Workbench's character view
// read as a System's live play-state (see findRoleBoundField), but nothing
// requires that to be the only use. `binding` is a generic @-path pointer
// (see common/js/lib/bindings.js's resolveBinding/setAtBinding) into a
// character record — where a value's live data is read/written. `sourceField`
// is a different kind of pointer — the *key* of another array field on this
// same System whose values are the valid options for this value (e.g. a
// Tags-role value pointing at a Conditions field so its picker offers
// exactly this System's condition vocabulary) — not where data lives, but
// where the list of legal choices is defined. A role that needs more than
// one path (Resource's max/temp) or other single-field-specific metadata
// (Modifier's die) doesn't get its own dedicated column — that's authored
// directly in the value's "Extra properties" JSON catch-all instead, the
// same as any other field-specific property (see below).
// The shared row editor (common/js/lib/property-schema-editor.js) is
// undo/dirty-tracking-agnostic — this `ctx` is what plugs it into Loom's own
// whole-tab undo stack for the Systems tab specifically (SNAPSHOT_HANDLERS.
// system/recordUndoableChange/the Property Inspector below), exactly
// reproducing what used to be hardcoded inline before this editor was
// extracted into that shared module. Getters (not plain properties) for
// status/dataManager/filterSystemId since those module-level bindings are
// only assigned later, during init — a plain property captured here at
// module-eval time would freeze in at `null`.
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
  // Property Inspector integration (createPropertyInspector, instantiated
  // as systemPropertyInspector below) — a caller with no such panel simply
  // omits these three and nothing fires. Referencing systemPropertyInspector
  // here before its own declaration further down is safe: these arrow
  // functions only ever run later, from a click/input event, by which point
  // the whole module has finished evaluating.
  onRowSelected: (row) => systemPropertyInspector.selectRow(row),
  onRowChanged: (row) => {
    if (row === systemPropertyInspector.selectedRow) systemPropertyInspector.refresh();
  },
  onRowRemoved: (row) => {
    if (row === systemPropertyInspector.selectedRow) systemPropertyInspector.selectRow(null);
  },
};

// Thin, name-preserving wrappers around the shared editor, bound to
// systemPropertyCtx above and defaulting to this tab's own top-level
// container — every pre-existing call site elsewhere in this file keeps
// working completely unchanged after the extraction into a shared module.
function renderSystemPropertyRow(field = {}, container = systemPropertyRows) {
  return renderPropertyRow(field, container, systemPropertyCtx);
}
function initSystemPropertySortable(container) {
  return initPropertySortable(container, systemPropertyCtx);
}
function applySystemPropertyType(row, typeButton, value) {
  return applyPropertyType(row, typeButton, value, systemPropertyCtx);
}
function collectSystemProperties() {
  return collectProperties(systemPropertyRows, systemPropertyCtx);
}

// The one place that assembles a full System record from the editor's
// current form state — used by both the Save handler and the live JSON
// Preview panel below, so JSON Preview is guaranteed to show exactly what
// Save actually writes.
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

// Existing ids come straight off the System <select>'s own already-
// populated options (populateSystemSelect) — no separate catalog needed,
// unlike Workbench's Template duplicate (which tracks its own
// templateCatalog Map for other reasons); this is the one place Loom's
// System editor needs an "all known ids" list at all.
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
    (snapshot.properties || []).forEach((field) => renderSystemPropertyRow(field));
  }
  // Undo/redo rebuilds every row from scratch — whatever was selected before
  // is now a detached DOM node representing (at best) the same logical
  // property, not a meaningful selection to keep pointing at.
  systemPropertyInspector.selectRow(null);
}

// --- Property Inspector (right pane) ---------------------------------------
// A second, more spacious editing surface for whichever property row is
// currently selected in the Properties list — the list itself is untouched,
// this is purely additive. Shared factory (common/js/lib/property-schema-
// editor.js's createPropertyInspector) — Group's own Properties tab gets the
// exact same mechanism below (New/Delete/Duplicate/Required toolbar, per-
// type field proxies, Up/Down keyboard navigation), not a hand-duplicated
// second copy.

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

// Group Properties had no right-pane panel of its own before this — wired
// here (rather than inline on the groupPropertyCtx object literal above)
// since groupPropertyInspector doesn't exist yet at that point in the file.
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

// `reveal` defaults to true (an explicit New click, a select reset to
// blank, or Delete's own "stay in a fresh draft" flow — all real user
// actions that should show the form) — the one caller that suppresses it is
// the page-load init below, which primes this editor's own state without
// yet showing anything, matching Groups/Users' own default "nothing
// selected yet" state.
function newSystemEditor({ reveal = true } = {}) {
  // Only a not-yet-saved System gets a typeable Id — once it exists, the id
  // is how Library entities' Assigned Systems and Templates refer to it, so
  // changing it later would silently break those references.
  if (systemIdInput) {
    systemIdInput.value = "";
    systemIdInput.disabled = false;
  }
  if (systemTitleInput) systemTitleInput.value = "";
  if (systemVersionInput) systemVersionInput.value = "0.1";
  if (systemPropertyRows) systemPropertyRows.innerHTML = "";
  systemPropertyInspector.selectRow(null);
  if (reveal) setSystemFormVisible(true);
  markClean("system");
}

async function loadSystemIntoEditor(id) {
  if (!dataManager) return;
  try {
    // preferLocal: false — this is the editor a creator uses specifically
    // to fix a System's data; it must never show a stale locally-cached copy
    // (e.g. from an earlier save this same browser made before a bug like
    // this one was fixed) instead of what's actually on the server. Same
    // reasoning as combat-tracker.js's System reads.
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
      (payload.fields || []).forEach((field) => renderSystemPropertyRow(field));
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

// Clones the CURRENTLY LOADED/edited System in place — id/title/version/
// Preview Data/every Property row stay exactly as they are on screen, only
// the id (which must be unique) and title get a "-copy"/"(Copy)" suffix.
// Deliberately doesn't round-trip through buildSystemPayload/
// collectSystemProperties + re-render — the rows are already right there in
// the DOM, so this only needs to touch Id/Title and re-enable Id for
// editing (same as any other not-yet-saved draft). Matches this editor's
// own simpler, non-modal "New System" flow (no id/title prompt dialog, just
// pre-filled fields the user reviews before Save) rather than Workbench
// Template's modal-based duplicate.
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
// One persistent instance — unlike nested Sub-fields/Record fields
// containers (created fresh per row in renderSystemPropertyRow), this
// top-level container itself is never recreated, only its children (see
// loadSystemIntoEditor/newSystemEditor's `innerHTML = ""` + re-render), so
// it only needs wiring once.
initSystemPropertySortable(systemPropertyRows);

// Delegated add/remove-property/sub-field/record-field/value handling, plus
// (via systemPropertyCtx's own onRowSelected/onRowChanged/onRowRemoved)
// Property Inspector selection/refresh — all now the shared editor's own
// common/js/lib/property-schema-editor.js implementation, see that module's
// own header for why every recordUndoableChange("system", ...) call that
// used to be inline here is unchanged in effect, just routed through
// systemPropertyCtx.runChange instead.
wirePropertyContainerEvents(systemPropertyRows, systemPropertyCtx);

if (systemSaveButton) {
  systemSaveButton.addEventListener("click", async () => {
    if (!dataManager) return;
    const payload = buildSystemPayload();
    if (!payload.id) {
      status?.show("System id is required.", { type: "error", timeout: 3000 });
      return;
    }
    try {
      await dataManager.save("systems", payload.id, payload);
      status?.show(`Saved system ${payload.id}.`, { type: "success", timeout: 2000 });
      await populateSystemSelect();
      systemSelect.value = payload.id;
      await populateLibrarySystemCheckboxes(currentLibraryEntity()?.systemIds);
      markClean("system");
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
      // Covers an orphaned local-only record, or a listed system whose
      // remote delete fails (e.g. a DB row with no matching file) — either
      // way, a "not found" system otherwise has no way to leave the picker.
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
// listAvailableMappings now imported from content-fetch.js (shared with
// Workbench's own player-facing Import Character picker, via
// listCharacterMappings) — see that module's own comment.

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

// Switching mappings changes what shape of data is expected entirely — a
// class fetch means nothing to a species mapping — so the raw input, the
// source-fetch value, and (via rerenderAll -> runLivePreview) the mapped
// output and Entities pane all reset rather than re-running the new mapping
// against leftover data from a different shape.
function resetRawData() {
  sampleData = {};
  if (sourceValueInput) sourceValueInput.value = "";
  if (sourceFileInput) sourceFileInput.value = "";
  if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
}

async function loadMapping(id) {
  const url = new URL(`../mappings/${id}.json`, import.meta.url);
  // no-store: mapping files get edited/saved iteratively (including from
  // outside the browser), so a stale cached copy silently showing old
  // behavior is worse than the extra round trip every load costs.
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  mappingDefinition = await response.json();
  currentMappingId = id;
  selectedNode = null;
  // Only mapping-type entries — the undo stack is shared across every tab
  // now, so a plain clear() here would also wipe Library/System history that
  // has nothing to do with switching mappings.
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
      status?.show(`Loaded ${id}.`, { type: "success", timeout: 1500 });
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

// Same dirty checks the Save buttons already use — Loom had no guard at
// all against navigating/closing away from unsaved edits (unlike
// Workbench, which already had this).
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
    // Unconditional — Data Source is never disabled/locked (see
    // applySourceSelection's own comment), so whatever's currently selected
    // always wins on save, the same as Data Type below.
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

  // Loom edits shared suite-wide data (Library entities, Systems, and now
  // DB-backed Characters, Campaign Groups, and user tiers) — gated to gm+ for
  // the whole tool, not just individual save actions, so anonymous/simple-tier
  // visitors can't view or edit any of it. This is a whole-page gate (unlike
  // Workbench's per-tab gating), since Loom has no ungated view worth showing
  // partially. Individual tabs above this floor are further gated by
  // updateLoomTabAvailability() below — GM sees only Groups, Creator adds
  // Import/Library/Systems, Admin adds Users.
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

  // preferLocal: false — a fellow author's edit to sys.dnd5e's fields
  // (adding/renaming a condition, alignment, skill, ...) must be visible
  // immediately in this session's mapping preview, not hidden behind a
  // stale local cache. Same convention as combat-tracker.js's System reads.
  try {
    const dnd5eSystem = await dataManager.get("system", "sys.dnd5e", { preferLocal: false });
    const lookupTables = deriveLookupTables(dnd5eSystem?.payload);
    ddbLookupContext = { lookupTables, customFunctions: createMappingCustomFunctions(lookupTables) };
  } catch (error) {
    // Mapping tab still works for editing structure; `lookup()` calls in the
    // live preview just resolve blank until this can be retried.
  }

  // Also picks the first available tab if the static HTML's default active
  // tab (Import) isn't available at this session's tier — see its own
  // comment for the GM/Creator/Admin breakdown.
  updateLoomTabAvailability();

  if (undoButton) undoButton.addEventListener("click", () => shell.undo());
  if (redoButton) redoButton.addEventListener("click", () => shell.redo());

  sampleData = {};
  if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
  await populateMappingSelect();
  enterMappingMode(mappingDefinition);
  markClean("mapping");
  rerenderAll();
  loadRecentSaves();

  // reveal: false on all three — this just primes each editor's own blank-
  // draft state so it's ready the instant something is picked; the panel
  // itself stays behind its "Select a ..." message (see setSystemFormVisible
  // and its Macro/Library equivalents) until a real user action (a select
  // change, New, or a deep link below) explicitly reveals it.
  newLibraryEntry({ reveal: false });

  await populateSystemSelect();
  newSystemEditor({ reveal: false });

  newMacroEditor({ reveal: false });

  // Deep link from the Dashboard's Board widget (board.js's own
  // renderMacroButtonCard) — clicking a macro-button card while rearranging
  // the layout lands here instead of running it for real, already on the
  // Macros tab with that macro loaded, so editing it is one click away
  // instead of a manual tab-and-select.
  // Runs after updateLoomTabAvailability() above so the tab is already
  // visible for this session's tier by the time setLoomView fires.
  const deepLinkMacroId = new URLSearchParams(window.location.search).get("macro");
  if (deepLinkMacroId) {
    setLoomView("macros");
    await populateMacroSelect();
    if (macroRecordSelect) macroRecordSelect.value = deepLinkMacroId;
    await loadMacroIntoEditor(deepLinkMacroId);
  }

  initHelpSystem({ root: document });
  refreshTooltips(document);
}

init();
