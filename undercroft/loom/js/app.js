import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initTierGate } from "../../common/js/lib/access.js";
import { updateJsonPreview, formatSize } from "../../common/js/lib/json-preview.js";
import { bindCollapsibleToggle, setCollapsibleState } from "../../common/js/lib/collapsible.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { applyMapping } from "../../common/js/lib/mapping-engine.js";
import { LOOKUP_TABLES } from "../../common/js/lib/lookup-tables.js";
import { customFunctions } from "../../common/js/lib/mapping-custom-functions.js";
import { loadSourceDataRaw, loadLibraryKinds, fetchKindEntriesWithIds } from "../../common/js/lib/content-fetch.js";

const SOURCES = [
  {
    id: "ddb",
    label: "D&D Beyond",
    valueLabel: "Character ID or URL",
    placeholder: "e.g. 123456789, or https://www.dndbeyond.com/classes/2190875-barbarian",
    helpTopic: "loom.source.ddb",
  },
  {
    id: "srd",
    label: "5e API",
    valueLabel: "API Endpoint or URL",
    placeholder: "e.g. /api/2024/classes/barbarian",
    helpTopic: "loom.source.srd",
  },
];

const mappingSelect = document.querySelector("[data-mapping-select]");
const mappingsToggle = document.querySelector("[data-mappings-toggle]");
const mappingsPanel = document.querySelector("[data-mappings-panel]");
const nodePalette = document.querySelector("[data-node-palette]");
const stepPaletteSection = document.querySelector("[data-step-palette-section]");
const stepPalette = document.querySelector("[data-step-palette]");
const sampleDataInput = document.querySelector("[data-sample-data-input]");
const sampleDataApplyButton = document.querySelector("[data-sample-data-apply]");
const sourceSelect = document.querySelector("[data-source-select]");
const sourceValueInput = document.querySelector("[data-source-value]");
const sourceValueLabelRow = document.querySelector("[data-source-value-label-row]");
const sourceFetchButton = document.querySelector("[data-source-fetch]");
const entitiesSummary = document.querySelector("[data-entities-summary]");
const entitiesList = document.querySelector("[data-entities-list]");
const entitiesToggle = document.querySelector("[data-entities-toggle]");
const entitiesPanel = document.querySelector("[data-entities-panel]");
const ioToggle = document.querySelector("[data-io-toggle]");
const ioPanel = document.querySelector("[data-io-panel]");
const recentSavesContainer = document.querySelector("[data-recent-saves]");
const recentSavesRefreshButton = document.querySelector("[data-recent-saves-refresh]");
const treeContainer = document.querySelector("[data-mapping-tree]");
const treeToggle = document.querySelector("[data-mapping-tree-toggle]");
const treePanel = document.querySelector("[data-mapping-tree-panel]");
const inspectorContainer = document.querySelector("[data-inspector]");
const rawPreviewEl = document.querySelector("[data-raw-preview]");
const mappedPreviewEl = document.querySelector("[data-mapped-preview]");
const undoButton = document.querySelector('[data-action="undo-mapping"]');
const redoButton = document.querySelector('[data-action="redo-mapping"]');
const newButton = document.querySelector('[data-action="new-mapping"]');
const saveButton = document.querySelector('[data-action="save-mapping"]');
const renameButton = document.querySelector('[data-action="rename-mapping"]');

// --- Library / Systems / Places DOM refs ------------------------------------

const libraryToggle = document.querySelector("[data-library-toggle]");
const libraryPanel = document.querySelector("[data-library-panel]");
const libraryKindSelect = document.querySelector("[data-library-kind-select]");
const libraryEntrySelect = document.querySelector("[data-library-entry-select]");
const libraryIdInput = document.querySelector("[data-library-id]");
const librarySystemList = document.querySelector("[data-library-system-list]");
const libraryTemplateSection = document.querySelector("[data-library-template-section]");
const libraryTemplateSelect = document.querySelector("[data-library-template-select]");
const libraryJsonTextarea = document.querySelector("[data-library-json]");
const libraryNewButton = document.querySelector("[data-library-new]");
const librarySaveButton = document.querySelector("[data-library-save]");
const libraryDeleteButton = document.querySelector("[data-library-delete]");

const systemsToggle = document.querySelector("[data-systems-toggle]");
const systemsPanel = document.querySelector("[data-systems-panel]");
const systemSelect = document.querySelector("[data-system-select]");
const systemIdInput = document.querySelector("[data-system-id]");
const systemTitleInput = document.querySelector("[data-system-title]");
const systemVersionInput = document.querySelector("[data-system-version]");
const systemPreviewInput = document.querySelector("[data-system-preview]");
const systemPreviewBytesEl = document.querySelector("[data-system-preview-bytes]");
const systemPropertyRows = document.querySelector("[data-system-property-rows]");
const systemNewButton = document.querySelector("[data-system-new]");
const systemSaveButton = document.querySelector("[data-system-save]");
const systemDeleteButton = document.querySelector("[data-system-delete]");
const systemAddPropertyButton = document.querySelector("[data-system-add-property]");

const placesToggle = document.querySelector("[data-places-toggle]");
const placesPanel = document.querySelector("[data-places-panel]");
const placesSystemSelect = document.querySelector("[data-places-system-select]");
const placesSettingSelect = document.querySelector("[data-places-setting-select]");
const placesLocationSelect = document.querySelector("[data-places-location-select]");
const placesNewSettingButton = document.querySelector("[data-places-new-setting]");
const placesNewLocationButton = document.querySelector("[data-places-new-location]");
const placesSaveButton = document.querySelector("[data-places-save]");
const placesDeleteLocationButton = document.querySelector("[data-places-delete-location]");
const settingNameInput = document.querySelector("[data-setting-name]");
const settingDescriptionInput = document.querySelector("[data-setting-description]");
const locationNameInput = document.querySelector("[data-location-name]");
const locationWeightRows = document.querySelector("[data-location-weight-rows]");
const locationWeightTotal = document.querySelector("[data-location-weight-total]");
const locationAddSpeciesButton = document.querySelector("[data-location-add-species]");
const locationMixingCoefficientInput = document.querySelector("[data-location-mixing-coefficient]");
const locationMixingCoefficientValue = document.querySelector("[data-location-mixing-coefficient-value]");
const locationArchetypeRows = document.querySelector("[data-location-archetype-rows]");
const locationAddArchetypeOverrideButton = document.querySelector("[data-location-add-archetype-override]");
const locationFallbackRows = document.querySelector("[data-location-fallback-rows]");
const locationAddFallbackNameButton = document.querySelector("[data-location-add-fallback-name]");

const CUSTOM_FUNCTION_NAMES = Object.keys(customFunctions);
const PROPERTY_TYPES = ["string", "number", "boolean", "object", "array"];

let mappingDefinition = null;
let selectedNode = null;
let sampleData = {};
let currentMappingId = null;
let isApplyingHistory = false;
let dataManager = null;
let placesSpeciesOptions = []; // [{id, label}] species assigned to the currently selected Places System
let currentSettingId = null;
let currentLocationId = null;
let editingSystemImporters = [];
let undoStack = null;
let status = null;
let lastMappedResult = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Undo/redo -------------------------------------------------------------
// One shared undo stack across every tab (Import/Library/Systems/Places) —
// the toolbar's Undo/Redo pair is always visible (see setLoomView) and
// dispatches by each pushed entry's `type` to the matching tab's
// create/apply-snapshot pair below. Whole-form JSON snapshots per domain,
// mirroring press/js/app.js's recordUndoableChange pattern: cheap to
// diff/clone at this scale, and side-steps having to track stable node/row
// identity across undo/redo (selection/focus just resets, same as the
// original mapping-only version already did). The Library/System/Places
// create/apply functions are declared further down (with the rest of each
// tab's own logic) — referencing them here works because `function`
// declarations hoist fully, unlike `const`.
const SNAPSHOT_HANDLERS = {
  mapping: { create: createMappingSnapshot, apply: applyMappingSnapshot },
  library: { create: createLibrarySnapshot, apply: applyLibrarySnapshot },
  system: { create: createSystemSnapshot, apply: applySystemSnapshot },
  places: { create: createPlacesSnapshot, apply: applyPlacesSnapshot },
};

// --- Save/Rename/Delete gating -----------------------------------------
// "Clean" baseline per tab (the state at last load/new/save) — reuses the
// same per-type snapshot functions undo/redo already has, so dirty-checking
// doesn't need its own parallel tracking. Save only lights up once the
// current state actually differs from that baseline; Rename/Delete only
// need a real, currently-loaded item (an id), not necessarily a change.
const cleanSnapshots = { mapping: null, library: null, system: null, places: null };

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
  const kind = libraryKindSelect?.value || "";
  const id = (libraryIdInput?.value || "").trim();
  return Boolean(kind && id && currentLibraryEntity()) && isDirty("library");
}

function canDeleteLibrary() {
  const id = libraryEntrySelect?.value;
  if (!id) return false;
  return libraryEntryAllowsDelete(libraryKindSelect?.value, id);
}

function canSaveSystem() {
  return Boolean((systemIdInput?.value || "").trim()) && isDirty("system");
}

function canDeleteSystem() {
  return systemAllowsDelete(systemSelect?.value);
}

function canSavePlaces() {
  if (!placesSystemSelect?.value) return false;
  const hasSettingTarget =
    Boolean((settingNameInput?.value || "").trim()) || Boolean(currentSettingId || placesSettingSelect?.value);
  return hasSettingTarget && isDirty("places");
}

function canDeleteLocation() {
  return Boolean(currentLocationId || placesLocationSelect?.value);
}

function updateToolbarState() {
  if (saveButton) saveButton.disabled = !canSaveMapping();
  if (renameButton) renameButton.disabled = !canRenameMapping();
  if (librarySaveButton) librarySaveButton.disabled = !canSaveLibrary();
  if (libraryDeleteButton) libraryDeleteButton.disabled = !canDeleteLibrary();
  if (systemSaveButton) systemSaveButton.disabled = !canSaveSystem();
  if (systemDeleteButton) systemDeleteButton.disabled = !canDeleteSystem();
  if (placesSaveButton) placesSaveButton.disabled = !canSavePlaces();
  if (placesDeleteLocationButton) placesDeleteLocationButton.disabled = !canDeleteLocation();
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
// version/property rows, Places' setting/location fields) can't be wrapped
// in recordUndoableChange the way a button click can — the browser already
// mutated the field by the time any listener fires. Instead this snapshots
// on focus-in (before the edit) and compares against a snapshot on commit
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
    inspectorContainer.appendChild(
      document.createElement("p")
    ).textContent = "Use the Node Palette on the left to add children to this node.";
    inspectorContainer.lastChild.className = "small text-body-secondary";
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

if (treeToggle && treePanel) {
  bindCollapsibleToggle(treeToggle, treePanel, {
    collapsed: false,
    expandLabel: "Expand mapping tree",
    collapseLabel: "Collapse mapping tree",
  });
}

if (mappingsToggle && mappingsPanel) {
  bindCollapsibleToggle(mappingsToggle, mappingsPanel, {
    collapsed: false,
    expandLabel: "Expand selection",
    collapseLabel: "Collapse selection",
  });
}

if (entitiesToggle && entitiesPanel) {
  bindCollapsibleToggle(entitiesToggle, entitiesPanel, {
    collapsed: false,
    expandLabel: "Expand entities",
    collapseLabel: "Collapse entities",
  });
}

if (ioToggle && ioPanel) {
  bindCollapsibleToggle(ioToggle, ioPanel, {
    collapsed: false,
    expandLabel: "Expand data",
    collapseLabel: "Collapse data",
  });
}

// --- Workflow mode: a mapping with a fixed $source (already saved/loaded)
// locks the Data Source dropdown to that source and favors the Entities pane;
// a brand-new mapping (no $source yet) leaves Data Source selectable and
// favors the Mapping Tree instead. Input/Output stays expanded either way.
// This only fires on actual mode transitions (load/new/first-save), not on
// every small edit, so it doesn't fight the user's own manual collapse/expand.

function applySourceLock(source) {
  if (!sourceSelect) return;
  sourceSelect.disabled = Boolean(source);
  if (source) sourceSelect.value = source;
  const active = SOURCES.find((entry) => entry.id === sourceSelect.value) || SOURCES[0];
  if (sourceValueInput) sourceValueInput.placeholder = active.placeholder;
  renderSourceValueLabel(active);
}

function enterMappingMode(definition) {
  const source = definition && typeof definition === "object" ? definition.$source : null;
  applySourceLock(source || null);
  if (treeToggle && treePanel) {
    setCollapsibleState(treeToggle, treePanel, {
      collapsed: Boolean(source),
      expandLabel: "Expand mapping tree",
      collapseLabel: "Collapse mapping tree",
    });
  }
  if (entitiesToggle && entitiesPanel) {
    setCollapsibleState(entitiesToggle, entitiesPanel, {
      collapsed: !source,
      expandLabel: "Expand entities",
      collapseLabel: "Collapse entities",
    });
  }
  if (ioToggle && ioPanel) {
    setCollapsibleState(ioToggle, ioPanel, {
      collapsed: false,
      expandLabel: "Expand data",
      collapseLabel: "Collapse data",
    });
  }
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
    const result = applyMapping(mappingDefinition, sampleData, {
      lookupTables: LOOKUP_TABLES,
      customFunctions,
    });
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
  label.setAttribute("for", "loomSourceValue");
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
    renderSourceValueLabel(source);
  };
  sourceSelect.addEventListener("change", updateSourceUi);
  updateSourceUi();
}

if (sourceFetchButton) {
  sourceFetchButton.addEventListener("click", async () => {
    const source = SOURCES.find((entry) => entry.id === sourceSelect?.value) || SOURCES[0];
    const value = (sourceValueInput?.value || "").trim();
    if (!value) {
      status?.show("Enter a value to fetch.", { type: "warning", timeout: 2000 });
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
    await dataManager.save(entity.kind, id, entity.data);
    status?.show(`Saved ${entity.kind}/${id}.json.`, { type: "success", timeout: 2000 });
    await autoLinkEntityToSystems(entity.kind, id, entity.data);
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

if (libraryToggle && libraryPanel) {
  bindCollapsibleToggle(libraryToggle, libraryPanel, {
    collapsed: false,
    expandLabel: "Expand library",
    collapseLabel: "Collapse library",
  });
}
if (systemsToggle && systemsPanel) {
  bindCollapsibleToggle(systemsToggle, systemsPanel, {
    collapsed: false,
    expandLabel: "Expand systems",
    collapseLabel: "Collapse systems",
  });
}
if (placesToggle && placesPanel) {
  bindCollapsibleToggle(placesToggle, placesPanel, {
    collapsed: false,
    expandLabel: "Expand places",
    collapseLabel: "Collapse places",
  });
}

// --- View tabs (Import / Library / Systems / Places) ------------------------
// Same nav-pills convention as Press's Live Preview/Grid View tabs. Only the
// active view's cards show — in the main pane, AND in the left/right panes
// (the mapping toolbar/palette/sample-data on the left and the tree Inspector
// on the right are Import-only; Library/Systems/Places carry their own
// pickers/toolbars inline, so they don't need anything extra from either
// side pane).
const LOOM_VIEWS = ["import", "library", "systems", "places"];
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
}

if (loomViewTabsContainer) {
  loomViewTabsContainer.addEventListener("click", (event) => {
    const button = event.target.closest("[data-loom-view-tab]");
    if (!button) return;
    setLoomView(button.dataset.loomViewTab);
  });
}

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

// Owner-or-admin, same rule as everywhere else this session (Workbench's
// Template/Character delete gating): a System can be deleted by an admin
// regardless of ownership, or by whichever user actually owns it. Systems
// have no "shared with edit permission" concept today, unlike templates/
// characters, so ownership is the only non-admin path.
function systemAllowsDelete(id) {
  if (!id) return false;
  if (dataManager?.getUserTier() === "admin") return true;
  const metadata = systemsCatalog.get(id);
  if (!metadata || metadata.ownership === "builtin") return false;
  if (metadata.ownership === "local") return true;
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

// --- Library: browse/edit every saved entity of any kind --------------------
// The Entities panel above only ever shows the CURRENT mapping's fresh
// output — this is the only place a previously-saved entity can be reopened,
// edited directly as JSON, and assigned to (or removed from) Systems.

async function populateLibraryKindSelect() {
  if (!libraryKindSelect) return;
  const kinds = await loadLibraryKinds();
  const previous = libraryKindSelect.value;
  libraryKindSelect.innerHTML = "";
  kinds.forEach((kind) => {
    const option = document.createElement("option");
    option.value = kind.id;
    option.textContent = kind.label || kind.id;
    libraryKindSelect.appendChild(option);
  });
  if (kinds.some((kind) => kind.id === previous)) {
    libraryKindSelect.value = previous;
  }
}

// Every Library kind is DB-backed now (ownership, sharing, is_public — see
// server/storage.py's library_items table and load_kind_policy()), so the
// Library tab's kind/entry selects always go through the same DataManager
// path regardless of which kind is selected — bucket name and kind id are
// literally the same string now, so there's no more "is this kind DB-backed
// or a flat file" branch to maintain.

// Ownership metadata for each kind's entries, refreshed every
// populateLibraryEntrySelect() call — same "cache for a synchronous toolbar
// check" role as systemsCatalog above. Keyed by "kind:id" since ids aren't
// guaranteed unique across kinds.
let libraryEntryCatalog = new Map();

async function populateLibraryEntrySelect(kind) {
  if (!libraryEntrySelect) return;
  libraryEntrySelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "New / unsaved";
  libraryEntrySelect.appendChild(blank);
  if (!kind || !dataManager) return;
  try {
    const { remote } = await dataManager.list(kind, { refresh: true, includeLocal: false });
    const entries = dataManager.collectListEntries(remote, ["owned", "shared", "public", "items"]);
    entries.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      const label = entry.name || entry.title || entry.id;
      option.textContent = entry.category ? `${label} (${entry.category})` : label;
      libraryEntrySelect.appendChild(option);
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
  if (dataManager?.getUserTier() === "admin") return true;
  const metadata = libraryEntryCatalog.get(`${kind}:${id}`);
  if (!metadata) return false;
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

async function populateLibrarySystemCheckboxes(selectedIds) {
  if (!librarySystemList) return;
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

// Cascades from Assigned Systems above: only Templates built for one of this
// entity's assigned Systems are offered, matching Places' System > Setting >
// Location cascading pattern. Only shown for the "character" kind — the
// other kinds have no Workbench Template concept.
async function populateLibraryTemplateSelect(entity) {
  if (!libraryTemplateSection || !libraryTemplateSelect) return;
  const kind = libraryKindSelect?.value || "";
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
        if (chosen?.dataset.schema) entity.system = chosen.dataset.schema;
      } else {
        delete entity.template;
      }
      libraryJsonTextarea.value = JSON.stringify(entity, null, 2);
    });
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
    kind: libraryKindSelect?.value || "",
    id: libraryIdInput?.value || "",
    json: libraryJsonTextarea?.value || "",
  };
}

function applyLibrarySnapshot(snapshot) {
  if (!snapshot) return;
  if (libraryKindSelect) libraryKindSelect.value = snapshot.kind;
  if (libraryIdInput) libraryIdInput.value = snapshot.id;
  if (libraryJsonTextarea) libraryJsonTextarea.value = snapshot.json;
  if (libraryEntrySelect) libraryEntrySelect.value = snapshot.id;
  populateLibrarySystemCheckboxes(currentLibraryEntity()?.systemIds);
  populateLibraryTemplateSelect(currentLibraryEntity());
}

function newLibraryEntry() {
  if (libraryIdInput) libraryIdInput.value = "";
  if (libraryJsonTextarea) libraryJsonTextarea.value = "{}";
  populateLibrarySystemCheckboxes([]);
  populateLibraryTemplateSelect({});
  markClean("library");
}

async function loadLibraryEntry(kind, id) {
  try {
    const entity = (await dataManager?.get(kind, id))?.payload;
    if (!entity) throw new Error("Not found");
    if (libraryIdInput) libraryIdInput.value = id;
    if (libraryJsonTextarea) libraryJsonTextarea.value = JSON.stringify(entity, null, 2);
    await populateLibrarySystemCheckboxes(entity.systemIds);
    await populateLibraryTemplateSelect(entity);
    markClean("library");
  } catch (error) {
    status?.show(`Unable to load ${kind}/${id}: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

if (libraryKindSelect) {
  libraryKindSelect.addEventListener("change", async () => {
    await populateLibraryEntrySelect(libraryKindSelect.value);
    newLibraryEntry();
  });
}

if (libraryEntrySelect) {
  libraryEntrySelect.addEventListener("change", () => {
    const kind = libraryKindSelect?.value;
    const id = libraryEntrySelect.value;
    if (!kind || !id) {
      newLibraryEntry();
      return;
    }
    loadLibraryEntry(kind, id);
  });
}

if (libraryNewButton) {
  libraryNewButton.addEventListener("click", () => {
    recordUndoableChange("library", () => {
      if (libraryEntrySelect) libraryEntrySelect.value = "";
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
    const kind = libraryKindSelect?.value;
    const id = (libraryIdInput?.value || "").trim();
    if (!kind) {
      status?.show("Select a kind first.", { type: "warning", timeout: 2000 });
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
    try {
      if (!dataManager) throw new Error("Not signed in");
      await dataManager.save(kind, id, entity);
      status?.show(`Saved ${kind}/${id}.json.`, { type: "success", timeout: 2000 });
      await autoLinkEntityToSystems(kind, id, entity);
      await populateLibraryKindSelect();
      await populateLibraryEntrySelect(kind);
      if (libraryEntrySelect) libraryEntrySelect.value = id;
      loadRecentSaves();
      markClean("library");
    } catch (error) {
      status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// Shared by the Library, Systems, and Places delete buttons.
async function deleteLibraryEntry(kind, id) {
  if (!dataManager) throw new Error("Not signed in");
  await dataManager.delete(kind, id);
}

if (libraryDeleteButton) {
  libraryDeleteButton.addEventListener("click", async () => {
    const kind = libraryKindSelect?.value;
    const id = (libraryIdInput?.value || "").trim();
    if (!kind || !id) {
      status?.show("Select an entity to delete first.", { type: "warning", timeout: 2500 });
      return;
    }
    if (!window.confirm(`Delete ${kind}/${id}? This can't be undone.`)) return;
    try {
      await deleteLibraryEntry(kind, id);
      status?.show(`Deleted ${kind}/${id}.json.`, { type: "success", timeout: 2000 });
      if (libraryEntrySelect) libraryEntrySelect.value = "";
      newLibraryEntry();
      await populateLibraryKindSelect();
      await populateLibraryEntrySelect(kind);
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
// are either a flat Enum-values list (one per line — plenty for something
// like a Classes dropdown) or an Item schema (a recursive one-off "row" for
// the repeating element shape, e.g. Inventory > Name/Quantity/Weight/Notes,
// plus which of those is the Display field). Both nesting shapes reuse this
// same row renderer for their children, so the tree can go arbitrarily deep
// even though nothing in this codebase's real data needs more than one level.
function renderSystemPropertyRow(field = {}, container = systemPropertyRows) {
  if (!container) return null;
  const row = document.createElement("div");
  row.className = "border rounded-3 p-2 d-flex flex-column gap-2";
  const checkboxId = `system-prop-required-${Math.random().toString(36).slice(2)}`;
  const typeOptions = PROPERTY_TYPES.map(
    (type) => `<option value="${type}"${field.type === type ? " selected" : ""}>${type}</option>`
  ).join("");
  const arrayMode = field.item ? "item" : "values";
  row.innerHTML = `
    <div class="row g-2 align-items-center">
      <div class="col-6 col-md-3">
        <input class="form-control form-control-sm" placeholder="key (e.g. abilities.strength)" value="${escapeHtml(field.key || "")}" data-property-key />
      </div>
      <div class="col-6 col-md-3">
        <input class="form-control form-control-sm" placeholder="Label" value="${escapeHtml(field.label || "")}" data-property-label />
      </div>
      <div class="col-6 col-md-3">
        <select class="form-select form-select-sm" data-property-type>${typeOptions}</select>
      </div>
      <div class="col-6 col-md-2">
        <input class="form-control form-control-sm" placeholder="Category" value="${escapeHtml(field.category || "")}" data-property-category />
      </div>
      <div class="col-auto ms-auto">
        <button class="btn btn-outline-danger btn-sm" type="button" data-property-remove aria-label="Remove property">
          <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
        </button>
      </div>
    </div>
    <div class="row g-2 align-items-center">
      <div class="col-4 col-md-2">
        <input class="form-control form-control-sm" placeholder="Default" value="${escapeHtml(field.default ?? "")}" data-property-default />
      </div>
      <div class="col-4 col-md-2">
        <input class="form-control form-control-sm" type="number" placeholder="Min" value="${field.minimum ?? ""}" data-property-minimum />
      </div>
      <div class="col-4 col-md-2">
        <input class="form-control form-control-sm" type="number" placeholder="Max" value="${field.maximum ?? ""}" data-property-maximum />
      </div>
      <div class="col-auto form-check">
        <input class="form-check-input" type="checkbox" ${field.required ? "checked" : ""} id="${checkboxId}" data-property-required />
        <label class="form-check-label small" for="${checkboxId}">Required</label>
      </div>
    </div>
    <div class="d-flex flex-column gap-2 ps-3 border-start" data-system-object-section hidden>
      <div class="d-flex align-items-center justify-content-between gap-2">
        <span class="small fw-semibold text-body-secondary">Sub-fields</span>
        <button class="btn btn-outline-secondary btn-sm p-1" type="button" data-system-add-child aria-label="Add sub-field">
          <span class="iconify" data-icon="tabler:plus" aria-hidden="true"></span>
        </button>
      </div>
      <div class="d-flex flex-column gap-2" data-system-children></div>
    </div>
    <div class="d-flex flex-column gap-2 ps-3 border-start" data-system-array-section hidden>
      <div class="row g-2 align-items-center">
        <div class="col-6">
          <label class="small fw-semibold text-body-secondary mb-0">Array contents</label>
          <select class="form-select form-select-sm" data-property-array-mode>
            <option value="values"${arrayMode === "values" ? " selected" : ""}>Enum values</option>
            <option value="item"${arrayMode === "item" ? " selected" : ""}>Item schema</option>
          </select>
        </div>
        <div class="col-6">
          <label class="small fw-semibold text-body-secondary mb-0">Library kind (optional)</label>
          <input class="form-control form-control-sm" placeholder="e.g. class" value="${escapeHtml(field.entityKind || "")}" data-property-entity-kind />
        </div>
      </div>
      <div class="d-flex flex-column gap-1" data-system-values-section hidden>
        <div class="d-flex align-items-center justify-content-between gap-2">
          <label class="small text-body-secondary mb-0">Allowed values</label>
          <button class="btn btn-outline-secondary btn-sm p-1" type="button" data-system-add-value aria-label="Add value">
            <span class="iconify" data-icon="tabler:plus" aria-hidden="true"></span>
          </button>
        </div>
        <div class="d-flex flex-column gap-1" data-system-value-rows></div>
      </div>
      <div class="d-flex flex-column gap-2" data-system-item-section hidden>
        <div class="row g-2 align-items-center">
          <div class="col-6">
            <input class="form-control form-control-sm" placeholder="Item label" value="${escapeHtml(field.item?.label || "")}" data-item-label />
          </div>
          <div class="col-6">
            <input class="form-control form-control-sm" placeholder="Display field key (e.g. inventory[].name)" value="${escapeHtml(field.item?.displayField || "")}" data-item-display-field />
          </div>
        </div>
        <div class="d-flex align-items-center justify-content-between gap-2">
          <span class="small text-body-secondary">Item fields</span>
          <button class="btn btn-outline-secondary btn-sm p-1" type="button" data-system-add-item-child aria-label="Add item field">
            <span class="iconify" data-icon="tabler:plus" aria-hidden="true"></span>
          </button>
        </div>
        <div class="d-flex flex-column gap-2" data-system-item-children></div>
      </div>
    </div>
  `;
  container.appendChild(row);

  // Bootstrap's own utility classes are `!important` (the same "hidden +
  // d-none" workaround used throughout this codebase), so both need toggling
  // together — see setLoomView for the same pattern at the tab level.
  const typeSelect = row.querySelector("[data-property-type]");
  const objectSection = row.querySelector("[data-system-object-section]");
  const arraySection = row.querySelector("[data-system-array-section]");
  const arrayModeSelect = row.querySelector("[data-property-array-mode]");
  const valuesSection = row.querySelector("[data-system-values-section]");
  const itemSection = row.querySelector("[data-system-item-section]");

  const syncTypeSections = () => {
    const isObject = typeSelect.value === "object";
    const isArray = typeSelect.value === "array";
    objectSection.hidden = !isObject;
    objectSection.classList.toggle("d-none", !isObject);
    arraySection.hidden = !isArray;
    arraySection.classList.toggle("d-none", !isArray);
  };
  const syncArrayModeSections = () => {
    const isValues = arrayModeSelect.value === "values";
    valuesSection.hidden = !isValues;
    valuesSection.classList.toggle("d-none", !isValues);
    itemSection.hidden = isValues;
    itemSection.classList.toggle("d-none", isValues);
  };
  typeSelect.addEventListener("change", syncTypeSections);
  arrayModeSelect.addEventListener("change", syncArrayModeSections);
  syncTypeSections();
  syncArrayModeSections();

  const childrenContainer = row.querySelector("[data-system-children]");
  (field.children || []).forEach((child) => renderSystemPropertyRow(child, childrenContainer));

  const itemChildrenContainer = row.querySelector("[data-system-item-children]");
  (field.item?.children || []).forEach((child) => renderSystemPropertyRow(child, itemChildrenContainer));

  // A values entry can link straight to a real Library entity of the
  // declared Library kind, instead of just being a hand-typed display
  // string — this is what lets a System stay the source of truth for the
  // roster (names, order, which ones are still just placeholders) while
  // pointing directly at real data once it exists, rather than duplicating
  // it. Re-populated whenever the Library kind changes.
  const entityKindInput = row.querySelector("[data-property-entity-kind]");
  const valueRowsContainer = row.querySelector("[data-system-value-rows]");
  (Array.isArray(field.values) ? field.values : []).forEach((entry) =>
    renderSystemValueRow(entry, valueRowsContainer, field.entityKind)
  );
  entityKindInput.addEventListener("change", () => {
    const kind = entityKindInput.value.trim();
    Array.from(valueRowsContainer.children).forEach((valueRow) => {
      const select = valueRow.querySelector("[data-value-entity-select]");
      populateValueEntitySelect(select, kind, select?.value || "");
    });
  });

  return row;
}

function renderSystemValueRow(entry = {}, container, entityKind) {
  if (!container) return null;
  const name = typeof entry === "string" ? entry : entry?.name || "";
  const entityId = typeof entry === "string" ? "" : entry?.entityId || "";
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  row.dataset.systemValueRow = "";
  row.innerHTML = `
    <input class="form-control form-control-sm" placeholder="Name" value="${escapeHtml(name)}" data-value-name />
    <select class="form-select form-select-sm" data-value-entity-select>
      <option value="">Not in Library yet</option>
    </select>
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-value aria-label="Remove value">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  container.appendChild(row);
  populateValueEntitySelect(row.querySelector("[data-value-entity-select]"), entityKind, entityId);
  return row;
}

// Sequential (not concurrent) fetches — Systems editing is a low-frequency
// admin action over small lists (a handful of classes/species), not worth
// the added complexity of mapWithConcurrency used elsewhere for larger
// batches.
async function populateValueEntitySelect(select, entityKind, currentValue) {
  if (!select) return;
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Not in Library yet";
  select.appendChild(blank);
  if (!entityKind || !dataManager) return;
  const systemId = (systemIdInput?.value || "").trim();
  let ids = [];
  try {
    const { remote } = await dataManager.list(entityKind, { refresh: true, includeLocal: false });
    ids = dataManager.collectListEntries(remote, ["owned", "shared", "public", "items"]).map((entry) => entry.id);
  } catch (error) {
    return;
  }
  for (const id of ids) {
    let entity = null;
    try {
      entity = (await dataManager.get(entityKind, id))?.payload;
    } catch (error) {
      continue;
    }
    const systemIds = Array.isArray(entity?.systemIds) ? entity.systemIds : [];
    if (systemId && !systemIds.includes(systemId)) continue;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = entity?.name || id;
    select.appendChild(option);
  }
  if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function collectFieldFromRow(row) {
  const key = row.querySelector("[data-property-key]").value.trim();
  const label = row.querySelector("[data-property-label]").value.trim();
  const type = row.querySelector("[data-property-type]").value;
  const category = row.querySelector("[data-property-category]").value.trim();
  const defaultRaw = row.querySelector("[data-property-default]").value;
  const minimum = row.querySelector("[data-property-minimum]").value;
  const maximum = row.querySelector("[data-property-maximum]").value;
  const required = row.querySelector("[data-property-required]").checked;
  const field = { type, key, label };
  if (category) field.category = category;
  if (defaultRaw !== "") field.default = defaultRaw;
  if (required) field.required = true;
  if (type === "number") {
    if (minimum !== "") field.minimum = Number(minimum);
    if (maximum !== "") field.maximum = Number(maximum);
  }
  if (type === "object") {
    const children = collectFieldsFromContainer(row.querySelector("[data-system-children]"));
    if (children.length) field.children = children;
  }
  if (type === "array") {
    const arrayMode = row.querySelector("[data-property-array-mode]")?.value || "values";
    if (arrayMode === "item") {
      const item = { type: "object" };
      const itemLabel = row.querySelector("[data-item-label]")?.value.trim();
      const displayField = row.querySelector("[data-item-display-field]")?.value.trim();
      if (itemLabel) item.label = itemLabel;
      if (displayField) item.displayField = displayField;
      const children = collectFieldsFromContainer(row.querySelector("[data-system-item-children]"));
      if (children.length) item.children = children;
      field.item = item;
    } else {
      const entityKind = row.querySelector("[data-property-entity-kind]")?.value.trim() || "";
      if (entityKind) field.entityKind = entityKind;
      const valueRows = Array.from(row.querySelector("[data-system-value-rows]")?.children || []);
      const values = valueRows
        .map((valueRow) => {
          const name = valueRow.querySelector("[data-value-name]")?.value.trim() || "";
          const entityId = valueRow.querySelector("[data-value-entity-select]")?.value || "";
          if (!name) return null;
          return entityId ? { name, entityId } : { name };
        })
        .filter(Boolean);
      if (values.length) field.values = values;
    }
  }
  return field;
}

function collectFieldsFromContainer(container) {
  if (!container) return [];
  return Array.from(container.children)
    .map((row) => collectFieldFromRow(row))
    .filter((field) => field.key);
}

function collectSystemProperties() {
  return collectFieldsFromContainer(systemPropertyRows);
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
    preview: systemPreviewInput?.value || "",
    properties: collectSystemProperties(),
  };
}

function refreshSystemPreviewBytes() {
  if (!systemPreviewBytesEl) return;
  systemPreviewBytesEl.textContent = formatSize(new Blob([systemPreviewInput?.value || ""]).size);
}

function applySystemSnapshot(snapshot) {
  if (!snapshot) return;
  if (systemIdInput) systemIdInput.value = snapshot.id;
  if (systemTitleInput) systemTitleInput.value = snapshot.title;
  if (systemVersionInput) systemVersionInput.value = snapshot.version;
  if (systemPreviewInput) systemPreviewInput.value = snapshot.preview || "";
  refreshSystemPreviewBytes();
  if (systemPropertyRows) {
    systemPropertyRows.innerHTML = "";
    (snapshot.properties || []).forEach((field) => renderSystemPropertyRow(field));
  }
}

function newSystemEditor() {
  if (systemIdInput) systemIdInput.value = "";
  if (systemTitleInput) systemTitleInput.value = "";
  if (systemVersionInput) systemVersionInput.value = "0.1";
  if (systemPreviewInput) systemPreviewInput.value = "";
  refreshSystemPreviewBytes();
  editingSystemImporters = [];
  if (systemPropertyRows) systemPropertyRows.innerHTML = "";
  markClean("system");
}

async function loadSystemIntoEditor(id) {
  if (!dataManager) return;
  try {
    const result = await dataManager.get("systems", id);
    const payload = result.payload || {};
    if (systemIdInput) systemIdInput.value = payload.id || id;
    if (systemTitleInput) systemTitleInput.value = payload.title || "";
    if (systemVersionInput) systemVersionInput.value = payload.version || "";
    if (systemPreviewInput) {
      systemPreviewInput.value = payload.preview ? JSON.stringify(payload.preview, null, 2) : "";
    }
    refreshSystemPreviewBytes();
    editingSystemImporters = Array.isArray(payload.importers) ? payload.importers : [];
    if (systemPropertyRows) {
      systemPropertyRows.innerHTML = "";
      (payload.fields || []).forEach((field) => renderSystemPropertyRow(field));
    }
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

if (systemAddPropertyButton) {
  systemAddPropertyButton.addEventListener("click", () => {
    recordUndoableChange("system", () => renderSystemPropertyRow());
  });
}

wireUndoTracking(systemIdInput, "system");
wireUndoTracking(systemTitleInput, "system");
wireUndoTracking(systemVersionInput, "system");
wireUndoTracking(systemPreviewInput, "system");
if (systemPreviewInput) {
  systemPreviewInput.addEventListener("input", refreshSystemPreviewBytes);
}
wireUndoTracking(systemPropertyRows, "system", {
  selector: "input, select, textarea",
});

if (systemPropertyRows) {
  systemPropertyRows.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-property-remove]");
    if (removeButton) {
      recordUndoableChange("system", () => removeButton.closest("div.border").remove());
      return;
    }
    const addChildButton = event.target.closest("[data-system-add-child]");
    if (addChildButton) {
      const target = addChildButton.closest("[data-system-object-section]")?.querySelector("[data-system-children]");
      if (target) recordUndoableChange("system", () => renderSystemPropertyRow({}, target));
      return;
    }
    const addItemChildButton = event.target.closest("[data-system-add-item-child]");
    if (addItemChildButton) {
      const target = addItemChildButton
        .closest("[data-system-item-section]")
        ?.querySelector("[data-system-item-children]");
      if (target) recordUndoableChange("system", () => renderSystemPropertyRow({}, target));
      return;
    }
    const addValueButton = event.target.closest("[data-system-add-value]");
    if (addValueButton) {
      const arraySection = addValueButton.closest("[data-system-array-section]");
      const target = arraySection?.querySelector("[data-system-value-rows]");
      const entityKind = arraySection?.querySelector("[data-property-entity-kind]")?.value.trim() || "";
      if (target) recordUndoableChange("system", () => renderSystemValueRow({}, target, entityKind));
      return;
    }
    const removeValueButton = event.target.closest("[data-remove-value]");
    if (removeValueButton) {
      recordUndoableChange("system", () => removeValueButton.closest("[data-system-value-row]")?.remove());
    }
  });
}

if (systemSaveButton) {
  systemSaveButton.addEventListener("click", async () => {
    if (!dataManager) return;
    const id = (systemIdInput?.value || "").trim();
    if (!id) {
      status?.show("System id is required.", { type: "error", timeout: 3000 });
      return;
    }
    let preview;
    const previewRaw = (systemPreviewInput?.value || "").trim();
    if (previewRaw) {
      try {
        preview = JSON.parse(previewRaw);
      } catch (error) {
        status?.show(`Preview Data isn't valid JSON: ${error.message}`, { type: "error", timeout: 4000 });
        return;
      }
    }
    const payload = {
      id,
      title: (systemTitleInput?.value || "").trim() || id,
      version: (systemVersionInput?.value || "").trim() || "0.1",
      fields: collectSystemProperties(),
      importers: editingSystemImporters,
    };
    if (preview !== undefined) payload.preview = preview;
    try {
      await dataManager.save("systems", id, payload);
      status?.show(`Saved system ${id}.`, { type: "success", timeout: 2000 });
      await populateSystemSelect();
      systemSelect.value = id;
      await populatePlacesSystemSelect();
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
    if (!window.confirm(`Delete system "${id}"? This can't be undone.`)) return;
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
    await populatePlacesSystemSelect();
    await populateLibrarySystemCheckboxes(currentLibraryEntity()?.systemIds);
  });
}

// --- Places: System > Setting > Location -------------------------------
// Settings/Locations are two more library kinds (not nested inside the
// System document itself — that would balloon Workbench's DB-backed System
// records with unrelated Forge data), linked by systemId/settingId and
// presented here as a tree over otherwise-flat storage.

async function populatePlacesSystemSelect() {
  if (!placesSystemSelect) return;
  const systems = await listAllSystems();
  const previous = placesSystemSelect.value;
  placesSystemSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = systems.length ? "Select a system…" : "No systems yet";
  placesSystemSelect.appendChild(blank);
  systems.forEach((system) => {
    const option = document.createElement("option");
    option.value = system.id;
    option.textContent = `${system.title} (${system.id})`;
    placesSystemSelect.appendChild(option);
  });
  if (systems.some((system) => system.id === previous)) placesSystemSelect.value = previous;
}

async function loadSpeciesOptionsForSystem(systemId) {
  placesSpeciesOptions = [];
  if (!systemId) return;
  try {
    const entries = await fetchKindEntriesWithIds(dataManager, "species");
    placesSpeciesOptions = entries
      .filter((entry) => Array.isArray(entry.entity.systemIds) && entry.entity.systemIds.includes(systemId))
      .map((entry) => ({ id: entry.id, label: entry.entity.name || entry.id }));
  } catch (error) {
    placesSpeciesOptions = [];
  }
}

async function populatePlacesSettingSelect(systemId) {
  if (!placesSettingSelect) return;
  placesSettingSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "New / unsaved";
  placesSettingSelect.appendChild(blank);
  if (!systemId) return;
  const entries = await fetchKindEntriesWithIds(dataManager, "setting");
  entries
    .filter((entry) => entry.entity.systemId === systemId)
    .forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.entity.name || entry.id;
      placesSettingSelect.appendChild(option);
    });
}

async function populatePlacesLocationSelect(settingId) {
  if (!placesLocationSelect) return;
  placesLocationSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "New / unsaved";
  placesLocationSelect.appendChild(blank);
  if (!settingId) return;
  const entries = await fetchKindEntriesWithIds(dataManager, "location");
  entries
    .filter((entry) => entry.entity.settingId === settingId)
    .forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.entity.name || entry.id;
      placesLocationSelect.appendChild(option);
    });
}

function populateSettingForm(entity) {
  if (settingNameInput) settingNameInput.value = entity?.name || "";
  if (settingDescriptionInput) settingDescriptionInput.value = entity?.description || "";
  markClean("places");
}

function collectSettingFromForm(systemId) {
  return {
    kind: "setting",
    systemId,
    name: settingNameInput.value.trim(),
    description: settingDescriptionInput.value.trim(),
  };
}

function renderLocationWeightRow(entry = { entityId: "", weight: 0 }) {
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  const optionsHtml = placesSpeciesOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.id)}"${option.id === entry.entityId ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
    .join("");
  row.innerHTML = `
    <select class="form-select" data-location-weight-select>
      <option value="">Select a species…</option>
      ${optionsHtml}
    </select>
    <input class="form-control" type="number" min="0" step="1" style="max-width: 6rem" value="${Number(entry.weight) || 0}" data-location-weight-value />
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-location-weight aria-label="Remove species">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  locationWeightRows.appendChild(row);
  updateLocationWeightTotal();
}

function updateLocationWeightTotal() {
  const total = Array.from(locationWeightRows.querySelectorAll("[data-location-weight-value]")).reduce(
    (sum, input) => sum + (Number(input.value) || 0),
    0
  );
  locationWeightTotal.textContent = `Total: ${total}`;
}

function renderArchetypeOverrideRow(roll = "", name = "") {
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  row.innerHTML = `
    <input class="form-control" style="max-width: 6rem" type="text" placeholder="Roll" value="${escapeHtml(roll)}" data-archetype-override-roll />
    <input class="form-control" type="text" placeholder="Archetype name" value="${escapeHtml(name)}" data-archetype-override-name />
    <button class="btn btn-outline-danger btn-sm flex-shrink-0" type="button" data-remove-archetype-override aria-label="Remove override">
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  locationArchetypeRows.appendChild(row);
}

function renderFallbackNameRow(entry = { name: "", weight: "" }) {
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
  locationFallbackRows.appendChild(row);
}

function populateLocationForm(entity) {
  if (locationNameInput) locationNameInput.value = entity?.name || "";
  if (locationMixingCoefficientInput) {
    locationMixingCoefficientInput.value = entity?.mixingCoefficient ?? 0.2;
    locationMixingCoefficientValue.textContent = Number(locationMixingCoefficientInput.value).toFixed(2);
  }
  if (locationWeightRows) {
    locationWeightRows.innerHTML = "";
    (entity?.speciesWeights || []).forEach((entry) => renderLocationWeightRow(entry));
    if (!entity?.speciesWeights?.length) renderLocationWeightRow();
    updateLocationWeightTotal();
  }
  if (locationArchetypeRows) {
    locationArchetypeRows.innerHTML = "";
    Object.entries(entity?.archetypeOverrides || {}).forEach(([roll, override]) =>
      renderArchetypeOverrideRow(roll, override?.name || "")
    );
  }
  if (locationFallbackRows) {
    locationFallbackRows.innerHTML = "";
    (entity?.genericNameFallback || []).forEach((entry) => renderFallbackNameRow(entry));
  }
  markClean("places");
}

function collectLocationFromForm(systemId, settingId) {
  const speciesWeights = Array.from(locationWeightRows.children)
    .map((row) => ({
      entityId: row.querySelector("[data-location-weight-select]").value,
      weight: Number(row.querySelector("[data-location-weight-value]").value) || 0,
    }))
    .filter((entry) => entry.entityId);
  const archetypeOverrides = {};
  Array.from(locationArchetypeRows.children).forEach((row) => {
    const roll = row.querySelector("[data-archetype-override-roll]").value.trim();
    const name = row.querySelector("[data-archetype-override-name]").value.trim();
    if (roll && name) archetypeOverrides[roll] = { name };
  });
  const genericNameFallback = Array.from(locationFallbackRows.children)
    .map((row) => {
      const name = row.querySelector("[data-fallback-name]").value.trim();
      const weight = row.querySelector("[data-fallback-weight]").value;
      if (!name) return null;
      return weight ? { name, weight: Number(weight) || 1 } : { name };
    })
    .filter(Boolean);
  return {
    kind: "location",
    systemId,
    settingId,
    name: locationNameInput.value.trim(),
    speciesWeights,
    mixingCoefficient: Number(locationMixingCoefficientInput.value) || 0,
    archetypeOverrides,
    genericNameFallback,
  };
}

function createPlacesSnapshot() {
  return {
    settingName: settingNameInput?.value || "",
    settingDescription: settingDescriptionInput?.value || "",
    locationName: locationNameInput?.value || "",
    mixingCoefficient: locationMixingCoefficientInput?.value ?? "0.2",
    speciesWeights: locationWeightRows
      ? Array.from(locationWeightRows.children).map((row) => ({
          entityId: row.querySelector("[data-location-weight-select]")?.value || "",
          weight: row.querySelector("[data-location-weight-value]")?.value || "0",
        }))
      : [],
    archetypeOverrides: locationArchetypeRows
      ? Array.from(locationArchetypeRows.children).map((row) => ({
          roll: row.querySelector("[data-archetype-override-roll]")?.value || "",
          name: row.querySelector("[data-archetype-override-name]")?.value || "",
        }))
      : [],
    genericNameFallback: locationFallbackRows
      ? Array.from(locationFallbackRows.children).map((row) => ({
          name: row.querySelector("[data-fallback-name]")?.value || "",
          weight: row.querySelector("[data-fallback-weight]")?.value || "",
        }))
      : [],
  };
}

function applyPlacesSnapshot(snapshot) {
  if (!snapshot) return;
  if (settingNameInput) settingNameInput.value = snapshot.settingName;
  if (settingDescriptionInput) settingDescriptionInput.value = snapshot.settingDescription;
  if (locationNameInput) locationNameInput.value = snapshot.locationName;
  if (locationMixingCoefficientInput) {
    locationMixingCoefficientInput.value = snapshot.mixingCoefficient;
    locationMixingCoefficientValue.textContent = Number(snapshot.mixingCoefficient).toFixed(2);
  }
  if (locationWeightRows) {
    locationWeightRows.innerHTML = "";
    (snapshot.speciesWeights || []).forEach((entry) => renderLocationWeightRow(entry));
    updateLocationWeightTotal();
  }
  if (locationArchetypeRows) {
    locationArchetypeRows.innerHTML = "";
    (snapshot.archetypeOverrides || []).forEach((entry) => renderArchetypeOverrideRow(entry.roll, entry.name));
  }
  if (locationFallbackRows) {
    locationFallbackRows.innerHTML = "";
    (snapshot.genericNameFallback || []).forEach((entry) => renderFallbackNameRow(entry));
  }
}

if (placesSystemSelect) {
  placesSystemSelect.addEventListener("change", async () => {
    const systemId = placesSystemSelect.value;
    currentSettingId = null;
    currentLocationId = null;
    await loadSpeciesOptionsForSystem(systemId);
    await populatePlacesSettingSelect(systemId);
    populateSettingForm(null);
    populateLocationForm(null);
    if (placesLocationSelect) placesLocationSelect.innerHTML = '<option value="">New / unsaved</option>';
  });
}

if (placesSettingSelect) {
  placesSettingSelect.addEventListener("change", async () => {
    const settingId = placesSettingSelect.value;
    currentSettingId = settingId || null;
    currentLocationId = null;
    if (settingId) {
      try {
        populateSettingForm((await dataManager?.get("setting", settingId))?.payload);
      } catch (error) {
        populateSettingForm(null);
      }
    } else {
      populateSettingForm(null);
    }
    await populatePlacesLocationSelect(settingId);
    populateLocationForm(null);
  });
}

if (placesLocationSelect) {
  placesLocationSelect.addEventListener("change", async () => {
    const locationId = placesLocationSelect.value;
    currentLocationId = locationId || null;
    if (locationId) {
      try {
        populateLocationForm((await dataManager?.get("location", locationId))?.payload);
      } catch (error) {
        populateLocationForm(null);
      }
    } else {
      populateLocationForm(null);
    }
  });
}

if (placesNewSettingButton) {
  placesNewSettingButton.addEventListener("click", () => {
    if (!placesSystemSelect?.value) {
      status?.show("Select a System first.", { type: "warning", timeout: 2000 });
      return;
    }
    recordUndoableChange("places", () => {
      if (placesSettingSelect) placesSettingSelect.value = "";
      currentSettingId = null;
      populateSettingForm(null);
    });
  });
}

if (placesNewLocationButton) {
  placesNewLocationButton.addEventListener("click", () => {
    if (!placesSettingSelect?.value && !currentSettingId) {
      status?.show("Select or save a Setting first.", { type: "warning", timeout: 2000 });
      return;
    }
    recordUndoableChange("places", () => {
      if (placesLocationSelect) placesLocationSelect.value = "";
      currentLocationId = null;
      populateLocationForm(null);
    });
  });
}

if (locationAddSpeciesButton) {
  locationAddSpeciesButton.addEventListener("click", () => {
    recordUndoableChange("places", () => renderLocationWeightRow());
  });
}
if (locationWeightRows) {
  locationWeightRows.addEventListener("input", (event) => {
    if (event.target.matches("[data-location-weight-value]")) updateLocationWeightTotal();
  });
  locationWeightRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-location-weight]");
    if (!button) return;
    recordUndoableChange("places", () => {
      button.closest("div.d-flex").remove();
      updateLocationWeightTotal();
    });
  });
}
if (locationMixingCoefficientInput) {
  locationMixingCoefficientInput.addEventListener("input", () => {
    locationMixingCoefficientValue.textContent = Number(locationMixingCoefficientInput.value).toFixed(2);
  });
}
if (locationAddArchetypeOverrideButton) {
  locationAddArchetypeOverrideButton.addEventListener("click", () => {
    recordUndoableChange("places", () => renderArchetypeOverrideRow());
  });
}
if (locationArchetypeRows) {
  locationArchetypeRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-archetype-override]");
    if (!button) return;
    recordUndoableChange("places", () => button.closest("div.d-flex").remove());
  });
}
if (locationAddFallbackNameButton) {
  locationAddFallbackNameButton.addEventListener("click", () => {
    recordUndoableChange("places", () => renderFallbackNameRow());
  });
}
if (locationFallbackRows) {
  locationFallbackRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-fallback-name]");
    if (!button) return;
    recordUndoableChange("places", () => button.closest("div.d-flex").remove());
  });
}

wireUndoTracking(settingNameInput, "places");
wireUndoTracking(settingDescriptionInput, "places");
wireUndoTracking(locationNameInput, "places");
wireUndoTracking(locationMixingCoefficientInput, "places");
wireUndoTracking(locationWeightRows, "places", { selector: "select, input" });
wireUndoTracking(locationArchetypeRows, "places", { selector: "input" });
wireUndoTracking(locationFallbackRows, "places", { selector: "input" });

async function saveEntityToLibrary(kind, id, data) {
  if (!dataManager) throw new Error("Not signed in");
  await dataManager.save(kind, id, data);
}

if (placesSaveButton) {
  placesSaveButton.addEventListener("click", async () => {
    const systemId = placesSystemSelect?.value;
    if (!systemId) {
      status?.show("Select a System first.", { type: "warning", timeout: 2000 });
      return;
    }
    try {
      let settingId = currentSettingId || placesSettingSelect?.value;
      if (!settingId) {
        if (!settingNameInput.value.trim()) {
          status?.show("Enter a Setting name first.", { type: "warning", timeout: 2500 });
          return;
        }
        settingId = slugify(settingNameInput.value);
      }
      await saveEntityToLibrary("setting", settingId, collectSettingFromForm(systemId));
      currentSettingId = settingId;
      await populatePlacesSettingSelect(systemId);
      placesSettingSelect.value = settingId;

      const wantsLocationSave = locationNameInput.value.trim() || currentLocationId || placesLocationSelect?.value;
      if (wantsLocationSave) {
        let locationId = currentLocationId || placesLocationSelect?.value;
        if (!locationId) {
          if (!locationNameInput.value.trim()) {
            status?.show(`Saved Setting ${settingId}. Enter a Location name to save one too.`, {
              type: "success",
              timeout: 3000,
            });
            await populatePlacesLocationSelect(settingId);
            markClean("places");
            return;
          }
          locationId = slugify(locationNameInput.value);
        }
        await saveEntityToLibrary("location", locationId, collectLocationFromForm(systemId, settingId));
        currentLocationId = locationId;
        await populatePlacesLocationSelect(settingId);
        placesLocationSelect.value = locationId;
      }
      status?.show("Saved.", { type: "success", timeout: 2000 });
      markClean("places");
    } catch (error) {
      status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

if (placesDeleteLocationButton) {
  placesDeleteLocationButton.addEventListener("click", async () => {
    const id = currentLocationId || placesLocationSelect?.value;
    if (!id) {
      status?.show("Select a Location to delete first.", { type: "warning", timeout: 2500 });
      return;
    }
    if (!window.confirm(`Delete location "${id}"? This can't be undone.`)) return;
    try {
      await deleteLibraryEntry("location", id);
      status?.show(`Deleted location ${id}.`, { type: "success", timeout: 2000 });
      currentLocationId = null;
      if (placesLocationSelect) placesLocationSelect.value = "";
      populateLocationForm(null);
      await populatePlacesLocationSelect(currentSettingId || placesSettingSelect?.value || "");
    } catch (error) {
      status?.show(`Unable to delete: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// --- Mapping load/save -------------------------------------------------

async function listMappings() {
  try {
    const response = await fetch("/list/loom-mappings");
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.files || []).map((entry) => entry.filename).filter(Boolean);
  } catch (error) {
    return [];
  }
}

async function populateMappingSelect() {
  if (!mappingSelect) return;
  const names = await listMappings();
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
  // now, so a plain clear() here would also wipe Library/System/Places
  // history that has nothing to do with switching mappings.
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

if (saveButton) {
  saveButton.addEventListener("click", async () => {
    if (!mappingDefinition) {
      status?.show("Nothing to save yet.", { type: "warning", timeout: 2000 });
      return;
    }
    if (!mappingDefinition.$source && sourceSelect && !sourceSelect.disabled) {
      mappingDefinition.$source = sourceSelect.value;
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

  // Loom edits shared suite-wide data (Library entities, Systems, and now
  // DB-backed Characters) — gated to creator+ for the whole tool, not just
  // individual save actions, so anonymous/simple-tier visitors can't view or
  // edit any of it. This is a whole-page gate (unlike Workbench's per-tab
  // gating), since Loom has no ungated view worth showing partially.
  const gate = initTierGate({
    root: document,
    dataManager,
    status,
    auth,
    requiredTier: "creator",
    gateSelector: "[data-tier-gate]",
    contentSelector: "[data-tier-content]",
    onGranted: () => window.location.reload(),
    onRevoked: () => window.location.reload(),
  });

  if (!gate.allowed) {
    return;
  }

  setLoomView("import");

  if (undoButton) undoButton.addEventListener("click", () => shell.undo());
  if (redoButton) redoButton.addEventListener("click", () => shell.redo());

  try {
    sampleData = await fetch("test/fixtures/raw-character-sample.json").then((r) => r.json());
  } catch (error) {
    sampleData = {};
  }
  if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
  await populateMappingSelect();
  enterMappingMode(mappingDefinition);
  markClean("mapping");
  rerenderAll();
  loadRecentSaves();

  await populateLibraryKindSelect();
  await populateLibraryEntrySelect(libraryKindSelect?.value);
  newLibraryEntry();

  await populateSystemSelect();
  newSystemEditor();

  await populatePlacesSystemSelect();
  populateSettingForm(null);
  populateLocationForm(null);

  initHelpSystem({ root: document });
  refreshTooltips(document);
}

init();
