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
import { initShareModal } from "../../common/js/lib/share-modal.js";

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
const recentSavesToggle = document.querySelector("[data-recent-saves-toggle]");
const recentSavesPanel = document.querySelector("[data-recent-saves-panel]");
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

// --- Library / Systems DOM refs ---------------------------------------------

const libraryIdInput = document.querySelector("[data-library-id]");
const librarySystemList = document.querySelector("[data-library-system-list]");
const libraryTemplateSection = document.querySelector("[data-library-template-section]");
const libraryTemplateSelect = document.querySelector("[data-library-template-select]");
const libraryJsonTextarea = document.querySelector("[data-library-json]");
const libraryJsonError = document.querySelector("[data-library-json-error]");
const libraryNewButton = document.querySelector("[data-library-new]");
const librarySaveButton = document.querySelector("[data-library-save]");
const libraryDeleteButton = document.querySelector("[data-library-delete]");

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

const CUSTOM_FUNCTION_NAMES = Object.keys(customFunctions);
const PROPERTY_TYPES = ["string", "number", "boolean", "object", "array"];

let mappingDefinition = null;
let selectedNode = null;
let sampleData = {};
let currentMappingId = null;
let isApplyingHistory = false;
let dataManager = null;
let shareModal = null;
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
};

// --- Save/Rename/Delete gating -----------------------------------------
// "Clean" baseline per tab (the state at last load/new/save) — reuses the
// same per-type snapshot functions undo/redo already has, so dirty-checking
// doesn't need its own parallel tracking. Save only lights up once the
// current state actually differs from that baseline; Rename/Delete only
// need a real, currently-loaded item (an id), not necessarily a change.
const cleanSnapshots = { mapping: null, library: null, system: null };

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
  if (systemDeleteButton) systemDeleteButton.disabled = !canDeleteSystem();
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
    let data = entity.data;
    if (entity.kind === "character") {
      // The DDB mapping only ever produces character *content* (identity,
      // stats, abilities, ...) — it has no concept of which Workbench
      // template/system a character is assigned to, or the `data` bucket
      // Workbench's own sheet fields write into (see
      // workbench-character-view.js's persistDraft). A plain overwrite here
      // (re-importing to refresh an existing character's DDB-sourced
      // fields) would silently wipe that assignment, making the character
      // vanish from Workbench's own picker — which filters on `template`
      // being set — even though the record itself still exists and loads
      // fine here in Loom. Preserve whatever the existing record already
      // had for these three keys; the fresh mapped content still wins for
      // everything the mapping actually produces.
      try {
        // preferLocal: false for the same reason loadLibraryEntry uses it —
        // this specifically needs the record actually on the server right
        // now, not a possibly-stale local cache from an earlier save.
        const existing = await dataManager.get("character", id, { preferLocal: false });
        const prior = existing?.payload || {};
        data = { template: prior.template, system: prior.system, data: prior.data, ...entity.data };
      } catch (error) {
        // No existing record at this id — nothing to preserve, first import.
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
// Same nav-pills convention as Press's Live Preview/Grid View tabs. Only the
// active view's cards show — in the main pane, AND in the left/right panes
// (the mapping toolbar/palette/sample-data on the left and the tree Inspector
// on the right are Import-only; Library/Systems carry their own
// pickers/toolbars inline, so they don't need anything extra from either
// side pane).
const LOOM_VIEWS = ["import", "library", "systems", "users", "groups"];
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
const loomGroupsMessage = document.querySelector("[data-loom-groups-message]");
const loomGroupsSelect = document.querySelector("[data-loom-groups-select]");
const loomGroupEmpty = document.querySelector("[data-loom-group-empty]");
const loomGroupForm = document.querySelector("[data-loom-group-form]");
const loomGroupNameInput = document.querySelector("[data-loom-group-name]");
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

const loomGroupsState = { items: [], loading: false, stale: true, selectedId: "", cleanName: null };
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

function loomCanSaveGroup() {
  if (!loomGroupsState.selectedId || loomGroupsState.cleanName === null) return false;
  return (loomGroupNameInput?.value || "").trim() !== loomGroupsState.cleanName;
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

function loomRenderGroupDetail() {
  const group = loomFindGroup(loomGroupsState.selectedId);
  const hasGroup = Boolean(group);
  if (loomGroupEmpty) loomGroupEmpty.hidden = hasGroup;
  if (loomGroupForm) loomGroupForm.classList.toggle("d-none", !hasGroup);
  if (!hasGroup) {
    loomGroupsState.cleanName = null;
    loomUpdateGroupsToolbarState();
    return;
  }
  if (loomGroupNameInput) loomGroupNameInput.value = group.name || "";
  loomGroupsState.cleanName = (group.name || "").trim();

  const members = Array.isArray(group?.members) ? group.members.filter((member) => member.content_type === "character") : [];
  if (loomGroupMembersList) {
    loomGroupMembersList.innerHTML = "";
    const memberMap = new Map();
    members.forEach((member) => memberMap.set(member.content_id, member));
    const seenIds = new Set();
    const rows = [];
    loomOwnedCharacters.forEach((character) => {
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

  loomUpdateGroupShareDisplay(group);
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
    const [groupsPayload, ownedPayload] = await Promise.all([
      dataManager.listGroups({ refresh: shouldRefresh }),
      dataManager.listOwnedContent({ refresh: shouldRefresh }),
    ]);
    const groups = Array.isArray(groupsPayload?.groups) ? groupsPayload.groups : [];
    loomOwnedCharacters = (ownedPayload?.items || []).filter((item) => item.bucket === "character");
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
    if (!newName || newName === loomGroupsState.cleanName) return;
    loomGroupSaveButton.disabled = true;
    if (loomGroupNameInput) loomGroupNameInput.disabled = true;
    try {
      await dataManager.updateGroup({ id: group.id, name: newName });
      if (status) status.show("Group name saved.", { type: "success", timeout: 1600 });
      await loomLoadGroups({ refresh: true });
    } catch (error) {
      console.error("Unable to rename group", error);
      if (status) status.show(error.message || "Unable to rename group", { type: "danger" });
    } finally {
      if (loomGroupNameInput) loomGroupNameInput.disabled = false;
      loomUpdateGroupsToolbarState();
    }
  });
}

if (loomGroupDeleteButton) {
  loomGroupDeleteButton.addEventListener("click", async () => {
    const group = loomFindGroup(loomGroupsState.selectedId);
    if (!group) return;
    if (!window.confirm(`Delete ${group.name || "this group"}?`)) return;
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
    try {
      await dataManager.updateGroupMembers({ id: group.id, characterIds: selected });
      if (status) status.show("Group updated.", { type: "success", timeout: 1400 });
      await loomLoadGroups({ refresh: true });
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
// sees only Groups (run a campaign, nothing else); Creator adds back
// Import/Library/Systems (author reusable content); Admin adds Users
// (suite-wide tier management) on top of everything Creator sees.
const LOOM_CREATOR_TABS = ["import", "library", "systems"];

function loomAvailableViews() {
  const meetsCreator = Boolean(dataManager?.meetsTier?.("creator"));
  const isAdmin = isLoomAdminSession();
  return LOOM_VIEWS.filter((view) => {
    if (LOOM_CREATOR_TABS.includes(view)) return meetsCreator;
    if (view === "users") return isAdmin;
    return true; // groups: available to every tier the whole tool already requires (gm+)
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
const loomLibraryTableTypeSelect = document.querySelector("[data-loom-library-table-type]");
const loomLibraryTableSelect = document.querySelector("[data-loom-library-table-select]");
const loomLibraryInspectorEmpty = document.querySelector("[data-loom-library-table-inspector-empty]");
const loomLibraryInspectorDetails = document.querySelector("[data-loom-library-table-inspector-details]");
const loomLibraryInspectorCreated = document.querySelector("[data-loom-library-table-created]");
const loomLibraryInspectorAccessed = document.querySelector("[data-loom-library-table-accessed]");
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

function loomRenderLibraryInspector() {
  const item = loomFindLibraryItem(loomLibraryTableState.selectedKey);
  const hasItem = Boolean(item);
  if (loomLibraryInspectorEmpty) loomLibraryInspectorEmpty.hidden = hasItem;
  if (loomLibraryInspectorDetails) loomLibraryInspectorDetails.classList.toggle("d-none", !hasItem);
  if (!hasItem) {
    void loomRenderLibraryShareSummary(null);
    return;
  }
  if (loomLibraryInspectorCreated) loomLibraryInspectorCreated.textContent = loomFormatTimestamp(item.created_at, "Unknown");
  if (loomLibraryInspectorAccessed) loomLibraryInspectorAccessed.textContent = loomFormatTimestamp(item.last_accessed_at, "Never");
  if (loomLibraryInspectorOwner) {
    const ownerTier = item.owner_tier ? loomFormatTier(item.owner_tier) : "";
    loomLibraryInspectorOwner.textContent = item.owner_username
      ? ownerTier
        ? `${item.owner_username} (${ownerTier})`
        : item.owner_username
      : "Unassigned";
  }
  void loomRenderLibraryShareSummary(item);
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
  try {
    if (!loomLibraryKindLabels.size) {
      const kinds = await loadLibraryKinds();
      loomLibraryKindLabels = new Map(kinds.map((kind) => [kind.id, kind.label || kind.id]));
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
  populateLibraryTemplateSelect(currentLibraryEntity());
}

function newLibraryEntry() {
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
  populateLibraryTemplateSelect({});
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
    if (libraryIdInput) {
      libraryIdInput.value = id;
      libraryIdInput.disabled = true;
    }
    if (libraryJsonTextarea) libraryJsonTextarea.value = JSON.stringify(entity, null, 2);
    await populateLibrarySystemCheckboxes(entity.systemIds);
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
    if (!window.confirm(`Delete ${kind}/${id}? This can't be undone.`)) return;
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
  // Only a not-yet-saved System gets a typeable Id — once it exists, the id
  // is how Library entities' Assigned Systems and Templates refer to it, so
  // changing it later would silently break those references.
  if (systemIdInput) {
    systemIdInput.value = "";
    systemIdInput.disabled = false;
  }
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
    if (systemIdInput) {
      systemIdInput.value = payload.id || id;
      systemIdInput.disabled = true;
    }
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
    await populateLibrarySystemCheckboxes(currentLibraryEntity()?.systemIds);
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

  newLibraryEntry();

  await populateSystemSelect();
  newSystemEditor();

  initHelpSystem({ root: document });
  refreshTooltips(document);
}

init();
